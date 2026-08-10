/* Real, engine-backed data. Read directly from the Agent Forge engine's on-disk
   output at the repo root (one level up from web/). This is the genuine record
   the CLI/minions produce; surfaces that use it are labelled "engine". Never
   throws: a missing file yields null/[] so the app degrades honestly. */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { EvalReport } from "./types";

// Real engine output, vendored into the repo so the app is self-contained and
// reproducible on any clone/CI. This is the genuine recorded evaluation the
// Agent Forge engine produced; it is not live, so surfaces label it "from the
// engine's evaluation", never "live".
const ENGINE_DIR = join(process.cwd(), "engine-data");

function readJson<T>(rel: string): T | null {
  try {
    const p = join(ENGINE_DIR, rel);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

export interface EngineReceipt {
  ticketId: string;
  title: string;
  model: string;
  status: "shipped" | "declined";
  reason: string;
  branch?: string;
  steps: number;
  toolCalls: number;
  baselineTests?: { passed: number; total: number };
  finalTests?: { ok: boolean; passed: number; failed: number; total: number };
  patch?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  costUsd?: number;
  durationMs?: number;
  confidence?: { score: number; level: string };
  risk?: { level: string; score: number; factors: string[] };
  requiresReview?: boolean;
}

export function getEvalReport(): EvalReport | null {
  return readJson<EvalReport>("report.json");
}

export function getReceipts(): EngineReceipt[] {
  try {
    const dir = join(ENGINE_DIR, "receipts");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as EngineReceipt);
  } catch {
    return [];
  }
}

export interface EngineCorpus {
  summary: { total: number; accepted: number; rejected: number; pending: number; declined: number };
  cases: { ticketId: string; minionStatus: string; humanOutcome: string; label: string; note: string }[];
}

export function getCorpus(): EngineCorpus | null {
  return readJson<EngineCorpus>("corpus.json");
}
