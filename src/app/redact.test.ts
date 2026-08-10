import test from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "./redact";
import { openDb } from "./db";
import { Store } from "./store";

test("redacts credential-shaped tokens even when never configured", () => {
  assert.match(redactSecrets("key sk-ant-abcdEFGH1234567890 here"), /\[redacted\]/);
  assert.ok(!redactSecrets("key sk-ant-abcdEFGH1234567890 here").includes("sk-ant-"));
  assert.match(redactSecrets("token github_pat_ABCDEFGHIJKLMNOPQRSTUV here"), /\[redacted\]/);
  assert.match(redactSecrets("xoxb-1111111111-2222222222-abcdefghij"), /\[redacted\]/);
  assert.match(redactSecrets("xapp-1-A0000000000-abcdefghijkl"), /\[redacted\]/);
});

test("redacts exact values of configured secret env vars", () => {
  const prev = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "github_pat_TESTvalue1234567890abcd";
  try {
    const out = redactSecrets("pushing with github_pat_TESTvalue1234567890abcd now");
    assert.ok(!out.includes("TESTvalue"));
    assert.match(out, /\[redacted\]/);
  } finally {
    if (prev === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = prev;
  }
});

test("leaves ordinary text and short values alone", () => {
  assert.equal(redactSecrets("Just a normal progress message: 2/7 tests passing"), "Just a normal progress message: 2/7 tests passing");
  const prev = process.env.FORGE_PASSPHRASE;
  process.env.FORGE_PASSPHRASE = "abc"; // < 8 chars: must not over-redact
  try {
    assert.equal(redactSecrets("abc is a common word"), "abc is a common word");
  } finally {
    if (prev === undefined) delete process.env.FORGE_PASSPHRASE;
    else process.env.FORGE_PASSPHRASE = prev;
  }
});

test("the store redacts secrets in events and artifacts before persisting", () => {
  const store = new Store(openDb(":memory:"));
  store.ensureWorkspace("ws");
  const run = store.createRun({
    workspaceId: "ws",
    ticketId: "t",
    goal: "g",
    provider: "fake",
    minionName: "m",
  });
  store.appendEvent(run.id, { kind: "tool", label: "cloned with token github_pat_ABCDEFGHIJKLMNOPQRSTUV ok" });
  store.addArtifact(run.id, "ws", { kind: "note", title: "n", body: "leaked sk-ant-abcdEFGH1234567890 in a diff" });

  const ev = store.eventsSince(run.id, 0).find((e) => e.kind === "tool")!;
  assert.ok(!ev.label.includes("github_pat_"));
  assert.match(ev.label, /\[redacted\]/);
  const art = store.getArtifacts(run.id)[0];
  assert.ok(!(art.body ?? "").includes("sk-ant-"));
});
