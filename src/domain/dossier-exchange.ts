import { z } from 'zod';
import { DossierEditorialPreviewContextSchema } from './dossier-edit.ts';
import { DossierSchema, DossierAdaptationImportSchema } from './catalog.ts';
import { CharacterIdSchema, HashSchema } from './values.ts';
export const DossierImportViewSchema=z.strictObject({importId:z.uuid(),revision:z.number().int().nonnegative(),kind:z.literal('dossier'),state:z.enum(['quarantined','applied']),characterId:CharacterIdSchema,sourceHash:HashSchema,fileName:z.string()});
export const ImportViewSchema=DossierImportViewSchema;
export const DossierImportPreviewMetadataSchema=z.strictObject({importId:z.uuid(),previewToken:z.uuid(),diffHash:HashSchema,expiresAt:z.number().int().nonnegative(),sourceRevision:z.number().int().nonnegative(),targetRevision:z.number().int().nonnegative(),sourceHash:HashSchema,targetHash:HashSchema,fullBeforeHash:HashSchema,fullAfterHash:HashSchema,characterId:CharacterIdSchema,editorial:DossierEditorialPreviewContextSchema.optional()});
export const DossierImportPreviewSchema=DossierImportPreviewMetadataSchema.extend({before:DossierSchema,after:DossierSchema});
export const DossierImportApplyRequestSchema=z.strictObject({previewToken:z.uuid(),confirmDiffHash:HashSchema,importId:z.uuid().optional()});
export const DossierImportAdaptationSchema=DossierAdaptationImportSchema;
export const DossierExportReceiptSchema=z.strictObject({exportId:z.uuid(),sha256:HashSchema});
export const DossierExportViewSchema=DossierExportReceiptSchema.extend({state:z.literal('succeeded'),bytes:z.number().int().nonnegative(),filename:z.literal('personajes-dossier.json')});

/** Exact operator-owned adaptation reference; Markdown hash alone does not identify metadata. */
export const DossierAdaptationSummarySchema=z.strictObject({
 adaptationId:DossierAdaptationImportSchema.shape.adaptationId,
 importId:DossierImportViewSchema.shape.importId,
 characterId:CharacterIdSchema,
 createdAt:DossierAdaptationImportSchema.shape.createdAt,
 revision:DossierSchema.shape.revision,
 contentHash:HashSchema,
 archiveHash:HashSchema,
 importedArchiveHash:HashSchema,
 fileName:DossierImportViewSchema.shape.fileName,
});
export const DossierAdaptationReadSchema=DossierAdaptationSummarySchema.extend({adaptation:DossierAdaptationImportSchema});
export const DossierAdaptationPageSchema=z.strictObject({adaptations:z.array(DossierAdaptationSummarySchema).max(100),nextCursor:z.string().max(4000).nullable()});
export type DossierAdaptationSummary=z.infer<typeof DossierAdaptationSummarySchema>;
export type DossierAdaptationRead=z.infer<typeof DossierAdaptationReadSchema>;
export type DossierAdaptationPage=z.infer<typeof DossierAdaptationPageSchema>;
