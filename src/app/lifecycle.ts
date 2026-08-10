import { z } from "zod";

/**
 * Run lifecycle. The states mirror web/lib/types.ts RunState so the API and UI
 * share one vocabulary. Transitions are enforced HERE (and re-checked in the
 * store) rather than trusted to any client. The application deliberately gates
 * every ship behind an approval — the narrowest authority — so waiting_approval
 * is always on the path from a verified fix to a completed run.
 */
export const RUN_STATES = [
  "queued",
  "planning",
  "running",
  "waiting_approval",
  "blocked",
  "retrying",
  "failed",
  "cancelled",
  "completed",
  "declined",
] as const;
export type RunState = (typeof RUN_STATES)[number];

export const TERMINAL_STATES: ReadonlySet<RunState> = new Set([
  "completed",
  "declined",
  "cancelled",
  "failed",
]);

const TRANSITIONS: Record<RunState, RunState[]> = {
  queued: ["running", "cancelled"],
  planning: ["running", "waiting_approval", "declined", "failed", "cancelled"],
  running: ["waiting_approval", "completed", "declined", "failed", "cancelled", "retrying"],
  waiting_approval: ["running", "declined", "cancelled", "failed"],
  blocked: ["running", "cancelled", "failed"],
  retrying: ["running", "failed", "cancelled"],
  failed: ["retrying"], // a failed run may be retried where eligible
  cancelled: [],
  completed: [],
  declined: [],
};

export function canTransition(from: RunState, to: RunState): boolean {
  if (from === to) return true; // idempotent re-assertion of the same state
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal run transition: ${from} -> ${to}`);
  }
}

export function isTerminal(state: RunState): boolean {
  return TERMINAL_STATES.has(state);
}

// ---- API input schemas (validated server-side) ---------------------------

export const createRunSchema = z.object({
  ticketId: z.string().min(1).max(64),
  goal: z.string().min(3).max(4000),
  context: z.string().max(8000).optional(),
});
export type CreateRunInput = z.infer<typeof createRunSchema>;

export const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(2000).optional(),
});
export type DecisionInput = z.infer<typeof decisionSchema>;
