import { randomUUID } from "node:crypto";
import { openDb } from "./db";
import { Store } from "./store";
import { isTerminal } from "./lifecycle";
import { runJob } from "./orchestrator";

/**
 * The durable worker. It claims one job at a time under a lease, runs the real
 * engine through the orchestrator, and applies a bounded retry policy. A crashed
 * worker's in-flight job is recovered when its lease expires (requeueExpired),
 * so no step is lost or run twice. This is a genuine background process — not a
 * request handler — which is why it is a separate tier from the Next.js app.
 */

const LEASE_MS = Number(process.env.FORGE_LEASE_MS) || 60_000;
const POLL_MS = Number(process.env.FORGE_POLL_MS) || 1000;

function backoffMs(attempts: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempts - 1));
}

/** Process at most one job. Returns true if a job was claimed. */
export async function tick(store: Store, owner: string): Promise<boolean> {
  store.reconcile();
  store.requeueExpired();
  const job = store.claimJob(owner, LEASE_MS);
  if (!job) return false;

  const heartbeat = setInterval(() => {
    try {
      store.heartbeatJob(job.id, owner, LEASE_MS);
    } catch {
      /* transient; the lease will simply expire and be recovered */
    }
  }, Math.max(1000, Math.floor(LEASE_MS / 3)));

  try {
    await runJob(store, job);
    store.finishJob(job.id, "done");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (job.attempts >= job.max_attempts) {
      store.finishJob(job.id, "failed", msg);
      const run = store.getRun(job.run_id);
      if (run && !isTerminal(run.state)) {
        store.appendEvent(job.run_id, { kind: "error", label: `Failed: ${msg}`, phase: "failed" });
        store.setRunState(job.run_id, "failed", { reason: msg });
      }
    } else {
      store.retryJob(job.id, msg, backoffMs(job.attempts));
      const run = store.getRun(job.run_id);
      if (run && run.state === "running") {
        store.appendEvent(job.run_id, { kind: "retry", label: `Retrying after error: ${msg}`, phase: "recovered" });
        store.setRunState(job.run_id, "retrying", {});
      }
    }
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

/** Drain every runnable job, then stop. Used by tests, CI, and smoke scripts. */
export async function drain(store: Store, owner = `drain-${randomUUID().slice(0, 6)}`): Promise<number> {
  let count = 0;
  // Bounded so a bug can never spin forever; far above any real run's job count.
  for (let i = 0; i < 1000; i++) {
    const did = await tick(store, owner);
    if (!did) break;
    count++;
  }
  return count;
}

/** Long-running loop for a deployed worker. */
export async function runForever(): Promise<void> {
  const db = openDb();
  const store = new Store(db);
  const owner = `worker-${process.pid}-${randomUUID().slice(0, 6)}`;
  let stop = false;
  const shutdown = () => {
    stop = true;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // eslint-disable-next-line no-console
  console.log(`[worker] ${owner} started (provider=${process.env.LLM_PROVIDER || "anthropic"})`);
  while (!stop) {
    let worked = false;
    try {
      worked = await tick(store, owner);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[worker] tick error", error);
    }
    if (!worked) await new Promise((r) => setTimeout(r, POLL_MS));
  }
  db.close();
  // eslint-disable-next-line no-console
  console.log(`[worker] ${owner} stopped`);
}

// Entry point when run directly (npm run worker).
if (import.meta.url === `file://${process.argv[1]}`) {
  runForever().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
