import { ApiProblemSchema } from '../domain/http.ts';
import { IcmContextInspectionPageSchema, IcmContextInspectionRequestSchema, type IcmContextInspectionRequest } from '../domain/icm-context-inspection.ts';
import { bootstrapSession } from './client.ts';

export class IcmInspectionRejection extends Error {
  constructor(readonly status: number) { super('La lectura privada ICM no está disponible.'); }
}
export function createIcmContextInspectionClient(request: typeof fetch = (url, init) => fetch(url, init), bootstrap = bootstrapSession) {
  return { async read(raw: IcmContextInspectionRequest, signal: AbortSignal) {
    const input = IcmContextInspectionRequestSchema.parse(raw);
    await bootstrap();
    if (signal.aborted) throw new Error('Lectura cancelada');
    const query = new URLSearchParams({ offset: String(input.offset), limit: String(input.limit) });
    for (const [key, value] of Object.entries(input.filters)) if (value !== undefined) query.set(key, value);
    const response = await request(`/api/v1/runs/${input.runId}/icm-context-packets?${query}`, { credentials: 'same-origin', signal });
    if (response.status === 401 || response.status === 403) throw new IcmInspectionRejection(response.status);
    const body: unknown = await response.json();
    if (!response.ok) { if (ApiProblemSchema.safeParse(body).success) throw new IcmInspectionRejection(response.status); throw new Error('Archivo ICM no disponible'); }
    const page = IcmContextInspectionPageSchema.parse(body);
    if (page.runId !== input.runId || page.offset !== input.offset || page.limit !== input.limit
      || JSON.stringify(page.filters) !== JSON.stringify(input.filters)) throw new Error('Página ICM fuera del ámbito solicitado');
    for (const item of page.items) {
      const identity = item.identity;
      if (identity !== undefined && (input.filters.role !== undefined && identity.audience.role !== input.filters.role
        || input.filters.actorId !== undefined && (identity.audience.role !== 'actor' || identity.audience.actorId !== input.filters.actorId)
        || input.filters.jobId !== undefined && identity.jobId !== input.filters.jobId)) throw new Error('Paquete ICM fuera del filtro solicitado');
    }
    return page;
  } };
}
export type IcmContextInspectionClient = ReturnType<typeof createIcmContextInspectionClient>;
