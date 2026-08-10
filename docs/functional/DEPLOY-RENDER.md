# Deploying the functional Agent Forge to Render

This puts the **real** workbench on a public URL: sign in with a passphrase,
delegate a GitHub ticket from the web (or Slack), and get a real draft PR.

## Why one Render service (not Vercel)

The functional app needs three things running together and sharing state: the
web UI, a durable **worker** (clones repos, runs the model + tests for a minute,
pushes branches), and a **database**. Vercel only runs the web face. Render runs
all three in **one container** with a **persistent disk** holding the SQLite
database and the run checkouts. That is what `Dockerfile.render`, `start.sh`, and
`render.yaml` set up. Verified: the image builds and the full flow (task →
worker → approval → PR) runs inside the container.

## What you need (accounts / secrets)

1. **A GitHub token** (fine-grained PAT) — so the server can read issues and open
   PRs without your laptop's `gh` login.
2. **Your Anthropic key** — already in your `.env.local`; you'll paste it into
   Render (never committed).
3. **A passphrase** — you choose it; it gates `/work`.
4. **Render** — you already have the $7 Starter plan (it includes a disk).
5. (Optional) your **Slack** bot + app tokens for the shared-engine Slack bot.

## Step 1 — Create the GitHub token (2 min)

GitHub → **Settings → Developer settings → Fine-grained tokens → Generate new
token**:
- **Repository access:** Only select repositories → pick the repo(s) Agent Forge
  may work on (start with `forge-minion-practice`).
- **Permissions:**
  - Contents: **Read and write** (clone + push a branch)
  - Pull requests: **Read and write** (open the draft PR)
  - Issues: **Read**
  - Metadata: **Read** (auto-selected)
- Generate and copy the token (starts `github_pat_...`). This is `GH_TOKEN`.

## Step 2 — Deploy the Blueprint on Render (5 min)

1. Render dashboard → **New → Blueprint**.
2. Connect this GitHub repo and select the branch **`agent-forge-functional-app`**
   (Render reads `render.yaml` from it). It proposes one service, **agent-forge**,
   with a 1 GB disk at `/data`.
3. Before the first deploy, set these environment variables (the Blueprint marks
   them `sync: false`, so Render prompts you):
   - `FORGE_PASSPHRASE` = the passphrase you want to type to enter `/work`
   - `ANTHROPIC_API_KEY` = your key (from `.env.local`)
   - `GH_TOKEN` = the fine-grained token from Step 1
   - Leave `FORGE_WEB_URL` blank for now (set it in Step 4)
   - (Optional Slack) `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `FORGE_SLACK_APPROVERS`
4. **Apply / Create**. The first build takes ~5 minutes (it compiles the image).

## Step 3 — Verify it's live and doing real work

1. Open the service URL Render gives you (e.g. `https://agent-forge-xxxx.onrender.com`).
2. You'll hit the **passphrase** screen — enter `FORGE_PASSPHRASE`.
3. `/work` → **New GitHub task** → repo `salehaiftikharr/forge-minion-practice`,
   issue `1`, goal "Fix issue #1", **Start task**.
4. Watch it clone, fix, test, and stop at the approval gate → **Approve** →
   a real draft PR opens; the panel shows the verified PR URL.
5. Confirm on GitHub that the PR exists (it will, because the server verifies it
   through the GitHub API before marking the run complete).

## Step 4 — Set the public URL (for Slack links)

Copy the Render URL into the `FORGE_WEB_URL` env var (e.g.
`https://agent-forge-xxxx.onrender.com`) and redeploy. Now Slack run links point
at the live app.

## Step 5 (optional) — Slack from the deployed app

With `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` set, the Slack bot runs inside the same
container. In Slack, `@Agent Forge fix issue #1 in salehaiftikharr/forge-minion-practice`
→ it works the task, posts Approve/Reject, and returns the PR — the same run
appears in the web app. (For the buttons, enable **Interactivity** in the Slack
app; otherwise approve in the web app — same run.)

## Operating notes / limits

- **Single instance only.** Do not scale the service beyond 1 (one worker per
  SQLite database). Multi-instance needs the Postgres migration (future work).
- The **disk** at `/data` persists the database and checkouts across deploys and
  restarts; a redeploy recovers in-flight runs.
- `GH_TOKEN` can only touch the repos you granted; the server re-checks write
  access before every push and never force-pushes or targets a default branch.
- Secrets live only in Render's env (server-side). Nothing is exposed to the
  browser, and `.env.local` is never committed.
- Free/Starter Render services may sleep when idle; the first request wakes them.

## Rollback

Render keeps previous deploys — **Manual Deploy → Roll back** to the prior image.
The disk (database) is untouched by a code rollback. There are no destructive
migrations.
