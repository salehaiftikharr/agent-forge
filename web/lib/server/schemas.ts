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

export const createGithubTaskSchema = z.object({
  repo: z.string().min(3).max(200), // "owner/name" or a github.com URL
  issueNumber: z.number().int().positive().optional(),
  goal: z.string().min(3).max(4000),
  openPr: z.boolean().optional().default(true),
  baseBranch: z.string().max(100).optional(),
});

/** Normalize a repo input (owner/name or a github URL) → {repo, issueNumber?}. */
export function normalizeRepo(
  input: string,
): { repo: string; issueNumber?: number } | null {
  const url = input.match(
    /github\.com\/([A-Za-z0-9][\w.-]*)\/([A-Za-z0-9][\w.-]*?)(?:\.git)?(?:\/(?:issues|pull)\/(\d+))?(?:[/?#]|$)/i,
  );
  if (url) {
    return { repo: `${url[1]}/${url[2]}`, issueNumber: url[3] ? Number(url[3]) : undefined };
  }
  const m = input.trim().match(/^([A-Za-z0-9][\w.-]*)\/([A-Za-z0-9][\w.-]*)$/);
  return m ? { repo: `${m[1]}/${m[2]}` } : null;
}

export const TERMINAL_STATES = new Set(["completed", "declined", "cancelled", "failed"]);
