import { type TokenUsage } from "./pricing";

/**
 * Roll a pile of run receipts up into the numbers an operator cares about:
 * how often minions ship, what the work costs, and — the one that matters most —
 * the cost per PR that actually shipped. A run that declines still spent tokens,
 * so declines are counted in the spend, not hidden. Pure: same receipts in, same
 * summary out, so the aggregation is unit-tested.
 */
export interface RunRecord {
  status: "shipped" | "declined" | "error";
  costUsd?: number;
  usage?: TokenUsage;
  durationMs?: number;
}

export interface RunSummary {
  runs: number;
  shipped: number;
  declined: number;
  errored: number;
  /** shipped / runs, 0..1. */
  shipRate: number;
  totalCostUsd: number;
  totalTokens: number;
  totalDurationMs: number;
  avgCostPerRunUsd: number;
  /** totalCost / shipped — what each shipped PR actually cost. Null if none shipped. */
  costPerShippedUsd: number | null;
  avgDurationMs: number;
}

const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

export function summarizeRuns(records: RunRecord[]): RunSummary {
  const runs = records.length;
  const shipped = records.filter((r) => r.status === "shipped").length;
  const declined = records.filter((r) => r.status === "declined").length;
  const errored = records.filter((r) => r.status === "error").length;

  const totalCostUsd = round(records.reduce((sum, r) => sum + (r.costUsd ?? 0), 0));
  const totalTokens = records.reduce((sum, r) => sum + (r.usage?.totalTokens ?? 0), 0);
  const totalDurationMs = records.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);

  return {
    runs,
    shipped,
    declined,
    errored,
    shipRate: runs ? round(shipped / runs) : 0,
    totalCostUsd,
    totalTokens,
    totalDurationMs,
    avgCostPerRunUsd: runs ? round(totalCostUsd / runs) : 0,
    costPerShippedUsd: shipped ? round(totalCostUsd / shipped) : null,
    avgDurationMs: runs ? Math.round(totalDurationMs / runs) : 0,
  };
}
