import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { RunDraftEditor } from '../src/web/RunDraftEditor.tsx';
import { createEmptyRunConfigurationDraft, RunConfigurationDraftSchema } from '../src/domain/production.ts';
import { draftFixture } from './fixtures/continuista.ts';

function render(draft: React.ComponentProps<typeof RunDraftEditor>['draft']) {
  return renderToStaticMarkup(React.createElement(RunDraftEditor, { draft, catalog: [], saving: false,
    onSave() { throw new Error('Rendering must not save'); }, onValidate() { throw new Error('Rendering must not validate'); }, onDirty() {} }));
}

test('editor distingue tiempo acumulado de timeout y ofrece 30000ms para un presupuesto nuevo', () => {
  const draft = createEmptyRunConfigurationDraft({ runId: randomUUID(), revision: 0 });
  const before = JSON.stringify(draft);
  const html = render(draft);
  assert.match(html, /Límite de tiempo acumulado · segundos/);
  assert.match(html, /Timeout por request · milisegundos<input[^>]*min="1000"[^>]*max="300000"[^>]*value="30000"/);
  assert.equal(draft.budget.kind, 'empty');
  assert.equal(JSON.stringify(draft), before, 'Displaying a proposed default does not configure or save it');
});

test('editor muestra timeout explícito y conserva presupuestos históricos sin agregar un campo al renderizar', () => {
  const historical = draftFixture(); assert.ok(historical.budget.kind !== 'empty');
  assert.equal(Object.hasOwn(historical.budget.value, 'requestTimeoutMs'), false);
  const before = JSON.stringify(historical);
  assert.match(render(historical), /Timeout por request · milisegundos<input[^>]*value="30000"/);
  assert.equal(JSON.stringify(historical), before);
  const configured = RunConfigurationDraftSchema.parse({ ...historical, budget: { ...historical.budget,
    value: { ...historical.budget.value, requestTimeoutMs: 120_000 } } });
  assert.match(render(configured), /Timeout por request · milisegundos<input[^>]*value="120000"/);
});
