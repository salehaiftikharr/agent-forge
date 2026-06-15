import { z } from "zod";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";

/**
 * An AgentSpec is the whole artifact Forge produces: everything needed to run a
 * task-specific agent (its persona, its tools) PLUS the tests that say what
 * "working" means for it. The spec is the compile target — `forge build` emits
 * one, `forge run`/`forge test` consume one.
 */
export const agentSpecSchema = z.object({
  name: z
    .string()
    .regex(
      /^[a-z][a-z0-9-]*$/,
      "kebab-case identifier, e.g. weather-reporter",
    )
    .describe("Short kebab-case identifier used as the filename and run handle."),
  description: z
    .string()
    .describe("One sentence on what this agent does, for humans."),
  systemPrompt: z
    .string()
    .describe(
      "The system prompt that defines the agent's behavior. Be specific about its job, how to use its tools, and when to refuse or stop.",
    ),
  tools: z
    .array(z.string())
    .describe(
      "Names of tools this agent is granted, drawn ONLY from Forge's tool registry.",
    ),
  maxSteps: z
    .number()
    .int()
    .min(1)
    .max(20)
    .describe(
      "Maximum tool-call steps per run before the loop stops (usually 4-8).",
    ),
  testCases: z
    .array(
      z.object({
        input: z.string().describe("A realistic user request for this agent."),
        expectation: z
          .string()
          .describe(
            "In plain language, what a correct answer must contain or do — the bar an LLM judge grades against.",
          ),
      }),
    )
    .min(2)
    .describe(
      "Auto-generated acceptance tests. Each one is a real input plus the bar its output must clear.",
    ),
});

export type AgentSpec = z.infer<typeof agentSpecSchema>;

const AGENTS_DIR = path.join(process.cwd(), "agents");

function specPath(name: string): string {
  return path.join(AGENTS_DIR, `${name}.json`);
}

export function saveSpec(spec: AgentSpec): string {
  mkdirSync(AGENTS_DIR, { recursive: true });
  const file = specPath(spec.name);
  writeFileSync(file, JSON.stringify(spec, null, 2) + "\n");
  return file;
}

export function loadSpec(name: string): AgentSpec {
  const file = specPath(name);
  if (!existsSync(file)) {
    throw new Error(
      `No agent named "${name}". Run \`forge list\` to see what's built.`,
    );
  }
  // Re-validate on load: a hand-edited spec should fail loudly, not at runtime.
  return agentSpecSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

export function listSpecs(): AgentSpec[] {
  if (!existsSync(AGENTS_DIR)) return [];
  return readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".receipt.json"))
    .map((f) => {
      try {
        return agentSpecSchema.parse(
          JSON.parse(readFileSync(path.join(AGENTS_DIR, f), "utf8")),
        );
      } catch {
        return null;
      }
    })
    .filter((s): s is AgentSpec => s !== null);
}

// ---- Receipts: the build → test → repair record an agent ships with ----

export interface ReceiptRound {
  /** 0 = the initial build; 1.. = repair rounds. */
  round: number;
  /** What the repair changed this round (absent on round 0). */
  changeSummary?: string;
  passed: number;
  total: number;
  failingInputs: string[];
}

export interface Receipt {
  name: string;
  description: string;
  model: string;
  /** "passing" = every test cleared; "incomplete" = hit the round cap still failing. */
  status: "passing" | "incomplete";
  finalPassed: number;
  finalTotal: number;
  rounds: ReceiptRound[];
}

function receiptPath(name: string): string {
  return path.join(AGENTS_DIR, `${name}.receipt.json`);
}

export function saveReceipt(receipt: Receipt): string {
  mkdirSync(AGENTS_DIR, { recursive: true });
  const file = receiptPath(receipt.name);
  writeFileSync(file, JSON.stringify(receipt, null, 2) + "\n");
  return file;
}

export function loadReceipt(name: string): Receipt {
  const file = receiptPath(name);
  if (!existsSync(file)) {
    throw new Error(
      `No receipt for "${name}". Run \`forge refine ${name}\` to produce one.`,
    );
  }
  return JSON.parse(readFileSync(file, "utf8")) as Receipt;
}
