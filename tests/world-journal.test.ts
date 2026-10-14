import { resolveReadyInferenceProfile } from '../src/domain/inference-profile.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { z } from 'zod';
import { ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { PreparedCharacterSchema } from '../src/domain/preparation.ts';
import { ActorJobExecutionSchema, ContinuistaReviewInputSchema, ContinuistaStoredReviewSchema } from '../src/domain/world-journal.ts';
import { setup as setupContinuistaFixture, deterministicFactory as continuistaActorFactory, responseFor as continuistaResponse } from './fixtures/continuista.ts';
import { createActorTurnWorker } from '../src/application/actor-turn-worker.ts';
import { assembleContinuistaReviewContext } from '../src/application/continuista-review-context.ts';
import { WorldSeqSchema } from '../src/domain/values.ts';
import { openJournal } from '../src/adapters/journal.ts';
import { commitWorldAttempt } from '../src/application/commit-world-attempt.ts';
import { createDeliverWorldWorker } from '../src/application/deliver-world.ts';
import { freezeExperience } from '../src/application/experience-envelope.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createWorldDeliverySupervisor } from '../src/application/world-delivery-supervisor.ts';
import { createActorPiRequestPort } from '../src/application/actor-pi-request-port.ts';
import {
  ActorKnowledgeSchema, GoalIdSchema, WorldEntityIdSchema, WorldResolutionSchema, WorldSnapshotSchema,
  hashCommunicationContent,
} from '../src/domain/world.ts';
import {
  CharacterIdSchema, ExperienceIdSchema, HashSchema, JobIdSchema,
  ProposalIdSchema, PulseIdSchema, RunIdSchema,
} from '../src/domain/values.ts';

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('Valor de prueba no serializable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(Reflect.get(value, key))}`).join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const runId = RunIdSchema.parse(uuid(701));
const maxId = CharacterIdSchema.parse('maxwell-smart');
const agentId = CharacterIdSchema.parse('agente-99');
const maxEntity = WorldEntityIdSchema.parse(uuid(710));
const agentEntity = WorldEntityIdSchema.parse(uuid(711));
const roomId = 'sala';
const sceneId = uuid(712);
const channelId = uuid(713);
const proposalId = ProposalIdSchema.parse(uuid(720));
const secondProposalId = ProposalIdSchema.parse(uuid(721));
const maxExperienceId = ExperienceIdSchema.parse(uuid(722));
const maxGoalId = GoalIdSchema.parse(uuid(723));
const thirdProposalId = ProposalIdSchema.parse(uuid(724));

function worldFixture() {
  const character = (input: { characterId: string; entityId: string; name: string; position: number }) => ({
    kind: 'character', entityId: input.entityId, characterId: input.characterId, trueDisplayName: input.name,
    species: 'human', presentation: { kind: 'ordinary', label: input.name }, placeId: roomId,
    position: { x: input.position, y: 1 }, collisionRadius: 0.25, blocksMovement: false,
    presence: { kind: 'present', sceneId }, preparation: { kind: 'prepared', continuityId: 'continuity-main', identityVersion: 1 },
    capabilities: ['observe', 'speak', 'gesture', 'wait', 'rest'], availability: { kind: 'available' },
    routine: { kind: 'always' },
    mind: input.characterId === maxId
      ? {
          goals: [{ kind: 'durable', id: maxGoalId, description: 'Proteger la agencia.', priority: 0.8, state: 'active', revision: 0, history: [maxExperienceId] }],
          beliefs: [], relationships: [], recognizedCharacterIds: [],
          experiences: [{
            schemaVersion: 1, experienceId: maxExperienceId, runId, actorId: maxId, kind: 'belief',
            content: 'Max mantiene una nota personal.', sourceRefs: [], fictitiousAt: 0, receivedAt: 0,
            worldSeq: 0, confidence: 1, revision: 0, predecessor: { kind: 'initial' }, basedOn: [],
          }],
        }
      : { goals: [], beliefs: [], relationships: [], recognizedCharacterIds: [], experiences: [] },
  });
  return WorldSnapshotSchema.parse({
    schemaVersion: 1, runId, revision: 0, seq: 0,
    clock: { instant: 0, convention: { kind: 'fixedOffset', offsetMinutes: -180, label: 'Buenos Aires' } },
    places: [{ id: roomId, name: 'Sala', description: 'Una sala vacía.', width: 10, height: 10, lighting: 'normal' }],
    doors: [], connections: [], perceptualPaths: [],
    channels: [{ kind: 'speech', id: channelId, label: 'Voz cercana', enabled: true, maxRange: 5, scope: 'addressed', placeIds: [roomId] }],
    entities: [
      character({ characterId: maxId, entityId: maxEntity, name: 'Maxwell Smart', position: 1 }),
      character({ characterId: agentId, entityId: agentEntity, name: 'Agente 99', position: 2 }),
    ],
    inventory: [],
    scenes: [{ id: sceneId, label: 'La sala', lifecycle: { kind: 'open', startedAt: 0 }, participantIds: [maxId, agentId], placeIds: [roomId] }],
    activeSceneId: sceneId, offers: [],
    actionDurations: {
      observeMs: 25, speechMs: 200, gestureMs: 100, takeMs: 100, offerMs: 100,
      acceptOfferMs: 100, maxWaitMs: 5_000, maxRestMs: 10_000, offerValidityMs: 5_000, interactionRange: 2,
    },
  });
}

function idSource(seed: number) {
  let next = seed;
  return {
    eventId: () => uuid(++next), perceptionId: () => uuid(++next), experienceId: () => uuid(++next),
    offerId: () => uuid(++next), entityHandle: () => `entity-${++next}`, placeHandle: () => `place-${++next}`,
    channelHandle: () => `channel-${++next}`, offerHandle: () => `offer-${++next}`,
  };
}

function waitAttempt(attemptId: number, actorId: string, expectedRevision: number) {
  return { kind: 'wait', attemptId: uuid(attemptId), runId, actorId, expectedRevision, durationMs: 100 };
}

function communicateAttempt(attemptId: number, expectedRevision: number) {
  return {
    kind: 'communicate', attemptId: uuid(attemptId), runId, actorId: maxId, expectedRevision,
    channelHandle: 'speech', audienceHandles: ['agent-99'], content: { kind: 'speech', text: '¿Me escuchás?' },
  };
}

const allCriteria = ['knowledge', 'continuity', 'identity', 'voice', 'periodPlace', 'motivation', 'rhythm', 'authority'] as const;

function registerRun(journal: ReturnType<typeof openJournal>, configuration: Record<string, unknown> = { model: 'test-profile', limit: 1 }) {
  const snapshot = WorldSnapshotSchema.parse(configuration.worldSnapshot ?? worldFixture());
  assert.equal(journal.registerWorldRun({
    initialSnapshot: snapshot, configurationRevision: 0,
    configuration,
    continuityFence: {
      kind: 'prepared-contexts', atWorldSeq: 0,
      contexts: [maxId, agentId].map((actorId) => ({
        actorId, continuityId: 'continuity-main', continuityRevision: 0,
        continuityContentHash: HashSchema.parse('b'.repeat(64)), identityVersion: 1,
        preparedContextHash: HashSchema.parse('a'.repeat(64)),
      })),
    },
    lifecycle: 'ready',
  }), 'stored');
  assert.equal(journal.setWorldLifecycle({ runId, expectedWorldRevision: 0, expectedConfigRevision: 0, target: 'running' }), 'updated');
  const knowledge = ActorKnowledgeSchema.parse({ runId, actorId: maxId, bindings: [
    { kind: 'channel', handle: 'speech', channelId },
    { kind: 'entity', handle: 'agent-99', entityId: agentEntity },
  ] });
  const continuity = { continuityId: 'continuity-main', revision: 0, contentHash: HashSchema.parse('b'.repeat(64)) };
  assert.deepEqual(journal.compareAndSwapActorKnowledge({
    kind: 'actor-knowledge-cas', actorId: maxId, runId, expectedWorldRevision: 0, expectedWorldSeq: 0,
    expectedContinuity: continuity, expectedKnowledgeRevision: 0, knowledge,
  }), { kind: 'stored', knowledgeRevision: 1 });
}

function registerAttempt(
  journal: ReturnType<typeof openJournal>, proposal: string, version: number, attempt: unknown,
  scope: { jobId?: string; generation?: number; proposalSlot?: number } = {},
) {
  assert.equal(journal.registerWorldProposal({
    runId, proposalId: ProposalIdSchema.parse(proposal), version,
    jobId: JobIdSchema.parse(scope.jobId ?? proposal), generation: scope.generation ?? 0,
    proposalSlot: scope.proposalSlot ?? version - 1, attempt,
  }), 'stored');
}

function reviewFor(input: { proposal: string; version: number; actorId?: string; stateRevision: number; text: string; criteria?: readonly string[]; verdict?: 'allow' | 'reformulate' | 'reject'; failedCriteria?: readonly string[]; complete?: boolean }) {
  return {
    kind: 'continuista', proposalId: ProposalIdSchema.parse(input.proposal), version: input.version,
    runId, actorId: input.actorId ?? maxId, stateRevision: input.stateRevision,
    exactContentHash: hashCommunicationContent({ kind: 'speech', text: input.text }),
    verdict: input.verdict ?? 'allow', criterionCodes: input.criteria ?? allCriteria,
    failedCriterionCodes: input.failedCriteria ?? (input.verdict === 'reformulate' ? ['voice'] : []),
    evidenceRefs: ['research:continuity-main'], complete: input.complete ?? true,
  };
}

function withJournal(run: (journal: ReturnType<typeof openJournal>, path: string, directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-world-journal-'));
  const path = join(directory, 'world.sqlite');
  const journal = openJournal({ path });
  try { run(journal, path, directory); }
  finally { try { journal.close(); } catch { /* Closed before reopen. */ } rmSync(directory, { recursive: true, force: true }); }
}

async function createQueuedHumanIntentFixture(journal: ReturnType<typeof openJournal>, texts: string[], configuration?: Record<string, unknown>) {
  const profile = {
    identity: {
      participantId: 'interlocutor-andres', displayName: 'Andrés',
      identityMarkdown: 'Una identidad ficticia propia.', lifeStoryMarkdown: 'Una historia redactada para esta puesta.',
    },
    presence: { kind: 'inScene' as const, sceneId, placeId: roomId, position: { x: 0.5, y: 1 }, channelId },
  };
  registerRun(journal, configuration ?? { model: 'test-profile', limit: 1, humanParticipants: [profile] });
  for (const [index, text] of texts.entries()) {
    const snapshot = journal.loadWorld({ runId });
    if (snapshot === undefined) throw new Error('Falta el Escenario de las intervenciones de prueba');
    const committed = journal.commitHumanIntervention({
      runId, participantId: profile.identity.participantId, expectedRevision: snapshot.revision,
      idempotencyKey: uuid(9_400 + index),
      request: {
        kind: 'speech', recipientCharacterIds: [maxId], channelId,
        content: { kind: 'speech', text },
      },
    });
    if (committed.kind !== 'stored' || committed.resolution.kind !== 'applied') {
      throw new Error('No se pudo confirmar la intervención de prueba');
    }
  }
  const result = await createDeliverWorldWorker({ journal, runId, actorId: maxId }).drain();
  if (result.kind !== 'completed') throw new Error('No se pudieron entregar las intervenciones de prueba');
  const queued = journal.readQueuedActorTurnIntents({ runId, actorId: maxId, limit: 100 });
  if (queued.length !== texts.length) throw new Error('La cantidad de intenciones entregadas no coincide');
  return { profile, perceptions: queued.map((item) => item.perceptionId) };
}

test('world run fija configuración/continuidad, CAS de conocimiento y cortes durables', () => {
  withJournal((journal) => {
    registerRun(journal);
    assert.deepEqual(journal.readWorldConfiguration({ runId }), { model: 'test-profile', limit: 1 });
    assert.equal(journal.readWorldConfiguration({ runId: RunIdSchema.parse(uuid(799)) }), undefined);
    assert.equal(journal.registerWorldRun({
      initialSnapshot: worldFixture(), configurationRevision: 0,
      configuration: { model: 'test-profile', limit: 1 },
      continuityFence: { kind: 'prepared-contexts', atWorldSeq: 0, contexts: [maxId, agentId].map((actorId) => ({
        actorId, continuityId: 'continuity-main', continuityRevision: 0,
        continuityContentHash: HashSchema.parse('b'.repeat(64)), identityVersion: 1,
        preparedContextHash: HashSchema.parse('a'.repeat(64)),
      })) }, lifecycle: 'ready',
    }), 'existing');
    assert.equal(journal.loadWorld({ runId })?.revision, 0);
    assert.equal(journal.loadWorld({ runId, throughWorldSeq: 0 })?.seq, 0);
    const actorCut = journal.loadActorWorldCut({
      actorId: maxId, identityVersion: 1, runId,
      continuity: { continuityId: 'continuity-main', revision: 0, contentHash: HashSchema.parse('b'.repeat(64)) },
      expectedWorldRevision: 0,
      atWorldSeq: 0, fictionalAt: 0,
    });
    assert.equal(actorCut?.kind, 'actor-world-host-cut');
    if (actorCut?.kind === 'actor-world-host-cut') {
      assert.equal(actorCut.knowledgeRevision, 1);
      assert.deepEqual(actorCut.pendingPerceptions, []);
    }
    assert.deepEqual(journal.compareAndSwapActorKnowledge({
      kind: 'actor-knowledge-cas', actorId: maxId, runId, expectedWorldRevision: 0, expectedWorldSeq: 0,
      expectedContinuity: { continuityId: 'continuity-main', revision: 0, contentHash: HashSchema.parse('b'.repeat(64)) },
      expectedKnowledgeRevision: 0, knowledge: ActorKnowledgeSchema.parse({ runId, actorId: maxId, bindings: [] }),
    }), { kind: 'conflict' });
  });
});

test('la intervención humana se confirma de forma idempotente, se entrega como testimonio y entra al corte Pi', () => {
  withJournal((journal, path) => {
    const profile = {
      identity: {
        participantId: 'interlocutor-andres', displayName: 'Andrés',
        identityMarkdown: 'Una identidad ficticia propia.', lifeStoryMarkdown: 'Una historia redactada para esta puesta.',
      },
      presence: { kind: 'inScene', sceneId, placeId: roomId, position: { x: 0.5, y: 1 }, channelId },
    };
    registerRun(journal, { model: 'test-profile', limit: 1, humanParticipants: [profile] });
    const command = {
      runId, participantId: profile.identity.participantId, expectedRevision: 0,
      idempotencyKey: uuid(901),
      request: {
        kind: 'speech', recipientCharacterIds: [maxId], channelId,
        content: { kind: 'speech', text: 'Max, ¿conoces el algoritmo de Fibonacci?' },
      },
    };
    const fault = new DatabaseSync(path);
    try {
      fault.exec(`CREATE TRIGGER reject_human_delivery BEFORE INSERT ON world_deliveries
        BEGIN SELECT RAISE(ABORT, 'reject-human-delivery'); END`);
      assert.throws(() => journal.commitHumanIntervention(command), /reject-human-delivery/);
      assert.equal(journal.loadWorld({ runId })?.revision, 0);
      assert.equal(fault.prepare('SELECT COUNT(*) AS n FROM world_events').get()?.n, 0);
      assert.equal(fault.prepare('SELECT COUNT(*) AS n FROM world_perceptions').get()?.n, 0);
      assert.equal(fault.prepare('SELECT COUNT(*) AS n FROM world_commits').get()?.n, 0);
      assert.equal(fault.prepare('SELECT COUNT(*) AS n FROM human_intervention_receipts').get()?.n, 0);
      fault.exec('DROP TRIGGER reject_human_delivery');
    } finally { fault.close(); }
    const first = journal.commitHumanIntervention(command);
    assert.equal(first.kind, 'stored');
    if (first.kind !== 'stored' || first.resolution.kind !== 'applied') assert.fail('La intervención debía quedar confirmada');
    assert.equal(first.commitIndex, 1);
    assert.equal(journal.loadWorld({ runId })?.revision, 1);
    assert.deepEqual(journal.readWorldEvents({ runId }).map((event) => event.kind), ['humanIntervention']);

    const retry = journal.commitHumanIntervention(command);
    assert.equal(retry.kind, 'existing');
    if (retry.kind !== 'existing') assert.fail('El retry debe devolver el receipt durable');
    assert.equal(retry.resolution.interventionId, first.resolution.interventionId);
    assert.equal(journal.commitHumanIntervention({
      ...command, request: { ...command.request, content: { kind: 'speech', text: 'Otra cosa.' } },
    }).kind, 'idempotencyConflict');

    const claimToken = uuid(902);
    const claimed = journal.claimWorldDelivery({
      runId, actorId: maxId, throughWorldSeq: 1, ownerToken: uuid(903), claimToken,
    });
    assert.equal(claimed.kind, 'claimed');
    if (claimed.kind !== 'claimed' || claimed.perception.kind !== 'testimony') assert.fail('Max debía recibir un testimonio privado');
    assert.equal(claimed.perception.sourceParticipantId, profile.identity.participantId);
    assert.equal(claimed.perception.speakerDisplayName, 'Andrés');
    assert.equal(claimed.perception.content.text, command.request.content.text);
    const experience = freezeExperience({
      schemaVersion: 1, experienceId: uuid(904), runId, actorId: maxId, kind: 'testimony',
      speakerParticipantId: profile.identity.participantId, speakerDisplayName: 'Andrés',
      eventId: claimed.perception.eventId, content: command.request.content.text, sourceRefs: [],
      fictitiousAt: claimed.perception.fictitiousAt, receivedAt: claimed.perception.fictitiousAt,
      worldSeq: 1, confidence: 1, revision: 0, predecessor: { kind: 'initial' },
    });
    assert.equal(journal.completeWorldDelivery({ perceptionId: claimed.perception.id, claimToken, experience }), 'delivered');
    assert.equal(journal.completeWorldDelivery({ perceptionId: claimed.perception.id, claimToken, experience }), 'existing');
    const cut = journal.loadActorWorldCut({
      actorId: maxId, identityVersion: 1, runId,
      continuity: { continuityId: 'continuity-main', revision: 0, contentHash: HashSchema.parse('b'.repeat(64)) },
      expectedWorldRevision: 1, atWorldSeq: 1, fictionalAt: 200,
    });
    assert.equal(cut?.kind, 'actor-world-host-cut');
    if (cut?.kind === 'actor-world-host-cut') {
      assert.deepEqual(cut.pendingPerceptionIds, [claimed.perception.id]);
      assert.equal(cut.pendingPerceptions[0]?.kind, 'testimony');
    }
    const database = new DatabaseSync(path);
    try {
      const perceptionRow = database.prepare(`
        SELECT attempt_id,origin_kind,origin_id FROM world_perceptions WHERE perception_id=?
      `).get(claimed.perception.id);
      assert.deepEqual({ ...perceptionRow }, {
        attempt_id: null, origin_kind: 'humanIntervention', origin_id: first.resolution.interventionId,
      }, 'el origen humano no se guarda en el campo legacy de intento');
      assert.equal(database.prepare('SELECT COUNT(*) AS n FROM memory_outbox').get()?.n, 1);
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { database.close(); }

    journal.close();
    const reopened = openJournal({ path });
    try {
      const durableRetry = reopened.commitHumanIntervention(command);
      assert.equal(durableRetry.kind, 'existing');
      if (durableRetry.kind === 'existing') assert.equal(durableRetry.resolution.interventionId, first.resolution.interventionId);
      assert.equal(reopened.readWorldEvents({ runId }).length, 1);
    } finally { reopened.close(); }
  });
});

test('el supervisor recupera una entrega interrumpida, guarda el testimonio y encola el turno atómicamente', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-world-delivery-worker-'));
  const path = join(directory, 'world.sqlite');
  const journal = openJournal({ path });
  let host: ReturnType<typeof openLocalHost> | undefined;
  let supervisor: ReturnType<typeof createWorldDeliverySupervisor> | undefined;
  try {
    const profile = {
      identity: {
        participantId: 'interlocutor-andres', displayName: 'Andrés',
        identityMarkdown: 'Una identidad ficticia propia.', lifeStoryMarkdown: 'Una historia redactada para esta puesta.',
      },
      presence: { kind: 'inScene', sceneId, placeId: roomId, position: { x: 0.5, y: 1 }, channelId },
    };
    registerRun(journal, { model: 'test-profile', limit: 1, humanParticipants: [profile] });
    const committed = journal.commitHumanIntervention({
      runId, participantId: profile.identity.participantId, expectedRevision: 0,
      idempotencyKey: uuid(911),
      request: {
        kind: 'speech', recipientCharacterIds: [maxId], channelId,
        content: { kind: 'speech', text: 'Max, ¿conoces el algoritmo de Fibonacci?' },
      },
    });
    assert.equal(committed.kind, 'stored');
    if (committed.kind !== 'stored' || committed.resolution.kind !== 'applied') assert.fail('Intervención no aplicada');
    const perceptionId = committed.resolution.perceptions[0]?.id;
    assert.ok(perceptionId);
    const interrupted = journal.claimWorldDelivery({
      runId, actorId: maxId, throughWorldSeq: 1, ownerToken: uuid(912), claimToken: uuid(913),
    });
    assert.equal(interrupted.kind, 'claimed');
    assert.equal(journal.readQueuedActorTurnIntents({ runId, actorId: maxId }).length, 0);

    journal.close();
    host = openLocalHost({ privateDataRoot: directory });
    supervisor = createWorldDeliverySupervisor({ journal: host.journal });
    assert.equal(supervisor.recover(), 1);
    await supervisor.waitForIdle();

    const afterRecovery = host.journal.loadWorld({ runId });
    assert.ok(afterRecovery);
    const scheduled = host.journal.commitHumanIntervention({
      runId, participantId: profile.identity.participantId, expectedRevision: afterRecovery.revision,
      idempotencyKey: uuid(914),
      request: {
        kind: 'speech', recipientCharacterIds: [maxId], channelId,
        content: { kind: 'speech', text: '¿Y qué significa ese número para nuestra misión?' },
      },
    });
    assert.equal(scheduled.kind, 'stored');
    if (scheduled.kind !== 'stored' || scheduled.resolution.kind !== 'applied') assert.fail('Segunda intervención no aplicada');
    supervisor.schedule({ runId, actorIds: [maxId] });
    await supervisor.waitForIdle();

    const queued = host.journal.readQueuedActorTurnIntents({ runId, actorId: maxId });
    assert.equal(queued.length, 2);
    assert.equal(queued[0]?.perceptionId, perceptionId);
    assert.equal(queued[0]?.perception.kind, 'testimony');
    if (queued[0]?.perception.kind !== 'testimony') assert.fail('La intención no conserva el testimonio');
    assert.equal(queued[0].perception.content.text, 'Max, ¿conoces el algoritmo de Fibonacci?');
    assert.equal(queued[0].perception.speakerDisplayName, 'Andrés');
    assert.equal(queued[1]?.perception.kind, 'testimony');
    if (queued[1]?.perception.kind !== 'testimony') assert.fail('La entrega agenda no conserva su testimonio');
    assert.equal(queued[1].perception.content.text, '¿Y qué significa ese número para nuestra misión?');

  const experiences = host.journal.readExperiences({ runId, actorId: maxId, throughWorldSeq: 1 });
    assert.equal(experiences.length, 1);
    assert.equal(experiences[0]?.kind, 'testimony');
    if (experiences[0]?.kind !== 'testimony') assert.fail('La experiencia no conserva su clase testimonial');
    assert.equal(experiences[0].content, queued[0].perception.content.text);
    assert.equal(experiences[0].speakerParticipantId, profile.identity.participantId);

    const database = new DatabaseSync(path);
    try {
      assert.deepEqual({ ...database.prepare(`
        SELECT state,attempts FROM world_deliveries WHERE perception_id=?
      `).get(perceptionId) }, { state: 'delivered', attempts: 2 });
      assert.deepEqual({ ...database.prepare(`
        SELECT state FROM actor_turn_intents WHERE perception_id=?
      `).get(perceptionId) }, { state: 'queued' });
      assert.equal(database.prepare('SELECT COUNT(*) AS n FROM memory_outbox').get()?.n, 2);
      assert.equal(database.prepare('SELECT COUNT(*) AS n FROM actor_turn_intents WHERE state=\'queued\'').get()?.n, 2);
    } finally { database.close(); }
  } finally {
    try { await supervisor?.close(); } catch { /* La salida puede haber cerrado el journal del host. */ }
    try { host?.close(); } catch { /* La salida puede haber cerrado el journal del host. */ }
    try { journal.close(); } catch { /* Journal cerrado antes de simular el reinicio. */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('jobs actorales coalescen intenciones, serializan claims y recuperan identidad/cuota tras restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-actor-job-recovery-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  let secondJournal: ReturnType<typeof openJournal> | undefined;
  try {
    const { perceptions } = await createQueuedHumanIntentFixture(journal, ['Primera pregunta.', 'Segunda pregunta.']);
    journal.close();
    const beforeV9 = new DatabaseSync(path);
    try {
      beforeV9.exec('DROP TABLE actor_turn_job_inputs; DROP TABLE actor_turn_jobs; DROP TABLE IF EXISTS model_time_spans; DROP TABLE IF EXISTS model_time_run_state; DROP TABLE IF EXISTS run_preflight_job_operations; DROP TABLE IF EXISTS run_preflight_job_results; DROP TABLE IF EXISTS run_preflight_job_history; DROP TABLE IF EXISTS run_preflight_jobs; DROP TABLE IF EXISTS pi_access_job_operations; DROP TABLE IF EXISTS pi_access_job_results; DROP TABLE IF EXISTS pi_access_job_history; DROP TABLE IF EXISTS pi_access_jobs; DROP TABLE IF EXISTS pi_oauth_job_operations; DROP TABLE IF EXISTS pi_oauth_job_history; DROP TABLE IF EXISTS pi_oauth_jobs; DELETE FROM schema_version WHERE version IN(9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28)');
    } finally { beforeV9.close(); }
    journal = openJournal({ path });
    assert.deepEqual(journal.readQueuedActorTurnIntents({ runId, actorId: maxId }).map((item) => item.perceptionId), perceptions,
      'la migración v8→v9 preserva intenciones entregadas sin asignarlas');
    const pulseId = PulseIdSchema.parse(uuid(9_500));
    const otherPulseId = PulseIdSchema.parse(uuid(9_501));
    journal.configureRun({ runId, maxCalls: 5 });
    journal.configurePulse({ runId, pulseId, maxCalls: 1 });
    journal.configurePulse({ runId, pulseId: otherPulseId, maxCalls: 2 });

    const first = journal.scheduleActorTurnJob({ runId, actorId: maxId, pulseId });
    assert.equal(first.kind, 'scheduled');
    if (first.kind !== 'scheduled') assert.fail('No se programó el job actoral');
    assert.deepEqual(first.job.perceptionIds, perceptions);
    const repeated = journal.scheduleActorTurnJob({ runId, actorId: maxId, pulseId });
    assert.equal(repeated.kind, 'existing');
    if (repeated.kind !== 'existing') assert.fail('El job duplicado no recuperó el registro activo');
    assert.deepEqual(repeated.job, first.job);
    assert.deepEqual(journal.readQueuedActorTurnIntents({ runId, actorId: maxId }), []);
    const otherPulse = journal.scheduleActorTurnJob({ runId, actorId: maxId, pulseId: otherPulseId });
    assert.equal(otherPulse.kind, 'existing');
    if (otherPulse.kind !== 'existing') assert.fail('La programación cambió de pulso durante el job activo');
    assert.equal(otherPulse.job.pulseId, pulseId);

    const firstLease = { ownerToken: uuid(9_510), claimToken: uuid(9_511) };
    const jobClaimRequest = { runId, actorId: maxId, jobId: first.job.jobId, generation: first.job.generation };
    const claimed = journal.claimActorTurnJob({ ...jobClaimRequest, ...firstLease });
    assert.equal(claimed.kind, 'claimed');
    if (claimed.kind !== 'claimed') assert.fail('No se pudo congelar el inbox en el claim');
    assert.deepEqual(claimed.job.frozenPerceptionIds, perceptions);
    const frozenWorldCut = claimed.job.frozenWorldCut;
    if (frozenWorldCut === null) assert.fail('El claim no congeló el corte World completo');
    assert.equal(journal.claimActorTurnJob({ ...jobClaimRequest, ...firstLease }).kind, 'existing');
    assert.deepEqual(journal.claimActorTurnJob({
      ...jobClaimRequest, ownerToken: uuid(9_512), claimToken: uuid(9_513),
    }), { kind: 'busy' });
    assert.equal(journal.scheduleActorTurnJob({ runId, actorId: maxId, pulseId }).kind, 'busy',
      'no se asigna un segundo job mientras el primero está running');

    const worldBeforeLateMessage = journal.loadWorld({ runId });
    if (worldBeforeLateMessage === undefined) throw new Error('Falta el Escenario para la pregunta tardía');
    const lateMessage = journal.commitHumanIntervention({
      runId, participantId: 'interlocutor-andres', expectedRevision: worldBeforeLateMessage.revision,
      idempotencyKey: uuid(9_522),
      request: {
        kind: 'speech', recipientCharacterIds: [maxId], channelId,
        content: { kind: 'speech', text: 'Max, una pregunta nueva mientras estabas pensando.' },
      },
    });
    assert.equal(lateMessage.kind, 'stored');
    if (lateMessage.kind !== 'stored' || lateMessage.resolution.kind !== 'applied') {
      assert.fail('No se pudo registrar la pregunta que llega durante el job');
    }
    await createDeliverWorldWorker({ journal, runId, actorId: maxId }).drain();
    const afterLateMessage = journal.loadWorld({ runId });
    if (afterLateMessage === undefined) throw new Error('Falta el Escenario después de la pregunta tardía');
    const actorCut = journal.loadActorWorldCut({
      actorId: maxId, identityVersion: 1, runId,
      continuity: { continuityId: 'continuity-main', revision: 0, contentHash: HashSchema.parse('b'.repeat(64)) },
      expectedWorldRevision: frozenWorldCut.worldRevision, atWorldSeq: frozenWorldCut.worldSeq,
      fictionalAt: frozenWorldCut.fictionalAt, actorJob: { ...firstLease, jobId: first.job.jobId, generation: first.job.generation },
    });
    assert.equal(actorCut?.kind, 'actor-world-host-cut');
    if (actorCut?.kind === 'actor-world-host-cut') {
      assert.equal(actorCut.snapshot.seq, frozenWorldCut.worldSeq,
        'el estado World coincide con el corte que congeló el claim');
      assert.deepEqual(actorCut.pendingPerceptionIds, perceptions,
        'el job en curso sólo ve el inbox congelado al reclamarlo');
    }
    const queuedDuringJob = journal.readQueuedActorTurnIntents({ runId, actorId: maxId });
    assert.equal(queuedDuringJob.length, 1, 'la pregunta tardía queda para el siguiente pulso');
    assert.equal(journal.scheduleActorTurnJob({ runId, actorId: maxId, pulseId }).kind, 'busy');

    const scope = { runId, pulseId, jobId: first.job.jobId, generation: first.job.generation };
    assert.deepEqual(journal.reserveNextRequest(scope), { kind: 'reserved', requestSeq: 0 });
    journal.transitionReservation({ jobId: scope.jobId, generation: scope.generation, requestSeq: 0, target: 'dispatched' });
    journal.close();
    journal = openJournal({ path });
    const newOwner = uuid(9_520);
    assert.equal(journal.recoverAbandonedActorTurnJobClaims({ ownerToken: newOwner }), 1);
    assert.equal(journal.recoverAbandonedActorTurnJobClaims({ ownerToken: newOwner }), 0);
    const samePulseRecovered = journal.scheduleActorTurnJob({ runId, actorId: maxId, pulseId });
    assert.equal(samePulseRecovered.kind, 'existing');
    if (samePulseRecovered.kind !== 'existing') assert.fail('Recovery no preservó corte congelado');
    assert.deepEqual(samePulseRecovered.job.perceptionIds, perceptions, 'un job recuperado no coalesce intenciones nuevas en su corte viejo');
    assert.equal(journal.readQueuedActorTurnIntents({ runId, actorId: maxId }).length, 1);
    const recovered = journal.scheduleActorTurnJob({ runId, actorId: maxId, pulseId: otherPulseId });
    assert.equal(recovered.kind, 'existing');
    if (recovered.kind !== 'existing') assert.fail('La recuperación no conservó el job');
    assert.equal(recovered.job.jobId, first.job.jobId);
    assert.equal(recovered.job.generation, first.job.generation);
    assert.deepEqual(recovered.job.frozenPerceptionIds, perceptions,
      'la recuperación conserva el inbox exacto del primer claim');
    assert.deepEqual(recovered.job.frozenWorldCut, frozenWorldCut,
      'la recuperación conserva también revisión, secuencia y hora ficticia');
    assert.deepEqual(journal.reserveRequest({ ...scope, requestSeq: 0 }), { kind: 'existing' });
    assert.deepEqual(journal.reserveNextRequest(scope), { kind: 'exhausted', scope: 'pulse' });

    secondJournal = openJournal({ path });
    const newLease = { ownerToken: newOwner, claimToken: uuid(9_521) };
    assert.equal(journal.claimActorTurnJob({ ...jobClaimRequest, ...newLease }).kind, 'claimed');
    assert.deepEqual(secondJournal.claimActorTurnJob({
      ...jobClaimRequest, ownerToken: uuid(9_522), claimToken: uuid(9_523),
    }), { kind: 'busy' }, 'un segundo journal no obtiene un claim paralelo');
    const claimedAfterRestart = journal.claimActorTurnJob({ ...jobClaimRequest, ...newLease });
    assert.equal(claimedAfterRestart.kind, 'existing');
    if (claimedAfterRestart.kind !== 'existing') assert.fail('El claim reintentado debe ser idempotente');
    assert.deepEqual(claimedAfterRestart.job.frozenPerceptionIds, perceptions);
    assert.deepEqual(claimedAfterRestart.job.frozenWorldCut, frozenWorldCut);
    assert.deepEqual({
      runId: claimedAfterRestart.job.runId, actorId: claimedAfterRestart.job.actorId,
      jobId: claimedAfterRestart.job.jobId, generation: claimedAfterRestart.job.generation,
      pulseId: claimedAfterRestart.job.pulseId, perceptionIds: claimedAfterRestart.job.perceptionIds,
    }, {
      runId: first.job.runId, actorId: first.job.actorId, jobId: first.job.jobId,
      generation: first.job.generation, pulseId: first.job.pulseId, perceptionIds: first.job.perceptionIds,
    });
  } finally {
    try { secondJournal?.close(); } catch { /* Puede cerrarse al limpiar un fallo de prueba. */ }
    try { journal.close(); } catch { /* Ya cerrado antes de simular el restart. */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('el puerto Pi liga reservas y checkpoints al claim y bloquea pausa, replay de despacho y resultados inciertos', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-actor-pi-port-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  try {
    await createQueuedHumanIntentFixture(journal, ['Max, escuchá esta pregunta.']);
    const pulseId = PulseIdSchema.parse(uuid(9_700));
    journal.configureRun({ runId, maxCalls: 4 });
    journal.configurePulse({ runId, pulseId, maxCalls: 3 });
    const scheduled = journal.scheduleActorTurnJob({ runId, actorId: maxId, pulseId });
    if (scheduled.kind !== 'scheduled') assert.fail('Falta el job de prueba');
    let lease = { ownerToken: uuid(9_701), claimToken: uuid(9_702) };
    let claim = journal.claimActorTurnJob({ runId, actorId: maxId, jobId: scheduled.job.jobId,
      generation: scheduled.job.generation, ...lease });
    if (claim.kind !== 'claimed' || claim.job.frozenWorldCut === null) assert.fail('Falta el corte actoral');
    let execution = {
      runId, actorId: maxId, pulseId, jobId: scheduled.job.jobId, generation: scheduled.job.generation, lease,
    };
    let scope = { runId, pulseId, jobId: execution.jobId, generation: execution.generation };
    const identity = { kind: 'actor', characterId: maxId } as const;
    const sessionPath = join(directory, 'session.jsonl');
    const registeredSession = journal.registerActorPiSession({ runId, actorId: maxId, sessionId: 'max-port', sessionPath,
      preparedContextHash: 'a'.repeat(64), profile: { provider: 'openai-codex', model: 'gpt-6-luna', reasoning: 'xhigh' } });
    let port = createActorPiRequestPort({ execution, journal });
    assert.deepEqual(await port.checkEligibility({ purpose: identity, scope }), { kind: 'active' });
    await assert.rejects(async () => port.reserveNextRequest({ purpose: { kind: 'actor', characterId: agentId }, scope }), /otra identidad/);
    const snapshot = { sessionId: 'max-port', sessionPath, candidateLeafId: null };
    await port.recordCheckpointCandidate({ identity, purpose: { kind: 'job-base', baseScope: scope }, snapshot });
    await port.recordCheckpointCandidate({ identity, purpose: { kind: 'job-base', baseScope: scope }, snapshot });
    assert.deepEqual(await port.reserveNextRequest({ purpose: identity, scope }), { kind: 'reserved', requestSeq: 0 });
    const world = journal.loadWorld({ runId });
    if (world === undefined) assert.fail('Falta el mundo');
    journal.setWorldLifecycle({ runId, expectedWorldRevision: world.revision, expectedConfigRevision: 0, target: 'paused' });
    await assert.rejects(async () => port.transitionReservation({ purpose: identity, scope, requestSeq: 0, target: 'dispatched' }), /run_not_running/);
    await port.transitionReservation({ purpose: identity, scope, requestSeq: 0, target: 'undispatched' });
    journal.setWorldLifecycle({ runId, expectedWorldRevision: world.revision, expectedConfigRevision: 0, target: 'running' });
    assert.deepEqual(await port.checkEligibility({ purpose: identity, scope }), { kind: 'inactive', reason: 'claim_inactive' });
    await assert.rejects(async () => port.recordCheckpointCandidate({identity,
      purpose:{kind:'terminal-candidate',baseScope:scope,outcome:'failed'},
      snapshot:{...snapshot,candidateLeafId:'late-after-resume'}}),/perdió el lease/);
    assert.equal(journal.readActorJobCheckpoints({...scope,actorId:maxId}).length,1,'el callback viejo no dejó checkpoint tras reanudar');
    const retry = journal.retryActorTurnJob({runId,actorId:maxId,jobId:scope.jobId,expectedGeneration:0,pulseId});
    assert.equal(retry.kind,'retried');
    lease = {ownerToken:uuid(9_711),claimToken:uuid(9_712)};
    claim = journal.claimActorTurnJob({runId,actorId:maxId,jobId:scope.jobId,generation:retry.job.generation,...lease});
    if (claim.kind !== 'claimed' || claim.job.frozenWorldCut === null) assert.fail('Retry no obtuvo claim/corte');
    execution = {runId,actorId:maxId,pulseId,jobId:scope.jobId,generation:retry.job.generation,lease};
    scope = {runId,pulseId,jobId:scope.jobId,generation:retry.job.generation};
    port = createActorPiRequestPort({execution,journal});
    assert.deepEqual(await port.reserveNextRequest({ purpose: identity, scope }), { kind: 'reserved', requestSeq: 0 });
    await assert.rejects(async () => port.transitionReservation({ purpose: identity, scope, requestSeq: 0, target: 'dispatched' }), /checkpoint input durable/);
    await port.recordCheckpointCandidate({ identity,
      purpose: { kind: 'request-input', baseScope: scope, request: { scope, requestSeq: 0 } },
      snapshot: { ...snapshot, candidateLeafId: 'leaf-input' } });
    await assert.rejects(async () => port.transitionReservation({ purpose: identity, scope, requestSeq: 0, target: 'dispatched' }), /candidato input durable/);
    await port.recordActorPiCandidate?.({ kind: 'request-input', candidateId: uuid(9_705), turnId: uuid(9_706),
      runId, actorId: maxId, scope, lease, base: registeredSession.session, inputCut: claim.job.frozenWorldCut,
      requestSeq: 0, candidateLeafId: 'leaf-input' });
    await port.transitionReservation({ purpose: identity, scope, requestSeq: 0, target: 'dispatched' });
    await assert.rejects(async () => port.transitionReservation({ purpose: identity, scope, requestSeq: 0, target: 'dispatched' }), /otro transporte/);
    await port.transitionReservation({ purpose: identity, scope, requestSeq: 0, target: 'ambiguous' });
    await port.recordCheckpointCandidate({ identity,
      purpose: { kind: 'terminal-candidate', baseScope: scope, outcome: 'failed', lastRequest: { scope, requestSeq: 0 } },
      snapshot: { ...snapshot, candidateLeafId: 'leaf-failed' } });
    assert.deepEqual(await port.checkEligibility({ purpose: identity, scope }), { kind: 'inactive', reason: 'request_unresolved' });
    await assert.rejects(async () => port.reserveNextRequest({ purpose: identity, scope }), /request_unresolved/);
    journal.recoverAbandonedActorTurnJobClaims({ ownerToken: uuid(9_703) });
    assert.deepEqual(await port.checkEligibility({ purpose: identity, scope }), { kind: 'inactive', reason: 'claim_inactive' });
    await assert.rejects(async () => port.recordCheckpointCandidate({ identity,
      purpose: { kind: 'terminal-candidate', baseScope: scope, outcome: 'failed' },
      snapshot: { ...snapshot, candidateLeafId: 'late-leaf' } }), /perdió el lease/);
    journal.close(); journal = openJournal({ path });
    assert.equal(journal.readActorJobCheckpoints({ ...scope, actorId: maxId }).length, 2);
    assert.equal(journal.loadActorPiSession({ runId, actorId: maxId })?.committedLeafId, null);
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('propuesta revisada y terminal Pi aceptado habilitan el commit exacto de un job', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-job-reviewed-commit-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  try {
    await createQueuedHumanIntentFixture(journal, ['Max, ¿me escuchás?'], coordinatorConfigurationFixture());
    const coordinated = journal.beginCoordinatorPulse({ runId });
    if (coordinated.kind !== 'started') assert.fail('Falta pulso');
    const pulseId = coordinated.pulse.pulseId;
    const job = coordinated.jobs[0]; if (job === undefined) assert.fail('Falta job');
    const lease = { ownerToken: uuid(9_731), claimToken: uuid(9_732) };
    const claim = journal.claimActorTurnJob({ runId, actorId: maxId, jobId: job.jobId, generation: 0, ...lease });
    if (claim.kind !== 'claimed' || claim.job.frozenWorldCut === null) assert.fail('Falta el corte');
    const scope = { runId, pulseId, jobId: claim.job.jobId, generation: claim.job.generation };
    const registration = journal.registerActorPiSession({ runId, actorId: maxId,
      sessionId: 'max-reviewed', sessionPath: join(directory, 'reviewed.jsonl'), preparedContextHash: 'a'.repeat(64),
      profile: { provider: 'openai-codex', model: 'gpt-6-luna', reasoning: 'xhigh' } });
    const port = createActorPiRequestPort({ journal, execution: { ...scope, actorId: maxId, lease } });
    const identity = { kind: 'actor', characterId: maxId } as const;
    await port.reserveNextRequest({ purpose: identity, scope, clockEpochId: uuid(9_740) });
    const candidateBase = { turnId: uuid(9_733), runId, actorId: maxId, scope, lease,
      base: registration.session, inputCut: claim.job.frozenWorldCut };
    await port.recordCheckpointCandidate({ identity,
      purpose: { kind: 'request-input', baseScope: scope, request: { scope, requestSeq: 0 } },
      snapshot: { sessionId: registration.session.sessionId, sessionPath: registration.session.sessionPath, candidateLeafId: 'leaf-input' } });
    await port.recordActorPiCandidate?.({ ...candidateBase, kind: 'request-input', candidateId: uuid(9_734),
      requestSeq: 0, candidateLeafId: 'leaf-input' });
    const attempt = communicateAttempt(9_735, claim.job.frozenWorldCut.worldRevision);
    journal.registerWorldProposal({ runId, proposalId, version: 1, jobId: scope.jobId, generation: scope.generation,
      proposalSlot: 0, lease, attempt });
    journal.recordContinuistaReview(reviewFor({ proposal: proposalId, version: 1,
      stateRevision: attempt.expectedRevision, text: attempt.content.text }));
    const commit = { runId, proposalId, version: 1, ids: idSource(9_750) };
    assert.throws(() => journal.commitWorldAttempt(commit), /turno Pi aceptado/);
    await port.transitionReservation({ purpose: identity, scope, requestSeq: 0, target: 'dispatched', wallTime: { clockEpochId: uuid(9_740), monotonicNs: process.hrtime.bigint().toString() } });
    await port.transitionReservation({ purpose: identity, scope, requestSeq: 0, target: 'completed', wallTime: { clockEpochId: uuid(9_740), monotonicNs: process.hrtime.bigint().toString() } });
    const candidateId = uuid(9_736);
    await port.recordActorPiCandidate?.({ ...candidateBase, kind: 'terminal-candidate', candidateId,
      outcome: 'completed', lastRequestSeq: 0, candidateLeafId: 'leaf-approved' });
    journal.acceptActorTurn({ candidateId, lease, proposal: { kind: 'durable', proposalId, version: 1,
      attemptHash: sha256(canonicalJson(attempt)) } });
    assert.equal(journal.readActorJobAcceptedProposal({ runId, actorId: maxId, jobId: scope.jobId, generation: scope.generation })?.proposalId, proposalId);
    assert.equal(journal.closeCoordinatorPulse({runId,pulseId}).state, 'running', 'aceptar Pi sin commit no completa el pulso');
    assert.equal(journal.commitWorldAttempt(commit).resolution.kind, 'applied');
    assert.equal(journal.closeCoordinatorPulse({runId,pulseId}).state, 'completed');
    await createDeliverWorldWorker({ journal, runId, actorId: agentId }).drain();
    await createDeliverWorldWorker({ journal, runId, actorId: maxId }).drain();
    assert.equal(journal.readQueuedActorTurnIntents({ runId, actorId: agentId }).length, 1);
    assert.equal(journal.readQueuedActorTurnIntents({ runId, actorId: maxId }).length, 0);
    journal.close(); journal = openJournal({ path });
    assert.equal(journal.commitWorldAttempt(commit).kind, 'existing');
    assert.equal(journal.readWorldEvents({ runId }).filter((event) => event.kind === 'communicated').length, 1);
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('sólo el lease vigente de un job actoral puede registrar una propuesta nueva', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-actor-proposal-lease-'));
  const path = join(directory, 'world.sqlite');
  const journal = openJournal({ path });
  try {
    await createQueuedHumanIntentFixture(journal, ['Max, ¿conoces Fibonacci?']);
    const pulseId = PulseIdSchema.parse(uuid(9_580));
    journal.configureRun({ runId, maxCalls: 3 });
    journal.configurePulse({ runId, pulseId, maxCalls: 2 });
    const scheduled = journal.scheduleActorTurnJob({ runId, actorId: maxId, pulseId });
    assert.equal(scheduled.kind, 'scheduled');
    if (scheduled.kind !== 'scheduled') assert.fail('No se programó el job actoral');

    const lease = { ownerToken: uuid(9_581), claimToken: uuid(9_582) };
    const claim = journal.claimActorTurnJob({
      runId, actorId: maxId, jobId: scheduled.job.jobId,
      generation: scheduled.job.generation, ...lease,
    });
    assert.equal(claim.kind, 'claimed');
    const snapshot = journal.loadWorld({ runId });
    if (snapshot === undefined) assert.fail('Falta el Escenario del job');
    const registration = {
      runId, proposalId, version: 1, jobId: scheduled.job.jobId,
      generation: scheduled.job.generation, proposalSlot: 0,
      attempt: communicateAttempt(9_583, snapshot.revision),
    };
    assert.throws(() => journal.registerWorldProposal(registration), /lease vigente/);
    assert.throws(() => journal.registerWorldProposal({
      ...registration, lease: { ownerToken: uuid(9_584), claimToken: lease.claimToken },
    }), /lease vigente/);
    assert.equal(journal.registerWorldProposal({ ...registration, lease }), 'stored');
    assert.equal(journal.registerWorldProposal({ ...registration, lease }), 'existing');
    assert.throws(() => journal.commitWorldAttempt({ runId, proposalId, version: 1, ids: idSource(9_585) }),
      /turno Pi requiere.*aceptado|turno Pi aceptado/);
  } finally {
    journal.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('aceptar un job valida lease y corte exacto, consume asignaciones de forma atómica y recupera el receipt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-actor-job-accept-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  try {
    const { perceptions } = await createQueuedHumanIntentFixture(journal, ['Max, ¿conoces Fibonacci?', '¿Y qué harías con ese dato?']);
    const pulseId = PulseIdSchema.parse(uuid(9_600));
    journal.configureRun({ runId, maxCalls: 3 });
    journal.configurePulse({ runId, pulseId, maxCalls: 2 });
    const scheduled = journal.scheduleActorTurnJob({ runId, actorId: maxId, pulseId });
    assert.equal(scheduled.kind, 'scheduled');
    if (scheduled.kind !== 'scheduled') assert.fail('No se programó el job para aceptar');
    const lease = { ownerToken: uuid(9_601), claimToken: uuid(9_602) };
    const jobClaimRequest = {
      runId, actorId: maxId, jobId: scheduled.job.jobId, generation: scheduled.job.generation,
    };
    const claim = journal.claimActorTurnJob({ ...jobClaimRequest, ...lease });
    assert.equal(claim.kind, 'claimed');
    if (claim.kind !== 'claimed' || claim.job.frozenWorldCut === null) assert.fail('Falta el corte World congelado');

    const worldBeforeLateMessage = journal.loadWorld({ runId });
    if (worldBeforeLateMessage === undefined) throw new Error('Falta el Escenario para la pregunta tardía');
    const lateMessage = journal.commitHumanIntervention({
      runId, participantId: 'interlocutor-andres', expectedRevision: worldBeforeLateMessage.revision,
      idempotencyKey: uuid(9_603),
      request: {
        kind: 'speech', recipientCharacterIds: [maxId], channelId,
        content: { kind: 'speech', text: 'Una pregunta nueva después del claim.' },
      },
    });
    assert.equal(lateMessage.kind, 'stored');
    if (lateMessage.kind !== 'stored' || lateMessage.resolution.kind !== 'applied') {
      assert.fail('No se pudo registrar la pregunta posterior al claim');
    }
    await createDeliverWorldWorker({ journal, runId, actorId: maxId }).drain();

    const registration = journal.registerActorPiSession({
      runId, actorId: maxId, sessionId: 'pi-session-max-job', sessionPath: join(directory, 'max-session.jsonl'),
      preparedContextHash: 'a'.repeat(64),
      profile: { provider: 'openai-codex', model: 'gpt-6-luna', reasoning: 'xhigh' },
    });
    const scope = { runId, pulseId, jobId: scheduled.job.jobId, generation: scheduled.job.generation };
    const inputCut = claim.job.frozenWorldCut;
    assert.deepEqual(journal.reserveNextRequest(scope), { kind: 'reserved', requestSeq: 0 });
    const requestCandidate = {
      kind: 'request-input', candidateId: uuid(9_610), turnId: uuid(9_611), runId, actorId: maxId,
      scope, lease, base: registration.session, requestSeq: 0, candidateLeafId: 'leaf-request', inputCut,
    };
    assert.throws(() => journal.recordActorPiCandidate({
      ...requestCandidate, candidateId: uuid(9_612), inputCut: { ...inputCut, perceptionIds: perceptions.slice(0, 1) },
    }), /corte World e inbox congelados/);
    assert.throws(() => journal.recordActorPiCandidate({
      ...requestCandidate, candidateId: uuid(9_614),
      lease: { ownerToken: uuid(9_620), claimToken: lease.claimToken },
    }), /claim vigente/);
    assert.equal(journal.recordActorPiCandidate(requestCandidate), 'stored');
    journal.transitionReservation({ jobId: scope.jobId, generation: scope.generation, requestSeq: 0, target: 'dispatched' });
    journal.transitionReservation({ jobId: scope.jobId, generation: scope.generation, requestSeq: 0, target: 'completed' });
    const candidateId = uuid(9_613);
    assert.equal(journal.recordActorPiCandidate({
      kind: 'terminal-candidate', candidateId, turnId: requestCandidate.turnId, runId, actorId: maxId,
      scope, lease, base: registration.session, outcome: 'completed', lastRequestSeq: 0,
      candidateLeafId: 'leaf-max-accepted', inputCut,
    }), 'stored');
    const acceptance = { candidateId, proposal: { kind: 'none' }, lease };
    assert.throws(() => journal.acceptActorTurn({
      ...acceptance, lease: { ownerToken: uuid(9_620), claimToken: lease.claimToken },
    }), /claim y owner vigentes/);

    const fault = new DatabaseSync(path);
    try {
      fault.exec(`CREATE TRIGGER fail_actor_job_accept BEFORE UPDATE OF state ON actor_turn_jobs
        WHEN NEW.state='accepted' BEGIN SELECT RAISE(ABORT, 'crash-before-job-accept'); END`);
      assert.throws(() => journal.acceptActorTurn(acceptance), /crash-before-job-accept/);
      assert.equal(fault.prepare('SELECT COUNT(*) AS n FROM actor_pi_consumptions').get()?.n, 0);
      assert.equal(fault.prepare("SELECT COUNT(*) AS n FROM actor_turn_job_inputs WHERE state='assigned'").get()?.n, 2);
      assert.equal(fault.prepare("SELECT state FROM actor_turn_jobs WHERE job_id=?").get(scheduled.job.jobId)?.state, 'running');
      fault.exec('DROP TRIGGER fail_actor_job_accept');
    } finally { fault.close(); }

    const accepted = journal.acceptActorTurn(acceptance);
    assert.deepEqual(accepted.consumedPerceptionIds, perceptions);
    assert.equal(journal.loadActorPiSession({ runId, actorId: maxId })?.committedLeafId, 'leaf-max-accepted');
    assert.equal(journal.readQueuedActorTurnIntents({ runId, actorId: maxId }).length, 1,
      'la percepción nueva permanece sin consumir para un job posterior');
    const afterAccept = new DatabaseSync(path);
    try {
      assert.equal(afterAccept.prepare("SELECT state FROM actor_turn_jobs WHERE job_id=?").get(scheduled.job.jobId)?.state, 'accepted');
      assert.equal(afterAccept.prepare("SELECT COUNT(*) AS n FROM actor_turn_job_inputs WHERE state='consumed'").get()?.n, 2);
      assert.equal(afterAccept.prepare('SELECT COUNT(*) AS n FROM actor_pi_consumptions').get()?.n, 2);
    } finally { afterAccept.close(); }
    journal.close();
    journal = openJournal({ path });
    assert.deepEqual(journal.acceptActorTurn(acceptance), accepted);
  } finally {
    try { journal.close(); } catch { /* Ya cerrado antes de simular el restart. */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('leer una configuración de corrida detecta cambios que no coinciden con su hash', () => {
  withJournal((journal, path) => {
    registerRun(journal);
    const database = new DatabaseSync(path);
    try {
      database.prepare('UPDATE world_runs SET configuration_json=? WHERE run_id=?').run('{"model":"tampered"}', runId);
    } finally { database.close(); }
    assert.throws(() => journal.readWorldConfiguration({ runId }), /Hash o JSON del world journal no coincide/);
  });
});

test('migración v5 backfillea commits por índice, conserva cortes y permite reabrir y repetirla', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-world-commits-v5-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  try {
    registerRun(journal);
    registerAttempt(journal, proposalId, 1, waitAttempt(730, maxId, 0));
    const first = journal.commitWorldAttempt({ runId, proposalId, version: 1, ids: idSource(1_000) });
    assert.equal(first.resolution.kind, 'applied');
    assert.equal(first.commitIndex, 1);
    registerAttempt(journal, secondProposalId, 1, {
      kind: 'reviseGoal', attemptId: uuid(731), runId, actorId: maxId, expectedRevision: 1,
      goalId: maxGoalId, change: { kind: 'reprioritize', priority: 0.3 }, evidenceExperienceIds: [maxExperienceId],
    });
    registerAttempt(journal, thirdProposalId, 1, waitAttempt(732, agentId, 1));
    const second = journal.commitWorldAttempt({ runId, proposalId: secondProposalId, version: 1, ids: idSource(1_100) });
    assert.equal(second.resolution.newSnapshot.revision, 2);
    assert.equal(second.resolution.newSnapshot.seq, 1);
    const third = journal.commitWorldAttempt({ runId, proposalId: thirdProposalId, version: 1, ids: idSource(1_200) });
    assert.equal(third.resolution.kind, 'stale');
    assert.equal(third.commitIndex, 3);

    const beforeMigration = new DatabaseSync(path);
    let legacyRows: unknown[] = [];
    let expectedSnapshots: Array<{
      run_id: string; origin_kind: string; origin_id: string; commit_index: number;
      world_revision: number; last_seq: number; snapshot_json: string; snapshot_hash: string; created_at: number;
    }> = [];
    try {
      legacyRows = beforeMigration.prepare(`
        SELECT run_id,origin_kind,origin_id,payload_json,payload_hash,commit_index,world_revision,last_seq,created_at
        FROM world_resolutions ORDER BY commit_index
      `).all();
      expectedSnapshots = legacyRows.map((value) => {
        const row = z.strictObject({
          run_id: z.string(), origin_kind: z.string(), origin_id: z.string(), payload_json: z.string(),
          payload_hash: z.string(), commit_index: z.number(), world_revision: z.number(), last_seq: z.number(), created_at: z.number(),
        }).parse(value);
        const resolution = WorldResolutionSchema.parse(JSON.parse(row.payload_json));
        const snapshotJson = canonicalJson(resolution.newSnapshot);
        return {
          run_id: row.run_id, origin_kind: row.origin_kind, origin_id: row.origin_id,
          commit_index: row.commit_index, world_revision: row.world_revision, last_seq: row.last_seq,
          snapshot_json: snapshotJson, snapshot_hash: sha256(snapshotJson), created_at: row.created_at,
        };
      });
      assert.deepEqual(expectedSnapshots.map((row) => row.commit_index), [1, 2, 3]);
      assert.equal(beforeMigration.prepare('SELECT COUNT(*) AS n FROM world_commits').get()?.n, 3);
      beforeMigration.exec('DROP TABLE world_commits; DROP TABLE IF EXISTS model_time_spans; DROP TABLE IF EXISTS model_time_run_state; DROP TABLE IF EXISTS run_preflight_job_operations; DROP TABLE IF EXISTS run_preflight_job_results; DROP TABLE IF EXISTS run_preflight_job_history; DROP TABLE IF EXISTS run_preflight_jobs; DROP TABLE IF EXISTS pi_access_job_operations; DROP TABLE IF EXISTS pi_access_job_results; DROP TABLE IF EXISTS pi_access_job_history; DROP TABLE IF EXISTS pi_access_jobs; DROP TABLE IF EXISTS pi_oauth_job_operations; DROP TABLE IF EXISTS pi_oauth_job_history; DROP TABLE IF EXISTS pi_oauth_jobs; DELETE FROM schema_version WHERE version IN(6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28)');
      assert.equal(beforeMigration.prepare('SELECT MAX(version) AS version FROM schema_version').get()?.version, 5);
    } finally { beforeMigration.close(); }

    journal.close();
    journal = openJournal({ path });
    const afterMigration = new DatabaseSync(path);
    try {
      const actualCommits = afterMigration.prepare(`
        SELECT run_id,origin_kind,origin_id,commit_index,world_revision,last_seq,snapshot_json,snapshot_hash,created_at
        FROM world_commits ORDER BY run_id,commit_index
      `).all().map((value) => z.strictObject({
        run_id: z.string(), origin_kind: z.string(), origin_id: z.string(), commit_index: z.number(),
        world_revision: z.number(), last_seq: z.number(), snapshot_json: z.string(), snapshot_hash: z.string(), created_at: z.number(),
      }).parse(value));
      assert.deepEqual(actualCommits, expectedSnapshots, 'el backfill conserva origen, orden, metadata y hash del snapshot');
      assert.deepEqual(afterMigration.prepare(`
        SELECT run_id,origin_kind,origin_id,payload_json,payload_hash,commit_index,world_revision,last_seq,created_at
        FROM world_resolutions ORDER BY commit_index
      `).all(), legacyRows, 'world_resolutions actorAttempt permanece idéntico');
      assert.equal(afterMigration.prepare('SELECT MAX(version) AS version FROM schema_version').get()?.version, 28);
    } finally { afterMigration.close(); }

    assert.equal(journal.loadWorld({ runId, throughWorldSeq: 0 })?.revision, 0);
    assert.equal(journal.loadWorld({ runId, throughWorldSeq: 1 })?.revision, 1,
      'el corte por secuencia conserva el primer commit de esa secuencia según commit_index');

    journal.close();
    const removeVersionMarker = new DatabaseSync(path);
    try { removeVersionMarker.exec('DROP TABLE IF EXISTS model_time_spans; DROP TABLE IF EXISTS model_time_run_state; DROP TABLE IF EXISTS run_preflight_job_operations; DROP TABLE IF EXISTS run_preflight_job_results; DROP TABLE IF EXISTS run_preflight_job_history; DROP TABLE IF EXISTS run_preflight_jobs; DROP TABLE IF EXISTS pi_access_job_operations; DROP TABLE IF EXISTS pi_access_job_results; DROP TABLE IF EXISTS pi_access_job_history; DROP TABLE IF EXISTS pi_access_jobs; DROP TABLE IF EXISTS pi_oauth_job_operations; DROP TABLE IF EXISTS pi_oauth_job_history; DROP TABLE IF EXISTS pi_oauth_jobs; DELETE FROM schema_version WHERE version IN(6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28)'); }
    finally { removeVersionMarker.close(); }
    journal = openJournal({ path });
    const idempotent = new DatabaseSync(path);
    try {
      assert.equal(idempotent.prepare('SELECT COUNT(*) AS n FROM world_commits').get()?.n, 3);
      assert.deepEqual(idempotent.prepare('SELECT commit_index,origin_kind,origin_id,snapshot_hash FROM world_commits ORDER BY commit_index').all()
        .map((value) => z.strictObject({
          commit_index: z.number(), origin_kind: z.string(), origin_id: z.string(), snapshot_hash: z.string(),
        }).parse(value)),
        expectedSnapshots.map(({ commit_index, origin_kind, origin_id, snapshot_hash }) => ({
          commit_index, origin_kind, origin_id, snapshot_hash,
        })));
    } finally { idempotent.close(); }

    const current = journal.loadWorld({ runId });
    if (current === undefined) assert.fail('Falta el snapshot actual luego de reabrir y repetir la migración');
    const nonActorSnapshot = WorldSnapshotSchema.parse({
      ...current, revision: current.revision + 1,
      clock: { ...current.clock, instant: current.clock.instant + 1 },
    });
    const nonActorJson = canonicalJson(nonActorSnapshot);
    const nonActorHash = sha256(nonActorJson);
    const database = new DatabaseSync(path);
    try {
      database.prepare(`
        INSERT INTO world_commits(
          run_id,origin_kind,origin_id,commit_index,world_revision,last_seq,snapshot_json,snapshot_hash,created_at
        ) VALUES(?, 'directorSnapshot', 'fixture-director-commit', ?, ?, ?, ?, ?, ?)
      `).run(runId, 4, nonActorSnapshot.revision, nonActorSnapshot.seq, nonActorJson, nonActorHash, Date.now());
      database.prepare(`
        UPDATE world_runs SET world_revision=?,last_seq=?,commit_index=?,snapshot_json=?,snapshot_hash=?,updated_at=?
        WHERE run_id=?
      `).run(nonActorSnapshot.revision, nonActorSnapshot.seq, 4, nonActorJson, nonActorHash, Date.now(), runId);
    } finally { database.close(); }

    const pulseId = PulseIdSchema.parse(uuid(7_900));
    const jobId = JobIdSchema.parse(uuid(7_901));
    journal.configureRun({ runId, maxCalls: 2 });
    journal.configurePulse({ runId, pulseId, maxCalls: 1 });
    const session = journal.registerActorPiSession({
      runId, actorId: agentId, sessionId: 'pi-v5-migration-cut',
      sessionPath: join(directory, 'actor-session.jsonl'), preparedContextHash: 'a'.repeat(64),
      profile: { provider: 'openai-codex', model: 'gpt-6-luna', reasoning: 'xhigh' },
    }).session;
    const scope = { runId, pulseId, jobId, generation: 0 };
    assert.deepEqual(journal.reserveNextRequest(scope), { kind: 'reserved', requestSeq: 0 });
    assert.equal(journal.recordActorPiCandidate({
      kind: 'request-input', candidateId: uuid(7_902), turnId: uuid(7_903), runId, actorId: agentId,
      scope, base: session, requestSeq: 0, candidateLeafId: 'leaf-v5-migration',
      inputCut: {
        worldRevision: nonActorSnapshot.revision, worldSeq: nonActorSnapshot.seq,
        fictionalAt: nonActorSnapshot.clock.instant, perceptionIds: [],
      },
    }), 'stored', 'snapshotAndCommitAtCut resuelve un corte cuyo origen sólo existe en world_commits');
  } finally {
    try { journal.close(); } catch { /* Puede haberse cerrado antes de reabrir. */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('los cortes históricos por worldSeq no mezclan revisiones subjetivas posteriores del mismo pulso', () => {
  withJournal((journal) => {
    registerRun(journal);

    registerAttempt(journal, proposalId, 1, waitAttempt(730, maxId, 0));
    const waited = journal.commitWorldAttempt({ runId, proposalId, version: 1, ids: idSource(1_000) });
    assert.equal(waited.resolution.kind, 'applied');
    assert.equal(waited.resolution.newSnapshot.seq, 1);
    assert.equal(waited.resolution.newSnapshot.revision, 1);

    registerAttempt(journal, secondProposalId, 1, {
      kind: 'reviseGoal', attemptId: uuid(731), runId, actorId: maxId, expectedRevision: 1,
      goalId: maxGoalId, change: { kind: 'reprioritize', priority: 0.3 }, evidenceExperienceIds: [maxExperienceId],
    });
    const reprioritized = journal.commitWorldAttempt({ runId, proposalId: secondProposalId, version: 1, ids: idSource(1_100) });
    assert.equal(reprioritized.resolution.newSnapshot.seq, 1);
    assert.equal(reprioritized.resolution.newSnapshot.revision, 2);

    registerAttempt(journal, thirdProposalId, 1, {
      kind: 'reviseGoal', attemptId: uuid(732), runId, actorId: maxId, expectedRevision: 2,
      goalId: maxGoalId, change: { kind: 'complete' }, evidenceExperienceIds: [maxExperienceId],
    });
    const completed = journal.commitWorldAttempt({ runId, proposalId: thirdProposalId, version: 1, ids: idSource(1_200) });
    assert.equal(completed.resolution.newSnapshot.seq, 1);
    assert.equal(completed.resolution.newSnapshot.revision, 3);

    const historical = journal.loadWorld({ runId, throughWorldSeq: 1 });
    assert.equal(historical?.revision, 1);
    if (historical === undefined) assert.fail('Falta el snapshot histórico del primer commit en worldSeq 1');
    const historicalMax = historical.entities.find((entity) => entity.kind === 'character' && entity.characterId === maxId);
    assert.equal(historicalMax?.kind === 'character' ? historicalMax.mind.goals[0]?.state : undefined, 'active');
    assert.equal(historicalMax?.kind === 'character' ? historicalMax.mind.goals[0]?.priority : undefined, 0.8);

    const continuity = { continuityId: 'continuity-main', revision: 0, contentHash: HashSchema.parse('b'.repeat(64)) };
    assert.equal(journal.loadActorWorldCut({
      actorId: maxId, identityVersion: 1, runId, continuity,
      expectedWorldRevision: 1, atWorldSeq: 1, fictionalAt: 100,
    }), undefined, 'no se permite proyectar el snapshot histórico con conocimiento/memoria actuales');
    const currentCut = journal.loadActorWorldCut({
      actorId: maxId, identityVersion: 1, runId, continuity,
      expectedWorldRevision: 3, atWorldSeq: 1, fictionalAt: 100,
    });
    assert.equal(currentCut?.kind, 'actor-world-host-cut');
    if (currentCut?.kind === 'actor-world-host-cut') {
      const currentMax = currentCut.snapshot.entities.find((entity) => entity.kind === 'character' && entity.characterId === maxId);
      assert.equal(currentMax?.kind === 'character' ? currentMax.mind.goals[0]?.state : undefined, 'completed');
      assert.equal(currentMax?.kind === 'character' ? currentMax.mind.goals[0]?.priority : undefined, 0.3);
    }
    assert.deepEqual(journal.compareAndSwapActorKnowledge({
      kind: 'actor-knowledge-cas', actorId: maxId, runId, expectedWorldRevision: 1, expectedWorldSeq: 1,
      expectedContinuity: continuity, expectedKnowledgeRevision: 1,
      knowledge: ActorKnowledgeSchema.parse({ runId, actorId: maxId, bindings: [] }),
    }), { kind: 'conflict' }, 'una proyección contra una revisión anterior no puede escribir conocimiento');
  });
});

test('commit aplica evento y percepciones atómicamente, deduplica tras reopen y sólo ack crea outbox', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-world-delivery-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  try {
    registerRun(journal);
    const communication = communicateAttempt(730, 0);
    registerAttempt(journal, proposalId, 1, communication);
    journal.recordContinuistaReview(reviewFor({ proposal: proposalId, version: 1, stateRevision: 0, text: '¿Me escuchás?' }));
    const result = commitWorldAttempt({ journal, request: { runId, proposalId, version: 1, ids: idSource(1_000) } });
    assert.equal(result.kind, 'committed');
    assert.equal(result.resolution.kind, 'applied');
    assert.equal(journal.readWorldEvents({ runId }).length, 1);
    assert.equal(journal.readDeliveredWorldPerceptions({ runId, actorId: agentId, throughWorldSeq: 1 }).length, 0);
    const beforeOutbox = new DatabaseSync(path);
    try { assert.equal(beforeOutbox.prepare('SELECT COUNT(*) AS n FROM memory_outbox').get()?.n, 0); }
    finally { beforeOutbox.close(); }

    const claim = journal.claimWorldDelivery({ runId, actorId: agentId, throughWorldSeq: 1,
      ownerToken: uuid(740), claimToken: uuid(741) });
    assert.equal(claim.kind, 'claimed');
    if (claim.kind !== 'claimed') return;
    assert.deepEqual(journal.claimWorldDelivery({ runId, actorId: agentId, throughWorldSeq: 1,
      ownerToken: uuid(743), claimToken: uuid(744) }), { kind: 'busy' },
    'un worker distinto no puede robar una entrega en curso');
    assert.equal(journal.failWorldDelivery({ perceptionId: claim.perception.id, claimToken: claim.claimToken, failureCode: 'delivery_failed' }), 'failed');
    assert.equal(journal.readDeliveredWorldPerceptions({ runId, actorId: agentId, throughWorldSeq: 1 }).length, 0);
    const retry = journal.claimWorldDelivery({ runId, actorId: agentId, throughWorldSeq: 1,
      ownerToken: uuid(740), claimToken: uuid(742) });
    assert.equal(retry.kind, 'claimed');
    if (retry.kind !== 'claimed') return;
    assert.equal(retry.perception.kind, 'communication');
    if (retry.perception.kind !== 'communication') return;
    const perceivedContent = retry.perception.content.kind === 'speech'
      ? retry.perception.content.text : `Gesto ${retry.perception.content.gesture.kind}`;
    const experience = freezeExperience({
      schemaVersion: 1, experienceId: ExperienceIdSchema.parse(uuid(750)), runId, actorId: agentId,
      kind: 'perception', perceptionId: retry.perception.id, eventId: retry.perception.eventId,
      content: perceivedContent, sourceRefs: [], fictitiousAt: retry.perception.fictitiousAt,
      receivedAt: retry.perception.fictitiousAt, worldSeq: 1, confidence: 1, revision: 0,
      predecessor: { kind: 'initial' },
    });
    assert.equal(journal.completeWorldDelivery({ perceptionId: retry.perception.id, claimToken: retry.claimToken, experience }), 'delivered');
    assert.equal(journal.readDeliveredWorldPerceptions({ runId, actorId: agentId, throughWorldSeq: 1 }).length, 1);
    const recipientCut = journal.loadActorWorldCut({
      actorId: agentId, identityVersion: 1, runId,
      continuity: { continuityId: 'continuity-main', revision: 0, contentHash: HashSchema.parse('b'.repeat(64)) },
      expectedWorldRevision: 1,
      atWorldSeq: 1, fictionalAt: 200,
    });
    assert.equal(recipientCut?.kind, 'actor-world-host-cut');
    if (recipientCut?.kind === 'actor-world-host-cut') assert.equal(recipientCut.pendingPerceptions.length, 1);
    const afterAck = new DatabaseSync(path);
    try { assert.equal(afterAck.prepare('SELECT COUNT(*) AS n FROM memory_outbox').get()?.n, 1); }
    finally { afterAck.close(); }

    registerAttempt(journal, secondProposalId, 1, waitAttempt(731, agentId, 1));
    const next = journal.commitWorldAttempt({ runId, proposalId: secondProposalId, version: 1, ids: idSource(1_900) });
    assert.equal(next.resolution.kind, 'applied');
    assert.deepEqual(journal.readWorldEvents({ runId }).map((event) => event.seq), [1, 2]);
    assert.equal(journal.loadWorld({ runId, throughWorldSeq: 1 })?.revision, 1);
    assert.equal(journal.loadWorld({ runId, throughWorldSeq: 2 })?.revision, 2);

    journal.close();
    journal = openJournal({ path });
    const duplicate = journal.commitWorldAttempt({ runId, proposalId, version: 1, ids: idSource(1_100) });
    assert.equal(duplicate.kind, 'existing');
    assert.equal(duplicate.resolution.kind, 'applied');
    assert.equal(journal.readWorldEvents({ runId }).length, 2);
  } finally {
    try { journal.close(); } catch { /* Closed before reopen. */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Continuista sólo habilita la propuesta exacta y speech no se publica sin receipt', () => {
  withJournal((journal) => {
    registerRun(journal);
    const unreviewed = communicateAttempt(760, 0);
    registerAttempt(journal, proposalId, 1, unreviewed);
    assert.equal(journal.resolveApprovalReceipt({ runId, proposalId, version: 1 }), undefined);
    const refused = journal.commitWorldAttempt({ runId, proposalId, version: 1, ids: idSource(1_200) });
    assert.equal(refused.resolution.kind, 'notApplied');
    if (refused.resolution.kind === 'notApplied') assert.equal(refused.resolution.reason, 'approval-receipt-invalid');
    assert.equal(journal.readWorldEvents({ runId }).length, 0);

    const approved = communicateAttempt(761, 0);
    registerAttempt(journal, secondProposalId, 1, approved);
    const incomplete = reviewFor({ proposal: secondProposalId, version: 1, stateRevision: 0,
      text: '¿Me escuchás?', criteria: ['knowledge'], complete: true });
    assert.throws(() => journal.recordContinuistaReview({
      ...incomplete, exactContentHash: HashSchema.parse('c'.repeat(64)),
    }), /Review no coincide/);
    journal.recordContinuistaReview(incomplete);
    assert.equal(journal.resolveApprovalReceipt({ runId, proposalId: secondProposalId, version: 1 }), undefined);
    const complete = reviewFor({ proposal: secondProposalId, version: 1, stateRevision: 0, text: '¿Me escuchás?' });
    journal.recordContinuistaReview(complete);
    const receipt = journal.resolveApprovalReceipt({ runId, proposalId: secondProposalId, version: 1 });
    assert.equal(receipt?.proposalId, secondProposalId);
    const result = journal.commitWorldAttempt({ runId, proposalId: secondProposalId, version: 1, ids: idSource(1_300) });
    assert.equal(result.resolution.kind, 'applied');
    assert.equal(journal.readWorldEvents({ runId }).length, 1);
  });
});

test('una reformulación no cambia la revisión base después de que otra propuesta avanzó el Escenario', () => {
  withJournal((journal) => {
    registerRun(journal);
    registerAttempt(journal, proposalId, 1, communicateAttempt(780, 0));
    journal.recordContinuistaReview(reviewFor({
      proposal: proposalId, version: 1, stateRevision: 0, text: '¿Me escuchás?', verdict: 'reformulate',
    }));

    registerAttempt(journal, secondProposalId, 1, waitAttempt(781, agentId, 0));
    const competing = journal.commitWorldAttempt({ runId, proposalId: secondProposalId, version: 1, ids: idSource(1_400) });
    assert.equal(competing.resolution.newSnapshot.revision, 1);

    const reformulation = communicateAttempt(782, 1);
    reformulation.content.text = '¿Podés escucharme?';
    assert.throws(() => journal.registerWorldProposal({
      runId, proposalId, version: 2, jobId: JobIdSchema.parse(proposalId), generation: 0, proposalSlot: 1,
      attempt: reformulation,
    }), /misma revisión base/);
  });
});

test('reformulación usa slots durables, no habilita una versión con revisión incompleta y conserva el mismo payload al reintentar', () => {
  withJournal((journal) => {
    registerRun(journal);
    const firstAttempt = communicateAttempt(790, 0);
    registerAttempt(journal, proposalId, 1, firstAttempt);
    assert.equal(journal.registerWorldProposal({
      runId, proposalId, version: 1, jobId: JobIdSchema.parse(proposalId), generation: 0, proposalSlot: 0,
      attempt: firstAttempt,
    }), 'existing');

    journal.recordContinuistaReview(reviewFor({
      proposal: proposalId, version: 1, stateRevision: 0, text: '¿Me escuchás?',
      verdict: 'reformulate', criteria: ['voice'],
    }));
    const secondAttempt = communicateAttempt(791, 0);
    secondAttempt.content.text = 'Max está hablando más despacio.';
    const registration = {
      runId, proposalId, version: 2, jobId: JobIdSchema.parse(proposalId), generation: 0, proposalSlot: 1,
      attempt: secondAttempt,
    };
    assert.throws(() => journal.registerWorldProposal(registration), /misma revisión base/);

    journal.recordContinuistaReview(reviewFor({
      proposal: proposalId, version: 1, stateRevision: 0, text: '¿Me escuchás?', verdict: 'reformulate',
    }));
    assert.equal(journal.registerWorldProposal(registration), 'stored');
    assert.equal(journal.registerWorldProposal(registration), 'existing');
    assert.throws(() => journal.registerWorldProposal({
      ...registration, attempt: { ...secondAttempt, content: { kind: 'speech', text: 'otro texto' } },
    }), /otro payload o scope/);
    assert.throws(() => journal.registerWorldProposal({
      ...registration, version: 3, proposalSlot: 2,
      attempt: communicateAttempt(792, 0),
    }), /revisión previa/);
  });
});

test('la resolución stale se persiste y deduplica antes del CAS', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-world-stale-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  try {
    registerRun(journal);
    registerAttempt(journal, proposalId, 1, waitAttempt(770, maxId, 0));
    registerAttempt(journal, secondProposalId, 1, waitAttempt(771, agentId, 0));
    assert.equal(journal.commitWorldAttempt({ runId, proposalId, version: 1, ids: idSource(1_400) }).resolution.kind, 'applied');
    const stale = journal.commitWorldAttempt({ runId, proposalId: secondProposalId, version: 1, ids: idSource(1_500) });
    assert.equal(stale.resolution.kind, 'stale');
    assert.equal(stale.resolution.events.length, 0);
    journal.close();
    journal = openJournal({ path });
    const duplicate = journal.commitWorldAttempt({ runId, proposalId: secondProposalId, version: 1, ids: idSource(1_600) });
    assert.equal(duplicate.kind, 'existing');
    assert.equal(duplicate.resolution.kind, 'stale');
    assert.equal(journal.readWorldEvents({ runId }).length, 1);
  } finally {
    try { journal.close(); } catch { /* Closed before reopen. */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fallo SQL revierte snapshot, resolución, evento, percepción y delivery juntos', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-world-rollback-'));
  const path = join(directory, 'world.sqlite');
  const journal = openJournal({ path });
  const database = new DatabaseSync(path);
  try {
    registerRun(journal);
    registerAttempt(journal, proposalId, 1, communicateAttempt(780, 0));
    journal.recordContinuistaReview(reviewFor({ proposal: proposalId, version: 1, stateRevision: 0, text: '¿Me escuchás?' }));
    database.exec(`CREATE TRIGGER reject_delivery BEFORE INSERT ON world_deliveries BEGIN SELECT RAISE(ABORT, 'injected'); END`);
    assert.throws(() => journal.commitWorldAttempt({ runId, proposalId, version: 1, ids: idSource(1_700) }), /injected/);
    assert.equal(journal.loadWorld({ runId })?.revision, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM world_resolutions').get()?.n, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM world_events').get()?.n, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM world_perceptions').get()?.n, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM world_deliveries').get()?.n, 0);
    database.exec('DROP TRIGGER reject_delivery');
    assert.equal(journal.commitWorldAttempt({ runId, proposalId, version: 1, ids: idSource(1_800) }).resolution.kind, 'applied');
  } finally {
    database.close();
    journal.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function setupActorPiLedger() {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-actor-pi-ledger-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  registerRun(journal);
  const piJobId = JobIdSchema.parse(uuid(8_100));
  const piPulseId = PulseIdSchema.parse(uuid(8_101));
  journal.configureRun({ runId, maxCalls: 10 });
  journal.configurePulse({ runId, pulseId: piPulseId, maxCalls: 5 });

  registerAttempt(journal, proposalId, 1, communicateAttempt(8_102, 0));
  journal.recordContinuistaReview(reviewFor({ proposal: proposalId, version: 1, stateRevision: 0, text: '¿Me escuchás?' }));
  assert.equal(commitWorldAttempt({ journal, request: { runId, proposalId, version: 1, ids: idSource(8_200) } }).resolution.kind, 'applied');
  const claim = journal.claimWorldDelivery({
    runId, actorId: agentId, throughWorldSeq: 1, ownerToken: uuid(8_300), claimToken: uuid(8_301),
  });
  assert.equal(claim.kind, 'claimed');
  if (claim.kind !== 'claimed') throw new Error('La percepción de prueba no se pudo reclamar');
  const perception = claim.perception;
  const experience = freezeExperience({
    schemaVersion: 1, experienceId: ExperienceIdSchema.parse(uuid(8_302)), runId, actorId: agentId,
    kind: 'perception', perceptionId: perception.id,
    eventId: 'eventId' in perception ? perception.eventId : undefined,
    content: perception.kind === 'communication' && perception.content.kind === 'speech'
      ? perception.content.text
      : 'Percepción de prueba.',
    sourceRefs: [], fictitiousAt: perception.fictitiousAt, receivedAt: perception.fictitiousAt,
    worldSeq: 1, confidence: 1, revision: 0, predecessor: { kind: 'initial' },
  });
  assert.equal(journal.completeWorldDelivery({ perceptionId: perception.id, claimToken: claim.claimToken, experience }), 'delivered');

  const registration = journal.registerActorPiSession({
    runId, actorId: agentId, sessionId: 'pi-session-agent-99', sessionPath: join(directory, 'actor-session.jsonl'),
    preparedContextHash: 'a'.repeat(64),
    profile: { provider: 'openai-codex', model: 'gpt-6-luna', reasoning: 'xhigh' },
  });
  const scope = { runId, pulseId: piPulseId, jobId: piJobId, generation: 0 };
  assert.deepEqual(journal.reserveNextRequest(scope), { kind: 'reserved', requestSeq: 0 });
  const snapshot = journal.loadWorld({ runId });
  if (snapshot === undefined) throw new Error('Falta el snapshot actual de prueba');
  const delivered = journal.readDeliveredWorldPerceptions({ runId, actorId: agentId, throughWorldSeq: snapshot.seq });
  const perceptionId = delivered[0]?.id;
  if (perceptionId === undefined) throw new Error('Falta percepción entregada de prueba');
  return {
    directory, path, journal, registration, scope, snapshot, perceptionId,
    inputCut: {
      worldRevision: snapshot.revision, worldSeq: snapshot.seq,
      fictionalAt: snapshot.clock.instant, perceptionIds: [perceptionId],
    },
    requestCandidate() {
      return {
        kind: 'request-input', candidateId: uuid(8_400), turnId: uuid(8_401), runId, actorId: agentId,
        scope, base: registration.session, requestSeq: 0, candidateLeafId: 'leaf-input',
        inputCut: {
          worldRevision: snapshot.revision, worldSeq: snapshot.seq,
          fictionalAt: snapshot.clock.instant, perceptionIds: [perceptionId],
        },
      };
    },
    terminalCandidate() {
      return {
        kind: 'terminal-candidate', candidateId: uuid(8_402), turnId: uuid(8_401), runId, actorId: agentId,
        scope, base: registration.session, outcome: 'completed', lastRequestSeq: 0,
        candidateLeafId: 'leaf-terminal',
        inputCut: {
          worldRevision: snapshot.revision, worldSeq: snapshot.seq,
          fictionalAt: snapshot.clock.instant, perceptionIds: [perceptionId],
        },
      };
    },
  };
}

test('ledger Pi consume inbox y avanza leaf sólo en aceptación atómica, con retry durable tras reopen', () => {
  const fixture = setupActorPiLedger();
  const acceptance = { candidateId: uuid(8_402), proposal: { kind: 'none' } };
  try {
    assert.equal(fixture.journal.recordActorPiCandidate(fixture.requestCandidate()), 'stored');
    fixture.journal.transitionReservation({
      jobId: fixture.scope.jobId, generation: 0, requestSeq: 0, target: 'dispatched',
    });
    fixture.journal.transitionReservation({
      jobId: fixture.scope.jobId, generation: 0, requestSeq: 0, target: 'completed',
    });
    assert.equal(fixture.journal.recordActorPiCandidate(fixture.terminalCandidate()), 'stored');
    assert.throws(() => fixture.journal.recordActorPiCandidate({
      ...fixture.requestCandidate(), candidateId: uuid(8_403), requestSeq: 1,
    }), /después del candidato terminal/);
    fixture.journal.close();
    fixture.journal = openJournal({ path: fixture.path });

    const beforeCommit = fixture.journal.loadActorPiSession({ runId, actorId: agentId });
    assert.equal(beforeCommit?.sessionRevision, 0);
    assert.equal(beforeCommit?.committedLeafId, null);
    const beforeCut = fixture.journal.loadActorWorldCut({
      actorId: agentId, identityVersion: 1, runId,
      continuity: { continuityId: 'continuity-main', revision: 0, contentHash: HashSchema.parse('b'.repeat(64)) },
      expectedWorldRevision: fixture.snapshot.revision, atWorldSeq: fixture.snapshot.seq,
      fictionalAt: fixture.snapshot.clock.instant,
    });
    assert.equal(beforeCut?.kind, 'actor-world-host-cut');
    if (beforeCut?.kind === 'actor-world-host-cut') assert.deepEqual(beforeCut.pendingPerceptionIds, [fixture.perceptionId]);

    const fault = new DatabaseSync(fixture.path);
    try {
      fault.exec(`CREATE TRIGGER fail_pi_receipt BEFORE INSERT ON actor_pi_turn_receipts
        BEGIN SELECT RAISE(ABORT, 'crash-before-commit'); END`);
      assert.throws(() => fixture.journal.acceptActorTurn(acceptance), /crash-before-commit/);
      assert.equal(fixture.journal.loadActorPiSession({ runId, actorId: agentId })?.sessionRevision, 0);
      const unconsumed = fixture.journal.loadActorWorldCut({
        actorId: agentId, identityVersion: 1, runId,
        continuity: { continuityId: 'continuity-main', revision: 0, contentHash: HashSchema.parse('b'.repeat(64)) },
        expectedWorldRevision: fixture.snapshot.revision, atWorldSeq: fixture.snapshot.seq,
        fictionalAt: fixture.snapshot.clock.instant,
      });
      if (unconsumed?.kind === 'actor-world-host-cut') assert.deepEqual(unconsumed.pendingPerceptionIds, [fixture.perceptionId]);
      fault.exec('DROP TRIGGER fail_pi_receipt');
    } finally { fault.close(); }

    const accepted = fixture.journal.acceptActorTurn(acceptance);
    assert.equal(accepted.committedLeafId, 'leaf-terminal');
    assert.deepEqual(accepted.consumedPerceptionIds, [fixture.perceptionId]);
    assert.equal(fixture.journal.loadActorPiSession({ runId, actorId: agentId })?.sessionRevision, 1);
    fixture.journal.close();
    fixture.journal = openJournal({ path: fixture.path });
    assert.deepEqual(fixture.journal.acceptActorTurn(acceptance), accepted);
    assert.throws(() => fixture.journal.acceptActorTurn({
      ...acceptance, proposal: { kind: 'durable', proposalId: uuid(8_500), version: 1, attemptHash: 'c'.repeat(64) },
    }), /otro payload/);
    const afterCommit = fixture.journal.loadActorWorldCut({
      actorId: agentId, identityVersion: 1, runId,
      continuity: { continuityId: 'continuity-main', revision: 0, contentHash: HashSchema.parse('b'.repeat(64)) },
      expectedWorldRevision: fixture.snapshot.revision, atWorldSeq: fixture.snapshot.seq,
      fictionalAt: fixture.snapshot.clock.instant,
    });
    if (afterCommit?.kind === 'actor-world-host-cut') assert.deepEqual(afterCommit.pendingPerceptionIds, []);
    assert.throws(() => fixture.journal.rotateUnacceptedActorPiSession({
      runId, actorId: agentId, expected: fixture.registration.session,
      sessionId: 'pi-session-after-accept', sessionPath: join(fixture.directory, 'after-accept.jsonl'),
    }), /leaf aceptado/);
  } finally {
    try { fixture.journal.close(); } catch { /* Already closed before reopen. */ }
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('ledger Pi rota por CAS una sesión inicial truncada después de reopen, sin adoptar su tail', () => {
  const fixture = setupActorPiLedger();
  const replacement = {
    sessionId: 'pi-session-recovered-initial',
    sessionPath: join(fixture.directory, 'actor-session-recovered.jsonl'),
  };
  try {
    fixture.journal.close();
    fixture.journal = openJournal({ path: fixture.path });
    const rotated = fixture.journal.rotateUnacceptedActorPiSession({
      runId, actorId: agentId, expected: fixture.registration.session, ...replacement,
    });
    assert.equal(rotated.kind, 'rotated');
    assert.equal(rotated.session.sessionRevision, 0);
    assert.equal(rotated.session.committedLeafId, null);
    assert.equal(rotated.session.sessionId, replacement.sessionId);
    assert.equal(rotated.session.sessionPath, replacement.sessionPath);

    fixture.journal.close();
    fixture.journal = openJournal({ path: fixture.path });
    const retried = fixture.journal.rotateUnacceptedActorPiSession({
      runId, actorId: agentId, expected: fixture.registration.session, ...replacement,
    });
    assert.equal(retried.kind, 'existing');
    assert.deepEqual(retried.session, rotated.session);
    assert.throws(() => fixture.journal.rotateUnacceptedActorPiSession({
      runId, actorId: agentId, expected: fixture.registration.session,
      sessionId: 'pi-session-racing-recovery', sessionPath: join(fixture.directory, 'racing-session.jsonl'),
    }), /cambió antes de aplicar/);
    assert.deepEqual(fixture.journal.loadActorPiSession({ runId, actorId: agentId }), rotated.session);
  } finally {
    try { fixture.journal.close(); } catch { /* Already closed before reopen. */ }
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('ledger Pi rechaza percepciones ajenas, cortes futuros y IDs repetidos antes de aceptar', () => {
  const fixture = setupActorPiLedger();
  try {
    const foreignSession = fixture.journal.registerActorPiSession({
      runId, actorId: maxId, sessionId: 'pi-session-max', sessionPath: join(fixture.directory, 'max-session.jsonl'),
      preparedContextHash: 'a'.repeat(64),
      profile: { provider: 'openai-codex', model: 'gpt-6-luna', reasoning: 'xhigh' },
    });
    assert.equal(foreignSession.kind, 'stored');
    const foreignCut = {
      ...fixture.requestCandidate(), actorId: maxId, base: foreignSession.session,
      inputCut: { ...fixture.inputCut, perceptionIds: [fixture.perceptionId] },
    };
    assert.throws(() => fixture.journal.recordActorPiCandidate(foreignCut), /no coincide con las percepciones entregadas/);

    const futureCut = {
      ...fixture.requestCandidate(), candidateId: uuid(8_410),
      inputCut: { ...fixture.inputCut, worldSeq: fixture.snapshot.seq + 1 },
    };
    assert.throws(() => fixture.journal.recordActorPiCandidate(futureCut), /corte World histórico exacto/);

    const repeatedCut = {
      ...fixture.requestCandidate(), candidateId: uuid(8_420),
      inputCut: { ...fixture.inputCut, perceptionIds: [fixture.perceptionId, fixture.perceptionId] },
    };
    assert.throws(() => fixture.journal.recordActorPiCandidate(repeatedCut), /no puede repetir percepciones/);

    for (const [index, outcome] of ['aborted', 'failed'].entries()) {
      const candidate = {
        ...fixture.terminalCandidate(), candidateId: uuid(8_430 + index), outcome,
        turnId: uuid(8_440 + index), lastRequestSeq: null,
      };
      assert.equal(fixture.journal.recordActorPiCandidate(candidate), 'stored');
      assert.throws(() => fixture.journal.acceptActorTurn({ candidateId: candidate.candidateId, proposal: { kind: 'none' } }),
        /Sólo un candidato terminal completado/);
    }
    assert.equal(fixture.journal.loadActorPiSession({ runId, actorId: agentId })?.sessionRevision, 0);
  } finally {
    fixture.journal.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});


test('bloqueo durable libera asignaciones sin consumo y retry explícito conserva pulso y cuota', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-blocked-job-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  try {
    const { perceptions } = await createQueuedHumanIntentFixture(journal, ['Pregunta pendiente.']);
    const pulseId = PulseIdSchema.parse(uuid(19_500));
    journal.configureRun({ runId, maxCalls: 5 });
    journal.configurePulse({ runId, pulseId, maxCalls: 1 });
    const scheduled = journal.scheduleActorTurnJob({ runId, actorId: maxId, pulseId });
    if (scheduled.kind !== 'scheduled') assert.fail('Job no programado');
    journal.close();
    const legacy = new DatabaseSync(path);
    try {
      legacy.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
        CREATE TABLE actor_jobs_v12(
          run_id TEXT NOT NULL REFERENCES world_runs(run_id),actor_id TEXT NOT NULL,job_id TEXT NOT NULL,
          generation INTEGER NOT NULL CHECK(generation>=0),pulse_id TEXT NOT NULL REFERENCES pulses(pulse_id),
          state TEXT NOT NULL CHECK(state IN('queued','running','accepted')),owner_token TEXT,claim_token TEXT,
          created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,frozen_perception_ids_json TEXT,frozen_world_cut_json TEXT,
          PRIMARY KEY(run_id,actor_id,job_id,generation),UNIQUE(job_id,generation));
        INSERT INTO actor_jobs_v12 SELECT run_id,actor_id,job_id,generation,pulse_id,state,owner_token,claim_token,
          created_at,updated_at,frozen_perception_ids_json,frozen_world_cut_json FROM actor_turn_jobs;
        DROP TABLE actor_turn_jobs; ALTER TABLE actor_jobs_v12 RENAME TO actor_turn_jobs;
        CREATE TABLE actor_inputs_v12(
          run_id TEXT NOT NULL,actor_id TEXT NOT NULL,job_id TEXT NOT NULL,generation INTEGER NOT NULL,
          perception_id TEXT NOT NULL UNIQUE REFERENCES actor_turn_intents(perception_id),
          state TEXT NOT NULL CHECK(state IN('assigned','consumed')),assigned_at INTEGER NOT NULL,consumed_at INTEGER,
          PRIMARY KEY(run_id,actor_id,job_id,generation,perception_id),
          FOREIGN KEY(run_id,actor_id,job_id,generation) REFERENCES actor_turn_jobs(run_id,actor_id,job_id,generation));
        INSERT INTO actor_inputs_v12 SELECT * FROM actor_turn_job_inputs;
        DROP TABLE actor_turn_job_inputs; ALTER TABLE actor_inputs_v12 RENAME TO actor_turn_job_inputs;
        DROP TABLE IF EXISTS model_time_spans; DROP TABLE IF EXISTS model_time_run_state; DROP TABLE IF EXISTS run_preflight_job_operations; DROP TABLE IF EXISTS run_preflight_job_results; DROP TABLE IF EXISTS run_preflight_job_history; DROP TABLE IF EXISTS run_preflight_jobs; DROP TABLE IF EXISTS pi_access_job_operations; DROP TABLE IF EXISTS pi_access_job_results; DROP TABLE IF EXISTS pi_access_job_history; DROP TABLE IF EXISTS pi_access_jobs; DROP TABLE IF EXISTS pi_oauth_job_operations; DROP TABLE IF EXISTS pi_oauth_job_history; DROP TABLE IF EXISTS pi_oauth_jobs; DELETE FROM schema_version WHERE version IN(13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28); COMMIT;`);
    } finally { legacy.close(); }
    journal = openJournal({ path });
    assert.deepEqual(journal.scheduleActorTurnJob({ runId, actorId: maxId, pulseId }).kind, 'blocked', 'un job legado sin época demostrable se bloquea');

    const lease = { ownerToken: uuid(19_501), claimToken: uuid(19_502) };
    const firstRetry = journal.retryActorTurnJob({runId,actorId:maxId,jobId:scheduled.job.jobId,expectedGeneration:0,pulseId});
    assert.equal(firstRetry.kind,'retried');
    const scope = { runId, actorId: maxId, pulseId, jobId: scheduled.job.jobId, generation: firstRetry.job.generation };
    assert.equal(journal.claimActorTurnJob({ runId, actorId: maxId, jobId: scope.jobId, generation: scope.generation, ...lease }).kind, 'claimed');
    const execution = { ...scope, lease };
    assert.deepEqual(journal.reserveNextRequest({ runId, pulseId, jobId: scope.jobId, generation: scope.generation }), { kind: 'reserved', requestSeq: 0 });
    journal.transitionReservation({ jobId: scope.jobId, generation: scope.generation, requestSeq: 0, target: 'dispatched' });
    assert.throws(() => journal.failActorTurnJob({ execution: { ...execution, lease: { ...lease, claimToken: uuid(19_503) } }, code: 'pi-incomplete' }), /Lease/);
    const failed = journal.failActorTurnJob({ execution, code: 'pi-incomplete' });
    assert.equal(failed.job.state, 'blocked');
    assert.equal(failed.job.failureCode, 'pi-incomplete');
    assert.equal(journal.failActorTurnJob({ execution, code: 'pi-incomplete' }).kind, 'existing');
    assert.throws(() => journal.failActorTurnJob({ execution, code: 'review-rejected' }), /Diagnóstico/);
    const before = journal.loadWorld({ runId });
    journal.close(); journal = openJournal({ path });
    assert.equal(journal.recoverAbandonedActorTurnJobClaims({ ownerToken: uuid(19_504) }), 0);
    assert.equal(journal.scheduleActorTurnJob({ runId, actorId: maxId, pulseId }).kind, 'blocked');
    assert.deepEqual(journal.readQueuedActorTurnIntents({ runId, actorId: maxId }).map((item) => item.perceptionId), perceptions);
    assert.deepEqual(journal.loadWorld({ runId }), before);
    const snapshot = journal.loadWorld({ runId });
    if (snapshot === undefined) assert.fail('Escenario ausente');
    const late = journal.commitHumanIntervention({ runId, participantId: 'interlocutor-andres', expectedRevision: snapshot.revision,
      idempotencyKey: uuid(19_507), request: { kind: 'speech', recipientCharacterIds: [maxId], channelId,
        content: { kind: 'speech', text: 'Segunda pregunta durante el bloqueo.' } } });
    if (late.kind !== 'stored' || late.resolution.kind !== 'applied') assert.fail('Intervención no aplicada');
    await createDeliverWorldWorker({ journal, runId, actorId: maxId }).drain();
    const pending = journal.readQueuedActorTurnIntents({ runId, actorId: maxId }).map((item) => item.perceptionId);
    assert.equal(pending.length, 2);
    assert.equal(journal.scheduleActorTurnJob({ runId, actorId: maxId, pulseId }).kind, 'blocked');
    const retry = journal.retryActorTurnJob({ runId, actorId: maxId, jobId: scope.jobId, expectedGeneration: 1, pulseId });
    assert.equal(retry.kind, 'retried');
    assert.equal(retry.job.generation, 2);
    assert.equal(retry.job.pulseId, pulseId);
    assert.equal(retry.job.frozenWorldCut, null);
    assert.deepEqual(retry.job.perceptionIds, pending);
    assert.equal(journal.retryActorTurnJob({ runId, actorId: maxId, jobId: scope.jobId, expectedGeneration: 1, pulseId }).kind, 'existing');
    const inspect = new DatabaseSync(path);
    try {
      assert.deepEqual(inspect.prepare('SELECT generation,state,consumed_at FROM actor_turn_job_inputs WHERE perception_id=? ORDER BY generation').all(perceptions[0] ?? '').map((row) => ({ ...row })), [
        { generation: 0, state: 'released', consumed_at: null }, { generation: 1, state: 'released', consumed_at: null }, { generation: 2, state: 'assigned', consumed_at: null },
      ]);
      assert.equal(inspect.prepare('SELECT consumed FROM pulses WHERE pulse_id=?').get(pulseId)?.consumed, 1);
      assert.equal(inspect.prepare('SELECT state FROM request_reservations WHERE job_id=? AND generation=1').get(scope.jobId)?.state, 'dispatched');
      assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { inspect.close(); }
    const nextClaim = journal.claimActorTurnJob({ runId, actorId: maxId, jobId: scope.jobId, generation: 2, ownerToken: uuid(19_505), claimToken: uuid(19_506) });
    assert.equal(nextClaim.kind, 'claimed');
    assert.equal(journal.reserveNextRequest({ runId, pulseId, jobId: scope.jobId, generation: 2 }).kind, 'exhausted');
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});


test('diagnóstico público Continuista valida fallos y conserva reviews legacy sin inventarlos', () => {
  withJournal((journal, path) => {
    registerRun(journal);
    registerAttempt(journal, proposalId, 1, communicateAttempt(28_000, 0));
    const review = reviewFor({ proposal: proposalId, version: 1, stateRevision: 0,
      text: '¿Me escuchás?', verdict: 'reformulate', failedCriteria: ['knowledge', 'voice'] });
    assert.equal(ContinuistaReviewInputSchema.safeParse(review).success, true);
    assert.equal(ContinuistaReviewInputSchema.safeParse({ ...review, failedCriterionCodes: [] }).success, false);
    assert.equal(ContinuistaReviewInputSchema.safeParse({ ...review, failedCriterionCodes: ['voice', 'voice'] }).success, false);
    assert.equal(ContinuistaReviewInputSchema.safeParse({ ...review, verdict: 'allow' }).success, false);
    assert.equal(ContinuistaReviewInputSchema.safeParse({ ...review, criterionCodes: ['voice'] }).success, false);
    const { failedCriterionCodes, ...legacy } = review;
    assert.deepEqual(failedCriterionCodes, ['knowledge', 'voice']);
    assert.equal(ContinuistaReviewInputSchema.safeParse(legacy).success, false);
    assert.deepEqual(ContinuistaStoredReviewSchema.parse(legacy), legacy, 'leer histórico no agrega campos ni cambia el hash canónico');
    assert.throws(() => journal.recordContinuistaReview(legacy), /diagnóstico/);
    journal.recordContinuistaReview(review);
    const database = new DatabaseSync(path);
    try {
      const payload = canonicalJson(legacy);
      database.prepare('UPDATE world_reviews SET payload_json=?,payload_hash=? WHERE proposal_id=?').run(payload, sha256(payload), proposalId);
    } finally { database.close(); }
    assert.equal(journal.resolveApprovalReceipt({ runId, proposalId, version: 1 }), undefined,
      'una review legacy reformulate se puede leer conservando su veredicto');
  });
});


function coordinatorConfigurationFixture(active = [maxId, agentId], world = worldFixture()) {
  const continuity = { continuityId: 'continuity-main', revision: 0, contentHash: 'b'.repeat(64), kind: 'adaptation', label: 'Continuidad sintética de test', milestones: [], inclusions: [] };
  const prepared = [maxId,agentId].map((characterId) => {
    const provenance = { kind: 'dossier-evidence', dossierRevision: 1, dossierHash: 'd'.repeat(64), continuity: { continuityId: continuity.continuityId, revision: continuity.revision, contentHash: continuity.contentHash },
      curatedBy: 'test-fixture', curatedAt: '2026-10-14T00:00:00Z', sourceRefs: ['test-source'] };
    return PreparedCharacterSchema.parse({ kind: 'prepared-character', schemaVersion: 1, characterId, dossierRevision: 1, dossierHash: 'd'.repeat(64), identityVersion: 1, continuity,
      identity: { value: { selfReference: characterId, selfConcept: 'Persona sintética', values: [], dispositions: ['Escucha'], contradictions: [] }, provenance },
      voice: { value: { kind: 'spoken', recipe: 'Voz sintética de test' }, provenance }, antecedents: { value: [], provenance },
      goals: { value: [{ kind: 'durable', goalId: 'goal-test', ownerCharacterId: characterId, desiredOutcome: 'Escuchar', priority: 0.5, reviewConditions: [], status: 'active', evidenceRefs: [] }], provenance },
      relationships: { value: [], provenance }, capabilities: { value: [{ kind: 'speech', capabilityId: 'speech', description: 'Hablar' }], provenance },
      inventory: { value: [], provenance }, initialExperience: { value: { kind: 'none' }, provenance }, unknownPolicy: { value: { defaultTreatment: 'do-not-infer-or-assert', fields: [] }, provenance } });
  });
  return ReadyRunConfigurationSchema.parse({ kind: 'ready-run-configuration', schemaVersion: 1, runId, configRevision: 0, name: 'Puesta sintética coordinator', fictionalAt: world.clock.instant,
    continuity, roster: { eligibleCharacterIds: [maxId,agentId], preparedCharacters: prepared, activeCharacterIds: active },
    humanParticipants: [{ identity: { participantId: 'interlocutor-andres', displayName: 'Andrés', identityMarkdown: 'Identidad sintética.', lifeStoryMarkdown: 'Historia sintética.' },
      presence: { kind: 'inScene', sceneId, placeId: roomId, position: { x: 0.5, y: 1 }, channelId } }], worldSnapshot: world,
    dramaticLine: { purpose: 'Prueba', question: { kind: 'absent' }, conflict: { kind: 'not-formulated' } }, circadianPolicy: { kind: 'manual-only' }, language: 'es',
    spanishVariety: { kind: 'proposed', label: 'Español de prueba', source: 'editorial-proposal' }, narrationMode: { kind: 'disabled' },
    budget: { maxPiCallsPerRun: 8, maxPiCallsPerPulse: 1, maxConcurrentPiRequests: 1, maxWallTimeMs: 60_000 }, maxReformulations: 1,
    audio: { mode: { kind: 'disabled' }, speakerSlots: [], narratorSlot: { kind: 'absent' }, soundEffectSlots: [] },
    snapshotFence: { runId, revision: world.revision, seq: world.seq, fictionalAt: world.clock.instant }, preparedActorFences: [], participantAvailability: [] });
}

test('coordinador conserva causa y cuota compartida, asigna destinatarios tardíos y migra v13 poblado', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-coordinator-'));
  const path = join(directory, 'world.sqlite'); let journal = openJournal({ path });
  try {
    registerRun(journal, coordinatorConfigurationFixture());
    assert.equal(journal.beginCoordinatorPulse({ runId }).kind, 'idle');
    assert.deepEqual(journal.listCoordinatorPulseTargets(), []);
    const first = journal.commitHumanIntervention({ runId, participantId: 'interlocutor-andres', expectedRevision: 0, idempotencyKey: uuid(30_000),
      request: { kind: 'speech', recipientCharacterIds: [maxId,agentId], channelId, content: { kind: 'speech', text: 'Pregunta compartida.' } } });
    if (first.kind !== 'stored' || first.resolution.kind !== 'applied') assert.fail('Primera causa inválida');
    const second = journal.commitHumanIntervention({ runId, participantId: 'interlocutor-andres', expectedRevision: 1, idempotencyKey: uuid(30_001),
      request: { kind: 'speech', recipientCharacterIds: [maxId], channelId, content: { kind: 'speech', text: 'Pregunta siguiente.' } } });
    if (second.kind !== 'stored' || second.resolution.kind !== 'applied') assert.fail('Segunda causa inválida');
    await createDeliverWorldWorker({ journal, runId, actorId: maxId }).drain();
    journal.close();
    const legacy = new DatabaseSync(path);
    try { legacy.exec('DROP TABLE coordinator_pulses; DROP TABLE IF EXISTS model_time_spans; DROP TABLE IF EXISTS model_time_run_state; DROP TABLE IF EXISTS run_preflight_job_operations; DROP TABLE IF EXISTS run_preflight_job_results; DROP TABLE IF EXISTS run_preflight_job_history; DROP TABLE IF EXISTS run_preflight_jobs; DROP TABLE IF EXISTS pi_access_job_operations; DROP TABLE IF EXISTS pi_access_job_results; DROP TABLE IF EXISTS pi_access_job_history; DROP TABLE IF EXISTS pi_access_jobs; DROP TABLE IF EXISTS pi_oauth_job_operations; DROP TABLE IF EXISTS pi_oauth_job_history; DROP TABLE IF EXISTS pi_oauth_jobs; DELETE FROM schema_version WHERE version IN(14,15,16,17,18,19,20,21,22,23,24,25,26,27,28);'); } finally { legacy.close(); }
    journal = openJournal({ path });
    const begun = journal.beginCoordinatorPulse({ runId });
    if (begun.kind !== 'started') assert.fail('No se creó pulso');
    assert.equal(begun.pulse.lifecycleRevision,journal.readWorldLifecycle({runId})?.lifecycleRevision);
    assert.equal(begun.pulse.cause.commitIndex, 1); assert.equal(begun.jobs.length, 1);
    assert.equal(begun.pulse.maxCalls, 1);
    const job = begun.jobs[0]; if (job === undefined) assert.fail('No existe job');
    assert.equal(job.lifecycleRevision,begun.pulse.lifecycleRevision);
    const lease = { ownerToken: uuid(30_002), claimToken: uuid(30_003) };
    const claim = journal.claimActorTurnJob({ runId, actorId: maxId, jobId: job.jobId, generation: 0, ...lease });
    if (claim.kind !== 'claimed') assert.fail('Claim ausente');
    assert.deepEqual(claim.job.frozenPerceptionIds, claim.job.perceptionIds, 'el inbox no absorbe la segunda causa');
    assert.equal(claim.job.perceptionIds.length, 1);
    const scope = { runId, pulseId: begun.pulse.pulseId, jobId: job.jobId, generation: 0 };
    assert.equal(journal.reserveNextRequest({ ...scope, clockEpochId: uuid(30_006), ownerToken: lease.ownerToken }).kind, 'reserved');
    journal.failActorTurnJob({ execution: { ...scope, actorId: maxId, lease }, code: 'pi-incomplete' });
    assert.equal(journal.closeCoordinatorPulse({ runId, pulseId: begun.pulse.pulseId }).state, 'running', 'delivery tardía mantiene pulso abierto');
    journal.close(); journal = openJournal({ path });
    await createDeliverWorldWorker({ journal, runId, actorId: agentId }).drain();
    const reused = journal.beginCoordinatorPulse({ runId });
    if (reused.kind !== 'existing') assert.fail('Pulso no recuperado');
    assert.equal(reused.pulse.pulseId, begun.pulse.pulseId); assert.equal(reused.pulse.consumed, 1); assert.equal(reused.jobs.length, 2);
    const other = reused.jobs.find((item) => item.actorId === agentId); if (other === undefined) assert.fail('Destinatario tardío no asignado');
    const otherScope = { runId, pulseId: other.pulseId, jobId: other.jobId, generation: other.generation };
    assert.deepEqual(journal.reserveNextRequest(otherScope), { kind: 'exhausted', scope: 'pulse' });
    const otherLease = { ownerToken: uuid(30_004), claimToken: uuid(30_005) };
    assert.equal(journal.claimActorTurnJob({ runId, actorId: agentId, jobId: other.jobId, generation: 0, ...otherLease }).kind, 'claimed');
    journal.failActorTurnJob({ execution: { ...otherScope, actorId: agentId, lease: otherLease }, code: 'pi-incomplete' });
    assert.equal(journal.closeCoordinatorPulse({ runId, pulseId: begun.pulse.pulseId }).state, 'blocked');
    const unchanged = journal.beginCoordinatorPulse({ runId });
    if (unchanged.kind !== 'existing') assert.fail('Causa bloqueada no conservada');
    assert.equal(unchanged.pulse.state, 'blocked'); assert.equal(unchanged.pulse.pulseId, begun.pulse.pulseId);
    assert.equal(journal.readQueuedActorTurnIntents({ runId, actorId: maxId }).length, 2, 'ninguna causa se consumió por fallo');
    const retry = journal.retryActorTurnJob({runId,actorId:maxId,jobId:job.jobId,expectedGeneration:0,pulseId:begun.pulse.pulseId});
    assert.equal(retry.job.perceptionIds.length,1, 'retry coordinado conserva causa sin absorber la siguiente');
    assert.equal(journal.readCoordinatorPulse({runId,pulseId:begun.pulse.pulseId})?.state,'running');
    assert.equal(journal.readCoordinatorPulse({runId,pulseId:begun.pulse.pulseId})?.consumed,1);
    assert.equal(journal.beginCoordinatorPulse({runId}).kind,'existing');
  } finally { journal.close(); rmSync(directory, {recursive:true,force:true}); }
});


test('coordinador no inventa pulsos sin actores activos y rechaza configuración alterada', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-coordinator-idle-'));
  const path = join(directory, 'world.sqlite'); const journal = openJournal({path});
  try {
    await createQueuedHumanIntentFixture(journal,['Prueba sin actor activo'],coordinatorConfigurationFixture([]));
    assert.equal(journal.beginCoordinatorPulse({runId}).kind,'idle');
    assert.equal(journal.setWorldLifecycle({runId,expectedWorldRevision:1,expectedConfigRevision:0,target:'paused'}),'updated');
    assert.equal(journal.beginCoordinatorPulse({runId}).kind,'inactive');
    assert.deepEqual(journal.listCoordinatorPulseTargets(),[]);
    const inspect = new DatabaseSync(path);
    try {
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM coordinator_pulses').get()?.n,0);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM pulses').get()?.n,0);
      inspect.prepare('UPDATE world_runs SET configuration_json=? WHERE run_id=?').run('{}',runId);
    } finally { inspect.close(); }
    assert.throws(()=>journal.beginCoordinatorPulse({runId}),/Hash/);
  } finally { journal.close();rmSync(directory,{recursive:true,force:true}); }
});


test('pulso coordinado con límite cero no reserva ni despacha requests', async () => {
  for (const budget of [
    {maxPiCallsPerRun:0,maxPiCallsPerPulse:0,maxConcurrentPiRequests:1,maxWallTimeMs:0},
    {maxPiCallsPerRun:8,maxPiCallsPerPulse:0,maxConcurrentPiRequests:1,maxWallTimeMs:60_000},
    {maxPiCallsPerRun:8,maxPiCallsPerPulse:1,maxConcurrentPiRequests:1,maxWallTimeMs:0},
  ]) {
    const directory=mkdtempSync(join(tmpdir(),'personajes-zero-pulse-')); const path=join(directory,'world.sqlite'); const journal=openJournal({path});
    try {
      const configuration=ReadyRunConfigurationSchema.parse({...coordinatorConfigurationFixture(),budget});
      await createQueuedHumanIntentFixture(journal,['Pregunta de presupuesto cero'],configuration);
      const begin=journal.beginCoordinatorPulse({runId});
      if(begin.kind!=='started') assert.fail('Job diagnóstico no programado');
      const job=begin.jobs[0]; if(job===undefined) assert.fail('Sin job');
      const lease={ownerToken:uuid(35_000),claimToken:uuid(35_001)};
      const claim=journal.claimActorTurnJob({runId,actorId:job.actorId,jobId:job.jobId,generation:job.generation,...lease});
      if(claim.kind!=='claimed') assert.fail('Sin claim');
      const execution={runId,actorId:job.actorId,jobId:job.jobId,generation:job.generation,pulseId:job.pulseId,lease};
      journal.registerActorPiSession({runId,actorId:job.actorId,sessionId:'zero-budget-actor',sessionPath:join(directory,'actor.jsonl'),preparedContextHash:'a'.repeat(64),
        profile:{provider:'openai-codex',model:'gpt-6-luna',reasoning:'xhigh'}});
      const port=createActorPiRequestPort({journal,execution});
      const result=await port.reserveNextRequest({purpose:{kind:'actor',characterId:job.actorId},scope:{runId,jobId:job.jobId,generation:job.generation,pulseId:job.pulseId},clockEpochId:uuid(30_221)});
      assert.equal(result.kind,'exhausted');
      const inspect=new DatabaseSync(path);
      try {
        assert.equal(inspect.prepare('SELECT COUNT(*) n FROM request_reservations').get()?.n,0);
        assert.equal(inspect.prepare('SELECT consumed FROM pulses').get()?.consumed,0);
        assert.equal(inspect.prepare('SELECT consumed FROM run_budgets').get()?.consumed,0);
      } finally {inspect.close();}
    } finally {journal.close();rmSync(directory,{recursive:true,force:true});}
  }
});


test('coordinador y puerto Pi respetan rutina en hora ficticia sin consumir preguntas dormido', async () => {
  const directory=mkdtempSync(join(tmpdir(),'personajes-circadian-pulse-')); const path=join(directory,'world.sqlite'); const journal=openJournal({path});
  function advanceFixtureClock(instant:number) {
    const current=journal.loadWorld({runId}); if(current===undefined) assert.fail('Fixture sin snapshot');
    const snapshot=WorldSnapshotSchema.parse({...current,revision:current.revision+1,clock:{...current.clock,instant}});
    const payload=canonicalJson(snapshot); const hash=sha256(payload); const database=new DatabaseSync(path);
    try {
      const index=Number(database.prepare('SELECT commit_index FROM world_runs WHERE run_id=?').get(runId)?.commit_index)+1;
      database.exec('BEGIN IMMEDIATE');
      database.prepare(`INSERT INTO world_commits(run_id,commit_index,origin_kind,origin_id,world_revision,last_seq,snapshot_json,snapshot_hash,created_at)
        VALUES(?,?,'testClockAdvance',?,?,?,?,?,?)`).run(runId,index,uuid(38_000+index),snapshot.revision,snapshot.seq,payload,hash,Date.now());
      database.prepare('UPDATE world_runs SET commit_index=?,world_revision=?,snapshot_json=?,snapshot_hash=? WHERE run_id=?').run(index,snapshot.revision,payload,hash,runId);
      database.exec('COMMIT');
    } finally {database.close();}
  }
  try {
    const original=worldFixture();
    const world=WorldSnapshotSchema.parse({...original,entities:original.entities.map((entity)=>entity.kind==='character'
      ? {...entity,routine:{kind:'windows',defaultState:'unavailable',windows:[{from:0,to:1000,state:'available'},{from:2000,to:3000,state:'available'}]}}
      : entity)});
    await createQueuedHumanIntentFixture(journal,['Pregunta entregada despierto'],coordinatorConfigurationFixture([maxId,agentId],world));
    const pending=journal.readQueuedActorTurnIntents({runId,actorId:maxId}).map((item)=>item.perceptionId);
    advanceFixtureClock(1500);
    assert.equal(journal.beginCoordinatorPulse({runId}).kind,'idle');
    assert.deepEqual(journal.readQueuedActorTurnIntents({runId,actorId:maxId}).map((item)=>item.perceptionId),pending);
    const noPulse=new DatabaseSync(path); try {assert.equal(noPulse.prepare('SELECT COUNT(*) n FROM pulses').get()?.n,0);}finally{noPulse.close();}
    advanceFixtureClock(2500);
    const begin=journal.beginCoordinatorPulse({runId}); if(begin.kind!=='started') assert.fail('Al despertar no se asignó input conservado');
    const job=begin.jobs[0];if(job===undefined)assert.fail('Sin job');assert.deepEqual(job.perceptionIds,pending);
    advanceFixtureClock(3500);
    const lease={ownerToken:uuid(38_101),claimToken:uuid(38_102)};
    const claim=journal.claimActorTurnJob({runId,actorId:job.actorId,jobId:job.jobId,generation:job.generation,...lease});
    if(claim.kind!=='claimed')assert.fail('Sin claim');
    journal.registerActorPiSession({runId,actorId:job.actorId,sessionId:'circadian-test',sessionPath:join(directory,'actor.jsonl'),preparedContextHash:'a'.repeat(64),profile:{provider:'openai-codex',model:'gpt-6-luna',reasoning:'xhigh'}});
    const execution={runId,actorId:job.actorId,jobId:job.jobId,generation:job.generation,pulseId:job.pulseId,lease};
    const port=createActorPiRequestPort({journal,execution}); const purpose={kind:'actor',characterId:job.actorId} satisfies {kind:'actor';characterId:typeof job.actorId};
    assert.equal((await port.checkEligibility({purpose,scope:{runId,pulseId:job.pulseId,jobId:job.jobId,generation:job.generation}})).kind,'inactive');
    await assert.rejects(async()=>port.reserveNextRequest({purpose,scope:{runId,pulseId:job.pulseId,jobId:job.jobId,generation:job.generation}}),/actor_unavailable/);
    const inspect=new DatabaseSync(path);try{assert.equal(inspect.prepare('SELECT COUNT(*) n FROM request_reservations').get()?.n,0);assert.equal(inspect.prepare('SELECT consumed FROM pulses').get()?.consumed,0);}finally{inspect.close();}
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});


test('ledger Continuista v15 exige terminal completo, comparte cuota y acepta review exacta tras reopen',async()=>{
  const fixture=await setupContinuistaFixture();
  try{
    // Restore an actual populated v14 database before introducing administrative tables.
    const legacy=new DatabaseSync(join(fixture.directory,'journal.sqlite'));
    try{legacy.exec(`DROP TABLE continuista_receipts;DROP TABLE continuista_candidates;DROP TABLE continuista_checkpoints;DROP TABLE continuista_request_leases;DROP TABLE continuista_sessions;DROP TABLE continuista_jobs;DROP TABLE IF EXISTS model_time_spans; DROP TABLE IF EXISTS model_time_run_state; DROP TABLE IF EXISTS run_preflight_job_operations; DROP TABLE IF EXISTS run_preflight_job_results; DROP TABLE IF EXISTS run_preflight_job_history; DROP TABLE IF EXISTS run_preflight_jobs; DROP TABLE IF EXISTS pi_access_job_operations; DROP TABLE IF EXISTS pi_access_job_results; DROP TABLE IF EXISTS pi_access_job_history; DROP TABLE IF EXISTS pi_access_jobs; DROP TABLE IF EXISTS pi_oauth_job_operations; DROP TABLE IF EXISTS pi_oauth_job_history; DROP TABLE IF EXISTS pi_oauth_jobs; DELETE FROM schema_version WHERE version IN(15,16,17,18,19,20,21,22,23,24,25,26,27,28);`);}finally{legacy.close();}
    const migrated=openJournal({path:join(fixture.directory,'journal.sqlite')});migrated.close();
    const actor=continuistaActorFactory(fixture);let reviewed=false;
    const worker=createActorTurnWorker({journal:fixture.journal,runtime:fixture.runtime,ids:fixture.ids,sessionFactory:actor.factory,
      memoryForActor:()=>({async recall(){return {source:'ranked-recall',throughWorldSeq:WorldSeqSchema.parse(0),experiences:[],rejectedCount:0};}}),
      continuista:{async review({execution,proposal}){
        const context=await assembleContinuistaReviewContext({journal:fixture.journal,execution,proposal,ids:fixture.ids});
        const request={execution,context,ownerToken:uuid(40_000),claimToken:uuid(40_001)};
        const begin=fixture.journal.beginContinuistaJob(request);if(begin.kind!=='created')assert.fail('Sin childjob');
        assert.equal(begin.job.pulseId,execution.pulseId);
        assert.equal(fixture.journal.beginContinuistaJob(request).kind,'existing');
        assert.equal(fixture.journal.beginContinuistaJob({...request,claimToken:uuid(40_002)}).kind,'busy');
        const admin=begin.execution;
        const snapshot={sessionId:'reviewer-session',sessionPath:join(fixture.directory,'reviewer.jsonl'),candidateLeafId:'input-review'};
        fixture.journal.registerContinuistaSession({execution:admin,sessionId:snapshot.sessionId,sessionPath:snapshot.sessionPath,profile:resolveReadyInferenceProfile(fixture.configuration)});
        const reservation=fixture.journal.reserveContinuistaRequest({execution:admin,clockEpochId:fixture.runtime.clockEpochId});if(reservation.kind!=='reserved')assert.fail('Sin reserva reviewer');
        const transition={execution:admin,requestSeq:reservation.requestSeq};
        assert.throws(()=>fixture.journal.transitionContinuistaRequest({...transition,target:'dispatched',wallTime:{clockEpochId:fixture.runtime.clockEpochId,monotonicNs:process.hrtime.bigint().toString()}}),'sin checkpoint input no se despacha');
        fixture.journal.recordContinuistaCheckpoint({execution:admin,purpose:{kind:'request-input',requestSeq:reservation.requestSeq},snapshot});
        fixture.journal.transitionContinuistaRequest({...transition,target:'dispatched',wallTime:{clockEpochId:fixture.runtime.clockEpochId,monotonicNs:process.hrtime.bigint().toString()}});
        assert.throws(()=>fixture.journal.transitionContinuistaRequest({...transition,target:'dispatched',wallTime:{clockEpochId:fixture.runtime.clockEpochId,monotonicNs:process.hrtime.bigint().toString()}}),/ya despachada/);
        assert.throws(()=>fixture.journal.transitionContinuistaRequest({...transition,execution:{...admin,lease:{...admin.lease,claimToken:uuid(40_003)}},target:'completed',wallTime:{clockEpochId:fixture.runtime.clockEpochId,monotonicNs:process.hrtime.bigint().toString()}}),/Lease/);
        const response=continuistaResponse(context);const stage=fixture.journal.stageContinuistaReview({execution:admin,response});
        assert.equal(fixture.journal.resolveApprovalReceipt({runId:execution.runId,proposalId:proposal.proposalId,version:proposal.version}),undefined,'stage no concede autoridad');
        assert.throws(()=>fixture.journal.acceptContinuistaReview({execution:admin,candidateHash:stage.candidateHash}),/terminal/);
        fixture.journal.transitionContinuistaRequest({...transition,target:'completed',wallTime:{clockEpochId:fixture.runtime.clockEpochId,monotonicNs:process.hrtime.bigint().toString()}});
        const second=fixture.journal.reserveContinuistaRequest({execution:admin,clockEpochId:fixture.runtime.clockEpochId});if(second.kind!=='reserved')assert.fail('Sin segunda reserva reviewer');
        fixture.journal.recordContinuistaCheckpoint({execution:admin,purpose:{kind:'request-input',requestSeq:second.requestSeq},snapshot:{...snapshot,candidateLeafId:'input-review2'}});
        fixture.journal.transitionContinuistaRequest({execution:admin,requestSeq:second.requestSeq,target:'dispatched',wallTime:{clockEpochId:fixture.runtime.clockEpochId,monotonicNs:process.hrtime.bigint().toString()}});
        fixture.journal.transitionContinuistaRequest({execution:admin,requestSeq:second.requestSeq,target:'completed',wallTime:{clockEpochId:fixture.runtime.clockEpochId,monotonicNs:process.hrtime.bigint().toString()}});
        assert.throws(()=>fixture.journal.recordContinuistaCheckpoint({execution:admin,purpose:{kind:'terminal-candidate',outcome:'completed',lastRequestSeq:reservation.requestSeq},snapshot:{...snapshot,candidateLeafId:'review-obsolete'}}),/última request/);
        fixture.journal.recordContinuistaCheckpoint({execution:admin,purpose:{kind:'terminal-candidate',outcome:'completed',lastRequestSeq:second.requestSeq},snapshot:{...snapshot,candidateLeafId:'review-done'}});
        const accepted=fixture.journal.acceptContinuistaReview({execution:admin,candidateHash:stage.candidateHash});assert.equal(accepted.kind,'stored');
        assert.equal(fixture.journal.acceptContinuistaReview({execution:admin,candidateHash:stage.candidateHash}).kind,'existing');
        const reopened=openJournal({path:join(fixture.directory,'journal.sqlite')});
        try{assert.deepEqual(reopened.readContinuistaReceipt({jobId:admin.jobId,generation:admin.generation}),accepted.receipt);assert.equal(reopened.beginContinuistaJob(request).kind,'existing');}finally{reopened.close();}
        const inspect=new DatabaseSync(join(fixture.directory,'journal.sqlite'));
        try{assert.equal(inspect.prepare('SELECT consumed FROM pulses WHERE pulse_id=?').get(execution.pulseId)?.consumed,3);assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(),[]);}finally{inspect.close();}
        const tamper=new DatabaseSync(join(fixture.directory,'journal.sqlite'));
        try{
          for(const field of ['candidateHash','terminalHash']){
            const payload=canonicalJson({...accepted.receipt,[field]:'f'.repeat(64)});
            tamper.prepare('UPDATE continuista_receipts SET payload_json=?,payload_hash=? WHERE job_id=? AND generation=?').run(payload,sha256(payload),admin.jobId,admin.generation);
            assert.throws(()=>fixture.journal.readContinuistaReceipt({jobId:admin.jobId,generation:admin.generation}),/candidato|terminal/);
          }
          const payload=canonicalJson(accepted.receipt);tamper.prepare('UPDATE continuista_receipts SET payload_json=?,payload_hash=? WHERE job_id=? AND generation=?').run(payload,sha256(payload),admin.jobId,admin.generation);
        }finally{tamper.close();}
        reviewed=true;return accepted.receipt.review;
      }}});
    assert.equal((await worker.run(fixture.claim)).kind,'committed');assert.equal(reviewed,true);
  }finally{fixture.close();}
});


test('Continuista incompleto e incierto permanece bloqueado sin autoridad ni refund; retry explícito conserva pulso',async()=>{
  const fixture=await setupContinuistaFixture();
  try{
    const actor=continuistaActorFactory(fixture);let checked=false;
    const worker=createActorTurnWorker({journal:fixture.journal,runtime:fixture.runtime,ids:fixture.ids,sessionFactory:actor.factory,
      memoryForActor:()=>({async recall(){return {source:'ranked-recall',throughWorldSeq:WorldSeqSchema.parse(0),experiences:[],rejectedCount:0};}}),
      continuista:{async review({execution,proposal}){
        const context=await assembleContinuistaReviewContext({journal:fixture.journal,execution,proposal,ids:fixture.ids});
        const begin=fixture.journal.beginContinuistaJob({execution,context,ownerToken:uuid(41_000),claimToken:uuid(41_001)});
        if(begin.kind!=='created')assert.fail('Sin childjob');const admin=begin.execution;
        const snapshot={sessionId:'incomplete-review-session',sessionPath:join(fixture.directory,'incomplete-review.jsonl'),candidateLeafId:'input-review'};
        fixture.journal.registerContinuistaSession({execution:admin,sessionId:snapshot.sessionId,sessionPath:snapshot.sessionPath,profile:resolveReadyInferenceProfile(fixture.configuration)});
        const reservation=fixture.journal.reserveContinuistaRequest({execution:admin,clockEpochId:fixture.runtime.clockEpochId});if(reservation.kind!=='reserved')assert.fail('Sin reserva');
        fixture.journal.recordContinuistaCheckpoint({execution:admin,purpose:{kind:'request-input',requestSeq:reservation.requestSeq},snapshot});
        fixture.journal.transitionContinuistaRequest({execution:admin,requestSeq:reservation.requestSeq,target:'dispatched',wallTime:{clockEpochId:fixture.runtime.clockEpochId,monotonicNs:process.hrtime.bigint().toString()}});
        const complete=continuistaResponse(context);const response={...complete,review:{...complete.review,complete:false}};
        const candidate=fixture.journal.stageContinuistaReview({execution:admin,response});
        fixture.journal.transitionContinuistaRequest({execution:admin,requestSeq:reservation.requestSeq,target:'ambiguous',wallTime:{clockEpochId:fixture.runtime.clockEpochId,monotonicNs:process.hrtime.bigint().toString()}});
        fixture.journal.recordContinuistaCheckpoint({execution:admin,purpose:{kind:'terminal-candidate',outcome:'failed',lastRequestSeq:reservation.requestSeq},snapshot:{...snapshot,candidateLeafId:'incomplete-tail'}});
        assert.throws(()=>fixture.journal.acceptContinuistaReview({execution:admin,candidateHash:candidate.candidateHash}),/incompleta/);
        assert.equal(fixture.journal.readContinuistaReceipt({jobId:admin.jobId,generation:admin.generation}),undefined);
        assert.equal(fixture.journal.recoverAbandonedContinuistaClaims({ownerToken:uuid(41_002)}),1);
        const recovered=fixture.journal.beginContinuistaJob({execution,context,ownerToken:uuid(41_002),claimToken:uuid(41_003)});
        if(recovered.kind!=='existing')assert.fail('Sin recuperación');
        assert.throws(()=>fixture.journal.reserveContinuistaRequest({execution:recovered.execution}),/incierta/);
        fixture.journal.failContinuistaJob({execution:recovered.execution,code:'pi-incomplete'});
        assert.equal(fixture.journal.beginContinuistaJob({execution,context,ownerToken:uuid(41_002),claimToken:uuid(41_003)}).kind,'blocked');
        const retry=fixture.journal.retryContinuistaJob({execution:recovered.execution,expectedGeneration:0,ownerToken:uuid(41_004),claimToken:uuid(41_005)});
        if(retry.kind!=='created')assert.fail('Sin retry');assert.equal(retry.job.generation,1);assert.equal(retry.job.pulseId,execution.pulseId);
        fixture.journal.registerContinuistaSession({execution:retry.execution,sessionId:'retry-review-session',sessionPath:join(fixture.directory,'retry-review.jsonl'),profile:resolveReadyInferenceProfile(fixture.configuration)});
        const retryRequest=fixture.journal.reserveContinuistaRequest({execution:retry.execution,clockEpochId:fixture.runtime.clockEpochId});assert.equal(retryRequest.kind,'reserved');
        const inspect=new DatabaseSync(join(fixture.directory,'journal.sqlite'));
        try{assert.equal(inspect.prepare('SELECT consumed FROM pulses WHERE pulse_id=?').get(execution.pulseId)?.consumed,3);
          assert.equal(inspect.prepare('SELECT state FROM request_reservations WHERE job_id=? AND generation=0').get(admin.jobId)?.state,'ambiguous');}finally{inspect.close();}
        assert.equal(fixture.journal.resolveApprovalReceipt({runId:execution.runId,proposalId:proposal.proposalId,version:proposal.version}),undefined);
        checked=true;return response.review;
      }}});
    const result=await worker.run(fixture.claim);assert.equal(result.kind,'blocked');assert.equal(checked,true);
  }finally{fixture.close();}
});


test('v16 reconcilia terminal y admin aceptado de v15 con nuevo claim sin reescribir proofs ni repetir llamadas',async()=>{
  const fixture=await setupContinuistaFixture();let reopened:ReturnType<typeof openJournal>|undefined;
  try{
    const actor=continuistaActorFactory(fixture);let originalExecution:z.infer<typeof ActorJobExecutionSchema>|undefined;
    const crashJournal={...fixture.journal,acceptActorTurn(){throw new Error('crash-before-parent-accept');},failActorTurnJob(){throw new Error('process-unavailable');}};
    const original=createActorTurnWorker({journal:crashJournal,runtime:fixture.runtime,ids:fixture.ids,sessionFactory:actor.factory,
      memoryForActor:()=>({async recall(){return {source:'ranked-recall',throughWorldSeq:WorldSeqSchema.parse(0),experiences:[],rejectedCount:0};}}),
      continuista:{async review({execution,proposal}){
        originalExecution=execution;const context=await assembleContinuistaReviewContext({journal:fixture.journal,execution,proposal,ids:fixture.ids});
        const begin=fixture.journal.beginContinuistaJob({execution,context,ownerToken:uuid(42_000),claimToken:uuid(42_001)});if(begin.kind!=='created')assert.fail('Sin admin');
        const admin=begin.execution;const snapshot={sessionId:'recovery-admin',sessionPath:join(fixture.directory,'recovery-admin.jsonl'),candidateLeafId:'admin-input'};
        fixture.journal.registerContinuistaSession({execution:admin,sessionId:snapshot.sessionId,sessionPath:snapshot.sessionPath,profile:resolveReadyInferenceProfile(fixture.configuration)});
        const request=fixture.journal.reserveContinuistaRequest({execution:admin,clockEpochId:fixture.runtime.clockEpochId});if(request.kind!=='reserved')assert.fail('Sin request');
        fixture.journal.recordContinuistaCheckpoint({execution:admin,purpose:{kind:'request-input',requestSeq:request.requestSeq},snapshot});
        fixture.journal.transitionContinuistaRequest({execution:admin,requestSeq:request.requestSeq,target:'dispatched',wallTime:{clockEpochId:fixture.runtime.clockEpochId,monotonicNs:process.hrtime.bigint().toString()}});
        const response=continuistaResponse(context);const candidate=fixture.journal.stageContinuistaReview({execution:admin,response});
        fixture.journal.transitionContinuistaRequest({execution:admin,requestSeq:request.requestSeq,target:'completed',wallTime:{clockEpochId:fixture.runtime.clockEpochId,monotonicNs:process.hrtime.bigint().toString()}});
        fixture.journal.recordContinuistaCheckpoint({execution:admin,purpose:{kind:'terminal-candidate',outcome:'completed',lastRequestSeq:request.requestSeq},snapshot:{...snapshot,candidateLeafId:'admin-terminal'}});
        return fixture.journal.acceptContinuistaReview({execution:admin,candidateHash:candidate.candidateHash}).receipt.review;
      }}});
    await assert.rejects(original.run(fixture.claim),/crash-before-parent-accept/);if(originalExecution===undefined)assert.fail('Sin ejecución original');
    const path=join(fixture.directory,'journal.sqlite');const before=new DatabaseSync(path);
    let candidates:unknown[];let checkpoints:unknown[];
    try{candidates=before.prepare('SELECT canonical_payload,payload_hash FROM actor_pi_candidates ORDER BY candidate_id').all();checkpoints=before.prepare('SELECT payload_json,checkpoint_hash FROM actor_job_checkpoints ORDER BY checkpoint_hash').all();
      before.exec('DROP TABLE actor_turn_reconciliations;DROP TABLE actor_terminal_proposals;DROP TABLE IF EXISTS model_time_spans; DROP TABLE IF EXISTS model_time_run_state; DROP TABLE IF EXISTS run_preflight_job_operations; DROP TABLE IF EXISTS run_preflight_job_results; DROP TABLE IF EXISTS run_preflight_job_history; DROP TABLE IF EXISTS run_preflight_jobs; DROP TABLE IF EXISTS pi_access_job_operations; DROP TABLE IF EXISTS pi_access_job_results; DROP TABLE IF EXISTS pi_access_job_history; DROP TABLE IF EXISTS pi_access_jobs; DROP TABLE IF EXISTS pi_oauth_job_operations; DROP TABLE IF EXISTS pi_oauth_job_history; DROP TABLE IF EXISTS pi_oauth_jobs; DELETE FROM schema_version WHERE version IN(16,17,18,19,20,21,22,23,24,25,26,27,28);');}finally{before.close();}
    reopened=openJournal({path});const recoveredJournal=reopened;const newLease={ownerToken:uuid(42_002),claimToken:uuid(42_003)};
    assert.equal(reopened.recoverAbandonedActorTurnJobClaims({ownerToken:newLease.ownerToken}),1);
    const claim=reopened.claimActorTurnJob({runId:originalExecution.runId,actorId:originalExecution.actorId,jobId:originalExecution.jobId,generation:originalExecution.generation,...newLease});if(claim.kind!=='claimed')assert.fail('Sin nuevo claim');
    const execution={...originalExecution,lease:newLease};const recovery=reopened.readActorTurnRecovery({execution});if(recovery.kind!=='completed')assert.fail(`Proofs no recuperados: ${recovery.kind}`);
    const originalSession=reopened.loadActorPiSession({runId:execution.runId,actorId:execution.actorId});if(originalSession===undefined)assert.fail('Sesión original ausente');
    const leafDatabase=new DatabaseSync(path);
    try{
      const inputLeaf=z.strictObject({candidate_leaf_id:z.string()}).parse(leafDatabase.prepare(`SELECT candidate_leaf_id FROM actor_pi_candidates WHERE job_id=? AND generation=? AND candidate_kind='request-input' ORDER BY request_seq DESC LIMIT 1`).get(execution.jobId,execution.generation));
      const terminalLeaf=z.strictObject({candidate_leaf_id:z.string()}).parse(leafDatabase.prepare('SELECT candidate_leaf_id FROM actor_pi_candidates WHERE candidate_id=?').get(recovery.candidateId));
      assert.deepEqual(recovery.sessionIntegrity,{sessionId:originalSession.sessionId,sessionPath:originalSession.sessionPath,baseLeafId:null,inputLeafId:inputLeaf.candidate_leaf_id,terminalLeafId:terminalLeaf.candidate_leaf_id});
    }finally{leafDatabase.close();}
    assert.throws(()=>recoveredJournal.acceptActorTurn({candidateId:recovery.candidateId,proposal:recovery.proposalBinding,lease:originalExecution?.lease}),/claim y owner/);
    assert.throws(()=>recoveredJournal.acceptActorTurn({candidateId:recovery.candidateId,proposal:recovery.proposalBinding,lease:newLease}),/claim y owner/,'el raw accept tampoco permite mezclar lease nuevo y candidato viejo');
    const accepted=reopened.acceptRecoveredActorTurn({execution,candidateId:recovery.candidateId,proposalBinding:recovery.proposalBinding});
    assert.deepEqual(reopened.acceptRecoveredActorTurn({execution,candidateId:recovery.candidateId,proposalBinding:recovery.proposalBinding}),accepted);
    const tamper=new DatabaseSync(path);
    try{
      const grant=z.strictObject({proof_hash:z.string()}).parse(tamper.prepare('SELECT proof_hash FROM actor_turn_reconciliations WHERE candidate_id=?').get(recovery.candidateId));
      tamper.prepare('UPDATE actor_turn_reconciliations SET proof_hash=? WHERE candidate_id=?').run('f'.repeat(64),recovery.candidateId);
      assert.throws(()=>recoveredJournal.acceptRecoveredActorTurn({execution,candidateId:recovery.candidateId,proposalBinding:recovery.proposalBinding}),/proof alterado/);
      tamper.prepare('UPDATE actor_turn_reconciliations SET proof_hash=? WHERE candidate_id=?').run(grant.proof_hash,recovery.candidateId);
      const receipt=z.strictObject({candidate_id:z.string(),receipt_json:z.string(),receipt_hash:z.string(),acceptance_hash:z.string(),accepted_at:z.number()}).parse(tamper.prepare('SELECT * FROM actor_pi_turn_receipts WHERE candidate_id=?').get(recovery.candidateId));
      tamper.prepare('DELETE FROM actor_pi_turn_receipts WHERE candidate_id=?').run(recovery.candidateId);
      assert.throws(()=>recoveredJournal.acceptRecoveredActorTurn({execution,candidateId:recovery.candidateId,proposalBinding:recovery.proposalBinding}),/receipt Pi único/,'grant huérfano no habilita lease original');
      tamper.prepare('INSERT INTO actor_pi_turn_receipts VALUES(?,?,?,?,?)').run(receipt.candidate_id,receipt.receipt_json,receipt.receipt_hash,receipt.acceptance_hash,receipt.accepted_at);
    }finally{tamper.close();}
    const command={runId:execution.runId,proposalId:recovery.proposal.proposalId,version:recovery.proposal.version,ids:fixture.ids};
    const commit=reopened.commitWorldAttempt(command);assert.equal(commit.resolution.kind,'applied');assert.equal(reopened.commitWorldAttempt(command).kind,'existing');
    const inspect=new DatabaseSync(path);try{assert.deepEqual(inspect.prepare('SELECT canonical_payload,payload_hash FROM actor_pi_candidates ORDER BY candidate_id').all(),candidates);
      assert.deepEqual(inspect.prepare('SELECT payload_json,checkpoint_hash FROM actor_job_checkpoints ORDER BY checkpoint_hash').all(),checkpoints);
      assert.equal(inspect.prepare('SELECT consumed FROM pulses').get()?.consumed,2);assert.equal(inspect.prepare('SELECT COUNT(*) n FROM actor_turn_reconciliations').get()?.n,1);
      assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(),[]);}finally{inspect.close();}
    assert.equal(actor.prompts.length,1);
  }finally{reopened?.close();fixture.close();}
});
