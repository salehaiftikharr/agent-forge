import {
  cpSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { detectTestCommand, parseTestOutput } from "./test-runner";

/**
 * A Workspace is the minion's sandbox boundary. Every run gets a fresh,
 * git-tracked copy of the target repo under .minion-runs/<ticket>/, and the
 * minion can only act through this object. Two rules are enforced here, not
 * trusted to the model:
 *
 *   1. Writes can never escape the workspace root (no path traversal), and
 *   2. Writes can never touch the TEST directory — the minion may *read* the
 *      tests to learn the acceptance bar, but it cannot edit the gate it's
 *      judged against. This is what stops an agent from "passing" by deleting
 *      the failing test.
 *
 * The pass/fail signal comes from actually running the tests (runTests), never
 * from the model's claim.
 */
export interface TestResult {
  ok: boolean;
  passed: number;
  failed: number;
  total: number;
  output: string;
  /** Per-test pass/fail by name, so the gate can reason about regressions. */
  tests: Record<string, boolean>;
  /** True when we have a per-test map; false = the gate falls back to exit code. */
  perTest: boolean;
}

const PROTECTED_DIRS = ["test", "tests", "__tests__", "spec"];
const IGNORE = new Set([
  "node_modules",
  ".git",
  ".minion-runs",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".pytest_cache",
]);

function git(cwd: string, args: string[]): string {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  return (res.stdout || "") + (res.stderr || "");
}

export class Workspace {
  constructor(readonly root: string) {}

  /** Resolve a repo-relative path, refusing anything that escapes the root. */
  private resolve(rel: string): string {
    const abs = path.resolve(this.root, rel);
    const base = path.resolve(this.root);
    if (abs !== base && !abs.startsWith(base + path.sep)) {
      throw new Error(`Path escapes the workspace: ${rel}`);
    }
    return abs;
  }

  /**
   * Is this a test file the minion must not edit? Covers test directories AND
   * colocated test files across ecosystems (foo.test.ts, foo.spec.js,
   * test_x.py, x_test.go), so the "minions can't edit the gate" rule holds no
   * matter how a repo lays its tests out.
   */
  isProtected(rel: string): boolean {
    const parts = path.normalize(rel).split(path.sep);
    if (parts.some((p) => PROTECTED_DIRS.includes(p))) return true;
    const base = parts[parts.length - 1];
    return (
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(base) || // JS/TS colocated
      /(^test_.*|.*_test)\.py$/.test(base) || // pytest
      /_test\.go$/.test(base) // go
    );
  }

  read(rel: string): string {
    return readFileSync(this.resolve(rel), "utf8");
  }

  write(rel: string, content: string): void {
    if (this.isProtected(rel)) {
      throw new Error(
        `Refusing to write to a test file (${rel}). Minions edit source, never the tests they're judged against.`,
      );
    }
    writeFileSync(this.resolve(rel), content);
  }

  /** All readable files (source + tests), repo-relative, for context. */
  listFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (IGNORE.has(entry)) continue;
        const abs = path.join(dir, entry);
        if (statSync(abs).isDirectory()) walk(abs);
        else out.push(path.relative(this.root, abs));
      }
    };
    walk(this.root);
    return out.sort();
  }

  /**
   * Run the suite. Ground truth — this, not the model, decides pass/fail.
   * Test files are passed explicitly (a bare `--test <dir>` mis-discovers on
   * this Node version), and the TAP `ok/not ok` lines are parsed into a
   * per-test map so the caller can detect regressions by name.
   */
  runTests(): TestResult {
    const cmd = detectTestCommand(this.root);
    const res = spawnSync(cmd.argv[0], cmd.argv.slice(1), {
      cwd: this.root,
      encoding: "utf8",
      timeout: 120_000,
    });
    const output = (res.stdout || "") + (res.stderr || "");
    const parsed = parseTestOutput(cmd.format, output, res.status ?? 1);
    return { ...parsed, output };
  }

  /** A short description of how this repo's tests are run (for receipts/logs). */
  testCommand(): string {
    return detectTestCommand(this.root).how;
  }

  /** Stage everything and return the unified diff vs. the pristine baseline. */
  stagedDiff(): string {
    git(this.root, ["add", "-A"]);
    return git(this.root, ["diff", "--cached"]).trim();
  }

  /** Commit the change onto the minion branch (used only when shipping). */
  commit(message: string): void {
    git(this.root, ["add", "-A"]);
    git(this.root, ["commit", "-q", "-m", message]);
  }
}

/**
 * Copy the target repo into a fresh, git-tracked working dir for this ticket,
 * commit the pristine state, and check out a `minion/<ticket>` branch. Returns
 * the Workspace plus the branch name.
 */
export function prepareWorkspace(
  sandboxDir: string,
  runsDir: string,
  ticketId: string,
): { workspace: Workspace; branch: string } {
  const root = path.join(runsDir, ticketId);
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  cpSync(sandboxDir, root, {
    recursive: true,
    filter: (src) => !IGNORE.has(path.basename(src)),
  });

  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "minion@agent-forge.local"]);
  git(root, ["config", "user.name", "Forge Minion"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", `pristine baseline for ${ticketId}`]);

  const branch = `minion/${ticketId.toLowerCase()}`;
  git(root, ["checkout", "-q", "-b", branch]);

  return { workspace: new Workspace(root), branch };
}
