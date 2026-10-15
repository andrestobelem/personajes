import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { createMemoryPreparationRoutes } from '../src/server/memory-preparation-routes.ts';
import { MemoryPreparationJobSchema, MemoryPreparationRequestSchema, memoryPreparationContextEtag, memoryPreparationJobEtag, type MemoryPreparationRequest } from '../src/domain/memory-preparation.ts';
import { SessionCreatedSchema } from '../src/domain/http.ts';
const runId = randomUUID(); const jobId = randomUUID();
const context = MemoryPreparationRequestSchema.pick({ runId: true, expectedConfigurationRevision: true, expectedWorldRevision: true }).parse({ runId, expectedConfigurationRevision: 2, expectedWorldRevision: 4 });
const job = MemoryPreparationJobSchema.parse({ kind: 'memory-preparation-job', jobId, ...context, principalId: 'local-operator', purpose: 'initialize-empty', state: 'queued', revision: 0, configurationHash: 'a'.repeat(64), contextETag: memoryPreparationContextEtag(context), actors: [{ actorId: 'maxwell-smart', state: 'pending' }], failureCode: null, createdAt: 1, updatedAt: 1, completedAt: null });
async function setup() {
  const calls: MemoryPreparationRequest[] = []; let readCalls = 0; let listCalls = 0;
  const application = { start(input: MemoryPreparationRequest) { calls.push(input); return { kind: calls.length === 1 ? 'accepted' : 'existing', job }; }, read(input: { runId: string; principalId: string; jobId: string }) { ++readCalls; return input.runId === runId && input.principalId === job.principalId && input.jobId === jobId ? job : undefined; }, list(input: { runId: string; principalId: string }) { ++listCalls; return { jobs: input.runId === runId && input.principalId === job.principalId ? [job] : [], nextCursor: null }; } };
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  const server = createLocalHttpServer({ catalog, shellHtml: '<html><head></head><body></body></html>', operatorExtensions: [createMemoryPreparationRoutes({ application })] });
  const { origin } = await server.listen(0); const security = { Origin: origin, 'Content-Type': 'application/json' };
  const html = await (await fetch(origin + '/', { headers: security })).text(); const bootNonce = html.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1]; assert.ok(bootNonce);
  const session = await fetch(origin + '/api/v1/session', { method: 'POST', headers: security, body: JSON.stringify({ bootNonce }) }); const { csrfToken } = SessionCreatedSchema.parse(await session.json()); const cookie = session.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  return { origin, calls, get readCalls() { return readCalls; }, get listCalls() { return listCalls; }, headers: { ...security, Cookie: cookie, 'X-CSRF-Token': csrfToken }, close: () => server.close() };
}
test('HTTP memory preparation requires local auth CSRF key and exactcut; GET recovery never starts work', async t => {
  const host = await setup(); t.after(host.close); const path = host.origin + `/api/v1/runs/${runId}/memory-preparations`; const body = JSON.stringify({ expectedConfigurationRevision: 2, expectedWorldRevision: 4 }); const key = randomUUID();
  assert.equal((await fetch(path + '/' + jobId)).status, 401);
  const noCsrf = { ...host.headers, 'X-CSRF-Token': '' };
  assert.equal((await fetch(path, { method: 'POST', headers: { ...noCsrf, 'Idempotency-Key': key, 'If-Match': memoryPreparationContextEtag(context) }, body })).status, 403);
  assert.equal((await fetch(path, { method: 'POST', headers: { ...host.headers, 'If-Match': memoryPreparationContextEtag(context) }, body })).status, 400);
  assert.equal((await fetch(path, { method: 'POST', headers: { ...host.headers, 'Idempotency-Key': key }, body })).status, 412); assert.equal(host.calls.length, 0);
  const headers = { ...host.headers, 'Idempotency-Key': key, 'If-Match': memoryPreparationContextEtag(context) };
  for (let index = 0; index < 2; ++index) { const response = await fetch(path, { method: 'POST', headers, body }); assert.equal(response.status, 202, await response.clone().text()); assert.equal(response.headers.get('etag'), memoryPreparationJobEtag(job)); assert.equal(MemoryPreparationJobSchema.parse(await response.json()).jobId, jobId); }
  assert.equal(host.calls.length, 2); assert.equal(host.calls[0]?.principalId, 'local-operator'); assert.equal(host.calls[0]?.idempotencyKey, key); assert.deepEqual(host.calls[0], host.calls[1]);
  const known = await fetch(path + '/' + jobId, { headers: host.headers }); assert.equal(known.status, 200); assert.equal(known.headers.get('etag'), memoryPreparationJobEtag(job));
  const listed = await fetch(path + '?limit=10', { headers: host.headers }); assert.equal(listed.status, 200); assert.equal(host.calls.length, 2); assert.equal(host.listCalls, 1); assert.equal(host.readCalls, 1);
  const missing = await fetch(path + '/' + randomUUID(), { headers: host.headers }); const foreignRun = await fetch(host.origin + `/api/v1/runs/${randomUUID()}/memory-preparations/${jobId}`, { headers: host.headers }); assert.equal(missing.status, 404); assert.equal(foreignRun.status, 404);
});
test('memory preparation rejects injected identity, duplicate queries, unsafe details and stalecontext', async t => {
  const host = await setup(); t.after(host.close); const path = host.origin + `/api/v1/runs/${runId}/memory-preparations`;
  const headers = { ...host.headers, 'Idempotency-Key': randomUUID(), 'If-Match': memoryPreparationContextEtag(context) };
  const injected = await fetch(path, { method: 'POST', headers, body: JSON.stringify({ expectedConfigurationRevision: 2, expectedWorldRevision: 4, principalId: 'another-operator', binaryPath: '/PRIVATE_PATH' }) }); assert.equal(injected.status, 422); assert.doesNotMatch(await injected.text(), /PRIVATE_PATH|another-operator/);
  for (const query of ['?limit=0', '?limit=1&limit=2', '?principalId=another-operator']) assert.equal((await fetch(path + query, { headers: host.headers })).status, 422);
  assert.equal(host.calls.length, 0); assert.equal(host.listCalls, 0);
});
