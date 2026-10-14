import {z} from 'zod';
import {RunIdSchema,WorldSeqSchema,RevisionSchema} from './values.ts';
import {NarrationPublicationIdSchema,NarrationProposalSchema} from './narration.ts';
import {SceneIdSchema} from './world-schema.ts';

export const NarrationPageRequestSchema=z.strictObject({
  runId:RunIdSchema,atWorldSeq:WorldSeqSchema.optional(),worldRevision:RevisionSchema.optional(),
  cursor:z.string().min(1).max(2048).optional(),limit:z.number().int().min(1).max(100).default(25),
});
/** Offstage publications carry no character perception, reviewer internals or session data. */
export const PublicNarrationSchema=z.strictObject({
  kind:z.literal('published-narration'),publicationId:NarrationPublicationIdSchema,
  text:NarrationProposalSchema.options[0].shape.text,sceneId:SceneIdSchema,
  sourceWorldSeq:WorldSeqSchema,sourceWorldRevision:RevisionSchema,
  publishedAt:z.number().int().nonnegative().safe(),uncertainty:NarrationProposalSchema.options[0].shape.uncertainty,
});
export const PublicNarrationPageSchema=z.strictObject({
  kind:z.literal('narration-page'),runId:RunIdSchema,atWorldSeq:WorldSeqSchema,worldRevision:RevisionSchema,
  items:z.array(PublicNarrationSchema).max(100),nextCursor:z.string().min(1).max(2048).nullable(),
});
export type PublicNarrationPage=z.infer<typeof PublicNarrationPageSchema>;
