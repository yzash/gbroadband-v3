import { NextResponse } from "next/server";
import { getSnapshotJson } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return new NextResponse(getSnapshotJson(), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
