import { cn, duration } from "@/lib/utils";
import type { TimelineEvent, TimelineKind } from "@/lib/types";
import {
  Inbox, ListChecks, Wrench, ShieldQuestion, ShieldCheck, ShieldX,
  Terminal, FlaskConical, AlertTriangle, RotateCw, FileText, BadgeCheck,
} from "lucide-react";

const ICON: Record<TimelineKind, React.ComponentType<{ size?: number }>> = {
  queued: Inbox,
  plan: ListChecks,
  tool: Wrench,
  approval_requested: ShieldQuestion,
  approval_granted: ShieldCheck,
  approval_rejected: ShieldX,
  command: Terminal,
  test: FlaskConical,
  error: AlertTriangle,
  retry: RotateCw,
  artifact: FileText,
  verdict: BadgeCheck,
};

function phaseColor(e: TimelineEvent): string {
  if (e.kind === "error" || e.phase === "failed") return "var(--forge-failed)";
  if (e.phase === "requested" || e.kind === "approval_requested") return "var(--forge-waiting)";
  if (e.phase === "recovered" || e.kind === "retry") return "var(--forge-running)";
  if (e.kind === "verdict") return "var(--forge-shipped)";
  return "var(--forge-muted)";
}

const PHASE_TAG: Record<string, string> = {
  planned: "planned",
  requested: "requested",
  failed: "failed",
  recovered: "recovered",
  simulated: "simulated",
};

// Text-safe ink for the small phase tag, so its text meets AA contrast on the
// surface (the icon still uses the vivid phase color, which is a graphic).
function phaseInk(e: TimelineEvent): string {
  if (e.kind === "error" || e.phase === "failed") return "var(--forge-failed-ink)";
  if (e.phase === "requested" || e.kind === "approval_requested") return "var(--forge-waiting-ink)";
  if (e.phase === "recovered" || e.kind === "retry") return "var(--forge-running-ink)";
  if (e.kind === "verdict") return "var(--forge-shipped-ink)";
  return "var(--forge-muted)";
}

export function RunTimeline({ events, className }: { events: TimelineEvent[]; className?: string }) {
  return (
    <ol className={cn("relative space-y-0", className)}>
      {events.map((e, i) => {
        const Icon = ICON[e.kind] ?? ListChecks;
        const color = phaseColor(e);
        const last = i === events.length - 1;
        const tag = e.phase && PHASE_TAG[e.phase] && e.phase !== "executed" && e.phase !== "planned" ? PHASE_TAG[e.phase] : undefined;
        return (
          <li key={e.id} className="relative flex gap-3 pb-4">
            {!last && <span aria-hidden className="absolute left-[13px] top-7 h-[calc(100%-16px)] w-px bg-line" />}
            <span
              className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface"
              style={{ color }}
            >
              <Icon size={14} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-ink">{e.label}</span>
                {e.permission && (
                  <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">
                    {e.permission}
                  </span>
                )}
                {tag && (
                  <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide" style={{ color: phaseInk(e) }}>
                    {tag}
                  </span>
                )}
                {typeof e.durationMs === "number" && (
                  <span className="font-mono text-[11px] tabular-nums text-muted">{duration(e.durationMs)}</span>
                )}
              </div>
              {e.detail && <p className="mt-0.5 text-sm text-muted">{e.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
