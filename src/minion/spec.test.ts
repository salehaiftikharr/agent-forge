import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSpec } from "./spec";
import type { TestResult } from "./workspace";

function tr(opts: { tests?: Record<string, boolean>; ok?: boolean; perTest?: boolean }): TestResult {
  const tests = opts.tests ?? {};
  const vals = Object.values(tests);
  const passed = vals.filter(Boolean).length;
  return {
    tests,
    passed,
    failed: vals.length - passed,
    total: vals.length,
    ok: opts.ok ?? (vals.length > 0 && passed === vals.length),
    output: "",
    perTest: opts.perTest ?? true,
  };
}

test("a new failing test counts as a valid reproduction (per-test)", () => {
  const r = evaluateSpec(tr({ tests: { a: true } }), tr({ tests: { a: true, "clamp repro": false } }));
  assert.equal(r.status, "authored");
  assert.deepEqual(r.failingTests, ["clamp repro"]);
});

test("a new test that already passes is rejected", () => {
  const r = evaluateSpec(tr({ tests: { a: true } }), tr({ tests: { a: true, added: true } }));
  assert.equal(r.status, "rejected");
});

test("no new test is rejected", () => {
  const r = evaluateSpec(tr({ tests: { a: true } }), tr({ tests: { a: true } }));
  assert.equal(r.status, "rejected");
});

test("exit-code mode: green suite flipping to red is a valid reproduction", () => {
  const r = evaluateSpec(tr({ ok: true, perTest: false }), tr({ ok: false, perTest: false }));
  assert.equal(r.status, "authored");
});

test("exit-code mode: a still-green suite is rejected", () => {
  const r = evaluateSpec(tr({ ok: true, perTest: false }), tr({ ok: true, perTest: false }));
  assert.equal(r.status, "rejected");
});
