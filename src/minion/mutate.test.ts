import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMutants, parseAddedLines } from "./mutate";

const SRC = [
  "function clamp(n, min, max) {",
  "  if (n < min) return min;",
  "  return n;",
  "}",
].join("\n");

test("generateMutants flips a comparison on a changed line", () => {
  const mutants = generateMutants(SRC, [2], 8);
  assert.ok(mutants.some((m) => m.content.includes("n > min")), "should flip < to >");
});

test("generateMutants always offers a line-deletion mutant", () => {
  const mutants = generateMutants(SRC, [2], 8);
  assert.ok(
    mutants.some((m) => !m.content.includes("if (n")),
    "should include a mutant with line 2 removed",
  );
});

test("generateMutants bumps a numeric constant", () => {
  const mutants = generateMutants("const limit = 10;", [1], 8);
  assert.ok(mutants.some((m) => m.content.includes("11")), "should bump 10 -> 11");
});

test("generateMutants never returns the original and respects the cap", () => {
  const mutants = generateMutants(SRC, [1, 2, 3, 4], 3);
  assert.ok(mutants.length <= 3);
  assert.ok(mutants.every((m) => m.content !== SRC));
});

test("generateMutants ignores blank or out-of-range lines", () => {
  assert.deepEqual(generateMutants("a\n\nb", [2], 8), []); // line 2 is blank
  assert.deepEqual(generateMutants("a\nb", [99], 8), []); // out of range
});

test("parseAddedLines extracts added line numbers per file", () => {
  const diff = [
    "diff --git a/src/utils.js b/src/utils.js",
    "--- a/src/utils.js",
    "+++ b/src/utils.js",
    "@@ -2,0 +3,3 @@",
    "+export function clamp(n, min, max) {",
    "+  return Math.min(Math.max(n, min), max);",
    "+}",
    "diff --git a/test/x.test.js b/test/x.test.js",
    "--- a/test/x.test.js",
    "+++ b/test/x.test.js",
    "@@ -5 +6,0 @@",
    "-old assertion",
  ].join("\n");
  const added = parseAddedLines(diff);
  assert.deepEqual(added["src/utils.js"], [3, 4, 5]);
  assert.equal(added["test/x.test.js"], undefined); // deletion-only -> no added lines
});
