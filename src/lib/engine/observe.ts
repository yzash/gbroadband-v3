import type { DB } from "../db";
import type { TopoIndex } from "./topo-index";
import { faultImpact, type FaultRow } from "./faults";
import type { SensingSets } from "./world";

export interface Observed {
  lineId: string;
  viaTicket: boolean;
  viaTelemetry: boolean;
  unreachable: boolean;
  dyingGasp: boolean;
  degraded: boolean;
}

export interface ObserveContext {
  ticketLines: Set<string>;
  telByLine: Map<string, { rx_power: number | null; reachable: number; los: number; dying_gasp: number }>;
  deadOlt: string | null;
  oltOf: (lineId: string) => string | null;
  polled: Set<string>;
}

/** Build the shared observation caches once per tick (tickets + telemetry). */
export function buildObserveContext(db: DB, topo: TopoIndex, sensing: SensingSets): ObserveContext {
  const ticketLines = new Set(
    (db.prepare("SELECT DISTINCT line_id FROM tickets WHERE closed_at IS NULL AND kind='valid'").all() as {
      line_id: string;
    }[]).map((r) => r.line_id)
  );
  const telRows = db
    .prepare("SELECT line_id, rx_power, reachable, los, dying_gasp FROM telemetry_latest")
    .all() as { line_id: string; rx_power: number | null; reachable: number; los: number; dying_gasp: number }[];
  const telByLine = new Map(telRows.map((t) => [t.line_id, t]));

  const oltCache = new Map<string, string | null>();
  const oltOf = (lineId: string): string | null => {
    if (oltCache.has(lineId)) return oltCache.get(lineId)!;
    const olt = [lineId, ...topo.ancestors(lineId)].find((id) => topo.node(id)?.kind === "olt") ?? null;
    oltCache.set(lineId, olt);
    return olt;
  };

  return { ticketLines, telByLine, deadOlt: sensing.deadOlt, oltOf, polled: sensing.polled };
}

/** What the platform can actually observe among a fault's truly-impacted lines. */
export function gatherObserved(f: FaultRow, topo: TopoIndex, ctx: ObserveContext): Observed[] {
  const impact = faultImpact(f, topo);
  const observed: Observed[] = [];
  for (const lineId of impact.lines) {
    const hasTicket = ctx.ticketLines.has(lineId);
    const tel = ctx.telByLine.get(lineId);
    const polled = ctx.polled.has(lineId);
    const telSymptom =
      polled && !!tel && (tel.reachable === 0 || tel.los === 1 || (tel.rx_power !== null && tel.rx_power < -26));
    const dyingGasp = !!tel && tel.dying_gasp === 1 && ctx.oltOf(lineId) !== ctx.deadOlt;
    if (!hasTicket && !telSymptom && !dyingGasp) continue;
    observed.push({
      lineId,
      viaTicket: hasTicket,
      viaTelemetry: telSymptom,
      unreachable: polled && !!tel && tel.reachable === 0,
      dyingGasp,
      degraded: impact.status === "degraded",
    });
  }
  return observed;
}
