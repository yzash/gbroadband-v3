import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Static backbone geometry for the Operations network map (olt/pon/splitter/nap).
// Colored live client-side from snapshot.element_health.
export function GET() {
  const db = getDb();
  const nodes = db
    .prepare(
      "SELECT element_id, kind, parent_id, grid_x, grid_y FROM topology_truth WHERE kind != 'ont' AND grid_x IS NOT NULL"
    )
    .all() as { element_id: string; kind: string; parent_id: string | null; grid_x: number; grid_y: number }[];
  const districts = db.prepare("SELECT id, name, grid_x, grid_y FROM districts").all() as {
    id: string;
    name: string;
    grid_x: number;
    grid_y: number;
  }[];

  const xs = nodes.map((n) => n.grid_x);
  const ys = nodes.map((n) => n.grid_y);
  const bounds = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
  return NextResponse.json({ nodes, districts, bounds });
}
