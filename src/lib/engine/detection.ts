import type { DB } from "../db";
import { getSimState } from "../db";
import type { FaultKind, DetectedVia } from "../types";
import type { TopoIndex } from "./topo-index";
import type { RecordedIndex } from "./recorded-index";
import { activeFaults, faultImpact, type FaultRow } from "./faults";
import type { SensingSets } from "./world";
import { buildObserveContext, gatherObserved, type Observed } from "./observe";

let incidentSeq = 0;
export function resetIncidentSeq(db: DB) {
  incidentSeq = (db.prepare("SELECT COUNT(*) n FROM incidents").get() as { n: number }).n;
}
function newIncidentId(): string {
  incidentSeq++;
  return `INC-${String(incidentSeq).padStart(3, "0")}`;
}

/**
 * Detection fusion. For each active fault we gather what the platform can
 * actually OBSERVE (tickets + telemetry on polled lines), localize a rough
 * locus on the RECORDED topology, fuse per-signal contributions into a
 * detection confidence, and upsert an incident. Faults with no observable
 * symptom stay invisible — the honesty that makes ticket-only detection real.
 */
export function runDetection(
  db: DB,
  topo: TopoIndex,
  rec: RecordedIndex,
  sensing: SensingSets,
  simMin: number
): void {
  const sim = getSimState(db)!;
  const ctx = buildObserveContext(db, topo, sensing);
  const faults = activeFaults(db) as FaultRow[];

  // Auto-resolve only EARLY-state incidents whose fault self-healed (background
  // faults). Incidents under active handling (repairing/verifying/reopened) are
  // finalized by the crew + verification flow, not here — otherwise we'd race
  // past verification and never record the outcome.
  const activeFaultIds = new Set(faults.map((f) => f.id));
  const openInc = db
    .prepare("SELECT id, fault_id, state FROM incidents WHERE state IN ('suspected','isolating','confirmed')")
    .all() as { id: string; fault_id: string | null; state: string }[];
  for (const inc of openInc) {
    if (inc.fault_id && !activeFaultIds.has(inc.fault_id)) {
      db.prepare("UPDATE incidents SET state='resolved', resolved_at=? WHERE id=?").run(simMin, inc.id);
    }
  }

  for (const f of faults) {
    const impact = faultImpact(f, topo);
    if (impact.lines.length === 0) continue;

    const observed = gatherObserved(f, topo, ctx);
    if (observed.length === 0) continue; // undetectable right now (fully dark, no calls)

    const locus = localize(observed, rec);
    const via = classifyVia(observed, f, sim, topo);
    const contributions = signalContributions(observed, locus, rec, sensing, f, sim, topo);
    const detectionConfidence = fuseConfidence(contributions, rec.node(locus.element)?.confidence ?? 1);
    const dgRatio = dyingGaspRatio(observed);
    const { kind: guessKind, kindConf } = classifyKind(observed, locus, rec, dgRatio, impact.status);

    // Is the locus subtree effectively dark? (the money badge)
    const recLinesUnder = rec.linesUnder(locus.element);
    const polledUnder = recLinesUnder.filter((l) => sensing.polled.has(l)).length;
    const coverageUnder = recLinesUnder.length ? polledUnder / recLinesUnder.length : 0;
    const telemetryDark = coverageUnder < 0.25 && !observed.some((o) => o.viaTelemetry);

    upsertIncident(db, {
      fault_id: f.id,
      locus: locus.element,
      locusConfidence: locus.fill,
      detectionConfidence,
      detectedVia: via,
      telemetryDark,
      faultKind: guessKind,
      faultKindConfidence: kindConf,
      simMin,
      contributions,
      sample: {
        tickets: observed.filter((o) => o.viaTicket).length,
        telemetry: observed.filter((o) => o.viaTelemetry).length,
        unreachable: observed.filter((o) => o.unreachable).length,
        dgRatio,
      },
    });

    if (!f.detected) db.prepare("UPDATE faults SET detected=1 WHERE id=?").run(f.id);
  }
}

interface Locus {
  element: string;
  count: number;
  fill: number;
}

/** Climb the recorded tree to the highest element the outage still "fills". */
function localize(observed: Observed[], rec: RecordedIndex): Locus {
  const count = new Map<string, number>();
  for (const o of observed) {
    count.set(o.lineId, (count.get(o.lineId) ?? 0) + 1);
    for (const a of rec.ancestors(o.lineId)) count.set(a, (count.get(a) ?? 0) + 1);
  }
  const FILL = 0.4;
  let best: Locus | null = null;
  for (const [el, c] of count) {
    if (c < 2) continue;
    const under = rec.linesUnder(el).length || 1;
    const fill = c / under;
    if (fill >= FILL) {
      // Prefer the element covering the most observed lines (highest qualifying ancestor).
      if (!best || c > best.count || (c === best.count && fill > best.fill)) {
        best = { element: el, count: c, fill };
      }
    }
  }
  if (best) return best;
  // Single-line / sparse: locus is the line itself (drop/CPE candidate).
  const el = observed[0].lineId;
  return { element: el, count: 1, fill: 1 };
}

function classifyVia(observed: Observed[], f: FaultRow, sim: ReturnType<typeof getSimState>, topo: TopoIndex): DetectedVia {
  const tel = observed.filter((o) => o.viaTelemetry).length;
  const tick = observed.filter((o) => o.viaTicket).length;
  const alarm = alarmPresent(f, sim!, topo);
  if (tel > 0 && tick > 0) return "mixed";
  if (tel > 0) return alarm ? "mixed" : "telemetry";
  if (alarm) return "alarm";
  return "tickets";
}

/** OLT alarm feed: present only after delay, and never for the dead OLT. */
function alarmPresent(f: FaultRow, sim: NonNullable<ReturnType<typeof getSimState>>, topo: TopoIndex): boolean {
  if (f.kind !== "feeder_cut" && f.kind !== "olt_port_failure") return false;
  const oltAncestor = [f.element_id ?? "", ...topo.ancestors(f.element_id ?? "")].find(
    (id) => topo.node(id)?.kind === "olt"
  );
  if (!oltAncestor) return false;
  if (sim.dead_olt === oltAncestor) return false; // feed down
  return sim.sim_min - f.started_at >= sim.alarm_delay_min;
}

function dyingGaspRatio(observed: Observed[]): number {
  if (observed.length === 0) return 0;
  return observed.filter((o) => o.dyingGasp).length / observed.length;
}

interface Contribution {
  signal: DetectedVia | "dying_gasp";
  weight: number;
  detail: string;
}

function signalContributions(
  observed: Observed[],
  locus: Locus,
  rec: RecordedIndex,
  sensing: SensingSets,
  f: FaultRow,
  sim: ReturnType<typeof getSimState>,
  topo: TopoIndex
): Contribution[] {
  const out: Contribution[] = [];
  const under = rec.linesUnder(locus.element).length || 1;
  const tickN = observed.filter((o) => o.viaTicket).length;
  const telN = observed.filter((o) => o.viaTelemetry).length;
  const unreachN = observed.filter((o) => o.unreachable).length;
  const dg = dyingGaspRatio(observed);

  if (tickN > 0) {
    out.push({
      signal: "tickets",
      weight: Math.min(0.9, 0.35 + tickN / Math.max(4, under)),
      detail: `${tickN} customer ticket${tickN > 1 ? "s" : ""} in this subtree`,
    });
  }
  if (telN > 0) {
    out.push({
      signal: "telemetry",
      weight: Math.min(0.9, 0.4 + telN / Math.max(4, under)),
      detail: `${telN} polled line${telN > 1 ? "s" : ""} showing LOS / low Rx`,
    });
  }
  if (unreachN > 0) {
    out.push({
      signal: "reachability",
      weight: Math.min(0.7, 0.3 + unreachN / Math.max(4, under)),
      detail: `${unreachN} line${unreachN > 1 ? "s" : ""} unreachable`,
    });
  }
  if (alarmPresent(f, sim!, topo)) {
    out.push({ signal: "alarm", weight: 0.6, detail: "OLT alarm feed corroborates" });
  }
  if (dg >= 0.3) {
    out.push({ signal: "dying_gasp", weight: Math.min(0.85, dg), detail: `${Math.round(dg * 100)}% dying-gasp → power-loss signature` });
  }
  return out;
}

/** Noisy-OR fusion of independent signal weights, dampened by record confidence. */
function fuseConfidence(contribs: Contribution[], recordConfidence: number): number {
  let notAny = 1;
  for (const c of contribs) notAny *= 1 - Math.max(0, Math.min(0.95, c.weight));
  const raw = 1 - notAny;
  return Number((raw * (0.6 + 0.4 * recordConfidence)).toFixed(3)); // uncertain records → lower confidence
}

function classifyKind(
  observed: Observed[],
  locus: Locus,
  rec: RecordedIndex,
  dgRatio: number,
  status: "offline" | "degraded"
): { kind: FaultKind; kindConf: number } {
  if (dgRatio >= 0.35) return { kind: "power_outage", kindConf: Math.min(0.92, 0.55 + dgRatio / 2) };
  const node = rec.node(locus.element);
  const kind = node?.kind;
  if (kind === "ont") return status === "degraded" ? { kind: "cpe_issue", kindConf: 0.55 } : { kind: "drop_cut", kindConf: 0.6 };
  if (kind === "nap") return { kind: "distribution_cut", kindConf: 0.5 };
  if (kind === "splitter") return { kind: locus.fill > 0.8 ? "splitter_failure" : "distribution_cut", kindConf: 0.55 };
  if (kind === "pon") return { kind: "olt_port_failure", kindConf: 0.5 };
  if (kind === "olt") return { kind: "feeder_cut", kindConf: 0.5 };
  return { kind: "distribution_cut", kindConf: 0.4 };
}

interface UpsertArgs {
  fault_id: string;
  locus: string;
  locusConfidence: number;
  detectionConfidence: number;
  detectedVia: DetectedVia;
  telemetryDark: boolean;
  faultKind: FaultKind;
  faultKindConfidence: number;
  simMin: number;
  contributions: Contribution[];
  sample: { tickets: number; telemetry: number; unreachable: number; dgRatio: number };
}

function upsertIncident(db: DB, a: UpsertArgs): void {
  const existing = db
    .prepare("SELECT id, state FROM incidents WHERE fault_id=? AND state NOT IN ('resolved') ORDER BY detected_at LIMIT 1")
    .get(a.fault_id) as { id: string; state: string } | undefined;

  const state = a.detectionConfidence >= 0.7 ? "confirmed" : "suspected";
  let incidentId: string;

  if (existing) {
    incidentId = existing.id;
    // Don't downgrade a confirmed/isolating/repairing incident.
    const keepState = ["confirmed", "isolating", "repairing", "verifying"].includes(existing.state)
      ? existing.state
      : state;
    db.prepare(
      `UPDATE incidents SET detected_via=?, telemetry_dark=?, fault_kind=?, fault_kind_confidence=?,
        detection_confidence=?, top_suspect=?, top_confidence=?, state=?,
        confirmed_at=COALESCE(confirmed_at, CASE WHEN ?='confirmed' THEN ? ELSE NULL END)
       WHERE id=?`
    ).run(
      a.detectedVia,
      a.telemetryDark ? 1 : 0,
      a.faultKind,
      a.faultKindConfidence,
      a.detectionConfidence,
      a.locus,
      Number((a.locusConfidence * a.detectionConfidence).toFixed(3)),
      keepState,
      state,
      a.simMin,
      incidentId
    );
  } else {
    incidentId = newIncidentId();
    db.prepare(
      `INSERT INTO incidents (id, fault_id, state, detected_via, telemetry_dark, fault_kind, fault_kind_confidence,
         detection_confidence, detected_at, confirmed_at, top_suspect, top_confidence)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      incidentId,
      a.fault_id,
      state,
      a.detectedVia,
      a.telemetryDark ? 1 : 0,
      a.faultKind,
      a.faultKindConfidence,
      a.detectionConfidence,
      a.simMin,
      state === "confirmed" ? a.simMin : null,
      a.locus,
      Number((a.locusConfidence * a.detectionConfidence).toFixed(3))
    );
    const darkTag = a.telemetryDark ? " · telemetry dark in this subtree" : "";
    db.prepare("INSERT INTO events (sim_ts, kind, text, href, source) VALUES (?,?,?,?,?)").run(
      a.simMin,
      "detection",
      `${incidentId} detected via ${a.detectedVia}${darkTag} — locus ${a.locus}`,
      `/incidents?id=${incidentId}`,
      a.detectedVia.toUpperCase()
    );
  }

  // Refresh signal contributions for this incident.
  db.prepare("DELETE FROM signal_contributions WHERE incident_id=?").run(incidentId);
  const insC = db.prepare(
    "INSERT INTO signal_contributions (incident_id, signal, weight, detail, computed_at) VALUES (?,?,?,?,?)"
  );
  for (const c of a.contributions) insC.run(incidentId, c.signal, Number(c.weight.toFixed(3)), c.detail, a.simMin);

  // Record a detection sample (bucketed to ~5 sim-min) for the mini-charts.
  const bucket = Math.round(a.simMin / 5) * 5;
  db.prepare(
    `INSERT INTO detection_samples (incident_id, sim_ts, detection_confidence, tickets, telemetry, unreachable, dying_gasp_ratio)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(incident_id, sim_ts) DO UPDATE SET
       detection_confidence=excluded.detection_confidence, tickets=excluded.tickets,
       telemetry=excluded.telemetry, unreachable=excluded.unreachable, dying_gasp_ratio=excluded.dying_gasp_ratio`
  ).run(incidentId, bucket, a.detectionConfidence, a.sample.tickets, a.sample.telemetry, a.sample.unreachable, Number(a.sample.dgRatio.toFixed(3)));
  // Keep only the most recent ~60 samples per incident.
  db.prepare(
    `DELETE FROM detection_samples WHERE incident_id=? AND sim_ts NOT IN
       (SELECT sim_ts FROM detection_samples WHERE incident_id=? ORDER BY sim_ts DESC LIMIT 60)`
  ).run(incidentId, incidentId);
}
