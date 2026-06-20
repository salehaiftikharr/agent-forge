import { type RiskAssessment } from "./risk";

/**
 * A calibrated confidence score for a change that has ALREADY passed every gate.
 *
 * The gates are pass/fail; this turns the signals they produced into a single
 * 0..1 number that answers a softer question: "how sure are we this is safe to
 * ship unattended?" It is deliberately derived from MECHANICAL evidence the run
 * already gathered — not a fresh model opinion — so it is deterministic and the
 * same evidence always yields the same number:
 *
 *   - mutation catch ratio  → the strongest signal a test truly pins the fix
 *   - how many tests flipped red→green → more corroboration
 *   - the LLM judge's verdict → a sanity check on intent
 *   - blast radius → a bigger, riskier change earns less unattended trust
 *
 * The point of a number (vs. another yes/no) is calibration: you can look back
 * over the corpus and say "shipped at >0.85, it was right 49 of 50 times," and
 * set the auto-ship threshold from evidence instead of vibes.
 */
export interface ConfidenceSignals {
  /** Tests that went from failing to passing. */
  newPasses: number;
  /** Mutants the now-green test caught, and how many were tried. */
  mutantsCaught: number;
  mutantsTotal: number;
  /** The LLM judge's call on whether the diff genuinely resolves the ticket. */
  judgeResolves: boolean;
  /** Blast-radius score (0..1) from assessRisk. */
  riskScore: number;
}

export interface Confidence {
  score: number;
  level: "high" | "medium" | "low";
}

function levelFor(score: number): Confidence["level"] {
  if (score >= 0.8) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

/**
 * Combine the gate signals into a 0..1 confidence. Starts from a neutral base
 * and moves on evidence; clamped to [0, 1].
 */
export function scoreConfidence(s: ConfidenceSignals): Confidence {
  let score = 0.5;

  // Mutation testing is the load-bearing signal. A full catch is strong
  // corroboration; no mutants to try (e.g. a tiny change) is mildly positive
  // but can't carry the score on its own.
  if (s.mutantsTotal > 0) {
    score += 0.3 * (s.mutantsCaught / s.mutantsTotal);
  } else {
    score += 0.1;
  }

  // More previously-failing tests turned green = more corroboration, with
  // diminishing returns.
  score += Math.min(0.15, s.newPasses * 0.05);

  // The judge is a sanity check on intent, not correctness; reward agreement,
  // penalize a flagged change decisively (in the real flow such a change is
  // declined before it ever reaches scoring — this keeps the score honest).
  score += s.judgeResolves ? 0.1 : -0.45;

  // A larger blast radius should temper how confident we are about shipping it
  // without a human glance.
  score -= 0.25 * s.riskScore;

  score = Math.max(0, Math.min(1, score));
  return { score, level: levelFor(score) };
}

/** Convenience wrapper that takes the RiskAssessment directly. */
export function confidenceFor(
  s: Omit<ConfidenceSignals, "riskScore">,
  risk: RiskAssessment,
): Confidence {
  return scoreConfidence({ ...s, riskScore: risk.score });
}
