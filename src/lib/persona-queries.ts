import { getDb, getSimState } from "./db";
import { getLearnMetrics } from "./learn-queries";
import { causeText } from "./engine/proposals";
import type { FaultKind } from "./types";

/**
 * Read models for each persona's workspace and the shared outcome scoreboard.
 * Everything here is computed from the live simulation — the same numbers the
 * presenter captions show.
 */

type Row = Record<string, unknown>;
const OPEN = "('resolved')";

function q() {
  const db = getDb();
  const sim = getSimState(db)!;
  const n = (sql: string, ...args: unknown[]) => Number((db.prepare(sql).get(...args) as { n: number | null }).n ?? 0);
  return { db, sim, n };
}

// ---- Shared outcome scoreboard ----------------------------------------------

export interface Outcomes {
  asOf: number;
  network: { lines: number; impacted: number; silent: number; pesoAtRisk: number; openIncidents: number; sensedPct: number };
  noc: { wrongRollRate: number; correctRolls: number; wrongRolls: number; rollsAvoided: number; repairsInWindowPct: number; repairsTotal: number };
  care: {
    callsDeflected: number;
    informed: number;
    informedBeforeCall: number;
    openTickets: number;
    knownCausePct: number;
    dupMerged: number;
    userSideFlagged: number;
    creditsLines: number;
  };
  sales: { accountsAffected: number; accountsBriefed: number; briefedBeforeCall: number; b2bPesoAtRisk: number };
  cfs: { visitsAvoided: number; networkCallers: number; remoteFixes: number; homeVisitsDone: number; firstVisitFixPct: number | null };
  partner: {
    closeouts: number;
    firstTimeFixPct: number | null;
    onTimePct: number | null;
    recordErrorsReported: number;
    correctionsFromPartners: number;
    correctionsAccepted: number;
    recordConfNow: number;
    recordConfBaseline: number;
  };
  marketing: {
    retentionLift: number | null;
    treatedN: number;
    controlN: number;
    offersSent: number;
    holdsActive: number;
    citiesHeld: string[];
    spendProtected: number;
    messagesSent: number;
  };
}

export function getOutcomes(): Outcomes {
  const { db, sim, n } = q();
  const learn = getLearnMetrics();
  const now = sim.sim_min;

  const lines = n("SELECT COUNT(*) n FROM lines");
  const impacted = n("SELECT COUNT(*) n FROM lines WHERE status != 'online'");
  const silent = n(
    `SELECT COUNT(*) n FROM lines l JOIN sensing s ON s.line_id = l.line_id
      WHERE l.status != 'online' AND s.polled = 0
        AND l.line_id NOT IN (SELECT line_id FROM tickets WHERE closed_at IS NULL AND kind='valid')`
  );
  const pesoAtRisk = n("SELECT COALESCE(SUM(s.arpu),0) n FROM subscribers s JOIN lines l ON l.line_id=s.line_id WHERE l.status != 'online'");
  const openIncidents = n(`SELECT COUNT(*) n FROM incidents WHERE state NOT IN ${OPEN}`);
  const sensed = n("SELECT COUNT(*) n FROM sensing WHERE polled=1");

  const openTickets = n("SELECT COUNT(*) n FROM tickets WHERE closed_at IS NULL AND kind='valid'");
  const openKnown = n("SELECT COUNT(*) n FROM tickets WHERE closed_at IS NULL AND kind='valid' AND parent_incident_id IS NOT NULL");

  const networkCallers = n(
    `SELECT COUNT(DISTINCT t.line_id) n FROM tickets t JOIN incidents i ON i.id = t.parent_incident_id
      WHERE t.kind='valid' AND i.fault_kind IS NOT NULL AND i.fault_kind NOT IN ('cpe_issue')`
  );
  const remoteFixes = n("SELECT COUNT(*) n FROM remote_actions WHERE kind='reboot' AND result LIKE 'recovered%'");
  const cfsDone = n("SELECT COUNT(*) n FROM partner_reports WHERE crew_type='cfs'");
  const cfsFtf = n("SELECT COUNT(*) n FROM partner_reports WHERE crew_type='cfs' AND first_time_fix=1");

  const pr = db
    .prepare(
      `SELECT COUNT(*) n, SUM(first_time_fix) ftf, SUM(on_time) ot, SUM(discrepancies) d FROM partner_reports WHERE crew_type='partner'`
    )
    .get() as { n: number; ftf: number | null; ot: number | null; d: number | null };

  const holds = db.prepare("SELECT city, held_at, released_at, spend_per_day FROM campaign_holds").all() as {
    city: string;
    held_at: number;
    released_at: number | null;
    spend_per_day: number;
  }[];
  const spendProtected = holds.reduce((a, h) => a + (h.spend_per_day * ((h.released_at ?? now) - h.held_at)) / 1440, 0);
  const active = holds.filter((h) => h.released_at === null);

  return {
    asOf: now,
    network: { lines, impacted, silent, pesoAtRisk, openIncidents, sensedPct: lines ? sensed / lines : 0 },
    noc: {
      wrongRollRate: learn.wrongRollRate,
      correctRolls: learn.correctRolls,
      wrongRolls: learn.wrongRolls,
      rollsAvoided: learn.rollsAvoided,
      repairsInWindowPct: learn.repairsInWindowPct,
      repairsTotal: learn.repairsTotal,
    },
    care: {
      callsDeflected: learn.deflected,
      informed: n("SELECT COUNT(DISTINCT line_id) n FROM blast_radius WHERE notified_at IS NOT NULL"),
      informedBeforeCall: n("SELECT COALESCE(SUM(before_call),0) n FROM notifications WHERE followup_kind='progress'"),
      openTickets,
      knownCausePct: openTickets ? openKnown / openTickets : 0,
      dupMerged: learn.dupMerged,
      userSideFlagged: n("SELECT COUNT(*) n FROM tickets WHERE kind='invalid'"),
      creditsLines: n("SELECT COALESCE(SUM(lines_count),0) n FROM notifications WHERE followup_kind='credit'"),
    },
    sales: {
      accountsAffected: n(
        `SELECT COUNT(DISTINCT b.line_id) n FROM blast_radius b JOIN incidents i ON i.id=b.incident_id WHERE b.b2b=1 AND i.state NOT IN ${OPEN}`
      ),
      accountsBriefed: n("SELECT COALESCE(SUM(lines_count),0) n FROM notifications WHERE followup_kind='account'"),
      briefedBeforeCall: n("SELECT COALESCE(SUM(before_call),0) n FROM notifications WHERE followup_kind='account'"),
      b2bPesoAtRisk: n(
        "SELECT COALESCE(SUM(s.arpu),0) n FROM subscribers s JOIN lines l ON l.line_id=s.line_id WHERE l.status != 'online' AND s.b2b=1"
      ),
    },
    cfs: {
      visitsAvoided: networkCallers + remoteFixes,
      networkCallers,
      remoteFixes,
      homeVisitsDone: cfsDone,
      firstVisitFixPct: cfsDone ? cfsFtf / cfsDone : null,
    },
    partner: {
      closeouts: pr.n,
      firstTimeFixPct: pr.n ? (pr.ftf ?? 0) / pr.n : null,
      onTimePct: pr.n ? (pr.ot ?? 0) / pr.n : null,
      recordErrorsReported: pr.d ?? 0,
      correctionsFromPartners: n("SELECT COUNT(*) n FROM record_corrections WHERE source='partner_closeout'"),
      correctionsAccepted: n("SELECT COUNT(*) n FROM record_corrections WHERE status='accepted'"),
      recordConfNow: n("SELECT AVG(record_confidence) n FROM topology_recorded WHERE kind='ont'"),
      recordConfBaseline: sim.record_conf_baseline,
    },
    marketing: {
      retentionLift: learn.retention.lift,
      treatedN: learn.retention.treatedN,
      controlN: learn.retention.controlN,
      offersSent: n("SELECT COALESCE(SUM(lines_count),0) n FROM notifications WHERE followup_kind='offer'"),
      holdsActive: active.length,
      citiesHeld: active.map((h) => h.city),
      spendProtected,
      messagesSent: n("SELECT COALESCE(SUM(lines_count),0) n FROM notifications"),
    },
  };
}

// ---- Customer Service: the caller lookup -------------------------------------

export interface CallerAnswer {
  subscriber: { id: string; name: string; line_id: string; b2b: boolean; vip: boolean; arpu: number; city: string; district: string; tenure_days: number };
  status: "online" | "degraded" | "offline";
  downHrs: number;
  incident: null | {
    id: string;
    fault_kind: string | null;
    cause: string;
    state: string;
    etaHrs: number | null;
    crew: null | { state: string; eta_min: number; who: string };
    homeSide: boolean;
  };
  notifiedAt: number | null;
  openTicket: string | null;
  creditEligible: boolean;
  script: string;
  guidance: string[];
}

export function searchCallers(term: string) {
  const { db } = q();
  const like = `%${term.trim()}%`;
  return db
    .prepare(
      `SELECT s.id, s.name, s.line_id, s.b2b, l.status FROM subscribers s JOIN lines l ON l.line_id=s.line_id
        WHERE s.name LIKE ? OR s.line_id LIKE ? OR s.id LIKE ?
        ORDER BY (l.status != 'online') DESC, s.b2b DESC LIMIT 8`
    )
    .all(like, like, like) as Row[];
}

export function callersNow(limit = 14) {
  const { db } = q();
  return db
    .prepare(
      `SELECT t.id ticket, t.opened_at, t.kind, s.name, s.line_id, s.b2b, s.vip, t.parent_incident_id incident, i.fault_kind, l.status
         FROM tickets t JOIN subscribers s ON s.line_id=t.line_id JOIN lines l ON l.line_id=t.line_id
         LEFT JOIN incidents i ON i.id=t.parent_incident_id
        WHERE t.closed_at IS NULL ORDER BY t.opened_at DESC, t.id DESC LIMIT ?`
    )
    .all(limit) as Row[];
}

export function getCallerAnswer(lineOrSub: string): CallerAnswer | null {
  const { db, sim } = q();
  const s = db
    .prepare(
      `SELECT s.id, s.name, s.line_id, s.b2b, s.vip, s.arpu, s.tenure_days, d.city, d.name district, l.status, l.offline_since, l.degraded_since
         FROM subscribers s JOIN lines l ON l.line_id=s.line_id
         JOIN topology_truth t ON t.element_id=s.line_id JOIN districts d ON d.id=t.district_id
        WHERE s.line_id=? OR s.id=?`
    )
    .get(lineOrSub, lineOrSub) as
    | { id: string; name: string; line_id: string; b2b: number; vip: number; arpu: number; tenure_days: number; city: string; district: string; status: string; offline_since: number | null; degraded_since: number | null }
    | undefined;
  if (!s) return null;

  const since = s.offline_since ?? s.degraded_since;
  const downHrs = since !== null ? (sim.sim_min - since) / 60 : 0;
  const br = db
    .prepare(
      `SELECT b.incident_id, b.notified_at, b.hours_down, i.fault_kind, i.state, i.eta_hrs, i.predicted_mttr_p50
         FROM blast_radius b JOIN incidents i ON i.id=b.incident_id
        WHERE b.line_id=? AND i.state != 'resolved' ORDER BY i.detected_at DESC LIMIT 1`
    )
    .get(s.line_id) as
    | { incident_id: string; notified_at: number | null; hours_down: number; fault_kind: string | null; state: string; eta_hrs: number | null; predicted_mttr_p50: number }
    | undefined;
  const ticket = db.prepare("SELECT id FROM tickets WHERE line_id=? AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1").get(s.line_id) as { id: string } | undefined;

  let incident: CallerAnswer["incident"] = null;
  if (br) {
    const job = db
      .prepare("SELECT state, arrived_at, crew_type, vendor_id FROM crew_jobs WHERE incident_id=? AND state != 'done' ORDER BY dispatched_at DESC LIMIT 1")
      .get(br.incident_id) as { state: string; arrived_at: number | null; crew_type: string; vendor_id: string } | undefined;
    const vendor = job ? (db.prepare("SELECT name FROM vendors WHERE id=?").get(job.vendor_id) as { name: string } | undefined)?.name : undefined;
    incident = {
      id: br.incident_id,
      fault_kind: br.fault_kind,
      cause: br.fault_kind ? causeText(br.fault_kind as FaultKind) : "a service issue we're still pinpointing",
      state: br.state,
      etaHrs: br.eta_hrs ?? br.predicted_mttr_p50 ?? null,
      crew: job
        ? { state: job.state, eta_min: job.state === "enroute" ? Math.max(0, (job.arrived_at ?? sim.sim_min) - sim.sim_min) : 0, who: job.crew_type === "cfs" ? "CFS technician" : vendor ?? job.vendor_id }
        : null,
      homeSide: br.fault_kind === "cpe_issue",
    };
  }

  const creditEligible = !!br && br.hours_down > sim.repair_window_hrs;
  // Residential callers by first name; business accounts by company.
  const first = s.b2b ? `${s.name} team` : s.name.split(" ")[0];
  const etaTxt = incident?.etaHrs ? (incident.etaHrs >= 1 ? `about ${incident.etaHrs.toFixed(1)} hours` : `about ${Math.max(10, Math.round(incident.etaHrs * 60))} minutes`) : "shortly";
  let script: string;
  const guidance: string[] = [];
  if (s.status === "online") {
    script = `Hi ${first}, your line is up and healthy on our side right now. Let's check your Wi-Fi and devices together.`;
    guidance.push("No network fault — troubleshoot Wi-Fi / devices first.", "If the problem persists, run a remote diagnostic before booking anyone.");
  } else if (!incident) {
    script = `Hi ${first}, I can see your line is ${s.status}. We're pinpointing the cause now — I'll stay with you while we run a remote check.`;
    guidance.push("Not yet tied to an incident — SDAL is still correlating signals.", "Run a remote diagnostic; book a visit only if it points inside the home.");
  } else if (incident.homeSide) {
    script = `Hi ${first}, the issue is with the equipment in your home. We're running a remote fix now${incident.crew ? `, and a technician is ${incident.crew.state === "onsite" ? "with you" : `on the way, about ${incident.crew.eta_min} minutes out`}` : ""}.`;
    guidance.push("Home-side fault: remote reboot first; a CFS visit only if that fails.");
  } else {
    script = `Hi ${first}, yes — we know. There's ${incident.cause}. ${
      incident.crew ? (incident.crew.state === "onsite" ? "Our crew is on site now" : `A crew is on the way, about ${incident.crew.eta_min} minutes out`) : "Our team is on it"
    }, and we expect service back in ${etaTxt}. No need for a technician to visit your home.`;
    guidance.push("Network-side outage: do NOT book a home visit.", br?.notified_at != null ? "Customer was already notified proactively." : "Not yet notified — the area notice is pending approval.");
    if (creditEligible) guidance.push("Past the repair window: offer a service credit.");
  }
  if (s.b2b) guidance.push("Business account — their account manager is briefed via Sales Force.");

  return {
    subscriber: { id: s.id, name: s.name, line_id: s.line_id, b2b: !!s.b2b, vip: !!s.vip, arpu: s.arpu, city: s.city, district: s.district, tenure_days: s.tenure_days },
    status: s.status as CallerAnswer["status"],
    downHrs,
    incident,
    notifiedAt: br?.notified_at ?? null,
    openTicket: ticket?.id ?? null,
    creditEligible,
    script,
    guidance,
  };
}

// ---- Sales Force -----------------------------------------------------------

export function getSalesData() {
  const { db, sim } = q();
  const accounts = db
    .prepare(
      `SELECT s.name, s.line_id, s.vip, s.b2b, s.arpu, d.city, b.incident_id, b.hours_down, b.ticketed, b.notified_at, i.fault_kind, i.state,
              COALESCE(i.eta_hrs, i.predicted_mttr_p50) eta,
              (SELECT 1 FROM notifications n WHERE n.incident_id=b.incident_id AND n.followup_kind='account') briefed
         FROM blast_radius b JOIN incidents i ON i.id=b.incident_id JOIN subscribers s ON s.line_id=b.line_id
         JOIN topology_truth t ON t.element_id=b.line_id JOIN districts d ON d.id=t.district_id
        WHERE i.state NOT IN ${OPEN} AND (b.b2b=1 OR b.vip=1)
        ORDER BY s.b2b DESC, s.arpu DESC LIMIT 60`
    )
    .all() as Row[];
  return { accounts, simMin: sim.sim_min, pending: pendingOf(["account_alert"]) };
}

// ---- CFS home visits ----------------------------------------------------------

export function getFieldData() {
  const { db, sim } = q();
  const jobs = db
    .prepare(
      `SELECT j.id, j.incident_id, j.target_element, j.state, j.dispatched_at, j.arrived_at, j.done_at, s.name, d.city
         FROM crew_jobs j LEFT JOIN subscribers s ON s.line_id=j.target_element
         LEFT JOIN topology_truth t ON t.element_id=j.target_element LEFT JOIN districts d ON d.id=t.district_id
        WHERE j.crew_type='cfs' ORDER BY (j.state='done') ASC, j.dispatched_at DESC LIMIT 20`
    )
    .all() as Row[];
  const reports = db
    .prepare("SELECT * FROM partner_reports WHERE crew_type='cfs' ORDER BY submitted_at DESC LIMIT 10")
    .all() as Row[];
  // Callers inside a network outage — a home visit would have found nothing.
  const avoided = db
    .prepare(
      `SELECT t.id ticket, t.opened_at, s.name, t.line_id, t.parent_incident_id incident, i.fault_kind, d.city
         FROM tickets t JOIN incidents i ON i.id=t.parent_incident_id JOIN subscribers s ON s.line_id=t.line_id
         JOIN topology_truth tt ON tt.element_id=t.line_id JOIN districts d ON d.id=tt.district_id
        WHERE t.kind='valid' AND i.fault_kind IS NOT NULL AND i.fault_kind != 'cpe_issue'
        ORDER BY t.opened_at DESC LIMIT 12`
    )
    .all() as Row[];
  const remote = db
    .prepare("SELECT line_id, incident_id, result, sim_ts FROM remote_actions WHERE kind='reboot' ORDER BY sim_ts DESC LIMIT 10")
    .all() as Row[];
  return { jobs, reports, avoided, remote, simMin: sim.sim_min, pending: pendingOf(["home_visit", "remote_action"]) };
}

// ---- Last-mile partners ------------------------------------------------------

export function getPartnerData() {
  const { db, sim } = q();
  const jobs = db
    .prepare(
      `SELECT j.id, j.incident_id, j.vendor_id, v.name vendor, j.target_element, j.state, j.dispatched_at, j.arrived_at, j.done_at,
              i.fault_kind, i.top_confidence, i.observed_count + i.inferred_count customers, i.vip_count, i.b2b_count, i.area_class,
              (SELECT MAX(record_conflict) FROM suspicions su WHERE su.incident_id=j.incident_id AND su.rank=1) conflict,
              p.payload_json
         FROM crew_jobs j JOIN incidents i ON i.id=j.incident_id LEFT JOIN vendors v ON v.id=j.vendor_id
         LEFT JOIN proposals p ON p.id=j.proposal_id
        WHERE j.crew_type='partner' AND j.state != 'done' ORDER BY (j.state='onsite') DESC, j.dispatched_at DESC`
    )
    .all() as Row[];
  const reports = db
    .prepare(
      `SELECT r.*, v.name vendor FROM partner_reports r LEFT JOIN vendors v ON v.id=r.vendor_id
        WHERE r.crew_type='partner' ORDER BY r.submitted_at DESC, r.id DESC LIMIT 25`
    )
    .all() as Row[];
  const scorecard = db
    .prepare(
      `SELECT v.id, v.name, COUNT(r.id) jobs, SUM(r.first_time_fix) ftf, SUM(r.on_time) ontime, SUM(r.discrepancies) errors,
              AVG(r.minutes_onsite) onsite
         FROM vendors v LEFT JOIN partner_reports r ON r.vendor_id=v.id AND r.crew_type='partner'
        GROUP BY v.id ORDER BY jobs DESC, v.id`
    )
    .all() as Row[];
  const corrections = db
    .prepare(
      `SELECT c.id, c.line_id, c.from_parent, c.to_parent, c.status, c.source, c.incident_id, c.sim_ts
         FROM record_corrections c ORDER BY (c.status='suggested') DESC, c.sim_ts DESC LIMIT 30`
    )
    .all() as Row[];
  return { jobs, reports, scorecard, corrections, modelVersion: sim.model_version, simMin: sim.sim_min };
}

// ---- Brand & Marketing -------------------------------------------------------

export function getMarketingData() {
  const { db, sim, n } = q();
  const holds = (db
    .prepare("SELECT id, city, incident_id, held_at, released_at, spend_per_day, approved_by FROM campaign_holds ORDER BY held_at DESC")
    .all() as { id: string; city: string; incident_id: string; held_at: number; released_at: number | null; spend_per_day: number; approved_by: string }[]
  ).map((h) => ({ ...h, protected: (h.spend_per_day * ((h.released_at ?? sim.sim_min) - h.held_at)) / 1440 }));
  const comms = db
    .prepare(
      `SELECT id, incident_id, followup_kind kind, lines_count, before_call, message_template, sent_at FROM notifications ORDER BY sent_at DESC, id DESC LIMIT 30`
    )
    .all() as Row[];
  const byKind = db
    .prepare("SELECT followup_kind kind, COUNT(*) messages, COALESCE(SUM(lines_count),0) recipients FROM notifications GROUP BY followup_kind")
    .all() as Row[];
  const atRisk = {
    downLong: n(
      "SELECT COUNT(*) n FROM lines l JOIN subscribers s ON s.line_id=l.line_id WHERE l.offline_since IS NOT NULL AND s.holdout=0 AND (? - l.offline_since) >= 180",
      sim.sim_min
    ),
    vipDown: n("SELECT COUNT(*) n FROM lines l JOIN subscribers s ON s.line_id=l.line_id WHERE l.status != 'online' AND (s.vip=1 OR s.b2b=1)"),
    avgHazardDown: n("SELECT AVG(s.churn_hazard) n FROM lines l JOIN subscribers s ON s.line_id=l.line_id WHERE l.status != 'online'"),
  };
  return { holds, comms, byKind, atRisk, simMin: sim.sim_min, pending: pendingOf(["campaign_hold", "retention_offer"]) };
}

// ---- Persona hand-offs for one incident (the dynamics, live) -----------------

export function getHandoffs(incidentId: string) {
  const { db } = q();
  const props = db
    .prepare("SELECT id, kind, state, decided_by_role, decided_at, payload_json FROM proposals WHERE incident_id=? ORDER BY created_at")
    .all(incidentId) as { id: string; kind: string; state: string; decided_by_role: string | null; decided_at: number | null; payload_json: string }[];
  const jobs = db.prepare("SELECT id, crew_type, state, vendor_id FROM crew_jobs WHERE incident_id=? ORDER BY dispatched_at").all(incidentId) as Row[];
  const reports = db.prepare("SELECT id, crew_type, first_time_fix, discrepancies, submitted_at FROM partner_reports WHERE incident_id=?").all(incidentId) as Row[];
  const notes = db.prepare("SELECT followup_kind kind, lines_count, before_call, sent_at FROM notifications WHERE incident_id=?").all(incidentId) as Row[];
  const callers = Number((db.prepare("SELECT COUNT(*) n FROM tickets WHERE parent_incident_id=? AND kind='valid'").get(incidentId) as { n: number }).n);
  return { proposals: props, jobs, reports, notes, callers };
}

export function pendingOf(kinds: string[]) {
  const { db } = q();
  const ph = kinds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT p.id, p.incident_id, p.kind, p.payload_json, p.created_at, i.fault_kind, i.peso_exposure
         FROM proposals p JOIN incidents i ON i.id=p.incident_id
        WHERE p.state='pending' AND p.kind IN (${ph}) ORDER BY p.created_at DESC`
    )
    .all(...kinds) as Row[];
}
