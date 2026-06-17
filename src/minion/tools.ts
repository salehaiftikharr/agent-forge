import { tool, type Tool } from "ai";
import { z } from "zod";
import type { Workspace } from "./workspace";

/**
 * The write-capable tools a minion acts through — all bound to one Workspace,
 * so every file op and test run is confined to that ticket's sandbox. The
 * `write_file` tool surfaces the "no editing tests" rule back to the model as a
 * tool error it can read and adapt to, rather than silently failing.
 */
/**
 * Read-only tools for the orientation phase: a minion uses these to study the
 * whole codebase and understand it before it writes a single line. No writing,
 * no test runs — just looking.
 */
export function minionReadTools(ws: Workspace): Record<string, Tool> {
  return {
    list_files: tool({
      description:
        "List all files in the repository (source and tests), so you can see what's there.",
      inputSchema: z.object({}),
      execute: async () => ({ files: ws.listFiles() }),
    }),

    read_file: tool({
      description:
        "Read a file's full contents. Read widely to understand the codebase, its structure, and its conventions.",
      inputSchema: z.object({
        path: z.string().describe("Repo-relative path, e.g. src/utils.js"),
      }),
      execute: async ({ path }) => {
        try {
          return { ok: true, content: ws.read(path) };
        } catch (error) {
          return { ok: false, error: errMsg(error) };
        }
      },
    }),
  };
}

export function minionTools(ws: Workspace): Record<string, Tool> {
  return {
    ...minionReadTools(ws),

    write_file: tool({
      description:
        "Overwrite a SOURCE file with new contents. You cannot write to test files — those are the acceptance gate. Make the minimal change that resolves the ticket.",
      inputSchema: z.object({
        path: z.string().describe("Repo-relative source path, e.g. src/utils.js"),
        content: z.string().describe("The complete new file contents."),
      }),
      execute: async ({ path, content }) => {
        try {
          ws.write(path, content);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: errMsg(error) };
        }
      },
    }),

    run_tests: tool({
      description:
        "Run the full test suite and get the result. A fix is only acceptable when ALL tests pass — the ticket's and the pre-existing ones. Use this to check your work and iterate.",
      inputSchema: z.object({}),
      execute: async () => {
        const r = ws.runTests();
        return {
          allPassing: r.ok,
          passed: r.passed,
          failed: r.failed,
          total: r.total,
          output: r.output.slice(-3000),
        };
      },
    }),
  };
}

/**
 * Tools for a SPEC-AUTHOR minion: read the codebase and write a failing test
 * (the gate), but never source. The inverse of a fixer — this is what keeps the
 * test-writer and the fixer separate.
 */
export function specTools(ws: Workspace): Record<string, Tool> {
  return {
    ...minionReadTools(ws),

    write_test: tool({
      description:
        "Create or overwrite a TEST file with a failing test that reproduces the issue. You may write ONLY test files, never source — you are authoring the gate, not the fix.",
      inputSchema: z.object({
        path: z.string().describe("Repo-relative test path, e.g. test/clamp.test.js"),
        content: z.string().describe("The complete test file contents."),
      }),
      execute: async ({ path, content }) => {
        try {
          ws.write(path, content);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: errMsg(error) };
        }
      },
    }),

    run_tests: tool({
      description:
        "Run the full test suite. Use this to confirm your new test FAILS against the current code — a reproduction that already passes is not a reproduction.",
      inputSchema: z.object({}),
      execute: async () => {
        const r = ws.runTests();
        return {
          allPassing: r.ok,
          passed: r.passed,
          failed: r.failed,
          total: r.total,
          output: r.output.slice(-3000),
        };
      },
    }),
  };
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
