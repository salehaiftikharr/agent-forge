import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SectionLabel } from "@/components/ui";
import { GithubTaskForm } from "@/components/work/github-task-form";
import { providerMode, githubMode } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function GithubTaskPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-8 md:px-8">
      <Link href="/work" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={15} /> Runs
      </Link>
      <div className="mt-4">
        <SectionLabel>New GitHub task</SectionLabel>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">Delegate a real ticket</h1>
        <p className="mt-1 text-sm text-muted">
          Point Agent Forge at a repository and issue. It inspects the code, implements the smallest
          correct fix, runs the repo&apos;s checks, and stops for your approval before opening a draft PR.
        </p>
      </div>
      <GithubTaskForm githubMode={githubMode()} provider={providerMode()} />
    </div>
  );
}
