import type { DB } from "../db";
import type { RNG } from "../rng";
import type { FaultKind } from "../types";
import type { TopoIndex } from "./topo-index";

export interface FaultRow {
  id: string;
  kind: FaultKind;
  element_id: string | null;
  power_grid: string | null;
  started_at: number;
  cleared_at: number | null;
  auto_clear_at: number | null;
  severity: number;
  injected: number;
  resolved: number;
  detected: number;
}

export interface FaultImpact {
  lines: string[];
  status: "offline" | "degraded";
  powerLoss: boolean;
}

/** Which lines a fault takes down, and how. Uses the TRUTH topology. */
export function faultImpact(f: FaultRow, topo: TopoIndex): FaultImpact {
  switch (f.kind) {
    case "power_outage":
      return { lines: f.power_grid ? topo.linesByPowerGrid.get(f.power_grid) ?? [] : [], status: "offline", powerLoss: true };
    case "drop_cut":
      return { lines: f.element_id ? [f.element_id] : [], status: "offline", powerLoss: false };
    case "cpe_issue":
      return { lines: f.element_id ? [f.element_id] : [], status: "degraded", powerLoss: false };
    case "noise":
      return { lines: f.element_id ? topo.linesUnder(f.element_id) : [], status: "degraded", powerLoss: false };
    // feeder_cut / distribution_cut / splitter_failure / olt_port_failure — everything under the element is down.
    default:
      return { lines: f.element_id ? topo.linesUnder(f.element_id) : [], status: "offline", powerLoss: false };
  }
}

export function activeFaults(db: DB): FaultRow[] {
  return db.prepare("SELECT * FROM faults WHERE resolved = 0").all() as FaultRow[];
}

/** Natural resolution time (sim-min) for a self-healing background fault. */
function bgClearMinutes(kind: FaultKind, rng: RNG): number {
  switch (kind) {
    case "cpe_issue":
      return rng.int(20, 90);
    case "noise":
      return rng.int(15, 60);
    case "drop_cut":
      return rng.int(60, 240);
    default:
      return rng.int(120, 300);
  }
}

let faultSeq = 0;
export function resetFaultSeq(db: DB) {
  const row = db.prepare("SELECT COUNT(*) n FROM faults").get() as { n: number };
  faultSeq = row.n;
}

function newFaultId(): string {
  faultSeq++;
  return `FLT-${String(faultSeq).padStart(4, "0")}`;
}

/**
 * Spawn background faults probabilistically over `minutes` of sim-time.
 * These are the routine, self-healing faults that keep the world breathing.
 */
export function spawnBackgroundFaults(
  db: DB,
  rng: RNG,
  topo: TopoIndex,
  simMin: number,
  minutes: number
): FaultRow[] {
  const spawned: FaultRow[] = [];
  // ~ one background fault per ~40 sim-minutes on average.
  const expected = minutes / 40;
  let n = Math.floor(expected);
  if (rng.next() < expected - n) n++;

  const onts = topo.allLines;
  const naps = [...topo.nodes.values()].filter((x) => x.kind === "nap");
  const secSplitters = [...topo.nodes.values()].filter((x) => x.kind === "splitter");

  for (let i = 0; i < n; i++) {
    const kind = rng.weighted<FaultKind>([
      ["cpe_issue", 5],
      ["drop_cut", 4],
      ["noise", 3],
      ["distribution_cut", 1],
    ]);
    let element: string | null = null;
    if (kind === "cpe_issue" || kind === "drop_cut") element = rng.pick(onts);
    else if (kind === "noise") element = rng.pick(naps).id;
    else element = rng.pick(secSplitters).id;

    const id = newFaultId();
    const startedAt = simMin;
    const autoClear = startedAt + bgClearMinutes(kind, rng);
    db.prepare(
      `INSERT INTO faults (id, kind, element_id, power_grid, started_at, auto_clear_at, severity, injected, resolved, detected)
       VALUES (?,?,?,NULL,?,?,?,0,0,0)`
    ).run(id, kind, element, startedAt, autoClear, kind === "cpe_issue" || kind === "noise" ? 0.5 : 1.0);
    spawned.push({
      id,
      kind,
      element_id: element,
      power_grid: null,
      started_at: startedAt,
      cleared_at: null,
      auto_clear_at: autoClear,
      severity: 1,
      injected: 0,
      resolved: 0,
      detected: 0,
    });
  }
  return spawned;
}

/** Inject a fault (director / tests). Persists until repaired unless autoClearMin given. */
export function injectFault(
  db: DB,
  opts: {
    kind: FaultKind;
    element_id?: string | null;
    power_grid?: string | null;
    simMin: number;
    severity?: number;
    autoClearMin?: number | null;
  }
): FaultRow {
  const id = newFaultId();
  const autoClear = opts.autoClearMin ? opts.simMin + opts.autoClearMin : null;
  db.prepare(
    `INSERT INTO faults (id, kind, element_id, power_grid, started_at, auto_clear_at, severity, injected, resolved, detected)
     VALUES (?,?,?,?,?,?,?,1,0,0)`
  ).run(id, opts.kind, opts.element_id ?? null, opts.power_grid ?? null, opts.simMin, autoClear, opts.severity ?? 1.0);
  return {
    id,
    kind: opts.kind,
    element_id: opts.element_id ?? null,
    power_grid: opts.power_grid ?? null,
    started_at: opts.simMin,
    cleared_at: null,
    auto_clear_at: autoClear,
    severity: opts.severity ?? 1,
    injected: 1,
    resolved: 0,
    detected: 0,
  };
}

/** Resolve faults whose auto_clear_at has passed. Returns cleared faults. */
export function clearExpiredFaults(db: DB, simMin: number): FaultRow[] {
  const due = db
    .prepare("SELECT * FROM faults WHERE resolved = 0 AND auto_clear_at IS NOT NULL AND auto_clear_at <= ?")
    .all(simMin) as FaultRow[];
  if (due.length) {
    db.prepare("UPDATE faults SET resolved = 1, cleared_at = ? WHERE resolved = 0 AND auto_clear_at IS NOT NULL AND auto_clear_at <= ?").run(simMin, simMin);
  }
  return due;
}
