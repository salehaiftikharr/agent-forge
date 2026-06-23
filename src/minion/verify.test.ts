import { test } from "node:test";
import assert from "node:assert/strict";
import { survivesPanel, panelSize, type AdversaryVerdict } from "./verify";

const refute = (reason = "flaw"): AdversaryVerdict => ({ refuted: true, reason });
const clear = (reason = "looks correct"): AdversaryVerdict => ({ refuted: false, reason });

test("an empty panel (disabled) always survives", () => {
  assert.equal(survivesPanel([]), true);
});

test("survives when fewer than half refute", () => {
  assert.equal(survivesPanel([refute(), clear(), clear()]), true); // 1 of 3
});

test("refuted when a majority refute", () => {
  assert.equal(survivesPanel([refute(), refute(), clear()]), false); // 2 of 3
});

test("a tie errs toward rejection (skeptical gate)", () => {
  assert.equal(survivesPanel([refute(), clear()]), false); // 1 of 2 is not a strict minority
});

test("a unanimous clear survives; a unanimous refute does not", () => {
  assert.equal(survivesPanel([clear(), clear(), clear()]), true);
  assert.equal(survivesPanel([refute(), refute(), refute()]), false);
});

test("panelSize reads MINION_VERIFIERS, defaults off, and caps at 5", () => {
  const prev = process.env.MINION_VERIFIERS;
  try {
    delete process.env.MINION_VERIFIERS;
    assert.equal(panelSize(), 0);
    process.env.MINION_VERIFIERS = "3";
    assert.equal(panelSize(), 3);
    process.env.MINION_VERIFIERS = "99";
    assert.equal(panelSize(), 5);
    process.env.MINION_VERIFIERS = "0";
    assert.equal(panelSize(), 0);
    process.env.MINION_VERIFIERS = "-2";
    assert.equal(panelSize(), 0);
  } finally {
    if (prev === undefined) delete process.env.MINION_VERIFIERS;
    else process.env.MINION_VERIFIERS = prev;
  }
});
