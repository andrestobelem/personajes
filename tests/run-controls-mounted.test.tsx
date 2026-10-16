import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { openJournal } from '../src/adapters/journal.ts';
import { createRunLifecycleApplication } from '../src/application/run-lifecycle.ts';
import { RunControlsPanel } from '../src/web/RunControlsPanel.tsx';
import { runEtag, type RunControlIntent, type RunControlsClient } from '../src/web/run-controls-client.ts';
import { createCleanReadyPreflightFixture, recordSyntheticPassedPreflight } from './fixtures/preflight.ts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-controls-mounted-'));
  const journal = openJournal({ path: join(directory, 'journal.sqlite') });
  const { runId } = createCleanReadyPreflightFixture({ journal });
  const jobId = recordSyntheticPassedPreflight({ journal, runId });
  const found = journal.readRunPreflightJob({ runId, jobId });
  assert.equal(found.kind, 'found');
  const application = createRunLifecycleApplication({ journal,
    preflights: { readJob: () => found.document },
    runtime: { scheduleRun: async () => true, cancelRun: async () => true } });
  const intents: RunControlIntent[] = [];
  const read = async () => {
    const view = application.readRunView({ runId }); assert.ok(view);
    return { view, etag: runEtag(view) };
  };
  const api: RunControlsClient = {
    read,
    stepJob: async () => { throw new Error('No step requested'); },
    mutate: async intent => {
      intents.push(intent);
      const view = intent.document.view;
      const result = await application.controlRun({ runId, principalId: 'local-operator', idempotencyKey: intent.key,
        expectedConfigurationRevision: view.configRevision, expectedWorldRevision: view.worldRevision,
        expectedStructureRevision: view.structureRevision, expectedLifecycleRevision: view.lifecycleRevision,
        command: intent.command });
      assert.equal(result.kind, 'updated', JSON.stringify(result));
      return { document: { view: result.run, etag: runEtag(result.run) }, job: null };
    },
  };
  const preflight = { history: async () => ({ items: [found.document], truncated: false }) };
  return { runId, journal, api, read, preflight, intents,
    close() { journal.close(); rmSync(directory, { recursive: true, force: true }); } };
}

async function mounted(run: (container: HTMLElement, root: ReturnType<typeof createRoot>) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const names = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = names.map(name => ({ name, value: Object.getOwnPropertyDescriptor(globalThis, name) }));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const container = dom.window.document.getElementById('root'); assert.ok(container);
  const root = createRoot(container);
  try { await run(container, root); }
  finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const original of originals) {
      if (original.value) Object.defineProperty(globalThis, original.name, original.value);
      else Reflect.deleteProperty(globalThis, original.name);
    }
  }
}
function button(container: HTMLElement, name: string) {
  const found = [...container.querySelectorAll('button')].find(value => value.textContent === name);
  assert.ok(found, name); return found;
}
function expired() { return { kind: 'run-control-rejected', status: 401, message: 'Sesión vencida.', requestId: randomUUID() }; }

test('error transitorio de lectura desaparece al recuperar una lectura confirmada, sin perder mensajes de operación', async () => {
  const f = fixture();
  try { await mounted(async (container, root) => {
    let first = true;
    f.api.read = async () => { if (first) { first = false; throw new Error('offline'); } return f.read(); };
    await act(async () => root.render(<RunControlsPanel runId={f.runId} api={f.api} preflight={f.preflight} />));
    assert.match(container.textContent ?? '', /No se pudo sincronizar/);
    assert.equal(button(container, 'Iniciar').disabled, true);
    await act(async () => button(container, 'Actualizar estado').click());
    assert.match(container.textContent ?? '', /Lista para iniciar/);
    assert.doesNotMatch(container.textContent ?? '', /No se pudo sincronizar/);
    assert.equal(button(container, 'Iniciar').disabled, false);
    assert.equal(f.intents.length, 0);
  }); } finally { f.close(); }
});

test('sesión vencida se restablece explícitamente; luego Iniciar cambia el journal una sola vez', async () => {
  const f = fixture();
  try { await mounted(async (container, root) => {
    let authorized = false, restores = 0;
    f.api.read = async () => { if (!authorized) throw expired(); return f.read(); };
    await act(async () => root.render(<RunControlsPanel runId={f.runId} api={f.api} preflight={f.preflight}
      restoreSession={async () => { restores++; authorized = true; }} />));
    assert.equal(f.intents.length, 0);
    await act(async () => button(container, 'Restablecer sesión local').click());
    assert.equal(restores, 1);
    assert.equal(f.intents.length, 0, 'reconectar no inicia ni repite controles');
    assert.doesNotMatch(container.textContent ?? '', /No se pudo sincronizar/);
    await act(async () => button(container, 'Iniciar').click());
    assert.equal(f.intents.length, 1);
    assert.equal(f.intents[0]?.command.kind, 'start');
    assert.equal(f.journal.readWorldLifecycle({ runId: f.runId })?.lifecycle, 'running');
    assert.match(container.textContent ?? '', /En ejecución/);
  }); } finally { f.close(); }
});

test('recuperar sesión conserva una operación incierta; sólo el usuario repite la misma clave y no duplica la transición', async () => {
  const f = fixture();
  try { await mounted(async (container, root) => {
    let authorized = true, lost = true;
    const mutate = f.api.mutate;
    f.api.read = async () => { if (!authorized) throw expired(); return f.read(); };
    f.api.mutate = async (intent, signal) => {
      if (!authorized) throw expired();
      const result = await mutate(intent, signal);
      if (lost) { lost = false; throw new Error('response lost after commit'); }
      return result;
    };
    await act(async () => root.render(<RunControlsPanel runId={f.runId} api={f.api} preflight={f.preflight}
      restoreSession={async () => { authorized = true; }} />));
    await act(async () => button(container, 'Iniciar').click());
    const committed = f.journal.readWorldLifecycle({ runId: f.runId }); assert.ok(committed);
    assert.equal(committed.lifecycle, 'running');
    assert.equal(f.intents.length, 1);
    authorized = false;
    await act(async () => button(container, 'Recuperar el mismo control').click());
    assert.ok(button(container, 'Recuperar el mismo control'));
    await act(async () => button(container, 'Restablecer sesión local').click());
    assert.equal(f.intents.length, 1);
    await act(async () => button(container, 'Recuperar el mismo control').click());
    assert.equal(f.intents.length, 2);
    assert.deepEqual(f.intents[1], f.intents[0]);
    assert.equal(f.journal.readWorldLifecycle({ runId: f.runId })?.lifecycleRevision, committed.lifecycleRevision);
    assert.match(container.textContent ?? '', /Control confirmado/);
  }); } finally { f.close(); }
});

test('CSRF de otra pestaña ofrece recuperación aunque GET siga válido y exige otro clic explícito para iniciar', async () => {
  const f = fixture();
  try { await mounted(async (container, root) => {
    let authorized = false, attempts = 0;
    const mutate = f.api.mutate;
    f.api.mutate = async (intent, signal) => {
      attempts++;
      if (!authorized) throw { kind: 'run-control-rejected', status: 403, message: 'Token CSRF inválido.', requestId: randomUUID() };
      return mutate(intent, signal);
    };
    await act(async () => root.render(<RunControlsPanel runId={f.runId} api={f.api} preflight={f.preflight}
      restoreSession={async () => { authorized = true; }} />));
    await act(async () => button(container, 'Iniciar').click());
    assert.equal(attempts, 1);
    assert.equal(f.intents.length, 0);
    await act(async () => button(container, 'Restablecer sesión local').click());
    assert.equal(attempts, 1);
    assert.equal(f.journal.readWorldLifecycle({ runId: f.runId })?.lifecycle, 'ready');
    await act(async () => button(container, 'Recuperar el mismo control').click());
    assert.equal(attempts, 2);
    assert.equal(f.intents.length, 1);
    assert.equal(f.journal.readWorldLifecycle({ runId: f.runId })?.lifecycle, 'running');
  }); } finally { f.close(); }
});

test('inicio pendiente informa verificación y envío, bloquea doble clic y espera el recibo antes de mostrar ejecución', async () => {
  const f = fixture();
  try { await mounted(async (container, root) => {
    let releaseHistory: () => void = () => { throw new Error('history gate missing'); };
    let releaseMutation: () => void = () => { throw new Error('mutation gate missing'); };
    const historyGate = new Promise<void>(resolve => { releaseHistory = resolve; });
    const mutationGate = new Promise<void>(resolve => { releaseMutation = resolve; });
    const history = f.preflight.history, mutate = f.api.mutate;
    f.preflight.history = async () => { await historyGate; return history(); };
    f.api.mutate = async (intent, signal) => { await mutationGate; return mutate(intent, signal); };
    await act(async () => root.render(<RunControlsPanel runId={f.runId} api={f.api} preflight={f.preflight} />));
    await act(async () => button(container, 'Iniciar').click());
    assert.match(container.textContent ?? '', /Verificando requisitos de ejecución/);
    assert.equal(button(container, 'Iniciar').disabled, true);
    await act(async () => button(container, 'Iniciar').click());
    await act(async () => releaseHistory());
    assert.match(container.textContent ?? '', /Solicitando el inicio/);
    assert.doesNotMatch(container.textContent ?? '', /Estado: En ejecución/);
    assert.equal(f.intents.length, 0);
    await act(async () => releaseMutation());
    assert.equal(f.intents.length, 1);
    assert.match(container.textContent ?? '', /En ejecución/);
  }); } finally { f.close(); }
});
