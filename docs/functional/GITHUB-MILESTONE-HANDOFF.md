# GitHub coding workbench — milestone handoff

## Honest status

**Core proven end-to-end, deterministically, in CI; live path built and
documented, live proof is credential-gated.** From the web app (and, through the
shared surface, Slack) you can submit a repo + issue task; the real engine works
an isolated checkout with the real gates, parks for approval before any external
write, and on approval opens a **verified draft PR** recorded durably — proven
with a deterministic GitHub adapter and provider (no network) in CI and a real
browser. Switching `FORGE_GITHUB=real` (with `gh` auth) uses the real adapter;
that live run and a live Slack workspace need your credentials, which I did not
create (per the boundaries). This is not "done" for the full Definition of Done
— remaining items are listed precisely below.

## 1. Branch
`agent-forge-functional-app` (off `main`; PR #2). CI green: `verify` (engine),
`web` (demo e2e/axe), `functional` (real DB + worker + engine browser e2e).

## 2. Final commit
Tip of the branch (`git log -1`). This milestone's increments: engine github
lifecycle → web composer/API → Slack shared surface → connection docs.

## 3. PR
https://github.com/salehaiftikharr/agent-forge/pull/2

## 4. Architecture
One engine, three interfaces (`docs/functional/CONNECTIONS.md`). Slack and web
both create the SAME durable github run in shared SQLite; the worker runs the
real `workTicket` on an isolated checkout via a **GitHub adapter** (`fake`
deterministic for CI / `real` gh-backed for live); approvals gate the push; the
draft PR is verified through the GitHub API and recorded. No orchestration in
Next.js or the Slack handler; the worker holds the model key, the Slack bot holds
Slack tokens, the browser holds neither.

## 5. Slack → engine → GitHub
Message → `handleSlackTask` parses it (`task-intake.ts`) and `createGithubRun`
(origin=slack, thread/user recorded) → worker executes → milestone poller posts
to the thread with Approve/Reject buttons → `handleSlackDecision` (authorized)
records the decision → worker ships → poller posts the PR URL.

## 6. Web → engine → GitHub
`/work/github` composer → `POST /api/tasks` (normalizes owner/name or a pasted
URL) → `createGithubRun` → worker → SSE workbench shows repo/branch/mode and the
approval gate with the diff → approve → verified draft-PR panel → persists.

## 7. GitHub authorization
Adapter interface + local `gh` real path (verify read before work, re-check
write before push, `agent-forge/` head branches, never force-push, never target
protected/default, draft by default). Production **GitHub App** model documented
(ADR in CONNECTIONS.md: contents r/w, PRs r/w, issues r, metadata r; server-side
encrypted tokens; per-installation repo allowlist). App token-minting adapter is
**not yet built** — the recommended next connection increment.

## 8. Slack authorization
Only the originating Slack user, or a `FORGE_SLACK_APPROVERS` allowlist, may
approve (`isApprover`, tested). Socket Mode (Slack authenticates the WebSocket).

## 9. Secret handling
Model key on the worker (and Slack bot) only; GitHub creds on the worker only;
Slack tokens on the bot only. Never in the browser, DB fields, logs, prompts,
artifacts, or Git. `.env.local` gitignored; `.env.example` names only.

## 10. Migrations
`0001_init`, `0002_github` (kind/repo/issue/branches/base_sha/checkout_dir/pr_*),
`0003_slack` (origin + slack channel/thread/user + notify cursors). Idempotent
`npm run migrate`.

## 11. Worker topology
One durable worker per DB; leases + recovery + bounded retries; `execute` and
`ship` phases; the Slack bot is a separate process that only reads/writes the
shared DB (no model/GitHub access).

## 12. Tests & CI
Engine `npm test` = **122 pass** (incl. 12 task-intake, 3 adapter, 3 github-run
lifecycle, 4 slack-surface). Web `tsc` clean; functional Playwright = **19 pass**
(includes the github compose→approve→verified-PR flow + a11y). All green in CI.

## 13. Screenshots
Prior functional proof in `docs/functional/screenshots/`. (No new live GitHub
screenshots yet — that is part of the credential-gated live proof.)

## 14. Local startup
`docs/functional/DEPLOYMENT.md` §A for migrate + worker + web. For github tasks:
open `/work/github`. For real mode: `gh auth login` and `FORGE_GITHUB=real`.

## 15. GitHub setup
`docs/functional/CONNECTIONS.md` → GitHub connection (local `gh`; production App
permissions + ADR).

## 16. Slack setup
`docs/functional/CONNECTIONS.md` → app manifest, scopes, Socket Mode tokens, and
`npm run slack:app`.

## 17. Deployment
Web + worker + shared DB (+ optional Slack bot process), all on the shared
`FORGE_DB_PATH`. See DEPLOYMENT.md; the Slack bot and real worker need a
persistent host.

## 18. Live test procedure (opt-in, credential-gated)
On a dedicated practice repo: `gh auth login`; start the worker with
`FORGE_GITHUB=real` + your key; create an issue; run it from `/work/github` (or
Slack); approve; confirm a real draft PR opens and `gh pr view` verifies it. Do
not use an important repo for the first run.

## 19. Remaining limitations (precise)
- GitHub App token-minting adapter not built (real mode = local `gh`).
- Live GitHub PR and live Slack workspace not exercised (need your credentials).
- Task-confirmation preview (show parsed task before execution) not yet added.
- Full Playwright matrix (mobile/tablet/dark/reduced-motion/keyboard on the
  github flow) partial: desktop + a11y + viewport-overflow covered.
- Execution isolation is the engine's existing sandbox (path-confined, can't edit
  tests); a locked-down container executor with resource limits is not yet added.

## 20. Recommended next milestone
Build the GitHub App adapter (server-side installation tokens), then run the
opt-in live proof on a practice repo from both Slack and web, add the
task-confirmation preview and the container executor, and complete the Playwright
matrix. After that, auth + rate limiting for multi-user.
