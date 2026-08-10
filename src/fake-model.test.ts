import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareWorkspace } from "./minion/workspace";
import { workTicket, type Ticket } from "./minion/minion";

/**
 * The deterministic provider is the seam that lets the FULL minion engine run
 * offline (real Workspace, real git, real test runner, real gates) so the web
 * application's orchestration can be proven in CI without a key. These tests pin
 * that it genuinely drives the engine to the two lifecycle outcomes it scripts:
 * a legitimate ship and an honest decline. If the engine's gates ever stopped
 * being exercised, these would fail — they are integration tests, not mocks.
 */

function ticket(id: string): Ticket {
  const tickets = JSON.parse(readFileSync("sandbox/tickets.json", "utf8")) as Ticket[];
  const t = tickets.find((x) => x.id === id);
  if (!t) throw new Error(`missing seed ticket ${id}`);
  return t;
}

test("fake provider drives the real engine to a verified ship (TICKET-002)", async () => {
  const { workspace } = prepareWorkspace("sandbox", ".minion-runs", "TICKET-002-test");
  const d = await workTicket(workspace, ticket("TICKET-002"), { provider: "fake" });
  assert.equal(d.status, "approved");
  assert.ok(d.patch.includes("clamp"), "patch should contain the clamp fix");
  assert.ok(d.finalTests.passed > d.baseline.passed, "a previously-failing test turned green");
  assert.equal(d.confidence.level, "high");
});

test("fake provider declines an impossible ticket without regressing (TICKET-004)", async () => {
  const { workspace } = prepareWorkspace("sandbox", ".minion-runs", "TICKET-004-test");
  const d = await workTicket(workspace, ticket("TICKET-004"), { provider: "fake" });
  assert.equal(d.status, "declined");
  assert.equal(d.finalTests.passed, d.baseline.passed, "no test was broken or gamed");
});
