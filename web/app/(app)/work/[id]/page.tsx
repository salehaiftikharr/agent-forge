import { notFound } from "next/navigation";
import { getRun, eventsSince, getArtifacts } from "@/lib/server/store";
import { toRun } from "@/lib/server/map";
import { RunView } from "@/components/work/run-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getRun(id);
  if (!row) notFound();
  const run = toRun(row, eventsSince(id, 0), getArtifacts(id));
  return <RunView initialRun={run} />;
}
