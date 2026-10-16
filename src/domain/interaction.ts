import { WorldSnapshotSchema, canHearSpeechAt, characterCanReceiveAt } from './world.ts';
import { HumanInteractionContextSchema, HumanParticipantProfileSchema } from './interaction-schema.ts';
import type { HumanInteractionContext } from './interaction-schema.ts';

export * from './interaction-schema.ts';

/** A privacy-filtered list of characters who can currently receive this participant's speech. */
export function projectHumanInteractionContext(input: { snapshot: unknown; profile: unknown }): HumanInteractionContext | undefined {
  const snapshot = WorldSnapshotSchema.parse(input.snapshot);
  const profile = humanParticipantProfileAtSnapshot({snapshot,profile:input.profile});
  const scene = snapshot.scenes.find((candidate) => candidate.id === snapshot.activeSceneId && candidate.lifecycle.kind === 'open');
  if (scene === undefined) return undefined;
  const presence = profile.presence;
  const place = snapshot.places.find((candidate) => candidate.id === presence.placeId);
  const channel = snapshot.channels.find((candidate) => candidate.id === presence.channelId);
  if ((presence.kind === 'inScene' && (presence.sceneId !== scene.id || !scene.placeIds.includes(presence.placeId))) || place === undefined
    || presence.position.x < 0 || presence.position.x > place.width || presence.position.y < 0 || presence.position.y > place.height || channel?.kind !== 'speech' || !channel.enabled || !channel.placeIds.includes(place.id)) return undefined;
  const source = { placeId: place.id, position: presence.position };
  const recipients = scene.participantIds.flatMap((characterId) => {
    if (!characterCanReceiveAt({ snapshot, characterId }) || !canHearSpeechAt({
      snapshot, source, recipient: (() => {
        const entity = snapshot.entities.find((candidate) => candidate.kind === 'character' && candidate.characterId === characterId);
        return entity?.kind === 'character' ? { placeId: entity.placeId, position: entity.position } : source;
      })(), channelId: channel.id,
    })) return [];
    const entity = snapshot.entities.find((candidate) => candidate.kind === 'character' && candidate.characterId === characterId);
    return entity?.kind === 'character' ? [{ characterId, displayName: entity.presentation.label }] : [];
  });
  return HumanInteractionContextSchema.parse({
    kind: 'human-interaction-context', runId: snapshot.runId, worldRevision: snapshot.revision,
    worldSeq: snapshot.seq, fictionalAt: snapshot.clock.instant,
    scene: { id: scene.id, label: scene.label }, place: { id: place.id, label: place.name },
    channel: { id: channel.id, label: channel.label, scope: channel.scope }, recipients,
  });
}

/** Public presence belongs to the confirmed world cut; profile prose remains user-owned. */
export function humanParticipantProfileAtSnapshot(input:{snapshot:unknown;profile:unknown}) {
  const snapshot=WorldSnapshotSchema.parse(input.snapshot);
  const profile=HumanParticipantProfileSchema.parse(input.profile);
  const human=snapshot.humanParticipants?.find(item=>item.participantId===profile.identity.participantId);
  return human===undefined?profile:HumanParticipantProfileSchema.parse({...profile,
    identity:{...profile.identity,displayName:human.label},presence:human.presence});
}
