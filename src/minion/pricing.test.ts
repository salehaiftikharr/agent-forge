import { test } from "node:test";
import assert from "node:assert/strict";
import { readUsage, addUsage, estimateCostUsd, ZERO_USAGE } from "./pricing";

test("readUsage fills missing fields and derives total", () => {
  assert.deepEqual(readUsage(undefined), ZERO_USAGE);
  assert.deepEqual(readUsage({ inputTokens: 100, outputTokens: 20 }), {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
  });
  // An explicit total is trusted over the sum.
  assert.equal(readUsage({ inputTokens: 1, outputTokens: 1, totalTokens: 9 }).totalTokens, 9);
});

test("addUsage sums field by field", () => {
  const sum = addUsage(
    { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    { inputTokens: 3, outputTokens: 7, totalTokens: 10 },
  );
  assert.deepEqual(sum, { inputTokens: 13, outputTokens: 12, totalTokens: 25 });
});

test("estimateCostUsd prices input and output separately", () => {
  // Opus table: $15/M in, $75/M out. 1M in + 1M out = 15 + 75 = $90.
  const cost = estimateCostUsd(
    { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 },
    "anthropic/claude-opus-4-8",
  );
  assert.equal(cost, 90);
});

test("estimateCostUsd uses the model's own rate", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 };
  assert.equal(estimateCostUsd(usage, "anthropic/claude-sonnet-4-6"), 3);
  assert.equal(estimateCostUsd(usage, "anthropic/claude-haiku-4-5-20251001"), 1);
});

test("an unknown model falls back to the most expensive tier (never understate a budget)", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 };
  assert.equal(estimateCostUsd(usage, "anthropic/some-future-model"), 15);
});

test("zero usage costs nothing", () => {
  assert.equal(estimateCostUsd(ZERO_USAGE, "anthropic/claude-opus-4-8"), 0);
});
