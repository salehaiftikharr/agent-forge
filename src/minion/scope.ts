/**
 * Seed the "study the codebase" step instead of paying full price every run.
 * Most bug tickets carry a stack trace or a file path pointing right at the
 * problem; using that to focus the orient phase is far cheaper and sharper than
 * reading the whole tree, and it's the surgical answer to the monorepo problem.
 */

const CODE_EXT =
  "js|jsx|ts|tsx|mjs|cjs|py|go|rb|java|rs|php|c|cc|cpp|h|hpp|cs|css|scss|html|json|yaml|yml|sql";

/**
 * Pull candidate file paths out of free-form ticket text: stack frames
 * (`at fn (src/x.js:12:5)`), bare `path:line`, and backticked/quoted paths.
 * Line/column suffixes and a/ b/ diff prefixes are stripped.
 */
export function extractFileHints(text: string): string[] {
  const re = new RegExp(`[\\w./\\-]+\\.(?:${CODE_EXT})(?=\\b)`, "gi");
  const found = new Set<string>();
  for (const raw of text.match(re) ?? []) {
    const clean = raw.replace(/^(?:\.\/|a\/|b\/)/, "").trim();
    if (clean) found.add(clean);
  }
  return [...found];
}

/**
 * Keep only candidates that map to a real file in the repo (exact path, or
 * unique basename match), and return those REAL repo paths — so a hint can
 * never point the minion at a file that does not exist.
 */
export function resolveHints(candidates: string[], repoFiles: string[]): string[] {
  const fileSet = new Set(repoFiles);
  const resolved = new Set<string>();
  for (const c of candidates) {
    if (fileSet.has(c)) {
      resolved.add(c);
      continue;
    }
    const base = c.split("/").pop()!;
    const matches = repoFiles.filter((f) => f === c || f.endsWith("/" + c) || f.split("/").pop() === base);
    if (matches.length === 1) resolved.add(matches[0]); // only when unambiguous
  }
  return [...resolved];
}

/**
 * A short note appended to the planning prompt so the minion starts from the
 * files that matter. Empty when there's nothing useful to say.
 */
export function buildScopeNote(hints: string[], hotFiles: string[], testCommand: string): string {
  const lines: string[] = [];
  if (hints.length) {
    lines.push(`The ticket points at these files — start there: ${hints.join(", ")}.`);
  }
  const fresh = hotFiles.filter((f) => !hints.includes(f)).slice(0, 8);
  if (fresh.length) {
    lines.push(`On past visits to this repo, fixes here usually touched: ${fresh.join(", ")}.`);
  }
  if (testCommand) lines.push(`This repo's tests run via ${testCommand}.`);
  if (!lines.length) return "";
  return `To orient efficiently, note:\n- ${lines.join("\n- ")}\nUse these as a starting point rather than reading the whole tree blindly.`;
}
