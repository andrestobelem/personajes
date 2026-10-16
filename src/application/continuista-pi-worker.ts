import { SelectableInferenceProfileSchema, resolveReadyInferenceProfile } from '../domain/inference-profile.ts';
import { ReadyRunConfigurationSchema } from './production-preflight.ts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { openJournal } from '../adapters/journal.ts';
import { createPiSession, isPiAdapterFailure, type PiAdapterFailureCode, type CreatePiSessionInput, type PiIdentity, type PiRequestPort, type PiRequestScope, type PiSessionHandle, type PiRuntime, type PiCheckpointCandidate } from '../adapters/pi.ts';
import { ActorJobExecutionSchema, ActorTurnJobFailureCodeSchema, type ContinuistaReviewInput } from '../domain/world-journal.ts';
import type { WorldIdSource } from '../domain/world.ts';
import type { ActorContinuistaPort } from './actor-turn-worker.ts';
import { assembleContinuistaReviewContext, buildContinuistaReviewPrompts, validateContinuistaContextReview } from './continuista-review-context.ts';
import { createContinuistaReviewTool } from './continuista-tools.ts';
import { resolveIcmSessionContext } from './icm-session-context.ts';

type Journal = Pick<ReturnType<typeof openJournal>,
  'claimActorTurnJob' | 'readWorldConfiguration' | 'readActorJobProposal' | 'loadActorWorldCut'
  | 'readIcmContextBinding' | 'readIcmContextPacket' | 'ensureIcmContextPacket'
  | 'compareAndSwapActorKnowledge' | 'loadActorPiSession' | 'readExperiences' | 'checkActorJobEligibility' | 'readDeliveredWorldPerceptions'
  | 'beginContinuistaJob' | 'registerContinuistaSession' | 'loadContinuistaSession'
  | 'checkContinuistaJobEligibility' | 'reserveContinuistaRequest' | 'transitionContinuistaRequest'
  | 'expireContinuistaRequest' | 'settleContinuistaRequestWallTime' | 'recordContinuistaCheckpoint' | 'stageContinuistaReview' | 'acceptContinuistaReview'
  | 'readContinuistaReceipt' | 'failContinuistaJob'>;

export type ContinuistaFailureDiagnostic = {
  kind: 'continuista-failure'; runId: string; actorId: string; jobId: string; generation: number;
  stage: 'profile' | 'session' | 'registration' | 'prompt' | 'terminal' | 'review-tool' | 'validation' | 'eligibility' | 'stage-review' | 'acceptance' | 'disposal';
  code: PiAdapterFailureCode | 'INVALID_SHAPE' | 'EXECUTION_FAILED' | 'CANCELLED';
};

const queuesByJournal = new WeakMap<Journal, Map<string, Promise<void>>>();

/** Production Continuista port: a separate administrative Pi session, same run/pulse quotas. */
export function createContinuistaPiWorker(input: {
  journal: Journal; runtime: PiRuntime; ids: WorldIdSource; ownerToken: string;
  onDiagnostic?: (diagnostic: ContinuistaFailureDiagnostic) => void;
  /** Test-only seam; omitting it always uses the production OAuth/model/profile factory. */
  sessionFactory?: (input: CreatePiSessionInput) => Promise<PiSessionHandle>;
}): ActorContinuistaPort {
  const ownerToken = z.string().uuid().parse(input.ownerToken);
  let queues = queuesByJournal.get(input.journal);
  if (queues === undefined) { queues = new Map(); queuesByJournal.set(input.journal, queues); }
  const runQueues = queues;

  async function review(request: Parameters<ActorContinuistaPort['review']>[0]): Promise<ContinuistaReviewInput> {
    const actorExecution = ActorJobExecutionSchema.parse(request.execution);
    const previous = runQueues.get(actorExecution.runId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const completed = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => completed);
    runQueues.set(actorExecution.runId, tail);
    try {
      await waitForPrevious(previous, request.signal);
      requireNotAborted(request.signal);
      return await performReview({ ...request, execution: actorExecution });
    } finally {
      release();
      if (runQueues.get(actorExecution.runId) === tail) {
        void tail.finally(() => { if (runQueues.get(actorExecution.runId) === tail) runQueues.delete(actorExecution.runId); });
      }
    }
  }

  async function performReview(request: Parameters<ActorContinuistaPort['review']>[0]): Promise<ContinuistaReviewInput> {
    const inferenceProfile = resolveReadyInferenceProfile(ReadyRunConfigurationSchema.parse(input.journal.readWorldConfiguration({ runId: request.execution.runId })));
    const context = await assembleContinuistaReviewContext({ journal: input.journal, execution: request.execution, proposal: request.proposal, ids: input.ids });
    requireNotAborted(request.signal);
    const started = input.journal.beginContinuistaJob({ execution: request.execution, context, ownerToken, claimToken: randomUUID() });
    if (started.kind === 'busy' || started.kind === 'blocked') throw new Error('El trabajo del Continuista está ocupado o bloqueado; requiere recuperación explícita');
    const execution = started.execution;
    const receipt = input.journal.readContinuistaReceipt({ jobId: execution.jobId, generation: execution.generation });
    if (receipt !== undefined) {
      return validateContinuistaContextReview({ context, response: { contextHash: context.contextHash, review: receipt.review } }).review;
    }
    let failureCode: z.infer<typeof ActorTurnJobFailureCodeSchema> = 'execution-failed';
    let stage: ContinuistaFailureDiagnostic['stage'] = 'profile';
    function report(error: unknown, at: ContinuistaFailureDiagnostic['stage']) {
      try { input.onDiagnostic?.({kind:'continuista-failure',runId:request.execution.runId,actorId:request.execution.actorId,
        jobId:execution.jobId,generation:execution.generation,stage:at,
        code:request.signal?.aborted?'CANCELLED':isPiAdapterFailure(error)?error.code:error instanceof z.ZodError?'INVALID_SHAPE':'EXECUTION_FAILED'}); }
      catch { /* Diagnostics cannot alter durable work or disclose the original error. */ }
    }
    try {
      requireNotAborted(request.signal);
      if (!SelectableInferenceProfileSchema.safeParse(inferenceProfile).success) throw new Error('El perfil histórico retirado sólo permite recuperar resultados durables, sin inferencias nuevas');
      // No speculative reopening of a tentative session. Explicit retry creates a new child generation.
      if (input.journal.loadContinuistaSession({ jobId: execution.jobId, generation: execution.generation }) !== undefined) { failureCode='recovery-required'; throw new Error('La sesión tentativa del Continuista necesita recuperación explícita'); }
      const scope: PiRequestScope = { runId: request.execution.runId, pulseId: request.execution.pulseId,
        jobId: execution.jobId, generation: execution.generation };
      function requireBinding(identity: PiIdentity, claimedScope: PiRequestScope): void {
        if (identity.kind !== 'admin' || identity.role !== 'continuista' || claimedScope.runId !== scope.runId
          || claimedScope.pulseId !== scope.pulseId || claimedScope.jobId !== scope.jobId || claimedScope.generation !== scope.generation) throw new Error('El puerto Pi no pertenece al trabajo administrativo Continuista');
      }
      const checkEligibility = () => request.signal?.aborted ? { kind: 'inactive' as const, reason: 'cancelled' }
        : input.journal.checkContinuistaJobEligibility(execution);
      const port: PiRequestPort = {
        checkEligibility({ purpose, scope: requestScope }) { requireBinding(purpose, requestScope); return checkEligibility(); },
        reserveNextRequest({ purpose, scope: requestScope, clockEpochId }) {
          requireBinding(purpose, requestScope); requireNotAborted(request.signal);
          return input.journal.reserveContinuistaRequest({ execution, ...(clockEpochId === undefined ? {} : { clockEpochId }) });
        },
        transitionReservation({ purpose, scope: requestScope, requestSeq, target, wallTime }) {
          requireBinding(purpose, requestScope);
          if (target === 'dispatched') requireNotAborted(request.signal);
          input.journal.transitionContinuistaRequest({ execution, requestSeq, target, ...(wallTime === undefined ? {} : { wallTime }) });
        },
        expireReservation({ purpose, scope: requestScope, requestSeq, clockEpochId, reason }) {
          requireBinding(purpose, requestScope);
          input.journal.expireContinuistaRequest({ execution, requestSeq, clockEpochId, reason });
        },
        settleWallTime({ purpose, scope: requestScope, requestSeq, clockEpochId, monotonicNs }) {
          requireBinding(purpose, requestScope);
          input.journal.settleContinuistaRequestWallTime({ execution, requestSeq, clockEpochId, monotonicNs });
        },
        recordCheckpointCandidate(candidate) {
          requireBinding(candidate.identity, candidate.purpose.baseScope);
          input.journal.recordContinuistaCheckpoint({ execution, purpose: checkpointPurpose(candidate, requireBinding), snapshot: candidate.snapshot });
        },
      };
      const staged = createContinuistaReviewTool({ context, checkEligibility,
        ...(request.signal === undefined ? {} : { signal: request.signal }) });
      const prompts = buildContinuistaReviewPrompts(context);
      const sessionContext = resolveIcmSessionContext({ journal: input.journal,
        binding: { kind: 'continuista', execution }, hostPolicyMarkdown: prompts.systemPrompt,
        diegeticContextMarkdown: prompts.text, legacySystemPrompt: prompts.systemPrompt, legacyPromptText: prompts.text,
        icmPromptText: 'Revisá la propuesta exacta del contexto autorizado y entregá el resultado mediante submit_continuista_review.',
      });
      stage='session';
      const session = await (input.sessionFactory ?? createPiSession)({ runtime: input.runtime, profile: inferenceProfile,
        runId: request.execution.runId, identity: { kind: 'admin', role: 'continuista' },
        systemPrompt: sessionContext.systemPrompt, checkpoint: { kind: 'fresh' }, preparedContextHash: context.contextHash,
        tools: [staged.tool], adminToolAllowlist: { continuista: ['submit_continuista_review'] }, requestPort: port });
      let disposal: Promise<void> | undefined;
      const dispose = () => { disposal ??= session.abortAndDispose(); return disposal; };
      const cancel = () => { void dispose().catch(() => undefined); };
      request.signal?.addEventListener('abort', cancel, { once: true });
      let primaryFailed=false;
      let reviewAccepted=false;
      try {
        stage='registration';
        const checkpoint = session.checkpoint();
        if (checkpoint.sessionPath === null) throw new Error('La sesión administrativa Pi no es durable');
        input.journal.registerContinuistaSession({ execution, sessionId: checkpoint.sessionId, sessionPath: checkpoint.sessionPath,
          profile: inferenceProfile });
        requireNotAborted(request.signal);
        stage='prompt';
        const terminal = await session.prompt({ text: sessionContext.promptText, scope });
        requireNotAborted(request.signal);
        stage='terminal';
        if (terminal.outcome !== 'completed' || terminal.candidateLeafId === null) {failureCode='pi-incomplete';throw new Error('El terminal del Continuista no está completado');}
        stage='review-tool';
        const localCandidate = staged.readCandidate();
        if (localCandidate === undefined) {failureCode='review-incomplete';throw new Error('El Continuista terminó sin entregar revisión mediante su herramienta');}
        stage='validation';failureCode='review-incomplete';
        const response = validateContinuistaContextReview({ context, response: localCandidate.response, allowIncomplete: true });
        failureCode='execution-failed';stage='eligibility';
        if (checkEligibility().kind !== 'active') {failureCode='job-inactive';throw new Error('El trabajo del Continuista cambió antes de aceptar su revisión');}
        stage='stage-review';
        const candidate = input.journal.stageContinuistaReview({ execution, response });
        if (!response.review.complete) {
          input.journal.failContinuistaJob({ execution, code: 'review-incomplete' });
          return response.review;
        }
        stage='acceptance';
        const accepted = input.journal.acceptContinuistaReview({ execution, candidateHash: candidate.candidateHash });
        const acceptedReview=validateContinuistaContextReview({ context, response: { contextHash: context.contextHash, review: accepted.receipt.review } }).review;
        reviewAccepted=true;
        return acceptedReview;
      } catch(error:unknown) {
        primaryFailed=true;throw error;
      } finally {
        request.signal?.removeEventListener('abort', cancel);
        try {await dispose();} catch(error:unknown) {
          // Cleanup cannot revoke a completed review already accepted by the journal.
          // Before acceptance it remains a failure; an earlier error keeps precedence.
          if(!primaryFailed&&!reviewAccepted){stage='disposal';throw error;}
          report(error,'disposal');
        }
      }
    } catch (error:unknown) {
      report(error,stage);
      try { input.journal.failContinuistaJob({ execution, code: request.signal?.aborted ? 'cancelled' : failureCode }); } catch { /* Preserve the original error if the claim became inactive or accepted. */ }
      throw error;
    }
  }
  return { review };
}

function checkpointPurpose(candidate: PiCheckpointCandidate, requireBinding: (identity: PiIdentity, scope: PiRequestScope) => void) {
  switch (candidate.purpose.kind) {
    case 'job-base': return { kind: 'job-base' } as const;
    case 'request-input':
      requireBinding(candidate.identity, candidate.purpose.request.scope);
      return { kind: 'request-input', requestSeq: candidate.purpose.request.requestSeq } as const;
    case 'terminal-candidate':
      if (candidate.purpose.lastRequest !== undefined) requireBinding(candidate.identity, candidate.purpose.lastRequest.scope);
      return { kind: 'terminal-candidate', outcome: candidate.purpose.outcome,
        lastRequestSeq: candidate.purpose.lastRequest?.requestSeq ?? null } as const;
    default: { const exhaustive: never = candidate.purpose; return exhaustive; }
  }
}
function requireNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('La revisión administrativa fue cancelada');
}
async function waitForPrevious(previous: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
  requireNotAborted(signal);
  if (signal === undefined) return previous;
  let cancel: () => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => { cancel = () => reject(new Error('La revisión administrativa fue cancelada antes de obtener su turno')); signal.addEventListener('abort', cancel, { once: true }); });
  try { await Promise.race([previous, cancelled]); requireNotAborted(signal); }
  finally { signal.removeEventListener('abort', cancel); }
}
