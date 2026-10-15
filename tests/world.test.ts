import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  ActorKnowledgeSchema, ActorWorldViewSchema, WorldAttemptSchema, WorldContentApprovalReceiptSchema, WorldEntityIdSchema, WorldSnapshotSchema,
  buildActorWorldView, canPerceiveCircumstanceAt, emptyActorKnowledge, hashCommunicationContent, resolveWorldAttempt,
} from '../src/domain/world.ts';
import { resolveHumanIntervention } from '../src/domain/human-intervention.ts';
import { resolveWorldCircumstance } from '../src/domain/world-circumstances.ts';
import { projectHumanInteractionContext } from '../src/domain/interaction.ts';
import {
  CharacterIdSchema, EventIdSchema, ExperienceIdSchema, HumanInterventionIdSchema,
  PerceptionIdSchema, ProposalIdSchema, RunIdSchema,
} from '../src/domain/values.ts';

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('Fixture no serializable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

const runId = RunIdSchema.parse(uuid(1));
const sceneId = uuid(2);
const maxId = CharacterIdSchema.parse('maxwell-smart');
const ninetyNineId = CharacterIdSchema.parse('agente-99');
const fangId = CharacterIdSchema.parse('fang');
const maxEntity = WorldEntityIdSchema.parse(uuid(10));
const ninetyNineEntity = WorldEntityIdSchema.parse(uuid(11));
const fangEntity = WorldEntityIdSchema.parse(uuid(12));
const radioEntity = WorldEntityIdSchema.parse(uuid(20));
const envelopeEntity = WorldEntityIdSchema.parse(uuid(21));
const deviceEntity = WorldEntityIdSchema.parse(uuid(22));
const speechChannel = uuid(30);
const gestureChannel = uuid(31);
const animalSoundChannel = uuid(32);
const roomId = 'sala';
const hallId = 'pasillo';
const fileId = 'archivo';
const evidenceId = ExperienceIdSchema.parse(uuid(40));

function idSource(seed = 1_000) {
  let uuidCounter = seed;
  let handleCounter = seed;
  return {
    eventId: () => uuid(++uuidCounter),
    perceptionId: () => uuid(++uuidCounter),
    experienceId: () => uuid(++uuidCounter),
    offerId: () => uuid(++uuidCounter),
    entityHandle: () => `entity-handle-${++handleCounter}`,
    placeHandle: () => `place-handle-${++handleCounter}`,
    channelHandle: () => `channel-handle-${++handleCounter}`,
    offerHandle: () => `offer-handle-${++handleCounter}`,
  };
}

const humanProfile = {
  identity: {
    participantId: 'enlace-humano', displayName: 'Alex',
    identityMarkdown: 'Enlace ficticio de CONTROL.', lifeStoryMarkdown: 'Historia privada completa del enlace.',
  },
  presence: { kind: 'inScene', sceneId, placeId: roomId, position: { x: 0, y: 0 }, channelId: speechChannel },
} as const;

function humanSpeech(recipientCharacterIds: string[] = ['maxwell-smart', 'agente-99']) {
  return {
    kind: 'speech', recipientCharacterIds, channelId: speechChannel,
    content: { kind: 'speech', text: 'Encontré el informe, pero no sé si es auténtico.' },
  } as const;
}

function worldFixtureValue() {
  const initialExperience = {
    schemaVersion: 1,
    experienceId: evidenceId,
    runId,
    actorId: maxId,
    kind: 'perception',
    perceptionId: PerceptionIdSchema.parse(uuid(41)),
    eventId: EventIdSchema.parse(uuid(42)),
    content: 'Escuché una voz detrás de la puerta.',
    sourceRefs: [],
    fictitiousAt: 0,
    receivedAt: 0,
    worldSeq: 0,
    confidence: 0.9,
    revision: 0,
    predecessor: { kind: 'initial' },
  };
  const commonCharacter = {
    kind: 'character',
    species: 'human',
    presentation: { kind: 'ordinary', label: 'Maxwell Smart' },
    placeId: roomId,
    position: { x: 1, y: 1 },
    collisionRadius: 0.35,
    blocksMovement: false,
    presence: { kind: 'present', sceneId },
    preparation: { kind: 'prepared', continuityId: 'continuity-main', identityVersion: 1 },
    capabilities: ['move', 'observe', 'speak', 'gesture', 'take', 'offer', 'useDevice', 'wait', 'rest'],
    availability: { kind: 'available' },
    routine: { kind: 'always' },
    mind: { goals: [], beliefs: [], relationships: [], recognizedCharacterIds: [], experiences: [] },
  };
  return {
    schemaVersion: 1,
    runId,
    revision: 0,
    seq: 0,
    clock: { instant: 0, convention: { kind: 'fixedOffset', offsetMinutes: -180, label: 'Buenos Aires' } },
    places: [
      { id: roomId, name: 'Sala de control', description: 'Una sala con una mesa.', width: 10, height: 10, lighting: 'normal' },
      { id: hallId, name: 'Pasillo', description: 'Pasillo lateral.', width: 10, height: 10, lighting: 'bright' },
      { id: fileId, name: 'Archivo', description: 'Un archivo silencioso.', width: 10, height: 10, lighting: 'dim' },
    ],
    doors: [{ id: uuid(50), label: 'Puerta del pasillo', state: 'closed', transparentWhenClosed: false, soundPassesWhenClosed: true }],
    connections: [
      { from: roomId, to: hallId, durationMs: 1_000, arrivalPoint: { x: 1, y: 1 }, doorId: uuid(50) },
      { from: roomId, to: fileId, durationMs: 500, arrivalPoint: { x: 8, y: 8 }, doorId: null },
    ],
    perceptualPaths: [
      { kind: 'visual', from: roomId, to: hallId, distance: 4, throughDoorIds: [uuid(50)] },
      { kind: 'auditory', from: roomId, to: hallId, channelId: speechChannel, distance: 4, throughDoorIds: [uuid(50)] },
    ],
    channels: [
      { kind: 'speech', id: speechChannel, label: 'Voz cercana', enabled: true, maxRange: 6, scope: 'addressed', placeIds: [roomId, hallId] },
      { kind: 'gesture', id: gestureChannel, label: 'Gestos', enabled: true, modality: 'visual', maxRange: 6, scope: 'addressed', placeIds: [roomId, hallId] },
      { kind: 'gesture', id: animalSoundChannel, label: 'Sonidos animales', enabled: true, modality: 'auditory', maxRange: 6, scope: 'addressed', placeIds: [roomId, hallId] },
    ],
    entities: [
      {
        ...commonCharacter,
        entityId: maxEntity,
        characterId: maxId,
        trueDisplayName: 'Maxwell Smart',
        mind: {
          goals: [{ kind: 'durable', id: uuid(60), description: 'Proteger la agencia.', priority: 0.8, state: 'active', revision: 0, history: [] }],
          beliefs: [], relationships: [], recognizedCharacterIds: [], experiences: [initialExperience],
        },
      },
      {
        ...commonCharacter,
        entityId: ninetyNineEntity,
        characterId: ninetyNineId,
        trueDisplayName: 'Agente 99',
        presentation: { kind: 'cover', label: 'La condesa' },
        position: { x: 2, y: 1 },
        capabilities: ['move', 'observe', 'speak', 'gesture', 'take', 'offer', 'useDevice', 'wait', 'rest'],
        mind: {
          goals: [], beliefs: [], relationships: [], recognizedCharacterIds: [],
          experiences: [{ ...initialExperience, experienceId: ExperienceIdSchema.parse(uuid(43)), actorId: ninetyNineId, content: 'La contraseña secreta es amanecer.' }],
        },
      },
      {
        ...commonCharacter,
        entityId: fangEntity,
        characterId: fangId,
        trueDisplayName: 'Fang',
        species: 'animal',
        presentation: { kind: 'ordinary', label: 'Fang' },
        position: { x: 3, y: 1 },
        capabilities: ['move', 'observe', 'gesture', 'animalSound', 'take', 'offer', 'useDevice', 'wait', 'rest'],
        mind: { goals: [], beliefs: [], relationships: [], recognizedCharacterIds: [], experiences: [] },
      },
      {
        kind: 'object', entityId: radioEntity, label: 'Radio', description: 'Radio portátil.',
        collisionRadius: 0.1, blocksMovement: false, portable: true,
      },
      {
        kind: 'object', entityId: envelopeEntity, label: 'Sobre', description: 'Un sobre cerrado.',
        collisionRadius: 0.1, blocksMovement: false, portable: true,
      },
      {
        kind: 'device', entityId: deviceEntity, label: 'Panel de luz', description: 'Panel con interruptores.',
        placeId: roomId, position: { x: 2, y: 2 }, collisionRadius: 0.2, blocksMovement: false,
        availability: 'available', power: 'off',
        operations: [
          { kind: 'setPower', id: 'power-on', label: 'Encender panel', state: 'on', durationMs: 100 },
          { kind: 'setPower', id: 'power-off', label: 'Apagar panel', state: 'off', durationMs: 100 },
          { kind: 'setLight', id: 'bright-room', label: 'Iluminar sala', placeId: roomId, level: 'bright', durationMs: 150 },
        ],
      },
    ],
    inventory: [
      { objectEntityId: radioEntity, location: { kind: 'atPlace', placeId: roomId, position: { x: 4, y: 4 } }, revision: 0 },
      { objectEntityId: envelopeEntity, location: { kind: 'heldBy', entityId: maxEntity }, revision: 0 },
    ],
    scenes: [{
      id: sceneId, label: 'El pasillo secreto', lifecycle: { kind: 'open', startedAt: 0 },
      participantIds: [maxId, ninetyNineId, fangId], placeIds: [roomId, hallId, fileId],
    }],
    activeSceneId: sceneId,
    offers: [],
    actionDurations: {
      observeMs: 25, speechMs: 200, gestureMs: 100, takeMs: 100, offerMs: 100,
      acceptOfferMs: 100, maxWaitMs: 10_000, maxRestMs: 60_000,
      offerValidityMs: 5_000, interactionRange: 2,
    },
  };
}

function worldFixture() {
  return WorldSnapshotSchema.parse(worldFixtureValue());
}

test('WorldSnapshot acepta v1 sin alterar su forma canónica y v2 entre escenas', () => {
  const rawV1 = worldFixtureValue();
  const hashBeforeParse = canonicalHash(rawV1);
  const v1 = WorldSnapshotSchema.parse(rawV1);
  const reparsedV1 = WorldSnapshotSchema.parse(v1);
  assert.deepEqual(reparsedV1, v1);
  assert.equal(canonicalHash(v1), hashBeforeParse);
  assert.equal(canonicalHash(reparsedV1), hashBeforeParse);

  const closedScene = {
    ...v1.scenes[0]!,
    lifecycle: { kind: 'closed' as const, startedAt: 0, closedAt: 10, reason: 'corte entre escenas' },
  };
  const activeV2 = WorldSnapshotSchema.parse({ ...v1, schemaVersion: 2 });
  assert.equal(activeV2.schemaVersion, 2);
  assert.equal(activeV2.activeSceneId, sceneId);

  const betweenScenes = WorldSnapshotSchema.parse({
    ...v1,
    schemaVersion: 2,
    scenes: [closedScene],
    activeSceneId: null,
  });
  assert.equal(betweenScenes.schemaVersion, 2);
  assert.equal(betweenScenes.activeSceneId, null);

  assert.throws(() => WorldSnapshotSchema.parse({ ...v1, activeSceneId: null }));
  assert.throws(() => WorldSnapshotSchema.parse({ ...v1, schemaVersion: 2, activeSceneId: null }));
  assert.throws(() => WorldSnapshotSchema.parse({
    ...v1,
    schemaVersion: 2,
    scenes: [closedScene],
    activeSceneId: v1.activeSceneId,
  }));
});

function knowledge(actorId: string, bindings: unknown[] = []) {
  return ActorKnowledgeSchema.parse({ runId, actorId, bindings });
}

const maxKnowledge = knowledge(maxId, [
  { kind: 'entity', handle: 'h-max', entityId: maxEntity },
  { kind: 'entity', handle: 'h-99', entityId: ninetyNineEntity },
  { kind: 'entity', handle: 'h-fang', entityId: fangEntity },
  { kind: 'entity', handle: 'h-radio', entityId: radioEntity },
  { kind: 'entity', handle: 'h-envelope', entityId: envelopeEntity },
  { kind: 'entity', handle: 'h-device', entityId: deviceEntity },
  { kind: 'place', handle: 'p-hall', placeId: hallId },
  { kind: 'place', handle: 'p-file', placeId: fileId },
  { kind: 'channel', handle: 'c-speech', channelId: speechChannel },
  { kind: 'channel', handle: 'c-gesture', channelId: gestureChannel },
  { kind: 'channel', handle: 'c-animal-sound', channelId: animalSoundChannel },
]);

function attempt<T extends { kind: string }>(body: T): T {
  WorldAttemptSchema.parse(body);
  return body;
}

function approvalReceipt(content: unknown, options: { actorId?: string; stateRevision?: number; runId?: string } = {}) {
  return WorldContentApprovalReceiptSchema.parse({
    kind: 'approved', proposalId: ProposalIdSchema.parse(uuid(2_001)), version: 1,
    runId: options.runId ?? runId, actorId: options.actorId ?? maxId,
    stateRevision: options.stateRevision ?? 0, exactContentHash: hashCommunicationContent(content),
  });
}

test('la vista diegética muestra el cover y sólo las experiencias del actor', () => {
  const snapshot = worldFixture();
  const emptyKnowledge = emptyActorKnowledge({ runId, actorId: maxId });
  const result = buildActorWorldView({
    snapshot, actorId: maxId, knowledge: emptyKnowledge, pendingPerceptions: [], ids: idSource(),
  });
  const json = JSON.stringify(result.view);
  assert.match(json, /La condesa/);
  assert.doesNotMatch(json, /Agente 99|agente-99|contraseña secreta/);
  assert.match(json, /Escuché una voz detrás de la puerta/);
  assert.doesNotMatch(json, new RegExp(ninetyNineEntity));

  const recognized = WorldSnapshotSchema.parse({
    ...snapshot,
    entities: snapshot.entities.map((entity) => entity.kind === 'character' && entity.characterId === maxId
      ? { ...entity, mind: { ...entity.mind, recognizedCharacterIds: [ninetyNineId] } }
      : entity),
  });
  const recognizedView = buildActorWorldView({
    snapshot: recognized, actorId: maxId, knowledge: emptyActorKnowledge({ runId, actorId: maxId }),
    pendingPerceptions: [], ids: idSource(2_000),
  });
  assert.ok(recognizedView.view.entities.some((entity) => entity.kind === 'character' && entity.identity.kind === 'recognized' && entity.identity.label === 'Agente 99'));
  assert.doesNotMatch(JSON.stringify(recognizedView.view), new RegExp(ninetyNineId));
});

test('una circunstancia llega como experiencia situada sin atribuirla a un personaje ni exponer identificadores host', () => {
  const snapshot = worldFixture();
  const circumstance = {
    kind: 'circumstance', id: uuid(60_001), runId, recipientCharacterId: maxId,
    eventId: uuid(60_002), placeId: roomId, modality: 'visual',
    detail: 'La iluminación disminuyó.', fictitiousAt: snapshot.clock.instant,
  };
  const built = buildActorWorldView({
    snapshot, actorId: maxId, knowledge: emptyActorKnowledge({ runId, actorId: maxId }),
    pendingPerceptions: [circumstance, { ...circumstance, id: uuid(60_003), recipientCharacterId: ninetyNineId,
      detail: 'EXPERIENCIA AJENA PRIVADA' }], ids: idSource(60_100),
  });
  assert.deepEqual(built.view.inbox, [{
    kind: 'circumstance', placeHandle: built.view.currentPlace.handle, modality: 'visual',
    detail: circumstance.detail, fictitiousAt: circumstance.fictitiousAt,
  }]);
  const encoded = JSON.stringify(built.view.inbox);
  assert.doesNotMatch(encoded, /source|actorId|operationId|principal|EXPERIENCIA AJENA/);
  for (const privateId of [circumstance.id, circumstance.eventId, runId, roomId]) {
    assert.equal(encoded.includes(privateId), false);
  }
});

test('la vista del actor incluye su inventario, rutina, disponibilidad efectiva y permisos sin revelar el estado privado de otros', () => {
  const base = worldFixture();
  const snapshot = WorldSnapshotSchema.parse({
    ...base,
    entities: base.entities.map((entity) => {
      if (entity.kind !== 'character') return entity;
      if (entity.characterId === maxId) {
        return {
          ...entity,
          routine: { kind: 'windows', defaultState: 'unavailable', windows: [{ from: 0, to: 100, state: 'available' }] },
        };
      }
      if (entity.characterId === ninetyNineId) {
        return {
          ...entity,
          availability: { kind: 'available' },
          routine: { kind: 'windows', defaultState: 'available', windows: [{ from: 0, to: 12_345, state: 'unavailable' }] },
        };
      }
      if (entity.characterId === fangId) {
        return { ...entity, availability: { kind: 'unavailable', reason: 'MOTIVO PRIVADO DE FANG' } };
      }
      return entity;
    }),
  });
  const built = buildActorWorldView({
    snapshot, actorId: maxId, knowledge: emptyActorKnowledge({ runId, actorId: maxId }),
    pendingPerceptions: [], ids: idSource(20_000),
  });
  const view = built.view;
  assert.equal(view.self.effectiveAvailability, 'available');
  assert.deepEqual(view.self.routine, { kind: 'windows', defaultState: 'unavailable', windows: [{ from: 0, to: 100, state: 'available' }] });
  assert.deepEqual(view.self.capabilities, ['move', 'observe', 'speak', 'gesture', 'take', 'offer', 'useDevice', 'wait', 'rest']);
  assert.deepEqual(view.self.actionDurations, snapshot.actionDurations);
  assert.equal(view.self.inventory.length, 1);
  assert.deepEqual({ ...view.self.inventory[0], handle: 'expected-opaque-handle' }, {
    handle: 'expected-opaque-handle', label: 'Sobre', description: 'Un sobre cerrado.', portable: true,
  });
  assert.ok(built.knowledge.bindings.some((binding) => binding.kind === 'entity'
    && binding.entityId === envelopeEntity && binding.handle === view.self.inventory[0]?.handle));
  assert.doesNotMatch(JSON.stringify(view), new RegExp(envelopeEntity));
  assert.doesNotMatch(JSON.stringify(view), /MOTIVO PRIVADO DE FANG|12345/);

  const visibleNinetyNine = view.entities.find((entity) => entity.kind === 'character' && entity.identity.kind === 'cover');
  assert.equal(visibleNinetyNine?.kind === 'character' ? visibleNinetyNine.availability : undefined, 'unavailable');
  assert.equal(visibleNinetyNine?.kind === 'character' && 'routine' in visibleNinetyNine, false);
  const visibleFang = view.entities.find((entity) => entity.kind === 'character' && entity.identity.label === 'Fang');
  assert.equal(visibleFang?.kind === 'character' ? visibleFang.availability : undefined, 'unavailable');

  const file = view.places.find((place) => place.name === 'Archivo');
  assert.deepEqual(file?.movement, { kind: 'move', durationMs: 500, availability: { kind: 'available' } });
  assert.equal(view.places.some((place) => place.name === 'Pasillo'), false);
});

test('la vista expone efectos, duración y legalidad de dispositivos y objetos perceptibles', () => {
  const built = buildActorWorldView({
    snapshot: worldFixture(), actorId: maxId, knowledge: emptyActorKnowledge({ runId, actorId: maxId }),
    pendingPerceptions: [], ids: idSource(21_000),
  });
  const device = built.view.entities.find((entity) => entity.kind === 'device');
  assert.ok(device?.kind === 'device');
  assert.equal('availability' in device, false);
  assert.equal(device?.kind === 'device' ? device.power : undefined, 'off');
  if (device?.kind !== 'device') assert.fail('falta el panel perceptible');

  const powerOn = device.operations.find((operation) => operation.id === 'power-on');
  assert.equal(powerOn?.kind, 'setPower');
  assert.equal(powerOn?.durationMs, 100);
  assert.deepEqual(powerOn?.effect, { kind: 'powerChanged', state: 'on' });
  assert.deepEqual(powerOn?.availability, { kind: 'available' });

  const powerOff = device.operations.find((operation) => operation.id === 'power-off');
  assert.deepEqual(powerOff?.availability, { kind: 'unavailable', reason: 'state-unchanged' });
  const brighten = device.operations.find((operation) => operation.id === 'bright-room');
  assert.equal(brighten?.kind, 'setLight');
  assert.equal(brighten?.durationMs, 150);
  assert.equal(brighten?.kind === 'setLight' ? brighten.effect.placeName : undefined, 'Sala de control');
  assert.deepEqual(brighten?.availability, { kind: 'unavailable', reason: 'power-required' });

  const radio = built.view.entities.find((entity) => entity.kind === 'object' && entity.label === 'Radio');
  assert.equal(radio?.kind === 'object' ? radio.custody : undefined, 'atPlace');
  assert.deepEqual(radio?.kind === 'object' ? radio.takeAvailability : undefined, { kind: 'unavailable', reason: 'out-of-reach' });
  const envelope = built.view.entities.find((entity) => entity.kind === 'object' && entity.label === 'Sobre');
  assert.equal(envelope?.kind === 'object' ? envelope.custody : undefined, 'heldBySelf');
  assert.deepEqual(envelope?.kind === 'object' ? envelope.takeAvailability : undefined, { kind: 'unavailable', reason: 'object-not-available' });
});

test('ver un dispositivo no revela su disponibilidad interna y el intento sigue sujeto a ella', () => {
  const working = worldFixture();
  const disabled = WorldSnapshotSchema.parse({ ...working, entities: working.entities.map((entity) =>
    entity.kind === 'device' ? { ...entity, availability: 'unavailable' } : entity) });
  const project = (snapshot: unknown) => buildActorWorldView({ snapshot, actorId: maxId,
    knowledge: emptyActorKnowledge({ runId, actorId: maxId }), pendingPerceptions: [], ids: idSource(61_000) }).view;
  assert.deepEqual(project(working), project(disabled));
  const result = resolveWorldAttempt({ snapshot: disabled, actorKnowledge: maxKnowledge, ids: idSource(62_000),
    attempt: attempt({ kind: 'useDevice', attemptId: uuid(62_001), runId, actorId: maxId,
      expectedRevision: disabled.revision, deviceHandle: 'h-device', operationId: 'power-on' }) });
  assert.equal(result.kind, 'notApplied');
  if (result.kind === 'notApplied') assert.equal(result.reason, 'device-unavailable');
});

test('las circunstancias reutilizan caminos, puertas, iluminación, canal y disponibilidad efectiva', () => {
  const base = worldFixture();
  const snapshot = WorldSnapshotSchema.parse({ ...base, entities: base.entities.map((entity) =>
    entity.kind === 'character' && entity.characterId === maxId ? { ...entity, placeId: hallId } : entity) });
  const input = { snapshot, source: { placeId: roomId, position: { x: 1, y: 1 } }, recipientCharacterId: maxId };
  assert.equal(canPerceiveCircumstanceAt({ ...input, modality: 'visual' }), false);
  assert.equal(canPerceiveCircumstanceAt({ ...input, modality: 'auditory' }), false);
  assert.equal(canPerceiveCircumstanceAt({ ...input, modality: 'auditory', channelId: speechChannel }), true);
  const open = { ...snapshot, doors: snapshot.doors.map((door) => ({ ...door, state: 'open' })),
    perceptualPaths: [...snapshot.perceptualPaths, { kind: 'visual', from: hallId, to: roomId,
      distance: 4, throughDoorIds: [uuid(50)] }] };
  assert.equal(canPerceiveCircumstanceAt({ ...input, snapshot: open, modality: 'visual' }), true);
  const dark = { ...open, places: open.places.map((place) => ({ ...place, lighting: 'dark' })) };
  assert.equal(canPerceiveCircumstanceAt({ ...input, snapshot: dark, modality: 'visual' }), false);
  const unavailable = { ...open, entities: open.entities.map((entity) => entity.kind === 'character'
    && entity.characterId === maxId ? { ...entity, availability: { kind: 'unavailable', reason: 'Privado' } } : entity) };
  assert.equal(canPerceiveCircumstanceAt({ ...input, snapshot: unavailable, modality: 'visual' }), false);
  const noSound = { ...snapshot, channels: snapshot.channels.map((channel) => ({ ...channel, enabled: false })) };
  assert.equal(canPerceiveCircumstanceAt({ ...input, snapshot: noSound, modality: 'auditory', channelId: speechChannel }), false);
});

test('el actor que llega después percibe el entorno actual sin recibir el cambio pasado ni el catálogo', () => {
  const base = worldFixture();
  const initial = WorldSnapshotSchema.parse({ ...base,
    entities: base.entities.map((entity) => entity.kind === 'character' && entity.characterId === maxId
      ? { ...entity, presence: { kind: 'absent' } } : entity),
    circumstanceCatalog: { revision: 1, provenance: { authoredBy: 'PRIVATE_OPERATOR',
      recordedAt: '2026-10-15T00:00:00Z', sourceRefs: ['PRIVATE_SOURCE'] }, objectTemplates: [],
      environmentConditions: [{ id: 'weather', label: 'PRIVATE_CONDITION_LABEL', states: [
        { id: 'visible', modality: 'visual', description: 'Hay niebla visible.' },
        { id: 'unselected', modality: 'visual', description: 'PRIVATE_UNSELECTED_DESCRIPTION' },
      ] }, { id: 'sound', label: 'Sonido', states: [{ id: 'heard', modality: 'auditory', description: 'Se oye una alarma.' }] }] },
  });
  const changed = resolveWorldCircumstance({ snapshot: initial, operationId: uuid(63_001), scope: { kind: 'run' },
    operation: { kind: 'setEnvironment', placeId: roomId, conditionId: 'weather', stateId: 'visible' }, ids: idSource(63_100) });
  if (changed.kind !== 'applied') assert.fail('Expected environmental change');
  assert.equal(changed.perceptions.some((perception) => perception.recipientCharacterId === maxId), false);
  const arrived = WorldSnapshotSchema.parse({ ...changed.newSnapshot,
    environment: [...(changed.newSnapshot.environment ?? []), { placeId: hallId, conditionId: 'sound', stateId: 'heard' }],
    entities: changed.newSnapshot.entities.map((entity) => entity.kind === 'character' && entity.characterId === maxId
      ? { ...entity, presence: { kind: 'present', sceneId } } : entity),
  });
  const before = JSON.stringify(arrived);
  const project = (snapshot: unknown) => buildActorWorldView({ snapshot, actorId: maxId,
    knowledge: emptyActorKnowledge({ runId, actorId: maxId }), pendingPerceptions: [], ids: idSource(64_000) }).view;
  const view = project(arrived);
  assert.deepEqual(view.environment, [{ placeHandle: view.currentPlace.handle, modality: 'visual', detail: 'Hay niebla visible.' }]);
  assert.deepEqual(view.inbox, []);
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE_|weather|unselected|conditionId|stateId|alarma/);
  assert.equal(JSON.stringify(arrived), before);
  const dark = { ...arrived, places: arrived.places.map((place) => ({ ...place, lighting: 'dark' })) };
  assert.equal(project(dark).environment, undefined);
  const unavailable = { ...arrived, entities: arrived.entities.map((entity) => entity.kind === 'character'
    && entity.characterId === maxId ? { ...entity, availability: { kind: 'unavailable', reason: 'PRIVATE_REASON' } } : entity) };
  assert.equal(project(unavailable).environment, undefined);
  const invisible = { ...arrived, environment: [{ placeId: hallId, conditionId: 'weather', stateId: 'visible' }] };
  assert.equal(project(invisible).environment, undefined);
  const visible = { ...invisible, doors: arrived.doors.map((door) => ({ ...door, state: 'open' })) };
  assert.deepEqual(project(visible).environment?.map(({ modality, detail }) => ({ modality, detail })),
    [{ modality: 'visual', detail: 'Hay niebla visible.' }]);
  const { environment: ignored, ...historical } = view;
  void ignored;
  assert.equal('environment' in ActorWorldViewSchema.parse(historical), false);
});

test('la vista marca acciones que exceden las capacidades efectivas del actor', () => {
  const base = worldFixture();
  const snapshot = WorldSnapshotSchema.parse({
    ...base,
    entities: base.entities.map((entity) => entity.kind === 'character' && entity.characterId === maxId
      ? { ...entity, capabilities: ['observe'] }
      : entity),
  });
  const built = buildActorWorldView({
    snapshot, actorId: maxId, knowledge: emptyActorKnowledge({ runId, actorId: maxId }),
    pendingPerceptions: [], ids: idSource(21_500),
  });
  assert.deepEqual(built.view.self.capabilities, ['observe']);
  assert.equal(built.view.self.effectiveAvailability, 'available');
  const archive = built.view.places.find((place) => place.name === 'Archivo');
  assert.deepEqual(archive?.movement, { kind: 'move', durationMs: 500, availability: { kind: 'unavailable', reason: 'capability-missing' } });
  const panel = built.view.entities.find((entity) => entity.kind === 'device');
  assert.equal(panel?.kind === 'device' ? panel.operations.every((operation) => operation.availability.kind === 'unavailable'
    && operation.availability.reason === 'capability-missing') : false, true);
  const radio = built.view.entities.find((entity) => entity.kind === 'object' && entity.label === 'Radio');
  assert.deepEqual(radio?.kind === 'object' ? radio.takeAvailability : undefined, { kind: 'unavailable', reason: 'capability-missing' });
});

test('un efecto de iluminación fuera de la escena no se proyecta ni se ejecuta', () => {
  const base = worldFixture();
  const outsidePlace = 'deposito-privado';
  const unseenScenePlace = 'cuarto-cerrado';
  const snapshot = WorldSnapshotSchema.parse({
    ...base,
    places: [
      ...base.places,
      { id: outsidePlace, name: 'Depósito privado', description: 'Lugar fuera de la escena.', width: 8, height: 8, lighting: 'dim' },
      { id: unseenScenePlace, name: 'Cuarto cerrado', description: 'Lugar sin acceso en este corte.', width: 8, height: 8, lighting: 'dim' },
    ],
    scenes: base.scenes.map((scene) => ({ ...scene, placeIds: [...scene.placeIds, unseenScenePlace] })),
    entities: base.entities.map((entity) => entity.kind === 'device'
      ? {
        ...entity, power: 'on', operations: [
          ...entity.operations,
          { kind: 'setLight', id: 'hidden-light', label: 'Iluminar depósito', placeId: outsidePlace, level: 'bright', durationMs: 75 },
          { kind: 'setLight', id: 'unseen-light', label: 'Iluminar cuarto cerrado', placeId: unseenScenePlace, level: 'bright', durationMs: 75 },
        ],
      }
      : entity),
  });
  const built = buildActorWorldView({
    snapshot, actorId: maxId, knowledge: maxKnowledge, pendingPerceptions: [], ids: idSource(22_000),
  });
  const device = built.view.entities.find((entity) => entity.kind === 'device');
  assert.equal(device?.kind === 'device' && device.operations.some((operation) => operation.id === 'hidden-light' || operation.id === 'unseen-light'), false);
  assert.doesNotMatch(JSON.stringify(built.view), /Depósito privado|hidden-light|Cuarto cerrado|unseen-light/);

  const attempted = resolveWorldAttempt({
    snapshot,
    attempt: attempt({
      kind: 'useDevice', attemptId: uuid(103), runId, actorId: maxId, expectedRevision: 0,
      deviceHandle: 'h-device', operationId: 'hidden-light',
    }),
    actorKnowledge: built.knowledge, ids: idSource(23_000),
  });
  assert.equal(attempted.kind, 'notApplied');
  if (attempted.kind === 'notApplied') assert.equal(attempted.reason, 'device-effect-outside-scene');
  assert.deepEqual(attempted.newSnapshot, snapshot);

  const hiddenWithinScene = resolveWorldAttempt({
    snapshot,
    attempt: attempt({
      kind: 'useDevice', attemptId: uuid(104), runId, actorId: maxId, expectedRevision: 0,
      deviceHandle: 'h-device', operationId: 'unseen-light',
    }),
    actorKnowledge: built.knowledge, ids: idSource(24_000),
  });
  assert.equal(hiddenWithinScene.kind, 'notApplied');
  if (hiddenWithinScene.kind === 'notApplied') assert.equal(hiddenWithinScene.reason, 'device-effect-not-accessible');
  assert.deepEqual(hiddenWithinScene.newSnapshot, snapshot);
});

test('una presencia sólo audible no revela identidad ni coordenadas del personaje', () => {
  const snapshot = worldFixture();
  const distant = WorldSnapshotSchema.parse({
    ...snapshot,
    entities: snapshot.entities.map((entity) => entity.kind === 'character' && entity.characterId === ninetyNineId
      ? { ...entity, placeId: hallId, position: { x: 2, y: 1 } }
      : entity),
  });
  const view = buildActorWorldView({
    snapshot: distant, actorId: maxId, knowledge: emptyActorKnowledge({ runId, actorId: maxId }),
    pendingPerceptions: [], ids: idSource(1_500),
  });
  const json = JSON.stringify(view.view);
  assert.doesNotMatch(json, /La condesa/);
  assert.equal(view.knowledge.bindings.some((binding) => binding.kind === 'entity' && binding.entityId === ninetyNineEntity), false);

  const listening = resolveWorldAttempt({
    snapshot: distant,
    attempt: attempt({ kind: 'observe', attemptId: uuid(134), runId, actorId: maxId, expectedRevision: 0,
      target: { modality: 'auditory', targetHandle: 'h-99', channelHandle: 'c-speech' } }),
    actorKnowledge: maxKnowledge, ids: idSource(1_550),
  });
  assert.equal(listening.kind, 'applied');
  if (listening.kind === 'applied') {
    assert.match(listening.perceptions[0]?.kind === 'observation' ? listening.perceptions[0].detail : '', /no confirma una emisión audible/);
    assert.doesNotMatch(JSON.stringify(listening.perceptions), /La condesa|Agente 99|Sala de control|Pasillo/);
  }
});

test('la vista y la observación respetan la escena, la presencia y el alcance de handles conocidos', () => {
  const snapshot = worldFixture();
  const scoped = WorldSnapshotSchema.parse({
    ...snapshot,
    doors: snapshot.doors.map((door) => ({ ...door, state: 'open' })),
    scenes: snapshot.scenes.map((scene) => ({ ...scene, placeIds: [roomId] })),
    entities: snapshot.entities.map((entity) => {
      if (entity.kind === 'character' && entity.characterId === ninetyNineId) {
        return { ...entity, presence: { kind: 'absent' } };
      }
      return entity;
    }),
    inventory: snapshot.inventory.map((entry) => entry.objectEntityId === radioEntity
      ? { ...entry, location: { kind: 'atPlace', placeId: hallId, position: { x: 4, y: 4 } } }
      : entry),
  });
  const view = buildActorWorldView({
    snapshot: scoped, actorId: maxId, knowledge: maxKnowledge, pendingPerceptions: [], ids: idSource(1_600),
  });
  const projected = JSON.stringify(view.view);
  assert.doesNotMatch(projected, /La condesa|Radio/);

  const absentCharacter = resolveWorldAttempt({
    snapshot: scoped,
    attempt: attempt({ kind: 'observe', attemptId: uuid(130), runId, actorId: maxId, expectedRevision: 0,
      target: { modality: 'visual', targetHandle: 'h-99' } }),
    actorKnowledge: maxKnowledge, ids: idSource(1_700),
  });
  assert.equal(absentCharacter.kind, 'notApplied');
  if (absentCharacter.kind === 'notApplied') assert.equal(absentCharacter.reason, 'target-not-perceptible');

  const outsideScene = resolveWorldAttempt({
    snapshot: scoped,
    attempt: attempt({ kind: 'observe', attemptId: uuid(131), runId, actorId: maxId, expectedRevision: 0,
      target: { modality: 'visual', targetHandle: 'h-radio' } }),
    actorKnowledge: maxKnowledge, ids: idSource(1_800),
  });
  assert.equal(outsideScene.kind, 'notApplied');
  if (outsideScene.kind === 'notApplied') assert.equal(outsideScene.reason, 'target-not-perceptible');
});

test('la revisión exacta habilita emisión, pero la audiencia efectiva depende de canal y alcance', () => {
  const snapshot = worldFixture();
  const content = { kind: 'speech', text: '¿Me escuchás?' };
  const approved = attempt({
    kind: 'communicate', attemptId: uuid(70), runId, actorId: maxId, expectedRevision: 0,
    channelHandle: 'c-speech', audienceHandles: ['h-99', 'h-fang'], content,
  });
  const receipt = approvalReceipt(content);
  const resolution = resolveWorldAttempt({ snapshot, attempt: approved, actorKnowledge: maxKnowledge, approvalReceipt: receipt, ids: idSource() });
  assert.equal(resolution.kind, 'applied');
  if (resolution.kind !== 'applied') return;
  assert.deepEqual(resolution.emission.kind, 'emitted');
  assert.equal(resolution.events[0]?.kind, 'communicated');
  if (resolution.events[0]?.kind === 'communicated') {
    assert.deepEqual(resolution.events[0].effectiveAudience, [ninetyNineId, fangId]);
  }
  assert.equal(resolution.perceptions.length, 2);
  assert.equal(resolution.newSnapshot.clock.instant, 200);
  assert.equal('delivery' in (resolution.perceptions[0] ?? {}), false);

  const tampered = attempt({ ...approved, content: { kind: 'speech', text: 'Otra frase.' } });
  const rejected = resolveWorldAttempt({ snapshot, attempt: tampered, actorKnowledge: maxKnowledge, approvalReceipt: receipt, ids: idSource() });
  assert.equal(rejected.kind, 'notApplied');
  if (rejected.kind === 'notApplied') assert.equal(rejected.reason, 'approval-receipt-invalid');
  assert.deepEqual(rejected.newSnapshot, snapshot);
  assert.deepEqual(rejected.events, []);
  assert.deepEqual(rejected.perceptions, []);

  const fangSpeech = attempt({
    kind: 'communicate', attemptId: uuid(71), runId, actorId: fangId, expectedRevision: 0,
    channelHandle: 'c-speech', audienceHandles: ['h-99'], content,
  });
  const fangKnowledge = knowledge(fangId, [
    { kind: 'channel', handle: 'c-speech', channelId: speechChannel },
    { kind: 'entity', handle: 'h-99', entityId: ninetyNineEntity },
  ]);
  const fangRejected = resolveWorldAttempt({ snapshot, attempt: fangSpeech, actorKnowledge: fangKnowledge,
    approvalReceipt: approvalReceipt(content, { actorId: fangId }), ids: idSource(3_000) });
  assert.equal(fangRejected.kind, 'notApplied');
  if (fangRejected.kind === 'notApplied') assert.equal(fangRejected.reason, 'capability-missing');

  assert.throws(() => WorldAttemptSchema.parse({ ...approved, approval: { kind: 'approved', exactContentHash: receipt.exactContentHash } }));
  const staleReceipt = resolveWorldAttempt({ snapshot, attempt: approved, actorKnowledge: maxKnowledge,
    approvalReceipt: approvalReceipt(content, { stateRevision: 1 }), ids: idSource(3_100) });
  assert.equal(staleReceipt.kind, 'notApplied');
  if (staleReceipt.kind === 'notApplied') assert.equal(staleReceipt.reason, 'approval-receipt-invalid');
});

test('un gesto que señala sólo se entrega a quienes pueden ver el objetivo', () => {
  const snapshot = worldFixture();
  const scoped = WorldSnapshotSchema.parse({
    ...snapshot,
    doors: snapshot.doors.map((door) => ({ ...door, state: 'open' })),
    perceptualPaths: [
      ...snapshot.perceptualPaths,
      { kind: 'visual', from: roomId, to: fileId, distance: 4, throughDoorIds: [] },
    ],
    channels: snapshot.channels.map((channel) => channel.id === gestureChannel
      ? { ...channel, placeIds: [roomId, hallId, fileId] }
      : channel),
    entities: snapshot.entities.map((entity) => {
      if (entity.kind === 'character' && entity.characterId === ninetyNineId) return { ...entity, placeId: hallId };
      if (entity.kind === 'character' && entity.characterId === fangId) return { ...entity, placeId: fileId };
      return entity;
    }),
  });
  const content = { kind: 'gesture', gesture: { kind: 'point', targetHandle: 'h-fang' } };
  const result = resolveWorldAttempt({
    snapshot: scoped,
    attempt: attempt({ kind: 'communicate', attemptId: uuid(132), runId, actorId: maxId,
      expectedRevision: scoped.revision, channelHandle: 'c-gesture', audienceHandles: ['h-99'], content }),
    actorKnowledge: maxKnowledge, approvalReceipt: approvalReceipt(content, { stateRevision: scoped.revision }), ids: idSource(1_900),
  });
  assert.equal(result.kind, 'applied');
  if (result.kind !== 'applied') return;
  assert.deepEqual(result.emission, { kind: 'emitted', eventId: result.events[0]?.id });
  assert.deepEqual(result.events[0]?.kind === 'communicated' ? result.events[0].effectiveAudience : undefined, []);
  assert.deepEqual(result.perceptions, []);
});

test('un canal broadcast define la audiencia solicitada y no acepta selección dirigida', () => {
  const base = worldFixture();
  const snapshot = WorldSnapshotSchema.parse({
    ...base,
    channels: base.channels.map((channel) => channel.id === speechChannel ? { ...channel, scope: 'broadcast' } : channel),
  });
  const content = { kind: 'speech', text: 'Atención, todos.' };
  const broadcast = resolveWorldAttempt({
    snapshot,
    attempt: attempt({ kind: 'communicate', attemptId: uuid(136), runId, actorId: maxId, expectedRevision: 0,
      channelHandle: 'c-speech', audienceHandles: [], content }),
    actorKnowledge: maxKnowledge, approvalReceipt: approvalReceipt(content), ids: idSource(2_200),
  });
  assert.equal(broadcast.kind, 'applied');
  if (broadcast.kind !== 'applied') return;
  const event = broadcast.events[0];
  assert.deepEqual(event?.kind === 'communicated' ? event.requestedAudience : [], [ninetyNineId, fangId]);
  assert.deepEqual(event?.kind === 'communicated' ? event.effectiveAudience : [], [ninetyNineId, fangId]);

  const directedArgs = attempt({ kind: 'communicate', attemptId: uuid(137), runId, actorId: maxId, expectedRevision: 0,
    channelHandle: 'c-speech', audienceHandles: ['h-99'], content });
  const directed = resolveWorldAttempt({
    snapshot, attempt: directedArgs, actorKnowledge: maxKnowledge,
    approvalReceipt: approvalReceipt(content), ids: idSource(2_300),
  });
  assert.equal(directed.kind, 'notApplied');
  if (directed.kind === 'notApplied') assert.equal(directed.reason, 'audience-invalid');
});

test('escuchar admite canales gestuales con modalidad auditiva', () => {
  const snapshot = worldFixture();
  const result = resolveWorldAttempt({
    snapshot,
    attempt: attempt({ kind: 'observe', attemptId: uuid(135), runId, actorId: maxId, expectedRevision: 0,
      target: { modality: 'auditory', targetHandle: 'h-fang', channelHandle: 'c-animal-sound' } }),
    actorKnowledge: maxKnowledge, ids: idSource(2_100),
  });
  assert.equal(result.kind, 'applied');
});

test('una revisión obsoleta exige repercepción y una puerta cerrada bloquea el movimiento sin efectos', () => {
  const snapshot = worldFixture();
  const staleAttempt = attempt({ kind: 'wait', attemptId: uuid(80), runId, actorId: maxId, expectedRevision: 4, durationMs: 100 });
  const staleResult = resolveWorldAttempt({ snapshot, attempt: staleAttempt, actorKnowledge: maxKnowledge, ids: idSource() });
  assert.equal(staleResult.kind, 'stale');
  assert.deepEqual(staleResult.events, []);
  assert.deepEqual(staleResult.newSnapshot, snapshot);

  const move = attempt({ kind: 'move', attemptId: uuid(81), runId, actorId: maxId, expectedRevision: 0, destinationHandle: 'p-hall' });
  const blocked = resolveWorldAttempt({ snapshot, attempt: move, actorKnowledge: maxKnowledge, ids: idSource(4_000) });
  assert.equal(blocked.kind, 'notApplied');
  if (blocked.kind === 'notApplied') assert.equal(blocked.reason, 'door-blocked');
  assert.deepEqual(blocked.newSnapshot, snapshot);

  const opened = WorldSnapshotSchema.parse({ ...snapshot, doors: snapshot.doors.map((door) => ({ ...door, state: 'open' })) });
  const withBlocker = WorldSnapshotSchema.parse({
    ...opened,
    entities: [...opened.entities, {
      kind: 'object', entityId: WorldEntityIdSchema.parse(uuid(23)), label: 'Cajón', description: 'Cajón en el paso.',
      collisionRadius: 0.5, blocksMovement: true, portable: false,
    }],
    inventory: [...opened.inventory, {
      objectEntityId: WorldEntityIdSchema.parse(uuid(23)), location: { kind: 'atPlace', placeId: hallId, position: { x: 1, y: 1 } }, revision: 0,
    }],
  });
  const collided = resolveWorldAttempt({ snapshot: withBlocker, attempt: { ...move, expectedRevision: withBlocker.revision }, actorKnowledge: maxKnowledge, ids: idSource(5_000) });
  assert.equal(collided.kind, 'notApplied');
  if (collided.kind === 'notApplied') assert.equal(collided.reason, 'collision');
});

test('una oferta sólo reserva intención, se acepta con handle recibido y caduca como evento', () => {
  const snapshot = worldFixture();
  const offerAttempt = attempt({ kind: 'offer', attemptId: uuid(90), runId, actorId: maxId, expectedRevision: 0, objectHandle: 'h-envelope', recipientHandle: 'h-99' });
  const offered = resolveWorldAttempt({ snapshot, attempt: offerAttempt, actorKnowledge: maxKnowledge, ids: idSource(6_000) });
  assert.equal(offered.kind, 'applied');
  if (offered.kind !== 'applied') return;
  assert.equal(offered.events[0]?.kind, 'offerCreated');
  assert.equal(offered.newSnapshot.inventory.find((entry) => entry.objectEntityId === envelopeEntity)?.location.kind, 'heldBy');
  assert.equal(offered.newSnapshot.offers[0]?.state, 'open');

  const beforeDelivery = buildActorWorldView({
    snapshot: offered.newSnapshot, actorId: ninetyNineId,
    knowledge: emptyActorKnowledge({ runId, actorId: ninetyNineId }), pendingPerceptions: [], ids: idSource(6_500),
  });
  assert.deepEqual(beforeDelivery.view.offers, []);
  const notYetReceived = resolveWorldAttempt({
    snapshot: offered.newSnapshot,
    attempt: attempt({ kind: 'acceptOffer', attemptId: uuid(133), runId, actorId: ninetyNineId,
      expectedRevision: offered.newSnapshot.revision, offerHandle: 'not-delivered' }),
    actorKnowledge: beforeDelivery.knowledge, ids: idSource(6_600),
  });
  assert.equal(notYetReceived.kind, 'notApplied');
  if (notYetReceived.kind === 'notApplied') assert.equal(notYetReceived.reason, 'offer-not-received');

  const offerPerception = offered.perceptions.find((perception) => perception.kind === 'offer');
  assert.ok(offerPerception);
  if (offerPerception === undefined || offerPerception.kind !== 'offer') return;

  const recipientKnowledge = emptyActorKnowledge({ runId, actorId: ninetyNineId });
  const recipientView = buildActorWorldView({
    snapshot: offered.newSnapshot, actorId: ninetyNineId, knowledge: recipientKnowledge,
    pendingPerceptions: [offerPerception], ids: idSource(7_000),
  });
  const pendingOffer = recipientView.view.offers[0];
  assert.ok(pendingOffer);
  assert.equal(recipientView.view.inbox[0]?.kind, 'offer');
  const accepted = resolveWorldAttempt({
    snapshot: offered.newSnapshot,
    attempt: attempt({ kind: 'acceptOffer', attemptId: uuid(91), runId, actorId: ninetyNineId, expectedRevision: offered.newSnapshot.revision, offerHandle: pendingOffer.handle }),
    actorKnowledge: recipientView.knowledge,
    ids: idSource(8_000),
  });
  assert.equal(accepted.kind, 'applied');
  if (accepted.kind !== 'applied') return;
  assert.equal(accepted.events[0]?.kind, 'offerAccepted');
  assert.deepEqual(accepted.newSnapshot.inventory.find((entry) => entry.objectEntityId === envelopeEntity)?.location, { kind: 'heldBy', entityId: ninetyNineEntity });
  assert.equal(accepted.newSnapshot.offers[0]?.state, 'accepted');

  const expiring = resolveWorldAttempt({ snapshot, attempt: offerAttempt, actorKnowledge: maxKnowledge, ids: idSource(9_000) });
  assert.equal(expiring.kind, 'applied');
  if (expiring.kind !== 'applied') return;
  const expiringOffer = expiring.newSnapshot.offers[0];
  assert.ok(expiringOffer?.state === 'open');
  const expiringPerception = expiring.perceptions.find((perception) => perception.kind === 'offer');
  assert.ok(expiringPerception?.kind === 'offer');
  const expiringRecipientView = buildActorWorldView({
    snapshot: expiring.newSnapshot, actorId: ninetyNineId,
    knowledge: emptyActorKnowledge({ runId, actorId: ninetyNineId }),
    pendingPerceptions: [expiringPerception], ids: idSource(9_500),
  });
  const waiting = resolveWorldAttempt({
    snapshot: expiring.newSnapshot,
    attempt: attempt({ kind: 'wait', attemptId: uuid(92), runId, actorId: ninetyNineId, expectedRevision: expiring.newSnapshot.revision, durationMs: 6_000 }),
    actorKnowledge: expiringRecipientView.knowledge,
    ids: idSource(10_000),
  });
  assert.equal(waiting.kind, 'applied');
  if (waiting.kind !== 'applied') return;
  assert.ok(waiting.events.some((event) => event.kind === 'offerInvalidated' && event.cause === 'expired'));
  assert.equal(waiting.newSnapshot.offers[0]?.state, 'invalidated');
  const refused = resolveWorldAttempt({
    snapshot: waiting.newSnapshot,
    attempt: attempt({ kind: 'acceptOffer', attemptId: uuid(93), runId, actorId: ninetyNineId, expectedRevision: waiting.newSnapshot.revision, offerHandle: expiringOffer.handle }),
    actorKnowledge: expiringRecipientView.knowledge,
    ids: idSource(11_000),
  });
  assert.equal(refused.kind, 'notApplied');
  if (refused.kind === 'notApplied') assert.equal(refused.reason, 'offer-not-open');
  assert.deepEqual(refused.newSnapshot, waiting.newSnapshot);
});

test('el catálogo cerrado de dispositivo fija el efecto y el reloj ficticio avanza por duración', () => {
  const snapshot = worldFixture();
  const unknownOperation = attempt({
    kind: 'useDevice', attemptId: uuid(100), runId, actorId: maxId, expectedRevision: 0,
    deviceHandle: 'h-device', operationId: 'ejecutar-shell',
  });
  const rejected = resolveWorldAttempt({ snapshot, attempt: unknownOperation, actorKnowledge: maxKnowledge, ids: idSource() });
  assert.equal(rejected.kind, 'notApplied');
  if (rejected.kind === 'notApplied') assert.equal(rejected.reason, 'operation-not-in-catalog');
  assert.deepEqual(rejected.newSnapshot, snapshot);

  const power = attempt({
    kind: 'useDevice', attemptId: uuid(101), runId, actorId: maxId, expectedRevision: 0,
    deviceHandle: 'h-device', operationId: 'power-on',
  });
  const powered = resolveWorldAttempt({ snapshot, attempt: power, actorKnowledge: maxKnowledge, ids: idSource(12_000) });
  assert.equal(powered.kind, 'applied');
  if (powered.kind !== 'applied') return;
  assert.equal(powered.newSnapshot.clock.instant, 100);
  const device = powered.newSnapshot.entities.find((entity) => entity.entityId === deviceEntity);
  assert.equal(device?.kind === 'device' ? device.power : undefined, 'on');

  const light = attempt({
    kind: 'useDevice', attemptId: uuid(102), runId, actorId: maxId, expectedRevision: powered.newSnapshot.revision,
    deviceHandle: 'h-device', operationId: 'bright-room',
  });
  const lit = resolveWorldAttempt({ snapshot: powered.newSnapshot, attempt: light, actorKnowledge: maxKnowledge, ids: idSource(13_000) });
  assert.equal(lit.kind, 'applied');
  if (lit.kind !== 'applied') return;
  assert.equal(lit.newSnapshot.clock.instant, 250);
  assert.equal(lit.newSnapshot.places.find((place) => place.id === roomId)?.lighting, 'bright');
});

test('los cambios subjetivos sólo actualizan recuerdos propios con evidencia propia', () => {
  const snapshot = worldFixture();
  const belief = attempt({
    kind: 'reviseBelief', attemptId: uuid(110), runId, actorId: maxId, expectedRevision: 0,
    change: { kind: 'new', content: 'Creo que la puerta oculta una salida.', confidence: 0.6 },
    evidenceExperienceIds: [evidenceId],
  });
  const result = resolveWorldAttempt({ snapshot, attempt: belief, actorKnowledge: maxKnowledge, ids: idSource(14_000) });
  assert.equal(result.kind, 'applied');
  if (result.kind !== 'applied') return;
  assert.deepEqual(result.events, []);
  assert.equal(result.newSnapshot.seq, snapshot.seq);
  const maxCharacter = result.newSnapshot.entities.find((entity) => entity.kind === 'character' && entity.characterId === maxId);
  assert.ok(maxCharacter?.kind === 'character');
  assert.equal(maxCharacter.mind.beliefs[0]?.content, 'Creo que la puerta oculta una salida.');
  assert.equal(maxCharacter.mind.experiences.length, 2);
  const ninetyNine = result.newSnapshot.entities.find((entity) => entity.kind === 'character' && entity.characterId === ninetyNineId);
  assert.equal(ninetyNine?.kind === 'character' ? ninetyNine.mind.experiences.length : -1, 1);

  const foreignEvidence = ExperienceIdSchema.parse(uuid(43));
  const invalid = attempt({
    kind: 'reviseBelief', attemptId: uuid(111), runId, actorId: maxId, expectedRevision: result.revision,
    change: { kind: 'new', content: 'Recuerdo ajeno.', confidence: 1 }, evidenceExperienceIds: [foreignEvidence],
  });
  const refused = resolveWorldAttempt({ snapshot: result.newSnapshot, attempt: invalid, actorKnowledge: maxKnowledge, ids: idSource(15_000) });
  assert.equal(refused.kind, 'notApplied');
  if (refused.kind === 'notApplied') assert.equal(refused.reason, 'evidence-not-owned');
  assert.deepEqual(refused.newSnapshot, result.newSnapshot);
});

test('schemas rechazan argumentos adicionales en acciones y tipos de estado serializables', () => {
  const snapshot = worldFixture();
  assert.doesNotThrow(() => JSON.stringify(snapshot));
  assert.throws(() => WorldAttemptSchema.parse({
    kind: 'wait', attemptId: uuid(120), runId, actorId: maxId, expectedRevision: 0, durationMs: 100,
    shellCommand: 'rm -rf /',
  }));
  assert.throws(() => ActorKnowledgeSchema.parse({ runId, actorId: maxId, bindings: [{ kind: 'entity', handle: 'x', entityId: maxEntity }], extra: true }));
});

test('una intervención humana se convierte en evento y testimonio sólo para quienes pueden oírla', () => {
  const snapshot = worldFixture();
  const resolution = resolveHumanIntervention({
    snapshot, profile: humanProfile, request: humanSpeech(),
    interventionId: HumanInterventionIdSchema.parse(uuid(200)), expectedRevision: snapshot.revision, ids: idSource(20_000),
  });
  assert.equal(resolution.kind, 'applied');
  if (resolution.kind !== 'applied') return;
  assert.equal(resolution.events[0]?.kind, 'humanIntervention');
  assert.equal(resolution.events[0]?.origin.kind, 'human');
  assert.deepEqual(resolution.events[0]?.kind === 'humanIntervention' ? resolution.events[0].effectiveAudience : [], [maxId, ninetyNineId]);
  assert.equal(resolution.perceptions.length, 2);
  assert.ok(resolution.perceptions.every((perception) => perception.kind === 'testimony'));
  assert.equal(resolution.newSnapshot.seq, snapshot.seq + resolution.events.length);
  assert.equal(resolution.newSnapshot.clock.instant, snapshot.clock.instant + snapshot.actionDurations.speechMs);

  const maxView = buildActorWorldView({
    snapshot: resolution.newSnapshot, actorId: maxId,
    knowledge: emptyActorKnowledge({ runId, actorId: maxId }),
    pendingPerceptions: resolution.perceptions.filter((perception) => perception.recipientCharacterId === maxId),
    ids: idSource(21_000),
  }).view;
  assert.deepEqual(maxView.inbox.at(-1), {
    kind: 'testimony', speakerDisplayName: 'Alex', channelLabel: 'Voz cercana',
    content: { kind: 'speech', text: 'Encontré el informe, pero no sé si es auténtico.' }, fictitiousAt: 200,
  });
  assert.equal(JSON.stringify(maxView).includes('Historia privada completa'), false);
});

test('el contexto del interlocutor muestra sólo canales y personajes que puede alcanzar con su voz', () => {
  const context = projectHumanInteractionContext({ snapshot: worldFixture(), profile: humanProfile });
  assert.ok(context);
  assert.equal(context.kind, 'human-interaction-context');
  assert.equal(context.channel.label, 'Voz cercana');
  assert.deepEqual(context.recipients.map((recipient) => recipient.characterId), [maxId, ninetyNineId, fangId]);
  assert.equal(context.recipients.find((recipient) => recipient.characterId === ninetyNineId)?.displayName, 'La condesa');
  assert.equal(JSON.stringify(context).includes('Agente 99'), false);
  assert.equal(JSON.stringify(context).includes('Historia privada completa'), false);
});

test('un canal broadcast deriva su audiencia y respeta disponibilidad y alcance auditivo', () => {
  const base = worldFixture();
  const snapshot = WorldSnapshotSchema.parse({
    ...base,
    channels: base.channels.map((channel) => channel.id === speechChannel && channel.kind === 'speech'
      ? { ...channel, scope: 'broadcast', maxRange: 2 }
      : channel),
  });
  const result = resolveHumanIntervention({
    snapshot, profile: humanProfile, request: humanSpeech([]),
    interventionId: uuid(201), expectedRevision: snapshot.revision, ids: idSource(22_000),
  });
  assert.equal(result.kind, 'applied');
  if (result.kind !== 'applied') return;
  const event = result.events[0];
  assert.equal(event?.kind, 'humanIntervention');
  if (event?.kind !== 'humanIntervention') return;
  assert.deepEqual(event.requestedAudience, [maxId, ninetyNineId, fangId]);
  assert.deepEqual(event.effectiveAudience, [maxId]);
  assert.deepEqual(result.perceptions.map((perception) => perception.recipientCharacterId), [maxId]);
});

test('la intervención no se aplica con destinatarios fuera de escena, canal ajeno al perfil o revisión obsoleta', () => {
  const snapshot = worldFixture();
  const outsideScene = resolveHumanIntervention({
    snapshot, profile: humanProfile, request: humanSpeech(['desconocido']),
    interventionId: uuid(202), expectedRevision: snapshot.revision, ids: idSource(23_000),
  });
  assert.equal(outsideScene.kind, 'notApplied');
  if (outsideScene.kind === 'notApplied') assert.equal(outsideScene.reason, 'audience-invalid');

  const wrongChannel = resolveHumanIntervention({
    snapshot, profile: humanProfile,
    request: { ...humanSpeech(), channelId: gestureChannel },
    interventionId: uuid(203), expectedRevision: snapshot.revision, ids: idSource(24_000),
  });
  assert.equal(wrongChannel.kind, 'notApplied');
  if (wrongChannel.kind === 'notApplied') assert.equal(wrongChannel.reason, 'channel-unavailable');

  const stale = resolveHumanIntervention({
    snapshot, profile: humanProfile, request: humanSpeech(),
    interventionId: uuid(204), expectedRevision: 1, ids: idSource(25_000),
  });
  assert.equal(stale.kind, 'stale');
  if (stale.kind === 'stale') assert.equal(stale.events.length, 0);
});

test('la duración de una intervención expira ofertas con eventos de sistema causalmente ligados', () => {
  const base = worldFixture();
  const snapshot = WorldSnapshotSchema.parse({
    ...base,
    offers: [{
      state: 'open', id: uuid(210), handle: 'offer-human-expiry', objectEntityId: envelopeEntity,
      ownerEntityId: maxEntity, recipientCharacterId: ninetyNineId, objectRevision: 0,
      createdAt: 0, expiresAt: 100,
    }],
  });
  const result = resolveHumanIntervention({
    snapshot, profile: humanProfile, request: humanSpeech(),
    interventionId: uuid(211), expectedRevision: snapshot.revision, ids: idSource(26_000),
  });
  assert.equal(result.kind, 'applied');
  if (result.kind !== 'applied') return;
  assert.ok(result.events.some((event) => event.kind === 'offerInvalidated' && event.cause === 'expired'
    && event.origin.kind === 'system' && 'causeInterventionId' in event.origin));
  assert.equal(result.newSnapshot.offers[0]?.state, 'invalidated');
});
