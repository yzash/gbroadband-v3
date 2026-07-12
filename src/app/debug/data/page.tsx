import { allTruth, allRecorded, topoCounts, truthChildren, napMisrecordedCount, type TruthRow } from "@/lib/queries";
import { HEALTH_HEX } from "@/lib/tokens";

export const dynamic = "force-dynamic";

const KIND_COLOR: Record<string, string> = {
  olt: "#4c8dff",
  pon: "#7aa7ff",
  splitter: "#c98cff",
  nap: "#2fbf87",
  ont: "#6b7896",
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card-2 px-4 py-3">
      <div className="kpi-label">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-2xs text-ink-3">{sub}</div>}
    </div>
  );
}

function NetworkSVG() {
  const truth = allTruth();
  const rec = new Map(allRecorded().map((r) => [r.element_id, r]));
  const byId = new Map(truth.map((t) => [t.element_id, t]));

  const W = 1000;
  const H = 780;
  const pad = 20;
  const xs = truth.filter((t) => t.grid_x !== null).map((t) => t.grid_x!) ;
  const ys = truth.filter((t) => t.grid_y !== null).map((t) => t.grid_y!);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const sx = (x: number) => pad + ((x - minX) / (maxX - minX || 1)) * (W - 2 * pad);
  const sy = (y: number) => pad + ((y - minY) / (maxY - minY || 1)) * (H - 2 * pad);

  const backbone = truth.filter((t) => t.kind !== "ont" && t.parent_id);
  const onts = truth.filter((t) => t.kind === "ont");
  const mismappedOnts = onts.filter((t) => rec.get(t.element_id)?.mismapped === 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-card border border-line bg-base">
      {/* Backbone edges (truth) */}
      {backbone.map((e) => {
        const p = byId.get(e.parent_id!);
        if (!p || e.grid_x === null || p.grid_x === null) return null;
        return (
          <line
            key={`e-${e.element_id}`}
            x1={sx(p.grid_x)} y1={sy(p.grid_y!)} x2={sx(e.grid_x)} y2={sy(e.grid_y!)}
            stroke="#2b3854" strokeWidth={e.kind === "pon" ? 1.4 : 0.7}
          />
        );
      })}

      {/* Mis-mapped lines: red link from recorded (wrong) parent to true parent */}
      {mismappedOnts.map((o) => {
        const r = rec.get(o.element_id)!;
        const wrongParent = byId.get(r.parent_id_recorded ?? "");
        const trueParent = byId.get(o.parent_id ?? "");
        if (!wrongParent?.grid_x || !trueParent?.grid_x) return null;
        return (
          <line
            key={`m-${o.element_id}`}
            x1={sx(wrongParent.grid_x)} y1={sy(wrongParent.grid_y!)}
            x2={sx(trueParent.grid_x)} y2={sy(trueParent.grid_y!)}
            stroke={HEALTH_HEX.critical} strokeWidth={0.5} strokeOpacity={0.4}
          />
        );
      })}

      {/* ONTs */}
      {onts.map((o) =>
        o.grid_x === null ? null : (
          <circle key={o.element_id} cx={sx(o.grid_x)} cy={sy(o.grid_y!)} r={0.9}
            fill={rec.get(o.element_id)?.mismapped ? HEALTH_HEX.critical : KIND_COLOR.ont}
            fillOpacity={rec.get(o.element_id)?.mismapped ? 0.9 : 0.45} />
        )
      )}

      {/* Backbone nodes */}
      {backbone.concat(truth.filter((t) => t.kind === "olt")).map((e) =>
        e.grid_x === null ? null : (
          <circle key={`n-${e.element_id}`} cx={sx(e.grid_x)} cy={sy(e.grid_y!)}
            r={e.kind === "olt" ? 6 : e.kind === "pon" ? 3.5 : e.kind === "splitter" ? 2.6 : 1.8}
            fill={KIND_COLOR[e.kind]} stroke="#0b0f17" strokeWidth={0.5} />
        )
      )}
    </svg>
  );
}

function TreeNode({ node, depth }: { node: TruthRow; depth: number }) {
  if (node.kind === "nap") {
    const lineCount = truthChildren(node.element_id).length;
    const mis = napMisrecordedCount(node.element_id);
    return (
      <div style={{ marginLeft: depth * 14 }} className="py-0.5 text-xs">
        <span className="text-healthy">◆ {node.element_id}</span>{" "}
        <span className="text-ink-3">{node.label}</span>{" "}
        <span className="text-ink-3">· {lineCount} lines</span>
        {mis > 0 && <span className="ml-1 text-critical">· {mis} mis-recorded elsewhere</span>}
      </div>
    );
  }

  const children = depth < 4 ? truthChildren(node.element_id) : [];
  const glyph = node.kind === "olt" ? "■" : node.kind === "pon" ? "▣" : "◈";
  const color = KIND_COLOR[node.kind];
  return (
    <div style={{ marginLeft: depth * 14 }} className="py-0.5 text-xs">
      <span style={{ color }}>{glyph} {node.element_id}</span>{" "}
      <span className="text-ink-3">{node.label}</span>
      <div>{children.map((c) => <TreeNode key={c.element_id} node={c} depth={depth + 1} />)}</div>
    </div>
  );
}

export default function DebugDataPage() {
  const c = topoCounts();
  const roots = truthChildren(null);

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <div className="mb-1 text-2xs uppercase tracking-wider text-degraded">Debug · not part of the demo UI</div>
      <h1 className="mb-4 text-xl font-semibold">Topology &amp; data integrity</h1>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Stat label="OLTs" value={String(c.olt)} />
        <Stat label="PON ports" value={String(c.pon)} />
        <Stat label="Splitters" value={String(c.splitter)} sub="two-level cascade" />
        <Stat label="NAP boxes" value={String(c.nap)} />
        <Stat label="ONTs / lines" value={c.ont.toLocaleString()} />
        <Stat label="Districts" value={String(c.districts)} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Mis-mapped lines" value={`${(c.mismap_rate * 100).toFixed(1)}%`} sub={`${c.mismapped} of ${c.lines} — recorded under wrong NAP`} />
        <Stat label="Missing coords" value={String(c.missing_coords)} sub="elements dark in plant records" />
        <Stat label="Actively sensed" value={`${(c.polled_rate * 100).toFixed(0)}%`} sub={`${c.polled} polled · ${c.lines - c.polled} dark ONTs`} />
        <Stat label="VIP / B2B / holdout" value={`${c.vip} / ${c.b2b} / ${c.holdout}`} sub="subscriber flags" />
      </div>

      <div className="mb-2 flex items-center gap-4 text-2xs text-ink-3">
        <span><span style={{ color: KIND_COLOR.olt }}>●</span> OLT</span>
        <span><span style={{ color: KIND_COLOR.pon }}>●</span> PON</span>
        <span><span style={{ color: KIND_COLOR.splitter }}>●</span> Splitter</span>
        <span><span style={{ color: KIND_COLOR.nap }}>●</span> NAP</span>
        <span><span style={{ color: KIND_COLOR.ont }}>●</span> ONT</span>
        <span><span style={{ color: HEALTH_HEX.critical }}>●</span> Mis-mapped line (red link = recorded→true parent)</span>
      </div>
      <NetworkSVG />

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wider text-ink-3">Tree (truth)</h2>
      <div className="card max-h-[600px] overflow-auto p-4 font-mono">
        {roots.map((r) => <TreeNode key={r.element_id} node={r} depth={0} />)}
      </div>
    </div>
  );
}
