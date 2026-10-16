import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { CharacterDesireSchema } from '../src/domain/character-biography.ts';
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
const form = (): CharacterCurationForm => ({ ...characterCurationForm(), selfReference: 'Fixture persona', lifeNarrative: '# Synthetic life history\n\nA deliberately supplied upbringing and turning point for this test character.', desires: [{ desireId: CharacterDesireSchema.shape.desireId.parse('fixture-desire'), description: 'Protect a trusted companion', stakes: 'A chosen relationship could be lost', tension: 'Duty conflicts with personal trust', goalIds: [GoalIdSchema.parse('fixture-goal')] }], selfConcept: 'Explicitly supplied identity', dispositions: 'Patient\nReserved', voice: 'Brief, deliberate speech', noInitialExperiences: true, provenanceKind: 'explicit-adaptation' as const, reason: 'Synthetic operator decision', goals: [{ goalId: GoalIdSchema.parse('fixture-goal'), kind: 'durable' as const, ownerCharacterId: owner, desiredOutcome: 'Find a safe route', priority: 0.5, reviewConditions: [], status: 'active' as const, evidenceRefs: [] }], capabilities: [{ capabilityId: CapabilityIdSchema.parse('fixture-speech'), kind: 'speech' as const, description: 'Can speak' }] });
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
    const capabilityKind = selects().find((select) => [...select.options].some((option) => option.value === 'world-action')); assert.ok(capabilityKind);
    await selectOption(capabilityKind, 'world-action');
    const actionSelect = selects().find((select) => [...select.options].some((option) => option.value === 'observe') && [...select.options].some((option) => option.value === 'take')); assert.ok(actionSelect);
    assert.equal(actionSelect.value, '', 'a world action has no implicit default');
    assert.equal(applyButton.disabled, true);
    assert.match(container.textContent ?? '', /la descripción por sí sola no concede capacidades/i);
    await selectOption(actionSelect, 'observe');
    assert.equal(actionSelect.value, 'observe');
    assert.equal(applyButton.disabled, false);
    assert.equal(changes.length, 0, 'changing the local curation form must not apply or rewrite actor history');
    assert.equal(draft.roster.kind === 'configured' ? draft.roster.value.preparedCharacters[0]?.voice.value.kind : undefined, 'spoken');
  } finally {
    if (unmount !== undefined) await act(async () => unmount?.());
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});

test('prepared world actions are typed grants and prose in other capabilities grants nothing', () => {
  assert.throws(() => prepare({ ...form(), capabilities: [
    { capabilityId: CapabilityIdSchema.parse('fixture-pending-action'), kind: 'world-action', action: '', description: 'Dice take, pero no es autoridad.' },
  ] }), /Elegí una acción del Escenario/);
  const character = prepare({ ...form(), capabilities: [
    { capabilityId: CapabilityIdSchema.parse('fixture-observe'), kind: 'world-action', action: 'observe', description: 'Puede tomar algo; la acción elegida es observar.' },
    { capabilityId: CapabilityIdSchema.parse('fixture-other'), kind: 'other', description: 'take wait offer rest observe' },
  ] });
  assert.deepEqual(character.capabilities.value.map((capability) => capability.kind === 'world-action' ? capability.action : capability.kind), ['observe', 'other']);
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

test('legacy biography remains visibly empty and oversized UTF8 biography is rejected without truncation', () => {
  const complete = prepare();
  const { lifeHistory: _history, desires: _desires, ...legacyIdentity } = complete.identity.value;
  const legacy = PreparedCharacterSchema.parse({ ...complete, identity: { ...complete.identity, value: legacyIdentity } });
  const reopened = characterCurationForm(legacy);
  assert.equal(reopened.lifeNarrative, ''); assert.deepEqual(reopened.desires, []);
  assert.throws(() => curateCharacter({ form: { ...reopened, provenanceKind: 'curator-declaration', reason: 'Explicit legacy revision' }, dossier, continuity, existing: legacy, uuid: () => '11111111-1111-4111-8111-111111111111', recordedAt: '2026-10-14T00:00:00Z' }), /historia de vida/);
  const narrative = 'á'.repeat(65_537); assert.throws(() => prepare({ ...form(), lifeNarrative: narrative }), /historia de vida/); assert.equal(narrative.length, 65_537);
});

test('mounted biography and desire save/reopen preserve long Markdown and explicit antecedent and goal links', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const restores = [defineGlobal('window', dom.window), defineGlobal('document', dom.window.document), defineGlobal('navigator', dom.window.navigator), defineGlobal('HTMLElement', dom.window.HTMLElement), defineGlobal('Node', dom.window.Node), defineGlobal('IS_REACT_ACT_ENVIRONMENT', true)];
  let unmount: (() => void) | undefined;
  try {
    const antecedentId = AntecedentIdSchema.parse('synthetic-childhood');
    const curated = prepare({ ...form(), antecedents: [{ antecedentId, kind: 'biography', statement: 'Explicit synthetic childhood memory', applicability: { kind: 'unconditional' } }] }, true);
    const base = createEmptyRunConfigurationDraft({ runId: '22222222-2222-4222-8222-222222222222', revision: 0 }); const configured = changeDraftField({ draft: base, field: 'continuity', value: continuity });
    let draft = applyCuratedCharacter({ draft: configured, character: curated });
    const catalogCharacter = CatalogCharacterSummarySchema.parse({ characterId: owner, displayName: 'Fixture', revision: 0, hash: dossier.contentHash, curationStatus: 'unreviewed', avatarRef: { kind: 'catalog-reference', slug: 'maxwell-smart' } });
    const { createRoot } = await import('react-dom/client'); const element = dom.window.document.getElementById('root'); assert.ok(element); const container = element; const root = createRoot(container); unmount = () => root.unmount();
    async function mount(key: string) { await act(async () => root.render(React.createElement(CharacterPreparationEditor, { key, draft, catalog: [catalogCharacter], onChange: next => { draft = next; }, onPendingChange: () => {} }))); const select = [...container.querySelectorAll('select')].find(value => [...value.options].some(option => option.value === owner)); assert.ok(select); await choose(select, owner); }
    async function choose(select: HTMLSelectElement, value: string) { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')?.set; assert.ok(setter); await act(async () => { setter.call(select, value); select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); }
    function field(label: string) { const textarea = [...container.querySelectorAll('label')].find(value => value.textContent?.startsWith(label))?.querySelector('textarea'); assert.ok(textarea, label); return textarea; }
    async function write(label: string, value: string) { const textarea = field(label); const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')?.set; assert.ok(setter); await act(async () => { setter.call(textarea, value); textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); }
    await mount('initial'); const narrative = '# Infancia y formación sintéticas\n\n' + 'Historia explícita, propia y sostenida por el contexto. '.repeat(600) + '\n\n## Situación actual\nQuiere volver a confiar.';
    await write('Biografía del personaje · Markdown', narrative); await write('Qué está en juego para él', 'Una confianza que eligió conservar a pesar de la misión.');
    const antecedentLink = [...container.querySelectorAll('fieldset label')].find(value => value.textContent === 'Explicit synthetic childhood memory')?.querySelector('input'); assert.ok(antecedentLink); await act(async () => antecedentLink.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    const provenance = [...container.querySelectorAll('select')].find(value => [...value.options].some(option => option.value === 'curator-declaration')); assert.ok(provenance); await choose(provenance, 'curator-declaration'); await write('Motivo y límites de lo declarado', 'Synthetic explicit actor biography curation.');
    const apply = [...container.querySelectorAll('button')].find(value => value.textContent === 'Aplicar contexto preparado'); assert.ok(apply); assert.equal(apply.disabled, false); await act(async () => apply.click());
    if (draft.roster.kind === 'empty') throw new Error('Expected curated roster'); const saved = draft.roster.value.preparedCharacters[0]; assert.ok(saved); assert.equal(saved.identity.value.lifeHistory?.narrative, narrative); assert.deepEqual(saved.identity.value.lifeHistory?.antecedentIds, [antecedentId]); assert.deepEqual(saved.identity.value.desires?.[0]?.goalIds, [GoalIdSchema.parse('fixture-goal')]);
    draft = JSON.parse(JSON.stringify(draft)); await mount('reopened'); assert.equal(field('Biografía del personaje · Markdown').value, narrative); assert.equal(field('Qué está en juego para él').value, 'Una confianza que eligió conservar a pesar de la misión.'); const reopened = [...container.querySelectorAll('fieldset label')].find(value => value.textContent === 'Explicit synthetic childhood memory')?.querySelector('input'); assert.equal(reopened?.checked, true);
  } finally { if (unmount !== undefined) await act(async () => unmount?.()); dom.window.close(); for (const restore of restores.reverse()) restore(); }
});

test('legacy opt-in is explicit and preserves run draft identity, revision and existing actor context', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const restores = [defineGlobal('window', dom.window), defineGlobal('document', dom.window.document), defineGlobal('navigator', dom.window.navigator), defineGlobal('HTMLElement', dom.window.HTMLElement), defineGlobal('Node', dom.window.Node), defineGlobal('IS_REACT_ACT_ENVIRONMENT', true)];
  let unmount: (() => void) | undefined;
  try {
    const initial = createEmptyRunConfigurationDraft({ runId: '22222222-2222-4222-8222-222222222222', revision: 7 });
    const configured = changeDraftField({ draft: initial, field: 'continuity', value: continuity });
    const legacy = applyCuratedCharacter({ draft: configured, character: prepare(form(), true) }); assert.equal(legacy.characterDefinitionPolicy, undefined);
    const changes: typeof legacy[] = []; const { createRoot } = await import('react-dom/client'); const container = dom.window.document.getElementById('root'); assert.ok(container); const root = createRoot(container); unmount = () => root.unmount();
    await act(async () => root.render(React.createElement(CharacterPreparationEditor, { draft: legacy, catalog: [], onChange: next => changes.push(next), onPendingChange: () => {} }))); assert.equal(changes.length, 0);
    const optIn = [...container.querySelectorAll('button')].find(button => button.textContent === 'Exigir biografía y deseos completos'); assert.ok(optIn); await act(async () => optIn.click()); assert.equal(changes.length, 1); const changed = changes[0]; assert.ok(changed); assert.deepEqual(changed.characterDefinitionPolicy, { kind: 'embodied-v1' }); const { characterDefinitionPolicy: _policy, ...withoutPolicy } = changed; assert.deepEqual(withoutPolicy, legacy); assert.equal(changed.revision, 7); assert.equal(changed.runId, legacy.runId);
    await act(async () => root.render(React.createElement(CharacterPreparationEditor, { draft: changed, catalog: [], onChange: next => changes.push(next), onPendingChange: () => {} }))); assert.equal([...container.querySelectorAll('button')].some(button => button.textContent === 'Exigir biografía y deseos completos'), false); assert.match(container.textContent ?? '', /exige biografía y deseos completos/); assert.equal(changes.length, 1);
  } finally { if (unmount !== undefined) await act(async () => unmount?.()); dom.window.close(); for (const restore of restores.reverse()) restore(); }
});
