import { z } from 'zod';
import { ApiProblemSchema, PiIntegrationStatusSchema, PiOAuthInteractionViewSchema, PiOAuthJobPageSchema, PiOAuthJobReceiptSchema, PiOAuthJobViewSchema, type PiOAuthJobView } from '../domain/http.ts';
import { bootstrapSession } from './client.ts';

const KeySchema = z.string().uuid();
export type PiJobDocument = { job: PiOAuthJobView; etag: string };
export type PiOAuthIntent = { kind: 'login' | 'logout'; key: string } | { kind: 'cancel'; key: string; document: PiJobDocument };
export function piJobEtag(job: PiOAuthJobView) { return `"pi-oauth-job:${job.jobId}:r${job.revision}"`; }
export function buildPiOAuthRequest(input: { intent: PiOAuthIntent; csrfToken: string }) {
  const key = KeySchema.parse(input.intent.key);
  const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': input.csrfToken, 'Idempotency-Key': key };
  switch (input.intent.kind) {
    case 'login': return { path: '/api/v1/integrations/pi/oauth/login', init: { credentials: 'same-origin', method: 'POST', headers, body: '{}' } satisfies RequestInit };
    case 'logout': return { path: '/api/v1/integrations/pi/oauth', init: { credentials: 'same-origin', method: 'DELETE', headers } satisfies RequestInit };
    case 'cancel': {
      const job = PiOAuthJobViewSchema.parse(input.intent.document.job);
      if (input.intent.document.etag !== piJobEtag(job)) throw new Error('La revisión del trabajo de acceso no coincide.');
      return { path: `/api/v1/integrations/pi/oauth/jobs/${encodeURIComponent(job.jobId)}`, init: { credentials: 'same-origin', method: 'DELETE', headers: { ...headers, 'If-Match': input.intent.document.etag } } satisfies RequestInit };
    }
    default: { const exhaustive: never = input.intent; return exhaustive; }
  }
}
const PiOAuthHttpRejectionSchema = z.strictObject({ kind: z.literal('pi-oauth-http-rejection'), status: z.number().int().min(400).max(499), requestId: z.string().uuid() });
export function readPiOAuthHttpRejection(error: unknown) { return PiOAuthHttpRejectionSchema.safeParse(error).data; }
/** An acknowledged rejection needs current state, not replay of a rejected CAS. */
export async function reconcilePiOAuthRejection(input: { error: unknown; intent: PiOAuthIntent; readJob: PiAccessClient['job']; signal: AbortSignal }): Promise<{ kind: 'uncertain' } | { kind: 'rejected'; rejection: z.infer<typeof PiOAuthHttpRejectionSchema>; document: PiJobDocument | null }> {
  const rejection = readPiOAuthHttpRejection(input.error);
  if (rejection === undefined) return { kind: 'uncertain' };
  if (input.intent.kind !== 'cancel') return { kind: 'rejected', rejection, document: null };
  try {
    const document = await input.readJob(input.intent.document.job.jobId, input.signal);
    return { kind: 'rejected', rejection, document };
  } catch { return { kind: 'rejected', rejection, document: null }; }
}
async function readResponse<T>(response: Response, schema: z.ZodType<T>) {
  const body: unknown = await response.json();
  if (!response.ok) {
    const problem = ApiProblemSchema.safeParse(body);
    // A parsed client rejection is definitive. Network/5xx/unparsed responses remain uncertain.
    if (problem.success && response.status >= 400 && response.status < 500 && response.status !== 408) {
      throw PiOAuthHttpRejectionSchema.parse({ kind: 'pi-oauth-http-rejection', status: response.status, requestId: problem.data.requestId });
    }
    // Only the validated request identifier is returned. Error codes/messages may contain private SDK material.
    throw new Error(problem.success ? `Solicitud rechazada. Referencia: ${problem.data.requestId}.` : 'La operación de acceso no pudo completarse.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error('El estado de acceso recibido no tiene el formato esperado.');
  return parsed.data;
}
function document(job: PiOAuthJobView, response: Response): PiJobDocument {
  const etag = response.headers.get('etag');
  if (etag !== piJobEtag(job)) throw new Error('La revisión del trabajo recibido no coincide.');
  return { job, etag };
}
export async function executePiOAuthIntent(input: { intent: PiOAuthIntent; csrfToken: string; request: typeof fetch; signal?: AbortSignal }): Promise<PiJobDocument> {
  const built = buildPiOAuthRequest(input);
  const response = await input.request(built.path, { ...built.init, ...(input.signal === undefined ? {} : { signal: input.signal }) });
  const receipt = await readResponse(response, PiOAuthJobReceiptSchema);
  if (input.intent.kind === 'cancel' && receipt.job.jobId !== input.intent.document.job.jobId) throw new Error('El recibo pertenece a otro trabajo.');
  if (input.intent.kind !== 'cancel' && receipt.job.operation !== input.intent.kind) throw new Error('El recibo pertenece a otra operación.');
  return document(receipt.job, response);
}
/** Read only local durable metadata; no provider call, device code, or mutation is made. */
export async function readPiOAuthJobs(input: { request: typeof fetch; signal: AbortSignal }) {
  const jobs = new Map<string, PiOAuthJobView>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let truncated = false;
  for (let pageIndex = 0; pageIndex < 10; ++pageIndex) {
    const query = new URLSearchParams({ limit: '100', ...(cursor === null ? {} : { cursor }) });
    const response = await input.request(`/api/v1/integrations/pi/oauth/jobs?${query}`, { credentials: 'same-origin', signal: input.signal });
    const page = await readResponse(response, PiOAuthJobPageSchema);
    for (const job of page.items) {
      const prior = jobs.get(job.jobId);
      if (prior === undefined || job.revision > prior.revision) jobs.set(job.jobId, job);
    }
    truncated ||= page.truncated;
    if (page.nextCursor === null) return { items: [...jobs.values()], truncated };
    if (seenCursors.has(page.nextCursor)) throw new Error('La lista de trabajos no pudo avanzar.');
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Error('La lista de trabajos excede la ventana de recuperación del host.');
}
export function createPiAccessClient() {
  // Browser fetch requires its Window receiver; helpers must not invoke it as
  // a method on their input object. Keep the native call in this closure.
  const request: typeof fetch = (url, init) => fetch(url, init);
  return Object.freeze({
    async status(signal: AbortSignal) {
      await bootstrapSession();
      return readResponse(await fetch('/api/v1/integrations/pi/status', { credentials: 'same-origin', signal }), PiIntegrationStatusSchema);
    },
    async jobs(signal: AbortSignal) {
      await bootstrapSession();
      return readPiOAuthJobs({ request, signal });
    },
    async mutate(intent: PiOAuthIntent, signal: AbortSignal) {
      const session = await bootstrapSession();
      return executePiOAuthIntent({ intent, csrfToken: session.csrfToken, request, signal });
    },
    async job(jobId: string, signal: AbortSignal) {
      const response = await fetch(`/api/v1/integrations/pi/oauth/jobs/${encodeURIComponent(KeySchema.parse(jobId))}`, { credentials: 'same-origin', signal });
      const job = await readResponse(response, PiOAuthJobViewSchema);
      if (job.jobId !== jobId) throw new Error('El estado pertenece a otro trabajo.');
      return document(job, response);
    },
    async interaction(jobId: string, after: number, signal: AbortSignal) {
      const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(after);
      return readResponse(await fetch(`/api/v1/integrations/pi/oauth/jobs/${encodeURIComponent(KeySchema.parse(jobId))}/interaction?after=${cursor}`, { credentials: 'same-origin', signal }), PiOAuthInteractionViewSchema);
    },
  });
}
export type PiAccessClient = ReturnType<typeof createPiAccessClient>;
export function piJobIsTerminal(job: PiOAuthJobView) { return job.state === 'succeeded' || job.state === 'failed' || job.state === 'canceled' || job.state === 'interrupted'; }
