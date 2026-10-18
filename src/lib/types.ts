/** Shared domain + wire types. The snapshot shape is the stable contract
 *  between the engine (server) and every screen (client). */

import type { Health } from "./tokens";

// ---- Topology ----
export type ElementKind = "olt" | "pon" | "splitter" | "nap" | "ont";

export interface TopoElement {
  element_id: string;
  kind: ElementKind;
  parent_id: string | null;
  grid_x: number | null;
  grid_y: number | null;
  record_confidence?: number; // recorded copy only
}

// ---- Incidents ----
export type IncidentState =
  | "suspected"
  | "isolating"
  | "confirmed"
  | "repairing"
  | "verifying"
  | "resolved"
  | "reopened";

export type DetectedVia = "tickets" | "telemetry" | "reachability" | "alarm" | "mixed";

export type FaultKind =
  | "feeder_cut"
  | "distribution_cut"
  | "splitter_failure"
  | "olt_port_failure"
  | "power_outage"
  | "drop_cut"
  | "cpe_issue"
  | "noise";

export const FAULT_LABEL: Record<FaultKind, string> = {
  feeder_cut: "Feeder fiber cut",
  distribution_cut: "Distribution cut",
  splitter_failure: "Splitter failure",
  olt_port_failure: "OLT port failure",
  power_outage: "Area power outage",
  drop_cut: "Drop cut",
  cpe_issue: "CPE / user-side",
  noise: "Background noise",
};

export interface SignalContribution {
  signal: DetectedVia | "dying_gasp";
  weight: number; // 0..1 contribution to detection confidence
  detail: string;
}

export interface Suspicion {
  element_id: string;
  kind: ElementKind;
  confidence: number; // 0..1
  rank: number;
  evidence: string;
  record_conflict: boolean;
}

export interface BlastLine {
  line_id: string;
  evidence: "observed" | "inferred";
  vip: boolean;
  b2b: boolean;
  arpu: number;
  ticketed: boolean;
  notified_at: number | null;
  hours_down: number;
}

export interface IncidentSummary {
  id: string;
  fault_id: string | null;
  state: IncidentState;
  detected_via: DetectedVia;
  telemetry_dark: boolean; // "found via tickets, telemetry dark here"
  fault_kind: FaultKind | null;
  fault_kind_confidence: number;
  detected_at: number;
  confirmed_at: number | null;
  resolved_at: number | null;
  top_suspect: string | null;
  top_confidence: number;
  observed_count: number;
  inferred_count: number;
  vip_count: number;
  peso_exposure: number;
  predicted_mttr_p50: number;
  predicted_mttr_p90: number;
  worst_hours_down: number;
  rank_score: number;
  vendor_id: string | null;
  detection_confidence: number;
}

// ---- Ops snapshot (the SSE/poll payload) ----
export interface KpiBand {
  lines_monitored: number;
  pct_actively_sensed: number;
  lines_impacted_observed: number;
  lines_impacted_inferred: number;
  open_tickets: number;
  ticket_inflow_hr: number;
  calls_deflected_today: number;
  avg_mttr_today: number;
  mttr_window: number;
  crews_active: number;
  wrong_rolls_avoided: number;
  peso_at_risk: number;
}

export interface TickerEntry {
  id: string;
  sim_ts: number;
  kind: string;
  text: string;
  href: string | null;
  source: string;
}

export interface CrewGlyph {
  job_id: string;
  vendor_id: string;
  /** Last-mile partner crew, or a Globe CFS home-visit technician. */
  crew_type: "partner" | "cfs";
  grid_x: number;
  grid_y: number;
  state: "enroute" | "onsite" | "done";
  incident_id: string | null;
  target_element: string;
  /** Current position: interpolated from the exchange to the site while en route. */
  lat: number | null;
  lon: number | null;
  /** Origin (dispatching exchange) and destination, for drawing the route. */
  from_lat: number | null;
  from_lon: number | null;
  to_lat: number | null;
  to_lon: number | null;
  progress: number; // 0..1 of travel
  eta_min: number; // sim-minutes until on site (0 once arrived)
}

export interface SimClock {
  simMin: number;
  speed: 0 | 1 | 4 | 16;
  running: boolean;
  seed: number;
}

// ---- Detections screen payload ----
export interface DetectionDetail {
  id: string;
  fault_id: string | null;
  state: IncidentState;
  detected_via: DetectedVia;
  telemetry_dark: boolean;
  fault_kind: FaultKind | null;
  fault_kind_confidence: number;
  detection_confidence: number;
  detected_at: number;
  confirmed_at: number | null;
  top_suspect: string | null;
  top_confidence: number;
  contributions: { signal: string; weight: number; detail: string }[];
  samples: {
    sim_ts: number;
    detection_confidence: number;
    tickets: number;
    telemetry: number;
    unreachable: number;
    dying_gasp_ratio: number;
  }[];
}

/** Per-city rollup for the map choropleth (keyed by NCR city name). */
export interface CityStat {
  lines: number;
  impacted: number;
  offline: number;
  sensed: number; // lines actively polled
  tickets: number; // open valid tickets
  peso_at_risk: number;
  record_conf: number; // mean plant-record confidence, 0..1
  /** Brand & Marketing / Sales: is it safe to sell here right now? */
  sell: "sell" | "care" | "hold";
  campaign_hold: boolean;
}

export interface OpsSnapshot {
  sim: SimClock;
  kpis: KpiBand;
  incidents: IncidentSummary[];
  ticker: TickerEntry[];
  crews: CrewGlyph[];
  ticket_flow: { t: number; opened: number; deflected: number; resolved: number }[];
  mttr_hist: { bucket: string; count: number; over: boolean }[];
  element_health: Record<string, Health>; // element_id -> health (for the map)
  city_stats: Record<string, CityStat>;
  ticketed_lines: string[]; // lines with an open valid ticket (map "tickets" layer)
  sensing_health: { coverage: number; alarm_delay_min: number; dead_olt: string | null };
  generated_at: number;
}
