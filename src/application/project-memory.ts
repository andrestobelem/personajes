import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { openJournal } from '../adapters/journal.ts';
import { isIcmAdapterFailure } from '../adapters/icm.ts';
import type { IcmExperienceProjector } from '../adapters/icm.ts';
import { CharacterIdSchema, RunIdSchema } from '../domain/values.ts';

const DrainOptionsSchema = z.strictObject({ maxItems: z.number().int().min(1).max(100).default(10) });
const actorQueues = new Map<string, Promise<void>>();

export type MemoryProjectionDrainResult =
  | { kind: 'completed'; projected: number; limitReached: boolean }
  | { kind: 'busy'; projected: number }
  | { kind: 'failed'; projected: number; reason: 'store_failed' | 'journal_failed' }
  | { kind: 'cancelled'; projected: number };

export interface CreateProjectMemoryWorkerInput {
  journal: ReturnType<typeof openJournal>;
  projector: IcmExperienceProjector;
  runId: z.infer<typeof RunIdSchema>;
  actorId: z.infer<typeof CharacterIdSchema>;
}

export function createProjectMemoryWorker(input: CreateProjectMemoryWorkerInput) {
  const runId = RunIdSchema.parse(input.runId);
  const actorId = CharacterIdSchema.parse(input.actorId);
  const queueKey = JSON.stringify([runId, actorId]);

  return Object.freeze({
    async drain(options: { maxItems?: number; signal?: AbortSignal } = {}): Promise<MemoryProjectionDrainResult> {
      const parsed = DrainOptionsSchema.parse({ maxItems: options.maxItems });
      return withActorQueue(queueKey, async () => {
        let projected = 0;
        const ownerToken = randomUUID();
        for (let index = 0; index < parsed.maxItems; index += 1) {
          if (options.signal?.aborted) return { kind: 'cancelled', projected };
          const claimToken = randomUUID();
          let claim: ReturnType<typeof input.journal.claimNextMemoryProjection>;
          try {
            claim = input.journal.claimNextMemoryProjection({ runId, actorId, ownerToken, claimToken });
          } catch {
            return { kind: 'failed', projected, reason: 'journal_failed' };
          }
          if (claim.kind === 'empty') return { kind: 'completed', projected, limitReached: false };
          if (claim.kind === 'busy') return { kind: 'busy', projected };

          if (options.signal?.aborted) {
            const released = releaseClaim(input.journal, claim.frozen.envelope.experienceId, claimToken, 'cancelled');
            return released ? { kind: 'cancelled', projected } : { kind: 'failed', projected, reason: 'journal_failed' };
          }

          let stored: Awaited<ReturnType<IcmExperienceProjector['store']>>;
          try {
            stored = await input.projector.store(claim.frozen, options.signal === undefined ? undefined : { signal: options.signal });
          } catch (error: unknown) {
            const failureKind = options.signal?.aborted || (isIcmAdapterFailure(error) && error.code === 'PROCESS_ABORTED')
              ? 'cancelled'
              : 'projection_failed';
            const released = releaseClaim(input.journal, claim.frozen.envelope.experienceId, claimToken, failureKind);
            if (!released) return { kind: 'failed', projected, reason: 'journal_failed' };
            return failureKind === 'cancelled'
              ? { kind: 'cancelled', projected }
              : { kind: 'failed', projected, reason: 'store_failed' };
          }

          if (stored.experienceId !== claim.frozen.envelope.experienceId) {
            const released = releaseClaim(input.journal, claim.frozen.envelope.experienceId, claimToken, 'projection_failed');
            return released
              ? { kind: 'failed', projected, reason: 'store_failed' }
              : { kind: 'failed', projected, reason: 'journal_failed' };
          }

          try {
            input.journal.acknowledgeMemoryProjection({
              experienceId: claim.frozen.envelope.experienceId,
              claimToken,
              memoryId: stored.memoryId,
              payloadHash: claim.frozen.payloadHash,
            });
          } catch {
            // The ack may have committed despite an I/O failure. Leave the claim in place;
            // a new host owner will inspect the receipt or replay the exact frozen payload.
            return { kind: 'failed', projected, reason: 'journal_failed' };
          }
          projected += 1;
        }
        return { kind: 'completed', projected, limitReached: true };
      });
    },
  });
}

function releaseClaim(
  journal: ReturnType<typeof openJournal>,
  experienceId: string,
  claimToken: string,
  failureKind: 'projection_failed' | 'cancelled',
): boolean {
  try {
    return journal.releaseMemoryProjectionClaim({ experienceId, claimToken, failureKind }) === 'released';
  } catch {
    return false;
  }
}

async function withActorQueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = actorQueues.get(key) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const tail = current.then(() => undefined, () => undefined);
  actorQueues.set(key, tail);
  try {
    return await current;
  } finally {
    if (actorQueues.get(key) === tail) actorQueues.delete(key);
  }
}
