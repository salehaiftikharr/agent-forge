import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FlaskConical, Gauge, ShieldAlert, Bot } from "lucide-react";
import { Card, DemoBadge, StatusPill } from "@/components/ui";
import { RunTimeline } from "@/components/run-timeline";
import { RunControls } from "@/components/run-controls";
import { DiffView } from "@/components/diff-view";
import { getRun } from "@/lib/fixtures";
import { duration, money, relativeTime } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const r = getRun(id);
  return { title: r ? `${r.ticket.id} · ${r.ticket.title}` : "Run" };
}

export default async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = getRun(id);
  if (!r) notFound();

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:py-10">
      <Link href="/runs" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={15} /> Runs
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted">{r.ticket.id}</span>
            <StatusPill status={r.state} />
            <DemoBadge />
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{r.ticket.title}</h1>
          <Link href={`/minions/${r.minionId}`} className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
            <Bot size={14} /> {r.minionName}
          </Link>
        </div>
      </div>

      {r.ticket.body && <p className="mt-4 text-muted">{r.ticket.body}</p>}

      <div className="mt-6">
        <RunControls state={r.state} />
      </div>

      {/* Verification gate summary */}
      {(r.baselineTests || r.finalTests || r.reason) && (
        <Card className="mt-6 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted"><FlaskConical size={15} /> Verification gate</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            {r.baselineTests && (
              <div>
                <div className="text-xs text-muted">Baseline</div>
                <div className="text-lg font-semibold tabular-nums">{r.baselineTests.passed}/{r.baselineTests.total} passing</div>
              </div>
            )}
            {r.finalTests && (
              <div>
                <div className="text-xs text-muted">After the change</div>
                <div className="text-lg font-semibold tabular-nums" style={{ color: r.finalTests.ok ? "var(--forge-shipped)" : "var(--forge-ink)" }}>
                  {r.finalTests.passed}/{r.finalTests.total} passing
                </div>
              </div>
            )}
            {r.confidence && (
              <div>
                <div className="flex items-center gap-1 text-xs text-muted"><Gauge size={12} /> Confidence</div>
                <div className="text-lg font-semibold capitalize">{r.confidence.level}</div>
              </div>
            )}
          </div>
          {r.risk && (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 text-muted"><ShieldAlert size={14} /> Risk:</span>
              <span className="capitalize text-ink">{r.risk.level}</span>
              {r.risk.factors.map((f) => (
                <span key={f} className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{f}</span>
              ))}
            </div>
          )}
          {r.reason && (
            <p className="mt-4 rounded-lg bg-surface-2 p-3 text-sm text-ink">
              <span className="font-medium">{r.state === "declined" ? "Why it declined: " : "Verdict: "}</span>
              {r.reason}
            </p>
          )}
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-muted">Timeline</h2>
          <RunTimeline events={r.timeline} />
        </Card>

        <div className="space-y-6">
          {r.artifacts.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-muted">Artifacts</h2>
              <div className="space-y-4">
                {r.artifacts.map((a) => (
                  <div key={a.id}>
                    {a.kind === "diff" && a.body ? (
                      <DiffView title={a.title} body={a.body} />
                    ) : (
                      <div className="rounded-lg border border-line p-3 text-sm text-ink">{a.title}</div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-muted">Details</h2>
            <dl className="space-y-2 text-sm">
              <Row k="Model" v={r.model.split("/").pop() ?? r.model} />
              <Row k="Started" v={relativeTime(r.startedAt)} />
              <Row k="Steps" v={String(r.steps)} />
              <Row k="Tool calls" v={String(r.toolCalls)} />
              {typeof r.durationMs === "number" && <Row k="Duration" v={duration(r.durationMs)} />}
              {typeof r.costUsd === "number" && <Row k="Cost" v={money(r.costUsd)} />}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{k}</dt>
      <dd className="font-medium tabular-nums text-ink">{v}</dd>
    </div>
  );
}
