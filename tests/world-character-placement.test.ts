import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DossierSchema } from '../src/domain/catalog.ts';
import { ContinuityContextSchema, GoalIdSchema, CapabilityIdSchema, InventoryItemIdSchema, WorldActionSchema } from '../src/domain/preparation.ts';
import { DesireIdSchema } from '../src/domain/character-biography.ts';
import { CharacterIdSchema } from '../src/domain/values.ts';
import { createEmptyRunConfigurationDraft } from '../src/domain/production.ts';
import { applyCuratedCharacter, characterCurationForm, curateCharacter } from '../src/web/character-preparation.ts';
import { changeDraftField, setDraftMoment } from '../src/web/draft-form.ts';
import { applyWorldSection, chooseActiveScene, confirmNoInitialOffers, placePreparedCharacter, worldCandidate } from '../src/web/world-preparation.ts';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import { buildActorWorldView, emptyActorKnowledge, WorldSnapshotSchema, WorldCharacterSchema, resolveWorldAttempt } from '../src/domain/world.ts';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorId = CharacterIdSchema.parse('fixture-robot');
const continuity = ContinuityContextSchema.parse({ continuityId: 'synthetic-cut', revision: 1, contentHash: 'a'.repeat(64), kind: 'adaptation', label: 'Synthetic placement test only', milestones: [], inclusions: [] });
const dossier = DossierSchema.parse({ schemaVersion: 1, characterId: actorId, displayName: 'Synthetic robot', aliases: [], performers: ['RESEARCH-PRIVATE'], markdown: '# RESEARCH-SECRET-FUTURE', sections: [], sourceRefs: [], unknowns: [], contradictions: [], adaptations: [], avatarRef: { kind: 'unbound' }, voiceRecipe: { kind: 'unreviewed' }, revision: 1, contentHash: 'b'.repeat(64), curationStatus: 'unreviewed', unknownSections: [] });
function preparedFixture(inventory = false, includeWorldAction = false) {
  return curateCharacter({ dossier, continuity, recordedAt: '2026-10-14T00:00:00Z', uuid: () => uuid(90), form: { ...characterCurationForm(), selfReference: 'Synthetic robot', selfConcept: 'An explicitly authored robot fixture.', dispositions: 'Literal', lifeNarrative: 'Synthetic life story for a placement test, with no canon or research claims.', lifeUnknowns: 'No earlier history is established by this fixture.', voice: 'Brief synthetic fixture speech.', provenanceKind: 'curator-declaration', reason: 'Test fixture only', noInitialExperiences: true,
    desires: [{ desireId: DesireIdSchema.parse('synthetic-desire'), description: 'Understand the test room.', stakes: 'Choose a suitable next action.', tension: 'Some contents of the scene remain unknown.', goalIds: [GoalIdSchema.parse('own-goal')] }],
    goals: [{ goalId: GoalIdSchema.parse('own-goal'), kind: 'durable', ownerCharacterId: actorId, desiredOutcome: 'x'.repeat(3000), priority: 0.6, status: 'achieved', evidenceRefs: [], reviewConditions: [] }],
    capabilities: [
      { capabilityId: CapabilityIdSchema.parse('own-speech'), kind: 'speech', description: 'Speaks as curated.' },
      { capabilityId: CapabilityIdSchema.parse('own-move'), kind: 'movement', description: 'Moves as curated.' },
      ...(includeWorldAction ? [
        { capabilityId: CapabilityIdSchema.parse('own-observe'), kind: 'world-action' as const, action: 'observe' as const, description: 'The prose mentions take; only observe is granted.' },
        { capabilityId: CapabilityIdSchema.parse('own-put-down'), kind: 'world-action' as const, action: 'putDown' as const, description: 'Can put down an object currently held at the actor position.' },
        { capabilityId: CapabilityIdSchema.parse('own-other'), kind: 'other' as const, description: 'take wait offer rest' },
      ] : []),
    ],
    inventory: inventory ? [{ itemId: InventoryItemIdSchema.parse('private-lot'), name: 'PRIVATE-NAME-' + 'x'.repeat(300), description: 'PRIVATE-OBJECT-CONTENTS', quantity: 5, condition: 'unknown' }] : [],
    relationships: [{ ownerCharacterId: actorId, otherCharacterId: CharacterIdSchema.parse('another-fixture'), otherReference: 'A privately known counterpart', descriptionFromOwnerPerspective: 'A relationship whose confidence must not become an invented stance.', confidence: 0.8 }],
  } });
}
function placementDraft(inventory = false, includeWorldAction = false) {
  const empty = createEmptyRunConfigurationDraft({ runId: uuid(1), revision: 0 });
  let draft = applyCuratedCharacter({ draft: changeDraftField({ draft: empty, field: 'continuity', value: continuity }), character: preparedFixture(inventory, includeWorldAction) });
  const moment = setDraftMoment({ draft, dateTime: '1965-01-01T12:00', offset: '-05:00' });
  assert.equal(moment.kind, 'applied'); if (moment.kind !== 'applied') throw new Error('Synthetic moment must parse'); draft = moment.draft;
  draft = applyWorldSection({ draft, section: 'places', value: [{ id: 'fixture-room', name: 'Synthetic room', description: 'Test only', width: 10, height: 8, lighting: 'normal' }] });
  draft = applyWorldSection({ draft, section: 'scenes', value: [{ id: uuid(2), label: 'Synthetic solitary scene', lifecycle: { kind: 'open', startedAt: draft.fictionalAt.kind === 'empty' ? 0 : draft.fictionalAt.value }, participantIds: [actorId], placeIds: ['fixture-room'] }] });
  draft = chooseActiveScene({ draft, sceneId: uuid(2) });
  for (const section of ['doors', 'connections', 'perceptualPaths', 'inventory', 'channels'] as const) draft = applyWorldSection({ draft, section, value: [] });
  draft = confirmNoInitialOffers(draft);
  draft = applyWorldSection({ draft, section: 'actionDurations', value: { observeMs: 0, speechMs: 0, gestureMs: 0, takeMs: 0, offerMs: 0, acceptOfferMs: 0, maxWaitMs: 1000, maxRestMs: 1000, offerValidityMs: 1000, interactionRange: 1 } });
  return draft;
}
const placement = { characterId: actorId, displayName: 'Synthetic robot', species: 'robot', presentation: { kind: 'cover', label: 'The visitor' }, placeId: 'fixture-room', sceneId: uuid(2), x: 2, y: 3, collisionRadius: 0.2, blocksMovement: false, availability: { kind: 'available' }, routine: { kind: 'always' }, recognizedCharacterIds: [], recognitionConfirmed: true, additionalCapabilities: [] };

test('curation to explicit physical placement reaches a valid Ready candidate without inference', () => {
  let counter = 10; let draft = placePreparedCharacter({ draft: placementDraft(), placement, uuid: () => uuid(counter++) });
  for (const [field, value] of [['name', 'Synthetic representation'], ['dramaticLine', { purpose: 'Test autonomous placement', question: { kind: 'absent' }, conflict: { kind: 'not-formulated' } }], ['circadianPolicy', { kind: 'manual-only' }], ['spanishVariety', { kind: 'proposed', label: 'Español sintético de prueba', source: 'editorial-proposal' }], ['budget', { maxPiCallsPerRun: 20, maxPiCallsPerPulse: 4, maxConcurrentPiRequests: 1, maxWallTimeMs: 1000 }]] as const) draft = changeDraftField({ draft, field, value });
  const result = validateRunConfiguration({ draft }); assert.equal(result.kind, 'ready', JSON.stringify(result));
  const world = WorldSnapshotSchema.parse(worldCandidate(draft));
  const actor = world.entities.find((entity) => entity.kind === 'character'); assert.ok(actor?.kind === 'character');
  assert.equal(actor.species, 'robot'); assert.deepEqual(actor.capabilities, ['speak', 'move']);
  assert.equal(actor.mind.goals[0]?.sourceGoalId, 'own-goal'); assert.equal(actor.mind.goals[0]?.description.length, 3000); assert.equal(actor.mind.goals[0]?.state, 'completed');
  assert.deepEqual(actor.mind.relationships, []); assert.deepEqual(actor.mind.recognizedCharacterIds, []);
  assert.deepEqual(actor.mind.experiences, []); assert.deepEqual(world.scenes[0]?.participantIds, [actorId]);
  assert.ok(!JSON.stringify(world).includes('RESEARCH-SECRET-FUTURE'));
  assert.equal(draft.roster.kind === 'empty' ? 0 : draft.roster.value.preparedCharacters[0]?.relationships.value.length, 1);
  const view = buildActorWorldView({ snapshot: world, actorId, knowledge: emptyActorKnowledge({ runId: draft.runId, actorId }), pendingPerceptions: [], ids: { eventId: () => uuid(counter++), perceptionId: () => uuid(counter++), experienceId: () => uuid(counter++), offerId: () => uuid(counter++), entityHandle: () => `entity-${counter++}`, placeHandle: () => `place-${counter++}`, channelHandle: () => `channel-${counter++}`, offerHandle: () => `offer-${counter++}` } });
  assert.ok(!JSON.stringify(view.view).includes('sourceGoalId'));
  assert.equal(view.view.self.relationshipDescriptions?.[0]?.description, preparedFixture().relationships.value[0]?.descriptionFromOwnerPerspective);
  assert.ok(!JSON.stringify(view.view).includes('another-fixture'));
  assert.ok(!JSON.stringify(view.view).includes('otherCharacterId'));
  assert.ok(!JSON.stringify(view.view).includes('RESEARCH-PRIVATE'));
});
test('manual placement maps only the chosen prepared world action, never capability prose', () => {
  let counter = 250;
  const placed = placePreparedCharacter({ draft: placementDraft(false, true), placement, uuid: () => uuid(counter++) });
  const actor = worldCandidate(placed).entities?.find((entity) => entity.kind === 'character'); assert.ok(actor?.kind === 'character');
  assert.deepEqual(actor.capabilities, ['speak', 'move', 'observe', 'putDown']);
  assert.ok(!actor.capabilities.includes('take'));
});
test('placement refuses unprepared actors, implicit recognition, duplicates and out-of-map positions', () => {
  const draft = placementDraft(); let calls = 0; const ids = () => { calls++; return uuid(calls + 100); };
  assert.throws(() => placePreparedCharacter({ draft, placement: { ...placement, characterId: 'not-prepared' }, uuid: ids }));
  assert.throws(() => placePreparedCharacter({ draft, placement: { ...placement, recognitionConfirmed: undefined }, uuid: ids }));
  assert.throws(() => placePreparedCharacter({ draft, placement: { ...placement, x: 99 }, uuid: ids }));
  assert.throws(() => placePreparedCharacter({ draft, placement: { ...placement, recognizedCharacterIds: ['another-fixture'] }, uuid: ids }));
  assert.equal(calls, 0);
  const placed = placePreparedCharacter({ draft, placement: { ...placement, additionalCapabilities: ['observe'] }, uuid: ids });
  assert.throws(() => placePreparedCharacter({ draft: placed, placement, uuid: ids }), /ya está colocado/);
  const actor = worldCandidate(placed).entities?.[0]; assert.ok(actor);
  assert.ok(actor.kind === 'character' && actor.capabilities.includes('observe'));
  assert.ok(!WorldCharacterSchema.safeParse({ ...actor, species: 'animal', capabilities: ['speak'] }).success);
});

test('placement admite todas las acciones explícitas actuales, incluida dejar un objeto propio',()=>{
  let next=500;
  const placed=placePreparedCharacter({draft:placementDraft(),placement:{...placement,additionalCapabilities:WorldActionSchema.options},uuid:()=>uuid(next++)});
  const actor=WorldSnapshotSchema.parse(worldCandidate(placed)).entities.find(entity=>entity.kind==='character');
  assert.ok(actor?.kind==='character');
  for(const action of WorldActionSchema.options)assert.ok(actor.capabilities.includes(action));
});

test('actor goals preserve subjective circumstances while hiding source links and direction milestones', () => {
  let next = 400;
  const placed = placePreparedCharacter({ draft: placementDraft(), placement, uuid: () => uuid(next++) });
  const initial = WorldSnapshotSchema.parse(worldCandidate(placed));
  const world = WorldSnapshotSchema.parse({ ...initial, entities: initial.entities.map((entity) => entity.kind !== 'character' ? entity : {
    ...entity, mind: { ...entity.mind, goals: entity.mind.goals.map((goal) => ({ ...goal,
      sourceGoalId: 'secret-future-goal', reviewConditions: [
        { kind: 'milestone-state', milestoneId: 'secret-future-revelation', requires: 'notReached' },
        { kind: 'circumstance', description: 'When I hear a request for help.' },
      ],
    })) },
  }) });
  const ids = { eventId: () => uuid(next++), perceptionId: () => uuid(next++), experienceId: () => uuid(next++), offerId: () => uuid(next++), entityHandle: () => `entity-${next++}`, placeHandle: () => `place-${next++}`, channelHandle: () => `channel-${next++}`, offerHandle: () => `offer-${next++}` };
  const projection = buildActorWorldView({ snapshot: world, actorId, knowledge: emptyActorKnowledge({ runId: placed.runId, actorId }), pendingPerceptions: [], ids });
  assert.deepEqual(projection.view.self.goals[0]?.reviewConditions, [{ kind: 'circumstance', description: 'When I hear a request for help.' }]);
  assert.equal(projection.view.self.goals[0]?.id, world.entities.find((entity) => entity.kind === 'character')?.mind.goals[0]?.id);
  assert.ok(!JSON.stringify(projection.view).includes('secret-future'));
  assert.ok(JSON.stringify(world).includes('secret-future-revelation'));
});


test('physical inventory keeps lot count and condition through taking without transferring private owner knowledge', () => {
  const draft = placementDraft(true); let nextId = 200;
  assert.throws(() => placePreparedCharacter({ draft, placement, uuid: () => uuid(nextId++) }), /propiedades materiales/);
  assert.equal(nextId, 200);
  const placed = placePreparedCharacter({ draft, placement: { ...placement, additionalCapabilities: ['observe'], materialChoices: [{ itemId: 'private-lot', visibleLabel: 'Maleta visible', physicalDescription: 'Una maleta cerrada.', collisionRadius: 0.1, blocksMovement: false, portable: true }] }, uuid: () => uuid(nextId++) });
  const world = WorldSnapshotSchema.parse(worldCandidate(placed));
  const actor = world.entities.find((entity) => entity.kind === 'character'); assert.ok(actor?.kind === 'character');
  const object = world.entities.find((entity) => entity.kind === 'object'); assert.ok(object?.kind === 'object');
  const ids = { eventId: () => uuid(nextId++), perceptionId: () => uuid(nextId++), experienceId: () => uuid(nextId++), offerId: () => uuid(nextId++), entityHandle: () => `entity-${nextId++}`, placeHandle: () => `place-${nextId++}`, channelHandle: () => `channel-${nextId++}`, offerHandle: () => `offer-${nextId++}` };
  const own = buildActorWorldView({ snapshot: world, actorId, knowledge: emptyActorKnowledge({ runId: draft.runId, actorId }), pendingPerceptions: [], ids });
  assert.equal(own.view.self.inventory[0]?.label, 'PRIVATE-NAME-' + 'x'.repeat(300));
  assert.equal(own.view.self.inventory[0]?.description, 'PRIVATE-OBJECT-CONTENTS');
  assert.equal(own.view.self.inventory[0]?.quantity, 5); assert.equal(own.view.self.inventory[0]?.condition, 'unknown');
  assert.ok(!JSON.stringify(own.view).includes('sourceItemId')); assert.ok(!JSON.stringify(own.view).includes('private-lot'));
  const otherId = CharacterIdSchema.parse('another-fixture');
  const exposed = WorldSnapshotSchema.parse({ ...world,
    entities: [...world.entities, { ...actor, characterId: otherId, entityId: uuid(199), trueDisplayName: 'Other synthetic actor', presentation: { kind: 'ordinary', label: 'Otro' }, capabilities: ['take', 'observe'], mind: { goals: [], beliefs: [], relationships: [], recognizedCharacterIds: [], experiences: [], relationshipDescriptions: [{ reference: 'Another reference', description: 'OTHER-PRIVATE-RELATIONSHIP', confidence: 0.3, revision: 0 }] } }],
    scenes: world.scenes.map((scene) => ({ ...scene, participantIds: [...scene.participantIds, otherId] })),
  });
  const other = buildActorWorldView({ snapshot: exposed, actorId: otherId, knowledge: emptyActorKnowledge({ runId: draft.runId, actorId: otherId }), pendingPerceptions: [], ids });
  const serializedOther = JSON.stringify(other.view);
  assert.ok(!serializedOther.includes('PRIVATE-NAME')); assert.ok(!serializedOther.includes('PRIVATE-OBJECT-CONTENTS'));
  assert.ok(serializedOther.includes('Maleta visible')); assert.ok(!serializedOther.includes('sourceItemId'));
  const ownExposed = buildActorWorldView({ snapshot: exposed, actorId, knowledge: own.knowledge, pendingPerceptions: [], ids });
  assert.ok(!JSON.stringify(ownExposed.view).includes('OTHER-PRIVATE-RELATIONSHIP'));
  const onFloor = WorldSnapshotSchema.parse({ ...exposed, inventory: [{ ...exposed.inventory[0], location: { kind: 'atPlace', placeId: 'fixture-room', position: { x: 2, y: 3 } } }] });
  const observerView = buildActorWorldView({ snapshot: onFloor, actorId, knowledge: own.knowledge, pendingPerceptions: [], ids });
  const visibleObject = observerView.view.entities.find((entity) => entity.kind === 'object'); assert.ok(visibleObject?.kind === 'object');
  const observation = resolveWorldAttempt({ snapshot: onFloor, actorKnowledge: observerView.knowledge, attempt: {
    kind: 'observe', attemptId: uuid(nextId++), runId: draft.runId, actorId, expectedRevision: onFloor.revision,
    target: { modality: 'visual', targetHandle: visibleObject.handle },
  }, ids });
  assert.equal(observation.kind, 'applied');
  const floorView = buildActorWorldView({ snapshot: onFloor, actorId: otherId, knowledge: other.knowledge, pendingPerceptions: [], ids });
  const target = floorView.view.entities.find((entity) => entity.kind === 'object'); assert.ok(target?.kind === 'object');
  const taken = resolveWorldAttempt({ snapshot: onFloor, actorKnowledge: floorView.knowledge, attempt: { kind: 'take', attemptId: uuid(nextId++), runId: draft.runId, actorId: otherId, expectedRevision: onFloor.revision, objectHandle: target.handle }, ids });
  assert.equal(taken.kind, 'applied');
  const held = taken.newSnapshot.entities.find((entity) => entity.entityId === object.entityId); assert.ok(held?.kind === 'object');
  assert.equal(held.quantity, 5); assert.equal(held.condition, 'unknown'); assert.equal(held.sourceItemId, 'private-lot');
  const newOwner = buildActorWorldView({ snapshot: taken.newSnapshot, actorId: otherId, knowledge: floorView.knowledge, pendingPerceptions: [], ids });
  assert.equal(newOwner.view.self.inventory[0]?.quantity, 5); assert.equal(newOwner.view.self.inventory[0]?.description, 'Una maleta cerrada.');
  assert.equal(newOwner.view.self.inventory[0]?.label, 'Maleta visible'); assert.ok(!JSON.stringify(newOwner.view).includes('PRIVATE-OBJECT-CONTENTS'));
});
