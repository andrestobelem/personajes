import { routineIsAvailable } from './routine-calendar.ts';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ExperienceSchema } from './experience.ts';
import type { Experience } from './experience.ts';
import {
  CharacterIdSchema, EntityHandleSchema, EventIdSchema, ExperienceIdSchema,
  FictionalInstantSchema, HashSchema, PerceptionIdSchema, RevisionSchema,
  WorldSeqSchema,
} from './values.ts';
import {
  WorldDurationMsSchema, PlaceIdSchema, WorldEntityIdSchema, DoorIdSchema,
  ChannelIdSchema, OfferIdSchema, WorldAttemptIdSchema, PlaceHandleSchema,
  ChannelHandleSchema, OfferHandleSchema, WorldPointSchema, ModalitySchema,
  CharacterCapabilitySchema, WorldClockSchema, WorldPlaceSchema, ActorGoalSchema,
  SubjectiveBeliefSchema, RelationshipBeliefSchema, ActorMindSchema, WorldCharacterSchema,
  WorldDeviceSchema, InventoryEntrySchema, WorldOfferSchema, WorldSnapshotSchema,
  ActorKnowledgeSchema, CommunicationContentSchema, WorldAttemptSchema, WorldContentApprovalReceiptSchema,
  WorldEventSchema, WorldPerceptionSchema, ResolutionReasonSchema, WorldEmissionSchema,
  WorldResolutionSchema, PerceivedIdentitySchema, ActorActionUnavailableReasonSchema, ActorActionAvailabilitySchema,
  ActorDeviceOperationSchema, ActorViewEntitySchema, ActorWorldViewSchema, CompleteActorWorldViewSchema,
} from './world-schema.ts';
import type {
  WorldPlace, WorldDoor, WorldConnection, WorldChannel,
  WorldCharacter, WorldObject, DeviceOperation,
  WorldDevice, WorldEntity, InventoryEntry, WorldScene,
  WorldOffer, WorldSnapshot, ActorHandleBinding, ActorKnowledge,
  CommunicationContent, WorldAttempt, WorldIdSource, WorldEvent,
  WorldPerception, WorldResolution, ActorWorldView,
} from './world-schema.ts';

export * from './world-schema.ts';

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('Contenido no serializable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = z.record(z.string(), z.unknown()).parse(value);
  const entries = Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(',')}}`;
}

export function hashCommunicationContent(input: unknown): z.infer<typeof HashSchema> {
  const content = CommunicationContentSchema.parse(input);
  return HashSchema.parse(createHash('sha256').update(canonicalJson(content)).digest('hex'));
}

function characterById(world: WorldSnapshot, characterId: z.infer<typeof CharacterIdSchema>): WorldCharacter | undefined {
  return world.entities.find((entity): entity is WorldCharacter => entity.kind === 'character' && entity.characterId === characterId);
}

function entityById(world: WorldSnapshot, entityId: z.infer<typeof WorldEntityIdSchema>): WorldEntity | undefined {
  return world.entities.find((entity) => entity.entityId === entityId);
}

function placeById(world: WorldSnapshot, placeId: z.infer<typeof PlaceIdSchema>): WorldPlace | undefined {
  return world.places.find((place) => place.id === placeId);
}

function distance(left: z.infer<typeof WorldPointSchema>, right: z.infer<typeof WorldPointSchema>): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function doorById(world: WorldSnapshot, doorId: z.infer<typeof DoorIdSchema>): WorldDoor | undefined {
  return world.doors.find((door) => door.id === doorId);
}

function visuallyPassable(world: WorldSnapshot, throughDoorIds: readonly z.infer<typeof DoorIdSchema>[]): boolean {
  return throughDoorIds.every((id) => {
    const door = doorById(world, id);
    return door !== undefined && (door.state === 'open' || door.transparentWhenClosed);
  });
}

function audiblyPassable(world: WorldSnapshot, throughDoorIds: readonly z.infer<typeof DoorIdSchema>[]): boolean {
  return throughDoorIds.every((id) => {
    const door = doorById(world, id);
    return door !== undefined && (door.state === 'open' || door.soundPassesWhenClosed);
  });
}

function entityLocation(world: WorldSnapshot, entity: WorldEntity): { placeId: z.infer<typeof PlaceIdSchema>; position: z.infer<typeof WorldPointSchema> } | undefined {
  if (entity.kind === 'character' || entity.kind === 'device') return { placeId: entity.placeId, position: entity.position };
  const placement = world.inventory.find((entry) => entry.objectEntityId === entity.entityId)?.location;
  if (placement === undefined || placement.kind === 'consumed') return undefined;
  if (placement.kind === 'atPlace') return { placeId: placement.placeId, position: placement.position };
  const holder = entityById(world, placement.entityId);
  if (holder?.kind !== 'character') return undefined;
  return { placeId: holder.placeId, position: holder.position };
}

function entityWithinScene(world: WorldSnapshot, scene: WorldScene, entity: WorldEntity): boolean {
  const location = entityLocation(world, entity);
  if (location === undefined || !scene.placeIds.includes(location.placeId)) return false;
  if (entity.kind !== 'character') return true;
  return scene.participantIds.includes(entity.characterId)
    && entity.presence.kind === 'present'
    && entity.presence.sceneId === scene.id;
}

function isVisuallyReachable(
  world: WorldSnapshot,
  from: { placeId: z.infer<typeof PlaceIdSchema>; position: z.infer<typeof WorldPointSchema> },
  to: { placeId: z.infer<typeof PlaceIdSchema>; position: z.infer<typeof WorldPointSchema> },
  maxRange?: number,
): boolean {
  const fromPlace = placeById(world, from.placeId);
  const toPlace = placeById(world, to.placeId);
  if (fromPlace === undefined || toPlace === undefined || fromPlace.lighting === 'dark' || toPlace.lighting === 'dark') return false;
  if (from.placeId === to.placeId) {
    return maxRange === undefined || distance(from.position, to.position) <= maxRange;
  }
  return world.perceptualPaths.some((path) => path.kind === 'visual' && path.from === from.placeId && path.to === to.placeId &&
    (maxRange === undefined || path.distance <= maxRange) && visuallyPassable(world, path.throughDoorIds));
}

function isAudiblyReachable(
  world: WorldSnapshot,
  from: { placeId: z.infer<typeof PlaceIdSchema>; position: z.infer<typeof WorldPointSchema> },
  to: { placeId: z.infer<typeof PlaceIdSchema>; position: z.infer<typeof WorldPointSchema> },
  channel: WorldChannel,
): boolean {
  if (!channel.placeIds.includes(from.placeId) || !channel.placeIds.includes(to.placeId)) return false;
  const audible = channel.kind === 'speech' || channel.modality === 'auditory';
  if (!audible) return false;
  if (from.placeId === to.placeId) return distance(from.position, to.position) <= channel.maxRange;
  return world.perceptualPaths.some((path) => path.kind === 'auditory' && path.channelId === channel.id &&
    path.from === from.placeId && path.to === to.placeId && path.distance <= channel.maxRange && audiblyPassable(world, path.throughDoorIds));
}

function canPerceive(
  world: WorldSnapshot,
  from: { placeId: z.infer<typeof PlaceIdSchema>; position: z.infer<typeof WorldPointSchema> },
  to: { placeId: z.infer<typeof PlaceIdSchema>; position: z.infer<typeof WorldPointSchema> },
  modality: z.infer<typeof ModalitySchema>,
  channel?: WorldChannel,
): boolean {
  if (channel !== undefined && (!channel.placeIds.includes(from.placeId) || !channel.placeIds.includes(to.placeId))) return false;
  if (modality === 'visual') return isVisuallyReachable(world, from, to, channel?.maxRange);
  return channel !== undefined && isAudiblyReachable(world, from, to, channel);
}

/** Resolves speech audibility with the same channel, range, door and path rules as actor communication. */
export function canHearSpeechAt(input: {
  snapshot: unknown;
  source: { placeId: unknown; position: unknown };
  recipient: { placeId: unknown; position: unknown };
  channelId: unknown;
}): boolean {
  const world = WorldSnapshotSchema.parse(input.snapshot);
  const source = z.strictObject({ placeId: PlaceIdSchema, position: WorldPointSchema }).parse(input.source);
  const recipient = z.strictObject({ placeId: PlaceIdSchema, position: WorldPointSchema }).parse(input.recipient);
  const channelId = ChannelIdSchema.parse(input.channelId);
  const channel = world.channels.find((candidate) => candidate.id === channelId);
  if (channel?.kind !== 'speech' || !channel.enabled) return false;
  return canPerceive(world, source, recipient, 'auditory', channel);
}

/** Physical reachability of a circumstance, without assigning an actor as its source.
 * Unchannelled sounds are explicitly local; remote sound requires a prepared channel. */
export function canPerceiveCircumstanceAt(input: {
  snapshot: unknown;
  source: { placeId: unknown; position: unknown };
  recipientCharacterId: unknown;
  modality: unknown;
  channelId?: unknown;
}): boolean {
  const world = WorldSnapshotSchema.parse(input.snapshot);
  const source = z.strictObject({ placeId: PlaceIdSchema, position: WorldPointSchema }).parse(input.source);
  const characterId = CharacterIdSchema.parse(input.recipientCharacterId);
  const modality = ModalitySchema.parse(input.modality);
  const channelId = ChannelIdSchema.optional().parse(input.channelId);
  const recipient = characterById(world, characterId);
  const scene = world.scenes.find((candidate) => candidate.id === world.activeSceneId);
  if (recipient === undefined || scene === undefined || !scene.placeIds.includes(source.placeId)
    || !characterCanReceiveAt({ snapshot: world, characterId })) return false;
  const location = { placeId: recipient.placeId, position: recipient.position };
  if (channelId === undefined && modality === 'auditory') return source.placeId === location.placeId;
  const channel = channelId === undefined ? undefined : world.channels.find((candidate) => candidate.id === channelId);
  if (channelId !== undefined && (channel === undefined || !channel.enabled)) return false;
  return modality === 'visual'
    ? canPerceive(world, location, source, modality, channel)
    : canPerceive(world, source, location, modality, channel);
}

function entityModalities(world: WorldSnapshot, observer: WorldCharacter, entity: WorldEntity): z.infer<typeof ModalitySchema>[] {
  const targetLocation = entityLocation(world, entity);
  if (targetLocation === undefined) return [];
  const observerLocation = { placeId: observer.placeId, position: observer.position };
  const modalities: z.infer<typeof ModalitySchema>[] = [];
  if (isVisuallyReachable(world, observerLocation, targetLocation)) modalities.push('visual');
  if (entity.kind === 'character') {
    const audibleChannel = world.channels.find((channel) => channel.enabled && (channel.kind === 'speech' || channel.modality === 'auditory') &&
      channel.placeIds.includes(observer.placeId) && canPerceive(world, observerLocation, targetLocation, 'auditory', channel));
    if (audibleChannel !== undefined) modalities.push('auditory');
  }
  return modalities;
}

function characterIdentityFor(observer: WorldCharacter, subject: WorldCharacter): z.infer<typeof PerceivedIdentitySchema> {
  if (subject.characterId === observer.characterId) return { kind: 'ordinary', label: subject.trueDisplayName };
  if (subject.presentation.kind === 'cover' && observer.mind.recognizedCharacterIds.includes(subject.characterId)) {
    return { kind: 'recognized', label: subject.trueDisplayName };
  }
  if (subject.presentation.kind === 'cover') return { kind: 'cover', label: subject.presentation.label };
  return { kind: 'ordinary', label: subject.presentation.label };
}

function existingBinding(
  knowledge: ActorKnowledge,
  kind: ActorHandleBinding['kind'],
  targetId: string,
): ActorHandleBinding | undefined {
  return knowledge.bindings.find((binding) => {
    if (binding.kind !== kind) return false;
    switch (binding.kind) {
      case 'entity': return binding.entityId === targetId;
      case 'place': return binding.placeId === targetId;
      case 'channel': return binding.channelId === targetId;
      case 'offer': return binding.offerId === targetId;
      default: {
        const exhaustive: never = binding;
        return exhaustive;
      }
    }
  });
}

function addEntityBinding(knowledge: ActorKnowledge, entityId: z.infer<typeof WorldEntityIdSchema>, ids: WorldIdSource): { knowledge: ActorKnowledge; handle: z.infer<typeof EntityHandleSchema> } {
  const existing = existingBinding(knowledge, 'entity', entityId);
  if (existing?.kind === 'entity') return { knowledge, handle: existing.handle };
  const handle = EntityHandleSchema.parse(ids.entityHandle());
  const next = ActorKnowledgeSchema.parse({ ...knowledge, bindings: [...knowledge.bindings, { kind: 'entity', entityId, handle }] });
  return { knowledge: next, handle };
}

function addPlaceBinding(knowledge: ActorKnowledge, placeId: z.infer<typeof PlaceIdSchema>, ids: WorldIdSource): { knowledge: ActorKnowledge; handle: z.infer<typeof PlaceHandleSchema> } {
  const existing = existingBinding(knowledge, 'place', placeId);
  if (existing?.kind === 'place') return { knowledge, handle: existing.handle };
  const handle = PlaceHandleSchema.parse(ids.placeHandle());
  const next = ActorKnowledgeSchema.parse({ ...knowledge, bindings: [...knowledge.bindings, { kind: 'place', placeId, handle }] });
  return { knowledge: next, handle };
}

function addChannelBinding(knowledge: ActorKnowledge, channelId: z.infer<typeof ChannelIdSchema>, ids: WorldIdSource): { knowledge: ActorKnowledge; handle: z.infer<typeof ChannelHandleSchema> } {
  const existing = existingBinding(knowledge, 'channel', channelId);
  if (existing?.kind === 'channel') return { knowledge, handle: existing.handle };
  const handle = ChannelHandleSchema.parse(ids.channelHandle());
  const next = ActorKnowledgeSchema.parse({ ...knowledge, bindings: [...knowledge.bindings, { kind: 'channel', channelId, handle }] });
  return { knowledge: next, handle };
}

function addOfferBinding(knowledge: ActorKnowledge, offer: Extract<WorldOffer, { state: 'open' }>): ActorKnowledge {
  const existing = existingBinding(knowledge, 'offer', offer.id);
  if (existing?.kind === 'offer') {
    if (existing.handle !== offer.handle) throw new Error('OfferHandle no coincide con conocimiento durable');
    return knowledge;
  }
  return ActorKnowledgeSchema.parse({
    ...knowledge,
    bindings: [...knowledge.bindings, { kind: 'offer', offerId: offer.id, handle: offer.handle }],
  });
}

function actionAvailability(reason?: z.infer<typeof ActorActionUnavailableReasonSchema>): z.infer<typeof ActorActionAvailabilitySchema> {
  return reason === undefined ? { kind: 'available' } : { kind: 'unavailable', reason };
}

function accessibleScenePlaces(
  world: WorldSnapshot,
  actor: WorldCharacter,
  scene: WorldScene,
): Map<z.infer<typeof PlaceIdSchema>, WorldConnection | undefined> {
  const accessible = new Map<z.infer<typeof PlaceIdSchema>, WorldConnection | undefined>([[actor.placeId, undefined]]);
  for (const connection of world.connections) {
    if (connection.from !== actor.placeId || !scene.placeIds.includes(connection.to) || accessible.has(connection.to)) continue;
    const door = connection.doorId === null ? undefined : doorById(world, connection.doorId);
    if (door !== undefined && door.state !== 'open') continue;
    accessible.set(connection.to, connection);
  }
  return accessible;
}

function arrivalCollides(
  world: WorldSnapshot,
  actor: WorldCharacter,
  destinationId: z.infer<typeof PlaceIdSchema>,
  arrivalPoint: z.infer<typeof WorldPointSchema>,
): boolean {
  return world.entities.some((entity) => {
    if (entity.entityId === actor.entityId || !entity.blocksMovement) return false;
    const inventoryEntry = world.inventory.find((entry) => entry.objectEntityId === entity.entityId);
    if (inventoryEntry?.location.kind === 'heldBy' && inventoryEntry.location.entityId === actor.entityId) return false;
    const location = entityLocation(world, entity);
    return location !== undefined && location.placeId === destinationId
      && distance(arrivalPoint, location.position) < actor.collisionRadius + entity.collisionRadius;
  });
}

function movementAvailability(
  world: WorldSnapshot,
  actor: WorldCharacter,
  scene: WorldScene,
  connection: WorldConnection,
): z.infer<typeof ActorActionAvailabilitySchema> {
  if (!actorCanAct(actor, world, scene)) return actionAvailability('actor-unavailable');
  if (!hasCapability(actor, 'move')) return actionAvailability('capability-missing');
  if (arrivalCollides(world, actor, connection.to, connection.arrivalPoint)) return actionAvailability('collision');
  if (clockAfter(world, connection.durationMs) === undefined) return actionAvailability('clock-overflow');
  return actionAvailability();
}

function objectTakeAvailability(
  world: WorldSnapshot,
  actor: WorldCharacter,
  scene: WorldScene,
  object: WorldObject,
): z.infer<typeof ActorActionAvailabilitySchema> {
  if (!actorCanAct(actor, world, scene)) return actionAvailability('actor-unavailable');
  if (!hasCapability(actor, 'take')) return actionAvailability('capability-missing');
  if (!object.portable) return actionAvailability('object-not-portable');
  const entry = world.inventory.find((candidate) => candidate.objectEntityId === object.entityId);
  if (entry?.location.kind !== 'atPlace' || entry.location.placeId !== actor.placeId) return actionAvailability('object-not-available');
  if (distance(actor.position, entry.location.position) > world.actionDurations.interactionRange) return actionAvailability('out-of-reach');
  if (clockAfter(world, world.actionDurations.takeMs) === undefined) return actionAvailability('clock-overflow');
  return actionAvailability();
}

function deviceOperationAvailability(
  world: WorldSnapshot,
  actor: WorldCharacter,
  scene: WorldScene,
  device: WorldDevice,
  operation: DeviceOperation,
): z.infer<typeof ActorActionAvailabilitySchema> {
  if (!actorCanAct(actor, world, scene)) return actionAvailability('actor-unavailable');
  if (!hasCapability(actor, 'useDevice')) return actionAvailability('capability-missing');
  // Internal operability is resolved when used; seeing a device does not reveal it.
  if (!canInteract(world, actor, device)) return actionAvailability('out-of-reach');
  if (operation.kind === 'setPower') {
    if (device.power === operation.state) return actionAvailability('state-unchanged');
  } else {
    if (!scene.placeIds.includes(operation.placeId)) return actionAvailability('device-unavailable');
    if (device.power !== 'on') return actionAvailability('power-required');
    const place = placeById(world, operation.placeId);
    if (place?.lighting === operation.level) return actionAvailability('state-unchanged');
  }
  if (clockAfter(world, operation.durationMs) === undefined) return actionAvailability('clock-overflow');
  return actionAvailability();
}

function actorViewEntity(
  world: WorldSnapshot,
  observer: WorldCharacter,
  scene: WorldScene,
  entity: WorldEntity,
  modalities: z.infer<typeof ModalitySchema>[],
  knowledge: ActorKnowledge,
  ids: WorldIdSource,
  visiblePlaceHandles: ReadonlyMap<z.infer<typeof PlaceIdSchema>, z.infer<typeof PlaceHandleSchema>>,
): { knowledge: ActorKnowledge; entity: z.infer<typeof ActorViewEntitySchema> | undefined } {
  // Entity identity and coordinates are only projected after visual perception.
  // Audio-only reachability is represented by a perception/inbox item instead.
  if (!modalities.includes('visual')) return { knowledge, entity: undefined };
  const location = entityLocation(world, entity);
  if (location === undefined || modalities.length === 0) return { knowledge, entity: undefined };
  const place = placeById(world, location.placeId);
  if (place === undefined) return { knowledge, entity: undefined };
  const binding = addEntityBinding(knowledge, entity.entityId, ids);
  const placeBinding = addPlaceBinding(binding.knowledge, place.id, ids);
  const nextKnowledge = placeBinding.knowledge;
  if (entity.kind === 'character') {
    return {
      knowledge: nextKnowledge,
      entity: ActorViewEntitySchema.parse({
        kind: 'character', handle: binding.handle, identity: characterIdentityFor(observer, entity),
        modality: modalities, placeHandle: placeBinding.handle, position: location.position,
        availability: actorCanAct(entity, world, scene) ? 'available' : 'unavailable',
      }),
    };
  }
  if (entity.kind === 'object') {
    const inventory = world.inventory.find((entry) => entry.objectEntityId === entity.entityId);
    if (inventory === undefined || inventory.location.kind === 'consumed') return { knowledge: nextKnowledge, entity: undefined };
    const custody = inventory.location.kind === 'atPlace'
      ? 'atPlace'
      : inventory.location.entityId === observer.entityId ? 'heldBySelf' : 'heldByOther';
    return {
      knowledge: nextKnowledge,
      entity: ActorViewEntitySchema.parse({
        kind: 'object', handle: binding.handle, label: entity.label, description: entity.description,
        modality: modalities, placeHandle: placeBinding.handle, position: location.position, portable: entity.portable,
        custody, takeAvailability: objectTakeAvailability(world, observer, scene, entity),
      }),
    };
  }
  const operations: z.infer<typeof ActorDeviceOperationSchema>[] = [];
  for (const operation of entity.operations) {
    if (operation.kind === 'setPower') {
      operations.push(ActorDeviceOperationSchema.parse({
        kind: operation.kind, id: operation.id, label: operation.label, durationMs: operation.durationMs,
        effect: { kind: 'powerChanged', state: operation.state },
        availability: deviceOperationAvailability(world, observer, scene, entity, operation),
      }));
      continue;
    }
    const effectPlaceHandle = visiblePlaceHandles.get(operation.placeId);
    const effectPlace = placeById(world, operation.placeId);
    if (!scene.placeIds.includes(operation.placeId) || effectPlaceHandle === undefined || effectPlace === undefined) continue;
    operations.push(ActorDeviceOperationSchema.parse({
      kind: operation.kind, id: operation.id, label: operation.label, durationMs: operation.durationMs,
      effect: { kind: 'lightChanged', placeHandle: effectPlaceHandle, placeName: effectPlace.name, level: operation.level },
      availability: deviceOperationAvailability(world, observer, scene, entity, operation),
    }));
  }
  return {
    knowledge: nextKnowledge,
    entity: ActorViewEntitySchema.parse({
      kind: 'device', handle: binding.handle, label: entity.label, description: entity.description,
      modality: modalities, placeHandle: placeBinding.handle, position: location.position,
      power: entity.power, operations,
    }),
  };
}

export function buildActorWorldView(input: {
  snapshot: unknown;
  actorId: unknown;
  knowledge: unknown;
  pendingPerceptions: unknown;
  ids: WorldIdSource;
}): { view: ActorWorldView; knowledge: ActorKnowledge } {
  const snapshot = WorldSnapshotSchema.parse(input.snapshot);
  const actorId = CharacterIdSchema.parse(input.actorId);
  let knowledge = ActorKnowledgeSchema.parse(input.knowledge);
  const pendingPerceptions = z.array(WorldPerceptionSchema).max(100_000).parse(input.pendingPerceptions);
  if (knowledge.runId !== snapshot.runId || knowledge.actorId !== actorId) throw new Error('Conocimiento host no corresponde al actor/corrida');
  const observer = characterById(snapshot, actorId);
  if (observer === undefined) throw new Error('Actor no existe en el Escenario');
  const scene = snapshot.scenes.find((candidate) => candidate.id === snapshot.activeSceneId);
  if (scene === undefined || scene.lifecycle.kind !== 'open' || !scene.participantIds.includes(actorId) || observer.presence.kind !== 'present' || observer.presence.sceneId !== scene.id || !scene.placeIds.includes(observer.placeId)) {
    throw new Error('Actor no participa en escena activa');
  }
  const currentPlace = placeById(snapshot, observer.placeId);
  if (currentPlace === undefined) throw new Error('Lugar actual desconocido');
  const currentPlaceBinding = addPlaceBinding(knowledge, currentPlace.id, input.ids);
  knowledge = currentPlaceBinding.knowledge;
  const accessiblePlaces = accessibleScenePlaces(snapshot, observer, scene);
  const places: z.infer<typeof ActorWorldViewSchema>['places'] = [];
  const visiblePlaceHandles = new Map<z.infer<typeof PlaceIdSchema>, z.infer<typeof PlaceHandleSchema>>();
  for (const [placeId, connection] of accessiblePlaces) {
    const place = placeById(snapshot, placeId);
    if (place === undefined) continue;
    const binding = addPlaceBinding(knowledge, place.id, input.ids);
    knowledge = binding.knowledge;
    visiblePlaceHandles.set(place.id, binding.handle);
    places.push({
      handle: binding.handle, name: place.name, description: place.description, lighting: place.lighting,
      movement: connection === undefined
        ? { kind: 'here' }
        : { kind: 'move', durationMs: connection.durationMs, availability: movementAvailability(snapshot, observer, scene, connection) },
    });
  }
  const inventory: ActorWorldView['self']['inventory'] = [];
  for (const entry of snapshot.inventory) {
    if (entry.location.kind !== 'heldBy' || entry.location.entityId !== observer.entityId) continue;
    const object = entityById(snapshot, entry.objectEntityId);
    if (object?.kind !== 'object') continue;
    const binding = addEntityBinding(knowledge, object.entityId, input.ids);
    knowledge = binding.knowledge;
    inventory.push({ handle: binding.handle, label: observer.mind.inventoryKnowledge?.find((item) => item.objectEntityId === object.entityId)?.name ?? object.label, description: observer.mind.inventoryKnowledge?.find((item) => item.objectEntityId === object.entityId)?.description ?? object.description, portable: object.portable, ...(object.quantity === undefined ? {} : { quantity: object.quantity }), ...(object.condition === undefined ? {} : { condition: object.condition }) });
  }
  const entities: z.infer<typeof ActorWorldViewSchema>['entities'] = [];
  for (const entity of snapshot.entities) {
    if (!entityWithinScene(snapshot, scene, entity)) continue;
    const modalities = entityModalities(snapshot, observer, entity);
    const projected = actorViewEntity(snapshot, observer, scene, entity, modalities, knowledge, input.ids, visiblePlaceHandles);
    knowledge = projected.knowledge;
    if (projected.entity !== undefined) entities.push(projected.entity);
  }
  const channels: z.infer<typeof ActorWorldViewSchema>['channels'] = [];
  for (const channel of snapshot.channels) {
    if (!channel.enabled || !channel.placeIds.includes(observer.placeId)) continue;
    const supported = channel.kind === 'speech'
      ? observer.capabilities.includes('speak')
      : channel.modality === 'auditory'
        ? observer.capabilities.includes('animalSound') || observer.capabilities.includes('gesture')
        : observer.capabilities.includes('gesture');
    if (!supported) continue;
    const binding = addChannelBinding(knowledge, channel.id, input.ids);
    knowledge = binding.knowledge;
    channels.push({ handle: binding.handle, kind: channel.kind, label: channel.label });
  }
  const offers: z.infer<typeof ActorWorldViewSchema>['offers'] = [];
  const inbox: z.infer<typeof ActorWorldViewSchema>['inbox'] = [];
  for (const perception of pendingPerceptions) {
    if (perception.runId !== snapshot.runId || perception.recipientCharacterId !== actorId) continue;
    switch (perception.kind) {
      case 'observation': {
        const subject = entityById(snapshot, perception.subjectEntityId);
        if (subject === undefined) break;
        const binding = addEntityBinding(knowledge, subject.entityId, input.ids);
        knowledge = binding.knowledge;
        inbox.push({ kind: 'observation', subjectHandle: binding.handle, modality: perception.modality, detail: perception.detail, fictitiousAt: perception.fictitiousAt });
        break;
      }
      case 'communication': {
        const speaker = entityById(snapshot, perception.sourceEntityId);
        const channel = snapshot.channels.find((item) => item.id === perception.channelId);
        if (speaker === undefined || channel === undefined) break;
        const binding = addEntityBinding(knowledge, speaker.entityId, input.ids);
        knowledge = binding.knowledge;
        const channelLabel = channel.label;
        let targetHandle: z.infer<typeof EntityHandleSchema> | null = null;
        if (perception.targetEntityId !== null) {
          const targetBinding = addEntityBinding(knowledge, perception.targetEntityId, input.ids);
          knowledge = targetBinding.knowledge;
          targetHandle = targetBinding.handle;
        }
        let content = perception.content;
        if (content.kind === 'gesture' && content.gesture.kind === 'point') {
          if (targetHandle === null) break;
          content = CommunicationContentSchema.parse({ kind: 'gesture', gesture: { kind: 'point', targetHandle } });
        }
        inbox.push({ kind: 'communication', speakerHandle: binding.handle, channelLabel, content, targetHandle, fictitiousAt: perception.fictitiousAt });
        break;
      }
      case 'testimony': {
        const channel = snapshot.channels.find((item) => item.id === perception.channelId);
        if (channel?.kind !== 'speech' || !channel.enabled) break;
        inbox.push({
          kind: 'testimony', speakerDisplayName: perception.speakerDisplayName,
          channelLabel: channel.label, content: perception.content, fictitiousAt: perception.fictitiousAt,
        });
        break;
      }
      case 'offer': {
        const offer = snapshot.offers.find((item): item is Extract<WorldOffer, { state: 'open' }> => item.id === perception.offerId && item.state === 'open');
        const giver = entityById(snapshot, perception.sourceEntityId);
        const object = entityById(snapshot, perception.objectEntityId);
        if (offer === undefined || offer.recipientCharacterId !== actorId || offer.expiresAt <= snapshot.clock.instant
          || offer.handle !== perception.offerHandle || giver?.kind !== 'character' || object?.kind !== 'object') break;
        knowledge = addOfferBinding(knowledge, offer);
        const giverBinding = addEntityBinding(knowledge, giver.entityId, input.ids);
        knowledge = giverBinding.knowledge;
        const objectBinding = addEntityBinding(knowledge, object.entityId, input.ids);
        knowledge = objectBinding.knowledge;
        inbox.push({ kind: 'offer', offerHandle: offer.handle, fromHandle: giverBinding.handle, objectHandle: objectBinding.handle, objectLabel: object.label, expiresAt: offer.expiresAt });
        offers.push({ handle: offer.handle, objectHandle: objectBinding.handle, objectLabel: object.label, fromHandle: giverBinding.handle, expiresAt: offer.expiresAt });
        break;
      }
      case 'worldEvent': {
        const source = entityById(snapshot, perception.sourceEntityId);
        if (source === undefined) break;
        const binding = addEntityBinding(knowledge, source.entityId, input.ids);
        knowledge = binding.knowledge;
        inbox.push({ kind: 'worldEvent', sourceHandle: binding.handle, modality: perception.modality, detail: perception.detail, fictitiousAt: perception.fictitiousAt });
        break;
      }
      case 'circumstance': {
        const binding = addPlaceBinding(knowledge, perception.placeId, input.ids);
        knowledge = binding.knowledge;
        inbox.push({ kind: 'circumstance', placeHandle: binding.handle, modality: perception.modality,
          detail: perception.detail, fictitiousAt: perception.fictitiousAt });
        break;
      }
      default: {
        const exhaustive: never = perception;
        void exhaustive;
      }
    }
  }
  const environment: NonNullable<ActorWorldView['environment']> = [];
  for (const current of snapshot.environment ?? []) {
    const place = placeById(snapshot, current.placeId);
    const condition = snapshot.circumstanceCatalog?.environmentConditions.find((item) => item.id === current.conditionId);
    const state = condition?.states.find((item) => item.id === current.stateId);
    if (place === undefined || state === undefined || !canPerceiveCircumstanceAt({ snapshot,
      source: { placeId: place.id, position: { x: place.width / 2, y: place.height / 2 } },
      recipientCharacterId: actorId, modality: state.modality })) continue;
    const binding = addPlaceBinding(knowledge, place.id, input.ids);
    knowledge = binding.knowledge;
    environment.push({ placeHandle: binding.handle, modality: state.modality, detail: state.description });
  }
  const view = CompleteActorWorldViewSchema.parse({
    kind: 'actor-world-view', revision: snapshot.revision, now: { instant: snapshot.clock.instant, convention: snapshot.clock.convention }, sceneLabel: scene.label,
    currentPlace: { handle: currentPlaceBinding.handle, name: currentPlace.name, description: currentPlace.description, lighting: currentPlace.lighting },
    places,
    self: {
      displayName: observer.trueDisplayName, position: observer.position, capabilities: observer.capabilities,
      effectiveAvailability: actorCanAct(observer, snapshot, scene) ? 'available' : 'unavailable',
      routine: observer.routine, inventory, actionDurations: snapshot.actionDurations,
      goals: observer.mind.goals.map((goal) => ({ id: goal.id, kind: goal.kind,
        ...(goal.reviewConditions === undefined ? {} : { reviewConditions: goal.reviewConditions.filter((condition) => condition.kind === 'circumstance') }),
        ...(goal.kind !== 'shared' || goal.ownMotivation === undefined ? {} : { ownMotivation: goal.ownMotivation }),
        description: goal.description, priority: goal.priority, state: goal.state, revision: goal.revision })),
      beliefs: observer.mind.beliefs.map((belief) => ({ experienceId: belief.experienceId, content: belief.content, confidence: belief.confidence })),
      ...(observer.mind.relationshipDescriptions === undefined ? {} : { relationshipDescriptions: observer.mind.relationshipDescriptions }),
      relationships: observer.mind.relationships.map((relationship) => ({ targetHandle: relationship.targetHandle, stance: relationship.stance, confidence: relationship.confidence, revision: relationship.revision })),
      experiences: observer.mind.experiences.map((experience) => ({ experienceId: experience.experienceId, kind: experience.kind, content: experience.content, fictitiousAt: experience.fictitiousAt, confidence: experience.confidence })),
    },
    entities, channels, offers, inbox,
    ...(environment.length === 0 ? {} : { environment }),
  });
  return { view, knowledge: ActorKnowledgeSchema.parse(knowledge) };
}

type SnapshotChanges = Partial<Pick<WorldSnapshot, 'entities' | 'inventory' | 'places' | 'offers'>>;

function entityBindingForHandle(knowledge: ActorKnowledge, handle: z.infer<typeof EntityHandleSchema>): z.infer<typeof WorldEntityIdSchema> | undefined {
  const binding = knowledge.bindings.find((candidate) => candidate.kind === 'entity' && candidate.handle === handle);
  return binding?.kind === 'entity' ? binding.entityId : undefined;
}

function placeBindingForHandle(knowledge: ActorKnowledge, handle: z.infer<typeof PlaceHandleSchema>): z.infer<typeof PlaceIdSchema> | undefined {
  const binding = knowledge.bindings.find((candidate) => candidate.kind === 'place' && candidate.handle === handle);
  return binding?.kind === 'place' ? binding.placeId : undefined;
}

function channelBindingForHandle(knowledge: ActorKnowledge, handle: z.infer<typeof ChannelHandleSchema>): z.infer<typeof ChannelIdSchema> | undefined {
  const binding = knowledge.bindings.find((candidate) => candidate.kind === 'channel' && candidate.handle === handle);
  return binding?.kind === 'channel' ? binding.channelId : undefined;
}

function offerBindingForHandle(knowledge: ActorKnowledge, handle: z.infer<typeof OfferHandleSchema>): z.infer<typeof OfferIdSchema> | undefined {
  const binding = knowledge.bindings.find((candidate) => candidate.kind === 'offer' && candidate.handle === handle);
  return binding?.kind === 'offer' ? binding.offerId : undefined;
}

function hasCapability(actor: WorldCharacter, capability: z.infer<typeof CharacterCapabilitySchema>): boolean {
  return actor.capabilities.includes(capability);
}

function actorCanAct(actor: WorldCharacter, world: WorldSnapshot, scene: WorldScene): boolean {
  return actor.preparation.kind === 'prepared' && actor.presence.kind === 'present' && actor.presence.sceneId === scene.id &&
    scene.lifecycle.kind === 'open' && scene.participantIds.includes(actor.characterId) && scene.placeIds.includes(actor.placeId) &&
    actor.availability.kind === 'available' && routineIsAvailable({routine:actor.routine,clock:world.clock});
}

function locationOfCharacter(actor: WorldCharacter): { placeId: z.infer<typeof PlaceIdSchema>; position: z.infer<typeof WorldPointSchema> } {
  return { placeId: actor.placeId, position: actor.position };
}

function canInteract(world: WorldSnapshot, actor: WorldCharacter, target: WorldEntity): boolean {
  const targetLocation = entityLocation(world, target);
  return targetLocation !== undefined && targetLocation.placeId === actor.placeId &&
    distance(locationOfCharacter(actor).position, targetLocation.position) <= world.actionDurations.interactionRange;
}

function clockAfter(world: WorldSnapshot, durationMs: number): number | undefined {
  const result = FictionalInstantSchema.safeParse(world.clock.instant + durationMs);
  return result.success ? result.data : undefined;
}

function nextEventBase(input: {
  world: WorldSnapshot;
  actorId: z.infer<typeof CharacterIdSchema>;
  attemptId: z.infer<typeof WorldAttemptIdSchema>;
  ids: WorldIdSource;
  eventCount: number;
  at: number;
  durationMs: number;
  origin?: 'actor' | 'system';
}) {
  const origin = input.origin ?? 'actor';
  return {
    id: EventIdSchema.parse(input.ids.eventId()),
    runId: input.world.runId,
    seq: WorldSeqSchema.parse(input.world.seq + input.eventCount + 1),
    origin: origin === 'actor'
      ? { kind: 'actor' as const, actorId: input.actorId, attemptId: input.attemptId }
      : { kind: 'system' as const, causeAttemptId: input.attemptId },
    fictitiousAt: FictionalInstantSchema.parse(input.at),
    durationMs: WorldDurationMsSchema.parse(input.durationMs),
  };
}

function commitApplied(input: {
  world: WorldSnapshot;
  attempt: WorldAttempt;
  ids: WorldIdSource;
  events: WorldEvent[];
  perceptions: WorldPerception[];
  changes?: SnapshotChanges;
  endAt: number;
  stateChanged: boolean;
  emission?: z.infer<typeof WorldEmissionSchema>;
}): WorldResolution {
  const events = [...input.events];
  let offers = input.changes?.offers ?? input.world.offers;
  const expired = offers.filter((offer): offer is Extract<WorldOffer, { state: 'open' }> => offer.state === 'open' && offer.expiresAt <= input.endAt)
    .sort((left, right) => left.expiresAt - right.expiresAt || left.id.localeCompare(right.id));
  for (const offer of expired) {
    const base = nextEventBase({
      world: input.world, actorId: input.attempt.actorId, ids: input.ids,
      attemptId: input.attempt.attemptId,
      eventCount: events.length, at: offer.expiresAt, durationMs: 0, origin: 'system',
    });
    const event = WorldEventSchema.parse({
      ...base, kind: 'offerInvalidated', offerId: offer.id, objectEntityId: offer.objectEntityId, cause: 'expired',
    });
    events.push(event);
    offers = offers.map((current) => current.id === offer.id && current.state === 'open'
      ? WorldOfferSchema.parse({ ...current, state: 'invalidated', cause: 'expired', eventId: event.id })
      : current);
  }
  const clock = input.endAt === input.world.clock.instant
    ? input.world.clock
    : WorldClockSchema.parse({ ...input.world.clock, instant: input.endAt });
  const revision = input.stateChanged || events.length > 0 || input.endAt !== input.world.clock.instant
    ? RevisionSchema.parse(input.world.revision + 1)
    : input.world.revision;
  const newSnapshot = WorldSnapshotSchema.parse({
    ...input.world,
    ...input.changes,
    offers,
    clock,
    revision,
    seq: WorldSeqSchema.parse(input.world.seq + events.length),
  });
  return WorldResolutionSchema.parse({
    kind: 'applied', attemptId: input.attempt.attemptId,
    baseRevision: input.world.revision, revision, events, perceptions: input.perceptions,
    emission: input.emission ?? { kind: 'none' }, newSnapshot,
  });
}

function notApplied(world: WorldSnapshot, attempt: WorldAttempt, reason: z.infer<typeof ResolutionReasonSchema>): WorldResolution {
  return WorldResolutionSchema.parse({
    kind: 'notApplied', attemptId: attempt.attemptId, revision: world.revision, reason,
    events: [], perceptions: [], emission: { kind: 'none' }, newSnapshot: world,
  });
}

function stale(world: WorldSnapshot, attempt: WorldAttempt): WorldResolution {
  return WorldResolutionSchema.parse({
    kind: 'stale', attemptId: attempt.attemptId, expectedRevision: attempt.expectedRevision,
    currentRevision: world.revision, events: [], perceptions: [], emission: { kind: 'none' }, newSnapshot: world,
  });
}

function validateEvidence(actor: WorldCharacter, ids: readonly z.infer<typeof ExperienceIdSchema>[]): boolean {
  const available = new Set(actor.mind.experiences.map((experience) => experience.experienceId));
  return ids.every((id) => available.has(id));
}

function makeExperience(input: {
  world: WorldSnapshot;
  actor: WorldCharacter;
  ids: WorldIdSource;
  content: string;
  confidence: number;
  basedOn: z.infer<typeof ExperienceIdSchema>[];
  revision: number;
  predecessor: Experience['predecessor'];
}): Experience {
  return ExperienceSchema.parse({
    schemaVersion: 1,
    experienceId: input.ids.experienceId(),
    runId: input.world.runId,
    actorId: input.actor.characterId,
    kind: 'belief',
    content: input.content,
    sourceRefs: [],
    fictitiousAt: input.world.clock.instant,
    receivedAt: input.world.clock.instant,
    worldSeq: input.world.seq,
    confidence: input.confidence,
    revision: input.revision,
    predecessor: input.predecessor,
    basedOn: input.basedOn,
  });
}

function availabilityForPerception(character: WorldCharacter, at: number, world: WorldSnapshot): boolean {
  return character.availability.kind === 'available' && routineIsAvailable({routine:character.routine,clock:world.clock,instant:at});
}

/** Whether a prepared scene participant can receive a new perception at this fictional instant. */
export function characterCanReceiveAt(input: { snapshot: unknown; characterId: unknown; instant?: unknown }): boolean {
  const world = WorldSnapshotSchema.parse(input.snapshot);
  const characterId = CharacterIdSchema.parse(input.characterId);
  const instant = input.instant === undefined ? world.clock.instant : FictionalInstantSchema.parse(input.instant);
  const character = world.entities.find((entity): entity is WorldCharacter => entity.kind === 'character' && entity.characterId === characterId);
  const scene = world.scenes.find((candidate) => candidate.id === world.activeSceneId);
  return character !== undefined && scene !== undefined && scene.lifecycle.kind === 'open'
    && scene.participantIds.includes(characterId) && character.presence.kind === 'present'
    && character.presence.sceneId === scene.id && scene.placeIds.includes(character.placeId)
    && availabilityForPerception(character, instant, world);
}

function speechModality(content: CommunicationContent): z.infer<typeof ModalitySchema> {
  if (content.kind === 'speech') return 'auditory';
  switch (content.gesture.kind) {
    case 'bark':
    case 'whine': return 'auditory';
    case 'wave':
    case 'point':
    case 'nod':
    case 'shakeHead':
    case 'posture': return 'visual';
    default: {
      const exhaustive: never = content.gesture;
      return exhaustive;
    }
  }
}

function eventPerception(input: {
  world: WorldSnapshot;
  event: WorldEvent;
  actor: WorldCharacter;
  recipient: WorldCharacter;
  modality: z.infer<typeof ModalitySchema>;
  detail: string;
  ids: WorldIdSource;
}): WorldPerception {
  return WorldPerceptionSchema.parse({
    kind: 'worldEvent', id: PerceptionIdSchema.parse(input.ids.perceptionId()),
    runId: input.world.runId, recipientCharacterId: input.recipient.characterId,
    eventId: input.event.id, sourceEntityId: input.actor.entityId, modality: input.modality,
    detail: input.detail, fictitiousAt: input.event.fictitiousAt,
  });
}

function visibleWitnesses(input: {
  world: WorldSnapshot;
  actor: WorldCharacter;
  at: number;
  ids: WorldIdSource;
  event: WorldEvent;
  detail: string;
}): WorldPerception[] {
  const scene = input.world.scenes.find((candidate) => candidate.id === input.world.activeSceneId);
  if (scene === undefined) return [];
  const sourceLocation = { placeId: input.actor.placeId, position: input.actor.position };
  const output: WorldPerception[] = [];
  for (const characterId of scene.participantIds) {
    if (characterId === input.actor.characterId) continue;
    const recipient = characterById(input.world, characterId);
    if (recipient === undefined || recipient.presence.kind !== 'present' || recipient.presence.sceneId !== scene.id || !availabilityForPerception(recipient, input.at, input.world)) continue;
    const modality = isVisuallyReachable(input.world, locationOfCharacter(recipient), sourceLocation) ? 'visual' : undefined;
    if (modality !== undefined) output.push(eventPerception({ ...input, recipient, modality, detail: input.detail }));
  }
  return output;
}

function requestedAudience(input: {
  attempt: Extract<WorldAttempt, { kind: 'communicate' }>;
  knowledge: ActorKnowledge;
  world: WorldSnapshot;
  channel: WorldChannel;
}): { kind: 'valid'; requested: z.infer<typeof CharacterIdSchema>[]; candidates: WorldCharacter[] } | { kind: 'invalid' } {
  const requested: z.infer<typeof CharacterIdSchema>[] = [];
  for (const handle of input.attempt.audienceHandles) {
    const entityId = entityBindingForHandle(input.knowledge, handle);
    if (entityId === undefined) return { kind: 'invalid' };
    const entity = entityById(input.world, entityId);
    if (entity?.kind !== 'character' || requested.includes(entity.characterId)) return { kind: 'invalid' };
    requested.push(entity.characterId);
  }
  const scene = input.world.scenes.find((candidate) => candidate.id === input.world.activeSceneId);
  if (scene === undefined) return { kind: 'invalid' };
  if (input.channel.scope === 'addressed' && requested.length === 0) return { kind: 'invalid' };
  if (input.channel.scope === 'broadcast' && requested.length > 0) return { kind: 'invalid' };
  const requestedAudience = input.channel.scope === 'broadcast'
    ? scene.participantIds.filter((id) => id !== input.attempt.actorId)
    : requested;
  const potential = requestedAudience;
  const actor = characterById(input.world, input.attempt.actorId);
  if (actor === undefined) return { kind: 'invalid' };
  const channelModality = input.channel.kind === 'speech' ? 'auditory' : input.channel.modality;
  const candidates = potential.flatMap((id) => {
    const recipient = characterById(input.world, id);
    if (recipient === undefined || recipient.presence.kind !== 'present' || recipient.presence.sceneId !== scene.id ||
        !availabilityForPerception(recipient, input.world.clock.instant, input.world)) return [];
    const audible = canPerceive(
      input.world, locationOfCharacter(actor), locationOfCharacter(recipient), channelModality, input.channel,
    );
    return audible ? [recipient] : [];
  });
  return { kind: 'valid', requested: requestedAudience, candidates };
}

function updateCharacter(world: WorldSnapshot, character: WorldCharacter): WorldEntity[] {
  return world.entities.map((entity) => entity.entityId === character.entityId ? character : entity);
}

function changeInventory(world: WorldSnapshot, objectEntityId: z.infer<typeof WorldEntityIdSchema>, location: InventoryEntry['location']): InventoryEntry[] {
  return world.inventory.map((entry) => entry.objectEntityId === objectEntityId
    ? InventoryEntrySchema.parse({ ...entry, location, revision: RevisionSchema.parse(entry.revision + 1) })
    : entry);
}

function pointGestureTarget(content: CommunicationContent, knowledge: ActorKnowledge): z.infer<typeof WorldEntityIdSchema> | null | 'invalid' {
  if (content.kind !== 'gesture' || content.gesture.kind !== 'point') return null;
  return entityBindingForHandle(knowledge, content.gesture.targetHandle) ?? 'invalid';
}

export function resolveWorldAttempt(input: {
  snapshot: unknown;
  attempt: unknown;
  actorKnowledge: unknown;
  approvalReceipt?: unknown;
  ids: WorldIdSource;
}): WorldResolution {
  const world = WorldSnapshotSchema.parse(input.snapshot);
  const attempt = WorldAttemptSchema.parse(input.attempt);
  const knowledge = ActorKnowledgeSchema.parse(input.actorKnowledge);
  if (knowledge.runId !== world.runId || knowledge.actorId !== attempt.actorId) throw new Error('ActorKnowledge no corresponde a la corrida/actor');
  if (attempt.runId !== world.runId) return notApplied(world, attempt, 'run-mismatch');
  if (attempt.expectedRevision !== world.revision) return stale(world, attempt);
  const scene = world.scenes.find((candidate) => candidate.id === world.activeSceneId);
  if (scene === undefined || scene.lifecycle.kind !== 'open') return notApplied(world, attempt, 'scene-not-open');
  const actor = characterById(world, attempt.actorId);
  if (actor === undefined) return notApplied(world, attempt, 'actor-not-found');
  if (actor.preparation.kind !== 'prepared') return notApplied(world, attempt, 'actor-not-prepared');
  if (!actorCanAct(actor, world, scene)) return notApplied(world, attempt, 'actor-unavailable');
  const getEntity = (handle: z.infer<typeof EntityHandleSchema>): WorldEntity | undefined => {
    const entityId = entityBindingForHandle(knowledge, handle);
    return entityId === undefined ? undefined : entityById(world, entityId);
  };

  switch (attempt.kind) {
    case 'observe': {
      if (!hasCapability(actor, 'observe')) return notApplied(world, attempt, 'capability-missing');
      const target = getEntity(attempt.target.targetHandle);
      if (target === undefined) return notApplied(world, attempt, 'unknown-handle');
      let modality: z.infer<typeof ModalitySchema> = attempt.target.modality;
      let channel: WorldChannel | undefined;
      if (attempt.target.modality === 'auditory') {
        const channelId = channelBindingForHandle(knowledge, attempt.target.channelHandle);
        channel = world.channels.find((item) => item.id === channelId);
        const supportsAuditoryObservation = channel?.kind === 'speech' || (channel?.kind === 'gesture' && channel.modality === 'auditory');
        if (channel === undefined || !channel.enabled || !supportsAuditoryObservation || !channel.placeIds.includes(actor.placeId)) {
          return notApplied(world, attempt, 'channel-unavailable');
        }
      }
      const targetLocation = entityLocation(world, target);
      if (!entityWithinScene(world, scene, target) || targetLocation === undefined || !canPerceive(world, locationOfCharacter(actor), targetLocation, modality, channel)) {
        return notApplied(world, attempt, 'target-not-perceptible');
      }
      const endAt = clockAfter(world, world.actionDurations.observeMs);
      if (endAt === undefined) return notApplied(world, attempt, 'clock-overflow');
      const detail = modality === 'auditory'
        ? 'La escucha no confirma una emisión audible del sujeto en este corte.'
        : target.kind === 'character'
          ? `${characterIdentityFor(actor, target).label} está en ${placeById(world, targetLocation.placeId)?.name ?? 'un lugar conocido'}.`
          : `${target.label}: ${target.description}`;
      const perception = WorldPerceptionSchema.parse({
        kind: 'observation', id: PerceptionIdSchema.parse(input.ids.perceptionId()),
        runId: world.runId, recipientCharacterId: actor.characterId, attemptId: attempt.attemptId, subjectEntityId: target.entityId,
        modality, detail, fictitiousAt: world.clock.instant,
      });
      return commitApplied({
        world, attempt, ids: input.ids, events: [], perceptions: [perception],
        endAt, stateChanged: false,
      });
    }
    case 'move': {
      if (!hasCapability(actor, 'move')) return notApplied(world, attempt, 'capability-missing');
      const destinationId = placeBindingForHandle(knowledge, attempt.destinationHandle);
      if (destinationId === undefined) return notApplied(world, attempt, 'unknown-handle');
      if (!scene.placeIds.includes(destinationId)) return notApplied(world, attempt, 'outside-scene');
      const connection = world.connections.find((candidate) => candidate.from === actor.placeId && candidate.to === destinationId);
      if (connection === undefined) return notApplied(world, attempt, 'destination-not-connected');
      if (connection.doorId !== null) {
        const door = doorById(world, connection.doorId);
        if (door === undefined || door.state !== 'open') return notApplied(world, attempt, 'door-blocked');
      }
      if (arrivalCollides(world, actor, destinationId, connection.arrivalPoint)) return notApplied(world, attempt, 'collision');
      const endAt = clockAfter(world, connection.durationMs);
      if (endAt === undefined) return notApplied(world, attempt, 'clock-overflow');
      const base = nextEventBase({ world, actorId: actor.characterId, attemptId: attempt.attemptId, ids: input.ids, eventCount: 0, at: world.clock.instant, durationMs: connection.durationMs });
      const event = WorldEventSchema.parse({
        ...base, kind: 'moved', entityId: actor.entityId, from: actor.placeId, to: destinationId,
        arrivalPoint: connection.arrivalPoint,
      });
      const movedActor = WorldCharacterSchema.parse({ ...actor, placeId: destinationId, position: connection.arrivalPoint });
      const entities = updateCharacter(world, movedActor);
      const changedWorld = WorldSnapshotSchema.parse({ ...world, entities });
      const perceptions = visibleWitnesses({
        world: changedWorld, event, actor: movedActor, at: world.clock.instant,
        ids: input.ids, detail: `Movimiento hacia ${placeById(world, destinationId)?.name ?? 'otro lugar'}.`,
      });
      return commitApplied({ world, attempt, ids: input.ids, events: [event], perceptions, changes: { entities }, endAt, stateChanged: true });
    }
    case 'communicate': {
      const expectedHash = hashCommunicationContent(attempt.content);
      const approvalResult = WorldContentApprovalReceiptSchema.safeParse(input.approvalReceipt);
      if (!approvalResult.success) return notApplied(world, attempt, 'approval-receipt-invalid');
      const approval = approvalResult.data;
      if (approval.runId !== world.runId || approval.actorId !== actor.characterId
        || approval.stateRevision !== world.revision || approval.stateRevision !== attempt.expectedRevision
        || approval.exactContentHash !== expectedHash) {
        return notApplied(world, attempt, 'approval-receipt-invalid');
      }
      const channelId = channelBindingForHandle(knowledge, attempt.channelHandle);
      const channel = world.channels.find((candidate) => candidate.id === channelId);
      if (channel === undefined || !channel.enabled || !channel.placeIds.includes(actor.placeId)) return notApplied(world, attempt, 'channel-unavailable');
      const modality = speechModality(attempt.content);
      if ((attempt.content.kind === 'speech' && channel.kind !== 'speech') || (attempt.content.kind === 'gesture' && channel.kind !== 'gesture')) {
        return notApplied(world, attempt, 'channel-kind-mismatch');
      }
      if (channel.kind === 'speech' && modality !== 'auditory') return notApplied(world, attempt, 'content-not-supported');
      if (channel.kind === 'gesture' && channel.modality !== modality) return notApplied(world, attempt, 'content-not-supported');
      if (attempt.content.kind === 'speech' && (!hasCapability(actor, 'speak') || actor.species === 'animal')) return notApplied(world, attempt, 'capability-missing');
      if (attempt.content.kind === 'gesture') {
        const animalSound = attempt.content.gesture.kind === 'bark' || attempt.content.gesture.kind === 'whine';
        if (animalSound ? !hasCapability(actor, 'animalSound') : !hasCapability(actor, 'gesture')) return notApplied(world, attempt, 'capability-missing');
      }
      const audience = requestedAudience({ attempt, knowledge, world, channel });
      if (audience.kind === 'invalid') return notApplied(world, attempt, 'audience-invalid');
      const pointTarget = pointGestureTarget(attempt.content, knowledge);
      if (pointTarget === 'invalid') return notApplied(world, attempt, 'unknown-handle');
      if (pointTarget !== null) {
        const target = entityById(world, pointTarget);
        const targetLocation = target === undefined ? undefined : entityLocation(world, target);
        if (target === undefined || !entityWithinScene(world, scene, target) || targetLocation === undefined
          || !canPerceive(world, locationOfCharacter(actor), targetLocation, 'visual', channel)) {
          return notApplied(world, attempt, 'target-not-perceptible');
        }
      }
      const durationMs = attempt.content.kind === 'speech' ? world.actionDurations.speechMs : world.actionDurations.gestureMs;
      const endAt = clockAfter(world, durationMs);
      if (endAt === undefined) return notApplied(world, attempt, 'clock-overflow');
      const effectiveRecipients = audience.candidates.filter((recipient) => pointTarget === null || (() => {
        const target = entityById(world, pointTarget);
        const targetLocation = target === undefined ? undefined : entityLocation(world, target);
        return targetLocation !== undefined && canPerceive(world, locationOfCharacter(recipient), targetLocation, 'visual', channel);
      })());
      const base = nextEventBase({ world, actorId: actor.characterId, attemptId: attempt.attemptId, ids: input.ids, eventCount: 0, at: world.clock.instant, durationMs });
      const event = WorldEventSchema.parse({
        ...base, kind: 'communicated', entityId: actor.entityId, channelId: channel.id,
        content: attempt.content, approvedContentHash: expectedHash, requestedAudience: audience.requested,
        effectiveAudience: effectiveRecipients.map((recipient) => recipient.characterId),
        targetEntityId: pointTarget,
      });
      const perceptions = effectiveRecipients.map((recipient) => WorldPerceptionSchema.parse({
        kind: 'communication', id: PerceptionIdSchema.parse(input.ids.perceptionId()),
        runId: world.runId, recipientCharacterId: recipient.characterId, eventId: event.id,
        sourceEntityId: actor.entityId, channelId: channel.id, content: attempt.content,
        targetEntityId: pointTarget, fictitiousAt: endAt,
      }));
      return commitApplied({
        world, attempt, ids: input.ids, events: [event], perceptions, endAt,
        stateChanged: true, emission: { kind: 'emitted', eventId: event.id },
      });
    }
    case 'take': {
      if (!hasCapability(actor, 'take')) return notApplied(world, attempt, 'capability-missing');
      const object = getEntity(attempt.objectHandle);
      if (object === undefined) return notApplied(world, attempt, 'unknown-handle');
      if (object.kind !== 'object') return notApplied(world, attempt, 'object-not-available');
      if (!object.portable) return notApplied(world, attempt, 'object-not-portable');
      const entry = world.inventory.find((candidate) => candidate.objectEntityId === object.entityId);
      if (entry?.location.kind !== 'atPlace') return notApplied(world, attempt, 'object-not-available');
      if (entry.location.placeId !== actor.placeId) return notApplied(world, attempt, 'object-not-available');
      if (distance(actor.position, entry.location.position) > world.actionDurations.interactionRange) return notApplied(world, attempt, 'out-of-reach');
      const durationMs = world.actionDurations.takeMs;
      const endAt = clockAfter(world, durationMs);
      if (endAt === undefined) return notApplied(world, attempt, 'clock-overflow');
      const base = nextEventBase({ world, actorId: actor.characterId, attemptId: attempt.attemptId, ids: input.ids, eventCount: 0, at: world.clock.instant, durationMs });
      const event = WorldEventSchema.parse({ ...base, kind: 'objectTaken', objectEntityId: object.entityId, from: entry.location.placeId, toHolderEntityId: actor.entityId });
      const inventory = changeInventory(world, object.entityId, { kind: 'heldBy', entityId: actor.entityId });
      const perceptions = visibleWitnesses({ world, event, actor, at: world.clock.instant, ids: input.ids, detail: `Tomó ${object.label}.` });
      return commitApplied({ world, attempt, ids: input.ids, events: [event], perceptions, changes: { inventory }, endAt, stateChanged: true });
    }
    case 'offer': {
      if (!hasCapability(actor, 'offer')) return notApplied(world, attempt, 'capability-missing');
      const object = getEntity(attempt.objectHandle);
      const recipientEntity = getEntity(attempt.recipientHandle);
      if (object === undefined || recipientEntity === undefined) return notApplied(world, attempt, 'unknown-handle');
      if (object.kind !== 'object' || !object.portable) return notApplied(world, attempt, object.kind === 'object' ? 'object-not-portable' : 'object-not-available');
      if (recipientEntity.kind !== 'character' || recipientEntity.characterId === actor.characterId) return notApplied(world, attempt, 'audience-invalid');
      const inventoryEntry = world.inventory.find((entry) => entry.objectEntityId === object.entityId);
      if (inventoryEntry?.location.kind !== 'heldBy' || inventoryEntry.location.entityId !== actor.entityId) return notApplied(world, attempt, 'object-not-available');
      if (!canInteract(world, actor, recipientEntity) || recipientEntity.presence.kind !== 'present' || recipientEntity.presence.sceneId !== scene.id || !availabilityForPerception(recipientEntity, world.clock.instant, world)) {
        return notApplied(world, attempt, 'target-not-perceptible');
      }
      const endAt = clockAfter(world, world.actionDurations.offerMs);
      if (endAt === undefined) return notApplied(world, attempt, 'clock-overflow');
      const expiresAt = FictionalInstantSchema.safeParse(endAt + world.actionDurations.offerValidityMs);
      if (!expiresAt.success) return notApplied(world, attempt, 'clock-overflow');
      const offerId = OfferIdSchema.parse(input.ids.offerId());
      const handle = OfferHandleSchema.parse(input.ids.offerHandle());
      const base = nextEventBase({ world, actorId: actor.characterId, attemptId: attempt.attemptId, ids: input.ids, eventCount: 0, at: world.clock.instant, durationMs: world.actionDurations.offerMs });
      const event = WorldEventSchema.parse({
        ...base, kind: 'offerCreated', offerId, objectEntityId: object.entityId,
        ownerEntityId: actor.entityId, recipientCharacterId: recipientEntity.characterId, expiresAt: expiresAt.data,
      });
      const offer = WorldOfferSchema.parse({
        state: 'open', id: offerId, handle, objectEntityId: object.entityId,
        ownerEntityId: actor.entityId, recipientCharacterId: recipientEntity.characterId,
        objectRevision: inventoryEntry.revision, createdAt: world.clock.instant, expiresAt: expiresAt.data,
      });
      const perception = WorldPerceptionSchema.parse({
        kind: 'offer', id: PerceptionIdSchema.parse(input.ids.perceptionId()), runId: world.runId,
        recipientCharacterId: recipientEntity.characterId, eventId: event.id, offerId, offerHandle: handle,
        sourceEntityId: actor.entityId, objectEntityId: object.entityId, fictitiousAt: endAt,
      });
      return commitApplied({
        world, attempt, ids: input.ids, events: [event], perceptions: [perception],
        changes: { offers: [...world.offers, offer] }, endAt, stateChanged: true,
      });
    }
    case 'acceptOffer': {
      const offerId = offerBindingForHandle(knowledge, attempt.offerHandle);
      if (offerId === undefined) return notApplied(world, attempt, 'offer-not-received');
      const offer = world.offers.find((candidate) => candidate.id === offerId);
      if (offer === undefined || offer.state !== 'open') return notApplied(world, attempt, 'offer-not-open');
      if (offer.handle !== attempt.offerHandle) return notApplied(world, attempt, 'offer-not-received');
      if (offer.recipientCharacterId !== actor.characterId) return notApplied(world, attempt, 'offer-recipient-mismatch');
      if (offer.expiresAt <= world.clock.instant) return notApplied(world, attempt, 'offer-expired');
      const object = entityById(world, offer.objectEntityId);
      const owner = entityById(world, offer.ownerEntityId);
      if (object?.kind !== 'object' || owner?.kind !== 'character') return notApplied(world, attempt, 'object-not-available');
      const entry = world.inventory.find((candidate) => candidate.objectEntityId === object.entityId);
      if (entry?.location.kind !== 'heldBy' || entry.location.entityId !== owner.entityId || entry.revision !== offer.objectRevision) {
        return notApplied(world, attempt, 'offer-owner-changed');
      }
      if (!canInteract(world, actor, owner)) return notApplied(world, attempt, 'out-of-reach');
      const endAt = clockAfter(world, world.actionDurations.acceptOfferMs);
      if (endAt === undefined) return notApplied(world, attempt, 'clock-overflow');
      const acceptedBase = nextEventBase({ world, actorId: actor.characterId, attemptId: attempt.attemptId, ids: input.ids, eventCount: 0, at: world.clock.instant, durationMs: world.actionDurations.acceptOfferMs });
      const acceptedEvent = WorldEventSchema.parse({
        ...acceptedBase, kind: 'offerAccepted', offerId: offer.id,
        objectEntityId: object.entityId, fromHolderEntityId: owner.entityId, toHolderEntityId: actor.entityId,
      });
      const inventory = changeInventory(world, object.entityId, { kind: 'heldBy', entityId: actor.entityId });
      let offers: WorldOffer[] = world.offers.map((current) => current.id === offer.id
        ? WorldOfferSchema.parse({ ...current, state: 'accepted', eventId: acceptedEvent.id, objectRevision: RevisionSchema.parse(entry.revision + 1) })
        : current);
      const events = [acceptedEvent];
      const others = offers.filter((current): current is Extract<WorldOffer, { state: 'open' }> => current.state === 'open' && current.objectEntityId === object.entityId)
        .sort((left, right) => left.id.localeCompare(right.id));
      for (const incompatible of others) {
        const base = nextEventBase({ world, actorId: actor.characterId, attemptId: attempt.attemptId, ids: input.ids, eventCount: events.length, at: world.clock.instant, durationMs: 0 });
        const invalidation = WorldEventSchema.parse({ ...base, kind: 'offerInvalidated', offerId: incompatible.id, objectEntityId: object.entityId, cause: 'acceptedElsewhere' });
        events.push(invalidation);
        offers = offers.map((current) => current.id === incompatible.id && current.state === 'open'
          ? WorldOfferSchema.parse({ ...current, state: 'invalidated', cause: 'acceptedElsewhere', eventId: invalidation.id, objectRevision: RevisionSchema.parse(entry.revision + 1) })
          : current);
      }
      const perceptions = visibleWitnesses({
        world: WorldSnapshotSchema.parse({ ...world, inventory, offers }), event: acceptedEvent,
        actor, at: world.clock.instant, ids: input.ids, detail: `Aceptación de la oferta del objeto ${object.label}.`,
      });
      return commitApplied({ world, attempt, ids: input.ids, events, perceptions, changes: { inventory, offers }, endAt, stateChanged: true });
    }
    case 'useDevice': {
      if (!hasCapability(actor, 'useDevice')) return notApplied(world, attempt, 'capability-missing');
      const target = getEntity(attempt.deviceHandle);
      if (target === undefined) return notApplied(world, attempt, 'unknown-handle');
      if (target.kind !== 'device' || target.availability !== 'available') return notApplied(world, attempt, 'device-unavailable');
      if (!canInteract(world, actor, target)) return notApplied(world, attempt, 'out-of-reach');
      const operation = target.operations.find((candidate) => candidate.id === attempt.operationId);
      if (operation === undefined) return notApplied(world, attempt, 'operation-not-in-catalog');
      if (operation.kind === 'setLight' && !scene.placeIds.includes(operation.placeId)) {
        return notApplied(world, attempt, 'device-effect-outside-scene');
      }
      if (operation.kind === 'setLight' && !accessibleScenePlaces(world, actor, scene).has(operation.placeId)) {
        return notApplied(world, attempt, 'device-effect-not-accessible');
      }
      if (operation.kind === 'setLight' && target.power !== 'on') return notApplied(world, attempt, 'device-power-required');
      if (operation.kind === 'setPower') {
        if (target.power === operation.state) return notApplied(world, attempt, 'device-state-unchanged');
        const endAt = clockAfter(world, operation.durationMs);
        if (endAt === undefined) return notApplied(world, attempt, 'clock-overflow');
        const base = nextEventBase({ world, actorId: actor.characterId, attemptId: attempt.attemptId, ids: input.ids, eventCount: 0, at: world.clock.instant, durationMs: operation.durationMs });
        const event = WorldEventSchema.parse({ ...base, kind: 'deviceUsed', deviceEntityId: target.entityId, operationId: operation.id, effect: { kind: 'powerChanged', state: operation.state } });
        const entities = world.entities.map((entity) => entity.entityId === target.entityId && entity.kind === 'device'
          ? WorldDeviceSchema.parse({ ...entity, power: operation.state })
          : entity);
        const changedWorld = WorldSnapshotSchema.parse({ ...world, entities });
        const perceptions = visibleWitnesses({ world: changedWorld, event, actor, at: world.clock.instant, ids: input.ids, detail: `Usó ${target.label}: ${operation.label}.` });
        return commitApplied({ world, attempt, ids: input.ids, events: [event], perceptions, changes: { entities }, endAt, stateChanged: true });
      }
      const place = placeById(world, operation.placeId);
      if (place === undefined) return notApplied(world, attempt, 'operation-not-in-catalog');
      if (place.lighting === operation.level) return notApplied(world, attempt, 'device-state-unchanged');
      const endAt = clockAfter(world, operation.durationMs);
      if (endAt === undefined) return notApplied(world, attempt, 'clock-overflow');
      const base = nextEventBase({ world, actorId: actor.characterId, attemptId: attempt.attemptId, ids: input.ids, eventCount: 0, at: world.clock.instant, durationMs: operation.durationMs });
      const event = WorldEventSchema.parse({ ...base, kind: 'deviceUsed', deviceEntityId: target.entityId, operationId: operation.id, effect: { kind: 'lightChanged', placeId: place.id, level: operation.level } });
      const places = world.places.map((current) => current.id === place.id ? WorldPlaceSchema.parse({ ...current, lighting: operation.level }) : current);
      const changedWorld = WorldSnapshotSchema.parse({ ...world, places });
      const perceptions = visibleWitnesses({ world: changedWorld, event, actor, at: world.clock.instant, ids: input.ids, detail: `Usó ${target.label}: ${operation.label}.` });
      return commitApplied({ world, attempt, ids: input.ids, events: [event], perceptions, changes: { places }, endAt, stateChanged: true });
    }
    case 'wait':
    case 'rest': {
      const capability = attempt.kind === 'wait' ? 'wait' : 'rest';
      if (!hasCapability(actor, capability)) return notApplied(world, attempt, 'capability-missing');
      const limit = attempt.kind === 'wait' ? world.actionDurations.maxWaitMs : world.actionDurations.maxRestMs;
      if (attempt.durationMs > limit) return notApplied(world, attempt, 'duration-exceeds-limit');
      const endAt = clockAfter(world, attempt.durationMs);
      if (endAt === undefined) return notApplied(world, attempt, 'clock-overflow');
      const base = nextEventBase({ world, actorId: actor.characterId, attemptId: attempt.attemptId, ids: input.ids, eventCount: 0, at: world.clock.instant, durationMs: attempt.durationMs });
      const event = WorldEventSchema.parse({ ...base, kind: attempt.kind === 'wait' ? 'waited' : 'rested' });
      return commitApplied({ world, attempt, ids: input.ids, events: [event], perceptions: [], endAt, stateChanged: true });
    }
    case 'reviseGoal': {
      if (!validateEvidence(actor, attempt.evidenceExperienceIds)) return notApplied(world, attempt, 'evidence-not-owned');
      const goal = actor.mind.goals.find((candidate) => candidate.id === attempt.goalId);
      if (goal === undefined) return notApplied(world, attempt, 'goal-not-found');
      const goalState = goal.state;
      let nextState = goalState;
      let nextPriority = goal.priority;
      switch (attempt.change.kind) {
        case 'adopt':
          if (goalState !== 'proposed' && goalState !== 'suspended') return notApplied(world, attempt, 'goal-transition-invalid');
          nextState = 'active';
          break;
        case 'reprioritize':
          if (goalState === 'completed' || goalState === 'abandoned') return notApplied(world, attempt, 'goal-transition-invalid');
          nextPriority = attempt.change.priority;
          break;
        case 'suspend':
          if (goalState !== 'active') return notApplied(world, attempt, 'goal-transition-invalid');
          nextState = 'suspended';
          break;
        case 'complete':
          if (goalState === 'completed' || goalState === 'abandoned') return notApplied(world, attempt, 'goal-transition-invalid');
          nextState = 'completed';
          break;
        case 'abandon':
          if (goalState === 'completed' || goalState === 'abandoned') return notApplied(world, attempt, 'goal-transition-invalid');
          nextState = 'abandoned';
          break;
        default: {
          const exhaustive: never = attempt.change;
          return exhaustive;
        }
      }
      const previousGoalExperienceId = goal.history.at(-1);
      if (goal.history.length > 0 && previousGoalExperienceId === undefined) throw new Error('Historial de meta inconsistente');
      const experience = makeExperience({
        world, actor, ids: input.ids,
        content: `Revisé mi meta «${goal.description}»: ${attempt.change.kind}.`,
        confidence: 1, basedOn: attempt.evidenceExperienceIds,
        revision: goal.revision + 1,
        predecessor: previousGoalExperienceId === undefined
          ? { kind: 'initial' }
          : { kind: 'revision', experienceId: previousGoalExperienceId },
      });
      const updatedGoal = ActorGoalSchema.parse({ ...goal, state: nextState, priority: nextPriority, revision: goal.revision + 1, history: [...goal.history, experience.experienceId] });
      const updatedMind = ActorMindSchema.parse({ ...actor.mind, goals: actor.mind.goals.map((item) => item.id === goal.id ? updatedGoal : item), experiences: [...actor.mind.experiences, experience] });
      const entities = updateCharacter(world, WorldCharacterSchema.parse({ ...actor, mind: updatedMind }));
      return commitApplied({ world, attempt, ids: input.ids, events: [], perceptions: [], changes: { entities }, endAt: world.clock.instant, stateChanged: true });
    }
    case 'reviseBelief': {
      if (!validateEvidence(actor, attempt.evidenceExperienceIds)) return notApplied(world, attempt, 'evidence-not-owned');
      const change = attempt.change;
      const previous = change.kind === 'revise'
        ? actor.mind.beliefs.find((belief) => belief.experienceId === change.priorExperienceId)
        : undefined;
      if (change.kind === 'revise' && previous === undefined) return notApplied(world, attempt, 'belief-not-found');
      const priorExperience = previous === undefined ? undefined : actor.mind.experiences.find((experience) => experience.experienceId === previous.experienceId);
      if (previous !== undefined && priorExperience === undefined) return notApplied(world, attempt, 'belief-not-found');
      const content = change.content;
      const confidence = change.confidence;
      const experience = makeExperience({
        world, actor, ids: input.ids, content, confidence,
        basedOn: attempt.evidenceExperienceIds,
        revision: priorExperience === undefined ? 0 : priorExperience.revision + 1,
        predecessor: priorExperience === undefined ? { kind: 'initial' } : { kind: 'revision', experienceId: priorExperience.experienceId },
      });
      const newBelief = SubjectiveBeliefSchema.parse({ experienceId: experience.experienceId, content, confidence, basedOn: attempt.evidenceExperienceIds });
      const beliefs = previous === undefined
        ? [...actor.mind.beliefs, newBelief]
        : actor.mind.beliefs.map((belief) => belief.experienceId === previous.experienceId ? newBelief : belief);
      const updatedMind = ActorMindSchema.parse({ ...actor.mind, beliefs, experiences: [...actor.mind.experiences, experience] });
      const entities = updateCharacter(world, WorldCharacterSchema.parse({ ...actor, mind: updatedMind }));
      return commitApplied({ world, attempt, ids: input.ids, events: [], perceptions: [], changes: { entities }, endAt: world.clock.instant, stateChanged: true });
    }
    case 'reviseRelationship': {
      if (!validateEvidence(actor, attempt.evidenceExperienceIds)) return notApplied(world, attempt, 'evidence-not-owned');
      const targetEntityId = entityBindingForHandle(knowledge, attempt.targetHandle);
      const target = targetEntityId === undefined ? undefined : entityById(world, targetEntityId);
      if (target?.kind !== 'character' || target.characterId === actor.characterId) return notApplied(world, attempt, 'relationship-target-invalid');
      const prior = actor.mind.relationships.find((relationship) => relationship.targetHandle === attempt.targetHandle);
      const priorExperienceId = prior?.history.at(-1);
      const predecessor: Experience['predecessor'] = priorExperienceId === undefined
        ? { kind: 'initial' }
        : { kind: 'revision', experienceId: priorExperienceId };
      const experience = makeExperience({
        world, actor, ids: input.ids,
        content: `Revisé mi vínculo con ${attempt.targetHandle}: ${attempt.stance}.`,
        confidence: attempt.confidence, basedOn: attempt.evidenceExperienceIds,
        revision: prior === undefined ? 0 : prior.revision + 1, predecessor,
      });
      const relationship = RelationshipBeliefSchema.parse({
        targetHandle: attempt.targetHandle, stance: attempt.stance, confidence: attempt.confidence,
        revision: prior === undefined ? 0 : prior.revision + 1,
        history: [...(prior?.history ?? []), experience.experienceId],
      });
      const relationships = prior === undefined
        ? [...actor.mind.relationships, relationship]
        : actor.mind.relationships.map((item) => item.targetHandle === prior.targetHandle ? relationship : item);
      const updatedMind = ActorMindSchema.parse({ ...actor.mind, relationships, experiences: [...actor.mind.experiences, experience] });
      const entities = updateCharacter(world, WorldCharacterSchema.parse({ ...actor, mind: updatedMind }));
      return commitApplied({ world, attempt, ids: input.ids, events: [], perceptions: [], changes: { entities }, endAt: world.clock.instant, stateChanged: true });
    }
    default: {
      const exhaustive: never = attempt;
      return exhaustive;
    }
  }
}
