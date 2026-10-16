import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { act } from 'react';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEmptyRunConfigurationDraft, ProductionAudioSchema, type RunConfigurationDraft } from '../src/domain/production.ts';
import { DossierSchema } from '../src/domain/catalog.ts';
import { ContinuityContextSchema, CapabilityIdSchema, GoalIdSchema } from '../src/domain/preparation.ts';
import { DesireIdSchema } from '../src/domain/character-biography.ts';
import { CharacterIdSchema } from '../src/domain/values.ts';
import { characterCurationForm, curateCharacter } from '../src/web/character-preparation.ts';
import { AudioPreparationEditor } from '../src/web/AudioPreparationEditor.tsx';
import { applyAudioPreparation, audioPreparationForm, audioRoster, spanishAudioPreset } from '../src/web/audio-preparation-form.ts';
import { changeDraftField } from '../src/web/draft-form.ts';
import { VoiceHttpRejection, type VoiceClient } from '../src/web/voice-client.ts';

const runId = '11111111-1111-4111-8111-111111111111';
const bindingId = '22222222-2222-4222-8222-222222222222';
const empty = () => createEmptyRunConfigurationDraft({ runId, revision: 0 });
function prepared(nonverbal: boolean) {
  const characterId = CharacterIdSchema.parse(nonverbal ? 'fixture-dog' : 'fixture-person');
  const goalId = GoalIdSchema.parse('goal');
  const dossier = DossierSchema.parse({ schemaVersion: 1, characterId, displayName: 'Fixture', aliases: [], performers: [], markdown: '# Synthetic', sections: [], sourceRefs: [], unknowns: [], contradictions: [], adaptations: [], avatarRef: { kind: 'unbound' }, voiceRecipe: { kind: 'unreviewed' }, revision: 1, contentHash: 'a'.repeat(64), curationStatus: 'unreviewed', unknownSections: [] });
  const continuity = ContinuityContextSchema.parse({ continuityId: 'fixture', revision: 1, contentHash: 'b'.repeat(64), kind: 'adaptation', label: 'Synthetic', milestones: [], inclusions: [] });
  return curateCharacter({ dossier, continuity, uuid: () => runId, recordedAt: '2026-10-15T00:00:00Z', form: { ...characterCurationForm(), selfReference: 'Fixture identity', selfConcept: 'Synthetic actor', dispositions: 'Calm', lifeNarrative: 'Explicit synthetic life story for the audio fixture; it makes no claims beyond this test.', desires: [{ desireId: DesireIdSchema.parse('synthetic-desire'), description: 'Remain in the test situation.', stakes: 'Keep the ability to choose.', tension: 'The character has not yet understood the whole situation.', goalIds: [goalId] }], voice: 'Synthetic voice', voiceKind: nonverbal ? 'nonverbal' : 'spoken', noInitialExperiences: true, provenanceKind: 'explicit-adaptation', reason: 'Synthetic test', goals: [{ goalId, kind: 'durable', ownerCharacterId: characterId, desiredOutcome: 'Remain here', priority: 0.5, reviewConditions: [], status: 'active', evidenceRefs: [] }], capabilities: [{ capabilityId: CapabilityIdSchema.parse('sound'), kind: nonverbal ? 'nonverbal-sound' : 'speech', description: 'Synthetic sound' }] } });
}
function rosterDraft() {
  const actors = [prepared(false), prepared(true)];
  return changeDraftField({ draft: empty(), field: 'roster', value: { eligibleCharacterIds: actors.map(item => item.characterId), preparedCharacters: actors, activeCharacterIds: actors.map(item => item.characterId) } });
}
function html(draft: RunConfigurationDraft) {
  return renderToStaticMarkup(React.createElement(AudioPreparationEditor, { draft, catalog: [], onChange: () => assert.fail('rendering must not mutate draft'), onPendingChange: () => assert.fail('rendering must not mark choices') }));
}
function audioValue(draft: RunConfigurationDraft) { if (draft.audio.kind === 'empty') throw new Error('Expected audio'); return draft.audio.value; }
async function mounted(run: (container: HTMLElement, root: ReturnType<typeof createRoot>) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const restore = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(name => ({ name, descriptor: Object.getOwnPropertyDescriptor(globalThis, name) }));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const container = dom.window.document.getElementById('root'); assert.ok(container); const root = createRoot(container);
  try { await run(container, root); } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const { name, descriptor } of restore) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
  }
}
function button(container: HTMLElement, text: string) { const found = [...container.querySelectorAll('button')].find(item => item.textContent === text); assert.ok(found, text); return found; }

test('empty audio remains pending and disabled preparation makes no implicit synthesis choices', () => {
  const draft = changeDraftField({ draft: empty(), field: 'audio', value: undefined });
  const form = audioPreparationForm(draft);
  assert.equal(form.mode, ''); assert.equal(form.ttsMode, ''); assert.equal(form.ttsModelId, ''); assert.equal(form.outputFormat, ''); assert.equal(form.subtitles, ''); assert.equal(form.narrator, '');
  html(draft); assert.equal(draft.audio.kind, 'empty');
  assert.throws(() => applyAudioPreparation({ draft, form }), /Elegí explícitamente/);
  assert.deepEqual(audioValue(applyAudioPreparation({ draft, form: { ...form, mode: 'disabled', narrator: 'absent' } })), { mode: { kind: 'disabled' }, speakerSlots: [], soundEffectSlots: [], narratorSlot: { kind: 'absent' } });
});

test('nonverbal actor receives effects only and speech actors require an explicit audio slot', () => {
  const draft = rosterDraft();
  assert.deepEqual(audioRoster(draft).map(item => [item.characterId, item.canSpeak]), [['fixture-person', true], ['fixture-dog', false]]);
  const markup = html(draft);
  assert.match(markup, /Voz de fixture-person/); assert.ok(!markup.includes('Voz de fixture-dog')); assert.match(markup, /Efecto de fixture-dog/); assert.ok(!markup.includes('Efecto de fixture-person'));
  assert.deepEqual(audioRoster(draft).map(item => item.canUseEffects), [false, true]);
  const form = { ...audioPreparationForm(draft), mode: 'enabled', ttsMode: 'manual-per-publication', ttsModelId: 'operator-supplied-model', outputFormat: 'pcm_24000', subtitles: 'false' };
  assert.throws(() => applyAudioPreparation({ draft, form }), /slot explícito/);
  const next = applyAudioPreparation({ draft, form: { ...form, speakers: [{ characterId: CharacterIdSchema.parse('fixture-person'), choice: 'disabled' }], effects: [{ characterId: CharacterIdSchema.parse('fixture-dog'), choice: 'enabled-unbound' }] } });
  assert.equal(audioValue(next).speakerSlots.length, 1); assert.equal(audioValue(next).soundEffectSlots[0]?.slot.kind, 'enabled-unbound');
  assert.equal(next.spanishVariety.kind, 'empty', 'editor must not auto-confirm dialect');
  assert.throws(() => applyAudioPreparation({ draft, form: { ...form, effects: [{ characterId: CharacterIdSchema.parse('fixture-person'), choice: 'enabled-unbound' }] } }), /no verbal preparada/);
  assert.throws(() => applyAudioPreparation({ draft, form: { ...form, speakers: [{ characterId: CharacterIdSchema.parse('fixture-dog'), choice: 'enabled-unbound' }] } }), /habla preparada/);
});

test('editing synthesis options preserves imported opaque bindings and out-of-roster entries until explicitly removed', () => {
  const initial = ProductionAudioSchema.parse({ mode: { kind: 'enabled', language: 'es', ttsMode: 'manual-per-publication', ttsModelId: 'previous-model', outputFormat: 'pcm_16000', subtitles: true }, speakerSlots: [{ characterId: 'past-actor', slot: { kind: 'enabled-bound', speechBindingId: bindingId } }], narratorSlot: { kind: 'enabled-bound', speechBindingId: bindingId }, soundEffectSlots: [{ characterId: 'past-dog', slot: { kind: 'enabled-bound', soundBindingId: bindingId } }] });
  const draft = changeDraftField({ draft: empty(), field: 'audio', value: initial });
  const markup = html(draft); assert.match(markup, /Entrada anterior/); assert.ok(!markup.includes(bindingId), 'opaque binding UUID is not an editable field');
  const form = { ...audioPreparationForm(draft), ttsModelId: 'changed-model' };
  const changed = audioValue(applyAudioPreparation({ draft, form }));
  assert.deepEqual(changed.speakerSlots, initial.speakerSlots); assert.deepEqual(changed.soundEffectSlots, initial.soundEffectSlots); assert.deepEqual(changed.narratorSlot, initial.narratorSlot);
  const removed = audioValue(applyAudioPreparation({ draft, form: { ...form, speakers: form.speakers.map(row => ({ ...row, choice: 'remove' })), narrator: 'absent' } }));
  assert.equal(removed.speakerSlots.length, 0); assert.deepEqual(removed.soundEffectSlots, initial.soundEffectSlots); assert.equal(removed.narratorSlot.kind, 'absent');
});

test('invalid synthesis fields and narrator activation without narration cannot be applied', () => {
  const draft = empty(); const form = { ...audioPreparationForm(draft), mode: 'enabled', ttsMode: 'manual-per-publication', ttsModelId: 'model', outputFormat: 'pcm_16000', subtitles: 'true' };
  for (const incomplete of [{ ...form, ttsMode: '' }, { ...form, ttsModelId: '   ' }, { ...form, outputFormat: 'invented' }, { ...form, subtitles: '' }]) assert.throws(() => applyAudioPreparation({ draft, form: incomplete }));
  assert.throws(() => applyAudioPreparation({ draft, form: { ...form, narrator: 'enabled-unbound' } }), /narración textual/);
  const enabled = changeDraftField({ draft, field: 'narrationMode', value: { kind: 'enabled' } });
  assert.equal(audioValue(applyAudioPreparation({ draft: enabled, form: { ...form, narrator: 'enabled-unbound' } })).narratorSlot.kind, 'enabled-unbound');
});


test('unprepared active identity receives neither new voice nor new effects', () => {
  const id = CharacterIdSchema.parse('not-prepared');
  const draft = changeDraftField({ draft: empty(), field: 'roster', value: { eligibleCharacterIds: [id], activeCharacterIds: [id], preparedCharacters: [] } });
  const markup = html(draft); assert.ok(!markup.includes('Efecto de not-prepared')); assert.ok(!markup.includes('Voz de not-prepared'));
  const form = audioPreparationForm(draft);
  assert.throws(() => applyAudioPreparation({ draft, form: { ...form, effects: [{ characterId: id, choice: 'enabled-unbound' }] } }), /no verbal preparada/);
  assert.throws(() => applyAudioPreparation({ draft, form: { ...form, speakers: [{ characterId: id, choice: 'enabled-unbound' }] } }), /habla preparada/);
});

test('preset local de audio cambia sólo valores editoriales y conserva modelo y slots históricos', () => {
  const audio = ProductionAudioSchema.parse({ mode: { kind: 'enabled', language: 'es', ttsMode: 'automatic-after-publication', ttsModelId: 'historic-model', outputFormat: 'pcm_16000', subtitles: false }, speakerSlots: [{ characterId: 'past-actor', slot: { kind: 'enabled-bound', speechBindingId: bindingId } }], narratorSlot: { kind: 'enabled-bound', speechBindingId: bindingId }, soundEffectSlots: [{ characterId: 'past-dog', slot: { kind: 'enabled-bound', soundBindingId: bindingId } }] });
  const draft = changeDraftField({ draft: empty(), field: 'audio', value: audio });
  const current = audioPreparationForm(draft); const preset = spanishAudioPreset(current);
  assert.equal(preset.mode, 'enabled'); assert.equal(preset.ttsMode, 'manual-per-publication'); assert.equal(preset.outputFormat, 'mp3_44100_128'); assert.equal(preset.subtitles, 'true');
  assert.equal(preset.ttsModelId, 'historic-model'); assert.deepEqual(preset.speakers, current.speakers); assert.deepEqual(preset.effects, current.effects); assert.equal(preset.narrator, current.narrator);
});

test('el editor consulta modelos sólo por acción explícita, filtra español y preserva la configuración histórica', async () => mounted(async (container, root) => {
  const initial = ProductionAudioSchema.parse({ mode: { kind: 'enabled', language: 'es', ttsMode: 'automatic-after-publication', ttsModelId: 'historic-model', outputFormat: 'pcm_16000', subtitles: false }, speakerSlots: [{ characterId: 'past-actor', slot: { kind: 'enabled-bound', speechBindingId: bindingId } }], narratorSlot: { kind: 'enabled-bound', speechBindingId: bindingId }, soundEffectSlots: [{ characterId: 'past-dog', slot: { kind: 'enabled-bound', soundBindingId: bindingId } }] });
  const draft = changeDraftField({ draft: empty(), field: 'audio', value: initial }); const reads: string[] = []; const updates: RunConfigurationDraft[] = []; const pending: boolean[] = [];
  const voiceClient: Pick<VoiceClient, 'models'> = { models: async (purpose, signal) => { reads.push(purpose); assert.equal(signal.aborted, false); return [
    { kind: 'speech', modelId: 'spanish-tts', name: 'Spanish TTS', canDoTextToSpeech: true, languages: ['es'] },
    { kind: 'speech', modelId: 'english-tts', name: 'English TTS', canDoTextToSpeech: true, languages: ['en'] },
    { kind: 'speech', modelId: 'spanish-no-tts', name: 'Spanish non-TTS', canDoTextToSpeech: false, languages: ['es'] },
  ]; } };
  await act(async () => root.render(React.createElement(AudioPreparationEditor, { draft, catalog: [], voiceClient, onChange: value => updates.push(value), onPendingChange: value => pending.push(value) })));
  assert.deepEqual(reads, []); assert.equal(updates.length, 0); assert.equal(pending.length, 0);
  let modelSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Modelo TTS compatible con español"]'); assert.ok(modelSelect); assert.equal(modelSelect.value, 'historic-model');
  assert.match(modelSelect.textContent ?? '', /todavía no consultada/);
  await act(async () => button(container, 'Usar preset local: español con subtítulos · manual por publicación').click());
  assert.deepEqual(reads, []); assert.equal(modelSelect.value, 'historic-model');
  await act(async () => button(container, 'Consultar modelos TTS para español').click());
  assert.deepEqual(reads, ['speech']); assert.equal(updates.length, 0);
  modelSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Modelo TTS compatible con español"]'); assert.ok(modelSelect);
  assert.match(modelSelect.textContent ?? '', /historic-model · configuración conservada; ausente del catálogo consultado/);
  assert.match(modelSelect.textContent ?? '', /Spanish TTS · spanish-tts/); assert.doesNotMatch(modelSelect.textContent ?? '', /english-tts|spanish-no-tts/);
  await act(async () => { modelSelect.value = 'spanish-tts'; modelSelect.dispatchEvent(new window.Event('change', { bubbles: true })); });
  assert.equal(updates.length, 0); assert.equal(pending.at(-1), true);
  await act(async () => button(container, 'Aplicar audio').click());
  assert.equal(updates.length, 1); const applied = audioValue(updates[0] ?? draft);
  assert.deepEqual(applied.speakerSlots, initial.speakerSlots); assert.deepEqual(applied.soundEffectSlots, initial.soundEffectSlots); assert.deepEqual(applied.narratorSlot, initial.narratorSlot);
  assert.deepEqual(applied.mode, { kind: 'enabled', language: 'es', ttsMode: 'manual-per-publication', ttsModelId: 'spanish-tts', outputFormat: 'mp3_44100_128', subtitles: true });
}));

test('si falta la credencial, el editor explica cómo recuperarse y mantiene el modelo histórico', async () => mounted(async (container, root) => {
  const draft = changeDraftField({ draft: empty(), field: 'audio', value: ProductionAudioSchema.parse({ mode: { kind: 'enabled', language: 'es', ttsMode: 'manual-per-publication', ttsModelId: 'historic-model', outputFormat: 'mp3_44100_128', subtitles: true }, speakerSlots: [], soundEffectSlots: [], narratorSlot: { kind: 'absent' } }) });
  let reads = 0; let changes = 0;
  const voiceClient: Pick<VoiceClient, 'models'> = { models: async () => { reads++; throw new VoiceHttpRejection(409, '00000000-0000-4000-8000-000000000000', 'Error del proveedor.', 'ELEVENLABS_CREDENTIAL_MISSING'); } };
  await act(async () => root.render(React.createElement(AudioPreparationEditor, { draft, catalog: [], voiceClient, onChange: () => changes++, onPendingChange: () => {} })));
  assert.equal(reads, 0); await act(async () => button(container, 'Consultar modelos TTS para español').click());
  assert.equal(reads, 1); assert.match(container.textContent ?? '', /No hay una credencial de ElevenLabs configurada/); assert.match(container.textContent ?? '', /no la solicita ni la guarda/);
  assert.equal(changes, 0); const select = container.querySelector<HTMLSelectElement>('select[aria-label="Modelo TTS compatible con español"]'); assert.ok(select); assert.equal(select.value, 'historic-model');
}));
