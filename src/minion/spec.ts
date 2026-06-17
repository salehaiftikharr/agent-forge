import { generateText, stepCountIs } from "ai";
import { spawnSync } from "node:child_process";
import { rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getModel, modelLabel } from "../model";
import { Workspace, type TestResult } from "./workspace";
import { specTools } from "./tools";
import type { Ticket } from "./minion";

/**
 * The spec-author minion: it writes ONLY a failing reproduction test for a
 * ticket and stops. This is the clean way to loosen the "must have a
 * pre-existing failing test" rule WITHOUT collapsing separation of powers — the
 * test-writer and the fixer are different minions, so the fixer still works
 * against a gate it never authored. A reproduction test is useful output even
 * with no fix attached; once a human approves it, a fixer can be pointed at it.
 */
const RUNS_DIR = path.join(process.cwd(), ".minion-runs");
const RECEIPTS_DIR = path.join(process.cwd(), "minion-receipts");

function run(cmd: string, args: string[], cwd?: string) {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return { ok: res.status === 0, out: (res.stdout || "").trim(), err: (res.stderr || "").trim() };
}

function specSystemPrompt(): string {
  return `You are a SPEC AUTHOR, not a fixer. Your only job is to write a single failing test that reproduces the issue (or encodes the missing behavior) described in the ticket — and then STOP. You must not fix the code.

How to work:
- First read the relevant source and an existing test so you match the project's test framework and style exactly.
- Write ONE focused test, in a test file, that will FAIL against the current code — demonstrating the bug or the unmet requirement. Use write_test.
- Run run_tests and confirm your new test FAILS for the right reason. A reproduction that already passes is not a reproduction; revise until it fails.
- You cannot and must not edit source files. Authoring the gate is the whole job.

End with a one-sentence description of the behavior your test pins down.`;
}

export interface SpecDecision {
  status: "authored" | "rejected" | "error";
  reason: string;
  failingTests: string[];
  testPatch: string;
  steps: number;
  toolCalls: number;
  baseline: TestResult;
  finalTests: TestResult;
}

/**
 * A valid reproduction adds a test that FAILS against the current code. With a
 * per-test map we look for a new, failing test by name; otherwise we require the
 * suite to flip from green to red (the added test fails). Pure + unit-tested.
 */
export function evaluateSpec(
  baseline: TestResult,
  final: TestResult,
): { status: "authored" | "rejected"; reason: string; failingTests: string[] } {
  if (baseline.perTest && final.perTest) {
    const newTests = Object.keys(final.tests).filter((n) => !(n in baseline.tests));
    const newFailing = newTests.filter((n) => final.tests[n] === false);
    if (newFailing.length > 0) {
      return {
        status: "authored",
        reason: `Wrote a failing reproduction test: ${newFailing.join("; ")}.`,
        failingTests: newFailing,
      };
    }
    if (newTests.length > 0) {
      return {
        status: "rejected",
        reason: "The new test already passes against the current code, so it does not reproduce the issue.",
        failingTests: [],
      };
    }
    return { status: "rejected", reason: "No new test was added.", failingTests: [] };
  }
  if (baseline.ok && !final.ok) {
    return {
      status: "authored",
      reason: "The suite was green and the new test makes it fail, reproducing the issue.",
      failingTests: [],
    };
  }
  if (final.ok) {
    return {
      status: "rejected",
      reason: "The suite still passes after adding the test, so it does not reproduce the issue.",
      failingTests: [],
    };
  }
  return {
    status: "rejected",
    reason: "The suite was already failing, so the new test's failure cannot be confirmed as the reproduction.",
    failingTests: [],
  };
}

/** Run the spec-author against an already-prepared (spec-author) workspace. */
export async function writeSpec(
  workspace: Workspace,
  ticket: Ticket,
  opts: { provider?: string; maxSteps?: number; onProgress?: (m: string) => void } = {},
): Promise<SpecDecision> {
  const log = opts.onProgress ?? (() => {});
  const baseline = workspace.runTests();
  log(`baseline: ${baseline.passed}/${baseline.total} tests passing`);

  let steps = 0;
  let toolCalls = 0;
  try {
    log("writing a failing reproduction test…");
    const result = await generateText({
      model: getModel(opts.provider),
      system: specSystemPrompt(),
      prompt: `Ticket:\n\n[${ticket.id}] ${ticket.title}\n${ticket.body}\n\nWrite a single failing test that reproduces this, confirm it fails with run_tests, then stop.`,
      tools: specTools(workspace),
      stopWhen: stepCountIs(opts.maxSteps ?? 10),
    });
    steps = result.steps.length;
    toolCalls = result.steps.flatMap((s) => s.toolCalls ?? []).length;
  } catch (error) {
    return {
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
      failingTests: [],
      testPatch: "",
      steps,
      toolCalls,
      baseline,
      finalTests: baseline,
    };
  }

  const finalTests = workspace.runTests();
  const testPatch = workspace.stagedDiff();
  const verdict = evaluateSpec(baseline, finalTests);
  return {
    status: verdict.status,
    reason: verdict.reason,
    failingTests: verdict.failingTests,
    testPatch,
    steps,
    toolCalls,
    baseline,
    finalTests,
  };
}

export interface SpecReceipt {
  ticketId: string;
  title: string;
  model: string;
  status: "authored" | "rejected" | "error";
  reason: string;
  failingTests: string[];
  branch?: string;
  prUrl?: string;
  testPatch: string;
  steps: number;
  toolCalls: number;
}

/**
 * GitHub path: write a failing reproduction test on a fresh branch and open a
 * PR containing ONLY that test, for a human to approve before any fix. Never
 * touches source. If the spec-author can't produce a failing test, no PR.
 */
export async function openSpecPR(
  repo: string,
  ticket: Ticket,
  opts: { provider?: string; reference?: string; onProgress?: (m: string) => void } = {},
): Promise<SpecReceipt> {
  const log = opts.onProgress ?? (() => {});
  const slug = ticket.id.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const workDir = path.join(RUNS_DIR, `spec-${repo.replace(/[/]/g, "__")}-${slug}`);
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });

  log(`cloning ${repo}…`);
  const clone = run("gh", ["repo", "clone", repo, workDir, "--", "--depth", "1"]);
  if (!clone.ok) throw new Error(`Clone failed: ${clone.err || clone.out}`);

  const baseBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], workDir).out;
  let branch = `spec/${slug}`;
  for (let n = 2; run("git", ["ls-remote", "--exit-code", "--heads", "origin", branch], workDir).ok; n++) {
    branch = `spec/${slug}-${n}`;
  }
  const authorName = run("git", ["config", "--global", "user.name"]).out || "Developer";
  const authorEmail = run("git", ["config", "--global", "user.email"]).out || "dev@localhost";
  run("git", ["config", "user.name", authorName], workDir);
  run("git", ["config", "user.email", authorEmail], workDir);
  run("git", ["checkout", "-q", "-b", branch], workDir);

  const workspace = new Workspace(workDir, "spec-author");
  const decision = await writeSpec(workspace, ticket, opts);

  const receipt: SpecReceipt = {
    ticketId: ticket.id,
    title: ticket.title,
    model: modelLabel(opts.provider),
    status: decision.status,
    reason: decision.reason,
    failingTests: decision.failingTests,
    branch,
    testPatch: decision.testPatch,
    steps: decision.steps,
    toolCalls: decision.toolCalls,
  };

  if (decision.status !== "authored") {
    return writeSpecReceipt(receipt);
  }

  log("authored — pushing the test and opening a PR for review…");
  workspace.commit(`Add a failing test for ${ticket.title}`);
  const push = run("git", ["push", "-u", "origin", branch], workDir);
  if (!push.ok) throw new Error(`Push failed: ${push.err || push.out}`);

  const failingLine = decision.failingTests.length
    ? `Failing test(s): ${decision.failingTests.join("; ")}`
    : "";
  const body = [
    opts.reference,
    "A failing test that reproduces this issue, opened for review before any fix is attempted. Approve it, then a fixer can be pointed at it.",
    failingLine,
  ]
    .filter(Boolean)
    .join("\n\n");
  const pr = run("gh", [
    "pr", "create", "--repo", repo, "--base", baseBranch, "--head", branch,
    "--title", `Add failing test: ${ticket.title}`, "--body", body,
  ]);
  if (!pr.ok) throw new Error(`PR create failed: ${pr.err || pr.out}`);
  const prUrl = pr.out.split("\n").find((l) => l.startsWith("http")) ?? pr.out;
  return writeSpecReceipt({ ...receipt, prUrl });
}

function writeSpecReceipt(receipt: SpecReceipt): SpecReceipt {
  mkdirSync(RECEIPTS_DIR, { recursive: true });
  writeFileSync(
    path.join(RECEIPTS_DIR, `spec-${receipt.ticketId}.json`),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  return receipt;
}
