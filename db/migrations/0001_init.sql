-- Agent Forge functional application — initial schema.
-- SQLite is the single source of truth shared by the web tier (client) and the
-- durable worker (engine). Every row carries workspace_id for ownership; a
-- single-owner deployment uses one fixed owner id, and real auth is additive.

CREATE TABLE workspaces (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  provider_mode TEXT NOT NULL DEFAULT 'fake',   -- fake | anthropic | openai
  created_at    TEXT NOT NULL
);

CREATE TABLE runs (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id),
  owner_id         TEXT NOT NULL,
  ticket_id        TEXT NOT NULL,
  goal             TEXT NOT NULL,
  context          TEXT,
  state            TEXT NOT NULL,                -- RunState (web/lib/types.ts)
  provider         TEXT NOT NULL,               -- fake | anthropic | openai
  model            TEXT,
  minion_name      TEXT NOT NULL,
  reason           TEXT,
  confidence_score REAL,
  confidence_level TEXT,
  risk_level       TEXT,
  cost_usd         REAL,
  duration_ms      INTEGER,
  steps            INTEGER NOT NULL DEFAULT 0,
  tool_calls       INTEGER NOT NULL DEFAULT 0,
  baseline_passed  INTEGER,
  baseline_total   INTEGER,
  final_passed     INTEGER,
  final_total      INTEGER,
  requires_review  INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,   -- cooperative cancel flag
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_runs_ws ON runs(workspace_id, created_at);
CREATE INDEX idx_runs_state ON runs(state);

-- Append-only event ledger. seq is monotonic per run and is the ordering the UI
-- renders from — transient UI state never determines history.
CREATE TABLE run_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT NOT NULL REFERENCES runs(id),
  seq     INTEGER NOT NULL,
  at      TEXT NOT NULL,
  kind    TEXT NOT NULL,                          -- TimelineKind
  label   TEXT NOT NULL,
  detail  TEXT,
  phase   TEXT,
  UNIQUE(run_id, seq)
);
CREATE INDEX idx_events_run ON run_events(run_id, seq);

CREATE TABLE approvals (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES runs(id),
  workspace_id TEXT NOT NULL,
  action       TEXT NOT NULL,                      -- 'ship'
  summary      TEXT NOT NULL,
  preview      TEXT,                               -- the exact diff that would ship
  status       TEXT NOT NULL,                      -- pending | approved | rejected | expired | cancelled
  decided_by   TEXT,
  decided_at   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_appr_run ON approvals(run_id);
-- At most one pending approval per (run, action): makes approve/reject and
-- re-presentation idempotent at the database level.
CREATE UNIQUE INDEX uniq_pending_approval ON approvals(run_id, action) WHERE status = 'pending';

CREATE TABLE artifacts (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES runs(id),
  workspace_id TEXT NOT NULL,
  kind         TEXT NOT NULL,                      -- diff | pr | file | note
  title        TEXT NOT NULL,
  body         TEXT,
  content_type TEXT,
  size_bytes   INTEGER,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_art_run ON artifacts(run_id);

-- Durable work queue with leases. A worker claims a job by writing its
-- lease_owner and a future lease_expires_at inside a transaction; an expired
-- lease is reclaimable so a killed worker's job is recovered, never lost or
-- double-run. dedupe_key makes enqueue idempotent.
CREATE TABLE jobs (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES runs(id),
  kind             TEXT NOT NULL,                  -- execute | ship
  status           TEXT NOT NULL,                  -- queued | running | done | failed
  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 3,
  lease_owner      TEXT,
  lease_expires_at TEXT,
  dedupe_key       TEXT UNIQUE,
  last_error       TEXT,
  available_at     TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_jobs_claim ON jobs(status, available_at);
