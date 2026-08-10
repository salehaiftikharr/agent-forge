import { getRun, eventsSince, getArtifacts, pendingApproval } from "../../../../../lib/server/store";
import { toRun, toEvent, toPendingApproval } from "../../../../../lib/server/map";
import { TERMINAL_STATES } from "../../../../../lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events over the append-only ledger. The client receives a full
 * snapshot, then ordered incremental events keyed by their monotonic seq. The
 * `id:` field is the seq, so a browser reconnection sends Last-Event-ID and we
 * resume exactly where it left off — no gaps, no repeats. The stream ends with a
 * `done` event on a terminal state so the client stops instead of reconnecting
 * forever.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const lastId = Number(req.headers.get("last-event-id") || url.searchParams.get("lastEventId") || 0);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let seq = Number.isFinite(lastId) ? lastId : 0;
      let lastState = "";

      const send = (event: string, data: unknown, eventId?: number) => {
        if (closed) return;
        const prefix = eventId != null ? `id: ${eventId}\n` : "";
        controller.enqueue(encoder.encode(`${prefix}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const run = getRun(id);
      if (!run) {
        send("error", { error: "run not found" });
        controller.close();
        return;
      }

      // Snapshot: only replay events the client has not already seen.
      const seen = eventsSince(id, seq);
      send("snapshot", {
        run: toRun(run, eventsSince(id, 0), getArtifacts(id)),
        pendingApproval: toPendingApproval(pendingApproval(id)),
      });
      if (seen.length) seq = seen[seen.length - 1].seq;
      lastState = run.state;

      let ticks = 0;
      const MAX_TICKS = 600; // ~7 min ceiling per connection; client reconnects
      while (!closed && ticks++ < MAX_TICKS) {
        for (const e of eventsSince(id, seq)) {
          send("event", toEvent(e), e.seq);
          seq = e.seq;
        }
        const cur = getRun(id);
        if (cur && cur.state !== lastState) {
          lastState = cur.state;
          send("state", {
            run: toRun(cur, [], getArtifacts(id)),
            pendingApproval: toPendingApproval(pendingApproval(id)),
          });
        }
        if (cur && TERMINAL_STATES.has(cur.state)) {
          send("done", { state: cur.state });
          break;
        }
        send("ping", { t: ticks });
        await new Promise((r) => setTimeout(r, 700));
      }
      closed = true;
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
