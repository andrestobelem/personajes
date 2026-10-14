import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import { StoredPiProfileSchema, PersistedInferenceProfileSchema, LEGACY_INFERENCE_PROFILE, resolveStoredPiProfile, resolveReadyInferenceProfile } from '../domain/inference-profile.ts';
import { validateContinuistaReviewContext, validateContinuistaContextReview } from '../domain/continuista-review.ts';
import { ReadyRunConfigurationSchema, validateRunConfiguration } from '../application/production-preflight.ts';
import { fingerprintInferenceProfile } from '../application/pi-access-check.ts';
import { ExperienceSchema, FrozenExperienceSchema } from '../domain/experience.ts';
import { IcmMemoryIdSchema, MemoryProjectionReceiptSchema } from '../domain/memory-projection.ts';
import { HumanParticipantProfileSchema } from '../domain/interaction.ts';
import { HumanInterventionResolutionSchema, resolveHumanIntervention } from '../domain/human-intervention.ts';
import { freezeExperience, readPrivateExperience } from '../application/experience-envelope.ts';
import type { FrozenExperience } from '../domain/experience.ts';
import {
  ActorKnowledgeSchema,
  WorldContentApprovalReceiptSchema,
  WorldEventSchema,
  WorldPerceptionSchema,
  WorldResolutionSchema,
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
  RunLifecycleCommandWriteSchema,
  RunLifecycleCommandResultSchema,
  RunLifecycleCommandLookupSchema,
  RunLifecycleCommandLookupResultSchema,
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
import {
  CharacterIdSchema, ExperienceIdSchema, HashSchema, HumanInterventionIdSchema, HumanParticipantIdSchema,
  FictionalInstantSchema, JobIdSchema, PerceptionIdSchema, ProposalIdSchema, PulseIdSchema, RevisionSchema, RunIdSchema, WorldSeqSchema,
} from '../domain/values.ts';

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
  world_revision: counter, last_seq: counter,
  commit_index: counter, initial_snapshot_json: z.string(), initial_snapshot_hash: HashSchema,
  snapshot_json: z.string(), snapshot_hash: HashSchema, created_at: counter.nullable().optional(), updated_at: counter,
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
  origin_kind: z.enum(['actorAttempt', 'humanIntervention']), origin_id: z.string().min(1).max(200),
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
      if (version.version === null || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25].includes(version.version)) {
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

  function transact<T>(operation: () => T): T {
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
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
    if(world?.kind==='configured'||world?.kind==='proposed')normalized.worldSnapshot={...world,value:{...world.value,runId:draft.runId}};
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
    if(database.prepare('SELECT 1 FROM run_draft_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
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
    if(database.prepare('SELECT 1 FROM run_draft_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
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
      configuration_revision:RevisionSchema,configuration_hash:HashSchema,configuration_json:z.string(),world_revision:RevisionSchema,world_seq:WorldSeqSchema,
      fictitious_at:FictionalInstantSchema,provider:z.enum(['openai-codex','anthropic']).nullable(),profile_fingerprint:HashSchema.nullable(),
      result_kind:RunPreflightJobViewSchema.shape.resultKind,safe_code:RunPreflightJobSafeCodeSchema.nullable(),
      owner_token:z.string().uuid().nullable(),claim_token:z.string().uuid().nullable(),payload_json:z.string(),payload_hash:HashSchema}).parse(value);
    const job=RunPreflightJobViewSchema.parse(parseStoredJson(row.payload_json));
    const configuration=ReadyRunConfigurationSchema.parse(parseStoredJson(row.configuration_json));
    const profile=resolveReadyInferenceProfile(configuration);
    if(sha256(row.payload_json)!==row.payload_hash||canonicalJson(job)!==row.payload_json
      ||sha256(row.configuration_json)!==row.configuration_hash||canonicalJson(configuration)!==row.configuration_json
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
    if(database.prepare('SELECT 1 FROM run_draft_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
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
        ||!currentConfiguration.success
        ||(currentConfiguration.success&&canonicalJson(run.snapshot)!==canonicalJson(currentConfiguration.data.worldSnapshot));
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
    if(database.prepare('SELECT 1 FROM pi_oauth_job_operations WHERE principal_id=? AND idempotency_key=?').get(input.principalId,input.idempotencyKey)!==undefined
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
    if (inputs.length === 0) throw new Error('Job de actor sin percepciones asignadas');
    return ActorTurnJobViewSchema.parse({
      runId: row.run_id, actorId: row.actor_id, jobId: row.job_id, generation: row.generation,
      pulseId: row.pulse_id, lifecycleRevision: row.lifecycle_revision, state: row.state,
      failureCode: row.failure_code, perceptionIds: inputs, frozenPerceptionIds, frozenWorldCut,
    });
  }

  function coordinatorPulseView(input: z.infer<typeof CoordinatorPulseLookupSchema>) {
    const value = database.prepare(`SELECT c.*,p.max_calls,p.consumed FROM coordinator_pulses c JOIN pulses p ON p.pulse_id=c.pulse_id
      WHERE c.run_id=? AND c.pulse_id=?`).get(input.runId, input.pulseId);
    if (value === undefined) return undefined;
    const row = z.strictObject({ pulse_id: PulseIdSchema, run_id: RunIdSchema, origin_kind: z.enum(['humanIntervention','actorAttempt']),
      origin_id: z.string(), commit_index: counter, configuration_hash: HashSchema, state: z.enum(['running','completed','blocked']),
      lifecycle_revision: counter.nullable(), created_at: counter, updated_at: counter, max_calls: counter, consumed: counter }).parse(value);
    const run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(input.runId));
    if (row.configuration_hash !== run.row.configuration_hash) throw new Error('Configuración del pulso coordinador difiere de la corrida');
    const jobs = database.prepare(`SELECT * FROM actor_turn_jobs j WHERE run_id=? AND pulse_id=?
      AND NOT EXISTS(SELECT 1 FROM actor_turn_jobs newer WHERE newer.job_id=j.job_id AND newer.generation>j.generation)
      ORDER BY actor_id,job_id`).all(input.runId, input.pulseId).map(actorTurnJobView);
    return CoordinatorPulseViewSchema.parse({ runId: row.run_id, pulseId: row.pulse_id,
      lifecycleRevision: row.lifecycle_revision,
      cause: { kind: row.origin_kind, id: row.origin_id, commitIndex: row.commit_index }, state: row.state,
      maxCalls: row.max_calls, consumed: row.consumed, jobs });
  }

  function assignCoordinatorCauseJobs(run: ReturnType<typeof parseWorldRun>, configuration: z.infer<typeof ReadyRunConfigurationSchema>, pulse: z.infer<typeof CoordinatorPulseViewSchema>) {
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
    const sessionValue = database.prepare('SELECT * FROM actor_pi_sessions WHERE run_id=? AND actor_id=?').get(execution.runId, execution.actorId);
    if (sessionValue !== undefined && canonicalJson(resolveStoredPiProfile(actorSessionBase(sessionValue).profile)) !== canonicalJson(selected)) throw new Error('Perfil actoral registrado distinto de la configuración del claim');
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
    const rowValue = database.prepare('SELECT * FROM actor_pi_sessions WHERE run_id=? AND actor_id=?')
      .get(candidate.runId, candidate.actorId);
    if (rowValue === undefined) throw new Error('La sesión Pi del actor no está registrada');
    const row = ActorPiSessionRowSchema.parse(rowValue);
    const base = actorSessionBase(rowValue);
    if (base.sessionId !== candidate.base.sessionId || base.sessionPath !== candidate.base.sessionPath
      || base.preparedContextHash !== candidate.base.preparedContextHash
      || canonicalJson(base.profile) !== canonicalJson(candidate.base.profile)
      || base.sessionRevision !== candidate.base.sessionRevision
      || base.committedLeafId !== candidate.base.committedLeafId
      || row.actor_id !== candidate.actorId) {
      throw new Error('El candidato Pi parte de un checkpoint distinto del aceptado por el host');
    }
    const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(candidate.runId);
    if (runValue === undefined) throw new Error('Corrida del candidato Pi ausente');
    const run = parseWorldRun(runValue);
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
    const pulseValue = database.prepare(`SELECT lifecycle_revision FROM coordinator_pulses WHERE run_id=? AND pulse_id=?`)
      .get(job.run_id, job.pulse_id);
    if (pulseValue === undefined) return true;
    const pulse = z.strictObject({ lifecycle_revision: counter.nullable() }).parse(pulseValue);
    return pulse.lifecycle_revision !== null && pulse.lifecycle_revision === run.row.lifecycle_revision;
  }

  function assertActorExecutionEpoch(execution: z.infer<typeof ActorJobExecutionSchema>): void {
    const job = claimedActorJob(execution);
    if (job === undefined) throw new Error('El claim actoral ya no puede escribir en el journal');
    const runValue = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(execution.runId);
    if (runValue === undefined || !actorJobEpochCurrent(job,parseWorldRun(runValue))) {
      throw new Error('El claim actoral pertenece a una época de lifecycle anterior');
    }
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
    const sessionValue = database.prepare('SELECT * FROM actor_pi_sessions WHERE run_id=? AND actor_id=?')
      .get(execution.runId, execution.actorId);
    if (sessionValue === undefined) return { kind: 'inactive', reason: 'session_missing' };
    const session = actorSessionBase(sessionValue);
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

  function reconcileRunLifecycleEpoch(runId: z.infer<typeof RunIdSchema>, lifecycle: z.infer<typeof WorldLifecycleSchema>, revision: number, timestamp: number): void {
    if (lifecycle !== 'running') {
      blockRunningActorJobs(runId, timestamp);
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
    const session=actorSessionBase(database.prepare('SELECT * FROM actor_pi_sessions WHERE run_id=? AND actor_id=?').get(execution.runId,execution.actorId));
    if(canonicalJson(session)!==canonicalJson(candidate.base)||canonicalJson(candidate.inputCut)!==canonicalJson(frozenActorTurnWorldCut(job))
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
          if (assignedPerceptionIds.length === 0 || assignedPerceptionIds.some((perceptionId) =>
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
        const currentBase = actorSessionBase(database.prepare('SELECT * FROM actor_pi_sessions WHERE run_id=? AND actor_id=?')
          .get(candidate.runId, candidate.actorId));
        if (currentBase.sessionRevision !== candidate.base.sessionRevision
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
          WHERE run_id=? AND actor_id=? AND session_revision=? AND committed_leaf_id IS ?
        `).run(receipt.committedLeafId, receipt.sessionRevision, acceptedAt,
          candidate.runId, candidate.actorId, candidate.base.sessionRevision, candidate.base.committedLeafId);
        if (updated.changes !== 1) throw new Error('Conflicto CAS al avanzar el checkpoint Pi aceptado');
        database.prepare(`
          INSERT INTO actor_pi_turn_receipts(candidate_id,receipt_json,receipt_hash,acceptance_hash,accepted_at)
          VALUES(?,?,?,?,?)
        `).run(candidate.candidateId, receiptPayload.json, receiptPayload.hash, acceptance.hash, acceptedAt);
        return receipt;

  }

  function registerWorldRunWithinTransaction(input:unknown,replaceEditable=false):'stored'|'existing' {
      const registration = WorldRunRegistrationSchema.parse(input);
      const snapshot = WorldSnapshotSchema.parse(registration.initialSnapshot);
      const fence = WorldContinuityFenceSchema.parse(registration.continuityFence);
      if (fence.atWorldSeq !== snapshot.seq) throw new Error('El continuity fence debe corresponder al corte inicial');
      const scene = snapshot.scenes.find((item) => item.id === snapshot.activeSceneId);
      if (scene === undefined) throw new Error('El escenario inicial no tiene escena activa');
      const preparedActors = snapshot.entities.flatMap((entity) => entity.kind === 'character'
        && entity.preparation.kind === 'prepared' && scene.participantIds.includes(entity.characterId)
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
          if(!replaceEditable||(existing.row.lifecycle!=='draft'&&existing.row.lifecycle!=='ready'))throw new Error('Run existente requiere una nueva lineage/configuración versionada');
          database.prepare(`UPDATE world_runs SET config_revision=?,configuration_json=?,configuration_hash=?,continuity_fence_json=?,lifecycle='ready',
            world_revision=?,last_seq=?,commit_index=0,initial_snapshot_json=?,initial_snapshot_hash=?,snapshot_json=?,snapshot_hash=?,updated_at=? WHERE run_id=? AND lifecycle IN('draft','ready')`)
            .run(registration.configurationRevision,configurationJson,configurationHash,fenceJson,snapshot.revision,snapshot.seq,snapshotJson,snapshotHash,snapshotJson,snapshotHash,Date.now(),snapshot.runId);
          if(ReadyRunConfigurationSchema.safeParse(registration.configuration).success) ensureModelTimeRunState(snapshot.runId);
          database.prepare('DELETE FROM world_prepared_contexts WHERE run_id=?').run(snapshot.runId);
          database.prepare('DELETE FROM actor_knowledge WHERE run_id=?').run(snapshot.runId);
          for(const context of fence.contexts){
            database.prepare('INSERT INTO world_prepared_contexts VALUES(?,?,?,?,?,?)').run(snapshot.runId,context.actorId,registration.configurationRevision,context.continuityId,context.identityVersion,context.preparedContextHash);
            const knowledge=hashJson(emptyActorKnowledge({runId:snapshot.runId,actorId:context.actorId}));
            database.prepare('INSERT INTO actor_knowledge VALUES(?,?,0,?,?,?)').run(snapshot.runId,context.actorId,snapshot.seq,knowledge.json,knowledge.hash);
          }
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
          const knowledge = emptyActorKnowledge({ runId: snapshot.runId, actorId: context.actorId });
          const knowledgePayload = hashJson(knowledge);
          database.prepare(`
            INSERT INTO actor_knowledge(run_id,actor_id,knowledge_revision,at_world_seq,payload_json,payload_hash)
            VALUES(?,?,0,?,?,?)
          `).run(snapshot.runId, context.actorId, snapshot.seq, knowledgePayload.json, knowledgePayload.hash);
        }
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

  return {
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
        command_kind: z.enum(['start', 'pause', 'resume', 'stop', 'close']), request_hash: HashSchema,
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
            command_kind: z.enum(['start', 'pause', 'resume', 'stop', 'close']), request_hash: HashSchema,
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
          || run.row.world_revision !== request.expectedWorldRevision) {
          return record(RunLifecycleCommandResultSchema.parse({ kind: 'stale', state: state() }));
        }

        const transition = resolveRunControlTransition(run.row.lifecycle, request.command);
        if (transition.kind === 'invalid' || transition.kind === 'singlePulse') {
          return record(RunLifecycleCommandResultSchema.parse({ kind: 'invalidLifecycle', lifecycle: run.row.lifecycle }));
        }

        if (request.command.kind === 'start' || request.command.kind === 'resume') {
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

        const now = Date.now();
        const changed = database.prepare(`UPDATE world_runs SET lifecycle=?,lifecycle_revision=lifecycle_revision+1,closed_at=?,updated_at=?
          WHERE run_id=? AND lifecycle_revision=? AND config_revision=? AND world_revision=?`)
          .run(transition.to, transition.to === 'closed' ? now : null, now, request.runId,
            request.expectedLifecycleRevision, request.expectedConfigRevision, request.expectedWorldRevision);
        if (changed.changes !== 1) throw new Error('CAS de lifecycle cambió dentro de la transacción');
        run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId));
        reconcileRunLifecycleEpoch(request.runId, run.row.lifecycle, run.row.lifecycle_revision, now);
        return record(RunLifecycleCommandResultSchema.parse({ kind: 'updated', state: state() }));
      });
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
        if (run.row.lifecycle !== 'running') throw new Error('El mundo no acepta intervenciones fuera de running');
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
        database.prepare(`UPDATE world_proposals SET status='resolved' WHERE run_id=? AND proposal_id=? AND version=? AND status='pending'`)
          .run(request.runId, request.proposalId, request.version);
        return { kind: 'committed' as const, commitIndex, resolution };
      });
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
              ||hashJson(parsed.data).hash!==run.row.configuration_hash||canonicalJson(parsed.data.worldSnapshot)!==canonicalJson(run.snapshot)
              ||parsed.data.worldSnapshot.revision!==run.row.world_revision||parsed.data.worldSnapshot.seq!==run.row.last_seq
              ||parsed.data.fictionalAt!==run.snapshot.clock.instant){
              result=RunPreflightJobStartResultSchema.parse({kind:'invalidConfiguration'});
            }else{
              const configuration=parsed.data;const profile=runInferenceProfile({...run,configuration});
              const profileFingerprint=fingerprintInferenceProfile(profile);const timestamp=new Date().toISOString();const job=RunPreflightJobViewSchema.parse({
                kind:'run-preflight-job',jobId:JobIdSchema.parse(randomUUID()),runId:request.runId,state:'queued',revision:0,createdAt:timestamp,updatedAt:timestamp,
                configurationRevision:run.row.config_revision,worldRevision:run.row.world_revision,worldSeq:run.row.last_seq,
                fictitiousAt:run.snapshot.clock.instant,resultKind:null,safeCode:null,
              });
              const payload=hashJson(job);const configurationJson=canonicalJson(configuration);
              database.prepare(`INSERT INTO run_preflight_jobs(job_id,run_id,principal_id,state,revision,created_at,updated_at,configuration_revision,configuration_hash,
                configuration_json,world_revision,world_seq,fictitious_at,provider,profile_fingerprint,result_kind,safe_code,owner_token,claim_token,payload_json,payload_hash)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,?,?)`)
                .run(job.jobId,request.runId,request.principalId,job.state,job.revision,job.createdAt,job.updatedAt,job.configurationRevision,
                  run.row.configuration_hash,configurationJson,job.worldRevision,job.worldSeq,job.fictitiousAt,profile.provider,profileFingerprint,payload.json,payload.hash);
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
        if(entry.draft.revision!==request.expectedRevision)return recordRunDraftOperation({...operation,recordedAt,result:RunDraftValidationResultSchema.parse({kind:'conflict',currentRevision:entry.draft.revision})});
        const worldValue=database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);const world=worldValue===undefined?undefined:parseWorldRun(worldValue);
        if(world!==undefined&&world.row.lifecycle!=='draft'&&world.row.lifecycle!=='ready')return recordRunDraftOperation({...operation,recordedAt,result:RunDraftValidationResultSchema.parse({kind:'invalidLifecycle',lifecycle:world.row.lifecycle})});
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
          lifecycle:world?.row.lifecycle??'draft',worldRevision:world?.row.world_revision??null,configurationHash:world?.row.configuration_hash??null});
      });
    },

    readRunConfigurationDraft(input:unknown){return readRunDraft(RunDraftReadSchema.parse(input))?.draft;},
    listRunConfigurationDrafts(input:unknown={}){
      const request=RunDraftListSchema.parse(input);return database.prepare(`SELECT h.* FROM run_configuration_drafts d JOIN run_configuration_draft_history h ON h.run_id=d.run_id AND h.revision=d.revision
        ORDER BY d.updated_at DESC,d.run_id LIMIT ? OFFSET ?`).all(request.limit,request.offset).map(runDraftHistoryEntry).map((entry)=>entry.draft);
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
          request.purpose.kind==='request-input'?request.purpose.requestSeq:null,payload.json,Date.now());return 'stored';
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

    beginCoordinatorPulse(input: unknown) {
      const request = CoordinatorPulseRequestSchema.parse(input);
      return transact(() => {
        const value = database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId);
        if (value === undefined) return CoordinatorPulseBeginResultSchema.parse({ kind: 'inactive' });
        const run = parseWorldRun(value);
        if (run.row.lifecycle !== 'running') return CoordinatorPulseBeginResultSchema.parse({ kind: 'inactive' });
        const configuration = ReadyRunConfigurationSchema.parse(run.configuration);
        if (configuration.runId !== request.runId || configuration.configRevision !== run.row.config_revision) throw new Error('Configuración ready ajena al pulso');
        const running = database.prepare(`SELECT pulse_id FROM coordinator_pulses WHERE run_id=? AND state='running'`).get(request.runId);
        if (running !== undefined) {
          const pulseId = z.strictObject({ pulse_id: PulseIdSchema }).parse(running).pulse_id;
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
            actor_id: CharacterIdSchema, perception_id: PerceptionIdSchema, origin_kind: z.enum(['humanIntervention','actorAttempt']), origin_id: z.string(), commit_index: counter }).parse(item));
        if (pending.length > 100_000) throw new Error('Demasiadas intenciones para coordinar un pulso');
        const cause = pending[0];
        if (cause === undefined) return CoordinatorPulseBeginResultSchema.parse({ kind: 'idle' });
        const previous = database.prepare('SELECT pulse_id FROM coordinator_pulses WHERE run_id=? AND origin_kind=? AND origin_id=?')
          .get(request.runId, cause.origin_kind, cause.origin_id);
        if (previous !== undefined) {
          const pulseId = z.strictObject({ pulse_id: PulseIdSchema }).parse(previous).pulse_id;
          const pulse = coordinatorPulseView({ runId: request.runId, pulseId });
          if (pulse === undefined) throw new Error('Pulso de causa perdido');
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
        if (eligible.length === 0) return CoordinatorPulseBeginResultSchema.parse({ kind: 'idle' });
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
        (EXISTS(SELECT 1 FROM coordinator_pulses c WHERE c.run_id=r.run_id AND c.state='running') OR
         EXISTS(SELECT 1 FROM actor_turn_intents i JOIN world_deliveries d ON d.perception_id=i.perception_id
           WHERE i.run_id=r.run_id AND i.state='queued' AND d.state='delivered'
           AND NOT EXISTS(SELECT 1 FROM actor_turn_job_inputs a WHERE a.perception_id=i.perception_id AND a.state IN('assigned','consumed'))))
        ORDER BY run_id LIMIT ?`).all(request.limit).map((item) => z.strictObject({ run_id: RunIdSchema }).parse(item)).map((item) => ({ runId: item.run_id }));
    },
    closeCoordinatorPulse(input: unknown) {
      const request = CoordinatorPulseLookupSchema.parse(input);
      return transact(() => {
        const pulse = coordinatorPulseView(request);
        if (pulse === undefined) throw new Error('Pulso coordinador inexistente');
        if (pulse.state !== 'running') return pulse;
        const awaiting = database.prepare(`SELECT 1 FROM actor_turn_intents i JOIN world_perceptions p ON p.perception_id=i.perception_id
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
        if (terminal && !awaiting) database.prepare(`UPDATE coordinator_pulses SET state=?,updated_at=? WHERE run_id=? AND pulse_id=? AND state='running'`)
          .run(pulse.jobs.some((job) => job.state === 'blocked') ? 'blocked' : 'completed', Date.now(), request.runId, request.pulseId);
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
        const job = actorTurnJobView(rowValue);
        if (row.state === 'accepted') return ActorTurnJobClaimResultSchema.parse({ kind: 'accepted', job });
        if (row.state === 'blocked') return ActorTurnJobClaimResultSchema.parse({ kind: 'blocked', job });
        if (row.state === 'running') {
          if (row.owner_token === request.ownerToken && row.claim_token === request.claimToken) {
            return ActorTurnJobClaimResultSchema.parse({
              kind: 'existing', job, ownerToken: request.ownerToken, claimToken: request.claimToken,
            });
          }
          return ActorTurnJobClaimResultSchema.parse({ kind: 'busy' });
        }
        let frozenPerceptionIds = frozenActorTurnPerceptionIds(row);
        let frozenWorldCut = frozenActorTurnWorldCut(row);
        if (frozenPerceptionIds === null || frozenWorldCut === null) {
          const run = parseWorldRun(database.prepare('SELECT * FROM world_runs WHERE run_id=?').get(request.runId));
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
        const updated = database.prepare(`
          UPDATE actor_turn_jobs SET state='running',owner_token=?,claim_token=?,frozen_perception_ids_json=?,
            frozen_world_cut_json=?,updated_at=?
          WHERE run_id=? AND actor_id=? AND job_id=? AND generation=? AND state='queued'
        `).run(request.ownerToken, request.claimToken, frozenJson, frozenWorldCutJson, Date.now(),
          request.runId, request.actorId, request.jobId, request.generation);
        if (updated.changes !== 1) return ActorTurnJobClaimResultSchema.parse({ kind: 'busy' });
        const claimedValue = database.prepare(`
          SELECT * FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=? AND generation=?
        `).get(request.runId, request.actorId, request.jobId, request.generation);
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
        const session = actorSessionBase(database.prepare('SELECT * FROM actor_pi_sessions WHERE run_id=? AND actor_id=?')
          .get(execution.runId, execution.actorId));
        if (session.sessionId !== snapshot.sessionId || session.sessionPath !== snapshot.sessionPath) {
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
        const existingValue = database.prepare('SELECT * FROM actor_pi_sessions WHERE run_id=? AND actor_id=?')
          .get(registration.runId, registration.actorId);
        if (existingValue !== undefined) {
          const existingRow = ActorPiSessionRowSchema.parse(existingValue);
          const base = actorSessionBase(existingValue);
          if (existingRow.session_id !== registration.sessionId || existingRow.session_path !== registration.sessionPath
            || existingRow.prepared_context_hash !== registration.preparedContextHash
            || existingRow.profile_hash !== profilePayload.hash || existingRow.profile_json !== profilePayload.json) {
            throw new Error('La sesión ya tiene otra identidad, ruta, preparación o perfil');
          }
          return ActorPiRegistrationResultSchema.parse({ kind: 'existing', session: base });
        }
        if(registration.execution!==undefined)assertActorExecutionEpoch(registration.execution);
        const timestamp = Date.now();
        database.prepare(`
          INSERT INTO actor_pi_sessions(
            run_id,actor_id,session_id,session_path,prepared_context_hash,profile_json,profile_hash,
            committed_leaf_id,session_revision,created_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,NULL,0,?,?)
        `).run(registration.runId, registration.actorId, registration.sessionId, registration.sessionPath,
          registration.preparedContextHash, profilePayload.json, profilePayload.hash, timestamp, timestamp);
        const row = database.prepare('SELECT * FROM actor_pi_sessions WHERE run_id=? AND actor_id=?')
          .get(registration.runId, registration.actorId);
        return ActorPiRegistrationResultSchema.parse({ kind: 'stored', session: actorSessionBase(row) });
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
        const current = actorSessionBase(rowValue);
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
        return ActorPiRotationResultSchema.parse({ kind: 'rotated', session: actorSessionBase(rotatedValue) });
      });
    },

    loadActorPiSession(input: unknown) {
      const request = z.strictObject({ runId: RunIdSchema, actorId: CharacterIdSchema }).parse(input);
      const row = database.prepare('SELECT * FROM actor_pi_sessions WHERE run_id=? AND actor_id=?')
        .get(request.runId, request.actorId);
      return row === undefined ? undefined : actorSessionBase(row);
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
