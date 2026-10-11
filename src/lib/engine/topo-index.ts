import type { DB } from "../db";
import type { ElementKind } from "../types";

interface Node {
  id: string;
  kind: ElementKind;
  parent: string | null;
  district: string | null;
  lat: number | null;
  lon: number | null;
  grid_x: number | null;
  grid_y: number | null;
}

/**
 * In-memory index of the TRUTH topology. Used by the engine to propagate faults
 * to lines quickly. Rebuilt on boot and after every reseed.
 */
export class TopoIndex {
  nodes = new Map<string, Node>();
  children = new Map<string, string[]>();
  private linesCache = new Map<string, string[]>();
  linesByPowerGrid = new Map<string, string[]>();
  linesByDistrict = new Map<string, string[]>();
  allLines: string[] = [];

  constructor(db: DB) {
    const rows = db
      .prepare("SELECT element_id, kind, parent_id, district_id, lat, lon, grid_x, grid_y FROM topology_truth")
      .all() as {
      element_id: string;
      kind: ElementKind;
      parent_id: string | null;
      district_id: string | null;
      lat: number | null;
      lon: number | null;
      grid_x: number | null;
      grid_y: number | null;
    }[];

    for (const r of rows) {
      this.nodes.set(r.element_id, {
        id: r.element_id,
        kind: r.kind,
        parent: r.parent_id,
        district: r.district_id,
        lat: r.lat,
        lon: r.lon,
        grid_x: r.grid_x,
        grid_y: r.grid_y,
      });
      if (r.parent_id) {
        const arr = this.children.get(r.parent_id) ?? [];
        arr.push(r.element_id);
        this.children.set(r.parent_id, arr);
      }
    }

    // Power-grid map (district -> power_grid) for area power outages.
    const districts = db.prepare("SELECT id, power_grid FROM districts").all() as {
      id: string;
      power_grid: string;
    }[];
    const gridOf = new Map(districts.map((d) => [d.id, d.power_grid]));

    for (const n of this.nodes.values()) {
      if (n.kind === "ont") {
        this.allLines.push(n.id);
        if (n.district) {
          const d = this.linesByDistrict.get(n.district) ?? [];
          d.push(n.id);
          this.linesByDistrict.set(n.district, d);
          const pg = gridOf.get(n.district);
          if (pg) {
            const g = this.linesByPowerGrid.get(pg) ?? [];
            g.push(n.id);
            this.linesByPowerGrid.set(pg, g);
          }
        }
      }
    }
  }

  node(id: string): Node | undefined {
    return this.nodes.get(id);
  }

  /** All ONT/line ids at or under an element (memoized). */
  linesUnder(elementId: string): string[] {
    const cached = this.linesCache.get(elementId);
    if (cached) return cached;
    const out: string[] = [];
    const stack = [elementId];
    while (stack.length) {
      const id = stack.pop()!;
      const node = this.nodes.get(id);
      if (!node) continue;
      if (node.kind === "ont") {
        out.push(id);
      } else {
        const kids = this.children.get(id);
        if (kids) for (const k of kids) stack.push(k);
      }
    }
    this.linesCache.set(elementId, out);
    return out;
  }

  ancestors(elementId: string): string[] {
    const out: string[] = [];
    let cur = this.nodes.get(elementId)?.parent ?? null;
    while (cur) {
      out.push(cur);
      cur = this.nodes.get(cur)?.parent ?? null;
    }
    return out;
  }
}
