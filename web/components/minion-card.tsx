import Link from "next/link";
import { MinionMark } from "./marks";
import { StatusPill } from "./ui";
import { cn, relativeTime } from "@/lib/utils";
import type { Minion } from "@/lib/types";
import { Wrench, ShieldCheck, Clock, ArrowUpRight } from "lucide-react";

function permissionSummary(m: Minion) {
  const w = m.tools.filter((t) => t.permission === "write").length;
  const p = m.tools.filter((t) => t.permission === "propose").length;
  if (w === 0 && p === 0) return "Read-only";
  if (w > 0) return `Can write · gated`;
  return "Proposes for approval";
}

export function MinionCard({ minion, href, className }: { minion: Minion; href?: string; className?: string }) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-ink">
            <MinionMark size={38} status={minion.status} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold leading-tight text-ink">{minion.name}</h3>
              {minion.needsAttention && (
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--forge-waiting)" }} aria-label="Needs attention" />
              )}
            </div>
            <p className="text-sm text-muted">{minion.role}</p>
          </div>
        </div>
        <StatusPill status={minion.status} />
      </div>

      <p className="mt-3 line-clamp-2 text-sm text-muted">{minion.purpose}</p>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Wrench size={13} /> {minion.tools.length} tools
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck size={13} /> {permissionSummary(minion)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock size={13} /> {relativeTime(minion.lastActiveAt)}
        </span>
      </div>
    </>
  );

  const base = "block rounded-xl border border-line bg-surface p-5 transition-colors";
  if (href) {
    return (
      <Link href={href} className={cn(base, "group hover:border-accent/50 hover:bg-surface-2", className)}>
        {inner}
        <div className="mt-4 flex items-center gap-1 text-sm font-medium text-accent-text opacity-0 transition-opacity group-hover:opacity-100">
          Open <ArrowUpRight size={14} />
        </div>
      </Link>
    );
  }
  return <div className={cn(base, className)}>{inner}</div>;
}
