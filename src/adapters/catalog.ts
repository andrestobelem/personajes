import { createHash, randomUUID } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { CharacterIdSchema, HashSchema } from '../domain/values.ts';
import {
  AvatarManifestSchema, CatalogDocumentEntrySchema, CatalogManifestSchema,
  DossierAdaptationImportSchema, DossierArchiveSchema, DossierSchema,
  parseDossierMarkdown,
} from '../domain/catalog.ts';
import type {
  AvatarManifest, AvatarProvenance, CatalogDocumentEntry, CatalogManifest,
  Dossier, DossierAdaptationImport,
} from '../domain/catalog.ts';

const MANIFEST_PATH = 'src/adapters/catalog-manifest.json';
const MAX_MANIFEST_BYTES = 2_000_000;
const MAX_TEXT_DOCUMENT_BYTES = 8_000_000;
const MAX_BINARY_DOCUMENT_BYTES = 50_000_000;

const AvatarSlugInputSchema = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/);
const CatalogIdInputSchema = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/);

export const CatalogDocumentReadSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('text-document'),
    entry: CatalogDocumentEntrySchema,
    mimeType: z.enum(['text/markdown', 'text/plain', 'text/csv']),
    text: z.string(),
  }),
  z.strictObject({
    kind: z.literal('binary-document'),
    entry: CatalogDocumentEntrySchema,
    mimeType: z.literal('application/pdf'),
    bytes: z.instanceof(Uint8Array),
  }),
]);
export type CatalogDocumentRead = z.infer<typeof CatalogDocumentReadSchema>;

const AvatarEntrySchema = AvatarManifestSchema.shape.assets.element;
export const CatalogAvatarReadSchema = z.strictObject({
  provenance: AvatarEntrySchema,
  mimeType: z.enum(['image/gif', 'image/webp', 'image/png', 'image/jpeg']),
  bytes: z.instanceof(Uint8Array),
});
export type CatalogAvatarRead = z.infer<typeof CatalogAvatarReadSchema>;

export type LoadedCatalog = {
  readonly repositoryRoot: string;
  readonly manifest: CatalogManifest;
  readonly avatarManifest: AvatarManifest;
};

export const CatalogSearchResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('character-match'),
    id: CharacterIdSchema,
    title: z.string().min(1),
    matchedBy: z.enum(['label', 'markdown-text']),
  }),
  z.strictObject({
    kind: z.literal('document-match'),
    id: CatalogIdInputSchema,
    title: z.string().min(1),
    matchedBy: z.enum(['label', 'markdown-text']),
  }),
]);
export type CatalogSearchResult = z.infer<typeof CatalogSearchResultSchema>;

export function hashDossierMarkdown(markdown: string): z.infer<typeof HashSchema> {
  return HashSchema.parse(createHash('sha256').update(markdown, 'utf8').digest('hex'));
}

function isInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent.length > 0 &&
    pathFromParent !== '..' &&
    !pathFromParent.startsWith('..' + sep) &&
    !isAbsolute(pathFromParent);
}

function parseJsonText(text: string, label: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    throw new Error(label + ' no contiene JSON válido');
  }
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(label + ' no es UTF-8 válido');
  }
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

async function readAllowlistedFile(input: {
  repositoryRoot: string;
  relativePath: string;
  maxBytes: number;
}): Promise<Uint8Array> {
  const relativePath = z.string().min(1).max(500).parse(input.relativePath);
  if (relativePath.includes('\\') || relativePath.startsWith('/') || relativePath.includes('\0')) {
    throw new Error('Ruta de catálogo no permitida');
  }
  const pathSegments = relativePath.split('/');
  if (pathSegments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error('Ruta de catálogo no permitida');
  }
  const root = await realpath(input.repositoryRoot);
  const candidate = resolve(root, ...pathSegments);
  if (!isInside(root, candidate)) throw new Error('La ruta queda fuera del repositorio');
  const canonical = await realpath(candidate);
  if (!isInside(root, canonical)) throw new Error('El archivo resuelve fuera del repositorio');
  const handle = await open(canonical, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error('El elemento del catálogo no es un archivo regular');
    if (metadata.size > input.maxBytes) throw new Error('El archivo del catálogo excede el tamaño permitido');
    const buffer = Buffer.alloc(Math.min(input.maxBytes + 1, Math.max(metadata.size + 1, 1)));
    let totalBytes = 0;
    while (totalBytes < buffer.byteLength) {
      const readResult = await handle.read(buffer, totalBytes, buffer.byteLength - totalBytes, totalBytes);
      if (readResult.bytesRead === 0) break;
      totalBytes += readResult.bytesRead;
    }
    if (totalBytes > input.maxBytes) throw new Error('El archivo del catálogo excede el tamaño permitido');
    return buffer.subarray(0, totalBytes);
  } finally {
    await handle.close();
  }
}

function mapAvatarAssets(manifest: AvatarManifest): Map<string, AvatarProvenance> {
  const assets = new Map<string, AvatarProvenance>();
  for (const asset of manifest.assets) assets.set(asset.slug, asset);
  return assets;
}

function validateAvatarCoverage(manifest: CatalogManifest, avatars: AvatarManifest): void {
  const assetMap = mapAvatarAssets(avatars);
  const allowedSlugs = new Set(manifest.avatars.map((avatar) => avatar.slug));
  if (assetMap.size !== allowedSlugs.size) {
    throw new Error('El manifiesto de avatares y el catálogo tienen coberturas distintas');
  }
  for (const slug of allowedSlugs) {
    if (!assetMap.has(slug)) throw new Error('Falta la procedencia del avatar permitido: ' + slug);
  }
  for (const allowedAvatar of manifest.avatars) {
    const provenance = assetMap.get(allowedAvatar.slug);
    if (provenance === undefined) throw new Error('Falta la procedencia del avatar permitido: ' + allowedAvatar.slug);
    const expectedPath = join(dirname(manifest.avatarManifestPath), provenance.file).split(sep).join('/');
    if (allowedAvatar.path !== expectedPath) {
      throw new Error('El archivo de avatar no coincide con su ruta allowlisted: ' + allowedAvatar.slug);
    }
  }
  for (const character of manifest.characters) {
    const provenance = assetMap.get(character.avatarSlug);
    if (provenance?.kind !== 'character_avatar_reference') {
      throw new Error('El avatar de ' + character.characterId + ' no es una referencia individual');
    }
  }
  const individualCount = avatars.assets.filter((asset) => asset.kind === 'character_avatar_reference').length;
  const groupCount = avatars.assets.filter((asset) => asset.kind === 'group_reference').length;
  if (avatars.counts.individual_characters !== individualCount ||
      avatars.counts.additional_family_references !== groupCount ||
      avatars.counts.missing !== 0) {
    throw new Error('Los contadores de cobertura del manifiesto de avatares no coinciden con sus entradas');
  }
}

export async function loadCatalog(input: { repositoryRoot: unknown }): Promise<LoadedCatalog> {
  const repositoryRootInput = z.string().min(1).max(4_000).parse(input.repositoryRoot);
  const repositoryRoot = await realpath(repositoryRootInput);
  const manifestBytes = await readAllowlistedFile({
    repositoryRoot,
    relativePath: MANIFEST_PATH,
    maxBytes: MAX_MANIFEST_BYTES,
  });
  const manifestText = decodeUtf8(manifestBytes, MANIFEST_PATH);
  const manifest = CatalogManifestSchema.parse(parseJsonText(manifestText, MANIFEST_PATH));
  const avatarManifestBytes = await readAllowlistedFile({
    repositoryRoot,
    relativePath: manifest.avatarManifestPath,
    maxBytes: MAX_MANIFEST_BYTES,
  });
  const avatarManifestText = decodeUtf8(avatarManifestBytes, manifest.avatarManifestPath);
  const avatarManifest = AvatarManifestSchema.parse(parseJsonText(avatarManifestText, manifest.avatarManifestPath));
  validateAvatarCoverage(manifest, avatarManifest);
  deepFreeze(manifest);
  deepFreeze(avatarManifest);
  return Object.freeze({ repositoryRoot, manifest, avatarManifest });
}

export function listCharacters(catalog: LoadedCatalog): CatalogManifest['characters'] {
  return catalog.manifest.characters;
}

export function listLibraryDocuments(catalog: LoadedCatalog): CatalogManifest['documents'] {
  return catalog.manifest.documents;
}

export function listAvatars(catalog: LoadedCatalog): CatalogManifest['avatars'] {
  return catalog.manifest.avatars;
}

function normalizeSearchText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
}

export async function searchCatalog(input: {
  catalog: LoadedCatalog;
  query: unknown;
}): Promise<CatalogSearchResult[]> {
  const query = z.string().trim().min(1).max(200).parse(input.query);
  const normalizedQuery = normalizeSearchText(query);
  const results: CatalogSearchResult[] = [];
  for (const entry of input.catalog.manifest.characters) {
    const labelMatch = normalizeSearchText(entry.displayName).includes(normalizedQuery);
    const dossier = await readDossier({ catalog: input.catalog, characterId: entry.characterId });
    if (labelMatch || normalizeSearchText(dossier.markdown).includes(normalizedQuery)) {
      results.push(CatalogSearchResultSchema.parse({
        kind: 'character-match',
        id: entry.characterId,
        title: entry.displayName,
        matchedBy: labelMatch ? 'label' : 'markdown-text',
      }));
    }
  }
  for (const entry of input.catalog.manifest.documents) {
    const labelMatch = normalizeSearchText(entry.title).includes(normalizedQuery);
    if (labelMatch) {
      results.push(CatalogSearchResultSchema.parse({
        kind: 'document-match',
        id: entry.id,
        title: entry.title,
        matchedBy: 'label',
      }));
      continue;
    }
    const document = await readLibraryDocument({ catalog: input.catalog, documentId: entry.id });
    if (document.kind === 'text-document' && normalizeSearchText(document.text).includes(normalizedQuery)) {
      results.push(CatalogSearchResultSchema.parse({
        kind: 'document-match',
        id: entry.id,
        title: entry.title,
        matchedBy: 'markdown-text',
      }));
    }
  }
  return results;
}

function getAvatar(catalog: LoadedCatalog, slugInput: unknown): AvatarProvenance {
  const slug = AvatarSlugInputSchema.parse(slugInput);
  if (!catalog.manifest.avatars.some((avatar) => avatar.slug === slug)) throw new Error('Avatar fuera del manifiesto: ' + slug);
  const asset = catalog.avatarManifest.assets.find((item) => item.slug === slug);
  if (asset === undefined) throw new Error('Avatar sin procedencia registrada: ' + slug);
  return asset;
}

function findCharacter(catalog: LoadedCatalog, characterIdInput: unknown): CatalogManifest['characters'][number] {
  const characterId = CharacterIdSchema.parse(characterIdInput);
  const character = catalog.manifest.characters.find((item) => item.characterId === characterId);
  if (character === undefined) throw new Error('Personaje fuera del manifiesto: ' + characterId);
  return character;
}

export async function readDossier(input: {
  catalog: LoadedCatalog;
  characterId: unknown;
}): Promise<Dossier> {
  const character = findCharacter(input.catalog, input.characterId);
  const bytes = await readAllowlistedFile({
    repositoryRoot: input.catalog.repositoryRoot,
    relativePath: character.path,
    maxBytes: 2_000_000,
  });
  const markdown = decodeUtf8(bytes, character.path);
  const contentHash = HashSchema.parse(createHash('sha256').update(bytes).digest('hex'));
  if (contentHash !== character.sha256) throw new Error('El dossier no coincide con su hash de catálogo: ' + character.characterId);
  const dossier = parseDossierMarkdown({
    characterId: character.characterId,
    displayName: character.displayName,
    aliases: [],
    performers: [],
    avatarSlug: character.avatarSlug,
    markdown,
    contentHash,
  });
  return DossierSchema.parse(dossier);
}

function documentMimeType(entry: CatalogDocumentEntry): 'text/markdown' | 'text/plain' | 'text/csv' | 'application/pdf' {
  const extension = entry.path.slice(entry.path.lastIndexOf('.') + 1).toLowerCase();
  if (extension === 'md') return 'text/markdown';
  if (extension === 'txt' || extension === 'bib') return 'text/plain';
  if (extension === 'csv') return 'text/csv';
  if (extension === 'pdf' && entry.kind === 'paper') return 'application/pdf';
  throw new Error('MIME no permitido para el documento del catálogo: ' + entry.id);
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  return decodeUtf8(bytes.slice(0, Math.min(8, bytes.byteLength)), 'PDF').startsWith('%PDF-');
}

export async function readLibraryDocument(input: {
  catalog: LoadedCatalog;
  documentId: unknown;
}): Promise<CatalogDocumentRead> {
  const documentId = CatalogIdInputSchema.parse(input.documentId);
  const entry = input.catalog.manifest.documents.find((item) => item.id === documentId);
  if (entry === undefined) throw new Error('Documento fuera del manifiesto: ' + documentId);
  const mimeType = documentMimeType(entry);
  const bytes = await readAllowlistedFile({
    repositoryRoot: input.catalog.repositoryRoot,
    relativePath: entry.path,
    maxBytes: mimeType === 'application/pdf' ? MAX_BINARY_DOCUMENT_BYTES : MAX_TEXT_DOCUMENT_BYTES,
  });
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  if (contentHash !== entry.sha256) throw new Error('El documento no coincide con su hash de catálogo: ' + entry.id);
  if (mimeType === 'application/pdf') {
    if (!hasPdfHeader(bytes)) throw new Error('El documento no tiene una cabecera PDF válida: ' + entry.id);
    return CatalogDocumentReadSchema.parse({ kind: 'binary-document', entry, mimeType, bytes });
  }
  const text = decodeUtf8(bytes, entry.path);
  if (text.includes('\0')) throw new Error('Documento de texto con NUL: ' + entry.id);
  return CatalogDocumentReadSchema.parse({ kind: 'text-document', entry, mimeType, text });
}

function imageBytesMatchMime(bytes: Uint8Array, mimeType: AvatarProvenance['mime_type']): boolean {
  if (mimeType === 'image/gif') {
    const signature = decodeUtf8(bytes.slice(0, Math.min(6, bytes.byteLength)), 'GIF');
    return signature === 'GIF87a' || signature === 'GIF89a';
  }
  if (mimeType === 'image/webp') {
    return bytes.byteLength >= 12 &&
      decodeUtf8(bytes.slice(0, 4), 'WebP') === 'RIFF' &&
      decodeUtf8(bytes.slice(8, 12), 'WebP') === 'WEBP';
  }
  if (mimeType === 'image/png') {
    return bytes.byteLength >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export async function readAvatar(input: {
  catalog: LoadedCatalog;
  slug: unknown;
}): Promise<CatalogAvatarRead> {
  const provenance = getAvatar(input.catalog, input.slug);
  if (provenance.file.includes('/') || provenance.file.includes('\\') || provenance.file === '.' || provenance.file === '..') {
    throw new Error('Nombre de archivo de avatar inválido: ' + provenance.slug);
  }
  const allowlistedAvatar = input.catalog.manifest.avatars.find((avatar) => avatar.slug === provenance.slug);
  if (allowlistedAvatar === undefined) throw new Error('Avatar fuera del manifiesto: ' + provenance.slug);
  const bytes = await readAllowlistedFile({
    repositoryRoot: input.catalog.repositoryRoot,
    relativePath: allowlistedAvatar.path,
    maxBytes: Math.min(provenance.bytes + 1, MAX_BINARY_DOCUMENT_BYTES),
  });
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  if (contentHash !== provenance.sha256 || bytes.byteLength !== provenance.bytes) {
    throw new Error('El avatar no coincide con el hash/procedencia registrados: ' + provenance.slug);
  }
  if (!imageBytesMatchMime(bytes, provenance.mime_type)) {
    throw new Error('Los bytes del avatar no coinciden con su MIME: ' + provenance.slug);
  }
  return CatalogAvatarReadSchema.parse({ provenance, mimeType: provenance.mime_type, bytes });
}

function assertDossierIntegrity(dossier: Dossier): void {
  if (hashDossierMarkdown(dossier.markdown) !== dossier.contentHash) {
    throw new Error('El hash del dossier no coincide con el Markdown íntegro');
  }
  const reconstructed = parseDossierMarkdown({
    characterId: dossier.characterId,
    displayName: dossier.displayName,
    aliases: dossier.aliases,
    performers: dossier.performers,
    avatarSlug: dossier.avatarRef.kind === 'catalog-reference' ? dossier.avatarRef.slug : undefined,
    markdown: dossier.markdown,
    contentHash: dossier.contentHash,
  });
  const sameSections = JSON.stringify(reconstructed.sections) === JSON.stringify(dossier.sections) &&
    JSON.stringify(reconstructed.unknownSections) === JSON.stringify(dossier.unknownSections);
  if (!sameSections) throw new Error('Las secciones exportadas no corresponden al Markdown conservado');
}

export function exportDossier(input: unknown): string {
  const dossier = DossierSchema.parse(input);
  assertDossierIntegrity(dossier);
  const archive = DossierArchiveSchema.parse({
    format: 'personajes-dossier',
    archiveVersion: 1,
    dossier,
  });
  return JSON.stringify(archive);
}

export function importDossier(input: unknown): DossierAdaptationImport {
  const rawArchive = typeof input === 'string' ? parseJsonText(input, 'Archivo de dossier') : input;
  const archive = DossierArchiveSchema.parse(rawArchive);
  const dossier = DossierSchema.parse(archive.dossier);
  assertDossierIntegrity(dossier);
  if (dossier.revision >= Number.MAX_SAFE_INTEGER) throw new Error('No se puede incrementar la revisión del dossier');
  const adaptationId = randomUUID();
  const createdAt = new Date().toISOString();
  const importedDossier = DossierSchema.parse({
    ...dossier,
    revision: dossier.revision + 1,
    adaptations: [
      ...dossier.adaptations,
      {
        adaptationId,
        basedOnHash: dossier.contentHash,
        reason: 'Importación versionada; requiere revisión de procedencia y diferencias',
        createdAt,
      },
    ],
  });
  return DossierAdaptationImportSchema.parse({
    kind: 'new-adaptation',
    adaptationId,
    createdAt,
    characterId: importedDossier.characterId,
    baseRevision: dossier.revision,
    baseHash: dossier.contentHash,
    importedDossier,
    reviewRequired: true,
  });
}
