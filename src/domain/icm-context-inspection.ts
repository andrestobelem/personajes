import { z } from 'zod';
import { CharacterIdSchema, HashSchema, JobIdSchema, RevisionSchema, RunIdSchema } from './values.ts';
import { IcmContextPacketScopeSchema, IcmContextPacketSourceRefStructureSchema, IcmWorkspaceAudienceSchema, IcmWorkspaceRoleSchema } from './icm-workspace-schema.ts';

export const IcmContextInspectionFiltersSchema = z.strictObject({
  role: IcmWorkspaceRoleSchema.optional(), actorId: CharacterIdSchema.optional(), jobId: JobIdSchema.optional(),
}).superRefine((value, context) => {
  if (value.actorId !== undefined && value.role !== 'actor') context.addIssue({ code: 'custom', path: ['actorId'], message: 'actorId requiere el rol actor.' });
});
export const IcmContextInspectionRequestSchema = z.strictObject({
  runId: RunIdSchema, filters: IcmContextInspectionFiltersSchema.default({}),
  offset: z.number().int().min(0).max(1_000_000).default(0), limit: z.number().int().min(1).max(100).default(25),
});
export type IcmContextInspectionRequest = z.infer<typeof IcmContextInspectionRequestSchema>;
const IdentitySchema = z.strictObject({ audience: IcmWorkspaceAudienceSchema, jobId: JobIdSchema, generation: RevisionSchema, createdAt: RevisionSchema });
const ConfigurationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unavailable') }),
  z.strictObject({ kind: z.literal('legacy-without-icm'), configurationRevision: RevisionSchema, configurationHash: HashSchema, commitIndex: RevisionSchema }),
  z.strictObject({ kind: z.literal('configured'), configurationRevision: RevisionSchema, configurationHash: HashSchema, commitIndex: RevisionSchema, workspaceSnapshotHash: HashSchema }),
]);
export const IcmContextInspectionItemSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('corrupt'), position: RevisionSchema, identity: IdentitySchema.optional(), code: z.literal('packet-or-historical-source-invalid') }),
  z.strictObject({ kind: z.literal('verified'), position: RevisionSchema, identity: IdentitySchema,
    scope: IcmContextPacketScopeSchema, compilerVersion: z.string().min(1).max(120),
    workspaceSnapshotHash: HashSchema, packetHash: HashSchema, preparedContextHash: HashSchema.optional(),
    sources: z.array(IcmContextPacketSourceRefStructureSchema).min(1).max(512),
  }),
]);
export const IcmContextInspectionPageSchema = z.strictObject({
  kind: z.literal('icm-context-inspection-page'), scope: z.literal('complete-run-history'), runId: RunIdSchema,
  configuration: ConfigurationSchema, filters: IcmContextInspectionFiltersSchema,
  offset: z.number().int().min(0).max(1_000_000), limit: z.number().int().min(1).max(100), total: RevisionSchema,
  items: z.array(IcmContextInspectionItemSchema).max(100), hasMore: z.boolean(),
}).superRefine((page, context) => {
  if (page.items.length !== Math.min(page.limit, Math.max(0, page.total - page.offset)) || page.hasMore !== (page.offset + page.items.length < page.total)) context.addIssue({ code: 'custom', message: 'Paginación ICM inconsistente.' });
  for (const [index, item] of page.items.entries()) {
    if (item.position !== page.offset + index || item.kind === 'verified' && (item.scope.runId !== page.runId
      || item.scope.jobId !== item.identity.jobId || item.scope.generation !== item.identity.generation
      || JSON.stringify(item.scope.audience) !== JSON.stringify(item.identity.audience))) context.addIssue({ code: 'custom', path: ['items', index], message: 'Fila ICM fuera de su ámbito.' });
  }
});
export type IcmContextInspectionPage = z.infer<typeof IcmContextInspectionPageSchema>;
