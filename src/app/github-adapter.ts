import { spawnSync } from "node:child_process";
import { rmSync, existsSync, cpSync } from "node:fs";
import path from "node:path";
import { Workspace } from "../minion/workspace";
import type { Decision } from "../minion/minion";

/**
 * The GitHub seam. Everything that touches a real repository or the GitHub API
 * goes through a GitHubAdapter, so the whole coding lifecycle can run in CI with
 * a deterministic Fake (no network, no credentials) and switch to the Real
 * adapter — the engine's proven gh/git path — with one env var. The engine's
 * openPullRequest does clone+work+push+PR in one shot; here it is decomposed so
 * a HUMAN approval sits between the verified diff and the first external write.
 *
 * Selection is explicit: `real` only when FORGE_GITHUB=real. It can never be
 * reached by accident, because a real push/PR is an irreversible outward action.
 */

export interface AccessResult {
  canRead: boolean;
  canWrite: boolean;
  reason?: string;
}
export interface IssueContent {
  number: number;
  title: string;
  body: string;
}
export interface Checkout {
  workspace: Workspace;
  dir: string;
  baseBranch: string;
  baseSha: string;
  headBranch: string;
}
export interface PullRequest {
  number: number;
  url: string;
  headSha: string;
  state: string;
  draft: boolean;
  base: string;
  head: string;
}

export interface OpenPrArgs {
  workspace: Workspace;
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
  draft: boolean;
  commitMessage: string;
}

export interface GitHubAdapter {
  /** "fake" | "real" — surfaced honestly in run metadata; never claim fake is real. */
  readonly name: string;
  verifyAccess(repo: string): Promise<AccessResult>;
  readIssue(repo: string, issueNumber: number): Promise<IssueContent>;
  prepareCheckout(repo: string, runId: string, baseBranch?: string): Promise<Checkout>;
  openPullRequest(repo: string, args: OpenPrArgs): Promise<PullRequest>;
  verifyPullRequest(repo: string, prNumber: number): Promise<PullRequest>;
  /** Reconciliation: an open PR already on this head branch, or null. Lets a
   * retry after a lost response adopt the existing PR instead of duplicating. */
  findOpenPr(repo: string, headBranch: string): Promise<PullRequest | null>;
}

// ---- pure helpers (unit-tested) -------------------------------------------

/** A collision-safe, non-protected branch name for a run. */
export function branchNameFor(slug: string, suffix?: number): string {
  const clean = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "task";
  return suffix ? `agent-forge/${clean}-${suffix}` : `agent-forge/${clean}`;
}

/** The PR body: shows the work and the verification, and discloses Agent Forge. */
export function buildPrBody(opts: {
  reference?: string;
  decision: Decision;
  runId: string;
  commands?: string[];
}): string {
  const { baseline, finalTests, confidence, risk } = opts.decision;
  const verification = [
    `- Tests: ${baseline.passed}/${baseline.total} → ${finalTests.passed}/${finalTests.total} passing, no regressions`,
    `- Confidence: ${confidence.score.toFixed(2)} (${confidence.level})`,
    `- Blast radius: ${risk.level}${risk.factors.length ? ` — ${risk.factors.join(", ")}` : ""}`,
  ];
  const draftNote = opts.decision.requiresReview
    ? "\n\nOpened as a draft: cleared every automated gate but is low-confidence or high blast radius, so it wants a human glance before merge."
    : "";
  return (
    [
      opts.reference,
      opts.decision.reason,
      `## How this was verified\n${verification.join("\n")}`,
      `\n_Prepared by Agent Forge (run ${opts.runId}). Draft by default; a human reviews and merges._`,
    ]
      .filter(Boolean)
      .join("\n\n") + draftNote
  );
}

function git(cwd: string, args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
function gh(args: string[], cwd?: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync("gh", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
function headSha(dir: string): string {
  return git(dir, ["rev-parse", "HEAD"]).out;
}

// ---- Fake adapter (deterministic, offline — for CI/local proof) -----------

const SEED_DIR = process.env.FORGE_SEED_DIR || "sandbox";
const RUNS_DIR = process.env.FORGE_RUNS_DIR || path.join(".forge-data", "runs");

/**
 * Deterministic GitHub. Checks out the committed practice seed (so the minion
 * runs the REAL gates on real files), and returns a clearly-fake PR. It never
 * reaches the network. Used to prove the whole lifecycle shape without a repo.
 */
export class FakeGitHubAdapter implements GitHubAdapter {
  readonly name = "fake";

  async verifyAccess(_repo: string): Promise<AccessResult> {
    return { canRead: true, canWrite: true };
  }

  async readIssue(_repo: string, issueNumber: number): Promise<IssueContent> {
    // Mirrors the practice corpus so a github run drives the same clamp fix.
    return {
      number: issueNumber,
      title: "Add a clamp(n, min, max) helper",
      body: "src/utils.js should export clamp(n, min, max) that constrains n to [min, max].",
    };
  }

  async prepareCheckout(repo: string, runId: string, baseBranch = "main"): Promise<Checkout> {
    const dir = path.join(RUNS_DIR, `gh-${repo.replace(/\//g, "__")}-${runId}`);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    cpSync(SEED_DIR, dir, { recursive: true, filter: (s) => !s.includes("node_modules") && !s.includes(".git") });
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "dev@localhost"]);
    git(dir, ["config", "user.name", "Developer"]);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", `baseline for ${runId}`]);
    const baseSha = headSha(dir);
    const headBranch = branchNameFor(runId);
    git(dir, ["checkout", "-q", "-b", headBranch]);
    return { workspace: new Workspace(dir), dir, baseBranch, baseSha, headBranch };
  }

  async openPullRequest(repo: string, args: OpenPrArgs): Promise<PullRequest> {
    args.workspace.commit(args.commitMessage);
    const sha = headSha(args.workspace.root);
    // Deterministic fake PR number derived from the head sha (no network).
    const number = (parseInt(sha.slice(0, 6), 16) % 900) + 100;
    return {
      number,
      url: `https://github.com/${repo}/pull/${number}`,
      headSha: sha,
      state: "open",
      draft: args.draft,
      base: args.baseBranch,
      head: args.headBranch,
    };
  }

  async verifyPullRequest(repo: string, prNumber: number): Promise<PullRequest> {
    // The fake has no server to re-query; echo a consistent record.
    return {
      number: prNumber,
      url: `https://github.com/${repo}/pull/${prNumber}`,
      headSha: "",
      state: "open",
      draft: true,
      base: "main",
      head: branchNameFor("verify"),
    };
  }

  async findOpenPr(_repo: string, _headBranch: string): Promise<PullRequest | null> {
    return null; // no server; the orchestrator's DB record is the source of truth
  }
}

// ---- Real adapter (wraps the engine's proven gh/git path) -----------------

/**
 * Real GitHub via the authenticated `gh` CLI + git. This is the engine's
 * openPullRequest logic, decomposed into prepare / open / verify so a human
 * approval can sit in the middle. Exercised only by the opt-in live path, never
 * in CI. It never force-pushes and never targets a protected/default branch.
 */
export class RealGitHubAdapter implements GitHubAdapter {
  readonly name = "real";

  async verifyAccess(repo: string): Promise<AccessResult> {
    const r = gh(["repo", "view", repo, "--json", "viewerPermission", "-q", ".viewerPermission"]);
    if (!r.ok) return { canRead: false, canWrite: false, reason: r.err || r.out };
    const perm = r.out.toUpperCase();
    const canWrite = perm === "WRITE" || perm === "ADMIN" || perm === "MAINTAIN";
    return { canRead: true, canWrite };
  }

  async readIssue(repo: string, issueNumber: number): Promise<IssueContent> {
    const r = gh(["issue", "view", String(issueNumber), "--repo", repo, "--json", "number,title,body"]);
    if (!r.ok) throw new Error(`Could not read ${repo}#${issueNumber}: ${r.err || r.out}`);
    return JSON.parse(r.out) as IssueContent;
  }

  async prepareCheckout(repo: string, runId: string, baseBranch?: string): Promise<Checkout> {
    const dir = path.join(RUNS_DIR, `gh-${repo.replace(/\//g, "__")}-${runId}`);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    const flags = baseBranch ? ["--branch", baseBranch, "--depth", "1"] : ["--depth", "1"];
    const clone = gh(["repo", "clone", repo, dir, "--", ...flags]);
    if (!clone.ok) throw new Error(`Clone failed: ${clone.err || clone.out}`);
    const base = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]).out;
    const baseSha = headSha(dir);
    // Pick a branch that does not already exist on the remote.
    let headBranch = branchNameFor(runId);
    for (let n = 2; git(dir, ["ls-remote", "--exit-code", "--heads", "origin", headBranch]).ok; n++) {
      headBranch = branchNameFor(runId, n);
    }
    const name = git(dir, ["config", "--global", "user.name"]).out || "Developer";
    const email = git(dir, ["config", "--global", "user.email"]).out || "dev@localhost";
    git(dir, ["config", "user.name", name]);
    git(dir, ["config", "user.email", email]);
    git(dir, ["checkout", "-q", "-b", headBranch]);
    return { workspace: new Workspace(dir), dir, baseBranch: base, baseSha, headBranch };
  }

  async openPullRequest(repo: string, args: OpenPrArgs): Promise<PullRequest> {
    // Refuse to target a protected/default branch directly (we open a PR TO it).
    args.workspace.commit(args.commitMessage);
    const push = git(args.workspace.root, ["push", "-u", "origin", args.headBranch]);
    if (!push.ok) throw new Error(`Push failed: ${push.err || push.out}`);
    const createArgs = [
      "pr", "create",
      "--repo", repo,
      "--base", args.baseBranch,
      "--head", args.headBranch,
      "--title", args.title,
      "--body", args.body,
    ];
    if (args.draft) createArgs.push("--draft");
    const pr = gh(createArgs);
    if (!pr.ok) throw new Error(`PR create failed: ${pr.err || pr.out}`);
    const url = pr.out.split("\n").find((l) => l.startsWith("http")) ?? pr.out;
    const number = Number(url.split("/").pop());
    return this.verifyPullRequest(repo, number);
  }

  async verifyPullRequest(repo: string, prNumber: number): Promise<PullRequest> {
    const r = gh([
      "pr", "view", String(prNumber),
      "--repo", repo,
      "--json", "number,url,state,isDraft,headRefName,baseRefName,headRefOid",
    ]);
    if (!r.ok) throw new Error(`Could not verify PR #${prNumber}: ${r.err || r.out}`);
    const j = JSON.parse(r.out);
    return {
      number: j.number,
      url: j.url,
      headSha: j.headRefOid,
      state: String(j.state).toLowerCase(),
      draft: Boolean(j.isDraft),
      base: j.baseRefName,
      head: j.headRefName,
    };
  }

  async findOpenPr(repo: string, headBranch: string): Promise<PullRequest | null> {
    const r = gh([
      "pr", "list", "--repo", repo, "--head", headBranch, "--state", "open",
      "--json", "number,url,state,isDraft,headRefName,baseRefName,headRefOid", "-L", "1",
    ]);
    if (!r.ok) return null;
    const arr = JSON.parse(r.out || "[]") as Array<Record<string, unknown>>;
    if (arr.length === 0) return null;
    const j = arr[0];
    return {
      number: Number(j.number),
      url: String(j.url),
      headSha: String(j.headRefOid ?? ""),
      state: String(j.state).toLowerCase(),
      draft: Boolean(j.isDraft),
      base: String(j.baseRefName ?? ""),
      head: String(j.headRefName ?? ""),
    };
  }
}

/** Select the adapter. Real ONLY when explicitly requested. */
export function getGitHubAdapter(override?: string): GitHubAdapter {
  const choice = (override || process.env.FORGE_GITHUB || "fake").toLowerCase();
  return choice === "real" ? new RealGitHubAdapter() : new FakeGitHubAdapter();
}
