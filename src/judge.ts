import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "./model";
import { runAgent } from "./runtime";
import type { AgentSpec } from "./spec";

/**
 * The judge closes the loop: every agent Forge builds ships with its own tests,
 * and `forge test` runs them. Grading is on the AGENT'S behavior, not on exact
 * strings — each test states a plain-language bar, and an independent LLM judge
 * decides pass/fail against it. (This is the same "data/behavior is the ground
 * truth, not text" stance as the analytics-chat-assistant eval suite, applied
 * to open-ended agent output where a separate judge is the honest tool.)
 */
const verdictSchema = z.object({
  pass: z.boolean(),
  reason: z.string().describe("One sentence justifying the verdict."),
});

export interface CaseResult {
  input: string;
  expectation: string;
  pass: boolean;
  reason: string;
  output: string;
  toolsUsed: string[];
  error?: string;
}

export interface TestReport {
  name: string;
  passed: number;
  total: number;
  cases: CaseResult[];
}

async function judge(
  expectation: string,
  input: string,
  output: string,
  provider?: string,
): Promise<{ pass: boolean; reason: string }> {
  const { object } = await generateObject({
    model: getModel(provider),
    schema: verdictSchema,
    system:
      "You are a strict grader. Decide whether an agent's output satisfies the stated expectation. Judge only what the expectation asks for. If the output is plausible but does not actually meet the bar (wrong value, hedged guess, ignored the refusal it should have made), fail it.",
    prompt: `Task input:\n${input}\n\nExpectation (the bar to clear):\n${expectation}\n\nAgent output:\n${output}\n\nDoes the output satisfy the expectation?`,
  });
  return object;
}

export async function testAgent(
  spec: AgentSpec,
  opts: { provider?: string } = {},
): Promise<TestReport> {
  const cases: CaseResult[] = [];

  for (const testCase of spec.testCases) {
    try {
      const run = await runAgent(spec, testCase.input, opts);
      const verdict = await judge(
        testCase.expectation,
        testCase.input,
        run.text,
        opts.provider,
      );
      cases.push({
        input: testCase.input,
        expectation: testCase.expectation,
        pass: verdict.pass,
        reason: verdict.reason,
        output: run.text,
        toolsUsed: run.toolCalls.map((c) => c.tool),
      });
    } catch (error) {
      cases.push({
        input: testCase.input,
        expectation: testCase.expectation,
        pass: false,
        reason: "Run errored before it could be judged.",
        output: "",
        toolsUsed: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    name: spec.name,
    passed: cases.filter((c) => c.pass).length,
    total: cases.length,
    cases,
  };
}
