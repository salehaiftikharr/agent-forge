/**
 * A tiny Linear API client — enough for minions to read an issue and report
 * back. Linear is just another *source* of work; once we have the issue's
 * title and description, the minion is identical to the GitHub path.
 *
 * Auth is a personal API key passed verbatim in the Authorization header (no
 * "Bearer" prefix), per Linear's docs.
 */
const ENDPOINT = "https://api.linear.app/graphql";

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const key = process.env.LINEAR_API_KEY;
  if (!key) {
    throw new Error(
      "Missing LINEAR_API_KEY. Add it to .env.local (Linear → Settings → API → Personal API keys).",
    );
  }
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: key },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) {
    throw new Error(`Linear API error: ${JSON.stringify(json.errors)}`);
  }
  if (!json.data) throw new Error("Linear API returned no data.");
  return json.data;
}

export interface LinearIssue {
  /** The UUID — needed to comment back. */
  id: string;
  /** The human identifier, e.g. ENG-123. */
  identifier: string;
  title: string;
  description: string;
  url: string;
}

export interface LinearIssueSummary extends LinearIssue {
  /** Workflow state name, e.g. "Todo", "In Progress". */
  state: string;
  /** Linear priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
  priority: number;
}

/** Human label for a Linear priority number. */
export function priorityLabel(priority: number): string {
  return ["None", "Urgent", "High", "Medium", "Low"][priority] ?? "None";
}

/** Sort so the most pressing work floats up: Urgent → High → Medium → Low → None. */
function byPriority(a: LinearIssueSummary, b: LinearIssueSummary): number {
  const rank = (p: number) => (p === 0 ? 99 : p); // "None" sinks to the bottom
  return rank(a.priority) - rank(b.priority);
}

/**
 * List a team's open issues (newest-touched first, then by priority). This is
 * the "look at all the issues" capability: it gives a minion a menu of work to
 * choose from rather than a single named ticket.
 */
export async function listLinearIssues(
  opts: { teamKey?: string; query?: string; limit?: number; includeDone?: boolean } = {},
): Promise<LinearIssueSummary[]> {
  const filter: Record<string, unknown> = {};
  if (!opts.includeDone) {
    // Open work only — drop anything completed or canceled.
    filter.state = { type: { nin: ["completed", "canceled"] } };
  }
  if (opts.teamKey) {
    filter.team = { key: { eq: opts.teamKey.toUpperCase() } };
  }
  if (opts.query) {
    filter.or = [
      { title: { containsIgnoreCase: opts.query } },
      { description: { containsIgnoreCase: opts.query } },
    ];
  }

  const data = await graphql<{
    issues: {
      nodes: Array<
        Omit<LinearIssueSummary, "state" | "description"> & {
          description: string | null;
          state: { name: string };
        }
      >;
    };
  }>(
    `query ($filter: IssueFilter, $first: Int!) {
      issues(filter: $filter, first: $first, orderBy: updatedAt) {
        nodes { id identifier title description url priority state { name } }
      }
    }`,
    { filter, first: Math.min(opts.limit ?? 25, 50) },
  );

  return data.issues.nodes
    .map((n) => ({
      id: n.id,
      identifier: n.identifier,
      title: n.title,
      description: n.description ?? "",
      url: n.url,
      priority: n.priority,
      state: n.state.name,
    }))
    .sort(byPriority);
}

/** Fetch an issue by its human identifier (e.g. "ENG-123"). */
export async function fetchLinearIssue(identifier: string): Promise<LinearIssue> {
  const data = await graphql<{ issue: LinearIssue | null }>(
    `query ($id: String!) {
      issue(id: $id) { id identifier title description url }
    }`,
    { id: identifier },
  );
  if (!data.issue) throw new Error(`No Linear issue "${identifier}".`);
  return data.issue;
}

/** Post a comment back on a Linear issue (used to drop the PR link). */
export async function addLinearComment(issueId: string, body: string): Promise<void> {
  await graphql<{ commentCreate: { success: boolean } }>(
    `mutation ($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) { success }
    }`,
    { issueId, body },
  );
}
