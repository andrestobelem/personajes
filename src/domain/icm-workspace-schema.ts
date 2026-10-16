/** Browser-safe ICM contracts. Cryptographic verification belongs to icm-workspace.ts. */
import { z } from 'zod';
import {
  CharacterIdSchema, HashSchema, JobIdSchema, RevisionSchema, RunIdSchema,
  SourceRefIdSchema, WorldSeqSchema,
} from './values.ts';

export const IcmWorkspaceRoleSchema = z.enum([
  'actor', 'continuista', 'director', 'configurator', 'narrator', 'narration-reviewer',
]);
export type IcmWorkspaceRole = z.infer<typeof IcmWorkspaceRoleSchema>;

const ActorAudienceSchema = z.strictObject({ role: z.literal('actor'), actorId: CharacterIdSchema });
const NonActorAudienceSchemas = [
  z.strictObject({ role: z.literal('continuista') }),
  z.strictObject({ role: z.literal('director') }),
  z.strictObject({ role: z.literal('configurator') }),
  z.strictObject({ role: z.literal('narrator') }),
  z.strictObject({ role: z.literal('narration-reviewer') }),
] as const;

/** Exact packet audience. Actor audiences always identify one actor; administrative audiences cannot carry an actor ID. */
export const IcmWorkspaceAudienceSchema = z.discriminatedUnion('role', [ActorAudienceSchema, ...NonActorAudienceSchemas]);
export type IcmWorkspaceAudience = z.infer<typeof IcmWorkspaceAudienceSchema>;

export const IcmWorkspaceSectionIdSchema = z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/);
export type IcmWorkspaceSectionId = z.infer<typeof IcmWorkspaceSectionIdSchema>;

const UniqueSectionIdsSchema = z.array(IcmWorkspaceSectionIdSchema).min(1).max(64)
  .refine((sectionIds) => new Set(sectionIds).size === sectionIds.length, 'Secciones ICM duplicadas');

/** Client-facing intent refers only to manifest IDs and hashes, never to filesystem paths or bytes. */
export const IcmWorkspaceSourceSelectionSchema = z.strictObject({
  sourceId: SourceRefIdSchema,
  audience: IcmWorkspaceAudienceSchema,
  revision: RevisionSchema,
  sourceHash: HashSchema,
  sectionIds: UniqueSectionIdsSchema,
});
export type IcmWorkspaceSourceSelection = z.infer<typeof IcmWorkspaceSourceSelectionSchema>;

export const IcmWorkspaceSectionHashSchema = z.strictObject({
  sectionId: IcmWorkspaceSectionIdSchema,
  sectionHash: HashSchema,
});

export const IcmWorkspaceSectionSnapshotStructureSchema = z.strictObject({
  sectionId: IcmWorkspaceSectionIdSchema,
  markdown: z.string().max(200_000),
  sectionHash: HashSchema,
});

export const IcmWorkspaceSourceSnapshotStructureSchema = z.strictObject({
  sourceId: SourceRefIdSchema,
  audience: IcmWorkspaceAudienceSchema,
  revision: RevisionSchema,
  /** Hash of the complete authorized source file, not just its selected sections. */
  sourceHash: HashSchema,
  /** Section order is the manifest order and is retained in the frozen snapshot. */
  sections: z.array(IcmWorkspaceSectionSnapshotStructureSchema).min(1).max(64),
}).superRefine((source, context) => {
  const ids = source.sections.map((section) => section.sectionId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['sections'], message: 'Una fuente ICM no puede repetir secciones.' });
  }
});
export type IcmWorkspaceSourceSnapshot = z.infer<typeof IcmWorkspaceSourceSnapshotStructureSchema>;

export const IcmWorkspaceSnapshotInputSchema = z.strictObject({
  sources: z.array(z.strictObject({
    sourceId: SourceRefIdSchema,
    audience: IcmWorkspaceAudienceSchema,
    revision: RevisionSchema,
    sourceHash: HashSchema,
    sections: z.array(z.strictObject({
      sectionId: IcmWorkspaceSectionIdSchema,
      markdown: z.string().max(200_000),
    })).min(1).max(64),
  })).max(512),
});
export type IcmWorkspaceSnapshotInput = z.input<typeof IcmWorkspaceSnapshotInputSchema>;

export const IcmWorkspaceSnapshotBodyStructureSchema = z.strictObject({
  kind: z.literal('icm-workspace-snapshot'),
  schemaVersion: z.literal(1),
  sources: z.array(IcmWorkspaceSourceSnapshotStructureSchema).max(512),
});

/** Structural parsing only. Host code must call verifyIcmWorkspaceSnapshot before trusting this value. */
export const IcmWorkspaceSnapshotStructureSchema = z.strictObject({
  ...IcmWorkspaceSnapshotBodyStructureSchema.shape,
  snapshotHash: HashSchema,
}).superRefine((snapshot, context) => {
  const sourceKeys = new Set<string>();
  let markdownBytes = 0;
  for (const [sourceIndex, source] of snapshot.sources.entries()) {
    // Explicit tuple encoding avoids crypto/canonical-json in this browser-safe contract module.
    const audienceKey = source.audience.role === 'actor'
      ? [source.audience.role, source.audience.actorId]
      : [source.audience.role];
    const key = JSON.stringify([source.sourceId, audienceKey]);
    if (sourceKeys.has(key)) {
      context.addIssue({ code: 'custom', path: ['sources', sourceIndex], message: 'La pareja fuente/audiencia ICM está duplicada.' });
    }
    sourceKeys.add(key);
    for (const section of source.sections) markdownBytes += new TextEncoder().encode(section.markdown).byteLength;
  }
  if (markdownBytes > 2_000_000) {
    context.addIssue({ code: 'custom', path: ['sources'], message: 'El snapshot ICM excede el tamaño total permitido.' });
  }
});
export type IcmWorkspaceSnapshot = z.infer<typeof IcmWorkspaceSnapshotStructureSchema>;

export const IcmContextCutSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('world-cut'),
    commitIndex: RevisionSchema,
    worldRevision: RevisionSchema,
    worldSeq: WorldSeqSchema,
  }),
  z.strictObject({
    kind: z.literal('preparation-cut'),
    draftRevision: RevisionSchema,
    draftHash: HashSchema,
  }),
]);
export type IcmContextCut = z.infer<typeof IcmContextCutSchema>;

const IcmContextPacketScopeBase = {
  runId: RunIdSchema,
  configurationRevision: RevisionSchema,
  jobId: JobIdSchema,
  generation: RevisionSchema,
  cut: IcmContextCutSchema,
};
const ActorContextPacketScopeSchema = z.strictObject({ ...IcmContextPacketScopeBase, audience: ActorAudienceSchema });
const ContinuistaContextPacketScopeSchema = z.strictObject({ ...IcmContextPacketScopeBase, audience: z.strictObject({ role: z.literal('continuista') }) });
const DirectorContextPacketScopeSchema = z.strictObject({ ...IcmContextPacketScopeBase, audience: z.strictObject({ role: z.literal('director') }) });
const ConfiguratorContextPacketScopeSchema = z.strictObject({ ...IcmContextPacketScopeBase, audience: z.strictObject({ role: z.literal('configurator') }) });
const NarratorContextPacketScopeSchema = z.strictObject({ ...IcmContextPacketScopeBase, audience: z.strictObject({ role: z.literal('narrator') }) });
const NarrationReviewerContextPacketScopeSchema = z.strictObject({ ...IcmContextPacketScopeBase, audience: z.strictObject({ role: z.literal('narration-reviewer') }) });
export const IcmContextPacketScopeSchema = z.union([
  ActorContextPacketScopeSchema, ContinuistaContextPacketScopeSchema, DirectorContextPacketScopeSchema,
  ConfiguratorContextPacketScopeSchema, NarratorContextPacketScopeSchema, NarrationReviewerContextPacketScopeSchema,
] as const);
export type IcmContextPacketScope = z.infer<typeof IcmContextPacketScopeSchema>;

export const IcmContextPacketSourceRefStructureSchema = z.strictObject({
  sourceId: SourceRefIdSchema,
  audience: IcmWorkspaceAudienceSchema,
  revision: RevisionSchema,
  sourceHash: HashSchema,
  sections: z.array(IcmWorkspaceSectionHashSchema).min(1).max(64),
}).superRefine((source, context) => {
  const ids = source.sections.map((section) => section.sectionId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['sections'], message: 'Una referencia no puede repetir secciones ICM.' });
  }
});

const IcmContextPacketCommonInputShape = {
  scope: IcmContextPacketScopeSchema,
  workspaceSnapshotHash: HashSchema,
  compilerVersion: z.string().trim().min(1).max(120),
  sourceRefs: z.array(IcmContextPacketSourceRefStructureSchema).min(1).max(512),
  hostPolicyMarkdown: z.string().min(1).max(200_000),
  roleContractMarkdown: z.string().min(1).max(400_000),
  diegeticContextMarkdown: z.string().max(1_000_000),
};
const IcmContextPacketActorInputSchema = z.strictObject({
  ...IcmContextPacketCommonInputShape, scope: ActorContextPacketScopeSchema, preparedContextHash: HashSchema,
});
const IcmContextPacketContinuistaInputSchema = z.strictObject({ ...IcmContextPacketCommonInputShape, scope: ContinuistaContextPacketScopeSchema });
const IcmContextPacketDirectorInputSchema = z.strictObject({ ...IcmContextPacketCommonInputShape, scope: DirectorContextPacketScopeSchema });
const IcmContextPacketConfiguratorInputSchema = z.strictObject({ ...IcmContextPacketCommonInputShape, scope: ConfiguratorContextPacketScopeSchema });
const IcmContextPacketNarratorInputSchema = z.strictObject({ ...IcmContextPacketCommonInputShape, scope: NarratorContextPacketScopeSchema });
const IcmContextPacketNarrationReviewerInputSchema = z.strictObject({ ...IcmContextPacketCommonInputShape, scope: NarrationReviewerContextPacketScopeSchema });
export const IcmContextPacketInputSchema = z.union([
  IcmContextPacketActorInputSchema, IcmContextPacketContinuistaInputSchema, IcmContextPacketDirectorInputSchema,
  IcmContextPacketConfiguratorInputSchema, IcmContextPacketNarratorInputSchema, IcmContextPacketNarrationReviewerInputSchema,
] as const);
export type IcmContextPacketInput = z.input<typeof IcmContextPacketInputSchema>;

const IcmContextPacketActorBodyStructureSchema = z.strictObject({
  ...IcmContextPacketActorInputSchema.shape,
  kind: z.literal('icm-context-packet'), schemaVersion: z.literal(1),
});
const IcmContextPacketContinuistaBodyStructureSchema = z.strictObject({
  ...IcmContextPacketContinuistaInputSchema.shape,
  kind: z.literal('icm-context-packet'), schemaVersion: z.literal(1),
});
const IcmContextPacketDirectorBodyStructureSchema = z.strictObject({
  ...IcmContextPacketDirectorInputSchema.shape,
  kind: z.literal('icm-context-packet'), schemaVersion: z.literal(1),
});
const IcmContextPacketConfiguratorBodyStructureSchema = z.strictObject({
  ...IcmContextPacketConfiguratorInputSchema.shape,
  kind: z.literal('icm-context-packet'), schemaVersion: z.literal(1),
});
const IcmContextPacketNarratorBodyStructureSchema = z.strictObject({
  ...IcmContextPacketNarratorInputSchema.shape,
  kind: z.literal('icm-context-packet'), schemaVersion: z.literal(1),
});
const IcmContextPacketNarrationReviewerBodyStructureSchema = z.strictObject({
  ...IcmContextPacketNarrationReviewerInputSchema.shape,
  kind: z.literal('icm-context-packet'), schemaVersion: z.literal(1),
});
export const IcmContextPacketBodyStructureSchema = z.union([
  IcmContextPacketActorBodyStructureSchema, IcmContextPacketContinuistaBodyStructureSchema, IcmContextPacketDirectorBodyStructureSchema,
  IcmContextPacketConfiguratorBodyStructureSchema, IcmContextPacketNarratorBodyStructureSchema, IcmContextPacketNarrationReviewerBodyStructureSchema,
] as const);

/** Structural parsing only. Host code must call verifyIcmContextPacket before trusting this value. */
export const IcmContextPacketStructureSchema = z.union([
  IcmContextPacketActorBodyStructureSchema.extend({ packetHash: HashSchema }),
  IcmContextPacketContinuistaBodyStructureSchema.extend({ packetHash: HashSchema }),
  IcmContextPacketDirectorBodyStructureSchema.extend({ packetHash: HashSchema }),
  IcmContextPacketConfiguratorBodyStructureSchema.extend({ packetHash: HashSchema }),
  IcmContextPacketNarratorBodyStructureSchema.extend({ packetHash: HashSchema }),
  IcmContextPacketNarrationReviewerBodyStructureSchema.extend({ packetHash: HashSchema }),
] as const);
export type IcmContextPacket = z.infer<typeof IcmContextPacketStructureSchema>;
