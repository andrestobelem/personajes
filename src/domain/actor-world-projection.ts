import { z } from 'zod';
import { ActorWorldViewSchema } from './world.ts';
import { ContinuityReferenceSchema } from './preparation.ts';
import { CharacterIdSchema, FictionalInstantSchema, PerceptionIdSchema, RevisionSchema, RunIdSchema, WorldSeqSchema } from './values.ts';

const ActorFacingSelfSchema = ActorWorldViewSchema.shape.self.omit({ beliefs: true, experiences: true });

/** The source is the World actor view; private memory is supplied by the experience port. */
export const ActorFacingWorldViewSchema = ActorWorldViewSchema.extend({ self: ActorFacingSelfSchema });
export type ActorFacingWorldView = z.infer<typeof ActorFacingWorldViewSchema>;

export const ActorWorldProjectionSchema = z.strictObject({
  kind: z.literal('actor-world-projection'),
  actorId: CharacterIdSchema,
  runId: RunIdSchema,
  continuity: ContinuityReferenceSchema,
  worldRevision: RevisionSchema,
  atWorldSeq: WorldSeqSchema,
  fictionalAt: FictionalInstantSchema,
  /** Host-side inbox cursor paired with this exact projection; prompt compilers must keep it out of actor text. */
  inputPerceptionIds: z.array(PerceptionIdSchema).max(100_000),
  world: ActorFacingWorldViewSchema,
});
export type ActorWorldProjection = z.infer<typeof ActorWorldProjectionSchema>;

