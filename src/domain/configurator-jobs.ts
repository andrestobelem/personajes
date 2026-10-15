import { z } from 'zod';
import { ConfiguratorContextSchema,ConfiguratorEvolutionRunScopeSchema,ConfiguratorProposalSchema } from './configurator.ts';
import { ForkSourceSchema } from './fork-origin.ts';
import { CharacterIdSchema,HashSchema,RevisionSchema,RunIdSchema } from './values.ts';
const PrincipalSchema=z.string().trim().min(1).max(200);
export const ConfiguratorJobStateSchema=z.enum(['queued','running','accepted','failed','interrupted','cancelled','rejected']);
export const ConfiguratorJobViewSchema=z.strictObject({kind:z.literal('configurator-job'),jobId:z.uuid(),principalId:PrincipalSchema,runId:RunIdSchema,actorId:CharacterIdSchema,generation:RevisionSchema,revision:RevisionSchema,state:ConfiguratorJobStateSchema,source:ForkSourceSchema,contextHash:HashSchema,failureCode:z.string().min(1).max(120).nullable(),createdAt:RevisionSchema,updatedAt:RevisionSchema});
export type ConfiguratorJobView=z.infer<typeof ConfiguratorJobViewSchema>;
export const ConfiguratorJobExecutionSchema=z.strictObject({role:z.literal('configurator'),scope:ConfiguratorEvolutionRunScopeSchema,contextHash:HashSchema,lease:z.strictObject({ownerToken:z.uuid(),claimToken:z.uuid()})});
export type ConfiguratorJobExecution=z.infer<typeof ConfiguratorJobExecutionSchema>;
export const ConfiguratorJobStoredSchema=z.strictObject({job:ConfiguratorJobViewSchema,context:ConfiguratorContextSchema,lifecycleRevision:RevisionSchema,lease:ConfiguratorJobExecutionSchema.shape.lease.nullable()});
export const ConfiguratorJobSessionSchema=z.strictObject({execution:ConfiguratorJobExecutionSchema,sessionId:z.string().min(1).max(200),sessionPath:z.string().min(1).max(2000),baseLeafId:z.string().min(1).max(200).nullable(),profile:ConfiguratorEvolutionRunScopeSchema.shape.profile});
export const ConfiguratorCheckpointPurposeSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('job-base')}),z.strictObject({kind:z.literal('request-input'),requestSeq:RevisionSchema}),
 z.strictObject({kind:z.literal('terminal-candidate'),outcome:z.enum(['completed','failed','aborted']),lastRequestSeq:RevisionSchema.nullable()}),
]);
export const ConfiguratorCheckpointSchema=z.strictObject({execution:ConfiguratorJobExecutionSchema,purpose:ConfiguratorCheckpointPurposeSchema,snapshot:z.strictObject({sessionId:z.string().min(1).max(200),sessionPath:z.string().min(1).max(2000).nullable(),candidateLeafId:z.string().min(1).max(200).nullable()})});
export const ConfiguratorCandidateSchema=z.strictObject({execution:ConfiguratorJobExecutionSchema,candidateId:z.uuid(),candidateHash:HashSchema,proposal:ConfiguratorProposalSchema});
