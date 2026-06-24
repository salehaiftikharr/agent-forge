import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "./model";
import { agentSpecSchema, type AgentSpec } from "./spec";
import { toolCatalog, toolNames } from "./tools/registry";
import { tracedGenerate } from "./trace";
import { lessonsPrompt } from "./memory";
import type { CaseResult } from "./judge";

/**
 * The repair step: given an agent that failed some of its own tests, produce a
 * REVISED spec that fixes the failures. This is the heart of the self-repair
 * loop — an agent (the builder) improving an agent, with the failing tests as
 * the signal for what to change.
 */
const repairSchema = z.object({
  changeSummary: z
    .string()
    .describe("One sentence: what you changed and why."),
  spec: agentSpecSchema,
});

function repairSystem(): string {
  return `You improve an existing agent that failed some of its own acceptance tests. You are given the current AgentSpec and the failing cases — each with the input, the bar it had to clear, what the agent actually output, and the grader's reason for failing it.

Available tools (grant ONLY these, by exact name):
${toolCatalog()}

Produce a REVISED AgentSpec that fixes the failures:
- Keep what already works. Do not break cases that were passing.
- The fix is almost always a sharper systemPrompt — clearer instructions, explicit handling of the failing input, an added rule to cite / ground in tool results / refuse, whatever the bar demands. Editing the prompt is the lever, not the tests.
- Do NOT weaken, delete, or reword a test just to make it pass. The tests are the contract.
- Keep the same name. Keep tools within the registry above.
- changeSummary: one sentence on what you changed and why.`;
}

export interface RepairResult {
  spec: AgentSpec;
  changeSummary: string;
  droppedTools: string[];
}

export async function repairAgent(
  spec: AgentSpec,
  failures: CaseResult[],
  opts: { provider?: string } = {},
): Promise<RepairResult> {
  const failureBlock = failures
    .map(
      (f, i) =>
        `Failure ${i + 1}:\n  input: ${f.input}\n  bar: ${f.expectation}\n  agent output: ${f.output || "(none)"}\n  why it failed: ${f.reason}`,
    )
    .join("\n\n");

  const failureQuery = failures.map((f) => `${f.input} ${f.reason}`).join(" ");
  const { object } = await tracedGenerate("repair", "repair", () =>
    generateObject({
      model: getModel(opts.provider),
      schema: repairSchema,
      // Recall how similar failures were fixed before, when relevant.
      system: repairSystem() + lessonsPrompt(failureQuery),
      prompt: `Current AgentSpec:\n${JSON.stringify(spec, null, 2)}\n\nFailing cases:\n${failureBlock}\n\nRevise the spec so these pass while keeping the rest intact.`,
    }),
  );

  const droppedTools = object.spec.tools.filter((t) => !toolNames.includes(t));
  const revised: AgentSpec = {
    ...object.spec,
    name: spec.name, // never let the identifier drift mid-repair
    tools: object.spec.tools.filter((t) => toolNames.includes(t)),
  };

  return { spec: revised, changeSummary: object.changeSummary, droppedTools };
}
