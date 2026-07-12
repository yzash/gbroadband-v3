-- SDAL v5 schema. Two topologies (truth vs recorded), imperfect sensing,
-- inference-first incidents, HITL proposals, and the Learn substrate.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = OFF;

-- ---- Engine / clock singleton (row id = 1) ----
CREATE TABLE IF NOT EXISTS sim_state (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  sim_min           INTEGER NOT NULL DEFAULT 0,
  speed             INTEGER NOT NULL DEFAULT 0,     -- 0 paused, else 1/4/16
  running           INTEGER NOT NULL DEFAULT 0,
  seed              INTEGER NOT NULL DEFAULT 42,
  sensing_coverage  REAL    NOT NULL DEFAULT 0.70,  -- fraction of ONTs polled
  alarm_delay_min   INTEGER NOT NULL DEFAULT 20,
  dead_olt          TEXT,                           -- OLT id whose alarm feed is down
  repair_window_hrs REAL    NOT NULL DEFAULT 6.0,
  model_version     INTEGER NOT NULL DEFAULT 1
);

-- ---- Districts (Metro Manila) ----
CREATE TABLE IF NOT EXISTS districts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  grid_x     INTEGER NOT NULL,
  grid_y     INTEGER NOT NULL,
  area_class TEXT NOT NULL,        -- urban | suburban | fringe
  power_grid TEXT NOT NULL         -- power feeder id (area power outages cluster by this)
);

-- ---- Topology: ground truth vs plant records ----
CREATE TABLE IF NOT EXISTS topology_truth (
  element_id  TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,        -- olt | pon | splitter | nap | ont
  parent_id   TEXT,
  grid_x      INTEGER,
  grid_y      INTEGER,
  district_id TEXT,
  label       TEXT,
  split_ratio INTEGER,              -- splitters only
  tier        INTEGER               -- splitter cascade level (1 primary, 2 secondary)
);
CREATE INDEX IF NOT EXISTS idx_truth_parent ON topology_truth(parent_id);
CREATE INDEX IF NOT EXISTS idx_truth_kind ON topology_truth(kind);

CREATE TABLE IF NOT EXISTS topology_recorded (
  element_id        TEXT PRIMARY KEY,
  kind              TEXT NOT NULL,
  parent_id_recorded TEXT,
  grid_x            INTEGER,
  grid_y            INTEGER,
  district_id       TEXT,
  record_confidence REAL NOT NULL DEFAULT 1.0,
  mismapped         INTEGER NOT NULL DEFAULT 0  -- 1 if recorded parent != truth (the honest 15%)
);
CREATE INDEX IF NOT EXISTS idx_rec_parent ON topology_recorded(parent_id_recorded);
CREATE INDEX IF NOT EXISTS idx_rec_kind ON topology_recorded(kind);

-- ---- Sensing coverage per line ----
CREATE TABLE IF NOT EXISTS sensing (
  line_id             TEXT PRIMARY KEY,
  polled              INTEGER NOT NULL,   -- 1 if telemetry ever available
  dying_gasp_capable  INTEGER NOT NULL
);

-- ---- Vendors ----
CREATE TABLE IF NOT EXISTS vendors (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  skills_json  TEXT NOT NULL,       -- fault kinds they can service
  territories_json TEXT NOT NULL,   -- district ids
  quality      REAL NOT NULL,       -- 0..1 (affects MTTR + wrong-find rate)
  base_load    INTEGER NOT NULL DEFAULT 0
);

-- ---- Subscribers & lines (line_id == ont element_id) ----
CREATE TABLE IF NOT EXISTS subscribers (
  id                TEXT PRIMARY KEY,
  line_id           TEXT NOT NULL,
  name              TEXT NOT NULL,
  arpu              REAL NOT NULL,
  vip               INTEGER NOT NULL DEFAULT 0,
  b2b               INTEGER NOT NULL DEFAULT 0,
  calling_propensity REAL NOT NULL,   -- 0..1 chance to raise a ticket when impacted
  holdout           INTEGER NOT NULL DEFAULT 0,  -- 10% holdout for lift measurement
  tenure_days       INTEGER NOT NULL,
  churn_hazard      REAL NOT NULL DEFAULT 0,
  churned           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sub_line ON subscribers(line_id);

CREATE TABLE IF NOT EXISTS lines (
  line_id        TEXT PRIMARY KEY,       -- == ont element_id
  subscriber_id  TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'online',  -- online | degraded | offline
  degraded_since INTEGER,
  offline_since  INTEGER
);

-- ---- Telemetry (latest per line; series kept short & ring-buffered) ----
CREATE TABLE IF NOT EXISTS telemetry_latest (
  line_id     TEXT PRIMARY KEY,
  rx_power    REAL,      -- dBm
  reachable   INTEGER NOT NULL DEFAULT 1,
  los         INTEGER NOT NULL DEFAULT 0,   -- loss of signal
  dying_gasp  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER
);

-- ---- Faults: ground truth injected/spawned by the engine ----
CREATE TABLE IF NOT EXISTS faults (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  element_id    TEXT,            -- truth element where the fault sits
  power_grid    TEXT,            -- for area power outages
  started_at    INTEGER NOT NULL,
  cleared_at    INTEGER,
  auto_clear_at INTEGER,          -- background faults self-resolve; injected persist until Act
  severity      REAL NOT NULL DEFAULT 1.0,
  injected      INTEGER NOT NULL DEFAULT 0,
  resolved      INTEGER NOT NULL DEFAULT 0,
  detected      INTEGER NOT NULL DEFAULT 0  -- set once an incident is opened for it
);

-- ---- Incidents: the platform's inference over faults ----
CREATE TABLE IF NOT EXISTS incidents (
  id                   TEXT PRIMARY KEY,
  fault_id             TEXT,
  state                TEXT NOT NULL DEFAULT 'suspected',
  detected_via         TEXT NOT NULL DEFAULT 'tickets',
  telemetry_dark       INTEGER NOT NULL DEFAULT 0,
  fault_kind           TEXT,
  fault_kind_confidence REAL NOT NULL DEFAULT 0,
  detection_confidence REAL NOT NULL DEFAULT 0,
  detected_at          INTEGER NOT NULL,
  confirmed_at         INTEGER,
  resolved_at          INTEGER,
  reopened_count       INTEGER NOT NULL DEFAULT 0,
  top_suspect          TEXT,
  top_confidence       REAL NOT NULL DEFAULT 0,
  predicted_mttr_p50   REAL NOT NULL DEFAULT 0,
  predicted_mttr_p90   REAL NOT NULL DEFAULT 0,
  eta_hrs              REAL,
  vendor_id            TEXT,
  rank_score           REAL NOT NULL DEFAULT 0,
  observed_count       INTEGER NOT NULL DEFAULT 0,
  inferred_count       INTEGER NOT NULL DEFAULT 0,
  vip_count            INTEGER NOT NULL DEFAULT 0,
  b2b_count            INTEGER NOT NULL DEFAULT 0,
  peso_exposure        REAL NOT NULL DEFAULT 0,
  worst_hours_down     REAL NOT NULL DEFAULT 0,
  area_class           TEXT,
  confirming_test      TEXT
);
CREATE INDEX IF NOT EXISTS idx_inc_state ON incidents(state);
CREATE INDEX IF NOT EXISTS idx_inc_fault ON incidents(fault_id);

-- ---- Isolation output ----
CREATE TABLE IF NOT EXISTS suspicions (
  incident_id    TEXT NOT NULL,
  element_id     TEXT NOT NULL,
  kind           TEXT NOT NULL,
  confidence     REAL NOT NULL,
  rank           INTEGER NOT NULL,
  evidence_json  TEXT NOT NULL,
  record_conflict INTEGER NOT NULL DEFAULT 0,
  computed_at    INTEGER NOT NULL,
  PRIMARY KEY (incident_id, element_id)
);

-- ---- Blast radius ----
CREATE TABLE IF NOT EXISTS blast_radius (
  incident_id  TEXT NOT NULL,
  line_id      TEXT NOT NULL,
  evidence     TEXT NOT NULL,   -- observed | inferred
  vip          INTEGER NOT NULL DEFAULT 0,
  b2b          INTEGER NOT NULL DEFAULT 0,
  arpu         REAL NOT NULL DEFAULT 0,
  ticketed     INTEGER NOT NULL DEFAULT 0,
  notified_at  INTEGER,
  hours_down   REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (incident_id, line_id)
);
CREATE INDEX IF NOT EXISTS idx_blast_inc ON blast_radius(incident_id);

-- ---- MTTR model ----
CREATE TABLE IF NOT EXISTS mttr_model (
  fault_kind  TEXT NOT NULL,
  vendor_id   TEXT NOT NULL,
  area_class  TEXT NOT NULL,
  p50_hrs     REAL NOT NULL,
  p90_hrs     REAL NOT NULL,
  samples     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (fault_kind, vendor_id, area_class, version)
);

-- ---- Signals & contributions (explainable fusion) ----
CREATE TABLE IF NOT EXISTS signal_sources (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  reliability REAL NOT NULL,
  status      TEXT NOT NULL DEFAULT 'live'   -- live | delayed | dark
);
CREATE TABLE IF NOT EXISTS signal_contributions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT NOT NULL,
  signal      TEXT NOT NULL,
  weight      REAL NOT NULL,
  detail      TEXT NOT NULL,
  computed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sigcontrib_inc ON signal_contributions(incident_id);

-- Detection time-series (drives the aligned mini-charts + confidence hardening).
CREATE TABLE IF NOT EXISTS detection_samples (
  incident_id          TEXT NOT NULL,
  sim_ts               INTEGER NOT NULL,
  detection_confidence REAL NOT NULL,
  tickets              INTEGER NOT NULL DEFAULT 0,
  telemetry            INTEGER NOT NULL DEFAULT 0,
  unreachable          INTEGER NOT NULL DEFAULT 0,
  dying_gasp_ratio     REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (incident_id, sim_ts)
);

-- ---- Tickets ----
CREATE TABLE IF NOT EXISTS tickets (
  id            TEXT PRIMARY KEY,
  line_id       TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  opened_at     INTEGER NOT NULL,
  closed_at     INTEGER,
  kind          TEXT NOT NULL DEFAULT 'valid',  -- valid | invalid (user-side)
  reason        TEXT,
  parent_incident_id TEXT,
  suppressed_by_notification INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tickets_line ON tickets(line_id);
CREATE INDEX IF NOT EXISTS idx_tickets_open ON tickets(closed_at);
CREATE INDEX IF NOT EXISTS idx_tickets_inc ON tickets(parent_incident_id);

-- ---- Proposals (HITL) ----
CREATE TABLE IF NOT EXISTS proposals (
  id            TEXT PRIMARY KEY,
  incident_id   TEXT NOT NULL,
  kind          TEXT NOT NULL,   -- remote_action | confirming_test | dispatch | notification | credit
  state         TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | executed
  payload_json  TEXT NOT NULL,
  target_element TEXT,
  vendor_id     TEXT,
  created_at    INTEGER NOT NULL,
  decided_at    INTEGER,
  decided_by_role TEXT,
  rationale     TEXT
);
CREATE INDEX IF NOT EXISTS idx_prop_inc ON proposals(incident_id);
CREATE INDEX IF NOT EXISTS idx_prop_state ON proposals(state);

-- ---- Crew jobs ----
CREATE TABLE IF NOT EXISTS crew_jobs (
  id             TEXT PRIMARY KEY,
  proposal_id    TEXT,
  incident_id    TEXT NOT NULL,
  vendor_id      TEXT NOT NULL,
  target_element TEXT NOT NULL,
  grid_x         INTEGER,
  grid_y         INTEGER,
  state          TEXT NOT NULL DEFAULT 'enroute',  -- enroute | onsite | done
  dispatched_at  INTEGER NOT NULL,
  arrived_at     INTEGER,
  done_at        INTEGER,
  found_at_element TEXT,
  correct        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_crew_state ON crew_jobs(state);

-- ---- Remote actions ----
CREATE TABLE IF NOT EXISTS remote_actions (
  id          TEXT PRIMARY KEY,
  line_id     TEXT NOT NULL,
  incident_id TEXT,
  kind        TEXT NOT NULL,   -- diagnostic | reboot
  result      TEXT NOT NULL,
  sim_ts      INTEGER NOT NULL
);

-- ---- Notifications ----
CREATE TABLE IF NOT EXISTS notifications (
  id               TEXT PRIMARY KEY,
  incident_id      TEXT NOT NULL,
  proposal_id      TEXT,
  lines_count      INTEGER NOT NULL,
  message_template TEXT NOT NULL,
  eta_given_hrs    REAL,
  sent_at          INTEGER NOT NULL,
  followup_kind    TEXT              -- progress | closure | credit
);

-- ---- Plant-record corrections (Learn → topology) ----
CREATE TABLE IF NOT EXISTS record_corrections (
  id          TEXT PRIMARY KEY,
  line_id     TEXT NOT NULL,
  from_parent TEXT,
  to_parent   TEXT,
  source      TEXT NOT NULL DEFAULT 'repair_finding',
  status      TEXT NOT NULL DEFAULT 'suggested',  -- suggested | accepted
  incident_id TEXT,
  sim_ts      INTEGER NOT NULL
);

-- ---- Dispatch quality (Learn) ----
CREATE TABLE IF NOT EXISTS dispatch_quality (
  proposal_id     TEXT PRIMARY KEY,
  incident_id     TEXT NOT NULL,
  sent_to_element TEXT NOT NULL,
  found_at_element TEXT,
  correct         INTEGER,
  sim_ts          INTEGER NOT NULL
);

-- ---- Outcomes (Learn) ----
CREATE TABLE IF NOT EXISTS outcomes (
  id               TEXT PRIMARY KEY,
  incident_id      TEXT NOT NULL,
  resolved_at      INTEGER,
  mttr_actual_hrs  REAL,
  in_window        INTEGER,
  verified         INTEGER NOT NULL DEFAULT 0,
  reopened         INTEGER NOT NULL DEFAULT 0
);

-- ---- Audit log ----
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sim_ts      INTEGER NOT NULL,
  actor_role  TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  detail_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(sim_ts);

-- ---- Model versions (Learn / retrain) ----
CREATE TABLE IF NOT EXISTS model_versions (
  version     INTEGER PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  note        TEXT,
  metrics_json TEXT
);

-- ---- Event ticker ----
CREATE TABLE IF NOT EXISTS events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  sim_ts   INTEGER NOT NULL,
  kind     TEXT NOT NULL,
  text     TEXT NOT NULL,
  href     TEXT,
  source   TEXT NOT NULL DEFAULT 'ENGINE'
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(sim_ts);

-- ---- Daily learn rollup (per sim-day) ----
CREATE TABLE IF NOT EXISTS learn_daily (
  day              INTEGER PRIMARY KEY,
  calls_deflected  INTEGER NOT NULL DEFAULT 0,
  wrong_rolls      INTEGER NOT NULL DEFAULT 0,
  correct_rolls    INTEGER NOT NULL DEFAULT 0,
  repairs_in_window INTEGER NOT NULL DEFAULT 0,
  repairs_total    INTEGER NOT NULL DEFAULT 0,
  dup_tickets_merged INTEGER NOT NULL DEFAULT 0,
  rolls_avoided    INTEGER NOT NULL DEFAULT 0
);
