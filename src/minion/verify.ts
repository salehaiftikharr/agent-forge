import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "../model";
import { readUsage, addUsage, ZERO_USAGE, type TokenUsage } from "./pricing";
import type { Ticket } from "./minion";

/**
 * Adversarial verification — an optional extra-rigor gate that sits above the
 * single LLM judge. The judge asks one reviewer "is this a legitimate fix?";
 * this convenes a PANEL of independent skeptics, each told to REFUTE the change,
 * each looking through a different lens (wrong edge cases, superficial/gamed,
 * quietly breaks something else). A change survives only if it beats a majority.
 *
 * The point is independence and adversarial framing: one approving reviewer can
 * miss a flaw a determined skeptic would catch, and several skeptics looking for
 * *different* failure modes catch more than several looking for the same one.
 * The voting math is pure, so it is unit-tested; the panel itself is opt-in via
 * MINION_VERIFIERS (default off) because it spends extra tokens per run.
 */
export interface AdversaryVerdict {
  refuted: boolean;
  reason: string;
}

const verdictSchema = z.object({
  refuted: z
    .boolean()
    .describe("True only if you found a concrete, specific reason the change is wrong, incomplete, or gamed."),
  reason: z.string().describe("One sentence: the specific flaw you found, or why you could not refute it."),
});

/** Distinct adversarial lenses, cycled across the panel so skeptics differ. */
const LENSES = [
  "Find a concrete input or edge case where this change returns a wrong or surprising result.",
  "Decide whether the change only satisfies the test superficially — hard-coded, pattern-matched, or narrowed to the asserted case — rather than implementing the real behavior.",
  "Check whether the change quietly breaks, weakens, or regresses existing behavior the ticket did not mention.",
];

const SYSTEM =
  "You are a skeptical senior engineer reviewing a code change that already passes every test. Your job is to REFUTE it: find a concrete, specific reason it is wrong, incomplete, or only superficially satisfies the tests. Do not raise vague worries — only refute when you can name a real flaw. If you genuinely cannot, say so.";

/**
 * Run `n` independent adversarial reviewers over the change, each with a
 * (cycled) distinct lens. Returns their verdicts plus the tokens they spent.
 */
export async function redTeam(
  ticket: Ticket,
  patch: string,
  provider: string | undefined,
  n: number,
): Promise<{ verdicts: AdversaryVerdict[]; usage: TokenUsage }> {
  const tasks = Array.from({ length: n }, (_, i) =>
    generateObject({
      model: getModel(provider),
      schema: verdictSchema,
      system: SYSTEM,
      prompt: `Ticket: ${ticket.title}\n${ticket.body}\n\nDiff:\n${patch || "(no changes)"}\n\nAdversarial focus: ${LENSES[i % LENSES.length]}\n\nCan you refute this change?`,
    }),
  );
  const results = await Promise.all(tasks);
  let usage = ZERO_USAGE;
  for (const r of results) usage = addUsage(usage, readUsage(r.usage));
  return { verdicts: results.map((r) => r.object as AdversaryVerdict), usage };
}

/**
 * A change survives the panel only if STRICTLY FEWER than half the reviewers
 * refute it. An empty panel (feature disabled) always survives. Erring toward
 * rejection on a tie is intentional — this is the skeptical gate.
 */
export function survivesPanel(verdicts: AdversaryVerdict[]): boolean {
  if (verdicts.length === 0) return true;
  const refutals = verdicts.filter((v) => v.refuted).length;
  return refutals * 2 < verdicts.length;
}

/** Panel size from MINION_VERIFIERS (0 = disabled, the default), capped at 5. */
export function panelSize(): number {
  const v = Number(process.env.MINION_VERIFIERS);
  return Number.isFinite(v) && v > 0 ? Math.min(5, Math.floor(v)) : 0;
}
