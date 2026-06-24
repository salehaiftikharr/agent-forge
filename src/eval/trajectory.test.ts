import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, type TrajectoryResult } from "./trajectory";

const result = (over: Partial<TrajectoryResult>): TrajectoryResult => ({
  id: "case",
  agent: "agent",
  rounds: 0,
  startedFailing: false,
  recovered: false,
  converged: true,
  finalPassed: 3,
  finalTotal: 3,
  tokens: 1000,
  ms: 2000,
  ...over,
});

test("summarize computes convergence, recovery, and averages", () => {
  const results: TrajectoryResult[] = [
    result({ converged: true, startedFailing: false, rounds: 0 }), // passed on build
    result({ converged: true, startedFailing: true, recovered: true, rounds: 2 }), // recovered
    result({ converged: false, startedFailing: true, recovered: false, rounds: 3, finalPassed: 2 }), // never converged
  ];
  const s = summarize(results);

  assert.equal(s.total, 3);
  assert.equal(s.converged, 2);
  assert.equal(s.convergenceRate, 2 / 3);
  assert.equal(s.startedFailing, 2);
  assert.equal(s.recovered, 1);
  assert.equal(s.recoveryRate, 1 / 2);
  assert.equal(s.avgRounds, (0 + 2 + 3) / 3);
  assert.equal(s.totalTokens, 3000);
});

test("summarize is safe on an empty result set", () => {
  const s = summarize([]);
  assert.equal(s.total, 0);
  assert.equal(s.convergenceRate, 0);
  assert.equal(s.recoveryRate, 0);
  assert.equal(s.avgRounds, 0);
});
