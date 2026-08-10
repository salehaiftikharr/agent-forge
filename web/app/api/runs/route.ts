import { NextRequest, NextResponse } from "next/server";
import { createRun, listRuns } from "../../../lib/server/store";
import { toRun } from "../../../lib/server/map";
import { eventsSince, getArtifacts } from "../../../lib/server/store";
import { createRunSchema } from "../../../lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const runs = listRuns().map((r) => toRun(r, eventsSince(r.id, 0), getArtifacts(r.id)));
  return NextResponse.json({ runs });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = createRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const run = createRun(parsed.data);
  return NextResponse.json(
    { run: toRun(run, eventsSince(run.id, 0), getArtifacts(run.id)) },
    { status: 201 },
  );
}
