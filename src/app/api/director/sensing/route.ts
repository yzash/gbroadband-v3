import { NextResponse } from "next/server";
import { setSensing } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    coverage?: number;
    alarm_delay_min?: number;
    dead_olt?: string | null;
  };
  const snap = setSensing(body);
  return NextResponse.json({ ok: true, sensing_health: snap.sensing_health });
}
