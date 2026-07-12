import type { DB } from "../db";
import type { TopoIndex } from "./topo-index";
import type { SensingSets } from "./world";

/**
 * Detection fusion. Implemented in M3 — fuses telemetry/reachability/alarm
 * deviations with ticket-cluster inference into probabilistic incidents.
 * No-op stub for M2 so the engine tick loop is stable.
 */
export function runDetection(_db: DB, _topo: TopoIndex, _sensing: SensingSets, _simMin: number): void {
  // M3 populates incidents, suspicions, signal_contributions.
}
