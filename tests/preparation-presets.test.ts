import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openJournal } from '../src/adapters/journal.ts';
import { RunDraftPatchSchema } from '../src/domain/world-journal.ts';
import { PreparedCharacterSchema } from '../src/domain/preparation.ts';
import { applyCuratedCharacter } from '../src/web/character-preparation.ts';
import { confirmDraftField } from '../src/web/draft-form.ts';
import { placePreparedCharacter } from '../src/web/world-preparation.ts';
import { createPreparationPreset, PREPARATION_PRESETS } from '../src/application/preparation-presets.ts';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import { CatalogCharacterSummarySchema } from '../src/domain/http.ts';
import { createEmptyRunConfigurationDraft, RunConfigurationDraftSchema, WorldPreparationCandidateSchema } from '../src/domain/production.ts';
import { WorldSnapshotSchema } from '../src/domain/world-schema.ts';

const catalog = ['maxwell-smart', 'hymie'].map((slug) => CatalogCharacterSummarySchema.parse({
  characterId: slug, displayName: slug === 'hymie' ? 'Hymie' : 'Maxwell Smart', revision: 0,
  hash: 'a'.repeat(64), curationStatus: 'unreviewed', avatarRef: { kind: 'catalog-reference', slug },
}));
const runId = '00000000-0000-4000-8000-000000000001';
function uuidSequence() {
  let next = 10;
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
}

test('blank preserves the empty draft, creates no UUIDs and needs no catalog', async () => {
  const result = await createPreparationPreset({ preset: 'blank', runId, catalog: [], uuid: () => { throw new Error('Unexpected UUID request'); } });
  assert.deepEqual(result, { ...createEmptyRunConfigurationDraft({ runId, revision: 0 }), icmWorkspace: { kind: 'empty' } });
});

test('synthetic preset is editable, consistently scoped and blocks promotion until reviewed and curated', async () => {
  const before = structuredClone(catalog);
  const draft = await createPreparationPreset({ preset: 'fibonacci', runId, catalog, uuid: uuidSequence() });
  assert.deepEqual(catalog, before);
  assert.deepEqual(RunConfigurationDraftSchema.parse(draft), draft);
  for (const section of ['name', 'fictionalAt', 'continuity', 'roster', 'worldSnapshot', 'dramaticLine', 'circadianPolicy', 'spanishVariety'] satisfies (keyof typeof draft)[]) {
    const field = draft[section];
    assert.equal(field?.kind, 'proposed');
    if (field?.kind === 'proposed') assert.equal(field.source, 'template');
  }
  assert.equal(draft.continuity.kind, 'proposed');
  assert.equal(draft.worldSnapshot.kind, 'proposed');
  assert.equal(draft.roster.kind, 'proposed');
  assert.equal(draft.fictionalAt.kind, 'proposed');
  if (draft.continuity.kind !== 'proposed' || draft.worldSnapshot.kind !== 'proposed' || draft.roster.kind !== 'proposed' || draft.fictionalAt.kind !== 'proposed') throw new Error('Expected proposals');
  const continuity = draft.continuity.value;
  assert.equal(continuity.kind, 'adaptation');
  assert.deepEqual(continuity.milestones, []);
  assert.deepEqual(continuity.inclusions, []);
  const { contentHash, ...core } = continuity;
  assert.equal(contentHash, createHash('sha256').update(JSON.stringify(core)).digest('hex'));
  const world = WorldPreparationCandidateSchema.parse(draft.worldSnapshot.value);
  assert.equal(WorldSnapshotSchema.safeParse(world).success, false, 'Uncurated scene participants cannot be Ready');
  assert.equal(world.runId, runId);
  assert.equal(world.revision, 0);
  assert.equal(world.seq, 0);
  assert.equal(world.clock?.instant, draft.fictionalAt.value);
  assert.equal(world.clock?.instant, Date.parse('1966-06-15T10:00:00-04:00'));
  assert.deepEqual(draft.roster.value.preparedCharacters, []);
  assert.deepEqual(draft.roster.value.activeCharacterIds, catalog.map((entry) => entry.characterId));
  assert.equal(world.scenes?.[0]?.participantIds, undefined);
  assert.equal(world.activeSceneId, world.scenes?.[0]?.id);
  assert.equal(world.entities, undefined, 'No placeholder blocks the placement of curated actors');
  assert.deepEqual(draft.humanParticipants, createEmptyRunConfigurationDraft({ runId, revision: 0 }).humanParticipants);
  const validation = validateRunConfiguration({ draft });
  assert.notEqual(validation.kind, 'ready');
  if (validation.kind === 'ready') throw new Error('Unreviewed draft cannot promote');
  assert.ok(validation.issues.some((issue) => issue.code === 'proposal-not-confirmed'));
  assert.equal(PREPARATION_PRESETS.find((entry) => entry.id === 'fibonacci')?.goalSuggestions.length, 2);
});

test('preset selection never substitutes missing, fuzzy or inconsistent identities', async () => {
  await assert.rejects(createPreparationPreset({ preset: 'fibonacci', runId, catalog: catalog.slice(0, 1), uuid: randomUUID }), /hymie/);
  await assert.rejects(createPreparationPreset({ preset: 'fibonacci', runId, catalog: [...catalog, catalog[0]].filter((entry) => entry !== undefined), uuid: randomUUID }), /exactamente un personaje maxwell-smart/);
  const mismatched = catalog.map((entry) => entry.characterId === 'hymie' ? { ...entry, avatarRef: { ...entry.avatarRef, slug: 'otro-robot' } } : entry);
  await assert.rejects(createPreparationPreset({ preset: 'fibonacci', runId, catalog: mismatched, uuid: randomUUID }), /no coinciden/);
  const fuzzy = catalog.map((entry) => CatalogCharacterSummarySchema.parse({ ...entry, characterId: `${entry.characterId}-otro`, avatarRef: { ...entry.avatarRef, slug: `${entry.avatarRef.slug}-otro` } }));
  await assert.rejects(createPreparationPreset({ preset: 'fibonacci', runId, catalog: fuzzy, uuid: randomUUID }), /encontrados: 0/);
});

test('different builds share neither world IDs nor mutable objects; bad UUID generators fail', async () => {
  const first = await createPreparationPreset({ preset: 'fibonacci', runId, catalog, uuid: randomUUID });
  const second = await createPreparationPreset({ preset: 'fibonacci', runId: randomUUID(), catalog, uuid: randomUUID });
  assert.notDeepEqual(first.worldSnapshot, second.worldSnapshot);
  assert.notDeepEqual(first.continuity, second.continuity);
  if (first.roster.kind !== 'proposed' || second.roster.kind !== 'proposed') throw new Error('Expected proposals');
  first.roster.value.activeCharacterIds.pop();
  assert.equal(second.roster.value.activeCharacterIds.length, 2);
  assert.equal(catalog.length, 2);
  await assert.rejects(createPreparationPreset({ preset: 'fibonacci', runId, catalog, uuid: () => runId }), /repitió/);
  await assert.rejects(createPreparationPreset({ preset: 'fibonacci', runId, catalog, uuid: () => 'bad-id' }));
});

test('proposed preset survives journal save and reopening without creating a world or acting', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-preset-'));
  const path = join(directory, 'journal.sqlite');
  let journal = openJournal({ path });
  try {
    const draft = await createPreparationPreset({ preset: 'fibonacci', runId, catalog, uuid: randomUUID });
    const patch = RunDraftPatchSchema.parse(Object.fromEntries(Object.entries(draft).filter(([key]) => !['kind', 'schemaVersion', 'runId', 'revision'].includes(key))));
    const created = journal.createRunConfigurationDraft({ principalId: 'preset-test', idempotencyKey: randomUUID(), patch });
    if (created.kind !== 'created') assert.fail(`Unexpected save result: ${created.kind}`);
    const stored = created.draft;
    journal.close();
    journal = openJournal({ path });
    assert.deepEqual(journal.readRunConfigurationDraft({ runId: stored.runId }), stored);
    assert.equal(journal.readWorldConfiguration({ runId: stored.runId }), undefined);
    assert.equal(stored.worldSnapshot.kind, 'proposed');
    if (stored.worldSnapshot.kind === 'proposed') assert.equal(stored.worldSnapshot.value.runId, stored.runId);
    const validation = journal.validateRunConfigurationDraft({ principalId: 'preset-test', idempotencyKey: randomUUID(), runId: stored.runId, expectedRevision: 0 });
    assert.equal(validation.kind, 'incomplete');
    assert.equal(journal.readWorldConfiguration({ runId: stored.runId }), undefined);
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('explicit curation can place each selected character into the suggested scene without placeholders', async () => {
  let draft = await createPreparationPreset({ preset: 'fibonacci', runId, catalog, uuid: randomUUID });
  draft = confirmDraftField({ draft, field: 'continuity' });
  if (draft.continuity.kind !== 'configured' || draft.worldSnapshot.kind !== 'proposed') throw new Error('Expected confirmed continuity and proposed world');
  const continuity = draft.continuity.value;
  const sceneId = draft.worldSnapshot.value.activeSceneId;
  const provenance = { kind: 'curator-declaration', dossierRevision: 0, dossierHash: 'a'.repeat(64),
    continuity: { continuityId: continuity.continuityId, revision: continuity.revision, contentHash: continuity.contentHash },
    reason: 'Synthetic test-only curation, not generated preset content.', authoredBy: 'test-curator', createdAt: '2026-10-15T00:00:00Z', sourceRefs: [] };
  const curated = <T>(value: T) => ({ value, provenance });
  for (const [index, entry] of catalog.entries()) {
    const character = PreparedCharacterSchema.parse({ kind: 'prepared-character', schemaVersion: 1, characterId: entry.characterId,
      dossierRevision: 0, dossierHash: entry.hash, continuity, identityVersion: 1,
      identity: curated({ selfReference: entry.displayName, selfConcept: 'Test-only identity chosen explicitly by curator.', values: [], dispositions: ['Test-only attentive disposition.'], contradictions: [] }),
      voice: curated({ kind: 'spoken', recipe: 'Test-only speech choice.' }), antecedents: curated([]), goals: curated([{ kind: 'situated', goalId: 'objetivo-test', ownerCharacterId: entry.characterId, desiredOutcome: 'Test-only chosen objective.', priority: 0.5, reviewConditions: [], status: 'active', evidenceRefs: [] }]), relationships: curated([]),
      capabilities: curated([{ capabilityId: 'habla-test', kind: 'speech', description: 'Test-only speech.' }]), inventory: curated([]),
      initialExperience: curated({ kind: 'none' }), unknownPolicy: curated({ defaultTreatment: 'do-not-infer-or-assert', fields: [] }),
    });
    draft = applyCuratedCharacter({ draft, character });
    draft = placePreparedCharacter({ draft, uuid: randomUUID, placement: {
      characterId: entry.characterId, displayName: entry.displayName, species: index === 0 ? 'human' : 'robot', presentation: { kind: 'ordinary', label: entry.displayName },
      placeId: 'sala-ensayo', sceneId, x: 3 + index * 2, y: 3, collisionRadius: 0.25, blocksMovement: false,
      availability: { kind: 'available' }, routine: { kind: 'always' }, recognitionConfirmed: true, recognizedCharacterIds: [], additionalCapabilities: ['observe', 'wait'], materialChoices: [],
    } });
  }
  if (draft.worldSnapshot.kind !== 'configured') throw new Error('Placement must configure the world');
  const world = WorldSnapshotSchema.parse(draft.worldSnapshot.value);
  assert.deepEqual(world.scenes[0]?.participantIds, catalog.map((entry) => entry.characterId));
  assert.equal(world.entities.length, 2);
  for (const entity of world.entities) if (entity.kind === 'character') {
    assert.equal(entity.preparation.kind, 'prepared');
    assert.ok(entity.capabilities.includes('speak'));
    assert.deepEqual(entity.mind.experiences, []);
  }
});

test('CONTROL ensemble proposes three distinct actors and an unverified physical document without preparing their minds', async () => {
  const ensembleCatalog = [...catalog, ...['agente-99', 'jefe'].map((slug) => CatalogCharacterSummarySchema.parse({
    characterId: slug, displayName: slug, revision: 0, hash: 'b'.repeat(64),
    curationStatus: 'unreviewed', avatarRef: { kind: 'catalog-reference', slug },
  }))];
  const before = structuredClone(ensembleCatalog);
  const draft = await createPreparationPreset({ preset: 'control-ensemble', runId, catalog: ensembleCatalog, uuid: uuidSequence() });
  assert.deepEqual(ensembleCatalog, before);
  if (draft.roster.kind !== 'proposed' || draft.worldSnapshot.kind !== 'proposed' || draft.continuity.kind !== 'proposed') assert.fail('The ensemble must remain a proposal.');
  assert.deepEqual(draft.roster.value.activeCharacterIds, ['maxwell-smart', 'agente-99', 'jefe']);
  assert.deepEqual(draft.roster.value.preparedCharacters, []);
  assert.deepEqual(draft.icmWorkspace, { kind: 'empty' });
  assert.deepEqual(draft.characterDefinitionPolicy, { kind: 'embodied-v1' });
  const world = WorldPreparationCandidateSchema.parse(draft.worldSnapshot.value);
  assert.equal(world.scenes?.[0]?.participantIds, undefined);
  assert.equal(world.entities?.length, 2);
  const paper = world.entities?.[0];
  assert.equal(paper?.kind, 'object');
  if (paper?.kind !== 'object') assert.fail('Expected a physical prop, never a placeholder actor.');
  assert.match(paper.description ?? '', /no una prueba/);
  assert.equal(world.inventory?.[0]?.objectEntityId, paper.entityId);
  assert.equal(world.places?.length, 3);
  assert.equal(world.connections?.length, 4);
  assert.deepEqual(world.perceptualPaths, [], 'Separate rooms never grant remote hearing or vision by default.');
  const record = world.entities?.find((entity) => entity.kind === 'object' && entity.label === 'Registro de mantenimiento');
  assert.equal(record?.kind, 'object');
  assert.match(record?.description ?? '', /no acredita el estado actual/);
  assert.equal(world.inventory?.[0]?.location.kind, 'atPlace');
  assert.equal(world.clock?.instant, Date.parse('1966-06-20T09:00:00-04:00'));
  assert.deepEqual(draft.continuity.value.inclusions, []);
  assert.equal(WorldSnapshotSchema.safeParse(world).success, false);
  assert.notEqual(validateRunConfiguration({ draft }).kind, 'ready');
  assert.doesNotMatch(JSON.stringify(draft), /fibonacci/i);
  await assert.rejects(createPreparationPreset({ preset: 'control-ensemble', runId, catalog, uuid: randomUUID }), /agente-99/);
});
