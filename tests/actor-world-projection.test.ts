import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import {
  ActorKnowledgeSchema, WorldSnapshotSchema, emptyActorKnowledge,
} from '../src/domain/world.ts';
import type { WorldIdSource, WorldSnapshot } from '../src/domain/world.ts';
import { ContinuityReferenceSchema } from '../src/domain/preparation.ts';
import type { ActorWorldProjectionRequest } from '../src/domain/preparation.ts';
import {
  ActorWorldProjectionSchema, createActorWorldProjectionPort,
} from '../src/application/actor-world-projection.ts';
import {
  CharacterIdSchema, ExperienceIdSchema, FictionalInstantSchema, PerceptionIdSchema,
  RevisionSchema, RunIdSchema, WorldSeqSchema,
} from '../src/domain/values.ts';

// Explicit synthetic domain fixture; it is not a saved scene or canon source.
const runId = RunIdSchema.parse('00000000-0000-4000-8000-000000000701');
const actorId = CharacterIdSchema.parse('maxwell-smart');
const otherId = CharacterIdSchema.parse('agente-99');
const actorEntityId = '00000000-0000-4000-8000-000000000711';
const otherEntityId = '00000000-0000-4000-8000-000000000712';
const goalId = '00000000-0000-4000-8000-000000000713';
const sceneId = '00000000-0000-4000-8000-000000000714';
const channelId = '00000000-0000-4000-8000-000000000715';
const experienceId = ExperienceIdSchema.parse('00000000-0000-4000-8000-000000000716');
const perceptionId = PerceptionIdSchema.parse('00000000-0000-4000-8000-000000000717');
const continuity = ContinuityReferenceSchema.parse({
  continuityId: 'continuidad-principal', revision: 3, contentHash: 'a'.repeat(64),
});

function idSource(): WorldIdSource {
  let handle = 0;
  let uuid = 800;
  const nextUuid = () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`;
  return {
    eventId: nextUuid,
    perceptionId: nextUuid,
    experienceId: nextUuid,
    offerId: nextUuid,
    entityHandle: () => `entity-private-${++handle}`,
    placeHandle: () => `place-private-${++handle}`,
    channelHandle: () => `channel-private-${++handle}`,
    offerHandle: () => `offer-private-${++handle}`,
  };
}

function worldFixture(): WorldSnapshot {
  const actorExperience = {
    schemaVersion: 1,
    experienceId,
    runId,
    actorId,
    kind: 'perception',
    perceptionId,
    eventId: '00000000-0000-4000-8000-000000000718',
    content: 'Max recuerda haber oído un ruido antes de entrar.',
    sourceRefs: [],
    fictitiousAt: 100,
    receivedAt: 100,
    worldSeq: 0,
    confidence: 0.9,
    revision: 0,
    predecessor: { kind: 'initial' },
  };
  const commonCharacter = {
    kind: 'character',
    species: 'human',
    presentation: { kind: 'ordinary', label: 'Persona' },
    placeId: 'sala',
    position: { x: 1, y: 1 },
    collisionRadius: 0.25,
    blocksMovement: false,
    presence: { kind: 'present', sceneId },
    preparation: { kind: 'prepared', continuityId: continuity.continuityId, identityVersion: 1 },
    capabilities: ['move', 'observe', 'speak', 'gesture', 'wait', 'rest'],
    availability: { kind: 'available' },
    routine: { kind: 'always' },
    mind: { goals: [], beliefs: [], relationships: [], recognizedCharacterIds: [], experiences: [] },
  };
  return WorldSnapshotSchema.parse({
    schemaVersion: 1,
    runId,
    revision: 5,
    seq: 8,
    clock: { instant: 100, convention: { kind: 'fixedOffset', offsetMinutes: -180, label: 'Buenos Aires' } },
    places: [{ id: 'sala', name: 'Sala de control', description: 'Mesa y una consola.', width: 10, height: 10, lighting: 'normal' }],
    doors: [], connections: [], perceptualPaths: [],
    channels: [{ kind: 'speech', id: channelId, label: 'Voz cercana', enabled: true, maxRange: 5, scope: 'addressed', placeIds: ['sala'] }],
    entities: [
      {
        ...commonCharacter,
        entityId: actorEntityId,
        characterId: actorId,
        trueDisplayName: 'Maxwell Smart',
        mind: {
          goals: [{ kind: 'durable', id: goalId, description: 'Proteger la agencia.', priority: 0.8, state: 'active', revision: 2, history: [] }],
          beliefs: [{ experienceId, content: 'Max cree que hay alguien cerca.', confidence: 0.7, basedOn: [experienceId] }],
          relationships: [],
          recognizedCharacterIds: [],
          experiences: [actorExperience],
        },
      },
      {
        ...commonCharacter,
        entityId: otherEntityId,
        characterId: otherId,
        trueDisplayName: 'Agente 99',
        presentation: { kind: 'cover', label: 'La condesa' },
        position: { x: 2, y: 1 },
        mind: {
          goals: [], beliefs: [], relationships: [], recognizedCharacterIds: [],
          experiences: [{
            ...actorExperience,
            experienceId: ExperienceIdSchema.parse('00000000-0000-4000-8000-000000000719'),
            actorId: otherId,
            content: 'HISTORIA_PRIVADA_DE_99: conoce el código secreto.',
          }],
        },
      },
    ],
    inventory: [],
    scenes: [{ id: sceneId, label: 'La sala cerrada', lifecycle: { kind: 'open', startedAt: 100 }, participantIds: [actorId, otherId], placeIds: ['sala'] }],
    activeSceneId: sceneId,
    offers: [],
    actionDurations: {
      observeMs: 20, speechMs: 200, gestureMs: 100, takeMs: 100, offerMs: 100,
      acceptOfferMs: 100, maxWaitMs: 10_000, maxRestMs: 60_000,
      offerValidityMs: 5_000, interactionRange: 2,
    },
  });
}

function request(): ActorWorldProjectionRequest {
  return {
    actorId,
    identityVersion: RevisionSchema.parse(1),
    runId,
    continuity,
    expectedWorldRevision: RevisionSchema.parse(5),
    atWorldSeq: WorldSeqSchema.parse(8),
    fictionalAt: FictionalInstantSchema.parse(100),
  };
}

function communicationPerception() {
  return {
    kind: 'communication',
    id: PerceptionIdSchema.parse('00000000-0000-4000-8000-000000000720'),
    runId,
    recipientCharacterId: actorId,
    eventId: '00000000-0000-4000-8000-000000000721',
    sourceEntityId: otherEntityId,
    channelId,
    content: { kind: 'speech', text: 'Max, mira la puerta.' },
    targetEntityId: actorEntityId,
    fictitiousAt: 100,
  };
}

function hostPort(options: {
  conflict?: boolean;
  snapshot?: WorldSnapshot;
  pendingPerceptions?: unknown[];
} = {}) {
  const snapshot = options.snapshot ?? worldFixture();
  let storedKnowledge = emptyActorKnowledge({ runId, actorId });
  let casCount = 0;
  return {
    get storedKnowledge() { return storedKnowledge; },
    get casCount() { return casCount; },
    host: {
      async loadActorWorldCut() {
        return {
          kind: 'actor-world-host-cut',
          continuity,
          snapshot,
          knowledgeRevision: 4,
          knowledge: storedKnowledge,
          pendingPerceptions: options.pendingPerceptions ?? [communicationPerception()],
          pendingPerceptionIds: (options.pendingPerceptions ?? [communicationPerception()])
            .map((perception) => zPerceptionSchema.parse(perception).id),
        };
      },
      async compareAndSwapActorKnowledge(input: unknown) {
        casCount += 1;
        const write = zKnowledgeWriteSchema.parse(input);
        assert.equal(write.expectedWorldRevision, snapshot.revision);
        assert.equal(write.expectedWorldSeq, snapshot.seq);
        assert.deepEqual(write.expectedContinuity, continuity);
        assert.equal(write.expectedKnowledgeRevision, 4);
        if (options.conflict === true) return { kind: 'conflict' };
        storedKnowledge = write.knowledge;
        return { kind: 'stored', knowledgeRevision: 5 };
      },
    },
  };
}

const zKnowledgeWriteSchema = z.strictObject({
  kind: z.literal('actor-knowledge-cas'),
  actorId: CharacterIdSchema,
  runId: RunIdSchema,
  expectedWorldRevision: z.number().int(),
  expectedWorldSeq: WorldSeqSchema,
  expectedContinuity: ContinuityReferenceSchema,
  expectedKnowledgeRevision: z.number().int(),
  knowledge: ActorKnowledgeSchema,
});
const zPerceptionSchema = z.object({ id: PerceptionIdSchema });

test('proyecta contexto World tipado, persiste handles por CAS y omite memorias privadas del view', async () => {
  const host = hostPort();
  const projectionPort = createActorWorldProjectionPort({ host: host.host, ids: idSource() });
  const projection = ActorWorldProjectionSchema.parse(await projectionPort.projectForActor(request()));
  const encoded = JSON.stringify(projection.world);

  assert.equal(projection.world.now.instant, 100);
  assert.equal(projection.worldRevision, 5);
  assert.deepEqual(projection.inputPerceptionIds, [communicationPerception().id]);
  assert.equal(projection.world.self.goals[0]?.id, goalId);
  assert.equal(projection.world.channels[0]?.kind, 'speech');
  assert.match(encoded, /Max, mira la puerta/);
  assert.match(encoded, /La condesa/);
  assert.doesNotMatch(encoded, /HISTORIA_PRIVADA_DE_99|Max cree que hay alguien cerca|Max recuerda haber oído un ruido/);
  assert.doesNotMatch(encoded, new RegExp(actorEntityId));
  assert.doesNotMatch(encoded, new RegExp(otherEntityId));
  assert.equal(host.casCount, 1);
  assert.ok(host.storedKnowledge.bindings.some((binding) => binding.kind === 'entity' && binding.entityId === otherEntityId));
  assert.doesNotMatch(encoded, /00000000-0000-4000-8000-00000000071[12]/);
});

test('una colisión CAS impide que una vista con handles nuevos llegue al actor', async () => {
  const host = hostPort({ conflict: true });
  const projectionPort = createActorWorldProjectionPort({ host: host.host, ids: idSource() });
  await assert.rejects(projectionPort.projectForActor(request()), /Cambió el Escenario o el conocimiento/);
  assert.equal(host.casCount, 1);
  assert.equal(host.storedKnowledge.bindings.length, 0);
});

test('rechaza cortes World que no coinciden antes de persistir conocimiento', async () => {
  const snapshot = WorldSnapshotSchema.parse({ ...worldFixture(), seq: 7 });
  const host = hostPort({ snapshot });
  const projectionPort = createActorWorldProjectionPort({ host: host.host, ids: idSource() });
  await assert.rejects(projectionPort.projectForActor(request()), /corte ficticio exactos/);
  assert.equal(host.casCount, 0);
});

test('exige la revisión World exacta además del worldSeq al compilar una vista', async () => {
  const snapshot = WorldSnapshotSchema.parse({ ...worldFixture(), revision: 4 });
  const host = hostPort({ snapshot });
  const projectionPort = createActorWorldProjectionPort({ host: host.host, ids: idSource() });
  await assert.rejects(projectionPort.projectForActor(request()), /corte ficticio exactos/);
  assert.equal(host.casCount, 0);
});

test('rechaza un snapshot cuya identidad preparada no coincide con la solicitud', async () => {
  const initial = worldFixture();
  const snapshot = WorldSnapshotSchema.parse({
    ...initial,
    entities: initial.entities.map((entity) => entity.kind === 'character' && entity.characterId === actorId
      ? { ...entity, preparation: { kind: 'prepared', continuityId: continuity.continuityId, identityVersion: 2 } }
      : entity),
  });
  const host = hostPort({ snapshot });
  const projectionPort = createActorWorldProjectionPort({ host: host.host, ids: idSource() });
  await assert.rejects(projectionPort.projectForActor(request()), /identidad y continuidad preparadas/);
  assert.equal(host.casCount, 0);
});

test('rechaza percepciones de otro destinatario o posteriores al corte antes de exponer la vista', async () => {
  const wrongRecipient = { ...communicationPerception(), recipientCharacterId: otherId };
  const wrongRecipientHost = hostPort({ pendingPerceptions: [wrongRecipient] });
  const wrongRecipientPort = createActorWorldProjectionPort({ host: wrongRecipientHost.host, ids: idSource() });
  await assert.rejects(wrongRecipientPort.projectForActor(request()), /no dirigida a este actor/);
  assert.equal(wrongRecipientHost.casCount, 0);

  const futurePerception = { ...communicationPerception(), fictitiousAt: 101 };
  const futureHost = hostPort({ pendingPerceptions: [futurePerception] });
  const futurePort = createActorWorldProjectionPort({ host: futureHost.host, ids: idSource() });
  await assert.rejects(futurePort.projectForActor(request()), /posterior al corte ficticio/);
  assert.equal(futureHost.casCount, 0);
});
