import { z } from 'zod';
import { BackupIdSchema } from './backup.ts';
import { OperationIdSchema } from './values.ts';

/** Public control-plane receipt. Paths, credentials and principal stay private. */
export const HostRecoveryJobSchema = z.strictObject({
  kind: z.literal('host-recovery'),
  operationId: OperationIdSchema,
  backupId: BackupIdSchema,
  state: z.enum(['queued', 'running', 'succeeded', 'failed', 'interrupted', 'aborted']),
  phase: z.enum(['queued', 'staging', 'closing', 'original-preserved', 'installed', 'reopening', 'verified', 'original-retained']),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  safeCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/).nullable(),
});
export type HostRecoveryJob = z.infer<typeof HostRecoveryJobSchema>;
export const HostRecoveryOwnershipSchema = z.strictObject({
  kind: z.literal('host-recovery-ownership'), operationId: OperationIdSchema,
  directoryOperation: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('absent') }),
    z.strictObject({ kind: z.literal('present'), nonce: z.uuid(), pid: z.number().int().positive() }),
  ]),
});
export function hostRecoveryEtag(job: HostRecoveryJob) {
  return `"host-recovery:${job.operationId}:r${job.revision}"`;
}
