import { getDb } from "./db";

export interface SuspicionOut {
  element_id: string;
  kind: string;
  confidence: number;
  rank: number;
  record_conflict: boolean;
  evidence: {
    text: string;
    band: number;
    observedUnder: number;
    recordedUnder: number;
    coveragePct: number;
    siblingsClean: number;
    siblingsTotal: number;
    recordConfidence: number;
    mismappedUnder: number;
  };
}

export interface TreeNode {
  element_id: string;
  kind: string;
  parent: string | null;
  label: string;
  suspicion: number | null;
  rank: number | null;
  conflict: boolean;
  role: "suspect" | "ancestor" | "sibling" | "child";
}

export interface BlastLineOut {
  line_id: string;
  evidence: "observed" | "inferred";
  vip: boolean;
  b2b: boolean;
  arpu: number;
  ticketed: boolean;
  notified: boolean;
  hours_down: number;
}

export function listIncidents() {
  return getDb()
    .prepare(
      `SELECT i.id, i.state, i.detected_via, i.telemetry_dark, i.fault_kind, i.fault_kind_confidence, i.detection_confidence,
              i.top_suspect, i.top_confidence, i.observed_count, i.inferred_count, i.vip_count, i.b2b_count, i.peso_exposure,
              i.worst_hours_down, i.predicted_mttr_p50, i.predicted_mttr_p90, i.vendor_id, v.name AS vendor_name,
              i.rank_score, i.detected_at, i.area_class, i.eta_hrs
         FROM incidents i
         LEFT JOIN vendors v ON v.id = i.vendor_id
        WHERE i.state NOT IN ('resolved')
        ORDER BY i.rank_score DESC, i.peso_exposure DESC, i.detected_at ASC`
    )
    .all() as Record<string, unknown>[];
}

export function getIncidentDetail(id: string) {
  const db = getDb();
  const incident = db.prepare("SELECT * FROM incidents WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!incident) return null;
  if (incident.vendor_id) {
    const v = db.prepare("SELECT name FROM vendors WHERE id=?").get(incident.vendor_id as string) as
      | { name: string }
      | undefined;
    incident.vendor_name = v?.name ?? null;
  }

  const suspicions = (db
    .prepare("SELECT element_id, kind, confidence, rank, record_conflict, evidence_json FROM suspicions WHERE incident_id=? ORDER BY rank")
    .all(id) as { element_id: string; kind: string; confidence: number; rank: number; record_conflict: number; evidence_json: string }[]
  ).map<SuspicionOut>((s) => ({
    element_id: s.element_id,
    kind: s.kind,
    confidence: s.confidence,
    rank: s.rank,
    record_conflict: !!s.record_conflict,
    evidence: JSON.parse(s.evidence_json),
  }));

  const contributions = db
    .prepare("SELECT signal, weight, detail FROM signal_contributions WHERE incident_id=? ORDER BY weight DESC")
    .all(id) as { signal: string; weight: number; detail: string }[];

  // Blast lines: observed first, VIP/B2B first, capped for the table.
  const blastLines = (db
    .prepare(
      `SELECT line_id, evidence, vip, b2b, arpu, ticketed, notified_at, hours_down
         FROM blast_radius WHERE incident_id=?
        ORDER BY (evidence='observed') DESC, vip DESC, b2b DESC, arpu DESC
        LIMIT 120`
    )
    .all(id) as {
    line_id: string;
    evidence: string;
    vip: number;
    b2b: number;
    arpu: number;
    ticketed: number;
    notified_at: number | null;
    hours_down: number;
  }[]
  ).map<BlastLineOut>((b) => ({
    line_id: b.line_id,
    evidence: b.evidence as "observed" | "inferred",
    vip: !!b.vip,
    b2b: !!b.b2b,
    arpu: b.arpu,
    ticketed: !!b.ticketed,
    notified: b.notified_at !== null,
    hours_down: b.hours_down,
  }));

  const isolationTree = buildIsolationTree(id, incident.top_suspect as string | null, suspicions);

  const events = db
    .prepare("SELECT sim_ts, kind, text, source FROM events WHERE href LIKE ? ORDER BY sim_ts ASC, id ASC LIMIT 60")
    .all(`%id=${id}%`) as { sim_ts: number; kind: string; text: string; source: string }[];

  const proposals = db
    .prepare("SELECT id, kind, state, payload_json, target_element, vendor_id, created_at, decided_at, decided_by_role, rationale FROM proposals WHERE incident_id=? ORDER BY created_at")
    .all(id) as Record<string, unknown>[];

  const notifiedCount = (db.prepare("SELECT COUNT(*) n FROM blast_radius WHERE incident_id=? AND notified_at IS NOT NULL").get(id) as { n: number }).n;

  // Every blast line (ids only) for the map: observed vs silent.
  const blastAll = db.prepare("SELECT line_id, evidence FROM blast_radius WHERE incident_id=?").all(id) as {
    line_id: string;
    evidence: "observed" | "inferred";
  }[];
  const blastMap = {
    observed: blastAll.filter((b) => b.evidence === "observed").map((b) => b.line_id),
    inferred: blastAll.filter((b) => b.evidence === "inferred").map((b) => b.line_id),
  };

  return { incident, suspicions, contributions, blastLines, blastMap, isolationTree, events, proposals, notifiedCount };
}

function buildIsolationTree(id: string, suspect: string | null, suspicions: SuspicionOut[]): TreeNode[] {
  const db = getDb();
  if (!suspect) return [];
  const suspMap = new Map(suspicions.map((s) => [s.element_id, s]));
  const labelOf = (el: string) =>
    (db.prepare("SELECT label FROM topology_truth WHERE element_id=?").get(el) as { label: string } | undefined)?.label ?? el;
  const recOf = (el: string) =>
    db.prepare("SELECT element_id, kind, parent_id_recorded FROM topology_recorded WHERE element_id=?").get(el) as
      | { element_id: string; kind: string; parent_id_recorded: string | null }
      | undefined;

  const nodes = new Map<string, TreeNode>();
  const add = (el: string, role: TreeNode["role"]) => {
    const rec = recOf(el);
    if (!rec) return;
    const s = suspMap.get(el);
    if (!nodes.has(el)) {
      nodes.set(el, {
        element_id: el,
        kind: rec.kind,
        parent: rec.parent_id_recorded,
        label: labelOf(el),
        suspicion: s?.confidence ?? null,
        rank: s?.rank ?? null,
        conflict: s?.record_conflict ?? false,
        role: s ? "suspect" : role,
      });
    }
  };

  add(suspect, "suspect");
  // Ancestors up to OLT.
  let cur = recOf(suspect)?.parent_id_recorded ?? null;
  while (cur) {
    add(cur, "ancestor");
    cur = recOf(cur)?.parent_id_recorded ?? null;
  }
  // Siblings of the suspect.
  const parent = recOf(suspect)?.parent_id_recorded;
  if (parent) {
    const sibs = db
      .prepare("SELECT element_id FROM topology_recorded WHERE parent_id_recorded=? LIMIT 12")
      .all(parent) as { element_id: string }[];
    for (const s of sibs) add(s.element_id, "sibling");
  }
  // Children of the suspect (unless it's a line).
  const kids = db
    .prepare("SELECT element_id FROM topology_recorded WHERE parent_id_recorded=? LIMIT 14")
    .all(suspect) as { element_id: string }[];
  for (const k of kids) add(k.element_id, "child");
  // Include other ranked suspects even if not siblings.
  for (const s of suspicions) add(s.element_id, "sibling");

  return [...nodes.values()];
}
