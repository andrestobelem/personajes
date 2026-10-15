import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { z } from 'zod';
import { CatalogCharacterSummarySchema } from '../src/domain/http.ts';
import { RunConfigurationDraftSchema } from '../src/domain/production.ts';
import { DOCUMENTED_CONTINUITY_CUTS } from '../src/application/documented-continuity-cuts.ts';

function defineGlobal(name: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (previous === undefined) Reflect.deleteProperty(globalThis, name);
    else Object.defineProperty(globalThis, name, previous);
  };
}

test('el selector permite cancelar, crear en blanco y revisar ensayo o continuidad antes del guardado explícito', async () => {
  const dom = new JSDOM('<!doctype html><html><head><meta name="personajes-bootstrap" content="0123456789abcdefghijklmnopqrstuv"></head><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const requests: { url: string; method: string; body: string | null }[] = [];
  const restores = [
    defineGlobal('window', dom.window), defineGlobal('document', dom.window.document),
    defineGlobal('navigator', dom.window.navigator), defineGlobal('HTMLElement', dom.window.HTMLElement),
    defineGlobal('Node', dom.window.Node), defineGlobal('IS_REACT_ACT_ENVIRONMENT', true),
    defineGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null });
      if (url === '/api/v1/session') return Response.json({ csrfToken: 's'.repeat(32), expiresAt: '2026-10-15T12:00:00Z' });
      if (url.startsWith('/api/v1/runs?')) return Response.json({ items: [] });
      if (url === '/api/v1/runs' && init?.method === 'POST') return Response.json({ error: { kind: 'validation', code: 'test-stop', message: 'Guardado detenido por el servidor de prueba.', issues: [] }, requestId: '00000000-0000-4000-8000-000000000001' }, { status: 400 });
      throw new Error(`Solicitud inesperada: ${url}`);
    }),
  ];
  let unmount: (() => void) | undefined;
  try {
    const [{ createRoot }, { RunDraftWorkspace }] = await Promise.all([import('react-dom/client'), import('../src/web/RunDraftWorkspace.tsx')]);
    const container = dom.window.document.getElementById('root');
    assert.ok(container);
    const root = createRoot(container); unmount = () => root.unmount();
    const catalog = ['maxwell-smart', 'hymie'].map((id) => CatalogCharacterSummarySchema.parse({ characterId: id, displayName: id === 'hymie' ? 'Hymie' : 'Maxwell Smart', revision: 0, hash: 'a'.repeat(64), curationStatus: 'unreviewed', avatarRef: { kind: 'catalog-reference', slug: id } }));
    await act(async () => root.render(React.createElement(RunDraftWorkspace, { catalog })));
    const button = (text: string) => {
      const match = [...container.querySelectorAll('button')].find((entry) => entry.textContent === text);
      assert.ok(match, `Botón disponible: ${text}`); return match;
    };
    const click = async (text: string) => { await act(async () => button(text).click()); };
    const until = async (condition: () => boolean) => {
      const deadline = Date.now() + 3000;
      while (!condition() && Date.now() < deadline) await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 5)); });
      assert.ok(condition(), 'La edición debe resolver su operación local.');
    };
    await click('＋ Nueva preparación');
    assert.ok(container.querySelector('[aria-label="Elegir punto de partida"]'));
    await click('Volver sin crear');
    assert.equal(container.querySelector('.draft-editor'), null);
    await click('＋ Nueva preparación'); await click('Empezar en blanco');
    await until(() => container.querySelector('.draft-editor') !== null);
    assert.match(container.textContent ?? '', /Borrador sin nombre/);
    await click('＋ Nueva preparación');
    assert.match(container.textContent ?? '', /Hay cambios locales sin guardar/);
    await click('Seguir editando');
    assert.match(container.textContent ?? '', /Borrador sin nombre/);
    await click('＋ Nueva preparación'); await click('Descartar cambios y abrir');
    await click('Proponer ensayo Max y Hymie');
    await until(() => container.querySelector('.draft-editor') !== null);
    assert.match(container.textContent ?? '', /Ensayo sintético propuesto/);
    assert.match(container.textContent ?? '', /0 contextos preparados/);
    const nameSection = container.querySelector('.draft-checklist a[href="#draft-name"]')?.closest('li');
    assert.ok(nameSection);
    assert.match(nameSection.textContent ?? '', /Propuesto/);
    const accept = nameSection.querySelector('button'); assert.ok(accept);
    await act(async () => accept.click());
    assert.match(nameSection.textContent ?? '', /Configurado/);
    assert.equal(requests.filter((request) => request.url !== '/api/v1/session' && !request.url.startsWith('/api/v1/runs?')).length, 0, 'Seleccionar y confirmar propuestas sólo edita el candidato local.');
    await click('Guardar borrador');
    await until(() => requests.some((request) => request.url === '/api/v1/runs'));
    const saved = requests.find((request) => request.url === '/api/v1/runs'); assert.ok(saved?.body);
    const { configuration: draft } = z.strictObject({ configuration: RunConfigurationDraftSchema }).parse(JSON.parse(saved.body));
    assert.equal(draft.name.kind, 'configured');
    assert.equal(draft.fictionalAt.kind, 'proposed');
    assert.equal(draft.continuity.kind, 'proposed');
    assert.equal(draft.roster.kind, 'proposed');
    if (draft.roster.kind !== 'proposed') assert.fail('El reparto debe seguir propuesto.');
    assert.deepEqual(draft.roster.value.preparedCharacters, []);
    assert.equal(requests.some((request) => /oauth|access|start|interventions/.test(request.url)), false);
    await until(() => container.textContent?.includes('Guardado detenido por el servidor de prueba.') === true);
    assert.match(container.textContent ?? '', /Ensayo de conocimiento: Max y Hymie/);
    await click('＋ Nueva preparación'); await click('Descartar cambios y abrir');
    assert.equal(button('Proponer continuidad elegida').disabled, true);
    const cut = DOCUMENTED_CONTINUITY_CUTS[0]; assert.ok(cut);
    const select = container.querySelector('#documented-continuity-cut');
    assert.ok(select instanceof dom.window.HTMLSelectElement);
    const priorRequestCount = requests.length;
    await act(async () => { select.value = cut.id; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    const sources = container.querySelector('[aria-label="Fuentes y límites del corte"]'); assert.ok(sources);
    for (const source of cut.sources) {
      assert.ok([...sources.querySelectorAll('a')].some((link) => link.href === source.url));
      assert.ok(sources.textContent?.includes(source.uncertainty));
    }
    await click('Proponer continuidad elegida');
    await until(() => container.textContent?.includes('Corte documental propuesto.') === true);
    assert.equal(requests.length, priorRequestCount, 'Elegir un corte documentado no escribe ni consulta servicios.');
    assert.equal(container.querySelector('#draft-fictionalAt input')?.getAttribute('value'), '');
    await click('Guardar borrador');
    await until(() => requests.filter((request) => request.url === '/api/v1/runs').length === 2);
    const documentedRequest = requests.filter((request) => request.url === '/api/v1/runs').at(-1); assert.ok(documentedRequest?.body);
    const documented = z.strictObject({ configuration: RunConfigurationDraftSchema }).parse(JSON.parse(documentedRequest.body)).configuration;
    assert.equal(documented.continuity.kind, 'proposed');
    assert.equal(documented.name.kind, 'proposed');
    assert.equal(documented.fictionalAt.kind, 'empty');
    assert.equal(documented.worldSnapshot.kind, 'empty');
    assert.equal(documented.roster.kind, 'empty');
    if (documented.continuity.kind !== 'proposed') assert.fail('El corte debe seguir propuesto.');
    assert.ok(documented.continuity.value.milestones.some((milestone) => milestone.status === 'undetermined'));
    for (const source of cut.sources) assert.ok(documented.continuity.value.milestones.some((milestone) => milestone.sourceRefs.some((reference) => reference === source.url)));
    await until(() => container.textContent?.includes('Guardado detenido por el servidor de prueba.') === true);
  } finally {
    if (unmount) await act(async () => unmount?.());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});
