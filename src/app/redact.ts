/**
 * Redact secrets from any text before it is persisted to an event, artifact, or
 * anything a surface renders. Two layers: the exact values of known secret env
 * vars, and patterns for common credential shapes (model keys, GitHub tokens,
 * Slack tokens, JWTs, private keys, bearer headers). Applied at the store
 * boundary, so nothing sensitive can reach the ledger, the diffs, the web/Slack
 * surfaces, or logs derived from them — even if a repo's output or a model's
 * text happened to contain one.
 */

const SECRET_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "FORGE_PASSPHRASE",
  "FORGE_SESSION_SECRET",
  "LINEAR_API_KEY",
];

const PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g, // Anthropic
  /sk-[A-Za-z0-9]{20,}/g, // OpenAI-style
  /github_pat_[A-Za-z0-9_]{20,}/g, // fine-grained PAT
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // classic PAT / oauth
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack bot/user tokens
  /xapp-[A-Za-z0-9-]{10,}/g, // Slack app-level token
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /-----BEGIN[A-Z ]+PRIVATE KEY-----[\s\S]*?-----END[A-Z ]+PRIVATE KEY-----/g,
];

const REDACTED = "[redacted]";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace any known secret value or credential-shaped token with [redacted]. */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;

  // 1) Exact values of configured secret env vars (guarded by a min length so a
  // short/empty value can't over-redact ordinary text).
  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key];
    if (value && value.length >= 8) {
      out = out.split(value).join(REDACTED);
    }
  }

  // 2) Credential-shaped patterns, even for secrets we were never told about.
  for (const re of PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

/** Redact an optional field, preserving null/undefined. */
export function redactMaybe(input: string | null | undefined): string | null | undefined {
  return input == null ? input : redactSecrets(input);
}
