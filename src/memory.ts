import { mkdirSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Persistent memory across runs. When the self-repair loop fixes a failing test,
 * that fix is a lesson: "when an agent failed on input X, the change that worked
 * was Y." Forge writes those lessons to disk and recalls the relevant ones on the
 * next build or repair, so the system carries forward what it learned instead of
 * rediscovering the same fixes every run.
 *
 * Recall is deliberately simple and transparent — keyword overlap with a recency
 * tie-break — so it is easy to inspect and reason about. The store is an append
 * -only JSONL log; nothing is ever silently overwritten.
 */

export interface Lesson {
  /** ISO timestamp the lesson was learned. */
  at: string;
  /** The agent/task this came from. */
  agent: string;
  /** What was failing before the fix. */
  failingInput: string;
  /** The repair that made it pass (a change summary). */
  fix: string;
  /** Keywords for retrieval, derived from the failing input + agent. */
  keywords: string[];
}

const MEMORY_DIR = path.join(process.cwd(), ".forge-memory");
const MEMORY_FILE = path.join(MEMORY_DIR, "lessons.jsonl");

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "to", "of", "in", "on", "for",
  "with", "is", "it", "as", "at", "by", "be", "this", "that", "from", "into",
  "should", "must", "when", "what", "how", "agent", "input", "test", "case",
]);

/** Lowercase, split on non-alphanumerics, drop stopwords and short tokens. */
export function keywords(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    seen.add(raw);
  }
  return [...seen];
}

export function recordLessons(lessons: Lesson[]): void {
  if (!lessons.length) return;
  mkdirSync(MEMORY_DIR, { recursive: true });
  const body = lessons.map((l) => JSON.stringify(l)).join("\n") + "\n";
  appendFileSync(MEMORY_FILE, body);
}

export function allLessons(): Lesson[] {
  if (!existsSync(MEMORY_FILE)) return [];
  return readFileSync(MEMORY_FILE, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Lesson;
      } catch {
        return null;
      }
    })
    .filter((l): l is Lesson => l !== null);
}

/**
 * Pure recall core: rank lessons by keyword overlap with the query, breaking
 * ties toward more recent lessons (later in the list). Separated from disk I/O
 * so the ranking is easy to test in isolation.
 */
export function rankLessons(lessons: Lesson[], query: string, limit = 3): Lesson[] {
  const queryKeywords = new Set(keywords(query));
  if (!queryKeywords.size) return [];
  return lessons
    .map((lesson, index) => ({
      lesson,
      index,
      score: lesson.keywords.reduce((n, k) => n + (queryKeywords.has(k) ? 1 : 0), 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, limit)
    .map((x) => x.lesson);
}

/**
 * Recall the most relevant prior lessons for a query (a task description or a
 * failing input), reading from the persisted lesson log.
 */
export function recallLessons(query: string, limit = 3): Lesson[] {
  return rankLessons(allLessons(), query, limit);
}

/** Render recalled lessons as a prompt block to ground a build or repair. */
export function lessonsPrompt(query: string, limit = 3): string {
  const lessons = recallLessons(query, limit);
  if (!lessons.length) return "";
  const items = lessons
    .map((l) => `- On "${l.failingInput}": ${l.fix}`)
    .join("\n");
  return `\n\nLessons from past builds (apply if relevant; do not over-fit):\n${items}`;
}
