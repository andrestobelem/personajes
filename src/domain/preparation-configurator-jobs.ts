import { z } from 'zod';
import {PreparationConfiguratorSelectionSchema} from './preparation-configurator-selection.ts';
import { PreparationConfiguratorContextSchema, PreparationConfiguratorProposalSchema, PreparationConfiguratorRequestSchema } from './preparation-configurator.ts';
import { IcmContextPacketSchema } from './icm-workspace.ts';
import { RunBudgetSchema } from './production.ts';
import { SelectableInferenceProfileSchema } from './inference-profile.ts';
import { ConfiguratorCheckpointPurposeSchema } from './configurator-jobs.ts';
import { HashSchema, JobIdSchema, RevisionSchema, RunIdSchema } from './values.ts';
import {PreparationConfiguratorScopeSchema,PreparationConfiguratorJobSchema,PreparationConfiguratorAppliedSchema} from './preparation-configurator-job-schema.ts';
export {PreparationConfiguratorScopeSchema,PreparationConfiguratorJobSchema,PreparationConfiguratorAppliedSchema} from './preparation-configurator-job-schema.ts';

export const PreparationConfiguratorExecutionSchema = z.strictObject({ role: z.literal('preparation-configurator'),
  scope: PreparationConfiguratorScopeSchema, lease: z.strictObject({ ownerToken: z.uuid(), claimToken: z.uuid() }) });
export type PreparationConfiguratorExecution = z.infer<typeof PreparationConfiguratorExecutionSchema>;
export const PreparationConfiguratorSessionSchema = z.strictObject({ sessionId: z.string().min(1).max(200),
  sessionPath: z.string().min(1).max(2000), baseLeafId: z.string().min(1).max(200).nullable(), profile: SelectableInferenceProfileSchema });
export const PreparationConfiguratorCheckpointSchema = z.strictObject({ purpose: ConfiguratorCheckpointPurposeSchema,
  snapshot: z.strictObject({ sessionId: z.string().min(1).max(200), sessionPath: z.string().min(1).max(2000).nullable(), candidateLeafId: z.string().min(1).max(200).nullable() }) });
export const PreparationConfiguratorCandidateSchema = z.strictObject({ candidateId: z.uuid(), proposal: PreparationConfiguratorProposalSchema, candidateHash: HashSchema });
export const PreparationConfiguratorStoredSchema = z.strictObject({ job: PreparationConfiguratorJobSchema,
  context: PreparationConfiguratorContextSchema, packet: IcmContextPacketSchema,
  lease: PreparationConfiguratorExecutionSchema.shape.lease.nullable() });
export const PreparationConfiguratorCreateSchema = z.strictObject({ principalId: PreparationConfiguratorJobSchema.shape.principalId,
  idempotencyKey: z.uuid(), request: PreparationConfiguratorRequestSchema });
/** This is an accounting authority, never a WorldRun or model-generated policy. */
export const PreparationBudgetAuthoritySchema = z.strictObject({ runId: RunIdSchema, draftRevision: RevisionSchema,
  draftHash: HashSchema, budget: RunBudgetSchema, profile: SelectableInferenceProfileSchema });
export const PreparationConfiguratorTerminalProofSchema = z.strictObject({
  kind: z.literal('verified-preparation-configurator-terminal'), inputPrefixHash: HashSchema, terminalPrefixHash: HashSchema,
  fileHash: HashSchema, terminalLeafId: z.string().min(1), lastRequestSeq: RevisionSchema,
  lastInputPrefixHash: HashSchema, candidateHash: HashSchema,
});
export const PreparationConfiguratorPrefixSchema=z.strictObject({kind:z.literal('verified'),sessionPath:z.string(),sessionId:z.string(),leafId:z.string(),prefixHash:HashSchema,fileHash:HashSchema,byteLength:z.number().int().nonnegative()});
export const PreparationConfiguratorRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({kind:z.literal('session'),execution:PreparationConfiguratorExecutionSchema,value:PreparationConfiguratorSessionSchema}),
  z.strictObject({kind:z.literal('checkpoint'),execution:PreparationConfiguratorExecutionSchema,value:PreparationConfiguratorCheckpointSchema,prefix:PreparationConfiguratorPrefixSchema.nullable()}),
  z.strictObject({kind:z.literal('candidate'),execution:PreparationConfiguratorExecutionSchema,value:PreparationConfiguratorCandidateSchema}),
  z.strictObject({kind:z.literal('accepted-proof'),execution:PreparationConfiguratorExecutionSchema,value:PreparationConfiguratorTerminalProofSchema}),
]);
export const PreparationConfiguratorMutationSchema=z.strictObject({principalId:PreparationConfiguratorJobSchema.shape.principalId,
  jobId:JobIdSchema,expectedRevision:RevisionSchema,idempotencyKey:z.uuid()});
export const PreparationConfiguratorListSchema=z.strictObject({principalId:PreparationConfiguratorJobSchema.shape.principalId,
  runId:RunIdSchema,limit:z.number().int().min(1).max(100).default(50),offset:z.number().int().nonnegative().max(100000).default(0)});
export const PreparationConfiguratorPageSchema=z.strictObject({items:z.array(PreparationConfiguratorJobSchema),hasMore:z.boolean()});
export const PreparationConfiguratorStartResultSchema=z.strictObject({kind:z.enum(['started','existing']),job:PreparationConfiguratorJobSchema});
export const PreparationConfiguratorApplyReceiptSchema=PreparationConfiguratorAppliedSchema;
export const PreparationConfiguratorApplySchema=PreparationConfiguratorMutationSchema.extend({candidateId:z.uuid(),proposalHash:HashSchema,expectedDraftRevision:RevisionSchema,expectedDraftHash:HashSchema,selection:PreparationConfiguratorSelectionSchema});
export const PreparationConfiguratorOperationSchema=z.discriminatedUnion('operationKind',[
  z.strictObject({operationKind:z.literal('create'),request:PreparationConfiguratorCreateSchema,result:PreparationConfiguratorJobSchema}),
  z.strictObject({operationKind:z.literal('start'),request:PreparationConfiguratorMutationSchema,result:PreparationConfiguratorStartResultSchema.extend({kind:z.literal('started')})}),
  z.strictObject({operationKind:z.literal('cancel'),request:PreparationConfiguratorMutationSchema,result:PreparationConfiguratorJobSchema}),
  z.strictObject({operationKind:z.literal('apply'),request:PreparationConfiguratorApplySchema,result:PreparationConfiguratorAppliedSchema}),
]);
