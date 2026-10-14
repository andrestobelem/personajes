import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openJournal } from '../src/adapters/journal.ts';
import { freezeExperience } from '../src/application/experience-envelope.ts';

const runId = '00000000-0000-4000-8000-000000000001';
const pulseId = '00000000-0000-4000-8000-000000000002';
const jobA = '00000000-0000-4000-8000-000000000003';
const jobB = '00000000-0000-4000-8000-000000000004';

test('dos jobs comparten cuota de pulso y restart no la reinicia', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-journal-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  try {
    journal.configureRun({ runId, maxCalls: 5 });
    journal.configurePulse({ runId, pulseId, maxCalls: 1 });
    const request = { runId, pulseId, jobId: jobA, generation: 0, requestSeq: 0 };
    assert.deepEqual(journal.reserveRequest(request), { kind: 'reserved' });
    journal.close();
    journal = openJournal({ path });
    assert.deepEqual(journal.reserveRequest(request), { kind: 'existing' });
    assert.deepEqual(journal.reserveRequest({ ...request, jobId: jobB }), { kind: 'exhausted', scope: 'pulse' });
    assert.throws(() => journal.configurePulse({ runId, pulseId, maxCalls: 20 }));
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('ledger durable mantiene dueño/corte y rechaza payload distinto por ID', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-memory-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  try {
    const input = {
      schemaVersion: 1, experienceId: jobA, runId, actorId: 'maxwell-smart', kind: 'belief',
      content: 'No vi a 99 salir.', sourceRefs: [], fictitiousAt: 0, receivedAt: 0,
      worldSeq: 5, confidence: 0.5, revision: 0, predecessor: { kind: 'initial' }, basedOn: [],
    };
    const frozen = freezeExperience(input);
    assert.equal(journal.recordExperience(frozen).kind, 'stored');
    journal.close();
    journal = openJournal({ path });
    assert.equal(journal.recordExperience(frozen).kind, 'existing');
    assert.throws(() => journal.recordExperience(freezeExperience({ ...input, content: 'Vi a 99 salir.' })));
    assert.equal(journal.readExperiences({ runId, actorId: 'agente-99', throughWorldSeq: 5 }).length, 0);
    assert.equal(journal.readExperiences({ runId, actorId: 'maxwell-smart', throughWorldSeq: 4 }).length, 0);
    assert.equal(journal.readExperiences({ runId, actorId: 'maxwell-smart', throughWorldSeq: 5 })[0]?.content, input.content);
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('schema futuro no se migra ni se altera al rechazarlo', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-future-'));
  const path = join(directory, 'world.sqlite');
  const database = new DatabaseSync(path);
  try {
    database.exec('CREATE TABLE schema_version(version INTEGER PRIMARY KEY); INSERT INTO schema_version VALUES(26)');
    assert.throws(() => openJournal({ path }), /no soportada/);
    assert.deepEqual(database.prepare('SELECT version FROM schema_version').all().map((row) => row.version), [26]);
    assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name='experiences'").get(), undefined);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('migraciones explícitas v1→v25 conservan experiencias, ledger, percepciones, jobs e intenciones', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-migrate-v2-'));
  const path = join(directory, 'world.sqlite');
  const database = new DatabaseSync(path);
  const input = {
    schemaVersion: 1, experienceId: jobA, runId, actorId: 'maxwell-smart', kind: 'belief',
    content: 'No vi a 99 salir.', sourceRefs: [], fictitiousAt: 0, receivedAt: 0,
    worldSeq: 5, confidence: 0.5, revision: 0, predecessor: { kind: 'initial' }, basedOn: [],
  };
  const frozen = freezeExperience(input);
  try {
    database.exec(`
      CREATE TABLE schema_version(version INTEGER PRIMARY KEY);
      INSERT INTO schema_version VALUES(1);
      CREATE TABLE experiences(
        experience_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, actor_id TEXT NOT NULL,
        world_seq INTEGER NOT NULL, canonical_payload TEXT NOT NULL, payload_hash TEXT NOT NULL
      );
    `);
    database.prepare('INSERT INTO experiences VALUES(?,?,?,?,?,?)').run(
      frozen.envelope.experienceId, frozen.envelope.runId, frozen.envelope.actorId,
      frozen.envelope.worldSeq, frozen.canonicalPayload, frozen.payloadHash,
    );
    database.close();

    const journal = openJournal({ path });
    try {
      const claim = journal.claimNextMemoryProjection({
        runId, actorId: 'maxwell-smart', ownerToken: '00000000-0000-4000-8000-000000000005',
        claimToken: '00000000-0000-4000-8000-000000000006',
      });
      assert.equal(claim.kind, 'claimed');
      if (claim.kind === 'claimed') assert.equal(claim.frozen.canonicalPayload, frozen.canonicalPayload);
      assert.deepEqual(journal.claimNextMemoryProjection({
        runId, actorId: 'maxwell-smart', ownerToken: '00000000-0000-4000-8000-000000000007',
        claimToken: '00000000-0000-4000-8000-000000000008',
      }), { kind: 'busy' }, 'otro worker no puede iniciar una segunda proyección ICM de la misma Experience');
      const versions = new DatabaseSync(path);
      try {
        assert.deepEqual(versions.prepare('SELECT version FROM schema_version ORDER BY version').all()
          .map((row) => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
        const perceptionColumns = versions.prepare("PRAGMA table_info('world_perceptions')").all();
        assert.equal(perceptionColumns.find((row) => row.name === 'attempt_id')?.notnull, 0);
        assert.deepEqual(versions.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='world_commits'")
          .all().map((row) => row.name), ['world_commits']);
      assert.deepEqual(versions.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'actor_pi_%' ORDER BY name")
        .all().map((row) => row.name), [
          'actor_pi_candidates', 'actor_pi_consumptions', 'actor_pi_sessions', 'actor_pi_turn_receipts',
        ]);
        assert.deepEqual(versions.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='actor_turn_intents'")
          .all().map((row) => row.name), ['actor_turn_intents']);
        assert.deepEqual(versions.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN('actor_turn_jobs','actor_turn_job_inputs') ORDER BY name")
          .all().map((row) => row.name), ['actor_turn_job_inputs', 'actor_turn_jobs']);
        assert.ok(versions.prepare("PRAGMA table_info('actor_turn_jobs')").all()
          .some((row) => row.name === 'frozen_perception_ids_json'));
        assert.ok(versions.prepare("PRAGMA table_info('actor_turn_jobs')").all()
          .some((row) => row.name === 'frozen_world_cut_json'));
      } finally { versions.close(); }
    } finally { journal.close(); }
  } finally {
    try { database.close(); } catch { /* Closed before migration. */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('la migración v4 revierte esquema y versión si una review heredada es inválida', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-migration-rollback-'));
  const path = join(directory, 'world.sqlite');
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE schema_version(version INTEGER PRIMARY KEY);
      INSERT INTO schema_version VALUES(3);
      CREATE TABLE world_proposals(run_id TEXT, proposal_id TEXT, version INTEGER, attempt_hash TEXT);
      CREATE TABLE world_reviews(run_id TEXT, proposal_id TEXT, version INTEGER, payload_json TEXT);
      CREATE TABLE world_perceptions(run_id TEXT, event_id TEXT, recipient_actor_id TEXT, attempt_id TEXT);
      INSERT INTO world_reviews VALUES('run','proposal',1,'{malformed');
    `);
    database.close();

    assert.throws(() => openJournal({ path }), /JSON durable inválido/);

    const afterFailure = new DatabaseSync(path);
    try {
      assert.deepEqual(afterFailure.prepare('SELECT version FROM schema_version ORDER BY version').all()
        .map((row) => row.version), [1, 3]);
      assert.deepEqual(afterFailure.prepare("PRAGMA table_info('world_proposals')").all()
        .map((row) => row.name), ['run_id', 'proposal_id', 'version', 'attempt_hash']);
      assert.deepEqual(afterFailure.prepare("PRAGMA table_info('world_reviews')").all()
        .map((row) => row.name), ['run_id', 'proposal_id', 'version', 'payload_json']);
      assert.equal(afterFailure.prepare("SELECT name FROM sqlite_master WHERE name='world_perception_experiences'").get(), undefined);
      assert.equal(afterFailure.prepare("SELECT name FROM sqlite_master WHERE name='world_proposals_job_slot'").get(), undefined);
    } finally { afterFailure.close(); }
  } finally {
    try { database.close(); } catch { /* Closed before migration. */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('sólo no-dispatch devuelve cuota y secuencias nuevas son durables', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-reservations-'));
  const path = join(directory, 'world.sqlite');
  const journal = openJournal({ path });
  try {
    journal.configureRun({ runId, maxCalls: 2 });
    journal.configurePulse({ runId, pulseId, maxCalls: 1 });
    const job = { runId, pulseId, jobId: jobA, generation: 0 };
    assert.deepEqual(journal.reserveNextRequest(job), { kind: 'reserved', requestSeq: 0 });
    journal.transitionReservation({ jobId: jobA, generation: 0, requestSeq: 0, target: 'undispatched' });
    journal.transitionReservation({ jobId: jobA, generation: 0, requestSeq: 0, target: 'undispatched' });
    assert.deepEqual(journal.reserveNextRequest(job), { kind: 'reserved', requestSeq: 1 });
    journal.transitionReservation({ jobId: jobA, generation: 0, requestSeq: 1, target: 'dispatched' });
    assert.throws(() => journal.transitionReservation({ jobId: jobA, generation: 0, requestSeq: 1, target: 'undispatched' }));
    journal.transitionReservation({ jobId: jobA, generation: 0, requestSeq: 1, target: 'ambiguous' });
    assert.deepEqual(journal.reserveNextRequest({ ...job, jobId: jobB }), { kind: 'exhausted', scope: 'pulse' });
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});
