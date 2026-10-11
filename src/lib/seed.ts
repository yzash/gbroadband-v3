import { getDb, wipeAll, type DB } from "./db";
import { RNG } from "./rng";
import { generateWorld, worldStats, type GenWorld } from "./topology";
import type { FaultKind } from "./types";

const SEED = Number(process.env.SDAL_SEED ?? 42);

// Base MTTR (p50 hours) per fault class before vendor/area adjustment.
const BASE_MTTR: Record<FaultKind, number> = {
  feeder_cut: 6.0,
  distribution_cut: 4.0,
  splitter_failure: 3.0,
  olt_port_failure: 2.5,
  power_outage: 3.5,
  drop_cut: 1.5,
  cpe_issue: 0.5,
  noise: 1.0,
};

const AREA_FACTOR: Record<string, number> = { urban: 0.9, suburban: 1.1, fringe: 1.4 };

interface Vendor {
  id: string;
  name: string;
  skills: FaultKind[];
  quality: number;
}

const VENDORS: Vendor[] = [
  { id: "V1", name: "Northline Fiber", skills: ["feeder_cut", "distribution_cut", "drop_cut"], quality: 0.86 },
  { id: "V2", name: "Southgrid Splice", skills: ["feeder_cut", "distribution_cut", "drop_cut"], quality: 0.78 },
  { id: "V3", name: "CoreOptics Equipment", skills: ["olt_port_failure", "splitter_failure"], quality: 0.9 },
  { id: "V4", name: "MetroDrop Services", skills: ["drop_cut", "cpe_issue"], quality: 0.72 },
];

export interface SeedResult {
  seed: number;
  stats: ReturnType<typeof worldStats>;
  vendors: number;
  subscribers: number;
}

export function seedWorld(db: DB = getDb()): SeedResult {
  const rng = new RNG(SEED);
  const world: GenWorld = generateWorld(SEED);
  const stats = worldStats(world);

  const tx = db.transaction(() => {
    wipeAll(db);

    // ---- sim_state singleton ----
    db.prepare(
      `INSERT INTO sim_state (id, sim_min, speed, running, seed, sensing_coverage, alarm_delay_min, dead_olt, repair_window_hrs, model_version)
       VALUES (1, 0, 0, 0, ?, 0.70, 20, NULL, 6.0, 1)`
    ).run(SEED);

    db.prepare(`INSERT INTO model_versions (version, created_at, note, metrics_json) VALUES (1, 0, 'seed baseline', '{}')`).run();

    // ---- districts ----
    const insDistrict = db.prepare(
      `INSERT INTO districts (id, name, city, lat, lon, grid_x, grid_y, area_class, power_grid) VALUES (?,?,?,?,?,?,?,?,?)`
    );
    for (const d of world.districts)
      insDistrict.run(d.id, d.name, d.city, d.lat, d.lon, d.grid_x, d.grid_y, d.area_class, d.power_grid);
    const areaByDistrict = new Map(world.districts.map((d) => [d.id, d.area_class]));

    // ---- topology (truth + recorded) ----
    const insTruth = db.prepare(
      `INSERT INTO topology_truth (element_id, kind, parent_id, lat, lon, grid_x, grid_y, district_id, label, split_ratio, tier)
       VALUES (@element_id,@kind,@parent_id,@lat,@lon,@grid_x,@grid_y,@district_id,@label,@split_ratio,@tier)`
    );
    for (const e of world.truth) insTruth.run(e);

    const insRec = db.prepare(
      `INSERT INTO topology_recorded (element_id, kind, parent_id_recorded, lat, lon, grid_x, grid_y, district_id, record_confidence, mismapped)
       VALUES (@element_id,@kind,@parent_id_recorded,@lat,@lon,@grid_x,@grid_y,@district_id,@record_confidence,@mismapped)`
    );
    for (const r of world.recorded) insRec.run(r);

    // ---- vendors (territories: assign each ~14 districts) ----
    const insVendor = db.prepare(
      `INSERT INTO vendors (id, name, skills_json, territories_json, quality, base_load) VALUES (?,?,?,?,?,?)`
    );
    for (const v of VENDORS) {
      const terr = rng.shuffle(world.districts).slice(0, 16).map((d) => d.id);
      insVendor.run(v.id, v.name, JSON.stringify(v.skills), JSON.stringify(terr), v.quality, rng.int(0, 2));
    }

    // ---- subscribers, lines, sensing, telemetry ----
    const onts = world.truth.filter((e) => e.kind === "ont");
    const insSub = db.prepare(
      `INSERT INTO subscribers (id, line_id, name, arpu, vip, b2b, calling_propensity, holdout, tenure_days, churn_hazard, churned)
       VALUES (?,?,?,?,?,?,?,?,?,0,0)`
    );
    const insLine = db.prepare(`INSERT INTO lines (line_id, subscriber_id, status) VALUES (?,?,'online')`);
    const insSensing = db.prepare(`INSERT INTO sensing (line_id, polled, dying_gasp_capable) VALUES (?,?,?)`);
    const insTel = db.prepare(
      `INSERT INTO telemetry_latest (line_id, rx_power, reachable, los, dying_gasp, updated_at) VALUES (?,?,1,0,0,0)`
    );

    let subN = 0;
    for (const ont of onts) {
      subN++;
      const subId = `SUB-${String(subN).padStart(4, "0")}`;
      const b2b = rng.bool(0.1) ? 1 : 0;
      const vip = b2b ? (rng.bool(0.35) ? 1 : 0) : rng.bool(0.03) ? 1 : 0;
      const arpu = b2b
        ? rng.float(2000, 8000)
        : vip
        ? rng.float(1500, 3000)
        : rng.float(300, 1500);
      // Calling propensity skewed low — many are silent sufferers.
      const propensity = Math.min(0.95, Math.max(0.03, rng.gaussian(vip || b2b ? 0.6 : 0.35, 0.2)));
      const holdout = rng.bool(0.1) ? 1 : 0;
      const tenure = rng.int(30, 3000);
      insSub.run(subId, ont.element_id, subId, Math.round(arpu), vip, b2b, Number(propensity.toFixed(3)), holdout, tenure);
      insLine.run(ont.element_id, subId);

      const polled = rng.bool(0.7) ? 1 : 0;
      const dgc = rng.bool(0.8) ? 1 : 0;
      insSensing.run(ont.element_id, polled, dgc);
      // A telemetry row exists for every line so the dying-gasp column can be
      // set even for dark (un-polled) ONTs — dying-gasp is pushed via the OLT,
      // not polled. Dark lines keep rx_power NULL / reachable 1 (no polling).
      insTel.run(ont.element_id, polled ? Number(rng.gaussian(-18, 1.5).toFixed(2)) : null);
    }

    // ---- MTTR model (fault_kind × vendor × area) ----
    const insMttr = db.prepare(
      `INSERT INTO mttr_model (fault_kind, vendor_id, area_class, p50_hrs, p90_hrs, samples, version) VALUES (?,?,?,?,?,?,1)`
    );
    const faultKinds = Object.keys(BASE_MTTR) as FaultKind[];
    for (const fk of faultKinds) {
      for (const v of VENDORS) {
        const canDo = v.skills.includes(fk) || fk === "power_outage" || fk === "noise";
        if (!canDo) continue;
        for (const area of ["urban", "suburban", "fringe"]) {
          const base = BASE_MTTR[fk] * AREA_FACTOR[area];
          const p50 = base * (1.15 - v.quality * 0.3); // better vendor → lower MTTR
          const p90 = p50 * rng.float(1.6, 2.0);
          insMttr.run(fk, v.id, area, Number(p50.toFixed(2)), Number(p90.toFixed(2)), rng.int(20, 80));
        }
      }
    }

    // ---- signal sources ----
    const insSig = db.prepare(
      `INSERT INTO signal_sources (id, name, kind, reliability, status) VALUES (?,?,?,?,?)`
    );
    insSig.run("TICKETING", "Customer tickets", "tickets", 0.95, "live");
    insSig.run("TELEMETRY", "ONT telemetry (Rx/LOS)", "telemetry", 0.9, "live");
    insSig.run("REACHABILITY", "Reachability probes", "reachability", 0.85, "live");
    insSig.run("ALARM", "OLT alarm feed", "alarm", 0.8, "delayed");
    insSig.run("DYING_GASP", "Dying-gasp last breath", "dying_gasp", 0.75, "live");

    // keep areaByDistrict referenced (used by engine later; silence lints)
    void areaByDistrict;
  });

  tx();

  return { seed: SEED, stats, vendors: VENDORS.length, subscribers: stats.lines };
}
