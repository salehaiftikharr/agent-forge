import { test } from "node:test";
import assert from "node:assert/strict";
import { Tracer, setTracer, tracedGenerate, usageTokens } from "./trace";

test("usageTokens normalizes the provider usage shapes", () => {
  assert.equal(usageTokens({ totalTokens: 120 }), 120);
  assert.equal(usageTokens({ inputTokens: 30, outputTokens: 70 }), 100);
  assert.equal(usageTokens({ promptTokens: 10, completionTokens: 5 }), 15);
  assert.equal(usageTokens(undefined), undefined);
  assert.equal(usageTokens({}), undefined);
});

test("a tracer rolls spans up by type with time and tokens", () => {
  const t = new Tracer("test-run");
  t.record({ type: "build", label: "build", ms: 100, tokens: 50, at: "", ok: true });
  t.record({ type: "judge", label: "judge", ms: 40, tokens: 20, at: "", ok: true });
  t.record({ type: "judge", label: "judge", ms: 60, tokens: 10, at: "", ok: false });

  const s = t.summary();
  assert.equal(s.spans, 3);
  assert.equal(s.totalTokens, 80);
  assert.equal(s.failures, 1);
  assert.equal(s.byType.judge.count, 2);
  assert.equal(s.byType.judge.tokens, 30);
  assert.equal(s.byType.judge.failures, 1);
  assert.equal(s.byType.build.count, 1);
});

test("tracedGenerate records a span on the active tracer and returns the result", async () => {
  const t = new Tracer("traced");
  setTracer(t);
  try {
    const result = await tracedGenerate("build", "build", async () => ({
      object: { ok: true },
      usage: { totalTokens: 42 },
    }));
    assert.deepEqual(result.object, { ok: true });
    assert.equal(t.spans.length, 1);
    assert.equal(t.spans[0].type, "build");
    assert.equal(t.spans[0].tokens, 42);
    assert.equal(t.spans[0].ok, true);
  } finally {
    setTracer(null);
  }
});

test("tracedGenerate records a failed span and rethrows", async () => {
  const t = new Tracer("traced-fail");
  setTracer(t);
  try {
    await assert.rejects(
      tracedGenerate("repair", "repair", async () => {
        throw new Error("model exploded");
      }),
    );
    assert.equal(t.spans.length, 1);
    assert.equal(t.spans[0].ok, false);
    assert.match(t.spans[0].error ?? "", /exploded/);
  } finally {
    setTracer(null);
  }
});

test("no active tracer means tracedGenerate is a no-op passthrough", async () => {
  setTracer(null);
  const result = await tracedGenerate("run", "run", async () => "hello");
  assert.equal(result, "hello");
});
