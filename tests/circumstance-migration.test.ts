import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openJournal } from '../src/adapters/journal.ts';
import { setup, runId } from './fixtures/continuista.ts';

function downgradeTo32(database: DatabaseSync) {
  const stored = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='coordinator_pulses'").get()?.sql;
  assert.equal(typeof stored, 'string');
  if (typeof stored !== 'string') throw new Error('Falta esquema del coordinador');
  const legacy = stored.replace('coordinator_pulses', 'coordinator_pulses_legacy').replace("'directionCircumstance',", '');
  database.exec(`PRAGMA foreign_keys=OFF; BEGIN; ${legacy};
    INSERT INTO coordinator_pulses_legacy SELECT * FROM coordinator_pulses;
    DROP TABLE coordinator_pulses;
    ALTER TABLE coordinator_pulses_legacy RENAME TO coordinator_pulses;
    CREATE UNIQUE INDEX coordinator_pulses_one_running ON coordinator_pulses(run_id) WHERE state='running';
    DROP TABLE circumstance_operations;
    DROP TABLE IF EXISTS actor_state_cuts; DROP TABLE IF EXISTS actor_state_cut_batches; DROP TABLE IF EXISTS fork_projection_receipts; DROP TABLE IF EXISTS fork_job_history; DROP TABLE IF EXISTS fork_dramatic_seeds; DROP TABLE IF EXISTS fork_job_retries; DROP TABLE IF EXISTS fork_backup_sources; DROP TABLE IF EXISTS fork_jobs; DROP TABLE IF EXISTS run_configuration_revisions; DELETE FROM schema_version WHERE version IN(33,34,35,36,37,38);
    COMMIT; PRAGMA foreign_keys=ON;`);
}

for (const corruptChild of [false, true]) {
  test(`v32→v33 ${corruptChild ? 'revierte integralmente ante FK inválida' : 'conserva pulsos y referencias tras reabrir'}`, async () => {
    const fixture = await setup();
    const path = join(fixture.directory, 'journal.sqlite');
    const pulseId = fixture.claim.jobId;
    fixture.journal.close();
    let journal: ReturnType<typeof openJournal> | undefined;
    try {
      const legacy = new DatabaseSync(path);
      let expected: unknown;
      try {
        legacy.exec('PRAGMA foreign_keys=ON');
        legacy.prepare('INSERT INTO pulses(pulse_id,run_id,max_calls,consumed) VALUES(?,?,10,0)').run(pulseId, runId);
        legacy.prepare(`INSERT INTO coordinator_pulses(pulse_id,run_id,origin_kind,origin_id,commit_index,configuration_hash,state,created_at,updated_at,lifecycle_revision)
          SELECT ?,run_id,'humanIntervention',origin_id,commit_index,?, 'completed',0,0,0 FROM world_commits WHERE run_id=? LIMIT 1`)
          .run(pulseId, 'a'.repeat(64), runId);
        legacy.exec('CREATE TABLE migration_audit_child(pulse_id TEXT NOT NULL REFERENCES coordinator_pulses(pulse_id))');
        legacy.prepare('INSERT INTO migration_audit_child VALUES(?)').run(pulseId);
        downgradeTo32(legacy);
        if (corruptChild) {
          legacy.exec('PRAGMA foreign_keys=OFF');
          legacy.prepare('INSERT INTO migration_audit_child VALUES(?)').run('00000000-0000-4000-8000-999999999999');
        }
        expected = legacy.prepare('SELECT * FROM coordinator_pulses').all();
      } finally { legacy.close(); }
      if (corruptChild) assert.throws(() => openJournal({ path }), /Migración v33 produjo referencias inválidas/);
      else { journal = openJournal({ path }); journal.close(); journal = openJournal({ path }); }
      const after = new DatabaseSync(path);
      try {
        assert.deepEqual(after.prepare('SELECT * FROM coordinator_pulses').all(), expected);
        assert.equal(after.prepare('SELECT MAX(version) AS n FROM schema_version').get()?.n, corruptChild ? 32 : 38);
        assert.equal(after.prepare("SELECT name FROM sqlite_master WHERE name='coordinator_pulses_v33'").get(), undefined);
        assert.equal(after.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='circumstance_operations'").get()?.n, corruptChild ? 0 : 1);
        if (!corruptChild) {
          assert.deepEqual(after.prepare('PRAGMA foreign_key_check').all(), []);
          after.exec('PRAGMA foreign_keys=ON');
          assert.throws(() => after.prepare('DELETE FROM coordinator_pulses WHERE pulse_id=?').run(pulseId), /FOREIGN KEY/);
          const directionPulseId = '00000000-0000-4000-8000-111111111111';
          after.prepare('INSERT INTO pulses(pulse_id,run_id,max_calls,consumed) VALUES(?,?,10,0)').run(directionPulseId, runId);
          const insertDirection = after.prepare(`INSERT INTO coordinator_pulses(pulse_id,run_id,origin_kind,origin_id,commit_index,configuration_hash,state,created_at,updated_at,lifecycle_revision)
            SELECT ?,run_id,'directionCircumstance','direction-operation',?,configuration_hash,'completed',0,0,0 FROM coordinator_pulses WHERE pulse_id=?`);
          assert.throws(() => insertDirection.run(directionPulseId, null, pulseId), /CHECK/);
          assert.equal(insertDirection.run(directionPulseId, 1, pulseId).changes, 1);
          assert.deepEqual(after.prepare('PRAGMA foreign_key_check').all(), []);
        } else {
          assert.equal(after.prepare("SELECT sql FROM sqlite_master WHERE name='coordinator_pulses'").get()?.sql?.toString().includes('directionCircumstance'), false);
        }
      } finally { after.close(); }
    } finally { journal?.close(); rmSync(fixture.directory, {recursive:true,force:true}); }
  });
}
