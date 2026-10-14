import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { openJournal } from '../src/adapters/journal.ts';
import { createPiAccessJobs } from '../src/application/pi-access-jobs.ts';
import { test, type TestContext } from 'node:test';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { DEFAULT_INFERENCE_PROFILE, CLAUDE_INFERENCE_PROFILE, LEGACY_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { PiAccessJobViewSchema, PiAccessJobReceiptSchema, PiAccessJobPageSchema, PiIntegrationStatusSchema, SessionCreatedSchema } from '../src/domain/http.ts';
import { createLocalHttpServer, type PiAccessCheckJobsApplicationPort } from '../src/server/http.ts';

function fakeBroker() {
  let starts = 0;
  let cancels = 0;
  let reads = 0;
  const receipt = PiAccessJobViewSchema.parse({ kind: 'pi-access-job', jobId: randomUUID(), provider: 'openai-codex',
    profile: DEFAULT_INFERENCE_PROFILE, state: 'queued', revision: 0, createdAt: '2026-10-14T12:00:00.000Z',
    updatedAt: '2026-10-14T12:00:00.000Z', resultKind: null, safeCode: null, passedResult: null });
  let current = receipt;
  let key: string | undefined;
  const offsets: number[] = [];
  const port: PiAccessCheckJobsApplicationPort = {
    start(input) {
      starts += 1;
      if (key !== undefined && (key !== input.idempotencyKey || JSON.stringify(input.profile) !== JSON.stringify(receipt.profile))) return { kind: 'idempotencyConflict' };
      const replay = key !== undefined;
      key = input.idempotencyKey;
      return { kind: replay ? 'existing' : 'created', job: receipt };
    },
    readJob({ jobId }) { reads += 1; return jobId === receipt.jobId ? { kind: 'found', job: current } : { kind: 'missing' }; },
    listJobs({ offset, limit }) {
      reads += 1; offsets.push(offset);
      return { kind: 'pi-access-job-page', items: offset === 0 ? [current].slice(0, limit) : [],
        nextCursor: offset === 0 ? 'p1.' + Buffer.from('1').toString('base64url') : null, truncated: false };
    },
    cancelJob(input) {
      cancels += 1;
      if (input.jobId !== receipt.jobId) return { kind: 'missing' };
      if (input.idempotencyKey === key) return { kind: 'idempotencyConflict' };
      if (input.expectedRevision !== current.revision) return { kind: 'stale', job: current };
      if (current.state === 'succeeded') return { kind: 'terminal', job: current };
      current = PiAccessJobViewSchema.parse({ ...current, state: 'canceled', revision: current.revision + 1, safeCode: 'user-canceled' });
      return { kind: 'updated', job: current };
    },
  };
  return { port, receipt, offsets, get starts() { return starts; }, get cancels() { return cancels; }, get reads() { return reads; },
    setJob(value: unknown) { current = PiAccessJobViewSchema.parse(value); } };
}

async function setup(t: TestContext, piAccessJobs?: PiAccessCheckJobsApplicationPort, withOAuth = false) {
  const forbidden = () => { throw new Error('No operación OAuth durante lectura de status'); };
  const server = createLocalHttpServer({ catalog: await loadCatalog({ repositoryRoot: process.cwd() }),
    shellHtml: '<!doctype html><html><head></head><body></body></html>', ...(piAccessJobs === undefined ? {} : { piAccessJobs }),
    ...(withOAuth ? { piOAuthJobs: { status() { return { kind: 'status', value: { provider: 'openai-codex', configuration: 'oauth-configured', accountAccess: 'not-verified' } }; },
      startLogin: forbidden, startLogout: forbidden, readJob: forbidden, listJobs: forbidden, cancelJob: forbidden, readInteraction: forbidden } } : {}) });
  const { origin } = await server.listen();
  t.after(() => server.close());
  const sameOrigin = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
  const shell = await (await fetch(origin + '/', { headers: sameOrigin })).text();
  const nonce = shell.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];
  assert.ok(nonce);
  const session = await fetch(origin + '/api/v1/session', { method: 'POST', headers: { ...sameOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ bootNonce: nonce }) });
  const { csrfToken } = SessionCreatedSchema.parse(await session.json());
  const cookie = session.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const headers = { ...sameOrigin, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken };
  const path = '/api/v1/integrations/pi/access-check';
  return { origin, headers, path };
}

test('access-check sólo inicia por POST explícito protegido, rechaza perfil retirado y campos privados', async (t) => {
  const broker = fakeBroker(); const host = await setup(t, broker.port);
  const start = (profile: unknown, extra = {}, headers = host.headers) => fetch(host.origin + host.path, {
    method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ profile, ...extra }) });
  for (const body of [LEGACY_INFERENCE_PROFILE, { ...DEFAULT_INFERENCE_PROFILE, provider: 'anthropic' }, { ...CLAUDE_INFERENCE_PROFILE, reasoningEffort: 'low' }]) assert.equal((await start(body)).status, 422);
  assert.equal((await start(DEFAULT_INFERENCE_PROFILE, { accountFingerprint: 'SECRET_FINGERPRINT' })).status, 422);
  assert.equal((await start(DEFAULT_INFERENCE_PROFILE, {}, { ...host.headers, 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await start(DEFAULT_INFERENCE_PROFILE, {}, { ...host.headers, Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await fetch(host.origin + host.path, { method: 'POST', headers: host.headers, body: JSON.stringify({ profile: DEFAULT_INFERENCE_PROFILE }) })).status, 400);
  assert.equal(broker.starts, 0);
  const unauthenticated = await fetch(host.origin + host.path + '/jobs', { headers: { Origin: host.origin, 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(unauthenticated.status, 401);
});

test('POST replay devuelve receipt queued inmutable y GET expone pass medido con ETag actual sin otra llamada', async (t) => {
  const broker = fakeBroker(); const host = await setup(t, broker.port); const key = randomUUID();
  const start = () => fetch(host.origin + host.path, { method: 'POST', headers: { ...host.headers, 'Idempotency-Key': key }, body: JSON.stringify({ profile: DEFAULT_INFERENCE_PROFILE }) });
  const first = await start(); assert.equal(first.status, 202);
  const receipt = PiAccessJobReceiptSchema.parse(await first.json());
  assert.equal(first.headers.get('location'), host.path + '/jobs/' + receipt.job.jobId);
  assert.equal(first.headers.get('etag'), `"pi-access:${receipt.job.jobId}:r0"`);
  const passedResult = { effectiveProfile: { provider: 'openai-codex', api: 'openai-codex-responses', model: 'gpt-6.1-sol', providerThinkingLevel: 'low', reasoningEvidence: 'sdk-payload-and-response' },
    measuredUsage: { input: 23, output: 7, cacheRead: 4, cacheWrite: 0, totalTokens: 34, reasoning: 2 } };
  broker.setJob({ ...receipt.job, state: 'succeeded', revision: 2, resultKind: 'passed', passedResult });
  const replay = await start(); assert.equal(replay.status, 202); assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(PiAccessJobReceiptSchema.parse(await replay.json()), receipt);
  const read = await fetch(host.origin + host.path + '/jobs/' + receipt.job.jobId, { headers: host.headers });
  assert.equal(read.status, 200); assert.equal(read.headers.get('etag'), `"pi-access:${receipt.job.jobId}:r2"`);
  const text = await read.text(); const job = PiAccessJobViewSchema.parse(JSON.parse(text));
  assert.deepEqual(job.passedResult, passedResult);
  assert.doesNotMatch(text, /accountFingerprint|profileFingerprint|credential|prompt|sessionPath/);
  const page = PiAccessJobPageSchema.parse(await (await fetch(host.origin + host.path + '/jobs?limit=1', { headers: host.headers })).json());
  assert.equal(page.items[0]?.state, 'succeeded'); assert.ok(page.nextCursor);
  const next = await fetch(host.origin + host.path + '/jobs?limit=1&cursor=' + page.nextCursor, { headers: host.headers });
  assert.deepEqual(PiAccessJobPageSchema.parse(await next.json()).items, []); assert.deepEqual(broker.offsets, [0, 1]);
  assert.equal(broker.starts, 2); assert.equal(broker.reads, 3);
  const collision = await fetch(host.origin + host.path, { method: 'POST', headers: { ...host.headers, 'Idempotency-Key': key }, body: JSON.stringify({ profile: CLAUDE_INFERENCE_PROFILE }) });
  assert.equal(collision.status, 409);
  assert.equal((await fetch(host.origin + host.path + '/jobs/' + randomUUID(), { headers: host.headers })).status, 404);
  assert.equal((await fetch(host.origin + host.path + '/jobs?cursor=malformed', { headers: host.headers })).status, 422);
});

test('DELETE exige key y CAS fuerte, stale no cancela, colisión no se confunde con éxito', async (t) => {
  const broker = fakeBroker(); const host = await setup(t, broker.port); const key = randomUUID();
  await fetch(host.origin + host.path, { method: 'POST', headers: { ...host.headers, 'Idempotency-Key': key }, body: JSON.stringify({ profile: DEFAULT_INFERENCE_PROFILE }) });
  const url = host.origin + host.path + '/jobs/' + broker.receipt.jobId;
  const cancel = (etag?: string, idempotencyKey = randomUUID()) => fetch(url, { method: 'DELETE', headers: { ...host.headers, 'Idempotency-Key': idempotencyKey, ...(etag === undefined ? {} : { 'If-Match': etag }) } });
  assert.equal((await cancel()).status, 428);
  assert.equal((await cancel(`W/"pi-access:${broker.receipt.jobId}:r0"`)).status, 412);
  assert.equal((await cancel(`"pi-access:${randomUUID()}:r0"`)).status, 412);
  assert.equal(broker.cancels, 0);
  broker.setJob({ ...broker.receipt, state: 'running', revision: 1 });
  const stale = await cancel(`"pi-access:${broker.receipt.jobId}:r0"`); assert.equal(stale.status, 412);
  assert.equal((await stale.json()).error.currentEtag, `"pi-access:${broker.receipt.jobId}:r1"`);
  assert.equal((await cancel(`"pi-access:${broker.receipt.jobId}:r1"`, key)).status, 409);
  const result = await cancel(`"pi-access:${broker.receipt.jobId}:r1"`); assert.equal(result.status, 202);
  assert.equal(PiAccessJobReceiptSchema.parse(await result.json()).job.state, 'canceled');
});

test('host sin broker responde dependency sin inventar un resultado', async (t) => {
  const host = await setup(t);
  const response = await fetch(host.origin + host.path + '/jobs', { headers: host.headers });
  assert.equal(response.status, 503); assert.equal((await response.json()).error.safeCode, 'PI_ACCESS_CHECK_UNAVAILABLE');
});

test('metadata distingue rechazo, cancelación e incertidumbre sin promoverlos a passed', async (t) => {
  const broker = fakeBroker(); const host = await setup(t, broker.port);
  const variants = [
    { state: 'failed', resultKind: 'failed', safeCode: 'auth-required' },
    { state: 'failed', resultKind: 'failed', safeCode: 'model-unavailable' },
    { state: 'failed', resultKind: 'ambiguous', safeCode: 'timeout' },
    { state: 'canceled', resultKind: 'aborted', safeCode: 'cancelled-before-dispatch' },
    { state: 'interrupted', resultKind: null, safeCode: 'host-interrupted' },
  ];
  for (const [index, variant] of variants.entries()) {
    broker.setJob({ ...broker.receipt, ...variant, revision: index + 1 });
    const response = await fetch(host.origin + host.path + '/jobs/' + broker.receipt.jobId, { headers: host.headers });
    assert.equal(response.status, 200);
    const job = PiAccessJobViewSchema.parse(await response.json());
    assert.equal(job.resultKind, variant.resultKind); assert.equal(job.safeCode, variant.safeCode);
    assert.equal(job.passedResult, null);
  }
  assert.equal(broker.starts, 0);
  assert.equal(PiAccessJobViewSchema.safeParse({ ...broker.receipt, state: 'failed', resultKind: 'ambiguous', safeCode: 'timeout',
    passedResult: { effectiveProfile: { provider: 'openai-codex', api: 'openai-codex-responses', model: 'gpt-6.1-sol', providerThinkingLevel: null, reasoningEvidence: 'sdk-payload-and-response' },
      measuredUsage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } } }).success, false);
});

test('HTTP rechaza metadata privada del broker sin publicar su contenido', async (t) => {
  const broker = fakeBroker();
  const port: PiAccessCheckJobsApplicationPort = { ...broker.port, readJob() { return { kind: 'found', job: { ...broker.receipt, accountFingerprint: 'SECRET_PRIVATE_CONTENT', rawResponse: 'SECRET_RESPONSE' } }; } };
  const host = await setup(t, port);
  const response = await fetch(host.origin + host.path + '/jobs/' + broker.receipt.jobId, { headers: host.headers });
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /SECRET_PRIVATE_CONTENT|SECRET_RESPONSE|accountFingerprint|rawResponse/);
  assert.equal(broker.starts, 0);
});

test('GET status consulta receipt local de perfil exacto, mantiene stale separado y no inicia inferencia', async (t) => {
  const broker = fakeBroker();
  const observed = { provider: 'openai-codex', api: 'openai-codex-responses', model: 'gpt-6.1-sol', providerThinkingLevel: 'low', reasoningEvidence: 'sdk-payload-and-response' };
  let statusMetadata: unknown = { accessCheck: 'notRun', effectiveProfile: null, safeCode: null };
  let metadataReads = 0;
  const host = await setup(t, { ...broker.port, readPiAccessStatus({ profile }) {
    metadataReads += 1; assert.deepEqual(profile, DEFAULT_INFERENCE_PROFILE); return statusMetadata;
  } }, true);
  const variants = [
    { accessCheck: 'notRun', effectiveProfile: null, safeCode: null },
    { accessCheck: 'passed', effectiveProfile: observed, safeCode: null },
    { accessCheck: 'failed', effectiveProfile: null, safeCode: 'model-unavailable' },
    { accessCheck: 'failed', effectiveProfile: null, safeCode: 'timeout' },
    { accessCheck: 'stale', effectiveProfile: null, safeCode: null },
  ];
  for (const variant of variants) {
    statusMetadata = variant;
    const response = await fetch(host.origin + '/api/v1/integrations/pi/status', { headers: host.headers });
    assert.equal(response.status, 200);
    const text = await response.text();
    const status = PiIntegrationStatusSchema.parse(JSON.parse(text));
    assert.equal(status.authState, 'present'); assert.equal(status.accessCheck, variant.accessCheck);
    assert.deepEqual(status.effectiveProfile, variant.effectiveProfile); assert.equal(status.safeCode, variant.safeCode);
    assert.doesNotMatch(text, /Fingerprint|credential|prompt|sessionPath/);
  }
  assert.equal(metadataReads, variants.length); assert.equal(broker.starts, 0);
  statusMetadata = { accessCheck: 'stale', effectiveProfile: observed, safeCode: null };
  assert.equal((await fetch(host.origin + '/api/v1/integrations/pi/status', { headers: host.headers })).status, 500);
});

test('HTTP integra broker y SQLite reales: found/missing, auth-required local, replay y status sin proveedor', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-http-access-integration-'));
  const journal = openJournal({ path: join(directory, 'journal.sqlite') });
  const sdk = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  let transports = 0;
  const broker = await createPiAccessJobs({ journal, ownerToken: randomUUID(), readCredentialFingerprint: async () => undefined,
    modelRuntime: { getModel: sdk.getModel.bind(sdk), checkAuth: sdk.checkAuth.bind(sdk), isUsingOAuth: sdk.isUsingOAuth.bind(sdk), getAuth: sdk.getAuth.bind(sdk),
      streamSimple() { transports += 1; throw new Error('No transporte autorizado en prueba sin credenciales'); } } });
  t.after(async () => { await broker.close(); journal.close(); rmSync(directory, { recursive: true, force: true }); });
  const host = await setup(t, broker, true);
  const key = randomUUID();
  const start = () => fetch(host.origin + host.path, { method: 'POST', headers: { ...host.headers, 'Idempotency-Key': key }, body: JSON.stringify({ profile: DEFAULT_INFERENCE_PROFILE }) });
  const initial = await start(); assert.equal(initial.status, 202);
  const receipt = PiAccessJobReceiptSchema.parse(await initial.json());
  assert.equal(receipt.job.state, 'queued');
  let latest = receipt.job;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const read = await fetch(host.origin + host.path + '/jobs/' + receipt.job.jobId, { headers: host.headers });
    assert.equal(read.status, 200, await read.clone().text());
    latest = PiAccessJobViewSchema.parse(await read.json());
    assert.equal(read.headers.get('etag'), `"pi-access:${latest.jobId}:r${latest.revision}"`);
    if (latest.state === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(latest.state, 'failed'); assert.equal(latest.resultKind, 'failed'); assert.equal(latest.safeCode, 'auth-required');
  assert.equal(latest.passedResult, null); assert.equal(transports, 0);
  const replay = await start(); assert.equal(replay.status, 202); assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(PiAccessJobReceiptSchema.parse(await replay.json()), receipt);
  const page = PiAccessJobPageSchema.parse(await (await fetch(host.origin + host.path + '/jobs', { headers: host.headers })).json());
  assert.equal(page.items[0]?.jobId, latest.jobId); assert.equal(page.items[0]?.safeCode, 'auth-required');
  assert.equal((await fetch(host.origin + host.path + '/jobs/' + randomUUID(), { headers: host.headers })).status, 404);
  const status = PiIntegrationStatusSchema.parse(await (await fetch(host.origin + '/api/v1/integrations/pi/status', { headers: host.headers })).json());
  assert.equal(status.accessCheck, 'stale'); assert.equal(status.safeCode, null); assert.equal(transports, 0);
  const cancel = await fetch(host.origin + host.path + '/jobs/' + latest.jobId, { method: 'DELETE', headers: { ...host.headers,
    'Idempotency-Key': randomUUID(), 'If-Match': `"pi-access:${latest.jobId}:r${latest.revision}"` } });
  assert.equal(cancel.status, 202);
  assert.equal(PiAccessJobReceiptSchema.parse(await cancel.json()).job.state, 'failed');
});
