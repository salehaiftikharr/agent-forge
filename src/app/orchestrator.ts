import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { prepareWorkspace, Workspace } from "../minion/workspace";
import { workTicket, type Ticket } from "../minion/minion";
import { modelLabel } from "../model";
import { getGitHubAdapter, buildPrBody } from "./github-adapter";
import type { Store, JobRow, RunRow } from "./store";

/**
 * The bridge between a durable job and the real engine. It runs the actual
 * workTicket() — real workspace, git, tests, gates — and records everything to
 * the store as it goes. It never ships without a persisted approval, and it
 * honors the cooperative cancel flag at every boundary. Two phases, one per job
 * kind: `execute` produces the verified decision and parks for approval;
 * `ship` records the approved diff as an artifact and completes the run.
 */

const SEED_DIR = process.env.FORGE_SEED_DIR || "sandbox";
const RUNS_DIR = process.env.FORGE_RUNS_DIR || path.join(".forge-data", "runs");

/** Build the engine Ticket for a run: use the seeded practice ticket when the id
 * matches, else treat the free-text goal as the ticket (the live path). */
function ticketFor(ticketId: string, goal: string, context: string | null): Ticket {
  const seedFile = path.join(SEED_DIR, "tickets.json");
  if (existsSync(seedFile)) {
    const seeds = JSON.parse(readFileSync(seedFile, "utf8")) as Ticket[];
    const seed = seeds.find((t) => t.id === ticketId);
    if (seed) return seed;
  }
  const title = goal.split("\n")[0].slice(0, 120);
  return { id: ticketId, title, body: context ? `${goal}\n\n${context}` : goal };
}

/** Map an engine progress line to a timeline event kind. These are real logs. */
function kindFor(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("plan")) return "plan";
  if (m.includes("mutation") || m.includes("baseline") || m.includes("final") || m.includes("test")) return "test";
  if (m.includes("confidence")) return "verdict";
  if (m.includes("adversarial") || m.includes("verif")) return "verdict";
  return "tool";
}

function cancelled(store: Store, runId: string): boolean {
  const run = store.getRun(runId);
  return !!run && (run.cancel_requested === 1 || run.state === "cancelled");
}

export async function executeRun(store: Store, job: JobRow): Promise<void> {
  const runId = job.run_id;
  const run = store.getRun(runId);
  if (!run) throw new Error(`no such run ${runId}`);
  if (run.state !== "queued" && run.state !== "retrying") return; // already advanced — idempotent no-op
  if (cancelled(store, runId)) {
    store.setRunState(runId, "cancelled", { reason: "Cancelled before execution." });
    return;
  }

  store.setRunState(runId, "running");
  const ws = prepareWorkspace(SEED_DIR, RUNS_DIR, runId);
  const ticket = ticketFor(run.ticket_id, run.goal, run.context);

  const decision = await workTicket(ws.workspace, ticket, {
    provider: run.provider,
    onProgress: (m) => {
      store.appendEvent(runId, { kind: kindFor(m), label: m, phase: "executed" });
    },
  });

  store.updateRun(runId, {
    steps: decision.steps,
    tool_calls: decision.toolCalls,
    cost_usd: decision.costUsd,
    duration_ms: decision.durationMs,
    model: modelLabel(run.provider),
    baseline_passed: decision.baseline.passed,
    baseline_total: decision.baseline.total,
    final_passed: decision.finalTests.passed,
    final_total: decision.finalTests.total,
  });

  if (cancelled(store, runId)) {
    store.setRunState(runId, "cancelled", { reason: "Cancelled during execution; result discarded before shipping." });
    return;
  }

  if (decision.status === "approved") {
    store.updateRun(runId, {
      reason: decision.reason,
      confidence_score: decision.confidence.score,
      confidence_level: decision.confidence.level,
      risk_level: decision.risk.level,
      requires_review: decision.requiresReview ? 1 : 0,
    });
    store.appendEvent(runId, {
      kind: "approval_requested",
      label: "Verified fix ready — approval required to ship",
      detail: `confidence ${decision.confidence.score.toFixed(2)} (${decision.confidence.level}), risk ${decision.risk.level}`,
      phase: "requested",
    });
    store.createApproval(runId, run.workspace_id, {
      action: "ship",
      summary: `Ship the verified fix for ${run.ticket_id}: ${ticket.title}`,
      preview: decision.patch,
    });
    store.setRunState(runId, "waiting_approval");
  } else if (decision.status === "declined") {
    store.appendEvent(runId, { kind: "verdict", label: `Declined: ${decision.reason}`, phase: "executed" });
    store.setRunState(runId, "declined", { reason: decision.reason });
  } else {
    // error — throw so the worker records the job failure and applies retry policy
    throw new Error(decision.reason || "engine error");
  }
}

export async function shipRun(store: Store, job: JobRow): Promise<void> {
  const runId = job.run_id;
  const run = store.getRun(runId);
  if (!run) throw new Error(`no such run ${runId}`);
  if (run.state === "completed") return; // idempotent

  // Execution-time re-check: never ship without a persisted approval, even if a
  // ship job somehow exists. This is the enforcement boundary a forged client
  // request cannot cross — the decision is read from the DB here, not trusted.
  const appr = store.latestApproval(runId, "ship");
  if (!appr || appr.status !== "approved") {
    throw new Error(`ship refused: no approved decision for run ${runId}`);
  }
  if (cancelled(store, runId)) {
    store.setRunState(runId, "cancelled", { reason: "Cancelled before shipping." });
    return;
  }

  const patch = appr.preview ?? "";
  store.addArtifact(runId, run.workspace_id, {
    kind: "diff",
    title: `Verified fix — ${run.ticket_id}`,
    body: patch,
    contentType: "text/x-diff",
  });
  store.appendEvent(runId, { kind: "artifact", label: "Shipped: verified diff recorded", phase: "executed" });
  store.appendEvent(runId, { kind: "verdict", label: "Run complete", phase: "executed" });
  store.setRunState(runId, "completed");
}

// ---- GitHub coding runs ---------------------------------------------------

function ticketForGithub(run: RunRow, issueTitle?: string, issueBody?: string): Ticket {
  if (run.issue_number && issueTitle) {
    return { id: `issue-${run.issue_number}`, title: issueTitle, body: issueBody ?? run.goal };
  }
  const title = run.goal.split("\n")[0].slice(0, 120);
  return { id: run.ticket_id, title, body: run.context ? `${run.goal}\n\n${run.context}` : run.goal };
}

export async function githubExecute(store: Store, job: JobRow): Promise<void> {
  const runId = job.run_id;
  const run = store.getRun(runId);
  if (!run || !run.repo) throw new Error(`no such github run ${runId}`);
  if (run.state !== "queued" && run.state !== "retrying") return; // idempotent
  if (cancelled(store, runId)) {
    store.setRunState(runId, "cancelled", { reason: "Cancelled before execution." });
    return;
  }

  const gh = getGitHubAdapter(run.github_mode ?? undefined);
  store.updateRun(runId, { github_mode: gh.name });
  store.setRunState(runId, "running");

  const access = await gh.verifyAccess(run.repo);
  if (!access.canRead) {
    store.appendEvent(runId, { kind: "error", label: `No read access to ${run.repo}`, detail: access.reason, phase: "failed" });
    store.setRunState(runId, "failed", { reason: `No read access to ${run.repo}: ${access.reason ?? "unauthorized"}` });
    return;
  }

  let issueTitle: string | undefined;
  let issueBody: string | undefined;
  if (run.issue_number) {
    const issue = await gh.readIssue(run.repo, run.issue_number);
    issueTitle = issue.title;
    issueBody = issue.body;
    store.appendEvent(runId, { kind: "plan", label: `Read issue #${issue.number}: ${issue.title}`, phase: "executed" });
  }
  const ticket = ticketForGithub(run, issueTitle, issueBody);

  store.appendEvent(runId, { kind: "tool", label: `Cloning ${run.repo} (${gh.name} mode)…`, phase: "executed" });
  const checkout = await gh.prepareCheckout(run.repo, runId, run.base_branch ?? undefined);
  store.updateRun(runId, {
    base_branch: checkout.baseBranch,
    head_branch: checkout.headBranch,
    base_sha: checkout.baseSha,
    checkout_dir: checkout.dir,
  });
  store.appendEvent(runId, {
    kind: "tool",
    label: `Checked out ${checkout.baseBranch} @ ${checkout.baseSha.slice(0, 7)} on ${checkout.headBranch}`,
    phase: "executed",
  });

  const decision = await workTicket(checkout.workspace, ticket, {
    provider: run.provider,
    repoKey: run.repo,
    onProgress: (m) => store.appendEvent(runId, { kind: kindFor(m), label: m, phase: "executed" }),
  });

  store.updateRun(runId, {
    steps: decision.steps,
    tool_calls: decision.toolCalls,
    cost_usd: decision.costUsd,
    duration_ms: decision.durationMs,
    model: modelLabel(run.provider),
    baseline_passed: decision.baseline.passed,
    baseline_total: decision.baseline.total,
    final_passed: decision.finalTests.passed,
    final_total: decision.finalTests.total,
  });

  if (cancelled(store, runId)) {
    store.setRunState(runId, "cancelled", { reason: "Cancelled during execution; nothing pushed." });
    return;
  }

  if (decision.status === "approved") {
    store.updateRun(runId, {
      reason: decision.reason,
      confidence_score: decision.confidence.score,
      confidence_level: decision.confidence.level,
      risk_level: decision.risk.level,
      requires_review: decision.requiresReview ? 1 : 0,
    });
    if (run.open_pr === 1) {
      store.appendEvent(runId, {
        kind: "approval_requested",
        label: `Verified fix ready — approval required to open a pull request on ${run.repo}`,
        detail: `confidence ${decision.confidence.score.toFixed(2)} (${decision.confidence.level}), risk ${decision.risk.level}`,
        phase: "requested",
      });
      store.createApproval(runId, run.workspace_id, {
        action: "ship",
        summary: `Open a draft pull request on ${run.repo}${run.issue_number ? ` for #${run.issue_number}` : ""}`,
        preview: decision.patch,
      });
      store.setRunState(runId, "waiting_approval");
    } else {
      // Prepare-only: record the verified diff, no external write.
      store.addArtifact(runId, run.workspace_id, {
        kind: "diff",
        title: `Prepared fix — ${run.repo}`,
        body: decision.patch,
        contentType: "text/x-diff",
      });
      store.appendEvent(runId, { kind: "verdict", label: "Prepared verified diff (no PR requested)", phase: "executed" });
      store.setRunState(runId, "completed");
    }
  } else if (decision.status === "declined") {
    store.appendEvent(runId, { kind: "verdict", label: `Declined: ${decision.reason}`, phase: "executed" });
    store.setRunState(runId, "declined", { reason: decision.reason });
  } else {
    throw new Error(decision.reason || "engine error");
  }
}

export async function githubShip(store: Store, job: JobRow): Promise<void> {
  const runId = job.run_id;
  const run = store.getRun(runId);
  if (!run || !run.repo) throw new Error(`no such github run ${runId}`);
  if (run.state === "completed") return; // idempotent

  const appr = store.latestApproval(runId, "ship");
  if (!appr || appr.status !== "approved") {
    throw new Error(`open-PR refused: no approved decision for run ${runId}`);
  }
  if (cancelled(store, runId)) {
    store.setRunState(runId, "cancelled", { reason: "Cancelled before opening a pull request." });
    return;
  }

  const gh = getGitHubAdapter(run.github_mode ?? undefined);

  // Re-check write permission at ship time — never trust the earlier read.
  const access = await gh.verifyAccess(run.repo);
  if (!access.canWrite) {
    store.appendEvent(runId, { kind: "error", label: `No write access to ${run.repo}`, detail: access.reason, phase: "failed" });
    store.setRunState(runId, "failed", { reason: `No write access to ${run.repo}` });
    return;
  }
  if (!run.head_branch || !run.checkout_dir) {
    throw new Error("missing checkout for ship (execute did not complete)");
  }

  // Reconciliation: if a prior attempt already opened the PR, adopt it instead
  // of pushing again (handles a lost response after push/PR creation).
  const existing = await gh.findOpenPr(run.repo, run.head_branch);
  let pr = existing ?? undefined;

  if (!pr) {
    let title = run.goal.split("\n")[0].slice(0, 120);
    if (run.issue_number) title = (await gh.readIssue(run.repo, run.issue_number)).title;
    const decisionLike = {
      baseline: { passed: run.baseline_passed ?? 0, total: run.baseline_total ?? 0 },
      finalTests: { passed: run.final_passed ?? 0, total: run.final_total ?? 0 },
      confidence: { score: run.confidence_score ?? 0, level: run.confidence_level ?? "low" },
      risk: { level: run.risk_level ?? "low", factors: [] },
      reason: run.reason ?? "",
      requiresReview: run.requires_review === 1,
    } as unknown as Parameters<typeof buildPrBody>[0]["decision"];

    store.appendEvent(runId, { kind: "tool", label: `Pushing ${run.head_branch} to ${run.repo}…`, phase: "executed" });
    pr = await gh.openPullRequest(run.repo, {
      workspace: new Workspace(run.checkout_dir),
      headBranch: run.head_branch,
      baseBranch: run.base_branch ?? "main",
      title,
      body: buildPrBody({
        reference: run.issue_number ? `Closes #${run.issue_number}.` : undefined,
        decision: decisionLike,
        runId,
      }),
      draft: true,
      commitMessage: title,
    });
  } else {
    store.appendEvent(runId, { kind: "retry", label: `Found existing PR #${pr.number}; adopting it`, phase: "recovered" });
  }

  // Independently verify the PR through the GitHub API before claiming success.
  const verified = await gh.verifyPullRequest(run.repo, pr.number);
  store.updateRun(runId, {
    pr_number: verified.number,
    pr_url: verified.url,
    pr_state: verified.state,
    pr_draft: verified.draft ? 1 : 0,
  });
  if (appr.preview) {
    store.addArtifact(runId, run.workspace_id, {
      kind: "diff",
      title: `Verified fix — ${run.repo}`,
      body: appr.preview,
      contentType: "text/x-diff",
    });
  }
  store.addArtifact(runId, run.workspace_id, {
    kind: "pr",
    title: `Draft pull request #${verified.number}`,
    body: verified.url,
    contentType: "text/uri-list",
  });
  store.appendEvent(runId, { kind: "artifact", label: `Opened draft PR #${verified.number}: ${verified.url}`, phase: "executed" });
  store.appendEvent(runId, {
    kind: "verdict",
    label: `Verified via GitHub (${gh.name}): ${verified.state}${verified.draft ? ", draft" : ""}`,
    phase: "executed",
  });
  store.setRunState(runId, "completed");
}

export async function runJob(store: Store, job: JobRow): Promise<void> {
  const run = store.getRun(job.run_id);
  const isGithub = run?.kind === "github";
  if (job.kind === "execute") return isGithub ? githubExecute(store, job) : executeRun(store, job);
  if (job.kind === "ship") return isGithub ? githubShip(store, job) : shipRun(store, job);
  throw new Error(`unknown job kind ${job.kind}`);
}
