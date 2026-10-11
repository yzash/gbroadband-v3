import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { GeoPayload } from "@/lib/geo-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Static network geometry for the map, from the RECORDED topology (the
 * platform's view). Elements whose plant record lacks a location snap to
 * their recorded parent and are flagged `est`. Live state (health, tickets,
 * crews, incidents) comes from the snapshot, not from here.
 */
export function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.element_id id, r.kind, r.parent_id_recorded parent, r.lat, r.lon, r.record_confidence conf,
              r.district_id district, d.city, t.label, t.tier
         FROM topology_recorded r
         JOIN topology_truth t ON t.element_id = r.element_id
         LEFT JOIN districts d ON d.id = r.district_id`
    )
    .all() as {
    id: string;
    kind: string;
    parent: string | null;
    lat: number | null;
    lon: number | null;
    conf: number;
    district: string | null;
    city: string | null;
    label: string;
    tier: number | null;
  }[];

  // Resolve missing locations by walking up recorded parents.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pos = (id: string, depth = 0): [number, number] | null => {
    const r = byId.get(id);
    if (!r || depth > 8) return null;
    if (r.lat !== null && r.lon !== null) return [r.lat, r.lon];
    return r.parent ? pos(r.parent, depth + 1) : null;
  };

  const sensing = new Map(
    (db.prepare("SELECT line_id, polled FROM sensing").all() as { line_id: string; polled: number }[]).map((s) => [s.line_id, s.polled])
  );
  const subs = new Map(
    (db.prepare("SELECT line_id, arpu, vip, b2b FROM subscribers").all() as {
      line_id: string;
      arpu: number;
      vip: number;
      b2b: number;
    }[]).map((s) => [s.line_id, s])
  );

  const payload: GeoPayload = { elements: [], lines: [], districts: [] };
  for (const r of rows) {
    const p = pos(r.id);
    if (!p) continue;
    const est = r.lat === null;
    if (r.kind === "ont") {
      const s = subs.get(r.id);
      payload.lines.push({
        id: r.id,
        lat: p[0],
        lon: p[1],
        est,
        nap: r.parent,
        city: r.city,
        district: r.district,
        polled: sensing.get(r.id) === 1,
        conf: Math.round(r.conf * 100) / 100,
        arpu: s?.arpu ?? 0,
        vip: !!s?.vip,
        b2b: !!s?.b2b,
      });
    } else {
      payload.elements.push({
        id: r.id,
        kind: r.kind as GeoPayload["elements"][number]["kind"],
        parent: r.parent,
        lat: p[0],
        lon: p[1],
        est,
        city: r.city,
        district: r.district,
        label: r.label,
        tier: r.tier,
        conf: Math.round(r.conf * 100) / 100,
      });
    }
  }
  payload.districts = db.prepare("SELECT id, name, city, lat, lon FROM districts").all() as GeoPayload["districts"];

  return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
}
