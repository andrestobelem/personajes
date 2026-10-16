import {z} from 'zod';
import {HashSchema,JobIdSchema,RevisionSchema,RunIdSchema} from './values.ts';

/** Browser-safe metadata only. Stored contexts, leases, packets and physical
 * session integrity belong to the host's preparation-configurator-jobs module. */
export const PreparationConfiguratorScopeSchema=z.strictObject({runId:RunIdSchema,jobId:JobIdSchema,generation:RevisionSchema,draftRevision:RevisionSchema,draftHash:HashSchema,contextHash:HashSchema});
export const PreparationConfiguratorJobSchema=z.strictObject({kind:z.literal('preparation-configurator-job'),principalId:z.string().trim().min(1).max(200),scope:PreparationConfiguratorScopeSchema,revision:RevisionSchema,state:z.enum(['queued','running','accepted','blocked','interrupted','cancelled']),failureCode:z.string().min(1).max(120).nullable(),createdAt:RevisionSchema,updatedAt:RevisionSchema});
export const PreparationConfiguratorAppliedSchema=z.strictObject({kind:z.literal('preparation-configurator-applied'),jobId:JobIdSchema,runId:RunIdSchema,candidateId:z.uuid(),proposalHash:HashSchema,baseDraftRevision:RevisionSchema,baseDraftHash:HashSchema,draftRevision:RevisionSchema,draftHash:HashSchema,selectionHash:HashSchema});
