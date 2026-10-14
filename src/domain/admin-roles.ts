import { z } from 'zod';
import { SelectableInferenceProfileSchema } from './inference-profile.ts';
import { DramaticLineSchema } from './production.ts';
import { CharacterIdSchema, EventIdSchema, FictionalInstantSchema, HashSchema, JobIdSchema, PulseIdSchema, RevisionSchema, RunIdSchema, WorldSeqSchema } from './values.ts';
import { WorldEventSchema } from './world-schema.ts';

/** Administrative roles have their own identity; none is a fictional character. */
export const AdministrativeRoleSchema = z.enum(['director', 'narrator', 'configurator', 'narration-reviewer']);
export const AdministrativeRunScopeSchema = z.strictObject({
  runId: RunIdSchema, pulseId: PulseIdSchema, jobId: JobIdSchema,
  generation: RevisionSchema, lifecycleRevision: RevisionSchema,
  configurationRevision: RevisionSchema, worldRevision: RevisionSchema,
  throughWorldSeq: WorldSeqSchema, fictitiousAt: FictionalInstantSchema,
  profile: SelectableInferenceProfileSchema,
});

const AnnotationIdSchema = z.string().uuid();
export const DirectorStageSchema = z.enum(['planteamiento', 'desarrollo', 'climax', 'desenlace']);
const ReferencesSchema = z.array(EventIdSchema).max(1000).refine(items => new Set(items).size === items.length, 'Referencias duplicadas');
export const DirectorObservationSchema = z.strictObject({
  kind: z.literal('director-observation'),
  stage: DirectorStageSchema,
  assessment: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('sufficient'), reason: z.string().trim().min(1).max(4000), evidenceEventIds: ReferencesSchema.refine(items => items.length > 0, 'Una etapa requiere evidencia') }),
    z.strictObject({ kind: z.literal('insufficient'), reason: z.string().trim().min(1).max(4000), evidenceEventIds: ReferencesSchema }),
  ]),
  affectedCharacterIds: z.array(CharacterIdSchema).max(100).refine(items => new Set(items).size === items.length, 'Personajes duplicados'),
  openQuestions: z.array(z.string().trim().min(1).max(2000)).max(100),
  revision: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('initial') }),
    z.strictObject({ kind: z.literal('rectification'), supersedes: AnnotationIdSchema, reason: z.string().trim().min(1).max(4000) }),
  ]),
});
export const DirectorAnnotationSchema = z.strictObject({
  annotationId: AnnotationIdSchema, scope: AdministrativeRunScopeSchema,
  contextHash: HashSchema, observation: DirectorObservationSchema,
});
export const DirectorContextSchema = z.strictObject({
  kind: z.literal('director-context'), schemaVersion: z.literal(1), role: z.literal('director'),
  scope: AdministrativeRunScopeSchema, dramaticLine: DramaticLineSchema,
  participantCharacterIds: z.array(CharacterIdSchema).max(100),
  confirmedEvents: z.array(WorldEventSchema).max(10000),
  previousAnnotations: z.array(DirectorAnnotationSchema).max(10000),
});
export type DirectorContext = z.infer<typeof DirectorContextSchema>;
export type DirectorObservation = z.infer<typeof DirectorObservationSchema>;
