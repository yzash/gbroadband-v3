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
import { ticketingPass, closeTicketsForRecovered, resetTicketSeq } from "./tickets";
import { buildSnapshot } from "./snapshot";
import type { FaultKind, OpsSnapshot } from "../types";
import { runDetection, resetIncidentSeq } from "./detection";
import { RecordedIndex } from "./recorded-index";

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
  }
  return g.__sdal_engine;
}

export function bootEngine(): void {
  const c = core();
  if (c.booted) return;
  c.booted = true;
  resetFaultSeq(c.db);
  resetTicketSeq(c.db);
  resetIncidentSeq(c.db);
  c.prevImpacted = recomputeImpact(c.db, c.topo);
  publish();
  const sim = getSimState(c.db)!;
  if (sim.running && sim.speed > 0) startTimer();
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
  ticketingPass(db, c.rng, simMin, minutes, next);
  updateChurnHazard(db, simMin);

  // Detection fusion (M3): promote fault signatures into incidents.
  runDetection(db, c.topo, c.rec, sensing, simMin);

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
  return inject({ kind, element_id: element, power_grid: powerGrid, autoClearMin: opts?.autoClearMin ?? null });
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
