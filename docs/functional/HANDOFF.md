# Agent Forge — functional application, morning handoff

## Honest status

**READY (single-owner, offline/live) — with documented limits.** A real forge run
can be created in the web UI, the real engine executes a real minion on a
sandboxed repo, its state and output stream live into the UI, the approval gate
genuinely withholds the ship, the shipped diff is persisted, and the run survives
a full reload — all proven end to end in a real browser. The live-provider path
is wired and documented (opt-in, your key). It is not a public multi-user product
yet (single-owner, single-worker, SQLite) and does not open real GitHub PRs from
the web flow — both stated below, neither hidden behind a fixture.

## 1. Branch
`agent-forge-functional-app` (based on verified `main`, which already contains
the merged demo). Demo/tour preserved and labelled; the real app lives at `/work`.

## 2. Final commit
The tip of `agent-forge-functional-app` (see `git log -1`). Increments:
deterministic provider → persistence/worker → web API → operational UI → docs.

## 3. PR
https://github.com/salehaiftikharr/agent-forge/pull/2 (draft).

## 4. Architecture
Two tiers over one SQLite database (diagram in `docs/functional/DEPLOYMENT.md`):
- **Web** (`web/`, Next.js): API routes + UI + a SQLite client. Creates runs,
  records approval decisions, serves an SSE event stream. No model key, no
  lifecycle authority.
- **Worker** (`src/app/`, run with `npm run worker`): claims jobs under a lease,
  runs the real `workTicket` engine, writes events/artifacts/state, owns every
  transition. The only tier with a model key.
- **Provider seam**: `getModel()` selects `fake` (deterministic, offline) or
  `anthropic`/`openai` (live) — one env var, nothing else changes.

## 5. Genuinely functional
Create a run in the UI → engine plans/implements/gates on a real sandbox →
events stream via SSE → approval gate blocks the ship until you decide → approve
ships a persisted diff artifact → reject/decline are honest terminal states →
cancel is cooperative → refresh and worker restart preserve everything.

## 6. Still simulated / not in this branch
The old demo tour (`/demo`, `/minions`, `/runs`, `/forge`) remains fixture-driven
and is clearly labelled "Product tour". Opening real GitHub PRs from a run is the
engine's existing opt-in path, not wired into the web create flow here.

## 7. Database & migrations
SQLite via `better-sqlite3`. Schema: `db/migrations/0001_init.sql` (workspaces,
runs, run_events ledger, approvals, artifacts, jobs, schema_migrations). Apply
with `npm run migrate` (idempotent; safe on every deploy). No destructive
migrations. Back up = copy the file (worker paused); restore = swap it back.

## 8. Worker topology
One durable worker per database. Jobs are claimed under a lease inside an
immediate transaction; an expired lease is reclaimed on recovery (no lost or
double-run work); bounded retries with backoff; cooperative cancellation.
Multi-worker/multi-host needs the Postgres swap (§18).

## 9. Security & ownership
Full threat model in `docs/functional/SECURITY.md`. Highlights: the browser has
no lifecycle authority; shipping requires a persisted approval re-checked in the
worker; idempotent enqueue/decisions; every row carries `workspace_id`/`owner_id`;
the model key lives only on the worker. Single-owner mode; auth is additive.

## 10. Test results (local)
- Engine + lifecycle: `npm test` → **100 pass / 0 fail** (91 original + 2
  fake-provider integration + 7 full-lifecycle integration over the real DB +
  worker + engine: approval gate, decline, idempotency, duplicate delivery,
  crash recovery, cancellation).
- Web: `cd web && npx tsc --noEmit` clean; `npm run test:e2e` → **34 pass** (demo
  e2e + axe a11y, 0 serious/critical).
- Functional browser e2e: `cd web && npm run test:e2e:functional` → **17 pass**.
  Starts the real DB + worker + web (deterministic provider) and drives the full
  flow (create → live stream → approval gate → approve → shipped → persists
  across reload), the decline path, the empty state, axe a11y on `/work` +
  `/work/new`, and a 6-viewport no-overflow matrix.
- Smoke: `node scripts/smoke-functional.mjs` → PASS against a live stack.

## 11. CI
PR #2 runs the engine gate (`ci.yml`: typecheck + `npm test`, which includes the
functional integration suite) and the web workflow (`web.yml`): the `web` job
(tsc + demo e2e/axe) and the `functional` job (the browser e2e above, standing up
a real DB + worker + engine on the deterministic provider). Check the PR's checks
tab for the latest run.

## 12. Screenshots
`docs/functional/screenshots/01-approval-gate.png` (live approval gate with the
exact diff), `02-completed-persisted.png` (completed run after a full reload).

## 13. Local startup (verified)
See `docs/functional/DEPLOYMENT.md` §A. Short form:
```
npm install && (cd web && npm install)
FORGE_DB_PATH=$PWD/.forge-data/forge.db npm run migrate
FORGE_DB_PATH=$PWD/.forge-data/forge.db LLM_PROVIDER=fake npm run worker   # terminal 2
cd web && FORGE_DB_PATH=$PWD/../.forge-data/forge.db LLM_PROVIDER=fake npm run build && \
  FORGE_DB_PATH=$PWD/../.forge-data/forge.db LLM_PROVIDER=fake npm start    # terminal 3
# open http://localhost:3001/work
```

## 14. Deployment
`docs/functional/DEPLOYMENT.md`: local processes (verified), `docker compose up
--build` (provided; validate with the smoke test), and split hosting notes. The
key rule: the worker + database live on a persistent host/disk; a serverless web
tier alone cannot run background minions.

## 15. Environment variables (no secret values)
`.env.example` (root: worker/engine, incl. `FORGE_DB_PATH`, `LLM_PROVIDER`,
`FORGE_SEED_DIR`, `FORGE_RUNS_DIR`, `FORGE_LEASE_MS`, `FORGE_POLL_MS`, and the
model key you supply) and `web/.env.example` (web: `FORGE_DB_PATH`,
`LLM_PROVIDER`). The only secret is the model key, on the worker only.

## 16. Live smoke procedure
`docs/functional/DEPLOYMENT.md` → "Live smoke test": start the worker with
`LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`, run a live-only ticket
(TICKET-001/003) in the UI, confirm real model activity, approve or see it
declined. Never runs in CI.

## 17. Rollback
Redeploy the previous web build/worker; the DB is a single file (copy to back up,
swap to restore). No destructive migrations. Cancel a stuck run in the UI.

## 18. Remaining limitations (explicit)
- Single-owner, no auth, no rate limiting — trusted single tenant only.
- SQLite + one worker; concurrency/multi-host needs Postgres (data layer is
  isolated in `src/app/store.ts` + `web/lib/server/store.ts` for the swap).
- Cancellation takes effect at the next phase boundary, not mid model-call.
- Web create flow targets the committed practice repo; arbitrary-repo + real PRs
  is the engine's separate opt-in path.
- The container path is provided but validate it with the smoke test; the local
  process path is the one proven here.

## 19. Recommended next milestone
Add real authentication (the model is ready) + rate limiting, then the Postgres
data layer, to move from trusted single-owner to a public multi-user product;
after that, wire the arbitrary-repo + real-PR path into the web create flow.
