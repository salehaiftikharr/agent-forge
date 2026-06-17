import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeProfile } from "./profile";

test("mergeProfile records a fresh profile", () => {
  const p = mergeProfile("o/r", null, {
    testCommand: "node:test",
    files: ["a", "b"],
    touched: ["src/x.js"],
  });
  assert.equal(p.repo, "o/r");
  assert.equal(p.testCommand, "node:test");
  assert.deepEqual(p.files, ["a", "b"]);
  assert.deepEqual(p.hotFiles, ["src/x.js"]);
});

test("mergeProfile pushes newly-touched files to the front, deduped", () => {
  const prev = mergeProfile("o/r", null, { touched: ["src/x.js"] });
  const next = mergeProfile("o/r", prev, { touched: ["src/y.js", "src/x.js"] });
  assert.deepEqual(next.hotFiles, ["src/y.js", "src/x.js"]);
});

test("mergeProfile falls back to previous testCommand/files when not updated", () => {
  const prev = mergeProfile("o/r", null, { testCommand: "vitest", files: ["a"], touched: [] });
  const next = mergeProfile("o/r", prev, { touched: ["src/z.js"] });
  assert.equal(next.testCommand, "vitest");
  assert.deepEqual(next.files, ["a"]);
});

test("mergeProfile caps the hot list", () => {
  const many = Array.from({ length: 30 }, (_, i) => `f${i}.js`);
  const p = mergeProfile("o/r", null, { touched: many });
  assert.equal(p.hotFiles.length, 20);
});
