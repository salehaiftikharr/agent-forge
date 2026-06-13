import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Load .env.local / .env into process.env. This is a standalone CLI (no Next.js
 * to do it for us). Values already in the environment win, so a shell override
 * or CI secret always takes precedence over the file.
 */
export function loadEnv(root: string = process.cwd()): void {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim().startsWith("#")) continue;
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] ??= value;
    }
  }
}
