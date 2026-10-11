import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type DB = Database.Database;

const DB_PATH = process.env.SDAL_DB_PATH ?? "./data/sdal.db";
const SCHEMA_PATH = path.join(process.cwd(), "src", "lib", "schema.sql");

// Survive HMR / multiple route workers in one process via globalThis.
const g = globalThis as unknown as { __sdal_db?: DB };

export function getDb(): DB {
  if (g.__sdal_db) return g.__sdal_db;

  const dir = path.dirname(DB_PATH);
  if (dir && dir !== "." && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = OFF");
  applySchema(db);

  g.__sdal_db = db;
  return db;
}

/**
 * Bump when a table's shape changes. A database written by an older schema
 * (e.g. on Render's persistent disk) is dropped and rebuilt — the world is
 * synthetic and re-seeds deterministically, so nothing of value is lost.
 */
const SCHEMA_VERSION = 2; // v2: real lat/lon geography

export function applySchema(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current !== SCHEMA_VERSION) {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    db.transaction(() => {
      for (const { name } of tables) db.exec(`DROP TABLE IF EXISTS "${name}"`);
    })();
  }
  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schema);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

/** Full wipe of all data tables (keeps schema). Used by Reset + reseed. */
export function wipeAll(db: DB): void {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  const tx = db.transaction(() => {
    for (const { name } of tables) db.exec(`DELETE FROM "${name}"`);
  });
  tx();
}

/** Read the singleton sim_state row (throws if unseeded). */
export function getSimState(db: DB) {
  return db.prepare("SELECT * FROM sim_state WHERE id = 1").get() as
    | {
        id: number;
        sim_min: number;
        speed: number;
        running: number;
        seed: number;
        sensing_coverage: number;
        alarm_delay_min: number;
        dead_olt: string | null;
        repair_window_hrs: number;
        model_version: number;
      }
    | undefined;
}

export function isSeeded(db: DB): boolean {
  const row = db.prepare("SELECT COUNT(*) n FROM topology_truth").get() as { n: number };
  return row.n > 0;
}
