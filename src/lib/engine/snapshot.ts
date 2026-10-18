import type { DB } from "../db";
import { getSimState } from "../db";
import type { Health } from "../tokens";
import { healthFromRatio } from "../tokens";
import type { OpsSnapshot, IncidentSummary, TickerEntry, CrewGlyph, CityStat } from "../types";
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
    | { calls_deflected: number; wrong_rolls: number; correct_rolls: number; repairs_in_window: number; repairs_total: number; rolls_avoided: number }
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

  // Per-city rollups for the map choropleth.
  const cityOfDistrict = new Map(
    (db.prepare("SELECT id, city FROM districts").all() as { id: string; city: string }[]).map((d) => [d.id, d.city])
  );
  const arpuByLine = new Map(
    (db.prepare("SELECT line_id, arpu FROM subscribers").all() as { line_id: string; arpu: number }[]).map((r) => [r.line_id, r.arpu])
  );
  const confByDistrict = new Map(
    (db
      .prepare("SELECT district_id, AVG(record_confidence) c, COUNT(*) n FROM topology_recorded WHERE kind='ont' GROUP BY district_id")
      .all() as { district_id: string; c: number; n: number }[]).map((r) => [r.district_id, r])
  );
  const city_stats: Record<string, CityStat> = {};
  const confAcc = new Map<string, { sum: number; n: number }>();
  for (const lineId of topo.allLines) {
    const district = topo.node(lineId)?.district;
    const city = district ? cityOfDistrict.get(district) : undefined;
    if (!city) continue;
    const cs = (city_stats[city] ??= { lines: 0, impacted: 0, offline: 0, sensed: 0, tickets: 0, peso_at_risk: 0, record_conf: 1, sell: "sell", campaign_hold: false });
    cs.lines++;
    const imp = impacted.get(lineId);
    if (imp) {
      cs.impacted++;
      if (imp.status === "offline") cs.offline++;
      cs.peso_at_risk += arpuByLine.get(lineId) ?? 0;
    }
    if (polledSet.has(lineId)) cs.sensed++;
    if (ticketedLines.has(lineId)) cs.tickets++;
  }
  for (const [district, r] of confByDistrict) {
    const city = cityOfDistrict.get(district);
    if (!city) continue;
    const acc = confAcc.get(city) ?? { sum: 0, n: 0 };
    acc.sum += r.c * r.n;
    acc.n += r.n;
    confAcc.set(city, acc);
  }
  for (const [city, acc] of confAcc) if (city_stats[city]) city_stats[city].record_conf = acc.n ? acc.sum / acc.n : 1;

  // Sell / hold: active outages or a paused campaign → hold; weak visibility → sell with care.
  const held = new Set((db.prepare("SELECT city FROM campaign_holds WHERE released_at IS NULL").all() as { city: string }[]).map((r) => r.city));
  for (const [city, cs] of Object.entries(city_stats)) {
    cs.campaign_hold = held.has(city);
    const downShare = cs.lines ? cs.impacted / cs.lines : 0;
    cs.sell = cs.campaign_hold || downShare >= 0.03 ? "hold" : downShare >= 0.01 || cs.record_conf < 0.86 ? "care" : "sell";
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

  // Crews drive from their exchange (the target's OLT) to the site: interpolate
  // the live position by travel progress so the map shows them moving.
  const crewRows = db
    .prepare(
      "SELECT id as job_id, vendor_id, crew_type, grid_x, grid_y, state, incident_id, target_element, lat, lon, dispatched_at, arrived_at FROM crew_jobs WHERE state != 'done'"
    )
    .all() as (Omit<CrewGlyph, "from_lat" | "from_lon" | "to_lat" | "to_lon" | "progress" | "eta_min"> & {
    dispatched_at: number;
    arrived_at: number | null;
  })[];
  const crews: CrewGlyph[] = crewRows.map((c) => {
    const oltId = [c.target_element, ...topo.ancestors(c.target_element)].find((id) => topo.node(id)?.kind === "olt");
    const from = oltId ? topo.node(oltId) : undefined;
    const travel = Math.max(1, (c.arrived_at ?? c.dispatched_at) - c.dispatched_at);
    const progress = c.state === "enroute" ? Math.min(1, Math.max(0, (sim.sim_min - c.dispatched_at) / travel)) : 1;
    const fLat = from?.lat ?? c.lat;
    const fLon = from?.lon ?? c.lon;
    const lerp = (a: number | null, b: number | null) => (a === null || b === null ? b : a + (b - a) * progress);
    return {
      job_id: c.job_id,
      vendor_id: c.vendor_id,
      crew_type: c.crew_type,
      grid_x: c.grid_x,
      grid_y: c.grid_y,
      state: c.state,
      incident_id: c.incident_id,
      target_element: c.target_element,
      lat: lerp(fLat, c.lat),
      lon: lerp(fLon, c.lon),
      from_lat: fLat,
      from_lon: fLon,
      to_lat: c.lat,
      to_lon: c.lon,
      progress,
      eta_min: c.state === "enroute" ? Math.max(0, (c.arrived_at ?? sim.sim_min) - sim.sim_min) : 0,
    };
  });

  // MTTR histogram (today's resolved repairs) vs the repair-window threshold.
  const bins: [number, number][] = [
    [0, 2],
    [2, 4],
    [4, 6],
    [6, 8],
    [8, 999],
  ];
  const mttr_hist = bins.map(([lo, hi]) => {
    const n = (
      db
        .prepare("SELECT COUNT(*) n FROM outcomes WHERE resolved_at >= ? AND mttr_actual_hrs >= ? AND mttr_actual_hrs < ?")
        .get(day * 1440, lo, hi) as { n: number }
    ).n;
    return { bucket: hi === 999 ? "8h+" : `${lo}–${hi}h`, count: n, over: lo >= sim.repair_window_hrs };
  });

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
      wrong_rolls_avoided: learn?.rolls_avoided ?? 0,
      peso_at_risk: pesoAtRisk,
    },
    incidents: incidents.map(rowToIncident),
    ticker,
    crews,
    ticket_flow,
    mttr_hist,
    element_health,
    city_stats,
    ticketed_lines: [...ticketedLines],
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
