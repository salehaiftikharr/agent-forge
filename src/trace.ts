import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";

/**
 * Observability for Forge. Every model call in the build → run → judge → repair
 * loop flows through `tracedGenerate`, which records a span: what kind of step
 * it was, how long it took, how many tokens it spent, how many tool-call steps
 * it ran, and whether it failed. A run's spans are its trace — the same prompts,
 * tool calls, latencies, and failures you would want when an agent misbehaves in
 * production, captured locally so a run is auditable after the fact.
 *
 * The tracer is a module-level singleton (one run at a time in the CLI), so call
 * sites stay clean: they wrap their AI SDK call and the active tracer, if any,
 * collects the span. No tracer set → zero overhead, nothing recorded.
 */

export type SpanType =
  | "build"
  | "run"
  | "judge"
  | "repair"
  | "model"
  | "tool"
  | "memory"
  | "other";

export interface Span {
  type: SpanType;
  label: string;
  /** Wall-clock duration of the call, in milliseconds. */
  ms: number;
  /** Total tokens the call spent, when the provider reports usage. */
  tokens?: number;
  /** Tool-call steps the agent took inside this call (run spans). */
  steps?: number;
  /** ISO timestamp the span finished. */
  at: string;
  ok: boolean;
  error?: string;
}

export interface TraceSummary {
  runId: string;
  spans: number;
  totalMs: number;
  totalTokens: number;
  failures: number;
  /** Per-type rollup: count, time, and tokens for build/run/judge/repair/…. */
  byType: Record<string, { count: number; ms: number; tokens: number; failures: number }>;
}

const TRACE_DIR = path.join(process.cwd(), ".forge-traces");

export class Tracer {
  readonly runId: string;
  readonly spans: Span[] = [];
  private readonly startedAt = Date.now();

  constructor(runId: string) {
    this.runId = runId;
  }

  record(span: Span): void {
    this.spans.push(span);
  }

  get totalMs(): number {
    return Date.now() - this.startedAt;
  }

  get totalTokens(): number {
    return this.spans.reduce((sum, s) => sum + (s.tokens ?? 0), 0);
  }

  summary(): TraceSummary {
    const byType: TraceSummary["byType"] = {};
    for (const s of this.spans) {
      const t = (byType[s.type] ??= { count: 0, ms: 0, tokens: 0, failures: 0 });
      t.count++;
      t.ms += s.ms;
      t.tokens += s.tokens ?? 0;
      if (!s.ok) t.failures++;
    }
    return {
      runId: this.runId,
      spans: this.spans.length,
      totalMs: this.totalMs,
      totalTokens: this.totalTokens,
      failures: this.spans.filter((s) => !s.ok).length,
      byType,
    };
  }

  /** Write the trace to .forge-traces/<runId>.jsonl (one span per line). */
  persist(): string {
    mkdirSync(TRACE_DIR, { recursive: true });
    const file = path.join(TRACE_DIR, `${this.runId}.jsonl`);
    const header = { kind: "trace", runId: this.runId, summary: this.summary() };
    const lines = [JSON.stringify(header), ...this.spans.map((s) => JSON.stringify(s))];
    writeFileSync(file, lines.join("\n") + "\n");
    return file;
  }
}

let active: Tracer | null = null;

export function activeTracer(): Tracer | null {
  return active;
}

export function setTracer(tracer: Tracer | null): void {
  active = tracer;
}

/** Run `fn` inside a fresh tracer, persist the trace, and return both. */
export async function withTrace<T>(
  runId: string,
  fn: () => Promise<T>,
): Promise<{ value: T; tracer: Tracer }> {
  const tracer = new Tracer(runId);
  const previous = active;
  active = tracer;
  try {
    const value = await fn();
    return { value, tracer };
  } finally {
    active = previous;
    tracer.persist();
  }
}

/**
 * Wrap an AI SDK call so the active tracer records a span for it. Returns the
 * call's result untouched, so call sites change by one line and keep their types.
 */
export async function tracedGenerate<T>(
  label: string,
  type: SpanType,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    active?.record({
      type,
      label,
      ms: Date.now() - start,
      tokens: usageTokens((result as Record<string, unknown>)?.usage),
      steps: spanSteps(result),
      at: new Date().toISOString(),
      ok: true,
    });
    return result;
  } catch (error) {
    active?.record({
      type,
      label,
      ms: Date.now() - start,
      at: new Date().toISOString(),
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Normalize the several token-usage shapes the AI SDK / providers report. */
export function usageTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as Record<string, number | undefined>;
  if (typeof u.totalTokens === "number") return u.totalTokens;
  const input = u.inputTokens ?? u.promptTokens ?? 0;
  const output = u.outputTokens ?? u.completionTokens ?? 0;
  const total = input + output;
  return total > 0 ? total : undefined;
}

function spanSteps(result: unknown): number | undefined {
  if (result && typeof result === "object" && Array.isArray((result as { steps?: unknown[] }).steps)) {
    return (result as { steps: unknown[] }).steps.length;
  }
  return undefined;
}

// ---- Reading traces back (for `forge trace`) ----

export function loadTrace(runId: string): { summary: TraceSummary; spans: Span[] } | null {
  const file = path.join(TRACE_DIR, `${runId}.jsonl`);
  if (!existsSync(file)) return null;
  return parseTraceFile(file);
}

export function loadLatestTrace(): { summary: TraceSummary; spans: Span[] } | null {
  if (!existsSync(TRACE_DIR)) return null;
  const files = readdirSync(TRACE_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ f, mtime: statSync(path.join(TRACE_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) return null;
  return parseTraceFile(path.join(TRACE_DIR, files[0].f));
}

function parseTraceFile(file: string): { summary: TraceSummary; spans: Span[] } {
  const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  const header = JSON.parse(lines[0]) as { summary: TraceSummary };
  const spans = lines.slice(1).map((l) => JSON.parse(l) as Span);
  return { summary: header.summary, spans };
}
