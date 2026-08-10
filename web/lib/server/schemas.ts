import { z } from "zod";

/**
 * Server-side validation for every write. The client is never trusted: inputs
 * are parsed here before they touch the store. Mirrors the engine's
 * src/app/lifecycle.ts schemas.
 */
export const createRunSchema = z.object({
  ticketId: z.string().min(1).max(64),
  goal: z.string().min(3).max(4000),
  context: z.string().max(8000).optional(),
});

export const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(2000).optional(),
});

export const TERMINAL_STATES = new Set(["completed", "declined", "cancelled", "failed"]);
