import { z } from 'zod';
import { ApiProblemSchema } from '../domain/http.ts';
import { bootstrapSession } from './client.ts';
import { MemoryPreparationJobSchema, MemoryPreparationJobPageSchema, MemoryPreparationRequestSchema, memoryPreparationContextEtag, memoryPreparationJobEtag, type MemoryPreparationJob } from '../domain/memory-preparation.ts';

const ContextSchema = MemoryPreparationRequestSchema.pick({ runId: true, expectedConfigurationRevision: true, expectedWorldRevision: true });
const BodySchema = MemoryPreparationRequestSchema.pick({ expectedConfigurationRevision: true, expectedWorldRevision: true });
const IdSchema = z.string().uuid();
export type MemoryPreparationIntent = { runId: string; key: string; expectedConfigurationRevision: number; expectedWorldRevision: number };
export type MemoryPreparationDocument = { job: MemoryPreparationJob; etag: string };
const RejectionSchema = z.strictObject({ kind: z.literal('memory-preparation-rejection'), status: z.number().int().min(400).max(499), requestId: IdSchema });
export function memoryPreparationRejection(error: unknown) { return RejectionSchema.safeParse(error).data; }
export function captureMemoryPreparationIntent(raw: MemoryPreparationIntent): MemoryPreparationIntent {
  return { runId: IdSchema.parse(raw.runId), key: IdSchema.parse(raw.key), ...BodySchema.parse({ expectedConfigurationRevision: raw.expectedConfigurationRevision, expectedWorldRevision: raw.expectedWorldRevision }) };
}
export function buildMemoryPreparationRequest(input: { intent: MemoryPreparationIntent; csrfToken: string }) {
  const intent = captureMemoryPreparationIntent(input.intent);
  return { path: `/api/v1/runs/${intent.runId}/memory-preparations`, init: { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': input.csrfToken, 'Idempotency-Key': intent.key, 'If-Match': memoryPreparationContextEtag(ContextSchema.parse({ runId: intent.runId, expectedConfigurationRevision: intent.expectedConfigurationRevision, expectedWorldRevision: intent.expectedWorldRevision })) }, body: JSON.stringify({ expectedConfigurationRevision: intent.expectedConfigurationRevision, expectedWorldRevision: intent.expectedWorldRevision }) } satisfies RequestInit };
}
async function parseResponse(response: Response): Promise<MemoryPreparationDocument> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const problem = ApiProblemSchema.safeParse(body);
    if (problem.success && response.status >= 400 && response.status < 500 && response.status !== 408) throw RejectionSchema.parse({ kind: 'memory-preparation-rejection', status: response.status, requestId: problem.data.requestId });
    throw new Error('No se confirmó la operación de preparación de memorias.');
  }
  const job = MemoryPreparationJobSchema.parse(body);
  const etag = response.headers.get('etag');
  if (etag !== memoryPreparationJobEtag(job)) throw new Error('La revisión de la preparación de memorias no coincide.');
  return { job, etag };
}
function assertScope(job: MemoryPreparationJob, intent: Pick<MemoryPreparationIntent, 'runId' | 'expectedConfigurationRevision' | 'expectedWorldRevision'>) {
  if (job.runId !== intent.runId || job.expectedConfigurationRevision !== intent.expectedConfigurationRevision || job.expectedWorldRevision !== intent.expectedWorldRevision) throw new Error('El trabajo pertenece a otro corte de preparación.');
}
export function createMemoryPreparationClient() {
  return Object.freeze({
    async history(runId: string, signal: AbortSignal) {
      const id = IdSchema.parse(runId); await bootstrapSession();
      const jobs = new Map<string, MemoryPreparationJob>(); const seen = new Set<string>(); let cursor: string | null = null;
      for (let index = 0; index < 10; ++index) {
        const query = new URLSearchParams({ limit: '100', ...(cursor === null ? {} : { cursor }) });
        const response = await fetch(`/api/v1/runs/${id}/memory-preparations?${query}`, { credentials: 'same-origin', signal });
        if (!response.ok) throw new Error('No se pudo leer la historia de memorias.');
        const page = MemoryPreparationJobPageSchema.parse(await response.json());
        for (const job of page.jobs) { if (job.runId !== id) throw new Error('La historia pertenece a otra representación.'); const prior = jobs.get(job.jobId); if (prior === undefined || prior.revision < job.revision) jobs.set(job.jobId, job); }
        if (page.nextCursor === null) return { jobs: [...jobs.values()], truncated: false };
        if (seen.has(page.nextCursor)) throw new Error('La historia no puede avanzar.'); seen.add(page.nextCursor); cursor = page.nextCursor;
      }
      return { jobs: [...jobs.values()], truncated: true };
    },
    async start(intent: MemoryPreparationIntent, signal: AbortSignal) {
      const captured = captureMemoryPreparationIntent(intent);
      const session = await bootstrapSession();
      const request = buildMemoryPreparationRequest({ intent: captured, csrfToken: session.csrfToken });
      const document = await parseResponse(await fetch(request.path, { ...request.init, signal }));
      assertScope(document.job, captured);
      return document;
    },
    async job(input: { runId: string; jobId: string }, signal: AbortSignal) {
      const runId = IdSchema.parse(input.runId); const jobId = IdSchema.parse(input.jobId);
      const document = await parseResponse(await fetch(`/api/v1/runs/${runId}/memory-preparations/${jobId}`, { credentials: 'same-origin', signal }));
      if (document.job.runId !== runId || document.job.jobId !== jobId) throw new Error('La respuesta pertenece a otra preparación de memorias.');
      return document;
    },
  });
}
export type MemoryPreparationClient = ReturnType<typeof createMemoryPreparationClient>;
