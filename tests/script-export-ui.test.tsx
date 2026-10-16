import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { ScriptExportReceiptSchema, type ScriptExportReceipt } from '../src/domain/script-export.ts';
import { ScriptExportPanel } from '../src/web/ScriptExportPanel.tsx';
import { createScriptExportClient, ScriptExportIntentSchema, ScriptExportRejection, type ScriptExportClient, type ScriptExportIntent } from '../src/web/script-export-client.ts';
import { HOST_SESSION_RESET_EVENT } from '../src/web/host-session-reset.ts';

const runId = randomUUID();
const bootstrap = async () => ({ csrfToken: 'test-csrf-token', expiresAt: '2026-10-17T00:00:00Z' });
function receipt(id = runId, commitIndex = 7): ScriptExportReceipt {
  const filename = `el-paquete-${id}-c${commitIndex}-${'a'.repeat(16)}.fountain`;
  return ScriptExportReceiptSchema.parse({ kind: 'script-export', runId: id, commitIndex,
    worldRevision: 5, worldSeq: 12, configurationRevision: 1, format: 'fountain', filename,
    relativePath: `docs/output/${filename}`, sha256: 'a'.repeat(64), bytes: 1200,
    eventCount: 12, communicationCount: 9, narrationCount: 1 });
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred not initialized'); };
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
async function mounted(run: (container: HTMLElement, root: ReturnType<typeof createRoot>, dom: JSDOM) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1/', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const originals = Object.keys(values).map(name => ({ name, descriptor: Object.getOwnPropertyDescriptor(globalThis, name) }));
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, value });
  const container = dom.window.document.getElementById('root'); assert.ok(container);
  const root = createRoot(container);
  try { await run(container, root, dom); }
  finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const item of originals) {
      if (item.descriptor) Object.defineProperty(globalThis, item.name, item.descriptor);
      else Reflect.deleteProperty(globalThis, item.name);
    }
  }
}
function button(container: HTMLElement, label: string) {
  const element = [...container.querySelectorAll('button')].find(candidate => candidate.textContent === label);
  assert.ok(element, label); return element;
}
function download(container: HTMLElement) { return container.querySelector('a[download]'); }

test('exportar exige clic explícito; el cliente envía CSRF/corte/clave y ofrece descarga correcta sin descargar automáticamente', async () => {
  await mounted(async (container, root, dom) => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    let bootstrapCount = 0, downloads = 0;
    dom.window.HTMLAnchorElement.prototype.click = () => { downloads++; };
    const api = createScriptExportClient(async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json(receipt(), { status: 201 });
    }, async () => { bootstrapCount++; return bootstrap(); });
    await act(async () => root.render(<ScriptExportPanel runId={runId} commitIndex={7} api={api} />));
    assert.equal(requests.length, 0); assert.equal(bootstrapCount, 0); assert.equal(download(container) === null, true);
    await act(async () => button(container, 'Exportar guion Fountain').click());
    assert.equal(requests.length, 1); assert.equal(bootstrapCount, 1);
    const request = requests[0]; assert.ok(request);
    assert.equal(request.url, `/api/v1/runs/${runId}/script-exports`);
    assert.equal(request.init?.method, 'POST'); assert.equal(request.init?.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(String(request.init?.body)), { commitIndex: 7 });
    const headers = new Headers(request.init?.headers);
    assert.equal(headers.get('X-CSRF-Token'), 'test-csrf-token');
    assert.ok(ScriptExportIntentSchema.safeParse({ runId, commitIndex: 7, idempotencyKey: headers.get('Idempotency-Key') }).success);
    const link = download(container); assert.ok(link);
    assert.equal(link.getAttribute('href'), `/api/v1/runs/${runId}/script-exports/${receipt().filename}`);
    assert.equal(link.getAttribute('download'), receipt().filename);
    assert.match(container.textContent ?? '', /commit 7 · 12 eventos · 9 comunicaciones · 1 narraciones/);
    assert.equal(downloads, 0); assert.equal(requests.length, 1, 'no GET, inferencia ni autoexportación');
  });
});

test('respuesta perdida conserva exactamente corte y clave al avanzar la obra y al remontar; recuperar es explícito', async () => {
  await mounted(async (container, root) => {
    const requests: { body: BodyInit | null | undefined; key: string | null }[] = [];
    const api = createScriptExportClient(async (_url, init) => {
      requests.push({ body: init?.body, key: new Headers(init?.headers).get('Idempotency-Key') });
      if (requests.length === 1) throw new Error('response lost after durable export');
      return Response.json(receipt());
    }, bootstrap);
    await act(async () => root.render(<ScriptExportPanel runId={runId} commitIndex={7} api={api} />));
    await act(async () => button(container, 'Exportar guion Fountain').click());
    assert.equal(requests.length, 1); assert.equal(button(container, 'Exportar guion Fountain').disabled, true);
    await act(async () => root.render(<div />));
    await act(async () => root.render(<ScriptExportPanel runId={runId} commitIndex={9} api={api} />));
    assert.equal(requests.length, 1, 'montar una intención incierta no la reenvía');
    await act(async () => button(container, 'Recuperar la misma exportación').click());
    assert.equal(requests.length, 2); assert.deepEqual(requests[1], requests[0]);
    assert.deepEqual(JSON.parse(String(requests[1]?.body)), { commitIndex: 7 });
    assert.match(container.textContent ?? '', /commit 7 ·/);
    assert.equal(download(container)?.getAttribute('download'), receipt().filename);
    assert.equal(sessionStorage.getItem(`personajes:script-export:${runId}`), null);
  });
});

test('doble clic no duplica POST y el corte avanzado no reemplaza el corte capturado pendiente', async () => {
  await mounted(async (container, root) => {
    const pending = deferred<ScriptExportReceipt>(); const intents: ScriptExportIntent[] = [];
    const api: ScriptExportClient = { export: async intent => { intents.push(intent); return pending.promise; } };
    await act(async () => root.render(<ScriptExportPanel runId={runId} commitIndex={7} api={api} />));
    await act(async () => { button(container, 'Exportar guion Fountain').click(); button(container, 'Exportar guion Fountain').click(); });
    assert.equal(intents.length, 1); assert.equal(download(container) === null, true);
    await act(async () => root.render(<ScriptExportPanel runId={runId} commitIndex={10} api={api} />));
    assert.equal(intents[0]?.commitIndex, 7); assert.equal(intents.length, 1);
    await act(async () => pending.resolve(receipt()));
    assert.match(container.textContent ?? '', /commit 7 ·/);
    assert.equal(download(container)?.getAttribute('download'), receipt().filename);
  });
});

for (const status of [401, 403]) test(`HTTP ${status} queda visible y conserva recuperación sin repetición automática`, async () => {
  await mounted(async (container, root) => {
    let attempts = 0;
    const api = createScriptExportClient(async () => { attempts++; return new Response(null, { status }); }, bootstrap);
    await act(async () => root.render(<ScriptExportPanel runId={runId} commitIndex={7} api={api} />));
    await act(async () => button(container, 'Exportar guion Fountain').click());
    assert.equal(attempts, 1); assert.equal(download(container) === null, true);
    assert.match(container.querySelector('[role="status"]')?.textContent ?? '', /sesión.*restablecela/);
    assert.equal(button(container, 'Exportar guion Fountain').disabled, true);
    assert.ok(button(container, 'Recuperar la misma exportación'));
    await act(async () => root.render(<ScriptExportPanel runId={runId} commitIndex={8} api={api} />));
    assert.equal(attempts, 1);
  });
});

test('cambiar representación o cliente retira recibo anterior e ignora respuesta tardía', async () => {
  await mounted(async (container, root) => {
    const pending = deferred<ScriptExportReceipt>(); const signals: AbortSignal[] = [];
    const api: ScriptExportClient = { export: async (_intent, signal) => { signals.push(signal); return pending.promise; } };
    const otherRun = randomUUID();
    await act(async () => root.render(<ScriptExportPanel runId={runId} commitIndex={7} api={api} />));
    await act(async () => button(container, 'Exportar guion Fountain').click());
    await act(async () => root.render(<ScriptExportPanel runId={otherRun} commitIndex={1} api={api} />));
    assert.equal(signals[0]?.aborted, true);
    await act(async () => pending.resolve(receipt()));
    assert.equal(download(container) === null, true); assert.doesNotMatch(container.textContent ?? '', /Guardado:/);
    assert.equal(button(container, 'Exportar guion Fountain').disabled, false);
    const next: ScriptExportClient = { export: async () => receipt(otherRun, 1) };
    await act(async () => root.render(<ScriptExportPanel runId={otherRun} commitIndex={1} api={next} />));
    await act(async () => button(container, 'Exportar guion Fountain').click());
    assert.ok(download(container));
    await act(async () => root.render(<ScriptExportPanel runId={otherRun} commitIndex={1} api={api} />));
    assert.equal(download(container) === null, true);
  });
});

test('restablecer sesión retira recibo y bloquea respuesta anterior; conserva intención para recuperación explícita', async () => {
  await mounted(async (container, root, dom) => {
    const pending = deferred<ScriptExportReceipt>(); let calls = 0; const signals: AbortSignal[] = [];
    const api: ScriptExportClient = { export: async (_intent, signal) => { calls++; signals.push(signal); return calls === 1 ? receipt() : pending.promise; } };
    await act(async () => root.render(<ScriptExportPanel runId={runId} commitIndex={7} api={api} />));
    await act(async () => button(container, 'Exportar guion Fountain').click()); assert.ok(download(container));
    await act(async () => { dom.window.dispatchEvent(new dom.window.Event(HOST_SESSION_RESET_EVENT)); });
    assert.equal(download(container) === null, true); assert.equal(calls, 1);
    await act(async () => button(container, 'Exportar guion Fountain').click());
    assert.equal(calls, 2);
    await act(async () => { dom.window.dispatchEvent(new dom.window.Event(HOST_SESSION_RESET_EVENT)); });
    assert.equal(signals[1]?.aborted, true);
    assert.notEqual(sessionStorage.getItem(`personajes:script-export:${runId}`), null);
    await act(async () => pending.resolve(receipt()));
    assert.equal(download(container) === null, true); assert.equal(calls, 2);
    assert.equal(button(container, 'Exportar guion Fountain').disabled, true);
    assert.ok(button(container, 'Recuperar la misma exportación'));
  });
});

test('cliente valida alcance y formato de recibo, clasifica errores y no reintenta transporte automáticamente', async () => {
  const intent = ScriptExportIntentSchema.parse({ runId, commitIndex: 7, idempotencyKey: randomUUID() });
  const signal = new AbortController().signal;
  for (const body of [receipt(randomUUID()), receipt(runId, 8), { ...receipt(), filename: '../secret.fountain' }]) {
    let calls = 0;
    const client = createScriptExportClient(async () => { calls++; return Response.json(body); }, bootstrap);
    await assert.rejects(client.export(intent, signal)); assert.equal(calls, 1);
  }
  for (const status of [401, 403, 409]) {
    const client = createScriptExportClient(async () => new Response(null, { status }), bootstrap);
    await assert.rejects(client.export(intent, signal), error => error instanceof ScriptExportRejection && error.status === status);
  }
  for (const status of [408, 500]) {
    const client = createScriptExportClient(async () => new Response(null, { status }), bootstrap);
    await assert.rejects(client.export(intent, signal), error => error instanceof Error && !(error instanceof ScriptExportRejection));
  }
});
