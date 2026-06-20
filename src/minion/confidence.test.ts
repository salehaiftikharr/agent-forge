import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreConfidence } from "./confidence";

const STRONG = {
  newPasses: 2,
  mutantsCaught: 3,
  mutantsTotal: 3,
  judgeResolves: true,
  riskScore: 0,
};

test("a fully-caught, judge-approved, low-risk fix is high confidence", () => {
  const c = scoreConfidence(STRONG);
  assert.equal(c.level, "high");
  assert.ok(c.score >= 0.8);
});

test("surviving mutants drag confidence down", () => {
  const weak = scoreConfidence({ ...STRONG, mutantsCaught: 0, mutantsTotal: 3 });
  assert.ok(weak.score < scoreConfidence(STRONG).score);
});

test("a judge rejection tanks confidence", () => {
  const c = scoreConfidence({ ...STRONG, judgeResolves: false });
  assert.equal(c.level, "low");
});

test("high blast radius tempers an otherwise strong change", () => {
  const calm = scoreConfidence(STRONG);
  const risky = scoreConfidence({ ...STRONG, riskScore: 1 });
  assert.ok(risky.score < calm.score);
});

test("no mutants to try is mildly positive, not decisive", () => {
  const c = scoreConfidence({ ...STRONG, mutantsCaught: 0, mutantsTotal: 0 });
  assert.ok(c.score > 0.5 && c.score < scoreConfidence(STRONG).score);
});

test("score is always within [0, 1]", () => {
  const worst = scoreConfidence({
    newPasses: 0,
    mutantsCaught: 0,
    mutantsTotal: 5,
    judgeResolves: false,
    riskScore: 1,
  });
  assert.ok(worst.score >= 0 && worst.score <= 1);
});
