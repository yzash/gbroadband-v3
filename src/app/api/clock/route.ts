import { NextResponse } from "next/server";
import { setClock } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    speed?: 0 | 1 | 4 | 16;
    running?: boolean;
    advance6h?: boolean;
  };
  const snap = setClock(body);
  return NextResponse.json(snap);
}
