# Functional application — threat model

Scope: the functional app added in this branch (web API/UI + shared SQLite +
durable worker). The engine's own safety model (sandboxed runs, minions cannot
edit their gate tests, deny-by-default tools) is covered in the root
`SECURITY.md` and unchanged. Default posture: **narrowest authority**.

## Trust boundaries

- The **browser** is untrusted. It can call the API but holds no lifecycle
  authority: it can create work and record an approval decision, nothing else.
  Every state transition happens in the worker.
- The **web tier** validates all input server-side (zod) and holds no model key.
- The **worker** is the only tier with a model credential and the only tier that
  executes minions or transitions runs.
- The **database** is the single source of truth; the event ledger — not any
  client state — determines rendered history.

## Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| Secret exposure | The only secret is the model key; it lives on the worker's env only. Never in the client bundle, DB, logs, fixtures, or `.env.example`. The web tier has no key. |
| Approval bypass (forged client request) | Shipping requires a persisted `approved` row, re-checked in the worker at ship time (`shipRun`). A client cannot ship by calling an endpoint — it can only record a decision; the worker reads that decision from the DB. |
| Illegal state transitions | Enforced centrally in `lifecycle.ts` / the store; terminal states are final and cannot return to running. The client cannot express a transition. |
| Replay / duplicate requests | Job enqueue is idempotent (`dedupe_key`); approval decisions are idempotent (partial unique index on the pending row + no-op on repeat). Duplicate delivery cannot double-ship. |
| Worker impersonation / double execution | Jobs are claimed under a lease inside an immediate transaction; only the lease holder advances a job. An expired lease is reclaimed on recovery, never double-run. |
| Cross-run / cross-workspace access | Every row carries `workspace_id`/`owner_id`; reads are scoped. Single-owner mode uses one fixed owner; the model is built so real auth adds a check, not a rewrite. |
| Path traversal / arbitrary file read via artifacts | Artifacts are DB rows (text bodies), not filesystem handles; an artifact id cannot address a path. Minion file writes are already confined by the engine's `Workspace` (no escape, cannot touch tests). |
| Prompt injection via goal/context | The goal drives a minion on a sandboxed copy; the acceptance bar is a real test run the model cannot fake, plus the mutation/judge gates. A malicious goal cannot make the gate pass a bad change or escape the sandbox. |
| Shell / command injection | No user input is interpolated into a shell. The worker runs fixed argv; the engine's test runner uses argv arrays (the `MINION_TEST_CMD` shell escape hatch is operator-set env, not user input). |
| SSRF / unsafe fetch | The functional API makes no outbound requests. Outbound network is limited to the model provider from the worker (and the engine's opt-in web tools, unchanged). |
| Oversized payloads | Request bodies are bounded by zod (`goal` ≤ 4000, `context` ≤ 8000, `note` ≤ 2000). |
| Sensitive logging / error leakage | Errors return short messages; stack traces are not sent to the client. The worker logs run ids and messages, not secrets. |
| Denial of service | Single-owner, single-worker; work is queued and processed one at a time. A public multi-user deployment would need rate limiting and auth (out of scope here — see limitations). |
| Malicious file content in a run | The minion edits source on a throwaway sandbox copy; nothing from a run is executed by the web tier, and artifacts are inert text. |
| Dependency / container risk | Minimal dependencies (`better-sqlite3`, `zod`, the engine's existing set). No new network services. Pin and scan as usual before a public deploy. |

## Known gaps (explicit)

- **No authentication** yet: single-owner mode is intended for a trusted,
  single-tenant deployment. Do not expose it to untrusted users without adding
  auth + rate limiting. The domain model is auth-ready (`owner_id`/`workspace_id`).
- **No rate limiting** on the API.
- **SQLite** assumes one writer (one worker); concurrency needs the Postgres swap.
