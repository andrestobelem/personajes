import { z } from 'zod';
import { ApiProblemSchema } from '../domain/http.ts';
import { IcmRuntimeConfigurationRequestSchema, IcmRuntimeConfigurationViewSchema, IcmRuntimeConfigurationJobSchema, IcmRuntimeConfigurationJobPageSchema, icmRuntimeConfigurationEtag, icmRuntimeConfigurationJobEtag, type IcmRuntimeConfigurationView, type IcmRuntimeConfigurationJob } from '../domain/icm-runtime-configuration.ts';
import { bootstrapSession } from './client.ts';
const IdSchema = z.uuid();
const IntentSchema = IcmRuntimeConfigurationRequestSchema.pick({ expectedRevision: true, binaryPath: true }).extend({ key: IdSchema, etag: z.string().min(1).max(240) }).strict();
export type IcmRuntimeConfigurationIntent = z.infer<typeof IntentSchema>;
export type IcmConfigurationDocument = { value: IcmRuntimeConfigurationView; etag: string };
export type IcmConfigurationJobDocument = { job: IcmRuntimeConfigurationJob; etag: string };
const RejectionSchema = z.strictObject({ kind: z.literal('icm-configuration-rejection'), status: z.number().int().min(400).max(499), requestId: IdSchema });
export function icmConfigurationRejection(error: unknown) { return RejectionSchema.safeParse(error).data; }
export function captureIcmConfigurationIntent(input: { document: IcmConfigurationDocument; binaryPath: string | null; key: string }): IcmRuntimeConfigurationIntent {
  const value = IcmRuntimeConfigurationViewSchema.parse(input.document.value); if (input.document.etag !== icmRuntimeConfigurationEtag(value)) throw new Error('La configuración no coincide con su revisión.');
  return IntentSchema.parse({ key: input.key, expectedRevision: value.revision, binaryPath: input.binaryPath, etag: input.document.etag });
}
export function buildIcmConfigurationRequest(input: { intent: IcmRuntimeConfigurationIntent; csrfToken: string }) {
  const intent = IntentSchema.parse(input.intent);
  return { path: '/api/v1/host/icm-runtime-configuration/jobs', init: { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': input.csrfToken, 'Idempotency-Key': intent.key, 'If-Match': intent.etag }, body: JSON.stringify({ expectedRevision: intent.expectedRevision, binaryPath: intent.binaryPath }) } satisfies RequestInit };
}
async function readResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await response.json(); if (!response.ok) { const problem = ApiProblemSchema.safeParse(body); if (problem.success && response.status >= 400 && response.status < 500 && response.status !== 408) throw RejectionSchema.parse({ kind: 'icm-configuration-rejection', status: response.status, requestId: problem.data.requestId }); throw new Error('No se confirmó la configuración ICM.'); } return schema.parse(body);
}
async function jobDocument(response: Response): Promise<IcmConfigurationJobDocument> { const job = await readResponse(response, IcmRuntimeConfigurationJobSchema); const etag = response.headers.get('etag'); if (etag !== icmRuntimeConfigurationJobEtag(job)) throw new Error('La revisión del trabajo ICM no coincide.'); return { job, etag }; }
export function createIcmRuntimeConfigurationClient() {
  return Object.freeze({
    async configuration(signal: AbortSignal): Promise<IcmConfigurationDocument> { await bootstrapSession(); const response = await fetch('/api/v1/host/icm-runtime-configuration', { credentials: 'same-origin', signal }); const value = await readResponse(response, IcmRuntimeConfigurationViewSchema); const etag = response.headers.get('etag'); if (etag !== icmRuntimeConfigurationEtag(value)) throw new Error('La revisión ICM no coincide.'); return { value, etag }; },
    async start(intent: IcmRuntimeConfigurationIntent, signal: AbortSignal) { const session = await bootstrapSession(); const built = buildIcmConfigurationRequest({ intent, csrfToken: session.csrfToken }); const document = await jobDocument(await fetch(built.path, { ...built.init, signal })); if (document.job.binaryPath !== intent.binaryPath || document.job.expectedConfigurationRevision !== intent.expectedRevision) throw new Error('El trabajo ICM pertenece a otra configuración.'); return document; },
    async job(jobId: string, signal: AbortSignal) { const id = IdSchema.parse(jobId); const document = await jobDocument(await fetch(`/api/v1/host/icm-runtime-configuration/jobs/${id}`, { credentials: 'same-origin', signal })); if (document.job.jobId !== id) throw new Error('El trabajo ICM pertenece a otra operación.'); return document; },
    async history(signal: AbortSignal) { await bootstrapSession(); const jobs = new Map<string, IcmRuntimeConfigurationJob>(); const seen = new Set<string>(); let cursor: string | null = null;
      for (let index = 0; index < 10; ++index) { const query = new URLSearchParams({ limit: '100', ...(cursor === null ? {} : { cursor }) }); const page = await readResponse(await fetch(`/api/v1/host/icm-runtime-configuration/jobs?${query}`, { credentials: 'same-origin', signal }), IcmRuntimeConfigurationJobPageSchema); for (const job of page.jobs) { const prior = jobs.get(job.jobId); if (prior === undefined || prior.revision < job.revision) jobs.set(job.jobId, job); } if (page.nextCursor === null) return { jobs: [...jobs.values()], truncated: false }; if (seen.has(page.nextCursor)) throw new Error('La historia ICM no avanza.'); seen.add(page.nextCursor); cursor = page.nextCursor; } return { jobs: [...jobs.values()], truncated: true };
    },
  });
}
export type IcmRuntimeConfigurationClient = ReturnType<typeof createIcmRuntimeConfigurationClient>;
