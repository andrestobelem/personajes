import { z } from 'zod';
import { AdministrativeJobExecutionSchema } from './admin-role-jobs.ts';
import { ConfiguratorJobExecutionSchema } from './configurator-jobs.ts';
import { IcmContextPacketScopeSchema, IcmWorkspaceSnapshotSchema } from './icm-workspace.ts';
import { IcmContextPacketSchema } from './icm-workspace.ts';
import { ActorJobExecutionSchema, ContinuistaJobExecutionSchema } from './world-journal.ts';
import { HashSchema } from './values.ts';

/** A selector for an already claimed durable execution. Journal code must re-read
 * and validate its lease, job generation and frozen cut before deriving context. */
export const IcmContextJobBindingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('actor'), execution: ActorJobExecutionSchema }),
  z.strictObject({ kind: z.literal('continuista'), execution: ContinuistaJobExecutionSchema }),
  z.strictObject({ kind: z.literal('administrative'), execution: AdministrativeJobExecutionSchema }),
  z.strictObject({ kind: z.literal('configurator'), execution: ConfiguratorJobExecutionSchema }),
]);
export type IcmContextJobBinding = z.infer<typeof IcmContextJobBindingSchema>;

export const IcmContextBindingReadResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('legacy-without-icm') }),
  z.strictObject({
    kind: z.literal('required'),
    scope: IcmContextPacketScopeSchema,
    workspace: IcmWorkspaceSnapshotSchema,
    preparedContextHash: HashSchema.optional(),
  }),
]);
export type IcmContextBindingReadResult = z.infer<typeof IcmContextBindingReadResultSchema>;

export const IcmContextPacketReceiptSchema = z.strictObject({
  kind: z.literal('icm-context-packet-receipt'),
  scope: IcmContextPacketScopeSchema,
  workspaceSnapshotHash: HashSchema,
  packetHash: HashSchema,
  preparedContextHash: HashSchema.optional(),
});
export type IcmContextPacketReceipt = z.infer<typeof IcmContextPacketReceiptSchema>;

export const IcmContextPacketReadResultSchema = z.strictObject({
  packet: IcmContextPacketSchema,
  packetHash: HashSchema,
  scope: IcmContextPacketScopeSchema,
  preparedContextHash: HashSchema.optional(),
});
export type IcmContextPacketReadResult = z.infer<typeof IcmContextPacketReadResultSchema>;
