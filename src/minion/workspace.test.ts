import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { Workspace } from "./workspace";

const ws = new Workspace("/tmp/does-not-matter");

/** A throwaway git repo with one committed source file, on a branch. */
function tempRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "ws-test-"));
  const git = (...a: string[]) => spawnSync("git", a, { cwd: root, encoding: "utf8" });
  writeFileSync(path.join(root, "utils.js"), "export const a = 1;\n");
  git("init", "-q");
  git("config", "user.email", "t@t.local");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-q", "-m", "baseline");
  git("checkout", "-q", "-b", "minion/x");
  return root;
}

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

test("separation of powers: fixer writes source only, spec-author writes tests only", () => {
  const fixer = new Workspace("/tmp/x", "fixer");
  assert.equal(fixer.canWrite("src/utils.js").ok, true);
  assert.equal(fixer.canWrite("test/utils.test.js").ok, false);

  const author = new Workspace("/tmp/x", "spec-author");
  assert.equal(author.canWrite("test/utils.test.js").ok, true);
  assert.equal(author.canWrite("src/utils.js").ok, false);
});

test("reset() returns the working tree to the clean baseline", () => {
  const w = new Workspace(tempRepo());
  w.write("utils.js", "export const a = 999;\n");
  writeFileSync(path.join(w.root, "extra.js"), "junk\n"); // untracked
  w.reset();
  assert.equal(w.read("utils.js"), "export const a = 1;\n");
  assert.equal(existsSync(path.join(w.root, "extra.js")), false, "untracked file should be cleaned");
  assert.equal(w.stagedDiff(), "", "no changes after reset");
});

test("applyPatch round-trips a captured diff (and stages it)", () => {
  const w = new Workspace(tempRepo());
  w.write("utils.js", "export const a = 2;\n");
  const patch = w.stagedDiff();
  assert.ok(patch.includes("+export const a = 2;"));

  w.reset();
  assert.equal(w.read("utils.js"), "export const a = 1;\n");

  w.applyPatch(patch);
  assert.equal(w.read("utils.js"), "export const a = 2;\n", "winner restored");
  // --index means the restored change is staged, so the gate's diff sees it.
  assert.ok(Object.keys(w.changedSourceLines()).includes("utils.js"));
});

test("applyPatch restores a brand-new file from the diff", () => {
  const w = new Workspace(tempRepo());
  w.write("clamp.js", "export const clamp = () => 0;\n");
  const patch = w.stagedDiff();
  w.reset();
  assert.equal(existsSync(path.join(w.root, "clamp.js")), false);
  w.applyPatch(patch);
  assert.ok(existsSync(path.join(w.root, "clamp.js")), "new file recreated");
  assert.equal(readFileSync(path.join(w.root, "clamp.js"), "utf8"), "export const clamp = () => 0;\n");
});
