import { NextResponse } from "next/server";
import { getRun, requestCancel } from "../../../../../lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  const updated = requestCancel(id);
  return NextResponse.json({ ok: true, state: updated?.state });
}
