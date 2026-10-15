import { z } from 'zod';
import { OperationIdSchema, RevisionSchema, RunIdSchema } from './values.ts';
import { ForkSourceSchema } from './fork-origin.ts';
const identity={
 operationId:OperationIdSchema,principalId:z.string().trim().min(1).max(200),idempotencyKey:z.string().uuid(),
 targetRunId:RunIdSchema,source:ForkSourceSchema,name:z.string().trim().min(1).max(120),reason:z.string().trim().min(1).max(4000),
 audioDerivation:z.strictObject({kind:z.literal('initial-ready-configuration'),sourceConfigurationHash:z.string().regex(/^[0-9a-f]{64}$/),effectiveHistory:z.literal('not-reconstructed'),bindingState:z.enum(['unbound','not-required'])}),
 revision:RevisionSchema,createdAt:z.number().int().nonnegative(),updatedAt:z.number().int().nonnegative(),
};
export const ForkJobFailureCodeSchema=z.enum(['FORK_MEMORY_FAILED','FORK_ARTIFACTS_INVALID','FORK_SOURCE_INVALID','FORK_PUBLICATION_FAILED','FORK_INTERRUPTED']);
export const ForkJobSchema=z.discriminatedUnion('state',[
 z.strictObject({...identity,state:z.literal('staging')}),
 z.strictObject({...identity,state:z.literal('ready'),publishedAt:z.number().int().nonnegative()}),
 z.strictObject({...identity,state:z.literal('failed'),code:ForkJobFailureCodeSchema}),
]);
export type ForkJob=z.infer<typeof ForkJobSchema>;

export const ForkArtifactManifestSchema=z.strictObject({
 kind:z.literal('fork-artifacts'),operationId:OperationIdSchema,targetRunId:RunIdSchema,
 packageHash:z.string().regex(/^[0-9a-f]{64}$/),
 actors:z.array(z.strictObject({actorId:z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),sha256:z.string().regex(/^[0-9a-f]{64}$/),byteLength:z.number().int().positive()})),
});
