"use client";

import { useMemo, useState } from "react";
import { Search, Bot } from "lucide-react";
import { MinionCard } from "./minion-card";
import type { Minion, MinionStatus } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/types";
import { cn } from "@/lib/utils";

type SortKey = "recent" | "name" | "runs";
const STATUS_ORDER: MinionStatus[] = ["waiting", "working", "ready", "paused", "failed", "declined", "archived"];

export function MinionRoster({ minions }: { minions: Minion[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<MinionStatus | "all">("all");
  const [sort, setSort] = useState<SortKey>("recent");

  const filtered = useMemo(() => {
    let list = minions.filter((m) => {
      const matchesQ =
        !q ||
        [m.name, m.role, m.purpose].join(" ").toLowerCase().includes(q.toLowerCase());
      const matchesStatus = status === "all" || m.status === status;
      return matchesQ && matchesStatus;
    });
    list = [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "runs") return b.runsCount - a.runsCount;
      return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime();
    });
    return list;
  }, [minions, q, status, sort]);

  const grouped = useMemo(() => {
    const map = new Map<MinionStatus, Minion[]>();
    for (const s of STATUS_ORDER) map.set(s, []);
    for (const m of filtered) map.get(m.status)?.push(m);
    return STATUS_ORDER.map((s) => ({ status: s, items: map.get(s) ?? [] })).filter((g) => g.items.length > 0);
  }, [filtered]);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Minions by name, role, or purpose"
            aria-label="Search Minions"
            className="h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted focus-visible:border-accent"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as MinionStatus | "all")}
          aria-label="Filter by status"
          className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:border-accent"
        >
          <option value="all">All statuses</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort"
          className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:border-accent"
        >
          <option value="recent">Recently active</option>
          <option value="name">Name</option>
          <option value="runs">Most runs</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-10 flex flex-col items-center justify-center rounded-xl border border-dashed border-line py-16 text-center">
          <Bot size={28} className="text-muted" />
          <p className="mt-3 font-medium text-ink">No Minions match</p>
          <p className="mt-1 text-sm text-muted">Try a different search or clear the filters.</p>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {grouped.map((g) => (
            <section key={g.status}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted">
                <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: `var(--forge-${g.status === "ready" ? "shipped" : g.status === "working" ? "running" : g.status === "waiting" ? "waiting" : g.status === "failed" ? "failed" : g.status === "declined" ? "declined" : "idle"})` }} />
                {STATUS_LABEL[g.status]}
                <span className="font-normal text-muted/70">({g.items.length})</span>
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((m) => (
                  <MinionCard key={m.id} minion={m} href={`/minions/${m.id}`} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
