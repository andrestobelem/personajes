import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MetaIndicationPayloadSchema } from '../src/domain/direction-indications.ts';
import { RunIdSchema } from '../src/domain/values.ts';
import { DirectorMetaIndicationsPanel, MetaIndicationComposer, sendDirectionIntent } from '../src/web/DirectorMetaIndicationsPanel.tsx';
import { createRunDirectionClient, directionEtag } from '../src/web/run-direction-client.ts';

function composer(input: { enabled?: boolean; recipients?: string[]; text?: string } = {}) {
  return renderToStaticMarkup(React.createElement(MetaIndicationComposer, {
    enabled: input.enabled ?? true,
    recipients: input.recipients ?? [],
    availableRecipients: [{ characterId: 'maxwell-smart', label: 'Max' }],
    text: input.text ?? '', scope: 'run',
    onRecipientsChange: () => undefined, onTextChange: () => undefined, onSubmit: () => undefined,
  }));
}

test('un borrador vacío permite seleccionar destinatario y escribir, sin permitir aún registrar', () => {
  const html = composer();
  assert.match(html, /<fieldset>/);
  assert.match(html, /<textarea[^>]*>/);
  assert.doesNotMatch(html, /<textarea[^>]*disabled|<fieldset[^>]*disabled/);
  assert.match(html, /<button type="submit" disabled="">Registrar metaindicación/);
  assert.match(composer({ recipients: ['maxwell-smart'], text: 'Buscá otra táctica.' }), /<button type="submit">Registrar metaindicación/);
});

test('la validación de envío no impide corregir texto vacío, NUL o exceso de bytes UTF-8', () => {
  for (const text of [' ', '\0', 'á'.repeat(2_001)]) {
    const html = composer({ recipients: ['maxwell-smart'], text });
    assert.match(html, /<button type="submit" disabled="">Registrar metaindicación/);
    assert.doesNotMatch(html, /<textarea[^>]*disabled|<fieldset[^>]*disabled/);
  }
  const disabled = composer({ enabled: false, recipients: ['maxwell-smart'], text: 'Buscá otra táctica.' });
  assert.match(disabled, /<fieldset disabled="">/);
  assert.match(disabled, /<textarea[^>]*disabled=""/);
  assert.match(disabled, /<button type="submit" disabled="">/);
});

const bootstrap = async () => ({ csrfToken: 'synthetic-ui-token', expiresAt: '2026-10-15T00:00:00.000Z' });

function remount(runId: string) {
  return renderToStaticMarkup(React.createElement(DirectorMetaIndicationsPanel, {
    runId, lifecycle: 'running', activeSceneId: null, activeSceneLabel: null, sceneParticipantIds: [],
  }));
}

for (const status of [400, 403, 404, 409, 412, 422]) {
  test(`un rechazo HTTP ${status} libera la operación incierta también después de remontar el panel`, async () => {
    const runId = RunIdSchema.parse(randomUUID());
    const intent = { runId, etag: directionEtag(runId, 0), key: randomUUID(), payload: MetaIndicationPayloadSchema.parse({
      kind: 'metaIndication', scope: { kind: 'run' }, recipients: ['maxwell-smart'], text: 'Buscá otra táctica.',
    }) };
    const uncertain = createRunDirectionClient(async () => { throw new Error('Conexión interrumpida.'); }, bootstrap);
    await assert.rejects(sendDirectionIntent(intent, uncertain), /Conexión interrumpida/);
    assert.match(remount(runId), /Reintentar la misma indicación/);
    const rejected = createRunDirectionClient(async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('Idempotency-Key'), intent.key);
      return new Response(JSON.stringify({}), { status });
    }, bootstrap);
    await assert.rejects(sendDirectionIntent(intent, rejected));
    assert.doesNotMatch(remount(runId), /Reintentar la misma indicación/);
  });
}

for (const status of [408, 500]) {
  test(`un HTTP ${status} conserva la misma clave hasta recibir confirmación terminal`, async () => {
    const runId = RunIdSchema.parse(randomUUID());
    const intent = { runId, etag: directionEtag(runId, 0), key: randomUUID(), payload: MetaIndicationPayloadSchema.parse({
      kind: 'metaIndication', scope: { kind: 'run' }, recipients: ['maxwell-smart'], text: 'Buscá otra táctica.',
    }) };
    const uncertain = createRunDirectionClient(async () => new Response(JSON.stringify({}), { status }), bootstrap);
    await assert.rejects(sendDirectionIntent(intent, uncertain));
    assert.match(remount(runId), /Reintentar la misma indicación/);
    const confirmed = createRunDirectionClient(async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('Idempotency-Key'), intent.key);
      return new Response(JSON.stringify({ kind: 'existing', receipt: { operationId: randomUUID(), directionRevision: 1, recordedAt: 100 } }), {
        status: 200, headers: { ETag: directionEtag(runId, 1) },
      });
    }, bootstrap);
    assert.equal((await sendDirectionIntent(intent, confirmed)).kind, 'existing');
    assert.doesNotMatch(remount(runId), /Reintentar la misma indicación/);
  });
}
