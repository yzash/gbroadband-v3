import { NextResponse } from "next/server";
import { resetWorld } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const snap = resetWorld();
  return NextResponse.json(snap);
}
