import { z } from 'zod';
import { ApiProblemSchema, RunConfigurationDraftViewSchema, RunPreflightJobDocumentSchema, RunPreflightJobPageSchema, RunPreflightJobReceiptSchema, type RunPreflightJobDocument, type RunPreflightJobView } from '../domain/http.ts';
import { bootstrapSession } from './client.ts';
import type { DraftDocument } from './run-drafts-client.ts';
import { RunModelTimeBudgetSchema } from '../domain/model-time-budget.ts';
import type { RunModelTimeBudget } from '../domain/model-time-budget.ts';

export type PreflightDocument = { value: RunPreflightJobDocument; etag: string };
export type PreflightIntent = { kind: 'evaluate'; key: string; runId: string; configurationRevision: number; worldRevision: number }
  | { kind: 'cancel'; key: string; document: PreflightDocument };
const KeySchema = z.string().uuid();
const RevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export function preflightEtag(job: RunPreflightJobView) { return `"run-preflight:${job.jobId}:r${job.revision}"`; }
export function preflightTerminal(job: RunPreflightJobView) { return ['completed', 'failed', 'canceled', 'interrupted'].includes(job.state); }
export function capturePreflightIntent(input: { document: DraftDocument; key: string }): PreflightIntent {
  const view = RunConfigurationDraftViewSchema.parse(input.document.view);
  if (view.state.lifecycle !== 'ready' || view.state.worldRevision === null || view.validation.kind !== 'valid' || view.validation.promotion !== 'promoted') throw new Error('Guardá y validá una configuración Ready antes de comprobar la ejecución.');
  if (view.configuration.revision !== view.state.configurationRevision || input.document.etag !== `"run-config:${view.configuration.runId}:c${view.state.configurationRevision}"`) throw new Error('La preparación guardada no coincide con su revisión.');
  return { kind: 'evaluate', key: KeySchema.parse(input.key), runId: view.configuration.runId, configurationRevision: view.state.configurationRevision, worldRevision: view.state.worldRevision };
}
export function buildPreflightRequest(input: { intent: PreflightIntent; csrfToken: string }) {
  const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': input.csrfToken, 'Idempotency-Key': KeySchema.parse(input.intent.key) };
  if (input.intent.kind === 'evaluate') {
    const runId = KeySchema.parse(input.intent.runId);
    return { path: `/api/v1/runs/${runId}/preflight`, init: { method: 'POST', credentials: 'same-origin', headers: { ...headers, 'If-Match': `"run:${runId}:c${RevisionSchema.parse(input.intent.configurationRevision)}:w${RevisionSchema.parse(input.intent.worldRevision)}"` }, body: '{}' } satisfies RequestInit };
  }
  const value = RunPreflightJobDocumentSchema.parse(input.intent.document.value);
  if (input.intent.document.etag !== preflightEtag(value.job)) throw new Error('La revisión del trabajo no coincide.');
  return { path: `/api/v1/runs/${value.job.runId}/preflight/jobs/${value.job.jobId}`, init: { method: 'DELETE', credentials: 'same-origin', headers: { ...headers, 'If-Match': input.intent.document.etag } } satisfies RequestInit };
}
const RejectionSchema = z.strictObject({ kind: z.literal('preflight-http-rejection'), status: z.number().int().min(400).max(499), requestId: KeySchema });
export function preflightRejection(error: unknown) { return RejectionSchema.safeParse(error).data; }
async function parseResponse<T>(response: Response, schema: z.ZodType<T>) {
  const body: unknown = await response.json();
  if (!response.ok) {
    const problem = ApiProblemSchema.safeParse(body);
    if (problem.success && response.status >= 400 && response.status < 500 && response.status !== 408) throw RejectionSchema.parse({ kind: 'preflight-http-rejection', status: response.status, requestId: problem.data.requestId });
    throw new Error('No se pudo confirmar la operación de comprobación.');
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new Error('La respuesta de comprobación no tiene el formato esperado.');
  return result.data;
}
function checkedDocument(value: RunPreflightJobDocument, response: Response) {
  const etag = response.headers.get('etag');
  if (etag !== preflightEtag(value.job)) throw new Error('La revisión de comprobación recibida no coincide.');
  return { value, etag };
}
export async function executePreflightIntent(input: { intent: PreflightIntent; csrfToken: string; request: typeof fetch; signal: AbortSignal }) {
  const built = buildPreflightRequest(input);
  const response = await input.request(built.path, { ...built.init, signal: input.signal });
  const receipt = await parseResponse(response, RunPreflightJobReceiptSchema);
  const expectedRun = input.intent.kind === 'evaluate' ? input.intent.runId : input.intent.document.value.job.runId;
  if (receipt.job.runId !== expectedRun || response.headers.get('etag') !== preflightEtag(receipt.job)) throw new Error('El recibo pertenece a otro ámbito o revisión.');
  if (input.intent.kind === 'evaluate' && (receipt.job.configurationRevision !== input.intent.configurationRevision || receipt.job.worldRevision !== input.intent.worldRevision || receipt.job.state !== 'queued' || receipt.job.revision !== 0)) throw new Error('El recibo inicial no corresponde al corte solicitado.');
  if (input.intent.kind === 'cancel' && receipt.job.jobId !== input.intent.document.value.job.jobId) throw new Error('La cancelación pertenece a otro trabajo.');
  // No report is invented from the immutable receipt. Read its current document separately.
  return receipt.job;
}
export async function readPreflightHistory(input: { runId: string; request: typeof fetch; signal: AbortSignal }) {
  const runId = KeySchema.parse(input.runId); const items = new Map<string, RunPreflightJobDocument>(); const cursors = new Set<string>();
  let cursor: string | null = null; let truncated = false;
  for (let index = 0; index < 10; ++index) {
    const query = new URLSearchParams({ limit: '100', ...(cursor === null ? {} : { cursor }) });
    const page = await parseResponse(await input.request(`/api/v1/runs/${runId}/preflight/jobs?${query}`, { credentials: 'same-origin', signal: input.signal }), RunPreflightJobPageSchema);
    for (const value of page.items) { if (value.job.runId !== runId) throw new Error('La historia pertenece a otra corrida.'); const prior = items.get(value.job.jobId); if (prior === undefined || prior.job.revision < value.job.revision) items.set(value.job.jobId, value); }
    truncated ||= page.truncated;
    if (page.nextCursor === null) return { items: [...items.values()], truncated };
    if (cursors.has(page.nextCursor)) throw new Error('La historia de comprobación no pudo avanzar.');
    cursors.add(page.nextCursor); cursor = page.nextCursor;
  }
  throw new Error('La historia excede la ventana de recuperación.');
}
export function createRunPreflightClient() {
  const request: typeof fetch = (url, options) => fetch(url, options);
  return Object.freeze({
    async budget(runId: string, signal: AbortSignal): Promise<RunModelTimeBudget> {
      await bootstrapSession();
      const value = await parseResponse(await request(`/api/v1/runs/${KeySchema.parse(runId)}/budget`, { credentials: 'same-origin', signal }), RunModelTimeBudgetSchema);
      if (value.runId !== runId) throw new Error('El presupuesto pertenece a otra corrida.');
      return value;
    },
    async history(runId: string, signal: AbortSignal) { await bootstrapSession(); return readPreflightHistory({ runId, request, signal }); },
    async job(runId: string, jobId: string, signal: AbortSignal): Promise<PreflightDocument> {
      const response = await fetch(`/api/v1/runs/${KeySchema.parse(runId)}/preflight/jobs/${KeySchema.parse(jobId)}`, { credentials: 'same-origin', signal });
      const value = await parseResponse(response, RunPreflightJobDocumentSchema);
      if (value.job.runId !== runId || value.job.jobId !== jobId) throw new Error('El trabajo pertenece a otro ámbito.');
      return checkedDocument(value, response);
    },
    async mutate(intent: PreflightIntent, signal: AbortSignal) { const session = await bootstrapSession(); return executePreflightIntent({ intent, csrfToken: session.csrfToken, request, signal }); },
  });
}
export type RunPreflightClient = ReturnType<typeof createRunPreflightClient>;
