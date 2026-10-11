"use client";

import type { TreeNode } from "@/lib/incident-queries";

const COL: Record<string, number> = { olt: 0, pon: 1, splitter: 2, nap: 3, ont: 4 };
const COL_LABEL = ["OLT", "PON", "Splitter", "NAP", "Line"];

function suspicionColor(s: number | null): string {
  if (s === null) return "#172752";
  if (s >= 0.6) return "#FF4D5E";
  if (s >= 0.4) return "#FF8A3D";
  if (s >= 0.2) return "#FFC542";
  return "#2A3D70";
}

/** Recorded subtree around the suspect, heat-colored by suspicion. */
export function IsolationTree({ nodes }: { nodes: TreeNode[] }) {
  if (nodes.length === 0) return <div className="p-6 text-center text-sm text-ink-3">Isolating…</div>;

  // Assign columns by kind, spread rows within each column.
  const byCol = new Map<number, TreeNode[]>();
  for (const n of nodes) {
    const c = COL[n.kind] ?? 4;
    const arr = byCol.get(c) ?? [];
    arr.push(n);
    byCol.set(c, arr);
  }
  const cols = [...byCol.keys()].sort((a, b) => a - b);
  const W = 640;
  const H = Math.max(220, Math.max(...[...byCol.values()].map((a) => a.length)) * 34 + 40);
  const colX = (c: number) => 60 + cols.indexOf(c) * ((W - 120) / Math.max(1, cols.length - 1 || 1));
  const pos = new Map<string, { x: number; y: number }>();
  for (const c of cols) {
    const arr = byCol.get(c)!;
    arr.forEach((n, i) => {
      const y = 40 + (i + 0.5) * ((H - 50) / arr.length);
      pos.set(n.element_id, { x: colX(c), y });
    });
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {/* column headers */}
      {cols.map((c) => (
        <text key={`h${c}`} x={colX(c)} y={16} textAnchor="middle" className="fill-ink-3" fontSize={9}>
          {COL_LABEL[c]}
        </text>
      ))}
      {/* edges */}
      {nodes.map((n) => {
        if (!n.parent || !pos.has(n.parent) || !pos.has(n.element_id)) return null;
        const p = pos.get(n.parent)!;
        const q = pos.get(n.element_id)!;
        return <line key={`e${n.element_id}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#2A3D70" strokeWidth={1} />;
      })}
      {/* nodes */}
      {nodes.map((n) => {
        const p = pos.get(n.element_id)!;
        const color = suspicionColor(n.suspicion);
        const isSuspect = n.rank === 1;
        return (
          <g key={n.element_id}>
            <circle
              cx={p.x}
              cy={p.y}
              r={isSuspect ? 9 : n.suspicion !== null ? 6 : 4}
              fill={color}
              stroke={isSuspect ? "#EEF3FF" : "#050B1D"}
              strokeWidth={isSuspect ? 2 : 0.5}
            />
            {n.conflict && (
              <text x={p.x + 10} y={p.y - 8} fontSize={11} className="fill-critical">
                ⚠
              </text>
            )}
            <text x={p.x} y={p.y + (isSuspect ? 22 : 16)} textAnchor="middle" fontSize={8} className="fill-ink-2">
              {n.element_id}
            </text>
            {n.suspicion !== null && (
              <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize={7.5} className="fill-black" fontWeight="700">
                {Math.round(n.suspicion * 100)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
