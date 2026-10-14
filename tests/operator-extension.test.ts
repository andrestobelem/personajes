import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { z } from 'zod';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { SessionCreatedSchema } from '../src/domain/http.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { operatorJson, type OperatorExtension, type OperatorRequest } from '../src/server/operator-extension.ts';

async function host(t: TestContext, extension: OperatorExtension) {
  const server = createLocalHttpServer({ catalog: await loadCatalog({ repositoryRoot: process.cwd() }),
    shellHtml: '<!doctype html><html><head></head><body></body></html>', operatorExtensions: [extension] });
  const { origin } = await server.listen();
  t.after(() => server.close());
  const originHeaders = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
  const shell = await fetch(origin + '/', { headers: originHeaders });
  const nonce = (await shell.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];
  assert.ok(nonce);
  const response = await fetch(origin + '/api/v1/session', { method: 'POST', headers: { ...originHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ bootNonce: nonce }) });
  const cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  const session = SessionCreatedSchema.parse(await response.json());
  return { origin, originHeaders, headers: { ...originHeaders, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken } };
}

test('servicios de operador comparten sesión/CSRF/key y reciben sólo autoridad derivada por host', async t => {
  const calls: OperatorRequest[] = [];
  const extension: OperatorExtension = {
    name: 'local-fixture', matches: ({ path }) => path[0] === 'fixture-extension',
    handle(input) { calls.push(input); return operatorJson({ accepted: true }); },
  };
  const service = await host(t, extension);
  const url = service.origin + '/api/v1/fixture-extension';
  assert.equal((await fetch(url, { headers: service.originHeaders })).status, 401);
  const noCsrf = { ...service.headers }; Reflect.deleteProperty(noCsrf, 'X-CSRF-Token');
  assert.equal((await fetch(url, { method: 'POST', headers: { ...noCsrf, 'Idempotency-Key': randomUUID() }, body: '{}' })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: service.headers, body: '{}' })).status, 400);
  assert.equal(calls.length, 0);
  const key = randomUUID();
  const response = await fetch(url, { method: 'POST', headers: { ...service.headers, 'Idempotency-Key': key, 'If-Match': '"fixture:r2"' }, body: '{}' });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const request = calls[0]; assert.ok(request);
  assert.equal(request.kind, 'write');
  if (request.kind !== 'write') assert.fail('Expected host write authority');
  assert.equal(request.idempotencyKey, key);
  assert.equal(request.ifMatch, '"fixture:r2"');
  assert.deepEqual(request.mode, { kind: 'observer' });
  assert.equal('headers' in request, false); assert.equal('cookie' in request, false); assert.equal('csrfToken' in request, false);
});

test('extensión valida request sin filtrar valores y comprueba bytes antes de servir artefacto', async t => {
  const bytes = new TextEncoder().encode('audio fixture');
  const extension: OperatorExtension = {
    name: 'fixture-artifact', matches: ({ path }) => path[0] === 'fixture-extension',
    handle(input) {
      if (input.kind === 'write') { z.strictObject({ selected: z.boolean() }).parse(input.body); return operatorJson({ selected: true }); }
      return { kind: 'binary', status: 200, mimeType: 'audio/mpeg', bytes,
        sha256: input.query.has('corrupt') ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex'), filename: 'fixture.mp3' };
    },
  };
  const service = await host(t, extension); const url = service.origin + '/api/v1/fixture-extension';
  const secretMarker = 'private-value-should-not-appear';
  const badInput = await fetch(url, { method: 'POST', headers: { ...service.headers, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ selected: secretMarker }) });
  assert.equal(badInput.status, 422); assert.equal((await badInput.text()).includes(secretMarker), false);
  const corrupt = await fetch(url + '?corrupt=1', { headers: service.headers });
  assert.equal(corrupt.status, 500); assert.equal((await corrupt.text()).includes('Artifact checksum'), false);
  const artifact = await fetch(url, { headers: service.headers });
  assert.equal(artifact.status, 200); assert.equal(artifact.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual(new Uint8Array(await artifact.arrayBuffer()), bytes);
});

test('límites de extensión no amplían los límites de rutas existentes ni aceptan cuerpos fuera de contrato', async t => {
  let calls = 0;
  const extension: OperatorExtension = {
    name: 'bounded-fixture', maxBodyBytes: 32,
    matches: ({ path }) => path[0] === 'fixture-extension',
    handle() { calls += 1; return operatorJson({ accepted: true }); },
  };
  const service = await host(t, extension);
  const response = await fetch(service.origin + '/api/v1/fixture-extension', { method: 'POST', headers: { ...service.headers, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ text: 'x'.repeat(33) }) });
  assert.equal(response.status, 413); assert.equal(calls, 0);
  const catalog = await fetch(service.origin + '/api/v1/catalog', { headers: service.headers });
  assert.equal(catalog.status, 200); assert.equal(calls, 0);
});
