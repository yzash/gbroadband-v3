"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useApp } from "@/components/AppState";
import { StateChip, DetectedViaBadge, FaultKindLabel } from "@/components/ui";
import { IsolationTree } from "./IsolationTree";
import { ActionLadder } from "./ActionLadder";
import { LoopTrace } from "./LoopTrace";
import { BlastMap } from "./BlastMap";
import { HandoffStrip } from "./HandoffStrip";
import { peso, pesoCompact, fmtHrs } from "@/lib/tokens";
import type { SuspicionOut, TreeNode, BlastLineOut } from "@/lib/incident-queries";

interface IncidentListItem {
  id: string;
  state: string;
  detected_via: string;
  telemetry_dark: number;
  fault_kind: string | null;
  fault_kind_confidence: number;
  detection_confidence: number;
  top_suspect: string | null;
  top_confidence: number;
  observed_count: number;
  inferred_count: number;
  vip_count: number;
  b2b_count: number;
  peso_exposure: number;
  worst_hours_down: number;
  predicted_mttr_p50: number;
  predicted_mttr_p90: number;
  vendor_id: string | null;
  vendor_name: string | null;
  eta_hrs: number | null;
  rank_score: number;
  area_class: string | null;
}

interface Detail {
  incident: Record<string, unknown>;
  suspicions: SuspicionOut[];
  contributions: { signal: string; weight: number; detail: string }[];
  blastLines: BlastLineOut[];
  blastMap: { observed: string[]; inferred: string[] };
  isolationTree: TreeNode[];
  events: { sim_ts: number; kind: string; text: string; source: string }[];
  proposals: Record<string, unknown>[];
  notifiedCount: number;
}

export function IncidentRoomClient() {
  const { snapshot } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const [items, setItems] = useState<IncidentListItem[]>([]);
  const [selected, setSelected] = useState<string | null>(params.get("id"));
  const [detail, setDetail] = useState<Detail | null>(null);

  const loadList = useCallback(async () => {
    try {
      const r = await fetch("/api/incidents", { cache: "no-store" });
      if (r.ok) {
        const { incidents } = await r.json();
        setItems(incidents);
        setSelected((cur) => cur ?? incidents[0]?.id ?? null);
      }
    } catch {
      /* transient */
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/incidents/${id}`, { cache: "no-store" });
      if (r.ok) setDetail(await r.json());
      else setDetail(null);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList, snapshot?.generated_at]);

  useEffect(() => {
    if (selected) loadDetail(selected);
  }, [selected, loadDetail, snapshot?.generated_at]);

  const mttrWindow = snapshot?.kpis.mttr_window ?? 6;

  if (items.length === 0) {
    return (
      <div className="grid h-full place-items-center p-10 text-center text-ink-3">
        <div>
          <div className="mb-2 text-4xl opacity-30">▤</div>
          <p className="text-sm">No open incidents. Inject a fault from the Scenario Director and run the clock.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Incident queue */}
      <div className="flex w-80 shrink-0 flex-col border-r border-line">
        <div className="border-b border-line px-4 py-2 text-2xs uppercase tracking-wider text-ink-3">
          Incident queue · ranked by exposure
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {items.map((it, i) => (
            <QueueRow
              key={it.id}
              rank={i + 1}
              it={it}
              window={mttrWindow}
              active={selected === it.id}
              onClick={() => {
                setSelected(it.id);
                router.replace(`/incidents?id=${it.id}`);
              }}
            />
          ))}
        </div>
      </div>

      {/* Detail */}
      <div className="min-h-0 flex-1 overflow-auto">
        {detail ? <IncidentDetail detail={detail} window={mttrWindow} onChanged={() => selected && loadDetail(selected)} /> : (
          <div className="grid h-full place-items-center text-ink-3">Select an incident</div>
        )}
      </div>
    </div>
  );
}

function QueueRow({
  rank,
  it,
  window,
  active,
  onClick,
}: {
  rank: number;
  it: IncidentListItem;
  window: number;
  active: boolean;
  onClick: () => void;
}) {
  const total = it.observed_count + it.inferred_count;
  const mttrOver = it.predicted_mttr_p50 > window;
  return (
    <button
      onClick={onClick}
      className={[
        "flex w-full flex-col gap-1 border-b border-line px-4 py-2.5 text-left transition-colors",
        active ? "bg-doctrine/10" : "hover:bg-surface-2",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span className="text-2xs text-ink-3">#{rank}</span>
        <span className="font-mono text-xs text-ink">{it.id}</span>
        <StateChip state={it.state as never} />
        {!!it.telemetry_dark && <span className="chip bg-record/10 text-record">dark</span>}
      </div>
      <div className="text-xs text-ink-2">
        <FaultKindLabel kind={it.fault_kind as never} />{" "}
        <span className="text-ink-3">· {it.top_suspect ?? "—"} ({Math.round(it.top_confidence * 100)}%)</span>
      </div>
      <div className="flex items-center justify-between text-2xs text-ink-3">
        <span>
          {total} lines · <span className="text-ink-2">{it.observed_count} obs</span> / {it.inferred_count} inf
          {it.vip_count > 0 && <span className="ml-1 text-watch">· {it.vip_count} VIP</span>}
        </span>
        <span className="tabular-nums text-degraded">{pesoCompact(it.peso_exposure)}</span>
      </div>
      <div className="flex items-center gap-1.5 text-2xs">
        <span className="text-ink-3">MTTR</span>
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
          <div className={mttrOver ? "h-full bg-critical" : "h-full bg-healthy"} style={{ width: `${Math.min(100, (it.predicted_mttr_p50 / (window * 2)) * 100)}%` }} />
          {/* repair-window threshold marker */}
          <div className="absolute top-0 h-full w-px bg-ink-2/70" style={{ left: "50%" }} title={`window ${window}h`} />
        </div>
        <span className={`tabular-nums ${mttrOver ? "text-critical" : "text-ink-2"}`}>
          {it.predicted_mttr_p50 ? fmtHrs(it.predicted_mttr_p50) : "—"}
        </span>
      </div>
      {it.vendor_name && <div className="text-2xs text-ink-3">→ {it.vendor_name}</div>}
    </button>
  );
}

function IncidentDetail({ detail, window, onChanged }: { detail: Detail; window: number; onChanged: () => void }) {
  const inc = detail.incident as unknown as IncidentListItem & { confirming_test: string | null; detected_at: number };
  const total = inc.observed_count + inc.inferred_count;

  return (
    <div className="flex flex-col gap-4 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg text-ink">{inc.id}</span>
          <StateChip state={inc.state as never} />
          <FaultKindLabel kind={inc.fault_kind as never} confidence={inc.fault_kind_confidence} />
        </div>
        <DetectedViaBadge via={inc.detected_via as never} dark={!!inc.telemetry_dark} />
      </div>

      {/* MTTR / ETA / vendor / prioritization strip */}
      <div className="flex flex-wrap items-center gap-4 rounded-md bg-surface-2 px-4 py-2 text-xs">
        <span className="text-ink-3">Predicted MTTR <span className="ml-1 font-mono text-ink">p50 {inc.predicted_mttr_p50 ? fmtHrs(inc.predicted_mttr_p50) : "—"}</span> <span className="font-mono text-ink-2">/ p90 {inc.predicted_mttr_p90 ? fmtHrs(inc.predicted_mttr_p90) : "—"}</span></span>
        <span className="text-ink-3">Customer ETA <span className="font-mono text-doctrine">{inc.eta_hrs ? fmtHrs(inc.eta_hrs) : "—"}</span></span>
        <span className={inc.predicted_mttr_p50 > window ? "text-critical" : "text-healthy"}>
          {inc.predicted_mttr_p50 > window ? `⚠ exceeds ${window}h repair window` : `within ${window}h window`}
        </span>
        <span className="ml-auto text-ink-3">Vendor <span className="text-ink">{inc.vendor_name ?? (inc.fault_kind === "power_outage" ? "— utility (no fiber crew)" : "—")}</span></span>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Isolation panel */}
        <section className="card p-4">
          <h3 className="section-title mb-2">Isolation · which element</h3>
          <div className="rounded-md bg-base p-2">
            <IsolationTree nodes={detail.isolationTree} />
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {detail.suspicions.slice(0, 4).map((s) => (
              <SuspectRow key={s.element_id} s={s} />
            ))}
          </div>
          {inc.confirming_test && (
            <div className="mt-3 flex items-center justify-between rounded-md border border-doctrine/30 bg-doctrine/5 px-3 py-2">
              <div>
                <div className="text-2xs uppercase tracking-wide text-ink-3">Recommended confirming test</div>
                <div className="font-mono text-xs text-doctrine">{inc.confirming_test}</div>
              </div>
            </div>
          )}
        </section>

        {/* Blast radius panel */}
        <section className="card p-4">
          <h3 className="section-title mb-2">Blast radius · who is affected</h3>
          <div className="mb-3">
            <BlastMap
              incidentId={inc.id}
              observed={detail.blastMap.observed}
              inferred={detail.blastMap.inferred}
              suspect={(inc as unknown as { top_suspect: string | null }).top_suspect}
            />
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Metric label="Impacted" value={String(total)} sub={`${inc.observed_count} observed · ${inc.inferred_count} inferred`} />
            <Metric label="VIP / B2B" value={`${inc.vip_count} / ${inc.b2b_count}`} sub="priority lines" />
            <Metric label="Σ exposure" value={pesoCompact(inc.peso_exposure)} sub="monthly ARPU at risk" />
          </div>
          <div className="mb-2 flex items-center gap-2 text-2xs">
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-critical" /> observed (called / telemetry)</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-inferred" /> inferred (silent)</span>
            <span className="ml-auto text-ink-3">
              only {inc.observed_count} of {total} have called
            </span>
          </div>
          <div className="max-h-56 overflow-auto rounded-md border border-line">
            <table className="w-full text-2xs">
              <thead className="sticky top-0 bg-surface-2 text-ink-3">
                <tr>
                  <th className="px-2 py-1 text-left">Line</th>
                  <th className="px-2 py-1 text-left">Evidence</th>
                  <th className="px-2 py-1 text-right">ARPU</th>
                  <th className="px-2 py-1 text-right">Down</th>
                  <th className="px-2 py-1 text-left">Flags</th>
                </tr>
              </thead>
              <tbody>
                {detail.blastLines.map((b) => (
                  <tr key={b.line_id} className="border-t border-line/50">
                    <td className="px-2 py-1 font-mono text-ink-2">{b.line_id}</td>
                    <td className="px-2 py-1">
                      <span className={b.evidence === "observed" ? "text-critical" : "text-inferred"}>{b.evidence}</span>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-ink-2">{peso(b.arpu)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-ink-3">{fmtHrs(b.hours_down)}</td>
                    <td className="px-2 py-1">
                      {b.vip && <span className="mr-1 text-watch">VIP</span>}
                      {b.b2b && <span className="mr-1 text-doctrine">B2B</span>}
                      {b.notified && <span className="text-healthy">notified</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <HandoffStrip incidentId={inc.id} fault={(inc.fault_kind as string | null) ?? null} />

      {/* Action ladder + Loop Trace */}
      <ActionLadder incidentId={inc.id} detail={detail} window={window} onChanged={onChanged} />
      <LoopTrace detail={detail} />
    </div>
  );
}

function SuspectRow({ s }: { s: SuspicionOut }) {
  const bandLo = Math.max(0, s.confidence - s.evidence.band);
  const bandHi = Math.min(1, s.confidence + s.evidence.band);
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`chip ${s.rank === 1 ? "bg-critical/20 text-critical" : "bg-surface-3 text-ink-2"}`}>#{s.rank}</span>
          <span className="font-mono text-xs text-ink">{s.element_id}</span>
          {s.record_conflict && <span className="chip bg-record/15 text-record">records conflict</span>}
        </div>
        <span className="font-mono text-xs text-ink">{Math.round(s.confidence * 100)}%</span>
      </div>
      {/* confidence band */}
      <div className="relative mt-1.5 h-1.5 w-full rounded-full bg-surface-3">
        <div
          className="absolute h-full rounded-full bg-doctrine/40"
          style={{ left: `${bandLo * 100}%`, width: `${(bandHi - bandLo) * 100}%` }}
        />
        <div className="absolute h-full w-0.5 bg-ink" style={{ left: `${s.confidence * 100}%` }} />
      </div>
      <div className="mt-1 text-2xs text-ink-3">{s.evidence.text}</div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2">
      <div className="kpi-label">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-2xs text-ink-3">{sub}</div>}
    </div>
  );
}
