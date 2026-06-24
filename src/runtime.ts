import { generateText, stepCountIs } from "ai";
import { getModel } from "./model";
import { resolveTools } from "./tools/registry";
import { tracedGenerate } from "./trace";
import type { AgentSpec } from "./spec";

export interface ToolCallTrace {
  tool: string;
  input: unknown;
}

export interface RunResult {
  text: string;
  toolCalls: ToolCallTrace[];
  steps: number;
}

/**
 * Run a built agent against one input. This is the actual agent loop: the model
 * gets the spec's system prompt and granted tools, and the AI SDK iterates
 * (call tool -> feed result back -> continue) until the model answers or hits
 * the step cap. The tool-call trace is what makes runs auditable.
 */
export async function runAgent(
  spec: AgentSpec,
  input: string,
  opts: { provider?: string } = {},
): Promise<RunResult> {
  const { tools } = resolveTools(spec.tools);

  const result = await tracedGenerate(`run:${spec.name}`, "run", () =>
    generateText({
      model: getModel(opts.provider),
      system: spec.systemPrompt,
      prompt: input,
      tools,
      stopWhen: stepCountIs(spec.maxSteps),
    }),
  );

  const toolCalls: ToolCallTrace[] = result.steps.flatMap((step) =>
    (step.toolCalls ?? []).map((call) => ({
      tool: call.toolName,
      input: call.input,
    })),
  );

  return { text: result.text, toolCalls, steps: result.steps.length };
}
