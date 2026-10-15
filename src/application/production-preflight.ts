import { RunForkOriginSchema } from '../domain/fork-origin.ts';
import { routineIsAvailable, routineCalendarDiagnostics, dayNightCalendarDiagnostics } from '../domain/routine-calendar.ts';
import { PreflightSnapshotFenceSchema as RunSnapshotFenceSchema, PreflightCheckSchema, PreflightReportSchema, type PreflightCheck, type PreflightReport } from '../domain/preflight-report.ts';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { VoiceConfigSchema } from '../domain/voice.ts';
import { SessionModeSchema } from '../domain/http.ts';
import {
  isInferenceAuthenticationMethodAllowed, LEGACY_INFERENCE_PROFILE, PersistedInferenceProfileSchema,
  SelectableInferenceProfileSchema, type InferenceProvider, type SelectableInferenceProfile,
} from '../domain/inference-profile.ts';
import {
  CircadianPolicySchema, DramaticLineSchema, DramaticReferencesSchema, ProductionValidationIssueSchema,
  HumanParticipantProfilesSchema, NarrationModeSchema, ProductionAudioSchema, ProductionRosterSchema, RunBudgetSchema,
  RunConfigurationDraftSchema, SpeechBindingIdSchema, SoundBindingIdSchema,
} from '../domain/production.ts';
import type {
  DramaticLine, NarrationMode, ProductionAudio, ProductionRoster,
  HumanParticipantProfiles, RunBudget,
} from '../domain/production.ts';
import {
  ContinuityContextSchema, ContinuityReferenceSchema, PreparedCharacterSchema,
  SpanishVarietyForActingSchema,
} from '../domain/preparation.ts';
import type { ContinuityContext, PreparedCharacter, SpanishVarietyForActing } from '../domain/preparation.ts';
import {
  CharacterIdSchema, FictionalInstantSchema, HashSchema, RevisionSchema, RunIdSchema,
} from '../domain/values.ts';
import {
  WorldSnapshotSchema,
} from '../domain/world.ts';
import type { WorldSnapshot, WorldCharacter } from '../domain/world.ts';

const nonNegativeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);


export type RunSnapshotFence = z.infer<typeof RunSnapshotFenceSchema>;

const PreparedActorFenceSchema = z.strictObject({
  characterId: CharacterIdSchema,
  identityVersion: RevisionSchema,
  dossierRevision: RevisionSchema,
  dossierHash: HashSchema,
  continuity: ContinuityReferenceSchema,
});
export type PreparedActorFence = z.infer<typeof PreparedActorFenceSchema>;

const ParticipantAvailabilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('available'), characterId: CharacterIdSchema }),
  z.strictObject({
    kind: z.literal('unavailable'),
    characterId: CharacterIdSchema,
    reason: z.enum(['explicit', 'routine']),
  }),
]);
export type ParticipantAvailability = z.infer<typeof ParticipantAvailabilitySchema>;

export const ReadyRunConfigurationSchema = z.strictObject({
  kind: z.literal('ready-run-configuration'),
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  configRevision: RevisionSchema,
  forkOrigin: RunForkOriginSchema.optional(),
  name: z.string().trim().min(1).max(120),
  fictionalAt: FictionalInstantSchema,
  continuity: ContinuityContextSchema,
  roster: ProductionRosterSchema,
  humanParticipants: HumanParticipantProfilesSchema,
  worldSnapshot: WorldSnapshotSchema,
  dramaticLine: DramaticLineSchema,
  /** Missing only in legacy configurations; references are never required for readiness. */
  dramaticReferences: DramaticReferencesSchema.optional(),
  circadianPolicy: CircadianPolicySchema,
  language: z.literal('es'),
  spanishVariety: SpanishVarietyForActingSchema,
  narrationMode: NarrationModeSchema,
  /** Missing only in a pre-profile historical snapshot; selection is explicit in new Ready setups. */
  inferenceProfile: PersistedInferenceProfileSchema.optional(),
  budget: RunBudgetSchema,
  maxReformulations: z.number().int().min(0).max(2),
  audio: ProductionAudioSchema,
  snapshotFence: RunSnapshotFenceSchema,
  preparedActorFences: z.array(PreparedActorFenceSchema).max(1_000),
  participantAvailability: z.array(ParticipantAvailabilitySchema).max(100),
}).superRefine((ready, context) => {
  if (ready.runId !== ready.worldSnapshot.runId
    || ready.snapshotFence.runId !== ready.runId
    || ready.snapshotFence.revision !== ready.worldSnapshot.revision
    || ready.snapshotFence.seq !== ready.worldSnapshot.seq
    || ready.snapshotFence.fictionalAt !== ready.fictionalAt
    || ready.worldSnapshot.clock.instant !== ready.fictionalAt) {
    context.addIssue({ code: 'custom', path: ['snapshotFence'], message: 'La puesta no coincide con la frontera durable del Escenario' });
  }
});
/** A complete, validated setup. It does not approve execution or prove host/provider readiness. */
export type ReadyRunConfiguration = z.infer<typeof ReadyRunConfigurationSchema>;

const ValidationIssueSchema = ProductionValidationIssueSchema;
export type RunConfigurationValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const RunConfigurationValidationResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ready'), configuration: ReadyRunConfigurationSchema }),
  z.strictObject({ kind: z.literal('incomplete'), runId: RunIdSchema, issues: z.array(ValidationIssueSchema).min(1) }),
  z.strictObject({ kind: z.literal('invalid'), runId: RunIdSchema.nullable(), issues: z.array(ValidationIssueSchema).min(1) }),
]);
export type RunConfigurationValidationResult = z.infer<typeof RunConfigurationValidationResultSchema>;

type DraftField<T> =
  | { kind: 'empty' }
  | { kind: 'proposed'; value: T }
  | { kind: 'configured'; value: T };

function addIssue(
  issues: RunConfigurationValidationIssue[],
  input: RunConfigurationValidationIssue,
): void {
  issues.push(ValidationIssueSchema.parse(input));
}

function configuredValue<T>(input: {
  field: DraftField<T>;
  name: string;
  issues: RunConfigurationValidationIssue[];
}): T | undefined {
  switch (input.field.kind) {
    case 'configured':
      return input.field.value;
    case 'empty':
      addIssue(input.issues, {
        code: 'draft-field-empty', field: input.name,
        detail: 'Completa y guarda este campo antes de validar la puesta.',
      });
      return undefined;
    case 'proposed':
      addIssue(input.issues, {
        code: 'proposal-not-confirmed', field: input.name,
        detail: 'La propuesta sigue siendo editorial; edítala o configúrala explícitamente para esta puesta.',
      });
      return undefined;
    default: {
      const _exhaustive: never = input.field;
      return _exhaustive;
    }
  }
}

function asContinuityReference(continuity: ContinuityContext) {
  return ContinuityReferenceSchema.parse({
    continuityId: continuity.continuityId,
    revision: continuity.revision,
    contentHash: continuity.contentHash,
  });
}

function routineAvailable(actor: WorldCharacter, world: WorldSnapshot): boolean {
  return actor.availability.kind === 'available' && routineIsAvailable({ routine: actor.routine, clock: world.clock });
}

function preparedCapabilityKinds(prepared: PreparedCharacter): ReadonlySet<string> {
  return new Set(prepared.capabilities.value.map((capability) => capability.kind));
}

function preparedCanSpeak(prepared: PreparedCharacter | undefined): boolean {
  return prepared !== undefined && preparedCapabilityKinds(prepared).has('speech');
}

function validateCapabilities(input: {
  prepared: PreparedCharacter;
  actor: WorldCharacter;
  issues: RunConfigurationValidationIssue[];
}): void {
  const prepared = preparedCapabilityKinds(input.prepared);
  const actorCapabilities = new Set(input.actor.capabilities);
  const matchingPairs = z.array(z.tuple([
    z.enum(['speech', 'movement', 'gesture', 'nonverbal-sound', 'operate-device']),
    z.enum(['speak', 'move', 'gesture', 'animalSound', 'useDevice']),
  ])).parse([
    ['speech', 'speak'],
    ['movement', 'move'],
    ['gesture', 'gesture'],
    ['nonverbal-sound', 'animalSound'],
    ['operate-device', 'useDevice'],
  ]);
  for (const [preparedKind, worldKind] of matchingPairs) {
    if (prepared.has(preparedKind) !== actorCapabilities.has(worldKind)) {
      addIssue(input.issues, {
        code: 'prepared-capability-mismatch',
        field: `roster.preparedCharacters.${input.prepared.characterId}.capabilities`,
        detail: `La capacidad de preparación ${preparedKind} y la capacidad operativa ${worldKind} no coinciden.`,
      });
    }
  }
  if (input.prepared.voice.value.kind === 'nonverbal' && actorCapabilities.has('speak')) {
    addIssue(input.issues, {
      code: 'nonverbal-actor-has-speech',
      field: `worldSnapshot.entities.${input.prepared.characterId}.capabilities`,
      detail: 'Una identidad preparada como no verbal no puede tener capacidad de habla humana en el Escenario.',
    });
  }
}

function validateAudioConfiguration(input: {
  audio: ProductionAudio;
  roster: ProductionRoster;
  variety: SpanishVarietyForActing;
  narrationMode: NarrationMode;
  issues: RunConfigurationValidationIssue[];
}): void {
  const preparedById = new Map(input.roster.preparedCharacters.map((character) => [character.characterId, character]));
  const speakerSlots = new Map(input.audio.speakerSlots.map((entry) => [entry.characterId, entry.slot]));
  const active = new Set(input.roster.activeCharacterIds);

  if (input.audio.mode.kind === 'enabled' && input.variety.kind !== 'confirmed') {
    addIssue(input.issues, {
      code: 'audio-requires-confirmed-variety', field: 'spanishVariety',
      detail: 'Voice Design y TTS requieren una variedad española confirmada por operador.',
    });
  }

  for (const entry of input.audio.speakerSlots) {
    const prepared = preparedById.get(entry.characterId);
    if (!active.has(entry.characterId) || !preparedCanSpeak(prepared)) {
      addIssue(input.issues, {
        code: 'speaker-slot-mismatch', field: `audio.speakerSlots.${entry.characterId}`,
        detail: 'El slot de voz debe pertenecer a un actor activo cuya ficha preparada declara capacidad de habla.',
      });
    }
    if (entry.slot.kind === 'enabled-bound' && input.audio.mode.kind === 'enabled'
      && input.variety.kind === 'confirmed' && entry.slot.speechBindingId.length === 0) {
      addIssue(input.issues, {
        code: 'voice-binding-invalid', field: `audio.speakerSlots.${entry.characterId}`,
        detail: 'El binding de voz debe identificar una validación persistida.',
      });
    }
  }

  for (const entry of input.audio.soundEffectSlots) {
    const prepared = preparedById.get(entry.characterId);
    if (!active.has(entry.characterId) || prepared?.voice.value.kind !== 'nonverbal') {
      addIssue(input.issues,{code:'speaker-slot-mismatch',field:`audio.soundEffectSlots.${entry.characterId}`,detail:'Cada slot de efecto no verbal debe pertenecer a un personaje activo cuya ficha declara voz no verbal.'});
    }
  }
  if (input.audio.mode.kind === 'enabled' && input.narrationMode.kind !== 'enabled' && (input.audio.narratorSlot.kind === 'enabled-bound' || input.audio.narratorSlot.kind === 'enabled-unbound')) {
    addIssue(input.issues,{code:'speaker-slot-mismatch',field:'audio.narratorSlot',detail:'El slot del narrador requiere narración habilitada cuando el audio está activado.'});
  }

  if (input.audio.mode.kind === 'enabled') {
    for (const characterId of input.roster.activeCharacterIds) {
      const prepared = preparedById.get(characterId);
      if (preparedCanSpeak(prepared) && !speakerSlots.has(characterId)) {
        addIssue(input.issues, {
          code: 'speaker-slot-mismatch', field: `audio.speakerSlots.${characterId}`,
          detail: 'Cada actor activo con voz hablada requiere un slot explícito, incluso si se desactiva para esta puesta.',
        });
      }
    }
  }
}

/**
 * Constructive promotion: it accepts only a fully typed draft, a real
 * WorldSnapshot parse, and full PreparedCharacter records tied to that cut.
 * It never asks an LLM to fill a missing field or infer a continuity fact.
 */
export function validateRunConfiguration(input: unknown): RunConfigurationValidationResult {
  const requestSchema = z.strictObject({ draft: z.unknown() });
  const request = requestSchema.safeParse(input);
  if (!request.success) {
    return RunConfigurationValidationResultSchema.parse({
      kind: 'invalid', runId: null,
      issues: [{ code: 'draft-schema-invalid', field: 'draft', detail: 'La solicitud de validación no tiene la forma esperada.' }],
    });
  }

  const draftResult = RunConfigurationDraftSchema.safeParse(request.data.draft);
  if (!draftResult.success) {
    const issues = draftResult.error.issues.map((issue) => ValidationIssueSchema.parse({
      code: 'draft-schema-invalid',
      field: issue.path.map(String).join('.') || 'draft',
      detail: issue.message.slice(0, 2_000),
    }));
    return RunConfigurationValidationResultSchema.parse({
      kind: 'invalid', runId: null, issues: issues.length > 0 ? issues : [{
        code: 'draft-schema-invalid', field: 'draft', detail: 'El borrador no cumple el schema versionado.',
      }],
    });
  }

  const draft = draftResult.data;
  const issues: RunConfigurationValidationIssue[] = [];
  const name = configuredValue({ field: draft.name, name: 'name', issues });
  const fictionalAt = configuredValue({ field: draft.fictionalAt, name: 'fictionalAt', issues });
  const continuity = configuredValue({ field: draft.continuity, name: 'continuity', issues });
  const roster = configuredValue({ field: draft.roster, name: 'roster', issues });
  const humanParticipants = configuredValue({ field: draft.humanParticipants, name: 'humanParticipants', issues });
  const rawWorld = configuredValue({ field: draft.worldSnapshot, name: 'worldSnapshot', issues });
  const dramaticLine = configuredValue({ field: draft.dramaticLine, name: 'dramaticLine', issues });
  if (draft.dramaticReferences?.kind === 'proposed') {
    addIssue(issues, {
      code: 'proposal-not-confirmed', field: 'dramaticReferences',
      detail: 'Las referencias dramáticas propuestas requieren confirmación o edición; no son una plantilla obligatoria.',
    });
  }
  const dramaticReferences = draft.dramaticReferences?.kind === 'configured'
    ? draft.dramaticReferences.value
    : draft.dramaticReferences?.kind === 'empty' ? [] : undefined;
  const circadianPolicy = configuredValue({ field: draft.circadianPolicy, name: 'circadianPolicy', issues });
  const spanishVariety = configuredValue({ field: draft.spanishVariety, name: 'spanishVariety', issues });
  const narrationMode = configuredValue({ field: draft.narrationMode, name: 'narrationMode', issues });
  const inferenceProfile = configuredValue({
    field: draft.inferenceProfile ?? { kind: 'empty' }, name: 'inferenceProfile', issues,
  });
  const budget = configuredValue({ field: draft.budget, name: 'budget', issues });
  const maxReformulations = configuredValue({ field: draft.maxReformulations, name: 'maxReformulations', issues });
  const audio = configuredValue({ field: draft.audio, name: 'audio', issues });

  if (inferenceProfile?.model === 'gpt-6-luna') {
    addIssue(issues, {
      code: 'legacy-inference-profile', field: 'inferenceProfile',
      detail: 'Luna 6 xhigh sólo se conserva para leer representaciones históricas; elegí Sol 6.1 low o Claude Opus 5.5 medium para una nueva puesta.',
    });
    return RunConfigurationValidationResultSchema.parse({ kind: 'invalid', runId: draft.runId, issues });
  }

  if (issues.length > 0) {
    return RunConfigurationValidationResultSchema.parse({ kind: 'incomplete', runId: draft.runId, issues });
  }
  if (name === undefined || fictionalAt === undefined || continuity === undefined || roster === undefined || humanParticipants === undefined
    || rawWorld === undefined || dramaticLine === undefined || circadianPolicy === undefined
    || spanishVariety === undefined || narrationMode === undefined || inferenceProfile === undefined || budget === undefined
    || maxReformulations === undefined || audio === undefined) {
    return RunConfigurationValidationResultSchema.parse({
      kind: 'invalid', runId: draft.runId,
      issues: [{ code: 'draft-schema-invalid', field: 'draft', detail: 'Un campo configurado no pudo ser leído.' }],
    });
  }

  const worldResult = WorldSnapshotSchema.safeParse(rawWorld);
  if (!worldResult.success) {
    const worldIssues = worldResult.error.issues.map((issue) => ValidationIssueSchema.parse({
      code: 'invalid-world-snapshot',
      field: ['worldSnapshot', ...issue.path.map(String)].join('.'),
      detail: issue.message.slice(0, 2_000),
    }));
    return RunConfigurationValidationResultSchema.parse({ kind: 'invalid', runId: draft.runId, issues: worldIssues });
  }
  const world = worldResult.data;
  validateReadyCandidate({ runId: draft.runId, world, fictionalAt, continuity, roster, humanParticipants, audio, dramaticLine, spanishVariety, narrationMode, budget, issues });
  if (issues.length > 0) {
    return RunConfigurationValidationResultSchema.parse({ kind: 'invalid', runId: draft.runId, issues });
  }

  const ready = ReadyRunConfigurationSchema.safeParse({
    kind: 'ready-run-configuration',
    schemaVersion: 1,
    runId: draft.runId,
    configRevision: draft.revision,
    name,
    fictionalAt,
    continuity,
    roster,
    humanParticipants,
    worldSnapshot: world,
    dramaticLine,
    ...(dramaticReferences === undefined ? {} : { dramaticReferences }),
    circadianPolicy,
    language: 'es',
    spanishVariety,
    narrationMode,
    inferenceProfile,
    budget,
    maxReformulations,
    audio,
    snapshotFence: {
      runId: world.runId,
      revision: world.revision,
      seq: world.seq,
      fictionalAt: world.clock.instant,
    },
    preparedActorFences: roster.preparedCharacters.map((prepared) => ({
      characterId: prepared.characterId,
      identityVersion: prepared.identityVersion,
      dossierRevision: prepared.dossierRevision,
      dossierHash: prepared.dossierHash,
      continuity: asContinuityReference(prepared.continuity),
    })),
    participantAvailability: buildParticipantAvailability(world),
  });
  if (!ready.success) {
    const readyIssues = ready.error.issues.map((issue) => ValidationIssueSchema.parse({
      code: 'draft-schema-invalid', field: issue.path.map(String).join('.') || 'ready',
      detail: issue.message.slice(0, 2_000),
    }));
    return RunConfigurationValidationResultSchema.parse({ kind: 'invalid', runId: draft.runId, issues: readyIssues });
  }
  return RunConfigurationValidationResultSchema.parse({ kind: 'ready', configuration: ready.data });
}

/** Resolve a session mode only against a validated, durable run configuration. */
export function resolveConfiguredSessionMode(input: {
  candidate: unknown;
  readWorldConfiguration: (request: { runId: unknown }) => unknown;
}): z.infer<typeof SessionModeSchema> | null {
  const mode = SessionModeSchema.safeParse(input.candidate);
  if (!mode.success) return null;
  const resolvedMode = mode.data;
  if (resolvedMode.kind === 'observer') return resolvedMode;

  const storedConfiguration = input.readWorldConfiguration({ runId: resolvedMode.runId });
  const configuration = ReadyRunConfigurationSchema.safeParse(storedConfiguration);
  if (!configuration.success || configuration.data.runId!==resolvedMode.runId || validateReadyConfiguration(configuration.data).length > 0) return null;

  if (resolvedMode.kind === 'interlocutor') {
    const participantId = resolvedMode.participantId;
    return configuration.data.runId === resolvedMode.runId
      && configuration.data.humanParticipants.some((profile) => profile.identity.participantId === participantId)
      ? resolvedMode
      : null;
  }

  if (resolvedMode.scope.kind === 'run') return resolvedMode;
  const sceneId = resolvedMode.scope.sceneId;
  return configuration.data.runId === resolvedMode.runId
    && configuration.data.worldSnapshot.scenes.some((scene) => scene.id === sceneId)
    ? resolvedMode
    : null;
}

function validateReadyCandidate(input: {
  runId: z.infer<typeof RunIdSchema>;
  world: WorldSnapshot;
  fictionalAt: number;
  continuity: ContinuityContext;
  roster: ProductionRoster;
  humanParticipants: HumanParticipantProfiles;
  audio: ProductionAudio;
  narrationMode: NarrationMode;
  dramaticLine: DramaticLine;
  spanishVariety: SpanishVarietyForActing;
  budget: RunBudget;
  issues: RunConfigurationValidationIssue[];
  continuation?: true;
}): void {
  const { world, continuity, roster, humanParticipants, audio, spanishVariety, narrationMode, issues } = input;
  const add = (code: RunConfigurationValidationIssue['code'], field: string, detail: string) => addIssue(issues, { code, field, detail });

  if (world.runId !== input.runId) add('world-run-mismatch', 'worldSnapshot.runId', 'El snapshot debe pertenecer a la corrida que se está preparando.');
  if (world.clock.instant !== input.fictionalAt) add('fictional-time-mismatch', 'fictionalAt', 'El momento de ficción debe coincidir con el reloj del snapshot; una fecha de emisión o del equipo no lo sustituye.');
  const calendarDiagnostics = [
    ...dayNightCalendarDiagnostics({ clock: world.clock }),
    ...world.entities.flatMap(actor => actor.kind === 'character' ? routineCalendarDiagnostics({ routine: actor.routine, clock: world.clock }) : []),
  ];
  for (const detail of new Set(calendarDiagnostics.filter(diagnostic => diagnostic.startsWith('Zona horaria') || diagnostic.includes('fuera del dominio'))))
    add('draft-schema-invalid', 'worldSnapshot.clock', detail);
  if (world.places.length === 0) add('place-missing', 'worldSnapshot.places', 'La puesta requiere al menos un lugar operativo.');
  if (roster.eligibleCharacterIds.length === 0 || roster.preparedCharacters.length === 0 || roster.activeCharacterIds.length === 0) {
    add('roster-empty', 'roster', 'La puesta requiere identidades elegibles, contexto preparado y al menos un actor activo.');
  }

  const eligibleIds = new Set(roster.eligibleCharacterIds);
  const preparedById = new Map(roster.preparedCharacters.map((character) => [character.characterId, character]));
  const activeIds = new Set(roster.activeCharacterIds);
  for (const prepared of roster.preparedCharacters) {
    if (!eligibleIds.has(prepared.characterId)) add('actor-not-eligible', `roster.preparedCharacters.${prepared.characterId}`, 'Todo contexto preparado debe corresponder a una identidad elegible en esta puesta.');
    if (!isDeepStrictEqual(prepared.continuity, continuity)) add('continuity-mismatch', `roster.preparedCharacters.${prepared.characterId}.continuity`, 'El contexto preparado usa otro corte o revisión de continuidad.');
  }
  for (const characterId of activeIds) {
    if (!eligibleIds.has(characterId)) add('actor-not-eligible', `roster.activeCharacterIds.${characterId}`, 'Un actor activo debe ser elegible en el catálogo para esta puesta.');
    if (!preparedById.has(characterId)) add('actor-not-prepared', `roster.activeCharacterIds.${characterId}`, 'Un actor activo necesita un PreparedCharacter completo.');
  }

  const scene = world.scenes.find((candidate) => candidate.id === world.activeSceneId);
  if ((scene === undefined || scene.lifecycle.kind !== 'open')
    && !(input.continuation && world.activeSceneId===null && world.scenes.every(item=>item.lifecycle.kind==='closed'))) {
    add('scene-not-open', 'worldSnapshot.activeSceneId', 'La puesta requiere escena abierta o una continuación derivada entre escenas cerradas.');
  }
  validateHumanParticipants({ profiles: humanParticipants, world, issues, ...(input.continuation?{allowHistoricalScene:true as const}:{}) });
  if (scene!==undefined && scene.participantIds.length === 0) add('scene-has-no-participant', 'worldSnapshot.scenes.active.participantIds', 'La escena inicial necesita al menos un participante; no se añade interlocutor automáticamente.');
  const worldActors = new Map<string, WorldCharacter>();
  for (const entity of world.entities) {
    if (entity.kind === 'character') worldActors.set(entity.characterId, entity);
  }
  for (const characterId of roster.activeCharacterIds) {
    const actor = worldActors.get(characterId);
    const prepared = preparedById.get(characterId);
    if (actor === undefined) {
      add('active-actor-missing-from-world', `worldSnapshot.entities.${characterId}`, 'Todo actor activo debe tener identidad en el snapshot operativo.');
      continue;
    }
    if (prepared === undefined) continue;
    const expectedContinuity = asContinuityReference(prepared.continuity);
    if (actor.preparation.kind !== 'prepared'
      || actor.preparation.continuityId !== expectedContinuity.continuityId
      || actor.preparation.identityVersion !== prepared.identityVersion
      || !isDeepStrictEqual(prepared.continuity, continuity)) {
      add('actor-preparation-mismatch', `worldSnapshot.entities.${characterId}.preparation`, 'El actor del snapshot no lleva la marca de preparación e identidad de este contexto validado.');
    }
    validateCapabilities({ prepared, actor, issues });
  }
  for (const characterId of scene?.participantIds??[]) {
    if (!activeIds.has(characterId)) add('participant-not-active', `worldSnapshot.scenes.${scene?.id}.participantIds.${characterId}`, 'Cada participante inicial debe estar incluido en el reparto activo de esta corrida.');
    const actor = worldActors.get(characterId);
    if (scene===undefined || actor === undefined || actor.presence.kind !== 'present' || actor.presence.sceneId !== scene.id || !scene.placeIds.includes(actor.placeId)) {
      add('participant-not-present', `worldSnapshot.scenes.${scene?.id}.participantIds.${characterId}`, 'El participante debe estar presente en la escena inicial y en uno de sus lugares.');
    }
  }

  const scenePlaceIds = new Set(input.continuation?world.places.map(place=>place.id):scene?.placeIds??[]);
  if (scene!==undefined && (scene.placeIds.length===0 || scene.placeIds.some((placeId) => !world.places.some((place) => place.id === placeId)))) {
    add('place-missing', `worldSnapshot.scenes.${scene.id}.placeIds`, 'La escena debe referir lugares operativos del mapa.');
  }
  const channelIds = new Set(world.channels.map((channel) => channel.id));
  if (world.perceptualPaths.some((path) => path.kind === 'auditory' && !channelIds.has(path.channelId))) {
    add('channel-declaration-invalid', 'worldSnapshot.perceptualPaths', 'Cada percepción auditiva debe referir un canal declarado.');
  }
  if (world.inventory.some((entry) => entry.location.kind === 'atPlace' && !scenePlaceIds.has(entry.location.placeId))) {
    add('place-missing', 'worldSnapshot.inventory', 'Los objetos iniciales de escena deben estar en lugares existentes del mapa.');
  }
  if (spanishVariety.kind !== 'confirmed' && audio.mode.kind === 'enabled') {
    add('audio-requires-confirmed-variety', 'spanishVariety', 'El audio habilitado requiere una variedad regional confirmada antes de síntesis.');
  }
  if (roster.activeCharacterIds.length > 0 && spanishVariety.label.trim().length === 0) {
    add('variety-required', 'spanishVariety', 'La actuación textual requiere una variedad española declarada, aunque siga siendo propuesta.');
  }
  validateAudioConfiguration({ audio, roster, variety: spanishVariety, narrationMode, issues });
}

function validateHumanParticipants(input: {
  allowHistoricalScene?: true;
  profiles: HumanParticipantProfiles;
  world: WorldSnapshot;
  issues: RunConfigurationValidationIssue[];
}): void {
  for (const profile of input.profiles) {
    const field = `humanParticipants.${profile.identity.participantId}`;
    const place = input.world.places.find((candidate) => candidate.id === profile.presence.placeId);
    if (place === undefined) {
      addIssue(input.issues, {
        code: 'human-participant-invalid', field: `${field}.presence.placeId`,
        detail: 'El lugar de la identidad humana debe existir en el Escenario de esta corrida.',
      });
      continue;
    }
    if (profile.presence.position.x < 0 || profile.presence.position.y < 0
      || profile.presence.position.x > place.width || profile.presence.position.y > place.height) {
      addIssue(input.issues, {
        code: 'human-participant-invalid', field: `${field}.presence.position`,
        detail: 'La posición de la identidad humana debe quedar dentro del lugar configurado.',
      });
    }
    const channel = input.world.channels.find((candidate) => candidate.id === profile.presence.channelId);
    if (channel?.kind !== 'speech' || !channel.enabled || !channel.placeIds.includes(place.id)) {
      addIssue(input.issues, {
        code: 'human-participant-invalid', field: `${field}.presence.channelId`,
        detail: 'La identidad humana requiere un canal de habla habilitado en su lugar.',
      });
    }
    if (profile.presence.kind === 'inScene') {
      const presence = profile.presence;
      const sceneId = presence.sceneId;
      const scene = input.world.scenes.find((candidate) => candidate.id === sceneId);
      if (scene === undefined || (!input.allowHistoricalScene && (scene.id !== input.world.activeSceneId || scene.lifecycle.kind !== 'open'))
        || !scene.placeIds.includes(place.id)) {
        addIssue(input.issues, {
          code: 'human-participant-invalid', field: `${field}.presence.sceneId`,
          detail: 'La presencia en escena debe referir la escena inicial abierta y uno de sus lugares.',
        });
      }
    }
  }
}

/** Rebind only operational world fields to a confirmed journal cut for preflight.
 * Identity, profile and operator configuration remain those of the immutable setup. */
export function readyConfigurationAtSnapshot(configuration: ReadyRunConfiguration, world: WorldSnapshot): ReadyRunConfiguration {
  return ReadyRunConfigurationSchema.parse({...configuration,worldSnapshot:world,fictionalAt:world.clock.instant,
    snapshotFence:{runId:world.runId,revision:world.revision,seq:world.seq,fictionalAt:world.clock.instant},
    participantAvailability:buildParticipantAvailability(world)});
}

export function validateReadyConfiguration(configuration: ReadyRunConfiguration): RunConfigurationValidationIssue[] {
  const issues: RunConfigurationValidationIssue[] = [];
  validateReadyCandidate({
    runId: configuration.runId,
    world: configuration.worldSnapshot,
    fictionalAt: configuration.fictionalAt,
    continuity: configuration.continuity,
    roster: configuration.roster,
    humanParticipants: configuration.humanParticipants,
    audio: configuration.audio,
    narrationMode: configuration.narrationMode,
    dramaticLine: configuration.dramaticLine,
    spanishVariety: configuration.spanishVariety,
    budget: configuration.budget,
    ...(configuration.forkOrigin===undefined?{}:{continuation:true as const}),
    issues,
  });
  const expectedFences = configuration.roster.preparedCharacters.map((prepared) => ({
    characterId: prepared.characterId,
    identityVersion: prepared.identityVersion,
    dossierRevision: prepared.dossierRevision,
    dossierHash: prepared.dossierHash,
    continuity: asContinuityReference(prepared.continuity),
  }));
  if (!isDeepStrictEqual(configuration.preparedActorFences, expectedFences)) {
    addIssue(issues, {
      code: 'actor-context-mismatch', field: 'preparedActorFences',
      detail: 'Las fronteras de ficha e identidad deben derivarse exactamente de los PreparedCharacter incluidos.',
    });
  }
  const expectedAvailability = buildParticipantAvailability(configuration.worldSnapshot);
  if (!isDeepStrictEqual(configuration.participantAvailability, expectedAvailability)) {
    addIssue(issues, {
      code: 'draft-schema-invalid', field: 'participantAvailability',
      detail: 'La disponibilidad inicial debe derivarse de la rutina y el estado del Escenario al instante ficticio exacto.',
    });
  }
  return issues;
}

export function buildParticipantAvailability(world: WorldSnapshot): ParticipantAvailability[] {
  const scene = world.scenes.find((candidate) => candidate.id === world.activeSceneId);
  if (scene === undefined) return [];
  return scene.participantIds.map((characterId) => {
    const actor = world.entities.find((entity) => entity.kind === 'character' && entity.characterId === characterId);
    if (actor?.kind !== 'character') {
      return ParticipantAvailabilitySchema.parse({ kind: 'unavailable', characterId, reason: 'explicit' });
    }
    if (actor.availability.kind === 'unavailable') {
      return ParticipantAvailabilitySchema.parse({ kind: 'unavailable', characterId, reason: 'explicit' });
    }
    if (!routineAvailable(actor, world)) {
      return ParticipantAvailabilitySchema.parse({ kind: 'unavailable', characterId, reason: 'routine' });
    }
    return ParticipantAvailabilitySchema.parse({ kind: 'available', characterId });
  });
}

const ObservedInferenceProfileSchema = z.strictObject({
  provider: z.string().min(1).max(120),
  api: z.string().min(1).max(120),
  model: z.string().min(1).max(120),
  reasoningEffort: z.string().min(1).max(40),
  fallback: z.string().min(1).max(40),
  fingerprint: HashSchema,
});
type ObservedInferenceProfile = z.infer<typeof ObservedInferenceProfileSchema>;

const PiSdkStatusSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ready'),
    piCodingAgentVersion: z.string().min(1).max(40),
    piAiVersion: z.string().min(1).max(40),
    sessionFactoryAvailable: z.literal(true),
  }),
  z.strictObject({ kind: z.literal('unavailable'), code: z.string().min(1).max(100) }),
]);

const PiProfileStatusSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('configured'), profile: ObservedInferenceProfileSchema }),
  z.strictObject({ kind: z.literal('missing'), code: z.string().min(1).max(100) }),
]);

const OpenAICodexAuthenticationStatusSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('authenticated'), provider: z.literal('openai-codex'), method: z.enum(['oauth', 'api_key']), accountFingerprint: HashSchema }),
  z.strictObject({ kind: z.literal('disconnected'), provider: z.literal('openai-codex') }),
  z.strictObject({ kind: z.literal('expired'), provider: z.literal('openai-codex') }),
  z.strictObject({ kind: z.literal('unavailable'), provider: z.literal('openai-codex'), code: z.string().min(1).max(100) }),
]);
const AnthropicAuthenticationStatusSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('authenticated'), provider: z.literal('anthropic'), method: z.enum(['oauth', 'api_key']), accountFingerprint: HashSchema }),
  z.strictObject({ kind: z.literal('disconnected'), provider: z.literal('anthropic') }),
  z.strictObject({ kind: z.literal('expired'), provider: z.literal('anthropic') }),
  z.strictObject({ kind: z.literal('unavailable'), provider: z.literal('anthropic'), code: z.string().min(1).max(100) }),
]);
const InferenceAuthenticationStatusSchema = z.discriminatedUnion('provider', [
  OpenAICodexAuthenticationStatusSchema,
  AnthropicAuthenticationStatusSchema,
]);

const PiAccessCheckSchema = z.union([
  z.strictObject({
    kind: z.literal('passed'),
    provider: z.enum(['openai-codex', 'anthropic']),
    accountFingerprint: HashSchema,
    profileFingerprint: HashSchema,
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
  }),
  z.strictObject({
    kind: z.literal('failed'),
    provider: z.enum(['openai-codex', 'anthropic']),
    accountFingerprint: HashSchema,
    profileFingerprint: HashSchema,
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    code: z.string().min(1).max(100),
  }),
  z.strictObject({ kind: z.literal('missing'), provider: z.enum(['openai-codex', 'anthropic']) }),
  z.strictObject({ kind: z.literal('unavailable'), provider: z.enum(['openai-codex', 'anthropic']), code: z.string().min(1).max(100) }),
]);

const PiIdentityReadinessSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('actor'),
    characterId: CharacterIdSchema,
    state: z.enum(['ready-to-create', 'ready-to-reopen']),
    effectiveProfile: ObservedInferenceProfileSchema,
    tools: z.array(z.string().min(1).max(120)).max(50),
  }),
  z.strictObject({
    kind: z.literal('admin'),
    roles: z.array(z.enum(['continuista', 'director', 'regidor', 'configurador', 'coordinador', 'narrador'])).min(1).max(6),
    state: z.enum(['ready-to-create', 'ready-to-reopen']),
    effectiveProfile: ObservedInferenceProfileSchema,
    tools: z.array(z.string().min(1).max(120)).max(50),
  }),
]);

const AdminRoleSchema = z.enum(['continuista', 'director', 'regidor', 'configurador', 'coordinador', 'narrador']);

const PiRuntimeStatusSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ready'),
    requiredAdminRoles: z.array(AdminRoleSchema).max(6),
    identities: z.array(PiIdentityReadinessSchema).max(1_100),
  }).superRefine((runtime, context) => {
    const required = new Set(runtime.requiredAdminRoles);
    if (required.size !== runtime.requiredAdminRoles.length) {
      context.addIssue({ code: 'custom', path: ['requiredAdminRoles'], message: 'Los roles LLM requeridos no deben duplicarse.' });
    }
    for (const [index, identity] of runtime.identities.entries()) {
      if (identity.kind === 'admin' && new Set(identity.roles).size !== identity.roles.length) {
        context.addIssue({ code: 'custom', path: ['identities', index, 'roles'], message: 'La composición administrativa no debe repetir roles.' });
      }
    }
  }),
  z.strictObject({ kind: z.literal('unavailable'), code: z.string().min(1).max(100) }),
]);

const CatalogEligibilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('loaded'),
    entries: z.array(z.strictObject({
      characterId: CharacterIdSchema,
      state: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('eligible') }),
        z.strictObject({ kind: z.literal('ineligible'), reason: z.string().min(1).max(500) }),
      ]),
    })).max(1_000),
  }),
  z.strictObject({ kind: z.literal('unavailable'), code: z.string().min(1).max(100) }),
]);

const PreparedContextCollectionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('loaded'),
    runId: RunIdSchema,
    actors: z.array(PreparedCharacterSchema).max(1_000),
  }),
  z.strictObject({ kind: z.literal('unavailable'), code: z.string().min(1).max(100) }),
]);

const CurrentConfigurationRevisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('loaded'), revision: RevisionSchema }),
  z.strictObject({ kind: z.literal('unavailable'), code: z.string().min(1).max(100) }),
]);

const IcmReadinessSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ready'),
    version: z.literal('0.11.4'),
    backend: z.literal('sqlite'),
    actors: z.array(z.strictObject({
      runId: RunIdSchema,
      characterId: CharacterIdSchema,
      state: z.literal('recoverable'),
      isolation: z.strictObject({
        kind: z.literal('run-actor'),
        runId: RunIdSchema,
        characterId: CharacterIdSchema,
      }),
    })).max(1_000),
  }),
  z.strictObject({ kind: z.literal('unavailable'), code: z.string().min(1).max(100) }),
]);

const BudgetReadinessSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('available'),
    runCallsUsed: nonNegativeInteger,
    pulseCallsUsed: nonNegativeInteger,
    activePiRequests: nonNegativeInteger,
    wallTimeUsedMs: nonNegativeInteger,
  }),
  z.strictObject({ kind: z.literal('unavailable'), code: z.string().min(1).max(100) }),
]);

const VoiceOwnerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('character'), characterId: CharacterIdSchema }),
  z.strictObject({ kind: z.literal('narrator') }),
]);

const VoiceReadinessBindingSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('speech'),
    owner: VoiceOwnerSchema,
    speechBindingId: SpeechBindingIdSchema,
    provider: z.literal('elevenlabs'),
    language: z.literal('es'),
    ttsModelId: z.string().min(1).max(200),
    varietyLabel: z.string().min(1).max(300),
    validationEvidenceId: z.string().uuid(),
  }),
  z.strictObject({
    kind: z.literal('sound-effect'),
    owner: z.strictObject({ kind: z.literal('character'), characterId: CharacterIdSchema }),
    soundBindingId: SoundBindingIdSchema,
    provider: z.literal('elevenlabs'),
    assetState: z.literal('ready'),
  }),
]);

export const VoiceReadinessSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ready'),
    credential: z.enum(['present', 'missing']),
    effectiveConfig: VoiceConfigSchema.optional(),
    bindings: z.array(VoiceReadinessBindingSchema).max(1_000),
  }),
  z.strictObject({ kind: z.literal('unavailable'), code: z.string().min(1).max(100) }),
]);

export { PreflightReportSchema } from '../domain/preflight-report.ts';
export type { PreflightCheck, PreflightReport } from '../domain/preflight-report.ts';

export type ProductionPreflightHostPort = {
  /** Current durable config_versions revision; read-only, with no migration or write. */
  readCurrentConfigurationRevision(input: { runId: z.infer<typeof RunIdSchema> }): Promise<unknown>;
  /** Returns the currently committed snapshot from the host journal; no projection or mutation. */
  loadCurrentWorldSnapshot(input: { runId: z.infer<typeof RunIdSchema> }): Promise<unknown>;
  /** Reopens full persisted PreparedCharacter objects, never hash-only receipts. */
  loadPreparedActorContexts(input: {
    runId: z.infer<typeof RunIdSchema>;
    characterIds: readonly z.infer<typeof CharacterIdSchema>[];
  }): Promise<unknown>;
  readCatalogEligibility(input: { characterIds: readonly z.infer<typeof CharacterIdSchema>[] }): Promise<unknown>;
  readPiSdkStatus(): Promise<unknown>;
  readPiModelProfile(input: { provider: InferenceProvider }): Promise<unknown>;
  readInferenceAuthenticationStatus(input: { provider: InferenceProvider }): Promise<unknown>;
  readInferenceAccessCheckReceipt(input: {
    provider: InferenceProvider;
    accountFingerprint: z.infer<typeof HashSchema>;
    profileFingerprint: z.infer<typeof HashSchema>;
  }): Promise<unknown>;
  /** Reports configured session/tool state only; it must not call Pi or create a session. */
  readPiRuntimeReadiness(input: {
    runId: z.infer<typeof RunIdSchema>;
    activeCharacterIds: readonly z.infer<typeof CharacterIdSchema>[];
    narrationMode: NarrationMode;
  }): Promise<unknown>;
  readIcmMemoryReadiness(input: {
    runId: z.infer<typeof RunIdSchema>;
    actorIds: readonly z.infer<typeof CharacterIdSchema>[];
  }): Promise<unknown>;
  readRunBudgetReadiness(input: {
    runId: z.infer<typeof RunIdSchema>;
    budget: RunBudget;
  }): Promise<unknown>;
  /** Reads effective presentation settings even when the frozen Ready audio was disabled. Never submits generation requests. */
  readVoiceReadiness(input: {
    runId: z.infer<typeof RunIdSchema>;
    configRevision: z.infer<typeof RevisionSchema>;
  }): Promise<unknown>;
};

export type ProductionPreflightPort = {
  preflight(input: unknown): Promise<PreflightReport>;
};

type PortRead<T> =
  | { kind: 'loaded'; value: T }
  | { kind: 'unavailable'; code: 'host-read-failed' | 'host-state-invalid' };

async function readPort<TSchema extends z.ZodType>(input: {
  read: () => Promise<unknown>;
  schema: TSchema;
}): Promise<PortRead<z.infer<TSchema>>> {
  try {
    const parsed = input.schema.safeParse(await input.read());
    return parsed.success
      ? { kind: 'loaded', value: parsed.data }
      : { kind: 'unavailable', code: 'host-state-invalid' };
  } catch {
    return { kind: 'unavailable', code: 'host-read-failed' };
  }
}

function profileMatches(profile: ObservedInferenceProfile, expected: SelectableInferenceProfile): boolean {
  return profile.provider === expected.provider
    && profile.api === expected.api
    && profile.model === expected.model
    && profile.reasoningEffort === expected.reasoningEffort
    && profile.fallback === expected.fallback;
}

function check(input: PreflightCheck): PreflightCheck {
  return PreflightCheckSchema.parse(input);
}

function addPortFailure(checks: PreflightCheck[], checkId: string, result: PortRead<unknown>): void {
  if (result.kind === 'unavailable') {
    checks.push(check({
      kind: 'unavailable', checkId, code: result.code,
      detail: 'El host no pudo verificar este estado registrado.',
    }));
  }
}

function validateEligibility(input: {
  expectedIds: readonly z.infer<typeof CharacterIdSchema>[];
  result: z.infer<typeof CatalogEligibilitySchema>;
  checks: PreflightCheck[];
}): void {
  if (input.result.kind === 'unavailable') {
    input.checks.push(check({ kind: 'unavailable', checkId: 'catalog-eligibility', code: input.result.code, detail: 'No se pudo leer la elegibilidad vigente del catálogo.' }));
    return;
  }
  const actual = new Map(input.result.entries.map((entry) => [entry.characterId, entry.state]));
  const entriesExact = input.expectedIds.length === actual.size
    && input.expectedIds.every((id) => actual.has(id));
  if (!entriesExact) {
    input.checks.push(check({ kind: 'blocked', checkId: 'catalog-eligibility', code: 'eligibility-snapshot-mismatch', detail: 'La selección elegible no coincide con el estado actual del catálogo.' }));
    return;
  }
  const ineligible = input.expectedIds.filter((id) => actual.get(id)?.kind !== 'eligible');
  if (ineligible.length > 0) {
    input.checks.push(check({ kind: 'blocked', checkId: 'catalog-eligibility', code: 'actor-not-eligible', detail: `Hay ${ineligible.length} identidades que dejaron de ser elegibles.` }));
    return;
  }
  input.checks.push(check({ kind: 'passed', checkId: 'catalog-eligibility', detail: `${input.expectedIds.length} identidades elegibles verificadas.` }));
}

function validatePreparedContexts(input: {
  expected: ReadyRunConfiguration;
  result: z.infer<typeof PreparedContextCollectionSchema>;
  checks: PreflightCheck[];
}): void {
  if (input.result.kind === 'unavailable') {
    input.checks.push(check({ kind: 'unavailable', checkId: 'prepared-contexts', code: input.result.code, detail: 'No se pudieron reabrir los contextos completos del host.' }));
    return;
  }
  if (input.result.runId !== input.expected.runId) {
    input.checks.push(check({ kind: 'blocked', checkId: 'prepared-contexts', code: 'context-run-mismatch', detail: 'Los contextos recuperados pertenecen a otra corrida.' }));
    return;
  }
  const expected = new Map(input.expected.roster.preparedCharacters.map((actor) => [actor.characterId, actor]));
  const actual = new Map(input.result.actors.map((actor) => [actor.characterId, actor]));
  const sameIdentitySet = expected.size === actual.size && [...expected.keys()].every((id) => actual.has(id));
  const allContentMatches = sameIdentitySet && [...expected.entries()].every(([id, prepared]) => {
    const persisted = actual.get(id);
    return persisted !== undefined && isDeepStrictEqual(prepared, persisted);
  });
  if (!allContentMatches) {
    input.checks.push(check({ kind: 'blocked', checkId: 'prepared-contexts', code: 'prepared-context-mismatch', detail: 'La ficha preparada persistida difiere del contexto completo validado para la puesta.' }));
    return;
  }
  input.checks.push(check({ kind: 'passed', checkId: 'prepared-contexts', detail: `${expected.size} contextos completos coinciden por contenido, identidad, revisión y continuidad.` }));
}

function validatePiRuntime(input: {
  expected: ReadyRunConfiguration;
  expectedProfile: SelectableInferenceProfile;
  result: z.infer<typeof PiRuntimeStatusSchema>;
  checks: PreflightCheck[];
}): void {
  if (input.result.kind === 'unavailable') {
    input.checks.push(check({ kind: 'unavailable', checkId: 'pi-runtime', code: input.result.code, detail: 'No se pudo comprobar la preparación de sesiones y tools Pi.' }));
    return;
  }
  const actorEntries = input.result.identities.filter((identity) => identity.kind === 'actor');
  const actorMap = new Map<string, Extract<z.infer<typeof PiIdentityReadinessSchema>, { kind: 'actor' }>>();
  for (const identity of actorEntries) {
    if (identity.kind === 'actor') actorMap.set(identity.characterId, identity);
  }
  const actorSetMatches = actorMap.size === input.expected.roster.activeCharacterIds.length
    && actorEntries.length === actorMap.size
    && input.expected.roster.activeCharacterIds.every((id) => actorMap.has(id));
  const actorsReady = actorSetMatches && input.expected.roster.activeCharacterIds.every((id) => {
    const identity = actorMap.get(id);
    if (identity?.kind !== 'actor' || !profileMatches(identity.effectiveProfile, input.expectedProfile)) return false;
    const tools = new Set(identity.tools);
    return tools.size === 2 && tools.has('recall_memory') && tools.has('propose_action');
  });
  const adminProfilesMatch = input.result.identities.every((identity) => profileMatches(identity.effectiveProfile, input.expectedProfile));
  const adminRoles = new Set(input.result.identities.flatMap((identity) => identity.kind === 'admin' ? identity.roles : []));
  const adminRolesReady = input.result.requiredAdminRoles.every((role) => adminRoles.has(role))
    && (input.expected.narrationMode.kind !== 'enabled' || input.result.requiredAdminRoles.includes('narrador'));
  if (!actorsReady || !adminProfilesMatch || !adminRolesReady) {
    input.checks.push(check({ kind: 'blocked', checkId: 'pi-runtime', code: 'pi-runtime-incompatible', detail: 'Falta una sesión activa/preparada con perfil y tools exactos para cada actor requerido.' }));
    return;
  }
  input.checks.push(check({ kind: 'passed', checkId: 'pi-runtime', detail: `${actorMap.size} actores y ${input.result.requiredAdminRoles.length} roles LLM administrativos requeridos tienen el perfil seleccionado y las tools exactas.` }));
}

function validateIcm(input: {
  expected: ReadyRunConfiguration;
  result: z.infer<typeof IcmReadinessSchema>;
  checks: PreflightCheck[];
}): void {
  if (input.result.kind === 'unavailable') {
    input.checks.push(check({ kind: 'unavailable', checkId: 'icm-memory', code: input.result.code, detail: 'No se pudo verificar ICM Memory y sus bases privadas.' }));
    return;
  }
  const expected = new Set(input.expected.roster.activeCharacterIds);
  const found = new Map(input.result.actors.map((entry) => [entry.characterId, entry]));
  const exact = found.size === expected.size && [...expected].every((id) => {
    const entry = found.get(id);
    return entry !== undefined
      && entry.runId === input.expected.runId
      && entry.state === 'recoverable'
      && entry.isolation.runId === input.expected.runId
      && entry.isolation.characterId === id;
  });
  if (!exact) {
    input.checks.push(check({ kind: 'blocked', checkId: 'icm-memory', code: 'memory-scope-invalid', detail: 'Falta una memoria ICM recuperable, SQLite y aislada por corrida/personaje para un actor activo.' }));
    return;
  }
  input.checks.push(check({ kind: 'passed', checkId: 'icm-memory', detail: `ICM ${input.result.version} usa SQLite con ámbito privado por corrida y actor para ${expected.size} actores.` }));
}

function validateBudget(input: {
  expected: ReadyRunConfiguration;
  result: z.infer<typeof BudgetReadinessSchema>;
  checks: PreflightCheck[];
}): void {
  if (input.result.kind === 'unavailable') {
    input.checks.push(check({ kind: 'unavailable', checkId: 'budget', code: input.result.code, detail: 'No se pudo leer el presupuesto y las reservas actuales.' }));
    return;
  }
  const within = input.result.runCallsUsed < input.expected.budget.maxPiCallsPerRun
    && input.result.pulseCallsUsed < input.expected.budget.maxPiCallsPerPulse
    && input.result.activePiRequests < input.expected.budget.maxConcurrentPiRequests
    && input.result.wallTimeUsedMs < input.expected.budget.maxWallTimeMs;
  input.checks.push(within
    ? check({ kind: 'passed', checkId: 'budget', detail: 'Hay presupuesto de requests, concurrencia y tiempo operativo disponible.' })
    : check({ kind: 'blocked', checkId: 'budget', code: 'budget-exhausted', detail: 'Una cuota de corrida/pulso, concurrencia o tiempo operativo ya alcanzó su límite.' }));
}

function validateVoice(input: {
  expected: ReadyRunConfiguration;
  result: z.infer<typeof VoiceReadinessSchema>;
  checks: PreflightCheck[];
}): void {
  if (input.result.kind === 'unavailable') {
    input.checks.push(check({ kind: 'unavailable', checkId: 'voice', code: input.result.code, detail: 'No se pudo leer el estado registrado de credencial, binding y asset de voz.' }));
    return;
  }
  const effective = input.result.effectiveConfig;
  const effectiveAudio = effective === undefined ? undefined : ProductionAudioSchema.safeParse({
    mode:effective.audioMode,
    speakerSlots:Object.entries(effective.speakerSlots).map(([characterId,slot])=>({characterId,slot})),
    narratorSlot:effective.narratorSlot,
    soundEffectSlots:Object.entries(effective.soundEffectSlots).map(([characterId,slot])=>({characterId,slot})),
  });
  if (effectiveAudio !== undefined && !effectiveAudio.success) {
    input.checks.push(check({kind:'blocked',checkId:'voice',code:'voice-binding-invalid',detail:'Las identidades de los slots efectivos no cumplen el contrato del reparto.'})); return;
  }
  const expected = effective === undefined || effectiveAudio === undefined ? input.expected : {
    ...input.expected, spanishVariety: effective.spanishVariety, audio:effectiveAudio.data,
  };
  const audioIssues: RunConfigurationValidationIssue[] = [];
  validateAudioConfiguration({audio:expected.audio, roster:expected.roster,variety:expected.spanishVariety,narrationMode:expected.narrationMode,issues:audioIssues});
  if (audioIssues.length > 0) {
    input.checks.push(check({kind:'blocked',checkId:'voice',code:'voice-binding-invalid',detail:audioIssues[0]?.detail ?? 'Configuración de audio incompatible.'})); return;
  }
  const needsAudio = expected.audio.mode.kind === 'enabled' || expected.audio.soundEffectSlots.some(entry=>entry.slot.kind==='enabled-bound');
  if (!needsAudio) { input.checks.push(check({kind:'passed',checkId:'voice',detail:'El audio efectivo está desactivado y no hay efectos vinculados; no se contacta al proveedor.'})); return; }
  if (input.result.credential !== 'present') {
    input.checks.push(check({ kind: 'blocked', checkId: 'voice', code: 'voice-credential-missing', detail: 'El audio está activado y la credencial de host no está disponible.' }));
    return;
  }
  const expectedSpeech: Array<{ owner: z.infer<typeof VoiceOwnerSchema>; bindingId: string }> = [];
  if (expected.audio.mode.kind === 'enabled') {
    for (const entry of expected.audio.speakerSlots) {
      if (entry.slot.kind === 'enabled-bound') {
        expectedSpeech.push({ owner: { kind: 'character', characterId: entry.characterId }, bindingId: entry.slot.speechBindingId });
      }
    }
    if (expected.narrationMode.kind === 'enabled' && expected.audio.narratorSlot.kind === 'enabled-bound') {
      expectedSpeech.push({ owner: { kind: 'narrator' }, bindingId: expected.audio.narratorSlot.speechBindingId });
    }
  }
  const actualSpeech = input.result.bindings.filter((binding) => binding.kind === 'speech');
  const allSpeechMatch = expectedSpeech.every((selection) => actualSpeech.some((actual) =>
    actual.speechBindingId === selection.bindingId
    && isDeepStrictEqual(actual.owner, selection.owner)
    && actual.language === 'es'
    && actual.ttsModelId === (expected.audio.mode.kind === 'enabled' ? expected.audio.mode.ttsModelId : actual.ttsModelId)
    && expected.spanishVariety.kind === 'confirmed'
    && actual.varietyLabel === expected.spanishVariety.label));
  const expectedEffects = expected.audio.soundEffectSlots.flatMap((entry) => entry.slot.kind === 'enabled-bound'
    ? [{ characterId: entry.characterId, bindingId: entry.slot.soundBindingId }]
    : []);
  const actualEffects = input.result.bindings.filter((binding) => binding.kind === 'sound-effect');
  const allEffectsMatch = expectedEffects.every((expected) => actualEffects.some((actual) =>
    actual.owner.characterId === expected.characterId && actual.soundBindingId === expected.bindingId));
  const pendingSpeakers = expected.audio.mode.kind === 'enabled'
    ? expected.audio.speakerSlots.filter((entry) => entry.slot.kind === 'enabled-unbound')
    : [];
  const pendingNarrator = expected.audio.mode.kind === 'enabled'
    && expected.narrationMode.kind === 'enabled'
    && expected.audio.narratorSlot.kind === 'enabled-unbound';
  if (!allSpeechMatch || !allEffectsMatch) {
    input.checks.push(check({ kind: 'blocked', checkId: 'voice', code: 'voice-binding-invalid', detail: 'Un binding seleccionado no coincide con el registro validado y la variedad española vigente.' }));
    return;
  }
  if (pendingSpeakers.length > 0 || pendingNarrator) {
    const pendingCount = pendingSpeakers.length + (pendingNarrator ? 1 : 0);
    const detail = `${pendingCount} slot(s) siguen sin binding; esas salidas conservan texto y no sintetizan audio.`;
    input.checks.push(check(effective === undefined ? {kind:'deferred',checkId:'voice',detail} : {kind:'blocked',checkId:'voice',code:'voice-binding-required',detail}));
    return;
  }
  input.checks.push(check({ kind: 'passed', checkId: 'voice', detail: 'Credencial, bindings y assets seleccionados coinciden con la configuración de esta puesta.' }));
}

/** Same voice gate for the final local start fence; never invokes a host or provider. */
export function evaluateVoiceReadiness(input: {expected:ReadyRunConfiguration;result:unknown}):PreflightCheck {
  const parsed = VoiceReadinessSchema.safeParse(input.result);
  if (!parsed.success) return check({kind:'unavailable',checkId:'voice',code:'host-state-invalid',detail:'El estado efectivo de voz no cumple su contrato.'});
  const checks:PreflightCheck[]=[];
  validateVoice({expected:input.expected,result:parsed.data,checks});
  const result=checks[0];
  if (result === undefined) throw new Error('Voice readiness gate produced no result');
  return result;
}

/**
 * Read-only preflight over named host ports. It never calls an LLM, starts Pi,
 * probes a paid provider, changes lifecycle, or fills a missing configuration.
 */
export function createProductionPreflightPort(input: { host: ProductionPreflightHostPort }): ProductionPreflightPort {
  return {
    async preflight(rawInput: unknown): Promise<PreflightReport> {
      const requestSchema = z.strictObject({
        configuration: ReadyRunConfigurationSchema,
        observedAt: z.string().datetime({ offset: true }),
      });
      const request = requestSchema.safeParse(rawInput);
      if (!request.success) {
        return PreflightReportSchema.parse({
          kind: 'invalid',
          checks: [check({ kind: 'blocked', checkId: 'configuration', code: 'configuration-invalid', detail: 'La configuración ready o el instante operativo del preflight no cumple su schema.' })],
        });
      }
      const { configuration, observedAt } = request.data;
      const checks: PreflightCheck[] = [];

      const setupIssues = validateReadyConfiguration(configuration);
      if (setupIssues.length > 0) {
        checks.push(...setupIssues.map((issue) => check({
          kind: 'blocked', checkId: 'configuration', code: `setup-${issue.code}`, detail: issue.detail.slice(0, 500),
        })));
        return makePreflightReport({ configuration, observedAt, checks, profileFingerprint: null });
      }

      const selectedProfileResult = SelectableInferenceProfileSchema.safeParse(configuration.inferenceProfile);
      if (!selectedProfileResult.success) {
        const hasRetiredProfile = configuration.inferenceProfile?.model === LEGACY_INFERENCE_PROFILE.model;
        checks.push(check({
          kind: 'blocked', checkId: 'inference-profile',
          code: hasRetiredProfile ? 'legacy-profile-retired' : 'inference-profile-required',
          detail: hasRetiredProfile
            ? 'Luna 6 xhigh se conserva para leer historia, pero no se puede iniciar una nueva puesta con ese perfil.'
            : 'La configuración Ready no registra una selección de modelo nueva; elegí Sol 6.1 low o Claude Opus 5.5 medium.',
        }));
        return makePreflightReport({ configuration, observedAt, checks, profileFingerprint: null });
      }
      const selectedProfile = selectedProfileResult.data;

      const [configRevision, snapshot, contexts] = await Promise.all([
        readPort({ read: () => input.host.readCurrentConfigurationRevision({ runId: configuration.runId }), schema: CurrentConfigurationRevisionSchema }),
        readPort({ read: () => input.host.loadCurrentWorldSnapshot({ runId: configuration.runId }), schema: WorldSnapshotSchema }),
        readPort({ read: () => input.host.loadPreparedActorContexts({
          runId: configuration.runId,
          characterIds: configuration.roster.preparedCharacters.map((actor) => actor.characterId),
        }), schema: PreparedContextCollectionSchema }),
      ]);
      if (configRevision.kind === 'unavailable') {
        addPortFailure(checks, 'configuration-version', configRevision);
      } else if (configRevision.value.kind === 'unavailable') {
        checks.push(check({ kind: 'unavailable', checkId: 'configuration-version', code: configRevision.value.code, detail: 'No se pudo leer la versión durable de configuración de esta corrida.' }));
      } else if (configRevision.value.revision !== configuration.configRevision) {
        checks.push(check({ kind: 'blocked', checkId: 'configuration-version', code: 'configuration-revision-stale', detail: 'La configuración ready no coincide con la revisión durable actual; valida la versión vigente.' }));
      } else {
        checks.push(check({ kind: 'passed', checkId: 'configuration-version', detail: `Revisión durable ${configuration.configRevision} verificada.` }));
      }
      if (snapshot.kind === 'unavailable') {
        addPortFailure(checks, 'world-snapshot', snapshot);
      } else if (!isDeepStrictEqual(snapshot.value, configuration.worldSnapshot)) {
        checks.push(check({ kind: 'blocked', checkId: 'world-snapshot', code: 'snapshot-fence-stale', detail: 'El snapshot actual difiere de la revisión/secuencia validada; vuelve a preparar desde el corte vigente.' }));
      } else {
        checks.push(check({ kind: 'passed', checkId: 'world-snapshot', detail: `Snapshot completo y exacto en revisión ${snapshot.value.revision}, seq ${snapshot.value.seq} y momento ficticio configurado.` }));
      }
      if (contexts.kind === 'unavailable') addPortFailure(checks, 'prepared-contexts', contexts);
      else validatePreparedContexts({ expected: configuration, result: contexts.value, checks });
      if (checks.some((entry) => entry.kind === 'blocked' || entry.kind === 'unavailable')) {
        return makePreflightReport({ configuration, observedAt, checks, profileFingerprint: null });
      }

      const eligibilityIds = configuration.roster.eligibleCharacterIds;
      const [eligibility, sdk, profile, authentication, runtime, icm, budget] = await Promise.all([
        readPort({ read: () => input.host.readCatalogEligibility({ characterIds: eligibilityIds }), schema: CatalogEligibilitySchema }),
        readPort({ read: () => input.host.readPiSdkStatus(), schema: PiSdkStatusSchema }),
        readPort({ read: () => input.host.readPiModelProfile({ provider: selectedProfile.provider }), schema: PiProfileStatusSchema }),
        readPort({ read: () => input.host.readInferenceAuthenticationStatus({ provider: selectedProfile.provider }), schema: InferenceAuthenticationStatusSchema }),
        readPort({ read: () => input.host.readPiRuntimeReadiness({
          runId: configuration.runId,
          activeCharacterIds: configuration.roster.activeCharacterIds,
          narrationMode: configuration.narrationMode,
        }), schema: PiRuntimeStatusSchema }),
        readPort({ read: () => input.host.readIcmMemoryReadiness({ runId: configuration.runId, actorIds: configuration.roster.activeCharacterIds }), schema: IcmReadinessSchema }),
        readPort({ read: () => input.host.readRunBudgetReadiness({ runId: configuration.runId, budget: configuration.budget }), schema: BudgetReadinessSchema }),
      ]);

      if (eligibility.kind === 'unavailable') addPortFailure(checks, 'catalog-eligibility', eligibility);
      else validateEligibility({ expectedIds: eligibilityIds, result: eligibility.value, checks });

      if (sdk.kind === 'unavailable') addPortFailure(checks, 'pi-sdk', sdk);
      else if (sdk.value.kind !== 'ready' || sdk.value.piCodingAgentVersion !== '1.2.0' || sdk.value.piAiVersion !== '1.2.0') {
        checks.push(check({ kind: 'blocked', checkId: 'pi-sdk', code: sdk.value.kind === 'ready' ? 'pi-sdk-version-mismatch' : sdk.value.code, detail: 'El host no tiene disponible el SDK Pi fijado y la factory de sesiones.' }));
      } else {
        checks.push(check({ kind: 'passed', checkId: 'pi-sdk', detail: `SDK Pi ${sdk.value.piCodingAgentVersion}/${sdk.value.piAiVersion} y factory de sesiones disponibles.` }));
      }

      let profileFingerprint: z.infer<typeof HashSchema> | null = null;
      let accountFingerprint: z.infer<typeof HashSchema> | null = null;
      if (profile.kind === 'unavailable') addPortFailure(checks, 'pi-profile', profile);
      else if (profile.value.kind === 'missing') {
        checks.push(check({ kind: 'blocked', checkId: 'pi-profile', code: profile.value.code, detail: 'Falta el perfil Pi requerido.' }));
      } else {
        profileFingerprint = profile.value.profile.fingerprint;
        if (!profileMatches(profile.value.profile, selectedProfile)) {
          checks.push(check({ kind: 'blocked', checkId: 'pi-profile', code: 'model-profile-incompatible', detail: 'El proveedor, API, modelo, razonamiento o fallback efectivo no coincide con el perfil elegido para esta puesta.' }));
        } else {
          checks.push(check({ kind: 'passed', checkId: 'pi-profile', detail: `El perfil efectivo coincide con ${selectedProfile.provider}/${selectedProfile.model}/${selectedProfile.reasoningEffort}, sin fallback.` }));
        }
      }

      if (authentication.kind === 'unavailable') addPortFailure(checks, 'provider-authentication', authentication);
      else if (authentication.value.provider !== selectedProfile.provider) {
        checks.push(check({ kind: 'blocked', checkId: 'provider-authentication', code: 'provider-authentication-mismatch', detail: 'El host devolvió el estado de autenticación de otro proveedor.' }));
      } else if (authentication.value.kind !== 'authenticated') {
        const code = authentication.value.kind === 'unavailable' ? authentication.value.code : `provider-${authentication.value.kind}`;
        checks.push(check({ kind: 'blocked', checkId: 'provider-authentication', code, detail: `Falta autenticación vigente para ${selectedProfile.provider}.` }));
      } else if (!isInferenceAuthenticationMethodAllowed({
        provider: selectedProfile.provider,
        method: authentication.value.method,
      })) {
        checks.push(check({ kind: 'blocked', checkId: 'provider-authentication', code: 'authentication-method-incompatible', detail: 'El método de autenticación del proveedor no está permitido para el perfil seleccionado.' }));
      } else {
        accountFingerprint = authentication.value.accountFingerprint;
        checks.push(check({ kind: 'passed', checkId: 'provider-authentication', detail: `${selectedProfile.provider} está autenticado con un método permitido; la huella de cuenta/credencial permanece privada.` }));
      }

      if (runtime.kind === 'unavailable') addPortFailure(checks, 'pi-runtime', runtime);
      else validatePiRuntime({ expected: configuration, expectedProfile: selectedProfile, result: runtime.value, checks });
      if (icm.kind === 'unavailable') addPortFailure(checks, 'icm-memory', icm);
      else validateIcm({ expected: configuration, result: icm.value, checks });
      if (budget.kind === 'unavailable') addPortFailure(checks, 'budget', budget);
      else validateBudget({ expected: configuration, result: budget.value, checks });

      if (profileFingerprint !== null && accountFingerprint !== null
        && profile.kind === 'loaded' && profile.value.kind === 'configured'
        && profileMatches(profile.value.profile, selectedProfile)) {
        const access = await readPort({
          read: () => input.host.readInferenceAccessCheckReceipt({
            provider: selectedProfile.provider,
            accountFingerprint,
            profileFingerprint,
          }),
          schema: PiAccessCheckSchema,
        });
        if (access.kind === 'unavailable') {
          checks.push(check({ kind: 'deferred', checkId: 'provider-access-check', detail: 'No se pudo consultar una prueba de acceso vigente; preflight no contacta al proveedor y el inicio queda pendiente.' }));
        } else if (access.value.kind === 'unavailable') {
          checks.push(check({ kind: 'deferred', checkId: 'provider-access-check', detail: 'El host no pudo consultar una prueba de acceso vigente; preflight no contacta al proveedor y el inicio queda pendiente.' }));
        } else if (access.value.kind === 'missing') {
          checks.push(check({ kind: 'deferred', checkId: 'provider-access-check', detail: 'El acceso del proveedor no está probado; preflight no lo prueba y el inicio queda pendiente.' }));
        } else {
          const accessIsCurrent = access.value.provider === selectedProfile.provider
            && access.value.accountFingerprint === accountFingerprint
            && access.value.profileFingerprint === profileFingerprint
            && Date.parse(access.value.checkedAt) <= Date.parse(observedAt)
            && Date.parse(observedAt) < Date.parse(access.value.expiresAt);
          if (accessIsCurrent && access.value.kind === 'failed') {
            checks.push(check({ kind: 'blocked', checkId: 'provider-access-check', code: access.value.code, detail: `La comprobación live previa reportó falta de acceso de ${selectedProfile.provider} para la cuenta/perfil actuales y sigue vigente.` }));
          } else if (accessIsCurrent) {
            checks.push(check({ kind: 'passed', checkId: 'provider-access-check', detail: `La comprobación explícita de acceso coincide con ${selectedProfile.provider}, la cuenta y el perfil actuales, y sigue vigente.` }));
          } else {
            checks.push(check({ kind: 'deferred', checkId: 'provider-access-check', detail: 'No hay prueba vigente para el proveedor, la cuenta y el perfil actuales; preflight no la lanza implícitamente y el inicio queda pendiente.' }));
          }
        }
      }

      const needsVoiceCheck = configuration.audio.mode.kind === 'enabled'
        || configuration.audio.soundEffectSlots.some((entry) => entry.slot.kind === 'enabled-bound');
      const voice = await readPort({
        read: () => input.host.readVoiceReadiness({runId:configuration.runId,configRevision:configuration.configRevision}), schema:VoiceReadinessSchema,
      });
      if (voice.kind === 'unavailable') {
        addPortFailure(checks,'voice',voice);
      } else if (voice.value.kind === 'unavailable' && !needsVoiceCheck) {
        // A missing runtime cannot certify enabled audio, but preserves text-only legacy hosts.
        // An explicitly stale or invalid effective config remains a failure regardless of baseline.
        if (voice.value.code === 'voice-runtime-unavailable') checks.push(check({kind:'passed',checkId:'voice',detail:'El audio guardado está desactivado y el host no tiene runtime de voz.'}));
        else validateVoice({expected:configuration,result:voice.value,checks});
      } else validateVoice({expected:configuration,result:voice.value,checks});

      for (const availability of configuration.participantAvailability) {
        if (availability.kind === 'unavailable') {
          checks.push(check({ kind: 'deferred', checkId: `availability-${availability.characterId}`, detail: `La rutina o disponibilidad explícita mantiene a ${availability.characterId} fuera de convocatorias en este momento ficticio.` }));
        }
      }
      return makePreflightReport({ configuration, observedAt, checks, profileFingerprint });
    },
  };
}

function makePreflightReport(input: {
  configuration: ReadyRunConfiguration;
  observedAt: string;
  checks: PreflightCheck[];
  profileFingerprint: z.infer<typeof HashSchema> | null;
}): PreflightReport {
  const blocked = input.checks.some((entry) => entry.kind !== 'passed');
  return PreflightReportSchema.parse({
    kind: blocked ? 'blocked' : 'passed',
    runId: input.configuration.runId,
    configRevision: input.configuration.configRevision,
    snapshotFence: input.configuration.snapshotFence,
    profileFingerprint: input.profileFingerprint,
    observedAt: input.observedAt,
    checks: input.checks,
  });
}
