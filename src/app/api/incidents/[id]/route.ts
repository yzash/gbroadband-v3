import { NextResponse } from "next/server";
import { getIncidentDetail } from "@/lib/incident-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(_req: Request, { params }: { params: { id: string } }) {
  const detail = getIncidentDetail(params.id);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail);
}
