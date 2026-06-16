import { test } from "node:test";
import assert from "node:assert/strict";
import { Workspace } from "./workspace";

const ws = new Workspace("/tmp/does-not-matter");

test("isProtected covers test directories and colocated test files", () => {
  // Protected: the minion must never edit these.
  for (const p of [
    "test/utils.test.js",
    "tests/foo.js",
    "__tests__/bar.js",
    "spec/baz.js",
    "src/math.test.ts",
    "src/math.spec.jsx",
    "app/test_views.py",
    "app/views_test.py",
    "pkg/handler_test.go",
  ]) {
    assert.equal(ws.isProtected(p), true, `${p} should be protected`);
  }
});

test("isProtected leaves real source files writable", () => {
  for (const p of ["src/utils.js", "src/math.ts", "app/views.py", "pkg/handler.go", "README.md"]) {
    assert.equal(ws.isProtected(p), false, `${p} should be writable`);
  }
});
