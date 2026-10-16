import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { openJournal } from '../adapters/journal.ts';
import { ActorTurnJobClaimSchema, ActorTurnJobViewSchema, CoordinatorPulseBeginResultSchema } from '../domain/world-journal.ts';
import { RunIdSchema } from '../domain/values.ts';
import type { ActorTurnWorkerResult } from './actor-turn-worker.ts';

const ScheduleSchema = z.strictObject({ runId: RunIdSchema });
const OwnerTokenSchema = z.string().uuid();
const MAX_JOBS_PER_BATCH = 16;
const MAX_PULSES_PER_BATCH = 4;

type Journal = Pick<ReturnType<typeof openJournal>,
  'beginCoordinatorPulse' | 'readCoordinatorPulse' | 'closeCoordinatorPulse'
  | 'listCoordinatorPulseTargets' | 'listActorTurnJobsForPulse'>;
type Job = z.infer<typeof ActorTurnJobViewSchema>;
type RunId = z.infer<typeof RunIdSchema>;
type PulseId = Job['pulseId'];
type ActiveRun = {
  wakeVersion: number;
  controller: AbortController;
  task: Promise<void> | undefined;
  rescheduleAfterCancel: boolean;
};
type ActorWorker = {
  run(claim: unknown, options: { signal?: AbortSignal }): Promise<ActorTurnWorkerResult>;
};
type SupervisorFailure =
  | { kind: 'worker'; runId: RunId; pulseId: PulseId; job: Job; error: unknown }
  | { kind: 'journal'; runId: RunId; error: unknown }
  | { kind: 'supervisor'; runId: RunId; error: unknown };

/**
 * Dispatches only durable causes admitted by the journal. The host must acquire
 * exclusive ownership and recover abandoned actor claims before constructing it.
 */
export function createCoordinatorPulseSupervisor(input: {
  journal: Journal;
  ownerToken: string;
  actorWorker: ActorWorker;
  beginPulse?: (target: {runId: RunId}, signal: AbortSignal) => Promise<z.infer<typeof CoordinatorPulseBeginResultSchema>>;
  onOutcome?: (outcome: {
    runId: RunId;
    pulseId: Job['pulseId'];
    job: Job;
    result: ActorTurnWorkerResult;
  }) => void;
  onFailure?: (failure: SupervisorFailure) => void;
  beforeClosePulse?: (pulse: {runId: RunId; pulseId: PulseId}, signal: AbortSignal) => Promise<boolean>;
  onPulseClosed?: (pulse: {runId: RunId; pulseId: PulseId}) => Promise<void>;
  /** Delay before re-reading a run that keeps waking while its pulse cannot advance. */
  suspendedWakeDelayMs?: (consecutive: number) => number;
}) {
  const suspendedWakeDelayMs = input.suspendedWakeDelayMs ?? ((consecutive: number) => Math.min(2_000, 250 * 2 ** Math.max(0, consecutive - 2)));
  const ownerToken = OwnerTokenSchema.parse(input.ownerToken);
  const active = new Map<RunId, ActiveRun>();
  const suspendedRuns = new Set<RunId>();
  let closed = false;

  function schedule(rawInput: unknown): void {
    if (closed) return;
    const request = ScheduleSchema.parse(rawInput);
    if (suspendedRuns.has(request.runId)) return;
    const existing = active.get(request.runId);
    if (existing !== undefined) {
      if (existing.controller.signal.aborted) existing.rescheduleAfterCancel = true;
      else existing.wakeVersion += 1;
      return;
    }
    const state: ActiveRun = { wakeVersion: 1, controller: new AbortController(), task: undefined, rescheduleAfterCancel: false };
    active.set(request.runId, state);
    state.task = (async () => {
      let consecutiveSuspended = 0;
      while (!closed && !state.controller.signal.aborted) {
        const wakeVersion = state.wakeVersion;
        let outcome: 'quiescent' | 'suspended';
        try { outcome = await drainRun(request.runId, state.controller.signal); }
        catch (error) {
          reportFailure({ kind: 'journal', runId: request.runId, error });
          return;
        }
        if (closed || state.controller.signal.aborted || state.wakeVersion === wakeVersion) return;
        // A wake received while a worker was running gets one fresh durable read.
        // A pulse that cannot advance (e.g. waiting on a blocked actor's retry) may
        // keep being woken by its own director/delivery work: back off with a real
        // timer so the host keeps serving requests instead of spinning.
        if (outcome === 'suspended') {
          consecutiveSuspended += 1;
          if (consecutiveSuspended >= 2) await abortableDelay(suspendedWakeDelayMs(consecutiveSuspended), state.controller.signal);
          continue;
        }
        consecutiveSuspended = 0;
      }
    })().catch((error: unknown) => {
      reportFailure({ kind: 'supervisor', runId: request.runId, error });
    }).finally(() => {
      if (active.get(request.runId) === state) active.delete(request.runId);
      if (!closed && state.rescheduleAfterCancel) schedule({ runId: request.runId });
    });
  }

  function reportFailure(failure: SupervisorFailure): void {
    try { input.onFailure?.(failure); }
    catch { /* Diagnostics cannot change durable coordination state. */ }
  }

  async function drainRun(runId: RunId, signal: AbortSignal): Promise<'quiescent' | 'suspended'> {
    let pulsesSinceYield = 0;
    while (!closed && !signal.aborted) {
      const begin = input.beginPulse === undefined
        ? input.journal.beginCoordinatorPulse({ runId })
        : await input.beginPulse({ runId }, signal);
      if (begin.kind === 'inactive' || begin.kind === 'idle') return 'quiescent';
      if (begin.pulse.state !== 'running') {
        await input.onPulseClosed?.({runId,pulseId:begin.pulse.pulseId});
        return 'suspended';
      }

      const drained = await drainPulse({ runId, pulseId: begin.pulse.pulseId }, signal);
      if (drained === 'suspended') return 'suspended';
      await input.onPulseClosed?.({runId,pulseId:begin.pulse.pulseId});
      pulsesSinceYield += 1;
      if (pulsesSinceYield >= MAX_PULSES_PER_BATCH) {
        pulsesSinceYield = 0;
        await yieldToHost();
      }
    }
    return 'suspended';
  }

  async function drainPulse(inputPulse: { runId: RunId; pulseId: Job['pulseId'] }, signal: AbortSignal): Promise<'terminal' | 'suspended'> {
    let jobsSinceYield = 0;
    const processed = new Set<string>();
    while (!closed && !signal.aborted) {
      const jobs = input.journal.listActorTurnJobsForPulse(inputPulse);
      const next = jobs.find((job) => (job.state === 'queued' || job.state === 'accepted') && !processed.has(jobKey(job)));
      if (next === undefined) {
        if (jobs.some((job) => job.state === 'running')) return 'suspended';
        if (input.beforeClosePulse !== undefined && !await input.beforeClosePulse(inputPulse,signal)) return 'suspended';
        if (closed || signal.aborted) return 'suspended';
        const pulse = input.journal.closeCoordinatorPulse(inputPulse);
        return pulse.state === 'running' ? 'suspended' : 'terminal';
      }

      if (jobsSinceYield >= MAX_JOBS_PER_BATCH) {
        jobsSinceYield = 0;
        await yieldToHost();
        continue;
      }
      jobsSinceYield += 1;

      const claim = ActorTurnJobClaimSchema.parse({
        runId: next.runId,
        actorId: next.actorId,
        jobId: next.jobId,
        generation: next.generation,
        ownerToken,
        claimToken: randomUUID(),
      });
      let result: ActorTurnWorkerResult;
      try {
        result = await input.actorWorker.run(claim, { signal });
      } catch (error) {
        // The actor worker records terminal failures itself. Continue only when
        // that durable transition is visible; otherwise preserve the lease/state.
        const current = input.journal.listActorTurnJobsForPulse(inputPulse)
          .find((job) => sameJob(job, next));
        reportFailure({ kind: 'worker', runId: inputPulse.runId, pulseId: inputPulse.pulseId, job: next, error });
        if (current?.state === 'blocked') { processed.add(jobKey(next)); continue; }
        return 'suspended';
      }

      try {
        input.onOutcome?.({ runId: inputPulse.runId, pulseId: inputPulse.pulseId, job: next, result });
      } catch { /* Observers cannot change actor or pulse state. */ }

      switch (result.kind) {
        case 'committed':
        case 'recovered':
        case 'blocked':
          processed.add(jobKey(next));
          continue;
        case 'unclaimed': {
          if (result.reason === 'blocked' || result.reason === 'accepted') {
            processed.add(jobKey(next));
            continue;
          }
          return 'suspended';
        }
        default: {
          const exhaustive: never = result;
          return exhaustive;
        }
      }
    }
    return 'suspended';
  }

  function recover(): number {
    if (closed) return 0;
    const targets = input.journal.listCoordinatorPulseTargets({ limit: 1_000 });
    for (const target of targets) schedule({ runId: target.runId });
    return targets.length;
  }

  async function waitForIdle(): Promise<void> {
    while (active.size > 0) {
      const tasks = [...active.values()].flatMap((state) => state.task === undefined ? [] : [state.task]);
      if (tasks.length === 0) return;
      await Promise.all(tasks);
    }
  }

  async function cancelRun(rawInput: unknown): Promise<boolean> {
    const { runId } = ScheduleSchema.parse(rawInput);
    const state = active.get(runId);
    if (state === undefined) return false;
    state.controller.abort();
    await state.task;
    return true;
  }

  async function suspendRunAdmissions(rawInput: unknown): Promise<() => void> {
    const { runId } = ScheduleSchema.parse(rawInput);
    if (closed || suspendedRuns.has(runId)) throw new Error('COORDINATOR_RUN_BUSY');
    suspendedRuns.add(runId);
    const state = active.get(runId);
    if (state !== undefined) state.rescheduleAfterCancel = false;
    try { await cancelRun({ runId }); }
    catch (error) { suspendedRuns.delete(runId); throw error; }
    let released = false;
    return () => { if (released) return; released = true; suspendedRuns.delete(runId); };
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    for (const state of active.values()) state.controller.abort();
    await Promise.all([...active.values()].flatMap((state) => state.task === undefined ? [] : [state.task]));
  }

  return Object.freeze({ schedule, recover, cancelRun, suspendRunAdmissions, waitForIdle, close });
}

function sameJob(left: Job, right: Job): boolean {
  return left.runId === right.runId && left.actorId === right.actorId
    && left.jobId === right.jobId && left.generation === right.generation;
}

function jobKey(job: Job): string {
  return JSON.stringify([job.runId, job.actorId, job.jobId, job.generation]);
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', done); resolve(); }, ms);
    const done = () => { clearTimeout(timer); resolve(); };
    signal.addEventListener('abort', done, { once: true });
  });
}
