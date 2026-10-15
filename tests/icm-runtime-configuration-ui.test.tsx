import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { IcmRuntimeConfigurationPanel } from '../src/web/IcmRuntimeConfigurationPanel.tsx';
import { IcmRuntimeConfigurationViewSchema, IcmRuntimeConfigurationJobSchema, icmRuntimeConfigurationEtag, icmRuntimeConfigurationJobEtag } from '../src/domain/icm-runtime-configuration.ts';
import { buildIcmConfigurationRequest, type IcmRuntimeConfigurationClient, type IcmRuntimeConfigurationIntent } from '../src/web/icm-runtime-configuration-client.ts';
function defineGlobal(name: string, value: unknown) { const prior = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); return () => { if (prior === undefined) Reflect.deleteProperty(globalThis, name); else Object.defineProperty(globalThis, name, prior); }; }
const view = IcmRuntimeConfigurationViewSchema.parse({ kind: 'icm-runtime-configuration', revision: 0, configuredBinaryPath: null, source: 'unconfigured' });
const job = IcmRuntimeConfigurationJobSchema.parse({ kind: 'icm-runtime-configuration-job', jobId: randomUUID(), principalId: 'local-operator', state: 'queued', revision: 0, expectedConfigurationRevision: 0, binaryPath: '/private/icm', requestHash: 'a'.repeat(64), failureCode: null, createdAt: 1, updatedAt: 1, completedAt: null });
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }

test('SSR ICM starts empty with explicit path and apply; no fake picker or provider operation', () => {
  const html = renderToStaticMarkup(<IcmRuntimeConfigurationPanel />); assert.match(html, /Ruta absoluta/); assert.match(html, /Configurar y aplicar ICM/); assert.match(html, /Desactivar ICM explícitamente/); assert.match(html, /value=""/); assert.doesNotMatch(html, /type="file"|localStorage|API.key/);
});
test('mounted ICM retry keeps exact path key and revision after edits, then stops polling', async () => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const restores = [defineGlobal('window', dom.window), defineGlobal('document', dom.window.document), defineGlobal('navigator', dom.window.navigator), defineGlobal('HTMLElement', dom.window.HTMLElement), defineGlobal('Node', dom.window.Node), defineGlobal('IS_REACT_ACT_ENVIRONMENT', true)];
  const starts: IcmRuntimeConfigurationIntent[] = []; let reads = 0; let revision = 0;
  const api: IcmRuntimeConfigurationClient = { async configuration() { const value = IcmRuntimeConfigurationViewSchema.parse({ ...view, revision }); return { value, etag: icmRuntimeConfigurationEtag(value) }; }, async history() { return { jobs: [], truncated: false }; }, async start(intent) { starts.push(structuredClone(intent)); if (starts.length === 1) throw new Error('/SENSITIVE_PATH RAW_CLI_OUTPUT'); return { job, etag: icmRuntimeConfigurationJobEtag(job) }; }, async job() { ++reads; const done = IcmRuntimeConfigurationJobSchema.parse({ ...job, revision: 2, state: 'succeeded', completedAt: 2, updatedAt: 2 }); return { job: done, etag: icmRuntimeConfigurationJobEtag(done) }; } };
  let unmount: (() => void) | undefined;
  try {
    const { createRoot } = await import('react-dom/client'); const element = dom.window.document.getElementById('root'); assert.ok(element); const container = element; const root = createRoot(container); unmount = () => root.unmount(); await act(async () => root.render(<IcmRuntimeConfigurationPanel api={api} />)); await settle(); assert.equal(starts.length, 0);
    function button(label: string) { const result = [...container.querySelectorAll('button')].find(node => node.textContent === label); assert.ok(result); return result; }
    const inputElement = container.querySelector('input'); assert.ok(inputElement); const input = inputElement;
    async function type(value: string) { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set; assert.ok(setter); await act(async () => { setter.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); }
    await type('/private/icm'); await act(async () => button('Configurar y aplicar ICM').click()); await settle(); assert.equal(starts.length, 1); assert.doesNotMatch(container.textContent ?? '', /SENSITIVE_PATH|RAW_CLI_OUTPUT/);
    revision = 7; await type('/private/different'); await act(async () => button('Consultar configuración ICM').click()); await settle(); assert.equal(button('Configurar y aplicar ICM').disabled, true);
    await act(async () => button('Recuperar resultado de configuración ICM').click()); await settle(); await settle(); assert.equal(starts.length, 2); assert.deepEqual(starts[0], starts[1]); assert.equal(reads, 1); await settle(); assert.equal(reads, 1); assert.match(container.textContent ?? '', /Configuración ICM aplicada/);
    const captured = starts[0]; assert.ok(captured); const built = buildIcmConfigurationRequest({ intent: captured, csrfToken: 'csrf' }); assert.equal(new Headers(built.init.headers).get('Idempotency-Key'), captured.key); assert.equal(new Headers(built.init.headers).get('If-Match'), icmRuntimeConfigurationEtag(view)); assert.deepEqual(JSON.parse(built.init.body ?? ''), { binaryPath: '/private/icm', expectedRevision: 0 });
    await act(async () => button('Desactivar ICM explícitamente').click()); await settle(); assert.equal(starts[2]?.binaryPath, null); assert.equal(starts[2]?.expectedRevision, 7);
  } finally { if (unmount !== undefined) await act(async () => unmount?.()); for (const restore of restores.reverse()) restore(); dom.window.close(); }
});

test('mounted ICM reload reads only; unmount aborts pending local history without applying', async () => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const restores = [defineGlobal('window', dom.window), defineGlobal('document', dom.window.document), defineGlobal('navigator', dom.window.navigator), defineGlobal('HTMLElement', dom.window.HTMLElement), defineGlobal('Node', dom.window.Node), defineGlobal('IS_REACT_ACT_ENVIRONMENT', true)];
  let writes = 0; let signal: AbortSignal | undefined;
  const api: IcmRuntimeConfigurationClient = { async configuration() { return { value: view, etag: icmRuntimeConfigurationEtag(view) }; }, async history(input) { signal = input; return await new Promise((_resolve, reject) => input.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); }, async start() { ++writes; return { job, etag: icmRuntimeConfigurationJobEtag(job) }; }, async job() { return { job, etag: icmRuntimeConfigurationJobEtag(job) }; } };
  let unmount: (() => void) | undefined;
  try { const { createRoot } = await import('react-dom/client'); const element = dom.window.document.getElementById('root'); assert.ok(element); const root = createRoot(element); unmount = () => root.unmount(); await act(async () => root.render(<IcmRuntimeConfigurationPanel api={api} />)); await settle(); assert.equal(writes, 0); assert.ok(signal); assert.equal(signal.aborted, false); await act(async () => root.unmount()); unmount = undefined; assert.equal(signal.aborted, true); await settle(); assert.equal(writes, 0); }
  finally { if (unmount !== undefined) await act(async () => unmount?.()); for (const restore of restores.reverse()) restore(); dom.window.close(); }
});
