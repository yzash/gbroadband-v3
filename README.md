# SDAL Platform Demo — Globe Broadband Intelligence

**Sense → Decide → Act → Learn** — probabilistic fault inference & localization on a
GPON network topology, under deliberately imperfect data (dark sensors, delayed feeds,
wrong plant records). A living simulation: pause, run at 1×/4×/16×, or jump 6 hours.

> **DEMONSTRATION ENVIRONMENT · SYNTHETIC DATA.** No real customers, vendors, or PII.
> No auth (role switcher). The "Ask (GE)" surface is styled after GE and always captioned.

## What it does

- **Sense** — fuses unreliable signals (customer tickets first-class, telemetry where it
  exists, reachability, OLT alarms, pushed dying-gasp) into probabilistic detections.
  Finds outages **from tickets alone** when telemetry is dark.
- **Decide** — isolates the faulty element on the *recorded* plant topology (which has
  ~15% mis-mapped lines), scopes the blast radius (observed vs. silent sufferers),
  predicts MTTR, and prioritizes by ₱ exposure.
- **Act** — a strictly-ordered, human-in-the-loop ladder: remote reboot → confirming test
  → dispatch (right vendor, right parts, duplicate-suppressed, power-outage → no fiber
  crew) → proactive notification (which actually deflects calls) → credits. Every action:
  propose → approve (role-gated) → execute → audit.
- **Learn** — verifies repairs (reopens on failure), measures retention lift vs. a 10%
  holdout, call deflection, wrong-roll rate, suggests plant-record corrections, and
  retrains the MTTR model (re-ranking the queue).

## Architecture

- **Next.js 14 (App Router, TypeScript)** — the doctrine shell + all screens.
- **In-process simulation engine** — a process-wide singleton booted from
  `instrumentation.ts`; ticks the world, propagates faults, and runs the full
  detection→isolation→prioritization→action→verification pipeline each step.
- **SQLite (`better-sqlite3`, WAL)** at `SDAL_DB_PATH` — two topologies (`topology_truth`
  vs. `topology_recorded`), incidents, proposals, crews, outcomes, audit, and more.
- **SSE `/api/stream`** pushes the live snapshot on every tick, with a 2s polling fallback.
- **Deterministic**: seed 42 + the same inputs ⇒ the same world. `npm run seed` rebuilds
  it; **Reset** restores it in ≤2s.

## Run locally

```bash
npm install
npm run seed     # build the seeded world into ./data/sdal.db
npm run dev      # http://localhost:3000  (or: npm run build && npm start)
```

Then open **/operations**, press ▶ on the sim clock, and drive scenarios from the hidden
**/director** (fault injectors + Sensing Health). `/debug/data` visualizes the topology
and the record-error rate.

### Environment

| Var | Default | Meaning |
|-----|---------|---------|
| `SDAL_DB_PATH` | `./data/sdal.db` | SQLite location (WAL) |
| `SDAL_SEED` | `42` | deterministic world seed |
| `DEMO_MODE` | `canned` | `canned` runs the Ask tools on live data with no network; `live` uses Gemini |
| `GEMINI_API_KEY` | — | only needed when `DEMO_MODE=live` |

## Deploy (Render)

This app is **not serverless** — it needs a persistent process (the simulation
singleton + SSE) and a writable disk (SQLite). Render fits exactly; a `render.yaml`
blueprint is included:

- A **Web Service** running `npm start` (persistent Node process).
- A **1 GB persistent disk** mounted at `/var/data`; `SDAL_DB_PATH=/var/data/sdal.db`.
- The engine **auto-seeds** the world on first boot (the disk is empty), so no build-time
  seed is required.

Point Render at this repo and the blueprint provisions the service + disk. A `Dockerfile`
is also included for container hosts (Railway/Fly/VM). *(Vercel and other serverless
platforms won't work without re-architecting to Postgres + an external worker + hosted
pub/sub — the SQLite/singleton/SSE design is intentional.)*

## Screens

Operations · Detections · Incident Room · Proposals & Audit · Learn · Ask (GE) ·
Configurations — plus the hidden `/director` and `/debug/data`.

Roles (top-right switcher): **NOC Lead** approves dispatch & tests; **CX Ops** approves
comms & credits; **Read-only** observes.
