import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DemoBadge, StatusPill } from "@/components/ui";
import { RUNS } from "@/lib/fixtures";
import { relativeTime } from "@/lib/utils";
import type { RunState } from "@/lib/types";
import { RUN_STATE_LABEL } from "@/lib/types";

export const metadata: Metadata = { title: "Runs" };

const ORDER: RunState[] = ["waiting_approval", "running", "retrying", "failed", "completed", "declined", "cancelled"];

export default function RunsPage() {
  const groups = ORDER.map((state) => ({ state, items: RUNS.filter((r) => r.state === state) })).filter((g) => g.items.length);

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Runs</h1>
          <p className="mt-1 text-muted">Durable executions. Open one to see its timeline, approvals, and artifacts.</p>
        </div>
        <DemoBadge />
      </div>

      <div className="mt-8 space-y-8">
        {groups.map((g) => (
          <section key={g.state}>
            <h2 className="mb-3 text-sm font-semibold text-muted">{RUN_STATE_LABEL[g.state]} <span className="font-normal text-muted/70">({g.items.length})</span></h2>
            <div className="space-y-2">
              {g.items.map((r) => (
                <Link key={r.id} href={`/runs/${r.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 hover:bg-surface-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted">{r.ticket.id}</span>
                      <StatusPill status={r.state} />
                      <span className="text-xs text-muted">{r.minionName}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-ink">{r.ticket.title}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-muted">
                    <span>{relativeTime(r.startedAt)}</span>
                    <ArrowUpRight size={16} />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
