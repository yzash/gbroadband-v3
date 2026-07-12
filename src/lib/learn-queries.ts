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

  // Retention lift vs the 10% holdout (churn hazard among impacted subscribers).
  const avgHaz = (holdout: number) =>
    (db
      .prepare(
        `SELECT COALESCE(AVG(s.churn_hazard),0) a
           FROM subscribers s
          WHERE s.holdout=? AND s.line_id IN (SELECT DISTINCT line_id FROM blast_radius)`
      )
      .get(holdout) as { a: number }).a;
  const holdoutHaz = avgHaz(1);
  const treatedHaz = avgHaz(0);
  const lift = holdoutHaz > 0 ? (holdoutHaz - treatedHaz) / holdoutHaz : 0;

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
    retention: { holdoutHaz, treatedHaz, lift },
    corrections,
    correctionsAccepted,
    correctionsSuggested,
    reopened,
    modelVersion: sim.model_version,
    models,
    mttrSample,
  };
}
