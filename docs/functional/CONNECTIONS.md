# Connecting GitHub and Slack (shared engine)

Slack, the web app, and the CLI are three interfaces to one engine. A task from
any of them becomes the same durable run in the shared SQLite database; the same
worker executes it; approvals and the resulting PR are shared. This document is
how to connect the two external systems.

```
  Slack  ─┐
  Web    ─┼─▶  shared runs (SQLite)  ─▶  worker  ─▶  GitHub (adapter)
  CLI    ─┘        (one ledger)          (engine)       (issue → PR)
```

The **worker** holds the model key and does all execution. The **Slack bot**
holds the Slack tokens and posts milestones/approvals by reading the shared DB —
it never touches the model or GitHub directly. Nothing exposes a secret to the
browser.

## Provider modes (honest by default)

- `FORGE_GITHUB=fake` (default): runs work the committed practice checkout and
  produce a clearly-labelled fake PR. No real repository is touched, no
  credentials needed. This is what CI and local demos use.
- `FORGE_GITHUB=real`: runs clone a real repository and open a real draft PR.
  Requires GitHub auth on the worker (below).

## GitHub connection

### Local development (supported today)

The real adapter uses the authenticated `gh` CLI:

```bash
gh auth login          # once, on the machine running the worker
# then run the worker in real mode:
FORGE_DB_PATH=... LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... FORGE_GITHUB=real npm run worker
```

The adapter verifies read access before working and re-checks **write** access
before pushing. It never force-pushes, never targets a protected/default branch
(the head branch is always namespaced `agent-forge/...`), and opens a **draft**
PR that a human merges.

### Production (GitHub App — recommended, ADR)

For a deployed multi-tenant service, replace machine-wide `gh` with a **GitHub
App** so access is intentional, scoped, and revocable. Decision:

- **Why an App, not a PAT or `gh`:** per-installation repository access (the
  owner picks exactly which repos), short-lived installation tokens, org-level
  revocation, and no human's personal credentials on a server.
- **Required permissions (narrowest that work):**
  - Repository contents: **read & write** (clone, push a branch)
  - Pull requests: **read & write** (open the draft PR)
  - Issues: **read** (read the ticket)
  - Metadata: **read** (required baseline)
- **Token handling:** mint installation tokens server-side on demand; store any
  persisted credential encrypted with an explicit production key; never send a
  token to the browser, Slack, logs, prompts, artifacts, or Git.
- **Access checks:** verify the repo is within the installation before starting;
  re-check write permission before pushing; record which installation/user
  authorized each action.

Status: the adapter interface and the local `gh` path are implemented and
tested; the GitHub App token-minting adapter is **not yet built** — it is the
recommended next connection increment. Until then, `real` mode = local `gh`.

## Slack app

The shared-engine bot uses **Socket Mode**, so no public URL is needed and Slack
authenticates the WebSocket (no HTTP signature handling).

1. Create an app at api.slack.com/apps → **From an app manifest**, paste:

```yaml
display_information:
  name: Agent Forge
features:
  bot_user:
    display_name: Agent Forge
    always_online: true
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - chat:write
      - im:history
      - im:read
      - im:write
      - channels:history
      - groups:history
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.im
  interactivity:
    is_enabled: true
  socket_mode_enabled: true
```

2. **Socket Mode** → generate an **App-Level Token** with `connections:write` →
   `SLACK_APP_TOKEN` (starts `xapp-`).
3. **Install to Workspace** → copy the **Bot User OAuth Token** → `SLACK_BOT_TOKEN`
   (starts `xoxb-`).
4. Run the bot against the SAME database as the worker and web:

```bash
FORGE_DB_PATH=... LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... \
FORGE_GITHUB=real FORGE_WEB_URL=https://your-web-host \
SLACK_BOT_TOKEN=xoxb-... SLACK_APP_TOKEN=xapp-... \
FORGE_SLACK_APPROVERS="U0123,U0456" \
npm run slack:app
```

Then DM the bot or @mention it: "Fix issue #42 in owner/repo and open a PR." It
replies in a thread with the interpreted task and a link to the live web run,
posts milestones, and shows Approve / Reject buttons at the gate. Only the person
who started the task (or a `FORGE_SLACK_APPROVERS` allowlist) can approve.

## Environment reference (connection variables)

| Variable | Where | Meaning |
| --- | --- | --- |
| `FORGE_GITHUB` | worker, web, slack | `fake` (default, offline) or `real` |
| `ANTHROPIC_API_KEY` | worker (+ slack) | model key; only these tiers ever hold it |
| `FORGE_WEB_URL` | slack | base URL used in Slack run links |
| `SLACK_BOT_TOKEN` | slack | `xoxb-` bot token |
| `SLACK_APP_TOKEN` | slack | `xapp-` app-level token (Socket Mode) |
| `FORGE_SLACK_APPROVERS` | slack | optional comma/space list of Slack user ids allowed to approve |
| `FORGE_SLACK_POLL_MS` | slack | milestone poll interval (default 2000) |

Names only; never commit real values. See `.env.example`.

## Revoking access

- **Slack:** uninstall the app from the workspace (api.slack.com/apps → your app
  → Install App → Revoke), and/or rotate the bot/app tokens.
- **GitHub (local):** `gh auth logout`. **GitHub App:** uninstall the App from the
  org/repos and rotate its private key.
- Runs already recorded stay in the database; no further external action can be
  taken once tokens are revoked.
