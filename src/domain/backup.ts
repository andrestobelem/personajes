import { z } from 'zod';
import { HashSchema, OperationIdSchema, RunIdSchema } from './values.ts';

export const BackupIdSchema = z.uuid().brand<'BackupId'>();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const BackupPathSchema = z.string().max(500).refine(value =>
  value === 'world.sqlite' || /^runs\/[0-9a-f-]{36}\/fork-owner\.json$/.test(value) || /^forks\/[0-9a-f-]{36}\/(package\.json|artifacts\.json|staging\/runs\/[0-9a-f-]{36}\/(fork-owner\.json|actors\/[a-z0-9-]{1,80}\/(memory\.sqlite(?:-wal)?|icm-config\.toml)))$/.test(value) || /^runs\/[0-9a-f-]{36}\/(actors\/[a-z0-9-]{1,80}\/(memory\.sqlite(?:-wal)?|icm-config\.toml|sessions\/[A-Za-z0-9_-]+\.jsonl)|roles\/[a-z0-9-]+\/sessions\/[A-Za-z0-9_-]+\.jsonl)$/.test(value) || /^media\/[0-9a-f-]{36}\.(mp3|wav|ogg|json|bin)$/.test(value),
  'BACKUP_PATH_NOT_ALLOWED');
export const BackupFenceSchema = z.strictObject({ runId: RunIdSchema, commitIndex: count, worldRevision: count, lastSeq: count, snapshotHash: HashSchema });
export const BackupManifestSchema = z.strictObject({
  format: z.literal('personajes-backup'), version: z.literal(1), backupId: BackupIdSchema,
  lineageId: z.uuid(), createdAt: count, journalVersion: count,
  originRootHash:HashSchema.optional(),
  fences: z.array(BackupFenceSchema).max(100000),
  files: z.array(z.strictObject({ path: BackupPathSchema, bytes: count, sha256: HashSchema })).max(100000),
}).superRefine((value, ctx) => {
  if (new Set(value.files.map(file => file.path)).size !== value.files.length || value.files.filter(file => file.path === 'world.sqlite').length !== 1)
    ctx.addIssue({ code: 'custom', message: 'BACKUP_MANIFEST_FILES_INVALID' });
  if (new Set(value.fences.map(fence => fence.runId)).size !== value.fences.length)
    ctx.addIssue({ code: 'custom', message: 'BACKUP_MANIFEST_FENCES_INVALID' });
});
export type BackupManifest = z.infer<typeof BackupManifestSchema>;
export const BackupJobSchema = z.strictObject({ backupId: BackupIdSchema, revision: count,
  state: z.enum(['running', 'succeeded', 'failed', 'interrupted']), safeCode: z.string().nullable(), manifestHash: HashSchema.nullable() });
export const RestoreSelectionSchema=z.discriminatedUnion('mode',[
  z.strictObject({mode:z.literal('recover')}),
  z.strictObject({mode:z.literal('fork'),sourceRunId:RunIdSchema,name:z.string().trim().min(1).max(120),reason:z.string().trim().min(1).max(4000)}),
]);
export const RestoreIntentSchema=z.strictObject({operationId:OperationIdSchema,principalId:z.string().trim().min(1).max(200),selection:RestoreSelectionSchema,idempotencyKey:z.uuid(),externalRegistrationId:z.uuid().optional()});
export const RestorePreviewRequestSchema=z.discriminatedUnion('mode',[
 z.strictObject({backupId:BackupIdSchema,externalRegistrationId:z.uuid().optional(),principalId:RestoreIntentSchema.shape.principalId,idempotencyKey:z.uuid().optional(),...RestoreSelectionSchema.options[0].shape}),
 z.strictObject({backupId:BackupIdSchema,externalRegistrationId:z.uuid().optional(),principalId:RestoreIntentSchema.shape.principalId,idempotencyKey:z.uuid().optional(),...RestoreSelectionSchema.options[1].shape}),
]);
export const RestoreApplyRequestSchema=z.strictObject({previewToken:z.uuid(),confirmDiffHash:HashSchema,principalId:RestoreIntentSchema.shape.principalId,backupId:BackupIdSchema.optional(),externalRegistrationId:z.uuid().optional()});

export const RestorePreviewSchema = z.strictObject({ backupId: BackupIdSchema, externalRegistrationId:z.uuid().optional(), previewToken: z.uuid(), expiresAt: count,
  manifestHash: HashSchema, diffHash: HashSchema, mode: z.enum(['recover','fork']),
  differences: z.array(z.string()).max(500), blockers: z.array(z.string()).max(500),
  operationId:OperationIdSchema.optional(),sourceRunId:RunIdSchema.optional(),name:z.string().trim().min(1).max(120).optional(),reason:z.string().trim().min(1).max(4000).optional(),
});
