"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button } from "@/components/ui";

/**
 * Start a real GitHub coding task: a repository (owner/name or a pasted URL), an
 * optional issue, and a plain-language goal. Agent Forge works an isolated
 * checkout, runs the repo's checks, and stops for approval before opening a
 * draft PR. The composer never asks for a token — the GitHub connection lives in
 * workspace settings and its mode is shown honestly below.
 */
export function GithubTaskForm({ githubMode, provider }: { githubMode: string; provider: string }) {
  const router = useRouter();
  const [repo, setRepo] = useState("");
  const [issue, setIssue] = useState("");
  const [goal, setGoal] = useState("");
  const [base, setBase] = useState("");
  const [openPr, setOpenPr] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // guard double-submit
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: repo.trim(),
          issueNumber: issue.trim() ? Number(issue.trim()) : undefined,
          goal: goal.trim(),
          openPr,
          baseBranch: base.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const { run } = await res.json();
      router.push(`/work/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  const fieldCls =
    "mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-[var(--forge-accent-strong)]";

  return (
    <form onSubmit={submit} className="mt-6 space-y-6">
      <Card className="p-4">
        <p className="text-xs text-muted">
          GitHub connection: <span className="font-mono">{githubMode}</span> · model provider{" "}
          <span className="font-mono">{provider}</span>.
          {githubMode === "fake" &&
            " In this mode the run works the practice checkout and produces a clearly-labelled fake PR — no real repository is touched."}
        </p>
      </Card>

      <div>
        <label htmlFor="repo" className="text-sm font-medium text-ink">
          Repository
        </label>
        <input
          id="repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          required
          placeholder="owner/name or https://github.com/owner/name/issues/42"
          className={fieldCls}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="issue" className="text-sm font-medium text-ink">
            Issue number <span className="text-muted">(optional)</span>
          </label>
          <input id="issue" value={issue} onChange={(e) => setIssue(e.target.value)} inputMode="numeric" placeholder="42" className={fieldCls} />
        </div>
        <div>
          <label htmlFor="base" className="text-sm font-medium text-ink">
            Base branch <span className="text-muted">(optional)</span>
          </label>
          <input id="base" value={base} onChange={(e) => setBase(e.target.value)} placeholder="main" className={fieldCls} />
        </div>
      </div>

      <div>
        <label htmlFor="goal" className="text-sm font-medium text-ink">
          What should Agent Forge do?
        </label>
        <textarea
          id="goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          required
          minLength={3}
          rows={3}
          placeholder="Investigate issue #42 and implement the smallest correct fix."
          className={fieldCls}
        />
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-ink">After verification</legend>
        <div className="mt-2 space-y-2" role="radiogroup" aria-label="PR behavior">
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name="pr" checked={openPr} onChange={() => setOpenPr(true)} className="mt-1" />
            <span>
              <span className="font-medium text-ink">Open a draft PR after I approve</span>
              <span className="block text-xs text-muted">Stops at the approval gate before any push.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name="pr" checked={!openPr} onChange={() => setOpenPr(false)} className="mt-1" />
            <span>
              <span className="font-medium text-ink">Prepare only (no PR)</span>
              <span className="block text-xs text-muted">Produce the verified diff; do not push anything.</span>
            </span>
          </label>
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--forge-failed-ink)" }}>
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Starting…" : "Start task"}
        </Button>
        <Button href="/work" variant="ghost">
          Cancel
        </Button>
      </div>
    </form>
  );
}
