import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./db";
import { Store } from "./store";
import { drain } from "./worker";

/**
 * End-to-end GitHub coding run over the real database, worker, and engine, with
 * the deterministic provider AND the deterministic GitHub adapter. Proves the
 * lifecycle shape the milestone requires: real issue → isolated checkout → real
 * gates → verified diff → approval gate → (fake) pushed branch + draft PR →
 * GitHub-API verification → durable PR record. No network, no credentials.
 */

function freshStore(): Store {
  const store = new Store(openDb(":memory:"));
  store.ensureWorkspace("ws-test", { providerMode: "fake" });
  return store;
}

function newGithubRun(store: Store, openPr: boolean) {
  return store.createGithubRun({
    workspaceId: "ws-test",
    repo: "acme/widgets",
    issueNumber: 42,
    goal: "Fix issue #42 in acme/widgets",
    provider: "fake",
    githubMode: "fake",
    openPr,
  });
}

test("github run: issue → checkout → gates → approval → verified draft PR", async () => {
  const store = freshStore();
  const run = newGithubRun(store, true);

  // Execute: real minion works an isolated checkout and parks for approval.
  await drain(store);
  let cur = store.getRun(run.id)!;
  assert.equal(cur.state, "waiting_approval", "parks before any external write");
  assert.match(cur.head_branch ?? "", /^agent-forge\//, "collision-safe non-protected branch");
  assert.ok((cur.base_sha ?? "").length > 0, "records the base commit worked from");
  assert.ok(cur.checkout_dir, "records the isolated checkout");
  const pending = store.getPendingApproval(run.id, "ship")!;
  assert.ok((pending.preview ?? "").includes("clamp"), "approver previews the real diff");
  assert.equal(cur.pr_url, null, "no PR before approval");

  // Approve → ship: open + verify the draft PR.
  store.decideApproval(run.id, "ship", "approve", "owner-local");
  await drain(store);
  cur = store.getRun(run.id)!;
  assert.equal(cur.state, "completed");
  assert.ok((cur.pr_url ?? "").startsWith("https://github.com/acme/widgets/pull/"), "records a real-shaped PR URL");
  assert.equal(cur.pr_draft, 1, "draft by default");
  assert.equal(cur.pr_state, "open");

  const artifacts = store.getArtifacts(run.id);
  assert.ok(artifacts.some((a) => a.kind === "pr"), "a PR artifact is persisted");
  assert.ok(artifacts.some((a) => a.kind === "diff"), "the verified diff is persisted");
});

test("github run, prepare-only: verified diff, never opens a PR", async () => {
  const store = freshStore();
  const run = newGithubRun(store, false);
  await drain(store);
  const cur = store.getRun(run.id)!;
  assert.equal(cur.state, "completed");
  assert.equal(cur.pr_url, null, "prepare-only never opens a PR");
  assert.equal(store.getPendingApproval(run.id, "ship"), undefined, "no approval gate when no PR is requested");
  assert.ok(store.getArtifacts(run.id).some((a) => a.kind === "diff"));
});

test("github ship is idempotent under a duplicate approval", async () => {
  const store = freshStore();
  const run = newGithubRun(store, true);
  await drain(store);
  const first = store.decideApproval(run.id, "ship", "approve", "owner-local");
  const second = store.decideApproval(run.id, "ship", "approve", "owner-local");
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  await drain(store);
  assert.equal(store.getRun(run.id)!.state, "completed");
});
