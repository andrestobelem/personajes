import { z } from 'zod';
import { BackupIdSchema, BackupJobSchema, RestorePreviewSchema, RestoreSelectionSchema } from '../domain/backup.ts';
import { ForkJobViewSchema, forkJobEtag } from '../domain/fork-http.ts';
import { HostRecoveryOwnershipSchema, HostRecoveryJobSchema, hostRecoveryEtag, type HostRecoveryJob } from '../domain/host-recovery.ts';
import { ApiProblemSchema } from '../domain/http.ts';
import { OperationIdSchema, RunIdSchema } from '../domain/values.ts';
import { BackupSourcesSchema } from '../domain/backup-http.ts';
import { bootstrapSession, reconnectSession } from './client.ts';

const count = z.number().int().nonnegative();

export { RestoreSelectionSchema };
export const ForkRestorePreviewSchema = RestorePreviewSchema.extend({ mode: z.literal('fork'), operationId: OperationIdSchema, sourceRunId: RunIdSchema, name: z.string().min(1).max(120), reason: z.string().min(1).max(4000) });
export const RecoveryPreviewSchema = RestorePreviewSchema.extend({mode:z.literal('recover'),operationId:OperationIdSchema});
export const BackupPreviewSchema = z.discriminatedUnion('mode',[ForkRestorePreviewSchema, RecoveryPreviewSchema]);
export const BackupIntentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('create'), backupId: BackupIdSchema, key: z.uuid() }),
  z.strictObject({ kind: z.literal('preview'), backupId: BackupIdSchema, key: z.uuid(), selection: RestoreSelectionSchema }),
  z.strictObject({kind:z.literal('recover'),backupId:BackupIdSchema,key:z.uuid(),backupRevision:count,preview:RecoveryPreviewSchema,resume:z.strictObject({key:z.uuid(),job:HostRecoveryJobSchema,expectedDirectoryOperationNonce:z.uuid().optional()}).optional()}),
  z.strictObject({ kind: z.literal('apply'), backupId: BackupIdSchema, key: z.uuid(), backupRevision: count, preview: ForkRestorePreviewSchema, retry: z.strictObject({job: ForkJobViewSchema, key: z.uuid()}).optional() }),
]);
export type BackupIntent = z.infer<typeof BackupIntentSchema>;
type RestoreRetry = NonNullable<Extract<BackupIntent, {kind:'apply'}>['retry']>;
/** An uncertain retry belongs to exactly one reserved destination. */
export function selectRestoreRetry(input: {job: RestoreRetry['job']; pending: RestoreRetry | null; key: string}): RestoreRetry {
  const {job, pending, key} = input;
  return pending !== null && pending.job.operationId === job.operationId && pending.job.targetRunId === job.targetRunId && pending.job.source.snapshotHash === job.source.snapshotHash ? pending : {job, key};
}
export type BackupPreview = z.infer<typeof BackupPreviewSchema>;
export type BackupJob = z.infer<typeof BackupJobSchema>;
export type BackupSources = z.infer<typeof BackupSourcesSchema>;
export function backupEtag(job: Pick<BackupJob, 'backupId' | 'revision'>) { return `"backup:${job.backupId}:r${job.revision}"`; }
export function captureBackupIntent(value: unknown): BackupIntent {
  const intent = BackupIntentSchema.parse(value);
  if ((intent.kind === 'apply' || intent.kind === 'recover') && (intent.preview.backupId !== intent.backupId || intent.preview.blockers.length !== 0)) throw new Error('La confirmación no corresponde a una restauración disponible.');
  if (intent.kind === 'apply' && intent.retry !== undefined && (intent.retry.job.operationId !== intent.preview.operationId || intent.retry.job.source.runId !== intent.preview.sourceRunId || intent.retry.job.name !== intent.preview.name || intent.retry.job.reason !== intent.preview.reason)) throw new Error('El reintento no corresponde a la restauración conservada.');
  if (intent.kind === 'recover' && intent.resume !== undefined && (intent.resume.job.operationId !== intent.preview.operationId || intent.resume.job.backupId !== intent.backupId || ['succeeded','aborted'].includes(intent.resume.job.state))) throw new Error('La reanudación no corresponde a esta recuperación detenida.');
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
    case 'recover':
    case 'apply': return { path: `${base}/restore`, init: { method: 'POST', credentials: 'same-origin', headers: { ...headers, 'If-Match': backupEtag({ backupId: intent.backupId, revision: intent.backupRevision }) }, body: JSON.stringify({ previewToken: intent.preview.previewToken, confirmDiffHash: intent.preview.diffHash }) } satisfies RequestInit };
    default: { const exhaustive: never = intent; return exhaustive; }
  }
}
export function buildRecoveryResumeRequest(input:{intent:Extract<BackupIntent,{kind:'recover'}>;csrfToken:string}) {
  const intent=captureBackupIntent(input.intent);
  if(intent.kind!=='recover'||intent.resume===undefined)throw new Error('Falta conservar la solicitud de reanudación.');
  return {path:`/api/v1/host-recoveries/${intent.preview.operationId}/resume`,init:{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':input.csrfToken,'Idempotency-Key':intent.resume.key,'If-Match':hostRecoveryEtag(intent.resume.job)},body:JSON.stringify(intent.resume.expectedDirectoryOperationNonce===undefined?{}:{expectedDirectoryOperationNonce:intent.resume.expectedDirectoryOperationNonce})} satisfies RequestInit};
}
const BackupRejectionSchema = z.strictObject({kind:z.literal('backup-rejection'),message:z.string(),code:z.string(),status:z.number().int()});
export function backupRejection(value:unknown) {return BackupRejectionSchema.safeParse(value).data;}
async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const raw: unknown = await response.json();
  if (!response.ok) { const problem = ApiProblemSchema.safeParse(raw); if (problem.success && response.status >= 400 && response.status < 500 && response.status !== 408) throw BackupRejectionSchema.parse({kind:'backup-rejection',message:problem.data.error.message,code:problem.data.error.code,status:response.status}); throw new Error('No se confirmó la operación del backup.'); }
  return schema.parse(raw);
}
function validateRecovery(response:Response,job:HostRecoveryJob,operationId:string,backupId:string) {
  if (job.operationId !== operationId || job.backupId !== backupId || response.headers.get('etag') !== hostRecoveryEtag(job) || (job.state === 'succeeded' && job.phase !== 'verified') || (job.state==='aborted' && job.phase!=='original-retained')) throw new Error('No se confirmó la identidad o la verificación de la recuperación del host.');
  return job;
}
export function newerHostRecovery(current:HostRecoveryJob|null,incoming:HostRecoveryJob):HostRecoveryJob {
  if (current === null) return incoming;
  if (current.operationId !== incoming.operationId || current.backupId !== incoming.backupId || incoming.revision < current.revision || (current.state === 'succeeded' && current.phase === 'verified') || current.state==='aborted') return current;
  return incoming;
}
export function createBackupClient(request: typeof fetch = (url, init) => fetch(url, init), bootstrap = bootstrapSession, reconnect = reconnectSession) {
  async function send(intent: BackupIntent, signal: AbortSignal) { const session = await bootstrap(); const built = buildBackupRequest({ intent, csrfToken: session.csrfToken }); return request(built.path, { ...built.init, signal }); }
  function validateBackup(response: Response, job: BackupJob, id: string) {
    if (job.backupId !== id || response.headers.get('etag') !== backupEtag(job)) throw new Error('El backup recibido no corresponde a la operación solicitada.');
    return job;
  }
  return Object.freeze({
    async create(input: Extract<BackupIntent, { kind: 'create' }>, signal: AbortSignal) { const response = await send(input, signal); return validateBackup(response, await parse(response, BackupJobSchema), input.backupId); },
    async read(backupId: string, signal: AbortSignal) { const id = BackupIdSchema.parse(backupId); await bootstrap(); const response = await request(`/api/v1/backups/${id}`, { credentials: 'same-origin', signal }); return validateBackup(response, await parse(response, BackupJobSchema), id); },
    async sources(backupId: string, signal: AbortSignal) { const id = BackupIdSchema.parse(backupId); await bootstrap(); const response = await request(`/api/v1/backups/${id}/sources`, { credentials: 'same-origin', signal }); const result = await parse(response, BackupSourcesSchema); if (result.backupId !== id) throw new Error('La selección pertenece a otro backup.'); return result; },
    async preview(input: Extract<BackupIntent, { kind: 'preview' }>, signal: AbortSignal) { const response = await send(input, signal); const preview = await parse(response, BackupPreviewSchema); if (preview.backupId !== input.backupId || preview.mode !== input.selection.mode || (input.selection.mode === 'fork' && (preview.mode !== 'fork' || preview.sourceRunId !== input.selection.sourceRunId || preview.name !== input.selection.name || preview.reason !== input.selection.reason))) throw new Error('La revisión pertenece a otro backup o modo.'); return preview; },
    async recover(input: Extract<BackupIntent, {kind:'recover'}>, signal: AbortSignal) {
      const response = await send(input, signal);
      return validateRecovery(response, await parse(response, HostRecoveryJobSchema), input.preview.operationId, input.backupId);
    },
    async readRecoveryOwnership(operationId:string,signal:AbortSignal) {
      const id=OperationIdSchema.parse(operationId);
      try {await bootstrap();} catch {await reconnect();}
      const read=()=>request(`/api/v1/host-recoveries/${id}/ownership`,{credentials:'same-origin',signal});
      let response=await read();if(response.status===401){await reconnect();response=await read();}
      const result=await parse(response,HostRecoveryOwnershipSchema);if(result.operationId!==id)throw new Error('El bloqueo pertenece a otra recuperación.');return result;
    },
    async resumeRecovery(input:Extract<BackupIntent,{kind:'recover'}>,signal:AbortSignal) {
      const intent=captureBackupIntent(input);if(intent.kind!=='recover'||intent.resume===undefined)throw new Error('Falta conservar la solicitud de reanudación.');
      let session:Awaited<ReturnType<typeof bootstrap>>;
      try {session=await bootstrap();} catch {session=await reconnect();}
      const built=buildRecoveryResumeRequest({intent,csrfToken:session.csrfToken});
      const response=await request(built.path,{...built.init,signal});
      if(response.status===401){await reconnect();throw BackupRejectionSchema.parse({kind:'backup-rejection',message:'La sesión fue restablecida. Consultá el estado o repetí la misma reanudación manualmente.',code:'RECOVERY_SESSION_RECONNECTED',status:401});}
      const result=validateRecovery(response,await parse(response,HostRecoveryJobSchema),intent.preview.operationId,intent.backupId);
      if(result.revision<=intent.resume.job.revision)throw new Error('La reanudación no confirmó una revisión posterior.');
      return result;
    },
    async readRecovery(input: {operationId:string;backupId:string}, signal: AbortSignal) {
      const operationId = OperationIdSchema.parse(input.operationId); const backupId = BackupIdSchema.parse(input.backupId);
      try {await bootstrap();} catch {await reconnect();}
      const read = () => request(`/api/v1/host-recoveries/${operationId}`, {credentials:'same-origin',signal});
      let response = await read();
      if (response.status === 401) {await reconnect(); response = await read();}
      return validateRecovery(response, await parse(response, HostRecoveryJobSchema), operationId, backupId);
    },
    async apply(input: Extract<BackupIntent, { kind: 'apply' }>, signal: AbortSignal) { const response = await send(input, signal); const job = await parse(response, ForkJobViewSchema); if (response.headers.get('etag') !== forkJobEtag(job) || job.operationId !== input.preview.operationId || job.source.runId !== input.preview.sourceRunId || job.name !== input.preview.name || job.reason !== input.preview.reason) throw new Error('No se confirmó la revisión de la restauración.'); return job; },
  });
}
export type BackupClient = ReturnType<typeof createBackupClient>;
