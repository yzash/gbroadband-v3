"use client";

import Link from "next/link";
import { Ban, CheckCircle2, Home, RotateCw, Wrench, XCircle } from "lucide-react";
import { ApprovalQueue, Section, SimTime, Tile, pctTxt, useLive, useOutcomes, type PendingRow } from "@/components/persona/kit";
import { FAULT_LABEL, type FaultKind } from "@/lib/types";

interface FieldData {
  jobs: { id: string; incident_id: string; target_element: string; state: string; dispatched_at: number; arrived_at: number | null; done_at: number | null; name: string | null; city: string | null }[];
  reports: { id: string; incident_id: string; root_cause: string; action_taken: string; first_time_fix: number; minutes_onsite: number; submitted_at: number }[];
  avoided: { ticket: string; opened_at: number; name: string; line_id: string; incident: string; fault_kind: string; city: string }[];
  remote: { line_id: string; incident_id: string; result: string; sim_ts: number }[];
  simMin: number;
  pending: PendingRow[];
}

export function FieldClient() {
  const out = useOutcomes();
  const [d, reload] = useLive<FieldData>("/api/field");

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Home visits avoided" value={(out?.cfs.visitsAvoided ?? 0).toLocaleString()} sub="callers in a network outage + remote fixes" tone="healthy" />
        <Tile label="Callers with a network fault" value={(out?.cfs.networkCallers ?? 0).toLocaleString()} sub="a visit would have found nothing at home" />
        <Tile label="Fixed remotely" value={String(out?.cfs.remoteFixes ?? 0)} sub="reboot worked — no technician needed" tone="sky" />
        <Tile label="Home visits done" value={String(out?.cfs.homeVisitsDone ?? 0)} sub="only home-side faults remote couldn't fix" />
        <Tile label="Fixed on first visit" value={pctTxt(out?.cfs.firstVisitFixPct)} sub="arrived with diagnostics + the right part" tone="healthy" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Section title="Your approvals · home visits (remote-first)" right={<span className="text-[11px] text-ink-3">{d?.pending.length ?? 0} pending</span>}>
            <p className="mb-2 text-[12px] text-ink-3">
              The NOC tries a remote reboot first. A home visit is proposed to you only when that fails and the fault is inside the home.
            </p>
            <ApprovalQueue rows={d?.pending ?? []} onChanged={reload} empty="No home visits needed right now." />
          </Section>

          <Section title="My visits">
            {d?.jobs.length ? (
              <div className="flex flex-col gap-1.5">
                {d.jobs.map((j) => (
                  <div key={j.id} className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2 text-[12.5px]">
                    <Home size={15} className={j.state === "done" ? "text-ink-3" : "text-healthy"} />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-ink">{j.name ?? j.target_element} <span className="font-normal text-ink-3">· {j.city}</span></div>
                      <div className="text-[11px] text-ink-3">
                        <Link href={`/incidents?id=${j.incident_id}`} className="font-mono text-doctrine hover:underline">{j.incident_id}</Link> · line {j.target_element}
                      </div>
                    </div>
                    <span className={`chip ${j.state === "done" ? "bg-surface-3 text-ink-3" : j.state === "onsite" ? "bg-healthy/15 text-healthy" : "bg-watch/15 text-watch"}`}>
                      {j.state === "enroute" ? `en route · ${Math.max(0, (j.arrived_at ?? 0) - d.simMin)} min` : j.state === "onsite" ? "on site" : "done"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[12.5px] text-ink-3">No visits booked.</div>
            )}
          </Section>

          <Section title="Visit close-outs (feed Learn)">
            {d?.reports.length ? (
              d.reports.map((r) => (
                <div key={r.id} className="border-b border-line/50 py-2 text-[12.5px] last:border-0">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-healthy" />
                    <span className="font-semibold text-ink">{r.root_cause}</span>
                    <span className="ml-auto"><SimTime t={r.submitted_at} /></span>
                  </div>
                  <div className="ml-6 text-[11.5px] text-ink-3">{r.action_taken} · {r.minutes_onsite} min on site · {r.first_time_fix ? "fixed first visit" : "re-visit needed"}</div>
                </div>
              ))
            ) : (
              <div className="text-[12.5px] text-ink-3">No home visits closed yet.</div>
            )}
          </Section>
        </div>

        <div className="flex flex-col gap-4">
          <Section title="Visits we didn't need · callers inside a network outage">
            <div className="flex max-h-[420px] flex-col gap-1 overflow-auto">
              {(d?.avoided ?? []).map((a) => (
                <div key={a.ticket} className="flex items-center gap-2.5 rounded px-2 py-1.5 text-[12.5px] hover:bg-surface-2">
                  <Ban size={14} className="shrink-0 text-critical" />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-ink">{a.name}</span> <span className="text-ink-3">· {a.city}</span>
                    <span className="block text-[11px] text-ink-3">
                      in <Link href={`/incidents?id=${a.incident}`} className="font-mono text-doctrine hover:underline">{a.incident}</Link> · {FAULT_LABEL[a.fault_kind as FaultKind]} — the fix is in the network
                    </span>
                  </span>
                  <SimTime t={a.opened_at} />
                </div>
              ))}
              {!d?.avoided.length && <div className="text-[12.5px] text-ink-3">No network-outage callers yet.</div>}
            </div>
          </Section>
          <Section title="Remote-first log">
            {(d?.remote ?? []).map((r) => (
              <div key={r.line_id + r.sim_ts} className="flex items-center gap-2 py-1 text-[12.5px]">
                {r.result.startsWith("recovered") ? <RotateCw size={14} className="text-healthy" /> : <XCircle size={14} className="text-watch" />}
                <span className="font-mono text-ink-2">{r.line_id}</span>
                <span className={r.result.startsWith("recovered") ? "text-healthy" : "text-watch"}>{r.result}</span>
                <span className="ml-auto"><SimTime t={r.sim_ts} /></span>
              </div>
            ))}
            {!d?.remote.length && <div className="text-[12.5px] text-ink-3">No remote fixes run yet.</div>}
            <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-ink-3"><Wrench size={12} /> A failed reboot is what books you a visit.</div>
          </Section>
        </div>
      </div>
    </div>
  );
}
