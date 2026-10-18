"use client";

import { Activity, Eye, FileWarning, Layers, PhoneCall, Store, Wallet } from "lucide-react";
import { LAYERS, type LayerMode } from "@/lib/map-layers";
import { linesUnder, type GeoBundle } from "@/lib/geo-client";
import { HEALTH_HEX, pct, peso, pesoCompact } from "@/lib/tokens";
import type { OpsSnapshot } from "@/lib/types";
import type { MapHover } from "./NetworkMapGL";

const ICON: Record<LayerMode, typeof Activity> = {
  health: Activity,
  sensing: Eye,
  tickets: PhoneCall,
  revenue: Wallet,
  records: FileWarning,
  market: Store,
};

export interface Overlays {
  backbone: boolean;
  incidents: boolean;
  crews: boolean;
  heat: boolean;
}

export function LayerPanel({
  layer,
  setLayer,
  overlays,
  setOverlays,
}: {
  layer: LayerMode;
  setLayer: (l: LayerMode) => void;
  overlays: Overlays;
  setOverlays: (o: Overlays) => void;
}) {
  const def = LAYERS.find((l) => l.id === layer)!;
  return (
    <div className="glass w-[232px] p-2.5">
      <div className="mb-2 flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
        <Layers size={12} /> Map lens
      </div>
      <div className="flex flex-col gap-0.5" role="radiogroup" aria-label="Map lens">
        {LAYERS.map((l) => {
          const Icon = ICON[l.id];
          const on = l.id === layer;
          return (
            <button
              key={l.id}
              role="radio"
              aria-checked={on}
              onClick={() => setLayer(l.id)}
              className={[
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                on ? "bg-globe/50 text-ink shadow-[inset_0_0_0_1px_rgba(60,183,255,0.35)]" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              ].join(" ")}
            >
              <Icon size={15} className={on ? "text-globe-sky" : "text-ink-3"} />
              <span className="font-semibold">{l.label}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 border-t border-line px-1 pt-2 text-[11.5px] italic text-ink-3">{def.question}</p>
      <div className="mt-2 grid grid-cols-2 gap-1 border-t border-line pt-2">
        {(
          [
            ["incidents", "Incidents"],
            ["crews", "Crews"],
            ["backbone", "Fiber backbone"],
            ["heat", "Heat"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11.5px] text-ink-2 hover:text-ink">
            <input
              type="checkbox"
              checked={overlays[k]}
              onChange={(e) => setOverlays({ ...overlays, [k]: e.target.checked })}
              className="h-3 w-3 accent-[#3CB7FF]"
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

export function Legend({ layer }: { layer: LayerMode }) {
  const def = LAYERS.find((l) => l.id === layer)!;
  return (
    <div className="glass flex flex-wrap items-center gap-x-3.5 gap-y-1 px-3 py-2 text-[11px] text-ink-2">
      {def.legend.map((g) => (
        <span key={g.label} className="flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
          {g.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <i className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: "#FF4D5E", background: "#FF4D5E1f" }} />
        Incident · sized by blast radius
      </span>
      <span className="flex items-center gap-1.5">
        <i className="inline-block h-2.5 w-3.5 rounded-full" style={{ background: "#FFC542" }} /> Partner crew
      </span>
      <span className="flex items-center gap-1.5">
        <i className="inline-block h-2.5 w-3.5 rounded-full" style={{ background: "#3CB7FF" }} /> CFS visit
      </span>
    </div>
  );
}

export function HoverCard({ h, snapshot, bundle }: { h: MapHover; snapshot: OpsSnapshot; bundle: GeoBundle }) {
  const style: React.CSSProperties = { left: h.x + 14, top: h.y + 14 };
  return (
    <div className="glass pointer-events-none absolute z-30 w-[248px] animate-rise p-3 text-xs" style={style}>
      <HoverBody h={h} snapshot={snapshot} bundle={bundle} />
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-ink-3">{k}</span>
      <span className={["font-semibold tabular-nums", tone ?? "text-ink"].join(" ")}>{v}</span>
    </div>
  );
}

function HoverBody({ h, snapshot, bundle }: { h: MapHover; snapshot: OpsSnapshot; bundle: GeoBundle }) {
  if (h.kind === "city") {
    const s = snapshot.city_stats[h.id];
    return (
      <>
        <div className="mb-1.5 font-display text-sm font-bold text-ink">{h.id}</div>
        {s ? (
          <>
            <Row k="Lines" v={s.lines.toLocaleString()} />
            <Row k="Impacted now" v={s.impacted.toLocaleString()} tone={s.impacted ? "text-critical" : "text-healthy"} />
            <Row k="Actively sensed" v={pct(s.sensed / s.lines)} tone={s.sensed / s.lines < 0.5 ? "text-watch" : undefined} />
            <Row k="Open tickets" v={s.tickets} />
            <Row k="₱ at risk / mo" v={pesoCompact(s.peso_at_risk)} />
            <Row k="Record confidence" v={pct(s.record_conf)} tone={s.record_conf < 0.88 ? "text-record" : undefined} />
            <div className="mt-1.5 text-[10.5px] text-ink-3">Click to zoom in</div>
          </>
        ) : (
          <div className="text-ink-3">No Globe broadband service in this simulation.</div>
        )}
      </>
    );
  }
  if (h.kind === "cluster") {
    return (
      <>
        <div className="font-display text-sm font-bold text-ink">{h.count} lines</div>
        <div className="mt-0.5 text-ink-3">Click to zoom in</div>
      </>
    );
  }
  if (h.kind === "line") {
    const l = bundle.lineById.get(h.id);
    if (!l) return null;
    const health = snapshot.element_health[l.id];
    const ticket = snapshot.ticketed_lines.includes(l.id);
    return (
      <>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-[12.5px] font-semibold text-ink">{l.id}</span>
          <span className="chip" style={{ background: `${HEALTH_HEX[health ?? "healthy"]}22`, color: HEALTH_HEX[health ?? "healthy"] }}>
            {health === "critical" ? "offline" : health === "degraded" ? "degraded" : "online"}
          </span>
        </div>
        <Row k="Area" v={l.city ?? "—"} />
        <Row k="Telemetry" v={l.polled ? "polled" : "dark"} tone={l.polled ? "text-globe-sky" : "text-ink-3"} />
        <Row k="Customer called" v={ticket ? "yes — open ticket" : "no"} tone={ticket ? "text-watch" : undefined} />
        <Row k="ARPU" v={peso(l.arpu)} />
        {(l.vip || l.b2b) && <Row k="Priority" v={[l.vip && "VIP", l.b2b && "B2B"].filter(Boolean).join(" · ")} tone="text-watch" />}
        <Row k="Record confidence" v={pct(l.conf)} tone={l.conf < 0.7 ? "text-record" : undefined} />
        {l.est && <div className="mt-1 text-[10.5px] text-record">Location estimated — plant record has no coordinates</div>}
      </>
    );
  }
  const e = bundle.elementById.get(h.id);
  if (!e) return null;
  const under = linesUnder(bundle, e.id);
  const impacted = under.filter((id) => snapshot.element_health[id]).length;
  const sensed = under.filter((id) => bundle.lineById.get(id)?.polled).length;
  const kind = { olt: "OLT · exchange", pon: "PON port", splitter: e.tier === 1 ? "Primary splitter" : "Secondary splitter", nap: "NAP box" }[e.kind];
  const dead = snapshot.sensing_health.dead_olt === e.id;
  return (
    <>
      <div className="mb-0.5 font-mono text-[12.5px] font-semibold text-ink">{e.id}</div>
      <div className="mb-1.5 text-[11px] text-ink-3">
        {kind} · {e.city}
      </div>
      <Row k="Lines served" v={under.length.toLocaleString()} />
      <Row k="Impacted" v={impacted} tone={impacted ? "text-critical" : "text-healthy"} />
      <Row k="Sensing coverage" v={under.length ? pct(sensed / under.length) : "—"} />
      <Row k="Record confidence" v={pct(e.conf)} tone={e.conf < 0.8 ? "text-record" : undefined} />
      {dead && <div className="mt-1 text-[10.5px] font-semibold text-critical">Alarm feed down — this exchange is blind</div>}
      {e.est && <div className="mt-1 text-[10.5px] text-record">Location estimated from parent</div>}
    </>
  );
}
