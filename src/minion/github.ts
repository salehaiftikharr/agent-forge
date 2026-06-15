import { spawnSync } from "node:child_process";
import { rmSync, existsSync } from "node:fs";
import path from "node:path";
import { Workspace } from "./workspace";
import {
  workTicket,
  writeReceipt,
  testToReceipt,
  type MinionReceipt,
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

export async function runMinionPR(
  repo: string,
  issueNumber: number,
  opts: { provider?: string; onProgress?: (m: string) => void } = {},
): Promise<MinionReceipt> {
  const log = opts.onProgress ?? (() => {});

  const issue = fetchIssue(repo, issueNumber);
  log(`issue #${issue.number}: ${issue.title}`);

  const ticketId = `issue-${issue.number}`;
  const workDir = path.join(RUNS_DIR, `gh-${repo.replace(/[/]/g, "__")}-${issue.number}`);
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });

  log("cloning repo…");
  const clone = run("gh", ["repo", "clone", repo, workDir, "--", "--depth", "1"]);
  if (!clone.ok) throw new Error(`Clone failed: ${clone.err || clone.out}`);

  const baseBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], workDir).out;
  const branch = `minion/issue-${issue.number}`;
  run("git", ["config", "user.email", "minion@agent-forge.local"], workDir);
  run("git", ["config", "user.name", "Forge Minion"], workDir);
  run("git", ["checkout", "-q", "-b", branch], workDir);

  const workspace = new Workspace(workDir);
  const decision = await workTicket(
    workspace,
    { id: ticketId, title: issue.title, body: issue.body },
    opts,
  );

  const receiptBase: MinionReceipt = {
    ticketId,
    title: issue.title,
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
  workspace.commit(`Fix #${issue.number}: ${issue.title}`);
  const push = run("git", ["push", "-u", "origin", branch], workDir);
  if (!push.ok) throw new Error(`Push failed: ${push.err || push.out}`);

  const body = `Closes #${issue.number}.\n\n${decision.reason}\n\nVerified: ${decision.finalTests.passed}/${decision.finalTests.total} tests passing, no regressions.\n\n— opened autonomously by a [Forge minion](https://github.com/salehaiftikharr/agent-forge).`;
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
    issue.title,
    "--body",
    body,
  ]);
  if (!pr.ok) throw new Error(`PR create failed: ${pr.err || pr.out}`);
  const prUrl = pr.out.split("\n").find((l) => l.startsWith("http")) ?? pr.out;

  return writeReceipt({ ...receiptBase, prUrl });
}
