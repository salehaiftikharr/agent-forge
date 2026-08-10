import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { ForgeMarkAnimated } from "@/components/marks";
import { Button, Card, SectionLabel, Stat, DemoBadge, EngineBadge, Badge } from "@/components/ui";
import { ProductDiagram } from "@/components/product-diagram";
import { MinionCard } from "@/components/minion-card";
import { RunTimeline } from "@/components/run-timeline";
import { MINIONS, RUNS } from "@/lib/fixtures";
import { getEvalReport } from "@/lib/engine-data";
import {
  ArrowRight, ShieldCheck, GitPullRequest, Ban, Eye, Lock, PlayCircle,
  MessagesSquare, FileText, Database, Activity, Search,
} from "lucide-react";

export default function LandingPage() {
  const evalReport = getEvalReport();
  const recoverRun = RUNS.find((r) => r.id === "r-recover")!;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteNav />
      <main className="flex-1">
        {/* HERO */}
        <section className="relative overflow-hidden">
          <div className="mx-auto max-w-6xl px-5 pb-16 pt-16 sm:pt-24">
            <div className="mx-auto max-w-3xl text-center">
              <div className="mb-6 flex justify-center text-ink">
                <ForgeMarkAnimated size={64} />
              </div>
              <h1 className="text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
                Describe the specialist you need.
                <br />
                <span className="text-accent-text">Forge it. Put it to work.</span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted">
                Agent Forge turns plain English into inspectable specialist agents — <strong className="font-semibold text-ink">Minions</strong> — with explicit tools, permissions, durable runs, and approval gates. Its minions open a pull request only when a test proves the fix, and decline when they cannot.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button href="/demo" size="lg">
                  Try the demo <ArrowRight size={18} />
                </Button>
                <Button href="/forge" size="lg" variant="secondary">
                  Open Forge
                </Button>
                <Button href="https://github.com/salehaiftikharr/agent-forge" size="lg" variant="ghost">
                  View on GitHub
                </Button>
              </div>
            </div>

            {/* Engine-backed proof strip */}
            {evalReport && (
              <div className="mx-auto mt-16 max-w-4xl">
                <div className="mb-4 flex items-center justify-center gap-3">
                  <EngineBadge />
                  <span className="text-sm text-muted">Hand-labeled evaluation, {evalReport.model.split("/").pop()}</span>
                </div>
                <Card className="grid grid-cols-2 gap-6 p-6 sm:grid-cols-4">
                  <Stat value={evalReport.unsafeShips} label="Unsafe ships" tone="var(--forge-shipped)" />
                  <Stat value={`${evalReport.shipRecall.correct}/${evalReport.shipRecall.total}`} label="Good fixes shipped" />
                  <Stat value={`${evalReport.declinedCorrectly.correct}/${evalReport.declinedCorrectly.total}`} label="Bad fixes declined" />
                  <Stat value={`${Math.round(evalReport.accuracy * 100)}%`} label="Overall accuracy" />
                </Card>
                <p className="mt-3 text-center text-sm text-muted">
                  It shipped every legitimate fix and refused every bad one. A minion can read tests but cannot write them, so it cannot pass by editing the gate it is judged against.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* PRODUCT MODEL */}
        <section id="product" className="border-t border-line bg-surface-2/40">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="mx-auto max-w-2xl text-center">
              <SectionLabel>The product model</SectionLabel>
              <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
                More than a chatbot. A workshop for making workers.
              </h2>
              <p className="mt-4 text-muted">
                You describe a job. Forge proposes a Minion and shows you its tools and permissions before it exists. You create it, it works through a durable Run, and you return to inspect, retry, pause, or reuse it.
              </p>
            </div>
            <div className="mt-12">
              <ProductDiagram />
            </div>
          </div>
        </section>

        {/* HOW IT WORKS — creation proof */}
        <section id="how" className="border-t border-line">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="max-w-2xl">
              <SectionLabel>How it works</SectionLabel>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">From a sentence to a working specialist</h2>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-5">
              {[
                { n: 1, t: "Describe", d: "Tell Forge the job in plain English.", icon: <MessagesSquare size={18} /> },
                { n: 2, t: "Propose", d: "Forge drafts instructions and a fixed tool set.", icon: <ForgeMarkAnimatedStatic /> },
                { n: 3, t: "Review", d: "You see tools, permissions, and data access first.", icon: <ShieldCheck size={18} /> },
                { n: 4, t: "Create", d: "Approve it and the Minion joins the roster.", icon: <PlayCircle size={18} /> },
                { n: 5, t: "Work", d: "It runs durably, and proves what it did.", icon: <GitPullRequest size={18} /> },
              ].map((s) => (
                <Card key={s.n} className="p-5">
                  <div className="flex items-center gap-2 text-muted">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2 text-ink">{s.icon}</span>
                    <span className="font-mono text-xs tabular-nums">0{s.n}</span>
                  </div>
                  <h3 className="mt-3 font-semibold text-ink">{s.t}</h3>
                  <p className="mt-1 text-sm text-muted">{s.d}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* MINIONS PROOF */}
        <section className="border-t border-line bg-surface-2/40">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-2xl">
                <SectionLabel>Minions</SectionLabel>
                <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Real, inspectable workers — not a gallery of cards</h2>
                <p className="mt-4 text-muted">Each Minion has a role, a status, a fixed tool set, a permission scope, and a history you can open.</p>
              </div>
              <DemoBadge />
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {MINIONS.slice(0, 6).map((m) => (
                <MinionCard key={m.id} minion={m} href={`/minions/${m.id}`} />
              ))}
            </div>
            <div className="mt-6">
              <Button href="/minions" variant="secondary">
                See the roster <ArrowRight size={16} />
              </Button>
            </div>
          </div>
        </section>

        {/* RUN / GATE PROOF */}
        <section className="border-t border-line">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-2">
            <div>
              <SectionLabel>Work you can watch</SectionLabel>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">A run shows its work — including the honest parts</h2>
              <p className="mt-4 text-muted">
                Runs progress through real states: planning, tool activity, waiting for approval, failure, retry, recovery, and a verdict. Nothing renders green until the backend confirms it. A declined run is a correct refusal, shown calmly — never a red error.
              </p>
              <div className="mt-6 grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg border border-line p-3">
                  <GitPullRequest className="text-shipped" size={18} />
                  <div className="mt-2 font-medium text-ink">Shipped</div>
                  <div className="text-muted">tests prove it</div>
                </div>
                <div className="rounded-lg border border-line p-3">
                  <Ban style={{ color: "var(--forge-declined)" }} size={18} />
                  <div className="mt-2 font-medium text-ink">Declined</div>
                  <div className="text-muted">held back on purpose</div>
                </div>
                <div className="rounded-lg border border-line p-3">
                  <ShieldCheck className="text-waiting" size={18} />
                  <div className="mt-2 font-medium text-ink">Gated</div>
                  <div className="text-muted">writes need approval</div>
                </div>
              </div>
            </div>
            <Card className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="font-mono text-xs text-muted">{recoverRun.ticket.id}</div>
                  <h3 className="font-semibold text-ink">{recoverRun.ticket.title}</h3>
                </div>
                <DemoBadge />
              </div>
              <RunTimeline events={recoverRun.timeline} />
            </Card>
          </div>
        </section>

        {/* CONTROL & TRUST */}
        <section className="border-t border-line bg-surface-2/40">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="max-w-2xl">
              <SectionLabel>Control &amp; trust</SectionLabel>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">You keep the controls</h2>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { icon: <Lock size={18} />, t: "Explicit permissions", d: "Every tool is read, write, or propose. Write-class actions are gated." },
                { icon: <ShieldCheck size={18} />, t: "Approval gates", d: "Guarded actions pause for your decision and are enforced server-side, not by the model." },
                { icon: <Eye size={18} />, t: "Full audit trail", d: "Every step, tool call, approval, and refusal is a timeline event you can read." },
                { icon: <Ban size={18} />, t: "It can decline", d: "With no verifiable test to satisfy, a Minion refuses rather than guess." },
                { icon: <Database size={18} />, t: "Scoped data access", d: "A Minion sees only the sandboxed clone and the sources you grant." },
                { icon: <GitPullRequest size={18} />, t: "Nothing merges itself", d: "A minion opens a PR for review; it never merges its own work." },
              ].map((c) => (
                <Card key={c.t} className="p-5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-accent-text">{c.icon}</span>
                  <h3 className="mt-3 font-semibold text-ink">{c.t}</h3>
                  <p className="mt-1 text-sm text-muted">{c.d}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* USE CASES */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="max-w-2xl">
              <SectionLabel>What you can forge</SectionLabel>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">A specialist for each recurring job</h2>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { icon: <GitPullRequest size={18} />, t: "Repository triage", d: "Fix a labelled issue on a sandbox and open a PR only when a test passes." },
                { icon: <FileText size={18} />, t: "Release notes", d: "Draft notes from merged PRs since the last tag, for your approval." },
                { icon: <Database size={18} />, t: "Data quality", d: "Catch schema drift in nightly exports and propose a fix." },
                { icon: <FileText size={18} />, t: "Docs sync", d: "Keep docs aligned with exported symbols." },
                { icon: <Activity size={18} />, t: "Monitoring", d: "Summarise incidents from an allowlisted status endpoint." },
                { icon: <Search size={18} />, t: "Research", d: "Answer from allowlisted sources and cite every claim." },
              ].map((c) => (
                <div key={c.t} className="flex gap-3 rounded-xl border border-line bg-surface p-5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent-text">{c.icon}</span>
                  <div>
                    <h3 className="font-semibold text-ink">{c.t}</h3>
                    <p className="mt-1 text-sm text-muted">{c.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ARCHITECTURE (honest) */}
        <section className="border-t border-line bg-surface-2/40">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
              <div>
                <SectionLabel>How it is built</SectionLabel>
                <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Honest architecture</h2>
                <p className="mt-4 text-muted">
                  The engine is a TypeScript system on the Claude API. Forge compiles a spec into an agent with a fixed tool set and its own acceptance tests, then runs a build, run, judge, and refine loop. Minions work on a sandboxed clone and are judged by a verification gate they cannot edit. Every run emits a receipt.
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {["TypeScript", "Claude API", "Verification gate", "Sandboxed runs", "Receipts", "CLI + Slack", "This web app"].map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </div>
              </div>
              <Card className="p-6 font-mono text-sm">
                <div className="text-muted"># the same engine, three doors</div>
                <div className="mt-2 text-ink">forge build <span className="text-accent-text">&quot;triage repo issues and open a PR when tests pass&quot;</span></div>
                <div className="mt-1 text-muted">→ designs the agent, writes its tests, repairs until green</div>
                <div className="mt-4 text-ink">minion work <span className="text-accent-text">NWT-214</span></div>
                <div className="mt-1 text-muted">→ fixes on a sandbox, runs tests, opens a PR — or declines</div>
                <div className="mt-4 text-muted"># CLI, Slack, and this web product all drive the same engine.</div>
              </Card>
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-3xl px-5 py-24 text-center">
            <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">See a Minion forged, put to work, and proven</h2>
            <p className="mt-4 text-muted">The guided demo runs on deterministic fictional data — no credentials, no private repos.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button href="/demo" size="lg">
                Try the demo <ArrowRight size={18} />
              </Button>
              <Button href="/forge" size="lg" variant="secondary">
                Open Forge
              </Button>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

/** A tiny static Forge glyph for the stepper, avoiding another animated instance. */
function ForgeMarkAnimatedStatic() {
  return (
    <svg width={18} height={18} viewBox="0 0 48 48" aria-hidden>
      <path d="M9 14 H19 L24 21 L29 14 H39 A4 4 0 0 1 43 18 V39 A4 4 0 0 1 39 43 H9 A4 4 0 0 1 5 39 V18 A4 4 0 0 1 9 14 Z" fill="none" stroke="currentColor" strokeWidth={4.5} strokeLinejoin="round" />
      <circle cx="24" cy="10" r="6" fill="var(--forge-accent)" />
    </svg>
  );
}
