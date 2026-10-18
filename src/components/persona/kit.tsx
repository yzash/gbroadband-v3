"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useApp } from "@/components/AppState";
import { PersonaAvatar } from "@/components/RoleSwitcher";
import { personaFor } from "@/lib/personas";
import { APPROVER, PROPOSAL_LABEL, ROLE_LABEL, canApprove, type ProposalKind, type Role } from "@/lib/roles";
import { fmtSimTime, pesoCompact } from "@/lib/tokens";
import type { Outcomes } from "@/lib/persona-queries";

/** Fetch a JSON read model and refresh it on every engine tick. */
export function useLive<T>(url: string | null): [T | null, () => Promise<void>] {
  const { snapshot } = useApp();
  const [data, setData] = useState<T | null>(null);
  const load = useCallback(async () => {
    if (!url) return;
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch {
      /* transient */
    }
  }, [url]);
  // Every publish (ticks and decisions alike) brings a new snapshot object —
  // refresh on that, not on sim time, so approvals show up while paused.
  useEffect(() => {
    load();
  }, [load, snapshot]);
  return [data, load];
}

export function useOutcomes(): Outcomes | null {
  return useLive<Outcomes>("/api/outcomes")[0];
}

/** Workspace header: whose job this screen serves and the question they bring. */
export function PersonaHeader({ role, stage }: { role: Role; stage: string }) {
  const p = personaFor(role);
  const { role: acting, setRole } = useApp();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-surface/40 px-6 py-4">
      <div className="flex items-center gap-4">
        <PersonaAvatar p={p} size={44} />
        <div>
          <div className="mb-0.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-globe-sky">{stage}</div>
          <h1 className="font-display text-xl font-bold tracking-tight text-ink">
            {p.team} <span className="font-sans text-base font-semibold text-ink-2">· {p.name}, {p.title}</span>
          </h1>
          <p className="mt-0.5 text-[13px] italic text-ink-2">&ldquo;{p.question}&rdquo;</p>
        </div>
      </div>
      {acting !== role ? (
        <button className="btn-ghost text-xs" onClick={() => setRole(role)} data-testid="act-as">
          <PersonaAvatar p={p} size={18} /> Act as {p.name.split(" ")[0]}
        </button>
      ) : (
        <span className="flex items-center gap-1.5 text-xs font-semibold text-healthy">
          <CheckCircle2 size={14} /> Acting as {p.name.split(" ")[0]}
        </span>
      )}
    </div>
  );
}

export function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "healthy" | "watch" | "critical" | "sky" | "record";
}) {
  const c = { healthy: "text-healthy", watch: "text-watch", critical: "text-critical", sky: "text-globe-sky", record: "text-record" }[tone ?? "sky"];
  return (
    <div className="card px-4 py-3">
      <div className="kpi-label">{label}</div>
      <div className={`mt-1 font-display text-[26px] font-bold leading-none tabular-nums ${tone ? c : "text-ink"}`}>{value}</div>
      {sub && <div className="mt-1.5 text-[11.5px] leading-snug text-ink-3">{sub}</div>}
    </div>
  );
}

export function Section({ title, right, children, className = "" }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="section-title">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export interface PendingRow {
  id: string;
  incident_id: string;
  kind: ProposalKind;
  payload_json: string;
  created_at: number;
  fault_kind: string | null;
  peso_exposure: number;
}

/** A persona's approval queue — the decisions SDAL proposes and they own. */
export function ApprovalQueue({ rows, onChanged, empty }: { rows: PendingRow[]; onChanged: () => void; empty: string }) {
  const { role } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const decide = async (id: string, decision: "approve" | "reject") => {
    setBusy(id);
    setErr(null);
    try {
      const r = await fetch(`/api/proposals/${id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, role }),
      });
      const j = await r.json();
      if (!j.ok) setErr(j.error ?? "failed");
      onChanged();
    } finally {
      setBusy(null);
    }
  };
  if (!rows.length) return <div className="rounded-md border border-dashed border-line px-3 py-4 text-center text-[12.5px] text-ink-3">{empty}</div>;
  return (
    <div className="flex flex-col gap-2">
      {err && <div className="rounded bg-critical/15 px-2 py-1 text-2xs text-critical">{err}</div>}
      {rows.map((p) => {
        const pl = JSON.parse(p.payload_json) as Record<string, unknown>;
        const gated = canApprove(role, p.kind);
        return (
          <div key={p.id} className="rounded-md border border-line bg-surface-2 p-3" data-testid={`pending-${p.kind}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip bg-globe/40 text-globe-sky">{PROPOSAL_LABEL[p.kind]}</span>
                  <Link href={`/incidents?id=${p.incident_id}`} className="font-mono text-[11px] text-doctrine hover:underline">
                    {p.incident_id}
                  </Link>
                  {p.peso_exposure > 0 && <span className="text-[11px] text-degraded">{pesoCompact(p.peso_exposure)}/mo at risk</span>}
                </div>
                <div className="mt-1 text-[13.5px] font-semibold text-ink">{String(pl.title ?? "")}</div>
                <div className="text-[12px] text-ink-2">{String(pl.detail ?? "")}</div>
                {typeof pl.brief === "string" && <div className="mt-1 text-[11.5px] text-ink-3">{pl.brief}</div>}
                {typeof pl.messagePreview === "string" && (
                  <div className="mt-1.5 rounded bg-base px-2 py-1.5 text-[11.5px] italic text-ink-2">&ldquo;{pl.messagePreview}&rdquo;</div>
                )}
                {Array.isArray(pl.names) && pl.names.length > 0 && (
                  <div className="mt-1 text-[11.5px] text-ink-3">Starting with {(pl.names as string[]).join(", ")}</div>
                )}
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  className="btn-primary text-xs"
                  disabled={!gated || busy === p.id}
                  title={!gated ? `Only ${ROLE_LABEL[APPROVER[p.kind]]} approves this` : ""}
                  onClick={() => decide(p.id, "approve")}
                >
                  Approve
                </button>
                <button className="btn-ghost text-xs" disabled={!gated || busy === p.id} onClick={() => decide(p.id, "reject")}>
                  Reject
                </button>
              </div>
            </div>
            {!gated && <div className="mt-1.5 text-[11px] text-watch">Owned by {ROLE_LABEL[APPROVER[p.kind]]} — switch persona to approve.</div>}
          </div>
        );
      })}
    </div>
  );
}

export function GoLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-[12px] font-semibold text-globe-sky hover:underline">
      {children} <ArrowRight size={12} />
    </Link>
  );
}

export function SimTime({ t }: { t: number }) {
  return <span className="font-mono text-[11px] tabular-nums text-ink-3">{fmtSimTime(t)}</span>;
}

export const pctTxt = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`);
