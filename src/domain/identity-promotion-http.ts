import {z} from 'zod';
import {ConfiguratorJobViewSchema} from './configurator-jobs.ts';
import {ConfiguratorContextSchema,ConfiguratorProposalSchema} from './configurator.ts';
import {IdentityPromotionReceiptSchema} from './identity-promotion.ts';
import {CharacterIdSchema,HashSchema,RevisionSchema,RunIdSchema,WorldSeqSchema} from './values.ts';

export const IdentityPromotionHeadSchema=z.strictObject({runId:RunIdSchema,lifecycle:z.enum(['ready','running','paused','stopped','closed']),lifecycleRevision:RevisionSchema,commitIndex:RevisionSchema,worldRevision:RevisionSchema,worldSeq:WorldSeqSchema,configurationRevision:RevisionSchema});
export const IdentityPromotionContextViewSchema=IdentityPromotionHeadSchema.extend({kind:z.literal('identity-promotion-context'),canWrite:z.boolean(),inspectionAllowed:z.boolean(),eligibleActors:z.array(z.strictObject({actorId:CharacterIdSchema,label:z.string().min(1).max(200),identityVersion:RevisionSchema})).max(1000)});
export const IdentityPromotionPublicReceiptSchema=IdentityPromotionReceiptSchema.omit({principalId:true,approval:true,authority:true});
export const IdentityPromotionJobViewSchema=ConfiguratorJobViewSchema.omit({principalId:true}).extend({failureCode:z.string().regex(/^[A-Z][A-Z0-9_]{1,119}$/).nullable(),promotion:z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('not-applied')}),z.strictObject({kind:z.literal('applied'),receipt:IdentityPromotionPublicReceiptSchema}),
])});
export const IdentityPromotionJobPageSchema=z.strictObject({kind:z.literal('identity-promotion-jobs'),items:z.array(IdentityPromotionJobViewSchema).max(1000),hasMore:z.boolean()});
export const IdentityPromotionReviewSchema=z.strictObject({kind:z.literal('identity-promotion-review'),job:IdentityPromotionJobViewSchema,context:ConfiguratorContextSchema,proposal:ConfiguratorProposalSchema.options[1].nullable(),candidateHash:HashSchema.nullable(),proposalHash:HashSchema.nullable(),targetFullHash:HashSchema});
export const IdentityPromotionStartBodySchema=z.strictObject({actorId:CharacterIdSchema,expectedLifecycleRevision:RevisionSchema,expectedCommitIndex:RevisionSchema,expectedWorldRevision:RevisionSchema,expectedWorldSeq:WorldSeqSchema,expectedConfigurationRevision:RevisionSchema});
export const IdentityPromotionApproveBodySchema=z.strictObject({contextHash:HashSchema,proposalHash:HashSchema,targetFullHash:HashSchema,expectedLifecycleRevision:RevisionSchema,expectedCommitIndex:RevisionSchema,expectedWorldRevision:RevisionSchema});
export function identityPromotionContextEtag(head:Omit<z.input<typeof IdentityPromotionHeadSchema>,'lifecycle'>){return `"identity-promotion-context:${head.runId}:c${head.commitIndex}:w${head.worldRevision}:s${head.worldSeq}:l${head.lifecycleRevision}:v${head.configurationRevision}"`;}
export function identityPromotionJobEtag(job:{jobId:string;revision:number}){return `"configurator-job:${job.jobId}:r${job.revision}"`;}
export type IdentityPromotionJobView=z.infer<typeof IdentityPromotionJobViewSchema>;
export type IdentityPromotionReview=z.infer<typeof IdentityPromotionReviewSchema>;
