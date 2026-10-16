import { z } from 'zod';
import { bootstrapSession } from './client.ts';
import { ScriptExportReceiptSchema, ScriptExportRequestSchema } from '../domain/script-export.ts';

export const ScriptExportIntentSchema = ScriptExportRequestSchema;
export type ScriptExportIntent = z.infer<typeof ScriptExportIntentSchema>;
export class ScriptExportRejection extends Error { constructor(readonly status: number) { super('No se pudo guardar el guion.'); } }
export function createScriptExportClient(request: typeof fetch = (url, init) => fetch(url, init), bootstrap = bootstrapSession) {
  return { async export(raw: ScriptExportIntent, signal: AbortSignal) {
    const intent = ScriptExportIntentSchema.parse(raw), session = await bootstrap();
    const response = await request(`/api/v1/runs/${intent.runId}/script-exports`, { method: 'POST', credentials: 'same-origin', signal,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': intent.idempotencyKey }, body: JSON.stringify({ commitIndex: intent.commitIndex }) });
    if (!response.ok) { if (response.status >= 400 && response.status < 500 && response.status !== 408) throw new ScriptExportRejection(response.status); throw new Error('Resultado de exportación incierto'); }
    const receipt = ScriptExportReceiptSchema.parse(await response.json());
    if (receipt.runId !== intent.runId || receipt.commitIndex !== intent.commitIndex) throw new Error('Guion de otro corte');
    return receipt;
  } };
}
export type ScriptExportClient = ReturnType<typeof createScriptExportClient>;
