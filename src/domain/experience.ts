import { z } from 'zod';
import {
  CharacterIdSchema, EntityHandleSchema, EventIdSchema, ExperienceIdSchema,
  FictionalInstantSchema, HashSchema, HumanParticipantIdSchema, PerceptionIdSchema, RevisionSchema,
  RunIdSchema, SourceRefIdSchema, WorldSeqSchema,
} from './values.ts';

/** Immediate parent cut of an imported memory; older lineage remains verifiable through its source payload. */
export const ForkExperienceOriginSchema = z.strictObject({
  kind:z.literal('fork'), sourceRunId:RunIdSchema, sourceActorId:CharacterIdSchema,
  sourceExperienceId:ExperienceIdSchema, sourcePayloadHash:HashSchema,
  sourceCommitIndex:RevisionSchema, sourceWorldRevision:RevisionSchema,
  sourceWorldSeq:WorldSeqSchema, sourceSnapshotHash:HashSchema,
});

const fields = {
  schemaVersion: z.literal(1),
  experienceId: ExperienceIdSchema,
  runId: RunIdSchema,
  actorId: CharacterIdSchema,
  content: z.string().min(1).max(16_384).refine((text) => !text.includes('\0'), 'NUL inválido'),
  sourceRefs: z.array(SourceRefIdSchema).max(1_000),
  forkOrigin: ForkExperienceOriginSchema.optional(),
  fictitiousAt: FictionalInstantSchema,
  receivedAt: FictionalInstantSchema,
  worldSeq: WorldSeqSchema,
  confidence: z.number().finite().min(0).max(1),
  revision: RevisionSchema,
  predecessor: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('initial') }),
    z.strictObject({ kind: z.literal('revision'), experienceId: ExperienceIdSchema }),
  ]),
};

export const ExperienceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...fields, kind: z.literal('perception'), perceptionId: PerceptionIdSchema, eventId: EventIdSchema }),
  z.strictObject({
    ...fields, kind: z.literal('testimony'), speakerHandle: EntityHandleSchema.optional(),
    speakerParticipantId: HumanParticipantIdSchema.optional(), speakerDisplayName: z.string().min(1).max(120).optional(),
    eventId: EventIdSchema,
  }).superRefine((experience, context) => {
    const hasCharacter = experience.speakerHandle !== undefined;
    const hasHuman = experience.speakerParticipantId !== undefined && experience.speakerDisplayName !== undefined;
    if (hasCharacter === hasHuman || (experience.speakerParticipantId === undefined) !== (experience.speakerDisplayName === undefined)) {
      context.addIssue({ code: 'custom', path: ['speakerHandle'], message: 'El testimonio requiere un hablante humano o un handle de personaje, de forma excluyente' });
    }
  }),
  z.strictObject({ ...fields, kind: z.literal('inference'), basedOn: z.array(ExperienceIdSchema).min(1).max(1_000) }),
  z.strictObject({ ...fields, kind: z.literal('belief'), basedOn: z.array(ExperienceIdSchema).max(1_000) }),
  z.strictObject({ ...fields, kind: z.literal('recollection'), basedOn: z.array(ExperienceIdSchema).max(1_000) }),
]);
export type Experience = z.infer<typeof ExperienceSchema>;

export const FrozenExperienceSchema = z.strictObject({
  envelope: ExperienceSchema,
  canonicalPayload: z.string(),
  payloadHash: HashSchema,
});
export type FrozenExperience = z.infer<typeof FrozenExperienceSchema>;

