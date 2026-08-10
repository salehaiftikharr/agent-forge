import Database from "better-sqlite3";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Open (and lazily migrate) the shared SQLite database. Both the web tier and
 * the worker call this against the same FORGE_DB_PATH, so the schema is applied
 * exactly once and both see the same source of truth. WAL mode lets the web
 * process read while the worker writes; busy_timeout absorbs brief write
 * contention instead of throwing SQLITE_BUSY.
 */

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "db",
  "migrations",
);

export function defaultDbPath(): string {
  return process.env.FORGE_DB_PATH || path.join(process.cwd(), ".forge-data", "forge.db");
}

export type DB = Database.Database;

export function openDb(file = defaultDbPath()): DB {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

/** Apply every not-yet-applied migration file in order, inside a transaction. */
export function migrate(db: DB): string[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((r) => (r as { version: string }).version),
  );
  const files = existsSync(MIGRATIONS_DIR)
    ? readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()
    : [];
  const ran: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        version,
        new Date().toISOString(),
      );
    });
    tx();
    ran.push(version);
  }
  return ran;
}
