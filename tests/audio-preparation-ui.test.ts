import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEmptyRunConfigurationDraft, ProductionAudioSchema, type RunConfigurationDraft } from '../src/domain/production.ts';
import { DossierSchema } from '../src/domain/catalog.ts';
import { ContinuityContextSchema, CapabilityIdSchema, GoalIdSchema } from '../src/domain/preparation.ts';
import { CharacterIdSchema } from '../src/domain/values.ts';
import { characterCurationForm, curateCharacter } from '../src/web/character-preparation.ts';
import { AudioPreparationEditor } from '../src/web/AudioPreparationEditor.tsx';
import { applyAudioPreparation, audioPreparationForm, audioRoster } from '../src/web/audio-preparation-form.ts';
import { changeDraftField } from '../src/web/draft-form.ts';

const runId = '11111111-1111-4111-8111-111111111111';
const bindingId = '22222222-2222-4222-8222-222222222222';
const empty = () => createEmptyRunConfigurationDraft({ runId, revision: 0 });
function prepared(nonverbal: boolean) {
  const characterId = CharacterIdSchema.parse(nonverbal ? 'fixture-dog' : 'fixture-person');
  const dossier = DossierSchema.parse({ schemaVersion: 1, characterId, displayName: 'Fixture', aliases: [], performers: [], markdown: '# Synthetic', sections: [], sourceRefs: [], unknowns: [], contradictions: [], adaptations: [], avatarRef: { kind: 'unbound' }, voiceRecipe: { kind: 'unreviewed' }, revision: 1, contentHash: 'a'.repeat(64), curationStatus: 'unreviewed', unknownSections: [] });
  const continuity = ContinuityContextSchema.parse({ continuityId: 'fixture', revision: 1, contentHash: 'b'.repeat(64), kind: 'adaptation', label: 'Synthetic', milestones: [], inclusions: [] });
  return curateCharacter({ dossier, continuity, uuid: () => runId, recordedAt: '2026-10-15T00:00:00Z', form: { ...characterCurationForm(), selfReference: 'Fixture identity', selfConcept: 'Synthetic actor', dispositions: 'Calm', voice: 'Synthetic voice', voiceKind: nonverbal ? 'nonverbal' : 'spoken', noInitialExperiences: true, provenanceKind: 'explicit-adaptation', reason: 'Synthetic test', goals: [{ goalId: GoalIdSchema.parse('goal'), kind: 'durable', ownerCharacterId: characterId, desiredOutcome: 'Remain here', priority: 0.5, reviewConditions: [], status: 'active', evidenceRefs: [] }], capabilities: [{ capabilityId: CapabilityIdSchema.parse('sound'), kind: nonverbal ? 'nonverbal-sound' : 'speech', description: 'Synthetic sound' }] } });
}
function rosterDraft() {
  const actors = [prepared(false), prepared(true)];
  return changeDraftField({ draft: empty(), field: 'roster', value: { eligibleCharacterIds: actors.map(item => item.characterId), preparedCharacters: actors, activeCharacterIds: actors.map(item => item.characterId) } });
}
function html(draft: RunConfigurationDraft) {
  return renderToStaticMarkup(React.createElement(AudioPreparationEditor, { draft, catalog: [], onChange: () => assert.fail('rendering must not mutate draft'), onPendingChange: () => assert.fail('rendering must not mark choices') }));
}
function audioValue(draft: RunConfigurationDraft) { if (draft.audio.kind === 'empty') throw new Error('Expected audio'); return draft.audio.value; }

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
