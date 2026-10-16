import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { IcmContextInspectionPageSchema, IcmContextInspectionRequestSchema } from '../domain/icm-context-inspection.ts';
import { IcmWorkspaceAudienceSchema } from '../domain/icm-workspace-schema.ts';
import { JobIdSchema, RevisionSchema, WorldSeqSchema } from '../domain/values.ts';
import { verifyIcmContextHistoryRow } from './icm-context-history-audit.ts';
import { sha256CanonicalJson } from '../domain/canonical-json.ts';
import type { ForkSourceReadResultSchema, ForkSourceRequestSchema } from './fork-source.ts';

/** A bounded, coherent projection of private metadata. No source text, provider
 * or file reads occur here. Corruption belongs to its row, not a partial success. */
export function inspectIcmContextPackets(input: {
  database: DatabaseSync; request: unknown;
  readSource: (request: z.infer<typeof ForkSourceRequestSchema>) => z.infer<typeof ForkSourceReadResultSchema>;
}) {
  const request = IcmContextInspectionRequestSchema.parse(input.request);
  const head = input.database.prepare('SELECT commit_index,world_revision,last_seq FROM world_runs WHERE run_id=?').get(request.runId);
  if (head === undefined) return undefined;
  const cache = new Map<string, z.infer<typeof ForkSourceReadResultSchema>>();
  const readSource: typeof input.readSource = cut => {
    const key = JSON.stringify(cut); const cached = cache.get(key); if (cached !== undefined) return cached;
    let source: z.infer<typeof ForkSourceReadResultSchema>;
    try { source = input.readSource(cut); } catch { source = { kind: 'unavailable', reason: 'invalid-cut' }; }
    cache.set(key, source); return source;
  };
  let configuration: z.infer<typeof IcmContextInspectionPageSchema>['configuration'] = { kind: 'unavailable' };
  const parsedHead = z.strictObject({ commit_index: RevisionSchema, world_revision: RevisionSchema, last_seq: WorldSeqSchema }).safeParse(head);
  if (parsedHead.success) {
    const cut = parsedHead.data;
    const source = readSource({ runId: request.runId, commitIndex: cut.commit_index, worldRevision: cut.world_revision, worldSeq: cut.last_seq });
    if (source.kind === 'found') {
      const configurationRevision=source.configuration.configRevision, configurationHash=sha256CanonicalJson(source.configuration);
      configuration = source.configuration.icmWorkspace === undefined
        ? { kind: 'legacy-without-icm', configurationRevision, configurationHash, commitIndex: cut.commit_index }
        : { kind: 'configured', configurationRevision, configurationHash, commitIndex: cut.commit_index, workspaceSnapshotHash: source.configuration.icmWorkspace.snapshotHash };
    }
  }
  const where = ['run_id=?']; const values: Array<string | number> = [request.runId];
  for (const [column, value] of [['role', request.filters.role], ['actor_id', request.filters.actorId], ['job_id', request.filters.jobId]] as const) {
    if (value !== undefined) { where.push(`${column}=?`); values.push(value); }
  }
  const clause = where.join(' AND ');
  const total = z.strictObject({ total: RevisionSchema }).parse(input.database.prepare(`SELECT count(*) total FROM icm_context_packets WHERE ${clause}`).get(...values)).total;
  const rows = input.database.prepare(`SELECT * FROM icm_context_packets WHERE ${clause} ORDER BY created_at,role,actor_id,job_id,generation LIMIT ? OFFSET ?`).all(...values, request.limit, request.offset);
  const items = rows.map((raw, index) => {
    const position = request.offset + index;
    const identity = z.strictObject({ role: z.string(), actor_id: z.string(), job_id: JobIdSchema, generation: RevisionSchema, created_at: RevisionSchema }).safeParse({ role: raw.role, actor_id: raw.actor_id, job_id: raw.job_id, generation: raw.generation, created_at: raw.created_at });
    const audience = identity.success ? IcmWorkspaceAudienceSchema.safeParse({ role: identity.data.role, ...(identity.data.role === 'actor' ? { actorId: identity.data.actor_id } : {}) }) : undefined;
    const safeIdentity = identity.success && audience?.success ? { audience: audience.data, jobId: identity.data.job_id, generation: identity.data.generation, createdAt: identity.data.created_at } : undefined;
    try {
      const { packet } = verifyIcmContextHistoryRow({ raw, readSource });
      if (safeIdentity === undefined) throw new Error('Invalid packet identity');
      return { kind: 'verified' as const, position, identity: safeIdentity, scope: packet.scope,
        compilerVersion: packet.compilerVersion, workspaceSnapshotHash: packet.workspaceSnapshotHash, packetHash: packet.packetHash,
        ...('preparedContextHash' in packet ? { preparedContextHash: packet.preparedContextHash } : {}), sources: packet.sourceRefs };
    } catch {
      return { kind: 'corrupt' as const, position, ...(safeIdentity === undefined ? {} : { identity: safeIdentity }), code: 'packet-or-historical-source-invalid' as const };
    }
  });
  return IcmContextInspectionPageSchema.parse({ kind: 'icm-context-inspection-page', scope: 'complete-run-history', runId: request.runId,
    configuration, filters: request.filters, offset: request.offset, limit: request.limit, total, items, hasMore: request.offset + items.length < total });
}
