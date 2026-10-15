import { z } from 'zod';
import { MemoryPreparationJobSchema, MemoryPreparationJobPageSchema, MemoryPreparationRequestSchema, MemoryPreparationStartResultSchema, memoryPreparationContextEtag, memoryPreparationJobEtag, type MemoryPreparationRequest } from '../domain/memory-preparation.ts';
import { operatorJson, OperatorResponseSchema, type OperatorExtension, type OperatorRequest } from './operator-extension.ts';
const IdSchema = z.uuid();
const RunIdSchema = MemoryPreparationRequestSchema.shape.runId;
const BodySchema = MemoryPreparationRequestSchema.pick({ expectedConfigurationRevision: true, expectedWorldRevision: true });
export type MemoryPreparationApplicationPort = {
  start(input: MemoryPreparationRequest): unknown | Promise<unknown>;
  read(input: { runId: string; jobId: string; principalId: string }): unknown | Promise<unknown>;
  list(input: { runId: string; principalId: string; cursor?: string; limit?: number }): unknown | Promise<unknown>;
};
function problem(status: number, code: string) {
  const kind = status === 404 ? 'notFound' : status === 412 ? 'precondition' : status === 422 ? 'validation' : status === 503 ? 'dependency' : 'conflict';
  return OperatorResponseSchema.parse({ kind: 'problem', status, error: { kind, code, message: 'La preparación o reapertura de memorias requiere una puesta Ready, pausada o detenida, un corte vigente y sus dependencias disponibles.', ...(kind === 'validation' ? { issues: [] } : {}), ...(kind === 'dependency' ? { safeCode: code, retryable: false } : {}) } });
}
function query(request: OperatorRequest) {
  const entries = new Map<string, string>();
  for (const [key, value] of request.query) { if (entries.has(key)) throw new Error('MEMORY_PREPARATION_QUERY_INVALID'); entries.set(key, value); }
  return Object.fromEntries(entries);
}
export function createMemoryPreparationRoutes(input: { application: MemoryPreparationApplicationPort }): OperatorExtension {
  return { name: 'memory-preparation', matches({ path, method }) { return path[0] === 'runs' && path[2] === 'memory-preparations' && ((method === 'GET' && (path.length === 3 || path.length === 4)) || (method === 'POST' && path.length === 3)); }, async handle(request) {
    try {
      const runId = RunIdSchema.parse(request.path[1]);
      if (request.kind === 'read') {
        if (request.path.length === 3) {
          const parsed = z.strictObject({ limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional(), cursor: z.string().min(1).max(240).optional() }).parse(query(request));
          const page = MemoryPreparationJobPageSchema.parse(await input.application.list({ runId, principalId: request.principalId, ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }), ...(parsed.limit === undefined ? {} : { limit: parsed.limit }) }));
          if (page.jobs.some(job => job.runId !== runId || job.principalId !== request.principalId)) throw new Error('MEMORY_PREPARATION_SCOPE_INVALID');
          return operatorJson(page);
        }
        z.strictObject({}).parse(query(request)); const jobId = IdSchema.parse(request.path[3]);
        const value = await input.application.read({ runId, jobId, principalId: request.principalId });
        if (value === undefined) return problem(404, 'MEMORY_PREPARATION_NOT_FOUND');
        const job = MemoryPreparationJobSchema.parse(value);
        if (job.runId !== runId || job.jobId !== jobId || job.principalId !== request.principalId) return problem(404, 'MEMORY_PREPARATION_NOT_FOUND');
        return operatorJson(job, 200, { ETag: memoryPreparationJobEtag(job) });
      }
      z.strictObject({}).parse(query(request));
      const body = BodySchema.parse(request.body);
      const context = { runId, ...body };
      if (request.ifMatch !== memoryPreparationContextEtag(context)) return problem(412, 'MEMORY_PREPARATION_IF_MATCH_REQUIRED');
      const result = MemoryPreparationStartResultSchema.parse(await input.application.start({ ...context, idempotencyKey: request.idempotencyKey, principalId: request.principalId }));
      if (result.kind === 'idempotency-conflict') return problem(409, 'MEMORY_PREPARATION_IDEMPOTENCY_CONFLICT');
      if (result.kind === 'rejected') return problem(result.code === 'source-stale' ? 412 : result.code === 'binary-not-configured' ? 503 : 409, `MEMORY_PREPARATION_${result.code.toUpperCase().replaceAll('-', '_')}`);
      const job = result.job;
      if (job.runId !== runId || job.principalId !== request.principalId || job.expectedConfigurationRevision !== body.expectedConfigurationRevision || job.expectedWorldRevision !== body.expectedWorldRevision || job.contextETag !== memoryPreparationContextEtag(context)) throw new Error('MEMORY_PREPARATION_SCOPE_INVALID');
      return operatorJson(job, 202, { ETag: memoryPreparationJobEtag(job), Location: `/api/v1/runs/${runId}/memory-preparations/${job.jobId}` });
    } catch (error) { return problem(error instanceof z.ZodError || error instanceof Error && error.message === 'MEMORY_PREPARATION_QUERY_INVALID' ? 422 : 409, error instanceof z.ZodError ? 'MEMORY_PREPARATION_REQUEST_INVALID' : 'MEMORY_PREPARATION_UNAVAILABLE'); }
  } };
}
