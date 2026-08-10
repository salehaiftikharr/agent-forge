import type { Metadata } from "next";
import { DemoPlayer } from "@/components/demo-player";
import { DemoBadge } from "@/components/ui";

export const metadata: Metadata = { title: "Forge" };

export default function ForgePage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Forge</h1>
          <p className="mt-1 max-w-2xl text-muted">
            Describe a job, review the Minion Forge proposes, create it, and watch its first run — tool activity, approval gate, recovery, and a verified result — all in one place.
          </p>
        </div>
        <DemoBadge />
      </div>
      <DemoPlayer />
    </div>
  );
}
