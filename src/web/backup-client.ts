import { z } from 'zod';
import { BackupIdSchema, BackupJobSchema, RestorePreviewSchema } from '../domain/backup.ts';
import { ForkJobViewSchema, forkJobEtag } from '../domain/fork-http.ts';
import { ApiProblemSchema } from '../domain/http.ts';
import { OperationIdSchema, RunIdSchema } from '../domain/values.ts';
import { BackupSourcesSchema } from '../domain/backup-http.ts';
import { bootstrapSession } from './client.ts';

const count = z.number().int().nonnegative();

export const RestoreSelectionSchema = z.strictObject({ mode: z.literal('fork'), sourceRunId: RunIdSchema, name: z.string().trim().min(1).max(120), reason: z.string().trim().min(1).max(4000) });
export const ForkRestorePreviewSchema = RestorePreviewSchema.extend({ mode: z.literal('fork'), operationId: OperationIdSchema, sourceRunId: RunIdSchema, name: z.string().min(1).max(120), reason: z.string().min(1).max(4000) });
export const BackupIntentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('create'), backupId: BackupIdSchema, key: z.uuid() }),
  z.strictObject({ kind: z.literal('preview'), backupId: BackupIdSchema, key: z.uuid(), selection: RestoreSelectionSchema }),
  z.strictObject({ kind: z.literal('apply'), backupId: BackupIdSchema, key: z.uuid(), backupRevision: count, preview: ForkRestorePreviewSchema, retry: z.strictObject({job: ForkJobViewSchema, key: z.uuid()}).optional() }),
]);
export type BackupIntent = z.infer<typeof BackupIntentSchema>;
type RestoreRetry = NonNullable<Extract<BackupIntent, {kind:'apply'}>['retry']>;
/** An uncertain retry belongs to exactly one reserved destination. */
export function selectRestoreRetry(input: {job: RestoreRetry['job']; pending: RestoreRetry | null; key: string}): RestoreRetry {
  const {job, pending, key} = input;
  return pending !== null && pending.job.operationId === job.operationId && pending.job.targetRunId === job.targetRunId && pending.job.source.snapshotHash === job.source.snapshotHash ? pending : {job, key};
}
export type BackupPreview = z.infer<typeof ForkRestorePreviewSchema>;
export type BackupJob = z.infer<typeof BackupJobSchema>;
export type BackupSources = z.infer<typeof BackupSourcesSchema>;
export function backupEtag(job: Pick<BackupJob, 'backupId' | 'revision'>) { return `"backup:${job.backupId}:r${job.revision}"`; }
export function captureBackupIntent(value: unknown): BackupIntent {
  const intent = BackupIntentSchema.parse(value);
  if (intent.kind === 'apply' && (intent.preview.backupId !== intent.backupId || intent.preview.mode !== 'fork' || intent.preview.blockers.length !== 0)) throw new Error('La confirmación no corresponde a una restauración disponible.');
  if (intent.kind === 'apply' && intent.retry !== undefined && (intent.retry.job.operationId !== intent.preview.operationId || intent.retry.job.source.runId !== intent.preview.sourceRunId || intent.retry.job.name !== intent.preview.name || intent.retry.job.reason !== intent.preview.reason)) throw new Error('El reintento no corresponde a la restauración conservada.');
  return intent;
}
type IntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storageKey = 'personajes:backup-restore-intent';
export function readStoredBackupIntent(storage: IntentStorage): BackupIntent | null {
  try { const raw = storage.getItem(storageKey); return raw === null ? null : captureBackupIntent(JSON.parse(raw)); } catch { return null; }
}
export function writeStoredBackupIntent(storage: IntentStorage, value: BackupIntent | null): boolean {
  try { if (value === null) storage.removeItem(storageKey); else storage.setItem(storageKey, JSON.stringify(captureBackupIntent(value))); return true; } catch { return false; }
}
export function buildBackupRequest(input: { intent: BackupIntent; csrfToken: string }) {
  const intent = captureBackupIntent(input.intent);
  const base = `/api/v1/backups/${intent.backupId}`;
  const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': input.csrfToken, 'Idempotency-Key': intent.key };
  switch (intent.kind) {
    case 'create': return { path: base, init: { method: 'PUT', credentials: 'same-origin', headers: { ...headers, 'If-None-Match': '*' }, body: JSON.stringify({ scope: { kind: 'all' } }) } satisfies RequestInit };
    case 'preview': return { path: `${base}/restore-preview`, init: { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(intent.selection) } satisfies RequestInit };
    case 'apply': return { path: `${base}/restore`, init: { method: 'POST', credentials: 'same-origin', headers: { ...headers, 'If-Match': backupEtag({ backupId: intent.backupId, revision: intent.backupRevision }) }, body: JSON.stringify({ previewToken: intent.preview.previewToken, confirmDiffHash: intent.preview.diffHash }) } satisfies RequestInit };
    default: { const exhaustive: never = intent; return exhaustive; }
  }
}
const BackupRejectionSchema = z.strictObject({kind:z.literal('backup-rejection'),message:z.string(),code:z.string(),status:z.number().int()});
export function backupRejection(value:unknown) {return BackupRejectionSchema.safeParse(value).data;}
async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const raw: unknown = await response.json();
  if (!response.ok) { const problem = ApiProblemSchema.safeParse(raw); if (problem.success && response.status >= 400 && response.status < 500 && response.status !== 408) throw BackupRejectionSchema.parse({kind:'backup-rejection',message:problem.data.error.message,code:problem.data.error.code,status:response.status}); throw new Error('No se confirmó la operación del backup.'); }
  return schema.parse(raw);
}
export function createBackupClient(request: typeof fetch = (url, init) => fetch(url, init), bootstrap = bootstrapSession) {
  async function send(intent: BackupIntent, signal: AbortSignal) { const session = await bootstrap(); const built = buildBackupRequest({ intent, csrfToken: session.csrfToken }); return request(built.path, { ...built.init, signal }); }
  function validateBackup(response: Response, job: BackupJob, id: string) {
    if (job.backupId !== id || response.headers.get('etag') !== backupEtag(job)) throw new Error('El backup recibido no corresponde a la operación solicitada.');
    return job;
  }
  return Object.freeze({
    async create(input: Extract<BackupIntent, { kind: 'create' }>, signal: AbortSignal) { const response = await send(input, signal); return validateBackup(response, await parse(response, BackupJobSchema), input.backupId); },
    async read(backupId: string, signal: AbortSignal) { const id = BackupIdSchema.parse(backupId); await bootstrap(); const response = await request(`/api/v1/backups/${id}`, { credentials: 'same-origin', signal }); return validateBackup(response, await parse(response, BackupJobSchema), id); },
    async sources(backupId: string, signal: AbortSignal) { const id = BackupIdSchema.parse(backupId); await bootstrap(); const response = await request(`/api/v1/backups/${id}/sources`, { credentials: 'same-origin', signal }); const result = await parse(response, BackupSourcesSchema); if (result.backupId !== id) throw new Error('La selección pertenece a otro backup.'); return result; },
    async preview(input: Extract<BackupIntent, { kind: 'preview' }>, signal: AbortSignal) { const response = await send(input, signal); const preview = await parse(response, ForkRestorePreviewSchema); if (preview.backupId !== input.backupId || preview.sourceRunId !== input.selection.sourceRunId || preview.name !== input.selection.name || preview.reason !== input.selection.reason) throw new Error('La revisión pertenece a otro backup o modo.'); return preview; },
    async apply(input: Extract<BackupIntent, { kind: 'apply' }>, signal: AbortSignal) { const response = await send(input, signal); const job = await parse(response, ForkJobViewSchema); if (response.headers.get('etag') !== forkJobEtag(job) || job.operationId !== input.preview.operationId || job.source.runId !== input.preview.sourceRunId || job.name !== input.preview.name || job.reason !== input.preview.reason) throw new Error('No se confirmó la revisión de la restauración.'); return job; },
  });
}
export type BackupClient = ReturnType<typeof createBackupClient>;
