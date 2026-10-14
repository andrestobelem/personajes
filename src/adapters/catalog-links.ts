import { CatalogReferenceQuerySchema, CatalogReferenceTargetSchema } from '../domain/catalog-links.ts';
import type { CatalogReferenceTarget } from '../domain/catalog-links.ts';
import type { LoadedCatalog } from './catalog.ts';

/** Resolve against registered public corpus paths; never read a user-selected file. */
export function resolveCatalogReference(input: { catalog: LoadedCatalog; query: unknown }): CatalogReferenceTarget {
  const query = CatalogReferenceQuerySchema.parse(input.query);
  const source = query.sourceKind === 'character'
    ? input.catalog.manifest.characters.find((entry) => entry.characterId === query.sourceId)
    : input.catalog.manifest.documents.find((entry) => entry.id === query.sourceId);
  if (source === undefined || query.reference.includes('\\') || query.reference.startsWith('//') || /^[a-z][a-z0-9+.-]*:/iu.test(query.reference)) {
    return { kind: 'unavailable' };
  }
  let path: string;
  try {
    const url = new URL(query.reference, new URL(source.path, 'https://catalog.invalid/'));
    if (url.origin !== 'https://catalog.invalid' || url.search || url.username || url.password) return { kind: 'unavailable' };
    path = decodeURIComponent(url.pathname.slice(1));
  } catch { return { kind: 'unavailable' }; }
  const character = input.catalog.manifest.characters.find((entry) => entry.path === path);
  if (character !== undefined) return CatalogReferenceTargetSchema.parse({ kind: 'character', id: character.characterId, title: character.displayName });
  const document = input.catalog.manifest.documents.find((entry) => entry.path === path);
  if (document !== undefined) return CatalogReferenceTargetSchema.parse({ kind: document.kind === 'paper' ? 'paper' : 'document', id: document.id, title: document.title });
  return { kind: 'unavailable' };
}
