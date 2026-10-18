import type { DB } from "../db";
import { haversineKm } from "../geo";
import type { TopoIndex } from "./topo-index";
import type { RecordedIndex } from "./recorded-index";
import type { SensingSets } from "./world";
import { activeFaults, type FaultRow } from "./faults";
import { buildObserveContext, gatherObserved, type ObserveContext } from "./observe";

interface Candidate {
  element: string;
  kind: string;
  observedUnder: number;
  recordedUnder: number;
  polledUnder: number;
  mismappedUnder: number;
  score: number;
  confidence: number;
  band: number;
  siblingsClean: number;
  siblingsTotal: number;
  recConf: number;
  conflict: boolean;
}

/**
 * Isolation (Decide-1) + scoping (Decide-2), per open incident.
 * Ranks suspect elements on the RECORDED tree, honestly lowering confidence
 * where records conflict, then computes the blast radius (observed vs inferred).
 */
export function runIsolation(
  db: DB,
  topo: TopoIndex,
  rec: RecordedIndex,
  sensing: SensingSets,
  simMin: number
): void {
  const ctx = buildObserveContext(db, topo, sensing);
  const areaByDistrict = new Map(
    (db.prepare("SELECT id, area_class FROM districts").all() as { id: string; area_class: string }[]).map((d) => [
      d.id,
      d.area_class,
    ])
  );

  const incidents = db
    .prepare(
      "SELECT id, fault_id, state, detection_confidence FROM incidents WHERE state IN ('suspected','isolating','confirmed')"
    )
    .all() as { id: string; fault_id: string | null; state: string; detection_confidence: number }[];
  const faultById = new Map((activeFaults(db) as FaultRow[]).map((f) => [f.id, f]));

  for (const inc of incidents) {
    const fault = inc.fault_id ? faultById.get(inc.fault_id) : undefined;
    if (!fault) continue;
    const observed = gatherObserved(fault, topo, ctx);
    if (observed.length === 0) continue;

    const ranked = rankSuspects(observed, rec, ctx);
    if (ranked.length === 0) continue;
    const top = ranked[0];

    persistSuspicions(db, inc.id, ranked, rec, simMin);
    const test = confirmingTest(top, topo, rec);
    const blast = computeBlast(db, inc.id, top.element, rec, ctx, fault, simMin);

    const area = areaByDistrict.get(rec.node(top.element)?.district ?? "") ?? "urban";
    const state = nextState(inc.state, inc.detection_confidence, top.confidence);
    db.prepare(
      `UPDATE incidents SET top_suspect=?, top_confidence=?, state=?, confirming_test=?,
         observed_count=?, inferred_count=?, vip_count=?, b2b_count=?, peso_exposure=?, worst_hours_down=?, area_class=?
       WHERE id=?`
    ).run(
      top.element,
      Number(top.confidence.toFixed(3)),
      state,
      test,
      blast.observed,
      blast.inferred,
      blast.vip,
      blast.b2b,
      Number(blast.peso.toFixed(0)),
      Number(blast.worstHours.toFixed(2)),
      area,
      inc.id
    );
  }
  refreshRepairingBlast(db, simMin);
}

/**
 * Once an incident is being repaired its suspect and blast radius are fixed,
 * but the world keeps moving: customers still call (cluster their tickets to
 * the known root cause — Customer Service sees the answer) and outage hours
 * keep growing (which is what triggers credits and retention offers).
 */
function refreshRepairingBlast(db: DB, simMin: number): void {
  const ids = (db.prepare("SELECT id FROM incidents WHERE state IN ('repairing','verifying')").all() as { id: string }[]).map((r) => r.id);
  if (!ids.length) return;
  const link = db.prepare(
    `UPDATE tickets SET parent_incident_id=? WHERE closed_at IS NULL AND kind='valid' AND parent_incident_id IS NULL
        AND line_id IN (SELECT line_id FROM blast_radius WHERE incident_id=?)`
  );
  const observe = db.prepare(
    `UPDATE blast_radius SET ticketed=1, evidence='observed'
      WHERE incident_id=? AND ticketed=0 AND line_id IN (SELECT line_id FROM tickets WHERE closed_at IS NULL AND kind='valid')`
  );
  const hours = db.prepare(
    `UPDATE blast_radius SET hours_down = ROUND((? - (SELECT COALESCE(l.offline_since, l.degraded_since) FROM lines l WHERE l.line_id = blast_radius.line_id)) / 60.0, 2)
      WHERE incident_id=? AND line_id IN (SELECT line_id FROM lines WHERE status != 'online')`
  );
  const roll = db.prepare(
    `UPDATE incidents SET
        worst_hours_down = (SELECT COALESCE(MAX(hours_down), 0) FROM blast_radius WHERE incident_id = incidents.id),
        observed_count   = (SELECT COUNT(*) FROM blast_radius WHERE incident_id = incidents.id AND evidence = 'observed'),
        inferred_count   = (SELECT COUNT(*) FROM blast_radius WHERE incident_id = incidents.id AND evidence = 'inferred')
      WHERE id=?`
  );
  db.transaction(() => {
    for (const id of ids) {
      link.run(id, id);
      observe.run(id);
      hours.run(simMin, id);
      roll.run(id);
    }
  })();
}

function rankSuspects(
  observed: { lineId: string }[],
  rec: RecordedIndex,
  _ctx: ObserveContext
): Candidate[] {
  const total = observed.length;
  // Tally observed lines under each recorded element (self + ancestors).
  const observedUnder = new Map<string, number>();
  const mismappedUnder = new Map<string, number>();
  const recById = rec;
  const mismappedSet = new Set<string>(); // filled lazily below

  // Which observed lines are recorded-mismapped?
  for (const o of observed) {
    const isMis = recById.node(o.lineId)?.mismapped === true;
    for (const el of [o.lineId, ...rec.ancestors(o.lineId)]) {
      observedUnder.set(el, (observedUnder.get(el) ?? 0) + 1);
      if (isMis) mismappedUnder.set(el, (mismappedUnder.get(el) ?? 0) + 1);
    }
    if (isMis) mismappedSet.add(o.lineId);
  }
  void mismappedSet;

  const candidates: Candidate[] = [];
  for (const [el, obs] of observedUnder) {
    if (obs < 1) continue;
    const node = rec.node(el);
    if (!node) continue;
    const under = rec.linesUnder(el).length || 1;
    const polledUnder = rec.linesUnder(el).filter((l) => _ctx.polled.has(l)).length;
    const coverageU = under ? polledUnder / under : 0;
    const completeness = obs / total;
    const specificity = obs / under;
    const recConf = node.confidence;
    // F-ish blend: reward containing most symptoms AND being tightly filled.
    const score = completeness * Math.sqrt(specificity) * (0.6 + 0.4 * recConf);

    // Sibling cleanliness: how many recorded siblings show no observed symptoms.
    const sibs = rec.siblings(el);
    const sibsClean = sibs.filter((s) => (observedUnder.get(s) ?? 0) === 0).length;

    const mis = mismappedUnder.get(el) ?? 0;
    const band = Math.max(0.05, Math.min(0.4, (1 - coverageU) * 0.35 + (1 - recConf) * 0.25));
    const confidence = Math.max(0.05, Math.min(0.98, score));
    candidates.push({
      element: el,
      kind: node.kind,
      observedUnder: obs,
      recordedUnder: under,
      polledUnder,
      mismappedUnder: mis,
      score,
      confidence,
      band,
      siblingsClean: sibsClean,
      siblingsTotal: sibs.length,
      recConf,
      conflict: false,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  // Record conflict: top suspect leans on mis-mapped lines, or a near-tie sibling.
  if (candidates.length > 0) {
    const top = candidates[0];
    const nearTieSibling =
      candidates[1] &&
      rec.node(candidates[1].element)?.parent === rec.node(top.element)?.parent &&
      candidates[1].score > top.score * 0.7;
    top.conflict = top.mismappedUnder > 0 || !!nearTieSibling;
    if (top.conflict) {
      // Conflict lowers the point estimate AND widens the band (honest uncertainty),
      // but the suspect stays #1 — the parent isn't a better answer.
      top.confidence = Math.max(0.05, top.confidence - 0.12);
      top.band = Math.min(0.45, top.band + 0.08);
    }
  }
  // Keep displayed confidence monotonic with rank so #1 never reads below #2.
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].confidence >= candidates[i - 1].confidence) {
      candidates[i].confidence = Math.max(0.05, candidates[i - 1].confidence - 0.03);
    }
  }
  return candidates.slice(0, 6);
}

function persistSuspicions(db: DB, incidentId: string, ranked: Candidate[], rec: RecordedIndex, simMin: number): void {
  db.prepare("DELETE FROM suspicions WHERE incident_id=?").run(incidentId);
  const ins = db.prepare(
    "INSERT INTO suspicions (incident_id, element_id, kind, confidence, rank, evidence_json, record_conflict, computed_at) VALUES (?,?,?,?,?,?,?,?)"
  );
  ranked.forEach((c, i) => {
    const pct = Math.round((c.polledUnder / (c.recordedUnder || 1)) * 100);
    let text = `${c.observedUnder}/${c.recordedUnder} recorded lines reporting · ${c.siblingsClean}/${c.siblingsTotal} siblings clean · sensing ${pct}% here`;
    if (c.conflict && c.mismappedUnder > 0) {
      const sib = rec.siblings(c.element)[0];
      text += ` · ${c.mismappedUnder} reporting line${c.mismappedUnder > 1 ? "s" : ""} recorded here but pattern fits ${sib ?? "a sibling"} — records conflict`;
    }
    ins.run(
      incidentId,
      c.element,
      c.kind,
      Number(c.confidence.toFixed(3)),
      i + 1,
      JSON.stringify({
        text,
        band: Number(c.band.toFixed(3)),
        observedUnder: c.observedUnder,
        recordedUnder: c.recordedUnder,
        coveragePct: pct,
        siblingsClean: c.siblingsClean,
        siblingsTotal: c.siblingsTotal,
        recordConfidence: Number(c.recConf.toFixed(2)),
        mismappedUnder: c.mismappedUnder,
      }),
      c.conflict ? 1 : 0,
      simMin
    );
  });
}

function confirmingTest(top: Candidate, topo: TopoIndex, rec: RecordedIndex): string {
  const el = top.element;
  const olt = [el, ...rec.ancestors(el)].find((id) => rec.node(id)?.kind === "olt");
  const pon = [el, ...rec.ancestors(el)].find((id) => rec.node(id)?.kind === "pon");
  // Estimate from plant-record locations (the platform's view), with a 1.4x
  // routing factor: cable follows streets, not the straight line.
  const a = olt ? rec.node(olt) : undefined;
  const b = rec.node(el);
  let dist = 1.2;
  if (a?.lat != null && a.lon != null && b?.lat != null && b.lon != null) {
    dist = Math.max(0.3, Math.round(haversineKm(a.lat, a.lon, b.lat, b.lon) * 1.4 * 10) / 10);
  }
  void topo;
  switch (top.kind) {
    case "splitter":
      return `OTDR from ${olt ?? "OLT"} ${pon ? "· " + pon : ""} → expected break ~${dist} km`;
    case "pon":
      return `Loopback + OTDR on ${el} → sweep to ~${dist} km`;
    case "olt":
      return `OLT port diagnostics on ${el}`;
    case "nap":
      return `OTDR to ${el} segment → expected break ~${dist} km`;
    default:
      return `Remote line test / reboot on ${el}`;
  }
}

interface BlastResult {
  observed: number;
  inferred: number;
  vip: number;
  b2b: number;
  peso: number;
  worstHours: number;
}

function computeBlast(
  db: DB,
  incidentId: string,
  suspect: string,
  rec: RecordedIndex,
  ctx: ObserveContext,
  fault: FaultRow,
  simMin: number
): BlastResult {
  const lines = rec.linesUnder(suspect);
  const subMap = new Map(
    (db.prepare("SELECT line_id, arpu, vip, b2b FROM subscribers").all() as {
      line_id: string;
      arpu: number;
      vip: number;
      b2b: number;
    }[]).map((s) => [s.line_id, s])
  );
  const lineStatus = new Map(
    (db.prepare("SELECT line_id, offline_since, degraded_since FROM lines").all() as {
      line_id: string;
      offline_since: number | null;
      degraded_since: number | null;
    }[]).map((l) => [l.line_id, l])
  );
  const existingNotify = new Map(
    (db.prepare("SELECT line_id, notified_at FROM blast_radius WHERE incident_id=?").all(incidentId) as {
      line_id: string;
      notified_at: number | null;
    }[]).map((b) => [b.line_id, b.notified_at])
  );

  db.prepare("DELETE FROM blast_radius WHERE incident_id=?").run(incidentId);
  const ins = db.prepare(
    "INSERT INTO blast_radius (incident_id, line_id, evidence, vip, b2b, arpu, ticketed, notified_at, hours_down) VALUES (?,?,?,?,?,?,?,?,?)"
  );

  let observed = 0,
    inferred = 0,
    vip = 0,
    b2b = 0,
    peso = 0,
    worstHours = 0;

  const linkTicket = db.prepare(
    "UPDATE tickets SET parent_incident_id=? WHERE closed_at IS NULL AND kind='valid' AND line_id=? AND parent_incident_id IS NULL"
  );
  const tx = db.transaction(() => {
    for (const lineId of lines) {
      const sub = subMap.get(lineId);
      const ticketed = ctx.ticketLines.has(lineId);
      if (ticketed) linkTicket.run(incidentId, lineId); // dedup: cluster tickets to root cause
      const tel = ctx.telByLine.get(lineId);
      const polled = ctx.polled.has(lineId);
      const telSymptom = polled && !!tel && (tel.reachable === 0 || tel.los === 1);
      const isObserved = ticketed || telSymptom;
      const st = lineStatus.get(lineId);
      const since = st?.offline_since ?? st?.degraded_since ?? fault.started_at;
      const hours = Math.max(0, (simMin - (since ?? simMin)) / 60);
      worstHours = Math.max(worstHours, hours);
      if (isObserved) observed++;
      else inferred++;
      if (sub?.vip) vip++;
      if (sub?.b2b) b2b++;
      peso += sub?.arpu ?? 0;
      ins.run(
        incidentId,
        lineId,
        isObserved ? "observed" : "inferred",
        sub?.vip ?? 0,
        sub?.b2b ?? 0,
        sub?.arpu ?? 0,
        ticketed ? 1 : 0,
        existingNotify.get(lineId) ?? null,
        Number(hours.toFixed(2))
      );
    }
  });
  tx();

  return { observed, inferred, vip, b2b, peso, worstHours };
}

function nextState(current: string, detConf: number, topConf: number): string {
  if (["repairing", "verifying", "resolved", "reopened"].includes(current)) return current;
  if (detConf >= 0.7 && topConf >= 0.6) return "confirmed";
  return "isolating";
}
