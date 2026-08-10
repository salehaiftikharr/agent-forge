import { NextRequest, NextResponse } from "next/server";
import { parseTask } from "../../../../../src/app/task-intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Interpret a natural-language request into a structured task, so the composer
 * can show the user what Agent Forge understood before anything runs. Reuses the
 * SAME parser the Slack surface uses — one interpretation across surfaces.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const input = typeof (body as { input?: unknown }).input === "string" ? (body as { input: string }).input : "";
  if (!input.trim()) return NextResponse.json({ error: "empty input" }, { status: 400 });
  const task = parseTask(input);
  return NextResponse.json({ task });
}
