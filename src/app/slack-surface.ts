import { parseTask } from "./task-intake";
import type { Store, RunRow, EventRow } from "./store";

/**
 * The Slack surface, expressed as pure logic over the shared Store. The Bolt bot
 * is a thin adapter around these functions, so Slack is a genuine interface to
 * the SAME engine and run ledger as the web — not a parallel implementation. A
 * task started here is one durable run, visible and controllable in the web
 * workbench; a decision here drives the same worker. No Slack credentials touch
 * the worker, and no orchestration lives in the Slack handler.
 */

export interface SlackContext {
  text: string;
  user: string; // Slack user id
  channel: string;
  threadTs: string; // one thread per run
}

export interface IntakeResult {
  runId?: string;
  reply: string;
  needsClarification: boolean;
}

function webRunUrl(runId: string): string {
  const base = (process.env.FORGE_WEB_URL || "").replace(/\/$/, "");
  return base ? `${base}/work/${runId}` : `/work/${runId}`;
}

/** Turn a Slack message into a durable shared run (or ask one clarifying question). */
export function handleSlackTask(
  store: Store,
  ctx: SlackContext,
  opts: { workspaceId: string; provider: string; githubMode: string },
): IntakeResult {
  const task = parseTask(ctx.text);
  if (task.ambiguous || !task.repoFull) {
    return {
      reply: task.clarification ?? "Which repository should I work in? Give it as `owner/name` or a GitHub URL.",
      needsClarification: true,
    };
  }
  const run = store.createGithubRun({
    workspaceId: opts.workspaceId,
    repo: task.repoFull,
    issueNumber: task.issueNumber,
    goal: task.outcome,
    provider: opts.provider,
    githubMode: opts.githubMode,
    openPr: task.openPr,
    baseBranch: task.baseBranch,
    origin: "slack",
    slackChannel: ctx.channel,
    slackThreadTs: ctx.threadTs,
    slackUser: ctx.user,
  });
  const what = task.issueNumber ? `issue #${task.issueNumber} in \`${task.repoFull}\`` : `\`${task.repoFull}\``;
  const plan = task.openPr
    ? "I'll inspect the code, implement the smallest correct fix, run the repo's checks, and stop for your approval before opening a draft PR."
    : "I'll inspect the code and prepare a verified diff — I won't push anything.";
  return { runId: run.id, reply: `On it — ${what}. ${plan}\nFollow the live run: ${webRunUrl(run.id)}`, needsClarification: false };
}

/** Only the person who started the run (or a configured allowlist) may decide. */
export function isApprover(run: RunRow, user: string): boolean {
  const allow = (process.env.FORGE_SLACK_APPROVERS || "").split(/[,\s]+/).filter(Boolean);
  if (allow.includes(user)) return true;
  return run.slack_user === user;
}

/** Record a Slack approval/rejection on the shared run (authorization enforced). */
export function handleSlackDecision(
  store: Store,
  threadTs: string,
  user: string,
  decision: "approve" | "reject",
): { ok: boolean; message: string } {
  const run = store.findRunByThread(threadTs);
  if (!run) return { ok: false, message: "I couldn't find a run for this thread." };
  if (!isApprover(run, user)) return { ok: false, message: "Only the person who started this task can approve it." };
  if (!store.getPendingApproval(run.id, "ship")) {
    return { ok: false, message: "There's nothing waiting for approval on this run right now." };
  }
  store.decideApproval(run.id, "ship", decision, `slack:${user}`);
  return { ok: true, message: decision === "approve" ? "Approved — opening the draft PR." : "Rejected — held back." };
}

export interface SlackUpdate {
  text: string;
  wantsApprovalButtons: boolean;
  seq: number; // new event cursor
  state: string; // new state cursor
}

/**
 * The next milestone to post for a run, or null if nothing new is worth saying.
 * Keyed on state change (not every event) so the channel is not flooded; detail
 * lives in the web workbench.
 */
export function nextSlackUpdate(run: RunRow, events: EventRow[]): SlackUpdate | null {
  if (run.state === run.slack_notified_state) return null;
  const latestSeq = events.length ? events[events.length - 1].seq : run.slack_notified_seq;
  let text: string | null = null;
  let buttons = false;
  switch (run.state) {
    case "running":
      text = "Working on it — cloning and inspecting the repo, then running the checks.";
      break;
    case "waiting_approval":
      text = `The fix is ready for review. ${run.final_passed ?? 0}/${run.final_total ?? 0} checks passing, confidence ${run.confidence_score?.toFixed(2) ?? "n/a"} (${run.confidence_level ?? "n/a"}). Approve opening a draft PR?`;
      buttons = true;
      break;
    case "completed":
      text = run.pr_url ? `Done — opened a draft pull request: ${run.pr_url}` : "Done — prepared a verified diff (no PR was requested).";
      break;
    case "declined":
      text = `I declined this one: ${run.reason}`;
      break;
    case "failed":
      text = `This failed: ${run.reason}. Nothing was pushed.`;
      break;
    case "cancelled":
      text = "Cancelled. Nothing was pushed.";
      break;
    default:
      text = null;
  }
  if (!text) return null;
  return { text, wantsApprovalButtons: buttons, seq: latestSeq, state: run.state };
}
