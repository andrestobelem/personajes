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
  let closed = false;

  function schedule(rawInput: unknown): void {
    if (closed) return;
    const request = ScheduleSchema.parse(rawInput);
    for (const actorId of request.actorIds) start({ runId: request.runId, actorId });
  }

  function start(target: Target): void {
    const key = JSON.stringify([target.runId, target.actorId]);
    if (active.has(key) || closed) return;
    const worker = createDeliverWorldWorker({ journal: input.journal, ...target });
    const task = (async () => {
      while (!controller.signal.aborted) {
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
      if (active.get(key) === task) active.delete(key);
    });
    active.set(key, task);
  }

  return Object.freeze({
    schedule,

    recover(): number {
      if (closed) return 0;
      const targets = input.journal.listPendingWorldDeliveryTargets({ limit: 1_000 });
      for (const target of targets) start({ runId: target.runId, actorId: target.actorId });
      return targets.length;
    },

    async waitForIdle(): Promise<void> {
      while (active.size > 0) await Promise.all([...active.values()]);
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      controller.abort();
      await Promise.all([...active.values()]);
    },
  });
}
