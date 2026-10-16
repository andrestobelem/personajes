import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RevisionSchema } from '../src/domain/values.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportDossier, loadCatalog, readDossier } from '../src/adapters/catalog.ts';
import { openDossierExchange } from '../src/application/dossier-exchange.ts';
import { loadPreparationConfiguratorSources } from '../src/application/preparation-configurator-sources.ts';
import { PreparationConfiguratorRequestSchema } from '../src/domain/preparation-configurator.ts';
import { createEmptyRunConfigurationDraft } from '../src/domain/production.ts';
import { sha256CanonicalJson, sha256Utf8 } from '../src/domain/canonical-json.ts';

test('host manifest freezes exact sources; forged revisions, documents and mutated choices cannot become admitted inputs', async () => {
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  const sources = await loadPreparationConfiguratorSources({ catalog, adaptations: { readSavedAdaptation() { throw new Error('NOT_USED'); } } });
  const choices = sources.choices();
  const actor = choices.actors.find(value => value.reference.characterId === 'maxwell-smart');
  const document = choices.documents[0];
  assert.ok(actor); assert.ok(document);
  const draft = createEmptyRunConfigurationDraft({ runId: randomUUID(), revision: 0 });
  const request = PreparationConfiguratorRequestSchema.parse({ kind: 'preparation-configurator-request', schemaVersion: 1,
    runId: draft.runId, draftRevision: 0, draftHash: sha256CanonicalJson(draft), jobId: randomUUID(), generation: 0,
    instructions: 'Proponer una puesta; no confirmar ni actuar.', actorSources: [actor.reference], documentIds: [document.sourceId] });
  const resolved = sources.resolve({ principalId: 'owner', request, draft });
  const selectedDocument = resolved.documents[0]; assert.ok(selectedDocument);
  assert.equal(sha256Utf8(selectedDocument.text), document.fullHash);
  assert.equal(resolved.actorSources[0]?.fullArchiveHash, actor.reference.fullArchiveHash);
  const before = sha256CanonicalJson(resolved);
  resolved.actorSources[0]?.frozenDossier.unknowns.push('Mutation outside host cache');
  if (resolved.documents[0]) resolved.documents[0].text = 'Mutation outside host cache';
  assert.equal(sha256CanonicalJson(sources.resolve({ principalId: 'owner', request, draft })), before);
  actor.reference.revision = RevisionSchema.parse(actor.reference.revision + 1);
  assert.throws(() => sources.resolve({ principalId: 'owner', request: { ...request, actorSources: [actor.reference] }, draft }), /SOURCE_CHANGED/);
  assert.equal(sources.choices().actors.find(value => value.reference.characterId === 'maxwell-smart')?.reference.revision, request.actorSources[0]?.revision);
  assert.throws(() => sources.resolve({ principalId: 'owner', request: PreparationConfiguratorRequestSchema.parse({ ...request, documentIds: ['../../outside.md'] }), draft }), /DOCUMENT_UNAVAILABLE/);
  assert.throws(() => sources.resolve({ principalId: 'owner', request: PreparationConfiguratorRequestSchema.parse({ ...request, documentIds: [...choices.unavailableDocumentIds.slice(0, 1), 'nonexistent-source'] }), draft }), /DOCUMENT_UNAVAILABLE/);
});

test('saved adaptation selection requires the owning principal and its full materialized lineage', async () => {
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  const original = await readDossier({ catalog, characterId: 'maxwell-smart' });
  const directory = mkdtempSync(join(tmpdir(), 'personajes-preparation-sources-'));
  const exchange = openDossierExchange({ journalPath: join(directory, 'world.sqlite'), getDossier: () => original });
  try {
    const incoming = { ...original, aliases: [...original.aliases, 'Synthetic adaptation'] };
    const quarantined = exchange.quarantine('owner', randomUUID(), { kind: 'dossier', fileName: 'source.json', contentBase64: Buffer.from(exportDossier(incoming)).toString('base64') });
    const preview = exchange.preview('owner', quarantined.importId);
    const applied = exchange.apply('owner', { previewToken: preview.previewToken, confirmDiffHash: preview.diffHash });
    const saved = exchange.readAdaptation({ principalId: 'owner', adaptationId: applied.adaptationId });
    const sources = await loadPreparationConfiguratorSources({ catalog, adaptations: exchange });
    const draft = createEmptyRunConfigurationDraft({ runId: randomUUID(), revision: 0 });
    const request = PreparationConfiguratorRequestSchema.parse({ kind: 'preparation-configurator-request', schemaVersion: 1,
      runId: draft.runId, draftRevision: 0, draftHash: sha256CanonicalJson(draft), jobId: randomUUID(), generation: 0,
      instructions: 'Proponer sin aplicar.', documentIds: [], actorSources: [{ kind: 'saved-adaptation', characterId: saved.characterId,
        revision: saved.revision, contentHash: saved.contentHash, fullArchiveHash: saved.archiveHash, importId: saved.importId, adaptationId: saved.adaptationId }] });
    assert.deepEqual(sources.resolve({ principalId: 'owner', request, draft }).actorSources[0]?.frozenDossier, applied.importedDossier);
    assert.throws(() => sources.resolve({ principalId: 'foreign', request, draft }), /NOT_FOUND/);
    assert.throws(() => sources.resolve({ principalId: 'owner', request: PreparationConfiguratorRequestSchema.parse({ ...request, actorSources: request.actorSources.map(value => ({ ...value, fullArchiveHash: '0'.repeat(64) })) }), draft }), /SOURCE_CHANGED/);
  } finally { exchange.close(); rmSync(directory, { recursive: true, force: true }); }
});
