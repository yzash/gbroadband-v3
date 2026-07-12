import { RNG } from "./rng";

export interface GenElement {
  element_id: string;
  kind: "olt" | "pon" | "splitter" | "nap" | "ont";
  parent_id: string | null;
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
  grid_x: number;
  grid_y: number;
  area_class: "urban" | "suburban" | "fringe";
  power_grid: string;
}

export interface RecordedElement {
  element_id: string;
  kind: GenElement["kind"];
  parent_id_recorded: string | null;
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

// 40 Metro Manila place names (geographic — allowed by guardrails).
const DISTRICT_NAMES = [
  "Makati CBD", "Bel-Air", "Poblacion", "Guadalupe", "BGC North", "BGC South",
  "Ortigas Center", "Kapitolyo", "San Antonio", "Ugong", "Cubao", "Kamias",
  "Diliman", "UP Campus", "Novaliches", "Fairview", "Batasan", "Commonwealth",
  "Ermita", "Malate", "Binondo", "Tondo North", "Tondo South", "Sampaloc",
  "Sta. Mesa", "Mandaluyong East", "Wack-Wack", "San Juan Greenhills", "Little Baguio",
  "Pasay Rotonda", "Libertad", "Baclaran", "Paranaque BF", "Sucat", "Alabang",
  "Muntinlupa Poblacion", "Marikina Heights", "Concepcion", "Caloocan Grace Park", "Valenzuela Malinta",
];

const AREA_CLASSES: ("urban" | "suburban" | "fringe")[] = ["urban", "suburban", "fringe"];

function jitter(rng: RNG, v: number, r: number): number {
  return Math.round(v + rng.float(-r, r));
}

/**
 * Build the GPON tree (truth), then derive the recorded copy with ~15% of lines
 * mis-mapped to the wrong splitter/NAP and some coordinates missing.
 */
export function generateWorld(seed: number): GenWorld {
  const rng = new RNG(seed);

  // ---- Districts on a ~1000x1000 grid, grouped into ~10 power feeders ----
  const districts: GenDistrict[] = DISTRICT_NAMES.map((name, i) => {
    const cols = 8;
    const gx = (i % cols) * 120 + 60 + jitter(rng, 0, 25);
    const gy = Math.floor(i / cols) * 150 + 80 + jitter(rng, 0, 25);
    return {
      id: `D${String(i + 1).padStart(2, "0")}`,
      name,
      grid_x: gx,
      grid_y: gy,
      area_class: rng.weighted([
        ["urban", 5],
        ["suburban", 3],
        ["fringe", 2],
      ]),
      power_grid: `PWR-${String(Math.floor(i / 4) + 1).padStart(2, "0")}`, // ~4 districts per feeder
    };
  });
  const districtById = new Map(districts.map((d) => [d.id, d]));

  const truth: GenElement[] = [];
  const OLT_COUNT = 6;
  const PON_PER_OLT = 4;

  // Home districts for the 6 OLTs, spread across the map.
  const homeDistricts = rng.shuffle(districts).slice(0, OLT_COUNT);

  let splitterSeq = 0;
  let napSeq = 0;
  let ontSeq = 0;

  for (let o = 0; o < OLT_COUNT; o++) {
    const home = homeDistricts[o];
    const oltId = `OLT-${o + 1}`;
    truth.push({
      element_id: oltId,
      kind: "olt",
      parent_id: null,
      grid_x: home.grid_x,
      grid_y: home.grid_y,
      district_id: home.id,
      label: `OLT ${o + 1} · ${home.name}`,
      split_ratio: null,
      tier: null,
    });

    // Districts this OLT will serve (its home + a few neighbours).
    const served = rng.shuffle(districts).slice(0, rng.int(6, 9));

    for (let p = 0; p < PON_PER_OLT; p++) {
      const ponId = `PON-${o + 1}-${p + 1}`;
      truth.push({
        element_id: ponId,
        kind: "pon",
        parent_id: oltId,
        grid_x: jitter(rng, home.grid_x, 15),
        grid_y: jitter(rng, home.grid_y, 15),
        district_id: home.id,
        label: `${oltId} · PON ${p + 1}`,
        split_ratio: null,
        tier: null,
      });

      // One primary splitter per PON (tier 1, 1:8).
      splitterSeq++;
      const primId = `SPL-${String(splitterSeq).padStart(3, "0")}`;
      const primDistrict = rng.pick(served);
      truth.push({
        element_id: primId,
        kind: "splitter",
        parent_id: ponId,
        grid_x: jitter(rng, primDistrict.grid_x, 30),
        grid_y: jitter(rng, primDistrict.grid_y, 30),
        district_id: primDistrict.id,
        label: `${primId} (1:8 primary)`,
        split_ratio: 8,
        tier: 1,
      });

      // 2 secondary splitters per primary (tier 2, 1:8).
      const secCount = 2;
      for (let s = 0; s < secCount; s++) {
        splitterSeq++;
        const secId = `SPL-${String(splitterSeq).padStart(3, "0")}`;
        const secDistrict = rng.pick(served);
        truth.push({
          element_id: secId,
          kind: "splitter",
          parent_id: primId,
          grid_x: jitter(rng, secDistrict.grid_x, 25),
          grid_y: jitter(rng, secDistrict.grid_y, 25),
          district_id: secDistrict.id,
          label: `${secId} (1:8 secondary)`,
          split_ratio: 8,
          tier: 2,
        });

        // 3–4 NAPs per secondary splitter.
        const napCount = rng.bool(0.75) ? 4 : 3;
        for (let n = 0; n < napCount; n++) {
          napSeq++;
          const napId = `NAP-${String(napSeq).padStart(3, "0")}`;
          const napDistrict = secDistrict; // NAP sits in its splitter's district
          const nx = jitter(rng, napDistrict.grid_x, 18);
          const ny = jitter(rng, napDistrict.grid_y, 18);
          truth.push({
            element_id: napId,
            kind: "nap",
            parent_id: secId,
            grid_x: nx,
            grid_y: ny,
            district_id: napDistrict.id,
            label: `${napId} · ${napDistrict.name}`,
            split_ratio: null,
            tier: null,
          });

          // 10–18 ONTs/lines per NAP.
          const ontCount = rng.int(10, 18);
          for (let e = 0; e < ontCount; e++) {
            ontSeq++;
            const ontId = `ONT-${String(ontSeq).padStart(4, "0")}`;
            truth.push({
              element_id: ontId,
              kind: "ont",
              parent_id: napId,
              grid_x: jitter(rng, nx, 6),
              grid_y: jitter(rng, ny, 6),
              district_id: napDistrict.id,
              label: ontId,
              split_ratio: null,
              tier: null,
            });
          }
        }
      }
    }
  }

  // ---- Recorded copy: mis-map ~15% of lines, drop some coordinates ----
  const napsByDistrict = new Map<string, string[]>();
  for (const el of truth) {
    if (el.kind === "nap" && el.district_id) {
      const arr = napsByDistrict.get(el.district_id) ?? [];
      arr.push(el.element_id);
      napsByDistrict.set(el.district_id, arr);
    }
  }
  const truthById = new Map(truth.map((t) => [t.element_id, t]));

  // Track how many mismapped lines each NAP is (wrongly) credited with, so we
  // can lower record_confidence on conflicted NAPs honestly.
  const napMismapDelta = new Map<string, number>();

  const recorded: RecordedElement[] = truth.map((el) => {
    let parentRec = el.parent_id;
    let mismapped = 0;
    let conf = rng.float(0.9, 1.0);
    let gx = el.grid_x;
    let gy = el.grid_y;

    if (el.kind === "ont") {
      // 15% of lines recorded under the wrong NAP (a different NAP, same district).
      if (rng.bool(0.15)) {
        const trueNap = truthById.get(el.parent_id!);
        const candidates = (napsByDistrict.get(el.district_id ?? "") ?? []).filter(
          (id) => id !== el.parent_id
        );
        if (candidates.length > 0) {
          const wrong = rng.pick(candidates);
          parentRec = wrong;
          mismapped = 1;
          conf = rng.float(0.4, 0.68);
          napMismapDelta.set(wrong, (napMismapDelta.get(wrong) ?? 0) + 1);
          napMismapDelta.set(trueNap!.element_id, (napMismapDelta.get(trueNap!.element_id) ?? 0) - 1);
        }
      }
    }

    // Some elements missing coordinates in plant records (~6%).
    if (rng.bool(0.06)) {
      gx = null;
      gy = null;
      conf = Math.min(conf, rng.float(0.55, 0.75));
    }

    return {
      element_id: el.element_id,
      kind: el.kind,
      parent_id_recorded: parentRec,
      grid_x: gx,
      grid_y: gy,
      district_id: el.district_id,
      record_confidence: conf,
      mismapped,
    };
  });

  // Lower confidence on NAPs whose recorded child set conflicts with truth.
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
  const missingCoords = world.recorded.filter((r) => r.grid_x === null).length;
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
