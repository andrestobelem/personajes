import { z } from 'zod';
import { CharacterIdSchema, HashSchema, RunIdSchema, RevisionSchema } from './values.ts';
import { SceneIdSchema } from './world-schema.ts';

export const DirectionScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('run') }),
  z.strictObject({ kind: z.literal('scene'), sceneId: SceneIdSchema }),
]);

export const MetaIndicationPayloadSchema = z.strictObject({
  kind: z.literal('metaIndication'),
  recipients: z.array(CharacterIdSchema).min(1).max(100).refine((ids) => new Set(ids).size === ids.length),
  text: z.string().trim().min(1).max(4_000),
  scope: DirectionScopeSchema,
});

export const MetaIndicationEventSchema = z.strictObject({
  runId: RunIdSchema,
  directionRevision: RevisionSchema,
  operationId: z.string().uuid(),
  principalId: z.string().trim().min(1).max(200),
  payload: MetaIndicationPayloadSchema,
  payloadHash: HashSchema,
  worldRevision: RevisionSchema,
  worldSeq: RevisionSchema,
  commitIndex: RevisionSchema,
  recordedAt: z.number().int().nonnegative(),
});

export const DirectionCommandWriteSchema = z.strictObject({
  runId: RunIdSchema,
  principalId: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().uuid(),
  operationId: z.string().uuid(),
  expectedDirectionRevision: RevisionSchema,
  payload: MetaIndicationPayloadSchema,
});

export const DirectionReceiptSchema = z.strictObject({
  operationId: z.string().uuid(),
  directionRevision: RevisionSchema,
  recordedAt: z.number().int().nonnegative(),
});

export const DirectionMutationResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('stored'), receipt: DirectionReceiptSchema }),
  z.strictObject({ kind: z.literal('existing'), receipt: DirectionReceiptSchema }),
  z.strictObject({ kind: z.literal('conflict'), directionRevision: RevisionSchema }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('invalidState'), code: z.enum(['runNotActive', 'invalidRecipient', 'sceneNotActive', 'sceneRecipientMismatch']) }),
  z.strictObject({ kind: z.literal('idempotencyConflict') }),
]);

export const DirectionLookupSchema = z.strictObject({ runId: RunIdSchema, principalId: z.string().trim().min(1).max(200), idempotencyKey: z.string().uuid() });
export const DirectionLookupResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('found'), result: DirectionMutationResultSchema }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('idempotencyConflict') }),
]);

export const DirectionEventsQuerySchema = z.strictObject({ runId: RunIdSchema, afterDirectionRevision: RevisionSchema.default(() => RevisionSchema.parse(0)), limit: z.number().int().min(1).max(1_000).default(100) });
export const DirectionEventsPageSchema = z.strictObject({ events: z.array(MetaIndicationEventSchema).max(1_000), directionRevision: RevisionSchema, hasMore: z.boolean() });

export const ActorDirectionContextSchema = z.strictObject({ directionRevision: RevisionSchema.default(() => RevisionSchema.parse(0)), indications: z.array(MetaIndicationPayloadSchema).max(1_000) });
