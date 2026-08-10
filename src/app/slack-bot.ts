import { App } from "@slack/bolt";
import { openDb } from "./db";
import { Store } from "./store";
import { handleSlackTask, handleSlackDecision, nextSlackUpdate } from "./slack-surface";

// The single-owner workspace shared with the web tier, so a Slack-started run
// and a web-started run live in the same workspace.
const DEFAULT_WORKSPACE = "ws-default";

/**
 * The shared-engine Slack bot. It is a thin adapter over slack-surface.ts, which
 * creates and controls the SAME durable runs the web app uses. Detailed logs
 * live in the web workbench; Slack gets concise milestones and working approval
 * buttons. Uses Socket Mode, so no public URL is needed and Slack authenticates
 * the WebSocket (no HTTP signature handling required). This process holds the
 * Slack tokens; the worker holds none.
 *
 * Run: `npm run slack:app` with SLACK_BOT_TOKEN, SLACK_APP_TOKEN, the shared
 * FORGE_DB_PATH, a model provider, and FORGE_GITHUB=real (+ gh auth) for live PRs.
 */

function provider(): string {
  return (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
}
function githubMode(): string {
  return (process.env.FORGE_GITHUB || "fake").toLowerCase();
}

function approvalBlocks(text: string, threadTs: string) {
  return [
    { type: "section", text: { type: "mrkdwn", text } },
    {
      type: "actions",
      elements: [
        { type: "button", style: "primary", text: { type: "plain_text", text: "Approve & open draft PR" }, action_id: "af_approve", value: threadTs },
        { type: "button", text: { type: "plain_text", text: "Reject" }, action_id: "af_reject", value: threadTs },
      ],
    },
  ];
}

export async function startSlackBot(): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  if (!botToken || !appToken) {
    throw new Error("SLACK_BOT_TOKEN and SLACK_APP_TOKEN are required to run the Slack bot.");
  }

  const db = openDb();
  const store = new Store(db);
  store.ensureWorkspace(DEFAULT_WORKSPACE, { providerMode: githubMode() === "real" ? provider() : "fake" });
  const app = new App({ token: botToken, appToken, socketMode: true });

  // A message (DM or mention) starts or continues a task in its own thread.
  // Bolt's middleware types are intentionally loose; the real logic lives in the
  // tested slack-surface module, so we accept `any` at this thin adapter edge.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.message(async (args: any) => {
    const { message, say } = args;
    const m = message as { text?: string; user?: string; channel?: string; ts?: string; thread_ts?: string; subtype?: string };
    if (m.subtype || !m.text || !m.user) return; // ignore edits/bot messages
    const threadTs = m.thread_ts || m.ts!;
    const res = handleSlackTask(
      store,
      { text: m.text, user: m.user, channel: m.channel ?? "", threadTs },
      { workspaceId: DEFAULT_WORKSPACE, provider: provider(), githubMode: githubMode() },
    );
    await say({ text: res.reply, thread_ts: threadTs });
  });

  const decide = async (actionValue: string, userId: string, decision: "approve" | "reject") => {
    return handleSlackDecision(store, actionValue, userId, decision);
  };

  const onAction = (decision: "approve" | "reject") =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: any) => {
      await args.ack();
      const r = await decide(args.body.actions[0].value, args.body.user.id, decision);
      await args.respond({ text: r.message, replace_original: false });
    };
  app.action("af_approve", onAction("approve"));
  app.action("af_reject", onAction("reject"));

  // Milestone poller: post state changes to each run's thread, exactly once.
  const poll = async () => {
    for (const run of store.runsWithSlackThread()) {
      const update = nextSlackUpdate(run, store.eventsSince(run.id, run.slack_notified_seq));
      if (!update || !run.slack_channel || !run.slack_thread_ts) continue;
      try {
        await app.client.chat.postMessage({
          channel: run.slack_channel,
          thread_ts: run.slack_thread_ts,
          text: update.text,
          ...(update.wantsApprovalButtons ? { blocks: approvalBlocks(update.text, run.slack_thread_ts) } : {}),
        });
        store.markSlackNotified(run.id, update.seq, update.state);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[slack] post failed", err);
      }
    }
  };
  const timer = setInterval(() => void poll(), Number(process.env.FORGE_SLACK_POLL_MS) || 2000);

  await app.start();
  // eslint-disable-next-line no-console
  console.log(`[slack] shared-engine bot started (provider=${provider()}, github=${githubMode()})`);

  const shutdown = async () => {
    clearInterval(timer);
    await app.stop();
    db.close();
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startSlackBot().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
