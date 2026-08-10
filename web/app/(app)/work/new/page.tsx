import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SectionLabel } from "@/components/ui";
import { NewRunForm } from "@/components/work/new-run-form";
import { providerMode } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function NewRunPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-8 md:px-8">
      <Link href="/work" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={15} /> Runs
      </Link>
      <div className="mt-4">
        <SectionLabel>New run</SectionLabel>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">Start a minion</h1>
        <p className="mt-1 text-sm text-muted">
          A minion plans, edits source on a sandbox, and must clear every gate before it asks to ship.
        </p>
      </div>
      <NewRunForm provider={providerMode()} />
    </div>
  );
}
