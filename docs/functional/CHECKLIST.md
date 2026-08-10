# Functional application — working checklist

Living checklist for the `agent-forge-functional-app` branch. Checked items are
verified (test/run evidence), not just written.

## Foundation
- [x] Recover repo/branch/CI state; branch off verified `main`
- [x] Architecture audit (engine trace, web simulation inventory, CI/tests/docs)
- [x] Record plan (`docs/functional/PLAN.md`) and this checklist
- [x] Deterministic `fake` provider seam (`src/fake-model.ts`) driving the real engine
- [x] Engine test proving fake-provider ship + decline (`src/fake-model.test.ts`)

## Persistence
- [ ] SQLite schema + migration runner (`db/migrations/0001_init.sql`)
- [ ] Data-access layer (runs, events, approvals, artifacts, jobs) with row types
- [ ] Unit tests: migrations apply on a clean DB; constraints/indexes
- [ ] Seed data separate from real data

## Domain / lifecycle
- [ ] Pure lifecycle transition rules over `RunState` + zod schemas
- [ ] Unit tests: legal/illegal transitions, event ordering, idempotency

## Worker
- [ ] Job claim with lease; concurrent workers cannot double-run a step
- [ ] Runs real `workTicket`; `onProgress` → `run_events`
- [ ] Approval gate parks the job; resume only on a persisted decision
- [ ] Cooperative cancellation; terminal states are final
- [ ] Restart recovery (lease expiry) — tested by killing mid-run
- [ ] Bounded retry policy

## API (Next.js route handlers)
- [ ] Create/list/read runs; start; cancel; retry
- [ ] Approve/reject (idempotent, server-enforced)
- [ ] Event stream (SSE) with resume from last seq
- [ ] Artifacts read (path/type/size/ownership guarded)
- [ ] Health + readiness (honest)
- [ ] Server-side zod validation on every input

## UI (operational workbench)
- [ ] New-run flow (real `POST /api/runs`)
- [ ] Run view: live timeline, roster, approvals, artifacts, states
- [ ] Empty / loading / offline / failed / completed states
- [ ] Keep `/demo` as the labelled tour
- [ ] Reuse design system; no unconfirmed-success UI

## Security
- [ ] Threat model doc for the functional app
- [ ] Ownership checks server-side; cross-workspace isolation
- [ ] Secret handling (worker env only; never in client/DB/logs)
- [ ] Artifact path/traversal guards; payload size limits

## Tests & gates
- [ ] Unit + contract tests (lifecycle, idempotency, leases, redaction, approvals)
- [ ] Integration: create→plan→minion→evaluate→ship; approval park/resume; reject; cancel; restart recovery; duplicate delivery
- [ ] Playwright: core states + a11y; keep existing 34 e2e + axe green
- [ ] Engine `npm run typecheck` + `npm test` green
- [ ] Web `tsc --noEmit` + `test:e2e` green
- [ ] Production build + container build

## Deployment & handoff
- [ ] Topology doc (web + worker + SQLite), `.env.example` (names only)
- [ ] Migration/worker/build commands; container config
- [ ] Smoke-test script + post-deploy checklist + troubleshooting + rollback
- [ ] Morning handoff (19 points), honest status
