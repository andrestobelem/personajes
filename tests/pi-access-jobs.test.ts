import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type Model, type ModelsSimpleStreamOptions } from '@earendil-works/pi-ai';
import { openJournal } from '../src/adapters/journal.ts';
import { DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { createPiAccessJobs } from '../src/application/pi-access-jobs.ts';

async function setup(t: TestContext, timeoutMs = 500) {
  const root = mkdtempSync(join(tmpdir(), 'personajes-access-broker-'));
  const path = join(root, 'world.sqlite'); const journal = openJournal({ path });
  const sdk = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const calls: { stream: ReturnType<typeof createAssistantMessageEventStream>; model: Model<Api>; options: ModelsSimpleStreamOptions | undefined }[] = [];
  let account = 'a'.repeat(64);
  // Explicit test-only auth/transport port; real SDK stream protocol, no OAuth/provider network.
  const modelRuntime = { getModel: sdk.getModel.bind(sdk), checkAuth: async () => ({ type: 'oauth' as const }), isUsingOAuth: () => true, getAuth: async () => ({ auth: { apiKey: 'SYNTHETIC-PRIVATE' } }), streamSimple(model: Model<Api>, _context: unknown, options?: ModelsSimpleStreamOptions) {
    options?.onPayload?.({ model: model.id, reasoning: { effort: 'low' } }, model);
    const stream = createAssistantMessageEventStream(); calls.push({ stream, model, options }); return stream;
  } };
  const readCredentialFingerprint = async () => account;
  const broker = await createPiAccessJobs({ journal, modelRuntime, readCredentialFingerprint, ownerToken: randomUUID(), timeoutMs });
  t.after(async () => { for (const call of calls) finish(call); await broker.close(); journal.close(); rmSync(root, { recursive: true, force: true }); });
  return { journal, path, broker, calls, modelRuntime, readCredentialFingerprint, setAccount: (value: string) => { account = value; } };
}
function finish(call: { stream: ReturnType<typeof createAssistantMessageEventStream>; model: Model<Api>; options: ModelsSimpleStreamOptions | undefined }) {
  const message: AssistantMessage = { role: 'assistant', content: [{ type: 'text', text: 'PRIVATE-RESPONSE' }], api: call.model.api, provider: call.model.provider, model: call.model.id, stopReason: 'stop', timestamp: 0, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  call.options?.onResponse?.({ status: 200, headers: {} }, call.model); call.stream.push({ type: 'done', reason: 'stop', message });
}
async function until(check: () => boolean | Promise<boolean>) { for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 1)); } throw new Error('Condition did not settle'); }

test('constructor no sondea; start durable/replay sólo una solicitud, vistas públicas safe y status privado ligado a credencial', async (t) => {
  const h = await setup(t); assert.equal(h.calls.length, 0);
  assert.equal((await h.broker.readPiAccessStatus({ profile: DEFAULT_INFERENCE_PROFILE })).accessCheck, 'notRun'); assert.equal(h.calls.length, 0);
  const key = randomUUID(); const start = await h.broker.start({ profile: DEFAULT_INFERENCE_PROFILE, idempotencyKey: key });
  if (start.kind !== 'created') throw new Error('Expected created');
  await until(() => h.calls.length === 1); const firstCall = h.calls[0]; assert.ok(firstCall); finish(firstCall);
  await until(async () => { const job = await h.broker.readJob({ jobId: start.job.jobId }); return job.kind === 'found' && job.job.state === 'succeeded'; });
  const replay = await h.broker.start({ profile: DEFAULT_INFERENCE_PROFILE, idempotencyKey: key }); assert.deepEqual(replay, { kind: 'existing', job: start.job }); assert.equal(h.calls.length, 1);
  const page = await h.broker.listJobs({ offset: 0, limit: 100 });
  assert.equal(page.items[0]?.passedResult?.measuredUsage.totalTokens, 2);
  assert.equal(JSON.stringify(page).includes('PRIVATE'), false); assert.equal(JSON.stringify(page).includes('accountFingerprint'), false);
  assert.equal((await h.broker.readPiAccessStatus({ profile: DEFAULT_INFERENCE_PROFILE })).accessCheck, 'passed');
  h.setAccount('b'.repeat(64)); assert.equal((await h.broker.readPiAccessStatus({ profile: DEFAULT_INFERENCE_PROFILE })).accessCheck, 'stale'); assert.equal(h.calls.length, 1);
});

test('timeout durable ambiguo mantiene exclusión y close espera transporte que ignora Abort; no adopta success tardío', async (t) => {
  const h = await setup(t, 10);
  const first = await h.broker.start({ profile: DEFAULT_INFERENCE_PROFILE, idempotencyKey: randomUUID() }); if (first.kind !== 'created') throw new Error('Expected created');
  await until(async () => { const job = await h.broker.readJob({ jobId: first.job.jobId }); return job.kind === 'found' && job.job.resultKind === 'ambiguous'; });
  await h.broker.start({ profile: DEFAULT_INFERENCE_PROFILE, idempotencyKey: randomUUID() }); assert.equal(h.calls.length, 1);
  let closed = false; const closing = h.broker.close().then(() => { closed = true; });
  await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal(closed, false);
  const firstCall = h.calls[0]; assert.ok(firstCall); finish(firstCall); await closing;
  const latest = h.journal.readPiAccessJob({ jobId: first.job.jobId }); assert.equal(latest?.resultKind, 'ambiguous'); assert.equal(latest?.passedResult, null); assert.equal(h.calls.length, 1);
  assert.equal(closed, true);
});

test('restart recupera queued abandonado como interrupted sin sondas; rechaza nuevas operaciones trasclose', async (t) => {
  const h = await setup(t); await h.broker.close();
  const oldOwner = randomUUID(); const original = h.journal.createPiAccessJob({ principalId: 'local-operator', profile: DEFAULT_INFERENCE_PROFILE, idempotencyKey: randomUUID() });
  if (original.kind !== 'created') throw new Error('Expected created');
  h.journal.claimPiAccessJob({ jobId: original.job.jobId, expectedRevision: original.job.revision, ownerToken: oldOwner, claimToken: randomUUID() });
  const reopened = await createPiAccessJobs({ journal: h.journal, modelRuntime: h.modelRuntime, readCredentialFingerprint: h.readCredentialFingerprint, ownerToken: randomUUID() });
  assert.equal(h.calls.length, 0); const view = await reopened.readJob({ jobId: original.job.jobId }); assert.equal(view.kind, 'found'); if (view.kind === 'found') assert.equal(view.job.state, 'interrupted');
  await reopened.close(); await assert.rejects(reopened.start({ profile: DEFAULT_INFERENCE_PROFILE, idempotencyKey: randomUUID() }), /closed/);
});

test('status no mezcla passed anterior con aborted, fallo sin huella ni timeout posterior aun con checkedAt iguales', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  for (const scenario of ['aborted', 'failed', 'ambiguous'] as const) {
    const h = await setup(t);
    const initial = await h.broker.start({ profile: DEFAULT_INFERENCE_PROFILE, idempotencyKey: randomUUID() }); if (initial.kind !== 'created') throw new Error('Expected created');
    await until(() => h.calls.length === 1); const call = h.calls[0]; assert.ok(call); finish(call);
    await until(async () => (await h.broker.readPiAccessStatus({ profile: DEFAULT_INFERENCE_PROFILE })).accessCheck === 'passed');
    const { fingerprintInferenceProfile } = await import('../src/application/pi-access-check.ts');
    const receipt = h.journal.readLatestAccessReceipt({ provider: 'openai-codex', profileFingerprint: fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE), accountFingerprint: 'a'.repeat(64) });
    if (receipt.kind !== 'receipt') throw new Error('Expected receipt');
    const next = h.journal.createPiAccessJob({ principalId: 'local-operator', profile: DEFAULT_INFERENCE_PROFILE, idempotencyKey: randomUUID() }); if (next.kind !== 'created') throw new Error('Expected created');
    const claim = h.journal.claimPiAccessJob({ jobId: next.job.jobId, expectedRevision: next.job.revision, ownerToken: randomUUID(), claimToken: randomUUID() }); if (claim.kind !== 'claimed') throw new Error('Expected claimed');
    const common = { provider: 'openai-codex', requestedProfile: DEFAULT_INFERENCE_PROFILE, profileFingerprint: fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE), accountFingerprint: scenario === 'failed' ? null : 'a'.repeat(64) };
    const result = scenario === 'aborted' ? { ...common, kind: 'aborted', code: 'CANCELLED_BEFORE_DISPATCH' }
      : scenario === 'failed' ? { ...common, kind: 'failed', code: 'AUTH_REQUIRED' } : { ...common, kind: 'ambiguous', code: 'TIMEOUT' };
    h.journal.completePiAccessJob({ jobId: next.job.jobId, expectedRevision: claim.job.revision, lease: claim.lease, result, checkedAt: receipt.checkedAt, expiresAt: receipt.expiresAt });
    const status = await h.broker.readPiAccessStatus({ profile: DEFAULT_INFERENCE_PROFILE });
    assert.equal(status.accessCheck, scenario === 'aborted' ? 'stale' : 'failed');
    assert.equal(status.effectiveProfile, null, 'Never borrow the effective profile of another job');
    assert.equal(JSON.stringify(status).includes('accountFingerprint'), false);
    assert.equal(h.calls.length, 1, 'Readonly status never probes');
  }
});

test('passed ya confirmado se guarda aunque cancel llegue mientras espera CAS completion; no se convierte en ambiguo', async (t) => {
  const h = await setup(t); await h.broker.close();
  let release: (() => void) | undefined; let writing = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const journal = { ...h.journal, async completePiAccessJob(value: unknown) { writing = true; await gate; return h.journal.completePiAccessJob(value); } };
  const broker = await createPiAccessJobs({ journal, modelRuntime: h.modelRuntime, readCredentialFingerprint: h.readCredentialFingerprint, ownerToken: randomUUID() });
  t.after(() => broker.close());
  const started = await broker.start({ profile: DEFAULT_INFERENCE_PROFILE, idempotencyKey: randomUUID() }); if (started.kind !== 'created') throw new Error('Expected created');
  await until(() => h.calls.length === 1); const call = h.calls[0]; assert.ok(call); finish(call);
  await until(() => writing);
  const job = await broker.readJob({ jobId: started.job.jobId }); if (job.kind !== 'found') throw new Error('Expected found');
  const canceled = await broker.cancelJob({ jobId: started.job.jobId, expectedRevision: job.job.revision, idempotencyKey: randomUUID() });
  assert.equal(canceled.kind, 'updated'); assert.ok(release); release();
  await until(async () => { const current = await broker.readJob({ jobId: started.job.jobId }); return current.kind === 'found' && current.job.state === 'succeeded'; });
  await broker.close();
});
