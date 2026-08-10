import { randomUUID } from "node:crypto";
import type { DB } from "./db";
import { assertTransition, isTerminal, type RunState } from "./lifecycle";

/**
 * Typed data-access for the functional app. All lifecycle and ownership rules
 * live here (and in lifecycle.ts), never in a client. The worker and the web
 * tier both go through a Store, so illegal transitions and non-idempotent
 * effects are impossible to express from the outside.
 */

export const SINGLE_OWNER = "owner-local";

export interface RunRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  ticket_id: string;
  goal: string;
  context: string | null;
  state: RunState;
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
  // GitHub coding runs (kind='github'); null for sandbox runs.
  kind: string;
  repo: string | null;
  issue_number: number | null;
  github_mode: string | null;
  open_pr: number;
  base_branch: string | null;
  head_branch: string | null;
  base_sha: string | null;
  checkout_dir: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pr_state: string | null;
  pr_draft: number | null;
  origin: string;
  slack_channel: string | null;
  slack_thread_ts: string | null;
  slack_user: string | null;
  slack_notified_seq: number;
  slack_notified_state: string | null;
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
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
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

export interface JobRow {
  id: string;
  run_id: string;
  kind: "execute" | "ship";
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  dedupe_key: string | null;
  last_error: string | null;
  available_at: string;
  created_at: string;
  updated_at: string;
}

const now = () => new Date().toISOString();
const id = (p: string) => `${p}-${randomUUID().slice(0, 12)}`;

export class Store {
  constructor(readonly db: DB) {}

  // ---- workspaces --------------------------------------------------------
  ensureWorkspace(
    workspaceId: string,
    opts: { ownerId?: string; name?: string; providerMode?: string } = {},
  ): void {
    const existing = this.db.prepare("SELECT id FROM workspaces WHERE id = ?").get(workspaceId);
    if (existing) return;
    this.db
      .prepare(
        "INSERT INTO workspaces (id, owner_id, name, provider_mode, created_at) VALUES (?,?,?,?,?)",
      )
      .run(
        workspaceId,
        opts.ownerId ?? SINGLE_OWNER,
        opts.name ?? "Default workspace",
        opts.providerMode ?? process.env.LLM_PROVIDER ?? "fake",
        now(),
      );
  }

  // ---- runs --------------------------------------------------------------
  createRun(input: {
    workspaceId: string;
    ownerId?: string;
    ticketId: string;
    goal: string;
    context?: string;
    provider: string;
    minionName: string;
  }): RunRow {
    const runId = id("run");
    const ts = now();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO runs (id, workspace_id, owner_id, ticket_id, goal, context, state, provider, minion_name, created_at, updated_at)
           VALUES (@id,@workspace_id,@owner_id,@ticket_id,@goal,@context,'queued',@provider,@minion_name,@ts,@ts)`,
        )
        .run({
          id: runId,
          workspace_id: input.workspaceId,
          owner_id: input.ownerId ?? SINGLE_OWNER,
          ticket_id: input.ticketId,
          goal: input.goal,
          context: input.context ?? null,
          provider: input.provider,
          minion_name: input.minionName,
          ts,
        });
      this.appendEvent(runId, { kind: "queued", label: "Run queued", detail: input.goal, phase: "planned" });
      this.enqueueJob(runId, "execute");
    });
    tx();
    return this.getRun(runId)!;
  }

  /** Create a GitHub coding run: work a real repo/issue toward a verified PR.
   * The same method serves the web, Slack, and CLI surfaces — only `origin` and
   * the optional Slack thread linkage differ, so the run is one shared record. */
  createGithubRun(input: {
    workspaceId: string;
    ownerId?: string;
    repo: string;
    issueNumber?: number;
    goal: string;
    context?: string;
    provider: string;
    githubMode: string; // fake | real
    openPr: boolean;
    baseBranch?: string;
    minionName?: string;
    origin?: string; // web | slack | cli
    slackChannel?: string;
    slackThreadTs?: string;
    slackUser?: string;
  }): RunRow {
    const runId = id("run");
    const ts = now();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO runs (id, workspace_id, owner_id, ticket_id, goal, context, state, provider,
             minion_name, kind, repo, issue_number, github_mode, open_pr, base_branch,
             origin, slack_channel, slack_thread_ts, slack_user, created_at, updated_at)
           VALUES (@id,@workspace_id,@owner_id,@ticket_id,@goal,@context,'queued',@provider,
             @minion_name,'github',@repo,@issue_number,@github_mode,@open_pr,@base_branch,
             @origin,@slack_channel,@slack_thread_ts,@slack_user,@ts,@ts)`,
        )
        .run({
          id: runId,
          workspace_id: input.workspaceId,
          owner_id: input.ownerId ?? SINGLE_OWNER,
          ticket_id: input.issueNumber ? `issue-${input.issueNumber}` : "task",
          goal: input.goal,
          context: input.context ?? null,
          provider: input.provider,
          minion_name: input.minionName ?? "repo-fixer",
          repo: input.repo,
          issue_number: input.issueNumber ?? null,
          github_mode: input.githubMode,
          open_pr: input.openPr ? 1 : 0,
          base_branch: input.baseBranch ?? null,
          origin: input.origin ?? "web",
          slack_channel: input.slackChannel ?? null,
          slack_thread_ts: input.slackThreadTs ?? null,
          slack_user: input.slackUser ?? null,
          ts,
        });
      this.appendEvent(runId, {
        kind: "queued",
        label: `Queued: ${input.repo}${input.issueNumber ? ` #${input.issueNumber}` : ""}`,
        detail: input.goal,
        phase: "planned",
      });
      this.enqueueJob(runId, "execute");
    });
    tx();
    return this.getRun(runId)!;
  }

  /** Runs linked to a Slack thread — the Slack surface polls these to post
   * milestones without the worker needing any Slack credentials. */
  runsWithSlackThread(): RunRow[] {
    return this.db
      .prepare("SELECT * FROM runs WHERE slack_thread_ts IS NOT NULL ORDER BY created_at")
      .all() as RunRow[];
  }

  findRunByThread(threadTs: string): RunRow | undefined {
    return this.db
      .prepare("SELECT * FROM runs WHERE slack_thread_ts = ? ORDER BY created_at DESC LIMIT 1")
      .get(threadTs) as RunRow | undefined;
  }

  markSlackNotified(runId: string, seq: number, state: string): void {
    this.db
      .prepare("UPDATE runs SET slack_notified_seq = ?, slack_notified_state = ?, updated_at = ? WHERE id = ?")
      .run(seq, state, now(), runId);
  }

  getRun(runId: string): RunRow | undefined {
    return this.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRow | undefined;
  }

  listRuns(workspaceId: string, limit = 100): RunRow[] {
    return this.db
      .prepare("SELECT * FROM runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(workspaceId, limit) as RunRow[];
  }

  /** Move a run to a new state, enforcing the transition and terminal-finality. */
  setRunState(runId: string, to: RunState, fields: Partial<RunRow> = {}): RunRow {
    const run = this.getRun(runId);
    if (!run) throw new Error(`no such run ${runId}`);
    if (isTerminal(run.state) && run.state !== to) {
      throw new Error(`run ${runId} is terminal (${run.state}); refusing ${to}`);
    }
    assertTransition(run.state, to);
    const merged = { ...fields, state: to, updated_at: now() };
    const cols = Object.keys(merged);
    const set = cols.map((c) => `${c} = @${c}`).join(", ");
    this.db.prepare(`UPDATE runs SET ${set} WHERE id = @id`).run({ ...merged, id: runId });
    return this.getRun(runId)!;
  }

  updateRun(runId: string, fields: Partial<RunRow>): void {
    if (Object.keys(fields).length === 0) return;
    const merged = { ...fields, updated_at: now() };
    const set = Object.keys(merged).map((c) => `${c} = @${c}`).join(", ");
    this.db.prepare(`UPDATE runs SET ${set} WHERE id = @id`).run({ ...merged, id: runId });
  }

  // ---- events (append-only ledger) --------------------------------------
  appendEvent(
    runId: string,
    e: { kind: string; label: string; detail?: string; phase?: string },
  ): EventRow {
    const seqRow = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM run_events WHERE run_id = ?")
      .get(runId) as { next: number };
    const info = this.db
      .prepare(
        "INSERT INTO run_events (run_id, seq, at, kind, label, detail, phase) VALUES (?,?,?,?,?,?,?)",
      )
      .run(runId, seqRow.next, now(), e.kind, e.label, e.detail ?? null, e.phase ?? null);
    return this.db.prepare("SELECT * FROM run_events WHERE id = ?").get(info.lastInsertRowid) as EventRow;
  }

  eventsSince(runId: string, afterSeq = 0): EventRow[] {
    return this.db
      .prepare("SELECT * FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq")
      .all(runId, afterSeq) as EventRow[];
  }

  // ---- approvals ---------------------------------------------------------
  createApproval(
    runId: string,
    workspaceId: string,
    a: { action: string; summary: string; preview?: string },
  ): ApprovalRow {
    // Idempotent: the partial unique index guarantees at most one pending row
    // per (run, action). If one already exists, return it unchanged.
    const existing = this.getPendingApproval(runId, a.action);
    if (existing) return existing;
    const aid = id("appr");
    this.db
      .prepare(
        `INSERT INTO approvals (id, run_id, workspace_id, action, summary, preview, status, created_at)
         VALUES (?,?,?,?,?,?, 'pending', ?)`,
      )
      .run(aid, runId, workspaceId, a.action, a.summary, a.preview ?? null, now());
    return this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(aid) as ApprovalRow;
  }

  getPendingApproval(runId: string, action: string): ApprovalRow | undefined {
    return this.db
      .prepare("SELECT * FROM approvals WHERE run_id = ? AND action = ? AND status = 'pending'")
      .get(runId, action) as ApprovalRow | undefined;
  }

  latestApproval(runId: string, action: string): ApprovalRow | undefined {
    return this.db
      .prepare("SELECT * FROM approvals WHERE run_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1")
      .get(runId, action) as ApprovalRow | undefined;
  }

  /**
   * Record a human decision on the pending approval — and ONLY that. It writes
   * the decision row and a decision event; it does NOT transition the run or
   * enqueue work. Turning a decision into execution is the worker's job
   * (reconcile), so the caller of this method — including the web tier — holds
   * no lifecycle authority. Idempotent: a repeated call after the pending row is
   * gone returns the already-decided row with changed:false.
   */
  decideApproval(
    runId: string,
    action: string,
    decision: "approve" | "reject",
    by: string,
  ): { approval: ApprovalRow; changed: boolean } {
    const pending = this.getPendingApproval(runId, action);
    if (!pending) {
      const latest = this.latestApproval(runId, action);
      if (!latest) throw new Error(`no approval to decide for run ${runId}`);
      return { approval: latest, changed: false }; // already decided — idempotent
    }
    const status = decision === "approve" ? "approved" : "rejected";
    const tx = this.db.transaction(() => {
      this.db
        .prepare("UPDATE approvals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?")
        .run(status, by, now(), pending.id);
      this.appendEvent(runId, {
        kind: decision === "approve" ? "approval_granted" : "approval_rejected",
        label: decision === "approve" ? "Approved by the owner" : "Rejected by the owner",
        detail: by,
        phase: decision === "approve" ? "approved" : "executed",
      });
    });
    tx();
    return {
      approval: this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(pending.id) as ApprovalRow,
      changed: true,
    };
  }

  /**
   * Turn decided approvals into state transitions and follow-up work. Called by
   * the worker each tick, so the worker — never the browser — is the sole
   * authority over run lifecycle. Safe to call repeatedly (all effects are
   * idempotent: ship jobs dedupe, same-state transitions are no-ops).
   */
  reconcile(): void {
    const waiting = this.db
      .prepare("SELECT * FROM runs WHERE state = 'waiting_approval'")
      .all() as RunRow[];
    for (const run of waiting) {
      if (run.cancel_requested === 1) {
        this.setRunState(run.id, "cancelled", { reason: "Cancelled at the approval gate." });
        continue;
      }
      const appr = this.latestApproval(run.id, "ship");
      if (!appr) continue;
      if (appr.status === "approved") {
        this.setRunState(run.id, "running", {});
        this.enqueueJob(run.id, "ship");
      } else if (appr.status === "rejected") {
        this.setRunState(run.id, "declined", { reason: "Rejected at the approval gate." });
      }
    }
  }

  // ---- artifacts ---------------------------------------------------------
  addArtifact(
    runId: string,
    workspaceId: string,
    a: { kind: string; title: string; body?: string; contentType?: string },
  ): ArtifactRow {
    const aid = id("art");
    const body = a.body ?? null;
    this.db
      .prepare(
        `INSERT INTO artifacts (id, run_id, workspace_id, kind, title, body, content_type, size_bytes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        aid,
        runId,
        workspaceId,
        a.kind,
        a.title,
        body,
        a.contentType ?? "text/plain",
        body ? Buffer.byteLength(body) : 0,
        now(),
      );
    return this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(aid) as ArtifactRow;
  }

  getArtifacts(runId: string): ArtifactRow[] {
    return this.db
      .prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at")
      .all(runId) as ArtifactRow[];
  }

  // ---- jobs (durable queue with leases) ---------------------------------
  enqueueJob(runId: string, kind: "execute" | "ship"): JobRow | undefined {
    const dedupe = `${runId}:${kind}`;
    const existing = this.db.prepare("SELECT * FROM jobs WHERE dedupe_key = ?").get(dedupe) as JobRow | undefined;
    if (existing) return existing; // idempotent enqueue
    const jid = id("job");
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO jobs (id, run_id, kind, status, dedupe_key, available_at, created_at, updated_at)
         VALUES (?,?,?, 'queued', ?, ?, ?, ?)`,
      )
      .run(jid, runId, kind, dedupe, ts, ts, ts);
    return this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(jid) as JobRow;
  }

  /** Atomically claim one runnable job with a lease. Returns null if none. */
  claimJob(owner: string, leaseMs = 60_000): JobRow | null {
    const claim = this.db.transaction((): JobRow | null => {
      const nowIso = now();
      const job = this.db
        .prepare(
          "SELECT * FROM jobs WHERE status = 'queued' AND available_at <= ? ORDER BY created_at LIMIT 1",
        )
        .get(nowIso) as JobRow | undefined;
      if (!job) return null;
      const leaseIso = new Date(Date.now() + leaseMs).toISOString();
      this.db
        .prepare(
          "UPDATE jobs SET status = 'running', lease_owner = ?, lease_expires_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'",
        )
        .run(owner, leaseIso, nowIso, job.id);
      return this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(job.id) as JobRow;
    });
    return claim.immediate();
  }

  heartbeatJob(jobId: string, owner: string, leaseMs = 60_000): boolean {
    const leaseIso = new Date(Date.now() + leaseMs).toISOString();
    const info = this.db
      .prepare(
        "UPDATE jobs SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND lease_owner = ? AND status = 'running'",
      )
      .run(leaseIso, now(), jobId, owner);
    return info.changes > 0;
  }

  finishJob(jobId: string, status: "done" | "failed", error?: string): void {
    this.db
      .prepare("UPDATE jobs SET status = ?, last_error = ?, lease_owner = NULL, updated_at = ? WHERE id = ?")
      .run(status, error ?? null, now(), jobId);
  }

  /** Return a failed-but-eligible job to the queue after a backoff delay. */
  retryJob(jobId: string, error: string, backoffMs: number): void {
    const availIso = new Date(Date.now() + backoffMs).toISOString();
    this.db
      .prepare(
        "UPDATE jobs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL, last_error = ?, available_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(error, availIso, now(), jobId);
  }

  getJob(jobId: string): JobRow | undefined {
    return this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRow | undefined;
  }

  /** Recover jobs whose worker died: an expired running lease returns to the
   * queue, or fails permanently once attempts are exhausted. */
  requeueExpired(): number {
    const nowIso = now();
    const expired = this.db
      .prepare("SELECT * FROM jobs WHERE status = 'running' AND lease_expires_at < ?")
      .all(nowIso) as JobRow[];
    for (const job of expired) {
      if (job.attempts >= job.max_attempts) {
        this.db.prepare("UPDATE jobs SET status = 'failed', last_error = 'lease expired; attempts exhausted', updated_at = ? WHERE id = ?").run(nowIso, job.id);
        const run = this.getRun(job.run_id);
        if (run && !isTerminal(run.state)) {
          this.setRunState(job.run_id, "failed", { reason: "Worker lost mid-run and retries were exhausted." });
        }
      } else {
        this.db.prepare("UPDATE jobs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?").run(nowIso, job.id);
      }
    }
    return expired.length;
  }

  requestCancel(runId: string): RunRow | undefined {
    const run = this.getRun(runId);
    if (!run || isTerminal(run.state)) return run;
    // Cooperative: cancellable immediately when not mid-execution.
    if (run.state === "queued" || run.state === "waiting_approval" || run.state === "blocked") {
      this.appendEvent(runId, { kind: "verdict", label: "Run cancelled", phase: "executed" });
      return this.setRunState(runId, "cancelled", { reason: "Cancelled by request." });
    }
    // Mid-execution: set the cooperative flag; the worker honors it at the next
    // boundary (it cannot interrupt a model call already in flight).
    this.db.prepare("UPDATE runs SET cancel_requested = 1, updated_at = ? WHERE id = ?").run(now(), runId);
    this.appendEvent(runId, { kind: "verdict", label: "Cancellation requested", phase: "requested" });
    return this.getRun(runId);
  }

  health(): { runs: number; queuedJobs: number; runningJobs: number; pendingApprovals: number } {
    const one = (sql: string, ...p: unknown[]) =>
      (this.db.prepare(sql).get(...p) as { n: number }).n;
    return {
      runs: one("SELECT COUNT(*) n FROM runs"),
      queuedJobs: one("SELECT COUNT(*) n FROM jobs WHERE status = 'queued'"),
      runningJobs: one("SELECT COUNT(*) n FROM jobs WHERE status = 'running'"),
      pendingApprovals: one("SELECT COUNT(*) n FROM approvals WHERE status = 'pending'"),
    };
  }
}
