import { z } from 'zod';
import { RunIdSchema } from './values.ts';

const nonNegativeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

export const ModelTimeClockEpochIdSchema = z.string().uuid();
export const MonotonicNanosecondsSchema = z.string().regex(/^(0|[1-9]\d{0,39})$/);
export const ModelWallTimeReasonSchema = z.enum(['timeout', 'cancelled', 'host-interrupted']);

export const ModelWallTimeClockSampleSchema = z.strictObject({
  clockEpochId: ModelTimeClockEpochIdSchema,
  monotonicNs: MonotonicNanosecondsSchema,
});

export const ModelWallTimeGrantSchema = z.strictObject({
  reservedMs: positiveInteger,
  clockEpochId: ModelTimeClockEpochIdSchema,
});

export const ModelWallTimeExpirationSchema = z.strictObject({
  clockEpochId: ModelTimeClockEpochIdSchema,
  reason: ModelWallTimeReasonSchema,
});

export const RunModelTimeBudgetReadSchema = z.strictObject({ runId: RunIdSchema });
export const ModelTimeOwnerRecoverySchema = z.strictObject({ ownerToken: z.string().uuid() });

const RunModelTimeBudgetBaseSchema = z.strictObject({
  runId: RunIdSchema,
  maxPiCallsPerRun: nonNegativeInteger,
  runCallsUsed: nonNegativeInteger,
  reservedPiCalls: nonNegativeInteger,
  maxPiCallsPerPulse: nonNegativeInteger,
  pulseCallsUsed: nonNegativeInteger,
  maxConcurrentPiRequests: positiveInteger,
  activePiRequests: nonNegativeInteger,
  maxWallTimeMs: nonNegativeInteger,
  wallTimeReservedMs: nonNegativeInteger,
  requestTimeoutMs: positiveInteger,
  uncertainRequests: nonNegativeInteger,
  unknownLegacyRequests: nonNegativeInteger,
});

export const RunModelTimeBudgetSchema = z.discriminatedUnion('status', [
  RunModelTimeBudgetBaseSchema.extend({
    status: z.literal('known'),
    wallTimeMeasuredMs: nonNegativeInteger,
    wallTimeRemainingMs: nonNegativeInteger,
  }),
  RunModelTimeBudgetBaseSchema.extend({
    status: z.literal('uncertain'),
    wallTimeMeasuredMs: nonNegativeInteger,
    wallTimeRemainingMs: nonNegativeInteger,
    uncertainRequests: positiveInteger,
  }),
  RunModelTimeBudgetBaseSchema.extend({
    status: z.literal('legacy-unknown'),
    wallTimeMeasuredMs: z.null(),
    wallTimeRemainingMs: z.null(),
    unknownLegacyRequests: positiveInteger,
  }),
]);

export type RunModelTimeBudget = z.infer<typeof RunModelTimeBudgetSchema>;
