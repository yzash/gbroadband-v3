"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/AppState";
import { pct, fmtHrs, fmtSimTime } from "@/lib/tokens";

interface Metrics {
  deflected: number;
  correctRolls: number;
  wrongRolls: number;
  rollsAvoided: number;
  wrongRollRate: number;
  repairsTotal: number;
  repairsInWindow: number;
  repairsInWindowPct: number;
  dupMerged: number;
  retention: { holdoutHaz: number; treatedHaz: number; lift: number | null; treatedN: number; controlN: number };
  corrections: { id: string; line_id: string; from_parent: string; to_parent: string; status: string; incident_id: string; sim_ts: number }[];
  correctionsAccepted: number;
  correctionsSuggested: number;
  reopened: number;
  modelVersion: number;
  models: { version: number; created_at: number; note: string; metrics_json: string }[];
  mttrSample: { fault_kind: string; vendor_id: string; area_class: string; p50_hrs: number; p90_hrs: number; samples: number }[];
}

export function LearnClient() {
  const { snapshot } = useApp();
  const [m, setM] = useState<Metrics | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/learn", { cache: "no-store" });
    if (r.ok) setM(await r.json());
  }, []);

  useEffect(() => {
    load();
  }, [load, snapshot?.generated_at]);

  const retrain = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/learn/retrain", { method: "POST" });
      const j = await r.json();
      setFlash(`Model retrained → v${j.version} · ${j.adjusted} cells adjusted · incidents re-ranked`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const accept = async (id: string) => {
    await fetch(`/api/corrections/${id}/accept`, { method: "POST" });
    await load();
  };

  if (!m) return <div className="grid h-full place-items-center text-ink-3">Loading…</div>;

  return (
    <div className="flex flex-col gap-4 p-5">
      {flash && (
        <div className="rounded-md border border-doctrine/40 bg-doctrine/10 px-3 py-2 text-xs text-doctrine">{flash}</div>
      )}

      {/* Headline metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {m.retention.lift === null ? (
          <Tile label="Retention lift vs holdout" value="—" sub="measured once a proactive notification goes out" />
        ) : (
          <Tile
            label="Retention lift vs holdout"
            value={`${m.retention.lift > 0 ? "+" : ""}${pct(m.retention.lift, 0)}`}
            sub={`peak churn risk ${(m.retention.holdoutHaz * 100).toFixed(2)}% held-out → ${(m.retention.treatedHaz * 100).toFixed(2)}% notified (n=${m.retention.treatedN}/${m.retention.controlN})`}
            accent={m.retention.lift > 0 ? "healthy" : "critical"}
          />
        )}
        <Tile label="Calls deflected" value={m.deflected.toLocaleString()} sub="cumulative · notification-driven" accent="healthy" />
        <Tile label="Wrong-roll rate" value={pct(m.wrongRollRate, 0)} sub={`${m.correctRolls} correct · ${m.wrongRolls} wrong`} accent={m.wrongRollRate > 0.2 ? "critical" : "healthy"} />
        <Tile label="Rolls avoided" value={String(m.rollsAvoided)} sub="dedup + power-outage guardrail" accent="healthy" />
        <Tile label="Repairs in window" value={pct(m.repairsInWindowPct, 0)} sub={`${m.repairsInWindow}/${m.repairsTotal} repairs`} />
        <Tile label="Duplicate tickets merged" value={m.dupMerged.toLocaleString()} sub="clustered to root cause" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Plant-record corrections */}
        <section className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="section-title">Plant-record corrections</h3>
            <span className="text-2xs text-ink-3">{m.correctionsAccepted} accepted · {m.correctionsSuggested} suggested</span>
          </div>
          <p className="mb-2 text-2xs text-ink-3">Crews found lines on a different splitter than the records claimed. Accepting raises future record confidence and sharpens isolation.</p>
          <div className="flex max-h-72 flex-col gap-1.5 overflow-auto">
            {m.corrections.length === 0 && <div className="text-xs text-ink-3">No corrections suggested yet — reopen a wrongly-dispatched incident to generate one.</div>}
            {m.corrections.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2 text-2xs">
                <div>
                  <span className="font-mono text-ink-2">{c.line_id}</span>{" "}
                  <span className="text-ink-3">{c.from_parent}</span>
                  <span className="text-ink-3"> → </span>
                  <span className="text-healthy">{c.to_parent}</span>
                  <Link href={`/incidents?id=${c.incident_id}`} className="ml-2 text-doctrine hover:underline">{c.incident_id}</Link>
                </div>
                {c.status === "suggested" ? (
                  <button className="btn-primary text-2xs" onClick={() => accept(c.id)}>Accept</button>
                ) : (
                  <span className="chip bg-healthy/15 text-healthy">accepted</span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* MTTR model + retrain */}
        <section className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="section-title">MTTR model · v{m.modelVersion}</h3>
            <button className="btn-primary text-xs" disabled={busy} onClick={retrain}>
              {busy ? "Retraining…" : "Retrain from outcomes"}
            </button>
          </div>
          <div className="mb-2 text-2xs text-ink-3">{m.reopened} incident(s) reopened after verification. Retrain blends predictions toward realized MTTR and re-ranks the queue.</div>
          <div className="max-h-56 overflow-auto rounded-md border border-line">
            <table className="w-full text-2xs">
              <thead className="sticky top-0 bg-surface-2 text-ink-3">
                <tr><th className="px-2 py-1 text-left">Class</th><th className="px-2 py-1 text-left">Vendor</th><th className="px-2 py-1 text-left">Area</th><th className="px-2 py-1 text-right">p50</th><th className="px-2 py-1 text-right">p90</th><th className="px-2 py-1 text-right">n</th></tr>
              </thead>
              <tbody>
                {m.mttrSample.map((r, i) => (
                  <tr key={i} className="border-t border-line/50">
                    <td className="px-2 py-1 text-ink-2">{r.fault_kind}</td>
                    <td className="px-2 py-1 text-ink-3">{r.vendor_id}</td>
                    <td className="px-2 py-1 text-ink-3">{r.area_class}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-ink-2">{fmtHrs(r.p50_hrs)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-ink-3">{fmtHrs(r.p90_hrs)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-ink-3">{r.samples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {m.models.map((v) => (
              <span key={v.version} className={`chip ${v.version === m.modelVersion ? "bg-doctrine/15 text-doctrine" : "bg-surface-3 text-ink-3"}`}>
                v{v.version} · {fmtSimTime(v.created_at)}
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "healthy" | "critical" }) {
  const color = accent === "healthy" ? "text-healthy" : accent === "critical" ? "text-critical" : "text-ink";
  return (
    <div className="card-2 px-3 py-2.5">
      <div className="kpi-label">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-2xs text-ink-3">{sub}</div>}
    </div>
  );
}
