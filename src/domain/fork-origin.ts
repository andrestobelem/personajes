import { z } from 'zod';
import { HashSchema, OperationIdSchema, RevisionSchema, RunIdSchema, WorldSeqSchema } from './values.ts';

/** Exact immutable parent anchor. No mutable actor/world dependencies. */
export const ForkSourceSchema=z.strictObject({
  runId:RunIdSchema,commitIndex:RevisionSchema,worldRevision:RevisionSchema,worldSeq:WorldSeqSchema,
  snapshotHash:HashSchema,configurationRevision:RevisionSchema,configurationHash:HashSchema,
});
export const RunForkOriginSchema=z.strictObject({
  kind:z.literal('fork'),operationId:OperationIdSchema,source:ForkSourceSchema,
  principalId:z.string().trim().min(1).max(200),recordedAt:z.string().datetime({offset:true}),
});
