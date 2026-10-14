import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PiIntegrationStatusSchema, PiOAuthInteractionViewSchema, PiOAuthJobViewSchema } from '../src/domain/http.ts';
import { PiAccessPanel, PiAccessStatus, PiOAuthJobStatus, PiOAuthJobsList } from '../src/web/PiAccessPanel.tsx';
import { buildPiOAuthRequest, executePiOAuthIntent, piJobEtag, piJobIsTerminal, readPiOAuthHttpRejection, readPiOAuthJobs, reconcilePiOAuthRejection, type PiOAuthIntent } from '../src/web/pi-access-client.ts';

const job = PiOAuthJobViewSchema.parse({ kind: 'pi-oauth-job', jobId: '11111111-1111-4111-8111-111111111111', provider: 'openai-codex', operation: 'login', state: 'running', revision: 1, createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:00:01Z', safeCode: null });
const status = PiIntegrationStatusSchema.parse({ kind: 'pi-integration-status', provider: 'openai-codex', authState: 'present', requiredProfile: { provider: 'openai-codex', model: 'gpt-6.1-sol', thinking: 'low' }, effectiveProfile: null, accessCheck: 'notRun', checkedAt: '2026-10-14T10:00:01Z', safeCode: null });
const key = '22222222-2222-4222-8222-222222222222';
const response = (value: unknown, etag: string | null = piJobEtag(job)) => new Response(JSON.stringify(value), { status: 202, headers: { 'Content-Type': 'application/json', ...(etag === null ? {} : { ETag: etag }) } });

test('acceso muestra perfil fijo y metadatos sin presentar credencial como acceso probado', () => {
  const markup = renderToStaticMarkup(React.createElement(PiAccessStatus, { status: { kind: 'ready', value: status } }));
  assert.match(markup, /openai-codex/); assert.match(markup, /gpt-6.1-sol/); assert.match(markup, /low/);
  assert.match(markup, /sin comprobar/); assert.match(markup, /no demuestra acceso a Sol/);
  assert.doesNotMatch(markup, /autenticado|perfil efectivo: gpt-6.1-sol/);
  const initial = renderToStaticMarkup(React.createElement(PiAccessPanel));
  assert.match(initial, /Conectar con OpenAI/); assert.match(initial, /Desconectar OAuth/);
  assert.match(initial, /Consultar estado local/); assert.match(initial, /Comprobación|comprobación/);
  assert.doesNotMatch(initial, /type="password"|localStorage|PRIVATE_/);
});

test('código público y enlace sólo oficiales, terminal no conserva guía interactiva', () => {
  const interaction = PiOAuthInteractionViewSchema.parse({ kind: 'device-code', cursor: 1, verificationUri: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234', expiresAt: '2026-10-14T10:15:00Z' });
  const active = renderToStaticMarkup(React.createElement(PiOAuthJobStatus, { document: { job, etag: piJobEtag(job) }, interaction }));
  assert.match(active, /href="https:\/\/auth.openai.com\/codex\/device"/); assert.match(active, /ABCD-1234/); assert.match(active, /noopener noreferrer/);
  const done = PiOAuthJobViewSchema.parse({ ...job, state: 'succeeded', revision: 2 });
  const completed = renderToStaticMarkup(React.createElement(PiOAuthJobStatus, { document: { job: done, etag: piJobEtag(done) }, interaction }));
  assert.doesNotMatch(completed, /ABCD-1234|Autorizar en OpenAI/);
  assert.equal(PiOAuthInteractionViewSchema.safeParse({ ...interaction, verificationUri: 'https://other.example/device' }).success, false);
  assert.equal(PiOAuthInteractionViewSchema.safeParse({ ...interaction, userCode: '<script>' }).success, false);
});

test('mutaciones administrativas fijan origen, CSRF, key y CAS sin enviar códigos OAuth', () => {
  const login = buildPiOAuthRequest({ intent: { kind: 'login', key }, csrfToken: 'csrf-local' });
  assert.equal(login.path, '/api/v1/integrations/pi/oauth/login'); assert.equal(login.init.method, 'POST'); assert.equal(login.init.body, '{}');
  assert.equal(login.init.credentials, 'same-origin');
  assert.equal(new Headers(login.init.headers).get('Idempotency-Key'), key);
  assert.equal(new Headers(login.init.headers).get('X-CSRF-Token'), 'csrf-local');
  const cancel = buildPiOAuthRequest({ intent: { kind: 'cancel', key, document: { job, etag: piJobEtag(job) } }, csrfToken: 'csrf-local' });
  assert.equal(cancel.init.method, 'DELETE'); assert.equal(new Headers(cancel.init.headers).get('If-Match'), piJobEtag(job));
  assert.throws(() => buildPiOAuthRequest({ intent: { kind: 'cancel', key, document: { job, etag: 'wrong' } }, csrfToken: 'csrf-local' }));
  assert.throws(() => buildPiOAuthRequest({ intent: { kind: 'login', key: 'not-uuid' }, csrfToken: 'csrf-local' }));
});

test('pérdida de respuesta recupera exactamente la misma operación sin nueva key', async () => {
  const calls: { path: string; init: RequestInit | undefined }[] = [];
  const intent: PiOAuthIntent = { kind: 'login', key };
  const request: typeof fetch = async (path, init) => {
    calls.push({ path: String(path), init });
    if (calls.length === 1) throw new Error('Synthetic transport loss');
    return response({ kind: 'pi-oauth-job-receipt', job });
  };
  await assert.rejects(executePiOAuthIntent({ intent, csrfToken: 'csrf-local', request }));
  const result = await executePiOAuthIntent({ intent, csrfToken: 'csrf-local', request });
  assert.deepEqual(calls[0], calls[1]); assert.deepEqual(result, { job, etag: piJobEtag(job) });
});

test('helper rechaza recibo incongruente y errores sólo muestran referencia pública', async () => {
  const intent: PiOAuthIntent = { kind: 'login', key };
  await assert.rejects(executePiOAuthIntent({ intent, csrfToken: 'csrf-local', request: async () => response({ kind: 'pi-oauth-job-receipt', job }, null) }), /revisión/);
  const logout = PiOAuthJobViewSchema.parse({ ...job, operation: 'logout' });
  await assert.rejects(executePiOAuthIntent({ intent, csrfToken: 'csrf-local', request: async () => response({ kind: 'pi-oauth-job-receipt', job: logout }) }), /otra operación/);
  await assert.rejects(executePiOAuthIntent({ intent, csrfToken: 'csrf-local', request: async () => response({ kind: 'pi-oauth-job-receipt', job: { ...job, privateToken: 'PRIVATE_VALUE' } }) }), /formato/);
  const failure = new Response(JSON.stringify({ error: { kind: 'forbidden', code: 'PRIVATE_CODE', message: 'PRIVATE_SDK_ERROR' }, requestId: key }), { status: 403 });
  await assert.rejects(executePiOAuthIntent({ intent, csrfToken: 'csrf-local', request: async () => failure }), error => { const rejected = readPiOAuthHttpRejection(error); return rejected?.requestId === key && !JSON.stringify(error).includes('PRIVATE_'); });
  assert.equal(piJobIsTerminal(job), false);
  for (const state of ['succeeded', 'failed', 'canceled', 'interrupted']) assert.equal(piJobIsTerminal(PiOAuthJobViewSchema.parse({ ...job, state })), true);
});

test('POST sin respuesta y reapertura descubre el trabajo durable con GET, sin otra autorización', async () => {
  let committed: typeof job | undefined;
  let authorizationRequests = 0;
  const calls: string[] = [];
  const request: typeof fetch = async (path, init) => {
    calls.push(`${init?.method ?? 'GET'} ${String(path)}`);
    if (init?.method === 'POST') {
      ++authorizationRequests;
      committed = job;
      throw new Error('Synthetic response lost after durable creation');
    }
    assert.match(String(path), /oauth\/jobs\?limit=100/);
    return response({ kind: 'pi-oauth-job-page', items: committed === undefined ? [] : [committed], nextCursor: null, truncated: false });
  };
  await assert.rejects(executePiOAuthIntent({ intent: { kind: 'login', key }, csrfToken: 'csrf-local', request }));
  // Fresh read needs neither the lost key nor job UUID nor any component memory.
  const reopened = await readPiOAuthJobs({ request, signal: new AbortController().signal });
  assert.equal(reopened.items[0]?.jobId, job.jobId);
  const html = renderToStaticMarkup(React.createElement(PiOAuthJobsList, { items: reopened.items, disabled: false, onSelect: () => {} }));
  assert.match(html, /Recuperar este trabajo/); assert.match(html, /Conectando/); assert.match(html, new RegExp(job.jobId));
  assert.equal(authorizationRequests, 1); assert.equal(calls.length, 2);
});

test('412 reconocido descarta intento viejo y recupera CAS actual sin repetir DELETE', async () => {
  const latest = PiOAuthJobViewSchema.parse({ ...job, revision: 4 });
  const intent: PiOAuthIntent = { kind: 'cancel', key, document: { job, etag: piJobEtag(job) } };
  let mutationCalls = 0; let readCalls = 0;
  const request: typeof fetch = async () => {
    ++mutationCalls;
    return new Response(JSON.stringify({ error: { kind: 'precondition', code: 'STALE_JOB', message: 'PRIVATE_MESSAGE' }, requestId: key }), { status: 412 });
  };
  let failure: unknown;
  try { await executePiOAuthIntent({ intent, csrfToken: 'csrf-local', request }); }
  catch (error) { failure = error; }
  const recovered = await reconcilePiOAuthRejection({ error: failure, intent, signal: new AbortController().signal, readJob: async id => { ++readCalls; assert.equal(id, job.jobId); return { job: latest, etag: piJobEtag(latest) }; } });
  assert.equal(recovered.kind, 'rejected');
  if (recovered.kind !== 'rejected') throw new Error('Expected definitive rejection');
  assert.equal(recovered.document?.job.revision, 4); assert.equal(mutationCalls, 1); assert.equal(readCalls, 1);
  const unknown = await reconcilePiOAuthRejection({ error: new Error('Transport loss'), intent, signal: new AbortController().signal, readJob: async () => { throw new Error('Must not probe a different mutation'); } });
  assert.deepEqual(unknown, { kind: 'uncertain' });
});

test('paginación local acotada valida curso y avisa ventana truncada', async () => {
  let calls = 0;
  const pageCursor = 'p1.MTAw';
  const request: typeof fetch = async path => {
    ++calls;
    if (calls === 1) return response({ kind: 'pi-oauth-job-page', items: [job], nextCursor: pageCursor, truncated: true });
    assert.match(String(path), /cursor=p1.MTAw/);
    return response({ kind: 'pi-oauth-job-page', items: [], nextCursor: null, truncated: true });
  };
  const page = await readPiOAuthJobs({ request, signal: new AbortController().signal });
  assert.equal(page.truncated, true); assert.equal(page.items.length, 1); assert.equal(calls, 2);
  await assert.rejects(readPiOAuthJobs({ request: async () => response({ kind: 'pi-oauth-job-page', items: [], nextCursor: pageCursor, truncated: false }), signal: new AbortController().signal }), /no pudo avanzar/);
});
