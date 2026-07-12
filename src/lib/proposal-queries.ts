import { getDb } from "./db";

export function listOpenProposals() {
  return getDb()
    .prepare(
      `SELECT p.id, p.incident_id, p.kind, p.state, p.payload_json, p.target_element, p.vendor_id, p.created_at,
              p.decided_at, p.decided_by_role, i.fault_kind, i.top_suspect, i.peso_exposure
         FROM proposals p JOIN incidents i ON i.id = p.incident_id
        WHERE p.state = 'pending'
        ORDER BY i.rank_score DESC, p.created_at ASC`
    )
    .all() as Record<string, unknown>[];
}

export function listRecentDecided(limit = 30) {
  return getDb()
    .prepare(
      `SELECT id, incident_id, kind, state, payload_json, decided_at, decided_by_role, rationale
         FROM proposals WHERE state IN ('approved','executed','rejected')
        ORDER BY decided_at DESC LIMIT ?`
    )
    .all(limit) as Record<string, unknown>[];
}

export function listAudit(limit = 60) {
  return getDb()
    .prepare("SELECT id, sim_ts, actor_role, action, entity_type, entity_id, detail_json FROM audit_log ORDER BY id DESC LIMIT ?")
    .all(limit) as Record<string, unknown>[];
}
