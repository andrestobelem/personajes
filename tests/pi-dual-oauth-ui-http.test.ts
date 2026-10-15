import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { PiIntegrationStatusSchema, PiOAuthInteractionViewSchema, PiOAuthJobViewSchema } from '../src/domain/http.ts';
import { PiAccessStatus, PiOAuthJobStatus } from '../src/web/PiAccessPanel.tsx';
import { buildPiOAuthRequest, piJobEtag } from '../src/web/pi-access-client.ts';
const jobId = '88888888-8888-4888-8888-888888888888';
const challengeId = '99999999-9999-4999-8999-999999999999';
const job = PiOAuthJobViewSchema.parse({ kind: 'pi-oauth-job', jobId, provider: 'anthropic', operation: 'login', state: 'running', revision: 1, createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', safeCode: null });

test('Claude OAuth presenta autorización oficial y campo efímero; selector manda proveedor exacto', () => {
  const value = PiIntegrationStatusSchema.parse({ kind: 'pi-integration-status', provider: 'anthropic', requiredProfile: { provider: 'anthropic', model: 'claude-opus-5-5', thinking: 'medium' }, authState: 'missing', effectiveProfile: null, accessCheck: 'notRun', checkedAt: '2026-10-15T00:00:00Z', safeCode: null });
  const status = renderToStaticMarkup(React.createElement(PiAccessStatus, { status: { kind: 'ready', value } }));
  assert.match(status, /claude-opus-5-5/); assert.match(status, /medium/); assert.doesNotMatch(status, /gpt-6.1-sol/);
  const interaction = PiOAuthInteractionViewSchema.parse({ kind: 'authorization-code', cursor: 1, authorizationUrl: 'https://claude.ai/oauth/authorize?state=PUBLIC_STATE', challengeId, expiresAt: '2026-10-15T00:10:00Z' });
  const markup = renderToStaticMarkup(React.createElement(PiOAuthJobStatus, { document: { job, etag: piJobEtag(job) }, interaction, onAuthorize() {} }));
  assert.match(markup, /type="password"/); assert.match(markup, /Autorizar en Claude/); assert.match(markup, /no se guarda en el navegador/);
  assert.equal(PiOAuthInteractionViewSchema.safeParse({ ...interaction, authorizationUrl: 'https://claude.ai.evil.test/oauth/authorize' }).success, false);
  assert.equal(PiOAuthInteractionViewSchema.safeParse({ ...interaction, authorizationUrl: 'https://user@claude.ai/oauth/authorize' }).success, false);
  const login = buildPiOAuthRequest({ intent: { kind: 'login', key: jobId, provider: 'anthropic' }, csrfToken: 'csrf' });
  assert.equal(login.init.body, '{"provider":"anthropic"}');
  const logout = buildPiOAuthRequest({ intent: { kind: 'logout', key: jobId, provider: 'anthropic' }, csrfToken: 'csrf' });
  assert.equal(logout.path, '/api/v1/integrations/pi/oauth?provider=anthropic');
});

test('HTTP enruta proveedor y código una vez con CSRF y scope; no expone código en respuesta', async t => {
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  const providers: unknown[] = []; const replies: unknown[] = [];
  let result: 'accepted' | 'stale' = 'accepted';
  const server = createLocalHttpServer({ catalog, shellHtml: '<html><head></head><body></body></html>', piOAuthJobs: {
    status(input) { providers.push(input); return { kind: 'status', value: { provider: 'anthropic', configuration: 'oauth-required', accountAccess: 'not-verified' } }; },
    startLogin(input) { providers.push(input); return { kind: 'created', job }; }, startLogout(input) { providers.push(input); return { kind: 'created', job: { ...job, operation: 'logout' } }; },
    readJob() { return job; }, listJobs() { return { kind: 'pi-oauth-job-page', items: [job], nextCursor: null, truncated: false }; }, cancelJob() { return { kind: 'terminal', job }; }, readInteraction() { return { kind: 'waiting', cursor: 0 }; },
    respondInteraction(input) { replies.push(input); return { kind: result }; },
  } });
  const address = await server.listen(0); t.after(() => server.close());
  const origin = address.origin; const sameOrigin = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
  const html = await (await fetch(origin + '/', { headers: sameOrigin })).text();
  const bootNonce = html.match(/<meta name="personajes-bootstrap" content="([A-Za-z0-9_-]{43})">/)?.[1]; assert.ok(bootNonce);
  const session = await fetch(origin + '/api/v1/session', { method: 'POST', headers: { ...sameOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ bootNonce }) });
  const { csrfToken } = z.object({ csrfToken: z.string() }).parse(await session.json()); const cookie = session.headers.get('set-cookie')?.split(';', 1)[0]; assert.ok(cookie);
  const headers = { ...sameOrigin, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken };
  const status = await fetch(origin + '/api/v1/integrations/pi/status?provider=anthropic', { headers });
  assert.equal(status.status, 200); assert.equal(PiIntegrationStatusSchema.parse(await status.json()).provider, 'anthropic'); assert.deepEqual(providers[0], { provider: 'anthropic' });
  const path = origin + `/api/v1/integrations/pi/oauth/jobs/${jobId}/interaction`;
  const noCsrf = await fetch(path, { method: 'POST', headers: { ...sameOrigin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId, response: 'PRIVATE_CODE' }) }); assert.equal(noCsrf.status, 403); assert.equal(replies.length, 0);
  const accepted = await fetch(path, { method: 'POST', headers, body: JSON.stringify({ challengeId, response: 'PRIVATE_CODE' }) }); assert.equal(accepted.status, 200); assert.deepEqual(await accepted.json(), { kind: 'accepted' }); assert.equal(accepted.headers.get('cache-control'), 'no-store');
  const reply = z.object({ response: z.string(), sessionScope: z.string() }).parse(replies[0]); assert.equal(reply.response, 'PRIVATE_CODE'); assert.ok(reply.sessionScope); assert.notEqual(reply.sessionScope, cookie);
  result = 'stale'; const stale = await fetch(path, { method: 'POST', headers, body: JSON.stringify({ challengeId, response: 'PRIVATE_CODE' }) }); assert.equal(stale.status, 409); assert.doesNotMatch(await stale.text(), /PRIVATE_CODE/);
});
