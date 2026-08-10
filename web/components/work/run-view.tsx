"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldQuestion, Wifi, WifiOff, CircleCheck, Loader2 } from "lucide-react";
import { Card, Button, StatusPill, EngineBadge, SectionLabel, Stat } from "@/components/ui";
import { RunTimeline } from "@/components/run-timeline";
import { DiffView } from "@/components/diff-view";
import type { Run, TimelineEvent, RunState } from "@/lib/types";
import { RUN_STATE_LABEL } from "@/lib/types";

interface PendingApproval {
  id: string;
  action: string;
  summary: string;
  preview?: string;
}
type Conn = "connecting" | "live" | "offline" | "done";
const TERMINAL = new Set<RunState>(["completed", "declined", "cancelled", "failed"]);

export function RunView({ initialRun }: { initialRun: Run }) {
  const [run, setRun] = useState<Run>(initialRun);
  const [events, setEvents] = useState<TimelineEvent[]>(initialRun.timeline ?? []);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const [busy, setBusy] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (TERMINAL.has(run.state)) setConn("done");
    const es = new EventSource(`/api/runs/${initialRun.id}/events`);
    esRef.current = es;

    es.addEventListener("snapshot", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data);
      // Replace (never append) so a reconnect re-syncs cleanly with no dupes.
      setRun(data.run);
      setEvents(data.run.timeline ?? []);
      setPending(data.pendingApproval ?? null);
    });
    es.addEventListener("event", (ev) => {
      const e = JSON.parse((ev as MessageEvent).data) as TimelineEvent;
      setEvents((prev) => (prev.some((x) => x.id === e.id) ? prev : [...prev, e]));
    });
    es.addEventListener("state", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data);
      setRun((prev) => ({ ...prev, ...data.run, timeline: prev.timeline }));
      setPending(data.pendingApproval ?? null);
    });
    es.addEventListener("ping", () => setConn("live"));
    es.addEventListener("done", () => {
      setConn("done");
      es.close();
    });
    es.onopen = () => setConn("live");
    es.onerror = () => {
      // EventSource auto-reconnects; our route resumes from Last-Event-ID.
      if (esRef.current) setConn((c) => (c === "done" ? "done" : "offline"));
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRun.id]);

  const decide = useCallback(
    async (decision: "approve" | "reject") => {
      if (busy) return;
      setBusy(true);
      try {
        await fetch(`/api/runs/${run.id}/decision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        });
        setPending(null); // the stream will confirm the resulting state
      } finally {
        setBusy(false);
      }
    },
    [busy, run.id],
  );

  const cancel = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/runs/${run.id}/cancel`, { method: "POST" });
    } finally {
      setBusy(false);
    }
  }, [busy, run.id]);

  const terminal = TERMINAL.has(run.state);
  const diffs = run.artifacts?.filter((a) => a.kind === "diff") ?? [];

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 md:px-8">
      <Link href="/work" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={15} /> Runs
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SectionLabel>{run.ticket.id}</SectionLabel>
            <EngineBadge />
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">{run.ticket.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill status={run.state as RunState} />
            <span className="font-mono text-xs text-muted">{run.model}</span>
            <ConnBadge conn={conn} />
          </div>
        </div>
        {!terminal && (
          <Button variant="secondary" size="sm" onClick={cancel} disabled={busy}>
            Cancel run
          </Button>
        )}
      </div>

      {conn === "offline" && (
        <p role="status" className="mt-4 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm" style={{ color: "var(--forge-waiting-ink)" }}>
          Reconnecting to the live stream… the run keeps going on the server.
        </p>
      )}

      {/* Approval gate — a real enforcement boundary. */}
      {pending && run.state === "waiting_approval" && (
        <Card className="mt-6 border-[var(--forge-waiting)] p-5">
          <div className="flex items-center gap-2" style={{ color: "var(--forge-waiting-ink)" }}>
            <ShieldQuestion size={18} />
            <h2 className="text-sm font-bold uppercase tracking-wide">Approval required</h2>
          </div>
          <p className="mt-2 text-sm text-ink">{pending.summary}</p>
          {pending.preview && (
            <div className="mt-3">
              <DiffView title="Exactly what will ship" body={pending.preview} />
            </div>
          )}
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={() => decide("approve")} disabled={busy}>
              Approve &amp; ship
            </Button>
            <Button variant="secondary" onClick={() => decide("reject")} disabled={busy}>
              Reject
            </Button>
          </div>
        </Card>
      )}

      {/* Gate summary once the engine has verified. */}
      {(run.baselineTests || run.confidence) && (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {run.finalTests && (
            <Stat value={`${run.finalTests.passed}/${run.finalTests.total}`} label="Tests passing" />
          )}
          {run.confidence && (
            <Stat value={run.confidence.score.toFixed(2)} label={`Confidence · ${run.confidence.level}`} />
          )}
          {run.risk && <Stat value={run.risk.level} label="Blast radius" />}
          {typeof run.costUsd === "number" && <Stat value={`$${run.costUsd.toFixed(4)}`} label="Est. cost" />}
        </div>
      )}

      {run.reason && (
        <p className="mt-6 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-ink">{run.reason}</p>
      )}

      {/* Artifacts. */}
      {diffs.length > 0 && (
        <div className="mt-6">
          <SectionLabel>Artifacts</SectionLabel>
          <div className="mt-3 space-y-4">
            {diffs.map((a) => (
              <DiffView key={a.id} title={a.title} body={a.body ?? ""} />
            ))}
          </div>
        </div>
      )}

      {/* The event ledger — the source of truth for what happened. */}
      <div className="mt-8">
        <SectionLabel>Timeline</SectionLabel>
        {events.length === 0 ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted">
            <Loader2 size={15} className="animate-spin" /> Waiting for the first events…
          </p>
        ) : (
          <div className="mt-4">
            <RunTimeline events={events} />
          </div>
        )}
      </div>
    </div>
  );
}

function ConnBadge({ conn }: { conn: Conn }) {
  const map = {
    connecting: { Icon: Loader2, text: "Connecting", ink: "var(--forge-muted)", spin: true },
    live: { Icon: Wifi, text: "Live", ink: "var(--forge-running-ink)", spin: false },
    offline: { Icon: WifiOff, text: "Reconnecting", ink: "var(--forge-waiting-ink)", spin: false },
    done: { Icon: CircleCheck, text: "Final", ink: "var(--forge-shipped-ink)", spin: false },
  }[conn];
  const { Icon, text, ink, spin } = map;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-medium" style={{ color: ink }}>
      <Icon size={12} className={spin ? "animate-spin" : ""} /> {text}
    </span>
  );
}
