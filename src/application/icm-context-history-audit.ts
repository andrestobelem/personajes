import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { canonicalJson, sha256CanonicalJson, sha256Utf8 } from '../domain/canonical-json.ts';
import { IcmContextPacketReceiptSchema } from '../domain/icm-context-jobs.ts';
import { IcmContextPacketSchema, IcmContextPacketScopeSchema, verifyIcmContextPacketAgainstSnapshot } from '../domain/icm-workspace.ts';
import { HashSchema, JobIdSchema, RunIdSchema } from '../domain/values.ts';
import { renderIcmContextPacket } from './icm-context-compiler.ts';
import type { ForkSourceReadResultSchema, ForkSourceRequestSchema } from './fork-source.ts';

const PacketRowSchema = z.strictObject({
  run_id: RunIdSchema, role: z.string(), actor_id: z.string(), job_id: JobIdSchema,
  generation: z.number().int().nonnegative(), created_at: z.number().int().nonnegative(),
  scope_json: z.string(), scope_hash: HashSchema, packet_json: z.string(), packet_hash: HashSchema,
  receipt_json: z.string(), receipt_hash: HashSchema,
});

/** Historical inspection has no lease or provider authority. It verifies every
 * stored packet against its own frozen configuration/cut, never workspace files.
 * An empty table is valid for historical configurations without ICM. */
type HistoricalSourceReader = (request: z.infer<typeof ForkSourceRequestSchema>) => z.infer<typeof ForkSourceReadResultSchema>;

/** Shared per-row proof. The caller supplies a frozen historical reader, never files. */
export function verifyIcmContextHistoryRow(input: { raw: unknown; readSource: HistoricalSourceReader }) {
    const raw = input.raw;
    const row = PacketRowSchema.parse(raw);
    const scope = IcmContextPacketScopeSchema.parse(JSON.parse(row.scope_json));
    const packet = IcmContextPacketSchema.parse(JSON.parse(row.packet_json));
    const receipt = IcmContextPacketReceiptSchema.parse(JSON.parse(row.receipt_json));
    const actorId = scope.audience.role === 'actor' ? scope.audience.actorId : '';
    if (canonicalJson(scope) !== row.scope_json || sha256Utf8(row.scope_json) !== row.scope_hash
      || canonicalJson(packet) !== row.packet_json || sha256Utf8(row.packet_json) !== row.packet_hash
      || canonicalJson(receipt) !== row.receipt_json || sha256Utf8(row.receipt_json) !== row.receipt_hash
      || row.run_id !== scope.runId || row.role !== scope.audience.role || row.actor_id !== actorId
      || row.job_id !== scope.jobId || row.generation !== scope.generation
      || canonicalJson(packet.scope) !== row.scope_json || canonicalJson(receipt.scope) !== row.scope_json
      || receipt.packetHash !== packet.packetHash || receipt.workspaceSnapshotHash !== packet.workspaceSnapshotHash
      || receipt.preparedContextHash !== ('preparedContextHash' in packet ? packet.preparedContextHash : undefined)) {
      throw new Error('ICM_CONTEXT_HISTORY_BINDING_INVALID');
    }
    // Preparation jobs have no durable authority yet. Do not invent a source
    // for them or silently skip a row when importing a foreign journal.
    if (scope.cut.kind !== 'world-cut') throw new Error('ICM_CONTEXT_HISTORY_CUT_UNSUPPORTED');
    const source = input.readSource({ runId: scope.runId, commitIndex: scope.cut.commitIndex,
      worldRevision: scope.cut.worldRevision, worldSeq: scope.cut.worldSeq });
    if (source.kind !== 'found' || source.configuration.configRevision !== scope.configurationRevision
      || source.configuration.icmWorkspace === undefined) throw new Error('ICM_CONTEXT_HISTORY_SOURCE_INVALID');
    const workspace = source.configuration.icmWorkspace;
    verifyIcmContextPacketAgainstSnapshot(packet, workspace);
    const prepared = scope.audience.role === 'actor'
      ? source.configuration.roster.preparedCharacters.find(actor => actor.characterId === actorId) : undefined;
    if (scope.audience.role === 'actor' && prepared === undefined) throw new Error('ICM_CONTEXT_HISTORY_PREPARATION_MISSING');
    renderIcmContextPacket({ packet, expectedPacketHash: receipt.packetHash, scope, workspace,
      ...(prepared === undefined ? {} : { expectedPreparedContextHash: sha256CanonicalJson(prepared) }) });
    return { packet, source };
}

export function auditIcmContextHistory(input: { database: DatabaseSync; readSource: HistoricalSourceReader }): number {
  let count = 0;
  for (const raw of input.database.prepare('SELECT * FROM icm_context_packets').iterate()) {
    verifyIcmContextHistoryRow({ raw, readSource: input.readSource });
    count++;
  }
  return count;
}
