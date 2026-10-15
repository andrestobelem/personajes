import test from 'node:test';
import assert from 'node:assert/strict';
import { BackupJobSchema } from '../src/domain/backup.ts';
import { ForkJobViewSchema, forkJobEtag } from '../src/domain/fork-http.ts';
import { backupEtag, buildBackupRequest, captureBackupIntent, createBackupClient, ForkRestorePreviewSchema, readStoredBackupIntent, writeStoredBackupIntent } from '../src/web/backup-client.ts';
const backupId = '11111111-1111-4111-8111-111111111111', sourceRunId = '22222222-2222-4222-8222-222222222222', operationId = '33333333-3333-4333-8333-333333333333', key = '44444444-4444-4444-8444-444444444444';
const selection = { mode: 'fork', sourceRunId, name: 'Otra puesta', reason: 'Continuar lo guardado' } as const;
const preview = ForkRestorePreviewSchema.parse({ backupId, operationId, sourceRunId, name: selection.name, reason: selection.reason, mode: 'fork', previewToken: key, expiresAt: 1, manifestHash: 'a'.repeat(64), diffHash: 'b'.repeat(64), differences: ['Memoria independiente'], blockers: [] });
const bootstrap = async () => ({ csrfToken: 'csrf', expiresAt: '2026-10-16T00:00:00Z' });
const job = ForkJobViewSchema.parse({ kind: 'fork-job', operationId, targetRunId: key, source: { runId: sourceRunId, commitIndex: 2, worldRevision: 1, worldSeq: 1, snapshotHash: 'a'.repeat(64), configurationRevision: 0, configurationHash: 'c'.repeat(64) }, name: selection.name, reason: selection.reason, state: 'staging', revision: 0, createdAt: 0, updatedAt: 0, audioDerivation: { kind: 'initial-ready-configuration', sourceConfigurationHash: 'c'.repeat(64), effectiveHistory: 'not-reconstructed', bindingState: 'unbound' } });
test('backup create and confirmed restore use exact CSRF/idempotency and CAS boundaries', () => {
 const create = buildBackupRequest({ intent: captureBackupIntent({ kind: 'create', backupId, key }), csrfToken: 'csrf' });
 assert.equal(create.init.method, 'PUT'); assert.equal(new Headers(create.init.headers).get('If-None-Match'), '*'); assert.equal(create.init.headers['Idempotency-Key'], key); assert.deepEqual(JSON.parse(create.init.body), { scope: { kind: 'all' } });
 const apply = buildBackupRequest({ intent: captureBackupIntent({ kind: 'apply', backupId, key, backupRevision: 4, preview }), csrfToken: 'csrf' });
 assert.equal(new Headers(apply.init.headers).get('If-Match'), `"backup:${backupId}:r4"`); assert.equal(apply.init.headers['X-CSRF-Token'], 'csrf'); assert.deepEqual(JSON.parse(apply.init.body), { previewToken: preview.previewToken, confirmDiffHash: preview.diffHash });
 assert.throws(() => captureBackupIntent({ kind: 'apply', backupId: key, key, backupRevision: 4, preview }));
 assert.throws(() => captureBackupIntent({ kind: 'apply', backupId, key, backupRevision: 4, preview: { ...preview, blockers: ['Pending'] } }));
});
test('restore identity survives session persistence and malformed or mismatched backup cannot be replayed', () => {
 const values = new Map<string, string>(); const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
 const intent = captureBackupIntent({ kind: 'apply', backupId, key, backupRevision: 4, preview });
 assert.equal(writeStoredBackupIntent(storage, intent), true); assert.deepEqual(readStoredBackupIntent(storage), intent);
 values.set('personajes:backup-restore-intent', JSON.stringify({ ...intent, backupId: key })); assert.equal(readStoredBackupIntent(storage), null);
 values.set('personajes:backup-restore-intent', '{'); assert.equal(readStoredBackupIntent(storage), null);
 assert.equal(writeStoredBackupIntent(storage, null), true); assert.equal(readStoredBackupIntent(storage), null);
});
test('uncertain restoration repeats the same confirmed request and rejects a foreign returned operation', async () => {
 const calls: Array<{ url: string; init: RequestInit | undefined }> = []; let first = true;
 const api = createBackupClient(async (url, init) => { calls.push({ url: String(url), init }); if (first) { first = false; throw new Error('respuesta perdida'); } return new Response(JSON.stringify(job), { status: 202, headers: { etag: forkJobEtag(job) } }); }, bootstrap);
 const intent = captureBackupIntent({ kind: 'apply', backupId, key, backupRevision: 4, preview }); if (intent.kind !== 'apply') throw new Error('Fixture');
 await assert.rejects(api.apply(intent, new AbortController().signal), /perdida/); assert.deepEqual(await api.apply(intent, new AbortController().signal), job); assert.deepEqual(calls[0], calls[1]);
 const wrong = { ...job, operationId: key }; const bad = createBackupClient(async () => new Response(JSON.stringify(wrong), { headers: { etag: forkJobEtag(wrong) } }), bootstrap); await assert.rejects(bad.apply(intent, new AbortController().signal), /revisión/);
});
test('backup and source GET only read, validate public schema and require identity match', async () => {
 const backup = BackupJobSchema.parse({ backupId, revision: 1, state: 'succeeded', safeCode: null, manifestHash: 'a'.repeat(64) }); const methods: Array<string | undefined> = [];
 const api = createBackupClient(async (url, init) => { methods.push(init?.method); return String(url).endsWith('/sources') ? new Response(JSON.stringify({ kind: 'backup-sources', backupId, sources: [{ runId: sourceRunId, commitIndex: 2, worldRevision: 1, worldSeq: 1, snapshotHash: 'a'.repeat(64) }] })) : new Response(JSON.stringify(backup), { headers: { etag: backupEtag(backup) } }); }, bootstrap);
 assert.equal((await api.read(backupId, new AbortController().signal)).backupId, backupId); assert.equal((await api.sources(backupId, new AbortController().signal)).sources[0]?.runId, sourceRunId); assert.deepEqual(methods, [undefined, undefined]);
 const bad = createBackupClient(async () => new Response(JSON.stringify({ kind: 'backup-sources', backupId: key, sources: [] })), bootstrap); await assert.rejects(bad.sources(backupId, new AbortController().signal), /otro backup/);
});
test('preview binds exact selection and accepts blockers without enabling confirmation', async () => {
 const intent = captureBackupIntent({ kind: 'preview', backupId, key, selection }); if (intent.kind !== 'preview') throw new Error('Fixture');
 const api = createBackupClient(async () => new Response(JSON.stringify(preview)), bootstrap); assert.deepEqual(await api.preview(intent, new AbortController().signal), preview);
 const bad = createBackupClient(async () => new Response(JSON.stringify({ ...preview, sourceRunId: key })), bootstrap); await assert.rejects(bad.preview(intent, new AbortController().signal), /otro backup/);
});
test('retry reservation persists its original key and rejects a job from another restoration', () => {
 const failed = ForkJobViewSchema.parse({ ...job, state: 'failed', revision: 1, code: 'FORK_INTERRUPTED' });
 const intent = captureBackupIntent({ kind: 'apply', backupId, key, backupRevision: 1, preview, retry: { job: failed, key } });
 const values = new Map<string, string>(); const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
 assert.equal(writeStoredBackupIntent(storage, intent), true); assert.deepEqual(readStoredBackupIntent(storage), intent);
 assert.throws(() => captureBackupIntent({ ...intent, retry: { job: { ...failed, operationId: key }, key } }), /reintento/);
});
test('expired preview is a definite rejection while unavailable transport keeps the confirmed intent uncertain', async () => {
 const { backupRejection } = await import('../src/web/backup-client.ts');
 const intent = captureBackupIntent({ kind: 'apply', backupId, key, backupRevision: 1, preview }); if (intent.kind !== 'apply') throw new Error('Fixture');
 const response = (status: number) => new Response(JSON.stringify({ requestId: key, error: { kind: 'conflict', code: 'RESTORE_PREVIEW_EXPIRED', message: 'La revisión venció.' } }), { status });
 const expired = createBackupClient(async () => response(409), bootstrap);
 await assert.rejects(expired.apply(intent, new AbortController().signal), failure => backupRejection(failure)?.code === 'RESTORE_PREVIEW_EXPIRED');
 const unavailable = createBackupClient(async () => response(503), bootstrap);
 await assert.rejects(unavailable.apply(intent, new AbortController().signal), failure => backupRejection(failure) === undefined);
});
test('a new restoration never inherits the uncertain retry of a previous published operation', async () => {
 const {selectRestoreRetry} = await import('../src/web/backup-client.ts');
 const previous = ForkJobViewSchema.parse({...job,state:'failed',code:'FORK_INTERRUPTED',revision:1});
 const uncertain = {job:previous,key};
 assert.deepEqual(selectRestoreRetry({job:previous,pending:uncertain,key:backupId}),uncertain);
 const next = ForkJobViewSchema.parse({...previous,operationId:backupId,targetRunId:sourceRunId});
 const selected = selectRestoreRetry({job:next,pending:uncertain,key:sourceRunId});
 assert.equal(selected.job.operationId,next.operationId);assert.equal(selected.key,sourceRunId);
 const nextPreview={...preview,operationId:next.operationId};
 assert.doesNotThrow(()=>captureBackupIntent({kind:'apply',backupId,key,backupRevision:1,preview:nextPreview,retry:selected}));
});
