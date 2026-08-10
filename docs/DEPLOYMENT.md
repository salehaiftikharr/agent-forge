# Deploying Agent Forge

Agent Forge is two things, deployed differently:

1. **The engine** — a TypeScript CLI + Slack bot (`src/`). This is where minions
   run: they fix issues on a sandboxed clone and open a PR only when a test
   proves the fix. It runs on your machine or a worker box; it is **not** a
   public web service and needs real model credentials.
2. **The web product** (`web/`) — a Next.js app: the landing page, the guided
   demo, and the operational views (Forge, Minions, Runs). It is **read-mostly**
   with **no backend, database, authentication, or secrets**. The engine's
   evaluation numbers are vendored in `web/engine-data/` and baked into the pages
   at **build time**, so the running site needs nothing at runtime.

This guide covers deploying the **web product**, plus how to run the engine.
Because the web tier has no secrets or database, deployment is genuinely simple.

## What the web product needs

- Node 22+ to build. Nothing at runtime beyond the built server.
- **No environment variables are required.** See `web/.env.example`.
- No database, no worker, no queue, no persistent volume.

## Path A — Vercel (recommended)

1. Import the repository at vercel.com, set **Root Directory** to `web`.
2. Deploy. No environment variables to set.
3. TLS and CDN are automatic. Add a custom domain in Vercel → Domains if wanted.

Redeploys on push; rollback is one click in the Deploys list.

## Path B — Container (any host)

A production image is provided at `web/Dockerfile` (Next.js standalone, non-root,
with a healthcheck). Verified to build and serve locally.

```
cd web
docker build -t agent-forge-web .
docker run -d -p 3001:3001 --name agent-forge-web agent-forge-web
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/   # expect 200
```

Put a TLS-terminating reverse proxy (Caddy, nginx, or the platform's) in front
and forward to the container's port 3001. The container binds `0.0.0.0:3001` and
runs as the non-root `nextjs` user.

Resource expectation: tiny. ~128–256 MB RAM; it is a static-plus-SSR Next app
with no background work.

## First-run smoke test (either path)

1. `curl -s -o /dev/null -w "%{http_code}\n" https://<your-host>/` → `200`.
2. Open `/` — the landing page loads with the eval proof strip (0 unsafe ships).
3. Open `/demo` and step through: propose → review → create → run → approval →
   recovery → shipped. It is deterministic; no credentials involved.
4. Open `/minions` and `/runs/r-recover` — the roster and a run timeline render.

Or run the automated suite against a build locally: `cd web && npm run test:e2e`
(34 e2e + axe; see below).

## Rollback

- **Vercel:** Deploys → previous successful deploy → Rollback.
- **Container:** run the previous image tag. Keep the last known-good tag, e.g.
  `docker run ... agent-forge-web:<previous-sha>`.

There is no database, so rollback is purely swapping the running build.

## Upgrade

- **Vercel:** push to the deployed branch.
- **Container:** rebuild and restart: `docker build -t agent-forge-web . && docker
  compose up -d` (or re-run the container).

## Running the engine (separate from the web deploy)

The minions run from the CLI, not the web app. On a machine with credentials:

```
npm install
cp .env.example .env.local     # add ANTHROPIC_API_KEY (and OPENAI_API_KEY to compare providers)
npm run forge -- build "triage repo issues and open a PR when tests pass"
npm test                        # engine suite (91 tests)
```

Engine environment variables live in the repo-root `.env.example`. The web
product does not read them.

## Known limitations (stated honestly)

- The web product is a **presentation and demo** surface. It does **not** execute
  minions, call a model, authenticate users, or persist anything. Demo
  interactions (approve/reject, pause, retry) are **session-local** and labelled
  as such in the UI.
- Real minion orchestration, the verification gate, and the evals live in the
  **engine** and are covered by the engine test suite; the web app renders the
  engine's recorded results plus one fictional dataset, always labelled.
- There is therefore no web database, migration, worker, or auth to deploy. If a
  live, multi-user, model-calling web backend is ever wanted, it is net-new work
  and is out of scope for this build.
