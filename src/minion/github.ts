import { spawnSync } from "node:child_process";
import { rmSync, existsSync } from "node:fs";
import path from "node:path";
import { Workspace } from "./workspace";
import {
  workTicket,
  writeReceipt,
  testToReceipt,
  type MinionReceipt,
  type Ticket,
} from "./minion";
import { modelLabel } from "../model";

/**
 * The GitHub path: a minion takes a real issue, fixes it on a clone of the real
 * repo, and — only if the SAME gates pass — pushes a branch and opens a real
 * pull request for human review. It never commits to the default branch and
 * never merges; the PR is the artifact.
 */
const RUNS_DIR = path.join(process.cwd(), ".minion-runs");

function run(cmd: string, args: string[], cwd?: string) {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return {
    ok: res.status === 0,
    out: (res.stdout || "").trim(),
    err: (res.stderr || "").trim(),
  };
}

interface Issue {
  number: number;
  title: string;
  body: string;
}

function fetchIssue(repo: string, issueNumber: number): Issue {
  const res = run("gh", [
    "issue",
    "view",
    String(issueNumber),
    "--repo",
    repo,
    "--json",
    "number,title,body",
  ]);
  if (!res.ok) {
    throw new Error(`Could not read ${repo}#${issueNumber}: ${res.err || res.out}`);
  }
  return JSON.parse(res.out) as Issue;
}

export interface PrOptions {
  provider?: string;
  /** Base branch to work from and target the PR at; defaults to the repo's default. */
  baseBranch?: string;
  /** A line for the top of the PR body, e.g. "Closes #3." or "Linear: ENG-123". */
  reference?: string;
  onProgress?: (m: string) => void;
}

/**
 * The source-agnostic core: given a ticket (from GitHub, Linear, anywhere) and
 * a repo, clone the repo on a fresh branch, run the minion + gates, and — only
 * on approval — push and open a real pull request. The issue *source* is the
 * caller's concern; everything from here down is identical no matter where the
 * work came from.
 */
export async function openPullRequest(
  repo: string,
  ticket: Ticket,
  opts: PrOptions = {},
): Promise<MinionReceipt> {
  const log = opts.onProgress ?? (() => {});
  const slug = ticket.id.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const workDir = path.join(RUNS_DIR, `gh-${repo.replace(/[/]/g, "__")}-${slug}`);
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });

  log(opts.baseBranch ? `cloning ${repo} (branch ${opts.baseBranch})…` : `cloning ${repo}…`);
  const cloneFlags = opts.baseBranch
    ? ["--branch", opts.baseBranch, "--depth", "1"]
    : ["--depth", "1"];
  const clone = run("gh", ["repo", "clone", repo, workDir, "--", ...cloneFlags]);
  if (!clone.ok) throw new Error(`Clone failed: ${clone.err || clone.out}`);

  // Whatever we checked out (the requested base, or the repo default) is what
  // the new branch forks from and what the PR targets.
  const baseBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], workDir).out;
  const branch = `minion/${slug}`;
  run("git", ["config", "user.email", "minion@agent-forge.local"], workDir);
  run("git", ["config", "user.name", "Forge Minion"], workDir);
  run("git", ["checkout", "-q", "-b", branch], workDir);

  const workspace = new Workspace(workDir);
  const decision = await workTicket(workspace, ticket, opts);

  const receiptBase: MinionReceipt = {
    ticketId: ticket.id,
    title: ticket.title,
    model: modelLabel(opts.provider),
    status: decision.status === "approved" ? "shipped" : decision.status,
    reason: decision.reason,
    branch,
    steps: decision.steps,
    toolCalls: decision.toolCalls,
    baselineTests: { passed: decision.baseline.passed, total: decision.baseline.total },
    finalTests: testToReceipt(decision.finalTests),
    patch: decision.patch,
  };

  if (decision.status !== "approved") {
    return writeReceipt(receiptBase);
  }

  // Approved — ship it for real: commit, push the branch, open the PR.
  log("approved — pushing branch and opening PR…");
  workspace.commit(`${ticket.title}`);
  const push = run("git", ["push", "-u", "origin", branch], workDir);
  if (!push.ok) throw new Error(`Push failed: ${push.err || push.out}`);

  const refLine = opts.reference ? `${opts.reference}\n\n` : "";
  const body = `${refLine}${decision.reason}\n\nVerified: ${decision.finalTests.passed}/${decision.finalTests.total} tests passing, no regressions.\n\n— opened autonomously by a [Forge minion](https://github.com/salehaiftikharr/agent-forge).`;
  const pr = run("gh", [
    "pr",
    "create",
    "--repo",
    repo,
    "--base",
    baseBranch,
    "--head",
    branch,
    "--title",
    ticket.title,
    "--body",
    body,
  ]);
  if (!pr.ok) throw new Error(`PR create failed: ${pr.err || pr.out}`);
  const prUrl = pr.out.split("\n").find((l) => l.startsWith("http")) ?? pr.out;

  return writeReceipt({ ...receiptBase, prUrl });
}

/** GitHub-issue source: read the issue via `gh`, then open a PR for it. */
export async function runMinionPR(
  repo: string,
  issueNumber: number,
  opts: { provider?: string; baseBranch?: string; onProgress?: (m: string) => void } = {},
): Promise<MinionReceipt> {
  const issue = fetchIssue(repo, issueNumber);
  opts.onProgress?.(`issue #${issue.number}: ${issue.title}`);
  return openPullRequest(
    repo,
    { id: `issue-${issue.number}`, title: issue.title, body: issue.body },
    { ...opts, reference: `Closes #${issue.number}.` },
  );
}
