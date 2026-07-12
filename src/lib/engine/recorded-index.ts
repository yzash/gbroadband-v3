import type { DB } from "../db";
import type { ElementKind } from "../types";

interface RecNode {
  id: string;
  kind: ElementKind;
  parent: string | null;
  district: string | null;
  confidence: number;
  grid_x: number | null;
  grid_y: number | null;
}

/**
 * In-memory index of the RECORDED topology (plant records) — the only view the
 * platform is allowed to reason over. Detection & isolation run against this,
 * which is why they must cope with the ~15% mis-mapped lines.
 */
export class RecordedIndex {
  nodes = new Map<string, RecNode>();
  children = new Map<string, string[]>();
  private linesCache = new Map<string, string[]>();
  allLines: string[] = [];

  constructor(db: DB) {
    const rows = db
      .prepare(
        "SELECT element_id, kind, parent_id_recorded, district_id, record_confidence, grid_x, grid_y FROM topology_recorded"
      )
      .all() as {
      element_id: string;
      kind: ElementKind;
      parent_id_recorded: string | null;
      district_id: string | null;
      record_confidence: number;
      grid_x: number | null;
      grid_y: number | null;
    }[];
    for (const r of rows) {
      this.nodes.set(r.element_id, {
        id: r.element_id,
        kind: r.kind,
        parent: r.parent_id_recorded,
        district: r.district_id,
        confidence: r.record_confidence,
        grid_x: r.grid_x,
        grid_y: r.grid_y,
      });
      if (r.parent_id_recorded) {
        const arr = this.children.get(r.parent_id_recorded) ?? [];
        arr.push(r.element_id);
        this.children.set(r.parent_id_recorded, arr);
      }
      if (r.kind === "ont") this.allLines.push(r.element_id);
    }
  }

  node(id: string): RecNode | undefined {
    return this.nodes.get(id);
  }

  linesUnder(elementId: string): string[] {
    const cached = this.linesCache.get(elementId);
    if (cached) return cached;
    const out: string[] = [];
    const stack = [elementId];
    while (stack.length) {
      const id = stack.pop()!;
      const node = this.nodes.get(id);
      if (!node) continue;
      if (node.kind === "ont") out.push(id);
      else {
        const kids = this.children.get(id);
        if (kids) for (const k of kids) stack.push(k);
      }
    }
    this.linesCache.set(elementId, out);
    return out;
  }

  /** Recorded ancestry, nearest first (nap, spl2, spl1, pon, olt). */
  ancestors(elementId: string): string[] {
    const out: string[] = [];
    let cur = this.nodes.get(elementId)?.parent ?? null;
    while (cur) {
      out.push(cur);
      cur = this.nodes.get(cur)?.parent ?? null;
    }
    return out;
  }

  /** Recorded siblings of an element (same recorded parent), excluding itself. */
  siblings(elementId: string): string[] {
    const p = this.nodes.get(elementId)?.parent;
    if (!p) return [];
    return (this.children.get(p) ?? []).filter((x) => x !== elementId);
  }
}
