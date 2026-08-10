import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModel } from "ai";

/**
 * A deterministic, offline stand-in for a real LLM, plugged in through the same
 * getModel() seam the real providers use. Its entire purpose is to let the FULL
 * minion engine — real Workspace, real git, real test runner, real gates
 * (regression, mutation, judge, risk, confidence) — run end to end with no
 * network and no API key, so the web application's orchestration can be proven
 * in CI and in Playwright. The ONLY thing it replaces is the model's cognition;
 * everything the engine does around it is real. Flipping LLM_PROVIDER from
 * "fake" to "anthropic"/"openai" swaps this for a live model and nothing else
 * changes.
 *
 * It is scripted against the committed practice corpus in sandbox/:
 *   - TICKET-002 (add a clamp helper): writes the correct source fix, so the
 *     run ships — exercising the approve → artifact → completed path.
 *   - TICKET-004 (make add(2,2) === 5): declines without touching source, so the
 *     run is a correct refusal — exercising the declined path.
 * Any other ticket is declined (no change), which is the safe default.
 *
 * This provider must never be reachable by accident in production: getModel only
 * returns it when the provider is explicitly "fake".
 */

/** The clamp fix for TICKET-002: sandbox/src/utils.js with a correct clamp appended. */
const UTILS_WITH_CLAMP = `// A tiny utility library — the codebase the minions practice on.
// Some functions are intentionally buggy or incomplete; each gap maps to a
// seeded ticket in ../tickets.json. The test suite (../test/utils.test.js) is
// the acceptance gate a minion's fix has to clear.

export function add(a, b) {
  return a + b;
}

export function slugify(input) {
  // BUG (TICKET-001): a run of consecutive spaces becomes multiple dashes
  // instead of one.
  return String(input).trim().toLowerCase().replace(/ /g, "-");
}

export function parseQueryString(qs) {
  const out = {};
  for (const pair of String(qs).replace(/^\\?/, "").split("&")) {
    if (!pair) continue;
    const [key, value] = pair.split("=");
    // BUG (TICKET-003): values aren't URL-decoded, and a key with no "="
    // gets \`undefined\` instead of an empty string.
    out[key] = value;
  }
  return out;
}

// TICKET-002: a \`clamp(n, min, max)\` helper is requested but doesn't exist yet.
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
`;

type Phase = "plan" | "implement" | "judge";

function classify(options: unknown): { phase: Phase; wantsClamp: boolean; hasWritten: boolean } {
  const opts = options as {
    prompt?: unknown;
    responseFormat?: { type?: string };
    system?: string;
  };
  const serialized = JSON.stringify(opts.prompt ?? "");
  const isJudge = opts.responseFormat?.type === "json";
  const isPlan = serialized.includes("planning only") || serialized.includes("write your plan");
  const phase: Phase = isJudge ? "judge" : isPlan ? "plan" : "implement";
  // Recognize a clamp request from the prompt text, whether it arrives as the
  // sandbox ticket (TICKET-002) or a GitHub issue ("Add a clamp(n, min, max)…").
  const wantsClamp =
    /clamp/i.test(serialized) && /\bmin\b/i.test(serialized) && /\bmax\b/i.test(serialized);
  const hasWritten = serialized.includes("tool-result");
  return { phase, wantsClamp, hasWritten };
}

const USAGE = { inputTokens: 20, outputTokens: 10, totalTokens: 30 };

export function createFakeModel(): LanguageModel {
  // The mock's doGenerate result type is the internal LanguageModelV3 shape; we
  // build valid results but keep the config loosely typed at the boundary rather
  // than importing provider-internal types just to satisfy the compiler.
  return new MockLanguageModelV3({
    doGenerate: async (options: unknown): Promise<any> => {
      const { phase, wantsClamp, hasWritten } = classify(options);

      if (phase === "judge") {
        // The judge is only reached after a real change cleared the hard gates;
        // approve it. (Structured output is returned as JSON text.)
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                genuinelyResolves: true,
                reason: "Minimal, correct source change that resolves the ticket.",
              }),
            },
          ],
          finishReason: "stop" as const,
          usage: USAGE,
          warnings: [],
        };
      }

      if (phase === "plan") {
        const text = wantsClamp
          ? "Add a clamp(n, min, max) helper to src/utils.js that returns Math.min(max, Math.max(min, n)). No other files need to change."
          : "Study the ticket; if it cannot be satisfied without breaking a passing test, decline rather than force a change.";
        return {
          content: [{ type: "text" as const, text }],
          finishReason: "stop" as const,
          usage: USAGE,
          warnings: [],
        };
      }

      // implement phase
      if (wantsClamp && !hasWritten) {
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: "fake-write-1",
              toolName: "write_file",
              input: JSON.stringify({ path: "src/utils.js", content: UTILS_WITH_CLAMP }),
            },
          ],
          finishReason: "tool-calls" as const,
          usage: USAGE,
          warnings: [],
        };
      }

      const text = wantsClamp
        ? "Added the clamp helper; the ticket's test now passes with no regressions."
        : "Declining: this ticket cannot be satisfied without breaking a previously-passing test, so no source change was made.";
      return {
        content: [{ type: "text" as const, text }],
        finishReason: "stop" as const,
        usage: USAGE,
        warnings: [],
      };
    },
  }) as unknown as LanguageModel;
}
