import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportDossier, loadCatalog, readDossier } from '../src/adapters/catalog.ts';
import { openDossierExchange } from '../src/application/dossier-exchange.ts';
import { createDossierSourceRepository, freezeCatalogDossierSource, validateFrozenDossierSource } from '../src/application/dossier-source-repository.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

test('source resolution checks exact materialized metadata and operator ownership, then remains self-contained', async () => {
  const original = await readDossier({ catalog: await loadCatalog({ repositoryRoot: process.cwd() }), characterId: 'maxwell-smart' });
  const root = mkdtempSync(join(tmpdir(), 'personajes-source-'));
  const exchange = openDossierExchange({ journalPath: join(root, 'world.sqlite'), getDossier: () => original });
  try {
    const incoming = { ...original, aliases: [...original.aliases, 'Variante sintética sin cambiar Markdown'] };
    const imported = exchange.quarantine('owner', randomUUID(), { kind: 'dossier', fileName: 'source.json', contentBase64: Buffer.from(exportDossier(incoming)).toString('base64') });
    const preview = exchange.preview('owner', imported.importId);
    const adaptation = exchange.apply('owner', { previewToken: preview.previewToken, confirmDiffHash: preview.diffHash });
    const saved = exchange.readAdaptation({ principalId: 'owner', adaptationId: adaptation.adaptationId });
    const reference = { kind: 'saved-adaptation', characterId: saved.characterId, revision: saved.revision,
      contentHash: saved.contentHash, fullArchiveHash: saved.archiveHash, importId: saved.importId, adaptationId: saved.adaptationId };
    const repository = createDossierSourceRepository({ adaptations: exchange, readCatalogDossier() { throw new Error('Must not consult current catalog'); } });
    const source = await repository.resolveSelection({ principalId: 'owner', reference });
    assert.equal(source.kind, 'saved-adaptation'); assert.deepEqual(source.frozenDossier, adaptation.importedDossier);
    await assert.rejects(repository.resolveSelection({ principalId: 'foreign', reference }), /NOT_FOUND/);
    await assert.rejects(repository.resolveSelection({ principalId: 'owner', reference: { ...reference, fullArchiveHash: hash(exportDossier(original)) } }), /SELECTION_CHANGED/);
    const transferred = JSON.parse(JSON.stringify(source));
    assert.deepEqual(validateFrozenDossierSource(transferred), source);
    const changed = { ...source, frozenDossier: { ...source.frozenDossier, unknowns: [...source.frozenDossier.unknowns, 'metadata tampered'] } };
    assert.throws(() => validateFrozenDossierSource(changed), /HASH_MISMATCH/);
    assert.throws(() => validateFrozenDossierSource({ ...changed, fullArchiveHash: hash(exportDossier(changed.frozenDossier)) }), /LINEAGE_MISMATCH/);
    assert.equal(source.frozenDossier.contentHash, original.contentHash);
  } finally { exchange.close(); rmSync(root, { recursive: true, force: true }); }
});

test('catalog selection rejects metadata changes even when revision and Markdown hash match', async () => {
  const original = await readDossier({ catalog: await loadCatalog({ repositoryRoot: process.cwd() }), characterId: 'maxwell-smart' });
  const frozen = freezeCatalogDossierSource(original);
  const { frozenDossier, ...reference } = frozen;
  const repository = createDossierSourceRepository({ readCatalogDossier: () => ({ ...original, aliases: [...original.aliases, 'Changed catalog metadata'] }), adaptations: { readSavedAdaptation() { throw new Error('No adaptation lookup'); } } });
  await assert.rejects(repository.resolveSelection({ principalId: 'owner', reference }), /SELECTION_CHANGED/);
  assert.deepEqual(validateFrozenDossierSource(frozen).frozenDossier, frozenDossier);
});
