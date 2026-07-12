import type { DB } from "../db";
import { getSimState } from "../db";

/**
 * Retrain the MTTR model from observed outcomes: blend each class×vendor×area
 * p50 toward the realized average, publish a new model version, and let
 * prioritization re-rank against it.
 */
export function retrainModel(db: DB): { version: number; adjusted: number } {
  const sim = getSimState(db)!;
  const oldV = sim.model_version;
  const newV = oldV + 1;

  // Observed average MTTR per class × vendor × area from verified outcomes.
  const observed = db
    .prepare(
      `SELECT i.fault_kind, i.vendor_id, i.area_class, AVG(o.mttr_actual_hrs) avg_mttr, COUNT(*) n
         FROM outcomes o JOIN incidents i ON i.id = o.incident_id
        WHERE o.mttr_actual_hrs IS NOT NULL AND i.vendor_id IS NOT NULL AND i.fault_kind IS NOT NULL AND i.area_class IS NOT NULL
        GROUP BY i.fault_kind, i.vendor_id, i.area_class`
    )
    .all() as { fault_kind: string; vendor_id: string; area_class: string; avg_mttr: number; n: number }[];
  const obsMap = new Map(observed.map((o) => [`${o.fault_kind}|${o.vendor_id}|${o.area_class}`, o]));

  const current = db.prepare("SELECT * FROM mttr_model WHERE version=?").all(oldV) as {
    fault_kind: string;
    vendor_id: string;
    area_class: string;
    p50_hrs: number;
    p90_hrs: number;
    samples: number;
  }[];

  const ins = db.prepare(
    "INSERT INTO mttr_model (fault_kind, vendor_id, area_class, p50_hrs, p90_hrs, samples, version) VALUES (?,?,?,?,?,?,?)"
  );
  let adjusted = 0;
  const tx = db.transaction(() => {
    for (const row of current) {
      const obs = obsMap.get(`${row.fault_kind}|${row.vendor_id}|${row.area_class}`);
      let p50 = row.p50_hrs;
      let samples = row.samples;
      if (obs && obs.n > 0) {
        p50 = 0.6 * row.p50_hrs + 0.4 * obs.avg_mttr;
        samples = row.samples + obs.n;
        adjusted++;
      }
      const p90 = Math.max(p50 * 1.6, row.p90_hrs * 0.5 + p50 * 0.9);
      ins.run(row.fault_kind, row.vendor_id, row.area_class, Number(p50.toFixed(2)), Number(p90.toFixed(2)), samples, newV);
    }
    db.prepare("UPDATE sim_state SET model_version=? WHERE id=1").run(newV);
    db.prepare("INSERT INTO model_versions (version, created_at, note, metrics_json) VALUES (?,?,?,?)").run(
      newV,
      sim.sim_min,
      `retrain from ${observed.reduce((a, o) => a + o.n, 0)} outcomes`,
      JSON.stringify({ adjusted })
    );
    db.prepare("INSERT INTO events (sim_ts, kind, text, href, source) VALUES (?,?,?,?,?)").run(
      sim.sim_min,
      "correction",
      `MTTR model retrained → v${newV} (${adjusted} cells adjusted) · incidents re-ranked`,
      null,
      "LEARN"
    );
  });
  tx();
  return { version: newV, adjusted };
}
