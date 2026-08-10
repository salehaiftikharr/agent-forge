# Functional application — working checklist

Checked items are verified with test/run evidence.

## Foundation
- [x] Recover repo/branch/CI state; branch off verified `main`
- [x] Architecture audit (engine, web simulation, CI/tests/docs)
- [x] Record plan + this checklist
- [x] Deterministic `fake` provider driving the real engine (`src/fake-model.ts`)
- [x] Engine test proving fake-provider ship + decline

## Persistence
- [x] SQLite schema + idempotent migration runner (`db/migrations/0001_init.sql`)
- [x] Typed store enforcing lifecycle + ownership; row types
- [x] Migrations verified on a clean DB (tables created)
- [x] Seed (practice repo) separate from run data

## Domain / lifecycle
- [x] Pure transition rules over `RunState` + zod schemas
- [x] Tests: transitions, event ordering, idempotency

## Worker
- [x] Job claim with lease (immediate txn); no double-run
- [x] Runs real `workTicket`; `onProgress` → `run_events`
- [x] Approval gate parks; resumes only on a persisted decision (reconcile)
- [x] Cooperative cancellation; terminal states final
- [x] Restart/crash recovery via lease expiry (tested)
- [x] Bounded retry with backoff

## API (Next.js)
- [x] Create/list/read runs; decision (approve/reject); cancel
- [x] SSE stream with Last-Event-ID resume
- [x] Health + honest readiness
- [x] Server-side zod validation

## UI (Work)
- [x] New-run flow (real `POST /api/runs`)
- [x] Run view: live SSE timeline, approval gate, artifacts, gate stats
- [x] Empty / connecting / live / reconnecting / final states
- [x] Demo kept as labelled tour
- [x] Reuses design system; verified in a real browser (screenshots)

## Security
- [x] Threat model (`docs/functional/SECURITY.md`)
- [x] Ownership on every row; browser has no lifecycle authority
- [x] Secret only on the worker; none in client/DB/logs/fixtures
- [x] Artifact bodies are inert rows (no path handles); payload size bounds

## Tests & gates
- [x] Engine + lifecycle: `npm test` = 100 pass
- [x] Web: `tsc --noEmit` clean; `test:e2e` = 34 pass (demo + axe)
- [x] Smoke script passes against a live stack
- [x] Production web build passes
- [~] Automated browser-level functional e2e — proven manually (screenshots) and
      via the integration suite; a Playwright harness was attempted but its
      web+worker+DB orchestration was flaky in this environment and was removed
      rather than shipped broken. See §18 of the handoff.
- [ ] Full viewport matrix / reduced-motion / keyboard sweep on `/work` (partial)

## Deployment & handoff
- [x] Topology + local/container/split docs (`docs/functional/DEPLOYMENT.md`)
- [x] `.env.example` (root + web), names only
- [x] Migrate/worker/build commands; `Dockerfile.worker` + `docker-compose.yml`
- [x] Smoke script + rollback + troubleshooting + known limitations
- [x] Morning handoff (`docs/functional/HANDOFF.md`), honest status

## Deferred (explicit, not hidden)
- [ ] Authentication + rate limiting (model is auth-ready)
- [ ] Postgres data layer for concurrency/multi-host
- [ ] Arbitrary-repo + real GitHub PR from the web create flow
