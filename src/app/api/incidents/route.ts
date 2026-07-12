import { NextResponse } from "next/server";
import { listIncidents } from "@/lib/incident-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ incidents: listIncidents() });
}
