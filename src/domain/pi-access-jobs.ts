import { z } from 'zod';
import {
  SelectableInferenceProfileSchema,
  type SelectableInferenceProfile,
} from './inference-profile.ts';
import { HashSchema, JobIdSchema, RevisionSchema } from './values.ts';

export const PiAccessJobStateSchema = z.enum([
  'queued', 'running', 'cancel-requested', 'succeeded', 'failed', 'canceled', 'interrupted',
]);
export const PiAccessResultKindSchema = z.enum(['passed', 'failed', 'aborted', 'ambiguous']);
export const PiAccessJobSafeCodeSchema = z.enum([
  'auth-required', 'model-unavailable', 'profile-mismatch', 'provider-rejected', 'local-failure',
  'cancelled-before-dispatch', 'cancelled-after-dispatch', 'timeout', 'transport-uncertain', 'auth-changed',
  'unconfirmed-payload', 'user-canceled', 'host-interrupted',
]);

export const PiAccessCheckUsageSchema = z.strictObject({
  input: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  output: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  cacheRead: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  cacheWrite: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  totalTokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  reasoning: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});
export type PiAccessCheckUsage = z.infer<typeof PiAccessCheckUsageSchema>;

/** Exact effective SDK observations are safe to show only after a confirmed pass. */
export const PiAccessEffectiveProfileSchema = z.strictObject({
  provider: z.string().min(1).max(120),
  api: z.string().min(1).max(120),
  model: z.string().min(1).max(120),
  providerThinkingLevel: z.string().min(1).max(40).nullable(),
  reasoningEvidence: z.literal('sdk-payload-and-response'),
});
export type PiAccessEffectiveProfile = z.infer<typeof PiAccessEffectiveProfileSchema>;

export const PiAccessPassedResultSchema = z.strictObject({
  effectiveProfile: PiAccessEffectiveProfileSchema,
  measuredUsage: PiAccessCheckUsageSchema,
});
export type PiAccessPassedResult = z.infer<typeof PiAccessPassedResultSchema>;

const PiAccessResultBaseSchema = z.strictObject({
  provider: z.enum(['openai-codex', 'anthropic']),
  requestedProfile: SelectableInferenceProfileSchema,
  profileFingerprint: HashSchema,
  accountFingerprint: HashSchema.nullable(),
});

export const PiAccessCheckStoredResultSchema = z.discriminatedUnion('kind', [
  PiAccessResultBaseSchema.extend({
    kind: z.literal('passed'),
    accountFingerprint: HashSchema,
    effectiveProfile: PiAccessEffectiveProfileSchema,
    measuredUsage: PiAccessCheckUsageSchema,
  }),
  PiAccessResultBaseSchema.extend({
    kind: z.literal('failed'),
    code: z.enum(['AUTH_REQUIRED', 'MODEL_UNAVAILABLE', 'PROFILE_MISMATCH', 'PROVIDER_REJECTED', 'LOCAL_FAILURE']),
  }),
  PiAccessResultBaseSchema.extend({
    kind: z.literal('aborted'),
    code: z.literal('CANCELLED_BEFORE_DISPATCH'),
  }),
  PiAccessResultBaseSchema.extend({
    kind: z.literal('ambiguous'),
    code: z.enum(['CANCELLED_AFTER_DISPATCH', 'TIMEOUT', 'TRANSPORT_UNCERTAIN', 'AUTH_CHANGED', 'UNCONFIRMED_PAYLOAD']),
  }),
]);
export type PiAccessCheckStoredResult = z.infer<typeof PiAccessCheckStoredResultSchema>;

export const PiAccessJobViewSchema = z.strictObject({
  kind: z.literal('pi-access-job'),
  jobId: JobIdSchema,
  provider: z.enum(['openai-codex', 'anthropic']),
  profile: SelectableInferenceProfileSchema,
  state: PiAccessJobStateSchema,
  revision: RevisionSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  resultKind: PiAccessResultKindSchema.nullable(),
  safeCode: PiAccessJobSafeCodeSchema.nullable(),
  passedResult: PiAccessPassedResultSchema.nullable(),
}).superRefine((job, context) => {
  if (job.provider !== job.profile.provider) {
    context.addIssue({ code: 'custom', path: ['provider'], message: 'El proveedor no coincide con el perfil del access-check.' });
  }
  const stateResultMatches = job.state === 'succeeded'
    ? job.resultKind === 'passed'
    : job.state === 'failed'
      ? job.resultKind === 'failed' || job.resultKind === 'ambiguous'
      : job.state === 'canceled'
        ? job.resultKind === null || job.resultKind === 'aborted'
        : job.state === 'interrupted'
          ? job.resultKind === null
          : job.resultKind === null;
  if (!stateResultMatches) {
    context.addIssue({ code: 'custom', path: ['resultKind'], message: 'El resultado no coincide con el estado durable del access-check.' });
  }
  if ((job.resultKind === 'passed') !== (job.passedResult !== null)) {
    context.addIssue({ code: 'custom', path: ['passedResult'], message: 'Sólo un access-check aprobado expone perfil efectivo y uso medido.' });
  }
  if (job.passedResult !== null) {
    const effective = job.passedResult.effectiveProfile;
    if (effective.provider !== job.profile.provider || effective.api !== job.profile.api || effective.model !== job.profile.model
      || (effective.providerThinkingLevel !== null && effective.providerThinkingLevel !== job.profile.reasoningEffort)) {
      context.addIssue({ code: 'custom', path: ['passedResult', 'effectiveProfile'], message: 'El perfil efectivo aprobado debe coincidir con el perfil solicitado.' });
    }
  }
  const knownFailureCodes = [
    'auth-required', 'model-unavailable', 'profile-mismatch', 'provider-rejected', 'local-failure',
  ];
  const knownAmbiguousCodes = [
    'cancelled-after-dispatch', 'timeout', 'transport-uncertain', 'auth-changed', 'unconfirmed-payload',
  ];
  let safeCodeMatches: boolean;
  switch (job.state) {
    case 'queued':
    case 'running':
    case 'cancel-requested':
      safeCodeMatches = job.safeCode === null;
      break;
    case 'succeeded':
      safeCodeMatches = job.resultKind === 'passed' && job.safeCode === null;
      break;
    case 'failed':
      safeCodeMatches = job.resultKind === 'failed'
        ? knownFailureCodes.includes(job.safeCode ?? '')
        : job.resultKind === 'ambiguous' && knownAmbiguousCodes.includes(job.safeCode ?? '');
      break;
    case 'canceled':
      safeCodeMatches = job.resultKind === 'aborted'
        ? job.safeCode === 'cancelled-before-dispatch'
        : job.resultKind === null && job.safeCode === 'user-canceled';
      break;
    case 'interrupted':
      safeCodeMatches = job.resultKind === null && job.safeCode === 'host-interrupted';
      break;
    default: {
      const exhaustive: never = job.state;
      safeCodeMatches = exhaustive;
    }
  }
  if (!safeCodeMatches) {
    context.addIssue({ code: 'custom', path: ['safeCode'], message: 'El código seguro no coincide con el estado durable del access-check.' });
  }
});
export type PiAccessJobView = z.infer<typeof PiAccessJobViewSchema>;

export const PiAccessJobCreateSchema = z.strictObject({
  principalId: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().uuid(),
  profile: SelectableInferenceProfileSchema,
});
export const PiAccessJobCreateResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('created'), job: PiAccessJobViewSchema }),
  z.strictObject({ kind: z.literal('existing'), job: PiAccessJobViewSchema }),
  z.strictObject({ kind: z.literal('idempotencyConflict') }),
]);
export const PiAccessJobLookupSchema = z.strictObject({ jobId: JobIdSchema });
export const PiAccessJobClaimSchema = z.strictObject({
  jobId: JobIdSchema,
  expectedRevision: RevisionSchema,
  ownerToken: z.string().uuid(),
  claimToken: z.string().uuid(),
});
export const PiAccessJobLeaseSchema = z.strictObject({ ownerToken: z.string().uuid(), claimToken: z.string().uuid() });
export const PiAccessJobClaimResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('claimed'), job: PiAccessJobViewSchema, lease: PiAccessJobLeaseSchema }),
  z.strictObject({ kind: z.literal('existing'), job: PiAccessJobViewSchema, lease: PiAccessJobLeaseSchema }),
  z.strictObject({ kind: z.literal('terminal'), job: PiAccessJobViewSchema }),
  z.strictObject({ kind: z.literal('stale'), job: PiAccessJobViewSchema }),
  z.strictObject({ kind: z.literal('busy') }),
  z.strictObject({ kind: z.literal('missing') }),
]);
export const PiAccessJobCompletionSchema = z.strictObject({
  jobId: JobIdSchema,
  expectedRevision: RevisionSchema,
  lease: PiAccessJobLeaseSchema,
  result: PiAccessCheckStoredResultSchema,
  checkedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).superRefine((input, context) => {
  if (Date.parse(input.checkedAt) >= Date.parse(input.expiresAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'El recibo de access-check debe expirar después de su medición.' });
  }
});
export const PiAccessJobCancelSchema = z.strictObject({
  principalId: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().uuid(),
  jobId: JobIdSchema,
  expectedRevision: RevisionSchema,
});
export const PiAccessJobMutationResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('updated'), job: PiAccessJobViewSchema }),
  z.strictObject({ kind: z.literal('existing'), job: PiAccessJobViewSchema }),
  z.strictObject({ kind: z.literal('terminal'), job: PiAccessJobViewSchema }),
  z.strictObject({ kind: z.literal('stale'), job: PiAccessJobViewSchema }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('idempotencyConflict') }),
]);
export const PiAccessJobListSchema = z.strictObject({
  principalId: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(1000).default(100),
  offset: z.number().int().min(0).max(1_000_000).default(0),
});

export const PiAccessReceiptLookupSchema = z.strictObject({
  provider: z.enum(['openai-codex', 'anthropic']),
  profileFingerprint: HashSchema,
  accountFingerprint: HashSchema,
});
/** Lookup for the last durable outcome, including aborts and ambiguous results. */
export const PiAccessLatestOutcomeLookupSchema = z.strictObject({
  provider: z.enum(['openai-codex', 'anthropic']),
  profileFingerprint: HashSchema,
});
export const PiAccessReceiptReadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({
    kind: z.literal('receipt'),
    jobId: JobIdSchema,
    resultKind: z.enum(['passed', 'failed']),
    provider: z.enum(['openai-codex', 'anthropic']),
    profileFingerprint: HashSchema,
    accountFingerprint: HashSchema,
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    code: z.enum(['AUTH_REQUIRED', 'MODEL_UNAVAILABLE', 'PROFILE_MISMATCH', 'PROVIDER_REJECTED', 'LOCAL_FAILURE']).nullable(),
  }),
]);

export function piAccessJobStateForResult(result: PiAccessCheckStoredResult): PiAccessJobView['state'] {
  switch (result.kind) {
    case 'passed': return 'succeeded';
    case 'failed': return 'failed';
    case 'aborted': return 'canceled';
    case 'ambiguous': return 'failed';
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

export function piAccessJobSafeCodeForResult(result: PiAccessCheckStoredResult): PiAccessJobView['safeCode'] {
  switch (result.kind) {
    case 'passed': return null;
    case 'failed':
      switch (result.code) {
        case 'AUTH_REQUIRED': return 'auth-required';
        case 'MODEL_UNAVAILABLE': return 'model-unavailable';
        case 'PROFILE_MISMATCH': return 'profile-mismatch';
        case 'PROVIDER_REJECTED': return 'provider-rejected';
        case 'LOCAL_FAILURE': return 'local-failure';
        default: return 'local-failure';
      }
    case 'aborted': return 'cancelled-before-dispatch';
    case 'ambiguous':
      switch (result.code) {
        case 'CANCELLED_AFTER_DISPATCH': return 'cancelled-after-dispatch';
        case 'TIMEOUT': return 'timeout';
        case 'TRANSPORT_UNCERTAIN': return 'transport-uncertain';
        case 'AUTH_CHANGED': return 'auth-changed';
        case 'UNCONFIRMED_PAYLOAD': return 'unconfirmed-payload';
        default: return 'unconfirmed-payload';
      }
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

export function piAccessPassedResult(result: PiAccessCheckStoredResult): PiAccessPassedResult | null {
  if (result.kind !== 'passed') return null;
  return PiAccessPassedResultSchema.parse({ effectiveProfile: result.effectiveProfile, measuredUsage: result.measuredUsage });
}

export function piAccessJobProfile(input: { job: PiAccessJobView }): SelectableInferenceProfile {
  return SelectableInferenceProfileSchema.parse(input.job.profile);
}
