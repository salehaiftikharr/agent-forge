/**
 * Forge CLI — an agent that builds agents.
 *
 *   forge build "<description>"   design + save a new agent from plain English
 *   forge run <name> "<input>"    run a saved agent on one input
 *   forge test <name>             run the agent's auto-generated tests (LLM judge)
 *   forge list                    list built agents
 *   forge show <name>             print an agent's spec
 *
 * Flags: --provider anthropic|openai  (overrides LLM_PROVIDER)
 */
import { loadEnv } from "./env";
import { modelLabel } from "./model";
import { buildAgent } from "./builder";
import { runAgent } from "./runtime";
import { testAgent } from "./judge";
import { saveSpec, loadSpec, listSpecs } from "./spec";

loadEnv();

interface ParsedArgs {
  positionals: string[];
  provider?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  let provider: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--provider") provider = argv[++i];
    else positionals.push(argv[i]);
  }
  return { positionals, provider };
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { positionals, provider } = parseArgs(process.argv.slice(2));
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
      console.log(`\nNext: forge test ${spec.name}`);
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
          "Agent Forge — an agent that builds agents.",
          "",
          '  forge build "<description>"   design + save a new agent',
          '  forge run <name> "<input>"    run a saved agent',
          "  forge test <name>             run its auto-generated tests",
          "  forge list                    list built agents",
          "  forge show <name>             print an agent's spec",
          "",
          "  --provider anthropic|openai   override the configured provider",
        ].join("\n"),
      );
      if (command && command !== "help") process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
