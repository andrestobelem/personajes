import { z } from 'zod';
import { ApiProblemSchema } from '../domain/http.ts';
import {
  DirectionEventsPageSchema,
  DirectionMutationResultSchema,
  MetaIndicationPayloadSchema,
} from '../domain/direction-indications.ts';
import { RevisionSchema, RunIdSchema } from '../domain/values.ts';
import { bootstrapSession } from './client.ts';

const Uuid = z.string().uuid();
const IntentSchema = z.strictObject({
  runId: RunIdSchema,
  etag: z.string().min(1).max(200),
  key: Uuid,
  payload: MetaIndicationPayloadSchema,
});
export type DirectionDocument = {
  page: z.infer<typeof DirectionEventsPageSchema>;
  etag: string;
};
export type DirectionIntent = z.infer<typeof IntentSchema>;

export function directionEtag(runId: string, revision: number) {
  return `"directions:${RunIdSchema.parse(runId)}:d${RevisionSchema.parse(revision)}"`;
}

export function captureDirectionIntent(input: DirectionIntent): DirectionIntent {
  const intent = IntentSchema.parse(input);
  const match = /^"directions:([0-9a-f-]{36}):d(0|[1-9]\d{0,15})"$/.exec(intent.etag);
  if (match?.[1] !== intent.runId || !Number.isSafeInteger(Number(match[2]))) {
    throw new Error('La revisión de Dirección pertenece a otra representación o está mal formada.');
  }
  return intent;
}

export function buildDirectionRequest(input: { intent: DirectionIntent; csrfToken: string }) {
  const intent = captureDirectionIntent(input.intent);
  return {
    path: `/api/v1/runs/${intent.runId}/directions`,
    init: {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': input.csrfToken,
        'If-Match': intent.etag,
        'Idempotency-Key': intent.key,
      },
      body: JSON.stringify(intent.payload),
    } satisfies RequestInit,
  };
}

async function responseBody<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const raw: unknown = await response.json();
  if (!response.ok) {
    const problem = ApiProblemSchema.safeParse(raw);
    throw Object.assign(new Error(problem.success ? problem.data.error.message : 'No se pudo completar la operación de Dirección.'), {
      status: response.status,
      retryable: response.status === 408 || response.status >= 500,
    });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error('La respuesta del host no tiene el formato esperado para Dirección.');
  return parsed.data;
}

export function createRunDirectionClient(
  request: typeof fetch = (url, init) => fetch(url, init),
  bootstrap = bootstrapSession,
) {
  return Object.freeze({
    async read(runId: string, afterDirectionRevision = 0, limit = 1_000): Promise<DirectionDocument> {
      const validRunId = RunIdSchema.parse(runId);
      const after = RevisionSchema.parse(afterDirectionRevision);
      const boundedLimit = z.number().int().min(1).max(1_000).parse(limit);
      await bootstrap();
      const query = new URLSearchParams({ afterDirectionRevision: String(after), limit: String(boundedLimit) });
      const response = await request(`/api/v1/runs/${validRunId}/directions?${query}`, { credentials: 'same-origin' });
      const page = await responseBody(response, DirectionEventsPageSchema);
      const etag = directionEtag(validRunId, page.directionRevision);
      if (response.headers.get('etag') !== etag || page.events.some((event) => event.runId !== validRunId || event.directionRevision > page.directionRevision)) {
        throw new Error('El ledger de Dirección no coincide con la corrida o revisión solicitada.');
      }
      return { page, etag };
    },
    async mutate(input: DirectionIntent) {
      const intent = captureDirectionIntent(input);
      const session = await bootstrap();
      const built = buildDirectionRequest({ intent, csrfToken: session.csrfToken });
      const response = await request(built.path, built.init);
      const result = await responseBody(response, DirectionMutationResultSchema);
      if (result.kind === 'stored' || result.kind === 'existing') {
        if (response.headers.get('etag') !== directionEtag(intent.runId, result.receipt.directionRevision)) {
          throw new Error('El recibo de Dirección pertenece a otra revisión. Conservá y reintentá la misma operación.');
        }
      }
      return result;
    },
  });
}
export type RunDirectionClient = ReturnType<typeof createRunDirectionClient>;
