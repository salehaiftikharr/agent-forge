import { NextResponse } from "next/server";
import { getDb } from "../../../lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness is honest: the database must be reachable and migrated. It does not
 * assert that a worker is running — the web tier cannot prove that — so the
 * payload reports what it actually knows and leaves worker liveness to the
 * worker's own logs and the pending-job counts on /api/health.
 */
export async function GET() {
  try {
    const db = getDb();
    const migrated = Boolean(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='runs'").get(),
    );
    const pendingJobs = (
      db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='queued'").get() as { n: number }
    ).n;
    return NextResponse.json(
      { ready: migrated, migrated, pendingJobs, note: "worker liveness is not asserted here" },
      { status: migrated ? 200 : 503 },
    );
  } catch (error) {
    return NextResponse.json(
      { ready: false, error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
