#!/usr/bin/env bash
# Container entrypoint: one process tree = migrate + worker + (optional) Slack bot
# + web, all sharing the SQLite database on the mounted disk. The web server runs
# in the foreground so the platform's health check tracks it; if it exits, the
# container restarts and recovery brings any in-flight run back.
set -euo pipefail

mkdir -p "${FORGE_RUNS_DIR:-/data/runs}"

# Server-side GitHub auth from a token — no interactive login. Enables the real
# adapter to clone/push and open PRs as the token's owner.
if [ -n "${GH_TOKEN:-}" ]; then
  echo "${GH_TOKEN}" | gh auth login --with-token || echo "[start] gh auth login failed (check the token)"
  gh auth setup-git || true
fi

# Apply migrations (idempotent) before anything reads the database.
npm run migrate

# Durable worker (background).
npm run worker &

# Shared-engine Slack bot (background) only when its tokens are configured.
if [ -n "${SLACK_BOT_TOKEN:-}" ] && [ -n "${SLACK_APP_TOKEN:-}" ]; then
  npm run slack:app &
fi

# Web tier (foreground). Binds the platform port on all interfaces.
cd web
exec npx next start -p "${PORT:-3001}" -H 0.0.0.0
