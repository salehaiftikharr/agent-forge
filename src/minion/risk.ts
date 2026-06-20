/**
 * Blast-radius scoring for a finished change. Passing every gate proves the fix
 * is CORRECT; it says nothing about how RISKY shipping it unattended is. A
 * one-line fix to a util and a sweeping change that also edits the dependency
 * manifest and a database migration can both be green — but they do not deserve
 * the same amount of human trust.
 *
 * So before a minion ships, we score the change's blast radius from the diff
 * alone: how much it touches, how many files, and whether it reaches sensitive
 * surfaces (dependencies, migrations, CI/infra, secrets). This is mechanical and
 * deterministic — no model — and it feeds two decisions: the confidence score,
 * and whether the PR opens ready-to-merge or as a draft flagged for review.
 */
export interface RiskAssessment {
  level: "low" | "medium" | "high";
  /** 0..1, clamped. Higher = more blast radius. */
  score: number;
  /** Human-readable reasons, e.g. "touches 4 files", "changes dependencies". */
  factors: string[];
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

/** A sensitive path category: if any changed file matches, it adds blast radius. */
const SENSITIVE: Array<{ test: RegExp; weight: number; label: string }> = [
  {
    test: /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|requirements\.txt|go\.(mod|sum)|Gemfile(\.lock)?|Cargo\.(toml|lock)|pom\.xml|build\.gradle)$/,
    weight: 0.3,
    label: "changes dependencies or build config",
  },
  {
    test: /(^|\/)migrations?\//i,
    weight: 0.3,
    label: "touches a database migration",
  },
  {
    test: /(^|\/)(schema\.(sql|prisma|rb)|.*\.sql)$/i,
    weight: 0.25,
    label: "changes the database schema",
  },
  {
    test: /(^|\/)(\.github\/workflows\/|Dockerfile|docker-compose|\.tf$|Makefile)/i,
    weight: 0.25,
    label: "changes CI or infrastructure",
  },
  {
    test: /(^|\/)(\.env|.*\.ya?ml|.*\.toml|.*\.ini|config\/|.*\.config\.[cm]?[jt]s)$/i,
    weight: 0.15,
    label: "changes configuration",
  },
];

interface DiffStat {
  files: string[];
  added: number;
  removed: number;
}

/** Parse a unified `git diff` into the changed file list and +/- line counts. */
function parseDiffStat(patch: string): DiffStat {
  const files: string[] = [];
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      if (fileMatch[1] !== "/dev/null") files.push(fileMatch[1]);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { files: [...new Set(files)], added, removed };
}

/** Map a raw 0..∞ score to a level. Tuned so a tidy one-file fix is "low". */
function levelFor(score: number): RiskAssessment["level"] {
  if (score >= 0.6) return "high";
  if (score >= 0.25) return "medium";
  return "low";
}

/**
 * Assess the blast radius of a staged diff. Pure: same diff in, same assessment
 * out. The score accumulates from size, file count, and sensitive surfaces, then
 * is clamped to 1.
 */
export function assessRisk(patch: string): RiskAssessment {
  const { files, added, removed } = parseDiffStat(patch);
  const changed = added + removed;
  const factors: string[] = [];
  let score = 0;

  // Size of the change.
  if (changed > 120) {
    score += 0.4;
    factors.push(`large change (${changed} lines)`);
  } else if (changed > 40) {
    score += 0.2;
    factors.push(`sizable change (${changed} lines)`);
  }

  // Number of files touched.
  if (files.length > 4) {
    score += 0.3;
    factors.push(`touches ${files.length} files`);
  } else if (files.length > 1) {
    score += 0.15;
    factors.push(`touches ${files.length} files`);
  }

  // Net deletion: removing materially more than it adds is its own risk.
  if (removed > 10 && removed > added * 1.5) {
    score += 0.15;
    factors.push(`removes more than it adds (-${removed}/+${added})`);
  }

  // Sensitive surfaces — each category counts at most once.
  for (const rule of SENSITIVE) {
    if (files.some((f) => rule.test.test(f))) {
      score += rule.weight;
      factors.push(rule.label);
    }
  }

  score = Math.min(1, score);
  const level = levelFor(score);
  if (factors.length === 0) factors.push("small, self-contained change");

  return {
    level,
    score,
    factors,
    filesChanged: files.length,
    linesAdded: added,
    linesRemoved: removed,
  };
}
