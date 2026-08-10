import { openDb, defaultDbPath } from "./db";

/**
 * Apply pending migrations to FORGE_DB_PATH. Idempotent and safe to run on every
 * deploy: already-applied migrations are skipped. openDb() runs them, so this is
 * a thin, explicit entry point for the deploy step and for local setup.
 */
const db = openDb();
// eslint-disable-next-line no-console
console.log(`[migrate] database ready at ${defaultDbPath()}`);
db.close();
