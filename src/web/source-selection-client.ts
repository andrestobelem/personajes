import { z } from 'zod';
import { ApiProblemSchema } from '../domain/http.ts';
import { DossierSourceSchema, type DossierSource } from '../domain/dossier-source.ts';
import { DossierAdaptationPageSchema } from '../domain/dossier-exchange.ts';

async function read<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  const body: unknown = await response.json();
  if (!response.ok) {
    const problem = ApiProblemSchema.safeParse(body);
    throw new Error(problem.success ? problem.data.error.message : 'No se pudo abrir la fuente de preparación.');
  }
  return schema.parse(body);
}
export async function readCatalogPreparationSource(characterId: string): Promise<DossierSource> {
  const source = await read(`/api/v1/preparation-sources/catalog/${encodeURIComponent(characterId)}`, DossierSourceSchema);
  if (source.kind !== 'catalog-original' || source.characterId !== characterId) throw new Error('La fuente no coincide con el original solicitado.');
  return source;
}
export async function readAdaptationPreparationSource(adaptationId: string): Promise<DossierSource> {
  const source = await read(`/api/v1/preparation-sources/adaptations/${encodeURIComponent(adaptationId)}`, DossierSourceSchema);
  if (source.kind !== 'saved-adaptation' || source.adaptationId !== adaptationId) throw new Error('La fuente no coincide con la adaptación solicitada.');
  return source;
}
export function readPreparationAdaptations(input: { characterId: string; cursor?: string }) {
  const query = new URLSearchParams({ characterId: input.characterId, limit: '25', ...(input.cursor ? { cursor: input.cursor } : {}) });
  return read(`/api/v1/dossier-adaptations?${query}`, DossierAdaptationPageSchema);
}
/** Structural equality includes metadata, unlike revision and Markdown hash. */
export function samePreparationSource(left: DossierSource, right: DossierSource): boolean {
  return JSON.stringify(DossierSourceSchema.parse(left)) === JSON.stringify(DossierSourceSchema.parse(right));
}
