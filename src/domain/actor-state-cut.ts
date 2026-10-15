import { z } from 'zod';
import { ActorKnowledgeSchema } from './world-schema.ts';
import { FrozenExperienceSchema } from './experience.ts';
import { ForkSourceSchema } from './fork-origin.ts';
import { CharacterIdSchema, RevisionSchema, RunIdSchema, WorldSeqSchema } from './values.ts';

/** Private state actually admitted by the end of one durable world transaction. */
export const ActorStateCutSchema = z.strictObject({
  kind: z.literal('actor-state-cut'),
  source: ForkSourceSchema,
  actorId: CharacterIdSchema,
  recordedAt: z.string().datetime({ offset: true }),
  knowledge: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('recorded'), revision: RevisionSchema, atWorldSeq: WorldSeqSchema, value: ActorKnowledgeSchema }),
    z.strictObject({ kind: z.literal('unavailable'), reason: z.literal('knowledge-not-recorded') }),
  ]),
  experiences: z.array(FrozenExperienceSchema),
}).superRefine((cut, context) => {
  if (cut.knowledge.kind === 'recorded' && (cut.knowledge.value.runId !== cut.source.runId || cut.knowledge.value.actorId !== cut.actorId || cut.knowledge.atWorldSeq > cut.source.worldSeq))
    context.addIssue({ code: 'custom', path: ['knowledge'], message: 'El conocimiento debe pertenecer al personaje y al corte' });
  const ids = new Set<string>();
  for (const [index, frozen] of cut.experiences.entries()) {
    const experience = frozen.envelope;
    if (experience.runId !== cut.source.runId || experience.actorId !== cut.actorId || experience.worldSeq > cut.source.worldSeq || ids.has(experience.experienceId))
      context.addIssue({ code: 'custom', path: ['experiences', index], message: 'Experiencia duplicada, ajena o posterior al corte' });
    ids.add(experience.experienceId);
  }
});
export type ActorStateCut = z.infer<typeof ActorStateCutSchema>;
export const ActorStateCutRequestSchema = z.strictObject({
  runId: RunIdSchema, actorId: CharacterIdSchema, worldRevision: RevisionSchema, worldSeq: WorldSeqSchema,
  commitIndex: RevisionSchema.optional(),
});
export const ActorStateCutReadResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('found'), cut: ActorStateCutSchema }),
  z.strictObject({ kind: z.literal('unavailable'), reason: z.enum(['checkpoint-not-recorded', 'actor-not-in-cut', 'invalid-cut']) }),
  z.strictObject({ kind: z.literal('missing') }),
]);
export type ActorStateCutReadResult = z.infer<typeof ActorStateCutReadResultSchema>;
