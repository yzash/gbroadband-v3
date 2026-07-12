/**
 * `npm run seed` entrypoint. Builds the deterministic world (seed 42) into the
 * SQLite database. M1 implements the topology + schema; for M0 it is a no-op
 * that just reports where the DB will live.
 */
const dbPath = process.env.SDAL_DB_PATH ?? "./data/sdal.db";
const seed = process.env.SDAL_SEED ?? "42";

// M1: import { seedWorld } from "./seed"; seedWorld();
console.log(`[seed] SDAL world seed=${seed} → ${dbPath} (M1 will populate topology + schema)`);
