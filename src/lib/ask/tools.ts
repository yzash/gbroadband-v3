import { getDb } from "../db";
import { getIncidentDetail, listIncidents } from "../incident-queries";
import { peso, pesoCompact, fmtHrs } from "../tokens";
import { FAULT_LABEL, type FaultKind } from "../types";

// ---- Incident-centric tools (read-only) ----

export function query_incidents(): { text: string; rows: Record<string, unknown>[] } {
  const rows = listIncidents();
  if (rows.length === 0) return { text: "No open incidents right now.", rows: [] };
  const lines = rows
    .slice(0, 8)
    .map(
      (r, i) =>
        `${i + 1}. **${r.id}** — ${FAULT_LABEL[(r.fault_kind as FaultKind) ?? "noise"] ?? r.fault_kind} at ${r.top_suspect} · ${
          (r.observed_count as number) + (r.inferred_count as number)
        } lines · ${pesoCompact(r.peso_exposure as number)} exposure · MTTR p50 ${fmtHrs((r.predicted_mttr_p50 as number) || 0)}`
    )
    .join("\n");
  return { text: lines, rows };
}

export function get_incident(id: string) {
  const d = getIncidentDetail(id);
  if (!d) return { text: `No incident ${id}.`, data: null };
  const inc = d.incident as Record<string, unknown>;
  return {
    text: `**${id}** — ${FAULT_LABEL[(inc.fault_kind as FaultKind) ?? "noise"] ?? inc.fault_kind} · state ${inc.state} · suspect ${inc.top_suspect} (${Math.round(
      (inc.top_confidence as number) * 100
    )}%) · ${inc.observed_count}/${(inc.observed_count as number) + (inc.inferred_count as number)} observed · ${pesoCompact(
      inc.peso_exposure as number
    )} exposure · ETA ${fmtHrs((inc.eta_hrs as number) || 0)}`,
    data: inc,
  };
}

export function get_blast_radius(id: string) {
  const d = getIncidentDetail(id);
  if (!d) return { text: `No incident ${id}.`, data: null };
  const inc = d.incident as Record<string, unknown>;
  const obs = inc.observed_count as number;
  const inf = inc.inferred_count as number;
  return {
    text: `**${id}** impacts ${obs + inf} lines — only **${obs} have called or shown telemetry**; **${inf} are silent (inferred)**. ${inc.vip_count} VIP / ${inc.b2b_count} B2B. Σ exposure ${peso(
      inc.peso_exposure as number
    )}/mo.`,
    data: { observed: obs, inferred: inf, vip: inc.vip_count, b2b: inc.b2b_count, exposure: inc.peso_exposure },
  };
}

export function get_isolation(id: string) {
  const d = getIncidentDetail(id);
  if (!d || d.suspicions.length === 0) return { text: `No isolation for ${id} yet.`, data: null };
  const top = d.suspicions[0];
  const second = d.suspicions[1];
  let text = `We rank **${top.element_id}** at ${Math.round(top.confidence * 100)}% — ${top.evidence.text}.`;
  if (second) text += `\n\nRunner-up **${second.element_id}** at ${Math.round(second.confidence * 100)}% — ${second.evidence.text}.`;
  if (top.record_conflict) text += `\n\n⚠ Plant records conflict here, so confidence is held lower and a confirming test is recommended: \`${inc(d).confirming_test ?? "OTDR"}\`.`;
  return { text, data: d.suspicions };
}

function inc(d: NonNullable<ReturnType<typeof getIncidentDetail>>): Record<string, unknown> {
  return d.incident as Record<string, unknown>;
}

export function ops_snapshot() {
  const db = getDb();
  const totalLines = (db.prepare("SELECT COUNT(*) n FROM topology_truth WHERE kind='ont'").get() as { n: number }).n;
  const polled = (db.prepare("SELECT COUNT(*) n FROM sensing WHERE polled=1").get() as { n: number }).n;
  const openTickets = (db.prepare("SELECT COUNT(*) n FROM tickets WHERE closed_at IS NULL").get() as { n: number }).n;
  const openInc = (db.prepare("SELECT COUNT(*) n FROM incidents WHERE state NOT IN ('resolved')").get() as { n: number }).n;
  const exposure = (db.prepare("SELECT COALESCE(SUM(peso_exposure),0) s FROM incidents WHERE state NOT IN ('resolved')").get() as { s: number }).s;
  return {
    text: `Network: ${totalLines.toLocaleString()} lines, ${Math.round((polled / totalLines) * 100)}% actively sensed. ${openInc} open incidents, ${openTickets} open tickets, ${pesoCompact(
      exposure
    )} total exposure.`,
    data: { totalLines, polled, openTickets, openInc, exposure },
  };
}

export function draft_proposal(id: string, kind: "notification" | "dispatch"): { text: string; card: Record<string, unknown> | null } {
  const d = getIncidentDetail(id);
  if (!d) return { text: `No incident ${id}.`, card: null };
  const inc0 = d.incident as Record<string, unknown>;
  if (kind === "notification") {
    const eta = (inc0.eta_hrs as number) || (inc0.predicted_mttr_p50 as number) || 2;
    const window = eta >= 1 ? `${eta.toFixed(1)} hours` : `${Math.round(eta * 60)} minutes`;
    const msg = `We've detected an issue affecting your area and our team is already on it. We estimate service will be restored within ~${window}. We'll let you know the moment it's fixed. — Globe Broadband`;
    return {
      text: `Draft customer notification for **${id}** (${(inc0.observed_count as number) + (inc0.inferred_count as number)} recipients). *Draft only — approve in Approvals & Audit to send.*`,
      card: { type: "notification", incident: id, recipients: (inc0.observed_count as number) + (inc0.inferred_count as number), message: msg, eta_hrs: eta },
    };
  }
  return {
    text: `Draft dispatch for **${id}** to ${inc0.top_suspect}. *Draft only — approve in Approvals & Audit to execute.*`,
    card: { type: "dispatch", incident: id, target: inc0.top_suspect, vendor: (inc0 as { vendor_name?: string }).vendor_name ?? inc0.vendor_id },
  };
}

// ---- run_sql: read-only single SELECT with a blocklist + LIMIT cap ----

const BLOCK = /\b(insert|update|delete|drop|alter|attach|detach|pragma|create|replace|vacuum|reindex|begin|commit)\b/i;

export function run_sql(sql: string): { ok: boolean; rows?: Record<string, unknown>[]; error?: string; sql: string } {
  let q = sql.trim().replace(/;+\s*$/, "");
  if (!/^select\b/i.test(q)) return { ok: false, error: "Only a single read-only SELECT is allowed.", sql: q };
  if (q.includes(";")) return { ok: false, error: "Multiple statements are not allowed.", sql: q };
  if (BLOCK.test(q)) return { ok: false, error: "Query contains a blocked keyword.", sql: q };
  if (!/\blimit\s+\d+/i.test(q)) q += " LIMIT 200";
  try {
    const db = getDb();
    const stmt = db.prepare(q);
    if (!stmt.reader) return { ok: false, error: "Query does not return rows.", sql: q };
    const rows = stmt.all() as Record<string, unknown>[];
    return { ok: true, rows: rows.slice(0, 200), sql: q };
  } catch (e) {
    return { ok: false, error: (e as Error).message, sql: q };
  }
}
