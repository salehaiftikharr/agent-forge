/**
 * Turn a human selection ("the login bug", "the second one", "ENG-12", "all of
 * them") into concrete issues from a list the bot just showed. This is pure and
 * deterministic on purpose: choosing WHICH ticket to work is high-stakes, so it
 * lives here behind unit tests instead of being left to a model's whim.
 */
import type { LinearIssueSummary } from "./client";

export type Selection =
  | { kind: "all"; issues: LinearIssueSummary[] }
  | { kind: "one"; issue: LinearIssueSummary }
  | { kind: "none"; reason: string };

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  last: -1,
};

/** "ENG-12", "eng 12", "#12" → "ENG-12" when it matches a known identifier. */
function matchIdentifier(
  issues: LinearIssueSummary[],
  text: string,
): LinearIssueSummary | undefined {
  const m = text.match(/\b([a-z]{1,6})[\s-]?(\d{1,6})\b/i);
  if (!m) return undefined;
  const wanted = `${m[1].toUpperCase()}-${m[2]}`;
  return issues.find((i) => i.identifier.toUpperCase() === wanted);
}

/** Tokens shared between the selection text and an issue's title/description. */
function overlapScore(text: string, issue: LinearIssueSummary): number {
  const stop = new Set([
    "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with",
    "work", "fix", "issue", "ticket", "please", "can", "you", "this", "that",
    "do", "one", "it", "bug", "minion", "go", "look", "at", "all",
  ]);
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stop.has(w)),
    );
  const want = words(text);
  if (want.size === 0) return 0;
  const hay = words(`${issue.title} ${issue.description}`);
  let hits = 0;
  for (const w of want) if (hay.has(w)) hits += 1;
  return hits / want.size;
}

/**
 * Resolve a selection against the listed issues.
 * Precedence: explicit "all" → exact identifier → positional/ordinal → fuzzy
 * text match (only when confident). Ambiguity returns "none" with a reason, so
 * the bot can ask rather than guess wrong.
 */
export function resolveSelection(
  issues: LinearIssueSummary[],
  rawSelection: string,
): Selection {
  const text = (rawSelection || "").trim();
  if (issues.length === 0) return { kind: "none", reason: "no issues to choose from" };
  if (!text) return { kind: "none", reason: "no selection given" };

  const lower = text.toLowerCase();

  // "all of them", "every issue", "each one"
  if (/\b(all|every|each|everything|them all)\b/.test(lower)) {
    return { kind: "all", issues };
  }

  // Exact Linear identifier (ENG-12) — most precise, takes priority.
  const byId = matchIdentifier(issues, text);
  if (byId) return { kind: "one", issue: byId };

  // Ordinal words: "the first one", "the last".
  for (const [word, pos] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) {
      const idx = pos === -1 ? issues.length - 1 : pos - 1;
      if (idx >= 0 && idx < issues.length) return { kind: "one", issue: issues[idx] };
      return { kind: "none", reason: `there is no #${pos} in a list of ${issues.length}` };
    }
  }

  // Bare position: "2", "#2", "number 2".
  const numMatch = lower.match(/(?:^|#|number\s+)(\d{1,3})\b/);
  if (numMatch) {
    const idx = Number(numMatch[1]) - 1;
    if (idx >= 0 && idx < issues.length) return { kind: "one", issue: issues[idx] };
    return { kind: "none", reason: `there is no #${numMatch[1]} in a list of ${issues.length}` };
  }

  // Fuzzy match on words. Require a clear winner to avoid picking wrong.
  const scored = issues
    .map((issue) => ({ issue, score: overlapScore(text, issue) }))
    .sort((a, b) => b.score - a.score);
  const [top, runnerUp] = scored;
  if (top && top.score >= 0.5 && (!runnerUp || top.score - runnerUp.score >= 0.25)) {
    return { kind: "one", issue: top.issue };
  }

  return {
    kind: "none",
    reason: "I could not tell which issue you meant — name it by number or identifier",
  };
}
