import { z } from 'zod';
import type { openJournal } from '../adapters/journal.ts';
import type { PiCheckpointCandidate, PiIdentity, PiRequestPort, PiRequestScope } from '../adapters/pi.ts';
import { ActorJobExecutionSchema } from '../domain/world-journal.ts';

type Journal = Pick<ReturnType<typeof openJournal>,
  'checkActorJobEligibility' | 'reserveActorJobRequest' | 'transitionActorJobReservation'
  | 'recordActorJobCheckpoint' | 'recordActorPiCandidate' | 'expireActorJobRequest' | 'settleActorJobRequestWallTime'>;

const CandidateBindingSchema = z.object({
  actorId: ActorJobExecutionSchema.shape.actorId,
  runId: ActorJobExecutionSchema.shape.runId,
  scope: z.object({
    runId: ActorJobExecutionSchema.shape.runId,
    pulseId: ActorJobExecutionSchema.shape.pulseId,
    jobId: ActorJobExecutionSchema.shape.jobId,
    generation: ActorJobExecutionSchema.shape.generation,
  }),
  lease: ActorJobExecutionSchema.shape.lease,
});

/** One host-owned port per actor claim; model input cannot select identity or lease. */
export function createActorPiRequestPort(input: {
  execution: unknown; journal: Journal; signal?: AbortSignal;
}): PiRequestPort {
  const execution = ActorJobExecutionSchema.parse(input.execution);
  function requireBinding(identity: PiIdentity, scope: PiRequestScope): void {
    if (identity.kind !== 'actor' || identity.characterId !== execution.actorId
      || scope.runId !== execution.runId || scope.pulseId !== execution.pulseId
      || scope.jobId !== execution.jobId || scope.generation !== execution.generation) {
      throw new Error('El puerto Pi pertenece a otra identidad o ejecución actoral');
    }
  }
  function checkpointPurpose(candidate: PiCheckpointCandidate) {
    requireBinding(candidate.identity, candidate.purpose.baseScope);
    switch (candidate.purpose.kind) {
      case 'job-base': return { kind: 'job-base' } as const;
      case 'request-input':
        requireBinding(candidate.identity, candidate.purpose.request.scope);
        return { kind: 'request-input', requestSeq: candidate.purpose.request.requestSeq } as const;
      case 'terminal-candidate':
        if (candidate.purpose.lastRequest !== undefined) requireBinding(candidate.identity, candidate.purpose.lastRequest.scope);
        return {
          kind: 'terminal-candidate', outcome: candidate.purpose.outcome,
          lastRequestSeq: candidate.purpose.lastRequest?.requestSeq ?? null,
        } as const;
      default: { const exhaustive: never = candidate.purpose; return exhaustive; }
    }
  }
  return {
    checkEligibility({ purpose, scope }) {
      requireBinding(purpose, scope);
      if (input.signal?.aborted) return { kind: 'inactive', reason: 'cancelled' };
      return input.journal.checkActorJobEligibility(execution);
    },
    reserveNextRequest({ purpose, scope, clockEpochId }) {
      requireBinding(purpose, scope);
      if (input.signal?.aborted) throw new Error('La ejecución Pi fue cancelada antes de reservar');
      return input.journal.reserveActorJobRequest({ execution, ...(clockEpochId === undefined ? {} : { clockEpochId }) });
    },
    transitionReservation({ purpose, scope, requestSeq, target, wallTime }) {
      requireBinding(purpose, scope);
      if (target === 'dispatched' && input.signal?.aborted) throw new Error('La ejecución Pi fue cancelada antes de despachar');
      input.journal.transitionActorJobReservation({ execution, requestSeq, target, ...(wallTime === undefined ? {} : { wallTime }) });
    },
    expireReservation({ purpose, scope, requestSeq, clockEpochId, reason }) {
      requireBinding(purpose, scope);
      input.journal.expireActorJobRequest({ execution, requestSeq, clockEpochId, reason });
    },
    settleWallTime({ purpose, scope, requestSeq, clockEpochId, monotonicNs }) {
      requireBinding(purpose, scope);
      input.journal.settleActorJobRequestWallTime({ execution, requestSeq, clockEpochId, monotonicNs });
    },
    recordCheckpointCandidate(candidate) {
      input.journal.recordActorJobCheckpoint({ execution, purpose: checkpointPurpose(candidate), snapshot: candidate.snapshot });
    },
    recordActorPiCandidate(rawCandidate) {
      const binding = CandidateBindingSchema.parse(rawCandidate);
      requireBinding({ kind: 'actor', characterId: binding.actorId }, binding.scope);
      if (binding.runId !== execution.runId || binding.lease.ownerToken !== execution.lease.ownerToken
        || binding.lease.claimToken !== execution.lease.claimToken) throw new Error('El candidato Pi no pertenece al claim del puerto');
      return input.journal.recordActorPiCandidate(rawCandidate);
    },
  };
}
