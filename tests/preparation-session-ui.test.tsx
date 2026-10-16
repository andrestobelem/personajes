import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { createIcmWorkspaceReader } from '../src/adapters/icm-workspace.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { createIcmWorkspaceRoutes } from '../src/server/icm-workspace-routes.ts';
import { SessionCreatedSchema, SessionViewSchema } from '../src/domain/http.ts';
import { RunIdSchema, HumanParticipantIdSchema } from '../src/domain/values.ts';
import { createEmptyRunConfigurationDraft } from '../src/domain/production.ts';
import { createHumanInteractionClient, captureHumanIntent, HumanRejection, type HumanIntent, type SessionDocument } from '../src/web/human-interaction-client.ts';
import { createIcmWorkspaceClient } from '../src/web/icm-workspace-client.ts';
import { PreparationSessionPanel } from '../src/web/PreparationSessionPanel.tsx';
import { IcmWorkspaceEditor } from '../src/web/IcmWorkspaceEditor.tsx';
import { RunDraftEditor } from '../src/web/RunDraftEditor.tsx';
import { changeDraftField } from '../src/web/draft-form.ts';
import { reconnectSession } from '../src/web/client.ts';
import { subscribeToHostSessionReset } from '../src/web/host-session-reset.ts';

async function host() {
  const server = createLocalHttpServer({ catalog: await loadCatalog({ repositoryRoot: process.cwd() }),
    shellHtml: '<html><head></head><body></body></html>', resolveSessionMode: candidate => candidate,
    operatorExtensions: [createIcmWorkspaceRoutes({ reader: createIcmWorkspaceReader({ workspaceRoot: process.cwd() }) })] });
  const { origin } = await server.listen();
  const html = await (await fetch(origin + '/')).text();
  const bootNonce = html.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1]; assert.ok(bootNonce);
  const response = await fetch(origin + '/api/v1/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ bootNonce }) });
  const session = SessionCreatedSchema.parse(await response.json());
  const cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  const request: typeof fetch = (path, init) => fetch(new URL(String(path), origin), { ...init,
    headers: { Origin: origin, Cookie: cookie, ...Object.fromEntries(new Headers(init?.headers)) } });
  const bootstrap = async () => session;
  const pending = new Set<Promise<unknown>>();
  function track<T>(promise: Promise<T>): Promise<T> {
    pending.add(promise);
    void promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  }
  const originalApi = createHumanInteractionClient(request, bootstrap);
  const api = { ...originalApi, session: () => track(originalApi.session()), mutate: (intent: HumanIntent) => track(originalApi.mutate(intent)) };
  const original = await api.session();
  await api.mutate(captureHumanIntent({ kind: 'mode', mode: { kind: 'interlocutor', runId: RunIdSchema.parse(randomUUID()), participantId: HumanParticipantIdSchema.parse(randomUUID()) }, etag: original.etag, key: randomUUID() }));
  const originalIcm = createIcmWorkspaceClient(request, bootstrap);
  const icm = { ...originalIcm, sources: (...args: Parameters<typeof originalIcm.sources>) => track(originalIcm.sources(...args)) };
  async function flush() {
    // Drain the actual HTTP operations, including reads launched by React effects.
    do { await act(async () => { await Promise.allSettled([...pending]); }); } while (pending.size > 0);
  }
  return { api, icm, flush, close: () => server.close() };
}
async function mounted(run: (container: HTMLElement, root: ReturnType<typeof createRoot>) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const originals = ['window', 'document', 'DOMParser', 'Event', 'IS_REACT_ACT_ENVIRONMENT'].map(name => ({ name, value: Object.getOwnPropertyDescriptor(globalThis, name) }));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'DOMParser', { configurable: true, value: dom.window.DOMParser });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: dom.window.Event });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const container = dom.window.document.getElementById('root'); assert.ok(container); const root = createRoot(container);
  try { await run(container, root); }
  finally { await act(async () => root.unmount()); dom.window.close(); for (const original of originals) {
    if (original.value) Object.defineProperty(globalThis, original.name, original.value); else Reflect.deleteProperty(globalThis, original.name);
  } }
}
function button(container: HTMLElement, name: string) {
  const value = [...container.querySelectorAll('button')].find(item => item.textContent === name); assert.ok(value, name); return value;
}

test('volver explícitamente de interlocución a preparación habilita las fuentes ICM HTTP sin perder el borrador ni ampliar los permisos del rol', async () => {
  const f = await host();
  try { await mounted(async (container, root) => {
    await assert.rejects(f.icm.sources({ role: 'director' }, new AbortController().signal), /requiere operación de preparación/);
    const draft = createEmptyRunConfigurationDraft({ runId: randomUUID(), revision: 0 }); let refreshed = 0;
    function Harness() {
      const [refresh, setRefresh] = React.useState(0);
      return <><textarea aria-label="Borrador sin guardar" defaultValue="Mi escena conservada" />
        <PreparationSessionPanel api={f.api} onReady={() => { refreshed++; setRefresh(value => value + 1); }} />
        <IcmWorkspaceEditor draft={draft} api={f.icm} sourceRefresh={refresh} onChange={() => assert.fail('No debe aplicar fuentes automáticamente')} onPendingChange={() => {}} /></>;
    }
    await act(async () => root.render(<Harness />));
    // Explicitly await real HTTP reads before checking their rendered result.
    await f.flush();
    await act(async () => button(container, 'Consultar modo de sesión').click());
    await f.flush();
    assert.match(container.textContent ?? '', /Seguís hablando como un personaje/);
    assert.equal((await f.api.session()).view.mode.kind, 'interlocutor');
    await act(async () => button(container, 'Activar modo de preparación').click());
    await f.flush();
    assert.equal(refreshed, 1);
    assert.equal((await f.api.session()).view.mode.kind, 'observer');
    assert.equal(container.querySelector('textarea')?.value, 'Mi escena conservada');
    assert.match(container.textContent ?? '', /role.director/);
    assert.doesNotMatch(container.textContent ?? '', /requiere operación de preparación/);
    assert.equal(container.querySelectorAll('input:checked').length, 0);
  }); } finally { await f.close(); }
});

test('un cambio aplicado con respuesta perdida conserva la misma clave y la revisión de sesión no avanza dos veces', async () => {
  const f = await host();
  try { await mounted(async (container, root) => {
    let lost = true, confirmed = 0; const intents: HumanIntent[] = [];
    const api = { session: f.api.session, async mutate(intent: HumanIntent) {
      intents.push(structuredClone(intent)); const result = await f.api.mutate(intent);
      if (lost) { lost = false; throw new Error('lost response'); } return result;
    } };
    await act(async () => root.render(<PreparationSessionPanel api={api} onReady={() => confirmed++} />));
    await f.flush();
    await act(async () => button(container, 'Consultar modo de sesión').click());
    await f.flush();
    await act(async () => button(container, 'Activar modo de preparación').click());
    await f.flush();
    const applied = await f.api.session(); assert.equal(applied.view.mode.kind, 'observer');
    assert.equal(confirmed, 0);
    await act(async () => button(container, 'Recuperar el mismo cambio de modo').click());
    await f.flush();
    assert.equal(confirmed, 1); assert.equal(intents.length, 2); assert.deepEqual(intents[0], intents[1]);
    assert.equal((await f.api.session()).view.sessionRevision, applied.view.sessionRevision);
  }); } finally { await f.close(); }
});

test('un cambio concurrente de sesión exige volver a leer antes de capturar otra operación', async () => {
  const f = await host();
  try { await mounted(async (container, root) => {
    let confirmed = 0;
    await act(async () => root.render(<PreparationSessionPanel api={f.api} onReady={() => confirmed++} />));
    await f.flush();
    await act(async () => button(container, 'Consultar modo de sesión').click());
    await f.flush();
    const actual = await f.api.session();
    await f.api.mutate(captureHumanIntent({ kind: 'mode', mode: { kind: 'director', runId: RunIdSchema.parse(randomUUID()), scope: { kind: 'scene', sceneId: randomUUID() } }, etag: actual.etag, key: randomUUID() }));
    await act(async () => button(container, 'Activar modo de preparación').click());
    await f.flush();
    assert.equal(confirmed, 0); assert.match(container.textContent ?? '', /Consultá de nuevo/);
    assert.equal(button(container, 'Activar modo de preparación').disabled, true);
    await act(async () => button(container, 'Consultar modo de sesión').click());
    await f.flush();
    await act(async () => button(container, 'Activar modo de preparación').click());
    await f.flush();
    assert.equal(confirmed, 1); assert.equal((await f.api.session()).view.mode.kind, 'observer');
  }); } finally { await f.close(); }
});

test('refrescar las fuentes conserva los campos pendientes del editor real, sin guardarlos ni aplicarlos', async () => mounted(async (container, root) => {
  const draft = changeDraftField({ draft: createEmptyRunConfigurationDraft({ runId: randomUUID(), revision: 0 }), field: 'name', value: 'Mi escena nueva' });
  let saves = 0;
  const render = (sourceRefresh: number) => <RunDraftEditor draft={draft} catalog={[]} saving={false} sourceRefresh={sourceRefresh}
    onSave={() => saves++} onValidate={() => assert.fail('No validar automáticamente')} onDirty={() => {}} />;
  await act(async () => root.render(render(0)));
  const unlimited = [...container.querySelectorAll('input[type="checkbox"]')].find(input => input.parentElement?.textContent === 'Sin límite de llamadas al modelo');
  assert.ok(unlimited instanceof window.HTMLInputElement);
  await act(async () => unlimited.click());
  assert.equal(unlimited.checked, true);
  assert.equal(button(container, 'Guardar borrador').disabled, true, 'el presupuesto sigue pendiente de aplicar');
  await act(async () => root.render(render(1)));
  assert.equal(container.querySelector('#draft-name input')?.getAttribute('value'), 'Mi escena nueva');
  assert.equal(unlimited.checked, true); assert.equal(unlimited.isConnected, true);
  assert.equal(button(container, 'Guardar borrador').disabled, true);
  assert.equal(saves, 0); assert.equal(draft.budget.kind, 'empty');
}));

/** Real local HTTP, cookie rotation and the shared bootstrap/reconnect cache.
 * Only browser cookie storage and an intentionally lost response are controlled. */
async function browserHost(run: (value: {
  api: ReturnType<typeof createHumanInteractionClient>; restoreSession: () => Promise<void>;
  flush: () => Promise<void>; expire: () => void; rotate: () => Promise<void>;
  loseNextModeReply: () => void; failNextReconnect: () => void; counts: { puts: number; bootstraps: number };
}) => Promise<void>) {
  let now = Date.now();
  const server = createLocalHttpServer({ catalog: await loadCatalog({ repositoryRoot: process.cwd() }),
    shellHtml: '<html><head></head><body></body></html>', resolveSessionMode: candidate => candidate, now: () => now });
  const { origin } = await server.listen();
  const network = globalThis.fetch; let cookie = '', loseReply = false, failReconnect = false;
  const counts = { puts: 0, bootstraps: 0 };
  const pending = new Set<Promise<unknown>>();
  function track<T>(promise: Promise<T>): Promise<T> {
    pending.add(promise); void promise.then(() => pending.delete(promise), () => pending.delete(promise)); return promise;
  }
  const request: typeof fetch = async (path, init) => {
    const url = new URL(String(path), origin);
    if (url.pathname === '/' && failReconnect) { failReconnect = false; return new Response('Unavailable', { status: 503 }); }
    if (url.pathname === '/api/v1/session/mode') counts.puts++;
    if (url.pathname === '/api/v1/session' && init?.method === 'POST') counts.bootstraps++;
    const response = await network(url, { ...init, headers: { Origin: origin, Cookie: cookie, ...Object.fromEntries(new Headers(init?.headers)) } });
    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
    if (url.pathname === '/api/v1/session/mode' && loseReply) { loseReply = false; await response.text(); throw new Error('Lost reply after committed mode change'); }
    return response;
  };
  globalThis.fetch = request;
  const original = createHumanInteractionClient(request);
  const api = { ...original, session: () => track(original.session()), mutate: (intent: HumanIntent) => track(original.mutate(intent)) };
  const restoreSession = () => track(reconnectSession().then(() => {}));
  async function flush() { do { await act(async () => { await Promise.allSettled([...pending]); }); } while (pending.size > 0); }
  async function rotate() {
    // A second tab rotates the shared cookie without replacing this tab's cache.
    const html = await (await request('/')).text();
    const nonce = html.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1]; assert.ok(nonce);
    const fresh = SessionCreatedSchema.parse(await (await request('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bootNonce: nonce }) })).json());
    const response = await request('/api/v1/session/mode', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': fresh.csrfToken, 'If-Match': '"session:r0"', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ kind: 'interlocutor', runId: randomUUID(), participantId: 'visitante-a' }) });
    assert.equal(response.status, 200);
  }
  try {
    await restoreSession();
    await run({ api, restoreSession, flush, rotate, counts, expire: () => { now += 31 * 60_000; }, loseNextModeReply: () => { loseReply = true; }, failNextReconnect: () => { failReconnect = true; } });
  } finally { globalThis.fetch = network; await server.close(); }
}

test('GET 401 ofrece reconexión real; un fallo puede reintentarse y sólo observer confirmado refresca fuentes sin PUT', async () => mounted(async (container, root) => browserHost(async f => {
  f.expire(); let ready = 0, resets = 0;
  const unsubscribe = subscribeToHostSessionReset(() => resets++);
  try {
    await act(async () => root.render(<><textarea defaultValue="Escena sin guardar" /><PreparationSessionPanel api={f.api} restoreSession={f.restoreSession} onReady={() => ready++} /></>));
    await f.flush(); assert.equal(ready, 0);
    const textarea = container.querySelector('textarea'); assert.ok(textarea);
    f.failNextReconnect();
    await act(async () => button(container, 'Restablecer sesión local').click()); await f.flush();
    assert.equal(ready, 0); assert.equal(resets, 0); assert.equal(button(container, 'Restablecer sesión local').disabled, false);
    await act(async () => button(container, 'Restablecer sesión local').click()); await f.flush();
    assert.equal(ready, 1); assert.equal(resets, 1); assert.equal(f.counts.puts, 0);
    assert.equal((await f.api.session()).view.mode.kind, 'observer');
    assert.equal(textarea.isConnected, true); assert.equal(textarea.value, 'Escena sin guardar');
    assert.match(container.textContent ?? '', /preparación y observación/);
  } finally { unsubscribe(); }
})));

test('CSRF 403 de cookie rotada se recupera con bootstrap real y GET observer, sin reenviar el PUT rechazado', async () => mounted(async (container, root) => browserHost(async f => {
  await f.rotate(); const seededPuts = f.counts.puts; let ready = 0;
  await act(async () => root.render(<PreparationSessionPanel api={f.api} restoreSession={f.restoreSession} onReady={() => ready++} />)); await f.flush();
  await act(async () => button(container, 'Activar modo de preparación').click()); await f.flush();
  assert.equal(f.counts.puts, seededPuts + 1); assert.equal(ready, 0);
  assert.match(container.textContent ?? '', /CSRF/);
  await act(async () => button(container, 'Restablecer sesión local').click()); await f.flush();
  assert.equal(f.counts.puts, seededPuts + 1); assert.equal(ready, 1); assert.equal(f.counts.bootstraps, 3);
  assert.equal((await f.api.session()).view.mode.kind, 'observer');
})));

test('reconectar una respuesta de modo perdida no reenvía la operación ni cambia el borrador', async () => mounted(async (container, root) => browserHost(async f => {
  const session = await f.api.session();
  await f.api.mutate(captureHumanIntent({ kind: 'mode', mode: { kind: 'interlocutor', runId: RunIdSchema.parse(randomUUID()), participantId: HumanParticipantIdSchema.parse('visitante-a') }, etag: session.etag, key: randomUUID() }));
  let ready = 0;
  await act(async () => root.render(<><textarea defaultValue="Texto pendiente" /><PreparationSessionPanel api={f.api} restoreSession={f.restoreSession} onReady={() => ready++} /></>)); await f.flush();
  f.loseNextModeReply();
  await act(async () => button(container, 'Activar modo de preparación').click()); await f.flush();
  assert.equal(ready, 0); assert.ok(button(container, 'Recuperar el mismo cambio de modo'));
  const puts = f.counts.puts;
  await act(async () => button(container, 'Restablecer sesión local').click()); await f.flush();
  assert.equal(ready, 1); assert.equal(f.counts.puts, puts); assert.equal(container.querySelector('textarea')?.value, 'Texto pendiente');
  assert.equal(container.textContent?.includes('Recuperar el mismo cambio de modo'), false);
})));

function controlledSession(observer = false): SessionDocument {
  return { etag: '"session:r0"', view: SessionViewSchema.parse({ kind: 'authenticated', expiresAt: '2099-01-01T00:00:00Z', capabilities: [], sessionRevision: 0,
    mode: observer ? { kind: 'observer' } : { kind: 'interlocutor', runId: randomUUID(), participantId: 'visitante-a' } }) };
}

test('reconectar no confirma preparación si el GET fresco conserva un rol de la ficción', async () => mounted(async (container, root) => {
  let reads = 0, ready = 0;
  const api = { async session() { if (++reads === 1) throw new HumanRejection(401, 'Sesión vencida'); return controlledSession(); }, async mutate() { assert.fail('La reconexión no modifica el modo'); } };
  await act(async () => root.render(<PreparationSessionPanel api={api} restoreSession={async () => {}} onReady={() => ready++} />));
  await act(async () => button(container, 'Restablecer sesión local').click());
  assert.equal(reads, 2); assert.equal(ready, 0);
  assert.match(container.textContent ?? '', /Seguís hablando como un personaje/);
  assert.equal(button(container, 'Activar modo de preparación').disabled, false);
}));

for (const replacement of ['unmount', 'api-change'] as const) {
  test(`reconexión pendiente ignora resultado después de ${replacement}, sin lecturas ni permisos del ámbito anterior`, async () => mounted(async (container, root) => {
    let release: () => void = () => assert.fail('Falta barrera');
    const gate = new Promise<void>(resolve => { release = resolve; });
    let oldReads = 0, restores = 0, ready = 0, newReads = 0;
    const api = { async session() { oldReads++; throw new HumanRejection(401, 'Sesión vencida'); }, async mutate() { assert.fail('No modificar el modo'); } };
    const restoreSession = async () => { restores++; await gate; };
    await act(async () => root.render(<PreparationSessionPanel api={api} restoreSession={restoreSession} onReady={() => ready++} />));
    await act(async () => button(container, 'Restablecer sesión local').click());
    assert.equal(button(container, 'Restablecer sesión local').disabled, true);
    await act(async () => button(container, 'Restablecer sesión local').click());
    assert.equal(restores, 1);
    if (replacement === 'unmount') await act(async () => root.render(<p>Panel cerrado</p>));
    else {
      const nextApi = { async session() { newReads++; return controlledSession(true); }, async mutate() { assert.fail('No modificar el modo nuevo'); } };
      await act(async () => root.render(<PreparationSessionPanel api={nextApi} restoreSession={restoreSession} onReady={() => ready++} />));
    }
    await act(async () => release());
    assert.equal(oldReads, 1); assert.equal(ready, 0); assert.equal(newReads, replacement === 'api-change' ? 1 : 0);
    assert.doesNotMatch(container.textContent ?? '', /Sesión restablecida/);
  }));
}
