import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Single-owner passphrase auth. The session cookie stores a hash of the
 * passphrase (via FORGE_PASSPHRASE), never the passphrase itself. The middleware
 * (edge) computes the same hash to validate; this module is the Node side used
 * by the sign-in route.
 */
export const SESSION_COOKIE = "forge_session";

export function passphraseConfigured(): boolean {
  return Boolean(process.env.FORGE_PASSPHRASE);
}

export function sessionToken(): string {
  return createHash("sha256")
    .update(`${process.env.FORGE_PASSPHRASE ?? ""}:agent-forge-session`)
    .digest("hex");
}

/** Constant-time passphrase comparison. */
export function checkPassphrase(input: string): boolean {
  const expected = process.env.FORGE_PASSPHRASE ?? "";
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** A safe same-origin redirect target (defaults to /work). */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/work";
}
