import {z} from 'zod';
import {ChangeCircumstancePayloadSchema,DirectionScopeSchema} from './direction-indications.ts';
import {CharacterIdSchema,RevisionSchema,RunIdSchema,WorldSeqSchema,EventIdSchema} from './values.ts';
import {CircumstanceRejectionReasonSchema,WorldSnapshotSchema} from './world-schema.ts';

export const CircumstanceWriteSchema=z.strictObject({
  runId:RunIdSchema,principalId:z.string().trim().min(1).max(200),idempotencyKey:z.uuid(),operationId:z.uuid(),
  expectedWorldRevision:RevisionSchema,expectedDirectionRevision:RevisionSchema,payload:ChangeCircumstancePayloadSchema,
});
export const CircumstanceReceiptSchema=z.strictObject({
  operationId:z.uuid(),directionRevision:RevisionSchema,recordedAt:z.number().int().nonnegative(),
  worldRevision:RevisionSchema,worldSeq:WorldSeqSchema,commitIndex:RevisionSchema,
  effect:z.discriminatedUnion('kind',[
    z.strictObject({kind:z.literal('applied'),eventIds:z.array(EventIdSchema).min(1).max(100),recipientActorIds:z.array(CharacterIdSchema).max(100)}),
    z.strictObject({kind:z.literal('unchanged')}),
  ]),
});
export const CircumstanceMutationResultSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('stored'),receipt:CircumstanceReceiptSchema}),
  z.strictObject({kind:z.literal('existing'),receipt:CircumstanceReceiptSchema}),
  z.strictObject({kind:z.literal('conflict'),worldRevision:RevisionSchema,directionRevision:RevisionSchema}),
  z.strictObject({kind:z.literal('missing')}),
  z.strictObject({kind:z.literal('idempotencyConflict')}),
  z.strictObject({kind:z.literal('invalidState'),code:z.union([CircumstanceRejectionReasonSchema,z.enum(['runNotActive','workPending'])])}),
]);
// This operator-only view includes physical catalogue choices, never minds,
// histories, actor knowledge, prompts, credentials or private memories.
export const CircumstanceOptionsSchema=z.strictObject({
  runId:RunIdSchema,worldRevision:RevisionSchema,directionRevision:RevisionSchema,
  lifecycle:z.enum(['draft','ready','running','paused','stopped','closed']),
  activeSceneId:WorldSnapshotSchema.shape.activeSceneId,scope:DirectionScopeSchema,
  places:WorldSnapshotSchema.shape.places,doors:WorldSnapshotSchema.shape.doors,
  connections:WorldSnapshotSchema.shape.connections,
  devices:z.array(z.strictObject({entityId:z.uuid(),label:z.string(),placeId:z.string(),availability:z.enum(['available','unavailable'])})).max(100_000),
  catalog:WorldSnapshotSchema.shape.circumstanceCatalog,
  environment:WorldSnapshotSchema.shape.environment,
});
export const CircumstanceOptionsRequestSchema=z.strictObject({runId:RunIdSchema,scope:DirectionScopeSchema});
