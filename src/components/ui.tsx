import type { DetectedVia, IncidentState, FaultKind } from "@/lib/types";
import { FAULT_LABEL } from "@/lib/types";

export function StateChip({ state }: { state: IncidentState }) {
  const map: Record<IncidentState, string> = {
    suspected: "bg-watch/15 text-watch border-watch/30",
    isolating: "bg-doctrine/15 text-doctrine border-doctrine/30",
    confirmed: "bg-degraded/15 text-degraded border-degraded/30",
    repairing: "bg-doctrine/15 text-doctrine border-doctrine/30",
    verifying: "bg-record/15 text-record border-record/30",
    resolved: "bg-healthy/15 text-healthy border-healthy/30",
    reopened: "bg-critical/15 text-critical border-critical/30",
  };
  return <span className={`chip border ${map[state]}`}>{state}</span>;
}

export function DetectedViaBadge({ via, dark }: { via: DetectedVia; dark?: boolean }) {
  const isTickets = via === "tickets";
  return (
    <div
      className={[
        "inline-flex flex-col rounded-md border px-2.5 py-1",
        isTickets ? "border-record/50 bg-record/10" : "border-live/40 bg-live/10",
      ].join(" ")}
    >
      <span className={`text-2xs font-semibold uppercase tracking-wide ${isTickets ? "text-record" : "text-live"}`}>
        Detected via {via}
      </span>
      {dark && <span className="text-2xs text-ink-3">telemetry dark in this subtree</span>}
    </div>
  );
}

export function FaultKindLabel({ kind, confidence }: { kind: FaultKind | null; confidence?: number }) {
  if (!kind) return <span className="text-ink-3">classifying…</span>;
  return (
    <span className="text-ink">
      {FAULT_LABEL[kind]}
      {confidence !== undefined && <span className="ml-1 text-2xs text-ink-3">· {(confidence * 100).toFixed(0)}% conf</span>}
    </span>
  );
}

export function ConfidenceBar({ value, label }: { value: number; label?: string }) {
  const pctv = Math.round(value * 100);
  const color = value >= 0.7 ? "bg-healthy" : value >= 0.45 ? "bg-watch" : "bg-degraded";
  return (
    <div>
      {label && <div className="mb-0.5 flex justify-between text-2xs text-ink-3"><span>{label}</span><span className="tabular-nums text-ink-2">{pctv}%</span></div>}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pctv}%` }} />
      </div>
    </div>
  );
}

export function Provenance({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1 text-2xs uppercase tracking-wide text-ink-3">
      <span className="text-record">◈</span>
      {children}
    </div>
  );
}
