import { NextResponse } from "next/server";
import { listOpenProposals, listRecentDecided, listAudit } from "@/lib/proposal-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    pending: listOpenProposals(),
    recent: listRecentDecided(),
    audit: listAudit(),
  });
}
