import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, repoFromPrUrl, buildCorpus, type ReceiptLike, type PrState } from "./corpus";

test("repoFromPrUrl pulls owner/repo from a PR url", () => {
  assert.equal(repoFromPrUrl("https://github.com/salehaiftikharr/forge-minions-demo/pull/7"), "salehaiftikharr/forge-minions-demo");
  assert.equal(repoFromPrUrl("not a url"), undefined);
  assert.equal(repoFromPrUrl(undefined), undefined);
});

test("classify labels each minion/human outcome", () => {
  assert.deepEqual(classify("declined", null).label, "good");
  assert.deepEqual(classify("shipped", "MERGED").humanOutcome, "accepted");
  assert.deepEqual(classify("shipped", "MERGED").label, "good");
  assert.deepEqual(classify("shipped", "CLOSED").humanOutcome, "rejected");
  assert.deepEqual(classify("shipped", "CLOSED").label, "bad"); // the valuable counterexample
  assert.deepEqual(classify("shipped", "OPEN").label, "unknown");
  assert.deepEqual(classify("shipped", null).humanOutcome, "pending");
  assert.deepEqual(classify("error", null).label, "unknown");
});

test("buildCorpus maps receipts to labeled cases", () => {
  const receipts: ReceiptLike[] = [
    { ticketId: "A", status: "shipped", prUrl: "https://github.com/o/r/pull/1" },
    { ticketId: "B", status: "shipped", prUrl: "https://github.com/o/r/pull/2" },
    { ticketId: "C", status: "declined" },
  ];
  const states: Record<string, PrState> = {
    "https://github.com/o/r/pull/1": "MERGED",
    "https://github.com/o/r/pull/2": "CLOSED",
  };
  const cases = buildCorpus(receipts, (u) => states[u] ?? null);

  const b = cases.find((c) => c.ticketId === "B")!;
  assert.equal(b.label, "bad");
  assert.equal(b.humanOutcome, "rejected");
  assert.equal(b.repo, "o/r");
  assert.equal(cases.find((c) => c.ticketId === "A")!.label, "good");
  assert.equal(cases.find((c) => c.ticketId === "C")!.humanOutcome, "none");
});
