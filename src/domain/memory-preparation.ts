import { z } from 'zod';
import { CharacterIdSchema, HashSchema, JobIdSchema, RevisionSchema, RunIdSchema } from './values.ts';

export const MemoryPreparationStateSchema = z.enum(['queued', 'running', 'completed', 'failed', 'interrupted']);
export const MemoryPreparationActorStateSchema = z.enum(['pending', 'initialized', 'existing', 'failed']);
export const MemoryPreparationFailureCodeSchema = z.enum([
  'binary-not-configured',
  'run-not-ready',
  'source-stale',
  'run-already-lived',
  'memory-missing',
  'memory-invalid',
  'maintenance-unavailable',
  'icm-unavailable',
  'initialization-failed',
  'cancelled',
]);

export const MemoryPreparationRequestSchema = z.strictObject({
  runId: RunIdSchema,
  expectedConfigurationRevision: RevisionSchema,
  expectedWorldRevision: RevisionSchema,
  idempotencyKey: z.uuid(),
  principalId: z.string().min(1).max(120),
});

export const MemoryPreparationActorResultSchema = z.strictObject({
  actorId: CharacterIdSchema,
  state: MemoryPreparationActorStateSchema,
});

export const MemoryPreparationJobSchema = z.strictObject({
  kind: z.literal('memory-preparation-job'),
  jobId: JobIdSchema,
  runId: RunIdSchema,
  principalId: z.string().min(1).max(120),
  state: MemoryPreparationStateSchema,
  purpose: z.enum(['initialize-empty', 'reopen-existing']),
  revision: RevisionSchema,
  expectedConfigurationRevision: RevisionSchema,
  expectedWorldRevision: RevisionSchema,
  configurationHash: HashSchema,
  contextETag: z.string().min(1).max(240),
  actors: z.array(MemoryPreparationActorResultSchema).max(1_000),
  failureCode: MemoryPreparationFailureCodeSchema.nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
});

export const MemoryPreparationStartResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('accepted'), job: MemoryPreparationJobSchema }),
  z.strictObject({ kind: z.literal('existing'), job: MemoryPreparationJobSchema }),
  z.strictObject({ kind: z.literal('idempotency-conflict') }),
  z.strictObject({ kind: z.literal('rejected'), code: z.enum([
    'binary-not-configured', 'run-not-ready', 'source-stale', 'run-already-lived', 'memory-missing', 'memory-invalid',
  ]) }),
]);

export const MemoryPreparationJobPageSchema = z.strictObject({
  jobs: z.array(MemoryPreparationJobSchema).max(100),
  nextCursor: z.string().min(1).max(240).nullable(),
});

export type MemoryPreparationRequest = z.infer<typeof MemoryPreparationRequestSchema>;
export type MemoryPreparationState = z.infer<typeof MemoryPreparationStateSchema>;
export type MemoryPreparationActorResult = z.infer<typeof MemoryPreparationActorResultSchema>;
export type MemoryPreparationFailureCode = z.infer<typeof MemoryPreparationFailureCodeSchema>;
export type MemoryPreparationJob = z.infer<typeof MemoryPreparationJobSchema>;
export type MemoryPreparationStartResult = z.infer<typeof MemoryPreparationStartResultSchema>;
export type MemoryPreparationJobPage = z.infer<typeof MemoryPreparationJobPageSchema>;

export function memoryPreparationContextEtag(input: {
  runId: z.infer<typeof RunIdSchema>;
  expectedConfigurationRevision: z.infer<typeof RevisionSchema>;
  expectedWorldRevision: z.infer<typeof RevisionSchema>;
}): string {
  const parsed = z.strictObject({
    runId: RunIdSchema,
    expectedConfigurationRevision: RevisionSchema,
    expectedWorldRevision: RevisionSchema,
  }).parse(input);
  return `"memory-preparation:${parsed.runId}:c${parsed.expectedConfigurationRevision}:w${parsed.expectedWorldRevision}"`;
}

export function memoryPreparationJobEtag(job: MemoryPreparationJob): string {
  const parsed = MemoryPreparationJobSchema.parse(job);
  return `"memory-preparation-job:${parsed.jobId}:r${parsed.revision}"`;
}
