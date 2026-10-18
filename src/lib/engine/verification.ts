import type { DB } from "../db";
import { getSimState } from "../db";
import type { TopoIndex } from "./topo-index";
import type { RecordedIndex } from "./recorded-index";
import { bumpLearn } from "./proposals";

function logEvent(db: DB, simMin: number, kind: string, text: string, href: string | null, source: string) {
  db.prepare("INSERT INTO events (sim_ts, kind, text, href, source) VALUES (?,?,?,?,?)").run(simMin, kind, text, href, source);
}

/**
 * Post-repair verification. Incidents in `verifying` past their window either
 * confirm recovery (→ resolved) or, if the underlying fault is still live
 * (a wrong roll), reopen — and suggest a plant-record correction from the
 * crew's finding.
 */
export function runVerification(db: DB, topo: TopoIndex, rec: RecordedIndex, simMin: number): void {
  const sim = getSimState(db)!;
  const day = Math.floor(simMin / 1440);
  const due = db
    .prepare("SELECT id, fault_id, detected_at, top_suspect, reopened_count FROM incidents WHERE state='verifying' AND verify_until IS NOT NULL AND verify_until <= ?")
    .all(simMin) as { id: string; fault_id: string | null; detected_at: number; top_suspect: string | null; reopened_count: number }[];

  for (const inc of due) {
    const fault = inc.fault_id
      ? (db.prepare("SELECT resolved, started_at, cleared_at, element_id FROM faults WHERE id=?").get(inc.fault_id) as
          | { resolved: number; started_at: number; cleared_at: number | null; element_id: string | null }
          | undefined)
      : undefined;
    const faultResolved = !inc.fault_id || fault?.resolved === 1;

    if (faultResolved) {
      const started = fault?.started_at ?? inc.detected_at;
      const cleared = fault?.cleared_at ?? simMin;
      const mttr = (cleared - started) / 60;
      const inWindow = mttr <= sim.repair_window_hrs ? 1 : 0;
      db.prepare("UPDATE incidents SET state='resolved', resolved_at=? WHERE id=?").run(simMin, inc.id);
      db.prepare(
        "INSERT INTO outcomes (id, incident_id, resolved_at, mttr_actual_hrs, in_window, verified, reopened) VALUES (?,?,?,?,?,1,0) ON CONFLICT(id) DO UPDATE SET resolved_at=excluded.resolved_at, mttr_actual_hrs=excluded.mttr_actual_hrs, in_window=excluded.in_window, verified=1"
      ).run(`OUT-${inc.id}`, inc.id, simMin, Number(mttr.toFixed(2)), inWindow);
      bumpLearn(db, day, "repairs_total", 1);
      if (inWindow) bumpLearn(db, day, "repairs_in_window", 1);
      bumpLearn(db, day, "correct_rolls", 1);
      // Close the loop with the customers we told: a restoration notice.
      const told = (db.prepare("SELECT COUNT(*) n FROM blast_radius WHERE incident_id=? AND notified_at IS NOT NULL").get(inc.id) as { n: number }).n;
      if (told > 0) {
        db.prepare(
          "INSERT INTO notifications (id, incident_id, proposal_id, lines_count, message_template, eta_given_hrs, sent_at, followup_kind, before_call) VALUES (?,?,NULL,?,?,NULL,?,'closure',0) ON CONFLICT(id) DO NOTHING"
        ).run(`CLOSE-${inc.id}`, inc.id, told, "Good news — your internet service has been restored. Thank you for your patience. — Globe Broadband", simMin);
        logEvent(db, simMin, "notify", `"Service restored" message sent to ${told} customer${told === 1 ? "" : "s"} (${inc.id})`, `/incidents?id=${inc.id}`, "CX");
      }
      logEvent(db, simMin, "verify", `Repair verified — ${inc.id} resolved in ${mttr.toFixed(1)}h (${inWindow ? "within" : "over"} window)`, `/incidents?id=${inc.id}`, "VERIFY");
    } else {
      // Wrong roll: fault still live. Reopen and suggest a record correction.
      const truthEl = fault?.element_id ?? null;
      db.prepare("UPDATE incidents SET state='reopened', reopened_count=reopened_count+1, verify_until=NULL WHERE id=?").run(inc.id);
      db.prepare(
        "INSERT INTO outcomes (id, incident_id, reopened, verified, in_window) VALUES (?,?,1,0,0) ON CONFLICT(id) DO UPDATE SET reopened=1"
      ).run(`OUT-${inc.id}`, inc.id);
      bumpLearn(db, day, "wrong_rolls", 1);
      logEvent(db, simMin, "reopen", `${inc.id} reopened — fault still live; crew found it at ${truthEl ?? "another element"}`, `/incidents?id=${inc.id}`, "VERIFY");
      suggestCorrection(db, topo, rec, inc.id, truthEl, simMin);
      // Supersede the executed dispatch so a fresh one can be proposed to the corrected locus.
      db.prepare("DELETE FROM proposals WHERE incident_id=? AND kind='dispatch'").run(inc.id);
      db.prepare("UPDATE incidents SET state='confirmed', top_suspect=COALESCE(?, top_suspect) WHERE id=?").run(truthEl, inc.id);
    }
  }
}

function suggestCorrection(
  db: DB,
  topo: TopoIndex,
  rec: RecordedIndex,
  incidentId: string,
  truthFaultEl: string | null,
  simMin: number
): void {
  if (!truthFaultEl) return;
  // Find a line truly under the fault element but recorded elsewhere.
  const lines = topo.linesUnder(truthFaultEl);
  for (const line of lines) {
    const recNode = rec.node(line);
    const truthNode = topo.node(line);
    if (recNode?.mismapped && recNode.parent && truthNode?.parent && recNode.parent !== truthNode.parent) {
      // Any existing row (suggested or accepted, from a repair or a partner close-out) wins.
      const already = db.prepare("SELECT 1 FROM record_corrections WHERE line_id=?").get(line);
      if (already) continue;
      db.prepare(
        "INSERT INTO record_corrections (id, line_id, from_parent, to_parent, source, status, incident_id, sim_ts) VALUES (?,?,?,?,?,?,?,?)"
      ).run(`RC-${line}`, line, recNode.parent, truthNode.parent, "repair_finding", "suggested", incidentId, simMin);
      logEvent(db, simMin, "correction", `Plant-record correction suggested: ${line} recorded under ${recNode.parent} → belongs to ${truthNode.parent}`, `/incidents?id=${incidentId}`, "LEARN");
      return;
    }
  }
}

/** Accept a suggested correction: rewrite the recorded parent and raise confidence. */
export function acceptCorrection(db: DB, correctionId: string, simMin: number): boolean {
  const rc = db.prepare("SELECT * FROM record_corrections WHERE id=? AND status='suggested'").get(correctionId) as
    | { id: string; line_id: string; from_parent: string; to_parent: string }
    | undefined;
  if (!rc) return false;
  db.prepare("UPDATE topology_recorded SET parent_id_recorded=?, mismapped=0, record_confidence=MIN(1.0, record_confidence+0.25) WHERE element_id=?").run(
    rc.to_parent,
    rc.line_id
  );
  // Raise confidence on the corrected parent too.
  db.prepare("UPDATE topology_recorded SET record_confidence=MIN(1.0, record_confidence+0.05) WHERE element_id=?").run(rc.to_parent);
  db.prepare("UPDATE record_corrections SET status='accepted' WHERE id=?").run(correctionId);
  logEvent(db, simMin, "correction", `Plant-record correction accepted: ${rc.line_id} → ${rc.to_parent} (record confidence raised)`, null, "LEARN");
  return true;
}
