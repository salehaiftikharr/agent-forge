import type { Metadata } from "next";
import { MinionRoster } from "@/components/minion-roster";
import { DemoBadge } from "@/components/ui";
import { MINIONS } from "@/lib/fixtures";

export const metadata: Metadata = { title: "Minions" };

export default function MinionsPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Minions</h1>
          <p className="mt-1 text-muted">Your specialist agents. Open one to inspect its tools, permissions, and runs.</p>
        </div>
        <DemoBadge />
      </div>
      <div className="mt-8">
        <MinionRoster minions={MINIONS} />
      </div>
    </div>
  );
}
