"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Eye,
  Gauge,
  PhoneCall,
  PhoneOff,
  ShieldCheck,
  Truck,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { useApp } from "@/components/AppState";
import { NetworkMap } from "@/components/map/NetworkMap";
import { HoverCard, LayerPanel, Legend, type Overlays } from "@/components/map/MapChrome";
import type { MapFocus, MapHover, MapSelection } from "@/components/map/NetworkMapGL";
import { useGeo, linesUnder, locate, type GeoBundle } from "@/lib/geo-client";
import type { LayerMode } from "@/lib/map-layers";
import { BRAND } from "@/lib/brand";
import { HEALTH_HEX, fmtHrs, fmtSimTime, pct, peso, pesoCompact } from "@/lib/tokens";
import { FAULT_LABEL, type IncidentSummary, type OpsSnapshot } from "@/lib/types";

const RAIL_W = 372;

export function OperationsClient() {
  const { snapshot } = useApp();
  const bundle = useGeo(snapshot?.sensing_health.coverage);
  const [layer, setLayer] = useState<LayerMode>("health");
  const [overlays, setOverlays] = useState<Overlays>({ backbone: true, incidents: true, crews: true, heat: true });
  const [selected, setSelected] = useState<MapSelection | null>(null);
  const [hover, setHover] = useState<MapHover | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [fit, setFit] = useState<{ key: string; bounds: [number, number, number, number] } | null>(null);

  // Selecting an incident lights up its blast radius (observed vs silent) and flies to it.
  useEffect(() => {
    if (selected?.kind !== "incident" || !bundle) {
      setFocus(null);
      return;
    }
    let alive = true;
    fetch(`/api/incidents/${selected.id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        const f: MapFocus = { observed: d.blastMap.observed, inferred: d.blastMap.inferred, suspect: d.incident.top_suspect };
        setFocus(f);
        const pts = [...f.observed, ...f.inferred].map((id) => locate(bundle, id)).filter(Boolean) as [number, number][];
        if (pts.length) setFit({ key: `inc-${selected.id}`, bounds: bbox(pts) });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selected, bundle]);

  if (!snapshot) return <div className="grid h-full place-items-center text-ink-3">Connecting to the network…</div>;

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#040918]">
      {/* Map */}
      <div className="absolute inset-y-0 left-0" style={{ right: RAIL_W }}>
        {bundle ? (
          <NetworkMap
            snapshot={snapshot}
            bundle={bundle}
            layer={layer}
            overlays={overlays}
            selected={selected}
            focus={focus}
            fit={fit}
            padding={{ top: 120, right: 40, bottom: 70, left: 270 }}
            onSelect={setSelected}
            onHover={setHover}
          />
        ) : (
          <div className="grid h-full place-items-center text-xs text-ink-3">Loading Metro Manila…</div>
        )}
        {hover && bundle && <HoverCard h={hover} snapshot={snapshot} bundle={bundle} />}

        <div className="pointer-events-none absolute inset-x-4 top-4 z-20">
          <div className="pointer-events-auto">
            <KpiStrip snapshot={snapshot} />
          </div>
        </div>
        <div className="absolute left-4 top-[124px] z-20">
          <LayerPanel layer={layer} setLayer={setLayer} overlays={overlays} setOverlays={setOverlays} />
        </div>
        <div className="absolute bottom-4 left-4 z-20">
          <Legend layer={layer} />
        </div>
        {snapshot.sensing_health.dead_olt && (
          <div className="absolute left-1/2 top-[124px] z-20 -translate-x-1/2 rounded-full border border-critical/50 bg-critical/15 px-3 py-1 text-xs font-semibold text-critical backdrop-blur">
            Alarm feed down at {snapshot.sensing_health.dead_olt} — detection running on tickets &amp; dying-gasp
          </div>
        )}
      </div>

      {/* Right rail */}
      <aside className="absolute inset-y-0 right-0 z-20 flex flex-col border-l border-line bg-surface" style={{ width: RAIL_W }}>
        {selected && bundle ? (
          <SelectionPanel selected={selected} snapshot={snapshot} bundle={bundle} focus={focus} onClose={() => setSelected(null)} onSelect={setSelected} />
        ) : (
          <OpsRail snapshot={snapshot} onSelect={setSelected} />
        )}
      </aside>
    </div>
  );
}

// ---- KPI strip -------------------------------------------------------------------

function KpiStrip({ snapshot }: { snapshot: OpsSnapshot }) {
  const k = snapshot.kpis;
  const impacted = k.lines_impacted_observed + k.lines_impacted_inferred;
  const tiles: { icon: LucideIcon; label: string; value: string; sub: string; tone?: string }[] = [
    { icon: Eye, label: "Lines", value: k.lines_monitored.toLocaleString(), sub: `${pct(k.pct_actively_sensed)} actively sensed` },
    {
      icon: Activity,
      label: "Impacted",
      value: impacted.toLocaleString(),
      sub: `${k.lines_impacted_observed} seen · ${k.lines_impacted_inferred} silent`,
      tone: impacted ? "text-critical" : "text-healthy",
    },
    { icon: PhoneCall, label: "Open tickets", value: k.open_tickets.toLocaleString(), sub: `+${k.ticket_inflow_hr} last hour` },
    { icon: PhoneOff, label: "Deflected", value: k.calls_deflected_today.toLocaleString(), sub: "calls avoided today", tone: "text-healthy" },
    {
      icon: Gauge,
      label: "Avg repair",
      value: k.avg_mttr_today ? fmtHrs(k.avg_mttr_today) : "—",
      sub: `vs ${k.mttr_window}h window`,
      tone: k.avg_mttr_today > k.mttr_window ? "text-critical" : undefined,
    },
    { icon: Truck, label: "Crews", value: String(k.crews_active), sub: "in the field" },
    { icon: ShieldCheck, label: "Rolls avoided", value: String(k.wrong_rolls_avoided), sub: "trucks not sent", tone: "text-healthy" },
    {
      icon: Wallet,
      label: "₱ at risk",
      value: pesoCompact(k.peso_at_risk),
      sub: "monthly ARPU",
      tone: k.peso_at_risk ? "text-degraded" : undefined,
    },
  ];
  return (
    <div className="glass grid grid-cols-4 divide-line overflow-hidden xl:grid-cols-8 xl:divide-x">
      {tiles.map((t) => (
        <div key={t.label} className="min-w-0 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-3">
            <t.icon size={12} /> <span className="truncate">{t.label}</span>
          </div>
          <div className={["mt-0.5 font-display text-[22px] font-bold leading-tight tabular-nums", t.tone ?? "text-ink"].join(" ")}>{t.value}</div>
          <div className="truncate text-[11px] text-ink-3">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ---- Right rail: queue + pulse ----------------------------------------------------

function severityColor(i: IncidentSummary): string {
  if (i.state === "repairing" || i.state === "verifying") return BRAND.watch;
  if (i.fault_kind === "power_outage") return BRAND.record;
  return BRAND.critical;
}

function OpsRail({ snapshot, onSelect }: { snapshot: OpsSnapshot; onSelect: (s: MapSelection) => void }) {
  const open = snapshot.incidents.filter((i) => i.state !== "resolved");
  const window = snapshot.kpis.mttr_window;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[15px] font-bold text-ink">Active incidents</h2>
          <span className="chip bg-critical/15 text-critical">{open.length} open</span>
        </div>
        <p className="mt-0.5 text-[11.5px] text-ink-3">Ranked by revenue at risk × time pressure. Select one to see who&rsquo;s affected.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {open.length === 0 && <div className="px-4 py-6 text-sm text-ink-3">All clear. Run the clock or inject a fault from the Scenario Director.</div>}
        {open.slice(0, 12).map((i) => {
          const total = i.observed_count + i.inferred_count;
          const over = i.predicted_mttr_p50 > window;
          return (
            <button
              key={i.id}
              onClick={() => onSelect({ kind: "incident", id: i.id })}
              className="group flex w-full gap-3 border-b border-line/70 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
            >
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: severityColor(i), boxShadow: `0 0 0 3px ${severityColor(i)}22` }} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[12px] font-semibold text-ink">{i.id}</span>
                  <span className="truncate text-[12.5px] font-semibold text-ink-2">{i.fault_kind ? FAULT_LABEL[i.fault_kind] : "Investigating"}</span>
                  <span className="ml-auto font-semibold tabular-nums text-degraded">{pesoCompact(i.peso_exposure)}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-3">
                  <span>{total} lines</span>
                  <span className="text-ink-3/60">·</span>
                  <span className="text-ink-2">{i.inferred_count} silent</span>
                  {i.telemetry_dark && <span className="chip bg-record/15 px-1.5 text-record">found via tickets</span>}
                  {i.state === "repairing" && <span className="chip bg-watch/15 px-1.5 text-watch">crew working</span>}
                </span>
                <span className="mt-1.5 flex items-center gap-2 text-[10.5px] text-ink-3">
                  <span className="w-[54px] shrink-0">Repair ETA</span>
                  <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <span className={["absolute inset-y-0 left-0 rounded-full", over ? "bg-critical" : "bg-healthy"].join(" ")} style={{ width: `${Math.min(100, (i.predicted_mttr_p50 / (window * 2)) * 100)}%` }} />
                    <span className="absolute inset-y-0 left-1/2 w-px bg-ink-2/60" />
                  </span>
                  <span className={["w-9 text-right tabular-nums", over ? "text-critical" : "text-ink-2"].join(" ")}>{i.predicted_mttr_p50 ? fmtHrs(i.predicted_mttr_p50) : "—"}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-ink-3">
          <span>Ticket flow · 12h</span>
          <span className="flex gap-2 normal-case tracking-normal">
            <span className="text-degraded">● opened</span>
            <span className="text-healthy">● resolved</span>
          </span>
        </div>
        <div className="h-16">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={snapshot.ticket_flow} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="opF" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BRAND.degraded} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={BRAND.degraded} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <Tooltip contentStyle={tip} labelFormatter={(v) => fmtSimTime(Number(v))} />
              <Area type="monotone" dataKey="opened" stroke={BRAND.degraded} fill="url(#opF)" strokeWidth={1.6} />
              <Area type="monotone" dataKey="resolved" stroke={BRAND.healthy} fill="none" strokeWidth={1.6} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mb-1 mt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-3">Repairs today vs {window}h window</div>
        <div className="h-12">
          {snapshot.mttr_hist.every((b) => b.count === 0) ? (
            <div className="grid h-full place-items-center rounded-md border border-dashed border-line text-[11px] text-ink-3">No repairs completed yet today</div>
          ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={snapshot.mttr_hist} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="bucket" tick={{ fontSize: 9, fill: BRAND.ink3 }} axisLine={false} tickLine={false} height={14} />
              <Tooltip contentStyle={tip} cursor={{ fill: "#ffffff08" }} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {snapshot.mttr_hist.map((b, i) => (
                  <Cell key={i} fill={b.over ? BRAND.critical : BRAND.healthy} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="max-h-[188px] overflow-y-auto border-t border-line px-2 py-2">
        <div className="mb-1 px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-3">Live events</div>
        {snapshot.ticker.slice(0, 14).map((e) => {
          const body = (
            <span className="flex items-start gap-2 rounded px-2 py-1 text-[11.5px] hover:bg-surface-2">
              <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{fmtSimTime(e.sim_ts).slice(3)}</span>
              <span className="text-ink-2">{e.text}</span>
            </span>
          );
          return e.href ? (
            <Link key={e.id} href={e.href} className="block">
              {body}
            </Link>
          ) : (
            <div key={e.id}>{body}</div>
          );
        })}
      </div>
    </div>
  );
}

const tip = { background: "#0A1430", border: "1px solid #2A3D70", borderRadius: 8, fontSize: 11, color: "#EEF3FF" };

// ---- Selection detail ----------------------------------------------------------

function SelectionPanel({
  selected,
  snapshot,
  bundle,
  focus,
  onClose,
  onSelect,
}: {
  selected: MapSelection;
  snapshot: OpsSnapshot;
  bundle: GeoBundle;
  focus: MapFocus | null;
  onClose: () => void;
  onSelect: (s: MapSelection) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col animate-rise">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-globe-sky">
          {{ incident: "Incident", element: "Network element", line: "Customer line", city: "Area" }[selected.kind]}
        </span>
        <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close details">
          <X size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {selected.kind === "incident" && <IncidentDetail id={selected.id} snapshot={snapshot} focus={focus} />}
        {selected.kind === "city" && <CityDetail name={selected.id} snapshot={snapshot} onSelect={onSelect} bundle={bundle} />}
        {(selected.kind === "element" || selected.kind === "line") && <ElementDetail id={selected.id} snapshot={snapshot} bundle={bundle} onSelect={onSelect} />}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-3">{label}</div>
      <div className={["font-display text-lg font-bold tabular-nums", tone ?? "text-ink"].join(" ")}>{value}</div>
      {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

function IncidentDetail({ id, snapshot, focus }: { id: string; snapshot: OpsSnapshot; focus: MapFocus | null }) {
  const inc = snapshot.incidents.find((i) => i.id === id);
  if (!inc) return <div className="text-sm text-ink-3">{id} is resolved.</div>;
  const total = inc.observed_count + inc.inferred_count;
  const window = snapshot.kpis.mttr_window;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-base font-bold text-ink">{inc.id}</span>
          <span className="chip" style={{ background: `${severityColor(inc)}22`, color: severityColor(inc) }}>
            {inc.state}
          </span>
        </div>
        <div className="mt-0.5 font-display text-lg font-bold text-ink">{inc.fault_kind ? FAULT_LABEL[inc.fault_kind] : "Investigating"}</div>
        <div className="text-[12px] text-ink-3">
          Most likely at <span className="font-mono text-ink-2">{inc.top_suspect}</span> · {pct(inc.top_confidence)} confidence
          {inc.telemetry_dark && <> · found from customer tickets — no telemetry here</>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Customers affected" value={String(total)} sub={`${inc.observed_count} called or seen`} tone="text-critical" />
        <Stat label="Silent sufferers" value={String(inc.inferred_count)} sub="haven't called — yet" tone="text-watch" />
        <Stat label="Revenue at risk" value={pesoCompact(inc.peso_exposure)} sub={`${inc.vip_count} VIP lines`} />
        <Stat
          label="Repair ETA"
          value={inc.predicted_mttr_p50 ? fmtHrs(inc.predicted_mttr_p50) : "—"}
          sub={inc.predicted_mttr_p50 > window ? `over the ${window}h window` : `within the ${window}h window`}
          tone={inc.predicted_mttr_p50 > window ? "text-critical" : "text-healthy"}
        />
      </div>

      <div className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[12px]">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-3">On the map</div>
        <div className="flex flex-col gap-1 text-ink-2">
          <span className="flex items-center gap-2">
            <i className="h-2.5 w-2.5 rounded-full" style={{ background: BRAND.critical }} /> {focus?.observed.length ?? inc.observed_count} customers who called or show in telemetry
          </span>
          <span className="flex items-center gap-2">
            <i className="h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: BRAND.watch }} /> {focus?.inferred.length ?? inc.inferred_count} silent customers we inferred
          </span>
          <span className="flex items-center gap-2">
            <i className="h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: BRAND.globeSky }} /> Suspect element
          </span>
        </div>
      </div>

      {inc.fault_kind === "power_outage" && (
        <div className="rounded-md border border-record/40 bg-record/10 px-3 py-2 text-[12px] text-ink-2">
          <span className="font-semibold text-record">Power outage — no fiber crew.</span> Notify customers and monitor the utility restore instead of rolling a truck.
        </div>
      )}

      <Link href={`/incidents?id=${inc.id}`} className="btn-primary w-full">
        Open in Incident Room <ArrowRight size={14} />
      </Link>
    </div>
  );
}

function CityDetail({ name, snapshot, bundle, onSelect }: { name: string; snapshot: OpsSnapshot; bundle: GeoBundle; onSelect: (s: MapSelection) => void }) {
  const s = snapshot.city_stats[name];
  const incs = useMemo(
    () => snapshot.incidents.filter((i) => i.state !== "resolved" && i.top_suspect && (bundle.elementById.get(i.top_suspect)?.city ?? bundle.lineById.get(i.top_suspect)?.city) === name),
    [snapshot.incidents, bundle, name]
  );
  if (!s) return <div className="text-sm text-ink-3">No Globe broadband service in {name} in this simulation.</div>;
  return (
    <div className="flex flex-col gap-3">
      <div className="font-display text-xl font-bold text-ink">{name}</div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Lines" value={s.lines.toLocaleString()} />
        <Stat label="Impacted now" value={String(s.impacted)} tone={s.impacted ? "text-critical" : "text-healthy"} />
        <Stat label="Actively sensed" value={pct(s.sensed / s.lines)} tone={s.sensed / s.lines < 0.5 ? "text-watch" : undefined} />
        <Stat label="Open tickets" value={String(s.tickets)} />
        <Stat label="Revenue at risk" value={pesoCompact(s.peso_at_risk)} />
        <Stat label="Record confidence" value={pct(s.record_conf)} tone={s.record_conf < 0.88 ? "text-record" : undefined} />
      </div>
      <div>
        <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-3">Incidents in {name}</div>
        {incs.length === 0 && <div className="text-[12px] text-ink-3">None open.</div>}
        {incs.map((i) => (
          <button key={i.id} onClick={() => onSelect({ kind: "incident", id: i.id })} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-2">
            <span className="h-2 w-2 rounded-full" style={{ background: severityColor(i) }} />
            <span className="font-mono text-ink">{i.id}</span>
            <span className="truncate text-ink-2">{i.fault_kind ? FAULT_LABEL[i.fault_kind] : ""}</span>
            <span className="ml-auto text-degraded">{pesoCompact(i.peso_exposure)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ElementDetail({ id, snapshot, bundle, onSelect }: { id: string; snapshot: OpsSnapshot; bundle: GeoBundle; onSelect: (s: MapSelection) => void }) {
  const line = bundle.lineById.get(id);
  const el = bundle.elementById.get(id);
  const under = linesUnder(bundle, id);
  const impacted = under.filter((l) => snapshot.element_health[l]).length;
  const health = snapshot.element_health[id];
  const linked = snapshot.incidents.find((i) => i.state !== "resolved" && (i.top_suspect === id || (line && i.top_suspect === line.nap)));
  const title = line ? "Customer line" : el ? { olt: "OLT exchange", pon: "PON port", splitter: el.tier === 1 ? "Primary splitter" : "Secondary splitter", nap: "NAP box" }[el.kind] : "";
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="font-mono text-lg font-bold text-ink">{id}</div>
        <div className="text-[12px] text-ink-3">
          {title} · {(line ?? el)?.city}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Status"
          value={health === "critical" ? (line ? "Offline" : "Critical") : health === "degraded" ? "Degraded" : health === "watch" ? "Watch" : "Healthy"}
          tone={health ? undefined : "text-healthy"}
        />
        {line ? (
          <>
            <Stat label="Telemetry" value={line.polled ? "Polled" : "Dark"} tone={line.polled ? "text-globe-sky" : "text-ink-3"} />
            <Stat label="ARPU" value={peso(line.arpu)} sub={[line.vip && "VIP", line.b2b && "B2B"].filter(Boolean).join(" · ") || undefined} />
            <Stat label="Record confidence" value={pct(line.conf)} tone={line.conf < 0.7 ? "text-record" : undefined} />
          </>
        ) : (
          <>
            <Stat label="Lines served" value={under.length.toLocaleString()} />
            <Stat label="Impacted" value={String(impacted)} tone={impacted ? "text-critical" : "text-healthy"} />
            <Stat label="Record confidence" value={el ? pct(el.conf) : "—"} tone={el && el.conf < 0.8 ? "text-record" : undefined} />
          </>
        )}
      </div>
      {health && <div className="h-1 rounded-full" style={{ background: HEALTH_HEX[health] }} />}
      {linked && (
        <button onClick={() => onSelect({ kind: "incident", id: linked.id })} className="btn-ghost w-full">
          View {linked.id} · {linked.fault_kind ? FAULT_LABEL[linked.fault_kind] : "incident"} <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}

function bbox(pts: [number, number][]): [number, number, number, number] {
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const [x, y] of pts) {
    w = Math.min(w, x);
    s = Math.min(s, y);
    e = Math.max(e, x);
    n = Math.max(n, y);
  }
  const pad = 0.004;
  return [w - pad, s - pad, e + pad, n + pad];
}
