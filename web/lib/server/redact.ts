/**
 * Web-tier secret redaction for the few event fields the web writes (the goal it
 * records, decision notes). Mirrors the engine's src/app/redact.ts patterns so a
 * secret a user pastes into a task never lands in the ledger. The worker's store
 * does the heavier redaction of model/test/diff output.
 */
const PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /xapp-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];
const REDACTED = "[redacted]";

export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;
  const pass = process.env.FORGE_PASSPHRASE;
  if (pass && pass.length >= 8) out = out.split(pass).join(REDACTED);
  for (const re of PATTERNS) out = out.replace(re, REDACTED);
  return out;
}
