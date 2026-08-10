import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { DemoPlayer } from "@/components/demo-player";
import { SectionLabel } from "@/components/ui";

export const metadata: Metadata = {
  title: "Guided demo",
  description: "Watch a Minion get forged, approved, and put to work — on deterministic fictional data, no credentials needed.",
};

export default function DemoPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteNav />
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-5 py-12">
          <div className="mb-10 max-w-2xl">
            <SectionLabel>Guided demo</SectionLabel>
            <h1 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              Forge a Minion, approve its work, and watch it prove the fix
            </h1>
            <p className="mt-4 text-muted">
              Step through the whole flow: describe a job, review the proposed Minion, create it, and follow a run through tool activity, an approval gate, an honest failure, recovery, and a verified pull request. It runs on fictional data, so nothing here touches a real repository.
            </p>
          </div>
          <DemoPlayer />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
