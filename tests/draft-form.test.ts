import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RevisionSchema } from '../src/domain/values.ts';
import { createEmptyRunConfigurationDraft } from '../src/domain/production.ts';
import { changeDraftField, draftMomentInputs, parseFixedMoment, reconcileDraft, setDraftMoment, setDraftPlace } from '../src/web/draft-form.ts';
import { createDraftSaveIntent, buildDraftSaveRequest, executeDraftSave } from '../src/web/run-drafts-client.ts';
import { RunDraftEditor } from '../src/web/RunDraftEditor.tsx';

const runId = 'bcda1234-1111-4111-8111-111111111111';
const empty = () => createEmptyRunConfigurationDraft({ runId, revision: 0 });

test('la fecha ficticia exige datos explícitos y conserva fecha local con offset al reabrir', () => {
  assert.deepEqual(draftMomentInputs(empty()), { kind: 'editable', dateTime: '', offset: '' });
  assert.equal(parseFixedMoment({ dateTime: '1966-02-29T23:30', offset: '-03:00' }).kind, 'invalid');
  assert.equal(parseFixedMoment({ dateTime: '1968-02-29T23:30', offset: '' }).kind, 'invalid');
  assert.equal(parseFixedMoment({ dateTime: '1968-02-29T23:30', offset: '+14:01' }).kind, 'invalid');
  const applied = setDraftMoment({ draft: empty(), dateTime: '1968-02-29T23:30', offset: '-03:00' });
  assert.equal(applied.kind, 'applied');
  if (applied.kind !== 'applied') throw new Error('Expected applied');
  assert.equal(applied.draft.fictionalAt.kind, 'configured');
  if (applied.draft.fictionalAt.kind !== 'configured') throw new Error('Expected configured');
  assert.equal(new Date(applied.draft.fictionalAt.value).toISOString(), '1968-03-01T02:30:00.000Z');
  assert.deepEqual(draftMomentInputs(applied.draft), { kind: 'editable', dateTime: '1968-02-29T23:30:00', offset: '-03:00' });
});

test('una convención IANA guardada no se reinterpreta silenciosamente en UTC', () => {
  const instant = Date.UTC(1966, 0, 1, 12);
  const draft = changeDraftField({ draft: changeDraftField({ draft: empty(), field: 'fictionalAt', value: instant }),
    field: 'worldSnapshot', value: { clock: { instant, convention: { kind: 'ianaZone', zone: 'America/New_York' } } } });
  assert.deepEqual(draftMomentInputs(draft), { kind: 'unsupported', dateTime: '', offset: '', label: 'Zona IANA: America/New_York', instant });
});

test('editar un lugar conserva sus IDs, otros lugares y el reloj, sin inventar escenas', () => {
  const place = { id: 'lugar-a', name: 'Nombre elegido', description: '', width: 6, height: 4, lighting: 'normal' };
  const other = { ...place, id: 'lugar-b', name: 'Otro elegido' };
  const clock = { instant: 0, convention: { kind: 'fixedOffset', offsetMinutes: 0, label: 'UTC' } };
  const draft = changeDraftField({ draft: empty(), field: 'worldSnapshot', value: { places: [place, other], clock } });
  const updated = setDraftPlace({ draft, name: 'Cambio elegido', description: 'Descripción', width: '9', height: '5', lighting: 'dim' });
  assert.notEqual(updated.worldSnapshot.kind, 'empty');
  if (updated.worldSnapshot.kind === 'empty') throw new Error('Expected world');
  assert.deepEqual(updated.worldSnapshot.value.places?.map((item) => item.id), ['lugar-a', 'lugar-b']);
  assert.deepEqual(updated.worldSnapshot.value.places?.[1], other);
  assert.deepEqual(updated.worldSnapshot.value.clock, clock);
  assert.equal(updated.worldSnapshot.value.scenes, undefined);
  assert.throws(() => setDraftPlace({ draft, name: '', description: '', width: '9', height: '5', lighting: 'dim' }));
});

test('reconciliar preserva elecciones locales seleccionadas y novedades remotas con la revisión vigente', () => {
  const baseline = empty();
  const local = changeDraftField({ draft: baseline, field: 'name', value: 'Edición local' });
  const remote = changeDraftField({ draft: { ...baseline, revision: RevisionSchema.parse(2) }, field: 'narrationMode', value: { kind: 'enabled' } });
  const merged = reconcileDraft({ local, remote, keepLocal: ['name'] });
  assert.deepEqual(merged.name, local.name);
  assert.deepEqual(merged.narrationMode, remote.narrationMode);
  assert.equal(merged.revision, 2);
  assert.deepEqual(remote.name, baseline.name);
  assert.deepEqual(local.narrationMode, baseline.narrationMode);
  assert.throws(() => reconcileDraft({ local, remote: createEmptyRunConfigurationDraft({ runId: 'bcda1234-2222-4222-8222-222222222222', revision: 0 }), keepLocal: ['name'] }));
});

test('guardado capturado reintenta mismo payload y key aun ante mutación del caller, con precondiciones HTTP', () => {
  const configuration = empty();
  const create = createDraftSaveIntent({ kind: 'create', configuration, key: 'stable-create-key' });
  const first = buildDraftSaveRequest({ intent: create, csrfToken: 'csrf' });
  configuration.name = { kind: 'empty' }; configuration.revision = RevisionSchema.parse(17);
  const retry = buildDraftSaveRequest({ intent: create, csrfToken: 'csrf' });
  assert.deepEqual(retry, first);
  assert.equal(first.path, '/api/v1/runs');
  assert.equal(first.init.method, 'POST');
  assert.equal(new Headers(first.init.headers).get('If-None-Match'), '*');
  assert.equal(first.init.headers['Idempotency-Key'], 'stable-create-key');
  assert.equal(first.init.headers['X-CSRF-Token'], 'csrf');
  assert.equal(JSON.parse(first.init.body).configuration.revision, 0);
  const update = buildDraftSaveRequest({ intent: createDraftSaveIntent({ kind: 'replace', configuration: empty(), key: 'stable-update-key', etag: `"run-config:${runId}:c0"` }), csrfToken: 'csrf' });
  assert.equal(update.init.method, 'PUT');
  assert.equal(new Headers(update.init.headers).get('If-Match'), `"run-config:${runId}:c0"`);
  assert.equal(new Headers(update.init.headers).get('If-None-Match'), null);
});

test('editor renderizado deja circunstancias sin inventar y bloquea configuración promovida', () => {
  const props = { draft: empty(), catalog: [], saving: false, onSave: () => {}, onValidate: () => {}, onDirty: () => {} };
  const draftMarkup = renderToStaticMarkup(React.createElement(RunDraftEditor, props));
  assert.match(draftMarkup, /Fecha y hora ficticias/);
  assert.match(draftMarkup, /Elegí un nombre/);
  assert.match(draftMarkup, /Pendiente/);
  assert.doesNotMatch(draftMarkup, /<textarea[^>]*>\s*\{/);
  const promoted = renderToStaticMarkup(React.createElement(RunDraftEditor, { ...props, readOnly: true, lifecycle: 'ready' }));
  assert.match(promoted, /Estado: ready/);
  assert.match(promoted, /<fieldset[^>]*disabled/);
  assert.match(promoted, /disabled=""[^>]*>Guardar borrador/);
  const readyEditable = renderToStaticMarkup(React.createElement(RunDraftEditor, { ...props, readOnly: false, lifecycle: 'ready' }));
  assert.match(readyEditable, /Guardar cambios la devuelve a borrador/);
  assert.doesNotMatch(readyEditable, /disabled=""[^>]*>Guardar borrador/);
});


test('respuesta perdida y replay conservan ack original; GET avanzado se separa para reconciliar sin perder contenido local', async () => {
  const placeholder = empty();
  const saved = changeDraftField({ draft: createEmptyRunConfigurationDraft({ runId: 'bcda1234-3333-4333-8333-333333333333', revision: 0 }), field: 'name', value: 'Elección guardada' });
  const remote = changeDraftField({ draft: { ...saved, revision: RevisionSchema.parse(1) }, field: 'name', value: 'Edición posterior' });
  const intent = createDraftSaveIntent({ kind: 'create', configuration: placeholder, key: 'same-key-on-replay' });
  const requests: { path: string; init: RequestInit | undefined }[] = [];
  let lost = false;
  const transport: typeof fetch = async (path, init) => {
    requests.push({ path: String(path), init });
    if (init?.method === 'POST') {
      if (!lost) { lost = true; throw new Error('Response lost after durable write'); }
      return Response.json({ kind: 'run-configuration-draft-receipt', configuration: saved }, { status: 201, headers: { ETag: `"run-config:${saved.runId}:c0"` } });
    }
    return Response.json({ kind: 'run-configuration-draft', configuration: remote, state: { lifecycle: 'draft', configurationRevision: 1, worldRevision: null }, validation: { kind: 'incomplete', promotion: 'not-promoted', issues: [{ field: 'fictionalAt', code: 'draft-field-empty', detail: 'Pendiente' }] } }, { headers: { ETag: `"run-config:${saved.runId}:c1"` } });
  };
  await assert.rejects(executeDraftSave({ intent, csrfToken: 'csrf', request: transport }), /Response lost/);
  const result = await executeDraftSave({ intent, csrfToken: 'csrf', request: transport });
  assert.equal(result.kind, 'advanced');
  assert.deepEqual(result.acknowledged.configuration, saved);
  assert.equal(result.acknowledged.etag, `"run-config:${saved.runId}:c0"`);
  assert.deepEqual(result.document.view.configuration, remote);
  assert.equal(result.document.etag, `"run-config:${saved.runId}:c1"`);
  assert.deepEqual(requests[0], requests[1], 'Replay has identical CSRF/preconditions/key/body');
  assert.equal(requests[2]?.path, `/api/v1/runs/${saved.runId}/configuration`, 'Host assigned id is authoritative');
  const reconciled = reconcileDraft({ local: result.acknowledged.configuration, remote: result.document.view.configuration, keepLocal: ['name'] });
  assert.equal(reconciled.revision, 1);
  assert.deepEqual(reconciled.name, saved.name);
});

test('transporte sintético: ack exacto y GET misma configuración aceptan promoción actual sin inventar otro guardado', async () => {
  const saved = empty();
  let call = 0;
  const transport: typeof fetch = async () => ++call === 1
    ? Response.json({ kind: 'run-configuration-draft-receipt', configuration: saved }, { headers: { ETag: `"run-config:${runId}:c0"` } })
    : Response.json({ kind: 'run-configuration-draft', configuration: saved, state: { lifecycle: 'ready', configurationRevision: 0, worldRevision: 0 }, validation: { kind: 'valid', promotion: 'promoted' } }, { headers: { ETag: `"run-config:${runId}:c0"` } });
  const result = await executeDraftSave({ intent: createDraftSaveIntent({ kind: 'create', configuration: saved, key: 'key' }), csrfToken: 'csrf', request: transport });
  assert.equal(result.kind, 'current');
  assert.equal(result.acknowledged.configuration.revision, 0);
  assert.equal(result.document.view.state.lifecycle, 'ready');
  assert.equal(call, 2);
});

test('una configuración derivada publicada explica su validación sin reclamar promoción de borrador ni aprobar ejecución',async()=>{
  const {RunDraftValidationResult}=await import('../src/web/RunDraftWorkspace.tsx');
  const {RunConfigurationDraftViewSchema}=await import('../src/domain/http.ts');
  const view=RunConfigurationDraftViewSchema.parse({kind:'run-configuration-draft',configuration:empty(),state:{lifecycle:'ready',configurationRevision:0,worldRevision:0,editability:'fork-published'},validation:{kind:'valid',promotion:'not-promoted'}});
  const html=renderToStaticMarkup(React.createElement(RunDraftValidationResult,{validation:view.validation,state:view.state}));
  assert.match(html,/Configuración válida/);assert.match(html,/Configuración derivada publicada/);assert.match(html,/sólo lectura/);assert.match(html,/requisitos de ejecución se comprueban por separado/);assert.doesNotMatch(html,/Preparación sin promover|Completá los puntos pendientes|validá la puesta guardada|<button|<input/);
  const promoted=renderToStaticMarkup(React.createElement(RunDraftValidationResult,{validation:{kind:'valid',promotion:'promoted'},state:{...view.state,editability:'editable'}}));assert.match(promoted,/Promoción durable confirmada/);assert.doesNotMatch(promoted,/derivada publicada/);
  const invalid=renderToStaticMarkup(React.createElement(RunDraftValidationResult,{validation:{kind:'invalid',promotion:'not-promoted',issues:[{code:'draft-field-empty',field:'fictionalAt',detail:'Fecha pendiente'}]},state:view.state}));assert.match(invalid,/Preparación sin promover/);assert.match(invalid,/Fecha pendiente/);assert.doesNotMatch(invalid,/derivada publicada/);
  const evolved=renderToStaticMarkup(React.createElement(RunDraftValidationResult,{validation:view.validation,state:{...view.state,editability:'identity-promoted'}}));assert.match(evolved,/Identidad consolidada/);assert.match(evolved,/preparación inicial permanece en el historial/);assert.match(evolved,/requisitos de ejecución se comprueban por separado/);assert.doesNotMatch(evolved,/Preparación sin promover|Completá los puntos pendientes|derivada publicada/);
});
