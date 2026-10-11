"use client";

/** Minimal inline-SVG sparkline. Cheap enough to render many per screen. */
export function Sparkline({
  values,
  color = "#2F6BFF",
  height = 28,
  width = 120,
  fill = false,
  max,
}: {
  values: number[];
  color?: string;
  height?: number;
  width?: number;
  fill?: boolean;
  max?: number;
}) {
  if (values.length === 0) {
    return <svg width={width} height={height} className="opacity-40" />;
  }
  const hi = max ?? Math.max(1, ...values);
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = n === 1 ? width : (i / (n - 1)) * width;
    const y = height - (Math.max(0, v) / hi) * (height - 2) - 1;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} className="overflow-visible">
      {fill && <path d={area} fill={color} fillOpacity={0.12} />}
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      {pts.length > 0 && (
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2} fill={color} />
      )}
    </svg>
  );
}
