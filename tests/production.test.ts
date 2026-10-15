import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { projectRunPreflightReport } from '../src/application/run-preflight-jobs.ts';
import { test } from 'node:test';
import { createEmptyRunConfigurationDraft, ProductionAudioSchema, RunBudgetSchema, RunConfigurationDraftSchema } from '../src/domain/production.ts';
import type { ProductionRoster } from '../src/domain/production.ts';
import { ContinuityContextSchema, PreparedCharacterSchema, SpanishVarietyForActingSchema } from '../src/domain/preparation.ts';
import type { PreparedCharacter } from '../src/domain/preparation.ts';
import { WorldSnapshotSchema } from '../src/domain/world.ts';
import type { WorldSnapshot } from '../src/domain/world.ts';
import {
  CLAUDE_INFERENCE_PROFILE, DEFAULT_INFERENCE_PROFILE, LEGACY_INFERENCE_PROFILE,
  PersistedInferenceProfileSchema, SelectableInferenceProfileSchema,
  isInferenceAuthenticationMethodAllowed, resolveReadyInferenceProfile, resolveStoredPiProfile,
} from '../src/domain/inference-profile.ts';
import type { PersistedInferenceProfile } from '../src/domain/inference-profile.ts';
import {
  createProductionPreflightPort, ReadyRunConfigurationSchema, resolveConfiguredSessionMode, validateRunConfiguration,
} from '../src/application/production-preflight.ts';
import type { ProductionPreflightHostPort, ReadyRunConfiguration } from '../src/application/production-preflight.ts';
import { CharacterIdSchema, RunIdSchema } from '../src/domain/values.ts';

const runId = RunIdSchema.parse('00000000-0000-4000-8000-000000000101');
const actorId = CharacterIdSchema.parse('personaje-prueba');
const sceneId = '00000000-0000-4000-8000-000000000102';
const actorEntityId = '00000000-0000-4000-8000-000000000103';
const fictionalAt = 1_234_567_890_000;
const recordedAt = '2026-10-14T12:00:00.000Z';
const accountFingerprint = 'b'.repeat(64);
const profileFingerprint = 'c'.repeat(64);

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
  inferenceProfile?: unknown;
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
    inferenceProfile: input.inferenceProfile === undefined ? draft.inferenceProfile : configured(input.inferenceProfile),
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

test('el borrador nuevo registra Sol 6.1 low y Ready conserva el perfil confirmado', () => {
  const empty = createEmptyRunConfigurationDraft({ runId, revision: 0 });
  assert.equal(empty.inferenceProfile?.kind, 'configured');
  if (empty.inferenceProfile?.kind === 'configured') {
    assert.deepEqual(empty.inferenceProfile.value, DEFAULT_INFERENCE_PROFILE);
    assert.equal(empty.inferenceProfile.evidence.kind, 'integrator-default');
    assert.equal(empty.inferenceProfile.evidence.decisionRef, 'S03-default-inference-profile-openai-codex-gpt-6.1-sol-low');
  }

  const selected = validateRunConfiguration({ draft: draftFixture({ inferenceProfile: CLAUDE_INFERENCE_PROFILE }) });
  assert.equal(selected.kind, 'ready');
  if (selected.kind === 'ready') assert.deepEqual(selected.configuration.inferenceProfile, CLAUDE_INFERENCE_PROFILE);
});

test('Luna sólo se puede leer como historia y un perfil ausente no se rellena retroactivamente', () => {
  assert.equal(SelectableInferenceProfileSchema.safeParse(LEGACY_INFERENCE_PROFILE).success, false);
  assert.equal(PersistedInferenceProfileSchema.safeParse(LEGACY_INFERENCE_PROFILE).success, true);
  assert.deepEqual(resolveStoredPiProfile({ provider: 'openai-codex', model: 'gpt-6-luna', reasoning: 'xhigh' }), LEGACY_INFERENCE_PROFILE);
  assert.deepEqual(resolveReadyInferenceProfile({}), LEGACY_INFERENCE_PROFILE);

  const { inferenceProfile: _profile, ...historicalDraft } = draftFixture();
  const draftResult = validateRunConfiguration({ draft: historicalDraft });
  assert.equal(draftResult.kind, 'incomplete');
  if (draftResult.kind === 'incomplete') {
    assert.ok(draftResult.issues.some((issue) => issue.code === 'draft-field-empty' && issue.field === 'inferenceProfile'));
  }

  const { inferenceProfile: _readyProfile, ...historicalReadyData } = readyFixture();
  const historicalReady = ReadyRunConfigurationSchema.parse(historicalReadyData);
  assert.equal('inferenceProfile' in historicalReady, false);
  assert.deepEqual(resolveReadyInferenceProfile(historicalReady), LEGACY_INFERENCE_PROFILE);

  const retired = validateRunConfiguration({ draft: draftFixture({ inferenceProfile: LEGACY_INFERENCE_PROFILE }) });
  assert.equal(retired.kind, 'invalid');
  if (retired.kind === 'invalid') assert.ok(retired.issues.some((issue) => issue.code === 'legacy-inference-profile'));
});

test('la política de credenciales es específica por proveedor', () => {
  assert.equal(isInferenceAuthenticationMethodAllowed({ provider: 'openai-codex', method: 'oauth' }), true);
  assert.equal(isInferenceAuthenticationMethodAllowed({ provider: 'openai-codex', method: 'api_key' }), false);
  assert.equal(isInferenceAuthenticationMethodAllowed({ provider: 'anthropic', method: 'oauth' }), true);
  assert.equal(isInferenceAuthenticationMethodAllowed({ provider: 'anthropic', method: 'api_key' }), true);
});

test('preflight no habilita OpenAI Codex con API key y exige un perfil nuevo en Ready histórico', async () => {
  const apiKeyReport = await createProductionPreflightPort({ host: hostFixture({
    async readInferenceAuthenticationStatus() {
      return { kind: 'authenticated', provider: 'openai-codex', method: 'api_key', accountFingerprint };
    },
  }) }).preflight({ configuration: readyFixture(), observedAt: '2026-10-14T12:30:00.000Z' });
  assert.equal(apiKeyReport.kind, 'blocked');
  assert.ok(apiKeyReport.checks.some((entry) => entry.kind === 'blocked'
    && entry.checkId === 'provider-authentication' && entry.code === 'authentication-method-incompatible'));

  const { inferenceProfile: _profile, ...historicalData } = readyFixture();
  const historicalReady = ReadyRunConfigurationSchema.parse(historicalData);
  let sdkReads = 0;
  const historicalReport = await createProductionPreflightPort({ host: hostFixture({
    async readPiSdkStatus() { sdkReads += 1; return { kind: 'ready', piCodingAgentVersion: '1.2.0', piAiVersion: '1.2.0', sessionFactoryAvailable: true }; },
  }, historicalReady) }).preflight({ configuration: historicalReady, observedAt: '2026-10-14T12:30:00.000Z' });
  assert.equal(historicalReport.kind, 'blocked');
  assert.equal(sdkReads, 0);
  assert.ok(historicalReport.checks.some((entry) => entry.kind === 'blocked'
    && entry.checkId === 'inference-profile' && entry.code === 'inference-profile-required'));
});

function observedProfile(
  selected: PersistedInferenceProfile = DEFAULT_INFERENCE_PROFILE,
  overrides: Record<string, string> = {},
) {
  return {
    ...selected, fingerprint: profileFingerprint,
    ...overrides,
  };
}

function hostFixture(
  overrides: Partial<ProductionPreflightHostPort> = {},
  configuration: ReadyRunConfiguration = readyFixture(),
): ProductionPreflightHostPort {
  const selectedProfile = configuration.inferenceProfile ?? LEGACY_INFERENCE_PROFILE;
  const authMethod = selectedProfile.provider === 'anthropic' ? 'api_key' : 'oauth';
  return {
    async readCurrentConfigurationRevision() { return { kind: 'loaded', revision: configuration.configRevision }; },
    async loadCurrentWorldSnapshot() { return configuration.worldSnapshot; },
    async loadPreparedActorContexts() { return { kind: 'loaded', runId, actors: configuration.roster.preparedCharacters }; },
    async readCatalogEligibility({ characterIds }) {
      return { kind: 'loaded', entries: characterIds.map((characterId) => ({ characterId, state: { kind: 'eligible' } })) };
    },
    async readPiSdkStatus() {
      return { kind: 'ready', piCodingAgentVersion: '1.2.0', piAiVersion: '1.2.0', sessionFactoryAvailable: true };
    },
    async readPiModelProfile() { return { kind: 'configured', profile: observedProfile(selectedProfile) }; },
    async readInferenceAuthenticationStatus({ provider }) {
      return { kind: 'authenticated', provider, method: authMethod, accountFingerprint };
    },
    async readInferenceAccessCheckReceipt({ provider }) {
      return {
        kind: 'passed', provider, accountFingerprint, profileFingerprint,
        checkedAt: '2026-10-14T11:00:00.000Z', expiresAt: '2026-10-14T13:00:00.000Z',
      };
    },
    async readPiRuntimeReadiness({ activeCharacterIds }) {
      return {
        kind: 'ready', requiredAdminRoles: [], identities: activeCharacterIds.map((characterId) => ({
          kind: 'actor', characterId, state: 'ready-to-create', effectiveProfile: observedProfile(selectedProfile),
          tools: ['recall_memory', 'propose_action'],
        })),
      };
    },
    async readIcmMemoryReadiness({ actorIds }) {
      return {
        kind: 'ready', version: '0.11.4', backend: 'sqlite',
        actors: actorIds.map((characterId) => ({
          runId, characterId, state: 'recoverable', isolation: { kind: 'run-actor', runId, characterId },
        })),
      };
    },
    async readRunBudgetReadiness() {
      return { kind: 'available', runCallsUsed: 0, pulseCallsUsed: 0, activePiRequests: 0, wallTimeUsedMs: 0 };
    },
    async readVoiceReadiness() { return { kind: 'ready', credential: 'present', bindings: [] }; },
    ...overrides,
  };
}

test('un borrador vacío permanece incompleto y jamás deriva fecha ficticia del reloj del equipo', () => {
  const draft = createEmptyRunConfigurationDraft({ runId, revision: 0 });
  assert.equal(draft.fictionalAt.kind, 'empty');
  assert.equal(draft.audio.kind, 'configured');
  if (draft.audio.kind === 'configured') assert.equal(draft.audio.value.mode.kind, 'disabled');
  assert.equal(draft.narrationMode.kind, 'configured');
  if (draft.narrationMode.kind === 'configured') assert.equal(draft.narrationMode.value.kind, 'disabled');
  assert.equal(draft.maxReformulations.kind, 'configured');
  if (draft.maxReformulations.kind === 'configured') assert.equal(draft.maxReformulations.value, 2);
  assert.equal(validateRunConfiguration({ draft }).kind, 'incomplete');
});

test('ready se construye con snapshot y PreparedCharacter completos, admite escena solitaria y no crea interlocutor', () => {
  const result = validateRunConfiguration({ draft: draftFixture() });
  assert.equal(result.kind, 'ready');
  if (result.kind !== 'ready') return;
  assert.deepEqual(result.configuration.worldSnapshot.scenes[0]?.participantIds, [actorId]);
  assert.equal(result.configuration.roster.activeCharacterIds.length, 1);
  assert.equal(result.configuration.language, 'es');
  assert.equal(result.configuration.audio.mode.kind, 'disabled');
  assert.equal(result.configuration.maxReformulations, 2);
});

test('el perfil humano persiste en Ready y su modo requiere identidad, corrida y escena configuradas', () => {
  const profile = {
    identity: {
      participantId: 'andres-en-la-ficcion', displayName: 'Andrés',
      identityMarkdown: 'Visitante de identidad propia.', lifeStoryMarkdown: 'Historia creada para esta representación.',
    },
    presence: {
      kind: 'inScene', sceneId, placeId: 'sala', position: { x: 8, y: 7 },
      channelId: '00000000-0000-4000-8000-000000000104',
    },
  };
  const configuration = readyFixture({ humanParticipants: [profile] });
  assert.deepEqual(configuration.humanParticipants, [profile]);

  let requestedRunId: unknown;
  const readWorldConfiguration = (request: { runId: unknown }) => {
    requestedRunId = request.runId;
    return configuration;
  };
  const interlocutor = { kind: 'interlocutor', runId, participantId: 'andres-en-la-ficcion' };
  assert.deepEqual(resolveConfiguredSessionMode({ candidate: interlocutor, readWorldConfiguration }), interlocutor);
  assert.equal(requestedRunId, runId);
  assert.equal(resolveConfiguredSessionMode({
    candidate: { ...interlocutor, participantId: 'not-configured' }, readWorldConfiguration,
  }), null);
  assert.equal(resolveConfiguredSessionMode({
    candidate: { ...interlocutor, runId: RunIdSchema.parse('00000000-0000-4000-8000-000000000999') }, readWorldConfiguration,
  }), null);
  const semanticallyInvalidConfiguration = {
    ...configuration,
    humanParticipants: [{
      ...profile,
      presence: { ...profile.presence, channelId: '00000000-0000-4000-8000-000000000999' },
    }],
  };
  assert.equal(resolveConfiguredSessionMode({
    candidate: interlocutor,
    readWorldConfiguration: () => semanticallyInvalidConfiguration,
  }), null);
  assert.equal(resolveConfiguredSessionMode({
    candidate: { kind: 'director', runId, scope: { kind: 'scene', sceneId: '00000000-0000-4000-8000-000000000999' } },
    readWorldConfiguration,
  }), null);
});

test('la configuración rechaza un perfil humano fuera de la escena o con canal no habilitado', () => {
  const badPosition = validateRunConfiguration({ draft: draftFixture({ humanParticipants: [{
    identity: { participantId: 'persona', displayName: 'Persona', identityMarkdown: 'Identidad.', lifeStoryMarkdown: 'Historia.' },
    presence: { kind: 'inScene', sceneId, placeId: 'sala', position: { x: 11, y: 3 }, channelId: '00000000-0000-4000-8000-000000000104' },
  }] }) });
  assert.equal(badPosition.kind, 'invalid');
  if (badPosition.kind === 'invalid') assert.ok(badPosition.issues.some((issue) => issue.code === 'human-participant-invalid'));

  const badChannel = validateRunConfiguration({ draft: draftFixture({ humanParticipants: [{
    identity: { participantId: 'persona', displayName: 'Persona', identityMarkdown: 'Identidad.', lifeStoryMarkdown: 'Historia.' },
    presence: { kind: 'inScene', sceneId, placeId: 'sala', position: { x: 3, y: 3 }, channelId: '00000000-0000-4000-8000-000000000999' },
  }] }) });
  assert.equal(badChannel.kind, 'invalid');
  if (badChannel.kind === 'invalid') assert.ok(badChannel.issues.some((issue) => issue.code === 'human-participant-invalid'));
});

test('una fecha de emisión no sustituye el momento de ficción y un reloj discrepante invalida ready', () => {
  const result = validateRunConfiguration({ draft: draftFixture({ moment: fictionalAt - 1 }) });
  assert.equal(result.kind, 'invalid');
  if (result.kind === 'invalid') assert.ok(result.issues.some((issue) => issue.code === 'fictional-time-mismatch'));
  const draft = draftFixture();
  assert.throws(() => RunConfigurationDraftSchema.parse({ ...draft, emissionDate: '1965-09-18' }));
});

test('un participante inicial debe estar en el reparto activo y no se añade por suposición', () => {
  const result = validateRunConfiguration({ draft: draftFixture({ activeCharacterIds: [] }) });
  assert.equal(result.kind, 'invalid');
  if (result.kind === 'invalid') {
    assert.ok(result.issues.some((issue) => issue.code === 'roster-empty'));
    assert.ok(result.issues.some((issue) => issue.code === 'participant-not-active'));
  }
});

test('propuesta española permite texto, pero impide activar TTS sin confirmación', () => {
  const proposedAudio = ProductionAudioSchema.parse({
    mode: { kind: 'enabled', language: 'es', ttsMode: 'manual-per-publication', ttsModelId: 'tts-model-explicito', outputFormat: 'mp3_44100_128', subtitles: true },
    speakerSlots: [{ characterId: actorId, slot: { kind: 'disabled' } }],
    narratorSlot: { kind: 'absent' }, soundEffectSlots: [],
  });
  const result = validateRunConfiguration({ draft: draftFixture({ audio: proposedAudio }) });
  assert.equal(result.kind, 'invalid');
  if (result.kind === 'invalid') assert.ok(result.issues.some((issue) => issue.code === 'audio-requires-confirmed-variety'));
  const textOnly = validateRunConfiguration({ draft: draftFixture() });
  assert.equal(textOnly.kind, 'ready');
});

test('Fang preparado como no verbal no recibe capacidad ni slot de habla humana', () => {
  const prepared = preparedFixture({ nonverbal: true });
  const result = validateRunConfiguration({ draft: draftFixture({ prepared, world: worldFixture({ nonverbal: true }) }) });
  assert.equal(result.kind, 'ready');
  const invalidWorld = worldFixture({ nonverbal: false, speak: true });
  const invalid = validateRunConfiguration({ draft: draftFixture({ prepared, world: invalidWorld }) });
  assert.equal(invalid.kind, 'invalid');
  if (invalid.kind === 'invalid') assert.ok(invalid.issues.some((issue) => issue.code === 'nonverbal-actor-has-speech'));
});

test('la disponibilidad se evalúa en el instante ficticio y una rutina pendiente queda visible como diferida', async () => {
  const unavailableWorld = worldFixture({
    routine: { kind: 'windows', defaultState: 'unavailable', windows: [{ from: fictionalAt + 10_000, to: fictionalAt + 20_000, state: 'available' }] },
  });
  const ready = readyFixture({ world: unavailableWorld });
  assert.equal(ready.participantAvailability[0]?.kind, 'unavailable');
  const port = createProductionPreflightPort({ host: hostFixture({
    async loadCurrentWorldSnapshot() { return unavailableWorld; },
  }) });
  const report = await port.preflight({ configuration: ready, observedAt: '2026-10-14T12:30:00.000Z' });
  assert.equal(report.kind, 'blocked');
  assert.ok(report.checks.some((entry) => entry.kind === 'deferred' && entry.checkId === `availability-${actorId}`));
});

test('preflight comprueba dependencias reales registradas sin llamar modelos ni proveedores', async () => {
  const configuration = readyFixture();
  let modelCalls = 0;
  let accessChecks = 0;
  const host = hostFixture({
    async readInferenceAccessCheckReceipt(input) {
      accessChecks += 1;
      assert.equal(input.provider, 'openai-codex');
      assert.equal(input.accountFingerprint, accountFingerprint);
      assert.equal(input.profileFingerprint, profileFingerprint);
      return {
        kind: 'passed', provider: 'openai-codex', accountFingerprint, profileFingerprint,
        checkedAt: '2026-10-14T11:00:00.000Z', expiresAt: '2026-10-14T13:00:00.000Z',
      };
    },
  });
  const report = await createProductionPreflightPort({ host }).preflight({
    configuration, observedAt: '2026-10-14T12:30:00.000Z',
  });
  assert.equal(report.kind, 'passed');
  assert.equal(modelCalls, 0);
  assert.equal(accessChecks, 1);
  assert.ok(report.checks.some((entry) => entry.kind === 'passed' && entry.checkId === 'icm-memory'));
});

test('Claude Opus 5.5 usa su propio perfil y acepta credencial API key', async () => {
  const configuration = readyFixture({ inferenceProfile: CLAUDE_INFERENCE_PROFILE });
  let requestedProvider: string | undefined;
  const host = hostFixture({
    async readInferenceAuthenticationStatus({ provider }) {
      requestedProvider = provider;
      assert.equal(provider, 'anthropic');
      return { kind: 'authenticated', provider: 'anthropic', method: 'api_key', accountFingerprint };
    },
  }, configuration);
  const report = await createProductionPreflightPort({ host }).preflight({
    configuration, observedAt: '2026-10-14T12:30:00.000Z',
  });
  assert.equal(requestedProvider, 'anthropic');
  assert.equal(report.kind, 'passed');
  assert.ok(report.checks.some((entry) => entry.kind === 'passed' && entry.checkId === 'provider-authentication'));
});

test('perfil Pi incorrecto bloquea sin fallback y sin access-check live implícito', async () => {
  let accessChecks = 0;
  const host = hostFixture({
    async readPiModelProfile() { return { kind: 'configured', profile: observedProfile(DEFAULT_INFERENCE_PROFILE, { model: 'gpt-6-astra' }) }; },
    async readInferenceAccessCheckReceipt() { accessChecks += 1; return { kind: 'missing', provider: 'openai-codex' }; },
  });
  const report = await createProductionPreflightPort({ host }).preflight({
    configuration: readyFixture(), observedAt: '2026-10-14T12:30:00.000Z',
  });
  assert.equal(report.kind, 'blocked');
  assert.ok(report.checks.some((entry) => entry.kind === 'blocked' && entry.checkId === 'pi-profile'));
  assert.equal(accessChecks, 0);
});

test('autenticación ausente bloquea nuevas inferencias y conserva la comprobación como paso explícito', async () => {
  const host = hostFixture({
    async readInferenceAuthenticationStatus() { return { kind: 'disconnected', provider: 'openai-codex' }; },
  });
  const report = await createProductionPreflightPort({ host }).preflight({
    configuration: readyFixture(), observedAt: '2026-10-14T12:30:00.000Z',
  });
  assert.equal(report.kind, 'blocked');
  assert.ok(report.checks.some((entry) => entry.kind === 'blocked' && entry.checkId === 'provider-authentication'));
});

test('sin prueba de acceso Pi, preflight no llama al proveedor y deja el inicio bloqueado', async () => {
  let receiptReads = 0;
  const host = hostFixture({
    async readInferenceAccessCheckReceipt() { receiptReads += 1; return { kind: 'missing', provider: 'openai-codex' }; },
  });
  const report = await createProductionPreflightPort({ host }).preflight({
    configuration: readyFixture(), observedAt: '2026-10-14T12:30:00.000Z',
  });
  assert.equal(report.kind, 'blocked');
  assert.equal(receiptReads, 1);
  assert.ok(report.checks.some((entry) => entry.kind === 'deferred' && entry.checkId === 'provider-access-check'));
});

test('una prueba de acceso expirada queda diferida y no autoriza el inicio', async () => {
  let receiptReads = 0;
  const host = hostFixture({
    async readInferenceAccessCheckReceipt() {
      receiptReads += 1;
      return {
        kind: 'passed', provider: 'openai-codex', accountFingerprint, profileFingerprint,
        checkedAt: '2026-10-14T10:00:00.000Z', expiresAt: '2026-10-14T12:00:00.000Z',
      };
    },
  });
  const report = await createProductionPreflightPort({ host }).preflight({
    configuration: readyFixture(), observedAt: '2026-10-14T12:30:00.000Z',
  });
  assert.equal(report.kind, 'blocked');
  assert.equal(receiptReads, 1);
  assert.ok(report.checks.some((entry) => entry.kind === 'deferred' && entry.checkId === 'provider-access-check'));
});

test('un fallo live vigente de acceso Pi bloquea, sin repetir el test', async () => {
  let receiptReads = 0;
  const host = hostFixture({
    async readInferenceAccessCheckReceipt() {
      receiptReads += 1;
      return {
        kind: 'failed', provider: 'openai-codex', accountFingerprint, profileFingerprint,
        checkedAt: '2026-10-14T12:00:00.000Z', expiresAt: '2026-10-14T13:00:00.000Z',
        code: 'provider-access-denied',
      };
    },
  });
  const report = await createProductionPreflightPort({ host }).preflight({
    configuration: readyFixture(), observedAt: '2026-10-14T12:30:00.000Z',
  });
  assert.equal(report.kind, 'blocked');
  assert.equal(receiptReads, 1);
  assert.ok(report.checks.some((entry) => entry.kind === 'blocked' && entry.checkId === 'provider-access-check' && entry.code === 'provider-access-denied'));
});

test('snapshot cambiado o contexto preparado distinto por contenido invalida el preflight', async () => {
  const configuration = readyFixture();
  const configReport = await createProductionPreflightPort({ host: hostFixture({
    async readCurrentConfigurationRevision() { return { kind: 'loaded', revision: configuration.configRevision + 1 }; },
  }) }).preflight({ configuration, observedAt: '2026-10-14T12:30:00.000Z' });
  assert.equal(configReport.kind, 'blocked');
  assert.ok(configReport.checks.some((entry) => entry.kind === 'blocked' && entry.checkId === 'configuration-version'));

  const staleWorld = WorldSnapshotSchema.parse({ ...configuration.worldSnapshot, revision: configuration.worldSnapshot.revision + 1 });
  const worldReport = await createProductionPreflightPort({ host: hostFixture({
    async loadCurrentWorldSnapshot() { return staleWorld; },
  }) }).preflight({ configuration, observedAt: '2026-10-14T12:30:00.000Z' });
  assert.equal(worldReport.kind, 'blocked');

  const modifiedPrepared = PreparedCharacterSchema.parse({
    ...configuration.roster.preparedCharacters[0],
    identity: {
      ...configuration.roster.preparedCharacters[0]?.identity,
      value: { ...configuration.roster.preparedCharacters[0]?.identity.value, selfConcept: 'Contexto modificado.' },
    },
  });
  const contextReport = await createProductionPreflightPort({ host: hostFixture({
    async loadPreparedActorContexts() { return { kind: 'loaded', runId, actors: [modifiedPrepared] }; },
  }) }).preflight({ configuration, observedAt: '2026-10-14T12:30:00.000Z' });
  assert.equal(contextReport.kind, 'blocked');
  assert.ok(contextReport.checks.some((entry) => entry.kind === 'blocked' && entry.checkId === 'prepared-contexts'));
});

test('un ready manipulado semánticamente se bloquea antes de leer puertos del host', async () => {
  let hostReads = 0;
  const configuration = { ...readyFixture(), preparedActorFences: [] };
  const host = hostFixture({
    async loadCurrentWorldSnapshot() { hostReads += 1; return configuration.worldSnapshot; },
    async loadPreparedActorContexts() { hostReads += 1; return { kind: 'loaded', runId, actors: configuration.roster.preparedCharacters }; },
  });
  const report = await createProductionPreflightPort({ host }).preflight({
    configuration, observedAt: '2026-10-14T12:30:00.000Z',
  });
  assert.equal(report.kind, 'blocked');
  assert.equal(hostReads, 0);
  assert.ok(report.checks.some((entry) => entry.kind === 'blocked' && entry.checkId === 'configuration'));
});

test('una puesta con narrator activado y sin binding conserva texto y difiere TTS', async () => {
  const audio = ProductionAudioSchema.parse({
    mode: {
      kind: 'enabled', language: 'es', ttsMode: 'automatic-after-publication',
      ttsModelId: 'eleven_multilingual_v2', outputFormat: 'mp3_44100_128', subtitles: true,
    },
    speakerSlots: [{ characterId: actorId, slot: { kind: 'enabled-unbound' } }],
    narratorSlot: { kind: 'enabled-unbound' },
    soundEffectSlots: [],
  });
  const variety = SpanishVarietyForActingSchema.parse({
    kind: 'confirmed', label: 'Español rioplatense', source: 'operator',
    confirmedBy: 'test-operator', confirmedAt: recordedAt,
  });
  const configuration = readyFixture({ audio, variety, narrationMode: { kind: 'enabled' } });
  const host = hostFixture({
    async readPiRuntimeReadiness({ activeCharacterIds }) {
      return {
        kind: 'ready', requiredAdminRoles: ['narrador'],
        identities: [
          ...activeCharacterIds.map((characterId) => ({
            kind: 'actor', characterId, state: 'ready-to-create', effectiveProfile: observedProfile(),
            tools: ['recall_memory', 'propose_action'],
          })),
          { kind: 'admin', roles: ['narrador'], state: 'ready-to-create', effectiveProfile: observedProfile(), tools: [] },
        ],
      };
    },
  });
  const report = await createProductionPreflightPort({ host }).preflight({
    configuration, observedAt: '2026-10-14T12:30:00.000Z',
  });
  assert.equal(report.kind, 'blocked');
  assert.ok(report.checks.some((entry) => entry.kind === 'deferred' && entry.checkId === 'voice' && entry.detail.startsWith('2 slot(s)')));
});

test('narración es independiente del binding de voz y requiere readiness de su rol LLM', async () => {
  const configuration = readyFixture({ narrationMode: { kind: 'enabled' } });
  const blocked = await createProductionPreflightPort({ host: hostFixture() }).preflight({
    configuration, observedAt: '2026-10-14T12:30:00.000Z',
  });
  assert.equal(blocked.kind, 'blocked');
  assert.ok(blocked.checks.some((entry) => entry.kind === 'blocked' && entry.checkId === 'pi-runtime'));

  const host = hostFixture({
    async readPiRuntimeReadiness({ activeCharacterIds }) {
      return {
        kind: 'ready', requiredAdminRoles: ['narrador'],
        identities: [
          ...activeCharacterIds.map((characterId) => ({
            kind: 'actor', characterId, state: 'ready-to-create', effectiveProfile: observedProfile(),
            tools: ['recall_memory', 'propose_action'],
          })),
          { kind: 'admin', roles: ['narrador'], state: 'ready-to-create', effectiveProfile: observedProfile(), tools: [] },
        ],
      };
    },
  });
  const passed = await createProductionPreflightPort({ host }).preflight({
    configuration, observedAt: '2026-10-14T12:30:00.000Z',
  });
  assert.equal(passed.kind, 'passed');
  assert.ok(passed.checks.some((entry) => entry.kind === 'passed' && entry.checkId === 'pi-runtime'));
});

test('una solicitud de preflight mal formada no inventa fecha o corrida de reporte', async () => {
  const host = hostFixture({
    async loadCurrentWorldSnapshot() { throw new Error('No debe leerse el host.'); },
  });
  const report = await createProductionPreflightPort({ host }).preflight({ configuration: {}, observedAt: 'not-a-date' });
  assert.equal(report.kind, 'invalid');
  assert.equal(report.checks[0]?.kind, 'blocked');
});

test('variedad confirmada es precondición de audio y modelo se verifica sin síntesis', async () => {
  const confirmedVariety = SpanishVarietyForActingSchema.parse({
    kind: 'confirmed', label: 'Español rioplatense', source: 'operator',
    confirmedBy: 'test-operator', confirmedAt: recordedAt,
  });
  const audio = ProductionAudioSchema.parse({
    mode: { kind: 'enabled', language: 'es', ttsMode: 'manual-per-publication', ttsModelId: 'tts-model-explicito', outputFormat: 'mp3_44100_128', subtitles: true },
    speakerSlots: [{ characterId: actorId, slot: { kind: 'enabled-unbound' } }],
    narratorSlot: { kind: 'absent' }, soundEffectSlots: [],
  });
  const configuration = readyFixture({ variety: confirmedVariety, audio });
  let voiceChecks = 0;
  let generationCalls = 0;
  const host = hostFixture({
    async readVoiceReadiness() {
      voiceChecks += 1;
      return { kind: 'ready', credential: 'present', bindings: [] };
    },
  });
  const report = await createProductionPreflightPort({ host }).preflight({
    configuration, observedAt: '2026-10-14T12:30:00.000Z',
  });
  assert.equal(report.kind, 'blocked');
  assert.equal(voiceChecks, 1);
  assert.equal(generationCalls, 0);
  assert.ok(report.checks.some((entry) => entry.kind === 'deferred' && entry.checkId === 'voice'));
});

test('el tope de reformulación es 0–2; el borrador usa dos como default reversible', () => {
  const draft = draftFixture();
  assert.throws(() => RunConfigurationDraftSchema.parse({
    ...draft,
    maxReformulations: configured(3),
  }));
});


test('presupuestos admiten cero y validan techos configurados antes de ready', () => {
  const zero = { maxPiCallsPerRun: 0, maxPiCallsPerPulse: 0, maxConcurrentPiRequests: 1, maxWallTimeMs: 0 };
  assert.deepEqual(RunBudgetSchema.parse(zero),zero);
  const draft = draftFixture();
  const ready = validateRunConfiguration({ draft: RunConfigurationDraftSchema.parse({ ...draft, budget: configured(zero) }) });
  assert.equal(ready.kind,'ready');
  if (ready.kind==='ready') assert.deepEqual(ready.configuration.budget,zero);
  const ceilings = {maxPiCallsPerRun:100_000,maxPiCallsPerPulse:256,maxConcurrentPiRequests:8,maxWallTimeMs:31_536_000_000};
  assert.deepEqual(RunBudgetSchema.parse(ceilings),ceilings);
  for (const field of ['maxPiCallsPerRun','maxPiCallsPerPulse','maxConcurrentPiRequests','maxWallTimeMs']) {
    assert.equal(RunBudgetSchema.safeParse({...ceilings,[field]:(field === 'maxPiCallsPerRun' ? ceilings.maxPiCallsPerRun : field === 'maxPiCallsPerPulse' ? ceilings.maxPiCallsPerPulse : field === 'maxConcurrentPiRequests' ? ceilings.maxConcurrentPiRequests : ceilings.maxWallTimeMs)+1}).success,false,field);
    assert.equal(RunBudgetSchema.safeParse({...ceilings,[field]:-1}).success,false,field);
  }
  assert.equal(RunBudgetSchema.safeParse({...zero,maxConcurrentPiRequests:0}).success,false);
  assert.equal(RunBudgetSchema.safeParse({...zero,maxConcurrentPiRequests:8}).success,true);
  assert.equal(RunBudgetSchema.safeParse({...ceilings,maxPiCallsPerPulse:2,maxConcurrentPiRequests:3}).success,false);
  assert.equal(RunBudgetSchema.safeParse({...ceilings,maxPiCallsPerRun:1,maxPiCallsPerPulse:2}).success,false);
});

test('preflight evaluates effective audio enabled after disabled Ready, and disabling the last slot clears binding deferral',async()=>{
 const configuration=readyFixture({variety:SpanishVarietyForActingSchema.parse({kind:'confirmed',label:'Español rioplatense',source:'operator',confirmedBy:'operator',confirmedAt:recordedAt})});
 const effectiveConfig={revision:2,spanishVariety:configuration.spanishVariety,audioMode:{kind:'enabled',language:'es',ttsMode:'manual-per-publication',ttsModelId:'speech-model',outputFormat:'mp3_44100_128',subtitles:true},speakerSlots:{[actorId]:{kind:'enabled-unbound'}},narratorSlot:{kind:'absent'},soundEffectSlots:{}};
 let checks=0;
 const report=await createProductionPreflightPort({host:hostFixture({async readVoiceReadiness(){checks++;return {kind:'ready',credential:'present',effectiveConfig,bindings:[]};}})}).preflight({configuration,observedAt:recordedAt});
 assert.equal(checks,1);assert.ok(report.checks.some(check=>check.checkId==='voice'&&check.kind==='blocked'&&check.code==='voice-binding-required'));
 assert.ok(projectRunPreflightReport(report,recordedAt).checks.some(check=>check.checkId==='voice'&&check.code==='voice-binding-required'));
 const disabled=await createProductionPreflightPort({host:hostFixture({async readVoiceReadiness(){return {kind:'ready',credential:'present',effectiveConfig:{...effectiveConfig,speakerSlots:{[actorId]:{kind:'disabled'}}},bindings:[]};}})}).preflight({configuration,observedAt:recordedAt});
 assert.ok(disabled.checks.some(check=>check.checkId==='voice'&&check.kind==='passed'));
 const missing=await createProductionPreflightPort({host:hostFixture({async readVoiceReadiness(){return {kind:'ready',credential:'missing',effectiveConfig,bindings:[]};}})}).preflight({configuration,observedAt:recordedAt});
 assert.ok(missing.checks.some(check=>check.checkId==='voice'&&check.kind==='blocked'&&check.code==='voice-credential-missing'));
});

test('effective speech bindings replace frozen unbound slots and must match voice owner/model/variety',async()=>{
 const variety=SpanishVarietyForActingSchema.parse({kind:'confirmed',label:'Español rioplatense',source:'operator',confirmedBy:'operator',confirmedAt:recordedAt});
 const mode={kind:'enabled',language:'es',ttsMode:'manual-per-publication',ttsModelId:'speech-model',outputFormat:'mp3_44100_128',subtitles:true};
 const configuration=readyFixture({variety,audio:ProductionAudioSchema.parse({mode,speakerSlots:[{characterId:actorId,slot:{kind:'enabled-unbound'}}],narratorSlot:{kind:'absent'},soundEffectSlots:[]})});
 const id=randomUUID();
 const effectiveConfig={revision:3,spanishVariety:variety,audioMode:mode,speakerSlots:{[actorId]:{kind:'enabled-bound',speechBindingId:id}},narratorSlot:{kind:'absent'},soundEffectSlots:{}};
 const binding={kind:'speech',owner:{kind:'character',characterId:actorId},speechBindingId:id,provider:'elevenlabs',language:'es',ttsModelId:'speech-model',varietyLabel:variety.label,validationEvidenceId:randomUUID()};
 const run=async(bindings:unknown[])=>createProductionPreflightPort({host:hostFixture({async readVoiceReadiness(){return {kind:'ready',credential:'present',effectiveConfig,bindings};}})}).preflight({configuration,observedAt:recordedAt});
 assert.ok((await run([binding])).checks.some(check=>check.checkId==='voice'&&check.kind==='passed'));
 for (const wrong of [{...binding,ttsModelId:'other-model'},{...binding,varietyLabel:'Otra variedad'},{...binding,owner:{kind:'narrator'}}]) assert.ok((await run([wrong])).checks.some(check=>check.checkId==='voice'&&check.kind==='blocked'));
});

test('preflight cannot accept corrupt effective settings or unavailable local evidence merely because Ready audio was off',async()=>{
 const configuration=readyFixture();
 for(const result of [{kind:'unavailable',code:'voice-local-evidence-unavailable'},{kind:'ready',credential:'missing',effectiveConfig:{revision:'bad'},bindings:[]}]) {
  const report=await createProductionPreflightPort({host:hostFixture({async readVoiceReadiness(){return result;}})}).preflight({configuration,observedAt:recordedAt});
  assert.ok(report.checks.some(check=>check.checkId==='voice'&&check.kind==='unavailable'));
 }
});

test('initial enabled narrator requires narration and bound effects require active nonverbal owners',()=>{
 const base=readyFixture();
 const mode={kind:'enabled',language:'es',ttsMode:'manual-per-publication',ttsModelId:'speech-model',outputFormat:'mp3_44100_128',subtitles:true};
 const draft=draftFixture();
 const variety=SpanishVarietyForActingSchema.parse({kind:'confirmed',label:'Español rioplatense',source:'operator',confirmedBy:'operator',confirmedAt:recordedAt});
 for(const audio of [
  {mode,speakerSlots:[{characterId:actorId,slot:{kind:'disabled'}}],narratorSlot:{kind:'enabled-unbound'},soundEffectSlots:[]},
  {...base.audio,soundEffectSlots:[{characterId:actorId,slot:{kind:'enabled-bound',soundBindingId:randomUUID()}}]},
 ]) {
   const result=validateRunConfiguration({draft:RunConfigurationDraftSchema.parse({...draft,spanishVariety:configured(variety),audio:configured(ProductionAudioSchema.parse(audio))})});
   assert.equal(result.kind,'invalid');if(result.kind==='invalid')assert.ok(result.issues.some(issue=>issue.code==='speaker-slot-mismatch'));
 }
});

test('bound nonverbal effects require credentials and matching assets independently of speech audio mode',async()=>{
 const prepared=preparedFixture({nonverbal:true});
 const configuration=readyFixture({prepared,world:worldFixture({nonverbal:true})});
 const id=randomUUID();
 const effectiveConfig={revision:2,spanishVariety:configuration.spanishVariety,audioMode:{kind:'disabled'},speakerSlots:{},narratorSlot:{kind:'absent'},soundEffectSlots:{[prepared.characterId]:{kind:'enabled-bound',soundBindingId:id}}};
 const binding={kind:'sound-effect',owner:{kind:'character',characterId:prepared.characterId},soundBindingId:id,provider:'elevenlabs',assetState:'ready'};
 const run=(credential:string,bindings:unknown[])=>createProductionPreflightPort({host:hostFixture({async loadCurrentWorldSnapshot(){return configuration.worldSnapshot;},async loadPreparedActorContexts(){return {kind:'loaded',runId:configuration.runId,actors:configuration.roster.preparedCharacters};},async readVoiceReadiness(){return {kind:'ready',credential,effectiveConfig,bindings};}})}).preflight({configuration,observedAt:recordedAt});
 const present=await run('present',[binding]);assert.ok(present.checks.some(check=>check.checkId==='voice'&&check.kind==='passed'),JSON.stringify(present));
 assert.ok((await run('missing',[binding])).checks.some(check=>check.checkId==='voice'&&check.kind==='blocked'&&check.code==='voice-credential-missing'));
 assert.ok((await run('present',[])).checks.some(check=>check.checkId==='voice'&&check.kind==='blocked'&&check.code==='voice-binding-invalid'));
});
