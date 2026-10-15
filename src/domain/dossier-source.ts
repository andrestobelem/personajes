import { z } from 'zod';
import { DossierSchema } from './catalog.ts';
import { CharacterIdSchema, HashSchema, RevisionSchema } from './values.ts';

const reference = { characterId: CharacterIdSchema, revision: RevisionSchema, contentHash: HashSchema, fullArchiveHash: HashSchema };
export const CatalogDossierSourceReferenceSchema = z.strictObject({ kind: z.literal('catalog-original'), ...reference });
export const AdaptationDossierSourceReferenceSchema = z.strictObject({ kind: z.literal('saved-adaptation'), ...reference, importId: z.uuid(), adaptationId: z.uuid() });
/** A selection identifies expected host data; it never authorizes a client dossier. */
export const DossierSourceReferenceSchema = z.discriminatedUnion('kind', [CatalogDossierSourceReferenceSchema, AdaptationDossierSourceReferenceSchema]);
export const DossierSourceSchema = z.discriminatedUnion('kind', [
 CatalogDossierSourceReferenceSchema.extend({ frozenDossier: DossierSchema }),
 AdaptationDossierSourceReferenceSchema.extend({ frozenDossier: DossierSchema, importedArchiveHash: HashSchema }),
]).superRefine((source, context) => {
 if (source.characterId !== source.frozenDossier.characterId || source.revision !== source.frozenDossier.revision || source.contentHash !== source.frozenDossier.contentHash)
  context.addIssue({ code: 'custom', path: ['frozenDossier'], message: 'DOSSIER_SOURCE_SNAPSHOT_MISMATCH' });
 if (source.kind === 'saved-adaptation' && source.frozenDossier.adaptations.at(-1)?.adaptationId !== source.adaptationId)
  context.addIssue({ code: 'custom', path: ['adaptationId'], message: 'DOSSIER_SOURCE_ADAPTATION_MISMATCH' });
});
export type DossierSourceReference = z.infer<typeof DossierSourceReferenceSchema>;
export type DossierSource = z.infer<typeof DossierSourceSchema>;

/** Structural frontend-safe validation only. The host must additionally verify
 * exportDossier(frozenDossier)'s complete archive hash and its Markdown integrity.
 * Absence is the only legacy representation; never reconstruct an old source
 * from today's catalog. The frozen research dossier is host data, not actor memory.
 */
export function addPreparationDossierSourceIssues(preparation: {
 characterId: z.infer<typeof CharacterIdSchema>; dossierRevision: z.infer<typeof RevisionSchema>; dossierHash: z.infer<typeof HashSchema>; dossierSource?: DossierSource | undefined;
}, context: z.RefinementCtx): void {
 const source = preparation.dossierSource;
 if (source !== undefined && (source.characterId !== preparation.characterId || source.revision !== preparation.dossierRevision || source.contentHash !== preparation.dossierHash))
  context.addIssue({ code: 'custom', path: ['dossierSource'], message: 'PREPARATION_DOSSIER_SOURCE_MISMATCH' });
}
