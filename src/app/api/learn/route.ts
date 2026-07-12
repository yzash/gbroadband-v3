import { NextResponse } from "next/server";
import { getLearnMetrics } from "@/lib/learn-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(getLearnMetrics());
}
