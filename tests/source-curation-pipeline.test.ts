import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { exportDossier, hashDossierMarkdown } from '../src/adapters/catalog.ts';
import { createEmptyPreparationDraft, prepareCharacter } from '../src/application/prepare-character.ts';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import { parseDossierMarkdown } from '../src/domain/catalog.ts';
import { DossierSourceSchema } from '../src/domain/dossier-source.ts';
import { PreparationDraftSchema } from '../src/domain/preparation.ts';
import { draftFixture } from './fixtures/continuista.ts';

function fixture() {
  const result = validateRunConfiguration({ draft: draftFixture() });
  assert.equal(result.kind, 'ready');
  if (result.kind !== 'ready') assert.fail();
  const actor = result.configuration.roster.preparedCharacters[0];
  assert.ok(actor);
  const markdown = '# Synthetic dossier\n';
  const dossier = parseDossierMarkdown({ characterId: actor.characterId, displayName: 'Synthetic', markdown, contentHash: hashDossierMarkdown(markdown) });
  const source = DossierSourceSchema.parse({ kind: 'catalog-original', characterId: dossier.characterId, revision: dossier.revision, contentHash: dossier.contentHash, fullArchiveHash: createHash('sha256').update(exportDossier(dossier)).digest('hex'), frozenDossier: dossier });
  const empty = createEmptyPreparationDraft({ characterId: actor.characterId, dossierRevision: dossier.revision, dossierHash: dossier.contentHash, dossierSource: source, continuity: actor.continuity, identityVersion: actor.identityVersion });
  const declared = <T extends { provenance: { dossierRevision: number; dossierHash: string } }>(value: T) => ({ kind: 'declared', value: { ...value, provenance: { ...value.provenance, dossierRevision: dossier.revision, dossierHash: dossier.contentHash } } });
  const draft = PreparationDraftSchema.parse({ ...empty, identity: declared(actor.identity), voice: declared(actor.voice), antecedents: declared(actor.antecedents), goals: declared(actor.goals), relationships: declared(actor.relationships), capabilities: declared(actor.capabilities), inventory: declared(actor.inventory), initialExperience: declared(actor.initialExperience), unknownPolicy: declared(actor.unknownPolicy) });
  return { source, dossier, draft };
}

test('curation preserves the exact pinned dossier through empty draft and preparation', () => {
  const { source, dossier, draft } = fixture();
  assert.deepEqual(draft.dossierSource, source);
  const result = prepareCharacter({ draft, dossier });
  assert.equal(result.kind, 'prepared');
  if (result.kind !== 'prepared') assert.fail();
  assert.deepEqual(result.character.dossierSource, source);
});

test('curation rejects changed metadata despite identical Markdown hash and revision', () => {
  const { dossier, draft } = fixture();
  for (const changed of [{ ...dossier, aliases: ['Different alias'] }, { ...dossier, performers: ['Different performer'] }, { ...dossier, unknowns: ['Unadmitted uncertainty'] }]) {
    assert.equal(changed.revision, draft.dossierRevision);
    assert.equal(changed.contentHash, draft.dossierHash);
    const result = prepareCharacter({ draft, dossier: changed });
    assert.equal(result.kind, 'invalid');
    if (result.kind !== 'invalid') assert.fail();
    assert.ok(result.issues.some(issue => issue.code === 'dossier-snapshot-mismatch'));
  }
});

test('legacy preparation preserves absence rather than reconstructing a source', () => {
  const { dossier, draft } = fixture();
  const { dossierSource: _source, ...legacy } = draft;
  const empty = createEmptyPreparationDraft({ characterId: legacy.characterId, dossierRevision: legacy.dossierRevision, dossierHash: legacy.dossierHash, continuity: legacy.continuity, identityVersion: legacy.identityVersion });
  assert.equal('dossierSource' in empty, false);
  const result = prepareCharacter({ draft: legacy, dossier });
  assert.equal(result.kind, 'prepared');
  if (result.kind !== 'prepared') assert.fail();
  assert.equal('dossierSource' in result.character, false);
});
