import { generateText, generateObject, stepCountIs } from "ai";
import { z } from "zod";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { getModel, modelLabel } from "../model";
import { prepareWorkspace, type TestResult, type Workspace } from "./workspace";
import { minionTools, minionReadTools } from "./tools";
import { generateMutants } from "./mutate";
import { extractFileHints, resolveHints, buildScopeNote } from "./scope";
import { loadProfile, saveProfile, mergeProfile } from "./profile";
import { assessRisk, type RiskAssessment } from "./risk";
import { confidenceFor, type Confidence } from "./confidence";

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
  /** Calibrated 0..1 confidence and its level, when the change was approved. */
  confidence?: { score: number; level: "high" | "medium" | "low" };
  /** Blast-radius assessment of the diff, when the change was approved. */
  risk?: { level: "low" | "medium" | "high"; score: number; factors: string[] };
  /** True when an approved change was sent for human review (a draft PR). */
  requiresReview?: boolean;
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

/**
 * Mutation gate: perturb the fix's own lines (delete them, flip comparisons,
 * swap constants) and re-run. If the previously-green result survives EVERY
 * mutation, the test is not actually pinning the fix — likely gamed or
 * hard-coded — so decline. Mechanical, no model involved. Capped by
 * MINION_MUTANTS (default 6; 0 disables). Always restores the real fix.
 */
interface MutationResult {
  /** A decline reason if the change survived every mutant, else null. */
  reason: string | null;
  caught: number;
  total: number;
}

function runMutationGate(
  workspace: Workspace,
  perTestMode: boolean,
  newPasses: string[],
  log: (m: string) => void,
): MutationResult {
  const cap = process.env.MINION_MUTANTS != null ? Number(process.env.MINION_MUTANTS) : 6;
  if (!Number.isFinite(cap) || cap <= 0) return { reason: null, caught: 0, total: 0 };

  const changed = workspace.changedSourceLines();
  const files = Object.keys(changed);
  if (files.length === 0) return { reason: null, caught: 0, total: 0 };

  const stillFixed = (r: TestResult): boolean =>
    perTestMode ? newPasses.every((n) => r.tests[n] === true) : r.ok;

  let total = 0;
  let caught = 0;
  for (const file of files) {
    if (total >= cap) break;
    const original = workspace.read(file);
    const perFile = Math.max(1, Math.ceil(cap / files.length));
    try {
      for (const mutant of generateMutants(original, changed[file], perFile)) {
        if (total >= cap) break;
        workspace.write(file, mutant.content);
        const survived = stillFixed(workspace.runTests(1));
        total += 1;
        if (!survived) caught += 1;
      }
    } finally {
      workspace.write(file, original); // always put the real fix back
    }
  }

  if (total === 0) return { reason: null, caught: 0, total: 0 }; // nothing mutatable — can't assess, don't block
  log(`mutation check: ${caught}/${total} mutants caught`);
  if (caught === 0) {
    return {
      reason:
        "Mutation check failed: the changed code could be deleted or its logic flipped and the previously-failing test still passed, so the test is not actually pinning the fix. Declined as likely gamed.",
      caught,
      total,
    };
  }
  return { reason: null, caught, total };
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
  /** Calibrated 0..1 confidence + level (only meaningful when approved). */
  confidence: Confidence;
  /** Blast-radius assessment of the diff (only meaningful when approved). */
  risk: RiskAssessment;
  /**
   * True when an approved change should still go to a human before merge —
   * low confidence or high blast radius. The caller opens it as a draft PR
   * rather than a ready-to-merge one. This is the auto-ship gate.
   */
  requiresReview: boolean;
}

/** Confidence/risk placeholders for the paths that never reach scoring. */
const NO_CONFIDENCE: Confidence = { score: 0, level: "low" };
const NO_RISK: RiskAssessment = {
  level: "low",
  score: 0,
  factors: [],
  filesChanged: 0,
  linesAdded: 0,
  linesRemoved: 0,
};

/** Auto-ship floor: at or above this confidence, and not high-risk, ships ready-to-merge. */
function confidenceFloor(): number {
  const v = Number(process.env.MINION_CONFIDENCE_MIN);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.7;
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
    /** A stable key (e.g. the repo) for the per-repo profile that seeds and learns across runs. */
    repoKey?: string;
  } = {},
): Promise<Decision> {
  const log = opts.onProgress ?? (() => {});
  const baseline = workspace.runTests();
  log(`baseline: ${baseline.passed}/${baseline.total} tests passing`);

  // Orient: seed the study step from the ticket's own file hints and what we
  // learned on past visits, so it goes straight to the relevant files instead
  // of reading the whole tree. Hoisted so we can fold this run back into the
  // profile afterward.
  const repoFiles = workspace.listFiles();
  const profile = opts.repoKey ? loadProfile(opts.repoKey) : null;
  const hints = resolveHints(
    extractFileHints(`${ticket.title}\n${ticket.body}`),
    repoFiles,
  );
  const scopeNote = buildScopeNote(hints, profile?.hotFiles ?? [], workspace.testCommand());

  let steps = 0;
  let toolCalls = 0;
  try {
    // Phase 1 — orient and plan: understand the code and decide the change
    // BEFORE writing anything.
    if (hints.length) log(`scope hints: ${hints.join(", ")}`);
    log("studying the codebase…");
    const planResult = await generateText({
      model: getModel(opts.provider),
      system: planSystemPrompt(),
      prompt: `Ticket:\n\n[${ticket.id}] ${ticket.title}\n${ticket.body}\n\n${scopeNote}\n\nStudy the repository, then write your plan.`.replace(
        /\n{3,}/g,
        "\n\n",
      ),
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
      confidence: NO_CONFIDENCE,
      risk: NO_RISK,
      requiresReview: false,
    };
  }

  // Ground truth: re-run the tests ourselves. Never trust the model's claim.
  const finalTests = workspace.runTests();
  const patch = workspace.stagedDiff();
  log(`final: ${finalTests.passed}/${finalTests.total} passing — verifying…`);

  // Learn for next time: remember the test command, file tree, and the files
  // this run gravitated to, so the next visit to this repo orients faster.
  if (opts.repoKey) {
    const touched = [...hints, ...Object.keys(workspace.changedSourceLines())];
    saveProfile(
      mergeProfile(opts.repoKey, profile, {
        testCommand: workspace.testCommand(),
        files: repoFiles,
        touched,
      }),
    );
  }

  const decided = (status: Decision["status"], reason: string): Decision => ({
    status,
    reason,
    patch,
    baseline,
    finalTests,
    steps,
    toolCalls,
    confidence: NO_CONFIDENCE,
    risk: NO_RISK,
    requiresReview: false,
  });

  // Gate 1: no regressions, and real progress. With a per-test map we reason
  // test-by-test (so unrelated failing tests can stay failing); with only an
  // exit code we require the whole suite to flip from failing to passing.
  const perTestMode = baseline.perTest && finalTests.perTest;
  let newPasses: string[] = [];
  if (perTestMode) {
    const regressions = Object.keys(baseline.tests).filter(
      (name) => baseline.tests[name] && finalTests.tests[name] === false,
    );
    newPasses = Object.keys(finalTests.tests).filter(
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

  // Gate 1.5: mutation testing. A green test proves the test is satisfied, not
  // that the fix is real. Perturb the changed lines and re-run — if the
  // now-green result survives every mutation, the test is not pinning the fix.
  log("mutation-testing the fix…");
  const mutation = runMutationGate(workspace, perTestMode, newPasses, log);
  if (mutation.reason) return decided("declined", mutation.reason);

  // Gate 2: the change must be a legitimate, minimal fix, not gamed.
  const verdict = await judgeChange(ticket, patch, opts.provider);
  if (!verdict.genuinelyResolves) {
    return decided(
      "declined",
      `Tests pass, but the change was rejected on review: ${verdict.reason}`,
    );
  }

  // Approved — every gate passed. Now score HOW the change should ship: assess
  // its blast radius, turn the gate signals into a calibrated confidence, and
  // decide whether it can ship ready-to-merge or should go to a human as a
  // draft. This never blocks a correct change; it only chooses the lane.
  const risk = assessRisk(patch);
  const confidence = confidenceFor(
    {
      newPasses: newPasses.length,
      mutantsCaught: mutation.caught,
      mutantsTotal: mutation.total,
      judgeResolves: verdict.genuinelyResolves,
    },
    risk,
  );
  const requiresReview =
    confidence.score < confidenceFloor() || risk.level === "high";
  log(
    `confidence ${confidence.score.toFixed(2)} (${confidence.level}) · risk ${risk.level} — ${
      requiresReview ? "opening as a draft for review" : "clear to auto-ship"
    }`,
  );

  return {
    status: "approved",
    reason: verdict.reason,
    patch,
    baseline,
    finalTests,
    steps,
    toolCalls,
    confidence,
    risk,
    requiresReview,
  };
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
    ...decisionScores(decision),
  });
}

export function testToReceipt(t: TestResult) {
  return { ok: t.ok, passed: t.passed, failed: t.failed, total: t.total };
}

/** The confidence/risk fields for a receipt — only populated on an approved change. */
export function decisionScores(
  decision: Decision,
): Pick<MinionReceipt, "confidence" | "risk" | "requiresReview"> {
  if (decision.status !== "approved") return {};
  return {
    confidence: { score: decision.confidence.score, level: decision.confidence.level },
    risk: {
      level: decision.risk.level,
      score: decision.risk.score,
      factors: decision.risk.factors,
    },
    requiresReview: decision.requiresReview,
  };
}

export function writeReceipt(receipt: MinionReceipt): MinionReceipt {
  mkdirSync(RECEIPTS_DIR, { recursive: true });
  writeFileSync(
    path.join(RECEIPTS_DIR, `${receipt.ticketId}.json`),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  return receipt;
}
