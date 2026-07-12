/**
 * `npm run seed` entrypoint. Builds the deterministic world (seed 42) into the
 * SQLite database at $SDAL_DB_PATH.
 */
import { getDb } from "./db";
import { seedWorld } from "./seed";

const dbPath = process.env.SDAL_DB_PATH ?? "./data/sdal.db";
const db = getDb();
const t0 = Date.now();
const result = seedWorld(db);
const ms = Date.now() - t0;

const s = result.stats;
console.log(`[seed] world seed=${result.seed} → ${dbPath} in ${ms}ms`);
console.log(
  `[seed] topology: ${s.olt} OLT · ${s.pon} PON · ${s.splitter} splitters · ${s.nap} NAP · ${s.ont} ONT/lines · ${s.districts} districts`
);
console.log(
  `[seed] recorded copy: ${s.mismapped_lines} mis-mapped lines (${(s.mismap_rate * 100).toFixed(1)}%) · ${s.missing_coord_elements} elements missing coordinates`
);
console.log(`[seed] vendors: ${result.vendors} · subscribers: ${result.subscribers}`);
