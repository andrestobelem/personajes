import { SelectableInferenceProfileSchema, resolveReadyInferenceProfile } from '../domain/inference-profile.ts';
import { ReadyRunConfigurationSchema } from './production-preflight.ts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { openJournal } from '../adapters/journal.ts';
import { createPiSession, type CreatePiSessionInput, type PiIdentity, type PiRequestPort, type PiRequestScope, type PiSessionHandle, type PiRuntime, type PiCheckpointCandidate } from '../adapters/pi.ts';
import { ActorJobExecutionSchema, type ContinuistaReviewInput } from '../domain/world-journal.ts';
import type { WorldIdSource } from '../domain/world.ts';
import type { ActorContinuistaPort } from './actor-turn-worker.ts';
import { assembleContinuistaReviewContext, buildContinuistaReviewPrompts, validateContinuistaContextReview } from './continuista-review-context.ts';
import { createContinuistaReviewTool } from './continuista-tools.ts';

type Journal = Pick<ReturnType<typeof openJournal>,
  'claimActorTurnJob' | 'readWorldConfiguration' | 'readActorJobProposal' | 'loadActorWorldCut'
  | 'compareAndSwapActorKnowledge' | 'loadActorPiSession' | 'readExperiences' | 'checkActorJobEligibility'
  | 'beginContinuistaJob' | 'registerContinuistaSession' | 'loadContinuistaSession'
  | 'checkContinuistaJobEligibility' | 'reserveContinuistaRequest' | 'transitionContinuistaRequest'
  | 'expireContinuistaRequest' | 'settleContinuistaRequestWallTime' | 'recordContinuistaCheckpoint' | 'stageContinuistaReview' | 'acceptContinuistaReview'
  | 'readContinuistaReceipt' | 'failContinuistaJob'>;

const queuesByJournal = new WeakMap<Journal, Map<string, Promise<void>>>();

/** Production Continuista port: a separate administrative Pi session, same run/pulse quotas. */
export function createContinuistaPiWorker(input: {
  journal: Journal; runtime: PiRuntime; ids: WorldIdSource; ownerToken: string;
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
    try {
      requireNotAborted(request.signal);
      if (!SelectableInferenceProfileSchema.safeParse(inferenceProfile).success) throw new Error('El perfil histórico retirado sólo permite recuperar resultados durables, sin inferencias nuevas');
      // No speculative reopening of a tentative session. Explicit retry creates a new child generation.
      if (input.journal.loadContinuistaSession({ jobId: execution.jobId, generation: execution.generation }) !== undefined) throw new Error('La sesión tentativa del Continuista necesita recuperación explícita');
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
      const session = await (input.sessionFactory ?? createPiSession)({ runtime: input.runtime, profile: inferenceProfile,
        runId: request.execution.runId, identity: { kind: 'admin', role: 'continuista' },
        systemPrompt: prompts.systemPrompt, checkpoint: { kind: 'fresh' }, preparedContextHash: context.contextHash,
        tools: [staged.tool], adminToolAllowlist: { continuista: ['submit_continuista_review'] }, requestPort: port });
      let disposal: Promise<void> | undefined;
      const dispose = () => { disposal ??= session.abortAndDispose(); return disposal; };
      const cancel = () => { void dispose().catch(() => undefined); };
      request.signal?.addEventListener('abort', cancel, { once: true });
      try {
        const checkpoint = session.checkpoint();
        if (checkpoint.sessionPath === null) throw new Error('La sesión administrativa Pi no es durable');
        input.journal.registerContinuistaSession({ execution, sessionId: checkpoint.sessionId, sessionPath: checkpoint.sessionPath,
          profile: inferenceProfile });
        requireNotAborted(request.signal);
        const terminal = await session.prompt({ text: prompts.text, scope });
        requireNotAborted(request.signal);
        if (terminal.outcome !== 'completed' || terminal.candidateLeafId === null) throw new Error('El terminal del Continuista no está completado');
        const localCandidate = staged.readCandidate();
        if (localCandidate === undefined) throw new Error('El Continuista terminó sin entregar revisión mediante su herramienta');
        const response = validateContinuistaContextReview({ context, response: localCandidate.response, allowIncomplete: true });
        if (checkEligibility().kind !== 'active') throw new Error('El trabajo del Continuista cambió antes de aceptar su revisión');
        const candidate = input.journal.stageContinuistaReview({ execution, response });
        if (!response.review.complete) {
          input.journal.failContinuistaJob({ execution, code: 'review-incomplete' });
          return response.review;
        }
        const accepted = input.journal.acceptContinuistaReview({ execution, candidateHash: candidate.candidateHash });
        return validateContinuistaContextReview({ context, response: { contextHash: context.contextHash, review: accepted.receipt.review } }).review;
      } finally {
        request.signal?.removeEventListener('abort', cancel);
        await dispose();
      }
    } catch (error) {
      try { input.journal.failContinuistaJob({ execution, code: request.signal?.aborted ? 'cancelled' : 'execution-failed' }); } catch { /* Preserve the original error if the claim became inactive or accepted. */ }
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
