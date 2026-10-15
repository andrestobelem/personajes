import { CONFIGURATOR_JOB_SCHEMA_SQL } from './configurator-job-ledger.ts';
import { IdentityPromotionRequestSchema, IdentityPromotionAuthorityRequestSchema, AcceptedConfiguratorProposalSchema, IdentityPromotionReceiptSchema, IdentityPromotionResultSchema, ActorIdentityEpochSchema, type IdentityPromotionPorts } from '../domain/identity-promotion.ts';
import { prepareIdentityPromotion, PreparedIdentityPromotionSchema } from '../application/prepare-identity-promotion.ts';
import { BackupForkSourceSchema, ForkSourceRequestSchema, ForkSourceReadResultSchema } from '../application/fork-source.ts';
import { ForkJobSchema, ForkJobFailureCodeSchema, ForkArtifactManifestSchema } from '../domain/fork-job.ts';
import { ForkPublicationPackageSchema } from '../application/fork-package.ts';
import { ForkDramaticSeedSchema, prepareForkDramaticSeed } from '../application/fork-dramatic-seed.ts';
import { prepareForkState } from '../application/prepare-fork-state.ts';
import { prepareForkConfiguration } from '../application/fork-configuration.ts';
import { ActorStateCutSchema, ActorStateCutRequestSchema, ActorStateCutReadResultSchema } from '../domain/actor-state-cut.ts';
import {CircumstanceOptionsRequestSchema,CircumstanceOptionsSchema,CircumstanceWriteSchema,CircumstanceMutationResultSchema} from '../domain/direction-circumstances.ts';
import {resolveWorldCircumstance} from '../domain/world-circumstances.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { readPiSessionCheckpointPrefix, verifyPiSessionCheckpointChain } from './pi-session-integrity.ts';
import { z } from 'zod';
import { StoredPiProfileSchema, PersistedInferenceProfileSchema, LEGACY_INFERENCE_PROFILE, resolveStoredPiProfile, resolveReadyInferenceProfile } from '../domain/inference-profile.ts';
import { validateContinuistaReviewContext, validateContinuistaContextReview } from '../domain/continuista-review.ts';
import { ReadyRunConfigurationSchema, readyConfigurationAtSnapshot, validateRunConfiguration, validateReadyConfiguration } from '../application/production-preflight.ts';
import { fingerprintInferenceProfile } from '../application/pi-access-check.ts';
import { ExperienceSchema, FrozenExperienceSchema } from '../domain/experience.ts';
import { IcmMemoryIdSchema, MemoryProjectionReceiptSchema } from '../domain/memory-projection.ts';
import { HumanParticipantProfileSchema } from '../domain/interaction.ts';
import { SceneIdSchema } from '../domain/world-schema.ts';
import { HumanInterventionResolutionSchema, resolveHumanIntervention } from '../domain/human-intervention.ts';
import {
  ActorDirectionContextSchema, DirectionCommandWriteSchema, DirectionEventsQuerySchema,
  DirectionEventsPageSchema, DirectionLookupSchema, DirectionLookupResultSchema,
  DirectionMutationResultSchema, DirectionEventSchema, DirectionPayloadSchema,
} from '../domain/direction-indications.ts';
import { freezeExperience, readPrivateExperience } from '../application/experience-envelope.ts';
import type { FrozenExperience } from '../domain/experience.ts';
import {
  ActorKnowledgeSchema,
  WorldContentApprovalReceiptSchema,
  WorldEventSchema,
  WorldPerceptionSchema,
  WorldOfferSchema,
  WorldResolutionSchema,
  WorldSceneSchema,
  WorldSnapshotSchema,
  WorldAttemptIdSchema,
  emptyActorKnowledge,
  characterCanReceiveAt,
  hashCommunicationContent,
  resolveWorldAttempt,
} from '../domain/world.ts';
import {
  ActorWorldKnowledgeCasSchema,
  ActorWorldProjectionRequestSchema,
  ContinuistaReviewInputSchema,
  ContinuistaStoredReviewSchema,
  ContinuistaCriterionSchema,
  WorldContinuityFenceSchema,
  WorldLifecycleSchema,
  WorldLifecycleWriteSchema,
  RunLifecycleStateSchema,
  RunStepJobViewSchema,
  RunLifecycleCommandWriteSchema,
  RunLifecycleCommandResultSchema,
  RunLifecycleCommandLookupSchema,
  RunLifecycleCommandLookupResultSchema,
  EpisodeIdSchema,
  ActIdSchema,
  DramaticCutSchema,
  DramaticLineEvidenceSchema,
  DramaticActViewSchema,
  DramaticEpisodeViewSchema,
  DramaticStructureEventSchema,
  DramaticStructureViewSchema,
  DramaticStructureCommandSchema,
  DramaticStructureWriteSchema,
  DramaticStructureMutationResultSchema,
  DramaticStructureLookupSchema,
  DramaticStructureLookupResultSchema,
  resolveRunControlTransition,
  WorldRunRegistrationSchema,
  WorldProposalRegistrationSchema,
  WorldAttemptCommitSchema,
  WorldProposalRecordSchema,
  WorldRunLoadSchema,
  WorldDeliveryClaimSchema,
  WorldDeliveryCompletionSchema,
  WorldDeliveryFailureSchema,
  WorldDeliveredPerceptionsQuerySchema,
  WorldProposalLookupSchema,
  HumanInterventionCommitSchema,
  HumanInterventionCommitResultSchema,
  ActorTurnIntentQuerySchema,
  ActorTurnJobScheduleSchema,
  ActorTurnJobClaimSchema,
  ActorTurnJobRecoverySchema,
  ActorTurnJobViewSchema,
  ActorTurnJobScheduleResultSchema,
  ActorTurnJobClaimResultSchema,
  ActorTurnJobAcceptLeaseSchema,
  FrozenActorWorldCutSchema,
  ActorJobExecutionSchema,
  ActorJobCheckpointSchema,
  ActorTurnJobScopeSchema,
  ActorTurnJobFailureSchema,
  ActorTurnJobRetrySchema,
  ActorTurnJobFailureCodeSchema,
  ActorTurnJobFailureResultSchema,
  CoordinatorPulseRequestSchema,
  CoordinatorPulseLookupSchema,
  CoordinatorPulseViewSchema,
  CoordinatorPulseBeginResultSchema,
  RoutineClockAdvanceRequestSchema,
  RoutineClockAdvanceResultSchema,
  ActorTurnJobRetryResultSchema,
  ContinuistaJobExecutionSchema,
  ContinuistaJobViewSchema,
  ContinuistaJobBeginSchema,
  ContinuistaJobBeginResultSchema,
  ContinuistaSessionRegistrationSchema,
  ContinuistaJobLookupSchema,
  ActorTurnRecoveryReadSchema,
  ActorTurnRecoveredAcceptanceSchema,
  ActorTurnRecoveryResultSchema,
  RunDraftCreateSchema,
  RunDraftUpdateSchema,
  RunDraftReadSchema,
  RunDraftListSchema,
  RunDraftPatchSchema,
  RunDraftHistoryEntrySchema,
  RunDraftMutationResultSchema,
  RunDraftValidateSchema,
  RunDraftValidationResultSchema,
  RunDraftOperationResultSchema,
  RunDraftStateSchema,
  PiOAuthJobViewSchema,
  PiOAuthJobCreateSchema,
  PiOAuthJobCreateResultSchema,
  PiOAuthJobLookupSchema,
  PiOAuthJobClaimSchema,
  PiOAuthJobClaimResultSchema,
  PiOAuthJobCompletionSchema,
  PiOAuthJobCancelSchema,
  PiOAuthJobMutationResultSchema,
  PiAccessJobStateSchema,
  PiAccessJobSafeCodeSchema,
  PiAccessCheckStoredResultSchema,
  PiAccessJobViewSchema,
  PiAccessJobCreateSchema,
  PiAccessJobCreateResultSchema,
  PiAccessJobLookupSchema,
  PiAccessJobClaimSchema,
  PiAccessJobClaimResultSchema,
  PiAccessJobCompletionSchema,
  PiAccessJobCancelSchema,
  PiAccessJobMutationResultSchema,
  PiAccessJobListSchema,
  PiAccessReceiptLookupSchema,
  PiAccessLatestOutcomeLookupSchema,
  PiAccessReceiptReadSchema,
  piAccessJobStateForResult,
  piAccessJobSafeCodeForResult,
  piAccessPassedResult,
  RunPreflightJobStateSchema,
  RunPreflightJobSafeCodeSchema,
  RunPreflightJobStartSchema,
  RunPreflightJobStartResultSchema,
  RunPreflightJobLookupSchema,
  RunPreflightJobListSchema,
  RunPreflightJobEvidenceLookupSchema,
  RunPreflightJobEvidenceReadSchema,
  RunPreflightJobViewSchema,
  RunPreflightJobDocumentSchema,
  RunPreflightJobPageSchema,
  RunPreflightJobClaimSchema,
  RunPreflightJobClaimResultSchema,
  RunPreflightJobLeaseSchema,
  RunPreflightJobCompletionSchema,
  RunPreflightJobFailureSchema,
  RunPreflightJobCancelSchema,
  RunPreflightJobMutationResultSchema,
  RunPreflightJobOperationResultSchema,
  RunPreflightJobRecoverySchema,
  RunPreflightEvaluationSchema,
  RunPreflightJobInputResultSchema,
  RunPreflightResultSchema,
  projectPublicRunPreflightResult,
  RunPreflightPrivateEvidenceSchema,
  WorldDeliveryTargetsQuerySchema,
} from '../domain/world-journal.ts';
import { RunConfigurationDraftSchema, ProductionEvidenceSchema, createEmptyRunConfigurationDraft, HumanParticipantProfilesSchema, effectiveRequestTimeoutMs } from '../domain/production.ts';
import {
  ModelTimeClockEpochIdSchema, MonotonicNanosecondsSchema, ModelWallTimeExpirationSchema,
  ModelTimeOwnerRecoverySchema, RunModelTimeBudgetReadSchema, RunModelTimeBudgetSchema,
} from '../domain/model-time-budget.ts';
import { createHash, randomUUID } from 'node:crypto';
import { ContinuityReferenceSchema } from '../domain/preparation.ts';
import { currentRoutineAvailabilityBoundary, nextRoutineAdvance, nextWorldTimeBoundary, planActorActivationInvitations } from '../domain/actor-activation.ts';
import {
  ActorActivationIdSchema, ActorActivationInvitationIdSchema, CharacterIdSchema, ExperienceIdSchema, HashSchema, HumanInterventionIdSchema, HumanParticipantIdSchema,
  EventIdSchema, FictionalInstantSchema, JobIdSchema, PerceptionIdSchema, ProposalIdSchema, PulseIdSchema, RevisionSchema, RunIdSchema, WorldSeqSchema,
} from '../domain/values.ts';

import { AdministrativeJobExecutionSchema, AdministrativeJobFailureSchema, AdministrativeJobViewSchema, AdministrativeJobLookupSchema,
  NarrationReviewJobBeginSchema, NarrationReviewJobBeginResultSchema, NarrationReviewJournalCandidateSchema, NarrationReviewJobReceiptSchema, DirectorJobBeginSchema, DirectorJobBeginResultSchema, NarratorJobBeginSchema, NarratorJobBeginResultSchema, NarratorJournalCandidateSchema, NarratorJobReceiptSchema, AdministrativeSessionSchema, AdministrativeCheckpointSchema, DirectorCandidateSchema, DirectorJobReceiptSchema } from '../domain/admin-role-jobs.ts';
import { NarratorContextSchema, NarrationReviewSchema } from '../domain/narration.ts';
import { validateNarratorContext, projectNarratorPhysicalSnapshot, projectNarratorRecordedWorldFacts, narratorContextHash, validateNarrationProposal, validateNarrationReview, narrationValueHash } from '../application/narrator-context.ts';
import { NarrationReviewContextSchema } from '../domain/narration-review.ts';
import { validateNarrationReviewContext, narrationReviewContextHash, validateNarrationReviewDecision } from '../application/narration-review-context.ts';
import { DirectorContextSchema, DirectorAnnotationSchema } from '../domain/admin-roles.ts';
import { directorContextHash, validateDirectorContext, validateDirectorObservation } from '../application/director-context.ts';

const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const BudgetRequestFieldsSchema = z.strictObject({
  runId: RunIdSchema, pulseId: PulseIdSchema,
  jobId: JobIdSchema, generation: counter, requestSeq: counter,
  clockEpochId: z.string().uuid().optional(), ownerToken: z.string().uuid().optional(),
});
function refineBudgetRequestOwner(request: { clockEpochId?: string | undefined; ownerToken?: string | undefined }, context: z.RefinementCtx): void {
  if ((request.clockEpochId === undefined) !== (request.ownerToken === undefined)) {
    context.addIssue({ code: 'custom', path: ['clockEpochId'], message: 'El grant de tiempo requiere epoch y owner juntos' });
  }
}
const BudgetRequestSchema = BudgetRequestFieldsSchema.superRefine(refineBudgetRequestOwner);
const BudgetRequestWithoutSequenceSchema = BudgetRequestFieldsSchema.omit({ requestSeq: true })
  .superRefine(refineBudgetRequestOwner);
const BudgetConfigSchema = z.strictObject({ runId: RunIdSchema, maxCalls: counter.max(100_000) });
const PulseConfigSchema = z.strictObject({ runId: RunIdSchema, pulseId: PulseIdSchema, maxCalls: counter.max(256) });
const ReservationTransitionSchema = z.strictObject({
  jobId: JobIdSchema, generation: counter, requestSeq: counter,
  target: z.enum(['dispatched', 'completed', 'undispatched', 'ambiguous']),
  ownerToken: z.string().uuid().optional(),
  wallTime: z.strictObject({ clockEpochId: z.string().uuid(), monotonicNs: z.string().regex(/^(0|[1-9]\d{0,39})$/) }).optional(),
});
const budgetRow = z.strictObject({ max_calls: counter, consumed: counter });
const pulseRow = z.strictObject({ run_id: RunIdSchema, max_calls: counter, consumed: counter });
const experienceRow = z.strictObject({ canonical_payload: z.string(), payload_hash: HashSchema });
const ExperienceStoredRowSchema = z.strictObject({
  experience_id: ExperienceIdSchema, run_id: RunIdSchema, actor_id: CharacterIdSchema,
  world_seq: WorldSeqSchema, canonical_payload: z.string(), payload_hash: HashSchema,
});
const projectionRow = z.strictObject({
  experience_id: ExperienceIdSchema, run_id: RunIdSchema, actor_id: CharacterIdSchema,
  world_seq: WorldSeqSchema, canonical_payload: z.string(), payload_hash: HashSchema,
  claim_token: z.string().uuid().nullable(), owner_token: z.string().uuid().nullable(), attempts: counter,
});
const reservationRow = z.strictObject({ run_id: RunIdSchema, pulse_id: PulseIdSchema });
const ActorReadSchema = z.strictObject({
  runId: RunIdSchema, actorId: CharacterIdSchema, throughWorldSeq: WorldSeqSchema,
});
const ReserveResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('reserved'), requestSeq: counter.optional(),
    wallTime: z.strictObject({ reservedMs: counter.min(1), clockEpochId: z.string().uuid() }).optional(),
  }),
  z.strictObject({ kind: z.literal('existing') }),
  z.strictObject({ kind: z.literal('busy'), scope: z.literal('concurrency') }),
  z.strictObject({ kind: z.literal('exhausted'), scope: z.enum(['run', 'pulse', 'wall-time', 'legacy-unknown', 'uncertain']) }),
]);
export type ReserveResult = z.infer<typeof ReserveResultSchema>;
const ProjectionClaimRequestSchema = z.strictObject({
  runId: RunIdSchema, actorId: CharacterIdSchema,
  ownerToken: z.string().uuid(), claimToken: z.string().uuid(),
});
const ProjectionClaimResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('empty') }),
  z.strictObject({ kind: z.literal('busy') }),
  z.strictObject({
    kind: z.literal('claimed'), claimToken: z.string().uuid(), attempts: counter,
    frozen: FrozenExperienceSchema,
  }),
]);
type ProjectionClaimResult = z.infer<typeof ProjectionClaimResultSchema>;
const ProjectionReleaseRequestSchema = z.strictObject({
  experienceId: ExperienceIdSchema, claimToken: z.string().uuid(),
  failureKind: z.enum(['projection_failed', 'cancelled']),
});
const ProjectionAckRequestSchema = z.strictObject({
  experienceId: ExperienceIdSchema, claimToken: z.string().uuid(), memoryId: IcmMemoryIdSchema,
  payloadHash: HashSchema,
});
const ProjectionLookupSchema = z.strictObject({
  runId: RunIdSchema, actorId: CharacterIdSchema, memoryId: IcmMemoryIdSchema,
  throughWorldSeq: WorldSeqSchema,
});
const ProjectionStoredRowSchema = z.strictObject({
  experience_id: ExperienceIdSchema, memory_id: IcmMemoryIdSchema, claim_token: z.string().uuid(),
  run_id: RunIdSchema, actor_id: CharacterIdSchema, world_seq: WorldSeqSchema,
  canonical_payload: z.string(), payload_hash: HashSchema,
});
const WorldRunRowSchema = z.strictObject({
  run_id: RunIdSchema, config_revision: counter, configuration_json: z.string(), configuration_hash: HashSchema,
  continuity_fence_json: z.string(), lifecycle: WorldLifecycleSchema, lifecycle_revision: counter, closed_at: counter.nullable(),
  world_revision: counter, structure_revision: counter, direction_revision: counter, last_seq: counter,
  commit_index: counter, initial_snapshot_json: z.string(), initial_snapshot_hash: HashSchema,
  snapshot_json: z.string(), snapshot_hash: HashSchema, created_at: counter.nullable().optional(), updated_at: counter,
});
const DramaticEpisodeDbRowSchema = z.strictObject({
  run_id: RunIdSchema, episode_id: EpisodeIdSchema, ordinal: counter.min(1), title: z.string().nullable(),
  lifecycle: z.enum(['open', 'closed']), opening_cut_json: z.string(), opening_cut_hash: HashSchema,
  closing_cut_json: z.string().nullable(), closing_cut_hash: HashSchema.nullable(),
  consequence_event_ids_json: z.string(), open_lines_json: z.string(),
});
const DramaticActDbRowSchema = z.strictObject({
  run_id: RunIdSchema, episode_id: EpisodeIdSchema, act_id: ActIdSchema, ordinal: counter.min(1), title: z.string(),
});
const DramaticStructureEventDbRowSchema = z.strictObject({
  run_id: RunIdSchema, structure_revision: counter.min(1), operation_id: z.string().uuid(), principal_id: z.string(),
  event_kind: z.enum(['episodeOpened', 'episodeClosed', 'sceneOpened', 'sceneClosed', 'actsSet']),
  payload_json: z.string(), payload_hash: HashSchema, world_revision: counter, world_seq: counter,
  commit_index: counter.min(1), recorded_at: counter,
});
const DramaticStructureOperationDbRowSchema = z.strictObject({
  run_id: RunIdSchema, principal_id: z.string(), idempotency_key: z.string().uuid(), operation_id: z.string().uuid(),
  operation_kind: z.enum(['openEpisode', 'closeEpisode', 'openScene', 'closeScene', 'setEpisodeActs']),
  request_hash: HashSchema, result_json: z.string(), result_hash: HashSchema, recorded_at: counter,
});
const DirectionEventDbRowSchema = z.strictObject({
  run_id: RunIdSchema, direction_revision: counter.min(1), operation_id: z.string().uuid(), principal_id: z.string(),
  payload_json: z.string(), payload_hash: HashSchema, world_revision: counter, world_seq: counter, commit_index: counter, recorded_at: counter,
});
const DirectionOperationDbRowSchema = z.strictObject({
  run_id: RunIdSchema, principal_id: z.string(), idempotency_key: z.string().uuid(), operation_id: z.string().uuid(),
  request_hash: HashSchema, result_json: z.string(), result_hash: HashSchema, recorded_at: counter,
});
const WorldProposalDbRowSchema = z.strictObject({
  proposal_id: ProposalIdSchema, version: counter, actor_id: CharacterIdSchema, scene_id: z.string(),
  attempt_id: WorldAttemptIdSchema, base_revision: counter, job_id: JobIdSchema.nullable(),
  generation: counter.nullable(), proposal_slot: counter.nullable(),
  payload_json: z.string(), attempt_hash: HashSchema, exact_content_hash: HashSchema,
  status: z.enum(['pending', 'resolved']),
});
const WorldReviewDbRowSchema = z.strictObject({
  review_seq: counter, reviewer_kind: z.literal('continuista'), verdict: z.enum(['allow', 'reformulate', 'reject']),
  complete: z.union([z.literal(0), z.literal(1)]), state_revision: counter,
  exact_content_hash: HashSchema, payload_json: z.string(), payload_hash: HashSchema,
});
const WorldResolutionDbRowSchema = z.strictObject({
  proposal_id: ProposalIdSchema, version: counter, attempt_hash: HashSchema,
  payload_json: z.string(), payload_hash: HashSchema, commit_index: counter,
});
const WorldCommitDbRowSchema = z.strictObject({
  run_id: RunIdSchema, origin_kind: z.string().min(1).max(100), origin_id: z.string().min(1).max(200),
  commit_index: counter.min(1), world_revision: counter, last_seq: counter,
  snapshot_json: z.string(), snapshot_hash: HashSchema, created_at: counter,
});
const HumanInterventionReceiptDbRowSchema = z.strictObject({
  run_id: RunIdSchema, participant_id: HumanParticipantIdSchema, idempotency_key: z.string().uuid(),
  intervention_id: HumanInterventionIdSchema, request_hash: HashSchema,
  resolution_json: z.string(), resolution_hash: HashSchema, commit_index: counter.nullable(), created_at: counter,
});
const WorldResolutionMigrationRowSchema = z.strictObject({
  run_id: RunIdSchema, origin_kind: z.literal('actorAttempt'), origin_id: z.string().uuid(),
  payload_json: z.string(), payload_hash: HashSchema, commit_index: counter.min(1),
  world_revision: counter, last_seq: counter, created_at: counter,
});
const WorldKnowledgeDbRowSchema = z.strictObject({
  knowledge_revision: counter, at_world_seq: counter, payload_json: z.string(), payload_hash: HashSchema,
});
const WorldDeliveryDbRowSchema = z.strictObject({
  perception_id: PerceptionIdSchema, run_id: RunIdSchema, world_seq: counter, actor_id: CharacterIdSchema,
  payload_json: z.string(), payload_hash: HashSchema, state: z.enum(['planned', 'delivering', 'delivered', 'failed']),
  origin_kind: z.enum(['actorAttempt', 'humanIntervention', 'directionCircumstance']), origin_id: z.string().min(1).max(200),
  claim_token: z.string().uuid().nullable(), owner_token: z.string().uuid().nullable(), attempts: counter,
});
const ActorTurnIntentRowSchema = z.strictObject({
  run_id: RunIdSchema, actor_id: CharacterIdSchema, perception_id: PerceptionIdSchema,
  world_seq: WorldSeqSchema, state: z.enum(['awaitingDelivery', 'queued']), created_at: counter,
  payload_json: z.string(), payload_hash: HashSchema,
});
const ContinuistaJobRowSchema = z.strictObject({job_id:JobIdSchema,generation:counter,run_id:RunIdSchema,actor_id:CharacterIdSchema,actor_job_id:JobIdSchema,actor_generation:counter,pulse_id:PulseIdSchema,
  proposal_id:ProposalIdSchema,proposal_version:counter,context_hash:HashSchema,context_json:z.string(),actor_execution_json:z.string(),state:z.enum(['queued','running','accepted','blocked']),
  owner_token:z.string().uuid().nullable(),claim_token:z.string().uuid().nullable(),failure_code:ActorTurnJobFailureCodeSchema.nullable(),created_at:counter,updated_at:counter});
const ContinuistaSessionSchema = ContinuistaSessionRegistrationSchema.omit({execution:true}).extend({jobId:JobIdSchema,generation:RevisionSchema,contextHash:HashSchema});
const ContinuistaCheckpointSchema = z.strictObject({execution:ContinuistaJobExecutionSchema,purpose:ActorJobCheckpointSchema.shape.purpose,snapshot:ActorJobCheckpointSchema.shape.snapshot});
const ContinuistaReceiptSchema = z.strictObject({jobId:JobIdSchema,generation:RevisionSchema,contextHash:HashSchema,candidateHash:HashSchema,terminalHash:HashSchema,review:ContinuistaReviewInputSchema});
const ActorTurnJobDbRowSchema = z.strictObject({
  run_id: RunIdSchema, actor_id: CharacterIdSchema, job_id: JobIdSchema, generation: counter,
  pulse_id: PulseIdSchema, lifecycle_revision: counter.nullable(), state: z.enum(['queued', 'running', 'accepted', 'blocked']),
  failure_code: ActorTurnJobFailureCodeSchema.nullable(),
  owner_token: z.string().uuid().nullable(), claim_token: z.string().uuid().nullable(),
  frozen_perception_ids_json: z.string().nullable(),
  frozen_world_cut_json: z.string().nullable(),
  frozen_direction_revision: counter.nullable(),
  created_at: counter, updated_at: counter,
});
const ActorTurnJobInputDbRowSchema = z.strictObject({
  perception_id: PerceptionIdSchema, state: z.enum(['assigned', 'consumed', 'released']),
  intent_run_id: RunIdSchema, intent_actor_id: CharacterIdSchema, intent_state: z.literal('queued'),
  world_seq: WorldSeqSchema, delivery_run_id: RunIdSchema, delivery_actor_id: CharacterIdSchema,
  delivery_state: z.enum(['planned', 'delivering', 'delivered', 'failed']),
});
const WorldDeliveryTargetRowSchema = z.strictObject({
  run_id: RunIdSchema, actor_id: CharacterIdSchema, first_world_seq: WorldSeqSchema,
});
const ActorSessionProfileSchema = StoredPiProfileSchema;
const ActorSessionRegistrationSchema = z.strictObject({
  runId: RunIdSchema, actorId: CharacterIdSchema, sessionId: z.string().min(1).max(200),
  sessionPath: z.string().min(1).max(2_000), preparedContextHash: HashSchema,
  profile: ActorSessionProfileSchema, execution: ActorJobExecutionSchema.optional(),
});
const ActorSessionBaseSchema = z.strictObject({
  sessionId: z.string().min(1).max(200), sessionPath: z.string().min(1).max(2_000),
  preparedContextHash: HashSchema, profile: ActorSessionProfileSchema,
  sessionRevision: counter, committedLeafId: z.string().min(1).max(200).nullable(),
});
const ActorSessionRotationSchema = z.strictObject({
  runId: RunIdSchema, actorId: CharacterIdSchema, expected: ActorSessionBaseSchema,
  sessionId: z.string().min(1).max(200), sessionPath: z.string().min(1).max(2_000), execution: ActorJobExecutionSchema.optional(),
});
const ActorSessionScopeSchema = z.strictObject({
  runId: RunIdSchema, pulseId: PulseIdSchema, jobId: JobIdSchema, generation: counter,
});
const ActorInputCutSchema = z.strictObject({
  worldRevision: counter, worldSeq: WorldSeqSchema, fictionalAt: z.number().int(),
  perceptionIds: z.array(PerceptionIdSchema).max(100_000),
  activeSceneId: SceneIdSchema.nullable().optional(),
}).superRefine((cut, context) => {
  if (new Set(cut.perceptionIds).size !== cut.perceptionIds.length) {
    context.addIssue({ code: 'custom', path: ['perceptionIds'], message: 'La entrada no puede repetir percepciones' });
  }
});
const ActorPiCandidateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('request-input'), candidateId: z.string().uuid(), turnId: z.string().uuid(),
    runId: RunIdSchema, actorId: CharacterIdSchema, scope: ActorSessionScopeSchema,
    lease: ActorTurnJobAcceptLeaseSchema.optional(),
    base: ActorSessionBaseSchema, requestSeq: counter, candidateLeafId: z.string().min(1).max(200),
    inputCut: ActorInputCutSchema,
  }),
  z.strictObject({
    kind: z.literal('terminal-candidate'), candidateId: z.string().uuid(), turnId: z.string().uuid(),
    runId: RunIdSchema, actorId: CharacterIdSchema, scope: ActorSessionScopeSchema,
    lease: ActorTurnJobAcceptLeaseSchema.optional(),
    base: ActorSessionBaseSchema, outcome: z.enum(['completed', 'aborted', 'failed']),
    lastRequestSeq: counter.nullable(), candidateLeafId: z.string().min(1).max(200).nullable(),
    inputCut: ActorInputCutSchema,
  }),
]);
const ActorTurnProposalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('durable'), proposalId: ProposalIdSchema, version: counter.min(1).max(3),
    attemptHash: HashSchema,
  }),
]);
const ActorTurnAcceptanceSchema = z.strictObject({
  candidateId: z.string().uuid(), proposal: ActorTurnProposalSchema,
  lease: ActorTurnJobAcceptLeaseSchema.optional(),
});
const ActorPiReceiptSchema = z.strictObject({
  kind: z.literal('actor-turn-accepted'), receiptId: z.string().uuid(),
  runId: RunIdSchema, actorId: CharacterIdSchema, candidateId: z.string().uuid(), turnId: z.string().uuid(),
  scope: ActorSessionScopeSchema, baseSessionRevision: counter, sessionRevision: counter,
  baseLeafId: z.string().min(1).max(200).nullable(), committedLeafId: z.string().min(1).max(200),
  consumedPerceptionIds: z.array(PerceptionIdSchema).max(100_000),
  proposal: ActorTurnProposalSchema, payloadHash: HashSchema, acceptedAt: counter,
});
const ActorPiSessionRowSchema = z.strictObject({
  run_id: RunIdSchema, actor_id: CharacterIdSchema, session_id: z.string().min(1), session_path: z.string().min(1),
  prepared_context_hash: HashSchema, profile_json: z.string(), profile_hash: HashSchema,
  committed_leaf_id: z.string().min(1).nullable(), session_revision: counter, created_at: counter, updated_at: counter,
});
const ActorPiCandidateDbRowSchema = z.strictObject({
  candidate_id: z.string().uuid(), run_id: RunIdSchema, actor_id: CharacterIdSchema,
  pulse_id: PulseIdSchema, job_id: JobIdSchema, generation: counter, turn_id: z.string().uuid(),
  candidate_kind: z.enum(['request-input', 'terminal-candidate']), request_seq: counter.nullable(),
  outcome: z.enum(['completed', 'aborted', 'failed']).nullable(), last_request_seq: counter.nullable(),
  base_session_revision: counter, base_leaf_id: z.string().min(1).nullable(), session_id: z.string().min(1),
  session_path: z.string().min(1), prepared_context_hash: HashSchema, candidate_leaf_id: z.string().min(1).nullable(),
  input_world_revision: counter, input_world_seq: counter, input_fictional_at: z.number().int(),
  input_perception_ids_json: z.string(), canonical_payload: z.string(), payload_hash: HashSchema, recorded_at: counter,
});
const ActorPiReceiptDbRowSchema = z.strictObject({
  receipt_json: z.string(), receipt_hash: HashSchema, acceptance_hash: HashSchema,
});
const ActorPiRegistrationResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('stored'), session: ActorSessionBaseSchema }),
  z.strictObject({ kind: z.literal('existing'), session: ActorSessionBaseSchema }),
]);
const ActorPiRotationResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('rotated'), session: ActorSessionBaseSchema }),
  z.strictObject({ kind: z.literal('existing'), session: ActorSessionBaseSchema }),
]);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('Valor de journal no serializable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = z.record(z.string(), z.unknown()).parse(value);
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function sha256(value: string): z.infer<typeof HashSchema> {
  return HashSchema.parse(createHash('sha256').update(value).digest('hex'));
}

function parseStoredJson(value: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('JSON durable inválido');
  }
  return parsed;
}

function hashJson(value: unknown): { json: string; hash: z.infer<typeof HashSchema> } {
  const json = canonicalJson(value);
  return { json, hash: sha256(json) };
}

/** Internal adapter. Its path is chosen by the host, never by actor input. */
export function openJournal(input: { path: string }) {
  const journalPrivateDataRoot=dirname(input.path);
  if (input.path === ':memory:') throw new Error('El journal requiere archivo durable');
  mkdirSync(dirname(input.path), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(input.path);
  const hasVersion = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'").get();
  let initialVersion: number | undefined;
  if (hasVersion !== undefined) {
    try {
      const version = z.strictObject({ version: counter.nullable() }).parse(
        database.prepare('SELECT MAX(version) AS version FROM schema_version').get(),
      );
      if (version.version === null || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39].includes(version.version)) {
        throw new Error('Versión de journal no soportada');
      }
      initialVersion = version.version;
    } catch (error) {
      database.close();
      throw error;
    }
  }
  try {
  database.exec(`
    PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    PRAGMA busy_timeout=5000;
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
    INSERT OR IGNORE INTO schema_version VALUES(1);
    CREATE TABLE IF NOT EXISTS run_budgets(
      run_id TEXT PRIMARY KEY, max_calls INTEGER NOT NULL CHECK(max_calls>=0),
      consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed>=0)
    );
    CREATE TABLE IF NOT EXISTS pulses(
      pulse_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES run_budgets(run_id),
      max_calls INTEGER NOT NULL CHECK(max_calls>=0),
      consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed>=0)
    );
    CREATE TABLE IF NOT EXISTS request_reservations(
      job_id TEXT NOT NULL, generation INTEGER NOT NULL, request_seq INTEGER NOT NULL,
      run_id TEXT NOT NULL REFERENCES run_budgets(run_id),
      pulse_id TEXT NOT NULL REFERENCES pulses(pulse_id),
      state TEXT NOT NULL CHECK(state IN('reserved','dispatched','completed','undispatched','ambiguous')),
      PRIMARY KEY(job_id,generation,request_seq)
    );
    CREATE TABLE IF NOT EXISTS experiences(
      experience_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      world_seq INTEGER NOT NULL CHECK(world_seq>=0),
      canonical_payload TEXT NOT NULL, payload_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS experiences_owner_cut ON experiences(run_id,actor_id,world_seq);
    COMMIT;
  `);
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* Transaction may already have rolled back. */ }
    database.close();
    throw error;
  }

  if (initialVersion === undefined || initialVersion < 2) {
    try {
      database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS memory_receipts(
          experience_id TEXT PRIMARY KEY REFERENCES experiences(experience_id) ON DELETE RESTRICT,
          memory_id TEXT NOT NULL UNIQUE,
          claim_token TEXT NOT NULL UNIQUE,
          state TEXT NOT NULL CHECK(state='projected'),
          recorded_at INTEGER NOT NULL CHECK(recorded_at>=0)
        );
        CREATE TABLE IF NOT EXISTS memory_outbox(
          experience_id TEXT PRIMARY KEY REFERENCES experiences(experience_id) ON DELETE RESTRICT,
          claim_token TEXT,
          owner_token TEXT,
          attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
          last_failure TEXT CHECK(last_failure IN('projection_failed','cancelled')),
          created_at INTEGER NOT NULL CHECK(created_at>=0),
          CHECK((claim_token IS NULL)=(owner_token IS NULL))
        );
      `);
      database.prepare(`
        INSERT OR IGNORE INTO memory_outbox(experience_id,created_at)
          SELECT experience_id,? FROM experiences;
      `).run(Date.now());
      database.exec('INSERT OR IGNORE INTO schema_version VALUES(2); COMMIT;');
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* Transaction may already have rolled back. */ }
      database.close();
      throw error;
    }
  }

  if (initialVersion === undefined || initialVersion < 3) {
    try {
      database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS world_runs(
          run_id TEXT PRIMARY KEY,
          config_revision INTEGER NOT NULL CHECK(config_revision>=0),
          configuration_json TEXT NOT NULL,
          configuration_hash TEXT NOT NULL,
          continuity_fence_json TEXT NOT NULL,
          lifecycle TEXT NOT NULL CHECK(lifecycle IN('draft','ready','running','paused','stopped','closed')),
          world_revision INTEGER NOT NULL CHECK(world_revision>=0),
          last_seq INTEGER NOT NULL CHECK(last_seq>=0),
          commit_index INTEGER NOT NULL DEFAULT 0 CHECK(commit_index>=0),
          initial_snapshot_json TEXT NOT NULL,
          initial_snapshot_hash TEXT NOT NULL,
          snapshot_json TEXT NOT NULL,
          snapshot_hash TEXT NOT NULL,
          updated_at INTEGER NOT NULL CHECK(updated_at>=0)
        );
        CREATE TABLE IF NOT EXISTS world_prepared_contexts(
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          actor_id TEXT NOT NULL,
          config_revision INTEGER NOT NULL CHECK(config_revision>=0),
          continuity_id TEXT NOT NULL,
          identity_version INTEGER NOT NULL CHECK(identity_version>=0),
          prepared_context_hash TEXT NOT NULL,
          PRIMARY KEY(run_id,actor_id,config_revision)
        );
        CREATE TABLE IF NOT EXISTS actor_knowledge(
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          actor_id TEXT NOT NULL,
          knowledge_revision INTEGER NOT NULL CHECK(knowledge_revision>=0),
          at_world_seq INTEGER NOT NULL CHECK(at_world_seq>=0),
          payload_json TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          PRIMARY KEY(run_id,actor_id)
        );
        CREATE TABLE IF NOT EXISTS world_proposals(
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          proposal_id TEXT NOT NULL,
          version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 3),
          actor_id TEXT NOT NULL,
          scene_id TEXT NOT NULL,
          attempt_id TEXT NOT NULL,
          base_revision INTEGER NOT NULL CHECK(base_revision>=0),
          exact_content_hash TEXT NOT NULL,
          attempt_hash TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN('pending','resolved')),
          created_at INTEGER NOT NULL CHECK(created_at>=0),
          PRIMARY KEY(run_id,proposal_id,version),
          UNIQUE(run_id,attempt_id)
        );
        CREATE TABLE IF NOT EXISTS world_reviews(
          run_id TEXT NOT NULL,
          proposal_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          review_seq INTEGER NOT NULL CHECK(review_seq>=0),
          reviewer_kind TEXT NOT NULL CHECK(reviewer_kind='continuista'),
          verdict TEXT NOT NULL CHECK(verdict IN('allow','reformulate','reject')),
          complete INTEGER NOT NULL CHECK(complete IN(0,1)),
          state_revision INTEGER NOT NULL CHECK(state_revision>=0),
          exact_content_hash TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at INTEGER NOT NULL CHECK(created_at>=0),
          PRIMARY KEY(run_id,proposal_id,version,reviewer_kind,review_seq),
          FOREIGN KEY(run_id,proposal_id,version) REFERENCES world_proposals(run_id,proposal_id,version)
        );
        CREATE TABLE IF NOT EXISTS world_resolutions(
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          origin_kind TEXT NOT NULL CHECK(origin_kind='actorAttempt'),
          origin_id TEXT NOT NULL,
          proposal_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          attempt_hash TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          commit_index INTEGER NOT NULL CHECK(commit_index>=1),
          world_revision INTEGER NOT NULL CHECK(world_revision>=0),
          last_seq INTEGER NOT NULL CHECK(last_seq>=0),
          created_at INTEGER NOT NULL CHECK(created_at>=0),
          PRIMARY KEY(run_id,origin_kind,origin_id),
          UNIQUE(run_id,commit_index),
          FOREIGN KEY(run_id,proposal_id,version) REFERENCES world_proposals(run_id,proposal_id,version)
        );
        CREATE TABLE IF NOT EXISTS world_events(
          event_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          world_seq INTEGER NOT NULL CHECK(world_seq>=1),
          origin_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          UNIQUE(run_id,world_seq)
        );
        CREATE TABLE IF NOT EXISTS world_perceptions(
          perception_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          world_seq INTEGER NOT NULL CHECK(world_seq>=0),
          attempt_id TEXT NOT NULL,
          event_id TEXT,
          recipient_actor_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          payload_hash TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS world_deliveries(
          perception_id TEXT PRIMARY KEY REFERENCES world_perceptions(perception_id) ON DELETE RESTRICT,
          state TEXT NOT NULL CHECK(state IN('planned','delivering','delivered','failed')),
          claim_token TEXT,
          owner_token TEXT,
          attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
          failure_code TEXT CHECK(failure_code IN('delivery_failed','cancelled')),
          delivered_at INTEGER CHECK(delivered_at IS NULL OR delivered_at>=0),
          CHECK((claim_token IS NULL)=(owner_token IS NULL))
        );
        CREATE INDEX IF NOT EXISTS world_events_cut ON world_events(run_id,world_seq);
        CREATE INDEX IF NOT EXISTS world_perceptions_owner_cut ON world_perceptions(run_id,recipient_actor_id,world_seq);
        INSERT OR IGNORE INTO schema_version VALUES(3);
        COMMIT;
      `);
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* Transaction may already have rolled back. */ }
      database.close();
      throw error;
    }
  }

  if (initialVersion === undefined || initialVersion < 4) {
    try {
      database.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE world_proposals ADD COLUMN job_id TEXT;
        ALTER TABLE world_proposals ADD COLUMN generation INTEGER;
        ALTER TABLE world_proposals ADD COLUMN proposal_slot INTEGER;
        ALTER TABLE world_reviews ADD COLUMN payload_hash TEXT;
        CREATE UNIQUE INDEX world_proposals_job_slot
          ON world_proposals(run_id,job_id,generation,proposal_slot) WHERE job_id IS NOT NULL;
        CREATE UNIQUE INDEX world_perceptions_event_recipient
          ON world_perceptions(run_id,event_id,recipient_actor_id) WHERE event_id IS NOT NULL;
        CREATE UNIQUE INDEX world_perceptions_attempt_recipient
          ON world_perceptions(run_id,attempt_id,recipient_actor_id) WHERE event_id IS NULL;
        CREATE TABLE world_perception_experiences(
          perception_id TEXT PRIMARY KEY REFERENCES world_perceptions(perception_id) ON DELETE RESTRICT,
          experience_id TEXT NOT NULL UNIQUE REFERENCES experiences(experience_id) ON DELETE RESTRICT
        );
      `);
      const reviewRows = database.prepare('SELECT rowid,payload_json FROM world_reviews').all();
      for (const rowValue of reviewRows) {
        const row = z.strictObject({ rowid: counter, payload_json: z.string() }).parse(rowValue);
        const review = ContinuistaStoredReviewSchema.parse(parseStoredJson(row.payload_json));
        const canonical = canonicalJson(review);
        if (canonical !== row.payload_json) throw new Error('Review legacy no canónica; migración requiere diagnóstico');
        database.prepare('UPDATE world_reviews SET payload_hash=? WHERE rowid=?').run(sha256(canonical), row.rowid);
      }
      const experienceRows = database.prepare(`
        SELECT experience_id,run_id,actor_id,world_seq,canonical_payload,payload_hash FROM experiences
      `).all();
      for (const rowValue of experienceRows) {
        const row = ExperienceStoredRowSchema.parse(rowValue);
        if (sha256(row.canonical_payload) !== row.payload_hash) throw new Error('Experience legacy con hash inválido');
        const envelope = ExperienceSchema.parse(parseStoredJson(row.canonical_payload));
        if (canonicalJson(envelope) !== row.canonical_payload || envelope.experienceId !== row.experience_id
          || envelope.runId !== row.run_id || envelope.actorId !== row.actor_id || envelope.worldSeq !== row.world_seq) {
          throw new Error('Experience legacy no coincide con metadatos; migración requiere diagnóstico');
        }
        if (envelope.kind !== 'perception') continue;
        const linked = database.prepare(`
          SELECT perception_id FROM world_perceptions
          WHERE perception_id=? AND run_id=? AND recipient_actor_id=? AND event_id=?
        `).get(envelope.perceptionId, envelope.runId, envelope.actorId, envelope.eventId);
        if (linked !== undefined) {
          database.prepare('INSERT INTO world_perception_experiences(perception_id,experience_id) VALUES(?,?)')
            .run(envelope.perceptionId, envelope.experienceId);
        }
      }
      database.exec('INSERT OR IGNORE INTO schema_version VALUES(4); COMMIT;');
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* Transaction may already have rolled back. */ }
      database.close();
      throw error;
    }
  }

  if (initialVersion === undefined || initialVersion < 5) {
    try {
      database.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE world_perceptions ADD COLUMN origin_kind TEXT NOT NULL DEFAULT 'actorAttempt';
        ALTER TABLE world_perceptions ADD COLUMN origin_id TEXT NOT NULL DEFAULT '';
        UPDATE world_perceptions SET origin_id=attempt_id WHERE origin_id='';
        CREATE INDEX world_perceptions_origin_commit ON world_perceptions(run_id,origin_kind,origin_id);
        CREATE TABLE actor_pi_sessions(
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          actor_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          session_path TEXT NOT NULL,
          prepared_context_hash TEXT NOT NULL,
          profile_json TEXT NOT NULL,
          profile_hash TEXT NOT NULL,
          committed_leaf_id TEXT,
          session_revision INTEGER NOT NULL DEFAULT 0 CHECK(session_revision>=0),
          created_at INTEGER NOT NULL CHECK(created_at>=0),
          updated_at INTEGER NOT NULL CHECK(updated_at>=0),
          PRIMARY KEY(run_id,actor_id)
        );
        CREATE TABLE actor_pi_candidates(
          candidate_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          pulse_id TEXT NOT NULL,
          job_id TEXT NOT NULL,
          generation INTEGER NOT NULL CHECK(generation>=0),
          turn_id TEXT NOT NULL,
          candidate_kind TEXT NOT NULL CHECK(candidate_kind IN('request-input','terminal-candidate')),
          request_seq INTEGER,
          outcome TEXT CHECK(outcome IN('completed','aborted','failed')),
          last_request_seq INTEGER,
          base_session_revision INTEGER NOT NULL CHECK(base_session_revision>=0),
          base_leaf_id TEXT,
          session_id TEXT NOT NULL,
          session_path TEXT NOT NULL,
          prepared_context_hash TEXT NOT NULL,
          candidate_leaf_id TEXT,
          input_world_revision INTEGER NOT NULL CHECK(input_world_revision>=0),
          input_world_seq INTEGER NOT NULL CHECK(input_world_seq>=0),
          input_fictional_at INTEGER NOT NULL,
          input_perception_ids_json TEXT NOT NULL,
          canonical_payload TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          recorded_at INTEGER NOT NULL CHECK(recorded_at>=0),
          UNIQUE(run_id,actor_id,job_id,generation,candidate_id),
          FOREIGN KEY(run_id,actor_id) REFERENCES actor_pi_sessions(run_id,actor_id) ON DELETE RESTRICT,
          FOREIGN KEY(job_id,generation,request_seq) REFERENCES request_reservations(job_id,generation,request_seq)
        );
        CREATE UNIQUE INDEX actor_pi_request_candidate_slot
          ON actor_pi_candidates(run_id,actor_id,job_id,generation,request_seq)
          WHERE candidate_kind='request-input';
        CREATE UNIQUE INDEX actor_pi_terminal_candidate_slot
          ON actor_pi_candidates(run_id,actor_id,job_id,generation,turn_id)
          WHERE candidate_kind='terminal-candidate';
        CREATE TABLE actor_pi_turn_receipts(
          candidate_id TEXT PRIMARY KEY REFERENCES actor_pi_candidates(candidate_id) ON DELETE RESTRICT,
          receipt_json TEXT NOT NULL,
          receipt_hash TEXT NOT NULL,
          acceptance_hash TEXT NOT NULL,
          accepted_at INTEGER NOT NULL CHECK(accepted_at>=0)
        );
        CREATE TABLE actor_pi_consumptions(
          run_id TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          perception_id TEXT NOT NULL REFERENCES world_perceptions(perception_id) ON DELETE RESTRICT,
          candidate_id TEXT NOT NULL REFERENCES actor_pi_candidates(candidate_id) ON DELETE RESTRICT,
          consumed_at INTEGER NOT NULL CHECK(consumed_at>=0),
          PRIMARY KEY(run_id,actor_id,perception_id),
          FOREIGN KEY(run_id,actor_id) REFERENCES actor_pi_sessions(run_id,actor_id) ON DELETE RESTRICT
        );
        INSERT OR IGNORE INTO schema_version VALUES(5);
        COMMIT;
      `);
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* Transaction may already have rolled back. */ }
      database.close();
      throw error;
    }
  }

  if (initialVersion === undefined || initialVersion < 6) {
    try {
      database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS world_commits(
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          commit_index INTEGER NOT NULL CHECK(commit_index>=1),
          origin_kind TEXT NOT NULL CHECK(length(origin_kind) BETWEEN 1 AND 100),
          origin_id TEXT NOT NULL CHECK(length(origin_id) BETWEEN 1 AND 200),
          world_revision INTEGER NOT NULL CHECK(world_revision>=0),
          last_seq INTEGER NOT NULL CHECK(last_seq>=0),
          snapshot_json TEXT NOT NULL,
          snapshot_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL CHECK(created_at>=0),
          PRIMARY KEY(run_id,commit_index),
          UNIQUE(run_id,origin_kind,origin_id)
        );
        CREATE INDEX IF NOT EXISTS world_commits_cut
          ON world_commits(run_id,last_seq,commit_index);
        CREATE INDEX IF NOT EXISTS world_commits_revision_cut
          ON world_commits(run_id,world_revision,last_seq,commit_index);
      `);

      const expectedIndexByRun = new Map<string, number>();
      const resolutionRows = database.prepare(`
        SELECT run_id,origin_kind,origin_id,payload_json,payload_hash,commit_index,world_revision,last_seq,created_at
        FROM world_resolutions ORDER BY run_id,commit_index
      `).all();
      const existingCommit = database.prepare(`
        SELECT run_id,origin_kind,origin_id,commit_index,world_revision,last_seq,snapshot_json,snapshot_hash,created_at
        FROM world_commits WHERE run_id=? AND commit_index=?
      `);
      const insertCommit = database.prepare(`
        INSERT INTO world_commits(
          run_id,origin_kind,origin_id,commit_index,world_revision,last_seq,snapshot_json,snapshot_hash,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?)
      `);
      for (const value of resolutionRows) {
        const row = WorldResolutionMigrationRowSchema.parse(value);
        const expectedIndex = (expectedIndexByRun.get(row.run_id) ?? 0) + 1;
        if (row.commit_index !== expectedIndex) {
          throw new Error('El backfill de world commits requiere índices actorAttempt consecutivos');
        }
        expectedIndexByRun.set(row.run_id, row.commit_index);
        if (sha256(row.payload_json) !== row.payload_hash) {
          throw new Error('Hash de resolución actorAttempt inválido durante backfill');
        }
        const resolution = WorldResolutionSchema.parse(parseStoredJson(row.payload_json));
        if (canonicalJson(resolution) !== row.payload_json
          || resolution.attemptId !== row.origin_id || resolution.newSnapshot.revision !== row.world_revision
          || resolution.newSnapshot.seq !== row.last_seq || resolution.newSnapshot.runId !== row.run_id) {
          throw new Error('Resolución actorAttempt no coincide con los metadatos del backfill');
        }
        const snapshot = hashJson(resolution.newSnapshot);
        const commit = {
          run_id: row.run_id, origin_kind: row.origin_kind, origin_id: row.origin_id,
          commit_index: row.commit_index, world_revision: row.world_revision, last_seq: row.last_seq,
          snapshot_json: snapshot.json, snapshot_hash: snapshot.hash, created_at: row.created_at,
        };
        const existingValue = existingCommit.get(row.run_id, row.commit_index);
        if (existingValue === undefined) {
          insertCommit.run(commit.run_id, commit.origin_kind, commit.origin_id, commit.commit_index,
            commit.world_revision, commit.last_seq, commit.snapshot_json, commit.snapshot_hash, commit.created_at);
        } else {
          const existing = WorldCommitDbRowSchema.parse(existingValue);
          if (canonicalJson(existing) !== canonicalJson(commit)) {
            throw new Error('world_commit existente difiere de su resolución actorAttempt');
          }
        }
      }

      const runRows = database.prepare('SELECT run_id,commit_index,world_revision,last_seq,snapshot_json,snapshot_hash FROM world_runs').all();
      for (const value of runRows) {
        const run = z.strictObject({
          run_id: RunIdSchema, commit_index: counter, world_revision: counter, last_seq: counter,
          snapshot_json: z.string(), snapshot_hash: HashSchema,
        }).parse(value);
        const backfilledIndex = expectedIndexByRun.get(run.run_id) ?? 0;
        if (backfilledIndex !== run.commit_index) {
          throw new Error('El backfill de world commits no cubre todos los índices de la corrida');
        }
        if (run.commit_index > 0) {
          const lastCommit = WorldCommitDbRowSchema.parse(existingCommit.get(run.run_id, run.commit_index));
          const currentSnapshot = WorldSnapshotSchema.parse(parseStoredJson(run.snapshot_json));
          if (lastCommit.world_revision !== run.world_revision || lastCommit.last_seq !== run.last_seq
            || lastCommit.snapshot_json !== hashJson(currentSnapshot).json || sha256(run.snapshot_json) !== run.snapshot_hash) {
            throw new Error('El último commit actorAttempt no coincide con el snapshot actual');
          }
        }
      }
      database.exec('INSERT OR IGNORE INTO schema_version VALUES(6); COMMIT;');
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* Transaction may already have rolled back. */ }
      database.close();
      throw error;
    }
  }

  if (initialVersion === undefined || initialVersion < 7) {
    try {
      // SQLite cannot drop NOT NULL from a column in place. Rebuild this parent
      // table with FK enforcement temporarily disabled; all child keys still
      // target the same table name after the rename and are checked before commit.
      database.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
      const invalidLegacyRows = database.prepare(`
        SELECT COUNT(*) AS n FROM world_perceptions
        WHERE attempt_id IS NULL OR origin_kind!='actorAttempt' OR origin_id!=attempt_id
      `).get();
      const invalidCount = z.strictObject({ n: counter }).parse(invalidLegacyRows).n;
      if (invalidCount !== 0) throw new Error('Percepciones heredadas no conservan un origen actorAttempt coherente');
      database.exec(`
        CREATE TABLE world_perceptions_v7(
          perception_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          world_seq INTEGER NOT NULL CHECK(world_seq>=0),
          attempt_id TEXT,
          event_id TEXT,
          recipient_actor_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          origin_kind TEXT NOT NULL DEFAULT 'actorAttempt',
          origin_id TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO world_perceptions_v7(
          perception_id,run_id,world_seq,attempt_id,event_id,recipient_actor_id,payload_json,payload_hash,origin_kind,origin_id
        ) SELECT perception_id,run_id,world_seq,attempt_id,event_id,recipient_actor_id,payload_json,payload_hash,origin_kind,origin_id
          FROM world_perceptions;
        DROP TABLE world_perceptions;
        ALTER TABLE world_perceptions_v7 RENAME TO world_perceptions;
        CREATE INDEX world_perceptions_owner_cut ON world_perceptions(run_id,recipient_actor_id,world_seq);
        CREATE UNIQUE INDEX world_perceptions_event_recipient
          ON world_perceptions(run_id,event_id,recipient_actor_id) WHERE event_id IS NOT NULL;
        CREATE UNIQUE INDEX world_perceptions_attempt_recipient
          ON world_perceptions(run_id,attempt_id,recipient_actor_id) WHERE event_id IS NULL;
        CREATE INDEX world_perceptions_origin_commit ON world_perceptions(run_id,origin_kind,origin_id);
        CREATE TABLE IF NOT EXISTS human_intervention_receipts(
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          participant_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL CHECK(length(idempotency_key)=36),
          intervention_id TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          resolution_json TEXT NOT NULL,
          resolution_hash TEXT NOT NULL,
          commit_index INTEGER CHECK(commit_index IS NULL OR commit_index>=1),
          created_at INTEGER NOT NULL CHECK(created_at>=0),
          PRIMARY KEY(run_id,participant_id,idempotency_key),
          UNIQUE(run_id,participant_id,intervention_id),
          FOREIGN KEY(run_id,commit_index) REFERENCES world_commits(run_id,commit_index) ON DELETE RESTRICT
        );
        INSERT OR IGNORE INTO schema_version VALUES(7);
      `);
      const foreignKeyFailures = database.prepare('PRAGMA foreign_key_check').all();
      if (foreignKeyFailures.length !== 0) throw new Error('Migración v7 deja referencias foráneas inválidas');
      database.exec('COMMIT;');
    } catch (error) {
      try { database.exec('ROLLBACK;'); } catch { /* Transaction may already have rolled back. */ }
      database.close();
      throw error;
    } finally {
      try { database.exec('PRAGMA foreign_keys=ON;'); } catch { /* The connection is closed after a migration failure. */ }
    }
  }

  if (initialVersion === undefined || initialVersion < 8) {
    try {
      database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS actor_turn_intents(
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          actor_id TEXT NOT NULL,
          perception_id TEXT PRIMARY KEY REFERENCES world_perceptions(perception_id) ON DELETE RESTRICT,
          world_seq INTEGER NOT NULL CHECK(world_seq>=0),
          state TEXT NOT NULL CHECK(state IN('awaitingDelivery','queued')),
          created_at INTEGER NOT NULL CHECK(created_at>=0)
        );
        CREATE INDEX IF NOT EXISTS actor_turn_intents_ready
          ON actor_turn_intents(run_id,actor_id,state,world_seq,perception_id);
        INSERT OR IGNORE INTO actor_turn_intents(run_id,actor_id,perception_id,world_seq,state,created_at)
          SELECT p.run_id,p.recipient_actor_id,p.perception_id,p.world_seq,
            CASE WHEN d.state='delivered' THEN 'queued' ELSE 'awaitingDelivery' END,
            COALESCE(d.delivered_at,c.created_at)
          FROM world_perceptions p
          JOIN world_deliveries d ON d.perception_id=p.perception_id
          JOIN world_commits c ON c.run_id=p.run_id AND c.origin_kind=p.origin_kind AND c.origin_id=p.origin_id
          WHERE p.origin_kind='humanIntervention';
        INSERT OR IGNORE INTO schema_version VALUES(8);
        COMMIT;
      `);
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* Transaction may already have rolled back. */ }
      database.close();
      throw error;
    }
  }

  if (initialVersion === undefined || initialVersion < 9) {
    try {
      database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS actor_turn_jobs(
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          actor_id TEXT NOT NULL,
          job_id TEXT NOT NULL,
          generation INTEGER NOT NULL CHECK(generation>=0),
          pulse_id TEXT NOT NULL REFERENCES pulses(pulse_id) ON DELETE RESTRICT,
          state TEXT NOT NULL CHECK(state IN('queued','running','accepted')),
          owner_token TEXT,
          claim_token TEXT,
          created_at INTEGER NOT NULL CHECK(created_at>=0),
          updated_at INTEGER NOT NULL CHECK(updated_at>=0),
          PRIMARY KEY(run_id,actor_id,job_id,generation),
          UNIQUE(job_id,generation),
          CHECK((owner_token IS NULL)=(claim_token IS NULL)),
          CHECK(state!='running' OR (owner_token IS NOT NULL AND claim_token IS NOT NULL))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS actor_turn_jobs_one_active
          ON actor_turn_jobs(run_id,actor_id) WHERE state IN('queued','running');
        CREATE TABLE IF NOT EXISTS actor_turn_job_inputs(
          run_id TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          job_id TEXT NOT NULL,
          generation INTEGER NOT NULL CHECK(generation>=0),
          perception_id TEXT NOT NULL UNIQUE REFERENCES actor_turn_intents(perception_id) ON DELETE RESTRICT,
          state TEXT NOT NULL CHECK(state IN('assigned','consumed')),
          assigned_at INTEGER NOT NULL CHECK(assigned_at>=0),
          consumed_at INTEGER CHECK(consumed_at IS NULL OR consumed_at>=0),
          PRIMARY KEY(run_id,actor_id,job_id,generation,perception_id),
          FOREIGN KEY(run_id,actor_id,job_id,generation)
            REFERENCES actor_turn_jobs(run_id,actor_id,job_id,generation) ON DELETE RESTRICT,
          CHECK((state='assigned' AND consumed_at IS NULL) OR (state='consumed' AND consumed_at IS NOT NULL))
        );
        CREATE INDEX IF NOT EXISTS actor_turn_job_inputs_pending
          ON actor_turn_job_inputs(run_id,actor_id,job_id,generation,state,perception_id);
        INSERT OR IGNORE INTO schema_version VALUES(9);
        COMMIT;
      `);
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* Transaction may already have rolled back. */ }
      database.close();
      throw error;
    }
  }

  if (initialVersion === undefined || initialVersion < 10) {
    try {
      database.exec('BEGIN IMMEDIATE');
      const columns = database.prepare("PRAGMA table_info('actor_turn_jobs')").all()
        .map((value) => z.object({ name: z.string() }).parse(value).name);
      if (!columns.includes('frozen_perception_ids_json')) {
        database.exec('ALTER TABLE actor_turn_jobs ADD COLUMN frozen_perception_ids_json TEXT');
      }
      database.prepare('INSERT OR IGNORE INTO schema_version VALUES(10)').run();
      database.exec('COMMIT');
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* Transaction may already have rolled back. */ }
      database.close();
      throw error;
    }
  }

  if (initialVersion === undefined || initialVersion < 11) {
    try {
      database.exec('BEGIN IMMEDIATE');
      const columns = database.prepare("PRAGMA table_info('actor_turn_jobs')").all()
        .map((value) => z.object({ name: z.string() }).parse(value).name);
      if (!columns.includes('frozen_world_cut_json')) {
        database.exec('ALTER TABLE actor_turn_jobs ADD COLUMN frozen_world_cut_json TEXT');
      }
      database.prepare('INSERT OR IGNORE INTO schema_version VALUES(11)').run();
      database.exec('COMMIT');
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* Transaction may already have rolled back. */ }
      database.close();
      throw error;
    }
  }

  if (initialVersion === undefined || initialVersion < 12) {
    try {
      database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS actor_job_request_leases(
          job_id TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation>=0),
          request_seq INTEGER NOT NULL CHECK(request_seq>=0),
          owner_token TEXT NOT NULL,claim_token TEXT NOT NULL,
          PRIMARY KEY(job_id,generation,request_seq),
          FOREIGN KEY(job_id,generation,request_seq)
            REFERENCES request_reservations(job_id,generation,request_seq) ON DELETE RESTRICT
        );
        CREATE TABLE IF NOT EXISTS actor_job_checkpoints(
          checkpoint_hash TEXT PRIMARY KEY,run_id TEXT NOT NULL,actor_id TEXT NOT NULL,
          job_id TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation>=0),
          purpose_kind TEXT NOT NULL CHECK(purpose_kind IN('job-base','request-input','terminal-candidate')),
          request_seq INTEGER CHECK(request_seq IS NULL OR request_seq>=0),
          payload_json TEXT NOT NULL,recorded_at INTEGER NOT NULL CHECK(recorded_at>=0),
          CHECK((purpose_kind='request-input' AND request_seq IS NOT NULL)
            OR (purpose_kind!='request-input' AND request_seq IS NULL)),
          FOREIGN KEY(run_id,actor_id,job_id,generation)
            REFERENCES actor_turn_jobs(run_id,actor_id,job_id,generation) ON DELETE RESTRICT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS actor_job_checkpoint_request_slot
          ON actor_job_checkpoints(job_id,generation,request_seq) WHERE purpose_kind='request-input';
        INSERT OR IGNORE INTO schema_version VALUES(12);
        COMMIT;
      `);
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* Migration is atomic. */ }
      database.close();
      throw error;
    }
  }

  if (initialVersion === undefined || initialVersion < 13) {
    try {
      database.exec(`
        PRAGMA foreign_keys=OFF;
        BEGIN IMMEDIATE;
        CREATE TABLE actor_turn_jobs_v13(
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          actor_id TEXT NOT NULL,job_id TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation>=0),
          pulse_id TEXT NOT NULL REFERENCES pulses(pulse_id) ON DELETE RESTRICT,
          state TEXT NOT NULL CHECK(state IN('queued','running','accepted','blocked')),
          owner_token TEXT,claim_token TEXT,created_at INTEGER NOT NULL CHECK(created_at>=0),
          updated_at INTEGER NOT NULL CHECK(updated_at>=0),frozen_perception_ids_json TEXT,frozen_world_cut_json TEXT,
          failure_code TEXT CHECK(failure_code IS NULL OR failure_code IN('cancelled','pi-incomplete','proposal-missing','review-incomplete','review-rejected','reformulations-exhausted','job-inactive','execution-failed','recovery-required')),
          PRIMARY KEY(run_id,actor_id,job_id,generation),UNIQUE(job_id,generation),
          CHECK((owner_token IS NULL)=(claim_token IS NULL)),
          CHECK(state!='running' OR owner_token IS NOT NULL),
          CHECK((state='blocked')=(failure_code IS NOT NULL))
        );
        INSERT INTO actor_turn_jobs_v13 SELECT run_id,actor_id,job_id,generation,pulse_id,state,
          owner_token,claim_token,created_at,updated_at,frozen_perception_ids_json,frozen_world_cut_json,NULL FROM actor_turn_jobs;
        CREATE TABLE actor_turn_job_inputs_v13(
          run_id TEXT NOT NULL,actor_id TEXT NOT NULL,job_id TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation>=0),
          perception_id TEXT NOT NULL REFERENCES actor_turn_intents(perception_id) ON DELETE RESTRICT,
          state TEXT NOT NULL CHECK(state IN('assigned','consumed','released')),
          assigned_at INTEGER NOT NULL CHECK(assigned_at>=0),consumed_at INTEGER CHECK(consumed_at IS NULL OR consumed_at>=0),
          PRIMARY KEY(run_id,actor_id,job_id,generation,perception_id),
          FOREIGN KEY(run_id,actor_id,job_id,generation) REFERENCES actor_turn_jobs(run_id,actor_id,job_id,generation) ON DELETE RESTRICT,
          CHECK((state IN('assigned','released') AND consumed_at IS NULL) OR (state='consumed' AND consumed_at IS NOT NULL))
        );
        INSERT INTO actor_turn_job_inputs_v13 SELECT * FROM actor_turn_job_inputs;
        DROP TABLE actor_turn_job_inputs;
        DROP TABLE actor_turn_jobs;
        ALTER TABLE actor_turn_jobs_v13 RENAME TO actor_turn_jobs;
        ALTER TABLE actor_turn_job_inputs_v13 RENAME TO actor_turn_job_inputs;
        CREATE UNIQUE INDEX actor_turn_jobs_one_active ON actor_turn_jobs(run_id,actor_id) WHERE state IN('queued','running');
        CREATE UNIQUE INDEX actor_turn_inputs_one_live ON actor_turn_job_inputs(perception_id) WHERE state IN('assigned','consumed');
        CREATE INDEX actor_turn_job_inputs_pending ON actor_turn_job_inputs(run_id,actor_id,job_id,generation,state,perception_id);
        INSERT OR IGNORE INTO actor_turn_intents(run_id,actor_id,perception_id,world_seq,state,created_at)
          SELECT p.run_id,p.recipient_actor_id,p.perception_id,p.world_seq,
            CASE WHEN d.state='delivered' THEN 'queued' ELSE 'awaitingDelivery' END,c.created_at
          FROM world_perceptions p JOIN world_deliveries d ON d.perception_id=p.perception_id
          JOIN world_proposals a ON a.run_id=p.run_id AND a.attempt_id=p.attempt_id
          JOIN world_commits c ON c.run_id=p.run_id AND c.origin_kind=p.origin_kind AND c.origin_id=p.origin_id
          WHERE p.origin_kind='actorAttempt' AND p.recipient_actor_id<>a.actor_id
            AND NOT EXISTS(SELECT 1 FROM actor_pi_consumptions used WHERE used.run_id=p.run_id
              AND used.actor_id=p.recipient_actor_id AND used.perception_id=p.perception_id);
        INSERT OR IGNORE INTO schema_version VALUES(13);
      `);
      if (database.prepare('PRAGMA foreign_key_check').all().length !== 0) throw new Error('Migración v13 produjo referencias inválidas');
      database.exec('COMMIT; PRAGMA foreign_keys=ON;');
    } catch (error) {
      try { database.exec('ROLLBACK; PRAGMA foreign_keys=ON;'); } catch { /* Migration is atomic. */ }
      database.close();
      throw error;
    }
  }

  if (initialVersion === undefined || initialVersion < 14) {
    try {
      database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS coordinator_pulses(
          pulse_id TEXT PRIMARY KEY REFERENCES pulses(pulse_id) ON DELETE RESTRICT,
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          origin_kind TEXT NOT NULL CHECK(origin_kind IN('humanIntervention','actorAttempt')),
          origin_id TEXT NOT NULL,commit_index INTEGER NOT NULL CHECK(commit_index>=1),
          configuration_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('running','completed','blocked')),
          created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
          UNIQUE(run_id,origin_kind,origin_id),
          FOREIGN KEY(run_id,commit_index) REFERENCES world_commits(run_id,commit_index) ON DELETE RESTRICT);
        CREATE UNIQUE INDEX IF NOT EXISTS coordinator_pulses_one_running ON coordinator_pulses(run_id) WHERE state='running';
        INSERT INTO schema_version VALUES(14); COMMIT;`);
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* Atomic migration. */ }
      database.close(); throw error;
    }
  }

  if (initialVersion === undefined || initialVersion < 15) {
    try {
      database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS continuista_jobs(
          job_id TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation>=0),run_id TEXT NOT NULL,actor_id TEXT NOT NULL,
          actor_job_id TEXT NOT NULL,actor_generation INTEGER NOT NULL,pulse_id TEXT NOT NULL REFERENCES pulses(pulse_id),
          proposal_id TEXT NOT NULL,proposal_version INTEGER NOT NULL,context_hash TEXT NOT NULL,context_json TEXT NOT NULL,
          actor_execution_json TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('queued','running','accepted','blocked')),
          owner_token TEXT,claim_token TEXT,failure_code TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
          PRIMARY KEY(job_id,generation),UNIQUE(run_id,actor_job_id,actor_generation,proposal_id,proposal_version,generation),
          FOREIGN KEY(run_id,actor_id,actor_job_id,actor_generation) REFERENCES actor_turn_jobs(run_id,actor_id,job_id,generation),
          FOREIGN KEY(run_id,proposal_id,proposal_version) REFERENCES world_proposals(run_id,proposal_id,version),
          CHECK((owner_token IS NULL)=(claim_token IS NULL)),CHECK(state!='running' OR owner_token IS NOT NULL),
          CHECK((state='blocked')=(failure_code IS NOT NULL)));
        CREATE TABLE IF NOT EXISTS continuista_sessions(
          job_id TEXT NOT NULL,generation INTEGER NOT NULL,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,
          PRIMARY KEY(job_id,generation),FOREIGN KEY(job_id,generation) REFERENCES continuista_jobs(job_id,generation));
        CREATE TABLE IF NOT EXISTS continuista_request_leases(
          job_id TEXT NOT NULL,generation INTEGER NOT NULL,request_seq INTEGER NOT NULL,execution_json TEXT NOT NULL,
          PRIMARY KEY(job_id,generation,request_seq),FOREIGN KEY(job_id,generation,request_seq) REFERENCES request_reservations(job_id,generation,request_seq));
        CREATE TABLE IF NOT EXISTS continuista_checkpoints(
          checkpoint_hash TEXT PRIMARY KEY,job_id TEXT NOT NULL,generation INTEGER NOT NULL,purpose_kind TEXT NOT NULL,
          request_seq INTEGER,payload_json TEXT NOT NULL,recorded_at INTEGER NOT NULL,
          FOREIGN KEY(job_id,generation) REFERENCES continuista_jobs(job_id,generation));
        CREATE UNIQUE INDEX IF NOT EXISTS continuista_input_checkpoint_slot ON continuista_checkpoints(job_id,generation,request_seq) WHERE purpose_kind='request-input';
        CREATE TABLE IF NOT EXISTS continuista_candidates(
          job_id TEXT NOT NULL,generation INTEGER NOT NULL,candidate_hash TEXT NOT NULL,payload_json TEXT NOT NULL,
          PRIMARY KEY(job_id,generation),FOREIGN KEY(job_id,generation) REFERENCES continuista_jobs(job_id,generation));
        CREATE TABLE IF NOT EXISTS continuista_receipts(
          job_id TEXT NOT NULL,generation INTEGER NOT NULL,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,
          PRIMARY KEY(job_id,generation),FOREIGN KEY(job_id,generation) REFERENCES continuista_jobs(job_id,generation));
        INSERT OR IGNORE INTO schema_version VALUES(15);COMMIT;`);
    } catch(error) {try {database.exec('ROLLBACK');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  if(initialVersion===undefined||initialVersion<16){
    try{
      database.exec('PRAGMA foreign_keys=OFF;BEGIN IMMEDIATE;');
      const old=z.strictObject({sql:z.string()}).parse(database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='actor_turn_jobs'").get());
      const updated=old.sql.replace(/CREATE TABLE\s+(?:"actor_turn_jobs"|actor_turn_jobs)/,'CREATE TABLE actor_turn_jobs_v16')
        .replace("'execution-failed'))", "'execution-failed','recovery-required'))");
      database.exec(updated);
      database.exec(`INSERT INTO actor_turn_jobs_v16 SELECT * FROM actor_turn_jobs;DROP TABLE actor_turn_jobs;ALTER TABLE actor_turn_jobs_v16 RENAME TO actor_turn_jobs;
        CREATE UNIQUE INDEX actor_turn_jobs_one_active ON actor_turn_jobs(run_id,actor_id) WHERE state IN('queued','running');
        CREATE TABLE IF NOT EXISTS actor_terminal_proposals(candidate_id TEXT PRIMARY KEY REFERENCES actor_pi_candidates(candidate_id),proposal_id TEXT NOT NULL,version INTEGER NOT NULL,attempt_hash TEXT NOT NULL);
        INSERT OR IGNORE INTO actor_terminal_proposals
          SELECT c.candidate_id,p.proposal_id,p.version,p.attempt_hash FROM actor_pi_candidates c JOIN world_proposals p ON p.run_id=c.run_id AND p.actor_id=c.actor_id AND p.job_id=c.job_id AND p.generation=c.generation
          WHERE c.candidate_kind='terminal-candidate' AND c.outcome='completed'
            AND c.last_request_seq=(SELECT MAX(r.request_seq) FROM request_reservations r WHERE r.job_id=c.job_id AND r.generation=c.generation)
            AND p.version=(SELECT MAX(latest.version) FROM world_proposals latest WHERE latest.job_id=p.job_id AND latest.generation=p.generation)
            AND p.version=(SELECT COUNT(*) FROM actor_pi_candidates t WHERE t.job_id=c.job_id AND t.generation=c.generation AND t.candidate_kind='terminal-candidate' AND t.outcome='completed');
        CREATE TABLE IF NOT EXISTS actor_turn_reconciliations(
          run_id TEXT NOT NULL,actor_id TEXT NOT NULL,job_id TEXT NOT NULL,generation INTEGER NOT NULL,candidate_id TEXT NOT NULL REFERENCES actor_pi_candidates(candidate_id),
          execution_json TEXT NOT NULL,proof_hash TEXT NOT NULL,proof_json TEXT NOT NULL,created_at INTEGER NOT NULL,
          PRIMARY KEY(run_id,actor_id,job_id,generation,candidate_id),
          FOREIGN KEY(run_id,actor_id,job_id,generation) REFERENCES actor_turn_jobs(run_id,actor_id,job_id,generation));
        INSERT OR IGNORE INTO schema_version VALUES(16);`);
      if(database.prepare('PRAGMA foreign_key_check').all().length!==0)throw new Error('Migración v16 produjo referencias inválidas');
      database.exec('COMMIT;PRAGMA foreign_keys=ON;');
    }catch(error){try{database.exec('ROLLBACK;PRAGMA foreign_keys=ON;');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  if(initialVersion===undefined||initialVersion<17){
    try{database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS run_configuration_drafts(
        run_id TEXT PRIMARY KEY,revision INTEGER NOT NULL CHECK(revision>=0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS run_configuration_draft_history(
        run_id TEXT NOT NULL REFERENCES run_configuration_drafts(run_id),revision INTEGER NOT NULL CHECK(revision>=0),
        principal_id TEXT NOT NULL,recorded_at TEXT NOT NULL,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,
        PRIMARY KEY(run_id,revision));
      CREATE TABLE IF NOT EXISTS run_draft_operations(
        principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,operation_kind TEXT NOT NULL CHECK(operation_kind IN('create','update')),
        request_hash TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,recorded_at TEXT NOT NULL,
        PRIMARY KEY(principal_id,idempotency_key));
      INSERT OR IGNORE INTO schema_version VALUES(17);COMMIT;`);
    }catch(error){try{database.exec('ROLLBACK');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  if(initialVersion===undefined||initialVersion<18){
    try{database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE run_draft_operations_v18(
        principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,operation_kind TEXT NOT NULL CHECK(operation_kind IN('create','update','validate')),
        request_hash TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,recorded_at TEXT NOT NULL,PRIMARY KEY(principal_id,idempotency_key));
      INSERT INTO run_draft_operations_v18 SELECT * FROM run_draft_operations;
      DROP TABLE run_draft_operations;ALTER TABLE run_draft_operations_v18 RENAME TO run_draft_operations;
      CREATE TABLE IF NOT EXISTS run_draft_validation_reports(
        run_id TEXT NOT NULL,revision INTEGER NOT NULL,principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,recorded_at TEXT NOT NULL,
        PRIMARY KEY(principal_id,idempotency_key),
        FOREIGN KEY(run_id,revision) REFERENCES run_configuration_draft_history(run_id,revision),
        FOREIGN KEY(principal_id,idempotency_key) REFERENCES run_draft_operations(principal_id,idempotency_key));
      INSERT OR IGNORE INTO schema_version VALUES(18);COMMIT;`);
    }catch(error){try{database.exec('ROLLBACK');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  if(initialVersion===undefined||initialVersion<19){
    try{database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE pi_oauth_jobs(job_id TEXT PRIMARY KEY,provider TEXT NOT NULL CHECK(provider='openai-codex'),kind TEXT NOT NULL CHECK(kind IN('login','logout')),
        principal_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('queued','running','cancel-requested','succeeded','failed','canceled','interrupted')),
        revision INTEGER NOT NULL CHECK(revision>=0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,safe_code TEXT,
        owner_token TEXT,claim_token TEXT,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,
        CHECK((owner_token IS NULL)=(claim_token IS NULL)),CHECK(state NOT IN('running','cancel-requested') OR owner_token IS NOT NULL));
      CREATE UNIQUE INDEX pi_oauth_one_running ON pi_oauth_jobs(provider) WHERE state IN('running','cancel-requested');
      CREATE TABLE pi_oauth_job_history(job_id TEXT NOT NULL REFERENCES pi_oauth_jobs(job_id),revision INTEGER NOT NULL,
        payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,PRIMARY KEY(job_id,revision));
      CREATE TABLE pi_oauth_job_operations(principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('login','logout','cancel')),
        request_hash TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,PRIMARY KEY(principal_id,idempotency_key));
      INSERT OR IGNORE INTO schema_version VALUES(19);COMMIT;`);
    }catch(error){try{database.exec('ROLLBACK');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  if(initialVersion===undefined||initialVersion<20){
    try{database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE pi_access_jobs(
        job_id TEXT PRIMARY KEY,principal_id TEXT NOT NULL,provider TEXT NOT NULL CHECK(provider IN('openai-codex','anthropic')),
        profile_json TEXT NOT NULL,profile_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('queued','running','cancel-requested','succeeded','failed','canceled','interrupted')),
        revision INTEGER NOT NULL CHECK(revision>=0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        result_kind TEXT CHECK(result_kind IN('passed','failed','aborted','ambiguous')),safe_code TEXT,
        owner_token TEXT,claim_token TEXT,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,
        CHECK((owner_token IS NULL)=(claim_token IS NULL)),CHECK(state NOT IN('running','cancel-requested') OR owner_token IS NOT NULL));
      CREATE UNIQUE INDEX pi_access_one_running ON pi_access_jobs(provider) WHERE state IN('running','cancel-requested');
      CREATE TABLE pi_access_job_history(job_id TEXT NOT NULL REFERENCES pi_access_jobs(job_id),revision INTEGER NOT NULL,
        payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,PRIMARY KEY(job_id,revision));
      CREATE TABLE pi_access_job_results(job_id TEXT PRIMARY KEY REFERENCES pi_access_jobs(job_id),provider TEXT NOT NULL CHECK(provider IN('openai-codex','anthropic')),
        profile_fingerprint TEXT NOT NULL,account_fingerprint TEXT,outcome TEXT NOT NULL CHECK(outcome IN('passed','failed','aborted','ambiguous')),
        checked_at TEXT NOT NULL,expires_at TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,
        completion_revision INTEGER NOT NULL CHECK(completion_revision>=0),completion_lease_hash TEXT NOT NULL,completion_request_hash TEXT NOT NULL);
      CREATE INDEX pi_access_receipt_lookup ON pi_access_job_results(provider,profile_fingerprint,account_fingerprint,checked_at DESC);
      CREATE TABLE pi_access_job_operations(principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('start','cancel')),
        request_hash TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,PRIMARY KEY(principal_id,idempotency_key));
      INSERT OR IGNORE INTO schema_version VALUES(20);COMMIT;`);
    }catch(error){try{database.exec('ROLLBACK');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  if(initialVersion===undefined||initialVersion<21){
    try{database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE run_preflight_jobs(
        job_id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
        principal_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('queued','running','cancel-requested','completed','failed','canceled','interrupted')),
        revision INTEGER NOT NULL CHECK(revision>=0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        configuration_revision INTEGER NOT NULL CHECK(configuration_revision>=0),configuration_hash TEXT NOT NULL,
        configuration_json TEXT NOT NULL,
        world_revision INTEGER NOT NULL CHECK(world_revision>=0),world_seq INTEGER NOT NULL CHECK(world_seq>=0),fictitious_at INTEGER NOT NULL,
        provider TEXT CHECK(provider IN('openai-codex','anthropic')),profile_fingerprint TEXT,
        result_kind TEXT CHECK(result_kind IN('passed','blocked','invalid')),safe_code TEXT,
        owner_token TEXT,claim_token TEXT,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,
        CHECK((owner_token IS NULL)=(claim_token IS NULL)),CHECK(state NOT IN('running','cancel-requested') OR owner_token IS NOT NULL));
      CREATE UNIQUE INDEX run_preflight_one_running ON run_preflight_jobs(run_id) WHERE state IN('running','cancel-requested');
      CREATE INDEX run_preflight_jobs_list ON run_preflight_jobs(run_id,created_at DESC,job_id DESC);
      CREATE TABLE run_preflight_job_history(job_id TEXT NOT NULL REFERENCES run_preflight_jobs(job_id),revision INTEGER NOT NULL,
        payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,PRIMARY KEY(job_id,revision));
      CREATE TABLE run_preflight_job_results(job_id TEXT PRIMARY KEY REFERENCES run_preflight_jobs(job_id),result_json TEXT NOT NULL,result_hash TEXT NOT NULL,
        evidence_json TEXT NOT NULL,evidence_hash TEXT NOT NULL,completion_revision INTEGER NOT NULL CHECK(completion_revision>=0),
        completion_lease_hash TEXT NOT NULL,completion_request_hash TEXT NOT NULL);
      CREATE TABLE run_preflight_job_operations(principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('start','cancel')),
        request_hash TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,PRIMARY KEY(principal_id,idempotency_key));
      INSERT OR IGNORE INTO schema_version VALUES(21);COMMIT;`);
    }catch(error){try{database.exec('ROLLBACK');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  if(initialVersion===undefined||initialVersion<22){
    try{database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE model_time_run_state(
        run_id TEXT PRIMARY KEY REFERENCES world_runs(run_id) ON DELETE RESTRICT,
        unknown_legacy_requests INTEGER NOT NULL DEFAULT 0 CHECK(unknown_legacy_requests>=0)
      );
      INSERT INTO model_time_run_state(run_id,unknown_legacy_requests)
        SELECT w.run_id,COUNT(r.request_seq) FROM world_runs w
        LEFT JOIN request_reservations r ON r.run_id=w.run_id AND r.state IN('dispatched','completed','ambiguous')
        WHERE json_valid(w.configuration_json)
          AND json_extract(w.configuration_json,'$.kind')='ready-run-configuration'
        GROUP BY w.run_id;
      CREATE TABLE model_time_spans(
        job_id TEXT NOT NULL,generation INTEGER NOT NULL,request_seq INTEGER NOT NULL,
        run_id TEXT NOT NULL REFERENCES run_budgets(run_id) ON DELETE RESTRICT,
        pulse_id TEXT NOT NULL REFERENCES pulses(pulse_id) ON DELETE RESTRICT,
        clock_epoch_id TEXT NOT NULL,owner_token TEXT NOT NULL,
        reserved_ms INTEGER NOT NULL CHECK(reserved_ms>0),
        state TEXT NOT NULL CHECK(state IN('reserved','running','expired','uncertain','settled','undispatched')),
        start_monotonic_ns TEXT,stop_monotonic_ns TEXT,measured_ms INTEGER CHECK(measured_ms IS NULL OR measured_ms>=0),
        expiry_reason TEXT CHECK(expiry_reason IN('timeout','cancelled','host-interrupted') OR expiry_reason IS NULL),
        settlement_hash TEXT,
        PRIMARY KEY(job_id,generation,request_seq),
        FOREIGN KEY(job_id,generation,request_seq) REFERENCES request_reservations(job_id,generation,request_seq) ON DELETE RESTRICT,
        CHECK((state IN('running','expired','uncertain','settled'))=(start_monotonic_ns IS NOT NULL)),
        CHECK((state='settled')=(stop_monotonic_ns IS NOT NULL)),
        CHECK((state='settled')=(measured_ms IS NOT NULL)),
        CHECK((state='settled')=(settlement_hash IS NOT NULL)),
        CHECK((state IN('expired','uncertain'))=(expiry_reason IS NOT NULL))
      );
      CREATE INDEX model_time_spans_run_state ON model_time_spans(run_id,state);
      INSERT OR IGNORE INTO schema_version VALUES(22);COMMIT;`);
    }catch(error){try{database.exec('ROLLBACK');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  if(initialVersion===undefined||initialVersion<23){
    try{
      const columns=database.prepare('PRAGMA table_info(world_runs)').all().map((value)=>z.object({name:z.string()}).parse(value).name);
      const addLifecycleRevision=columns.includes('lifecycle_revision')?'':'ALTER TABLE world_runs ADD COLUMN lifecycle_revision INTEGER NOT NULL DEFAULT 0 CHECK(lifecycle_revision>=0);';
      const addClosedAt=columns.includes('closed_at')?'':'ALTER TABLE world_runs ADD COLUMN closed_at INTEGER CHECK(closed_at IS NULL OR closed_at>=0);';
      database.exec(`BEGIN IMMEDIATE;
        ${addLifecycleRevision}
        ${addClosedAt}
        UPDATE world_runs SET closed_at=updated_at WHERE lifecycle='closed' AND closed_at IS NULL;
        CREATE TABLE IF NOT EXISTS run_control_operations(
          principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          command_kind TEXT NOT NULL CHECK(command_kind IN('start','pause','resume','stop','close')),
          request_hash TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,recorded_at INTEGER NOT NULL CHECK(recorded_at>=0),
          PRIMARY KEY(principal_id,idempotency_key));
        INSERT OR IGNORE INTO schema_version VALUES(23);COMMIT;`);
    }catch(error){try{database.exec('ROLLBACK');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  {
    try{
      const pulseColumns=database.prepare('PRAGMA table_info(coordinator_pulses)').all().map((value)=>z.object({name:z.string()}).parse(value).name);
      const jobColumns=database.prepare('PRAGMA table_info(actor_turn_jobs)').all().map((value)=>z.object({name:z.string()}).parse(value).name);
      const addPulseEpoch=pulseColumns.includes('lifecycle_revision')?'':'ALTER TABLE coordinator_pulses ADD COLUMN lifecycle_revision INTEGER CHECK(lifecycle_revision IS NULL OR lifecycle_revision>=0);';
      const addJobEpoch=jobColumns.includes('lifecycle_revision')?'':'ALTER TABLE actor_turn_jobs ADD COLUMN lifecycle_revision INTEGER CHECK(lifecycle_revision IS NULL OR lifecycle_revision>=0);';
      database.exec(`BEGIN IMMEDIATE;
        ${addPulseEpoch}
        ${addJobEpoch}
        UPDATE coordinator_pulses SET lifecycle_revision=(SELECT r.lifecycle_revision FROM world_runs r WHERE r.run_id=coordinator_pulses.run_id)
          WHERE lifecycle_revision IS NULL AND created_at>(SELECT r.updated_at FROM world_runs r WHERE r.run_id=coordinator_pulses.run_id);
        UPDATE actor_turn_jobs SET lifecycle_revision=(SELECT c.lifecycle_revision FROM coordinator_pulses c WHERE c.pulse_id=actor_turn_jobs.pulse_id)
          WHERE lifecycle_revision IS NULL AND EXISTS(SELECT 1 FROM coordinator_pulses c WHERE c.pulse_id=actor_turn_jobs.pulse_id AND c.lifecycle_revision IS NOT NULL);
        INSERT OR IGNORE INTO schema_version VALUES(24);COMMIT;`);
    }catch(error){try{database.exec('ROLLBACK');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  {
    try {
      const columns = database.prepare('PRAGMA table_info(world_runs)').all().map((value) => z.object({ name: z.string() }).parse(value).name);
      const addCreatedAt = columns.includes('created_at') ? '' : 'ALTER TABLE world_runs ADD COLUMN created_at INTEGER CHECK(created_at IS NULL OR created_at>=0);';
      database.exec(`BEGIN IMMEDIATE; ${addCreatedAt} INSERT OR IGNORE INTO schema_version VALUES(25); COMMIT;`);
    } catch (error) { try { database.exec('ROLLBACK'); } catch { /* Atomic migration. */ } database.close(); throw error; }
  }

  if (initialVersion === undefined || initialVersion < 26) {
    try {
      const preflightColumns = database.prepare('PRAGMA table_info(run_preflight_jobs)').all().map((value) => z.object({name:z.string()}).parse(value).name);
      const addPayloadHash = preflightColumns.includes('configuration_payload_hash') ? '' : 'ALTER TABLE run_preflight_jobs ADD COLUMN configuration_payload_hash TEXT;';
      const addOriginalConfiguration = preflightColumns.includes('original_configuration_json') ? '' : 'ALTER TABLE run_preflight_jobs ADD COLUMN original_configuration_json TEXT;';
      database.exec(`BEGIN IMMEDIATE;
        ${addPayloadHash}
        ${addOriginalConfiguration}
        UPDATE run_preflight_jobs SET original_configuration_json=configuration_json WHERE original_configuration_json IS NULL;
        UPDATE run_preflight_jobs SET configuration_payload_hash=configuration_hash WHERE configuration_payload_hash IS NULL;
        ALTER TABLE run_control_operations RENAME TO run_control_operations_v25;
        CREATE TABLE run_control_operations(
          principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          command_kind TEXT NOT NULL CHECK(command_kind IN('start','pause','resume','step','stop','close')),
          request_hash TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,recorded_at INTEGER NOT NULL CHECK(recorded_at>=0),
          PRIMARY KEY(principal_id,idempotency_key));
        INSERT INTO run_control_operations SELECT * FROM run_control_operations_v25;
        DROP TABLE run_control_operations_v25;
        CREATE TABLE IF NOT EXISTS run_step_jobs(
          job_id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          pulse_id TEXT REFERENCES coordinator_pulses(pulse_id) ON DELETE RESTRICT,
          state TEXT NOT NULL CHECK(state IN('queued','running','succeeded','failed','canceled','interrupted')),
          revision INTEGER NOT NULL CHECK(revision>=0),lifecycle_revision INTEGER NOT NULL CHECK(lifecycle_revision>=0),
          created_at INTEGER NOT NULL CHECK(created_at>=0),updated_at INTEGER NOT NULL CHECK(updated_at>=0));
        CREATE UNIQUE INDEX IF NOT EXISTS run_step_jobs_one_active ON run_step_jobs(run_id) WHERE state IN('queued','running');
        INSERT INTO schema_version VALUES(26); COMMIT;`);
    } catch (error) { try { database.exec('ROLLBACK'); } catch { /* Atomic migration. */ } database.close(); throw error; }
  }

  if (initialVersion === undefined || initialVersion < 27) {
    try { database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS administrative_jobs(
        job_id TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation>=0),run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
        pulse_id TEXT NOT NULL REFERENCES coordinator_pulses(pulse_id) ON DELETE RESTRICT,role TEXT NOT NULL CHECK(role IN('director','narrator','configurator')),
        lifecycle_revision INTEGER NOT NULL,world_revision INTEGER NOT NULL,through_world_seq INTEGER NOT NULL,
        context_json TEXT NOT NULL,context_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('running','accepted','blocked')),
        owner_token TEXT NOT NULL,claim_token TEXT NOT NULL,failure_code TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
        PRIMARY KEY(job_id,generation),UNIQUE(run_id,pulse_id,role,generation),CHECK((state='blocked')=(failure_code IS NOT NULL)));
      CREATE TABLE IF NOT EXISTS administrative_sessions(job_id TEXT NOT NULL,generation INTEGER NOT NULL,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,
        PRIMARY KEY(job_id,generation),FOREIGN KEY(job_id,generation) REFERENCES administrative_jobs(job_id,generation) ON DELETE RESTRICT);
      CREATE TABLE IF NOT EXISTS administrative_checkpoints(checkpoint_hash TEXT PRIMARY KEY,job_id TEXT NOT NULL,generation INTEGER NOT NULL,purpose_kind TEXT NOT NULL,
        request_seq INTEGER,payload_json TEXT NOT NULL,recorded_at INTEGER NOT NULL,
        FOREIGN KEY(job_id,generation) REFERENCES administrative_jobs(job_id,generation) ON DELETE RESTRICT);
      CREATE UNIQUE INDEX IF NOT EXISTS administrative_request_input ON administrative_checkpoints(job_id,generation,request_seq) WHERE purpose_kind='request-input';
      CREATE TABLE IF NOT EXISTS administrative_request_leases(job_id TEXT NOT NULL,generation INTEGER NOT NULL,request_seq INTEGER NOT NULL,execution_json TEXT NOT NULL,
        PRIMARY KEY(job_id,generation,request_seq),FOREIGN KEY(job_id,generation,request_seq) REFERENCES request_reservations(job_id,generation,request_seq) ON DELETE RESTRICT);
      CREATE TABLE IF NOT EXISTS director_candidates(candidate_hash TEXT PRIMARY KEY,job_id TEXT NOT NULL,generation INTEGER NOT NULL,payload_json TEXT NOT NULL,
        UNIQUE(job_id,generation),FOREIGN KEY(job_id,generation) REFERENCES administrative_jobs(job_id,generation) ON DELETE RESTRICT);
      CREATE TABLE IF NOT EXISTS director_annotations(annotation_id TEXT PRIMARY KEY,job_id TEXT NOT NULL,generation INTEGER NOT NULL,run_id TEXT NOT NULL,
        pulse_id TEXT NOT NULL,through_world_seq INTEGER NOT NULL,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,accepted_at INTEGER NOT NULL,
        UNIQUE(job_id,generation),FOREIGN KEY(job_id,generation) REFERENCES administrative_jobs(job_id,generation) ON DELETE RESTRICT);
      CREATE TABLE IF NOT EXISTS narration_candidates(candidate_hash TEXT PRIMARY KEY,job_id TEXT NOT NULL,generation INTEGER NOT NULL,payload_json TEXT NOT NULL,
        UNIQUE(job_id,generation),FOREIGN KEY(job_id,generation) REFERENCES administrative_jobs(job_id,generation) ON DELETE RESTRICT);
      CREATE TABLE IF NOT EXISTS narration_receipts(job_id TEXT NOT NULL,generation INTEGER NOT NULL,run_id TEXT NOT NULL,pulse_id TEXT NOT NULL,
        through_world_seq INTEGER NOT NULL,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,accepted_at INTEGER NOT NULL,
        PRIMARY KEY(job_id,generation),FOREIGN KEY(job_id,generation) REFERENCES administrative_jobs(job_id,generation) ON DELETE RESTRICT);
      INSERT INTO schema_version VALUES(27);COMMIT;`); }
    catch(error){try{database.exec('ROLLBACK');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  if (initialVersion === undefined || initialVersion < 28) {
    try { database.exec(`PRAGMA foreign_keys=OFF;BEGIN IMMEDIATE;
      CREATE TABLE administrative_jobs_v28(
        job_id TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation>=0),run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
        pulse_id TEXT NOT NULL REFERENCES coordinator_pulses(pulse_id) ON DELETE RESTRICT,role TEXT NOT NULL CHECK(role IN('director','narrator','configurator','narration-reviewer')),
        lifecycle_revision INTEGER NOT NULL,world_revision INTEGER NOT NULL,through_world_seq INTEGER NOT NULL,
        context_json TEXT NOT NULL,context_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('running','accepted','blocked')),
        owner_token TEXT NOT NULL,claim_token TEXT NOT NULL,failure_code TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
        PRIMARY KEY(job_id,generation),UNIQUE(run_id,pulse_id,role,generation),CHECK((state='blocked')=(failure_code IS NOT NULL)));
      INSERT INTO administrative_jobs_v28 SELECT * FROM administrative_jobs;
      DROP TABLE administrative_jobs;
      ALTER TABLE administrative_jobs_v28 RENAME TO administrative_jobs;
      CREATE TABLE IF NOT EXISTS legacy_narration_publications(job_id TEXT NOT NULL,generation INTEGER NOT NULL,payload_hash TEXT NOT NULL,
        PRIMARY KEY(job_id,generation),FOREIGN KEY(job_id,generation) REFERENCES narration_receipts(job_id,generation) ON DELETE RESTRICT);
      INSERT OR IGNORE INTO legacy_narration_publications SELECT job_id,generation,payload_hash FROM narration_receipts WHERE json_extract(payload_json,'$.kind')='published';
      CREATE TABLE IF NOT EXISTS administrative_checkpoint_integrity(checkpoint_hash TEXT PRIMARY KEY REFERENCES administrative_checkpoints(checkpoint_hash) ON DELETE RESTRICT,
        prefix_hash TEXT NOT NULL,file_hash TEXT NOT NULL,byte_length INTEGER NOT NULL CHECK(byte_length>0));
      CREATE TABLE IF NOT EXISTS narration_review_candidates(candidate_hash TEXT PRIMARY KEY,job_id TEXT NOT NULL,generation INTEGER NOT NULL,
        payload_json TEXT NOT NULL,UNIQUE(job_id,generation),
        FOREIGN KEY(job_id,generation) REFERENCES administrative_jobs(job_id,generation) ON DELETE RESTRICT);
      CREATE TABLE IF NOT EXISTS narration_review_receipts(job_id TEXT NOT NULL,generation INTEGER NOT NULL,parent_job_id TEXT NOT NULL,parent_generation INTEGER NOT NULL,
        payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,accepted_at INTEGER NOT NULL,
        PRIMARY KEY(job_id,generation),UNIQUE(parent_job_id,parent_generation),
        FOREIGN KEY(job_id,generation) REFERENCES administrative_jobs(job_id,generation) ON DELETE RESTRICT,
        FOREIGN KEY(parent_job_id,parent_generation) REFERENCES administrative_jobs(job_id,generation) ON DELETE RESTRICT);
      CREATE INDEX IF NOT EXISTS narration_publication_lookup ON narration_receipts(run_id,json_extract(payload_json,'$.publication.publicationId'));
      CREATE INDEX IF NOT EXISTS narration_publication_page ON narration_receipts(run_id,accepted_at,json_extract(payload_json,'$.publication.publicationId'));
      INSERT INTO schema_version VALUES(28);COMMIT;PRAGMA foreign_keys=ON;`); }
    catch(error){try{database.exec('ROLLBACK;PRAGMA foreign_keys=ON;');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  if (initialVersion === undefined || initialVersion < 29) {
    const worldRunColumns=database.prepare('PRAGMA table_info(world_runs)').all().map((value)=>z.object({name:z.string()}).parse(value).name);
    const addStructureRevision=worldRunColumns.includes('structure_revision')?'':'ALTER TABLE world_runs ADD COLUMN structure_revision INTEGER NOT NULL DEFAULT 0 CHECK(structure_revision>=0);';
    try { database.exec(`BEGIN IMMEDIATE;${addStructureRevision}
      CREATE TABLE IF NOT EXISTS episodes(
        run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
        episode_id TEXT NOT NULL,ordinal INTEGER NOT NULL CHECK(ordinal>=1),title TEXT,
        lifecycle TEXT NOT NULL CHECK(lifecycle IN('open','closed')),
        opening_cut_json TEXT NOT NULL,opening_cut_hash TEXT NOT NULL,
        closing_cut_json TEXT,closing_cut_hash TEXT,
        consequence_event_ids_json TEXT NOT NULL,open_lines_json TEXT NOT NULL,
        PRIMARY KEY(run_id,episode_id),UNIQUE(run_id,ordinal),
        CHECK((lifecycle='open' AND closing_cut_json IS NULL AND closing_cut_hash IS NULL)
          OR (lifecycle='closed' AND closing_cut_json IS NOT NULL AND closing_cut_hash IS NOT NULL))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS episodes_one_open ON episodes(run_id) WHERE lifecycle='open';
      CREATE TABLE IF NOT EXISTS episode_scenes(
        run_id TEXT NOT NULL,episode_id TEXT NOT NULL,scene_id TEXT NOT NULL,ordinal INTEGER NOT NULL CHECK(ordinal>=1),
        PRIMARY KEY(run_id,episode_id,scene_id),UNIQUE(run_id,scene_id),UNIQUE(run_id,episode_id,ordinal),
        FOREIGN KEY(run_id,episode_id) REFERENCES episodes(run_id,episode_id) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS acts(
        run_id TEXT NOT NULL,episode_id TEXT NOT NULL,act_id TEXT NOT NULL,ordinal INTEGER NOT NULL CHECK(ordinal>=1),title TEXT NOT NULL,
        PRIMARY KEY(run_id,episode_id,act_id),UNIQUE(run_id,episode_id,ordinal),
        FOREIGN KEY(run_id,episode_id) REFERENCES episodes(run_id,episode_id) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS act_scenes(
        run_id TEXT NOT NULL,episode_id TEXT NOT NULL,act_id TEXT NOT NULL,scene_id TEXT NOT NULL,ordinal INTEGER NOT NULL CHECK(ordinal>=1),
        PRIMARY KEY(run_id,episode_id,act_id,scene_id),UNIQUE(run_id,episode_id,scene_id),UNIQUE(run_id,episode_id,act_id,ordinal),
        FOREIGN KEY(run_id,episode_id,act_id) REFERENCES acts(run_id,episode_id,act_id) ON DELETE RESTRICT,
        FOREIGN KEY(run_id,episode_id,scene_id) REFERENCES episode_scenes(run_id,episode_id,scene_id) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS structure_events(
        run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
        structure_revision INTEGER NOT NULL CHECK(structure_revision>0),operation_id TEXT NOT NULL UNIQUE,
        principal_id TEXT NOT NULL,event_kind TEXT NOT NULL CHECK(event_kind IN('episodeOpened','episodeClosed','sceneOpened','sceneClosed','actsSet')),
        payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,
        world_revision INTEGER NOT NULL CHECK(world_revision>=0),world_seq INTEGER NOT NULL CHECK(world_seq>=0),
        commit_index INTEGER NOT NULL CHECK(commit_index>0),recorded_at INTEGER NOT NULL CHECK(recorded_at>=0),
        PRIMARY KEY(run_id,structure_revision),UNIQUE(run_id,commit_index),
        FOREIGN KEY(run_id,commit_index) REFERENCES world_commits(run_id,commit_index) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS structure_operations(
        run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,
        operation_id TEXT NOT NULL,operation_kind TEXT NOT NULL CHECK(operation_kind IN('openEpisode','closeEpisode','openScene','closeScene','setEpisodeActs')),
        request_hash TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,recorded_at INTEGER NOT NULL CHECK(recorded_at>=0),
        PRIMARY KEY(run_id,principal_id,idempotency_key),UNIQUE(run_id,operation_id)
      );
      CREATE INDEX IF NOT EXISTS structure_events_history ON structure_events(run_id,commit_index);
      INSERT OR IGNORE INTO schema_version VALUES(29);COMMIT;`); }
    catch(error){try{database.exec('ROLLBACK');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  if (initialVersion === undefined || initialVersion < 30) {
    const worldRunColumns=database.prepare('PRAGMA table_info(world_runs)').all().map((value)=>z.object({name:z.string()}).parse(value).name);
    const jobColumns=database.prepare('PRAGMA table_info(actor_turn_jobs)').all().map((value)=>z.object({name:z.string()}).parse(value).name);
    const addDirectionRevision=worldRunColumns.includes('direction_revision')?'':'ALTER TABLE world_runs ADD COLUMN direction_revision INTEGER NOT NULL DEFAULT 0 CHECK(direction_revision>=0);';
    const addFrozenDirectionRevision=jobColumns.includes('frozen_direction_revision')?'':'ALTER TABLE actor_turn_jobs ADD COLUMN frozen_direction_revision INTEGER CHECK(frozen_direction_revision IS NULL OR frozen_direction_revision>=0);';
    try { database.exec(`BEGIN IMMEDIATE;${addDirectionRevision}${addFrozenDirectionRevision}
      CREATE TABLE IF NOT EXISTS direction_events(
        run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
        direction_revision INTEGER NOT NULL CHECK(direction_revision>0),operation_id TEXT NOT NULL UNIQUE,
        principal_id TEXT NOT NULL,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,
        world_revision INTEGER NOT NULL CHECK(world_revision>=0),world_seq INTEGER NOT NULL CHECK(world_seq>=0),
        commit_index INTEGER NOT NULL CHECK(commit_index>=0),recorded_at INTEGER NOT NULL CHECK(recorded_at>=0),
        PRIMARY KEY(run_id,direction_revision)
      );
      CREATE TABLE IF NOT EXISTS direction_operations(
        run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,
        operation_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,
        recorded_at INTEGER NOT NULL CHECK(recorded_at>=0),PRIMARY KEY(run_id,principal_id,idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS direction_events_recipient ON direction_events(run_id,direction_revision);
      INSERT OR IGNORE INTO schema_version VALUES(30);COMMIT;`); }
    catch(error){try{database.exec('ROLLBACK');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  if (initialVersion === undefined || initialVersion < 31) {
    try {
      database.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
        CREATE TABLE coordinator_pulses_v31(
          pulse_id TEXT PRIMARY KEY REFERENCES pulses(pulse_id) ON DELETE RESTRICT,
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          origin_kind TEXT NOT NULL CHECK(origin_kind IN('humanIntervention','actorAttempt','actorActivation')),
          origin_id TEXT NOT NULL,commit_index INTEGER CHECK(commit_index IS NULL OR commit_index>=1),
          configuration_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('running','completed','blocked')),
          created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,lifecycle_revision INTEGER CHECK(lifecycle_revision IS NULL OR lifecycle_revision>=0),
          UNIQUE(run_id,origin_kind,origin_id),
          FOREIGN KEY(run_id,commit_index) REFERENCES world_commits(run_id,commit_index) ON DELETE RESTRICT,
          CHECK((origin_kind='actorActivation' AND commit_index IS NULL) OR (origin_kind<>'actorActivation' AND commit_index IS NOT NULL))
        );
        INSERT INTO coordinator_pulses_v31 SELECT pulse_id,run_id,origin_kind,origin_id,commit_index,configuration_hash,state,created_at,updated_at,lifecycle_revision
          FROM coordinator_pulses;
        DROP TABLE coordinator_pulses;
        ALTER TABLE coordinator_pulses_v31 RENAME TO coordinator_pulses;
        CREATE UNIQUE INDEX coordinator_pulses_one_running ON coordinator_pulses(run_id) WHERE state='running';
        CREATE TABLE IF NOT EXISTS actor_activation_causes(
          activation_id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          trigger_kind TEXT NOT NULL CHECK(trigger_kind='initial-goal'),
          configuration_hash TEXT NOT NULL,lifecycle_revision INTEGER NOT NULL CHECK(lifecycle_revision>=0),
          world_revision INTEGER NOT NULL CHECK(world_revision>=0),world_seq INTEGER NOT NULL CHECK(world_seq>=0),fictional_at INTEGER NOT NULL CHECK(fictional_at>=0),
          state TEXT NOT NULL CHECK(state IN('pending','running','completed','blocked')),
          failure_reason TEXT,created_at INTEGER NOT NULL CHECK(created_at>=0),updated_at INTEGER NOT NULL CHECK(updated_at>=0),
          UNIQUE(run_id,trigger_kind),UNIQUE(run_id,activation_id),
          CHECK((state='blocked')=(failure_reason IS NOT NULL))
        );
        CREATE TABLE IF NOT EXISTS actor_activation_invitations(
          invitation_id TEXT PRIMARY KEY,activation_id TEXT NOT NULL,run_id TEXT NOT NULL,actor_id TEXT NOT NULL,
          identity_version INTEGER NOT NULL CHECK(identity_version>=0),trigger_kind TEXT NOT NULL CHECK(trigger_kind='initial-goal'),
          state TEXT NOT NULL CHECK(state IN('pending','assigned','consumed','blocked')),
          failure_reason TEXT,created_at INTEGER NOT NULL CHECK(created_at>=0),updated_at INTEGER NOT NULL CHECK(updated_at>=0),
          UNIQUE(activation_id,actor_id),UNIQUE(run_id,invitation_id),
          FOREIGN KEY(run_id,activation_id) REFERENCES actor_activation_causes(run_id,activation_id) ON DELETE RESTRICT,
          CHECK((state='blocked')=(failure_reason IS NOT NULL))
        );
        CREATE TABLE IF NOT EXISTS actor_activation_invitation_jobs(
          run_id TEXT NOT NULL,invitation_id TEXT NOT NULL,actor_id TEXT NOT NULL,job_id TEXT NOT NULL,
          generation INTEGER NOT NULL CHECK(generation>=0),assigned_at INTEGER NOT NULL CHECK(assigned_at>=0),
          PRIMARY KEY(run_id,invitation_id),UNIQUE(run_id,actor_id,job_id,generation),
          FOREIGN KEY(run_id,invitation_id) REFERENCES actor_activation_invitations(run_id,invitation_id) ON DELETE RESTRICT,
          FOREIGN KEY(run_id,actor_id,job_id,generation) REFERENCES actor_turn_jobs(run_id,actor_id,job_id,generation) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS actor_activation_causes_pending ON actor_activation_causes(run_id,state,created_at);
        CREATE INDEX IF NOT EXISTS actor_activation_invitations_pending ON actor_activation_invitations(activation_id,state,actor_id);
        INSERT OR IGNORE INTO schema_version VALUES(31);
      `);
      const foreignKeyViolations = database.prepare('PRAGMA foreign_key_check').all();
      if (foreignKeyViolations.length !== 0) {
        throw new Error(`Migración v31 produjo referencias inválidas: ${JSON.stringify(foreignKeyViolations)}`);
      }
      database.exec('COMMIT; PRAGMA foreign_keys=ON;');
    } catch (error) {
      try { database.exec('ROLLBACK; PRAGMA foreign_keys=ON;'); } catch { /* Migration is atomic. */ }
      database.close(); throw error;
    }
  }

  if (initialVersion === undefined || initialVersion < 32) {
    try {
      database.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
        CREATE TABLE actor_activation_causes_v32(
          activation_id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          trigger_kind TEXT NOT NULL CHECK(trigger_kind IN('initial-goal','routine-boundary')),
          boundary_at INTEGER CHECK(boundary_at IS NULL OR boundary_at>=0),activation_key TEXT NOT NULL,
          configuration_hash TEXT NOT NULL,lifecycle_revision INTEGER NOT NULL CHECK(lifecycle_revision>=0),
          world_revision INTEGER NOT NULL CHECK(world_revision>=0),world_seq INTEGER NOT NULL CHECK(world_seq>=0),fictional_at INTEGER NOT NULL CHECK(fictional_at>=0),
          state TEXT NOT NULL CHECK(state IN('pending','running','completed','blocked')),
          failure_reason TEXT,created_at INTEGER NOT NULL CHECK(created_at>=0),updated_at INTEGER NOT NULL CHECK(updated_at>=0),
          UNIQUE(run_id,activation_key),UNIQUE(run_id,activation_id),
          CHECK((trigger_kind='initial-goal' AND boundary_at IS NULL AND activation_key='initial-goal') OR
            (trigger_kind='routine-boundary' AND boundary_at IS NOT NULL AND activation_key='routine:'||boundary_at)),
          CHECK((state='blocked')=(failure_reason IS NOT NULL))
        );
        INSERT INTO actor_activation_causes_v32 SELECT activation_id,run_id,trigger_kind,NULL,'initial-goal',configuration_hash,
          lifecycle_revision,world_revision,world_seq,fictional_at,state,failure_reason,created_at,updated_at FROM actor_activation_causes;
        CREATE TABLE actor_activation_invitations_v32(
          invitation_id TEXT PRIMARY KEY,activation_id TEXT NOT NULL,run_id TEXT NOT NULL,actor_id TEXT NOT NULL,
          identity_version INTEGER NOT NULL CHECK(identity_version>=0),trigger_kind TEXT NOT NULL CHECK(trigger_kind IN('initial-goal','routine-boundary')),
          boundary_at INTEGER CHECK(boundary_at IS NULL OR boundary_at>=0),
          state TEXT NOT NULL CHECK(state IN('pending','assigned','consumed','blocked')),
          failure_reason TEXT,created_at INTEGER NOT NULL CHECK(created_at>=0),updated_at INTEGER NOT NULL CHECK(updated_at>=0),
          UNIQUE(activation_id,actor_id),UNIQUE(run_id,invitation_id),
          FOREIGN KEY(run_id,activation_id) REFERENCES actor_activation_causes_v32(run_id,activation_id) ON DELETE RESTRICT,
          CHECK((trigger_kind='initial-goal' AND boundary_at IS NULL) OR (trigger_kind='routine-boundary' AND boundary_at IS NOT NULL)),
          CHECK((state='blocked')=(failure_reason IS NOT NULL))
        );
        INSERT INTO actor_activation_invitations_v32 SELECT invitation_id,activation_id,run_id,actor_id,identity_version,
          trigger_kind,NULL,state,failure_reason,created_at,updated_at FROM actor_activation_invitations;
        CREATE TABLE actor_activation_invitation_jobs_v32(
          run_id TEXT NOT NULL,invitation_id TEXT NOT NULL,actor_id TEXT NOT NULL,job_id TEXT NOT NULL,
          generation INTEGER NOT NULL CHECK(generation>=0),assigned_at INTEGER NOT NULL CHECK(assigned_at>=0),
          PRIMARY KEY(run_id,invitation_id),UNIQUE(run_id,actor_id,job_id,generation),
          FOREIGN KEY(run_id,invitation_id) REFERENCES actor_activation_invitations_v32(run_id,invitation_id) ON DELETE RESTRICT,
          FOREIGN KEY(run_id,actor_id,job_id,generation) REFERENCES actor_turn_jobs(run_id,actor_id,job_id,generation) ON DELETE RESTRICT
        );
        INSERT INTO actor_activation_invitation_jobs_v32 SELECT run_id,invitation_id,actor_id,job_id,generation,assigned_at
          FROM actor_activation_invitation_jobs;
        DROP TABLE actor_activation_invitation_jobs;
        DROP TABLE actor_activation_invitations;
        DROP TABLE actor_activation_causes;
        ALTER TABLE actor_activation_causes_v32 RENAME TO actor_activation_causes;
        ALTER TABLE actor_activation_invitations_v32 RENAME TO actor_activation_invitations;
        ALTER TABLE actor_activation_invitation_jobs_v32 RENAME TO actor_activation_invitation_jobs;
        CREATE INDEX actor_activation_causes_pending ON actor_activation_causes(run_id,state,created_at);
        CREATE INDEX actor_activation_invitations_pending ON actor_activation_invitations(activation_id,state,actor_id);
        CREATE TABLE routine_clock_advances(
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,operation_id TEXT NOT NULL,
          request_hash TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,
          from_revision INTEGER NOT NULL CHECK(from_revision>=0),to_revision INTEGER NOT NULL CHECK(to_revision>from_revision),
          from_at INTEGER NOT NULL CHECK(from_at>=0),to_at INTEGER NOT NULL CHECK(to_at>from_at),
          event_id TEXT NOT NULL UNIQUE,commit_index INTEGER NOT NULL CHECK(commit_index>0),created_at INTEGER NOT NULL CHECK(created_at>=0),
          PRIMARY KEY(run_id,operation_id),UNIQUE(run_id,from_revision,to_revision),UNIQUE(run_id,commit_index),
          FOREIGN KEY(run_id,commit_index) REFERENCES world_commits(run_id,commit_index) ON DELETE RESTRICT
        );
        INSERT OR IGNORE INTO schema_version VALUES(32);
      `);
      const foreignKeyViolations = database.prepare('PRAGMA foreign_key_check').all();
      if (foreignKeyViolations.length !== 0) throw new Error(`Migración v32 produjo referencias inválidas: ${JSON.stringify(foreignKeyViolations)}`);
      database.exec('COMMIT; PRAGMA foreign_keys=ON;');
    } catch (error) {
      try { database.exec('ROLLBACK; PRAGMA foreign_keys=ON;'); } catch { /* Migration is atomic. */ }
      database.close(); throw error;
    }
  }

  if (initialVersion === undefined || initialVersion < 33) {
    try {
      database.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
        CREATE TABLE coordinator_pulses_v33(
          pulse_id TEXT PRIMARY KEY REFERENCES pulses(pulse_id) ON DELETE RESTRICT,
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          origin_kind TEXT NOT NULL CHECK(origin_kind IN('humanIntervention','actorAttempt','directionCircumstance','actorActivation')),
          origin_id TEXT NOT NULL,commit_index INTEGER CHECK(commit_index IS NULL OR commit_index>=1),
          configuration_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('running','completed','blocked')),
          created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,lifecycle_revision INTEGER CHECK(lifecycle_revision IS NULL OR lifecycle_revision>=0),
          UNIQUE(run_id,origin_kind,origin_id),
          FOREIGN KEY(run_id,commit_index) REFERENCES world_commits(run_id,commit_index) ON DELETE RESTRICT,
          CHECK((origin_kind='actorActivation' AND commit_index IS NULL) OR (origin_kind<>'actorActivation' AND commit_index IS NOT NULL))
        );
        INSERT INTO coordinator_pulses_v33 SELECT pulse_id,run_id,origin_kind,origin_id,commit_index,configuration_hash,state,created_at,updated_at,lifecycle_revision
          FROM coordinator_pulses;
        DROP TABLE coordinator_pulses;
        ALTER TABLE coordinator_pulses_v33 RENAME TO coordinator_pulses;
        CREATE UNIQUE INDEX coordinator_pulses_one_running ON coordinator_pulses(run_id) WHERE state='running';
        CREATE TABLE circumstance_operations(
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,operation_id TEXT NOT NULL UNIQUE,
          request_hash TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,
          recorded_at INTEGER NOT NULL CHECK(recorded_at>=0),PRIMARY KEY(run_id,principal_id,idempotency_key)
        );
        INSERT OR IGNORE INTO schema_version VALUES(33);
      `);
      const foreignKeyViolations = database.prepare('PRAGMA foreign_key_check').all();
      if (foreignKeyViolations.length !== 0) throw new Error(`Migración v33 produjo referencias inválidas: ${JSON.stringify(foreignKeyViolations)}`);
      database.exec('COMMIT; PRAGMA foreign_keys=ON;');
    } catch (error) {
      try { database.exec('ROLLBACK; PRAGMA foreign_keys=ON;'); } catch { /* Migration is atomic. */ }
      database.close(); throw error;
    }
  }

  if (!database.prepare('SELECT 1 FROM schema_version WHERE version=34').get()) {
    try { database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE actor_state_cut_batches(
        run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
        commit_index INTEGER NOT NULL CHECK(commit_index>=0),
        manifest_json TEXT NOT NULL,manifest_hash TEXT NOT NULL,
        PRIMARY KEY(run_id,commit_index)
      );
      CREATE TABLE actor_state_cuts(
        run_id TEXT NOT NULL,commit_index INTEGER NOT NULL,actor_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,
        PRIMARY KEY(run_id,commit_index,actor_id),
        FOREIGN KEY(run_id,commit_index) REFERENCES actor_state_cut_batches(run_id,commit_index) ON DELETE CASCADE
      );
      INSERT INTO schema_version VALUES(34);
      COMMIT;
    `); } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* Migration is atomic. */ }
      database.close(); throw error;
    }
  }

  if (!database.prepare('SELECT 1 FROM schema_version WHERE version=35').get()) {
    try { database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE fork_jobs(
        operation_id TEXT PRIMARY KEY,principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,
        target_run_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN('staging','ready','failed')),
        request_hash TEXT NOT NULL,job_json TEXT NOT NULL,job_hash TEXT NOT NULL,
        package_json TEXT NOT NULL,package_hash TEXT NOT NULL,artifacts_json TEXT,artifacts_hash TEXT,
        UNIQUE(principal_id,idempotency_key)
      );
      CREATE TABLE fork_job_history(
        operation_id TEXT NOT NULL REFERENCES fork_jobs(operation_id) ON DELETE RESTRICT,
        revision INTEGER NOT NULL CHECK(revision>=0),payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,
        PRIMARY KEY(operation_id,revision)
      );
      CREATE TABLE fork_projection_receipts(
        operation_id TEXT NOT NULL REFERENCES fork_jobs(operation_id) ON DELETE RESTRICT,
        experience_id TEXT NOT NULL,actor_id TEXT NOT NULL,memory_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,
        PRIMARY KEY(operation_id,experience_id),UNIQUE(operation_id,actor_id,memory_id)
      );
      CREATE TABLE fork_dramatic_seeds(
        run_id TEXT PRIMARY KEY REFERENCES world_runs(run_id) ON DELETE RESTRICT,
        payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL
      );
      INSERT INTO schema_version VALUES(35);COMMIT;
    `); } catch(error) {try{database.exec('ROLLBACK');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  if (!database.prepare('SELECT 1 FROM schema_version WHERE version=36').get()) {
    try {database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE fork_job_retries(
        principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,operation_id TEXT NOT NULL,
        expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),request_hash TEXT NOT NULL,
        result_json TEXT NOT NULL,result_hash TEXT NOT NULL,
        PRIMARY KEY(principal_id,idempotency_key)
      );
      INSERT INTO schema_version VALUES(36);COMMIT;
    `);}catch(error){try{database.exec('ROLLBACK');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  if (!database.prepare('SELECT 1 FROM schema_version WHERE version=37').get()) {
    try{database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE fork_backup_sources(
        operation_id TEXT PRIMARY KEY REFERENCES fork_jobs(operation_id) ON DELETE RESTRICT,
        source_json TEXT NOT NULL,source_hash TEXT NOT NULL
      );
      INSERT INTO schema_version VALUES(37);COMMIT;
    `);}catch(error){try{database.exec('ROLLBACK');}catch{/* Atomic migration. */}database.close();throw error;}
  }

  if (!database.prepare('SELECT 1 FROM schema_version WHERE version=38').get()) {
    try { database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE run_configuration_revisions(
        run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
        effective_commit_index INTEGER NOT NULL CHECK(effective_commit_index>=0),
        configuration_revision INTEGER NOT NULL CHECK(configuration_revision>=0),
        configuration_json TEXT NOT NULL,configuration_hash TEXT NOT NULL,
        continuity_fence_json TEXT NOT NULL,continuity_fence_hash TEXT NOT NULL,
        activation_snapshot_hash TEXT NOT NULL,record_hash TEXT NOT NULL,
        PRIMARY KEY(run_id,effective_commit_index),UNIQUE(run_id,configuration_revision)
      );
      CREATE TRIGGER run_configuration_revisions_no_update BEFORE UPDATE ON run_configuration_revisions
        BEGIN SELECT RAISE(ABORT,'CONFIGURATION_HISTORY_APPEND_ONLY');END;
      CREATE TRIGGER run_configuration_revisions_no_delete BEFORE DELETE ON run_configuration_revisions
        BEGIN SELECT RAISE(ABORT,'CONFIGURATION_HISTORY_APPEND_ONLY');END;
      INSERT INTO schema_version VALUES(38);COMMIT;
    `); } catch(error) { try {database.exec('ROLLBACK');} catch {/* Atomic migration. */} database.close();throw error; }
  }

  if(!database.prepare('SELECT 1 FROM schema_version WHERE version=39').get()){
    try{database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE actor_identity_epochs(run_id TEXT NOT NULL REFERENCES world_runs(run_id),actor_id TEXT NOT NULL,epoch_index INTEGER NOT NULL CHECK(epoch_index>=0),payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,PRIMARY KEY(run_id,actor_id,epoch_index));
      CREATE TABLE actor_identity_session_bindings(run_id TEXT NOT NULL,actor_id TEXT NOT NULL,epoch_index INTEGER NOT NULL,binding_index INTEGER NOT NULL CHECK(binding_index>=0),session_id TEXT NOT NULL UNIQUE,session_path TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,PRIMARY KEY(run_id,actor_id,epoch_index,binding_index),FOREIGN KEY(run_id,actor_id,epoch_index) REFERENCES actor_identity_epochs(run_id,actor_id,epoch_index));
      CREATE TABLE actor_pi_session_archives(run_id TEXT NOT NULL,actor_id TEXT NOT NULL,epoch_index INTEGER NOT NULL,session_id TEXT NOT NULL UNIQUE,session_path TEXT NOT NULL UNIQUE,row_json TEXT NOT NULL,row_hash TEXT NOT NULL,PRIMARY KEY(run_id,actor_id,epoch_index),FOREIGN KEY(run_id,actor_id,epoch_index) REFERENCES actor_identity_epochs(run_id,actor_id,epoch_index));
      CREATE TABLE actor_job_identity_bindings(run_id TEXT NOT NULL,actor_id TEXT NOT NULL,job_id TEXT NOT NULL,generation INTEGER NOT NULL,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,PRIMARY KEY(run_id,actor_id,job_id,generation),FOREIGN KEY(run_id,actor_id,job_id,generation) REFERENCES actor_turn_jobs(run_id,actor_id,job_id,generation));
      CREATE TABLE identity_promotion_receipts(principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,operation_id TEXT NOT NULL UNIQUE,run_id TEXT NOT NULL REFERENCES world_runs(run_id),actor_id TEXT NOT NULL,request_json TEXT NOT NULL,request_hash TEXT NOT NULL,plan_json TEXT NOT NULL,plan_hash TEXT NOT NULL,receipt_json TEXT NOT NULL,receipt_hash TEXT NOT NULL,PRIMARY KEY(principal_id,idempotency_key));
    `);
    database.exec(CONFIGURATOR_JOB_SCHEMA_SQL);
    for(const table of ['actor_identity_epochs','actor_identity_session_bindings','actor_pi_session_archives','actor_job_identity_bindings','identity_promotion_receipts'])database.exec(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'IDENTITY_HISTORY_APPEND_ONLY');END;CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'IDENTITY_HISTORY_APPEND_ONLY');END;`);
    database.exec('INSERT INTO schema_version VALUES(39);COMMIT');
    }catch(error){try{database.exec('ROLLBACK');}catch{/* Atomic migration. */}database.close();throw error;}
  }
  let identityPromotionPorts:IdentityPromotionPorts|undefined;

  const pendingInitialActorCuts = new Set<string>();
  const ActorStateCutManifestSchema = z.strictObject({
    source: ActorStateCutSchema.shape.source,
    actors: z.array(z.strictObject({ actorId: CharacterIdSchema, cutHash: HashSchema })),
  });

  const ConfigurationRevisionRowSchema=z.strictObject({
    run_id:RunIdSchema,effective_commit_index:counter,configuration_revision:RevisionSchema,
    configuration_json:z.string(),configuration_hash:HashSchema,
    continuity_fence_json:z.string(),continuity_fence_hash:HashSchema,
    activation_snapshot_hash:HashSchema,record_hash:HashSchema,
  });
  const ConfigurationAtCommitRequestSchema=z.strictObject({runId:RunIdSchema,commitIndex:counter});
  const ConfigurationAtCommitReadResultSchema=z.discriminatedUnion('kind',[
    z.strictObject({kind:z.literal('found'),configuration:z.unknown(),configurationRevision:RevisionSchema,configurationHash:HashSchema,
      effectiveCommitIndex:counter,provenance:z.enum(['original','revision']),continuityFence:WorldContinuityFenceSchema}),
    z.strictObject({kind:z.literal('missing')}),
    z.strictObject({kind:z.literal('unavailable'),reason:z.literal('invalid-configuration')}),
  ]);

  function snapshotAtExactConfigurationCommit(run:ReturnType<typeof parseWorldRun>,commitIndex:number) {
    if(commitIndex===0){
      if(canonicalJson(run.initialSnapshot)!==run.row.initial_snapshot_json||sha256(run.row.initial_snapshot_json)!==run.row.initial_snapshot_hash)
        throw new Error('Snapshot inicial del corte privado inválido');
      return {snapshot:run.initialSnapshot,snapshotHash:run.row.initial_snapshot_hash};
    }
    const value=database.prepare('SELECT snapshot_json,snapshot_hash,world_revision,last_seq FROM world_commits WHERE run_id=? AND commit_index=?').get(run.row.run_id,commitIndex);
    if(value===undefined)throw new Error('Commit del corte privado inexistente');
    const row=z.strictObject({snapshot_json:z.string(),snapshot_hash:HashSchema,world_revision:RevisionSchema,last_seq:WorldSeqSchema}).parse(value);
    const snapshot=WorldSnapshotSchema.parse(parseStoredJson(row.snapshot_json));
    if(canonicalJson(snapshot)!==row.snapshot_json||sha256(row.snapshot_json)!==row.snapshot_hash
      ||snapshot.runId!==run.row.run_id||snapshot.revision!==row.world_revision||snapshot.seq!==row.last_seq)
      throw new Error('Snapshot del corte privado inválido');
    return {snapshot,snapshotHash:row.snapshot_hash};
  }

  // No mutation API: a future trusted promotion must archive the exact original
  // bytes at commit zero before replacing the world_runs head, in the same TX.
  function configurationAtCommit(run:ReturnType<typeof parseWorldRun>,commitIndex:number){
    snapshotAtExactConfigurationCommit(run,commitIndex);
    const rows=database.prepare('SELECT * FROM run_configuration_revisions WHERE run_id=? ORDER BY effective_commit_index').all(run.row.run_id).map(value=>ConfigurationRevisionRowSchema.parse(value));
    if(rows.length===0)return {configuration:run.configuration,fence:run.fence,configurationRevision:run.row.config_revision,
      configurationHash:run.row.configuration_hash,effectiveCommitIndex:0,provenance:'original' as const,activationSnapshot:run.initialSnapshot};
    let selected:typeof rows[number]|undefined;let previous:typeof rows[number]|undefined;
    for(const row of rows){
      const {record_hash,...record}=row;
      if(hashJson(record).hash!==record_hash||sha256(row.configuration_json)!==row.configuration_hash
        ||sha256(row.continuity_fence_json)!==row.continuity_fence_hash
        ||(previous===undefined?row.effective_commit_index!==0:row.configuration_revision!==previous.configuration_revision+1)
        ||row.effective_commit_index>run.row.commit_index)throw new Error('Historial de configuración inválido');
      const activation=snapshotAtExactConfigurationCommit(run,row.effective_commit_index);
      const configuration=parseStoredJson(row.configuration_json);
      const fence=WorldContinuityFenceSchema.parse(parseStoredJson(row.continuity_fence_json));
      if(hashJson(configuration).json!==row.configuration_json||canonicalJson(fence)!==row.continuity_fence_json
        ||activation.snapshotHash!==row.activation_snapshot_hash||fence.atWorldSeq!==activation.snapshot.seq
        ||new Set(fence.contexts.map(context=>context.actorId)).size!==fence.contexts.length)
        throw new Error('Anclaje de configuración inválido');
      const ready=ReadyRunConfigurationSchema.safeParse(configuration);
      if(row.effective_commit_index>0&&!ready.success)throw new Error('Revisión efectiva requiere configuración Ready completa');
      if(ready.success&&(ready.data.runId!==run.row.run_id||ready.data.configRevision!==row.configuration_revision
        ||canonicalJson(ready.data.worldSnapshot)!==canonicalJson(activation.snapshot)))throw new Error('Configuración Ready fuera de su activación');
      if(ready.success)for(const context of fence.contexts){
        const prepared=ready.data.roster.preparedCharacters.find(actor=>actor.characterId===context.actorId);
        const actor=activation.snapshot.entities.find(entity=>entity.kind==='character'&&entity.characterId===context.actorId);
        if(prepared===undefined||prepared.identityVersion!==context.identityVersion||hashJson(prepared).hash!==context.preparedContextHash
          ||prepared.continuity.continuityId!==context.continuityId||prepared.continuity.revision!==context.continuityRevision
          ||prepared.continuity.contentHash!==context.continuityContentHash||actor?.kind!=='character'||actor.preparation.kind!=='prepared'
          ||actor.preparation.identityVersion!==context.identityVersion||actor.preparation.continuityId!==context.continuityId)
          throw new Error('Fence de configuración fuera de su preparación');
      }
      if(ready.success){
        const scene=activation.snapshot.scenes.find(scene=>scene.id===activation.snapshot.activeSceneId);
        const expected=activation.snapshot.entities.filter(entity=>entity.kind==='character'&&entity.preparation.kind==='prepared'
          &&(row.effective_commit_index>0||ready.data.forkOrigin!==undefined||scene?.participantIds.includes(entity.characterId)));
        if(expected.length!==fence.contexts.length||expected.some(actor=>actor.kind==='character'&&!fence.contexts.some(context=>context.actorId===actor.characterId)))
          throw new Error('Fence de configuración incompleto');
      }
      if(row.effective_commit_index<=commitIndex)selected=row;
      previous=row;
    }
    if(previous===undefined||selected===undefined||previous.configuration_revision!==run.row.config_revision
      ||previous.configuration_json!==run.row.configuration_json||previous.configuration_hash!==run.row.configuration_hash
      ||previous.continuity_fence_json!==run.row.continuity_fence_json)throw new Error('Head de configuración difiere de su historial');
    return {configuration:parseStoredJson(selected.configuration_json),fence:WorldContinuityFenceSchema.parse(parseStoredJson(selected.continuity_fence_json)),
      configurationRevision:selected.configuration_revision,configurationHash:selected.configuration_hash,effectiveCommitIndex:selected.effective_commit_index,
      provenance:'revision' as const,activationSnapshot:snapshotAtExactConfigurationCommit(run,selected.effective_commit_index).snapshot};
  }

  function readRunConfigurationAtCommit(input:unknown):z.infer<typeof ConfigurationAtCommitReadResultSchema>{
    const request=ConfigurationAtCommitRequestSchema.parse(input);database.exec('BEGIN');
    try{
      const value=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
      if(value===undefined){database.exec('COMMIT');return {kind:'missing'};}
      const effective=configurationAtCommit(parseWorldRun(value),request.commitIndex);
      const result=ConfigurationAtCommitReadResultSchema.parse({kind:'found',configuration:effective.configuration,configurationRevision:effective.configurationRevision,
        configurationHash:effective.configurationHash,effectiveCommitIndex:effective.effectiveCommitIndex,provenance:effective.provenance,continuityFence:effective.fence});
      database.exec('COMMIT');return result;
    }catch{try{database.exec('ROLLBACK');}catch{/* Read-only transaction. */}return {kind:'unavailable',reason:'invalid-configuration'};}
  }

  function exactActorCutSource(run: ReturnType<typeof parseWorldRun>, commitIndex: number) {
    const {snapshot,snapshotHash}=snapshotAtExactConfigurationCommit(run,commitIndex);
    const effective=configurationAtCommit(run,commitIndex);
    return {snapshot,effective,source:{runId:run.row.run_id,commitIndex,worldRevision:snapshot.revision,worldSeq:snapshot.seq,snapshotHash,
      configurationRevision:effective.configurationRevision,configurationHash:effective.configurationHash}};
  }

  function validateActorCutExperienceClosure(cut: z.infer<typeof ActorStateCutSchema>, configurationValue: unknown, snapshot: z.infer<typeof WorldSnapshotSchema>) {
    const admitted = new Set<string>(cut.experiences.map(item=>item.envelope.experienceId));
    const configuration = ReadyRunConfigurationSchema.safeParse(configurationValue);
    const prepared = configuration.success ? configuration.data.roster.preparedCharacters.find(actor=>actor.characterId===cut.actorId) : undefined;
    const initial = prepared?.initialExperience.value;
    if (initial?.kind === 'run-cut') for (const experience of initial.experiences) admitted.add(experience.experienceId);
    for (const {envelope} of cut.experiences) {
      if (envelope.fictitiousAt > snapshot.clock.instant || envelope.receivedAt > snapshot.clock.instant)
        throw new Error('Experiencia posterior al reloj del corte privado');
      const references = 'basedOn' in envelope ? envelope.basedOn : [];
      if (references.some(id=>!admitted.has(id)) || (envelope.predecessor.kind==='revision' && !admitted.has(envelope.predecessor.experienceId)))
        throw new Error('Experiencia del corte privado refiere evidencia no admitida');
    }
  }

  function captureActorStateCut(runId: string, commitIndex: number) {
    const run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(runId));
    const { snapshot, source, effective } = exactActorCutSource(run, commitIndex);
    const recordedAt = new Date().toISOString();
    const actors = snapshot.entities.filter(entity => entity.kind === 'character')
      .sort((left,right) => left.characterId < right.characterId ? -1 : left.characterId > right.characterId ? 1 : 0);
    const cuts = actors.map(actor => {
      const knowledgeValue = database.prepare('SELECT knowledge_revision,at_world_seq,payload_json,payload_hash FROM actor_knowledge WHERE run_id=? AND actor_id=?')
        .get(runId,actor.characterId);
      let knowledge: z.infer<typeof ActorStateCutSchema>['knowledge'] = {kind:'unavailable',reason:'knowledge-not-recorded'};
      if (knowledgeValue !== undefined) {
        const row = WorldKnowledgeDbRowSchema.parse(knowledgeValue);
        const value = ActorKnowledgeSchema.parse(parseStoredJson(row.payload_json));
        if (canonicalJson(value) !== row.payload_json || sha256(row.payload_json) !== row.payload_hash)
          throw new Error('Conocimiento del corte privado inválido');
        knowledge = {kind:'recorded',revision:RevisionSchema.parse(row.knowledge_revision),atWorldSeq:WorldSeqSchema.parse(row.at_world_seq),value};
      }
      const experiences = new Map<string,FrozenExperience>();
      const add = (frozen: FrozenExperience) => {
        const verified = freezeExperience(frozen.envelope);
        if (verified.canonicalPayload !== frozen.canonicalPayload || verified.payloadHash !== frozen.payloadHash)
          throw new Error('Experiencia del corte privado inválida');
        const prior = experiences.get(verified.envelope.experienceId);
        if (prior !== undefined && (prior.canonicalPayload !== verified.canonicalPayload || prior.payloadHash !== verified.payloadHash))
          throw new Error('ExperienceId contradictorio en corte privado');
        experiences.set(verified.envelope.experienceId,verified);
      };
      for (const rowValue of database.prepare('SELECT canonical_payload,payload_hash FROM experiences WHERE run_id=? AND actor_id=? AND world_seq<=? ORDER BY experience_id')
        .all(runId,actor.characterId,snapshot.seq)) {
        const row = experienceRow.parse(rowValue);
        const envelope = readPrivateExperience({summary:row.canonical_payload,actorId:actor.characterId,
          runId:snapshot.runId,throughWorldSeq:snapshot.seq,expectedPayloadHash:row.payload_hash});
        add({envelope,canonicalPayload:row.canonical_payload,payloadHash:row.payload_hash});
      }
      for (const envelope of actor.mind.experiences) add(freezeExperience(envelope));
      const cut = ActorStateCutSchema.parse({kind:'actor-state-cut',source,actorId:actor.characterId,recordedAt,knowledge,
        experiences:[...experiences.values()].sort((left,right) => left.envelope.experienceId < right.envelope.experienceId ? -1 : left.envelope.experienceId > right.envelope.experienceId ? 1 : 0)});
      validateActorCutExperienceClosure(cut,effective.configuration,snapshot);
      return {cut,payload:hashJson(cut)};
    });
    const manifest = hashJson(ActorStateCutManifestSchema.parse({source,actors:cuts.map(({cut,payload})=>({actorId:cut.actorId,cutHash:payload.hash}))}));
    database.prepare('INSERT INTO actor_state_cut_batches VALUES(?,?,?,?)').run(runId,commitIndex,manifest.json,manifest.hash);
    for (const {cut,payload} of cuts) database.prepare('INSERT INTO actor_state_cuts VALUES(?,?,?,?,?)')
      .run(runId,commitIndex,cut.actorId,payload.json,payload.hash);
  }

  function readActorStateCut(input: unknown): z.infer<typeof ActorStateCutReadResultSchema> {
    const request = ActorStateCutRequestSchema.parse(input);
    const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
    if (runValue === undefined) return {kind:'missing'};
    try {
      const run = parseWorldRun(runValue);
      const selected = request.commitIndex === undefined
        ? snapshotAndCommitAtCut(run,request.worldRevision,request.worldSeq)
        : exactActorCutSource(run,request.commitIndex);
      if (selected === undefined) return {kind:'unavailable',reason:'checkpoint-not-recorded'};
      const commitIndex = 'source' in selected ? selected.source.commitIndex : selected.commitIndex;
      const exact = exactActorCutSource(run,commitIndex);
      if (exact.source.worldRevision !== request.worldRevision || exact.source.worldSeq !== request.worldSeq)
        return {kind:'unavailable',reason:'invalid-cut'};
      const batchValue = database.prepare('SELECT manifest_json,manifest_hash FROM actor_state_cut_batches WHERE run_id=? AND commit_index=?')
        .get(request.runId,commitIndex);
      if (batchValue === undefined) return {kind:'unavailable',reason:'checkpoint-not-recorded'};
      const batch = z.strictObject({manifest_json:z.string(),manifest_hash:HashSchema}).parse(batchValue);
      const manifest = ActorStateCutManifestSchema.parse(parseStoredJson(batch.manifest_json));
      if (canonicalJson(manifest) !== batch.manifest_json || sha256(batch.manifest_json) !== batch.manifest_hash
        || canonicalJson(manifest.source) !== canonicalJson(exact.source)) throw new Error('Manifest de corte privado inválido');
      const expectedActorIds = exact.snapshot.entities.filter(entity=>entity.kind==='character').map(actor=>actor.characterId).sort();
      if (canonicalJson(manifest.actors.map(actor=>actor.actorId)) !== canonicalJson(expectedActorIds)) throw new Error('Lote de corte privado incompleto');
      const rows = database.prepare('SELECT actor_id,payload_json,payload_hash FROM actor_state_cuts WHERE run_id=? AND commit_index=? ORDER BY actor_id')
        .all(request.runId,commitIndex);
      if (rows.length !== manifest.actors.length) throw new Error('Lote de corte privado incompleto');
      let requested: z.infer<typeof ActorStateCutSchema> | undefined;
      for (const [index,rowValue] of rows.entries()) {
        const row = z.strictObject({actor_id:CharacterIdSchema,payload_json:z.string(),payload_hash:HashSchema}).parse(rowValue);
        const cut = ActorStateCutSchema.parse(parseStoredJson(row.payload_json));
        const entry = manifest.actors[index];
        if (canonicalJson(cut) !== row.payload_json || sha256(row.payload_json) !== row.payload_hash
          || entry?.actorId !== row.actor_id || entry.cutHash !== row.payload_hash || cut.actorId !== row.actor_id
          || canonicalJson(cut.source) !== canonicalJson(exact.source)) throw new Error('Corte privado alterado');
        let previousId: string | undefined;
        for (const frozen of cut.experiences) {
          const verified = freezeExperience(frozen.envelope);
          if (verified.canonicalPayload !== frozen.canonicalPayload || verified.payloadHash !== frozen.payloadHash
            || (previousId !== undefined && previousId >= frozen.envelope.experienceId)) throw new Error('Experiencia del corte privado alterada');
          previousId = frozen.envelope.experienceId;
        }
        validateActorCutExperienceClosure(cut,exact.effective.configuration,exact.snapshot);
        if (cut.actorId === request.actorId) requested = cut;
      }
      return requested === undefined ? {kind:'unavailable',reason:'actor-not-in-cut'} : {kind:'found',cut:requested};
    } catch { return {kind:'unavailable',reason:'invalid-cut'}; }
  }

  function readForkSourceWithinTransaction(request:z.infer<typeof ForkSourceRequestSchema>):z.infer<typeof ForkSourceReadResultSchema> {
        const value = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
        if (value === undefined) return {kind:'missing'};
        const run = parseWorldRun(value);
        const exact = exactActorCutSource(run,request.commitIndex);
        if (exact.source.worldRevision !== request.worldRevision || exact.source.worldSeq !== request.worldSeq)
          return {kind:'unavailable',reason:'invalid-cut'};
        const configuration = ReadyRunConfigurationSchema.safeParse(exact.effective.configuration);
        if (!configuration.success) return {kind:'unavailable',reason:'configuration-not-ready'};
        if (configuration.data.runId !== request.runId || configuration.data.configRevision !== exact.source.configurationRevision
          || canonicalJson(configuration.data.worldSnapshot) !== canonicalJson(exact.effective.activationSnapshot)
          || exact.effective.fence.atWorldSeq !== exact.effective.activationSnapshot.seq)
          return {kind:'unavailable',reason:'invalid-cut'};
        for (const context of exact.effective.fence.contexts) {
          const prepared = configuration.data.roster.preparedCharacters.find(actor=>actor.characterId===context.actorId);
          if (prepared === undefined || prepared.identityVersion !== context.identityVersion || hashJson(prepared).hash !== context.preparedContextHash
            || prepared.continuity.continuityId !== context.continuityId || prepared.continuity.revision !== context.continuityRevision
            || prepared.continuity.contentHash !== context.continuityContentHash)
            return {kind:'unavailable',reason:'invalid-cut'};
        }
        const cuts: z.infer<typeof ActorStateCutSchema>[] = [];
        for (const actor of exact.snapshot.entities.filter(entity=>entity.kind==='character').sort((left,right)=>left.characterId < right.characterId ? -1 : left.characterId > right.characterId ? 1 : 0)) {
          const result = readActorStateCut({...request,actorId:actor.characterId});
          if (result.kind !== 'found') return {kind:'unavailable',reason:result.kind==='unavailable' && result.reason==='checkpoint-not-recorded' ? 'checkpoint-not-recorded' : 'invalid-cut'};
          cuts.push(result.cut);
        }
        const dramatic = readDramaticStructureAtCut(run,request.worldRevision,request.worldSeq);
        if (dramatic === undefined || dramatic.commitIndex !== request.commitIndex) return {kind:'unavailable',reason:'invalid-cut'};
        return {kind:'found',snapshot:exact.snapshot,configuration:configuration.data,cuts,structure:dramatic.structure};
  }

  /** Host-only coherent read. No mutable memory or external ICM reads. */
  function readForkSource(input: unknown): z.infer<typeof ForkSourceReadResultSchema> {
    const request=ForkSourceRequestSchema.parse(input);database.exec('BEGIN');
    try {const result=readForkSourceWithinTransaction(request);database.exec('COMMIT');return result;}
    catch {try{database.exec('ROLLBACK');}catch{/* Read transaction only. */}return {kind:'unavailable',reason:'invalid-cut'};}
  }

  const ForkJobLookupSchema=z.strictObject({operationId:z.string().uuid(),principalId:z.string().trim().min(1).max(200)});
  function deriveForkAudio(packet:z.infer<typeof ForkPublicationPackageSchema>):z.infer<typeof ForkJobSchema>['audioDerivation'] {
    const audio=packet.configuration.audio;
    return {kind:'initial-ready-configuration',sourceConfigurationHash:packet.state.source.configurationHash,effectiveHistory:'not-reconstructed',
      bindingState:[...audio.speakerSlots.map(item=>item.slot),audio.narratorSlot,...audio.soundEffectSlots.map(item=>item.slot)].some(slot=>slot.kind==='enabled-unbound')?'unbound':'not-required'};
  }
  function forkJobRequestHash(input:{source:z.infer<typeof ActorStateCutSchema>['source'];name:string;reason:string;backupOrigin?:z.infer<typeof BackupForkSourceSchema>['backup']|undefined}) {
    return hashJson({source:input.source,name:input.name,reason:input.reason,...(input.backupOrigin===undefined?{}:{backupOrigin:input.backupOrigin})}).hash;
  }
  function readStoredBackupForkSource(operationId:string,backupOrigin:z.infer<typeof ForkJobSchema>['backupOrigin']) {
    const value=database.prepare('SELECT source_json,source_hash FROM fork_backup_sources WHERE operation_id=?').get(operationId);
    if(backupOrigin===undefined){if(value!==undefined)throw new Error('Job vivo con fuente backup inesperada');return undefined;}
    if(value===undefined)throw new Error('Job backup sin fuente congelada');
    const row=z.strictObject({source_json:z.string(),source_hash:HashSchema}).parse(value);const source=BackupForkSourceSchema.parse(parseStoredJson(row.source_json));
    if(canonicalJson(source)!==row.source_json||sha256(row.source_json)!==row.source_hash||canonicalJson(source.backup)!==canonicalJson(backupOrigin))throw new Error('Fuente backup congelada alterada');
    return source;
  }
  function forkJobRecord(request:z.infer<typeof ForkJobLookupSchema>) {
    const value=database.prepare('SELECT * FROM fork_jobs WHERE operation_id=? AND principal_id=?').get(request.operationId,request.principalId);
    if(value===undefined)return undefined;
    const row=z.strictObject({operation_id:z.string().uuid(),principal_id:z.string(),idempotency_key:z.string().uuid(),target_run_id:RunIdSchema,
      state:z.enum(['staging','ready','failed']),request_hash:HashSchema,job_json:z.string(),job_hash:HashSchema,
      package_json:z.string(),package_hash:HashSchema,artifacts_json:z.string().nullable(),artifacts_hash:HashSchema.nullable()}).parse(value);
    const job=ForkJobSchema.parse(parseStoredJson(row.job_json));const packet=ForkPublicationPackageSchema.parse(parseStoredJson(row.package_json));
    if(canonicalJson(job)!==row.job_json||sha256(row.job_json)!==row.job_hash||canonicalJson(packet)!==row.package_json||sha256(row.package_json)!==row.package_hash
      ||job.operationId!==row.operation_id||job.principalId!==row.principal_id||job.idempotencyKey!==row.idempotency_key||job.targetRunId!==row.target_run_id
      ||forkJobRequestHash(job)!==row.request_hash
      ||canonicalJson(job.audioDerivation)!==canonicalJson(deriveForkAudio(packet))
      ||job.state!==row.state||packet.state.targetRunId!==job.targetRunId||canonicalJson(job.source)!==canonicalJson(packet.state.source))throw new Error('Job de fork alterado');
    const history=z.strictObject({payload_json:z.string(),payload_hash:HashSchema}).parse(database.prepare('SELECT payload_json,payload_hash FROM fork_job_history WHERE operation_id=? AND revision=?').get(job.operationId,job.revision));
    if(history.payload_json!==row.job_json||history.payload_hash!==row.job_hash)throw new Error('Historia de fork inconsistente');
    if(row.artifacts_json!==null){const manifest=ForkArtifactManifestSchema.parse(parseStoredJson(row.artifacts_json));if(canonicalJson(manifest)!==row.artifacts_json||sha256(row.artifacts_json)!==row.artifacts_hash||manifest.packageHash!==row.package_hash||manifest.operationId!==job.operationId||manifest.targetRunId!==job.targetRunId)throw new Error('Manifiesto de fork alterado');}
    else if(row.artifacts_hash!==null||job.state==='ready')throw new Error('Fork Ready sin manifiesto');
    const backupSource=readStoredBackupForkSource(job.operationId,job.backupOrigin);
    if(backupSource!==undefined&&canonicalJson(backupSource.cuts[0]?.source)!==canonicalJson(job.source))throw new Error('Fuente backup pertenece a otro corte');
    return {row,job,packet,backupSource};
  }
  function appendForkJob(job:z.infer<typeof ForkJobSchema>){const payload=hashJson(job);
    database.prepare('UPDATE fork_jobs SET state=?,job_json=?,job_hash=? WHERE operation_id=?').run(job.state,payload.json,payload.hash,job.operationId);
    database.prepare('INSERT INTO fork_job_history VALUES(?,?,?,?)').run(job.operationId,job.revision,payload.json,payload.hash);return job;
  }
  function validateForkPackageSource(packet:z.infer<typeof ForkPublicationPackageSchema>,identity:{operationId:string;principalId:string;name:string},backupSource?:z.infer<typeof BackupForkSourceSchema>){
    const source=backupSource===undefined?readForkSourceWithinTransaction({runId:packet.state.source.runId,commitIndex:packet.state.source.commitIndex,worldRevision:packet.state.source.worldRevision,worldSeq:packet.state.source.worldSeq}):{...BackupForkSourceSchema.parse(backupSource),kind:'found' as const};
    if(source.kind!=='found')throw new Error('Fuente exacta de fork no disponible');
    const restored=prepareForkState({snapshot:source.snapshot,configuration:source.configuration,cuts:source.cuts,targetRunId:packet.state.targetRunId,restoredIdentities:packet.state.identities});
    const dramatic=prepareForkDramaticSeed({structure:source.structure,state:restored});
    if(canonicalJson(dramatic.state)!==canonicalJson(packet.state)||canonicalJson(dramatic.seed)!==canonicalJson(packet.dramaticSeed))throw new Error('Estado derivado no coincide con la fuente');
    const origin=packet.configuration.forkOrigin;if(origin===undefined||origin.operationId!==identity.operationId||origin.principalId!==identity.principalId)throw new Error('Procedencia de fork ajena');
    const rebuilt=prepareForkConfiguration({sourceConfiguration:source.configuration,state:packet.state,name:identity.name,principalId:identity.principalId,operationId:identity.operationId,recordedAt:origin.recordedAt});
    if(validateReadyConfiguration(packet.configuration).length!==0)throw new Error('Configuración derivada no está completa');
    if(canonicalJson(rebuilt.configuration)!==canonicalJson(packet.configuration)||canonicalJson(rebuilt.continuityFence)!==canonicalJson(packet.continuityFence))throw new Error('Configuración de fork no deriva de la fuente');
  }
  const ForkBeginRequestSchema=z.strictObject({...ForkJobLookupSchema.shape,idempotencyKey:z.string().uuid(),name:z.string().trim().min(1).max(120),reason:z.string().trim().min(1).max(4000),package:ForkPublicationPackageSchema});
  function beginForkJob(input:unknown){return beginForkJobWithSource(ForkBeginRequestSchema.parse(input));}
  function beginForkJobFromBackup(input:unknown){
    const {source,...request}=z.strictObject({...ForkBeginRequestSchema.shape,source:BackupForkSourceSchema}).parse(input);
    return beginForkJobWithSource(request,source);
  }
  function beginForkJobWithSource(request:z.infer<typeof ForkBeginRequestSchema>,backupSource?:z.infer<typeof BackupForkSourceSchema>){
    const requestHash=forkJobRequestHash({source:request.package.state.source,name:request.name,reason:request.reason,...(backupSource===undefined?{}:{backupOrigin:backupSource.backup})});
    return transact(()=>{
      const existing=database.prepare('SELECT operation_id,principal_id,request_hash FROM fork_jobs WHERE (principal_id=? AND idempotency_key=?) OR operation_id=?').all(request.principalId,request.idempotencyKey,request.operationId);
      if(existing.length!==0){
        if(existing.length!==1)return {kind:'idempotencyConflict' as const};
        const prior=z.strictObject({operation_id:z.string().uuid(),principal_id:z.string(),request_hash:HashSchema}).parse(existing[0]);
        if(prior.principal_id!==request.principalId||prior.request_hash!==requestHash)return {kind:'idempotencyConflict' as const};
        const record=forkJobRecord({operationId:prior.operation_id,principalId:prior.principal_id});if(record===undefined)throw new Error('Fork existente desapareció');
        if(record.job.operationId!==request.operationId||record.job.idempotencyKey!==request.idempotencyKey)return {kind:'idempotencyConflict' as const};
        return {kind:'existing' as const,job:record.job};
      }
      const conflicting=['fork_job_retries','run_draft_operations','pi_oauth_job_operations','pi_access_job_operations','run_preflight_job_operations','run_control_operations','structure_operations'].some(table=>database.prepare(`SELECT 1 FROM ${table} WHERE principal_id=? AND idempotency_key=?`).get(request.principalId,request.idempotencyKey)!==undefined);
      if(conflicting)return {kind:'idempotencyConflict' as const};
      validateForkPackageSource(request.package,request,backupSource);
      if(database.prepare('SELECT 1 FROM world_runs WHERE run_id=?').get(request.package.state.targetRunId)!==undefined||database.prepare('SELECT 1 FROM run_configuration_drafts WHERE run_id=?').get(request.package.state.targetRunId)!==undefined)throw new Error('Destino de fork existente');
      const now=Date.now();const job=ForkJobSchema.parse({operationId:request.operationId,principalId:request.principalId,idempotencyKey:request.idempotencyKey,targetRunId:request.package.state.targetRunId,
        source:request.package.state.source,...(backupSource===undefined?{}:{backupOrigin:backupSource.backup}),name:request.name,reason:request.reason,
        audioDerivation:deriveForkAudio(request.package),state:'staging',revision:0,createdAt:now,updatedAt:now});
      const payload=hashJson(job);const packet=hashJson(request.package);
      database.prepare('INSERT INTO fork_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(job.operationId,job.principalId,job.idempotencyKey,job.targetRunId,job.state,requestHash,payload.json,payload.hash,packet.json,packet.hash,null,null);
      database.prepare('INSERT INTO fork_job_history VALUES(?,?,?,?)').run(job.operationId,job.revision,payload.json,payload.hash);
      if(backupSource!==undefined){const frozen=hashJson(backupSource);database.prepare('INSERT INTO fork_backup_sources VALUES(?,?,?)').run(job.operationId,frozen.json,frozen.hash);}
      return {kind:'created' as const,job};
    });
  }
  function readForkJob(input:unknown){return forkJobRecord(ForkJobLookupSchema.parse(input))?.job;}
  function findForkJob(input:unknown){const request=z.strictObject({principalId:ForkJobLookupSchema.shape.principalId,idempotencyKey:z.string().uuid()}).parse(input);
    const row=database.prepare('SELECT operation_id FROM fork_jobs WHERE principal_id=? AND idempotency_key=?').get(request.principalId,request.idempotencyKey);
    return row===undefined?undefined:readForkJob({principalId:request.principalId,operationId:z.object({operation_id:z.string().uuid()}).parse(row).operation_id});
  }
  function readForkPackage(input:unknown){return forkJobRecord(ForkJobLookupSchema.parse(input))?.packet;}
  function listStagingForkJobs(){return database.prepare("SELECT operation_id,principal_id FROM fork_jobs WHERE state='staging' ORDER BY operation_id").all().map(value=>{
    const row=z.strictObject({operation_id:z.string().uuid(),principal_id:z.string()}).parse(value);const record=forkJobRecord({operationId:row.operation_id,principalId:row.principal_id});if(record===undefined)throw new Error('Fork staging desapareció');return record.job;
  });}
  function frozenForkExperience(record:NonNullable<ReturnType<typeof forkJobRecord>>,receipt:z.infer<typeof MemoryProjectionReceiptSchema>){
    const frozen=record.packet.state.actors.find(actor=>actor.actorId===receipt.actorId)?.experiences.find(item=>item.envelope.experienceId===receipt.experienceId);
    if(frozen===undefined||receipt.runId!==record.job.targetRunId||receipt.worldSeq!==frozen.envelope.worldSeq||receipt.canonicalPayload!==frozen.canonicalPayload||receipt.payloadHash!==frozen.payloadHash)throw new Error('Receipt ICM de fork ajeno o alterado');
    const verified=freezeExperience(frozen.envelope);if(canonicalJson(verified)!==canonicalJson(frozen))throw new Error('Experiencia staged alterada');return frozen;
  }
  function forkProjectionReceipts(record:NonNullable<ReturnType<typeof forkJobRecord>>){return database.prepare('SELECT payload_json,payload_hash,experience_id,actor_id,memory_id FROM fork_projection_receipts WHERE operation_id=? ORDER BY actor_id,experience_id').all(record.job.operationId).map(value=>{
    const row=z.strictObject({payload_json:z.string(),payload_hash:HashSchema,experience_id:ExperienceIdSchema,actor_id:CharacterIdSchema,memory_id:IcmMemoryIdSchema}).parse(value);
    const receipt=MemoryProjectionReceiptSchema.parse(parseStoredJson(row.payload_json));
    if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(receipt)!==row.payload_json||receipt.experienceId!==row.experience_id||receipt.actorId!==row.actor_id||receipt.memoryId!==row.memory_id)throw new Error('Receipt staged de fork alterado');
    frozenForkExperience(record,receipt);return receipt;
  });}
  function recordForkProjection(input:unknown){const request=z.strictObject({...ForkJobLookupSchema.shape,receipt:MemoryProjectionReceiptSchema}).parse(input);return transact(()=>{
    const record=forkJobRecord(request);if(record===undefined)throw new Error('Fork ausente');frozenForkExperience(record,request.receipt);
    const prior=forkProjectionReceipts(record).find(receipt=>receipt.experienceId===request.receipt.experienceId);
    if(prior!==undefined){if(canonicalJson(prior)!==canonicalJson(request.receipt))throw new Error('Receipt fork no admite sustitución');return prior;}
    if(record.job.state!=='staging')throw new Error('Fork no está en staging');const payload=hashJson(request.receipt);
    database.prepare('INSERT INTO fork_projection_receipts VALUES(?,?,?,?,?,?)').run(record.job.operationId,request.receipt.experienceId,request.receipt.actorId,request.receipt.memoryId,payload.json,payload.hash);return request.receipt;
  });}
  function readForkProjectionReceipts(input:unknown){const record=forkJobRecord(ForkJobLookupSchema.parse(input));return record===undefined?[]:forkProjectionReceipts(record);}
  function readForkProjectionReceipt(input:unknown){const request=z.strictObject({operationId:z.string().uuid(),memoryId:IcmMemoryIdSchema,runId:RunIdSchema,actorId:CharacterIdSchema,throughWorldSeq:WorldSeqSchema}).parse(input);
    const row=database.prepare('SELECT principal_id FROM fork_jobs WHERE operation_id=?').get(request.operationId);if(row===undefined)return undefined;
    const record=forkJobRecord({operationId:request.operationId,principalId:z.object({principal_id:z.string()}).parse(row).principal_id});if(record===undefined||record.job.targetRunId!==request.runId)return undefined;
    return forkProjectionReceipts(record).find(receipt=>receipt.memoryId===request.memoryId&&receipt.runId===request.runId&&receipt.actorId===request.actorId&&receipt.worldSeq<=request.throughWorldSeq);
  }
  function failForkJob(input:unknown){const request=z.strictObject({...ForkJobLookupSchema.shape,expectedRevision:RevisionSchema,code:ForkJobFailureCodeSchema}).parse(input);return transact(()=>{
    const record=forkJobRecord(request);if(record===undefined)return undefined;if(record.job.state!=='staging')return record.job;if(record.job.revision!==request.expectedRevision)throw new Error('CAS de fork obsoleto');
    return appendForkJob(ForkJobSchema.parse({...record.job,state:'failed',code:request.code,revision:record.job.revision+1,updatedAt:Date.now()}));
  });}
  const ForkRetryRequestSchema=z.strictObject({...ForkJobLookupSchema.shape,expectedRevision:RevisionSchema,idempotencyKey:z.string().uuid()});
  const ForkRetryResultSchema=z.discriminatedUnion('kind',[
    z.strictObject({kind:z.literal('updated'),job:ForkJobSchema}),z.strictObject({kind:z.literal('existing'),job:ForkJobSchema}),
    z.strictObject({kind:z.literal('missing')}),z.strictObject({kind:z.literal('conflict'),currentRevision:RevisionSchema}),
    z.strictObject({kind:z.literal('invalidState')}),z.strictObject({kind:z.literal('idempotencyConflict')}),
  ]);
  function retryForkJob(input:unknown):z.infer<typeof ForkRetryResultSchema>{
    const request=ForkRetryRequestSchema.parse(input);const requestHash=hashJson(request).hash;
    return transact(()=>{
      const value=database.prepare('SELECT operation_id,expected_revision,request_hash,result_json,result_hash FROM fork_job_retries WHERE principal_id=? AND idempotency_key=?').get(request.principalId,request.idempotencyKey);
      if(value!==undefined){
        const row=z.strictObject({operation_id:z.string().uuid(),expected_revision:RevisionSchema,request_hash:HashSchema,result_json:z.string(),result_hash:HashSchema}).parse(value);
        const stored=ForkRetryResultSchema.parse(parseStoredJson(row.result_json));
        if(sha256(row.result_json)!==row.result_hash||canonicalJson(stored)!==row.result_json
          ||hashJson({...request,operationId:row.operation_id,expectedRevision:row.expected_revision}).hash!==row.request_hash||stored.kind==='existing'||stored.kind==='idempotencyConflict')throw new Error('Receipt de retry de fork alterado');
        if(stored.kind==='updated'){
          const history=database.prepare('SELECT payload_json,payload_hash FROM fork_job_history WHERE operation_id=? AND revision=?').get(row.operation_id,stored.job.revision);
          const payload=hashJson(stored.job);const original=z.strictObject({payload_json:z.string(),payload_hash:HashSchema}).parse(history);
          if(stored.job.state!=='staging'||stored.job.operationId!==row.operation_id||stored.job.principalId!==request.principalId||stored.job.revision!==row.expected_revision+1
            ||original.payload_json!==payload.json||original.payload_hash!==payload.hash)throw new Error('Retry de fork no coincide con su transición histórica');
        }
        if(row.operation_id!==request.operationId||row.expected_revision!==request.expectedRevision||row.request_hash!==requestHash)return {kind:'idempotencyConflict'};
        return stored.kind==='updated'?{kind:'existing',job:stored.job}:stored;
      }
      const tables=['fork_jobs','run_draft_operations','pi_oauth_job_operations','pi_access_job_operations','run_preflight_job_operations','run_control_operations','structure_operations'];
      if(tables.some(table=>database.prepare(`SELECT 1 FROM ${table} WHERE principal_id=? AND idempotency_key=?`).get(request.principalId,request.idempotencyKey)!==undefined))return {kind:'idempotencyConflict'};
      const record=(result:z.infer<typeof ForkRetryResultSchema>)=>{const payload=hashJson(result);database.prepare('INSERT INTO fork_job_retries VALUES(?,?,?,?,?,?,?)').run(request.principalId,request.idempotencyKey,request.operationId,request.expectedRevision,requestHash,payload.json,payload.hash);return result;};
      const current=forkJobRecord(request);if(current===undefined)return record({kind:'missing'});
      if(current.job.revision!==request.expectedRevision)return record({kind:'conflict',currentRevision:current.job.revision});
      if(current.job.state!=='failed')return record({kind:'invalidState'});
      const {code,...previous}=current.job;void code;
      const job=appendForkJob(ForkJobSchema.parse({...previous,state:'staging',revision:current.job.revision+1,updatedAt:Date.now()}));
      return record({kind:'updated',job});
    });
  }
  function publishForkJob(input:unknown){const request=z.strictObject({...ForkJobLookupSchema.shape,expectedRevision:RevisionSchema,artifacts:ForkArtifactManifestSchema}).parse(input);return transact(()=>{
    const record=forkJobRecord(request);if(record===undefined)throw new Error('Fork ausente');if(record.job.state==='ready')return record.job;
    if(record.job.state!=='staging'||record.job.revision!==request.expectedRevision)throw new Error('CAS de fork no publicable');
    const {packet,job}=record;validateForkPackageSource(packet,job,record.backupSource);const manifest=request.artifacts;
    const expectedActors=packet.state.actors.map(actor=>actor.actorId).sort();
    if(manifest.operationId!==job.operationId||manifest.targetRunId!==job.targetRunId||manifest.packageHash!==record.row.package_hash
      ||canonicalJson(manifest.actors.map(actor=>actor.actorId).sort())!==canonicalJson(expectedActors))throw new Error('Manifiesto de artefactos incompleto o ajeno');
    const receipts=forkProjectionReceipts(record);const expectedExperiences=packet.state.actors.flatMap(actor=>actor.experiences);
    if(receipts.length!==expectedExperiences.length||expectedExperiences.some(frozen=>!receipts.some(receipt=>receipt.experienceId===frozen.envelope.experienceId&&receipt.actorId===frozen.envelope.actorId&&receipt.runId===frozen.envelope.runId&&receipt.payloadHash===frozen.payloadHash&&receipt.canonicalPayload===frozen.canonicalPayload)))throw new Error('Proyección ICM incompleta');
    if(database.prepare('SELECT 1 FROM world_runs WHERE run_id=?').get(job.targetRunId)!==undefined||database.prepare('SELECT 1 FROM run_configuration_drafts WHERE run_id=?').get(job.targetRunId)!==undefined)throw new Error('Destino de fork existente');
    registerWorldRunWithinTransaction({initialSnapshot:packet.state.snapshot,configurationRevision:packet.configuration.configRevision,
      configuration:packet.configuration,continuityFence:packet.continuityFence,lifecycle:'ready'},false,true);
    for(const actor of packet.state.actors){
      if(actor.knowledge.kind==='recorded'){const payload=hashJson(actor.knowledge.value);database.prepare('INSERT INTO actor_knowledge VALUES(?,?,?,?,?,?)').run(job.targetRunId,actor.actorId,actor.knowledge.revision,actor.knowledge.atWorldSeq,payload.json,payload.hash);}
      for(const frozen of actor.experiences){recordExperienceWithinTransaction(frozen);const receipt=receipts.find(item=>item.experienceId===frozen.envelope.experienceId);if(receipt===undefined)throw new Error('Receipt ICM desapareció');
        database.prepare("INSERT INTO memory_receipts(experience_id,memory_id,claim_token,state,recorded_at) VALUES(?,?,?,'projected',?)").run(receipt.experienceId,receipt.memoryId,randomUUID(),Date.now());
        database.prepare('DELETE FROM memory_outbox WHERE experience_id=?').run(receipt.experienceId);
      }
    }
    const seedPayload=hashJson(packet.dramaticSeed);database.prepare('INSERT INTO fork_dramatic_seeds VALUES(?,?,?)').run(job.targetRunId,seedPayload.json,seedPayload.hash);
    for(const episode of packet.dramaticSeed.structure.episodes){const opening=hashJson(episode.openingCut);const closing=episode.closingCut===null?undefined:hashJson(episode.closingCut);
      database.prepare('INSERT INTO episodes VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(job.targetRunId,episode.episodeId,episode.ordinal,episode.title,episode.lifecycle,opening.json,opening.hash,closing?.json??null,closing?.hash??null,canonicalJson(episode.consequenceEventIds),canonicalJson(episode.openLines));
      episode.sceneIds.forEach((sceneId,index)=>database.prepare('INSERT INTO episode_scenes VALUES(?,?,?,?)').run(job.targetRunId,episode.episodeId,sceneId,index+1));
      for(const act of episode.acts){database.prepare('INSERT INTO acts VALUES(?,?,?,?,?)').run(job.targetRunId,episode.episodeId,act.actId,act.ordinal,act.title);act.sceneIds.forEach((sceneId,index)=>database.prepare('INSERT INTO act_scenes VALUES(?,?,?,?,?)').run(job.targetRunId,episode.episodeId,act.actId,sceneId,index+1));}
    }
    const recordedAt=new Date().toISOString();const evidence={kind:'operator-choice',operatorId:job.principalId,recordedAt};
    const fields=['name','fictionalAt','continuity','roster','humanParticipants','worldSnapshot','dramaticLine','circadianPolicy','spanishVariety','narrationMode','inferenceProfile','budget','maxReformulations','audio'] as const;
    const configured=Object.fromEntries(fields.flatMap(field=>packet.configuration[field]===undefined?[]:[[field,{kind:'configured',value:packet.configuration[field],evidence:field==='name'?evidence:{kind:'host-derived',derivationRef:`fork:${job.operationId}`,recordedAt}}]]));
    const draft=RunConfigurationDraftSchema.parse({...createEmptyRunConfigurationDraft({runId:job.targetRunId,revision:0}),...configured});
    database.prepare('INSERT INTO run_configuration_drafts VALUES(?,?,?,?)').run(job.targetRunId,0,recordedAt,recordedAt);appendRunDraftHistory({draft,principalId:job.principalId,recordedAt});
    const artifacts=hashJson(manifest);database.prepare('UPDATE fork_jobs SET artifacts_json=?,artifacts_hash=? WHERE operation_id=?').run(artifacts.json,artifacts.hash,job.operationId);
    return appendForkJob(ForkJobSchema.parse({...job,state:'ready',revision:job.revision+1,updatedAt:Date.now(),publishedAt:Date.now()}));
  });}

  function identityPromotionRecord(value:unknown){
    const row=z.strictObject({principal_id:z.string(),idempotency_key:z.string().uuid(),operation_id:z.string().uuid(),run_id:RunIdSchema,actor_id:CharacterIdSchema,request_json:z.string(),request_hash:HashSchema,plan_json:z.string(),plan_hash:HashSchema,receipt_json:z.string(),receipt_hash:HashSchema}).parse(value);
    const request=IdentityPromotionRequestSchema.parse(parseStoredJson(row.request_json));const plan=PreparedIdentityPromotionSchema.parse(parseStoredJson(row.plan_json));const receipt=IdentityPromotionReceiptSchema.parse(parseStoredJson(row.receipt_json));
    if(canonicalJson(request)!==row.request_json||sha256(row.request_json)!==row.request_hash||canonicalJson(plan)!==row.plan_json||sha256(row.plan_json)!==row.plan_hash||canonicalJson(receipt)!==row.receipt_json||sha256(row.receipt_json)!==row.receipt_hash
      ||request.principalId!==row.principal_id||request.idempotencyKey!==row.idempotency_key||request.approval.operationId!==row.operation_id||receipt.operationId!==row.operation_id||receipt.principalId!==row.principal_id||receipt.actorId!==row.actor_id||receipt.source.runId!==row.run_id||receipt.target.runId!==row.run_id
      ||hashJson(plan.promotion.source).hash!==hashJson(receipt.source).hash||hashJson(request.context).hash!==receipt.contextHash||hashJson(request.proposal).hash!==receipt.proposalHash||hashJson(request.approval).hash!==hashJson(receipt.approval).hash
      ||plan.configuration.configRevision!==receipt.target.configurationRevision||hashJson(plan.configuration).hash!==receipt.target.configurationHash||hashJson(plan.snapshot).hash!==receipt.target.snapshotHash||plan.nextCommitIndex!==receipt.target.commitIndex
      ||plan.promotion.characterId!==receipt.actorId||plan.promotion.identityVersion!==receipt.identityVersion||plan.promotion.previousIdentityVersion!==receipt.previousIdentityVersion||receipt.authority.contextHash!==receipt.contextHash||receipt.authority.proposalHash!==receipt.proposalHash||receipt.authority.approvalHash!==hashJson(receipt.approval).hash||receipt.authority.principalId!==receipt.principalId||receipt.authority.actorId!==receipt.actorId||receipt.authority.runId!==row.run_id)throw new Error('IDENTITY_PROMOTION_RECEIPT_INVALID');
    return {row,request,plan,receipt};
  }
  function assertIdentityPromotionIdle(run:ReturnType<typeof parseWorldRun>){
    if(!['ready','paused','stopped'].includes(run.row.lifecycle))throw new Error('IDENTITY_PROMOTION_LIFECYCLE_INVALID');
    const scope=run.row.run_id;
    const checks=[
      "SELECT 1 FROM actor_turn_jobs WHERE run_id=? AND state IN('queued','running') LIMIT 1",
      "SELECT 1 FROM continuista_jobs WHERE run_id=? AND state IN('queued','running') LIMIT 1",
      "SELECT 1 FROM administrative_jobs WHERE run_id=? AND state='running' LIMIT 1",
      "SELECT 1 FROM world_proposals WHERE run_id=? AND status='pending' LIMIT 1",
      "SELECT 1 FROM actor_pi_candidates c LEFT JOIN actor_pi_turn_receipts r ON r.candidate_id=c.candidate_id WHERE c.run_id=? AND c.candidate_kind='terminal-candidate' AND c.outcome='completed' AND r.candidate_id IS NULL LIMIT 1",
      "SELECT 1 FROM request_reservations WHERE run_id=? AND state IN('reserved','dispatched','ambiguous') LIMIT 1",
      "SELECT 1 FROM model_time_spans WHERE run_id=? AND state IN('reserved','running','expired','uncertain') LIMIT 1",
      "SELECT 1 FROM run_step_jobs WHERE run_id=? AND state IN('queued','running') LIMIT 1",
      "SELECT 1 FROM coordinator_pulses WHERE run_id=? AND state='running' LIMIT 1",
      "SELECT 1 FROM run_preflight_jobs WHERE run_id=? AND state IN('queued','running','cancel-requested') LIMIT 1",
      "SELECT 1 FROM actor_activation_causes WHERE run_id=? AND state IN('pending','running') LIMIT 1",
      "SELECT 1 FROM actor_activation_invitations WHERE run_id=? AND state IN('pending','assigned') LIMIT 1",
      "SELECT 1 FROM world_deliveries d JOIN world_perceptions p ON p.perception_id=d.perception_id WHERE p.run_id=? AND d.state<>'delivered' LIMIT 1",
      "SELECT 1 FROM memory_outbox o JOIN experiences e ON e.experience_id=o.experience_id WHERE e.run_id=? LIMIT 1",
    ];
    for(const sql of checks)if(database.prepare(sql).get(scope)!==undefined)throw new Error('IDENTITY_PROMOTION_WORK_PENDING');
    if(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='configurator_jobs'").get()!==undefined
      &&database.prepare("SELECT 1 FROM configurator_jobs WHERE run_id=? AND json_extract(payload_json,'$.job.state') IN('queued','running') LIMIT 1").get(scope)!==undefined)throw new Error('IDENTITY_PROMOTION_WORK_PENDING');
  }
  function appendConfigurationRevision(runId:z.infer<typeof RunIdSchema>,commit:number,revision:number,configurationJson:string,fenceJson:string,snapshotHash:z.infer<typeof HashSchema>){
    const record={run_id:runId,effective_commit_index:commit,configuration_revision:revision,configuration_json:configurationJson,configuration_hash:sha256(configurationJson),continuity_fence_json:fenceJson,continuity_fence_hash:sha256(fenceJson),activation_snapshot_hash:snapshotHash};
    database.prepare('INSERT INTO run_configuration_revisions VALUES(?,?,?,?,?,?,?,?,?)').run(runId,commit,revision,configurationJson,record.configuration_hash,fenceJson,record.continuity_fence_hash,snapshotHash,hashJson(record).hash);
  }
  function applyIdentityPromotion(input:unknown):z.infer<typeof IdentityPromotionResultSchema>{
    const request=IdentityPromotionRequestSchema.parse(input);const payload=hashJson(request);
    return transact(()=>{
      const previous=database.prepare('SELECT * FROM identity_promotion_receipts WHERE principal_id=? AND idempotency_key=?').get(request.principalId,request.idempotencyKey);
      if(previous!==undefined){const stored=identityPromotionRecord(previous);if(stored.row.request_hash!==payload.hash)throw new Error('IDENTITY_PROMOTION_IDEMPOTENCY_REUSE');return {kind:'existing',receipt:stored.receipt};}
      if(identityPromotionPorts===undefined)throw new Error('IDENTITY_PROMOTION_AUTHORITY_UNCONFIGURED');
      if(request.context.scope.kind!=='evolution'||request.proposal.kind!=='identity-promotion-proposal')throw new Error('IDENTITY_PROMOTION_EVOLUTION_REQUIRED');
      if(request.approval.operatorId!==request.principalId)throw new Error('IDENTITY_PROMOTION_PRINCIPAL_MISMATCH');
      const anchor=request.context.scope.anchor.source;const actorId=request.context.target.characterId;
      const run=parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(anchor.runId));
      if(run.row.lifecycle_revision!==request.expectedLifecycleRevision||run.row.commit_index!==request.expectedCommitIndex||run.row.world_revision!==request.expectedWorldRevision||anchor.commitIndex!==run.row.commit_index||anchor.worldRevision!==run.row.world_revision||anchor.worldSeq!==run.row.last_seq||anchor.configurationHash!==run.row.configuration_hash||anchor.configurationRevision!==run.row.config_revision||request.context.scope.scope.lifecycleRevision!==run.row.lifecycle_revision)throw new Error('IDENTITY_PROMOTION_STALE');
      assertIdentityPromotionIdle(run);identityPromotionPorts.assertIdentityPromotionRuntimeIdle({runId:anchor.runId});
      const source=readForkSourceWithinTransaction({runId:anchor.runId,commitIndex:anchor.commitIndex,worldRevision:anchor.worldRevision,worldSeq:anchor.worldSeq});if(source.kind!=='found')throw new Error('IDENTITY_PROMOTION_SOURCE_UNAVAILABLE');
      const plan=prepareIdentityPromotion({source,context:request.context,proposal:request.proposal,approval:request.approval});
      const authorizationRequest=IdentityPromotionAuthorityRequestSchema.parse({principalId:request.principalId,runId:anchor.runId,actorId,contextHash:hashJson(request.context).hash,proposalHash:hashJson(request.proposal).hash,approvalHash:hashJson(request.approval).hash,approval:request.approval});
      const authority=AcceptedConfiguratorProposalSchema.parse(identityPromotionPorts.requireAcceptedConfiguratorProposal(authorizationRequest));
      const proof=AcceptedConfiguratorProposalSchema.omit({kind:true,jobId:true,candidateHash:true}).strip().parse(authority);const expectedProof=IdentityPromotionAuthorityRequestSchema.omit({approval:true}).strip().parse(authorizationRequest);
      if(canonicalJson(proof)!==canonicalJson(expectedProof))throw new Error('IDENTITY_PROMOTION_AUTHORITY_MISMATCH');
      const recordedAt=new Date().toISOString();
      const original=configurationAtCommit(run,0);const originalConfiguration=ReadyRunConfigurationSchema.parse(original.configuration);
      for(const originalPrepared of originalConfiguration.roster.preparedCharacters){
        if(identityEpochs(run,originalPrepared.characterId).length>0)continue;
        const legacySession=currentActorSession(run,originalPrepared.characterId);
        const baseline=ActorIdentityEpochSchema.parse({runId:anchor.runId,actorId:originalPrepared.characterId,epochIndex:0,activationCommitIndex:0,configurationRevision:original.configurationRevision,configurationHash:original.configurationHash,identityVersion:originalPrepared.identityVersion,preparedContextHash:hashJson(originalPrepared).hash,createdAt:recordedAt});
        storeIdentityEpoch(baseline);if(legacySession!==undefined)bindIdentitySession(baseline,legacySession);
      }
      const active=identityEpochs(run,actorId).at(-1);if(active===undefined||active.identityVersion!==plan.promotion.previousIdentityVersion||active.preparedContextHash!==plan.promotion.sourcePreparedHash)throw new Error('IDENTITY_PROMOTION_EPOCH_DIVERGED');
      const session=currentActorSession(run,actorId);
      if(session!==undefined){const row=ActorPiSessionRowSchema.parse(database.prepare('SELECT * FROM actor_pi_sessions WHERE run_id=? AND actor_id=?').get(anchor.runId,actorId));const archived=hashJson(row);database.prepare('INSERT INTO actor_pi_session_archives VALUES(?,?,?,?,?,?,?)').run(anchor.runId,actorId,active.epochIndex,row.session_id,row.session_path,archived.json,archived.hash);}
      if(database.prepare('SELECT 1 FROM run_configuration_revisions WHERE run_id=? LIMIT 1').get(anchor.runId)===undefined)appendConfigurationRevision(anchor.runId,0,run.row.config_revision,run.row.configuration_json,run.row.continuity_fence_json,run.row.initial_snapshot_hash);
      const configuration=hashJson(plan.configuration);const snapshot=hashJson(plan.snapshot);const fence=hashJson(plan.continuityFence);const now=Date.now();
      database.prepare('INSERT INTO world_commits(run_id,commit_index,origin_kind,origin_id,world_revision,last_seq,snapshot_json,snapshot_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(anchor.runId,plan.nextCommitIndex,'identityPromotion',request.approval.operationId,plan.snapshot.revision,plan.snapshot.seq,snapshot.json,snapshot.hash,now);
      appendConfigurationRevision(anchor.runId,plan.nextCommitIndex,plan.configuration.configRevision,configuration.json,fence.json,snapshot.hash);
      database.prepare('UPDATE world_runs SET config_revision=?,configuration_json=?,configuration_hash=?,continuity_fence_json=?,world_revision=?,commit_index=?,snapshot_json=?,snapshot_hash=?,lifecycle_revision=lifecycle_revision+1,updated_at=? WHERE run_id=?').run(plan.configuration.configRevision,configuration.json,configuration.hash,fence.json,plan.snapshot.revision,plan.nextCommitIndex,snapshot.json,snapshot.hash,now,anchor.runId);
      database.prepare('DELETE FROM world_prepared_contexts WHERE run_id=?').run(anchor.runId);for(const context of plan.continuityFence.contexts)database.prepare('INSERT INTO world_prepared_contexts VALUES(?,?,?,?,?,?)').run(anchor.runId,context.actorId,plan.configuration.configRevision,context.continuityId,context.identityVersion,context.preparedContextHash);
      const nextEpoch=ActorIdentityEpochSchema.parse({runId:anchor.runId,actorId,epochIndex:active.epochIndex+1,activationCommitIndex:plan.nextCommitIndex,configurationRevision:plan.configuration.configRevision,configurationHash:configuration.hash,identityVersion:plan.promotion.identityVersion,preparedContextHash:plan.promotion.preparedHash,createdAt:recordedAt});storeIdentityEpoch(nextEpoch);
      const target={runId:anchor.runId,commitIndex:plan.nextCommitIndex,worldRevision:plan.snapshot.revision,worldSeq:plan.snapshot.seq,snapshotHash:snapshot.hash,configurationRevision:plan.configuration.configRevision,configurationHash:configuration.hash};
      const receipt=IdentityPromotionReceiptSchema.parse({kind:'identity-promotion-receipt',operationId:request.approval.operationId,principalId:request.principalId,actorId,source:anchor,target,previousIdentityVersion:plan.promotion.previousIdentityVersion,identityVersion:plan.promotion.identityVersion,epochIndex:nextEpoch.epochIndex,lifecycleRevision:run.row.lifecycle_revision+1,contextHash:authorizationRequest.contextHash,proposalHash:authorizationRequest.proposalHash,approval:request.approval,authority,recordedAt});const receiptPayload=hashJson(receipt);const planPayload=hashJson(plan);
      database.prepare('INSERT INTO identity_promotion_receipts VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(request.principalId,request.idempotencyKey,request.approval.operationId,anchor.runId,actorId,payload.json,payload.hash,planPayload.json,planPayload.hash,receiptPayload.json,receiptPayload.hash);
      return {kind:'applied',receipt};
    });
  }

  function transact<T>(operation: () => T): T {
    database.exec('BEGIN IMMEDIATE');
    try {
      pendingInitialActorCuts.clear();
      const watermark = z.strictObject({ value: counter }).parse(database.prepare('SELECT COALESCE(MAX(rowid),0) AS value FROM world_commits').get()).value;
      const result = operation();
      for (const runId of pendingInitialActorCuts) captureActorStateCut(runId,0);
      for (const value of database.prepare('SELECT run_id,commit_index FROM world_commits WHERE rowid>? ORDER BY rowid').all(watermark)) {
        const row = z.strictObject({run_id:RunIdSchema,commit_index:RevisionSchema}).parse(value);
        captureActorStateCut(row.run_id,row.commit_index);
      }
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  function runDraftHistoryEntry(rowValue:unknown){
    const row=z.strictObject({run_id:RunIdSchema,revision:RevisionSchema,principal_id:z.string(),recorded_at:z.string(),payload_json:z.string(),payload_hash:HashSchema}).parse(rowValue);
    const payload=z.strictObject({draft:RunConfigurationDraftSchema,principalId:z.string().trim().min(1).max(200),recordedAt:z.string().datetime({offset:true})}).parse(parseStoredJson(row.payload_json));
    if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(payload)!==row.payload_json||payload.draft.runId!==row.run_id||payload.draft.revision!==row.revision
      ||payload.principalId!==row.principal_id||payload.recordedAt!==row.recorded_at)throw new Error('Hash/metadatos de borrador durable no coinciden');
    return RunDraftHistoryEntrySchema.parse({...payload,payloadHash:row.payload_hash});
  }
  function identityPromotedConfiguration(runId:z.infer<typeof RunIdSchema>){return database.prepare('SELECT 1 FROM run_configuration_revisions WHERE run_id=? AND effective_commit_index>0 LIMIT 1').get(runId)!==undefined;}
  function effectiveRunDraftView(entry:ReturnType<typeof runDraftHistoryEntry>){
    if(!identityPromotedConfiguration(entry.draft.runId))return entry.draft;
    const run=parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(entry.draft.runId));
    const configuration=ReadyRunConfigurationSchema.parse(configurationAtCommit(run,run.row.commit_index).configuration);
    const latest=database.prepare('SELECT * FROM identity_promotion_receipts WHERE run_id=? ORDER BY rowid DESC LIMIT 1').get(entry.draft.runId);
    const receipt=latest===undefined?undefined:identityPromotionRecord(latest).receipt;
    const evidence={kind:'host-derived',derivationRef:receipt===undefined?`configuration-cut:${entry.draft.runId}:${configuration.configRevision}`:`identity-promotion:${receipt.operationId}`,recordedAt:receipt?.recordedAt??entry.recordedAt};
    const fields=['name','fictionalAt','continuity','roster','humanParticipants','worldSnapshot','dramaticLine','circadianPolicy','spanishVariety','narrationMode','inferenceProfile','budget','maxReformulations','audio'] as const;
    const changes=Object.fromEntries(fields.flatMap(field=>{
      const value=configuration[field];const old=entry.draft[field];if(value===undefined||(old?.kind==='configured'&&hashJson(old.value).hash===hashJson(value).hash))return [];
      return [[field,{kind:'configured',value,evidence}]];
    }));
    return RunConfigurationDraftSchema.parse({...entry.draft,...changes});
  }
  function readRunDraft(input:z.infer<typeof RunDraftReadSchema>){
    const row=input.revision===undefined
      ?database.prepare(`SELECT h.* FROM run_configuration_drafts d JOIN run_configuration_draft_history h ON h.run_id=d.run_id AND h.revision=d.revision WHERE d.run_id=?`).get(input.runId)
      :database.prepare('SELECT * FROM run_configuration_draft_history WHERE run_id=? AND revision=?').get(input.runId,input.revision);
    if(row===undefined)return undefined;return runDraftHistoryEntry(row);
  }
  function applyRunDraftPatch(draft:z.infer<typeof RunConfigurationDraftSchema>,patch:z.infer<typeof RunDraftPatchSchema>,principalId:string,recordedAt:string,revision:z.infer<typeof RevisionSchema>){
    const evidence=ProductionEvidenceSchema.parse({kind:'operator-choice',operatorId:principalId,recordedAt});
    const normalized=RunDraftPatchSchema.parse(patch);
    const world=normalized.worldSnapshot;
    if(world?.kind==='configured'||world?.kind==='proposed'){
      const catalog=world.value.circumstanceCatalog;
      const priorWorld=draft.worldSnapshot;
      const prior=priorWorld.kind==='configured'||priorWorld.kind==='proposed'?priorWorld.value.circumstanceCatalog:undefined;
      const content=(value:NonNullable<typeof catalog>)=>({environmentConditions:value.environmentConditions,
        objectTemplates:value.objectTemplates,sourceRefs:value.provenance.sourceRefs});
      const stampedCatalog=catalog===undefined?undefined:prior!==undefined&&canonicalJson(content(prior))===canonicalJson(content(catalog))
        ?prior:{...catalog,revision:revision+1,provenance:{authoredBy:principalId,recordedAt,sourceRefs:catalog.provenance.sourceRefs}};
      normalized.worldSnapshot={...world,value:{...world.value,runId:draft.runId,
        ...(stampedCatalog===undefined?{}:{circumstanceCatalog:stampedCatalog})}};
    }
    const budget=normalized.budget;
    if(budget?.kind==='configured'){
      const prior=draft.budget;
      if(prior.kind==='configured'&&canonicalJson(prior.value)===canonicalJson(budget.value)) normalized.budget=prior;
      else if(budget.value.requestTimeoutMs===undefined) normalized.budget={...budget,value:{...budget.value,requestTimeoutMs:30_000}};
    }
    const variety=normalized.spanishVariety;const previous=draft.spanishVariety;
    if(variety?.kind==='configured'&&variety.value.kind==='confirmed'){
      const old=previous.kind==='configured'&&previous.value.kind==='confirmed'&&previous.value.label===variety.value.label?previous.value:undefined;
      normalized.spanishVariety={...variety,value:old??{...variety.value,confirmedBy:principalId,confirmedAt:recordedAt}};
    }
    const stamped=RunDraftPatchSchema.parse(Object.fromEntries(Object.entries(normalized).map(([key,field])=>{
      if(field?.kind!=='configured')return [key,field];
      const current=draft[RunDraftPatchSchema.keyof().parse(key)];
      if(current?.kind==='configured'&&canonicalJson(current.value)===canonicalJson(field.value))return [key,current];
      return [key,{...field,evidence}];
    })));
    return RunConfigurationDraftSchema.parse({...draft,...stamped,revision});
  }

  function piOAuthJobRow(input:z.infer<typeof PiOAuthJobLookupSchema>){
    const value=database.prepare('SELECT * FROM pi_oauth_jobs WHERE job_id=?').get(input.jobId);if(value===undefined)return undefined;
    const row=z.strictObject({job_id:JobIdSchema,provider:z.literal('openai-codex'),kind:z.enum(['login','logout']),principal_id:z.string().trim().min(1).max(200),
      state:PiOAuthJobViewSchema.shape.state,revision:RevisionSchema,created_at:z.string(),updated_at:z.string(),safe_code:PiOAuthJobViewSchema.shape.safeCode,
      owner_token:z.string().uuid().nullable(),claim_token:z.string().uuid().nullable(),payload_json:z.string(),payload_hash:HashSchema}).parse(value);
    const job=PiOAuthJobViewSchema.parse(parseStoredJson(row.payload_json));
    if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(job)!==row.payload_json||job.jobId!==row.job_id||job.provider!==row.provider||job.kind!==row.kind
      ||job.state!==row.state||job.revision!==row.revision||job.createdAt!==row.created_at||job.updatedAt!==row.updated_at||job.safeCode!==row.safe_code)throw new Error('Metadata durable OAuth alterada');
    return {row,job};
  }
  function writePiOAuthJob(input:{current:NonNullable<ReturnType<typeof piOAuthJobRow>>;state:z.infer<typeof PiOAuthJobViewSchema>['state'];safeCode:z.infer<typeof PiOAuthJobViewSchema>['safeCode'];lease?:{ownerToken:string;claimToken:string}}){
    const job=PiOAuthJobViewSchema.parse({...input.current.job,state:input.state,safeCode:input.safeCode,revision:input.current.job.revision+1,updatedAt:new Date().toISOString()});
    const payload=hashJson(job);const lease=input.lease??{ownerToken:input.current.row.owner_token,claimToken:input.current.row.claim_token};
    const changed=database.prepare('UPDATE pi_oauth_jobs SET state=?,revision=?,updated_at=?,safe_code=?,owner_token=?,claim_token=?,payload_json=?,payload_hash=? WHERE job_id=? AND revision=?')
      .run(job.state,job.revision,job.updatedAt,job.safeCode,lease.ownerToken,lease.claimToken,payload.json,payload.hash,job.jobId,input.current.job.revision);
    if(changed.changes!==1)throw new Error('CAS OAuth cambió en transacción');database.prepare('INSERT INTO pi_oauth_job_history VALUES(?,?,?,?)').run(job.jobId,job.revision,payload.json,payload.hash);return job;
  }
  function replayPiOAuthOperation(input:{principalId:string;idempotencyKey:string;kind:'login'|'logout'|'cancel';requestHash:string}){
    if(database.prepare('SELECT 1 FROM fork_job_retries WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM fork_jobs WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM run_draft_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM pi_access_job_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM run_preflight_job_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM run_control_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined)return {kind:'idempotencyConflict'} satisfies {kind:'idempotencyConflict'};
    const value=database.prepare('SELECT * FROM pi_oauth_job_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey);if(value===undefined)return undefined;
    const row=z.strictObject({principal_id:z.string(),idempotency_key:z.string().uuid(),kind:z.enum(['login','logout','cancel']),request_hash:HashSchema,result_json:z.string(),result_hash:HashSchema}).parse(value);
    if(row.kind!==input.kind||row.request_hash!==input.requestHash)return {kind:'idempotencyConflict'} satisfies {kind:'idempotencyConflict'};
    const result=z.union([PiOAuthJobCreateResultSchema,PiOAuthJobMutationResultSchema]).parse(parseStoredJson(row.result_json));
    if(sha256(row.result_json)!==row.result_hash||canonicalJson(result)!==row.result_json)throw new Error('Receipt OAuth alterado');return result;
  }
  function recordPiOAuthOperation<T extends z.infer<typeof PiOAuthJobCreateResultSchema>|z.infer<typeof PiOAuthJobMutationResultSchema>>(input:{principalId:string;idempotencyKey:string;kind:'login'|'logout'|'cancel';requestHash:string;result:T}){
    const payload=hashJson(input.result);database.prepare('INSERT INTO pi_oauth_job_operations VALUES(?,?,?,?,?,?)').run(input.principalId,input.idempotencyKey,input.kind,input.requestHash,payload.json,payload.hash);return input.result;
  }

  function piAccessJobRow(input:z.infer<typeof PiAccessJobLookupSchema>){
    const value=database.prepare('SELECT * FROM pi_access_jobs WHERE job_id=?').get(input.jobId);if(value===undefined)return undefined;
    const row=z.strictObject({job_id:JobIdSchema,principal_id:z.string().trim().min(1).max(200),provider:z.enum(['openai-codex','anthropic']),
      profile_json:z.string(),profile_hash:HashSchema,state:PiAccessJobStateSchema,revision:RevisionSchema,created_at:z.string(),updated_at:z.string(),
      result_kind:PiAccessJobViewSchema.shape.resultKind,safe_code:PiAccessJobSafeCodeSchema.nullable(),owner_token:z.string().uuid().nullable(),claim_token:z.string().uuid().nullable(),
      payload_json:z.string(),payload_hash:HashSchema}).parse(value);
    const job=PiAccessJobViewSchema.parse(parseStoredJson(row.payload_json));
    const profile=PiAccessJobViewSchema.shape.profile.parse(parseStoredJson(row.profile_json));
    if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(job)!==row.payload_json||sha256(row.profile_json)!==row.profile_hash
      ||canonicalJson(profile)!==row.profile_json||canonicalJson(profile)!==canonicalJson(job.profile)
      ||job.jobId!==row.job_id||job.provider!==row.provider||job.profile.provider!==row.provider||job.state!==row.state
      ||job.revision!==row.revision||job.createdAt!==row.created_at||job.updatedAt!==row.updated_at||job.resultKind!==row.result_kind||job.safeCode!==row.safe_code
      ||(row.owner_token===null)!==(row.claim_token===null))throw new Error('Metadata durable del access-check alterada');
    return {row,job,profile};
  }
  function readPiAccessResult(input:{jobId:string}){
    const value=database.prepare('SELECT * FROM pi_access_job_results WHERE job_id=?').get(input.jobId);if(value===undefined)return undefined;
    const row=z.strictObject({job_id:JobIdSchema,provider:z.enum(['openai-codex','anthropic']),profile_fingerprint:HashSchema,
      account_fingerprint:HashSchema.nullable(),outcome:PiAccessJobViewSchema.shape.resultKind.unwrap(),checked_at:z.string(),expires_at:z.string(),
      result_json:z.string(),result_hash:HashSchema,completion_revision:RevisionSchema,completion_lease_hash:HashSchema,completion_request_hash:HashSchema}).parse(value);
    const result=PiAccessCheckStoredResultSchema.parse(parseStoredJson(row.result_json));
    if(sha256(row.result_json)!==row.result_hash||canonicalJson(result)!==row.result_json||result.kind!==row.outcome
      ||result.provider!==row.provider||result.profileFingerprint!==row.profile_fingerprint||result.accountFingerprint!==row.account_fingerprint
      ||Date.parse(row.checked_at)>=Date.parse(row.expires_at)
      ||hashJson({jobId:row.job_id,expectedRevision:row.completion_revision,leaseHash:row.completion_lease_hash,result,checkedAt:row.checked_at,expiresAt:row.expires_at}).hash!==row.completion_request_hash)
      throw new Error('Resultado privado durable del access-check alterado');
    return {row,result};
  }
  function piAccessCompletionProof(input:{jobId:string;expectedRevision:number;lease:{ownerToken:string;claimToken:string};result:z.infer<typeof PiAccessCheckStoredResultSchema>;checkedAt:string;expiresAt:string}){
    const leaseHash=hashJson(input.lease).hash;
    return {leaseHash,requestHash:hashJson({jobId:input.jobId,expectedRevision:input.expectedRevision,leaseHash,result:input.result,
      checkedAt:input.checkedAt,expiresAt:input.expiresAt}).hash};
  }
  function writePiAccessJob(input:{current:NonNullable<ReturnType<typeof piAccessJobRow>>;state:z.infer<typeof PiAccessJobViewSchema>['state'];
    resultKind:z.infer<typeof PiAccessJobViewSchema>['resultKind'];safeCode:z.infer<typeof PiAccessJobViewSchema>['safeCode'];
    passedResult:z.infer<typeof PiAccessJobViewSchema>['passedResult'];lease?:{ownerToken:string;claimToken:string}|null}){
    const job=PiAccessJobViewSchema.parse({...input.current.job,state:input.state,resultKind:input.resultKind,safeCode:input.safeCode,
      passedResult:input.passedResult,revision:input.current.job.revision+1,updatedAt:new Date().toISOString()});
    const payload=hashJson(job);const lease=input.lease===undefined
      ? {ownerToken:input.current.row.owner_token,claimToken:input.current.row.claim_token}
      : input.lease;
    const changed=database.prepare(`UPDATE pi_access_jobs SET state=?,revision=?,updated_at=?,result_kind=?,safe_code=?,owner_token=?,claim_token=?,payload_json=?,payload_hash=?
      WHERE job_id=? AND revision=?`).run(job.state,job.revision,job.updatedAt,job.resultKind,job.safeCode,lease?.ownerToken??null,lease?.claimToken??null,
      payload.json,payload.hash,job.jobId,input.current.job.revision);
    if(changed.changes!==1)throw new Error('CAS del job de access-check cambió en transacción');
    database.prepare('INSERT INTO pi_access_job_history VALUES(?,?,?,?)').run(job.jobId,job.revision,payload.json,payload.hash);
    return job;
  }
  function replayPiAccessOperation(input:{principalId:string;idempotencyKey:string;kind:'start'|'cancel';requestHash:string}){
    if(database.prepare('SELECT 1 FROM fork_job_retries WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM fork_jobs WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM run_draft_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM pi_oauth_job_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM run_preflight_job_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM run_control_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined)return {kind:'idempotencyConflict'} satisfies {kind:'idempotencyConflict'};
    const value=database.prepare('SELECT * FROM pi_access_job_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey);if(value===undefined)return undefined;
    const row=z.strictObject({principal_id:z.string(),idempotency_key:z.string().uuid(),kind:z.enum(['start','cancel']),request_hash:HashSchema,result_json:z.string(),result_hash:HashSchema}).parse(value);
    if(row.kind!==input.kind||row.request_hash!==input.requestHash)return {kind:'idempotencyConflict'} satisfies {kind:'idempotencyConflict'};
    const result=z.union([PiAccessJobCreateResultSchema,PiAccessJobMutationResultSchema]).parse(parseStoredJson(row.result_json));
    if(sha256(row.result_json)!==row.result_hash||canonicalJson(result)!==row.result_json)throw new Error('Receipt idempotente de access-check alterado');return result;
  }
  function recordPiAccessOperation<T extends z.infer<typeof PiAccessJobCreateResultSchema>|z.infer<typeof PiAccessJobMutationResultSchema>>(input:{principalId:string;idempotencyKey:string;kind:'start'|'cancel';requestHash:string;result:T}){
    const payload=hashJson(input.result);database.prepare('INSERT INTO pi_access_job_operations VALUES(?,?,?,?,?,?)').run(input.principalId,input.idempotencyKey,input.kind,input.requestHash,payload.json,payload.hash);return input.result;
  }

  function runPreflightJobRow(input:{runId:string;jobId:string}){
    const value=database.prepare('SELECT * FROM run_preflight_jobs WHERE run_id=? AND job_id=?').get(input.runId,input.jobId);if(value===undefined)return undefined;
    const row=z.strictObject({job_id:JobIdSchema,run_id:RunIdSchema,principal_id:z.string().trim().min(1).max(200),
      state:RunPreflightJobStateSchema,revision:RevisionSchema,created_at:z.string(),updated_at:z.string(),
      configuration_revision:RevisionSchema,configuration_hash:HashSchema,configuration_payload_hash:HashSchema,original_configuration_json:z.string(),configuration_json:z.string(),world_revision:RevisionSchema,world_seq:WorldSeqSchema,
      fictitious_at:FictionalInstantSchema,provider:z.enum(['openai-codex','anthropic']).nullable(),profile_fingerprint:HashSchema.nullable(),
      result_kind:RunPreflightJobViewSchema.shape.resultKind,safe_code:RunPreflightJobSafeCodeSchema.nullable(),
      owner_token:z.string().uuid().nullable(),claim_token:z.string().uuid().nullable(),payload_json:z.string(),payload_hash:HashSchema}).parse(value);
    const job=RunPreflightJobViewSchema.parse(parseStoredJson(row.payload_json));
    const configuration=ReadyRunConfigurationSchema.parse(parseStoredJson(row.configuration_json));
    const originalConfiguration=ReadyRunConfigurationSchema.parse(parseStoredJson(row.original_configuration_json));
    const expectedProjection=readyConfigurationAtSnapshot(originalConfiguration,configuration.worldSnapshot);
    const profile=resolveReadyInferenceProfile(configuration);
    if(sha256(row.original_configuration_json)!==row.configuration_hash||canonicalJson(originalConfiguration)!==row.original_configuration_json
      ||canonicalJson(expectedProjection)!==row.configuration_json
      ||sha256(row.payload_json)!==row.payload_hash||canonicalJson(job)!==row.payload_json
      ||sha256(row.configuration_json)!==row.configuration_payload_hash||canonicalJson(configuration)!==row.configuration_json
      ||configuration.runId!==row.run_id||configuration.configRevision!==row.configuration_revision
      ||configuration.worldSnapshot.revision!==row.world_revision||configuration.worldSnapshot.seq!==row.world_seq
      ||configuration.fictionalAt!==row.fictitious_at||profile.provider!==row.provider
      ||fingerprintInferenceProfile(profile)!==row.profile_fingerprint
      ||job.jobId!==row.job_id||job.runId!==row.run_id||job.state!==row.state||job.revision!==row.revision
      ||job.createdAt!==row.created_at||job.updatedAt!==row.updated_at||job.configurationRevision!==row.configuration_revision
      ||job.worldRevision!==row.world_revision||job.worldSeq!==row.world_seq||job.fictitiousAt!==row.fictitious_at
      ||job.resultKind!==row.result_kind||job.safeCode!==row.safe_code
      ||(row.owner_token===null)!==(row.claim_token===null))throw new Error('Metadata durable del preflight alterada');
    return {row,job,configuration};
  }
  function readRunPreflightJobResult(input:{runId:string;jobId:string}){
    const value=database.prepare('SELECT * FROM run_preflight_job_results WHERE job_id=?').get(input.jobId);if(value===undefined)return undefined;
    const row=z.strictObject({job_id:JobIdSchema,result_json:z.string(),result_hash:HashSchema,evidence_json:z.string(),evidence_hash:HashSchema,
      completion_revision:RevisionSchema,completion_lease_hash:HashSchema,completion_request_hash:HashSchema}).parse(value);
    const result=RunPreflightResultSchema.parse(parseStoredJson(row.result_json));
    const evidence=RunPreflightPrivateEvidenceSchema.parse(parseStoredJson(row.evidence_json));
    if(row.job_id!==input.jobId||sha256(row.result_json)!==row.result_hash||canonicalJson(result)!==row.result_json
      ||sha256(row.evidence_json)!==row.evidence_hash||canonicalJson(evidence)!==row.evidence_json)throw new Error('Resultado privado del preflight alterado');
    const current=runPreflightJobRow(input);if(current===undefined)throw new Error('Job de preflight sin fila al leer su resultado');
    const evaluation=RunPreflightEvaluationSchema.parse({fence:{configurationRevision:current.job.configurationRevision,configurationHash:current.row.configuration_hash,
      worldRevision:current.job.worldRevision,worldSeq:current.job.worldSeq,fictitiousAt:current.job.fictitiousAt},result,evidence});
    if(row.completion_revision+1!==current.job.revision||current.job.state!=='completed'||current.job.resultKind!==result.kind
      ||hashJson({runId:input.runId,jobId:input.jobId,expectedRevision:row.completion_revision,leaseHash:row.completion_lease_hash,evaluation}).hash!==row.completion_request_hash)
      throw new Error('Proof de completion del preflight alterado');
    return {row,result,evidence};
  }
  function runPreflightCompletionProof(input:{runId:string;jobId:string;expectedRevision:number;lease:{ownerToken:string;claimToken:string};evaluation:z.infer<typeof RunPreflightEvaluationSchema>}){
    const leaseHash=hashJson(input.lease).hash;
    return {leaseHash,requestHash:hashJson({runId:input.runId,jobId:input.jobId,expectedRevision:input.expectedRevision,leaseHash,evaluation:input.evaluation}).hash};
  }
  function writeRunPreflightJob(input:{current:NonNullable<ReturnType<typeof runPreflightJobRow>>;state:z.infer<typeof RunPreflightJobViewSchema>['state'];
    resultKind:z.infer<typeof RunPreflightJobViewSchema>['resultKind'];safeCode:z.infer<typeof RunPreflightJobViewSchema>['safeCode'];
    lease?:{ownerToken:string;claimToken:string}|null}){
    const job=RunPreflightJobViewSchema.parse({...input.current.job,state:input.state,resultKind:input.resultKind,safeCode:input.safeCode,
      revision:input.current.job.revision+1,updatedAt:new Date().toISOString()});
    const payload=hashJson(job);const lease=input.lease===undefined
      ? {ownerToken:input.current.row.owner_token,claimToken:input.current.row.claim_token}
      : input.lease;
    const changed=database.prepare(`UPDATE run_preflight_jobs SET state=?,revision=?,updated_at=?,result_kind=?,safe_code=?,owner_token=?,claim_token=?,payload_json=?,payload_hash=?
      WHERE job_id=? AND revision=?`).run(job.state,job.revision,job.updatedAt,job.resultKind,job.safeCode,lease?.ownerToken??null,lease?.claimToken??null,
      payload.json,payload.hash,job.jobId,input.current.job.revision);
    if(changed.changes!==1)throw new Error('CAS del job preflight cambió en transacción');
    database.prepare('INSERT INTO run_preflight_job_history VALUES(?,?,?,?)').run(job.jobId,job.revision,payload.json,payload.hash);
    return job;
  }
  function replayRunPreflightOperation(input:{principalId:string;idempotencyKey:string;kind:'start'|'cancel';requestHash:string}){
    if(database.prepare('SELECT 1 FROM fork_job_retries WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM fork_jobs WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM run_draft_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM pi_oauth_job_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM pi_access_job_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM run_control_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined)
      return {kind:'idempotencyConflict'} satisfies {kind:'idempotencyConflict'};
    const value=database.prepare('SELECT * FROM run_preflight_job_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey);if(value===undefined)return undefined;
    const row=z.strictObject({principal_id:z.string(),idempotency_key:z.string().uuid(),kind:z.enum(['start','cancel']),request_hash:HashSchema,result_json:z.string(),result_hash:HashSchema}).parse(value);
    if(row.kind!==input.kind||row.request_hash!==input.requestHash)return {kind:'idempotencyConflict'} satisfies {kind:'idempotencyConflict'};
    const result=RunPreflightJobOperationResultSchema.parse(parseStoredJson(row.result_json));
    if(sha256(row.result_json)!==row.result_hash||canonicalJson(result)!==row.result_json)throw new Error('Receipt idempotente de preflight alterado');return result;
  }
  function recordRunPreflightOperation<T extends z.infer<typeof RunPreflightJobOperationResultSchema>>(input:{principalId:string;idempotencyKey:string;kind:'start'|'cancel';requestHash:string;result:T}){
    const payload=hashJson(input.result);database.prepare('INSERT INTO run_preflight_job_operations VALUES(?,?,?,?,?,?)').run(input.principalId,input.idempotencyKey,input.kind,input.requestHash,payload.json,payload.hash);return input.result;
  }
  function runPreflightJobDocument(input:{runId:string;jobId:string}){
    const current=runPreflightJobRow(input);if(current===undefined)return undefined;
    const stored=readRunPreflightJobResult(input);
    if((current.job.state==='completed')!==(stored!==undefined))throw new Error('El resultado del preflight no coincide con su estado');
    if(stored!==undefined){
      if(current.job.resultKind!==stored.result.kind||stored.row.completion_revision+1!==current.job.revision)throw new Error('La revisión del resultado del preflight no coincide con su job');
      const profile=stored.evidence.profileFingerprint;
      if(profile!==null&&profile!==current.row.profile_fingerprint)throw new Error('La evidencia del preflight usa otro perfil');
      if(stored.evidence.provider!==null&&stored.evidence.provider!==current.row.provider)throw new Error('La evidencia del preflight usa otro proveedor');
      if(stored.evidence.accessReceipt!==null){
        const receipt=stored.evidence.accessReceipt;const access=readPiAccessResult({jobId:receipt.jobId});
        if(access===undefined||access.result.kind!==receipt.resultKind||access.result.provider!==receipt.provider
          ||access.result.profileFingerprint!==receipt.profileFingerprint||access.result.accountFingerprint!==receipt.accountFingerprint
          ||access.row.checked_at!==receipt.checkedAt||access.row.expires_at!==receipt.expiresAt)throw new Error('El recibo privado de acceso del preflight fue alterado');
      }
    }
    const worldValue=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(input.runId);
    let stale=worldValue===undefined;
    if(worldValue!==undefined){
      const run=parseWorldRun(worldValue);
      const currentConfiguration=ReadyRunConfigurationSchema.safeParse(run.configuration);
      stale ||= !['ready','paused','stopped'].includes(run.row.lifecycle)||run.row.config_revision!==current.job.configurationRevision
        ||run.row.configuration_hash!==current.row.configuration_hash||run.row.world_revision!==current.job.worldRevision
        ||run.row.last_seq!==current.job.worldSeq||run.snapshot.clock.instant!==current.job.fictitiousAt
        ||canonicalJson(run.snapshot)!==canonicalJson(current.configuration.worldSnapshot)
        ||!currentConfiguration.success;
    }
    if(stored?.evidence.accessReceipt!==null&&stored?.evidence.accessReceipt!==undefined){
      const receipt=stored.evidence.accessReceipt;
      stale ||= Date.parse(new Date().toISOString())>=Date.parse(receipt.expiresAt);
      const latest=database.prepare(`SELECT job_id,account_fingerprint FROM pi_access_job_results WHERE provider=? AND profile_fingerprint=?
        ORDER BY rowid DESC LIMIT 1`).get(receipt.provider,receipt.profileFingerprint);
      if(latest===undefined)stale=true;
      else{const latestReceipt=z.strictObject({job_id:JobIdSchema,account_fingerprint:HashSchema.nullable()}).parse(latest);
        stale ||= latestReceipt.job_id!==receipt.jobId||latestReceipt.account_fingerprint!==receipt.accountFingerprint;}
    }
    return RunPreflightJobDocumentSchema.parse({kind:'run-preflight-job-document',job:current.job,
      report:{kind:stale?'stale':'current',result:stored===undefined?null:projectPublicRunPreflightResult(stored.result)}});
  }

  function replayRunDraftOperation(input:{principalId:string;idempotencyKey:string;kind:'create'|'update'|'validate';requestHash:string}){
    if(database.prepare('SELECT 1 FROM fork_job_retries WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM fork_jobs WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM pi_oauth_job_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM pi_access_job_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM run_preflight_job_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
      ||database.prepare('SELECT 1 FROM run_control_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined)return RunDraftMutationResultSchema.parse({kind:'idempotencyConflict'});
    const value=database.prepare('SELECT operation_kind,request_hash,result_json,result_hash FROM run_draft_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey);
    if(value===undefined)return undefined;
    const row=z.strictObject({operation_kind:z.enum(['create','update','validate']),request_hash:HashSchema,result_json:z.string(),result_hash:HashSchema}).parse(value);
    if(row.operation_kind!==input.kind||row.request_hash!==input.requestHash)return RunDraftMutationResultSchema.parse({kind:'idempotencyConflict'});
    const result=RunDraftOperationResultSchema.parse(parseStoredJson(row.result_json));
    if(sha256(row.result_json)!==row.result_hash||canonicalJson(result)!==row.result_json)throw new Error('Resultado idempotente de borrador alterado');
    return result.kind==='created'||result.kind==='stored'?RunDraftMutationResultSchema.parse({kind:'existing',draft:result.draft}):result;
  }
  function recordRunDraftOperation<T extends z.infer<typeof RunDraftOperationResultSchema>>(input:{principalId:string;idempotencyKey:string;kind:'create'|'update'|'validate';requestHash:string;result:T;recordedAt:string}){
    const payload=hashJson(input.result);database.prepare('INSERT INTO run_draft_operations VALUES(?,?,?,?,?,?,?)')
      .run(input.principalId,input.idempotencyKey,input.kind,input.requestHash,payload.json,payload.hash,input.recordedAt);
    return input.result;
  }
  function appendRunDraftHistory(input:{draft:z.infer<typeof RunConfigurationDraftSchema>;principalId:string;recordedAt:string}){
    const payload=hashJson(input);database.prepare('INSERT INTO run_configuration_draft_history VALUES(?,?,?,?,?,?)')
      .run(input.draft.runId,input.draft.revision,input.principalId,input.recordedAt,payload.json,payload.hash);
  }

  function actorTurnJobView(rowValue: unknown): z.infer<typeof ActorTurnJobViewSchema> {
    const row = ActorTurnJobDbRowSchema.parse(rowValue);
    if (row.state === 'running' && (row.owner_token === null || row.claim_token === null)) {
      throw new Error('Job de actor running sin claim/owner durable');
    }
    const frozenPerceptionIds = frozenActorTurnPerceptionIds(row);
    const frozenWorldCut = frozenActorTurnWorldCut(row);
    if (row.state === 'running' && frozenPerceptionIds === null) {
      throw new Error('Job de actor running sin inbox congelado');
    }
    if (row.state === 'running' && frozenWorldCut === null) {
      throw new Error('Job de actor running sin corte World congelado');
    }
    const inputs = database.prepare(`
      SELECT i.perception_id,i.state,t.run_id AS intent_run_id,t.actor_id AS intent_actor_id,
        t.state AS intent_state,t.world_seq,p.run_id AS delivery_run_id,
        p.recipient_actor_id AS delivery_actor_id,d.state AS delivery_state
      FROM actor_turn_job_inputs i
      JOIN actor_turn_intents t ON t.perception_id=i.perception_id
      JOIN world_deliveries d ON d.perception_id=i.perception_id
      JOIN world_perceptions p ON p.perception_id=i.perception_id
      WHERE i.run_id=? AND i.actor_id=? AND i.job_id=? AND i.generation=?
      ORDER BY t.world_seq,i.perception_id
    `).all(row.run_id, row.actor_id, row.job_id, row.generation).map((value) => {
      const input = ActorTurnJobInputDbRowSchema.parse(value);
      if (input.intent_run_id !== row.run_id || input.intent_actor_id !== row.actor_id
        || input.delivery_run_id !== row.run_id || input.delivery_actor_id !== row.actor_id
        || input.delivery_state !== 'delivered') {
        throw new Error('Job de actor contiene una percepción ajena o no entregada');
      }
      if ((row.state === 'accepted' && input.state !== 'consumed')
        || (row.state === 'blocked' && input.state !== 'released')
        || (row.state !== 'accepted' && row.state !== 'blocked' && input.state !== 'assigned')) {
        throw new Error('El estado de las percepciones no coincide con el ciclo del job actoral');
      }
      return input.perception_id;
    });
    const activationValue = database.prepare(`SELECT i.activation_id,i.invitation_id,i.identity_version,i.trigger_kind,i.boundary_at,i.state,
        c.state AS cause_state,c.trigger_kind AS cause_trigger_kind,c.boundary_at AS cause_boundary_at
      FROM actor_activation_invitation_jobs j
      JOIN actor_activation_invitations i ON i.run_id=j.run_id AND i.invitation_id=j.invitation_id
      JOIN actor_activation_causes c ON c.run_id=i.run_id AND c.activation_id=i.activation_id
      WHERE j.run_id=? AND j.actor_id=? AND j.job_id=? AND j.generation=?`)
      .get(row.run_id,row.actor_id,row.job_id,row.generation);
    const activation = activationValue === undefined ? null : z.strictObject({
      activation_id:ActorActivationIdSchema,invitation_id:ActorActivationInvitationIdSchema,identity_version:counter,
      trigger_kind:z.enum(['initial-goal','routine-boundary']),boundary_at:counter.nullable(),
      cause_trigger_kind:z.enum(['initial-goal','routine-boundary']),cause_boundary_at:counter.nullable(),
      state:z.enum(['pending','assigned','consumed','blocked']),
      cause_state:z.enum(['pending','running','completed','blocked']),
    }).parse(activationValue);
    if (activation !== null) {
      if (inputs.length !== 0 || activation.trigger_kind !== activation.cause_trigger_kind
        || activation.boundary_at !== activation.cause_boundary_at
        || (row.state === 'queued' && activation.state !== 'assigned')
        || (row.state === 'running' && activation.state !== 'assigned')
        || (row.state === 'accepted' && !['assigned','consumed'].includes(activation.state))
        || (row.state === 'blocked' && !['assigned','blocked'].includes(activation.state))) {
        throw new Error('La relación técnica de activación no coincide con el job actoral');
      }
    } else if (inputs.length === 0) throw new Error('Job de actor sin percepciones asignadas');
    return ActorTurnJobViewSchema.parse({
      runId: row.run_id, actorId: row.actor_id, jobId: row.job_id, generation: row.generation,
      pulseId: row.pulse_id, lifecycleRevision: row.lifecycle_revision, state: row.state,
      failureCode: row.failure_code, perceptionIds: inputs, frozenPerceptionIds, frozenWorldCut,
      frozenDirectionRevision: row.frozen_direction_revision,
      activation:activation === null?null:{activationId:activation.activation_id,invitationId:activation.invitation_id,
        identityVersion:activation.identity_version,trigger:activation.trigger_kind==='initial-goal'
          ?{kind:'initial-goal'}:{kind:'routine-boundary',boundaryAt:FictionalInstantSchema.parse(activation.boundary_at)}},
    });
  }

  function stepJobView(input: { runId: string; jobId: string }) {
    const value = database.prepare('SELECT * FROM run_step_jobs WHERE run_id=? AND job_id=?').get(input.runId,input.jobId);
    if (value === undefined) return undefined;
    const row = z.strictObject({job_id:JobIdSchema,run_id:RunIdSchema,pulse_id:PulseIdSchema.nullable(),
      state:z.enum(['queued','running','succeeded','failed','canceled','interrupted']),revision:counter,lifecycle_revision:counter,created_at:counter,updated_at:counter}).parse(value);
    return RunStepJobViewSchema.parse({jobId:row.job_id,runId:row.run_id,pulseId:row.pulse_id,state:row.state,
      revision:row.revision,lifecycleRevision:row.lifecycle_revision,createdAt:row.created_at,updatedAt:row.updated_at});
  }

  function activeStepJob(runId: string) {
    const value = database.prepare("SELECT job_id FROM run_step_jobs WHERE run_id=? AND state IN('queued','running')").get(runId);
    return value === undefined ? undefined : stepJobView({runId,jobId:z.strictObject({job_id:JobIdSchema}).parse(value).job_id});
  }

  function finishStepJob(runId: z.infer<typeof RunIdSchema>, state: 'succeeded' | 'failed' | 'canceled') {
    const job = activeStepJob(runId);
    if (job === undefined) return undefined;
    const now = Date.now();
    database.prepare("UPDATE run_step_jobs SET state=?,revision=revision+1,updated_at=? WHERE job_id=? AND state IN('queued','running')")
      .run(state,now,job.jobId);
    if (state !== 'canceled') {
      const changed = database.prepare("UPDATE world_runs SET lifecycle='paused',lifecycle_revision=lifecycle_revision+1,updated_at=? WHERE run_id=? AND lifecycle='running' AND lifecycle_revision=?")
        .run(now,runId,job.lifecycleRevision);
      if (changed.changes === 1) blockRunningActorJobs(runId,now);
    }
    return stepJobView({runId,jobId:job.jobId});
  }

  function coordinatorPulseView(input: z.infer<typeof CoordinatorPulseLookupSchema>) {
    const value = database.prepare(`SELECT c.*,p.max_calls,p.consumed FROM coordinator_pulses c JOIN pulses p ON p.pulse_id=c.pulse_id
      WHERE c.run_id=? AND c.pulse_id=?`).get(input.runId, input.pulseId);
    if (value === undefined) return undefined;
    const row = z.strictObject({ pulse_id: PulseIdSchema, run_id: RunIdSchema, origin_kind: z.enum(['humanIntervention','actorAttempt','directionCircumstance','actorActivation']),
      origin_id: z.string(), commit_index: counter.nullable(), configuration_hash: HashSchema, state: z.enum(['running','completed','blocked']),
      lifecycle_revision: counter.nullable(), created_at: counter, updated_at: counter, max_calls: counter, consumed: counter }).parse(value);
    const run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(input.runId));
    if (row.configuration_hash !== run.row.configuration_hash) throw new Error('Configuración del pulso coordinador difiere de la corrida');
    const jobs = database.prepare(`SELECT * FROM actor_turn_jobs j WHERE run_id=? AND pulse_id=?
      AND NOT EXISTS(SELECT 1 FROM actor_turn_jobs newer WHERE newer.job_id=j.job_id AND newer.generation>j.generation)
      ORDER BY actor_id,job_id`).all(input.runId, input.pulseId).map(actorTurnJobView);
    const cause = row.origin_kind === 'actorActivation'
      ? (() => {
        if (row.commit_index !== null) throw new Error('Pulso técnico de activación contiene commit index');
        const activationId=ActorActivationIdSchema.parse(row.origin_id);
        const activationValue=database.prepare('SELECT state,trigger_kind,boundary_at FROM actor_activation_causes WHERE run_id=? AND activation_id=?')
          .get(row.run_id,activationId);
        if(activationValue===undefined)throw new Error('Pulso técnico sin causa de activación durable');
        const activation=z.strictObject({state:z.enum(['pending','running','completed','blocked']),
          trigger_kind:z.enum(['initial-goal','routine-boundary']),boundary_at:counter.nullable()}).parse(activationValue);
        const trigger=activation.trigger_kind==='initial-goal'?{kind:'initial-goal' as const}
          :{kind:'routine-boundary' as const,boundaryAt:FictionalInstantSchema.parse(activation.boundary_at)};
        return {kind:'actorActivation' as const,id:activationId,trigger};
      })()
      : (() => {
        if (row.commit_index === null) throw new Error('Pulso causado por evento sin commit index');
        return {kind:row.origin_kind,id:row.origin_id,commitIndex:row.commit_index};
      })();
    return CoordinatorPulseViewSchema.parse({ runId: row.run_id, pulseId: row.pulse_id,
      lifecycleRevision: row.lifecycle_revision,
      cause, state: row.state,
      maxCalls: row.max_calls, consumed: row.consumed, jobs });
  }

  function assignCoordinatorCauseJobs(run: ReturnType<typeof parseWorldRun>, configuration: z.infer<typeof ReadyRunConfigurationSchema>, pulse: z.infer<typeof CoordinatorPulseViewSchema>) {
    if(pulse.cause.kind==='actorActivation')return;
    const scene = run.snapshot.scenes.find((item) => item.id === run.snapshot.activeSceneId);
    const inputs = database.prepare(`SELECT i.actor_id,i.perception_id FROM actor_turn_intents i
      JOIN world_deliveries d ON d.perception_id=i.perception_id JOIN world_perceptions p ON p.perception_id=i.perception_id
      WHERE i.run_id=? AND p.origin_kind=? AND p.origin_id=? AND i.state='queued' AND d.state='delivered'
        AND NOT EXISTS(SELECT 1 FROM actor_turn_job_inputs a WHERE a.perception_id=i.perception_id AND a.state IN('assigned','consumed'))
      ORDER BY i.actor_id,i.perception_id`).all(pulse.runId,pulse.cause.kind,pulse.cause.id).map((item) => z.strictObject({ actor_id: CharacterIdSchema, perception_id: PerceptionIdSchema }).parse(item));
    for (const actorId of new Set(inputs.map((item) => item.actor_id))) {
      const actor = run.snapshot.entities.find((item) => item.kind === 'character' && item.characterId === actorId);
      if (!configuration.roster.activeCharacterIds.includes(actorId)
        || !configuration.roster.preparedCharacters.some((item) => item.characterId===actorId && item.identityVersion === (actor?.kind === 'character' && actor.preparation.kind==='prepared' ? actor.preparation.identityVersion : -1)) || scene?.lifecycle.kind !== 'open'
        || !scene.participantIds.includes(actorId) || actor?.kind !== 'character' || actor.preparation.kind !== 'prepared'
        || actor.presence.kind !== 'present' || actor.presence.sceneId !== scene.id || !characterCanReceiveAt({snapshot:run.snapshot,characterId:actorId})) continue;
      const activeValue = database.prepare(`SELECT * FROM actor_turn_jobs j WHERE run_id=? AND actor_id=? AND state IN('queued','running','blocked')
        AND NOT EXISTS(SELECT 1 FROM actor_turn_jobs newer WHERE newer.job_id=j.job_id AND newer.generation>j.generation) LIMIT 1`).get(pulse.runId,actorId);
      const active = activeValue === undefined ? undefined : ActorTurnJobDbRowSchema.parse(activeValue);
      if (active !== undefined && (active.state !== 'queued' || active.pulse_id !== pulse.pulseId
        || active.frozen_world_cut_json !== null || active.frozen_perception_ids_json !== null)) continue;
      const timestamp = Date.now();
      const jobId = active?.job_id ?? JobIdSchema.parse(randomUUID());
      const generation = active?.generation ?? 0;
      if (active === undefined) database.prepare(`INSERT INTO actor_turn_jobs(run_id,actor_id,job_id,generation,pulse_id,state,owner_token,claim_token,created_at,updated_at,lifecycle_revision)
        VALUES(?,?,?,?,?,'queued',NULL,NULL,?,?,?)`).run(pulse.runId,actorId,jobId,generation,pulse.pulseId,timestamp,timestamp,pulse.lifecycleRevision);
      for (const item of inputs.filter((item) => item.actor_id===actorId)) database.prepare(`INSERT INTO actor_turn_job_inputs(run_id,actor_id,job_id,generation,perception_id,state,assigned_at,consumed_at)
        VALUES(?,?,?,?,?,'assigned',?,NULL)`).run(pulse.runId,actorId,jobId,generation,item.perception_id,timestamp);
    }
  }

  function assignedActorTurnPerceptionIds(scope: {
    runId: z.infer<typeof RunIdSchema>;
    actorId: z.infer<typeof CharacterIdSchema>;
    jobId: z.infer<typeof JobIdSchema>;
    generation: number;
  }): string[] {
    return database.prepare(`
      SELECT perception_id FROM actor_turn_job_inputs
      WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND state='assigned'
      ORDER BY perception_id
    `).all(scope.runId, scope.actorId, scope.jobId, scope.generation).map((value) =>
      z.strictObject({ perception_id: PerceptionIdSchema }).parse(value).perception_id);
  }

  function frozenActorTurnPerceptionIds(row: z.infer<typeof ActorTurnJobDbRowSchema>): string[] | null {
    if (row.frozen_perception_ids_json === null) return null;
    const ids = z.array(PerceptionIdSchema).max(100_000).parse(parseStoredJson(row.frozen_perception_ids_json));
    if (new Set(ids).size !== ids.length || canonicalJson(ids) !== row.frozen_perception_ids_json) {
      throw new Error('El inbox congelado del job actoral no es válido ni canónico');
    }
    return ids;
  }

  function frozenActorTurnWorldCut(row: z.infer<typeof ActorTurnJobDbRowSchema>) {
    if (row.frozen_world_cut_json === null) return null;
    const cut = FrozenActorWorldCutSchema.parse(parseStoredJson(row.frozen_world_cut_json));
    if (canonicalJson(cut) !== row.frozen_world_cut_json
      || canonicalJson(cut.perceptionIds) !== canonicalJson(frozenActorTurnPerceptionIds(row))) {
      throw new Error('El corte World congelado del job actoral no coincide con su inbox');
    }
    return cut;
  }

  function parseWorldRun(rowValue: unknown) {
    const row = WorldRunRowSchema.parse(rowValue);
    const configuration = parseStoredJson(row.configuration_json);
    const fence = WorldContinuityFenceSchema.parse(parseStoredJson(row.continuity_fence_json));
    const initialSnapshot = WorldSnapshotSchema.parse(parseStoredJson(row.initial_snapshot_json));
    const snapshot = WorldSnapshotSchema.parse(parseStoredJson(row.snapshot_json));
    if (initialSnapshot.runId !== row.run_id || snapshot.runId !== row.run_id
      || snapshot.revision !== row.world_revision || snapshot.seq !== row.last_seq) {
      throw new Error('Metadatos de world run no coinciden con los snapshots');
    }
    if (hashJson(configuration).hash !== row.configuration_hash || hashJson(fence).json !== row.continuity_fence_json
      || hashJson(initialSnapshot).hash !== row.initial_snapshot_hash || hashJson(snapshot).hash !== row.snapshot_hash) {
      throw new Error('Hash o JSON del world journal no coincide');
    }
    return { row, configuration, fence, initialSnapshot, snapshot };
  }

  function runLifecycleState(run: ReturnType<typeof parseWorldRun>) {
    return RunLifecycleStateSchema.parse({
      runId: run.row.run_id,
      lifecycle: run.row.lifecycle,
      lifecycleRevision: run.row.lifecycle_revision,
      configRevision: run.row.config_revision,
      worldRevision: run.row.world_revision,
      lastWorldSeq: run.row.last_seq,
      createdAt: run.row.created_at ?? null,
      updatedAt: run.row.updated_at,
      closedAt: run.row.closed_at === null ? null : new Date(run.row.closed_at).toISOString(),
    });
  }

  function runInferenceProfile(run: ReturnType<typeof parseWorldRun>) {
    const profile = z.object({ inferenceProfile: PersistedInferenceProfileSchema.optional() }).parse(run.configuration);
    return resolveReadyInferenceProfile(profile);
  }
  function actorJobInferenceProfile(execution: z.infer<typeof ActorJobExecutionSchema>) {
    if (claimedActorJob(execution) === undefined) throw new Error('Claim de perfil actoral inactivo');
    const run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(execution.runId));
    const selected = runInferenceProfile(run);
    const sessionValue = currentActorSession(run,execution.actorId);
    if (sessionValue !== undefined && canonicalJson(resolveStoredPiProfile(sessionValue.profile)) !== canonicalJson(selected)) throw new Error('Perfil actoral registrado distinto de la configuración del claim');
    return selected;
  }

  function snapshotAtCut(run: ReturnType<typeof parseWorldRun>, throughWorldSeq: number) {
    if (throughWorldSeq < run.initialSnapshot.seq || throughWorldSeq > run.row.last_seq) return undefined;
    if (throughWorldSeq === run.initialSnapshot.seq) return run.initialSnapshot;
    const rowValue = database.prepare(`
      SELECT snapshot_json,snapshot_hash,world_revision,last_seq FROM world_commits
      WHERE run_id=? AND last_seq=? ORDER BY commit_index ASC LIMIT 1
    `).get(run.row.run_id, throughWorldSeq);
    if (rowValue === undefined) return undefined;
    const row = z.strictObject({
      snapshot_json: z.string(), snapshot_hash: HashSchema, world_revision: counter, last_seq: counter,
    }).parse(rowValue);
    if (sha256(row.snapshot_json) !== row.snapshot_hash) throw new Error('Hash de snapshot en world commits no coincide');
    const snapshot = WorldSnapshotSchema.parse(parseStoredJson(row.snapshot_json));
    if (canonicalJson(snapshot) !== row.snapshot_json || snapshot.runId !== run.row.run_id
      || snapshot.revision !== row.world_revision || snapshot.seq !== row.last_seq || row.last_seq !== throughWorldSeq) {
      throw new Error('El corte no coincide con el snapshot de world commit persistido');
    }
    return snapshot;
  }

  function snapshotAndCommitAtCut(
    run: ReturnType<typeof parseWorldRun>,
    expectedWorldRevision: number,
    throughWorldSeq: number,
  ): { snapshot: z.infer<typeof WorldSnapshotSchema>; commitIndex: number } | undefined {
    if (run.initialSnapshot.revision === expectedWorldRevision && run.initialSnapshot.seq === throughWorldSeq) {
      return { snapshot: run.initialSnapshot, commitIndex: 0 };
    }
    const rowValue = database.prepare(`
      SELECT snapshot_json,snapshot_hash,world_revision,last_seq,commit_index FROM world_commits
      WHERE run_id=? AND world_revision=? AND last_seq=? ORDER BY commit_index DESC LIMIT 1
    `).get(run.row.run_id, expectedWorldRevision, throughWorldSeq);
    if (rowValue === undefined) return undefined;
    const row = z.strictObject({
      snapshot_json: z.string(), snapshot_hash: HashSchema, world_revision: counter,
      last_seq: counter, commit_index: counter,
    }).parse(rowValue);
    if (sha256(row.snapshot_json) !== row.snapshot_hash) throw new Error('Hash de snapshot Pi no coincide');
    const snapshot = WorldSnapshotSchema.parse(parseStoredJson(row.snapshot_json));
    if (canonicalJson(snapshot) !== row.snapshot_json || snapshot.runId !== run.row.run_id
      || snapshot.revision !== row.world_revision || snapshot.seq !== row.last_seq
      || row.world_revision !== expectedWorldRevision || row.last_seq !== throughWorldSeq) {
      throw new Error('El snapshot no corresponde al corte Pi indexado');
    }
    return { snapshot, commitIndex: row.commit_index };
  }

  function recordExperienceWithinTransaction(frozen: FrozenExperience): 'stored' | 'existing' {
    const row = database.prepare('SELECT canonical_payload,payload_hash FROM experiences WHERE experience_id=?')
      .get(frozen.envelope.experienceId);
    if (row !== undefined) {
      const existing = experienceRow.parse(row);
      if (existing.payload_hash !== frozen.payloadHash || existing.canonical_payload !== frozen.canonicalPayload) {
        throw new Error('ExperienceId no admite otro payload');
      }
      database.prepare(`
        INSERT OR IGNORE INTO memory_outbox(experience_id,created_at)
          SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM memory_receipts WHERE experience_id=?)
      `).run(frozen.envelope.experienceId, Date.now(), frozen.envelope.experienceId);
      return 'existing';
    }
    database.prepare('INSERT INTO experiences VALUES(?,?,?,?,?,?)').run(
      frozen.envelope.experienceId, frozen.envelope.runId, frozen.envelope.actorId,
      frozen.envelope.worldSeq, frozen.canonicalPayload, frozen.payloadHash,
    );
    database.prepare('INSERT INTO memory_outbox(experience_id,created_at) VALUES(?,?)')
      .run(frozen.envelope.experienceId, Date.now());
    return 'stored';
  }

  function proposalRecord(runId: z.infer<typeof RunIdSchema>, proposalId: z.infer<typeof ProposalIdSchema>, version: number) {
    const rowValue = database.prepare(`
      SELECT proposal_id,version,actor_id,scene_id,attempt_id,base_revision,job_id,generation,proposal_slot,
        payload_json,attempt_hash,exact_content_hash,status FROM world_proposals
      WHERE run_id=? AND proposal_id=? AND version=?
    `).get(runId, proposalId, version);
    if (rowValue === undefined) throw new Error('Propuesta no registrada');
    const row = WorldProposalDbRowSchema.parse(rowValue);
    const record = WorldProposalRecordSchema.parse(parseStoredJson(row.payload_json));
    if (canonicalJson(record) !== row.payload_json || record.proposalId !== row.proposal_id
      || record.version !== row.version || record.actorId !== row.actor_id || record.sceneId !== row.scene_id
      || record.attemptId !== row.attempt_id || record.baseRevision !== row.base_revision
      || record.jobId !== (row.job_id ?? undefined) || record.generation !== (row.generation ?? undefined)
      || record.proposalSlot !== (row.proposal_slot ?? undefined)
      || hashJson(record.attempt).hash !== row.attempt_hash || row.attempt_hash !== record.attemptHash
      || row.exact_content_hash !== record.exactContentHash) throw new Error('Hash o metadatos de propuesta no coinciden');
    return { row, record };
  }

  function reviewRecord(rowValue: unknown) {
    const row = WorldReviewDbRowSchema.parse(rowValue);
    const review = ContinuistaStoredReviewSchema.parse(parseStoredJson(row.payload_json));
    if (canonicalJson(review) !== row.payload_json || sha256(row.payload_json) !== row.payload_hash
      || row.verdict !== review.verdict || row.complete !== Number(review.complete)
      || row.state_revision !== review.stateRevision || row.exact_content_hash !== review.exactContentHash) {
      throw new Error('Hash o metadatos de revisión no coinciden');
    }
    return { row, review };
  }

  function reviewIsComplete(review: z.infer<typeof ContinuistaReviewInputSchema>): boolean {
    return review.complete
      && ContinuistaCriterionSchema.options.every((criterion) => review.criterionCodes.includes(criterion))
      && review.evidenceRefs.length > 0;
  }

  const IdentityBindingSchema=z.strictObject({runId:RunIdSchema,actorId:CharacterIdSchema,epochIndex:RevisionSchema,bindingIndex:RevisionSchema,sessionId:z.string().min(1),sessionPath:z.string().min(1),preparedContextHash:HashSchema,profile:ActorSessionProfileSchema});
  const JobIdentityBindingSchema=z.strictObject({runId:RunIdSchema,actorId:CharacterIdSchema,jobId:JobIdSchema,generation:RevisionSchema,epochIndex:RevisionSchema,configurationRevision:RevisionSchema,configurationHash:HashSchema,preparedContextHash:HashSchema,commitIndex:RevisionSchema,lifecycleRevision:RevisionSchema});
  function identityEpochs(run:ReturnType<typeof parseWorldRun>,actorId:z.infer<typeof CharacterIdSchema>){
    let previous:z.infer<typeof ActorIdentityEpochSchema>|undefined;
    const values=database.prepare('SELECT * FROM actor_identity_epochs WHERE run_id=? AND actor_id=? ORDER BY epoch_index').all(run.row.run_id,actorId);
    if(values.length===0&&database.prepare('SELECT 1 FROM identity_promotion_receipts WHERE run_id=? LIMIT 1').get(run.row.run_id)!==undefined
      &&ReadyRunConfigurationSchema.parse(run.configuration).roster.preparedCharacters.some(actor=>actor.characterId===actorId))throw new Error('IDENTITY_EPOCH_MISSING');
    return values.map((value,index)=>{
      const row=z.strictObject({run_id:RunIdSchema,actor_id:CharacterIdSchema,epoch_index:RevisionSchema,payload_json:z.string(),payload_hash:HashSchema}).parse(value);
      const epoch=ActorIdentityEpochSchema.parse(parseStoredJson(row.payload_json));
      if(canonicalJson(epoch)!==row.payload_json||sha256(row.payload_json)!==row.payload_hash||epoch.runId!==row.run_id||epoch.actorId!==row.actor_id||epoch.epochIndex!==row.epoch_index||epoch.epochIndex!==index
        ||(previous===undefined?epoch.activationCommitIndex!==0:epoch.activationCommitIndex<=previous.activationCommitIndex||epoch.identityVersion!==previous.identityVersion+1))throw new Error('IDENTITY_EPOCH_INVALID');
      const configuration=configurationAtCommit(run,epoch.activationCommitIndex);const ready=ReadyRunConfigurationSchema.parse(configuration.configuration);const actor=ready.roster.preparedCharacters.find(actor=>actor.characterId===actorId);
      if(configuration.effectiveCommitIndex!==epoch.activationCommitIndex||configuration.configurationRevision!==epoch.configurationRevision||configuration.configurationHash!==epoch.configurationHash||actor===undefined||actor.identityVersion!==epoch.identityVersion||hashJson(actor).hash!==epoch.preparedContextHash)throw new Error('IDENTITY_EPOCH_SOURCE_INVALID');
      previous=epoch;return epoch;
    });
  }
  function identityBinding(epoch:z.infer<typeof ActorIdentityEpochSchema>){
    const values=database.prepare('SELECT * FROM actor_identity_session_bindings WHERE run_id=? AND actor_id=? AND epoch_index=? ORDER BY binding_index').all(epoch.runId,epoch.actorId,epoch.epochIndex);
    return values.map((value,index)=>{
      const row=z.strictObject({run_id:RunIdSchema,actor_id:CharacterIdSchema,epoch_index:RevisionSchema,binding_index:RevisionSchema,session_id:z.string(),session_path:z.string(),payload_json:z.string(),payload_hash:HashSchema}).parse(value);
      const binding=IdentityBindingSchema.parse(parseStoredJson(row.payload_json));
      if(canonicalJson(binding)!==row.payload_json||sha256(row.payload_json)!==row.payload_hash||binding.runId!==epoch.runId||binding.actorId!==epoch.actorId||binding.epochIndex!==epoch.epochIndex||row.run_id!==binding.runId||row.actor_id!==binding.actorId||row.epoch_index!==binding.epochIndex||row.binding_index!==binding.bindingIndex||binding.bindingIndex!==index||row.session_id!==binding.sessionId||row.session_path!==binding.sessionPath||binding.preparedContextHash!==epoch.preparedContextHash)throw new Error('IDENTITY_SESSION_BINDING_INVALID');
      return binding;
    }).at(-1);
  }
  function archivedIdentitySession(epoch:z.infer<typeof ActorIdentityEpochSchema>){
    const value=database.prepare('SELECT * FROM actor_pi_session_archives WHERE run_id=? AND actor_id=? AND epoch_index=?').get(epoch.runId,epoch.actorId,epoch.epochIndex);const binding=identityBinding(epoch);
    if(value===undefined){if(binding!==undefined)throw new Error('IDENTITY_SESSION_ARCHIVE_MISSING');return undefined;}
    const row=z.strictObject({run_id:RunIdSchema,actor_id:CharacterIdSchema,epoch_index:RevisionSchema,session_id:z.string(),session_path:z.string(),row_json:z.string(),row_hash:HashSchema}).parse(value);
    const head=ActorPiSessionRowSchema.parse(parseStoredJson(row.row_json));const base=actorSessionBase(head);
    if(binding===undefined||canonicalJson(head)!==row.row_json||sha256(row.row_json)!==row.row_hash||head.run_id!==epoch.runId||head.actor_id!==epoch.actorId||row.run_id!==epoch.runId||row.actor_id!==epoch.actorId||row.epoch_index!==epoch.epochIndex||row.session_id!==base.sessionId||row.session_path!==base.sessionPath||base.sessionId!==binding.sessionId||base.sessionPath!==binding.sessionPath||base.preparedContextHash!==binding.preparedContextHash||canonicalJson(base.profile)!==canonicalJson(binding.profile))throw new Error('IDENTITY_SESSION_ARCHIVE_INVALID');
    return {row:head,base};
  }
  function currentActorSession(run:ReturnType<typeof parseWorldRun>,actorId:z.infer<typeof CharacterIdSchema>){
    const value=database.prepare('SELECT * FROM actor_pi_sessions WHERE run_id=? AND actor_id=?').get(run.row.run_id,actorId);
    const epochs=identityEpochs(run,actorId);const active=epochs.at(-1);
    if(active===undefined){
      if(database.prepare('SELECT 1 FROM identity_promotion_receipts WHERE run_id=? AND actor_id=? LIMIT 1').get(run.row.run_id,actorId)!==undefined)throw new Error('IDENTITY_EPOCH_MISSING');
      if(value===undefined)return undefined;const base=actorSessionBase(value);const context=run.fence.contexts.find(context=>context.actorId===actorId);
      if(context===undefined||context.preparedContextHash!==base.preparedContextHash||canonicalJson(resolveStoredPiProfile(base.profile))!==canonicalJson(runInferenceProfile(run)))throw new Error('IDENTITY_LEGACY_HEAD_INVALID');
      return base;
    }
    const prepared=ReadyRunConfigurationSchema.parse(run.configuration).roster.preparedCharacters.find(actor=>actor.characterId===actorId);
    if(prepared===undefined||hashJson(prepared).hash!==active.preparedContextHash||prepared.identityVersion!==active.identityVersion)throw new Error('IDENTITY_EPOCH_HEAD_DIVERGED');
    let finalArchive:ReturnType<typeof archivedIdentitySession>;
    for(const epoch of epochs.slice(0,-1)){const archive=archivedIdentitySession(epoch);if(archive!==undefined)finalArchive=archive;}
    const binding=identityBinding(active);
    if(binding===undefined){
      if(value!==undefined&&(finalArchive===undefined||canonicalJson(ActorPiSessionRowSchema.parse(value))!==canonicalJson(finalArchive.row)))throw new Error('IDENTITY_RESERVED_HEAD_INVALID');
      if(value===undefined&&finalArchive!==undefined)throw new Error('IDENTITY_RESERVED_HEAD_MISSING');
      if(database.prepare('SELECT 1 FROM actor_pi_session_archives WHERE run_id=? AND actor_id=? AND epoch_index=?').get(active.runId,active.actorId,active.epochIndex))throw new Error('IDENTITY_RESERVED_ARCHIVE_INVALID');
      return undefined;
    }
    if(value===undefined)throw new Error('IDENTITY_ACTIVE_SESSION_MISSING');const base=actorSessionBase(value);
    if(base.sessionId!==binding.sessionId||base.sessionPath!==binding.sessionPath||base.preparedContextHash!==binding.preparedContextHash||canonicalJson(base.profile)!==canonicalJson(binding.profile))throw new Error('IDENTITY_ACTIVE_SESSION_INVALID');
    if(database.prepare('SELECT 1 FROM actor_pi_session_archives WHERE run_id=? AND actor_id=? AND epoch_index=?').get(active.runId,active.actorId,active.epochIndex))throw new Error('IDENTITY_ACTIVE_ARCHIVE_INVALID');
    return base;
  }
  function bindIdentitySession(epoch:z.infer<typeof ActorIdentityEpochSchema>,session:z.infer<typeof ActorSessionBaseSchema>){
    if(session.preparedContextHash!==epoch.preparedContextHash)throw new Error('IDENTITY_SESSION_PREPARATION_INVALID');
    const previous=identityBinding(epoch);const binding=IdentityBindingSchema.parse({runId:epoch.runId,actorId:epoch.actorId,epochIndex:epoch.epochIndex,bindingIndex:previous===undefined?0:previous.bindingIndex+1,sessionId:session.sessionId,sessionPath:session.sessionPath,preparedContextHash:session.preparedContextHash,profile:session.profile});const payload=hashJson(binding);
    database.prepare('INSERT INTO actor_identity_session_bindings VALUES(?,?,?,?,?,?,?,?)').run(epoch.runId,epoch.actorId,epoch.epochIndex,binding.bindingIndex,session.sessionId,session.sessionPath,payload.json,payload.hash);
  }
  function storeIdentityEpoch(epoch:z.infer<typeof ActorIdentityEpochSchema>){const payload=hashJson(epoch);database.prepare('INSERT INTO actor_identity_epochs VALUES(?,?,?,?,?)').run(epoch.runId,epoch.actorId,epoch.epochIndex,payload.json,payload.hash);}
  function assertIndependentSession(sessionId:string,sessionPath:string){
    if(database.prepare(`SELECT 1 FROM actor_pi_sessions WHERE session_id=? OR session_path=?
      UNION ALL SELECT 1 FROM actor_pi_session_archives WHERE session_id=? OR session_path=?
      UNION ALL SELECT 1 FROM actor_identity_session_bindings WHERE session_id=? OR session_path=?
      UNION ALL SELECT 1 FROM continuista_sessions WHERE json_extract(payload_json,'$.sessionId')=? OR json_extract(payload_json,'$.sessionPath')=?
      UNION ALL SELECT 1 FROM administrative_sessions WHERE json_extract(payload_json,'$.sessionId')=? OR json_extract(payload_json,'$.sessionPath')=? LIMIT 1`)
      .get(sessionId,sessionPath,sessionId,sessionPath,sessionId,sessionPath,sessionId,sessionPath,sessionId,sessionPath)!==undefined
      ||database.prepare("SELECT 1 FROM configurator_sessions WHERE json_extract(payload_json,'$.sessionId')=? OR session_path=? LIMIT 1").get(sessionId,sessionPath)!==undefined)throw new Error('IDENTITY_SESSION_NOT_INDEPENDENT');
  }
  function assertJobIdentityBinding(job:z.infer<typeof ActorTurnJobDbRowSchema>,run:ReturnType<typeof parseWorldRun>){
    const epoch=identityEpochs(run,job.actor_id).at(-1);if(epoch===undefined)return;
    const value=database.prepare('SELECT payload_json,payload_hash FROM actor_job_identity_bindings WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?').get(job.run_id,job.actor_id,job.job_id,job.generation);
    if(value===undefined)throw new Error('IDENTITY_JOB_BINDING_MISSING');const row=z.strictObject({payload_json:z.string(),payload_hash:HashSchema}).parse(value);const binding=JobIdentityBindingSchema.parse(parseStoredJson(row.payload_json));
    if(canonicalJson(binding)!==row.payload_json||sha256(row.payload_json)!==row.payload_hash||binding.runId!==job.run_id||binding.actorId!==job.actor_id||binding.jobId!==job.job_id||binding.generation!==job.generation||binding.epochIndex!==epoch.epochIndex||binding.configurationRevision!==run.row.config_revision||binding.configurationHash!==run.row.configuration_hash||binding.preparedContextHash!==epoch.preparedContextHash||binding.lifecycleRevision!==run.row.lifecycle_revision)throw new Error('IDENTITY_JOB_BINDING_STALE');
    const cut=frozenActorTurnWorldCut(job);const exact=snapshotAtExactConfigurationCommit(run,binding.commitIndex);const configuration=configurationAtCommit(run,binding.commitIndex);
    if(cut===null||exact.snapshot.revision!==cut.worldRevision||exact.snapshot.seq!==cut.worldSeq||exact.snapshot.clock.instant!==cut.fictionalAt||epoch.activationCommitIndex>binding.commitIndex||configuration.configurationRevision!==binding.configurationRevision||configuration.configurationHash!==binding.configurationHash)throw new Error('IDENTITY_JOB_BINDING_CUT_INVALID');
  }
  function bindClaimedIdentityJob(job:z.infer<typeof ActorTurnJobDbRowSchema>,run:ReturnType<typeof parseWorldRun>){
    const epoch=identityEpochs(run,job.actor_id).at(-1);if(epoch===undefined)return;
    if(database.prepare('SELECT 1 FROM actor_job_identity_bindings WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?').get(job.run_id,job.actor_id,job.job_id,job.generation)!==undefined){assertJobIdentityBinding(job,run);return;}
    const cut=frozenActorTurnWorldCut(job);const exact=cut===null?undefined:snapshotAndCommitAtCut(run,cut.worldRevision,cut.worldSeq);if(exact===undefined||exact.snapshot.clock.instant!==cut?.fictionalAt)throw new Error('IDENTITY_JOB_BINDING_CUT_INVALID');
    const configuration=configurationAtCommit(run,exact.commitIndex);if(configuration.configurationHash!==run.row.configuration_hash||configuration.configurationRevision!==run.row.config_revision||epoch.activationCommitIndex>exact.commitIndex)throw new Error('IDENTITY_JOB_BINDING_STALE');
    const payload=hashJson(JobIdentityBindingSchema.parse({runId:job.run_id,actorId:job.actor_id,jobId:job.job_id,generation:job.generation,epochIndex:epoch.epochIndex,configurationRevision:run.row.config_revision,configurationHash:run.row.configuration_hash,preparedContextHash:epoch.preparedContextHash,commitIndex:exact.commitIndex,lifecycleRevision:run.row.lifecycle_revision}));
    database.prepare('INSERT INTO actor_job_identity_bindings VALUES(?,?,?,?,?,?)').run(job.run_id,job.actor_id,job.job_id,job.generation,payload.json,payload.hash);
  }

  function actorSessionBase(rowValue: unknown): z.infer<typeof ActorSessionBaseSchema> {
    const row = ActorPiSessionRowSchema.parse(rowValue);
    const profile = ActorSessionProfileSchema.parse(parseStoredJson(row.profile_json));
    if (canonicalJson(profile) !== row.profile_json || sha256(row.profile_json) !== row.profile_hash) {
      throw new Error('Perfil Pi durable alterado o con hash inválido');
    }
    return ActorSessionBaseSchema.parse({
      sessionId: row.session_id, sessionPath: row.session_path,
      preparedContextHash: row.prepared_context_hash, profile,
      sessionRevision: row.session_revision, committedLeafId: row.committed_leaf_id,
    });
  }

  function actorCandidateFromRow(rowValue: unknown): z.infer<typeof ActorPiCandidateSchema> {
    const row = ActorPiCandidateDbRowSchema.parse(rowValue);
    if (sha256(row.canonical_payload) !== row.payload_hash) throw new Error('Hash de candidato Pi no coincide');
    const candidate = ActorPiCandidateSchema.parse(parseStoredJson(row.canonical_payload));
    const ids = z.array(PerceptionIdSchema).max(100_000).parse(parseStoredJson(row.input_perception_ids_json));
    if (canonicalJson(candidate) !== row.canonical_payload || canonicalJson(ids) !== row.input_perception_ids_json
      || candidate.candidateId !== row.candidate_id || candidate.runId !== row.run_id
      || candidate.actorId !== row.actor_id || candidate.scope.jobId !== row.job_id
      || candidate.scope.generation !== row.generation || candidate.scope.pulseId !== row.pulse_id
      || candidate.turnId !== row.turn_id || candidate.kind !== row.candidate_kind
      || candidate.base.sessionRevision !== row.base_session_revision
      || candidate.base.committedLeafId !== row.base_leaf_id
      || candidate.base.sessionId !== row.session_id || candidate.base.sessionPath !== row.session_path
      || candidate.base.preparedContextHash !== row.prepared_context_hash
      || candidate.inputCut.worldRevision !== row.input_world_revision
      || candidate.inputCut.worldSeq !== row.input_world_seq
      || candidate.inputCut.fictionalAt !== row.input_fictional_at
      || canonicalJson(candidate.inputCut.perceptionIds) !== row.input_perception_ids_json) {
      throw new Error('Metadatos del candidato Pi no coinciden con su payload');
    }
    const expectedRequestSeq = candidate.kind === 'request-input' ? candidate.requestSeq : null;
    const expectedOutcome = candidate.kind === 'terminal-candidate' ? candidate.outcome : null;
    const expectedLastRequestSeq = candidate.kind === 'terminal-candidate' ? candidate.lastRequestSeq : null;
    if (row.request_seq !== expectedRequestSeq || row.outcome !== expectedOutcome || row.last_request_seq !== expectedLastRequestSeq
      || candidate.candidateLeafId !== row.candidate_leaf_id) {
      throw new Error('Campos del candidato Pi no coinciden con su payload');
    }
    return candidate;
  }

  function actorPerceptionIdsAvailableAtCut(input: {
    runId: z.infer<typeof RunIdSchema>; actorId: z.infer<typeof CharacterIdSchema>;
    cut: z.infer<typeof ActorInputCutSchema>;
  }): string[] {
    const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(input.runId);
    if (runValue === undefined) throw new Error('Corrida ausente al validar la entrada Pi');
    const run = parseWorldRun(runValue);
    const cut = snapshotAndCommitAtCut(run, input.cut.worldRevision, input.cut.worldSeq);
    if (cut === undefined || cut.snapshot.clock.instant !== input.cut.fictionalAt) {
      throw new Error('La entrada Pi no señala un corte World histórico exacto');
    }
    return database.prepare(`
      SELECT p.perception_id,p.payload_json,p.payload_hash FROM world_perceptions p
      JOIN world_deliveries d ON d.perception_id=p.perception_id
      JOIN world_commits c ON c.run_id=p.run_id AND c.origin_kind=p.origin_kind AND c.origin_id=p.origin_id
      WHERE p.run_id=? AND p.recipient_actor_id=? AND p.world_seq<=? AND c.commit_index<=? AND d.state='delivered'
        AND NOT EXISTS(
          SELECT 1 FROM actor_pi_consumptions c
          WHERE c.run_id=p.run_id AND c.actor_id=p.recipient_actor_id AND c.perception_id=p.perception_id
        )
      ORDER BY p.world_seq,p.perception_id
    `).all(input.runId, input.actorId, input.cut.worldSeq, cut.commitIndex).flatMap((value) => {
      const row = z.strictObject({ perception_id: PerceptionIdSchema, payload_json: z.string(), payload_hash: HashSchema }).parse(value);
      if (sha256(row.payload_json) !== row.payload_hash) throw new Error('Hash de percepción Pi no coincide');
      const perception = WorldPerceptionSchema.parse(parseStoredJson(row.payload_json));
      return perception.fictitiousAt <= input.cut.fictionalAt ? [row.perception_id] : [];
    });
  }

  function verifyActorInputCut(input: {
    runId: z.infer<typeof RunIdSchema>; actorId: z.infer<typeof CharacterIdSchema>;
    cut: z.infer<typeof ActorInputCutSchema>; expectedPerceptionIds?: readonly string[];
  }): void {
    const availableRows = actorPerceptionIdsAvailableAtCut(input);
    const actual = [...input.cut.perceptionIds].sort();
    const expected = input.expectedPerceptionIds === undefined
      ? availableRows
      : [...input.expectedPerceptionIds].sort();
    const availableSet = new Set(availableRows);
    if (expected.some((id) => !availableSet.has(id))) {
      throw new Error('El corte Pi perdió una percepción del inbox congelado del job');
    }
    const available = [...expected].sort();
    if (actual.length !== available.length || actual.some((id, index) => id !== available[index])) {
      throw new Error(input.expectedPerceptionIds === undefined
        ? 'La lista Pi no coincide con las percepciones entregadas y aún no consumidas al corte'
        : 'La lista Pi no coincide con el inbox congelado del job actoral');
    }
  }

  function verifyCandidateBase(candidate: z.infer<typeof ActorPiCandidateSchema>): void {
    const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(candidate.runId);
    if (runValue === undefined) throw new Error('Corrida del candidato Pi ausente');
    const run = parseWorldRun(runValue);const base=currentActorSession(run,candidate.actorId);
    if(base===undefined)throw new Error('La sesión Pi del actor no está registrada');
    if (base.sessionId !== candidate.base.sessionId || base.sessionPath !== candidate.base.sessionPath
      || base.preparedContextHash !== candidate.base.preparedContextHash
      || canonicalJson(base.profile) !== canonicalJson(candidate.base.profile)
      || base.sessionRevision !== candidate.base.sessionRevision
      || base.committedLeafId !== candidate.base.committedLeafId) {
      throw new Error('El candidato Pi parte de un checkpoint distinto del aceptado por el host');
    }
    const context = run.fence.contexts.find((item) => item.actorId === candidate.actorId);
    if (context === undefined || context.preparedContextHash !== candidate.base.preparedContextHash) {
      throw new Error('El contexto preparado del candidato Pi ya no coincide con la puesta');
    }
  }

  function latestProposalVersion(runId: z.infer<typeof RunIdSchema>, proposalId: z.infer<typeof ProposalIdSchema>): number | undefined {
    const value = database.prepare(
      'SELECT MAX(version) AS latest FROM world_proposals WHERE run_id=? AND proposal_id=?',
    ).get(runId, proposalId);
    const parsed = z.strictObject({ latest: counter.nullable() }).parse(value).latest;
    return parsed ?? undefined;
  }

  function approvalReceiptForProposal(runId: z.infer<typeof RunIdSchema>, proposalId: z.infer<typeof ProposalIdSchema>, version: number) {
    const { row, record } = proposalRecord(runId, proposalId, version);
    if (record.attempt.kind !== 'communicate' || row.status !== 'pending' || record.jobId === undefined) return undefined;
    const run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(runId));
    if (run.row.lifecycle !== 'running' || run.row.world_revision !== record.baseRevision) return undefined;
    if (latestProposalVersion(runId, proposalId) !== version) return undefined;
    const latestReview = database.prepare(`
      SELECT review_seq,reviewer_kind,verdict,complete,state_revision,exact_content_hash,payload_json,payload_hash
      FROM world_reviews WHERE run_id=? AND proposal_id=? AND version=?
      ORDER BY review_seq DESC LIMIT 1
    `).get(runId, proposalId, version);
    if (latestReview === undefined) return undefined;
    const { review } = reviewRecord(latestReview);
    if (!reviewIsComplete(review) || review.verdict !== 'allow'
      || review.runId !== record.runId || review.proposalId !== record.proposalId || review.version !== record.version
      || review.actorId !== record.actorId || review.stateRevision !== record.baseRevision
      || review.stateRevision !== run.row.world_revision || review.exactContentHash !== record.exactContentHash
      || record.attempt.expectedRevision !== run.row.world_revision) return undefined;
    return WorldContentApprovalReceiptSchema.parse({
      kind: 'approved', proposalId: record.proposalId, version: record.version,
      runId: record.runId, actorId: record.actorId, stateRevision: run.row.world_revision,
      exactContentHash: record.exactContentHash,
    });
  }

  function claimedActorJob(execution: z.infer<typeof ActorJobExecutionSchema>) {
    const value = database.prepare(`SELECT * FROM actor_turn_jobs
      WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?`)
      .get(execution.runId, execution.actorId, execution.jobId, execution.generation);
    if (value === undefined) return undefined;
    const job = ActorTurnJobDbRowSchema.parse(value);
    return job.state === 'running' && job.pulse_id === execution.pulseId
      && job.owner_token === execution.lease.ownerToken && job.claim_token === execution.lease.claimToken
      ? job : undefined;
  }

  function actorJobEpochCurrent(job: z.infer<typeof ActorTurnJobDbRowSchema>, run: ReturnType<typeof parseWorldRun>): boolean {
    if (run.row.lifecycle !== 'running' || job.lifecycle_revision === null
      || job.lifecycle_revision !== run.row.lifecycle_revision) return false;
    const step = activeStepJob(job.run_id);
    if (step !== undefined && (step.lifecycleRevision !== run.row.lifecycle_revision || step.pulseId !== job.pulse_id)) return false;
    const pulseValue = database.prepare(`SELECT lifecycle_revision FROM coordinator_pulses WHERE run_id=? AND pulse_id=?`)
      .get(job.run_id, job.pulse_id);
    if(pulseValue!==undefined){const pulse=z.strictObject({lifecycle_revision:counter.nullable()}).parse(pulseValue);if(pulse.lifecycle_revision===null||pulse.lifecycle_revision!==run.row.lifecycle_revision)return false;}
    if(job.state==='running')assertJobIdentityBinding(job,run);
    return true;
  }

  function assertActorExecutionEpoch(execution: z.infer<typeof ActorJobExecutionSchema>): void {
    const job = claimedActorJob(execution);
    if (job === undefined) throw new Error('El claim actoral ya no puede escribir en el journal');
    const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(execution.runId);
    if (runValue === undefined || !actorJobEpochCurrent(job,parseWorldRun(runValue))) {
      throw new Error('El claim actoral pertenece a una época de lifecycle anterior');
    }
    assertJobIdentityBinding(job,parseWorldRun(runValue));
  }

  function actorJobEligibility(execution: z.infer<typeof ActorJobExecutionSchema>):
    { kind: 'active' } | { kind: 'inactive'; reason: string } {
    const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(execution.runId);
    if (runValue === undefined) return { kind: 'inactive', reason: 'run_missing' };
    const run = parseWorldRun(runValue);
    if (run.row.lifecycle !== 'running') return { kind: 'inactive', reason: 'run_not_running' };
    const job = claimedActorJob(execution);
    if (job === undefined) return { kind: 'inactive', reason: 'claim_inactive' };
    if (!actorJobEpochCurrent(job, run)) return { kind: 'inactive', reason: 'lifecycle_epoch_stale' };
    assertJobIdentityBinding(job,run);
    const invitationId=actorActivationInvitationForJob({runId:job.run_id,actorId:job.actor_id,jobId:job.job_id,generation:job.generation});
    if(invitationId!==undefined){
      const activationReason=activationInvitationIneligibility({run,configuration:ReadyRunConfigurationSchema.parse(run.configuration),invitationId});
      if(activationReason!==undefined)return {kind:'inactive',reason:activationReason};
    }
    if (!characterCanReceiveAt({snapshot:run.snapshot,characterId:execution.actorId})) return {kind:'inactive',reason:'actor_unavailable'};
    const cut = frozenActorTurnWorldCut(job);
    if (cut === null) return { kind: 'inactive', reason: 'input_cut_missing' };
    if (cut.worldRevision !== run.snapshot.revision || cut.worldSeq !== run.snapshot.seq
      || cut.fictionalAt !== run.snapshot.clock.instant) return { kind: 'inactive', reason: 'input_cut_obsolete' };
    const scene = run.snapshot.scenes.find((item) => item.id === run.snapshot.activeSceneId);
    const actor = run.snapshot.entities.find((item) => item.kind === 'character' && item.characterId === execution.actorId);
    if (scene === undefined || scene.lifecycle.kind !== 'open' || !scene.participantIds.includes(execution.actorId)
      || actor?.kind !== 'character' || actor.preparation.kind !== 'prepared'
      || actor.presence.kind !== 'present' || actor.presence.sceneId !== scene.id) {
      return { kind: 'inactive', reason: 'actor_unavailable' };
    }
    const session = currentActorSession(run,execution.actorId);
    if (session === undefined) return { kind: 'inactive', reason: 'session_missing' };
    if(canonicalJson(resolveStoredPiProfile(session.profile))!==canonicalJson(runInferenceProfile(run)))return {kind:'inactive',reason:'inference_profile_changed'};
    const context = run.fence.contexts.find((item) => item.actorId === execution.actorId);
    if (context === undefined || context.preparedContextHash !== session.preparedContextHash
      || context.identityVersion !== actor.preparation.identityVersion
      || context.continuityId !== actor.preparation.continuityId) {
      return { kind: 'inactive', reason: 'prepared_context_changed' };
    }
    const unresolved = database.prepare(`SELECT 1 FROM request_reservations
      WHERE job_id=? AND generation=? AND state IN('dispatched','ambiguous') LIMIT 1`)
      .get(execution.jobId, execution.generation);
    if (unresolved !== undefined) return { kind: 'inactive', reason: 'request_unresolved' };
    return { kind: 'active' };
  }

  function actorJobReservation(execution: z.infer<typeof ActorJobExecutionSchema>, requestSeq: number) {
    const value = database.prepare(`SELECT r.run_id,r.pulse_id,r.state,l.owner_token,l.claim_token
      FROM request_reservations r JOIN actor_job_request_leases l
        ON l.job_id=r.job_id AND l.generation=r.generation AND l.request_seq=r.request_seq
      WHERE r.job_id=? AND r.generation=? AND r.request_seq=?`)
      .get(execution.jobId, execution.generation, requestSeq);
    const row = z.strictObject({
      run_id: RunIdSchema, pulse_id: PulseIdSchema,
      state: z.enum(['reserved', 'dispatched', 'completed', 'undispatched', 'ambiguous']),
      owner_token: z.string().uuid(), claim_token: z.string().uuid(),
    }).parse(value);
    if (row.run_id !== execution.runId || row.pulse_id !== execution.pulseId
      || row.owner_token !== execution.lease.ownerToken || row.claim_token !== execution.lease.claimToken) {
      throw new Error('La reserva Pi pertenece a otro scope o lease');
    }
    return row;
  }

  function reserveNextWithinTransaction(request: Omit<z.infer<typeof BudgetRequestSchema>, 'requestSeq'>) {
    const prior = z.strictObject({ previous: counter.nullable() }).parse(database.prepare(
      'SELECT MAX(request_seq) AS previous FROM request_reservations WHERE job_id=? AND generation=?',
    ).get(request.jobId, request.generation));
    const requestSeq = counter.parse(prior.previous === null ? 0 : prior.previous + 1);
    const result = reserveWithinTransaction({ ...request, requestSeq });
    if (result.kind === 'existing') throw new Error('Asignación de secuencia no exclusiva');
    return result.kind === 'reserved' ? { ...result, requestSeq } : result;
  }

  function blockRunningActorJobs(runId: z.infer<typeof RunIdSchema>, timestamp: number): void {
    database.prepare("UPDATE administrative_jobs SET state='blocked',failure_code='job-inactive',updated_at=? WHERE run_id=? AND state='running'").run(timestamp,runId);
    const running = database.prepare(`SELECT run_id,actor_id,job_id,generation FROM actor_turn_jobs
      WHERE run_id=? AND state='running'`).all(runId).map((value) => z.strictObject({
        run_id: RunIdSchema, actor_id: CharacterIdSchema, job_id: JobIdSchema, generation: counter,
      }).parse(value));
    for (const job of running) {
      database.prepare(`UPDATE actor_turn_jobs SET state='blocked',failure_code='job-inactive',updated_at=?
        WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND state='running'`)
        .run(timestamp, job.run_id, job.actor_id, job.job_id, job.generation);
      database.prepare(`UPDATE actor_turn_job_inputs SET state='released' WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND state='assigned'`)
        .run(job.run_id, job.actor_id, job.job_id, job.generation);
      database.prepare(`UPDATE continuista_jobs SET state='blocked',failure_code='job-inactive',updated_at=?
        WHERE actor_job_id=? AND actor_generation=? AND state='running'`)
        .run(timestamp, job.job_id, job.generation);
    }
  }

  function blockPendingActorActivationsForClosedRun(runId: z.infer<typeof RunIdSchema>, timestamp: number): void {
    const causes = database.prepare(`SELECT activation_id FROM actor_activation_causes
      WHERE run_id=? AND state IN('pending','running')`).all(runId)
      .map((value) => z.strictObject({ activation_id: ActorActivationIdSchema }).parse(value).activation_id);
    for (const activationId of causes) {
      database.prepare(`UPDATE actor_turn_jobs SET state='blocked',failure_code='job-inactive',updated_at=?
        WHERE run_id=? AND state='queued' AND EXISTS(
          SELECT 1 FROM actor_activation_invitation_jobs link
          JOIN actor_activation_invitations invitation ON invitation.run_id=link.run_id AND invitation.invitation_id=link.invitation_id
          WHERE link.run_id=actor_turn_jobs.run_id AND link.actor_id=actor_turn_jobs.actor_id
            AND link.job_id=actor_turn_jobs.job_id AND link.generation=actor_turn_jobs.generation
            AND invitation.activation_id=?)`).run(timestamp,runId,activationId);
      database.prepare(`UPDATE actor_turn_job_inputs SET state='released' WHERE run_id=? AND state='assigned' AND EXISTS(
        SELECT 1 FROM actor_turn_jobs job JOIN actor_activation_invitation_jobs link
          ON link.run_id=job.run_id AND link.actor_id=job.actor_id AND link.job_id=job.job_id AND link.generation=job.generation
        JOIN actor_activation_invitations invitation ON invitation.run_id=link.run_id AND invitation.invitation_id=link.invitation_id
        WHERE job.run_id=actor_turn_job_inputs.run_id AND job.actor_id=actor_turn_job_inputs.actor_id
          AND job.job_id=actor_turn_job_inputs.job_id AND job.generation=actor_turn_job_inputs.generation
          AND invitation.activation_id=? AND job.state='blocked')`).run(runId,activationId);
      database.prepare(`UPDATE actor_activation_invitations SET state=CASE WHEN EXISTS(
          SELECT 1 FROM actor_activation_invitation_jobs link JOIN actor_turn_jobs job
            ON job.run_id=link.run_id AND job.actor_id=link.actor_id AND job.job_id=link.job_id AND job.generation=link.generation
          WHERE link.run_id=actor_activation_invitations.run_id AND link.invitation_id=actor_activation_invitations.invitation_id
            AND job.state='accepted') THEN 'consumed' ELSE 'blocked' END,
        failure_reason=CASE WHEN EXISTS(SELECT 1 FROM actor_activation_invitation_jobs link JOIN actor_turn_jobs job
          ON job.run_id=link.run_id AND job.actor_id=link.actor_id AND job.job_id=link.job_id AND job.generation=link.generation
          WHERE link.run_id=actor_activation_invitations.run_id AND link.invitation_id=actor_activation_invitations.invitation_id
            AND job.state='accepted') THEN NULL ELSE 'run-closed' END,updated_at=?
        WHERE run_id=? AND activation_id=? AND state IN('pending','assigned')`).run(timestamp,runId,activationId);
      database.prepare(`UPDATE coordinator_pulses SET state='blocked',updated_at=? WHERE run_id=?
        AND origin_kind='actorActivation' AND origin_id=? AND state='running'`).run(timestamp,runId,activationId);
      database.prepare(`UPDATE actor_activation_causes SET state='blocked',failure_reason='run-closed',updated_at=?
        WHERE run_id=? AND activation_id=? AND state IN('pending','running')`).run(timestamp,runId,activationId);
    }
  }

  function reconcileRunLifecycleEpoch(runId: z.infer<typeof RunIdSchema>, lifecycle: z.infer<typeof WorldLifecycleSchema>, revision: number, timestamp: number): void {
    if (lifecycle !== 'running') {
      finishStepJob(runId, 'canceled');
      blockRunningActorJobs(runId, timestamp);
      if (lifecycle === 'closed') blockPendingActorActivationsForClosedRun(runId,timestamp);
      return;
    }
    database.prepare(`UPDATE coordinator_pulses SET lifecycle_revision=?,updated_at=? WHERE run_id=? AND state='running'`)
      .run(revision, timestamp, runId);
    database.prepare(`UPDATE actor_turn_jobs SET lifecycle_revision=?,updated_at=? WHERE run_id=? AND state IN('queued','accepted')`)
      .run(revision, timestamp, runId);
  }

  function pauseRunForModelTimeBudget(runId: z.infer<typeof RunIdSchema>): void {
    const timestamp = Date.now();
    const changed = database.prepare(`UPDATE world_runs SET lifecycle='paused',lifecycle_revision=lifecycle_revision+1,updated_at=?
      WHERE run_id=? AND lifecycle='running'`).run(timestamp, runId);
    if (changed.changes === 1) {
      const run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(runId));
      finishStepJob(runId,'failed');
      reconcileRunLifecycleEpoch(runId, run.row.lifecycle, run.row.lifecycle_revision, timestamp);
    }
  }

  function modelTimeCounts(runId: z.infer<typeof RunIdSchema>) {
    return z.strictObject({
      measured_ms: counter, reserved_ms: counter, active_count: counter, uncertain_count: counter,
    }).parse(database.prepare(`SELECT
      COALESCE(SUM(CASE WHEN state='settled' THEN measured_ms ELSE 0 END),0) AS measured_ms,
      COALESCE(SUM(CASE WHEN state IN('reserved','running','expired','uncertain') THEN reserved_ms ELSE 0 END),0) AS reserved_ms,
      COALESCE(SUM(CASE WHEN state IN('reserved','running','expired','uncertain') THEN 1 ELSE 0 END),0) AS active_count,
      COALESCE(SUM(CASE WHEN state IN('expired','uncertain') THEN 1 ELSE 0 END),0) AS uncertain_count
      FROM model_time_spans WHERE run_id=?`).get(runId));
  }

  function ensureModelTimeRunState(runId: z.infer<typeof RunIdSchema>): void {
    const legacy = z.strictObject({ count: counter }).parse(database.prepare(`SELECT COUNT(*) AS count FROM request_reservations r
      WHERE r.run_id=? AND r.state IN('dispatched','completed','ambiguous')
        AND NOT EXISTS(SELECT 1 FROM model_time_spans s WHERE s.job_id=r.job_id AND s.generation=r.generation AND s.request_seq=r.request_seq)`)
      .get(runId)).count;
    database.prepare('INSERT OR IGNORE INTO model_time_run_state(run_id,unknown_legacy_requests) VALUES(?,?)')
      .run(runId, legacy);
  }

  function settleModelTimeWithinTransaction(input: {
    jobId: z.infer<typeof JobIdSchema>; generation: number; requestSeq: number;
    clockEpochId: string; monotonicNs: string; allowRunning?: boolean;
  }): 'settled' | 'existing' {
    const value = database.prepare(`SELECT * FROM model_time_spans WHERE job_id=? AND generation=? AND request_seq=?`)
      .get(input.jobId, input.generation, input.requestSeq);
    if (value === undefined) throw new Error('No existe span de tiempo para la request');
    const span = z.strictObject({
      job_id: JobIdSchema, generation: counter, request_seq: counter, run_id: RunIdSchema, pulse_id: PulseIdSchema,
      clock_epoch_id: ModelTimeClockEpochIdSchema, owner_token: z.string().uuid(), reserved_ms: counter.min(1),
      state: z.enum(['reserved','running','expired','uncertain','settled','undispatched']),
      start_monotonic_ns: z.string().regex(/^(0|[1-9]\d{0,39})$/).nullable(),
      stop_monotonic_ns: z.string().regex(/^(0|[1-9]\d{0,39})$/).nullable(),
      measured_ms: counter.nullable(), expiry_reason: z.enum(['timeout','cancelled','host-interrupted']).nullable(),
      settlement_hash: HashSchema.nullable(),
    }).parse(value);
    if (span.clock_epoch_id !== input.clockEpochId) throw new Error('La liquidación usa otro epoch monotónico');
    if (span.state === 'settled') {
      const retry = hashJson({ clockEpochId: input.clockEpochId, startMonotonicNs: span.start_monotonic_ns, stopMonotonicNs: input.monotonicNs });
      if (retry.hash !== span.settlement_hash || span.stop_monotonic_ns !== input.monotonicNs) throw new Error('Liquidación repetida con muestra distinta');
      return 'existing';
    }
    if (span.state !== 'expired' && span.state !== 'uncertain' && !(input.allowRunning === true && span.state === 'running')) {
      throw new Error('La liquidación requiere una request en transporte o una limpieza expirada');
    }
    if (span.start_monotonic_ns === null) throw new Error('Falta inicio monotónico durable');
    const start = BigInt(span.start_monotonic_ns);
    const stop = BigInt(input.monotonicNs);
    if (stop < start) throw new Error('La muestra de cierre precede al despacho');
    const measuredMsBig = (stop - start + 999_999n) / 1_000_000n;
    if (measuredMsBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('La duración medida excede el rango seguro');
    const measuredMs = Number(measuredMsBig);
    const settlement = hashJson({ clockEpochId: input.clockEpochId, startMonotonicNs: span.start_monotonic_ns, stopMonotonicNs: input.monotonicNs });
    database.prepare(`UPDATE model_time_spans SET state='settled',stop_monotonic_ns=?,measured_ms=?,settlement_hash=?,expiry_reason=NULL
      WHERE job_id=? AND generation=? AND request_seq=? AND state IN('running','expired','uncertain')`)
      .run(input.monotonicNs, measuredMs, settlement.hash, input.jobId, input.generation, input.requestSeq);
    const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(span.run_id);
    if (runValue !== undefined) {
      const run = parseWorldRun(runValue);
      const configuration = ReadyRunConfigurationSchema.safeParse(run.configuration);
      if (configuration.success) {
        const counts = modelTimeCounts(span.run_id);
        if (counts.measured_ms >= configuration.data.budget.maxWallTimeMs
          || budgetRow.parse(database.prepare('SELECT max_calls,consumed FROM run_budgets WHERE run_id=?').get(span.run_id)).consumed
            >= configuration.data.budget.maxPiCallsPerRun) pauseRunForModelTimeBudget(span.run_id);
      }
    }
    return 'settled';
  }

  function transitionWithinTransaction(request: z.infer<typeof ReservationTransitionSchema>): void {
    const row = z.strictObject({
      run_id: RunIdSchema, pulse_id: PulseIdSchema,
      state: z.enum(['reserved', 'dispatched', 'completed', 'undispatched', 'ambiguous']),
    }).parse(database.prepare(
      'SELECT run_id,pulse_id,state FROM request_reservations WHERE job_id=? AND generation=? AND request_seq=?',
    ).get(request.jobId, request.generation, request.requestSeq));
    const spanValue = database.prepare(`SELECT clock_epoch_id,owner_token,reserved_ms,state,start_monotonic_ns,
      stop_monotonic_ns,measured_ms,expiry_reason,settlement_hash FROM model_time_spans
      WHERE job_id=? AND generation=? AND request_seq=?`)
      .get(request.jobId, request.generation, request.requestSeq);
    const span = spanValue === undefined ? undefined : z.strictObject({
      clock_epoch_id: ModelTimeClockEpochIdSchema, owner_token: z.string().uuid(), reserved_ms: counter.min(1),
      state: z.enum(['reserved','running','expired','uncertain','settled','undispatched']),
      start_monotonic_ns: z.string().regex(/^(0|[1-9]\d{0,39})$/).nullable(),
      stop_monotonic_ns: z.string().regex(/^(0|[1-9]\d{0,39})$/).nullable(), measured_ms: counter.nullable(),
      expiry_reason: z.enum(['timeout','cancelled','host-interrupted']).nullable(), settlement_hash: HashSchema.nullable(),
    }).parse(spanValue);
    if (span !== undefined && request.ownerToken !== span.owner_token) {
      throw new Error('La transición wall-time requiere el owner de la reserva');
    }
    if (row.state === request.target) {
      if (span === undefined) {
        if (request.wallTime !== undefined) throw new Error('Muestra wall-time en una reserva legacy');
        return;
      }
      if (request.target === 'completed' || request.target === 'ambiguous') {
        if (request.wallTime === undefined) throw new Error('La repetición terminal requiere la muestra de cierre original');
        const proof = hashJson({ clockEpochId: request.wallTime.clockEpochId,
          startMonotonicNs: span.start_monotonic_ns, stopMonotonicNs: request.wallTime.monotonicNs });
        if (span.state !== 'settled' || span.clock_epoch_id !== request.wallTime.clockEpochId
          || span.stop_monotonic_ns !== request.wallTime.monotonicNs || span.settlement_hash !== proof.hash) {
          throw new Error('La transición terminal repetida no coincide con su liquidación original');
        }
        return;
      }
      if (request.wallTime !== undefined) throw new Error('Muestra wall-time en transición repetida incompatible');
      return;
    }
    const allowed = (row.state === 'reserved' && request.target !== 'completed')
      || (row.state === 'dispatched' && (request.target === 'completed' || request.target === 'ambiguous'));
    if (!allowed) throw new Error('Transición de reserva inválida');
    if (span !== undefined) {
      if (request.target === 'dispatched') {
        if (span.state !== 'reserved' || span.start_monotonic_ns !== null || request.wallTime === undefined
          || request.wallTime.clockEpochId !== span.clock_epoch_id) throw new Error('El despacho requiere el epoch y grant originales');
        database.prepare(`UPDATE model_time_spans SET state='running',start_monotonic_ns=?
          WHERE job_id=? AND generation=? AND request_seq=? AND state='reserved'`)
          .run(request.wallTime.monotonicNs, request.jobId, request.generation, request.requestSeq);
      } else if (request.target === 'completed' || request.target === 'ambiguous') {
        if (span.state !== 'running' || span.start_monotonic_ns === null || request.wallTime === undefined
          || request.wallTime.clockEpochId !== span.clock_epoch_id) throw new Error('El cierre real requiere el sample de stop del epoch original');
        settleModelTimeWithinTransaction({ jobId: request.jobId, generation: request.generation,
          requestSeq: request.requestSeq, clockEpochId: request.wallTime.clockEpochId, monotonicNs: request.wallTime.monotonicNs, allowRunning: true });
      } else if (request.wallTime !== undefined) throw new Error('La transición undispatched no admite muestra monotónica');
    } else if (request.wallTime !== undefined) throw new Error('La muestra wall-time no tiene grant durable');
    database.prepare('UPDATE request_reservations SET state=? WHERE job_id=? AND generation=? AND request_seq=?')
      .run(request.target, request.jobId, request.generation, request.requestSeq);
    if (request.target === 'undispatched') {
      database.prepare('UPDATE run_budgets SET consumed=consumed-1 WHERE run_id=?').run(row.run_id);
      database.prepare('UPDATE pulses SET consumed=consumed-1 WHERE pulse_id=?').run(row.pulse_id);
      if (span !== undefined) database.prepare(`UPDATE model_time_spans SET state='undispatched' WHERE job_id=? AND generation=? AND request_seq=? AND state='reserved'`)
        .run(request.jobId, request.generation, request.requestSeq);
    } else if (request.target === 'completed' || request.target === 'ambiguous') {
      const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(row.run_id);
      if (runValue !== undefined) {
        const run = parseWorldRun(runValue);
        const configuration = ReadyRunConfigurationSchema.safeParse(run.configuration);
        if (configuration.success) {
          const counts = modelTimeCounts(row.run_id);
          if (counts.measured_ms >= configuration.data.budget.maxWallTimeMs
            || budgetRow.parse(database.prepare('SELECT max_calls,consumed FROM run_budgets WHERE run_id=?').get(row.run_id)).consumed
              >= configuration.data.budget.maxPiCallsPerRun) pauseRunForModelTimeBudget(row.run_id);
        }
      }
    }
  }

  function reserveWithinTransaction(request: z.infer<typeof BudgetRequestSchema>): ReserveResult {
    const existing = database.prepare('SELECT run_id,pulse_id FROM request_reservations WHERE job_id=? AND generation=? AND request_seq=?')
      .get(request.jobId, request.generation, request.requestSeq);
    if (existing !== undefined) {
      const stored = reservationRow.parse(existing);
      if (stored.run_id !== request.runId || stored.pulse_id !== request.pulseId) throw new Error('Reserva existente pertenece a otro ámbito');
      return ReserveResultSchema.parse({ kind: 'existing' });
    }
    const run = budgetRow.parse(database.prepare('SELECT max_calls,consumed FROM run_budgets WHERE run_id=?').get(request.runId));
    const pulse = pulseRow.parse(database.prepare('SELECT run_id,max_calls,consumed FROM pulses WHERE pulse_id=?').get(request.pulseId));
    if (pulse.run_id !== request.runId) throw new Error('Pulso ajeno a corrida');
    if (run.consumed >= run.max_calls) {
      pauseRunForModelTimeBudget(request.runId);
      return ReserveResultSchema.parse({ kind: 'exhausted', scope: 'run' });
    }
    if (pulse.consumed >= pulse.max_calls) return ReserveResultSchema.parse({ kind: 'exhausted', scope: 'pulse' });

    let stateValue = database.prepare('SELECT unknown_legacy_requests FROM model_time_run_state WHERE run_id=?').get(request.runId);
    if (stateValue === undefined) {
      const worldValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
      if (worldValue !== undefined) {
        const productionRun = parseWorldRun(worldValue);
        if (ReadyRunConfigurationSchema.safeParse(productionRun.configuration).success) {
          ensureModelTimeRunState(request.runId);
          stateValue = database.prepare('SELECT unknown_legacy_requests FROM model_time_run_state WHERE run_id=?').get(request.runId);
        }
      }
    }
    let wallTime: { reservedMs: number; clockEpochId: string } | undefined;
    if (stateValue !== undefined) {
      const timeState = z.strictObject({ unknown_legacy_requests: counter }).parse(stateValue);
      const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
      if (runValue === undefined) throw new Error('Budget wall-time sin WorldRun ready asociado');
      const productionRun = parseWorldRun(runValue);
      const configuration = ReadyRunConfigurationSchema.parse(productionRun.configuration);
      if (timeState.unknown_legacy_requests > 0) {
        pauseRunForModelTimeBudget(request.runId);
        return ReserveResultSchema.parse({ kind: 'exhausted', scope: 'legacy-unknown' });
      }
      if (request.clockEpochId === undefined || request.ownerToken === undefined) {
        throw new Error('La request production requiere epoch monotónico y owner para reservar tiempo');
      }
      const counts = modelTimeCounts(request.runId);
      if (counts.uncertain_count > 0) {
        pauseRunForModelTimeBudget(request.runId);
        return ReserveResultSchema.parse({ kind: 'exhausted', scope: 'uncertain' });
      }
      if (counts.active_count >= configuration.budget.maxConcurrentPiRequests) {
        return ReserveResultSchema.parse({ kind: 'busy', scope: 'concurrency' });
      }
      const remainingMs = Math.max(0, configuration.budget.maxWallTimeMs - counts.measured_ms - counts.reserved_ms);
      if (remainingMs < 1) {
        pauseRunForModelTimeBudget(request.runId);
        return ReserveResultSchema.parse({ kind: 'exhausted', scope: 'wall-time' });
      }
      wallTime = { reservedMs: Math.min(effectiveRequestTimeoutMs(configuration.budget), remainingMs), clockEpochId: request.clockEpochId };
    } else if (request.clockEpochId !== undefined || request.ownerToken !== undefined) {
      throw new Error('No existe accounting wall-time para esta corrida production');
    }

    database.prepare('INSERT INTO request_reservations VALUES(?,?,?,?,?,?)')
      .run(request.jobId, request.generation, request.requestSeq, request.runId, request.pulseId, 'reserved');
    database.prepare('UPDATE run_budgets SET consumed=consumed+1 WHERE run_id=?').run(request.runId);
    database.prepare('UPDATE pulses SET consumed=consumed+1 WHERE pulse_id=?').run(request.pulseId);
    if (wallTime !== undefined && request.ownerToken !== undefined) {
      database.prepare(`INSERT INTO model_time_spans(job_id,generation,request_seq,run_id,pulse_id,clock_epoch_id,owner_token,reserved_ms,state,
        start_monotonic_ns,stop_monotonic_ns,measured_ms,expiry_reason,settlement_hash) VALUES(?,?,?,?,?,?,?,?,'reserved',NULL,NULL,NULL,NULL,NULL)`)
        .run(request.jobId, request.generation, request.requestSeq, request.runId, request.pulseId,
          wallTime.clockEpochId, request.ownerToken, wallTime.reservedMs);
    }
    return ReserveResultSchema.parse(wallTime === undefined ? { kind: 'reserved' } : { kind: 'reserved', wallTime });
  }

  function frozenProjection(rowValue: unknown): FrozenExperience {
    const row = projectionRow.parse(rowValue);
    const envelope = readPrivateExperience({
      summary: row.canonical_payload,
      actorId: row.actor_id,
      runId: row.run_id,
      throughWorldSeq: row.world_seq,
      expectedPayloadHash: row.payload_hash,
    });
    return freezeExperience(envelope);
  }

  function projectionReceipt(rowValue: unknown) {
    const row = ProjectionStoredRowSchema.parse(rowValue);
    const envelope = readPrivateExperience({
      summary: row.canonical_payload,
      actorId: row.actor_id,
      runId: row.run_id,
      throughWorldSeq: row.world_seq,
      expectedPayloadHash: row.payload_hash,
    });
    if (row.experience_id !== envelope.experienceId) {
      throw new Error('El receipt no coincide con la experiencia vinculada');
    }
    return MemoryProjectionReceiptSchema.parse({
      memoryId: row.memory_id,
      experienceId: envelope.experienceId,
      runId: envelope.runId,
      actorId: envelope.actorId,
      worldSeq: envelope.worldSeq,
      canonicalPayload: row.canonical_payload,
      payloadHash: row.payload_hash,
    });
  }

  function acceptedActorJobProposal(input: unknown) {
      const request = z.strictObject({ runId: RunIdSchema, actorId: CharacterIdSchema, jobId: JobIdSchema, generation: counter }).parse(input);
      const jobValue = database.prepare(`SELECT * FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?`)
        .get(request.runId, request.actorId, request.jobId, request.generation);
      if (jobValue === undefined) return undefined;
      const job = ActorTurnJobDbRowSchema.parse(jobValue);
      if (job.state !== 'accepted') return undefined;
      actorTurnJobView(jobValue);
      const receipts = database.prepare(`SELECT r.receipt_json,r.receipt_hash,r.acceptance_hash FROM actor_pi_turn_receipts r
        JOIN actor_pi_candidates c ON c.candidate_id=r.candidate_id
        WHERE c.run_id=? AND c.actor_id=? AND c.job_id=? AND c.generation=?`)
        .all(request.runId, request.actorId, request.jobId, request.generation);
      if (receipts.length !== 1) throw new Error('Job aceptado requiere un receipt Pi único');
      const stored = ActorPiReceiptDbRowSchema.parse(receipts[0]);
      if (sha256(stored.receipt_json) !== stored.receipt_hash) throw new Error('Hash del receipt Pi aceptado no coincide');
      const receipt = ActorPiReceiptSchema.parse(parseStoredJson(stored.receipt_json));
      if (canonicalJson(receipt) !== stored.receipt_json || receipt.payloadHash !== stored.acceptance_hash
        || receipt.runId !== request.runId || receipt.actorId !== request.actorId
        || receipt.scope.jobId !== request.jobId || receipt.scope.generation !== request.generation
        || receipt.scope.runId !== request.runId || receipt.scope.pulseId !== job.pulse_id) throw new Error('Receipt Pi aceptado pertenece a otro scope');
      const candidate = actorCandidateFromRow(database.prepare('SELECT * FROM actor_pi_candidates WHERE candidate_id=?').get(receipt.candidateId));
      if (candidate.kind !== 'terminal-candidate' || candidate.outcome !== 'completed'
        || candidate.runId !== request.runId || candidate.actorId !== request.actorId
        || canonicalJson(candidate.scope) !== canonicalJson(receipt.scope) || candidate.turnId !== receipt.turnId
        || candidate.candidateLeafId !== receipt.committedLeafId) throw new Error('Receipt Pi aceptado no coincide con candidato terminal');
      if (receipt.proposal.kind !== 'durable') return undefined;
      const proposal = proposalRecord(request.runId, receipt.proposal.proposalId, receipt.proposal.version);
      if (proposal.row.actor_id !== request.actorId || proposal.row.job_id !== request.jobId
        || proposal.row.generation !== request.generation
        || proposal.record.attemptHash !== receipt.proposal.attemptHash) throw new Error('Propuesta aceptada no coincide con receipt Pi');
      return proposal.record;
  }

  function storeContinuistaReview(review: z.infer<typeof ContinuistaReviewInputSchema>): {kind:'stored'|'existing';reviewSeq:number} {

        const { record, row } = proposalRecord(review.runId, review.proposalId, review.version);
        if (row.status !== 'pending' || review.actorId !== record.actorId || review.stateRevision !== record.baseRevision
          || review.exactContentHash !== record.exactContentHash) throw new Error('Review no coincide con versión exacta de propuesta');
        const latest = database.prepare(`
          SELECT review_seq,reviewer_kind,verdict,complete,state_revision,exact_content_hash,payload_json,payload_hash
          FROM world_reviews
          WHERE run_id=? AND proposal_id=? AND version=? AND reviewer_kind='continuista'
          ORDER BY review_seq DESC LIMIT 1
        `).get(review.runId, review.proposalId, review.version);
        if (latest !== undefined) {
          const parsed = reviewRecord(latest);
          if (canonicalJson(parsed.review) === canonicalJson(review)) return { kind: 'existing', reviewSeq: parsed.row.review_seq };
        }
        if (record.jobId !== undefined && record.generation !== undefined) {
          const jobValue = database.prepare(`SELECT * FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?`)
            .get(review.runId,record.actorId,record.jobId,record.generation);
          if (jobValue !== undefined) {
            const run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(review.runId));
            if (!actorJobEpochCurrent(ActorTurnJobDbRowSchema.parse(jobValue),run)) throw new Error('La revisión Continuista pertenece a una época de lifecycle anterior');
          }
        }
        const previous = latest === undefined ? -1 : reviewRecord(latest).row.review_seq;
        const reviewSeq = previous + 1;
        const payload = hashJson(review);
        database.prepare(`
          INSERT INTO world_reviews(
            run_id,proposal_id,version,review_seq,reviewer_kind,verdict,complete,state_revision,
            exact_content_hash,payload_json,created_at,payload_hash
          ) VALUES(?,?,?,?,'continuista',?,?,?,?,?,?,?)
        `).run(review.runId, review.proposalId, review.version, reviewSeq, review.verdict,
          review.complete ? 1 : 0, review.stateRevision, review.exactContentHash, payload.json, Date.now(), payload.hash);
        return { kind: 'stored', reviewSeq };

  }

  const AdministrativeJobDbSchema=z.strictObject({job_id:JobIdSchema,generation:counter,run_id:RunIdSchema,pulse_id:PulseIdSchema,
    role:z.enum(['director','narrator','configurator','narration-reviewer']),lifecycle_revision:counter,world_revision:counter,through_world_seq:counter,
    context_json:z.string(),context_hash:HashSchema,state:z.enum(['running','accepted','blocked']),owner_token:z.string().uuid(),claim_token:z.string().uuid(),
    failure_code:AdministrativeJobFailureSchema.nullable(),created_at:counter,updated_at:counter});
  function administrativeJobRow(input:z.infer<typeof AdministrativeJobLookupSchema>) {
    const row=AdministrativeJobDbSchema.parse(database.prepare('SELECT * FROM administrative_jobs WHERE job_id=? AND generation=?').get(input.jobId,input.generation));
    const parsedContext=z.discriminatedUnion('role',[DirectorContextSchema,NarratorContextSchema,NarrationReviewContextSchema]).parse(parseStoredJson(row.context_json));
    const context=parsedContext.role==='director'?validateDirectorContext(parsedContext):parsedContext.role==='narrator'?validateNarratorContext(parsedContext):validateNarrationReviewContext(parsedContext);
    const contextHash=context.role==='director'?directorContextHash(context):context.role==='narrator'?narratorContextHash(context):narrationReviewContextHash(context);
    if(row.role!==context.role||canonicalJson(context)!==row.context_json||contextHash!==row.context_hash
      ||context.scope.jobId!==row.job_id||context.scope.generation!==row.generation||context.scope.runId!==row.run_id||context.scope.pulseId!==row.pulse_id
      ||context.scope.lifecycleRevision!==row.lifecycle_revision||context.scope.worldRevision!==row.world_revision||context.scope.throughWorldSeq!==row.through_world_seq)
      throw new Error('Contexto/scope administrativo alterado');
    return {row,context};
  }
  function administrativeJobView(row:z.infer<typeof AdministrativeJobDbSchema>) {
    return AdministrativeJobViewSchema.parse({jobId:row.job_id,generation:row.generation,runId:row.run_id,pulseId:row.pulse_id,role:row.role,
      lifecycleRevision:row.lifecycle_revision,worldRevision:row.world_revision,throughWorldSeq:row.through_world_seq,contextHash:row.context_hash,
      state:row.state,failureCode:row.failure_code,createdAt:row.created_at,updatedAt:row.updated_at});
  }
  function administrativeExecution(row:z.infer<typeof AdministrativeJobDbSchema>,context:z.infer<typeof DirectorContextSchema>|z.infer<typeof NarratorContextSchema>|z.infer<typeof NarrationReviewContextSchema>) {
    return AdministrativeJobExecutionSchema.parse({role:row.role,scope:context.scope,contextHash:row.context_hash,
      lease:{ownerToken:row.owner_token,claimToken:row.claim_token}});
  }
  function claimedAdministrativeJob(execution:z.infer<typeof AdministrativeJobExecutionSchema>) {
    const job=administrativeJobRow(execution.scope);
    if(job.row.state!=='running'||canonicalJson(administrativeExecution(job.row,job.context))!==canonicalJson(execution)) throw new Error('Claim administrativo inactivo');
    return job;
  }
  function administrativeSession(lookup:z.infer<typeof AdministrativeJobLookupSchema>) {
    const value=database.prepare('SELECT payload_json,payload_hash FROM administrative_sessions WHERE job_id=? AND generation=?').get(lookup.jobId,lookup.generation);
    if(value===undefined)return undefined;
    const row=z.strictObject({payload_json:z.string(),payload_hash:HashSchema}).parse(value);
    const session=AdministrativeSessionSchema.parse(parseStoredJson(row.payload_json));
    if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(session)!==row.payload_json||session.jobId!==lookup.jobId||session.generation!==lookup.generation)throw new Error('Sesión administrativa alterada');
    return session;
  }
  function administrativeEligibility(execution:z.infer<typeof AdministrativeJobExecutionSchema>):{kind:'active'}|{kind:'inactive';reason:string} {
    let job:ReturnType<typeof administrativeJobRow>;
    try{job=claimedAdministrativeJob(execution);}catch{return {kind:'inactive',reason:'claim-inactive'};}
    const value=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(job.row.run_id);
    if(value===undefined)return {kind:'inactive',reason:'run-missing'};
    const run=parseWorldRun(value);const pulse=coordinatorPulseView({runId:job.row.run_id,pulseId:job.row.pulse_id});
    const step=activeStepJob(job.row.run_id);
    if(run.row.lifecycle!=='running'||run.row.lifecycle_revision!==job.row.lifecycle_revision||pulse?.state!=='running'
      ||pulse.lifecycleRevision!==job.row.lifecycle_revision||(step!==undefined&&step.pulseId!==job.row.pulse_id))return {kind:'inactive',reason:'lifecycle-epoch-stale'};
    if(run.row.config_revision!==job.context.scope.configurationRevision||run.row.world_revision!==job.row.world_revision||run.row.last_seq!==job.row.through_world_seq
      ||run.snapshot.clock.instant!==job.context.scope.fictitiousAt)return {kind:'inactive',reason:'world-cut-stale'};
    if(canonicalJson(runInferenceProfile(run))!==canonicalJson(job.context.scope.profile))return {kind:'inactive',reason:'profile-changed'};
    if(job.context.role==='narration-reviewer'){
      const parent=administrativeJobRow(job.context.parent.scope);
      if(parent.context.role!=='narrator'||parent.row.state!=='running'||parent.row.context_hash!==job.context.parent.contextHash
        ||administrativeEligibility(administrativeExecution(parent.row,parent.context)).kind!=='active')return {kind:'inactive',reason:'parent-inactive'};
    }
    const session=administrativeSession(execution.scope);
    if(session!==undefined&&(session.contextHash!==job.row.context_hash||session.role!==job.row.role||canonicalJson(session.profile)!==canonicalJson(job.context.scope.profile)))return {kind:'inactive',reason:'session-context-mismatch'};
    return {kind:'active'};
  }
  function administrativeReservation(execution:z.infer<typeof AdministrativeJobExecutionSchema>,requestSeq:number) {
    const row=z.strictObject({run_id:RunIdSchema,pulse_id:PulseIdSchema,state:z.enum(['reserved','dispatched','completed','undispatched','ambiguous']),execution_json:z.string()})
      .parse(database.prepare(`SELECT r.run_id,r.pulse_id,r.state,l.execution_json FROM request_reservations r
        JOIN administrative_request_leases l ON l.job_id=r.job_id AND l.generation=r.generation AND l.request_seq=r.request_seq
        WHERE r.job_id=? AND r.generation=? AND r.request_seq=?`).get(execution.scope.jobId,execution.scope.generation,requestSeq));
    if(row.run_id!==execution.scope.runId||row.pulse_id!==execution.scope.pulseId||canonicalJson(AdministrativeJobExecutionSchema.parse(parseStoredJson(row.execution_json)))!==canonicalJson(execution))throw new Error('Reserva administrativa de otro scope/lease');
    return row;
  }
  function assertAdministrativeTerminal(execution:z.infer<typeof AdministrativeJobExecutionSchema>) {
    const job=claimedAdministrativeJob(execution);
    if(administrativeEligibility(execution).kind!=='active')throw new Error('Terminal administrativo fuera de época/corte');
    const session=administrativeSession(execution.scope);if(session===undefined)throw new Error('Terminal administrativo sin sesión');
    const terminals=database.prepare("SELECT checkpoint_hash,payload_json FROM administrative_checkpoints WHERE job_id=? AND generation=? AND purpose_kind='terminal-candidate'")
      .all(job.row.job_id,job.row.generation).map(value=>{
        const row=z.strictObject({checkpoint_hash:HashSchema,payload_json:z.string()}).parse(value);const checkpoint=AdministrativeCheckpointSchema.parse(parseStoredJson(row.payload_json));
        if(sha256(row.payload_json)!==row.checkpoint_hash||canonicalJson(checkpoint)!==row.payload_json)throw new Error('Terminal administrativo alterado');return checkpoint;
      }).filter(checkpoint=>checkpoint.purpose.kind==='terminal-candidate'&&checkpoint.purpose.outcome==='completed');
    const terminal=terminals[0];
    if(terminals.length!==1||terminal===undefined||terminal.purpose.kind!=='terminal-candidate'||terminal.purpose.lastRequestSeq===null||terminal.snapshot.candidateLeafId===null
      ||canonicalJson(terminal.execution)!==canonicalJson(execution)||terminal.snapshot.sessionId!==session.sessionId||terminal.snapshot.sessionPath!==session.sessionPath)
      throw new Error('Terminal administrativo incompleto o de otro claim/sesión');
    const requestSeq=terminal.purpose.lastRequestSeq;
    const latest=z.strictObject({last:counter.nullable()}).parse(database.prepare('SELECT MAX(request_seq) last FROM request_reservations WHERE job_id=? AND generation=?').get(job.row.job_id,job.row.generation));
    if(latest.last!==requestSeq||administrativeReservation(execution,requestSeq).state!=='completed')throw new Error('Terminal administrativo no liga última request completada');
    const value=z.strictObject({checkpoint_hash:HashSchema,payload_json:z.string()}).parse(database.prepare("SELECT checkpoint_hash,payload_json FROM administrative_checkpoints WHERE job_id=? AND generation=? AND purpose_kind='request-input' AND request_seq=?").get(job.row.job_id,job.row.generation,requestSeq));
    const checkpoint=AdministrativeCheckpointSchema.parse(parseStoredJson(value.payload_json));
    if(sha256(value.payload_json)!==value.checkpoint_hash||canonicalJson(checkpoint)!==value.payload_json||canonicalJson(checkpoint.execution)!==canonicalJson(execution)
      ||checkpoint.snapshot.sessionId!==session.sessionId||checkpoint.snapshot.sessionPath!==session.sessionPath)throw new Error('Input administrativo alterado o de otra sesión');
    if(job.context.role==='narrator'||job.context.role==='narration-reviewer'){
      const inputProof=z.strictObject({prefix_hash:HashSchema}).parse(database.prepare('SELECT prefix_hash FROM administrative_checkpoint_integrity WHERE checkpoint_hash=?').get(value.checkpoint_hash));
      const terminalPayload=hashJson(terminal);const terminalProof=z.strictObject({prefix_hash:HashSchema}).parse(database.prepare('SELECT prefix_hash FROM administrative_checkpoint_integrity WHERE checkpoint_hash=?').get(terminalPayload.hash));
      if(checkpoint.snapshot.candidateLeafId===null)throw new Error('Input administrativo sin leaf durable');
      const integrity=verifyPiSessionCheckpointChain({privateDataRoot:journalPrivateDataRoot,runId:job.row.run_id,
        role:job.context.role==='narrator'?'narrador':'continuista',sessionId:session.sessionId,sessionPath:session.sessionPath,
        baseLeafId:session.baseLeafId,inputLeafId:checkpoint.snapshot.candidateLeafId,terminalLeafId:terminal.snapshot.candidateLeafId,
        expectedInputPrefixHash:inputProof.prefix_hash,expectedTerminalPrefixHash:terminalProof.prefix_hash});
      if(integrity.kind!=='verified')throw new Error('Cadena JSONL administrativa no acredita input/terminal registrados');
    }
    return job;
  }
  function narrationCandidate(execution:z.infer<typeof AdministrativeJobExecutionSchema>,candidateHash:string) {
    const row=z.strictObject({candidate_hash:HashSchema,payload_json:z.string()}).parse(database.prepare('SELECT candidate_hash,payload_json FROM narration_candidates WHERE job_id=? AND generation=?').get(execution.scope.jobId,execution.scope.generation));
    const candidate=NarratorJournalCandidateSchema.parse(parseStoredJson(row.payload_json));
    if(row.candidate_hash!==candidateHash||candidate.candidateHash!==candidateHash||hashJson({execution:candidate.execution,proposal:candidate.proposal}).hash!==candidateHash
      ||canonicalJson(candidate)!==row.payload_json||canonicalJson(candidate.execution)!==canonicalJson(execution))throw new Error('Candidato Narrador alterado o de otro claim');
    return candidate;
  }
  function narrationReviewCandidate(execution:z.infer<typeof AdministrativeJobExecutionSchema>,candidateHash:string) {
    const row=z.strictObject({candidate_hash:HashSchema,payload_json:z.string()}).parse(database.prepare('SELECT candidate_hash,payload_json FROM narration_review_candidates WHERE job_id=? AND generation=?').get(execution.scope.jobId,execution.scope.generation));
    const candidate=NarrationReviewJournalCandidateSchema.parse(parseStoredJson(row.payload_json));
    if(row.candidate_hash!==candidateHash||candidate.candidateHash!==candidateHash
      ||hashJson({execution:candidate.execution,decision:candidate.decision}).hash!==candidateHash
      ||canonicalJson(candidate)!==row.payload_json||canonicalJson(candidate.execution)!==canonicalJson(execution))throw new Error('Candidato review Narrador alterado/de otro claim');
    return candidate;
  }
  function stampedNarrationReview(context:z.infer<typeof NarrationReviewContextSchema>,decision: z.infer<typeof NarrationReviewJournalCandidateSchema>['decision']) {
    return NarrationReviewSchema.parse(decision.kind==='accepted'?{kind:'accepted',contextHash:context.parent.contextHash,
      proposalHash:context.parent.proposalHash,reviewedTextHash:sha256(context.proposal.text),confirmedSourcesOnly:true,
      privateReasoningExcluded:true,uncertaintyExplicit:true,reviewEvidenceId:context.scope.jobId}:{kind:'rejected',
      contextHash:context.parent.contextHash,proposalHash:context.parent.proposalHash,safeCode:decision.safeCode});
  }
  function narrationReviewReceipt(lookup:z.infer<typeof AdministrativeJobLookupSchema>) {
    const value=database.prepare('SELECT payload_json,payload_hash,accepted_at,parent_job_id,parent_generation FROM narration_review_receipts WHERE job_id=? AND generation=?').get(lookup.jobId,lookup.generation);
    if(value===undefined)return undefined;
    const row=z.strictObject({payload_json:z.string(),payload_hash:HashSchema,accepted_at:counter,parent_job_id:JobIdSchema,parent_generation:counter}).parse(value);
    const receipt=NarrationReviewJobReceiptSchema.parse(parseStoredJson(row.payload_json));const job=administrativeJobRow(lookup);
    if(job.context.role!=='narration-reviewer'||job.row.state!=='accepted'||job.context.parent.scope.jobId!==row.parent_job_id
      ||job.context.parent.scope.generation!==row.parent_generation||sha256(row.payload_json)!==row.payload_hash||canonicalJson(receipt)!==row.payload_json
      ||canonicalJson(receipt.execution)!==canonicalJson(administrativeExecution(job.row,job.context))||receipt.contextHash!==job.row.context_hash||receipt.acceptedAt!==row.accepted_at)throw new Error('Receipt review Narrador alterado');
    const candidateRow=z.strictObject({candidate_hash:HashSchema}).parse(database.prepare('SELECT candidate_hash FROM narration_review_candidates WHERE job_id=? AND generation=?').get(lookup.jobId,lookup.generation));
    const candidate=narrationReviewCandidate(receipt.execution,candidateRow.candidate_hash);
    validateNarrationReviewDecision({context:job.context,decision:candidate.decision});
    if(receipt.decisionHash!==narrationValueHash(candidate.decision)||canonicalJson(receipt.decision)!==canonicalJson(candidate.decision)
      ||canonicalJson(receipt.review)!==canonicalJson(stampedNarrationReview(job.context,candidate.decision)))throw new Error('Receipt review Narrador no coincide con decisión exacta');
    return receipt;
  }
  function narrationParentReview(parentExecution:z.infer<typeof AdministrativeJobExecutionSchema>,proposal:z.infer<typeof NarratorJournalCandidateSchema>['proposal']) {
    const lookupValue=database.prepare('SELECT job_id,generation FROM narration_review_receipts WHERE parent_job_id=? AND parent_generation=?').get(parentExecution.scope.jobId,parentExecution.scope.generation);
    if(lookupValue===undefined)throw new Error('Publicación Narrador sin receipt de review independiente');
    const lookup=AdministrativeJobLookupSchema.parse({jobId:Reflect.get(lookupValue,'job_id'),generation:Reflect.get(lookupValue,'generation')});
    const receipt=narrationReviewReceipt(lookup);const child=administrativeJobRow(lookup);
    if(receipt===undefined||child.context.role!=='narration-reviewer'||canonicalJson(child.context.parent.scope)!==canonicalJson(parentExecution.scope)
      ||child.context.parent.contextHash!==parentExecution.contextHash||child.context.parent.proposalHash!==narrationValueHash(proposal)
      ||canonicalJson(child.context.proposal)!==canonicalJson(proposal)||receipt.review.kind!=='accepted')throw new Error('Review Narrador no autoriza candidato/parent exacto');
    return receipt;
  }
  function narrationReceipt(lookup:z.infer<typeof AdministrativeJobLookupSchema>) {
    const value=database.prepare('SELECT payload_json,payload_hash,accepted_at,run_id,pulse_id,through_world_seq FROM narration_receipts WHERE job_id=? AND generation=?').get(lookup.jobId,lookup.generation);if(value===undefined)return undefined;
    const row=z.strictObject({payload_json:z.string(),payload_hash:HashSchema,accepted_at:counter,run_id:RunIdSchema,pulse_id:PulseIdSchema,through_world_seq:counter}).parse(value);const receipt=NarratorJobReceiptSchema.parse(parseStoredJson(row.payload_json));
    const job=administrativeJobRow(lookup);if(job.context.role!=='narrator'||job.row.state!=='accepted'||row.run_id!==job.row.run_id||row.pulse_id!==job.row.pulse_id||row.through_world_seq!==job.row.through_world_seq)throw new Error('Receipt Narrador de otro contexto/estado');
    const candidateRow=z.strictObject({candidate_hash:HashSchema}).parse(database.prepare('SELECT candidate_hash FROM narration_candidates WHERE job_id=? AND generation=?').get(lookup.jobId,lookup.generation));
    const candidate=narrationCandidate(administrativeExecution(job.row,job.context),candidateRow.candidate_hash);
    if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(receipt)!==row.payload_json)throw new Error('Receipt Narrador alterado');
    validateNarrationProposal({context:job.context,proposal:candidate.proposal});
    if(receipt.kind==='published'){
      const publication=receipt.publication;
      if(candidate.proposal.kind!=='narrate'||canonicalJson(publication.scope)!==canonicalJson(job.context.scope)||publication.contextHash!==job.row.context_hash
        ||publication.proposalHash!==narrationValueHash(candidate.proposal)||publication.text!==candidate.proposal.text||publication.textHash!==sha256(publication.text)
        ||canonicalJson(publication.sourceEventIds)!==canonicalJson(candidate.proposal.sourceEventIds)
        ||canonicalJson(publication.sourceRecordedFactIds)!==canonicalJson(candidate.proposal.sourceRecordedFactIds)
        ||publication.sourceWorldRevision!==candidate.proposal.sourceWorldRevision
        ||canonicalJson(publication.uncertainty)!==canonicalJson(candidate.proposal.uncertainty)
        ||publication.publishedAt!==row.accepted_at)throw new Error('Publicación Narrador no coincide con candidato exacto');
      const legacy=database.prepare('SELECT payload_hash FROM legacy_narration_publications WHERE job_id=? AND generation=?').get(job.row.job_id,job.row.generation);
      if(legacy===undefined){const independent=narrationParentReview(candidate.execution,candidate.proposal);
        if(canonicalJson(independent.review)!==canonicalJson(publication.review))throw new Error('Publicación Narrador no liga review independiente exacto');}
      else if(z.strictObject({payload_hash:HashSchema}).parse(legacy).payload_hash!==row.payload_hash)throw new Error('Publicación Narrador legacy alterada');
      validateNarrationReview({context:job.context,proposal:candidate.proposal,review:publication.review});
    }else if(candidate.proposal.kind!=='abstain'||canonicalJson(receipt.scope)!==canonicalJson(job.context.scope)||receipt.contextHash!==job.row.context_hash
      ||receipt.proposalHash!==narrationValueHash(candidate.proposal)||canonicalJson(receipt.proposal)!==canonicalJson(candidate.proposal)||receipt.acceptedAt!==row.accepted_at)throw new Error('Abstención Narrador no coincide con candidato');
    return receipt;
  }
  function narrationPublicationsAt(runId:z.infer<typeof RunIdSchema>,throughWorldSeq:number) {
    const rows=database.prepare("SELECT job_id,generation FROM narration_receipts WHERE run_id=? AND through_world_seq<=? AND json_extract(payload_json,'$.kind')='published' ORDER BY accepted_at,job_id LIMIT 1001")
      .all(runId,throughWorldSeq).map(value=>AdministrativeJobLookupSchema.parse({jobId:Reflect.get(value,'job_id'),generation:Reflect.get(value,'generation')}));
    if(rows.length>1000)throw new Error('Historia Narrador requiere continuación explícita');
    return rows.flatMap(lookup=>{const receipt=narrationReceipt(lookup);return receipt?.kind==='published'?[receipt.publication]:[];});
  }

  function directorReceipt(lookup:z.infer<typeof AdministrativeJobLookupSchema>) {
    const value=database.prepare('SELECT payload_json,payload_hash,accepted_at FROM director_annotations WHERE job_id=? AND generation=?').get(lookup.jobId,lookup.generation);
    if(value===undefined)return undefined;
    const row=z.strictObject({payload_json:z.string(),payload_hash:HashSchema,accepted_at:counter}).parse(value);
    const annotation=DirectorAnnotationSchema.parse(parseStoredJson(row.payload_json));
    if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(annotation)!==row.payload_json||annotation.scope.jobId!==lookup.jobId||annotation.scope.generation!==lookup.generation)throw new Error('Anotación Director alterada');
    const job=administrativeJobRow(lookup);
    if(canonicalJson(annotation.scope)!==canonicalJson(job.context.scope)||annotation.contextHash!==job.row.context_hash||job.row.state!=='accepted')throw new Error('Receipt Director fuera del contexto aceptado');
    if(job.context.role!=='director')throw new Error('Receipt Director de otro rol');
    validateDirectorObservation({context:job.context,observation:annotation.observation});
    const candidateValue=z.strictObject({candidate_hash:HashSchema,payload_json:z.string()}).parse(database.prepare('SELECT candidate_hash,payload_json FROM director_candidates WHERE job_id=? AND generation=?').get(lookup.jobId,lookup.generation));
    const candidate=DirectorCandidateSchema.parse(parseStoredJson(candidateValue.payload_json));
    if(hashJson({execution:candidate.execution,observation:candidate.observation}).hash!==candidateValue.candidate_hash||candidate.candidateHash!==candidateValue.candidate_hash
      ||canonicalJson(candidate.observation)!==canonicalJson(annotation.observation))throw new Error('Anotación Director no coincide con candidato aceptado');
    return DirectorJobReceiptSchema.parse({annotation,acceptedAt:row.accepted_at});
  }
  function directorAnnotationsAt(runId:z.infer<typeof RunIdSchema>,throughWorldSeq:number) {
    const rows=database.prepare('SELECT job_id,generation FROM director_annotations WHERE run_id=? AND through_world_seq<=? ORDER BY accepted_at,annotation_id LIMIT 10001')
      .all(runId,throughWorldSeq).map(value=>AdministrativeJobLookupSchema.parse({jobId:Reflect.get(value,'job_id'),generation:Reflect.get(value,'generation')}));
    if(rows.length>10000)throw new Error('El contexto Director excede su límite; requiere continuación administrativa explícita');
    return rows.map(lookup=>{const receipt=directorReceipt(lookup);if(receipt===undefined)throw new Error('Anotación Director perdida');return receipt.annotation;});
  }
  function directorObservationHistory(input:unknown) {
    const request=z.strictObject({runId:RunIdSchema,throughCommitIndex:RevisionSchema,worldRevision:RevisionSchema,throughWorldSeq:WorldSeqSchema}).parse(input);
    const runValue=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
    if(runValue===undefined)return undefined;
    const run=parseWorldRun(runValue);
    if(request.throughCommitIndex>run.row.commit_index)throw new Error('Corte Director futuro');
    let selectedSnapshot:z.infer<typeof WorldSnapshotSchema>;
    if(request.throughCommitIndex===0){
      selectedSnapshot=run.initialSnapshot;
    }else{
      const selectedValue=database.prepare('SELECT snapshot_json,snapshot_hash,world_revision,last_seq,commit_index FROM world_commits WHERE run_id=? AND commit_index=?')
        .get(request.runId,request.throughCommitIndex);
      if(selectedValue===undefined)throw new Error('Corte Director sin commit persistido');
      const selected=z.strictObject({snapshot_json:z.string(),snapshot_hash:HashSchema,world_revision:RevisionSchema,last_seq:WorldSeqSchema,commit_index:RevisionSchema}).parse(selectedValue);
      if(sha256(selected.snapshot_json)!==selected.snapshot_hash)throw new Error('Hash del corte Director no coincide');
      selectedSnapshot=WorldSnapshotSchema.parse(parseStoredJson(selected.snapshot_json));
      if(canonicalJson(selectedSnapshot)!==selected.snapshot_json||selectedSnapshot.runId!==request.runId
        ||selectedSnapshot.revision!==selected.world_revision||selectedSnapshot.seq!==selected.last_seq
        ||selected.commit_index!==request.throughCommitIndex)throw new Error('Commit Director alterado');
    }
    if(selectedSnapshot.runId!==request.runId||selectedSnapshot.revision!==request.worldRevision||selectedSnapshot.seq!==request.throughWorldSeq){
      throw new Error('Corte Director distinto del snapshot seleccionado');
    }
    const rows=database.prepare('SELECT job_id,generation FROM director_annotations WHERE run_id=? AND through_world_seq<=? ORDER BY accepted_at,annotation_id LIMIT 10001')
      .all(request.runId,request.throughWorldSeq).map(value=>AdministrativeJobLookupSchema.parse({jobId:Reflect.get(value,'job_id'),generation:Reflect.get(value,'generation')}));
    if(rows.length>10000)throw new Error('La historia Director excede su límite; requiere continuación explícita');
    const commitIndexes=new Map<string,number>();
    const evidenceById=new Map<string,{eventId:string;worldSeq:number;commitIndex:number}>();
    const evidenceRow=database.prepare(`SELECT e.payload_json,e.payload_hash,e.world_seq,c.commit_index FROM world_events e
      JOIN world_commits c ON c.run_id=e.run_id AND c.commit_index=(SELECT MIN(commit_index) FROM world_commits x WHERE x.run_id=e.run_id AND x.last_seq>=e.world_seq)
      WHERE e.run_id=? AND e.event_id=?`);
    return rows.flatMap(lookup=>{
      const receipt=directorReceipt(lookup);if(receipt===undefined)throw new Error('Anotación Director perdida');
      const annotation=receipt.annotation;
      const key=`${annotation.scope.worldRevision}:${annotation.scope.throughWorldSeq}`;
      let commitIndex=commitIndexes.get(key);
      if(commitIndex===undefined){
        const target=snapshotAndCommitAtCut(run,annotation.scope.worldRevision,annotation.scope.throughWorldSeq);
        if(target===undefined)throw new Error('La observación Director cita un corte no persistido');
        commitIndex=target.commitIndex;commitIndexes.set(key,commitIndex);
      }
      if(commitIndex>request.throughCommitIndex)return [];
      const evidenceEventReferences=annotation.observation.assessment.evidenceEventIds.map(eventId=>{
        let reference=evidenceById.get(eventId);
        if(reference===undefined){
          const value=evidenceRow.get(request.runId,eventId);
          if(value===undefined)throw new Error('La evidencia citada por el Director no tiene evento confirmado');
          const row=z.strictObject({payload_json:z.string(),payload_hash:HashSchema,world_seq:WorldSeqSchema,commit_index:RevisionSchema}).parse(value);
          if(sha256(row.payload_json)!==row.payload_hash)throw new Error('Hash de evidencia Director alterado');
          const event=WorldEventSchema.parse(parseStoredJson(row.payload_json));
          if(canonicalJson(event)!==row.payload_json||event.runId!==request.runId||event.id!==eventId||event.seq!==row.world_seq){
            throw new Error('Evento de evidencia Director alterado o fuera de corrida');
          }
          reference={eventId,worldSeq:event.seq,commitIndex:row.commit_index};evidenceById.set(eventId,reference);
        }
        if(reference.worldSeq>annotation.scope.throughWorldSeq||reference.commitIndex>commitIndex){
          throw new Error('La evidencia Director es posterior al corte citado');
        }
        return reference;
      });
      return [{annotation,acceptedAt:receipt.acceptedAt,commitIndex,evidenceEventReferences}];
    });
  }
  function directorContextForPulse(run:ReturnType<typeof parseWorldRun>,pulseId:z.infer<typeof PulseIdSchema>,jobId:z.infer<typeof JobIdSchema>,generation:number) {
    const configuration=ReadyRunConfigurationSchema.parse(run.configuration);
    const events=database.prepare('SELECT payload_json,payload_hash FROM world_events WHERE run_id=? AND world_seq<=? ORDER BY world_seq LIMIT 10001')
      .all(run.row.run_id,run.row.last_seq).map(value=>{
        const row=z.strictObject({payload_json:z.string(),payload_hash:HashSchema}).parse(value);const event=WorldEventSchema.parse(parseStoredJson(row.payload_json));
        if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(event)!==row.payload_json||event.runId!==run.row.run_id)throw new Error('Evento Director alterado/ajeno');return event;
      });
    if(events.length>10000)throw new Error('El contexto Director excede su límite; requiere continuación administrativa explícita');
    const scene=run.snapshot.scenes.find(item=>item.id===run.snapshot.activeSceneId);
    return validateDirectorContext({kind:'director-context',schemaVersion:1,role:'director',scope:{runId:run.row.run_id,pulseId,jobId,generation,
      lifecycleRevision:run.row.lifecycle_revision,configurationRevision:run.row.config_revision,worldRevision:run.row.world_revision,
      throughWorldSeq:run.row.last_seq,fictitiousAt:run.snapshot.clock.instant,profile:runInferenceProfile(run)},dramaticLine:configuration.dramaticLine,
      participantCharacterIds:scene?.participantIds??[],confirmedEvents:events,previousAnnotations:directorAnnotationsAt(run.row.run_id,run.row.last_seq)});
  }

  function continuistaJobRow(input: z.infer<typeof ContinuistaJobLookupSchema>) {
    const value=database.prepare('SELECT * FROM continuista_jobs WHERE job_id=? AND generation=?').get(input.jobId,input.generation);
    if(value===undefined)throw new Error('Job Continuista inexistente');
    const row=ContinuistaJobRowSchema.parse(value);
    const context=validateContinuistaReviewContext(parseStoredJson(row.context_json));
    if(canonicalJson(context)!==row.context_json || context.contextHash!==row.context_hash
      || context.payload.scope.runId!==row.run_id || context.payload.scope.actorId!==row.actor_id
      || context.payload.scope.jobId!==row.actor_job_id || context.payload.scope.generation!==row.actor_generation
      || context.payload.scope.pulseId!==row.pulse_id || context.payload.proposal.proposalId!==row.proposal_id
      || context.payload.proposal.version!==row.proposal_version)throw new Error('Scope/contexto durable Continuista alterado');
    return {row,context};
  }
  function continuistaJobView(row:z.infer<typeof ContinuistaJobRowSchema>) {
    return ContinuistaJobViewSchema.parse({runId:row.run_id,actorId:row.actor_id,actorJobId:row.actor_job_id,actorGeneration:row.actor_generation,pulseId:row.pulse_id,
      jobId:row.job_id,generation:row.generation,proposalId:row.proposal_id,version:row.proposal_version,contextHash:row.context_hash,state:row.state,failureCode:row.failure_code});
  }
  function claimedContinuistaJob(execution:z.infer<typeof ContinuistaJobExecutionSchema>) {
    const job=continuistaJobRow(execution);
    if(job.row.state!=='running' || job.row.owner_token!==execution.lease.ownerToken || job.row.claim_token!==execution.lease.claimToken
      || canonicalJson(ActorJobExecutionSchema.parse(parseStoredJson(job.row.actor_execution_json)))!==canonicalJson(execution.actorExecution))throw new Error('Lease Continuista o actor inválido');
    return job;
  }
  function continuistaEligibility(execution:z.infer<typeof ContinuistaJobExecutionSchema>):{kind:'active'}|{kind:'inactive';reason:string} {
    let job:ReturnType<typeof continuistaJobRow>;
    try {job=claimedContinuistaJob(execution);}catch{return {kind:'inactive',reason:'claim_inactive'};}
    const actor=actorJobEligibility(execution.actorExecution);if(actor.kind!=='active')return actor;
    const proposal=proposalRecord(job.row.run_id,job.row.proposal_id,job.row.proposal_version).record;
    if(canonicalJson(proposal)!==canonicalJson(job.context.payload.proposal))return {kind:'inactive',reason:'proposal_context_mismatch'};
    const session=continuistaSession(execution);
    if(session!==undefined&&canonicalJson(resolveStoredPiProfile(session.profile))!==canonicalJson(actorJobInferenceProfile(execution.actorExecution)))return {kind:'inactive',reason:'inference_profile_changed'};
    return {kind:'active'};
  }
  function continuistaSession(input:z.infer<typeof ContinuistaJobLookupSchema>) {
    const value=database.prepare('SELECT payload_json,payload_hash FROM continuista_sessions WHERE job_id=? AND generation=?').get(input.jobId,input.generation);
    if(value===undefined)return undefined;
    const stored=z.strictObject({payload_json:z.string(),payload_hash:HashSchema}).parse(value);
    const session=ContinuistaSessionSchema.parse(parseStoredJson(stored.payload_json));
    if(sha256(stored.payload_json)!==stored.payload_hash || canonicalJson(session)!==stored.payload_json
      || session.jobId!==input.jobId || session.generation!==input.generation || session.contextHash!==continuistaJobRow(input).row.context_hash)throw new Error('Sesión Continuista durable alterada');
    return session;
  }
  function continuistaReservation(execution:z.infer<typeof ContinuistaJobExecutionSchema>,requestSeq:number) {
    const value=database.prepare(`SELECT r.run_id,r.pulse_id,r.state,l.execution_json FROM request_reservations r
      JOIN continuista_request_leases l ON l.job_id=r.job_id AND l.generation=r.generation AND l.request_seq=r.request_seq
      WHERE r.job_id=? AND r.generation=? AND r.request_seq=?`).get(execution.jobId,execution.generation,requestSeq);
    const row=z.strictObject({run_id:RunIdSchema,pulse_id:PulseIdSchema,state:z.enum(['reserved','dispatched','completed','undispatched','ambiguous']),execution_json:z.string()}).parse(value);
    if(row.run_id!==execution.actorExecution.runId || row.pulse_id!==execution.actorExecution.pulseId
      || canonicalJson(ContinuistaJobExecutionSchema.parse(parseStoredJson(row.execution_json)))!==canonicalJson(execution))throw new Error('Reserva Continuista pertenece a otro lease/scope');
    return row;
  }
  function continuistaTerminalProof(input:z.infer<typeof ContinuistaJobLookupSchema>,candidateHash:z.infer<typeof HashSchema>,terminalHash?:z.infer<typeof HashSchema>) {
    const {row,context}=continuistaJobRow(input);const session=continuistaSession(input);
    if(session===undefined)throw new Error('Terminal Continuista sin sesión durable');
    const execution=ContinuistaJobExecutionSchema.parse({actorExecution:parseStoredJson(row.actor_execution_json),jobId:row.job_id,generation:row.generation,lease:{ownerToken:row.owner_token,claimToken:row.claim_token}});
    const stored=z.strictObject({candidate_hash:HashSchema,payload_json:z.string()}).parse(database.prepare('SELECT candidate_hash,payload_json FROM continuista_candidates WHERE job_id=? AND generation=?').get(row.job_id,row.generation));
    if(stored.candidate_hash!==candidateHash||sha256(stored.payload_json)!==candidateHash)throw new Error('Hash candidato Continuista inválido');
    const response=validateContinuistaContextReview({context,response:parseStoredJson(stored.payload_json)});if(canonicalJson(response)!==stored.payload_json)throw new Error('Candidato Continuista no canónico');
    const terminals=database.prepare(`SELECT checkpoint_hash,payload_json FROM continuista_checkpoints WHERE job_id=? AND generation=? AND purpose_kind='terminal-candidate'`).all(row.job_id,row.generation);
    if(terminals.length!==1)throw new Error('Aceptación Continuista exige un único terminal');
    const terminal=z.strictObject({checkpoint_hash:HashSchema,payload_json:z.string()}).parse(terminals[0]);
    const checkpoint=ContinuistaCheckpointSchema.parse(parseStoredJson(terminal.payload_json));
    if(terminalHash!==undefined&&terminalHash!==terminal.checkpoint_hash)throw new Error('Receipt Continuista refiere terminal distinto');
    if(sha256(terminal.payload_json)!==terminal.checkpoint_hash||canonicalJson(checkpoint)!==terminal.payload_json||canonicalJson(checkpoint.execution)!==canonicalJson(execution)
      ||checkpoint.purpose.kind!=='terminal-candidate'||checkpoint.purpose.outcome!=='completed'||checkpoint.purpose.lastRequestSeq===null
      ||checkpoint.snapshot.candidateLeafId===null||checkpoint.snapshot.sessionId!==session.sessionId||checkpoint.snapshot.sessionPath!==session.sessionPath
      ||continuistaReservation(execution,checkpoint.purpose.lastRequestSeq).state!=='completed')throw new Error('Terminal Continuista incompleto, abortado o de otro lease/sesión');
    const max=z.strictObject({last:counter.nullable()}).parse(database.prepare('SELECT MAX(request_seq) last FROM request_reservations WHERE job_id=? AND generation=?').get(row.job_id,row.generation));
    if(max.last!==checkpoint.purpose.lastRequestSeq)throw new Error('Terminal Continuista no corresponde a la última request');
    const inputRow=z.strictObject({checkpoint_hash:HashSchema,payload_json:z.string()}).parse(database.prepare(`SELECT checkpoint_hash,payload_json FROM continuista_checkpoints WHERE job_id=? AND generation=? AND purpose_kind='request-input' AND request_seq=?`).get(row.job_id,row.generation,max.last));
    const inputCheckpoint=ContinuistaCheckpointSchema.parse(parseStoredJson(inputRow.payload_json));
    if(sha256(inputRow.payload_json)!==inputRow.checkpoint_hash||canonicalJson(inputCheckpoint)!==inputRow.payload_json||canonicalJson(inputCheckpoint.execution)!==canonicalJson(execution)
      ||inputCheckpoint.purpose.kind!=='request-input'||inputCheckpoint.purpose.requestSeq!==max.last||inputCheckpoint.snapshot.sessionId!==session.sessionId||inputCheckpoint.snapshot.sessionPath!==session.sessionPath)throw new Error('Input terminal Continuista no coincide con scope/sesión');
    if(database.prepare(`SELECT 1 FROM request_reservations WHERE job_id=? AND generation=? AND state IN('reserved','dispatched','ambiguous') LIMIT 1`).get(row.job_id,row.generation)!==undefined)throw new Error('Request Continuista sin confirmación terminal');
    return {response,terminal};
  }

  function readContinuistaReceipt(input:z.infer<typeof ContinuistaJobLookupSchema>) {
    const value=database.prepare('SELECT payload_json,payload_hash FROM continuista_receipts WHERE job_id=? AND generation=?').get(input.jobId,input.generation);
    if(value===undefined)return undefined;
    const stored=z.strictObject({payload_json:z.string(),payload_hash:HashSchema}).parse(value);const receipt=ContinuistaReceiptSchema.parse(parseStoredJson(stored.payload_json));
    const job=continuistaJobRow(input);
    if(job.row.state!=='accepted'||sha256(stored.payload_json)!==stored.payload_hash||canonicalJson(receipt)!==stored.payload_json
      ||receipt.jobId!==input.jobId||receipt.generation!==input.generation||receipt.contextHash!==job.row.context_hash)throw new Error('Receipt Continuista durable alterado');
    const proof=continuistaTerminalProof(input,receipt.candidateHash,receipt.terminalHash);
    if(canonicalJson(proof.response.review)!==canonicalJson(receipt.review))throw new Error('Receipt Continuista no coincide con review del candidato');
    return receipt;
  }

  function actorRecoveryProof(execution:z.infer<typeof ActorJobExecutionSchema>) {
    const job=claimedActorJob(execution);
    if(job===undefined)return {result:ActorTurnRecoveryResultSchema.parse({kind:'pending',reason:'actor-inactive'})};
    const run=parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(execution.runId));
    const cut=frozenActorTurnWorldCut(job);
    if(run.row.lifecycle!=='running'||cut===null||cut.worldRevision!==run.snapshot.revision||cut.worldSeq!==run.snapshot.seq||cut.fictionalAt!==run.snapshot.clock.instant
      ||!characterCanReceiveAt({snapshot:run.snapshot,characterId:execution.actorId}))return {result:ActorTurnRecoveryResultSchema.parse({kind:'pending',reason:'actor-inactive'})};
    const requests=database.prepare('SELECT request_seq,state FROM request_reservations WHERE job_id=? AND generation=? ORDER BY request_seq')
      .all(execution.jobId,execution.generation).map((value)=>z.strictObject({request_seq:counter,state:z.enum(['reserved','dispatched','completed','undispatched','ambiguous'])}).parse(value));
    if(requests.some((request)=>['reserved','dispatched','ambiguous'].includes(request.state)))return {result:ActorTurnRecoveryResultSchema.parse({kind:'pending',reason:'uncertain-request'})};
    const latestValue=database.prepare(`SELECT proposal_id,version FROM world_proposals WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? ORDER BY version DESC LIMIT 1`)
      .get(execution.runId,execution.actorId,execution.jobId,execution.generation);
    const terminalValues=database.prepare(`SELECT * FROM actor_pi_candidates WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND candidate_kind='terminal-candidate' ORDER BY recorded_at,candidate_id`)
      .all(execution.runId,execution.actorId,execution.jobId,execution.generation);
    const partial=database.prepare(`SELECT 1 FROM actor_job_checkpoints WHERE job_id=? AND generation=? UNION ALL
      SELECT 1 FROM actor_pi_candidates WHERE job_id=? AND generation=? LIMIT 1`).get(execution.jobId,execution.generation,execution.jobId,execution.generation)!==undefined;
    if(requests.length===0&&latestValue===undefined&&terminalValues.length===0&&!partial)return {result:ActorTurnRecoveryResultSchema.parse({kind:'fresh'})};
    if(actorJobEligibility(execution).kind!=='active')return {result:ActorTurnRecoveryResultSchema.parse({kind:'pending',reason:'actor-inactive'})};
    const last=requests.at(-1);const terminals=terminalValues.map(actorCandidateFromRow).filter((candidate)=>candidate.kind==='terminal-candidate'&&candidate.lastRequestSeq===last?.request_seq);
    if(terminals.length!==1)return {result:ActorTurnRecoveryResultSchema.parse({kind:'pending',reason:'terminal-missing'})};
    const candidate=terminals[0];
    if(candidate===undefined||candidate.kind!=='terminal-candidate'||candidate.outcome!=='completed'||candidate.lastRequestSeq===null||candidate.candidateLeafId===null||candidate.lease===undefined||last?.state!=='completed')return {result:ActorTurnRecoveryResultSchema.parse({kind:'pending',reason:'terminal-missing'})};
    if(latestValue===undefined)return {result:ActorTurnRecoveryResultSchema.parse({kind:'pending',reason:'proposal-missing'})};
    const latest=z.strictObject({proposal_id:ProposalIdSchema,version:counter}).parse(latestValue);const proposal=proposalRecord(execution.runId,latest.proposal_id,latest.version).record;
    const binding=z.strictObject({proposal_id:ProposalIdSchema,version:counter,attempt_hash:HashSchema}).parse(database.prepare('SELECT proposal_id,version,attempt_hash FROM actor_terminal_proposals WHERE candidate_id=?').get(candidate.candidateId));
    if(binding.proposal_id!==proposal.proposalId||binding.version!==proposal.version||binding.attempt_hash!==proposal.attemptHash)throw new Error('Terminal parental no pertenece a la última propuesta exacta');
    const originalExecution=ActorJobExecutionSchema.parse({...execution,lease:candidate.lease});
    verifyCandidateBase(candidate);
    const session=currentActorSession(parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(execution.runId)),execution.actorId);
    if(session===undefined||canonicalJson(session)!==canonicalJson(candidate.base)||canonicalJson(candidate.inputCut)!==canonicalJson(frozenActorTurnWorldCut(job))
      ||candidate.runId!==execution.runId||candidate.actorId!==execution.actorId||candidate.scope.jobId!==execution.jobId||candidate.scope.generation!==execution.generation
      ||candidate.scope.pulseId!==execution.pulseId)throw new Error('Terminal parental no coincide con sesión, contexto o corte');
    const inputValue=database.prepare(`SELECT * FROM actor_pi_candidates WHERE job_id=? AND generation=? AND turn_id=? AND candidate_kind='request-input' AND request_seq=?`)
      .get(execution.jobId,execution.generation,candidate.turnId,candidate.lastRequestSeq);
    const input=actorCandidateFromRow(inputValue);
    if(input.kind!=='request-input'||canonicalJson(input.base)!==canonicalJson(candidate.base)||canonicalJson(input.inputCut)!==canonicalJson(candidate.inputCut)
      ||canonicalJson(input.lease)!==canonicalJson(candidate.lease))throw new Error('Input parental no coincide con terminal original');
    actorJobReservation(originalExecution,candidate.lastRequestSeq);
    const checkpoints=database.prepare('SELECT checkpoint_hash,payload_json FROM actor_job_checkpoints WHERE job_id=? AND generation=? ORDER BY recorded_at,checkpoint_hash')
      .all(execution.jobId,execution.generation).map((value)=>{
        const stored=z.strictObject({checkpoint_hash:HashSchema,payload_json:z.string()}).parse(value);const checkpoint=ActorJobCheckpointSchema.parse(parseStoredJson(stored.payload_json));
        if(sha256(stored.payload_json)!==stored.checkpoint_hash||canonicalJson(checkpoint)!==stored.payload_json)throw new Error('Checkpoint parental alterado');return {stored,checkpoint};
      });
    const terminalCheckpoint=checkpoints.filter(({checkpoint})=>checkpoint.purpose.kind==='terminal-candidate'&&checkpoint.purpose.outcome==='completed'
      &&checkpoint.purpose.lastRequestSeq===candidate.lastRequestSeq&&checkpoint.snapshot.candidateLeafId===candidate.candidateLeafId&&canonicalJson(checkpoint.execution)===canonicalJson(originalExecution));
    const inputCheckpoint=checkpoints.filter(({checkpoint})=>checkpoint.purpose.kind==='request-input'&&checkpoint.purpose.requestSeq===candidate.lastRequestSeq
      &&checkpoint.snapshot.candidateLeafId===input.candidateLeafId&&canonicalJson(checkpoint.execution)===canonicalJson(originalExecution));
    if(terminalCheckpoint.length!==1||inputCheckpoint.length!==1||[...terminalCheckpoint,...inputCheckpoint].some(({checkpoint})=>checkpoint.snapshot.sessionId!==session.sessionId||checkpoint.snapshot.sessionPath!==session.sessionPath))throw new Error('Faltan proofs originales del terminal parental');
    const adminValue=database.prepare(`SELECT job_id,generation FROM continuista_jobs WHERE run_id=? AND actor_id=? AND actor_job_id=? AND actor_generation=? AND proposal_id=? AND proposal_version=? ORDER BY generation DESC LIMIT 1`)
      .get(execution.runId,execution.actorId,execution.jobId,execution.generation,proposal.proposalId,proposal.version);
    if(adminValue===undefined)return {result:ActorTurnRecoveryResultSchema.parse({kind:'pending',reason:'review-missing'})};
    const adminRow=z.strictObject({job_id:JobIdSchema,generation:RevisionSchema}).parse(adminValue);
    const adminLookup=ContinuistaJobLookupSchema.parse({jobId:adminRow.job_id,generation:adminRow.generation});
    const admin=continuistaJobRow(adminLookup);const review=readContinuistaReceipt(adminLookup);
    if(review===undefined)return {result:ActorTurnRecoveryResultSchema.parse({kind:'pending',reason:'review-missing'})};
    if(canonicalJson(admin.context.payload.proposal)!==canonicalJson(proposal)||canonicalJson(admin.context.payload.inputCut)!==canonicalJson(candidate.inputCut)
      ||admin.context.payload.preparedContextHash!==candidate.base.preparedContextHash)throw new Error('Receipt Continuista no corresponde al terminal parental');
    if(review.review.verdict!=='allow')return {result:ActorTurnRecoveryResultSchema.parse({kind:'pending',reason:'review-not-allow'})};
    const proposalBinding={kind:'durable',proposalId:proposal.proposalId,version:proposal.version,attemptHash:proposal.attemptHash};
    const proof=hashJson({execution,candidate,proposal,adminReceipt:review,terminalCheckpoint:terminalCheckpoint[0]?.stored.checkpoint_hash,inputCheckpoint:inputCheckpoint[0]?.stored.checkpoint_hash});
    return {result:ActorTurnRecoveryResultSchema.parse({kind:'completed',candidateId:candidate.candidateId,proposal,proposalBinding,review:review.review,
      sessionIntegrity:{sessionId:candidate.base.sessionId,sessionPath:candidate.base.sessionPath,baseLeafId:candidate.base.committedLeafId,
        inputLeafId:input.candidateLeafId,terminalLeafId:candidate.candidateLeafId}}),proofHash:proof.hash,proofJson:proof.json};
  }

  function acceptActorTurnWithinTransaction(request:z.infer<typeof ActorTurnAcceptanceSchema>,reconciledExecution?:z.infer<typeof ActorJobExecutionSchema>) {
    const acceptance=hashJson(request);

        const receiptValue = database.prepare(`
          SELECT receipt_json,receipt_hash,acceptance_hash FROM actor_pi_turn_receipts WHERE candidate_id=?
        `).get(request.candidateId);
        if (receiptValue !== undefined) {
          const stored = ActorPiReceiptDbRowSchema.parse(receiptValue);
          if (stored.acceptance_hash !== acceptance.hash || sha256(stored.receipt_json) !== stored.receipt_hash) {
            throw new Error('La aceptación Pi existente tiene otro payload');
          }
          const receipt = ActorPiReceiptSchema.parse(parseStoredJson(stored.receipt_json));
          if (canonicalJson(receipt) !== stored.receipt_json) throw new Error('Receipt Pi no canónico');
          return receipt;
        }
        const candidateValue = database.prepare('SELECT * FROM actor_pi_candidates WHERE candidate_id=?')
          .get(request.candidateId);
        if (candidateValue === undefined) throw new Error('No existe candidato Pi terminal para aceptar');
        const candidate = actorCandidateFromRow(candidateValue);
        if (candidate.kind !== 'terminal-candidate' || candidate.outcome !== 'completed'
          || candidate.lastRequestSeq === null || candidate.candidateLeafId === null) {
          throw new Error('Sólo un candidato terminal completado puede aceptarse');
        }
        const scheduledJobValue = database.prepare(`
          SELECT * FROM actor_turn_jobs
          WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?
        `).get(candidate.runId, candidate.actorId, candidate.scope.jobId, candidate.scope.generation);
        let assignedPerceptionIds: string[] = [];
        if (scheduledJobValue !== undefined) {
          const scheduledJob = ActorTurnJobDbRowSchema.parse(scheduledJobValue);
          if (scheduledJob.pulse_id !== candidate.scope.pulseId || scheduledJob.state !== 'running'
            || request.lease === undefined || scheduledJob.owner_token !== request.lease.ownerToken
            || scheduledJob.claim_token !== request.lease.claimToken || candidate.lease === undefined
            || (reconciledExecution===undefined && (candidate.lease.ownerToken !== request.lease.ownerToken
            || candidate.lease.claimToken !== request.lease.claimToken))) {
            throw new Error('El job actoral requiere el claim y owner vigentes para aceptar su turno');
          }
          const run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(candidate.runId));
          if (!actorJobEpochCurrent(scheduledJob,run)) throw new Error('El job actoral pertenece a una época de lifecycle anterior');
          assignedPerceptionIds = assignedActorTurnPerceptionIds({ ...candidate.scope, actorId: candidate.actorId });
          const frozenPerceptionIds = frozenActorTurnPerceptionIds(scheduledJob);
          const frozenWorldCut = frozenActorTurnWorldCut(scheduledJob);
          if (frozenPerceptionIds === null || frozenWorldCut === null
            || canonicalJson(candidate.inputCut) !== canonicalJson(frozenWorldCut)) {
            throw new Error('El corte Pi no coincide con el corte World e inbox congelados del job actoral');
          }
          if ((assignedPerceptionIds.length === 0 && actorActivationInvitationForJob({
            ...candidate.scope, actorId: candidate.actorId,
          }) === undefined) || assignedPerceptionIds.some((perceptionId) =>
            !candidate.inputCut.perceptionIds.includes(PerceptionIdSchema.parse(perceptionId)))) {
            throw new Error('El corte Pi exacto no incluye todas las percepciones asignadas al job');
          }
        } else {
          const activeJobValue = database.prepare(`
            SELECT job_id,generation FROM actor_turn_jobs
            WHERE run_id=? AND actor_id=? AND state IN('queued','running')
          `).get(candidate.runId, candidate.actorId);
          if (activeJobValue !== undefined || request.lease !== undefined) {
            throw new Error('El turno Pi no pertenece al job actoral durable activo');
          }
        }
        verifyCandidateBase(candidate);
        const frozenPerceptionIds = scheduledJobValue === undefined
          ? undefined
          : frozenActorTurnPerceptionIds(ActorTurnJobDbRowSchema.parse(scheduledJobValue)) ?? undefined;
        verifyActorInputCut({
          runId: candidate.runId, actorId: candidate.actorId, cut: candidate.inputCut,
          ...(frozenPerceptionIds === undefined ? {} : { expectedPerceptionIds: frozenPerceptionIds }),
        });
        const currentBase = currentActorSession(parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(candidate.runId)),candidate.actorId);
        if (currentBase===undefined||currentBase.sessionRevision !== candidate.base.sessionRevision
          || currentBase.committedLeafId !== candidate.base.committedLeafId
          || currentBase.sessionId !== candidate.base.sessionId || currentBase.sessionPath !== candidate.base.sessionPath
          || currentBase.preparedContextHash !== candidate.base.preparedContextHash) {
          throw new Error('Conflicto CAS: el checkpoint aceptado cambió desde el input Pi');
        }

        const requestCandidates = database.prepare(`
          SELECT * FROM actor_pi_candidates
          WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND turn_id=? AND candidate_kind='request-input'
          ORDER BY request_seq
        `).all(candidate.runId, candidate.actorId, candidate.scope.jobId, candidate.scope.generation, candidate.turnId)
          .map((row) => actorCandidateFromRow(row));
        if (requestCandidates.length === 0 || requestCandidates.some((item) => item.kind !== 'request-input'
          || canonicalJson(item.inputCut) !== canonicalJson(candidate.inputCut))) {
          throw new Error('Los inputs del turno no comparten el corte terminal registrado');
        }
        const lastInput = requestCandidates.at(-1);
        if (lastInput?.kind !== 'request-input' || lastInput.requestSeq !== candidate.lastRequestSeq) {
          throw new Error('El candidato terminal no referencia el último request durable de su turno');
        }
        const reservationValue = database.prepare(`
          SELECT run_id,pulse_id,state FROM request_reservations WHERE job_id=? AND generation=? AND request_seq=?
        `).get(candidate.scope.jobId, candidate.scope.generation, candidate.lastRequestSeq);
        if (reservationValue === undefined) throw new Error('Falta la reserva terminal del turno Pi');
        const reservation = z.strictObject({
          run_id: RunIdSchema, pulse_id: PulseIdSchema,
          state: z.enum(['reserved', 'dispatched', 'completed', 'undispatched', 'ambiguous']),
        }).parse(reservationValue);
        if (reservation.run_id !== candidate.runId || reservation.pulse_id !== candidate.scope.pulseId
          || reservation.state !== 'completed') throw new Error('El último request Pi no terminó con respuesta confirmada');

        if (request.proposal.kind === 'durable') {
          const found = proposalRecord(candidate.runId, request.proposal.proposalId, request.proposal.version);
          if (found.row.actor_id !== candidate.actorId || found.row.job_id !== candidate.scope.jobId
            || found.row.generation !== candidate.scope.generation || found.row.attempt_hash !== request.proposal.attemptHash) {
            throw new Error('La propuesta durable no pertenece al actor y job del turno aceptado');
          }
        }

        const acceptedAt = Date.now();
        const receipt = ActorPiReceiptSchema.parse({
          kind: 'actor-turn-accepted', receiptId: randomUUID(), runId: candidate.runId, actorId: candidate.actorId,
          candidateId: candidate.candidateId, turnId: candidate.turnId, scope: candidate.scope,
          baseSessionRevision: candidate.base.sessionRevision,
          sessionRevision: RevisionSchema.parse(candidate.base.sessionRevision + 1),
          baseLeafId: candidate.base.committedLeafId, committedLeafId: candidate.candidateLeafId,
          consumedPerceptionIds: candidate.inputCut.perceptionIds, proposal: request.proposal,
          payloadHash: acceptance.hash, acceptedAt,
        });
        const receiptPayload = hashJson(receipt);
        for (const perceptionId of candidate.inputCut.perceptionIds) {
          const rowValue = database.prepare(`
            SELECT p.run_id,p.recipient_actor_id,p.world_seq,p.payload_json,p.payload_hash,d.state
            FROM world_perceptions p JOIN world_deliveries d ON d.perception_id=p.perception_id
            WHERE p.perception_id=?
          `).get(perceptionId);
          if (rowValue === undefined) throw new Error('El cursor Pi referencia percepción desconocida');
          const perceptionRow = z.strictObject({
            run_id: RunIdSchema, recipient_actor_id: CharacterIdSchema, world_seq: counter,
            payload_json: z.string(), payload_hash: HashSchema,
            state: z.enum(['planned', 'delivering', 'delivered', 'failed']),
          }).parse(rowValue);
          const perception = WorldPerceptionSchema.parse(parseStoredJson(perceptionRow.payload_json));
          if (sha256(perceptionRow.payload_json) !== perceptionRow.payload_hash
            || perceptionRow.run_id !== candidate.runId || perceptionRow.recipient_actor_id !== candidate.actorId
            || perceptionRow.state !== 'delivered' || perceptionRow.world_seq > candidate.inputCut.worldSeq
            || perception.fictitiousAt > candidate.inputCut.fictionalAt) {
            throw new Error('La percepción ya no es una entrega válida dentro del corte Pi');
          }
          const consumed = database.prepare(`
            INSERT OR IGNORE INTO actor_pi_consumptions(run_id,actor_id,perception_id,candidate_id,consumed_at)
            VALUES(?,?,?,?,?)
          `).run(candidate.runId, candidate.actorId, perceptionId, candidate.candidateId, acceptedAt);
          if (consumed.changes !== 1) throw new Error('La percepción Pi ya fue consumida por otro turno aceptado');
        }
        if (scheduledJobValue !== undefined) {
          const acceptedAt = Date.now();
          for (const perceptionId of assignedPerceptionIds) {
            const consumed = database.prepare(`
              UPDATE actor_turn_job_inputs SET state='consumed',consumed_at=?
              WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND perception_id=? AND state='assigned'
            `).run(acceptedAt, candidate.runId, candidate.actorId, candidate.scope.jobId,
              candidate.scope.generation, perceptionId);
            if (consumed.changes !== 1) throw new Error('La asignación de percepción cambió antes de aceptar el turno');
          }
          const acceptedJob = database.prepare(`
            UPDATE actor_turn_jobs SET state='accepted',updated_at=?
            WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND pulse_id=?
              AND state='running' AND owner_token=? AND claim_token=?
          `).run(acceptedAt, candidate.runId, candidate.actorId, candidate.scope.jobId,
            candidate.scope.generation, candidate.scope.pulseId,
            request.lease?.ownerToken ?? null, request.lease?.claimToken ?? null);
          if (acceptedJob.changes !== 1) throw new Error('El claim del job actoral cambió antes de aceptar el turno');
        }
        const updated = database.prepare(`
          UPDATE actor_pi_sessions SET committed_leaf_id=?,session_revision=?,updated_at=?
          WHERE run_id=? AND actor_id=? AND session_revision=? AND committed_leaf_id IS ? AND session_id=? AND session_path=? AND prepared_context_hash=?
        `).run(receipt.committedLeafId, receipt.sessionRevision, acceptedAt,
          candidate.runId, candidate.actorId, candidate.base.sessionRevision, candidate.base.committedLeafId,candidate.base.sessionId,candidate.base.sessionPath,candidate.base.preparedContextHash);
        if (updated.changes !== 1) throw new Error('Conflicto CAS al avanzar el checkpoint Pi aceptado');
        database.prepare(`
          INSERT INTO actor_pi_turn_receipts(candidate_id,receipt_json,receipt_hash,acceptance_hash,accepted_at)
          VALUES(?,?,?,?,?)
        `).run(candidate.candidateId, receiptPayload.json, receiptPayload.hash, acceptance.hash, acceptedAt);
        return receipt;

  }

  function registerWorldRunWithinTransaction(input:unknown,replaceEditable=false,forkImport=false):'stored'|'existing' {
      const registration = WorldRunRegistrationSchema.parse(input);
      const snapshot = WorldSnapshotSchema.parse(registration.initialSnapshot);
      const fence = WorldContinuityFenceSchema.parse(registration.continuityFence);
      if (fence.atWorldSeq !== snapshot.seq) throw new Error('El continuity fence debe corresponder al corte inicial');
      const scene = snapshot.scenes.find((item) => item.id === snapshot.activeSceneId);
      if (scene === undefined && !forkImport) throw new Error('El escenario inicial no tiene escena activa');
      if(!forkImport&&ReadyRunConfigurationSchema.safeParse(registration.configuration).data?.forkOrigin!==undefined)throw new Error('Origen derivado requiere publicación de fork');
      if(forkImport && (registration.lifecycle!=='ready'||!ReadyRunConfigurationSchema.parse(registration.configuration).forkOrigin))throw new Error('Importación requiere configuración derivada Ready');
      const preparedActors = snapshot.entities.flatMap((entity) => entity.kind === 'character'
        && entity.preparation.kind === 'prepared' && (forkImport || scene?.participantIds.includes(entity.characterId))
        ? [{ actorId: entity.characterId, continuityId: entity.preparation.continuityId, identityVersion: entity.preparation.identityVersion }]
        : []);
      if (preparedActors.length !== fence.contexts.length) throw new Error('El continuity fence debe cubrir cada actor preparado de la escena');
      for (const prepared of preparedActors) {
        const context = fence.contexts.find((item) => item.actorId === prepared.actorId);
        if (context === undefined || context.continuityId !== prepared.continuityId
          || context.identityVersion !== prepared.identityVersion) {
          throw new Error('El continuity fence no coincide con preparación e identidad del escenario');
        }
      }
      if (new Set(fence.contexts.map((context) => context.actorId)).size !== fence.contexts.length) {
        throw new Error('Actor duplicado en continuity fence');
      }
      const { json: configurationJson, hash: configurationHash } = hashJson(registration.configuration);
      const fenceJson = hashJson(fence).json;
      const { json: snapshotJson, hash: snapshotHash } = hashJson(snapshot);

        const existingValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(snapshot.runId);
        if (existingValue !== undefined) {
          const existing = parseWorldRun(existingValue);
          if (existing.row.config_revision === registration.configurationRevision
            && existing.row.configuration_hash === configurationHash && existing.row.initial_snapshot_hash === snapshotHash
            && hashJson(existing.fence).json === fenceJson) return 'existing';
          if(forkImport)throw new Error('El destino de fork ya existe');
          if(!replaceEditable||(existing.row.lifecycle!=='draft'&&existing.row.lifecycle!=='ready'))throw new Error('Run existente requiere una nueva lineage/configuración versionada');
          database.prepare(`UPDATE world_runs SET config_revision=?,configuration_json=?,configuration_hash=?,continuity_fence_json=?,lifecycle='ready',
            world_revision=?,structure_revision=0,last_seq=?,commit_index=0,initial_snapshot_json=?,initial_snapshot_hash=?,snapshot_json=?,snapshot_hash=?,updated_at=? WHERE run_id=? AND lifecycle IN('draft','ready')`)
            .run(registration.configurationRevision,configurationJson,configurationHash,fenceJson,snapshot.revision,snapshot.seq,snapshotJson,snapshotHash,snapshotJson,snapshotHash,Date.now(),snapshot.runId);
          database.prepare('DELETE FROM act_scenes WHERE run_id=?').run(snapshot.runId);
          database.prepare('DELETE FROM acts WHERE run_id=?').run(snapshot.runId);
          database.prepare('DELETE FROM structure_events WHERE run_id=?').run(snapshot.runId);
          database.prepare('DELETE FROM structure_operations WHERE run_id=?').run(snapshot.runId);
          database.prepare('DELETE FROM episode_scenes WHERE run_id=?').run(snapshot.runId);
          database.prepare('DELETE FROM episodes WHERE run_id=?').run(snapshot.runId);
          if(ReadyRunConfigurationSchema.safeParse(registration.configuration).success) ensureModelTimeRunState(snapshot.runId);
          database.prepare('DELETE FROM world_prepared_contexts WHERE run_id=?').run(snapshot.runId);
          database.prepare('DELETE FROM actor_knowledge WHERE run_id=?').run(snapshot.runId);
          for(const context of fence.contexts){
            database.prepare('INSERT INTO world_prepared_contexts VALUES(?,?,?,?,?,?)').run(snapshot.runId,context.actorId,registration.configurationRevision,context.continuityId,context.identityVersion,context.preparedContextHash);
            const knowledge=hashJson(emptyActorKnowledge({runId:snapshot.runId,actorId:context.actorId}));
            database.prepare('INSERT INTO actor_knowledge VALUES(?,?,0,?,?,?)').run(snapshot.runId,context.actorId,snapshot.seq,knowledge.json,knowledge.hash);
          }
          database.prepare('DELETE FROM actor_state_cut_batches WHERE run_id=? AND commit_index=0').run(snapshot.runId);
          pendingInitialActorCuts.add(snapshot.runId);
          return 'stored';
        }
        database.prepare(`
          INSERT INTO world_runs(
            run_id,config_revision,configuration_json,configuration_hash,continuity_fence_json,lifecycle,
            world_revision,last_seq,commit_index,initial_snapshot_json,initial_snapshot_hash,
            snapshot_json,snapshot_hash,updated_at,created_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          snapshot.runId, registration.configurationRevision, configurationJson, configurationHash, fenceJson,
          registration.lifecycle, snapshot.revision, snapshot.seq, 0, snapshotJson, snapshotHash,
          snapshotJson, snapshotHash, Date.now(), Date.now(),
        );
        if(ReadyRunConfigurationSchema.safeParse(registration.configuration).success) ensureModelTimeRunState(snapshot.runId);
        for (const context of fence.contexts) {
          database.prepare(`
            INSERT INTO world_prepared_contexts(
              run_id,actor_id,config_revision,continuity_id,identity_version,prepared_context_hash
            ) VALUES(?,?,?,?,?,?)
          `).run(snapshot.runId, context.actorId, registration.configurationRevision,
            context.continuityId, context.identityVersion, context.preparedContextHash);
          if(forkImport)continue;
          const knowledge = emptyActorKnowledge({ runId: snapshot.runId, actorId: context.actorId });
          const knowledgePayload = hashJson(knowledge);
          database.prepare(`
            INSERT INTO actor_knowledge(run_id,actor_id,knowledge_revision,at_world_seq,payload_json,payload_hash)
            VALUES(?,?,0,?,?,?)
          `).run(snapshot.runId, context.actorId, snapshot.seq, knowledgePayload.json, knowledgePayload.hash);
        }
        pendingInitialActorCuts.add(snapshot.runId);
        return 'stored';

  }

  function readRunModelTimeBudget(input: z.infer<typeof RunModelTimeBudgetReadSchema>) {
    const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(input.runId);
    if (runValue === undefined) return undefined;
    const run = parseWorldRun(runValue);
    const configuration = ReadyRunConfigurationSchema.safeParse(run.configuration);
    if (!configuration.success || configuration.data.runId !== input.runId
      || configuration.data.configRevision !== run.row.config_revision) return undefined;
    const budgetRowValue = database.prepare('SELECT max_calls,consumed FROM run_budgets WHERE run_id=?').get(input.runId);
    const runCallsUsed = budgetRowValue === undefined ? 0 : budgetRow.parse(budgetRowValue).consumed;
    const reservedPiCalls = z.strictObject({ count: counter }).parse(database.prepare(`
      SELECT COUNT(*) AS count FROM request_reservations WHERE run_id=? AND state='reserved'
    `).get(input.runId)).count;
    const maxPulseUsage = z.strictObject({ used: counter.nullable() }).parse(database.prepare(`
      SELECT COALESCE((SELECT p.consumed FROM coordinator_pulses c JOIN pulses p ON p.pulse_id=c.pulse_id
        WHERE c.run_id=? AND c.state='running' LIMIT 1),MAX(consumed)) AS used FROM pulses WHERE run_id=?
    `).get(input.runId, input.runId)).used ?? 0;
    const counts = modelTimeCounts(input.runId);
    const stateValue = database.prepare('SELECT unknown_legacy_requests FROM model_time_run_state WHERE run_id=?').get(input.runId);
    const unknownLegacyRequests = stateValue === undefined
      ? z.strictObject({ count: counter }).parse(database.prepare(`SELECT COUNT(*) AS count FROM request_reservations
          WHERE run_id=? AND state IN('dispatched','completed','ambiguous')`).get(input.runId)).count
      : z.strictObject({ unknown_legacy_requests: counter }).parse(stateValue).unknown_legacy_requests;
    const base = {
      runId: input.runId,
      maxPiCallsPerRun: configuration.data.budget.maxPiCallsPerRun,
      runCallsUsed,
      reservedPiCalls,
      maxPiCallsPerPulse: configuration.data.budget.maxPiCallsPerPulse,
      pulseCallsUsed: maxPulseUsage,
      maxConcurrentPiRequests: configuration.data.budget.maxConcurrentPiRequests,
      activePiRequests: counts.active_count,
      maxWallTimeMs: configuration.data.budget.maxWallTimeMs,
      wallTimeReservedMs: counts.reserved_ms,
      requestTimeoutMs: effectiveRequestTimeoutMs(configuration.data.budget),
      uncertainRequests: counts.uncertain_count,
      unknownLegacyRequests,
    };
    if (unknownLegacyRequests > 0) return RunModelTimeBudgetSchema.parse({ ...base, status: 'legacy-unknown', wallTimeMeasuredMs: null, wallTimeRemainingMs: null });
    const wallTimeRemainingMs = Math.max(0, configuration.data.budget.maxWallTimeMs - counts.measured_ms - counts.reserved_ms);
    if (counts.uncertain_count > 0) return RunModelTimeBudgetSchema.parse({ ...base, status: 'uncertain', wallTimeMeasuredMs: counts.measured_ms, wallTimeRemainingMs });
    return RunModelTimeBudgetSchema.parse({ ...base, status: 'known', wallTimeMeasuredMs: counts.measured_ms, wallTimeRemainingMs });
  }

  function assertBudgetSpanOwner(request:{jobId:z.infer<typeof JobIdSchema>;generation:number;requestSeq:number;ownerToken:string;clockEpochId:string}){
    const row=z.strictObject({owner_token:z.uuid(),clock_epoch_id:ModelTimeClockEpochIdSchema,run_id:RunIdSchema,pulse_id:PulseIdSchema,reservation_run:RunIdSchema,reservation_pulse:PulseIdSchema}).parse(database.prepare(`SELECT s.owner_token,s.clock_epoch_id,s.run_id,s.pulse_id,r.run_id AS reservation_run,r.pulse_id AS reservation_pulse FROM model_time_spans s JOIN request_reservations r USING(job_id,generation,request_seq) WHERE s.job_id=? AND s.generation=? AND s.request_seq=?`).get(request.jobId,request.generation,request.requestSeq));
    if(row.owner_token!==request.ownerToken||row.clock_epoch_id!==request.clockEpochId||row.run_id!==row.reservation_run||row.pulse_id!==row.reservation_pulse)throw new Error('MODEL_TIME_RESERVATION_OWNER_MISMATCH');
  }

  function expireModelTimeWithinTransaction(input: z.infer<typeof ModelWallTimeExpirationSchema> & {
    jobId: z.infer<typeof JobIdSchema>; generation: number; requestSeq: number;
  }): 'expired' | 'existing' {
    const value = database.prepare(`SELECT r.run_id,r.state,s.clock_epoch_id,s.state AS span_state,s.expiry_reason
      FROM request_reservations r JOIN model_time_spans s USING(job_id,generation,request_seq)
      WHERE r.job_id=? AND r.generation=? AND r.request_seq=?`).get(input.jobId, input.generation, input.requestSeq);
    if (value === undefined) throw new Error('No existe request temporal para expirar');
    const row = z.strictObject({ run_id: RunIdSchema, state: z.enum(['reserved','dispatched','completed','undispatched','ambiguous']),
      clock_epoch_id: ModelTimeClockEpochIdSchema, span_state: z.enum(['reserved','running','expired','uncertain','settled','undispatched']),
      expiry_reason: z.enum(['timeout','cancelled','host-interrupted']).nullable() }).parse(value);
    if (row.clock_epoch_id !== input.clockEpochId) throw new Error('La expiración refiere a otro epoch monotónico');
    if (row.state === 'ambiguous' && row.span_state === 'expired' && row.expiry_reason === input.reason) return 'existing';
    if (row.state !== 'dispatched' || row.span_state !== 'running') throw new Error('Sólo una request en transporte puede expirar');
    database.prepare(`UPDATE request_reservations SET state='ambiguous' WHERE job_id=? AND generation=? AND request_seq=? AND state='dispatched'`)
      .run(input.jobId, input.generation, input.requestSeq);
    database.prepare(`UPDATE model_time_spans SET state='expired',expiry_reason=? WHERE job_id=? AND generation=? AND request_seq=? AND state='running'`)
      .run(input.reason, input.jobId, input.generation, input.requestSeq);
    if (input.reason === 'timeout') pauseRunForModelTimeBudget(row.run_id);
    return 'expired';
  }

  function structureEventRow(rowValue: unknown) {
    const row = DramaticStructureEventDbRowSchema.parse(rowValue);
    const payload = parseStoredJson(row.payload_json);
    const record = z.record(z.string(), z.unknown()).parse(payload);
    if (canonicalJson(record) !== row.payload_json || sha256(row.payload_json) !== row.payload_hash) {
      throw new Error('Evento estructural alterado o no canónico');
    }
    const commitValue = database.prepare('SELECT world_revision,last_seq FROM world_commits WHERE run_id=? AND commit_index=?')
      .get(row.run_id,row.commit_index);
    if (commitValue === undefined) throw new Error('Evento estructural sin commit de representación');
    const commit = z.strictObject({world_revision:counter,last_seq:counter}).parse(commitValue);
    if (commit.world_revision !== row.world_revision || commit.last_seq !== row.world_seq) {
      throw new Error('Corte del evento estructural no coincide con su commit');
    }
    return DramaticStructureEventSchema.parse({
      runId: row.run_id, structureRevision: row.structure_revision, operationId: row.operation_id,
      principalId: row.principal_id, kind: row.event_kind, payload: record, payloadHash: row.payload_hash,
      worldRevision: row.world_revision, worldSeq: row.world_seq, commitIndex: row.commit_index,
      recordedAt: row.recorded_at,
    });
  }

  function readForkDramaticSeed(run:ReturnType<typeof parseWorldRun>) {
    const value=database.prepare('SELECT payload_json,payload_hash FROM fork_dramatic_seeds WHERE run_id=?').get(run.row.run_id);
    if(value===undefined){if(ReadyRunConfigurationSchema.safeParse(run.configuration).data?.forkOrigin!==undefined)throw new Error('Fork sin base dramática');return undefined;}
    const row=z.strictObject({payload_json:z.string(),payload_hash:HashSchema}).parse(value);
    const seed=ForkDramaticSeedSchema.parse(parseStoredJson(row.payload_json));
    const origin=ReadyRunConfigurationSchema.parse(run.configuration).forkOrigin;
    if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(seed)!==row.payload_json||seed.structure.runId!==run.row.run_id
      ||origin===undefined||canonicalJson(origin.source)!==canonicalJson(seed.source))throw new Error('Base dramática alterada');
    return seed;
  }

  function readDramaticStructureForRun(run: ReturnType<typeof parseWorldRun>) {
    const seed=readForkDramaticSeed(run);
    const eventRows = database.prepare('SELECT * FROM structure_events WHERE run_id=? ORDER BY structure_revision').all(run.row.run_id);
    const events = eventRows.map(structureEventRow);
    if (events.length !== run.row.structure_revision || (events.at(-1)?.structureRevision ?? 0) !== run.row.structure_revision) {
      throw new Error('La revisión estructural no coincide con el journal de estructura');
    }
    const mappedScenes = new Set<string>();
    const episodeRows = database.prepare('SELECT * FROM episodes WHERE run_id=? ORDER BY ordinal').all(run.row.run_id);
    const episodes = episodeRows.map((value) => {
      const row = DramaticEpisodeDbRowSchema.parse(value);
      const openingCut = DramaticCutSchema.parse(parseStoredJson(row.opening_cut_json));
      if (canonicalJson(openingCut) !== row.opening_cut_json || sha256(row.opening_cut_json) !== row.opening_cut_hash) {
        throw new Error('Corte de apertura de episodio alterado');
      }
      let closingCut: z.infer<typeof DramaticCutSchema> | null = null;
      if (row.closing_cut_json !== null) {
        closingCut = DramaticCutSchema.parse(parseStoredJson(row.closing_cut_json));
        if (canonicalJson(closingCut) !== row.closing_cut_json || sha256(row.closing_cut_json) !== row.closing_cut_hash) {
          throw new Error('Corte de cierre de episodio alterado');
        }
      } else if (row.closing_cut_hash !== null) throw new Error('Hash de cierre de episodio sin corte');
      const sceneRows = database.prepare('SELECT scene_id FROM episode_scenes WHERE run_id=? AND episode_id=? ORDER BY ordinal')
        .all(row.run_id,row.episode_id).map((sceneValue) => z.strictObject({scene_id:z.string().uuid()}).parse(sceneValue).scene_id);
      sceneRows.forEach((sceneId) => mappedScenes.add(sceneId));
      const actRows = database.prepare('SELECT * FROM acts WHERE run_id=? AND episode_id=? ORDER BY ordinal').all(row.run_id,row.episode_id);
      const acts = actRows.map((actValue) => {
        const act = DramaticActDbRowSchema.parse(actValue);
        const actSceneIds = database.prepare('SELECT scene_id FROM act_scenes WHERE run_id=? AND episode_id=? AND act_id=? ORDER BY ordinal')
          .all(act.run_id,act.episode_id,act.act_id).map((sceneValue) => z.strictObject({scene_id:z.string().uuid()}).parse(sceneValue).scene_id);
        return DramaticActViewSchema.parse({actId:act.act_id,ordinal:act.ordinal,title:act.title,sceneIds:actSceneIds});
      });
      const consequenceEventIds = z.array(EventIdSchema).max(10_000).parse(parseStoredJson(row.consequence_event_ids_json));
      const openLines = z.array(DramaticLineEvidenceSchema).max(10_000).parse(parseStoredJson(row.open_lines_json));
      if (canonicalJson(consequenceEventIds) !== row.consequence_event_ids_json || canonicalJson(openLines) !== row.open_lines_json) {
        throw new Error('Consecuencias estructurales de episodio no canónicas');
      }
      return DramaticEpisodeViewSchema.parse({
        ...(seed?.structure.episodes.find(episode=>episode.episodeId===row.episode_id)?.forkOrigins===undefined?{}:{forkOrigins:seed.structure.episodes.find(episode=>episode.episodeId===row.episode_id)?.forkOrigins}),
        episodeId:row.episode_id,ordinal:row.ordinal,title:row.title,lifecycle:row.lifecycle,
        openingCut,closingCut,consequenceEventIds,openLines,sceneIds:sceneRows,acts,
      });
    });
    const activeEpisode = episodes.find((episode) => episode.lifecycle === 'open');
    if (episodes.filter((episode) => episode.lifecycle === 'open').length > 1) throw new Error('Más de un episodio activo');
    const currentSceneIds = new Set<string>(run.snapshot.scenes.map((scene) => scene.id));
    if ([...mappedScenes].some((sceneId) => !currentSceneIds.has(sceneId))) throw new Error('Estructura refiere escenas ausentes del snapshot');
    const unassignedLegacyScenes = run.snapshot.scenes.filter((scene) => !mappedScenes.has(scene.id));
    return DramaticStructureViewSchema.parse({runId:run.row.run_id,structureRevision:run.row.structure_revision,
      activeEpisodeId:activeEpisode?.episodeId??null,activeSceneId:run.snapshot.activeSceneId,episodes,unassignedLegacyScenes});
  }

  function readDramaticStructureAtCut(run: ReturnType<typeof parseWorldRun>, worldRevision: number, worldSeq: number) {
    const cut=snapshotAndCommitAtCut(run,worldRevision,worldSeq);
    if(cut===undefined)return undefined;
    const rows=database.prepare('SELECT * FROM structure_events WHERE run_id=? AND commit_index<=? ORDER BY structure_revision')
      .all(run.row.run_id,cut.commitIndex);
    const events=rows.map(structureEventRow);
    if(events.some((event,index)=>event.structureRevision!==index+1))throw new Error('El corte estructural no es continuo');
    const seed=readForkDramaticSeed(run);
    const episodes:Array<z.infer<typeof DramaticEpisodeViewSchema>>=seed===undefined?[]:structuredClone(seed.structure.episodes);
    const findEpisode=(episodeId:string)=>episodes.find((episode)=>episode.episodeId===episodeId);
    for(const event of events){
      const eventCut=DramaticCutSchema.parse({worldRevision:event.worldRevision,worldSeq:event.worldSeq,
        structureRevision:event.structureRevision,commitIndex:event.commitIndex});
      switch(event.kind){
        case 'episodeOpened': {
          const payload=z.object({episodeId:EpisodeIdSchema,ordinal:counter,title:z.string().nullable(),
            associatedInitialSceneId:WorldSceneSchema.shape.id.optional()}).parse(event.payload);
          if(episodes.some((episode)=>episode.episodeId===payload.episodeId))throw new Error('Episodio duplicado en el journal estructural');
          episodes.push(DramaticEpisodeViewSchema.parse({episodeId:payload.episodeId,ordinal:payload.ordinal,title:payload.title,
            lifecycle:'open',openingCut:eventCut,closingCut:null,consequenceEventIds:[],openLines:[],
            sceneIds:payload.associatedInitialSceneId===undefined?[]:[payload.associatedInitialSceneId],acts:[]}));
          break;
        }
        case 'sceneOpened': {
          const payload=z.object({episodeId:EpisodeIdSchema,scene:WorldSceneSchema}).parse(event.payload);
          const episode=findEpisode(payload.episodeId);
          if(episode===undefined||episode.lifecycle!=='open'||episode.sceneIds.includes(payload.scene.id))throw new Error('Apertura de escena incoherente en el journal');
          episode.sceneIds.push(payload.scene.id);
          break;
        }
        case 'episodeClosed': {
          const payload=z.object({episodeId:EpisodeIdSchema,consequenceEventIds:z.array(EventIdSchema).max(10_000),
            openLines:z.array(DramaticLineEvidenceSchema).max(10_000),cut:DramaticCutSchema}).parse(event.payload);
          const episode=findEpisode(payload.episodeId);
          if(episode===undefined||episode.lifecycle!=='open'||canonicalJson(payload.cut)!==canonicalJson(eventCut))throw new Error('Cierre de episodio incoherente en el journal');
          episode.lifecycle='closed';episode.closingCut=payload.cut;episode.consequenceEventIds=payload.consequenceEventIds;episode.openLines=payload.openLines;
          break;
        }
        case 'actsSet': {
          const payload=z.object({episodeId:EpisodeIdSchema,acts:z.array(z.object({actId:ActIdSchema,title:z.string().trim().min(1).max(200),
            sceneIds:z.array(WorldSceneSchema.shape.id).min(1).max(10_000)})).max(1_000)}).parse(event.payload);
          const episode=findEpisode(payload.episodeId);
          if(episode===undefined||payload.acts.some((act)=>act.sceneIds.some((sceneId)=>!episode.sceneIds.includes(sceneId))))throw new Error('Actos incoherentes en el journal estructural');
          episode.acts=payload.acts.map((act,index)=>DramaticActViewSchema.parse({...act,ordinal:index+1}));
          break;
        }
        case 'sceneClosed': {
          const payload=z.object({episodeId:EpisodeIdSchema.nullable(),sceneId:WorldSceneSchema.shape.id,reason:z.string()}).parse(event.payload);
          if(payload.episodeId!==null&&!findEpisode(payload.episodeId)?.sceneIds.includes(payload.sceneId))throw new Error('Cierre de escena incoherente en el journal');
          break;
        }
        default:{const exhaustive:never=event.kind;throw new Error(`Evento estructural desconocido: ${String(exhaustive)}`);}
      }
    }
    if(events.length>cut.commitIndex)throw new Error('El corte incluye revisiones estructurales posteriores');
    const activeEpisodes=episodes.filter((episode)=>episode.lifecycle==='open');
    if(activeEpisodes.length>1)throw new Error('Más de un episodio activo en el corte histórico');
    const mappedScenes=new Set(episodes.flatMap((episode)=>episode.sceneIds));
    const snapshotSceneIds=new Set(cut.snapshot.scenes.map((scene)=>scene.id));
    if([...mappedScenes].some((sceneId)=>!snapshotSceneIds.has(sceneId)))throw new Error('El corte estructural refiere escenas ausentes del snapshot histórico');
    return {structure:DramaticStructureViewSchema.parse({runId:run.row.run_id,structureRevision:events.at(-1)?.structureRevision??0,
      activeEpisodeId:activeEpisodes[0]?.episodeId??null,activeSceneId:cut.snapshot.activeSceneId,episodes,
      unassignedLegacyScenes:cut.snapshot.scenes.filter((scene)=>!mappedScenes.has(scene.id))}),
      worldRevision:cut.snapshot.revision,worldSeq:cut.snapshot.seq,commitIndex:cut.commitIndex};
  }

  function writeStructuralCommit(input: {
    run: ReturnType<typeof parseWorldRun>; operationId: string; principalId: string;
    eventKind: z.infer<typeof DramaticStructureEventDbRowSchema>['event_kind']; payload: Record<string, unknown>;
    snapshotChanges?: Partial<z.infer<typeof WorldSnapshotSchema>>; recordedAt?: number;
  }) {
    const recordedAt=input.recordedAt??Date.now();
    const worldRevision=input.run.row.world_revision+1;
    const structureRevision=input.run.row.structure_revision+1;
    const commitIndex=input.run.row.commit_index+1;
    const snapshot=WorldSnapshotSchema.parse({...input.run.snapshot,...input.snapshotChanges,schemaVersion:2,revision:worldRevision});
    const snapshotPayload=hashJson(snapshot);
    database.prepare(`INSERT INTO world_commits(run_id,origin_kind,origin_id,commit_index,world_revision,last_seq,snapshot_json,snapshot_hash,created_at)
      VALUES(?,'dramaticStructure',?,?,?,?,?,?,?)`).run(input.run.row.run_id,input.operationId,commitIndex,worldRevision,input.run.row.last_seq,snapshotPayload.json,snapshotPayload.hash,recordedAt);
    const changed=database.prepare(`UPDATE world_runs SET world_revision=?,structure_revision=?,commit_index=?,snapshot_json=?,snapshot_hash=?,updated_at=?
      WHERE run_id=? AND world_revision=? AND structure_revision=? AND commit_index=?`).run(
      worldRevision,structureRevision,commitIndex,snapshotPayload.json,snapshotPayload.hash,recordedAt,input.run.row.run_id,
      input.run.row.world_revision,input.run.row.structure_revision,input.run.row.commit_index);
    if(changed.changes!==1)throw new Error('CAS de estructura cambió dentro de la transacción');
    const payload=hashJson(input.payload);
    database.prepare(`INSERT INTO structure_events(run_id,structure_revision,operation_id,principal_id,event_kind,payload_json,payload_hash,
      world_revision,world_seq,commit_index,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.run.row.run_id,structureRevision,input.operationId,input.principalId,input.eventKind,payload.json,payload.hash,
      worldRevision,input.run.row.last_seq,commitIndex,recordedAt);
    return {worldRevision,worldSeq:input.run.row.last_seq,structureRevision,commitIndex,activeSceneId:snapshot.activeSceneId,snapshot};
  }

  function persistDramaticStructureResult(input: {runId:string;principalId:string;idempotencyKey:string;operationId:string;kind:string;requestHash:string;
    result:z.infer<typeof DramaticStructureMutationResultSchema>;recordedAt?:number}) {
    const payload=hashJson(input.result);
    database.prepare(`INSERT INTO structure_operations(run_id,principal_id,idempotency_key,operation_id,operation_kind,request_hash,result_json,result_hash,recorded_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(input.runId,input.principalId,input.idempotencyKey,input.operationId,input.kind,input.requestHash,payload.json,payload.hash,input.recordedAt??Date.now());
    return input.result;
  }

  function structuralOperationCrossExists(principalId:string,idempotencyKey:string) {
    return [
      'SELECT 1 FROM fork_job_retries WHERE principal_id=? AND idempotency_key=?',
      'SELECT 1 FROM fork_jobs WHERE principal_id=? AND idempotency_key=?',
      'SELECT 1 FROM run_draft_operations WHERE principal_id=? AND idempotency_key=?',
      'SELECT 1 FROM pi_oauth_job_operations WHERE principal_id=? AND idempotency_key=?',
      'SELECT 1 FROM pi_access_job_operations WHERE principal_id=? AND idempotency_key=?',
      'SELECT 1 FROM run_preflight_job_operations WHERE principal_id=? AND idempotency_key=?',
      'SELECT 1 FROM run_control_operations WHERE principal_id=? AND idempotency_key=?',
    ].some((sql)=>database.prepare(sql).get(principalId,idempotencyKey)!==undefined);
  }

  function openInitialEpisodeAtStart(run:ReturnType<typeof parseWorldRun>,principalId:string,operationId:string,recordedAt:number) {
    const structure=readDramaticStructureForRun(run);
    if(run.row.structure_revision!==0||structure.episodes.length!==0||run.snapshot.activeSceneId===null){
      throw new Error('Ready inicial requiere un snapshot con una escena activa sin episodio previo');
    }
    const scene=run.snapshot.scenes.find((item)=>item.id===run.snapshot.activeSceneId);
    if(scene===undefined||scene.lifecycle.kind!=='open')throw new Error('Escena inicial no está abierta');
    const episodeId=EpisodeIdSchema.parse(randomUUID());
    const cut=DramaticCutSchema.parse({worldRevision:run.row.world_revision+1,worldSeq:run.row.last_seq,
      structureRevision:run.row.structure_revision+1,commitIndex:run.row.commit_index+1});
    writeStructuralCommit({run,operationId,principalId,eventKind:'episodeOpened',recordedAt,
      payload:{episodeId,ordinal:1,title:null,associatedInitialSceneId:scene.id,origin:'runStart'}});
    const cutPayload=hashJson(cut);const emptyArray='[]';
    database.prepare(`INSERT INTO episodes(run_id,episode_id,ordinal,title,lifecycle,opening_cut_json,opening_cut_hash,
      closing_cut_json,closing_cut_hash,consequence_event_ids_json,open_lines_json) VALUES(?,?,1,NULL,'open',?,?,NULL,NULL,?,?)`)
      .run(run.row.run_id,episodeId,cutPayload.json,cutPayload.hash,emptyArray,emptyArray);
    database.prepare('INSERT INTO episode_scenes(run_id,episode_id,scene_id,ordinal) VALUES(?,?,?,1)')
      .run(run.row.run_id,episodeId,scene.id);
    return {episodeId,cut};
  }

  function admitInitialGoalActivation(run:ReturnType<typeof parseWorldRun>,configuration:z.infer<typeof ReadyRunConfigurationSchema>,recordedAt:number) {
    const existing=database.prepare("SELECT activation_id FROM actor_activation_causes WHERE run_id=? AND trigger_kind='initial-goal'")
      .get(run.row.run_id);
    if(existing!==undefined)return;
    const invitations=planActorActivationInvitations({snapshot:run.snapshot,activeCharacterIds:configuration.roster.activeCharacterIds})
      .filter((invitation)=>invitation.trigger.kind==='initial-goal');
    if(invitations.length===0)return;
    const activationId=ActorActivationIdSchema.parse(randomUUID());
    database.prepare(`INSERT INTO actor_activation_causes(activation_id,run_id,trigger_kind,configuration_hash,lifecycle_revision,
      world_revision,world_seq,fictional_at,state,failure_reason,created_at,updated_at,boundary_at,activation_key)
      VALUES(?,?,'initial-goal',?,?,?,?,?,'pending',NULL,?, ?,NULL,'initial-goal')`)
      .run(activationId,run.row.run_id,run.row.configuration_hash,run.row.lifecycle_revision,run.row.world_revision,run.row.last_seq,
        run.snapshot.clock.instant,recordedAt,recordedAt);
    for(const invitation of invitations){
      const invitationId=ActorActivationInvitationIdSchema.parse(randomUUID());
      database.prepare(`INSERT INTO actor_activation_invitations(invitation_id,activation_id,run_id,actor_id,identity_version,
        trigger_kind,boundary_at,state,failure_reason,created_at,updated_at)
        VALUES(?,?,?, ?,?,'initial-goal',NULL,'pending',NULL,?,?)`)
        .run(invitationId,activationId,run.row.run_id,invitation.actorId,invitation.identityVersion,recordedAt,recordedAt);
    }
  }

  function admitRoutineBoundaryActivations(run:ReturnType<typeof parseWorldRun>,configuration:z.infer<typeof ReadyRunConfigurationSchema>,previousInstant:number,recordedAt:number) {
    if(run.row.lifecycle!=='running'||run.snapshot.clock.instant<=previousInstant)return [] as string[];
    const invitations=planActorActivationInvitations({snapshot:run.snapshot,activeCharacterIds:configuration.roster.activeCharacterIds,previousInstant})
      .filter((invitation)=>invitation.trigger.kind==='routine-boundary');
    const grouped=new Map<number,typeof invitations>();
    for(const invitation of invitations){
      if(invitation.trigger.kind!=='routine-boundary')continue;
      const group=grouped.get(invitation.trigger.boundaryAt)??[];
      group.push(invitation);grouped.set(invitation.trigger.boundaryAt,group);
    }
    const admitted:string[]=[];
    for(const [boundaryAt,actors] of grouped){
      const activationKey=`routine:${boundaryAt}`;
      const existing=database.prepare('SELECT activation_id FROM actor_activation_causes WHERE run_id=? AND activation_key=?')
        .get(run.row.run_id,activationKey);
      if(existing!==undefined)continue;
      const activationId=ActorActivationIdSchema.parse(randomUUID());
      database.prepare(`INSERT INTO actor_activation_causes(activation_id,run_id,trigger_kind,boundary_at,activation_key,
        configuration_hash,lifecycle_revision,world_revision,world_seq,fictional_at,state,failure_reason,created_at,updated_at)
        VALUES(?,?,'routine-boundary',?,?, ?,?,?,?,?, 'pending',NULL,?,?)`)
        .run(activationId,run.row.run_id,boundaryAt,activationKey,run.row.configuration_hash,run.row.lifecycle_revision,
          run.row.world_revision,run.row.last_seq,run.snapshot.clock.instant,recordedAt,recordedAt);
      for(const invitation of actors){
        if(invitation.trigger.kind!=='routine-boundary')continue;
        const invitationId=ActorActivationInvitationIdSchema.parse(randomUUID());
        database.prepare(`INSERT INTO actor_activation_invitations(invitation_id,activation_id,run_id,actor_id,identity_version,
          trigger_kind,boundary_at,state,failure_reason,created_at,updated_at)
          VALUES(?,?,?,?,?,'routine-boundary',?,'pending',NULL,?,?)`)
          .run(invitationId,activationId,run.row.run_id,invitation.actorId,invitation.identityVersion,boundaryAt,recordedAt,recordedAt);
      }
      admitted.push(activationId);
    }
    return admitted;
  }

  function activationInvitationIneligibility(input:{run:ReturnType<typeof parseWorldRun>;configuration:z.infer<typeof ReadyRunConfigurationSchema>;invitationId:string}):string|undefined {
    const value=database.prepare(`SELECT i.activation_id,i.actor_id,i.identity_version,i.trigger_kind,i.boundary_at,i.state,c.state AS cause_state,
        c.configuration_hash,c.trigger_kind AS cause_trigger_kind,c.boundary_at AS cause_boundary_at
      FROM actor_activation_invitations i JOIN actor_activation_causes c ON c.run_id=i.run_id AND c.activation_id=i.activation_id
      WHERE i.run_id=? AND i.invitation_id=?`).get(input.run.row.run_id,input.invitationId);
    if(value===undefined)return 'invitation_missing';
    const row=z.strictObject({activation_id:ActorActivationIdSchema,actor_id:CharacterIdSchema,identity_version:counter,
      trigger_kind:z.enum(['initial-goal','routine-boundary']),boundary_at:counter.nullable(),
      state:z.enum(['pending','assigned','consumed','blocked']),cause_state:z.enum(['pending','running','completed','blocked']),
      configuration_hash:HashSchema,cause_trigger_kind:z.enum(['initial-goal','routine-boundary']),cause_boundary_at:counter.nullable()}).parse(value);
    if(row.state!=='pending'&&row.state!=='assigned')return 'invitation_not_pending';
    if(row.cause_state!=='pending'&&row.cause_state!=='running')return 'activation_not_pending';
    if(row.configuration_hash!==input.run.row.configuration_hash)return 'configuration_changed';
    const actor=input.run.snapshot.entities.find((entity)=>entity.kind==='character'&&entity.characterId===row.actor_id);
    const scene=input.run.snapshot.scenes.find((item)=>item.id===input.run.snapshot.activeSceneId);
    const routineBoundary=actor?.kind==='character'
      ?currentRoutineAvailabilityBoundary({routine:actor.routine,instant:input.run.snapshot.clock.instant,clock:input.run.snapshot.clock}):undefined;
    const triggerMatches=row.trigger_kind===row.cause_trigger_kind&&row.boundary_at===row.cause_boundary_at
      &&(row.trigger_kind==='initial-goal'?row.boundary_at===null:row.boundary_at!==null&&routineBoundary===row.boundary_at);
    if(!triggerMatches||!input.configuration.roster.activeCharacterIds.includes(row.actor_id)
      ||!input.configuration.roster.preparedCharacters.some((item)=>item.characterId===row.actor_id&&item.identityVersion===row.identity_version)
      ||actor?.kind!=='character'||actor.preparation.kind!=='prepared'||actor.preparation.identityVersion!==row.identity_version
      ||(row.trigger_kind==='initial-goal'&&!actor.mind.goals.some((goal)=>goal.state==='active'))||scene?.lifecycle.kind!=='open'||!scene.participantIds.includes(row.actor_id)
      ||actor.presence.kind!=='present'||actor.presence.sceneId!==scene.id
      ||!characterCanReceiveAt({snapshot:input.run.snapshot,characterId:row.actor_id}))return 'actor_ineligible';
    return undefined;
  }

  function blockActivationInvitation(invitationId:string,reason:string,recordedAt:number):void {
    database.prepare(`UPDATE actor_activation_invitations SET state='blocked',failure_reason=?,updated_at=?
      WHERE invitation_id=? AND state IN('pending','assigned')`).run(reason,recordedAt,invitationId);
  }

  function actorActivationInvitationForJob(scope:{runId:string;actorId:string;jobId:string;generation:number}):string|undefined {
    const value=database.prepare(`SELECT invitation_id FROM actor_activation_invitation_jobs
      WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?`)
      .get(scope.runId,scope.actorId,scope.jobId,scope.generation);
    return value===undefined?undefined:z.strictObject({invitation_id:ActorActivationInvitationIdSchema}).parse(value).invitation_id;
  }

  function readDramaticStructureOperation(input:unknown) {
    const request=DramaticStructureLookupSchema.parse(input);
    if(structuralOperationCrossExists(request.principalId,request.idempotencyKey))return DramaticStructureLookupResultSchema.parse({kind:'idempotencyConflict'});
    const value=database.prepare('SELECT * FROM structure_operations WHERE run_id=? AND principal_id=? AND idempotency_key=?')
      .get(request.runId,request.principalId,request.idempotencyKey);
    if(value===undefined)return DramaticStructureLookupResultSchema.parse({kind:'missing'});
    const row=DramaticStructureOperationDbRowSchema.parse(value);
    const result=DramaticStructureMutationResultSchema.parse(parseStoredJson(row.result_json));
    if(sha256(row.result_json)!==row.result_hash||canonicalJson(result)!==row.result_json)throw new Error('Receipt estructural idempotente alterado');
    return DramaticStructureLookupResultSchema.parse({kind:'found',result:result.kind==='stored'?{...result,kind:'existing'}:result});
  }

  function applyDramaticStructureCommand(input:unknown) {
    const request=DramaticStructureWriteSchema.parse(input);
    const command=DramaticStructureCommandSchema.parse(request.command);
    const operationKind=command.kind;
    const requestHash=hashJson({runId:request.runId,operationId:request.operationId,expectedWorldRevision:request.expectedWorldRevision,
      expectedStructureRevision:request.expectedStructureRevision,command}).hash;
    return transact(()=>{
      if(structuralOperationCrossExists(request.principalId,request.idempotencyKey))return DramaticStructureMutationResultSchema.parse({kind:'idempotencyConflict'});
      const previousValue=database.prepare('SELECT * FROM structure_operations WHERE run_id=? AND principal_id=? AND idempotency_key=?')
        .get(request.runId,request.principalId,request.idempotencyKey);
      if(previousValue!==undefined){
        const previous=DramaticStructureOperationDbRowSchema.parse(previousValue);
        if(previous.operation_id!==request.operationId||previous.operation_kind!==operationKind||previous.request_hash!==requestHash)
          return DramaticStructureMutationResultSchema.parse({kind:'idempotencyConflict'});
        const prior=DramaticStructureMutationResultSchema.parse(parseStoredJson(previous.result_json));
        if(sha256(previous.result_json)!==previous.result_hash||canonicalJson(prior)!==previous.result_json)throw new Error('Receipt estructural idempotente alterado');
        return DramaticStructureMutationResultSchema.parse(prior.kind==='stored'?{...prior,kind:'existing'}:prior);
      }
      const reusedOperation=database.prepare('SELECT 1 FROM structure_operations WHERE run_id=? AND operation_id=?').get(request.runId,request.operationId)
        ??database.prepare('SELECT 1 FROM structure_events WHERE run_id=? AND operation_id=?').get(request.runId,request.operationId);
      if(reusedOperation!==undefined)return DramaticStructureMutationResultSchema.parse({kind:'idempotencyConflict'});
      const runValue=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
      if(runValue===undefined)return DramaticStructureMutationResultSchema.parse({kind:'missing'});
      const run=parseWorldRun(runValue);
      const record=(result:z.infer<typeof DramaticStructureMutationResultSchema>)=>persistDramaticStructureResult({runId:request.runId,
        principalId:request.principalId,idempotencyKey:request.idempotencyKey,operationId:request.operationId,kind:operationKind,requestHash,result});
      if(run.row.world_revision!==request.expectedWorldRevision||run.row.structure_revision!==request.expectedStructureRevision){
        return record(DramaticStructureMutationResultSchema.parse({kind:'conflict',worldRevision:run.row.world_revision,structureRevision:run.row.structure_revision}));
      }
      if(!['running','paused','stopped'].includes(run.row.lifecycle)&&!(run.row.lifecycle==='ready'&&readForkDramaticSeed(run)!==undefined))return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'runNotActive'}));
      if(database.prepare("SELECT 1 FROM actor_turn_jobs WHERE run_id=? AND state IN('queued','running','blocked') LIMIT 1").get(request.runId)!==undefined){
        return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'actorJobsActive'}));
      }
      const structure=readDramaticStructureForRun(run);
      const activeEpisode=structure.episodes.find((episode)=>episode.lifecycle==='open');
      const episodeRow=(episodeId:string)=>{
        const value=database.prepare('SELECT * FROM episodes WHERE run_id=? AND episode_id=?').get(request.runId,episodeId);
        return value===undefined?undefined:DramaticEpisodeDbRowSchema.parse(value);
      };
      const hasEventReferences=(eventIds:readonly string[])=>{
        if(eventIds.length===0)return true;
        const uniqueEventIds=[...new Set(eventIds)];
        const placeholders=uniqueEventIds.map(()=>'?').join(',');
        const found=z.strictObject({count:counter}).parse(database.prepare(`SELECT COUNT(*) AS count FROM world_events
          WHERE run_id=? AND world_seq<=? AND event_id IN(${placeholders})`).get(request.runId,run.row.last_seq,...uniqueEventIds)).count;
        return found===uniqueEventIds.length;
      };
      const receipt=(commit:ReturnType<typeof writeStructuralCommit>,episodeId: string|null)=>DramaticStructureMutationResultSchema.parse({
        kind:'stored',receipt:{operationId:request.operationId,worldRevision:commit.worldRevision,worldSeq:commit.worldSeq,
          structureRevision:commit.structureRevision,commitIndex:commit.commitIndex,activeEpisodeId:episodeId,activeSceneId:commit.activeSceneId},
      });
      const now=Date.now();

      if(command.kind==='openEpisode'){
        if(activeEpisode!==undefined)return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'episodeAlreadyOpen'}));
        const existingSceneId=run.snapshot.activeSceneId;
        if(existingSceneId!==null)return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'sceneAlreadyOpen'}));
        const ordinal=z.strictObject({ordinal:counter.nullable()}).parse(database.prepare('SELECT MAX(ordinal) AS ordinal FROM episodes WHERE run_id=?').get(request.runId)).ordinal??0;
        const cut=DramaticCutSchema.parse({worldRevision:run.row.world_revision+1,worldSeq:run.row.last_seq,
          structureRevision:run.row.structure_revision+1,commitIndex:run.row.commit_index+1});
        const commit=writeStructuralCommit({run,operationId:request.operationId,principalId:request.principalId,eventKind:'episodeOpened',recordedAt:now,
          payload:{episodeId:command.episodeId,ordinal:ordinal+1,title:command.title??null,origin:'operator'}});
        const cutPayload=hashJson(cut);const empty='[]';
        database.prepare(`INSERT INTO episodes(run_id,episode_id,ordinal,title,lifecycle,opening_cut_json,opening_cut_hash,closing_cut_json,closing_cut_hash,
          consequence_event_ids_json,open_lines_json) VALUES(?,?,?,?,'open',?,?,NULL,NULL,?,?)`)
          .run(request.runId,command.episodeId,ordinal+1,command.title??null,cutPayload.json,cutPayload.hash,empty,empty);
        return record(receipt(commit,command.episodeId));
      }

      if(command.kind==='openScene'){
        if(activeEpisode===undefined)return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'episodeNotOpen'}));
        if(run.snapshot.activeSceneId!==null)return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'sceneAlreadyOpen'}));
        if(run.snapshot.scenes.some((scene)=>scene.id===command.scene.id))return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'sceneAlreadyOpen'}));
        const knownPlaces=new Set(run.snapshot.places.map((place)=>place.id));
        if(command.scene.placeIds.some((placeId)=>!knownPlaces.has(placeId))){
          return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'invalidPlaceReference'}));
        }
        const participants=command.scene.participantIds.map((characterId)=>run.snapshot.entities.find((entity)=>entity.kind==='character'&&entity.characterId===characterId));
        if(participants.some((character)=>character===undefined||character.kind!=='character'||character.preparation.kind!=='prepared'||!command.scene.placeIds.includes(character.placeId))){
          return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'invalidParticipants'}));
        }
        const scene=WorldSceneSchema.parse({id:command.scene.id,label:command.scene.label,
          lifecycle:{kind:'open',startedAt:run.snapshot.clock.instant},participantIds:command.scene.participantIds,placeIds:command.scene.placeIds});
        const entities=run.snapshot.entities.map((entity)=>entity.kind==='character'&&command.scene.participantIds.includes(entity.characterId)
          ?{...entity,presence:{kind:'present' as const,sceneId:scene.id}}:entity);
        const commit=writeStructuralCommit({run,operationId:request.operationId,principalId:request.principalId,eventKind:'sceneOpened',recordedAt:now,
          payload:{episodeId:activeEpisode.episodeId,scene},snapshotChanges:{scenes:[...run.snapshot.scenes,scene],activeSceneId:scene.id,entities}});
        const ordinal=z.strictObject({ordinal:counter.nullable()}).parse(database.prepare('SELECT MAX(ordinal) AS ordinal FROM episode_scenes WHERE run_id=? AND episode_id=?')
          .get(request.runId,activeEpisode.episodeId)).ordinal??0;
        database.prepare('INSERT INTO episode_scenes(run_id,episode_id,scene_id,ordinal) VALUES(?,?,?,?)')
          .run(request.runId,activeEpisode.episodeId,scene.id,ordinal+1);
        return record(receipt(commit,activeEpisode.episodeId));
      }

      if(command.kind==='closeScene'){
        const activeSceneId=run.snapshot.activeSceneId;
        const scene=run.snapshot.scenes.find((candidate)=>candidate.id===command.sceneId);
        if(scene===undefined)return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'sceneMissing'}));
        if(activeSceneId===null)return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'noActiveScene'}));
        if(activeSceneId!==command.sceneId||scene.lifecycle.kind!=='open')return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'sceneNotOpen'}));
        const closed=WorldSceneSchema.parse({...scene,lifecycle:{kind:'closed',startedAt:scene.lifecycle.startedAt,closedAt:run.snapshot.clock.instant,reason:command.reason}});
        const nextActiveScene=run.snapshot.scenes.find((candidate)=>candidate.id!==command.sceneId&&candidate.lifecycle.kind==='open');
        const entities=run.snapshot.entities.map((entity)=>entity.kind==='character'&&entity.presence.kind==='present'&&entity.presence.sceneId===scene.id
          ?{...entity,presence:nextActiveScene?.participantIds.includes(entity.characterId)
            ?{kind:'present' as const,sceneId:nextActiveScene.id}:{kind:'absent' as const}}:entity);
        const commit=writeStructuralCommit({run,operationId:request.operationId,principalId:request.principalId,eventKind:'sceneClosed',recordedAt:now,
          payload:{episodeId:activeEpisode?.episodeId??null,sceneId:command.sceneId,reason:command.reason},
          snapshotChanges:{scenes:run.snapshot.scenes.map((candidate)=>candidate.id===command.sceneId?closed:candidate),activeSceneId:nextActiveScene?.id??null,entities}});
        return record(receipt(commit,activeEpisode?.episodeId??null));
      }

      if(command.kind==='closeEpisode'){
        const episode=episodeRow(command.episodeId);
        if(episode===undefined)return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'episodeMissing'}));
        if(episode.lifecycle!=='open')return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'episodeNotOpen'}));
        const sceneRows=database.prepare('SELECT scene_id FROM episode_scenes WHERE run_id=? AND episode_id=? ORDER BY ordinal')
          .all(request.runId,command.episodeId).map((value)=>z.strictObject({scene_id:z.string().uuid()}).parse(value));
        if(sceneRows.length===0)return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'episodeHasNoScenes'}));
        const openSceneIds=new Set<string>(run.snapshot.scenes.filter((scene)=>scene.lifecycle.kind==='open').map((scene)=>scene.id));
        if(sceneRows.some((scene)=>openSceneIds.has(scene.scene_id)))return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'episodeHasOpenScenes'}));
        const evidenceIds=[...command.consequenceEventIds,...command.openLines.flatMap((line)=>line.evidenceEventIds)];
        if(!hasEventReferences(evidenceIds))return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'invalidConsequenceReference'}));
        const cut=DramaticCutSchema.parse({worldRevision:run.row.world_revision+1,worldSeq:run.row.last_seq,
          structureRevision:run.row.structure_revision+1,commitIndex:run.row.commit_index+1});
        const commit=writeStructuralCommit({run,operationId:request.operationId,principalId:request.principalId,eventKind:'episodeClosed',recordedAt:now,
          payload:{episodeId:command.episodeId,consequenceEventIds:command.consequenceEventIds,openLines:command.openLines,cut}});
        const cutPayload=hashJson(cut);const consequences=hashJson(command.consequenceEventIds);const lines=hashJson(command.openLines);
        const changed=database.prepare(`UPDATE episodes SET lifecycle='closed',closing_cut_json=?,closing_cut_hash=?,consequence_event_ids_json=?,open_lines_json=?
          WHERE run_id=? AND episode_id=? AND lifecycle='open'`).run(cutPayload.json,cutPayload.hash,consequences.json,lines.json,request.runId,command.episodeId);
        if(changed.changes!==1)throw new Error('El episodio cambió dentro de la transacción');
        return record(receipt(commit,null));
      }

      if(command.kind==='setEpisodeActs'){
        const episode=episodeRow(command.episodeId);
        if(episode===undefined)return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'episodeMissing'}));
        const episodeSceneRows=database.prepare('SELECT scene_id FROM episode_scenes WHERE run_id=? AND episode_id=?').all(request.runId,command.episodeId);
        const episodeSceneIds=new Set(episodeSceneRows.map((value)=>z.strictObject({scene_id:z.string().uuid()}).parse(value).scene_id));
        if(command.acts.some((act)=>act.sceneIds.some((sceneId)=>!episodeSceneIds.has(sceneId)))
          ||command.acts.some((act)=>database.prepare('SELECT 1 FROM acts WHERE run_id=? AND act_id=? AND episode_id<>?').get(request.runId,act.actId,command.episodeId)!==undefined)){
          return record(DramaticStructureMutationResultSchema.parse({kind:'invalidState',code:'invalidActGrouping'}));
        }
        const commit=writeStructuralCommit({run,operationId:request.operationId,principalId:request.principalId,eventKind:'actsSet',recordedAt:now,
          payload:{episodeId:command.episodeId,acts:command.acts}});
        database.prepare('DELETE FROM act_scenes WHERE run_id=? AND episode_id=?').run(request.runId,command.episodeId);
        database.prepare('DELETE FROM acts WHERE run_id=? AND episode_id=?').run(request.runId,command.episodeId);
        command.acts.forEach((act,index)=>{
          database.prepare('INSERT INTO acts(run_id,episode_id,act_id,ordinal,title) VALUES(?,?,?,?,?)')
            .run(request.runId,command.episodeId,act.actId,index+1,act.title);
          act.sceneIds.forEach((sceneId,sceneIndex)=>database.prepare('INSERT INTO act_scenes(run_id,episode_id,act_id,scene_id,ordinal) VALUES(?,?,?,?,?)')
            .run(request.runId,command.episodeId,act.actId,sceneId,sceneIndex+1));
        });
        const resultingEpisode=activeEpisode?.episodeId??null;
        return record(receipt(commit,resultingEpisode));
      }

      const exhaustive:never=command;void exhaustive;
      throw new Error('Comando estructural desconocido');
    });
  }

  return {
    readDramaticStructure(input:unknown) {
      const request=z.strictObject({runId:RunIdSchema}).parse(input);
      const value=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
      return value===undefined?undefined:readDramaticStructureForRun(parseWorldRun(value));
    },
    readDramaticStructureAtCut(input:unknown) {
      const request=z.strictObject({runId:RunIdSchema,worldRevision:counter,worldSeq:WorldSeqSchema}).parse(input);
      const value=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
      return value===undefined?undefined:readDramaticStructureAtCut(parseWorldRun(value),request.worldRevision,request.worldSeq);
    },
    readDramaticStructureEvents(input:unknown) {
      const request=z.strictObject({runId:RunIdSchema,afterStructureRevision:counter.nullable().default(null),
        throughCommitIndex:counter.nullable().default(null),limit:counter.min(1).max(1_000).default(100)}).parse(input);
      const value=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
      if(value===undefined)return undefined;
      const run=parseWorldRun(value);
      if(request.throughCommitIndex!==null&&request.throughCommitIndex>run.row.commit_index)return undefined;
      const rows=database.prepare(`SELECT * FROM structure_events WHERE run_id=? AND (? IS NULL OR structure_revision>?)
        AND (? IS NULL OR commit_index<=?) ORDER BY structure_revision LIMIT ?`).all(request.runId,request.afterStructureRevision,
        request.afterStructureRevision,request.throughCommitIndex,request.throughCommitIndex,request.limit+1);
      const events=rows.slice(0,request.limit).map(structureEventRow);
      const revision=request.throughCommitIndex===null?run.row.structure_revision:z.strictObject({revision:counter.nullable()})
        .parse(database.prepare('SELECT MAX(structure_revision) AS revision FROM structure_events WHERE run_id=? AND commit_index<=?')
          .get(request.runId,request.throughCommitIndex)).revision??0;
      return {events,hasMore:rows.length>request.limit,structureRevision:revision};
    },
    readDramaticStructureOperation(input:unknown) { return readDramaticStructureOperation(input); },
    applyDramaticStructureCommand(input:unknown) { return applyDramaticStructureCommand(input); },
    readRunModelTimeBudget(input: unknown) { return readRunModelTimeBudget(RunModelTimeBudgetReadSchema.parse(input)); },
    recoverAbandonedModelTimeRequests(input: unknown) {
      const request = ModelTimeOwnerRecoverySchema.parse(input);
      return transact(() => {
        let released = 0;
        const abandonedReservations = database.prepare(`SELECT s.job_id,s.generation,s.request_seq,s.run_id,s.pulse_id
          FROM model_time_spans s JOIN request_reservations r USING(job_id,generation,request_seq)
          WHERE s.state='reserved' AND s.owner_token<>? AND r.state='reserved'`).all(request.ownerToken);
        for (const value of abandonedReservations) {
          const row = z.strictObject({ job_id: JobIdSchema, generation: counter, request_seq: counter, run_id: RunIdSchema, pulse_id: PulseIdSchema }).parse(value);
          const changed = database.prepare(`UPDATE request_reservations SET state='undispatched'
            WHERE job_id=? AND generation=? AND request_seq=? AND state='reserved'`).run(row.job_id,row.generation,row.request_seq);
          if (changed.changes !== 1) throw new Error('La reserva abandonada cambió durante recovery');
          database.prepare('UPDATE run_budgets SET consumed=consumed-1 WHERE run_id=? AND consumed>0').run(row.run_id);
          database.prepare('UPDATE pulses SET consumed=consumed-1 WHERE pulse_id=? AND consumed>0').run(row.pulse_id);
          database.prepare(`UPDATE model_time_spans SET state='undispatched' WHERE job_id=? AND generation=? AND request_seq=? AND state='reserved'`)
            .run(row.job_id,row.generation,row.request_seq);
          released += 1;
        }
        const abandonedTransports = database.prepare(`SELECT job_id,generation,request_seq FROM model_time_spans
          WHERE state IN('running','expired') AND owner_token<>?`).all(request.ownerToken);
        for (const value of abandonedTransports) {
          const row = z.strictObject({ job_id: JobIdSchema, generation: counter, request_seq: counter }).parse(value);
          database.prepare(`UPDATE model_time_spans SET state='uncertain',expiry_reason='host-interrupted'
            WHERE job_id=? AND generation=? AND request_seq=? AND state IN('running','expired')`)
            .run(row.job_id,row.generation,row.request_seq);
        }
        return { releasedReservations: released, uncertainTransports: abandonedTransports.length };
      });
    },

    readCircumstanceOptions(input:unknown){
      const request=CircumstanceOptionsRequestSchema.parse(input);
      const value=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
      if(value===undefined)return undefined;
      const run=parseWorldRun(value);
      const scope=request.scope;
      const scene=run.snapshot.scenes.find(item=>item.id===run.snapshot.activeSceneId&&item.lifecycle.kind==='open');
      if(scope.kind==='scene'&&(scene===undefined||scope.sceneId!==scene.id))return undefined;
      const permitted=(id:string)=>scope.kind==='run'||scene?.placeIds.some(place=>place===id)===true;
      const doors=run.snapshot.doors.filter(door=>{
        const affected=[...run.snapshot.connections.filter(item=>item.doorId===door.id).flatMap(item=>[item.from,item.to]),
          ...run.snapshot.perceptualPaths.filter(item=>item.throughDoorIds.includes(door.id)).flatMap(item=>[item.from,item.to])];
        return affected.length>0&&affected.every(permitted);
      });
      const catalog=run.snapshot.circumstanceCatalog;
      return CircumstanceOptionsSchema.parse({runId:request.runId,worldRevision:run.row.world_revision,
        directionRevision:run.row.direction_revision,lifecycle:run.row.lifecycle,activeSceneId:run.snapshot.activeSceneId,scope,
        places:run.snapshot.places.filter(item=>permitted(item.id)),doors,
        connections:run.snapshot.connections.filter(item=>permitted(item.from)&&permitted(item.to)),
        devices:run.snapshot.entities.flatMap(entity=>entity.kind==='device'&&permitted(entity.placeId)
          ?[{entityId:entity.entityId,label:entity.label,placeId:entity.placeId,availability:entity.availability}]:[]),
        ...(catalog===undefined?{}:{catalog:{...catalog,objectTemplates:catalog.objectTemplates
          .map(template=>({...template,allowedPlaceIds:template.allowedPlaceIds.filter(permitted)})).filter(template=>template.allowedPlaceIds.length>0)}}),
        ...(run.snapshot.environment===undefined?{}:{environment:run.snapshot.environment.filter(item=>permitted(item.placeId))}),
      });
    },
    applyCircumstanceCommand(input:unknown){
      const request=CircumstanceWriteSchema.parse(input);
      const requestHash=hashJson({runId:request.runId,operationId:request.operationId,
        expectedWorldRevision:request.expectedWorldRevision,expectedDirectionRevision:request.expectedDirectionRevision,payload:request.payload}).hash;
      return transact(()=>{
        const priorValue=database.prepare('SELECT * FROM circumstance_operations WHERE run_id=? AND principal_id=? AND idempotency_key=?')
          .get(request.runId,request.principalId,request.idempotencyKey);
        if(priorValue!==undefined){
          const prior=z.strictObject({run_id:RunIdSchema,principal_id:z.string(),idempotency_key:z.uuid(),operation_id:z.uuid(),
            request_hash:HashSchema,result_json:z.string(),result_hash:HashSchema,recorded_at:counter}).parse(priorValue);
          if(prior.operation_id!==request.operationId||prior.request_hash!==requestHash)
            return CircumstanceMutationResultSchema.parse({kind:'idempotencyConflict'});
          const result=CircumstanceMutationResultSchema.parse(parseStoredJson(prior.result_json));
          if(sha256(prior.result_json)!==prior.result_hash||canonicalJson(result)!==prior.result_json)
            throw new Error('Receipt de circunstancia alterado');
          return CircumstanceMutationResultSchema.parse(result.kind==='stored'?{...result,kind:'existing'}:result);
        }
        if(database.prepare('SELECT 1 FROM circumstance_operations WHERE operation_id=?').get(request.operationId)!==undefined
          ||database.prepare('SELECT 1 FROM direction_operations WHERE operation_id=?').get(request.operationId)!==undefined
          ||database.prepare('SELECT 1 FROM direction_events WHERE operation_id=?').get(request.operationId)!==undefined)
          return CircumstanceMutationResultSchema.parse({kind:'idempotencyConflict'});
        const value=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
        if(value===undefined)return CircumstanceMutationResultSchema.parse({kind:'missing'});
        const run=parseWorldRun(value);
        const save=(result:z.infer<typeof CircumstanceMutationResultSchema>)=>{
          const payload=hashJson(result);
          database.prepare(`INSERT INTO circumstance_operations(run_id,principal_id,idempotency_key,operation_id,request_hash,result_json,result_hash,recorded_at)
            VALUES(?,?,?,?,?,?,?,?)`).run(request.runId,request.principalId,request.idempotencyKey,request.operationId,requestHash,payload.json,payload.hash,Date.now());
          return result;
        };
        if(run.row.world_revision!==request.expectedWorldRevision||run.row.direction_revision!==request.expectedDirectionRevision)
          return save(CircumstanceMutationResultSchema.parse({kind:'conflict',worldRevision:run.row.world_revision,directionRevision:run.row.direction_revision}));
        if(run.row.lifecycle!=='running'&&run.row.lifecycle!=='paused')
          return save(CircumstanceMutationResultSchema.parse({kind:'invalidState',code:'runNotActive'}));
        const pending=database.prepare(`SELECT 1 FROM coordinator_pulses WHERE run_id=? AND state='running'
          UNION ALL SELECT 1 FROM run_step_jobs WHERE run_id=? AND state IN('queued','running')
          UNION ALL SELECT 1 FROM actor_turn_jobs WHERE run_id=? AND state IN('queued','running')
          UNION ALL SELECT 1 FROM continuista_jobs WHERE run_id=? AND state IN('queued','running')
          UNION ALL SELECT 1 FROM administrative_jobs WHERE run_id=? AND state='running'
          UNION ALL SELECT 1 FROM actor_turn_jobs a JOIN world_proposals p ON p.run_id=a.run_id AND p.job_id=a.job_id AND p.generation=a.generation
            WHERE a.run_id=? AND a.state='accepted' AND p.status='pending' AND p.base_revision=? AND a.lifecycle_revision=? LIMIT 1`)
          .get(request.runId,request.runId,request.runId,request.runId,request.runId,request.runId,run.row.world_revision,run.row.lifecycle_revision);
        if(pending!==undefined)return save(CircumstanceMutationResultSchema.parse({kind:'invalidState',code:'workPending'}));
        const ids={eventId:()=>randomUUID(),perceptionId:()=>randomUUID(),experienceId:()=>randomUUID(),offerId:()=>randomUUID(),
          entityHandle:()=>randomUUID(),placeHandle:()=>randomUUID(),channelHandle:()=>randomUUID(),offerHandle:()=>randomUUID()};
        const resolution=resolveWorldCircumstance({snapshot:run.snapshot,scope:request.payload.scope,operation:request.payload.operation,
          operationId:request.operationId,ids});
        if(resolution.kind==='rejected'&&resolution.reason!=='unchanged')
          return save(CircumstanceMutationResultSchema.parse({kind:'invalidState',code:resolution.reason}));
        const recordedAt=Date.now();
        const directionRevision=RevisionSchema.parse(run.row.direction_revision+1);
        const commitIndex=resolution.kind==='applied'?RevisionSchema.parse(run.row.commit_index+1):RevisionSchema.parse(run.row.commit_index);
        const snapshot=resolution.kind==='applied'?resolution.newSnapshot:run.snapshot;
        if(resolution.kind==='applied'){
          const payload=hashJson(snapshot);
          database.prepare(`INSERT INTO world_commits(run_id,origin_kind,origin_id,commit_index,world_revision,last_seq,snapshot_json,snapshot_hash,created_at)
            VALUES(?,'directionCircumstance',?,?,?,?,?,?,?)`).run(request.runId,request.operationId,commitIndex,snapshot.revision,snapshot.seq,payload.json,payload.hash,recordedAt);
          for(const event of resolution.events){
            const eventPayload=hashJson(event);
            database.prepare('INSERT INTO world_events(event_id,run_id,world_seq,origin_id,payload_json,payload_hash) VALUES(?,?,?,?,?,?)')
              .run(event.id,request.runId,event.seq,request.operationId,eventPayload.json,eventPayload.hash);
          }
          for(const perception of resolution.perceptions){
            if(perception.kind!=='circumstance')throw new Error('Tipo de percepción ajeno a circunstancia');
            const event=resolution.events.find(item=>item.id===perception.eventId);
            if(event===undefined)throw new Error('Percepción de circunstancia sin evento confirmado');
            const perceptionPayload=hashJson(perception);
            database.prepare(`INSERT INTO world_perceptions(perception_id,run_id,world_seq,attempt_id,event_id,recipient_actor_id,payload_json,payload_hash,origin_kind,origin_id)
              VALUES(?,?,?,NULL,?,?,?,?,?,?)`).run(perception.id,request.runId,event.seq,perception.eventId,perception.recipientCharacterId,
                perceptionPayload.json,perceptionPayload.hash,'directionCircumstance',request.operationId);
            database.prepare("INSERT INTO world_deliveries(perception_id,state) VALUES(?,'planned')").run(perception.id);
            database.prepare("INSERT INTO actor_turn_intents(run_id,actor_id,perception_id,world_seq,state,created_at) VALUES(?,?,?,?,'awaitingDelivery',?)")
              .run(request.runId,perception.recipientCharacterId,perception.id,event.seq,recordedAt);
          }
          const changed=database.prepare(`UPDATE world_runs SET world_revision=?,last_seq=?,commit_index=?,snapshot_json=?,snapshot_hash=?,
            direction_revision=?,updated_at=? WHERE run_id=? AND world_revision=? AND direction_revision=? AND lifecycle_revision=?`)
            .run(snapshot.revision,snapshot.seq,commitIndex,payload.json,payload.hash,directionRevision,recordedAt,request.runId,
              run.row.world_revision,run.row.direction_revision,run.row.lifecycle_revision);
          if(changed.changes!==1)throw new Error('CAS de circunstancia cambió dentro de la transacción');
        }else{
          const changed=database.prepare('UPDATE world_runs SET direction_revision=?,updated_at=? WHERE run_id=? AND direction_revision=?')
            .run(directionRevision,recordedAt,request.runId,run.row.direction_revision);
          if(changed.changes!==1)throw new Error('CAS de Dirección cambió dentro de la transacción');
        }
        const payload=hashJson(request.payload);
        database.prepare(`INSERT INTO direction_events(run_id,direction_revision,operation_id,principal_id,payload_json,payload_hash,world_revision,world_seq,commit_index,recorded_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(request.runId,directionRevision,request.operationId,request.principalId,payload.json,payload.hash,
            snapshot.revision,snapshot.seq,commitIndex,recordedAt);
        return save(CircumstanceMutationResultSchema.parse({kind:'stored',receipt:{operationId:request.operationId,directionRevision,recordedAt,
          worldRevision:snapshot.revision,worldSeq:snapshot.seq,commitIndex,effect:resolution.kind==='applied'
            ?{kind:'applied',eventIds:resolution.events.map(event=>event.id),recipientActorIds:[...new Set(resolution.perceptions.map(perception=>perception.recipientCharacterId))]}
            :{kind:'unchanged'}}}));
      });
    },

    applyDirectionCommand(input: unknown) {
      const request=DirectionCommandWriteSchema.parse(input);
      const requestHash=hashJson({runId:request.runId,operationId:request.operationId,
        expectedDirectionRevision:request.expectedDirectionRevision,payload:request.payload}).hash;
      return transact(()=>{
        const previousValue=database.prepare('SELECT * FROM direction_operations WHERE run_id=? AND principal_id=? AND idempotency_key=?')
          .get(request.runId,request.principalId,request.idempotencyKey);
        if(previousValue!==undefined){
          const previous=DirectionOperationDbRowSchema.parse(previousValue);
          if(previous.operation_id!==request.operationId||previous.request_hash!==requestHash)
            return DirectionMutationResultSchema.parse({kind:'idempotencyConflict'});
          const result=DirectionMutationResultSchema.parse(parseStoredJson(previous.result_json));
          if(sha256(previous.result_json)!==previous.result_hash||canonicalJson(result)!==previous.result_json)
            throw new Error('Receipt de Dirección alterado');
          return DirectionMutationResultSchema.parse(result.kind==='stored'?{...result,kind:'existing'}:result);
        }
        if(database.prepare('SELECT 1 FROM direction_operations WHERE operation_id=?').get(request.operationId)!==undefined
          ||database.prepare('SELECT 1 FROM circumstance_operations WHERE operation_id=?').get(request.operationId)!==undefined
          ||database.prepare('SELECT 1 FROM direction_events WHERE operation_id=?').get(request.operationId)!==undefined)
          return DirectionMutationResultSchema.parse({kind:'idempotencyConflict'});
        const runValue=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
        if(runValue===undefined)return DirectionMutationResultSchema.parse({kind:'missing'});
        const run=parseWorldRun(runValue);
        const save=(result:z.infer<typeof DirectionMutationResultSchema>)=>{
          const payload=hashJson(result);
          database.prepare(`INSERT INTO direction_operations(run_id,principal_id,idempotency_key,operation_id,request_hash,result_json,result_hash,recorded_at)
            VALUES(?,?,?,?,?,?,?,?)`).run(request.runId,request.principalId,request.idempotencyKey,request.operationId,requestHash,payload.json,payload.hash,Date.now());
          return result;
        };
        if(run.row.direction_revision!==request.expectedDirectionRevision)
          return save(DirectionMutationResultSchema.parse({kind:'conflict',directionRevision:run.row.direction_revision}));
        if(!['ready','running','paused','stopped'].includes(run.row.lifecycle))
          return save(DirectionMutationResultSchema.parse({kind:'invalidState',code:'runNotActive'}));
        if(request.payload.kind==='metaIndication'){
          const recipients=request.payload.recipients.map((id)=>run.snapshot.entities.find((entity)=>
            entity.kind==='character'&&entity.characterId===id&&entity.preparation.kind==='prepared'));
          if(recipients.some((entity)=>entity===undefined))
            return save(DirectionMutationResultSchema.parse({kind:'invalidState',code:'invalidRecipient'}));
          const scopeSceneId=request.payload.scope.kind==='scene'?request.payload.scope.sceneId:null;
          if(scopeSceneId!==null){
            const scene=run.snapshot.scenes.find((item)=>item.id===scopeSceneId&&item.lifecycle.kind==='open');
            if(scene===undefined||run.snapshot.activeSceneId!==scopeSceneId)
              return save(DirectionMutationResultSchema.parse({kind:'invalidState',code:'sceneNotActive'}));
            if(request.payload.recipients.some((id)=>!scene.participantIds.includes(id)))
              return save(DirectionMutationResultSchema.parse({kind:'invalidState',code:'sceneRecipientMismatch'}));
          }
        }else{
          const targetValue=database.prepare('SELECT * FROM direction_events WHERE run_id=? AND operation_id=?')
            .get(request.runId,request.payload.targetOperationId);
          if(targetValue===undefined)
            return save(DirectionMutationResultSchema.parse({kind:'invalidState',code:'directionNotFound'}));
          const targetRow=DirectionEventDbRowSchema.parse(targetValue);
          const target=DirectionPayloadSchema.parse(parseStoredJson(targetRow.payload_json));
          if(sha256(targetRow.payload_json)!==targetRow.payload_hash||canonicalJson(target)!==targetRow.payload_json)
            throw new Error('Evento de Dirección alterado');
          if(target.kind!=='metaIndication')
            return save(DirectionMutationResultSchema.parse({kind:'invalidState',code:'directionNotFound'}));
          if(canonicalJson(target.scope)!==canonicalJson(request.payload.scope))
            return save(DirectionMutationResultSchema.parse({kind:'invalidState',code:'directionScopeMismatch'}));
          const laterRows=database.prepare('SELECT * FROM direction_events WHERE run_id=? AND direction_revision>? ORDER BY direction_revision')
            .all(request.runId,targetRow.direction_revision);
          const revoked=laterRows.some((value)=>{
            const row=DirectionEventDbRowSchema.parse(value);
            const payload=DirectionPayloadSchema.parse(parseStoredJson(row.payload_json));
            if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(payload)!==row.payload_json)
              throw new Error('Evento de Dirección alterado');
            return payload.kind==='revokeMetaIndication'&&payload.targetOperationId===targetRow.operation_id;
          });
          if(revoked)return save(DirectionMutationResultSchema.parse({kind:'invalidState',code:'directionAlreadyRevoked'}));
        }
        const directionRevision=RevisionSchema.parse(run.row.direction_revision+1);
        const payload=hashJson(request.payload);
        const recordedAt=Date.now();
        database.prepare(`INSERT INTO direction_events(run_id,direction_revision,operation_id,principal_id,payload_json,payload_hash,
          world_revision,world_seq,commit_index,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(request.runId,directionRevision,request.operationId,
          request.principalId,payload.json,payload.hash,run.row.world_revision,run.row.last_seq,run.row.commit_index,recordedAt);
        const changed=database.prepare('UPDATE world_runs SET direction_revision=?,updated_at=? WHERE run_id=? AND direction_revision=?')
          .run(directionRevision,recordedAt,request.runId,run.row.direction_revision);
        if(changed.changes!==1)throw new Error('CAS de Dirección cambió dentro de la transacción');
        return save(DirectionMutationResultSchema.parse({kind:'stored',receipt:{operationId:request.operationId,directionRevision,recordedAt}}));
      });
    },
    readDirectionOperation(input: unknown) {
      const request=DirectionLookupSchema.parse(input);
      const value=database.prepare('SELECT * FROM direction_operations WHERE run_id=? AND principal_id=? AND idempotency_key=?')
        .get(request.runId,request.principalId,request.idempotencyKey);
      if(value===undefined)return DirectionLookupResultSchema.parse({kind:'missing'});
      const row=DirectionOperationDbRowSchema.parse(value);
      const result=DirectionMutationResultSchema.parse(parseStoredJson(row.result_json));
      if(sha256(row.result_json)!==row.result_hash||canonicalJson(result)!==row.result_json)throw new Error('Receipt de Dirección alterado');
      return DirectionLookupResultSchema.parse({kind:'found',result});
    },
    readDirectionEvents(input: unknown) {
      const request=DirectionEventsQuerySchema.parse(input);
      const value=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
      if(value===undefined)return undefined;
      const run=parseWorldRun(value);
      const rows=database.prepare('SELECT * FROM direction_events WHERE run_id=? AND direction_revision>? ORDER BY direction_revision LIMIT ?')
        .all(request.runId,request.afterDirectionRevision,request.limit+1);
      const events=rows.slice(0,request.limit).map((rowValue)=>{
        const row=DirectionEventDbRowSchema.parse(rowValue);
        const payload=DirectionPayloadSchema.parse(parseStoredJson(row.payload_json));
        if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(payload)!==row.payload_json)throw new Error('Metaindicación alterada');
        return DirectionEventSchema.parse({runId:row.run_id,directionRevision:row.direction_revision,operationId:row.operation_id,
          principalId:row.principal_id,payload,payloadHash:row.payload_hash,worldRevision:row.world_revision,worldSeq:row.world_seq,
          commitIndex:row.commit_index,recordedAt:row.recorded_at});
      });
      return DirectionEventsPageSchema.parse({events,directionRevision:run.row.direction_revision,hasMore:rows.length>request.limit});
    },
    readActorMetaIndications(input: unknown) {
      const request=z.strictObject({runId:RunIdSchema,actorId:CharacterIdSchema,directionRevision:RevisionSchema,
        activeSceneId:SceneIdSchema.nullable()}).parse(input);
      const rows=database.prepare('SELECT * FROM direction_events WHERE run_id=? AND direction_revision<=? ORDER BY direction_revision')
        .all(request.runId,request.directionRevision);
      const events=rows.map((rowValue)=>{
        const row=DirectionEventDbRowSchema.parse(rowValue);
        const payload=DirectionPayloadSchema.parse(parseStoredJson(row.payload_json));
        if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(payload)!==row.payload_json)throw new Error('Evento de Dirección alterado');
        return {operationId:row.operation_id,payload};
      });
      const revoked=new Set(events.flatMap(({payload})=>payload.kind==='revokeMetaIndication'?[payload.targetOperationId]:[]));
      const indications=events.flatMap(({operationId,payload})=>{
        if(payload.kind!=='metaIndication'||revoked.has(operationId))return [];
        const inScope=payload.scope.kind==='run'||payload.scope.sceneId===request.activeSceneId;
        return inScope&&payload.recipients.includes(request.actorId)?[payload]:[];
      });
      return ActorDirectionContextSchema.parse({directionRevision:request.directionRevision,indications});
    },

    readActorStateCut,
    readRunConfigurationAtCommit,
    configureIdentityPromotionPorts(ports:IdentityPromotionPorts){if(identityPromotionPorts!==undefined)throw new Error('IDENTITY_PROMOTION_PORTS_ALREADY_CONFIGURED');if(typeof ports.requireAcceptedConfiguratorProposal!=='function'||typeof ports.assertIdentityPromotionRuntimeIdle!=='function')throw new Error('IDENTITY_PROMOTION_PORTS_INVALID');identityPromotionPorts=Object.freeze({...ports});},
    applyIdentityPromotion,
    readIdentityPromotionHistory(input:unknown){const request=z.strictObject({runId:RunIdSchema,actorId:CharacterIdSchema.optional()}).parse(input);return database.prepare('SELECT * FROM identity_promotion_receipts WHERE run_id=? ORDER BY rowid').all(request.runId).map(identityPromotionRecord).filter(record=>request.actorId===undefined||record.receipt.actorId===request.actorId).map(record=>record.receipt);},
    readActorIdentityEpochs(input:unknown){const request=z.strictObject({runId:RunIdSchema,actorId:CharacterIdSchema}).parse(input);const row=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);if(row===undefined)return [];return identityEpochs(parseWorldRun(row),request.actorId);},
    loadActorPiSessionAtEpoch(input:unknown){const request=z.strictObject({runId:RunIdSchema,actorId:CharacterIdSchema,epochIndex:RevisionSchema}).parse(input);const row=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);if(row===undefined)return undefined;const run=parseWorldRun(row);const epochs=identityEpochs(run,request.actorId);const epoch=epochs.find(epoch=>epoch.epochIndex===request.epochIndex);if(epoch===undefined)throw new Error('IDENTITY_EPOCH_MISSING');return epoch.epochIndex===epochs.at(-1)?.epochIndex?currentActorSession(run,request.actorId):archivedIdentitySession(epoch)?.base;},
    readForkSource,
    beginForkJob,beginForkJobFromBackup,readForkJob,findForkJob,readForkPackage,listStagingForkJobs,
    recordForkProjection,readForkProjectionReceipt,readForkProjectionReceipts,failForkJob,retryForkJob,publishForkJob,
    registerWorldRun(input:unknown):'stored'|'existing'{return transact(()=>registerWorldRunWithinTransaction(input));},

    setWorldLifecycle(input: unknown): 'updated' | 'stale' {
      const request = WorldLifecycleWriteSchema.parse(input);
      return transact(() => {
        const run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId));
        if (run.row.world_revision !== request.expectedWorldRevision
          || run.row.config_revision !== request.expectedConfigRevision) return 'stale';
        const allowed = (run.row.lifecycle === 'draft' && request.target === 'ready')
          || (run.row.lifecycle === 'ready' && request.target === 'running')
          || (run.row.lifecycle === 'running' && (request.target === 'paused' || request.target === 'stopped'))
          || (run.row.lifecycle === 'running' && request.target === 'closed')
          || (run.row.lifecycle === 'paused' && (request.target === 'running' || request.target === 'stopped' || request.target === 'closed'))
          || (run.row.lifecycle === 'stopped' && (request.target === 'running' || request.target === 'closed'));
        if (!allowed) throw new Error('Transición de lifecycle de mundo inválida');
        const now = Date.now();
        database.prepare(`UPDATE world_runs SET lifecycle=?,lifecycle_revision=lifecycle_revision+1,closed_at=?,updated_at=?
          WHERE run_id=? AND world_revision=? AND config_revision=?`)
          .run(request.target, request.target === 'closed' ? now : null, now, request.runId, request.expectedWorldRevision, request.expectedConfigRevision);
        const updatedRun = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId));
        reconcileRunLifecycleEpoch(request.runId, request.target, updatedRun.row.lifecycle_revision, now);
        return 'updated';
      });
    },

    readWorldLifecycle(input: unknown) {
      const request = z.strictObject({ runId: RunIdSchema }).parse(input);
      const value = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
      return value === undefined ? undefined : runLifecycleState(parseWorldRun(value));
    },

    /** Allows the host to replay an existing control before rechecking expiring preflight evidence. */
    readRunLifecycleCommand(input: unknown) {
      const request = RunLifecycleCommandLookupSchema.parse(input);
      const requestHash = hashJson({ runId: request.runId, command: request.command, preflightJobId: request.preflightJobId ?? null }).hash;
      const crossOperationExists = [
        'SELECT 1 FROM fork_job_retries WHERE principal_id=? AND idempotency_key=?',
      'SELECT 1 FROM fork_jobs WHERE principal_id=? AND idempotency_key=?',
      'SELECT 1 FROM run_draft_operations WHERE principal_id=? AND idempotency_key=?',
        'SELECT 1 FROM pi_oauth_job_operations WHERE principal_id=? AND idempotency_key=?',
        'SELECT 1 FROM pi_access_job_operations WHERE principal_id=? AND idempotency_key=?',
        'SELECT 1 FROM run_preflight_job_operations WHERE principal_id=? AND idempotency_key=?',
      ].some((sql) => database.prepare(sql).get(request.principalId, request.idempotencyKey) !== undefined);
      if (crossOperationExists) return RunLifecycleCommandLookupResultSchema.parse({ kind: 'idempotencyConflict' });
      const previousValue = database.prepare('SELECT * FROM run_control_operations WHERE principal_id=? AND idempotency_key=?')
        .get(request.principalId, request.idempotencyKey);
      if (previousValue === undefined) return RunLifecycleCommandLookupResultSchema.parse({ kind: 'missing' });
      const previous = z.strictObject({ principal_id: z.string(), idempotency_key: z.string().uuid(), run_id: RunIdSchema,
        command_kind: z.enum(['start', 'pause', 'resume', 'step', 'stop', 'close']), request_hash: HashSchema,
        result_json: z.string(), result_hash: HashSchema, recorded_at: counter }).parse(previousValue);
      if (previous.run_id !== request.runId || previous.command_kind !== request.command.kind || previous.request_hash !== requestHash) {
        return RunLifecycleCommandLookupResultSchema.parse({ kind: 'idempotencyConflict' });
      }
      const result = RunLifecycleCommandResultSchema.parse(parseStoredJson(previous.result_json));
      if (sha256(previous.result_json) !== previous.result_hash || canonicalJson(result) !== previous.result_json) {
        throw new Error('Receipt idempotente de control de corrida alterado');
      }
      return RunLifecycleCommandLookupResultSchema.parse({ kind: 'found', result });
    },

    applyRunLifecycleCommand(input: unknown) {
      const request = RunLifecycleCommandWriteSchema.parse(input);
      const requestHash = hashJson({ runId: request.runId, command: request.command, preflightJobId: request.preflightJobId ?? null }).hash;
      return transact(() => {
        const crossOperationExists = [
          'SELECT 1 FROM fork_job_retries WHERE principal_id=? AND idempotency_key=?',
      'SELECT 1 FROM fork_jobs WHERE principal_id=? AND idempotency_key=?',
      'SELECT 1 FROM run_draft_operations WHERE principal_id=? AND idempotency_key=?',
          'SELECT 1 FROM pi_oauth_job_operations WHERE principal_id=? AND idempotency_key=?',
          'SELECT 1 FROM pi_access_job_operations WHERE principal_id=? AND idempotency_key=?',
          'SELECT 1 FROM run_preflight_job_operations WHERE principal_id=? AND idempotency_key=?',
        ].some((sql) => database.prepare(sql).get(request.principalId, request.idempotencyKey) !== undefined);
        if (crossOperationExists) return RunLifecycleCommandResultSchema.parse({ kind: 'idempotencyConflict' });

        const previousValue = database.prepare('SELECT * FROM run_control_operations WHERE principal_id=? AND idempotency_key=?')
          .get(request.principalId, request.idempotencyKey);
        if (previousValue !== undefined) {
          const previous = z.strictObject({ principal_id: z.string(), idempotency_key: z.string().uuid(), run_id: RunIdSchema,
            command_kind: z.enum(['start', 'pause', 'resume', 'step', 'stop', 'close']), request_hash: HashSchema,
            result_json: z.string(), result_hash: HashSchema, recorded_at: counter }).parse(previousValue);
          if (previous.run_id !== request.runId || previous.command_kind !== request.command.kind || previous.request_hash !== requestHash) {
            return RunLifecycleCommandResultSchema.parse({ kind: 'idempotencyConflict' });
          }
          const replay = RunLifecycleCommandResultSchema.parse(parseStoredJson(previous.result_json));
          if (sha256(previous.result_json) !== previous.result_hash || canonicalJson(replay) !== previous.result_json) {
            throw new Error('Receipt idempotente de control de corrida alterado');
          }
          return replay;
        }

        const worldValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
        if (worldValue === undefined) return RunLifecycleCommandResultSchema.parse({ kind: 'missing' });
        let run = parseWorldRun(worldValue);
        const record = (result: z.infer<typeof RunLifecycleCommandResultSchema>) => {
          const payload = hashJson(result);
          database.prepare('INSERT INTO run_control_operations VALUES(?,?,?,?,?,?,?,?)')
            .run(request.principalId, request.idempotencyKey, request.runId, request.command.kind, requestHash, payload.json, payload.hash, Date.now());
          return result;
        };
        const state = () => runLifecycleState(run);

        if (run.row.lifecycle_revision !== request.expectedLifecycleRevision
          || run.row.config_revision !== request.expectedConfigRevision
          || run.row.world_revision !== request.expectedWorldRevision
          || (request.expectedStructureRevision !== undefined && run.row.structure_revision !== request.expectedStructureRevision)) {
          return record(RunLifecycleCommandResultSchema.parse({ kind: 'stale', state: state() }));
        }

        const transition = resolveRunControlTransition(run.row.lifecycle, request.command);
        if (transition.kind === 'invalid') {
          return record(RunLifecycleCommandResultSchema.parse({ kind: 'invalidLifecycle', lifecycle: run.row.lifecycle }));
        }

        if (request.command.kind === 'start' || request.command.kind === 'resume' || request.command.kind === 'step') {
          const preflightJobId = request.preflightJobId;
          if (preflightJobId === undefined) return record(RunLifecycleCommandResultSchema.parse({ kind: 'preflightRequired' }));
          const preflight = runPreflightJobRow({ runId: request.runId, jobId: preflightJobId });
          if (preflight === undefined || preflight.job.state !== 'completed' || preflight.job.resultKind !== 'passed') {
            return record(RunLifecycleCommandResultSchema.parse({ kind: 'preflightBlocked' }));
          }
          const document = runPreflightJobDocument({ runId: request.runId, jobId: preflightJobId });
          const stored = readRunPreflightJobResult({ runId: request.runId, jobId: preflightJobId });
          const profileFingerprint = fingerprintInferenceProfile(runInferenceProfile(run));
          const receipt = stored?.evidence.accessReceipt;
          if (document === undefined || document.report.kind !== 'current' || document.report.result?.kind !== 'passed'
            || stored?.result.kind !== 'passed' || receipt?.resultKind !== 'passed'
            || Date.parse(receipt.expiresAt) <= Date.now()
            || preflight.row.configuration_revision !== run.row.config_revision
            || preflight.row.configuration_hash !== run.row.configuration_hash
            || preflight.row.world_revision !== run.row.world_revision || preflight.row.world_seq !== run.row.last_seq
            || preflight.row.fictitious_at !== run.snapshot.clock.instant
            || preflight.row.profile_fingerprint !== profileFingerprint
            || canonicalJson(preflight.configuration.worldSnapshot) !== canonicalJson(run.snapshot)) {
            return record(RunLifecycleCommandResultSchema.parse({ kind: 'preflightStale' }));
          }
        }

        if (request.command.kind === 'start' || request.command.kind === 'resume' || request.command.kind === 'step') {
          const budget = readRunModelTimeBudget({runId:request.runId});
          if (budget === undefined || budget.status !== 'known' || budget.runCallsUsed >= budget.maxPiCallsPerRun || budget.wallTimeRemainingMs === 0) {
            return record(RunLifecycleCommandResultSchema.parse({kind:'budgetExhausted'}));
          }
        }
        const now = Date.now();
        if(request.command.kind==='start'&&readForkDramaticSeed(run)===undefined){
          openInitialEpisodeAtStart(run,request.principalId,randomUUID(),now);
          const refreshed=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
          if(refreshed===undefined)throw new Error('Run desapareció al abrir el episodio inicial');
          run=parseWorldRun(refreshed);
        }
        if (request.command.kind !== 'step') database.prepare("UPDATE run_step_jobs SET state='canceled',revision=revision+1,updated_at=? WHERE run_id=? AND state='interrupted'").run(now,request.runId);
        const changed = database.prepare(`UPDATE world_runs SET lifecycle=?,lifecycle_revision=lifecycle_revision+1,closed_at=?,updated_at=?
          WHERE run_id=? AND lifecycle_revision=? AND config_revision=? AND world_revision=? AND structure_revision=?`)
          .run(transition.kind === 'singlePulse' ? 'running' : transition.to, transition.kind === 'transition' && transition.to === 'closed' ? now : null, now, request.runId,
            request.expectedLifecycleRevision, request.expectedConfigRevision, run.row.world_revision, run.row.structure_revision);
        if (changed.changes !== 1) throw new Error('CAS de lifecycle cambió dentro de la transacción');
        run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId));
        reconcileRunLifecycleEpoch(request.runId, run.row.lifecycle, run.row.lifecycle_revision, now);
        if(request.command.kind==='start'||request.command.kind==='resume'||request.command.kind==='step'){
          admitInitialGoalActivation(run,ReadyRunConfigurationSchema.parse(run.configuration),now);
        }
        if (request.command.kind === 'step') {
          const interrupted = database.prepare("SELECT job_id FROM run_step_jobs WHERE run_id=? AND state='interrupted' ORDER BY updated_at DESC LIMIT 1").get(request.runId);
          const jobId = interrupted === undefined ? JobIdSchema.parse(randomUUID()) : z.strictObject({job_id:JobIdSchema}).parse(interrupted).job_id;
          if (interrupted === undefined) database.prepare(`INSERT INTO run_step_jobs VALUES(?,?,NULL,'queued',0,?,?,?)`)
            .run(jobId,request.runId,run.row.lifecycle_revision,now,now);
          else database.prepare("UPDATE run_step_jobs SET state=CASE WHEN pulse_id IS NULL THEN 'queued' ELSE 'running' END,revision=revision+1,lifecycle_revision=?,updated_at=? WHERE job_id=? AND state='interrupted'")
            .run(run.row.lifecycle_revision,now,jobId);
          return record(RunLifecycleCommandResultSchema.parse({kind:'accepted',state:state(),job:stepJobView({runId:request.runId,jobId})}));
        }
        return record(RunLifecycleCommandResultSchema.parse({ kind: 'updated', state: state() }));
      });
    },

    readWorldConfigurationMetadata(input: unknown) {
      const {runId}=z.strictObject({runId:RunIdSchema}).parse(input);
      const value=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(runId);
      if(value===undefined)return undefined;
      const run=parseWorldRun(value);
      return {configurationRevision:run.row.config_revision,configurationHash:run.row.configuration_hash,createdAt:run.row.created_at};
    },

    /** Host-only inspector cut. A sequence alone may identify multiple zero-event
     * subjective revisions; return that ambiguity instead of inventing a past mind. */
    readInspectorWorldCut(input: unknown) {
      const request=z.strictObject({runId:RunIdSchema,atWorldSeq:WorldSeqSchema.optional(),worldRevision:RevisionSchema.optional(),
        atCommitIndex:RevisionSchema.optional()}).superRefine((value,context)=>{
          if(value.atCommitIndex!==undefined&&(value.atWorldSeq!==undefined||value.worldRevision!==undefined))context.addIssue({code:'custom',message:'Elegí commitIndex o el par worldRevision/worldSeq.'});
          if(value.worldRevision!==undefined&&value.atWorldSeq===undefined)context.addIssue({code:'custom',message:'worldRevision requiere atWorldSeq.'});
        }).parse(input);
      const value=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);if(value===undefined)return undefined;
      const run=parseWorldRun(value);
      if(request.atCommitIndex!==undefined){
        if(request.atCommitIndex>run.row.commit_index)return undefined;
        if(request.atCommitIndex===0){
          const matches=z.strictObject({count:counter}).parse(database.prepare('SELECT COUNT(*) AS count FROM world_commits WHERE run_id=? AND last_seq=?')
            .get(request.runId,run.initialSnapshot.seq)).count+1;
          return {snapshot:run.initialSnapshot,commitIndex:0,ambiguousSeq:matches>1};
        }
        const rowValue=database.prepare('SELECT snapshot_json,snapshot_hash,world_revision,last_seq,commit_index FROM world_commits WHERE run_id=? AND commit_index=?')
          .get(request.runId,request.atCommitIndex);
        if(rowValue===undefined)return undefined;
        const row=z.strictObject({snapshot_json:z.string(),snapshot_hash:HashSchema,world_revision:counter,last_seq:counter,commit_index:counter}).parse(rowValue);
        if(sha256(row.snapshot_json)!==row.snapshot_hash)throw new Error('Hash de snapshot por commit no coincide');
        const snapshot=WorldSnapshotSchema.parse(parseStoredJson(row.snapshot_json));
        if(canonicalJson(snapshot)!==row.snapshot_json||snapshot.runId!==request.runId||snapshot.revision!==row.world_revision
          ||snapshot.seq!==row.last_seq||row.commit_index!==request.atCommitIndex)throw new Error('El commit solicitado no coincide con el snapshot persistido');
        const matches=z.strictObject({count:counter}).parse(database.prepare('SELECT COUNT(*) AS count FROM world_commits WHERE run_id=? AND last_seq=?')
          .get(request.runId,row.last_seq)).count+(row.last_seq===run.initialSnapshot.seq?1:0);
        return {snapshot,commitIndex:row.commit_index,ambiguousSeq:matches>1};
      }
      const seq=request.atWorldSeq??run.row.last_seq;
      if(seq>run.row.last_seq)return undefined;
      const matches=z.strictObject({count:counter}).parse(database.prepare('SELECT COUNT(*) count FROM world_commits WHERE run_id=? AND last_seq=?').get(request.runId,seq)).count+(seq===run.initialSnapshot.seq?1:0);
      if(request.atWorldSeq===undefined&&request.worldRevision===undefined)return {snapshot:run.snapshot,commitIndex:run.row.commit_index,ambiguousSeq:matches>1};
      if(request.worldRevision!==undefined){const cut=snapshotAndCommitAtCut(run,request.worldRevision,seq);return cut===undefined?undefined:{...cut,ambiguousSeq:matches>1};}
      const snapshot=snapshotAtCut(run,seq);if(snapshot===undefined)return undefined;
      const first=database.prepare('SELECT commit_index FROM world_commits WHERE run_id=? AND last_seq=? ORDER BY commit_index ASC LIMIT 1').get(request.runId,seq);
      return {snapshot,commitIndex:seq===run.initialSnapshot.seq?0:z.strictObject({commit_index:counter}).parse(first).commit_index,ambiguousSeq:matches>1};
    },

    loadWorld(input: unknown) {
      const request = WorldRunLoadSchema.parse(input);
      const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
      if (runValue === undefined) return undefined;
      const run = parseWorldRun(runValue);
      if (request.throughWorldSeq === undefined) return run.snapshot;
      return snapshotAtCut(run, request.throughWorldSeq);
    },

    /** Returns the hash-verified configuration registered with this durable run. */
    readWorldConfiguration(input: unknown) {
      const request = z.strictObject({ runId: RunIdSchema }).parse(input);
      const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
      if (runValue === undefined) return undefined;
      return parseWorldRun(runValue).configuration;
    },

    loadActorWorldCut(input: unknown) {
      const request = ActorWorldProjectionRequestSchema.parse(input);
      const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
      if (runValue === undefined) return undefined;
      const run = parseWorldRun(runValue);
      let requestedCut: ReturnType<typeof snapshotAndCommitAtCut>;
      let frozenPerceptionIds: string[] | null = null;
      if (request.actorJob !== undefined) {
        const jobValue = database.prepare(`
          SELECT * FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?
        `).get(request.runId, request.actorId, request.actorJob.jobId, request.actorJob.generation);
        if (jobValue === undefined) return undefined;
        const job = ActorTurnJobDbRowSchema.parse(jobValue);
        if (job.state !== 'running' || job.owner_token !== request.actorJob.ownerToken
          || job.claim_token !== request.actorJob.claimToken) return undefined;
        const frozenWorldCut = frozenActorTurnWorldCut(job);
        if (frozenWorldCut === null || frozenWorldCut.worldRevision !== request.expectedWorldRevision
          || frozenWorldCut.worldSeq !== request.atWorldSeq || frozenWorldCut.fictionalAt !== request.fictionalAt) return undefined;
        frozenPerceptionIds = frozenWorldCut.perceptionIds;
        requestedCut = snapshotAndCommitAtCut(run, frozenWorldCut.worldRevision, frozenWorldCut.worldSeq);
        if (requestedCut === undefined || requestedCut.snapshot.clock.instant !== frozenWorldCut.fictionalAt) return undefined;
      } else {
        requestedCut = snapshotAndCommitAtCut(run, request.expectedWorldRevision, request.atWorldSeq);
        if (requestedCut === undefined || request.fictionalAt !== requestedCut.snapshot.clock.instant) return undefined;
        if (request.expectedWorldRevision !== run.row.world_revision || request.expectedWorldRevision !== run.snapshot.revision
        || request.atWorldSeq !== run.row.last_seq || request.atWorldSeq !== run.snapshot.seq
        || request.fictionalAt !== run.snapshot.clock.instant) return undefined;
      }
      const snapshot = requestedCut.snapshot;
      const context = run.fence.contexts.find((item) => item.actorId === request.actorId);
      if (context === undefined || context.continuityId !== request.continuity.continuityId
        || context.continuityRevision !== request.continuity.revision
        || context.continuityContentHash !== request.continuity.contentHash) return undefined;
      const actor = snapshot.entities.find((entity) => entity.kind === 'character' && entity.characterId === request.actorId);
      if (actor?.kind !== 'character' || actor.preparation.kind !== 'prepared'
        || actor.preparation.continuityId !== request.continuity.continuityId
        || actor.preparation.identityVersion !== request.identityVersion) return undefined;
      const knowledgeValue = database.prepare(`
        SELECT knowledge_revision,at_world_seq,payload_json,payload_hash FROM actor_knowledge
        WHERE run_id=? AND actor_id=?
      `).get(request.runId, request.actorId);
      if (knowledgeValue === undefined) return undefined;
      const knowledgeRow = WorldKnowledgeDbRowSchema.parse(knowledgeValue);
      if (knowledgeRow.at_world_seq > snapshot.seq || sha256(knowledgeRow.payload_json) !== knowledgeRow.payload_hash) return undefined;
      const knowledge = ActorKnowledgeSchema.parse(parseStoredJson(knowledgeRow.payload_json));
      const pendingPerceptionsAtCut = database.prepare(`
        SELECT p.payload_json,p.payload_hash FROM world_perceptions p
        JOIN world_deliveries d ON d.perception_id=p.perception_id
        JOIN world_commits c ON c.run_id=p.run_id AND c.origin_kind=p.origin_kind AND c.origin_id=p.origin_id
        WHERE p.run_id=? AND p.recipient_actor_id=? AND p.world_seq<=? AND c.commit_index<=? AND d.state='delivered'
          AND NOT EXISTS(
            SELECT 1 FROM actor_pi_consumptions c
            WHERE c.run_id=p.run_id AND c.actor_id=p.recipient_actor_id AND c.perception_id=p.perception_id
          )
        ORDER BY p.world_seq,p.perception_id
      `).all(request.runId, request.actorId, snapshot.seq, requestedCut.commitIndex).flatMap((value) => {
        const row = z.strictObject({ payload_json: z.string(), payload_hash: HashSchema }).parse(value);
        if (sha256(row.payload_json) !== row.payload_hash) throw new Error('Hash de percepción no coincide');
        const perception = WorldPerceptionSchema.parse(parseStoredJson(row.payload_json));
        return perception.fictitiousAt <= snapshot.clock.instant ? [perception] : [];
      });
      let pendingPerceptions = pendingPerceptionsAtCut;
      if (frozenPerceptionIds !== null) {
        const perceptionsById = new Map<string, (typeof pendingPerceptionsAtCut)[number]>(
          pendingPerceptionsAtCut.map((perception) => [perception.id, perception]),
        );
        if (frozenPerceptionIds.some((id) => !perceptionsById.has(id))) return undefined;
        pendingPerceptions = frozenPerceptionIds.map((id) => perceptionsById.get(id)!);
      }
      return {
        kind: 'actor-world-host-cut' as const,
        continuity: ContinuityReferenceSchema.parse({
          continuityId: context.continuityId,
          revision: context.continuityRevision,
          contentHash: context.continuityContentHash,
        }),
        snapshot, knowledgeRevision: knowledgeRow.knowledge_revision, knowledge,
        pendingPerceptionIds: pendingPerceptions.map((perception) => perception.id), pendingPerceptions,
      };
    },

    compareAndSwapActorKnowledge(input: unknown) {
      const request = ActorWorldKnowledgeCasSchema.parse(input);
      return transact(() => {
        const run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId));
        if (run.row.world_revision !== request.expectedWorldRevision || run.row.last_seq !== request.expectedWorldSeq) {
          return { kind: 'conflict' as const };
        }
        const context = run.fence.contexts.find((item) => item.actorId === request.actorId);
        if (context === undefined || context.continuityId !== request.expectedContinuity.continuityId
          || context.continuityRevision !== request.expectedContinuity.revision
          || context.continuityContentHash !== request.expectedContinuity.contentHash) return { kind: 'conflict' as const };
        const snapshot = run.snapshot;
        if (snapshot.seq !== request.expectedWorldSeq || snapshot.revision !== request.expectedWorldRevision) return { kind: 'conflict' as const };
        const actor = snapshot.entities.find((entity) => entity.kind === 'character' && entity.characterId === request.actorId);
        if (actor?.kind !== 'character' || actor.preparation.kind !== 'prepared'
          || actor.preparation.continuityId !== request.expectedContinuity.continuityId
          || actor.preparation.identityVersion !== context.identityVersion) return { kind: 'conflict' as const };
        for (const binding of request.knowledge.bindings) {
          const found = binding.kind === 'entity'
            ? snapshot.entities.some((entity) => entity.entityId === binding.entityId)
            : binding.kind === 'place'
              ? snapshot.places.some((place) => place.id === binding.placeId)
              : binding.kind === 'channel'
                ? snapshot.channels.some((channel) => channel.id === binding.channelId)
                : snapshot.offers.some((offer) => offer.id === binding.offerId);
          if (!found) throw new Error('Knowledge contiene un binding sin destino en el corte');
        }
        const current = WorldKnowledgeDbRowSchema.parse(database.prepare(
          'SELECT knowledge_revision,at_world_seq,payload_json,payload_hash FROM actor_knowledge WHERE run_id=? AND actor_id=?',
        ).get(request.runId, request.actorId));
        if (sha256(current.payload_json) !== current.payload_hash) throw new Error('Hash de ActorKnowledge no coincide');
        if (current.at_world_seq > request.expectedWorldSeq) throw new Error('ActorKnowledge pertenece a un corte futuro');
        if (current.knowledge_revision !== request.expectedKnowledgeRevision) return { kind: 'conflict' as const };
        const payload = hashJson(request.knowledge);
        const nextRevision = RevisionSchema.parse(request.expectedKnowledgeRevision + 1);
        const updated = database.prepare(`
          UPDATE actor_knowledge SET knowledge_revision=?,at_world_seq=?,payload_json=?,payload_hash=?
          WHERE run_id=? AND actor_id=? AND knowledge_revision=?
        `).run(nextRevision, request.expectedWorldSeq, payload.json, payload.hash,
          request.runId, request.actorId, request.expectedKnowledgeRevision);
        return updated.changes === 1
          ? { kind: 'stored' as const, knowledgeRevision: nextRevision }
          : { kind: 'conflict' as const };
      });
    },

    readActorKnowledge(input: unknown) {
      const request = ActorReadSchema.parse(input);
      const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
      if (runValue === undefined) return undefined;
      const run = parseWorldRun(runValue);
      if (request.throughWorldSeq !== run.row.last_seq) return undefined;
      const value = database.prepare(`
        SELECT knowledge_revision,at_world_seq,payload_json,payload_hash FROM actor_knowledge
        WHERE run_id=? AND actor_id=?
      `).get(request.runId, request.actorId);
      if (value === undefined) return undefined;
      const row = WorldKnowledgeDbRowSchema.parse(value);
      if (row.at_world_seq > request.throughWorldSeq || sha256(row.payload_json) !== row.payload_hash) return undefined;
      const knowledge = ActorKnowledgeSchema.parse(parseStoredJson(row.payload_json));
      return { revision: row.knowledge_revision, atWorldSeq: row.at_world_seq, knowledge };
    },

    registerWorldProposal(input: unknown): 'stored' | 'existing' {
      const request = WorldProposalRegistrationSchema.parse(input);
      if (request.attempt.runId !== request.runId) throw new Error('Attempt pertenece a otra corrida');
      return transact(() => {
        const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
        if (runValue === undefined) throw new Error('World run no registrado');
        const oldValue = database.prepare(
          'SELECT 1 AS present FROM world_proposals WHERE run_id=? AND proposal_id=? AND version=?',
        ).get(request.runId, request.proposalId, request.version);
        if (oldValue !== undefined) {
          const { record } = proposalRecord(request.runId, request.proposalId, request.version);
          const attemptHash = hashJson(request.attempt).hash;
          const exactContentHash = request.attempt.kind === 'communicate'
            ? hashCommunicationContent(request.attempt.content) : attemptHash;
          if (record.attemptHash !== attemptHash || record.exactContentHash !== exactContentHash
            || record.jobId !== request.jobId || record.generation !== request.generation
            || record.proposalSlot !== request.proposalSlot
            || canonicalJson(record.attempt) !== canonicalJson(request.attempt)) {
            throw new Error('La versión de propuesta ya existe con otro payload o scope');
          }
          return 'existing';
        }
        const scheduledJobValue = database.prepare(`
          SELECT * FROM actor_turn_jobs
          WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?
        `).get(request.runId, request.attempt.actorId, request.jobId, request.generation);
        if (scheduledJobValue !== undefined) {
          const scheduledJob = ActorTurnJobDbRowSchema.parse(scheduledJobValue);
          if (scheduledJob.state !== 'running' || request.lease === undefined
            || scheduledJob.owner_token !== request.lease.ownerToken
            || scheduledJob.claim_token !== request.lease.claimToken) {
            throw new Error('La propuesta requiere el lease vigente del job actoral');
          }
          const run = parseWorldRun(runValue);
          if (!actorJobEpochCurrent(scheduledJob,run)) throw new Error('La propuesta pertenece a una época de lifecycle anterior');
        } else {
          const activeJobValue = database.prepare(`
            SELECT job_id,generation FROM actor_turn_jobs
            WHERE run_id=? AND actor_id=? AND state IN('queued','running')
          `).get(request.runId, request.attempt.actorId);
          if (activeJobValue !== undefined || request.lease !== undefined) {
            throw new Error('La propuesta no pertenece al job actoral durable activo');
          }
        }
        const run = parseWorldRun(runValue);
        if (run.row.lifecycle !== 'running') throw new Error('El mundo no acepta propuestas fuera de running');
        if (request.attempt.expectedRevision !== run.row.world_revision) throw new Error('Propuesta parte de una revisión obsoleta');
        const scene = run.snapshot.scenes.find((item) => item.id === run.snapshot.activeSceneId);
        if (scene === undefined || !scene.participantIds.includes(request.attempt.actorId)) throw new Error('Actor no participa en la escena activa');
        const actor = run.snapshot.entities.find((entity) => entity.kind === 'character' && entity.characterId === request.attempt.actorId);
        if (actor?.kind !== 'character' || actor.preparation.kind !== 'prepared') throw new Error('Actor no preparado para esta corrida');
        const context = run.fence.contexts.find((item) => item.actorId === request.attempt.actorId);
        if (context === undefined || context.continuityId !== actor.preparation.continuityId
          || context.identityVersion !== actor.preparation.identityVersion) {
          throw new Error('Preparación del actor no coincide con el context fence vigente');
        }
        const attemptHash = hashJson(request.attempt);
        const exactContentHash = request.attempt.kind === 'communicate'
          ? hashCommunicationContent(request.attempt.content) : attemptHash.hash;
        const record = WorldProposalRecordSchema.parse({
          proposalId: request.proposalId, version: request.version, runId: request.runId,
          jobId: request.jobId, generation: request.generation, proposalSlot: request.proposalSlot,
          actorId: request.attempt.actorId, sceneId: scene.id, attemptId: request.attempt.attemptId,
          baseRevision: request.attempt.expectedRevision, exactContentHash, attemptHash: attemptHash.hash,
          attempt: request.attempt,
        });
        const maxReformulationsValue = z.record(z.string(), z.unknown()).parse(run.configuration).maxReformulations;
        const maxReformulations = maxReformulationsValue === undefined
          ? 2
          : z.number().int().min(0).max(2).parse(maxReformulationsValue);
        if (request.version > 1 + maxReformulations) throw new Error('Se excedió el techo configurado de reformulaciones');
        const occupiedSlot = database.prepare(`
          SELECT proposal_id,version,attempt_hash FROM world_proposals
          WHERE run_id=? AND job_id=? AND generation=? AND proposal_slot=?
        `).get(request.runId, request.jobId, request.generation, request.proposalSlot);
        if (occupiedSlot !== undefined) {
          const occupied = z.strictObject({ proposal_id: ProposalIdSchema, version: counter, attempt_hash: HashSchema }).parse(occupiedSlot);
          if (occupied.proposal_id !== request.proposalId || occupied.version !== request.version
            || occupied.attempt_hash !== record.attemptHash) throw new Error('Slot de propuesta ya ocupado por otro payload');
          throw new Error('Slot existe sin su versión de propuesta; requiere diagnóstico');
        }
        const latest = database.prepare(`
          SELECT version FROM world_proposals WHERE run_id=? AND proposal_id=? ORDER BY version DESC LIMIT 1
        `).get(request.runId, request.proposalId);
        if (request.version === 1 && (latest !== undefined || request.proposalSlot !== 0)) {
          throw new Error('La propuesta inicial requiere versión y slot cero');
        }
        if (request.version > 1) {
          const priorValue = latest;
          if (priorValue === undefined) throw new Error('La versión anterior de la propuesta no existe');
          const prior = z.strictObject({ version: counter }).parse(priorValue);
          if (prior.version + 1 !== request.version) throw new Error('Las versiones de propuesta deben ser consecutivas');
          const { row: priorRow, record: priorRecord } = proposalRecord(request.runId, request.proposalId, prior.version);
          if (priorRow.status !== 'pending') throw new Error('Una propuesta resuelta no admite nuevas versiones');
          const priorReviewValue = database.prepare(`
            SELECT review_seq,reviewer_kind,verdict,complete,state_revision,exact_content_hash,payload_json,payload_hash
            FROM world_reviews WHERE run_id=? AND proposal_id=? AND version=?
            ORDER BY review_seq DESC LIMIT 1
          `).get(request.runId, request.proposalId, prior.version);
          if (priorRecord.actorId !== request.attempt.actorId || priorRecord.sceneId !== scene.id
            || priorReviewValue === undefined || priorRecord.jobId !== request.jobId
            || priorRecord.generation !== request.generation || priorRecord.proposalSlot === undefined
            || request.proposalSlot !== priorRecord.proposalSlot + 1) {
            throw new Error('La nueva versión requiere la revisión previa del mismo actor, escena y job/slot');
          }
          const { review: priorReview } = reviewRecord(priorReviewValue);
          if (request.attempt.expectedRevision !== priorRecord.baseRevision
            || priorReview.verdict !== 'reformulate' || !reviewIsComplete(priorReview)) {
            throw new Error('Sólo una reformulación explícita con rúbrica completa y la misma revisión base habilita otra versión');
          }
        }
        database.prepare(`
          INSERT INTO world_proposals(
            run_id,proposal_id,version,actor_id,scene_id,attempt_id,base_revision,exact_content_hash,
            attempt_hash,payload_json,status,created_at,job_id,generation,proposal_slot
          ) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?)
        `).run(
          request.runId, request.proposalId, request.version, record.actorId, record.sceneId, record.attemptId,
          record.baseRevision, record.exactContentHash, record.attemptHash, canonicalJson(record), Date.now(),
          request.jobId, request.generation, request.proposalSlot,
        );
        return 'stored';
      });
    },

    recordContinuistaReview(input: unknown): {kind:'stored'|'existing';reviewSeq:number} {
      const review=ContinuistaReviewInputSchema.parse(input);
      return transact(()=>storeContinuistaReview(review));
    },

    resolveApprovalReceipt(input: unknown) {
      const request = WorldProposalLookupSchema.parse(input);
      return approvalReceiptForProposal(request.runId, request.proposalId, request.version);
    },

    readActorJobProposal(input: unknown) {
      const request = z.strictObject({
        runId: RunIdSchema, actorId: CharacterIdSchema, jobId: JobIdSchema, generation: counter,
        version: counter.min(1).max(3),
      }).parse(input);
      const value = database.prepare(`SELECT proposal_id,version FROM world_proposals
        WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND version=?`)
        .get(request.runId, request.actorId, request.jobId, request.generation, request.version);
      if (value === undefined) return undefined;
      const row = z.strictObject({ proposal_id: ProposalIdSchema, version: counter }).parse(value);
      return proposalRecord(request.runId, row.proposal_id, row.version).record;
    },

    readActorJobAcceptedProposal(input: unknown) { return acceptedActorJobProposal(input); },

    commitHumanIntervention(input: unknown) {
      const request = HumanInterventionCommitSchema.parse(input);
      const requestPayload = hashJson({
        runId: request.runId, participantId: request.participantId,
        expectedRevision: request.expectedRevision, request: request.request,
      });
      return transact(() => {
        const existingValue = database.prepare(`
          SELECT run_id,participant_id,idempotency_key,intervention_id,request_hash,
            resolution_json,resolution_hash,commit_index,created_at
          FROM human_intervention_receipts
          WHERE run_id=? AND participant_id=? AND idempotency_key=?
        `).get(request.runId, request.participantId, request.idempotencyKey);
        if (existingValue !== undefined) {
          const existing = HumanInterventionReceiptDbRowSchema.parse(existingValue);
          if (existing.request_hash !== requestPayload.hash) {
            return HumanInterventionCommitResultSchema.parse({ kind: 'idempotencyConflict' });
          }
          if (sha256(existing.resolution_json) !== existing.resolution_hash) {
            throw new Error('Hash de receipt de intervención no coincide');
          }
          const resolution = HumanInterventionResolutionSchema.parse(parseStoredJson(existing.resolution_json));
          if (canonicalJson(resolution) !== existing.resolution_json || resolution.interventionId !== existing.intervention_id) {
            throw new Error('Receipt de intervención no coincide con su payload');
          }
          return HumanInterventionCommitResultSchema.parse({
            kind: 'existing', commitIndex: existing.commit_index, resolution,
          });
        }

        const run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId));
        if (run.row.lifecycle !== 'running') return HumanInterventionCommitResultSchema.parse({kind:'invalidLifecycle',lifecycle:run.row.lifecycle});
        const configuration = z.record(z.string(), z.unknown()).parse(run.configuration);
        const profiles = HumanParticipantProfilesSchema.parse(configuration.humanParticipants);
        const configuredProfile = profiles.find((item) => item.identity.participantId === request.participantId);
        if (configuredProfile === undefined) throw new Error('El participante no está configurado en la corrida');
        const profile = HumanParticipantProfileSchema.parse(configuredProfile);
        const ids = {
          eventId: () => randomUUID(), perceptionId: () => randomUUID(), experienceId: () => randomUUID(),
          offerId: () => randomUUID(), entityHandle: () => randomUUID(), placeHandle: () => randomUUID(),
          channelHandle: () => randomUUID(), offerHandle: () => randomUUID(),
        };
        const resolution = HumanInterventionResolutionSchema.parse(resolveHumanIntervention({
          snapshot: run.snapshot, profile, request: request.request,
          interventionId: randomUUID(), expectedRevision: request.expectedRevision, ids,
        }));
        let commitIndex: number | null = null;

        if (resolution.kind === 'applied') {
          if (resolution.baseRevision !== run.row.world_revision || resolution.newSnapshot.runId !== request.runId
            || resolution.newSnapshot.seq - run.snapshot.seq !== resolution.events.length) {
            throw new Error('La intervención no conserva el corte de mundo esperado');
          }
          for (const [index, event] of resolution.events.entries()) {
            const belongsToIntervention = event.origin.kind === 'human'
              ? event.origin.participantId === request.participantId && event.origin.interventionId === resolution.interventionId
              : event.origin.kind === 'system' && 'causeInterventionId' in event.origin
                && event.origin.causeInterventionId === resolution.interventionId;
            if (event.runId !== request.runId || event.seq !== run.row.last_seq + index + 1 || !belongsToIntervention) {
              throw new Error('Evento de intervención fuera de origen o secuencia');
            }
          }
          const speechEvent = resolution.events.find((event) => event.kind === 'humanIntervention');
          if (speechEvent === undefined || resolution.emission.kind !== 'emitted'
            || speechEvent.id !== resolution.emission.eventId) throw new Error('La intervención no confirma su evento de habla');
          const eventIds = new Set(resolution.events.map((event) => event.id));
          for (const perception of resolution.perceptions) {
            if (perception.kind !== 'testimony' || perception.runId !== request.runId
              || perception.sourceParticipantId !== request.participantId || !eventIds.has(perception.eventId)
              || !speechEvent.effectiveAudience.includes(perception.recipientCharacterId)) {
              throw new Error('Testimonio sale del origen o audiencia efectivos de la intervención');
            }
          }
          const snapshotPayload = hashJson(resolution.newSnapshot);
          commitIndex = counter.parse(run.row.commit_index + 1);
          const committedAt = Date.now();
          database.prepare(`
            INSERT INTO world_commits(
              run_id,origin_kind,origin_id,commit_index,world_revision,last_seq,snapshot_json,snapshot_hash,created_at
            ) VALUES(?,'humanIntervention',?,?,?,?,?,?,?)
          `).run(request.runId, resolution.interventionId, commitIndex, resolution.newSnapshot.revision,
            resolution.newSnapshot.seq, snapshotPayload.json, snapshotPayload.hash, committedAt);
          for (const event of resolution.events) {
            const eventPayload = hashJson(event);
            database.prepare(`
              INSERT INTO world_events(event_id,run_id,world_seq,origin_id,payload_json,payload_hash) VALUES(?,?,?,?,?,?)
            `).run(event.id, request.runId, event.seq, resolution.interventionId, eventPayload.json, eventPayload.hash);
          }
          for (const perception of resolution.perceptions) {
            if (perception.kind !== 'testimony') throw new Error('La intervención sólo puede originar testimonios');
            const perceptionPayload = hashJson(perception);
            const event = resolution.events.find((candidate) => candidate.id === perception.eventId);
            if (event === undefined) throw new Error('Testimonio refiere un evento ajeno al commit');
            database.prepare(`
              INSERT INTO world_perceptions(
                perception_id,run_id,world_seq,attempt_id,event_id,recipient_actor_id,payload_json,payload_hash,origin_kind,origin_id
              ) VALUES(?,?,?,NULL,?,?,?,?,?,?)
            `).run(perception.id, request.runId, event.seq, perception.eventId, perception.recipientCharacterId,
              perceptionPayload.json, perceptionPayload.hash, 'humanIntervention', resolution.interventionId);
            database.prepare('INSERT INTO world_deliveries(perception_id,state) VALUES(?,\'planned\')').run(perception.id);
            database.prepare(`
              INSERT INTO actor_turn_intents(run_id,actor_id,perception_id,world_seq,state,created_at)
              VALUES(?,?,?,?,\'awaitingDelivery\',?)
            `).run(request.runId, perception.recipientCharacterId, perception.id, event.seq, committedAt);
          }
          const updated = database.prepare(`
            UPDATE world_runs SET world_revision=?,last_seq=?,commit_index=?,snapshot_json=?,snapshot_hash=?,updated_at=?
            WHERE run_id=? AND world_revision=? AND commit_index=?
          `).run(resolution.newSnapshot.revision, resolution.newSnapshot.seq, commitIndex,
            snapshotPayload.json, snapshotPayload.hash, committedAt, request.runId,
            run.row.world_revision, run.row.commit_index);
          if (updated.changes !== 1) throw new Error('CAS de world revision falló al guardar intervención');
          const committedRun=parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId));
          const readyConfiguration=ReadyRunConfigurationSchema.safeParse(committedRun.configuration);
          if(readyConfiguration.success)admitRoutineBoundaryActivations(committedRun,readyConfiguration.data,run.snapshot.clock.instant,committedAt);
        }

        const resolutionPayload = hashJson(resolution);
        database.prepare(`
          INSERT INTO human_intervention_receipts(
            run_id,participant_id,idempotency_key,intervention_id,request_hash,resolution_json,resolution_hash,commit_index,created_at
          ) VALUES(?,?,?,?,?,?,?,?,?)
        `).run(request.runId, request.participantId, request.idempotencyKey, resolution.interventionId,
          requestPayload.hash, resolutionPayload.json, resolutionPayload.hash, commitIndex, Date.now());
        return HumanInterventionCommitResultSchema.parse({ kind: 'stored', commitIndex, resolution });
      });
    },

    commitWorldAttempt(input: unknown) {
      const request = WorldAttemptCommitSchema.parse(input);
      return transact(() => {
        const { record, row: proposal } = proposalRecord(request.runId, request.proposalId, request.version);
        const existingValue = database.prepare(`
          SELECT proposal_id,version,attempt_hash,payload_json,payload_hash,commit_index
          FROM world_resolutions WHERE run_id=? AND origin_kind='actorAttempt' AND origin_id=?
        `).get(request.runId, record.attemptId);
        if (existingValue !== undefined) {
          const existing = WorldResolutionDbRowSchema.parse(existingValue);
          if (existing.proposal_id !== request.proposalId || existing.version !== request.version
            || existing.attempt_hash !== record.attemptHash || sha256(existing.payload_json) !== existing.payload_hash) {
            throw new Error('El intento ya se resolvió con otra propuesta o payload');
          }
          return {
            kind: 'existing' as const, commitIndex: existing.commit_index,
            resolution: WorldResolutionSchema.parse(parseStoredJson(existing.payload_json)),
          };
        }
        if (proposal.status !== 'pending') throw new Error('Propuesta ya resuelta sin resolution ledger');
        const proposalJobId = record.jobId;
        const proposalGeneration = record.generation;
        if (proposalJobId === undefined || proposalGeneration === undefined
          || latestProposalVersion(request.runId, request.proposalId) !== request.version) {
          throw new Error('Sólo el último slot de propuesta registrado puede resolverse');
        }
        const scheduledJobValue = database.prepare(`
          SELECT * FROM actor_turn_jobs
          WHERE run_id=:runId AND actor_id=:actorId AND job_id=:jobId AND generation=:generation
        `).get({
          runId: String(request.runId), actorId: String(record.actorId),
          jobId: String(proposalJobId), generation: proposalGeneration,
        });
        if (scheduledJobValue !== undefined) {
          const scheduledJob = ActorTurnJobDbRowSchema.parse(scheduledJobValue);
          if (scheduledJob.state !== 'accepted') {
            throw new Error('La propuesta de un job requiere un turno Pi aceptado antes del commit de Escenario');
          }
          const currentRun = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId));
          if (!actorJobEpochCurrent(scheduledJob,currentRun)) throw new Error('La propuesta aceptada pertenece a una época de lifecycle anterior');
          const receiptValues = database.prepare(`
            SELECT r.candidate_id,r.receipt_json,r.receipt_hash
            FROM actor_pi_turn_receipts r
            JOIN actor_pi_candidates c ON c.candidate_id=r.candidate_id
            WHERE c.run_id=:runId AND c.actor_id=:actorId AND c.job_id=:jobId AND c.generation=:generation
              AND c.candidate_kind='terminal-candidate'
          `).all({
            runId: String(request.runId), actorId: String(record.actorId),
            jobId: String(proposalJobId), generation: proposalGeneration,
          });
          const acceptedProposal = receiptValues.some((value) => {
            const row = z.strictObject({ candidate_id: z.string().uuid(), receipt_json: z.string(), receipt_hash: HashSchema }).parse(value);
            if (sha256(row.receipt_json) !== row.receipt_hash) throw new Error('Hash del receipt Pi no coincide');
            const receipt = ActorPiReceiptSchema.parse(parseStoredJson(row.receipt_json));
            if (canonicalJson(receipt) !== row.receipt_json) throw new Error('Receipt Pi no canónico');
            const candidate = actorCandidateFromRow(database.prepare('SELECT * FROM actor_pi_candidates WHERE candidate_id=?')
              .get(row.candidate_id));
            return candidate.kind === 'terminal-candidate'
              && receipt.candidateId === candidate.candidateId
              && receipt.runId === request.runId && receipt.actorId === record.actorId
              && receipt.scope.jobId === record.jobId && receipt.scope.generation === record.generation
              && receipt.proposal.kind === 'durable'
              && receipt.proposal.proposalId === request.proposalId
              && receipt.proposal.version === request.version
              && receipt.proposal.attemptHash === record.attemptHash;
          });
          if (!acceptedProposal) {
            throw new Error('El receipt Pi aceptado no autoriza esta propuesta y versión exactas');
          }
        }
        const run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId));
        if (run.row.lifecycle !== 'running') throw new Error('El mundo no acepta commits fuera de running');
        const knowledgeRow = WorldKnowledgeDbRowSchema.parse(database.prepare(`
          SELECT knowledge_revision,at_world_seq,payload_json,payload_hash FROM actor_knowledge WHERE run_id=? AND actor_id=?
        `).get(request.runId, record.actorId));
        if (sha256(knowledgeRow.payload_json) !== knowledgeRow.payload_hash || knowledgeRow.at_world_seq > run.row.last_seq) {
          throw new Error('ActorKnowledge durable corrupto o posterior al mundo');
        }
        const knowledge = ActorKnowledgeSchema.parse(parseStoredJson(knowledgeRow.payload_json));
        const approvalReceipt = record.attempt.kind === 'communicate'
          ? approvalReceiptForProposal(request.runId, request.proposalId, request.version) : undefined;
        const resolution = WorldResolutionSchema.parse(resolveWorldAttempt({
          snapshot: run.snapshot, attempt: record.attempt, actorKnowledge: knowledge,
          ...(approvalReceipt === undefined ? {} : { approvalReceipt }), ids: request.ids,
        }));
        if (resolution.attemptId !== record.attemptId || resolution.newSnapshot.runId !== request.runId) {
          throw new Error('Resolver devolvió un resultado fuera del intento/corrida');
        }
        if (resolution.newSnapshot.seq - run.snapshot.seq !== resolution.events.length) {
          throw new Error('La resolución no conserva secuencias contiguas');
        }
        for (const [index, event] of resolution.events.entries()) {
          const belongsToAttempt = event.origin.kind === 'actor'
            ? event.origin.actorId === record.actorId && event.origin.attemptId === record.attemptId
            : event.origin.kind === 'system' && 'causeAttemptId' in event.origin
              && event.origin.causeAttemptId === record.attemptId;
          if (event.runId !== request.runId || event.seq !== run.snapshot.seq + index + 1
            || event.kind === 'humanIntervention' || !belongsToAttempt) {
            throw new Error('Evento no corresponde al origen/secuencia del intento');
          }
        }
        const eventIds = new Set(resolution.events.map((event) => event.id));
        const activeScene = run.snapshot.scenes.find((scene) => scene.id === run.snapshot.activeSceneId);
        for (const perception of resolution.perceptions) {
          if (perception.runId !== request.runId || activeScene === undefined
            || !activeScene.participantIds.includes(perception.recipientCharacterId)) {
            throw new Error('Percepción sale de la corrida o participantes preparados');
          }
          if (perception.kind === 'testimony') {
            throw new Error('Un testimonio humano no puede persistirse como percepción de actorAttempt');
          }
          if ('eventId' in perception) {
            const event = resolution.events.find((candidate) => candidate.id === perception.eventId);
            if (event === undefined || !eventIds.has(perception.eventId)) throw new Error('Percepción refiere evento ajeno al intento');
            if (perception.kind === 'communication') {
              if (event.kind !== 'communicated' || !event.effectiveAudience.includes(perception.recipientCharacterId)
                || perception.sourceEntityId !== event.entityId || perception.channelId !== event.channelId
                || canonicalJson(perception.content) !== canonicalJson(event.content)
                || perception.targetEntityId !== event.targetEntityId
                || perception.fictitiousAt !== event.fictitiousAt + event.durationMs) {
                throw new Error('La recepción de comunicación no coincide con emisión y audiencia efectivas');
              }
            } else if (perception.kind === 'offer') {
              if (event.kind !== 'offerCreated' || event.recipientCharacterId !== perception.recipientCharacterId
                || perception.offerId !== event.offerId || perception.objectEntityId !== event.objectEntityId
                || perception.sourceEntityId !== event.ownerEntityId
                || perception.fictitiousAt !== event.fictitiousAt + event.durationMs) {
                throw new Error('La recepción de oferta no coincide con evento/destinatario');
              }
            } else if (perception.kind === 'worldEvent') {
              const originActorId = event.origin.kind === 'actor' ? event.origin.actorId : undefined;
              const originActor = originActorId === undefined ? undefined : run.snapshot.entities.find(
                (entity) => entity.kind === 'character' && entity.characterId === originActorId,
              );
              if (originActor?.kind !== 'character' || perception.sourceEntityId !== originActor.entityId
                || perception.fictitiousAt !== event.fictitiousAt) {
                throw new Error('La percepción WorldEvent no coincide con el origen/tiempo del evento');
              }
            } else {
              throw new Error('Percepción de observación no puede referir un evento del Escenario');
            }
          } else if (perception.kind !== 'observation' || perception.attemptId !== record.attemptId
            || perception.recipientCharacterId !== record.actorId) {
            throw new Error('Percepción sin evento sólo es válida para la observación del actor solicitante');
          }
        }
        if (resolution.kind !== 'applied' && (resolution.events.length !== 0 || resolution.perceptions.length !== 0)) {
          throw new Error('Una resolución no aplicada no puede emitir eventos ni percepciones');
        }
        if (resolution.kind === 'applied' && resolution.emission.kind === 'emitted'
          && (approvalReceipt === undefined || record.attempt.kind !== 'communicate'
            || approvalReceipt.proposalId !== request.proposalId || approvalReceipt.version !== request.version
            || approvalReceipt.exactContentHash !== hashCommunicationContent(record.attempt.content))) {
          throw new Error('Emisión sin receipt de Continuista vigente y exacto');
        }
        const resolutionPayload = hashJson(resolution);
        const commitIndex = counter.parse(run.row.commit_index + 1);
        const snapshotPayload = hashJson(resolution.newSnapshot);
        const committedAt = Date.now();
        database.prepare(`
          INSERT INTO world_resolutions(
            run_id,origin_kind,origin_id,proposal_id,version,attempt_hash,payload_json,payload_hash,
            commit_index,world_revision,last_seq,created_at
          ) VALUES(?,'actorAttempt',?,?,?,?,?,?,?,?,?,?)
        `).run(request.runId, record.attemptId, request.proposalId, request.version, record.attemptHash,
          resolutionPayload.json, resolutionPayload.hash, commitIndex, resolution.newSnapshot.revision,
          resolution.newSnapshot.seq, committedAt);
        database.prepare(`
          INSERT INTO world_commits(
            run_id,origin_kind,origin_id,commit_index,world_revision,last_seq,snapshot_json,snapshot_hash,created_at
          ) VALUES(?,'actorAttempt',?,?,?,?,?,?,?)
        `).run(request.runId, record.attemptId, commitIndex, resolution.newSnapshot.revision,
          resolution.newSnapshot.seq, snapshotPayload.json, snapshotPayload.hash, committedAt);
        for (const event of resolution.events) {
          const eventPayload = hashJson(event);
          database.prepare('INSERT INTO world_events(event_id,run_id,world_seq,origin_id,payload_json,payload_hash) VALUES(?,?,?,?,?,?)')
            .run(event.id, request.runId, event.seq, record.attemptId, eventPayload.json, eventPayload.hash);
        }
        for (const perception of resolution.perceptions) {
          const perceptionPayload = hashJson(perception);
          const eventId = 'eventId' in perception ? perception.eventId : null;
          const eventSeq = eventId === null
            ? resolution.newSnapshot.seq
            : resolution.events.find((event) => event.id === eventId)?.seq;
          if (eventSeq === undefined) throw new Error('Percepción sin secuencia de evento confirmada');
          database.prepare(`
            INSERT INTO world_perceptions(
              perception_id,run_id,world_seq,attempt_id,event_id,recipient_actor_id,payload_json,payload_hash,origin_kind,origin_id
            ) VALUES(?,?,?,?,?,?,?,?,?,?)
          `).run(perception.id, request.runId, eventSeq, record.attemptId,
            eventId, perception.recipientCharacterId, perceptionPayload.json, perceptionPayload.hash,
            'actorAttempt', record.attemptId);
          database.prepare('INSERT INTO world_deliveries(perception_id,state) VALUES(?,\'planned\')').run(perception.id);
          if (perception.recipientCharacterId !== record.actorId) {
            database.prepare(`INSERT INTO actor_turn_intents(run_id,actor_id,perception_id,world_seq,state,created_at)
              VALUES(?,?,?,?,'awaitingDelivery',?)`).run(request.runId, perception.recipientCharacterId, perception.id, eventSeq, committedAt);
          }
        }
        const updated = database.prepare(`
          UPDATE world_runs SET world_revision=?,last_seq=?,commit_index=?,snapshot_json=?,snapshot_hash=?,updated_at=?
          WHERE run_id=? AND world_revision=? AND commit_index=?
        `).run(resolution.newSnapshot.revision, resolution.newSnapshot.seq, commitIndex,
          snapshotPayload.json, snapshotPayload.hash, committedAt, request.runId,
          run.row.world_revision, run.row.commit_index);
        if (updated.changes !== 1) throw new Error('CAS de world revision falló');
        const committedRun=parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId));
        const readyConfiguration=ReadyRunConfigurationSchema.safeParse(committedRun.configuration);
        if(readyConfiguration.success)admitRoutineBoundaryActivations(committedRun,readyConfiguration.data,run.snapshot.clock.instant,committedAt);
        database.prepare(`UPDATE world_proposals SET status='resolved' WHERE run_id=? AND proposal_id=? AND version=? AND status='pending'`)
          .run(request.runId, request.proposalId, request.version);
        return { kind: 'committed' as const, commitIndex, resolution };
      });
    },

    /** Bounded confirmed rows with the exact pre-commit cut for labels/visibility.
     * This host-only read never returns a proposal, perception payload or Pi output. */
    readObservationEvents(input: unknown) {
      const request = z.strictObject({runId:RunIdSchema,fromWorldSeq:WorldSeqSchema,toWorldSeq:WorldSeqSchema,
        afterWorldSeq:WorldSeqSchema.nullable(),limit:counter.min(1).max(100),communicationsOnly:z.boolean()}).parse(input);
      const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
      if (runValue === undefined) return undefined;
      const run = parseWorldRun(runValue);
      const values = database.prepare(`SELECT e.payload_json,e.payload_hash,c.commit_index
        FROM world_events e JOIN world_commits c ON c.run_id=e.run_id AND c.commit_index=(SELECT MIN(commit_index) FROM world_commits x WHERE x.run_id=e.run_id AND x.last_seq>=e.world_seq)
        WHERE e.run_id=? AND e.world_seq>=? AND e.world_seq<=? AND (? IS NULL OR e.world_seq>?)
          AND (?=0 OR json_extract(e.payload_json,'$.kind') IN('communicated','humanIntervention'))
        ORDER BY e.world_seq LIMIT ?`).all(request.runId,request.fromWorldSeq,request.toWorldSeq,
          request.afterWorldSeq,request.afterWorldSeq,Number(request.communicationsOnly),request.limit);
      return values.map((value) => {
        const row = z.strictObject({payload_json:z.string(),payload_hash:HashSchema,commit_index:counter.min(1)}).parse(value);
        if (sha256(row.payload_json) !== row.payload_hash) throw new Error('Hash de evento confirmado alterado');
        const event = WorldEventSchema.parse(parseStoredJson(row.payload_json));
        if (event.runId !== request.runId || canonicalJson(event) !== row.payload_json) throw new Error('Evento confirmado fuera de su ámbito');
        const previous = database.prepare('SELECT * FROM world_commits WHERE run_id=? AND commit_index<? ORDER BY commit_index DESC LIMIT 1')
          .get(request.runId,row.commit_index);
        let snapshot = run.initialSnapshot;
        if (previous !== undefined) {
          const commit = WorldCommitDbRowSchema.parse(previous);
          if (sha256(commit.snapshot_json) !== commit.snapshot_hash) throw new Error('Snapshot anterior alterado');
          snapshot = WorldSnapshotSchema.parse(parseStoredJson(commit.snapshot_json));
          if (snapshot.runId !== request.runId || snapshot.revision !== commit.world_revision || snapshot.seq !== commit.last_seq) throw new Error('Corte anterior ajeno al evento');
        }
        return {event,snapshot,commitIndex:row.commit_index};
      });
    },

    readObservationDeliveries(input: unknown) {
      const request = z.strictObject({runId:RunIdSchema,eventId:EventIdSchema}).parse(input);
      return database.prepare(`SELECT p.recipient_actor_id AS actor_id,d.state,
        CASE WHEN d.state<>'delivered' THEN 'notDelivered' WHEN r.experience_id IS NULL THEN 'pending' ELSE 'projected' END AS projection
        FROM world_perceptions p JOIN world_deliveries d ON d.perception_id=p.perception_id
        LEFT JOIN world_perception_experiences x ON x.perception_id=p.perception_id
        LEFT JOIN memory_receipts r ON r.experience_id=x.experience_id
        WHERE p.run_id=? AND p.event_id=? ORDER BY p.recipient_actor_id,p.perception_id LIMIT 101`)
        .all(request.runId,request.eventId).map((value) => {
          const row = z.strictObject({actor_id:CharacterIdSchema,state:z.enum(['planned','delivering','delivered','failed']),projection:z.enum(['notDelivered','pending','projected'])}).parse(value);
          return {actorId:row.actor_id,state:row.state,memoryProjection:row.projection};
        });
    },

    readObservationJobs(input: unknown) {
      const request = z.strictObject({runId:RunIdSchema,afterKey:z.string().min(1).max(200).nullable(),limit:counter.min(1).max(100)}).parse(input);
      return database.prepare(`WITH j AS (
        SELECT 'actor' AS kind,job_id,generation,pulse_id,state,actor_id,created_at,updated_at,failure_code AS safe_code FROM actor_turn_jobs WHERE run_id=?
        UNION ALL SELECT 'continuista',job_id,generation,pulse_id,state,actor_id,created_at,updated_at,failure_code FROM continuista_jobs WHERE run_id=?
        UNION ALL SELECT 'pulse',pulse_id,0,pulse_id,state,NULL,created_at,updated_at,NULL FROM coordinator_pulses WHERE run_id=?
        UNION ALL SELECT 'step',job_id,0,pulse_id,state,NULL,created_at,updated_at,NULL FROM run_step_jobs WHERE run_id=?
        UNION ALL SELECT role,job_id,generation,pulse_id,state,NULL,created_at,updated_at,failure_code FROM administrative_jobs WHERE run_id=?
        UNION ALL SELECT 'preflight',job_id,0,NULL,state,NULL,CAST(strftime('%s',created_at) AS INTEGER)*1000,CAST(strftime('%s',updated_at) AS INTEGER)*1000,NULL FROM run_preflight_jobs WHERE run_id=?
      ), k AS (SELECT *,kind||':'||job_id||':'||generation AS page_key FROM j)
      SELECT * FROM k WHERE (? IS NULL OR page_key>?) ORDER BY page_key LIMIT ?`)
        .all(request.runId,request.runId,request.runId,request.runId,request.runId,request.runId,request.afterKey,request.afterKey,request.limit)
        .map((value) => {
          const row = z.strictObject({kind:z.enum(['actor','continuista','pulse','step','preflight','director','narrator','configurator','narration-reviewer']),job_id:JobIdSchema,generation:counter,
            pulse_id:PulseIdSchema.nullable(),state:z.enum(['queued','running','accepted','blocked','completed','succeeded','failed','canceled','interrupted','cancel-requested']),
            actor_id:CharacterIdSchema.nullable(),created_at:counter,updated_at:counter,safe_code:z.string().nullable(),page_key:z.string()}).parse(value);
          const usage = z.strictObject({calls:counter,measured:counter,reserved:counter}).parse(database.prepare(`SELECT
            (SELECT COUNT(*) FROM request_reservations WHERE run_id=? AND job_id=? AND generation=?) AS calls,
            COALESCE(SUM(CASE WHEN state='settled' THEN measured_ms ELSE 0 END),0) AS measured,
            COALESCE(SUM(CASE WHEN state IN('reserved','running','expired','uncertain') THEN reserved_ms ELSE 0 END),0) AS reserved
            FROM model_time_spans WHERE run_id=? AND job_id=? AND generation=?`).get(request.runId,row.job_id,row.generation,request.runId,row.job_id,row.generation));
          return {row,usage};
        });
    },

    /** Host-only bridge to presentation. Human/animal/gesture content is not speech synthesis input. */
    readConfirmedSpeechPublication(input: unknown) {
      const request = z.strictObject({ runId: RunIdSchema, eventId: EventIdSchema }).parse(input);
      const value = database.prepare(`SELECT e.payload_json,e.payload_hash,e.world_seq,c.origin_id,c.created_at,c.last_seq
        FROM world_events e JOIN world_commits c ON c.run_id=e.run_id AND c.origin_id=e.origin_id
        WHERE e.run_id=? AND e.event_id=? AND c.origin_kind='actorAttempt'`).get(request.runId,request.eventId);
      if (value === undefined) return undefined;
      const row = z.strictObject({payload_json:z.string(),payload_hash:HashSchema,world_seq:WorldSeqSchema,origin_id:WorldAttemptIdSchema,created_at:counter,last_seq:WorldSeqSchema}).parse(value);
      if (sha256(row.payload_json) !== row.payload_hash) throw new Error('Hash de publicación confirmado alterado');
      const event = WorldEventSchema.parse(parseStoredJson(row.payload_json));
      if (event.id !== request.eventId || event.runId !== request.runId || event.seq !== row.world_seq || event.seq > row.last_seq || canonicalJson(event) !== row.payload_json) {
        throw new Error('Publicación confirmada fuera de su ámbito');
      }
      if (event.kind !== 'communicated' || event.content.kind !== 'speech' || event.origin.kind !== 'actor') return undefined;
      if (event.origin.attemptId !== row.origin_id) throw new Error('Origen de publicación confirmado inconsistente');
      return { event, committedAt: row.created_at };
    },

    listConfirmedSpeechPublications(input: unknown) {
      const request = z.strictObject({runId:RunIdSchema,afterWorldSeq:WorldSeqSchema,limit:counter.min(1).max(100)}).parse(input);
      const rows = database.prepare(`SELECT e.event_id,e.world_seq FROM world_events e
        JOIN world_commits c ON c.run_id=e.run_id AND c.origin_id=e.origin_id
        WHERE e.run_id=? AND e.world_seq>? AND c.origin_kind='actorAttempt'
          AND json_extract(e.payload_json,'$.kind')='communicated'
          AND json_extract(e.payload_json,'$.content.kind')='speech'
          AND json_extract(e.payload_json,'$.origin.kind')='actor'
        ORDER BY e.world_seq LIMIT ?`).all(request.runId,request.afterWorldSeq,request.limit);
      return rows.map(value => z.strictObject({event_id:EventIdSchema,world_seq:WorldSeqSchema}).parse(value))
        .map(row => ({eventId:row.event_id,worldSeq:row.world_seq}));
    },

    readWorldEvents(input: { runId: unknown; fromWorldSeq?: unknown; toWorldSeq?: unknown }) {
      const request = z.strictObject({ runId: RunIdSchema, fromWorldSeq: WorldSeqSchema.optional(), toWorldSeq: WorldSeqSchema.optional() }).parse(input);
      const from = request.fromWorldSeq ?? 0;
      const to = request.toWorldSeq ?? Number.MAX_SAFE_INTEGER;
      if (from > to) throw new Error('Rango de eventos inválido');
      return database.prepare(`
        SELECT payload_json,payload_hash FROM world_events
        WHERE run_id=? AND world_seq>=? AND world_seq<=? ORDER BY world_seq
      `).all(request.runId, from, to).map((value) => {
        const row = z.strictObject({ payload_json: z.string(), payload_hash: HashSchema }).parse(value);
        if (sha256(row.payload_json) !== row.payload_hash) throw new Error('Hash de evento no coincide');
        return WorldEventSchema.parse(parseStoredJson(row.payload_json));
      });
    },

    claimWorldDelivery(input: unknown) {
      const request = WorldDeliveryClaimSchema.parse(input);
      return transact(() => {
        const candidate = database.prepare(`
          SELECT p.perception_id,p.run_id,p.world_seq,p.recipient_actor_id AS actor_id,p.payload_json,
            p.payload_hash,p.origin_kind,p.origin_id,
            d.state,d.claim_token,d.owner_token,d.attempts
          FROM world_deliveries d JOIN world_perceptions p ON p.perception_id=d.perception_id
          WHERE p.run_id=? AND p.recipient_actor_id=? AND p.world_seq<=? AND d.state IN('planned','failed','delivering')
          ORDER BY p.world_seq,p.perception_id LIMIT 1
        `).get(request.runId, request.actorId, request.throughWorldSeq);
        if (candidate === undefined) return { kind: 'empty' as const };
        const row = WorldDeliveryDbRowSchema.parse(candidate);
        // A different owner is not evidence that the previous worker died. Do not steal an in-flight delivery.
        if (row.state === 'delivering') return { kind: 'busy' as const };
        const updated = database.prepare(`
          UPDATE world_deliveries SET state='delivering',claim_token=?,owner_token=?,attempts=attempts+1,failure_code=NULL
          WHERE perception_id=? AND state=?
        `).run(request.claimToken, request.ownerToken, row.perception_id, row.state);
        if (updated.changes !== 1) return { kind: 'busy' as const };
        if (sha256(row.payload_json) !== row.payload_hash) throw new Error('Hash de percepción no coincide');
        const perception = WorldPerceptionSchema.parse(parseStoredJson(row.payload_json));
        return {
          kind: 'claimed' as const, claimToken: request.claimToken, ownerToken: request.ownerToken,
          attempts: row.attempts + 1, worldSeq: WorldSeqSchema.parse(row.world_seq), perception,
        };
      });
    },

    failWorldDelivery(input: unknown): 'failed' | 'stale' {
      const request = WorldDeliveryFailureSchema.parse(input);
      return transact(() => {
        const result = database.prepare(`
          UPDATE world_deliveries SET state='failed',claim_token=NULL,owner_token=NULL,failure_code=?
          WHERE perception_id=? AND state='delivering' AND claim_token=?
        `).run(request.failureCode, request.perceptionId, request.claimToken);
        return result.changes === 1 ? 'failed' : 'stale';
      });
    },

    completeWorldDelivery(input: unknown): 'delivered' | 'existing' | 'stale' {
      const request = WorldDeliveryCompletionSchema.parse(input);
      return transact(() => {
        const rowValue = database.prepare(`
          SELECT p.perception_id,p.run_id,p.world_seq,p.recipient_actor_id AS actor_id,p.payload_json,
            p.payload_hash,p.origin_kind,p.origin_id,
            d.state,d.claim_token,d.owner_token,d.attempts
          FROM world_deliveries d JOIN world_perceptions p ON p.perception_id=d.perception_id
          WHERE p.perception_id=?
        `).get(request.perceptionId);
        if (rowValue === undefined) return 'stale';
        const row = WorldDeliveryDbRowSchema.parse(rowValue);
        if (sha256(row.payload_json) !== row.payload_hash) throw new Error('Hash de percepción no coincide');
        const perception = WorldPerceptionSchema.parse(parseStoredJson(row.payload_json));
        const priorMappingValue = database.prepare(
          'SELECT experience_id FROM world_perception_experiences WHERE perception_id=?',
        ).get(request.perceptionId);
        const priorMapping = priorMappingValue === undefined
          ? undefined
          : z.strictObject({ experience_id: ExperienceIdSchema }).parse(priorMappingValue);
        const isExactDeliveredRetry = row.state === 'delivered' && row.claim_token === request.claimToken;
        if (row.state === 'delivered' && !isExactDeliveredRetry) return 'stale';
        if (isExactDeliveredRetry) {
          if (request.experience === undefined) {
            if (priorMapping !== undefined) throw new Error('Claim de entrega repetido con payload distinto');
            return 'existing';
          }
        }
        if (!isExactDeliveredRetry && (row.state !== 'delivering' || row.claim_token !== request.claimToken)) return 'stale';
        if (request.experience === undefined && 'eventId' in perception) {
          throw new Error('Percepción con evento requiere Experience antes del ack durable');
        }
        if (request.experience !== undefined) {
          const supplied = FrozenExperienceSchema.parse(request.experience);
          const frozen = freezeExperience(supplied.envelope);
          const experienceMatchesPerception = perception.kind === 'testimony'
            ? frozen.envelope.kind === 'testimony'
              && frozen.envelope.speakerParticipantId === perception.sourceParticipantId
              && frozen.envelope.speakerDisplayName === perception.speakerDisplayName
            : frozen.envelope.kind === 'perception' && frozen.envelope.perceptionId === perception.id;
          const experienceEventId = 'eventId' in frozen.envelope ? frozen.envelope.eventId : undefined;
          if (frozen.payloadHash !== supplied.payloadHash || frozen.canonicalPayload !== supplied.canonicalPayload
            || !experienceMatchesPerception || frozen.envelope.runId !== perception.runId
            || frozen.envelope.actorId !== perception.recipientCharacterId || frozen.envelope.worldSeq !== row.world_seq
            || !('eventId' in perception) || experienceEventId !== perception.eventId
            || frozen.envelope.fictitiousAt !== perception.fictitiousAt) {
            throw new Error('Experience no corresponde a la percepción reclamada');
          }
          const run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(perception.runId));
          if (frozen.envelope.receivedAt < perception.fictitiousAt
            || frozen.envelope.receivedAt > run.snapshot.clock.instant || row.world_seq > run.snapshot.seq) {
            throw new Error('Experience declara una recepción futura o anterior a la percepción');
          }
          const eventValue = database.prepare(`
            SELECT run_id,world_seq,payload_json,payload_hash FROM world_events WHERE event_id=?
          `).get(perception.eventId);
          if (eventValue === undefined) throw new Error('Experience refiere un evento no confirmado');
          const eventRow = z.strictObject({ run_id: RunIdSchema, world_seq: WorldSeqSchema, payload_json: z.string(), payload_hash: HashSchema }).parse(eventValue);
          if (sha256(eventRow.payload_json) !== eventRow.payload_hash || eventRow.run_id !== perception.runId
            || eventRow.world_seq !== row.world_seq) throw new Error('Evento de percepción corrupto o fuera del corte');
          const event = WorldEventSchema.parse(parseStoredJson(eventRow.payload_json));
          if (event.id !== perception.eventId || event.runId !== perception.runId || event.seq !== row.world_seq) {
            throw new Error('Evento de percepción no coincide con su registro');
          }
          if (perception.kind === 'communication') {
            if (event.kind !== 'communicated' || !event.effectiveAudience.includes(perception.recipientCharacterId)
              || perception.sourceEntityId !== event.entityId || perception.channelId !== event.channelId
              || canonicalJson(perception.content) !== canonicalJson(event.content)
              || perception.targetEntityId !== event.targetEntityId
              || perception.fictitiousAt !== event.fictitiousAt + event.durationMs) {
              throw new Error('Experience no acredita recepción efectiva de la comunicación');
            }
          } else if (perception.kind === 'offer') {
            if (event.kind !== 'offerCreated' || event.recipientCharacterId !== perception.recipientCharacterId
              || perception.offerId !== event.offerId || perception.objectEntityId !== event.objectEntityId
              || perception.sourceEntityId !== event.ownerEntityId
              || perception.fictitiousAt !== event.fictitiousAt + event.durationMs) {
              throw new Error('Experience no acredita recepción efectiva de la oferta');
            }
          } else if (perception.kind === 'circumstance') {
            if (event.kind !== 'circumstanceChanged' || event.origin.kind !== 'direction'
              || row.origin_kind !== 'directionCircumstance' || event.origin.operationId !== row.origin_id
              || !event.effectiveAudience.includes(perception.recipientCharacterId)
              || perception.fictitiousAt !== event.fictitiousAt + event.durationMs
              || frozen.envelope.content !== perception.detail || frozen.envelope.sourceRefs.length !== 0) {
              throw new Error('Experience no acredita recepción efectiva de la circunstancia');
            }
          } else if (perception.kind === 'worldEvent') {
            const sourceActorId = event.origin.kind === 'actor' ? event.origin.actorId : undefined;
            const sourceActor = sourceActorId === undefined
              ? undefined
              : run.initialSnapshot.entities.find((entity) => entity.kind === 'character' && entity.characterId === sourceActorId);
            if (sourceActor?.kind !== 'character' || sourceActor.entityId !== perception.sourceEntityId
              || perception.fictitiousAt !== event.fictitiousAt) {
              throw new Error('Experience no acredita percepción de un evento con origen válido');
            }
          } else if (perception.kind === 'testimony') {
            if (event.kind !== 'humanIntervention' || event.origin.kind !== 'human'
              || event.origin.participantId !== perception.sourceParticipantId
              || event.speakerDisplayName !== perception.speakerDisplayName
              || !event.effectiveAudience.includes(perception.recipientCharacterId)
              || event.channelId !== perception.channelId
              || canonicalJson(event.content) !== canonicalJson(perception.content)
              || perception.fictitiousAt !== event.fictitiousAt + event.durationMs) {
              throw new Error('Experience no acredita recepción efectiva del testimonio humano');
            }
          } else {
            throw new Error('La observación directa no requiere Experience de evento');
          }
          if (isExactDeliveredRetry) {
            if (priorMapping === undefined || priorMapping.experience_id !== frozen.envelope.experienceId) {
              throw new Error('Claim de entrega repetido con Experience distinta');
            }
            const priorExperienceValue = database.prepare(
              'SELECT canonical_payload,payload_hash FROM experiences WHERE experience_id=?',
            ).get(priorMapping.experience_id);
            if (priorExperienceValue === undefined) throw new Error('Experience entregada perdió su registro durable');
            const priorExperience = experienceRow.parse(priorExperienceValue);
            if (priorExperience.canonical_payload !== frozen.canonicalPayload || priorExperience.payload_hash !== frozen.payloadHash) {
              throw new Error('Claim de entrega repetido con payload de Experience distinto');
            }
            return 'existing';
          }
          if (priorMapping !== undefined && priorMapping.experience_id !== frozen.envelope.experienceId) {
            throw new Error('La percepción ya quedó asociada a otra Experience');
          }
          recordExperienceWithinTransaction(frozen);
          if (priorMapping === undefined) {
            database.prepare('INSERT INTO world_perception_experiences(perception_id,experience_id) VALUES(?,?)')
              .run(perception.id, frozen.envelope.experienceId);
          }
        }
        const update = database.prepare(`
          UPDATE world_deliveries SET state='delivered',failure_code=NULL,delivered_at=?
          WHERE perception_id=? AND state='delivering' AND claim_token=?
        `).run(Date.now(), request.perceptionId, request.claimToken);
        if (update.changes !== 1) throw new Error('Claim de entrega cambió durante el ack');
        if (row.origin_kind === 'humanIntervention' || database.prepare('SELECT perception_id FROM actor_turn_intents WHERE perception_id=?').get(row.perception_id) !== undefined) {
          const intent = database.prepare(`
            UPDATE actor_turn_intents SET state='queued'
            WHERE perception_id=? AND run_id=? AND actor_id=? AND world_seq=? AND state='awaitingDelivery'
          `).run(row.perception_id, row.run_id, row.actor_id, row.world_seq);
          if (intent.changes !== 1) throw new Error('La percepción no tiene una intención pendiente coherente');
        }
        return 'delivered';
      });
    },

    readQueuedActorTurnIntents(input: unknown) {
      const request = ActorTurnIntentQuerySchema.parse(input);
      return database.prepare(`
        SELECT i.run_id,i.actor_id,i.perception_id,i.world_seq,i.state,i.created_at,p.payload_json,p.payload_hash
        FROM actor_turn_intents i JOIN world_perceptions p ON p.perception_id=i.perception_id
        WHERE i.run_id=? AND i.actor_id=? AND i.state='queued'
          AND NOT EXISTS(SELECT 1 FROM actor_turn_job_inputs a WHERE a.perception_id=i.perception_id AND a.state IN('assigned','consumed'))
        ORDER BY i.world_seq,i.perception_id LIMIT ?
      `).all(request.runId, request.actorId, request.limit).map((value) => {
        const row = ActorTurnIntentRowSchema.parse(value);
        if (sha256(row.payload_json) !== row.payload_hash) throw new Error('Hash de percepción de intención no coincide');
        const perception = WorldPerceptionSchema.parse(parseStoredJson(row.payload_json));
        if (perception.id !== row.perception_id || perception.runId !== row.run_id
          || perception.recipientCharacterId !== row.actor_id || row.state !== 'queued') {
          throw new Error('Intención de turno no coincide con su percepción');
        }
        return Object.freeze({
          runId: row.run_id, actorId: row.actor_id, perceptionId: row.perception_id,
          worldSeq: row.world_seq, state: row.state, createdAt: row.created_at, perception,
        });
      });
    },

    /**
     * Durably coalesces queued, delivered and unassigned intentions for one actor.
     * A queued job can absorb later intentions only before its first claim; its pulse
     * and IDs never change. A running job leaves later intentions for the next pulse.
     */
    createPiOAuthJob(input:unknown){
      const request=PiOAuthJobCreateSchema.parse(input);const operation={principalId:request.principalId,idempotencyKey:request.idempotencyKey,kind:request.kind,requestHash:hashJson(request).hash};
      return transact(()=>{
        const replay=replayPiOAuthOperation(operation);if(replay!==undefined){const original=PiOAuthJobCreateResultSchema.parse(replay);return original.kind==='created'?PiOAuthJobCreateResultSchema.parse({kind:'existing',job:original.job}):original;}
        const timestamp=new Date().toISOString();const job=PiOAuthJobViewSchema.parse({jobId:randomUUID(),provider:'openai-codex',kind:request.kind,state:'queued',revision:0,createdAt:timestamp,updatedAt:timestamp,safeCode:null});
        const payload=hashJson(job);database.prepare('INSERT INTO pi_oauth_jobs VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)')
          .run(job.jobId,job.provider,job.kind,request.principalId,job.state,job.revision,job.createdAt,job.updatedAt,job.safeCode,payload.json,payload.hash);
        database.prepare('INSERT INTO pi_oauth_job_history VALUES(?,?,?,?)').run(job.jobId,0,payload.json,payload.hash);
        return recordPiOAuthOperation({...operation,result:PiOAuthJobCreateResultSchema.parse({kind:'created',job})});
      });
    },
    readPiOAuthJob(input:unknown){return piOAuthJobRow(PiOAuthJobLookupSchema.parse(input))?.job;},
    listPiOAuthJobs(input:unknown){const request=z.strictObject({principalId:z.string().trim().min(1).max(200),limit:counter.min(1).max(1000).default(100)}).parse(input);
      return database.prepare('SELECT job_id FROM pi_oauth_jobs WHERE principal_id=? ORDER BY created_at DESC,job_id LIMIT ?').all(request.principalId,request.limit)
        .map((value)=>{const job=piOAuthJobRow({jobId:z.strictObject({job_id:JobIdSchema}).parse(value).job_id});if(job===undefined)throw new Error('Job OAuth perdido');return job.job;});
    },
    readPiOAuthJobHistory(input:unknown){const request=PiOAuthJobLookupSchema.parse(input);return database.prepare('SELECT revision,payload_json,payload_hash FROM pi_oauth_job_history WHERE job_id=? ORDER BY revision').all(request.jobId)
      .map((value)=>{const row=z.strictObject({revision:RevisionSchema,payload_json:z.string(),payload_hash:HashSchema}).parse(value);const job=PiOAuthJobViewSchema.parse(parseStoredJson(row.payload_json));
        if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(job)!==row.payload_json||job.revision!==row.revision||job.jobId!==request.jobId)throw new Error('Historia OAuth alterada');return job;});
    },
    claimPiOAuthJob(input:unknown){const request=PiOAuthJobClaimSchema.parse(input);return transact(()=>{
      const current=piOAuthJobRow(request);if(current===undefined)return PiOAuthJobClaimResultSchema.parse({kind:'missing'});
      const terminal=!['queued','running','cancel-requested'].includes(current.job.state);if(terminal)return PiOAuthJobClaimResultSchema.parse({kind:'terminal',job:current.job});
      if(current.job.state==='running'||current.job.state==='cancel-requested'){
        if(current.row.owner_token===request.ownerToken&&current.row.claim_token===request.claimToken)return PiOAuthJobClaimResultSchema.parse({kind:'existing',job:current.job,lease:{ownerToken:request.ownerToken,claimToken:request.claimToken}});
        return PiOAuthJobClaimResultSchema.parse({kind:'busy'});
      }
      if(current.job.revision!==request.expectedRevision)return PiOAuthJobClaimResultSchema.parse({kind:'stale',job:current.job});
      if(database.prepare(`SELECT 1 FROM pi_oauth_jobs WHERE provider='openai-codex' AND state IN('running','cancel-requested') LIMIT 1`).get()!==undefined)return PiOAuthJobClaimResultSchema.parse({kind:'busy'});
      const lease={ownerToken:request.ownerToken,claimToken:request.claimToken};const job=writePiOAuthJob({current,state:'running',safeCode:null,lease});
      return PiOAuthJobClaimResultSchema.parse({kind:'claimed',job,lease});
    });},
    completePiOAuthJob(input:unknown){const request=PiOAuthJobCompletionSchema.parse(input);return transact(()=>{
      const current=piOAuthJobRow(request);if(current===undefined)return PiOAuthJobMutationResultSchema.parse({kind:'missing'});
      if(current.row.owner_token!==request.lease.ownerToken||current.row.claim_token!==request.lease.claimToken)throw new Error('Lease OAuth inválido');
      const safeCode=request.outcome==='canceled'?'user-canceled':request.safeCode;
      if(!['queued','running','cancel-requested'].includes(current.job.state))return PiOAuthJobMutationResultSchema.parse({kind:current.job.state===request.outcome&&current.job.safeCode===safeCode?'existing':'terminal',job:current.job});
      if(current.job.revision!==request.expectedRevision)return PiOAuthJobMutationResultSchema.parse({kind:'stale',job:current.job});
      if(current.job.state!=='running'&&current.job.state!=='cancel-requested')throw new Error('Job OAuth no reclamado');
      const job=writePiOAuthJob({current,state:request.outcome,safeCode});return PiOAuthJobMutationResultSchema.parse({kind:'updated',job});
    });},
    cancelPiOAuthJob(input:unknown){const request=PiOAuthJobCancelSchema.parse(input);const operation={principalId:request.principalId,idempotencyKey:request.idempotencyKey,kind:'cancel',requestHash:hashJson(request).hash} satisfies Parameters<typeof replayPiOAuthOperation>[0];
      return transact(()=>{
        const replay=replayPiOAuthOperation(operation);if(replay!==undefined)return PiOAuthJobMutationResultSchema.parse(replay);
        const current=piOAuthJobRow(request);let result:z.infer<typeof PiOAuthJobMutationResultSchema>;
        if(current===undefined||current.row.principal_id!==request.principalId)result=PiOAuthJobMutationResultSchema.parse({kind:'missing'});
        else if(current.job.revision!==request.expectedRevision)result=PiOAuthJobMutationResultSchema.parse({kind:'stale',job:current.job});
        else if(!['queued','running','cancel-requested'].includes(current.job.state))result=PiOAuthJobMutationResultSchema.parse({kind:'terminal',job:current.job});
        else if(current.job.state==='cancel-requested')result=PiOAuthJobMutationResultSchema.parse({kind:'existing',job:current.job});
        else{const state=current.job.state==='queued'?'canceled':'cancel-requested';const job=writePiOAuthJob({current,state,safeCode:state==='canceled'?'user-canceled':null});result=PiOAuthJobMutationResultSchema.parse({kind:'updated',job});}
        return recordPiOAuthOperation({...operation,result});
      });
    },
    recoverAbandonedPiOAuthJobs(input:unknown){const request=ActorTurnJobRecoverySchema.parse(input);return transact(()=>{
      const jobs=database.prepare(`SELECT job_id FROM pi_oauth_jobs WHERE state='queued' OR (state IN('running','cancel-requested') AND owner_token<>?)`).all(request.ownerToken);
      for(const value of jobs){const job=piOAuthJobRow({jobId:z.strictObject({job_id:JobIdSchema}).parse(value).job_id});if(job===undefined)throw new Error('Job OAuth perdido durante recovery');writePiOAuthJob({current:job,state:'interrupted',safeCode:'host-interrupted'});}
      return jobs.length;
    });},

    createPiAccessJob(input:unknown){
      const request=PiAccessJobCreateSchema.parse(input);const operation={principalId:request.principalId,idempotencyKey:request.idempotencyKey,kind:'start',requestHash:hashJson(request).hash} satisfies Parameters<typeof replayPiAccessOperation>[0];
      return transact(()=>{
        const replay=replayPiAccessOperation(operation);if(replay!==undefined){const original=PiAccessJobCreateResultSchema.parse(replay);return original.kind==='created'?PiAccessJobCreateResultSchema.parse({kind:'existing',job:original.job}):original;}
        const timestamp=new Date().toISOString();const profile=PiAccessJobViewSchema.shape.profile.parse(request.profile);
        const job=PiAccessJobViewSchema.parse({kind:'pi-access-job',jobId:randomUUID(),provider:profile.provider,profile,state:'queued',revision:0,
          createdAt:timestamp,updatedAt:timestamp,resultKind:null,safeCode:null,passedResult:null});
        const profilePayload=hashJson(profile);const payload=hashJson(job);
        database.prepare(`INSERT INTO pi_access_jobs(job_id,principal_id,provider,profile_json,profile_hash,state,revision,created_at,updated_at,result_kind,safe_code,
          owner_token,claim_token,payload_json,payload_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)`)
          .run(job.jobId,request.principalId,job.provider,profilePayload.json,profilePayload.hash,job.state,job.revision,job.createdAt,job.updatedAt,job.resultKind,job.safeCode,payload.json,payload.hash);
        database.prepare('INSERT INTO pi_access_job_history VALUES(?,?,?,?)').run(job.jobId,0,payload.json,payload.hash);
        return recordPiAccessOperation({...operation,result:PiAccessJobCreateResultSchema.parse({kind:'created',job})});
      });
    },
    readPiAccessJob(input:unknown){return piAccessJobRow(PiAccessJobLookupSchema.parse(input))?.job;},
    listPiAccessJobs(input:unknown){const request=PiAccessJobListSchema.parse(input);
      return database.prepare('SELECT job_id FROM pi_access_jobs WHERE principal_id=? ORDER BY created_at DESC,job_id LIMIT ? OFFSET ?').all(request.principalId,request.limit,request.offset)
        .map((value)=>{const job=piAccessJobRow({jobId:z.strictObject({job_id:JobIdSchema}).parse(value).job_id});if(job===undefined)throw new Error('Job access-check perdido');return job.job;});
    },
    readPiAccessJobHistory(input:unknown){const request=PiAccessJobLookupSchema.parse(input);return database.prepare('SELECT revision,payload_json,payload_hash FROM pi_access_job_history WHERE job_id=? ORDER BY revision').all(request.jobId)
      .map((value)=>{const row=z.strictObject({revision:RevisionSchema,payload_json:z.string(),payload_hash:HashSchema}).parse(value);const job=PiAccessJobViewSchema.parse(parseStoredJson(row.payload_json));
        if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(job)!==row.payload_json||job.revision!==row.revision||job.jobId!==request.jobId)throw new Error('Historia access-check alterada');return job;});
    },
    claimPiAccessJob(input:unknown){const request=PiAccessJobClaimSchema.parse(input);return transact(()=>{
      const current=piAccessJobRow(request);if(current===undefined)return PiAccessJobClaimResultSchema.parse({kind:'missing'});
      if(!['queued','running','cancel-requested'].includes(current.job.state))return PiAccessJobClaimResultSchema.parse({kind:'terminal',job:current.job});
      if(current.job.state==='running'||current.job.state==='cancel-requested'){
        if(current.row.owner_token===request.ownerToken&&current.row.claim_token===request.claimToken)return PiAccessJobClaimResultSchema.parse({kind:'existing',job:current.job,lease:{ownerToken:request.ownerToken,claimToken:request.claimToken}});
        return PiAccessJobClaimResultSchema.parse({kind:'busy'});
      }
      if(current.job.revision!==request.expectedRevision)return PiAccessJobClaimResultSchema.parse({kind:'stale',job:current.job});
      if(database.prepare("SELECT 1 FROM pi_access_jobs WHERE provider=? AND state IN('running','cancel-requested') LIMIT 1").get(current.job.provider)!==undefined)return PiAccessJobClaimResultSchema.parse({kind:'busy'});
      const lease={ownerToken:request.ownerToken,claimToken:request.claimToken};
      const job=writePiAccessJob({current,state:'running',resultKind:null,safeCode:null,passedResult:null,lease});
      return PiAccessJobClaimResultSchema.parse({kind:'claimed',job,lease});
    });},
    completePiAccessJob(input:unknown){const request=PiAccessJobCompletionSchema.parse(input);return transact(()=>{
      const current=piAccessJobRow(request);if(current===undefined)return PiAccessJobMutationResultSchema.parse({kind:'missing'});
      const result=PiAccessCheckStoredResultSchema.parse(request.result);
      if(!['queued','running','cancel-requested'].includes(current.job.state)){
        const stored=readPiAccessResult({jobId:request.jobId});
        if(stored===undefined)return PiAccessJobMutationResultSchema.parse({kind:'terminal',job:current.job});
        const proof=piAccessCompletionProof({...request,result});
        const matches=stored.row.completion_revision===request.expectedRevision&&stored.row.completion_lease_hash===proof.leaseHash
          &&stored.row.completion_request_hash===proof.requestHash;
        return PiAccessJobMutationResultSchema.parse({kind:matches?'existing':'terminal',job:current.job});
      }
      if(current.row.owner_token!==request.lease.ownerToken||current.row.claim_token!==request.lease.claimToken)throw new Error('Lease del access-check inválido');
      if(result.provider!==current.job.provider||canonicalJson(result.requestedProfile)!==canonicalJson(current.profile)
        ||result.profileFingerprint!==fingerprintInferenceProfile(current.profile))throw new Error('Resultado de access-check no coincide con el perfil reclamado');
      if(result.kind==='passed'){
        const effective=result.effectiveProfile;
        if(effective.provider!==current.profile.provider||effective.api!==current.profile.api||effective.model!==current.profile.model
          ||(effective.providerThinkingLevel!==null&&effective.providerThinkingLevel!==current.profile.reasoningEffort))throw new Error('Perfil efectivo del SDK no coincide con el perfil reclamado');
      }
      if(current.job.revision!==request.expectedRevision)return PiAccessJobMutationResultSchema.parse({kind:'stale',job:current.job});
      if(current.job.state!=='running'&&current.job.state!=='cancel-requested')throw new Error('Job de access-check no reclamado');
      const state=piAccessJobStateForResult(result);const safeCode=piAccessJobSafeCodeForResult(result);
      const job=writePiAccessJob({current,state,resultKind:result.kind,safeCode,passedResult:piAccessPassedResult(result),lease:null});
      const resultPayload=hashJson(result);
      const proof=piAccessCompletionProof({...request,result});
      database.prepare(`INSERT INTO pi_access_job_results(job_id,provider,profile_fingerprint,account_fingerprint,outcome,checked_at,expires_at,result_json,result_hash,
        completion_revision,completion_lease_hash,completion_request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(job.jobId,result.provider,result.profileFingerprint,result.accountFingerprint,result.kind,request.checkedAt,request.expiresAt,resultPayload.json,resultPayload.hash,
          request.expectedRevision,proof.leaseHash,proof.requestHash);
      return PiAccessJobMutationResultSchema.parse({kind:'updated',job});
    });},
    cancelPiAccessJob(input:unknown){const request=PiAccessJobCancelSchema.parse(input);const operation={principalId:request.principalId,idempotencyKey:request.idempotencyKey,kind:'cancel',requestHash:hashJson(request).hash} satisfies Parameters<typeof replayPiAccessOperation>[0];
      return transact(()=>{
        const replay=replayPiAccessOperation(operation);if(replay!==undefined)return PiAccessJobMutationResultSchema.parse(replay);
        const current=piAccessJobRow(request);let result:z.infer<typeof PiAccessJobMutationResultSchema>;
        if(current===undefined||current.row.principal_id!==request.principalId)result=PiAccessJobMutationResultSchema.parse({kind:'missing'});
        else if(current.job.revision!==request.expectedRevision)result=PiAccessJobMutationResultSchema.parse({kind:'stale',job:current.job});
        else if(!['queued','running','cancel-requested'].includes(current.job.state))result=PiAccessJobMutationResultSchema.parse({kind:'terminal',job:current.job});
        else if(current.job.state==='cancel-requested')result=PiAccessJobMutationResultSchema.parse({kind:'existing',job:current.job});
        else if(current.job.state==='queued'){
          const job=writePiAccessJob({current,state:'canceled',resultKind:null,safeCode:'user-canceled',passedResult:null,lease:null});
          result=PiAccessJobMutationResultSchema.parse({kind:'updated',job});
        }else{
          const job=writePiAccessJob({current,state:'cancel-requested',resultKind:null,safeCode:null,passedResult:null});
          result=PiAccessJobMutationResultSchema.parse({kind:'updated',job});
        }
        return recordPiAccessOperation({...operation,result});
      });
    },
    recoverAbandonedPiAccessJobs(input:unknown){const request=ActorTurnJobRecoverySchema.parse(input);return transact(()=>{
      const jobs=database.prepare(`SELECT job_id FROM pi_access_jobs WHERE state='queued' OR (state IN('running','cancel-requested') AND owner_token<>?)`).all(request.ownerToken);
      for(const value of jobs){const current=piAccessJobRow({jobId:z.strictObject({job_id:JobIdSchema}).parse(value).job_id});if(current===undefined)throw new Error('Job access-check perdido durante recovery');
        writePiAccessJob({current,state:'interrupted',resultKind:null,safeCode:'host-interrupted',passedResult:null,lease:null});}
      return jobs.length;
    });},
    readLatestAccessReceipt(input:unknown){const request=PiAccessReceiptLookupSchema.parse(input);
      const value=database.prepare(`SELECT job_id FROM pi_access_job_results WHERE provider=? AND profile_fingerprint=? AND account_fingerprint=? AND outcome IN('passed','failed')
        ORDER BY checked_at DESC,rowid DESC LIMIT 1`).get(request.provider,request.profileFingerprint,request.accountFingerprint);
      if(value===undefined)return PiAccessReceiptReadSchema.parse({kind:'missing'});
      const stored=readPiAccessResult({jobId:z.strictObject({job_id:JobIdSchema}).parse(value).job_id});if(stored===undefined)throw new Error('Recibo de access-check perdido');
      return PiAccessReceiptReadSchema.parse({kind:'receipt',jobId:z.strictObject({job_id:JobIdSchema}).parse(value).job_id,resultKind:stored.result.kind,provider:stored.result.provider,
        profileFingerprint:stored.result.profileFingerprint,accountFingerprint:stored.result.accountFingerprint,checkedAt:stored.row.checked_at,
        expiresAt:stored.row.expires_at,code:stored.result.kind==='failed'?stored.result.code:null});
    },
    readLatestAccessOutcome(input:unknown){const request=PiAccessLatestOutcomeLookupSchema.parse(input);
      const value=database.prepare(`SELECT job_id FROM pi_access_job_results WHERE provider=? AND profile_fingerprint=? ORDER BY rowid DESC LIMIT 1`)
        .get(request.provider,request.profileFingerprint);
      if(value===undefined)return undefined;
      const jobId=z.strictObject({job_id:JobIdSchema}).parse(value).job_id;
      const stored=readPiAccessResult({jobId});const current=piAccessJobRow({jobId});
      if(stored===undefined||current===undefined)throw new Error('Resultado más reciente del access-check perdido');
      if(stored.result.provider!==request.provider||stored.result.profileFingerprint!==request.profileFingerprint
        ||current.job.provider!==request.provider||current.job.resultKind!==stored.result.kind
        ||fingerprintInferenceProfile(current.profile)!==request.profileFingerprint)throw new Error('Resultado más reciente del access-check no coincide con su job');
      return current.job;
    },

    createRunPreflightJob(input:unknown){
      const request=RunPreflightJobStartSchema.parse(input);const operation={principalId:request.principalId,idempotencyKey:request.idempotencyKey,kind:'start',requestHash:hashJson(request).hash} satisfies Parameters<typeof replayRunPreflightOperation>[0];
      return transact(()=>{
        const replay=replayRunPreflightOperation(operation);if(replay!==undefined){const original=RunPreflightJobStartResultSchema.parse(replay);return original.kind==='created'?RunPreflightJobStartResultSchema.parse({kind:'existing',job:original.job}):original;}
        const worldValue=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
        let result:z.infer<typeof RunPreflightJobStartResultSchema>;
        if(worldValue===undefined)result=RunPreflightJobStartResultSchema.parse({kind:'missing'});
        else{
          const run=parseWorldRun(worldValue);
          if(!['ready','paused','stopped'].includes(run.row.lifecycle))result=RunPreflightJobStartResultSchema.parse({kind:'invalidLifecycle',lifecycle:run.row.lifecycle});
          else if(run.row.config_revision!==request.expectedConfigurationRevision||run.row.world_revision!==request.expectedWorldRevision)
            result=RunPreflightJobStartResultSchema.parse({kind:'stale',currentConfigurationRevision:run.row.config_revision,currentWorldRevision:run.row.world_revision});
          else{
            const parsed=ReadyRunConfigurationSchema.safeParse(run.configuration);
            if(!parsed.success||parsed.data.runId!==request.runId||parsed.data.configRevision!==run.row.config_revision
              ||hashJson(parsed.data).hash!==run.row.configuration_hash){
              result=RunPreflightJobStartResultSchema.parse({kind:'invalidConfiguration'});
            }else{
              const configuration=readyConfigurationAtSnapshot(parsed.data,run.snapshot);const profile=runInferenceProfile({...run,configuration});
              const profileFingerprint=fingerprintInferenceProfile(profile);const timestamp=new Date().toISOString();const job=RunPreflightJobViewSchema.parse({
                kind:'run-preflight-job',jobId:JobIdSchema.parse(randomUUID()),runId:request.runId,state:'queued',revision:0,createdAt:timestamp,updatedAt:timestamp,
                configurationRevision:run.row.config_revision,worldRevision:run.row.world_revision,worldSeq:run.row.last_seq,
                fictitiousAt:run.snapshot.clock.instant,resultKind:null,safeCode:null,
              });
              const payload=hashJson(job);const configurationJson=canonicalJson(configuration);
              database.prepare(`INSERT INTO run_preflight_jobs(job_id,run_id,principal_id,state,revision,created_at,updated_at,configuration_revision,configuration_hash,
                configuration_json,world_revision,world_seq,fictitious_at,provider,profile_fingerprint,result_kind,safe_code,owner_token,claim_token,payload_json,payload_hash,configuration_payload_hash,original_configuration_json)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,?,?,?,?)`)
                .run(job.jobId,request.runId,request.principalId,job.state,job.revision,job.createdAt,job.updatedAt,job.configurationRevision,
                  run.row.configuration_hash,configurationJson,job.worldRevision,job.worldSeq,job.fictitiousAt,profile.provider,profileFingerprint,payload.json,payload.hash,sha256(configurationJson),run.row.configuration_json);
              database.prepare('INSERT INTO run_preflight_job_history VALUES(?,?,?,?)').run(job.jobId,0,payload.json,payload.hash);
              result=RunPreflightJobStartResultSchema.parse({kind:'created',job});
            }
          }
        }
        return recordRunPreflightOperation({...operation,result});
      });
    },
    readRunPreflightJob(input:unknown){
      const request=RunPreflightJobLookupSchema.parse(input);const document=runPreflightJobDocument(request);
      return document===undefined?{kind:'missing' as const}:{kind:'found' as const,document};
    },
    readRunPreflightJobEvidence(input:unknown){
      const request=RunPreflightJobEvidenceLookupSchema.parse(input);const current=runPreflightJobRow(request);
      if(current===undefined||current.job.state!=='completed')return RunPreflightJobEvidenceReadSchema.parse({kind:'missing'});
      const stored=readRunPreflightJobResult(request);
      if(stored===undefined)throw new Error('Job completado sin evidencia privada');
      return RunPreflightJobEvidenceReadSchema.parse({kind:'found',evidence:stored.evidence});
    },
    listRunPreflightJobs(input:unknown){
      const request=RunPreflightJobListSchema.parse(input);
      const total=z.strictObject({count:counter}).parse(database.prepare('SELECT COUNT(*) AS count FROM run_preflight_jobs WHERE run_id=?').get(request.runId)).count;
      const ids=database.prepare('SELECT job_id FROM run_preflight_jobs WHERE run_id=? ORDER BY created_at DESC,job_id DESC LIMIT ? OFFSET ?').all(request.runId,request.limit,request.offset)
        .map((value)=>z.strictObject({job_id:JobIdSchema}).parse(value).job_id);
      const items=ids.map((jobId)=>{
        const document=runPreflightJobDocument({runId:request.runId,jobId});if(document===undefined)throw new Error('Job de preflight desaparecido');return document;
      });
      return RunPreflightJobPageSchema.parse({kind:'run-preflight-job-page',items,limit:request.limit,offset:request.offset,truncated:request.offset+items.length<total});
    },
    readRunPreflightJobHistory(input:unknown){
      const request=RunPreflightJobLookupSchema.parse(input);if(runPreflightJobRow(request)===undefined)return [];
      return database.prepare('SELECT revision,payload_json,payload_hash FROM run_preflight_job_history WHERE job_id=? ORDER BY revision').all(request.jobId)
        .map((value)=>{const row=z.strictObject({revision:RevisionSchema,payload_json:z.string(),payload_hash:HashSchema}).parse(value);const job=RunPreflightJobViewSchema.parse(parseStoredJson(row.payload_json));
          if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(job)!==row.payload_json||job.revision!==row.revision||job.jobId!==request.jobId)throw new Error('Historia de preflight alterada');return job;});
    },
    claimRunPreflightJob(input:unknown){
      const request=RunPreflightJobClaimSchema.parse(input);return transact(()=>{
        const current=runPreflightJobRow(request);if(current===undefined)return RunPreflightJobClaimResultSchema.parse({kind:'missing'});
        if(!['queued','running','cancel-requested'].includes(current.job.state))return RunPreflightJobClaimResultSchema.parse({kind:'terminal',job:current.job});
        if(current.job.state==='running'||current.job.state==='cancel-requested'){
          if(current.row.owner_token===request.ownerToken&&current.row.claim_token===request.claimToken)return RunPreflightJobClaimResultSchema.parse({kind:'existing',job:current.job,lease:{ownerToken:request.ownerToken,claimToken:request.claimToken}});
          return RunPreflightJobClaimResultSchema.parse({kind:'busy'});
        }
        if(current.job.revision!==request.expectedRevision)return RunPreflightJobClaimResultSchema.parse({kind:'stale',job:current.job});
        if(database.prepare("SELECT 1 FROM run_preflight_jobs WHERE run_id=? AND state IN('running','cancel-requested') LIMIT 1").get(request.runId)!==undefined)
          return RunPreflightJobClaimResultSchema.parse({kind:'busy'});
        const lease={ownerToken:request.ownerToken,claimToken:request.claimToken};const job=writeRunPreflightJob({current,state:'running',resultKind:null,safeCode:null,lease});
        return RunPreflightJobClaimResultSchema.parse({kind:'claimed',job,lease});
      });
    },
    readRunPreflightJobInput(input:unknown){
      const request=z.strictObject({runId:RunIdSchema,jobId:JobIdSchema,lease:RunPreflightJobLeaseSchema}).parse(input);
      const current=runPreflightJobRow(request);if(current===undefined)return RunPreflightJobInputResultSchema.parse({kind:'missing'});
      if(!['running','cancel-requested'].includes(current.job.state)||current.row.owner_token!==request.lease.ownerToken||current.row.claim_token!==request.lease.claimToken)
        return RunPreflightJobInputResultSchema.parse({kind:'stale',job:current.job});
      return RunPreflightJobInputResultSchema.parse({kind:'found',job:current.job,configuration:current.configuration,
        fence:{configurationRevision:current.job.configurationRevision,configurationHash:current.row.configuration_hash,
          worldRevision:current.job.worldRevision,worldSeq:current.job.worldSeq,fictitiousAt:current.job.fictitiousAt},lease:request.lease});
    },
    completeRunPreflightJob(input:unknown){
      const request=RunPreflightJobCompletionSchema.parse(input);return transact(()=>{
        const current=runPreflightJobRow({runId:request.runId,jobId:request.jobId});if(current===undefined)return RunPreflightJobMutationResultSchema.parse({kind:'missing'});
        const evaluation=RunPreflightEvaluationSchema.parse(request.evaluation);
        const proof=runPreflightCompletionProof({...request,evaluation});
        if(!['queued','running','cancel-requested'].includes(current.job.state)){
          const stored=readRunPreflightJobResult({runId:request.runId,jobId:request.jobId});
          if(stored===undefined)return RunPreflightJobMutationResultSchema.parse({kind:'terminal',job:current.job});
          const matches=stored.row.completion_revision===request.expectedRevision&&stored.row.completion_lease_hash===proof.leaseHash
            &&stored.row.completion_request_hash===proof.requestHash;
          return RunPreflightJobMutationResultSchema.parse({kind:matches?'existing':'terminal',job:current.job});
        }
        if(current.row.owner_token!==request.lease.ownerToken||current.row.claim_token!==request.lease.claimToken)throw new Error('Lease de preflight inválido');
        if(current.job.revision!==request.expectedRevision)return RunPreflightJobMutationResultSchema.parse({kind:'stale',job:current.job});
        if(current.job.state==='queued')throw new Error('El preflight debe reclamarse antes de completar');
        if(evaluation.fence.configurationRevision!==current.job.configurationRevision||evaluation.fence.configurationHash!==current.row.configuration_hash
          ||evaluation.fence.worldRevision!==current.job.worldRevision||evaluation.fence.worldSeq!==current.job.worldSeq
          ||evaluation.fence.fictitiousAt!==current.job.fictitiousAt)throw new Error('La evaluación no corresponde al corte Ready congelado');
        if(evaluation.evidence.provider!==null&&evaluation.evidence.provider!==current.row.provider)throw new Error('La evaluación usa otro proveedor');
        if(evaluation.evidence.profileFingerprint!==null&&evaluation.evidence.profileFingerprint!==current.row.profile_fingerprint)throw new Error('La evaluación usa otro perfil');
        if(evaluation.evidence.accessReceipt!==null){
          const receipt=evaluation.evidence.accessReceipt;const access=readPiAccessResult({jobId:receipt.jobId});
          if(access===undefined||access.result.kind!==receipt.resultKind||access.result.provider!==receipt.provider
            ||access.result.profileFingerprint!==receipt.profileFingerprint||access.result.accountFingerprint!==receipt.accountFingerprint
            ||access.row.checked_at!==receipt.checkedAt||access.row.expires_at!==receipt.expiresAt
            ||Date.parse(receipt.checkedAt)>Date.parse(evaluation.result.checkedAt)
            ||Date.parse(evaluation.result.checkedAt)>=Date.parse(receipt.expiresAt))throw new Error('El recibo de acceso no valida el resultado de preflight');
        }
        if(current.job.state==='cancel-requested'){
          const job=writeRunPreflightJob({current,state:'canceled',resultKind:null,safeCode:'user-canceled',lease:null});
          return RunPreflightJobMutationResultSchema.parse({kind:'updated',job});
        }
        const job=writeRunPreflightJob({current,state:'completed',resultKind:evaluation.result.kind,safeCode:null,lease:null});
        const resultPayload=hashJson(evaluation.result);const evidencePayload=hashJson(evaluation.evidence);
        database.prepare(`INSERT INTO run_preflight_job_results(job_id,result_json,result_hash,evidence_json,evidence_hash,completion_revision,completion_lease_hash,completion_request_hash)
          VALUES(?,?,?,?,?,?,?,?)`).run(job.jobId,resultPayload.json,resultPayload.hash,evidencePayload.json,evidencePayload.hash,request.expectedRevision,proof.leaseHash,proof.requestHash);
        return RunPreflightJobMutationResultSchema.parse({kind:'updated',job});
      });
    },
    failRunPreflightJob(input:unknown){
      const request=RunPreflightJobFailureSchema.parse(input);return transact(()=>{
        const current=runPreflightJobRow({runId:request.runId,jobId:request.jobId});if(current===undefined)return RunPreflightJobMutationResultSchema.parse({kind:'missing'});
        if(!['queued','running','cancel-requested'].includes(current.job.state))return RunPreflightJobMutationResultSchema.parse({kind:'terminal',job:current.job});
        if(current.row.owner_token!==request.lease.ownerToken||current.row.claim_token!==request.lease.claimToken)throw new Error('Lease de preflight inválido');
        if(current.job.revision!==request.expectedRevision)return RunPreflightJobMutationResultSchema.parse({kind:'stale',job:current.job});
        if(current.job.state==='queued')throw new Error('El preflight debe reclamarse antes de fallar');
        const canceled=current.job.state==='cancel-requested';const job=writeRunPreflightJob({current,state:canceled?'canceled':'failed',resultKind:null,
          safeCode:canceled?'user-canceled':request.safeCode,lease:null});
        return RunPreflightJobMutationResultSchema.parse({kind:'updated',job});
      });
    },
    cancelRunPreflightJob(input:unknown){
      const request=RunPreflightJobCancelSchema.parse(input);const operation={principalId:request.principalId,idempotencyKey:request.idempotencyKey,kind:'cancel',requestHash:hashJson(request).hash} satisfies Parameters<typeof replayRunPreflightOperation>[0];
      return transact(()=>{
        const replay=replayRunPreflightOperation(operation);if(replay!==undefined)return RunPreflightJobMutationResultSchema.parse(replay);
        const current=runPreflightJobRow({runId:request.runId,jobId:request.jobId});let result:z.infer<typeof RunPreflightJobMutationResultSchema>;
        if(current===undefined||current.row.principal_id!==request.principalId)result=RunPreflightJobMutationResultSchema.parse({kind:'missing'});
        else if(current.job.revision!==request.expectedRevision)result=RunPreflightJobMutationResultSchema.parse({kind:'stale',job:current.job});
        else if(!['queued','running','cancel-requested'].includes(current.job.state))result=RunPreflightJobMutationResultSchema.parse({kind:'terminal',job:current.job});
        else if(current.job.state==='cancel-requested')result=RunPreflightJobMutationResultSchema.parse({kind:'existing',job:current.job});
        else{const state=current.job.state==='queued'?'canceled':'cancel-requested';const job=writeRunPreflightJob({current,state,resultKind:null,safeCode:state==='canceled'?'user-canceled':null,...(state==='canceled'?{lease:null}:{})});
          result=RunPreflightJobMutationResultSchema.parse({kind:'updated',job});}
        return recordRunPreflightOperation({...operation,result});
      });
    },
    recoverAbandonedRunPreflightJobs(input:unknown){
      const request=RunPreflightJobRecoverySchema.parse(input);return transact(()=>{
        const values=database.prepare(`SELECT run_id,job_id FROM run_preflight_jobs WHERE state='queued' OR (state IN('running','cancel-requested') AND owner_token<>?)`).all(request.ownerToken);
        for(const value of values){const key=z.strictObject({run_id:RunIdSchema,job_id:JobIdSchema}).parse(value);const current=runPreflightJobRow({runId:key.run_id,jobId:key.job_id});
          if(current===undefined)throw new Error('Job de preflight perdido durante recovery');writeRunPreflightJob({current,state:'interrupted',resultKind:null,safeCode:'host-interrupted',lease:null});}
        return values.length;
      });
    },

    createRunConfigurationDraft(input:unknown){
      const request=RunDraftCreateSchema.parse(input);const operation={principalId:request.principalId,idempotencyKey:request.idempotencyKey,kind:'create',requestHash:hashJson(request).hash} satisfies Parameters<typeof replayRunDraftOperation>[0];
      return transact(()=>{
        const replay=replayRunDraftOperation(operation);if(replay!==undefined)return RunDraftMutationResultSchema.parse(replay);
        const recordedAt=new Date().toISOString();const runId=RunIdSchema.parse(randomUUID());const revision=RevisionSchema.parse(0);
        const draft=applyRunDraftPatch(createEmptyRunConfigurationDraft({runId,revision}),request.patch,request.principalId,recordedAt,revision);
        database.prepare('INSERT INTO run_configuration_drafts VALUES(?,?,?,?)').run(runId,revision,recordedAt,recordedAt);
        appendRunDraftHistory({draft,principalId:request.principalId,recordedAt});
        return recordRunDraftOperation({...operation,recordedAt,result:RunDraftMutationResultSchema.parse({kind:'created',draft})});
      });
    },
    updateRunConfigurationDraft(input:unknown){
      const request=RunDraftUpdateSchema.parse(input);const operation={principalId:request.principalId,idempotencyKey:request.idempotencyKey,kind:'update',requestHash:hashJson(request).hash} satisfies Parameters<typeof replayRunDraftOperation>[0];
      return transact(()=>{
        const replay=replayRunDraftOperation(operation);if(replay!==undefined)return RunDraftMutationResultSchema.parse(replay);
        const recordedAt=new Date().toISOString();const entry=readRunDraft({runId:request.runId});
        if(entry===undefined)return recordRunDraftOperation({...operation,recordedAt,result:RunDraftMutationResultSchema.parse({kind:'missing'})});
        const worldValue=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
        const world=worldValue===undefined?undefined:parseWorldRun(worldValue);
        if(world!==undefined&&identityPromotedConfiguration(request.runId))return recordRunDraftOperation({...operation,recordedAt,result:RunDraftMutationResultSchema.parse({kind:'readonly',reason:'identity-promoted'})});
        if(world!==undefined&&(ReadyRunConfigurationSchema.safeParse(world.configuration).data?.forkOrigin!==undefined||database.prepare('SELECT 1 FROM fork_dramatic_seeds WHERE run_id=?').get(request.runId)!==undefined))
          return recordRunDraftOperation({...operation,recordedAt,result:RunDraftMutationResultSchema.parse({kind:'readonly',reason:'fork-published'})});
        if(world!==undefined){const lifecycle=world.row.lifecycle;
          if(lifecycle!=='draft'&&lifecycle!=='ready')return recordRunDraftOperation({...operation,recordedAt,result:RunDraftMutationResultSchema.parse({kind:'invalidLifecycle',lifecycle})});}
        if(entry.draft.revision!==request.expectedRevision)return recordRunDraftOperation({...operation,recordedAt,result:RunDraftMutationResultSchema.parse({kind:'conflict',currentRevision:entry.draft.revision})});
        const revision=RevisionSchema.parse(request.expectedRevision+1);const draft=applyRunDraftPatch(entry.draft,request.patch,request.principalId,recordedAt,revision);
        const changed=database.prepare('UPDATE run_configuration_drafts SET revision=?,updated_at=? WHERE run_id=? AND revision=?').run(revision,recordedAt,request.runId,request.expectedRevision);
        if(changed.changes!==1)throw new Error('CAS de borrador cambió durante la transacción');
        if(world!==undefined){
          if(world.row.config_revision!==entry.draft.revision)throw new Error('Revisión World/configuración no coincide con el borrador editable');
          const payload=hashJson(draft);
          const invalidated=database.prepare(`UPDATE world_runs SET lifecycle='draft',config_revision=?,configuration_json=?,configuration_hash=?,updated_at=?
            WHERE run_id=? AND config_revision=? AND lifecycle IN('draft','ready')`).run(revision,payload.json,payload.hash,Date.now(),request.runId,world.row.config_revision);
          if(invalidated.changes!==1)throw new Error('CAS de configuración World cambió al invalidar Ready');
        }
        appendRunDraftHistory({draft,principalId:request.principalId,recordedAt});
        return recordRunDraftOperation({...operation,recordedAt,result:RunDraftMutationResultSchema.parse({kind:'stored',draft})});
      });
    },
    validateRunConfigurationDraft(input:unknown){
      const request=RunDraftValidateSchema.parse(input);const operation={principalId:request.principalId,idempotencyKey:request.idempotencyKey,kind:'validate',requestHash:hashJson(request).hash} satisfies Parameters<typeof replayRunDraftOperation>[0];
      return transact(()=>{
        const replay=replayRunDraftOperation(operation);if(replay!==undefined)return RunDraftValidationResultSchema.parse(replay);
        const recordedAt=new Date().toISOString();const entry=readRunDraft({runId:request.runId});
        if(entry===undefined)return recordRunDraftOperation({...operation,recordedAt,result:RunDraftValidationResultSchema.parse({kind:'missing'})});
        const worldValue=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);const world=worldValue===undefined?undefined:parseWorldRun(worldValue);
        if(world!==undefined&&identityPromotedConfiguration(request.runId))return recordRunDraftOperation({...operation,recordedAt,result:RunDraftValidationResultSchema.parse({kind:'readonly',reason:'identity-promoted'})});
        if(entry.draft.revision!==request.expectedRevision)return recordRunDraftOperation({...operation,recordedAt,result:RunDraftValidationResultSchema.parse({kind:'conflict',currentRevision:entry.draft.revision})});
        if(world!==undefined&&world.row.lifecycle!=='draft'&&world.row.lifecycle!=='ready')return recordRunDraftOperation({...operation,recordedAt,result:RunDraftValidationResultSchema.parse({kind:'invalidLifecycle',lifecycle:world.row.lifecycle})});
        if(world!==undefined&&(ReadyRunConfigurationSchema.safeParse(world.configuration).data?.forkOrigin!==undefined||database.prepare('SELECT 1 FROM fork_dramatic_seeds WHERE run_id=?').get(request.runId)!==undefined))
          return recordRunDraftOperation({...operation,recordedAt,result:RunDraftValidationResultSchema.parse({kind:'readonly',reason:'fork-published'})});
        const validated=validateRunConfiguration({draft:entry.draft});
        let result:z.infer<typeof RunDraftValidationResultSchema>;
        if(validated.kind!=='ready')result=RunDraftValidationResultSchema.parse({kind:validated.kind,runId:request.runId,revision:entry.draft.revision,issues:validated.issues});
        else{
          const configuration=validated.configuration;
          const alreadySame=world!==undefined&&world.row.config_revision===configuration.configRevision&&world.row.configuration_hash===hashJson(configuration).hash&&world.row.lifecycle==='ready';
          const activity=world!==undefined&&!alreadySame&&database.prepare(`SELECT 1 FROM (
            SELECT run_id FROM world_commits UNION ALL SELECT run_id FROM world_events UNION ALL SELECT run_id FROM world_perceptions
            UNION ALL SELECT run_id FROM world_proposals UNION ALL SELECT run_id FROM world_resolutions UNION ALL SELECT run_id FROM human_intervention_receipts
            UNION ALL SELECT run_id FROM actor_turn_jobs UNION ALL SELECT run_id FROM actor_pi_sessions UNION ALL SELECT run_id FROM actor_pi_candidates
            UNION ALL SELECT run_id FROM experiences UNION ALL SELECT run_id FROM request_reservations
            UNION ALL SELECT run_id FROM actor_knowledge WHERE knowledge_revision>0
            UNION ALL SELECT e.run_id FROM memory_outbox o JOIN experiences e ON e.experience_id=o.experience_id
            UNION ALL SELECT e.run_id FROM memory_receipts r JOIN experiences e ON e.experience_id=r.experience_id
          ) WHERE run_id=? LIMIT 1`).get(request.runId)!==undefined;
          if(activity)result=RunDraftValidationResultSchema.parse({kind:'invalid',runId:request.runId,revision:entry.draft.revision,issues:[{code:'actor-context-mismatch',field:'run',detail:'La representación conserva historia, sesiones o solicitudes. Cambiar su configuración inicial requiere una nueva representación; la validación no descarta pruebas ni memoria.'}]});
          else{
            const activeScene=configuration.worldSnapshot.scenes.find((scene)=>scene.id===configuration.worldSnapshot.activeSceneId);
            if(activeScene===undefined)throw new Error('Configuración validada sin escena inicial');
            const contexts=configuration.roster.preparedCharacters.filter((actor)=>activeScene.participantIds.includes(actor.characterId)).map((actor)=>({actorId:actor.characterId,
              continuityId:actor.continuity.continuityId,continuityRevision:actor.continuity.revision,continuityContentHash:actor.continuity.contentHash,
              identityVersion:actor.identityVersion,preparedContextHash:hashJson(actor).hash}));
            registerWorldRunWithinTransaction({initialSnapshot:configuration.worldSnapshot,configurationRevision:configuration.configRevision,configuration,
              continuityFence:{kind:'prepared-contexts',atWorldSeq:configuration.worldSnapshot.seq,contexts},lifecycle:'ready'},true);
            const budget=database.prepare('SELECT max_calls,consumed FROM run_budgets WHERE run_id=?').get(request.runId);
            if(budget!==undefined&&budgetRow.parse(budget).consumed===0)database.prepare('UPDATE run_budgets SET max_calls=? WHERE run_id=? AND consumed=0').run(configuration.budget.maxPiCallsPerRun,request.runId);
            result=RunDraftValidationResultSchema.parse({kind:'ready',runId:request.runId,revision:entry.draft.revision,worldRevision:configuration.worldSnapshot.revision,configurationHash:hashJson(configuration).hash});
          }
        }
        const recorded=recordRunDraftOperation({...operation,recordedAt,result});const payload=hashJson(result);
        database.prepare('INSERT INTO run_draft_validation_reports VALUES(?,?,?,?,?,?,?)').run(request.runId,entry.draft.revision,request.principalId,request.idempotencyKey,payload.json,payload.hash,recordedAt);
        return recorded;
      });
    },
    readRunConfigurationDraftValidation(input:unknown){
      const request=RunDraftReadSchema.parse(input);return transact(()=>{
        const entry=readRunDraft(request);if(entry===undefined)return undefined;
        const value=database.prepare(`SELECT * FROM run_draft_validation_reports WHERE run_id=? AND revision=? ORDER BY recorded_at DESC,idempotency_key DESC LIMIT 1`).get(request.runId,entry.draft.revision);
        if(value===undefined)return undefined;
        const row=z.strictObject({run_id:RunIdSchema,revision:RevisionSchema,principal_id:z.string(),idempotency_key:z.string().uuid(),payload_json:z.string(),payload_hash:HashSchema,recorded_at:z.string()}).parse(value);
        const report=RunDraftValidationResultSchema.parse(parseStoredJson(row.payload_json));
        if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(report)!==row.payload_json||row.run_id!==request.runId||row.revision!==entry.draft.revision
          ||(report.kind!=='ready'&&report.kind!=='incomplete'&&report.kind!=='invalid')||report.runId!==row.run_id||report.revision!==row.revision)throw new Error('Reporte de validación durable alterado');
        const receipt=z.strictObject({result_json:z.string(),result_hash:HashSchema,operation_kind:z.literal('validate')}).parse(database.prepare('SELECT result_json,result_hash,operation_kind FROM run_draft_operations WHERE principal_id=? AND idempotency_key=?').get(row.principal_id,row.idempotency_key));
        if(receipt.result_json!==row.payload_json||receipt.result_hash!==row.payload_hash)throw new Error('Reporte no coincide con receipt de validación');
        return report;
      });
    },
    readRunConfigurationDraftState(input:unknown){
      const request=z.strictObject({runId:RunIdSchema}).parse(input);return transact(()=>{
        const entry=readRunDraft(request);if(entry===undefined)return undefined;
        const value=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);const world=value===undefined?undefined:parseWorldRun(value);
        return RunDraftStateSchema.parse({runId:request.runId,revision:entry.draft.revision,configurationRevision:world?.row.config_revision??entry.draft.revision,
          lifecycle:world?.row.lifecycle??'draft',worldRevision:world?.row.world_revision??null,configurationHash:world?.row.configuration_hash??null,
          editability:world!==undefined&&identityPromotedConfiguration(request.runId)?'identity-promoted':world!==undefined&&(ReadyRunConfigurationSchema.safeParse(world.configuration).data?.forkOrigin!==undefined||database.prepare('SELECT 1 FROM fork_dramatic_seeds WHERE run_id=?').get(request.runId)!==undefined)?'fork-published':'editable'});
      });
    },

    readRunConfigurationDraft(input:unknown){const request=RunDraftReadSchema.parse(input);const entry=readRunDraft(request);return entry===undefined?undefined:request.revision===undefined?effectiveRunDraftView(entry):entry.draft;},
    listRunConfigurationDrafts(input:unknown={}){
      const request=RunDraftListSchema.parse(input);return database.prepare(`SELECT h.* FROM run_configuration_drafts d JOIN run_configuration_draft_history h ON h.run_id=d.run_id AND h.revision=d.revision
        ORDER BY d.updated_at DESC,d.run_id LIMIT ? OFFSET ?`).all(request.limit,request.offset).map(runDraftHistoryEntry).map(effectiveRunDraftView);
    },
    readRunConfigurationDraftHistory(input:unknown){const request=z.strictObject({runId:RunIdSchema}).parse(input);return database.prepare('SELECT * FROM run_configuration_draft_history WHERE run_id=? ORDER BY revision').all(request.runId).map(runDraftHistoryEntry);},

    beginContinuistaJob(input:unknown) {
      const request=ContinuistaJobBeginSchema.parse(input);const context=validateContinuistaReviewContext(request.context);
      return transact(()=>{
        const actor=claimedActorJob(request.execution);if(actor===undefined||actorJobEligibility(request.execution).kind!=='active')throw new Error('Actor del Continuista inactivo');
        if(canonicalJson(context.payload.inferenceProfile??LEGACY_INFERENCE_PROFILE)!==canonicalJson(actorJobInferenceProfile(request.execution)))throw new Error('Perfil del contexto Continuista distinto del claim actoral');
        if(canonicalJson(context.payload.scope)!==canonicalJson(ActorTurnJobScopeSchema.parse({runId:request.execution.runId,actorId:request.execution.actorId,
          jobId:request.execution.jobId,generation:request.execution.generation,pulseId:request.execution.pulseId}))
          ||canonicalJson(context.payload.inputCut)!==canonicalJson(frozenActorTurnWorldCut(actor)))throw new Error('Contexto Continuista pertenece a otro corte/scope');
        const proposal=proposalRecord(context.payload.proposal.runId,context.payload.proposal.proposalId,context.payload.proposal.version).record;
        if(canonicalJson(proposal)!==canonicalJson(context.payload.proposal))throw new Error('Propuesta Continuista no coincide con journal');
        const existing=database.prepare(`SELECT * FROM continuista_jobs WHERE run_id=? AND actor_job_id=? AND actor_generation=? AND proposal_id=? AND proposal_version=? ORDER BY generation DESC LIMIT 1`)
          .get(request.execution.runId,request.execution.jobId,request.execution.generation,proposal.proposalId,proposal.version);
        let jobId: z.infer<typeof JobIdSchema>;let generation:number;let kind:'created'|'existing';
        if(existing!==undefined){
          const row=ContinuistaJobRowSchema.parse(existing);const job=continuistaJobRow({jobId:row.job_id,generation:RevisionSchema.parse(row.generation)});
          if(job.row.context_hash!==context.contextHash||job.row.context_json!==canonicalJson(context))throw new Error('Contexto Continuista distinto para el mismo child job');
          if(row.state==='blocked')return ContinuistaJobBeginResultSchema.parse({kind:'blocked',job:continuistaJobView(row)});
          if(row.state==='running'&&(row.owner_token!==request.ownerToken||row.claim_token!==request.claimToken))return ContinuistaJobBeginResultSchema.parse({kind:'busy'});
          jobId=row.job_id;generation=row.generation;kind='existing';
          if(row.state==='queued')database.prepare(`UPDATE continuista_jobs SET state='running',owner_token=?,claim_token=?,actor_execution_json=?,updated_at=? WHERE job_id=? AND generation=? AND state='queued'`)
            .run(request.ownerToken,request.claimToken,canonicalJson(request.execution),Date.now(),jobId,generation);
        }else{
          jobId=JobIdSchema.parse(randomUUID());generation=0;kind='created';const timestamp=Date.now();
          database.prepare(`INSERT INTO continuista_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'running',?,?,NULL,?,?)`)
            .run(jobId,generation,request.execution.runId,request.execution.actorId,request.execution.jobId,request.execution.generation,request.execution.pulseId,
              proposal.proposalId,proposal.version,context.contextHash,canonicalJson(context),canonicalJson(request.execution),request.ownerToken,request.claimToken,timestamp,timestamp);
        }
        const {row}=continuistaJobRow({jobId,generation:RevisionSchema.parse(generation)});
        const actorExecution=ActorJobExecutionSchema.parse(parseStoredJson(row.actor_execution_json));
        return ContinuistaJobBeginResultSchema.parse({kind,job:continuistaJobView(row),execution:{actorExecution,jobId,generation,lease:{ownerToken:row.owner_token,claimToken:row.claim_token}}});
      });
    },
    readContinuistaJob(input:unknown){return continuistaJobView(continuistaJobRow(ContinuistaJobLookupSchema.parse(input)).row);},
    loadContinuistaSession(input:unknown){return continuistaSession(ContinuistaJobLookupSchema.parse(input));},
    registerContinuistaSession(input:unknown){
      const request=ContinuistaSessionRegistrationSchema.parse(input);if(!isAbsolute(request.sessionPath))throw new Error('Ruta de sesión Continuista no absoluta');return transact(()=>{
        const {row}=claimedContinuistaJob(request.execution);if(continuistaEligibility(request.execution).kind!=='active')throw new Error('Job Continuista inactivo');
        if(canonicalJson(resolveStoredPiProfile(request.profile))!==canonicalJson(actorJobInferenceProfile(request.execution.actorExecution)))throw new Error('Perfil Continuista distinto del claim actoral');
        if(continuistaSession(request.execution)===undefined)assertIndependentSession(request.sessionId,request.sessionPath);
        if(database.prepare('SELECT 1 FROM actor_pi_sessions WHERE session_id=? OR session_path=? LIMIT 1').get(request.sessionId,request.sessionPath)!==undefined
          ||database.prepare(`SELECT 1 FROM continuista_sessions WHERE (job_id<>? OR generation<>?) AND (json_extract(payload_json,'$.sessionId')=? OR json_extract(payload_json,'$.sessionPath')=?) LIMIT 1`)
            .get(row.job_id,row.generation,request.sessionId,request.sessionPath)!==undefined)throw new Error('Sesión Continuista no independiente');
        const session=ContinuistaSessionSchema.parse({jobId:row.job_id,generation:row.generation,contextHash:row.context_hash,sessionId:request.sessionId,sessionPath:request.sessionPath,profile:request.profile});
        const existing=continuistaSession(request.execution);if(existing!==undefined){if(canonicalJson(existing)!==canonicalJson(session))throw new Error('Sesión Continuista registrada distinta');return 'existing';}
        const payload=hashJson(session);database.prepare('INSERT INTO continuista_sessions VALUES(?,?,?,?)').run(row.job_id,row.generation,payload.json,payload.hash);return 'stored';
      });
    },
    checkContinuistaJobEligibility(input:unknown){return continuistaEligibility(ContinuistaJobExecutionSchema.parse(input));},
    reserveContinuistaRequest(input:unknown){
      const request=z.strictObject({execution:ContinuistaJobExecutionSchema,clockEpochId:ModelTimeClockEpochIdSchema.optional()}).parse(input);return transact(()=>{
        const eligibility=continuistaEligibility(request.execution);if(eligibility.kind!=='active')throw new Error(`Continuista inactivo: ${eligibility.reason}`);
        if(continuistaSession(request.execution)===undefined)throw new Error('Continuista sin sesión');
        if(database.prepare(`SELECT 1 FROM request_reservations WHERE job_id=? AND generation=? AND state IN('reserved','dispatched','ambiguous') LIMIT 1`).get(request.execution.jobId,request.execution.generation)!==undefined)throw new Error('Request Continuista previa pendiente o incierta');
        const result=reserveNextWithinTransaction({runId:request.execution.actorExecution.runId,pulseId:request.execution.actorExecution.pulseId,jobId:request.execution.jobId,generation:request.execution.generation,
          ...(request.clockEpochId===undefined?{}:{clockEpochId:request.clockEpochId,ownerToken:request.execution.actorExecution.lease.ownerToken})});
        if(result.kind==='reserved')database.prepare('INSERT INTO continuista_request_leases VALUES(?,?,?,?)').run(request.execution.jobId,request.execution.generation,result.requestSeq,canonicalJson(request.execution));return result;
      });
    },
    transitionContinuistaRequest(input:unknown){
      const request=z.strictObject({execution:ContinuistaJobExecutionSchema,requestSeq:counter,target:ReservationTransitionSchema.shape.target,
        wallTime:ReservationTransitionSchema.shape.wallTime}).parse(input);
      transact(()=>{
        claimedContinuistaJob(request.execution);const reservation=continuistaReservation(request.execution,request.requestSeq);
        if(request.target==='dispatched'){
          if(reservation.state!=='reserved')throw new Error('Request Continuista ya despachada o no reservada');
          const eligibility=continuistaEligibility(request.execution);if(eligibility.kind!=='active')throw new Error(`Continuista inactivo: ${eligibility.reason}`);
          const value=database.prepare(`SELECT checkpoint_hash,payload_json FROM continuista_checkpoints WHERE job_id=? AND generation=? AND purpose_kind='request-input' AND request_seq=?`)
            .get(request.execution.jobId,request.execution.generation,request.requestSeq);
          const stored=z.strictObject({checkpoint_hash:HashSchema,payload_json:z.string()}).parse(value);const checkpoint=ContinuistaCheckpointSchema.parse(parseStoredJson(stored.payload_json));
          if(sha256(stored.payload_json)!==stored.checkpoint_hash||canonicalJson(checkpoint)!==stored.payload_json||canonicalJson(checkpoint.execution)!==canonicalJson(request.execution))throw new Error('Checkpoint input Continuista no coincide con lease');
        }
        transitionWithinTransaction({jobId:request.execution.jobId,generation:request.execution.generation,requestSeq:request.requestSeq,target:request.target,
          ownerToken:request.execution.actorExecution.lease.ownerToken,
          ...(request.wallTime===undefined?{}:{wallTime:request.wallTime})});
      });
    },
    expireContinuistaRequest(input:unknown){
      const request=z.strictObject({execution:ContinuistaJobExecutionSchema,requestSeq:counter,
        clockEpochId:ModelTimeClockEpochIdSchema,reason:z.enum(['timeout','cancelled'])}).parse(input);
      return transact(()=>{continuistaReservation(request.execution,request.requestSeq);return expireModelTimeWithinTransaction({jobId:request.execution.jobId,
        generation:request.execution.generation,requestSeq:request.requestSeq,clockEpochId:request.clockEpochId,reason:request.reason});});
    },
    settleContinuistaRequestWallTime(input:unknown){
      const request=z.strictObject({execution:ContinuistaJobExecutionSchema,requestSeq:counter,clockEpochId:ModelTimeClockEpochIdSchema,monotonicNs:MonotonicNanosecondsSchema}).parse(input);
      return transact(()=>{continuistaReservation(request.execution,request.requestSeq);return settleModelTimeWithinTransaction({jobId:request.execution.jobId,
        generation:request.execution.generation,requestSeq:request.requestSeq,clockEpochId:request.clockEpochId,monotonicNs:request.monotonicNs});});
    },
    recordContinuistaCheckpoint(input:unknown){
      const request=ContinuistaCheckpointSchema.parse(input);const payload=hashJson(request);return transact(()=>{
        const existing=database.prepare('SELECT payload_json FROM continuista_checkpoints WHERE checkpoint_hash=?').get(payload.hash);
        if(existing!==undefined){if(z.strictObject({payload_json:z.string()}).parse(existing).payload_json!==payload.json)throw new Error('Colisión checkpoint');return 'existing';}
        claimedContinuistaJob(request.execution);
        const actorJob=claimedActorJob(request.execution.actorExecution);
        const run=parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.execution.actorExecution.runId));
        if(actorJob===undefined||!actorJobEpochCurrent(actorJob,run))throw new Error('Checkpoint Continuista pertenece a una época de lifecycle anterior');
        const session=continuistaSession(request.execution);
        if(session===undefined||session.sessionId!==request.snapshot.sessionId||session.sessionPath!==request.snapshot.sessionPath)throw new Error('Checkpoint de sesión Continuista ajena');
        if(request.purpose.kind==='request-input'){
          if(continuistaEligibility(request.execution).kind!=='active'||continuistaReservation(request.execution,request.purpose.requestSeq).state!=='reserved')throw new Error('Checkpoint input Continuista sin reserva activa');
        }else if(request.purpose.kind==='terminal-candidate'&&request.purpose.outcome==='completed'){
          if(request.purpose.lastRequestSeq===null||request.snapshot.candidateLeafId===null||continuistaReservation(request.execution,request.purpose.lastRequestSeq).state!=='completed')throw new Error('Terminal Continuista no demuestra request completada');
          const last=z.strictObject({last:counter.nullable()}).parse(database.prepare('SELECT MAX(request_seq) last FROM request_reservations WHERE job_id=? AND generation=?').get(request.execution.jobId,request.execution.generation));
          if(last.last!==request.purpose.lastRequestSeq)throw new Error('Terminal Continuista no corresponde a la última request');
        }
        database.prepare('INSERT INTO continuista_checkpoints VALUES(?,?,?,?,?,?,?)').run(payload.hash,request.execution.jobId,request.execution.generation,request.purpose.kind,
          request.purpose.kind==='request-input'?request.purpose.requestSeq:null,payload.json,Date.now());
      return 'stored';
      });
    },
    stageContinuistaReview(input:unknown){
      const request=z.strictObject({execution:ContinuistaJobExecutionSchema,response:z.unknown()}).parse(input);return transact(()=>{
        const {context}=continuistaJobRow(request.execution);const response=validateContinuistaContextReview({context,response:request.response,allowIncomplete:true});
        const payload=hashJson(response);const value=database.prepare('SELECT candidate_hash,payload_json FROM continuista_candidates WHERE job_id=? AND generation=?').get(request.execution.jobId,request.execution.generation);
        if(value!==undefined){const existing=z.strictObject({candidate_hash:HashSchema,payload_json:z.string()}).parse(value);if(existing.candidate_hash!==payload.hash||existing.payload_json!==payload.json)throw new Error('Candidato Continuista distinto para la generación');return {kind:'existing',candidateHash:payload.hash} satisfies {kind:'existing';candidateHash:typeof payload.hash};}
        const eligibility=continuistaEligibility(request.execution);if(eligibility.kind!=='active')throw new Error(`Continuista inactivo: ${eligibility.reason}`);
        database.prepare('INSERT INTO continuista_candidates VALUES(?,?,?,?)').run(request.execution.jobId,request.execution.generation,payload.hash,payload.json);return {kind:'stored',candidateHash:payload.hash} satisfies {kind:'stored';candidateHash:typeof payload.hash};
      });
    },
    readContinuistaReceipt(input:unknown){return readContinuistaReceipt(ContinuistaJobLookupSchema.parse(input));},
    acceptContinuistaReview(input:unknown){
      const request=z.strictObject({execution:ContinuistaJobExecutionSchema,candidateHash:HashSchema}).parse(input);return transact(()=>{
        const existing=readContinuistaReceipt(request.execution);if(existing!==undefined){const row=continuistaJobRow(request.execution).row;if(row.actor_execution_json!==canonicalJson(request.execution.actorExecution))throw new Error('Ejecución parental Continuista aceptada inválida');if(existing.candidateHash!==request.candidateHash)throw new Error('Aceptación Continuista con candidato distinto');return {kind:'existing',receipt:existing} satisfies {kind:'existing';receipt:typeof existing};}
        const {row}=claimedContinuistaJob(request.execution);const eligibility=continuistaEligibility(request.execution);if(eligibility.kind!=='active')throw new Error(`Continuista inactivo: ${eligibility.reason}`);
        const {response,terminal}=continuistaTerminalProof(request.execution,request.candidateHash);
        storeContinuistaReview(response.review);
        const receipt=ContinuistaReceiptSchema.parse({jobId:row.job_id,generation:row.generation,contextHash:row.context_hash,candidateHash:request.candidateHash,terminalHash:terminal.checkpoint_hash,review:response.review});const payload=hashJson(receipt);
        database.prepare('INSERT INTO continuista_receipts VALUES(?,?,?,?)').run(row.job_id,row.generation,payload.json,payload.hash);
        database.prepare(`UPDATE continuista_jobs SET state='accepted',updated_at=? WHERE job_id=? AND generation=? AND state='running'`).run(Date.now(),row.job_id,row.generation);
        return {kind:'stored',receipt} satisfies {kind:'stored';receipt:typeof receipt};
      });
    },
    failContinuistaJob(input:unknown){
      const request=z.strictObject({execution:ContinuistaJobExecutionSchema,code:ActorTurnJobFailureCodeSchema}).parse(input);return transact(()=>{
        const {row}=continuistaJobRow(request.execution);
        if(row.owner_token!==request.execution.lease.ownerToken||row.claim_token!==request.execution.lease.claimToken||row.actor_execution_json!==canonicalJson(request.execution.actorExecution))throw new Error('Lease Continuista inválido');
        if(row.state==='blocked'){if(row.failure_code!==request.code)throw new Error('Diagnóstico Continuista ya registrado');return 'existing';}
        if(row.state!=='running')throw new Error('Continuista no running');
        database.prepare(`UPDATE continuista_jobs SET state='blocked',failure_code=?,updated_at=? WHERE job_id=? AND generation=?`).run(request.code,Date.now(),row.job_id,row.generation);return 'blocked';
      });
    },
    retryContinuistaJob(input:unknown){
      const request=z.strictObject({execution:ContinuistaJobExecutionSchema,expectedGeneration:RevisionSchema,ownerToken:z.string().uuid(),claimToken:z.string().uuid()}).parse(input);
      return transact(()=>{
        const {row}=continuistaJobRow(request.execution);
        if(row.state!=='blocked'||row.generation!==request.expectedGeneration||row.actor_execution_json!==canonicalJson(request.execution.actorExecution)
          ||row.owner_token!==request.execution.lease.ownerToken||row.claim_token!==request.execution.lease.claimToken)throw new Error('Retry Continuista exige generación bloqueada y lease exacto');
        if(actorJobEligibility(request.execution.actorExecution).kind!=='active')throw new Error('Actor del retry Continuista inactivo');
        const generation=RevisionSchema.parse(request.expectedGeneration+1);const next=database.prepare('SELECT * FROM continuista_jobs WHERE job_id=? AND generation=?').get(row.job_id,generation);
        if(next!==undefined){const prior=ContinuistaJobRowSchema.parse(next);return ContinuistaJobBeginResultSchema.parse({kind:'existing',job:continuistaJobView(prior),execution:{actorExecution:request.execution.actorExecution,jobId:row.job_id,generation,lease:{ownerToken:prior.owner_token,claimToken:prior.claim_token}}});}
        const timestamp=Date.now();database.prepare(`INSERT INTO continuista_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'running',?,?,NULL,?,?)`)
          .run(row.job_id,generation,row.run_id,row.actor_id,row.actor_job_id,row.actor_generation,row.pulse_id,row.proposal_id,row.proposal_version,row.context_hash,row.context_json,row.actor_execution_json,request.ownerToken,request.claimToken,timestamp,timestamp);
        const fresh=continuistaJobRow({jobId:row.job_id,generation}).row;
        return ContinuistaJobBeginResultSchema.parse({kind:'created',job:continuistaJobView(fresh),execution:{actorExecution:request.execution.actorExecution,jobId:row.job_id,generation,lease:{ownerToken:request.ownerToken,claimToken:request.claimToken}}});
      });
    },
    recoverAbandonedContinuistaClaims(input:unknown){const request=ActorTurnJobRecoverySchema.parse(input);return Number(transact(()=>database.prepare(`UPDATE continuista_jobs SET state='queued',owner_token=NULL,claim_token=NULL,updated_at=? WHERE state='running' AND owner_token<>?`).run(Date.now(),request.ownerToken).changes));},

    beginDirectorJob(input: unknown) {
      const request=DirectorJobBeginSchema.parse(input);return transact(()=>{
        const prior=database.prepare("SELECT job_id,generation FROM administrative_jobs WHERE run_id=? AND pulse_id=? AND role='director' ORDER BY generation DESC LIMIT 1").get(request.runId,request.pulseId);
        if(prior!==undefined){
          const lookup=AdministrativeJobLookupSchema.parse({jobId:Reflect.get(prior,'job_id'),generation:Reflect.get(prior,'generation')});
          const {row,context}=administrativeJobRow(lookup);const job=administrativeJobView(row);
          if(context.role!=='director')throw new Error('Job Director de otro rol');
          if(row.state==='blocked')return DirectorJobBeginResultSchema.parse({kind:'blocked',job});
          if(row.state==='running'&&(row.owner_token!==request.ownerToken||row.claim_token!==request.claimToken))return DirectorJobBeginResultSchema.parse({kind:'busy',job});
          return DirectorJobBeginResultSchema.parse({kind:'existing',job,execution:administrativeExecution(row,context),context});
        }
        const value=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);if(value===undefined)return DirectorJobBeginResultSchema.parse({kind:'inactive'});
        const run=parseWorldRun(value);const pulse=coordinatorPulseView(request);
        if(run.row.lifecycle!=='running'||pulse?.state!=='running'||pulse.lifecycleRevision!==run.row.lifecycle_revision)return DirectorJobBeginResultSchema.parse({kind:'inactive'});
        const actorsTerminal=pulse.jobs.every(job=>{
          if(job.state==='blocked')return true;if(job.state!=='accepted')return false;
          const proposal=acceptedActorJobProposal({runId:job.runId,actorId:job.actorId,jobId:job.jobId,generation:job.generation});
          return proposal!==undefined&&database.prepare("SELECT 1 FROM world_commits WHERE run_id=? AND origin_kind='actorAttempt' AND origin_id=?").get(job.runId,proposal.attemptId)!==undefined;
        });
        if(!actorsTerminal)return DirectorJobBeginResultSchema.parse({kind:'inactive'});
        const awaiting=database.prepare(`SELECT 1 FROM actor_turn_intents i JOIN world_perceptions p ON p.perception_id=i.perception_id
          WHERE i.run_id=? AND p.origin_kind=? AND p.origin_id=?
          AND NOT EXISTS(SELECT 1 FROM actor_turn_job_inputs a WHERE a.perception_id=i.perception_id AND a.state IN('assigned','consumed'))
          AND NOT EXISTS(SELECT 1 FROM actor_turn_job_inputs a JOIN actor_turn_jobs j ON j.job_id=a.job_id AND j.generation=a.generation
            WHERE a.perception_id=i.perception_id AND j.pulse_id=? AND j.state='blocked'
            AND NOT EXISTS(SELECT 1 FROM actor_turn_jobs newer WHERE newer.job_id=j.job_id AND newer.generation>j.generation)) LIMIT 1`)
          .get(request.runId,pulse.cause.kind,pulse.cause.id,request.pulseId);
        if(awaiting!==undefined)return DirectorJobBeginResultSchema.parse({kind:'inactive'});
        const jobId=JobIdSchema.parse(randomUUID());const generation=RevisionSchema.parse(0);const context=directorContextForPulse(run,request.pulseId,jobId,generation);
        const payload=hashJson(context);const now=Date.now();
        database.prepare(`INSERT INTO administrative_jobs VALUES(?,?,?,?, 'director',?,?,?,?,?,'running',?,?,NULL,?,?)`)
          .run(jobId,generation,request.runId,request.pulseId,run.row.lifecycle_revision,run.row.world_revision,run.row.last_seq,
            payload.json,payload.hash,request.ownerToken,request.claimToken,now,now);
        const {row}=administrativeJobRow({jobId,generation});
        return DirectorJobBeginResultSchema.parse({kind:'created',job:administrativeJobView(row),execution:administrativeExecution(row,context),context});
      });
    },
    beginNarratorJob(input:unknown){
      const request=NarratorJobBeginSchema.parse(input);return transact(()=>{
        const value=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);if(value===undefined)return NarratorJobBeginResultSchema.parse({kind:'inactive'});
        const run=parseWorldRun(value);const configuration=ReadyRunConfigurationSchema.parse(run.configuration);
        if(configuration.narrationMode.kind!=='enabled')return NarratorJobBeginResultSchema.parse({kind:'inactive'});
        const prior=database.prepare("SELECT job_id,generation FROM administrative_jobs WHERE run_id=? AND pulse_id=? AND role='narrator' ORDER BY generation DESC LIMIT 1").get(request.runId,request.pulseId);
        if(prior!==undefined){const lookup=AdministrativeJobLookupSchema.parse({jobId:Reflect.get(prior,'job_id'),generation:Reflect.get(prior,'generation')});const {row,context}=administrativeJobRow(lookup);const job=administrativeJobView(row);
          if(context.role!=='narrator')throw new Error('Job Narrador de otro rol');
          if(row.state==='blocked')return NarratorJobBeginResultSchema.parse({kind:'blocked',job});
          if(row.state==='running'&&(row.owner_token!==request.ownerToken||row.claim_token!==request.claimToken))return NarratorJobBeginResultSchema.parse({kind:'busy',job});
          return NarratorJobBeginResultSchema.parse({kind:'existing',job,execution:administrativeExecution(row,context),context});}
        const pulse=coordinatorPulseView(request);
        if(run.row.lifecycle!=='running'||pulse?.state!=='running'||pulse.lifecycleRevision!==run.row.lifecycle_revision)return NarratorJobBeginResultSchema.parse({kind:'inactive'});
        const director=database.prepare("SELECT job_id,generation FROM administrative_jobs WHERE run_id=? AND pulse_id=? AND role='director' ORDER BY generation DESC LIMIT 1").get(request.runId,request.pulseId);
        if(director===undefined)return NarratorJobBeginResultSchema.parse({kind:'inactive'});
        const directorLookup=AdministrativeJobLookupSchema.parse({jobId:Reflect.get(director,'job_id'),generation:Reflect.get(director,'generation')});
        if(directorReceipt(directorLookup)===undefined)return NarratorJobBeginResultSchema.parse({kind:'inactive'});
        const jobId=JobIdSchema.parse(randomUUID());const generation=RevisionSchema.parse(0);const seed=directorContextForPulse(run,request.pulseId,jobId,generation);
        const context=validateNarratorContext({kind:'narrator-context',schemaVersion:1,role:'narrator',scope:seed.scope,
          authorization:{kind:'omniscient-confirmed-world'},language:'es',snapshot:projectNarratorPhysicalSnapshot(run.snapshot),
          recordedWorldFacts:projectNarratorRecordedWorldFacts(run.snapshot),confirmedEvents:seed.confirmedEvents,previousNarrations:narrationPublicationsAt(request.runId,run.row.last_seq)});
        const payload=hashJson(context);const now=Date.now();database.prepare(`INSERT INTO administrative_jobs VALUES(?,?,?,?, 'narrator',?,?,?,?,?,'running',?,?,NULL,?,?)`)
          .run(jobId,generation,request.runId,request.pulseId,run.row.lifecycle_revision,run.row.world_revision,run.row.last_seq,payload.json,payload.hash,request.ownerToken,request.claimToken,now,now);
        const {row}=administrativeJobRow({jobId,generation});return NarratorJobBeginResultSchema.parse({kind:'created',job:administrativeJobView(row),execution:administrativeExecution(row,context),context});
      });
    },
    readNarrationReceipt(input:unknown){return narrationReceipt(AdministrativeJobLookupSchema.parse(input));},
    readNarrationPublication(input:unknown){
      const request=z.strictObject({runId:RunIdSchema,publicationId:z.string().uuid()}).parse(input);
      const rows=database.prepare(`SELECT r.job_id,r.generation FROM narration_receipts r JOIN administrative_jobs j ON j.job_id=r.job_id AND j.generation=r.generation
        WHERE r.run_id=? AND j.run_id=r.run_id AND json_extract(r.payload_json,'$.kind')='published'
        AND json_extract(r.payload_json,'$.publication.publicationId')=? LIMIT 2`).all(request.runId,request.publicationId);
      if(rows.length===0)return undefined;if(rows.length!==1)throw new Error('Publicación Narrador no es única');
      const row=rows[0];if(row===undefined)throw new Error('Publicación Narrador perdida');const lookup=AdministrativeJobLookupSchema.parse({jobId:Reflect.get(row,'job_id'),generation:Reflect.get(row,'generation')});
      const receipt=narrationReceipt(lookup);if(receipt?.kind!=='published'||receipt.publication.scope.runId!==request.runId||receipt.publication.publicationId!==request.publicationId)throw new Error('Publicación Narrador de otro scope');
      return receipt.publication;
    },
    readNarrationPublicationPage(input:unknown){
      const request=z.strictObject({runId:RunIdSchema,throughWorldSeq:WorldSeqSchema,throughWorldRevision:RevisionSchema,
        afterPublishedAt:counter.optional(),afterPublicationId:z.string().uuid().optional(),limit:counter.min(1).max(100).default(50)}).superRefine((value,ctx)=>{
          if((value.afterPublishedAt===undefined)!==(value.afterPublicationId===undefined))ctx.addIssue({code:'custom',message:'Cursor Narrador requiere timestamp e ID juntos'});
        }).parse(input);
      const value=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);if(value===undefined)return undefined;
      const run=parseWorldRun(value);if(snapshotAndCommitAtCut(run,request.throughWorldRevision,request.throughWorldSeq)===undefined)throw new Error('Corte Narrador no confirmado');
      const rows=database.prepare(`SELECT r.job_id,r.generation FROM narration_receipts r JOIN administrative_jobs j ON j.job_id=r.job_id AND j.generation=r.generation
        WHERE r.run_id=? AND j.run_id=r.run_id AND r.through_world_seq<=? AND j.world_revision<=?
          AND json_extract(r.payload_json,'$.kind')='published'
          AND (? IS NULL OR r.accepted_at>? OR (r.accepted_at=? AND json_extract(r.payload_json,'$.publication.publicationId')>?))
        ORDER BY r.accepted_at,json_extract(r.payload_json,'$.publication.publicationId') LIMIT ?`)
        .all(request.runId,request.throughWorldSeq,request.throughWorldRevision,request.afterPublishedAt??null,request.afterPublishedAt??null,
          request.afterPublishedAt??null,request.afterPublicationId??null,request.limit+1)
        .map(row=>AdministrativeJobLookupSchema.parse({jobId:Reflect.get(row,'job_id'),generation:Reflect.get(row,'generation')}));
      const items=rows.slice(0,request.limit).map(lookup=>{const receipt=narrationReceipt(lookup);
        if(receipt?.kind!=='published'||receipt.publication.scope.runId!==request.runId||receipt.publication.scope.throughWorldSeq>request.throughWorldSeq
          ||receipt.publication.scope.worldRevision>request.throughWorldRevision)throw new Error('Publicación fuera de corte');
        const context=administrativeJobRow(lookup).context;if(context.role!=='narrator')throw new Error('Publicación de otro rol');
        return {publication:receipt.publication,sceneId:context.snapshot.activeSceneId};});
      return {items,hasMore:rows.length>request.limit};
    },
    readNarrationPublications(input:unknown){const request=z.strictObject({runId:RunIdSchema,throughWorldSeq:WorldSeqSchema}).parse(input);return narrationPublicationsAt(request.runId,request.throughWorldSeq);},
    stageNarration(input:unknown){const request=z.strictObject({execution:AdministrativeJobExecutionSchema,proposal:NarratorJournalCandidateSchema.shape.proposal}).parse(input);return transact(()=>{
      const job=claimedAdministrativeJob(request.execution);if(job.context.role!=='narrator'||administrativeEligibility(request.execution).kind!=='active')throw new Error('Narrador inactivo/de otro rol');
      const proposal=validateNarrationProposal({context:job.context,proposal:request.proposal});const payload=hashJson({execution:request.execution,proposal});
      const candidate=NarratorJournalCandidateSchema.parse({candidateHash:payload.hash,execution:request.execution,proposal});
      const prior=database.prepare('SELECT candidate_hash FROM narration_candidates WHERE job_id=? AND generation=?').get(job.row.job_id,job.row.generation);
      if(prior!==undefined)return narrationCandidate(request.execution,payload.hash);
      database.prepare('INSERT INTO narration_candidates VALUES(?,?,?,?)').run(payload.hash,job.row.job_id,job.row.generation,canonicalJson(candidate));return candidate;
    });},
    acceptNarration(input:unknown){const request=z.strictObject({execution:AdministrativeJobExecutionSchema,candidateHash:HashSchema,review:NarrationReviewSchema.options[0]}).parse(input);return transact(()=>{
      const existing=narrationReceipt(request.execution.scope);if(existing!==undefined){const candidate=narrationCandidate(request.execution,request.candidateHash);
        if(existing.kind!=='published'||candidate.proposal.kind!=='narrate'||canonicalJson(existing.publication.review)!==canonicalJson(request.review))throw new Error('Replay Narrador de otro resultado/review');return existing;}
      const job=assertAdministrativeTerminal(request.execution);if(job.context.role!=='narrator')throw new Error('Publicación de otro rol');
      const candidate=narrationCandidate(request.execution,request.candidateHash);if(candidate.proposal.kind!=='narrate')throw new Error('Abstención no es publicación');
      const childReceipt=narrationParentReview(request.execution,candidate.proposal);
      if(canonicalJson(childReceipt.review)!==canonicalJson(request.review))throw new Error('Review Narrador libre no coincide con receipt durable');
      const review=validateNarrationReview({context:job.context,proposal:candidate.proposal,review:childReceipt.review});if(review.kind!=='accepted')throw new Error('Publicación Narrador sin review aceptado');
      const now=Date.now();const proposal=candidate.proposal;
      const receipt=NarratorJobReceiptSchema.parse({kind:'published',publication:{kind:'narration-publication',publicationId:randomUUID(),scope:job.context.scope,
        contextHash:job.row.context_hash,proposalHash:narrationValueHash(proposal),text:proposal.text,textHash:sha256(proposal.text),sourceEventIds:proposal.sourceEventIds,sourceRecordedFactIds:proposal.sourceRecordedFactIds,
        sourceWorldRevision:proposal.sourceWorldRevision,uncertainty:proposal.uncertainty,review,publishedAt:now}});
      const payload=hashJson(receipt);database.prepare('INSERT INTO narration_receipts VALUES(?,?,?,?,?,?,?,?)').run(job.row.job_id,job.row.generation,job.row.run_id,job.row.pulse_id,job.row.through_world_seq,payload.json,payload.hash,now);
      const changed=database.prepare("UPDATE administrative_jobs SET state='accepted',updated_at=? WHERE job_id=? AND generation=? AND state='running' AND owner_token=? AND claim_token=?")
        .run(now,job.row.job_id,job.row.generation,request.execution.lease.ownerToken,request.execution.lease.claimToken);if(changed.changes!==1)throw new Error('CAS Narrador cambió');return receipt;
    });},
    completeNarratorAbstention(input:unknown){const request=z.strictObject({execution:AdministrativeJobExecutionSchema,candidateHash:HashSchema}).parse(input);return transact(()=>{
      const existing=narrationReceipt(request.execution.scope);if(existing!==undefined){narrationCandidate(request.execution,request.candidateHash);if(existing.kind!=='abstained')throw new Error('Replay Narrador no es abstención');return existing;}
      const job=assertAdministrativeTerminal(request.execution);if(job.context.role!=='narrator')throw new Error('Abstención de otro rol');
      const candidate=narrationCandidate(request.execution,request.candidateHash);if(candidate.proposal.kind!=='abstain')throw new Error('Texto narrado no es abstención');
      const now=Date.now();const receipt=NarratorJobReceiptSchema.parse({kind:'abstained',scope:job.context.scope,contextHash:job.row.context_hash,proposalHash:narrationValueHash(candidate.proposal),proposal:candidate.proposal,acceptedAt:now});
      const payload=hashJson(receipt);database.prepare('INSERT INTO narration_receipts VALUES(?,?,?,?,?,?,?,?)').run(job.row.job_id,job.row.generation,job.row.run_id,job.row.pulse_id,job.row.through_world_seq,payload.json,payload.hash,now);
      const changed=database.prepare("UPDATE administrative_jobs SET state='accepted',updated_at=? WHERE job_id=? AND generation=? AND state='running' AND owner_token=? AND claim_token=?")
        .run(now,job.row.job_id,job.row.generation,request.execution.lease.ownerToken,request.execution.lease.claimToken);if(changed.changes!==1)throw new Error('CAS abstención Narrador cambió');return receipt;
    });},

    beginNarrationReviewJob(input:unknown){const request=NarrationReviewJobBeginSchema.parse(input);return transact(()=>{
      if(request.parentExecution.role!=='narrator'||administrativeEligibility(request.parentExecution).kind!=='active')return NarrationReviewJobBeginResultSchema.parse({kind:'inactive'});
      const parent=assertAdministrativeTerminal(request.parentExecution);if(parent.context.role!=='narrator')throw new Error('Review de parent no Narrador');
      const candidateRow=z.strictObject({candidate_hash:HashSchema}).parse(database.prepare('SELECT candidate_hash FROM narration_candidates WHERE job_id=? AND generation=?').get(parent.row.job_id,parent.row.generation));
      const candidate=narrationCandidate(request.parentExecution,candidateRow.candidate_hash);
      if(candidate.proposal.kind!=='narrate'||canonicalJson(candidate.proposal)!==canonicalJson(request.proposal))throw new Error('Review exige propuesta Narrador durable exacta');
      const prior=database.prepare("SELECT job_id,generation FROM administrative_jobs WHERE run_id=? AND pulse_id=? AND role='narration-reviewer' ORDER BY generation DESC LIMIT 1").get(parent.row.run_id,parent.row.pulse_id);
      if(prior!==undefined){const lookup=AdministrativeJobLookupSchema.parse({jobId:Reflect.get(prior,'job_id'),generation:Reflect.get(prior,'generation')});
        const {row,context}=administrativeJobRow(lookup);const job=administrativeJobView(row);
        if(context.role!=='narration-reviewer'||canonicalJson(context.parent.scope)!==canonicalJson(parent.context.scope)
          ||context.parent.contextHash!==parent.row.context_hash||context.parent.proposalHash!==narrationValueHash(request.proposal))throw new Error('Job review de otro parent/candidato');
        if(row.state==='blocked')return NarrationReviewJobBeginResultSchema.parse({kind:'blocked',job});
        if(row.state==='running'&&(row.owner_token!==request.ownerToken||row.claim_token!==request.claimToken))return NarrationReviewJobBeginResultSchema.parse({kind:'busy',job});
        return NarrationReviewJobBeginResultSchema.parse({kind:'existing',job,execution:administrativeExecution(row,context),context});}
      const jobId=JobIdSchema.parse(randomUUID());const generation=parent.context.scope.generation;
      const context=validateNarrationReviewContext({kind:'narration-review-context',schemaVersion:1,role:'narration-reviewer',
        scope:{...parent.context.scope,jobId,generation},parent:{scope:parent.context.scope,contextHash:parent.row.context_hash,proposalHash:narrationValueHash(candidate.proposal)},
        narratorContext:parent.context,proposal:candidate.proposal});
      const payload=hashJson(context);const now=Date.now();database.prepare(`INSERT INTO administrative_jobs VALUES(?,?,?,?,'narration-reviewer',?,?,?,?,?,'running',?,?,NULL,?,?)`)
        .run(jobId,generation,parent.row.run_id,parent.row.pulse_id,parent.row.lifecycle_revision,parent.row.world_revision,parent.row.through_world_seq,
          payload.json,payload.hash,request.ownerToken,request.claimToken,now,now);
      const {row}=administrativeJobRow({jobId,generation});return NarrationReviewJobBeginResultSchema.parse({kind:'created',job:administrativeJobView(row),execution:administrativeExecution(row,context),context});
    });},
    readNarrationReviewReceipt(input:unknown){return narrationReviewReceipt(AdministrativeJobLookupSchema.parse(input));},
    stageNarrationReview(input:unknown){const request=z.strictObject({execution:AdministrativeJobExecutionSchema,decision:NarrationReviewJournalCandidateSchema.shape.decision}).parse(input);return transact(()=>{
      const job=claimedAdministrativeJob(request.execution);if(job.context.role!=='narration-reviewer'||administrativeEligibility(request.execution).kind!=='active')throw new Error('Review Narrador inactivo/de otro rol');
      const decision=validateNarrationReviewDecision({context:job.context,decision:request.decision});const payload=hashJson({execution:request.execution,decision});
      const candidate=NarrationReviewJournalCandidateSchema.parse({candidateHash:payload.hash,execution:request.execution,decision});
      const prior=database.prepare('SELECT candidate_hash FROM narration_review_candidates WHERE job_id=? AND generation=?').get(job.row.job_id,job.row.generation);
      if(prior!==undefined)return narrationReviewCandidate(request.execution,payload.hash);
      database.prepare('INSERT INTO narration_review_candidates VALUES(?,?,?,?)').run(payload.hash,job.row.job_id,job.row.generation,canonicalJson(candidate));return candidate;
    });},
    acceptNarrationReview(input:unknown){const request=z.strictObject({execution:AdministrativeJobExecutionSchema,candidateHash:HashSchema}).parse(input);return transact(()=>{
      const existing=narrationReviewReceipt(request.execution.scope);if(existing!==undefined){narrationReviewCandidate(request.execution,request.candidateHash);return existing;}
      const job=assertAdministrativeTerminal(request.execution);if(job.context.role!=='narration-reviewer')throw new Error('Review aceptación de otro rol');
      const candidate=narrationReviewCandidate(request.execution,request.candidateHash);const decision=validateNarrationReviewDecision({context:job.context,decision:candidate.decision});
      const now=Date.now();const receipt=NarrationReviewJobReceiptSchema.parse({execution:request.execution,contextHash:job.row.context_hash,
        decisionHash:narrationValueHash(decision),decision,review:stampedNarrationReview(job.context,decision),acceptedAt:now});
      const payload=hashJson(receipt);database.prepare('INSERT INTO narration_review_receipts VALUES(?,?,?,?,?,?,?)')
        .run(job.row.job_id,job.row.generation,job.context.parent.scope.jobId,job.context.parent.scope.generation,payload.json,payload.hash,now);
      const changed=database.prepare("UPDATE administrative_jobs SET state='accepted',updated_at=? WHERE job_id=? AND generation=? AND state='running' AND owner_token=? AND claim_token=?")
        .run(now,job.row.job_id,job.row.generation,request.execution.lease.ownerToken,request.execution.lease.claimToken);if(changed.changes!==1)throw new Error('CAS review Narrador cambió');return receipt;
    });},

    readAdministrativeJob(input:unknown){return administrativeJobView(administrativeJobRow(AdministrativeJobLookupSchema.parse(input)).row);},
    loadAdministrativeSession(input:unknown){return administrativeSession(AdministrativeJobLookupSchema.parse(input));},
    checkAdministrativeJobEligibility(input:unknown){return administrativeEligibility(AdministrativeJobExecutionSchema.parse(input));},
    readDirectorReceipt(input:unknown){return directorReceipt(AdministrativeJobLookupSchema.parse(input));},
    readDirectorAnnotations(input:unknown){const request=z.strictObject({runId:RunIdSchema,throughWorldSeq:WorldSeqSchema}).parse(input);return directorAnnotationsAt(request.runId,request.throughWorldSeq);},
    readDirectorObservationHistory(input:unknown){return directorObservationHistory(input);},
    registerAdministrativeSession(input:unknown){
      const request=z.strictObject({execution:AdministrativeJobExecutionSchema,sessionId:z.string().min(1).max(200),sessionPath:z.string().min(1),baseLeafId:AdministrativeSessionSchema.shape.baseLeafId,profile:AdministrativeSessionSchema.shape.profile}).parse(input);
      if(!isAbsolute(request.sessionPath))throw new Error('La sesión administrativa debe tener ruta absoluta');
      return transact(()=>{
        const {row}=claimedAdministrativeJob(request.execution);if(administrativeEligibility(request.execution).kind!=='active')throw new Error('Job administrativo inactivo');
        if(canonicalJson(request.profile)!==canonicalJson(request.execution.scope.profile))throw new Error('Perfil administrativo diferente del contexto autorizado');
        const existing=administrativeSession(request.execution.scope);
        const session=AdministrativeSessionSchema.parse({jobId:row.job_id,generation:row.generation,role:row.role,contextHash:row.context_hash,
          sessionId:request.sessionId,sessionPath:request.sessionPath,baseLeafId:request.baseLeafId,profile:request.profile});
        if(existing!==undefined){if(canonicalJson(existing)!==canonicalJson(session))throw new Error('Sesión administrativa distinta');return 'existing';}
        assertIndependentSession(request.sessionId,request.sessionPath);
        const duplicate=database.prepare(`SELECT 1 FROM actor_pi_sessions WHERE session_id=? OR session_path=?
          UNION ALL SELECT 1 FROM continuista_sessions WHERE json_extract(payload_json,'$.sessionId')=? OR json_extract(payload_json,'$.sessionPath')=?
          UNION ALL SELECT 1 FROM administrative_sessions WHERE json_extract(payload_json,'$.sessionId')=? OR json_extract(payload_json,'$.sessionPath')=? LIMIT 1`)
          .get(request.sessionId,request.sessionPath,request.sessionId,request.sessionPath,request.sessionId,request.sessionPath);
        if(duplicate!==undefined)throw new Error('La sesión administrativa no es independiente');
        const payload=hashJson(session);database.prepare('INSERT INTO administrative_sessions VALUES(?,?,?,?)').run(row.job_id,row.generation,payload.json,payload.hash);return 'stored';
      });
    },
    reserveAdministrativeRequest(input:unknown){
      const request=z.strictObject({execution:AdministrativeJobExecutionSchema,clockEpochId:ModelTimeClockEpochIdSchema}).parse(input);return transact(()=>{
        if(administrativeEligibility(request.execution).kind!=='active')throw new Error('Job administrativo inactivo');
        if(administrativeSession(request.execution.scope)===undefined)throw new Error('Job administrativo sin sesión');
        const scope=request.execution.scope;
        if(database.prepare("SELECT 1 FROM request_reservations WHERE job_id=? AND generation=? AND state IN('reserved','dispatched','ambiguous') LIMIT 1").get(scope.jobId,scope.generation)!==undefined)throw new Error('Request administrativa pendiente/incierta');
        const result=reserveNextWithinTransaction({runId:scope.runId,pulseId:scope.pulseId,jobId:scope.jobId,generation:scope.generation,
          clockEpochId:request.clockEpochId,ownerToken:request.execution.lease.ownerToken});
        if(result.kind==='reserved')database.prepare('INSERT INTO administrative_request_leases VALUES(?,?,?,?)')
          .run(scope.jobId,scope.generation,result.requestSeq,canonicalJson(request.execution));return result;
      });
    },
    transitionAdministrativeRequest(input:unknown){
      const request=z.strictObject({execution:AdministrativeJobExecutionSchema,requestSeq:counter,target:ReservationTransitionSchema.shape.target,wallTime:ReservationTransitionSchema.shape.wallTime}).parse(input);
      return transact(()=>{
        const reservation=administrativeReservation(request.execution,request.requestSeq);
        if(request.target==='dispatched'){
          claimedAdministrativeJob(request.execution);if(administrativeEligibility(request.execution).kind!=='active'||reservation.state!=='reserved')throw new Error('Despacho administrativo inactivo o repetido');
          const value=database.prepare("SELECT checkpoint_hash,payload_json FROM administrative_checkpoints WHERE job_id=? AND generation=? AND purpose_kind='request-input' AND request_seq=?")
            .get(request.execution.scope.jobId,request.execution.scope.generation,request.requestSeq);
          const row=z.strictObject({checkpoint_hash:HashSchema,payload_json:z.string()}).parse(value);
          const checkpoint=AdministrativeCheckpointSchema.parse(parseStoredJson(row.payload_json));
          if(sha256(row.payload_json)!==row.checkpoint_hash||canonicalJson(checkpoint)!==row.payload_json||canonicalJson(checkpoint.execution)!==canonicalJson(request.execution))throw new Error('Checkpoint administrativo de otro lease');
        }
        transitionWithinTransaction({jobId:request.execution.scope.jobId,generation:request.execution.scope.generation,requestSeq:request.requestSeq,
          target:request.target,ownerToken:request.execution.lease.ownerToken,...(request.wallTime===undefined?{}:{wallTime:request.wallTime})});
      });
    },
    expireAdministrativeRequest(input:unknown){const request=z.strictObject({execution:AdministrativeJobExecutionSchema,requestSeq:counter,clockEpochId:ModelTimeClockEpochIdSchema,reason:z.enum(['timeout','cancelled'])}).parse(input);
      return transact(()=>{administrativeReservation(request.execution,request.requestSeq);return expireModelTimeWithinTransaction({jobId:request.execution.scope.jobId,generation:request.execution.scope.generation,requestSeq:request.requestSeq,clockEpochId:request.clockEpochId,reason:request.reason});});},
    settleAdministrativeRequestWallTime(input:unknown){const request=z.strictObject({execution:AdministrativeJobExecutionSchema,requestSeq:counter,clockEpochId:ModelTimeClockEpochIdSchema,monotonicNs:MonotonicNanosecondsSchema}).parse(input);
      return transact(()=>{administrativeReservation(request.execution,request.requestSeq);return settleModelTimeWithinTransaction({jobId:request.execution.scope.jobId,generation:request.execution.scope.generation,requestSeq:request.requestSeq,clockEpochId:request.clockEpochId,monotonicNs:request.monotonicNs});});},
    recordAdministrativeCheckpoint(input:unknown){const request=AdministrativeCheckpointSchema.parse(input);const payload=hashJson(request);return transact(()=>{
      const existing=database.prepare('SELECT payload_json FROM administrative_checkpoints WHERE checkpoint_hash=?').get(payload.hash);
      if(existing!==undefined){if(Reflect.get(existing,'payload_json')!==payload.json)throw new Error('Colisión checkpoint administrativo');return 'existing';}
      claimedAdministrativeJob(request.execution);if(administrativeEligibility(request.execution).kind!=='active')throw new Error('Checkpoint administrativo fuera de época/corte');
      const session=administrativeSession(request.execution.scope);if(session===undefined||session.sessionId!==request.snapshot.sessionId||session.sessionPath!==request.snapshot.sessionPath)throw new Error('Checkpoint administrativo de otra sesión');
      if(request.purpose.kind==='job-base'&&request.snapshot.candidateLeafId!==session.baseLeafId)throw new Error('La base administrativa no coincide con el checkpoint registrado');
      if(request.purpose.kind==='request-input'&&administrativeReservation(request.execution,request.purpose.requestSeq).state!=='reserved')throw new Error('Input administrativo sin reserva');
      if(request.purpose.kind==='terminal-candidate'&&request.purpose.outcome==='completed'){
        if(request.purpose.lastRequestSeq===null||request.snapshot.candidateLeafId===null||administrativeReservation(request.execution,request.purpose.lastRequestSeq).state!=='completed')throw new Error('Terminal administrativo sin request completada');
        const last=z.strictObject({last:counter.nullable()}).parse(database.prepare('SELECT MAX(request_seq) last FROM request_reservations WHERE job_id=? AND generation=?').get(request.execution.scope.jobId,request.execution.scope.generation));
        if(last.last!==request.purpose.lastRequestSeq)throw new Error('Terminal administrativo no liga última request');
      }
      database.prepare('INSERT INTO administrative_checkpoints VALUES(?,?,?,?,?,?,?)').run(payload.hash,request.execution.scope.jobId,request.execution.scope.generation,request.purpose.kind,
        request.purpose.kind==='request-input'?request.purpose.requestSeq:null,payload.json,Date.now());
      if((request.execution.role==='narrator'||request.execution.role==='narration-reviewer')&&request.snapshot.candidateLeafId!==null&&request.purpose.kind!=='job-base'){
        const prefix=readPiSessionCheckpointPrefix({privateDataRoot:journalPrivateDataRoot,runId:request.execution.scope.runId,
          role:request.execution.role==='narrator'?'narrador':'continuista',sessionId:session.sessionId,sessionPath:session.sessionPath,
          leafId:request.snapshot.candidateLeafId});
        if(prefix.kind!=='verified')throw new Error('Checkpoint JSONL administrativo no verificable');
        database.prepare('INSERT INTO administrative_checkpoint_integrity VALUES(?,?,?,?)').run(payload.hash,prefix.prefixHash,prefix.fileHash,prefix.byteLength);
      }
      return 'stored';
    });},
    stageDirectorObservation(input:unknown){const request=z.strictObject({execution:AdministrativeJobExecutionSchema,observation:DirectorCandidateSchema.shape.observation}).parse(input);return transact(()=>{
      const job=claimedAdministrativeJob(request.execution);if(administrativeEligibility(request.execution).kind!=='active')throw new Error('Director inactivo');
      if(job.context.role!=='director')throw new Error('Observación Director de otro rol');
      const observation=validateDirectorObservation({context:job.context,observation:request.observation});const payload=hashJson({execution:request.execution,observation});
      const candidate=DirectorCandidateSchema.parse({candidateHash:payload.hash,execution:request.execution,observation});
      const existing=database.prepare('SELECT candidate_hash,payload_json FROM director_candidates WHERE job_id=? AND generation=?').get(job.row.job_id,job.row.generation);
      if(existing!==undefined){if(Reflect.get(existing,'candidate_hash')!==payload.hash||Reflect.get(existing,'payload_json')!==canonicalJson(candidate))throw new Error('Observación Director candidata en conflicto');return candidate;}
      database.prepare('INSERT INTO director_candidates VALUES(?,?,?,?)').run(payload.hash,job.row.job_id,job.row.generation,canonicalJson(candidate));return candidate;
    });},
    acceptDirectorObservation(input:unknown){const request=z.strictObject({execution:AdministrativeJobExecutionSchema,candidateHash:HashSchema}).parse(input);return transact(()=>{
      const existing=directorReceipt(request.execution.scope);if(existing!==undefined){
        const source=administrativeJobRow(request.execution.scope);
        const candidateHash=z.strictObject({candidate_hash:HashSchema}).parse(database.prepare('SELECT candidate_hash FROM director_candidates WHERE job_id=? AND generation=?').get(request.execution.scope.jobId,request.execution.scope.generation)).candidate_hash;
        if(candidateHash!==request.candidateHash||canonicalJson(administrativeExecution(source.row,source.context))!==canonicalJson(request.execution))throw new Error('Replay Director de otro candidato/claim');
        return existing;
      }
      const job=claimedAdministrativeJob(request.execution);if(administrativeEligibility(request.execution).kind!=='active')throw new Error('Director fuera de época/corte antes de aceptación');
      const candidate=DirectorCandidateSchema.parse(parseStoredJson(z.strictObject({payload_json:z.string()}).parse(database.prepare('SELECT payload_json FROM director_candidates WHERE candidate_hash=? AND job_id=? AND generation=?')
        .get(request.candidateHash,job.row.job_id,job.row.generation)).payload_json));
      const candidatePayload=hashJson({execution:candidate.execution,observation:candidate.observation});
      if(candidatePayload.hash!==request.candidateHash||candidate.candidateHash!==request.candidateHash||canonicalJson(candidate.execution)!==canonicalJson(request.execution))throw new Error('Candidato Director alterado/ajeno');
      if(job.context.role!=='director')throw new Error('Aceptación Director de otro rol');
      validateDirectorObservation({context:job.context,observation:candidate.observation});
      const terminalValues=database.prepare("SELECT checkpoint_hash,payload_json FROM administrative_checkpoints WHERE job_id=? AND generation=? AND purpose_kind='terminal-candidate'").all(job.row.job_id,job.row.generation);
      const terminals=terminalValues.map(value=>{const row=z.strictObject({checkpoint_hash:HashSchema,payload_json:z.string()}).parse(value);if(sha256(row.payload_json)!==row.checkpoint_hash)throw new Error('Terminal Director alterado');return AdministrativeCheckpointSchema.parse(parseStoredJson(row.payload_json));})
        .filter(checkpoint=>checkpoint.purpose.kind==='terminal-candidate'&&checkpoint.purpose.outcome==='completed');
      if(terminals.length!==1)throw new Error('Aceptación Director requiere terminal único completado');
      const terminal=terminals[0];if(terminal===undefined||terminal.purpose.kind!=='terminal-candidate'||terminal.purpose.lastRequestSeq===null||terminal.snapshot.candidateLeafId===null
        ||canonicalJson(terminal.execution)!==canonicalJson(request.execution)||administrativeReservation(request.execution,terminal.purpose.lastRequestSeq).state!=='completed')throw new Error('Terminal Director no prueba última request del lease');
      const inputValue=database.prepare("SELECT checkpoint_hash,payload_json FROM administrative_checkpoints WHERE job_id=? AND generation=? AND purpose_kind='request-input' AND request_seq=?")
        .get(job.row.job_id,job.row.generation,terminal.purpose.lastRequestSeq);if(inputValue===undefined)throw new Error('Director sin input checkpoint exacto');
      const inputRow=z.strictObject({checkpoint_hash:HashSchema,payload_json:z.string()}).parse(inputValue);const inputCheckpoint=AdministrativeCheckpointSchema.parse(parseStoredJson(inputRow.payload_json));
      const session=administrativeSession(request.execution.scope);
      if(sha256(inputRow.payload_json)!==inputRow.checkpoint_hash||canonicalJson(inputCheckpoint)!==inputRow.payload_json||canonicalJson(inputCheckpoint.execution)!==canonicalJson(request.execution)
        ||session===undefined||terminal.snapshot.sessionId!==session.sessionId||terminal.snapshot.sessionPath!==session.sessionPath
        ||inputCheckpoint.snapshot.sessionId!==session.sessionId||inputCheckpoint.snapshot.sessionPath!==session.sessionPath)throw new Error('Checkpoints Director no pertenecen a la sesión exacta');
      const max=z.strictObject({last:counter.nullable()}).parse(database.prepare('SELECT MAX(request_seq) last FROM request_reservations WHERE job_id=? AND generation=?').get(job.row.job_id,job.row.generation));
      if(max.last!==terminal.purpose.lastRequestSeq)throw new Error('Director no terminó última request');
      const annotation=DirectorAnnotationSchema.parse({annotationId:randomUUID(),scope:job.context.scope,contextHash:job.row.context_hash,observation:candidate.observation});
      const payload=hashJson(annotation);const now=Date.now();
      database.prepare('INSERT INTO director_annotations VALUES(?,?,?,?,?,?,?,?,?)').run(annotation.annotationId,job.row.job_id,job.row.generation,job.row.run_id,job.row.pulse_id,job.row.through_world_seq,payload.json,payload.hash,now);
      const updated=database.prepare("UPDATE administrative_jobs SET state='accepted',updated_at=? WHERE job_id=? AND generation=? AND state='running' AND owner_token=? AND claim_token=?")
        .run(now,job.row.job_id,job.row.generation,request.execution.lease.ownerToken,request.execution.lease.claimToken);if(updated.changes!==1)throw new Error('CAS Director cambió antes de aceptación');
      return DirectorJobReceiptSchema.parse({annotation,acceptedAt:now});
    });},
    failAdministrativeJob(input:unknown){const request=z.strictObject({execution:AdministrativeJobExecutionSchema,code:AdministrativeJobFailureSchema}).parse(input);return transact(()=>{
      const {row}=administrativeJobRow(request.execution.scope);
      if(canonicalJson(administrativeExecution(row,administrativeJobRow(request.execution.scope).context))!==canonicalJson(request.execution))throw new Error('Fallo administrativo de otro claim');
      if(row.state==='accepted'||row.state==='blocked')return administrativeJobView(row);
      const now=Date.now();database.prepare("UPDATE administrative_jobs SET state='blocked',failure_code=?,updated_at=? WHERE job_id=? AND generation=? AND state='running'").run(request.code,now,row.job_id,row.generation);
      finishStepJob(row.run_id,'failed');
      const paused=database.prepare("UPDATE world_runs SET lifecycle='paused',lifecycle_revision=lifecycle_revision+1,updated_at=? WHERE run_id=? AND lifecycle='running' AND lifecycle_revision=?").run(now,row.run_id,row.lifecycle_revision);
      if(paused.changes===1)blockRunningActorJobs(row.run_id,now);
      return administrativeJobView(administrativeJobRow(request.execution.scope).row);
    });},
    recoverAbandonedAdministrativeJobs(input:unknown){const {ownerToken}=ActorTurnJobRecoverySchema.parse(input);return Number(transact(()=>database.prepare("UPDATE administrative_jobs SET state='blocked',failure_code='recovery-required',updated_at=? WHERE state='running' AND owner_token<>?").run(Date.now(),ownerToken).changes));},

    interruptRunStepJob(input: unknown) {
      const {runId} = z.strictObject({runId:RunIdSchema}).parse(input);
      return transact(() => {
        const job = activeStepJob(runId);
        if (job === undefined) return undefined;
        const now = Date.now();
        database.prepare("UPDATE run_step_jobs SET state='interrupted',revision=revision+1,updated_at=? WHERE job_id=?").run(now,job.jobId);
        database.prepare("UPDATE world_runs SET lifecycle='paused',lifecycle_revision=lifecycle_revision+1,updated_at=? WHERE run_id=? AND lifecycle='running' AND lifecycle_revision=?")
          .run(now,runId,job.lifecycleRevision);
        blockRunningActorJobs(runId,now);
        return stepJobView({runId,jobId:job.jobId});
      });
    },

    readRunStepJob(input: unknown) {
      return stepJobView(z.strictObject({runId:RunIdSchema,jobId:JobIdSchema}).parse(input));
    },
    readActiveRunStepJob(input: unknown) {
      return activeStepJob(z.strictObject({runId:RunIdSchema}).parse(input).runId);
    },
    completeRunStepJob(input: unknown) {
      const request = z.strictObject({runId:RunIdSchema,jobId:JobIdSchema,failed:z.boolean().default(false)}).parse(input);
      return transact(() => {
        const job = stepJobView(request);
        if (job === undefined || (job.state !== 'running' && job.state !== 'queued')) return job;
        if (job.pulseId === null) return finishStepJob(request.runId,request.failed ? 'failed' : 'succeeded');
        const pulse = coordinatorPulseView({runId:request.runId,pulseId:job.pulseId});
        if (pulse === undefined || pulse.state === 'running') return job;
        const undelivered = database.prepare(`SELECT d.state FROM world_deliveries d
          JOIN world_perceptions p ON p.perception_id=d.perception_id
          JOIN world_proposals w ON w.run_id=p.run_id AND w.attempt_id=p.origin_id AND p.origin_kind='actorAttempt'
          JOIN actor_turn_jobs a ON a.run_id=w.run_id AND a.job_id=w.job_id AND a.generation=w.generation
          WHERE a.run_id=? AND a.pulse_id=? AND d.state<>'delivered' LIMIT 1`).get(request.runId,job.pulseId);
        return finishStepJob(request.runId,request.failed || pulse.state === 'blocked' || undelivered !== undefined ? 'failed' : 'succeeded');
      });
    },

    advanceRoutineClock(input: unknown) {
      const request=RoutineClockAdvanceRequestSchema.parse(input);
      return transact(()=>{
        const requestHash=hashJson({runId:request.runId}).hash;
        const prior=database.prepare('SELECT request_hash,result_json,result_hash FROM routine_clock_advances WHERE run_id=? AND operation_id=?')
          .get(request.runId,request.operationId);
        if(prior!==undefined){
          const row=z.strictObject({request_hash:HashSchema,result_json:z.string(),result_hash:HashSchema}).parse(prior);
          if(row.request_hash!==requestHash)throw new Error('El ID de avance de reloj ya identifica otra solicitud');
          if(sha256(row.result_json)!==row.result_hash)throw new Error('Hash de recibo de avance ficticio no coincide');
          const result=RoutineClockAdvanceResultSchema.parse(parseStoredJson(row.result_json));
          if(canonicalJson(result)!==row.result_json||result.kind!=='advanced')throw new Error('Recibo de avance ficticio no canónico');
          return RoutineClockAdvanceResultSchema.parse({...result,kind:'existing'});
        }
        const value=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
        if(value===undefined)return RoutineClockAdvanceResultSchema.parse({kind:'notApplicable',reason:'inactive',worldRevision:null,lifecycleRevision:null});
        const run=parseWorldRun(value);
        const notApplicable=(reason:'inactive'|'policy'|'no-active-scene'|'no-boundary'|'boundary-too-far'|'step-bound'|'work-pending')=>
          RoutineClockAdvanceResultSchema.parse({kind:'notApplicable',reason,worldRevision:run.row.world_revision,lifecycleRevision:run.row.lifecycle_revision});
        if(run.row.lifecycle!=='running')return notApplicable('inactive');
        const configuration=ReadyRunConfigurationSchema.parse(run.configuration);
        if(configuration.circadianPolicy.kind!=='advance-while-running')return notApplicable('policy');
        if(!run.snapshot.scenes.some(scene=>scene.id===run.snapshot.activeSceneId&&scene.lifecycle.kind==='open'))
          return notApplicable('no-active-scene');
        const step=activeStepJob(request.runId);
        if(step?.pulseId!==undefined&&step.pulseId!==null)return notApplicable('step-bound');
        const workPending=database.prepare(`SELECT 1 FROM coordinator_pulses WHERE run_id=? AND state='running'
          UNION ALL SELECT 1 FROM actor_turn_jobs WHERE run_id=? AND state IN('queued','running')
          UNION ALL SELECT 1 FROM continuista_jobs WHERE run_id=? AND state IN('queued','running')
          UNION ALL SELECT 1 FROM administrative_jobs WHERE run_id=? AND state='running' LIMIT 1`)
          .get(request.runId,request.runId,request.runId,request.runId);
        if(workPending!==undefined)return notApplicable('work-pending');
        const boundaryAt=nextRoutineAdvance({snapshot:run.snapshot,policy:configuration.circadianPolicy,lifecycle:run.row.lifecycle,activeCharacterIds:configuration.roster.activeCharacterIds});
        if(boundaryAt===undefined){
          const hasFutureBoundary=nextWorldTimeBoundary(run.snapshot,configuration.roster.activeCharacterIds)!==undefined;
          return notApplicable(hasFutureBoundary?'boundary-too-far':'no-boundary');
        }
        const fromAt=run.snapshot.clock.instant;
        const toAt=FictionalInstantSchema.parse(boundaryAt);
        const durationMs=toAt-fromAt;
        const timestamp=Date.now();
        const operationId=request.operationId;
        const event=WorldEventSchema.parse({id:EventIdSchema.parse(randomUUID()),runId:request.runId,
          seq:WorldSeqSchema.parse(run.snapshot.seq+1),fictitiousAt:fromAt,durationMs,
          origin:{kind:'system',causeClockAdvanceId:operationId},kind:'clockAdvanced',fromAt,toAt});
        const events=[event];
        let offers=run.snapshot.offers;
        const expiredOffers=offers.filter((offer)=>offer.state==='open'&&offer.expiresAt<=toAt)
          .sort((left,right)=>left.expiresAt-right.expiresAt||left.id.localeCompare(right.id));
        for(const offer of expiredOffers){
          const invalidated=WorldEventSchema.parse({id:EventIdSchema.parse(randomUUID()),runId:request.runId,
            seq:WorldSeqSchema.parse(run.snapshot.seq+events.length+1),fictitiousAt:offer.expiresAt,durationMs:0,
            origin:{kind:'system',causeClockAdvanceId:operationId},kind:'offerInvalidated',
            offerId:offer.id,objectEntityId:offer.objectEntityId,cause:'expired'});
          events.push(invalidated);
          offers=offers.map((current)=>current.id===offer.id&&current.state==='open'
            ?WorldOfferSchema.parse({...current,state:'invalidated',cause:'expired',eventId:invalidated.id}):current);
        }
        const newSnapshot=WorldSnapshotSchema.parse({...run.snapshot,revision:RevisionSchema.parse(run.snapshot.revision+1),
          seq:WorldSeqSchema.parse(run.snapshot.seq+events.length),clock:{...run.snapshot.clock,instant:toAt},offers});
        const commitIndex=RevisionSchema.parse(run.row.commit_index+1);
        const snapshotPayload=hashJson(newSnapshot);
        const updated=database.prepare(`UPDATE world_runs SET world_revision=?,last_seq=?,commit_index=?,snapshot_json=?,snapshot_hash=?,updated_at=?
          WHERE run_id=? AND world_revision=? AND lifecycle_revision=? AND config_revision=? AND commit_index=?`)
          .run(newSnapshot.revision,newSnapshot.seq,commitIndex,snapshotPayload.json,snapshotPayload.hash,timestamp,request.runId,
            run.row.world_revision,run.row.lifecycle_revision,run.row.config_revision,run.row.commit_index);
        if(updated.changes!==1)return RoutineClockAdvanceResultSchema.parse({kind:'stale',worldRevision:run.row.world_revision,
          lifecycleRevision:run.row.lifecycle_revision});
        database.prepare(`INSERT INTO world_commits(run_id,origin_kind,origin_id,commit_index,world_revision,last_seq,snapshot_json,snapshot_hash,created_at)
          VALUES(?,'clockAdvance',?,?,?,?,?,?,?)`).run(request.runId,operationId,commitIndex,newSnapshot.revision,newSnapshot.seq,
            snapshotPayload.json,snapshotPayload.hash,timestamp);
        for(const confirmedEvent of events){
          const eventPayload=hashJson(confirmedEvent);
          database.prepare('INSERT INTO world_events(event_id,run_id,world_seq,origin_id,payload_json,payload_hash) VALUES(?,?,?,?,?,?)')
            .run(confirmedEvent.id,request.runId,confirmedEvent.seq,operationId,eventPayload.json,eventPayload.hash);
        }
        const committedRun=parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId));
        const activationIds=admitRoutineBoundaryActivations(committedRun,configuration,fromAt,timestamp)
          .map((activationId)=>ActorActivationIdSchema.parse(activationId));
        const result=RoutineClockAdvanceResultSchema.parse({kind:'advanced',operationId,eventId:event.id,commitIndex,
          worldRevision:newSnapshot.revision,worldSeq:newSnapshot.seq,activationIds});
        const resultPayload=hashJson(result);
        database.prepare(`INSERT INTO routine_clock_advances(run_id,operation_id,request_hash,result_json,result_hash,from_revision,to_revision,
          from_at,to_at,event_id,commit_index,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(request.runId,operationId,requestHash,resultPayload.json,resultPayload.hash,run.row.world_revision,newSnapshot.revision,
            fromAt,toAt,event.id,commitIndex,timestamp);
        return result;
      });
    },

    beginCoordinatorPulse(input: unknown) {
      const request = CoordinatorPulseRequestSchema.parse(input);
      return transact(() => {
        const value = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
        if (value === undefined) return CoordinatorPulseBeginResultSchema.parse({ kind: 'inactive' });
        const run = parseWorldRun(value);
        if (run.row.lifecycle !== 'running') return CoordinatorPulseBeginResultSchema.parse({ kind: 'inactive' });
        const step = activeStepJob(request.runId);
        const bindStep = (pulseId: z.infer<typeof PulseIdSchema>) => {
          if (step !== undefined && step.pulseId === null) database.prepare("UPDATE run_step_jobs SET pulse_id=?,state='running',revision=revision+1,updated_at=? WHERE job_id=? AND pulse_id IS NULL").run(pulseId,Date.now(),step.jobId);
        };
        if (step?.pulseId !== undefined && step.pulseId !== null) {
          const pulse = coordinatorPulseView({runId:request.runId,pulseId:step.pulseId});
          if (pulse === undefined) throw new Error('El paso perdió su pulso durable');
          if (pulse.state !== 'running') return CoordinatorPulseBeginResultSchema.parse({kind:'existing',pulse,jobs:pulse.jobs});
        }
        const configuration = ReadyRunConfigurationSchema.parse(run.configuration);
        if (configuration.runId !== request.runId || configuration.configRevision !== run.row.config_revision) throw new Error('Configuración ready ajena al pulso');
        const running = database.prepare(`SELECT pulse_id FROM coordinator_pulses WHERE run_id=? AND state='running'`).get(request.runId);
        if (running !== undefined) {
          const pulseId = z.strictObject({ pulse_id: PulseIdSchema }).parse(running).pulse_id;
          bindStep(pulseId);
          const pulse = coordinatorPulseView({ runId: request.runId, pulseId });
          if (pulse === undefined) throw new Error('Pulso durable perdido');
          if (pulse.lifecycleRevision !== run.row.lifecycle_revision) {
            const now = Date.now();
            const staleJobs = database.prepare(`SELECT run_id,actor_id,job_id,generation FROM actor_turn_jobs
              WHERE run_id=? AND pulse_id=? AND state IN('queued','running')`).all(request.runId,pulseId).map((item) => z.strictObject({
                run_id:RunIdSchema,actor_id:CharacterIdSchema,job_id:JobIdSchema,generation:counter,
              }).parse(item));
            for (const stale of staleJobs) {
              database.prepare(`UPDATE actor_turn_jobs SET state='blocked',failure_code='job-inactive',updated_at=?
                WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND state IN('queued','running')`)
                .run(now,stale.run_id,stale.actor_id,stale.job_id,stale.generation);
              database.prepare(`UPDATE actor_turn_job_inputs SET state='released' WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND state='assigned'`)
                .run(stale.run_id,stale.actor_id,stale.job_id,stale.generation);
              database.prepare(`UPDATE continuista_jobs SET state='blocked',failure_code='job-inactive',updated_at=?
                WHERE actor_job_id=? AND actor_generation=? AND state='running'`)
                .run(now,stale.job_id,stale.generation);
            }
            database.prepare(`UPDATE coordinator_pulses SET state='blocked',updated_at=? WHERE run_id=? AND pulse_id=? AND state='running'`)
              .run(now,request.runId,pulseId);
            if(pulse.cause.kind==='actorActivation'){
              database.prepare(`UPDATE actor_activation_invitations SET state='blocked',failure_reason='lifecycle_epoch_changed',updated_at=?
                WHERE activation_id=? AND state IN('pending','assigned')`).run(now,pulse.cause.id);
              database.prepare(`UPDATE actor_activation_causes SET state='blocked',failure_reason='lifecycle_epoch_changed',updated_at=?
                WHERE run_id=? AND activation_id=? AND state IN('pending','running')`).run(now,request.runId,pulse.cause.id);
            }
            return CoordinatorPulseBeginResultSchema.parse({kind:'existing',pulse:coordinatorPulseView({runId:request.runId,pulseId})!,jobs:coordinatorPulseView({runId:request.runId,pulseId})!.jobs});
          }
          assignCoordinatorCauseJobs(run,configuration,pulse);
          const refreshed = coordinatorPulseView({runId:request.runId,pulseId});
          if (refreshed === undefined) throw new Error('Pulso durable perdido al asignar');
          return CoordinatorPulseBeginResultSchema.parse({ kind: 'existing', pulse: refreshed, jobs: refreshed.jobs });
        }
        const pending = database.prepare(`SELECT i.actor_id,i.perception_id,p.origin_kind,p.origin_id,c.commit_index
          FROM actor_turn_intents i JOIN world_deliveries d ON d.perception_id=i.perception_id
          JOIN world_perceptions p ON p.perception_id=i.perception_id
          JOIN world_commits c ON c.run_id=p.run_id AND c.origin_kind=p.origin_kind AND c.origin_id=p.origin_id
          WHERE i.run_id=? AND i.state='queued' AND d.state='delivered'
            AND NOT EXISTS(SELECT 1 FROM actor_turn_job_inputs a WHERE a.perception_id=i.perception_id AND a.state IN('assigned','consumed'))
          ORDER BY c.commit_index,i.actor_id,i.perception_id LIMIT 100001`).all(request.runId).map((item) => z.strictObject({
            actor_id: CharacterIdSchema, perception_id: PerceptionIdSchema, origin_kind: z.enum(['humanIntervention','actorAttempt','directionCircumstance']), origin_id: z.string(), commit_index: counter }).parse(item));
        if (pending.length > 100_000) throw new Error('Demasiadas intenciones para coordinar un pulso');
        const cause = pending[0];
        if (cause === undefined) {
          let discardedActivation=false;
          while(true){
            const activationValue=database.prepare(`SELECT activation_id FROM actor_activation_causes
              WHERE run_id=? AND state='pending' ORDER BY created_at,activation_id LIMIT 1`).get(request.runId);
            if(activationValue===undefined)break;
            const activationId=z.strictObject({activation_id:ActorActivationIdSchema}).parse(activationValue).activation_id;
            const invitationRows=database.prepare(`SELECT invitation_id,actor_id FROM actor_activation_invitations
              WHERE activation_id=? AND state='pending' ORDER BY actor_id,invitation_id`).all(activationId)
              .map((item)=>z.strictObject({invitation_id:ActorActivationInvitationIdSchema,actor_id:CharacterIdSchema}).parse(item));
            const eligible:typeof invitationRows=[];
            const timestamp=Date.now();
            for(const invitation of invitationRows){
              const ineligibility=activationInvitationIneligibility({run,configuration,invitationId:invitation.invitation_id});
              if(ineligibility!==undefined){blockActivationInvitation(invitation.invitation_id,ineligibility,timestamp);continue;}
              const activeJob=database.prepare(`SELECT 1 FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND state IN('queued','running') LIMIT 1`)
                .get(request.runId,invitation.actor_id);
              if(activeJob===undefined)eligible.push(invitation);
              else blockActivationInvitation(invitation.invitation_id,'actor_job_active',timestamp);
            }
            if(eligible.length===0){
              const remaining=database.prepare("SELECT 1 FROM actor_activation_invitations WHERE activation_id=? AND state='pending' LIMIT 1").get(activationId);
              if(remaining!==undefined)return CoordinatorPulseBeginResultSchema.parse({kind:'idle'});
              database.prepare(`UPDATE actor_activation_causes SET state='blocked',failure_reason='no-eligible-invitations',updated_at=?
                WHERE run_id=? AND activation_id=? AND state='pending'`).run(timestamp,request.runId,activationId);
              discardedActivation=true;
              continue;
            }
            const existingBudget=database.prepare('SELECT max_calls,consumed FROM run_budgets WHERE run_id=?').get(request.runId);
            if(existingBudget===undefined)database.prepare('INSERT INTO run_budgets(run_id,max_calls) VALUES(?,?)')
              .run(request.runId,configuration.budget.maxPiCallsPerRun);
            else if(budgetRow.parse(existingBudget).max_calls!==configuration.budget.maxPiCallsPerRun)throw new Error('Presupuesto run difiere de configuración ready');
            ensureModelTimeRunState(request.runId);
            const pulseId=PulseIdSchema.parse(randomUUID());
            database.prepare('INSERT INTO pulses(pulse_id,run_id,max_calls) VALUES(?,?,?)')
              .run(pulseId,request.runId,configuration.budget.maxPiCallsPerPulse);
            database.prepare(`INSERT INTO coordinator_pulses(pulse_id,run_id,origin_kind,origin_id,commit_index,configuration_hash,state,
              created_at,updated_at,lifecycle_revision) VALUES(?,?, 'actorActivation', ?,NULL,?,'running',?,?,?)`)
              .run(pulseId,request.runId,activationId,run.row.configuration_hash,timestamp,timestamp,run.row.lifecycle_revision);
            const causeUpdated=database.prepare(`UPDATE actor_activation_causes SET state='running',updated_at=?
              WHERE run_id=? AND activation_id=? AND state='pending'`)
              .run(timestamp,request.runId,activationId);
            if(causeUpdated.changes!==1)throw new Error('La convocatoria inicial cambió antes de abrir el pulso');
            for(const invitation of eligible){
              const jobId=JobIdSchema.parse(randomUUID());
              database.prepare(`INSERT INTO actor_turn_jobs(run_id,actor_id,job_id,generation,pulse_id,state,owner_token,claim_token,
                created_at,updated_at,lifecycle_revision) VALUES(?,?,?,0,?,'queued',NULL,NULL,?,?,?)`)
                .run(request.runId,invitation.actor_id,jobId,pulseId,timestamp,timestamp,run.row.lifecycle_revision);
              database.prepare(`INSERT INTO actor_activation_invitation_jobs(run_id,invitation_id,actor_id,job_id,generation,assigned_at)
                VALUES(?,?,?,?,0,?)`).run(request.runId,invitation.invitation_id,invitation.actor_id,jobId,timestamp);
              const assigned=database.prepare(`UPDATE actor_activation_invitations SET state='assigned',updated_at=?
                WHERE invitation_id=? AND state='pending'`).run(timestamp,invitation.invitation_id);
              if(assigned.changes!==1)throw new Error('La invitación cambió antes de asignarse al job técnico');
            }
            bindStep(pulseId);
            const pulse=coordinatorPulseView({runId:request.runId,pulseId});
            if(pulse===undefined)throw new Error('Pulso técnico no persistido');
            return CoordinatorPulseBeginResultSchema.parse({kind:'started',pulse,jobs:pulse.jobs});
          }
          if (step !== undefined && request.emptyStepPolicy === 'complete') finishStepJob(request.runId,discardedActivation?'failed':'succeeded');
          return CoordinatorPulseBeginResultSchema.parse({ kind: 'idle' });
        }
        const previous = database.prepare('SELECT pulse_id FROM coordinator_pulses WHERE run_id=? AND origin_kind=? AND origin_id=?')
          .get(request.runId, cause.origin_kind, cause.origin_id);
        if (previous !== undefined) {
          const pulseId = z.strictObject({ pulse_id: PulseIdSchema }).parse(previous).pulse_id;
          const pulse = coordinatorPulseView({ runId: request.runId, pulseId });
          if (pulse === undefined) throw new Error('Pulso de causa perdido');
          bindStep(pulseId);
          return CoordinatorPulseBeginResultSchema.parse({ kind: 'existing', pulse, jobs: pulse.jobs });
        }
        const scene = run.snapshot.scenes.find((item) => item.id === run.snapshot.activeSceneId);
        const causeInputs = pending.filter((item) => item.origin_kind === cause.origin_kind && item.origin_id === cause.origin_id);
        const eligible = [...new Set(causeInputs.map((item) => item.actor_id))].filter((actorId) => {
          const actor = run.snapshot.entities.find((item) => item.kind === 'character' && item.characterId === actorId);
          return configuration.roster.activeCharacterIds.includes(actorId)
            && configuration.roster.preparedCharacters.some((item) => item.characterId === actorId && item.identityVersion === (actor?.kind === 'character' && actor.preparation.kind === 'prepared' ? actor.preparation.identityVersion : -1)) && scene?.lifecycle.kind === 'open'
            && scene.participantIds.includes(actorId) && actor?.kind === 'character' && actor.preparation.kind === 'prepared'
            && actor.presence.kind === 'present' && actor.presence.sceneId === scene.id
            && characterCanReceiveAt({snapshot:run.snapshot,characterId:actorId})
            && database.prepare(`SELECT 1 FROM actor_turn_jobs j WHERE run_id=? AND actor_id=? AND state IN('queued','running','blocked')
              AND NOT EXISTS(SELECT 1 FROM actor_turn_jobs newer WHERE newer.job_id=j.job_id AND newer.generation>j.generation) LIMIT 1`).get(request.runId, actorId) === undefined;
        });
        if (eligible.length === 0) {
          if (step !== undefined) finishStepJob(request.runId,'failed');
          return CoordinatorPulseBeginResultSchema.parse({ kind: 'idle' });
        }
        const existingBudget = database.prepare('SELECT max_calls,consumed FROM run_budgets WHERE run_id=?').get(request.runId);
        if (existingBudget === undefined) database.prepare('INSERT INTO run_budgets(run_id,max_calls) VALUES(?,?)').run(request.runId, configuration.budget.maxPiCallsPerRun);
        else if (budgetRow.parse(existingBudget).max_calls !== configuration.budget.maxPiCallsPerRun) throw new Error('Presupuesto run difiere de configuración ready');
        ensureModelTimeRunState(request.runId);
        const pulseId = PulseIdSchema.parse(randomUUID());
        const timestamp = Date.now();
        database.prepare('INSERT INTO pulses(pulse_id,run_id,max_calls) VALUES(?,?,?)').run(pulseId, request.runId, configuration.budget.maxPiCallsPerPulse);
        database.prepare(`INSERT INTO coordinator_pulses(
          pulse_id,run_id,origin_kind,origin_id,commit_index,configuration_hash,state,created_at,updated_at,lifecycle_revision
        ) VALUES(?,?,?,?,?,?,'running',?,?,?)`)
          .run(pulseId, request.runId, cause.origin_kind, cause.origin_id, cause.commit_index, run.row.configuration_hash, timestamp, timestamp, run.row.lifecycle_revision);
        for (const actorId of eligible) {
          const jobId = JobIdSchema.parse(randomUUID());
          database.prepare(`INSERT INTO actor_turn_jobs(run_id,actor_id,job_id,generation,pulse_id,state,owner_token,claim_token,created_at,updated_at,lifecycle_revision)
            VALUES(?,?,?,0,?,'queued',NULL,NULL,?,?,?)`).run(request.runId, actorId, jobId, pulseId, timestamp, timestamp, run.row.lifecycle_revision);
          for (const perception of causeInputs.filter((item) => item.actor_id === actorId)) database.prepare(`INSERT INTO actor_turn_job_inputs(
            run_id,actor_id,job_id,generation,perception_id,state,assigned_at,consumed_at) VALUES(?,?,?,0,?,'assigned',?,NULL)`)
            .run(request.runId, actorId, jobId, perception.perception_id, timestamp);
        }
        bindStep(pulseId);
        const pulse = coordinatorPulseView({ runId: request.runId, pulseId });
        if (pulse === undefined) throw new Error('Pulso no persistido');
        return CoordinatorPulseBeginResultSchema.parse({ kind: 'started', pulse, jobs: pulse.jobs });
      });
    },

    readCoordinatorPulse(input: unknown) { return coordinatorPulseView(CoordinatorPulseLookupSchema.parse(input)); },
    listActorTurnJobsForPulse(input: unknown) { return coordinatorPulseView(CoordinatorPulseLookupSchema.parse(input))?.jobs ?? []; },
    listCoordinatorPulseTargets(input: unknown = {}) {
      const request = z.strictObject({ limit: counter.min(1).max(1_000).default(100) }).parse(input);
      return database.prepare(`SELECT run_id FROM world_runs r WHERE lifecycle='running' AND
        (EXISTS(SELECT 1 FROM run_step_jobs s WHERE s.run_id=r.run_id AND s.state IN('queued','running')) OR
         EXISTS(SELECT 1 FROM coordinator_pulses c WHERE c.run_id=r.run_id AND c.state='running') OR
         EXISTS(SELECT 1 FROM actor_turn_intents i JOIN world_deliveries d ON d.perception_id=i.perception_id
           WHERE i.run_id=r.run_id AND i.state='queued' AND d.state='delivered'
           AND NOT EXISTS(SELECT 1 FROM actor_turn_job_inputs a WHERE a.perception_id=i.perception_id AND a.state IN('assigned','consumed'))) OR
         EXISTS(SELECT 1 FROM actor_activation_causes a WHERE a.run_id=r.run_id AND a.state='pending'))
        ORDER BY run_id LIMIT ?`).all(request.limit).map((item) => z.strictObject({ run_id: RunIdSchema }).parse(item)).map((item) => ({ runId: item.run_id }));
    },
    closeCoordinatorPulse(input: unknown) {
      const request = CoordinatorPulseLookupSchema.parse(input);
      return transact(() => {
        const pulse = coordinatorPulseView(request);
        if (pulse === undefined) throw new Error('Pulso coordinador inexistente');
        if (pulse.state !== 'running') return pulse;
        const awaiting = pulse.cause.kind==='actorActivation' ? false : database.prepare(`SELECT 1 FROM actor_turn_intents i JOIN world_perceptions p ON p.perception_id=i.perception_id
          WHERE i.run_id=? AND p.origin_kind=? AND p.origin_id=?
            AND NOT EXISTS(SELECT 1 FROM actor_turn_job_inputs a WHERE a.perception_id=i.perception_id AND a.state IN('assigned','consumed'))
            AND NOT EXISTS(SELECT 1 FROM actor_turn_job_inputs a JOIN actor_turn_jobs j ON j.run_id=a.run_id AND j.actor_id=a.actor_id AND j.job_id=a.job_id AND j.generation=a.generation
              WHERE a.perception_id=i.perception_id AND j.pulse_id=? AND j.state='blocked'
                AND NOT EXISTS(SELECT 1 FROM actor_turn_jobs newer WHERE newer.job_id=j.job_id AND newer.generation>j.generation)) LIMIT 1`)
          .get(pulse.runId,pulse.cause.kind,pulse.cause.id,pulse.pulseId) !== undefined;
        const terminal = pulse.jobs.every((job) => {
          if (job.state === 'blocked') return true;
          if (job.state !== 'accepted') return false;
          const proposal = acceptedActorJobProposal({runId:job.runId,actorId:job.actorId,jobId:job.jobId,generation:job.generation});
          if (proposal === undefined) return false;
          return database.prepare(`SELECT 1 FROM world_commits WHERE run_id=? AND origin_kind='actorAttempt' AND origin_id=?`)
            .get(job.runId,proposal.attemptId) !== undefined;
        });
        const admins=database.prepare(`SELECT state FROM administrative_jobs j WHERE run_id=? AND pulse_id=?
          AND NOT EXISTS(SELECT 1 FROM administrative_jobs newer WHERE newer.job_id=j.job_id AND newer.generation>j.generation)`)
          .all(request.runId,request.pulseId).map(value=>z.strictObject({state:z.enum(['running','accepted','blocked'])}).parse(value));
        const adminsTerminal=admins.every(job=>job.state!=='running');
        if (terminal && !awaiting && adminsTerminal) {
          const now=Date.now();
          if(pulse.cause.kind==='actorActivation'){
            database.prepare(`UPDATE actor_activation_invitations SET state=CASE WHEN EXISTS(
                SELECT 1 FROM actor_activation_invitation_jobs j JOIN actor_turn_jobs a
                  ON a.run_id=j.run_id AND a.actor_id=j.actor_id AND a.job_id=j.job_id AND a.generation=j.generation
                WHERE j.run_id=actor_activation_invitations.run_id AND j.invitation_id=actor_activation_invitations.invitation_id
                  AND a.state='accepted') THEN 'consumed' ELSE 'blocked' END,
              failure_reason=CASE WHEN EXISTS(SELECT 1 FROM actor_activation_invitation_jobs j JOIN actor_turn_jobs a
                ON a.run_id=j.run_id AND a.actor_id=j.actor_id AND a.job_id=j.job_id AND a.generation=j.generation
                WHERE j.run_id=actor_activation_invitations.run_id AND j.invitation_id=actor_activation_invitations.invitation_id
                  AND a.state='accepted') THEN NULL ELSE COALESCE(failure_reason,'actor-job-blocked') END,updated_at=?
              WHERE activation_id=? AND state='assigned'`).run(now,pulse.cause.id);
            database.prepare(`UPDATE actor_activation_invitations SET state='blocked',failure_reason='activation-pulse-closed',updated_at=?
              WHERE activation_id=? AND state='pending'`).run(now,pulse.cause.id);
          }
          const blockedInvitations=pulse.cause.kind==='actorActivation'
            &&database.prepare("SELECT 1 FROM actor_activation_invitations WHERE activation_id=? AND state='blocked' LIMIT 1").get(pulse.cause.id)!==undefined;
          const terminalState=pulse.jobs.some((job) => job.state === 'blocked') || admins.some(job=>job.state==='blocked') || blockedInvitations
            ? 'blocked' : 'completed';
          database.prepare(`UPDATE coordinator_pulses SET state=?,updated_at=? WHERE run_id=? AND pulse_id=? AND state='running'`)
            .run(terminalState,now,request.runId,request.pulseId);
          if(pulse.cause.kind==='actorActivation')database.prepare(`UPDATE actor_activation_causes SET state=?,failure_reason=?,updated_at=?
            WHERE run_id=? AND activation_id=? AND state IN('pending','running')`)
            .run(terminalState,terminalState==='blocked'?'invitation-blocked':null,now,request.runId,pulse.cause.id);
        }
        const closed = coordinatorPulseView(request);
        if (closed === undefined) throw new Error('Pulso perdió registro al cerrar');
        return closed;
      });
    },

    scheduleActorTurnJob(input: unknown) {
      const request = ActorTurnJobScheduleSchema.parse(input);
      return transact(() => {
        const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
        if (runValue === undefined) throw new Error('World run del job actoral inexistente');
        const run = parseWorldRun(runValue);
        if (run.row.lifecycle !== 'running') return ActorTurnJobScheduleResultSchema.parse({kind:'empty'});
        const step = activeStepJob(request.runId);
        if (step !== undefined && step.pulseId !== request.pulseId) return ActorTurnJobScheduleResultSchema.parse({kind:'empty'});
        const pulseValue = database.prepare('SELECT run_id,max_calls,consumed FROM pulses WHERE pulse_id=?')
          .get(request.pulseId);
        if (pulseValue === undefined) throw new Error('El pulso del job actoral no está configurado');
        if (pulseRow.parse(pulseValue).run_id !== request.runId) throw new Error('El pulso pertenece a otra corrida');

        const activeValue = database.prepare(`
          SELECT * FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND state IN('queued','running')
        `).get(request.runId, request.actorId);
        if (activeValue === undefined) {
          const blocked = database.prepare(`SELECT * FROM actor_turn_jobs j
            WHERE run_id=? AND actor_id=? AND state='blocked'
              AND NOT EXISTS(SELECT 1 FROM actor_turn_jobs newer WHERE newer.job_id=j.job_id AND newer.generation>j.generation)
            ORDER BY updated_at DESC LIMIT 1`).get(request.runId, request.actorId);
          if (blocked !== undefined) return ActorTurnJobScheduleResultSchema.parse({ kind: 'blocked', job: actorTurnJobView(blocked) });
        } else {
          const activeRow = ActorTurnJobDbRowSchema.parse(activeValue);
          if (!actorJobEpochCurrent(activeRow,run)) {
            database.prepare(`UPDATE actor_turn_jobs SET state='blocked',failure_code='job-inactive',updated_at=?
              WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND state IN('queued','running')`)
              .run(Date.now(),activeRow.run_id,activeRow.actor_id,activeRow.job_id,activeRow.generation);
            database.prepare(`UPDATE actor_turn_job_inputs SET state='released' WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND state='assigned'`)
              .run(activeRow.run_id,activeRow.actor_id,activeRow.job_id,activeRow.generation);
            return ActorTurnJobScheduleResultSchema.parse({kind:'blocked',job:actorTurnJobView(database.prepare(`SELECT * FROM actor_turn_jobs
              WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?`).get(activeRow.run_id,activeRow.actor_id,activeRow.job_id,activeRow.generation))});
          }
        }
        const pending = database.prepare(`
          SELECT i.perception_id
          FROM actor_turn_intents i JOIN world_deliveries d ON d.perception_id=i.perception_id JOIN world_perceptions p ON p.perception_id=i.perception_id
          LEFT JOIN coordinator_pulses c ON c.pulse_id=?
          WHERE i.run_id=? AND i.actor_id=? AND i.state='queued' AND d.state='delivered' AND (c.pulse_id IS NULL OR (p.origin_kind=c.origin_kind AND p.origin_id=c.origin_id))
            AND NOT EXISTS(SELECT 1 FROM actor_turn_job_inputs a WHERE a.perception_id=i.perception_id AND a.state IN('assigned','consumed'))
          ORDER BY i.world_seq,i.perception_id LIMIT 100001
        `).all(request.pulseId, request.runId, request.actorId).map((value) =>
          z.strictObject({ perception_id: PerceptionIdSchema }).parse(value).perception_id);
        if (pending.length > 100_000) throw new Error('Hay demasiadas intenciones para un único job actoral');

        const timestamp = Date.now();
        if (activeValue !== undefined) {
          const activeRow = ActorTurnJobDbRowSchema.parse(activeValue);
          const activeJob = actorTurnJobView(activeValue);
          if (activeRow.state === 'running') {
            return ActorTurnJobScheduleResultSchema.parse({ kind: 'busy', job: activeJob });
          }
          if (activeRow.pulse_id !== request.pulseId || pending.length === 0
            || activeRow.frozen_perception_ids_json !== null || activeRow.frozen_world_cut_json !== null) {
            return ActorTurnJobScheduleResultSchema.parse({ kind: 'existing', job: activeJob });
          }
          for (const perceptionId of pending) {
            database.prepare(`
              INSERT INTO actor_turn_job_inputs(
                run_id,actor_id,job_id,generation,perception_id,state,assigned_at,consumed_at
              ) VALUES(?,?,?,?,?,'assigned',?,NULL)
            `).run(activeRow.run_id, activeRow.actor_id, activeRow.job_id, activeRow.generation, perceptionId, timestamp);
          }
          const updated = database.prepare(`
            UPDATE actor_turn_jobs SET updated_at=?
            WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND state='queued'
          `).run(timestamp, activeRow.run_id, activeRow.actor_id, activeRow.job_id, activeRow.generation);
          if (updated.changes !== 1) throw new Error('El job actoral cambió al incorporar intenciones');
          return ActorTurnJobScheduleResultSchema.parse({
            kind: 'coalesced', job: actorTurnJobView(database.prepare(`
              SELECT * FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?
            `).get(activeRow.run_id, activeRow.actor_id, activeRow.job_id, activeRow.generation)),
          });
        }

        if (pending.length === 0) return ActorTurnJobScheduleResultSchema.parse({ kind: 'empty' });
        const jobId = JobIdSchema.parse(randomUUID());
        const generation = RevisionSchema.parse(0);
        database.prepare(`
          INSERT INTO actor_turn_jobs(
            run_id,actor_id,job_id,generation,pulse_id,state,owner_token,claim_token,created_at,updated_at,lifecycle_revision
          ) VALUES(?,?,?,?,?,'queued',NULL,NULL,?,?,?)
        `).run(request.runId, request.actorId, jobId, generation, request.pulseId, timestamp, timestamp, run.row.lifecycle_revision);
        for (const perceptionId of pending) {
          database.prepare(`
            INSERT INTO actor_turn_job_inputs(
              run_id,actor_id,job_id,generation,perception_id,state,assigned_at,consumed_at
            ) VALUES(?,?,?,?,?,'assigned',?,NULL)
          `).run(request.runId, request.actorId, jobId, generation, perceptionId, timestamp);
        }
        const row = database.prepare(`
          SELECT * FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?
        `).get(request.runId, request.actorId, jobId, generation);
        return ActorTurnJobScheduleResultSchema.parse({ kind: 'scheduled', job: actorTurnJobView(row) });
      });
    },

    /** Claim is idempotent for the same host+claim pair and busy for every other claimant. */
    claimActorTurnJob(input: unknown) {
      const request = ActorTurnJobClaimSchema.parse(input);
      return transact(() => {
        const rowValue = database.prepare(`
          SELECT * FROM actor_turn_jobs
          WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?
        `).get(request.runId, request.actorId, request.jobId, request.generation);
        if (rowValue === undefined) return ActorTurnJobClaimResultSchema.parse({ kind: 'missing' });
        const row = ActorTurnJobDbRowSchema.parse(rowValue);
        const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
        if (runValue === undefined) return ActorTurnJobClaimResultSchema.parse({kind:'missing'});
        const run = parseWorldRun(runValue);
        if ((row.state === 'queued' || row.state === 'running') && !actorJobEpochCurrent(row,run)) {
          const now = Date.now();
          database.prepare(`UPDATE actor_turn_jobs SET state='blocked',failure_code='job-inactive',updated_at=?
            WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND state IN('queued','running')`)
            .run(now,row.run_id,row.actor_id,row.job_id,row.generation);
          database.prepare(`UPDATE actor_turn_job_inputs SET state='released' WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND state='assigned'`)
            .run(row.run_id,row.actor_id,row.job_id,row.generation);
          const blocked = database.prepare(`SELECT * FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?`)
            .get(row.run_id,row.actor_id,row.job_id,row.generation);
          return ActorTurnJobClaimResultSchema.parse({kind:'blocked',job:actorTurnJobView(blocked)});
        }
        if(row.state==='queued'){
          const invitationId=actorActivationInvitationForJob({runId:row.run_id,actorId:row.actor_id,jobId:row.job_id,generation:row.generation});
          if(invitationId!==undefined){
            const reason=activationInvitationIneligibility({run,configuration:ReadyRunConfigurationSchema.parse(run.configuration),invitationId});
            if(reason!==undefined){
              const now=Date.now();
              blockActivationInvitation(invitationId,reason,now);
              database.prepare(`UPDATE actor_turn_jobs SET state='blocked',failure_code='job-inactive',updated_at=?
                WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND state='queued'`)
                .run(now,row.run_id,row.actor_id,row.job_id,row.generation);
              const blocked=database.prepare(`SELECT * FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?`)
                .get(row.run_id,row.actor_id,row.job_id,row.generation);
              return ActorTurnJobClaimResultSchema.parse({kind:'blocked',job:actorTurnJobView(blocked)});
            }
          }
        }
        const job = actorTurnJobView(rowValue);
        if (row.state === 'accepted') return ActorTurnJobClaimResultSchema.parse({ kind: 'accepted', job });
        if (row.state === 'blocked') return ActorTurnJobClaimResultSchema.parse({ kind: 'blocked', job });
        if (row.state === 'running') {
          if (row.owner_token === request.ownerToken && row.claim_token === request.claimToken) {
            assertJobIdentityBinding(row,run);
            return ActorTurnJobClaimResultSchema.parse({
              kind: 'existing', job, ownerToken: request.ownerToken, claimToken: request.claimToken,
            });
          }
          return ActorTurnJobClaimResultSchema.parse({ kind: 'busy' });
        }
        let frozenPerceptionIds = frozenActorTurnPerceptionIds(row);
        let frozenWorldCut = frozenActorTurnWorldCut(row);
        if (frozenPerceptionIds === null || frozenWorldCut === null) {
          if (frozenPerceptionIds === null) {
            const coordinated = database.prepare('SELECT 1 FROM coordinator_pulses WHERE pulse_id=? AND run_id=?').get(row.pulse_id, row.run_id) !== undefined;
            frozenPerceptionIds = coordinated ? assignedActorTurnPerceptionIds(request) : actorPerceptionIdsAvailableAtCut({
              runId: request.runId, actorId: request.actorId,
              cut: {
                worldRevision: run.snapshot.revision, worldSeq: run.snapshot.seq,
                fictionalAt: run.snapshot.clock.instant, perceptionIds: [],
              },
            });
          }
          if (frozenWorldCut === null) {
            frozenWorldCut = FrozenActorWorldCutSchema.parse({
              worldRevision: run.snapshot.revision,
              worldSeq: run.snapshot.seq,
              fictionalAt: run.snapshot.clock.instant,
              perceptionIds: frozenPerceptionIds,
              activeSceneId: run.snapshot.activeSceneId,
            });
          }
        }
        if (frozenPerceptionIds === null || frozenWorldCut === null
          || canonicalJson(frozenWorldCut.perceptionIds) !== canonicalJson(frozenPerceptionIds)) {
          throw new Error('El job actoral no pudo congelar un corte coherente');
        }
        const assignedPerceptionIds = assignedActorTurnPerceptionIds(request);
        const frozenPerceptionSet = new Set(frozenPerceptionIds);
        if (assignedPerceptionIds.some((id) => !frozenPerceptionSet.has(id))) {
          throw new Error('El inbox entregado al job no incluye todas sus intenciones asignadas');
        }
        const frozenJson = canonicalJson(frozenPerceptionIds);
        const frozenWorldCutJson = canonicalJson(frozenWorldCut);
        const frozenDirectionRevision = row.frozen_direction_revision ?? run.row.direction_revision;
        const updated = database.prepare(`
          UPDATE actor_turn_jobs SET state='running',owner_token=?,claim_token=?,frozen_perception_ids_json=?,
            frozen_world_cut_json=?,frozen_direction_revision=?,updated_at=?
          WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND state='queued'
        `).run(request.ownerToken, request.claimToken, frozenJson, frozenWorldCutJson, frozenDirectionRevision, Date.now(),
          request.runId, request.actorId, request.jobId, request.generation);
        if (updated.changes !== 1) return ActorTurnJobClaimResultSchema.parse({ kind: 'busy' });
        const claimedValue = database.prepare(`
          SELECT * FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?
        `).get(request.runId, request.actorId, request.jobId, request.generation);
        bindClaimedIdentityJob(ActorTurnJobDbRowSchema.parse(claimedValue),run);
        return ActorTurnJobClaimResultSchema.parse({
          kind: 'claimed', job: actorTurnJobView(claimedValue),
          ownerToken: request.ownerToken, claimToken: request.claimToken,
        });
      });
    },

    failActorTurnJob(input: unknown) {
      const { execution, code } = ActorTurnJobFailureSchema.parse(input);
      return transact(() => {
        const value = database.prepare(`SELECT * FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?`)
          .get(execution.runId, execution.actorId, execution.jobId, execution.generation);
        if (value === undefined) throw new Error('Job actoral inexistente');
        const row = ActorTurnJobDbRowSchema.parse(value);
        if (row.pulse_id !== execution.pulseId || row.owner_token !== execution.lease.ownerToken
          || row.claim_token !== execution.lease.claimToken) throw new Error('Lease del job actoral inválido');
        if (row.state === 'blocked') {
          if (row.failure_code !== code) throw new Error('Diagnóstico terminal del job actoral ya registrado');
          return ActorTurnJobFailureResultSchema.parse({ kind: 'existing', job: actorTurnJobView(value) });
        }
        if (row.state !== 'running') throw new Error('El job actoral no está running');
        database.prepare(`UPDATE actor_turn_jobs SET state='blocked',failure_code=?,updated_at=?
          WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?`)
          .run(code, Date.now(), execution.runId, execution.actorId, execution.jobId, execution.generation);
        database.prepare(`UPDATE actor_turn_job_inputs SET state='released' WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND state='assigned'`)
          .run(execution.runId, execution.actorId, execution.jobId, execution.generation);
        return ActorTurnJobFailureResultSchema.parse({ kind: 'blocked', job: actorTurnJobView(database.prepare(`SELECT * FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?`)
          .get(execution.runId, execution.actorId, execution.jobId, execution.generation)) });
      });
    },

    retryActorTurnJob(input: unknown) {
      const request = ActorTurnJobRetrySchema.parse(input);
      return transact(() => {
        const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
        if (runValue === undefined) throw new Error('World run del retry actoral inexistente');
        const run = parseWorldRun(runValue);
        if (run.row.lifecycle !== 'running') throw new Error('Retry actoral requiere la corrida en running');
        const value = database.prepare(`SELECT * FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?`)
          .get(request.runId, request.actorId, request.jobId, request.expectedGeneration);
        if (value === undefined) throw new Error('Job actoral inexistente');
        const row = ActorTurnJobDbRowSchema.parse(value);
        if (row.state !== 'blocked' || row.pulse_id !== request.pulseId) throw new Error('Retry exige job bloqueado y su mismo pulso');
        const generation = RevisionSchema.parse(request.expectedGeneration + 1);
        const next = database.prepare(`SELECT * FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?`)
          .get(request.runId, request.actorId, request.jobId, generation);
        if (next !== undefined) return ActorTurnJobRetryResultSchema.parse({ kind: 'existing', job: actorTurnJobView(next) });
        const pending = database.prepare(`SELECT i.perception_id FROM actor_turn_intents i JOIN world_deliveries d ON d.perception_id=i.perception_id JOIN world_perceptions p ON p.perception_id=i.perception_id
          LEFT JOIN coordinator_pulses c ON c.pulse_id=?
          WHERE i.run_id=? AND i.actor_id=? AND i.state='queued' AND d.state='delivered' AND (c.pulse_id IS NULL OR (p.origin_kind=c.origin_kind AND p.origin_id=c.origin_id))
            AND NOT EXISTS(SELECT 1 FROM actor_turn_job_inputs a WHERE a.perception_id=i.perception_id AND a.state IN('assigned','consumed'))
          ORDER BY i.world_seq,i.perception_id LIMIT 100001`).all(request.pulseId, request.runId, request.actorId)
          .map((item) => z.strictObject({ perception_id: PerceptionIdSchema }).parse(item).perception_id);
        if (pending.length === 0 || pending.length > 100_000) throw new Error('Retry requiere intenciones pendientes dentro del límite');
        const timestamp = Date.now();
        database.prepare(`UPDATE coordinator_pulses SET state='running',lifecycle_revision=?,updated_at=? WHERE run_id=? AND pulse_id=? AND state='blocked'`)
          .run(run.row.lifecycle_revision,timestamp, request.runId, request.pulseId);
        database.prepare(`INSERT INTO actor_turn_jobs(run_id,actor_id,job_id,generation,pulse_id,state,owner_token,claim_token,created_at,updated_at,lifecycle_revision)
          VALUES(?,?,?,?,?,'queued',NULL,NULL,?,?,?)`).run(request.runId, request.actorId, request.jobId, generation, request.pulseId, timestamp, timestamp,run.row.lifecycle_revision);
        for (const perceptionId of pending) database.prepare(`INSERT INTO actor_turn_job_inputs(run_id,actor_id,job_id,generation,perception_id,state,assigned_at,consumed_at)
          VALUES(?,?,?,?,?,'assigned',?,NULL)`).run(request.runId, request.actorId, request.jobId, generation, perceptionId, timestamp);
        return ActorTurnJobRetryResultSchema.parse({ kind: 'retried', job: actorTurnJobView(database.prepare(`SELECT * FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?`)
          .get(request.runId, request.actorId, request.jobId, generation)) });
      });
    },

    /**
     * Reset only claims owned by a previous host. Call after the exclusive host lock
     * has been acquired; request reservations and shared pulse/run quotas are untouched.
     */
    recoverAbandonedActorTurnJobClaims(input: unknown): number {
      const request = ActorTurnJobRecoverySchema.parse(input);
      const recovered = transact(() => database.prepare(`
        UPDATE actor_turn_jobs SET state='queued',owner_token=NULL,claim_token=NULL,updated_at=?
        WHERE state='running' AND owner_token<>?
      `).run(Date.now(), request.ownerToken).changes);
      return Number(recovered);
    },

    listPendingWorldDeliveryTargets(input: unknown = {}) {
      const request = WorldDeliveryTargetsQuerySchema.parse(input);
      return database.prepare(`
        SELECT p.run_id,p.recipient_actor_id AS actor_id,MIN(p.world_seq) AS first_world_seq
        FROM world_deliveries d JOIN world_perceptions p ON p.perception_id=d.perception_id
        WHERE d.state IN('planned','failed','delivering')
        GROUP BY p.run_id,p.recipient_actor_id
        ORDER BY first_world_seq,p.run_id,actor_id LIMIT ?
      `).all(request.limit).map((value) => {
        const row = WorldDeliveryTargetRowSchema.parse(value);
        return Object.freeze({ runId: row.run_id, actorId: row.actor_id, firstWorldSeq: row.first_world_seq });
      });
    },

    readDeliveredWorldPerceptions(input: unknown) {
      const request = WorldDeliveredPerceptionsQuerySchema.parse(input);
      return database.prepare(`
        SELECT p.payload_json,p.payload_hash FROM world_perceptions p
        JOIN world_deliveries d ON d.perception_id=p.perception_id
        WHERE p.run_id=? AND p.recipient_actor_id=? AND p.world_seq<=? AND d.state='delivered'
        ORDER BY p.world_seq,p.perception_id
      `).all(request.runId, request.actorId, request.throughWorldSeq).map((value) => {
        const row = z.strictObject({ payload_json: z.string(), payload_hash: HashSchema }).parse(value);
        if (sha256(row.payload_json) !== row.payload_hash) throw new Error('Hash de percepción no coincide');
        return WorldPerceptionSchema.parse(parseStoredJson(row.payload_json));
      });
    },

    configureRun(input: unknown): void {
      const config = BudgetConfigSchema.parse(input);
      transact(() => {
        const existing = database.prepare('SELECT max_calls,consumed FROM run_budgets WHERE run_id=?').get(config.runId);
        if (existing !== undefined) {
          if (budgetRow.parse(existing).max_calls !== config.maxCalls) {
            throw new Error('La cuota existente requiere cambio versionado');
          }
          return;
        }
        database.prepare('INSERT INTO run_budgets(run_id,max_calls) VALUES(?,?)').run(config.runId, config.maxCalls);
      });
    },

    configurePulse(input: unknown): void {
      const config = PulseConfigSchema.parse(input);
      transact(() => {
        const existing = database.prepare('SELECT run_id,max_calls,consumed FROM pulses WHERE pulse_id=?').get(config.pulseId);
        if (existing !== undefined) {
          const stored = pulseRow.parse(existing);
          if (stored.run_id !== config.runId || stored.max_calls !== config.maxCalls) {
            throw new Error('Pulso existente incompatible');
          }
          return;
        }
        database.prepare('INSERT INTO pulses(pulse_id,run_id,max_calls) VALUES(?,?,?)')
          .run(config.pulseId, config.runId, config.maxCalls);
      });
    },

    reserveRequest(input: unknown): ReserveResult {
      // Existing is a receipt, never permission to dispatch again.
      const request = BudgetRequestSchema.parse(input);
      return transact(() => reserveWithinTransaction(request));
    },

    reserveNextRequest(input: unknown) {
      const request = BudgetRequestWithoutSequenceSchema.parse(input);
      return transact(() => reserveNextWithinTransaction(request));
    },

    transitionReservation(input: unknown): void {
      const request = ReservationTransitionSchema.parse(input);
      transact(() => transitionWithinTransaction(request));
    },

    expireBudgetRequest(input:unknown){
      const request=z.strictObject({jobId:JobIdSchema,generation:RevisionSchema,requestSeq:counter,ownerToken:z.uuid(),clockEpochId:ModelTimeClockEpochIdSchema,reason:z.enum(['timeout','cancelled'])}).parse(input);
      return transact(()=>{assertBudgetSpanOwner(request);return expireModelTimeWithinTransaction(request);});
    },
    settleBudgetRequestWallTime(input:unknown){
      const request=z.strictObject({jobId:JobIdSchema,generation:RevisionSchema,requestSeq:counter,ownerToken:z.uuid(),clockEpochId:ModelTimeClockEpochIdSchema,monotonicNs:MonotonicNanosecondsSchema}).parse(input);
      return transact(()=>{assertBudgetSpanOwner(request);return settleModelTimeWithinTransaction(request);});
    },

    readActorJobInferenceProfile(input: unknown) {
      const execution = ActorJobExecutionSchema.parse(input);
      return actorJobInferenceProfile(execution);
    },
    checkActorJobEligibility(input: unknown) {
      const execution = ActorJobExecutionSchema.parse(input);
      return actorJobEligibility(execution);
    },

    reserveActorJobRequest(input: unknown) {
      const request = z.strictObject({execution:ActorJobExecutionSchema,clockEpochId:ModelTimeClockEpochIdSchema.optional()}).parse(input);
      const execution = request.execution;
      return transact(() => {
        const eligibility = actorJobEligibility(execution);
        if (eligibility.kind !== 'active') throw new Error(`Job Pi inactivo: ${eligibility.reason}`);
        const outstanding = database.prepare(`SELECT 1 FROM request_reservations
          WHERE job_id=? AND generation=? AND state='reserved' LIMIT 1`)
          .get(execution.jobId, execution.generation);
        if (outstanding !== undefined) throw new Error('El job Pi conserva una reserva sin reconciliar');
        const result = reserveNextWithinTransaction({
          runId: execution.runId, pulseId: execution.pulseId, jobId: execution.jobId, generation: execution.generation,
          ...(request.clockEpochId===undefined?{}:{clockEpochId:request.clockEpochId,ownerToken:execution.lease.ownerToken}),
        });
        if (result.kind === 'reserved') database.prepare(`INSERT INTO actor_job_request_leases VALUES(?,?,?,?,?)`)
          .run(execution.jobId, execution.generation, result.requestSeq, execution.lease.ownerToken, execution.lease.claimToken);
        return result;
      });
    },

    transitionActorJobReservation(input: unknown): void {
      const request = z.strictObject({
        execution: ActorJobExecutionSchema, requestSeq: counter,
        target: ReservationTransitionSchema.shape.target,
        wallTime: ReservationTransitionSchema.shape.wallTime,
      }).parse(input);
      transact(() => {
        const reservation = actorJobReservation(request.execution, request.requestSeq);
        if (request.target === 'dispatched') {
          if (reservation.state !== 'reserved') throw new Error('Una reserva ya despachada no autoriza otro transporte');
          const eligibility = actorJobEligibility(request.execution);
          if (eligibility.kind !== 'active') throw new Error(`Job Pi inactivo: ${eligibility.reason}`);
          const checkpointValue = database.prepare(`SELECT payload_json,checkpoint_hash FROM actor_job_checkpoints
            WHERE job_id=? AND generation=? AND purpose_kind='request-input' AND request_seq=?`)
            .get(request.execution.jobId, request.execution.generation, request.requestSeq);
          if (checkpointValue === undefined) throw new Error('El despacho Pi requiere checkpoint input durable');
          const checkpointRow = z.strictObject({ payload_json: z.string(), checkpoint_hash: HashSchema }).parse(checkpointValue);
          if (sha256(checkpointRow.payload_json) !== checkpointRow.checkpoint_hash) throw new Error('Checkpoint input Pi corrupto');
          const checkpoint = ActorJobCheckpointSchema.parse(parseStoredJson(checkpointRow.payload_json));
          if (canonicalJson(checkpoint.execution) !== canonicalJson(request.execution)) throw new Error('El checkpoint input Pi pertenece a otro claim');
          const candidateValue = database.prepare(`SELECT * FROM actor_pi_candidates
            WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND candidate_kind='request-input' AND request_seq=?`)
            .get(request.execution.runId, request.execution.actorId, request.execution.jobId,
              request.execution.generation, request.requestSeq);
          if (candidateValue === undefined) throw new Error('El despacho Pi requiere candidato input durable');
          const candidate = actorCandidateFromRow(candidateValue);
          if (candidate.kind !== 'request-input' || candidate.lease === undefined
            || candidate.lease.ownerToken !== request.execution.lease.ownerToken
            || candidate.lease.claimToken !== request.execution.lease.claimToken
            || checkpoint.snapshot.sessionId !== candidate.base.sessionId
            || checkpoint.snapshot.sessionPath !== candidate.base.sessionPath
            || checkpoint.snapshot.candidateLeafId !== candidate.candidateLeafId) {
            throw new Error('El candidato input Pi no coincide con el checkpoint y claim');
          }
        }
        transitionWithinTransaction({
          jobId: request.execution.jobId, generation: request.execution.generation,
          requestSeq: request.requestSeq, target: request.target,
          ownerToken: request.execution.lease.ownerToken,
          ...(request.wallTime===undefined?{}:{wallTime:request.wallTime}),
        });
      });
    },

    expireActorJobRequest(input:unknown){
      const request=z.strictObject({execution:ActorJobExecutionSchema,requestSeq:counter,
        clockEpochId:ModelTimeClockEpochIdSchema,reason:z.enum(['timeout','cancelled'])}).parse(input);
      return transact(()=>{actorJobReservation(request.execution,request.requestSeq);return expireModelTimeWithinTransaction({jobId:request.execution.jobId,
        generation:request.execution.generation,requestSeq:request.requestSeq,clockEpochId:request.clockEpochId,reason:request.reason});});
    },
    settleActorJobRequestWallTime(input:unknown){
      const request=z.strictObject({execution:ActorJobExecutionSchema,requestSeq:counter,clockEpochId:ModelTimeClockEpochIdSchema,
        monotonicNs:MonotonicNanosecondsSchema}).parse(input);
      return transact(()=>{actorJobReservation(request.execution,request.requestSeq);return settleModelTimeWithinTransaction({jobId:request.execution.jobId,
        generation:request.execution.generation,requestSeq:request.requestSeq,clockEpochId:request.clockEpochId,monotonicNs:request.monotonicNs});});
    },

    recordActorJobCheckpoint(input: unknown): 'stored' | 'existing' {
      const checkpoint = ActorJobCheckpointSchema.parse(input);
      const { execution, purpose, snapshot } = checkpoint;
      const payload = hashJson(checkpoint);
      if (!isAbsolute(snapshot.sessionPath)) throw new Error('El checkpoint Pi necesita una ruta privada absoluta');
      return transact(() => {
        const existing = database.prepare('SELECT payload_json FROM actor_job_checkpoints WHERE checkpoint_hash=?').get(payload.hash);
        if (existing !== undefined) {
          if (z.strictObject({ payload_json: z.string() }).parse(existing).payload_json !== payload.json) throw new Error('Hash de checkpoint Pi en conflicto');
          return 'existing';
        }
        const claimed = claimedActorJob(execution);
        if (claimed === undefined) throw new Error('El checkpoint Pi perdió el lease del job');
        const run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(execution.runId));
        if (!actorJobEpochCurrent(claimed,run)) throw new Error('El checkpoint Pi pertenece a una época de lifecycle anterior');
        const session=currentActorSession(run,execution.actorId);assertJobIdentityBinding(claimed,run);
        if (session===undefined||session.sessionId !== snapshot.sessionId || session.sessionPath !== snapshot.sessionPath) {
          throw new Error('El checkpoint Pi pertenece a otra sesión');
        }
        if (purpose.kind === 'job-base' && snapshot.candidateLeafId !== session.committedLeafId) {
          throw new Error('El checkpoint base Pi difiere del leaf aceptado');
        }
        if (purpose.kind === 'request-input') {
          const eligibility = actorJobEligibility(execution);
          if (eligibility.kind !== 'active') throw new Error(`Job Pi inactivo: ${eligibility.reason}`);
          if (actorJobReservation(execution, purpose.requestSeq).state !== 'reserved') {
            throw new Error('El checkpoint input Pi necesita una reserva sin despacho');
          }
        }
        if (purpose.kind === 'terminal-candidate') {
          const reservation = purpose.lastRequestSeq === null ? undefined : actorJobReservation(execution, purpose.lastRequestSeq);
          if (purpose.outcome === 'completed' && (reservation?.state !== 'completed' || snapshot.candidateLeafId === null)) {
            throw new Error('Un checkpoint terminal completado necesita respuesta confirmada y leaf');
          }
        }
        database.prepare(`INSERT INTO actor_job_checkpoints(
          checkpoint_hash,run_id,actor_id,job_id,generation,purpose_kind,request_seq,payload_json,recorded_at
        ) VALUES(?,?,?,?,?,?,?,?,?)`).run(payload.hash, execution.runId, execution.actorId, execution.jobId,
          execution.generation, purpose.kind, purpose.kind === 'request-input' ? purpose.requestSeq : null, payload.json, Date.now());
        return 'stored';
      });
    },

    readActorJobCheckpoints(input: unknown) {
      const scope = ActorTurnJobScopeSchema.parse(input);
      return database.prepare(`SELECT checkpoint_hash,payload_json FROM actor_job_checkpoints
        WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? ORDER BY recorded_at,checkpoint_hash`)
        .all(scope.runId, scope.actorId, scope.jobId, scope.generation).map((value) => {
          const row = z.strictObject({ checkpoint_hash: HashSchema, payload_json: z.string() }).parse(value);
          if (sha256(row.payload_json) !== row.checkpoint_hash) throw new Error('Hash del checkpoint Pi no coincide');
          const checkpoint = ActorJobCheckpointSchema.parse(parseStoredJson(row.payload_json));
          if (canonicalJson(checkpoint) !== row.payload_json
            || checkpoint.execution.runId !== scope.runId || checkpoint.execution.actorId !== scope.actorId
            || checkpoint.execution.jobId !== scope.jobId || checkpoint.execution.generation !== scope.generation
            || checkpoint.execution.pulseId !== scope.pulseId) throw new Error('Checkpoint Pi pertenece a otro scope');
          return checkpoint;
        });
    },

    recordExperience(input: unknown): { kind: 'stored' | 'existing' } {
      const supplied = FrozenExperienceSchema.parse(input);
      const frozen = freezeExperience(supplied.envelope);
      if (supplied.payloadHash !== frozen.payloadHash || supplied.canonicalPayload !== frozen.canonicalPayload) {
        throw new Error('Envelope alterado antes de persistir');
      }
      return transact(() => ({ kind: recordExperienceWithinTransaction(frozen) }));
    },

    /**
     * Startup recovery for the exclusive local host. Call once after acquiring
     * host ownership and before making any projection workers available. A
     * previous process may have committed ICM storage and crashed before its
     * receipt; its claim is abandoned only because the host lock proves that no
     * prior host can still be running this worker.
     */
    recoverAbandonedMemoryProjectionClaims(): number {
      return transact(() => {
        const result = database.prepare(`
          UPDATE memory_outbox SET claim_token=NULL,owner_token=NULL
          WHERE claim_token IS NOT NULL
        `).run();
        const recovered = Number(result.changes);
        if (!Number.isSafeInteger(recovered) || recovered < 0) throw new Error('Conteo inválido de claims recuperados');
        return recovered;
      });
    },

    /** Startup recovery after exclusive host ownership proves no old delivery worker is alive. */
    recoverAbandonedWorldDeliveryClaims(): number {
      return transact(() => {
        const result = database.prepare(`
          UPDATE world_deliveries
          SET state='planned',claim_token=NULL,owner_token=NULL,failure_code=NULL
          WHERE state='delivering'
        `).run();
        const recovered = Number(result.changes);
        if (!Number.isSafeInteger(recovered) || recovered < 0) throw new Error('Conteo inválido de deliveries recuperados');
        return recovered;
      });
    },

    claimNextMemoryProjection(input: unknown): ProjectionClaimResult {
      const request = ProjectionClaimRequestSchema.parse(input);
      return transact(() => {
        const row = database.prepare(`
          SELECT e.experience_id,e.run_id,e.actor_id,e.world_seq,e.canonical_payload,e.payload_hash,
            o.claim_token,o.owner_token,o.attempts
          FROM memory_outbox o
          JOIN experiences e ON e.experience_id=o.experience_id
          LEFT JOIN memory_receipts r ON r.experience_id=e.experience_id
          WHERE e.run_id=? AND e.actor_id=? AND r.experience_id IS NULL
          ORDER BY e.world_seq,e.experience_id LIMIT 1
        `).get(request.runId, request.actorId);
        if (row === undefined) return ProjectionClaimResultSchema.parse({ kind: 'empty' });
        const stored = projectionRow.parse(row);
        // An unknown owner may still be writing to ICM. Recovery must release a stale claim explicitly.
        if (stored.claim_token !== null) {
          return ProjectionClaimResultSchema.parse({ kind: 'busy' });
        }
        database.prepare(`
          UPDATE memory_outbox SET claim_token=?,owner_token=?,attempts=attempts+1,last_failure=NULL
          WHERE experience_id=? AND claim_token IS ? AND owner_token IS ?
        `).run(
          request.claimToken, request.ownerToken, stored.experience_id, stored.claim_token, stored.owner_token,
        );
        return ProjectionClaimResultSchema.parse({
          kind: 'claimed',
          claimToken: request.claimToken,
          attempts: counter.parse(stored.attempts + 1),
          frozen: frozenProjection(row),
        });
      });
    },

    releaseMemoryProjectionClaim(input: unknown): 'released' | 'stale' {
      const request = ProjectionReleaseRequestSchema.parse(input);
      return transact(() => {
        const result = database.prepare(`
          UPDATE memory_outbox SET claim_token=NULL,owner_token=NULL,last_failure=?
          WHERE experience_id=? AND claim_token=?
        `).run(request.failureKind, request.experienceId, request.claimToken);
        return result.changes === 1 ? 'released' : 'stale';
      });
    },

    acknowledgeMemoryProjection(input: unknown): { kind: 'projected' | 'existing'; receipt: z.infer<typeof MemoryProjectionReceiptSchema> } {
      const request = ProjectionAckRequestSchema.parse(input);
      return transact(() => {
        const existingRow = database.prepare(`
          SELECT e.experience_id,r.memory_id,r.claim_token,e.run_id,e.actor_id,e.world_seq,e.canonical_payload,e.payload_hash
          FROM memory_receipts r JOIN experiences e ON e.experience_id=r.experience_id
          WHERE e.experience_id=?
        `).get(request.experienceId);
        if (existingRow !== undefined) {
          const existing = ProjectionStoredRowSchema.parse(existingRow);
          const receipt = projectionReceipt(existingRow);
          if (existing.claim_token !== request.claimToken || existing.memory_id !== request.memoryId ||
              existing.payload_hash !== request.payloadHash) {
            throw new Error('Receipt existente no coincide con el claim de host');
          }
          return { kind: 'existing', receipt };
        }

        const row = database.prepare(`
          SELECT e.experience_id,e.run_id,e.actor_id,e.world_seq,e.canonical_payload,e.payload_hash,
            o.claim_token,o.owner_token,o.attempts
          FROM memory_outbox o JOIN experiences e ON e.experience_id=o.experience_id
          WHERE e.experience_id=?
        `).get(request.experienceId);
        if (row === undefined) throw new Error('No existe una proyección reclamada para la experiencia');
        const stored = projectionRow.parse(row);
        if (stored.claim_token !== request.claimToken || stored.payload_hash !== request.payloadHash) {
          throw new Error('El claim o payload de proyección ya no es vigente');
        }
        const frozen = frozenProjection(row);
        if (frozen.envelope.experienceId !== request.experienceId) {
          throw new Error('La proyección no coincide con su experiencia vinculada');
        }
        database.prepare(`
          INSERT INTO memory_receipts(experience_id,memory_id,claim_token,state,recorded_at)
          VALUES(?,?,?,'projected',?)
        `).run(request.experienceId, request.memoryId, request.claimToken, Date.now());
        database.prepare('DELETE FROM memory_outbox WHERE experience_id=? AND claim_token=?')
          .run(request.experienceId, request.claimToken);
        return {
          kind: 'projected',
          receipt: MemoryProjectionReceiptSchema.parse({
            memoryId: request.memoryId,
            experienceId: frozen.envelope.experienceId,
            runId: frozen.envelope.runId,
            actorId: frozen.envelope.actorId,
            worldSeq: frozen.envelope.worldSeq,
            canonicalPayload: frozen.canonicalPayload,
            payloadHash: frozen.payloadHash,
          }),
        };
      });
    },

    findReceipt(input: unknown) {
      const request = ProjectionLookupSchema.parse(input);
      const row = database.prepare(`
        SELECT e.experience_id,r.memory_id,r.claim_token,e.run_id,e.actor_id,e.world_seq,e.canonical_payload,e.payload_hash
        FROM memory_receipts r JOIN experiences e ON e.experience_id=r.experience_id
        WHERE r.memory_id=? AND e.run_id=? AND e.actor_id=? AND e.world_seq<=? AND r.state='projected'
        ORDER BY e.world_seq,e.experience_id LIMIT 1
      `).get(request.memoryId, request.runId, request.actorId, request.throughWorldSeq);
      if (row === undefined) return undefined;
      return projectionReceipt(row);
    },

    readExperiences(input: unknown) {
      const request = ActorReadSchema.parse(input);
      return database.prepare(
        'SELECT canonical_payload,payload_hash FROM experiences WHERE run_id=? AND actor_id=? AND world_seq<=? ORDER BY world_seq,experience_id',
      ).all(request.runId, request.actorId, request.throughWorldSeq).map((row) => {
        const stored = experienceRow.parse(row);
        return readPrivateExperience({
          ...request, summary: stored.canonical_payload, expectedPayloadHash: stored.payload_hash,
        });
      });
    },

    registerActorPiSession(input: unknown) {
      const registration = ActorSessionRegistrationSchema.parse(input);
      if(registration.execution!==undefined&&(registration.execution.runId!==registration.runId||registration.execution.actorId!==registration.actorId))throw new Error('El claim no coincide con el scope de la sesión actoral');
      if (!isAbsolute(registration.sessionPath)) throw new Error('La ruta de sesión Pi debe ser absoluta');
      return transact(() => {
        const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(registration.runId);
        if (runValue === undefined) throw new Error('No existe la corrida para registrar la sesión Pi');
        const run = parseWorldRun(runValue);
        if(canonicalJson(resolveStoredPiProfile(registration.profile))!==canonicalJson(runInferenceProfile(run)))throw new Error('Perfil Pi distinto de la configuración durable');
        const context = run.fence.contexts.find((item) => item.actorId === registration.actorId);
        if (context === undefined || context.preparedContextHash !== registration.preparedContextHash) {
          throw new Error('El actor no tiene ese contexto preparado dentro de esta corrida');
        }
        const profilePayload = hashJson(registration.profile);
        const existingValue=database.prepare('SELECT * FROM actor_pi_sessions WHERE run_id=? AND actor_id=?').get(registration.runId,registration.actorId);
        const current=currentActorSession(run,registration.actorId);const epoch=identityEpochs(run,registration.actorId).at(-1);
        if(current!==undefined){
          if(current.sessionId!==registration.sessionId||current.sessionPath!==registration.sessionPath||current.preparedContextHash!==registration.preparedContextHash||canonicalJson(current.profile)!==profilePayload.json)throw new Error('La sesión ya tiene otra identidad, ruta, preparación o perfil');
          if(registration.execution!==undefined)assertActorExecutionEpoch(registration.execution);
          return ActorPiRegistrationResultSchema.parse({kind:'existing',session:current});
        }
        if(epoch!==undefined&&registration.execution===undefined)throw new Error('IDENTITY_SESSION_EXECUTION_REQUIRED');
        if(registration.execution!==undefined)assertActorExecutionEpoch(registration.execution);
        assertIndependentSession(registration.sessionId,registration.sessionPath);
        const timestamp=Date.now();
        if(existingValue===undefined)database.prepare('INSERT INTO actor_pi_sessions VALUES(?,?,?,?,?,?,?,NULL,0,?,?)').run(registration.runId,registration.actorId,registration.sessionId,registration.sessionPath,registration.preparedContextHash,profilePayload.json,profilePayload.hash,timestamp,timestamp);
        else database.prepare('UPDATE actor_pi_sessions SET session_id=?,session_path=?,prepared_context_hash=?,profile_json=?,profile_hash=?,committed_leaf_id=NULL,session_revision=0,created_at=?,updated_at=? WHERE run_id=? AND actor_id=?').run(registration.sessionId,registration.sessionPath,registration.preparedContextHash,profilePayload.json,profilePayload.hash,timestamp,timestamp,registration.runId,registration.actorId);
        const base=actorSessionBase(database.prepare('SELECT * FROM actor_pi_sessions WHERE run_id=? AND actor_id=?').get(registration.runId,registration.actorId));if(epoch!==undefined)bindIdentitySession(epoch,base);
        return ActorPiRegistrationResultSchema.parse({kind:'stored',session:base});
      });
    },

    rotateUnacceptedActorPiSession(input: unknown) {
      const rotation = ActorSessionRotationSchema.parse(input);
      if(rotation.execution!==undefined&&(rotation.execution.runId!==rotation.runId||rotation.execution.actorId!==rotation.actorId))throw new Error('El claim no coincide con el scope de la rotación actoral');
      if (!isAbsolute(rotation.sessionPath)) throw new Error('La ruta de sesión Pi debe ser absoluta');
      if (rotation.expected.sessionRevision !== 0 || rotation.expected.committedLeafId !== null) {
        throw new Error('Sólo se puede rotar una sesión Pi antes del primer leaf aceptado');
      }
      if (rotation.expected.sessionId === rotation.sessionId || rotation.expected.sessionPath === rotation.sessionPath) {
        throw new Error('La sesión Pi de reemplazo debe tener identidad y ruta nuevas');
      }
      return transact(() => {
        const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(rotation.runId);
        if (runValue === undefined) throw new Error('No existe la corrida para rotar la sesión Pi');
        const run = parseWorldRun(runValue);
        const context = run.fence.contexts.find((item) => item.actorId === rotation.actorId);
        if (canonicalJson(resolveStoredPiProfile(rotation.expected.profile)) !== canonicalJson(runInferenceProfile(run))) {
          throw new Error('El perfil Pi de la rotación difiere de la configuración durable');
        }
        if (context === undefined || context.preparedContextHash !== rotation.expected.preparedContextHash) {
          throw new Error('El contexto preparado de la sesión Pi cambió');
        }
        const rowValue = database.prepare('SELECT * FROM actor_pi_sessions WHERE run_id=? AND actor_id=?')
          .get(rotation.runId, rotation.actorId);
        if (rowValue === undefined) throw new Error('No existe la sesión Pi que se intenta rotar');
        const row = ActorPiSessionRowSchema.parse(rowValue);
        const current = currentActorSession(run,rotation.actorId);if(current===undefined)throw new Error('IDENTITY_SESSION_RESERVED');
        if (current.sessionRevision !== 0 || current.committedLeafId !== null) {
          throw new Error('La sesión Pi ya tiene un leaf aceptado y no puede rotarse');
        }
        if (current.preparedContextHash !== rotation.expected.preparedContextHash
          || canonicalJson(current.profile) !== canonicalJson(rotation.expected.profile)) {
          throw new Error('La preparación o el perfil de la sesión Pi cambió');
        }
        if (current.sessionId === rotation.sessionId && current.sessionPath === rotation.sessionPath) {
          return ActorPiRotationResultSchema.parse({ kind: 'existing', session: current });
        }
        if (canonicalJson(current) !== canonicalJson(rotation.expected)) {
          throw new Error('La sesión Pi cambió antes de aplicar la rotación CAS');
        }
        if(rotation.execution!==undefined)assertActorExecutionEpoch(rotation.execution);
        const epoch=identityEpochs(run,rotation.actorId).at(-1);if(epoch!==undefined&&rotation.execution===undefined)throw new Error('IDENTITY_SESSION_EXECUTION_REQUIRED');
        assertIndependentSession(rotation.sessionId,rotation.sessionPath);
        const timestamp = Date.now();
        const updated = database.prepare(`
          UPDATE actor_pi_sessions SET session_id=?,session_path=?,updated_at=?
          WHERE run_id=? AND actor_id=? AND session_id=? AND session_path=?
            AND prepared_context_hash=? AND profile_hash=? AND session_revision=0 AND committed_leaf_id IS NULL
        `).run(rotation.sessionId, rotation.sessionPath, timestamp, rotation.runId, rotation.actorId,
          row.session_id, row.session_path, row.prepared_context_hash, row.profile_hash);
        if (updated.changes !== 1) throw new Error('La sesión Pi cambió antes de aplicar la rotación CAS');
        const rotatedValue = database.prepare('SELECT * FROM actor_pi_sessions WHERE run_id=? AND actor_id=?')
          .get(rotation.runId, rotation.actorId);
        const base=actorSessionBase(rotatedValue);if(epoch!==undefined)bindIdentitySession(epoch,base);return ActorPiRotationResultSchema.parse({ kind: 'rotated', session: base });
      });
    },

    loadActorPiSession(input: unknown) {
      const request = z.strictObject({ runId: RunIdSchema, actorId: CharacterIdSchema }).parse(input);
      const row=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
      return row===undefined?undefined:currentActorSession(parseWorldRun(row),request.actorId);
    },

    recordActorPiCandidate(input: unknown): 'stored' | 'existing' {
      const candidate = ActorPiCandidateSchema.parse(input);
      if (candidate.runId !== candidate.scope.runId) throw new Error('Candidato Pi con corrida incompatible');
      if (!isAbsolute(candidate.base.sessionPath)) throw new Error('La ruta del candidato Pi debe ser absoluta');
      const payload = hashJson(candidate);
      const perceptionsJson = canonicalJson(candidate.inputCut.perceptionIds);
      return transact(() => {
        const existingValue = database.prepare('SELECT * FROM actor_pi_candidates WHERE candidate_id=?')
          .get(candidate.candidateId);
        if (existingValue !== undefined) {
          const existing = actorCandidateFromRow(existingValue);
          if (canonicalJson(existing) !== payload.json) throw new Error('CandidateId Pi ya fue usado con otro payload');
          return 'existing';
        }
        verifyCandidateBase(candidate);
        const scheduledJobValue = database.prepare(`
          SELECT * FROM actor_turn_jobs
          WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?
        `).get(candidate.runId, candidate.actorId, candidate.scope.jobId, candidate.scope.generation);
        let expectedPerceptionIds: string[] | undefined;
        if (scheduledJobValue !== undefined) {
          const scheduledJob = ActorTurnJobDbRowSchema.parse(scheduledJobValue);
          if (scheduledJob.state !== 'running' || scheduledJob.pulse_id !== candidate.scope.pulseId
            || candidate.lease === undefined || scheduledJob.owner_token !== candidate.lease.ownerToken
            || scheduledJob.claim_token !== candidate.lease.claimToken) {
            throw new Error('El candidato Pi no pertenece al claim vigente del job actoral y al pulso exacto');
          }
          const run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(candidate.runId));
          if (!actorJobEpochCurrent(scheduledJob,run)) throw new Error('El candidato Pi pertenece a una época de lifecycle anterior');
          assertJobIdentityBinding(scheduledJob,run);
          const frozenWorldCut = frozenActorTurnWorldCut(scheduledJob);
          if (frozenWorldCut === null || canonicalJson(candidate.inputCut) !== canonicalJson(frozenWorldCut)) {
            throw new Error('El candidato Pi no coincide con el corte World e inbox congelados del job');
          }
          expectedPerceptionIds = frozenWorldCut.perceptionIds;
        } else {
          if (candidate.lease !== undefined) throw new Error('El candidato Pi lleva un lease sin job actoral registrado');
          const activeJobValue = database.prepare(`
            SELECT job_id,generation FROM actor_turn_jobs
            WHERE run_id=? AND actor_id=? AND state IN('queued','running')
          `).get(candidate.runId, candidate.actorId);
          if (activeJobValue !== undefined) throw new Error('El candidato Pi no pertenece al job actoral activo');
        }
        verifyActorInputCut({
          runId: candidate.runId, actorId: candidate.actorId, cut: candidate.inputCut,
          ...(expectedPerceptionIds === undefined ? {} : { expectedPerceptionIds }),
        });
        if (candidate.kind === 'request-input') {
          const terminalValue = database.prepare(`
            SELECT candidate_id FROM actor_pi_candidates
            WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND turn_id=?
              AND candidate_kind='terminal-candidate'
          `).get(candidate.runId, candidate.actorId, candidate.scope.jobId, candidate.scope.generation, candidate.turnId);
          if (terminalValue !== undefined) throw new Error('No se puede registrar un request Pi después del candidato terminal del turno');
          const reservationValue = database.prepare(`
            SELECT run_id,pulse_id,state FROM request_reservations
            WHERE job_id=? AND generation=? AND request_seq=?
          `).get(candidate.scope.jobId, candidate.scope.generation, candidate.requestSeq);
          if (reservationValue === undefined) throw new Error('El input Pi no tiene reserva de request durable');
          const reservation = z.strictObject({
            run_id: RunIdSchema, pulse_id: PulseIdSchema,
            state: z.enum(['reserved', 'dispatched', 'completed', 'undispatched', 'ambiguous']),
          }).parse(reservationValue);
          if (reservation.run_id !== candidate.runId || reservation.pulse_id !== candidate.scope.pulseId
            || reservation.state !== 'reserved') throw new Error('El input Pi no coincide con una reserva aún no despachada');
        } else {
          if (candidate.outcome === 'completed' && (candidate.lastRequestSeq === null || candidate.candidateLeafId === null)) {
            throw new Error('Un turno Pi completado necesita request final y leaf candidato');
          }
          if (candidate.lastRequestSeq !== null) {
            const requestValue = database.prepare(`
              SELECT * FROM actor_pi_candidates
              WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND turn_id=?
                AND candidate_kind='request-input' AND request_seq=?
            `).get(candidate.runId, candidate.actorId, candidate.scope.jobId, candidate.scope.generation,
              candidate.turnId, candidate.lastRequestSeq);
            if (requestValue === undefined) throw new Error('El candidato terminal referencia un input Pi ausente');
            const requestCandidate = actorCandidateFromRow(requestValue);
            if (requestCandidate.kind !== 'request-input'
              || canonicalJson(requestCandidate.inputCut) !== canonicalJson(candidate.inputCut)) {
              throw new Error('El corte terminal difiere del corte exacto enviado al modelo');
            }
          }
        }
        const slot = candidate.kind === 'request-input'
          ? database.prepare(`SELECT candidate_id FROM actor_pi_candidates
              WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND candidate_kind='request-input' AND request_seq=?`)
            .get(candidate.runId, candidate.actorId, candidate.scope.jobId, candidate.scope.generation, candidate.requestSeq)
          : database.prepare(`SELECT candidate_id FROM actor_pi_candidates
              WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND candidate_kind='terminal-candidate' AND turn_id=?`)
            .get(candidate.runId, candidate.actorId, candidate.scope.jobId, candidate.scope.generation, candidate.turnId);
        if (slot !== undefined) throw new Error('El slot Pi ya tiene otro candidato durable');
        const requestSeq = candidate.kind === 'request-input' ? candidate.requestSeq : null;
        const outcome = candidate.kind === 'terminal-candidate' ? candidate.outcome : null;
        const lastRequestSeq = candidate.kind === 'terminal-candidate' ? candidate.lastRequestSeq : null;
        database.prepare(`
          INSERT INTO actor_pi_candidates(
            candidate_id,run_id,actor_id,pulse_id,job_id,generation,turn_id,candidate_kind,request_seq,outcome,
            last_request_seq,base_session_revision,base_leaf_id,session_id,session_path,prepared_context_hash,
            candidate_leaf_id,input_world_revision,input_world_seq,input_fictional_at,input_perception_ids_json,
            canonical_payload,payload_hash,recorded_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(candidate.candidateId, candidate.runId, candidate.actorId, candidate.scope.pulseId,
          candidate.scope.jobId, candidate.scope.generation, candidate.turnId, candidate.kind, requestSeq, outcome,
          lastRequestSeq, candidate.base.sessionRevision, candidate.base.committedLeafId, candidate.base.sessionId,
          candidate.base.sessionPath, candidate.base.preparedContextHash, candidate.candidateLeafId,
          candidate.inputCut.worldRevision, candidate.inputCut.worldSeq, candidate.inputCut.fictionalAt,
          perceptionsJson, payload.json, payload.hash, Date.now());
        if(candidate.kind==='terminal-candidate'&&candidate.outcome==='completed'){
          const proposal=database.prepare(`SELECT proposal_id,version,attempt_hash FROM world_proposals WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? ORDER BY version DESC LIMIT 1`)
            .get(candidate.runId,candidate.actorId,candidate.scope.jobId,candidate.scope.generation);
          if(proposal!==undefined){const binding=z.strictObject({proposal_id:ProposalIdSchema,version:counter,attempt_hash:HashSchema}).parse(proposal);
            database.prepare('INSERT INTO actor_terminal_proposals VALUES(?,?,?,?)').run(candidate.candidateId,binding.proposal_id,binding.version,binding.attempt_hash);}
        }
        return 'stored';
      });
    },

    readActorTurnRecovery(input:unknown){
      const request=ActorTurnRecoveryReadSchema.parse(input);return transact(()=>{try{return actorRecoveryProof(request.execution).result;}catch{return ActorTurnRecoveryResultSchema.parse({kind:'pending',reason:'proof-invalid'});}});
    },
    acceptRecoveredActorTurn(input:unknown){
      const request=ActorTurnRecoveredAcceptanceSchema.parse(input);return transact(()=>{
        const acceptance=ActorTurnAcceptanceSchema.parse({candidateId:request.candidateId,proposal:request.proposalBinding,lease:request.execution.lease});
        const existing=database.prepare(`SELECT execution_json,proof_hash,proof_json FROM actor_turn_reconciliations WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND candidate_id=?`)
          .get(request.execution.runId,request.execution.actorId,request.execution.jobId,request.execution.generation,request.candidateId);
        if(existing!==undefined){const grant=z.strictObject({execution_json:z.string(),proof_hash:HashSchema,proof_json:z.string()}).parse(existing);
          const proof=z.strictObject({execution:ActorJobExecutionSchema,candidate:ActorPiCandidateSchema,proposal:WorldProposalRecordSchema,adminReceipt:ContinuistaReceiptSchema,terminalCheckpoint:HashSchema,inputCheckpoint:HashSchema}).parse(parseStoredJson(grant.proof_json));
          if(grant.execution_json!==canonicalJson(request.execution)||canonicalJson(proof.execution)!==grant.execution_json||canonicalJson(proof)!==grant.proof_json
            ||sha256(grant.proof_json)!==grant.proof_hash||proof.candidate.candidateId!==request.candidateId||proof.proposal.proposalId!==request.proposalBinding.proposalId
            ||proof.proposal.version!==request.proposalBinding.version||proof.proposal.attemptHash!==request.proposalBinding.attemptHash)throw new Error('Grant parental pertenece a otro claim o proof alterado');
          const accepted=acceptedActorJobProposal({runId:request.execution.runId,actorId:request.execution.actorId,jobId:request.execution.jobId,generation:request.execution.generation});
          if(accepted===undefined||canonicalJson(accepted)!==canonicalJson(proof.proposal))throw new Error('Grant parental sin aceptación durable exacta');
          return acceptActorTurnWithinTransaction(acceptance,request.execution);}
        const proof=actorRecoveryProof(request.execution);
        if(proof.result.kind!=='completed'||proof.proofHash===undefined||proof.proofJson===undefined||proof.result.candidateId!==request.candidateId
          ||canonicalJson(proof.result.proposalBinding)!==canonicalJson(request.proposalBinding))throw new Error('Recuperación parental sin proofs completos exactos');
        database.prepare('INSERT INTO actor_turn_reconciliations VALUES(?,?,?,?,?,?,?,?,?)').run(request.execution.runId,request.execution.actorId,request.execution.jobId,
          request.execution.generation,request.candidateId,canonicalJson(request.execution),proof.proofHash,proof.proofJson,Date.now());
        return acceptActorTurnWithinTransaction(acceptance,request.execution);
      });
    },

    acceptActorTurn(input: unknown) {const request=ActorTurnAcceptanceSchema.parse(input);return transact(()=>acceptActorTurnWithinTransaction(request));},

    close(): void { database.close(); },
  };
}
