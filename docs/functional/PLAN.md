# Agent Forge — functional application plan

Branch: `agent-forge-functional-app` (based on verified `main`, which already
contains the merged presentation/demo). This document maps every simulated web
surface to a real engine / API / persistence / event source, and records the
architecture so the work can resume after interruption.

## The thesis, unchanged

The engine already does the hard part: a ticket becomes a real fix on a real
sandboxed git workspace, accepted only when a previously-failing test passes with
no regressions, the worker cannot edit the test, a mutation gate and a judge
guard against gaming, and confidence/risk decide the ship lane. This phase does
**not** re-implement any of that. It puts a real, durable, multi-surface
application in front of the same engine.

## Two tiers (kept separate on purpose)

This mirrors the repo's existing split and the deployment reality that background
minions need a persistent process, which a serverless request handler is not.

1. **Web tier** (`web/`, Next.js): API routes + UI + a SQLite client. Creates and
   reads runs, enqueues work, serves the live event stream (SSE). It does **not**
   import the engine and holds **no** model credentials.
2. **Worker tier** (engine package, `src/app/worker.ts`, run with `npm run
   worker`): a durable process that claims queued runs with a lease, runs the real
   `workTicket` on a sandbox workspace, and writes state/events/artifacts to the
   shared database. This is the only tier that talks to a model provider.
3. **Shared SQLite database** (`FORGE_DB_PATH`): the single source of truth. Both
   tiers open the same file through `better-sqlite3` and the same schema in
   `db/migrations/`.

Provider selection is one env var: `LLM_PROVIDER=fake` (deterministic, offline —
default for local/CI/Playwright, proves the whole pipeline with no secret) or
`anthropic`/`openai` (live, the owner supplies the key to the worker only).

## The engine seam (built and proven)

`getModel()` in `src/model.ts` is the single provider chokepoint. A gated `fake`
branch (`src/fake-model.ts`) returns a deterministic `MockLanguageModelV3` that
drives the **real** engine — real Workspace, git, test runner, and every gate —
to two scripted outcomes on the committed `sandbox/` corpus: TICKET-002 ships a
clamp fix, TICKET-004 is an honest decline. Covered by `src/fake-model.test.ts`.
This is the foundation the worker runs on; flipping the env var makes it live.

## Data model (SQLite, `db/migrations/0001_init.sql`)

`workspaces`, `runs`, `run_events` (append-only ledger, monotonic seq per run),
`approvals`, `artifacts`, `jobs` (queue with `lease_owner`/`lease_expires_at`),
plus `schema_migrations`. Ownership via `workspace_id` on every row; single-owner
mode is a fixed owner id, architected so real auth is additive. Lifecycle uses
the `RunState` already defined in `web/lib/types.ts`.

## Simulated → real mapping (from the audit)

| Simulated surface | Real backing |
| --- | --- |
| `RUNS` list/detail fixtures | `runs` table via `GET /api/runs`, `/api/runs/:id` |
| Run `timeline` fixtures | `run_events` ledger via SSE `GET /api/runs/:id/events` |
| Demo state machine (`demo-player`) | kept as the `/demo` tour; real run created via `POST /api/runs` |
| Approve/Reject note-only controls | `approvals` + `POST /api/runs/:id/approve|reject`, enforced in the worker |
| Retry/Cancel note-only controls | `POST /api/runs/:id/cancel` (+ retry where eligible); worker honors cooperatively |
| Roster fixtures | seeded workspace/minion rows |
| Settings "not configured" | honest health/readiness + provider mode from `GET /api/health`, `/api/ready` |
| Stale 2026 timestamps | real timestamps from the DB |
| `DemoBadge` everywhere | `EngineBadge`/live indicators on API-backed screens |

## Approval gate (new, real enforcement)

The engine has no synchronous "pause for approval" primitive; the worker adds
one. When a run reaches a gated point, the worker persists a pending `approval`
and parks the job (`waiting_approval`) **before** presenting it. Execution cannot
proceed until an authorized decision row exists; the decision is re-checked at
execution time; approve/reject are idempotent. A forged client request cannot
bypass this because the worker, not the browser, reads the decision from the DB.

## What is deterministic vs. live vs. demo (kept visibly distinct)

- **Product tour** (`/demo`, `/about`): fictional fixtures, labelled.
- **Local/CI functional mode**: real DB + worker + engine with `LLM_PROVIDER=fake`.
- **Live functional mode**: same, with a real provider key on the worker.

## Honest scope for this branch

Delivered and proven end-to-end with the deterministic provider: persistence,
API, worker with leases + recovery, SSE, approval enforcement, artifacts, a real
operational UI, and the full test + Playwright + build gates. The live-provider
multi-minion GitHub-PR path is documented as an opt-in smoke test, not run here
(it needs the owner's key and `gh` auth). Any remaining limitation is stated in
the handoff, never hidden behind fixtures.
