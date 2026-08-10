-- Shared identity across surfaces: a run remembers where it came from (web,
-- slack, cli) and, when from Slack, its channel/thread and the user who started
-- it — so the SAME run is visible in the web workbench and its Slack thread, and
-- a decision on either surface drives the one engine. The notify cursors let the
-- Slack surface post milestones without duplicating them.

ALTER TABLE runs ADD COLUMN origin TEXT NOT NULL DEFAULT 'web';   -- web | slack | cli
ALTER TABLE runs ADD COLUMN slack_channel TEXT;
ALTER TABLE runs ADD COLUMN slack_thread_ts TEXT;
ALTER TABLE runs ADD COLUMN slack_user TEXT;
ALTER TABLE runs ADD COLUMN slack_notified_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN slack_notified_state TEXT;

CREATE INDEX idx_runs_slack ON runs(slack_thread_ts);
