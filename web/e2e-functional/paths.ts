import path from "node:path";

/** Shared constants for the functional Playwright harness. */
export const PORT = 3013;
export const BASE_URL = `http://localhost:${PORT}`;
export const WEB_DIR = process.cwd(); // playwright runs with cwd = web/
export const REPO_ROOT = path.resolve(WEB_DIR, "..");
export const DATA_DIR = path.join(WEB_DIR, ".forge-e2e");
export const DB_PATH = path.join(DATA_DIR, "func.db");
export const RUNS_DIR = path.join(DATA_DIR, "runs");
export const WORKER_PID = path.join(DATA_DIR, "worker.pid");
export const WEB_PID = path.join(DATA_DIR, "web.pid");
export const SEED_DIR = path.join(REPO_ROOT, "sandbox");
export const TSX_BIN = path.join(REPO_ROOT, "node_modules/.bin/tsx");
export const WORKER_ENTRY = path.join(REPO_ROOT, "src/app/worker.ts");
export const MIGRATE_ENTRY = path.join(REPO_ROOT, "src/app/migrate.ts");
