"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/AppState";
import { Sparkline } from "@/components/Sparkline";
import { DetectedViaBadge, FaultKindLabel, StateChip, ConfidenceBar } from "@/components/ui";
import { HEALTH_HEX } from "@/lib/tokens";
import type { DetectionDetail } from "@/lib/types";

const SIGNAL_COLOR: Record<string, string> = {
  tickets: "#c98cff",
  telemetry: HEALTH_HEX.healthy,
  reachability: "#4c8dff",
  alarm: HEALTH_HEX.degraded,
  dying_gasp: HEALTH_HEX.critical,
};

export function DetectionsClient() {
  const { snapshot } = useApp();
  const [dets, setDets] = useState<DetectionDetail[]>([]);

  // Poll detection details; re-fetch promptly whenever the live snapshot ticks.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/detections", { cache: "no-store" });
        if (r.ok && alive) setDets((await r.json()).detections);
      } catch {
        /* transient */
      }
    };
    load();
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [snapshot?.generated_at]);

  if (dets.length === 0) {
    return (
      <div className="grid flex-1 place-items-center p-10 text-center text-ink-3">
        <div>
          <div className="mb-2 text-4xl opacity-30">◎</div>
          <p className="text-sm">No active detections. Run the sim clock — or inject a fault from the Scenario Director —</p>
          <p className="text-sm">and watch detections emerge, including from tickets alone when telemetry is dark.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2 xl:grid-cols-3">
      {dets.map((d) => (
        <DetectionCard key={d.id} d={d} />
      ))}
    </div>
  );
}

function DetectionCard({ d }: { d: DetectionDetail }) {
  const confSeries = d.samples.map((s) => s.detection_confidence);
  const ticketSeries = d.samples.map((s) => s.tickets);
  const telSeries = d.samples.map((s) => s.telemetry);
  const unreachSeries = d.samples.map((s) => s.unreachable);
  const dgSeries = d.samples.map((s) => s.dying_gasp_ratio);
  const hasTel = telSeries.some((v) => v > 0);
  const hasDg = dgSeries.some((v) => v > 0.01);

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-ink">{d.id}</span>
            <StateChip state={d.state} />
          </div>
          <div className="mt-0.5 text-xs text-ink-2">
            <FaultKindLabel kind={d.fault_kind} confidence={d.fault_kind_confidence} />
          </div>
        </div>
        <DetectedViaBadge via={d.detected_via} dark={d.telemetry_dark} />
      </div>

      {/* Confidence hardening */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-2xs uppercase tracking-wide text-ink-3">Detection confidence</span>
          <span className="font-mono text-xs text-ink">{(d.detection_confidence * 100).toFixed(0)}%</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <ConfidenceBar value={d.detection_confidence} />
          </div>
          <Sparkline values={confSeries} color="#4c8dff" width={90} height={24} max={1} fill />
        </div>
      </div>

      {/* Aligned contributing-signal mini-charts on one time axis */}
      <div className="rounded-md bg-surface-2 p-2.5">
        <div className="mb-1.5 text-2xs uppercase tracking-wide text-ink-3">Contributing signals · aligned time axis</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <MiniRow label="Ticket burst" values={ticketSeries} color={SIGNAL_COLOR.tickets} />
          {hasTel ? (
            <MiniRow label="Telemetry LOS" values={telSeries} color={SIGNAL_COLOR.telemetry} />
          ) : (
            <div className="flex flex-col justify-center text-2xs text-ink-3">
              <span>Telemetry</span>
              <span className="text-critical/80">dark — no polling here</span>
            </div>
          )}
          <MiniRow label="Reachability drops" values={unreachSeries} color={SIGNAL_COLOR.reachability} />
          {hasDg && <MiniRow label="Dying-gasp ratio" values={dgSeries} color={SIGNAL_COLOR.dying_gasp} max={1} />}
        </div>
      </div>

      {/* Signal contributions */}
      <div className="flex flex-col gap-1.5">
        {d.contributions.map((c) => (
          <div key={c.signal} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 capitalize text-ink-2">{c.signal.replace("_", " ")}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full" style={{ width: `${Math.round(c.weight * 100)}%`, background: SIGNAL_COLOR[c.signal] ?? "#7aa7ff" }} />
            </div>
            <span className="text-2xs text-ink-3">{c.detail}</span>
          </div>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-line pt-2">
        <span className="text-2xs text-ink-3">locus <span className="font-mono text-ink-2">{d.top_suspect}</span></span>
        <Link href={`/incidents?id=${d.id}`} className="chip border border-doctrine/40 bg-doctrine/10 text-doctrine hover:bg-doctrine/20">
          promoted to Incident →
        </Link>
      </div>
    </div>
  );
}

function MiniRow({ label, values, color, max }: { label: string; values: number[]; color: string; max?: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-2xs text-ink-3">{label}</span>
      <Sparkline values={values} color={color} width={90} height={20} max={max} />
    </div>
  );
}
