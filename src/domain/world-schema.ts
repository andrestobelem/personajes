/** Browser-safe structural contracts; host resolution and hashing live in world.ts. */
import { z } from 'zod';
import { ExperienceSchema } from './experience.ts';
import { GoalSchema as PreparedGoalSchema, GoalIdSchema as PreparedGoalIdSchema, InventoryItemIdSchema as PreparedInventoryItemIdSchema } from './preparation.ts';
import {
  CharacterIdSchema, EntityHandleSchema, EventIdSchema,
  ExperienceIdSchema, FictionalInstantSchema, HashSchema, HumanInterventionIdSchema, HumanParticipantIdSchema,
  PerceptionIdSchema, ProposalIdSchema,
  RevisionSchema, RunIdSchema, WorldSeqSchema,
} from './values.ts';

const uuidV4 = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  'Se requiere UUID v4 lowercase',
);
const uuidV5 = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  'Se requiere UUID v5 lowercase',
);
const slug = z.string().min(1).max(80).regex(/^[a-z0-9-]+$/);
const finite = z.number().finite();
const nonNegativeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const PositiveInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const WorldDurationMsSchema = nonNegativeInteger.brand<'DurationMs'>();

export const PlaceIdSchema = slug.brand<'PlaceId'>();
export const WorldEntityIdSchema = uuidV4.brand<'WorldEntityId'>();
export const DoorIdSchema = uuidV4.brand<'DoorId'>();
export const ChannelIdSchema = uuidV4.brand<'ChannelId'>();
export const SceneIdSchema = uuidV4.brand<'SceneId'>();
export const OfferIdSchema = uuidV4.brand<'OfferId'>();
/** Version 5 is reserved for deterministic, replayable tool attempts; authored IDs remain v4. */
export const WorldAttemptIdSchema = z.union([uuidV4, uuidV5]).brand<'WorldAttemptId'>();
export const GoalIdSchema = uuidV4.brand<'GoalId'>();
export const PlaceHandleSchema = z.string().min(1).max(120).brand<'PlaceHandle'>();
export const ChannelHandleSchema = z.string().min(1).max(120).brand<'ChannelHandle'>();
export const OfferHandleSchema = z.string().min(1).max(120).brand<'OfferHandle'>();
export const DeviceOperationIdSchema = slug.brand<'DeviceOperationId'>();

export const WorldPointSchema = z.strictObject({ x: finite, y: finite });
const LightingSchema = z.enum(['dark', 'dim', 'normal', 'bright']);
export const ModalitySchema = z.enum(['visual', 'auditory']);
export const CharacterCapabilitySchema = z.enum([
  'move', 'observe', 'speak', 'gesture', 'animalSound', 'take', 'offer', 'useDevice', 'wait', 'rest',
]);

export const WorldClockSchema = z.strictObject({
  instant: FictionalInstantSchema,
  convention: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('fixedOffset'), offsetMinutes: z.number().int().min(-840).max(840), label: z.string().min(1).max(120) }),
    z.strictObject({ kind: z.literal('ianaZone'), zone: z.string().min(1).max(120) }),
  ]),
});
export type WorldClock = z.infer<typeof WorldClockSchema>;

export const WorldPlaceSchema = z.strictObject({
  id: PlaceIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2_000),
  width: finite.positive(),
  height: finite.positive(),
  lighting: LightingSchema,
});
export type WorldPlace = z.infer<typeof WorldPlaceSchema>;

export const WorldDoorSchema = z.strictObject({
  id: DoorIdSchema,
  label: z.string().min(1).max(200),
  state: z.enum(['open', 'closed', 'locked']),
  transparentWhenClosed: z.boolean(),
  soundPassesWhenClosed: z.boolean(),
});
export type WorldDoor = z.infer<typeof WorldDoorSchema>;

export const WorldConnectionSchema = z.strictObject({
  from: PlaceIdSchema,
  to: PlaceIdSchema,
  durationMs: WorldDurationMsSchema,
  arrivalPoint: WorldPointSchema,
  doorId: DoorIdSchema.nullable(),
});
export type WorldConnection = z.infer<typeof WorldConnectionSchema>;

export const WorldPerceptualPathSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('visual'), from: PlaceIdSchema, to: PlaceIdSchema,
    distance: finite.min(0), throughDoorIds: z.array(DoorIdSchema).max(100),
  }),
  z.strictObject({
    kind: z.literal('auditory'), from: PlaceIdSchema, to: PlaceIdSchema,
    channelId: ChannelIdSchema, distance: finite.min(0), throughDoorIds: z.array(DoorIdSchema).max(100),
  }),
]);
export type WorldPerceptualPath = z.infer<typeof WorldPerceptualPathSchema>;

const AudienceScopeSchema = z.enum(['addressed', 'broadcast']);
export const WorldChannelSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('speech'), id: ChannelIdSchema, label: z.string().min(1).max(120),
    enabled: z.boolean(), maxRange: finite.min(0), scope: AudienceScopeSchema,
    placeIds: z.array(PlaceIdSchema).min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal('gesture'), id: ChannelIdSchema, label: z.string().min(1).max(120),
    enabled: z.boolean(), modality: ModalitySchema, maxRange: finite.min(0), scope: AudienceScopeSchema,
    placeIds: z.array(PlaceIdSchema).min(1).max(100),
  }),
]);
export type WorldChannel = z.infer<typeof WorldChannelSchema>;

export const AvailabilityRoutineSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('always') }),
  z.strictObject({
    kind: z.literal('windows'),
    defaultState: z.enum(['available', 'unavailable']),
    windows: z.array(z.strictObject({
      from: FictionalInstantSchema, to: FictionalInstantSchema,
      state: z.enum(['available', 'unavailable']),
    })).max(10_000),
  }).superRefine((routine, context) => {
    const windows = [...routine.windows].sort((left, right) => left.from - right.from);
    for (const [index, window] of windows.entries()) {
      if (window.from >= window.to) context.addIssue({ code: 'custom', path: ['windows', index], message: 'La rutina requiere intervalo creciente' });
      const previous = windows[index - 1];
      if (previous !== undefined && previous.to > window.from) {
        context.addIssue({ code: 'custom', path: ['windows', index], message: 'Las ventanas de rutina no pueden solaparse' });
      }
    }
  }),
]);
export type AvailabilityRoutine = z.infer<typeof AvailabilityRoutineSchema>;

const GoalStateSchema = z.enum(['proposed', 'active', 'suspended', 'completed', 'abandoned']);
const GoalCommon = {
  id: GoalIdSchema,
  description: z.string().min(1).max(4_000),
  sourceGoalId: PreparedGoalIdSchema.optional(),
  reviewConditions: PreparedGoalSchema.options[0].shape.reviewConditions.optional(),
  priority: z.number().finite().min(0).max(1),
  state: GoalStateSchema,
  revision: RevisionSchema,
  history: z.array(ExperienceIdSchema).max(10_000),
};
export const ActorGoalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...GoalCommon, kind: z.literal('durable') }),
  z.strictObject({ ...GoalCommon, kind: z.literal('situated') }),
  z.strictObject({ ...GoalCommon, kind: z.literal('shared'), ownMotivation: z.string().min(1).max(4_000).optional(), participants: z.array(CharacterIdSchema).min(1).max(100) }),
]);
export type ActorGoal = z.infer<typeof ActorGoalSchema>;

export const SubjectiveBeliefSchema = z.strictObject({
  experienceId: ExperienceIdSchema,
  content: z.string().min(1).max(8_000),
  confidence: z.number().finite().min(0).max(1),
  basedOn: z.array(ExperienceIdSchema).min(1).max(1_000),
});
export type SubjectiveBelief = z.infer<typeof SubjectiveBeliefSchema>;

export const RelationshipBeliefSchema = z.strictObject({
  targetHandle: EntityHandleSchema,
  stance: z.enum(['unknown', 'wary', 'neutral', 'warm', 'trusting']),
  confidence: z.number().finite().min(0).max(1),
  revision: RevisionSchema,
  history: z.array(ExperienceIdSchema).max(10_000),
});
export type RelationshipBelief = z.infer<typeof RelationshipBeliefSchema>;

export const RelationshipDescriptionSchema = z.strictObject({
  reference: z.string().min(1).max(500), description: z.string().min(1).max(4_000),
  confidence: z.number().finite().min(0).max(1), revision: RevisionSchema,
});

export const ActorMindSchema = z.strictObject({
  goals: z.array(ActorGoalSchema).max(10_000),
  beliefs: z.array(SubjectiveBeliefSchema).max(20_000),
  relationships: z.array(RelationshipBeliefSchema).max(20_000),
  relationshipDescriptions: z.array(RelationshipDescriptionSchema).max(10_000).optional(),
  inventoryKnowledge: z.array(z.strictObject({ objectEntityId: WorldEntityIdSchema, name: z.string().min(1).max(500).optional(), description: z.string().max(2_000) })).max(10_000).optional(),
  recognizedCharacterIds: z.array(CharacterIdSchema).max(10_000),
  experiences: z.array(ExperienceSchema).max(100_000),
});
export type ActorMind = z.infer<typeof ActorMindSchema>;

const CharacterPresentationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ordinary'), label: z.string().min(1).max(200) }),
  z.strictObject({ kind: z.literal('cover'), label: z.string().min(1).max(200) }),
]);

const CharacterStateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('available') }),
  z.strictObject({ kind: z.literal('unavailable'), reason: z.string().min(1).max(500) }),
]);

const PreparationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('prepared'), continuityId: slug, identityVersion: PositiveInteger }),
  z.strictObject({ kind: z.literal('notPrepared'), reason: z.string().min(1).max(500) }),
]);

const CharacterCommon = {
  kind: z.literal('character'),
  entityId: WorldEntityIdSchema,
  characterId: CharacterIdSchema,
  trueDisplayName: z.string().min(1).max(200),
  species: z.enum(['human', 'animal', 'robot']),
  presentation: CharacterPresentationSchema,
  placeId: PlaceIdSchema,
  position: WorldPointSchema,
  collisionRadius: finite.min(0).max(100),
  blocksMovement: z.boolean(),
  presence: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('present'), sceneId: SceneIdSchema }),
    z.strictObject({ kind: z.literal('absent') }),
  ]),
  preparation: PreparationSchema,
  capabilities: z.array(CharacterCapabilitySchema).max(20),
  availability: CharacterStateSchema,
  routine: AvailabilityRoutineSchema,
  mind: ActorMindSchema,
};

export const WorldCharacterSchema = z.strictObject(CharacterCommon).superRefine((character, context) => {
  if (character.species === 'animal' && character.capabilities.includes('speak')) {
    context.addIssue({ code: 'custom', path: ['capabilities'], message: 'Un animal no recibe capacidad de habla humana' });
  }
});
export type WorldCharacter = z.infer<typeof WorldCharacterSchema>;

export const WorldObjectSchema = z.strictObject({
  kind: z.literal('object'), entityId: WorldEntityIdSchema,
  label: z.string().min(1).max(500),
  sourceItemId: PreparedInventoryItemIdSchema.optional(),
  quantity: z.number().int().min(1).max(1_000_000).optional(),
  condition: z.enum(['usable', 'damaged', 'unknown']).optional(), description: z.string().max(2_000),
  collisionRadius: finite.min(0).max(100), blocksMovement: z.boolean(), portable: z.boolean(),
});
export type WorldObject = z.infer<typeof WorldObjectSchema>;

export const DeviceOperationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('setPower'), id: DeviceOperationIdSchema, label: z.string().min(1).max(120), state: z.enum(['on', 'off']), durationMs: WorldDurationMsSchema }),
  z.strictObject({ kind: z.literal('setLight'), id: DeviceOperationIdSchema, label: z.string().min(1).max(120), placeId: PlaceIdSchema, level: LightingSchema, durationMs: WorldDurationMsSchema }),
]);
export type DeviceOperation = z.infer<typeof DeviceOperationSchema>;

export const WorldDeviceSchema = z.strictObject({
  kind: z.literal('device'), entityId: WorldEntityIdSchema,
  label: z.string().min(1).max(200), description: z.string().max(2_000),
  placeId: PlaceIdSchema, position: WorldPointSchema,
  collisionRadius: finite.min(0).max(100), blocksMovement: z.boolean(),
  availability: z.enum(['available', 'unavailable']), power: z.enum(['on', 'off']),
  operations: z.array(DeviceOperationSchema).max(100),
});
export type WorldDevice = z.infer<typeof WorldDeviceSchema>;

export const WorldEntitySchema = z.discriminatedUnion('kind', [WorldCharacterSchema, WorldObjectSchema, WorldDeviceSchema]);
export type WorldEntity = z.infer<typeof WorldEntitySchema>;

export const InventoryEntrySchema = z.strictObject({
  objectEntityId: WorldEntityIdSchema,
  location: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('atPlace'), placeId: PlaceIdSchema, position: WorldPointSchema }),
    z.strictObject({ kind: z.literal('heldBy'), entityId: WorldEntityIdSchema }),
    z.strictObject({ kind: z.literal('consumed'), eventId: EventIdSchema }),
  ]),
  revision: RevisionSchema,
});
export type InventoryEntry = z.infer<typeof InventoryEntrySchema>;

export const WorldSceneSchema = z.strictObject({
  id: SceneIdSchema, label: z.string().min(1).max(200),
  lifecycle: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('open'), startedAt: FictionalInstantSchema }),
    z.strictObject({ kind: z.literal('closed'), startedAt: FictionalInstantSchema, closedAt: FictionalInstantSchema, reason: z.string().min(1).max(500) }),
  ]),
  participantIds: z.array(CharacterIdSchema).min(1).max(100),
  placeIds: z.array(PlaceIdSchema).min(1).max(100),
});
export type WorldScene = z.infer<typeof WorldSceneSchema>;

export const WorldOfferSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('open'), id: OfferIdSchema, handle: OfferHandleSchema,
    objectEntityId: WorldEntityIdSchema, ownerEntityId: WorldEntityIdSchema,
    recipientCharacterId: CharacterIdSchema, objectRevision: RevisionSchema,
    createdAt: FictionalInstantSchema, expiresAt: FictionalInstantSchema,
  }),
  z.strictObject({
    state: z.literal('accepted'), id: OfferIdSchema, handle: OfferHandleSchema,
    objectEntityId: WorldEntityIdSchema, ownerEntityId: WorldEntityIdSchema,
    recipientCharacterId: CharacterIdSchema, objectRevision: RevisionSchema,
    createdAt: FictionalInstantSchema, expiresAt: FictionalInstantSchema,
    eventId: EventIdSchema,
  }),
  z.strictObject({
    state: z.literal('invalidated'), id: OfferIdSchema, handle: OfferHandleSchema,
    objectEntityId: WorldEntityIdSchema, ownerEntityId: WorldEntityIdSchema,
    recipientCharacterId: CharacterIdSchema, objectRevision: RevisionSchema,
    createdAt: FictionalInstantSchema, expiresAt: FictionalInstantSchema,
    cause: z.enum(['acceptedElsewhere', 'expired', 'withdrawn', 'objectUnavailable']),
    eventId: EventIdSchema,
  }),
]);
export type WorldOffer = z.infer<typeof WorldOfferSchema>;

export const ActionDurationsSchema = z.strictObject({
  observeMs: WorldDurationMsSchema,
  speechMs: WorldDurationMsSchema,
  gestureMs: WorldDurationMsSchema,
  takeMs: WorldDurationMsSchema,
  offerMs: WorldDurationMsSchema,
  acceptOfferMs: WorldDurationMsSchema,
  maxWaitMs: WorldDurationMsSchema,
  maxRestMs: WorldDurationMsSchema,
  offerValidityMs: PositiveInteger,
  interactionRange: finite.min(0).max(10_000),
});
export type ActionDurations = z.infer<typeof ActionDurationsSchema>;

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): boolean {
  const seen = new Set<string>();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
  }
  return true;
}

export const WorldSnapshotSchema = z.strictObject({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  runId: RunIdSchema,
  revision: RevisionSchema,
  seq: WorldSeqSchema,
  clock: WorldClockSchema,
  places: z.array(WorldPlaceSchema).min(1).max(10_000),
  doors: z.array(WorldDoorSchema).max(10_000),
  connections: z.array(WorldConnectionSchema).max(100_000),
  perceptualPaths: z.array(WorldPerceptualPathSchema).max(100_000),
  channels: z.array(WorldChannelSchema).max(1_000),
  entities: z.array(WorldEntitySchema).min(1).max(100_000),
  inventory: z.array(InventoryEntrySchema).max(100_000),
  scenes: z.array(WorldSceneSchema).min(1).max(10_000),
  activeSceneId: SceneIdSchema.nullable(),
  offers: z.array(WorldOfferSchema).max(100_000),
  actionDurations: ActionDurationsSchema,
}).superRefine((world, context) => {
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message });
  if (!uniqueBy(world.places, (place) => place.id)) issue(['places'], 'PlaceId duplicado');
  if (!uniqueBy(world.doors, (door) => door.id)) issue(['doors'], 'DoorId duplicado');
  if (!uniqueBy(world.channels, (channel) => channel.id)) issue(['channels'], 'ChannelId duplicado');
  if (!uniqueBy(world.entities, (entity) => entity.entityId)) issue(['entities'], 'WorldEntityId duplicado');
  if (!uniqueBy(world.entities.filter((entity) => entity.kind === 'character'), (entity) => entity.characterId)) {
    issue(['entities'], 'CharacterId duplicado en el Escenario');
  }
  if (!uniqueBy(world.scenes, (scene) => scene.id)) issue(['scenes'], 'SceneId duplicado');
  if (!uniqueBy(world.inventory, (entry) => entry.objectEntityId)) issue(['inventory'], 'Un objeto debe tener una sola ubicación');
  if (!uniqueBy(world.offers, (offer) => offer.id)) issue(['offers'], 'OfferId duplicado');
  const places = new Set(world.places.map((place) => place.id));
  const doors = new Set(world.doors.map((door) => door.id));
  const channels = new Set(world.channels.map((channel) => channel.id));
  const entities = new Map(world.entities.map((entity) => [entity.entityId, entity]));
  const chars = new Map(world.entities.filter((entity) => entity.kind === 'character').map((entity) => [entity.characterId, entity]));
  const scenes = new Map(world.scenes.map((scene) => [scene.id, scene]));
  for (const [index, place] of world.places.entries()) {
    if (!(place.width > 0 && place.height > 0)) issue(['places', index], 'La geometría debe ser positiva');
  }
  for (const [index, connection] of world.connections.entries()) {
    if (!places.has(connection.from) || !places.has(connection.to)) issue(['connections', index], 'Conexión refiere un lugar desconocido');
    if (connection.doorId !== null && !doors.has(connection.doorId)) issue(['connections', index, 'doorId'], 'Puerta desconocida');
    const target = world.places.find((place) => place.id === connection.to);
    if (target !== undefined && (connection.arrivalPoint.x < 0 || connection.arrivalPoint.y < 0 || connection.arrivalPoint.x > target.width || connection.arrivalPoint.y > target.height)) {
      issue(['connections', index, 'arrivalPoint'], 'Punto de llegada fuera del mapa');
    }
  }
  for (const [index, path] of world.perceptualPaths.entries()) {
    if (!places.has(path.from) || !places.has(path.to)) issue(['perceptualPaths', index], 'Trayecto perceptivo refiere un lugar desconocido');
    if (path.kind === 'auditory' && !channels.has(path.channelId)) issue(['perceptualPaths', index, 'channelId'], 'Canal auditivo desconocido');
    for (const [doorIndex, doorId] of path.throughDoorIds.entries()) {
      if (!doors.has(doorId)) issue(['perceptualPaths', index, 'throughDoorIds', doorIndex], 'Trayecto refiere una puerta desconocida');
    }
  }
  for (const [index, channel] of world.channels.entries()) {
    for (const [placeIndex, placeId] of channel.placeIds.entries()) {
      if (!places.has(placeId)) issue(['channels', index, 'placeIds', placeIndex], 'Canal refiere un lugar desconocido');
    }
  }
  for (const [index, entity] of world.entities.entries()) {
    if (entity.kind === 'character' || entity.kind === 'device') {
      const place = world.places.find((item) => item.id === entity.placeId);
      if (place === undefined) issue(['entities', index, 'placeId'], 'Entidad refiere un lugar desconocido');
      else if (entity.position.x < 0 || entity.position.y < 0 || entity.position.x > place.width || entity.position.y > place.height) {
        issue(['entities', index, 'position'], 'Posición fuera del mapa');
      }
    }
    if (entity.kind === 'character') {
      if (entity.presence.kind === 'present') {
        const scene = scenes.get(entity.presence.sceneId);
        if (scene === undefined || !scene.participantIds.includes(entity.characterId)) issue(['entities', index, 'presence'], 'Presencia no pertenece a una escena participante');
        else if (!scene.placeIds.includes(entity.placeId)) issue(['entities', index, 'placeId'], 'Personaje presente fuera de los lugares de su escena');
      }
      for (const [experienceIndex, experience] of entity.mind.experiences.entries()) {
        if (experience.actorId !== entity.characterId || experience.runId !== world.runId) issue(['entities', index, 'mind', 'experiences', experienceIndex], 'Experiencia privada de otro actor o corrida');
      }
      const experienceIds = new Set(entity.mind.experiences.map((experience) => experience.experienceId));
      for (const [goalIndex, goal] of entity.mind.goals.entries()) {
        for (const id of goal.history) if (!experienceIds.has(id)) issue(['entities', index, 'mind', 'goals', goalIndex, 'history'], 'Historial de meta no pertenece a este actor');
        if (goal.kind === 'shared' && goal.participants.includes(entity.characterId)) issue(['entities', index, 'mind', 'goals', goalIndex, 'participants'], 'Meta compartida no puede duplicar propietario');
      }
      for (const [beliefIndex, belief] of entity.mind.beliefs.entries()) {
        if (!experienceIds.has(belief.experienceId)) issue(['entities', index, 'mind', 'beliefs', beliefIndex], 'Creencia sin experiencia propia');
        for (const id of belief.basedOn) if (!experienceIds.has(id)) issue(['entities', index, 'mind', 'beliefs', beliefIndex, 'basedOn'], 'Evidencia de otra memoria o no disponible');
      }
    }
    if (entity.kind === 'device') {
      if (!uniqueBy(entity.operations, (operation) => operation.id)) issue(['entities', index, 'operations'], 'Operación de dispositivo duplicada');
      for (const [operationIndex, operation] of entity.operations.entries()) {
        if (operation.kind === 'setLight' && !places.has(operation.placeId)) issue(['entities', index, 'operations', operationIndex, 'placeId'], 'Operación apunta a lugar desconocido');
      }
    }
  }
  for (const [index, entry] of world.inventory.entries()) {
    const object = entities.get(entry.objectEntityId);
    if (object?.kind !== 'object') issue(['inventory', index, 'objectEntityId'], 'Inventario refiere un objeto desconocido');
    const location = entry.location;
    if (location.kind === 'atPlace') {
      const place = world.places.find((item) => item.id === location.placeId);
      if (place === undefined) issue(['inventory', index, 'location'], 'Objeto refiere un lugar desconocido');
      else if (location.position.x < 0 || location.position.y < 0 || location.position.x > place.width || location.position.y > place.height) issue(['inventory', index, 'location'], 'Objeto fuera del mapa');
    }
    if (location.kind === 'heldBy') {
      const holder = entities.get(location.entityId);
      if (holder?.kind !== 'character') issue(['inventory', index, 'location'], 'Objeto debe estar en inventario de personaje');
    }
  }
  for (const [index, scene] of world.scenes.entries()) {
    if (!uniqueBy(scene.participantIds, (id) => id)) issue(['scenes', index, 'participantIds'], 'Participante duplicado');
    if (!uniqueBy(scene.placeIds, (id) => id)) issue(['scenes', index, 'placeIds'], 'Lugar duplicado en escena');
    for (const id of scene.participantIds) {
      const character = chars.get(id);
      if (character === undefined || character.preparation.kind !== 'prepared') issue(['scenes', index, 'participantIds'], 'Participante debe ser personaje preparado');
    }
    for (const [placeIndex, id] of scene.placeIds.entries()) if (!places.has(id)) issue(['scenes', index, 'placeIds', placeIndex], 'Escena refiere un lugar desconocido');
  }
  if (world.schemaVersion === 1) {
    const activeScene = world.activeSceneId === null ? undefined : scenes.get(world.activeSceneId);
    if (activeScene === undefined || activeScene.lifecycle.kind !== 'open') {
      issue(['activeSceneId'], 'La escena activa debe existir y estar abierta');
    }
  } else if (world.activeSceneId === null) {
    if (world.scenes.some((scene) => scene.lifecycle.kind === 'open')) {
      issue(['activeSceneId'], 'Sin escena activa, todas las escenas deben estar cerradas');
    }
  } else {
    const activeScene = scenes.get(world.activeSceneId);
    if (activeScene === undefined || activeScene.lifecycle.kind !== 'open') {
      issue(['activeSceneId'], 'La escena activa debe existir y estar abierta');
    }
  }
  for (const [index, offer] of world.offers.entries()) {
    if (entities.get(offer.objectEntityId)?.kind !== 'object') issue(['offers', index, 'objectEntityId'], 'Oferta refiere objeto desconocido');
    if (entities.get(offer.ownerEntityId)?.kind !== 'character') issue(['offers', index, 'ownerEntityId'], 'Oferta refiere dueño desconocido');
    if (!chars.has(offer.recipientCharacterId)) issue(['offers', index, 'recipientCharacterId'], 'Oferta refiere destinatario desconocido');
    if (offer.state === 'open' && offer.expiresAt <= offer.createdAt) issue(['offers', index, 'expiresAt'], 'Oferta abierta requiere vigencia positiva');
  }
});
export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;

export function parseWorldSnapshot(input: unknown): WorldSnapshot {
  return WorldSnapshotSchema.parse(input);
}

export const ActorHandleBindingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('entity'), handle: EntityHandleSchema, entityId: WorldEntityIdSchema }),
  z.strictObject({ kind: z.literal('place'), handle: PlaceHandleSchema, placeId: PlaceIdSchema }),
  z.strictObject({ kind: z.literal('channel'), handle: ChannelHandleSchema, channelId: ChannelIdSchema }),
  z.strictObject({ kind: z.literal('offer'), handle: OfferHandleSchema, offerId: OfferIdSchema }),
]);
export type ActorHandleBinding = z.infer<typeof ActorHandleBindingSchema>;

export const ActorKnowledgeSchema = z.strictObject({
  runId: RunIdSchema,
  actorId: CharacterIdSchema,
  bindings: z.array(ActorHandleBindingSchema).max(100_000),
}).superRefine((knowledge, context) => {
  if (!uniqueBy(knowledge.bindings, (binding) => binding.handle)) {
    context.addIssue({ code: 'custom', path: ['bindings'], message: 'Handle opaco duplicado en conocimiento host' });
  }
  if (!uniqueBy(knowledge.bindings, (binding) => `${binding.kind}:${'entityId' in binding ? binding.entityId : 'placeId' in binding ? binding.placeId : 'channelId' in binding ? binding.channelId : binding.offerId}`)) {
    context.addIssue({ code: 'custom', path: ['bindings'], message: 'Target duplicado en conocimiento host' });
  }
});
export type ActorKnowledge = z.infer<typeof ActorKnowledgeSchema>;

export function emptyActorKnowledge(input: { runId: unknown; actorId: unknown }): ActorKnowledge {
  return ActorKnowledgeSchema.parse({ runId: input.runId, actorId: input.actorId, bindings: [] });
}

export const GestureSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('wave') }),
  z.strictObject({ kind: z.literal('point'), targetHandle: EntityHandleSchema }),
  z.strictObject({ kind: z.literal('nod') }),
  z.strictObject({ kind: z.literal('shakeHead') }),
  z.strictObject({ kind: z.literal('posture'), pose: z.enum(['standing', 'sitting', 'crouching']) }),
  z.strictObject({ kind: z.literal('bark') }),
  z.strictObject({ kind: z.literal('whine') }),
]);
export type Gesture = z.infer<typeof GestureSchema>;

export const CommunicationContentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('speech'), text: z.string().min(1).max(16_384).refine((text) => !text.includes('\0')) }),
  z.strictObject({ kind: z.literal('gesture'), gesture: GestureSchema }),
]);
export type CommunicationContent = z.infer<typeof CommunicationContentSchema>;

const evidenceIds = z.array(ExperienceIdSchema).min(1).max(1_000).refine((ids) => uniqueBy(ids, (id) => id), 'Evidencia duplicada');

const reviseBeliefChangeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('new'), content: z.string().min(1).max(8_000), confidence: z.number().finite().min(0).max(1) }),
  z.strictObject({ kind: z.literal('revise'), priorExperienceId: ExperienceIdSchema, content: z.string().min(1).max(8_000), confidence: z.number().finite().min(0).max(1) }),
]);

export const WorldAttemptSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('observe'), attemptId: WorldAttemptIdSchema, runId: RunIdSchema, actorId: CharacterIdSchema,
    expectedRevision: RevisionSchema,
    target: z.discriminatedUnion('modality', [
      z.strictObject({ modality: z.literal('visual'), targetHandle: EntityHandleSchema }),
      z.strictObject({ modality: z.literal('auditory'), targetHandle: EntityHandleSchema, channelHandle: ChannelHandleSchema }),
    ]),
  }),
  z.strictObject({
    kind: z.literal('move'), attemptId: WorldAttemptIdSchema, runId: RunIdSchema, actorId: CharacterIdSchema,
    expectedRevision: RevisionSchema, destinationHandle: PlaceHandleSchema,
  }),
  z.strictObject({
    kind: z.literal('communicate'), attemptId: WorldAttemptIdSchema, runId: RunIdSchema, actorId: CharacterIdSchema,
    expectedRevision: RevisionSchema, channelHandle: ChannelHandleSchema,
    audienceHandles: z.array(EntityHandleSchema).max(100), content: CommunicationContentSchema,
  }),
  z.strictObject({
    kind: z.literal('take'), attemptId: WorldAttemptIdSchema, runId: RunIdSchema, actorId: CharacterIdSchema,
    expectedRevision: RevisionSchema, objectHandle: EntityHandleSchema,
  }),
  z.strictObject({
    kind: z.literal('offer'), attemptId: WorldAttemptIdSchema, runId: RunIdSchema, actorId: CharacterIdSchema,
    expectedRevision: RevisionSchema, objectHandle: EntityHandleSchema, recipientHandle: EntityHandleSchema,
  }),
  z.strictObject({
    kind: z.literal('acceptOffer'), attemptId: WorldAttemptIdSchema, runId: RunIdSchema, actorId: CharacterIdSchema,
    expectedRevision: RevisionSchema, offerHandle: OfferHandleSchema,
  }),
  z.strictObject({
    kind: z.literal('useDevice'), attemptId: WorldAttemptIdSchema, runId: RunIdSchema, actorId: CharacterIdSchema,
    expectedRevision: RevisionSchema, deviceHandle: EntityHandleSchema, operationId: DeviceOperationIdSchema,
  }),
  z.strictObject({
    kind: z.literal('wait'), attemptId: WorldAttemptIdSchema, runId: RunIdSchema, actorId: CharacterIdSchema,
    expectedRevision: RevisionSchema, durationMs: WorldDurationMsSchema,
  }),
  z.strictObject({
    kind: z.literal('rest'), attemptId: WorldAttemptIdSchema, runId: RunIdSchema, actorId: CharacterIdSchema,
    expectedRevision: RevisionSchema, durationMs: WorldDurationMsSchema,
  }),
  z.strictObject({
    kind: z.literal('reviseGoal'), attemptId: WorldAttemptIdSchema, runId: RunIdSchema, actorId: CharacterIdSchema,
    expectedRevision: RevisionSchema, goalId: GoalIdSchema,
    change: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('adopt') }),
      z.strictObject({ kind: z.literal('reprioritize'), priority: z.number().finite().min(0).max(1) }),
      z.strictObject({ kind: z.literal('suspend') }),
      z.strictObject({ kind: z.literal('complete') }),
      z.strictObject({ kind: z.literal('abandon') }),
    ]),
    evidenceExperienceIds: evidenceIds,
  }),
  z.strictObject({
    kind: z.literal('reviseBelief'), attemptId: WorldAttemptIdSchema, runId: RunIdSchema, actorId: CharacterIdSchema,
    expectedRevision: RevisionSchema, change: reviseBeliefChangeSchema, evidenceExperienceIds: evidenceIds,
  }),
  z.strictObject({
    kind: z.literal('reviseRelationship'), attemptId: WorldAttemptIdSchema, runId: RunIdSchema, actorId: CharacterIdSchema,
    expectedRevision: RevisionSchema, targetHandle: EntityHandleSchema,
    stance: z.enum(['unknown', 'wary', 'neutral', 'warm', 'trusting']),
    confidence: z.number().finite().min(0).max(1), evidenceExperienceIds: evidenceIds,
  }),
]);
export type WorldAttempt = z.infer<typeof WorldAttemptSchema>;

/** Model-visible action parameters; identity and revision remain host-owned. */
const [observeAttempt, moveAttempt, communicateAttempt, takeAttempt, offerAttempt, acceptOfferAttempt,
  useDeviceAttempt, waitAttempt, restAttempt, reviseGoalAttempt, reviseBeliefAttempt, reviseRelationshipAttempt] = WorldAttemptSchema.options;
const hostAttemptFields = { attemptId: true, runId: true, actorId: true, expectedRevision: true } as const;
export const WorldActorActionSchema = z.discriminatedUnion('kind', [
  observeAttempt.omit(hostAttemptFields), moveAttempt.omit(hostAttemptFields), communicateAttempt.omit(hostAttemptFields),
  takeAttempt.omit(hostAttemptFields), offerAttempt.omit(hostAttemptFields), acceptOfferAttempt.omit(hostAttemptFields),
  useDeviceAttempt.omit(hostAttemptFields), waitAttempt.omit(hostAttemptFields), restAttempt.omit(hostAttemptFields),
  reviseGoalAttempt.omit(hostAttemptFields), reviseBeliefAttempt.omit(hostAttemptFields), reviseRelationshipAttempt.omit(hostAttemptFields),
]);

/** Host-authenticated receipt for the exact proposal version reviewed by Continuista. */
export const WorldContentApprovalReceiptSchema = z.strictObject({
  kind: z.literal('approved'),
  proposalId: ProposalIdSchema,
  version: PositiveInteger,
  runId: RunIdSchema,
  actorId: CharacterIdSchema,
  stateRevision: RevisionSchema,
  exactContentHash: HashSchema,
});
export type WorldContentApprovalReceipt = z.infer<typeof WorldContentApprovalReceiptSchema>;

export type WorldIdSource = {
  eventId: () => unknown;
  perceptionId: () => unknown;
  experienceId: () => unknown;
  offerId: () => unknown;
  entityHandle: () => unknown;
  placeHandle: () => unknown;
  channelHandle: () => unknown;
  offerHandle: () => unknown;
};

const eventBase = {
  id: EventIdSchema,
  runId: RunIdSchema,
  seq: WorldSeqSchema,
  fictitiousAt: FictionalInstantSchema,
  durationMs: WorldDurationMsSchema,
};

const eventCommon = {
  ...eventBase,
  origin: z.union([
    z.strictObject({ kind: z.literal('actor'), actorId: CharacterIdSchema, attemptId: WorldAttemptIdSchema }),
    z.strictObject({ kind: z.literal('system'), causeAttemptId: WorldAttemptIdSchema }),
  ]),
};

export const WorldEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...eventCommon, kind: z.literal('moved'), entityId: WorldEntityIdSchema, from: PlaceIdSchema, to: PlaceIdSchema, arrivalPoint: WorldPointSchema }),
  z.strictObject({ ...eventCommon, kind: z.literal('communicated'), entityId: WorldEntityIdSchema, channelId: ChannelIdSchema, content: CommunicationContentSchema, approvedContentHash: HashSchema, requestedAudience: z.array(CharacterIdSchema).max(100), effectiveAudience: z.array(CharacterIdSchema).max(100), targetEntityId: WorldEntityIdSchema.nullable() }),
  z.strictObject({
    ...eventBase,
    origin: z.strictObject({ kind: z.literal('human'), participantId: HumanParticipantIdSchema, interventionId: HumanInterventionIdSchema }),
    kind: z.literal('humanIntervention'), speakerDisplayName: z.string().min(1).max(120),
    placeId: PlaceIdSchema, position: WorldPointSchema, channelId: ChannelIdSchema,
    content: z.strictObject({ kind: z.literal('speech'), text: z.string().min(1).max(16_384).refine((text) => !text.includes('\0')) }),
    requestedAudience: z.array(CharacterIdSchema).max(100), effectiveAudience: z.array(CharacterIdSchema).max(100),
  }),
  z.strictObject({ ...eventCommon, kind: z.literal('objectTaken'), objectEntityId: WorldEntityIdSchema, from: PlaceIdSchema, toHolderEntityId: WorldEntityIdSchema }),
  z.strictObject({ ...eventCommon, kind: z.literal('offerCreated'), offerId: OfferIdSchema, objectEntityId: WorldEntityIdSchema, ownerEntityId: WorldEntityIdSchema, recipientCharacterId: CharacterIdSchema, expiresAt: FictionalInstantSchema }),
  z.strictObject({ ...eventCommon, kind: z.literal('offerAccepted'), offerId: OfferIdSchema, objectEntityId: WorldEntityIdSchema, fromHolderEntityId: WorldEntityIdSchema, toHolderEntityId: WorldEntityIdSchema }),
  z.strictObject({ ...eventBase, origin: z.union([
    z.strictObject({ kind: z.literal('actor'), actorId: CharacterIdSchema, attemptId: WorldAttemptIdSchema }),
    z.strictObject({ kind: z.literal('system'), causeAttemptId: WorldAttemptIdSchema }),
    z.strictObject({ kind: z.literal('system'), causeInterventionId: HumanInterventionIdSchema }),
  ]), kind: z.literal('offerInvalidated'), offerId: OfferIdSchema, objectEntityId: WorldEntityIdSchema, cause: z.enum(['acceptedElsewhere', 'expired', 'withdrawn', 'objectUnavailable']) }),
  z.strictObject({ ...eventCommon, kind: z.literal('deviceUsed'), deviceEntityId: WorldEntityIdSchema, operationId: DeviceOperationIdSchema, effect: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('powerChanged'), state: z.enum(['on', 'off']) }),
    z.strictObject({ kind: z.literal('lightChanged'), placeId: PlaceIdSchema, level: LightingSchema }),
  ]) }),
  z.strictObject({ ...eventCommon, kind: z.literal('waited') }),
  z.strictObject({ ...eventCommon, kind: z.literal('rested') }),
  z.strictObject({ ...eventBase, origin: z.strictObject({ kind: z.literal('system'), causeClockAdvanceId: z.string().uuid() }),
    kind: z.literal('clockAdvanced'), fromAt: FictionalInstantSchema, toAt: FictionalInstantSchema }),
]).superRefine((event, context) => {
  if (event.kind === 'clockAdvanced' && (event.fictitiousAt !== event.fromAt
    || event.toAt <= event.fromAt || event.durationMs !== event.toAt - event.fromAt)) {
    context.addIssue({ code: 'custom', path: ['durationMs'], message: 'El evento de reloj debe reflejar el intervalo confirmado.' });
  }
});
export type WorldEvent = z.infer<typeof WorldEventSchema>;

export const WorldPerceptionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('observation'), id: PerceptionIdSchema, runId: RunIdSchema, recipientCharacterId: CharacterIdSchema,
    attemptId: WorldAttemptIdSchema, subjectEntityId: WorldEntityIdSchema, modality: ModalitySchema,
    detail: z.string().min(1).max(2_000), fictitiousAt: FictionalInstantSchema,
  }),
  z.strictObject({
    kind: z.literal('communication'), id: PerceptionIdSchema, runId: RunIdSchema, recipientCharacterId: CharacterIdSchema,
    eventId: EventIdSchema, sourceEntityId: WorldEntityIdSchema, channelId: ChannelIdSchema,
    content: CommunicationContentSchema, targetEntityId: WorldEntityIdSchema.nullable(), fictitiousAt: FictionalInstantSchema,
  }),
  z.strictObject({
    kind: z.literal('testimony'), id: PerceptionIdSchema, runId: RunIdSchema, recipientCharacterId: CharacterIdSchema,
    eventId: EventIdSchema, sourceParticipantId: HumanParticipantIdSchema, speakerDisplayName: z.string().min(1).max(120),
    channelId: ChannelIdSchema,
    content: z.strictObject({ kind: z.literal('speech'), text: z.string().min(1).max(16_384).refine((text) => !text.includes('\0')) }),
    fictitiousAt: FictionalInstantSchema,
  }),
  z.strictObject({
    kind: z.literal('offer'), id: PerceptionIdSchema, runId: RunIdSchema, recipientCharacterId: CharacterIdSchema,
    eventId: EventIdSchema, offerId: OfferIdSchema, offerHandle: OfferHandleSchema,
    sourceEntityId: WorldEntityIdSchema, objectEntityId: WorldEntityIdSchema, fictitiousAt: FictionalInstantSchema,
  }),
  z.strictObject({
    kind: z.literal('worldEvent'), id: PerceptionIdSchema, runId: RunIdSchema, recipientCharacterId: CharacterIdSchema,
    eventId: EventIdSchema, sourceEntityId: WorldEntityIdSchema, modality: ModalitySchema,
    detail: z.string().min(1).max(2_000), fictitiousAt: FictionalInstantSchema,
  }),
]);
export type WorldPerception = z.infer<typeof WorldPerceptionSchema>;

export const ResolutionReasonSchema = z.enum([
  'run-mismatch', 'actor-not-found', 'actor-not-prepared', 'actor-not-participant', 'scene-not-open',
  'actor-unavailable', 'capability-missing', 'unknown-handle', 'target-not-perceptible',
  'destination-not-connected', 'door-blocked', 'collision', 'outside-scene', 'device-effect-outside-scene', 'device-effect-not-accessible', 'channel-unavailable', 'approval-receipt-invalid',
  'channel-kind-mismatch', 'content-not-supported', 'approval-hash-mismatch', 'audience-invalid',
  'object-not-available', 'object-not-portable', 'out-of-reach', 'offer-not-received', 'offer-expired',
  'offer-not-open', 'offer-recipient-mismatch', 'offer-owner-changed', 'device-unavailable',
  'operation-not-in-catalog', 'device-power-required', 'duration-exceeds-limit', 'clock-overflow',
  'device-state-unchanged', 'goal-not-found', 'goal-transition-invalid', 'belief-not-found', 'relationship-target-invalid',
  'evidence-not-owned',
]);

export const WorldEmissionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('emitted'), eventId: EventIdSchema }),
]);

export const WorldResolutionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('applied'), attemptId: WorldAttemptIdSchema, baseRevision: RevisionSchema,
    revision: RevisionSchema, events: z.array(WorldEventSchema).max(100_000), perceptions: z.array(WorldPerceptionSchema).max(100_000),
    emission: WorldEmissionSchema, newSnapshot: WorldSnapshotSchema,
  }),
  z.strictObject({
    kind: z.literal('notApplied'), attemptId: WorldAttemptIdSchema, revision: RevisionSchema,
    reason: ResolutionReasonSchema, events: z.tuple([]), perceptions: z.tuple([]),
    emission: z.strictObject({ kind: z.literal('none') }), newSnapshot: WorldSnapshotSchema,
  }),
  z.strictObject({
    kind: z.literal('stale'), attemptId: WorldAttemptIdSchema, expectedRevision: RevisionSchema,
    currentRevision: RevisionSchema, events: z.tuple([]), perceptions: z.tuple([]),
    emission: z.strictObject({ kind: z.literal('none') }), newSnapshot: WorldSnapshotSchema,
  }),
]);
export type WorldResolution = z.infer<typeof WorldResolutionSchema>;

export const PerceivedIdentitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ordinary'), label: z.string().min(1).max(200) }),
  z.strictObject({ kind: z.literal('cover'), label: z.string().min(1).max(200) }),
  z.strictObject({ kind: z.literal('recognized'), label: z.string().min(1).max(200) }),
]);

export const ActorActionUnavailableReasonSchema = z.enum([
  'actor-unavailable', 'capability-missing', 'collision', 'device-unavailable',
  'object-not-available', 'object-not-portable', 'out-of-reach', 'power-required',
  'state-unchanged', 'clock-overflow',
]);
export const ActorActionAvailabilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('available') }),
  z.strictObject({ kind: z.literal('unavailable'), reason: ActorActionUnavailableReasonSchema }),
]);

const ActorInventoryItemSchema = z.strictObject({
  handle: EntityHandleSchema, label: z.string().min(1).max(500),
  quantity: z.number().int().min(1).max(1_000_000).optional(),
  condition: z.enum(['usable', 'damaged', 'unknown']).optional(),
  description: z.string().max(2_000), portable: z.boolean(),
});

export const ActorDeviceOperationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('setPower'), id: DeviceOperationIdSchema, label: z.string().min(1).max(120),
    durationMs: WorldDurationMsSchema, effect: z.strictObject({ kind: z.literal('powerChanged'), state: z.enum(['on', 'off']) }),
    availability: ActorActionAvailabilitySchema,
  }),
  z.strictObject({
    kind: z.literal('setLight'), id: DeviceOperationIdSchema, label: z.string().min(1).max(120),
    durationMs: WorldDurationMsSchema,
    effect: z.strictObject({ kind: z.literal('lightChanged'), placeHandle: PlaceHandleSchema, placeName: z.string().min(1).max(200), level: LightingSchema }),
    availability: ActorActionAvailabilitySchema,
  }),
]);

export const ActorViewEntitySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('character'), handle: EntityHandleSchema, identity: PerceivedIdentitySchema,
    modality: z.array(ModalitySchema).min(1).max(2), placeHandle: PlaceHandleSchema, position: WorldPointSchema,
    availability: z.enum(['available', 'unavailable']),
  }),
  z.strictObject({
    kind: z.literal('object'), handle: EntityHandleSchema, label: z.string().min(1).max(500),
    description: z.string().max(2_000), modality: z.array(ModalitySchema).min(1).max(2),
    placeHandle: PlaceHandleSchema, position: WorldPointSchema, portable: z.boolean(),
    custody: z.enum(['atPlace', 'heldBySelf', 'heldByOther']),
    takeAvailability: ActorActionAvailabilitySchema,
  }),
  z.strictObject({
    kind: z.literal('device'), handle: EntityHandleSchema, label: z.string().min(1).max(200),
    description: z.string().max(2_000), modality: z.array(ModalitySchema).min(1).max(2),
    placeHandle: PlaceHandleSchema, position: WorldPointSchema, availability: z.enum(['available', 'unavailable']),
    power: z.enum(['on', 'off']), operations: z.array(ActorDeviceOperationSchema).max(100),
  }),
]);

const ActorInboxItemSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('observation'), subjectHandle: EntityHandleSchema, modality: ModalitySchema,
    detail: z.string().min(1).max(2_000), fictitiousAt: FictionalInstantSchema,
  }),
  z.strictObject({
    kind: z.literal('communication'), speakerHandle: EntityHandleSchema,
    channelLabel: z.string().min(1).max(120), content: CommunicationContentSchema,
    targetHandle: EntityHandleSchema.nullable(), fictitiousAt: FictionalInstantSchema,
  }),
  z.strictObject({
    kind: z.literal('testimony'), speakerDisplayName: z.string().min(1).max(120),
    channelLabel: z.string().min(1).max(120),
    content: z.strictObject({ kind: z.literal('speech'), text: z.string().min(1).max(16_384).refine((text) => !text.includes('\0')) }),
    fictitiousAt: FictionalInstantSchema,
  }),
  z.strictObject({
    kind: z.literal('offer'), offerHandle: OfferHandleSchema, fromHandle: EntityHandleSchema,
    objectHandle: EntityHandleSchema, objectLabel: z.string().min(1).max(500),
    expiresAt: FictionalInstantSchema,
  }),
  z.strictObject({
    kind: z.literal('worldEvent'), sourceHandle: EntityHandleSchema, modality: ModalitySchema,
    detail: z.string().min(1).max(2_000), fictitiousAt: FictionalInstantSchema,
  }),
]);

const ActorViewPlaceSchema = z.strictObject({
  handle: PlaceHandleSchema, name: z.string().min(1).max(200), description: z.string().max(2_000), lighting: LightingSchema,
  movement: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('here') }),
    z.strictObject({ kind: z.literal('move'), durationMs: WorldDurationMsSchema, availability: ActorActionAvailabilitySchema }),
  ]).optional(),
});

export const ActorWorldViewSchema = z.strictObject({
  kind: z.literal('actor-world-view'),
  revision: RevisionSchema,
  now: WorldClockSchema,
  sceneLabel: z.string().min(1).max(200),
  currentPlace: z.strictObject({ handle: PlaceHandleSchema, name: z.string().min(1).max(200), description: z.string().max(2_000), lighting: LightingSchema }),
  places: z.array(ActorViewPlaceSchema).max(100),
  self: z.strictObject({
    displayName: z.string().min(1).max(200), position: WorldPointSchema,
    capabilities: z.array(CharacterCapabilitySchema).max(20),
    effectiveAvailability: z.enum(['available', 'unavailable']).optional(),
    routine: AvailabilityRoutineSchema.optional(),
    inventory: z.array(ActorInventoryItemSchema).max(100_000).optional(),
    actionDurations: ActionDurationsSchema.optional(),
    goals: z.array(z.strictObject({ id: GoalIdSchema, kind: z.enum(['durable', 'situated', 'shared']), description: z.string().min(1).max(4_000), ownMotivation: z.string().min(1).max(4_000).optional(), reviewConditions: z.array(z.strictObject({ kind: z.literal('circumstance'), description: z.string().min(1).max(2_000) })).max(100).optional(), priority: z.number().finite().min(0).max(1), state: GoalStateSchema, revision: RevisionSchema })).max(10_000),
    beliefs: z.array(z.strictObject({ experienceId: ExperienceIdSchema, content: z.string().min(1).max(8_000), confidence: z.number().finite().min(0).max(1) })).max(20_000),
    relationshipDescriptions: z.array(RelationshipDescriptionSchema).max(10_000).optional(),
    relationships: z.array(z.strictObject({ targetHandle: EntityHandleSchema, stance: z.enum(['unknown', 'wary', 'neutral', 'warm', 'trusting']), confidence: z.number().finite().min(0).max(1), revision: RevisionSchema })).max(20_000),
    experiences: z.array(z.strictObject({ experienceId: ExperienceIdSchema, kind: z.enum(['perception', 'testimony', 'inference', 'belief', 'recollection']), content: z.string().min(1), fictitiousAt: FictionalInstantSchema, confidence: z.number().finite().min(0).max(1) })).max(100_000),
  }),
  entities: z.array(ActorViewEntitySchema).max(100_000),
  channels: z.array(z.strictObject({ handle: ChannelHandleSchema, kind: z.enum(['speech', 'gesture']), label: z.string().min(1).max(120) })).max(1_000),
  offers: z.array(z.strictObject({
    handle: OfferHandleSchema, objectHandle: EntityHandleSchema, objectLabel: z.string().min(1).max(500),
    fromHandle: EntityHandleSchema, expiresAt: FictionalInstantSchema,
  })).max(100_000),
  inbox: z.array(ActorInboxItemSchema).max(100_000),
});
/** Compatibility schema for stored/test projections; freshly built actor views use the complete schema below. */
export const CompleteActorWorldViewSchema = ActorWorldViewSchema.extend({
  places: z.array(ActorViewPlaceSchema.extend({
    movement: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('here') }),
      z.strictObject({ kind: z.literal('move'), durationMs: WorldDurationMsSchema, availability: ActorActionAvailabilitySchema }),
    ]),
  })).max(100),
  self: ActorWorldViewSchema.shape.self.extend({
    effectiveAvailability: z.enum(['available', 'unavailable']),
    routine: AvailabilityRoutineSchema,
    inventory: z.array(ActorInventoryItemSchema).max(100_000),
    actionDurations: ActionDurationsSchema,
  }),
});
export type ActorWorldView = z.infer<typeof CompleteActorWorldViewSchema>;

