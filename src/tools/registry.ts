import { tool, type Tool } from "ai";
import { z } from "zod";

/**
 * The capability registry: the fixed, safe set of tools a Forge-built agent can
 * be granted. The builder picks tool NAMES from here; the runtime resolves
 * those names back to the real implementations. Keeping the set fixed and
 * read-only is the whole safety story for v1 — a built agent can fetch and
 * compute, but it can't touch the filesystem, run shell, or write anywhere.
 *
 * Each entry carries a human-facing `summary` (shown to the builder so it knows
 * what's available) and the actual AI SDK `tool`.
 */
interface RegistryEntry {
  summary: string;
  tool: Tool;
}

const MAX_FETCH_CHARS = 4000;

export const registry: Record<string, RegistryEntry> = {
  web_fetch: {
    summary: "Fetch the readable text of a web page over HTTP(S) GET.",
    tool: tool({
      description:
        "Fetch a URL and return its page text (HTML tags stripped, truncated). Read-only GET; use for looking things up on the web.",
      inputSchema: z.object({
        url: z.string().url().describe("Absolute http(s) URL to fetch."),
      }),
      execute: async ({ url }) => {
        try {
          const res = await fetch(url, {
            headers: { "user-agent": "agent-forge/0.1" },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) {
            return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
          }
          const html = await res.text();
          const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          return {
            ok: true,
            text: text.slice(0, MAX_FETCH_CHARS),
            truncated: text.length > MAX_FETCH_CHARS,
          };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),
  },

  http_get_json: {
    summary: "GET a JSON API endpoint and return the parsed body.",
    tool: tool({
      description:
        "Fetch a JSON endpoint over HTTP(S) GET and return the parsed JSON. Use for public REST/JSON APIs.",
      inputSchema: z.object({
        url: z.string().url().describe("Absolute http(s) URL returning JSON."),
      }),
      execute: async ({ url }) => {
        try {
          const res = await fetch(url, {
            headers: { accept: "application/json", "user-agent": "agent-forge/0.1" },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) {
            return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
          }
          return { ok: true, data: await res.json() };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),
  },

  calculator: {
    summary: "Evaluate an arithmetic expression (+ - * / % and parentheses).",
    tool: tool({
      description:
        "Evaluate a basic arithmetic expression and return the number. Supports + - * / % and parentheses only.",
      inputSchema: z.object({
        expression: z
          .string()
          .describe("e.g. '(1200 * 0.08) + 15'. Digits and + - * / % ( ) only."),
      }),
      execute: async ({ expression }) => {
        // Safe because the input is whitelist-validated to arithmetic only —
        // no identifiers, no calls — before it ever reaches the evaluator.
        if (!/^[\d\s+\-*/%.()]+$/.test(expression)) {
          return {
            ok: false,
            error: "Only digits, whitespace, and + - * / % ( ) are allowed.",
          };
        }
        try {
          const result = Function(`"use strict"; return (${expression});`)();
          if (typeof result !== "number" || !Number.isFinite(result)) {
            return { ok: false, error: "Expression did not evaluate to a finite number." };
          }
          return { ok: true, result };
        } catch {
          return { ok: false, error: "Could not evaluate the expression." };
        }
      },
    }),
  },

  current_datetime: {
    summary: "Get the current date and time (ISO 8601, UTC).",
    tool: tool({
      description: "Return the current date and time as an ISO 8601 UTC string.",
      inputSchema: z.object({}),
      execute: async () => ({ ok: true, now: new Date().toISOString() }),
    }),
  },
};

/** Names of every tool the builder may grant. */
export const toolNames = Object.keys(registry);

/** A catalog string the builder reads to choose tools. */
export function toolCatalog(): string {
  return toolNames.map((name) => `- ${name}: ${registry[name].summary}`).join("\n");
}

/**
 * Resolve a spec's tool-name list into the `tools` map the AI SDK expects.
 * Unknown names are dropped and reported, so a hallucinated tool name degrades
 * to "agent without that tool" rather than a crash.
 */
export function resolveTools(names: string[]): {
  tools: Record<string, Tool>;
  unknown: string[];
} {
  const tools: Record<string, Tool> = {};
  const unknown: string[] = [];
  for (const name of names) {
    if (name in registry) tools[name] = registry[name].tool;
    else unknown.push(name);
  }
  return { tools, unknown };
}
