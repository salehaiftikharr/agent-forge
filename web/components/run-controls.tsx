"use client";

import { useState } from "react";
import { ShieldCheck, ShieldX, RotateCw, Ban, Info } from "lucide-react";
import { Button } from "./ui";
import type { RunState } from "@/lib/types";

/** Run controls appropriate to the state. Session-local and labelled as such:
    this build has no execution backend, so an approval here demonstrates the
    control surface, it does not itself execute anything. The real gate lives in
    the engine, where a write only runs after approval and a test must pass. */
export function RunControls({ state }: { state: RunState }) {
  const [note, setNote] = useState<string | null>(null);

  if (state === "waiting_approval") {
    return (
      <div>
        <div className="rounded-xl border p-4" style={{ borderColor: "color-mix(in srgb, var(--forge-waiting-ink) 45%, transparent)", background: "color-mix(in srgb, var(--forge-waiting-ink) 8%, transparent)" }}>
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--forge-waiting-ink)" }}>
            <ShieldCheck size={16} /> This run is waiting for your approval
          </div>
          <p className="mt-1 text-sm text-muted">A write-class action is guarded. Nothing runs until you decide.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => setNote("Approved. In the engine this would execute the guarded command, then continue the run. (Demo mode — session-local.)")}>
              <ShieldCheck size={15} /> Approve
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setNote("Rejected. In the engine the Minion would record the rejection and report the limitation honestly. (Demo mode — session-local.)")}>
              <ShieldX size={15} /> Reject
            </Button>
          </div>
        </div>
        {note && <Hint>{note}</Hint>}
      </div>
    );
  }

  if (state === "failed") {
    return (
      <div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setNote("Retry queued from the last checkpoint. (Demo mode — session-local.)")}>
            <RotateCw size={15} /> Retry from checkpoint
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNote("Run cancelled. (Demo mode — session-local.)")}>
            <Ban size={15} /> Cancel
          </Button>
        </div>
        {note && <Hint>{note}</Hint>}
      </div>
    );
  }

  return null;
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-muted">
      <Info size={15} /> {children}
    </p>
  );
}
