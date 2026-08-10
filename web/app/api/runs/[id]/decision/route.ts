import { NextRequest, NextResponse } from "next/server";
import { getRun, decideApproval, pendingApproval } from "../../../../../lib/server/store";
import { decisionSchema } from "../../../../../lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  // Only a genuinely pending gate can be decided. A decision on a run that is
  // not waiting is a no-op, reported honestly rather than silently accepted.
  const pending = pendingApproval(id);
  const result = decideApproval(id, parsed.data.decision);
  return NextResponse.json({
    ok: true,
    changed: result.changed,
    status: result.status,
    wasPending: Boolean(pending),
  });
}
