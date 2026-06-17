import { openPullRequest } from "../minion/github";
import { openSpecPR, type SpecReceipt } from "../minion/spec";
import { fetchLinearIssue, addLinearComment } from "./client";
import type { MinionReceipt } from "../minion/minion";

/**
 * Linear-issue source: read the issue from Linear, run the same minion + open a
 * GitHub PR, then comment the PR link back on the Linear issue so the board
 * stays in sync. The minion itself is unchanged — Linear just feeds it the work
 * and gets the result.
 */
export async function runMinionForLinear(
  repo: string,
  identifier: string,
  opts: { provider?: string; baseBranch?: string; onProgress?: (m: string) => void } = {},
): Promise<MinionReceipt> {
  const log = opts.onProgress ?? (() => {});
  const issue = await fetchLinearIssue(identifier);
  log(`Linear ${issue.identifier}: ${issue.title}`);

  const receipt = await openPullRequest(
    repo,
    { id: issue.identifier, title: issue.title, body: issue.description || issue.title },
    { ...opts, reference: `Resolves ${issue.identifier}.` },
  );

  if (receipt.status === "shipped" && receipt.prUrl) {
    try {
      await addLinearComment(
        issue.id,
        `Opened a pull request for this: ${receipt.prUrl}`,
      );
      log("commented the PR link back on Linear.");
    } catch (error) {
      log(`(couldn't comment back on Linear: ${error instanceof Error ? error.message : error})`);
    }
  }
  return receipt;
}

/**
 * Linear-issue source for the spec-author: write only a failing reproduction
 * test for the issue and open it for review, then comment the link back on
 * Linear. No fix — separation of powers (a different minion fixes later).
 */
export async function runSpecForLinear(
  repo: string,
  identifier: string,
  opts: { provider?: string; onProgress?: (m: string) => void } = {},
): Promise<SpecReceipt> {
  const log = opts.onProgress ?? (() => {});
  const issue = await fetchLinearIssue(identifier);
  log(`Linear ${issue.identifier}: ${issue.title}`);

  const receipt = await openSpecPR(
    repo,
    { id: issue.identifier, title: issue.title, body: issue.description || issue.title },
    { ...opts, reference: `Reproduces ${issue.identifier}.` },
  );

  if (receipt.status === "authored" && receipt.prUrl) {
    try {
      await addLinearComment(
        issue.id,
        `Opened a failing reproduction test for review: ${receipt.prUrl}`,
      );
      log("commented the test PR link back on Linear.");
    } catch (error) {
      log(`(couldn't comment back on Linear: ${error instanceof Error ? error.message : error})`);
    }
  }
  return receipt;
}
