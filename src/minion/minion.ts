import { generateText, generateObject, stepCountIs } from "ai";
import { z } from "zod";
import path from "node:path";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { getModel, modelLabel } from "../model";
import { prepareWorkspace, type TestResult, type Workspace } from "./workspace";
import { minionTools, minionReadTools } from "./tools";
import { generateMutants } from "./mutate";
import { extractFileHints, resolveHints, buildScopeNote } from "./scope";
import { loadProfile, saveProfile, mergeProfile } from "./profile";
import { assessRisk, type RiskAssessment } from "./risk";
import { confidenceFor, type Confidence } from "./confidence";
import { readUsage, addUsage, estimateCostUsd, ZERO_USAGE, type TokenUsage } from "./pricing";
import { redTeam, survivesPanel, panelSize } from "./verify";

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
  /** Token usage totalled across every model call in the run. */
  usage?: TokenUsage;
  /** Estimated USD cost of the run (see pricing.ts — an estimate, not billing). */
  costUsd?: number;
  /** Wall-clock duration of the run, in milliseconds. */
  durationMs?: number;
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
): Promise<{ genuinelyResolves: boolean; reason: string; usage: TokenUsage }> {
  const { object, usage } = await generateObject({
    model: getModel(provider),
    schema: verdictSchema,
    system:
      "You review a code change a coding agent made for a ticket. All tests pass. Decide whether the diff is a legitimate, minimal fix that genuinely addresses the ticket — not gaming (e.g. hard-coding a test's expected value, deleting functionality, or sweeping unrelated edits).",
    prompt: `Ticket: ${ticket.title}\n${ticket.body}\n\nDiff:\n${patch || "(no changes)"}\n\nIs this a legitimate, minimal fix for the ticket?`,
  });
  return { ...object, usage: readUsage(usage) };
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
  /** Token usage totalled across the run's model calls. */
  usage: TokenUsage;
  /** Estimated USD cost of the run. */
  costUsd: number;
  /** Wall-clock duration of the run, in milliseconds. */
  durationMs: number;
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
    /** Best-of-N: how many independent candidate fixes to try (default 1; also MINION_CANDIDATES). */
    candidates?: number;
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
  const startedAt = Date.now();
  const meter = { usage: ZERO_USAGE };
  // Stamp every Decision with the run's accumulated economics on the way out,
  // so cost/tokens/time are recorded whether it shipped, declined, or errored.
  const finalize = (d: Decision): Decision => ({
    ...d,
    steps,
    toolCalls,
    usage: meter.usage,
    costUsd: estimateCostUsd(meter.usage, modelLabel(opts.provider)),
    durationMs: Date.now() - startedAt,
  });

  // Phase 1 — orient and plan: understand the code and decide the change BEFORE
  // writing anything. A plan failure is the one thing that ends the run here.
  let plan: string;
  try {
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
    plan = planResult.text.trim();
    steps += planResult.steps.length;
    toolCalls += planResult.steps.flatMap((s) => s.toolCalls ?? []).length;
    meter.usage = addUsage(meter.usage, readUsage(planResult.totalUsage));
    log(`plan ready — ${firstLine(plan)}`);
  } catch (error) {
    return finalize(errorDecision(error, baseline, steps, toolCalls));
  }

  // Only now, with the codebase understood and a plan in hand, branch off main.
  opts.onPlanReady?.();

  // Phase 2 — implement and gate, possibly several independent times. Best-of-N:
  // each candidate implements the SAME plan from a clean baseline, blind to the
  // others, and runs the full gate; we keep the strongest one. One attempt by
  // default — opts.candidates / MINION_CANDIDATES turns the tournament on.
  const n = candidateCount(opts);
  const attempts: Decision[] = [];
  for (let i = 0; i < n; i++) {
    if (n > 1) {
      if (i > 0) workspace.reset(); // each candidate starts from the same clean slate
      log(`candidate ${i + 1}/${n} — implementing…`);
    } else {
      log("implementing…");
    }
    try {
      const cost = await implementPlan(workspace, ticket, plan, opts, i, n);
      steps += cost.steps;
      toolCalls += cost.toolCalls;
      meter.usage = addUsage(meter.usage, cost.usage);
    } catch (error) {
      // One candidate's model error shouldn't sink the whole tournament.
      if (n === 1) return finalize(errorDecision(error, baseline, steps, toolCalls));
      log(`candidate ${i + 1} errored, skipping: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const outcome = await evaluateGate(workspace, ticket, baseline, opts, log, meter);
    attempts.push(outcome);
    if (n > 1) {
      log(`candidate ${i + 1}/${n}: ${describe(outcome)}`);
      // Cost guard: a clearly-shippable candidate is good enough — stop early.
      // Tunable via MINION_TOURNAMENT_EARLY (default 0.9; set >1 to always run
      // the full field, e.g. to compare candidates).
      if (
        outcome.status === "approved" &&
        !outcome.requiresReview &&
        outcome.confidence.score >= earlyExitFloor()
      ) {
        log("a strong candidate cleared the bar — ending the tournament early");
        break;
      }
    }
  }

  if (attempts.length === 0) {
    return finalize(errorDecision(new Error("every candidate failed to run"), baseline, steps, toolCalls));
  }

  const winner = selectWinner(attempts);
  if (n > 1) {
    const approved = attempts.filter((a) => a.status === "approved").length;
    log(`tournament: ${attempts.length} ran, ${approved} approved — picked ${describe(winner)}`);
    // We may have reset past the winner while running later candidates; restore
    // its change into the working tree so the caller can commit it.
    workspace.reset();
    workspace.applyPatch(winner.patch);
  }

  // Learn for next time: remember the test command, file tree, and the files
  // the WINNING change touched, so the next visit to this repo orients faster.
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

  return finalize(winner);
}

/** Confidence at which a tournament stops early; >1 means never stop early. */
function earlyExitFloor(): number {
  const v = Number(process.env.MINION_TOURNAMENT_EARLY);
  return Number.isFinite(v) && v > 0 ? v : 0.9;
}

/** How many independent candidate fixes to try, capped for cost. */
function candidateCount(opts: { candidates?: number }): number {
  const raw =
    opts.candidates != null && Number.isFinite(opts.candidates)
      ? opts.candidates
      : Number(process.env.MINION_CANDIDATES);
  const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
  return Math.min(5, Math.max(1, n));
}

function errorDecision(
  error: unknown,
  baseline: TestResult,
  steps: number,
  toolCalls: number,
): Decision {
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
    usage: ZERO_USAGE,
    costUsd: 0,
    durationMs: 0,
  };
}

/** One-line summary of a candidate's outcome, for the tournament log. */
function describe(d: Decision): string {
  if (d.status === "approved")
    return `approved · confidence ${d.confidence.score.toFixed(2)} · risk ${d.risk.level}`;
  return d.status === "declined" ? "declined" : "errored";
}

/**
 * Pick the best of the candidates. Approved beats not-approved; among approved,
 * the order is highest confidence, then lowest blast radius, then smallest diff
 * (a tidy fix over a sprawling one). Pure, so the tie-breaks are unit-tested. If
 * none were approved we return a declined one (more informative than an error).
 */
export function selectWinner(attempts: Decision[]): Decision {
  const approved = attempts.filter((a) => a.status === "approved");
  if (approved.length > 0) {
    return approved.slice().sort(
      (a, b) =>
        b.confidence.score - a.confidence.score ||
        a.risk.score - b.risk.score ||
        a.patch.length - b.patch.length,
    )[0];
  }
  return attempts.find((a) => a.status === "declined") ?? attempts[0];
}

/** Phase 2 for one candidate: carry out the plan with the write-capable tools. */
async function implementPlan(
  workspace: Workspace,
  ticket: Ticket,
  plan: string,
  opts: { provider?: string; maxSteps?: number },
  index: number,
  total: number,
): Promise<{ steps: number; toolCalls: number; usage: TokenUsage }> {
  // For a tournament, nudge each attempt to decide independently so the
  // candidates actually differ rather than converging on one answer.
  const variation =
    total > 1
      ? `\n\nThis is independent attempt ${index + 1} of ${total}. Decide for yourself the cleanest, most minimal correct fix; do not assume how any other attempt approached it.`
      : "";
  const result = await generateText({
    model: getModel(opts.provider),
    system: implementSystemPrompt(),
    prompt: `Ticket:\n\n[${ticket.id}] ${ticket.title}\n${ticket.body}\n\nYour plan:\n${plan}\n\nImplement it now.${variation}`,
    tools: minionTools(workspace),
    stopWhen: stepCountIs(opts.maxSteps ?? 14),
  });
  return {
    steps: result.steps.length,
    toolCalls: result.steps.flatMap((s) => s.toolCalls ?? []).length,
    usage: readUsage(result.totalUsage),
  };
}

/**
 * The gate, applied to whatever the workspace currently holds: re-run the tests
 * as ground truth, reject regressions and no-ops, run the mutation check and the
 * judge, then score confidence + blast radius. Returns a Decision with
 * steps/toolCalls left at 0 — the caller folds in the run's cumulative counts.
 */
async function evaluateGate(
  workspace: Workspace,
  ticket: Ticket,
  baseline: TestResult,
  opts: { provider?: string },
  log: (m: string) => void,
  meter: { usage: TokenUsage },
): Promise<Decision> {
  const finalTests = workspace.runTests();
  const patch = workspace.stagedDiff();
  log(`final: ${finalTests.passed}/${finalTests.total} passing — verifying…`);

  const decided = (status: Decision["status"], reason: string): Decision => ({
    status,
    reason,
    patch,
    baseline,
    finalTests,
    steps: 0,
    toolCalls: 0,
    confidence: NO_CONFIDENCE,
    risk: NO_RISK,
    requiresReview: false,
    usage: ZERO_USAGE,
    costUsd: 0,
    durationMs: 0,
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
  meter.usage = addUsage(meter.usage, verdict.usage);
  if (!verdict.genuinelyResolves) {
    return decided(
      "declined",
      `Tests pass, but the change was rejected on review: ${verdict.reason}`,
    );
  }

  // Gate 2.5 (optional): an adversarial panel. Where the judge asks "is this
  // good?", a panel of independent skeptics each tries to REFUTE the change
  // through a different lens; it survives only if it beats a majority. Opt-in
  // via MINION_VERIFIERS, since it spends extra tokens.
  const verifiers = panelSize();
  if (verifiers > 0) {
    log(`adversarial review: ${verifiers} independent verifiers…`);
    const panel = await redTeam(ticket, patch, opts.provider, verifiers);
    meter.usage = addUsage(meter.usage, panel.usage);
    const refutals = panel.verdicts.filter((v) => v.refuted);
    log(`adversarial review: ${refutals.length}/${panel.verdicts.length} voted to refute`);
    if (!survivesPanel(panel.verdicts)) {
      return decided(
        "declined",
        `Adversarial review refuted the change (${refutals.length}/${panel.verdicts.length}): ${refutals[0]?.reason ?? "majority found it unsound"}`,
      );
    }
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

  return decidedApproved(patch, baseline, finalTests, verdict.reason, confidence, risk, requiresReview);
}

/** Build the approved Decision (steps/toolCalls folded in by the caller). */
function decidedApproved(
  patch: string,
  baseline: TestResult,
  finalTests: TestResult,
  reason: string,
  confidence: Confidence,
  risk: RiskAssessment,
  requiresReview: boolean,
): Decision {
  return {
    status: "approved",
    reason,
    patch,
    baseline,
    finalTests,
    steps: 0,
    toolCalls: 0,
    confidence,
    risk,
    requiresReview,
    usage: ZERO_USAGE,
    costUsd: 0,
    durationMs: 0,
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
    usage: decision.usage,
    costUsd: decision.costUsd,
    durationMs: decision.durationMs,
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

/** Load every run receipt on disk (for `forge costs` and other roll-ups). */
export function loadReceipts(): MinionReceipt[] {
  if (!existsSync(RECEIPTS_DIR)) return [];
  return readdirSync(RECEIPTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(RECEIPTS_DIR, f), "utf8")) as MinionReceipt);
}
