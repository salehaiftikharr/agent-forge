import Link from "next/link";
import { Plus, Cpu } from "lucide-react";
import { Button, Card, StatusPill, EngineBadge, SectionLabel } from "@/components/ui";
import { listRuns, providerMode } from "@/lib/server/store";
import { toRun } from "@/lib/server/map";
import { eventsSince, getArtifacts } from "@/lib/server/store";
import { relativeTime } from "@/lib/utils";
import type { RunState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function WorkPage() {
  const runs = listRuns().map((r) => toRun(r, eventsSince(r.id, 0), getArtifacts(r.id)));
  const mode = providerMode();

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 md:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <SectionLabel>Work</SectionLabel>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">Runs</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">
            <EngineBadge />
            <span>
              Live over the engine · provider <span className="font-mono">{mode}</span>
            </span>
          </p>
        </div>
        <Button href="/work/new">
          <Plus size={16} /> New run
        </Button>
      </div>

      {runs.length === 0 ? (
        <Card className="mt-8 flex flex-col items-center gap-3 p-12 text-center">
          <Cpu size={28} className="text-muted" />
          <p className="text-base font-medium text-ink">No runs yet</p>
          <p className="max-w-sm text-sm text-muted">
            Start a run and a minion will fix a ticket on a sandboxed copy of the practice repo,
            proving every gate before anything ships.
          </p>
          <Button href="/work/new" className="mt-1">
            <Plus size={16} /> Start your first run
          </Button>
        </Card>
      ) : (
        <ul className="mt-6 space-y-3">
          {runs.map((run) => (
            <li key={run.id}>
              <Link href={`/work/${run.id}`} className="block">
                <Card className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-surface-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{run.ticket.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {run.ticket.id} · {run.minionName} · {relativeTime(run.startedAt)}
                    </p>
                  </div>
                  <StatusPill status={run.state as RunState} />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
