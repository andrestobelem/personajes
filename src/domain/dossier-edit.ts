import { z } from 'zod';
import { DossierSchema } from './catalog.ts';
import { DossierSourceReferenceSchema, DossierSourceSchema } from './dossier-source.ts';
export const DossierEditableFieldsSchema = DossierSchema.pick({displayName:true,aliases:true,performers:true,markdown:true,sourceRefs:true,unknowns:true,contradictions:true,avatarRef:true,voiceRecipe:true});
export type DossierEditableFields = z.infer<typeof DossierEditableFieldsSchema>;
export const DossierEditRequestSchema = z.strictObject({source:DossierSourceReferenceSchema,fields:DossierEditableFieldsSchema,reason:z.string().trim().min(1).max(4000)});
export const DossierEditorialPreviewContextSchema = z.strictObject({kind:z.literal('operator-edit'),parent:DossierSourceSchema});
export type DossierEditRequest = z.infer<typeof DossierEditRequestSchema>;
