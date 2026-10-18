import { getDb, getSimState, isSeeded, type DB } from "../db";
import { RNG } from "../rng";
import { seedWorld } from "../seed";
import { TopoIndex } from "./topo-index";
import {
  spawnBackgroundFaults,
  clearExpiredFaults,
  resetFaultSeq,
  injectFault,
  type FaultRow,
} from "./faults";
import {
  recomputeImpact,
  applyLineChanges,
  updateChurnHazard,
  loadSensing,
  type ImpactState,
} from "./world";
import { ticketingPass, closeTicketsForRecovered, resetTicketSeq, spawnInvalidTickets } from "./tickets";
import { buildSnapshot } from "./snapshot";
import type { FaultKind, OpsSnapshot } from "../types";
import { runDetection, resetIncidentSeq } from "./detection";
import { runIsolation } from "./isolation";
import { runPrioritization } from "./prioritization";
import {
  generateProposals,
  crewStep,
  decideProposal,
  bumpLearn,
  resetProposalSeq,
  resetCrewSeq,
  submitCloseoutNow,
} from "./proposals";
import { runVerification, acceptCorrection } from "./verification";
import { retrainModel } from "./learn-ops";
import { RecordedIndex } from "./recorded-index";
import { APPROVER, type ProposalKind, type Role } from "../roles";

const TICK_MS = 1000; // one real second per tick
type Listener = (json: string) => void;

interface EngineCore {
  db: DB;
  topo: TopoIndex;
  rec: RecordedIndex;
  rng: RNG;
  prevImpacted: Map<string, ImpactState>;
  listeners: Set<Listener>;
  timer: ReturnType<typeof setInterval> | null;
  lastJson: string;
  booted: boolean;
}

const g = globalThis as unknown as { __sdal_engine?: EngineCore };

function core(): EngineCore {
  if (!g.__sdal_engine) {
    const db = getDb();
    if (!isSeeded(db)) seedWorld(db);
    const sim = getSimState(db)!;
    g.__sdal_engine = {
      db,
      topo: new TopoIndex(db),
      rec: new RecordedIndex(db),
      rng: new RNG(sim.seed + 1000),
      prevImpacted: new Map(),
      listeners: new Set(),
      timer: null,
      lastJson: "",
      booted: false,
    };
    // Boot on construction, whichever entry point (instrumentation hook, an API
    // route, SSE) reaches the engine first. Skipping this after a restart left
    // line impact empty and restarted the ID counters (FLT-/INC-/PROP-), which
    // collide with rows already in the database.
    boot(g.__sdal_engine);
  }
  return g.__sdal_engine;
}

function boot(c: EngineCore): void {
  if (c.booted) return;
  c.booted = true;
  resetFaultSeq(c.db);
  resetTicketSeq(c.db);
  resetIncidentSeq(c.db);
  resetProposalSeq(c.db);
  resetCrewSeq(c.db);
  c.prevImpacted = recomputeImpact(c.db, c.topo);
  publish();
  const sim = getSimState(c.db)!;
  if (sim.running && sim.speed > 0) startTimer();
}

export function bootEngine(): void {
  core(); // construction boots the engine
}

function startTimer(): void {
  const c = core();
  if (c.timer) return;
  c.timer = setInterval(() => {
    const sim = getSimState(c.db)!;
    if (!sim.running || sim.speed === 0) return;
    stepWorld(sim.speed);
    publish();
  }, TICK_MS);
}

function stopTimer(): void {
  const c = core();
  if (c.timer) {
    clearInterval(c.timer);
    c.timer = null;
  }
}

let eventSeqNudge = 0;
function logEvent(kind: string, text: string, href: string | null, source = "ENGINE"): void {
  const c = core();
  const sim = getSimState(c.db)!;
  c.db.prepare("INSERT INTO events (sim_ts, kind, text, href, source) VALUES (?,?,?,?,?)").run(
    sim.sim_min + (eventSeqNudge++ % 1),
    kind,
    text,
    href,
    source
  );
}

/** Advance the world by `minutes` sim-minutes (one coherent step). */
function stepWorld(minutes: number): void {
  const c = core();
  const db = c.db;
  const sim = getSimState(db)!;
  const simMin = sim.sim_min + minutes;
  db.prepare("UPDATE sim_state SET sim_min=? WHERE id=1").run(simMin);

  clearExpiredFaults(db, simMin);
  crewStep(db, c.topo, c.rec, simMin); // advance crews; completed repairs file close-outs and resolve faults
  const spawned = spawnBackgroundFaults(db, c.rng, c.topo, simMin, minutes);
  for (const f of spawned) {
    const impLines = f.element_id ? c.topo.linesUnder(f.element_id).length : 0;
    if (impLines >= 6) {
      const node = c.topo.node(f.element_id ?? "");
      logEvent("signal", `${impLines} lines degrading near ${node?.district ?? "network"}`, null);
    }
  }

  const sensing = loadSensing(db);
  const next = recomputeImpact(db, c.topo);
  const { recovered } = applyLineChanges(db, c.prevImpacted, next, sensing, simMin);
  if (recovered.length) closeTicketsForRecovered(db, simMin, recovered);
  const tk = ticketingPass(db, c.rng, simMin, minutes, next);
  if (tk.deflected > 0) bumpLearn(db, Math.floor(simMin / 1440), "calls_deflected", tk.deflected);
  updateChurnHazard(db, simMin, minutes);

  // Detection (M3) → isolation + scoping (M4) → MTTR + prioritization (M5) → action ladder (M6).
  runDetection(db, c.topo, c.rec, sensing, simMin);
  runIsolation(db, c.topo, c.rec, sensing, simMin);
  runVerification(db, c.topo, c.rec, simMin); // Learn: confirm recovery or reopen
  runPrioritization(db);
  generateProposals(db, c.topo);

  c.prevImpacted = next;
}

function publish(): void {
  const c = core();
  const snap = buildSnapshot(c.db, c.topo, c.prevImpacted);
  c.lastJson = JSON.stringify(snap);
  for (const cb of c.listeners) {
    try {
      cb(c.lastJson);
    } catch {
      /* listener errors shouldn't break the loop */
    }
  }
}

// ---- Public API ----

export function getSnapshot(): OpsSnapshot {
  const c = core();
  return buildSnapshot(c.db, c.topo, c.prevImpacted);
}

export function getSnapshotJson(): string {
  const c = core();
  if (!c.lastJson) publish();
  return c.lastJson;
}

export function subscribe(cb: Listener): () => void {
  const c = core();
  c.listeners.add(cb);
  return () => c.listeners.delete(cb);
}

export function setClock(cmd: { speed?: 0 | 1 | 4 | 16; running?: boolean; advance6h?: boolean }): OpsSnapshot {
  const c = core();
  const db = c.db;

  if (cmd.advance6h) {
    // Process 6 sim-hours in 30-min chunks so dynamics evolve.
    for (let i = 0; i < 12; i++) stepWorld(30);
    publish();
    return getSnapshot();
  }

  const sim = getSimState(db)!;
  const speed = cmd.speed ?? sim.speed;
  const running = cmd.running ?? sim.running === 1;
  db.prepare("UPDATE sim_state SET speed=?, running=? WHERE id=1").run(speed, running ? 1 : 0);

  if (running && speed > 0) startTimer();
  else stopTimer();

  publish();
  return getSnapshot();
}

export function resetWorld(): OpsSnapshot {
  const c = core();
  stopTimer();
  seedWorld(c.db);
  c.topo = new TopoIndex(c.db);
  c.rec = new RecordedIndex(c.db);
  c.rng = new RNG(getSimState(c.db)!.seed + 1000);
  resetFaultSeq(c.db);
  resetTicketSeq(c.db);
  resetIncidentSeq(c.db);
  resetProposalSeq(c.db);
  resetCrewSeq(c.db);
  c.prevImpacted = recomputeImpact(c.db, c.topo);
  eventSeqNudge = 0;
  publish();
  return getSnapshot();
}

/** Recompute impact and apply line/telemetry changes immediately (no time passes). */
function applyImpactNow(c: EngineCore, simMin: number): void {
  const sensing = loadSensing(c.db);
  const next = recomputeImpact(c.db, c.topo);
  applyLineChanges(c.db, c.prevImpacted, next, sensing, simMin);
  c.prevImpacted = next;
  // Fire telemetry/dying-gasp/alarm-based detection right away (tickets accrue over time).
  runDetection(c.db, c.topo, c.rec, sensing, simMin);
  runIsolation(c.db, c.topo, c.rec, sensing, simMin);
  runPrioritization(c.db);
  generateProposals(c.db, c.topo);
}

/** Approve / reject / edit a proposal (role-gated), executing side-effects. */
export function decide(
  proposalId: string,
  decision: "approve" | "reject" | "edit",
  role: Role,
  rationale?: string
): { ok: boolean; error?: string } {
  const c = core();
  const res = decideProposal(c.db, c.topo, c.rng, proposalId, decision, role, rationale);
  if (res.ok) {
    applyImpactNow(c, getSimState(c.db)!.sim_min); // a remote fix / resolution may recover lines now
    publish();
  }
  return res;
}

/** Partner portal: a crew on site submits its close-out now. */
export function submitCloseout(jobId: string): { ok: boolean; error?: string } {
  const c = core();
  const simMin = getSimState(c.db)!.sim_min;
  const res = submitCloseoutNow(c.db, c.topo, c.rec, jobId, simMin);
  if (res.ok) {
    applyImpactNow(c, simMin);
    publish();
  }
  return res;
}

/** Learn: retrain the MTTR model from outcomes and re-rank incidents. */
export function retrain(): { version: number; adjusted: number } {
  const c = core();
  const r = retrainModel(c.db);
  runPrioritization(c.db);
  publish();
  return r;
}

/** Learn: accept a suggested plant-record correction (rewrites recorded topology). */
export function acceptRecordCorrection(correctionId: string): boolean {
  const c = core();
  const ok = acceptCorrection(c.db, correctionId, getSimState(c.db)!.sim_min);
  if (ok) {
    c.rec = new RecordedIndex(c.db); // recorded topology changed
    publish();
  }
  return ok;
}

export function inject(opts: {
  kind: FaultKind;
  element_id?: string | null;
  power_grid?: string | null;
  severity?: number;
  autoClearMin?: number | null;
}): FaultRow {
  const c = core();
  const sim = getSimState(c.db)!;
  const f = injectFault(c.db, { ...opts, simMin: sim.sim_min });
  applyImpactNow(c, sim.sim_min);
  const node = c.topo.node(opts.element_id ?? "");
  logEvent("inject", `Injected ${opts.kind}${node ? ` at ${node.id}` : opts.power_grid ? ` on ${opts.power_grid}` : ""}`, null, "DIRECTOR");
  publish();
  return f;
}

/** Inject by kind, auto-selecting a plausible target element when none given. */
export function injectScenario(
  kind: FaultKind,
  opts?: { element_id?: string | null; power_grid?: string | null; autoClearMin?: number | null }
): FaultRow {
  const c = core();
  let element = opts?.element_id ?? null;
  let powerGrid = opts?.power_grid ?? null;
  const nodesOf = (k: string) => [...c.topo.nodes.values()].filter((n) => n.kind === k);

  if (!element && !powerGrid) {
    switch (kind) {
      case "feeder_cut":
      case "olt_port_failure":
        element = c.rng.pick(nodesOf("pon")).id;
        break;
      case "distribution_cut":
      case "splitter_failure":
        element = c.rng.pick(nodesOf("splitter")).id;
        break;
      case "power_outage": {
        const districts = c.db.prepare("SELECT DISTINCT power_grid FROM districts").all() as { power_grid: string }[];
        powerGrid = c.rng.pick(districts).power_grid;
        break;
      }
      case "noise":
        element = c.rng.pick(nodesOf("nap")).id;
        break;
      default: // drop_cut, cpe_issue
        element = c.rng.pick(c.topo.allLines);
    }
  }
  // A commercial power outage ends when the utility restores power (~4h) — there is no crew to send.
  const autoClear = opts?.autoClearMin ?? (kind === "power_outage" ? 240 : null);
  return inject({ kind, element_id: element, power_grid: powerGrid, autoClearMin: autoClear });
}

/** Ticket storm: inject a distribution cut + a burst of invalid tickets. */
export function ticketStorm(): { faults: number; tickets: number } {
  const c = core();
  const sim = getSimState(c.db)!;
  injectScenario("distribution_cut");
  const n = spawnInvalidTickets(c.db, c.rng, sim.sim_min, 30);
  logEvent("storm", `Ticket storm — distribution cut + ${n} user-side tickets`, null, "DIRECTOR");
  publish();
  return { faults: 1, tickets: n };
}

/** Quiet period: clear self-healing background faults so the board calms. */
export function quietPeriod(): { cleared: number } {
  const c = core();
  const sim = getSimState(c.db)!;
  const res = c.db.prepare("UPDATE faults SET resolved=1, cleared_at=? WHERE injected=0 AND resolved=0").run(sim.sim_min);
  applyImpactNow(c, sim.sim_min);
  logEvent("quiet", `Quiet period — ${res.changes} background faults cleared`, null, "DIRECTOR");
  publish();
  return { cleared: res.changes };
}

export function listOlts(): string[] {
  const c = core();
  return [...c.topo.nodes.values()].filter((n) => n.kind === "olt").map((n) => n.id).sort();
}

export function setSensing(cfg: { coverage?: number; alarm_delay_min?: number; dead_olt?: string | null }): OpsSnapshot {
  const c = core();
  const cur = getSimState(c.db)!;
  c.db
    .prepare("UPDATE sim_state SET sensing_coverage=?, alarm_delay_min=?, dead_olt=? WHERE id=1")
    .run(
      cfg.coverage ?? cur.sensing_coverage,
      cfg.alarm_delay_min ?? cur.alarm_delay_min,
      cfg.dead_olt === undefined ? cur.dead_olt : cfg.dead_olt
    );
  // Adjust which lines are polled if coverage changed.
  if (cfg.coverage !== undefined) applyCoverage(c.db, c.rng, cfg.coverage);
  publish();
  return getSnapshot();
}

/** Re-derive polled flags to match a new coverage fraction (director). */
function applyCoverage(db: DB, rng: RNG, coverage: number): void {
  const lines = db.prepare("SELECT line_id FROM sensing ORDER BY line_id").all() as { line_id: string }[];
  const upd = db.prepare("UPDATE sensing SET polled=? WHERE line_id=?");
  const tx = db.transaction(() => {
    for (const l of lines) upd.run(rng.bool(coverage) ? 1 : 0, l.line_id);
  });
  tx();
}

// ---- One-click leadership demo ------------------------------------------------

function approveAllPending(c: EngineCore, only?: (kind: ProposalKind, incidentId: string) => boolean): number {
  const pending = c.db.prepare("SELECT id, kind, incident_id, payload_json FROM proposals WHERE state='pending' ORDER BY created_at, id").all() as {
    id: string;
    kind: ProposalKind;
    incident_id: string;
    payload_json: string;
  }[];
  let n = 0;
  for (const p of pending) {
    if (only && !only(p.kind, p.incident_id)) continue;
    if ((JSON.parse(p.payload_json) as { held?: boolean }).held) continue;
    if (decide(p.id, "approve", APPROVER[p.kind]).ok) n++;
  }
  return n;
}

/**
 * Prepare the leadership walkthrough deterministically: a day of history in
 * which every team has acted (so Learn, partner close-outs, retention lift and
 * campaign holds all have real numbers), then one fresh "hero" outage left
 * with live decisions for each persona to make on camera.
 */
export function leadershipDemo(): { hero: string | null; heroCity: string | null; heroElement: string; simMin: number } {
  const c = core();
  stopTimer();
  resetWorld();
  setSensing({ coverage: 0.45 });

  // History: a day of outages, every team acting on its own decisions.
  for (const k of ["feeder_cut", "distribution_cut", "power_outage", "drop_cut", "cpe_issue", "cpe_issue"] as FaultKind[]) injectScenario(k);
  // Each team acts on its queue within half an hour, as it would on shift.
  for (let i = 0; i < 36; i++) {
    stepWorld(30);
    approveAllPending(c);
  }
  // Partners' record fixes: most are already accepted; leave the newest to accept live.
  const sugg = c.db.prepare("SELECT id FROM record_corrections WHERE status='suggested' ORDER BY sim_ts ASC, id ASC").all() as { id: string }[];
  for (const r of sugg.slice(0, Math.max(0, sugg.length - 3))) acceptCorrection(c.db, r.id, getSimState(c.db)!.sim_min);
  c.rec = new RecordedIndex(c.db);

  // The hero outage: a primary-splitter cut concentrated in one city, with business accounts.
  const hero = pickHeroSplitter(c);
  injectScenario("distribution_cut", { element_id: hero });
  for (let i = 0; i < 4; i++) stepWorld(15); // an hour: tickets accrue, isolation hardens
  const inc = c.db
    .prepare("SELECT i.id FROM incidents i JOIN faults f ON f.id = i.fault_id WHERE f.element_id = ? AND i.state != 'resolved' ORDER BY i.detected_at DESC LIMIT 1")
    .get(hero) as { id: string } | undefined;
  // Background noise from the last hour is handled; the hero gets its NOC decisions
  // and the crew is sent — it arrives on camera once the presenter runs the clock.
  approveAllPending(c, (_k, id) => id !== inc?.id);
  if (inc) {
    approveAllPending(c, (k, id) => id === inc.id && (k === "confirming_test" || k === "dispatch"));
    // A 120-line cut takes the long end of the repair estimate (p90), so the crew is
    // still on site when the partner files the close-out at the end of the walkthrough.
    const p90 = (c.db.prepare("SELECT predicted_mttr_p90 FROM incidents WHERE id=?").get(inc.id) as { predicted_mttr_p90: number }).predicted_mttr_p90;
    c.db
      .prepare("UPDATE crew_jobs SET done_at = arrived_at + ? WHERE incident_id=? AND crew_type='partner' AND state != 'done'")
      .run(Math.round(Math.max(5, p90) * 60), inc.id);
  }

  c.db.prepare("UPDATE sim_state SET speed=0, running=0 WHERE id=1").run();
  publish();
  const city = inc
    ? ((c.db
        .prepare(
          "SELECT d.city FROM blast_radius b JOIN topology_truth t ON t.element_id=b.line_id JOIN districts d ON d.id=t.district_id WHERE b.incident_id=? GROUP BY d.city ORDER BY COUNT(*) DESC LIMIT 1"
        )
        .get(inc.id) as { city: string } | undefined)?.city ?? null)
    : null;
  logEvent("director", `Leadership demo prepared — hero outage ${inc?.id ?? "?"} in ${city ?? "?"}`, inc ? `/incidents?id=${inc.id}` : null, "DIRECTOR");
  publish();
  return { hero: inc?.id ?? null, heroCity: city, heroElement: hero, simMin: getSimState(c.db)!.sim_min };
}

function pickHeroSplitter(c: EngineCore): string {
  const cityOf = new Map((c.db.prepare("SELECT id, city FROM districts").all() as { id: string; city: string }[]).map((d) => [d.id, d.city]));
  const cityLines = new Map<string, number>();
  for (const l of c.topo.allLines) {
    const city = cityOf.get(c.topo.node(l)?.district ?? "");
    if (city) cityLines.set(city, (cityLines.get(city) ?? 0) + 1);
  }
  const b2b = new Set((c.db.prepare("SELECT line_id FROM subscribers WHERE b2b=1 AND holdout=0").all() as { line_id: string }[]).map((r) => r.line_id));
  const down = new Set((c.db.prepare("SELECT line_id FROM lines WHERE status != 'online'").all() as { line_id: string }[]).map((r) => r.line_id));
  let best = { id: "", score: -1 };
  for (const node of c.topo.nodes.values()) {
    if (node.kind !== "splitter") continue;
    const lines = c.topo.linesUnder(node.id);
    if (lines.length < 40 || lines.some((l) => down.has(l))) continue;
    const byCity = new Map<string, number>();
    for (const l of lines) {
      const city = cityOf.get(c.topo.node(l)?.district ?? "") ?? "";
      byCity.set(city, (byCity.get(city) ?? 0) + 1);
    }
    const [city, inCity] = [...byCity.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = inCity / (cityLines.get(city) ?? 1);
    if (share < 0.06) continue; // big enough that Marketing should hold campaigns there
    const score = lines.filter((l) => b2b.has(l)).length * 10 + lines.length;
    if (score > best.score) best = { id: node.id, score };
  }
  return best.id || [...c.topo.nodes.values()].find((n) => n.kind === "splitter")!.id;
}
