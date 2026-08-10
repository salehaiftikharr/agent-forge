import test from "node:test";
import assert from "node:assert/strict";
import { workTicket } from "../minion/minion";
import { branchNameFor, buildPrBody, FakeGitHubAdapter } from "./github-adapter";

test("branchNameFor is safe and never a protected/default branch", () => {
  assert.equal(branchNameFor("Fix Issue #42!"), "agent-forge/fix-issue-42");
  assert.equal(branchNameFor("run-abc"), "agent-forge/run-abc");
  assert.equal(branchNameFor("run-abc", 2), "agent-forge/run-abc-2");
  // Always namespaced under agent-forge/, so it can never be main/master.
  assert.match(branchNameFor("main"), /^agent-forge\//);
});

test("buildPrBody discloses Agent Forge, references the issue, and shows verification", () => {
  const decision = {
    baseline: { passed: 2, total: 7 },
    finalTests: { passed: 3, total: 7 },
    confidence: { score: 0.95, level: "high" },
    risk: { level: "low", factors: [] },
    reason: "Adds the clamp helper.",
    requiresReview: false,
  } as unknown as Parameters<typeof buildPrBody>[0]["decision"];
  const body = buildPrBody({ reference: "Closes #42.", decision, runId: "run-xyz" });
  assert.match(body, /Closes #42\./);
  assert.match(body, /Prepared by Agent Forge/);
  assert.match(body, /2\/7 → 3\/7 passing/);
});

test("fake adapter drives the real engine to a shippable draft PR", async () => {
  const gh = new FakeGitHubAdapter();
  const access = await gh.verifyAccess("acme/widgets");
  assert.equal(access.canWrite, true);

  const issue = await gh.readIssue("acme/widgets", 42);
  const checkout = await gh.prepareCheckout("acme/widgets", "run-ghtest", "main");
  assert.match(checkout.headBranch, /^agent-forge\//);
  assert.ok(checkout.baseSha.length > 0);

  const decision = await workTicket(
    checkout.workspace,
    { id: `issue-${issue.number}`, title: issue.title, body: issue.body },
    { provider: "fake" },
  );
  assert.equal(decision.status, "approved");
  assert.ok(decision.patch.includes("clamp"));

  const pr = await gh.openPullRequest("acme/widgets", {
    workspace: checkout.workspace,
    headBranch: checkout.headBranch,
    baseBranch: checkout.baseBranch,
    title: issue.title,
    body: buildPrBody({ reference: `Closes #${issue.number}.`, decision, runId: "run-ghtest" }),
    draft: true,
    commitMessage: issue.title,
  });
  assert.ok(pr.url.startsWith("https://github.com/acme/widgets/pull/"));
  assert.equal(pr.draft, true);
  assert.ok(pr.headSha.length > 0);

  const verified = await gh.verifyPullRequest("acme/widgets", pr.number);
  assert.equal(verified.number, pr.number);
});
