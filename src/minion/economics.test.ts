import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeRuns, type RunRecord } from "./economics";

const u = (total: number) => ({ inputTokens: total, outputTokens: 0, totalTokens: total });

const RUNS: RunRecord[] = [
  { status: "shipped", costUsd: 0.5, usage: u(1000), durationMs: 20_000 },
  { status: "shipped", costUsd: 1.5, usage: u(3000), durationMs: 40_000 },
  { status: "declined", costUsd: 0.4, usage: u(800), durationMs: 10_000 },
  { status: "error", costUsd: 0.1, usage: u(200), durationMs: 5_000 },
];

test("counts outcomes and ship rate", () => {
  const s = summarizeRuns(RUNS);
  assert.equal(s.runs, 4);
  assert.equal(s.shipped, 2);
  assert.equal(s.declined, 1);
  assert.equal(s.errored, 1);
  assert.equal(s.shipRate, 0.5);
});

test("totals cost, tokens, and time across all runs including declines", () => {
  const s = summarizeRuns(RUNS);
  assert.equal(s.totalCostUsd, 2.5);
  assert.equal(s.totalTokens, 5000);
  assert.equal(s.totalDurationMs, 75_000);
});

test("cost per shipped PR divides total spend by ships, not by runs", () => {
  const s = summarizeRuns(RUNS);
  // All spend ($2.5) over 2 shipped PRs = $1.25 each.
  assert.equal(s.costPerShippedUsd, 1.25);
  assert.equal(s.avgCostPerRunUsd, 0.625);
});

test("cost per shipped PR is null when nothing shipped", () => {
  const s = summarizeRuns([{ status: "declined", costUsd: 0.4 }]);
  assert.equal(s.costPerShippedUsd, null);
});

test("missing economics fields are treated as zero", () => {
  const s = summarizeRuns([{ status: "shipped" }, { status: "declined" }]);
  assert.equal(s.totalCostUsd, 0);
  assert.equal(s.totalTokens, 0);
  assert.equal(s.costPerShippedUsd, 0);
});

test("an empty set summarizes to zeros, not NaN", () => {
  const s = summarizeRuns([]);
  assert.equal(s.runs, 0);
  assert.equal(s.shipRate, 0);
  assert.equal(s.avgCostPerRunUsd, 0);
  assert.equal(s.costPerShippedUsd, null);
});
