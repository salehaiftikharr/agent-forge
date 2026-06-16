import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSelection } from "./select";
import type { LinearIssueSummary } from "./client";

const issue = (
  identifier: string,
  title: string,
  description = "",
): LinearIssueSummary => ({
  id: `uuid-${identifier}`,
  identifier,
  title,
  description,
  url: `https://linear.app/x/issue/${identifier}`,
  priority: 2,
  state: "Todo",
});

const ISSUES: LinearIssueSummary[] = [
  issue("ENG-10", "Fix login button not responding on Safari", "auth form regression"),
  issue("ENG-11", "Add CSV export to the analytics dashboard"),
  issue("ENG-12", "Crash when uploading large avatar images"),
];

test("resolves an exact Linear identifier", () => {
  const r = resolveSelection(ISSUES, "work on ENG-12 please");
  assert.equal(r.kind, "one");
  assert.equal(r.kind === "one" && r.issue.identifier, "ENG-12");
});

test("resolves a spaced/hashed identifier", () => {
  for (const text of ["do eng 11", "fix #11... wait ENG-11"]) {
    const r = resolveSelection(ISSUES, text);
    assert.equal(r.kind === "one" && r.issue.identifier, "ENG-11", text);
  }
});

test("resolves ordinal words", () => {
  assert.equal(
    (resolveSelection(ISSUES, "work on the first one") as { issue: LinearIssueSummary }).issue
      .identifier,
    "ENG-10",
  );
  assert.equal(
    (resolveSelection(ISSUES, "take the last one") as { issue: LinearIssueSummary }).issue
      .identifier,
    "ENG-12",
  );
});

test("resolves a bare position number", () => {
  assert.equal(
    (resolveSelection(ISSUES, "2") as { issue: LinearIssueSummary }).issue.identifier,
    "ENG-11",
  );
  assert.equal(
    (resolveSelection(ISSUES, "number 3") as { issue: LinearIssueSummary }).issue.identifier,
    "ENG-12",
  );
});

test("resolves a confident fuzzy description", () => {
  const r = resolveSelection(ISSUES, "work on the login bug");
  assert.equal(r.kind, "one");
  assert.equal(r.kind === "one" && r.issue.identifier, "ENG-10");
});

test("recognizes 'all of them'", () => {
  const r = resolveSelection(ISSUES, "work on all of them");
  assert.equal(r.kind, "all");
  assert.equal(r.kind === "all" && r.issues.length, 3);
});

test("declines an out-of-range position instead of guessing", () => {
  const r = resolveSelection(ISSUES, "9");
  assert.equal(r.kind, "none");
});

test("declines a vague selection rather than picking wrong", () => {
  const r = resolveSelection(ISSUES, "just do the thing");
  assert.equal(r.kind, "none");
});

test("declines against an empty list", () => {
  assert.equal(resolveSelection([], "the first one").kind, "none");
});
