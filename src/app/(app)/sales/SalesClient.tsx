"use client";

import Link from "next/link";
import { Building2, Crown, PhoneCall, PhoneOff } from "lucide-react";
import { useApp } from "@/components/AppState";
import { ApprovalQueue, GoLink, Section, Tile, useLive, useOutcomes, type PendingRow } from "@/components/persona/kit";
import { FAULT_LABEL, type FaultKind } from "@/lib/types";
import { fmtHrs, pesoCompact } from "@/lib/tokens";
import { SellChip } from "@/components/persona/SellChip";

interface Account {
  name: string;
  line_id: string;
  vip: number;
  b2b: number;
  arpu: number;
  city: string;
  incident_id: string;
  hours_down: number;
  ticketed: number;
  notified_at: number | null;
  fault_kind: string | null;
  state: string;
  eta: number | null;
  briefed: number | null;
}

export function SalesClient() {
  const { snapshot } = useApp();
  const out = useOutcomes();
  const [d, reload] = useLive<{ accounts: Account[]; pending: PendingRow[] }>("/api/sales");
  const cities = Object.entries(snapshot?.city_stats ?? {}).sort(
    (a, b) => ["hold", "care", "sell"].indexOf(a[1].sell) - ["hold", "care", "sell"].indexOf(b[1].sell) || b[1].impacted - a[1].impacted
  );
  const holdCount = cities.filter(([, c]) => c.sell === "hold").length;

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Business accounts hit now" value={String(out?.sales.accountsAffected ?? 0)} sub="inside an active outage" tone="critical" />
        <Tile label="Briefed by their AM" value={String(out?.sales.accountsBriefed ?? 0)} sub="personal heads-up with cause + ETA" tone="healthy" />
        <Tile label="Briefed before they called" value={String(out?.sales.briefedBeforeCall ?? 0)} sub="heard it from us first" tone="healthy" />
        <Tile label="Business revenue at risk" value={pesoCompact(out?.sales.b2bPesoAtRisk ?? 0)} sub="monthly, accounts down now" tone="watch" />
        <Tile label="Cities to hold selling" value={String(holdCount)} sub={`of ${cities.length} NCR cities · see the map`} tone={holdCount ? "watch" : "healthy"} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_420px]">
        <Section title="My accounts affected" right={<span className="text-[11px] text-ink-3">{d?.accounts.length ?? 0} business & VIP lines</span>}>
          <div className="max-h-[560px] overflow-auto rounded-md border border-line">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-surface-2 text-left text-[10.5px] uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">City</th>
                  <th className="px-3 py-2">Outage</th>
                  <th className="px-3 py-2 text-right">Down</th>
                  <th className="px-3 py-2 text-right">ETA</th>
                  <th className="px-3 py-2">Account manager</th>
                </tr>
              </thead>
              <tbody>
                {(d?.accounts ?? []).map((a) => (
                  <tr key={a.line_id + a.incident_id} className="border-t border-line/60">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 font-semibold text-ink">
                        {a.b2b ? <Building2 size={13} className="text-watch" /> : <Crown size={13} className="text-watch" />}
                        {a.name}
                      </div>
                      <div className="text-[11px] text-ink-3">{pesoCompact(a.arpu)}/mo</div>
                    </td>
                    <td className="px-3 py-2 text-ink-2">{a.city}</td>
                    <td className="px-3 py-2">
                      <Link href={`/incidents?id=${a.incident_id}`} className="font-mono text-[11.5px] text-doctrine hover:underline">{a.incident_id}</Link>
                      <div className="text-[11px] text-ink-3">{a.fault_kind ? FAULT_LABEL[a.fault_kind as FaultKind] : "investigating"}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-2">{fmtHrs(a.hours_down)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-2">{a.eta ? fmtHrs(a.eta) : "—"}</td>
                    <td className="px-3 py-2">
                      {a.briefed && a.b2b ? (
                        <span className="chip bg-healthy/15 text-healthy">Briefed{a.ticketed ? "" : " · before they called"}</span>
                      ) : a.ticketed ? (
                        <span className="chip bg-critical/15 text-critical"><PhoneCall size={11} /> Called the hotline</span>
                      ) : (
                        <span className="chip bg-watch/15 text-watch"><PhoneOff size={11} /> Hasn't called — brief now</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!d?.accounts.length && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-ink-3">No business or VIP accounts affected right now.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="flex flex-col gap-4">
          <Section title="Your approvals · account heads-ups" right={<span className="text-[11px] text-ink-3">{d?.pending.length ?? 0} pending</span>}>
            <ApprovalQueue rows={d?.pending ?? []} onChanged={reload} empty="No business accounts to brief right now." />
          </Section>
          <Section title="Where to sell this week" right={<GoLink href="/operations?lens=market">On the map</GoLink>}>
            <div className="flex max-h-[380px] flex-col gap-1 overflow-auto">
              {cities.map(([city, c]) => (
                <div key={city} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12.5px] hover:bg-surface-2">
                  <span className="font-semibold text-ink">{city}</span>
                  <span className="ml-auto text-[11px] text-ink-3">
                    {c.impacted ? `${c.impacted} down · ` : ""}
                    {Math.round(c.record_conf * 100)}% records
                  </span>
                  <SellChip v={c.sell} held={c.campaign_hold} />
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
