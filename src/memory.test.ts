import { test } from "node:test";
import assert from "node:assert/strict";
import { keywords, rankLessons, lessonsPrompt, type Lesson } from "./memory";

test("keywords lowercases, drops stopwords and short tokens, and dedupes", () => {
  const k = keywords("The agent should REFUSE an invalid City city");
  assert.ok(k.includes("refuse"));
  assert.ok(k.includes("invalid"));
  assert.ok(k.includes("city"));
  assert.ok(!k.includes("the")); // stopword
  assert.ok(!k.includes("an")); // too short / stopword
  // deduped: "city" appears once
  assert.equal(k.filter((x) => x === "city").length, 1);
});

const lessons: Lesson[] = [
  {
    at: "1",
    agent: "weather-reporter",
    failingInput: "weather for a fake city",
    fix: "added a refusal rule for unknown cities",
    keywords: ["weather", "fake", "city", "refusal", "unknown"],
  },
  {
    at: "2",
    agent: "bill-splitter",
    failingInput: "split a bill with tip",
    fix: "rounded per-person amounts to cents",
    keywords: ["split", "bill", "tip", "rounded", "cents"],
  },
];

test("rankLessons returns the most relevant lesson by keyword overlap", () => {
  const hits = rankLessons(lessons, "the agent returns weather for an unknown city");
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].agent, "weather-reporter");
});

test("rankLessons returns nothing when no keywords overlap", () => {
  assert.deepEqual(rankLessons(lessons, "translate a paragraph into french"), []);
});

test("rankLessons respects the limit", () => {
  const hits = rankLessons(lessons, "weather bill city tip", 1);
  assert.equal(hits.length, 1);
});

test("lessonsPrompt with no lessons file present yields an empty string for an unrelated query", () => {
  // recallLessons reads disk; an unrelated query should never inject anything.
  assert.equal(lessonsPrompt("zzzz-nonexistent-topic-qqq"), "");
});
