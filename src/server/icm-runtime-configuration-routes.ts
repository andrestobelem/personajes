import { z } from 'zod';
import { IcmRuntimeConfigurationRequestSchema, IcmRuntimeConfigurationViewSchema, IcmRuntimeConfigurationJobSchema, IcmRuntimeConfigurationJobPageSchema, IcmRuntimeConfigurationStartResultSchema, icmRuntimeConfigurationEtag, icmRuntimeConfigurationJobEtag } from '../domain/icm-runtime-configuration.ts';
import { operatorJson, OperatorResponseSchema, type OperatorExtension, type OperatorRequest } from './operator-extension.ts';
const IdSchema = z.uuid();
const BodySchema = IcmRuntimeConfigurationRequestSchema.pick({ binaryPath: true, expectedRevision: true });
export type IcmRuntimeConfigurationApplicationPort = {
  readConfiguration(): unknown | Promise<unknown>;
  start(input: z.infer<typeof BodySchema> & { principalId: string; idempotencyKey: string }): unknown | Promise<unknown>;
  read(input: { jobId: string; principalId: string }): unknown | Promise<unknown>;
  list(input: { principalId: string; cursor?: string; limit?: number }): unknown | Promise<unknown>;
};
function problem(status: number, code: string) {
  const kind = status === 404 ? 'notFound' : status === 412 ? 'precondition' : status === 422 ? 'validation' : 'conflict';
  return OperatorResponseSchema.parse({ kind: 'problem', status, error: { kind, code, message: 'La configuración ICM requiere una revisión vigente, una ruta absoluta válida y el host sin trabajo activo.', ...(kind === 'validation' ? { issues: [] } : {}) } });
}
function query(request: OperatorRequest) { const entries = new Map<string, string>(); for (const [key, value] of request.query) { if (entries.has(key)) throw new Error('QUERY_INVALID'); entries.set(key, value); } return Object.fromEntries(entries); }
export function createIcmRuntimeConfigurationRoutes(input: { application: IcmRuntimeConfigurationApplicationPort }): OperatorExtension {
  return { name: 'icm-runtime-configuration', matches({ path, method }) { return path[0] === 'host' && path[1] === 'icm-runtime-configuration' && ((method === 'GET' && (path.length === 2 || path[2] === 'jobs' && (path.length === 3 || path.length === 4))) || method === 'POST' && path[2] === 'jobs' && path.length === 3); }, async handle(request) {
    try {
      if (request.kind === 'read') {
        if (request.path.length === 2) { z.strictObject({}).parse(query(request)); const view = IcmRuntimeConfigurationViewSchema.parse(await input.application.readConfiguration()); return operatorJson(view, 200, { ETag: icmRuntimeConfigurationEtag(view) }); }
        if (request.path.length === 3) {
          const pageQuery = z.strictObject({ cursor: z.string().min(1).max(240).optional(), limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional() }).parse(query(request));
          const page = IcmRuntimeConfigurationJobPageSchema.parse(await input.application.list({ principalId: request.principalId, ...(pageQuery.cursor === undefined ? {} : { cursor: pageQuery.cursor }), ...(pageQuery.limit === undefined ? {} : { limit: pageQuery.limit }) }));
          if (page.jobs.some(job => job.principalId !== request.principalId)) throw new Error('SCOPE_INVALID'); return operatorJson(page);
        }
        z.strictObject({}).parse(query(request)); const jobId = IdSchema.parse(request.path[3]); const raw = await input.application.read({ jobId, principalId: request.principalId }); if (raw === undefined) return problem(404, 'ICM_CONFIGURATION_NOT_FOUND');
        const job = IcmRuntimeConfigurationJobSchema.parse(raw); if (job.jobId !== jobId || job.principalId !== request.principalId) return problem(404, 'ICM_CONFIGURATION_NOT_FOUND');
        return operatorJson(job, 200, { ETag: icmRuntimeConfigurationJobEtag(job) });
      }
      z.strictObject({}).parse(query(request)); const body = BodySchema.parse(request.body);
      const current = IcmRuntimeConfigurationViewSchema.parse(await input.application.readConfiguration());
      // The selected revision is the durable intent. Replay remains admissible after the saved revision advances.
      if (request.ifMatch !== icmRuntimeConfigurationEtag({ ...current, revision: body.expectedRevision })) return problem(412, 'ICM_CONFIGURATION_IF_MATCH_REQUIRED');
      const result = IcmRuntimeConfigurationStartResultSchema.parse(await input.application.start({ ...body, principalId: request.principalId, idempotencyKey: request.idempotencyKey }));
      if (result.kind === 'idempotency-conflict') return problem(409, 'ICM_CONFIGURATION_IDEMPOTENCY_CONFLICT');
      if (result.kind === 'rejected') return problem(result.code === 'configuration-stale' ? 412 : 409, 'ICM_CONFIGURATION_REJECTED');
      const job = result.job;
      if (job.principalId !== request.principalId || job.binaryPath !== body.binaryPath || job.expectedConfigurationRevision !== body.expectedRevision) throw new Error('SCOPE_INVALID');
      return operatorJson(job, 202, { ETag: icmRuntimeConfigurationJobEtag(job), Location: `/api/v1/host/icm-runtime-configuration/jobs/${job.jobId}` });
    } catch (error) { return problem(error instanceof z.ZodError || error instanceof Error && error.message === 'QUERY_INVALID' ? 422 : 409, 'ICM_CONFIGURATION_UNAVAILABLE'); }
  } };
}
