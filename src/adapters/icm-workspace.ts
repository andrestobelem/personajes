import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, type BigIntStats } from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { z } from 'zod';
import {
  createIcmWorkspaceSnapshot, hashIcmMarkdown, IcmWorkspaceAudienceSchema,
  IcmWorkspaceSectionIdSchema, verifyIcmWorkspaceSnapshot,
  type IcmWorkspaceAudience, type IcmWorkspaceSnapshot, type IcmWorkspaceSourceSelection,
} from '../domain/icm-workspace.ts';
import { canonicalJson, sha256CanonicalJson } from '../domain/canonical-json.ts';
import { HashSchema, RevisionSchema, SourceRefIdSchema } from '../domain/values.ts';

const MAX_SOURCE_BYTES = 1_000_000;
const MAX_TOTAL_SOURCE_BYTES = 2_000_000;
const SOURCE_REVISION = 0;
const SOURCE_REVISION_VALUE = RevisionSchema.parse(SOURCE_REVISION);

type SectionId = z.infer<typeof IcmWorkspaceSectionIdSchema>;
type ManifestSection = { sectionId: SectionId; heading: string };
type InternalSource = {
  sourceId: z.infer<typeof SourceRefIdSchema>;
  role: IcmWorkspaceAudience['role'];
  label: string;
  relativePath: string;
  sections: readonly ManifestSection[];
};

const PROCESS_AND_CIERRE = [
  { sectionId: 'process', heading: '## Process' },
  { sectionId: 'cierre', heading: '## Cierre' },
] as const satisfies readonly ManifestSection[];
const PROCESS_ONLY = [{ sectionId: 'process', heading: '## Process' }] as const satisfies readonly ManifestSection[];

// This list is deliberately explicit. Never discover actors or paths from caller input or the filesystem.
const ACTOR_SLUGS = [
  'agente-13', 'agente-44', 'agente-99', 'almirante-hargrade', 'bobo', 'carleton', 'carlson',
  'charlie-watkins', 'claw', 'coronel-von-klaus', 'doctor-ratton', 'doctora-simon', 'doctora-steele',
  'fang', 'harry-hoo', 'hobson', 'hodgkins', 'hymie', 'jefe', 'larrabee', 'madre-de-99',
  'maxwell-smart', 'profesor-parker', 'profesor-windish', 'rey-charles-ix', 'shtarker', 'siegfried',
] as const;
const ACTOR_SLUG_SET = new Set<string>(ACTOR_SLUGS);

const INTERNAL_SOURCES: readonly InternalSource[] = [
  {
    sourceId: SourceRefIdSchema.parse('stage.actuation'), role: 'actor', label: 'Etapa: actuación',
    relativePath: 'obra/stages/02-actuacion/CONTEXT.md', sections: PROCESS_AND_CIERRE,
  },
  {
    sourceId: SourceRefIdSchema.parse('stage.moderation'), role: 'continuista', label: 'Etapa: moderación',
    relativePath: 'obra/stages/03-moderacion/CONTEXT.md', sections: PROCESS_AND_CIERRE,
  },
  {
    sourceId: SourceRefIdSchema.parse('stage.direction'), role: 'director', label: 'Etapa: dirección',
    relativePath: 'obra/stages/07-direccion/CONTEXT.md', sections: PROCESS_AND_CIERRE,
  },
  {
    sourceId: SourceRefIdSchema.parse('role.continuista'), role: 'continuista', label: 'Contrato: Continuista',
    relativePath: 'obra/continuista/CONTEXT.md', sections: PROCESS_AND_CIERRE,
  },
  {
    sourceId: SourceRefIdSchema.parse('role.director'), role: 'director', label: 'Contrato: Director',
    relativePath: 'obra/direccion/CONTEXT.md', sections: PROCESS_ONLY,
  },
  {
    sourceId: SourceRefIdSchema.parse('role.configurator'), role: 'configurator', label: 'Contrato: Configurador',
    relativePath: 'obra/setup/CONTEXT.md', sections: PROCESS_AND_CIERRE,
  },
  {
    sourceId: SourceRefIdSchema.parse('role.narrator'), role: 'narrator', label: 'Contrato: Narrador',
    relativePath: 'obra/narrador/CONTEXT.md', sections: PROCESS_AND_CIERRE,
  },
  {
    sourceId: SourceRefIdSchema.parse('role.narration-reviewer'), role: 'narration-reviewer', label: 'Contrato: Revisor de narración',
    relativePath: 'obra/revisor-narracion/CONTEXT.md', sections: PROCESS_AND_CIERRE,
  },
  ...ACTOR_SLUGS.map((slug) => ({
    sourceId: SourceRefIdSchema.parse(`actor.${slug}.context`), role: 'actor' as const,
    label: `Contexto del actor: ${slug}`, relativePath: `obra/personajes/${slug}/CONTEXT.md`,
    sections: PROCESS_AND_CIERRE,
  })),
];

const MANIFEST_HASH = sha256CanonicalJson(INTERNAL_SOURCES.map((source) => ({
  sourceId: source.sourceId,
  role: source.role,
  label: source.label,
  relativePath: source.relativePath,
  revision: SOURCE_REVISION,
  sections: source.sections,
})));

/** Public catalog deliberately omits filesystem paths. Use it to render allowed source/section choices. */
export const ICM_WORKSPACE_CATALOG = Object.freeze(INTERNAL_SOURCES.map((source) => Object.freeze({
  sourceId: source.sourceId,
  role: source.role,
  label: source.label,
  sectionIds: Object.freeze(source.sections.map((section) => section.sectionId)),
})));

export const ICM_WORKSPACE_ACTOR_SLUGS = Object.freeze([...ACTOR_SLUGS]);

const PreviewInputSchema = z.strictObject({
  audience: IcmWorkspaceAudienceSchema,
  sourceIds: z.array(SourceRefIdSchema).min(1).max(32),
  sectionIdsBySource: z.record(z.string(), z.array(IcmWorkspaceSectionIdSchema).min(1).max(64)),
});
const PreviewManyInputSchema = z.strictObject({ groups: z.array(PreviewInputSchema).min(1).max(64) });

const AdmissionOptionsSchema = z.strictObject({
  expectedWorkspaceRevision: HashSchema.optional(),
  expectedSnapshotHash: HashSchema.optional(),
});

export type IcmWorkspaceReaderPreview = {
  workspaceRevision: z.infer<typeof HashSchema>;
  selections: IcmWorkspaceSourceSelection[];
  snapshot: IcmWorkspaceSnapshot;
};

function throwReaderError(code: string): never {
  throw new Error(`ICM_WORKSPACE_${code}`);
}

function sourceAudience(source: InternalSource, audience: IcmWorkspaceAudience): boolean {
  if (source.role !== audience.role) return false;
  if (source.sourceId.startsWith('actor.')) {
    return audience.role === 'actor'
      && source.sourceId === `actor.${audience.actorId}.context`;
  }
  return true;
}

function sourceForId(sourceId: string): InternalSource | undefined {
  return INTERNAL_SOURCES.find((source) => source.sourceId === sourceId);
}

type FileIdentity = {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  mode: bigint;
};

function identity(stats: BigIntStats): FileIdentity {
  return {
    dev: stats.dev, ino: stats.ino, size: stats.size,
    mtimeNs: stats.mtimeNs, ctimeNs: stats.ctimeNs, mode: stats.mode,
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs && left.mode === right.mode;
}

function assertNoSymlinkPath(absolutePath: string, expectedKind: 'directory' | 'file'): void {
  const parsed = resolve(absolutePath);
  if (!isAbsolute(parsed)) throwReaderError('ROOT_NOT_ABSOLUTE');
  const parts = parsed.split(sep).filter(Boolean);
  let current: string = sep;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    let stats: BigIntStats;
    try {
      stats = lstatSync(current, { bigint: true });
    } catch {
      throwReaderError('SOURCE_MISSING');
    }
    if (stats.isSymbolicLink()) throwReaderError('SYMLINK_FORBIDDEN');
    const isLast = index === parts.length - 1;
    if (!isLast && !stats.isDirectory()) throwReaderError('PATH_COMPONENT_NOT_DIRECTORY');
    if (isLast && expectedKind === 'directory' && !stats.isDirectory()) throwReaderError('ROOT_NOT_DIRECTORY');
    if (isLast && expectedKind === 'file' && !stats.isFile()) throwReaderError('SOURCE_NOT_REGULAR_FILE');
  }
}

function assertWithinRoot(root: string, sourcePath: string): void {
  const relativePath = relative(root, sourcePath);
  if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throwReaderError('PATH_ESCAPE');
  }
}

function readStableUtf8Source(root: string, relativePath: string): { markdown: string; byteLength: number } {
  const sourcePath = resolve(root, relativePath);
  assertWithinRoot(root, sourcePath);
  assertNoSymlinkPath(sourcePath, 'file');
  let realSourcePath: string;
  try {
    realSourcePath = realpathSync.native(sourcePath);
  } catch {
    throwReaderError('SOURCE_MISSING');
  }
  if (realSourcePath !== sourcePath) throwReaderError('SYMLINK_FORBIDDEN');

  let descriptor: number;
  try {
    descriptor = openSync(sourcePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  } catch {
    throwReaderError('SOURCE_OPEN_FAILED');
  }
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) throwReaderError('SOURCE_NOT_REGULAR_FILE');
    const initialIdentity = identity(before);
    if (initialIdentity.size > BigInt(MAX_SOURCE_BYTES)) throwReaderError('SOURCE_TOO_LARGE');

    const expectedBytes = Number(initialIdentity.size);
    const chunks: Buffer[] = [];
    let total = 0;
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, expectedBytes)));
    while (total < expectedBytes) {
      const bytesRead = readSync(descriptor, chunk, 0, Math.min(chunk.byteLength, expectedBytes - total), total);
      if (bytesRead === 0) throwReaderError('SOURCE_CHANGED_DURING_READ');
      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
      total += bytesRead;
    }
    const extra = Buffer.allocUnsafe(1);
    if (readSync(descriptor, extra, 0, 1, expectedBytes) !== 0) throwReaderError('SOURCE_CHANGED_DURING_READ');

    const after = fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(initialIdentity, identity(after))) throwReaderError('SOURCE_CHANGED_DURING_READ');
    assertNoSymlinkPath(sourcePath, 'file');
    const pathAfter = lstatSync(sourcePath, { bigint: true });
    if (pathAfter.dev !== initialIdentity.dev || pathAfter.ino !== initialIdentity.ino) {
      throwReaderError('SOURCE_REPLACED_DURING_READ');
    }

    const bytes = Buffer.concat(chunks, total);
    let markdown: string;
    try {
      markdown = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throwReaderError('INVALID_UTF8');
    }
    if (!Buffer.from(markdown, 'utf8').equals(bytes)) throwReaderError('INVALID_UTF8');
    return { markdown, byteLength: bytes.byteLength };
  } finally {
    closeSync(descriptor);
  }
}

type HeadingRange = { heading: string; start: number; end: number };

function findAllowedSections(markdown: string, allowed: readonly ManifestSection[]): Map<string, string> {
  const headings: HeadingRange[] = [];
  let offset = 0;
  let fence: { marker: '`' | '~'; length: number } | undefined;
  for (const lineWithEnding of markdown.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const line = lineWithEnding.replace(/\r?\n$/, '');
    const fenceLine = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence !== undefined) {
      const closingFence = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closingFence !== null) {
        const marker = closingFence[1];
        if (marker !== undefined && marker[0] === fence.marker && marker.length >= fence.length) fence = undefined;
      }
    } else if (fenceLine !== null) {
      const marker = fenceLine[1];
      const info = fenceLine[2] ?? '';
      if (marker !== undefined && !(marker.startsWith('`') && info.includes('`'))) {
        fence = { marker: marker.startsWith('`') ? '`' : '~', length: marker.length };
      }
    } else {
      const allowedHeading = allowed.find((section) => section.heading === line);
      if (allowedHeading !== undefined) headings.push({ heading: allowedHeading.heading, start: offset, end: offset + lineWithEnding.length });
      else if (/^ {0,3}#{1,2}(?:\s|$)/.test(line)) headings.push({ heading: '', start: offset, end: offset + lineWithEnding.length });
    }
    offset += lineWithEnding.length;
  }

  const sections = new Map<string, string>();
  for (const [index, heading] of headings.entries()) {
    if (heading.heading === '') continue;
    const allowedSection = allowed.find((section) => section.heading === heading.heading);
    if (allowedSection === undefined) continue;
    if (sections.has(allowedSection.sectionId)) throwReaderError('DUPLICATE_SECTION');
    const nextHeading = headings[index + 1];
    const end = nextHeading?.start ?? markdown.length;
    sections.set(allowedSection.sectionId, markdown.slice(heading.start, end));
  }
  return sections;
}

function catalogForAudience(audience: IcmWorkspaceAudience) {
  return INTERNAL_SOURCES.filter((source) => sourceAudience(source, audience));
}

function requiredSourceIds(audience: IcmWorkspaceAudience): string[] {
  switch (audience.role) {
    case 'actor':
      return ['stage.actuation', `actor.${audience.actorId}.context`];
    case 'continuista':
      return ['stage.moderation', 'role.continuista'];
    case 'director':
      return ['stage.direction', 'role.director'];
    case 'configurator':
      return ['role.configurator'];
    case 'narrator':
      return ['role.narrator'];
    case 'narration-reviewer':
      return ['role.narration-reviewer'];
    default: {
      const exhaustive: never = audience;
      throw new Error(`ICM_WORKSPACE_UNSUPPORTED_AUDIENCE:${String(exhaustive)}`);
    }
  }
}

function workspaceRootPath(workspaceRoot: string): string {
  if (!isAbsolute(workspaceRoot)) throwReaderError('ROOT_NOT_ABSOLUTE');
  const root = resolve(workspaceRoot);
  assertNoSymlinkPath(root, 'directory');
  let realRoot: string;
  try {
    realRoot = realpathSync.native(root);
  } catch {
    throwReaderError('ROOT_MISSING');
  }
  if (realRoot !== root) throwReaderError('ROOT_SYMLINK_FORBIDDEN');
  return root;
}

function expectedWorkspaceRevision(current: readonly {
  sourceId: string;
  audience: IcmWorkspaceAudience;
  revision: number;
  sourceHash: string;
}[]) {
  return sha256CanonicalJson({
    manifestHash: MANIFEST_HASH,
    sources: current.map((source) => ({
      sourceId: source.sourceId,
      audience: source.audience,
      revision: source.revision,
      sourceHash: source.sourceHash,
    })),
  });
}

function compareManifestOrder(left: IcmWorkspaceSnapshot['sources'][number], right: IcmWorkspaceSnapshot['sources'][number]): number {
  const leftIndex = INTERNAL_SOURCES.findIndex((source) => source.sourceId === left.sourceId);
  const rightIndex = INTERNAL_SOURCES.findIndex((source) => source.sourceId === right.sourceId);
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  const leftAudience = canonicalJson(left.audience);
  const rightAudience = canonicalJson(right.audience);
  return leftAudience < rightAudience ? -1 : leftAudience > rightAudience ? 1 : 0;
}

/** Host-only synchronous reader for the explicit Markdown source catalog. */
export function createIcmWorkspaceReader(input: { workspaceRoot: string }) {
  const root = workspaceRootPath(input.workspaceRoot);

  function readSource(source: InternalSource) {
    return readStableUtf8Source(root, source.relativePath);
  }

  function listSources(inputValue: unknown) {
    const audience = IcmWorkspaceAudienceSchema.parse(inputValue);
    if (audience.role === 'actor' && !ACTOR_SLUG_SET.has(audience.actorId)) {
      return [];
    }
    return catalogForAudience(audience).map((source) => ({
      sourceId: source.sourceId,
      role: source.role,
      label: source.label,
      sectionIds: source.sections.map((section) => section.sectionId),
    }));
  }

  function previewInternal(inputValue: unknown): IcmWorkspaceReaderPreview & { sourceBytes: number } {
    const input = PreviewInputSchema.parse(inputValue);
    const audience = IcmWorkspaceAudienceSchema.parse(input.audience);
    if (audience.role === 'actor' && !ACTOR_SLUG_SET.has(audience.actorId)) {
      throwReaderError('ACTOR_NOT_ALLOWLISTED');
    }
    const allowedSources = catalogForAudience(audience);
    if (new Set(input.sourceIds).size !== input.sourceIds.length) throwReaderError('DUPLICATE_SOURCE');
    const requestedSourceIds = new Set<string>(input.sourceIds);
    for (const sourceId of Object.keys(input.sectionIdsBySource)) {
      if (!requestedSourceIds.has(sourceId)) throwReaderError('UNSELECTED_SECTION_SOURCE');
    }

    const selected = input.sourceIds.map((sourceId) => {
      const source = sourceForId(sourceId);
      if (source === undefined || !allowedSources.includes(source)) throwReaderError('SOURCE_NOT_ALLOWED_FOR_AUDIENCE');
      const requestedSections = input.sectionIdsBySource[sourceId];
      if (requestedSections === undefined || requestedSections.length === 0) throwReaderError('SECTIONS_REQUIRED');
      if (new Set(requestedSections).size !== requestedSections.length) throwReaderError('DUPLICATE_SECTION');
      const allowedIds = new Set<string>(source.sections.map((section) => section.sectionId));
      if (requestedSections.some((sectionId) => !allowedIds.has(sectionId))) throwReaderError('SECTION_NOT_ALLOWED');
      return { source, requestedSections: new Set(requestedSections) };
    }).sort((left, right) => allowedSources.indexOf(left.source) - allowedSources.indexOf(right.source));

    let totalBytes = 0;
    const currentHashes: Array<{ sourceId: string; audience: IcmWorkspaceAudience; revision: number; sourceHash: string }> = [];
    const snapshot = createIcmWorkspaceSnapshot({ sources: selected.map(({ source, requestedSections }) => {
      const read = readSource(source);
      totalBytes += read.byteLength;
      if (totalBytes > MAX_TOTAL_SOURCE_BYTES) throwReaderError('TOTAL_SOURCE_BYTES_EXCEEDED');
      const sourceHash = hashIcmMarkdown(read.markdown);
      currentHashes.push({ sourceId: source.sourceId, audience, revision: SOURCE_REVISION, sourceHash });
      const foundSections = findAllowedSections(read.markdown, source.sections);
      const sections = source.sections.flatMap((section) => {
        if (!requestedSections.has(section.sectionId)) return [];
        const markdown = foundSections.get(section.sectionId);
        if (markdown === undefined) throwReaderError('SECTION_MISSING');
        return [{ sectionId: section.sectionId, markdown }];
      });
      return {
        sourceId: source.sourceId,
        audience,
        revision: SOURCE_REVISION_VALUE,
        sourceHash,
        sections,
      };
    }) });
    const selections = snapshot.sources.map((source) => ({
      sourceId: source.sourceId,
      audience: source.audience,
      revision: source.revision,
      sourceHash: source.sourceHash,
      sectionIds: source.sections.map((section) => section.sectionId),
    }));
    return {
      workspaceRevision: expectedWorkspaceRevision(currentHashes),
      selections,
      snapshot,
      sourceBytes: totalBytes,
    };
  }

  function preview(inputValue: unknown): IcmWorkspaceReaderPreview {
    const { sourceBytes, ...result } = previewInternal(inputValue);
    void sourceBytes;
    return result;
  }

  function previewMany(inputValue: unknown): IcmWorkspaceReaderPreview {
    const input = PreviewManyInputSchema.parse(inputValue);
    const groups = new Map<string, { audience: IcmWorkspaceAudience; sourceIds: string[]; sectionIdsBySource: Record<string, string[]> }>();
    const selectedPairs = new Set<string>();
    for (const group of input.groups) {
      const audienceKey = canonicalJson(group.audience);
      let merged = groups.get(audienceKey);
      if (merged === undefined) {
        merged = { audience: group.audience, sourceIds: [], sectionIdsBySource: {} };
        groups.set(audienceKey, merged);
      }
      const groupSourceIds = new Set<string>(group.sourceIds);
      if (Object.keys(group.sectionIdsBySource).some((sourceId) => !groupSourceIds.has(sourceId))) {
        throwReaderError('UNSELECTED_SECTION_SOURCE');
      }
      for (const sourceId of group.sourceIds) {
        const pair = canonicalJson({ audience: group.audience, sourceId });
        if (selectedPairs.has(pair)) throwReaderError('DUPLICATE_AUDIENCE_SOURCE');
        selectedPairs.add(pair);
        merged.sourceIds.push(sourceId);
        const sectionIds = group.sectionIdsBySource[sourceId];
        if (sectionIds === undefined) throwReaderError('SECTIONS_REQUIRED');
        merged.sectionIdsBySource[sourceId] = sectionIds;
      }
    }

    let totalSourceBytes = 0;
    const groupPreviews = Array.from(groups.values()).map((group) => {
      const result = previewInternal(group);
      totalSourceBytes += result.sourceBytes;
      if (totalSourceBytes > MAX_TOTAL_SOURCE_BYTES) throwReaderError('TOTAL_SOURCE_BYTES_EXCEEDED');
      return result;
    });
    const sources = groupPreviews.flatMap((result) => result.snapshot.sources).sort(compareManifestOrder).map((source) => ({
      sourceId: source.sourceId,
      audience: source.audience,
      revision: source.revision,
      sourceHash: source.sourceHash,
      sections: source.sections.map(({ sectionId, markdown }) => ({ sectionId, markdown })),
    }));
    const snapshot = createIcmWorkspaceSnapshot({ sources });
    const currentHashes = snapshot.sources.map((source) => ({
      sourceId: source.sourceId,
      audience: source.audience,
      revision: source.revision,
      sourceHash: source.sourceHash,
    }));
    return {
      workspaceRevision: expectedWorkspaceRevision(currentHashes),
      selections: snapshot.sources.map((source) => ({
        sourceId: source.sourceId,
        audience: source.audience,
        revision: source.revision,
        sourceHash: source.sourceHash,
        sectionIds: source.sections.map((section) => section.sectionId),
      })),
      snapshot,
    };
  }

  function admitFrozenSnapshot(
    snapshotInput: unknown,
    optionsInput: unknown = {},
  ): IcmWorkspaceSnapshot {
    const snapshot = verifyIcmWorkspaceSnapshot(snapshotInput);
    const options = AdmissionOptionsSchema.parse(optionsInput);
    if (options.expectedSnapshotHash !== undefined && options.expectedSnapshotHash !== snapshot.snapshotHash) {
      throwReaderError('SNAPSHOT_HASH_CONFLICT');
    }
    if (snapshot.sources.length === 0) throwReaderError('SNAPSHOT_EMPTY');
    const groups = new Map<string, { audience: IcmWorkspaceAudience; sources: typeof snapshot.sources }>();
    for (const source of snapshot.sources) {
      const audienceKey = canonicalJson(source.audience);
      const group = groups.get(audienceKey);
      if (group === undefined) groups.set(audienceKey, { audience: source.audience, sources: [source] });
      else groups.set(audienceKey, { ...group, sources: [...group.sources, source] });
    }
    for (const { audience, sources } of groups.values()) {
      const included = new Set<string>(sources.map((source) => source.sourceId));
      if (requiredSourceIds(audience).some((sourceId) => !included.has(sourceId))) {
        throwReaderError('REQUIRED_SOURCE_MISSING');
      }
    }
    const fresh = previewMany({ groups: Array.from(groups.values()).map((group) => {
      const sectionIdsBySource = Object.fromEntries(group.sources.map((source) => [
        source.sourceId,
        source.sections.map((section) => section.sectionId),
      ]));
      return {
        audience: group.audience,
        sourceIds: group.sources.map((source) => source.sourceId),
        sectionIdsBySource,
      };
    }) });
    if (options.expectedWorkspaceRevision !== undefined && options.expectedWorkspaceRevision !== fresh.workspaceRevision) {
      throwReaderError('WORKSPACE_REVISION_CONFLICT');
    }
    if (fresh.snapshot.snapshotHash !== snapshot.snapshotHash || canonicalJson(fresh.snapshot) !== canonicalJson(snapshot)) {
      throwReaderError('SOURCE_DRIFT');
    }
    return snapshot;
  }

  return Object.freeze({ listSources, preview, previewMany, admitFrozenSnapshot });
}
