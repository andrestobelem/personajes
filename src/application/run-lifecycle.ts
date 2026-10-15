import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { openJournal } from '../adapters/journal.ts';
import {
  RunBudgetViewSchema, RunControlApplicationResultSchema, RunLimitsSchema, RunViewConfigurationSchema,
  RunViewSchema,
} from '../domain/http.ts';
import { WorldSnapshotSchema } from '../domain/world-schema.ts';
import { RunModelTimeBudgetSchema } from '../domain/model-time-budget.ts';
import { RunLifecycleControlRequestSchema } from '../domain/run-lifecycle.ts';
import { ReadyRunConfigurationSchema } from './production-preflight.ts';
import {
  DramaticStructureViewSchema, RunLifecycleCommandLookupResultSchema, RunLifecycleCommandResultSchema,
} from '../domain/world-journal.ts';
import { JobIdSchema, RunIdSchema } from '../domain/values.ts';
import { RunPreflightJobDocumentSchema } from '../domain/run-preflight-jobs.ts';

type Journal = Pick<ReturnType<typeof openJournal>, 'readWorldLifecycle' | 'readWorldConfiguration' | 'loadWorld'
  | 'readRunModelTimeBudget' | 'readRunLifecycleCommand' | 'applyRunLifecycleCommand' | 'readRunStepJob' | 'readDramaticStructure'>;
type PreflightReader = { readJob(input: { runId: string; jobId: string }): unknown | Promise<unknown> };
type Runtime = {
  scheduleRun(input: unknown): Promise<boolean>;
  cancelRun(input: unknown): Promise<boolean>;
  readonly isClosed?: boolean;
};

const ControlInputSchema = z.strictObject({
  principalId: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().uuid(),
  runId: RunIdSchema,
  expectedConfigurationRevision: z.number().int().nonnegative(),
  expectedWorldRevision: z.number().int().nonnegative(),
  expectedStructureRevision: z.number().int().nonnegative(),
  expectedLifecycleRevision: z.number().int().nonnegative(),
  command: RunLifecycleControlRequestSchema,
});

/** Composes durable lifecycle CAS with the already-built run runtime. */
export function createRunLifecycleApplication(input: {
  journal: Journal;
  preflights?: PreflightReader;
  runtime?: Runtime;
  readVoiceBudget?: (runId: string) => unknown;
}) {
  function readRunView(rawRunId: string) {
    const runId = RunIdSchema.parse(rawRunId);
    const stateValue = input.journal.readWorldLifecycle({ runId });
    if (stateValue === undefined) return undefined;
    const state = z.object({
      runId: RunIdSchema,
      lifecycle: z.enum(['draft', 'ready', 'running', 'paused', 'stopped', 'closed']),
      lifecycleRevision: z.number().int().nonnegative(),
      configRevision: z.number().int().nonnegative(),
      worldRevision: z.number().int().nonnegative(),
      lastWorldSeq: z.number().int().nonnegative(),
      createdAt: z.number().int().nonnegative().nullable(),
      updatedAt: z.number().int().nonnegative(),
      closedAt: z.string().datetime({ offset: true }).nullable(),
    }).parse(stateValue);
    const rawConfiguration = input.journal.readWorldConfiguration({ runId });
    const rawSnapshot = input.journal.loadWorld({ runId });
    const rawStructure = input.journal.readDramaticStructure({ runId });
    const rawBudget = input.journal.readRunModelTimeBudget({ runId });
    if (rawConfiguration === undefined || rawSnapshot === undefined || rawStructure === undefined || rawBudget === undefined) return undefined;

    const storedConfiguration = ReadyRunConfigurationSchema.parse(rawConfiguration);
    const snapshot = WorldSnapshotSchema.parse(rawSnapshot);
    const structure = DramaticStructureViewSchema.parse(rawStructure);
    const modelBudget = RunModelTimeBudgetSchema.parse(rawBudget);
    // Project only operator-facing fields. The verified ready configuration also
    // carries host-only snapshot, actor-context and availability fences.
    const configuration = RunViewConfigurationSchema.parse({
      runId: storedConfiguration.runId,
      configRevision: storedConfiguration.configRevision,
      name: storedConfiguration.name,
      fictionalAt: snapshot.clock.instant,
      continuity: {continuityId:storedConfiguration.continuity.continuityId,revision:storedConfiguration.continuity.revision},
      roster: {activeCharacterCount:storedConfiguration.roster.activeCharacterIds.length},
      humanParticipantCount: storedConfiguration.humanParticipants.length,
      language: storedConfiguration.language,
      spanishVariety: storedConfiguration.spanishVariety,
      narrationMode: storedConfiguration.narrationMode,
      ...(storedConfiguration.inferenceProfile === undefined ? {} : { inferenceProfile: storedConfiguration.inferenceProfile }),
      budget: storedConfiguration.budget,
      maxReformulations: storedConfiguration.maxReformulations,
      audio: {mode:storedConfiguration.audio.mode},
    });
    const reservedCalls = Math.min(modelBudget.reservedPiCalls, modelBudget.runCallsUsed);
    const callRemaining = Math.max(0, modelBudget.maxPiCallsPerRun - modelBudget.runCallsUsed);
    const wallTimeMeasured = modelBudget.wallTimeMeasuredMs;
    const wallTimeRemaining = modelBudget.wallTimeRemainingMs;
    const budgetStatus = modelBudget.status === 'legacy-unknown' ? 'unknown'
      : modelBudget.status === 'uncertain' ? 'uncertain'
        : callRemaining === 0 || wallTimeRemaining === 0 ? 'exhausted' : 'available';
    const counters = (limit: number, used: number, reserved = 0) => ({
      limit, used, reserved, remaining: Math.max(0, limit - used - reserved),
    });
    const voiceBudgetSchema=z.strictObject({voiceDesignCalls:RunBudgetViewSchema.shape.voiceDesignCalls,ttsCalls:RunBudgetViewSchema.shape.ttsCalls,sfxCalls:RunBudgetViewSchema.shape.sfxCalls});
    let voiceBudget: z.infer<typeof voiceBudgetSchema> | undefined;
    if(input.readVoiceBudget!==undefined) {
      try {voiceBudget=voiceBudgetSchema.parse(input.readVoiceBudget(runId));}
      catch { /* Audio availability must not prevent pausing a model request. */ }
    }
    const budget = RunBudgetViewSchema.parse({
      modelCalls: counters(modelBudget.maxPiCallsPerRun, modelBudget.runCallsUsed - reservedCalls, reservedCalls),
      modelWallTimeMs: {
        limit: modelBudget.maxWallTimeMs,
        measured: wallTimeMeasured,
        reserved: modelBudget.wallTimeReservedMs,
        remaining: wallTimeRemaining,
      },
      voiceDesignCalls: voiceBudget?.voiceDesignCalls ?? counters(0, 0),
      ttsCalls: voiceBudget?.ttsCalls ?? counters(0, 0),
      sfxCalls: voiceBudget?.sfxCalls ?? counters(0, 0),
      ...(input.readVoiceBudget===undefined?{}:{audioBudgetStatus:voiceBudget===undefined?'unavailable':'known'}),
      status: budgetStatus,
    });
    const lifecycle = state.lifecycle === 'closed'
      ? { kind: 'closed' as const, closedAt: state.closedAt ?? new Date(state.updatedAt).toISOString() }
      : { kind: state.lifecycle };
    const limits = RunLimitsSchema.parse({
      maxModelCallsPerRun: modelBudget.maxPiCallsPerRun,
      maxModelCallsPerPulse: modelBudget.maxPiCallsPerPulse,
      maxConcurrentCalls: modelBudget.maxConcurrentPiRequests,
      requestTimeoutMs: modelBudget.requestTimeoutMs,
      maxModelWallTimeMsPerRun: modelBudget.maxWallTimeMs,
      maxTtsCallsPerRun: Math.min(10_000,voiceBudget?.ttsCalls.limit ?? 0),
      maxDesignCallsPerRun: Math.min(10_000,voiceBudget?.voiceDesignCalls.limit ?? 0),
      maxSfxCallsPerRun: Math.min(10_000,voiceBudget?.sfxCalls.limit ?? 0),
      maxReformulations: configuration.maxReformulations,
    });
    return RunViewSchema.parse({
      runId,
      configRevision: state.configRevision,
      worldRevision: snapshot.revision,
      structureRevision: structure.structureRevision,
      activeEpisodeId: structure.activeEpisodeId,
      activeSceneId: structure.activeSceneId,
      lifecycleRevision: state.lifecycleRevision,
      lastWorldSeq: snapshot.seq,
      lifecycle,
      config: configuration,
      clock: snapshot.clock,
      limits,
      budget,
      createdAt: state.createdAt === null ? null : new Date(state.createdAt).toISOString(),
      updatedAt: new Date(state.updatedAt).toISOString(),
    });
  }

  function mapJournalResult(result: z.infer<typeof RunLifecycleCommandResultSchema>, replayed: boolean, runId: string) {
    switch (result.kind) {
      case 'accepted': {
        const run = readRunView(result.state.runId);
        const job = input.journal.readRunStepJob({runId:result.state.runId,jobId:result.job.jobId}) ?? result.job;
        return run === undefined ? RunControlApplicationResultSchema.parse({kind:'missing'})
          : RunControlApplicationResultSchema.parse({kind:'accepted',run,job:{jobId:job.jobId,revision:job.revision,state:job.state},replayed});
      }
      case 'updated':
      case 'existing': {
        const run = readRunView(result.state.runId);
        return run === undefined
          ? RunControlApplicationResultSchema.parse({ kind: 'missing' })
          : RunControlApplicationResultSchema.parse({ kind: 'updated', run, replayed: replayed || result.kind === 'existing' });
      }
      case 'stale': {
        const current = readRunView(result.state.runId);
        return current === undefined ? RunControlApplicationResultSchema.parse({ kind: 'missing' })
          : RunControlApplicationResultSchema.parse({ kind: 'stale', current });
      }
      case 'missing': return RunControlApplicationResultSchema.parse({ kind: 'missing' });
      case 'invalidLifecycle': return RunControlApplicationResultSchema.parse(result);
      case 'budgetExhausted': return RunControlApplicationResultSchema.parse({kind:'budgetExhausted'});
      case 'preflightRequired': return RunControlApplicationResultSchema.parse({ kind: 'preflightRequired' });
      case 'preflightBlocked': return RunControlApplicationResultSchema.parse({ kind: 'preflightBlocked' });
      case 'preflightStale': {
        const current = readRunView(runId);
        return current === undefined ? RunControlApplicationResultSchema.parse({ kind: 'missing' })
          : RunControlApplicationResultSchema.parse({ kind: 'preflightStale', current });
      }
      case 'idempotencyConflict': return RunControlApplicationResultSchema.parse(result);
      default: { const exhaustive: never = result; throw new Error(String(exhaustive)); }
    }
  }

  async function currentPreflight(runId: string, jobId: string): Promise<'passed' | 'blocked' | 'stale'> {
    if (input.preflights === undefined) return 'blocked';
    const value = await input.preflights.readJob({ runId, jobId });
    const parsed = RunPreflightJobDocumentSchema.safeParse(value);
    if (!parsed.success) return 'blocked';
    const document = parsed.data;
    if (document.job.runId !== runId || document.job.jobId !== jobId) return 'blocked';
    if (document.report.kind === 'stale') return 'stale';
    return document.job.state === 'completed' && document.job.resultKind === 'passed'
      && document.report.result?.kind === 'passed' ? 'passed' : 'blocked';
  }

  async function controlRun(rawInput: unknown) {
    const request = ControlInputSchema.parse(rawInput);

    const journalCommand = request.command.kind === 'start' || request.command.kind === 'resume' || request.command.kind === 'step'
      ? { kind: request.command.kind }
      : request.command;
    const preflightJobId = request.command.kind === 'start' || request.command.kind === 'resume' || request.command.kind === 'step'
      ? JobIdSchema.parse(request.command.preflightJobId) : undefined;
    const lookupInput = {
      principalId: request.principalId,
      idempotencyKey: request.idempotencyKey,
      runId: request.runId,
      command: journalCommand,
      ...(preflightJobId === undefined ? {} : { preflightJobId }),
    };
    const lookup = RunLifecycleCommandLookupResultSchema.parse(input.journal.readRunLifecycleCommand(lookupInput));
    if (lookup.kind === 'idempotencyConflict') return RunControlApplicationResultSchema.parse({ kind: 'idempotencyConflict' });
    if (lookup.kind === 'found') return mapJournalResult(lookup.result, true, request.runId);

    if (request.command.kind === 'start' || request.command.kind === 'resume' || request.command.kind === 'step') {
      if (input.runtime === undefined || input.runtime.isClosed === true) {
        return RunControlApplicationResultSchema.parse({ kind: 'runtimeUnavailable' });
      }
      const gate = await currentPreflight(request.runId, preflightJobId!);
      if (gate !== 'passed') {
        const current = readRunView(request.runId);
        if (current === undefined) return RunControlApplicationResultSchema.parse({ kind: 'missing' });
        return gate === 'stale'
          ? RunControlApplicationResultSchema.parse({ kind: 'preflightStale', current })
          : RunControlApplicationResultSchema.parse({ kind: 'preflightBlocked' });
      }
      const current = readRunView(request.runId);
      if (current?.budget.status === 'exhausted' || current?.budget.status === 'uncertain' || current?.budget.status === 'unknown') {
        return RunControlApplicationResultSchema.parse({ kind: 'budgetExhausted' });
      }
    }

    const commandResult = RunLifecycleCommandResultSchema.parse(input.journal.applyRunLifecycleCommand({
      principalId: request.principalId,
      idempotencyKey: request.idempotencyKey,
      runId: request.runId,
      expectedLifecycleRevision: request.expectedLifecycleRevision,
      expectedConfigRevision: request.expectedConfigurationRevision,
      expectedWorldRevision: request.expectedWorldRevision,
      expectedStructureRevision: request.expectedStructureRevision,
      command: journalCommand,
      ...(preflightJobId === undefined ? {} : { preflightJobId }),
    }));
    const result = mapJournalResult(commandResult, false, request.runId);
    if ((result.kind !== 'updated' && result.kind !== 'accepted') || (commandResult.kind !== 'updated' && commandResult.kind !== 'accepted')) return result;

    try {
      if (request.command.kind === 'start' || request.command.kind === 'resume' || request.command.kind === 'step') {
        const scheduled = await input.runtime!.scheduleRun({ runId: request.runId });
        if (!scheduled) throw new Error('Runtime refused the durable schedule request.');
      } else if (request.command.kind === 'pause' || request.command.kind === 'stop' || request.command.kind === 'close') {
        await input.runtime?.cancelRun({ runId: request.runId });
      }
    } catch {
      if (request.command.kind === 'start' || request.command.kind === 'resume' || request.command.kind === 'step') {
        await input.runtime?.cancelRun({ runId: request.runId }).catch(() => false);
        const paused = RunLifecycleCommandResultSchema.safeParse(input.journal.applyRunLifecycleCommand({
          principalId: request.principalId,
          idempotencyKey: deriveCompensationKey(request.idempotencyKey),
          runId: request.runId,
          expectedLifecycleRevision: result.run.lifecycleRevision,
          expectedConfigRevision: result.run.configRevision,
          expectedWorldRevision: result.run.worldRevision,
          command: { kind: 'pause' },
        }));
        if (paused.success && paused.data.kind === 'updated') {
          const current = readRunView(request.runId);
          if (current !== undefined) return RunControlApplicationResultSchema.parse({ kind: 'runtimeUnavailable', current });
        }
      }
      const current = readRunView(request.runId);
      return current === undefined
        ? RunControlApplicationResultSchema.parse({ kind: 'missing' })
        : RunControlApplicationResultSchema.parse({ kind: 'runtimeUnavailable', current });
    }
    return result;
  }

  return Object.freeze({ readStepJob: (request: {runId:string;jobId:string}) => input.journal.readRunStepJob(request), readRunView: ({ runId }: { runId: string }) => readRunView(runId), controlRun });
}

function deriveCompensationKey(idempotencyKey: string): string {
  const bytes = createHash('sha256').update(`run-control-compensation:${idempotencyKey}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
