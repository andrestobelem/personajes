import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openLocalHost } from '../src/application/local-host.ts';
import { isHostOwnershipFailure } from '../src/adapters/host-ownership.ts';
import { WorldSnapshotSchema } from '../src/domain/world.ts';
import { HashSchema, WorldSeqSchema } from '../src/domain/values.ts';
import { createActorTurnWorker } from '../src/application/actor-turn-worker.ts';
import { assembleContinuistaReviewContext } from '../src/application/continuista-review-context.ts';
import { setup, deterministicFactory } from './fixtures/continuista.ts';

const runId = '00000000-0000-4000-8000-000000000101';
const pulseId = '00000000-0000-4000-8000-000000000102';
const jobId = '00000000-0000-4000-8000-000000000103';
const actorId = 'maxwell-smart';

function worldSnapshot() {
  const sceneId = '00000000-0000-4000-8000-000000000104';
  return WorldSnapshotSchema.parse({
    schemaVersion: 1, runId, revision: 0, seq: 0,
    clock: { instant: 0, convention: { kind: 'fixedOffset', offsetMinutes: -180, label: 'Buenos Aires' } },
    places: [{ id: 'sala', name: 'Sala', description: 'Una sala.', width: 10, height: 10, lighting: 'normal' }],
    doors: [], connections: [], perceptualPaths: [],
    channels: [{ kind: 'speech', id: '00000000-0000-4000-8000-000000000105', label: 'Voz', enabled: true, maxRange: 5, scope: 'addressed', placeIds: ['sala'] }],
    entities: [{
      kind: 'character', entityId: '00000000-0000-4000-8000-000000000106', characterId: actorId,
      trueDisplayName: 'Maxwell Smart', species: 'human', presentation: { kind: 'ordinary', label: 'Maxwell Smart' },
      placeId: 'sala', position: { x: 1, y: 1 }, collisionRadius: 0.25, blocksMovement: false,
      presence: { kind: 'present', sceneId },
      preparation: { kind: 'prepared', continuityId: 'continuity-main', identityVersion: 1 },
      capabilities: ['observe', 'speak', 'wait'], availability: { kind: 'available' },
      routine: { kind: 'always' }, mind: { goals: [], beliefs: [], relationships: [], recognizedCharacterIds: [], experiences: [] },
    }],
    inventory: [],
    scenes: [{ id: sceneId, label: 'La sala', lifecycle: { kind: 'open', startedAt: 0 }, participantIds: [actorId], placeIds: ['sala'] }],
    activeSceneId: sceneId, offers: [],
    actionDurations: {
      observeMs: 25, speechMs: 200, gestureMs: 100, takeMs: 100, offerMs: 100,
      acceptOfferMs: 100, maxWaitMs: 5_000, maxRestMs: 10_000, offerValidityMs: 5_000, interactionRange: 2,
    },
  });
}

test('el host adquiere ownership antes del journal y cierra ambos sin borrar datos', (t) => {
  const privateDataRoot = mkdtempSync(join(tmpdir(), 'personajes-host-'));
  t.after(() => rmSync(privateDataRoot, { recursive: true, force: true }));
  const first = openLocalHost({ privateDataRoot });
  assert.match(first.ownerToken, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.throws(() => openLocalHost({ privateDataRoot }),
    (error: unknown) => isHostOwnershipFailure(error) && error.code === 'ALREADY_OWNED');
  first.close();
  first.close();
  const sqlite = readFileSync(join(privateDataRoot, 'world.sqlite'));
  assert.equal(sqlite.subarray(0, 15).toString('ascii'), 'SQLite format 3');
  const next = openLocalHost({ privateDataRoot });
  assert.notEqual(next.ownerToken, first.ownerToken);
  next.close();
});

test('openLocalHost recupera el job actoral de un owner previo y conserva su inbox congelado', (t) => {
  const privateDataRoot = mkdtempSync(join(tmpdir(), 'personajes-host-job-recovery-'));
  t.after(() => rmSync(privateDataRoot, { recursive: true, force: true }));
  const previous = openLocalHost({ privateDataRoot });
  previous.journal.registerWorldRun({
    initialSnapshot: worldSnapshot(), configurationRevision: 0, configuration: { test: true },
    continuityFence: {
      kind: 'prepared-contexts', atWorldSeq: 0,
      contexts: [{
        actorId, continuityId: 'continuity-main', continuityRevision: 0,
        continuityContentHash: HashSchema.parse('b'.repeat(64)), identityVersion: 1,
        preparedContextHash: HashSchema.parse('a'.repeat(64)),
      }],
    },
    lifecycle: 'ready',
  });
  previous.journal.configureRun({ runId, maxCalls: 2 });
  previous.journal.configurePulse({ runId, pulseId, maxCalls: 2 });
  const database = new DatabaseSync(join(privateDataRoot, 'world.sqlite'));
  try {
    database.prepare(`
      INSERT INTO actor_turn_jobs(
        run_id,actor_id,job_id,generation,pulse_id,state,owner_token,claim_token,created_at,updated_at,
        frozen_perception_ids_json,frozen_world_cut_json
      ) VALUES(?,?,?,?,?,'running',?,?,?,?,'[]','{\"fictionalAt\":0,\"perceptionIds\":[],\"worldRevision\":0,\"worldSeq\":0}')
    `).run(runId, actorId, jobId, 0, pulseId, previous.ownerToken,
      '00000000-0000-4000-8000-000000000107', Date.now(), Date.now());
  } finally { database.close(); }
  const oldOwner = previous.ownerToken;
  previous.close();

  const recovered = openLocalHost({ privateDataRoot });
  try {
    const afterRecovery = new DatabaseSync(join(privateDataRoot, 'world.sqlite'));
    try {
      const job = afterRecovery.prepare(`
        SELECT run_id,actor_id,job_id,generation,pulse_id,state,owner_token,claim_token,
          frozen_perception_ids_json,frozen_world_cut_json
        FROM actor_turn_jobs WHERE job_id=?
      `).get(jobId);
      assert.deepEqual({ ...job }, {
        run_id: runId, actor_id: actorId, job_id: jobId, generation: 0, pulse_id: pulseId,
        state: 'queued', owner_token: null, claim_token: null, frozen_perception_ids_json: '[]',
        frozen_world_cut_json: '{\"fictionalAt\":0,\"perceptionIds\":[],\"worldRevision\":0,\"worldSeq\":0}',
      });
    } finally { afterRecovery.close(); }
    assert.notEqual(recovered.ownerToken, oldOwner);
  } finally { recovered.close(); }
});


test('openLocalHost recupera el child Continuista sin borrar su contexto ni volver a despachar', async (t) => {
  const fixture = await setup();
  t.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
  const session = deterministicFactory(fixture);
  let child: ReturnType<typeof fixture.journal.beginContinuistaJob> | undefined;
  const actor = createActorTurnWorker({ journal: fixture.journal, runtime: fixture.runtime, ids: fixture.ids,
    sessionFactory: session.factory,
    memoryForActor() { return { async recall() { return { source: 'ranked-recall', throughWorldSeq: WorldSeqSchema.parse(0), experiences: [], rejectedCount: 0 }; } }; },
    continuista: { async review({ execution, proposal }) {
      const context = await assembleContinuistaReviewContext({ journal: fixture.journal, execution, proposal, ids: fixture.ids });
      child = fixture.journal.beginContinuistaJob({ execution, context,
        ownerToken: fixture.claim.ownerToken, claimToken: fixture.claim.claimToken });
      throw new Error('Interrupción sintética después de crear el child');
    } },
  });
  await assert.rejects(actor.run(fixture.claim), /Interrupción sintética/);
  assert.ok(child?.kind === 'created');
  const original = child.job;
  fixture.journal.close();
  renameSync(join(fixture.directory, 'journal.sqlite'), join(fixture.directory, 'world.sqlite'));
  const recovered = openLocalHost({ privateDataRoot: fixture.directory });
  try {
    const current = recovered.journal.readContinuistaJob({ jobId: original.jobId, generation: original.generation });
    assert.equal(current.state, 'queued');
    assert.equal(current.contextHash, original.contextHash);
    assert.equal(current.pulseId, original.pulseId);
    assert.equal(recovered.journal.readContinuistaReceipt({ jobId: original.jobId, generation: original.generation }), undefined);
    assert.equal(session.prompts.length, 1);
  } finally { recovered.close(); }
});
