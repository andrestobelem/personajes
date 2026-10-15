import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { DossierSchema } from '../src/domain/catalog.ts';
import { CatalogCharacterSummarySchema } from '../src/domain/http.ts';
import { DossierSourceSchema } from '../src/domain/dossier-source.ts';
import { ContinuityContextSchema, ContinuityMilestoneIdSchema, GoalIdSchema, CapabilityIdSchema, AntecedentIdSchema, PreparedCharacterSchema } from '../src/domain/preparation.ts';
import { CharacterIdSchema } from '../src/domain/values.ts';
import { createEmptyRunConfigurationDraft } from '../src/domain/production.ts';
import { applyCuratedCharacter, characterCurationForm, curateCharacter, type CharacterCurationForm } from '../src/web/character-preparation.ts';
import { changeDraftField } from '../src/web/draft-form.ts';
import { CharacterPreparationEditor } from '../src/web/CharacterPreparationEditor.tsx';

const dossier = DossierSchema.parse({ schemaVersion: 1, characterId: 'maxwell-smart', displayName: 'Fixture', aliases: [], performers: ['PRIVATE-RESEARCH-PERFORMER'], markdown: '# INVESTIGATOR-SECRET-FUTURE', sections: [], sourceRefs: [{ id: 'fixture-source', kind: 'documentary', reference: 'Synthetic fixture', scope: 'Test only', uncertainty: 'No canon claim' }], unknowns: [], contradictions: [], adaptations: [], avatarRef: { kind: 'unbound' }, voiceRecipe: { kind: 'unreviewed' }, revision: 2, contentHash: 'a'.repeat(64), curationStatus: 'unreviewed', unknownSections: [] });
const continuity = ContinuityContextSchema.parse({ continuityId: 'fixture-cut', revision: 1, contentHash: 'b'.repeat(64), kind: 'adaptation', label: 'Synthetic only', milestones: [{ milestoneId: 'later-event', label: 'Future', status: 'notReached', sourceRefs: ['fixture-source'] }], inclusions: [] });
const source = DossierSourceSchema.parse({ kind: 'catalog-original', characterId: dossier.characterId, revision: dossier.revision, contentHash: dossier.contentHash, fullArchiveHash: 'c'.repeat(64), frozenDossier: dossier });
const owner = CharacterIdSchema.parse(dossier.characterId);
const form = (): CharacterCurationForm => ({ ...characterCurationForm(), selfReference: 'Fixture persona', selfConcept: 'Explicitly supplied identity', dispositions: 'Patient\nReserved', voice: 'Brief, deliberate speech', noInitialExperiences: true, provenanceKind: 'explicit-adaptation' as const, reason: 'Synthetic operator decision', goals: [{ goalId: GoalIdSchema.parse('fixture-goal'), kind: 'durable' as const, ownerCharacterId: owner, desiredOutcome: 'Find a safe route', priority: 0.5, reviewConditions: [], status: 'active' as const, evidenceRefs: [] }], capabilities: [{ capabilityId: CapabilityIdSchema.parse('fixture-speech'), kind: 'speech' as const, description: 'Can speak' }] });
const prepare = (value = form(), includeSource = false) => curateCharacter({ form: value, dossier, ...(includeSource ? { dossierSource: source } : {}), continuity, uuid: () => '11111111-1111-4111-8111-111111111111', recordedAt: '2026-10-14T00:00:00Z' });

function defineGlobal(name: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => { if (previous === undefined) Reflect.deleteProperty(globalThis, name); else Object.defineProperty(globalThis, name, previous); };
}

test('curation builds a valid complete context without researcher dossier or performer metadata', () => {
  const character = prepare(); assert.ok(PreparedCharacterSchema.safeParse(character).success);
  const serialized = JSON.stringify(character);
  assert.ok(!serialized.includes('INVESTIGATOR-SECRET-FUTURE')); assert.ok(!serialized.includes('PRIVATE-RESEARCH-PERFORMER'));
  assert.equal(character.antecedents.value.length, 0); assert.equal(character.initialExperience.value.kind, 'none');
  assert.equal(character.identity.provenance.kind, 'explicit-adaptation');
  const draft = changeDraftField({ draft: createEmptyRunConfigurationDraft({ runId: '22222222-2222-4222-8222-222222222222', revision: 0 }), field: 'continuity', value: continuity });
  const applied = applyCuratedCharacter({ draft, character }); assert.notEqual(applied.roster.kind, 'empty');
  if (applied.roster.kind === 'empty') throw new Error('Expected roster');
  assert.deepEqual(PreparedCharacterSchema.parse(JSON.parse(JSON.stringify(applied.roster.value.preparedCharacters[0]))), character);
});

test('source references and continuity admission are checked before publishing actor context', () => {
  assert.throws(() => prepare({ ...form(), sourceRefs: ['foreign-source'] }), /no pertenece/);
  assert.throws(() => prepare({ ...form(), provenanceKind: 'dossier-evidence', sourceRefs: [] }));
  assert.throws(() => prepare({ ...form(), noInitialExperiences: false }), /Declarar explícitamente/);
  assert.throws(() => prepare({ ...form(), antecedents: [{ antecedentId: AntecedentIdSchema.parse('future'), kind: 'milestone', statement: 'Future event occurred', applicability: { kind: 'milestone-state', milestoneId: ContinuityMilestoneIdSchema.parse('later-event'), requires: 'reached' } }] }), /no aplica/);
});

test('reopening retains goals, private relationships, capabilities and inventory without automatic provenance confirmation', () => {
  const character = prepare(); const reopened = characterCurationForm(character);
  assert.deepEqual(reopened.goals, character.goals.value); assert.deepEqual(reopened.capabilities, character.capabilities.value);
  assert.equal(reopened.provenanceKind, 'unselected'); assert.equal(reopened.selfConcept, character.identity.value.selfConcept);
  const next = curateCharacter({ form: { ...reopened, provenanceKind: 'curator-declaration', reason: 'Reviewed' }, dossier, continuity, existing: character, uuid: () => '11111111-1111-4111-8111-111111111111', recordedAt: '2026-10-14T00:00:00Z' });
  assert.equal(next.identityVersion, character.identityVersion + 1); assert.deepEqual(next.goals.value, character.goals.value);
});

test('initial editor offers deliberate selection and does not prefill invented personality', () => {
  const draft = createEmptyRunConfigurationDraft({ runId: '22222222-2222-4222-8222-222222222222', revision: 0 });
  const html = renderToStaticMarkup(React.createElement(CharacterPreparationEditor, { draft, catalog: [], onChange: () => {}, onPendingChange: () => {} }));
  assert.match(html, /Preparar a cada actor/); assert.match(html, /Elegí un personaje/); assert.ok(!html.includes('INVESTIGATOR-SECRET-FUTURE'));
  assert.equal(characterCurationForm().selfConcept, ''); assert.equal(characterCurationForm().noInitialExperiences, false);
});

test('changing expression mode updates voice description limits without applying the draft', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const restores = [defineGlobal('window', dom.window), defineGlobal('document', dom.window.document), defineGlobal('navigator', dom.window.navigator), defineGlobal('HTMLElement', dom.window.HTMLElement), defineGlobal('Node', dom.window.Node), defineGlobal('MutationObserver', dom.window.MutationObserver), defineGlobal('IS_REACT_ACT_ENVIRONMENT', true)];
  let unmount: (() => void) | undefined;
  try {
    const base = createEmptyRunConfigurationDraft({ runId: '22222222-2222-4222-8222-222222222222', revision: 0 });
    const configured = changeDraftField({ draft: base, field: 'continuity', value: continuity });
    const draft = applyCuratedCharacter({ draft: configured, character: prepare(form(), true) });
    const changes: unknown[] = [];
    const { createRoot } = await import('react-dom/client');
    const container = dom.window.document.getElementById('root'); assert.ok(container);
    const root = createRoot(container); unmount = () => root.unmount();
    const catalogCharacter = CatalogCharacterSummarySchema.parse({ characterId: owner, displayName: 'Fixture', revision: 0, hash: dossier.contentHash, curationStatus: 'unreviewed', avatarRef: { kind: 'catalog-reference', slug: 'maxwell-smart' } });
    await act(async () => root.render(React.createElement(CharacterPreparationEditor, { draft, catalog: [catalogCharacter], onChange: (next) => changes.push(next), onPendingChange: () => {} })));

    async function selectOption(select: HTMLSelectElement, value: string) {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')?.set; assert.ok(setter);
      await act(async () => { setter.call(select, value); select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    }
    async function enterText(textarea: HTMLTextAreaElement, value: string) {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')?.set; assert.ok(setter);
      await act(async () => { setter.call(textarea, value); textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    }
    const selects = () => [...container.querySelectorAll('select')];
    const characterSelect = selects().find((select) => [...select.options].some((option) => option.value === owner)); assert.ok(characterSelect);
    await selectOption(characterSelect, owner);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const expressionSelect = selects().find((select) => [...select.options].some((option) => option.value === 'nonverbal')); assert.ok(expressionSelect);
    const voiceField = () => [...container.querySelectorAll('label')].find((label) => label.textContent?.includes('Receta de voz hablada') || label.textContent?.includes('Descripción de la expresión no verbal'))?.querySelector('textarea');

    assert.equal(voiceField()?.maxLength, 20_000);
    assert.match(container.textContent ?? '', /receta de voz hablada admite hasta 20\.000 caracteres/);
    const spokenTextarea = voiceField(); assert.ok(spokenTextarea);
    await enterText(spokenTextarea, 'x'.repeat(4_001));
    assert.equal(voiceField()?.value.length, 4_001);
    await selectOption(expressionSelect, 'nonverbal');
    assert.equal(voiceField()?.maxLength, 4_000);
    assert.equal(voiceField()?.value.length, 4_001, 'switching modes preserves existing text even when it exceeds the new limit');
    assert.match(container.textContent ?? '', /expresión no verbal admite hasta 4\.000 caracteres/);
    assert.match(container.textContent ?? '', /conserva 4001 caracteres y supera el límite de 4000/);
    const applyButton = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Aplicar contexto preparado'); assert.ok(applyButton);
    assert.equal(applyButton.disabled, true);
    assert.equal(changes.length, 0, 'an over-limit voice description cannot be applied');
    await selectOption(expressionSelect, 'spoken');
    assert.equal(voiceField()?.maxLength, 20_000);
    assert.equal(voiceField()?.value.length, 4_001);
    assert.equal(applyButton.disabled, false);
    assert.doesNotMatch(container.textContent ?? '', /conserva 4001 caracteres y supera el límite/);
    assert.equal(changes.length, 0, 'changing the local curation form must not apply or rewrite actor history');
    assert.equal(draft.roster.kind === 'configured' ? draft.roster.value.preparedCharacters[0]?.voice.value.kind : undefined, 'spoken');
  } finally {
    if (unmount !== undefined) await act(async () => unmount?.());
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});

test('previous memory cut preserves subjective envelopes and original provenance during identity revision', () => {
  const base = prepare();
  const origin = '33333333-3333-4333-8333-333333333333';
  const memoryId = '44444444-4444-4444-8444-444444444444';
  const provenance = { kind: 'experience-cut', dossierRevision: base.dossierRevision, dossierHash: base.dossierHash, continuity: { continuityId: continuity.continuityId, revision: continuity.revision, contentHash: continuity.contentHash }, runId: origin, throughWorldSeq: 1, throughFictionalAt: 1000, admittedBy: 'fixture', admittedAt: '2026-10-14T00:00:00Z', experienceIds: [memoryId] };
  const existing = PreparedCharacterSchema.parse({ ...base, initialExperience: { provenance, value: { kind: 'run-cut', runId: origin, throughWorldSeq: 1, throughFictionalAt: 1000, continuity: provenance.continuity, experiences: [{ schemaVersion: 1, kind: 'belief', experienceId: memoryId, runId: origin, actorId: owner, content: 'A subjective belief, not a world fact', sourceRefs: [], fictitiousAt: 900, receivedAt: 1000, worldSeq: 1, confidence: 0.4, revision: 0, predecessor: { kind: 'initial' }, basedOn: [] }] } } });
  const reopened = characterCurationForm(existing);
  assert.equal(reopened.noInitialExperiences, false);
  const next = curateCharacter({ form: { ...reopened, provenanceKind: 'curator-declaration', reason: 'Identity revision only' }, dossier, continuity, existing, uuid: () => '11111111-1111-4111-8111-111111111111', recordedAt: '2026-10-14T00:00:00Z' });
  assert.deepEqual(next.initialExperience, existing.initialExperience);
});
