import { NextResponse } from "next/server";
import { bootEngine } from "@/lib/engine";
import { getHandoffs } from "@/lib/persona-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(req: Request) {
  bootEngine();
  const id = new URL(req.url).searchParams.get("incident");
  if (!id) return NextResponse.json({ error: "incident required" }, { status: 400 });
  return NextResponse.json(getHandoffs(id));
}
