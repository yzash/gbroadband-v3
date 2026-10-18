"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Camera, Check, ClipboardCheck, FileCheck2, MapPin, Package, Smartphone, Truck, Users, X } from "lucide-react";
import { useApp } from "@/components/AppState";
import { Section, SimTime, Tile, pctTxt, useLive, useOutcomes } from "@/components/persona/kit";
import { FAULT_LABEL, type FaultKind } from "@/lib/types";
import { BRAND } from "@/lib/brand";

interface Job {
  id: string;
  incident_id: string;
  vendor_id: string;
  vendor: string | null;
  target_element: string;
  state: string;
  dispatched_at: number;
  arrived_at: number | null;
  done_at: number | null;
  fault_kind: string | null;
  top_confidence: number;
  customers: number;
  vip_count: number;
  b2b_count: number;
  area_class: string | null;
  conflict: number | null;
  payload_json: string | null;
}
interface Report {
  id: string;
  job_id: string;
  incident_id: string;
  vendor: string | null;
  element_dispatched: string;
  element_found: string;
  root_cause: string;
  action_taken: string;
  parts_used: string | null;
  first_time_fix: number;
  on_time: number;
  minutes_onsite: number;
  discrepancies: number;
  photos: number;
  submitted_at: number;
  submitted_via: string;
}
interface PartnerData {
  jobs: Job[];
  reports: Report[];
  scorecard: { id: string; name: string; jobs: number; ftf: number | null; ontime: number | null; errors: number | null; onsite: number | null }[];
  corrections: { id: string; line_id: string; from_parent: string; to_parent: string; status: string; source: string; incident_id: string; sim_ts: number }[];
  modelVersion: number;
  simMin: number;
}

export function PartnersClient() {
  const { role } = useApp();
  const out = useOutcomes();
  const [d, reload] = useLive<PartnerData>("/api/partners");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const closeout = async (jobId: string) => {
    setBusy(jobId);
    setMsg(null);
    try {
      const r = await fetch("/api/partners/closeout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId, role }) });
      const j = await r.json();
      setMsg(j.ok ? `Close-out filed for ${jobId} — findings sent to the NOC and the plant records.` : j.error);
      await reload();
    } finally {
      setBusy(null);
    }
  };
  const accept = async (id: string) => {
    setBusy(id);
    try {
      await fetch(`/api/corrections/${id}/accept`, { method: "POST" });
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const p = out?.partner;
  const fromField = (d?.corrections ?? []).filter((c) => c.source === "partner_closeout");
  const accepted = (d?.corrections ?? []).filter((c) => c.status === "accepted").length;

  return (
    <div className="flex flex-col gap-4 p-5">
      {msg && <div className="rounded-md border border-healthy/40 bg-healthy/10 px-3 py-2 text-[12.5px] text-healthy">{msg}</div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Close-outs filed" value={String(p?.closeouts ?? 0)} sub="structured: true fault, root cause, record errors" tone="sky" />
        <Tile label="Right first time" value={pctTxt(p?.firstTimeFixPct)} sub="fault was where SDAL sent the crew" tone="healthy" />
        <Tile label="On-time arrival" value={pctTxt(p?.onTimePct)} sub="within the promised travel time" />
        <Tile label="Record errors reported" value={String(p?.recordErrorsReported ?? 0)} sub={`${p?.correctionsFromPartners ?? 0} became record corrections`} tone="record" />
        <Tile
          label="Plant records corrected"
          value={String(p?.correctionsAccepted ?? 0)}
          sub="customer lines re-mapped to the right NAP from crew findings"
          tone="healthy"
        />
      </div>

      <FeedbackLoop
        jobs={(d?.jobs.length ?? 0) + (p?.closeouts ?? 0)}
        closeouts={p?.closeouts ?? 0}
        errors={p?.recordErrorsReported ?? 0}
        corrections={fromField.length}
        accepted={accepted}
        model={d?.modelVersion ?? 1}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Live jobs · dispatch briefs" right={<span className="text-[11px] text-ink-3">{d?.jobs.length ?? 0} active</span>}>
          {d?.jobs.length ? (
            <div className="flex flex-col gap-2">
              {d.jobs.map((j) => {
                const pl = j.payload_json ? (JSON.parse(j.payload_json) as Record<string, unknown>) : {};
                const eta = j.state === "enroute" ? Math.max(0, (j.arrived_at ?? 0) - d.simMin) : 0;
                return (
                  <div key={j.id} className="rounded-md border border-line bg-surface-2 p-3" data-testid="partner-job">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Truck size={14} className="text-watch" />
                          <span className="text-[13.5px] font-semibold text-ink">{j.vendor ?? j.vendor_id}</span>
                          <span className="font-mono text-[11px] text-ink-3">{j.id}</span>
                          <span className={`chip ${j.state === "onsite" ? "bg-healthy/15 text-healthy" : "bg-watch/15 text-watch"}`}>{j.state === "onsite" ? "on site" : `en route · ${eta} min`}</span>
                        </div>
                        <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-ink-2">
                          <span className="flex items-center gap-1.5"><MapPin size={12} className="text-globe-sky" /> Go to <span className="font-mono text-ink">{j.target_element}</span> · {Math.round(j.top_confidence * 100)}% sure</span>
                          <span className="flex items-center gap-1.5"><Package size={12} className="text-globe-sky" /> Bring {String(pl.partsHint ?? "standard kit")}</span>
                          <span className="flex items-center gap-1.5"><Users size={12} className="text-globe-sky" /> {j.customers} customers waiting{j.b2b_count ? ` · ${j.b2b_count} business` : ""}</span>
                          <span>
                            <Link href={`/incidents?id=${j.incident_id}`} className="font-mono text-doctrine hover:underline">{j.incident_id}</Link> · {j.fault_kind ? FAULT_LABEL[j.fault_kind as FaultKind] : ""}
                          </span>
                        </div>
                        {!!j.conflict && (
                          <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-record">
                            <AlertTriangle size={12} /> Records conflict near this element — please confirm what you find on site
                          </div>
                        )}
                      </div>
                      <button
                        className="btn-primary shrink-0 text-xs"
                        disabled={role !== "partner" || j.state !== "onsite" || busy === j.id}
                        title={role !== "partner" ? "Act as the last-mile partner to file a close-out" : j.state !== "onsite" ? "Crew is not on site yet" : ""}
                        onClick={() => closeout(j.id)}
                        data-testid="submit-closeout"
                      >
                        <ClipboardCheck size={13} /> Submit close-out
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[12.5px] text-ink-3">No partner crews out right now.</div>
          )}
        </Section>

        <Section title="Close-outs from the field" right={<span className="text-[11px] text-ink-3">newest first</span>}>
          <div className="flex max-h-[460px] flex-col gap-2 overflow-auto">
            {(d?.reports ?? []).map((r) => (
              <div key={r.id} className="rounded-md bg-surface-2 px-3 py-2 text-[12.5px]">
                <div className="flex items-center gap-2">
                  <FileCheck2 size={14} className="text-globe-sky" />
                  <span className="font-semibold text-ink">{r.vendor}</span>
                  <Link href={`/incidents?id=${r.incident_id}`} className="font-mono text-[11px] text-doctrine hover:underline">{r.incident_id}</Link>
                  <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-3">
                    {r.submitted_via === "partner_portal" ? <ClipboardCheck size={11} /> : <Smartphone size={11} />}
                    <SimTime t={r.submitted_at} />
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-2">
                  <span>
                    Sent to <span className="font-mono">{r.element_dispatched}</span> · found at <span className="font-mono">{r.element_found}</span>{" "}
                    {r.first_time_fix ? <Check size={12} className="inline text-healthy" /> : <X size={12} className="inline text-critical" />}
                  </span>
                  <span className="flex items-center gap-1"><Camera size={11} /> {r.photos}</span>
                  <span>{r.minutes_onsite} min on site</span>
                </div>
                <div className="mt-0.5 text-[11.5px] text-ink-3">{r.root_cause} — {r.action_taken}</div>
                {r.discrepancies > 0 && (
                  <div className="mt-1 inline-flex items-center gap-1 rounded bg-record/15 px-1.5 py-0.5 text-[11px] font-semibold text-record">
                    {r.discrepancies} record error{r.discrepancies === 1 ? "" : "s"} reported → plant-record corrections
                  </div>
                )}
              </div>
            ))}
            {!d?.reports.length && <div className="text-[12.5px] text-ink-3">No close-outs yet — they arrive as crews finish.</div>}
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Plant-record corrections from the field" right={<span className="text-[11px] text-ink-3">{fromField.filter((c) => c.status === "suggested").length} to review</span>}>
          <div className="flex max-h-[320px] flex-col gap-1 overflow-auto">
            {fromField.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-[12px] hover:bg-surface-2">
                <span className="font-mono text-ink">{c.line_id}</span>
                <span className="text-ink-3">
                  records say <span className="font-mono">{c.from_parent}</span> → crew saw <span className="font-mono text-ink-2">{c.to_parent}</span>
                </span>
                {c.status === "accepted" ? (
                  <span className="chip ml-auto bg-healthy/15 text-healthy">in records</span>
                ) : (
                  <button className="btn-ghost ml-auto px-2 py-0.5 text-[11px]" disabled={role === "readonly" || busy === c.id} onClick={() => accept(c.id)} data-testid="accept-correction">
                    Accept into records
                  </button>
                )}
              </div>
            ))}
            {!fromField.length && <div className="text-[12.5px] text-ink-3">None yet — crews report record errors in their close-outs.</div>}
          </div>
        </Section>

        <Section title="Partner scorecard">
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[10.5px] uppercase tracking-wider text-ink-3">
              <tr>
                <th className="py-1.5">Partner</th>
                <th className="py-1.5 text-right">Jobs</th>
                <th className="py-1.5 text-right">Right 1st time</th>
                <th className="py-1.5 text-right">On time</th>
                <th className="py-1.5 text-right">Record errors found</th>
                <th className="py-1.5 text-right">Avg on site</th>
              </tr>
            </thead>
            <tbody>
              {(d?.scorecard ?? []).map((s) => (
                <tr key={s.id} className="border-t border-line/60">
                  <td className="py-1.5 font-semibold text-ink">{s.name}</td>
                  <td className="py-1.5 text-right tabular-nums text-ink-2">{s.jobs}</td>
                  <td className="py-1.5 text-right tabular-nums text-ink-2">{s.jobs ? pctTxt((s.ftf ?? 0) / s.jobs) : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums text-ink-2">{s.jobs ? pctTxt((s.ontime ?? 0) / s.jobs) : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums text-record">{s.errors ?? 0}</td>
                  <td className="py-1.5 text-right tabular-nums text-ink-2">{s.onsite ? `${Math.round(s.onsite)} min` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  );
}

/** The last-mile feedback loop, drawn with live counts at each step. */
function FeedbackLoop(p: { jobs: number; closeouts: number; errors: number; corrections: number; accepted: number; model: number }) {
  const steps = [
    { k: "1", t: "Dispatch brief", s: `${p.jobs} jobs · exact element, parts, customers`, c: BRAND.globeBlueBright },
    { k: "2", t: "On site, fixed", s: "crew confirms the true fault", c: BRAND.watch },
    { k: "3", t: "Close-out", s: `${p.closeouts} filed · ${p.errors} record errors seen`, c: BRAND.degraded },
    { k: "4", t: "Records corrected", s: `${p.corrections} suggested · ${p.accepted} accepted`, c: BRAND.record },
    { k: "5", t: "Sharper next dispatch", s: `isolation + MTTR model v${p.model}`, c: BRAND.healthy },
  ];
  const W = 1000;
  const bw = 176;
  const gap = (W - 40 - bw * 5) / 4;
  return (
    <section className="card p-4" aria-label="Last-mile feedback loop">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="section-title">The last-mile feedback loop · live</h3>
        <span className="text-[11px] text-ink-3">every close-out makes the next dispatch more accurate</span>
      </div>
      <svg viewBox={`0 0 ${W} 150`} className="h-auto w-full" role="img">
        <defs>
          <marker id="fl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#7586AE" />
          </marker>
        </defs>
        {steps.map((st, i) => {
          const x = 20 + i * (bw + gap);
          return (
            <g key={st.k}>
              <rect x={x} y={14} width={bw} height={74} rx={10} fill="#0F1B3D" stroke={st.c} strokeWidth={1.5} />
              <circle cx={x + 20} cy={36} r={11} fill={st.c} />
              <text x={x + 20} y={40} textAnchor="middle" fontSize="12" fontWeight="800" fill="#040918">{st.k}</text>
              <text x={x + 38} y={41} fontSize="14" fontWeight="700" fill="#EEF3FF">{st.t}</text>
              <foreignObject x={x + 10} y={52} width={bw - 20} height={34}>
                <div style={{ fontSize: 11.5, lineHeight: "14px", color: "#AFBCDB" }}>{st.s}</div>
              </foreignObject>
              {i < steps.length - 1 && <line x1={x + bw + 4} y1={51} x2={x + bw + gap - 4} y2={51} stroke="#7586AE" strokeWidth={1.6} markerEnd="url(#fl-arrow)" />}
            </g>
          );
        })}
        <path
          d={`M ${20 + 4 * (bw + gap) + bw / 2} 90 L ${20 + 4 * (bw + gap) + bw / 2} 122 L ${20 + bw / 2} 122 L ${20 + bw / 2} 94`}
          fill="none"
          stroke={BRAND.healthy}
          strokeWidth={1.6}
          strokeDasharray="5 4"
          markerEnd="url(#fl-arrow)"
        />
        <text x={W / 2} y={138} textAnchor="middle" fontSize="12" fill="#AFBCDB">
          Partner findings flow back into the plant records and the repair-time model the NOC uses for the next outage
        </text>
      </svg>
    </section>
  );
}
