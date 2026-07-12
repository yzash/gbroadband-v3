"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HEALTH_HEX, type Health } from "@/lib/tokens";
import type { OpsSnapshot, IncidentSummary } from "@/lib/types";

interface GeoNode {
  element_id: string;
  kind: string;
  parent_id: string | null;
  grid_x: number;
  grid_y: number;
}
interface Geo {
  nodes: GeoNode[];
  districts: { id: string; name: string; grid_x: number; grid_y: number }[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

const KIND_R: Record<string, number> = { olt: 6, pon: 3, splitter: 2.4, nap: 1.6 };

export function NetworkMap({ snapshot }: { snapshot: OpsSnapshot }) {
  const [geo, setGeo] = useState<Geo | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/topo-geo", { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setGeo)
      .catch(() => {});
  }, []);

  if (!geo) return <div className="grid h-full place-items-center text-2xs text-ink-3">loading map…</div>;

  const W = 1000;
  const H = 620;
  const pad = 24;
  const { minX, maxX, minY, maxY } = geo.bounds;
  const sx = (x: number) => pad + ((x - minX) / (maxX - minX || 1)) * (W - 2 * pad);
  const sy = (y: number) => pad + ((y - minY) / (maxY - minY || 1)) * (H - 2 * pad);
  const byId = new Map(geo.nodes.map((n) => [n.element_id, n]));
  const health = snapshot.element_health;
  const colorFor = (id: string): string => {
    const h = health[id] as Health | undefined;
    return h ? HEALTH_HEX[h] : "#3a4a6a";
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
      {/* district labels */}
      {geo.districts.map((d) => (
        <text key={d.id} x={sx(d.grid_x)} y={sy(d.grid_y)} fontSize={6.5} className="fill-ink-3/40" textAnchor="middle">
          {d.name}
        </text>
      ))}
      {/* backbone edges */}
      {geo.nodes.map((n) => {
        if (!n.parent_id || !byId.has(n.parent_id)) return null;
        const p = byId.get(n.parent_id)!;
        return (
          <line key={`e${n.element_id}`} x1={sx(p.grid_x)} y1={sy(p.grid_y)} x2={sx(n.grid_x)} y2={sy(n.grid_y)}
            stroke="#20293e" strokeWidth={n.kind === "pon" ? 1.2 : 0.6} />
        );
      })}
      {/* incident halos sized by blast radius */}
      {snapshot.incidents.map((inc: IncidentSummary) => {
        if (!inc.top_suspect || inc.state === "resolved") return null;
        const n = byId.get(inc.top_suspect);
        if (!n) return null;
        const size = inc.observed_count + inc.inferred_count;
        const r = Math.min(48, 10 + Math.sqrt(size) * 3);
        const col = inc.state === "repairing" ? HEALTH_HEX.watch : HEALTH_HEX.critical;
        return (
          <g key={`h${inc.id}`} className="cursor-pointer" onClick={() => router.push(`/incidents?id=${inc.id}`)}>
            <circle cx={sx(n.grid_x)} cy={sy(n.grid_y)} r={r} fill={col} fillOpacity={0.1} stroke={col} strokeOpacity={0.4} />
            <circle cx={sx(n.grid_x)} cy={sy(n.grid_y)} r={r} fill="none" stroke={col} strokeWidth={1} className="animate-halo" style={{ transformOrigin: `${sx(n.grid_x)}px ${sy(n.grid_y)}px` }} />
          </g>
        );
      })}
      {/* backbone nodes */}
      {geo.nodes.map((n) => (
        <circle key={`n${n.element_id}`} cx={sx(n.grid_x)} cy={sy(n.grid_y)} r={KIND_R[n.kind] ?? 2}
          fill={colorFor(n.element_id)} stroke="#0b0f17" strokeWidth={0.4}>
          <title>{n.element_id}</title>
        </circle>
      ))}
      {/* crew glyphs */}
      {snapshot.crews.map((c) =>
        c.grid_x === null || c.grid_y === null ? null : (
          <g key={c.job_id} transform={`translate(${sx(c.grid_x)},${sy(c.grid_y)})`}>
            <path d="M0,-5 L4,4 L-4,4 Z" fill={c.state === "onsite" ? HEALTH_HEX.healthy : HEALTH_HEX.watch} stroke="#0b0f17" strokeWidth={0.5} />
            <title>{`crew ${c.vendor_id} · ${c.state}`}</title>
          </g>
        )
      )}
    </svg>
  );
}
