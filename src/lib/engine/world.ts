import type { DB } from "../db";
import type { RNG } from "../rng";
import { activeFaults, faultImpact, type FaultRow } from "./faults";
import type { TopoIndex } from "./topo-index";

export interface ImpactState {
  status: "offline" | "degraded";
  powerLoss: boolean;
  faultId: string;
}

export interface SensingSets {
  polled: Set<string>;
  dgc: Set<string>;
  coverage: number;
  deadOlt: string | null;
}

export function loadSensing(db: DB): SensingSets {
  const rows = db.prepare("SELECT line_id, polled, dying_gasp_capable FROM sensing").all() as {
    line_id: string;
    polled: number;
    dying_gasp_capable: number;
  }[];
  const polled = new Set<string>();
  const dgc = new Set<string>();
  for (const r of rows) {
    if (r.polled) polled.add(r.line_id);
    if (r.dying_gasp_capable) dgc.add(r.line_id);
  }
  const st = db.prepare("SELECT sensing_coverage, dead_olt FROM sim_state WHERE id=1").get() as {
    sensing_coverage: number;
    dead_olt: string | null;
  };
  return { polled, dgc, coverage: st.sensing_coverage, deadOlt: st.dead_olt };
}

/** Current impacted lines derived from all active faults (offline beats degraded). */
export function recomputeImpact(db: DB, topo: TopoIndex): Map<string, ImpactState> {
  const map = new Map<string, ImpactState>();
  for (const f of activeFaults(db) as FaultRow[]) {
    const imp = faultImpact(f, topo);
    for (const line of imp.lines) {
      const existing = map.get(line);
      if (!existing || (existing.status === "degraded" && imp.status === "offline")) {
        map.set(line, { status: imp.status, powerLoss: imp.powerLoss, faultId: f.id });
      } else if (imp.powerLoss) {
        existing.powerLoss = true;
      }
    }
  }
  return map;
}

/**
 * Apply the diff between the previous and next impacted sets to lines + telemetry.
 * Returns the lines that just recovered (for ticket closure) and change count.
 */
export function applyLineChanges(
  db: DB,
  prev: Map<string, ImpactState>,
  next: Map<string, ImpactState>,
  sensing: SensingSets,
  simMin: number
): { recovered: string[]; changed: number } {
  const recovered: string[] = [];
  let changed = 0;

  const setLine = db.prepare(
    `UPDATE lines SET status=?, offline_since=?, degraded_since=? WHERE line_id=?`
  );
  const setTel = db.prepare(
    `UPDATE telemetry_latest SET rx_power=?, reachable=?, los=?, dying_gasp=?, updated_at=? WHERE line_id=?`
  );
  // Dark lines: only the pushed dying-gasp bit is observable (no rx/reachability).
  const setDgOnly = db.prepare(`UPDATE telemetry_latest SET dying_gasp=?, updated_at=? WHERE line_id=?`);

  const applyTelemetry = (lineId: string, imp: ImpactState | null) => {
    const dgc = sensing.dgc.has(lineId);
    // Dying-gasp fires on power-loss offline for capable ONTs, polled or not.
    const dying = imp !== null && imp.status === "offline" && imp.powerLoss && dgc ? 1 : 0;
    if (!sensing.polled.has(lineId)) {
      if (dgc) setDgOnly.run(dying, simMin, lineId); // maintain dying-gasp only
      return;
    }
    if (imp === null) {
      setTel.run(-18 + rand(lineId) * 1.5, 1, 0, 0, simMin, lineId);
    } else if (imp.status === "degraded") {
      setTel.run(-27 - rand(lineId) * 3, 1, 0, 0, simMin, lineId);
    } else {
      setTel.run(null, 0, 1, dying, simMin, lineId);
    }
  };

  // New or changed impacts.
  for (const [lineId, imp] of next) {
    const before = prev.get(lineId);
    if (!before || before.status !== imp.status || before.powerLoss !== imp.powerLoss) {
      setLine.run(
        imp.status,
        imp.status === "offline" ? simMin : null,
        imp.status === "degraded" ? simMin : null,
        lineId
      );
      applyTelemetry(lineId, imp);
      changed++;
    }
  }

  // Recovered lines (in prev, not in next).
  for (const [lineId] of prev) {
    if (!next.has(lineId)) {
      setLine.run("online", null, null, lineId);
      applyTelemetry(lineId, null);
      recovered.push(lineId);
      changed++;
    }
  }

  return { recovered, changed };
}

// Deterministic per-line jitter in [0,1) so telemetry values are stable, not RNG-drift.
function rand(lineId: string): number {
  let h = 2166136261;
  for (let i = 0; i < lineId.length; i++) {
    h ^= lineId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * Churn hazard while a line is down rises with unrepaired hours. Proactive
 * notification slows that build-up (~45%); a credit or a retention offer knocks it back. The
 * 10% holdout never receives any of them — it is the control group for the lift
 * measured on the Learn screen. Once a line recovers the risk decays slowly
 * (per sim-hour), so the treatment effect stays measurable.
 */
export function updateChurnHazard(db: DB, simMin: number, minutes = 1): void {
  db.prepare(
    `UPDATE subscribers
        SET churn_hazard = MIN(0.95, MAX(0, ROUND(
          (SELECT CASE WHEN l.offline_since IS NOT NULL
                  THEN 0.02 + (@simMin - l.offline_since) / 60.0 * 0.03
                         * (CASE WHEN subscribers.holdout = 0 AND subscribers.line_id IN
                                   (SELECT line_id FROM blast_radius WHERE notified_at IS NOT NULL)
                                 THEN 0.55 ELSE 1.0 END)
                       - (CASE WHEN subscribers.holdout = 0 AND subscribers.line_id IN
                                   (SELECT b.line_id FROM blast_radius b JOIN notifications n
                                      ON n.incident_id = b.incident_id AND n.followup_kind = 'credit')
                                 THEN 0.12 ELSE 0 END)
                       - (CASE WHEN subscribers.holdout = 0 AND subscribers.line_id IN
                                   (SELECT b.line_id FROM blast_radius b JOIN notifications n
                                      ON n.incident_id = b.incident_id AND n.followup_kind = 'offer'
                                     WHERE b.hours_down >= 3)
                                 THEN 0.08 ELSE 0 END)
                  ELSE subscribers.churn_hazard - 0.005 * @minutes / 60.0 END
             FROM lines l WHERE l.line_id = subscribers.line_id), 3)))`
  ).run({ simMin, minutes });
  // Lift is measured on the peak risk an outage caused — current hazard decays
  // toward zero after repair, which makes a ratio of current values unstable.
  db.prepare("UPDATE subscribers SET churn_peak = churn_hazard WHERE churn_hazard > churn_peak").run();
}
