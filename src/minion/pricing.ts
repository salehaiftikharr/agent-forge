/**
 * The money side of a minion run. Every gate the project already has answers
 * "is this change safe?"; this answers the question an operator actually asks
 * before turning minions loose: "what does it cost?"
 *
 * We total the tokens a run spends across all of its model calls (plan,
 * implement, judge) and estimate a dollar figure from a per-model price table.
 * The numbers here are ESTIMATES for budgeting, not billing: list prices drift,
 * and this deliberately ignores prompt-caching discounts (so it reads high, not
 * low, which is the safe direction for a budget). Pure and deterministic, so the
 * arithmetic is unit-tested.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/** Read the AI SDK usage object defensively (every field is `number | undefined`). */
export function readUsage(
  u: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined,
): TokenUsage {
  const inputTokens = u?.inputTokens ?? 0;
  const outputTokens = u?.outputTokens ?? 0;
  const totalTokens = u?.totalTokens ?? inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

/** Sum two usages (used to accumulate across a run's model calls). */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

interface Price {
  /** USD per 1M input tokens. */
  inputPerM: number;
  /** USD per 1M output tokens. */
  outputPerM: number;
}

/**
 * Price table in USD per 1M tokens, keyed by the modelLabel() string. Estimates
 * only — adjust here if list prices change. Unknown models fall back to the
 * most expensive tier so a budget is never accidentally understated.
 */
const PRICES: Record<string, Price> = {
  "anthropic/claude-opus-4-8": { inputPerM: 15, outputPerM: 75 },
  "anthropic/claude-sonnet-4-6": { inputPerM: 3, outputPerM: 15 },
  "anthropic/claude-haiku-4-5-20251001": { inputPerM: 1, outputPerM: 5 },
  "openai/gpt-4.1": { inputPerM: 2, outputPerM: 8 },
};

const FALLBACK_PRICE: Price = { inputPerM: 15, outputPerM: 75 };

export function priceFor(modelLabel: string): Price {
  return PRICES[modelLabel] ?? FALLBACK_PRICE;
}

/** Estimate the USD cost of a usage total for a given model, rounded to micro-dollars. */
export function estimateCostUsd(usage: TokenUsage, modelLabel: string): number {
  const price = priceFor(modelLabel);
  const cost =
    (usage.inputTokens / 1_000_000) * price.inputPerM +
    (usage.outputTokens / 1_000_000) * price.outputPerM;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
