import { z } from 'zod';
import { FictionalInstantSchema, HashSchema, JobIdSchema, RevisionSchema, RunIdSchema, WorldSeqSchema } from './values.ts';

const PrincipalIdSchema = z.string().trim().min(1).max(200);
const IsoDateSchema = z.string().datetime({ offset: true });
const SafeCheckIdSchema = z.enum([
  'configuration', 'configuration-version', 'world-snapshot', 'prepared-contexts', 'catalog-eligibility',
  'inference-profile', 'pi-sdk', 'pi-profile', 'provider-authentication', 'provider-access-check',
  'pi-runtime', 'icm-memory', 'icm-context-runtime', 'budget', 'voice', 'participant-availability',
]);
const SafeCheckCodeSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/);
const KnownPreflightCheckCodes = new Set([
  'icm-context-runtime-not-connected',
  'director-runtime-unavailable', 'director-and-narrator-runtime-unavailable', 'provider-disconnected', 'provider-expired',
  'pi-sdk-version-mismatch', 'icm-readonly-sidecars-not-provisioned',
  'actor-context-mismatch', 'actor-not-eligible', 'audio-requires-confirmed-variety', 'authentication-method-incompatible',
  'budget-exhausted', 'configuration-invalid', 'configuration-revision-stale', 'context-run-mismatch', 'custom',
  'draft-field-empty', 'draft-schema-invalid', 'eligibility-snapshot-mismatch', 'host-read-failed', 'host-state-invalid',
  'human-participant-invalid', 'invalid-world-snapshot', 'legacy-inference-profile', 'memory-scope-invalid',
  'model-profile-incompatible', 'nonverbal-actor-has-speech', 'pi-runtime-incompatible', 'prepared-capability-mismatch',
  'prepared-context-mismatch', 'proposal-not-confirmed', 'provider-authentication-mismatch', 'snapshot-fence-stale',
  'voice-binding-required', 'voice-local-evidence-unavailable', 'voice-configuration-stale',
  'speaker-slot-mismatch', 'voice-binding-invalid', 'voice-credential-missing', 'configuration-not-ready',
  'prepared-context-missing', 'prepared-context-unavailable', 'pi-sdk-installation-unavailable', 'selected-model-unavailable',
  'provider-credential-unavailable', 'access-receipt-proof-invalid', 'access-receipt-unavailable', 'actor-runtime-context-missing',
  'actor-runtime-context-unavailable', 'icm-binary-not-configured', 'icm-binary-invalid', 'icm-version-mismatch',
  'icm-private-storage-unavailable', 'run-wall-time-ledger-unavailable', 'voice-runtime-unavailable',
  'run-wall-time-legacy-unknown', 'run-wall-time-uncertain', 'run-budget-unavailable', 'run-budget-scope-mismatch',
  'AUTH_REQUIRED', 'MODEL_UNAVAILABLE', 'PROFILE_MISMATCH', 'PROVIDER_REJECTED', 'LOCAL_FAILURE',
  'auth-required', 'model-unavailable', 'profile-mismatch', 'provider-rejected', 'local-failure',
]);
const RequiredPassedCheckIds = [
  'configuration',
  'configuration-version',
  'world-snapshot',
  'prepared-contexts',
  'catalog-eligibility',
  'inference-profile',
  'pi-sdk',
  'pi-profile',
  'provider-authentication',
  'pi-runtime',
  'icm-memory',
  'budget',
  'provider-access-check',
  'participant-availability',
  'voice',
] as const;

export const RunPreflightJobStateSchema = z.enum([
  'queued', 'running', 'cancel-requested', 'completed', 'failed', 'canceled', 'interrupted',
]);
export const RunPreflightOutcomeSchema = z.enum(['passed', 'blocked', 'invalid']);
export const RunPreflightJobSafeCodeSchema = z.enum([
  'evaluation-failed', 'host-interrupted', 'user-canceled', 'lease-lost',
  'configuration-changed', 'world-changed', 'access-receipt-changed',
]);

/** Public summary only. Free-form check details and private hashes never enter this DTO. */
export const RunPreflightCheckSummarySchema = z.strictObject({
  kind: z.enum(['passed', 'blocked', 'deferred', 'unavailable']),
  checkId: SafeCheckIdSchema,
  code: SafeCheckCodeSchema.optional(),
});
export const RunPreflightResultSchema = z.strictObject({
  kind: RunPreflightOutcomeSchema,
  checkedAt: IsoDateSchema,
  checks: z.array(RunPreflightCheckSummarySchema).min(1).max(256),
}).superRefine((result, context) => {
  if (result.kind === 'passed' && result.checks.some((entry) => entry.kind !== 'passed')) {
    context.addIssue({ code: 'custom', path: ['checks'], message: 'Un preflight aprobado sólo admite checks pasados.' });
  }
  if (result.kind !== 'passed' && result.checks.every((entry) => entry.kind === 'passed')) {
    context.addIssue({ code: 'custom', path: ['checks'], message: 'Un preflight no aprobado requiere al menos un check pendiente o bloqueado.' });
  }
  if (result.kind === 'passed') {
    const counts = new Map<string, number>();
    for (const entry of result.checks) counts.set(entry.checkId, (counts.get(entry.checkId) ?? 0) + 1);
    const missing = RequiredPassedCheckIds.filter((checkId) => counts.get(checkId) !== 1);
    const icmCount=counts.get('icm-context-runtime')??0;
    if (missing.length > 0 || icmCount>1 || result.checks.length !== RequiredPassedCheckIds.length+(icmCount===1?1:0)) {
      context.addIssue({
        code: 'custom',
        path: ['checks'],
        message: `Un preflight aprobado requiere exactamente una comprobación pasada por gate: ${RequiredPassedCheckIds.join(', ')}; el gate icm-context-runtime es adicional cuando está seleccionado.`,
      });
    }
  }
});
export type RunPreflightResult = z.infer<typeof RunPreflightResultSchema>;

/** Preserve known public codes while replacing arbitrary host diagnostics at the public boundary. */
export function projectPublicRunPreflightResult(result: RunPreflightResult): RunPreflightResult {
  const checks = result.checks.map((entry) => {
    if (entry.code === undefined || KnownPreflightCheckCodes.has(entry.code)) return entry;
    if (entry.kind === 'passed') {
      const { code: _discarded, ...withoutCode } = entry;
      return withoutCode;
    }
    return { ...entry, code: entry.kind === 'blocked' ? 'check-blocked' : entry.kind === 'deferred' ? 'check-deferred' : 'check-unavailable' };
  });
  return RunPreflightResultSchema.parse({ ...result, checks });
}

/** Safe view of one durable preflight attempt and the exact World cut it captured. */
export const RunPreflightJobViewSchema = z.strictObject({
  kind: z.literal('run-preflight-job'),
  jobId: JobIdSchema,
  runId: RunIdSchema,
  state: RunPreflightJobStateSchema,
  revision: RevisionSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  configurationRevision: RevisionSchema,
  worldRevision: RevisionSchema,
  worldSeq: WorldSeqSchema,
  fictitiousAt: FictionalInstantSchema,
  resultKind: RunPreflightOutcomeSchema.nullable(),
  safeCode: RunPreflightJobSafeCodeSchema.nullable(),
}).superRefine((job, context) => {
  if (job.state === 'completed' && job.resultKind === null) {
    context.addIssue({ code: 'custom', path: ['resultKind'], message: 'Un preflight completado requiere un resultado durable.' });
  }
  if (job.state !== 'completed' && job.resultKind !== null) {
    context.addIssue({ code: 'custom', path: ['resultKind'], message: 'El resultado sólo aparece después de completar el preflight.' });
  }
  const expectedCode = job.state === 'failed'
    ? ['evaluation-failed', 'lease-lost', 'configuration-changed', 'world-changed', 'access-receipt-changed'].includes(job.safeCode ?? '')
    : job.state === 'interrupted'
      ? job.safeCode === 'host-interrupted'
      : job.state === 'canceled'
        ? job.safeCode === 'user-canceled'
        : job.safeCode === null;
  if (!expectedCode) context.addIssue({ code: 'custom', path: ['safeCode'], message: 'El código seguro no coincide con el estado del job.' });
});
export type RunPreflightJobView = z.infer<typeof RunPreflightJobViewSchema>;

export const RunPreflightJobDocumentSchema = z.strictObject({
  kind: z.literal('run-preflight-job-document'),
  job: RunPreflightJobViewSchema,
  report: z.strictObject({
    kind: z.enum(['current', 'stale']),
    result: RunPreflightResultSchema.nullable(),
  }),
}).superRefine((document, context) => {
  if ((document.job.state === 'completed') !== (document.report.result !== null)
    || (document.report.result !== null && document.job.resultKind !== document.report.result.kind)) {
    context.addIssue({ code: 'custom', path: ['report', 'result'], message: 'El reporte durable no coincide con el estado ni el resultado del job.' });
  }
});
export const RunPreflightJobReceiptSchema = z.strictObject({
  kind: z.literal('run-preflight-job-receipt'),
  job: RunPreflightJobViewSchema,
});
export const RunPreflightJobPageSchema = z.strictObject({
  kind: z.literal('run-preflight-job-page'),
  items: z.array(RunPreflightJobDocumentSchema).max(1000),
  limit: z.number().int().min(1).max(1000),
  offset: z.number().int().min(0).max(1_000_000),
  truncated: z.boolean(),
});

export const RunPreflightJobStartSchema = z.strictObject({
  principalId: PrincipalIdSchema,
  idempotencyKey: z.string().uuid(),
  runId: RunIdSchema,
  expectedConfigurationRevision: RevisionSchema,
  expectedWorldRevision: RevisionSchema,
});
export const RunPreflightJobStartResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('created'), job: RunPreflightJobViewSchema }),
  z.strictObject({ kind: z.literal('existing'), job: RunPreflightJobViewSchema }),
  z.strictObject({ kind: z.literal('idempotencyConflict') }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('invalidLifecycle'), lifecycle: z.enum(['draft', 'running', 'closed']) }),
  z.strictObject({ kind: z.literal('stale'), currentConfigurationRevision: RevisionSchema, currentWorldRevision: RevisionSchema }),
  z.strictObject({ kind: z.literal('invalidConfiguration') }),
]);
export const RunPreflightJobLookupSchema = z.strictObject({ runId: RunIdSchema, jobId: JobIdSchema });
export const RunPreflightJobListSchema = z.strictObject({
  runId: RunIdSchema,
  limit: z.number().int().min(1).max(1000).default(100),
  offset: z.number().int().min(0).max(1_000_000).default(0),
});
export const RunPreflightJobClaimSchema = z.strictObject({
  runId: RunIdSchema,
  jobId: JobIdSchema,
  expectedRevision: RevisionSchema,
  ownerToken: z.string().uuid(),
  claimToken: z.string().uuid(),
});
export const RunPreflightJobLeaseSchema = z.strictObject({ ownerToken: z.string().uuid(), claimToken: z.string().uuid() });
export const RunPreflightJobClaimResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('claimed'), job: RunPreflightJobViewSchema, lease: RunPreflightJobLeaseSchema }),
  z.strictObject({ kind: z.literal('existing'), job: RunPreflightJobViewSchema, lease: RunPreflightJobLeaseSchema }),
  z.strictObject({ kind: z.literal('terminal'), job: RunPreflightJobViewSchema }),
  z.strictObject({ kind: z.literal('stale'), job: RunPreflightJobViewSchema }),
  z.strictObject({ kind: z.literal('busy') }),
  z.strictObject({ kind: z.literal('missing') }),
]);
export const RunPreflightFenceSchema = z.strictObject({
  configurationRevision: RevisionSchema,
  configurationHash: HashSchema,
  worldRevision: RevisionSchema,
  worldSeq: WorldSeqSchema,
  fictitiousAt: FictionalInstantSchema,
});
export const RunPreflightJobInputResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('found'),
    job: RunPreflightJobViewSchema,
    configuration: z.unknown(),
    fence: RunPreflightFenceSchema,
    lease: RunPreflightJobLeaseSchema,
  }),
  z.strictObject({ kind: z.literal('stale'), job: RunPreflightJobViewSchema }),
  z.strictObject({ kind: z.literal('missing') }),
]);

/** Host-private proof retained with a result. Never return this shape to HTTP or actors. */
export const RunPreflightPrivateEvidenceSchema = z.strictObject({
  provider: z.enum(['openai-codex', 'anthropic']).nullable(),
  profileFingerprint: HashSchema.nullable(),
  accountFingerprint: HashSchema.nullable(),
  accessReceipt: z.strictObject({
    jobId: JobIdSchema,
    resultKind: z.enum(['passed', 'failed']),
    provider: z.enum(['openai-codex', 'anthropic']),
    profileFingerprint: HashSchema,
    accountFingerprint: HashSchema,
    checkedAt: IsoDateSchema,
    expiresAt: IsoDateSchema,
  }).nullable(),
}).superRefine((evidence, context) => {
  const receipt = evidence.accessReceipt;
  if (receipt !== null && (receipt.provider !== evidence.provider
    || receipt.profileFingerprint !== evidence.profileFingerprint
    || receipt.accountFingerprint !== evidence.accountFingerprint)) {
    context.addIssue({ code: 'custom', path: ['accessReceipt'], message: 'El recibo no coincide con las huellas privadas del preflight.' });
  }
  if (evidence.provider === null && (evidence.profileFingerprint !== null || evidence.accountFingerprint !== null || receipt !== null)) {
    context.addIssue({ code: 'custom', path: ['provider'], message: 'La evidencia sin proveedor no puede incluir huellas ni recibo.' });
  }
});
export const RunPreflightJobEvidenceLookupSchema = z.strictObject({ runId: RunIdSchema, jobId: JobIdSchema });
export const RunPreflightJobEvidenceReadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('found'), evidence: RunPreflightPrivateEvidenceSchema }),
  z.strictObject({ kind: z.literal('missing') }),
]);
export const RunPreflightEvaluationSchema = z.strictObject({
  fence: RunPreflightFenceSchema,
  result: RunPreflightResultSchema,
  evidence: RunPreflightPrivateEvidenceSchema,
}).superRefine((evaluation, context) => {
  const providerCheck = evaluation.result.checks.find((check) => check.checkId === 'provider-access-check');
  if (providerCheck?.kind === 'passed' && evaluation.evidence.accessReceipt?.resultKind !== 'passed') {
    context.addIssue({ code: 'custom', path: ['evidence', 'accessReceipt'], message: 'El check de acceso pasado requiere el recibo privado exacto.' });
  }
  if (evaluation.result.kind === 'passed'
    && (evaluation.evidence.provider === null || evaluation.evidence.profileFingerprint === null
      || evaluation.evidence.accountFingerprint === null || evaluation.evidence.accessReceipt?.resultKind !== 'passed')) {
    context.addIssue({ code: 'custom', path: ['evidence'], message: 'Un preflight aprobado requiere proveedor, perfil, cuenta y recibo de acceso vigentes.' });
  }
});
export const RunPreflightJobCompletionSchema = z.strictObject({
  runId: RunIdSchema,
  jobId: JobIdSchema,
  expectedRevision: RevisionSchema,
  lease: RunPreflightJobLeaseSchema,
  evaluation: RunPreflightEvaluationSchema,
});
export const RunPreflightJobFailureSchema = z.strictObject({
  runId: RunIdSchema,
  jobId: JobIdSchema,
  expectedRevision: RevisionSchema,
  lease: RunPreflightJobLeaseSchema,
  safeCode: z.literal('evaluation-failed'),
});
export const RunPreflightJobCancelSchema = z.strictObject({
  principalId: PrincipalIdSchema,
  idempotencyKey: z.string().uuid(),
  runId: RunIdSchema,
  jobId: JobIdSchema,
  expectedRevision: RevisionSchema,
});
export const RunPreflightJobMutationResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('updated'), job: RunPreflightJobViewSchema }),
  z.strictObject({ kind: z.literal('existing'), job: RunPreflightJobViewSchema }),
  z.strictObject({ kind: z.literal('terminal'), job: RunPreflightJobViewSchema }),
  z.strictObject({ kind: z.literal('stale'), job: RunPreflightJobViewSchema }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('idempotencyConflict') }),
]);
export const RunPreflightJobOperationResultSchema = z.union([
  RunPreflightJobStartResultSchema,
  RunPreflightJobMutationResultSchema,
]);
export const RunPreflightJobRecoverySchema = z.strictObject({ ownerToken: z.string().uuid() });

export type RunPreflightPrivateEvidence = z.infer<typeof RunPreflightPrivateEvidenceSchema>;
export type RunPreflightEvaluation = z.infer<typeof RunPreflightEvaluationSchema>;
