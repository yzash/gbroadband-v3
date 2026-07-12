import { NextResponse } from "next/server";
import { retrain } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({ ok: true, ...retrain() });
}
