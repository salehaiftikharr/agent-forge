/**
 * The Slack front door — "message your minions."
 *
 * You DM the bot (or @mention it) in plain English and it can either *browse*
 * the work or *do* it:
 *
 *   "show me the open issues in ENG"            → lists the Linear backlog
 *   "work on the login bug in owner/repo"       → picks that issue and ships a PR
 *   "work on all of them"                       → a minion per issue, in turn
 *
 * It remembers the last list it showed you (per thread), so you can follow up
 * with "do the second one" or "all of them" without repeating yourself. It runs
 * in Socket Mode — no public URL, no deploy — on the laptop where `gh` is
 * already authenticated. Everything underneath is the same minion the CLI runs;
 * Slack is just a friendlier way to hand it a job.
 */
import { App } from "@slack/bolt";
import { generateObject } from "ai";
import { z } from "zod";
import { loadEnv } from "../env";
import { getModel } from "../model";
import { runMinionPR } from "../minion/github";
import { runMinionForLinear } from "../linear/dispatch";
import {
  listLinearIssues,
  type LinearIssueSummary,
} from "../linear/client";
import { resolveSelection } from "../linear/select";

loadEnv();

const DEFAULT_REPO = process.env.MINION_DEFAULT_REPO || "";

const HELP = [
  "👋 I dispatch *minions* — autonomous agents that fix an issue and open a pull request, only if the fix passes the tests with no regressions.",
  "",
  "*Browse the work:*",
  "• `show me the open issues in ENG` — list a Linear team's backlog",
  "• `what's in owner/repo on Linear?` — same, scoped to a repo I'll remember",
  "",
  "*Put a minion on it:*",
  "• `work on the login bug in owner/repo` — pick by description",
  "• `do the second one` / `work on ENG-12` — after I've shown a list",
  "• `work on all of them` — a minion per issue, one after another",
  "• `fix issue 3 in owner/repo` — a plain GitHub issue",
  "• add `on the develop branch` to target a branch",
  DEFAULT_REPO ? `\n_Default repo: ${DEFAULT_REPO}_` : "",
].join("\n");

const commandSchema = z.object({
  intent: z
    .enum(["list", "run", "run_all", "help", "unknown"])
    .describe(
      "list = show the Linear issues; run = put a minion on ONE issue; run_all = a minion on EVERY listed issue; help = explain yourself.",
    ),
  repo: z.string().nullable().describe("GitHub repo as owner/name, or null if not mentioned."),
  team: z
    .string()
    .nullable()
    .describe("A Linear team key like 'ENG' (the letters before the dash in issue ids), or null."),
  query: z
    .string()
    .nullable()
    .describe("A topic to filter Linear issues by when listing, e.g. 'dashboard'. Null if none."),
  selection: z
    .string()
    .nullable()
    .describe(
      "When running, WHICH issue: an identifier ('ENG-12'), a position ('the second one', '2'), a description ('the login bug'), or 'all'. Null if not running or not specified.",
    ),
  issueNumber: z.number().nullable().describe("A GitHub issue NUMBER to fix, or null."),
  linearId: z
    .string()
    .nullable()
    .describe("An explicit Linear identifier like 'ENG-123' the user named directly, or null."),
  branch: z
    .string()
    .nullable()
    .describe("The base branch to work from and target the PR at (e.g. 'develop'), or null."),
});

type Command = z.infer<typeof commandSchema>;

async function parseCommand(text: string): Promise<Command> {
  const { object } = await generateObject({
    model: getModel(),
    schema: commandSchema,
    system:
      "You parse a message to an autonomous coding-agent bot that works from Linear and GitHub issues. " +
      "Decide whether the user wants to LIST issues, RUN a minion on one issue, RUN_ALL on every listed issue, or get HELP. " +
      "Extract the repo (owner/name), a Linear team key (the letters in ids like ENG-12), a topic to filter by, " +
      "and — when running — how they referred to the issue (identifier, position, or description) as `selection`. " +
      "If they just greet you or ask what you do, intent is 'help'.",
    prompt: text,
  });
  return object;
}

/** What the bot last showed this thread, so follow-ups resolve. */
interface ThreadMemory {
  repo: string;
  issues: LinearIssueSummary[];
}
const memory = new Map<string, ThreadMemory>();

const PRIORITY_EMOJI = ["⚪", "🔴", "🟠", "🟡", "🟢"];

function formatIssueList(issues: LinearIssueSummary[]): string {
  return issues
    .map((i, idx) => {
      const emoji = PRIORITY_EMOJI[i.priority] ?? "⚪";
      return `*${idx + 1}.* \`${i.identifier}\` ${emoji} ${i.title}  _(${i.state})_`;
    })
    .join("\n");
}

/** Strip Slack's <@U…> mention tokens and trim. */
function clean(text: string): string {
  return (text || "").replace(/<@[^>]+>/g, "").trim();
}

type Say = (message: string) => Promise<unknown>;

/**
 * Get the issues a selection should resolve against. If the user named a team
 * or topic, fetch fresh; otherwise fall back to whatever we last showed this
 * thread. Either way, remember the result for the next follow-up.
 */
async function candidateIssues(
  threadKey: string,
  repo: string,
  command: Command,
): Promise<LinearIssueSummary[]> {
  const remembered = memory.get(threadKey);
  if (!command.team && !command.query && remembered) return remembered.issues;

  const issues = await listLinearIssues({
    teamKey: command.team ?? undefined,
    query: command.query ?? undefined,
  });
  memory.set(threadKey, { repo: repo || remembered?.repo || "", issues });
  return issues;
}

async function dispatchOne(
  repo: string,
  identifier: string,
  branch: string | null,
  say: Say,
): Promise<"shipped" | "declined" | "error"> {
  const receipt = await runMinionForLinear(repo, identifier, {
    baseBranch: branch ?? undefined,
    onProgress: (m) => void say(`   • ${m}`),
  });
  if (receipt.status === "shipped" && receipt.prUrl) {
    await say(`✅ \`${identifier}\` → ${receipt.prUrl}\n> ${receipt.reason}`);
    return "shipped";
  }
  if (receipt.status === "declined") {
    await say(`⊘ \`${identifier}\` — declined, no PR opened.\n> ${receipt.reason}`);
    return "declined";
  }
  await say(`✗ \`${identifier}\` — ${receipt.reason}`);
  return "error";
}

async function runAll(
  repo: string,
  issues: LinearIssueSummary[],
  branch: string | null,
  say: Say,
): Promise<void> {
  await say(
    `🫡 Taking on all *${issues.length}* issues in \`${repo}\`, one at a time. I'll report each as it lands.`,
  );
  const tally = { shipped: 0, declined: 0, error: 0 };
  for (const issue of issues) {
    await say(`\n▶︎ \`${issue.identifier}\`: ${issue.title}`);
    try {
      const result = await dispatchOne(repo, issue.identifier, branch, say);
      tally[result] += 1;
    } catch (error) {
      tally.error += 1;
      await say(`✗ \`${issue.identifier}\` failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  await say(
    `\n🏁 Done with ${issues.length}: *${tally.shipped} shipped*, ${tally.declined} declined, ${tally.error} errored.`,
  );
}

async function handle(rawText: string, say: Say, threadKey: string): Promise<void> {
  const text = clean(rawText);
  if (!text || /^(help|hi|hey|hello|what can you do)\b/i.test(text)) {
    await say(HELP);
    return;
  }

  let command: Command;
  try {
    command = await parseCommand(text);
  } catch {
    await say("Sorry, I couldn't parse that. Try `show me the issues in ENG` or `fix issue 3 in owner/repo`.");
    return;
  }

  if (command.intent === "help" || command.intent === "unknown") {
    await say(HELP);
    return;
  }

  const repo = command.repo || memory.get(threadKey)?.repo || DEFAULT_REPO;

  // LIST — browse the Linear backlog.
  if (command.intent === "list") {
    let issues: LinearIssueSummary[];
    try {
      issues = await listLinearIssues({
        teamKey: command.team ?? undefined,
        query: command.query ?? undefined,
      });
    } catch (error) {
      await say(`✗ Couldn't reach Linear: ${error instanceof Error ? error.message : error}`);
      return;
    }
    if (issues.length === 0) {
      await say("No open issues match that. Try another team key or topic.");
      return;
    }
    memory.set(threadKey, { repo, issues });
    const scope = command.team ? ` in *${command.team.toUpperCase()}*` : "";
    await say(
      `Here's the open work${scope} (${issues.length}):\n\n${formatIssueList(issues)}\n\n` +
        "Say `work on <number>`, `work on <ID>`, or `work on all of them`" +
        (repo ? `, and I'll ship PRs to \`${repo}\`.` : ". Tell me the repo too (`owner/name`)."),
    );
    return;
  }

  // A plain GitHub issue number short-circuits the Linear flow.
  if (command.intent === "run" && command.issueNumber != null && !command.selection) {
    if (!repo) {
      await say("Which repo holds the code? Give it as `owner/name`.");
      return;
    }
    await say(`🫡 On it — issue #${command.issueNumber} → \`${repo}\`.`);
    try {
      const receipt = await runMinionPR(repo, command.issueNumber, {
        baseBranch: command.branch ?? undefined,
        onProgress: (m) => void say(`• ${m}`),
      });
      if (receipt.status === "shipped" && receipt.prUrl) {
        await say(`✅ Opened a pull request: ${receipt.prUrl}\n> ${receipt.reason}`);
      } else if (receipt.status === "declined") {
        await say(`⊘ I declined this one — no PR opened.\n> ${receipt.reason}`);
      } else {
        await say(`✗ Something went wrong: ${receipt.reason}`);
      }
    } catch (error) {
      await say(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  if (!repo) {
    await say("Which repo should I open the PR in? Give it as `owner/name`.");
    return;
  }

  // An explicitly named Linear id runs directly.
  if (command.linearId && command.intent !== "run_all") {
    await say(`🫡 On it — \`${command.linearId}\` → \`${repo}\`.`);
    try {
      await dispatchOne(repo, command.linearId, command.branch, say);
    } catch (error) {
      await say(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  // Otherwise resolve against the listed issues.
  let issues: LinearIssueSummary[];
  try {
    issues = await candidateIssues(threadKey, repo, command);
  } catch (error) {
    await say(`✗ Couldn't reach Linear: ${error instanceof Error ? error.message : error}`);
    return;
  }
  if (issues.length === 0) {
    await say("I don't have any issues to act on. Ask me to list them first, e.g. `show me the issues in ENG`.");
    return;
  }

  if (command.intent === "run_all" || /\ball\b/i.test(command.selection ?? "")) {
    await runAll(repo, issues, command.branch, say);
    return;
  }

  const selection = resolveSelection(issues, command.selection ?? text);
  if (selection.kind === "none") {
    await say(
      `I'm not sure which one you mean (${selection.reason}). Here's the list again:\n\n${formatIssueList(issues)}`,
    );
    return;
  }
  if (selection.kind === "all") {
    await runAll(repo, selection.issues, command.branch, say);
    return;
  }

  await say(`🫡 On it — \`${selection.issue.identifier}\` (${selection.issue.title}) → \`${repo}\`.`);
  try {
    await dispatchOne(repo, selection.issue.identifier, command.branch, say);
  } catch (error) {
    await say(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  if (!botToken || !appToken) {
    throw new Error(
      "Missing SLACK_BOT_TOKEN and/or SLACK_APP_TOKEN. Add them to .env.local — see the Slack setup steps in the README.",
    );
  }

  const app = new App({ token: botToken, appToken, socketMode: true });

  // @mention in a channel — reply in a thread, keyed to that thread.
  app.event("app_mention", async ({ event, say }) => {
    const thread = event.thread_ts ?? event.ts;
    await handle(
      event.text,
      (m) => say({ text: m, thread_ts: thread }),
      `${event.channel}:${thread}`,
    );
  });

  // Direct messages to the bot.
  app.message(async ({ message, say }) => {
    // Only plain user DMs (ignore edits, joins, and the bot's own messages).
    if (message.subtype || message.channel_type !== "im") return;
    const text = "text" in message ? (message.text ?? "") : "";
    await handle(text, (m) => say(m), `dm:${message.channel}`);
  });

  await app.start();
  console.log("⚡️ Minions Slack bot is online (Socket Mode). DM it or @mention it.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
