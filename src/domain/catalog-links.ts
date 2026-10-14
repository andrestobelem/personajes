import { z } from 'zod';
import { CatalogCharacterEntrySchema, CatalogDocumentEntrySchema } from './catalog.ts';

export const CatalogReferenceQuerySchema = z.strictObject({
  sourceKind: z.enum(['character', 'document']),
  sourceId: CatalogDocumentEntrySchema.shape.id,
  reference: z.string().min(1).max(2_000).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
});
export type CatalogReferenceQuery = z.infer<typeof CatalogReferenceQuerySchema>;

export const CatalogReferenceTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('character'), id: CatalogCharacterEntrySchema.shape.characterId, title: CatalogCharacterEntrySchema.shape.displayName }),
  z.strictObject({ kind: z.literal('document'), id: CatalogDocumentEntrySchema.shape.id, title: CatalogDocumentEntrySchema.shape.title }),
  z.strictObject({ kind: z.literal('paper'), id: CatalogDocumentEntrySchema.shape.id, title: CatalogDocumentEntrySchema.shape.title }),
  z.strictObject({ kind: z.literal('unavailable') }),
]);
export type CatalogReferenceTarget = z.infer<typeof CatalogReferenceTargetSchema>;
