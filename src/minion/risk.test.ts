import { test } from "node:test";
import assert from "node:assert/strict";
import { assessRisk } from "./risk";

/** A small unified diff that adds `added` lines to one source file. */
function diffAdding(file: string, added: number): string {
  const body = Array.from({ length: added }, (_, i) => `+  line ${i};`).join("\n");
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,0 +1,${added} @@`,
    body,
  ].join("\n");
}

test("a tidy one-file change is low risk", () => {
  const r = assessRisk(diffAdding("src/utils.js", 4));
  assert.equal(r.level, "low");
  assert.equal(r.filesChanged, 1);
  assert.equal(r.linesAdded, 4);
});

test("touching a dependency manifest raises risk", () => {
  const r = assessRisk(diffAdding("package.json", 3));
  assert.ok(r.score >= 0.3);
  assert.ok(r.factors.some((f) => /dependen/i.test(f)));
});

test("a database migration is flagged", () => {
  const r = assessRisk(diffAdding("db/migrations/004_add_users.sql", 5));
  assert.ok(r.factors.some((f) => /migration/i.test(f)));
  assert.notEqual(r.level, "low");
});

test("a large, many-file change is high risk", () => {
  const patch = [
    diffAdding("src/a.ts", 60),
    diffAdding("src/b.ts", 60),
    diffAdding("src/c.ts", 30),
    diffAdding("src/d.ts", 30),
    diffAdding("src/e.ts", 30),
  ].join("\n");
  const r = assessRisk(patch);
  assert.equal(r.level, "high");
  assert.equal(r.filesChanged, 5);
});

test("a net deletion is its own risk factor", () => {
  const patch = [
    `diff --git a/src/x.ts b/src/x.ts`,
    `--- a/src/x.ts`,
    `+++ b/src/x.ts`,
    `@@ -1,20 +1,2 @@`,
    ...Array.from({ length: 20 }, (_, i) => `-old ${i}`),
    `+new a`,
    `+new b`,
  ].join("\n");
  const r = assessRisk(patch);
  assert.equal(r.linesRemoved, 20);
  assert.ok(r.factors.some((f) => /removes more/i.test(f)));
});

test("score is clamped to 1 and an empty diff is low", () => {
  assert.ok(assessRisk("").score === 0);
  assert.equal(assessRisk("").level, "low");
  const huge = [
    diffAdding("package.json", 200),
    diffAdding("db/migrations/x.sql", 50),
    diffAdding(".github/workflows/ci.yml", 50),
  ].join("\n");
  assert.ok(assessRisk(huge).score <= 1);
});
