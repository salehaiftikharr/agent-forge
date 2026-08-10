import { randomUUID } from "node:crypto";
import { getDb } from "./db";

/**
 * Web-tier data access. It mirrors the engine store's column layout but is
 * deliberately authority-free: it only INSERTs new work (runs, jobs, events),
 * records approval decisions, and reads. It never transitions a run's state —
 * the worker's reconcile/orchestrator owns that — so a browser request can never
 * move a run through its lifecycle directly. Kept intentionally small and
 * parallel to src/app/store.ts to minimize drift.
 */

export const SINGLE_OWNER = "owner-local";
export const DEFAULT_WORKSPACE = "ws-default";

export interface RunRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  ticket_id: string;
  goal: string;
  context: string | null;
  state: string;
  provider: string;
  model: string | null;
  minion_name: string;
  reason: string | null;
  confidence_score: number | null;
  confidence_level: string | null;
  risk_level: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  steps: number;
  tool_calls: number;
  baseline_passed: number | null;
  baseline_total: number | null;
  final_passed: number | null;
  final_total: number | null;
  requires_review: number;
  cancel_requested: number;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: number;
  run_id: string;
  seq: number;
  at: string;
  kind: string;
  label: string;
  detail: string | null;
  phase: string | null;
}

export interface ApprovalRow {
  id: string;
  run_id: string;
  workspace_id: string;
  action: string;
  summary: string;
  preview: string | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface ArtifactRow {
  id: string;
  run_id: string;
  workspace_id: string;
  kind: string;
  title: string;
  body: string | null;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

const now = () => new Date().toISOString();
const mkid = (p: string) => `${p}-${randomUUID().slice(0, 12)}`;

export function ensureWorkspace(id = DEFAULT_WORKSPACE): void {
  const db = getDb();
  if (db.prepare("SELECT id FROM workspaces WHERE id = ?").get(id)) return;
  db.prepare(
    "INSERT INTO workspaces (id, owner_id, name, provider_mode, created_at) VALUES (?,?,?,?,?)",
  ).run(id, SINGLE_OWNER, "Default workspace", process.env.LLM_PROVIDER ?? "fake", now());
}

export function providerMode(): string {
  return (process.env.LLM_PROVIDER || "fake").toLowerCase();
}

export function createRun(input: {
  ticketId: string;
  goal: string;
  context?: string;
  minionName?: string;
  workspaceId?: string;
}): RunRow {
  const db = getDb();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE;
  ensureWorkspace(workspaceId);
  const runId = mkid("run");
  const ts = now();
  const provider = providerMode();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO runs (id, workspace_id, owner_id, ticket_id, goal, context, state, provider, minion_name, created_at, updated_at)
       VALUES (@id,@workspace_id,@owner_id,@ticket_id,@goal,@context,'queued',@provider,@minion_name,@ts,@ts)`,
    ).run({
      id: runId,
      workspace_id: workspaceId,
      owner_id: SINGLE_OWNER,
      ticket_id: input.ticketId,
      goal: input.goal,
      context: input.context ?? null,
      provider,
      minion_name: input.minionName ?? "repo-fixer",
      ts,
    });
    db.prepare(
      "INSERT INTO run_events (run_id, seq, at, kind, label, detail, phase) VALUES (?,1,?,?,?,?,?)",
    ).run(runId, ts, "queued", "Run queued", input.goal, "planned");
    db.prepare(
      `INSERT INTO jobs (id, run_id, kind, status, dedupe_key, available_at, created_at, updated_at)
       VALUES (?,?, 'execute', 'queued', ?, ?, ?, ?)`,
    ).run(mkid("job"), runId, `${runId}:execute`, ts, ts, ts);
  });
  tx();
  return getRun(runId)!;
}

export function listRuns(workspaceId = DEFAULT_WORKSPACE, limit = 100): RunRow[] {
  return getDb()
    .prepare("SELECT * FROM runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(workspaceId, limit) as RunRow[];
}

export function getRun(runId: string): RunRow | undefined {
  return getDb().prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRow | undefined;
}

export function eventsSince(runId: string, afterSeq = 0): EventRow[] {
  return getDb()
    .prepare("SELECT * FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq")
    .all(runId, afterSeq) as EventRow[];
}

export function getArtifacts(runId: string): ArtifactRow[] {
  return getDb()
    .prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at")
    .all(runId) as ArtifactRow[];
}

export function pendingApproval(runId: string, action = "ship"): ApprovalRow | undefined {
  return getDb()
    .prepare("SELECT * FROM approvals WHERE run_id = ? AND action = ? AND status = 'pending'")
    .get(runId, action) as ApprovalRow | undefined;
}

export function latestApproval(runId: string, action = "ship"): ApprovalRow | undefined {
  return getDb()
    .prepare("SELECT * FROM approvals WHERE run_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1")
    .get(runId, action) as ApprovalRow | undefined;
}

/** Record a decision only — no transition. Idempotent. Returns whether it changed. */
export function decideApproval(
  runId: string,
  decision: "approve" | "reject",
  by = SINGLE_OWNER,
  action = "ship",
): { changed: boolean; status: string } {
  const db = getDb();
  const pending = pendingApproval(runId, action);
  if (!pending) {
    const latest = latestApproval(runId, action);
    return { changed: false, status: latest?.status ?? "none" };
  }
  const status = decision === "approve" ? "approved" : "rejected";
  const seqRow = db
    .prepare("SELECT COALESCE(MAX(seq),0)+1 AS n FROM run_events WHERE run_id = ?")
    .get(runId) as { n: number };
  const tx = db.transaction(() => {
    db.prepare("UPDATE approvals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?").run(
      status,
      by,
      now(),
      pending.id,
    );
    db.prepare(
      "INSERT INTO run_events (run_id, seq, at, kind, label, detail, phase) VALUES (?,?,?,?,?,?,?)",
    ).run(
      runId,
      seqRow.n,
      now(),
      decision === "approve" ? "approval_granted" : "approval_rejected",
      decision === "approve" ? "Approved by the owner" : "Rejected by the owner",
      by,
      decision === "approve" ? "approved" : "executed",
    );
  });
  tx();
  return { changed: true, status };
}

/** Request cancellation. Authority-free: sets the cooperative flag; the worker
 * performs the actual cancellation at its next boundary. */
export function requestCancel(runId: string): RunRow | undefined {
  const db = getDb();
  const run = getRun(runId);
  if (!run) return undefined;
  const seqRow = db
    .prepare("SELECT COALESCE(MAX(seq),0)+1 AS n FROM run_events WHERE run_id = ?")
    .get(runId) as { n: number };
  const tx = db.transaction(() => {
    db.prepare("UPDATE runs SET cancel_requested = 1, updated_at = ? WHERE id = ?").run(now(), runId);
    db.prepare(
      "INSERT INTO run_events (run_id, seq, at, kind, label, detail, phase) VALUES (?,?,?,?,?,?,?)",
    ).run(runId, seqRow.n, now(), "verdict", "Cancellation requested", null, "requested");
  });
  tx();
  return getRun(runId);
}

export function health(): {
  ok: boolean;
  provider: string;
  runs: number;
  queuedJobs: number;
  runningJobs: number;
  pendingApprovals: number;
} {
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    ok: true,
    provider: providerMode(),
    runs: one("SELECT COUNT(*) n FROM runs"),
    queuedJobs: one("SELECT COUNT(*) n FROM jobs WHERE status='queued'"),
    runningJobs: one("SELECT COUNT(*) n FROM jobs WHERE status='running'"),
    pendingApprovals: one("SELECT COUNT(*) n FROM approvals WHERE status='pending'"),
  };
}
