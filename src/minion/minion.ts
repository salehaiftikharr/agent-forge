import { generateText, generateObject, stepCountIs } from "ai";
import { z } from "zod";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { getModel, modelLabel } from "../model";
import { prepareWorkspace, type TestResult, type Workspace } from "./workspace";
import { minionTools, minionReadTools } from "./tools";

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
  /** Set when the minion opened a real pull request (the GitHub path). */
  prUrl?: string;
}

const SANDBOX_DIR = path.join(process.cwd(), "sandbox");
const RUNS_DIR = path.join(process.cwd(), ".minion-runs");
const RECEIPTS_DIR = path.join(process.cwd(), "minion-receipts");

function planSystemPrompt(): string {
  return `You are a careful engineer about to pick up ONE ticket on a repository you have not seen before. Before writing any code, get yourself fully up to speed.

How to plan:
- Use list_files and read_file to study the codebase: its layout, the existing source, and the conventions it follows (style, naming, how things are structured).
- Then read the ticket carefully and work out exactly what it is asking for.
- Decide the MINIMAL change that resolves it: which file(s) to touch and the specific edit to make, matching the codebase's existing conventions.
- Stay strictly within this one ticket. The repo may contain other failing tests for unrelated, not-yet-built features — those are OTHER tickets and out of scope. Do not plan to touch them.

This is planning only — do NOT write code yet. Output a short, concrete plan in plain prose: what you understand the codebase to be, and the exact change you will make for this ticket.`;
}

function implementSystemPrompt(): string {
  return `You are a "minion": an autonomous coding agent resolving ONE ticket on a repository, using the provided tools. You have already studied the codebase and written the plan below — now carry it out.

How to work:
- Read the test(s) that cover your ticket so you match the exact expected behavior; the tests are your acceptance criteria.
- Make the MINIMAL source change your plan calls for. Do not refactor, reformat, or touch unrelated code.
- The repo may contain other failing tests for features that are NOT your ticket. Those belong to other tickets and are out of scope — leave them failing, do not implement them.
- Run the tests with run_tests and iterate until the test(s) for your ticket pass and nothing that was passing before has broken.
- You cannot edit test files; they are the gate. If your ticket could only pass by breaking another passing test or changing correct existing behavior, do NOT force it — stop and explain that you are declining and why.

When you're done, end with a one-sentence summary of what you changed (or why you are declining).`;
}

/** First substantive line of the plan (skipping markdown headings), for a tidy log. */
function firstLine(text: string): string {
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[#>*\-\s]+/, "").trim();
    if (line.length >= 12) return line.length > 120 ? line.slice(0, 117) + "…" : line;
  }
  return "ready to implement";
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

export interface Decision {
  /** "approved" = passed every gate, ready for the caller to ship. */
  status: "approved" | "declined" | "error";
  reason: string;
  patch: string;
  baseline: TestResult;
  finalTests: TestResult;
  steps: number;
  toolCalls: number;
}

/**
 * The reusable core: run a minion against a ticket on an already-prepared
 * Workspace — a sandbox copy OR a real cloned repo on a fresh branch — apply
 * the gates, and return the decision. The caller decides what "approved" means:
 * commit locally (sandbox) or commit + push + open a PR (GitHub). The gates are
 * identical either way, which is the point — the same verification that makes
 * the sandbox demo trustworthy is what guards a real pull request.
 */
export async function workTicket(
  workspace: Workspace,
  ticket: Ticket,
  opts: {
    provider?: string;
    maxSteps?: number;
    onProgress?: (m: string) => void;
    /** Called once after the minion has studied the repo and made a plan, before it implements — the caller uses this to branch off main. */
    onPlanReady?: () => void;
  } = {},
): Promise<Decision> {
  const log = opts.onProgress ?? (() => {});
  const baseline = workspace.runTests();
  log(`baseline: ${baseline.passed}/${baseline.total} tests passing`);

  let steps = 0;
  let toolCalls = 0;
  try {
    // Phase 1 — orient and plan: read the whole codebase and understand it,
    // read the ticket, and decide the change BEFORE writing anything.
    log("studying the codebase…");
    const planResult = await generateText({
      model: getModel(opts.provider),
      system: planSystemPrompt(),
      prompt: `Ticket:\n\n[${ticket.id}] ${ticket.title}\n${ticket.body}\n\nStudy the repository, then write your plan.`,
      tools: minionReadTools(workspace),
      stopWhen: stepCountIs(8),
    });
    const plan = planResult.text.trim();
    steps += planResult.steps.length;
    toolCalls += planResult.steps.flatMap((s) => s.toolCalls ?? []).length;
    log(`plan ready — ${firstLine(plan)}`);

    // Only now, with the codebase understood and a plan in hand, branch off main.
    opts.onPlanReady?.();

    // Phase 2 — implement the plan.
    log("implementing…");
    const result = await generateText({
      model: getModel(opts.provider),
      system: implementSystemPrompt(),
      prompt: `Ticket:\n\n[${ticket.id}] ${ticket.title}\n${ticket.body}\n\nYour plan:\n${plan}\n\nImplement it now.`,
      tools: minionTools(workspace),
      stopWhen: stepCountIs(opts.maxSteps ?? 14),
    });
    steps += result.steps.length;
    toolCalls += result.steps.flatMap((s) => s.toolCalls ?? []).length;
  } catch (error) {
    return {
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
      patch: "",
      baseline,
      finalTests: baseline,
      steps,
      toolCalls,
    };
  }

  // Ground truth: re-run the tests ourselves. Never trust the model's claim.
  const finalTests = workspace.runTests();
  const patch = workspace.stagedDiff();
  log(`final: ${finalTests.passed}/${finalTests.total} passing — verifying…`);

  const decided = (status: Decision["status"], reason: string): Decision => ({
    status,
    reason,
    patch,
    baseline,
    finalTests,
    steps,
    toolCalls,
  });

  // Gate 1: no regressions, and real progress. When the runner gives a per-test
  // map we reason test-by-test (so unrelated failing tests can stay failing).
  // When it only gives an exit code, we require the whole suite to flip from
  // failing to passing — and never the reverse.
  if (baseline.perTest && finalTests.perTest) {
    const regressions = Object.keys(baseline.tests).filter(
      (name) => baseline.tests[name] && finalTests.tests[name] === false,
    );
    const newPasses = Object.keys(finalTests.tests).filter(
      (name) => finalTests.tests[name] && baseline.tests[name] === false,
    );
    if (regressions.length > 0) {
      return decided(
        "declined",
        `Would break previously-passing test(s): ${regressions.join("; ")}. Declined rather than ship a regression.`,
      );
    }
    if (newPasses.length === 0) {
      return decided(
        "declined",
        "No previously-failing test was turned green — the change doesn't actually close the ticket.",
      );
    }
  } else {
    if (!finalTests.ok) {
      return decided(
        "declined",
        "The test suite is still failing after the change — it does not resolve the ticket.",
      );
    }
    if (baseline.ok) {
      return decided(
        "declined",
        "The suite already passed before any change — there was no failing test to fix.",
      );
    }
  }

  // Gate 2: the change must be a legitimate, minimal fix, not gamed.
  const verdict = await judgeChange(ticket, patch, opts.provider);
  if (!verdict.genuinelyResolves) {
    return decided(
      "declined",
      `Tests pass, but the change was rejected on review: ${verdict.reason}`,
    );
  }
  return decided("approved", verdict.reason);
}

/** Run a minion on a sandbox copy (the local demo path). */
export async function runMinion(
  ticket: Ticket,
  opts: { provider?: string; maxSteps?: number; onProgress?: (m: string) => void } = {},
): Promise<MinionReceipt> {
  const { workspace, branch } = prepareWorkspace(SANDBOX_DIR, RUNS_DIR, ticket.id);
  const decision = await workTicket(workspace, ticket, opts);
  if (decision.status === "approved") {
    workspace.commit(`${ticket.id}: ${ticket.title}`);
  }
  return writeReceipt({
    ticketId: ticket.id,
    title: ticket.title,
    model: modelLabel(opts.provider),
    status: decision.status === "approved" ? "shipped" : decision.status,
    reason: decision.reason,
    branch,
    steps: decision.steps,
    toolCalls: decision.toolCalls,
    baselineTests: { passed: decision.baseline.passed, total: decision.baseline.total },
    finalTests: testToReceipt(decision.finalTests),
    patch: decision.patch,
  });
}

export function testToReceipt(t: TestResult) {
  return { ok: t.ok, passed: t.passed, failed: t.failed, total: t.total };
}

export function writeReceipt(receipt: MinionReceipt): MinionReceipt {
  mkdirSync(RECEIPTS_DIR, { recursive: true });
  writeFileSync(
    path.join(RECEIPTS_DIR, `${receipt.ticketId}.json`),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  return receipt;
}
