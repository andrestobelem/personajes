import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { IcmContextInspectionPanel } from '../src/web/IcmContextInspectionPanel.tsx';
import { InspectorPanel } from '../src/web/InspectorPanel.tsx';
import { createIcmContextInspectionClient, type IcmContextInspectionClient } from '../src/web/icm-context-inspection-client.ts';
import type { RunInspectorClient } from '../src/web/run-inspector-client.ts';
import { HOST_SESSION_RESET_EVENT } from '../src/web/host-session-reset.ts';
import { SessionCreatedSchema } from '../src/domain/http.ts';
import { IcmContextInspectionPageSchema, type IcmContextInspectionRequest } from '../src/domain/icm-context-inspection.ts';
import { createRunInspectorApplication } from '../src/application/run-inspector.ts';
import { icmInspectionFixture } from './fixtures/icm-inspection.ts';

async function mounted(run: (container: HTMLElement, root: ReturnType<typeof createRoot>, dom: JSDOM) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(name => ({ name, descriptor: Object.getOwnPropertyDescriptor(globalThis, name) }));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window }); Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document }); Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const container = dom.window.document.getElementById('root'); assert.ok(container); const root = createRoot(container);
  try { await run(container, root, dom); } finally { await act(async () => root.unmount()); dom.window.close(); for (const { name, descriptor } of originals) { if (descriptor === undefined) Reflect.deleteProperty(globalThis, name); else Object.defineProperty(globalThis, name, descriptor); } }
}
function button(container: HTMLElement, name: string) { const found = [...container.querySelectorAll('button')].find(item => item.textContent === name); assert.ok(found, name); return found; }
function deferred<T>() { let resolve: (value: T) => void = () => assert.fail('Missing gate'); const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test('React muestra metadata real, filtra por rol sin retener filas anteriores y retira datos al reset de sesión', async () => {
  const f = await icmInspectionFixture();
  try {
    await f.packets(); const requests: IcmContextInspectionRequest[] = [];
    const api: IcmContextInspectionClient = { async read(input) { requests.push(input); const value = f.read(input.filters, input.offset, input.limit); assert.ok(value); return value; } };
    await mounted(async (container, root, dom) => {
      await act(async () => root.render(<IcmContextInspectionPanel runId={f.runId} api={api} />)); assert.equal(requests.length, 0);
      await act(async () => button(container, 'Consultar paquetes ICM').click());
      assert.equal(requests.length, 1); assert.match(container.textContent ?? '', /Archivo completo|posteriores al corte mental/);
      assert.match(container.textContent ?? '', /Contexto preparado SHA-256/); assert.doesNotMatch(container.textContent ?? '', /PRIVATE_|SECRET_/);
      const select = container.querySelector('select'); assert.ok(select);
      await act(async () => { select.value = 'director'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
      assert.doesNotMatch(container.textContent ?? '', /Contexto preparado SHA-256/);
      await act(async () => button(container, 'Consultar paquetes ICM').click()); assert.equal(requests.at(-1)?.filters.role, 'director');
      assert.match(container.textContent ?? '', /1 paquetes/);
      await act(async () => dom.window.dispatchEvent(new dom.window.Event(HOST_SESSION_RESET_EVENT)));
      assert.doesNotMatch(container.textContent ?? '', /Paquete verificado contra/); assert.equal(button(container, 'Consultar paquetes ICM').disabled, true);
    });
  } finally { f.close(); }
});

test('React pagina metadata sin nuevas inferencias y descarta lecturas tardías después de cambiar corrida o desmontar', async () => {
  const f = await icmInspectionFixture();
  try {
    await f.packets(); const page = f.read(); assert.ok(page); const item = page.items[0]; assert.ok(item);
    const requests: IcmContextInspectionRequest[] = [];
    const api: IcmContextInspectionClient = { async read(input) {
      requests.push(input);
      // Controlled pagination metadata only; journal integrity is tested separately.
      return IcmContextInspectionPageSchema.parse({ ...page, offset: input.offset, limit: input.limit, total: 26,
        items: Array.from({ length: input.offset === 0 ? 25 : 1 }, (_, index) => ({ ...item, position: input.offset + index })), hasMore: input.offset === 0 });
    } };
    await mounted(async (container, root) => {
      await act(async () => root.render(<IcmContextInspectionPanel runId={f.runId} api={api} />));
      await act(async () => button(container, 'Consultar paquetes ICM').click()); await act(async () => button(container, 'Paquetes siguientes').click());
      assert.deepEqual(requests.map(value => value.offset), [0, 25]); assert.match(container.textContent ?? '', /26–26/);
      await act(async () => button(container, 'Paquetes anteriores').click()); assert.equal(requests.at(-1)?.offset, 0);
      const gate = deferred<typeof page>(); let signal: AbortSignal | undefined;
      const slow: IcmContextInspectionClient = { read(_input, pending) { signal = pending; return gate.promise; } };
      await act(async () => root.render(<IcmContextInspectionPanel runId={f.runId} api={slow} />));
      await act(async () => button(container, 'Consultar paquetes ICM').click());
      await act(async () => root.render(<IcmContextInspectionPanel runId={randomUUID()} api={slow} />)); assert.equal(signal?.aborted, true);
      await act(async () => gate.resolve(page)); assert.doesNotMatch(container.textContent ?? '', /Paquete verificado contra/);
      await act(async () => root.render(<p>Inspector retirado</p>)); assert.equal(signal?.aborted, true);
    });
  } finally { f.close(); }
});

test('Inspector opt-in desmonta ICM al revocar; cliente real de 401/403 vacío retira permiso y badge privados', async () => {
  for (const status of [401, 403]) {
    const f = await icmInspectionFixture();
    try {
      const application = createRunInspectorApplication({ journal: f.journal }); let calls = 0;
      const api: RunInspectorClient = { async intent(runId, mode) { return { runId, mode, etag: '"session:r0"', key: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() }; },
        async preference(intent) { return { mode: intent.mode, enabledForSession: true }; },
        async characters(runId) { const result = application.characters({ runId }); assert.equal(result.kind, 'found'); if (result.kind !== 'found') assert.fail('Missing actors'); return result.view; },
        async inspect() { assert.fail('No mind request'); } };
      const icmApi = createIcmContextInspectionClient(async () => { calls++; return new Response('', { status }); }, async () => SessionCreatedSchema.parse({ csrfToken: 'synthetic_csrf_012345678901234567890', expiresAt: '2099-01-01T00:00:00Z' }));
      await mounted(async (container, root) => {
        await act(async () => root.render(<InspectorPanel runId={f.runId} api={api} icmApi={icmApi} />)); assert.equal(container.querySelector('[aria-label="Paquetes privados ICM"]'), null);
        const consent = container.querySelector('input[type="checkbox"]'); assert.ok(consent instanceof window.HTMLInputElement);
        await act(async () => consent.click()); await act(async () => button(container, 'Activar inspector privado').click());
        assert.ok(container.querySelector('[aria-label="Paquetes privados ICM"]')); assert.match(container.textContent ?? '', /Permiso privado activo/);
        await act(async () => button(container, 'Revocar y retirar datos privados').click()); assert.equal(container.querySelector('[aria-label="Paquetes privados ICM"]'), null);
        await act(async () => button(container, 'Activar inspector privado').click());
        await act(async () => button(container, 'Consultar paquetes ICM').click()); assert.equal(calls, 1);
        assert.equal(container.querySelector('[aria-label="Paquetes privados ICM"]'), null); assert.doesNotMatch(container.textContent ?? '', /Permiso privado activo/);
        assert.match(container.textContent ?? '', /permiso privado ya no está disponible/);
      });
    } finally { f.close(); }
  }
});
