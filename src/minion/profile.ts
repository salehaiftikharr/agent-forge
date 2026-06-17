import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * A persistent, per-repo profile so a minion gets up to speed faster on repeat
 * visits instead of paying full "study the whole codebase" price every run. We
 * remember the repo's test command, a cached file tree, and the files that
 * past fixes actually touched (the hot spots) — all cheap, mechanical signal
 * that seeds the orient phase. Local cache only; safe to delete anytime.
 */
const PROFILES_DIR = path.join(process.cwd(), ".minion-profiles");

export interface RepoProfile {
  repo: string;
  testCommand?: string;
  /** Cached file listing from the last visit. */
  files: string[];
  /** Files that past fixes (and ticket hints) gravitated to — most recent first. */
  hotFiles: string[];
}

function slug(repo: string): string {
  return repo.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

export function loadProfile(repo: string): RepoProfile | null {
  try {
    return JSON.parse(readFileSync(path.join(PROFILES_DIR, `${slug(repo)}.json`), "utf8")) as RepoProfile;
  } catch {
    return null;
  }
}

export function saveProfile(profile: RepoProfile): void {
  mkdirSync(PROFILES_DIR, { recursive: true });
  writeFileSync(
    path.join(PROFILES_DIR, `${slug(profile.repo)}.json`),
    JSON.stringify(profile, null, 2) + "\n",
  );
}

/**
 * Fold a run's observations into the profile: refresh the file tree and test
 * command, and push the files this run touched to the front of the hot list
 * (deduped, capped). Pure — the caller persists the result.
 */
export function mergeProfile(
  repo: string,
  prev: RepoProfile | null,
  update: { testCommand?: string; files?: string[]; touched?: string[] },
): RepoProfile {
  const hot: string[] = [];
  for (const f of [...(update.touched ?? []), ...(prev?.hotFiles ?? [])]) {
    if (f && !hot.includes(f)) hot.push(f);
  }
  return {
    repo,
    testCommand: update.testCommand ?? prev?.testCommand,
    files: update.files ?? prev?.files ?? [],
    hotFiles: hot.slice(0, 20),
  };
}
