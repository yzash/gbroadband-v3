import { NextResponse } from "next/server";
import { ask } from "@/lib/ask";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { question?: string };
  if (!body.question) return NextResponse.json({ error: "question required" }, { status: 400 });
  const res = await ask(body.question);
  return NextResponse.json(res);
}
