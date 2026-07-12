"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/AppState";
import { canApprove, type ProposalKind } from "@/lib/roles";
import { fmtSimTime, pesoCompact } from "@/lib/tokens";

interface Pending {
  id: string;
  incident_id: string;
  kind: ProposalKind;
  payload_json: string;
  fault_kind: string | null;
  top_suspect: string | null;
  peso_exposure: number;
}
interface AuditRow {
  id: number;
  sim_ts: number;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  detail_json: string;
}

export function ProposalsClient() {
  const { role, snapshot } = useApp();
  const [pending, setPending] = useState<Pending[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/proposals", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        setPending(j.pending);
        setAudit(j.audit);
      }
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, snapshot?.generated_at]);

  const decide = async (id: string, decision: "approve" | "reject") => {
    setBusy(id);
    try {
      await fetch(`/api/proposals/${id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, role }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">
      {/* Pending approvals */}
      <section>
        <h3 className="section-title mb-2">Pending approvals · {pending.length}</h3>
        <div className="flex flex-col gap-2">
          {pending.length === 0 && <div className="card-2 p-4 text-sm text-ink-3">No proposals awaiting approval.</div>}
          {pending.map((p) => {
            const payload = JSON.parse(p.payload_json) as Record<string, unknown>;
            const gated = canApprove(role, p.kind);
            const held = !!payload.held;
            return (
              <div key={p.id} className="card-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="chip bg-surface-3 text-ink-3">{p.kind.replace("_", " ")}</span>
                      <Link href={`/incidents?id=${p.incident_id}`} className="font-mono text-xs text-doctrine hover:underline">
                        {p.incident_id}
                      </Link>
                      <span className="text-2xs text-ink-3">{p.top_suspect}</span>
                      <span className="text-2xs text-degraded">{pesoCompact(p.peso_exposure)}</span>
                    </div>
                    <div className="mt-0.5 text-sm text-ink">{String(payload.title ?? "")}</div>
                    <div className="text-2xs text-ink-3">{String(payload.detail ?? "")}</div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      className="btn-primary text-xs"
                      disabled={!gated || held || busy === p.id}
                      title={held ? "held pending upstream fix" : !gated ? `${role} can't approve this` : ""}
                      onClick={() => decide(p.id, "approve")}
                    >
                      Approve
                    </button>
                    <button className="btn-ghost text-xs" disabled={busy === p.id} onClick={() => decide(p.id, "reject")}>
                      Reject
                    </button>
                  </div>
                </div>
                {!gated && <div className="mt-1 text-2xs text-watch">Requires a different role to approve.</div>}
              </div>
            );
          })}
        </div>
      </section>

      {/* Audit trail */}
      <section>
        <h3 className="section-title mb-2">Audit trail</h3>
        <div className="card-2 max-h-[70vh] overflow-auto p-2">
          <ol className="flex flex-col gap-1">
            {audit.map((a) => {
              const detail = safeParse(a.detail_json);
              return (
                <li key={a.id} className="flex items-start gap-2 border-b border-line/40 px-2 py-1.5 text-2xs last:border-0">
                  <span className="font-mono text-ink-3">{fmtSimTime(a.sim_ts)}</span>
                  <span className="chip bg-surface-3 text-ink-3">{a.actor_role}</span>
                  <span className="text-ink-2">
                    <span className={a.action === "reject" ? "text-critical" : "text-healthy"}>{a.action}</span>{" "}
                    {a.entity_type} <span className="font-mono">{a.entity_id}</span>
                    {detail?.kind ? ` · ${String(detail.kind).replace("_", " ")}` : ""}
                    {detail?.target ? ` → ${detail.target}` : ""}
                  </span>
                </li>
              );
            })}
            {audit.length === 0 && <li className="px-2 py-3 text-ink-3">No actions yet.</li>}
          </ol>
        </div>
      </section>
    </div>
  );
}

function safeParse(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
