import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { z } from 'zod';
import { openJournal } from '../src/adapters/journal.ts';
import { ReadyRunConfigurationSchema, validateRunConfiguration } from '../src/application/production-preflight.ts';
import { createDeliverWorldWorker } from '../src/application/deliver-world.ts';
import { CircumstanceWriteSchema } from '../src/domain/direction-circumstances.ts';
import { WorldSnapshotSchema, PlaceIdSchema, DoorIdSchema, WorldEntityIdSchema } from '../src/domain/world-schema.ts';
import { PulseIdSchema } from '../src/domain/values.ts';
import { canonical, draftFixture } from './fixtures/continuista.ts';

type Operation = z.infer<typeof CircumstanceWriteSchema>['payload']['operation'];
const doorId = '00000000-0000-4000-8000-000000008101';
const deviceId = '00000000-0000-4000-8000-000000008102';
const objectId = '00000000-0000-4000-8000-000000008103';

function fixture(lifecycle: 'running' | 'paused' = 'running') {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-circumstance-journal-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  const ready = validateRunConfiguration({ draft: draftFixture() });
  if (ready.kind !== 'ready') assert.fail('Fixture de preparación inválida');
  const base = ready.configuration;
  const snapshot = WorldSnapshotSchema.parse({ ...base.worldSnapshot,
    places: [...base.worldSnapshot.places, { id: 'afuera', name: 'Afuera', description: 'Fuera de escena.', width: 10, height: 10, lighting: 'normal' }],
    doors: [{ id: doorId, label: 'Puerta', state: 'open', transparentWhenClosed: false, soundPassesWhenClosed: false }],
    connections: [{ from: 'sala', to: 'afuera', durationMs: 1, arrivalPoint: { x: 1, y: 1 }, doorId }],
    entities: [...base.worldSnapshot.entities, { kind: 'device', entityId: deviceId, label: 'Lámpara', description: 'Dispositivo sintético.',
      placeId: 'sala', position: { x: 4, y: 4 }, collisionRadius: 0, blocksMovement: false,
      availability: 'available', power: 'off', operations: [] }],
    circumstanceCatalog: { revision: 1, provenance: { authoredBy: 'synthetic-test', recordedAt: '2026-10-15T00:00:00Z', sourceRefs: ['test:physical-catalog'] },
      environmentConditions: [{ id: 'alarma', label: 'Alarma', states: [{ id: 'sonando', description: 'Suena una alarma sintética.', modality: 'auditory' }] }],
      objectTemplates: [{ id: 'caja', allowedPlaceIds: ['sala', 'afuera'], object: { kind: 'object', entityId: objectId, label: 'Caja', description: 'Objeto sintético.', collisionRadius: 0.1, blocksMovement: false, portable: true } }] },
    environment: [],
  });
  const configuration = ReadyRunConfigurationSchema.parse({ ...base, worldSnapshot: snapshot });
  const prepared = configuration.roster.preparedCharacters[0]; assert.ok(prepared);
  const fence = { kind: 'prepared-contexts', atWorldSeq: snapshot.seq, contexts: [{ actorId: prepared.characterId,
    continuityId: prepared.continuity.continuityId, continuityRevision: prepared.continuity.revision,
    continuityContentHash: prepared.continuity.contentHash, identityVersion: prepared.identityVersion,
    preparedContextHash: createHash('sha256').update(canonical(prepared)).digest('hex') }] };
  const register = (config = configuration) => journal.registerWorldRun({ initialSnapshot: config.worldSnapshot,
    configurationRevision: config.configRevision, configuration: config, continuityFence: fence, lifecycle });
  assert.equal(register(), 'stored');
  const runId = configuration.runId;
  return { path, runId, configuration, register, actorId: prepared.characterId,
    get journal() { return journal; },
    reopen() { journal.close(); journal = openJournal({ path }); },
    close() { journal.close(); rmSync(directory, { recursive: true, force: true }); },
    command(operation: Operation, scope: z.infer<typeof CircumstanceWriteSchema>['payload']['scope'] = { kind: 'run' }) {
      const options = journal.readCircumstanceOptions({ runId, scope: { kind: 'run' } }); assert.ok(options);
      return CircumstanceWriteSchema.parse({ runId, principalId: 'physical-test-operator', operationId: randomUUID(), idempotencyKey: randomUUID(),
        expectedWorldRevision: options.worldRevision, expectedDirectionRevision: options.directionRevision,
        payload: { kind: 'changeCircumstance', scope, operation } });
    },
    rows(table: string) { const db = new DatabaseSync(path); try { return db.prepare(`SELECT * FROM ${table} WHERE run_id=?`).all(runId); } finally { db.close(); } },
  };
}

const families: Operation[] = [
  { kind: 'setDoorState', doorId: DoorIdSchema.parse(doorId), state: 'closed' },
  { kind: 'setLighting', placeId: PlaceIdSchema.parse('sala'), level: 'dim' },
  { kind: 'setDeviceAvailability', deviceEntityId: WorldEntityIdSchema.parse(deviceId), availability: 'unavailable' },
  { kind: 'setEnvironment', placeId: PlaceIdSchema.parse('sala'), conditionId: 'alarma', stateId: 'sonando' },
  { kind: 'appearObject', templateId: 'caja', placeId: PlaceIdSchema.parse('sala'), position: { x: 7, y: 7 } },
];

for (const operation of families) test(`circunstancia durable: ${operation.kind} conserva evento, mundo y Dirección`, () => {
  const f = fixture(operation.kind === 'setLighting' ? 'paused' : 'running');
  try {
    const before = f.journal.loadWorld({ runId: f.runId }); assert.ok(before);
    assert.ok(before.activeSceneId);
    const scope: z.infer<typeof CircumstanceWriteSchema>['payload']['scope'] = operation.kind === 'setDoorState' ? { kind: 'run' } : { kind: 'scene', sceneId: before.activeSceneId };
    const command = f.command(operation, scope);
    const result = f.journal.applyCircumstanceCommand(command);
    assert.equal(result.kind, 'stored'); if (result.kind !== 'stored') assert.fail('No se aplicó circunstancia');
    assert.equal(result.receipt.effect.kind, 'applied');
    if (result.receipt.effect.kind !== 'applied') assert.fail('Falta efecto');
    assert.equal(result.receipt.directionRevision, 1);
    assert.equal(result.receipt.worldRevision, before.revision + 1);
    assert.equal(result.receipt.worldSeq, before.seq + 1);
    assert.equal(result.receipt.commitIndex, 1);
    const after = f.journal.loadWorld({ runId: f.runId }); assert.ok(after);
    const event = f.journal.readObservationEvents({ runId: f.runId, fromWorldSeq: after.seq, toWorldSeq: after.seq, afterWorldSeq: null, limit: 10, communicationsOnly: false });
    assert.equal(event?.length, 1); assert.equal(event?.[0]?.event.kind, 'circumstanceChanged');
    assert.deepEqual(event?.[0]?.event.origin, { kind: 'direction', operationId: command.operationId });
    assert.equal(event?.[0]?.event.id, result.receipt.effect.eventIds[0]);
    const direction = f.journal.readDirectionEvents({ runId: f.runId, afterDirectionRevision: 0, limit: 10 });
    assert.equal(direction?.directionRevision, 1); assert.deepEqual(direction?.events[0]?.payload, command.payload);
    switch (operation.kind) {
      case 'setDoorState': assert.equal(after.doors.find(item => item.id === operation.doorId)?.state, operation.state); break;
      case 'setLighting': assert.equal(after.places.find(item => item.id === operation.placeId)?.lighting, operation.level); break;
      case 'setDeviceAvailability': {
        const device = after.entities.find(item => item.entityId === operation.deviceEntityId);
        assert.equal(device?.kind === 'device' ? device.availability : undefined, operation.availability); break;
      }
      case 'setEnvironment': assert.deepEqual(after.environment, [{ placeId: operation.placeId, conditionId: operation.conditionId, stateId: operation.stateId }]); break;
      case 'appearObject': {
        assert.equal(after.entities.find(item => item.entityId === objectId)?.kind, 'object');
        assert.deepEqual(after.inventory.find(item => item.objectEntityId === objectId)?.location, { kind: 'atPlace', placeId: operation.placeId, position: operation.position }); break;
      }
      default: { const exhaustive: never = operation; assert.fail(exhaustive); }
    }
    const actorsBefore = before.entities.filter(item => item.kind === 'character');
    assert.deepEqual(after.entities.filter(item => item.kind === 'character'), actorsBefore, 'no se escriben deseos ni memorias');
    if (operation.kind === 'setDeviceAvailability') {
      assert.deepEqual(result.receipt.effect.recipientActorIds, [], 'disponibilidad interna no es una percepción');
    } else assert.deepEqual(result.receipt.effect.recipientActorIds, [f.actorId]);
    assert.equal(f.rows('world_commits').length, 1, 'un commit físico durable');
    assert.equal(f.rows('world_events').length, 1);
    assert.equal(f.rows('world_perceptions').length, result.receipt.effect.recipientActorIds.length);
    f.reopen();
    assert.deepEqual(f.journal.applyCircumstanceCommand(command), { ...result, kind: 'existing' });
    assert.deepEqual(f.journal.loadWorld({ runId: f.runId }), after);
    assert.equal(f.rows('direction_events').length, 1);
  } finally { f.close(); }
});

test('circunstancia sin cambio registra receipt de Dirección sin nuevo mundo', () => {
  const f = fixture();
  try {
    const before = f.journal.loadWorld({ runId: f.runId });
    const command = f.command({ kind: 'setDoorState', doorId: DoorIdSchema.parse(doorId), state: 'open' });
    const result = f.journal.applyCircumstanceCommand(command); assert.equal(result.kind, 'stored');
    if (result.kind !== 'stored') assert.fail('Falta receipt');
    assert.deepEqual(result.receipt.effect, { kind: 'unchanged' });
    assert.equal(result.receipt.directionRevision, 1); assert.equal(result.receipt.commitIndex, 0);
    assert.deepEqual(f.journal.loadWorld({ runId: f.runId }), before);
    assert.equal(f.rows('world_events').length, 0); assert.equal(f.rows('world_perceptions').length, 0);
    assert.equal(f.rows('world_commits').length, 0);
    assert.equal(f.rows('direction_events').length, 1);
    assert.equal(f.journal.readCircumstanceOptions({ runId: f.runId, scope: { kind: 'run' } })?.directionRevision, 1);
    f.reopen(); assert.deepEqual(f.journal.applyCircumstanceCommand(command), { ...result, kind: 'existing' });
  } finally { f.close(); }
});

test('CAS e idempotencia de circunstancias sobreviven reinicio y no pisan otra operación', () => {
  const f = fixture();
  try {
    const operation = families[1]; assert.ok(operation);
    const command = f.command(operation);
    const staleWorld = { ...command, expectedWorldRevision: command.expectedWorldRevision + 1 };
    const conflict = f.journal.applyCircumstanceCommand(staleWorld);
    assert.deepEqual(conflict, { kind: 'conflict', worldRevision: command.expectedWorldRevision, directionRevision: 0 });
    assert.deepEqual(f.journal.applyCircumstanceCommand(command), { kind: 'idempotencyConflict' }, 'no cambia el contenido del retry conflictivo');
    const staleDirection = { ...f.command(operation), expectedDirectionRevision: 1 };
    assert.equal(f.journal.applyCircumstanceCommand(staleDirection).kind, 'conflict');
    const fresh = f.command(operation); assert.equal(f.journal.applyCircumstanceCommand(fresh).kind, 'stored');
    assert.equal(f.journal.applyCircumstanceCommand({ ...fresh, payload: { ...fresh.payload, operation: families[0] } }).kind, 'idempotencyConflict');
    assert.equal(f.journal.applyCircumstanceCommand({ ...fresh, idempotencyKey: randomUUID() }).kind, 'idempotencyConflict');
    const otherRunId = randomUUID();
    const otherConfiguration = ReadyRunConfigurationSchema.parse({ ...f.configuration, runId: otherRunId, snapshotFence: { ...f.configuration.snapshotFence, runId: otherRunId }, worldSnapshot: { ...f.configuration.worldSnapshot, runId: otherRunId } });
    assert.equal(f.register(otherConfiguration), 'stored');
    assert.equal(f.journal.applyCircumstanceCommand({ ...fresh, runId: otherConfiguration.runId, idempotencyKey: randomUUID() }).kind, 'idempotencyConflict');
    assert.equal(f.journal.applyDirectionCommand({ runId: otherConfiguration.runId, principalId: fresh.principalId, operationId: fresh.operationId,
      idempotencyKey: randomUUID(), expectedDirectionRevision: 0, payload: { kind: 'metaIndication', recipients: [f.actorId], text: 'Texto sintético.', scope: { kind: 'run' } } }).kind, 'idempotencyConflict');
    const directionOperationId = randomUUID();
    assert.equal(f.journal.applyDirectionCommand({ runId: otherConfiguration.runId, principalId: fresh.principalId,
      operationId: directionOperationId, idempotencyKey: randomUUID(), expectedDirectionRevision: 0,
      payload: { kind: 'metaIndication', recipients: [f.actorId], text: 'Otro corte sintético.', scope: { kind: 'run' } } }).kind, 'stored');
    assert.equal(f.journal.applyCircumstanceCommand({ ...f.command(operation), operationId: directionOperationId }).kind, 'idempotencyConflict');
    f.reopen(); assert.deepEqual(f.journal.applyCircumstanceCommand(staleWorld), conflict);
    assert.equal(f.rows('world_events').length, 1);
  } finally { f.close(); }
});

test('rollback físico revierte snapshot, evento, percepción y receipts si falla Dirección', () => {
  const f = fixture(); const db = new DatabaseSync(f.path);
  try {
    const operation = families[1]; assert.ok(operation);
    const command = f.command(operation); const before = f.journal.loadWorld({ runId: f.runId });
    db.exec("CREATE TRIGGER reject_circumstance_direction BEFORE INSERT ON direction_events BEGIN SELECT RAISE(ABORT,'synthetic atomicity failure'); END");
    assert.throws(() => f.journal.applyCircumstanceCommand(command), /synthetic atomicity failure/);
    assert.deepEqual(f.journal.loadWorld({ runId: f.runId }), before);
    for (const table of ['world_events', 'world_perceptions', 'direction_events', 'circumstance_operations', 'actor_turn_intents']) assert.equal(f.rows(table).length, 0, table);
    assert.equal(f.rows('world_commits').length, 0);
    db.exec('DROP TRIGGER reject_circumstance_direction');
    assert.equal(f.journal.applyCircumstanceCommand(command).kind, 'stored', 'el retry completo no encuentra residuos de la transacción fallida');
    assert.equal(f.rows('world_commits').length, 1);
  } finally { db.close(); f.close(); }
});

test('opciones físicas filtran escena y nunca incluyen mentes, preparación o memoria', () => {
  const f = fixture();
  try {
    const snapshot = f.journal.loadWorld({ runId: f.runId }); assert.ok(snapshot); assert.ok(snapshot.activeSceneId);
    const run = f.journal.readCircumstanceOptions({ runId: f.runId, scope: { kind: 'run' } }); assert.ok(run);
    const scene = f.journal.readCircumstanceOptions({ runId: f.runId, scope: { kind: 'scene', sceneId: snapshot.activeSceneId } }); assert.ok(scene);
    assert.equal(run.places.length, 2); assert.equal(run.doors.length, 1);
    assert.deepEqual(scene.places.map(place => place.id), ['sala']); assert.deepEqual(scene.doors, []); assert.deepEqual(scene.connections, []);
    assert.deepEqual(scene.catalog?.objectTemplates[0]?.allowedPlaceIds, ['sala']);
    assert.equal(scene.devices.length, 1);
    const serialized = JSON.stringify(scene);
    for (const forbidden of ['mind', 'experiences', 'preparedCharacters', 'systemPrompt', 'credential', 'trueDisplayName']) assert.equal(serialized.includes(`"${forbidden}"`), false);
    assert.equal(f.journal.readCircumstanceOptions({ runId: f.runId, scope: { kind: 'scene', sceneId: randomUUID() } }), undefined);
    const operation = families[0]; assert.ok(operation);
    assert.deepEqual(f.journal.applyCircumstanceCommand(f.command(operation, { kind: 'scene', sceneId: snapshot.activeSceneId })), { kind: 'invalidState', code: 'outside-scope' });
    assert.equal(f.rows('world_events').length, 0);
  } finally { f.close(); }
});

for (const pending of ['pulse', 'job', 'step'] as const) test(`circunstancia no cambia mundo durante ${pending} activo`, async () => {
  const f = fixture();
  try {
    const operation = families[1]; assert.ok(operation);
    if (pending === 'step') {
      const lifecycle = f.journal.readWorldLifecycle({ runId: f.runId }); assert.ok(lifecycle);
      const db = new DatabaseSync(f.path);
      try { db.prepare("INSERT INTO run_step_jobs VALUES(?,?,NULL,'queued',0,?,0,0)").run(randomUUID(), f.runId, lifecycle.lifecycleRevision); } finally { db.close(); }
    } else {
      assert.equal(f.journal.applyCircumstanceCommand(f.command(operation)).kind, 'stored');
      assert.equal((await createDeliverWorldWorker({ journal: f.journal, runId: f.runId, actorId: f.actorId }).drain()).kind, 'completed');
      if (pending === 'pulse') assert.equal(f.journal.beginCoordinatorPulse({ runId: f.runId }).kind, 'started');
      else {
        f.journal.configureRun({ runId: f.runId, maxCalls: 20 });
        const pulseId = PulseIdSchema.parse(randomUUID()); f.journal.configurePulse({ runId: f.runId, pulseId, maxCalls: 4 });
        const scheduled = f.journal.scheduleActorTurnJob({ runId: f.runId, actorId: f.actorId, pulseId });
        assert.equal(scheduled.kind, 'scheduled'); if (scheduled.kind !== 'scheduled') assert.fail('Falta job');
        assert.equal(f.journal.claimActorTurnJob({ runId: f.runId, actorId: f.actorId,
          jobId: scheduled.job.jobId, generation: scheduled.job.generation,
          ownerToken: randomUUID(), claimToken: randomUUID() }).kind, 'claimed');
      }
    }
    const before = f.journal.loadWorld({ runId: f.runId });
    const next = f.command({ kind: 'setLighting', placeId: PlaceIdSchema.parse('sala'), level: 'bright' });
    assert.deepEqual(f.journal.applyCircumstanceCommand(next), { kind: 'invalidState', code: 'workPending' });
    assert.deepEqual(f.journal.loadWorld({ runId: f.runId }), before);
  } finally { f.close(); }
});
