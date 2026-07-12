import type { DB } from "../db";
import { getSimState } from "../db";
import type { FaultKind } from "../types";

interface VendorRow {
  id: string;
  name: string;
  skills: FaultKind[];
  territories: string[];
  quality: number;
}

/**
 * MTTR prediction (Decide-3) + prioritization (Decide-4), per open incident.
 * Picks a plausible vendor (territory x skill x current load), reads the MTTR
 * model for class x vendor x area, and ranks incidents by
 * exposure x time-pressure x confidence.
 */
export function runPrioritization(db: DB): void {
  const sim = getSimState(db)!;
  const window = sim.repair_window_hrs;
  const version = sim.model_version;

  const vendors = (db.prepare("SELECT id, name, skills_json, territories_json, quality FROM vendors").all() as {
    id: string;
    name: string;
    skills_json: string;
    territories_json: string;
    quality: number;
  }[]).map<VendorRow>((v) => ({
    id: v.id,
    name: v.name,
    skills: JSON.parse(v.skills_json),
    territories: JSON.parse(v.territories_json),
    quality: v.quality,
  }));

  const loadByVendor = new Map<string, number>();
  for (const r of db.prepare("SELECT vendor_id, COUNT(*) n FROM crew_jobs WHERE state != 'done' GROUP BY vendor_id").all() as {
    vendor_id: string;
    n: number;
  }[])
    loadByVendor.set(r.vendor_id, r.n);

  const districtOf = (el: string | null): string | null => {
    if (!el) return null;
    const r = db.prepare("SELECT district_id FROM topology_recorded WHERE element_id=?").get(el) as
      | { district_id: string | null }
      | undefined;
    return r?.district_id ?? null;
  };

  const mttrLookup = db.prepare(
    "SELECT p50_hrs, p90_hrs FROM mttr_model WHERE fault_kind=? AND vendor_id=? AND area_class=? AND version=?"
  );
  const mttrAny = db.prepare(
    "SELECT MIN(p50_hrs) p50, MIN(p90_hrs) p90 FROM mttr_model WHERE fault_kind=? AND area_class=? AND version=?"
  );

  const incidents = db
    .prepare(
      `SELECT id, fault_kind, area_class, top_suspect, top_confidence, detection_confidence, peso_exposure, worst_hours_down, state
         FROM incidents WHERE state NOT IN ('resolved')`
    )
    .all() as {
    id: string;
    fault_kind: FaultKind | null;
    area_class: string | null;
    top_suspect: string | null;
    top_confidence: number;
    detection_confidence: number;
    peso_exposure: number;
    worst_hours_down: number;
    state: string;
  }[];

  const upd = db.prepare(
    "UPDATE incidents SET vendor_id=?, predicted_mttr_p50=?, predicted_mttr_p90=?, eta_hrs=?, rank_score=? WHERE id=?"
  );

  for (const inc of incidents) {
    if (!inc.fault_kind) continue;
    const area = inc.area_class ?? "urban";
    const district = districtOf(inc.top_suspect);

    // Power outages get no fiber crew — notify + monitor. Vendor stays null.
    let vendorId: string | null = null;
    if (inc.fault_kind !== "power_outage") {
      vendorId = pickVendor(vendors, inc.fault_kind, district, loadByVendor);
    }

    let p50 = 0;
    let p90 = 0;
    if (vendorId) {
      const m = mttrLookup.get(inc.fault_kind, vendorId, area, version) as { p50_hrs: number; p90_hrs: number } | undefined;
      if (m) {
        p50 = m.p50_hrs;
        p90 = m.p90_hrs;
      }
    }
    if (!p50) {
      const m = mttrAny.get(inc.fault_kind, area, version) as { p50: number | null; p90: number | null } | undefined;
      p50 = m?.p50 ?? 3;
      p90 = m?.p90 ?? 6;
    }

    // Prioritization: exposure x time-pressure x confidence.
    const timePressure = Math.max(0.15, Math.min(3, inc.worst_hours_down / window));
    const conf = 0.5 + 0.5 * Math.max(inc.top_confidence, inc.detection_confidence);
    const rank = inc.peso_exposure * timePressure * conf;

    upd.run(vendorId, Number(p50.toFixed(2)), Number(p90.toFixed(2)), Number(p50.toFixed(2)), Number(rank.toFixed(1)), inc.id);
  }
}

function pickVendor(
  vendors: VendorRow[],
  kind: FaultKind,
  district: string | null,
  load: Map<string, number>
): string | null {
  const skilled = vendors.filter((v) => v.skills.includes(kind));
  if (skilled.length === 0) return null;
  const inTerritory = district ? skilled.filter((v) => v.territories.includes(district)) : [];
  const pool = inTerritory.length > 0 ? inTerritory : skilled;
  // Lowest current load, then highest quality.
  pool.sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || b.quality - a.quality);
  return pool[0].id;
}
