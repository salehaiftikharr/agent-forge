// Post-deploy smoke test for the functional application.
// Drives the real API end to end (create -> approval gate -> approve -> shipped)
// against a running web tier + worker on the deterministic provider. Exits
// non-zero on any failure so it can gate a deploy.
//
//   BASE_URL=http://localhost:3001 node scripts/smoke-functional.mjs

const BASE = process.env.BASE_URL || "http://localhost:3001";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS) || 45_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return res.json();
}

async function waitFor(runId, predicate, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { run, pendingApproval } = await j("GET", `/api/runs/${runId}`);
    if (predicate(run, pendingApproval)) return { run, pendingApproval };
    await sleep(500);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

async function main() {
  const health = await j("GET", "/api/health");
  console.log(`health: ok, provider=${health.provider}`);

  const { run } = await j("POST", "/api/runs", {
    ticketId: "TICKET-002",
    goal: "Add a clamp(n, min, max) helper",
  });
  console.log(`created run ${run.id} (state=${run.state})`);

  await waitFor(run.id, (r, p) => r.state === "waiting_approval" && p, "approval gate");
  console.log("reached the approval gate; nothing shipped yet");

  await j("POST", `/api/runs/${run.id}/decision`, { decision: "approve" });
  const { run: done } = await waitFor(run.id, (r) => r.state === "completed", "completion");

  const artifacts = done.artifacts || [];
  const shipped = artifacts.find((a) => a.kind === "diff" && (a.body || "").includes("clamp"));
  if (!shipped) throw new Error("completed run has no shipped clamp diff artifact");

  console.log("SMOKE PASS: run completed with a verified, persisted artifact");
}

main().catch((err) => {
  console.error(`SMOKE FAIL: ${err.message}`);
  process.exit(1);
});
