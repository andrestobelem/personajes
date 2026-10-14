import { z } from 'zod';
import { ApiProblemSchema, RunConfigurationDraftMutationReceiptSchema, RunConfigurationDraftPageSchema, RunConfigurationDraftViewSchema, RunConfigurationValidationReceiptSchema, type RunConfigurationDraftView } from '../domain/http.ts';
import { RunConfigurationDraftSchema, type RunConfigurationDraft } from '../domain/production.ts';
import { bootstrapSession } from './client.ts';

const FailureSchema = z.object({ kind: z.literal('draft-http-failure'), status: z.number().int(), problem: ApiProblemSchema.nullable() });
export function readDraftHttpFailure(error: unknown) { return FailureSchema.safeParse(error).data; }
const EtagSchema = z.string().regex(/^"run-config:[0-9a-f-]{36}:c\d+"$/);
export type DraftDocument = { view: RunConfigurationDraftView; etag: string };
type DraftSaveInput = { kind: 'create'; configuration: RunConfigurationDraft; key: string }
  | { kind: 'replace'; configuration: RunConfigurationDraft; key: string; etag: string };
export type DraftSaveIntent = DraftSaveInput & { readonly body: string };
/** Snapshot once: uncertain retries carry the same key and serialized payload. */
export function createDraftSaveIntent(input: DraftSaveInput): DraftSaveIntent {
  const configuration = RunConfigurationDraftSchema.parse(input.configuration);
  return { ...input, configuration, body: JSON.stringify({ configuration }) };
}
export function buildDraftSaveRequest(input: { intent: DraftSaveIntent; csrfToken: string }) {
  const { intent } = input;
  return {
    path: intent.kind === 'create' ? '/api/v1/runs' : `/api/v1/runs/${encodeURIComponent(intent.configuration.runId)}/configuration`,
    init: { credentials: 'same-origin', method: intent.kind === 'create' ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': input.csrfToken, 'Idempotency-Key': intent.key,
        ...(intent.kind === 'replace' ? { 'If-Match': EtagSchema.parse(intent.etag) } : { 'If-None-Match': '*' }) }, body: intent.body } satisfies RequestInit,
  };
}

async function readResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const problem = ApiProblemSchema.safeParse(body);
    throw Object.assign(new Error(problem.success ? problem.data.error.message : 'La operación no pudo completarse.'),
      { kind: 'draft-http-failure', status: response.status, problem: problem.success ? problem.data : null });
  }
  return schema.parse(body);
}
export async function listRunDrafts(input: { cursor?: string } = {}) {
  await bootstrapSession();
  const query = new URLSearchParams({ limit: '100', ...(input.cursor === undefined ? {} : { cursor: input.cursor }) });
  const response = await fetch(`/api/v1/runs?${query}`, { credentials: 'same-origin' });
  return readResponse(response, RunConfigurationDraftPageSchema);
}
export async function readRunDraft(runId: string): Promise<DraftDocument> {
  const response = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}/configuration`, { credentials: 'same-origin' });
  const view = await readResponse(response, RunConfigurationDraftViewSchema);
  return { view, etag: EtagSchema.parse(response.headers.get('etag')) };
}
export type DraftSaveResult = {
  kind: 'current' | 'advanced';
  acknowledged: { configuration: RunConfigurationDraft; etag: string };
  document: DraftDocument;
};
/** A mutation receipt acknowledges its own revision; the subsequent read is separate. */
export async function executeDraftSave(input: { intent: DraftSaveIntent; csrfToken: string; request: typeof fetch }): Promise<DraftSaveResult> {
  const request = buildDraftSaveRequest({ intent: input.intent, csrfToken: input.csrfToken });
  const response = await input.request(request.path, request.init);
  const receipt = await readResponse(response, RunConfigurationDraftMutationReceiptSchema);
  const etag = EtagSchema.parse(response.headers.get('etag'));
  if (etag !== `"run-config:${receipt.configuration.runId}:c${receipt.configuration.revision}"`
    || (input.intent.kind === 'replace' && receipt.configuration.runId !== input.intent.configuration.runId)) {
    throw new Error('El recibo de guardado no corresponde a esta preparación.');
  }
  const currentResponse = await input.request(`/api/v1/runs/${encodeURIComponent(receipt.configuration.runId)}/configuration`, { credentials: 'same-origin' });
  const view = await readResponse(currentResponse, RunConfigurationDraftViewSchema);
  const currentEtag = EtagSchema.parse(currentResponse.headers.get('etag'));
  if (view.configuration.runId !== receipt.configuration.runId || view.configuration.revision < receipt.configuration.revision
    || currentEtag !== `"run-config:${view.configuration.runId}:c${view.configuration.revision}"`) {
    throw new Error('La lectura actual no corresponde al recibo de guardado.');
  }
  const sameRevision = view.configuration.revision === receipt.configuration.revision;
  if (sameRevision && JSON.stringify(view.configuration) !== JSON.stringify(receipt.configuration)) throw new Error('La revisión leída difiere del contenido confirmado.');
  return { kind: sameRevision ? 'current' : 'advanced', acknowledged: { configuration: receipt.configuration, etag }, document: { view, etag: currentEtag } };
}
export async function saveRunDraft(intent: DraftSaveIntent): Promise<DraftSaveResult> {
  const session = await bootstrapSession();
  return executeDraftSave({ intent, csrfToken: session.csrfToken, request: (url, init) => fetch(url, init) });
}
export async function validateRunDraft(input: { document: DraftDocument; key: string }): Promise<DraftDocument> {
  const session = await bootstrapSession();
  const response = await fetch(`/api/v1/runs/${encodeURIComponent(input.document.view.configuration.runId)}/validate`, {
    credentials: 'same-origin', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken,
      'Idempotency-Key': input.key, 'If-Match': EtagSchema.parse(input.document.etag) }, body: '{}',
  });
  const receipt = await readResponse(response, RunConfigurationValidationReceiptSchema);
  if (receipt.runId !== input.document.view.configuration.runId || receipt.revision !== input.document.view.configuration.revision) {
    throw new Error('La validación recibida no corresponde a esta revisión.');
  }
  return readRunDraft(receipt.runId);
}
