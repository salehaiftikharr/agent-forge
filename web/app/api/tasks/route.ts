import { NextRequest, NextResponse } from "next/server";
import { createGithubRun, eventsSince, getArtifacts } from "../../../lib/server/store";
import { toRun } from "../../../lib/server/map";
import { createGithubTaskSchema, normalizeRepo } from "../../../lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create a GitHub coding task (repo + optional issue + goal → durable run). */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = createGithubTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const norm = normalizeRepo(parsed.data.repo);
  if (!norm) {
    return NextResponse.json(
      { error: "Could not read the repository. Give it as `owner/name` or a GitHub URL." },
      { status: 400 },
    );
  }
  const run = createGithubRun({
    repo: norm.repo,
    issueNumber: parsed.data.issueNumber ?? norm.issueNumber,
    goal: parsed.data.goal,
    openPr: parsed.data.openPr,
    baseBranch: parsed.data.baseBranch,
  });
  return NextResponse.json(
    { run: toRun(run, eventsSince(run.id, 0), getArtifacts(run.id)) },
    { status: 201 },
  );
}
