import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { runMinion, type Ticket, type MinionReceipt } from "./minion";

/**
 * The fleet: minions working continuously, on their own. It watches the ticket
 * list and, whenever a ticket is new or its text changed, dispatches a minion
 * to close it — then idles until more work appears. A ledger records what's
 * been handled (keyed by a hash of the ticket text), so the fleet never redoes
 * work and re-runs a ticket only if it actually changed.
 */
const TICKETS_FILE = path.join(process.cwd(), "sandbox", "tickets.json");
const LEDGER_FILE = path.join(process.cwd(), "minion-receipts", "ledger.json");

interface LedgerEntry {
  hash: string;
  status: MinionReceipt["status"];
  reason: string;
  at: string;
}
type Ledger = Record<string, LedgerEntry>;

function ticketHash(t: Ticket): string {
  return createHash("sha1")
    .update(`${t.id}\n${t.title}\n${t.body}`)
    .digest("hex")
    .slice(0, 12);
}

function loadTickets(): Ticket[] {
  return JSON.parse(readFileSync(TICKETS_FILE, "utf8")) as Ticket[];
}

function loadLedger(): Ledger {
  try {
    return JSON.parse(readFileSync(LEDGER_FILE, "utf8")) as Ledger;
  } catch {
    return {};
  }
}

function saveLedger(ledger: Ledger): void {
  mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
  writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2) + "\n");
}

export interface FleetOptions {
  provider?: string;
  intervalMs?: number;
  once?: boolean;
  onLog?: (message: string) => void;
}

/** Dispatch a minion for every ticket that's new or changed since the ledger. */
async function processOpen(opts: FleetOptions): Promise<MinionReceipt[]> {
  const log = opts.onLog ?? (() => {});
  const tickets = loadTickets();
  const ledger = loadLedger();
  const open = tickets.filter((t) => ledger[t.id]?.hash !== ticketHash(t));

  const handled: MinionReceipt[] = [];
  for (const ticket of open) {
    log(`▶ picked up [${ticket.id}] ${ticket.title}`);
    const receipt = await runMinion(ticket, { provider: opts.provider });
    ledger[ticket.id] = {
      hash: ticketHash(ticket),
      status: receipt.status,
      reason: receipt.reason,
      at: new Date().toISOString(),
    };
    saveLedger(ledger);
    const mark =
      receipt.status === "shipped"
        ? "✓ shipped"
        : receipt.status === "declined"
          ? "⊘ declined"
          : "✗ error";
    log(`  ${mark} [${ticket.id}] — ${receipt.reason}`);
    handled.push(receipt);
  }
  return handled;
}

/**
 * Run the fleet. With `once`, drain the current open tickets and exit. Without
 * it, watch forever: drain, idle, re-check on an interval, pick up anything
 * new — minions doing tickets on their own, all day.
 */
export async function runFleet(opts: FleetOptions): Promise<void> {
  const log = opts.onLog ?? ((m: string) => console.log(m));
  const interval = opts.intervalMs ?? 15_000;

  if (opts.once) {
    const handled = await processOpen(opts);
    log(
      handled.length
        ? `— handled ${handled.length} ticket(s) —`
        : "no open tickets — everything is handled.",
    );
    return;
  }

  log(
    `fleet online — watching ${path.relative(process.cwd(), TICKETS_FILE)} every ${interval / 1000}s (Ctrl-C to stop)`,
  );
  for (;;) {
    const handled = await processOpen(opts);
    if (!handled.length) log("idle — all tickets handled, watching for new ones…");
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
