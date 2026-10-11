import fs from "node:fs";
import path from "node:path";
import { RNG } from "./rng";
import { haversineKm, toGrid } from "./geo";

export { haversineKm, toGrid };

export interface GenElement {
  element_id: string;
  kind: "olt" | "pon" | "splitter" | "nap" | "ont";
  parent_id: string | null;
  lat: number | null;
  lon: number | null;
  grid_x: number | null;
  grid_y: number | null;
  district_id: string | null;
  label: string;
  split_ratio: number | null;
  tier: number | null;
}

export interface GenDistrict {
  id: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  grid_x: number;
  grid_y: number;
  area_class: "urban" | "suburban" | "fringe";
  power_grid: string;
}

export interface RecordedElement {
  element_id: string;
  kind: GenElement["kind"];
  parent_id_recorded: string | null;
  lat: number | null;
  lon: number | null;
  grid_x: number | null;
  grid_y: number | null;
  district_id: string | null;
  record_confidence: number;
  mismapped: number;
}

export interface GenWorld {
  districts: GenDistrict[];
  truth: GenElement[];
  recorded: RecordedElement[];
}

type Area = GenDistrict["area_class"];

/**
 * 40 Metro Manila service districts on real coordinates. Each point is
 * validated inside its city polygon (public/geo/ncr-cities.geojson, PSA PSGC
 * 2023). BGC is deliberately avoided: its boundary is contested and the 2023
 * PSGC shapes still draw it inside Makati.
 */
const DISTRICTS: [name: string, city: string, lat: number, lon: number, area: Area, feeder: string][] = [
  ["Makati CBD", "Makati", 14.5547, 121.0244, "urban", "PWR-07"],
  ["Bel-Air", "Makati", 14.5615, 121.03, "urban", "PWR-07"],
  ["Poblacion", "Makati", 14.5664, 121.031, "urban", "PWR-07"],
  ["Guadalupe", "Makati", 14.564, 121.044, "urban", "PWR-07"],
  ["Ususan", "Taguig", 14.535, 121.075, "suburban", "PWR-09"],
  ["Signal Village", "Taguig", 14.511, 121.056, "suburban", "PWR-09"],
  ["Ortigas Center", "Pasig", 14.587, 121.062, "urban", "PWR-06"],
  ["Kapitolyo", "Pasig", 14.572, 121.058, "urban", "PWR-06"],
  ["San Antonio", "Pasig", 14.58, 121.068, "urban", "PWR-06"],
  ["Ugong", "Pasig", 14.577, 121.079, "suburban", "PWR-06"],
  ["Cubao", "Quezon City", 14.619, 121.053, "urban", "PWR-03"],
  ["Kamias", "Quezon City", 14.629, 121.051, "urban", "PWR-03"],
  ["Diliman", "Quezon City", 14.651, 121.049, "urban", "PWR-04"],
  ["UP Campus", "Quezon City", 14.6537, 121.0685, "suburban", "PWR-04"],
  ["Novaliches", "Quezon City", 14.72, 121.04, "fringe", "PWR-05"],
  ["Fairview", "Quezon City", 14.7, 121.06, "suburban", "PWR-05"],
  ["Batasan", "Quezon City", 14.687, 121.096, "fringe", "PWR-04"],
  ["Commonwealth", "Quezon City", 14.69, 121.08, "suburban", "PWR-04"],
  ["Ermita", "Manila", 14.583, 120.984, "urban", "PWR-01"],
  ["Malate", "Manila", 14.572, 120.99, "urban", "PWR-01"],
  ["Binondo", "Manila", 14.6, 120.974, "urban", "PWR-01"],
  ["Tondo North", "Manila", 14.63, 120.968, "suburban", "PWR-02"],
  ["Tondo South", "Manila", 14.611, 120.97, "urban", "PWR-02"],
  ["Sampaloc", "Manila", 14.611, 120.993, "urban", "PWR-02"],
  ["Sta. Mesa", "Manila", 14.6, 121.013, "urban", "PWR-01"],
  ["Mandaluyong East", "Mandaluyong", 14.58, 121.04, "urban", "PWR-07"],
  ["Wack-Wack", "Mandaluyong", 14.593, 121.044, "urban", "PWR-06"],
  ["San Juan Greenhills", "San Juan", 14.601, 121.048, "urban", "PWR-03"],
  ["Little Baguio", "San Juan", 14.605, 121.034, "urban", "PWR-03"],
  ["Pasay Rotonda", "Pasay", 14.538, 121.001, "urban", "PWR-09"],
  ["Libertad", "Pasay", 14.548, 120.995, "urban", "PWR-09"],
  ["Baclaran", "Parañaque", 14.526, 120.998, "urban", "PWR-09"],
  ["Paranaque BF", "Parañaque", 14.456, 121.016, "suburban", "PWR-10"],
  ["Sucat", "Parañaque", 14.47, 121.03, "suburban", "PWR-10"],
  ["Alabang", "Muntinlupa", 14.42, 121.042, "suburban", "PWR-10"],
  ["Muntinlupa Poblacion", "Muntinlupa", 14.387, 121.045, "fringe", "PWR-10"],
  ["Marikina Heights", "Marikina", 14.65, 121.12, "suburban", "PWR-08"],
  ["Concepcion", "Marikina", 14.648, 121.105, "suburban", "PWR-08"],
  ["Caloocan Grace Park", "Caloocan", 14.648, 120.985, "urban", "PWR-02"],
  ["Valenzuela Malinta", "Valenzuela", 14.695, 120.962, "fringe", "PWR-05"],
];

/** Central-office exchanges: one OLT each, spread to cover the metro. */
const EXCHANGES = ["Sampaloc", "Diliman", "Ortigas Center", "Makati CBD", "Sucat", "Novaliches"];

// ---- geometry helpers ----------------------------------------------------------

type Ring = [number, number][];
let ncrPolys: Ring[][] | null = null;

function loadNcr(): Ring[][] {
  if (ncrPolys) return ncrPolys;
  try {
    const file = path.join(process.cwd(), "public", "geo", "ncr-cities.geojson");
    const fc = JSON.parse(fs.readFileSync(file, "utf8")) as {
      features: { geometry: { type: string; coordinates: unknown } }[];
    };
    ncrPolys = [];
    for (const f of fc.features) {
      const g = f.geometry;
      if (g.type === "Polygon") ncrPolys.push(g.coordinates as Ring[]);
      else for (const p of g.coordinates as Ring[][]) ncrPolys.push(p);
    }
  } catch {
    ncrPolys = []; // no boundary file: accept every point
  }
  return ncrPolys;
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** True when the point is on Metro Manila land (not in Manila Bay / Laguna de Bay). */
function onLand(lon: number, lat: number): boolean {
  const polys = loadNcr();
  if (polys.length === 0) return true;
  return polys.some((p) => inRing(lon, lat, p[0]) && !p.slice(1).some((h) => inRing(lon, lat, h)));
}

/** Jitter around a centre, re-sampling until the point is on land. */
function place(rng: RNG, lat: number, lon: number, r: number): [number, number] {
  for (let i = 0; i < 10; i++) {
    const la = lat + rng.float(-r, r);
    const lo = lon + rng.float(-r, r) / 0.968;
    if (onLand(lo, la)) return [round6(la), round6(lo)];
  }
  return [round6(lat), round6(lon)]; // fall back to the (validated) centre
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

// ---- generation ----------------------------------------------------------------

/**
 * Build the GPON tree (truth) on real Metro Manila coordinates, then derive the
 * recorded copy with ~15% of lines mis-mapped to the wrong NAP and some
 * coordinates missing.
 */
export function generateWorld(seed: number): GenWorld {
  const rng = new RNG(seed);

  const districts: GenDistrict[] = DISTRICTS.map(([name, city, lat, lon, area, feeder], i) => {
    const g = toGrid(lon, lat);
    return {
      id: `D${String(i + 1).padStart(2, "0")}`,
      name,
      city,
      lat,
      lon,
      grid_x: g.x,
      grid_y: g.y,
      area_class: area,
      power_grid: feeder,
    };
  });
  const byName = new Map(districts.map((d) => [d.name, d]));

  // Assign each district to its nearest exchange, capacity-limited so every
  // OLT serves a compact, contiguous area of ~7 districts.
  const homes = EXCHANGES.map((n) => byName.get(n)!);
  const cap = Math.ceil(districts.length / homes.length);
  const served = new Map<number, GenDistrict[]>(homes.map((_, i) => [i, []]));
  const pairs: { d: GenDistrict; o: number; km: number }[] = [];
  for (const d of districts) homes.forEach((h, o) => pairs.push({ d, o, km: haversineKm(d.lat, d.lon, h.lat, h.lon) }));
  pairs.sort((a, b) => a.km - b.km);
  const assigned = new Set<string>();
  for (const p of pairs) {
    if (assigned.has(p.d.id)) continue;
    const list = served.get(p.o)!;
    if (list.length >= cap) continue;
    list.push(p.d);
    assigned.add(p.d.id);
  }

  const truth: GenElement[] = [];
  const push = (e: Omit<GenElement, "grid_x" | "grid_y">) => {
    const g = e.lat !== null && e.lon !== null ? toGrid(e.lon, e.lat) : null;
    truth.push({ ...e, grid_x: g?.x ?? null, grid_y: g?.y ?? null });
  };

  const PON_PER_OLT = 4;
  let splitterSeq = 0;
  let napSeq = 0;
  let ontSeq = 0;

  homes.forEach((home, o) => {
    const oltId = `OLT-${o + 1}`;
    push({
      element_id: oltId,
      kind: "olt",
      parent_id: null,
      lat: home.lat,
      lon: home.lon,
      district_id: home.id,
      label: `OLT ${o + 1} · ${home.name} exchange`,
      split_ratio: null,
      tier: null,
    });

    // Nearest-first so each PON fans out over a compact patch of the area.
    const area = served.get(o)!.slice().sort((a, b) => haversineKm(a.lat, a.lon, home.lat, home.lon) - haversineKm(b.lat, b.lon, home.lat, home.lon));
    let rr = 0;
    const nextDistrict = () => area[rr++ % area.length];

    for (let p = 0; p < PON_PER_OLT; p++) {
      const ponId = `PON-${o + 1}-${p + 1}`;
      const [pLat, pLon] = place(rng, home.lat, home.lon, 0.0009);
      push({ element_id: ponId, kind: "pon", parent_id: oltId, lat: pLat, lon: pLon, district_id: home.id, label: `${oltId} · PON ${p + 1}`, split_ratio: null, tier: null });

      const secDistricts = [nextDistrict(), nextDistrict()];
      // Primary splitter sits between its two downstream areas.
      splitterSeq++;
      const primId = `SPL-${String(splitterSeq).padStart(3, "0")}`;
      const midLat = (secDistricts[0].lat + secDistricts[1].lat) / 2;
      const midLon = (secDistricts[0].lon + secDistricts[1].lon) / 2;
      const [prLat, prLon] = place(rng, midLat, midLon, 0.002);
      push({ element_id: primId, kind: "splitter", parent_id: ponId, lat: prLat, lon: prLon, district_id: secDistricts[0].id, label: `${primId} (1:8 primary)`, split_ratio: 8, tier: 1 });

      for (const secD of secDistricts) {
        splitterSeq++;
        const secId = `SPL-${String(splitterSeq).padStart(3, "0")}`;
        const [sLat, sLon] = place(rng, secD.lat, secD.lon, 0.0018);
        push({ element_id: secId, kind: "splitter", parent_id: primId, lat: sLat, lon: sLon, district_id: secD.id, label: `${secId} (1:8 secondary) · ${secD.name}`, split_ratio: 8, tier: 2 });

        const napCount = rng.bool(0.75) ? 4 : 3;
        for (let n = 0; n < napCount; n++) {
          napSeq++;
          const napId = `NAP-${String(napSeq).padStart(3, "0")}`;
          const [nLat, nLon] = place(rng, sLat, sLon, 0.0042);
          push({ element_id: napId, kind: "nap", parent_id: secId, lat: nLat, lon: nLon, district_id: secD.id, label: `${napId} · ${secD.name}`, split_ratio: null, tier: null });

          const ontCount = rng.int(10, 18);
          for (let e = 0; e < ontCount; e++) {
            ontSeq++;
            const ontId = `ONT-${String(ontSeq).padStart(4, "0")}`;
            const [oLat, oLon] = place(rng, nLat, nLon, 0.0013);
            push({ element_id: ontId, kind: "ont", parent_id: napId, lat: oLat, lon: oLon, district_id: secD.id, label: ontId, split_ratio: null, tier: null });
          }
        }
      }
    }
  });

  // ---- Recorded copy: mis-map ~15% of lines, drop some coordinates ----
  const napsByDistrict = new Map<string, string[]>();
  for (const el of truth) {
    if (el.kind === "nap" && el.district_id) {
      const arr = napsByDistrict.get(el.district_id) ?? [];
      arr.push(el.element_id);
      napsByDistrict.set(el.district_id, arr);
    }
  }
  const napMismapDelta = new Map<string, number>();

  const recorded: RecordedElement[] = truth.map((el) => {
    let parentRec = el.parent_id;
    let mismapped = 0;
    let conf = rng.float(0.9, 1.0);
    let lat = el.lat;
    let lon = el.lon;

    if (el.kind === "ont" && rng.bool(0.15)) {
      // Recorded under a different NAP in the same district.
      const candidates = (napsByDistrict.get(el.district_id ?? "") ?? []).filter((id) => id !== el.parent_id);
      if (candidates.length > 0) {
        const wrong = rng.pick(candidates);
        parentRec = wrong;
        mismapped = 1;
        conf = rng.float(0.4, 0.68);
        napMismapDelta.set(wrong, (napMismapDelta.get(wrong) ?? 0) + 1);
        napMismapDelta.set(el.parent_id!, (napMismapDelta.get(el.parent_id!) ?? 0) - 1);
      }
    }

    // Some elements missing coordinates in plant records (~6%).
    if (rng.bool(0.06)) {
      lat = null;
      lon = null;
      conf = Math.min(conf, rng.float(0.55, 0.75));
    }

    const g = lat !== null && lon !== null ? toGrid(lon, lat) : null;
    return {
      element_id: el.element_id,
      kind: el.kind,
      parent_id_recorded: parentRec,
      lat,
      lon,
      grid_x: g?.x ?? null,
      grid_y: g?.y ?? null,
      district_id: el.district_id,
      record_confidence: conf,
      mismapped,
    };
  });

  for (const rec of recorded) {
    if (rec.kind === "nap") {
      const delta = Math.abs(napMismapDelta.get(rec.element_id) ?? 0);
      if (delta > 0) rec.record_confidence = Math.max(0.5, rec.record_confidence - 0.08 * delta);
    }
  }

  return { districts, truth, recorded };
}

/** Convenience counts for /debug/data and acceptance checks. */
export function worldStats(world: GenWorld) {
  const byKind = (k: GenElement["kind"]) => world.truth.filter((e) => e.kind === k).length;
  const lines = byKind("ont");
  const mismapped = world.recorded.filter((r) => r.mismapped === 1).length;
  const missingCoords = world.recorded.filter((r) => r.lat === null).length;
  return {
    districts: world.districts.length,
    olt: byKind("olt"),
    pon: byKind("pon"),
    splitter: byKind("splitter"),
    nap: byKind("nap"),
    ont: lines,
    lines,
    mismapped_lines: mismapped,
    mismap_rate: lines ? mismapped / lines : 0,
    missing_coord_elements: missingCoords,
  };
}
