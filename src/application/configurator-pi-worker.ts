import { randomUUID } from 'node:crypto';
import type { openJournal } from '../adapters/journal.ts';
import type { openConfiguratorJobLedger } from '../adapters/configurator-job-ledger.ts';
import { createPiSession, type PiRuntime, type PiSessionHandle, type CreatePiSessionInput, type PiRequestPort,
  type PiIdentity, type PiRequestScope, type PiCheckpointCandidate } from '../adapters/pi.ts';
import { ConfiguratorJobViewSchema, ConfiguratorJobExecutionSchema } from '../domain/configurator-jobs.ts';
import { JobIdSchema, PulseIdSchema } from '../domain/values.ts';
import { ReadyRunConfigurationSchema } from './production-preflight.ts';
import { CONFIGURATOR_SYSTEM_PROMPT } from './configurator-context.ts';
import { canonicalDirectorValue } from './director-context.ts';
import { createConfiguratorProposalTool } from './configurator-tools.ts';

type Ledger = ReturnType<typeof openConfiguratorJobLedger>;
type Journal = Pick<ReturnType<typeof openJournal>, 'readWorldConfiguration' | 'configureRun' | 'configurePulse'
  | 'reserveNextRequest' | 'transitionReservation' | 'expireBudgetRequest' | 'settleBudgetRequestWallTime'>;

/** One administrative Pi session per explicit job generation. It may only propose;
 * neither the tool, final prose nor successful completion authorizes promotion.
 */
export function createConfiguratorPiWorker(input: { ledger: Ledger; journal: Journal; runtime: PiRuntime;
  sessionFactory?: (input: CreatePiSessionInput) => Promise<PiSessionHandle> }) {
  async function run(raw: unknown, options: { signal?: AbortSignal } = {}) {
    const initial = ConfiguratorJobViewSchema.parse(raw);
    const claimed = input.ledger.claim({ jobId: initial.jobId, principalId: initial.principalId,
      expectedRevision: initial.revision, claimToken: randomUUID() });
    const execution = ConfiguratorJobExecutionSchema.parse(claimed.execution);
    const scope: PiRequestScope = { runId: initial.runId, pulseId: PulseIdSchema.parse(initial.jobId), jobId: JobIdSchema.parse(initial.jobId), generation: initial.generation };
    let session: PiSessionHandle | undefined;
    let disposal: Promise<void> | undefined;
    const dispose = () => { if (session === undefined) return Promise.resolve(); disposal ??= session.abortAndDispose(); return disposal; };
    const cancel = () => { void dispose().catch(() => undefined); };
    function activeSignal() { if (options.signal?.aborted) throw new Error('CONFIGURATOR_CANCELLED'); }
    function binding(identity: PiIdentity, actual: PiRequestScope) {
      if (identity.kind !== 'admin' || identity.role !== 'configurador' || actual.runId !== scope.runId
        || actual.pulseId !== scope.pulseId || actual.jobId !== scope.jobId || actual.generation !== scope.generation)
        throw new Error('CONFIGURATOR_REQUEST_SCOPE');
    }
    const eligibility = () => options.signal?.aborted
      ? { kind: 'inactive', reason: 'cancelled' } satisfies { kind: 'inactive'; reason: string }
      : input.ledger.eligibility(execution);
    const requestPort: PiRequestPort = {
      checkEligibility({ purpose, scope }) { binding(purpose, scope); return eligibility(); },
      reserveNextRequest({ purpose, scope, clockEpochId }) {
        binding(purpose, scope); activeSignal();
        if (clockEpochId === undefined || eligibility().kind !== 'active') throw new Error('CONFIGURATOR_INACTIVE');
        return input.journal.reserveNextRequest({ runId: scope.runId, pulseId: scope.pulseId, jobId: scope.jobId,
          generation: scope.generation, clockEpochId, ownerToken: execution.lease.ownerToken });
      },
      transitionReservation({ purpose, scope, requestSeq, target, wallTime }) {
        binding(purpose, scope);
        if (target === 'dispatched') { activeSignal(); input.ledger.requireDispatch({ execution, requestSeq }); }
        input.journal.transitionReservation({ jobId: scope.jobId, generation: scope.generation, requestSeq, target,
          ownerToken: execution.lease.ownerToken, ...(wallTime === undefined ? {} : { wallTime }) });
      },
      expireReservation({ purpose, scope, requestSeq, clockEpochId, reason }) {
        binding(purpose, scope); input.journal.expireBudgetRequest({ jobId: scope.jobId, generation: scope.generation,
          requestSeq, ownerToken: execution.lease.ownerToken, clockEpochId, reason });
      },
      settleWallTime({ purpose, scope, requestSeq, clockEpochId, monotonicNs }) {
        binding(purpose, scope); input.journal.settleBudgetRequestWallTime({ jobId: scope.jobId, generation: scope.generation,
          requestSeq, ownerToken: execution.lease.ownerToken, clockEpochId, monotonicNs });
      },
      recordCheckpointCandidate(candidate) {
        binding(candidate.identity, candidate.purpose.baseScope);
        input.ledger.recordCheckpoint({ execution, purpose: checkpointPurpose(candidate, binding), snapshot: candidate.snapshot });
      },
    };
    try {
      activeSignal();
      const configuration = ReadyRunConfigurationSchema.parse(input.journal.readWorldConfiguration({ runId: initial.runId }));
      // This is a technical quota cohort only. No coordinator pulse, episode,
      // event, perception or character turn is created for an administrative job.
      input.journal.configureRun({ runId: initial.runId, maxCalls: configuration.budget.maxPiCallsPerRun ?? 0 });
      input.journal.configurePulse({ runId: initial.runId, pulseId: initial.jobId, maxCalls: configuration.budget.maxPiCallsPerPulse ?? 0 });

      const tool = createConfiguratorProposalTool({ context: claimed.context, checkEligibility: eligibility,
        ...(options.signal === undefined ? {} : { signal: options.signal }) });
      session = await (input.sessionFactory ?? createPiSession)({ runtime: input.runtime, profile: execution.scope.profile,
        runId: initial.runId, identity: { kind: 'admin', role: 'configurador' }, preparedContextHash: execution.contextHash,
        checkpoint: { kind: 'fresh' }, systemPrompt: CONFIGURATOR_SYSTEM_PROMPT,
        tools: [tool.tool], adminToolAllowlist: { configurador: ['submit_configurator_proposal'] }, requestPort });
      options.signal?.addEventListener('abort', cancel, { once: true });
      const checkpoint = session.checkpoint();
      if (checkpoint.sessionPath === null) throw new Error('CONFIGURATOR_SESSION_MISSING');
      input.ledger.registerSession({ execution, sessionId: checkpoint.sessionId, sessionPath: checkpoint.sessionPath,
        baseLeafId: checkpoint.candidateLeafId, profile: execution.scope.profile });
      activeSignal();
      const terminal = await session.prompt({ text: canonicalDirectorValue(claimed.context), scope });
      activeSignal();
      if (terminal.outcome !== 'completed' || terminal.candidateLeafId === null) throw new Error('CONFIGURATOR_TERMINAL_INCOMPLETE');
      const candidate = tool.readCandidate();
      if (candidate === undefined) throw new Error('CONFIGURATOR_PROPOSAL_MISSING');
      const staged = input.ledger.stageProposal({ execution, candidateId: candidate.candidateId, proposal: candidate.proposal });
      return input.ledger.acceptProposal({ execution, candidateHash: staged.candidateHash });
    } catch (error) {
      const code = options.signal?.aborted ? 'CONFIGURATOR_CANCELLED'
        : error instanceof Error && /^CONFIGURATOR_[A-Z_]+$/.test(error.message) ? error.message : 'CONFIGURATOR_EXECUTION_FAILED';
      return input.ledger.fail({ execution, code });
    } finally {
      options.signal?.removeEventListener('abort', cancel);
      await dispose();
    }
  }
  return Object.freeze({ run });
}

function checkpointPurpose(candidate: PiCheckpointCandidate, binding: (identity: PiIdentity, scope: PiRequestScope) => void) {
  switch (candidate.purpose.kind) {
    case 'job-base': return { kind: 'job-base' } satisfies { kind: 'job-base' };
    case 'request-input': binding(candidate.identity, candidate.purpose.request.scope);
      return { kind: 'request-input', requestSeq: candidate.purpose.request.requestSeq } satisfies { kind: 'request-input'; requestSeq: number };
    case 'terminal-candidate': if (candidate.purpose.lastRequest !== undefined) binding(candidate.identity, candidate.purpose.lastRequest.scope);
      return { kind: 'terminal-candidate', outcome: candidate.purpose.outcome, lastRequestSeq: candidate.purpose.lastRequest?.requestSeq ?? null };
    default: { const exhaustive: never = candidate.purpose; return exhaustive; }
  }
}
