import { z } from 'zod';
import { HashSchema, JobIdSchema, RevisionSchema } from './values.ts';

export const IcmRuntimeConfigurationSourceSchema = z.enum(['saved', 'environment', 'unconfigured']);
export const IcmRuntimeConfigurationJobStateSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'interrupted']);
export const IcmRuntimeConfigurationFailureCodeSchema = z.enum([
  'configuration-stale',
  'binary-path-invalid',
  'binary-not-executable',
  'icm-version-mismatch',
  'icm-validation-failed',
  'maintenance-unavailable',
  'apply-failed',
  'cancelled',
]);

export const IcmRuntimeConfigurationViewSchema = z.strictObject({
  kind: z.literal('icm-runtime-configuration'),
  revision: RevisionSchema,
  configuredBinaryPath: z.string().min(1).max(4_096).nullable(),
  source: IcmRuntimeConfigurationSourceSchema,
});

export const IcmRuntimeConfigurationRequestSchema = z.strictObject({
  binaryPath: z.string().min(1).max(4_096).refine(path => !path.includes('\0')).nullable(),
  expectedRevision: RevisionSchema,
  idempotencyKey: z.uuid(),
  principalId: z.string().min(1).max(120),
});

export const IcmRuntimeConfigurationJobSchema = z.strictObject({
  kind: z.literal('icm-runtime-configuration-job'),
  jobId: JobIdSchema,
  principalId: z.string().min(1).max(120),
  state: IcmRuntimeConfigurationJobStateSchema,
  revision: RevisionSchema,
  expectedConfigurationRevision: RevisionSchema,
  binaryPath: z.string().min(1).max(4_096).refine(path => !path.includes('\0')).nullable(),
  requestHash: HashSchema,
  failureCode: IcmRuntimeConfigurationFailureCodeSchema.nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
});

export const IcmRuntimeConfigurationStartResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('accepted'), job: IcmRuntimeConfigurationJobSchema }),
  z.strictObject({ kind: z.literal('existing'), job: IcmRuntimeConfigurationJobSchema }),
  z.strictObject({ kind: z.literal('idempotency-conflict') }),
  z.strictObject({ kind: z.literal('rejected'), code: z.literal('configuration-stale'), current: IcmRuntimeConfigurationViewSchema }),
]);

export const IcmRuntimeConfigurationJobPageSchema = z.strictObject({
  jobs: z.array(IcmRuntimeConfigurationJobSchema).max(100),
  nextCursor: z.string().min(1).max(240).nullable(),
});

export type IcmRuntimeConfigurationSource = z.infer<typeof IcmRuntimeConfigurationSourceSchema>;
export type IcmRuntimeConfigurationView = z.infer<typeof IcmRuntimeConfigurationViewSchema>;
export type IcmRuntimeConfigurationRequest = z.infer<typeof IcmRuntimeConfigurationRequestSchema>;
export type IcmRuntimeConfigurationJob = z.infer<typeof IcmRuntimeConfigurationJobSchema>;
export type IcmRuntimeConfigurationFailureCode = z.infer<typeof IcmRuntimeConfigurationFailureCodeSchema>;
export type IcmRuntimeConfigurationStartResult = z.infer<typeof IcmRuntimeConfigurationStartResultSchema>;
export type IcmRuntimeConfigurationJobPage = z.infer<typeof IcmRuntimeConfigurationJobPageSchema>;

export function icmRuntimeConfigurationEtag(view: IcmRuntimeConfigurationView): string {
  const parsed = IcmRuntimeConfigurationViewSchema.parse(view);
  return `\"icm-runtime-configuration:r${parsed.revision}\"`;
}

export function icmRuntimeConfigurationJobEtag(job: IcmRuntimeConfigurationJob): string {
  const parsed = IcmRuntimeConfigurationJobSchema.parse(job);
  return `\"icm-runtime-configuration-job:${parsed.jobId}:r${parsed.revision}\"`;
}
