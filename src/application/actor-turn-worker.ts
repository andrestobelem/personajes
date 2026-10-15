import { SelectableInferenceProfileSchema, resolveReadyInferenceProfile, resolveStoredPiProfile } from '../domain/inference-profile.ts';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { verifyPiActorSessionIntegrity } from '../adapters/pi-session-integrity.ts';
import type { openJournal } from '../adapters/journal.ts';
import type { IcmActorMemoryReader } from '../adapters/icm.ts';
import { createPiSession, type CreatePiSessionInput, type PiRuntime, type PiSessionHandle } from '../adapters/pi.ts';
import { ActorJobExecutionSchema, ActorTurnJobClaimSchema, ActorTurnJobScopeSchema, ActorTurnJobViewSchema, ContinuistaReviewInputSchema, ContinuistaCriterionSchema, type WorldProposalRecord } from '../domain/world-journal.ts';
import { HashSchema } from '../domain/values.ts';
import type { WorldIdSource } from '../domain/world.ts';
import { createActorTools } from './actor-tools.ts';
import { createActorPiRequestPort } from './actor-pi-request-port.ts';
import { createActorWorldProjectionPort, ActorWorldProjectionSchema } from './actor-world-projection.ts';
import { compilePrivateActorPrompt } from './prepare-character.ts';
import { ReadyRunConfigurationSchema } from './production-preflight.ts';

type Journal = Pick<ReturnType<typeof openJournal>,
  'readActorTurnRecovery' | 'acceptRecoveredActorTurn' | 'failActorTurnJob' | 'claimActorTurnJob' | 'readWorldConfiguration' | 'readExperiences' | 'loadActorWorldCut' | 'readActorMetaIndications'
  | 'compareAndSwapActorKnowledge' | 'loadActorPiSession' | 'registerActorPiSession'
  | 'rotateUnacceptedActorPiSession' | 'checkActorJobEligibility' | 'reserveActorJobRequest'
  | 'expireActorJobRequest' | 'settleActorJobRequestWallTime' | 'transitionActorJobReservation' | 'recordActorJobCheckpoint' | 'recordActorPiCandidate'
  | 'registerWorldProposal' | 'readActorJobProposal' | 'readActorJobAcceptedProposal' | 'recordContinuistaReview' | 'acceptActorTurn' | 'commitWorldAttempt'>;

// Host ownership permits one journal handle; all worker instances sharing it share actor exclusion.
// Keys stop concurrent use of a private Pi history while leaving other actors independent.
const activeActorsByJournal = new WeakMap<Journal, Set<string>>();

type Execution = z.infer<typeof ActorJobExecutionSchema>;
type Commit = ReturnType<Journal['commitWorldAttempt']>;
export type ActorTurnWorkerResult =
  | { kind: 'unclaimed'; reason: 'missing' | 'busy' | 'accepted' | 'blocked' }
  | { kind: 'blocked'; code: 'cancelled' | 'pi-incomplete' | 'proposal-missing' | 'review-incomplete' | 'review-rejected' | 'reformulations-exhausted' | 'job-inactive' | 'recovery-required'; execution: Execution }
  | { kind: 'recovered'; job: z.infer<typeof ActorTurnJobViewSchema>; proposal: WorldProposalRecord; commit: Commit }
  | { kind: 'committed'; execution: Execution; proposal: WorldProposalRecord; commit: Commit };

/** Review runs in the host boundary; its free text and evidence never enter actor feedback. */
export type ActorContinuistaPort = {
  review(input: { execution: Execution; proposal: WorldProposalRecord; signal?: AbortSignal }): Promise<unknown>;
};

export function createActorTurnWorker(input: {
  journal: Journal;
  runtime: PiRuntime;
  ids: WorldIdSource;
  memoryForActor(input: { runId: Execution['runId']; actorId: Execution['actorId'] }): IcmActorMemoryReader;
  continuista: ActorContinuistaPort;
  /** Explicit injection for deterministic transport tests; production defaults to OAuth Pi. */
  sessionFactory?: (input: CreatePiSessionInput) => Promise<PiSessionHandle>;
  /** Delivery scheduling must be idempotent by durable commit origin/index: recovery may repeat this callback for an existing commit. */
  onCommitted?: (input: { scope: z.infer<typeof ActorTurnJobScopeSchema>; commit: Commit }) => void | Promise<void>;
}) {
  return {
    async run(rawClaim: unknown, options: { signal?: AbortSignal } = {}): Promise<ActorTurnWorkerResult> {
      const claim = ActorTurnJobClaimSchema.parse(rawClaim);
      let activeActors = activeActorsByJournal.get(input.journal);
      if (activeActors === undefined) {
        activeActors = new Set<string>();
        activeActorsByJournal.set(input.journal, activeActors);
      }
      const actorKey = JSON.stringify([claim.runId, claim.actorId]);
      if (activeActors.has(actorKey)) return { kind: 'unclaimed', reason: 'busy' };
      activeActors.add(actorKey);
      try {
        const claimed = input.journal.claimActorTurnJob(claim);
        if (claimed.kind === 'accepted') {
          const proposal = input.journal.readActorJobAcceptedProposal({ runId: claim.runId, actorId: claim.actorId, jobId: claim.jobId, generation: claim.generation });
          if (proposal === undefined) throw new Error('El job aceptado no conserva una propuesta durable recuperable');
          const commit = input.journal.commitWorldAttempt({ runId: claim.runId, proposalId: proposal.proposalId, version: proposal.version, ids: input.ids });
          const scope = jobScope(claimed.job);
          await input.onCommitted?.({ scope, commit });
          return { kind: 'recovered', job: claimed.job, proposal, commit };
        }
        if (claimed.kind !== 'claimed' && claimed.kind !== 'existing') return { kind: 'unclaimed', reason: claimed.kind };
        const execution = ActorJobExecutionSchema.parse({
          runId: claimed.job.runId, actorId: claimed.job.actorId, jobId: claimed.job.jobId,
          generation: claimed.job.generation, pulseId: claimed.job.pulseId,
          lease: { ownerToken: claimed.ownerToken, claimToken: claimed.claimToken },
        });
        try {
          const blocked = (code: Extract<ActorTurnWorkerResult, { kind: 'blocked' }>['code']): ActorTurnWorkerResult => {
            input.journal.failActorTurnJob({ execution, code });
            return { kind: 'blocked', code, execution };
          };
          if (options.signal?.aborted) return blocked('cancelled');
          // Inspect durable history before compiling context or opening another session.
          // A tentative tail is never permission to repeat model requests or overwrite its proposal slot.
          const recovery = input.journal.readActorTurnRecovery({ execution });
          if (recovery.kind === 'pending') return blocked('recovery-required');
          if (recovery.kind === 'completed') {
            const integrity = verifyPiActorSessionIntegrity({ privateDataRoot: input.runtime.privateDataRoot, runId: execution.runId, actorId: execution.actorId, ...recovery.sessionIntegrity });
            if (integrity.kind !== 'verified') return blocked('recovery-required');
            input.journal.acceptRecoveredActorTurn({ execution, candidateId: recovery.candidateId, proposalBinding: recovery.proposalBinding });
            const commit = input.journal.commitWorldAttempt({ runId: execution.runId, proposalId: recovery.proposal.proposalId,
              version: recovery.proposal.version, ids: input.ids });
            const accepted = input.journal.claimActorTurnJob(claim);
            if (accepted.kind !== 'accepted') throw new Error('La aceptación recuperada no cerró el job actoral');
            await input.onCommitted?.({ scope: jobScope(accepted.job), commit });
            return { kind: 'recovered', job: accepted.job, proposal: recovery.proposal, commit };
          }
          const configuration = ReadyRunConfigurationSchema.parse(input.journal.readWorldConfiguration({ runId: execution.runId }));
          if (configuration.runId !== execution.runId || !configuration.roster.activeCharacterIds.includes(execution.actorId)) {
            throw new Error('La ejecución actoral no pertenece al reparto activo de la configuración durable');
          }
          const inferenceProfile = resolveReadyInferenceProfile(configuration);
          if (!SelectableInferenceProfileSchema.safeParse(inferenceProfile).success) throw new Error('El perfil histórico retirado sólo permite recuperar resultados durables, sin inferencias nuevas');
          const prepared = configuration.roster.preparedCharacters.find((actor) => actor.characterId === execution.actorId);
          if (prepared === undefined) throw new Error('Falta la preparación durable del actor');
          const preparedContextHash = HashSchema.parse(createHash('sha256').update(canonicalJson(prepared)).digest('hex'));
          const cut = claimed.job.frozenWorldCut;
          if (cut === null) throw new Error('El claim no congeló el corte actoral');
          const hostProjection = createActorWorldProjectionPort({
            host: {
              async loadActorWorldCut(request) { return input.journal.loadActorWorldCut(request); },
              async compareAndSwapActorKnowledge(request) { return input.journal.compareAndSwapActorKnowledge(request); },
            },
            ids: input.ids,
          });
          // Compile against the real World projection once; subsequent reformulations retain this exact cut.
          let projection: z.infer<typeof ActorWorldProjectionSchema> | undefined;
          const prompt = await compilePrivateActorPrompt({
            prepared, runId: execution.runId, worldRevision: cut.worldRevision,
            throughWorldSeq: cut.worldSeq, fictionalAt: cut.fictionalAt,
            spanishVariety: configuration.spanishVariety,
            experiences: input.journal.readExperiences({ runId: execution.runId, actorId: execution.actorId, throughWorldSeq: cut.worldSeq }),
            directionContext: claimed.job.frozenDirectionRevision===null
              ? {directionRevision:0,indications:[]}
              : input.journal.readActorMetaIndications({runId:execution.runId,actorId:execution.actorId,
                directionRevision:claimed.job.frozenDirectionRevision,activeSceneId:cut.activeSceneId??null}),
            activationContext:claimed.job.activation?.trigger??null,
            actorJob: { jobId: execution.jobId, generation: execution.generation, ...execution.lease },
            actorWorldProjectionPort: {
              async projectForActor(request) {
                projection = ActorWorldProjectionSchema.parse(await hostProjection.projectForActor(request));
                return projection;
              },
            },
          });
          if (projection === undefined || canonicalJson(projection.inputPerceptionIds) !== canonicalJson(cut.perceptionIds)) {
            throw new Error('La proyección no conserva el inbox congelado del claim');
          }
          if (options.signal?.aborted) return blocked('cancelled');
          const previous = input.journal.loadActorPiSession({ runId: execution.runId, actorId: execution.actorId });
          if (previous !== undefined && previous.preparedContextHash !== preparedContextHash) throw new Error('La preparación no coincide con la sesión actoral registrada');
          if (previous !== undefined && canonicalJson(resolveStoredPiProfile(previous.profile)) !== canonicalJson(inferenceProfile)) throw new Error('El perfil seleccionado no coincide con la sesión actoral registrada');
          let version = 1;
          const tools = createActorTools({
            context: { runId: execution.runId, actorId: execution.actorId, jobId: execution.jobId,
              generation: execution.generation, lease: execution.lease, worldRevision: cut.worldRevision,
              throughWorldSeq: cut.worldSeq, proposalVersion: 1, proposalSlot: 0 },
            getProposalVersion: () => version,
            journal: input.journal, memory: input.memoryForActor(execution),
          });
          const session = await (input.sessionFactory ?? createPiSession)({
            runtime: input.runtime, profile: inferenceProfile, runId: execution.runId, identity: { kind: 'actor', characterId: execution.actorId },
            systemPrompt: prompt.text, preparedContextHash, sessionRevision: previous?.sessionRevision ?? 0,
            checkpoint: previous === undefined ? { kind: 'fresh' }
              : previous.committedLeafId === null ? { kind: 'initial', previousSessionPath: previous.sessionPath }
                : { kind: 'leaf', sessionPath: previous.sessionPath, committedLeafId: previous.committedLeafId },
            tools, adminToolAllowlist: {}, requestPort: createActorPiRequestPort({ journal: input.journal, execution, ...(options.signal === undefined ? {} : { signal: options.signal }) }),
          });
          let disposePromise: Promise<void> | undefined;
          const dispose = () => { disposePromise ??= session.abortAndDispose(); return disposePromise; };
          const cancel = () => { void dispose().catch(() => undefined); };
          options.signal?.addEventListener('abort', cancel, { once: true });
          try {
            const checkpoint = session.checkpoint();
            if (checkpoint.sessionPath === null) throw new Error('Pi no devolvió una sesión durable');
            if (previous === undefined) {
              input.journal.registerActorPiSession({ runId: execution.runId, actorId: execution.actorId,
                sessionId: checkpoint.sessionId, sessionPath: checkpoint.sessionPath, preparedContextHash,
                profile: inferenceProfile, execution });
            } else if (previous.committedLeafId === null) {
              input.journal.rotateUnacceptedActorPiSession({ runId: execution.runId, actorId: execution.actorId,
                expected: previous, sessionId: checkpoint.sessionId, sessionPath: checkpoint.sessionPath, execution });
            } else if (checkpoint.sessionId !== previous.sessionId || checkpoint.sessionPath !== previous.sessionPath) {
              throw new Error('Pi abrió una identidad distinta de la sesión actoral confirmada');
            }
            let text = 'Actúa desde tu situación actual. Registra tu acción mediante propose_action; todavía no ha ocurrido.';
            for (version = 1; version <= configuration.maxReformulations + 1; version += 1) {
              if (options.signal?.aborted) return blocked('cancelled');
              let terminal: Awaited<ReturnType<typeof session.prompt>>;
              try {
                terminal = await session.prompt({ text,
                  scope: { runId: execution.runId, pulseId: execution.pulseId, jobId: execution.jobId, generation: execution.generation },
                  inputCut: cut, lease: execution.lease,
                });
              } catch (error) {
                const eligibility = input.journal.checkActorJobEligibility(execution);
                if (eligibility.kind === 'inactive' && ['run_not_running','lifecycle_epoch_stale','claim_inactive'].includes(eligibility.reason)) {
                  return blocked('job-inactive');
                }
                throw error;
              }
              if (options.signal?.aborted) return blocked('cancelled');
              const eligibility = input.journal.checkActorJobEligibility(execution);
              if (eligibility.kind !== 'active') return blocked(eligibility.reason === 'run_not_running'
                || eligibility.reason === 'lifecycle_epoch_stale' || eligibility.reason === 'claim_inactive'
                ? 'job-inactive' : 'recovery-required');
              if (terminal.outcome !== 'completed' || terminal.candidateId === null) return blocked('pi-incomplete');
              const proposal = input.journal.readActorJobProposal({ runId: execution.runId, actorId: execution.actorId,
                jobId: execution.jobId, generation: execution.generation, version });
              if (proposal === undefined) return blocked('proposal-missing');
              const review = ContinuistaReviewInputSchema.parse(await input.continuista.review({ execution, proposal,
                ...(options.signal === undefined ? {} : { signal: options.signal }) }));
              if (options.signal?.aborted) return blocked('cancelled');
              // The journal checks the exact proposal/hash/revision; never trust a review for another version.
              if (review.runId !== proposal.runId || review.actorId !== proposal.actorId || review.proposalId !== proposal.proposalId
                || review.version !== proposal.version || review.stateRevision !== proposal.baseRevision
                || review.exactContentHash !== proposal.exactContentHash) throw new Error('El Continuista devolvió una revisión de otra propuesta');
              if (input.journal.checkActorJobEligibility(execution).kind !== 'active') return blocked('job-inactive');
              input.journal.recordContinuistaReview(review);
              if (!review.complete || review.evidenceRefs.length === 0
                || !ContinuistaCriterionSchema.options.every((code) => review.criterionCodes.includes(code))) return blocked('review-incomplete');
              if (input.journal.checkActorJobEligibility(execution).kind !== 'active') return blocked('job-inactive');
              if (review.verdict === 'reject') return blocked('review-rejected');
              if (review.verdict === 'reformulate') {
                if (version > configuration.maxReformulations) return blocked('reformulations-exhausted');
                text = JSON.stringify({ kind: 'continuista-feedback', failedCriterionCodes: review.failedCriterionCodes ?? [],
                  instruction: 'Reformula tu acción desde el mismo contexto autorizado. Registra la nueva propuesta mediante propose_action.' });
                continue;
              }
              input.journal.acceptActorTurn({ candidateId: terminal.candidateId, lease: execution.lease,
                proposal: { kind: 'durable', proposalId: proposal.proposalId, version: proposal.version, attemptHash: proposal.attemptHash } });
              const commit = input.journal.commitWorldAttempt({ runId: execution.runId, proposalId: proposal.proposalId,
                version: proposal.version, ids: input.ids });
              await input.onCommitted?.({ scope: jobScope(execution), commit });
              return { kind: 'committed', execution, proposal, commit };
            }
            return blocked('reformulations-exhausted');
          } finally {
            options.signal?.removeEventListener('abort', cancel);
            await dispose();
          }
        } catch (error) {
          // Failure is durable only while this worker still owns its claim.
          try { input.journal.failActorTurnJob({ execution, code: 'execution-failed' }); } catch { /* Keep the original error when ownership changed. */ }
          throw error;
        }
      } finally {
        activeActors.delete(actorKey);
      }
    },
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('La preparación contiene un valor no serializable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = z.record(z.string(), z.unknown()).parse(value);
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function jobScope(job: z.infer<typeof ActorTurnJobScopeSchema>): z.infer<typeof ActorTurnJobScopeSchema> {
  return ActorTurnJobScopeSchema.parse({ runId: job.runId, actorId: job.actorId, jobId: job.jobId, generation: job.generation, pulseId: job.pulseId });
}
