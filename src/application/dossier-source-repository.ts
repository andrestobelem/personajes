import { createHash } from 'node:crypto';
import { exportDossier } from '../adapters/catalog.ts';
import { DossierSchema, type Dossier } from '../domain/catalog.ts';
import { DossierAdaptationReadSchema } from '../domain/dossier-exchange.ts';
import { DossierSourceReferenceSchema, DossierSourceSchema, type DossierSource } from '../domain/dossier-source.ts';
import { PreparedCharacterSchema } from '../domain/preparation.ts';
import type { openDossierExchange } from './dossier-exchange.ts';

const archiveHash = (dossier: Dossier) => createHash('sha256').update(exportDossier(dossier)).digest('hex');

/** Verify an already admitted, self-contained source. Local import IDs are
 * provenance here, not capabilities to read another host's private library. */
export function validateFrozenDossierSource(raw: unknown): DossierSource {
  const source = DossierSourceSchema.parse(raw);
  if (archiveHash(source.frozenDossier) !== source.fullArchiveHash) throw new Error('DOSSIER_SOURCE_HASH_MISMATCH');
  if (source.kind === 'saved-adaptation') {
    const dossier = source.frozenDossier;
    if (dossier.adaptations.at(-1)?.basedOnHash !== dossier.contentHash) throw new Error('DOSSIER_SOURCE_LINEAGE_MISMATCH');
    const predecessor = DossierSchema.parse({ ...dossier, revision: dossier.revision - 1, adaptations: dossier.adaptations.slice(0, -1) });
    if (archiveHash(predecessor) !== source.importedArchiveHash) throw new Error('DOSSIER_SOURCE_LINEAGE_MISMATCH');
  }
  return source;
}

export function freezeCatalogDossierSource(raw: unknown): DossierSource {
  const dossier = DossierSchema.parse(raw);
  return validateFrozenDossierSource({ kind: 'catalog-original', characterId: dossier.characterId,
    revision: dossier.revision, contentHash: dossier.contentHash, fullArchiveHash: archiveHash(dossier), frozenDossier: dossier });
}

/** Resolve a client selection from host-owned resources. Never takes a path,
 * client dossier, author, or a request to choose the latest available version. */
export function createDossierSourceRepository(input: {
  readCatalogDossier: (characterId: string) => Dossier | Promise<Dossier>;
  adaptations: Pick<ReturnType<typeof openDossierExchange>, 'readSavedAdaptation'>;
}) {
  async function resolveSelection(request: { principalId: string; reference: unknown }): Promise<DossierSource> {
    const reference = DossierSourceReferenceSchema.parse(request.reference);
    let source: DossierSource;
    switch (reference.kind) {
      case 'catalog-original':
        source = freezeCatalogDossierSource(await input.readCatalogDossier(reference.characterId));
        break;
      case 'saved-adaptation': {
        const saved = DossierAdaptationReadSchema.parse(input.adaptations.readSavedAdaptation({ principalId: request.principalId, importId: reference.importId }));
        source = validateFrozenDossierSource({ kind: 'saved-adaptation', characterId: saved.characterId,
          revision: saved.revision, contentHash: saved.contentHash, fullArchiveHash: saved.archiveHash,
          importId: saved.importId, adaptationId: saved.adaptationId, importedArchiveHash: saved.importedArchiveHash,
          frozenDossier: saved.adaptation.importedDossier });
        break;
      }
      default: { const exhaustive: never = reference; return exhaustive; }
    }
    // Both values pass the same schema, including complete hash and exact IDs.
    if (JSON.stringify(sourceReference(source)) !== JSON.stringify(reference)) throw new Error('DOSSIER_SOURCE_SELECTION_CHANGED');
    return source;
  }
  return Object.freeze({ resolveSelection });
}

/** A legacy preparation remains readable, but no complete source is invented
 * from a current catalogue merely because its Markdown hash happens to match. */
export function readPreparedDossierSource(raw: unknown) {
  const prepared = PreparedCharacterSchema.parse(raw);
  if (prepared.dossierSource === undefined) return { kind: 'legacy-source-unavailable' } as const;
  return { kind: 'found', source: validateFrozenDossierSource(prepared.dossierSource) } as const;
}

function sourceReference(source: DossierSource) {
  const common = { kind: source.kind, characterId: source.characterId, revision: source.revision,
    contentHash: source.contentHash, fullArchiveHash: source.fullArchiveHash };
  return DossierSourceReferenceSchema.parse(source.kind === 'catalog-original' ? common
    : { ...common, importId: source.importId, adaptationId: source.adaptationId });
}
