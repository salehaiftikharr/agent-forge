import { test } from "node:test";
import assert from "node:assert/strict";
import { selectWinner, type Decision } from "./minion";

const baseTests = { ok: true, passed: 1, failed: 0, total: 1, output: "", tests: {}, perTest: false };
const baseEconomics = {
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  costUsd: 0,
  durationMs: 0,
};

/** A minimal approved Decision with the fields selectWinner ranks on. */
function approved(opts: {
  confidence: number;
  riskScore?: number;
  patchLen?: number;
  reason?: string;
}): Decision {
  return {
    status: "approved",
    reason: opts.reason ?? "ok",
    patch: "x".repeat(opts.patchLen ?? 100),
    baseline: baseTests,
    finalTests: baseTests,
    steps: 0,
    toolCalls: 0,
    confidence: { score: opts.confidence, level: "high" },
    risk: { level: "low", score: opts.riskScore ?? 0, factors: [], filesChanged: 1, linesAdded: 1, linesRemoved: 0 },
    requiresReview: false,
    ...baseEconomics,
  };
}

function declined(reason = "no"): Decision {
  return {
    status: "declined",
    reason,
    patch: "",
    baseline: baseTests,
    finalTests: baseTests,
    steps: 0,
    toolCalls: 0,
    confidence: { score: 0, level: "low" },
    risk: { level: "low", score: 0, factors: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0 },
    requiresReview: false,
    ...baseEconomics,
  };
}

test("picks the highest-confidence approved candidate", () => {
  const winner = selectWinner([
    approved({ confidence: 0.72, reason: "a" }),
    approved({ confidence: 0.94, reason: "b" }),
    approved({ confidence: 0.81, reason: "c" }),
  ]);
  assert.equal(winner.reason, "b");
});

test("ties on confidence break toward lower blast radius", () => {
  const winner = selectWinner([
    approved({ confidence: 0.9, riskScore: 0.4, reason: "risky" }),
    approved({ confidence: 0.9, riskScore: 0.1, reason: "calm" }),
  ]);
  assert.equal(winner.reason, "calm");
});

test("ties on confidence and risk break toward the smaller diff", () => {
  const winner = selectWinner([
    approved({ confidence: 0.9, riskScore: 0.1, patchLen: 500, reason: "big" }),
    approved({ confidence: 0.9, riskScore: 0.1, patchLen: 80, reason: "small" }),
  ]);
  assert.equal(winner.reason, "small");
});

test("an approved candidate always beats declined ones", () => {
  const winner = selectWinner([declined(), approved({ confidence: 0.6, reason: "win" }), declined()]);
  assert.equal(winner.reason, "win");
});

test("with no approvals, returns a declined (not an error) candidate", () => {
  const err: Decision = { ...declined(), status: "error", reason: "boom" };
  const winner = selectWinner([err, declined("informative")]);
  assert.equal(winner.status, "declined");
  assert.equal(winner.reason, "informative");
});
