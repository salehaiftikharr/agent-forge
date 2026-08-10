"use client";

import { useState } from "react";
import { Pause, Play, Pencil, Copy, Archive, Info } from "lucide-react";
import { Button, StatusPill } from "./ui";
import type { MinionStatus } from "@/lib/types";

/** Operational controls for a Minion. Interactions are session-local (there is
    no backend persistence in this build) and say so — no fabricated durability. */
export function MinionControls({ initialStatus }: { initialStatus: MinionStatus }) {
  const [status, setStatus] = useState<MinionStatus>(initialStatus);
  const [note, setNote] = useState<string | null>(null);

  const paused = status === "paused";
  function toggle() {
    const next = paused ? "ready" : "paused";
    setStatus(next);
    setNote(paused ? "Resumed. (Demo mode — this change is local to this session.)" : "Paused. (Demo mode — this change is local to this session.)");
  }
  function demoAction(label: string) {
    setNote(`${label} is not wired to a backend in this build. (Demo mode — no change was persisted.)`);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={status} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={toggle}>
            {paused ? <><Play size={15} /> Resume</> : <><Pause size={15} /> Pause</>}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => demoAction("Edit")}><Pencil size={15} /> Edit</Button>
          <Button variant="secondary" size="sm" onClick={() => demoAction("Duplicate")}><Copy size={15} /> Duplicate</Button>
          <Button variant="ghost" size="sm" onClick={() => demoAction("Archive")}><Archive size={15} /> Archive</Button>
        </div>
      </div>
      {note && (
        <p role="status" className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-muted">
          <Info size={15} /> {note}
        </p>
      )}
    </div>
  );
}
