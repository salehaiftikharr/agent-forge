/**
 * Turn a natural-language message (or a pasted GitHub URL) into a structured
 * coding task. Shared by the web composer and the Slack handler so both feel
 * like talking to a coworker rather than a command parser. Pure and
 * deterministic — no network, no model — so it is trivially testable and cannot
 * be steered by anything but the user's own words.
 */

export interface ParsedTask {
  owner?: string;
  repo?: string; // repo name only
  repoFull?: string; // "owner/name" when both are known
  repoUrl?: string; // set when a github URL was pasted
  issueNumber?: number;
  prNumber?: number;
  baseBranch?: string;
  outcome: string; // the requested outcome, cleaned
  mode: "investigate" | "implement" | "review" | "explain";
  /** True if the user permits opening a PR (after approval); false for
   * explain / investigate-only / prepare-only requests. */
  openPr: boolean;
  constraints: string[];
  ambiguous: boolean; // critical info (usually the repo) is missing or unclear
  clarification?: string; // ONE short question when ambiguous
}

const NAME = "[A-Za-z0-9](?:[\\w.-]*[A-Za-z0-9])?";

/** Parse a github.com repo/issue/PR URL. Returns null if it is not one. */
export function parseGitHubUrl(
  url: string,
): { owner: string; repo: string; issueNumber?: number; prNumber?: number } | null {
  const m = url.match(
    new RegExp(`https?://(?:www\\.)?github\\.com/(${NAME})/(${NAME})(?:\\.git)?(?:/(issues|pull)/(\\d+))?`, "i"),
  );
  if (!m) return null;
  const [, owner, repo, kind, num] = m;
  const out: { owner: string; repo: string; issueNumber?: number; prNumber?: number } = {
    owner,
    repo: repo.replace(/\.git$/, ""),
  };
  if (kind === "issues" && num) out.issueNumber = Number(num);
  if (kind === "pull" && num) out.prNumber = Number(num);
  return out;
}

/** Words that mean "look, don't change". */
const INVESTIGATE = /\b(investigate|reproduce|why\b|look into|diagnose|figure out|debug|find out)\b/i;
const EXPLAIN = /\b(explain|what does|how does|walk me through|describe)\b/i;
const IMPLEMENT = /\b(fix|implement|add|improve|resolve|patch|refactor|update|write|prepare a fix|make)\b/i;
const REVIEW = /\b(review)\b/i;

const WANTS_PR =
  /\b(open (a|the) (draft )?(pr|pull request)|prepare (a|the) (pr|pull request)|prepare a fix|and fix it|fix it|resolve it|propose a fix|raise a pr)\b/i;
const NO_PR =
  /\b(only prepare|prepare only|don'?t (push|open)|do not (push|open)|stop before (pushing|opening)|without (pushing|opening|a pr)|no pr\b|investigate only|just (look|investigate|check)|explain)\b/i;

/**
 * Find an explicit "owner/repo" token in free text (not part of a URL/path).
 * Prefers one that follows in/repo/repository when there are several.
 */
function findRepoToken(text: string): { owner: string; repo: string } | null {
  const re = new RegExp(`(?:^|\\s|\`)(?:(in|repo|repository)\\s+)?(${NAME})/(${NAME})(?=$|[\\s.,;:!?\`])`, "gi");
  const matches: { preferred: boolean; owner: string; repo: string }[] = [];
  for (const m of text.matchAll(re)) {
    // Skip things that look like a path segment (three+ slashes around it).
    matches.push({ preferred: Boolean(m[1]), owner: m[2], repo: m[3].replace(/\.git$/, "") });
  }
  if (matches.length === 0) return null;
  return matches.find((x) => x.preferred) ?? matches[0];
}

function num(text: string, patterns: RegExp[]): number | undefined {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return Number(m[1]);
  }
  return undefined;
}

function detectBaseBranch(text: string): string | undefined {
  const m = text.match(
    /\b(?:base branch|target branch|base|target|against|onto)\s+([A-Za-z0-9][\w.\/-]*)/i,
  );
  if (!m) return undefined;
  const b = m[1].replace(/[.,;:!?]+$/, ""); // drop trailing sentence punctuation
  // Guard against grabbing a following word that is clearly not a branch.
  if (/^(the|a|an|it|this|that)$/i.test(b)) return undefined;
  return b;
}

function detectConstraints(text: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\b(don'?t (?:touch|change|modify)[^.,;]*)/gi,
    /\b(do not (?:touch|change|modify)[^.,;]*)/gi,
    /\b(only (?:in|touch|change)[^.,;]*)/gi,
    /\b(keep it minimal)\b/gi,
    /\b(must not [^.,;]*)/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) out.push(m[1].trim());
  }
  return out;
}

export function parseTask(input: string): ParsedTask {
  const text = input.trim();

  // 1) Repository: a pasted github URL wins; else an explicit owner/repo token.
  let owner: string | undefined;
  let repo: string | undefined;
  let repoUrl: string | undefined;
  let issueNumber: number | undefined;
  let prNumber: number | undefined;

  const urlMatch = text.match(/https?:\/\/\S+/i);
  if (urlMatch) {
    const parsed = parseGitHubUrl(urlMatch[0]);
    if (parsed) {
      owner = parsed.owner;
      repo = parsed.repo;
      repoUrl = urlMatch[0].replace(/[.,;:!?]+$/, "");
      issueNumber = parsed.issueNumber;
      prNumber = parsed.prNumber;
    }
  }
  if (!owner) {
    const token = findRepoToken(text);
    if (token) {
      owner = token.owner;
      repo = token.repo;
    }
  }

  // 2) Issue / PR numbers from prose (URL already handled above).
  if (prNumber === undefined) {
    prNumber = num(text, [/\b(?:pr|pull request)\s*#?\s*(\d+)/i, /\breview\s+#?(\d+)/i]);
  }
  if (issueNumber === undefined) {
    issueNumber = num(text, [/\bissue\s*(?:number\s*)?#?\s*(\d+)/i]);
    // A bare #N is an issue only when no PR was named.
    if (issueNumber === undefined && prNumber === undefined) {
      issueNumber = num(text, [/(?:^|\s)#(\d+)\b/]);
    }
  }

  const baseBranch = detectBaseBranch(text);
  const constraints = detectConstraints(text);

  // 3) Mode.
  const wantsFix = IMPLEMENT.test(text) || WANTS_PR.test(text);
  let mode: ParsedTask["mode"];
  if (EXPLAIN.test(text) && !wantsFix) {
    mode = "explain";
  } else if (prNumber !== undefined && REVIEW.test(text) && !IMPLEMENT.test(text)) {
    mode = "review";
  } else if (wantsFix) {
    mode = "implement";
  } else if (INVESTIGATE.test(text)) {
    mode = "investigate";
  } else if (prNumber !== undefined) {
    mode = "review";
  } else {
    mode = "implement"; // a bare "issue #42 in owner/repo" implies: fix it
  }

  // 4) Whether a PR may be opened (still gated by approval downstream).
  let openPr: boolean;
  if (mode === "explain" || mode === "investigate") {
    openPr = false;
  } else if (NO_PR.test(text)) {
    openPr = false;
  } else if (WANTS_PR.test(text) || mode === "implement") {
    openPr = true;
  } else {
    openPr = false; // "review PR #18" alone: look, don't open anything
  }

  // 5) Ambiguity: the repo is the one piece we cannot proceed without.
  let ambiguous = false;
  let clarification: string | undefined;
  if (!owner || !repo) {
    ambiguous = true;
    clarification = "Which repository should I work in? Give it as `owner/name` or a GitHub URL.";
  } else if (issueNumber === undefined && prNumber === undefined && !IMPLEMENT.test(text) && !INVESTIGATE.test(text) && !EXPLAIN.test(text) && !WANTS_PR.test(text)) {
    ambiguous = true;
    clarification = `What would you like me to do in \`${owner}/${repo}\`? Point me at an issue, a PR, or describe the change.`;
  }

  return {
    owner,
    repo,
    repoFull: owner && repo ? `${owner}/${repo}` : undefined,
    repoUrl,
    issueNumber,
    prNumber,
    baseBranch,
    outcome: text,
    mode,
    openPr,
    constraints,
    ambiguous,
    clarification,
  };
}
