"use client";

import Link from "next/link";
import { ArrowRight, Map } from "lucide-react";
import { useApp } from "@/components/AppState";
import { PersonaAvatar } from "@/components/RoleSwitcher";
import { pctTxt, useOutcomes } from "@/components/persona/kit";
import { PERSONAS, personaFor } from "@/lib/personas";
import type { Role } from "@/lib/roles";
import type { Outcomes } from "@/lib/persona-queries";
import { pesoCompact } from "@/lib/tokens";

// Swimlanes: one outage moving through the SDAL framework and across the teams.
const LANES: Role[] = ["noc_lead", "partner", "customer_service", "cfs_tech", "sales_force", "marketing"];
const STAGES = ["Sense", "Decide", "Act", "Learn"] as const;
type Stage = (typeof STAGES)[number];

const STEPS: { n: number; lane: Role; stage: Stage; text: string }[] = [
  { n: 1, lane: "noc_lead", stage: "Sense", text: "Outage spotted from tickets + telemetry — even where sensors are dark" },
  { n: 2, lane: "noc_lead", stage: "Decide", text: "Exact element ranked with confidence; NOC approves the plan" },
  { n: 3, lane: "partner", stage: "Act", text: "Crew rolls with a brief: element, parts, customers" },
  { n: 4, lane: "customer_service", stage: "Act", text: "Cause + ETA sent to everyone affected, silent ones too" },
  { n: 5, lane: "cfs_tech", stage: "Act", text: "No home visits booked for callers in a network outage" },
  { n: 6, lane: "sales_force", stage: "Act", text: "Account managers brief business accounts before they call" },
  { n: 7, lane: "marketing", stage: "Act", text: "Campaigns paused in the city; offers for long outages" },
  { n: 8, lane: "partner", stage: "Learn", text: "Close-out: where the fault really was + record errors seen" },
  { n: 9, lane: "noc_lead", stage: "Learn", text: "Records corrected, repair-time model retrained" },
  { n: 10, lane: "customer_service", stage: "Learn", text: "Calls deflected; one accurate answer for every agent" },
  { n: 11, lane: "marketing", stage: "Learn", text: "Retention lift measured against a holdout" },
];

const W = 1120;
const LABEL_W = 190;
const COL_W = (W - LABEL_W - 16) / 4;
const BOX_W = COL_W - 30;
const BOX_H = 50;
const LANE_H = 66;
const TOP = 58;
const H = TOP + LANES.length * LANE_H + 8;

const laneY = (r: Role) => TOP + LANES.indexOf(r) * LANE_H;
const colX = (s: Stage) => LABEL_W + STAGES.indexOf(s) * COL_W + 12;
const box = (n: number) => {
  const s = STEPS.find((x) => x.n === n)!;
  const x = colX(s.stage);
  const y = laneY(s.lane) + (LANE_H - BOX_H) / 2;
  return { x, y, cx: x + BOX_W / 2, cy: y + BOX_H / 2, r: x + BOX_W, b: y + BOX_H };
};

function Dynamics() {
  const two = box(2);
  const bus = two.r + (COL_W - BOX_W) / 2;
  const fan = [3, 4, 6, 7].map(box);
  const one = box(1);
  const nine = box(9);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="How the personas hand work to each other during one outage">
      <defs>
        <marker id="pd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#8D9CC2" />
        </marker>
        <marker id="pd-arrow-g" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#1FC98E" />
        </marker>
      </defs>

      {/* Stage headers */}
      {STAGES.map((s) => (
        <text key={s} x={colX(s) + BOX_W / 2} y={22} textAnchor="middle" fontSize="12" fontWeight="800" letterSpacing="2" fill="#3CB7FF">
          {s.toUpperCase()}
        </text>
      ))}

      {/* Lanes */}
      {LANES.map((r, i) => {
        const p = personaFor(r);
        const y = laneY(r);
        return (
          <g key={r}>
            <rect x={0} y={y} width={W} height={LANE_H} fill={i % 2 ? "#0A1430" : "#0C173A"} />
            <circle cx={22} cy={y + LANE_H / 2} r={13} fill={p.color} />
            <text x={22} y={y + LANE_H / 2 + 4} textAnchor="middle" fontSize="10" fontWeight="800" fill="#040918">{p.initials}</text>
            <text x={44} y={y + LANE_H / 2 - 3} fontSize="12.5" fontWeight="700" fill="#EEF3FF">{p.group}</text>
            <text x={44} y={y + LANE_H / 2 + 13} fontSize="11" fill="#7586AE">{p.name}</text>
          </g>
        );
      })}

      {/* Loop back: what was learned sharpens the next Sense */}
      <path
        d={`M ${nine.cx} ${nine.y} V ${TOP - 12} H ${one.cx} V ${one.y - 2}`}
        fill="none"
        stroke="#1FC98E"
        strokeWidth={1.6}
        strokeDasharray="5 4"
        markerEnd="url(#pd-arrow-g)"
      />
      <text x={(one.cx + nine.cx) / 2} y={TOP - 17} textAnchor="middle" fontSize="11" fill="#1FC98E">
        the next outage starts smarter
      </text>

      {/* Hand-offs */}
      <line x1={one.r} y1={one.cy} x2={two.x - 2} y2={two.cy} stroke="#8D9CC2" strokeWidth={1.5} markerEnd="url(#pd-arrow)" />
      <path d={`M ${two.r} ${two.cy} H ${bus} V ${fan[fan.length - 1].cy}`} fill="none" stroke="#8D9CC2" strokeWidth={1.5} />
      {fan.map((f, i) => (
        <line key={i} x1={bus} y1={f.cy} x2={f.x - 2} y2={f.cy} stroke="#8D9CC2" strokeWidth={1.5} markerEnd="url(#pd-arrow)" />
      ))}
      {(() => {
        const a = box(4);
        const b = box(5);
        return <line x1={a.cx} y1={a.b} x2={b.cx} y2={b.y - 2} stroke="#8D9CC2" strokeWidth={1.5} markerEnd="url(#pd-arrow)" />;
      })()}
      {(() => {
        const a = box(3);
        const b = box(8);
        return <line x1={a.r} y1={a.cy} x2={b.x - 2} y2={b.cy} stroke="#8D9CC2" strokeWidth={1.5} markerEnd="url(#pd-arrow)" />;
      })()}
      {(() => {
        const a = box(8);
        const b = box(9);
        return <line x1={a.cx} y1={a.y} x2={b.cx} y2={b.b + 2} stroke="#FF8A3D" strokeWidth={2} markerEnd="url(#pd-arrow)" />;
      })()}
      {[[4, 10], [7, 11]].map(([s, t]) => {
        const a = box(s);
        const b = box(t);
        return <line key={s} x1={a.r} y1={a.cy} x2={b.x - 2} y2={b.cy} stroke="#8D9CC2" strokeWidth={1.5} markerEnd="url(#pd-arrow)" />;
      })}

      {/* Steps */}
      {STEPS.map((s) => {
        const b = box(s.n);
        const p = personaFor(s.lane);
        return (
          <g key={s.n}>
            <rect x={b.x} y={b.y} width={BOX_W} height={BOX_H} rx={8} fill="#132350" stroke={p.color} strokeOpacity={0.75} strokeWidth={1.2} />
            <circle cx={b.x + 14} cy={b.y + 14} r={9} fill={p.color} />
            <text x={b.x + 14} y={b.y + 17.5} textAnchor="middle" fontSize="10" fontWeight="800" fill="#040918">{s.n}</text>
            <foreignObject x={b.x + 28} y={b.y + 5} width={BOX_W - 34} height={BOX_H - 8}>
              <div style={{ fontSize: 11.5, lineHeight: "14px", color: "#EEF3FF" }}>{s.text}</div>
            </foreignObject>
          </g>
        );
      })}
    </svg>
  );
}

function liveOutcome(role: Role, o: Outcomes | null): { value: string; label: string } {
  if (!o) return { value: "—", label: "" };
  switch (role) {
    case "noc_lead":
      return { value: o.noc.correctRolls + o.noc.wrongRolls ? pctTxt(1 - o.noc.wrongRollRate) : "—", label: `right first time · ${o.noc.rollsAvoided} wasted trucks avoided` };
    case "customer_service":
      return { value: o.care.informedBeforeCall.toLocaleString(), label: `customers told before they called · ${o.care.callsDeflected} calls deflected` };
    case "sales_force":
      return { value: String(o.sales.briefedBeforeCall), label: `business accounts briefed before they called` };
    case "cfs_tech":
      return { value: o.cfs.visitsAvoided.toLocaleString(), label: "home visits avoided" };
    case "partner":
      return { value: String(o.partner.closeouts), label: `close-outs · ${o.partner.recordErrorsReported} record errors reported` };
    case "marketing":
      return {
        value: o.marketing.retentionLift == null ? "—" : `+${pctTxt(o.marketing.retentionLift)}`,
        label: `retention lift vs holdout · ${pesoCompact(o.marketing.spendProtected)} spend protected`,
      };
    default:
      return { value: "—", label: "" };
  }
}

export function PersonasClient() {
  const out = useOutcomes();
  const { setRole } = useApp();
  return (
    <div className="flex flex-col gap-4 p-5">
      <section className="card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="section-title">Persona dynamics · one outage, six teams, one framework</h3>
          <Link href="/operations" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-globe-sky hover:underline">
            <Map size={13} /> All of them work from the same live map
          </Link>
        </div>
        <Dynamics />
      </section>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {PERSONAS.map((p) => {
          const o = liveOutcome(p.role, out);
          return (
            <article key={p.role} className="card flex flex-col p-4" data-testid={`persona-${p.role}`}>
              <div className="flex items-center gap-3">
                <PersonaAvatar p={p} size={40} />
                <div className="min-w-0">
                  <div className="text-[14px] font-bold text-ink">{p.name}</div>
                  <div className="text-[12px] text-ink-2">{p.title} · {p.team}</div>
                </div>
                <div className="ml-auto flex gap-1">
                  {p.stages.map((s) => (
                    <span key={s} className="chip bg-surface-3 text-ink-3">{s}</span>
                  ))}
                </div>
              </div>
              <p className="mt-3 text-[13px] italic text-ink-2">&ldquo;{p.question}&rdquo;</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="section-title mb-1">Uses SDAL to</div>
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-[12px] text-ink-2">
                    {p.uses.map((u) => <li key={u}>{u}</li>)}
                  </ul>
                </div>
                <div>
                  <div className="section-title mb-1">Benefits</div>
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-[12px] text-ink-2">
                    {p.benefits.map((u) => <li key={u}>{u}</li>)}
                  </ul>
                </div>
              </div>
              <div className="mt-auto flex items-end justify-between gap-3 border-t border-line pt-3">
                <div>
                  <div className="font-display text-2xl font-bold tabular-nums" style={{ color: p.color }}>{o.value}</div>
                  <div className="text-[11.5px] text-ink-3">{o.label} · live</div>
                </div>
                <Link href={p.home} onClick={() => setRole(p.role)} className="btn-ghost shrink-0 text-xs">
                  Open as {p.name.split(" ")[0]} <ArrowRight size={13} />
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
