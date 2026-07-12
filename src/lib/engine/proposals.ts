import type { DB } from "../db";
import { getSimState } from "../db";
import type { RNG } from "../rng";
import type { TopoIndex } from "./topo-index";
import type { FaultKind } from "../types";
import type { Role, ProposalKind } from "../roles";
import { canApprove } from "../roles";

const TEST_THRESHOLD = 0.75;

let proposalSeq = 0;
export function resetProposalSeq(db: DB) {
  proposalSeq = (db.prepare("SELECT COUNT(*) n FROM proposals").get() as { n: number }).n;
}
function newProposalId(): string {
  proposalSeq++;
  return `PROP-${String(proposalSeq).padStart(3, "0")}`;
}
let crewSeq = 0;
export function resetCrewSeq(db: DB) {
  crewSeq = (db.prepare("SELECT COUNT(*) n FROM crew_jobs").get() as { n: number }).n;
}
function newCrewId(): string {
  crewSeq++;
  return `JOB-${String(crewSeq).padStart(3, "0")}`;
}

function det01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function partsHint(kind: FaultKind): string {
  switch (kind) {
    case "feeder_cut":
    case "distribution_cut":
    case "drop_cut":
      return "splice kit + fiber";
    case "splitter_failure":
      return "1:8 splitter module";
    case "olt_port_failure":
      return "OLT line card";
    default:
      return "n/a";
  }
}

function logEvent(db: DB, simMin: number, kind: string, text: string, href: string | null, source: string) {
  db.prepare("INSERT INTO events (sim_ts, kind, text, href, source) VALUES (?,?,?,?,?)").run(simMin, kind, text, href, source);
}
function audit(db: DB, simMin: number, role: string, action: string, entityType: string, entityId: string, detail: object) {
  db.prepare("INSERT INTO audit_log (sim_ts, actor_role, action, entity_type, entity_id, detail_json) VALUES (?,?,?,?,?,?)").run(
    simMin,
    role,
    action,
    entityType,
    entityId,
    JSON.stringify(detail)
  );
}
export function bumpLearn(db: DB, day: number, field: string, by = 1) {
  db.prepare(`INSERT INTO learn_daily (day) VALUES (?) ON CONFLICT(day) DO NOTHING`).run(day);
  db.prepare(`UPDATE learn_daily SET ${field} = ${field} + ? WHERE day=?`).run(by, day);
}

interface IncidentRow {
  id: string;
  fault_id: string | null;
  state: string;
  fault_kind: FaultKind | null;
  top_suspect: string | null;
  top_confidence: number;
  vendor_id: string | null;
  eta_hrs: number | null;
  predicted_mttr_p50: number;
  predicted_mttr_p90: number;
  area_class: string | null;
  observed_count: number;
  inferred_count: number;
  worst_hours_down: number;
}

/** Auto-generate the gated proposal ladder for each open incident (idempotent). */
export function generateProposals(db: DB, topo: TopoIndex): void {
  const sim = getSimState(db)!;
  const day = Math.floor(sim.sim_min / 1440);
  const incidents = db
    .prepare(
      `SELECT id, fault_id, state, fault_kind, top_suspect, top_confidence, vendor_id, eta_hrs,
              predicted_mttr_p50, predicted_mttr_p90, area_class, observed_count, inferred_count, worst_hours_down
         FROM incidents WHERE state IN ('isolating','confirmed','repairing')`
    )
    .all() as IncidentRow[];

  const hasProposal = db.prepare("SELECT 1 FROM proposals WHERE incident_id=? AND kind=? LIMIT 1");
  const vendorName = (id: string | null) =>
    id ? (db.prepare("SELECT name FROM vendors WHERE id=?").get(id) as { name: string } | undefined)?.name ?? id : null;

  // Incidents currently repairing (for child-hold checks).
  const repairingSuspects = (db
    .prepare("SELECT top_suspect FROM incidents WHERE state='repairing' AND top_suspect IS NOT NULL")
    .all() as { top_suspect: string }[]).map((r) => r.top_suspect);

  for (const inc of incidents) {
    if (!inc.fault_kind || !inc.top_suspect) continue;
    const vName = vendorName(inc.vendor_id);

    // 1) Remote action — CPE-suspect single lines (no truck).
    if (inc.fault_kind === "cpe_issue" && !exists(hasProposal, inc.id, "remote_action")) {
      create(db, inc.id, "remote_action", inc.top_suspect, inc.vendor_id, sim.sim_min, {
        title: "Remote diagnostic + reboot",
        detail: `Line ${inc.top_suspect} looks CPE-side — try remote diagnostic then reboot before any truck.`,
        target: inc.top_suspect,
      });
    }

    // 2) Confirming test — when isolation confidence is low.
    if (
      inc.top_confidence < TEST_THRESHOLD &&
      !["cpe_issue", "drop_cut", "power_outage"].includes(inc.fault_kind) &&
      !exists(hasProposal, inc.id, "confirming_test")
    ) {
      const test = (db.prepare("SELECT confirming_test FROM incidents WHERE id=?").get(inc.id) as { confirming_test: string | null }).confirming_test;
      create(db, inc.id, "confirming_test", inc.top_suspect, inc.vendor_id, sim.sim_min, {
        title: "Confirming test",
        detail: test ?? "Run confirming test to harden isolation.",
        target: inc.top_suspect,
      });
    }

    // 3) Dispatch — trucks only; never for CPE or power outage.
    if (!["cpe_issue", "power_outage"].includes(inc.fault_kind) && !exists(hasProposal, inc.id, "dispatch")) {
      // Child-hold: is an ancestor of this suspect already being repaired?
      const ancestors = topo.ancestors(inc.top_suspect);
      const heldBy = repairingSuspects.find((s) => ancestors.includes(s));
      if (heldBy) {
        create(db, inc.id, "dispatch", inc.top_suspect, inc.vendor_id, sim.sim_min, {
          title: "Dispatch (held)",
          detail: `Upstream fix pending at ${heldBy} — child dispatch held to avoid a duplicate roll.`,
          target: inc.top_suspect,
          vendorName: vName,
          partsHint: partsHint(inc.fault_kind),
          held: true,
          heldReason: `upstream repair at ${heldBy}`,
        });
        bumpLearn(db, day, "rolls_avoided", 1); // duplicate roll avoided via child-hold
        logEvent(db, sim.sim_min, "hold", `${inc.id} dispatch held — upstream fix at ${heldBy}`, `/incidents?id=${inc.id}`, "SYSTEM");
      } else {
        create(db, inc.id, "dispatch", inc.top_suspect, inc.vendor_id, sim.sim_min, {
          title: "Dispatch to suspect element",
          detail: `Roll ${vName ?? "a crew"} to ${inc.top_suspect}${inc.area_class ? ` (${inc.area_class})` : ""}.`,
          target: inc.top_suspect,
          vendorName: vName,
          partsHint: partsHint(inc.fault_kind),
          etaHrs: inc.predicted_mttr_p50,
        });
      }
    }

    // 4) Notification to the blast radius (cause + ETA).
    if (!exists(hasProposal, inc.id, "notification")) {
      const total = inc.observed_count + inc.inferred_count;
      const cause = causeText(inc.fault_kind);
      create(db, inc.id, "notification", inc.top_suspect, inc.vendor_id, sim.sim_min, {
        title: "Proactive customer notification",
        detail: `Notify ${total} affected customers — including the ${inc.inferred_count} who haven't called.`,
        recipients: total,
        cause,
        etaHrs: inc.eta_hrs ?? inc.predicted_mttr_p50,
        messagePreview: notificationMessage(cause, inc.eta_hrs ?? inc.predicted_mttr_p50),
      });
      // Power outage: notifying instead of rolling a fiber crew = a wrong roll avoided.
      if (inc.fault_kind === "power_outage") {
        bumpLearn(db, day, "rolls_avoided", 1);
        logEvent(db, sim.sim_min, "guardrail", `${inc.id} is a power outage — notify + monitor, no fiber crew`, `/incidents?id=${inc.id}`, "SYSTEM");
      }
    }

    // 5) Credit — for lines already past the repair window.
    if (inc.worst_hours_down > sim.repair_window_hrs && !exists(hasProposal, inc.id, "credit")) {
      const pastWindow = (db
        .prepare("SELECT COUNT(*) n FROM blast_radius WHERE incident_id=? AND hours_down > ?")
        .get(inc.id, sim.repair_window_hrs) as { n: number }).n;
      create(db, inc.id, "credit", inc.top_suspect, inc.vendor_id, sim.sim_min, {
        title: "Service credits (past window)",
        detail: `${pastWindow} line${pastWindow === 1 ? "" : "s"} past the ${sim.repair_window_hrs}h window — issue goodwill credits.`,
        recipients: pastWindow,
      });
    }
  }
  void day;
}

function exists(stmt: import("better-sqlite3").Statement, incidentId: string, kind: string): boolean {
  return !!stmt.get(incidentId, kind);
}
function create(
  db: DB,
  incidentId: string,
  kind: ProposalKind,
  target: string | null,
  vendorId: string | null,
  simMin: number,
  payload: object
) {
  const id = newProposalId();
  db.prepare(
    "INSERT INTO proposals (id, incident_id, kind, state, payload_json, target_element, vendor_id, created_at) VALUES (?,?,?,'pending',?,?,?,?)"
  ).run(id, incidentId, kind, JSON.stringify(payload), target, vendorId, simMin);
  logEvent(db, simMin, "proposal", `Proposed ${kind.replace("_", " ")} for ${incidentId}`, `/incidents?id=${incidentId}`, "SYSTEM");
}

function causeText(kind: FaultKind): string {
  const map: Record<FaultKind, string> = {
    feeder_cut: "a fiber cut affecting your area",
    distribution_cut: "a fiber cut affecting your area",
    splitter_failure: "faulty street-side equipment",
    olt_port_failure: "an exchange-side equipment fault",
    power_outage: "a commercial power outage in your area",
    drop_cut: "a cut on your service line",
    cpe_issue: "an issue with your home equipment",
    noise: "intermittent signal noise",
  };
  return map[kind];
}
function notificationMessage(cause: string, eta: number): string {
  const window = eta >= 1 ? `${eta.toFixed(1)} hours` : `${Math.round(eta * 60)} minutes`;
  return `We've detected ${cause} and our team is already on it. We estimate service will be restored within ~${window}. We'll update you when it's fixed. — Globe Broadband`;
}

// ---- Decision / execution ----

export interface DecideResult {
  ok: boolean;
  error?: string;
}

export function decideProposal(
  db: DB,
  topo: TopoIndex,
  rng: RNG,
  proposalId: string,
  decision: "approve" | "reject" | "edit",
  role: Role,
  rationale?: string
): DecideResult {
  const p = db.prepare("SELECT * FROM proposals WHERE id=?").get(proposalId) as
    | {
        id: string;
        incident_id: string;
        kind: ProposalKind;
        state: string;
        payload_json: string;
        target_element: string | null;
        vendor_id: string | null;
      }
    | undefined;
  if (!p) return { ok: false, error: "proposal not found" };
  if (p.state !== "pending") return { ok: false, error: `already ${p.state}` };
  if (!canApprove(role, p.kind)) return { ok: false, error: `${role} cannot approve ${p.kind}` };

  const sim = getSimState(db)!;
  const payload = JSON.parse(p.payload_json) as Record<string, unknown>;

  if (decision === "reject") {
    db.prepare("UPDATE proposals SET state='rejected', decided_at=?, decided_by_role=?, rationale=? WHERE id=?").run(
      sim.sim_min,
      role,
      rationale ?? null,
      proposalId
    );
    audit(db, sim.sim_min, role, "reject", "proposal", proposalId, { kind: p.kind });
    logEvent(db, sim.sim_min, "decision", `${role} rejected ${p.kind.replace("_", " ")} (${p.incident_id})`, `/incidents?id=${p.incident_id}`, role.toUpperCase());
    return { ok: true };
  }

  if (payload.held) return { ok: false, error: "dispatch is held pending an upstream fix" };

  // approve (edit treated as approve-with-note)
  db.prepare("UPDATE proposals SET state='approved', decided_at=?, decided_by_role=?, rationale=? WHERE id=?").run(
    sim.sim_min,
    role,
    rationale ?? (decision === "edit" ? "edited then approved" : null),
    proposalId
  );
  audit(db, sim.sim_min, role, decision, "proposal", proposalId, { kind: p.kind, target: p.target_element });

  executeProposal(db, topo, rng, p, payload, role, sim.sim_min);
  db.prepare("UPDATE proposals SET state='executed' WHERE id=?").run(proposalId);
  return { ok: true };
}

function executeProposal(
  db: DB,
  topo: TopoIndex,
  rng: RNG,
  p: { id: string; incident_id: string; kind: ProposalKind; target_element: string | null; vendor_id: string | null },
  payload: Record<string, unknown>,
  role: Role,
  simMin: number
) {
  const inc = db.prepare("SELECT * FROM incidents WHERE id=?").get(p.incident_id) as IncidentRow & { fault_id: string | null };
  const day = Math.floor(simMin / 1440);

  switch (p.kind) {
    case "remote_action": {
      const line = p.target_element!;
      db.prepare("INSERT INTO remote_actions (id, line_id, incident_id, kind, result, sim_ts) VALUES (?,?,?,?,?,?)").run(
        `RA-${p.id}`,
        line,
        p.incident_id,
        "diagnostic",
        "no LOS · CPE unresponsive",
        simMin
      );
      const success = det01(p.id + "reboot") < 0.75;
      db.prepare("INSERT INTO remote_actions (id, line_id, incident_id, kind, result, sim_ts) VALUES (?,?,?,?,?,?)").run(
        `RA-${p.id}-rb`,
        line,
        p.incident_id,
        "reboot",
        success ? "recovered after reboot" : "no change — needs a truck",
        simMin
      );
      logEvent(db, simMin, "remote", `Remote reboot ${success ? "recovered" : "did not fix"} ${line}`, `/incidents?id=${p.incident_id}`, "REMOTE");
      if (success && inc.fault_id) resolveFault(db, topo, inc, p.target_element, role, simMin, true, "remote");
      break;
    }
    case "confirming_test": {
      db.prepare("UPDATE incidents SET top_confidence=MAX(top_confidence, 0.9), state=CASE WHEN state='isolating' THEN 'confirmed' ELSE state END WHERE id=?").run(p.incident_id);
      logEvent(db, simMin, "test", `Confirming test corroborated break near ${p.target_element}`, `/incidents?id=${p.incident_id}`, "NOC");
      break;
    }
    case "dispatch": {
      const node = topo.node(p.target_element ?? "");
      const area = inc.area_class ?? "urban";
      const travel = area === "urban" ? 25 : area === "suburban" ? 55 : 90;
      const travelMin = Math.round(travel * (0.8 + 0.4 * det01(p.id + "tr")));
      const repairHrs = inc.predicted_mttr_p50 * (0.75 + 0.5 * det01(p.id + "rp"));
      const arrival = simMin + travelMin;
      const done = arrival + Math.round(repairHrs * 60);
      db.prepare(
        "INSERT INTO crew_jobs (id, proposal_id, incident_id, vendor_id, target_element, grid_x, grid_y, state, dispatched_at, arrived_at, done_at) VALUES (?,?,?,?,?,?,?,'enroute',?,?,?)"
      ).run(newCrewId(), p.id, p.incident_id, p.vendor_id, p.target_element, node?.grid_x ?? null, node?.grid_y ?? null, simMin, arrival, done);
      db.prepare("UPDATE incidents SET state='repairing' WHERE id=?").run(p.incident_id);
      logEvent(db, simMin, "dispatch", `Crew dispatched to ${p.target_element} (${payload.vendorName ?? p.vendor_id}) · parts: ${payload.partsHint}`, `/incidents?id=${p.incident_id}`, role.toUpperCase());
      break;
    }
    case "notification": {
      const recipients = (payload.recipients as number) ?? 0;
      db.prepare(
        "INSERT INTO notifications (id, incident_id, proposal_id, lines_count, message_template, eta_given_hrs, sent_at, followup_kind) VALUES (?,?,?,?,?,?,?,?)"
      ).run(`NOTIF-${p.id}`, p.incident_id, p.id, recipients, String(payload.messagePreview ?? ""), (payload.etaHrs as number) ?? null, simMin, "progress");
      db.prepare("UPDATE blast_radius SET notified_at=? WHERE incident_id=? AND notified_at IS NULL").run(simMin, p.incident_id);
      logEvent(db, simMin, "notify", `Notified ${recipients} customers · cause + ETA sent (${p.incident_id})`, `/incidents?id=${p.incident_id}`, role.toUpperCase());
      break;
    }
    case "credit": {
      db.prepare(
        "INSERT INTO notifications (id, incident_id, proposal_id, lines_count, message_template, eta_given_hrs, sent_at, followup_kind) VALUES (?,?,?,?,?,?,?,?)"
      ).run(`CR-${p.id}`, p.incident_id, p.id, (payload.recipients as number) ?? 0, "Service credit applied for the outage window.", null, simMin, "credit");
      // Credits reduce churn hazard on affected subscribers.
      db.prepare(
        `UPDATE subscribers SET churn_hazard = MAX(0, churn_hazard - 0.15)
          WHERE line_id IN (SELECT line_id FROM blast_radius WHERE incident_id=?)`
      ).run(p.incident_id);
      logEvent(db, simMin, "credit", `Credits issued for past-window lines (${p.incident_id})`, `/incidents?id=${p.incident_id}`, role.toUpperCase());
      break;
    }
  }
  void day;
}

/** Advance crew jobs over sim-time; complete repairs and resolve faults. */
export function crewStep(db: DB, topo: TopoIndex, simMin: number): void {
  const jobs = db.prepare("SELECT * FROM crew_jobs WHERE state != 'done'").all() as {
    id: string;
    incident_id: string;
    target_element: string;
    state: string;
    proposal_id: string | null;
    arrived_at: number | null;
    done_at: number | null;
    vendor_id: string;
  }[];

  for (const j of jobs) {
    if (j.state === "enroute" && j.arrived_at !== null && simMin >= j.arrived_at) {
      db.prepare("UPDATE crew_jobs SET state='onsite' WHERE id=?").run(j.id);
      logEvent(db, simMin, "crew", `Crew on site at ${j.target_element}`, `/incidents?id=${j.incident_id}`, "FIELD");
    }
    const cur = db.prepare("SELECT state FROM crew_jobs WHERE id=?").get(j.id) as { state: string };
    if (cur.state === "onsite" && j.done_at !== null && simMin >= j.done_at) {
      const inc = db.prepare("SELECT * FROM incidents WHERE id=?").get(j.incident_id) as IncidentRow & { fault_id: string | null };
      // Correct if the true fault element is at/under the dispatch target (truth).
      const fault = inc.fault_id ? (db.prepare("SELECT element_id FROM faults WHERE id=?").get(inc.fault_id) as { element_id: string | null } | undefined) : undefined;
      const truthEl = fault?.element_id ?? null;
      const correct = truthEl ? truthEl === j.target_element || topo.ancestors(truthEl).includes(j.target_element) : true;
      const foundAt = correct ? j.target_element : truthEl ?? j.target_element;
      db.prepare("UPDATE crew_jobs SET state='done', done_at=?, found_at_element=?, correct=? WHERE id=?").run(simMin, foundAt, correct ? 1 : 0, j.id);
      db.prepare(
        "INSERT INTO dispatch_quality (proposal_id, incident_id, sent_to_element, found_at_element, correct, sim_ts) VALUES (?,?,?,?,?,?) ON CONFLICT(proposal_id) DO NOTHING"
      ).run(j.proposal_id ?? j.id, j.incident_id, j.target_element, foundAt, correct ? 1 : 0, simMin);
      logEvent(
        db,
        simMin,
        "repair",
        correct ? `Repair complete at ${j.target_element}` : `Wrong location — fault was at ${foundAt}, re-worked`,
        `/incidents?id=${j.incident_id}`,
        "FIELD"
      );
      resolveFault(db, topo, inc, foundAt, "noc_lead", simMin, correct, "dispatch");
    }
  }
}

const VERIFY_WINDOW = 20; // sim-minutes to confirm recovery post-repair

/** Attempt a repair, then enter the verification window (M8 confirms or reopens). */
function resolveFault(
  db: DB,
  topo: TopoIndex,
  inc: IncidentRow & { fault_id: string | null },
  foundAt: string | null,
  _role: Role,
  simMin: number,
  correct: boolean,
  _via: "remote" | "dispatch"
): void {
  // Only a correct repair actually clears the underlying fault; a wrong roll
  // leaves it live, so verification will catch it and reopen.
  if (inc.fault_id && correct) {
    db.prepare("UPDATE faults SET resolved=1, cleared_at=? WHERE id=?").run(simMin, inc.fault_id);
  }
  db.prepare("UPDATE incidents SET state='verifying', verify_until=?, top_suspect=COALESCE(?, top_suspect) WHERE id=?").run(
    simMin + VERIFY_WINDOW,
    foundAt,
    inc.id
  );
  void topo;
}
