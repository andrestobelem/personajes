import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PersistedInferenceProfileSchema } from './inference-profile.ts';
import { ExperienceSchema } from './experience.ts';
import { PreparedCharacterSchema, ContinuityContextSchema, SpanishVarietyForActingSchema, WorldActionSchema,GoalSchema,AntecedentIdSchema } from './preparation.ts';
import { HashSchema } from './values.ts';
import { ActorTurnJobScopeSchema, ContinuistaCriterionSchema, ContinuistaReviewInputSchema, FrozenActorWorldCutSchema, WorldProposalRecordSchema } from './world-journal.ts';
import { ActorWorldProjectionSchema } from './actor-world-projection.ts';
import { WorldPerceptionSchema } from './world-schema.ts';

/** A direct observation already delivered to the actor: private knowledge with no public event or Experience. */
const PrivateObservationSchema = WorldPerceptionSchema.options[1];

const PreparationSchema = z.strictObject({
  identity: PreparedCharacterSchema.shape.identity.shape.value,
  voice: PreparedCharacterSchema.shape.voice.shape.value,
  antecedents: z.array(z.strictObject({
    antecedentId:AntecedentIdSchema.optional(),
    kind: z.enum(['biography', 'milestone', 'recollection', 'testimony']),
    statement: z.string().min(1).max(8_000),
  })).max(10_000),
  preparedGoals:z.array(GoalSchema).min(1).max(1000).optional(),
  capabilities: z.array(z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.enum(['speech', 'movement', 'gesture', 'nonverbal-sound', 'other']), description: z.string().min(1).max(2_000) }),
    z.strictObject({ kind: z.literal('operate-device'), deviceId: z.string().min(1).max(120), description: z.string().min(1).max(2_000) }),
    z.strictObject({ kind: z.literal('world-action'), action: WorldActionSchema, description: z.string().min(1).max(2_000) }),
  ])).min(1).max(1_000),
  initialExperiences: z.array(ExperienceSchema).max(10_000),
  unknownPolicy: PreparedCharacterSchema.shape.unknownPolicy.shape.value,
});
const CircumstancesSchema = z.strictObject({
  fictionalAt: FrozenActorWorldCutSchema.shape.fictionalAt,
  place: ActorWorldProjectionSchema.shape.world.shape.currentPlace,
  clockConvention: ActorWorldProjectionSchema.shape.world.shape.now.shape.convention,
  language: z.literal('es'),
  spanishVariety: SpanishVarietyForActingSchema,
});
export const ContinuistaContextPayloadSchema = z.strictObject({
  inferenceProfile: PersistedInferenceProfileSchema.optional(),
  scope: ActorTurnJobScopeSchema,
  proposal: WorldProposalRecordSchema,
  inputCut: FrozenActorWorldCutSchema,
  preparedContextHash: HashSchema,
  preparation: PreparationSchema,
  continuity: ContinuityContextSchema,
  circumstances: CircumstancesSchema,
  projection: ActorWorldProjectionSchema,
  experiences: z.array(ExperienceSchema).max(10_000),
  /** Absent in historical contexts; present only when the actor already received direct observations. */
  privateObservations: z.array(PrivateObservationSchema).min(1).max(10_000).optional(),
  limits: z.strictObject({ directionIndications: z.literal('no-authorized-ledger'), rhythmCalibration: z.literal('not-measured') }),
});
const EvidenceSectionSchema = z.enum(['proposal', 'preparation', 'continuity', 'circumstances', 'projection']);
const EvidenceEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('section'), section: EvidenceSectionSchema, contentHash: HashSchema }),
  z.strictObject({ kind: z.literal('experience'), experienceId: ExperienceSchema.options[0].shape.experienceId, contentHash: HashSchema }),
  z.strictObject({ kind: z.literal('observation'), perceptionId: PrivateObservationSchema.shape.id, contentHash: HashSchema }),
]);
const EvidenceMapSchema = z.record(z.string().min(1).max(120), EvidenceEntrySchema);
const ContextObjectSchema = z.strictObject({
  kind: z.literal('continuista-review-context'), schemaVersion: z.literal(1), contextHash: HashSchema,
  payload: ContinuistaContextPayloadSchema, evidence: EvidenceMapSchema,
});
export type ContinuistaReviewContext = z.infer<typeof ContextObjectSchema>;

/** Rehash and rebind the whole envelope before it is used as authority for any review. */
export function validateContinuistaReviewContext(rawContext: unknown): ContinuistaReviewContext {
  const context = ContextObjectSchema.parse(rawContext);
  const { scope, proposal, projection, inputCut, experiences, preparation, continuity, circumstances } = context.payload;
  if (hashContinuistaValue({ payload: context.payload, evidence: context.evidence }) !== context.contextHash) throw new Error('Hash del contexto Continuista no coincide');
  if (proposal.runId !== scope.runId || proposal.actorId !== scope.actorId || proposal.jobId !== scope.jobId
    || proposal.generation !== scope.generation || proposal.baseRevision !== inputCut.worldRevision
    || projection.runId !== scope.runId || projection.actorId !== scope.actorId
    || projection.worldRevision !== inputCut.worldRevision || projection.atWorldSeq !== inputCut.worldSeq
    || projection.fictionalAt !== inputCut.fictionalAt
    || canonicalContinuistaValue(projection.inputPerceptionIds) !== canonicalContinuistaValue(inputCut.perceptionIds)
    || projection.continuity.continuityId !== continuity.continuityId
    || projection.continuity.revision !== continuity.revision || projection.continuity.contentHash !== continuity.contentHash
    || circumstances.fictionalAt !== inputCut.fictionalAt
    || canonicalContinuistaValue(circumstances.place) !== canonicalContinuistaValue(projection.world.currentPlace)
    || canonicalContinuistaValue(circumstances.clockConvention) !== canonicalContinuistaValue(projection.world.now.convention)) {
    throw new Error('El contexto Continuista no conserva el actor, propuesta, continuidad y corte exactos');
  }
  const seen = new Set<string>();
  for (const experience of experiences) {
    if (experience.actorId !== scope.actorId || experience.runId !== scope.runId || experience.worldSeq > inputCut.worldSeq
      || experience.fictitiousAt > inputCut.fictionalAt || experience.receivedAt > inputCut.fictionalAt) throw new Error('Experiencia ajena o futura en el contexto Continuista');
    if (seen.has(experience.experienceId)) throw new Error('Experiencia duplicada en el contexto Continuista');
    seen.add(experience.experienceId);
  }
  const observed = new Set<string>();
  for (const observation of context.payload.privateObservations ?? []) {
    if (observation.recipientCharacterId !== scope.actorId || observation.runId !== scope.runId
      || observation.fictitiousAt > inputCut.fictionalAt) throw new Error('Observación ajena o futura en el contexto Continuista');
    if (observed.has(observation.id)) throw new Error('Observación duplicada en el contexto Continuista');
    observed.add(observation.id);
  }
  for (const experience of preparation.initialExperiences) {
    if (experience.actorId !== scope.actorId || experience.fictitiousAt > inputCut.fictionalAt
      || experience.receivedAt > inputCut.fictionalAt
      || (experience.runId === scope.runId && experience.worldSeq > inputCut.worldSeq)) throw new Error('Recuerdo inicial ajeno o futuro en el contexto Continuista');
  }
  if (canonicalContinuistaValue(buildContinuistaEvidence(context.payload)) !== canonicalContinuistaValue(context.evidence)) throw new Error('El mapa de evidencia no corresponde al contexto autorizado');
  return context;
}

export function buildContinuistaEvidence(payload: z.infer<typeof ContinuistaContextPayloadSchema>): z.infer<typeof EvidenceMapSchema> {
  const evidence: z.infer<typeof EvidenceMapSchema> = {};
  for (const section of EvidenceSectionSchema.options) evidence[`ctx:${section}`] = { kind: 'section', section, contentHash: hashContinuistaValue(payload[section]) };
  for (const experience of [...payload.preparation.initialExperiences, ...payload.experiences]) {
    const key = `experience:${experience.experienceId}`;
    if (Object.hasOwn(evidence, key)) throw new Error('Experiencia repetida entre memoria inicial y journal');
    evidence[key] = { kind: 'experience', experienceId: experience.experienceId, contentHash: hashContinuistaValue(experience) };
  }
  for (const observation of payload.privateObservations ?? []) {
    evidence[`observation:${observation.id}`] = { kind: 'observation', perceptionId: observation.id, contentHash: hashContinuistaValue(observation) };
  }
  return evidence;
}

export const ContinuistaReviewResponseSchema = z.strictObject({ contextHash: HashSchema, review: ContinuistaReviewInputSchema });
/** Incomplete responses may be staged only when explicitly requested; the default rejects them. */
export function validateContinuistaContextReview(input: { context: unknown; response: unknown; allowIncomplete?: boolean }) {
  const context = validateContinuistaReviewContext(input.context);
  const response = ContinuistaReviewResponseSchema.parse(input.response);
  const { review } = response;
  const proposal = context.payload.proposal;
  if (response.contextHash !== context.contextHash || review.runId !== proposal.runId || review.actorId !== proposal.actorId
    || review.proposalId !== proposal.proposalId || review.version !== proposal.version
    || review.stateRevision !== proposal.baseRevision || review.exactContentHash !== proposal.exactContentHash
    || review.nextInitiative !== proposal.nextInitiative) throw new Error('La revisión no pertenece al contexto y propuesta exactos');
  if ((!review.complete && !input.allowIncomplete) || (review.complete && (review.evidenceRefs.length === 0
    || !ContinuistaCriterionSchema.options.every((code) => review.criterionCodes.includes(code))))) throw new Error('La revisión del Continuista está incompleta');
  for (const reference of review.evidenceRefs) if (!Object.hasOwn(context.evidence, reference)) throw new Error('La revisión cita evidencia no autorizada o inexistente');
  return response;
}

export function canonicalContinuistaValue(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('Contexto no serializable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalContinuistaValue).join(',')}]`;
  const record = z.record(z.string(), z.unknown()).parse(value);
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalContinuistaValue(record[key])}`).join(',')}}`;
}
export function hashContinuistaValue(value: unknown): z.infer<typeof HashSchema> {
  return HashSchema.parse(createHash('sha256').update(canonicalContinuistaValue(value)).digest('hex'));
}
