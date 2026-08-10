import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, checkPassphrase, passphraseConfigured, safeNext, sessionToken } from "../../../lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") || "";
  let passphrase = "";
  let next = "/work";
  if (ct.includes("application/json")) {
    const b = (await req.json().catch(() => ({}))) as { passphrase?: string; next?: string };
    passphrase = b.passphrase ?? "";
    next = b.next ?? "/work";
  } else {
    const f = await req.formData();
    passphrase = String(f.get("passphrase") ?? "");
    next = String(f.get("next") ?? "/work");
  }

  const dest = safeNext(next);
  // No passphrase configured → gate is off; just proceed.
  if (!passphraseConfigured()) {
    return NextResponse.redirect(new URL(dest, req.url), { status: 303 });
  }
  if (!checkPassphrase(passphrase)) {
    const url = new URL("/sign-in", req.url);
    url.searchParams.set("error", "1");
    if (dest !== "/work") url.searchParams.set("next", dest);
    return NextResponse.redirect(url, { status: 303 });
  }

  const res = NextResponse.redirect(new URL(dest, req.url), { status: 303 });
  res.cookies.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: req.url.startsWith("https"),
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
