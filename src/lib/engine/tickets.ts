import type { DB } from "../db";
import type { RNG } from "../rng";

let ticketSeq = 0;
export function resetTicketSeq(db: DB) {
  const row = db.prepare("SELECT COUNT(*) n FROM tickets").get() as { n: number };
  ticketSeq = row.n;
}
function newTicketId(): string {
  ticketSeq++;
  return `TKT-${String(ticketSeq).padStart(5, "0")}`;
}

interface SubInfo {
  line_id: string;
  subscriber_id: string;
  propensity: number;
}

/**
 * Ticketing pass over currently-impacted lines. Subscribers call stochastically
 * based on calling propensity; notified subscribers largely stop calling
 * (deflection). Returns counts for KPIs / Learn.
 */
export function ticketingPass(
  db: DB,
  rng: RNG,
  simMin: number,
  minutes: number,
  impacted: Map<string, { status: "offline" | "degraded" }>
): { opened: number; deflected: number; invalid: number } {
  let opened = 0;
  let deflected = 0;
  let invalid = 0;

  const openByLine = new Set(
    (db.prepare("SELECT DISTINCT line_id FROM tickets WHERE closed_at IS NULL").all() as { line_id: string }[]).map(
      (r) => r.line_id
    )
  );
  const notifiedLines = new Set(
    (
      db
        .prepare("SELECT DISTINCT line_id FROM blast_radius WHERE notified_at IS NOT NULL")
        .all() as { line_id: string }[]
    ).map((r) => r.line_id)
  );

  const subByLine = new Map(
    (db.prepare("SELECT line_id, id as subscriber_id, calling_propensity as propensity FROM subscribers").all() as SubInfo[]).map(
      (s) => [s.line_id, s]
    )
  );

  const insTicket = db.prepare(
    `INSERT INTO tickets (id, line_id, subscriber_id, opened_at, kind, reason, suppressed_by_notification)
     VALUES (?,?,?,?,?,?,?)`
  );

  for (const [lineId, imp] of impacted) {
    if (openByLine.has(lineId)) continue;
    const sub = subByLine.get(lineId);
    if (!sub) continue;
    const baseHazard = imp.status === "offline" ? 0.8 : 0.3; // per hour
    let hazard = baseHazard * sub.propensity;
    const notified = notifiedLines.has(lineId);
    if (notified) hazard *= 0.12; // notified subscribers largely stop calling
    const p = 1 - Math.exp((-hazard * minutes) / 60);
    if (rng.next() < p) {
      if (notified) {
        deflected++; // would have called, but was proactively notified
        continue;
      }
      insTicket.run(newTicketId(), lineId, sub.subscriber_id, simMin, "valid", imp.status, 0);
      openByLine.add(lineId);
      opened++;
    }
  }

  // Invalid / user-side tickets (~12% of ticket volume) from random online lines.
  const expectedInvalid = (opened * 0.12) / 0.88 + 0.02 * (minutes / 60);
  let invN = Math.floor(expectedInvalid);
  if (rng.next() < expectedInvalid - invN) invN++;
  const allLines = [...subByLine.keys()];
  for (let i = 0; i < invN && allLines.length; i++) {
    const lineId = rng.pick(allLines);
    if (openByLine.has(lineId) || impacted.has(lineId)) continue;
    const sub = subByLine.get(lineId)!;
    insTicket.run(newTicketId(), lineId, sub.subscriber_id, simMin, "invalid", "user-side", 0);
    openByLine.add(lineId);
    invalid++;
  }

  return { opened, deflected, invalid };
}

/** Close open tickets for lines that have recovered (line back online). */
export function closeTicketsForRecovered(db: DB, simMin: number, recoveredLines: string[]): number {
  if (!recoveredLines.length) return 0;
  const placeholders = recoveredLines.map(() => "?").join(",");
  const res = db
    .prepare(`UPDATE tickets SET closed_at = ? WHERE closed_at IS NULL AND kind='valid' AND line_id IN (${placeholders})`)
    .run(simMin, ...recoveredLines);
  return res.changes;
}
