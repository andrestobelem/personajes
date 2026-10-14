import { z } from 'zod';
import { StoredPiProfileSchema } from './inference-profile.ts';
import { WorldLifecycleSchema } from './run-lifecycle.ts';
export { RunControlCommandSchema, RunLifecycleViewSchema, WorldLifecycleSchema, resolveRunControlTransition } from './run-lifecycle.ts';
import type { WorldIdSource } from './world.ts';
import { ActorKnowledgeSchema, SceneIdSchema, WorldAttemptIdSchema, WorldAttemptSchema, WorldSnapshotSchema, hashCommunicationContent } from './world.ts';
import { ProductionValidationIssueSchema, RunConfigurationDraftSchema } from './production.ts';
import { HumanInterventionRequestSchema } from './interaction.ts';
import { HumanInterventionResolutionSchema } from './human-intervention.ts';
import { ActorWorldProjectionRequestSchema, ContinuityReferenceSchema } from './preparation.ts';
import {
  HashSchema, CharacterIdSchema, FictionalInstantSchema, HumanParticipantIdSchema, PerceptionIdSchema, ProposalIdSchema, RevisionSchema, RunIdSchema,
  JobIdSchema, PulseIdSchema, WorldSeqSchema,
} from './values.ts';

export {
  ModelTimeClockEpochIdSchema, MonotonicNanosecondsSchema, ModelWallTimeClockSampleSchema,
  ModelWallTimeGrantSchema, ModelWallTimeReasonSchema, ModelWallTimeExpirationSchema,
  RunModelTimeBudgetReadSchema, ModelTimeOwnerRecoverySchema, RunModelTimeBudgetSchema,
} from './model-time-budget.ts';

export { PiOAuthJobStateSchema, PiOAuthJobSafeCodeSchema, PiOAuthJobViewSchema, PiOAuthJobCreateSchema, PiOAuthJobCreateResultSchema, PiOAuthJobLookupSchema, PiOAuthJobClaimSchema, PiOAuthJobClaimResultSchema, PiOAuthJobCompletionSchema, PiOAuthJobCancelSchema, PiOAuthJobMutationResultSchema } from './pi-oauth-jobs.ts';
export {
  PiAccessJobStateSchema, PiAccessResultKindSchema, PiAccessJobSafeCodeSchema, PiAccessCheckUsageSchema,
  PiAccessEffectiveProfileSchema, PiAccessPassedResultSchema, PiAccessCheckStoredResultSchema, PiAccessJobViewSchema,
  PiAccessJobCreateSchema, PiAccessJobCreateResultSchema, PiAccessJobLookupSchema, PiAccessJobClaimSchema,
  PiAccessJobLeaseSchema, PiAccessJobClaimResultSchema, PiAccessJobCompletionSchema, PiAccessJobCancelSchema,
  PiAccessJobMutationResultSchema, PiAccessJobListSchema, PiAccessReceiptLookupSchema, PiAccessLatestOutcomeLookupSchema, PiAccessReceiptReadSchema,
  piAccessJobStateForResult, piAccessJobSafeCodeForResult, piAccessPassedResult,
} from './pi-access-jobs.ts';
export {
  RunPreflightJobStateSchema, RunPreflightOutcomeSchema, RunPreflightJobSafeCodeSchema,
  RunPreflightCheckSummarySchema, RunPreflightResultSchema, RunPreflightJobViewSchema,
  RunPreflightJobDocumentSchema, RunPreflightJobReceiptSchema, RunPreflightJobPageSchema,
  RunPreflightJobStartSchema, RunPreflightJobStartResultSchema, RunPreflightJobLookupSchema,
  RunPreflightJobListSchema, RunPreflightJobEvidenceLookupSchema, RunPreflightJobEvidenceReadSchema,
  RunPreflightJobClaimSchema, RunPreflightJobLeaseSchema,
  RunPreflightJobClaimResultSchema, RunPreflightPrivateEvidenceSchema, RunPreflightEvaluationSchema,
  RunPreflightFenceSchema, RunPreflightJobInputResultSchema,
  RunPreflightJobCompletionSchema, RunPreflightJobFailureSchema, RunPreflightJobCancelSchema, RunPreflightJobMutationResultSchema,
  RunPreflightJobOperationResultSchema, RunPreflightJobRecoverySchema,
  projectPublicRunPreflightResult,
} from './run-preflight-jobs.ts';

export const RunDraftPrincipalSchema = z.string().trim().min(1).max(200);
export const RunDraftPatchSchema = RunConfigurationDraftSchema.omit({kind:true,schemaVersion:true,runId:true,revision:true}).partial();
export const RunDraftCreateSchema = z.strictObject({principalId:RunDraftPrincipalSchema,idempotencyKey:z.string().uuid(),patch:RunDraftPatchSchema.default({})});
export const RunDraftUpdateSchema = z.strictObject({principalId:RunDraftPrincipalSchema,idempotencyKey:z.string().uuid(),runId:RunIdSchema,expectedRevision:RevisionSchema,patch:RunDraftPatchSchema});
export const RunDraftValidateSchema = z.strictObject({principalId:RunDraftPrincipalSchema,idempotencyKey:z.string().uuid(),runId:RunIdSchema,expectedRevision:RevisionSchema});
export const RunDraftValidationResultSchema = z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('ready'),runId:RunIdSchema,revision:RevisionSchema,worldRevision:RevisionSchema,configurationHash:HashSchema}),
  z.strictObject({kind:z.literal('incomplete'),runId:RunIdSchema,revision:RevisionSchema,issues:z.array(ProductionValidationIssueSchema).min(1)}),
  z.strictObject({kind:z.literal('invalid'),runId:RunIdSchema,revision:RevisionSchema,issues:z.array(ProductionValidationIssueSchema).min(1)}),
  z.strictObject({kind:z.literal('conflict'),currentRevision:RevisionSchema}),
  z.strictObject({kind:z.literal('missing')}),
  z.strictObject({kind:z.literal('invalidLifecycle'),lifecycle:z.enum(['running','paused','stopped','closed'])}),
  z.strictObject({kind:z.literal('idempotencyConflict')}),
]);

export const RunDraftReadSchema = z.strictObject({runId:RunIdSchema,revision:RevisionSchema.optional()});
export const RunDraftListSchema = z.strictObject({limit:z.number().int().min(1).max(1000).default(100),offset:z.number().int().min(0).max(1_000_000).default(0)});
export const RunDraftHistoryEntrySchema = z.strictObject({draft:RunConfigurationDraftSchema,principalId:RunDraftPrincipalSchema,recordedAt:z.string().datetime({offset:true}),payloadHash:HashSchema});
export const RunDraftMutationResultSchema = z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('created'),draft:RunConfigurationDraftSchema}),
  z.strictObject({kind:z.literal('stored'),draft:RunConfigurationDraftSchema}),
  z.strictObject({kind:z.literal('existing'),draft:RunConfigurationDraftSchema}),
  z.strictObject({kind:z.literal('conflict'),currentRevision:RevisionSchema}),
  z.strictObject({kind:z.literal('missing')}),
  z.strictObject({kind:z.literal('invalidLifecycle'),lifecycle:z.enum(['running','paused','stopped','closed'])}),
  z.strictObject({kind:z.literal('idempotencyConflict')}),
]);

export const RunDraftOperationResultSchema = z.union([RunDraftMutationResultSchema,RunDraftValidationResultSchema]);

export const RunDraftStateSchema = z.strictObject({runId:RunIdSchema,revision:RevisionSchema,configurationRevision:RevisionSchema,lifecycle:WorldLifecycleSchema,worldRevision:RevisionSchema.nullable(),configurationHash:HashSchema.nullable()});
export type WorldLifecycle = z.infer<typeof WorldLifecycleSchema>;

export const PreparedContextFenceSchema = z.strictObject({
  actorId: CharacterIdSchema,
  continuityId: z.string().min(1).max(120),
  continuityRevision: RevisionSchema,
  continuityContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  identityVersion: RevisionSchema,
  preparedContextHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export const WorldContinuityFenceSchema = z.strictObject({
  kind: z.literal('prepared-contexts'),
  atWorldSeq: WorldSeqSchema,
  contexts: z.array(PreparedContextFenceSchema).min(1).max(10_000),
});
export type WorldContinuityFence = z.infer<typeof WorldContinuityFenceSchema>;

export const WorldRunRegistrationSchema = z.strictObject({
  initialSnapshot: WorldSnapshotSchema,
  configurationRevision: RevisionSchema,
  configuration: z.record(z.string(), z.unknown()),
  continuityFence: WorldContinuityFenceSchema,
  lifecycle: WorldLifecycleSchema,
});
export type WorldRunRegistration = z.infer<typeof WorldRunRegistrationSchema>;

export const WorldProposalDraftSchema = z.strictObject({
  proposalId: ProposalIdSchema,
  version: z.number().int().min(1).max(3),
  attempt: WorldAttemptSchema,
});

export const WorldProposalRegistrationSchema = z.strictObject({
  runId: RunIdSchema,
  proposalId: ProposalIdSchema,
  version: z.number().int().min(1).max(3),
  jobId: JobIdSchema,
  generation: RevisionSchema,
  proposalSlot: z.number().int().min(0).max(2),
  /** Required by the journal whenever this proposal belongs to a durable actor job. */
  lease: z.strictObject({ ownerToken: z.string().uuid(), claimToken: z.string().uuid() }).optional(),
  attempt: WorldAttemptSchema,
});

export const WorldProposalRecordSchema = z.strictObject({
  proposalId: ProposalIdSchema,
  version: z.number().int().min(1).max(3),
  runId: RunIdSchema,
  jobId: JobIdSchema.optional(),
  generation: RevisionSchema.optional(),
  proposalSlot: z.number().int().min(0).max(2).optional(),
  actorId: CharacterIdSchema,
  sceneId: SceneIdSchema,
  attemptId: WorldAttemptIdSchema,
  baseRevision: RevisionSchema,
  exactContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  attemptHash: z.string().regex(/^[0-9a-f]{64}$/),
  attempt: WorldAttemptSchema,
}).superRefine((record, context) => {
  const scopeFields = [record.jobId, record.generation, record.proposalSlot];
  if (scopeFields.some((value) => value === undefined) && scopeFields.some((value) => value !== undefined)) {
    context.addIssue({ code: 'custom', path: ['jobId'], message: 'El scope de slot debe estar completo o ser legacy' });
  }
  if (record.attempt.runId !== record.runId || record.attempt.actorId !== record.actorId
    || record.attempt.attemptId !== record.attemptId || record.attempt.expectedRevision !== record.baseRevision) {
    context.addIssue({ code: 'custom', path: ['attempt'], message: 'La propuesta no coincide con su corrida, actor, intento o revisión base' });
  }
  const expectedContentHash = record.attempt.kind === 'communicate'
    ? hashCommunicationContent(record.attempt.content)
    : record.attemptHash;
  if (record.exactContentHash !== expectedContentHash) {
    context.addIssue({ code: 'custom', path: ['exactContentHash'], message: 'El hash exacto no coincide con el contenido de la propuesta' });
  }
});
export type WorldProposalRecord = z.infer<typeof WorldProposalRecordSchema>;

export const ContinuistaCriterionSchema = z.enum([
  'knowledge', 'continuity', 'identity', 'voice', 'periodPlace', 'motivation', 'rhythm', 'authority',
]);

const ContinuistaReviewFieldsSchema = z.strictObject({
  kind: z.literal('continuista'),
  proposalId: ProposalIdSchema,
  version: z.number().int().min(1).max(3),
  runId: RunIdSchema,
  actorId: CharacterIdSchema,
  stateRevision: RevisionSchema,
  exactContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  verdict: z.enum(['allow', 'reformulate', 'reject']),
  criterionCodes: z.array(ContinuistaCriterionSchema).max(8),
  /** Public diagnosis; excludes evidence and free text. Absent only in legacy data or non-reformulation reviews. */
  failedCriterionCodes: z.array(ContinuistaCriterionSchema).max(8).optional(),
  evidenceRefs: z.array(z.string().min(1).max(120)).max(500),
  complete: z.boolean(),
}).superRefine((review, context) => {
  if (new Set(review.criterionCodes).size !== review.criterionCodes.length) {
    context.addIssue({ code: 'custom', path: ['criterionCodes'], message: 'Criterio duplicado' });
  }
  if (new Set(review.failedCriterionCodes ?? []).size !== (review.failedCriterionCodes ?? []).length) {
    context.addIssue({ code: 'custom', path: ['failedCriterionCodes'], message: 'Criterio fallido duplicado' });
  }
  if ((review.failedCriterionCodes ?? []).some((criterion) => !review.criterionCodes.includes(criterion))) {
    context.addIssue({ code: 'custom', path: ['failedCriterionCodes'], message: 'Un criterio fallido debe haberse evaluado' });
  }
  if (review.verdict === 'allow' && (review.failedCriterionCodes ?? []).length > 0) {
    context.addIssue({ code: 'custom', path: ['failedCriterionCodes'], message: 'Allow no admite criterios fallidos' });
  }
  if (new Set(review.evidenceRefs).size !== review.evidenceRefs.length) {
    context.addIssue({ code: 'custom', path: ['evidenceRefs'], message: 'Referencia duplicada' });
  }
});
/** Preserves canonical payloads and hashes of reviews recorded before public diagnosis existed. */
export const ContinuistaStoredReviewSchema = ContinuistaReviewFieldsSchema;
export const ContinuistaReviewInputSchema = ContinuistaReviewFieldsSchema.superRefine((review, context) => {
  if (review.complete && review.verdict === 'reformulate' && (review.failedCriterionCodes ?? []).length === 0) {
    context.addIssue({ code: 'custom', path: ['failedCriterionCodes'], message: 'Una reformulación completa requiere diagnóstico de criterios fallidos' });
  }
});
export type ContinuistaReviewInput = z.infer<typeof ContinuistaReviewInputSchema>;

export const ActorWorldKnowledgeCasSchema = z.strictObject({
  kind: z.literal('actor-knowledge-cas'),
  actorId: CharacterIdSchema,
  runId: RunIdSchema,
  expectedWorldRevision: RevisionSchema,
  expectedWorldSeq: WorldSeqSchema,
  expectedContinuity: ContinuityReferenceSchema,
  expectedKnowledgeRevision: RevisionSchema,
  knowledge: ActorKnowledgeSchema,
}).superRefine((write, context) => {
  if (write.knowledge.actorId !== write.actorId || write.knowledge.runId !== write.runId) {
    context.addIssue({ code: 'custom', path: ['knowledge'], message: 'El conocimiento CAS no pertenece al actor/corrida del comando' });
  }
});

export const WorldLifecycleWriteSchema = z.strictObject({
  runId: RunIdSchema,
  expectedWorldRevision: RevisionSchema,
  expectedConfigRevision: RevisionSchema,
  target: WorldLifecycleSchema,
});

export const RunLifecycleStateSchema = z.strictObject({
  runId: RunIdSchema,
  lifecycle: WorldLifecycleSchema,
  lifecycleRevision: RevisionSchema,
  configRevision: RevisionSchema,
  worldRevision: RevisionSchema,
  lastWorldSeq: WorldSeqSchema,
  createdAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  updatedAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  closedAt: z.string().datetime({ offset: true }).nullable(),
}).superRefine((state, context) => {
  if ((state.lifecycle === 'closed') !== (state.closedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['closedAt'], message: 'Sólo un lifecycle cerrado tiene instante de cierre.' });
  }
});
export const RunLifecycleCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('start') }),
  z.strictObject({ kind: z.literal('pause') }),
  z.strictObject({ kind: z.literal('resume') }),
  z.strictObject({ kind: z.literal('stop') }),
  z.strictObject({ kind: z.literal('close') }),
]);
export const RunLifecycleCommandWriteSchema = z.strictObject({
  principalId: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().uuid(),
  runId: RunIdSchema,
  expectedLifecycleRevision: RevisionSchema,
  expectedConfigRevision: RevisionSchema,
  expectedWorldRevision: RevisionSchema,
  command: RunLifecycleCommandSchema,
  preflightJobId: JobIdSchema.optional(),
}).superRefine((request, context) => {
  if ((request.command.kind === 'start' || request.command.kind === 'resume') && request.preflightJobId === undefined) {
    context.addIssue({ code: 'custom', path: ['preflightJobId'], message: 'Iniciar o reanudar requiere un preflight durable.' });
  }
  if (request.command.kind !== 'start' && request.command.kind !== 'resume' && request.preflightJobId !== undefined) {
    context.addIssue({ code: 'custom', path: ['preflightJobId'], message: 'Este comando no consume un preflight.' });
  }
});
export const RunLifecycleCommandResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('updated'), state: RunLifecycleStateSchema }),
  z.strictObject({ kind: z.literal('existing'), state: RunLifecycleStateSchema }),
  z.strictObject({ kind: z.literal('stale'), state: RunLifecycleStateSchema }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('invalidLifecycle'), lifecycle: WorldLifecycleSchema }),
  z.strictObject({ kind: z.literal('preflightRequired') }),
  z.strictObject({ kind: z.literal('preflightBlocked') }),
  z.strictObject({ kind: z.literal('preflightStale') }),
  z.strictObject({ kind: z.literal('idempotencyConflict') }),
]);
export const RunLifecycleCommandLookupSchema = z.strictObject({
  principalId: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().uuid(),
  runId: RunIdSchema,
  command: RunLifecycleCommandSchema,
  preflightJobId: JobIdSchema.optional(),
}).superRefine((request, context) => {
  if ((request.command.kind === 'start' || request.command.kind === 'resume') && request.preflightJobId === undefined) {
    context.addIssue({ code: 'custom', path: ['preflightJobId'], message: 'Iniciar o reanudar requiere un preflight durable.' });
  }
  if (request.command.kind !== 'start' && request.command.kind !== 'resume' && request.preflightJobId !== undefined) {
    context.addIssue({ code: 'custom', path: ['preflightJobId'], message: 'Este comando no consume un preflight.' });
  }
});
export const RunLifecycleCommandLookupResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('found'), result: RunLifecycleCommandResultSchema }),
  z.strictObject({ kind: z.literal('idempotencyConflict') }),
]);

export const WorldRunLoadSchema = z.strictObject({
  runId: RunIdSchema,
  throughWorldSeq: WorldSeqSchema.optional(),
});

/** Host-authorized participant and idempotency scope; profile and origin are never client-supplied. */
export const HumanInterventionCommitSchema = z.strictObject({
  runId: RunIdSchema,
  participantId: HumanParticipantIdSchema,
  expectedRevision: RevisionSchema,
  idempotencyKey: z.string().uuid(),
  request: HumanInterventionRequestSchema,
});

export const HumanInterventionCommitResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('stored'), commitIndex: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(), resolution: HumanInterventionResolutionSchema }),
  z.strictObject({ kind: z.literal('existing'), commitIndex: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(), resolution: HumanInterventionResolutionSchema }),
  z.strictObject({ kind: z.literal('idempotencyConflict') }),
]);

export const WorldDeliveryClaimSchema = z.strictObject({
  runId: RunIdSchema,
  actorId: CharacterIdSchema,
  throughWorldSeq: WorldSeqSchema,
  ownerToken: z.string().uuid(),
  claimToken: z.string().uuid(),
});

export const ActorTurnIntentQuerySchema = z.strictObject({
  runId: RunIdSchema,
  actorId: CharacterIdSchema,
  limit: z.number().int().min(1).max(100).default(20),
});

/** Coalesces all currently queued, unassigned actor intentions under one shared pulse. */
export const ActorTurnJobScheduleSchema = z.strictObject({
  runId: RunIdSchema,
  actorId: CharacterIdSchema,
  pulseId: PulseIdSchema,
});

export const ActorTurnJobClaimSchema = z.strictObject({
  runId: RunIdSchema,
  actorId: CharacterIdSchema,
  jobId: JobIdSchema,
  generation: RevisionSchema,
  ownerToken: z.string().uuid(),
  claimToken: z.string().uuid(),
});

/** Call only after the host has acquired exclusive ownership of the journal. */
export const ActorTurnJobRecoverySchema = z.strictObject({
  ownerToken: z.string().uuid(),
});

export const ActorTurnJobScopeSchema = z.strictObject({
  runId: RunIdSchema,
  actorId: CharacterIdSchema,
  jobId: JobIdSchema,
  generation: RevisionSchema,
  pulseId: PulseIdSchema,
});

export const FrozenActorWorldCutSchema = z.strictObject({
  worldRevision: RevisionSchema,
  worldSeq: WorldSeqSchema,
  fictionalAt: FictionalInstantSchema,
  perceptionIds: z.array(PerceptionIdSchema).max(100_000),
}).superRefine((cut, context) => {
  if (new Set(cut.perceptionIds).size !== cut.perceptionIds.length) {
    context.addIssue({ code: 'custom', path: ['perceptionIds'], message: 'El corte congelado no puede repetir percepciones' });
  }
});

export const ActorTurnJobFailureCodeSchema = z.enum(['cancelled', 'pi-incomplete', 'proposal-missing', 'review-incomplete', 'review-rejected', 'reformulations-exhausted', 'job-inactive', 'execution-failed', 'recovery-required']);

export const ActorTurnJobViewSchema = z.strictObject({
  ...ActorTurnJobScopeSchema.shape,
  lifecycleRevision: RevisionSchema.nullable(),
  state: z.enum(['queued', 'running', 'accepted', 'blocked']),
  failureCode: ActorTurnJobFailureCodeSchema.nullable(),
  perceptionIds: z.array(PerceptionIdSchema).max(100_000),
  /** Null while queued; frozen on the first claim and preserved across recovery. */
  frozenPerceptionIds: z.array(PerceptionIdSchema).max(100_000).nullable(),
  /** Complete World cut that was visible when the job first claimed its inbox. */
  frozenWorldCut: FrozenActorWorldCutSchema.nullable(),
});

export const CoordinatorPulseRequestSchema = z.strictObject({ runId: RunIdSchema });
export const CoordinatorPulseLookupSchema = z.strictObject({ runId: RunIdSchema, pulseId: PulseIdSchema });
export const CoordinatorPulseViewSchema = z.strictObject({
  runId: RunIdSchema, pulseId: PulseIdSchema,
  lifecycleRevision: RevisionSchema.nullable(),
  cause: z.strictObject({ kind: z.enum(['humanIntervention', 'actorAttempt']), id: z.string().min(1).max(200), commitIndex: z.number().int().positive() }),
  state: z.enum(['running', 'completed', 'blocked']), maxCalls: z.number().int().nonnegative(), consumed: z.number().int().nonnegative(),
  jobs: z.array(ActorTurnJobViewSchema).min(1).max(1_000),
});
export const CoordinatorPulseBeginResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('inactive') }), z.strictObject({ kind: z.literal('idle') }),
  z.strictObject({ kind: z.literal('started'), pulse: CoordinatorPulseViewSchema, jobs: z.array(ActorTurnJobViewSchema) }),
  z.strictObject({ kind: z.literal('existing'), pulse: CoordinatorPulseViewSchema, jobs: z.array(ActorTurnJobViewSchema) }),
]);

export const ActorTurnJobFailureResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('blocked'), job: ActorTurnJobViewSchema }),
  z.strictObject({ kind: z.literal('existing'), job: ActorTurnJobViewSchema }),
]);
export const ActorTurnJobRetryResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('retried'), job: ActorTurnJobViewSchema }),
  z.strictObject({ kind: z.literal('existing'), job: ActorTurnJobViewSchema }),
]);

export const ActorTurnJobScheduleResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('empty') }),
  z.strictObject({ kind: z.literal('scheduled'), job: ActorTurnJobViewSchema }),
  z.strictObject({ kind: z.literal('coalesced'), job: ActorTurnJobViewSchema }),
  z.strictObject({ kind: z.literal('existing'), job: ActorTurnJobViewSchema }),
  z.strictObject({ kind: z.literal('busy'), job: ActorTurnJobViewSchema }),
  z.strictObject({ kind: z.literal('blocked'), job: ActorTurnJobViewSchema }),
]);

export const ActorTurnJobClaimResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('busy') }),
  z.strictObject({ kind: z.literal('accepted'), job: ActorTurnJobViewSchema }),
  z.strictObject({ kind: z.literal('blocked'), job: ActorTurnJobViewSchema }),
  z.strictObject({
    kind: z.literal('claimed'), job: ActorTurnJobViewSchema,
    ownerToken: z.string().uuid(), claimToken: z.string().uuid(),
  }),
  z.strictObject({
    kind: z.literal('existing'), job: ActorTurnJobViewSchema,
    ownerToken: z.string().uuid(), claimToken: z.string().uuid(),
  }),
]);

export const ActorTurnJobAcceptLeaseSchema = z.strictObject({
  ownerToken: z.string().uuid(),
  claimToken: z.string().uuid(),
});

export const ActorJobExecutionSchema = ActorTurnJobScopeSchema.extend({
  lease: ActorTurnJobAcceptLeaseSchema,
});

export const ActorTurnJobFailureSchema = z.strictObject({ execution: ActorJobExecutionSchema, code: ActorTurnJobFailureCodeSchema });
export const ActorTurnJobRetrySchema = z.strictObject({ runId: RunIdSchema, actorId: CharacterIdSchema, jobId: JobIdSchema, expectedGeneration: RevisionSchema, pulseId: PulseIdSchema });

export const ActorTurnRecoveryProposalBindingSchema = z.strictObject({kind:z.literal('durable'),proposalId:ProposalIdSchema,version:z.number().int().min(1).max(3),attemptHash:HashSchema});
export const ActorTurnRecoveryReadSchema = z.strictObject({execution:ActorJobExecutionSchema});
export const ActorTurnRecoveredAcceptanceSchema = z.strictObject({execution:ActorJobExecutionSchema,candidateId:z.string().uuid(),proposalBinding:ActorTurnRecoveryProposalBindingSchema});
export const ActorTurnRecoveryResultSchema = z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('fresh')}),
  z.strictObject({kind:z.literal('pending'),reason:z.enum(['actor-inactive','uncertain-request','terminal-missing','proposal-missing','review-missing','review-not-allow','proof-invalid'])}),
  z.strictObject({kind:z.literal('completed'),candidateId:z.string().uuid(),proposal:WorldProposalRecordSchema,proposalBinding:ActorTurnRecoveryProposalBindingSchema,review:ContinuistaReviewInputSchema,
    sessionIntegrity:z.strictObject({sessionId:z.string().min(1).max(200),sessionPath:z.string().min(1).max(2_000),
      baseLeafId:z.string().min(1).max(200).nullable(),inputLeafId:z.string().min(1).max(200),terminalLeafId:z.string().min(1).max(200)}),
  }),
]);

export const ContinuistaJobExecutionSchema = z.strictObject({
  actorExecution: ActorJobExecutionSchema, jobId: JobIdSchema, generation: RevisionSchema, lease: ActorTurnJobAcceptLeaseSchema,
});
export const ContinuistaJobViewSchema = z.strictObject({
  runId: RunIdSchema, actorId: CharacterIdSchema, actorJobId: JobIdSchema, actorGeneration: RevisionSchema,
  pulseId: PulseIdSchema, jobId: JobIdSchema, generation: RevisionSchema, proposalId: ProposalIdSchema,
  version: z.number().int().min(1).max(3), contextHash: HashSchema,
  state: z.enum(['queued','running','accepted','blocked']), failureCode: ActorTurnJobFailureCodeSchema.nullable(),
});
export const ContinuistaJobBeginSchema = z.strictObject({execution:ActorJobExecutionSchema,context:z.unknown(),ownerToken:z.string().uuid(),claimToken:z.string().uuid()});
export const ContinuistaJobBeginResultSchema = z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('created'),job:ContinuistaJobViewSchema,execution:ContinuistaJobExecutionSchema}),
  z.strictObject({kind:z.literal('existing'),job:ContinuistaJobViewSchema,execution:ContinuistaJobExecutionSchema}),
  z.strictObject({kind:z.literal('blocked'),job:ContinuistaJobViewSchema}),z.strictObject({kind:z.literal('busy')}),
]);
export const ContinuistaSessionRegistrationSchema = z.strictObject({execution:ContinuistaJobExecutionSchema,sessionId:z.string().min(1).max(200),sessionPath:z.string().min(1).max(2000),
  profile:StoredPiProfileSchema});
export const ContinuistaJobLookupSchema = z.strictObject({jobId:JobIdSchema,generation:RevisionSchema});

export const ActorJobCheckpointSchema = z.strictObject({
  execution: ActorJobExecutionSchema,
  purpose: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('job-base') }),
    z.strictObject({ kind: z.literal('request-input'), requestSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
    z.strictObject({
      kind: z.literal('terminal-candidate'), outcome: z.enum(['completed', 'aborted', 'failed']),
      lastRequestSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    }),
  ]),
  snapshot: z.strictObject({
    sessionId: z.string().min(1).max(200), sessionPath: z.string().min(1).max(2_000),
    candidateLeafId: z.string().min(1).max(200).nullable(),
  }),
});

export const WorldDeliveryTargetsQuerySchema = z.strictObject({
  limit: z.number().int().min(1).max(1_000).default(1_000),
});

export const WorldDeliveryCompletionSchema = z.strictObject({
  perceptionId: PerceptionIdSchema,
  claimToken: z.string().uuid(),
  experience: z.unknown().optional(),
});

export const WorldDeliveryFailureSchema = z.strictObject({
  perceptionId: PerceptionIdSchema,
  claimToken: z.string().uuid(),
  failureCode: z.enum(['delivery_failed', 'cancelled']),
});

export const WorldDeliveredPerceptionsQuerySchema = z.strictObject({
  runId: RunIdSchema,
  actorId: CharacterIdSchema,
  throughWorldSeq: WorldSeqSchema,
});

export const WorldProposalLookupSchema = z.strictObject({
  runId: RunIdSchema,
  proposalId: ProposalIdSchema,
  version: z.number().int().min(1).max(3),
});

export const WorldAttemptCommitSchema = z.strictObject({
  runId: RunIdSchema,
  proposalId: ProposalIdSchema,
  version: z.number().int().min(1).max(3),
  ids: z.custom<WorldIdSource>((value) => {
    const parsed = z.record(z.string(), z.unknown()).safeParse(value);
    return parsed.success && [
      'eventId', 'perceptionId', 'experienceId', 'offerId', 'entityHandle', 'placeHandle', 'channelHandle', 'offerHandle',
    ].every((key) => typeof parsed.data[key] === 'function');
  }),
});
export type WorldAttemptCommit = z.infer<typeof WorldAttemptCommitSchema>;

export { ActorWorldProjectionRequestSchema };
