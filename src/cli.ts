/**
 * Forge CLI — an agent that builds agents.
 *
 *   forge build "<description>"   design + save a new agent from plain English
 *                                 (add --repair to test & auto-fix to passing)
 *   forge refine <name>           test a saved agent and repair it until it passes
 *   forge run <name> "<input>"    run a saved agent on one input
 *   forge test <name>             run the agent's auto-generated tests (LLM judge)
 *   forge receipt <name>          print the build → test → repair record
 *   forge list                    list built agents
 *   forge show <name>             print an agent's spec
 *
 * Flags: --provider anthropic|openai  (overrides LLM_PROVIDER)
 *        --repair                      (build only) run the self-repair loop after building
 *        --rounds <n>                  max repair rounds (default 3)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "./env";
import { modelLabel } from "./model";
import { buildAgent } from "./builder";
import { runAgent } from "./runtime";
import { testAgent } from "./judge";
import { refineAgent } from "./refine";
import { runMinion, type Ticket, type MinionReceipt } from "./minion/minion";
import { runFleet } from "./minion/fleet";
import { evaluateMinions } from "./minion/evaluate";
import { runMinionPR } from "./minion/github";
import {
  saveSpec,
  loadSpec,
  listSpecs,
  saveReceipt,
  loadReceipt,
  type Receipt,
} from "./spec";

function loadTickets(): Ticket[] {
  const file = path.join(process.cwd(), "sandbox", "tickets.json");
  return JSON.parse(readFileSync(file, "utf8")) as Ticket[];
}

function printMinionReceipt(r: MinionReceipt): void {
  const mark =
    r.status === "shipped" ? "✓ shipped" : r.status === "declined" ? "⊘ declined" : "✗ error";
  console.log(
    `${mark}  [${r.ticketId}] ${r.title}  (${r.finalTests.passed}/${r.finalTests.total} tests) via ${r.model}`,
  );
  console.log(`  ${r.reason}`);
  if (r.status === "shipped") {
    console.log(`  branch: ${r.branch} · ${r.steps} steps, ${r.toolCalls} tool calls`);
  }
}

loadEnv();

interface ParsedArgs {
  positionals: string[];
  provider?: string;
  repair: boolean;
  rounds?: number;
  once: boolean;
  interval?: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  let provider: string | undefined;
  let rounds: number | undefined;
  let interval: number | undefined;
  let repair = false;
  let once = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--provider") provider = argv[++i];
    else if (arg === "--repair") repair = true;
    else if (arg === "--rounds") rounds = Number(argv[++i]);
    else if (arg === "--once") once = true;
    else if (arg === "--interval") interval = Number(argv[++i]);
    else positionals.push(arg);
  }
  return { positionals, provider, repair, rounds, once, interval };
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function printReceipt(r: Receipt): void {
  const status = r.status === "passing" ? "✓ passing" : "⚠ incomplete";
  console.log(
    `Receipt — "${r.name}": ${status} (${r.finalPassed}/${r.finalTotal}) via ${r.model}`,
  );
  for (const round of r.rounds) {
    const label = round.round === 0 ? "build" : `repair ${round.round}`;
    console.log(`  ${label.padEnd(10)} ${round.passed}/${round.total}`);
    if (round.changeSummary) console.log(`     ↳ ${round.changeSummary}`);
  }
}

async function main(): Promise<void> {
  const { positionals, provider, repair, rounds, once, interval } = parseArgs(
    process.argv.slice(2),
  );
  const [command, ...rest] = positionals;

  switch (command) {
    case "build": {
      const description = rest.join(" ").trim();
      if (!description) fail('Usage: forge build "<what the agent should do>"');
      console.log(`Designing an agent with ${modelLabel(provider)}…\n`);
      const { spec, droppedTools } = await buildAgent(description, { provider });
      const file = saveSpec(spec);
      console.log(`✓ Built "${spec.name}"`);
      console.log(`  ${spec.description}`);
      console.log(`  tools: ${spec.tools.join(", ") || "(none)"}`);
      console.log(`  tests: ${spec.testCases.length}`);
      if (droppedTools.length) {
        console.log(`  ⚠ dropped unknown tools: ${droppedTools.join(", ")}`);
      }
      console.log(`  saved: ${file}`);

      if (repair) {
        console.log(`\nProving it works (test → repair → test)…\n`);
        const result = await refineAgent(spec, {
          provider,
          maxRounds: rounds,
          onProgress: (m) => console.log(`  ${m}`),
        });
        saveSpec(result.spec);
        saveReceipt(result.receipt);
        console.log("");
        printReceipt(result.receipt);
      } else {
        console.log(
          `\nNext: forge refine ${spec.name}   (test it and auto-fix failures)`,
        );
      }
      break;
    }

    case "refine": {
      const [name] = rest;
      if (!name) fail("Usage: forge refine <name> [--rounds N]");
      const spec = loadSpec(name);
      console.log(
        `Refining "${name}" with ${modelLabel(provider)} — the build is fixed; iterating the agent to a passing bar…\n`,
      );
      const result = await refineAgent(spec, {
        provider,
        maxRounds: rounds,
        onProgress: (m) => console.log(`  ${m}`),
      });
      saveSpec(result.spec);
      saveReceipt(result.receipt);
      console.log("");
      printReceipt(result.receipt);
      process.exitCode = result.receipt.status === "passing" ? 0 : 1;
      break;
    }

    case "receipt": {
      const [name] = rest;
      if (!name) fail("Usage: forge receipt <name>");
      printReceipt(loadReceipt(name));
      break;
    }

    case "tickets": {
      const tickets = loadTickets();
      for (const t of tickets) {
        console.log(`${t.id.padEnd(12)} ${t.title}`);
      }
      console.log(`\n${tickets.length} ticket(s) in the sandbox.`);
      break;
    }

    case "minion": {
      const [target] = rest;
      if (!target) fail('Usage: forge minion <TICKET-ID | all>');
      const tickets = loadTickets();
      const queue =
        target.toLowerCase() === "all"
          ? tickets
          : tickets.filter((t) => t.id.toLowerCase() === target.toLowerCase());
      if (!queue.length) fail(`No ticket "${target}". Try: forge tickets`);

      const receipts: MinionReceipt[] = [];
      for (const ticket of queue) {
        console.log(`\n▶ [${ticket.id}] ${ticket.title}`);
        const receipt = await runMinion(ticket, {
          provider,
          onProgress: (m) => console.log(`  ${m}`),
        });
        console.log("");
        printMinionReceipt(receipt);
        receipts.push(receipt);
      }

      if (receipts.length > 1) {
        const shipped = receipts.filter((r) => r.status === "shipped").length;
        const declined = receipts.filter((r) => r.status === "declined").length;
        console.log(
          `\n— fleet done: ${shipped} shipped, ${declined} declined, ${receipts.length} total —`,
        );
      }
      break;
    }

    case "fleet": {
      await runFleet({
        provider,
        once,
        intervalMs: interval ? interval * 1000 : undefined,
        onLog: (m) => console.log(m),
      });
      break;
    }

    case "pr": {
      const [repo, issueArg] = rest;
      const issueNumber = Number(issueArg);
      if (!repo || !issueNumber) {
        fail("Usage: forge pr <owner/repo> <issue-number>");
      }
      console.log(
        `Minion on ${repo}#${issueNumber} with ${modelLabel(provider)}…\n`,
      );
      const receipt = await runMinionPR(repo, issueNumber, {
        provider,
        onProgress: (m) => console.log(`  ${m}`),
      });
      console.log("");
      if (receipt.status === "shipped" && receipt.prUrl) {
        console.log(`✓ opened a pull request: ${receipt.prUrl}`);
        console.log(`  ${receipt.reason}`);
      } else if (receipt.status === "shipped") {
        console.log(`✓ shipped (no PR URL captured)`);
      } else {
        console.log(`⊘ ${receipt.status} — ${receipt.reason}`);
        console.log("  No PR opened.");
      }
      break;
    }

    case "eval": {
      console.log(
        `Verification eval with ${modelLabel(provider)} — does the gate ship the right work, and never the wrong work?\n`,
      );
      const report = await evaluateMinions({
        provider,
        onLog: (m) => console.log(`  ${m}`),
      });
      console.log("");
      for (const c of report.cases) {
        const mark = c.correct ? "✓" : c.unsafe ? "✗ UNSAFE" : "✗";
        console.log(
          `${mark.padEnd(8)} ${c.id.padEnd(18)} expect ${c.expect.padEnd(8)} → ${c.decision}`,
        );
      }
      console.log(
        `\nAccuracy: ${report.correct}/${report.total} (${(report.accuracy * 100).toFixed(0)}%)`,
      );
      console.log(
        `Ship recall: ${report.shipRecall.correct}/${report.shipRecall.total} · Correctly declined: ${report.declinedCorrectly.correct}/${report.declinedCorrectly.total}`,
      );
      console.log(
        `Unsafe ships (shipped work that should have been declined): ${report.unsafeShips}`,
      );
      process.exitCode = report.unsafeShips > 0 ? 1 : 0;
      break;
    }

    case "run": {
      const [name, ...inputParts] = rest;
      const input = inputParts.join(" ").trim();
      if (!name || !input) fail('Usage: forge run <name> "<input>"');
      const spec = loadSpec(name);
      console.log(`Running "${name}" with ${modelLabel(provider)}…\n`);
      const result = await runAgent(spec, input, { provider });
      if (result.toolCalls.length) {
        console.log("tool calls:");
        for (const call of result.toolCalls) {
          console.log(`  → ${call.tool}(${JSON.stringify(call.input)})`);
        }
        console.log("");
      }
      console.log(result.text);
      break;
    }

    case "test": {
      const [name] = rest;
      if (!name) fail("Usage: forge test <name>");
      const spec = loadSpec(name);
      console.log(
        `Testing "${name}" — ${spec.testCases.length} case(s) with ${modelLabel(provider)}…\n`,
      );
      const report = await testAgent(spec, { provider });
      for (const c of report.cases) {
        const mark = c.pass ? "✅" : "❌";
        console.log(`${mark} ${c.input}`);
        console.log(`   bar: ${c.expectation}`);
        if (c.toolsUsed.length) console.log(`   tools: ${c.toolsUsed.join(", ")}`);
        console.log(`   verdict: ${c.reason}`);
        if (c.error) console.log(`   error: ${c.error}`);
        console.log("");
      }
      console.log(`${report.passed}/${report.total} passed`);
      process.exitCode = report.passed === report.total ? 0 : 1;
      break;
    }

    case "list": {
      const specs = listSpecs();
      if (!specs.length) {
        console.log('No agents built yet. Try: forge build "..."');
        break;
      }
      for (const s of specs) {
        console.log(`${s.name.padEnd(24)} ${s.description}`);
      }
      console.log(`\n${specs.length} agent(s).`);
      break;
    }

    case "show": {
      const [name] = rest;
      if (!name) fail("Usage: forge show <name>");
      console.log(JSON.stringify(loadSpec(name), null, 2));
      break;
    }

    default:
      console.log(
        [
          "Agent Forge — an agent that builds (and self-tests) agents.",
          "",
          '  forge build "<description>"   design + save a new agent',
          "                                  (add --repair to auto-fix to passing)",
          "  forge refine <name>           test + repair a saved agent until it passes",
          '  forge run <name> "<input>"    run a saved agent',
          "  forge test <name>             run its auto-generated tests",
          "  forge receipt <name>          print the build → test → repair record",
          "  forge list                    list built agents",
          "  forge show <name>             print an agent's spec",
          "",
          "  forge tickets                 list the sandbox tickets",
          "  forge minion <TICKET-ID|all>  set a minion to close ticket(s) autonomously",
          "  forge fleet [--once]          run minions continuously, picking up new tickets",
          "                                  (--interval <sec> sets the poll cadence)",
          "  forge eval                    measure the gate: ships the right work, never the wrong",
          "  forge pr <owner/repo> <n>     fix a real GitHub issue and open a real pull request",
          "",
          "  --provider anthropic|openai   override the configured provider",
          "  --rounds <n>                  max repair rounds (default 3)",
        ].join("\n"),
      );
      if (command && command !== "help") process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
