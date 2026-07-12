import type { OpsSnapshot } from "./types";

/** M0 placeholder. Replaced by the live engine in M2. */
export function placeholderSnapshot(): OpsSnapshot {
  return {
    sim: { simMin: 0, speed: 0, running: false, seed: 42 },
    kpis: {
      lines_monitored: 0,
      pct_actively_sensed: 0,
      lines_impacted_observed: 0,
      lines_impacted_inferred: 0,
      open_tickets: 0,
      ticket_inflow_hr: 0,
      calls_deflected_today: 0,
      avg_mttr_today: 0,
      mttr_window: 6,
      crews_active: 0,
      wrong_rolls_avoided: 0,
      peso_at_risk: 0,
    },
    incidents: [],
    ticker: [],
    crews: [],
    ticket_flow: [],
    mttr_hist: [],
    element_health: {},
    sensing_health: { coverage: 0.7, alarm_delay_min: 20, dead_olt: null },
    generated_at: 0,
  };
}
