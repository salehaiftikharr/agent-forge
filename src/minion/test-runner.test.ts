import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseTap,
  parseJest,
  parseGo,
  parseTestOutput,
  detectTestCommand,
} from "./test-runner";

function tmpRepo(pkg?: object): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "minion-repo-"));
  if (pkg) writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
}

test("parseTap reads ok / not ok and strips directives", () => {
  const out = "TAP version 13\nok 1 - adds\nnot ok 2 - clamp\nok 3 - slugify # SKIP later\n1..3";
  const t = parseTap(out);
  assert.deepEqual(t, { adds: true, clamp: false, slugify: true });
});

test("parseJest reads per-assertion results from --json", () => {
  const json = JSON.stringify({
    numPassedTests: 1,
    numFailedTests: 1,
    testResults: [
      {
        assertionResults: [
          { fullName: "math adds", status: "passed" },
          { fullName: "math clamps", status: "failed" },
          { fullName: "skipped one", status: "pending" },
        ],
      },
    ],
  });
  const t = parseJest("Running...\n" + json);
  assert.deepEqual(t, { "math adds": true, "math clamps": false });
});

test("parseGo reads pass/fail events from go test -json", () => {
  const lines = [
    JSON.stringify({ Action: "run", Test: "TestAdd", Package: "p" }),
    JSON.stringify({ Action: "pass", Test: "TestAdd", Package: "p" }),
    JSON.stringify({ Action: "fail", Test: "TestClamp", Package: "p" }),
    "not json, build output",
  ].join("\n");
  const t = parseGo(lines);
  assert.deepEqual(t, { "p TestAdd": true, "p TestClamp": false });
});

test("parseTestOutput gives a per-test map when the format yields one", () => {
  const r = parseTestOutput("tap", "ok 1 - a\nnot ok 2 - b", 1);
  assert.equal(r.perTest, true);
  assert.equal(r.passed, 1);
  assert.equal(r.failed, 1);
  assert.equal(r.ok, false);
});

test("parseTestOutput falls back to exit code when there's no per-test detail", () => {
  const pass = parseTestOutput("exit", "all good", 0);
  assert.equal(pass.perTest, false);
  assert.equal(pass.ok, true);
  const fail = parseTestOutput("exit", "boom", 1);
  assert.equal(fail.ok, false);
  // A "tap" runner that emitted no TAP also degrades gracefully.
  const noTap = parseTestOutput("tap", "Tests: 3 passed", 0);
  assert.equal(noTap.perTest, false);
  assert.equal(noTap.ok, true);
});

test("detectTestCommand picks the right runner per repo", () => {
  delete process.env.MINION_TEST_CMD;

  const vitest = detectTestCommand(tmpRepo({ devDependencies: { vitest: "^1" } }));
  assert.equal(vitest.how, "vitest");
  assert.ok(vitest.argv.includes("vitest") && vitest.format === "tap");

  const jest = detectTestCommand(tmpRepo({ devDependencies: { jest: "^29" } }));
  assert.equal(jest.format, "jest");

  const npm = detectTestCommand(tmpRepo({ scripts: { test: "mocha-something" } }));
  assert.equal(npm.how, "npm test");

  const nodeRepo = tmpRepo({ name: "x" });
  mkdirSync(path.join(nodeRepo, "test"));
  writeFileSync(path.join(nodeRepo, "test", "x.test.js"), "");
  const node = detectTestCommand(nodeRepo);
  assert.equal(node.how, "node:test");
  assert.ok(node.argv.includes("--test"));
});

test("detectTestCommand honors the MINION_TEST_CMD override", () => {
  process.env.MINION_TEST_CMD = "make check";
  process.env.MINION_TEST_FORMAT = "exit";
  const cmd = detectTestCommand(tmpRepo());
  assert.deepEqual(cmd.argv, ["sh", "-c", "make check"]);
  assert.equal(cmd.format, "exit");
  delete process.env.MINION_TEST_CMD;
  delete process.env.MINION_TEST_FORMAT;
});
