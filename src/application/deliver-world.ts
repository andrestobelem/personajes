import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { openJournal } from '../adapters/journal.ts';
import { freezeExperience } from './experience-envelope.ts';
import { CharacterIdSchema, RunIdSchema, WorldSeqSchema } from '../domain/values.ts';
import type { Gesture, WorldPerception } from '../domain/world.ts';

const DrainOptionsSchema = z.strictObject({
  maxItems: z.number().int().min(1).max(100).default(20),
  throughWorldSeq: WorldSeqSchema.optional(),
});
const actorQueues = new Map<string, Promise<void>>();

export type WorldDeliveryDrainResult =
  | { kind: 'completed'; delivered: number; limitReached: boolean }
  | { kind: 'busy'; delivered: number }
  | { kind: 'failed'; delivered: number; reason: 'journal_failed' | 'delivery_failed' }
  | { kind: 'cancelled'; delivered: number };

export function createDeliverWorldWorker(input: {
  journal: ReturnType<typeof openJournal>;
  runId: z.infer<typeof RunIdSchema>;
  actorId: z.infer<typeof CharacterIdSchema>;
}) {
  const runId = RunIdSchema.parse(input.runId);
  const actorId = CharacterIdSchema.parse(input.actorId);
  const queueKey = JSON.stringify([runId, actorId]);

  return Object.freeze({
    async drain(options: { maxItems?: number; throughWorldSeq?: number; signal?: AbortSignal } = {}): Promise<WorldDeliveryDrainResult> {
      const parsed = DrainOptionsSchema.parse({
        maxItems: options.maxItems,
        throughWorldSeq: options.throughWorldSeq,
      });
      return withActorQueue(queueKey, async () => {
        let delivered = 0;
        let throughWorldSeq: number;
        try {
          const snapshot = input.journal.loadWorld({ runId });
          if (snapshot === undefined) return { kind: 'failed', delivered, reason: 'journal_failed' };
          throughWorldSeq = Math.min(parsed.throughWorldSeq ?? snapshot.seq, snapshot.seq);
        } catch {
          return { kind: 'failed', delivered, reason: 'journal_failed' };
        }
        const ownerToken = randomUUID();

        for (let index = 0; index < parsed.maxItems; index += 1) {
          if (options.signal?.aborted) return { kind: 'cancelled', delivered };
          const claimToken = randomUUID();
          let claim: ReturnType<typeof input.journal.claimWorldDelivery>;
          try {
            claim = input.journal.claimWorldDelivery({ runId, actorId, throughWorldSeq, ownerToken, claimToken });
          } catch {
            return { kind: 'failed', delivered, reason: 'journal_failed' };
          }
          if (claim.kind === 'empty') return { kind: 'completed', delivered, limitReached: false };
          if (claim.kind === 'busy') return { kind: 'busy', delivered };

          if (options.signal?.aborted) {
            const released = failClaim(input.journal, claim.perception.id, claimToken, 'cancelled');
            return released ? { kind: 'cancelled', delivered } : { kind: 'failed', delivered, reason: 'journal_failed' };
          }

          let experience: ReturnType<typeof createPerceptionExperience>;
          try {
            experience = createPerceptionExperience({
              perception: claim.perception,
              runId,
              actorId,
              worldSeq: claim.worldSeq,
            });
          } catch {
            const released = failClaim(input.journal, claim.perception.id, claimToken, 'delivery_failed');
            return released ? { kind: 'failed', delivered, reason: 'delivery_failed' } : { kind: 'failed', delivered, reason: 'journal_failed' };
          }

          if (options.signal?.aborted) {
            const released = failClaim(input.journal, claim.perception.id, claimToken, 'cancelled');
            return released ? { kind: 'cancelled', delivered } : { kind: 'failed', delivered, reason: 'journal_failed' };
          }

          let result: 'delivered' | 'existing' | 'stale';
          try {
            result = input.journal.completeWorldDelivery({
              perceptionId: claim.perception.id,
              claimToken,
              ...(experience === undefined ? {} : { experience }),
            });
          } catch {
            // The transaction could have committed before an I/O error surfaced.
            // A stale release is harmless; startup recovery handles an unresolved claim.
            failClaim(input.journal, claim.perception.id, claimToken, 'delivery_failed');
            return { kind: 'failed', delivered, reason: 'journal_failed' };
          }
          if (result === 'stale') return { kind: 'failed', delivered, reason: 'journal_failed' };
          delivered += 1;
        }
        return { kind: 'completed', delivered, limitReached: true };
      });
    },
  });
}

function createPerceptionExperience(input: {
  perception: WorldPerception;
  runId: z.infer<typeof RunIdSchema>;
  actorId: z.infer<typeof CharacterIdSchema>;
  worldSeq: z.infer<typeof WorldSeqSchema>;
}) {
  const { perception } = input;
  // Direct observations and execution feedback are typed private perceptions.
  // Neither is a public event, so neither can become an event-backed Experience.
  if (perception.kind === 'observation' || perception.kind === 'actionFeedback') return undefined;

  const common = {
    schemaVersion: 1 as const,
    experienceId: randomUUID(),
    runId: input.runId,
    actorId: input.actorId,
    content: experienceContent(perception),
    sourceRefs: [],
    fictitiousAt: perception.fictitiousAt,
    receivedAt: perception.fictitiousAt,
    worldSeq: input.worldSeq,
    confidence: 1,
    revision: 0,
    predecessor: { kind: 'initial' as const },
  };

  if (perception.kind === 'testimony') {
    return freezeExperience({
      ...common,
      kind: 'testimony',
      speakerParticipantId: perception.sourceParticipantId,
      speakerDisplayName: perception.speakerDisplayName,
      eventId: perception.eventId,
    });
  }
  return freezeExperience({
    ...common,
    kind: 'perception',
    perceptionId: perception.id,
    eventId: perception.eventId,
  });
}

function experienceContent(perception: Exclude<WorldPerception, { kind: 'observation' | 'actionFeedback' }>): string {
  switch (perception.kind) {
    case 'testimony': return perception.content.text;
    case 'communication':
      return perception.content.kind === 'speech'
        ? perception.content.text
        : gestureContent(perception.content.gesture);
    case 'offer': return `Recibiste la oferta «${perception.offerHandle}».`;
    case 'worldEvent': case 'circumstance': return perception.detail;
  }
}

function gestureContent(gesture: Gesture): string {
  switch (gesture.kind) {
    case 'wave': return 'Un personaje te saludó con la mano.';
    case 'point': return `Un personaje señaló hacia «${gesture.targetHandle}».`;
    case 'nod': return 'Un personaje asintió.';
    case 'shakeHead': return 'Un personaje negó con la cabeza.';
    case 'posture': return `Un personaje adoptó la postura «${gesture.pose}».`;
    case 'bark': return 'Un personaje ladró.';
    case 'whine': return 'Un personaje gimió.';
  }
}

function failClaim(
  journal: ReturnType<typeof openJournal>,
  perceptionId: string,
  claimToken: string,
  failureCode: 'delivery_failed' | 'cancelled',
): boolean {
  try {
    return journal.failWorldDelivery({ perceptionId, claimToken, failureCode }) === 'failed';
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
