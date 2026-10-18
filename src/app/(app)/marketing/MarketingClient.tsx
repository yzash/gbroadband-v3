"use client";

import Link from "next/link";
import { Megaphone, PauseCircle, PlayCircle } from "lucide-react";
import { ApprovalQueue, GoLink, Section, SimTime, Tile, pctTxt, useLive, useOutcomes, type PendingRow } from "@/components/persona/kit";
import { peso, pesoCompact } from "@/lib/tokens";

interface MarketingData {
  holds: { id: string; city: string; incident_id: string; held_at: number; released_at: number | null; spend_per_day: number; protected: number }[];
  comms: { id: string; incident_id: string; kind: string; lines_count: number; before_call: number; message_template: string; sent_at: number }[];
  byKind: { kind: string; messages: number; recipients: number }[];
  atRisk: { downLong: number; vipDown: number; avgHazardDown: number };
  simMin: number;
  pending: PendingRow[];
}

const KIND: Record<string, { label: string; cls: string }> = {
  progress: { label: "Outage notice", cls: "bg-globe/40 text-globe-sky" },
  account: { label: "AM heads-up", cls: "bg-watch/15 text-watch" },
  credit: { label: "Service credit", cls: "bg-healthy/15 text-healthy" },
  offer: { label: "Retention offer", cls: "bg-record/15 text-record" },
  closure: { label: "Restored", cls: "bg-healthy/15 text-healthy" },
};

export function MarketingClient() {
  const out = useOutcomes();
  const [d, reload] = useLive<MarketingData>("/api/marketing");
  const m = out?.marketing;
  const holdsPending = (d?.pending ?? []).filter((p) => p.kind === "campaign_hold");
  const offersPending = (d?.pending ?? []).filter((p) => p.kind === "retention_offer");

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile
          label="Retention lift vs holdout"
          value={m?.retentionLift == null ? "—" : `${m.retentionLift > 0 ? "+" : ""}${pctTxt(m.retentionLift)}`}
          sub={`lower churn risk than a held-out control group (n=${m?.treatedN ?? 0}/${m?.controlN ?? 0})`}
          tone="healthy"
        />
        <Tile label="Acquisition spend protected" value={pesoCompact(m?.spendProtected ?? 0)} sub="illustrative ₱15/line/day of paid acquisition, paused where the network was down" tone="sky" />
        <Tile label="Cities on hold now" value={String(m?.holdsActive ?? 0)} sub={m?.citiesHeld.length ? m.citiesHeld.join(", ") : "all cities open for campaigns"} tone={m?.holdsActive ? "watch" : "healthy"} />
        <Tile label="Retention offers sent" value={(m?.offersSent ?? 0).toLocaleString()} sub="customers down 3h+ (holdout excluded)" tone="record" />
        <Tile label="Customer messages sent" value={(m?.messagesSent ?? 0).toLocaleString()} sub="notices, updates, credits, offers, restored" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Section title="Acquisition · campaign guardrail" right={<GoLink href="/operations?lens=market">Sell / hold map</GoLink>}>
          <p className="mb-2 text-[12px] text-ink-3">Don&rsquo;t pay to acquire customers into an outage. SDAL proposes a hold when 3%+ of a city is down, and releases it on restore.</p>
          <ApprovalQueue rows={holdsPending} onChanged={reload} empty="No cities need a campaign hold right now." />
          <div className="mt-3 flex flex-col gap-1">
            {(d?.holds ?? []).map((h) => (
              <div key={h.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-[12.5px] hover:bg-surface-2">
                {h.released_at === null ? <PauseCircle size={15} className="text-watch" /> : <PlayCircle size={15} className="text-healthy" />}
                <span className="font-semibold text-ink">{h.city}</span>
                <span className="text-[11px] text-ink-3">
                  {h.released_at === null ? "paused now" : "resumed"} · {peso(h.spend_per_day)}/day
                </span>
                <span className="ml-auto text-[12px] font-semibold tabular-nums text-globe-sky">{pesoCompact(h.protected)} saved</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Base management · keep the customers we have">
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Mini label="Down 3h+ now" value={String(d?.atRisk.downLong ?? 0)} />
            <Mini label="VIP / business down" value={String(d?.atRisk.vipDown ?? 0)} />
            <Mini label="Avg churn risk (down)" value={pctTxt(d?.atRisk.avgHazardDown ?? 0, 1)} />
          </div>
          <ApprovalQueue rows={offersPending} onChanged={reload} empty="No long outages need a retention offer right now." />
          <p className="mt-2 text-[11.5px] text-ink-3">
            10% of customers are a holdout: they get no proactive messages or offers, so the lift above is measured, not assumed.
          </p>
        </Section>

        <Section title="Comms · one brand voice through the outage">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(d?.byKind ?? []).map((k) => (
              <span key={k.kind} className={`chip ${KIND[k.kind]?.cls ?? "bg-surface-3 text-ink-3"}`}>
                {KIND[k.kind]?.label ?? k.kind} · {k.recipients.toLocaleString()}
              </span>
            ))}
          </div>
          <div className="flex max-h-[420px] flex-col gap-1.5 overflow-auto">
            {(d?.comms ?? []).map((c) => (
              <div key={c.id} className="rounded-md bg-surface-2 px-2.5 py-2 text-[12px]">
                <div className="flex items-center gap-2">
                  <Megaphone size={13} className="text-globe-sky" />
                  <span className={`chip ${KIND[c.kind]?.cls ?? ""}`}>{KIND[c.kind]?.label ?? c.kind}</span>
                  <span className="text-ink-2">{c.lines_count.toLocaleString()} customers</span>
                  <Link href={`/incidents?id=${c.incident_id}`} className="font-mono text-[11px] text-doctrine hover:underline">{c.incident_id}</Link>
                  <span className="ml-auto"><SimTime t={c.sent_at} /></span>
                </div>
                <div className="mt-1 line-clamp-2 italic text-ink-3">&ldquo;{c.message_template}&rdquo;</div>
              </div>
            ))}
            {!d?.comms.length && <div className="text-[12.5px] text-ink-3">No messages sent yet.</div>}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-2 px-2.5 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-3">{label}</div>
      <div className="font-display text-lg font-bold tabular-nums text-ink">{value}</div>
    </div>
  );
}
