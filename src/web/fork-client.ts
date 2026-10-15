import { z } from 'zod';
import { ApiProblemSchema } from '../domain/http.ts';
import { ForkBeginBodySchema, ForkJobViewSchema, ForkSourceSelectionSchema, forkJobEtag, forkSourceEtag, type ForkJobView } from '../domain/fork-http.ts';
import { OperationIdSchema } from '../domain/values.ts';
import { bootstrapSession } from './client.ts';

const ForkIntentSchema = z.strictObject({ source: ForkSourceSelectionSchema, body: ForkBeginBodySchema, key: z.string().uuid() }).superRefine((value, context) => {
  if (value.source.commitIndex !== value.body.commitIndex || value.source.worldRevision !== value.body.worldRevision || value.source.worldSeq !== value.body.worldSeq) context.addIssue({ code: 'custom', message: 'El contenido no corresponde al corte elegido.' });
});
export type ForkIntent = z.infer<typeof ForkIntentSchema>;
export type ForkSourceSelection = z.infer<typeof ForkSourceSelectionSchema>;
export function captureForkIntent(input: z.input<typeof ForkIntentSchema>): ForkIntent { return ForkIntentSchema.parse(input); }
export function buildForkRequest(input: { intent: ForkIntent; csrfToken: string }) {
  const intent = captureForkIntent(input.intent);
  return { path: `/api/v1/runs/${intent.source.runId}/forks`, init: { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': input.csrfToken, 'Idempotency-Key': intent.key, 'If-Match': forkSourceEtag(intent.source) }, body: JSON.stringify(intent.body) } satisfies RequestInit };
}
type IntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
function storageKey(runId: string) { return `personajes:fork-intent:${ForkSourceSelectionSchema.shape.runId.parse(runId)}`; }
export function readStoredForkIntent(storage: IntentStorage, runId: string): ForkIntent | null {
  try {
    const raw = storage.getItem(storageKey(runId));
    if (raw === null) return null;
    const intent = captureForkIntent(JSON.parse(raw));
    return intent.source.runId === runId ? intent : null;
  } catch { return null; }
}
export function writeStoredForkIntent(storage: IntentStorage, runId: string, intent: ForkIntent | null): boolean {
  try {
    const key = storageKey(runId);
    if (intent === null) storage.removeItem(key);
    else { const valid = captureForkIntent(intent); if (valid.source.runId !== runId) return false; storage.setItem(key, JSON.stringify(valid)); }
    return true;
  } catch { return false; }
}
async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const raw: unknown = await response.json();
  if (!response.ok) {
    const problem = ApiProblemSchema.safeParse(raw);
    throw Object.assign(new Error(problem.success ? problem.data.error.message : 'No se pudo consultar la bifurcación.'), { status: response.status });
  }
  return schema.parse(raw);
}
function validateJob(response: Response, job: ForkJobView, operationId: string) {
  if (job.operationId !== operationId || response.headers.get('etag') !== forkJobEtag(job)) throw new Error('La respuesta pertenece a otra operación o revisión.');
  return job;
}
/** Keep confirmed publication monotonic when a poll and an explicit refresh overlap. */
export function newerForkJob(current: ForkJobView | null, incoming: ForkJobView): ForkJobView {
  if (current === null) return incoming;
  if (current.operationId !== incoming.operationId || current.targetRunId !== incoming.targetRunId || current.source.runId !== incoming.source.runId || current.source.commitIndex !== incoming.source.commitIndex || current.source.snapshotHash !== incoming.source.snapshotHash) return current;
  if (incoming.revision < current.revision || (current.state === 'ready' && incoming.state !== 'ready')) return current;
  return incoming;
}
export function createForkClient(request: typeof fetch = (url, init) => fetch(url, init), bootstrap = bootstrapSession) {
  return Object.freeze({
    async begin(input: ForkIntent, signal: AbortSignal) {
      const intent = captureForkIntent(input);
      const session = await bootstrap();
      const built = buildForkRequest({ intent, csrfToken: session.csrfToken });
      const response = await request(built.path, { ...built.init, signal });
      const job = validateJob(response, await parse(response, ForkJobViewSchema), intent.body.operationId);
      if (job.source.runId !== intent.source.runId || job.source.commitIndex !== intent.source.commitIndex || job.source.worldRevision !== intent.source.worldRevision || job.source.worldSeq !== intent.source.worldSeq || job.name !== intent.body.name || job.reason !== intent.body.reason) throw new Error('La bifurcación recibida no corresponde al intento conservado.');
      return job;
    },
    async read(operationId: string, signal: AbortSignal) {
      const id = OperationIdSchema.parse(operationId);
      await bootstrap();
      const response = await request(`/api/v1/forks/${id}`, { credentials: 'same-origin', signal });
      return validateJob(response, await parse(response, ForkJobViewSchema), id);
    },
    async retry(input: { job: ForkJobView; key: string }, signal: AbortSignal) {
      const job = ForkJobViewSchema.parse(input.job);
      const key = z.string().uuid().parse(input.key);
      const session = await bootstrap();
      const response = await request(`/api/v1/forks/${job.operationId}/retry`, { method: 'POST', credentials: 'same-origin', signal, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': key, 'If-Match': forkJobEtag(job) }, body: '{}' });
      const next = validateJob(response, await parse(response, ForkJobViewSchema), job.operationId);
      if (next.targetRunId !== job.targetRunId || next.source.runId !== job.source.runId || next.source.commitIndex !== job.source.commitIndex || next.source.snapshotHash !== job.source.snapshotHash || next.revision < job.revision) throw new Error('El reintento cambió el destino reservado.');
      return next;
    },
  });
}
export type ForkClient = ReturnType<typeof createForkClient>;
