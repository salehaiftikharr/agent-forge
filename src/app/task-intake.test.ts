import test from "node:test";
import assert from "node:assert/strict";
import { parseTask, parseGitHubUrl } from "./task-intake";

test("parseGitHubUrl: repo, issue, pull, and non-github", () => {
  assert.deepEqual(parseGitHubUrl("https://github.com/acme/widgets"), { owner: "acme", repo: "widgets" });
  assert.deepEqual(parseGitHubUrl("https://github.com/acme/widgets.git"), { owner: "acme", repo: "widgets" });
  assert.deepEqual(parseGitHubUrl("https://github.com/acme/widgets/issues/7"), {
    owner: "acme",
    repo: "widgets",
    issueNumber: 7,
  });
  assert.deepEqual(parseGitHubUrl("https://github.com/acme/widgets/pull/18"), {
    owner: "acme",
    repo: "widgets",
    prNumber: 18,
  });
  assert.equal(parseGitHubUrl("https://example.com/acme/widgets"), null);
});

test("issue + fix in owner/repo", () => {
  const t = parseTask("Look at issue #42 in owner/repo and fix it.");
  assert.equal(t.repoFull, "owner/repo");
  assert.equal(t.issueNumber, 42);
  assert.equal(t.mode, "implement");
  assert.equal(t.openPr, true);
  assert.equal(t.ambiguous, false);
});

test("investigate and prepare a PR resolves to implement + openPr", () => {
  const t = parseTask("Investigate why the mobile menu is overflowing in acme/site and prepare a PR.");
  assert.equal(t.repoFull, "acme/site");
  assert.equal(t.mode, "implement");
  assert.equal(t.openPr, true);
});

test("no repo -> ambiguous with a clarification", () => {
  const t = parseTask("Open this repository and improve the tests for the authentication middleware.");
  assert.equal(t.ambiguous, true);
  assert.match(t.clarification ?? "", /repository/i);
});

test("pasted issue URL plus fix", () => {
  const t = parseTask("https://github.com/acme/widgets/issues/7 fix it");
  assert.equal(t.owner, "acme");
  assert.equal(t.repo, "widgets");
  assert.equal(t.issueNumber, 7);
  assert.equal(t.repoUrl, "https://github.com/acme/widgets/issues/7");
  assert.equal(t.openPr, true);
});

test("review a PR and propose a fix", () => {
  const t = parseTask("Review PR #18 in acme/widgets, reproduce the failure, and propose a fix.");
  assert.equal(t.prNumber, 18);
  assert.equal(t.repoFull, "acme/widgets");
  // A fix is requested, so it becomes implement work; a PR may be opened.
  assert.equal(t.mode, "implement");
  assert.equal(t.openPr, true);
});

test("pasted PR URL alone is a review, no PR opened", () => {
  const t = parseTask("https://github.com/acme/widgets/pull/18");
  assert.equal(t.prNumber, 18);
  assert.equal(t.mode, "review");
  assert.equal(t.openPr, false);
});

test("explain is read-only", () => {
  const t = parseTask("Explain how the auth middleware works in acme/widgets.");
  assert.equal(t.mode, "explain");
  assert.equal(t.openPr, false);
});

test("prepare-only stops before a PR", () => {
  const t = parseTask("Fix issue 3 in owner/repo but stop before pushing.");
  assert.equal(t.issueNumber, 3);
  assert.equal(t.mode, "implement");
  assert.equal(t.openPr, false);
});

test("base branch and repo token", () => {
  const t = parseTask("In octo/demo, add a clamp helper on base branch develop.");
  assert.equal(t.repoFull, "octo/demo");
  assert.equal(t.baseBranch, "develop");
  assert.equal(t.mode, "implement");
  assert.equal(t.openPr, true);
});

test("constraints are captured", () => {
  const t = parseTask("Fix issue #5 in a/b but don't touch the public API and keep it minimal.");
  assert.ok(t.constraints.some((c) => /public API/i.test(c)));
  assert.ok(t.constraints.some((c) => /keep it minimal/i.test(c)));
});

test("continue-earlier phrasing without a repo is ambiguous", () => {
  const t = parseTask("Continue the GitHub task we started earlier.");
  assert.equal(t.ambiguous, true);
});
