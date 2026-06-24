import { testAgent, type CaseResult } from "./judge";
import { repairAgent } from "./repair";
import { modelLabel } from "./model";
import { recordLessons, keywords } from "./memory";
import type { AgentSpec, Receipt, ReceiptRound } from "./spec";

/**
 * The self-repair loop — Forge's headline.
 *
 *   test → (fail?) → repair → test → … until everything passes or the round
 *   cap is hit.
 *
 * It returns the best spec it reached plus a RECEIPT: the round-by-round record
 * of what failed, what each repair changed, and where it landed. The receipt is
 * the point — a built agent ships with proof of what it does reliably, not just
 * a prompt someone hopes works.
 */
export interface RefineResult {
  spec: AgentSpec;
  receipt: Receipt;
  /** The final round's graded cases (for detailed display). */
  cases: CaseResult[];
}

export async function refineAgent(
  spec: AgentSpec,
  opts: {
    provider?: string;
    maxRounds?: number;
    onProgress?: (message: string) => void;
  } = {},
): Promise<RefineResult> {
  const maxRounds = opts.maxRounds ?? 3;
  const log = opts.onProgress ?? (() => {});
  const rounds: ReceiptRound[] = [];

  let current = spec;

  // Round 0: grade the agent as built.
  log("testing the initial build…");
  let report = await testAgent(current, opts);
  rounds.push({
    round: 0,
    passed: report.passed,
    total: report.total,
    failingInputs: report.cases.filter((c) => !c.pass).map((c) => c.input),
  });

  let round = 0;
  while (report.passed < report.total && round < maxRounds) {
    round++;
    const failures = report.cases.filter((c) => !c.pass);
    const passedBefore = report.passed;
    log(
      `${report.passed}/${report.total} passing — repairing (round ${round}/${maxRounds})…`,
    );
    const repaired = await repairAgent(current, failures, opts);
    current = repaired.spec;
    report = await testAgent(current, opts);
    rounds.push({
      round,
      changeSummary: repaired.changeSummary,
      passed: report.passed,
      total: report.total,
      failingInputs: report.cases.filter((c) => !c.pass).map((c) => c.input),
    });

    // Persistent memory: if this repair actually moved the needle, remember the
    // fix so future builds and repairs of similar tasks can reuse it.
    if (report.passed > passedBefore) {
      const failingInput = failures.map((f) => f.input).join("; ");
      recordLessons([
        {
          at: new Date().toISOString(),
          agent: current.name,
          failingInput,
          fix: repaired.changeSummary,
          keywords: keywords(
            `${current.name} ${failingInput} ${failures.map((f) => f.expectation).join(" ")}`,
          ),
        },
      ]);
    }
  }

  const receipt: Receipt = {
    name: current.name,
    description: current.description,
    model: modelLabel(opts.provider),
    status: report.passed === report.total ? "passing" : "incomplete",
    finalPassed: report.passed,
    finalTotal: report.total,
    rounds,
  };

  return { spec: current, receipt, cases: report.cases };
}
