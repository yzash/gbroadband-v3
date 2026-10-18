"use client";

import { useState } from "react";
import { useApp } from "@/components/AppState";
import { APPROVER, canApprove, roleLabel, type ProposalKind } from "@/lib/roles";
import { personaFor } from "@/lib/personas";
import { PersonaAvatar } from "@/components/RoleSwitcher";
import { fmtHrs } from "@/lib/tokens";

interface Proposal {
  id: string;
  kind: ProposalKind;
  state: string;
  payload_json: string;
  target_element: string | null;
  vendor_id: string | null;
  decided_by_role: string | null;
}

const LADDER: { kind: ProposalKind; step: number; label: string }[] = [
  { kind: "remote_action", step: 1, label: "Remote-first" },
  { kind: "confirming_test", step: 2, label: "Confirm" },
  { kind: "dispatch", step: 3, label: "Dispatch" },
  { kind: "notification", step: 4, label: "Notify" },
  { kind: "credit", step: 5, label: "Credit" },
  { kind: "account_alert", step: 6, label: "Account heads-up" },
  { kind: "home_visit", step: 7, label: "Home visit" },
  { kind: "retention_offer", step: 8, label: "Retention offer" },
  { kind: "campaign_hold", step: 9, label: "Campaign hold" },
];

// Steps that only apply to some incidents stay hidden rather than "not needed".
const OPTIONAL = new Set<ProposalKind>(["account_alert", "home_visit", "retention_offer", "campaign_hold"]);

export function ActionLadder({
  detail,
  onChanged,
}: {
  incidentId: string;
  detail: { proposals: Record<string, unknown>[]; notifiedCount: number };
  window: number;
  onChanged: () => void;
}) {
  const proposals = detail.proposals as unknown as Proposal[];
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

  const byKind = new Map(proposals.map((p) => [p.kind, p] as const));

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="section-title">Action ladder · each step owned by a persona</h3>
        <span className="text-2xs text-ink-3">acting as <span className="text-ink-2">{personaFor(role).name} · {personaFor(role).title}</span></span>
      </div>
      {err && <div className="mb-2 rounded bg-critical/15 px-2 py-1 text-2xs text-critical">{err}</div>}
      <div className="flex flex-col gap-2">
        {LADDER.map(({ kind, step, label }) => {
          const p = byKind.get(kind);
          if (!p && OPTIONAL.has(kind)) return null;
          if (!p) return <LadderRowEmpty key={kind} step={step} label={label} />;
          const owner = personaFor(APPROVER[kind]);
          const payload = JSON.parse(p.payload_json) as Record<string, unknown>;
          const gated = canApprove(role, kind);
          const held = !!payload.held;
          return (
            <div key={kind} className="rounded-md border border-line bg-surface-2 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="chip bg-surface-3 text-ink-3">step {step}</span>
                    <span className="text-sm font-medium text-ink">{String(payload.title ?? label)}</span>
                    <StateTag state={p.state} />
                    <span className="ml-1 inline-flex items-center gap-1 text-2xs text-ink-3">
                      <PersonaAvatar p={owner} size={16} /> {owner.name.split(" ")[0]} · {owner.group}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-2">{String(payload.detail ?? "")}</div>
                  <ProposalExtra kind={kind} payload={payload} />
                </div>
                {p.state === "pending" && (
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      className="btn-primary text-xs"
                      disabled={!gated || held || busy === p.id}
                      title={held ? "held pending upstream fix" : !gated ? `Owned by ${owner.name} (${owner.title})` : ""}
                      onClick={() => decide(p.id, "approve")}
                    >
                      Approve
                    </button>
                    <button className="btn-ghost text-xs" disabled={busy === p.id} onClick={() => decide(p.id, "reject")}>
                      Reject
                    </button>
                  </div>
                )}
                {p.state !== "pending" && p.decided_by_role && (
                  <span className="shrink-0 text-2xs text-ink-3">by {roleLabel(p.decided_by_role)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProposalExtra({ kind, payload }: { kind: ProposalKind; payload: Record<string, unknown> }) {
  if (kind === "dispatch" && !payload.held) {
    return (
      <div className="mt-1 flex flex-wrap gap-3 text-2xs text-ink-3">
        <span>target <span className="font-mono text-ink-2">{String(payload.target)}</span></span>
        <span>vendor <span className="text-ink-2">{String(payload.vendorName ?? "—")}</span></span>
        <span>parts <span className="text-ink-2">{String(payload.partsHint)}</span></span>
        {typeof payload.etaHrs === "number" && <span>ETA <span className="text-ink-2">{fmtHrs(payload.etaHrs)}</span></span>}
      </div>
    );
  }
  if (kind === "notification") {
    return (
      <div className="mt-1.5 rounded bg-base p-2 text-2xs text-ink-2">
        <div className="mb-1 text-ink-3">Message preview · {String(payload.recipients)} recipients</div>
        <div className="italic">&ldquo;{String(payload.messagePreview)}&rdquo;</div>
      </div>
    );
  }
  return null;
}

function StateTag({ state }: { state: string }) {
  const map: Record<string, string> = {
    pending: "bg-watch/15 text-watch",
    approved: "bg-doctrine/15 text-doctrine",
    executed: "bg-healthy/15 text-healthy",
    rejected: "bg-critical/15 text-critical",
  };
  return <span className={`chip ${map[state] ?? "bg-surface-3 text-ink-3"}`}>{state}</span>;
}

function LadderRowEmpty({ step, label }: { step: number; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-line/60 px-3 py-2 text-2xs text-ink-3">
      <span className="chip bg-surface-2 text-ink-3">step {step}</span>
      {label} — not needed for this incident
    </div>
  );
}
