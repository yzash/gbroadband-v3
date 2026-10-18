"use client";

import { useApp } from "@/components/AppState";
import { pct, fmtHrs } from "@/lib/tokens";

const REGISTRY = [
  { name: "Acquisition", blurb: "Target & convert prospects", sense: "market & coverage signals", decide: "propensity & offer fit", act: "campaign / channel", learn: "conversion lift" },
  { name: "ARPU offers", blurb: "Upsell & retention offers", sense: "usage & plan signals", decide: "next-best-offer", act: "offer proposal", learn: "take-rate & ARPU lift" },
  { name: "Capex prioritization", blurb: "Where to build next", sense: "demand & fault density", decide: "ROI ranking", act: "build proposal", learn: "utilization vs forecast" },
  { name: "Workforce / SLA management", blurb: "Crew & SLA optimization", sense: "job queue & skills", decide: "assignment & SLA risk", act: "roster / dispatch", learn: "SLA attainment" },
  { name: "Capacity management", blurb: "Congestion & headroom", sense: "traffic & port load", decide: "hotspot ranking", act: "augment proposal", learn: "QoE vs congestion" },
  { name: "Predictive maintenance", blurb: "Fail before it breaks", sense: "degradation trends", decide: "failure risk", act: "pre-emptive work order", learn: "avoided outages" },
];

export function ConfigurationsClient() {
  const { snapshot } = useApp();
  const s = snapshot?.sensing_health;
  const window = snapshot?.kpis.mttr_window ?? 6;

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Active configuration */}
      <div className="card border-healthy/30 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="chip bg-healthy/15 text-healthy">● ACTIVE</span>
              <h2 className="text-lg font-semibold text-ink">Retention &amp; Care</h2>
            </div>
            <p className="mt-0.5 text-xs text-ink-3">Fault inference &amp; localization under imperfect data — the configuration on display.</p>
          </div>
          <div className="text-2xs uppercase tracking-wider text-ink-3">config as metadata</div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Meta label="Repair-window threshold" value={fmtHrs(window)} note="configurable · not a claim" />
          <Meta label="Sensing coverage" value={s ? pct(s.coverage) : "—"} note="% ONTs actively polled" />
          <Meta label="Alarm feed delay" value={s ? `${s.alarm_delay_min}m` : "—"} note="OLT alarm latency" />
          <Meta label="Retention holdout" value="10%" note="for lift measurement" />
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2 text-2xs">
          {[
            ["Sense", "fuse tickets + telemetry + reachability + alarms into probabilistic detections"],
            ["Decide", "isolate · classify · scope · predict MTTR · prioritize by ₱"],
            ["Act", "remote → test → dispatch → notify → credit → account heads-up → home visit → campaign hold → offer · each owned by its team"],
            ["Learn", "verify · partner close-outs · record corrections · lift vs holdout · call deflection · retrain"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md bg-surface-2 p-2">
              <div className="font-semibold text-doctrine">{k}</div>
              <div className="text-ink-3">{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Registry */}
      <h3 className="section-title mb-2 mt-6">Configuration registry · the same SDAL framework, configured for the next outcome</h3>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {REGISTRY.map((r) => (
          <div key={r.name} className="card-2 p-4 opacity-60">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-ink-2">{r.name}</h4>
              <span className="chip bg-surface-3 text-ink-3">not built</span>
            </div>
            <p className="text-2xs text-ink-3">{r.blurb}</p>
            <div className="mt-2 grid grid-cols-4 gap-1 text-[10px] text-ink-3">
              <span><b className="text-ink-3">S</b> {r.sense}</span>
              <span><b className="text-ink-3">D</b> {r.decide}</span>
              <span><b className="text-ink-3">A</b> {r.act}</span>
              <span><b className="text-ink-3">L</b> {r.learn}</span>
            </div>
            <div className="mt-2 text-[10px] uppercase tracking-wider text-ink-3">same framework · configuration only</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Meta({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2">
      <div className="kpi-label">{label}</div>
      <div className="text-base font-semibold tabular-nums text-ink">{value}</div>
      <div className="text-[10px] text-ink-3">{note}</div>
    </div>
  );
}
