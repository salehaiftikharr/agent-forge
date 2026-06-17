import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * The learning loop's outcome half. Receipts already record what each minion
 * did; this checks what HUMANS then did with the resulting PRs and turns it into
 * a labeled corpus:
 *
 *   shipped + merged   → a confirmed good ship
 *   shipped + closed   → a real counterexample (the gate let through work a
 *                        human rejected) — the most valuable signal there is
 *   declined           → a good decline (the minion held back on its own)
 *
 * Run it periodically (or on a cron — that's the "watcher") so the
 * zero-unsafe-ships claim is defended continuously against reality, not just
 * once on a fixed eval set.
 */
const RECEIPTS_DIR = path.join(process.cwd(), "minion-receipts");
const CORPUS_FILE = path.join(process.cwd(), "minion-corpus.json");

export type PrState = "OPEN" | "CLOSED" | "MERGED";
export type MinionStatus = "shipped" | "declined" | "error";

export interface CorpusCase {
  ticketId: string;
  repo?: string;
  prUrl?: string;
  minionStatus: MinionStatus;
  humanOutcome: "accepted" | "rejected" | "pending" | "none";
  label: "good" | "bad" | "unknown";
  note: string;
}

export interface ReceiptLike {
  ticketId: string;
  status: MinionStatus;
  prUrl?: string;
}

/** "https://github.com/owner/repo/pull/7" → "owner/repo". */
export function repoFromPrUrl(url?: string): string | undefined {
  const m = (url ?? "").match(/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/);
  return m ? m[1] : undefined;
}

/** Label a single case from what the minion did and what the human did with the PR. */
export function classify(
  minionStatus: MinionStatus,
  prState: PrState | null,
): Pick<CorpusCase, "humanOutcome" | "label" | "note"> {
  if (minionStatus === "error") {
    return { humanOutcome: "none", label: "unknown", note: "Errored before reaching a decision." };
  }
  if (minionStatus === "declined") {
    return {
      humanOutcome: "none",
      label: "good",
      note: "Declined — the minion held back rather than ship a doubtful fix.",
    };
  }
  // shipped
  if (prState === "MERGED") {
    return { humanOutcome: "accepted", label: "good", note: "Shipped and a human merged it — a confirmed good ship." };
  }
  if (prState === "CLOSED") {
    return {
      humanOutcome: "rejected",
      label: "bad",
      note: "Shipped, but a human closed the PR without merging — a counterexample the gate should learn from.",
    };
  }
  if (prState === "OPEN") {
    return { humanOutcome: "pending", label: "unknown", note: "Shipped; the PR is still open for review." };
  }
  return { humanOutcome: "pending", label: "unknown", note: "Shipped; could not read the PR's current state." };
}

/** Build the labeled corpus from receipts, given a way to look up each PR's state. */
export function buildCorpus(
  receipts: ReceiptLike[],
  getState: (prUrl: string) => PrState | null,
): CorpusCase[] {
  return receipts.map((r) => {
    const prState = r.prUrl ? getState(r.prUrl) : null;
    return {
      ticketId: r.ticketId,
      repo: repoFromPrUrl(r.prUrl),
      prUrl: r.prUrl,
      minionStatus: r.status,
      ...classify(r.status, prState),
    };
  });
}

/** Read minion receipts (skipping spec-author receipts, which are test-only). */
function loadReceipts(): ReceiptLike[] {
  let files: string[] = [];
  try {
    files = readdirSync(RECEIPTS_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("spec-"));
  } catch {
    return [];
  }
  const receipts: ReceiptLike[] = [];
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(path.join(RECEIPTS_DIR, f), "utf8"));
      if (r && r.ticketId && r.status) receipts.push({ ticketId: r.ticketId, status: r.status, prUrl: r.prUrl });
    } catch {
      /* skip unreadable */
    }
  }
  return receipts;
}

/** Ask GitHub for a PR's current state via `gh`. */
function fetchPrState(prUrl: string): PrState | null {
  const res = spawnSync("gh", ["pr", "view", prUrl, "--json", "state"], { encoding: "utf8" });
  if (res.status !== 0) return null;
  try {
    const state = JSON.parse(res.stdout).state as string;
    return state === "MERGED" || state === "CLOSED" || state === "OPEN" ? state : null;
  } catch {
    return null;
  }
}

export interface CorpusSummary {
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
  declined: number;
}

/** Refresh the corpus: read receipts, check PR outcomes, write minion-corpus.json. */
export function runCorpus(opts: { onLog?: (m: string) => void } = {}): {
  cases: CorpusCase[];
  summary: CorpusSummary;
} {
  const log = opts.onLog ?? (() => {});
  const receipts = loadReceipts();
  log(`${receipts.length} receipt(s) found.`);
  const cases = buildCorpus(receipts, (url) => {
    log(`checking ${url}…`);
    return fetchPrState(url);
  });

  const summary: CorpusSummary = {
    total: cases.length,
    accepted: cases.filter((c) => c.humanOutcome === "accepted").length,
    rejected: cases.filter((c) => c.humanOutcome === "rejected").length,
    pending: cases.filter((c) => c.humanOutcome === "pending").length,
    declined: cases.filter((c) => c.minionStatus === "declined").length,
  };

  mkdirSync(path.dirname(CORPUS_FILE), { recursive: true });
  writeFileSync(CORPUS_FILE, JSON.stringify({ summary, cases }, null, 2) + "\n");
  return { cases, summary };
}
