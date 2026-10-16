import { z } from 'zod';
import { HashSchema, RevisionSchema, RunIdSchema, WorldSeqSchema } from './values.ts';

export const ScriptExportRequestSchema = z.strictObject({ runId: RunIdSchema, commitIndex: RevisionSchema, idempotencyKey: z.uuid() });
export const ScriptExportFilenameSchema = z.string().max(150).regex(/^[a-z0-9-]+-[a-f0-9-]{36}-c\d+-[a-f0-9]{16}\.fountain$/);
export const ScriptExportReceiptSchema = z.strictObject({
  kind: z.literal('script-export'), runId: RunIdSchema, commitIndex: RevisionSchema, worldRevision: RevisionSchema, worldSeq: WorldSeqSchema,
  configurationRevision: RevisionSchema, format: z.literal('fountain'), filename: ScriptExportFilenameSchema,
  relativePath: z.string().startsWith('docs/output/').max(170), sha256: HashSchema, bytes: z.number().int().nonnegative().safe(),
  eventCount: z.number().int().nonnegative().safe(), communicationCount: z.number().int().nonnegative().safe(), narrationCount: z.number().int().nonnegative().safe(),
}).superRefine((value, context) => { if (value.relativePath !== `docs/output/${value.filename}`) context.addIssue({ code: 'custom', message: 'Ruta de guion inválida.' }); });
export type ScriptExportReceipt = z.infer<typeof ScriptExportReceiptSchema>;
