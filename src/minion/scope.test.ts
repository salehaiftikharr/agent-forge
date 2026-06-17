import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFileHints, resolveHints, buildScopeNote } from "./scope";

test("extractFileHints pulls paths from stack traces, path:line, and backticks", () => {
  const text = "TypeError at parse (src/utils.js:12:5)\nsee `lib/foo.ts` and config.json:3";
  const hints = extractFileHints(text);
  assert.ok(hints.includes("src/utils.js"), "stack frame path");
  assert.ok(hints.includes("lib/foo.ts"), "backticked path");
  assert.ok(hints.includes("config.json"), "path:line");
});

test("extractFileHints strips a/ b/ diff prefixes", () => {
  assert.deepEqual(extractFileHints("b/src/app.ts changed"), ["src/app.ts"]);
});

test("resolveHints maps to real files and drops misses + ambiguity", () => {
  const repo = ["src/utils.js", "src/math.ts", "test/utils.test.js", "config.json"];
  assert.deepEqual(resolveHints(["utils.js"], repo), ["src/utils.js"]); // unique basename
  assert.deepEqual(resolveHints(["config.json"], repo), ["config.json"]); // exact
  assert.deepEqual(resolveHints(["nope.js"], repo), []); // no match
  assert.deepEqual(resolveHints(["foo.js"], ["a/foo.js", "b/foo.js"]), []); // ambiguous -> dropped
});

test("buildScopeNote is empty with nothing to say, and surfaces hints otherwise", () => {
  assert.equal(buildScopeNote([], [], ""), "");
  const note = buildScopeNote(["src/utils.js"], ["src/math.ts"], "node:test");
  assert.match(note, /src\/utils\.js/);
  assert.match(note, /src\/math\.ts/);
  assert.match(note, /node:test/);
});
