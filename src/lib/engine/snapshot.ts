import type { DB } from "../db";
import { getSimState } from "../db";
import type { Health } from "../tokens";
import { healthFromRatio } from "../tokens";
import type { OpsSnapshot, IncidentSummary, TickerEntry, CrewGlyph } from "../types";
import type { TopoIndex } from "./topo-index";
import type { ImpactState } from "./world";

export function buildSnapshot(
  db: DB,
  topo: TopoIndex,
  impacted: Map<string, ImpactState>
): OpsSnapshot {
  const sim = getSimState(db)!;
  const day = Math.floor(sim.sim_min / 1440);

  const totalLines = topo.allLines.length;
  const polled = (db.prepare("SELECT COUNT(*) n FROM sensing WHERE polled=1").get() as { n: number }).n;

  // Observed vs inferred among impacted lines.
  const ticketedLines = new Set(
    (db.prepare("SELECT DISTINCT line_id FROM tickets WHERE closed_at IS NULL AND kind='valid'").all() as {
      line_id: string;
    }[]).map((r) => r.line_id)
  );
  const polledSet = new Set(
    (db.prepare("SELECT line_id FROM sensing WHERE polled=1").all() as { line_id: string }[]).map((r) => r.line_id)
  );
  let observed = 0;
  let inferred = 0;
  for (const [lineId] of impacted) {
    if (polledSet.has(lineId) || ticketedLines.has(lineId)) observed++;
    else inferred++;
  }

  const openTickets = (db.prepare("SELECT COUNT(*) n FROM tickets WHERE closed_at IS NULL").get() as { n: number }).n;
  const inflow = (
    db.prepare("SELECT COUNT(*) n FROM tickets WHERE opened_at >= ?").get(sim.sim_min - 60) as { n: number }
  ).n;

  const learn = db.prepare("SELECT * FROM learn_daily WHERE day=?").get(day) as
    | { calls_deflected: number; wrong_rolls: number; correct_rolls: number; repairs_in_window: number; repairs_total: number }
    | undefined;

  const crewsActive = (db.prepare("SELECT COUNT(*) n FROM crew_jobs WHERE state != 'done'").get() as { n: number }).n;

  // ₱ at risk: sum ARPU of impacted subscribers.
  const impactedArr = [...impacted.keys()];
  let pesoAtRisk = 0;
  if (impactedArr.length) {
    const placeholders = impactedArr.map(() => "?").join(",");
    pesoAtRisk = (
      db
        .prepare(`SELECT COALESCE(SUM(arpu),0) s FROM subscribers WHERE line_id IN (${placeholders})`)
        .get(...impactedArr) as { s: number }
    ).s;
  }

  const avgMttr = (
    db.prepare("SELECT COALESCE(AVG(mttr_actual_hrs),0) a FROM outcomes WHERE resolved_at >= ?").get(day * 1440) as {
      a: number;
    }
  ).a;

  // Element health for the map: impacted ratio under each backbone element.
  const element_health: Record<string, Health> = {};
  const impactedSet = new Set(impacted.keys());
  for (const node of topo.nodes.values()) {
    if (node.kind === "ont") {
      if (impactedSet.has(node.id)) {
        const imp = impacted.get(node.id)!;
        element_health[node.id] = imp.status === "offline" ? "critical" : "degraded";
      }
      continue;
    }
    const lines = topo.linesUnder(node.id);
    if (!lines.length) continue;
    let imp = 0;
    for (const l of lines) if (impactedSet.has(l)) imp++;
    const ratio = imp / lines.length;
    if (ratio > 0.02) element_health[node.id] = healthFromRatio(ratio);
  }

  // Incidents (M3+ populate; empty until then).
  const incidents = db
    .prepare(
      `SELECT * FROM incidents WHERE state NOT IN ('resolved') ORDER BY rank_score DESC LIMIT 50`
    )
    .all() as IncidentSummaryRow[];

  const ticker = (
    db.prepare("SELECT id, sim_ts, kind, text, href, source FROM events ORDER BY id DESC LIMIT 40").all() as {
      id: number;
      sim_ts: number;
      kind: string;
      text: string;
      href: string | null;
      source: string;
    }[]
  ).map<TickerEntry>((e) => ({
    id: String(e.id),
    sim_ts: e.sim_ts,
    kind: e.kind,
    text: e.text,
    href: e.href,
    source: e.source,
  }));

  // Ticket flow: last 12 sim-hours bucketed hourly.
  const ticket_flow: OpsSnapshot["ticket_flow"] = [];
  for (let h = 11; h >= 0; h--) {
    const hourStart = sim.sim_min - h * 60;
    const hourEnd = hourStart + 60;
    const opened = (
      db.prepare("SELECT COUNT(*) n FROM tickets WHERE opened_at >= ? AND opened_at < ?").get(hourStart, hourEnd) as {
        n: number;
      }
    ).n;
    const resolved = (
      db.prepare("SELECT COUNT(*) n FROM tickets WHERE closed_at >= ? AND closed_at < ?").get(hourStart, hourEnd) as {
        n: number;
      }
    ).n;
    ticket_flow.push({ t: Math.max(0, hourStart), opened, deflected: 0, resolved });
  }

  const crews = db
    .prepare("SELECT id as job_id, vendor_id, grid_x, grid_y, state, incident_id FROM crew_jobs WHERE state != 'done'")
    .all() as CrewGlyph[];

  return {
    sim: {
      simMin: sim.sim_min,
      speed: sim.speed as 0 | 1 | 4 | 16,
      running: !!sim.running,
      seed: sim.seed,
    },
    kpis: {
      lines_monitored: totalLines,
      pct_actively_sensed: totalLines ? polled / totalLines : 0,
      lines_impacted_observed: observed,
      lines_impacted_inferred: inferred,
      open_tickets: openTickets,
      ticket_inflow_hr: inflow,
      calls_deflected_today: learn?.calls_deflected ?? 0,
      avg_mttr_today: avgMttr,
      mttr_window: sim.repair_window_hrs,
      crews_active: crewsActive,
      wrong_rolls_avoided: 0,
      peso_at_risk: pesoAtRisk,
    },
    incidents: incidents.map(rowToIncident),
    ticker,
    crews: crews.map((c) => ({ ...c, state: c.state as CrewGlyph["state"] })),
    ticket_flow,
    mttr_hist: [],
    element_health,
    sensing_health: {
      coverage: sim.sensing_coverage,
      alarm_delay_min: sim.alarm_delay_min,
      dead_olt: sim.dead_olt,
    },
    generated_at: sim.sim_min,
  };
}

interface IncidentSummaryRow {
  id: string;
  fault_id: string | null;
  state: string;
  detected_via: string;
  telemetry_dark: number;
  fault_kind: string | null;
  fault_kind_confidence: number;
  detection_confidence: number;
  detected_at: number;
  confirmed_at: number | null;
  resolved_at: number | null;
  top_suspect: string | null;
  top_confidence: number;
  predicted_mttr_p50: number;
  predicted_mttr_p90: number;
  eta_hrs: number | null;
  vendor_id: string | null;
  rank_score: number;
  observed_count: number;
  inferred_count: number;
  vip_count: number;
  peso_exposure: number;
  worst_hours_down: number;
}

function rowToIncident(r: IncidentSummaryRow): IncidentSummary {
  return {
    id: r.id,
    fault_id: r.fault_id,
    state: r.state as IncidentSummary["state"],
    detected_via: r.detected_via as IncidentSummary["detected_via"],
    telemetry_dark: !!r.telemetry_dark,
    fault_kind: (r.fault_kind as IncidentSummary["fault_kind"]) ?? null,
    fault_kind_confidence: r.fault_kind_confidence,
    detected_at: r.detected_at,
    confirmed_at: r.confirmed_at,
    resolved_at: r.resolved_at,
    top_suspect: r.top_suspect,
    top_confidence: r.top_confidence,
    observed_count: r.observed_count,
    inferred_count: r.inferred_count,
    vip_count: r.vip_count,
    peso_exposure: r.peso_exposure,
    predicted_mttr_p50: r.predicted_mttr_p50,
    predicted_mttr_p90: r.predicted_mttr_p90,
    worst_hours_down: r.worst_hours_down,
    rank_score: r.rank_score,
    vendor_id: r.vendor_id,
    detection_confidence: r.detection_confidence,
  };
}
