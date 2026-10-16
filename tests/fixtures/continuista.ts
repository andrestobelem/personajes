import type { IcmWorkspaceSnapshot } from '../../src/domain/icm-workspace.ts';
import { resolveReadyInferenceProfile, type PersistedInferenceProfile } from '../../src/domain/inference-profile.ts';
import { createSyntheticActorSession } from './pi-session.ts';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openJournal } from '../../src/adapters/journal.ts';
import { PiRuntime, type CreatePiSessionInput, type PiPromptInput } from '../../src/adapters/pi.ts';
import { createDeliverWorldWorker } from '../../src/application/deliver-world.ts';
import { createEmptyRunConfigurationDraft, ProductionAudioSchema, RunConfigurationDraftSchema, type DramaticReferences, type RunBudget, type ProductionRoster } from '../../src/domain/production.ts';
import { ContinuityContextSchema, PreparedCharacterSchema, SpanishVarietyForActingSchema, type PreparedCharacter } from '../../src/domain/preparation.ts';
import { WorldSnapshotSchema, type WorldSnapshot } from '../../src/domain/world.ts';
import { validateRunConfiguration, ReadyRunConfigurationSchema, type ReadyRunConfiguration } from '../../src/application/production-preflight.ts';
import { ContinuistaCriterionSchema } from '../../src/domain/world-journal.ts';
import { CharacterIdSchema, RunIdSchema, PulseIdSchema } from '../../src/domain/values.ts';
import type { ContinuistaReviewContext } from '../../src/application/continuista-review-context.ts';
export const runId = RunIdSchema.parse('00000000-0000-4000-8000-000000000101');
export const actorId = CharacterIdSchema.parse('personaje-prueba');
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
        lifeHistory:{kind:'curated-life-history',narrative:'Historia de vida sintética elegida para esta prueba; no documenta biografía canónica. Los detalles no establecidos permanecen abiertos.',antecedentIds:[],unknowns:['Historia anterior no establecida por la fixture.'],contradictions:[]},
        desires:[{desireId:'comprender-situacion',description:'Deseo comprender la situación inmediata.',stakes:'Poder relacionarme con lo que sucede.',tension:'La situación puede ser ambigua y exige escuchar.',goalIds:['objetivo-prueba']}],
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

export function worldFixture(input: {
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

export function draftFixture(input: {
  prepared?: PreparedCharacter;
  world?: WorldSnapshot;
  activeCharacterIds?: string[];
  variety?: unknown;
  narrationMode?: unknown;
  audio?: unknown;
  moment?: number;
  participantIds?: string[];
  humanParticipants?: unknown;
  dramaticReferences?: DramaticReferences;
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
    ...(input.dramaticReferences === undefined ? {} : { dramaticReferences: configured(input.dramaticReferences) }),
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


export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
}

export async function setup(inferenceProfile?: PersistedInferenceProfile | 'historical', dramaticReferences?: DramaticReferences, budgetOverride?: Partial<RunBudget>, options: { icmWorkspace?: IcmWorkspaceSnapshot } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-actor-worker-'));
  const journal = openJournal({ path: join(directory, 'journal.sqlite') });
  const baseConfiguration = readyFixture({ humanParticipants: [{
    identity: { participantId: 'visitante-prueba', displayName: 'Visitante', identityMarkdown: 'Identidad sintética.', lifeStoryMarkdown: 'Historia sintética.' },
    presence: { kind: 'inScene', sceneId, placeId: 'sala', position: { x: 1, y: 2 }, channelId: '00000000-0000-4000-8000-000000000104' },
  }], ...(dramaticReferences === undefined ? {} : { dramaticReferences }) });
  const other = preparedFixture({ characterId: 'oculto-prueba' });
  const firstEntity = baseConfiguration.worldSnapshot.entities[0];
  assert.ok(firstEntity?.kind === 'character');
  const privateExperience = { schemaVersion: 1, experienceId: randomUUID(), runId, actorId: other.characterId,
    kind: 'belief', content: 'SECRET_PRIVATE_OTHER_MEMORY', sourceRefs: [], fictitiousAt: fictionalAt, receivedAt: fictionalAt,
    worldSeq: 0, confidence: 1, revision: 0, predecessor: { kind: 'initial' }, basedOn: [] };
  const { inferenceProfile: originalProfile, ...historicalConfiguration } = baseConfiguration;
  const selectedConfiguration = inferenceProfile === 'historical' ? historicalConfiguration : baseConfiguration;
  const configuration = ReadyRunConfigurationSchema.parse({ ...selectedConfiguration,
    ...(options.icmWorkspace === undefined ? {} : { icmWorkspace: options.icmWorkspace }),
    budget: { ...baseConfiguration.budget, ...budgetOverride },
    ...(inferenceProfile === undefined || inferenceProfile === 'historical' ? {} : { inferenceProfile }),
    roster: { ...baseConfiguration.roster, eligibleCharacterIds: [actorId, other.characterId],
      preparedCharacters: [...baseConfiguration.roster.preparedCharacters, { ...other, identity: { ...other.identity,
        value: { ...other.identity.value, selfConcept: 'SECRET_OTHER_PREPARATION' } } }] },
    worldSnapshot: { ...baseConfiguration.worldSnapshot,
      places: [...baseConfiguration.worldSnapshot.places, { id: 'oculto', name: 'Lugar oculto', description: 'SECRET_PRIVATE_PLACE', width: 10, height: 10, lighting: 'normal' }],
      entities: [...baseConfiguration.worldSnapshot.entities, { ...firstEntity, entityId: randomUUID(), characterId: other.characterId,
        trueDisplayName: 'SECRET_OTHER_TRUE_NAME', placeId: 'oculto', presence: { kind: 'absent' },
        mind: { ...firstEntity.mind, experiences: [privateExperience] } }] } });
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
  journal.configureRun({ runId, maxCalls: configuration.budget.maxPiCallsPerRun ?? 0 });
  journal.configurePulse({ runId, pulseId, maxCalls: configuration.budget.maxPiCallsPerPulse ?? 0 });
  // ICM execution is fenced to a real running coordinator pulse; historical
  // fixtures keep their direct scheduling path and original three-argument API.
  const scheduledJob = options.icmWorkspace === undefined ? (() => {
    const scheduled = journal.scheduleActorTurnJob({ runId, actorId, pulseId });
    assert.equal(scheduled.kind, 'scheduled');
    if (scheduled.kind !== 'scheduled') throw new Error('Fixture sin job');
    return scheduled.job;
  })() : (() => {
    const coordinated = journal.beginCoordinatorPulse({ runId });
    assert.equal(coordinated.kind, 'started');
    if (coordinated.kind !== 'started') throw new Error('Fixture ICM sin pulso');
    const job = coordinated.jobs.find((candidate) => candidate.actorId === actorId);
    assert.ok(job);
    return job;
  })();
  const claim = { runId, actorId, jobId: scheduledJob.jobId, generation: scheduledJob.generation,
    ownerToken: randomUUID(), claimToken: randomUUID() };
  const runtime = await PiRuntime.create({ privateDataRoot: directory });
  const ids = { eventId: randomUUID, perceptionId: randomUUID, experienceId: randomUUID, offerId: randomUUID,
    entityHandle: randomUUID, placeHandle: randomUUID, channelHandle: randomUUID, offerHandle: randomUUID };
  return { directory, journal, configuration, claim, runtime, ids,
    close() { journal.close(); rmSync(directory, { recursive: true, force: true }); } };
}

export type Fixture = Awaited<ReturnType<typeof setup>>;
export function deterministicFactory(fixture: Fixture, options: { omitProposal?: boolean; beforePrompt?: () => void; proposeAction?: () => unknown } = {}) {
  let disposed = 0;
  const prompts: PiPromptInput[] = [];
  const factory = async (input: CreatePiSessionInput) => {
    assert.deepEqual(input.profile, resolveReadyInferenceProfile(fixture.configuration));
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
        if (!options.omitProposal) {
          const tool = input.tools.find((item) => item.name === 'propose_action');
          assert.ok(tool);
          // The fake transport invokes the real tool exactly as the SDK would; unused SDK context is absent.
          await Reflect.apply(tool.execute, tool, ['tool-fixture', { nextInitiative: 'yield',
            action: options.proposeAction?.() ?? { kind: 'wait', durationMs: 1 } }]);
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

export function responseFor(context: ContinuistaReviewContext) {
  const proposal = context.payload.proposal;
  return { contextHash: context.contextHash, review: { kind: 'continuista', proposalId: proposal.proposalId,
    version: proposal.version, runId: proposal.runId, actorId: proposal.actorId, stateRevision: proposal.baseRevision,
    exactContentHash: proposal.exactContentHash,
    ...(proposal.nextInitiative===undefined?{}:{nextInitiative:proposal.nextInitiative}),
    verdict: 'allow', criterionCodes: ContinuistaCriterionSchema.options,
    evidenceRefs: ['ctx:proposal', 'ctx:preparation', 'ctx:projection'], complete: true } };
}
