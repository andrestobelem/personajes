import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorldSnapshotSchema } from '../src/domain/world-schema.ts';
import { EventIdSchema } from '../src/domain/values.ts';
import { resolveWorldCircumstance } from '../src/domain/world-circumstances.ts';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
function ids() { let n = 100; return { eventId: () => uuid(++n), perceptionId: () => uuid(++n), experienceId: () => uuid(++n), offerId: () => uuid(++n), entityHandle: () => String(++n), placeHandle: () => String(++n), channelHandle: () => String(++n), offerHandle: () => String(++n) }; }
function fixture() {
  return WorldSnapshotSchema.parse({
    schemaVersion: 2, runId: uuid(1), revision: 0, seq: 0, clock: { instant: 0, convention: { kind: 'fixedOffset', offsetMinutes: 0, label: 'UTC' } },
    places: ['room', 'hall', 'outside'].map((id) => ({ id, name: id, description: '', width: 10, height: 10, lighting: 'normal' })),
    doors: [{ id: uuid(3), label: 'Puerta', state: 'closed', transparentWhenClosed: false, soundPassesWhenClosed: false }],
    connections: [{ from: 'room', to: 'hall', doorId: uuid(3), arrivalPoint: { x: 2, y: 2 }, durationMs: 1 }], perceptualPaths: [], channels: [],
    entities: [{ kind: 'character', species: 'human', entityId: uuid(4), characterId: 'maxwell-smart', trueDisplayName: 'Max', presentation: { kind: 'ordinary', label: 'Max' }, placeId: 'room', position: { x: 1, y: 1 }, collisionRadius: 0.5, blocksMovement: true, presence: { kind: 'present', sceneId: uuid(2) }, preparation: { kind: 'prepared', continuityId: 'main', identityVersion: 1 }, capabilities: [], availability: { kind: 'available' }, routine: { kind: 'always' }, mind: { goals: [], beliefs: [], relationships: [], recognizedCharacterIds: [], experiences: [] } },
      { kind: 'device', entityId: uuid(5), label: 'Panel', description: '', placeId: 'room', position: { x: 8, y: 8 }, collisionRadius: 0.2, blocksMovement: true, availability: 'available', power: 'on', operations: [] }],
    inventory: [], scenes: [{ id: uuid(2), label: 'Scene', participantIds: ['maxwell-smart'], placeIds: ['room', 'hall'], lifecycle: { kind: 'open', startedAt: 0 } }], activeSceneId: uuid(2), offers: [],
    actionDurations: { observeMs: 1, speechMs: 1, gestureMs: 1, takeMs: 1, offerMs: 1, acceptOfferMs: 1, maxWaitMs: 1, maxRestMs: 1, offerValidityMs: 1, interactionRange: 1 },
    circumstanceCatalog: { revision: 1, provenance: { authoredBy: 'Test operator', recordedAt: '2026-10-15T00:00:00Z', sourceRefs: [] }, environmentConditions: [{ id: 'rain', label: 'Lluvia', states: [{ id: 'heard', description: 'Se escucha la lluvia.', modality: 'auditory' }, { id: 'seen', description: 'Se ve la lluvia.', modality: 'visual' }] }], objectTemplates: [{ id: 'box', object: { kind: 'object', entityId: uuid(6), label: 'Caja', description: '', collisionRadius: 0.5, blocksMovement: true, portable: true }, allowedPlaceIds: ['room', 'outside'] }] },
  });
}
function resolve(snapshot: unknown, operation: unknown, scope: unknown = { kind: 'run' }) { return resolveWorldCircumstance({ snapshot, operation, scope, operationId: uuid(50), ids: ids() }); }

test('five circumstance families preserve time, emit facts without author identity and advance exactly once', () => {
  for (const operation of [
    { kind: 'setDoorState', doorId: uuid(3), state: 'open' },
    { kind: 'setLighting', placeId: 'room', level: 'dark' },
    { kind: 'setDeviceAvailability', deviceEntityId: uuid(5), availability: 'unavailable' },
    { kind: 'setEnvironment', placeId: 'room', conditionId: 'rain', stateId: 'heard' },
    { kind: 'appearObject', templateId: 'box', placeId: 'room', position: { x: 4, y: 4 } },
  ]) {
    const world = fixture(); const before = JSON.stringify(world); const result = resolve(world, operation);
    assert.equal(result.kind, 'applied'); if (result.kind !== 'applied') continue;
    assert.equal(JSON.stringify(world), before); assert.equal(result.newSnapshot.seq, 1); assert.equal(result.newSnapshot.revision, 1); assert.deepEqual(result.newSnapshot.clock, world.clock);
    assert.equal(result.events.length, 1); assert.equal(result.events[0]?.durationMs, 0);
    assert.equal(result.perceptions.length, operation.kind === 'setDeviceAvailability' ? 0 : 1);
    for (const perception of result.perceptions) { assert.equal(perception.kind, 'circumstance'); assert.equal('sourceEntityId' in perception, false); assert.equal('operationId' in perception, false); }
  }
});

test('scope validates all endpoints, including perceptual paths, and inactive scene', () => {
  const world = fixture();
  assert.deepEqual(resolve(world, { kind: 'setLighting', placeId: 'outside', level: 'dark' }, { kind: 'scene', sceneId: uuid(2) }), { kind: 'rejected', reason: 'outside-scope' });
  assert.deepEqual(resolve(world, { kind: 'setLighting', placeId: 'room', level: 'dark' }, { kind: 'scene', sceneId: uuid(9) }), { kind: 'rejected', reason: 'scope-unavailable' });
  world.perceptualPaths.push({ kind: 'visual', from: world.places[0]!.id, to: world.places[2]!.id, distance: 1, throughDoorIds: [world.doors[0]!.id] });
  assert.deepEqual(resolve(world, { kind: 'setDoorState', doorId: uuid(3), state: 'open' }, { kind: 'scene', sceneId: uuid(2) }), { kind: 'rejected', reason: 'outside-scope' });
});

test('appearance requires catalog authorization, valid geometry and no collisions; consumed object cannot reappear', () => {
  const world = fixture();
  for (const [operation, reason] of [
    [{ kind: 'appearObject', templateId: 'forged', placeId: 'room', position: { x: 4, y: 4 } }, 'not-authorized'],
    [{ kind: 'appearObject', templateId: 'box', placeId: 'hall', position: { x: 4, y: 4 } }, 'not-authorized'],
    [{ kind: 'appearObject', templateId: 'box', placeId: 'room', position: { x: 0, y: 0 } }, 'outside-place'],
    [{ kind: 'appearObject', templateId: 'box', placeId: 'room', position: { x: 1, y: 1 } }, 'collision'],
  ]) assert.deepEqual(resolve(world, operation), { kind: 'rejected', reason });
  const appeared = resolve(world, { kind: 'appearObject', templateId: 'box', placeId: 'outside', position: { x: 4, y: 4 } });
  assert.equal(appeared.kind, 'applied'); if (appeared.kind !== 'applied') return;
  assert.equal(appeared.perceptions.length, 0);
  appeared.newSnapshot.inventory[0]!.location = { kind: 'consumed', eventId: EventIdSchema.parse(uuid(99)) };
  assert.deepEqual(resolve(appeared.newSnapshot, { kind: 'appearObject', templateId: 'box', placeId: 'room', position: { x: 4, y: 4 } }), { kind: 'rejected', reason: 'object-already-exists' });
});

test('darkness blocks visual environment but not local sound; unavailable actors receive neither', () => {
  let world = fixture(); world = WorldSnapshotSchema.parse({ ...world, places: world.places.map((place) => ({ ...place, lighting: 'dark' })) });
  for (const [stateId, expected] of [['seen', 0], ['heard', 1]]) { const result = resolve(world, { kind: 'setEnvironment', placeId: 'room', conditionId: 'rain', stateId }); assert.equal(result.kind, 'applied'); if (result.kind === 'applied') assert.equal(result.perceptions.length, expected); }
  world = WorldSnapshotSchema.parse({ ...world, entities: world.entities.map((entity) => entity.kind === 'character' ? { ...entity, availability: { kind: 'unavailable', reason: 'durmiendo' } } : entity) });
  const result = resolve(world, { kind: 'setEnvironment', placeId: 'room', conditionId: 'rain', stateId: 'heard' }); if (result.kind === 'applied') assert.equal(result.perceptions.length, 0);
});

test('catalog and old snapshots validate without adding optional data', () => {
  const world = fixture(); const { circumstanceCatalog: catalog, ...old } = world;
  assert.deepEqual(WorldSnapshotSchema.parse(old), old);
  assert.equal(WorldSnapshotSchema.safeParse({ ...world, circumstanceCatalog: { ...catalog, objectTemplates: [catalog!.objectTemplates[0], catalog!.objectTemplates[0]] } }).success, false);
  assert.equal(WorldSnapshotSchema.safeParse({ ...world, environment: [{ placeId: 'room', conditionId: 'rain', stateId: 'forged' }] }).success, false);
});

test('no-ops and unknown targets reject without advancing a cut', () => {
  const world = fixture();
  for (const operation of [
    { kind: 'setDoorState', doorId: uuid(3), state: 'closed' },
    { kind: 'setLighting', placeId: 'room', level: 'normal' },
    { kind: 'setDeviceAvailability', deviceEntityId: uuid(5), availability: 'available' },
  ]) assert.deepEqual(resolve(world, operation), { kind: 'rejected', reason: 'unchanged' });
  assert.deepEqual(resolve(world, { kind: 'setDoorState', doorId: uuid(90), state: 'open' }), { kind: 'rejected', reason: 'target-not-found' });
  assert.deepEqual(resolve(world, { kind: 'setEnvironment', placeId: 'room', conditionId: 'forged', stateId: 'heard' }), { kind: 'rejected', reason: 'not-authorized' });
  const first = resolve(world, { kind: 'setEnvironment', placeId: 'room', conditionId: 'rain', stateId: 'heard' });
  if (first.kind !== 'applied') assert.fail('Expected applied environment');
  assert.deepEqual(resolve(first.newSnapshot, { kind: 'setEnvironment', placeId: 'room', conditionId: 'rain', stateId: 'heard' }), { kind: 'rejected', reason: 'unchanged' });
});

test('visual consequences follow configured paths; auditory environment stays local without a channel', () => {
  const base = fixture();
  const world = WorldSnapshotSchema.parse({ ...base, doors: base.doors.map((door) => ({ ...door, state: 'open' })), perceptualPaths: [{ kind: 'visual', from: 'room', to: 'hall', distance: 2, throughDoorIds: [uuid(3)] }] });
  const light = resolve(world, { kind: 'setLighting', placeId: 'hall', level: 'dark' });
  if (light.kind !== 'applied') assert.fail('Expected darkness');
  assert.equal(light.perceptions.length, 1, 'visible darkness is witnessed through the path before it becomes dark');
  const visual = resolve(world, { kind: 'setEnvironment', placeId: 'hall', conditionId: 'rain', stateId: 'seen' });
  if (visual.kind !== 'applied') assert.fail('Expected visible rain');
  assert.equal(visual.perceptions.length, 1);
  const sound = resolve(world, { kind: 'setEnvironment', placeId: 'hall', conditionId: 'rain', stateId: 'heard' });
  if (sound.kind !== 'applied') assert.fail('Expected rain sound');
  assert.equal(sound.perceptions.length, 0);
});

test('closed scenes, absence and routine each prevent circumstance perception', () => {
  const base = fixture();
  const variants = [
    { ...base, activeSceneId: null, scenes: base.scenes.map((scene) => ({ ...scene, lifecycle: { kind: 'closed', startedAt: 0, closedAt: 0, reason: 'Test closure' } })) },
    { ...base, entities: base.entities.map((entity) => entity.kind === 'character' ? { ...entity, presence: { kind: 'absent' } } : entity) },
    { ...base, entities: base.entities.map((entity) => entity.kind === 'character' ? { ...entity, routine: { kind: 'windows', defaultState: 'unavailable', windows: [] } } : entity) },
  ];
  for (const value of variants) {
    const parsed = WorldSnapshotSchema.safeParse(value);
    if (!parsed.success) assert.fail(JSON.stringify(parsed.error.issues));
    const result = resolve(parsed.data, { kind: 'setLighting', placeId: 'room', level: 'dark' });
    if (result.kind !== 'applied') assert.fail('Expected change');
    assert.equal(result.perceptions.length, 0);
  }
});

test('catalog prevents forged references, duplicate conditions, and pre-existing reserved objects', () => {
  const base = fixture(); const catalog = base.circumstanceCatalog;
  if (catalog === undefined) assert.fail('Fixture requires catalog');
  const template = catalog.objectTemplates[0]; const condition = catalog.environmentConditions[0];
  if (template === undefined || condition === undefined) assert.fail('Fixture catalog is empty');
  for (const circumstanceCatalog of [
    { ...catalog, environmentConditions: [condition, condition] },
    { ...catalog, environmentConditions: [{ ...condition, states: [condition.states[0], condition.states[0]] }] },
    { ...catalog, objectTemplates: [{ ...template, allowedPlaceIds: ['forged'] }] },
    { ...catalog, objectTemplates: [{ ...template, object: { ...template.object, entityId: uuid(4) } }] },
  ]) assert.equal(WorldSnapshotSchema.safeParse({ ...base, circumstanceCatalog }).success, false);
  assert.equal(WorldSnapshotSchema.safeParse({ ...base, entities: [...base.entities, template.object], inventory: [{ objectEntityId: template.object.entityId, revision: 0, location: { kind: 'atPlace', placeId: 'room', position: { x: 4, y: 4 } } }] }).success, false);
  assert.equal(WorldSnapshotSchema.safeParse({ ...base, environment: [{ placeId: 'room', conditionId: 'rain', stateId: 'seen' }, { placeId: 'room', conditionId: 'rain', stateId: 'heard' }] }).success, false);
});
