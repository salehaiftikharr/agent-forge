import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { prepareWorkspace } from "../minion/workspace";
import { workTicket, type Ticket } from "../minion/minion";
import { modelLabel } from "../model";
import type { Store, JobRow } from "./store";

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

export async function runJob(store: Store, job: JobRow): Promise<void> {
  if (job.kind === "execute") return executeRun(store, job);
  if (job.kind === "ship") return shipRun(store, job);
  throw new Error(`unknown job kind ${job.kind}`);
}
