"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Starts a real run. The practice repo is the committed sandbox corpus; each
 * preset is a real seeded ticket. The first two are deterministic under the
 * offline provider (one ships, one is correctly declined); the rest need a live
 * provider to attempt. The form never fakes success — it creates the run and
 * hands off to the live run view.
 */
const PRESETS = [
  { id: "TICKET-002", title: "Add a clamp(n, min, max) helper", note: "Ships under any provider.", deterministic: true },
  { id: "TICKET-004", title: "Make add(2, 2) equal 5", note: "Correctly declined — it would regress a passing test.", deterministic: true },
  { id: "TICKET-001", title: "slugify should collapse repeated spaces", note: "Needs a live provider to attempt.", deterministic: false },
  { id: "TICKET-003", title: "parseQueryString should decode values", note: "Needs a live provider to attempt.", deterministic: false },
];

export function NewRunForm({ provider }: { provider: string }) {
  const router = useRouter();
  const [ticketId, setTicketId] = useState(PRESETS[0].id);
  const [goal, setGoal] = useState(PRESETS[0].title);
  const [context, setContext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFake = provider === "fake";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // guard double-submit
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, goal, context: context || undefined }),
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

  return (
    <form onSubmit={submit} className="mt-6 space-y-6">
      <fieldset>
        <legend className="text-sm font-medium text-ink">Choose a ticket</legend>
        <p className="mt-1 text-xs text-muted">
          The minion works on a sandboxed copy of the practice repo.
          {isFake && " The offline provider can attempt the first two deterministically."}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Ticket">
          {PRESETS.map((p) => {
            const selected = ticketId === p.id;
            const dim = isFake && !p.deterministic;
            return (
              <label
                key={p.id}
                className={cn(
                  "cursor-pointer",
                  dim && "opacity-60",
                )}
              >
                <input
                  type="radio"
                  name="ticket"
                  value={p.id}
                  checked={selected}
                  onChange={() => {
                    setTicketId(p.id);
                    setGoal(p.title);
                  }}
                  className="sr-only"
                />
                <Card
                  className={cn(
                    "h-full p-4 transition-colors",
                    selected ? "border-[var(--forge-accent-strong)] bg-surface-2" : "hover:bg-surface-2",
                  )}
                >
                  <p className="text-sm font-medium text-ink">{p.title}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted">{p.id}</p>
                  <p className="mt-2 text-xs text-muted">{p.note}</p>
                </Card>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="goal" className="text-sm font-medium text-ink">
          Goal
        </label>
        <input
          id="goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          required
          minLength={3}
          className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-[var(--forge-accent-strong)]"
        />
      </div>

      <div>
        <label htmlFor="context" className="text-sm font-medium text-ink">
          Context <span className="text-muted">(optional)</span>
        </label>
        <textarea
          id="context"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={3}
          className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-[var(--forge-accent-strong)]"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--forge-failed-ink)" }}>
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Starting…" : "Start run"}
        </Button>
        <Button href="/work" variant="ghost">
          Cancel
        </Button>
      </div>
    </form>
  );
}
