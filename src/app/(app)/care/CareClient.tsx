"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Ban, BadgeCheck, Building2, Clock, Crown, Headset, Search, Truck, Wrench } from "lucide-react";
import { ApprovalQueue, Section, SimTime, Tile, pctTxt, useLive, useOutcomes, type PendingRow } from "@/components/persona/kit";
import { FAULT_LABEL, type FaultKind } from "@/lib/types";
import { fmtHrs, peso } from "@/lib/tokens";
import type { CallerAnswer } from "@/lib/persona-queries";

interface Caller {
  ticket: string;
  opened_at: number;
  kind: string;
  name: string;
  line_id: string;
  b2b: number;
  vip: number;
  incident: string | null;
  fault_kind: string | null;
  status: string;
}
interface CareData {
  callers: Caller[];
  matches: { id: string; name: string; line_id: string; b2b: number; status: string }[];
  answer: CallerAnswer | null;
  pending: PendingRow[];
}

export function CareClient() {
  const out = useOutcomes();
  const [line, setLine] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (line) p.set("line", line);
    if (term.trim().length >= 2) p.set("q", term.trim());
    return `/api/care?${p.toString()}`;
  }, [line, term]);
  const [d, reload] = useLive<CareData>(url);

  // Start on the most recent caller who is inside a known outage.
  useEffect(() => {
    if (!line && d?.callers.length) {
      const first = d.callers.find((c) => c.incident && c.fault_kind !== "cpe_issue") ?? d.callers[0];
      setLine(first.line_id);
    }
  }, [d, line]);

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Calls deflected" value={(out?.care.callsDeflected ?? 0).toLocaleString()} sub="customers we told first, who then didn't call" tone="healthy" />
        <Tile label="Told before they called" value={(out?.care.informedBeforeCall ?? 0).toLocaleString()} sub="proactive cause + ETA, incl. silent customers" tone="healthy" />
        <Tile label="Callers with a known cause" value={pctTxt(out?.care.knownCausePct)} sub={`of ${out?.care.openTickets ?? 0} open tickets, answer is on screen`} tone="sky" />
        <Tile label="Duplicate tickets merged" value={(out?.care.dupMerged ?? 0).toLocaleString()} sub="clustered to one root cause" />
        <Tile label="User-side tickets flagged" value={(out?.care.userSideFlagged ?? 0).toLocaleString()} sub="not a network fault — no truck, no visit" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[380px_1fr]">
        <Section
          title="Callers right now"
          right={<span className="text-[11px] text-ink-3">{d?.callers.length ?? 0} open</span>}
        >
          <label className="mb-2 flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5">
            <Search size={14} className="text-ink-3" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Look up a caller — name or line ID"
              className="w-full bg-transparent text-[13px] text-ink placeholder:text-ink-3"
              aria-label="Look up a caller"
            />
          </label>
          {term.trim().length >= 2 && (
            <div className="mb-2 flex flex-col gap-1">
              {d?.matches.length ? (
                d.matches.map((m) => (
                  <button key={m.id} onClick={() => { setLine(m.line_id); setTerm(""); }} className="flex items-center justify-between rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-2">
                    <span className="text-ink">{m.name}</span>
                    <span className="font-mono text-[11px] text-ink-3">{m.line_id} · {m.status}</span>
                  </button>
                ))
              ) : (
                <div className="px-2 py-1 text-[12px] text-ink-3">No match.</div>
              )}
            </div>
          )}
          <div className="flex max-h-[520px] flex-col gap-1 overflow-auto">
            {d?.callers.map((c) => {
              const on = c.line_id === line;
              return (
                <button
                  key={c.ticket}
                  onClick={() => setLine(c.line_id)}
                  className={["flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left", on ? "bg-globe/40 ring-1 ring-globe-sky/40" : "hover:bg-surface-2"].join(" ")}
                  data-testid="caller-row"
                >
                  <Headset size={15} className={on ? "text-globe-sky" : "text-ink-3"} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                      <span className="truncate">{c.name}</span>
                      {!!c.b2b && <Building2 size={12} className="text-watch" />}
                      {!!c.vip && <Crown size={12} className="text-watch" />}
                    </span>
                    <span className="block truncate text-[11px] text-ink-3">
                      {c.kind === "invalid" ? "User-side — line healthy" : c.incident ? `${c.incident} · ${c.fault_kind ? FAULT_LABEL[c.fault_kind as FaultKind] : "investigating"}` : "Correlating…"}
                    </span>
                  </span>
                  <SimTime t={c.opened_at} />
                </button>
              );
            })}
          </div>
        </Section>

        <div className="flex flex-col gap-4">
          {d?.answer ? <AnswerCard a={d.answer} /> : <Section title="Caller answer"><div className="text-sm text-ink-3">Pick a caller.</div></Section>}
          <Section title="Your approvals · customer notices & credits" right={<span className="text-[11px] text-ink-3">{d?.pending.length ?? 0} pending</span>}>
            <ApprovalQueue rows={d?.pending ?? []} onChanged={reload} empty="No notices or credits waiting. New outages will queue a cause-and-ETA notice here." />
          </Section>
        </div>
      </div>
    </div>
  );
}

function AnswerCard({ a }: { a: CallerAnswer }) {
  const s = a.subscriber;
  const tone = a.status === "online" ? "text-healthy bg-healthy/15" : a.status === "degraded" ? "text-degraded bg-degraded/15" : "text-critical bg-critical/15";
  const network = a.incident && !a.incident.homeSide;
  return (
    <section className="card overflow-hidden" data-testid="caller-answer">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-2 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display text-lg font-bold text-ink">{s.name}</span>
            {s.b2b && <span className="chip bg-watch/15 text-watch"><Building2 size={11} /> Business</span>}
            {s.vip && <span className="chip bg-watch/15 text-watch"><Crown size={11} /> VIP</span>}
          </div>
          <div className="text-[12px] text-ink-3">
            <span className="font-mono">{s.line_id}</span> · {s.district}, {s.city} · {peso(s.arpu)}/mo · {s.tenure_days >= 365 ? `${Math.round(s.tenure_days / 365)} yrs` : `${Math.max(1, Math.round(s.tenure_days / 30))} months`} with Globe
          </div>
        </div>
        <span className={`chip ${tone}`}>{a.status}{a.downHrs > 0 ? ` · ${fmtHrs(a.downHrs)}` : ""}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2.5">
          <div className="section-title">What we already know</div>
          {a.incident ? (
            <>
              <Fact label="Known outage">
                <Link href={`/incidents?id=${a.incident.id}`} className="font-mono text-doctrine hover:underline">{a.incident.id}</Link>
                {" · "}
                {a.incident.fault_kind ? FAULT_LABEL[a.incident.fault_kind as FaultKind] : "investigating"}
              </Fact>
              <Fact label="Cause (customer words)">{a.incident.cause}</Fact>
              <Fact label="Crew">
                {a.incident.crew ? (
                  <span className="inline-flex items-center gap-1.5">
                    {a.incident.crew.who === "CFS technician" ? <Wrench size={13} className="text-healthy" /> : <Truck size={13} className="text-watch" />}
                    {a.incident.crew.who} · {a.incident.crew.state === "onsite" ? "on site now" : `${a.incident.crew.eta_min} min away`}
                  </span>
                ) : (
                  "awaiting dispatch approval"
                )}
              </Fact>
              <Fact label="Restore ETA">{a.incident.etaHrs ? fmtHrs(a.incident.etaHrs) : "—"}</Fact>
              <Fact label="Proactively notified">{a.notifiedAt !== null ? <span className="text-healthy">Yes — already told cause + ETA</span> : <span className="text-watch">Not yet</span>}</Fact>
            </>
          ) : (
            <Fact label="Known outage">{a.status === "online" ? "None — line healthy" : "Correlating signals…"}</Fact>
          )}
          {a.creditEligible && <Fact label="Credit">Past the repair window — eligible for a service credit</Fact>}
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="section-title">What to say</div>
          <blockquote className="rounded-md border-l-4 border-globe-sky bg-globe/20 px-3 py-2.5 text-[14px] leading-relaxed text-ink">{a.script}</blockquote>
          <ul className="flex flex-col gap-1.5">
            {a.guidance.map((g) => (
              <li key={g} className="flex items-start gap-2 text-[12.5px] text-ink-2">
                {g.startsWith("Network-side") ? (
                  <Ban size={14} className="mt-0.5 shrink-0 text-critical" />
                ) : g.startsWith("Not yet") || g.startsWith("Past the") ? (
                  <Clock size={14} className="mt-0.5 shrink-0 text-watch" />
                ) : (
                  <BadgeCheck size={14} className="mt-0.5 shrink-0 text-healthy" />
                )}
                {g}
              </li>
            ))}
          </ul>
          {network && (
            <div className="mt-1 inline-flex w-fit items-center gap-2 rounded-md bg-critical/12 px-2.5 py-1.5 text-[12px] font-semibold text-critical">
              <Ban size={14} /> No home visit — the fault is in the network, not the home
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-[13px]">
      <span className="w-36 shrink-0 text-ink-3">{label}</span>
      <span className="text-ink">{children}</span>
    </div>
  );
}
