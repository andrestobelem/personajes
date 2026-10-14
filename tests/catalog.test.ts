import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CatalogManifestSchema, parseDossierMarkdown,
} from '../src/domain/catalog.ts';
import {
  exportDossier, hashDossierMarkdown, importDossier, listAvatars, listCharacters,
  listLibraryDocuments, loadCatalog, readAvatar, readDossier, readLibraryDocument,
  searchCatalog,
} from '../src/adapters/catalog.ts';

const repositoryRoot = process.cwd();

test('el manifiesto real enumera identidades, documentos y avatares separados', async () => {
  const catalog = await loadCatalog({ repositoryRoot });
  const characters = listCharacters(catalog);
  const documents = listLibraryDocuments(catalog);
  assert.equal(characters.length, 27);
  assert.equal(characters.some((entry) => entry.characterId === 'familia-smart'), false);
  assert.equal(documents.find((entry) => entry.kind === 'family')?.id, 'familia-smart');
  assert.equal(documents.find((entry) => entry.kind === 'appendix')?.id, 'arcos-multipartes');
  assert.equal(documents.filter((entry) => entry.kind === 'research').length, 16);
  assert.equal(listAvatars(catalog).length, 28);
  assert.equal(catalog.avatarManifest.assets.filter((asset) => asset.kind === 'character_avatar_reference').length, 27);
  assert.equal(catalog.avatarManifest.assets.filter((asset) => asset.kind === 'group_reference').length, 1);
  const firstCharacter = characters[0];
  assert.ok(firstCharacter);
  assert.equal(Reflect.set(firstCharacter, 'path', '../outside.md'), false);
});

test('todos los dossiers individuales conservan Markdown y estado no curado', async () => {
  const catalog = await loadCatalog({ repositoryRoot });
  for (const entry of listCharacters(catalog)) {
    const dossier = await readDossier({ catalog, characterId: entry.characterId });
    const diskText = await readFile(join(repositoryRoot, entry.path), 'utf8');
    assert.equal(dossier.characterId, entry.characterId);
    assert.equal(dossier.markdown, diskText);
    assert.equal(dossier.curationStatus, 'unreviewed');
    assert.deepEqual(dossier.sourceRefs, []);
    assert.equal(dossier.contentHash.length, 64);
    assert.ok(dossier.sections.length > 0);
  }
});

test('todos los documentos registrados se leen con MIME permitido y forma correcta', async () => {
  const catalog = await loadCatalog({ repositoryRoot });
  for (const entry of listLibraryDocuments(catalog)) {
    const document = await readLibraryDocument({ catalog, documentId: entry.id });
    assert.equal(document.entry.path, entry.path);
    if (document.kind === 'text-document') {
      assert.ok(document.text.length > 0);
      assert.notEqual(document.mimeType, 'application/pdf');
    } else {
      assert.equal(document.kind, 'binary-document');
      assert.equal(document.mimeType, 'application/pdf');
      assert.ok(document.bytes.byteLength > 0);
    }
  }
});

test('las 28 referencias visuales conservan procedencia, bytes, hash y MIME', async () => {
  const catalog = await loadCatalog({ repositoryRoot });
  for (const entry of listAvatars(catalog)) {
    const avatar = await readAvatar({ catalog, slug: entry.slug });
    assert.equal(avatar.provenance.slug, entry.slug);
    assert.equal(avatar.bytes.byteLength, avatar.provenance.bytes);
    assert.equal(avatar.mimeType, avatar.provenance.mime_type);
    assert.equal(avatar.provenance.visual_verified, true);
  }
  const family = await readAvatar({ catalog, slug: 'familia-smart' });
  assert.equal(family.provenance.kind, 'group_reference');
  assert.match(family.provenance.license, /no verificada/i);
});

test('el schema acepta ampliaciones del catálogo sin límite codificado de 27', async () => {
  const catalog = await loadCatalog({ repositoryRoot });
  const firstCharacter = catalog.manifest.characters[0];
  assert.ok(firstCharacter);
  const extended = CatalogManifestSchema.parse({
    ...catalog.manifest,
    characters: [
      ...catalog.manifest.characters,
      { ...firstCharacter, characterId: 'personaje-futuro', displayName: 'Personaje futuro', path: 'docs/personajes/get-smart/personaje-futuro.md', avatarSlug: 'personaje-futuro' },
    ],
    avatars: [
      ...catalog.manifest.avatars,
      { slug: 'personaje-futuro', path: 'docs/assets/avatars/get-smart/personaje-futuro.webp' },
    ],
  });
  assert.equal(extended.characters.length, 28);
});

test('parser conserva secciones desconocidas y no declara el contenido como canon', () => {
  const fence = '\u0060'.repeat(3);
  const fakeHeading = fence + 'md\r\n## Esto sigue siendo código\r\n' + fence + '\r\n';
  const markdown = '# Ficha\r\n\r\n## Identidad\r\nTexto de fuente.\r\n\r\n## Sección futura\r\nNo ejecutar: <script>globalThis.__catalogTest = true</script>\r\n' + fakeHeading;
  const dossier = parseDossierMarkdown({
    characterId: 'maxwell-smart',
    displayName: 'Maxwell Smart',
    markdown,
    contentHash: hashDossierMarkdown(markdown),
  });
  assert.equal(dossier.markdown, markdown);
  assert.equal(dossier.curationStatus, 'unreviewed');
  assert.deepEqual(dossier.sourceRefs, []);
  assert.equal(dossier.sections.at(-1)?.kind, 'unknown');
  assert.equal(dossier.unknownSections[0]?.markdown, '## Sección futura\r\nNo ejecutar: <script>globalThis.__catalogTest = true</script>\r\n' + fakeHeading);
  assert.match(dossier.markdown, /<script>globalThis\.__catalogTest = true<\/script>/);
  assert.equal(Reflect.get(globalThis, '__catalogTest'), undefined);
});

test('export/import hace roundtrip íntegro y crea una adaptación revisable sin escribir el original', async () => {
  const catalog = await loadCatalog({ repositoryRoot });
  const original = await readDossier({ catalog, characterId: 'fang' });
  const archive = exportDossier(original);
  const imported = importDossier(archive);
  assert.equal(imported.kind, 'new-adaptation');
  assert.equal(imported.reviewRequired, true);
  assert.equal(imported.characterId, original.characterId);
  assert.equal(imported.baseRevision, original.revision);
  assert.equal(imported.importedDossier.revision, original.revision + 1);
  assert.equal(imported.importedDossier.markdown, original.markdown);
  assert.deepEqual(imported.importedDossier.unknownSections, original.unknownSections);
  assert.notEqual(imported.adaptationId, original.adaptations[0]?.adaptationId);
  assert.equal((await readDossier({ catalog, characterId: 'fang' })).markdown, original.markdown);
  assert.throws(() => importDossier({ format: 'personajes-dossier', archiveVersion: 2, dossier: original }));
  assert.throws(() => exportDossier({ ...original, contentHash: '0'.repeat(64) }));
});

test('rechaza traversal en manifiesto antes de resolver archivos', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-traversal-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src/adapters'), { recursive: true });
  const catalog = await loadCatalog({ repositoryRoot });
  const first = catalog.manifest.characters[0];
  assert.ok(first);
  const invalid = {
    ...catalog.manifest,
    characters: catalog.manifest.characters.map((entry, index) =>
      index === 0 ? { ...entry, path: '../fuera.md' } : entry),
  };
  await writeFile(join(root, 'src/adapters/catalog-manifest.json'), JSON.stringify(invalid));
  assert.throws(() => CatalogManifestSchema.parse(invalid));
  await assert.rejects(loadCatalog({ repositoryRoot: root }));
});

test('realpath rechaza un dossier allowlisted cuyo symlink apunta fuera del repositorio', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-symlink-'));
  const outsideRoot = await mkdtemp(join(tmpdir(), 'catalog-outside-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  });
  const catalog = await loadCatalog({ repositoryRoot });
  const maxwell = catalog.manifest.characters[0];
  assert.ok(maxwell);
  const avatarManifestPath = join(root, catalog.manifest.avatarManifestPath);
  await mkdir(join(root, 'src/adapters'), { recursive: true });
  await mkdir(join(root, 'docs/personajes/get-smart'), { recursive: true });
  await mkdir(join(avatarManifestPath, '..'), { recursive: true });
  await writeFile(join(root, 'src/adapters/catalog-manifest.json'), JSON.stringify(catalog.manifest));
  await writeFile(avatarManifestPath, JSON.stringify(catalog.avatarManifest));
  const outsideFile = join(outsideRoot, 'private.md');
  await writeFile(outsideFile, 'contenido externo');
  await symlink(outsideFile, join(root, maxwell.path));
  const isolatedCatalog = await loadCatalog({ repositoryRoot: root });
  await assert.rejects(readDossier({ catalog: isolatedCatalog, characterId: maxwell.characterId }), /resuelve fuera del repositorio/);
});

test('el adapter comprueba tamaño antes de cargar un dossier grande', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-size-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const catalog = await loadCatalog({ repositoryRoot });
  const maxwell = catalog.manifest.characters[0];
  assert.ok(maxwell);
  const avatarManifestPath = join(root, catalog.manifest.avatarManifestPath);
  await mkdir(join(root, 'src/adapters'), { recursive: true });
  await mkdir(join(root, 'docs/personajes/get-smart'), { recursive: true });
  await mkdir(join(avatarManifestPath, '..'), { recursive: true });
  await writeFile(join(root, 'src/adapters/catalog-manifest.json'), JSON.stringify(catalog.manifest));
  await writeFile(avatarManifestPath, JSON.stringify(catalog.avatarManifest));
  await writeFile(join(root, maxwell.path), Buffer.alloc(2_000_001, 65));
  const isolatedCatalog = await loadCatalog({ repositoryRoot: root });
  await assert.rejects(readDossier({ catalog: isolatedCatalog, characterId: maxwell.characterId }), /excede el tamaño permitido/);
});

test('IDs fuera del manifiesto y contenido de rutas arbitrarias se rechazan', async () => {
  const catalog = await loadCatalog({ repositoryRoot });
  await assert.rejects(readDossier({ catalog, characterId: 'un-actor-nuevo' }), /fuera del manifiesto/);
  await assert.rejects(readLibraryDocument({ catalog, documentId: 'etc-passwd' }), /fuera del manifiesto/);
  await assert.rejects(readAvatar({ catalog, slug: '../familia-smart' }));
});

test('la búsqueda encuentra alias textual en el corpus sin convertirlo en dato canónico', async () => {
  const catalog = await loadCatalog({ repositoryRoot });
  const matches = await searchCatalog({ catalog, query: 'Agente 86' });
  const maxwell = matches.find((match) => match.kind === 'character-match' && match.id === 'maxwell-smart');
  assert.ok(maxwell);
  assert.equal(maxwell.matchedBy, 'markdown-text');
});
