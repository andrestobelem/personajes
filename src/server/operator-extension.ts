import { z } from 'zod';
import { Readable } from 'node:stream';
import { ApiProblemErrorSchema, type SessionMode } from '../domain/http.ts';

const SafeHeaderSchema = z.string().max(500).refine(value => !/[\r\n\0]/.test(value));
const HeadersSchema = z.strictObject({
  ETag: SafeHeaderSchema.optional(),
  Location: SafeHeaderSchema.refine(value => value.startsWith('/api/v1/')).optional(),
});
const JsonValueSchema = z.json();
export const OperatorResponseSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('json'), status: z.union([z.literal(200), z.literal(201), z.literal(202)]), body: JsonValueSchema, headers: HeadersSchema.default({}) }),
  z.strictObject({ kind: z.literal('binary'), status: z.literal(200),
    mimeType: z.enum(['audio/mpeg', 'audio/wav', 'audio/ogg', 'application/json', 'application/zip','application/octet-stream']),
    bytes: z.instanceof(Uint8Array).refine(bytes => bytes.byteLength <= 32 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    filename: z.string().min(1).max(150).regex(/^[A-Za-z0-9_.-]+$/).optional(),
  }),
  z.strictObject({kind:z.literal('stream'),status:z.literal(200),mimeType:z.literal('application/octet-stream'),
    bytesLength:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),sha256:z.string().regex(/^[a-f0-9]{64}$/),
    filename:z.string().min(1).max(150).regex(/^[A-Za-z0-9_.-]+$/),stream:z.instanceof(Readable),
  }),
  z.strictObject({ kind: z.literal('problem'), status: z.number().int().min(400).max(599), error: ApiProblemErrorSchema }),
]);
export type OperatorResponse = z.infer<typeof OperatorResponseSchema>;

type CommonRequest = {
  readonly path: readonly string[];
  readonly query: URLSearchParams;
  readonly principalId: string;
  readonly mode: SessionMode;
  /** Host-derived opt-ins. Omitted means no private inspection authority. */
  readonly inspectionRunIds?:readonly string[];
  readonly ifMatch: string | null;
  readonly ifNoneMatch: string | null;
};
export type OperatorRequest = CommonRequest & (
  | { readonly kind: 'read'; readonly method: 'GET' }
  | { readonly kind: 'write'; readonly method: 'POST' | 'PUT' | 'DELETE'; readonly idempotencyKey: string; readonly body: unknown }
);

/** Trusted host services share the existing local-session, origin and CSRF gate.
 * Services never receive cookies, CSRF values, provider credentials or the raw request. */
export type OperatorExtension = {
  readonly name: string;
  readonly maxBodyBytes?: number;
  matches(input: { path: readonly string[]; method: string }): boolean;
  handle(input: OperatorRequest): OperatorResponse | Promise<OperatorResponse>;
};

export function operatorJson(body: unknown, status: 200 | 201 | 202 = 200, headers: z.infer<typeof HeadersSchema> = {}): OperatorResponse {
  return OperatorResponseSchema.parse({ kind: 'json', status, body, headers });
}
