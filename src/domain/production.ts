import { z } from 'zod';
import { IcmWorkspaceSnapshotStructureSchema as IcmWorkspaceSnapshotSchema } from './icm-workspace-schema.ts';
import {
  CharacterIdSchema, FictionalInstantSchema, ProposalIdSchema, RevisionSchema, RunIdSchema,
} from './values.ts';
import {
  ContinuityContextSchema, PreparationDraftSchema, PreparedCharacterSchema, SpanishVarietyForActingSchema,
} from './preparation.ts';
import { WorldSnapshotSchema } from './world-schema.ts';
import { HumanParticipantProfileSchema } from './interaction-schema.ts';
import {
  DEFAULT_INFERENCE_PROFILE, PersistedInferenceProfileSchema,
} from './inference-profile.ts';

const nonNegativeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const ProductionEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('operator-choice'),
    operatorId: z.string().min(1).max(200),
    recordedAt: z.string().datetime({ offset: true }),
  }),
  z.strictObject({
    kind: z.literal('host-derived'),
    derivationRef: z.string().min(1).max(500),
    recordedAt: z.string().datetime({ offset: true }),
  }),
  z.strictObject({
    kind: z.literal('integrator-default'),
    decisionRef: z.string().min(1).max(200),
  }),
]);
export type ProductionEvidence = z.infer<typeof ProductionEvidenceSchema>;

/** An incomplete value stays a draft; only a configured value can enter Ready. */
export function ProductionDraftFieldSchema<const T extends z.ZodType>(valueSchema: T) {
  return z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('empty') }),
    z.strictObject({
      kind: z.literal('proposed'),
      proposalId: ProposalIdSchema,
      source: z.enum(['configurator', 'template', 'editorial']),
      value: valueSchema,
    }),
    z.strictObject({
      kind: z.literal('configured'),
      value: valueSchema,
      evidence: ProductionEvidenceSchema,
    }),
  ]);
}

export const DramaticConflictSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('not-formulated') }),
  z.strictObject({ kind: z.literal('formulated'), statement: z.string().trim().min(1).max(4_000) }),
]);
export type DramaticConflict = z.infer<typeof DramaticConflictSchema>;

export const DramaticLineSchema = z.strictObject({
  purpose: z.string().trim().min(1).max(4_000),
  question: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('absent') }),
    z.strictObject({ kind: z.literal('formulated'), text: z.string().trim().min(1).max(4_000) }),
  ]),
  conflict: DramaticConflictSchema,
});
export type DramaticLine = z.infer<typeof DramaticLineSchema>;

/** Optional dramatic lenses are configuration metadata, not a required plot template. */
export const DramaticReferenceSchema = z.strictObject({
  tradition: z.enum(['greek-tragedy', 'old-comedy']),
  author: z.string().trim().min(1).max(120),
  work: z.string().trim().min(1).max(160),
  focus: z.string().trim().max(1_000).optional(),
});
export const DramaticReferencesSchema = z.array(DramaticReferenceSchema).max(12)
  .superRefine((references, context) => {
    const seen = new Set<string>();
    for (const [index, reference] of references.entries()) {
      const key = `${reference.tradition}:${reference.author.toLocaleLowerCase('es')}:${reference.work.toLocaleLowerCase('es')}`;
      if (seen.has(key)) context.addIssue({ code: 'custom', path: [index, 'work'], message: 'La referencia está duplicada.' });
      seen.add(key);
    }
  });
export type DramaticReference = z.infer<typeof DramaticReferenceSchema>;
export type DramaticReferences = z.infer<typeof DramaticReferencesSchema>;

export const CircadianPolicySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('manual-only') }),
  z.strictObject({
    kind: z.literal('advance-while-running'),
    maxAdvanceMs: nonNegativeInteger,
  }),
]);
export type CircadianPolicy = z.infer<typeof CircadianPolicySchema>;

/** Public narration is independent from the optional narrator speech binding. */
export const NarrationModeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('disabled') }),
  z.strictObject({ kind: z.literal('enabled') }),
]);
export type NarrationMode = z.infer<typeof NarrationModeSchema>;

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const RequestTimeoutMsSchema = z.number().int().min(1_000).max(300_000);

export const RunBudgetSchema = z.strictObject({
  maxPiCallsPerRun: nonNegativeInteger.max(100_000).nullable(),
  maxPiCallsPerPulse: nonNegativeInteger.max(256).nullable(),
  maxConcurrentPiRequests: z.number().int().min(1).max(8),
  maxWallTimeMs: nonNegativeInteger.max(31_536_000_000).nullable(),
  /** Missing only in historical serialized budgets; resolve with effectiveRequestTimeoutMs without rewriting them. */
  requestTimeoutMs: RequestTimeoutMsSchema.optional(),
}).superRefine((budget, context) => {
  if (budget.maxPiCallsPerPulse !== null && budget.maxPiCallsPerRun !== null && budget.maxPiCallsPerPulse > budget.maxPiCallsPerRun) {
    context.addIssue({
      code: 'custom', path: ['maxPiCallsPerPulse'],
      message: 'El límite por pulso no puede superar el límite de la corrida',
    });
  }
  if (budget.maxPiCallsPerPulse !== null && budget.maxPiCallsPerPulse > 0 && budget.maxConcurrentPiRequests > budget.maxPiCallsPerPulse) {
    context.addIssue({
      code: 'custom', path: ['maxConcurrentPiRequests'],
      message: 'La concurrencia no puede superar el presupuesto por pulso',
    });
  }
});
export type RunBudget = z.infer<typeof RunBudgetSchema>;

export function effectiveRequestTimeoutMs(budget: Pick<RunBudget, 'requestTimeoutMs'>): number {
  return budget.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
}

export const AudioModeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('disabled') }),
  z.strictObject({
    kind: z.literal('enabled'),
    language: z.literal('es'),
    ttsMode: z.enum(['automatic-after-publication', 'manual-per-publication']),
    ttsModelId: z.string().min(1).max(200),
    outputFormat: z.enum(['mp3_44100_128', 'mp3_44100_192', 'pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100']),
    subtitles: z.boolean(),
  }),
]);
export type AudioMode = z.infer<typeof AudioModeSchema>;

export const SpeechBindingIdSchema = z.string().uuid().brand<'SpeechBindingId'>();
export const SoundBindingIdSchema = z.string().uuid().brand<'SoundBindingId'>();

export const SpeakerSlotSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('disabled') }),
  z.strictObject({ kind: z.literal('enabled-unbound') }),
  z.strictObject({ kind: z.literal('enabled-bound'), speechBindingId: SpeechBindingIdSchema }),
]);
export type SpeakerSlot = z.infer<typeof SpeakerSlotSchema>;

export const SpeakerSlotEntrySchema = z.strictObject({
  characterId: CharacterIdSchema,
  slot: SpeakerSlotSchema,
});
export type SpeakerSlotEntry = z.infer<typeof SpeakerSlotEntrySchema>;

export const NarratorSlotSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('absent') }),
  z.strictObject({ kind: z.literal('enabled-unbound') }),
  z.strictObject({ kind: z.literal('enabled-bound'), speechBindingId: SpeechBindingIdSchema }),
]);
export type NarratorSlot = z.infer<typeof NarratorSlotSchema>;

export const SoundEffectSlotSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('disabled') }),
  z.strictObject({ kind: z.literal('enabled-unbound') }),
  z.strictObject({ kind: z.literal('enabled-bound'), soundBindingId: SoundBindingIdSchema }),
]);
export type SoundEffectSlot = z.infer<typeof SoundEffectSlotSchema>;

export const SoundEffectSlotEntrySchema = z.strictObject({
  characterId: CharacterIdSchema,
  slot: SoundEffectSlotSchema,
});
export type SoundEffectSlotEntry = z.infer<typeof SoundEffectSlotEntrySchema>;

export const ProductionAudioSchema = z.strictObject({
  mode: AudioModeSchema,
  speakerSlots: z.array(SpeakerSlotEntrySchema).max(100),
  narratorSlot: NarratorSlotSchema,
  soundEffectSlots: z.array(SoundEffectSlotEntrySchema).max(100),
}).superRefine((audio, context) => {
  const speakerIds = new Set<string>();
  for (const [index, entry] of audio.speakerSlots.entries()) {
    if (speakerIds.has(entry.characterId)) {
      context.addIssue({ code: 'custom', path: ['speakerSlots', index, 'characterId'], message: 'Una identidad sólo puede tener un slot de voz en esta puesta' });
    }
    speakerIds.add(entry.characterId);
  }
  const effectIds = new Set<string>();
  for (const [index, entry] of audio.soundEffectSlots.entries()) {
    if (effectIds.has(entry.characterId)) {
      context.addIssue({ code: 'custom', path: ['soundEffectSlots', index, 'characterId'], message: 'Una identidad sólo puede tener un slot de efecto en esta puesta' });
    }
    effectIds.add(entry.characterId);
  }
});
export type ProductionAudio = z.infer<typeof ProductionAudioSchema>;

export const ProductionRosterSchema = z.strictObject({
  /** Catalog eligibility is a separate host read; this list records the chosen eligible set. */
  eligibleCharacterIds: z.array(CharacterIdSchema).max(1_000),
  /** Full, validated per-identity preparation snapshots available to this run. */
  preparedCharacters: z.array(PreparedCharacterSchema).max(1_000),
  /** Curated sections still awaiting a complete, valid acting context. Never scheduled. */
  preparationDrafts: z.array(PreparationDraftSchema).max(1_000).optional(),
  /** Active means an actor session may be scheduled in this run. */
  activeCharacterIds: z.array(CharacterIdSchema).max(1_000),
}).superRefine((roster, context) => {
  const validateUnique = (values: readonly string[], path: string[]) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) context.addIssue({ code: 'custom', path: [...path, index], message: 'La identidad está duplicada' });
      seen.add(value);
    });
  };
  validateUnique(roster.eligibleCharacterIds, ['eligibleCharacterIds']);
  validateUnique(roster.preparedCharacters.map((character) => character.characterId), ['preparedCharacters']);
  validateUnique((roster.preparationDrafts ?? []).map((character) => character.characterId), ['preparationDrafts']);
  for (const [index, character] of (roster.preparationDrafts ?? []).entries()) {
    if (roster.preparedCharacters.some(prepared => prepared.characterId === character.characterId)) {
      context.addIssue({ code: 'custom', path: ['preparationDrafts', index, 'characterId'], message: 'Una curación pendiente no puede coexistir con un actor habilitado de la misma identidad.' });
    }
  }
  validateUnique(roster.activeCharacterIds, ['activeCharacterIds']);
});
export type ProductionRoster = z.infer<typeof ProductionRosterSchema>;

export const HumanParticipantProfilesSchema = z.array(HumanParticipantProfileSchema).max(10).superRefine((profiles, context) => {
  const participantIds = new Set<string>();
  for (const [index, profile] of profiles.entries()) {
    if (participantIds.has(profile.identity.participantId)) {
      context.addIssue({ code: 'custom', path: [index, 'identity', 'participantId'], message: 'La identidad humana está duplicada en la puesta' });
    }
    participantIds.add(profile.identity.participantId);
  }
});
export type HumanParticipantProfiles = z.infer<typeof HumanParticipantProfilesSchema>;

/** Editable, structurally closed candidate. Cross-field completeness is checked only when promoting to Ready. */
export const WorldPreparationCandidateSchema = z.strictObject({
  ...WorldSnapshotSchema.shape,
  places: z.array(z.strictObject(WorldSnapshotSchema.shape.places.element.shape).partial()).max(10_000),
  scenes: z.array(z.strictObject(WorldSnapshotSchema.shape.scenes.element.shape).partial()).max(1_000),
}).partial();
/** Compatibility name for serialized world preparation candidates. */
export const WorldSnapshotDraftSchema = WorldPreparationCandidateSchema;

/** Scenes still waiting for a prepared actor: participants are added only by placing one, never invented. */
export function scenesAwaitingParticipants(candidate: z.infer<typeof WorldPreparationCandidateSchema>): { index: number; label: string }[] {
  return (candidate.scenes ?? []).flatMap((scene, index) => (scene.participantIds?.length ?? 0) === 0
    ? [{ index, label: scene.label ?? scene.id ?? `escena ${index + 1}` }] : []);
}
export function sceneAwaitingParticipantsDetail(label: string): string {
  return `La escena «${label}» todavía no tiene participantes. Prepará un actor y colocalo en ella; no se añade interlocutor automáticamente.`;
}

/** Host policy for fresh preparations. Missing historical values stay absent. */
export const CharacterDefinitionPolicySchema=z.strictObject({kind:z.literal('embodied-v1')});

export const RunConfigurationDraftSchema = z.strictObject({
  kind: z.literal('run-configuration-draft'),
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  revision: RevisionSchema,
  characterDefinitionPolicy: CharacterDefinitionPolicySchema.optional(),
  name: ProductionDraftFieldSchema(z.string().trim().min(1).max(120)),
  fictionalAt: ProductionDraftFieldSchema(FictionalInstantSchema),
  continuity: ProductionDraftFieldSchema(ContinuityContextSchema),
  roster: ProductionDraftFieldSchema(ProductionRosterSchema),
  /** Human-authored fictional participants; empty is a valid explicit default. */
  humanParticipants: ProductionDraftFieldSchema(HumanParticipantProfilesSchema),
  /** Structurally closed, possibly incomplete candidate; Ready requires the full WorldSnapshotSchema. */
  worldSnapshot: ProductionDraftFieldSchema(WorldSnapshotDraftSchema),
  dramaticLine: ProductionDraftFieldSchema(DramaticLineSchema),
  /** Missing only in historical drafts; refs remain separate from progression and structure. */
  dramaticReferences: ProductionDraftFieldSchema(DramaticReferencesSchema).optional(),
  circadianPolicy: ProductionDraftFieldSchema(CircadianPolicySchema),
  spanishVariety: ProductionDraftFieldSchema(SpanishVarietyForActingSchema),
  narrationMode: ProductionDraftFieldSchema(NarrationModeSchema),
  /** Optional only for old serialized drafts; new drafts explicitly record the selected profile. */
  inferenceProfile: ProductionDraftFieldSchema(PersistedInferenceProfileSchema).optional(),
  /** Frozen Markdown contracts; absent legacy drafts stay absent until explicit admission. */
  icmWorkspace: ProductionDraftFieldSchema(IcmWorkspaceSnapshotSchema).optional(),
  budget: ProductionDraftFieldSchema(RunBudgetSchema),
  maxReformulations: ProductionDraftFieldSchema(z.number().int().min(0).max(2)),
  audio: ProductionDraftFieldSchema(ProductionAudioSchema),
});
export type RunConfigurationDraft = z.infer<typeof RunConfigurationDraftSchema>;

export const EmptyRunConfigurationRequestSchema = z.strictObject({
  runId: RunIdSchema,
  revision: RevisionSchema,
});

export function createEmptyRunConfigurationDraft(input: unknown): RunConfigurationDraft {
  const request = EmptyRunConfigurationRequestSchema.parse(input);
  const defaultEvidence = (decisionRef: string) => ProductionEvidenceSchema.parse({
    kind: 'integrator-default', decisionRef,
  });
  return RunConfigurationDraftSchema.parse({
    kind: 'run-configuration-draft',
    schemaVersion: 1,
    runId: request.runId,
    revision: request.revision,
    name: { kind: 'empty' },
    fictionalAt: { kind: 'empty' },
    continuity: { kind: 'empty' },
    roster: { kind: 'empty' },
    humanParticipants: {
      kind: 'configured', value: [],
      evidence: defaultEvidence('S01-new-run-no-human-participant-until-configured'),
    },
    worldSnapshot: { kind: 'empty' },
    dramaticLine: { kind: 'empty' },
    dramaticReferences: {
      kind: 'configured', value: [],
      evidence: defaultEvidence('S09-default-no-dramatic-reference-template'),
    },
    circadianPolicy: { kind: 'empty' },
    spanishVariety: { kind: 'empty' },
    narrationMode: {
      kind: 'configured', value: { kind: 'disabled' },
      evidence: defaultEvidence('S06-new-run-narration-disabled'),
    },
    inferenceProfile: {
      kind: 'configured', value: DEFAULT_INFERENCE_PROFILE,
      evidence: defaultEvidence('S03-default-inference-profile-openai-codex-gpt-6.1-sol-low'),
    },
    budget: { kind: 'empty' },
    maxReformulations: {
      kind: 'configured', value: 2,
      evidence: defaultEvidence('S03-current-protocol-max-reformulations'),
    },
    audio: {
      kind: 'configured',
      value: { mode: { kind: 'disabled' }, speakerSlots: [], narratorSlot: { kind: 'absent' }, soundEffectSlots: [] },
      evidence: defaultEvidence('S06-new-run-audio-disabled'),
    },
  });
}

export const ProductionValidationIssueSchema = z.strictObject({
  code: z.enum([
    'draft-schema-invalid', 'draft-field-empty', 'proposal-not-confirmed', 'invalid-world-snapshot',
    'world-run-mismatch', 'fictional-time-mismatch', 'continuity-mismatch',
    'roster-empty', 'actor-not-eligible', 'actor-not-prepared', 'actor-not-active',
    'actor-missing-from-world', 'actor-preparation-mismatch', 'actor-context-mismatch',
    'active-actor-missing-from-world', 'scene-not-open', 'scene-has-no-participant',
    'participant-not-active', 'participant-not-present', 'participant-unavailable',
    'human-participant-invalid',
    'place-missing', 'channel-declaration-invalid', 'prepared-capability-mismatch',
    'nonverbal-actor-has-speech', 'variety-required', 'audio-requires-confirmed-variety',
    'speaker-slot-mismatch', 'voice-binding-invalid', 'budget-invalid',
    'inference-profile-required', 'legacy-inference-profile',
  ]),
  field: z.string().min(1).max(200),
  detail: z.string().min(1).max(2_000),
});
export type ProductionValidationIssue = z.infer<typeof ProductionValidationIssueSchema>;

