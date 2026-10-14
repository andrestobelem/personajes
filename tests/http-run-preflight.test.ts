import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { SessionCreatedSchema, RunPreflightJobReceiptSchema, RunPreflightJobDocumentSchema, RunPreflightJobPageSchema } from '../src/domain/http.ts';
import { RunPreflightJobViewSchema } from '../src/domain/run-preflight-jobs.ts';
import { createLocalHttpServer, type RunPreflightJobsApplicationPort } from '../src/server/http.ts';

function controlledPreflight() {
  const runId = randomUUID(); const jobId = randomUUID();
  const original = RunPreflightJobViewSchema.parse({ kind: 'run-preflight-job', runId, jobId, state: 'queued', revision: 0,
    createdAt: '2026-10-14T12:00:00.000Z', updatedAt: '2026-10-14T12:00:00.000Z', configurationRevision: 1,
    worldRevision: 2, worldSeq: 3, fictitiousAt: 1_000, resultKind: null, safeCode: null });
  let current = original; let key: string | undefined; let starts = 0; let cancels = 0;
  let startOverride: unknown;
  let report = RunPreflightJobDocumentSchema.shape.report.parse({ kind: 'current', result: null });
  const offsets: number[] = [];
  const port: RunPreflightJobsApplicationPort = {
    start(input) {
      starts += 1;
      if (input.runId !== runId) return { kind: 'missing' };
      if (key !== undefined && input.idempotencyKey === key) return { kind: 'existing', job: original };
      if (startOverride !== undefined) return startOverride;
      if (input.expectedConfigurationRevision !== 1 || input.expectedWorldRevision !== 2) return { kind: 'stale', currentConfigurationRevision: 1, currentWorldRevision: 2 };
      key = input.idempotencyKey; return { kind: 'created', job: original };
    },
    readJob(input) { return input.runId === runId && input.jobId === jobId ? { kind: 'found', job: current, report } : { kind: 'missing' }; },
    listJobs(input) {
      offsets.push(input.offset);
      return { kind: 'run-preflight-job-page', items: input.runId === runId && input.offset === 0 ? [{ kind: 'run-preflight-job-document', job: current, report }] : [],
        nextCursor: input.offset === 0 ? 'p1.' + Buffer.from('1').toString('base64url') : null, truncated: false };
    },
    cancelJob(input) {
      cancels += 1;
      if (input.runId !== runId || input.jobId !== jobId) return { kind: 'missing' };
      if (input.idempotencyKey === key) return { kind: 'idempotencyConflict' };
      if (current.state === 'completed') return { kind: 'terminal', job: current };
      if (input.expectedRevision !== current.revision) return { kind: 'stale', job: current };
      current = RunPreflightJobViewSchema.parse({ ...current, state: 'canceled', revision: current.revision + 1, safeCode: 'user-canceled' });
      return { kind: 'updated', job: current };
    },
  };
  return { port, runId, jobId, original, offsets, get starts() { return starts; }, get cancels() { return cancels; },
    overrideStart(value: unknown) { startOverride = value; },
    update(job: unknown, nextReport: unknown = report) { current = RunPreflightJobViewSchema.parse(job); report = RunPreflightJobDocumentSchema.shape.report.parse(nextReport); } };
}

async function setup(t: TestContext, runPreflightJobs?: RunPreflightJobsApplicationPort) {
  const server = createLocalHttpServer({ catalog: await loadCatalog({ repositoryRoot: process.cwd() }), shellHtml: '<!doctype html><html><head></head><body></body></html>',
    ...(runPreflightJobs === undefined ? {} : { runPreflightJobs }) });
  const { origin } = await server.listen(); t.after(() => server.close());
  const sameOrigin = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
  const html = await (await fetch(origin + '/', { headers: sameOrigin })).text();
  const nonce = html.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1]; assert.ok(nonce);
  const session = await fetch(origin + '/api/v1/session', { method: 'POST', headers: { ...sameOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ bootNonce: nonce }) });
  const cookie = session.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  const { csrfToken } = SessionCreatedSchema.parse(await session.json());
  return { origin, headers: { ...sameOrigin, Cookie: cookie, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' } };
}

test('preflight exige operador, CSRF, key, body vacío y ETag compuesto exacto antes de crear un job', async (t) => {
  const h = controlledPreflight(); const host = await setup(t, h.port); const path = `/api/v1/runs/${h.runId}/preflight`;
  const post = (etag?: string, body = '{}', headers = host.headers) => fetch(host.origin + path, { method: 'POST', headers: {
    ...headers, 'Idempotency-Key': randomUUID(), ...(etag === undefined ? {} : { 'If-Match': etag }) }, body });
  assert.equal((await post()).status, 428);
  for (const etag of [`W/"run:${h.runId}:c1:w2"`, `"run-config:${h.runId}:c1"`, `"run:${randomUUID()}:c1:w2"`, `"run:${h.runId}:c9007199254740992:w2"`]) assert.equal((await post(etag)).status, 412);
  assert.equal((await post(`"run:${h.runId}:c1:w2"`, '{"forcePassed":true}')).status, 422);
  assert.equal((await post(`"run:${h.runId}:c1:w2"`, '{}', { ...host.headers, 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await post(`"run:${h.runId}:c1:w2"`, '{}', { ...host.headers, Origin: 'https://foreign.example' })).status, 403);
  const noKey = await fetch(host.origin + path, { method: 'POST', headers: { ...host.headers, 'If-Match': `"run:${h.runId}:c1:w2"` }, body: '{}' });
  assert.equal(noKey.status, 400); assert.equal(h.starts, 0);
});

test('preflight receipt se conserva tras completar y GET expone bloqueo/current/stale con job ETag y scope run', async (t) => {
  const h = controlledPreflight(); const host = await setup(t, h.port); const key = randomUUID(); const path = `/api/v1/runs/${h.runId}/preflight`;
  const post = () => fetch(host.origin + path, { method: 'POST', headers: { ...host.headers, 'Idempotency-Key': key, 'If-Match': `"run:${h.runId}:c1:w2"` }, body: '{}' });
  const initial = await post(); assert.equal(initial.status, 202); const receipt = RunPreflightJobReceiptSchema.parse(await initial.json());
  assert.equal(initial.headers.get('location'), `${path}/jobs/${h.jobId}`); assert.equal(initial.headers.get('etag'), `"run-preflight:${h.jobId}:r0"`);
  const report = { kind: 'current', result: { kind: 'blocked', checkedAt: '2026-10-14T12:00:00.000Z', checks: [{ kind: 'unavailable', checkId: 'provider-authentication' }, { kind: 'blocked', checkId: 'provider-access-check' }] } };
  const completed = { ...h.original, state: 'completed', revision: 2, resultKind: 'blocked' };
  h.update(completed, report);
  const replay = await post(); assert.equal(replay.status, 202); assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(RunPreflightJobReceiptSchema.parse(await replay.json()), receipt);
  const read = await fetch(host.origin + `${path}/jobs/${h.jobId}`, { headers: host.headers }); assert.equal(read.status, 200);
  assert.equal(read.headers.get('etag'), `"run-preflight:${h.jobId}:r2"`); const text = await read.text();
  assert.deepEqual(RunPreflightJobDocumentSchema.parse(JSON.parse(text)).report, report);
  assert.doesNotMatch(text, /Fingerprint|configurationHash|sessionPath|prompt|history|detail/);
  h.update(completed, { ...report, kind: 'stale' });
  const stale = RunPreflightJobDocumentSchema.parse(await (await fetch(host.origin + `${path}/jobs/${h.jobId}`, { headers: host.headers })).json());
  assert.equal(stale.report.kind, 'stale'); assert.equal(stale.report.result?.kind, 'blocked');
  const page = RunPreflightJobPageSchema.parse(await (await fetch(host.origin + `${path}/jobs?limit=1`, { headers: host.headers })).json());
  assert.equal(page.items[0]?.report.kind, 'stale'); assert.ok(page.nextCursor);
  const next = await fetch(host.origin + `${path}/jobs?limit=1&cursor=${page.nextCursor}`, { headers: host.headers });
  assert.deepEqual(RunPreflightJobPageSchema.parse(await next.json()).items, []); assert.deepEqual(h.offsets, [0, 1]);
  assert.equal((await fetch(host.origin + `/api/v1/runs/${randomUUID()}/preflight/jobs/${h.jobId}`, { headers: host.headers })).status, 404);
  assert.equal((await fetch(host.origin + `${path}/jobs/${randomUUID()}`, { headers: host.headers })).status, 404);
});

test('preflight clasifica Ready ausente, configuración inválida, stale y colisión idempotente sin fabricar éxito', async (t) => {
  const h = controlledPreflight(); const host = await setup(t, h.port); const path = `/api/v1/runs/${h.runId}/preflight`;
  for (const variant of [
    { value: { kind: 'missing' }, status: 404 },
    { value: { kind: 'invalidLifecycle', lifecycle: 'running' }, status: 409 },
    { value: { kind: 'invalidConfiguration' }, status: 409 },
    { value: { kind: 'idempotencyConflict' }, status: 409 },
    { value: { kind: 'stale', currentConfigurationRevision: 2, currentWorldRevision: 4 }, status: 412 },
  ]) {
    h.overrideStart(variant.value);
    const response = await fetch(host.origin + path, { method: 'POST', headers: { ...host.headers, 'Idempotency-Key': randomUUID(), 'If-Match': `"run:${h.runId}:c1:w2"` }, body: '{}' });
    assert.equal(response.status, variant.status); const problem = await response.json();
    if (variant.status === 412) assert.equal(problem.error.currentEtag, `"run:${h.runId}:c2:w4"`);
  }
});

test('cancelación preflight exige revisión de job y key; terminal bloqueado devuelve el resultado conservado', async (t) => {
  const h = controlledPreflight(); const host = await setup(t, h.port); const path = `/api/v1/runs/${h.runId}/preflight/jobs/${h.jobId}`;
  const cancel = (etag?: string, key = randomUUID()) => fetch(host.origin + path, { method: 'DELETE', headers: { ...host.headers, 'Idempotency-Key': key, ...(etag === undefined ? {} : { 'If-Match': etag }) } });
  assert.equal((await cancel()).status, 428); assert.equal((await cancel(`W/"run-preflight:${h.jobId}:r0"`)).status, 412); assert.equal(h.cancels, 0);
  h.update({ ...h.original, state: 'running', revision: 1 });
  const stale = await cancel(`"run-preflight:${h.jobId}:r0"`); assert.equal(stale.status, 412); assert.equal((await stale.json()).error.currentEtag, `"run-preflight:${h.jobId}:r1"`);
  const canceled = await cancel(`"run-preflight:${h.jobId}:r1"`); assert.equal(canceled.status, 202); assert.equal(RunPreflightJobReceiptSchema.parse(await canceled.json()).job.state, 'canceled');
  h.update({ ...h.original, state: 'completed', revision: 2, resultKind: 'blocked' }, { kind: 'current', result: { kind: 'blocked', checkedAt: '2026-10-14T12:00:00.000Z', checks: [{ checkId: 'provider-access-check', kind: 'blocked' }] } });
  const terminal = await cancel(`"run-preflight:${h.jobId}:r2"`); assert.equal(terminal.status, 200); assert.equal(RunPreflightJobReceiptSchema.parse(await terminal.json()).job.resultKind, 'blocked');
});

test('HTTP preflight falla cerrado ante metadata privada/ámbito extraño y host sin puerto', async (t) => {
  const h = controlledPreflight();
  const unsafe: RunPreflightJobsApplicationPort = { ...h.port, readJob: async () => ({ kind: 'found', job: h.original, report: { kind: 'current', result: null }, accountFingerprint: 'SECRET_FINGERPRINT' }) };
  // Runtime parsing protects even an untyped integration port with an unexpected field.
  const host = await setup(t, { ...unsafe, listJobs: () => ({ kind: 'run-preflight-job-page', items: [{ kind: 'run-preflight-job-document', job: { ...h.original, runId: randomUUID() }, report: { kind: 'current', result: null } }], nextCursor: null, truncated: false }) });
  const privateRead = await fetch(host.origin + `/api/v1/runs/${h.runId}/preflight/jobs/${h.jobId}`, { headers: host.headers });
  assert.equal(privateRead.status, 500); assert.doesNotMatch(await privateRead.text(), /SECRET_FINGERPRINT|accountFingerprint/);
  const response = await fetch(host.origin + `/api/v1/runs/${h.runId}/preflight/jobs`, { headers: host.headers });
  assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /SECRET_FINGERPRINT/);
  const absent = await setup(t);
  assert.equal((await fetch(absent.origin + `/api/v1/runs/${h.runId}/preflight/jobs/${h.jobId}`, { headers: absent.headers })).status, 503);
});
