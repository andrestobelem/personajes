import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEmptyRunConfigurationDraft, RunConfigurationDraftSchema } from '../src/domain/production.ts';
import { WorldSnapshotSchema } from '../src/domain/world-schema.ts';
import { changeDraftField } from '../src/web/draft-form.ts';
import { WorldPreparationEditor } from '../src/web/WorldPreparationEditor.tsx';
import { applyWorldSection, chooseActiveScene, confirmNoInitialOffers, parseWorldNumericInput, worldMapItems, worldCandidate, worldPreparationIssues, worldReferences } from '../src/web/world-preparation.ts';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function draftFixture() {
  const world = WorldSnapshotSchema.parse({ schemaVersion: 1, runId: uuid(1), revision: 0, seq: 0,
    clock: { instant: 0, convention: { kind: 'fixedOffset', offsetMinutes: 0, label: 'UTC' } },
    places: [{ id: 'sala', name: 'Sala de prueba', description: '', width: 10, height: 10, lighting: 'normal' }],
    doors: [{ id: uuid(4), label: 'Puerta de prueba', state: 'open', transparentWhenClosed: false, soundPassesWhenClosed: false }],
    connections: [], perceptualPaths: [], channels: [],
    entities: [{ kind: 'character', entityId: uuid(3), characterId: 'actor-prueba', trueDisplayName: 'Actor sintético',
      species: 'human', presentation: { kind: 'ordinary', label: 'Actor sintético' }, placeId: 'sala', position: { x: 1, y: 1 },
      collisionRadius: 0, blocksMovement: false, presence: { kind: 'present', sceneId: uuid(2) },
      preparation: { kind: 'prepared', continuityId: 'prueba', identityVersion: 1 }, capabilities: ['wait'],
      availability: { kind: 'available' }, routine: { kind: 'always' }, mind: { goals: [], beliefs: [], relationships: [], recognizedCharacterIds: [], experiences: [] } }],
    inventory: [], scenes: [{ id: uuid(2), label: 'Escena de prueba', lifecycle: { kind: 'open', startedAt: 0 }, participantIds: ['actor-prueba'], placeIds: ['sala'] }],
    activeSceneId: uuid(2), offers: [], actionDurations: { observeMs: 0, speechMs: 0, gestureMs: 0, takeMs: 0, offerMs: 0, acceptOfferMs: 0, maxWaitMs: 100, maxRestMs: 100, offerValidityMs: 100, interactionRange: 1 },
  });
  return changeDraftField({ draft: createEmptyRunConfigurationDraft({ runId: uuid(1), revision: 0 }), field: 'worldSnapshot', value: world });
}

test('numeric editing rejects non-finite values and preserves a pending blank', () => {
  assert.equal(parseWorldNumericInput(''), undefined);
  assert.equal(parseWorldNumericInput('  '), undefined);
  assert.equal(parseWorldNumericInput('2.5'), 2.5);
  assert.throws(() => parseWorldNumericInput('Infinity'));
  assert.throws(() => parseWorldNumericInput('oops'));
  assert.throws(() => applyWorldSection({ draft: draftFixture(), section: 'places', value: [{ id: 'sala', name: 'Sala', description: '', width: -1, height: 10, lighting: 'normal' }] }));
});
test('changing one section preserves clock, inventory, actor minds and hidden candidate sections', () => {
  const before = draftFixture(); const original = worldCandidate(before);
  const next = applyWorldSection({ draft: before, section: 'places', value: [{ ...original.places?.[0], name: 'Nombre elegido' }] });
  const candidate = worldCandidate(next);
  assert.equal(candidate.places?.[0]?.name, 'Nombre elegido');
  for (const key of ['clock', 'entities', 'doors', 'inventory', 'offers', 'scenes', 'actionDurations'] as const) assert.deepEqual(candidate[key], original[key]);
  assert.equal(next.roster.kind, 'empty');
  assert.deepEqual(worldPreparationIssues(next), []);
});
test('full candidate validation exposes unknown references and positions outside resized geometry', () => {
  const draft = draftFixture();
  const narrow = applyWorldSection({ draft, section: 'places', value: [{ ...worldCandidate(draft).places?.[0], width: 0.5 }] });
  assert.ok(worldPreparationIssues(narrow).some((issue) => issue.includes('Posición fuera del mapa')));
  const unknownDoor = applyWorldSection({ draft, section: 'connections', value: [{ from: 'sala', to: 'sala', durationMs: 0, arrivalPoint: { x: 0, y: 0 }, doorId: uuid(99) }] });
  assert.ok(worldPreparationIssues(unknownDoor).some((issue) => issue.includes('Puerta desconocida')));
  assert.throws(() => chooseActiveScene({ draft, sceneId: uuid(99) }));
  assert.equal(worldCandidate(chooseActiveScene({ draft, sceneId: uuid(2) })).activeSceneId, uuid(2));
  assert.deepEqual(worldReferences(draft, 'doorId'), [{ id: uuid(4), label: 'Puerta de prueba' }]);
});
test('rendering preparation leaves an empty draft untouched and presents visual controls without raw JSON', () => {
  const draft = createEmptyRunConfigurationDraft({ runId: uuid(1), revision: 0 });
  const markup = renderToStaticMarkup(React.createElement(WorldPreparationEditor, { draft, onChange: () => assert.fail('Rendering must not mutate configuration'), onPendingChange: () => assert.fail('Rendering must not mark input as chosen') }));
  assert.ok(markup.includes('Preparar el Escenario'));
  assert.ok(markup.includes('Agregar lugares'));
  assert.ok(markup.includes('Trayectos de percepción'));
  assert.ok(!markup.includes('<textarea'));
  assert.equal(draft.worldSnapshot.kind, 'empty');
  const preparedMarkup = renderToStaticMarkup(React.createElement(WorldPreparationEditor, { draft: draftFixture(), onChange: () => {}, onPendingChange: () => {}, readOnly: true }));
  assert.ok(preparedMarkup.includes('<svg'));
  assert.ok(preparedMarkup.includes('posición 1, 1'));
  assert.ok(preparedMarkup.includes('disabled'));
  RunConfigurationDraftSchema.parse(draft);
});

test('objects use inventory coordinates in the plan and confirming empty offers preserves all other state', () => {
  const original = draftFixture();
  const candidate = worldCandidate(original);
  const draft = changeDraftField({ draft: original, field: 'worldSnapshot', value: { ...candidate,
    entities: [...(candidate.entities ?? []), { kind: 'object', entityId: uuid(6), label: 'Sobre sintético', description: '', collisionRadius: 0, blocksMovement: false, portable: true }],
    inventory: [{ objectEntityId: uuid(6), location: { kind: 'atPlace', placeId: 'sala', position: { x: 3, y: 4 } }, revision: 0 }],
  } });
  assert.deepEqual(worldMapItems(draft, 'sala').find((entry) => entry.kind === 'object'), { id: uuid(6), label: 'Sobre sintético', kind: 'object', x: 3, y: 4, radius: 0 });
  const confirmed = confirmNoInitialOffers(draft);
  assert.deepEqual(worldCandidate(confirmed), worldCandidate(draft));
  assert.deepEqual(worldMapItems(draft, 'fuera'), []);
});

test('circumstance catalog and initial environment survive candidate roundtrip and expose typed references', () => {
  const original = draftFixture();
  const catalog = { environmentConditions: [{ id: 'lluvia', label: 'Lluvia', states: [{ id: 'visible', description: 'La lluvia cae ante la ventana.', modality: 'visual' }, { id: 'audible', description: 'Se escucha lluvia.', modality: 'auditory' }] }], objectTemplates: [{ id: 'sobre', object: { kind: 'object', entityId: uuid(90), label: 'Sobre visible', description: 'Un sobre cerrado.', collisionRadius: 0.1, blocksMovement: false, portable: true }, allowedPlaceIds: ['sala'] }], provenance: { sourceRefs: ['Decisión del operador de prueba'] } };
  const withCatalog = applyWorldSection({ draft: original, section: 'circumstanceCatalog', value: catalog });
  const withEnvironment = applyWorldSection({ draft: withCatalog, section: 'environment', value: [{ placeId: 'sala', conditionId: 'lluvia', stateId: 'visible' }] });
  const roundtrip = RunConfigurationDraftSchema.parse(JSON.parse(JSON.stringify(withEnvironment)));
  assert.equal(worldCandidate(roundtrip).circumstanceCatalog?.revision, 1);
  assert.equal(worldCandidate(roundtrip).circumstanceCatalog?.provenance.authoredBy, 'local-user');
  assert.deepEqual(worldCandidate(roundtrip).circumstanceCatalog?.provenance.sourceRefs, catalog.provenance.sourceRefs);
  assert.deepEqual(worldCandidate(roundtrip).environment, [{ placeId: 'sala', conditionId: 'lluvia', stateId: 'visible' }]);
  assert.deepEqual(worldPreparationIssues(roundtrip), []);
  assert.deepEqual(worldReferences(roundtrip, 'allowedPlaceIds'), [{ id: 'sala', label: 'Sala de prueba' }]);
  assert.deepEqual(worldReferences(roundtrip, 'conditionId'), [{ id: 'lluvia', label: 'Lluvia' }]);
  assert.equal(worldReferences(roundtrip, 'stateId', 'lluvia')?.length, 2);
  assert.deepEqual(worldReferences(roundtrip, 'stateId', 'forged'), []);
  const revision2 = applyWorldSection({ draft: roundtrip, section: 'circumstanceCatalog', value: catalog });
  assert.equal(worldCandidate(revision2).circumstanceCatalog?.revision, 2);
  assert.deepEqual(worldCandidate(revision2).entities, worldCandidate(original).entities);
  assert.deepEqual(worldCandidate(revision2).inventory, worldCandidate(original).inventory);
});

test('explicit empty catalog is valid; unresolved environment and template references block Ready validation', () => {
  const empty = applyWorldSection({ draft: draftFixture(), section: 'circumstanceCatalog', value: { environmentConditions: [], objectTemplates: [] } });
  assert.deepEqual(worldPreparationIssues(empty), []);
  assert.equal(worldCandidate(empty).circumstanceCatalog?.revision, 1);
  const environment = applyWorldSection({ draft: empty, section: 'environment', value: [{ placeId: 'sala', conditionId: 'unconfigured', stateId: 'forged' }] });
  assert.ok(worldPreparationIssues(environment).some((issue) => issue.includes('environment')));
  const invalidTemplate = applyWorldSection({ draft: empty, section: 'circumstanceCatalog', value: { environmentConditions: [], objectTemplates: [{ id: 'box', object: { kind: 'object', entityId: uuid(90), label: 'Caja', description: '', collisionRadius: 0, blocksMovement: false, portable: true }, allowedPlaceIds: ['forged'] }] } });
  assert.ok(worldPreparationIssues(invalidTemplate).some((issue) => issue.includes('allowedPlaceIds')));
  const markup = renderToStaticMarkup(React.createElement(WorldPreparationEditor, { draft: empty, onChange: () => {}, onPendingChange: () => {} }));
  assert.match(markup, /Catálogo de circunstancias/); assert.match(markup, /Ambiente inicial/); assert.doesNotMatch(markup, /<textarea/);
});

test('catalog and initial environment render their complete typed values without interpreting another section array as an object', () => {
  const catalog = { environmentConditions: [{ id: 'bruma', label: 'Bruma de prueba', states: [{ id: 'neblina', description: 'Hay neblina en la sala.', modality: 'visual' }] }], objectTemplates: [{ id: 'caja', object: { kind: 'object', entityId: uuid(91), label: 'Caja sintética', description: 'Plantilla de prueba.', collisionRadius: 0.1, blocksMovement: false, portable: true }, allowedPlaceIds: ['sala'] }], provenance: { sourceRefs: ['test:catalog-render'] } };
  const withCatalog = applyWorldSection({ draft: draftFixture(), section: 'circumstanceCatalog', value: catalog });
  const draft = applyWorldSection({ draft: withCatalog, section: 'environment', value: [{ placeId: 'sala', conditionId: 'bruma', stateId: 'neblina' }] });
  const render = (initialSection: 'circumstanceCatalog' | 'environment') => renderToStaticMarkup(React.createElement(WorldPreparationEditor, { draft, initialSection, onChange: () => {}, onPendingChange: () => {} }));
  const catalogMarkup = render('circumstanceCatalog');
  assert.match(catalogMarkup, /Bruma de prueba/); assert.match(catalogMarkup, /Caja sintética/); assert.match(catalogMarkup, /Hay neblina en la sala/); assert.match(catalogMarkup, /test:catalog-render/); assert.match(catalogMarkup, /Confirmo este catálogo/);
  const environmentMarkup = render('environment');
  assert.match(environmentMarkup, /Bruma de prueba/); assert.match(environmentMarkup, /Hay neblina en la sala/); assert.match(environmentMarkup, /Sala de prueba/);
});
