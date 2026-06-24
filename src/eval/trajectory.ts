import { buildAgent } from "../builder";
import { refineAgent } from "../refine";
import { Tracer, setTracer } from "../trace";

/**
 * Trajectory-level evaluation. The verification-gate eval (`forge eval`) grades
 * the final decision — ship or decline. This grades the *path*: run a set of
 * build tasks through the full build → test → repair loop and measure how the
 * trajectory behaved — did it converge, did it recover from a failing first
 * build, how many repair rounds it took, and what it cost in tokens and time.
 *
 * This is the multi-step / failure-mode lens that single-output metrics miss:
 * two agents can both end up passing, but one that needed three repair rounds is
 * a different (and more fragile) trajectory than one that passed on the first build.
 */

export interface TrajectoryCase {
  id: string;
  description: string;
}

export interface TrajectoryResult {
  id: string;
  agent: string;
  /** Repair rounds the loop took after the initial build. */
  rounds: number;
  /** The first build failed at least one of its own tests. */
  startedFailing: boolean;
  /** Started failing, then reached all-passing by the end. */
  recovered: boolean;
  /** Ended with every test passing. */
  converged: boolean;
  finalPassed: number;
  finalTotal: number;
  tokens: number;
  ms: number;
  error?: string;
}

export interface TrajectorySummary {
  total: number;
  converged: number;
  convergenceRate: number;
  startedFailing: number;
  recovered: number;
  /** Recoveries as a share of trajectories that started failing. */
  recoveryRate: number;
  avgRounds: number;
  totalTokens: number;
  totalMs: number;
}

export interface TrajectoryReport {
  results: TrajectoryResult[];
  summary: TrajectorySummary;
}

export async function evaluateTrajectories(
  cases: TrajectoryCase[],
  opts: { provider?: string; maxRounds?: number; onLog?: (m: string) => void } = {},
): Promise<TrajectoryReport> {
  const log = opts.onLog ?? (() => {});
  const results: TrajectoryResult[] = [];

  for (const testCase of cases) {
    const tracer = new Tracer(`traj-${testCase.id}`);
    setTracer(tracer);
    try {
      log(`building "${testCase.id}"…`);
      const { spec } = await buildAgent(testCase.description, { provider: opts.provider });
      const { receipt } = await refineAgent(spec, {
        provider: opts.provider,
        maxRounds: opts.maxRounds,
      });
      const round0 = receipt.rounds[0];
      const startedFailing = round0 ? round0.passed < round0.total : false;
      const converged = receipt.status === "passing";
      results.push({
        id: testCase.id,
        agent: spec.name,
        rounds: Math.max(0, receipt.rounds.length - 1),
        startedFailing,
        recovered: startedFailing && converged,
        converged,
        finalPassed: receipt.finalPassed,
        finalTotal: receipt.finalTotal,
        tokens: tracer.totalTokens,
        ms: tracer.totalMs,
      });
    } catch (error) {
      results.push({
        id: testCase.id,
        agent: testCase.id,
        rounds: 0,
        startedFailing: false,
        recovered: false,
        converged: false,
        finalPassed: 0,
        finalTotal: 0,
        tokens: tracer.totalTokens,
        ms: tracer.totalMs,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTracer(null);
      tracer.persist();
    }
  }

  return { results, summary: summarize(results) };
}

export function summarize(results: TrajectoryResult[]): TrajectorySummary {
  const total = results.length;
  const converged = results.filter((r) => r.converged).length;
  const startedFailing = results.filter((r) => r.startedFailing).length;
  const recovered = results.filter((r) => r.recovered).length;
  const totalRounds = results.reduce((n, r) => n + r.rounds, 0);
  return {
    total,
    converged,
    convergenceRate: total ? converged / total : 0,
    startedFailing,
    recovered,
    recoveryRate: startedFailing ? recovered / startedFailing : 0,
    avgRounds: total ? totalRounds / total : 0,
    totalTokens: results.reduce((n, r) => n + r.tokens, 0),
    totalMs: results.reduce((n, r) => n + r.ms, 0),
  };
}
