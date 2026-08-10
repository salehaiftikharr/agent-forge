# Milestone: real GitHub coding workbench (Slack + web + CLI on one engine)

Goal: from Slack or the web, delegate a real ticket ("inspect owner/repo, fix
issue #42, run checks, prepare a PR"), watch real minions work an isolated
checkout, approve the guarded push, and get a **verified real draft PR** — same
engine, same run records, same approvals across all three surfaces.

## Design

- **One engine, three interfaces.** Slack and web both create durable runs in the
  shared SQLite DB; the worker runs the real `workTicket` engine; the CLI already
  does. No orchestration is duplicated in Next.js or the Slack handler.
- **GitHub adapter seam** (mirrors the provider seam): `RealGitHubAdapter` wraps
  the engine's `gh`/git path; `FakeGitHubAdapter` is deterministic and offline
  (checks out the practice seed, returns a canned-but-clearly-fake PR) so the
  whole lifecycle is provable in CI with no network or credentials.
- **Human approval before the first external write.** The engine's PR path is
  decomposed: `execute` = verify read access → read issue → isolated checkout →
  minion + gates → verified diff → **park for approval**; `ship` = re-check write
  access → commit + push + open draft PR → **verify via GitHub API** → persist.
- **Authorization.** Local dev may use authenticated `gh`. Production uses a
  GitHub App (ADR-0001); tokens server-side only, encrypted, never in the
  browser/Slack/logs/prompts. Repository allowlist per workspace; read vs write
  distinguished; write re-checked before push.

## Checklist (maintained through the milestone)

### Foundation
- [x] Recover state; trace engine GitHub path (`src/minion/github.ts`) + Slack bot
- [x] Record this checklist
- [x] `src/app/task-intake.ts` — NL + GitHub-URL task extraction (pure, 12 tests)
- [x] `src/app/github-adapter.ts` — interface + Fake (deterministic) + Real (wraps `gh`)
- [x] Pure helpers tested: URL parse, branch naming (agent-forge/ namespace), PR payload

### Persistence & lifecycle
- [x] Migration 0002: github fields on runs (kind, repo, issue, base/head branch, base_sha, checkout_dir, pr_number, pr_url, pr_state, pr_draft, github_mode, open_pr)
- [x] Store: `createGithubRun` + github fields on RunRow
- [x] Orchestrator github `execute` (verify read → read issue → isolated checkout → minion → verified diff → park)
- [x] Orchestrator github `ship` (re-check write → push + draft PR + GitHub-API verification), with findOpenPr reconciliation
- [x] Integration test: github run → engine → minion → verified diff → approval → fake PR → verified (3 tests: ship, prepare-only, idempotent)

### API & web workbench
- [x] API: `POST /api/tasks` creates a github run; normalizes owner/name or a pasted URL
- [x] New-task composer (`/work/github`): repo/URL/issue/goal/base/PR-behavior
- [ ] Task confirmation (parsed task shown before execution when uncertain)
- [x] Workbench shows repo, base→head branch, github mode, and a verified draft-PR panel
- [x] Diff + PR artifacts in the run view; approval gate before the push
- [x] Playwright: compose → approval → verified draft PR → persists (+ a11y on the composer)
- [ ] Review panel polish: explicit commands/checks/risks list before approval

### Slack (shared engine)
- [ ] Slack task → creates the SAME run in the shared DB (not a separate path)
- [ ] Thread-per-run; milestone updates; approval controls; authorized users only
- [ ] Signature/timestamp/replay verification; Socket-Mode reconnect without dup runs
- [ ] Web approval updates Slack; Slack approval updates web

### Security
- [ ] Repo content treated as untrusted (no prompt-injection authority, no secret access)
- [ ] Isolated non-root worker execution; resource/time limits; path/symlink validation
- [ ] Secret redaction across stdout/stderr/traces/prompts/artifacts
- [ ] Never push to protected/default; never force-push; never touch unrelated repos

### Provider/model
- [ ] Verify the exact provider model id before changing defaults; keep configurable; record per-run

### Tests / CI / docs
- [ ] Unit + integration (deterministic fakes) + Playwright + a11y green in CI
- [ ] Opt-in live smoke against a dedicated practice repo (explicit flag + creds)
- [ ] Docs: architecture, GitHub App perms, Slack manifest/scopes, setup, deploy, rollback, revocation
- [ ] Handoff (20 points), honest limitations

## Boundaries (per directive)
No creating external accounts, installing a GitHub App into repos, opening real
PRs outside a designated practice repo, or deploying — without explicit
authorization. Finish all independent implementation first; hand over exact steps
for the credential-gated parts. Never call a fixture/mock/simulated PR "complete".
