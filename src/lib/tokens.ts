/**
 * DevX Doctrine — shared presentational tokens used by both server and client.
 * Health ramp, provenance stamps, and formatting helpers live here so every
 * screen speaks the same visual language.
 */

export type Health = "healthy" | "watch" | "degraded" | "critical" | "unsensed";

export const HEALTH_HEX: Record<Health, string> = {
  healthy: "#2fbf87",
  watch: "#e5c95a",
  degraded: "#e8933a",
  critical: "#e5573f",
  unsensed: "#48557a",
};

/** Map a 0..1 severity/impact ratio to a health bucket. */
export function healthFromRatio(ratio: number): Health {
  if (ratio <= 0.02) return "healthy";
  if (ratio < 0.15) return "watch";
  if (ratio < 0.5) return "degraded";
  return "critical";
}

export type Provenance =
  | { source: "TICKETING"; quality: "live" }
  | { source: "TELEMETRY"; quality: "live" | "delayed" | "dark" }
  | { source: "REACHABILITY"; quality: "live" }
  | { source: "ALARM"; quality: "live" | "delayed" }
  | { source: "PLANT RECORDS"; quality: "verify"; confidence: number }
  | { source: "MODEL"; quality: "derived" };

/** Render a provenance stamp label, e.g. `PLANT RECORDS · record confidence 0.72 · VERIFY IN DISCOVERY`. */
export function provenanceLabel(p: Provenance): string {
  switch (p.source) {
    case "PLANT RECORDS":
      return `PLANT RECORDS · record confidence ${p.confidence.toFixed(2)} · VERIFY IN DISCOVERY`;
    case "TELEMETRY":
      return `TELEMETRY · ${p.quality}`;
    case "ALARM":
      return `ALARM · ${p.quality}`;
    case "MODEL":
      return `MODEL · derived`;
    default:
      return `${p.source} · ${p.quality}`;
  }
}

const PESO = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

export function peso(n: number): string {
  return PESO.format(Math.round(n));
}

export function pesoCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `₱${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `₱${(n / 1_000).toFixed(0)}k`;
  return `₱${Math.round(n)}`;
}

export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

/** Sim-time is stored as integer minutes since world epoch. Render as a clock + day. */
export function fmtSimTime(simMin: number): string {
  const day = Math.floor(simMin / 1440) + 1;
  const min = ((simMin % 1440) + 1440) % 1440;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `D${day} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function fmtHrs(hrs: number): string {
  if (hrs < 1) return `${Math.round(hrs * 60)}m`;
  return `${hrs.toFixed(1)}h`;
}
