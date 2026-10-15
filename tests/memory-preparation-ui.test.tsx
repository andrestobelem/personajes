import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { act } from 'react';
import { JSDOM } from 'jsdom';
import { MemoryPreparationPanel } from '../src/web/MemoryPreparationPanel.tsx';
import { MemoryPreparationJobSchema, MemoryPreparationRequestSchema, memoryPreparationContextEtag, memoryPreparationJobEtag } from '../src/domain/memory-preparation.ts';
import { buildMemoryPreparationRequest, type MemoryPreparationClient, type MemoryPreparationIntent } from '../src/web/memory-preparation-client.ts';
function defineGlobal(name: string, value: unknown) { const prior = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); return () => { if (prior === undefined) Reflect.deleteProperty(globalThis, name); else Object.defineProperty(globalThis, name, prior); }; }
const runId = randomUUID(); const jobId = randomUUID();
const context = MemoryPreparationRequestSchema.pick({ runId: true, expectedConfigurationRevision: true, expectedWorldRevision: true }).parse({ runId, expectedConfigurationRevision: 2, expectedWorldRevision: 4 });
const job = MemoryPreparationJobSchema.parse({ kind: 'memory-preparation-job', jobId, ...context, principalId: 'local-operator', purpose: 'initialize-empty', state: 'queued', revision: 0, configurationHash: 'a'.repeat(64), contextETag: memoryPreparationContextEtag(context), actors: [{ actorId: 'maxwell-smart', state: 'pending' }], failureCode: null, createdAt: 1, updatedAt: 1, completedAt: null });
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }

test('mounted memory panel preserves uncertain key and exact cut through edits, recovers once and stops polling', async () => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const restores = [defineGlobal('window', dom.window), defineGlobal('document', dom.window.document), defineGlobal('navigator', dom.window.navigator), defineGlobal('HTMLElement', dom.window.HTMLElement), defineGlobal('Node', dom.window.Node), defineGlobal('IS_REACT_ACT_ENVIRONMENT', true)];
  const starts: MemoryPreparationIntent[] = []; let reads = 0; let lists = 0;
  const api: MemoryPreparationClient = {
    async history() { ++lists; return { jobs: [], truncated: false }; },
    async start(intent) { starts.push(structuredClone(intent)); if (starts.length === 1) throw new Error('/PRIVATE_PATH RAW_CLI'); return { job, etag: memoryPreparationJobEtag(job) }; },
    async job() { ++reads; const done = MemoryPreparationJobSchema.parse({ ...job, state: 'completed', revision: 2, completedAt: 2, updatedAt: 2, actors: [{ actorId: 'maxwell-smart', state: 'initialized' }] }); return { job: done, etag: memoryPreparationJobEtag(done) }; },
  };
  let unmount: (() => void) | undefined;
  try {
    const { createRoot } = await import('react-dom/client'); const container = dom.window.document.getElementById('root'); assert.ok(container); const root = createRoot(container); unmount = () => root.unmount();
    async function render(configurationRevision: number, worldRevision: number, disabled: boolean) { await act(async () => root.render(<MemoryPreparationPanel runId={runId} configurationRevision={configurationRevision} worldRevision={worldRevision} disabled={disabled} api={api} />)); await settle(); }
    const mountedContainer = container;
    function button(label: string) { const found = [...mountedContainer.querySelectorAll('button')].find(node => node.textContent === label); assert.ok(found); return found; }
    await render(2, 4, true); assert.equal(starts.length, 0); assert.equal(button('Preparar memorias privadas').disabled, true);
    await render(2, 4, false); assert.equal(button('Preparar memorias privadas').disabled, false);
    await act(async () => button('Preparar memorias privadas').click()); await settle(); assert.equal(starts.length, 1); assert.match(container.textContent ?? '', /misma clave y el mismo corte/); assert.doesNotMatch(container.textContent ?? '', /PRIVATE_PATH|RAW_CLI/);
    await render(9, 10, false); assert.equal(button('Preparar memorias privadas').disabled, true);
    await act(async () => button('Recuperar resultado de preparación de memorias').click()); await settle(); await settle();
    assert.equal(starts.length, 2); assert.deepEqual(starts[0], starts[1]); assert.equal(starts[1]?.expectedConfigurationRevision, 2); assert.equal(starts[1]?.expectedWorldRevision, 4); assert.equal(reads, 1); assert.match(container.textContent ?? '', /Memoria privada inicializada/);
    await settle(); assert.equal(reads, 1); assert.ok(lists <= 3); assert.equal(starts.length, 2);
    const captured = starts[0]; assert.ok(captured); const request = buildMemoryPreparationRequest({ intent: captured, csrfToken: 'csrf' }); assert.equal(new Headers(request.init.headers).get('If-Match'), memoryPreparationContextEtag(context)); assert.equal(new Headers(request.init.headers).get('Idempotency-Key'), captured.key); assert.deepEqual(JSON.parse(request.init.body ?? ''), { expectedConfigurationRevision: 2, expectedWorldRevision: 4 });
  } finally { if (unmount !== undefined) await act(async () => unmount?.()); for (const restore of restores.reverse()) restore(); dom.window.close(); }
});

test('mounted panel reload only reads and recovery of existing job does not start writes; unmount aborts read', async () => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const restores = [defineGlobal('window', dom.window), defineGlobal('document', dom.window.document), defineGlobal('navigator', dom.window.navigator), defineGlobal('HTMLElement', dom.window.HTMLElement), defineGlobal('Node', dom.window.Node), defineGlobal('IS_REACT_ACT_ENVIRONMENT', true)];
  let starts = 0; let readSignal: AbortSignal | undefined;
  const interrupted = MemoryPreparationJobSchema.parse({ ...job, purpose: 'reopen-existing', state: 'interrupted', revision: 1, failureCode: 'cancelled', completedAt: 2 });
  const api: MemoryPreparationClient = { async history() { return { jobs: [interrupted], truncated: false }; }, async start() { ++starts; return { job, etag: memoryPreparationJobEtag(job) }; }, async job(_input, signal) { readSignal = signal; return await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); } };
  let unmount: (() => void) | undefined;
  try {
    const { createRoot } = await import('react-dom/client'); const container = dom.window.document.getElementById('root'); assert.ok(container); const root = createRoot(container); unmount = () => root.unmount(); await act(async () => root.render(<MemoryPreparationPanel runId={runId} configurationRevision={2} worldRevision={4} reopenExisting api={api} />)); await settle();
    assert.equal(starts, 0); const reopen = [...container.querySelectorAll('button')].find(node => node.textContent === 'Reabrir memorias privadas existentes'); assert.ok(reopen); assert.equal(reopen.disabled, false); assert.match(container.textContent ?? '', /no se reemplaza por una base vacía/); const recover = [...container.querySelectorAll('button')].find(node => node.textContent === `Consultar trabajo ${jobId}`); assert.ok(recover); await act(async () => recover.click()); assert.equal(starts, 0); assert.ok(readSignal); assert.equal(readSignal.aborted, false); await act(async () => root.unmount()); unmount = undefined; assert.equal(readSignal.aborted, true); await settle(); assert.equal(starts, 0);
  } finally { if (unmount !== undefined) await act(async () => unmount?.()); for (const restore of restores.reverse()) restore(); dom.window.close(); }
});


test('initial nonzero snapshot is not inferred to have lived history', async () => {
  const { memoryPreparationReopensExisting } = await import('../src/web/RunPreflightPanel.tsx');
  const { RunConfigurationDraftViewSchema } = await import('../src/domain/http.ts');
  const { createEmptyRunConfigurationDraft } = await import('../src/domain/production.ts');
  const configuration = createEmptyRunConfigurationDraft({ runId, revision: 2 });
  const draft = { view: RunConfigurationDraftViewSchema.parse({ kind: 'run-configuration-draft', configuration: { ...configuration, worldSnapshot: { kind: 'proposed', proposalId: randomUUID(), source: 'editorial', value: { revision: 4, seq: 6 } } }, state: { lifecycle: 'ready', configurationRevision: 2, worldRevision: 4 }, validation: { kind: 'valid', promotion: 'promoted' } }), etag: `"run-config:${runId}:c2"` };
  assert.equal(memoryPreparationReopensExisting(draft), false);
  assert.equal(memoryPreparationReopensExisting({ ...draft, view: { ...draft.view, state: { ...draft.view.state, worldRevision: 5 } } }), true);
});
