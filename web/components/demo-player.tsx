"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  RotateCcw, Send, ShieldCheck, ShieldX, ArrowRight, Wrench, Lock, CheckCircle2, Bot,
} from "lucide-react";
import { ForgeMark, MinionMark } from "./marks";
import { Button, Card, StatusPill, DemoBadge } from "./ui";
import { RunTimeline } from "./run-timeline";
import { DiffView } from "./diff-view";
import type { TimelineEvent, RunState } from "@/lib/types";

type Decision = "none" | "approved" | "rejected";

const PROPOSAL = {
  name: "Repo Triage",
  purpose: "Fix a labelled issue on a sandboxed clone and open a PR only when a test proves the fix.",
  instructions:
    "Take one triaged issue, reproduce it, write the smallest correct fix, run the suite, and open a PR only when a previously-failing test passes with no regressions. Otherwise decline with a reason.",
  tools: [
    { name: "read_repo", permission: "read" },
    { name: "read_tests", permission: "read" },
    { name: "run_tests", permission: "read" },
    { name: "write_patch", permission: "write" },
    { name: "open_pr", permission: "write" },
  ],
  dataAccess: ["northwind/toolkit (read + PR)"],
};

const HEAD: TimelineEvent[] = [
  { id: "e0", at: "", kind: "queued", label: "Picked up NWT-231", phase: "executed" },
  { id: "e1", at: "", kind: "plan", label: "Planned the fix", detail: "Reproduce, patch src/utils.js, verify against the failing test.", phase: "planned" },
  { id: "e2", at: "", kind: "tool", label: "read_repo", detail: "src/utils.js, test/utils.test.js", permission: "read", durationMs: 420, phase: "executed" },
  { id: "e3", at: "", kind: "test", label: "Baseline: 6/8 passing", detail: "The clamp tests fail as expected.", phase: "executed" },
  { id: "e4", at: "", kind: "approval_requested", label: "Waiting for your approval", detail: "write_patch is a guarded, write-class action.", permission: "write", phase: "requested" },
];
const APPROVE_TAIL: TimelineEvent[][] = [
  [
    { id: "a0", at: "", kind: "approval_granted", label: "You approved the write", phase: "approved" },
    { id: "a1", at: "", kind: "tool", label: "write_patch", detail: "Added export function clamp(n,min,max).", permission: "write", durationMs: 1500, phase: "executed" },
  ],
  [
    { id: "a2", at: "", kind: "tool", label: "run_tests", detail: "Sandbox image pull timed out.", permission: "read", durationMs: 30000, phase: "failed" },
    { id: "a3", at: "", kind: "error", label: "Step failed: sandbox timeout", detail: "A transient infrastructure error, not a code problem.", phase: "failed" },
  ],
  [
    { id: "a4", at: "", kind: "retry", label: "Retrying from the last checkpoint", detail: "Bounded retry (attempt 2 of 3).", phase: "recovered" },
    { id: "a5", at: "", kind: "test", label: "Verification gate: 8/8 passing", detail: "Previously-failing tests pass; no regressions.", phase: "executed" },
  ],
  [
    { id: "a6", at: "", kind: "verdict", label: "Shipped", detail: "Gate passed. Opened a PR on minion/nwt-231.", phase: "executed" },
    { id: "a7", at: "", kind: "artifact", label: "Pull request + diff", phase: "executed" },
  ],
];
const REJECT_TAIL: TimelineEvent[] = [
  { id: "j0", at: "", kind: "approval_rejected", label: "You rejected the write", phase: "executed" },
  { id: "j1", at: "", kind: "verdict", label: "Declined", detail: "Recorded the rejection and reported the limitation honestly instead of guessing.", phase: "executed" },
];

const DIFF =
  "@@ -25,4 +25,6 @@ export function parseQueryString(qs) {\n   return out;\n }\n \n-// NWT-231: a clamp(n, min, max) helper is requested but doesn't exist yet.\n+export function clamp(n, min, max) {\n+  return Math.min(Math.max(n, min), max);\n+}";

const STEP_LABELS = ["Ask", "Propose", "Review", "Create", "Run", "Approve", "Recover", "Ship"];

export function DemoPlayer() {
  // stage: 0 ask · 1 asked · 2 proposed · 3 reviewed · 4 created · 5 run started
  //        6 read · 7 baseline · 8 approval · 9..12 approved tail · 9r rejected
  const [stage, setStage] = useState(0);
  const [decision, setDecision] = useState<Decision>("none");

  const timeline = useMemo(() => {
    if (stage < 5) return [];
    let n = 2; // queued + plan
    if (stage >= 6) n = 3;
    if (stage >= 7) n = 4;
    if (stage >= 8) n = 5;
    let events = HEAD.slice(0, n);
    if (decision === "approved") {
      const tiers = Math.min(stage - 8, APPROVE_TAIL.length); // stage 9..12
      for (let i = 0; i < tiers; i++) events = events.concat(APPROVE_TAIL[i]);
    } else if (decision === "rejected") {
      events = events.concat(REJECT_TAIL);
    }
    return events;
  }, [stage, decision]);

  const runState: RunState =
    decision === "rejected"
      ? "declined"
      : decision === "approved"
        ? stage >= 12
          ? "completed"
          : stage === 10
            ? "retrying"
            : "running"
        : stage >= 8
          ? "waiting_approval"
          : stage >= 5
            ? "running"
            : "queued";

  const shipped = decision === "approved" && stage >= 12;
  const stepIndex = Math.min(stage <= 4 ? stage : decision === "rejected" ? 5 : Math.min(stage - 3, 7), 7);

  function reset() {
    setStage(0);
    setDecision("none");
  }

  return (
    <div>
      {/* Stepper */}
      <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
        {STEP_LABELS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${i <= stepIndex ? "text-ink" : "text-muted"}`}
              style={i <= stepIndex ? { background: "color-mix(in srgb, var(--forge-accent) 12%, transparent)", color: "var(--forge-accent-text)" } : undefined}
            >
              <span className="font-mono tabular-nums">{i + 1}</span> {s}
            </span>
            {i < STEP_LABELS.length - 1 && <span className="text-line">·</span>}
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* FORGE conversation */}
        <Card className="flex min-h-[460px] flex-col p-5">
          <div className="mb-4 flex items-center gap-2 border-b border-line pb-3 text-sm font-medium text-muted">
            <ForgeMark size={18} /> Forge
          </div>
          <div className="flex-1 space-y-4">
            {stage >= 1 && (
              <Bubble who="you">I keep getting small bug-fix tickets in northwind/toolkit. Make me something that fixes them safely and never ships a guess.</Bubble>
            )}
            {stage >= 2 && (
              <Bubble who="forge">
                Here is a Minion for that: <strong>Repo Triage</strong>. It fixes an issue on a sandboxed clone and opens a PR <em>only</em> when a previously-failing test passes. Review its tools and permissions before you create it.
              </Bubble>
            )}
            {stage >= 4 && <Bubble who="forge">Created. Assigning it <span className="font-mono">NWT-231</span> to start its first run.</Bubble>}
            {shipped && <Bubble who="forge">Done. The gate passed after a transient retry, and I opened a pull request. Nothing merged on its own.</Bubble>}
            {decision === "rejected" && <Bubble who="forge">Understood. I did not write anything. I recorded the rejection and reported the limitation instead of guessing.</Bubble>}
          </div>

          {/* Composer / actions */}
          <div className="mt-4 border-t border-line pt-4">
            {stage === 0 && (
              <Button onClick={() => setStage(1)} className="w-full"><Send size={16} /> Ask Forge</Button>
            )}
            {stage === 1 && <Button onClick={() => setStage(2)} className="w-full">Forge proposes a Minion <ArrowRight size={16} /></Button>}
            {stage === 2 && <Button onClick={() => setStage(3)} variant="secondary" className="w-full">Review its tools &amp; permissions <ArrowRight size={16} /></Button>}
            {stage === 3 && <Button onClick={() => setStage(4)} className="w-full"><CheckCircle2 size={16} /> Create this Minion</Button>}
            {stage === 4 && <Button onClick={() => setStage(5)} className="w-full">Start the run <ArrowRight size={16} /></Button>}
            {stage >= 5 && stage < 8 && <Button onClick={() => setStage((s) => s + 1)} className="w-full">Next step <ArrowRight size={16} /></Button>}
            {stage === 8 && decision === "none" && (
              <p className="text-center text-sm text-muted">The run is paused at the approval gate. Decide in the workbench →</p>
            )}
            {decision === "approved" && stage < 12 && <Button onClick={() => setStage((s) => s + 1)} className="w-full">Continue the run <ArrowRight size={16} /></Button>}
            {(shipped || decision === "rejected") && (
              <Button onClick={reset} variant="secondary" className="w-full"><RotateCcw size={16} /> Reset demo</Button>
            )}
          </div>
        </Card>

        {/* WORKBENCH */}
        <Card className="min-h-[460px] p-5">
          <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
            <span className="text-sm font-medium text-muted">Workbench</span>
            {stage >= 5 && <StatusPill status={runState} />}
          </div>

          {stage < 2 && (
            <div className="flex h-72 flex-col items-center justify-center text-center text-muted">
              <ForgeMark size={40} className="text-ink" />
              <p className="mt-3 text-sm">Ask Forge for a specialist. Its proposal will appear here for you to review.</p>
            </div>
          )}

          {stage >= 2 && stage < 5 && (
            <div>
              <div className="flex items-center gap-3">
                <MinionMark size={38} status="ready" className="text-ink" />
                <div>
                  <div className="font-semibold text-ink">{PROPOSAL.name}</div>
                  <div className="text-sm text-muted">Proposed specialist · not created yet</div>
                </div>
              </div>
              <p className="mt-3 text-sm text-muted">{PROPOSAL.purpose}</p>
              <div className="mt-4">
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted"><Wrench size={14} /> Tools</div>
                <ul className="space-y-1.5">
                  {PROPOSAL.tools.map((t) => (
                    <li key={t.name} className="flex items-center justify-between text-sm">
                      <span className="font-mono text-ink">{t.name}</span>
                      <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${t.permission === "write" ? "" : "text-muted"}`} style={t.permission === "write" ? { color: "var(--forge-waiting)", borderColor: "color-mix(in srgb, var(--forge-waiting) 40%, transparent)" } : undefined}>
                        {t.permission === "write" && <Lock size={9} />} {t.permission}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {stage >= 3 && (
                <p className="mt-4 rounded-lg bg-surface-2 p-3 text-sm text-muted">
                  Write-class tools (<span className="font-mono">write_patch</span>, <span className="font-mono">open_pr</span>) are <strong className="text-ink">gated</strong>: they pause for your approval every time. Read tools do not.
                </p>
              )}
            </div>
          )}

          {stage >= 5 && (
            <div>
              <RunTimeline events={timeline} />

              {stage === 8 && decision === "none" && (
                <div className="mt-2 rounded-xl border p-4" style={{ borderColor: "color-mix(in srgb, var(--forge-waiting) 45%, transparent)", background: "color-mix(in srgb, var(--forge-waiting) 8%, transparent)" }}>
                  <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--forge-waiting)" }}>
                    <ShieldCheck size={16} /> Approve the guarded write?
                  </div>
                  <p className="mt-1 text-sm text-muted">Nothing runs until you decide. This gate is what keeps the Minion from writing on its own.</p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => { setDecision("approved"); setStage(9); }}><ShieldCheck size={15} /> Approve</Button>
                    <Button size="sm" variant="secondary" onClick={() => { setDecision("rejected"); setStage(9); }}><ShieldX size={15} /> Reject</Button>
                  </div>
                </div>
              )}

              {shipped && (
                <div className="mt-4">
                  <DiffView title="src/utils.js" body={DIFF} />
                  <Link href="/minions/m-repo-triage" className="mt-4 flex items-center justify-between rounded-lg border border-line bg-surface-2 p-3 hover:bg-surface">
                    <span className="flex items-center gap-2 text-sm">
                      <MinionMark size={26} status="ready" className="text-ink" />
                      <span><span className="font-medium text-ink">Repo Triage</span> is now in your roster</span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-sm text-accent-text"><Bot size={14} /> Open</span>
                  </Link>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <p className="mt-6 flex items-center gap-2 text-sm text-muted">
        <DemoBadge /> Everything here is simulated on deterministic fictional data. No model was called, no repository was touched, and no external action was taken.
      </p>
    </div>
  );
}

function Bubble({ who, children }: { who: "you" | "forge"; children: React.ReactNode }) {
  const isYou = who === "you";
  return (
    <div className={isYou ? "flex justify-end" : "flex justify-start"}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${isYou ? "bg-accent text-white" : "border border-line bg-surface-2 text-ink"}`}
        style={isYou ? { borderBottomRightRadius: 6 } : { borderBottomLeftRadius: 6 }}
      >
        {children}
      </div>
    </div>
  );
}
