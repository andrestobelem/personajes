import { z } from 'zod';
import { openJournal } from '../adapters/journal.ts';
import { CharacterIdSchema, RunIdSchema } from '../domain/values.ts';
import { createDeliverWorldWorker } from './deliver-world.ts';
import type { WorldDeliveryDrainResult } from './deliver-world.ts';

const ScheduleSchema = z.strictObject({
  runId: RunIdSchema,
  actorIds: z.array(CharacterIdSchema).min(1).max(1_000),
}).superRefine((request, context) => {
  if (new Set(request.actorIds).size !== request.actorIds.length) {
    context.addIssue({ code: 'custom', path: ['actorIds'], message: 'El schedule repite un personaje' });
  }
});

type Target = { runId: z.infer<typeof RunIdSchema>; actorId: z.infer<typeof CharacterIdSchema> };

/**
 * Runs only the mechanical World→Experience delivery stage. It never starts an
 * actor session or treats a queued intent as a model call.
 */
export function createWorldDeliverySupervisor(input: {
  journal: ReturnType<typeof openJournal>;
  onOutcome?: (target: Target, result: WorldDeliveryDrainResult) => void;
}) {
  const controller = new AbortController();
  const active = new Map<string, Promise<void>>();
  const activeRunIds = new Map<string, Target['runId']>();
  let closed = false;
  let admissionSuspended=false;
  const suspendedRuns = new Set<Target['runId']>();

  function schedule(rawInput: unknown): void {
    if (closed||admissionSuspended) return;
    const request = ScheduleSchema.parse(rawInput);
    if (suspendedRuns.has(request.runId)) return;
    for (const actorId of request.actorIds) start({ runId: request.runId, actorId });
  }

  function start(target: Target): void {
    const key = JSON.stringify([target.runId, target.actorId]);
    if (active.has(key) || closed||admissionSuspended || suspendedRuns.has(target.runId)) return;
    const worker = createDeliverWorldWorker({ journal: input.journal, ...target });
    const task = (async () => {
      while (!controller.signal.aborted && !suspendedRuns.has(target.runId)) {
        let result: WorldDeliveryDrainResult;
        try {
          result = await worker.drain({ maxItems: 20, signal: controller.signal });
        } catch {
          result = { kind: 'failed', delivered: 0, reason: 'journal_failed' };
        }
        try { input.onOutcome?.(target, result); } catch { /* Diagnostics cannot alter delivery state. */ }
        if (result.kind !== 'completed' || !result.limitReached) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    })().finally(() => {
      if (active.get(key) === task) { active.delete(key); activeRunIds.delete(key); }
    });
    active.set(key, task);
    activeRunIds.set(key,target.runId);
  }

  return Object.freeze({
    schedule,

    recover(): number {
      if (closed||admissionSuspended) return 0;
      const targets = input.journal.listPendingWorldDeliveryTargets({ limit: 1_000 });
      for (const target of targets) start({ runId: target.runId, actorId: target.actorId });
      return targets.length;
    },

    async waitForRunIdle(rawInput: unknown): Promise<void> {
      const {runId} = z.strictObject({runId:RunIdSchema}).parse(rawInput);
      while (true) {
        const tasks = [...active.entries()].filter(([key]) => activeRunIds.get(key) === runId).map(([,task]) => task);
        if (tasks.length === 0) return;
        await Promise.all(tasks);
      }
    },

    async waitForIdle(): Promise<void> {
      while (active.size > 0) await Promise.all([...active.values()]);
    },
    async suspendAdmissions():Promise<()=>void>{
      if(closed||admissionSuspended||suspendedRuns.size>0)throw new Error('BACKUP_DELIVERY_BUSY');
      admissionSuspended=true;
      while(active.size>0)await Promise.all([...active.values()]);
      let released=false;return ()=>{if(released)return;released=true;admissionSuspended=false;};
    },

    async suspendRunAdmissions(rawInput: unknown): Promise<() => void> {
      const { runId } = z.strictObject({runId:RunIdSchema}).parse(rawInput);
      if (closed || admissionSuspended || suspendedRuns.has(runId)) throw new Error('DELIVERY_RUN_BUSY');
      suspendedRuns.add(runId);
      try {
        while (true) {
          const tasks = [...active.entries()].filter(([key]) => activeRunIds.get(key) === runId).map(([, task]) => task);
          if (tasks.length === 0) break;
          await Promise.all(tasks);
        }
      } catch (error) { suspendedRuns.delete(runId); throw error; }
      let released = false;
      return () => { if (released) return; released = true; suspendedRuns.delete(runId); };
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      controller.abort();
      await Promise.all([...active.values()]);
    },
  });
}
