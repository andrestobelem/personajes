import { z } from 'zod';
import { AdministrativeRoleSchema, AdministrativeRunScopeSchema, DirectorAnnotationSchema, DirectorContextSchema, DirectorObservationSchema } from './admin-roles.ts';
import { HashSchema, JobIdSchema, RevisionSchema, RunIdSchema, PulseIdSchema } from './values.ts';
import { SelectableInferenceProfileSchema } from './inference-profile.ts';

export const AdministrativeJobFailureSchema = z.enum(['cancelled','execution-failed','job-inactive','recovery-required','terminal-incomplete','observation-missing','memory-unavailable','budget-exhausted']);
export const AdministrativeJobExecutionSchema = z.strictObject({role:AdministrativeRoleSchema,scope:AdministrativeRunScopeSchema,contextHash:HashSchema,
  lease:z.strictObject({ownerToken:z.string().uuid(),claimToken:z.string().uuid()})});
export const AdministrativeJobViewSchema = z.strictObject({runId:RunIdSchema,pulseId:PulseIdSchema,jobId:JobIdSchema,generation:RevisionSchema,
  role:AdministrativeRoleSchema,lifecycleRevision:RevisionSchema,worldRevision:RevisionSchema,throughWorldSeq:RevisionSchema,contextHash:HashSchema,
  state:z.enum(['running','accepted','blocked']),failureCode:AdministrativeJobFailureSchema.nullable(),createdAt:RevisionSchema,updatedAt:RevisionSchema});
export const AdministrativeJobLookupSchema = z.strictObject({jobId:JobIdSchema,generation:RevisionSchema});
export const DirectorJobBeginSchema = z.strictObject({runId:RunIdSchema,pulseId:PulseIdSchema,ownerToken:z.string().uuid(),claimToken:z.string().uuid()});
export const DirectorJobBeginResultSchema = z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('inactive')}),
  z.strictObject({kind:z.literal('busy'),job:AdministrativeJobViewSchema}),
  z.strictObject({kind:z.literal('blocked'),job:AdministrativeJobViewSchema}),
  z.strictObject({kind:z.enum(['created','existing']),job:AdministrativeJobViewSchema,execution:AdministrativeJobExecutionSchema,context:DirectorContextSchema}),
]);
export const AdministrativeSessionSchema = z.strictObject({jobId:JobIdSchema,generation:RevisionSchema,role:AdministrativeRoleSchema,
  contextHash:HashSchema,sessionId:z.string().min(1).max(200),sessionPath:z.string().min(1),baseLeafId:z.string().min(1).nullable(),profile:SelectableInferenceProfileSchema});
export const AdministrativeCheckpointSchema = z.strictObject({execution:AdministrativeJobExecutionSchema,
  purpose:z.discriminatedUnion('kind',[
    z.strictObject({kind:z.literal('job-base')}),z.strictObject({kind:z.literal('request-input'),requestSeq:RevisionSchema}),
    z.strictObject({kind:z.literal('terminal-candidate'),outcome:z.enum(['completed','aborted','failed']),lastRequestSeq:RevisionSchema.nullable()}),
  ]),snapshot:z.strictObject({sessionId:z.string().min(1).max(200),sessionPath:z.string().min(1).nullable(),candidateLeafId:z.string().min(1).nullable()})});
export const DirectorCandidateSchema = z.strictObject({candidateHash:HashSchema,execution:AdministrativeJobExecutionSchema,observation:DirectorObservationSchema});
export const DirectorJobReceiptSchema = z.strictObject({annotation:DirectorAnnotationSchema,acceptedAt:RevisionSchema});
export type AdministrativeJobExecution=z.infer<typeof AdministrativeJobExecutionSchema>;

export { NarratorContextSchema } from './narration.ts';
import { NarratorContextSchema, NarrationProposalSchema, NarrationPublicationSchema } from './narration.ts';
export const NarratorJobBeginSchema=DirectorJobBeginSchema;
export const NarratorJobBeginResultSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('inactive')}),z.strictObject({kind:z.literal('busy'),job:AdministrativeJobViewSchema}),
  z.strictObject({kind:z.literal('blocked'),job:AdministrativeJobViewSchema}),
  z.strictObject({kind:z.enum(['created','existing']),job:AdministrativeJobViewSchema,execution:AdministrativeJobExecutionSchema,context:NarratorContextSchema}),
]);
export const NarratorJournalCandidateSchema=z.strictObject({candidateHash:HashSchema,execution:AdministrativeJobExecutionSchema,proposal:NarrationProposalSchema});
export const NarratorJobReceiptSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('published'),publication:NarrationPublicationSchema}),
  z.strictObject({kind:z.literal('abstained'),scope:AdministrativeRunScopeSchema,contextHash:HashSchema,proposalHash:HashSchema,proposal:NarrationProposalSchema.options[1],acceptedAt:RevisionSchema}),
]);
