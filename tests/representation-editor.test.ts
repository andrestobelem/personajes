import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RunDraftEditor } from '../src/web/RunDraftEditor.tsx';
import { RunConfigurationDraftSchema } from '../src/domain/production.ts';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import { createDraftSaveIntent } from '../src/web/run-drafts-client.ts';
import { draftFixture } from './fixtures/continuista.ts';

test('el editor de representación incluye curación de cada actor, continuidad, identidad humana y escenario', () => {
  const html = renderToStaticMarkup(React.createElement(RunDraftEditor, { draft: draftFixture(), catalog: [], saving: false, readOnly: false, onSave: () => {}, onValidate: () => {}, onDirty: () => {} }));
  assert.match(html, /Quiénes participan/);
  assert.match(html, /Preparar a cada actor/);
  assert.match(html, /No se importa automáticamente el dossier/);
  assert.match(html, /Continuidad elegida/);
  assert.match(html, /Tu identidad dentro de la ficción/);
  assert.match(html, /Escenario/);
  assert.match(html, /Aplicá las secciones|Las secciones en edición/);
});

test('fixture sintética completa conserva PreparedCharacter al guardar y requiere el contexto entero para validar', () => {
  const source = draftFixture();
  const intent = createDraftSaveIntent({ kind: 'create', configuration: source, key: 'synthetic-save-key' });
  const serialized: unknown = JSON.parse(intent.body);
  const request = { configuration: source };
  assert.deepEqual(serialized, request);
  const reopened = RunConfigurationDraftSchema.parse(JSON.parse(JSON.stringify(source)));
  assert.deepEqual(reopened.roster, source.roster);
  const complete = validateRunConfiguration({ draft: reopened });
  assert.equal(complete.kind, 'ready', 'Only local constructive validation, no OAuth/inference/scene execution');
  if (reopened.roster.kind === 'empty') throw new Error('Fixture roster required');
  const missingContext = RunConfigurationDraftSchema.parse({ ...reopened, roster: { ...reopened.roster, value: { ...reopened.roster.value, preparedCharacters: [] } } });
  const incomplete = validateRunConfiguration({ draft: missingContext });
  assert.notEqual(incomplete.kind, 'ready');
  if (incomplete.kind === 'ready') throw new Error('Unprepared actor cannot be Ready');
  assert.ok(incomplete.issues.some((issue) => issue.code === 'actor-not-prepared'));
});
