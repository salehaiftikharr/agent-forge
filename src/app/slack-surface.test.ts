import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./db";
import { Store } from "./store";
import { drain } from "./worker";
import { handleSlackTask, handleSlackDecision, isApprover, nextSlackUpdate } from "./slack-surface";

function freshStore(): Store {
  const store = new Store(openDb(":memory:"));
  store.ensureWorkspace("ws-test", { providerMode: "fake" });
  return store;
}
const opts = { workspaceId: "ws-test", provider: "fake", githubMode: "fake" };
const ctx = (text: string, user = "U1") => ({ text, user, channel: "C1", threadTs: "T1" });

test("a Slack task becomes the SAME shared run and runs on the same engine", async () => {
  const store = freshStore();
  const res = handleSlackTask(store, ctx("Fix issue #42 in acme/widgets"), opts);
  assert.ok(res.runId, "a durable run is created");
  assert.match(res.reply, /Follow the live run/);

  // The same store/worker the web uses carries it — no separate Slack pipeline.
  const run = store.getRun(res.runId!)!;
  assert.equal(run.origin, "slack");
  assert.equal(run.kind, "github");
  assert.equal(run.slack_thread_ts, "T1");

  await drain(store);
  assert.equal(store.getRun(res.runId!)!.state, "waiting_approval");

  // A Slack approval drives the same engine to a verified PR.
  const decision = handleSlackDecision(store, "T1", "U1", "approve");
  assert.equal(decision.ok, true);
  await drain(store);
  const done = store.getRun(res.runId!)!;
  assert.equal(done.state, "completed");
  assert.ok((done.pr_url ?? "").startsWith("https://github.com/acme/widgets/pull/"));
});

test("an ambiguous Slack message asks one clarifying question, no run", () => {
  const store = freshStore();
  const res = handleSlackTask(store, ctx("can a minion take this ticket?"), opts);
  assert.equal(res.needsClarification, true);
  assert.equal(res.runId, undefined);
  assert.match(res.reply, /repository/i);
});

test("only the originating user (or allowlist) may approve", async () => {
  const store = freshStore();
  const res = handleSlackTask(store, ctx("Fix issue #42 in acme/widgets", "U1"), opts);
  await drain(store);
  const run = store.getRun(res.runId!)!;
  assert.equal(isApprover(run, "U1"), true);
  assert.equal(isApprover(run, "U2"), false);

  const forged = handleSlackDecision(store, "T1", "U2", "approve");
  assert.equal(forged.ok, false, "a different Slack user cannot approve");
  assert.equal(store.getRun(res.runId!)!.state, "waiting_approval", "still parked");
});

test("nextSlackUpdate posts on state change and only once", async () => {
  const store = freshStore();
  const res = handleSlackTask(store, ctx("Fix issue #42 in acme/widgets"), opts);
  await drain(store);
  const run = store.getRun(res.runId!)!;
  const upd = nextSlackUpdate(run, store.eventsSince(run.id, run.slack_notified_seq));
  assert.ok(upd);
  assert.equal(upd!.wantsApprovalButtons, true);
  assert.match(upd!.text, /ready for review/);

  // After recording the cursor, the same state yields no repeat.
  store.markSlackNotified(run.id, upd!.seq, upd!.state);
  const again = nextSlackUpdate(store.getRun(res.runId!)!, []);
  assert.equal(again, null);
});
