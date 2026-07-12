"use client";

import Link from "next/link";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  CartesianGrid,
} from "recharts";
import { useApp } from "@/components/AppState";
import { NetworkMap } from "./NetworkMap";
import { peso, pesoCompact, pct, fmtHrs, fmtSimTime, HEALTH_HEX } from "@/lib/tokens";

export function OperationsClient() {
  const { snapshot } = useApp();
  if (!snapshot) return <div className="grid h-full place-items-center text-ink-3">Connecting…</div>;
  const k = snapshot.kpis;
  const impacted = k.lines_impacted_observed + k.lines_impacted_inferred;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* KPI band */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Lines monitored" value={k.lines_monitored.toLocaleString()} sub={`${pct(k.pct_actively_sensed)} actively sensed`} accent="doctrine" />
        <Kpi label="Impacted now" value={impacted.toLocaleString()} sub={`${k.lines_impacted_observed} obs · ${k.lines_impacted_inferred} inferred`} accent={impacted > 0 ? "critical" : "healthy"} />
        <Kpi label="Open tickets" value={k.open_tickets.toLocaleString()} sub={`+${k.ticket_inflow_hr}/hr inflow`} />
        <Kpi label="Calls deflected" value={k.calls_deflected_today.toLocaleString()} sub="today · proactive" accent="healthy" />
        <Kpi label="Avg MTTR today" value={k.avg_mttr_today ? fmtHrs(k.avg_mttr_today) : "—"} sub={`vs ${k.mttr_window}h window`} accent={k.avg_mttr_today > k.mttr_window ? "critical" : "healthy"} />
        <Kpi label="Crews active" value={String(k.crews_active)} sub="en route / on site" />
        <Kpi label="Wrong rolls avoided" value={String(k.wrong_rolls_avoided)} sub="dedup + power outage" accent="healthy" />
        <Kpi label="₱ at risk" value={pesoCompact(k.peso_at_risk)} sub="monthly ARPU exposed" accent={k.peso_at_risk > 0 ? "degraded" : "healthy"} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Network map */}
        <div className="card flex min-h-0 flex-col p-3 lg:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="section-title">Network map · {snapshot.sensing_health.dead_olt ? <span className="text-critical">alarm feed down: {snapshot.sensing_health.dead_olt}</span> : "live"}</h3>
            <MapLegend />
          </div>
          <div className="min-h-0 flex-1">
            <NetworkMap snapshot={snapshot} />
          </div>
        </div>

        {/* Right column: charts + ticker */}
        <div className="flex min-h-0 flex-col gap-3">
          <div className="card p-3">
            <h3 className="section-title mb-1">Ticket flow · opened vs resolved</h3>
            <div className="h-28">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={snapshot.ticket_flow} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                  <defs>
                    <linearGradient id="op" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#e8933a" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#e8933a" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="rs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2fbf87" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#2fbf87" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="t" tickFormatter={fmtSimTime} tick={{ fontSize: 8, fill: "#6b7896" }} />
                  <YAxis tick={{ fontSize: 8, fill: "#6b7896" }} width={28} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => fmtSimTime(Number(v))} />
                  <Area type="monotone" dataKey="opened" stroke="#e8933a" fill="url(#op)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="resolved" stroke="#2fbf87" fill="url(#rs)" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card p-3">
            <h3 className="section-title mb-1">MTTR today · vs {k.mttr_window}h window</h3>
            <div className="h-28">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={snapshot.mttr_hist} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#20293e" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 8, fill: "#6b7896" }} />
                  <YAxis tick={{ fontSize: 8, fill: "#6b7896" }} width={28} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff08" }} />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                    {snapshot.mttr_hist.map((b, i) => (
                      <Cell key={i} fill={b.over ? HEALTH_HEX.critical : HEALTH_HEX.healthy} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card flex min-h-0 flex-1 flex-col p-3">
            <h3 className="section-title mb-1">Live event ticker</h3>
            <div className="min-h-0 flex-1 overflow-auto">
              {snapshot.ticker.length === 0 && <div className="text-2xs text-ink-3">Quiet. Run the clock…</div>}
              <ul className="flex flex-col gap-0.5">
                {snapshot.ticker.map((e) => {
                  const body = (
                    <div className="flex items-start gap-2 rounded px-1.5 py-1 text-2xs hover:bg-surface-2">
                      <span className="font-mono text-ink-3">{fmtSimTime(e.sim_ts)}</span>
                      <span className="chip bg-surface-3 text-ink-3">{e.source}</span>
                      <span className="text-ink-2">{e.text}</span>
                    </div>
                  );
                  return (
                    <li key={e.id}>{e.href ? <Link href={e.href}>{body}</Link> : body}</li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const tooltipStyle = {
  background: "#121826",
  border: "1px solid #2b3854",
  borderRadius: 8,
  fontSize: 11,
  color: "#e8edf7",
};

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "doctrine" | "critical" | "degraded" | "healthy" }) {
  const color =
    accent === "critical" ? "text-critical" : accent === "degraded" ? "text-degraded" : accent === "healthy" ? "text-healthy" : accent === "doctrine" ? "text-doctrine" : "text-ink";
  return (
    <div className="card-2 px-3 py-2">
      <div className="kpi-label">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-2xs text-ink-3">{sub}</div>}
    </div>
  );
}

function MapLegend() {
  return (
    <div className="flex items-center gap-2 text-2xs text-ink-3">
      <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: HEALTH_HEX.critical }} /> critical</span>
      <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: HEALTH_HEX.degraded }} /> degraded</span>
      <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: HEALTH_HEX.healthy }} /> healthy</span>
      <span className="inline-flex items-center gap-1"><span style={{ color: HEALTH_HEX.watch }}>▲</span> crew</span>
    </div>
  );
}
