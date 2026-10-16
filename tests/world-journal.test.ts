import { resolveReadyInferenceProfile } from '../src/domain/inference-profile.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { downgradeCoordinatorPulsesTo44 } from './fixtures/journal-v45-downgrade.ts';
import { test } from 'node:test';
import { z } from 'zod';
import { ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { fingerprintInferenceProfile } from '../src/application/pi-access-check.ts';
import { DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { PreparedCharacterSchema } from '../src/domain/preparation.ts';
import { ActorJobExecutionSchema, ActorTurnJobViewSchema, ContinuistaReviewInputSchema, ContinuistaStoredReviewSchema, RunDraftPatchSchema } from '../src/domain/world-journal.ts';
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
  WorldPerceptionSchema, buildActorWorldView, emptyActorKnowledge, hashCommunicationContent,
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
const chiefId = CharacterIdSchema.parse('jefe');
const maxEntity = WorldEntityIdSchema.parse(uuid(710));
const agentEntity = WorldEntityIdSchema.parse(uuid(711));
const chiefEntity = WorldEntityIdSchema.parse(uuid(714));
const roomId = 'sala';
const sceneId = uuid(712);
const channelId = uuid(713);
const proposalId = ProposalIdSchema.parse(uuid(720));
const secondProposalId = ProposalIdSchema.parse(uuid(721));
const maxExperienceId = ExperienceIdSchema.parse(uuid(722));
const maxGoalId = GoalIdSchema.parse(uuid(723));
const thirdProposalId = ProposalIdSchema.parse(uuid(724));

const dramaticStructurePrincipalId = 'dramatic-structure-test';

function configuredDraftField(value: unknown) {
  return { kind: 'configured', value, evidence: { kind: 'operator-choice', operatorId: 'synthetic-test', recordedAt: '1900-01-01T00:00:00Z' } };
}

function draftPatchFromReadyConfiguration(configuration: Awaited<ReturnType<typeof setupContinuistaFixture>>['configuration']) {
  const worldSnapshot = {
    ...configuration.worldSnapshot,
    entities: configuration.worldSnapshot.entities.map((entity) => entity.kind === 'character'
      ? { ...entity, mind: { ...entity.mind, experiences: [] } }
      : entity),
  };
  return RunDraftPatchSchema.parse(Object.fromEntries(Object.entries({
    name: configuration.name, fictionalAt: configuration.fictionalAt, continuity: configuration.continuity,
    roster: configuration.roster, humanParticipants: configuration.humanParticipants, worldSnapshot,
    dramaticLine: configuration.dramaticLine, dramaticReferences: configuration.dramaticReferences,
    circadianPolicy: configuration.circadianPolicy,
    spanishVariety: configuration.spanishVariety, narrationMode: configuration.narrationMode,
    inferenceProfile: configuration.inferenceProfile, budget: configuration.budget,
    maxReformulations: configuration.maxReformulations, audio: configuration.audio,
  }).map(([field, value]) => [field, configuredDraftField(value)])));
}

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

async function acceptActorAttemptForTest(input: {
  journal: ReturnType<typeof openJournal>;
  directory: string;
  job: Pick<z.infer<typeof ActorTurnJobViewSchema>, 'runId'|'actorId'|'jobId'|'generation'|'pulseId'>;
  seed: number;
  nextInitiative?: 'yield'|'after-resolution';
  makeAttempt: (cut: { worldRevision: number; worldSeq: number }) => unknown;
}) {
  const { journal, directory, job, seed } = input;
  const lease = { ownerToken: uuid(seed), claimToken: uuid(seed + 1) };
  const claim = journal.claimActorTurnJob({ runId:job.runId,actorId:job.actorId,jobId:job.jobId,
    generation:job.generation,...lease });
  if (claim.kind !== 'claimed' || claim.job.frozenWorldCut === null) assert.fail('Falta el corte congelado del job de prueba');
  const cut=claim.job.frozenWorldCut;
  const scope = { runId: job.runId, pulseId: job.pulseId, jobId: job.jobId, generation: job.generation };
  const actorId=job.actorId;
  const sessionId=`${actorId}-action-feedback`;
  const registration = journal.registerActorPiSession({ runId: job.runId, actorId,
    sessionId, sessionPath: join(directory, `${sessionId}.jsonl`),
    preparedContextHash: 'a'.repeat(64),
    profile: { provider: 'openai-codex', model: 'gpt-6-luna', reasoning: 'xhigh' } });
  const port = createActorPiRequestPort({ journal, execution: { ...scope, actorId, lease } });
  const identity = { kind: 'actor', characterId: actorId } as const;
  const clockEpochId = uuid(seed + 2);
  const reservation = await port.reserveNextRequest({ purpose: identity, scope, clockEpochId });
  if (reservation.kind !== 'reserved') assert.fail('La llamada sintética del actor debe reservar cuota');
  const requestSeq = reservation.requestSeq;
  const candidateBase = { turnId: uuid(seed + 3), runId: job.runId, actorId, scope, lease,
    base: registration.session, inputCut: cut };
  await port.recordCheckpointCandidate({ identity,
    purpose: { kind: 'request-input', baseScope: scope, request: { scope, requestSeq } },
    snapshot: { sessionId: registration.session.sessionId, sessionPath: registration.session.sessionPath,
      candidateLeafId: `action-feedback-input-${job.generation}` } });
  await port.recordActorPiCandidate?.({ ...candidateBase, kind: 'request-input', candidateId: uuid(seed + 4),
    requestSeq, candidateLeafId: `action-feedback-input-${job.generation}` });
  const attempt = input.makeAttempt(cut);
  const attemptRecord = attempt as { attemptId: string };
  const proposalId = ProposalIdSchema.parse(uuid(seed + 5));
  journal.registerWorldProposal({ runId, proposalId, version: 1, jobId: job.jobId, generation: job.generation,
    proposalSlot: 0, lease, ...(input.nextInitiative===undefined?{}:{nextInitiative:input.nextInitiative}), attempt });
  if(typeof attempt==='object'&&attempt!==null&&Reflect.get(attempt,'kind')==='communicate'){
    journal.recordContinuistaReview({kind:'continuista',proposalId,version:1,runId:job.runId,actorId,
      stateRevision:claim.job.frozenWorldCut.worldRevision,
      exactContentHash:hashCommunicationContent(Reflect.get(attempt,'content')),
      ...(input.nextInitiative===undefined?{}:{nextInitiative:input.nextInitiative}),
      verdict:'allow',criterionCodes:allCriteria,failedCriterionCodes:[],
      evidenceRefs:['research:continuity-main'],complete:true});
  }
  await port.transitionReservation({ purpose: identity, scope, requestSeq, target: 'dispatched',
    wallTime: { clockEpochId, monotonicNs: process.hrtime.bigint().toString() } });
  await port.transitionReservation({ purpose: identity, scope, requestSeq, target: 'completed',
    wallTime: { clockEpochId, monotonicNs: process.hrtime.bigint().toString() } });
  const candidateId = uuid(seed + 6);
  await port.recordActorPiCandidate?.({ ...candidateBase, kind: 'terminal-candidate', candidateId,
    outcome: 'completed', lastRequestSeq: requestSeq, candidateLeafId: `action-feedback-terminal-${job.generation}` });
  journal.acceptActorTurn({ candidateId, lease, proposal: { kind: 'durable', proposalId, version: 1,
    attemptHash: sha256(canonicalJson(attempt)) } });
  return { attempt, attemptId: attemptRecord.attemptId, proposalId, claim, cut };
}

function waitAttempt(attemptId: number, actorId: string, expectedRevision: number) {
  return { kind: 'wait', attemptId: uuid(attemptId), runId, actorId, expectedRevision, durationMs: 100 };
}

function communicateAttempt(attemptId: number, expectedRevision: number, actorId: string = maxId,
  audienceHandles: string[] = ['agent-99'], text = '¿Me escuchás?') {
  return {
    kind: 'communicate', attemptId: uuid(attemptId), runId, actorId, expectedRevision,
    channelHandle: 'speech', audienceHandles, content: { kind: 'speech', text },
  };
}

const allCriteria = ['knowledge', 'continuity', 'identity', 'voice', 'periodPlace', 'motivation', 'rhythm', 'authority'] as const;

function registerRun(journal: ReturnType<typeof openJournal>, configuration: Record<string, unknown> = { model: 'test-profile', limit: 1 }) {
  const snapshot = WorldSnapshotSchema.parse(configuration.worldSnapshot ?? worldFixture());
  const readyConfiguration = ReadyRunConfigurationSchema.safeParse(configuration);
  const continuityActorIds = readyConfiguration.success && readyConfiguration.data.roster.activeCharacterIds.length > 0
    ? readyConfiguration.data.roster.activeCharacterIds
    : [maxId, agentId];
  assert.equal(journal.registerWorldRun({
    initialSnapshot: snapshot, configurationRevision: 0,
    configuration,
    continuityFence: {
      kind: 'prepared-contexts', atWorldSeq: 0,
      contexts: continuityActorIds.map((actorId) => ({
        actorId,
        continuityId: readyConfiguration.success ? readyConfiguration.data.continuity.continuityId : 'continuity-main',
        continuityRevision: readyConfiguration.success ? readyConfiguration.data.continuity.revision : 0,
        continuityContentHash: HashSchema.parse(readyConfiguration.success ? readyConfiguration.data.continuity.contentHash : 'b'.repeat(64)),
        identityVersion: readyConfiguration.success
          ? readyConfiguration.data.roster.preparedCharacters.find((prepared) => prepared.characterId === actorId)?.identityVersion ?? 1
          : 1,
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

function grantTestActorKnowledge(journal: ReturnType<typeof openJournal>, actorId: string,
  bindings: unknown[]) {
  const world=journal.loadWorld({runId});
  if(world===undefined)throw new Error('Falta el mundo para actualizar el conocimiento sintético');
  const current=journal.readActorKnowledge({runId,actorId,throughWorldSeq:world.seq});
  if(current===undefined)throw new Error(`Falta ActorKnowledge para ${actorId}`);
  return journal.compareAndSwapActorKnowledge({kind:'actor-knowledge-cas',actorId,runId,
    expectedWorldRevision:world.revision,expectedWorldSeq:world.seq,
    expectedContinuity:{continuityId:'continuity-main',revision:0,contentHash:HashSchema.parse('b'.repeat(64))},
    expectedKnowledgeRevision:current.revision,
    knowledge:ActorKnowledgeSchema.parse({...current.knowledge,bindings:[...current.knowledge.bindings,...bindings]})});
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

test('estructura v29 conserva lo legado y guarda episodios/escenas/actos con CAS e idempotencia', () => {
  withJournal((journal, path) => {
    registerRun(journal);
    const legacy = journal.readDramaticStructure({ runId });
    assert.ok(legacy);
    assert.equal(legacy.structureRevision, 0);
    assert.deepEqual(legacy.episodes, [], 'la migración no inventa episodios para corridas anteriores');
    assert.deepEqual(legacy.unassignedLegacyScenes.map((scene) => scene.id), [sceneId]);
    assert.equal(legacy.unassignedLegacyScenes[0]?.lifecycle.kind, 'open');

    const activeSceneEpisode = journal.applyDramaticStructureCommand({ runId, principalId: dramaticStructurePrincipalId,
      operationId: uuid(728), idempotencyKey: uuid(729), expectedWorldRevision: 0, expectedStructureRevision: 0,
      command: { kind: 'openEpisode', episodeId: uuid(730) } });
    assert.deepEqual(activeSceneEpisode, { kind: 'invalidState', code: 'sceneAlreadyOpen' });

    const closedLegacyScene = journal.applyDramaticStructureCommand({ runId, principalId: dramaticStructurePrincipalId,
      operationId: uuid(730), idempotencyKey: uuid(731), expectedWorldRevision: 0, expectedStructureRevision: 0,
      command: { kind: 'closeScene', sceneId, reason: 'Cierre explícito de la escena heredada.' } });
    assert.equal(closedLegacyScene.kind, 'stored');
    assert.ok(journal.loadWorld({ runId })?.entities.filter((entity) => entity.kind === 'character')
      .every((entity) => entity.presence.kind === 'absent'), 'cerrar la escena libera la presencia de sus participantes');
    assert.deepEqual(journal.readDramaticStructure({ runId })?.episodes, [], 'cerrar una escena legacy tampoco inventa un episodio');

    const openEpisode = {
      runId, principalId: dramaticStructurePrincipalId, operationId: uuid(732), idempotencyKey: uuid(733),
      expectedWorldRevision: 1, expectedStructureRevision: 1,
      command: { kind: 'openEpisode' as const, episodeId: uuid(734), title: 'Primer episodio' },
    };
    const opened = journal.applyDramaticStructureCommand(openEpisode);
    assert.equal(opened.kind, 'stored');
    if (opened.kind !== 'stored') assert.fail('No se abrió el episodio');
    assert.deepEqual(opened.receipt, {
      operationId: uuid(732), worldRevision: 2, worldSeq: 0, structureRevision: 2, commitIndex: 2,
      activeEpisodeId: uuid(734), activeSceneId: null,
    });
    assert.equal(journal.readInspectorWorldCut({ runId, atCommitIndex: 1 })?.snapshot.revision, 1);
    assert.equal(journal.readInspectorWorldCut({ runId, atCommitIndex: 2 })?.snapshot.revision, 2,
      'el selector por commit distingue cambios estructurales con el mismo worldSeq');
    const replay = journal.applyDramaticStructureCommand(openEpisode);
    assert.deepEqual(replay, { ...opened, kind: 'existing' });
    assert.deepEqual(journal.readDramaticStructureOperation({ runId, principalId: dramaticStructurePrincipalId, idempotencyKey: uuid(733) }),
      { kind: 'found', result: { ...opened, kind: 'existing' } });

    const invalidPlaceScene = journal.applyDramaticStructureCommand({ runId, principalId: dramaticStructurePrincipalId,
      operationId: uuid(749), idempotencyKey: uuid(750), expectedWorldRevision: 2, expectedStructureRevision: 2,
      command: { kind: 'openScene', scene: { id: uuid(751), label: 'Lugar inexistente', participantIds: [maxId], placeIds: [roomId, 'lugar-inexistente'] } } });
    assert.deepEqual(invalidPlaceScene, { kind: 'invalidState', code: 'invalidPlaceReference' });
    assert.equal(journal.loadWorld({ runId })?.revision, 2, 'un lugar inválido no debe persistir una mutación parcial');
    assert.equal(journal.readDramaticStructure({ runId })?.activeSceneId, null);

    const newSceneId = uuid(735);
    const openedScene = journal.applyDramaticStructureCommand({ runId, principalId: dramaticStructurePrincipalId,
      operationId: uuid(736), idempotencyKey: uuid(737), expectedWorldRevision: 2, expectedStructureRevision: 2,
      command: { kind: 'openScene', scene: { id: newSceneId, label: 'Nueva escena', participantIds: [maxId, agentId], placeIds: [roomId] } } });
    assert.equal(openedScene.kind, 'stored');

    const firstAct = { actId: uuid(738), title: 'Primer acto', sceneIds: [newSceneId] };
    const setActs = (operationId: number, idempotencyKey: number, expectedWorldRevision: number, expectedStructureRevision: number, title: string) =>
      journal.applyDramaticStructureCommand({ runId, principalId: dramaticStructurePrincipalId, operationId: uuid(operationId),
        idempotencyKey: uuid(idempotencyKey), expectedWorldRevision, expectedStructureRevision,
        command: { kind: 'setEpisodeActs', episodeId: uuid(734), acts: [{ ...firstAct, title }] } });
    assert.equal(setActs(738, 739, 3, 3, firstAct.title).kind, 'stored');
    const firstActCut = journal.readDramaticStructureAtCut({ runId, worldRevision: 4, worldSeq: 0 });
    assert.ok(firstActCut);
    assert.equal(firstActCut.commitIndex, 4);
    assert.equal(firstActCut.structure.episodes[0]?.acts[0]?.title, 'Primer acto');
    assert.equal(setActs(740, 741, 4, 4, 'Acto revisado').kind, 'stored', 'un agrupamiento editorial puede reemplazarse sin alterar la ficción');
    const revisedActCut = journal.readDramaticStructureAtCut({ runId, worldRevision: 5, worldSeq: 0 });
    assert.ok(revisedActCut);
    assert.equal(revisedActCut.structure.episodes[0]?.acts[0]?.title, 'Acto revisado');
    assert.equal(journal.readDramaticStructureEvents({ runId, throughCommitIndex: 4 })?.structureRevision, 4,
      'el registro de cambios se limita al commit histórico solicitado');

    const closedScene = journal.applyDramaticStructureCommand({ runId, principalId: dramaticStructurePrincipalId,
      operationId: uuid(742), idempotencyKey: uuid(743), expectedWorldRevision: 5, expectedStructureRevision: 5,
      command: { kind: 'closeScene', sceneId: newSceneId, reason: 'Cierre sintético de prueba.' } });
    assert.equal(closedScene.kind, 'stored');
    assert.ok(journal.loadWorld({ runId })?.entities.filter((entity) => entity.kind === 'character')
      .every((entity) => entity.presence.kind === 'absent'), 'una escena cerrada no conserva personajes presentes en ella');
    const closedEpisode = journal.applyDramaticStructureCommand({ runId, principalId: dramaticStructurePrincipalId,
      operationId: uuid(744), idempotencyKey: uuid(745), expectedWorldRevision: 6, expectedStructureRevision: 6,
      command: { kind: 'closeEpisode', episodeId: uuid(734), consequenceEventIds: [], openLines: [] } });
    assert.equal(closedEpisode.kind, 'stored');

    const structure = journal.readDramaticStructure({ runId });
    assert.ok(structure);
    assert.equal(structure.structureRevision, 7);
    assert.equal(structure.activeEpisodeId, null);
    assert.equal(structure.activeSceneId, null);
    assert.deepEqual(structure.unassignedLegacyScenes.map((scene) => scene.id), [sceneId]);
    assert.equal(structure.unassignedLegacyScenes[0]?.lifecycle.kind, 'closed');
    assert.equal(structure.episodes.length, 1);
    assert.equal(structure.episodes[0]?.lifecycle, 'closed');
    assert.deepEqual(structure.episodes[0]?.acts.map((act) => act.title), ['Acto revisado']);
    assert.deepEqual(structure.episodes[0]?.sceneIds, [newSceneId]);
    assert.deepEqual(structure.episodes[0]?.openLines, []);
    assert.deepEqual(structure.episodes[0]?.consequenceEventIds, []);
    const finalCut = journal.readDramaticStructureAtCut({ runId, worldRevision: 7, worldSeq: 0 });
    assert.ok(finalCut);
    assert.equal(finalCut.structure.episodes[0]?.lifecycle, 'closed');
    assert.equal(finalCut.structure.unassignedLegacyScenes[0]?.lifecycle.kind, 'closed');
    const events = journal.readDramaticStructureEvents({ runId });
    assert.ok(events);
    assert.deepEqual(events.events.map((event) => event.structureRevision), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(journal.loadWorld({ runId })?.seq, 0, 'estructura editorial/escénica no inventa eventos de ficción');

    const inspect = new DatabaseSync(path);
    try {
      assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM world_events').get()?.count, 0);
      assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM world_perceptions').get()?.count, 0);
      assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM structure_events').get()?.count, 7);
      assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { inspect.close(); }

    journal.close();
    const reopened = openJournal({ path });
    try {
      assert.deepEqual(reopened.readDramaticStructure({ runId }), structure);
      assert.deepEqual(reopened.applyDramaticStructureCommand(openEpisode), { ...opened, kind: 'existing' });
      const replayedEvents = reopened.readDramaticStructureEvents({ runId });
      assert.ok(replayedEvents);
      assert.equal(replayedEvents.events.length, 7);
    } finally { reopened.close(); }
  });
});

test('cerrar escena tras reinicio admite jobs bloqueados de una época anterior y conserva reservas inciertas', async () => {
  const directory=mkdtempSync(join(tmpdir(),'personajes-stale-epoch-close-'));
  const path=join(directory,'world.sqlite');
  let journal=openJournal({path});
  try{
    await createQueuedHumanIntentFixture(journal,['La escena puede cerrarse después de pausar.'],coordinatorConfigurationFixture());
    const begun=journal.beginCoordinatorPulse({runId});
    if(begun.kind!=='started')assert.fail('La intervención debe abrir un pulso actoral');
    const job=begun.jobs.find((item)=>item.actorId===maxId);
    if(job===undefined)assert.fail('Falta el job actoral de Max');
    if(job.lifecycleRevision===null)assert.fail('El job nuevo debe llevar su época de autoridad');
    const lease={ownerToken:uuid(39_100),claimToken:uuid(39_101)};
    const claim=journal.claimActorTurnJob({runId,actorId:maxId,jobId:job.jobId,generation:job.generation,...lease});
    if(claim.kind!=='claimed')assert.fail('El job debe quedar en ejecución antes de pausar');

    const clockEpochId=uuid(39_102),ownerToken=uuid(39_103);
    const reservation=journal.reserveNextRequest({runId,pulseId:job.pulseId,jobId:job.jobId,generation:job.generation,clockEpochId,ownerToken});
    if(reservation.kind!=='reserved')assert.fail('La reserva de prueba debe quedar registrada');
    journal.transitionReservation({jobId:job.jobId,generation:job.generation,requestSeq:reservation.requestSeq,target:'dispatched',ownerToken,
      wallTime:{clockEpochId,monotonicNs:'0'}});
    journal.transitionReservation({jobId:job.jobId,generation:job.generation,requestSeq:reservation.requestSeq,target:'ambiguous',ownerToken,
      wallTime:{clockEpochId,monotonicNs:'1000000'}});

    const beforePause=journal.readWorldLifecycle({runId});
    assert.ok(beforePause);
    assert.equal(journal.setWorldLifecycle({runId,expectedWorldRevision:beforePause.worldRevision,
      expectedConfigRevision:beforePause.configRevision,target:'paused'}),'updated');
    const paused=journal.readWorldLifecycle({runId});
    assert.ok(paused);
    assert.equal(paused.lifecycle,'paused');
    assert.ok(paused.lifecycleRevision>job.lifecycleRevision);
    journal.close();journal=openJournal({path});

    const structure=journal.readDramaticStructure({runId});
    assert.ok(structure);
    const closed=journal.applyDramaticStructureCommand({runId,principalId:dramaticStructurePrincipalId,
      operationId:uuid(39_104),idempotencyKey:uuid(39_105),expectedWorldRevision:paused.worldRevision,
      expectedStructureRevision:structure.structureRevision,
      command:{kind:'closeScene',sceneId,reason:'Cierre estructural después de detener la época actoral anterior.'}});
    assert.equal(closed.kind,'stored','el job bloqueado de una época anterior ya no puede cortar el Escenario');
    assert.equal(journal.loadWorld({runId})?.activeSceneId,null);

    const inspect=new DatabaseSync(path);
    try{
      const storedJob=inspect.prepare('SELECT state,lifecycle_revision FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?')
        .get(runId,maxId,job.jobId,job.generation) as {state:string;lifecycle_revision:number}|undefined;
      assert.equal(storedJob?.state,'blocked','el cierre conserva el job viejo');
      assert.equal(storedJob?.lifecycle_revision,job.lifecycleRevision,'el cierre no actualiza la época del job viejo');
      const storedReservation=inspect.prepare('SELECT state FROM request_reservations WHERE job_id=? AND generation=? AND request_seq=?')
        .get(job.jobId,job.generation,reservation.requestSeq) as {state:string}|undefined;
      assert.equal(storedReservation?.state,'ambiguous','la incertidumbre de transporte permanece intacta para los guards de reanudación');
    }finally{inspect.close();}
  }finally{
    try{journal.close();}catch{/* Puede haberse cerrado al simular el reinicio. */}
    rmSync(directory,{recursive:true,force:true});
  }
});

test('cerrar escena sigue bloqueado por jobs queued, running o blocked de la época vigente', async () => {
  for(const status of ['queued','running','blocked'] as const){
    const directory=mkdtempSync(join(tmpdir(),`personajes-current-${status}-close-`));
    const path=join(directory,'world.sqlite');
    const journal=openJournal({path});
    try{
      await createQueuedHumanIntentFixture(journal,[`Prueba de job ${status}.`],coordinatorConfigurationFixture());
      const begun=journal.beginCoordinatorPulse({runId});
      if(begun.kind!=='started')assert.fail(`La intervención debe abrir un pulso para ${status}`);
      const job=begun.jobs.find((item)=>item.actorId===maxId);
      if(job===undefined)assert.fail(`Falta el job actoral ${status}`);
      if(status!=='queued'){
        const lease={ownerToken:uuid(status==='running'?39_110:39_120),claimToken:uuid(status==='running'?39_111:39_121)};
        const claim=journal.claimActorTurnJob({runId,actorId:maxId,jobId:job.jobId,generation:job.generation,...lease});
        if(claim.kind!=='claimed')assert.fail(`No se pudo reclamar el job ${status}`);
        if(status==='blocked'){
          const failed=journal.failActorTurnJob({execution:{runId,actorId:maxId,jobId:job.jobId,generation:job.generation,
            pulseId:job.pulseId,lease},code:'execution-failed'});
          assert.equal(failed.kind,'blocked');
        }
      }
      const lifecycle=journal.readWorldLifecycle({runId});
      const structure=journal.readDramaticStructure({runId});
      assert.ok(lifecycle);assert.ok(structure);
      const result=journal.applyDramaticStructureCommand({runId,principalId:dramaticStructurePrincipalId,
        operationId:uuid(status==='queued'?39_112:status==='running'?39_113:39_114),
        idempotencyKey:uuid(status==='queued'?39_115:status==='running'?39_116:39_117),
        expectedWorldRevision:lifecycle.worldRevision,expectedStructureRevision:structure.structureRevision,
        command:{kind:'closeScene',sceneId,reason:`El job ${status} conserva autoridad en la época actual.`}});
      assert.deepEqual(result,{kind:'invalidState',code:'actorJobsActive'},`${status} vigente debe impedir el corte estructural`);
      assert.equal(journal.loadWorld({runId})?.activeSceneId,sceneId);
    }finally{
      try{journal.close();}catch{/* Limpieza si falló una aserción. */}
      rmSync(directory,{recursive:true,force:true});
    }
  }
});

test('start abre episodio 1 y asocia la escena configurada en la misma transición durable', async () => {
  const prepared = await setupContinuistaFixture();
  const directory = mkdtempSync(join(tmpdir(), 'personajes-dramatic-start-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  try {
    const activationActorId=prepared.configuration.roster.activeCharacterIds[0];
    assert.ok(activationActorId);
    const activationConfiguration={...prepared.configuration,worldSnapshot:WorldSnapshotSchema.parse({
      ...prepared.configuration.worldSnapshot,
      entities:prepared.configuration.worldSnapshot.entities.map((entity)=>entity.kind==='character'&&entity.characterId===activationActorId
        ?{...entity,mind:{...entity.mind,goals:[{kind:'durable',id:GoalIdSchema.parse(uuid(749)),description:'Seguir un objetivo propio.',priority:0.7,state:'active',revision:0,history:[]}]}}
        :entity),
    })};
    const created = journal.createRunConfigurationDraft({ principalId: dramaticStructurePrincipalId,
      idempotencyKey: uuid(750), patch: draftPatchFromReadyConfiguration(activationConfiguration) });
    assert.equal(created.kind, 'created');
    if (created.kind !== 'created') assert.fail('No se creó el borrador Ready sintético');
    const promoted = journal.validateRunConfigurationDraft({ principalId: dramaticStructurePrincipalId,
      idempotencyKey: uuid(751), runId: created.draft.runId, expectedRevision: created.draft.revision });
    assert.equal(promoted.kind, 'ready');
    if (promoted.kind !== 'ready') assert.fail('No se promovió el escenario a Ready');
    const initial = journal.readWorldLifecycle({ runId: created.draft.runId });
    assert.ok(initial);
    const structureBeforeStart = journal.readDramaticStructure({ runId: created.draft.runId });
    assert.ok(structureBeforeStart);
    assert.deepEqual(structureBeforeStart.episodes, []);
    assert.deepEqual(structureBeforeStart.unassignedLegacyScenes.map((scene) => scene.id), [activationConfiguration.worldSnapshot.activeSceneId]);

    const preflight = journal.createRunPreflightJob({ principalId: dramaticStructurePrincipalId, idempotencyKey: uuid(752),
      runId: created.draft.runId, expectedConfigurationRevision: initial.configRevision, expectedWorldRevision: initial.worldRevision });
    assert.equal(preflight.kind, 'created');
    if (preflight.kind !== 'created') assert.fail('No se creó el preflight de inicio');
    const lease = { ownerToken: uuid(753), claimToken: uuid(754) };
    const claimed = journal.claimRunPreflightJob({ runId: created.draft.runId, jobId: preflight.job.jobId, expectedRevision: 0, ...lease });
    assert.equal(claimed.kind, 'claimed');
    if (claimed.kind !== 'claimed') assert.fail('No se reclamó el preflight de inicio');
    const frozen = journal.readRunPreflightJobInput({ runId: created.draft.runId, jobId: preflight.job.jobId, lease });
    assert.equal(frozen.kind, 'found');
    if (frozen.kind !== 'found') assert.fail('No se congeló el corte Ready');

    const access = journal.createPiAccessJob({ principalId: dramaticStructurePrincipalId, idempotencyKey: uuid(755), profile: DEFAULT_INFERENCE_PROFILE });
    assert.equal(access.kind, 'created');
    if (access.kind !== 'created') assert.fail('No se creó la comprobación sintética de acceso');
    const accessLease = { ownerToken: uuid(756), claimToken: uuid(757) };
    const accessClaim = journal.claimPiAccessJob({ jobId: access.job.jobId, expectedRevision: 0, ...accessLease });
    assert.equal(accessClaim.kind, 'claimed');
    if (accessClaim.kind !== 'claimed') assert.fail('No se reclamó la comprobación sintética de acceso');
    const checkedAt = new Date(Date.now() - 2_000).toISOString();
    const expiresAt = new Date(Date.now() + 120_000).toISOString();
    const profileFingerprint = fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE);
    const accountFingerprint = 'a'.repeat(64);
    const accessResult = {
      provider: DEFAULT_INFERENCE_PROFILE.provider, requestedProfile: DEFAULT_INFERENCE_PROFILE,
      profileFingerprint, accountFingerprint, kind: 'passed' as const,
      effectiveProfile: { provider: DEFAULT_INFERENCE_PROFILE.provider, api: DEFAULT_INFERENCE_PROFILE.api,
        model: DEFAULT_INFERENCE_PROFILE.model, providerThinkingLevel: DEFAULT_INFERENCE_PROFILE.reasoningEffort,
        reasoningEvidence: 'sdk-payload-and-response' as const },
      measuredUsage: { input: 19, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 20 },
    };
    const accessCompleted = journal.completePiAccessJob({ jobId: access.job.jobId, expectedRevision: accessClaim.job.revision,
      lease: accessLease, result: accessResult, checkedAt, expiresAt });
    assert.equal(accessCompleted.kind, 'updated');
    const accessReceipt = { jobId: access.job.jobId, provider: DEFAULT_INFERENCE_PROFILE.provider, profileFingerprint,
      accountFingerprint, resultKind: 'passed' as const, checkedAt, expiresAt };
    const checkIds = ['configuration', 'configuration-version', 'world-snapshot', 'prepared-contexts', 'catalog-eligibility',
      'inference-profile', 'pi-sdk', 'pi-profile', 'provider-authentication', 'pi-runtime', 'icm-memory', 'budget',
      'provider-access-check', 'participant-availability', 'voice'] as const;
    const evaluatedAt = new Date().toISOString();
    const completed = journal.completeRunPreflightJob({ runId: created.draft.runId, jobId: preflight.job.jobId,
      expectedRevision: claimed.job.revision, lease, evaluation: {
        fence: frozen.fence,
        result: { kind: 'passed', checkedAt: evaluatedAt, checks: checkIds.map((checkId) => ({ kind: 'passed' as const, checkId, code: `${checkId}-passed` })) },
        evidence: { provider: DEFAULT_INFERENCE_PROFILE.provider, profileFingerprint, accountFingerprint, accessReceipt },
      } });
    assert.equal(completed.kind, 'updated');
    const command = { principalId: dramaticStructurePrincipalId, idempotencyKey: uuid(758), runId: created.draft.runId,
      expectedLifecycleRevision: initial.lifecycleRevision, expectedConfigRevision: initial.configRevision,
      expectedWorldRevision: initial.worldRevision, command: { kind: 'start' as const }, preflightJobId: preflight.job.jobId };
    const started = journal.applyRunLifecycleCommand(command);
    assert.equal(started.kind, 'updated');
    if (started.kind !== 'updated') assert.fail('La representación no inició');
    assert.equal(started.state.lifecycle, 'running');
    assert.equal(started.state.worldRevision, initial.worldRevision + 1);
    const structure = journal.readDramaticStructure({ runId: created.draft.runId });
    assert.ok(structure);
    assert.equal(structure.structureRevision, 1);
    assert.equal(structure.episodes.length, 1);
    assert.equal(structure.episodes[0]?.ordinal, 1);
    assert.equal(structure.episodes[0]?.lifecycle, 'open');
    assert.deepEqual(structure.episodes[0]?.sceneIds, [activationConfiguration.worldSnapshot.activeSceneId]);
    assert.equal(structure.activeSceneId, activationConfiguration.worldSnapshot.activeSceneId);
    assert.equal(structure.activeEpisodeId, structure.episodes[0]?.episodeId);
    assert.equal(journal.loadWorld({ runId: created.draft.runId })?.seq, activationConfiguration.worldSnapshot.seq,
      'abrir el episodio no agrega eventos de ficción ni altera el reloj');
    const runId=created.draft.runId;
    assert.deepEqual(journal.listCoordinatorPulseTargets().map((target)=>target.runId),[runId],
      'la invitación durable creada por start deja una recuperación técnica autorizada pendiente');
    assert.equal(journal.setWorldLifecycle({runId,expectedWorldRevision:started.state.worldRevision,
      expectedConfigRevision:started.state.configRevision,target:'paused'}),'updated');
    const paused=journal.readWorldLifecycle({runId});assert.ok(paused);
    assert.equal(journal.setWorldLifecycle({runId,expectedWorldRevision:paused.worldRevision,
      expectedConfigRevision:paused.configRevision,target:'running'}),'updated');
    const resumed=journal.readWorldLifecycle({runId});assert.ok(resumed);
    const beforePulseWorld=journal.loadWorld({runId});assert.ok(beforePulseWorld);
    const beforePulseDb=new DatabaseSync(path);
    let commitCount:number;let perceptionCount:number;let invitationCount:number;
    try{
      commitCount=Number(beforePulseDb.prepare('SELECT COUNT(*) AS count FROM world_commits WHERE run_id=?').get(runId)?.count);
      perceptionCount=Number(beforePulseDb.prepare('SELECT COUNT(*) AS count FROM world_perceptions WHERE run_id=?').get(runId)?.count);
      invitationCount=Number(beforePulseDb.prepare('SELECT COUNT(*) AS count FROM actor_activation_invitations WHERE activation_id=(SELECT activation_id FROM actor_activation_causes WHERE run_id=?)').get(runId)?.count);
    }finally{beforePulseDb.close();}
    assert.equal(invitationCount,1);
    const begun=journal.beginCoordinatorPulse({runId});
    assert.equal(begun.kind,'started');if(begun.kind!=='started')assert.fail('No inició convocatoria técnica');
    assert.equal(begun.pulse.cause.kind,'actorActivation');
    assert.deepEqual(begun.pulse.cause.trigger,{kind:'initial-goal'});
    assert.equal(begun.pulse.lifecycleRevision,resumed.lifecycleRevision,'el pulso captura la época vigente tras pause/resume');
    assert.equal(begun.jobs.length,1);
    const activationJob=begun.jobs[0];assert.ok(activationJob);
    assert.equal(activationJob.activation?.trigger.kind,'initial-goal');
    assert.deepEqual(activationJob.perceptionIds,[],'la invitación no se convierte en percepción');
    assert.deepEqual(journal.loadWorld({runId}),beforePulseWorld,'admitir el job no muta el Escenario');
    const replayedBegin=journal.beginCoordinatorPulse({runId});
    assert.equal(replayedBegin.kind,'existing');
    if(replayedBegin.kind==='existing')assert.equal(replayedBegin.pulse.pulseId,begun.pulse.pulseId);
    const firstLease={ownerToken:uuid(760),claimToken:uuid(761)};
    const firstClaim=journal.claimActorTurnJob({runId,actorId:activationJob.actorId,jobId:activationJob.jobId,generation:0,...firstLease});
    assert.equal(firstClaim.kind,'claimed');if(firstClaim.kind!=='claimed')assert.fail('No reclamó el job técnico');
    journal.close();journal=openJournal({path});
    assert.equal(journal.recoverAbandonedActorTurnJobClaims({ownerToken:uuid(762)}),1);
    const recoveredPulse=journal.readCoordinatorPulse({runId,pulseId:begun.pulse.pulseId});
    assert.equal(recoveredPulse?.state,'running');
    assert.equal(recoveredPulse?.jobs[0]?.activation?.activationId,activationJob.activation?.activationId);
    const recovered=journal.beginCoordinatorPulse({runId});
    assert.equal(recovered.kind,'existing');
    const secondClaim=journal.claimActorTurnJob({runId,actorId:activationJob.actorId,jobId:activationJob.jobId,generation:0,
      ownerToken:uuid(763),claimToken:uuid(764)});
    assert.equal(secondClaim.kind,'claimed');if(secondClaim.kind!=='claimed')assert.fail('No se recuperó el claim técnico');
    assert.deepEqual(secondClaim.job.perceptionIds,[]);
    const failed=journal.failActorTurnJob({execution:{runId,actorId:activationJob.actorId,jobId:activationJob.jobId,
      generation:0,pulseId:begun.pulse.pulseId,lease:{ownerToken:uuid(763),claimToken:uuid(764)}},code:'execution-failed'});
    assert.equal(failed.kind,'blocked');
    const terminal=journal.closeCoordinatorPulse({runId,pulseId:begun.pulse.pulseId});
    assert.equal(terminal.state,'blocked');
    const afterPulseDb=new DatabaseSync(path);
    try{
      assert.equal(Number(afterPulseDb.prepare('SELECT COUNT(*) AS count FROM world_commits WHERE run_id=?').get(runId)?.count),commitCount);
      assert.equal(Number(afterPulseDb.prepare('SELECT COUNT(*) AS count FROM world_perceptions WHERE run_id=?').get(runId)?.count),perceptionCount);
      assert.equal(Number(afterPulseDb.prepare('SELECT COUNT(*) AS count FROM actor_activation_invitations WHERE activation_id=(SELECT activation_id FROM actor_activation_causes WHERE run_id=?)').get(runId)?.count),invitationCount);
      assert.equal(afterPulseDb.prepare('SELECT state FROM actor_activation_invitations WHERE activation_id=(SELECT activation_id FROM actor_activation_causes WHERE run_id=?)').get(runId)?.state,'blocked');
      assert.equal(afterPulseDb.prepare('SELECT state FROM actor_activation_causes WHERE run_id=?').get(runId)?.state,'blocked');
    }finally{afterPulseDb.close();}
    assert.deepEqual(journal.closeCoordinatorPulse({runId,pulseId:begun.pulse.pulseId}),terminal,
      'replay de cierre devuelve el estado terminal sin reabrir ni duplicar la invitación');
    const staleStructureControl = journal.applyRunLifecycleCommand({ principalId: dramaticStructurePrincipalId, idempotencyKey: uuid(759), runId: created.draft.runId,
      expectedLifecycleRevision: started.state.lifecycleRevision, expectedConfigRevision: started.state.configRevision,
      expectedWorldRevision: started.state.worldRevision, expectedStructureRevision: 0, command: { kind: 'pause' } });
    assert.equal(staleStructureControl.kind, 'stale', 'el CAS de lifecycle también incluye la revisión estructural');
    assert.equal(journal.readWorldLifecycle({ runId: created.draft.runId })?.lifecycle, 'running');
    assert.deepEqual(journal.applyRunLifecycleCommand(command), { kind: 'updated', state: started.state });
    const startEvents = journal.readDramaticStructureEvents({ runId: created.draft.runId });
    assert.ok(startEvents);
    assert.equal(startEvents.events.length, 1,
      'reintentar start no duplica el episodio');
  } finally {
    try { journal.close(); } catch { /* El caso puede haber cerrado el journal al simular un reinicio. */ }
    prepared.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

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

test('metaindicaciones se versionan aparte del mundo y el actor conserva el corte al recuperar', async () => {
  const directory=mkdtempSync(join(tmpdir(),'personajes-direction-ledger-'));
  const path=join(directory,'world.sqlite');
  let journal=openJournal({path});
  try{
    await createQueuedHumanIntentFixture(journal,['Activar turno para probar Dirección.']);
    const worldBefore=journal.loadWorld({runId});
    if(worldBefore===undefined)assert.fail('Falta el Escenario');
    const firstCommand={runId,principalId:'director-test',operationId:uuid(9_800),idempotencyKey:uuid(9_801),
      expectedDirectionRevision:0,payload:{kind:'metaIndication',recipients:[maxId],text:'Mantén una reserva antes de confiar en el informe.',scope:{kind:'scene',sceneId}}};
    const indication=journal.applyDirectionCommand(firstCommand);
    assert.equal(indication.kind,'stored');
    assert.equal(journal.applyDirectionCommand(firstCommand).kind,'existing','el retry exacto devuelve el receipt durable sin incrementar revisión');
    assert.deepEqual(journal.loadWorld({runId}),worldBefore,'Dirección no crea un hecho, percepción ni revisión del Escenario');
    journal.configureRun({runId,maxCalls:5});
    const pulseId=PulseIdSchema.parse(uuid(9_802));journal.configurePulse({runId,pulseId,maxCalls:2});
    const scheduled=journal.scheduleActorTurnJob({runId,actorId:maxId,pulseId});
    if(scheduled.kind!=='scheduled')assert.fail('No se programó el turno actoral');
    const claim=journal.claimActorTurnJob({runId,actorId:maxId,jobId:scheduled.job.jobId,generation:scheduled.job.generation,
      ownerToken:uuid(9_803),claimToken:uuid(9_804)});
    if(claim.kind!=='claimed')assert.fail('No se congeló el turno actoral');
    assert.equal(claim.job.frozenDirectionRevision,1);
    assert.equal(claim.job.frozenWorldCut?.activeSceneId,sceneId);
    const visible=journal.readActorMetaIndications({runId,actorId:maxId,directionRevision:claim.job.frozenDirectionRevision!,activeSceneId:sceneId});
    assert.equal(visible.indications.length,1);
    assert.equal(visible.indications[0]?.text,'Mantén una reserva antes de confiar en el informe.');
    assert.equal(journal.readActorMetaIndications({runId,actorId:agentId,directionRevision:1,activeSceneId:sceneId}).indications.length,0,
      'el destinatario no recibe indicaciones dirigidas a otro actor');
    assert.equal(journal.readActorMetaIndications({runId,actorId:maxId,directionRevision:1,activeSceneId:uuid(9_807)}).indications.length,0,
      'la indicación de escena vence fuera del alcance de esa escena');
    const late=journal.applyDirectionCommand({runId,principalId:'director-test',operationId:uuid(9_805),idempotencyKey:uuid(9_806),
      expectedDirectionRevision:1,payload:{kind:'metaIndication',recipients:[maxId],text:'Pregunta por el origen del informe.',scope:{kind:'run'}}});
    assert.equal(late.kind,'stored');
    assert.equal(journal.readActorMetaIndications({runId,actorId:maxId,directionRevision:claim.job.frozenDirectionRevision!,activeSceneId:sceneId}).indications.length,1,
      'una indicación posterior al claim no cambia una sesión actoral ya iniciada');
    journal.close();
    journal=openJournal({path});
    const page=journal.readDirectionEvents({runId,afterDirectionRevision:0,limit:10});
    assert.equal(page?.events.length,2);
    assert.equal(page?.directionRevision,2);
    assert.equal(journal.readActorMetaIndications({runId,actorId:maxId,directionRevision:1,activeSceneId:sceneId}).indications.length,1,
      'el ledger y el corte sobreviven al reinicio');
  }finally{
    try{journal.close();}catch{/* La prueba pudo cerrar el journal antes del reinicio. */}
    rmSync(directory,{recursive:true,force:true});
  }
});

test('revocar Dirección conserva la historia, el corte actoral y el mundo al reabrir', async () => {
  const directory=mkdtempSync(join(tmpdir(),'personajes-direction-revoke-'));
  const path=join(directory,'world.sqlite');
  let journal=openJournal({path});
  try{
    await createQueuedHumanIntentFixture(journal,['Activar el corte de Dirección.']);
    const worldBefore=journal.loadWorld({runId});
    if(worldBefore===undefined)assert.fail('Falta el Escenario de prueba');
    const eventsBefore=journal.readObservationEvents({runId,fromWorldSeq:0,toWorldSeq:worldBefore.seq,afterWorldSeq:null,limit:100,communicationsOnly:false});
    const readPerceptions=()=>{
      const database=new DatabaseSync(path);
      try{return database.prepare('SELECT * FROM world_perceptions WHERE run_id=? ORDER BY perception_id').all(runId);}
      finally{database.close();}
    };
    const perceptionsBefore=readPerceptions();
    const indication={runId,principalId:'director-test',operationId:uuid(9_820),idempotencyKey:uuid(9_821),
      expectedDirectionRevision:0,payload:{kind:'metaIndication',recipients:[maxId],text:'Conservá la reserva.',scope:{kind:'scene',sceneId}}};
    assert.equal(journal.applyDirectionCommand(indication).kind,'stored');
    journal.configureRun({runId,maxCalls:5});
    const pulseId=PulseIdSchema.parse(uuid(9_822));journal.configurePulse({runId,pulseId,maxCalls:2});
    const scheduled=journal.scheduleActorTurnJob({runId,actorId:maxId,pulseId});
    if(scheduled.kind!=='scheduled')assert.fail('Falta turno para congelar Dirección');
    const claim=journal.claimActorTurnJob({runId,actorId:maxId,jobId:scheduled.job.jobId,generation:scheduled.job.generation,
      ownerToken:uuid(9_823),claimToken:uuid(9_824)});
    if(claim.kind!=='claimed'||claim.job.frozenDirectionRevision===null)assert.fail('Falta corte congelado');
    const frozenRevision=claim.job.frozenDirectionRevision;
    const revoke={runId,principalId:'director-test',operationId:uuid(9_825),idempotencyKey:uuid(9_826),
      expectedDirectionRevision:1,payload:{kind:'revokeMetaIndication',targetOperationId:indication.operationId,scope:{kind:'scene',sceneId}}};
    const stored=journal.applyDirectionCommand(revoke);
    assert.equal(stored.kind,'stored');
    assert.deepEqual(journal.applyDirectionCommand(revoke),stored.kind==='stored'?{...stored,kind:'existing'}:stored);
    assert.equal(journal.readActorMetaIndications({runId,actorId:maxId,directionRevision:frozenRevision,activeSceneId:sceneId}).indications.length,1);
    assert.equal(journal.readActorMetaIndications({runId,actorId:maxId,directionRevision:2,activeSceneId:sceneId}).indications.length,0);
    assert.deepEqual(readPerceptions(),perceptionsBefore);
    assert.deepEqual(journal.loadWorld({runId}),worldBefore);
    assert.deepEqual(journal.readObservationEvents({runId,fromWorldSeq:0,toWorldSeq:worldBefore.seq,afterWorldSeq:null,limit:100,communicationsOnly:false}),eventsBefore);
    assert.deepEqual(readPerceptions(),perceptionsBefore,'revocar no cambia ni agrega percepciones');
    const page=journal.readDirectionEvents({runId,afterDirectionRevision:0,limit:1});
    assert.equal(page?.hasMore,true);
    assert.equal(page?.events[0]?.payload.kind,'metaIndication');
    assert.equal(journal.readDirectionEvents({runId,afterDirectionRevision:1,limit:1})?.events[0]?.payload.kind,'revokeMetaIndication');
    journal.close();journal=openJournal({path});
    assert.deepEqual(journal.readDirectionOperation({runId,principalId:revoke.principalId,idempotencyKey:revoke.idempotencyKey}),{kind:'found',result:stored});
    assert.equal(journal.applyDirectionCommand(revoke).kind,'existing');
    assert.equal(journal.readActorMetaIndications({runId,actorId:maxId,directionRevision:frozenRevision,activeSceneId:sceneId}).indications.length,1);
    assert.equal(journal.readActorMetaIndications({runId,actorId:maxId,directionRevision:2,activeSceneId:sceneId}).indications.length,0);
    assert.deepEqual(readPerceptions(),perceptionsBefore);
    assert.deepEqual(journal.loadWorld({runId}),worldBefore);
    assert.deepEqual(journal.readObservationEvents({runId,fromWorldSeq:0,toWorldSeq:worldBefore.seq,afterWorldSeq:null,limit:100,communicationsOnly:false}),eventsBefore);
  }finally{
    try{journal.close();}catch{/* Puede estar cerrado por el reinicio. */}
    rmSync(directory,{recursive:true,force:true});
  }
});

test('Dirección lee y revoca una fila legada de hasta 4000 caracteres aunque supere el límite UTF-8 nuevo', () => {
  const directory=mkdtempSync(join(tmpdir(),'personajes-direction-legacy-text-'));
  const path=join(directory,'world.sqlite');
  let journal=openJournal({path});
  try{
    registerRun(journal);
    const worldBefore=journal.loadWorld({runId});
    const targetOperationId=uuid(9_880);
    const text='á'.repeat(2_001);
    const payload={kind:'metaIndication',recipients:[maxId],text,scope:{kind:'run'}};
    const payloadJson=canonicalJson(payload);
    // Explicit prior-version database fixture. The old contract admitted 4000
    // characters; this is not a newly submitted command under today's byte limit.
    const database=new DatabaseSync(path);
    try{
      const cut=z.strictObject({world_revision:z.number(),last_seq:z.number(),commit_index:z.number()})
        .parse(database.prepare('SELECT world_revision,last_seq,commit_index FROM world_runs WHERE run_id=?').get(runId));
      database.exec('BEGIN IMMEDIATE');
      database.prepare(`INSERT INTO direction_events(run_id,direction_revision,operation_id,principal_id,payload_json,payload_hash,
        world_revision,world_seq,commit_index,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .run(runId,1,targetOperationId,'legacy-fixture',payloadJson,sha256(payloadJson),cut.world_revision,cut.last_seq,cut.commit_index,100);
      database.prepare('UPDATE world_runs SET direction_revision=1 WHERE run_id=?').run(runId);
      database.exec('COMMIT');
    }finally{database.close();}
    journal.close();journal=openJournal({path});
    const page=journal.readDirectionEvents({runId});
    assert.equal(page?.directionRevision,1);
    assert.deepEqual(page?.events[0]?.payload,payload,'reabrir conserva el texto histórico exacto y su hash');
    assert.equal(journal.readActorMetaIndications({runId,actorId:maxId,directionRevision:1,activeSceneId:sceneId}).indications[0]?.text,text);
    const revoke={runId,principalId:'director-test',operationId:uuid(9_881),idempotencyKey:uuid(9_882),expectedDirectionRevision:1,
      payload:{kind:'revokeMetaIndication',targetOperationId,scope:{kind:'run'}}};
    assert.equal(journal.applyDirectionCommand(revoke).kind,'stored');
    assert.equal(journal.readActorMetaIndications({runId,actorId:maxId,directionRevision:2,activeSceneId:sceneId}).indications.length,0);
    journal.close();journal=openJournal({path});
    assert.equal(journal.applyDirectionCommand(revoke).kind,'existing');
    assert.equal(journal.readDirectionEvents({runId})?.events.length,2);
    assert.equal(journal.readActorMetaIndications({runId,actorId:maxId,directionRevision:1,activeSceneId:sceneId}).indications[0]?.text,text,
      'la revocación y el nuevo límite no reescriben el corte anterior');
    assert.equal(journal.readActorMetaIndications({runId,actorId:maxId,directionRevision:2,activeSceneId:sceneId}).indications.length,0);
    assert.deepEqual(journal.loadWorld({runId}),worldBefore);
  }finally{
    try{journal.close();}catch{/* Puede estar cerrado por el reinicio. */}
    rmSync(directory,{recursive:true,force:true});
  }
});

test('revocación rechaza alcance distinto, referencias ausentes, doble revocación y CAS obsoleto sin eventos', () => {
  withJournal((journal)=>{
    registerRun(journal);
    const targetOperationId=uuid(9_840);
    assert.equal(journal.applyDirectionCommand({runId,principalId:'director-test',operationId:targetOperationId,idempotencyKey:uuid(9_841),
      expectedDirectionRevision:0,payload:{kind:'metaIndication',recipients:[maxId],text:'Reserva.',scope:{kind:'run'}}}).kind,'stored');
    const otherRunId=RunIdSchema.parse(uuid(9_860));
    const otherSnapshot=WorldSnapshotSchema.parse(JSON.parse(JSON.stringify(worldFixture()).replaceAll(runId,otherRunId)));
    assert.equal(journal.registerWorldRun({initialSnapshot:otherSnapshot,configurationRevision:0,configuration:{model:'test-profile',limit:1},
      continuityFence:{kind:'prepared-contexts',atWorldSeq:0,contexts:[maxId,agentId].map((actorId)=>({actorId,
        continuityId:'continuity-main',continuityRevision:0,continuityContentHash:'b'.repeat(64),identityVersion:1,preparedContextHash:'a'.repeat(64)}))},lifecycle:'ready'}),'stored');
    const otherTarget=uuid(9_861);
    assert.equal(journal.applyDirectionCommand({runId:otherRunId,principalId:'director-test',operationId:otherTarget,idempotencyKey:uuid(9_862),
      expectedDirectionRevision:0,payload:{kind:'metaIndication',recipients:[maxId],text:'Sólo otra representación.',scope:{kind:'run'}}}).kind,'stored');
    const worldBefore=journal.loadWorld({runId});
    const revoke=(n:number,target:string,scope:unknown,expectedDirectionRevision=1)=>({runId,principalId:'director-test',
      operationId:uuid(n),idempotencyKey:uuid(n+1),expectedDirectionRevision,
      payload:{kind:'revokeMetaIndication',targetOperationId:target,scope}});
    const absent=revoke(9_842,uuid(999_999),{kind:'run'});
    assert.deepEqual(journal.applyDirectionCommand(absent),{kind:'invalidState',code:'directionNotFound'});
    assert.deepEqual(journal.applyDirectionCommand(absent),{kind:'invalidState',code:'directionNotFound'});
    const mismatch=revoke(9_844,targetOperationId,{kind:'scene',sceneId});
    assert.deepEqual(journal.applyDirectionCommand(mismatch),{kind:'invalidState',code:'directionScopeMismatch'});
    assert.deepEqual(journal.applyDirectionCommand(revoke(9_846,targetOperationId,{kind:'run'},0)),{kind:'conflict',directionRevision:1});
    assert.deepEqual(journal.applyDirectionCommand(revoke(9_864,otherTarget,{kind:'run'})),{kind:'invalidState',code:'directionNotFound'},'no puede revocar en otra representación');
    assert.equal(journal.readDirectionEvents({runId})?.events.length,1);
    const valid=revoke(9_848,targetOperationId,{kind:'run'});
    assert.equal(journal.applyDirectionCommand(valid).kind,'stored');
    assert.deepEqual(journal.applyDirectionCommand(revoke(9_850,targetOperationId,{kind:'run'},2)),{kind:'invalidState',code:'directionAlreadyRevoked'});
    assert.deepEqual(journal.applyDirectionCommand(revoke(9_852,valid.operationId,{kind:'run'},2)),{kind:'invalidState',code:'directionNotFound'},'no se revoca una revocación');
    assert.deepEqual(journal.applyDirectionCommand({...valid,payload:{...valid.payload,targetOperationId:uuid(999_998)}}),{kind:'idempotencyConflict'});
    assert.equal(journal.readDirectionEvents({runId})?.events.length,2);
    assert.equal(journal.readDirectionEvents({runId})?.directionRevision,2);
    assert.deepEqual(journal.loadWorld({runId}),worldBefore);
    const sceneTarget=uuid(9_866);
    assert.equal(journal.applyDirectionCommand({runId,principalId:'director-test',operationId:sceneTarget,idempotencyKey:uuid(9_867),
      expectedDirectionRevision:2,payload:{kind:'metaIndication',recipients:[maxId],text:'Sólo esta escena.',scope:{kind:'scene',sceneId}}}).kind,'stored');
    assert.deepEqual(journal.applyDirectionCommand(revoke(9_868,sceneTarget,{kind:'run'},3)),{kind:'invalidState',code:'directionScopeMismatch'});
    assert.deepEqual(journal.applyDirectionCommand(revoke(9_870,sceneTarget,{kind:'scene',sceneId:uuid(9_872)},3)),{kind:'invalidState',code:'directionScopeMismatch'});
    assert.equal(journal.readDirectionEvents({runId})?.directionRevision,3);
    assert.equal(journal.readActorMetaIndications({runId,actorId:maxId,directionRevision:3,activeSceneId:sceneId}).indications.length,1);
  });
});

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
      downgradeCoordinatorPulsesTo44(beforeV9); beforeV9.exec('DROP TABLE preparation_configurator_records; DROP TABLE preparation_configurator_operations; DROP TABLE preparation_configurator_jobs; DROP TABLE model_budget_authorities; DROP TRIGGER icm_context_packets_no_update; DROP TRIGGER icm_context_packets_no_delete; DROP TABLE icm_context_packets; DROP INDEX coordinator_pulses_parked_for; ALTER TABLE coordinator_pulses DROP COLUMN parked_for_pulse_id; DROP TABLE actor_turn_job_inputs; DROP TABLE IF EXISTS actor_job_identity_bindings; DROP TRIGGER IF EXISTS actor_initiatives_source_immutable; DROP INDEX IF EXISTS actor_initiatives_ready; DROP INDEX IF EXISTS actor_initiatives_one_open_per_actor; DROP INDEX IF EXISTS actor_turn_jobs_initiative; DROP TABLE actor_initiatives; DROP TABLE actor_turn_jobs; DROP TABLE IF EXISTS actor_activation_invitation_jobs; DROP TABLE IF EXISTS actor_activation_invitations; DROP TABLE IF EXISTS actor_activation_causes; DROP TABLE IF EXISTS routine_clock_advances; DROP TABLE IF EXISTS model_time_spans; DROP TABLE IF EXISTS model_time_run_state; DROP TABLE IF EXISTS run_preflight_job_operations; DROP TABLE IF EXISTS run_preflight_job_results; DROP TABLE IF EXISTS run_preflight_job_history; DROP TABLE IF EXISTS run_preflight_jobs; DROP TABLE IF EXISTS pi_access_job_operations; DROP TABLE IF EXISTS pi_access_job_results; DROP TABLE IF EXISTS pi_access_job_history; DROP TABLE IF EXISTS pi_access_jobs; DROP TABLE IF EXISTS pi_oauth_job_operations; DROP TABLE IF EXISTS pi_oauth_job_history; DROP TABLE IF EXISTS pi_oauth_jobs; DROP TABLE IF EXISTS circumstance_operations;DROP TABLE IF EXISTS actor_state_cuts; DROP TABLE IF EXISTS actor_state_cut_batches; DROP TABLE IF EXISTS fork_projection_receipts; DROP TABLE IF EXISTS fork_job_history; DROP TABLE IF EXISTS fork_dramatic_seeds; DROP TABLE IF EXISTS fork_job_retries; DROP TABLE IF EXISTS fork_backup_sources; DROP TABLE IF EXISTS fork_jobs; DROP TABLE IF EXISTS identity_promotion_receipts; DROP TABLE IF EXISTS actor_job_identity_bindings; DROP TABLE IF EXISTS actor_pi_session_archives; DROP TABLE IF EXISTS actor_identity_session_bindings; DROP TABLE IF EXISTS actor_identity_epochs; DROP TABLE IF EXISTS configurator_http_operations; DROP TABLE IF EXISTS configurator_consents; DROP TABLE IF EXISTS configurator_operations; DROP TABLE IF EXISTS configurator_candidates; DROP TABLE IF EXISTS configurator_checkpoints; DROP TABLE IF EXISTS configurator_sessions; DROP TABLE IF EXISTS configurator_generations; DROP TABLE IF EXISTS configurator_jobs; DROP TABLE IF EXISTS run_configuration_revisions; DROP TRIGGER IF EXISTS actor_initiatives_source_immutable; DROP INDEX IF EXISTS actor_initiatives_ready; DROP INDEX IF EXISTS actor_initiatives_one_open_per_actor; DROP INDEX IF EXISTS actor_turn_jobs_initiative; DROP TABLE IF EXISTS actor_initiatives; DELETE FROM schema_version WHERE version=45; DELETE FROM schema_version WHERE version IN(9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44)');
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

test('una observación propia crea continuación durable y se recupera sin evento ni duplicados', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-observation-continuation-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  try {
    await createQueuedHumanIntentFixture(journal, ['Max, mirá a tu compañero.'], coordinatorConfigurationFixture());
    const started = journal.beginCoordinatorPulse({ runId });
    if (started.kind !== 'started') assert.fail('La intervención inicial debe abrir el turno de Max');
    const job = started.jobs.find((item) => item.actorId === maxId);
    if (job === undefined) assert.fail('Falta el job de Max');
    const lease = { ownerToken: uuid(9_851), claimToken: uuid(9_852) };
    const claim = journal.claimActorTurnJob({ runId, actorId: maxId, jobId: job.jobId, generation: job.generation, ...lease });
    if (claim.kind !== 'claimed' || claim.job.frozenWorldCut === null) assert.fail('Falta el corte congelado de Max');

    const scope = { runId, pulseId: started.pulse.pulseId, jobId: job.jobId, generation: job.generation };
    const registration = journal.registerActorPiSession({ runId, actorId: maxId, sessionId: 'max-observation',
      sessionPath: join(directory, 'max-observation.jsonl'), preparedContextHash: 'a'.repeat(64),
      profile: { provider: 'openai-codex', model: 'gpt-6-luna', reasoning: 'xhigh' } });
    const port = createActorPiRequestPort({ journal, execution: { ...scope, actorId: maxId, lease } });
    const identity = { kind: 'actor', characterId: maxId } as const;
    await port.reserveNextRequest({ purpose: identity, scope, clockEpochId: uuid(9_853) });
    const candidateBase = { turnId: uuid(9_854), runId, actorId: maxId, scope, lease,
      base: registration.session, inputCut: claim.job.frozenWorldCut };
    await port.recordCheckpointCandidate({ identity,
      purpose: { kind: 'request-input', baseScope: scope, request: { scope, requestSeq: 0 } },
      snapshot: { sessionId: registration.session.sessionId, sessionPath: registration.session.sessionPath, candidateLeafId: 'observation-input' } });
    await port.recordActorPiCandidate?.({ ...candidateBase, kind: 'request-input', candidateId: uuid(9_855),
      requestSeq: 0, candidateLeafId: 'observation-input' });

    const attempt = { kind: 'observe' as const, attemptId: uuid(9_856), runId, actorId: maxId,
      expectedRevision: claim.job.frozenWorldCut.worldRevision,
      target: { modality: 'visual' as const, targetHandle: 'agent-99' } };
    const proposalId = ProposalIdSchema.parse(uuid(9_857));
    journal.registerWorldProposal({ runId, proposalId, version: 1, jobId: job.jobId, generation: job.generation,
      proposalSlot: 0, lease, attempt });
    await port.transitionReservation({ purpose: identity, scope, requestSeq: 0, target: 'dispatched',
      wallTime: { clockEpochId: uuid(9_853), monotonicNs: process.hrtime.bigint().toString() } });
    await port.transitionReservation({ purpose: identity, scope, requestSeq: 0, target: 'completed',
      wallTime: { clockEpochId: uuid(9_853), monotonicNs: process.hrtime.bigint().toString() } });
    const candidateId = uuid(9_858);
    await port.recordActorPiCandidate?.({ ...candidateBase, kind: 'terminal-candidate', candidateId,
      outcome: 'completed', lastRequestSeq: 0, candidateLeafId: 'observation-approved' });
    journal.acceptActorTurn({ candidateId, lease, proposal: { kind: 'durable', proposalId, version: 1,
      attemptHash: sha256(canonicalJson(attempt)) } });

    const commit = { runId, proposalId, version: 1, ids: idSource(9_859) };
    const committed = journal.commitWorldAttempt(commit);
    assert.equal(committed.resolution.kind, 'applied');
    if (committed.resolution.kind !== 'applied') assert.fail('La observación debe quedar aplicada');
    const observation = committed.resolution.perceptions[0];
    assert.equal(observation?.kind, 'observation');
    if (observation?.kind !== 'observation') assert.fail('Falta la observación propia');
    assert.deepEqual(committed.resolution.events, [], 'observar no inventa un hecho público');
    assert.equal(journal.loadWorld({ runId })?.seq, claim.job.frozenWorldCut.worldSeq,
      'la observación no avanza la secuencia de eventos del mundo');
    assert.equal(journal.closeCoordinatorPulse({ runId, pulseId: started.pulse.pulseId }).state, 'completed');

    journal.close();
    journal = openJournal({ path });
    assert.equal(journal.commitWorldAttempt(commit).kind, 'existing', 'el replay no duplica la continuación');
    const awaiting = new DatabaseSync(path);
    try {
      assert.equal(awaiting.prepare('SELECT state FROM actor_turn_intents WHERE perception_id=?').get(observation.id)?.state,
        'awaitingDelivery', 'la intención propia sobrevive al reinicio sin adelantarse a su entrega');
      assert.equal(awaiting.prepare('SELECT COUNT(*) AS count FROM actor_turn_intents WHERE perception_id=?').get(observation.id)?.count, 1,
        'repetir el commit conserva una sola intención');
    } finally { awaiting.close(); }
    const delivered = await createDeliverWorldWorker({ journal, runId, actorId: maxId }).drain();
    assert.equal(delivered.kind, 'completed');
    assert.deepEqual(journal.readQueuedActorTurnIntents({ runId, actorId: maxId }).map((item) => item.perceptionId), [observation.id]);
    const resumed = journal.beginCoordinatorPulse({ runId });
    assert.equal(resumed.kind, 'started', 'la observación entregada abre una causa actoral real');
    if (resumed.kind !== 'started') assert.fail('No se abrió la continuación de Max');
    assert.equal(resumed.pulse.cause.kind, 'actorAttempt');
    assert.equal(resumed.pulse.cause.id, attempt.attemptId);
    assert.deepEqual(resumed.jobs.map((item) => item.actorId), [maxId]);
    assert.deepEqual(resumed.jobs[0]?.perceptionIds, [observation.id]);
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('un movimiento solitario produce percepción privada respaldada, Experience real y nuevo job en destino', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-own-movement-continuation-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  try {
    const destinationId = 'destino-del-movimiento';
    const base = worldFixture();
    const soloWorld = WorldSnapshotSchema.parse({
      ...base,
      places: [...base.places, { id: destinationId, name: 'Pasillo lateral', description: 'Un pasillo vacío.', width: 10, height: 10, lighting: 'normal' }],
      connections: [{ from: roomId, to: destinationId, durationMs: 250, arrivalPoint: { x: 2, y: 2 }, doorId: null }],
      entities: base.entities.map((entity) => entity.kind === 'character'
        ? entity.characterId === maxId
          ? { ...entity, capabilities: [...entity.capabilities, 'move'] }
          : { ...entity, presence: { kind: 'absent' } }
        : entity),
      scenes: base.scenes.map((scene) => ({ ...scene, participantIds: [maxId], placeIds: [roomId, destinationId] })),
    });
    const configuration = coordinatorConfigurationFixture([maxId], soloWorld);
    await createQueuedHumanIntentFixture(journal, ['Max, seguí hacia el pasillo.'], configuration);

    const world = journal.loadWorld({ runId });
    const knowledge = journal.readActorKnowledge({ runId, actorId: maxId, throughWorldSeq: world?.seq ?? 0 });
    assert.ok(world && knowledge);
    assert.equal(journal.compareAndSwapActorKnowledge({
      kind: 'actor-knowledge-cas', actorId: maxId, runId, expectedWorldRevision: world.revision,
      expectedWorldSeq: world.seq,
      expectedContinuity: { continuityId: 'continuity-main', revision: 0, contentHash: HashSchema.parse('b'.repeat(64)) },
      expectedKnowledgeRevision: knowledge.revision,
      knowledge: ActorKnowledgeSchema.parse({ ...knowledge.knowledge,
        bindings: [...knowledge.knowledge.bindings, { kind: 'place', handle: 'destination', placeId: destinationId }] }),
    }).kind, 'stored');

    const started = journal.beginCoordinatorPulse({ runId });
    if (started.kind !== 'started') assert.fail('La intervención debe iniciar el primer turno de Max');
    assert.deepEqual(started.pulse.cause.kind, 'humanIntervention');
    assert.equal(started.jobs.length, 1, 'Max está solo entre los personajes de la escena');
    const job = started.jobs[0];
    if (job === undefined) assert.fail('Falta el job de Max');
    const accepted = await acceptActorAttemptForTest({ journal, directory, job, seed: 9_940,
      makeAttempt: (cut) => ({ kind: 'move', attemptId: uuid(9_948), runId, actorId: maxId,
        expectedRevision: cut.worldRevision, destinationHandle: 'destination' }) });
    const commit = { runId, proposalId: accepted.proposalId, version: 1, ids: idSource(9_949) };
    const committed = journal.commitWorldAttempt(commit);
    assert.equal(committed.resolution.kind, 'applied');
    if (committed.resolution.kind !== 'applied') assert.fail('El movimiento debe aplicarse');
    const event = committed.resolution.events.find((candidate) => candidate.kind === 'moved');
    const ownPerception = committed.resolution.perceptions.find((perception) => perception.kind === 'worldEvent'
      && perception.recipientCharacterId === maxId);
    assert.ok(event);
    assert.ok(ownPerception?.kind === 'worldEvent');
    assert.equal(ownPerception?.kind === 'worldEvent' ? ownPerception.eventId : undefined, event?.id);
    const movedActor = journal.loadWorld({ runId })?.entities.find((entity) => entity.kind === 'character' && entity.characterId === maxId);
    assert.equal(movedActor?.kind === 'character' ? movedActor.placeId : undefined, destinationId,
      'el corte siguiente ya ubica a Max en el destino');
    assert.equal(journal.closeCoordinatorPulse({ runId, pulseId: started.pulse.pulseId }).state, 'completed');

    journal.close();
    journal = openJournal({ path });
    assert.equal(journal.commitWorldAttempt(commit).kind, 'existing', 'el replay devuelve la misma resolución sin crear otra percepción');
    const database = new DatabaseSync(path);
    try {
      assert.equal(database.prepare('SELECT COUNT(*) AS n FROM world_perceptions WHERE perception_id=?').get(ownPerception.id)?.n, 1);
      assert.equal(database.prepare('SELECT recipient_actor_id FROM world_perceptions WHERE perception_id=?').get(ownPerception.id)?.recipient_actor_id, maxId,
        'la percepción queda dirigida sólo al actor emisor');
      assert.equal(database.prepare('SELECT COUNT(*) AS n FROM actor_turn_intents WHERE perception_id=?').get(ownPerception.id)?.n, 1,
        'el replay conserva una sola intención propia');
    } finally { database.close(); }

    const delivery = await createDeliverWorldWorker({ journal, runId, actorId: maxId }).drain();
    assert.equal(delivery.kind, 'completed');
    const experiences = journal.readExperiences({ runId, actorId: maxId, throughWorldSeq: journal.loadWorld({ runId })?.seq ?? 0 });
    const movementExperience = experiences.find((experience) => experience.kind === 'perception' && experience.eventId === event.id);
    assert.ok(movementExperience, 'la memoria deriva de la percepción y evento confirmados');
    assert.equal(movementExperience?.content, ownPerception.detail);
    assert.deepEqual(journal.readQueuedActorTurnIntents({ runId, actorId: maxId }).map((item) => item.perceptionId), [ownPerception.id]);

    const resumed = journal.beginCoordinatorPulse({ runId });
    if (resumed.kind !== 'started') assert.fail('La percepción del movimiento debe abrir un turno nuevo');
    assert.equal(resumed.pulse.cause.kind, 'actorAttempt');
    assert.equal(resumed.pulse.cause.id, accepted.attemptId);
    assert.deepEqual(resumed.jobs.map((item) => item.actorId), [maxId]);
    assert.deepEqual(resumed.jobs[0]?.perceptionIds, [ownPerception.id]);
    const nextJob = resumed.jobs[0];
    if (nextJob === undefined) assert.fail('Falta el job de continuación');
    const nextLease = { ownerToken: uuid(9_950), claimToken: uuid(9_951) };
    const nextClaim = journal.claimActorTurnJob({ runId, actorId: maxId, jobId: nextJob.jobId,
      generation: nextJob.generation, ...nextLease });
    if (nextClaim.kind !== 'claimed' || nextClaim.job.frozenWorldCut === null) assert.fail('No se congeló el nuevo corte de Max');
    const nextCut = journal.loadActorWorldCut({ actorId: maxId, identityVersion: 1, runId,
      continuity: { continuityId: 'continuity-main', revision: 0, contentHash: HashSchema.parse('b'.repeat(64)) },
      expectedWorldRevision: nextClaim.job.frozenWorldCut.worldRevision,
      atWorldSeq: nextClaim.job.frozenWorldCut.worldSeq, fictionalAt: nextClaim.job.frozenWorldCut.fictionalAt,
      actorJob: { jobId: nextJob.jobId, generation: nextJob.generation, ...nextLease } });
    const actorAtNextCut = nextCut?.snapshot.entities.find((entity) => entity.kind === 'character' && entity.characterId === maxId);
    assert.equal(actorAtNextCut?.kind === 'character' ? actorAtNextCut.placeId : undefined, destinationId,
      'la continuación usa el destino confirmado como su corte');
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('putDown sobrevive replay, entrega Experience propia y abre una continuación durable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-put-down-journal-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  const objectEntityId = WorldEntityIdSchema.parse(uuid(9_960));
  try {
    const base = worldFixture();
    const soloWorld = WorldSnapshotSchema.parse({
      ...base,
      entities: [
        ...base.entities.map((entity) => entity.kind !== 'character' ? entity : entity.characterId === maxId
          ? { ...entity, capabilities: [...entity.capabilities, 'putDown' as const] }
          : { ...entity, presence: { kind: 'absent' as const } }),
        { kind: 'object', entityId: objectEntityId, label: 'Paquete de prueba', description: 'Objeto sintético portátil.',
          collisionRadius: 0.1, blocksMovement: false, portable: true },
      ],
      inventory: [{ objectEntityId, location: { kind: 'heldBy' as const, entityId: maxEntity }, revision: 0 }],
      scenes: base.scenes.map((scene) => ({ ...scene, participantIds: [maxId] })),
    });
    const configuration = coordinatorConfigurationFixture([maxId], soloWorld);
    await createQueuedHumanIntentFixture(journal, ['Max, dejá el paquete sobre la mesa.'], configuration);

    const world = journal.loadWorld({ runId });
    const knowledge = journal.readActorKnowledge({ runId, actorId: maxId, throughWorldSeq: world?.seq ?? 0 });
    assert.ok(world && knowledge);
    assert.equal(journal.compareAndSwapActorKnowledge({
      kind: 'actor-knowledge-cas', actorId: maxId, runId, expectedWorldRevision: world.revision,
      expectedWorldSeq: world.seq,
      expectedContinuity: { continuityId: 'continuity-main', revision: 0, contentHash: HashSchema.parse('b'.repeat(64)) },
      expectedKnowledgeRevision: knowledge.revision,
      knowledge: ActorKnowledgeSchema.parse({ ...knowledge.knowledge, bindings: [
        ...knowledge.knowledge.bindings, { kind: 'entity', handle: 'h-portable', entityId: objectEntityId },
      ] }),
    }).kind, 'stored');

    const started = journal.beginCoordinatorPulse({ runId });
    if (started.kind !== 'started') assert.fail('La petición humana debe activar a Max');
    const job = started.jobs.find((item) => item.actorId === maxId);
    if (job === undefined) assert.fail('Falta el turno de Max');
    const accepted = await acceptActorAttemptForTest({ journal, directory, job, seed: 9_960,
      makeAttempt: (cut) => ({ kind: 'putDown', attemptId: uuid(9_970), runId, actorId: maxId,
        expectedRevision: cut.worldRevision, objectHandle: 'h-portable' }) });
    const commit = { runId, proposalId: accepted.proposalId, version: 1, ids: idSource(9_980) };
    const committed = journal.commitWorldAttempt(commit);
    assert.equal(committed.resolution.kind, 'applied');
    if (committed.resolution.kind !== 'applied') assert.fail('La puesta debe aplicarse');
    const event = committed.resolution.events.find((candidate) => candidate.kind === 'objectPlaced');
    assert.ok(event?.kind === 'objectPlaced');
    if (event?.kind !== 'objectPlaced') assert.fail('Falta el evento objectPlaced');
    assert.deepEqual({ entityId: event.entityId, objectEntityId: event.objectEntityId,
      placeId: event.placeId, position: event.position },
      { entityId: maxEntity, objectEntityId, placeId: roomId, position: { x: 1, y: 1 } });
    const ownPerception = committed.resolution.perceptions.find((perception) => perception.kind === 'worldEvent'
      && perception.recipientCharacterId === maxId);
    assert.ok(ownPerception?.kind === 'worldEvent');
    if (ownPerception?.kind !== 'worldEvent') assert.fail('Falta la percepción propia del evento');
    assert.equal(ownPerception.eventId, event.id);
    assert.deepEqual(journal.loadWorld({ runId })?.inventory.find((entry) => entry.objectEntityId === objectEntityId)?.location,
      { kind: 'atPlace', placeId: roomId, position: { x: 1, y: 1 } });
    assert.equal(journal.closeCoordinatorPulse({ runId, pulseId: started.pulse.pulseId }).state, 'completed');

    journal.close();
    journal = openJournal({ path });
    assert.equal(journal.commitWorldAttempt(commit).kind, 'existing', 'replay conserva el mismo evento y percepción');
    const database = new DatabaseSync(path);
    try {
      assert.equal(database.prepare('SELECT COUNT(*) AS n FROM world_events WHERE event_id=?').get(event.id)?.n, 1);
      assert.equal(database.prepare('SELECT COUNT(*) AS n FROM world_perceptions WHERE perception_id=?').get(ownPerception.id)?.n, 1);
      assert.equal(database.prepare('SELECT COUNT(*) AS n FROM actor_turn_intents WHERE perception_id=?').get(ownPerception.id)?.n, 1);
    } finally { database.close(); }

    const delivery = await createDeliverWorldWorker({ journal, runId, actorId: maxId }).drain();
    assert.equal(delivery.kind, 'completed');
    const memories = journal.readExperiences({ runId, actorId: maxId, throughWorldSeq: journal.loadWorld({ runId })?.seq ?? 0 });
    const memory = memories.find((experience) => experience.kind === 'perception' && experience.eventId === event.id);
    assert.equal(memory?.content, ownPerception.detail, 'la memoria viene del evento visible, sin inventar un efecto');
    assert.deepEqual(journal.readQueuedActorTurnIntents({ runId, actorId: maxId }).map((item) => item.perceptionId), [ownPerception.id]);

    const resumed = journal.beginCoordinatorPulse({ runId });
    if (resumed.kind !== 'started') assert.fail('La percepción propia debe permitir una continuación');
    assert.equal(resumed.pulse.cause.kind, 'actorAttempt');
    assert.equal(resumed.pulse.cause.id, accepted.attemptId);
    assert.deepEqual(resumed.jobs.map((item) => item.actorId), [maxId]);
    assert.deepEqual(resumed.jobs[0]?.perceptionIds, [ownPerception.id]);
  } finally {
    try { journal.close(); } catch { /* Puede haberse cerrado al simular el reinicio. */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('un intento no aplicado produce feedback privado, permite cambiar de acción y corta la repetición idéntica', async () => {
  const directory=mkdtempSync(join(tmpdir(),'personajes-action-feedback-'));
  const path=join(directory,'world.sqlite');
  let journal=openJournal({path});
  const gestureAttempt=(attemptId:number,expectedRevision:number,gesture:'nod'|'wave')=>({
    kind:'communicate' as const,attemptId:uuid(attemptId),runId,actorId:maxId,expectedRevision,
    channelHandle:'speech',audienceHandles:['agent-99'],content:{kind:'gesture' as const,gesture:{kind:gesture}},
  });
  const feedbackFrom=(attemptId:string)=>{
    const row=database.prepare('SELECT payload_json FROM world_perceptions WHERE attempt_id=? AND recipient_actor_id=?').get(attemptId,maxId);
    if(row===undefined)assert.fail('Falta feedback privado del intento');
    return WorldPerceptionSchema.parse(JSON.parse(String(row.payload_json)));
  };
  let database=new DatabaseSync(path);
  try{
    await createQueuedHumanIntentFixture(journal,['Max, probá algo en la escena.'],coordinatorConfigurationFixture());
    const firstPulse=journal.beginCoordinatorPulse({runId});
    if(firstPulse.kind!=='started')assert.fail('La intervención debe iniciar un turno actoral');
    const firstJob=firstPulse.jobs.find((job)=>job.actorId===maxId);
    if(firstJob===undefined)assert.fail('Falta el job de Max');
    const first=await acceptActorAttemptForTest({journal,directory,job:firstJob,seed:9_880,
      nextInitiative:'after-resolution',
      makeAttempt:(cut)=>gestureAttempt(9_888,cut.worldRevision,'nod')});
    const firstCommit={runId,proposalId:first.proposalId,version:1,ids:idSource(9_889)};
    const firstResult=journal.commitWorldAttempt(firstCommit);
    assert.equal(firstResult.resolution.kind,'notApplied');
    if(firstResult.resolution.kind!=='notApplied')assert.fail('La incompatibilidad de gesto/habla debe rechazarse');
    assert.equal(firstResult.resolution.reason,'channel-kind-mismatch');
    assert.deepEqual(firstResult.resolution.events,[]);
    assert.deepEqual(firstResult.resolution.perceptions,[],'la resolución de dominio conserva el resultado puro y no agrega ficción');
    assert.equal(journal.loadWorld({runId})?.seq,first.cut.worldSeq,'el fallo no avanza la secuencia pública');

    const firstFeedback=feedbackFrom(first.attemptId);
    assert.equal(firstFeedback.kind,'actionFeedback');
    if(firstFeedback.kind!=='actionFeedback')assert.fail('El registro debe ser feedback tipado');
    assert.equal(firstFeedback.reason,'channel-kind-mismatch');
    assert.equal(firstFeedback.worldRevision,first.cut.worldRevision);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM world_events WHERE origin_id=?').get(first.attemptId)?.n,0);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM world_perception_experiences WHERE perception_id=?').get(firstFeedback.id)?.n,0,
      'el feedback no se vuelve Experience/ICM Memory');
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM actor_turn_intents WHERE perception_id=?').get(firstFeedback.id)?.n,1);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM actor_initiatives WHERE source_attempt_id=?').get(first.attemptId)?.n,0,
      'una acción no aplicada no crea iniciativa; sólo el feedback técnico puede ofrecer reconsideración');
    const projected=buildActorWorldView({snapshot:journal.loadWorld({runId}),actorId:maxId,
      knowledge:emptyActorKnowledge({runId,actorId:maxId}),pendingPerceptions:[firstFeedback],ids:idSource(9_890)}).view;
    assert.deepEqual(projected.inbox,[{kind:'actionFeedback',result:'notApplied',reason:'channel-kind-mismatch',
      message:'Resultado de ejecución: la acción anterior no se aplicó al Escenario. Esto no es un suceso de la ficción; reconsidera tu próxima acción desde la percepción actual.',
      fictitiousAt:firstFeedback.fictitiousAt}]);
    assert.equal(JSON.stringify(projected).includes(firstFeedback.chainId),false,'la identidad interna de la cadena no entra al contexto del actor');
    assert.equal(JSON.stringify(projected).includes(firstFeedback.actionSignature),false,'la firma anti-loop queda sólo en el host');
    const otherActorView=buildActorWorldView({snapshot:journal.loadWorld({runId}),actorId:agentId,
      knowledge:emptyActorKnowledge({runId,actorId:agentId}),pendingPerceptions:[firstFeedback],ids:idSource(9_891)}).view;
    assert.deepEqual(otherActorView.inbox,[],'el feedback no se filtra a otros actores');

    assert.equal(journal.closeCoordinatorPulse({runId,pulseId:firstPulse.pulse.pulseId}).state,'completed');
    journal.close();
    journal=openJournal({path});
    assert.equal(journal.commitWorldAttempt(firstCommit).kind,'existing','replay devuelve la resolución original');
    database.close();
    database=new DatabaseSync(path);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM world_perceptions WHERE attempt_id=? AND json_extract(payload_json,'$.kind')='actionFeedback'").get(first.attemptId)?.n,1,
      'replay no duplica el registro de feedback');
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM actor_turn_intents WHERE perception_id=?').get(firstFeedback.id)?.n,1,
      'replay no duplica la continuación');

    assert.equal((await createDeliverWorldWorker({journal,runId,actorId:maxId}).drain()).kind,'completed');
    const secondPulse=journal.beginCoordinatorPulse({runId});
    if(secondPulse.kind!=='started')assert.fail('El feedback entregado debe permitir reconsiderar');
    const secondJob=secondPulse.jobs.find((job)=>job.actorId===maxId);
    if(secondJob===undefined)assert.fail('Falta el turno de reconsideración');
    assert.equal(secondJob.perceptionIds.includes(firstFeedback.id),true);
    const second=await acceptActorAttemptForTest({journal,directory,job:secondJob,seed:9_900,
      makeAttempt:(cut)=>gestureAttempt(9_908,cut.worldRevision,'wave')});
    const secondResult=journal.commitWorldAttempt({runId,proposalId:second.proposalId,version:1,ids:idSource(9_909)});
    assert.equal(secondResult.resolution.kind,'notApplied');
    const secondFeedback=feedbackFrom(second.attemptId);
    assert.equal(secondFeedback.kind,'actionFeedback');
    if(secondFeedback.kind!=='actionFeedback')assert.fail('Falta segundo feedback');
    if(firstFeedback.kind!=='actionFeedback')assert.fail('Falta primer feedback');
    assert.equal(secondFeedback.chainId,firstFeedback.chainId);
    assert.notEqual(secondFeedback.actionSignature,firstFeedback.actionSignature,
      'una acción distinta en el mismo corte constituye una causa nueva');
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM actor_turn_intents WHERE perception_id=?').get(secondFeedback.id)?.n,1);
    assert.equal(journal.closeCoordinatorPulse({runId,pulseId:secondPulse.pulse.pulseId}).state,'completed');
    assert.equal((await createDeliverWorldWorker({journal,runId,actorId:maxId}).drain()).kind,'completed');

    const thirdPulse=journal.beginCoordinatorPulse({runId});
    if(thirdPulse.kind!=='started')assert.fail('La segunda acción fallida debe ofrecer una nueva reconsideración');
    const thirdJob=thirdPulse.jobs.find((job)=>job.actorId===maxId);
    if(thirdJob===undefined)assert.fail('Falta el segundo turno de reconsideración');
    assert.equal(thirdJob.perceptionIds.includes(secondFeedback.id),true);
    const third=await acceptActorAttemptForTest({journal,directory,job:thirdJob,seed:9_920,
      makeAttempt:(cut)=>gestureAttempt(9_928,cut.worldRevision,'wave')});
    const thirdResult=journal.commitWorldAttempt({runId,proposalId:third.proposalId,version:1,ids:idSource(9_929)});
    assert.equal(thirdResult.resolution.kind,'notApplied');
    const thirdFeedback=feedbackFrom(third.attemptId);
    assert.equal(thirdFeedback.kind,'actionFeedback');
    if(thirdFeedback.kind!=='actionFeedback'||secondFeedback.kind!=='actionFeedback')assert.fail('Falta feedback para detectar repetición');
    assert.equal(thirdFeedback.chainId,secondFeedback.chainId);
    assert.equal(thirdFeedback.actionSignature,secondFeedback.actionSignature);
    assert.equal(thirdFeedback.reason,secondFeedback.reason);
    assert.equal(thirdFeedback.worldRevision,secondFeedback.worldRevision);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM actor_turn_intents WHERE perception_id=?').get(thirdFeedback.id)?.n,0,
      'repetir acción, razón y corte queda guardado pero no dispara otro turno automáticamente');
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM world_events WHERE origin_id IN(?,?,?)").get(first.attemptId,second.attemptId,third.attemptId)?.n,0);
    assert.equal(journal.closeCoordinatorPulse({runId,pulseId:thirdPulse.pulse.pulseId}).state,'completed');
  }finally{database.close();journal.close();rmSync(directory,{recursive:true,force:true});}
});

test('after-resolution conserva su causa, coalesce inbox antes del claim y se reintenta tras reopen', async () => {
  const directory=mkdtempSync(join(tmpdir(),'personajes-actor-initiative-'));
  const path=join(directory,'world.sqlite');
  let journal=openJournal({path});
  try{
    const base=worldFixture();
    const world=WorldSnapshotSchema.parse({...base,clock:{...base.clock,instant:-10_000},entities:base.entities.map((entity)=>entity.kind==='character'
      ?{...entity,mind:{...entity.mind,experiences:entity.mind.experiences.map((experience)=>({...experience,fictitiousAt:-10_000,receivedAt:-10_000}))}}:entity)});
    await createQueuedHumanIntentFixture(journal,['Max, escuchame un momento.'],coordinatorConfigurationFixture([maxId,agentId],world));
    const firstPulse=journal.beginCoordinatorPulse({runId});
    if(firstPulse.kind!=='started')assert.fail('La intervención humana debe convocar a Max');
    const firstJob=firstPulse.jobs.find((job)=>job.actorId===maxId);
    if(firstJob===undefined)assert.fail('Falta el turno de Max');
    const first=await acceptActorAttemptForTest({journal,directory,job:firstJob,seed:43_100,
      nextInitiative:'after-resolution',makeAttempt:(cut)=>waitAttempt(43_110,maxId,cut.worldRevision)});
    const sourceCommit=journal.commitWorldAttempt({runId,proposalId:first.proposalId,version:1,ids:idSource(43_120)});
    assert.equal(sourceCommit.resolution.kind,'applied');
    const resultingWorld=journal.loadWorld({runId});
    if(resultingWorld===undefined)assert.fail('Falta el mundo resuelto');
    assert.ok(resultingWorld.clock.instant<0,'el escenario de prueba conserva instantes ficticios anteriores a Unix');
    assert.equal(journal.closeCoordinatorPulse({runId,pulseId:firstPulse.pulse.pulseId}).state,'completed');
    const laterHumanInput=journal.commitHumanIntervention({runId,participantId:'interlocutor-andres',
      expectedRevision:resultingWorld.revision,idempotencyKey:uuid(43_125),request:{kind:'speech',recipientCharacterIds:[maxId],channelId,
        content:{kind:'speech',text:'Max, y ya que estás aquí: ¿qué hacemos ahora?'}}});
    if(laterHumanInput.kind!=='stored'||laterHumanInput.resolution.kind!=='applied')assert.fail('La nueva intervención debe quedar confirmada');
    const deliveredLater=await createDeliverWorldWorker({journal,runId,actorId:maxId}).drain();
    assert.equal(deliveredLater.kind,'completed');
    const laterPerceptionId=journal.readQueuedActorTurnIntents({runId,actorId:maxId,limit:10})[0]?.perceptionId;
    if(laterPerceptionId===undefined)assert.fail('La nueva percepción debe estar entregada antes del próximo claim');
    const worldWithInbox=journal.loadWorld({runId});
    if(worldWithInbox===undefined)assert.fail('Falta el mundo con la nueva intervención');
    const database=new DatabaseSync(path);
    const persisted=z.strictObject({initiative_id:z.string(),eligible_at:z.number(),source_commit_index:z.number(),state:z.string()})
      .parse(database.prepare('SELECT initiative_id,eligible_at,source_commit_index,state FROM actor_initiatives WHERE source_attempt_id=?')
        .get(first.attemptId));
    database.close();
    assert.equal(persisted.state,'pending');
    assert.equal(persisted.eligible_at,resultingWorld.clock.instant);
    assert.ok(persisted.eligible_at<0,'la fecha ficticia negativa se almacena sin normalizarla a tiempo de host');

    assert.equal(journal.setWorldLifecycle({runId,expectedWorldRevision:worldWithInbox.revision,expectedConfigRevision:0,target:'paused'}),'updated');
    journal.close();journal=openJournal({path});
    assert.equal(journal.setWorldLifecycle({runId,expectedWorldRevision:worldWithInbox.revision,expectedConfigRevision:0,target:'running'}),'updated');
    assert.deepEqual(journal.listCoordinatorPulseTargets().map((item)=>item.runId),[runId]);
    const continuation=journal.beginCoordinatorPulse({runId});
    if(continuation.kind!=='started')assert.fail('La iniciativa pendiente debe crear un turno al instante resultante');
    assert.deepEqual(continuation.pulse.cause,{kind:'actorInitiative',id:persisted.initiative_id,commitIndex:persisted.source_commit_index});
    const continuationJob=continuation.jobs.find((job)=>job.actorId===maxId);
    if(continuationJob===undefined)assert.fail('La iniciativa debe pertenecer a Max');
    assert.deepEqual(continuationJob.perceptionIds,[],'una iniciativa no fabrica percepción ni inbox');
    assert.equal(continuationJob.initiative?.initiativeId,persisted.initiative_id);
    assert.equal(continuationJob.initiative?.eligibleAt,resultingWorld.clock.instant);

    const lease={ownerToken:uuid(43_130),claimToken:uuid(43_131)};
    const claim=journal.claimActorTurnJob({runId,actorId:maxId,jobId:continuationJob.jobId,generation:0,...lease});
    if(claim.kind!=='claimed')assert.fail('El job de iniciativa sin inbox debe poder reclamar el corte actual');
    assert.deepEqual(claim.job.frozenPerceptionIds,[laterPerceptionId],
      'el actor incorpora al mismo turno la percepción ya entregada, incluso si llegó después de crear la iniciativa');
    const failed=journal.failActorTurnJob({execution:{runId,actorId:maxId,jobId:continuationJob.jobId,generation:0,
      pulseId:continuation.pulse.pulseId,lease},code:'execution-failed'});
    assert.equal(failed.job.initiative?.initiativeId,persisted.initiative_id);
    assert.equal(journal.closeCoordinatorPulse({runId,pulseId:continuation.pulse.pulseId}).state,'blocked');
    journal.close();journal=openJournal({path});
    const retry=journal.retryActorTurnJob({runId,actorId:maxId,jobId:continuationJob.jobId,expectedGeneration:0,pulseId:continuation.pulse.pulseId});
    assert.equal(retry.kind,'retried');
    assert.equal(retry.job.generation,1);
    assert.equal(retry.job.initiative?.initiativeId,persisted.initiative_id,'el retry continúa la misma causa sin duplicarla');
    assert.deepEqual(retry.job.perceptionIds,[]);
    const retriedClaim=journal.claimActorTurnJob({runId,actorId:maxId,jobId:retry.job.jobId,generation:1,
      ownerToken:uuid(43_132),claimToken:uuid(43_133)});
    assert.equal(retriedClaim.kind,'claimed');
    assert.deepEqual(retriedClaim.job.frozenPerceptionIds,[laterPerceptionId],
      'el retry vuelve a incorporar la percepción liberada sin duplicar su causa ni consumirla antes del claim');
    const after=journal.beginCoordinatorPulse({runId});
    assert.equal(after.kind,'existing','no se crea un segundo turno para la misma causa mientras el retry está activo');
    if(after.kind==='existing')assert.equal(after.pulse.pulseId,continuation.pulse.pulseId);
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});

test('la cola de causas deja avanzar una iniciativa anterior después de dos turnos de conversación', async () => {
  const directory=mkdtempSync(join(tmpdir(),'personajes-initiative-fairness-'));
  const journal=openJournal({path:join(directory,'world.sqlite')});
  try{
    const base=worldFixture();
    const agent=base.entities.find((entity)=>entity.kind==='character'&&entity.characterId===agentId);
    if(agent?.kind!=='character')assert.fail('Falta Agente 99 en el escenario');
    const chief={...agent,entityId:chiefEntity,characterId:chiefId,trueDisplayName:'El Jefe',position:{x:3,y:1},
      mind:{goals:[],beliefs:[],relationships:[],recognizedCharacterIds:[],experiences:[]}};
    const world=WorldSnapshotSchema.parse({...base,entities:[...base.entities,chief],
      scenes:base.scenes.map((scene)=>({...scene,participantIds:[maxId,agentId,chiefId]}))});
    const configured=coordinatorConfigurationFixture([maxId,agentId,chiefId],world);
    const configuration=ReadyRunConfigurationSchema.parse({...configured,
      budget:{...configured.budget,maxPiCallsPerRun:20,maxPiCallsPerPulse:4}});
    await createQueuedHumanIntentFixture(journal,['Max, ¿estás ahí?'],configuration);
    assert.equal(grantTestActorKnowledge(journal,maxId,[{kind:'entity',handle:'jefe',entityId:chiefEntity}]).kind,'stored');
    assert.equal(grantTestActorKnowledge(journal,agentId,[{kind:'channel',handle:'speech',channelId},
      {kind:'entity',handle:'jefe',entityId:chiefEntity},{kind:'entity',handle:'maxwell-smart',entityId:maxEntity}]).kind,'stored');
    assert.equal(grantTestActorKnowledge(journal,chiefId,[{kind:'channel',handle:'speech',channelId},
      {kind:'entity',handle:'agente-99',entityId:agentEntity},{kind:'entity',handle:'maxwell-smart',entityId:maxEntity}]).kind,'stored');

    const firstPulse=journal.beginCoordinatorPulse({runId});
    if(firstPulse.kind!=='started')assert.fail('La pregunta debe activar a Max');
    const maxJob=firstPulse.jobs.find((job)=>job.actorId===maxId);
    if(maxJob===undefined)assert.fail('Falta el job inicial de Max');
    const maxTurn=await acceptActorAttemptForTest({journal,directory,job:maxJob,seed:43_200,nextInitiative:'after-resolution',
      makeAttempt:(cut)=>communicateAttempt(43_210,cut.worldRevision,maxId,['agent-99','jefe'],'¿Me decís qué encontraste?')});
    assert.equal(journal.commitWorldAttempt({runId,proposalId:maxTurn.proposalId,version:1,ids:idSource(43_220)}).resolution.kind,'applied');
    assert.equal(journal.closeCoordinatorPulse({runId,pulseId:firstPulse.pulse.pulseId}).state,'completed');
    assert.equal((await createDeliverWorldWorker({journal,runId,actorId:agentId}).drain()).kind,'completed');
    assert.equal((await createDeliverWorldWorker({journal,runId,actorId:chiefId}).drain()).kind,'completed');

    const conversationPulse=journal.beginCoordinatorPulse({runId});
    if(conversationPulse.kind!=='started')assert.fail('Los testigos deben recibir el evento de Max');
    assert.equal(conversationPulse.pulse.cause.kind,'actorAttempt');
    assert.deepEqual(conversationPulse.jobs.map((job)=>job.actorId).sort(),[agentId,chiefId].sort(),
      'Agente 99 y el Jefe reciben el mismo evento mientras la iniciativa de Max espera su corte');
    const agentJob=conversationPulse.jobs.find((job)=>job.actorId===agentId);
    const chiefJob=conversationPulse.jobs.find((job)=>job.actorId===chiefId);
    if(agentJob===undefined||chiefJob===undefined)assert.fail('Faltan los dos interlocutores');
    const agentTurn=await acceptActorAttemptForTest({journal,directory,job:agentJob,seed:43_230,
      makeAttempt:(cut)=>communicateAttempt(43_240,cut.worldRevision,agentId,['jefe','maxwell-smart'],'Lo encontré en el informe. Enseguida te cuento.')});
    assert.equal(journal.commitWorldAttempt({runId,proposalId:agentTurn.proposalId,version:1,ids:idSource(43_250)}).resolution.kind,'applied');
    const chiefTurn=await acceptActorAttemptForTest({journal,directory,job:chiefJob,seed:43_260,
      makeAttempt:(cut)=>communicateAttempt(43_270,cut.worldRevision,chiefId,['agente-99','maxwell-smart'],'A ver, cuéntenme los dos.')});
    assert.equal(journal.commitWorldAttempt({runId,proposalId:chiefTurn.proposalId,version:1,ids:idSource(43_280)}).resolution.kind,'applied');
    assert.equal(journal.closeCoordinatorPulse({runId,pulseId:conversationPulse.pulse.pulseId}).state,'completed');
    for(const actorId of [maxId,agentId,chiefId]){
      assert.equal((await createDeliverWorldWorker({journal,runId,actorId}).drain()).kind,'completed');
    }

    const next=journal.beginCoordinatorPulse({runId});
    if(next.kind!=='started')assert.fail('La iniciativa antigua debe avanzar después de los turnos más nuevos de conversación');
    assert.equal(next.pulse.cause.kind,'actorInitiative');
    const nextMax=next.jobs.find((job)=>job.actorId===maxId);
    if(nextMax===undefined)assert.fail('Falta el turno de iniciativa de Max');
    const claimed=journal.claimActorTurnJob({runId,actorId:maxId,jobId:nextMax.jobId,generation:nextMax.generation,
      ownerToken:uuid(43_290),claimToken:uuid(43_291)});
    if(claimed.kind!=='claimed')assert.fail('Max debe reclamar el turno justo');
    assert.ok(claimed.job.frozenPerceptionIds);
    assert.equal(claimed.job.frozenPerceptionIds.length,2,
      'el turno combina las dos nuevas intervenciones de los personajes antes de congelar el inbox');
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
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
      downgradeCoordinatorPulsesTo44(beforeMigration); beforeMigration.exec('DROP TABLE preparation_configurator_records; DROP TABLE preparation_configurator_operations; DROP TABLE preparation_configurator_jobs; DROP TABLE model_budget_authorities; DROP TRIGGER icm_context_packets_no_update; DROP TRIGGER icm_context_packets_no_delete; DROP TABLE icm_context_packets; DROP INDEX coordinator_pulses_parked_for; ALTER TABLE coordinator_pulses DROP COLUMN parked_for_pulse_id; DROP TABLE IF EXISTS routine_clock_advances; DROP TABLE world_commits; DROP TABLE IF EXISTS actor_activation_invitation_jobs; DROP TABLE IF EXISTS actor_activation_invitations; DROP TABLE IF EXISTS actor_activation_causes; DROP TABLE IF EXISTS routine_clock_advances; DROP TABLE IF EXISTS model_time_spans; DROP TABLE IF EXISTS model_time_run_state; DROP TABLE IF EXISTS run_preflight_job_operations; DROP TABLE IF EXISTS run_preflight_job_results; DROP TABLE IF EXISTS run_preflight_job_history; DROP TABLE IF EXISTS run_preflight_jobs; DROP TABLE IF EXISTS pi_access_job_operations; DROP TABLE IF EXISTS pi_access_job_results; DROP TABLE IF EXISTS pi_access_job_history; DROP TABLE IF EXISTS pi_access_jobs; DROP TABLE IF EXISTS pi_oauth_job_operations; DROP TABLE IF EXISTS pi_oauth_job_history; DROP TABLE IF EXISTS pi_oauth_jobs; DROP TABLE IF EXISTS circumstance_operations;DROP TABLE IF EXISTS actor_state_cuts; DROP TABLE IF EXISTS actor_state_cut_batches; DROP TABLE IF EXISTS fork_projection_receipts; DROP TABLE IF EXISTS fork_job_history; DROP TABLE IF EXISTS fork_dramatic_seeds; DROP TABLE IF EXISTS fork_job_retries; DROP TABLE IF EXISTS fork_backup_sources; DROP TABLE IF EXISTS fork_jobs; DROP TABLE IF EXISTS identity_promotion_receipts; DROP TABLE IF EXISTS actor_job_identity_bindings; DROP TABLE IF EXISTS actor_pi_session_archives; DROP TABLE IF EXISTS actor_identity_session_bindings; DROP TABLE IF EXISTS actor_identity_epochs; DROP TABLE IF EXISTS configurator_http_operations; DROP TABLE IF EXISTS configurator_consents; DROP TABLE IF EXISTS configurator_operations; DROP TABLE IF EXISTS configurator_candidates; DROP TABLE IF EXISTS configurator_checkpoints; DROP TABLE IF EXISTS configurator_sessions; DROP TABLE IF EXISTS configurator_generations; DROP TABLE IF EXISTS configurator_jobs; DROP TABLE IF EXISTS run_configuration_revisions; DROP TRIGGER IF EXISTS actor_initiatives_source_immutable; DROP INDEX IF EXISTS actor_initiatives_ready; DROP INDEX IF EXISTS actor_initiatives_one_open_per_actor; DROP INDEX IF EXISTS actor_turn_jobs_initiative; DROP TABLE IF EXISTS actor_initiatives; ALTER TABLE actor_turn_jobs DROP COLUMN initiative_id; DELETE FROM schema_version WHERE version=45; DELETE FROM schema_version WHERE version IN(6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44)');
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
      assert.equal(afterMigration.prepare('SELECT MAX(version) AS version FROM schema_version').get()?.version, 45);
      assert.equal(afterMigration.prepare('SELECT COUNT(*) AS count FROM episodes').get()?.count, 0,
        'v29 no backfillea episodios para corridas heredadas');
      assert.equal(afterMigration.prepare('SELECT structure_revision FROM world_runs WHERE run_id=?').get(runId)?.structure_revision, 0);
    } finally { afterMigration.close(); }

    assert.equal(journal.loadWorld({ runId, throughWorldSeq: 0 })?.revision, 0);
    assert.equal(journal.loadWorld({ runId, throughWorldSeq: 1 })?.revision, 1,
      'el corte por secuencia conserva el primer commit de esa secuencia según commit_index');

    journal.close();
    const removeVersionMarker = new DatabaseSync(path);
    try { downgradeCoordinatorPulsesTo44(removeVersionMarker); removeVersionMarker.exec('DROP TABLE preparation_configurator_records; DROP TABLE preparation_configurator_operations; DROP TABLE preparation_configurator_jobs; DROP TABLE model_budget_authorities; DROP TRIGGER icm_context_packets_no_update; DROP TRIGGER icm_context_packets_no_delete; DROP TABLE icm_context_packets; DROP INDEX coordinator_pulses_parked_for; ALTER TABLE coordinator_pulses DROP COLUMN parked_for_pulse_id; DROP TABLE IF EXISTS actor_activation_invitation_jobs; DROP TABLE IF EXISTS actor_activation_invitations; DROP TABLE IF EXISTS actor_activation_causes; DROP TABLE IF EXISTS routine_clock_advances; DROP TABLE IF EXISTS model_time_spans; DROP TABLE IF EXISTS model_time_run_state; DROP TABLE IF EXISTS run_preflight_job_operations; DROP TABLE IF EXISTS run_preflight_job_results; DROP TABLE IF EXISTS run_preflight_job_history; DROP TABLE IF EXISTS run_preflight_jobs; DROP TABLE IF EXISTS pi_access_job_operations; DROP TABLE IF EXISTS pi_access_job_results; DROP TABLE IF EXISTS pi_access_job_history; DROP TABLE IF EXISTS pi_access_jobs; DROP TABLE IF EXISTS pi_oauth_job_operations; DROP TABLE IF EXISTS pi_oauth_job_history; DROP TABLE IF EXISTS pi_oauth_jobs; DROP TABLE IF EXISTS circumstance_operations;DROP TABLE IF EXISTS actor_state_cuts; DROP TABLE IF EXISTS actor_state_cut_batches; DROP TABLE IF EXISTS fork_projection_receipts; DROP TABLE IF EXISTS fork_job_history; DROP TABLE IF EXISTS fork_dramatic_seeds; DROP TABLE IF EXISTS fork_job_retries; DROP TABLE IF EXISTS fork_backup_sources; DROP TABLE IF EXISTS fork_jobs; DROP TABLE IF EXISTS identity_promotion_receipts; DROP TABLE IF EXISTS actor_job_identity_bindings; DROP TABLE IF EXISTS actor_pi_session_archives; DROP TABLE IF EXISTS actor_identity_session_bindings; DROP TABLE IF EXISTS actor_identity_epochs; DROP TABLE IF EXISTS configurator_http_operations; DROP TABLE IF EXISTS configurator_consents; DROP TABLE IF EXISTS configurator_operations; DROP TABLE IF EXISTS configurator_candidates; DROP TABLE IF EXISTS configurator_checkpoints; DROP TABLE IF EXISTS configurator_sessions; DROP TABLE IF EXISTS configurator_generations; DROP TABLE IF EXISTS configurator_jobs; DROP TABLE IF EXISTS run_configuration_revisions; DROP TRIGGER IF EXISTS actor_initiatives_source_immutable; DROP INDEX IF EXISTS actor_initiatives_ready; DROP INDEX IF EXISTS actor_initiatives_one_open_per_actor; DROP INDEX IF EXISTS actor_turn_jobs_initiative; DROP TABLE IF EXISTS actor_initiatives; ALTER TABLE actor_turn_jobs DROP COLUMN initiative_id; DELETE FROM schema_version WHERE version=45; DELETE FROM schema_version WHERE version IN(6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44)'); }
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
      downgradeCoordinatorPulsesTo44(legacy); legacy.exec(`DROP TABLE preparation_configurator_records; DROP TABLE preparation_configurator_operations; DROP TABLE preparation_configurator_jobs; DROP TABLE model_budget_authorities; DROP TRIGGER icm_context_packets_no_update; DROP TRIGGER icm_context_packets_no_delete; DROP TABLE icm_context_packets; DROP INDEX coordinator_pulses_parked_for; ALTER TABLE coordinator_pulses DROP COLUMN parked_for_pulse_id; PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
        CREATE TABLE actor_jobs_v12(
          run_id TEXT NOT NULL REFERENCES world_runs(run_id),actor_id TEXT NOT NULL,job_id TEXT NOT NULL,
          generation INTEGER NOT NULL CHECK(generation>=0),pulse_id TEXT NOT NULL REFERENCES pulses(pulse_id),
          state TEXT NOT NULL CHECK(state IN('queued','running','accepted')),owner_token TEXT,claim_token TEXT,
          created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,frozen_perception_ids_json TEXT,frozen_world_cut_json TEXT,
          PRIMARY KEY(run_id,actor_id,job_id,generation),UNIQUE(job_id,generation));
        INSERT INTO actor_jobs_v12 SELECT run_id,actor_id,job_id,generation,pulse_id,state,owner_token,claim_token,
          created_at,updated_at,frozen_perception_ids_json,frozen_world_cut_json FROM actor_turn_jobs;
        DROP TABLE IF EXISTS actor_job_identity_bindings; DROP TABLE actor_turn_jobs; ALTER TABLE actor_jobs_v12 RENAME TO actor_turn_jobs;
        CREATE TABLE actor_inputs_v12(
          run_id TEXT NOT NULL,actor_id TEXT NOT NULL,job_id TEXT NOT NULL,generation INTEGER NOT NULL,
          perception_id TEXT NOT NULL UNIQUE REFERENCES actor_turn_intents(perception_id),
          state TEXT NOT NULL CHECK(state IN('assigned','consumed')),assigned_at INTEGER NOT NULL,consumed_at INTEGER,
          PRIMARY KEY(run_id,actor_id,job_id,generation,perception_id),
          FOREIGN KEY(run_id,actor_id,job_id,generation) REFERENCES actor_turn_jobs(run_id,actor_id,job_id,generation));
        INSERT INTO actor_inputs_v12 SELECT * FROM actor_turn_job_inputs;
        DROP TABLE actor_turn_job_inputs; ALTER TABLE actor_inputs_v12 RENAME TO actor_turn_job_inputs;
        DROP TABLE IF EXISTS actor_activation_invitation_jobs; DROP TABLE IF EXISTS actor_activation_invitations; DROP TABLE IF EXISTS actor_activation_causes; DROP TABLE IF EXISTS routine_clock_advances; DROP TABLE IF EXISTS model_time_spans; DROP TABLE IF EXISTS model_time_run_state; DROP TABLE IF EXISTS run_preflight_job_operations; DROP TABLE IF EXISTS run_preflight_job_results; DROP TABLE IF EXISTS run_preflight_job_history; DROP TABLE IF EXISTS run_preflight_jobs; DROP TABLE IF EXISTS pi_access_job_operations; DROP TABLE IF EXISTS pi_access_job_results; DROP TABLE IF EXISTS pi_access_job_history; DROP TABLE IF EXISTS pi_access_jobs; DROP TABLE IF EXISTS pi_oauth_job_operations; DROP TABLE IF EXISTS pi_oauth_job_results; DROP TABLE IF EXISTS pi_oauth_job_history; DROP TABLE IF EXISTS pi_oauth_jobs; DROP TABLE IF EXISTS circumstance_operations;DROP TABLE IF EXISTS actor_state_cuts; DROP TABLE IF EXISTS actor_state_cut_batches; DROP TABLE IF EXISTS fork_projection_receipts; DROP TABLE IF EXISTS fork_job_history; DROP TABLE IF EXISTS fork_dramatic_seeds; DROP TABLE IF EXISTS fork_job_retries; DROP TABLE IF EXISTS fork_backup_sources; DROP TABLE IF EXISTS fork_jobs; DROP TABLE IF EXISTS identity_promotion_receipts; DROP TABLE IF EXISTS actor_job_identity_bindings; DROP TABLE IF EXISTS actor_pi_session_archives; DROP TABLE IF EXISTS actor_identity_session_bindings; DROP TABLE IF EXISTS actor_identity_epochs; DROP TABLE IF EXISTS configurator_http_operations; DROP TABLE IF EXISTS configurator_consents; DROP TABLE IF EXISTS configurator_operations; DROP TABLE IF EXISTS configurator_candidates; DROP TABLE IF EXISTS configurator_checkpoints; DROP TABLE IF EXISTS configurator_sessions; DROP TABLE IF EXISTS configurator_generations; DROP TABLE IF EXISTS configurator_jobs; DROP TABLE IF EXISTS run_configuration_revisions; DROP TRIGGER IF EXISTS actor_initiatives_source_immutable; DROP INDEX IF EXISTS actor_initiatives_ready; DROP INDEX IF EXISTS actor_initiatives_one_open_per_actor; DROP INDEX IF EXISTS actor_turn_jobs_initiative; DROP TABLE IF EXISTS actor_initiatives; DELETE FROM schema_version WHERE version=45; DELETE FROM schema_version WHERE version IN(13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44); COMMIT;`);
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
    assert.throws(() => journal.retryActorTurnJob({ runId, actorId: maxId, jobId: scope.jobId, expectedGeneration: 1, pulseId }), /solicitudes inciertas/);
    // The controlled transport has now supplied its terminal receipt; retry must not
    // erase the dispatched reservation or create work while its outcome is unknown.
    journal.transitionReservation({ jobId: scope.jobId, generation: scope.generation, requestSeq: 0, target: 'completed' });
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
      assert.equal(inspect.prepare('SELECT state FROM request_reservations WHERE job_id=? AND generation=1').get(scope.jobId)?.state, 'completed', 'el recibo terminal de la generación anterior permanece tras retry');
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
  const actorIds=[...new Set([maxId,agentId,...active])];
  const prepared = actorIds.map((characterId) => {
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
    continuity, roster: { eligibleCharacterIds: actorIds, preparedCharacters: prepared, activeCharacterIds: active },
    humanParticipants: [{ identity: { participantId: 'interlocutor-andres', displayName: 'Andrés', identityMarkdown: 'Identidad sintética.', lifeStoryMarkdown: 'Historia sintética.' },
      presence: { kind: 'inScene', sceneId, placeId: roomId, position: { x: 0.5, y: 1 }, channelId } }], worldSnapshot: world,
    dramaticLine: { purpose: 'Prueba', question: { kind: 'absent' }, conflict: { kind: 'not-formulated' } }, circadianPolicy: { kind: 'manual-only' }, language: 'es',
    spanishVariety: { kind: 'proposed', label: 'Español de prueba', source: 'editorial-proposal' }, narrationMode: { kind: 'disabled' },
    budget: { maxPiCallsPerRun: 8, maxPiCallsPerPulse: 1, maxConcurrentPiRequests: 1, maxWallTimeMs: 60_000 }, maxReformulations: 1,
    audio: { mode: { kind: 'disabled' }, speakerSlots: [], narratorSlot: { kind: 'absent' }, soundEffectSlots: [] },
    snapshotFence: { runId, revision: world.revision, seq: world.seq, fictionalAt: world.clock.instant }, preparedActorFences: [], participantAvailability: [] });
}

function routineConfigurationFixture(policy:unknown,windows:[number,number][]= [[1_000,1_500]]) {
  const source=worldFixture();
  const world=WorldSnapshotSchema.parse({...source,entities:source.entities.map((entity)=>entity.kind==='character'
    ?{...entity,routine:entity.characterId===maxId?{kind:'windows',defaultState:'unavailable',windows:windows.map(([from,to])=>({from,to,state:'available'}))}:{kind:'always'}}:entity)});
  return ReadyRunConfigurationSchema.parse({...coordinatorConfigurationFixture([maxId,agentId],world),circadianPolicy:policy});
}

test('routine clock remains frozen between scenes without creating an event, commit or activation', () => {
  withJournal((journal, path) => {
    registerRun(journal, routineConfigurationFixture({ kind: 'advance-while-running', maxAdvanceMs: 1000 }));
    const closed = journal.applyDramaticStructureCommand({ runId, principalId: dramaticStructurePrincipalId,
      operationId: uuid(39_040), idempotencyKey: uuid(39_041), expectedWorldRevision: 0, expectedStructureRevision: 0,
      command: { kind: 'closeScene', sceneId, reason: 'Fin explícito antes de la próxima rutina' } });
    assert.equal(closed.kind, 'stored');
    const before = journal.loadWorld({ runId });
    assert.equal(before?.activeSceneId, null);
    const database = new DatabaseSync(path);
    try {
      const counts = () => ['world_events', 'world_commits', 'routine_clock_advances', 'actor_activation_causes', 'actor_activation_invitations'].map(table =>
        database.prepare(`SELECT count(*) AS count FROM ${table} WHERE run_id=?`).get(runId));
      const beforeCounts = counts();
      const result = journal.advanceRoutineClock({ runId, operationId: uuid(39_042) });
      assert.equal(result.kind, 'notApplicable');
      if (result.kind === 'notApplicable') assert.equal(result.reason, 'no-active-scene');
      assert.deepEqual(journal.loadWorld({ runId }), before);
      assert.deepEqual(counts(), beforeCounts);
    } finally { database.close(); }
  });
});

test('v32 avanza sólo con política activa, acota el salto, reintenta por receipt y convoca al cruzar rutina',()=>{
  const policy={kind:'advance-while-running',maxAdvanceMs:1_000};
  withJournal((journal)=>{
    registerRun(journal,routineConfigurationFixture({kind:'manual-only'}));
    const manual=journal.advanceRoutineClock({runId,operationId:uuid(39_000)});
    assert.equal(manual.kind,'notApplicable');if(manual.kind==='notApplicable')assert.equal(manual.reason,'policy');
    assert.equal(journal.loadWorld({runId})?.clock.instant,0);
  });
  withJournal((journal)=>{
    registerRun(journal,routineConfigurationFixture({kind:'advance-while-running',maxAdvanceMs:999}));
    const capped=journal.advanceRoutineClock({runId,operationId:uuid(39_001)});
    assert.equal(capped.kind,'notApplicable');if(capped.kind==='notApplicable')assert.equal(capped.reason,'boundary-too-far');
    assert.equal(journal.loadWorld({runId})?.clock.instant,0);
  });
  withJournal((journal)=>{
    registerRun(journal,routineConfigurationFixture(policy));
    const before=journal.readWorldLifecycle({runId});assert.ok(before);
    assert.equal(journal.setWorldLifecycle({runId,expectedWorldRevision:before.worldRevision,expectedConfigRevision:before.configRevision,target:'paused'}),'updated');
    const paused=journal.advanceRoutineClock({runId,operationId:uuid(39_002)});
    assert.equal(paused.kind,'notApplicable');if(paused.kind==='notApplicable')assert.equal(paused.reason,'inactive');
    assert.equal(journal.loadWorld({runId})?.clock.instant,0);
  });
  withJournal((journal,path)=>{
    registerRun(journal,routineConfigurationFixture(policy));
    const operationId=uuid(39_003);
    const advanced=journal.advanceRoutineClock({runId,operationId});
    assert.equal(advanced.kind,'advanced');if(advanced.kind!=='advanced')assert.fail('No se avanzó hasta la siguiente frontera');
    assert.equal(advanced.worldSeq,1);assert.equal(advanced.worldRevision,1);assert.equal(advanced.activationIds.length,1);
    assert.equal(journal.loadWorld({runId})?.clock.instant,1_000);
    journal.close();
    const reopened=openJournal({path});
    try{
      const replay=reopened.advanceRoutineClock({runId,operationId});assert.equal(replay.kind,'existing');
      assert.equal(reopened.loadWorld({runId})?.clock.instant,1_000);
      const begun=reopened.beginCoordinatorPulse({runId});assert.equal(begun.kind,'started');
      if(begun.kind!=='started')assert.fail('No se consumió la convocatoria durable');
      assert.deepEqual(begun.pulse.cause,{kind:'actorActivation',id:advanced.activationIds[0],trigger:{kind:'routine-boundary',boundaryAt:1_000}});
      assert.equal(begun.jobs.length,1);assert.deepEqual(begun.jobs[0]?.perceptionIds,[]);
      assert.deepEqual(begun.jobs[0]?.activation?.trigger,{kind:'routine-boundary',boundaryAt:1_000});
      const observations=reopened.readObservationEvents({runId,fromWorldSeq:1,toWorldSeq:1,afterWorldSeq:null,limit:10,communicationsOnly:false});
      assert.equal(observations?.[0]?.event.kind,'clockAdvanced');
      const inspect=new DatabaseSync(path);
      try{
        assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_perceptions WHERE run_id=?').get(runId)?.n,0);
        assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_commits WHERE run_id=?').get(runId)?.n,1);
        assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_events WHERE run_id=?').get(runId)?.n,1);
      }finally{inspect.close();}
    }finally{reopened.close();}
  });
  withJournal((journal)=>{
    registerRun(journal,routineConfigurationFixture({kind:'manual-only'},[[0,50],[100,300]]));
    registerAttempt(journal,proposalId,1,waitAttempt(39_004,maxId,0));
    const committed=journal.commitWorldAttempt({runId,proposalId,version:1,ids:idSource(39_100)});
    assert.equal(committed.resolution.kind,'applied');assert.equal(committed.resolution.newSnapshot.clock.instant,100);
    const begun=journal.beginCoordinatorPulse({runId});assert.equal(begun.kind,'started');
    if(begun.kind!=='started')assert.fail('El cruce producido por acción no convocó la ventana nueva');
    assert.equal(begun.pulse.cause.kind,'actorActivation');
    if(begun.pulse.cause.kind==='actorActivation')assert.deepEqual(begun.pulse.cause.trigger,{kind:'routine-boundary',boundaryAt:100});
    assert.equal(begun.jobs.length,1);assert.deepEqual(begun.jobs[0]?.perceptionIds,[]);
  });
});

test('fin de descanso vuelve a disponibilidad por defecto y admite un job con el mismo límite efectivo',()=>{
  withJournal((journal)=>{
    const configuration=routineConfigurationFixture({kind:'advance-while-running',maxAdvanceMs:1_000});
    const worldSnapshot=WorldSnapshotSchema.parse({...configuration.worldSnapshot,
      entities:configuration.worldSnapshot.entities.map((entity)=>entity.kind==='character'&&entity.characterId===maxId
        ?{...entity,routine:{kind:'windows',defaultState:'available',windows:[{from:0,to:1_000,state:'unavailable'}]}}:entity)});
    registerRun(journal,ReadyRunConfigurationSchema.parse({...configuration,worldSnapshot}));
    const result=journal.advanceRoutineClock({runId,operationId:uuid(39_230)});
    assert.equal(result.kind,'advanced');if(result.kind!=='advanced')assert.fail('No avanzó hasta fin de descanso');
    assert.equal(result.activationIds.length,1);
    const begun=journal.beginCoordinatorPulse({runId});assert.equal(begun.kind,'started');
    if(begun.kind!=='started')assert.fail('No convocó la vuelta a disponibilidad por defecto');
    assert.equal(begun.jobs.length,1);const job=begun.jobs[0];assert.ok(job);
    assert.deepEqual(job.activation?.trigger,{kind:'routine-boundary',boundaryAt:1_000});
    assert.deepEqual(job.perceptionIds,[]);
    const claimed=journal.claimActorTurnJob({runId,actorId:job.actorId,jobId:job.jobId,generation:job.generation,
      ownerToken:uuid(39_231),claimToken:uuid(39_232)});
    assert.equal(claimed.kind,'claimed','la revalidación comparte el criterio efectivo del planner');
  });
  withJournal((journal)=>{
    const configuration=routineConfigurationFixture({kind:'advance-while-running',maxAdvanceMs:1_000});
    const worldSnapshot=WorldSnapshotSchema.parse({...configuration.worldSnapshot,
      entities:configuration.worldSnapshot.entities.map((entity)=>entity.kind==='character'&&entity.characterId===maxId
        ?{...entity,routine:{kind:'windows',defaultState:'available',windows:[{from:1_000,to:2_000,state:'available'}]}}:entity)});
    registerRun(journal,ReadyRunConfigurationSchema.parse({...configuration,worldSnapshot}));
    const result=journal.advanceRoutineClock({runId,operationId:uuid(39_233)});
    assert.equal(result.kind,'advanced');if(result.kind==='advanced')assert.deepEqual(result.activationIds,[]);
    assert.equal(journal.beginCoordinatorPulse({runId}).kind,'idle','available→available no inventa una convocatoria');
  });
});

test('el coordinador descarta convocatorias agotadas sin saltar una válida ni terminar su step',()=>{
  withJournal((journal,path)=>{
    registerRun(journal,routineConfigurationFixture({kind:'advance-while-running',maxAdvanceMs:1_000},[[1_000,1_500],[2_000,3_000]]));
    const old=journal.advanceRoutineClock({runId,operationId:uuid(39_240)});
    assert.equal(old.kind,'advanced');if(old.kind!=='advanced')assert.fail('Falta primera convocatoria');
    assert.equal(journal.advanceRoutineClock({runId,operationId:uuid(39_241)}).kind,'advanced');
    const current=journal.advanceRoutineClock({runId,operationId:uuid(39_242)});
    assert.equal(current.kind,'advanced');if(current.kind!=='advanced')assert.fail('Falta convocatoria vigente');
    const oldId=old.activationIds[0];const currentId=current.activationIds[0];assert.ok(oldId);assert.ok(currentId);
    const stepId=uuid(39_243);const inspect=new DatabaseSync(path);
    try{
      // Both causes are real durable admissions. Enforce chronology independently of wall-clock resolution.
      inspect.prepare('UPDATE actor_activation_causes SET created_at=1 WHERE activation_id=?').run(oldId);
      inspect.prepare('UPDATE actor_activation_causes SET created_at=2 WHERE activation_id=?').run(currentId);
      const lifecycle=journal.readWorldLifecycle({runId});assert.ok(lifecycle);
      inspect.prepare("INSERT INTO run_step_jobs VALUES(?,?,NULL,'queued',0,?,0,0)").run(stepId,runId,lifecycle.lifecycleRevision);
      const begun=journal.beginCoordinatorPulse({runId,emptyStepPolicy:'defer'});
      assert.equal(begun.kind,'started');if(begun.kind!=='started')assert.fail('Se saltó la convocatoria vigente tras descartar la anterior');
      assert.deepEqual(begun.pulse.cause,{kind:'actorActivation',id:currentId,trigger:{kind:'routine-boundary',boundaryAt:2_000}});
      assert.equal(inspect.prepare('SELECT state FROM actor_activation_causes WHERE activation_id=?').get(oldId)?.state,'blocked');
      const step=journal.readActiveRunStepJob({runId});assert.ok(step);
      assert.equal(step.jobId,stepId);assert.equal(step.state,'running');assert.equal(step.pulseId,begun.pulse.pulseId);
      assert.equal(journal.loadWorld({runId})?.clock.instant,2_000);
    }finally{inspect.close();}
  });
});

test('reloj idle rechaza trabajo en vuelo aunque se lo invoque directamente desde el host',()=>{
  withJournal((journal,path)=>{
    registerRun(journal,routineConfigurationFixture({kind:'advance-while-running',maxAdvanceMs:1_000}));
    assert.equal(journal.advanceRoutineClock({runId,operationId:uuid(39_250)}).kind,'advanced');
    const begun=journal.beginCoordinatorPulse({runId});assert.equal(begun.kind,'started');
    if(begun.kind!=='started')assert.fail('Falta pulso con job encolado');
    const job=begun.jobs[0];assert.ok(job);const before=journal.loadWorld({runId});
    const inspect=new DatabaseSync(path);
    let operation=39_251;
    const blocked=()=>{
      const result=journal.advanceRoutineClock({runId,operationId:uuid(operation++)});
      assert.equal(result.kind,'notApplicable');
      if(result.kind==='notApplicable')assert.equal(result.reason,'work-pending');
      assert.deepEqual(journal.loadWorld({runId}),before);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM routine_clock_advances WHERE run_id=?').get(runId)?.n,1);
    };
    try{
      blocked();
      inspect.prepare("UPDATE coordinator_pulses SET state='completed' WHERE pulse_id=?").run(begun.pulse.pulseId);
      blocked(); // The queued job alone is sufficient to fence the clock.
      inspect.prepare("UPDATE coordinator_pulses SET state='running' WHERE pulse_id=?").run(begun.pulse.pulseId);
      const lease={ownerToken:uuid(39_260),claimToken:uuid(39_261)};
      const claimed=journal.claimActorTurnJob({runId,actorId:job.actorId,jobId:job.jobId,generation:job.generation,...lease});
      assert.equal(claimed.kind,'claimed');
      inspect.prepare("UPDATE coordinator_pulses SET state='completed' WHERE pulse_id=?").run(begun.pulse.pulseId);
      blocked(); // A claimed actor remains in flight even without a running coordinator row.
      inspect.prepare("UPDATE coordinator_pulses SET state='running' WHERE pulse_id=?").run(begun.pulse.pulseId);
      const failed=journal.failActorTurnJob({execution:{runId,actorId:job.actorId,jobId:job.jobId,generation:job.generation,
        pulseId:job.pulseId,lease},code:'execution-failed'});
      assert.equal(failed.kind,'blocked');
      blocked(); // A pulse still awaiting administrative work must close first.
      assert.equal(journal.closeCoordinatorPulse({runId,pulseId:begun.pulse.pulseId}).state,'blocked');
      const advanced=journal.advanceRoutineClock({runId,operationId:uuid(39_262)});
      assert.equal(advanced.kind,'advanced');assert.equal(journal.loadWorld({runId})?.clock.instant,1_500);
    }finally{inspect.close();}
  });
});

function routineOffersConfigurationFixture() {
  const configuration=routineConfigurationFixture({kind:'advance-while-running',maxAdvanceMs:1_000});
  const objectEntityId=uuid(39_200);
  const offer=(id:number,expiresAt:number)=>({state:'open',id:uuid(id),handle:`offer-${id}`,
    objectEntityId,ownerEntityId:maxEntity,recipientCharacterId:agentId,objectRevision:0,createdAt:0,expiresAt});
  const worldSnapshot=WorldSnapshotSchema.parse({...configuration.worldSnapshot,
    entities:[...configuration.worldSnapshot.entities,{kind:'object',entityId:objectEntityId,label:'Sobre',description:'Sobre sintético.',
      collisionRadius:0,blocksMovement:false,portable:true}],
    inventory:[{objectEntityId,revision:0,location:{kind:'heldBy',entityId:maxEntity}}],
    offers:[offer(39_203,1_000),offer(39_202,500),offer(39_201,500),offer(39_204,1_501),
      {...offer(39_205,100),state:'accepted',eventId:uuid(39_206)}]});
  return ReadyRunConfigurationSchema.parse({...configuration,worldSnapshot});
}

test('avance de rutina invalida ofertas al vencer con tiempos y origen durables sin repetir efectos al reabrir',()=>{
  withJournal((journal,path)=>{
    registerRun(journal,routineOffersConfigurationFixture());
    const operationId=uuid(39_210);
    const result=journal.advanceRoutineClock({runId,operationId});
    assert.equal(result.kind,'advanced');if(result.kind!=='advanced')assert.fail('No avanzó el reloj');
    assert.equal(result.worldSeq,4);assert.equal(result.worldRevision,1);
    const snapshot=journal.loadWorld({runId});assert.ok(snapshot);
    assert.equal(snapshot.clock.instant,1_000);
    const events=journal.readWorldEvents({runId});
    assert.deepEqual(events.map((event)=>event.kind),['clockAdvanced','offerInvalidated','offerInvalidated','offerInvalidated']);
    assert.deepEqual(events.map((event)=>event.seq),[1,2,3,4]);
    assert.deepEqual(events.map((event)=>event.fictitiousAt),[0,500,500,1_000]);
    for(const event of events)assert.deepEqual(event.origin,{kind:'system',causeClockAdvanceId:operationId});
    assert.deepEqual(events.filter((event)=>event.kind==='offerInvalidated').map((event)=>event.offerId),
      [uuid(39_201),uuid(39_202),uuid(39_203)]);
    for(const offer of snapshot.offers){
      if(offer.id===uuid(39_204)){assert.equal(offer.state,'open');continue;}
      if(offer.id===uuid(39_205)){assert.equal(offer.state,'accepted');continue;}
      assert.equal(offer.state,'invalidated');if(offer.state!=='invalidated')assert.fail('Oferta vencida sigue abierta');
      assert.equal(offer.cause,'expired');
      const event=events.find((event)=>event.id===offer.eventId);assert.equal(event?.kind,'offerInvalidated');
      assert.equal(event?.fictitiousAt,offer.expiresAt);
    }
    const inspect=new DatabaseSync(path);
    try{
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_perceptions WHERE run_id=?').get(runId)?.n,0);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_commits WHERE run_id=?').get(runId)?.n,1);
    }finally{inspect.close();}
    journal.close();const reopened=openJournal({path});
    try{
      assert.deepEqual(reopened.advanceRoutineClock({runId,operationId}),{...result,kind:'existing'});
      assert.deepEqual(reopened.loadWorld({runId}),snapshot);
      assert.deepEqual(reopened.readWorldEvents({runId}),events);
      const observations=reopened.readObservationEvents({runId,fromWorldSeq:1,toWorldSeq:4,afterWorldSeq:null,limit:10,communicationsOnly:false});
      assert.deepEqual(observations?.map((row)=>row.event),events);
    }finally{reopened.close();}
  });
});

test('fallo al persistir expiración revierte reloj, ofertas, eventos, convocatoria y recibo en una transacción',()=>{
  withJournal((journal,path)=>{
    registerRun(journal,routineOffersConfigurationFixture());
    const operationId=uuid(39_220);const before=journal.loadWorld({runId});
    const inspect=new DatabaseSync(path);
    try{
      inspect.exec(`CREATE TRIGGER fail_routine_offer BEFORE INSERT ON world_events
        WHEN json_extract(NEW.payload_json,'$.kind')='offerInvalidated'
        BEGIN SELECT RAISE(ABORT,'injected routine expiry failure'); END`);
      assert.throws(()=>journal.advanceRoutineClock({runId,operationId}),/injected routine expiry failure/);
      assert.deepEqual(journal.loadWorld({runId}),before);
      assert.deepEqual(journal.readWorldEvents({runId}),[]);
      for(const table of ['world_commits','routine_clock_advances','actor_activation_causes','world_perceptions'])
        assert.equal(inspect.prepare(`SELECT COUNT(*) n FROM ${table} WHERE run_id=?`).get(runId)?.n,0);
      inspect.exec('DROP TRIGGER fail_routine_offer');
      const retried=journal.advanceRoutineClock({runId,operationId});assert.equal(retried.kind,'advanced');
      if(retried.kind==='advanced')assert.equal(retried.worldSeq,4);
      assert.equal(journal.loadWorld({runId})?.clock.instant,1_000);
    }finally{inspect.close();}
  });
});

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
    try { downgradeCoordinatorPulsesTo44(legacy); legacy.exec('DROP TABLE preparation_configurator_records; DROP TABLE preparation_configurator_operations; DROP TABLE preparation_configurator_jobs; DROP TABLE model_budget_authorities; DROP TRIGGER icm_context_packets_no_update; DROP TRIGGER icm_context_packets_no_delete; DROP TABLE icm_context_packets; DROP INDEX coordinator_pulses_parked_for; ALTER TABLE coordinator_pulses DROP COLUMN parked_for_pulse_id; DROP TABLE actor_activation_invitation_jobs; DROP TABLE actor_activation_invitations; DROP TABLE actor_activation_causes; DROP TABLE routine_clock_advances; DROP TABLE coordinator_pulses; DROP TABLE IF EXISTS model_time_spans; DROP TABLE IF EXISTS model_time_run_state; DROP TABLE IF EXISTS run_preflight_job_operations; DROP TABLE IF EXISTS run_preflight_job_results; DROP TABLE IF EXISTS run_preflight_job_history; DROP TABLE IF EXISTS run_preflight_jobs; DROP TABLE IF EXISTS pi_access_job_operations; DROP TABLE IF EXISTS pi_access_job_results; DROP TABLE IF EXISTS pi_access_job_history; DROP TABLE IF EXISTS pi_access_jobs; DROP TABLE IF EXISTS pi_oauth_job_operations; DROP TABLE IF EXISTS pi_oauth_job_history; DROP TABLE IF EXISTS pi_oauth_jobs; DROP TABLE IF EXISTS circumstance_operations;DROP TABLE IF EXISTS actor_state_cuts; DROP TABLE IF EXISTS actor_state_cut_batches; DROP TABLE IF EXISTS fork_projection_receipts; DROP TABLE IF EXISTS fork_job_history; DROP TABLE IF EXISTS fork_dramatic_seeds; DROP TABLE IF EXISTS fork_job_retries; DROP TABLE IF EXISTS fork_backup_sources; DROP TABLE IF EXISTS fork_jobs; DROP TABLE IF EXISTS identity_promotion_receipts; DROP TABLE IF EXISTS actor_job_identity_bindings; DROP TABLE IF EXISTS actor_pi_session_archives; DROP TABLE IF EXISTS actor_identity_session_bindings; DROP TABLE IF EXISTS actor_identity_epochs; DROP TABLE IF EXISTS configurator_http_operations; DROP TABLE IF EXISTS configurator_consents; DROP TABLE IF EXISTS configurator_operations; DROP TABLE IF EXISTS configurator_candidates; DROP TABLE IF EXISTS configurator_checkpoints; DROP TABLE IF EXISTS configurator_sessions; DROP TABLE IF EXISTS configurator_generations; DROP TABLE IF EXISTS configurator_jobs; DROP TABLE IF EXISTS run_configuration_revisions; DROP TRIGGER IF EXISTS actor_initiatives_source_immutable; DROP INDEX IF EXISTS actor_initiatives_ready; DROP INDEX IF EXISTS actor_initiatives_one_open_per_actor; DROP INDEX IF EXISTS actor_turn_jobs_initiative; DROP TABLE IF EXISTS actor_initiatives; ALTER TABLE actor_turn_jobs DROP COLUMN initiative_id; DELETE FROM schema_version WHERE version=45; DELETE FROM schema_version WHERE version IN(14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44);'); } finally { legacy.close(); }
    journal = openJournal({ path });
    const begun = journal.beginCoordinatorPulse({ runId });
    if (begun.kind !== 'started') assert.fail('No se creó pulso');
    assert.equal(begun.pulse.lifecycleRevision,journal.readWorldLifecycle({runId})?.lifecycleRevision);
    if (begun.pulse.cause.kind !== 'humanIntervention') assert.fail('Se esperaba una causa de intervención humana');
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
    journal.transitionReservation({ jobId: scope.jobId, generation: scope.generation, requestSeq: 0, ownerToken: lease.ownerToken,
      target: 'dispatched', wallTime: { clockEpochId: uuid(30_006), monotonicNs: '0' } });
    journal.failActorTurnJob({ execution: { ...scope, actorId: maxId, lease }, code: 'pi-incomplete' });
    assert.throws(() => journal.retryActorTurnJob({ runId, actorId: maxId, jobId: scope.jobId, expectedGeneration: 0, pulseId: begun.pulse.pulseId }), /solicitudes inciertas/);
    journal.transitionReservation({ jobId: scope.jobId, generation: scope.generation, requestSeq: 0, ownerToken: lease.ownerToken,
      target: 'completed', wallTime: { clockEpochId: uuid(30_006), monotonicNs: '1000000' } });
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
  } finally { try { journal.close(); } catch { /* openJournal cierra el handle si la migración falla. */ } rmSync(directory, {recursive:true,force:true}); }
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
    try{downgradeCoordinatorPulsesTo44(legacy); legacy.exec(`DROP TABLE preparation_configurator_records; DROP TABLE preparation_configurator_operations; DROP TABLE preparation_configurator_jobs; DROP TABLE model_budget_authorities; DROP TRIGGER icm_context_packets_no_update; DROP TRIGGER icm_context_packets_no_delete; DROP TABLE icm_context_packets; DROP INDEX coordinator_pulses_parked_for; ALTER TABLE coordinator_pulses DROP COLUMN parked_for_pulse_id; DROP TABLE continuista_receipts;DROP TABLE continuista_candidates;DROP TABLE continuista_checkpoints;DROP TABLE continuista_request_leases;DROP TABLE continuista_sessions;DROP TABLE continuista_jobs;DROP TABLE IF EXISTS actor_activation_invitation_jobs; DROP TABLE IF EXISTS actor_activation_invitations; DROP TABLE IF EXISTS actor_activation_causes; DROP TABLE IF EXISTS routine_clock_advances; DROP TABLE IF EXISTS model_time_spans; DROP TABLE IF EXISTS model_time_run_state; DROP TABLE IF EXISTS run_preflight_job_operations; DROP TABLE IF EXISTS run_preflight_job_results; DROP TABLE IF EXISTS run_preflight_job_history; DROP TABLE IF EXISTS run_preflight_jobs; DROP TABLE IF EXISTS pi_access_job_operations; DROP TABLE IF EXISTS pi_access_job_results; DROP TABLE IF EXISTS pi_access_job_history; DROP TABLE IF EXISTS pi_access_jobs; DROP TABLE IF EXISTS pi_oauth_job_operations; DROP TABLE IF EXISTS pi_oauth_job_history; DROP TABLE IF EXISTS pi_oauth_jobs; DROP TABLE IF EXISTS circumstance_operations;DROP TABLE IF EXISTS actor_state_cuts; DROP TABLE IF EXISTS actor_state_cut_batches; DROP TABLE IF EXISTS fork_projection_receipts; DROP TABLE IF EXISTS fork_job_history; DROP TABLE IF EXISTS fork_dramatic_seeds; DROP TABLE IF EXISTS fork_job_retries; DROP TABLE IF EXISTS fork_backup_sources; DROP TABLE IF EXISTS fork_jobs; DROP TABLE IF EXISTS identity_promotion_receipts; DROP TABLE IF EXISTS actor_job_identity_bindings; DROP TABLE IF EXISTS actor_pi_session_archives; DROP TABLE IF EXISTS actor_identity_session_bindings; DROP TABLE IF EXISTS actor_identity_epochs; DROP TABLE IF EXISTS configurator_http_operations; DROP TABLE IF EXISTS configurator_consents; DROP TABLE IF EXISTS configurator_operations; DROP TABLE IF EXISTS configurator_candidates; DROP TABLE IF EXISTS configurator_checkpoints; DROP TABLE IF EXISTS configurator_sessions; DROP TABLE IF EXISTS configurator_generations; DROP TABLE IF EXISTS configurator_jobs; DROP TABLE IF EXISTS run_configuration_revisions; DROP TRIGGER IF EXISTS actor_initiatives_source_immutable; DROP INDEX IF EXISTS actor_initiatives_ready; DROP INDEX IF EXISTS actor_initiatives_one_open_per_actor; DROP INDEX IF EXISTS actor_turn_jobs_initiative; DROP TABLE IF EXISTS actor_initiatives; ALTER TABLE actor_turn_jobs DROP COLUMN initiative_id; DELETE FROM schema_version WHERE version=45; DELETE FROM schema_version WHERE version IN(15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44);`);}finally{legacy.close();}
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
      downgradeCoordinatorPulsesTo44(before); before.exec('DROP TABLE preparation_configurator_records; DROP TABLE preparation_configurator_operations; DROP TABLE preparation_configurator_jobs; DROP TABLE model_budget_authorities; DROP TRIGGER icm_context_packets_no_update; DROP TRIGGER icm_context_packets_no_delete; DROP TABLE icm_context_packets; DROP INDEX coordinator_pulses_parked_for; ALTER TABLE coordinator_pulses DROP COLUMN parked_for_pulse_id; DROP TABLE actor_turn_reconciliations;DROP TABLE actor_terminal_proposals;DROP TABLE IF EXISTS actor_activation_invitation_jobs; DROP TABLE IF EXISTS actor_activation_invitations; DROP TABLE IF EXISTS actor_activation_causes; DROP TABLE IF EXISTS routine_clock_advances; DROP TABLE IF EXISTS model_time_spans; DROP TABLE IF EXISTS model_time_run_state; DROP TABLE IF EXISTS run_preflight_job_operations; DROP TABLE IF EXISTS run_preflight_job_results; DROP TABLE IF EXISTS run_preflight_job_history; DROP TABLE IF EXISTS run_preflight_jobs; DROP TABLE IF EXISTS pi_access_job_operations; DROP TABLE IF EXISTS pi_access_job_results; DROP TABLE IF EXISTS pi_access_job_history; DROP TABLE IF EXISTS pi_access_jobs; DROP TABLE IF EXISTS pi_oauth_job_operations; DROP TABLE IF EXISTS pi_oauth_job_history; DROP TABLE IF EXISTS pi_oauth_jobs; DROP TABLE IF EXISTS circumstance_operations;DROP TABLE IF EXISTS actor_state_cuts; DROP TABLE IF EXISTS actor_state_cut_batches; DROP TABLE IF EXISTS fork_projection_receipts; DROP TABLE IF EXISTS fork_job_history; DROP TABLE IF EXISTS fork_dramatic_seeds; DROP TABLE IF EXISTS fork_job_retries; DROP TABLE IF EXISTS fork_backup_sources; DROP TABLE IF EXISTS fork_jobs; DROP TABLE IF EXISTS identity_promotion_receipts; DROP TABLE IF EXISTS actor_job_identity_bindings; DROP TABLE IF EXISTS actor_pi_session_archives; DROP TABLE IF EXISTS actor_identity_session_bindings; DROP TABLE IF EXISTS actor_identity_epochs; DROP TABLE IF EXISTS configurator_http_operations; DROP TABLE IF EXISTS configurator_consents; DROP TABLE IF EXISTS configurator_operations; DROP TABLE IF EXISTS configurator_candidates; DROP TABLE IF EXISTS configurator_checkpoints; DROP TABLE IF EXISTS configurator_sessions; DROP TABLE IF EXISTS configurator_generations; DROP TABLE IF EXISTS configurator_jobs; DROP TABLE IF EXISTS run_configuration_revisions; DROP TRIGGER IF EXISTS actor_initiatives_source_immutable; DROP INDEX IF EXISTS actor_initiatives_ready; DROP INDEX IF EXISTS actor_initiatives_one_open_per_actor; DROP INDEX IF EXISTS actor_turn_jobs_initiative; DROP TABLE IF EXISTS actor_initiatives; ALTER TABLE actor_turn_jobs DROP COLUMN initiative_id; DELETE FROM schema_version WHERE version=45; DELETE FROM schema_version WHERE version IN(16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44);');}finally{before.close();}
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

test('un turno por otra causa reemplaza la iniciativa pendiente del actor en lugar de violar la única abierta', async () => {
  const directory=mkdtempSync(join(tmpdir(),'personajes-initiative-supersede-'));
  const path=join(directory,'world.sqlite');
  const journal=openJournal({path});
  try{
    await createQueuedHumanIntentFixture(journal,['Max, escuchame un momento.'],coordinatorConfigurationFixture([maxId,agentId]));
    const firstPulse=journal.beginCoordinatorPulse({runId});
    if(firstPulse.kind!=='started')assert.fail('La intervención humana debe convocar a Max');
    const firstJob=firstPulse.jobs.find((job)=>job.actorId===maxId);
    if(firstJob===undefined)assert.fail('Falta el turno de Max');
    const first=await acceptActorAttemptForTest({journal,directory,job:firstJob,seed:44_100,
      nextInitiative:'after-resolution',makeAttempt:(cut)=>waitAttempt(44_110,maxId,cut.worldRevision)});
    assert.equal(journal.commitWorldAttempt({runId,proposalId:first.proposalId,version:1,ids:idSource(44_120)}).resolution.kind,'applied');
    assert.equal(journal.closeCoordinatorPulse({runId,pulseId:firstPulse.pulse.pulseId}).state,'completed');
    const resolved=journal.loadWorld({runId});
    if(resolved===undefined)assert.fail('Falta el mundo resuelto');
    const later=journal.commitHumanIntervention({runId,participantId:'interlocutor-andres',expectedRevision:resolved.revision,idempotencyKey:uuid(44_125),
      request:{kind:'speech',recipientCharacterIds:[maxId],channelId,content:{kind:'speech',text:'Max, ¿seguís ahí?'}}});
    if(later.kind!=='stored'||later.resolution.kind!=='applied')assert.fail('La nueva intervención debe quedar confirmada');
    assert.equal((await createDeliverWorldWorker({journal,runId,actorId:maxId}).drain()).kind,'completed');
    const second=journal.beginCoordinatorPulse({runId});
    if(second.kind!=='started')assert.fail('La iniciativa debe convocar a Max');
    const secondJob=second.jobs.find((job)=>job.actorId===maxId);
    if(secondJob?.initiative===undefined)assert.fail('El turno debe llevar la iniciativa');
    // Live state from CONTROL: the actor holds a pending initiative while acting in a job without one.
    const database=new DatabaseSync(path);
    const perceptionId=journal.readQueuedActorTurnIntents({runId,actorId:maxId,limit:10})[0]?.perceptionId;
    if(perceptionId===undefined)assert.fail('La intervención debe estar entregada');
    database.prepare(`UPDATE actor_turn_jobs SET initiative_id=NULL WHERE run_id=? AND job_id=?`).run(runId,secondJob.jobId);
    database.prepare(`INSERT INTO actor_turn_job_inputs(run_id,actor_id,job_id,generation,perception_id,state,assigned_at,consumed_at)
      VALUES(?,?,?,?,?,'assigned',?,NULL)`).run(runId,maxId,secondJob.jobId,secondJob.generation,perceptionId,Date.now());
    database.prepare(`UPDATE actor_initiatives SET state='pending',assigned_pulse_id=NULL,assigned_job_id=NULL,assigned_generation=NULL WHERE run_id=?`).run(runId);
    database.close();
    const turn=await acceptActorAttemptForTest({journal,directory,job:secondJob,seed:44_200,
      nextInitiative:'after-resolution',makeAttempt:(cut)=>waitAttempt(44_210,maxId,cut.worldRevision)});
    assert.equal(journal.commitWorldAttempt({runId,proposalId:turn.proposalId,version:1,ids:idSource(44_220)}).resolution.kind,'applied');
    const reader=new DatabaseSync(path);
    const rows=z.array(z.strictObject({state:z.string(),failure_reason:z.string().nullable(),source_attempt_id:z.string()}))
      .parse(reader.prepare('SELECT state,failure_reason,source_attempt_id FROM actor_initiatives WHERE run_id=? ORDER BY created_at').all(runId));
    reader.close();
    assert.deepEqual(rows.map((row)=>[row.state,row.failure_reason]),[['blocked','superseded-by-later-turn'],['pending',null]]);
    assert.equal(rows[1]?.source_attempt_id,turn.attemptId);
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});

test('la actividad del coordinador distingue trabajo pendiente del reposo cuando nadie tiene causa', async () => {
  const directory=mkdtempSync(join(tmpdir(),'personajes-coordinator-idle-'));
  const journal=openJournal({path:join(directory,'world.sqlite')});
  try{
    await createQueuedHumanIntentFixture(journal,['Max, ¿estás ahí?'],coordinatorConfigurationFixture([maxId,agentId]));
    assert.equal(journal.readRunCoordinatorActivity({runId}),'working','la intervención entregada es una causa pendiente');
    const pulse=journal.beginCoordinatorPulse({runId});
    if(pulse.kind!=='started')assert.fail('La intervención debe convocar a Max');
    assert.equal(journal.readRunCoordinatorActivity({runId}),'working');
    const job=pulse.jobs.find((item)=>item.actorId===maxId);
    if(job===undefined)assert.fail('Falta el turno de Max');
    const turn=await acceptActorAttemptForTest({journal,directory,job,seed:45_100,makeAttempt:(cut)=>waitAttempt(45_110,maxId,cut.worldRevision)});
    assert.equal(journal.commitWorldAttempt({runId,proposalId:turn.proposalId,version:1,ids:idSource(45_120)}).resolution.kind,'applied');
    assert.equal(journal.closeCoordinatorPulse({runId,pulseId:pulse.pulse.pulseId}).state,'completed');
    for(const actorId of [maxId,agentId])assert.equal((await createDeliverWorldWorker({journal,runId,actorId}).drain()).kind,'completed');
    const witnesses=journal.beginCoordinatorPulse({runId});
    if(witnesses.kind==='started'){
      for(const witnessJob of witnesses.jobs){
        const quiet=await acceptActorAttemptForTest({journal,directory,job:witnessJob,seed:45_200,makeAttempt:(cut)=>waitAttempt(45_210,witnessJob.actorId,cut.worldRevision)});
        assert.equal(journal.commitWorldAttempt({runId,proposalId:quiet.proposalId,version:1,ids:idSource(45_220)}).resolution.kind,'applied');
      }
      assert.equal(journal.closeCoordinatorPulse({runId,pulseId:witnesses.pulse.pulseId}).state,'completed');
      for(const actorId of [maxId,agentId])assert.equal((await createDeliverWorldWorker({journal,runId,actorId}).drain()).kind,'completed');
    }
    assert.equal(journal.readRunCoordinatorActivity({runId}),'idle','esperar sin pedir continuar deja la obra en reposo');
    assert.deepEqual(journal.listCoordinatorPulseTargets(),[]);
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});
