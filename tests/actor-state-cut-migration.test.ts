import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openJournal } from '../src/adapters/journal.ts';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import { CircumstanceWriteSchema } from '../src/domain/direction-circumstances.ts';
import { canonical, draftFixture } from './fixtures/continuista.ts';

// Restores the exact v33 storage boundary: no private-state checkpoint tables.
// Durable snapshot bytes and hashes are evidence; present mutable state cannot
// substitute for a checkpoint that was never recorded.
test('v33→v37 conserva bytes y hashes históricos sin fabricar cortes; sólo captura el próximo commit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-actor-cut-migration-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  try {
    const ready = validateRunConfiguration({ draft: draftFixture() });
    if (ready.kind !== 'ready') assert.fail('Fixture inválido');
    const configuration = ready.configuration;
    const initial = configuration.worldSnapshot;
    const prepared = configuration.roster.preparedCharacters[0]; assert.ok(prepared);
    const runId = configuration.runId;
    const actorId = prepared.characterId;
    journal.registerWorldRun({ initialSnapshot: initial, configurationRevision: configuration.configRevision, configuration,
      continuityFence: { kind: 'prepared-contexts', atWorldSeq: initial.seq, contexts: [{ actorId,
        continuityId: prepared.continuity.continuityId, continuityRevision: prepared.continuity.revision,
        continuityContentHash: prepared.continuity.contentHash, identityVersion: prepared.identityVersion,
        preparedContextHash: createHash('sha256').update(canonical(prepared)).digest('hex') }] }, lifecycle: 'paused' });
    const changeLighting = (level: 'dim' | 'bright') => {
      const options = journal.readCircumstanceOptions({ runId, scope: { kind: 'run' } }); assert.ok(options);
      return journal.applyCircumstanceCommand(CircumstanceWriteSchema.parse({ runId, principalId: 'migration-audit',
        operationId: randomUUID(), idempotencyKey: randomUUID(), expectedWorldRevision: options.worldRevision,
        expectedDirectionRevision: options.directionRevision,
        payload: { kind: 'changeCircumstance', scope: { kind: 'run' }, operation: { kind: 'setLighting', placeId: 'sala', level } } }));
    };
    const first = changeLighting('dim'); assert.equal(first.kind, 'stored');
    const legacyWorld = journal.loadWorld({ runId }); assert.ok(legacyWorld);
    journal.close();
    const legacy = new DatabaseSync(path);
    let runBytes: unknown;
    let commitBytes: unknown;
    try {
      runBytes = legacy.prepare('SELECT * FROM world_runs').all();
      commitBytes = legacy.prepare('SELECT * FROM world_commits ORDER BY commit_index').all();
      assert.ok(Array.isArray(commitBytes) && commitBytes.length > 0);
      legacy.exec(`BEGIN; DROP TABLE actor_state_cuts; DROP TABLE actor_state_cut_batches;
        DROP TABLE IF EXISTS fork_projection_receipts; DROP TABLE IF EXISTS fork_job_history; DROP TABLE IF EXISTS fork_dramatic_seeds; DROP TABLE IF EXISTS fork_job_retries; DROP TABLE IF EXISTS fork_backup_sources; DROP TABLE IF EXISTS fork_jobs; DELETE FROM schema_version WHERE version IN(34,35,36,37); COMMIT;`);
      assert.equal(legacy.prepare('SELECT MAX(version) AS version FROM schema_version').get()?.version, 33);
    } finally { legacy.close(); }
    journal = openJournal({ path });
    const inspection = new DatabaseSync(path);
    try {
      assert.equal(inspection.prepare('SELECT MAX(version) AS version FROM schema_version').get()?.version, 37);
      assert.deepEqual(inspection.prepare('SELECT * FROM world_runs').all(), runBytes);
      assert.deepEqual(inspection.prepare('SELECT * FROM world_commits ORDER BY commit_index').all(), commitBytes);
      assert.equal(inspection.prepare('SELECT COUNT(*) AS n FROM actor_state_cuts').get()?.n, 0);
      assert.equal(inspection.prepare('SELECT COUNT(*) AS n FROM actor_state_cut_batches').get()?.n, 0);
      assert.deepEqual(inspection.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { inspection.close(); }
    const oldRequest = { runId, actorId, worldRevision: legacyWorld.revision, worldSeq: legacyWorld.seq, commitIndex: 1 };
    assert.deepEqual(journal.readActorStateCut(oldRequest), { kind: 'unavailable', reason: 'checkpoint-not-recorded' });
    assert.deepEqual(journal.readActorStateCut({ runId, actorId, worldRevision: initial.revision, worldSeq: initial.seq, commitIndex: 0 }),
      { kind: 'unavailable', reason: 'checkpoint-not-recorded' });
    assert.equal(changeLighting('bright').kind, 'stored');
    const current = journal.loadWorld({ runId }); assert.ok(current);
    const request = { runId, actorId, worldRevision: current.revision, worldSeq: current.seq, commitIndex: 2 };
    const captured = journal.readActorStateCut(request); assert.equal(captured.kind, 'found');
    if (captured.kind !== 'found') assert.fail('Falta corte del commit posterior a la migración');
    assert.equal(captured.cut.source.commitIndex, 2);
    assert.equal(captured.cut.actorId, actorId);
    assert.deepEqual(journal.readActorStateCut(oldRequest), { kind: 'unavailable', reason: 'checkpoint-not-recorded' });
    journal.close(); journal = openJournal({ path });
    assert.deepEqual(journal.readActorStateCut(request), captured);
    assert.deepEqual(journal.readActorStateCut(oldRequest), { kind: 'unavailable', reason: 'checkpoint-not-recorded' });
    const reopened = new DatabaseSync(path);
    try {
      assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM actor_state_cut_batches').get()?.n, 1);
      assert.deepEqual(reopened.prepare('SELECT commit_index FROM actor_state_cut_batches').all().map(row => row.commit_index), [2]);
      assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { reopened.close(); }
  } finally {
    try { journal.close(); } catch { /* openJournal closes a rejected migration handle. */ }
    rmSync(directory, { recursive: true, force: true });
  }
});
