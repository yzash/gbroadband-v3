import { BRAND, SEQ } from "./brand";
import { healthFromRatio } from "./tokens";
import type { CityStat, OpsSnapshot } from "./types";
import type { GeoPayload } from "./geo-client";

export type LayerMode = "health" | "sensing" | "tickets" | "revenue" | "records";

export interface LayerDef {
  id: LayerMode;
  label: string;
  /** What this lens answers, in the operator's words. */
  question: string;
  legend: { color: string; label: string; hollow?: boolean }[];
}

export const LAYERS: LayerDef[] = [
  {
    id: "health",
    label: "Service health",
    question: "Where are customers down right now?",
    legend: [
      { color: BRAND.critical, label: "Offline" },
      { color: BRAND.degraded, label: "Degraded" },
      { color: BRAND.healthy, label: "Healthy" },
    ],
  },
  {
    id: "sensing",
    label: "Sensing coverage",
    question: "Where can we actually see the network?",
    legend: [
      { color: BRAND.globeSky, label: "Actively polled" },
      { color: BRAND.unsensed, label: "Dark — no telemetry" },
    ],
  },
  {
    id: "tickets",
    label: "Customer tickets",
    question: "Where are customers calling from?",
    legend: [
      { color: BRAND.watch, label: "Open ticket" },
      { color: SEQ[3], label: "Ticket density (area)" },
    ],
  },
  {
    id: "revenue",
    label: "Revenue at risk",
    question: "Where is the money at risk?",
    legend: [
      { color: SEQ[5], label: "High ARPU impacted" },
      { color: SEQ[2], label: "Lower ARPU impacted" },
    ],
  },
  {
    id: "records",
    label: "Record confidence",
    question: "Where can't we trust plant records?",
    legend: [
      { color: BRAND.record, label: "Low confidence" },
      { color: "#4A3A8C", label: "Medium" },
      { color: BRAND.ink3, label: "Trusted" },
    ],
  },
];

// ---- City (choropleth) colouring ----------------------------------------------

const ramp = (stops: [number, string][], v: number) => {
  let c = stops[0][1];
  for (const [t, col] of stops) if (v >= t) c = col;
  return c;
};

/** Dark, navy-harmonised fills: the network on top must stay the brightest thing. */
export function cityFill(layer: LayerMode, s: CityStat | undefined): string {
  if (!s || s.lines === 0) return "#0B1532";
  switch (layer) {
    case "health": {
      const h = healthFromRatio(s.impacted / s.lines);
      return { healthy: "#0D2633", watch: "#33301A", degraded: "#45281C", critical: "#55172A", unsensed: "#0B1532" }[h];
    }
    case "sensing":
      return ramp(
        [
          [0, "#1B1433"],
          [0.35, "#1E2559"],
          [0.55, "#163F86"],
          [0.7, "#1A5CB5"],
          [0.85, "#2286D6"],
        ],
        s.sensed / s.lines
      );
    case "tickets":
      return ramp(
        [
          [0, "#0B1532"],
          [1, "#10264F"],
          [3, "#133A78"],
          [6, "#1857B8"],
          [10, "#2F6BFF"],
        ],
        (s.tickets / s.lines) * 100
      );
    case "revenue":
      return ramp(
        [
          [0, "#0B1532"],
          [1, "#10264F"],
          [15000, "#133A78"],
          [50000, "#1857B8"],
          [120000, "#2F6BFF"],
        ],
        s.peso_at_risk
      );
    case "records":
      return ramp(
        [
          [0, "#5B3FA8"],
          [0.8, "#3C2E7A"],
          [0.86, "#2A2558"],
          [0.92, "#141C40"],
        ],
        s.record_conf
      );
  }
}

// ---- Line (ONT) styling --------------------------------------------------------

export interface PointStyle {
  c: string; // colour
  a: 0 | 1; // attention: notable in this lens
  crit: 0 | 1; // critical (drives cluster ring)
  r: number; // radius multiplier
}

export interface LensContext {
  health: OpsSnapshot["element_health"];
  ticketed: Set<string>;
}

export function lineStyle(layer: LayerMode, l: GeoPayload["lines"][number], ctx: LensContext): PointStyle {
  const h = ctx.health[l.id];
  switch (layer) {
    case "health":
      if (h === "critical") return { c: BRAND.critical, a: 1, crit: 1, r: 1.25 };
      if (h === "degraded") return { c: BRAND.degraded, a: 1, crit: 0, r: 1.1 };
      return { c: "#1F8F6F", a: 0, crit: 0, r: 0.8 };
    case "sensing":
      return l.polled ? { c: BRAND.globeSky, a: 0, crit: 0, r: 0.9 } : { c: BRAND.unsensed, a: 1, crit: 0, r: 0.9 };
    case "tickets":
      return ctx.ticketed.has(l.id) ? { c: BRAND.watch, a: 1, crit: 1, r: 1.25 } : { c: "#22325E", a: 0, crit: 0, r: 0.75 };
    case "revenue":
      if (h === "critical" || h === "degraded") {
        const hi = l.arpu >= 2000;
        return { c: hi ? SEQ[5] : SEQ[3], a: 1, crit: hi ? 1 : 0, r: hi ? 1.45 : 1.05 };
      }
      return { c: "#22325E", a: 0, crit: 0, r: 0.75 };
    case "records":
      if (l.conf < 0.7) return { c: BRAND.record, a: 1, crit: 1, r: 1.2 };
      if (l.conf < 0.88) return { c: "#6F55C2", a: 1, crit: 0, r: 1 };
      return { c: "#3A4870", a: 0, crit: 0, r: 0.8 };
  }
}

/** Accent used for cluster rings / emphasis in each lens. */
export function lensAccent(layer: LayerMode): string {
  return { health: BRAND.critical, sensing: BRAND.unsensed, tickets: BRAND.watch, revenue: SEQ[5], records: BRAND.record }[layer];
}
