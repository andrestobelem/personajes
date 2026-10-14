import { z } from 'zod';
import { CharacterIdSchema, HashSchema } from './values.ts';

const RelativeCatalogPathSchema = z.string().min(1).max(500).refine((value) => {
  if (value.includes('\\') || value.startsWith('/') || value.includes('\0')) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes(':'));
}, 'La ruta del manifiesto debe ser relativa y no contener traversal');

const SlugSchema = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/);

export const CatalogCharacterEntrySchema = z.strictObject({
  characterId: CharacterIdSchema,
  displayName: z.string().min(1).max(200),
  path: RelativeCatalogPathSchema,
  sha256: HashSchema,
  avatarSlug: SlugSchema,
});
export type CatalogCharacterEntry = z.infer<typeof CatalogCharacterEntrySchema>;

export const CatalogDocumentKindSchema = z.enum([
  'index', 'family', 'appendix', 'cross-character', 'avatar-provenance', 'research',
  'paper', 'bibliography', 'source', 'source-index', 'external-material-inventory',
]);

export const CatalogDocumentEntrySchema = z.strictObject({
  id: SlugSchema,
  title: z.string().min(1).max(300),
  kind: CatalogDocumentKindSchema,
  path: RelativeCatalogPathSchema,
  sha256: HashSchema,
});
export type CatalogDocumentEntry = z.infer<typeof CatalogDocumentEntrySchema>;

export const CatalogAvatarEntrySchema = z.strictObject({
  slug: SlugSchema,
  path: RelativeCatalogPathSchema,
});
export type CatalogAvatarEntry = z.infer<typeof CatalogAvatarEntrySchema>;

export const CatalogManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  catalogVersion: z.string().min(1).max(120),
  characters: z.array(CatalogCharacterEntrySchema).min(1),
  documents: z.array(CatalogDocumentEntrySchema),
  avatarManifestPath: RelativeCatalogPathSchema,
  avatars: z.array(CatalogAvatarEntrySchema).min(1),
}).superRefine((manifest, context) => {
  const characterIds = new Set<string>();
  const characterPaths = new Set<string>();
  for (const [index, entry] of manifest.characters.entries()) {
    if (characterIds.has(entry.characterId)) {
      context.addIssue({ code: 'custom', path: ['characters', index, 'characterId'], message: 'characterId duplicado' });
    }
    if (characterPaths.has(entry.path)) {
      context.addIssue({ code: 'custom', path: ['characters', index, 'path'], message: 'ruta de dossier duplicada' });
    }
    characterIds.add(entry.characterId);
    characterPaths.add(entry.path);
  }
  const documentIds = new Set<string>();
  const documentPaths = new Set<string>();
  for (const [index, entry] of manifest.documents.entries()) {
    if (documentIds.has(entry.id)) {
      context.addIssue({ code: 'custom', path: ['documents', index, 'id'], message: 'id de documento duplicado' });
    }
    if (documentPaths.has(entry.path) || characterPaths.has(entry.path)) {
      context.addIssue({ code: 'custom', path: ['documents', index, 'path'], message: 'ruta de corpus duplicada' });
    }
    documentIds.add(entry.id);
    documentPaths.add(entry.path);
  }
  const avatarSlugs = new Set<string>();
  const avatarPaths = new Set<string>();
  for (const [index, avatar] of manifest.avatars.entries()) {
    if (avatarSlugs.has(avatar.slug)) {
      context.addIssue({ code: 'custom', path: ['avatars', index, 'slug'], message: 'avatar slug duplicado' });
    }
    if (avatarPaths.has(avatar.path)) {
      context.addIssue({ code: 'custom', path: ['avatars', index, 'path'], message: 'ruta de avatar duplicada' });
    }
    avatarSlugs.add(avatar.slug);
    avatarPaths.add(avatar.path);
  }
  for (const [index, entry] of manifest.characters.entries()) {
    if (!avatarSlugs.has(entry.avatarSlug)) {
      context.addIssue({ code: 'custom', path: ['characters', index, 'avatarSlug'], message: 'avatar no permitido por el manifiesto' });
    }
    if (entry.characterId !== entry.avatarSlug) {
      context.addIssue({ code: 'custom', path: ['characters', index, 'avatarSlug'], message: 'el avatar individual debe usar el mismo identificador de identidad' });
    }
  }
});
export type CatalogManifest = z.infer<typeof CatalogManifestSchema>;

export const DossierSectionKindSchema = z.enum([
  'preamble', 'identity', 'biography', 'relationships', 'memories', 'voice', 'goals',
  'capabilities', 'sources', 'unknowns', 'contradictions', 'adaptations', 'appearances',
  'continuity', 'other', 'unknown',
]);

export const DossierSectionSchema = z.strictObject({
  heading: z.string().max(500),
  depth: z.number().int().min(0).max(6),
  kind: DossierSectionKindSchema,
  markdown: z.string(),
});
export type DossierSection = z.infer<typeof DossierSectionSchema>;

export const SourceKindSchema = z.enum([
  'documentary', 'canon', 'testimony', 'inference', 'adaptation', 'unknown',
]);
export const SourceRefSchema = z.strictObject({
  id: z.string().min(1).max(120),
  kind: SourceKindSchema,
  reference: z.string().min(1).max(4_000),
  scope: z.string().min(1).max(2_000),
  uncertainty: z.string().min(1).max(2_000),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const DossierVoiceRecipeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unreviewed') }),
  z.strictObject({ kind: z.literal('reviewed'), recipe: z.string().min(1).max(20_000), sourceRefs: z.array(z.string().min(1).max(120)) }),
]);

export const DossierAvatarReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unbound') }),
  z.strictObject({ kind: z.literal('catalog-reference'), slug: SlugSchema }),
]);

export const DossierAdaptationSchema = z.strictObject({
  adaptationId: z.string().uuid(),
  basedOnHash: HashSchema,
  reason: z.string().min(1).max(4_000),
  createdAt: z.string().datetime({ offset: true }),
});

export const DossierSchema = z.strictObject({
  schemaVersion: z.literal(1),
  characterId: CharacterIdSchema,
  displayName: z.string().min(1).max(200),
  aliases: z.array(z.string().min(1).max(200)).max(200),
  performers: z.array(z.string().min(1).max(300)).max(200),
  markdown: z.string().max(2_000_000),
  sections: z.array(DossierSectionSchema).max(10_000),
  sourceRefs: z.array(SourceRefSchema).max(20_000),
  unknowns: z.array(z.string().max(4_000)).max(20_000),
  contradictions: z.array(z.string().max(4_000)).max(20_000),
  adaptations: z.array(DossierAdaptationSchema).max(20_000),
  avatarRef: DossierAvatarReferenceSchema,
  voiceRecipe: DossierVoiceRecipeSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  contentHash: HashSchema,
  curationStatus: z.literal('unreviewed'),
  unknownSections: z.array(DossierSectionSchema).max(10_000),
});
export type Dossier = z.infer<typeof DossierSchema>;

export const DossierArchiveSchema = z.strictObject({
  format: z.literal('personajes-dossier'),
  archiveVersion: z.literal(1),
  dossier: DossierSchema,
});
export type DossierArchive = z.infer<typeof DossierArchiveSchema>;

export const DossierAdaptationImportSchema = z.strictObject({
  kind: z.literal('new-adaptation'),
  adaptationId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  characterId: CharacterIdSchema,
  baseRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  baseHash: HashSchema,
  importedDossier: DossierSchema,
  reviewRequired: z.literal(true),
});
export type DossierAdaptationImport = z.infer<typeof DossierAdaptationImportSchema>;

export const AvatarProvenanceSchema = z.object({
  slug: SlugSchema,
  name: z.string().min(1).max(200),
  performer: z.string().min(1).max(500),
  file: z.string().min(1).max(255),
  source_page: z.string().url(),
  image_url: z.string().url(),
  source_credit: z.string().min(1).max(2_000),
  license: z.string().min(1).max(2_000),
  identity_evidence: z.string().min(1).max(4_000),
  sha256: HashSchema,
  bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  visual_verified: z.boolean(),
  acquisition: z.string().min(1).max(2_000),
  mime_type: z.enum(['image/gif', 'image/webp', 'image/png', 'image/jpeg']),
  kind: z.enum(['character_avatar_reference', 'group_reference']),
  visual_review: z.string().min(1).max(2_000),
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
}).catchall(z.unknown());
export type AvatarProvenance = z.infer<typeof AvatarProvenanceSchema>;

export const AvatarManifestSchema = z.strictObject({
  scope: z.string().min(1).max(500),
  retrieved_on: z.string().date(),
  assets: z.array(AvatarProvenanceSchema).min(1),
  counts: z.object({
    individual_characters: z.number().int().nonnegative(),
    additional_family_references: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
  }).catchall(z.unknown()),
  public_release_clearance: z.string().min(1).max(2_000),
}).catchall(z.unknown()).superRefine((manifest, context) => {
  const slugs = new Set<string>();
  for (const [index, asset] of manifest.assets.entries()) {
    if (slugs.has(asset.slug)) context.addIssue({ code: 'custom', path: ['assets', index, 'slug'], message: 'avatar slug duplicado' });
    slugs.add(asset.slug);
  }
});
export type AvatarManifest = z.infer<typeof AvatarManifestSchema>;

export function parseDossierMarkdown(input: {
  characterId: unknown;
  displayName: unknown;
  aliases?: unknown;
  performers?: unknown;
  avatarSlug?: unknown;
  markdown: unknown;
  contentHash: unknown;
}): Dossier {
  const characterId = CharacterIdSchema.parse(input.characterId);
  const displayName = z.string().min(1).max(200).parse(input.displayName);
  const aliases = z.array(z.string().min(1).max(200)).max(200).parse(input.aliases ?? []);
  const performers = z.array(z.string().min(1).max(300)).max(200).parse(input.performers ?? []);
  const avatarSlug = input.avatarSlug === undefined ? undefined : SlugSchema.parse(input.avatarSlug);
  const markdown = z.string().max(2_000_000).parse(input.markdown);
  if (markdown.includes('\0')) throw new Error('El Markdown del dossier contiene NUL');

  const headings: Array<{ start: number; heading: string; depth: number }> = [];
  let offset = 0;
  let fencedCode: { marker: string; length: number } | undefined;
  const linePattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let lineMatch = linePattern.exec(markdown);
  while (lineMatch !== null && offset < markdown.length) {
    const line = lineMatch[1] ?? '';
    const markerMatch = /^ {0,3}([\u0060~]{3,})(.*)$/.exec(line);
    if (markerMatch !== null) {
      const marker = markerMatch[1] ?? '';
      const markerTail = markerMatch[2] ?? '';
      if (fencedCode === undefined) {
        fencedCode = { marker: marker[0] ?? '\u0060', length: marker.length };
      } else if (marker[0] === fencedCode.marker && marker.length >= fencedCode.length && markerTail.trim().length === 0) {
        fencedCode = undefined;
      }
    } else if (fencedCode === undefined) {
      const headingMatch = /^ {0,3}(#{1,6})[\t ]+(.+?)[\t ]*$/.exec(line);
      if (headingMatch !== null) {
        headings.push({
          start: offset,
          heading: (headingMatch[2] ?? '').trimEnd(),
          depth: (headingMatch[1] ?? '').length,
        });
      }
    }
    const consumed = lineMatch[0].length;
    if (consumed === 0) break;
    offset += consumed;
    lineMatch = linePattern.exec(markdown);
  }

  const sections: DossierSection[] = [];
  const unknownSections: DossierSection[] = [];
  const appendSection = (section: DossierSection): void => {
    sections.push(section);
    if (section.kind === 'unknown') unknownSections.push(section);
  };
  if (headings.length === 0) {
    if (markdown.length > 0) appendSection({ heading: '', depth: 0, kind: 'preamble', markdown });
  } else {
    const firstHeading = headings[0];
    if (firstHeading !== undefined && firstHeading.start > 0) {
      const preamble = markdown.slice(0, firstHeading.start);
      appendSection({ heading: '', depth: 0, kind: 'preamble', markdown: preamble });
    }
    for (const [index, current] of headings.entries()) {
      const following = headings[index + 1];
      const end = following?.start ?? markdown.length;
      const line = markdown.slice(current.start, end);
      const openingLine = line.split(/\r?\n/, 1)[0] ?? '';
      const kind = current.depth === 1 ? 'other' : classifyDossierHeading(openingLine.trimStart());
      appendSection({ heading: current.heading, depth: current.depth, kind, markdown: line });
    }
  }

  return DossierSchema.parse({
    schemaVersion: 1,
    characterId,
    displayName,
    aliases,
    performers,
    markdown,
    sections,
    sourceRefs: [],
    unknowns: [],
    contradictions: [],
    adaptations: [],
    avatarRef: avatarSlug === undefined ? { kind: 'unbound' } : { kind: 'catalog-reference', slug: avatarSlug },
    voiceRecipe: { kind: 'unreviewed' },
    revision: 0,
    contentHash: HashSchema.parse(input.contentHash),
    curationStatus: 'unreviewed',
    unknownSections,
  });
}

export function classifyDossierHeading(heading: string): z.infer<typeof DossierSectionKindSchema> {
  const normalized = heading.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/^#{1,6}\s*(alcance|criterio|criterio documental|criterio de evidencia)/.test(normalized)) return 'preamble';
  if (/(identidad|principio de interpretacion|posicion en)/.test(normalized)) return 'identity';
  if (/(biografia|historia de vida|antecedentes)/.test(normalized)) return 'biography';
  if (/(vinculos|relaciones|perspectiva)/.test(normalized)) return 'relationships';
  if (/(memoria|recuerdos|experiencias)/.test(normalized)) return 'memories';
  if (/(voz|habla|actuacion|sonido)/.test(normalized)) return 'voice';
  if (/(goal|metas|objetivos)/.test(normalized)) return 'goals';
  if (/(capacidad|competencia|recursos|tools|herramientas)/.test(normalized)) return 'capabilities';
  if (/(fuentes|bibliografia)/.test(normalized)) return 'sources';
  if (/(desconocidos|vacios|lagunas)/.test(normalized)) return 'unknowns';
  if (/contradiccion/.test(normalized)) return 'contradictions';
  if (/adaptacion/.test(normalized)) return 'adaptations';
  if (/(apariciones|evidencia)/.test(normalized)) return 'appearances';
  if (/(evolucion|continuidad)/.test(normalized)) return 'continuity';
  if (/(creacion de voz|diseño de voz)/.test(normalized)) return 'voice';
  if (/^#{1,6}\s*\d+(?:\.\d+)*\s*[—-]/.test(normalized)) return 'other';
  if (heading.startsWith('#')) return 'unknown';
  return 'preamble';
}
