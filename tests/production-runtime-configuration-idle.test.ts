import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { createProductionHost } from '../src/server/production-host.ts';
import { createCleanReadyPreflightFixture } from './fixtures/preflight.ts';

const BUSY = 'PRODUCTION_RUNTIME_CONFIGURATION_BUSY';

async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'personajes-runtime-configuration-idle-'));
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  const production = await createProductionHost({
    host: openLocalHost({ privateDataRoot: root }), catalog, admissionBarrier: createHostRequestBarrier(),
  });
  t.after(async () => {
    try { await production.close(); }
    finally { rmSync(root, { recursive: true, force: true }); rmSync(root + '-auth', { recursive: true, force: true }); }
  });
  const ready = createCleanReadyPreflightFixture({ journal: production.host.journal });
  return { root, production, ready };
}

test('production runtime configuration gate distinguishes active work from inert paused/stopped history', async (t) => {
  const { root, production, ready } = await fixture(t);
  const { runId, configuration } = ready;
  const lifecycleWrite = (target: 'running' | 'paused' | 'stopped') => production.host.journal.setWorldLifecycle({
    runId, expectedWorldRevision: configuration.worldSnapshot.revision,
    expectedConfigRevision: configuration.configRevision, target,
  });

  assert.doesNotThrow(() => production.assertRuntimeConfigurationIdle());
  assert.equal(lifecycleWrite('running'), 'updated');
  assert.throws(() => production.assertRuntimeConfigurationIdle(), { message: BUSY });
  assert.equal(lifecycleWrite('stopped'), 'updated');

  const writer = new DatabaseSync(join(root, 'world.sqlite'));
  try {
    writer.exec('PRAGMA foreign_keys=OFF');
    const now = Date.now();
    // A queued actor job from an invalidated lifecycle epoch is durable history,
    // not a live claim that should make a stopped world impossible to recompose.
    const staleActorJob = randomUUID();
    const staleActorId = randomUUID();
    const stalePulse = randomUUID();
    writer.prepare(`INSERT INTO actor_turn_jobs(run_id,actor_id,job_id,generation,pulse_id,state,
      owner_token,claim_token,created_at,updated_at,frozen_perception_ids_json,frozen_world_cut_json,failure_code)
      VALUES(?,?,?,?,?,'queued',NULL,NULL,?,?,NULL,NULL,NULL)`)
      .run(runId, staleActorId, staleActorJob, 0, stalePulse, now, now);
    writer.prepare(`INSERT INTO continuista_jobs(job_id,generation,run_id,actor_id,actor_job_id,actor_generation,pulse_id,proposal_id,proposal_version,
      context_hash,context_json,actor_execution_json,state,owner_token,claim_token,failure_code,created_at,updated_at)
      VALUES(?,0,?,?,?,?,?,?,0,?,'{}','{}','queued',NULL,NULL,NULL,?,?)`)
      .run(randomUUID(), runId, staleActorId, staleActorJob, 0, stalePulse, randomUUID(), 'hash', now, now);
    assert.doesNotThrow(() => production.assertRuntimeConfigurationIdle());
    const oldJob = randomUUID();
    const oldPulse = randomUUID();
    writer.prepare('INSERT INTO request_reservations(job_id,generation,request_seq,run_id,pulse_id,state) VALUES(?,0,1,?,?,?)')
      .run(oldJob, runId, oldPulse, 'ambiguous');
    writer.prepare(`INSERT INTO model_time_spans(job_id,generation,request_seq,run_id,pulse_id,clock_epoch_id,owner_token,reserved_ms,state,
      start_monotonic_ns,stop_monotonic_ns,measured_ms,expiry_reason,settlement_hash) VALUES(?,0,1,?,?,?,?,1,'uncertain','1',NULL,NULL,'host-interrupted',NULL)`)
      .run(oldJob, runId, oldPulse, randomUUID(), randomUUID());
    assert.doesNotThrow(() => production.assertRuntimeConfigurationIdle(), 'old-owner uncertainty remains historical');
  } finally { writer.close(); }
});

test('production runtime configuration gate rejects durable queued maintenance and live runtime claims', async (t) => {
  const { root, production, ready } = await fixture(t);
  const db = new DatabaseSync(join(root, 'world.sqlite'));
  db.exec('PRAGMA foreign_keys=OFF');
  const now = Date.now();
  const actorId = randomUUID();
  const jobId = randomUUID();
  const operationId = randomUUID();
  const pulseId = randomUUID();
  const scenarios: Array<{ name: string; insert: () => void; remove: () => void }> = [
    {
      name: 'memory preparation queue',
      insert: () => db.prepare(`INSERT INTO memory_preparation_jobs(job_id,run_id,principal_id,state,revision,created_at,updated_at,data_json,data_hash)
        VALUES(?,?,?,'queued',0,?,?,?,?)`).run(randomUUID(), ready.runId, 'test', now, now, '{}', 'hash'),
      remove: () => db.prepare("DELETE FROM memory_preparation_jobs WHERE run_id=? AND principal_id='test'").run(ready.runId),
    },
    {
      name: 'staging fork',
      insert: () => db.prepare(`INSERT INTO fork_jobs(operation_id,principal_id,idempotency_key,target_run_id,state,request_hash,job_json,job_hash,package_json,package_hash)
        VALUES(?,?,?,?,'staging',?,?,?,'{}',?)`).run(operationId, 'test', randomUUID(), randomUUID(), 'hash', '{}', 'hash', 'hash'),
      remove: () => db.prepare('DELETE FROM fork_jobs WHERE operation_id=?').run(operationId),
    },
    {
      name: 'configurator queue',
      insert: () => db.prepare('INSERT INTO configurator_jobs(job_id,principal_id,run_id,actor_id,payload_json,payload_hash) VALUES(?,?,?,?,?,?)')
        .run(randomUUID(), 'test', ready.runId, actorId, JSON.stringify({ job: { state: 'queued' } }), 'hash'),
      remove: () => db.prepare("DELETE FROM configurator_jobs WHERE principal_id='test' AND actor_id=?").run(actorId),
    },
    {
      name: 'active Pi reservation',
      insert: () => {
        db.prepare('INSERT INTO request_reservations(job_id,generation,request_seq,run_id,pulse_id,state) VALUES(?,?,?,?,?,?)')
          .run(jobId, 0, 1, ready.runId, pulseId, 'reserved');
        db.prepare(`INSERT INTO model_time_spans(job_id,generation,request_seq,run_id,pulse_id,clock_epoch_id,owner_token,reserved_ms,state,
          start_monotonic_ns,stop_monotonic_ns,measured_ms,expiry_reason,settlement_hash) VALUES(?,0,1,?,?,?,?,1,'reserved',NULL,NULL,NULL,NULL,NULL)`)
          .run(jobId, ready.runId, pulseId, randomUUID(), production.host.ownerToken);
      },
      remove: () => {
        db.prepare('DELETE FROM model_time_spans WHERE job_id=?').run(jobId);
        db.prepare('DELETE FROM request_reservations WHERE job_id=?').run(jobId);
      },
    },
    {
      name: 'active voice operation',
      insert: () => db.prepare(`INSERT INTO voice_operations(id,principal,run_id,request_hash,dedupe,data,work,data_hash,work_hash)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(operationId, 'test', ready.runId, 'hash', null, JSON.stringify({ state: 'submitted' }), '{}', 'hash', 'hash'),
      remove: () => db.prepare('DELETE FROM voice_operations WHERE id=?').run(operationId),
    },
    {
      name: 'running actor claim',
      insert: () => db.prepare(`INSERT INTO actor_turn_jobs(run_id,actor_id,job_id,generation,pulse_id,state,owner_token,claim_token,created_at,updated_at,
        frozen_perception_ids_json,frozen_world_cut_json,failure_code) VALUES(?,?,?,?,?,'running',?,?,?, ?,NULL,NULL,NULL)`)
        .run(ready.runId, actorId, jobId, 0, pulseId, production.host.ownerToken, randomUUID(), now, now),
      remove: () => db.prepare('DELETE FROM actor_turn_jobs WHERE job_id=?').run(jobId),
    },
    {
      name: 'running continuista claim',
      insert: () => db.prepare(`INSERT INTO continuista_jobs(job_id,generation,run_id,actor_id,actor_job_id,actor_generation,pulse_id,proposal_id,proposal_version,
        context_hash,context_json,actor_execution_json,state,owner_token,claim_token,failure_code,created_at,updated_at)
        VALUES(?,0,?,?,?,?,?,?,0,?,'{}','{}','running',?,?,NULL,?,?)`)
        .run(randomUUID(), ready.runId, actorId, jobId, 0, pulseId, randomUUID(), 'hash', production.host.ownerToken, randomUUID(), now, now),
      remove: () => db.prepare("DELETE FROM continuista_jobs WHERE run_id=? AND state='running'").run(ready.runId),
    },
    {
      name: 'running administrative claim',
      insert: () => db.prepare(`INSERT INTO administrative_jobs(job_id,generation,run_id,pulse_id,role,lifecycle_revision,world_revision,through_world_seq,
        context_json,context_hash,state,owner_token,claim_token,failure_code,created_at,updated_at)
        VALUES(?,0,?,?,'director',0,0,0,'{}','hash','running',?,?,NULL,?,?)`)
        .run(randomUUID(), ready.runId, pulseId, production.host.ownerToken, randomUUID(), now, now),
      remove: () => db.prepare("DELETE FROM administrative_jobs WHERE run_id=? AND state='running'").run(ready.runId),
    },
  ];
  try {
    for (const scenario of scenarios) {
      scenario.insert();
      assert.throws(() => production.assertRuntimeConfigurationIdle(), { message: BUSY }, scenario.name);
      scenario.remove();
      assert.doesNotThrow(() => production.assertRuntimeConfigurationIdle(), `${scenario.name} cleared`);
    }
  } finally { db.close(); }
});

test('production runtime configuration gate rejects after production host shutdown', async (t) => {
  const { production } = await fixture(t);
  await production.close();
  assert.throws(() => production.assertRuntimeConfigurationIdle(), { message: BUSY });
});
