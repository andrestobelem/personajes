import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { DossierSchema, parseDossierMarkdown } from '../src/domain/catalog.ts';
import { dossierEditableFields, replaceEditorialRow } from '../src/web/dossier-editor-form.ts';
import { DossierEditorForm } from '../src/web/DossierEditorForm.tsx';

function fixture() {
  const markdown = '# Historia\n\nTexto con acentos e historia.\n';
  const dossier = parseDossierMarkdown({ characterId: 'maxwell-smart', displayName: 'Maxwell Smart', markdown, contentHash: createHash('sha256').update(markdown).digest('hex'), aliases: ['Max', '  86  '], performers: ['Don Adams'] });
  return DossierSchema.parse({ ...dossier, sourceRefs: [{ id: 'fuente-1', kind: 'documentary', reference: 'Archivo / licencia conservada', scope: 'Voz e historia', uncertainty: 'Doblaje por verificar' }], unknowns: ['  Fecha desconocida  '], contradictions: ['Versiones incompatibles'], avatarRef: { kind: 'catalog-reference', slug: 'maxwell-smart' }, voiceRecipe: { kind: 'reviewed', recipe: 'Voz nasal, ritmo breve', sourceRefs: ['fuente-1'] } });
}

test('editorial fields preserve every editable field without generated identity or ancestry', () => {
  const dossier = fixture();
  const fields = dossierEditableFields(dossier);
  const expectedKeys = ['aliases', 'avatarRef', 'contradictions', 'displayName', 'markdown', 'performers', 'sourceRefs', 'unknowns', 'voiceRecipe'];
  assert.deepEqual(Object.keys(fields).sort(), expectedKeys.sort());
  for (const key of Object.keys(fields)) assert.ok(key in dossier);
  assert.deepEqual(fields.sourceRefs, dossier.sourceRefs);
  assert.deepEqual(fields.voiceRecipe, dossier.voiceRecipe);
  assert.deepEqual(fields.avatarRef, dossier.avatarRef);
  assert.equal(fields.aliases[1], '  86  ');
  assert.equal(fields.unknowns[0], '  Fecha desconocida  ');
  const firstSource = fields.sourceRefs[0];
  assert.ok(firstSource);
  firstSource.reference = 'Nueva referencia';
  fields.aliases.push('Otro');
  assert.equal(dossier.sourceRefs[0]?.reference, 'Archivo / licencia conservada');
  assert.equal(dossier.aliases.length, 2);
});

test('row updates retain blank and whitespace input for host validation', () => {
  assert.deepEqual(replaceEditorialRow(['Max', '86'], 1, ''), ['Max', '']);
  assert.deepEqual(replaceEditorialRow(['Max'], 0, '  Max  '), ['  Max  ']);
});

test('complete structured form renders all metadata and immutable source, escaping manuscript HTML', () => {
  const dossier = fixture();
  dossier.markdown = '<script>alert(1)</script>';
  const html = renderToStaticMarkup(React.createElement(DossierEditorForm, { initial: dossier, onChange: () => {}, disabled: true, avatarSlugs: ['otro-avatar'] }));
  for (const text of ['Intérpretes', 'Incertidumbre', 'Contradicciones', 'Vacíos', 'IDs de fuentes de voz', 'Don Adams', 'otro-avatar', dossier.contentHash]) assert.ok(html.includes(text), text);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('disabled=""'));
});

test('editorial preview intent freezes exact submitted fields and can be retried without rebasing', async () => {
  const { exchangeIntent } = await import('../src/web/dossier-exchange-client.ts');
  const dossier = fixture();
  const fields = dossierEditableFields(dossier);
  const source = { kind: 'catalog-original', characterId: dossier.characterId, revision: dossier.revision, contentHash: dossier.contentHash, fullArchiveHash: 'a'.repeat(64) };
  const intent = exchangeIntent('/api/v1/dossier-edits/preview', { source, fields, reason: 'Revisión documental' });
  const submitted = intent.bodyJson;
  fields.aliases.push('Cambio posterior');
  fields.markdown = 'No es el manuscrito confirmado';
  assert.equal(intent.bodyJson, submitted);
  assert.ok(Object.isFrozen(intent));
  const parsed = JSON.parse(submitted);
  assert.deepEqual(parsed.fields, dossierEditableFields(dossier));
  assert.equal(parsed.source.fullArchiveHash, 'a'.repeat(64));
  assert.match(intent.key, /^[a-f0-9-]{36}$/);
  assert.throws(() => exchangeIntent('https://example.com/api/v1/dossier-edits/preview', {}));
});
