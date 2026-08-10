import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, openSync } from "node:fs";
import {
  BASE_URL,
  DATA_DIR,
  DB_PATH,
  MIGRATE_ENTRY,
  PORT,
  REPO_ROOT,
  RUNS_DIR,
  SEED_DIR,
  TSX_BIN,
  WEB_DIR,
  WEB_PID,
  WORKER_ENTRY,
  WORKER_PID,
} from "./paths";

/**
 * Bring up the real backend the functional tests drive: a migrated database, a
 * durable worker on the deterministic provider, and the production web server —
 * ALL started here with explicit env, so both processes provably share one
 * FORGE_DB_PATH. (Playwright's own webServer.env did not reliably reach a
 * standalone `next start`, which split the tiers onto different databases.)
 */
export default async function globalSetup() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(RUNS_DIR, { recursive: true });

  const env = {
    ...process.env,
    FORGE_DB_PATH: DB_PATH,
    LLM_PROVIDER: "fake",
    FORGE_SEED_DIR: SEED_DIR,
    FORGE_RUNS_DIR: RUNS_DIR,
    FORGE_POLL_MS: "400",
  };

  // Build the web app and apply migrations (both blocking).
  execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env, stdio: "inherit" });
  execFileSync(TSX_BIN, [MIGRATE_ENTRY], { cwd: REPO_ROOT, env, stdio: "inherit" });

  // Worker (detached, logged).
  const workerLog = openSync(`${DATA_DIR}/worker.log`, "a");
  const worker = spawn(TSX_BIN, [WORKER_ENTRY], {
    cwd: REPO_ROOT,
    env,
    detached: true,
    stdio: ["ignore", workerLog, workerLog],
  });
  worker.unref();
  writeFileSync(WORKER_PID, String(worker.pid));

  // Web server (detached, logged) — same env, same database.
  const webLog = openSync(`${DATA_DIR}/web.log`, "a");
  const web = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: WEB_DIR,
    env,
    detached: true,
    stdio: ["ignore", webLog, webLog],
  });
  web.unref();
  writeFileSync(WEB_PID, String(web.pid));

  // Wait until the web server is answering.
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("functional web server did not become healthy in time");
}
