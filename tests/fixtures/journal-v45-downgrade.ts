import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

/** Rebuild coordinator_pulses as it existed in v44, preserving its rows and indexes. */
export function downgradeCoordinatorPulsesTo44(database: DatabaseSync) {
  const current = z.strictObject({ sql: z.string().nullable() }).optional()
    .parse(database.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='coordinator_pulses'").get());
  if (current?.sql === null || current === undefined) throw new Error('coordinator_pulses v45 DDL missing');

  const indexes = z.array(z.strictObject({ sql: z.string() })).parse(database.prepare(
    "SELECT sql FROM sqlite_schema WHERE type='index' AND tbl_name='coordinator_pulses' AND sql IS NOT NULL ORDER BY name").all());
  const legacySql = current.sql
    .replace(/^CREATE TABLE (?:"coordinator_pulses"|coordinator_pulses)\s*\(/i, 'CREATE TABLE coordinator_pulses_v44(')
    .replace(/,'actorInitiative'/g, '')
    .replace(/,\s*\)/g, ')')
    .replace(/REFERENCES coordinator_pulses\(/g, 'REFERENCES coordinator_pulses_v44(');
  if (legacySql === current.sql || legacySql.includes("'actorInitiative'")) {
    throw new Error('coordinator_pulses v45 DDL did not match the approved v44 downgrade');
  }

  const columns = z.array(z.object({ name: z.string() })).parse(database.prepare('PRAGMA table_info(coordinator_pulses)').all())
    .map(column => column.name);
  const quotedColumns = columns.map(column => `"${column}"`).join(',');
  database.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
  try {
    database.exec(legacySql);
    database.exec(`INSERT INTO coordinator_pulses_v44(${quotedColumns}) SELECT ${quotedColumns} FROM coordinator_pulses;
      DROP TABLE coordinator_pulses;
      ALTER TABLE coordinator_pulses_v44 RENAME TO coordinator_pulses;`);
    for (const index of indexes) database.exec(index.sql);
    database.exec('COMMIT; PRAGMA foreign_keys=ON;');
  } catch (error) {
    try { database.exec('ROLLBACK; PRAGMA foreign_keys=ON;'); } catch { /* Preserve the original fixture error. */ }
    throw error;
  }
}
