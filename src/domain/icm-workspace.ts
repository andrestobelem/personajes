/** Host-side ICM integrity and hashing. Browser contracts live in icm-workspace-schema.ts. */
import { z } from 'zod';
import { canonicalJson, sha256CanonicalJson, sha256Utf8 } from './canonical-json.ts';
import { HashSchema } from './values.ts';
import {
  IcmContextPacketBodyStructureSchema, IcmContextPacketInputSchema, IcmContextPacketStructureSchema,
  IcmWorkspaceAudienceSchema,
  IcmWorkspaceSnapshotBodyStructureSchema, IcmWorkspaceSnapshotInputSchema,
  IcmWorkspaceSnapshotStructureSchema, IcmWorkspaceSourceSnapshotStructureSchema,
  type IcmContextPacket, type IcmWorkspaceAudience, type IcmWorkspaceSnapshot,
} from './icm-workspace-schema.ts';

export {
  IcmContextCutSchema, IcmContextPacketInputSchema, IcmContextPacketScopeSchema,
  IcmWorkspaceAudienceSchema, IcmWorkspaceRoleSchema, IcmWorkspaceSectionIdSchema,
  IcmWorkspaceSnapshotInputSchema, IcmWorkspaceSourceSelectionSchema,
} from './icm-workspace-schema.ts';
export type {
  IcmContextCut, IcmContextPacket, IcmContextPacketInput, IcmContextPacketScope, IcmWorkspaceAudience,
  IcmWorkspaceRole, IcmWorkspaceSectionId, IcmWorkspaceSnapshot, IcmWorkspaceSnapshotInput, IcmWorkspaceSourceSelection,
} from './icm-workspace-schema.ts';

export type IcmWorkspaceSourceSnapshot = z.infer<typeof IcmWorkspaceSourceSnapshotSchema>;

const IcmWorkspaceSourceSnapshotHashSchema = IcmWorkspaceSourceSnapshotStructureSchema.superRefine((source, context) => {
  for (const [index, section] of source.sections.entries()) {
    if (sha256Utf8(section.markdown) !== section.sectionHash) {
      context.addIssue({ code: 'custom', path: ['sections', index, 'sectionHash'], message: 'El hash no corresponde al Markdown exacto de la sección ICM.' });
    }
  }
});

/** Source snapshot schema includes cryptographic validation; never import this from browser contracts. */
export const IcmWorkspaceSourceSnapshotSchema = IcmWorkspaceSourceSnapshotHashSchema;

function workspaceAudienceKey(audience: IcmWorkspaceAudience): string {
  return canonicalJson(IcmWorkspaceAudienceSchema.parse(audience));
}

function snapshotHash(body: z.infer<typeof IcmWorkspaceSnapshotBodyStructureSchema>): z.infer<typeof HashSchema> {
  return sha256CanonicalJson(body);
}

/** Host-verified snapshot schema checks per-section and aggregate hashes. */
export const IcmWorkspaceSnapshotSchema = IcmWorkspaceSnapshotStructureSchema.superRefine((snapshot, context) => {
  const sourceKeys = new Set<string>();
  for (const [sourceIndex, source] of snapshot.sources.entries()) {
    const key = canonicalJson({ sourceId: source.sourceId, audience: source.audience });
    if (sourceKeys.has(key)) {
      context.addIssue({ code: 'custom', path: ['sources', sourceIndex], message: 'La pareja fuente/audiencia ICM está duplicada.' });
    }
    sourceKeys.add(key);
    const sourceHashResult = IcmWorkspaceSourceSnapshotSchema.safeParse(source);
    if (!sourceHashResult.success) {
      for (const issue of sourceHashResult.error.issues) {
        context.addIssue({ ...issue, path: ['sources', sourceIndex, ...issue.path] });
      }
    }
  }
  const body = IcmWorkspaceSnapshotBodyStructureSchema.safeParse({
    kind: snapshot.kind, schemaVersion: snapshot.schemaVersion, sources: snapshot.sources,
  });
  if (body.success && snapshotHash(body.data) !== snapshot.snapshotHash) {
    context.addIssue({ code: 'custom', path: ['snapshotHash'], message: 'El hash agregado no corresponde al snapshot ICM.' });
  }
});

/** Builds a frozen snapshot while preserving source and manifest section order. */
export function createIcmWorkspaceSnapshot(input: unknown): IcmWorkspaceSnapshot {
  const request = IcmWorkspaceSnapshotInputSchema.parse(input);
  const sources = request.sources.map((source) => ({
    ...source,
    audience: IcmWorkspaceAudienceSchema.parse(source.audience),
    sections: source.sections.map((section) => ({
      ...section,
      sectionHash: sha256Utf8(section.markdown),
    })),
  }));
  const body = IcmWorkspaceSnapshotBodyStructureSchema.parse({
    kind: 'icm-workspace-snapshot', schemaVersion: 1, sources,
  });
  return IcmWorkspaceSnapshotSchema.parse({ ...body, snapshotHash: snapshotHash(body) });
}

/** Parses a persisted snapshot and verifies every section hash and the aggregate hash. */
export function verifyIcmWorkspaceSnapshot(input: unknown): IcmWorkspaceSnapshot {
  return IcmWorkspaceSnapshotSchema.parse(input);
}

function contextPacketIntegrityError(rawPacket: unknown): string | null {
  const parsed = IcmContextPacketStructureSchema.safeParse(rawPacket);
  if (!parsed.success) return 'El paquete ICM no cumple el contrato de integridad.';
  const packet = parsed.data;
  const expectedAudience = canonicalJson(packet.scope.audience);
  const sourceKeys = new Set<string>();
  for (const source of packet.sourceRefs) {
    if (canonicalJson(source.audience) !== expectedAudience) {
      return 'La fuente ICM no pertenece a la audiencia exacta del paquete.';
    }
    const key = canonicalJson({ sourceId: source.sourceId, audience: source.audience });
    if (sourceKeys.has(key)) return 'El paquete repite una fuente ICM para la misma audiencia.';
    sourceKeys.add(key);
  }
  const { packetHash: storedPacketHash, ...body } = packet;
  if (sha256CanonicalJson(body) !== storedPacketHash) return 'El hash no corresponde al paquete ICM exacto.';
  return null;
}

/** Host-verified packet schema checks its canonical packet hash and exact source audience. */
export const IcmContextPacketSchema = IcmContextPacketStructureSchema.superRefine((packet, context) => {
  const error = contextPacketIntegrityError(packet);
  if (error !== null) context.addIssue({ code: 'custom', path: [], message: error });
});

function contextPacketHash(body: z.infer<typeof IcmContextPacketBodyStructureSchema>): z.infer<typeof HashSchema> {
  return sha256CanonicalJson(body);
}

/** Creates a hash-bound context packet; actor packets must bind their prepared identity separately. */
export function createIcmContextPacket(input: unknown): IcmContextPacket {
  const parsedInput = IcmContextPacketInputSchema.parse(input);
  const body = IcmContextPacketBodyStructureSchema.parse({
    ...parsedInput, kind: 'icm-context-packet', schemaVersion: 1,
  });
  return IcmContextPacketSchema.parse({ ...body, packetHash: contextPacketHash(body) });
}

/** Parses a persisted packet and verifies its exact scope, audience bindings, and aggregate hash. */
export function verifyIcmContextPacket(input: unknown): IcmContextPacket {
  return IcmContextPacketSchema.parse(input);
}

/** Confirms every packet source reference resolves byte-for-byte to the frozen workspace snapshot. */
export function verifyIcmContextPacketAgainstSnapshot(
  packetInput: unknown,
  snapshotInput: unknown,
): IcmContextPacket {
  const packet = verifyIcmContextPacket(packetInput);
  const snapshot = verifyIcmWorkspaceSnapshot(snapshotInput);
  if (packet.workspaceSnapshotHash !== snapshot.snapshotHash) throw new Error('ICM_CONTEXT_SNAPSHOT_HASH_MISMATCH');
  const packetAudienceKey = workspaceAudienceKey(packet.scope.audience);
  const expectedSources = snapshot.sources.filter((source) => workspaceAudienceKey(source.audience) === packetAudienceKey);
  if (packet.sourceRefs.length !== expectedSources.length) throw new Error('ICM_CONTEXT_SOURCE_SET_MISMATCH');
  for (const [index, reference] of packet.sourceRefs.entries()) {
    const source = expectedSources[index];
    if (source === undefined || source.revision !== reference.revision || source.sourceHash !== reference.sourceHash) {
      throw new Error('ICM_CONTEXT_SOURCE_REFERENCE_MISMATCH');
    }
    if (source.sourceId !== reference.sourceId || workspaceAudienceKey(source.audience) !== workspaceAudienceKey(reference.audience)) {
      throw new Error('ICM_CONTEXT_SOURCE_ORDER_MISMATCH');
    }
    if (reference.sections.length !== source.sections.length
      || reference.sections.some((selected, index) => {
        const frozen = source.sections[index];
        return frozen === undefined || selected.sectionId !== frozen.sectionId || selected.sectionHash !== frozen.sectionHash;
      })) {
      throw new Error('ICM_CONTEXT_SECTION_REFERENCE_MISMATCH');
    }
  }
  return packet;
}

export function hashIcmMarkdown(markdown: string): z.infer<typeof HashSchema> {
  return sha256Utf8(markdown);
}
