import { z } from 'zod';
import { ApiProblemSchema } from '../domain/http.ts';
import {
  ChangeCircumstancePayloadSchema,
} from '../domain/direction-indications.ts';
import { CircumstanceOptionsSchema, CircumstanceMutationResultSchema } from '../domain/direction-circumstances.ts';
import { RevisionSchema, RunIdSchema } from '../domain/values.ts';
import { bootstrapSession } from './client.ts';

const Uuid = z.string().uuid();
const IntentSchema = z.strictObject({
  runId: RunIdSchema,
  etag: z.string().min(1).max(200),
  key: Uuid,
  payload: ChangeCircumstancePayloadSchema,
});
export type CircumstanceDocument = {
  page: z.infer<typeof CircumstanceOptionsSchema>;
  etag: string;
};
export type CircumstanceIntent = z.infer<typeof IntentSchema>;

export function circumstanceEtag(runId: string, worldRevision: number, directionRevision: number) {
  return `"circumstances:${RunIdSchema.parse(runId)}:w${RevisionSchema.parse(worldRevision)}:d${RevisionSchema.parse(directionRevision)}"`;
}

export function captureCircumstanceIntent(input: CircumstanceIntent): CircumstanceIntent {
  const intent = IntentSchema.parse(input);
  const match = /^"circumstances:([0-9a-f-]{36}):w(0|[1-9]\d{0,15}):d(0|[1-9]\d{0,15})"$/.exec(intent.etag);
  if (match?.[1] !== intent.runId || !Number.isSafeInteger(Number(match[2])) || !Number.isSafeInteger(Number(match[3]))) {
    throw new Error('La revisión de circunstancias pertenece a otra representación o está mal formada.');
  }
  return intent;
}

export function buildCircumstanceRequest(input: { intent: CircumstanceIntent; csrfToken: string }) {
  const intent = captureCircumstanceIntent(input.intent);
  return {
    path: `/api/v1/runs/${intent.runId}/circumstances`,
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
    throw Object.assign(new Error(problem.success ? problem.data.error.message : 'No se pudo completar la operación de circunstancias.'), {
      status: response.status,
      retryable: response.status === 408 || response.status >= 500,
    });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error('La respuesta del host no tiene el formato esperado para circunstancias.');
  return parsed.data;
}

export function createRunCircumstanceClient(request:typeof fetch=(url,init)=>fetch(url,init),bootstrap=bootstrapSession){
  return Object.freeze({
    async read(runId:string):Promise<CircumstanceDocument>{
      const id=RunIdSchema.parse(runId);await bootstrap();
      const response=await request(`/api/v1/runs/${id}/circumstances`,{credentials:'same-origin'});
      const page=await responseBody(response,CircumstanceOptionsSchema);
      const etag=circumstanceEtag(id,page.worldRevision,page.directionRevision);
      if(page.runId!==id||response.headers.get('etag')!==etag)throw new Error('La vista de circunstancias no coincide con la corrida o revisión solicitada.');
      return {page,etag};
    },
    async mutate(input:CircumstanceIntent){
      const intent=captureCircumstanceIntent(input);const session=await bootstrap();
      const built=buildCircumstanceRequest({intent,csrfToken:session.csrfToken});
      const response=await request(built.path,built.init);const result=await responseBody(response,CircumstanceMutationResultSchema);
      if((result.kind==='stored'||result.kind==='existing')&&response.headers.get('etag')!==circumstanceEtag(intent.runId,result.receipt.worldRevision,result.receipt.directionRevision))
        throw new Error('El recibo de circunstancias no coincide. Conservá y reintentá la misma operación.');
      return result;
    },
  });
}
export type RunCircumstanceClient=ReturnType<typeof createRunCircumstanceClient>;
