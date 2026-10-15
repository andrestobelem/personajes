import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { DramaticStructureEventSchema, DramaticStructureSceneOptionsSchema, DramaticStructureViewSchema } from '../src/domain/dramatic-structure.ts';
import { RunIdSchema, RevisionSchema } from '../src/domain/values.ts';
import { createRunDramaticStructureClient, type DramaticStructureDocument, type RunDramaticStructureClient } from '../src/web/run-dramatic-structure-client.ts';

function defineGlobal(name: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (previous === undefined) Reflect.deleteProperty(globalThis, name);
    else Object.defineProperty(globalThis, name, previous);
  };
}

test('scene index opens exact local cuts and explains inherited scenes without inventing links', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  const restoreGlobals = [
    defineGlobal('window', dom.window),
    defineGlobal('document', dom.window.document),
    defineGlobal('navigator', dom.window.navigator),
    defineGlobal('HTMLElement', dom.window.HTMLElement),
    defineGlobal('Node', dom.window.Node),
    defineGlobal('MutationObserver', dom.window.MutationObserver),
    defineGlobal('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window)),
    defineGlobal('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window)),
    defineGlobal('IS_REACT_ACT_ENVIRONMENT', true),
  ];
  let unmount: (() => void) | undefined;
  try {
    const runId = RunIdSchema.parse('11111111-1111-4111-8111-111111111111');
    const episodeId = '22222222-2222-4222-8222-222222222222';
    const sceneIds = [
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ];
    const events = [
      DramaticStructureEventSchema.parse({ runId, structureRevision: 1, operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', principalId: 'operator',
        kind: 'episodeOpened', payload: { episodeId, ordinal: 1, title: 'Prólogo', associatedInitialSceneId: sceneIds[0] },
        payloadHash: 'a'.repeat(64), worldRevision: 1, worldSeq: 0, commitIndex: 4, recordedAt: 1 }),
      DramaticStructureEventSchema.parse({ runId, structureRevision: 2, operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', principalId: 'operator',
        kind: 'sceneClosed', payload: { episodeId, sceneId: sceneIds[0], reason: 'Cambio de escena' },
        payloadHash: 'b'.repeat(64), worldRevision: 2, worldSeq: 0, commitIndex: 12, recordedAt: 2 }),
      DramaticStructureEventSchema.parse({ runId, structureRevision: 3, operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', principalId: 'operator',
        kind: 'sceneOpened', payload: { episodeId, scene: { id: sceneIds[1], label: 'La persecución', lifecycle: { kind: 'open', startedAt: '2026-10-15T10:00:00Z' }, participantIds: [], placeIds: [] } },
        payloadHash: 'c'.repeat(64), worldRevision: 3, worldSeq: 0, commitIndex: 14, recordedAt: 3 }),
      DramaticStructureEventSchema.parse({ runId, structureRevision: 4, operationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', principalId: 'operator',
        kind: 'sceneClosed', payload: { episodeId, sceneId: sceneIds[1], reason: 'Fin de la persecución' },
        payloadHash: 'd'.repeat(64), worldRevision: 4, worldSeq: 0, commitIndex: 18, recordedAt: 4 }),
    ];
    const structure = DramaticStructureViewSchema.parse({ runId, structureRevision: 4, activeEpisodeId: episodeId, activeSceneId: null,
      episodes: [{ episodeId, ordinal: 1, title: 'Prólogo', lifecycle: 'open', openingCut: { worldRevision: 1, worldSeq: 0, structureRevision: 1, commitIndex: 4 },
        closingCut: null, consequenceEventIds: [], openLines: [], sceneIds, acts: [] }], unassignedLegacyScenes: [] });
    const document: DramaticStructureDocument = { value: { ...structure, worldRevision: RevisionSchema.parse(4), worldSeq: RevisionSchema.parse(0), commitIndex: RevisionSchema.parse(18) }, etag: 'test-etag' };
    const structureClient: RunDramaticStructureClient = {
      async read() { return document; },
      async events() { return { events, hasMore: false, structureRevision: RevisionSchema.parse(4) }; },
      async allEvents() { return { events, structureRevision: RevisionSchema.parse(4) }; },
      async sceneOptions() { return DramaticStructureSceneOptionsSchema.parse({ runId, worldRevision: 4, places: [], participants: [] }); },
      async mutate() { return { kind: 'missing' }; },
    };
    const selected: number[] = [];
    const [{ createRoot }, { DramaticStructurePanel }] = await Promise.all([
      import('react-dom/client'),
      import('../src/web/DramaticStructurePanel.tsx'),
    ]);
    const container = dom.window.document.getElementById('root');
    assert.ok(container);
    const root = createRoot(container);
    unmount = () => root.unmount();
    await act(async () => {
      root.render(React.createElement(DramaticStructurePanel, {
        runId, lifecycle: 'closed', active: true, refreshToken: 'test', confirmedEvents: [],
        sceneLabels: sceneIds.map((id, index) => ({ id, label: ['La reunión', 'La persecución', 'Escena heredada'][index]! })),
        onSelectCommit: (commitIndex: number) => selected.push(commitIndex), structureClient,
      }));
    });

    const opening = container.querySelector<HTMLButtonElement>('[aria-label="Ver apertura de La reunión (commit 4)"]');
    const closing = container.querySelector<HTMLButtonElement>('[aria-label="Ver cierre de La reunión (commit 12)"]');
    const secondOpening = container.querySelector<HTMLButtonElement>('[aria-label="Ver apertura de La persecución (commit 14)"]');
    const secondClosing = container.querySelector<HTMLButtonElement>('[aria-label="Ver cierre de La persecución (commit 18)"]');
    assert.ok(opening);
    assert.ok(closing);
    assert.ok(secondOpening);
    assert.ok(secondClosing);
    assert.match(container.textContent ?? '', /Apertura: sin evento local verificable/);
    assert.match(container.textContent ?? '', /Cierre: sin evento local verificable/);

    await act(async () => { opening.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    await act(async () => { closing.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    await act(async () => { secondOpening.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    await act(async () => { secondClosing.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    assert.deepEqual(selected, [4, 12, 14, 18]);
  } finally {
    if (unmount !== undefined) await act(async () => { unmount?.(); });
    dom.window.close();
    for (const restore of restoreGlobals.reverse()) restore();
  }
});

test('all structural event pages are read in order before scene cuts are offered', async () => {
  const runId = RunIdSchema.parse('11111111-1111-4111-8111-111111111111');
  const episodeId = '22222222-2222-4222-8222-222222222222';
  const sceneId = '33333333-3333-4333-8333-333333333333';
  const events = [
    DramaticStructureEventSchema.parse({ runId, structureRevision: 1, operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', principalId: 'operator',
      kind: 'episodeOpened', payload: { episodeId, ordinal: 1, title: null, associatedInitialSceneId: sceneId },
      payloadHash: 'a'.repeat(64), worldRevision: 1, worldSeq: 0, commitIndex: 4, recordedAt: 1 }),
    DramaticStructureEventSchema.parse({ runId, structureRevision: 2, operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', principalId: 'operator',
      kind: 'sceneClosed', payload: { episodeId, sceneId, reason: 'Fin' },
      payloadHash: 'b'.repeat(64), worldRevision: 2, worldSeq: 0, commitIndex: 8, recordedAt: 2 }),
  ];
  const afterValues: number[] = [];
  const client = createRunDramaticStructureClient(async (input) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost');
    const after = Number(url.searchParams.get('afterStructureRevision'));
    afterValues.push(after);
    return Response.json({ events: after === 0 ? [events[0]] : [events[1]], hasMore: after === 0, structureRevision: 2 });
  }, async () => ({ csrfToken: 's'.repeat(32), expiresAt: '2026-10-15T12:00:00Z' }));

  const result = await client.allEvents(runId, new AbortController().signal);
  assert.deepEqual(result.events.map((event) => event.structureRevision), [1, 2]);
  assert.deepEqual(afterValues, [0, 1]);
});
