import { NextResponse, type NextRequest } from "next/server";

/**
 * Single-owner passphrase gate. When FORGE_PASSPHRASE is set, the functional
 * surface (/work and its write APIs) requires a valid session cookie; without
 * the env var the gate is off (local dev). The cookie holds a hash of the
 * passphrase, never the passphrase itself, and is httpOnly. Marketing/demo
 * pages and health checks stay public.
 */

const COOKIE = "forge_session";

async function expectedToken(passphrase: string): Promise<string> {
  const data = new TextEncoder().encode(`${passphrase}:agent-forge-session`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(req: NextRequest) {
  const passphrase = process.env.FORGE_PASSPHRASE;
  if (!passphrase) return NextResponse.next(); // gate disabled (no passphrase configured)

  const cookie = req.cookies.get(COOKIE)?.value;
  const ok = cookie != null && cookie === (await expectedToken(passphrase));
  if (ok) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/sign-in";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

// Gate the functional app and its write APIs; leave marketing/demo + health public.
export const config = {
  matcher: ["/work/:path*", "/api/tasks/:path*", "/api/runs/:path*"],
};
