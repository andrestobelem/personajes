import { z } from 'zod';
import { createSyntheticActorSession } from './fixtures/pi-session.ts';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { resolveReadyInferenceProfile } from '../src/domain/inference-profile.ts';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { verifyPiActorSessionIntegrity } from '../src/adapters/pi-session-integrity.ts';
import { openJournal } from '../src/adapters/journal.ts';
import { PiRuntime, createBudgetedStreamFunction, type CreatePiSessionInput, type PiPromptInput, type PiRequestReference } from '../src/adapters/pi.ts';
import { createContinuistaPiWorker } from '../src/application/continuista-pi-worker.ts';
import { validateContinuistaReviewContext } from '../src/application/continuista-review-context.ts';
import { createActorTurnWorker } from '../src/application/actor-turn-worker.ts';
import { createDeliverWorldWorker } from '../src/application/deliver-world.ts';
import { createEmptyRunConfigurationDraft, ProductionAudioSchema, RunConfigurationDraftSchema, type ProductionRoster } from '../src/domain/production.ts';
import { ContinuityContextSchema, PreparedCharacterSchema, SpanishVarietyForActingSchema, type PreparedCharacter } from '../src/domain/preparation.ts';
import { WorldSnapshotSchema, type WorldSnapshot } from '../src/domain/world.ts';
import { validateRunConfiguration, type ReadyRunConfiguration } from '../src/application/production-preflight.ts';
import { ContinuistaCriterionSchema } from '../src/domain/world-journal.ts';
import { CharacterIdSchema, RunIdSchema, PulseIdSchema, RevisionSchema, WorldSeqSchema } from '../src/domain/values.ts';
const runId = RunIdSchema.parse('00000000-0000-4000-8000-000000000101');
const actorId = CharacterIdSchema.parse('personaje-prueba');
const sceneId = '00000000-0000-4000-8000-000000000102';
const actorEntityId = '00000000-0000-4000-8000-000000000103';
const fictionalAt = 1_234_567_890_000;
const recordedAt = '2026-10-14T12:00:00.000Z';

// Synthetic, explicit fixtures. They are not saved scenes or canon records.
function continuityFixture() {
  return ContinuityContextSchema.parse({
    continuityId: 'continuidad-prueba', revision: 1, contentHash: 'a'.repeat(64),
    kind: 'original', label: 'Continuidad de prueba', milestones: [], inclusions: [],
  });
}

function preparedFixture(input: { characterId?: string; nonverbal?: boolean } = {}): PreparedCharacter {
  const characterId = CharacterIdSchema.parse(input.characterId ?? actorId);
  const continuity = continuityFixture();
  const continuityRef = {
    continuityId: continuity.continuityId,
    revision: continuity.revision,
    contentHash: continuity.contentHash,
  };
  const provenance = {
    kind: 'curator-declaration',
    dossierRevision: 1,
    dossierHash: 'd'.repeat(64),
    continuity: continuityRef,
    reason: 'Fixture sintético explícito para pruebas de puesta.',
    authoredBy: 'test-operator',
    createdAt: recordedAt,
    sourceRefs: [],
  };
  return PreparedCharacterSchema.parse({
    kind: 'prepared-character', schemaVersion: 1, characterId,
    dossierRevision: 1, dossierHash: 'd'.repeat(64), continuity, identityVersion: 1,
    identity: {
      value: {
        selfReference: 'Yo', selfConcept: 'Identidad de prueba.', values: [],
        dispositions: ['observador'], contradictions: [],
      }, provenance,
    },
    voice: {
      value: input.nonverbal === true
        ? { kind: 'nonverbal', description: 'Emite sonidos no léxicos.' }
        : { kind: 'spoken', recipe: 'Voz textual de prueba.' },
      provenance,
    },
    antecedents: { value: [], provenance },
    goals: {
      value: [{
        kind: 'durable', goalId: 'objetivo-prueba', ownerCharacterId: characterId,
        desiredOutcome: 'Comprender la situación inmediata.', priority: 0.7,
        reviewConditions: [], status: 'active', evidenceRefs: [],
      }],
      provenance,
    },
    relationships: { value: [], provenance },
    capabilities: {
      value: input.nonverbal === true
        ? [
            { capabilityId: 'movement', kind: 'movement', description: 'Se desplaza.' },
            { capabilityId: 'gesture', kind: 'gesture', description: 'Usa gestos.' },
            { capabilityId: 'nonverbal-sound', kind: 'nonverbal-sound', description: 'Emite sonidos.' },
          ]
        : [
            { capabilityId: 'speech', kind: 'speech', description: 'Habla.' },
            { capabilityId: 'movement', kind: 'movement', description: 'Se desplaza.' },
            { capabilityId: 'gesture', kind: 'gesture', description: 'Usa gestos.' },
          ],
      provenance,
    },
    inventory: { value: [], provenance },
    initialExperience: { value: { kind: 'none' }, provenance },
    unknownPolicy: {
      value: { defaultTreatment: 'do-not-infer-or-assert', fields: [] }, provenance,
    },
  });
}

function worldFixture(input: {
  nonverbal?: boolean;
  time?: number;
  availability?: 'available' | 'unavailable';
  routine?: unknown;
  speak?: boolean;
} = {}): WorldSnapshot {
  const nonverbal = input.nonverbal === true;
  const capabilities = nonverbal
    ? ['move', 'observe', 'gesture', 'animalSound', 'wait', 'rest']
    : ['move', 'observe', ...(input.speak === false ? [] : ['speak']), 'gesture', 'wait', 'rest'];
  return WorldSnapshotSchema.parse({
    schemaVersion: 1, runId, revision: 4, seq: 6,
    clock: { instant: input.time ?? fictionalAt, convention: { kind: 'fixedOffset', offsetMinutes: -180, label: 'Prueba' } },
    places: [{ id: 'sala', name: 'Sala', description: 'Lugar sintético.', width: 10, height: 10, lighting: 'normal' }],
    doors: [], connections: [], perceptualPaths: [],
    channels: nonverbal ? [
      { kind: 'gesture', id: '00000000-0000-4000-8000-000000000104', label: 'Gestos', enabled: true, modality: 'visual', maxRange: 4, scope: 'addressed', placeIds: ['sala'] },
    ] : [
      { kind: 'speech', id: '00000000-0000-4000-8000-000000000104', label: 'Voz', enabled: true, maxRange: 4, scope: 'addressed', placeIds: ['sala'] },
    ],
    entities: [{
      kind: 'character', entityId: actorEntityId, characterId: actorId,
      trueDisplayName: nonverbal ? 'Fang' : 'Personaje de prueba', species: nonverbal ? 'animal' : 'human',
      presentation: { kind: 'ordinary', label: nonverbal ? 'Perro' : 'Persona' },
      placeId: 'sala', position: { x: 2, y: 2 }, collisionRadius: 0.25, blocksMovement: false,
      presence: { kind: 'present', sceneId },
      preparation: { kind: 'prepared', continuityId: continuityFixture().continuityId, identityVersion: 1 },
      capabilities,
      availability: { kind: input.availability ?? 'available', ...(input.availability === 'unavailable' ? { reason: 'En reposo.' } : {}) },
      routine: input.routine ?? { kind: 'always' },
      mind: { goals: [], beliefs: [], relationships: [], recognizedCharacterIds: [], experiences: [] },
    }],
    inventory: [],
    scenes: [{ id: sceneId, label: 'Prueba', lifecycle: { kind: 'open', startedAt: input.time ?? fictionalAt }, participantIds: [actorId], placeIds: ['sala'] }],
    activeSceneId: sceneId, offers: [],
    actionDurations: {
      observeMs: 0, speechMs: 0, gestureMs: 0, takeMs: 0, offerMs: 0,
      acceptOfferMs: 0, maxWaitMs: 1_000, maxRestMs: 10_000,
      offerValidityMs: 1_000, interactionRange: 2,
    },
  });
}

function configured<T>(value: T) {
  return {
    kind: 'configured',
    value,
    evidence: { kind: 'operator-choice', operatorId: 'test-operator', recordedAt },
  };
}

function configuredRoster(prepared = preparedFixture()): ProductionRoster {
  return {
    eligibleCharacterIds: [prepared.characterId],
    preparedCharacters: [prepared],
    activeCharacterIds: [prepared.characterId],
  };
}

function draftFixture(input: {
  prepared?: PreparedCharacter;
  world?: WorldSnapshot;
  activeCharacterIds?: string[];
  variety?: unknown;
  narrationMode?: unknown;
  audio?: unknown;
  moment?: number;
  participantIds?: string[];
  humanParticipants?: unknown;
} = {}) {
  const prepared = input.prepared ?? preparedFixture();
  const world = input.world ?? worldFixture({ nonverbal: prepared.voice.value.kind === 'nonverbal' });
  const draft = createEmptyRunConfigurationDraft({ runId, revision: 7 });
  const scene = world.scenes.find((candidate) => candidate.id === world.activeSceneId);
  assert.ok(scene);
  const roster = configuredRoster(prepared);
  const configuredWorld = input.participantIds === undefined
    ? world
    : WorldSnapshotSchema.parse({
        ...world,
        scenes: world.scenes.map((candidate) => candidate.id === world.activeSceneId
          ? { ...candidate, participantIds: input.participantIds }
          : candidate),
        entities: world.entities.map((entity) => entity.kind === 'character'
          ? { ...entity, presence: { kind: 'present', sceneId } }
          : entity),
      });
  return RunConfigurationDraftSchema.parse({
    ...draft,
    name: configured('Representación de prueba'),
    fictionalAt: configured(input.moment ?? world.clock.instant),
    continuity: configured(continuityFixture()),
    roster: configured({ ...roster, activeCharacterIds: input.activeCharacterIds ?? roster.activeCharacterIds }),
    humanParticipants: configured(input.humanParticipants ?? []),
    worldSnapshot: configured(configuredWorld),
    dramaticLine: configured({
      purpose: 'Explorar una circunstancia cotidiana con agencia propia.',
      question: { kind: 'absent' }, conflict: { kind: 'not-formulated' },
    }),
    circadianPolicy: configured({ kind: 'manual-only' }),
    spanishVariety: configured(input.variety ?? SpanishVarietyForActingSchema.parse({
      kind: 'proposed', label: 'Español de doblaje (propuesta editorial)', source: 'editorial-proposal',
    })),
    narrationMode: configured(input.narrationMode ?? { kind: 'disabled' }),
    budget: configured({ maxPiCallsPerRun: 20, maxPiCallsPerPulse: 4, maxConcurrentPiRequests: 2, maxWallTimeMs: 60_000 }),
    audio: configured(input.audio ?? (draft.audio.kind === 'configured' ? draft.audio.value : ProductionAudioSchema.parse({
      mode: { kind: 'disabled' }, speakerSlots: [], narratorSlot: { kind: 'absent' }, soundEffectSlots: [],
    }))),
  });
}

function readyFixture(input: Parameters<typeof draftFixture>[0] = {}): ReadyRunConfiguration {
  const result = validateRunConfiguration({ draft: draftFixture(input) });
  if (result.kind !== 'ready') throw new Error('La fixture debe quedar ready.');
  return result.configuration;
}


function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
}

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-actor-worker-'));
  const journal = openJournal({ path: join(directory, 'journal.sqlite') });
  const configuration = readyFixture({ humanParticipants: [{
    identity: { participantId: 'visitante-prueba', displayName: 'Visitante', identityMarkdown: 'Identidad sintética.', lifeStoryMarkdown: 'Historia sintética.' },
    presence: { kind: 'inScene', sceneId, placeId: 'sala', position: { x: 1, y: 2 }, channelId: '00000000-0000-4000-8000-000000000104' },
  }] });
  const prepared = configuration.roster.preparedCharacters[0];
  assert.ok(prepared);
  const preparedContextHash = createHash('sha256').update(canonical(prepared)).digest('hex');
  journal.registerWorldRun({ initialSnapshot: configuration.worldSnapshot,
    configurationRevision: configuration.configRevision, configuration,
    continuityFence: { kind: 'prepared-contexts', atWorldSeq: configuration.worldSnapshot.seq, contexts: [{
      actorId, continuityId: prepared.continuity.continuityId, continuityRevision: prepared.continuity.revision,
      continuityContentHash: prepared.continuity.contentHash, identityVersion: prepared.identityVersion, preparedContextHash,
    }] }, lifecycle: 'running' });
  const speech = journal.commitHumanIntervention({ runId, participantId: 'visitante-prueba', expectedRevision: configuration.worldSnapshot.revision,
    idempotencyKey: randomUUID(), request: { kind: 'speech', recipientCharacterIds: [actorId],
      channelId: '00000000-0000-4000-8000-000000000104', content: { kind: 'speech', text: 'Mensaje sintético para activar la prueba.' } } });
  if (speech.kind === 'idempotencyConflict' || speech.kind === 'invalidLifecycle') throw new Error('Conflicto de fixture');
  assert.equal(speech.resolution.kind, 'applied');
  assert.equal((await createDeliverWorldWorker({ journal, runId, actorId }).drain()).kind, 'completed');
  const pulseId = PulseIdSchema.parse(randomUUID());
  journal.configureRun({ runId, maxCalls: 20 });
  journal.configurePulse({ runId, pulseId, maxCalls: 10 });
  const scheduled = journal.scheduleActorTurnJob({ runId, actorId, pulseId });
  assert.equal(scheduled.kind, 'scheduled');
  if (scheduled.kind !== 'scheduled') throw new Error('Fixture sin job');
  const claim = { runId, actorId, jobId: scheduled.job.jobId, generation: scheduled.job.generation,
    ownerToken: randomUUID(), claimToken: randomUUID() };
  const runtime = await PiRuntime.create({ privateDataRoot: directory });
  const ids = { eventId: randomUUID, perceptionId: randomUUID, experienceId: randomUUID, offerId: randomUUID,
    entityHandle: randomUUID, placeHandle: randomUUID, channelHandle: randomUUID, offerHandle: randomUUID };
  return { directory, journal, configuration, claim, runtime, ids,
    close() { journal.close(); rmSync(directory, { recursive: true, force: true }); } };
}

type Fixture = Awaited<ReturnType<typeof setup>>;
function deterministicFactory(fixture: Fixture, options: { omitProposal?: boolean; beforePrompt?: () => void; afterDispatch?: () => void } = {}) {
  let disposed = 0;
  const prompts: PiPromptInput[] = [];
  const factory = async (input: CreatePiSessionInput) => {
    const frames = createSyntheticActorSession({ runtime: fixture.runtime, runId, actorId });
    const snapshot = frames.snapshot;
    return {
      identity: input.identity, activeToolNames: input.tools.map((tool) => tool.name),
      checkpoint: () => snapshot,
      subscribe: () => () => undefined,
      async abortAndDispose() { disposed += 1; },
      async prompt(prompt: PiPromptInput) {
        options.beforePrompt?.();
        prompts.push(prompt);
        const port = input.requestPort;
        const purpose = input.identity;
        assert.equal((await port.checkEligibility({ purpose, scope: prompt.scope })).kind, 'active');
        await port.recordCheckpointCandidate({ identity: purpose, purpose: { kind: 'job-base', baseScope: prompt.scope }, snapshot });
        const reservation = await port.reserveNextRequest({ purpose, scope: prompt.scope, clockEpochId: input.runtime.clockEpochId });
        assert.equal(reservation.kind, 'reserved');
        if (reservation.kind !== 'reserved') throw new Error('Sin reserva de fixture');
        const base = fixture.journal.loadActorPiSession({ runId, actorId });
        assert.ok(base);
        const turnId = randomUUID();
        const candidateId = randomUUID();
        const inputLeaf = frames.appendInput(prompt.text);
        await port.recordCheckpointCandidate({ identity: purpose,
          purpose: { kind: 'request-input', baseScope: prompt.scope, request: { scope: prompt.scope, requestSeq: reservation.requestSeq } },
          snapshot: { ...snapshot, candidateLeafId: inputLeaf } });
        await port.recordActorPiCandidate?.({ kind: 'request-input', candidateId: randomUUID(), turnId,
          runId, actorId, scope: prompt.scope, lease: prompt.lease, base, requestSeq: reservation.requestSeq,
          candidateLeafId: inputLeaf, inputCut: prompt.inputCut });
        await port.transitionReservation({ purpose, scope: prompt.scope, requestSeq: reservation.requestSeq, target: 'dispatched', wallTime: { clockEpochId: input.runtime.clockEpochId, monotonicNs: process.hrtime.bigint().toString() } });
        options.afterDispatch?.();
        if (!options.omitProposal) {
          const tool = input.tools.find((item) => item.name === 'propose_action');
          assert.ok(tool);
          // The fake transport invokes the real tool exactly as the SDK would; unused SDK context is absent.
          await Reflect.apply(tool.execute, tool, ['tool-fixture', { action: { kind: 'wait', durationMs: 1 }, nextInitiative: 'yield' }]);
        }
        await port.transitionReservation({ purpose, scope: prompt.scope, requestSeq: reservation.requestSeq, target: 'completed', wallTime: { clockEpochId: input.runtime.clockEpochId, monotonicNs: process.hrtime.bigint().toString() } });
        const leaf = frames.appendTerminal();
        await port.recordCheckpointCandidate({ identity: purpose,
          purpose: { kind: 'terminal-candidate', baseScope: prompt.scope, outcome: 'completed', lastRequest: { scope: prompt.scope, requestSeq: reservation.requestSeq } },
          snapshot: { ...snapshot, candidateLeafId: leaf } });
        await port.recordActorPiCandidate?.({ kind: 'terminal-candidate', candidateId, turnId,
          runId, actorId, scope: prompt.scope, lease: prompt.lease, base, outcome: 'completed',
          lastRequestSeq: reservation.requestSeq, candidateLeafId: leaf, inputCut: prompt.inputCut });
        return { kind: 'pi-terminal-candidate' as const, candidateId, outcome: 'completed' as const, candidateLeafId: leaf };
      },
    };
  };
  return { factory, prompts, get disposed() { return disposed; } };
}

function worker(fixture: Fixture, session: ReturnType<typeof deterministicFactory>, review: (version: number) => { verdict: 'allow' | 'reformulate' | 'reject'; complete?: boolean; criteria?: string[]; evidence?: string[] } = () => ({ verdict: 'allow' })) {
  let commits = 0;
  return { instance: createActorTurnWorker({ journal: fixture.journal, runtime: fixture.runtime, ids: fixture.ids,
    sessionFactory: session.factory,
    memoryForActor() { return { async recall() { return { source: 'ranked-recall', throughWorldSeq: WorldSeqSchema.parse(0), experiences: [], rejectedCount: 0 }; } }; },
    continuista: { async review({ proposal }) { const response = review(proposal.version); return {
      kind: 'continuista', proposalId: proposal.proposalId, version: proposal.version,
      runId: proposal.runId, actorId: proposal.actorId, stateRevision: proposal.baseRevision,
      exactContentHash: proposal.exactContentHash,
      ...(proposal.nextInitiative === undefined ? {} : { nextInitiative: proposal.nextInitiative }),
      verdict: response.verdict, complete: response.complete ?? true,
      criterionCodes: response.criteria ?? ContinuistaCriterionSchema.options,
      ...(response.verdict === 'reformulate' ? { failedCriterionCodes: ['voice'] } : {}),
      evidenceRefs: response.evidence ?? ['fixture-context'],
    }; } }, onCommitted() { commits += 1; },
  }), get commits() { return commits; } };
}

test('worker integra journal real, compilación privada, Pi durable, Continuista, aceptación y commit una vez', async () => {
  const fixture = await setup();
  try {
    const session = deterministicFactory(fixture);
    const host = worker(fixture, session);
    const result = await host.instance.run(fixture.claim);
    assert.equal(result.kind, 'committed');
    if (result.kind !== 'committed') throw new Error('No se confirmó el turno');
    assert.equal(result.commit.resolution.kind, 'applied');
    assert.equal(fixture.journal.loadActorPiSession({ runId, actorId })?.sessionRevision, 1);
    assert.equal(host.commits, 1);
    assert.equal(session.disposed, 1);
    assert.equal(fixture.journal.readQueuedActorTurnIntents({ runId, actorId }).length, 0);
    const recovered = await host.instance.run(fixture.claim);
    assert.equal(recovered.kind, 'recovered');
    if (recovered.kind === 'recovered') assert.equal(recovered.commit.kind, 'existing');
    assert.equal(session.prompts.length, 1);
  } finally { fixture.close(); }
});

test('reformulación mantiene sesión/corte y sólo expone códigos sin evidencia al actor', async () => {
  const fixture = await setup();
  try {
    const session = deterministicFactory(fixture);
    const host = worker(fixture, session, (version) => ({ verdict: version === 1 ? 'reformulate' : 'allow', evidence: ['SECRETO_HOST_NO_ACTOR'] }));
    const result = await host.instance.run(fixture.claim);
    assert.equal(result.kind, 'committed');
    if (result.kind !== 'committed') throw new Error('Sin reformulación aceptada');
    assert.equal(result.proposal.version, 2);
    assert.equal(session.prompts.length, 2);
    assert.deepEqual(session.prompts[0]?.inputCut, session.prompts[1]?.inputCut);
    assert.doesNotMatch(session.prompts[1]?.text ?? '', /SECRETO_HOST/);
    assert.deepEqual(JSON.parse(session.prompts[1]?.text ?? '{}').failedCriterionCodes, ['voice']);
    assert.equal('criterionCodes' in JSON.parse(session.prompts[1]?.text ?? '{}'), false);
    assert.equal(session.disposed, 1);
  } finally { fixture.close(); }
});

for (const scenario of ['missing', 'incomplete', 'reject', 'pause', 'changed-world'] as const) {
  test(`worker conserva inbox y leaf sin aceptar ante ${scenario}`, async () => {
    const fixture = await setup();
    try {
      const session = deterministicFactory(fixture, { omitProposal: scenario === 'missing' });
      const host = worker(fixture, session, () => {
        if (scenario === 'pause') fixture.journal.setWorldLifecycle({ runId, expectedWorldRevision: fixture.journal.loadWorld({ runId })?.revision, expectedConfigRevision: fixture.configuration.configRevision, target: 'paused' });
        if (scenario === 'changed-world') fixture.journal.commitHumanIntervention({ runId, participantId: 'visitante-prueba', expectedRevision: fixture.journal.loadWorld({ runId })?.revision,
          idempotencyKey: randomUUID(), request: { kind: 'speech', recipientCharacterIds: [actorId], channelId: '00000000-0000-4000-8000-000000000104', content: { kind: 'speech', text: 'Otro dato sintético.' } } });
        return { verdict: scenario === 'reject' ? 'reject' : 'allow', ...(scenario === 'incomplete' ? { criteria: ['knowledge'] } : {}) };
      });
      const result = await host.instance.run(fixture.claim);
      assert.equal(result.kind, 'blocked');
      if (result.kind !== 'blocked') throw new Error('Se aceptó un turno inválido');
      assert.equal(result.code, scenario === 'missing' ? 'proposal-missing' : scenario === 'incomplete' ? 'review-incomplete' : scenario === 'reject' ? 'review-rejected' : 'job-inactive');
      assert.equal(fixture.journal.loadActorPiSession({ runId, actorId })?.sessionRevision, 0);
      assert.equal(fixture.journal.loadActorPiSession({ runId, actorId })?.committedLeafId, null);
      assert.equal(host.commits, 0);
      assert.equal(session.disposed, 1);
    } finally { fixture.close(); }
  });
}

test('worker usa SDK Pi real y tools/resultados/checkpoints reales con transporte local determinista', async () => {
  const fixture = await setup();
  try {
    const sdk = sdkActorFactory(fixture);
    // Same review contract as above; factory replacement uses the real installed SDK without OAuth/network.
    const sdkWorker = createActorTurnWorker({ journal: fixture.journal, runtime: fixture.runtime, ids: fixture.ids,
      sessionFactory: sdk.factory, memoryForActor: () => ({ async recall() { return { source: 'ranked-recall', throughWorldSeq: WorldSeqSchema.parse(0), experiences: [], rejectedCount: 0 }; } }),
      continuista: { async review({ proposal }) { return { kind: 'continuista', proposalId: proposal.proposalId, version: proposal.version,
        runId, actorId, stateRevision: proposal.baseRevision, exactContentHash: proposal.exactContentHash,
        ...(proposal.nextInitiative === undefined ? {} : { nextInitiative: proposal.nextInitiative }),
        verdict: 'allow', complete: true, criterionCodes: ContinuistaCriterionSchema.options, evidenceRefs: ['sdk-fixture'] }; } },
    });
    const result = await sdkWorker.run(fixture.claim);
    assert.equal(result.kind, 'committed');
    assert.equal(sdk.requests, 2);
    assert.equal(sdk.disposed, 1);
  } finally { fixture.close(); }
});

test('cancelación durante revisión dispone Pi y bloquea durable sin consumir el inbox', async () => {
  const fixture = await setup();
  try {
    const controller = new AbortController();
    const session = deterministicFactory(fixture);
    const host = worker(fixture, session, () => { controller.abort(); return { verdict: 'allow' }; });
    const result = await host.instance.run(fixture.claim, { signal: controller.signal });
    assert.equal(result.kind, 'blocked');
    if (result.kind !== 'blocked') throw new Error('Cancelación ignorada');
    assert.equal(result.code, 'cancelled');
    assert.equal(session.disposed, 1);
    assert.equal(fixture.journal.loadActorPiSession({ runId, actorId })?.sessionRevision, 0);
    const claimAgain = fixture.journal.claimActorTurnJob(fixture.claim);
    assert.equal(claimAgain.kind, 'blocked');
    if (claimAgain.kind === 'blocked') assert.equal(claimAgain.job.failureCode, 'cancelled');
  } finally { fixture.close(); }
});

test('agotamiento de reformulaciones registra todas las versiones sin publicar ni aceptar', async () => {
  const fixture = await setup();
  try {
    const session = deterministicFactory(fixture);
    const result = await worker(fixture, session, () => ({ verdict: 'reformulate' })).instance.run(fixture.claim);
    assert.equal(result.kind, 'blocked');
    if (result.kind !== 'blocked') throw new Error('Se excedió el límite');
    assert.equal(result.code, 'reformulations-exhausted');
    assert.equal(session.prompts.length, fixture.configuration.maxReformulations + 1);
    assert.equal(session.disposed, 1);
    assert.equal(fixture.journal.loadActorPiSession({ runId, actorId })?.committedLeafId, null);
  } finally { fixture.close(); }
});

test('error de factory queda diagnosticado durable y requiere retry explícito', async () => {
  const fixture = await setup();
  try {
    const host = createActorTurnWorker({ journal: fixture.journal, runtime: fixture.runtime, ids: fixture.ids,
      memoryForActor: () => ({ async recall() { return { source: 'ranked-recall', throughWorldSeq: WorldSeqSchema.parse(0), experiences: [], rejectedCount: 0 }; } }),
      sessionFactory: async () => { throw new Error('Factory sintética falló'); },
      continuista: { async review() { throw new Error('No debe alcanzarse'); } },
    });
    await assert.rejects(host.run(fixture.claim), /Factory sintética falló/);
    const retry = fixture.journal.claimActorTurnJob(fixture.claim);
    assert.equal(retry.kind, 'blocked');
    if (retry.kind === 'blocked') assert.equal(retry.job.failureCode, 'execution-failed');
  } finally { fixture.close(); }
});

test('reinicio entre aceptación y commit recupera propuesta exacta sin otra llamada Pi', async () => {
  const fixture = await setup();
  let reopened: ReturnType<typeof openJournal> | undefined;
  let closed = false;
  try {
    const session = deterministicFactory(fixture);
    const crashJournal = { ...fixture.journal, commitWorldAttempt() { throw new Error('crash-after-accept'); } };
    const interrupted = createActorTurnWorker({ journal: crashJournal, runtime: fixture.runtime, ids: fixture.ids,
      sessionFactory: session.factory,
      memoryForActor: () => ({ async recall() { return { source: 'ranked-recall', throughWorldSeq: WorldSeqSchema.parse(0), experiences: [], rejectedCount: 0 }; } }),
      continuista: { async review({ proposal }) { return { kind: 'continuista', proposalId: proposal.proposalId, version: proposal.version,
        runId, actorId, stateRevision: proposal.baseRevision, exactContentHash: proposal.exactContentHash,
        ...(proposal.nextInitiative === undefined ? {} : { nextInitiative: proposal.nextInitiative }),
        verdict: 'allow', complete: true, criterionCodes: ContinuistaCriterionSchema.options, evidenceRefs: ['fixture-accepted'] }; } },
    });
    await assert.rejects(interrupted.run(fixture.claim), /crash-after-accept/);
    assert.equal(fixture.journal.claimActorTurnJob(fixture.claim).kind, 'accepted');
    assert.equal(fixture.journal.loadActorPiSession({ runId, actorId })?.sessionRevision, 1);
    fixture.journal.close();
    closed = true;
    reopened = openJournal({ path: join(fixture.directory, 'journal.sqlite') });
    const recovered = createActorTurnWorker({ journal: reopened, runtime: fixture.runtime, ids: fixture.ids,
      sessionFactory: async () => { throw new Error('Recovery no debe volver a llamar Pi'); },
      memoryForActor: () => { throw new Error('Recovery no necesita memoria'); },
      continuista: { async review() { throw new Error('Recovery no repite revisión'); } },
    });
    const result = await recovered.run(fixture.claim);
    assert.equal(result.kind, 'recovered');
    if (result.kind !== 'recovered') throw new Error('No se recuperó el commit');
    assert.equal(result.commit.resolution.kind, 'applied');
    const again = await recovered.run(fixture.claim);
    assert.equal(again.kind, 'recovered');
    if (again.kind !== 'recovered') throw new Error('Sin receipt idempotente');
    assert.equal(again.commit.kind, 'existing');
    assert.deepEqual(again.commit.resolution.events, result.commit.resolution.events);
    assert.equal(session.prompts.length, 1);
  } finally {
    reopened?.close();
    if (!closed) fixture.journal.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('workers del mismo journal excluyen un claim concurrente sin bloquear el job durable', async () => {
  const fixture = await setup();
  try {
    const session = deterministicFactory(fixture);
    const first = worker(fixture, session);
    const second = worker(fixture, session);
    const firstRun = first.instance.run(fixture.claim);
    const duplicate = await second.instance.run(fixture.claim);
    assert.deepEqual(duplicate, { kind: 'unclaimed', reason: 'busy' });
    const result = await firstRun;
    assert.equal(result.kind, 'committed');
    assert.equal(session.prompts.length, 1);
    assert.equal(session.disposed, 1);
    const durable = fixture.journal.claimActorTurnJob(fixture.claim);
    assert.equal(durable.kind, 'accepted');
    if (durable.kind === 'accepted') assert.equal(durable.job.failureCode, null);
    const recovery = await second.instance.run(fixture.claim);
    assert.equal(recovery.kind, 'recovered');
    assert.equal(session.prompts.length, 1);
  } finally { fixture.close(); }
});

test('el callback de entrega puede repetirse con un commit existente y la misma identidad durable', async () => {
  const fixture = await setup();
  try {
    const session = deterministicFactory(fixture);
    const origins = new Set<string>();
    let attempts = 0;
    const host = createActorTurnWorker({ journal: fixture.journal, runtime: fixture.runtime, ids: fixture.ids,
      sessionFactory: session.factory,
      memoryForActor: () => ({ async recall() { return { source: 'ranked-recall', throughWorldSeq: WorldSeqSchema.parse(0), experiences: [], rejectedCount: 0 }; } }),
      continuista: { async review({ proposal }) { return { kind: 'continuista', proposalId: proposal.proposalId, version: proposal.version,
        runId, actorId, stateRevision: proposal.baseRevision, exactContentHash: proposal.exactContentHash,
        ...(proposal.nextInitiative === undefined ? {} : { nextInitiative: proposal.nextInitiative }),
        verdict: 'allow', complete: true, criterionCodes: ContinuistaCriterionSchema.options, evidenceRefs: ['fixture-delivery'] }; } },
      onCommitted({ scope, commit }) {
        attempts += 1;
        origins.add(JSON.stringify([scope.runId, scope.actorId, scope.jobId, scope.generation, commit.resolution.attemptId]));
      },
    });
    assert.equal((await host.run(fixture.claim)).kind, 'committed');
    assert.equal((await host.run(fixture.claim)).kind, 'recovered');
    assert.equal(attempts, 2);
    assert.equal(origins.size, 1);
  } finally { fixture.close(); }
});

function recoveryAdminFactory(fixture: Fixture, reformulate = false) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async factory(input: CreatePiSessionInput) {
      calls += 1;
      const snapshot = { sessionId: randomUUID(), sessionPath: join(fixture.directory, `${randomUUID()}.jsonl`), candidateLeafId: null };
      return { identity: input.identity, activeToolNames: ['submit_continuista_review'], checkpoint: () => snapshot,
        subscribe: () => () => undefined, async abortAndDispose() {},
        async prompt(prompt: PiPromptInput) {
          const port = input.requestPort;
          const purpose = input.identity;
          await port.recordCheckpointCandidate({ identity: purpose, purpose: { kind: 'job-base', baseScope: prompt.scope }, snapshot });
          const reservation = await port.reserveNextRequest({ purpose, scope: prompt.scope, clockEpochId: input.runtime.clockEpochId });
          if (reservation.kind !== 'reserved') throw new Error('Sin cuota sintética admin');
          const reference = { scope: prompt.scope, requestSeq: reservation.requestSeq };
          await port.recordCheckpointCandidate({ identity: purpose,
            purpose: { kind: 'request-input', baseScope: prompt.scope, request: reference }, snapshot: { ...snapshot, candidateLeafId: 'admin-input-recovery' } });
          await port.transitionReservation({ purpose, scope: prompt.scope, requestSeq: reservation.requestSeq, target: 'dispatched', wallTime: { clockEpochId: input.runtime.clockEpochId, monotonicNs: process.hrtime.bigint().toString() } });
          const context = validateContinuistaReviewContext({ kind: 'continuista-review-context', schemaVersion: 1, ...JSON.parse(prompt.text) });
          const proposal = context.payload.proposal;
          const response = { contextHash: context.contextHash, review: { kind: 'continuista', proposalId: proposal.proposalId,
            version: proposal.version, runId: proposal.runId, actorId: proposal.actorId, stateRevision: proposal.baseRevision,
            exactContentHash: proposal.exactContentHash,
            ...(proposal.nextInitiative === undefined ? {} : { nextInitiative: proposal.nextInitiative }),
            verdict: reformulate ? 'reformulate' : 'allow',
            ...(reformulate ? { failedCriterionCodes: ['voice'] } : {}), criterionCodes: ContinuistaCriterionSchema.options,
            evidenceRefs: ['ctx:proposal', 'ctx:projection'], complete: true } };
          const tool = input.tools[0];
          assert.ok(tool);
          await Reflect.apply(tool.execute, tool, ['admin-recovery-fixture', response]);
          await port.transitionReservation({ purpose, scope: prompt.scope, requestSeq: reservation.requestSeq, target: 'completed', wallTime: { clockEpochId: input.runtime.clockEpochId, monotonicNs: process.hrtime.bigint().toString() } });
          await port.recordCheckpointCandidate({ identity: purpose,
            purpose: { kind: 'terminal-candidate', baseScope: prompt.scope, outcome: 'completed', lastRequest: reference },
            snapshot: { ...snapshot, candidateLeafId: 'admin-terminal-recovery' } });
          return { kind: 'pi-terminal-candidate' as const, candidateId: null, outcome: 'completed' as const, candidateLeafId: 'admin-terminal-recovery' };
        },
      };
    },
  };
}

for (const scenario of ['accepted-admin', 'review-missing', 'reformulation-pending', 'uncertain-request', 'late-input', 'sdk-valid', 'file-missing', 'leaf-missing', 'malformed-line', 'invalid-utf8', 'broken-parent', 'wrong-header'] as const) {
  test(`recuperación parental ${scenario} nunca regenera actor ni Continuista`, async () => {
    const fixture = await setup();
    let reopened: ReturnType<typeof openJournal> | undefined;
    let closed = false;
    try {
      const sdkScenario = ['sdk-valid', 'file-missing', 'leaf-missing', 'malformed-line', 'invalid-utf8', 'broken-parent', 'wrong-header'].includes(scenario);
      const originalActor = sdkScenario ? sdkActorFactory(fixture) : deterministicFactory(fixture, scenario === 'uncertain-request'
        ? { afterDispatch: () => { throw new Error('crash-during-actor-request'); } } : {});
      const originalAdmin = recoveryAdminFactory(fixture, scenario === 'reformulation-pending');
      const admin = createContinuistaPiWorker({ journal: fixture.journal, runtime: fixture.runtime, ids: fixture.ids,
        ownerToken: fixture.claim.ownerToken, sessionFactory: originalAdmin.factory });
      // Fault injection preserves the running parent, simulating a dead process unable to write its failure.
      const crashJournal = { ...fixture.journal,
        failActorTurnJob() { throw new Error('process-unavailable'); },
        acceptActorTurn() { throw new Error('crash-before-parent-accept'); },
      };
      const original = createActorTurnWorker({ journal: crashJournal, runtime: fixture.runtime, ids: fixture.ids,
        sessionFactory: originalActor.factory,
        memoryForActor: () => ({ async recall() { return { source: 'ranked-recall', throughWorldSeq: WorldSeqSchema.parse(0), experiences: [], rejectedCount: 0 }; } }),
        continuista: { async review(request) {
          if (scenario === 'review-missing' || (scenario === 'reformulation-pending' && request.proposal.version === 2)) throw new Error('crash-before-admin-review');
          return admin.review(request);
        } },
      });
      await assert.rejects(original.run(fixture.claim), /crash-/);
      const initialSession = fixture.journal.loadActorPiSession({ runId, actorId });
      assert.ok(initialSession);
      assert.equal(initialSession.sessionRevision, 0);
      const before = new DatabaseSync(join(fixture.directory, 'journal.sqlite'));
      let originalCandidates: unknown[];
      let originalReservations: unknown[];
      let terminalLeaf: string;
      try {
        originalCandidates = before.prepare('SELECT candidate_id,canonical_payload,payload_hash FROM actor_pi_candidates ORDER BY candidate_id').all();
        originalReservations = before.prepare('SELECT job_id,generation,request_seq,state FROM request_reservations ORDER BY job_id,generation,request_seq').all();
        terminalLeaf = z.strictObject({ candidate_leaf_id: z.string().nullable() }).parse(before.prepare("SELECT candidate_leaf_id FROM actor_pi_candidates WHERE candidate_kind='terminal-candidate' ORDER BY recorded_at DESC LIMIT 1").get() ?? { candidate_leaf_id: null }).candidate_leaf_id ?? '';
      } finally { before.close(); }
      fixture.journal.close();
      closed = true;
      if (scenario === 'file-missing') unlinkSync(initialSession.sessionPath);
      if (['leaf-missing', 'malformed-line', 'invalid-utf8', 'broken-parent', 'wrong-header'].includes(scenario)) {
        const text = readFileSync(initialSession.sessionPath, 'utf8');
        if (scenario === 'malformed-line') writeFileSync(initialSession.sessionPath, text + 'corrupted JSON line\n');
        else if (scenario === 'invalid-utf8') writeFileSync(initialSession.sessionPath, Buffer.concat([Buffer.from(text), Buffer.from([0xff])]));
        else {
          const records = text.trimEnd().split('\n').map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)));
          const changed = records.filter((entry) => scenario !== 'leaf-missing' || entry.id !== terminalLeaf).map((entry, index) => {
            if (scenario === 'broken-parent' && entry.id === terminalLeaf) return { ...entry, parentId: 'missing-parent' };
            if (scenario === 'wrong-header' && index === 0) return { ...entry, version: 0 };
            return entry;
          });
          writeFileSync(initialSession.sessionPath, changed.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
        }
      }
      reopened = openJournal({ path: join(fixture.directory, 'journal.sqlite') });
      const ownerToken = randomUUID();
      reopened.recoverAbandonedActorTurnJobClaims({ ownerToken });
      reopened.recoverAbandonedContinuistaClaims({ ownerToken });
      if (scenario === 'late-input') {
        const world = reopened.loadWorld({ runId });
        assert.ok(world);
        reopened.commitHumanIntervention({ runId, participantId: 'visitante-prueba', expectedRevision: world.revision,
          idempotencyKey: randomUUID(), request: { kind: 'speech', recipientCharacterIds: [actorId],
            channelId: '00000000-0000-4000-8000-000000000104', content: { kind: 'speech', text: 'Entrada posterior al corte congelado.' } } });
        await createDeliverWorldWorker({ journal: reopened, runId, actorId }).drain();
      }
      let actorCalls = 0;
      let adminCalls = 0;
      let memoryReads = 0;
      const recovered = createActorTurnWorker({ journal: reopened, runtime: fixture.runtime, ids: fixture.ids,
        sessionFactory: async () => { actorCalls += 1; throw new Error('No nueva instancia actor en recovery'); },
        continuista: { async review() { adminCalls += 1; throw new Error('No nueva inferencia Continuista en recovery'); } },
        memoryForActor: () => { memoryReads += 1; throw new Error('No recompilar memoria en recovery'); },
      });
      const claim = { ...fixture.claim, ownerToken, claimToken: randomUUID() };
      const result = await recovered.run(claim);
      if (scenario === 'accepted-admin' || scenario === 'sdk-valid') {
        assert.equal(result.kind, 'recovered');
        if (result.kind !== 'recovered') throw new Error('No se recuperó el terminal aprobado');
        assert.equal(result.job.state, 'accepted');
        assert.equal(result.commit.resolution.kind, 'applied');
        assert.equal(reopened.loadActorPiSession({ runId, actorId })?.sessionRevision, 1);
        assert.equal(reopened.readQueuedActorTurnIntents({ runId, actorId }).length, 0);
        const duplicate = await recovered.run(claim);
        assert.equal(duplicate.kind, 'recovered');
        if (duplicate.kind === 'recovered') assert.equal(duplicate.commit.kind, 'existing');
      } else {
        assert.equal(result.kind, 'blocked');
        if (result.kind !== 'blocked') throw new Error('La cola tentativa obtuvo aceptación prematura');
        assert.equal(result.code, 'recovery-required');
        assert.equal(reopened.loadActorPiSession({ runId, actorId })?.sessionRevision, 0);
        assert.equal(reopened.loadActorPiSession({ runId, actorId })?.committedLeafId, null);
        const blockedJob = reopened.claimActorTurnJob(claim);
        assert.equal(blockedJob.kind, 'blocked');
        if (blockedJob.kind === 'blocked' && scenario === 'late-input') {
          assert.equal(blockedJob.job.frozenWorldCut?.perceptionIds.length, 1);
          assert.equal(reopened.readQueuedActorTurnIntents({ runId, actorId }).length, 2);
        }
      }
      assert.equal(actorCalls, 0);
      assert.equal(adminCalls, 0);
      assert.equal(memoryReads, 0);
      const after = new DatabaseSync(join(fixture.directory, 'journal.sqlite'));
      try {
        assert.deepEqual(after.prepare('SELECT candidate_id,canonical_payload,payload_hash FROM actor_pi_candidates ORDER BY candidate_id').all(), originalCandidates);
        assert.deepEqual(after.prepare('SELECT job_id,generation,request_seq,state FROM request_reservations ORDER BY job_id,generation,request_seq').all(), originalReservations);
      } finally { after.close(); }
      assert.equal(originalActor.prompts.length, scenario === 'reformulation-pending' ? 2 : 1);
    } finally {
      reopened?.close();
      if (!closed) fixture.journal.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });
}

function sdkActorFactory(fixture: Fixture, controls?: { clock: NonNullable<Parameters<typeof createBudgetedStreamFunction>[0]['clock']>; source: ReturnType<typeof createAssistantMessageEventStream>; onDispatch(): void; onSdkSettled(): void }) {
  let disposeCount = 0;
  let requests = 0;
  const prompts: PiPromptInput[] = [];
    const factory = async (input: CreatePiSessionInput) => {
      const identityDir = join(fixture.runtime.privateDataRoot, 'runs', runId, 'actors', actorId);
      const cwd = join(identityDir, 'cwd');
      mkdirSync(cwd, { recursive: true });
      const manager = SessionManager.create(cwd, join(identityDir, 'sessions'));
      const settings = SettingsManager.inMemory({ retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } }, compaction: { enabled: false }, cacheWarming: 'off', enableAnalytics: false, enableInstallTelemetry: false });
      const loader = new DefaultResourceLoader({ cwd, agentDir: join(fixture.runtime.privateDataRoot, 'runs', runId, 'actors', actorId, 'pi-agent'), settingsManager: settings,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: input.systemPrompt });
      await loader.reload();
      const profile = resolveReadyInferenceProfile(fixture.configuration);
      const model = fixture.runtime.modelRuntime.getModel(profile.provider, profile.model);
      assert.ok(model);
      const { session } = await createAgentSession({ cwd, agentDir: join(fixture.runtime.privateDataRoot, 'runs', runId, 'actors', actorId, 'pi-agent'), modelRuntime: fixture.runtime.modelRuntime,
        model, thinkingLevel: profile.reasoningEffort, noTools: 'all', tools: ['recall_memory', 'propose_action'], customTools: [...input.tools],
        resourceLoader: loader, settingsManager: settings, sessionManager: manager });
      function checkpoint() { return { sessionId: manager.getSessionId(), sessionPath: manager.getSessionFile() ?? null, candidateLeafId: manager.getLeafId() }; }
      let budgeted: ReturnType<typeof createBudgetedStreamFunction> | undefined;
      return {
        identity: input.identity, activeToolNames: session.getActiveToolNames(), checkpoint,
        subscribe: () => () => undefined,
        async abortAndDispose() { await session.abort(); await budgeted?.whenSettled(); session.dispose(); disposeCount += 1; },
        async prompt(prompt: PiPromptInput) {
          prompts.push(prompt);
          const base = fixture.journal.loadActorPiSession({ runId, actorId });
          assert.ok(base);
          const inputCut = prompt.inputCut;
          assert.ok(inputCut);
          const turnId = randomUUID();
          let lastRequest: PiRequestReference | undefined;
          await input.requestPort.recordCheckpointCandidate({ identity: input.identity, purpose: { kind: 'job-base', baseScope: prompt.scope }, snapshot: { ...checkpoint(), candidateLeafId: null } });
          session.agent.streamFunction = budgeted = createBudgetedStreamFunction({ profile, clockEpochId: input.runtime.clockEpochId, requireWallTime: true, ...(controls === undefined ? {} : { clock: controls.clock }),
            identity: input.identity, runId, sessionManager: manager, port: input.requestPort,
            getScope: () => prompt.scope,
            getActorTurnContext: () => ({ turnId, base: { ...base, sessionRevision: RevisionSchema.parse(base.sessionRevision) }, inputCut, ...(prompt.lease === undefined ? {} : { lease: prompt.lease }) }),
            onRequestReserved(request) { lastRequest = request; },
            original(actualModel) {
              if (controls !== undefined) { requests += 1; controls.onDispatch(); return controls.source; }
              const stream = createAssistantMessageEventStream();
              requests += 1;
              const first = requests === 1;
              const message: AssistantMessage = { role: 'assistant', api: actualModel.api, provider: actualModel.provider, model: actualModel.id,
                content: first ? [{ type: 'toolCall', id: 'local-proposal', name: 'propose_action', arguments: { action: { kind: 'wait', durationMs: 1 }, nextInitiative: 'yield' } }] : [],
                stopReason: first ? 'toolUse' : 'stop', timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
              stream.push({ type: 'done', reason: first ? 'toolUse' : 'stop', message });
              return stream;
            },
          });
          await session.agent.prompt(prompt.text);
          controls?.onSdkSettled();
          const terminal = checkpoint();
          assert.ok(terminal.candidateLeafId);
          assert.ok(lastRequest);
          if (controls === undefined) assert.ok(session.messages.some((message) => message.role === 'toolResult' && message.toolName === 'propose_action' && !message.isError));
          const outcome = controls === undefined ? 'completed' as const : 'aborted' as const;
          await input.requestPort.recordCheckpointCandidate({ identity: input.identity,
            purpose: { kind: 'terminal-candidate', baseScope: prompt.scope, outcome, lastRequest }, snapshot: terminal });
          const candidateId = randomUUID();
          await input.requestPort.recordActorPiCandidate?.({ kind: 'terminal-candidate', candidateId, turnId, runId, actorId, scope: prompt.scope,
            lease: prompt.lease, base, outcome, lastRequestSeq: lastRequest.requestSeq, candidateLeafId: terminal.candidateLeafId, inputCut: prompt.inputCut });
          return { kind: 'pi-terminal-candidate' as const, candidateId, outcome, candidateLeafId: terminal.candidateLeafId };
        },
      };
    };
  return { factory, prompts, get disposed() { return disposeCount; }, get requests() { return requests; } };
}

test('verificación JSONL sólo lee archivos y comprueba identidad, ancestry, duplicados y ciclos', async () => {
  const fixture = await setup();
  try {
    const frames = createSyntheticActorSession({ runtime: fixture.runtime, runId, actorId });
    frames.appendInput('Primera entrada sintética.');
    const baseLeafId = frames.appendTerminal();
    const inputLeafId = frames.appendInput('Segunda entrada sintética.');
    const terminalLeafId = frames.appendTerminal();
    const request = { privateDataRoot: fixture.runtime.privateDataRoot, runId, actorId,
      sessionId: frames.snapshot.sessionId, sessionPath: frames.snapshot.sessionPath, baseLeafId, inputLeafId, terminalLeafId };
    const original = readFileSync(request.sessionPath);
    assert.equal(verifyPiActorSessionIntegrity(request).kind, 'verified');
    assert.deepEqual(readFileSync(request.sessionPath), original);
    assert.equal(verifyPiActorSessionIntegrity({ ...request, baseLeafId: 'absent-base' }).kind, 'invalid');
    assert.equal(verifyPiActorSessionIntegrity({ ...request, inputLeafId: terminalLeafId }).kind, 'invalid');
    const records = original.toString('utf8').trimEnd().split('\n').map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)));
    for (const kind of ['duplicate', 'cycle'] as const) {
      const altered = kind === 'duplicate' ? [...records, records.at(-1)]
        : records.map((entry) => entry.id === baseLeafId ? { ...entry, parentId: terminalLeafId } : entry);
      const bytes = Buffer.from(altered.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
      writeFileSync(request.sessionPath, bytes);
      assert.equal(verifyPiActorSessionIntegrity(request).kind, 'invalid');
      assert.deepEqual(readFileSync(request.sessionPath), bytes);
    }
    writeFileSync(request.sessionPath, original);
    const outside = join(fixture.directory, 'outside-session.jsonl');
    writeFileSync(outside, original);
    assert.equal(verifyPiActorSessionIntegrity({ ...request, sessionPath: outside }).kind, 'invalid');
    assert.deepEqual(readFileSync(outside), original);
  } finally { fixture.close(); }
});

test('SDK actor + SQLite: deadline conserva concurrencia hasta late close y reapertura conserva medida sin actuación', async () => {
  const fixture = await setup();
  let reopened: ReturnType<typeof openJournal> | undefined;
  let now = 0n;
  let expire: () => void = () => undefined;
  let enter: () => void = () => undefined; const entered = new Promise<void>((resolve) => { enter = resolve; });
  let sdkFinished: () => void = () => undefined; const sdkSettled = new Promise<void>((resolve) => { sdkFinished = resolve; });
  const source = createAssistantMessageEventStream();
  try {
    const beforeWorld = fixture.journal.loadWorld({ runId }); assert.ok(beforeWorld);
    const sdk = sdkActorFactory(fixture, { source, onDispatch: enter, onSdkSettled: sdkFinished,
      clock: { nowNs: () => now, schedule(ms, callback) { assert.equal(ms, 30_000); expire = callback; return () => undefined; } } });
    const actor = createActorTurnWorker({ journal: fixture.journal, runtime: fixture.runtime, ids: fixture.ids,
      sessionFactory: sdk.factory, memoryForActor: () => ({ async recall() { return { source: 'ranked-recall', throughWorldSeq: WorldSeqSchema.parse(0), experiences: [], rejectedCount: 0 }; } }),
      continuista: { async review() { throw new Error('Expired actor must never reach Continuista'); } } });
    let finished = false;
    const acting = actor.run(fixture.claim).then((value) => { finished = true; return value; });
    await entered;
    const claim = fixture.journal.claimActorTurnJob(fixture.claim);
    if (claim.kind !== 'existing') throw new Error('SDK actor should retain its claim');
    const pulseId = claim.job.pulseId; assert.ok(pulseId);
    const secondary = { runId, pulseId, jobId: randomUUID(), generation: 0, clockEpochId: randomUUID(), ownerToken: randomUUID() };
    const second = fixture.journal.reserveNextRequest(secondary);
    assert.equal(second.kind, 'reserved');
    if (second.kind !== 'reserved') throw new Error('Synthetic simultaneous grant must reserve the other slot');
    assert.deepEqual(fixture.journal.reserveNextRequest({ ...secondary, jobId: randomUUID() }), { kind: 'busy', scope: 'concurrency' });
    now = 30_000_000_000n; expire(); await sdkSettled;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(finished, false, 'Worker disposal retains host ownership while transport ignores abort');
    const pending = fixture.journal.readRunModelTimeBudget({ runId });
    assert.equal(pending?.status, 'uncertain'); assert.equal(pending?.activePiRequests, 2); assert.equal(pending?.wallTimeReservedMs, 60_000);
    assert.equal(fixture.journal.loadActorPiSession({ runId, actorId })?.committedLeafId, null);
    now = 35_500_000_000n;
    const profile = resolveReadyInferenceProfile(fixture.configuration);
    const late: AssistantMessage = { role: 'assistant', api: profile.api, provider: profile.provider, model: profile.model,
      content: [{ type: 'toolCall', id: 'late-proposal', name: 'propose_action', arguments: { action: { kind: 'wait', durationMs: 1 }, nextInitiative: 'yield' } }], stopReason: 'toolUse', timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    source.push({ type: 'done', reason: 'toolUse', message: late });
    const result = await acting;
    assert.equal(result.kind, 'blocked'); assert.equal(sdk.requests, 1); assert.equal(sdk.disposed, 1);
    assert.deepEqual(fixture.journal.loadWorld({ runId }), beforeWorld, 'Technical timeout never becomes a dramatic event');
    fixture.journal.close(); reopened = openJournal({ path: join(fixture.directory, 'journal.sqlite') });
    const persisted = reopened.readRunModelTimeBudget({ runId });
    assert.equal(persisted?.wallTimeMeasuredMs, 35_500); assert.equal(persisted?.wallTimeReservedMs, 30_000); assert.equal(persisted?.activePiRequests, 1);
    assert.deepEqual(reopened.recoverAbandonedModelTimeRequests({ ownerToken: randomUUID() }), { releasedReservations: 1, uncertainTransports: 0 });
    const recovered = reopened.readRunModelTimeBudget({ runId });
    assert.equal(recovered?.wallTimeMeasuredMs, 35_500); assert.equal(recovered?.wallTimeReservedMs, 0); assert.equal(recovered?.wallTimeRemainingMs, 24_500);
    assert.equal(reopened.loadActorPiSession({ runId, actorId })?.committedLeafId, null);
  } finally { source.end(); reopened?.close(); try { fixture.journal.close(); } catch { /* Already closed before the explicit reopen. */ } rmSync(fixture.directory, { recursive: true, force: true }); }
});
