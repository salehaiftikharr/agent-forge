import { generateText, generateObject, stepCountIs } from "ai";
import { z } from "zod";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { getModel, modelLabel } from "../model";
import { prepareWorkspace, type TestResult } from "./workspace";
import { minionTools } from "./tools";

/**
 * A minion: an autonomous agent that takes one ticket and tries to close it on
 * a sandbox copy of the repo. The flow:
 *
 *   read the ticket + code → edit source → run tests (iterating internally) →
 *   I re-run the tests as ground truth → a judge checks the change isn't gamed
 *   → SHIP a branch + diff + receipt, or DECLINE honestly.
 *
 * The acceptance bar is strict and not the model's to decide: ALL tests must
 * pass (the ticket's and the pre-existing ones — no regressions), and the
 * minion can't edit tests. A ticket it can't satisfy that way is declined, not
 * forced — which is the whole point.
 */
export interface Ticket {
  id: string;
  title: string;
  body: string;
  files?: string[];
}

export interface MinionReceipt {
  ticketId: string;
  title: string;
  model: string;
  status: "shipped" | "declined" | "error";
  reason: string;
  branch: string;
  steps: number;
  toolCalls: number;
  baselineTests: { passed: number; total: number };
  finalTests: { ok: boolean; passed: number; failed: number; total: number };
  patch: string;
}

const SANDBOX_DIR = path.join(process.cwd(), "sandbox");
const RUNS_DIR = path.join(process.cwd(), ".minion-runs");
const RECEIPTS_DIR = path.join(process.cwd(), "minion-receipts");

function systemPrompt(): string {
  return `You are a "minion": an autonomous coding agent that resolves ONE ticket on a small repository, using the provided tools.

How to work:
- Start by reading the relevant source AND the test file, so you know the exact expected behavior. The tests are your acceptance criteria.
- Make the MINIMAL source change that resolves the ticket. Don't refactor, reformat, or touch unrelated code.
- Run the tests with run_tests and iterate until they pass. A fix is only acceptable when EVERY test passes — the ticket's new test AND all pre-existing ones. Never regress passing behavior.
- You cannot edit test files; they are the gate. If the only way to make a test pass would be to break another test or change existing correct behavior, the ticket is faulty — do NOT force it. Stop and explain clearly that you are declining and why.

When you're done, end with a one-paragraph summary: what you changed and why, or — if you couldn't satisfy every test without breaking something — that you are declining the ticket, and the specific conflict that makes it impossible.`;
}

const verdictSchema = z.object({
  genuinelyResolves: z
    .boolean()
    .describe(
      "True only if the diff genuinely resolves the ticket with a minimal, sensible source change — not by gaming, deleting code, or unrelated edits.",
    ),
  reason: z.string().describe("One sentence."),
});

/**
 * The judge guards against passing-but-wrong changes. The test result is the
 * hard correctness gate; this checks the diff is a legitimate, minimal fix for
 * THIS ticket rather than something that merely turned the suite green.
 */
async function judgeChange(
  ticket: Ticket,
  patch: string,
  provider?: string,
): Promise<{ genuinelyResolves: boolean; reason: string }> {
  const { object } = await generateObject({
    model: getModel(provider),
    schema: verdictSchema,
    system:
      "You review a code change a coding agent made for a ticket. All tests pass. Decide whether the diff is a legitimate, minimal fix that genuinely addresses the ticket — not gaming (e.g. hard-coding a test's expected value, deleting functionality, or sweeping unrelated edits).",
    prompt: `Ticket: ${ticket.title}\n${ticket.body}\n\nDiff:\n${patch || "(no changes)"}\n\nIs this a legitimate, minimal fix for the ticket?`,
  });
  return object;
}

export async function runMinion(
  ticket: Ticket,
  opts: { provider?: string; maxSteps?: number; onProgress?: (m: string) => void } = {},
): Promise<MinionReceipt> {
  const log = opts.onProgress ?? (() => {});
  const { workspace, branch } = prepareWorkspace(SANDBOX_DIR, RUNS_DIR, ticket.id);

  const baseline = workspace.runTests();
  log(`baseline: ${baseline.passed}/${baseline.total} tests passing`);

  const base: Omit<MinionReceipt, "status" | "reason" | "finalTests" | "patch"> = {
    ticketId: ticket.id,
    title: ticket.title,
    model: modelLabel(opts.provider),
    branch,
    steps: 0,
    toolCalls: 0,
    baselineTests: { passed: baseline.passed, total: baseline.total },
  };

  let steps = 0;
  let toolCalls = 0;
  try {
    log("minion working…");
    const result = await generateText({
      model: getModel(opts.provider),
      system: systemPrompt(),
      prompt: `Resolve this ticket:\n\n[${ticket.id}] ${ticket.title}\n${ticket.body}`,
      tools: minionTools(workspace),
      stopWhen: stepCountIs(opts.maxSteps ?? 14),
    });
    steps = result.steps.length;
    toolCalls = result.steps.flatMap((s) => s.toolCalls ?? []).length;
  } catch (error) {
    return finalize(base, {
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
      finalTests: testToReceipt(baseline),
      patch: "",
    });
  }
  base.steps = steps;
  base.toolCalls = toolCalls;

  // Ground truth: re-run the tests ourselves. Never trust the model's claim.
  const finalTests = workspace.runTests();
  const patch = workspace.stagedDiff();
  log(`final: ${finalTests.passed}/${finalTests.total} passing — verifying…`);

  // Gate 1: no regressions, and real progress. A legitimate fix turns a
  // failing test green WITHOUT breaking any test that was passing at baseline.
  const regressions = Object.keys(baseline.tests).filter(
    (name) => baseline.tests[name] && finalTests.tests[name] === false,
  );
  const newPasses = Object.keys(finalTests.tests).filter(
    (name) => finalTests.tests[name] && baseline.tests[name] === false,
  );
  if (regressions.length > 0) {
    return finalize(base, {
      status: "declined",
      reason: `Would break previously-passing test(s): ${regressions.join("; ")}. The ticket can't be satisfied without a regression, so it's declined rather than shipped.`,
      finalTests: testToReceipt(finalTests),
      patch,
    });
  }
  if (newPasses.length === 0) {
    return finalize(base, {
      status: "declined",
      reason:
        "No previously-failing test was turned green — the change doesn't actually close the ticket.",
      finalTests: testToReceipt(finalTests),
      patch,
    });
  }

  // Gate 2: the change must be a legitimate, minimal fix, not gamed.
  const verdict = await judgeChange(ticket, patch, opts.provider);
  if (!verdict.genuinelyResolves) {
    return finalize(base, {
      status: "declined",
      reason: `Tests pass, but the change was rejected on review: ${verdict.reason}`,
      finalTests: testToReceipt(finalTests),
      patch,
    });
  }

  // Ship it: commit onto the minion branch.
  workspace.commit(`${ticket.id}: ${ticket.title}`);
  return finalize(base, {
    status: "shipped",
    reason: verdict.reason,
    finalTests: testToReceipt(finalTests),
    patch,
  });
}

function testToReceipt(t: TestResult) {
  return { ok: t.ok, passed: t.passed, failed: t.failed, total: t.total };
}

function finalize(
  base: Omit<MinionReceipt, "status" | "reason" | "finalTests" | "patch">,
  rest: Pick<MinionReceipt, "status" | "reason" | "finalTests" | "patch">,
): MinionReceipt {
  const receipt: MinionReceipt = { ...base, ...rest };
  mkdirSync(RECEIPTS_DIR, { recursive: true });
  writeFileSync(
    path.join(RECEIPTS_DIR, `${receipt.ticketId}.json`),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  return receipt;
}
