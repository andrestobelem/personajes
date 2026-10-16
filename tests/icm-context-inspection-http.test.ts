import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { createIcmContextInspectionRoutes } from '../src/server/icm-context-inspection-routes.ts';
import { IcmContextInspectionPageSchema } from '../src/domain/icm-context-inspection.ts';
import { SessionCreatedSchema } from '../src/domain/http.ts';
import { createIcmContextInspectionClient, IcmInspectionRejection } from '../src/web/icm-context-inspection-client.ts';
import { icmInspectionFixture } from './fixtures/icm-inspection.ts';

test('HTTP real exige opt-in privado de esta corrida antes de leer journal; modo no concede permiso y revocación es inmediata', async () => {
  const f = await icmInspectionFixture(); const { actor } = await f.packets(); let reads = 0;
  const server = createLocalHttpServer({ catalog: await loadCatalog({ repositoryRoot: process.cwd() }), shellHtml: '<html><head></head><body></body></html>',
    resolveSessionMode: candidate => candidate, authorizeObserverView: runId => runId === f.runId,
    operatorExtensions: [createIcmContextInspectionRoutes({ journal: { readIcmContextPacketInspection(input) { reads++; return f.journal.readIcmContextPacketInspection(input); } } })] });
  try {
    const { origin } = await server.listen();
    const path = `/api/v1/runs/${f.runId}/icm-context-packets`;
    assert.equal((await fetch(origin + path)).status, 401); assert.equal(reads, 0);
    const html = await (await fetch(origin + '/')).text(); const nonce = html.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1]; assert.ok(nonce);
    const login = await fetch(origin + '/api/v1/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ bootNonce: nonce }) });
    const session = SessionCreatedSchema.parse(await login.json()); const cookie = login.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    const request: typeof fetch = (url, init) => fetch(new URL(String(url), origin), { ...init, headers: { Origin: origin, Cookie: cookie, ...Object.fromEntries(new Headers(init?.headers)) } });
    let etag = login.headers.get('etag'); assert.ok(etag);
    const headers = () => { assert.ok(etag); return { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken, 'If-Match': etag, 'Idempotency-Key': randomUUID() }; };
    for (const mode of [{ kind: 'observer' }, { kind: 'director', runId: f.runId, scope: { kind: 'run' } }, { kind: 'interlocutor', runId: f.runId, participantId: 'visitante-prueba' }]) {
      const changed = await request('/api/v1/session/mode', { method: 'PUT', headers: headers(), body: JSON.stringify(mode) }); assert.equal(changed.status, 200); etag = changed.headers.get('etag'); assert.ok(etag);
      assert.equal((await request(path)).status, 403); assert.equal(reads, 0);
    }
    const preference = async (mode: 'internal' | 'stage') => {
      const response = await request(`/api/v1/runs/${f.runId}/observer-view`, { method: 'PUT', headers: headers(), body: JSON.stringify(mode === 'internal' ? { mode, confirm: true } : { mode }) });
      assert.equal(response.status, 200); etag = response.headers.get('etag'); assert.ok(etag);
    };
    await preference('internal');
    const client = createIcmContextInspectionClient(request, async () => session);
    const page = await client.read({ runId: f.runId, filters: { role: 'actor', actorId: f.actorId, jobId: actor.scope.jobId }, offset: 0, limit: 1 }, new AbortController().signal);
    assert.equal(page.total, 1); assert.equal(page.items[0]?.kind, 'verified'); assert.equal(reads, 1);
    const response = await request(path); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const publicText = await response.text(); assert.doesNotMatch(publicText, /PRIVATE_|SECRET_|Markdown|sessionPath|hostPolicy|diegeticContext/); IcmContextInspectionPageSchema.parse(JSON.parse(publicText));
    const prior = reads;
    for (const query of ['limit=101', 'offset=-1', 'role=actor&role=director', 'unknown=secret', 'role=director&actorId=foreign', 'jobId=not-a-job']) assert.equal((await request(`${path}?${query}`)).status, 422, query);
    assert.equal(reads, prior, 'invalid filters never reach journal');
    assert.equal((await request(`/api/v1/runs/${randomUUID()}/icm-context-packets`)).status, 403); assert.equal(reads, prior);
    assert.equal((await request(path, { method: 'PUT', headers: headers(), body: '{}' })).status, 405); assert.equal(reads, prior);
    await preference('stage');
    await assert.rejects(client.read({ runId: f.runId, filters: {}, offset: 0, limit: 25 }, new AbortController().signal), error => error instanceof IcmInspectionRejection && error.status === 403);
    assert.equal(reads, prior);
  } finally { await server.close(); f.close(); }
});

test('cliente rechaza páginas de otra corrida/filtro y clasifica 401/403 aunque no tengan JSON', async () => {
  const f = await icmInspectionFixture();
  try {
    await f.packets(); const page = f.read(); assert.ok(page);
    const bootstrap = async () => SessionCreatedSchema.parse({ csrfToken: 'synthetic_csrf_012345678901234567890', expiresAt: '2099-01-01T00:00:00Z' });
    for (const body of [{ ...page, runId: randomUUID() }, { ...page, filters: { role: 'actor' } }, { ...page, offset: 1 }]) {
      const api = createIcmContextInspectionClient(async () => Response.json(body), bootstrap);
      await assert.rejects(api.read({ runId: f.runId, filters: {}, offset: 0, limit: 25 }, new AbortController().signal));
    }
    for (const status of [401, 403]) {
      const api = createIcmContextInspectionClient(async () => new Response('', { status }), bootstrap);
      await assert.rejects(api.read({ runId: f.runId, filters: {}, offset: 0, limit: 25 }, new AbortController().signal), error => error instanceof IcmInspectionRejection && error.status === status);
    }
  } finally { f.close(); }
});
