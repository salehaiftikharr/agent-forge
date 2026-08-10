import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, GitBranch, Wrench, ShieldCheck, Database, ArrowUpRight } from "lucide-react";
import { MinionMark } from "@/components/marks";
import { MinionControls } from "@/components/minion-controls";
import { Card, DemoBadge, StatusPill, Button } from "@/components/ui";
import { getMinion, runsForMinion } from "@/lib/fixtures";
import { relativeTime } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const m = getMinion(id);
  return { title: m ? m.name : "Minion" };
}

const PERM_LABEL: Record<string, string> = { read: "Read", write: "Write · gated", propose: "Proposes for approval" };

export default async function MinionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = getMinion(id);
  if (!m) notFound();
  const runs = runsForMinion(id);

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:py-10">
      <Link href="/minions" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={15} /> Minions
      </Link>

      <div className="flex items-start gap-4">
        <span className="text-ink"><MinionMark size={52} status={m.status} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-bold tracking-tight">{m.name}</h1>
            <DemoBadge />
          </div>
          <p className="text-muted">{m.role}</p>
        </div>
      </div>

      <div className="mt-6">
        <MinionControls initialStatus={m.status} />
      </div>

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-semibold text-muted">Purpose</h2>
        <p className="mt-1 text-ink">{m.purpose}</p>
        <h2 className="mt-4 text-sm font-semibold text-muted">Instructions</h2>
        <p className="mt-1 text-ink">{m.instructions}</p>
      </Card>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted"><Wrench size={15} /> Tools ({m.tools.length})</h2>
          <ul className="mt-3 space-y-2">
            {m.tools.map((t) => (
              <li key={t.name} className="flex items-start justify-between gap-3">
                <div>
                  <span className="font-mono text-sm text-ink">{t.name}</span>
                  <p className="text-xs text-muted">{t.description}</p>
                </div>
                <span className="shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">{t.permission}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted"><ShieldCheck size={15} /> Permissions &amp; data access</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {["read", "write", "propose"].map((p) => {
              const count = m.tools.filter((t) => t.permission === p).length;
              if (!count) return null;
              return (
                <li key={p} className="flex items-center justify-between">
                  <span className="text-ink">{PERM_LABEL[p]}</span>
                  <span className="text-muted">{count} tool{count > 1 ? "s" : ""}</span>
                </li>
              );
            })}
          </ul>
          <h3 className="mt-4 flex items-center gap-2 text-sm font-semibold text-muted"><Database size={15} /> Data access</h3>
          <ul className="mt-2 space-y-1 text-sm text-ink">
            {m.dataAccess.map((d) => <li key={d}>{d}</li>)}
          </ul>
          <p className="mt-3 text-xs text-muted">Write-class actions pause for your approval. This Minion cannot reach anything outside the scope above.</p>
        </Card>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted">Recent runs</h2>
          <Button href="/forge" size="sm" variant="secondary">Assign work</Button>
        </div>
        {runs.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted">No runs yet. Assign this Minion a job in Forge.</Card>
        ) : (
          <div className="space-y-2">
            {runs.map((r) => (
              <Link key={r.id} href={`/runs/${r.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 hover:bg-surface-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted">{r.ticket.id}</span>
                    <StatusPill status={r.state} />
                  </div>
                  <p className="mt-0.5 truncate text-sm text-ink">{r.ticket.title}</p>
                </div>
                <ArrowUpRight size={16} className="shrink-0 text-muted" />
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5"><GitBranch size={14} /> {m.repo}</span>
        <span className="inline-flex items-center gap-1.5"><Clock size={14} /> Created {relativeTime(m.createdAt)}</span>
        <span className="inline-flex items-center gap-1.5"><Clock size={14} /> Active {relativeTime(m.lastActiveAt)}</span>
        <span>{m.runsCount} total runs</span>
      </div>
    </div>
  );
}
