import type { Metadata } from "next";
import Link from "next/link";
import { RUNS } from "@/lib/fixtures";
import { StatusPill, DemoBadge } from "@/components/ui";
import { relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  const events = RUNS.flatMap((r) => r.timeline.map((e) => ({ ...e, run: r }))).sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  );
  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Activity</h1>
          <p className="mt-1 text-muted">Every recent event across your Minions and runs.</p>
        </div>
        <DemoBadge />
      </div>
      <ul className="mt-8 space-y-2">
        {events.slice(0, 40).map((e) => (
          <li key={e.run.id + e.id}>
            <Link href={`/runs/${e.run.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 hover:bg-surface-2">
              <div className="min-w-0">
                <span className="text-sm text-ink">{e.label}</span>
                <span className="ml-2 text-xs text-muted">{e.run.minionName} · {e.run.ticket.id}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <StatusPill status={e.run.state} />
                <span className="text-xs text-muted">{relativeTime(e.at)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
