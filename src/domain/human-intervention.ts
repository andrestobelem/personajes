import { z } from 'zod';
import { HumanInterventionRequestSchema, HumanParticipantProfileSchema } from './interaction.ts';
import {
  WorldEventSchema, WorldPerceptionSchema, WorldSnapshotSchema,
  canHearSpeechAt, characterCanReceiveAt,
} from './world.ts';
import type { WorldIdSource } from './world.ts';
import { EventIdSchema, FictionalInstantSchema, HumanInterventionIdSchema, RevisionSchema, WorldSeqSchema } from './values.ts';

const NoEmissionSchema = z.strictObject({ kind: z.literal('none') });

export const HumanInterventionResolutionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('applied'), interventionId: HumanInterventionIdSchema,
    baseRevision: RevisionSchema, revision: RevisionSchema,
    events: z.array(WorldEventSchema).min(1).max(100_000),
    perceptions: z.array(WorldPerceptionSchema).max(100_000),
    emission: z.strictObject({ kind: z.literal('emitted'), eventId: EventIdSchema }),
    newSnapshot: WorldSnapshotSchema,
  }),
  z.strictObject({
    kind: z.literal('notApplied'), interventionId: HumanInterventionIdSchema,
    revision: RevisionSchema,
    reason: z.enum([
      'scene-not-open', 'participant-presence-invalid', 'place-invalid', 'channel-unavailable',
      'audience-invalid', 'clock-overflow',
    ]),
    events: z.tuple([]), perceptions: z.tuple([]), emission: NoEmissionSchema,
    newSnapshot: WorldSnapshotSchema,
  }),
  z.strictObject({
    kind: z.literal('stale'), interventionId: HumanInterventionIdSchema,
    expectedRevision: RevisionSchema, currentRevision: RevisionSchema,
    events: z.tuple([]), perceptions: z.tuple([]), emission: NoEmissionSchema,
    newSnapshot: WorldSnapshotSchema,
  }),
]);
export type HumanInterventionResolution = z.infer<typeof HumanInterventionResolutionSchema>;

/**
 * Resolve one authenticated human utterance against the exact world cut.
 * The result confirms that the words were spoken; it makes no claim that they are true.
 */
export function resolveHumanIntervention(input: {
  snapshot: unknown;
  profile: unknown;
  request: unknown;
  interventionId: unknown;
  expectedRevision: unknown;
  ids: WorldIdSource;
}): HumanInterventionResolution {
  const world = WorldSnapshotSchema.parse(input.snapshot);
  const profile = HumanParticipantProfileSchema.parse(input.profile);
  const request = HumanInterventionRequestSchema.parse(input.request);
  const interventionId = HumanInterventionIdSchema.parse(input.interventionId);
  const expectedRevision = RevisionSchema.parse(input.expectedRevision);

  if (expectedRevision !== world.revision) {
    return HumanInterventionResolutionSchema.parse({
      kind: 'stale', interventionId, expectedRevision, currentRevision: world.revision,
      events: [], perceptions: [], emission: { kind: 'none' }, newSnapshot: world,
    });
  }
  const scene = world.scenes.find((candidate) => candidate.id === world.activeSceneId);
  if (scene === undefined || scene.lifecycle.kind !== 'open') return rejected(world, interventionId, 'scene-not-open');

  const presence = profile.presence;
  if (presence.kind === 'inScene' && (presence.sceneId !== scene.id || !scene.placeIds.includes(presence.placeId))) {
    return rejected(world, interventionId, 'participant-presence-invalid');
  }
  const place = world.places.find((candidate) => candidate.id === presence.placeId);
  if (place === undefined || presence.position.x < 0 || presence.position.y < 0
    || presence.position.x > place.width || presence.position.y > place.height) {
    return rejected(world, interventionId, 'place-invalid');
  }
  const channel = world.channels.find((candidate) => candidate.id === request.channelId);
  if (channel?.kind !== 'speech' || !channel.enabled || !channel.placeIds.includes(place.id)
    || request.channelId !== presence.channelId) {
    return rejected(world, interventionId, 'channel-unavailable');
  }

  const requestedAudience = request.recipientCharacterIds;
  if ((channel.scope === 'addressed' && requestedAudience.length === 0)
    || (channel.scope === 'broadcast' && requestedAudience.length !== 0)) {
    return rejected(world, interventionId, 'audience-invalid');
  }
  const audience = channel.scope === 'broadcast' ? scene.participantIds : requestedAudience;
  if (audience.some((characterId) => !scene.participantIds.includes(characterId))) {
    return rejected(world, interventionId, 'audience-invalid');
  }

  const durationMs = world.actionDurations.speechMs;
  const endAt = FictionalInstantSchema.safeParse(world.clock.instant + durationMs);
  if (!endAt.success) return rejected(world, interventionId, 'clock-overflow');

  const source = { placeId: place.id, position: presence.position };
  const effectiveAudience = audience.filter((characterId) => characterCanReceiveAt({ snapshot: world, characterId })
    && canHearSpeechAt({
      snapshot: world,
      source,
      recipient: (() => {
        const character = world.entities.find((entity) => entity.kind === 'character' && entity.characterId === characterId);
        return character?.kind === 'character'
          ? { placeId: character.placeId, position: character.position }
          : { placeId: place.id, position: presence.position };
      })(),
      channelId: channel.id,
    }));

  const event = WorldEventSchema.parse({
    id: input.ids.eventId(), runId: world.runId, seq: WorldSeqSchema.parse(world.seq + 1),
    origin: { kind: 'human', participantId: profile.identity.participantId, interventionId },
    kind: 'humanIntervention', speakerDisplayName: profile.identity.displayName,
    placeId: place.id, position: presence.position, channelId: channel.id,
    content: request.content, requestedAudience: audience, effectiveAudience,
    fictitiousAt: world.clock.instant, durationMs,
  });
  const events = [event];
  const expiredOffers = world.offers
    .filter((offer): offer is Extract<typeof offer, { state: 'open' }> => offer.state === 'open' && offer.expiresAt <= endAt.data)
    .sort((left, right) => left.expiresAt - right.expiresAt || left.id.localeCompare(right.id));
  for (const offer of expiredOffers) {
    events.push(WorldEventSchema.parse({
      id: input.ids.eventId(), runId: world.runId, seq: WorldSeqSchema.parse(world.seq + events.length + 1),
      origin: { kind: 'system', causeInterventionId: interventionId },
      kind: 'offerInvalidated', offerId: offer.id, objectEntityId: offer.objectEntityId,
      cause: 'expired', fictitiousAt: offer.expiresAt, durationMs: 0,
    }));
  }
  const perceptions = effectiveAudience.map((recipientCharacterId) => WorldPerceptionSchema.parse({
    kind: 'testimony', id: input.ids.perceptionId(), runId: world.runId, recipientCharacterId,
    eventId: event.id, sourceParticipantId: profile.identity.participantId,
    speakerDisplayName: profile.identity.displayName, channelId: channel.id,
    content: request.content, fictitiousAt: endAt.data,
  }));
  const revision = RevisionSchema.parse(world.revision + 1);
  const offers = world.offers.map((offer) => offer.state === 'open' && offer.expiresAt <= endAt.data
    ? { ...offer, state: 'invalidated' as const, cause: 'expired' as const, eventId: events.find((candidate) => candidate.kind === 'offerInvalidated' && candidate.offerId === offer.id)?.id }
    : offer);
  const newSnapshot = WorldSnapshotSchema.parse({
    ...world, revision, seq: WorldSeqSchema.parse(world.seq + events.length),
    clock: { ...world.clock, instant: endAt.data }, offers,
  });
  return HumanInterventionResolutionSchema.parse({
    kind: 'applied', interventionId, baseRevision: world.revision, revision,
    events, perceptions, emission: { kind: 'emitted', eventId: event.id }, newSnapshot,
  });
}

function rejected(
  world: z.infer<typeof WorldSnapshotSchema>,
  interventionId: z.infer<typeof HumanInterventionIdSchema>,
  reason: Extract<HumanInterventionResolution, { kind: 'notApplied' }>['reason'],
): HumanInterventionResolution {
  return HumanInterventionResolutionSchema.parse({
    kind: 'notApplied', interventionId, revision: world.revision, reason,
    events: [], perceptions: [], emission: { kind: 'none' }, newSnapshot: world,
  });
}
