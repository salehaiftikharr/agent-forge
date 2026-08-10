import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { ProductDiagram } from "@/components/product-diagram";
import { Card, SectionLabel, Stat, EngineBadge, Badge } from "@/components/ui";
import { getEvalReport } from "@/lib/engine-data";
import { CheckCircle2, XCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "About",
  description: "The thesis behind Agent Forge: verifiable specialist agents that prove their work or decline, with an honest account of how it is built and what it cannot yet do.",
};

export default function AboutPage() {
  const evalReport = getEvalReport();
  return (
    <div className="flex min-h-screen flex-col">
      <SiteNav />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-5 py-16">
          <SectionLabel>About</SectionLabel>
          <h1 className="mt-3 text-balance text-4xl font-extrabold tracking-tight">Agents that do real work, and prove it</h1>
          <p className="mt-5 text-lg text-muted">
            Most agent demos are convincing until you ask them to be trusted. Agent Forge starts from the opposite end: a worker is only useful if you can see what it will do, watch what it does, and know it will refuse rather than guess. The proof is not a screenshot — it is a test that has to pass.
          </p>

          <h2 className="mt-14 text-2xl font-bold tracking-tight">Forge, Minions, and Runs</h2>
          <p className="mt-3 text-muted">
            <strong className="text-ink">Forge</strong> turns a plain-English description into a specialist agent with a fixed tool set and its own acceptance tests. A <strong className="text-ink">Minion</strong> is what Forge makes: a scoped worker with an identity, explicit permissions, and a history. A <strong className="text-ink">Run</strong> is one durable execution you can inspect end to end.
          </p>
          <div className="mt-8"><ProductDiagram /></div>

          <h2 className="mt-14 text-2xl font-bold tracking-tight">The verification gate</h2>
          <p className="mt-3 text-muted">
            A minion fixes an issue on a sandboxed clone, runs the suite, and opens a pull request <em>only</em> when a previously-failing test passes with no regressions. It can read the tests but physically cannot write them, so it cannot pass by editing the gate it is judged against. When there is no verifiable test to satisfy, it declines and says why.
          </p>
          {evalReport && (
            <div className="mt-6">
              <div className="mb-3"><EngineBadge /></div>
              <Card className="grid grid-cols-2 gap-6 p-6 sm:grid-cols-4">
                <Stat value={evalReport.unsafeShips} label="Unsafe ships" tone="var(--forge-shipped)" />
                <Stat value={`${evalReport.shipRecall.correct}/${evalReport.shipRecall.total}`} label="Good fixes shipped" />
                <Stat value={`${evalReport.declinedCorrectly.correct}/${evalReport.declinedCorrectly.total}`} label="Bad fixes declined" />
                <Stat value={`${Math.round(evalReport.accuracy * 100)}%`} label="Accuracy" />
              </Card>
              <p className="mt-2 text-sm text-muted">Hand-labeled evaluation recorded by the engine ({evalReport.model.split("/").pop()}). These are read from the engine&apos;s output, not typed into this page.</p>
            </div>
          )}

          <h2 className="mt-14 text-2xl font-bold tracking-tight">How it is built</h2>
          <p className="mt-3 text-muted">
            The engine is a TypeScript system on the Claude API. Forge runs a build, run, judge, and refine loop: it designs the agent, generates acceptance tests, runs the agent against them, and feeds failures back to the builder until they pass. Minions run on sandboxed clones and emit a receipt for every run. The same engine is driven three ways: a CLI, a Slack bot, and this web product.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {["TypeScript", "Claude API", "Build/run/judge/refine", "Sandboxed runs", "Verification gate", "Receipts", "CLI + Slack", "Next.js web app"].map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>

          <h2 className="mt-14 text-2xl font-bold tracking-tight">What it does and does not do</h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <Card className="p-5">
              <h3 className="flex items-center gap-2 font-semibold text-ink"><CheckCircle2 size={18} className="text-shipped" /> It does</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted">
                <li>Fix real issues and open a PR only when a test proves the fix</li>
                <li>Decline, with a reason, when it cannot verify a fix</li>
                <li>Pause write-class actions for approval, enforced in the engine</li>
                <li>Record every step, tool call, approval, and refusal</li>
              </ul>
            </Card>
            <Card className="p-5">
              <h3 className="flex items-center gap-2 font-semibold text-ink"><XCircle size={18} style={{ color: "var(--forge-muted)" }} /> It does not (in this build)</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted">
                <li>Authenticate users — every web surface is public and read-mostly</li>
                <li>Call a model from the web app — the engine does that via the CLI</li>
                <li>Persist demo interactions — approvals and pauses here are session-local</li>
                <li>Use any real data on public pages — those use a fictional dataset</li>
              </ul>
            </Card>
          </div>
          <p className="mt-6 text-sm text-muted">
            The web product is honest about the seam between the two: numbers read from the engine are labeled &quot;from the engine,&quot; and everything else is labeled &quot;demo data.&quot;
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
