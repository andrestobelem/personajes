import {z} from 'zod';
import {DossierSourceReferenceSchema} from './dossier-source.ts';
import {PreparationConfiguratorJobSchema,PreparationConfiguratorScopeSchema,PreparationConfiguratorAppliedSchema as PreparationConfiguratorApplyReceiptSchema} from './preparation-configurator-job-schema.ts';
import {PreparationConfiguratorSelectionSchema} from './preparation-configurator-selection.ts';
import {PreparationConfiguratorProposalSchema,PreparationConfiguratorRequestSchema} from './preparation-configurator.ts';
import {HashSchema,JobIdSchema,RevisionSchema,RunIdSchema,SourceRefIdSchema} from './values.ts';

export const PreparationConfiguratorCreateBodySchema=PreparationConfiguratorRequestSchema.pick({draftRevision:true,draftHash:true,instructions:true,actorSources:true,documentIds:true});
export const PreparationConfiguratorPublicJobSchema=PreparationConfiguratorJobSchema.omit({principalId:true}).extend({failureCode:z.string().regex(/^PREPARATION_CONFIGURATOR_[A-Z_]{1,90}$/).nullable()});
export type PreparationConfiguratorPublicJob=z.infer<typeof PreparationConfiguratorPublicJobSchema>;
export function projectPreparationConfiguratorJob(raw:unknown):PreparationConfiguratorPublicJob{const {principalId:_principal,...job}=PreparationConfiguratorJobSchema.parse(raw);return PreparationConfiguratorPublicJobSchema.parse({...job,failureCode:job.failureCode===null?null:/^PREPARATION_CONFIGURATOR_[A-Z_]{1,90}$/.test(job.failureCode)?job.failureCode:'PREPARATION_CONFIGURATOR_INTERRUPTED'});}
export const PreparationConfiguratorChoicesSchema=z.strictObject({kind:z.literal('preparation-configurator-choices'),runId:RunIdSchema,draftRevision:RevisionSchema,draftHash:HashSchema,
  actorSources:z.array(z.strictObject({label:z.string().min(1).max(300),reference:DossierSourceReferenceSchema})).max(1000),
  documents:z.array(z.strictObject({sourceId:SourceRefIdSchema,label:z.string().min(1).max(300),fullHash:HashSchema})).max(100)});
export const PreparationConfiguratorJobPageSchema=z.strictObject({kind:z.literal('preparation-configurator-jobs'),runId:RunIdSchema,items:z.array(PreparationConfiguratorPublicJobSchema).max(1000),hasMore:z.boolean()});
export const PreparationConfiguratorPublicReviewSchema=z.strictObject({kind:z.literal('preparation-configurator-review'),job:PreparationConfiguratorPublicJobSchema,
  candidateId:z.uuid().nullable(),proposalHash:HashSchema.nullable(),proposal:PreparationConfiguratorProposalSchema.nullable()}).superRefine((review,ctx)=>{
  if(review.job.state==='accepted'?(review.candidateId===null||review.proposalHash===null||review.proposal===null):(review.candidateId!==null||review.proposalHash!==null||review.proposal!==null))ctx.addIssue({code:'custom',message:'La revisión no corresponde al estado confirmado del trabajo.'});
  if(review.proposal!==null&&review.proposal.contextHash!==review.job.scope.contextHash)ctx.addIssue({code:'custom',message:'La propuesta corresponde a otro contexto.'});
});
export const PreparationConfiguratorJobAnchorSchema=z.strictObject({scope:PreparationConfiguratorScopeSchema,revision:RevisionSchema});
export const PreparationConfiguratorIntentSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('create'),runId:RunIdSchema,idempotencyKey:z.uuid(),body:PreparationConfiguratorCreateBodySchema}),
  z.strictObject({kind:z.enum(['start','cancel']),runId:RunIdSchema,idempotencyKey:z.uuid(),job:PreparationConfiguratorJobAnchorSchema}),
]).superRefine((intent,ctx)=>{if(intent.kind!=='create'&&intent.runId!==intent.job.scope.runId)ctx.addIssue({code:'custom',message:'La operación pertenece a otra preparación.'});});
export type PreparationConfiguratorIntent=z.infer<typeof PreparationConfiguratorIntentSchema>;
export function preparationConfiguratorJobEtag(job:{scope:{jobId:string};revision:number}){return `"preparation-configurator-job:${JobIdSchema.parse(job.scope.jobId)}:r${RevisionSchema.parse(job.revision)}"`;}
export const PreparationConfiguratorApplyBodySchema=z.strictObject({candidateId:z.uuid(),proposalHash:HashSchema,draftRevision:RevisionSchema,draftHash:HashSchema,selection:PreparationConfiguratorSelectionSchema});
export const PreparationConfiguratorApplyIntentSchema=z.strictObject({runId:RunIdSchema,jobId:JobIdSchema,idempotencyKey:z.uuid(),body:PreparationConfiguratorApplyBodySchema});
export type PreparationConfiguratorApplyIntent=z.infer<typeof PreparationConfiguratorApplyIntentSchema>;
export {PreparationConfiguratorApplyReceiptSchema};
export function preparationConfiguratorDraftEtag(input:{runId:string;draftRevision:number;draftHash:string}){return `"preparation-draft:${RunIdSchema.parse(input.runId)}:r${RevisionSchema.parse(input.draftRevision)}:${HashSchema.parse(input.draftHash)}"`;}
