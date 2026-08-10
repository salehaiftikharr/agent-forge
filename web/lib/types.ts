/* The one shared model. Marketing, demo, and the app all render these types.
   Two sources feed them: real engine data read from disk (lib/engine-data.ts)
   and the deterministic fictional dataset (lib/fixtures.ts). Components never
   care which source they came from; every surface carries a `source` marker so
   the UI can label engine-backed vs demo data honestly. */

export type DataSource = "engine" | "demo";

export type MinionStatus =
  | "ready"
  | "working"
  | "waiting" // waiting for approval
  | "declined"
  | "failed"
  | "paused"
  | "archived";

export type RunState =
  | "queued"
  | "planning"
  | "running"
  | "waiting_approval"
  | "blocked"
  | "retrying"
  | "failed"
  | "cancelled"
  | "completed" // shipped: a verified fix
  | "declined"; // held back on purpose — a correct refusal

export type ToolPermission = "read" | "write" | "propose";

export interface Tool {
  name: string;
  permission: ToolPermission;
  description: string;
}

export interface Minion {
  id: string;
  name: string;
  role: string;
  purpose: string;
  instructions: string;
  status: MinionStatus;
  tools: Tool[];
  dataAccess: string[];
  repo: string;
  createdAt: string;
  lastActiveAt: string;
  runsCount: number;
  needsAttention?: boolean;
  source: DataSource;
}

export type TimelineKind =
  | "queued"
  | "plan"
  | "tool"
  | "approval_requested"
  | "approval_granted"
  | "approval_rejected"
  | "command"
  | "test"
  | "error"
  | "retry"
  | "artifact"
  | "verdict";

export interface TimelineEvent {
  id: string;
  at: string;
  kind: TimelineKind;
  label: string;
  detail?: string;
  /** For tool events: the enforced permission and duration. */
  permission?: ToolPermission;
  durationMs?: number;
  /** Distinguishes what actually happened from what was only requested/simulated. */
  phase?: "planned" | "requested" | "approved" | "executed" | "failed" | "recovered" | "simulated";
}

export interface TestResult {
  ok?: boolean;
  passed: number;
  failed?: number;
  total: number;
}

export interface Artifact {
  id: string;
  kind: "diff" | "pr" | "file" | "note";
  title: string;
  body?: string;
}

export interface Run {
  id: string;
  minionId: string;
  minionName: string;
  ticket: { id: string; title: string; body?: string };
  state: RunState;
  model: string;
  startedAt: string;
  steps: number;
  toolCalls: number;
  baselineTests?: TestResult;
  finalTests?: TestResult;
  confidence?: { score: number; level: string };
  risk?: { level: string; score: number; factors: string[] };
  reason?: string;
  costUsd?: number;
  durationMs?: number;
  requiresReview?: boolean;
  timeline: TimelineEvent[];
  artifacts: Artifact[];
  source: DataSource;
}

export interface EvalReport {
  model: string;
  total: number;
  correct: number;
  accuracy: number;
  unsafeShips: number;
  shipRecall: { correct: number; total: number };
  declinedCorrectly: { correct: number; total: number };
  cases: {
    id: string;
    title: string;
    expect: "ship" | "decline";
    decision: string;
    correct: boolean;
    unsafe: boolean;
    reason: string;
  }[];
}

export const STATUS_LABEL: Record<MinionStatus, string> = {
  ready: "Ready",
  working: "Working",
  waiting: "Waiting for approval",
  declined: "Declined",
  failed: "Failed",
  paused: "Paused",
  archived: "Archived",
};

export const RUN_STATE_LABEL: Record<RunState, string> = {
  queued: "Queued",
  planning: "Planning",
  running: "Running",
  waiting_approval: "Waiting for approval",
  blocked: "Blocked",
  retrying: "Retrying",
  failed: "Failed",
  cancelled: "Cancelled",
  completed: "Completed",
  declined: "Declined",
};

/** Maps a status/state to its semantic color token (never the accent unless it
    genuinely means "in progress"). */
export function statusToken(s: MinionStatus | RunState): string {
  switch (s) {
    case "ready":
    case "completed":
      return "var(--forge-shipped)";
    case "working":
    case "running":
    case "planning":
    case "queued":
    case "retrying":
      return "var(--forge-running)";
    case "waiting":
    case "waiting_approval":
    case "blocked":
      return "var(--forge-waiting)";
    case "declined":
      return "var(--forge-declined)";
    case "failed":
      return "var(--forge-failed)";
    default:
      return "var(--forge-idle)";
  }
}
