import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./db";
import { Store } from "./store";
import { drain, tick } from "./worker";

/**
 * End-to-end lifecycle over the real database, worker, and engine (deterministic
 * provider). These are the proofs that the application — not a fixture — carries
 * a run from creation to a shipped, persisted artifact, and that the approval
 * gate genuinely withholds execution.
 */

function freshStore(): Store {
  const store = new Store(openDb(":memory:"));
  store.ensureWorkspace("ws-test", { providerMode: "fake" });
  return store;
}

function newRun(store: Store, ticketId: string, goal: string) {
  return store.createRun({
    workspaceId: "ws-test",
    ticketId,
    goal,
    provider: "fake",
    minionName: "repo-fixer",
  });
}

test("create -> execute -> approval gate -> ship -> completed with artifact", async () => {
  const store = freshStore();
  const run = newRun(store, "TICKET-002", "Add a clamp(n, min, max) helper");

  // Execute phase runs the real engine and parks for approval.
  await drain(store);
  let cur = store.getRun(run.id)!;
  assert.equal(cur.state, "waiting_approval", "run parks at the approval gate");
  const pending = store.getPendingApproval(run.id, "ship")!;
  assert.ok(pending, "a pending approval is persisted before it is presented");
  assert.ok((pending.preview ?? "").includes("clamp"), "the approver previews the exact diff");
  assert.equal(store.getArtifacts(run.id).length, 0, "nothing ships before approval");

  // Approve -> ship -> completed.
  store.decideApproval(run.id, "ship", "approve", "owner-local");
  await drain(store);
  cur = store.getRun(run.id)!;
  assert.equal(cur.state, "completed");
  const artifacts = store.getArtifacts(run.id);
  assert.equal(artifacts.length, 1);
  assert.ok((artifacts[0].body ?? "").includes("clamp"), "the shipped artifact is the verified diff");

  // Event ledger is ordered and monotonic.
  const events = store.eventsSince(run.id, 0);
  assert.ok(events.length > 3);
  for (let i = 1; i < events.length; i++) assert.ok(events[i].seq > events[i - 1].seq);
});

test("rejecting at the gate declines the run and never ships", async () => {
  const store = freshStore();
  const run = newRun(store, "TICKET-002", "Add a clamp helper");
  await drain(store);
  assert.equal(store.getRun(run.id)!.state, "waiting_approval");
  store.decideApproval(run.id, "ship", "reject", "owner-local");
  await drain(store);
  const cur = store.getRun(run.id)!;
  assert.equal(cur.state, "declined");
  assert.equal(store.getArtifacts(run.id).length, 0);
});

test("an impossible ticket is declined by the engine, not forced", async () => {
  const store = freshStore();
  const run = newRun(store, "TICKET-004", "Make add(2,2) equal 5");
  await drain(store);
  const cur = store.getRun(run.id)!;
  assert.equal(cur.state, "declined");
  assert.equal(store.getPendingApproval(run.id, "ship"), undefined);
});

test("approval decisions are idempotent", async () => {
  const store = freshStore();
  const run = newRun(store, "TICKET-002", "clamp");
  await drain(store);
  const first = store.decideApproval(run.id, "ship", "approve", "owner-local");
  assert.equal(first.changed, true);
  const second = store.decideApproval(run.id, "ship", "approve", "owner-local");
  assert.equal(second.changed, false, "a repeated approval is a no-op");
  await drain(store);
  assert.equal(store.getRun(run.id)!.state, "completed");
});

test("duplicate enqueue is idempotent (dedupe key)", () => {
  const store = freshStore();
  const run = newRun(store, "TICKET-002", "clamp");
  const a = store.enqueueJob(run.id, "execute");
  const b = store.enqueueJob(run.id, "execute");
  assert.equal(a!.id, b!.id, "the same run+kind never enqueues twice");
});

test("a crashed worker's job is recovered via lease expiry", async () => {
  const store = freshStore();
  const run = newRun(store, "TICKET-002", "clamp");
  // Simulate a worker that claimed the job then died: force an expired lease.
  const claimed = store.claimJob("dead-worker", 60_000)!;
  store.db
    .prepare("UPDATE jobs SET lease_expires_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 1000).toISOString(), claimed.id);
  assert.equal(store.getJob(claimed.id)!.status, "running", "the dead worker holds the job");

  // A healthy worker recovers the expired lease and runs it to the gate.
  const recovered = store.requeueExpired();
  assert.equal(recovered, 1);
  assert.equal(store.getJob(claimed.id)!.status, "queued", "the job is returned to the queue");
  await tick(store, "healthy-worker");
  assert.equal(store.getRun(run.id)!.state, "waiting_approval");
});

test("cancelling a queued run is immediate; terminal states are final", async () => {
  const store = freshStore();
  const run = newRun(store, "TICKET-002", "clamp");
  store.requestCancel(run.id);
  assert.equal(store.getRun(run.id)!.state, "cancelled");
  // Draining must not resurrect a cancelled run.
  await drain(store);
  assert.equal(store.getRun(run.id)!.state, "cancelled");
});
