import { z } from 'zod';
import type { createScriptExportService } from '../application/script-export.ts';
import { ScriptExportRequestSchema } from '../domain/script-export.ts';
import { operatorJson, type OperatorExtension, type OperatorResponse } from './operator-extension.ts';

function problem(status: 404 | 409 | 503, code: string): OperatorResponse {
  return { kind: 'problem', status, error: status === 404 ? { kind: 'notFound', code, message: 'El guion o el corte solicitado no está disponible.' }
    : status === 409 ? { kind: 'conflict', code, message: 'El guion o la clave ya tienen otro contenido. No se sobrescribió ningún resultado.' }
    : { kind: 'dependency', code, safeCode: code, retryable: true, message: 'No se pudo guardar o verificar el guion. Conservá la misma operación para recuperar su resultado.' } };
}
export function createScriptExportRoutes(service: ReturnType<typeof createScriptExportService>): OperatorExtension {
  return { name: 'script-export', matches: ({ path }) => path[0] === 'runs' && path[2] === 'script-exports', handle(request) {
    if (request.query.size !== 0) throw new z.ZodError([{ code: 'custom', path: [], message: 'El guion no acepta rutas ni parámetros adicionales.' }]);
    if (request.kind === 'write' && request.method === 'POST' && request.path.length === 3) {
      const body = z.strictObject({ commitIndex: ScriptExportRequestSchema.shape.commitIndex }).parse(request.body);
      const input = ScriptExportRequestSchema.parse({ runId: request.path[1], ...body, idempotencyKey: request.idempotencyKey });
      try { return operatorJson(service.export(input, request.principalId), 201); }
      catch (error) { const message = error instanceof Error ? error.message : '';
        return message === 'SCRIPT_EXPORT_CUT_UNAVAILABLE' ? problem(404, message)
          : ['SCRIPT_EXPORT_IDEMPOTENCY_CONFLICT','SCRIPT_EXPORT_OUTPUT_CONFLICT','SCRIPT_EXPORT_OUTPUT_CHANGED'].includes(message) ? problem(409, message) : problem(503, 'SCRIPT_EXPORT_UNAVAILABLE'); }
    }
    if (request.kind === 'read' && request.path.length === 4) {
      const input = z.strictObject({ runId: ScriptExportRequestSchema.shape.runId, filename: z.string().min(1).max(150) }).parse({ runId: request.path[1], filename: request.path[3] });
      try { const result = service.download(input); return result === undefined ? problem(404, 'SCRIPT_EXPORT_NOT_FOUND')
        : { kind: 'stream', status: 200, mimeType: 'application/octet-stream', filename: result.receipt.filename, bytesLength: result.receipt.bytes, sha256: result.receipt.sha256, stream: result.stream }; }
      catch { return problem(503, 'SCRIPT_EXPORT_DOWNLOAD_UNAVAILABLE'); }
    }
    return { kind: 'problem', status: 405, error: { kind: 'validation', code: 'METHOD_NOT_ALLOWED', message: 'Usá exportar o descargar el guion confirmado.', issues: [] } };
  } };
}
