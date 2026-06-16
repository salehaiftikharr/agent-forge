import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Make minions repo-agnostic: instead of hard-coding one test command, detect
 * how THIS repo runs its tests, run it, and parse a per-test pass/fail map so
 * the gate can reason about regressions. Supports the common runners out of the
 * box, and an explicit `MINION_TEST_CMD` escape hatch for anything else — so
 * pointing a minion at a new project is configuration, never a code change.
 */
export type TestFormat = "tap" | "jest" | "go" | "exit";

export interface TestCommand {
  argv: string[];
  format: TestFormat;
  /** Human note on how the command was chosen (for receipts/logs). */
  how: string;
}

export interface ParsedTests {
  /** Per-test pass/fail by name. Empty when the runner gives no per-test detail. */
  tests: Record<string, boolean>;
  passed: number;
  failed: number;
  total: number;
  ok: boolean;
  /** True when we have a per-test map (precise gate); false = exit-code only. */
  perTest: boolean;
}

function readPkg(root: string): { deps: Record<string, string>; scripts: Record<string, string> } | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    return {
      deps: { ...(raw.dependencies ?? {}), ...(raw.devDependencies ?? {}) },
      scripts: raw.scripts ?? {},
    };
  } catch {
    return null;
  }
}

/** Node's built-in test convention: *.test.js (and .mjs/.cjs) in test/, tests/, or the root. */
function findNodeTestFiles(root: string): string[] {
  const out: string[] = [];
  const re = /\.test\.[cm]?js$/;
  for (const dir of ["test", "tests", "."]) {
    try {
      for (const f of readdirSync(path.join(root, dir))) {
        if (re.test(f)) out.push(dir === "." ? f : path.join(dir, f));
      }
    } catch {
      /* dir absent */
    }
  }
  return out;
}

/** Decide how to run this repo's tests. */
export function detectTestCommand(root: string): TestCommand {
  const override = process.env.MINION_TEST_CMD;
  if (override && override.trim()) {
    const fmt = (process.env.MINION_TEST_FORMAT as TestFormat) || "tap";
    return { argv: ["sh", "-c", override], format: fmt, how: `MINION_TEST_CMD override (${fmt})` };
  }

  const pkg = readPkg(root);
  const has = (name: string) => pkg?.deps?.[name] != null;

  if (has("vitest"))
    return { argv: ["npx", "vitest", "run", "--reporter=tap"], format: "tap", how: "vitest" };
  if (has("jest"))
    return { argv: ["npx", "jest", "--json", "--silent"], format: "jest", how: "jest" };
  if (has("mocha"))
    return { argv: ["npx", "mocha", "--reporter", "tap"], format: "tap", how: "mocha" };
  if (existsSync(path.join(root, "go.mod")))
    return { argv: ["go", "test", "-json", "./..."], format: "go", how: "go test" };

  const nodeTests = findNodeTestFiles(root);
  if (nodeTests.length)
    return {
      argv: ["node", "--test", "--test-reporter=tap", ...nodeTests],
      format: "tap",
      how: "node:test",
    };

  if (pkg?.scripts?.test)
    return { argv: ["npm", "test", "--silent"], format: "tap", how: "npm test" };

  if (existsSync(path.join(root, "pyproject.toml")) || existsSync(path.join(root, "pytest.ini")))
    return { argv: ["pytest", "-q"], format: "exit", how: "pytest" };

  return { argv: ["node", "--test", "--test-reporter=tap"], format: "tap", how: "node:test (default)" };
}

/** TAP: `ok N - name` / `not ok N - name` (node:test, vitest, mocha, ava, tape...). */
export function parseTap(output: string): Record<string, boolean> {
  const tests: Record<string, boolean> = {};
  for (const line of output.split("\n")) {
    const m = line.match(/^\s*(not ok|ok)\s+\d+\s*-?\s*(.+?)\s*$/);
    if (m) {
      const name = m[2].replace(/\s+#.*$/, "").trim();
      if (name) tests[name] = m[1] === "ok";
    }
  }
  return tests;
}

/** Jest `--json`: a single JSON blob with per-assertion results. */
export function parseJest(output: string): Record<string, boolean> {
  const tests: Record<string, boolean> = {};
  const start = output.indexOf("{");
  if (start === -1) return tests;
  let data: { testResults?: Array<{ assertionResults?: Array<{ fullName?: string; title?: string; status?: string }> }> };
  try {
    data = JSON.parse(output.slice(start));
  } catch {
    return tests;
  }
  for (const file of data.testResults ?? []) {
    for (const a of file.assertionResults ?? []) {
      if (a.status === "passed" || a.status === "failed") {
        tests[a.fullName || a.title || "test"] = a.status === "passed";
      }
    }
  }
  return tests;
}

/** `go test -json`: one JSON event per line; pass/fail actions carry the test name. */
export function parseGo(output: string): Record<string, boolean> {
  const tests: Record<string, boolean> = {};
  for (const line of output.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const e = JSON.parse(line) as { Action?: string; Test?: string; Package?: string };
      if (e.Test && (e.Action === "pass" || e.Action === "fail")) {
        tests[`${e.Package ?? ""} ${e.Test}`.trim()] = e.Action === "pass";
      }
    } catch {
      /* non-JSON build line */
    }
  }
  return tests;
}

/** Turn raw runner output + exit code into a normalized result. */
export function parseTestOutput(format: TestFormat, output: string, exitCode: number): ParsedTests {
  let tests: Record<string, boolean> = {};
  if (format === "tap") tests = parseTap(output);
  else if (format === "jest") tests = parseJest(output);
  else if (format === "go") tests = parseGo(output);
  // A runner labeled "tap" that emits no TAP (e.g. a plain `npm test`) leaves
  // the map empty — fall back to exit-code mode rather than guessing.

  const values = Object.values(tests);
  if (values.length > 0) {
    const passed = values.filter(Boolean).length;
    const failed = values.length - passed;
    return { tests, passed, failed, total: values.length, ok: failed === 0, perTest: true };
  }
  return { tests: {}, passed: 0, failed: 0, total: 0, ok: exitCode === 0, perTest: false };
}
