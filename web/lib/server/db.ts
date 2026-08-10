import Database from "better-sqlite3";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * The web tier opens the SAME SQLite database the worker writes. It is a client:
 * it inserts runs and job rows and records approval decisions, but it performs
 * no lifecycle transitions — the worker is the sole authority for those. WAL
 * mode lets these reads and light writes run concurrently with the worker.
 *
 * Schema ownership belongs to the engine (`db/migrations/`, applied by
 * `npm run migrate`). For local dev and tests we also apply pending migrations
 * here if we can find the directory, so a single process "just works"; in a
 * deployed split, the migrate step runs first and this is a no-op.
 */

let singleton: Database.Database | null = null;

function dbPath(): string {
  return process.env.FORGE_DB_PATH || path.join(process.cwd(), ".forge-data", "forge.db");
}

function findMigrationsDir(): string | null {
  const candidates = [
    path.join(process.cwd(), "db", "migrations"),
    path.join(process.cwd(), "..", "db", "migrations"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

function ensureSchema(db: Database.Database): void {
  const hasRuns = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='runs'")
    .get();
  if (hasRuns) return;
  const dir = findMigrationsDir();
  if (!dir) {
    throw new Error(
      "Agent Forge database is not migrated and the migrations directory was not found. Run `npm run migrate` in the engine before starting the web app.",
    );
  }
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((r) => (r as { version: string }).version),
  );
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = readFileSync(path.join(dir, file), "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        version,
        new Date().toISOString(),
      );
    });
    tx();
  }
}

export function getDb(): Database.Database {
  if (singleton) return singleton;
  const file = dbPath();
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  singleton = db;
  return db;
}
