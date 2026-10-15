import { z } from 'zod';
import { ApiProblemSchema } from '../domain/http.ts';
import {
  DramaticStructureEventSchema,
  DramaticStructureMutationResultSchema,
  DramaticStructureSceneOptionsSchema,
  DramaticStructureViewSchema,
} from '../domain/dramatic-structure.ts';
import { RunIdSchema, RevisionSchema } from '../domain/values.ts';
import { bootstrapSession } from './client.ts';

const IdempotencyKeySchema = z.string().uuid();
const StructureDocumentSchema = DramaticStructureViewSchema.extend({
  worldRevision: RevisionSchema, worldSeq: RevisionSchema.optional(), commitIndex: RevisionSchema.optional(),
});
const StructureEventsPageSchema = z.strictObject({
  events: z.array(DramaticStructureEventSchema).max(1_000),
  hasMore: z.boolean(),
  structureRevision: RevisionSchema,
});
export type DramaticStructureDocument = { value: z.infer<typeof StructureDocumentSchema>; etag: string };
export type StructureMutation =
  | { kind: 'openEpisode'; title?: string | undefined }
  | { kind: 'openScene'; label: string; participantIds: string[]; placeIds: string[] }
  | { kind: 'closeScene'; sceneId: string; reason: string }
  | { kind: 'closeEpisode'; episodeId: string; consequenceEventIds: string[]; openLines: Array<{ lineId: string; evidenceEventIds: string[] }> }
  | { kind: 'setEpisodeActs'; episodeId: string; acts: Array<{ title: string; sceneIds: string[] }> };
export type StructureMutationIntent = { runId: string; etag: string; key: string; mutation: StructureMutation };

export function dramaticStructureEtag(runId: string, worldRevision: number, structureRevision: number, commitIndex?: number) {
  return `"structure:${RunIdSchema.parse(runId)}:w${RevisionSchema.parse(worldRevision)}:s${RevisionSchema.parse(structureRevision)}${commitIndex === undefined ? '' : `:c${RevisionSchema.parse(commitIndex)}`}"`;
}

export function captureStructureMutation(input: StructureMutationIntent): StructureMutationIntent {
  const runId = RunIdSchema.parse(input.runId);
  const key = IdempotencyKeySchema.parse(input.key);
  const mutation = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('openEpisode'), title: z.string().trim().min(1).max(200).optional() }),
    z.strictObject({ kind: z.literal('openScene'), label: z.string().trim().min(1).max(200), participantIds: z.array(z.string().min(1).max(120)).min(1).max(100), placeIds: z.array(z.string().min(1).max(120)).min(1).max(100) }),
    z.strictObject({ kind: z.literal('closeScene'), sceneId: z.string().uuid(), reason: z.string().trim().min(1).max(500) }),
    z.strictObject({ kind: z.literal('closeEpisode'), episodeId: z.string().uuid(), consequenceEventIds: z.array(z.string().uuid()).max(10_000), openLines: z.array(z.strictObject({ lineId: z.string().trim().min(1).max(120), evidenceEventIds: z.array(z.string().uuid()).min(1).max(1_000) })).max(10_000) }),
    z.strictObject({ kind: z.literal('setEpisodeActs'), episodeId: z.string().uuid(), acts: z.array(z.strictObject({ title: z.string().trim().min(1).max(200), sceneIds: z.array(z.string().uuid()).min(1).max(10_000) })).max(1_000) }),
  ]).parse(input.mutation);
  const match = /^"structure:([0-9a-f-]{36}):w(0|[1-9]\d{0,15}):s(0|[1-9]\d{0,15})"$/.exec(input.etag);
  if (match?.[1] !== runId) throw new Error('La revisión estructural pertenece a otra representación.');
  return { runId, etag: input.etag, key, mutation };
}

export function buildStructureMutationRequest(input: { intent: StructureMutationIntent; csrfToken: string }) {
  const intent = captureStructureMutation(input.intent);
  const base = `/api/v1/runs/${intent.runId}`;
  const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': input.csrfToken, 'Idempotency-Key': intent.key, 'If-Match': intent.etag };
  switch (intent.mutation.kind) {
    case 'openEpisode': return { path: `${base}/episodes`, init: { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(intent.mutation.title === undefined ? {} : { title: intent.mutation.title }) } satisfies RequestInit };
    case 'openScene': return { path: `${base}/scenes`, init: { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify({ label: intent.mutation.label, participantIds: intent.mutation.participantIds, placeIds: intent.mutation.placeIds }) } satisfies RequestInit };
    case 'closeScene': return { path: `${base}/scenes/${intent.mutation.sceneId}/close`, init: { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify({ reason: intent.mutation.reason }) } satisfies RequestInit };
    case 'closeEpisode': return { path: `${base}/episodes/${intent.mutation.episodeId}/close`, init: { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify({ consequenceEventIds: intent.mutation.consequenceEventIds, openLines: intent.mutation.openLines }) } satisfies RequestInit };
    case 'setEpisodeActs': return { path: `${base}/episodes/${intent.mutation.episodeId}/acts`, init: { method: 'PUT', credentials: 'same-origin', headers, body: JSON.stringify({ acts: intent.mutation.acts }) } satisfies RequestInit };
    default: { const exhaustive: never = intent.mutation; throw new Error(String(exhaustive)); }
  }
}

async function parseResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const raw: unknown = await response.json();
  if (!response.ok) {
    const problem = ApiProblemSchema.safeParse(raw);
    throw Object.assign(new Error(problem.success ? problem.data.error.message : 'No se pudo leer la estructura dramática.'), {
      kind: 'dramatic-structure-http-error', status: response.status,
    });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error('La respuesta de estructura dramática no tiene el formato esperado.');
  return parsed.data;
}

export function createRunDramaticStructureClient(request: typeof fetch = (url, init) => fetch(url, init), bootstrap = bootstrapSession) {
  async function read(runId: string, signal: AbortSignal, cut?: { worldRevision: number; worldSeq: number }): Promise<DramaticStructureDocument> {
    const validRunId = RunIdSchema.parse(runId);
    await bootstrap();
    const query = cut === undefined ? '' : `?${new URLSearchParams({ worldRevision: String(RevisionSchema.parse(cut.worldRevision)), worldSeq: String(RevisionSchema.parse(cut.worldSeq)) })}`;
    const response = await request(`/api/v1/runs/${validRunId}/dramatic-structure${query}`, { credentials: 'same-origin', signal });
    const value = await parseResponse(response, StructureDocumentSchema);
    if (value.runId !== validRunId) throw new Error('La estructura recibida pertenece a otra representación.');
    const etag = response.headers.get('etag');
    if (cut !== undefined && (value.worldRevision !== cut.worldRevision || value.worldSeq !== cut.worldSeq || value.commitIndex === undefined)) throw new Error('La estructura recibida no coincide con el corte histórico.');
    if (etag !== dramaticStructureEtag(value.runId, value.worldRevision, value.structureRevision, cut === undefined ? undefined : value.commitIndex)) throw new Error('La revisión de la estructura recibida no coincide.');
    return { value, etag };
  }
  async function events(runId: string, signal: AbortSignal, throughCommitIndex?: number, afterStructureRevision = 0) {
    const validRunId = RunIdSchema.parse(runId);
    const after = RevisionSchema.parse(afterStructureRevision);
    await bootstrap();
    const query = new URLSearchParams({ afterStructureRevision: String(after), limit: '1000' });
    if (throughCommitIndex !== undefined) query.set('throughCommitIndex', String(RevisionSchema.parse(throughCommitIndex)));
    const response = await request(`/api/v1/runs/${validRunId}/structure-events?${query}`, { credentials: 'same-origin', signal });
    const page = await parseResponse(response, StructureEventsPageSchema);
    if (page.events.some((event, index) => event.runId !== validRunId || event.structureRevision > page.structureRevision
      || event.structureRevision !== after + index + 1
      || (throughCommitIndex !== undefined && event.commitIndex > throughCommitIndex))) throw new Error('La historia estructural no corresponde a esta representación.');
    return page;
  }
  return Object.freeze({
    read,
    events,
    async allEvents(runId: string, signal: AbortSignal, throughCommitIndex?: number) {
      const all: z.infer<typeof DramaticStructureEventSchema>[] = [];
      let after = 0;
      let structureRevision: number | undefined;
      for (;;) {
        const page = await events(runId, signal, throughCommitIndex, after);
        if (structureRevision !== undefined && page.structureRevision !== structureRevision) throw new Error('La estructura cambió mientras se leía su historia. Actualizá la vista antes de elegir un corte.');
        structureRevision = page.structureRevision;
        all.push(...page.events);
        if (!page.hasMore) break;
        const last = page.events.at(-1)?.structureRevision;
        if (last === undefined || last <= after) throw new Error('La paginación de la historia estructural no avanzó.');
        after = last;
      }
      if ((all.at(-1)?.structureRevision ?? 0) !== structureRevision) throw new Error('La historia estructural está incompleta.');
      return { events: all, structureRevision: structureRevision ?? RevisionSchema.parse(0) };
    },
    async sceneOptions(runId: string, signal: AbortSignal) {
      const validRunId = RunIdSchema.parse(runId);
      await bootstrap();
      const response = await request(`/api/v1/runs/${validRunId}/dramatic-structure/scene-options`, { credentials: 'same-origin', signal });
      const value = await parseResponse(response, DramaticStructureSceneOptionsSchema);
      if (value.runId !== validRunId || response.headers.get('etag') !== `"scene-options:${validRunId}:w${value.worldRevision}"`) throw new Error('Las opciones de escena pertenecen a otro corte.');
      return value;
    },
    async mutate(intent: StructureMutationIntent, signal: AbortSignal) {
      const session = await bootstrap();
      const built = buildStructureMutationRequest({ intent, csrfToken: session.csrfToken });
      const response = await request(built.path, { ...built.init, signal });
      const result = await parseResponse(response, DramaticStructureMutationResultSchema);
      if (result.kind === 'stored' || result.kind === 'existing') {
        if (response.headers.get('etag') !== dramaticStructureEtag(intent.runId, result.receipt.worldRevision, result.receipt.structureRevision)) throw new Error('El recibo pertenece a otra revisión estructural.');
      }
      return result;
    },
  });
}
export type RunDramaticStructureClient = ReturnType<typeof createRunDramaticStructureClient>;
