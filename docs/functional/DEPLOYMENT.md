# Deploying the functional Agent Forge application

This is the functional app (real runs over the engine), distinct from the
marketing/demo deploy in `docs/DEPLOYMENT.md`. It has three parts:

```
  Browser ──HTTP──▶  Web tier (Next.js)  ──┐
                     API + UI, no secrets  │   shared SQLite database
                                           ├──▶  (FORGE_DB_PATH, on a
  Model provider ◀──  Worker (engine) ─────┘      persistent disk)
   (only the worker)   claims jobs, runs the real minion, writes events
```

Two processes (web, worker) share one SQLite file. The **worker is the only
tier with a model key**. Set `LLM_PROVIDER=fake` and there is no key and no
network at all — the full engine still runs deterministically on the practice
repo, which is how the pipeline is proven in CI and locally.

## A. Local run (verified end to end)

From the repo root, in three terminals (or backgrounded):

```bash
npm install
cd web && npm install && cd ..

# 1) Create/upgrade the database (idempotent).
FORGE_DB_PATH=$PWD/.forge-data/forge.db npm run migrate

# 2) Start the worker (offline, deterministic).
FORGE_DB_PATH=$PWD/.forge-data/forge.db LLM_PROVIDER=fake npm run worker

# 3) Build and start the web tier against the same database.
cd web
FORGE_DB_PATH=$PWD/../.forge-data/forge.db LLM_PROVIDER=fake npm run build
FORGE_DB_PATH=$PWD/../.forge-data/forge.db LLM_PROVIDER=fake npm start   # http://localhost:3001
```

Open `http://localhost:3001/work`, click **New run**, keep the clamp ticket, and
**Start run**. You will watch the real engine stream plan → implement → gate →
approval, approve it, and see a shipped diff artifact that survives a refresh.

To run it **live** instead of offline, set `LLM_PROVIDER=anthropic` and
`ANTHROPIC_API_KEY=...` on the **worker only**, then start a run — the same code
path, a real model. See "Live smoke test" below.

## B. Container run (provided)

`docker-compose.yml` builds both images and wires the shared volume:

```bash
docker compose up --build
# migrate runs once, then worker + web start; open http://localhost:3001/work
```

The compose file sets `LLM_PROVIDER=fake` by default. For live mode, put
`LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` in a `.env` next to the compose
file (compose reads it) — it is passed to the **worker service only**.

## C. Split hosting (web on a serverless host + a persistent worker)

If the web tier runs on a serverless host (e.g. Vercel), the worker and database
CANNOT live there — background minions need a persistent process and disk. Deploy:

- **Web**: the Next.js app, with `FORGE_DB_PATH` pointing at the shared database
  and `LLM_PROVIDER` set for labelling. No model key.
- **Worker**: a small always-on VM/container running `npm run worker`, with the
  model key, the same `FORGE_DB_PATH`, and `FORGE_RUNS_DIR` on a persistent disk.
- **Database**: the SQLite file on a disk both can reach. SQLite over a shared
  network filesystem is fragile; for true multi-host, migrate the store to
  Postgres (the schema is standard SQL and the data layer is isolated in
  `src/app/store.ts` / `web/lib/server/store.ts` for exactly this swap). Until
  then, the supported topology is web + worker + disk on the **same host/volume**.

Run exactly **one** worker per database unless you move to Postgres advisory
locks; the lease protects against a crash, not against many concurrent workers.

## Commands

| Purpose | Command |
| --- | --- |
| Migrate (deploy step, idempotent) | `npm run migrate` |
| Start worker | `npm run worker` |
| Build web | `cd web && npm run build` |
| Start web | `cd web && npm start` |
| Engine + lifecycle tests | `npm test` |
| Web build + demo e2e/a11y | `cd web && npx tsc --noEmit && npm run test:e2e` |
| Smoke test | `node scripts/smoke-functional.mjs` (see below) |

## Environment reference

Names and meanings are in `.env.example` (root, for the worker) and
`web/.env.example` (web tier). No secret values live in either. The only secret
in the whole system is the model key, and only the worker reads it.

## Post-deploy smoke test

`scripts/smoke-functional.mjs` drives the API end to end (create → wait for the
approval gate → approve → wait for the shipped artifact) with the deterministic
provider, and exits non-zero on any failure:

```bash
# against a running web tier + worker on the same database:
BASE_URL=http://localhost:3001 node scripts/smoke-functional.mjs
```

## Live smoke test (opt-in, uses your key and spends tokens)

1. Stop the offline worker. Start it live:
   `FORGE_DB_PATH=... LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... npm run worker`
2. In the UI, start a run on **TICKET-001** or **TICKET-003** (the ones marked
   "needs a live provider"). A real model plans and edits; the same gates decide.
3. Confirm the timeline shows real model activity and the run either ships (after
   your approval) or is honestly declined. Nothing runs a live model in CI.

## Rollback

- **Code**: redeploy the previous build/image (web) and restart the previous
  worker build. There are no destructive migrations in `0001`, so rolling code
  back does not require a data change.
- **Data**: the database is a single file — back it up by copying it (ideally
  with the worker paused). Restore by swapping the file back. Keep the last
  known-good copy before any future migration.
- **A stuck run**: cancel it in the UI (or `POST /api/runs/:id/cancel`); the
  worker cancels cooperatively at the next boundary. Terminal states never revert.

## Troubleshooting

- **"database is not migrated"** on web start → run `npm run migrate` against the
  same `FORGE_DB_PATH` first (the worker/migrate tier owns the schema).
- **Runs stay `queued`** → the worker is not running or points at a different
  `FORGE_DB_PATH`. Confirm both processes print/use the same absolute path.
- **`/api/health` shows `pendingApprovals`** that never clear → a human decision
  is required; open the run and approve/reject.
- **`SQLITE_BUSY`** under load → expected only with multiple writers; run a single
  worker, or move to Postgres for concurrency.
- **Live run errors immediately** → the worker is missing `ANTHROPIC_API_KEY`, or
  `LLM_PROVIDER` is not `anthropic`/`openai`.

## Known limitations (stated plainly)

- The practice repo is the committed `sandbox/` corpus. Pointing minions at an
  arbitrary GitHub repo + opening real PRs is the engine's existing opt-in path
  (`ANTHROPIC_API_KEY` + `gh` auth) and is **not** wired into the web create flow
  in this branch.
- SQLite + a single worker is the supported concurrency model. Multi-worker /
  multi-host needs the documented Postgres swap.
- Cancellation is cooperative: it takes effect at the next phase boundary, not
  mid model-call.
- Single-owner mode: one fixed owner id, no login. The domain model carries
  `workspace_id`/`owner_id` on every row so real auth is additive, not a rewrite.
