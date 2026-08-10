# Agent Forge — morning handoff

_Overnight deployment-readiness cycle. Branch `forge-product-rebuild`, PR #1._

## Status, honestly

- **Web product (`web/`): DEPLOYMENT READY.** One Vercel import with the root set
  to `web`, no environment variables, no database. A production container is also
  built and verified. Nothing is left half-wired.
- **Engine (CLI + Slack, `src/`): READY WITH MANUAL STEPS.** It runs from your
  machine or a worker box and needs your own `ANTHROPIC_API_KEY`. This is by
  design — the engine is not a hosted web service, so "deploy" here means "run it
  with your key," not "click a button."

There is no NOT-READY item. The only thing standing between you and a live web
URL is choosing a host and clicking deploy; the only thing standing between you
and a live minion run is pasting in an API key.

## What I verified (evidence)

All run tonight, all green:

- **Engine tests:** `npm test` → 91 pass / 0 fail.
- **Web typecheck:** `tsc --noEmit` → clean.
- **Web production build:** `next build` → success (standalone output).
- **Web e2e + accessibility:** `npm run test:e2e` → 34 pass, axe reports 0 serious
  or critical violations across all routes.
- **Container:** `docker build` succeeds; the container serves `/` → HTTP 200 with
  the real landing content and `/minions` → HTTP 200, running as a non-root user.
- **CI in GitHub's own environment:** the new `web` workflow (typecheck + build +
  e2e + axe) and the existing engine `verify` workflow both pass on PR #1.

## What changed this cycle

- `web/next.config.mjs` → `output: "standalone"` so the app ships as a
  self-contained server. Engine eval data is baked in at build time, so the
  running site needs no repo-root access and no runtime secret.
- `web/Dockerfile` + `web/.dockerignore` → multi-stage production image
  (node:22-alpine, non-root `nextjs` user, healthcheck, port 3001).
- `web/public/robots.txt` → allows crawling.
- `web/.env.example` → documents that the web app needs **no** runtime variables.
- `docs/DEPLOYMENT.md` → the deploy guide: Vercel path, container path, first-run
  smoke test, rollback, upgrade, and honest known limitations.
- `.github/workflows/web.yml` → CI for the web product, scoped to `web/**`.

## Deploy it (short version)

Full detail is in `docs/DEPLOYMENT.md`. The fast path:

1. Import the repo at vercel.com, set **Root Directory** to `web`, deploy. No env
   vars to set.
2. Smoke test: `curl -s -o /dev/null -w "%{http_code}\n" https://<host>/` → `200`,
   then click through `/demo`.

To run the engine (separate): `npm install`, put `ANTHROPIC_API_KEY` in
`.env.local`, then `npm run forge -- build "<goal>"`.

## Known limitations (so you are not surprised)

- The web app is a **presentation and demo** surface. It does not execute minions,
  call a model, authenticate users, or persist data. Demo actions
  (approve/reject, pause, retry) are session-local and labelled as such.
- Real orchestration, the verification gate, and the evals live in the **engine**
  and are covered by its test suite. The web app renders the engine's recorded
  results plus one clearly-labelled fictional dataset.
- No web database, migration, worker, or auth exists to deploy. A live,
  multi-user, model-calling web backend would be net-new work, out of scope here.

## Boundaries respected

- No deploy performed, no external accounts touched, no purchases, no credentials
  printed or committed. `web/.env.example` contains no secrets.
- Public fixtures use only fictional data.
- Saaya was not touched: this cycle was Agent Forge only, per the directive.
- No git history rewritten, no force-push. Every change is an ordinary commit on
  `forge-product-rebuild`, pushed to PR #1.

## Optional next steps (not blocking)

- Merge PR #1.
- Bump the CI actions off the deprecated Node 20 runner warning (cosmetic;
  `actions/checkout` and `actions/setup-node` will move to newer majors upstream).
- If you ever want a live web backend, that is a separate design and build.
