import { NextResponse } from "next/server";
import { ticketStorm, quietPeriod, listOlts } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ olts: listOlts() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  if (body.name === "ticket_storm") return NextResponse.json({ ok: true, ...ticketStorm() });
  if (body.name === "quiet") return NextResponse.json({ ok: true, ...quietPeriod() });
  return NextResponse.json({ error: "unknown scenario" }, { status: 400 });
}
