import { NextResponse } from "next/server";
import { getRun, eventsSince, getArtifacts, pendingApproval } from "../../../../lib/server/store";
import { toRun, toPendingApproval } from "../../../../lib/server/map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getRun(id);
  if (!row) return NextResponse.json({ error: "run not found" }, { status: 404 });
  return NextResponse.json({
    run: toRun(row, eventsSince(id, 0), getArtifacts(id)),
    pendingApproval: toPendingApproval(pendingApproval(id)),
  });
}
