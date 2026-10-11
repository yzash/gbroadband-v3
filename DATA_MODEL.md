# SDAL — Data Model & Build Reference

A production-oriented reference for the SDAL platform: the exact SQLite schema, the
synthetic-data generation parameters, the inference algorithms, the engine pipeline, and
**how to replace the simulator with real feeds**. Source of truth for the schema is
[`src/lib/schema.sql`](src/lib/schema.sql); this document annotates it and fills in the
generation + algorithm details the raw DDL doesn't capture.

- **Store:** SQLite (`better-sqlite3`, WAL) at `SDAL_DB_PATH`. 29 tables, 18 indexes.
- **Schema version:** `PRAGMA user_version = 2`. On boot, a DB with a different version is
  dropped and re-seeded automatically (safe for the Render disk; bump `SCHEMA_VERSION` in
  `src/lib/db.ts` whenever `schema.sql` changes).
- **Units:** all timestamps are **integer sim-minutes since world epoch** (`sim_min`), not
  wall-clock. `mttr`/`eta`/`hours_down` are **hours** (REAL). Money is **PHP** (REAL).
  Booleans are `INTEGER` 0/1.
- **Determinism:** seed 42 + the same input sequence ⇒ byte-identical world (mulberry32 RNG).
- **Foreign keys are OFF** by design (the engine owns referential integrity; IDs are stable
  strings). Relationships below are logical, not enforced.

---

## 1. The one idea the schema is built around: truth vs. recorded

The system deliberately separates **what is true** from **what the platform is allowed to
see**. Everything downstream (detection, isolation, dispatch accuracy, record corrections)
derives its realism from this split.

| Concern | "Truth" table | "Recorded" / observed table | Who writes it |
|---|---|---|---|
| Network wiring | `topology_truth` | `topology_recorded` (~15% mis-mapped, some missing coords) | seeded once |
| Line state | `faults` → derived `lines.status` | `telemetry_latest` (only for polled lines), `tickets` | engine each tick |
| Fault existence | `faults` (ground truth) | `incidents` (inference over faults) | engine |

The **platform's decision logic only ever reads the recorded/observed side.** Truth is used
by the *simulator* to (a) decide what's physically happening and (b) score how right the
platform was (dispatch quality, wrong rolls). **In production you replace the "truth"
generators with real-world reality and the "recorded" tables with your real OSS/telemetry
feeds** — the inference layer is unchanged.

---

## 2. Identifier schemes

All IDs are human-readable strings (stable across the run).

| Entity | Format | Example | Count (seed 42) |
|---|---|---|---|
| OLT | `OLT-<n>` | `OLT-3` | 6 |
| PON port | `PON-<olt>-<n>` | `PON-3-2` | 24 |
| Splitter | `SPL-<serial3>` | `SPL-041` | 72 (24 primary tier-1 + 48 secondary tier-2) |
| NAP box | `NAP-<serial3>` | `NAP-129` | ~181 |
| ONT / line | `ONT-<serial4>` (== `line_id`) | `ONT-1642` | ~2,483 |
| District | `D<nn>` | `D07` | 40 |
| Power feeder | `PWR-<nn>` | `PWR-03` | ~10 (4 districts each) |
| Subscriber | `SUB-<serial4>` | `SUB-0912` | == lines |
| Vendor | `V<n>` | `V3` | 4 |
| Fault (truth) | `FLT-<serial4>` | `FLT-0007` | grows |
| Incident | `INC-<serial3>` | `INC-012` | grows |
| Ticket | `TKT-<serial5>` | `TKT-00421` | grows |
| Proposal | `PROP-<serial3>` | `PROP-018` | grows |
| Crew job | `JOB-<serial3>` | `JOB-004` | grows |

**Tree (truth):** `ONT → NAP → splitter(tier 2) → splitter(tier 1) → PON → OLT`.
`line_id === ont element_id`; each line has exactly one `subscriber`.

---

## 3. Data dictionary

Grouped by domain. Types are SQLite storage classes; `bool` = INTEGER 0/1; `simMin` =
INTEGER sim-minutes; `hrs`/`peso` = REAL.

### 3.1 Engine / world state

**`sim_state`** — singleton (row `id=1`), the clock + global knobs.
| col | type | notes |
|---|---|---|
| `sim_min` | simMin | current world time |
| `speed` | int | 0 paused, else 1/4/16 |
| `running` | bool | timer active |
| `seed` | int | world seed (42) |
| `sensing_coverage` | REAL | fraction of ONTs polled (default 0.70) |
| `alarm_delay_min` | int | OLT alarm feed latency (default 20) |
| `dead_olt` | TEXT? | OLT whose alarm feed is down (nullable) |
| `repair_window_hrs` | REAL | SLA-ish threshold (default 6.0) — a **setting, never a claim** |
| `model_version` | int | active MTTR model version |

**`districts`** — 40 real Metro Manila neighbourhoods across the 17 NCR LGUs. `city` (LGU
name, matches `public/geo/ncr-cities.geojson`), `lat/lon` (WGS84 centroid), `grid_x/grid_y`
(legacy projected coords, ~28 m/unit, derived from lat/lon), `area_class`
(`urban|suburban|fringe`), `power_grid` (feeder id; area power outages cluster by this).

### 3.2 Topology (truth vs recorded)

**`topology_truth`** — how the network is actually wired.
`element_id` PK, `kind` (`olt|pon|splitter|nap|ont`), `parent_id`, `lat/lon` (WGS84),
`grid_x/y` (legacy, derived), `district_id`,
`label`, `split_ratio` (splitters, e.g. 8), `tier` (splitter cascade level 1/2).
Indexes: `parent_id`, `kind`.

**`topology_recorded`** — the plant records the platform may read.
Same shape but `parent_id_recorded` (may differ from truth), `record_confidence` (0..1), and
`mismapped` (bool — 1 when the recorded parent ≠ truth). ~15% of ONT rows are mismapped;
~6% have null coords (`lat/lon/grid_*` all null — the map snaps these to their recorded
parent and flags them as estimated). Indexes: `parent_id_recorded`, `kind`.

**`sensing`** — per-line observability. `line_id` PK, `polled` (bool — telemetry ever
available), `dying_gasp_capable` (bool). Dark lines (`polled=0`) never emit rx/reachability
telemetry, but a `dying_gasp_capable` line still emits the pushed dying-gasp on power loss.

### 3.3 Customers & lines

**`subscribers`** — `id` PK, `line_id`, `arpu` (peso/mo), `vip`/`b2b` (bool),
`calling_propensity` (0..1 — chance to raise a ticket when impacted), `holdout` (bool — 10%
control group for lift), `tenure_days`, `churn_hazard` (0..1, rises with unrepaired hours,
cut by notification/credit), `churn_peak` (highest hazard reached — lift is measured on this), `churned`.

**`lines`** — `line_id` PK (== ONT), `subscriber_id`, `status`
(`online|degraded|offline`), `degraded_since`/`offline_since` (simMin).

**`telemetry_latest`** — latest reading per line (only meaningful for polled lines).
`rx_power` (dBm, ~-18 healthy / ~-27 degraded / null offline), `reachable` (bool),
`los` (loss-of-signal bool), `dying_gasp` (bool, pushed on power loss even for dark lines),
`updated_at`.

### 3.4 Faults (ground truth) & incidents (inference)

**`faults`** — the simulator's ground truth. `id` PK, `kind` (see §4.3), `element_id`
(truth element), `power_grid` (area outages), `started_at`, `cleared_at`, `auto_clear_at`
(background faults self-heal; injected persist until repaired), `severity`, `injected` (bool),
`resolved` (bool), `detected` (bool — an incident was opened).

**`incidents`** — the platform's inference over faults. Key columns:
| col | meaning |
|---|---|
| `fault_id` | simulator linkage (bookkeeping/scoring only) |
| `state` | `suspected → isolating → confirmed → repairing → verifying → resolved`; `reopened` on failed verify |
| `detected_via` | `tickets|telemetry|reachability|alarm|mixed` |
| `telemetry_dark` | bool — locus subtree is effectively unpolled (the "money badge") |
| `fault_kind` + `fault_kind_confidence` | classified kind + confidence |
| `detection_confidence` | fused (noisy-OR) confidence |
| `top_suspect` + `top_confidence` | rank-1 isolation suspect (recorded element) |
| `predicted_mttr_p50/p90`, `eta_hrs` | from the MTTR model |
| `vendor_id`, `area_class` | selected vendor + suspect's area |
| `rank_score` | prioritization score (exposure × time-pressure × confidence) |
| `observed_count`/`inferred_count`/`vip_count`/`b2b_count`/`peso_exposure`/`worst_hours_down` | blast-radius rollups |
| `confirming_test` | recommended test string |
| `verify_until` | simMin the verification window closes |
Indexes: `state`, `fault_id`.

### 3.5 Isolation, scoping, signals

**`suspicions`** — isolation output, one row per candidate element per incident.
PK (`incident_id`,`element_id`), `confidence`, `rank`, `record_conflict` (bool),
`evidence_json` (structured: `{text, band, observedUnder, recordedUnder, coveragePct,
siblingsClean, siblingsTotal, recordConfidence, mismappedUnder}`).

**`blast_radius`** — scoped lines per incident. PK (`incident_id`,`line_id`),
`evidence` (`observed|inferred`), `vip`/`b2b`/`arpu`, `ticketed` (bool), `notified_at`
(simMin?), `hours_down`. Index: `incident_id`.

**`signal_sources`** — signal catalog: `id`, `name`, `kind`, `reliability` (0..1),
`status` (`live|delayed|dark`). Seeded: TICKETING .95, TELEMETRY .90, REACHABILITY .85,
ALARM .80 (delayed), DYING_GASP .75.

**`signal_contributions`** — per-incident explainability. `signal`, `weight` (0..1),
`detail` (human string), `computed_at`. Refreshed every detection pass.

**`detection_samples`** — time-series for the "confidence hardening" charts. PK
(`incident_id`,`sim_ts` bucketed to 5 sim-min): `detection_confidence`, `tickets`,
`telemetry`, `unreachable`, `dying_gasp_ratio`. Capped to ~60 rows/incident.

### 3.6 Tickets

**`tickets`** — `id` PK, `line_id`, `subscriber_id`, `opened_at`, `closed_at`,
`kind` (`valid|invalid`), `reason`, `parent_incident_id` (dedup → root cause),
`suppressed_by_notification` (bool). Indexes: `line_id`, `closed_at`, `parent_incident_id`.

### 3.7 Action ladder (HITL)

**`proposals`** — `id` PK, `incident_id`, `kind`
(`remote_action|confirming_test|dispatch|notification|credit`), `state`
(`pending|approved|rejected|executed`), `payload_json` (kind-specific display + args),
`target_element`, `vendor_id`, `created_at`, `decided_at`, `decided_by_role`, `rationale`.
Indexes: `incident_id`, `state`.

**`crew_jobs`** — dispatched work. `id` PK, `proposal_id`, `incident_id`, `vendor_id`,
`target_element`, `grid_x/y`, `state` (`enroute|onsite|done`), `dispatched_at`,
`arrived_at`, `done_at`, `found_at_element`, `correct` (bool — target contained the true
fault). Index: `state`.

**`remote_actions`** — `id`, `line_id`, `incident_id`, `kind` (`diagnostic|reboot`),
`result`, `sim_ts`.

**`notifications`** — `id`, `incident_id`, `proposal_id`, `lines_count`,
`message_template`, `eta_given_hrs`, `sent_at`, `followup_kind` (`progress|closure|credit`).

### 3.8 Learn substrate

**`outcomes`** — per resolved incident. `id`, `incident_id`, `resolved_at`,
`mttr_actual_hrs`, `in_window` (bool), `verified` (bool), `reopened` (bool).

**`dispatch_quality`** — `proposal_id` PK, `incident_id`, `sent_to_element`,
`found_at_element`, `correct` (bool), `sim_ts`. Feeds wrong-roll rate.

**`record_corrections`** — `id`, `line_id`, `from_parent`, `to_parent`,
`source` (`repair_finding`), `status` (`suggested|accepted`), `incident_id`, `sim_ts`.
Accepting rewrites `topology_recorded` and raises `record_confidence`.

**`model_versions`** — `version` PK, `created_at`, `note`, `metrics_json`.

**`mttr_model`** — PK (`fault_kind`,`vendor_id`,`area_class`,`version`), `p50_hrs`,
`p90_hrs`, `samples`. Retrain writes a new `version`.

**`learn_daily`** — per sim-day rollup (`day` PK): `calls_deflected`, `wrong_rolls`,
`correct_rolls`, `repairs_in_window`, `repairs_total`, `dup_tickets_merged`, `rolls_avoided`.

**`audit_log`** — every gated action. `id`, `sim_ts`, `actor_role`, `action`,
`entity_type`, `entity_id`, `detail_json`. Index: `sim_ts`.

**`events`** — the live ticker. `id`, `sim_ts`, `kind`, `text`, `href` (deep link),
`source`. Index: `sim_ts`.

---

## 4. Synthetic-data generation (seed 42)

Generators: [`src/lib/topology.ts`](src/lib/topology.ts) (network + recorded degradation),
[`src/lib/seed.ts`](src/lib/seed.ts) (customers, vendors, sensing, MTTR model), RNG in
[`src/lib/rng.ts`](src/lib/rng.ts).

### 4.1 Topology
- **40 districts** at real NCR coordinates (hand-placed, every one validated by
  point-in-polygon against the PSA PSGC 2023 city boundaries); `area_class` set per
  neighbourhood (CBDs urban, edges fringe); ~10 power feeders grouping neighbouring districts.
- **OLTs sit in 6 real exchange areas** (Sampaloc, Diliman, Ortigas Center, Makati CBD, Sucat,
  Novaliches); each district is served by its nearest exchange with spare capacity.
- Children are scattered around their parent (OLT → PON → splitter → NAP → ONT, shrinking
  radius) and **rejected if they fall in the sea or outside NCR** (point-in-polygon), so every
  element lands on land inside its city.
- **6 OLTs** (home district each) → **4 PON ports** each = **24** → **1 primary splitter**
  (1:8, tier 1) per PON = **24** → **2 secondary splitters** (1:8, tier 2) per primary =
  **48** (72 splitters total) → **3–4 NAPs** per secondary (P(4)=0.75) ≈ **181** →
  **10–18 ONTs** per NAP ≈ **2,483**.

### 4.2 Recorded degradation (the honesty)
- **~15%** of ONT lines recorded under the *wrong* NAP (a different NAP in the same
  district); `record_confidence` 0.40–0.68, `mismapped=1`.
- **~6%** of elements have null coordinates; confidence capped 0.55–0.75.
- NAPs that gained/lost mismapped children get `record_confidence − 0.08 × |Δ|`.

### 4.3 Fault classes & base MTTR (p50 hrs, pre-adjustment)
`feeder_cut` 6.0 · `distribution_cut` 4.0 · `splitter_failure` 3.0 · `olt_port_failure` 2.5 ·
`power_outage` 3.5 · `drop_cut` 1.5 · `cpe_issue` 0.5 · `noise` 1.0.
**Area factor:** urban ×0.9, suburban ×1.1, fringe ×1.4.
Impact by class: feeder/olt-port → whole PON offline; distribution/splitter → subtree
offline; power_outage → all lines on a `power_grid` (dying-gasp); drop → single line offline;
cpe → single line degraded; noise → NAP subtree degraded.

### 4.4 Customers
- `b2b` 10%; `vip` = 35% of B2B else 3%.
- `arpu`: B2B 2000–8000, VIP 1500–3000, else 300–1500.
- `calling_propensity` = clamp(0.03, 0.95, 𝒩(μ=0.6 if VIP/B2B else 0.35, σ=0.2)) — **many
  never call (silent sufferers)**.
- `holdout` 10%; `tenure_days` 30–3000.

### 4.5 Sensing
- `polled` 70% (the "% actively sensed" honesty stat); `dying_gasp_capable` 80%.
- `telemetry_latest` seeded for **all** lines (dark lines carry null rx so the pushed
  dying-gasp bit can still be set).

### 4.6 Vendors & MTTR model
- 4 vendors with skills/territories/quality: `V1 Northline Fiber` (feeder/distribution/drop,
  q0.86), `V2 Southgrid Splice` (same, q0.78), `V3 CoreOptics Equipment`
  (olt_port/splitter, q0.90), `V4 MetroDrop` (drop/cpe, q0.72). Territories = 16 random
  districts each.
- `mttr_model[kind,vendor,area]`: `p50 = base × areaFactor × (1.15 − quality×0.3)`;
  `p90 = p50 × U(1.6, 2.0)`; `samples` 20–80; `version = 1`.

---

## 5. Algorithms (transparent formulas — no black-box ML)

All engine modules live under [`src/lib/engine/`](src/lib/engine/). Every value is derived
from **recorded + observed** data only; truth is used solely for simulation + scoring.

### 5.1 Detection fusion (`detection.ts`, `observe.ts`)
1. **Observe** — for each active fault, gather its truly-impacted lines that produce an
   observable symptom: an open valid **ticket**, a **telemetry** symptom on a polled line
   (`reachable=0 || los || rx < −26`), or a **dying-gasp** (pushed, even on dark lines,
   suppressed if the OLT is `dead_olt`). No symptom ⇒ invisible (honest ticket-only path).
2. **Localize** — climb the *recorded* tree; locus = the highest element whose subtree the
   symptoms still "fill" (`observedUnder/recordedUnder ≥ 0.4`, count ≥ 2), else the line
   itself. Mismapped lines drag the locus → surfaces later as record conflict.
3. **Classify `detected_via`** — priority mixed > telemetry > alarm > tickets. Alarm is
   present only after `alarm_delay_min` and never for `dead_olt`.
4. **Confidence** — noisy-OR over per-signal weights, damped by locus record confidence:
   `conf = (1 − Π(1 − wᵢ)) × (0.6 + 0.4 × record_confidence)`.
5. **Fault kind** — `dying_gasp_ratio ≥ 0.35 → power_outage`; else inferred from locus kind
   + fill. `telemetry_dark` = locus subtree <25% polled and no telemetry observed.

### 5.2 Isolation (`isolation.ts`)
For each candidate element `E` (recorded ancestors of observed lines):
`completeness = observedUnder/totalObserved`, `specificity = observedUnder/recordedUnder`,
`score = completeness × √specificity × (0.6 + 0.4 × record_confidence)`. Rank by score.
**Confidence band** = clamp(0.05, 0.4, (1−coverageₑ)×0.35 + (1−recConf)×0.25) — low coverage
or uncertain records ⇒ wider band. **Record conflict** (top leans on mismapped lines or a
near-tie sibling) drops the point estimate −0.12 and widens the band; displayed confidence
is kept monotonic with rank. Confirming test string is generated per suspect kind (OTDR
distance ≈ euclid(OLT, suspect)/45 km).

### 5.3 Scoping (`isolation.ts` → `blast_radius`)
All recorded lines under the top suspect; `observed` (ticketed or telemetry) vs `inferred`
(silent); VIP/B2B/ARPU rollups; `hours_down` from `offline_since`; open tickets are linked
to the incident (`parent_incident_id`) for the dedup metric.

### 5.4 MTTR & prioritization (`prioritization.ts`)
Vendor = min current load among (skill ∩ territory), tie-break quality; **power outage ⇒ no
vendor (utility restore, no fiber crew).** `predicted_mttr = mttr_model[kind,vendor,area,
model_version]`; `eta = p50`. `rank_score = peso_exposure × clamp(0.15, 3, worst_hours ÷
repair_window) × (0.5 + 0.5 × max(top_confidence, detection_confidence))`.

### 5.5 Action ladder (`proposals.ts`)
Generated idempotently per incident: **remote_action** (CPE), **confirming_test**
(confidence <0.75, not CPE/drop/power), **dispatch** (not CPE/power; held if an ancestor is
already repairing → `rolls_avoided`), **notification** (always; power outage bumps
`rolls_avoided`), **credit** (any line past the window). Approve is role-gated
(`src/lib/roles.ts`): NOC Lead → dispatch/test/remote; CX Ops → notification/credit.
Execute effects: crew job (travel by area 25/55/90 min ±20%, repair ≈ p50×U(0.75,1.25));
notification sets `blast_radius.notified_at` → ticketing suppresses would-be callers
(`calls_deflected`); credit cuts `churn_hazard`.

### 5.6 Verification & Learn (`verification.ts`, `learn-ops.ts`)
Repaired incident → `verifying` for a 20-sim-min window. If the underlying fault is cleared →
`resolved` (+ `outcomes.verified`, `correct_rolls`, in-window). If still live (wrong roll) →
`reopened` (+ `wrong_rolls`), a **record correction is suggested** from the crew's finding,
and a fresh dispatch is proposed to the corrected locus. **Retrain** blends
`p50' = 0.6×p50 + 0.4×observed_avg`, publishes a new `model_version`, and re-ranks.

### 5.6b Churn hazard & retention lift (`world.ts` → `updateChurnHazard`, `learn-queries.ts`)
While a line is offline: `hazard = 0.02 + hours_down × 0.03 × (0.55 if notified) − (0.12 if credited)`;
once back online it decays by `0.005 / sim-hour`; clamped 0–0.95. **The 10% holdout never
receives notifications or credits** (excluded at send time and from recipient counts), so it is
a true control group. Each tick also records `churn_peak` (highest hazard reached). Learn's *retention lift* =
`1 − avg(treated churn_peak) / avg(holdout churn_peak)`,
measured only over lines in incidents that were notified; shown as "—" until both groups
have members.

### 5.7 Determinism
`mulberry32` (`rng.ts`). Seeder uses `seed`; the live engine uses `seed + 1000`. Same seed +
same command sequence ⇒ identical world; scripted `Advance 6h` from a reset is
bit-reproducible.

---

## 6. Engine tick pipeline (`engine/index.ts` → `stepWorld`)

One wall-second tick advances `speed` sim-minutes (Advance-6h = 12×30-min chunks). Order:

```
sim_min += minutes
clearExpiredFaults          → background faults self-heal
crewStep                    → advance crews; completed repairs enter verifying
spawnBackgroundFaults       → ~1 per 40 sim-min (cpe/drop/noise/distribution mix)
loadSensing + recomputeImpact + applyLineChanges   → fault → line status + telemetry
closeTicketsForRecovered
ticketingPass               → stochastic calls; deflection on notified lines
updateChurnHazard
runDetection → runIsolation → runVerification → runPrioritization → generateProposals
publish snapshot (SSE)
```

The SSE payload shape (`OpsSnapshot`) is in [`src/lib/types.ts`](src/lib/types.ts).

---

## 7. API surface (all `nodejs` runtime, `force-dynamic`)

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | liveness |
| `/api/state` | GET | latest snapshot (polling fallback) |
| `/api/stream` | GET | **SSE** live snapshot on every tick |
| `/api/clock` | POST | `{speed,running,advance6h}` |
| `/api/reset` | POST | restore seeded world (≤2s) |
| `/api/incidents` · `/api/incidents/[id]` | GET | queue + full detail |
| `/api/detections` | GET | detection cards + contributions + samples |
| `/api/proposals` · `/api/proposals/[id]/decide` | GET/POST | pending/audit + approve/reject |
| `/api/learn` · `/api/learn/retrain` · `/api/corrections/[id]/accept` | GET/POST | metrics + retrain + accept |
| `/api/ask` | POST | GE assistant (canned tools / live Gemini) |
| `/api/geo` | GET | recorded-topology geometry for the map (lat/lon, parent, confidence, `est` flag) |
| `/api/director/inject` · `/sensing` · `/scenario` | POST | scenario control |

---

## 8. Taking it to production — replacing the simulator

The inference layer (§5) is production-ready as-is. What changes is **where the data comes
from**. Map each synthetic generator to a real feed:

| Simulated today | Production source | Notes |
|---|---|---|
| `topology_truth` | *(delete)* — there is no oracle in prod | only the simulator had truth |
| `topology_recorded` | **GIS / OSP plant records / inventory (OSS)** | keep `record_confidence`; seed it from data-quality signals |
| `faults` (spawn/inject) | *(delete)* — faults are now real and unknown | detection infers them |
| `telemetry_latest` | **OLT/ONT telemetry** (SNMP/gNMI/streaming: Rx power, LOS, reachability) | write latest-per-line; keep a longer series if you want |
| dying-gasp bit | **OLT dying-gasp / last-gasp traps** | pushed events, independent of polling |
| `sensing.polled` | derived from which ONTs actually stream | drives the "% sensed" honesty stat |
| `tickets` | **CRM / contact-center / IVR / app tickets** | keep `kind` valid/invalid, link `parent_incident_id` |
| `subscribers` | **billing / CRM** (ARPU, VIP/B2B, tenure) | `calling_propensity`/`churn_hazard` become learned models |
| `vendors` + `mttr_model` | **workforce/field-service system** + historical work orders | retrain (§5.6) from real closures |
| `crew_jobs` transitions | **field dispatch app callbacks** (enroute/onsite/closed) | replace the simulated travel/repair timers |
| `holdout` | **experiment/holdout framework** | for real lift measurement |
| `districts.power_grid` | **utility outage feeds / grid maps** | powers the power-outage guardrail |

**Keep unchanged:** `incidents`, `suspicions`, `blast_radius`, `signal_*`, `proposals`,
`outcomes`, `dispatch_quality`, `record_corrections`, `model_versions`, `learn_daily`,
`audit_log`, `events` — these are the *product*, not the simulation.

### 8.1 Architecture changes for scale
- **SQLite → Postgres** (or your OLTP of choice). The schema ports directly; add real FKs.
  `better-sqlite3` was chosen for a zero-dependency single-node demo.
- **In-process singleton → a service.** The demo runs detection→…→proposals inside one Node
  process on a wall-clock tick. In prod, split into: (a) **ingestion** (telemetry/tickets →
  normalized store), (b) an **inference worker** (event- or interval-driven; the §5 pipeline),
  (c) the **API/UI** (stateless, reads the store, streams via SSE/WebSocket from a broker).
- **Sim-minutes → real timestamps.** Replace `sim_min` with epoch millis; the algorithms are
  time-unit agnostic (they use deltas and the `repair_window_hrs` setting).
- **Streaming.** Replace the single-process SSE with a pub/sub (Redis/NATS/Kafka) so multiple
  API instances can fan out live updates.
- **Ask (GE).** Swap the canned router for your governed LLM gateway; keep `run_sql`
  read-only with the same blocklist/limit, pointed at a read replica.

### 8.2 Data-quality is a first-class input
The single most important production concept from this build: **`record_confidence` and the
`mismapped` reality are not edge cases — they're the whole point.** Wire `record_confidence`
from real inventory-quality signals (audit age, source system, reconciliation status), and
feed accepted `record_corrections` back into your inventory system. That closed loop is what
turns "truck rolls to the wrong place" into "isolation that gets sharper over time."

---

*Schema source of truth: `src/lib/schema.sql`. Generation: `src/lib/topology.ts`,
`src/lib/seed.ts`. Algorithms: `src/lib/engine/*`. This document is versioned alongside them.*
