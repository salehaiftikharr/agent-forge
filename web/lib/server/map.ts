import type { Run, TimelineEvent, Artifact, TimelineKind, RunState } from "../types";
import type { RunRow, EventRow, ArtifactRow, ApprovalRow } from "./store";

/**
 * Map durable rows to the shared UI contract in web/lib/types.ts, so the same
 * components that render the demo render real, persisted runs — with source
 * "engine", not "demo". Nothing here invents state; every field comes from the
 * database.
 */

export function toEvent(e: EventRow): TimelineEvent {
  return {
    id: `e-${e.id}`,
    at: e.at,
    kind: e.kind as TimelineKind,
    label: e.label,
    detail: e.detail ?? undefined,
    phase: (e.phase as TimelineEvent["phase"]) ?? undefined,
  };
}

export function toArtifact(a: ArtifactRow): Artifact {
  return {
    id: a.id,
    kind: (a.kind as Artifact["kind"]) ?? "note",
    title: a.title,
    body: a.body ?? undefined,
  };
}

export function toRun(row: RunRow, events: EventRow[], artifacts: ArtifactRow[]): Run {
  return {
    id: row.id,
    minionId: row.minion_name,
    minionName: row.minion_name,
    ticket: { id: row.ticket_id, title: row.goal.split("\n")[0], body: row.context ?? undefined },
    state: row.state as RunState,
    model: row.model ?? row.provider,
    startedAt: row.created_at,
    steps: row.steps,
    toolCalls: row.tool_calls,
    baselineTests:
      row.baseline_total != null
        ? { passed: row.baseline_passed ?? 0, total: row.baseline_total }
        : undefined,
    finalTests:
      row.final_total != null
        ? { passed: row.final_passed ?? 0, total: row.final_total }
        : undefined,
    confidence:
      row.confidence_score != null
        ? { score: row.confidence_score, level: row.confidence_level ?? "low" }
        : undefined,
    risk: row.risk_level ? { level: row.risk_level, score: 0, factors: [] } : undefined,
    reason: row.reason ?? undefined,
    costUsd: row.cost_usd ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    requiresReview: row.requires_review === 1,
    timeline: events.map(toEvent),
    artifacts: artifacts.map(toArtifact),
    source: "engine",
    kind: row.kind,
    repo: row.repo ?? undefined,
    issueNumber: row.issue_number ?? undefined,
    baseBranch: row.base_branch ?? undefined,
    headBranch: row.head_branch ?? undefined,
    githubMode: row.github_mode ?? undefined,
    prUrl: row.pr_url ?? undefined,
    prNumber: row.pr_number ?? undefined,
    prState: row.pr_state ?? undefined,
    prDraft: row.pr_draft === 1 ? true : row.pr_draft === 0 ? false : undefined,
    origin: row.origin ?? "web",
  };
}

export interface PendingApprovalView {
  id: string;
  action: string;
  summary: string;
  preview?: string;
}

export function toPendingApproval(a: ApprovalRow | undefined): PendingApprovalView | null {
  if (!a || a.status !== "pending") return null;
  return { id: a.id, action: a.action, summary: a.summary, preview: a.preview ?? undefined };
}
