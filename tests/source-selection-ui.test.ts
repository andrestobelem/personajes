import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DossierSchema } from '../src/domain/catalog.ts';
import { DossierSourceSchema } from '../src/domain/dossier-source.ts';
import { samePreparationSource, readPreparationAdaptations, readCatalogPreparationSource, readAdaptationPreparationSource } from '../src/web/source-selection-client.ts';
import { characterCurationForm, recuratingCharacterSource, curateCharacter } from '../src/web/character-preparation.ts';
import { ContinuityContextSchema, GoalSchema, CapabilitySchema } from '../src/domain/preparation.ts';
const dossier = DossierSchema.parse({ schemaVersion: 1, characterId: 'maxwell-smart', displayName: 'Fixture', aliases: [], performers: ['Research'], markdown: '# Research', sections: [], sourceRefs: [], unknowns: [], contradictions: [], adaptations: [], avatarRef: { kind: 'unbound' }, voiceRecipe: { kind: 'unreviewed' }, revision: 2, contentHash: 'a'.repeat(64), curationStatus: 'unreviewed', unknownSections: [] });
const source = DossierSourceSchema.parse({ kind: 'catalog-original', characterId: dossier.characterId, revision: dossier.revision, contentHash: dossier.contentHash, fullArchiveHash: 'b'.repeat(64), frozenDossier: dossier });
const continuity = ContinuityContextSchema.parse({ continuityId: 'test-cut', revision: 1, contentHash: 'c'.repeat(64), kind: 'adaptation', label: 'Synthetic', milestones: [], inclusions: [] });
test('source equality covers frozen metadata and re-curation keeps text while removing previous attribution', () => {
 assert.equal(samePreparationSource(source, structuredClone(source)), true);
 assert.equal(samePreparationSource(source, { ...source, frozenDossier: { ...dossier, aliases: ['Changed metadata'] } }), false);
 const form = { ...characterCurationForm(), selfConcept: 'Unsaved text', reason: 'Old attribution', sourceRefs: ['old'], provenanceKind: 'dossier-evidence' as const };
 const changed = recuratingCharacterSource(form);
 assert.equal(changed.selfConcept, form.selfConcept); assert.equal(changed.provenanceKind, 'unselected'); assert.deepEqual(changed.sourceRefs, []); assert.equal(changed.reason, '');
});
test('curation carries the exact frozen source across revisions and rejects same-Markdown metadata replacement', () => {
 const form = { ...characterCurationForm(), selfReference: 'Me', selfConcept: 'Explicit concept', voice: 'Brief', dispositions: 'Patient', goals: [GoalSchema.parse({ goalId: 'test-goal', kind: 'durable', ownerCharacterId: dossier.characterId, desiredOutcome: 'Understand', priority: 0.5, reviewConditions: [], status: 'active', evidenceRefs: [] })], capabilities: [CapabilitySchema.parse({ capabilityId: 'test-speech', kind: 'speech', description: 'Speak' })], noInitialExperiences: true, provenanceKind: 'curator-declaration' as const, reason: 'Synthetic' };
 const input = { form, dossier, continuity, dossierSource: source, uuid: () => '11111111-1111-4111-8111-111111111111', recordedAt: '2026-10-15T00:00:00Z' };
 const prepared = curateCharacter(input); assert.deepEqual(prepared.dossierSource, source);
 const next = curateCharacter({ form, dossier, continuity, existing: prepared, uuid: input.uuid, recordedAt: input.recordedAt }); assert.deepEqual(next.dossierSource, source);
 assert.throws(() => curateCharacter({ ...input, dossier: { ...dossier, aliases: ['Replaced metadata'] } }), /fuente completa/);
});
test('source client validates payloads and preserves opaque pagination cursor', async () => {
 const original = globalThis.fetch; const paths: string[] = [];
 globalThis.fetch = async (path) => { paths.push(String(path)); return new Response(JSON.stringify(String(path).includes('preparation-sources') ? source : { adaptations: [], nextCursor: null }), { status: 200 }); };
 try { assert.deepEqual(await readCatalogPreparationSource('maxwell-smart'), source); await assert.rejects(readAdaptationPreparationSource('11111111-1111-4111-8111-111111111111'), /adaptación solicitada/); await readPreparationAdaptations({ characterId: 'maxwell-smart', cursor: 'opaque+cursor/==' }); assert.equal(new URL(paths[2] ?? '', 'http://localhost').searchParams.get('cursor'), 'opaque+cursor/=='); }
 finally { globalThis.fetch = original; }
});
