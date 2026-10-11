import { getDb, getSimState } from "./db";

export function getLearnMetrics() {
  const db = getDb();
  const sim = getSimState(db)!;
  const n = (q: string, ...args: unknown[]) => (db.prepare(q).get(...args) as { n: number }).n;

  const deflected = n("SELECT COALESCE(SUM(calls_deflected),0) n FROM learn_daily");
  const correctRolls = n("SELECT COALESCE(SUM(correct_rolls),0) n FROM learn_daily");
  const wrongRolls = n("SELECT COALESCE(SUM(wrong_rolls),0) n FROM learn_daily");
  const rollsAvoided = n("SELECT COALESCE(SUM(rolls_avoided),0) n FROM learn_daily");
  const repairsTotal = n("SELECT COALESCE(SUM(repairs_total),0) n FROM learn_daily");
  const repairsInWindow = n("SELECT COALESCE(SUM(repairs_in_window),0) n FROM learn_daily");

  const ticketsLinked = n("SELECT COUNT(*) n FROM tickets WHERE parent_incident_id IS NOT NULL");
  const distinctIncidents = n("SELECT COUNT(DISTINCT parent_incident_id) n FROM tickets WHERE parent_incident_id IS NOT NULL");
  const dupMerged = Math.max(0, ticketsLinked - distinctIncidents);

  // Retention lift vs the 10% holdout, measured like an experiment: within the
  // incidents that received a proactive notification, compare the peak churn risk of
  // notified customers against held-out customers who got nothing.
  const avg = (sql: string) => db.prepare(sql).get() as { a: number | null; n: number };
  const treated = avg(
    `SELECT AVG(s.churn_peak) a, COUNT(*) n FROM subscribers s
      WHERE s.holdout = 0 AND s.line_id IN (SELECT line_id FROM blast_radius WHERE notified_at IS NOT NULL)`
  );
  const control = avg(
    `SELECT AVG(s.churn_peak) a, COUNT(*) n FROM subscribers s
      WHERE s.holdout = 1 AND s.line_id IN (
        SELECT b.line_id FROM blast_radius b
         WHERE b.incident_id IN (SELECT DISTINCT incident_id FROM blast_radius WHERE notified_at IS NOT NULL))`
  );
  const measurable = treated.n > 0 && control.n > 0 && (control.a ?? 0) > 0;
  const holdoutHaz = control.a ?? 0;
  const treatedHaz = treated.a ?? 0;
  const lift = measurable ? (holdoutHaz - treatedHaz) / holdoutHaz : null;

  const corrections = db
    .prepare("SELECT id, line_id, from_parent, to_parent, status, incident_id, sim_ts FROM record_corrections ORDER BY (status='suggested') DESC, sim_ts DESC LIMIT 40")
    .all() as Record<string, unknown>[];
  const correctionsAccepted = n("SELECT COUNT(*) n FROM record_corrections WHERE status='accepted'");
  const correctionsSuggested = n("SELECT COUNT(*) n FROM record_corrections WHERE status='suggested'");

  const models = db.prepare("SELECT version, created_at, note, metrics_json FROM model_versions ORDER BY version DESC LIMIT 5").all() as Record<string, unknown>[];
  const mttrSample = db
    .prepare("SELECT fault_kind, vendor_id, area_class, p50_hrs, p90_hrs, samples FROM mttr_model WHERE version=? ORDER BY fault_kind LIMIT 10")
    .all(sim.model_version) as Record<string, unknown>[];

  const reopened = n("SELECT COUNT(*) n FROM incidents WHERE reopened_count > 0");

  return {
    deflected,
    correctRolls,
    wrongRolls,
    rollsAvoided,
    wrongRollRate: correctRolls + wrongRolls > 0 ? wrongRolls / (correctRolls + wrongRolls) : 0,
    repairsTotal,
    repairsInWindow,
    repairsInWindowPct: repairsTotal > 0 ? repairsInWindow / repairsTotal : 0,
    dupMerged,
    retention: { holdoutHaz, treatedHaz, lift, treatedN: treated.n, controlN: control.n },
    corrections,
    correctionsAccepted,
    correctionsSuggested,
    reopened,
    modelVersion: sim.model_version,
    models,
    mttrSample,
  };
}
