import { z } from 'zod';
import type { openJournal } from '../adapters/journal.ts';
import { IcmContextInspectionPageSchema, IcmContextInspectionRequestSchema } from '../domain/icm-context-inspection.ts';
import { RunIdSchema } from '../domain/values.ts';
import { operatorJson, type OperatorExtension } from './operator-extension.ts';

/** Private opt-in is host-session derived and checked before touching journal. */
export function createIcmContextInspectionRoutes(input: { journal: Pick<ReturnType<typeof openJournal>, 'readIcmContextPacketInspection'> }): OperatorExtension {
  return { name: 'icm-context-inspection', matches: ({path}) => path[0] === 'runs' && path[2] === 'icm-context-packets', handle(request) {
    if (request.path.length !== 3 || request.kind !== 'read') return { kind: 'problem', status: 405, error: { kind: 'validation', code: 'METHOD_NOT_ALLOWED', message: 'La inspección ICM es de sólo lectura.', issues: [] } };
    const runId = RunIdSchema.parse(request.path[1]);
    if (!request.inspectionRunIds?.includes(runId)) return { kind: 'problem', status: 403, error: { kind: 'forbidden', code: 'ICM_INSPECTION_REQUIRED', message: 'Activá explícitamente el inspector privado para esta representación.' } };
    const seen = new Set<string>();
    for (const [key] of request.query) {
      if (seen.has(key) || !['role','actorId','jobId','offset','limit'].includes(key)) throw new z.ZodError([{ code: 'custom', path: [key], message: 'Filtro ICM inválido o repetido.' }]);
      seen.add(key);
    }
    const query = Object.fromEntries(request.query);
    const read = IcmContextInspectionRequestSchema.parse({ runId,
      filters: { ...(query.role === undefined ? {} : { role: query.role }), ...(query.actorId === undefined ? {} : { actorId: query.actorId }), ...(query.jobId === undefined ? {} : { jobId: query.jobId }) },
      ...(query.offset === undefined ? {} : { offset: /^\d+$/.test(query.offset) ? Number(query.offset) : query.offset }),
      ...(query.limit === undefined ? {} : { limit: /^\d+$/.test(query.limit) ? Number(query.limit) : query.limit }) });
    let page: ReturnType<typeof input.journal.readIcmContextPacketInspection>;
    try { page = input.journal.readIcmContextPacketInspection(read); }
    catch { return { kind: 'problem', status: 503, error: { kind: 'dependency', code: 'ICM_INSPECTION_UNAVAILABLE', safeCode: 'ICM_INSPECTION_UNAVAILABLE', retryable: true, message: 'El archivo ICM no se pudo verificar. No se consultaron fuentes actuales.' } }; }
    if (page === undefined) return { kind: 'problem', status: 404, error: { kind: 'notFound', code: 'NOT_FOUND', message: 'Representación no encontrada.' } };
    return operatorJson(IcmContextInspectionPageSchema.parse(page));
  } };
}
