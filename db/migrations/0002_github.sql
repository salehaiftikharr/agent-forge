-- GitHub coding runs: a run can now target a real repository/issue and end in a
-- verified pull request. Existing sandbox runs default to kind='sandbox' and are
-- unaffected. All external-write state (branch, sha, PR) is recorded here so the
-- run is durable and independently verifiable.

ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'sandbox';   -- sandbox | github
ALTER TABLE runs ADD COLUMN repo TEXT;                              -- owner/name
ALTER TABLE runs ADD COLUMN issue_number INTEGER;
ALTER TABLE runs ADD COLUMN github_mode TEXT;                       -- fake | real
ALTER TABLE runs ADD COLUMN open_pr INTEGER NOT NULL DEFAULT 1;     -- 0 = prepare only
ALTER TABLE runs ADD COLUMN base_branch TEXT;
ALTER TABLE runs ADD COLUMN head_branch TEXT;
ALTER TABLE runs ADD COLUMN base_sha TEXT;
ALTER TABLE runs ADD COLUMN checkout_dir TEXT;
ALTER TABLE runs ADD COLUMN pr_number INTEGER;
ALTER TABLE runs ADD COLUMN pr_url TEXT;
ALTER TABLE runs ADD COLUMN pr_state TEXT;
ALTER TABLE runs ADD COLUMN pr_draft INTEGER;

CREATE INDEX idx_runs_repo ON runs(repo);
