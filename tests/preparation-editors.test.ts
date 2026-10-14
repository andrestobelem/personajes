import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEmptyRunConfigurationDraft } from '../src/domain/production.ts';
import { ContinuityContextSchema } from '../src/domain/preparation.ts';
import { changeDraftField } from '../src/web/draft-form.ts';
import { compileContinuityForm, continuityForm, ContinuityPreparationEditor } from '../src/web/ContinuityPreparationEditor.tsx';
import { compileHumanForm, humanForm, HumanPreparationEditor } from '../src/web/HumanPreparationEditor.tsx';
const empty = () => createEmptyRunConfigurationDraft({ runId: '11111111-1111-4111-8111-111111111111', revision: 0 });
const sceneId = '22222222-2222-4222-8222-222222222222';
const worldDraft = () => changeDraftField({ draft: empty(), field: 'worldSnapshot', value: {
  places: [{ id: 'lugar-elegido', name: 'Lugar escrito en prueba', description: '', width: 10, height: 8, lighting: 'normal' }],
  scenes: [{ id: sceneId, label: 'Escena elegida', lifecycle: { kind: 'open', startedAt: 0 }, participantIds: ['maxwell-smart'], placeIds: ['lugar-elegido'] }],
  channels: [{ kind: 'speech', id: '55555555-5555-4555-8555-555555555555', label: 'Habla elegida', enabled: true, maxRange: 5, scope: 'addressed', placeIds: ['lugar-elegido'] }],
} });

test('continuidad empieza vacía y rechaza vacíos, hitos duplicados y confirmaciones sin autor', async () => {
  const blank = continuityForm(undefined);
  assert.equal(blank.kind, ''); assert.equal(blank.label, ''); assert.equal(blank.revision, '');
  await assert.rejects(compileContinuityForm(blank), /revisión/);
  const base = { ...blank, continuityId: 'continuidad-elegida', kind: 'adaptation', revision: '0', label: 'Corte escrito en prueba' };
  const milestone = { milestoneId: 'hito-a', label: 'Hecho escrito', status: 'undetermined', sources: 'fuente-a' };
  await assert.rejects(compileContinuityForm({ ...base, milestones: [milestone, milestone] }), /duplicado/);
  await assert.rejects(compileContinuityForm({ ...base, inclusions: [{ inclusionId: '33333333-3333-4333-8333-333333333333', label: 'Excepción escrita', sources: '', confirmedBy: '', confirmedAt: '' }] }));
  const first = await compileContinuityForm({ ...base, milestones: [milestone] });
  const second = await compileContinuityForm({ ...base, milestones: [milestone] });
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.milestones[0]?.status, 'undetermined');
  assert.deepEqual(first.milestones[0]?.sourceRefs, ['fuente-a']);
});

test('edición continuidad conserva confirmación previa exacta y estados históricos sin inventarlos', async () => {
  const prior = ContinuityContextSchema.parse({ continuityId: 'adaptacion-a', revision: 3, contentHash: 'b'.repeat(64), kind: 'adaptation', label: 'Corte elegido', milestones: [{ milestoneId: 'hito-a', label: 'Todavía no ocurrió', status: 'notReached', sourceRefs: [] }], inclusions: [{ inclusionId: '33333333-3333-4333-8333-333333333333', label: 'Elección', sourceRefs: ['fuente-a'], confirmedBy: 'Operador escrito', confirmedAt: '2026-01-01T00:00:00Z' }] });
  const updated = await compileContinuityForm(continuityForm(prior), prior);
  assert.deepEqual(updated.inclusions, prior.inclusions);
  assert.deepEqual(updated.milestones, prior.milestones);
  assert.equal(updated.revision, 3);
});

test('perfil humano no inventa nombre, biografía, coordenadas ni presencia; valida escena/canal/geometría', () => {
  const blank = humanForm();
  assert.match(blank.participantId, /^humano-/);
  assert.equal(blank.displayName, ''); assert.equal(blank.identity, ''); assert.equal(blank.lifeStory, ''); assert.equal(blank.x, ''); assert.equal(blank.presence, '');
  assert.throws(() => compileHumanForm({ form: blank, draft: worldDraft() }), /identidad completa/);
  const authored = { ...blank, displayName: 'Identidad de prueba', identity: '# Identidad\nTexto escrito', lifeStory: '# Vida\nHistoria escrita', presence: 'inScene', sceneId, placeId: 'lugar-elegido', channelId: '55555555-5555-4555-8555-555555555555', x: '2', y: '3' };
  const profile = compileHumanForm({ form: authored, draft: worldDraft() });
  assert.equal(profile.identity.identityMarkdown, authored.identity);
  assert.equal(profile.identity.lifeStoryMarkdown, authored.lifeStory);
  assert.deepEqual(humanForm(profile), authored);
  assert.throws(() => compileHumanForm({ form: { ...authored, x: '11' }, draft: worldDraft() }), /dentro/);
  assert.throws(() => compileHumanForm({ form: { ...authored, channelId: '66666666-6666-4666-8666-666666666666' }, draft: worldDraft() }), /canal/);
  assert.throws(() => compileHumanForm({ form: { ...authored, sceneId: '44444444-4444-4444-8444-444444444444' }, draft: worldDraft() }), /escena abierta/);
  assert.throws(() => compileHumanForm({ form: { ...authored, lifeStory: '' }, draft: worldDraft() }));
  const remote = compileHumanForm({ form: { ...authored, presence: 'remote', sceneId: '' }, draft: worldDraft() });
  assert.equal(remote.presence.kind, 'remote');
  assert.equal('sceneId' in remote.presence, false);
});

test('formularios renderizados presentan edición narrativa y listas sin JSON ni datos personales prefabricados', () => {
  const props = { draft: empty(), onChange: () => {}, onPendingChange: () => {} };
  const continuity = renderToStaticMarkup(React.createElement(ContinuityPreparationEditor, props));
  assert.match(continuity, /Hitos históricos y estado/);
  assert.match(continuity, /Inclusiones y adaptaciones/);
  assert.doesNotMatch(continuity, /value="original" selected/);
  const human = renderToStaticMarkup(React.createElement(HumanPreparationEditor, props));
  assert.match(human, /No hay perfiles redactados/);
  assert.match(human, /Agregar identidad ficticia/);
  assert.doesNotMatch(human, /Identidad de prueba/);
  const profile = compileHumanForm({ form: { ...humanForm(), displayName: 'Elegido', identity: 'Identidad escrita', lifeStory: 'Historia escrita', presence: 'remote', placeId: 'lugar-elegido', channelId: '55555555-5555-4555-8555-555555555555', x: '0', y: '0' }, draft: worldDraft() });
  const draft = changeDraftField({ draft: worldDraft(), field: 'humanParticipants', value: [profile] });
  const populated = renderToStaticMarkup(React.createElement(HumanPreparationEditor, { ...props, draft }));
  assert.match(populated, /Identidad completa/); assert.match(populated, /Historia de vida/); assert.match(populated, /Canal de habla/);
  assert.doesNotMatch(populated, /<textarea[^>]*>\s*\{/);
});
