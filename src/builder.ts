import { generateObject } from "ai";
import { getModel } from "./model";
import { agentSpecSchema, type AgentSpec } from "./spec";
import { toolCatalog, toolNames } from "./tools/registry";

/**
 * The builder: a plain-English description in, a validated AgentSpec out. This
 * is the "compiler" — one structured-output call where the model designs the
 * agent (system prompt + tools + tests). `generateObject` forces the model to
 * fill the schema, so we get a typed spec, not prose we'd have to parse.
 */
function builderSystem(): string {
  return `You design small, reliable agents that run on the Claude/GPT tool-use loop. Given a plain-English description of a task to automate, produce an AgentSpec.

Available tools (grant ONLY these, by exact name):
${toolCatalog()}

Rules:
- name: short kebab-case, derived from the task (e.g. "weather-reporter").
- tools: include only the tools the task actually needs. If a tool isn't listed above, the agent cannot have it — design within this set, and if the task can't be done with these tools, choose the closest useful subset and make the system prompt honest about the limits.
- systemPrompt: write the agent's operating instructions. State its single job, how to use each granted tool, how to handle missing data, and when to refuse or stop. Tell it to ground answers in tool results rather than guessing.
- maxSteps: enough tool calls to finish (usually 4-8).
- testCases: write 2-4 realistic inputs. For each, the expectation is the bar a grader will hold the output to — make it concrete and checkable (a value, a fact, a refusal), not "a good answer". Include at least one edge case or a request the agent should decline.`;
}

export interface BuildResult {
  spec: AgentSpec;
  /** Tool names the model invented that aren't in the registry (dropped). */
  droppedTools: string[];
}

export async function buildAgent(
  description: string,
  opts: { provider?: string } = {},
): Promise<BuildResult> {
  const { object } = await generateObject({
    model: getModel(opts.provider),
    schema: agentSpecSchema,
    system: builderSystem(),
    prompt: description,
  });

  // Defense in depth: even with the catalog in the prompt, drop any tool the
  // model named that doesn't exist, so a built spec is always runnable.
  const droppedTools = object.tools.filter((t) => !toolNames.includes(t));
  const spec: AgentSpec = {
    ...object,
    tools: object.tools.filter((t) => toolNames.includes(t)),
  };

  return { spec, droppedTools };
}
