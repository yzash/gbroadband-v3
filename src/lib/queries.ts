import { getDb } from "./db";
import type { ElementKind } from "./types";

export interface TruthRow {
  element_id: string;
  kind: ElementKind;
  parent_id: string | null;
  grid_x: number | null;
  grid_y: number | null;
  district_id: string | null;
  label: string;
  split_ratio: number | null;
  tier: number | null;
}

export interface RecRow {
  element_id: string;
  kind: ElementKind;
  parent_id_recorded: string | null;
  grid_x: number | null;
  grid_y: number | null;
  record_confidence: number;
  mismapped: number;
}

export function allTruth(): TruthRow[] {
  return getDb().prepare("SELECT * FROM topology_truth").all() as TruthRow[];
}

export function allRecorded(): RecRow[] {
  return getDb().prepare("SELECT * FROM topology_recorded").all() as RecRow[];
}

export function topoCounts() {
  const db = getDb();
  const kind = (k: string) =>
    (db.prepare("SELECT COUNT(*) n FROM topology_truth WHERE kind=?").get(k) as { n: number }).n;
  const mismapped = (db.prepare("SELECT COUNT(*) n FROM topology_recorded WHERE mismapped=1").get() as { n: number }).n;
  const missing = (db.prepare("SELECT COUNT(*) n FROM topology_recorded WHERE grid_x IS NULL").get() as { n: number }).n;
  const lines = kind("ont");
  const polled = (db.prepare("SELECT COUNT(*) n FROM sensing WHERE polled=1").get() as { n: number }).n;
  const dgc = (db.prepare("SELECT COUNT(*) n FROM sensing WHERE dying_gasp_capable=1").get() as { n: number }).n;
  const subs = (db.prepare("SELECT COUNT(*) n FROM subscribers").get() as { n: number }).n;
  const vip = (db.prepare("SELECT COUNT(*) n FROM subscribers WHERE vip=1").get() as { n: number }).n;
  const b2b = (db.prepare("SELECT COUNT(*) n FROM subscribers WHERE b2b=1").get() as { n: number }).n;
  const holdout = (db.prepare("SELECT COUNT(*) n FROM subscribers WHERE holdout=1").get() as { n: number }).n;
  const districts = (db.prepare("SELECT COUNT(*) n FROM districts").get() as { n: number }).n;
  return {
    olt: kind("olt"),
    pon: kind("pon"),
    splitter: kind("splitter"),
    nap: kind("nap"),
    ont: lines,
    lines,
    districts,
    mismapped,
    mismap_rate: lines ? mismapped / lines : 0,
    missing_coords: missing,
    polled,
    polled_rate: lines ? polled / lines : 0,
    dgc,
    subs,
    vip,
    b2b,
    holdout,
  };
}

/** Count lines truly under this NAP but recorded under a different parent. */
export function napMisrecordedCount(napId: string): number {
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT COUNT(*) n FROM topology_truth t
         JOIN topology_recorded r ON r.element_id = t.element_id
         WHERE t.parent_id = ? AND r.mismapped = 1`
      )
      .get(napId) as { n: number }
  ).n;
}

/** Children of an element in the truth tree. */
export function truthChildren(parentId: string | null): TruthRow[] {
  const db = getDb();
  if (parentId === null) return db.prepare("SELECT * FROM topology_truth WHERE parent_id IS NULL ORDER BY element_id").all() as TruthRow[];
  return db.prepare("SELECT * FROM topology_truth WHERE parent_id=? ORDER BY element_id").all(parentId) as TruthRow[];
}
