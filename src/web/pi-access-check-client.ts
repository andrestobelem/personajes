import { z } from 'zod';
import { PiAccessJobPageSchema, PiAccessJobReceiptSchema, PiAccessJobViewSchema } from '../domain/http.ts';
import { SelectableInferenceProfileSchema, type SelectableInferenceProfile } from '../domain/inference-profile.ts';
import { bootstrapSession } from './client.ts';

export type PiAccessDocument = { job: z.infer<typeof PiAccessJobViewSchema>; etag: string };
export type PiAccessIntent =
  | { kind: 'start'; key: string; profile: SelectableInferenceProfile }
  | { kind: 'cancel'; key: string; document: PiAccessDocument };
const IdSchema = z.string().uuid();
export function accessJobTerminal(job: PiAccessDocument['job']) {
  return ['succeeded', 'failed', 'canceled', 'interrupted'].includes(job.state);
}
export function accessJobEtag(job: PiAccessDocument['job']) { return `"pi-access:${job.jobId}:r${job.revision}"`; }

async function parseResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) throw Object.assign(new Error('La solicitud de acceso no pudo completarse.'), { status: response.status });
  return schema.parse(await response.json());
}
export function accessFailureIsConfirmed(error: unknown) {
  const parsed = z.object({ status: z.number().int() }).passthrough().safeParse(error);
  return parsed.success && parsed.data.status >= 400 && parsed.data.status < 500 && parsed.data.status !== 408;
}
export async function executeAccessIntent(input: { intent: PiAccessIntent; csrfToken: string; request: typeof fetch; signal?: AbortSignal }): Promise<PiAccessDocument> {
  const intent = input.intent;
  const path = intent.kind === 'start' ? '/api/v1/integrations/pi/access-check'
    : `/api/v1/integrations/pi/access-check/jobs/${IdSchema.parse(intent.document.job.jobId)}`;
  const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': input.csrfToken, 'Idempotency-Key': IdSchema.parse(intent.key),
    ...(intent.kind === 'cancel' ? { 'If-Match': intent.document.etag } : {}) };
  const response = await input.request(path, { credentials: 'same-origin', method: intent.kind === 'start' ? 'POST' : 'DELETE', headers,
    body: JSON.stringify(intent.kind === 'start' ? { profile: SelectableInferenceProfileSchema.parse(intent.profile) } : {}),
    ...(input.signal === undefined ? {} : { signal: input.signal }) });
  const receipt = await parseResponse(response, PiAccessJobReceiptSchema);
  const etag = z.string().parse(response.headers.get('etag'));
  if (etag !== accessJobEtag(receipt.job) || (intent.kind === 'cancel' && receipt.job.jobId !== intent.document.job.jobId)) throw new Error('El recibo no corresponde a la operación de acceso.');
  if (intent.kind === 'start' && JSON.stringify(SelectableInferenceProfileSchema.parse(receipt.job.profile)) !== JSON.stringify(SelectableInferenceProfileSchema.parse(intent.profile))) throw new Error('El recibo corresponde a un perfil diferente del solicitado.');
  return { job: receipt.job, etag };
}
export function createPiAccessCheckClient() {
  const request: typeof fetch = (url, init) => fetch(url, init);
  return Object.freeze({
    async list(signal: AbortSignal) {
      return parseResponse(await request('/api/v1/integrations/pi/access-check/jobs?limit=100', { credentials: 'same-origin', signal }), PiAccessJobPageSchema);
    },
    async read(jobId: string, signal: AbortSignal): Promise<PiAccessDocument> {
      const response = await request(`/api/v1/integrations/pi/access-check/jobs/${IdSchema.parse(jobId)}`, { credentials: 'same-origin', signal });
      const job = await parseResponse(response, PiAccessJobViewSchema);
      const etag = z.string().parse(response.headers.get('etag'));
      if (job.jobId !== jobId || etag !== accessJobEtag(job)) throw new Error('El estado no corresponde al trabajo solicitado.');
      return { job, etag };
    },
    async execute(intent: PiAccessIntent, signal: AbortSignal) {
      const session = await bootstrapSession();
      return executeAccessIntent({ intent, csrfToken: session.csrfToken, request, signal });
    },
  });
}
export type PiAccessCheckClient = ReturnType<typeof createPiAccessCheckClient>;
