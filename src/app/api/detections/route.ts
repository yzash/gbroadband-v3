import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Emerging + active detections with their signal contributions and time-series.
export function GET() {
  const db = getDb();
  const incidents = db
    .prepare(
      `SELECT id, fault_id, state, detected_via, telemetry_dark, fault_kind, fault_kind_confidence,
              detection_confidence, detected_at, confirmed_at, top_suspect, top_confidence
         FROM incidents
        WHERE state NOT IN ('resolved')
        ORDER BY detection_confidence DESC, detected_at DESC
        LIMIT 40`
    )
    .all() as Record<string, unknown>[];

  const contribStmt = db.prepare(
    "SELECT signal, weight, detail FROM signal_contributions WHERE incident_id=? ORDER BY weight DESC"
  );
  const sampleStmt = db.prepare(
    "SELECT sim_ts, detection_confidence, tickets, telemetry, unreachable, dying_gasp_ratio FROM detection_samples WHERE incident_id=? ORDER BY sim_ts ASC"
  );

  const out = incidents.map((inc) => ({
    ...inc,
    telemetry_dark: !!inc.telemetry_dark,
    contributions: contribStmt.all(inc.id as string),
    samples: sampleStmt.all(inc.id as string),
  }));

  return NextResponse.json({ detections: out });
}
