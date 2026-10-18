import type { DB } from "../db";
import { getSimState } from "../db";
import type { RNG } from "../rng";
import type { TopoIndex } from "./topo-index";
import type { RecordedIndex } from "./recorded-index";
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
      const heldOut = (db
        .prepare("SELECT COUNT(*) n FROM blast_radius b JOIN subscribers s ON s.line_id=b.line_id WHERE b.incident_id=? AND s.holdout=1")
        .get(inc.id) as { n: number }).n;
      const recipients = Math.max(0, total - heldOut);
      create(db, inc.id, "notification", inc.top_suspect, inc.vendor_id, sim.sim_min, {
        title: "Proactive customer notification",
        detail: `Notify ${recipients} affected customers — including the silent ones who haven't called.${heldOut ? ` ${heldOut} held out as the control group.` : ""}`,
        recipients,
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

    // 6) Sales Force — account-manager heads-up to affected business accounts.
    if (!exists(hasProposal, inc.id, "account_alert")) {
      const accounts = db
        .prepare(
          `SELECT s.name FROM blast_radius b JOIN subscribers s ON s.line_id=b.line_id
            WHERE b.incident_id=? AND b.b2b=1 AND s.holdout=0 ORDER BY b.arpu DESC`
        )
        .all(inc.id) as { name: string }[];
      if (accounts.length > 0) {
        const silent = (db
          .prepare("SELECT COUNT(*) n FROM blast_radius b JOIN subscribers s ON s.line_id=b.line_id WHERE b.incident_id=? AND b.b2b=1 AND s.holdout=0 AND b.ticketed=0")
          .get(inc.id) as { n: number }).n;
        create(db, inc.id, "account_alert", inc.top_suspect, inc.vendor_id, sim.sim_min, {
          title: "Account-manager heads-up",
          detail: `Call ${accounts.length} business account${accounts.length === 1 ? "" : "s"} before they call us — ${silent} haven't reported it yet.`,
          recipients: accounts.length,
          names: accounts.slice(0, 3).map((a) => a.name),
          cause: causeText(inc.fault_kind),
          etaHrs: inc.eta_hrs ?? inc.predicted_mttr_p50,
        });
      }
    }

    // 7) CFS — a home visit only when the fault is home-side and remote fixes failed.
    if (inc.fault_kind === "cpe_issue" && !exists(hasProposal, inc.id, "home_visit")) {
      const failed = db
        .prepare("SELECT 1 FROM remote_actions WHERE incident_id=? AND kind='reboot' AND result LIKE 'no change%' LIMIT 1")
        .get(inc.id);
      if (failed) {
        const rx = (db.prepare("SELECT rx_power FROM telemetry_latest WHERE line_id=?").get(inc.top_suspect) as { rx_power: number | null } | undefined)?.rx_power;
        create(db, inc.id, "home_visit", inc.top_suspect, "CFS", sim.sim_min, {
          title: "Book a CFS home visit",
          detail: `Remote diagnostic and reboot did not fix ${inc.top_suspect}. The fault is inside the home — send a technician.`,
          target: inc.top_suspect,
          brief: `Diagnostics: no LOS, CPE unresponsive${rx != null ? ` · last Rx ${rx.toFixed(1)} dBm` : " · line not polled"} · likely part: ONT / router swap`,
        });
      }
    }

    // 8) Brand & Marketing — retention offer for customers down the longest.
    if (inc.worst_hours_down >= RETENTION_HRS && !exists(hasProposal, inc.id, "retention_offer")) {
      const r = db
        .prepare(
          `SELECT COUNT(*) n, SUM(CASE WHEN s.holdout=1 THEN 1 ELSE 0 END) h FROM blast_radius b JOIN subscribers s ON s.line_id=b.line_id
            WHERE b.incident_id=? AND b.hours_down >= ?`
        )
        .get(inc.id, RETENTION_HRS) as { n: number; h: number | null };
      const recipients = r.n - (r.h ?? 0);
      if (recipients > 0) {
        create(db, inc.id, "retention_offer", inc.top_suspect, inc.vendor_id, sim.sim_min, {
          title: "Retention offer for long outages",
          detail: `${recipients} customer${recipients === 1 ? "" : "s"} down ${RETENTION_HRS}h+ — send an apology with a 30-day speed boost before they think about switching.${r.h ? ` ${r.h} held out as the control group.` : ""}`,
          recipients,
          messagePreview: OFFER_MESSAGE,
        });
      }
    }
  }

  generateCampaignHolds(db, sim.sim_min);
  void day;
}

// ---- Brand & Marketing: acquisition guardrail ------------------------------

const HOLD_SHARE = 0.03; // hold paid acquisition when ≥3% of a city's lines are down…
const HOLD_MIN_LINES = 8; // …and at least this many
const RELEASE_SHARE = 0.01;
const SPEND_PER_LINE_DAY = 15; // illustrative paid-acquisition spend (PHP / line / day)
const RETENTION_HRS = 3;
const OFFER_MESSAGE =
  "We're sorry your internet was down for so long. As a thank-you for staying with us, we've added a free speed boost to your plan for 30 days. — Globe Broadband";

export function cityDownStats(db: DB): Map<string, { lines: number; down: number }> {
  const rows = db
    .prepare(
      `SELECT d.city, COUNT(*) lines, SUM(CASE WHEN l.status != 'online' THEN 1 ELSE 0 END) down
         FROM lines l JOIN topology_truth t ON t.element_id = l.line_id JOIN districts d ON d.id = t.district_id
        GROUP BY d.city`
    )
    .all() as { city: string; lines: number; down: number }[];
  return new Map(rows.map((r) => [r.city, { lines: r.lines, down: r.down ?? 0 }]));
}

function generateCampaignHolds(db: DB, simMin: number): void {
  const stats = cityDownStats(db);
  const pending = db.prepare("SELECT id, payload_json FROM proposals WHERE kind='campaign_hold' AND state='pending'").all() as { id: string; payload_json: string }[];
  const pendingCities = new Map(pending.map((p) => [String((JSON.parse(p.payload_json) as { city: string }).city), p.id]));
  const activeHolds = new Set((db.prepare("SELECT city FROM campaign_holds WHERE released_at IS NULL").all() as { city: string }[]).map((r) => r.city));

  for (const [city, st] of stats) {
    const share = st.lines ? st.down / st.lines : 0;
    // Recovered: release the hold, expire any stale proposal.
    if (share < RELEASE_SHARE) {
      if (activeHolds.has(city)) {
        db.prepare("UPDATE campaign_holds SET released_at=? WHERE city=? AND released_at IS NULL").run(simMin, city);
        logEvent(db, simMin, "campaign", `Acquisition campaigns resumed in ${city} — service restored`, "/marketing", "MARKETING");
      }
      const pid = pendingCities.get(city);
      if (pid) db.prepare("UPDATE proposals SET state='rejected', decided_at=?, decided_by_role='system', rationale='expired: area recovered' WHERE id=?").run(simMin, pid);
      continue;
    }
    if (share < HOLD_SHARE || st.down < HOLD_MIN_LINES || activeHolds.has(city) || pendingCities.has(city)) continue;
    const top = db
      .prepare(
        `SELECT b.incident_id, COUNT(*) n FROM blast_radius b
           JOIN topology_truth t ON t.element_id = b.line_id JOIN districts d ON d.id = t.district_id
           JOIN incidents i ON i.id = b.incident_id
          WHERE d.city = ? AND i.state != 'resolved' GROUP BY b.incident_id ORDER BY n DESC LIMIT 1`
      )
      .get(city) as { incident_id: string } | undefined;
    if (!top) continue;
    const spendPerDay = st.lines * SPEND_PER_LINE_DAY;
    create(db, top.incident_id, "campaign_hold", null, null, simMin, {
      title: `Hold acquisition campaigns in ${city}`,
      detail: `${st.down} of ${st.lines} lines in ${city} are down — pause paid acquisition so new customers don't join into an outage.`,
      city,
      down: st.down,
      lines: st.lines,
      spendPerDay,
    });
  }
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

function fmtEta(hrs: number): string {
  return hrs >= 1 ? `${hrs.toFixed(1)} hours` : `${Math.max(5, Math.round(hrs * 60))} minutes`;
}

export function causeText(kind: FaultKind): string {
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
        "INSERT INTO crew_jobs (id, proposal_id, incident_id, vendor_id, target_element, lat, lon, grid_x, grid_y, state, dispatched_at, arrived_at, done_at) VALUES (?,?,?,?,?,?,?,?,?,'enroute',?,?,?)"
      ).run(newCrewId(), p.id, p.incident_id, p.vendor_id, p.target_element, node?.lat ?? null, node?.lon ?? null, node?.grid_x ?? null, node?.grid_y ?? null, simMin, arrival, done);
      db.prepare("UPDATE incidents SET state='repairing' WHERE id=?").run(p.incident_id);
      logEvent(db, simMin, "dispatch", `Crew dispatched to ${p.target_element} (${payload.vendorName ?? p.vendor_id}) · parts: ${payload.partsHint}`, `/incidents?id=${p.incident_id}`, role.toUpperCase());
      break;
    }
    case "notification": {
      const recipients = (payload.recipients as number) ?? 0;
      const beforeCall = (db
        .prepare(
          "SELECT COUNT(*) n FROM blast_radius WHERE incident_id=? AND notified_at IS NULL AND ticketed=0 AND line_id NOT IN (SELECT line_id FROM subscribers WHERE holdout=1)"
        )
        .get(p.incident_id) as { n: number }).n;
      db.prepare(
        "INSERT INTO notifications (id, incident_id, proposal_id, lines_count, message_template, eta_given_hrs, sent_at, followup_kind, before_call) VALUES (?,?,?,?,?,?,?,?,?)"
      ).run(`NOTIF-${p.id}`, p.incident_id, p.id, recipients, String(payload.messagePreview ?? ""), (payload.etaHrs as number) ?? null, simMin, "progress", beforeCall);
      // The 10% holdout is the control group: never proactively notified.
      db.prepare(
        "UPDATE blast_radius SET notified_at=? WHERE incident_id=? AND notified_at IS NULL AND line_id NOT IN (SELECT line_id FROM subscribers WHERE holdout=1)"
      ).run(simMin, p.incident_id);
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
          WHERE holdout = 0 AND line_id IN (SELECT line_id FROM blast_radius WHERE incident_id=?)`
      ).run(p.incident_id);
      logEvent(db, simMin, "credit", `Credits issued for past-window lines (${p.incident_id})`, `/incidents?id=${p.incident_id}`, role.toUpperCase());
      break;
    }
    case "account_alert": {
      const lines = db
        .prepare(
          "SELECT b.line_id, b.ticketed FROM blast_radius b JOIN subscribers s ON s.line_id=b.line_id WHERE b.incident_id=? AND b.b2b=1 AND s.holdout=0"
        )
        .all(p.incident_id) as { line_id: string; ticketed: number }[];
      const beforeCall = lines.filter((l) => !l.ticketed).length;
      db.prepare(
        "INSERT INTO notifications (id, incident_id, proposal_id, lines_count, message_template, eta_given_hrs, sent_at, followup_kind, before_call) VALUES (?,?,?,?,?,?,?,?,?)"
      ).run(
        `ACCT-${p.id}`,
        p.incident_id,
        p.id,
        lines.length,
        `Personal call from your Globe account manager: ${String(payload.cause ?? "a service issue")} — crew assigned, restore in ~${fmtEta(Number(payload.etaHrs ?? 0))}.`,
        (payload.etaHrs as number) ?? null,
        simMin,
        "account",
        beforeCall
      );
      // Accounts told by their AM stop calling the hotline too.
      const mark = db.prepare("UPDATE blast_radius SET notified_at=? WHERE incident_id=? AND line_id=? AND notified_at IS NULL");
      for (const l of lines) mark.run(simMin, p.incident_id, l.line_id);
      logEvent(db, simMin, "account", `Account managers briefed ${lines.length} business account${lines.length === 1 ? "" : "s"} (${p.incident_id})`, `/incidents?id=${p.incident_id}`, "SALES");
      break;
    }
    case "home_visit": {
      const node = topo.node(p.target_element ?? "");
      const area = inc.area_class ?? "urban";
      const travel = area === "urban" ? 30 : area === "suburban" ? 50 : 75;
      const travelMin = Math.round(travel * (0.8 + 0.4 * det01(p.id + "tr")));
      const arrival = simMin + travelMin;
      const done = arrival + Math.round(40 + 30 * det01(p.id + "rp"));
      db.prepare(
        "INSERT INTO crew_jobs (id, proposal_id, incident_id, vendor_id, crew_type, target_element, lat, lon, grid_x, grid_y, state, dispatched_at, arrived_at, done_at) VALUES (?,?,?,?,?,?,?,?,?,?,'enroute',?,?,?)"
      ).run(newCrewId(), p.id, p.incident_id, "CFS", "cfs", p.target_element, node?.lat ?? null, node?.lon ?? null, node?.grid_x ?? null, node?.grid_y ?? null, simMin, arrival, done);
      db.prepare("UPDATE incidents SET state='repairing' WHERE id=?").run(p.incident_id);
      logEvent(db, simMin, "dispatch", `CFS technician booked for a home visit at ${p.target_element} · arriving in ${travelMin} min`, `/incidents?id=${p.incident_id}`, "CFS");
      break;
    }
    case "retention_offer": {
      const recipients = (payload.recipients as number) ?? 0;
      db.prepare(
        "INSERT INTO notifications (id, incident_id, proposal_id, lines_count, message_template, eta_given_hrs, sent_at, followup_kind, before_call) VALUES (?,?,?,?,?,?,?,?,0)"
      ).run(`OFFER-${p.id}`, p.incident_id, p.id, recipients, String(payload.messagePreview ?? OFFER_MESSAGE), null, simMin, "offer");
      logEvent(db, simMin, "offer", `Retention offer sent to ${recipients} long-outage customers (${p.incident_id})`, "/marketing", "MARKETING");
      break;
    }
    case "campaign_hold": {
      const city = String(payload.city);
      db.prepare(
        "INSERT INTO campaign_holds (id, city, incident_id, held_at, released_at, spend_per_day, approved_by) VALUES (?,?,?,?,NULL,?,?)"
      ).run(`HOLD-${p.id}`, city, p.incident_id, simMin, Number(payload.spendPerDay ?? 0), role);
      logEvent(db, simMin, "campaign", `Acquisition campaigns paused in ${city} while the outage is fixed`, "/marketing", "MARKETING");
      break;
    }
  }
  void day;
}

/** Advance crew jobs over sim-time; complete repairs, file the close-out, resolve faults. */
export function crewStep(db: DB, topo: TopoIndex, rec: RecordedIndex, simMin: number): void {
  const jobs = db.prepare("SELECT * FROM crew_jobs WHERE state != 'done'").all() as CrewJobRow[];

  for (const j of jobs) {
    if (j.state === "enroute" && j.arrived_at !== null && simMin >= j.arrived_at) {
      db.prepare("UPDATE crew_jobs SET state='onsite' WHERE id=?").run(j.id);
      logEvent(db, simMin, "crew", `${j.crew_type === "cfs" ? "CFS technician" : "Crew"} on site at ${j.target_element}`, `/incidents?id=${j.incident_id}`, j.crew_type === "cfs" ? "CFS" : "FIELD");
    }
    const cur = db.prepare("SELECT state FROM crew_jobs WHERE id=?").get(j.id) as { state: string };
    if (cur.state === "onsite" && j.done_at !== null && simMin >= j.done_at) completeJob(db, topo, rec, j, simMin);
  }
}

interface CrewJobRow {
  id: string;
  incident_id: string;
  target_element: string;
  state: string;
  proposal_id: string | null;
  dispatched_at: number;
  arrived_at: number | null;
  done_at: number | null;
  vendor_id: string;
  crew_type: string;
  closeout_by: string | null;
}

function completeJob(db: DB, topo: TopoIndex, rec: RecordedIndex, j: CrewJobRow, simMin: number): void {
  const inc = db.prepare("SELECT * FROM incidents WHERE id=?").get(j.incident_id) as IncidentRow & { fault_id: string | null };
  // Correct if the true fault element is at/under the dispatch target (truth).
  const fault = inc.fault_id ? (db.prepare("SELECT element_id FROM faults WHERE id=?").get(inc.fault_id) as { element_id: string | null } | undefined) : undefined;
  const truthEl = fault?.element_id ?? null;
  const correct = truthEl ? truthEl === j.target_element || topo.ancestors(truthEl).includes(j.target_element) : true;
  // The crew reports the exact element where the fault was — finer than (or different from) the dispatch target.
  const foundAt = truthEl ?? j.target_element;
  db.prepare("UPDATE crew_jobs SET state='done', done_at=?, found_at_element=?, correct=? WHERE id=?").run(simMin, foundAt, correct ? 1 : 0, j.id);
  db.prepare(
    "INSERT INTO dispatch_quality (proposal_id, incident_id, sent_to_element, found_at_element, correct, sim_ts) VALUES (?,?,?,?,?,?) ON CONFLICT(proposal_id) DO NOTHING"
  ).run(j.proposal_id ?? j.id, j.incident_id, j.target_element, foundAt, correct ? 1 : 0, simMin);

  fileCloseout(db, topo, rec, j, inc, foundAt, correct, simMin);

  const who = j.crew_type === "cfs" ? "Home visit" : "Repair";
  logEvent(
    db,
    simMin,
    "repair",
    correct ? `${who} complete at ${j.target_element}` : `Wrong location — fault was at ${foundAt}, re-worked`,
    `/incidents?id=${j.incident_id}`,
    j.crew_type === "cfs" ? "CFS" : "FIELD"
  );
  resolveFault(db, topo, inc, foundAt, "noc_lead", simMin, correct, "dispatch");
}

const ROOT_CAUSES: Partial<Record<FaultKind, string[]>> = {
  feeder_cut: ["Feeder cable cut by road excavation", "Feeder damaged by a falling tree", "Feeder cut during third-party civil works"],
  distribution_cut: ["Aerial fiber snapped by an over-height truck", "Distribution cable cut at a pole transfer", "Rodent damage at a closure"],
  splitter_failure: ["Water ingress in the splitter closure", "Splitter module failed — connector burn"],
  olt_port_failure: ["PON line card port failed", "Optic module failed at the exchange"],
  drop_cut: ["Drop cable cut during home renovation", "Drop cable pulled down by a vehicle"],
  cpe_issue: ["ONT power adapter failed", "Router misconfigured after a power surge", "ONT optic failed"],
  noise: ["Dirty connector at the NAP", "Bend loss at the drop entry"],
};
const ACTIONS: Partial<Record<FaultKind, string>> = {
  feeder_cut: "Re-spliced the feeder (24 fibers)",
  distribution_cut: "Re-spliced the distribution cable",
  splitter_failure: "Replaced the 1:8 splitter module",
  olt_port_failure: "Swapped the line card / optic",
  drop_cut: "Replaced the drop cable",
  cpe_issue: "Replaced the ONT and restored the customer's settings",
  noise: "Cleaned connectors and re-terminated",
};

/**
 * The last-mile feedback loop. Every finished job files a structured close-out:
 * where the fault really was, root cause, what was done — and which customer
 * lines the crew saw physically connected somewhere other than the plant
 * records say. Those become record corrections, so the next isolation and the
 * next dispatch are sharper.
 */
function fileCloseout(
  db: DB,
  topo: TopoIndex,
  rec: RecordedIndex,
  j: CrewJobRow,
  inc: IncidentRow,
  foundAt: string,
  correct: boolean,
  simMin: number
): void {
  const kind = (inc.fault_kind ?? "distribution_cut") as FaultKind;
  const causes = ROOT_CAUSES[kind] ?? ["Fault located and repaired"];
  const rootCause = correct ? causes[Math.floor(det01(j.id + "rc") * causes.length)] : `Fault found at ${foundAt}, not at ${j.target_element} — ${causes[0].toLowerCase()}`;
  const area = inc.area_class ?? "urban";
  const nominal = j.crew_type === "cfs" ? (area === "urban" ? 30 : area === "suburban" ? 50 : 75) : area === "urban" ? 25 : area === "suburban" ? 55 : 90;
  const travel = (j.arrived_at ?? simMin) - j.dispatched_at;
  const onTime = travel <= nominal * 1.1 ? 1 : 0;

  // Record errors the crew can see at the element they worked on.
  let discrepancies = 0;
  if (j.crew_type === "partner") {
    const node = topo.node(foundAt);
    if (node && node.kind !== "ont") {
      for (const line of topo.linesUnder(foundAt)) {
        const r = rec.node(line);
        const t = topo.node(line);
        if (!r?.mismapped || !r.parent || !t?.parent || r.parent === t.parent) continue;
        // Already reported by an earlier crew — nothing new to say about this line.
        if (db.prepare("SELECT 1 FROM record_corrections WHERE line_id=?").get(line)) continue;
        if (discrepancies >= 3) break; // a crew reports what it can verify on one visit
        discrepancies++;
        db.prepare(
          "INSERT INTO record_corrections (id, line_id, from_parent, to_parent, source, status, incident_id, sim_ts) VALUES (?,?,?,?,?,?,?,?)"
        ).run(`RC-${line}`, line, r.parent, t.parent, "partner_closeout", "suggested", j.incident_id, simMin);
      }
    }
  }

  db.prepare(
    `INSERT INTO partner_reports (id, job_id, incident_id, vendor_id, crew_type, element_dispatched, element_found, root_cause, action_taken, parts_used,
       first_time_fix, on_time, minutes_onsite, discrepancies, photos, submitted_at, submitted_via)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`
  ).run(
    `CO-${j.id}`,
    j.id,
    j.incident_id,
    j.vendor_id,
    j.crew_type,
    j.target_element,
    foundAt,
    rootCause,
    ACTIONS[kind] ?? "Repaired",
    j.crew_type === "cfs" ? "ONT + power adapter" : partsHint(kind),
    correct ? 1 : 0,
    onTime,
    Math.max(5, simMin - (j.arrived_at ?? simMin)),
    discrepancies,
    2 + Math.floor(det01(j.id + "ph") * 4),
    simMin,
    j.closeout_by ? "partner_portal" : "partner_app"
  );
  const who = j.crew_type === "cfs" ? "CFS technician" : (db.prepare("SELECT name FROM vendors WHERE id=?").get(j.vendor_id) as { name: string } | undefined)?.name ?? j.vendor_id;
  logEvent(
    db,
    simMin,
    "closeout",
    `${who} close-out filed for ${j.incident_id}${discrepancies ? ` · ${discrepancies} record error${discrepancies === 1 ? "" : "s"} reported` : " · records match"}`,
    j.crew_type === "cfs" ? "/field" : "/partners",
    j.crew_type === "cfs" ? "CFS" : "PARTNER"
  );
}

/** Partner portal: the crew submits its close-out now (job must be on site). */
export function submitCloseoutNow(db: DB, topo: TopoIndex, rec: RecordedIndex, jobId: string, simMin: number): { ok: boolean; error?: string } {
  const j = db.prepare("SELECT * FROM crew_jobs WHERE id=?").get(jobId) as CrewJobRow | undefined;
  if (!j) return { ok: false, error: "job not found" };
  if (j.state === "done") return { ok: false, error: "already closed out" };
  if (j.state === "enroute") return { ok: false, error: "crew is not on site yet" };
  db.prepare("UPDATE crew_jobs SET closeout_by='partner', done_at=? WHERE id=?").run(simMin, jobId);
  completeJob(db, topo, rec, { ...j, closeout_by: "partner", done_at: simMin }, simMin);
  return { ok: true };
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
