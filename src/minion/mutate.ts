/**
 * Mutation testing for the gate. A green test proves the test is satisfied, not
 * that the fix is real — a narrow or hard-coded change can do that. So after a
 * fix turns a failing test green, we PERTURB the changed source (flip a
 * comparison, drop the line, swap a constant) and re-run: if the now-green test
 * survives the logic being mangled, the "fix" likely pattern-matched the
 * assertion rather than fixing behavior. This is mechanical — no extra model to
 * trust — and sits naturally under the LLM judge.
 */
export interface Mutant {
  /** Short description, e.g. "delete L12" or "flip < L9". */
  op: string;
  /** The full mutated file content. */
  content: string;
}

/** Replace the FIRST regex match in a line via `fn`; null if nothing matched. */
function swapFirst(line: string, re: RegExp, fn: (m: string) => string): string | null {
  let replaced: string | null = null;
  const out = line.replace(re, (m) => {
    if (replaced !== null) return m; // only the first
    const r = fn(m);
    replaced = r;
    return r;
  });
  return replaced === null ? null : out;
}

const FLIP: Record<string, string> = {
  "<": ">", ">": "<", "<=": ">=", ">=": "<=",
  "===": "!==", "!==": "===", "==": "!=", "!=": "==",
  "&&": "||", "||": "&&",
  "true": "false", "false": "true",
};

const OPERATORS: Array<{ name: string; apply: (line: string) => string | null }> = [
  { name: "flip compare", apply: (l) => swapFirst(l, /<=|>=|<|>/, (m) => FLIP[m]) },
  { name: "flip equality", apply: (l) => swapFirst(l, /===|!==|==|!=/, (m) => FLIP[m]) },
  { name: "flip boolean", apply: (l) => swapFirst(l, /\btrue\b|\bfalse\b/, (m) => FLIP[m]) },
  { name: "flip logic", apply: (l) => swapFirst(l, /&&|\|\|/, (m) => FLIP[m]) },
  { name: "bump number", apply: (l) => swapFirst(l, /\b\d+\b/, (m) => String(Number(m) + 1)) },
];

/**
 * Build mutants by perturbing the changed (added) lines of one file. Always
 * tries a line-deletion mutant — the universal "did this line even matter?"
 * check — plus operator flips where they apply. Returns at most `max` distinct
 * mutants.
 */
export function generateMutants(source: string, addedLines: number[], max = 6): Mutant[] {
  const lines = source.split("\n");
  const mutants: Mutant[] = [];
  const seen = new Set<string>();
  const push = (op: string, content: string) => {
    if (content !== source && !seen.has(content)) {
      seen.add(content);
      mutants.push({ op, content });
    }
  };

  for (const ln of addedLines) {
    const idx = ln - 1;
    if (idx < 0 || idx >= lines.length) continue;
    if (!lines[idx].trim()) continue; // skip blank lines

    // Universal: remove the line entirely.
    const deleted = lines.slice();
    deleted.splice(idx, 1);
    push(`delete L${ln}`, deleted.join("\n"));

    // Operator flips on the line's logic.
    for (const op of OPERATORS) {
      const mutated = op.apply(lines[idx]);
      if (mutated && mutated !== lines[idx]) {
        const copy = lines.slice();
        copy[idx] = mutated;
        push(`${op.name} L${ln}`, copy.join("\n"));
      }
    }
    if (mutants.length >= max) break;
  }
  return mutants.slice(0, max);
}

/**
 * Parse `git diff --cached --unified=0` into the added (new-side) line numbers
 * per file, so mutation testing knows exactly which lines the fix introduced.
 */
export function parseAddedLines(diff: string): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  let file: string | null = null;
  let newLine = 0;
  for (const line of diff.split("\n")) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      file = fileMatch[1];
      if (!out[file]) out[file] = [];
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!file) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      out[file].push(newLine);
      newLine++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      // old side only — does not advance the new-line counter
    } else if (!line.startsWith("\\")) {
      newLine++;
    }
  }
  for (const f of Object.keys(out)) if (out[f].length === 0) delete out[f];
  return out;
}
