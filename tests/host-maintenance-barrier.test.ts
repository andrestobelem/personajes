import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { operatorJson } from '../src/server/operator-extension.ts';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { ApiProblemSchema, SessionCreatedSchema } from '../src/domain/http.ts';

test('resource maintenance waits for its start receipt, permits job reads and excludes backup/recovery', async () => {
  const barrier = createHostRequestBarrier();
  const path = ['api', 'v1', 'runs', randomUUID(), 'memory-preparations'];
  const finishStart = barrier.enter({ method: 'POST', path });
  let acquired = false;
  const acquiring = barrier.acquireMaintenance().then((release) => { acquired = true; return release; });
  assert.equal(barrier.isMaintaining, true);
  await Promise.resolve(); assert.equal(acquired, false);
  const finishRead = barrier.enter({ method: 'GET', path: [...path, randomUUID()] });
  finishStart(); await Promise.resolve(); assert.equal(acquired, false);
  finishRead(); const release = await acquiring;
  try {
    barrier.enter({ method: 'GET', path })();
    barrier.enter({ method: 'GET', path: [...path, randomUUID()] })();
    barrier.enter({ method: 'GET', path: [] })();
    barrier.enter({ method: 'GET', path: ['api', 'v1', 'session'] })();
    for (const path of [ ['api', 'v1', 'host', 'icm-runtime-configuration'], ['api', 'v1', 'host', 'icm-runtime-configuration', 'jobs'], ['api', 'v1', 'host', 'icm-runtime-configuration', 'jobs', randomUUID()] ]) barrier.enter({ method: 'GET', path })();
    assert.throws(() => barrier.enter({ method: 'POST', path: ['api', 'v1', 'host', 'icm-runtime-configuration', 'jobs'] }), /HOST_MAINTENANCE_IN_PROGRESS/);
    for (const request of [{ method: 'POST', path }, { method: 'GET', path: ['api', 'v1', 'health'] }, { method: 'GET', path: ['api', 'v1', 'backups', randomUUID()] }]) assert.throws(() => barrier.enter(request), /HOST_MAINTENANCE_IN_PROGRESS/);
    await assert.rejects(barrier.acquire(), /BACKUP_BARRIER_BUSY/);
    await assert.rejects(barrier.acquireRecovery(), /HOST_RECOVERY_BUSY/);
  } finally { release(); release(); }
  assert.equal(barrier.isHeld, false);
  barrier.enter({ method: 'POST', path })();
});

test('maintenance HTTP keeps authenticated resource polling and session available, blocks other operations explicitly', async () => {
  const barrier = createHostRequestBarrier();
  let reads = 0;
  const server = createLocalHttpServer({ catalog: await loadCatalog({ repositoryRoot: process.cwd() }), shellHtml: '<html><head></head><body></body></html>', admissionBarrier: barrier,
    operatorExtensions: [{ name: 'maintenance-test', matches: ({ path }) => path[0] === 'runs' && path[2] === 'memory-preparations', handle() { reads++; return operatorJson({ kind: 'test-job' }); } }] });
  try {
    const { origin } = await server.listen();
    const originHeaders = { Origin: origin, 'Content-Type': 'application/json' };
    const shell = await fetch(origin + '/', { headers: originHeaders });
    const nonce = (await shell.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1]; assert.ok(nonce);
    const session = await fetch(origin + '/api/v1/session', { method: 'POST', headers: originHeaders, body: JSON.stringify({ bootNonce: nonce }) });
    const credentials = SessionCreatedSchema.parse(await session.json());
    const cookie = session.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    const headers = { ...originHeaders, Cookie: cookie, 'X-CSRF-Token': credentials.csrfToken };
    const release = await barrier.acquireMaintenance();
    try {
      for (const path of [`/api/v1/runs/${randomUUID()}/memory-preparations`, `/api/v1/runs/${randomUUID()}/memory-preparations/${randomUUID()}`]) {
        assert.equal((await fetch(origin + path, { headers: originHeaders })).status, 401);
        assert.equal((await fetch(origin + path, { headers })).status, 200);
      }
      assert.equal(reads, 2);
      assert.equal((await fetch(origin + '/api/v1/session', { headers })).status, 200);
      for (const path of ['/api/v1/health', `/api/v1/backups/${randomUUID()}`]) {
        const response = await fetch(origin + path, { headers });
        assert.equal(response.status, 503);
        assert.equal(ApiProblemSchema.parse(await response.json()).error.code, 'HOST_MAINTENANCE_IN_PROGRESS');
      }
      const response = await fetch(origin + `/api/v1/runs/${randomUUID()}/memory-preparations`, { method: 'POST', headers, body: '{}' });
      assert.equal(response.status, 503);
      assert.equal(reads, 2);
    } finally { release(); }
  } finally { await server.close(); }
});
