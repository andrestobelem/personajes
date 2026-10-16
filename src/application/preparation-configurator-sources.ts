import { z } from 'zod';
import { readDossier, readLibraryDocument, type loadCatalog } from '../adapters/catalog.ts';
import { DossierAdaptationReadSchema } from '../domain/dossier-exchange.ts';
import { DossierSourceReferenceSchema } from '../domain/dossier-source.ts';
import { PreparationConfiguratorDocumentSchema, PreparationConfiguratorRequestSchema } from '../domain/preparation-configurator.ts';
import { RunConfigurationDraftSchema } from '../domain/production.ts';
import type { openDossierExchange } from './dossier-exchange.ts';
import { freezeCatalogDossierSource, validateFrozenDossierSource } from './dossier-source-repository.ts';
import { canonicalJson } from '../domain/canonical-json.ts';

const ResolveSchema = z.strictObject({ principalId: z.string().min(1).max(200), request: PreparationConfiguratorRequestSchema, draft: RunConfigurationDraftSchema });

/** Load only the host manifest. Jobs subsequently freeze these verified bytes,
 * not arbitrary paths or text from a browser/model. A failed source remains
 * unavailable, never substituted with another revision or live filesystem read. */
export async function loadPreparationConfiguratorSources(input: {
  catalog: Awaited<ReturnType<typeof loadCatalog>>;
  adaptations: Pick<ReturnType<typeof openDossierExchange>, 'readSavedAdaptation'>;
}) {
  const actorResults = await Promise.allSettled(input.catalog.manifest.characters.map(async entry => {
    const source = freezeCatalogDossierSource(await readDossier({ catalog: input.catalog, characterId: entry.characterId }));
    return { entry, source, reference: DossierSourceReferenceSchema.parse({ kind: source.kind, characterId: source.characterId,
      revision: source.revision, contentHash: source.contentHash, fullArchiveHash: source.fullArchiveHash }) };
  }));
  const actors = actorResults.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  const documentResults = await Promise.allSettled(input.catalog.manifest.documents.filter(entry => /\.(md|txt|bib|csv)$/i.test(entry.path)).map(async entry => {
    const value = await readLibraryDocument({ catalog: input.catalog, documentId: entry.id });
    if (value.kind !== 'text-document') return undefined;
    const parsed = PreparationConfiguratorDocumentSchema.safeParse({ sourceId: entry.id, text: value.text, fullHash: entry.sha256 });
    return parsed.success ? { entry, document: parsed.data } : undefined;
  }));
  const documents = documentResults.flatMap(result => result.status === 'fulfilled' && result.value !== undefined ? [result.value] : []);
  return Object.freeze({
    choices() {
      return {
        actors: actors.map(({ entry, reference }) => ({ label: entry.displayName, reference: DossierSourceReferenceSchema.parse(reference) })),
        documents: documents.map(({ entry, document }) => ({ sourceId: document.sourceId, title: entry.title, fullHash: document.fullHash })),
        unavailableActorIds: input.catalog.manifest.characters.filter(entry => !actors.some(actor => actor.entry.characterId === entry.characterId)).map(entry => entry.characterId),
        unavailableDocumentIds: input.catalog.manifest.documents.filter(entry => !documents.some(document => document.entry.id === entry.id)).map(entry => entry.id),
      };
    },
    resolve(raw: z.infer<typeof ResolveSchema>) {
      const { principalId, request } = ResolveSchema.parse(raw);
      const actorSources = request.actorSources.map(reference => {
        const source = reference.kind === 'catalog-original' ? actors.find(actor => actor.source.characterId === reference.characterId)?.source
          : (() => {
            const saved = DossierAdaptationReadSchema.parse(input.adaptations.readSavedAdaptation({ principalId, importId: reference.importId }));
            return validateFrozenDossierSource({ kind: 'saved-adaptation', characterId: saved.characterId, revision: saved.revision,
              contentHash: saved.contentHash, fullArchiveHash: saved.archiveHash, importId: saved.importId, adaptationId: saved.adaptationId,
              importedArchiveHash: saved.importedArchiveHash, frozenDossier: saved.adaptation.importedDossier });
          })();
        if (source === undefined) throw new Error('PREPARATION_CONFIGURATOR_SOURCE_UNAVAILABLE');
        const resolved = DossierSourceReferenceSchema.parse(source.kind === 'catalog-original'
          ? { kind: source.kind, characterId: source.characterId, revision: source.revision, contentHash: source.contentHash, fullArchiveHash: source.fullArchiveHash }
          : { kind: source.kind, characterId: source.characterId, revision: source.revision, contentHash: source.contentHash, fullArchiveHash: source.fullArchiveHash, importId: source.importId, adaptationId: source.adaptationId });
        if (canonicalJson(resolved) !== canonicalJson(reference)) throw new Error('PREPARATION_CONFIGURATOR_SOURCE_CHANGED');
        return source;
      });
      const selectedDocuments = request.documentIds.map(sourceId => {
        const selected = documents.find(document => document.document.sourceId === sourceId);
        if (selected === undefined) throw new Error('PREPARATION_CONFIGURATOR_DOCUMENT_UNAVAILABLE');
        return selected.document;
      });
      // Clone at the boundary: callers cannot mutate the cached host sources.
      return { actorSources: actorSources.map(validateFrozenDossierSource), documents: selectedDocuments.map(document => PreparationConfiguratorDocumentSchema.parse(document)) };
    },
  });
}
