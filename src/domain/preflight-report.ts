import { z } from 'zod';
import { RunIdSchema, RevisionSchema, WorldSeqSchema, FictionalInstantSchema, HashSchema } from './values.ts';

export const PreflightSnapshotFenceSchema = z.strictObject({
  runId: RunIdSchema, revision: RevisionSchema, seq: WorldSeqSchema, fictionalAt: FictionalInstantSchema,
});

const PassedPreflightCheckSchema = z.strictObject({
  kind: z.literal('passed'), checkId: z.string().min(1).max(100), detail: z.string().min(1).max(500),
});
const DeferredPreflightCheckSchema = z.strictObject({
  kind: z.literal('deferred'), checkId: z.string().min(1).max(100), detail: z.string().min(1).max(500),
});
const BlockedPreflightCheckSchema = z.strictObject({
  kind: z.literal('blocked'), checkId: z.string().min(1).max(100), code: z.string().min(1).max(100), detail: z.string().min(1).max(500),
});
const UnavailablePreflightCheckSchema = z.strictObject({
  kind: z.literal('unavailable'), checkId: z.string().min(1).max(100), code: z.string().min(1).max(100), detail: z.string().min(1).max(500),
});
export const PreflightCheckSchema = z.discriminatedUnion('kind', [
  PassedPreflightCheckSchema,
  DeferredPreflightCheckSchema,
  BlockedPreflightCheckSchema,
  UnavailablePreflightCheckSchema,
]);
export type PreflightCheck = z.infer<typeof PreflightCheckSchema>;

export const PreflightReportSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('invalid'),
    checks: z.array(z.union([
      DeferredPreflightCheckSchema,
      BlockedPreflightCheckSchema,
      UnavailablePreflightCheckSchema,
    ])).min(1),
  }),
  z.strictObject({
    kind: z.literal('passed'),
    runId: RunIdSchema,
    configRevision: RevisionSchema,
    snapshotFence: PreflightSnapshotFenceSchema,
    profileFingerprint: HashSchema,
    observedAt: z.string().datetime({ offset: true }),
    checks: z.array(PassedPreflightCheckSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal('blocked'),
    runId: RunIdSchema,
    configRevision: RevisionSchema,
    snapshotFence: PreflightSnapshotFenceSchema,
    profileFingerprint: HashSchema.nullable(),
    observedAt: z.string().datetime({ offset: true }),
    checks: z.array(PreflightCheckSchema).min(1).refine(
      (checks) => checks.some((entry) => entry.kind !== 'passed'),
      'Un reporte bloqueado requiere al menos una comprobación pendiente, bloqueada o no disponible.',
    ),
  }).strict(),
]);
/** `passed` is execution-eligible only when every required gate is explicitly passed. */
export type PreflightReport = z.infer<typeof PreflightReportSchema>;
