import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RunConfigurationDraftViewSchema, RunPreflightJobDocumentSchema, RunPreflightJobReceiptSchema } from '../src/domain/http.ts';
import { createEmptyRunConfigurationDraft } from '../src/domain/production.ts';
import { RunBudgetPanel } from '../src/web/RunBudgetPanel.tsx';
import { RunPreflightPanel, RunPreflightReport } from '../src/web/RunPreflightPanel.tsx';
import { buildPreflightRequest, capturePreflightIntent, executePreflightIntent, preflightEtag, preflightRejection, readPreflightHistory } from '../src/web/run-preflight-client.ts';
const runId = '11111111-1111-4111-8111-111111111111'; const jobId = '22222222-2222-4222-8222-222222222222'; const key = '33333333-3333-4333-8333-333333333333';
// Synthetic metadata only; this fixture does not assert that an empty draft is actually Ready.
const saved = { view: RunConfigurationDraftViewSchema.parse({ kind: 'run-configuration-draft', configuration: createEmptyRunConfigurationDraft({ runId, revision: 4 }), state: { lifecycle: 'ready', configurationRevision: 4, worldRevision: 9 }, validation: { kind: 'valid', promotion: 'promoted' } }), etag: `"run-config:${runId}:c4"` };
const receipt = RunPreflightJobReceiptSchema.parse({ kind: 'run-preflight-job-receipt', job: { kind: 'run-preflight-job', jobId, runId, state: 'queued', revision: 0, createdAt: '2026-10-14T12:00:00Z', updatedAt: '2026-10-14T12:00:00Z', configurationRevision: 4, worldRevision: 9, worldSeq: 7, fictitiousAt: 100, resultKind: null, safeCode: null } });
const completed = RunPreflightJobDocumentSchema.parse({ kind: 'run-preflight-job-document', job: { ...receipt.job, state: 'completed', revision: 2, resultKind: 'blocked' }, report: { kind: 'stale', result: { kind: 'blocked', checkedAt: '2026-10-14T12:00:05Z', checks: [{ kind: 'blocked', checkId: 'provider-authentication', code: 'oauth-missing' }, { kind: 'deferred', checkId: 'provider-access-check', code: 'access-check-required' }, { kind: 'passed', checkId: 'icm-memory' }] } } });
const reply = (value: unknown, etag = preflightEtag(receipt.job)) => new Response(JSON.stringify(value), { status: 202, headers: { 'Content-Type': 'application/json', ETag: etag } });

test('preflight captura sólo corte Ready guardado y compone CAS del run, no ETag de configuración', () => {
  const intent = capturePreflightIntent({ document: saved, key });
  const request = buildPreflightRequest({ intent, csrfToken: 'csrf-local' });
  assert.equal(request.path, `/api/v1/runs/${runId}/preflight`); assert.equal(request.init.method, 'POST'); assert.equal(request.init.body, '{}');
  assert.equal(new Headers(request.init.headers).get('If-Match'), `"run:${runId}:c4:w9"`);
  assert.equal(new Headers(request.init.headers).get('Idempotency-Key'), key);
  assert.throws(() => capturePreflightIntent({ document: { ...saved, etag: `"run-config:${runId}:c3"` }, key }));
  assert.throws(() => capturePreflightIntent({ document: { ...saved, view: { ...saved.view, state: { ...saved.view.state, lifecycle: 'draft', worldRevision: null } } }, key }));
  const cancel = buildPreflightRequest({ intent: { kind: 'cancel', key, document: { value: completed, etag: preflightEtag(completed.job) } }, csrfToken: 'csrf-local' });
  assert.equal(cancel.init.method, 'DELETE'); assert.equal(new Headers(cancel.init.headers).get('If-Match'), `"run-preflight:${jobId}:r2"`);
});

test('recibo inicial es inmutable y no inventa un reporte ni inferencia; rechazo 412 es definitivo', async () => {
  const intent = capturePreflightIntent({ document: saved, key }); const signal = new AbortController().signal;
  const job = await executePreflightIntent({ intent, csrfToken: 'csrf-local', signal, request: async () => reply(receipt) });
  assert.equal(job.state, 'queued'); assert.equal(job.resultKind, null); assert.equal('report' in job, false);
  await assert.rejects(executePreflightIntent({ intent, csrfToken: 'csrf-local', signal, request: async () => reply({ ...receipt, job: { ...receipt.job, worldRevision: 10 } }) }), /corte solicitado/);
  await assert.rejects(executePreflightIntent({ intent, csrfToken: 'csrf-local', signal, request: async () => new Response(JSON.stringify({ error: { kind: 'precondition', code: 'STALE', message: 'PRIVATE_ERROR' }, requestId: key }), { status: 412 }) }), error => preflightRejection(error)?.status === 412 && !JSON.stringify(error).includes('PRIVATE_ERROR'));
});

test('respuesta perdida conserva mismo payload/key y reapertura lee historia sin otra evaluación', async () => {
  const intent = capturePreflightIntent({ document: saved, key }); const signal = new AbortController().signal; const requests: RequestInit[] = [];
  const transport: typeof fetch = async (_path, init) => { assert.ok(init); requests.push(init); if (requests.length === 1) throw new Error('Synthetic lost response'); return reply(receipt); };
  await assert.rejects(executePreflightIntent({ intent, csrfToken: 'csrf-local', signal, request: transport }));
  await executePreflightIntent({ intent, csrfToken: 'csrf-local', signal, request: transport });
  assert.deepEqual(requests[0], requests[1]);
  let getCount = 0;
  const history = await readPreflightHistory({ runId, signal, request: async (path, init) => { ++getCount; assert.match(String(path), /preflight\/jobs\?limit=100/); assert.equal(init?.method, undefined); return reply({ kind: 'run-preflight-job-page', items: [completed], nextCursor: null, truncated: false }); } });
  assert.equal(history.items[0]?.job.jobId, jobId); assert.equal(getCount, 1);
});

test('GUI muestra bloqueos, acceso pendiente y stale con estados comprensibles, sin detalles privados', () => {
  const html = renderToStaticMarkup(React.createElement(RunPreflightReport, { value: completed }));
  assert.match(html, /Resultado desactualizado/); assert.match(html, /Autenticación del proveedor/); assert.match(html, /Comprobación de acceso registrada/); assert.match(html, /Memoria ICM/); assert.match(html, /Bloqueado/); assert.match(html, /Pendiente/);
  assert.doesNotMatch(html, /PRIVATE_|configurationHash|accountFingerprint|profileFingerprint/);
  const initial = renderToStaticMarkup(React.createElement(RunPreflightPanel, { document: saved, disabled: true }));
  assert.match(initial, /Comprobar requisitos de ejecución/); assert.match(initial, /no inicia la obra ni llama al modelo/); assert.match(initial, /Consultando historia local/);
  assert.doesNotMatch(initial, /Iniciar representación|Probar acceso Pi/);
  assert.equal(RunPreflightJobDocumentSchema.safeParse({ ...completed, report: { ...completed.report, result: { ...completed.report.result, privateDetails: 'SECRET' } } }).success, false);
});

test('la preparación Ready ofrece inspección visual del presupuesto sin iniciar trabajo', () => {
  const html = renderToStaticMarkup(React.createElement(RunBudgetPanel, { runId }));
  assert.match(html, /Límites de llamadas al modelo/);
  assert.match(html, /Actualizar límites/);
  assert.match(html, /Consultando los límites y el uso durable/);
});
