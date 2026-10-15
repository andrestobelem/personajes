import { z } from 'zod';
import { ConfiguratorApprovalSchema, ConfiguratorContextSchema, ConfiguratorProposalSchema } from './configurator.ts';
import { ForkSourceSchema } from './fork-origin.ts';
import { CharacterIdSchema, HashSchema, RevisionSchema, RunIdSchema } from './values.ts';

export const IdentityPromotionRequestSchema=z.strictObject({
 principalId:z.string().trim().min(1).max(200),idempotencyKey:z.uuid(),
 expectedLifecycleRevision:RevisionSchema,expectedCommitIndex:RevisionSchema,expectedWorldRevision:RevisionSchema,
 context:ConfiguratorContextSchema,proposal:ConfiguratorProposalSchema,approval:ConfiguratorApprovalSchema,
});
export const IdentityPromotionAuthorityRequestSchema=z.strictObject({
 principalId:IdentityPromotionRequestSchema.shape.principalId,runId:RunIdSchema,actorId:CharacterIdSchema,
 contextHash:HashSchema,proposalHash:HashSchema,approvalHash:HashSchema,approval:ConfiguratorApprovalSchema,
});
export const AcceptedConfiguratorProposalSchema=IdentityPromotionAuthorityRequestSchema.omit({approval:true}).extend({
 kind:z.literal('accepted-configurator-proposal'),jobId:z.uuid(),candidateHash:HashSchema,
});
export type IdentityPromotionPorts={
 requireAcceptedConfiguratorProposal(input:z.infer<typeof IdentityPromotionAuthorityRequestSchema>):z.infer<typeof AcceptedConfiguratorProposalSchema>;
 assertIdentityPromotionRuntimeIdle(input:{runId:z.infer<typeof RunIdSchema>}):void;
};
export const ActorIdentityEpochSchema=z.strictObject({
 runId:RunIdSchema,actorId:CharacterIdSchema,epochIndex:RevisionSchema,
 activationCommitIndex:RevisionSchema,configurationRevision:RevisionSchema,configurationHash:HashSchema,
 identityVersion:RevisionSchema,preparedContextHash:HashSchema,createdAt:z.string().datetime({offset:true}),
});
export const IdentityPromotionReceiptSchema=z.strictObject({
 kind:z.literal('identity-promotion-receipt'),operationId:z.uuid(),principalId:IdentityPromotionRequestSchema.shape.principalId,
 actorId:CharacterIdSchema,source:ForkSourceSchema,target:ForkSourceSchema,
 previousIdentityVersion:RevisionSchema,identityVersion:RevisionSchema,epochIndex:RevisionSchema,
 lifecycleRevision:RevisionSchema,contextHash:HashSchema,proposalHash:HashSchema,
 approval:ConfiguratorApprovalSchema,authority:AcceptedConfiguratorProposalSchema,recordedAt:z.string().datetime({offset:true}),
});
export const IdentityPromotionResultSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('applied'),receipt:IdentityPromotionReceiptSchema}),
 z.strictObject({kind:z.literal('existing'),receipt:IdentityPromotionReceiptSchema}),
]);
