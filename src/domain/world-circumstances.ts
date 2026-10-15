import { z } from 'zod';
import { EventIdSchema, PerceptionIdSchema, RevisionSchema, WorldSeqSchema } from './values.ts';
import {
  CircumstanceEffectSchema, CircumstanceOperationSchema, CircumstanceScopeSchema, CircumstanceRejectionReasonSchema,
  WorldEventSchema, WorldPerceptionSchema, WorldSnapshotSchema,
} from './world-schema.ts';
import type { WorldIdSource, WorldSnapshot } from './world-schema.ts';
import { characterCanReceiveAt, canPerceiveCircumstanceAt } from './world.ts';

export { CircumstanceRejectionReasonSchema } from './world-schema.ts';
export type CircumstanceRejectionReason = z.infer<typeof CircumstanceRejectionReasonSchema>;
export type WorldCircumstanceResult = {
  kind: 'applied'; newSnapshot: WorldSnapshot;
  events: z.infer<typeof WorldEventSchema>[]; perceptions: z.infer<typeof WorldPerceptionSchema>[];
} | { kind: 'rejected'; reason: CircumstanceRejectionReason };

function reject(reason: CircumstanceRejectionReason): WorldCircumstanceResult { return { kind: 'rejected', reason }; }

/** A direction changes facts, never an actor's intention. Environmental sound has explicitly local reach. */
export function resolveWorldCircumstance(input: {
  snapshot: unknown; scope: unknown; operation: unknown; operationId: unknown; ids: WorldIdSource;
}): WorldCircumstanceResult {
  const world = WorldSnapshotSchema.parse(input.snapshot);
  const scope = CircumstanceScopeSchema.parse(input.scope);
  const operation = CircumstanceOperationSchema.parse(input.operation);
  const operationId = z.uuid().parse(input.operationId);
  const scene = world.scenes.find((item) => item.id === world.activeSceneId && item.lifecycle.kind === 'open');
  if (scope.kind === 'scene' && (scene === undefined || scope.sceneId !== scene.id)) return reject('scope-unavailable');
  const allowed = (placeId: string) => scope.kind === 'run' || scene?.placeIds.some((id) => id === placeId) === true;
  let changed = world;
  let effect: z.infer<typeof CircumstanceEffectSchema>;
  let locations: string[] = [];
  let modality: 'visual' | 'auditory' = 'visual';
  let detail: string;
  switch (operation.kind) {
    case 'setDoorState': {
      const door = world.doors.find((item) => item.id === operation.doorId);
      if (door === undefined) return reject('target-not-found');
      locations = [...new Set([...world.connections.filter((item) => item.doorId === door.id).flatMap((item) => [item.from, item.to]), ...world.perceptualPaths.filter((path) => path.throughDoorIds.includes(door.id)).flatMap((path) => [path.from, path.to])])];
      if (locations.length === 0) return reject('target-not-found');
      if (!locations.every(allowed)) return reject('outside-scope');
      if (door.state === operation.state) return reject('unchanged');
      changed = { ...world, doors: world.doors.map((item) => item.id === door.id ? { ...item, state: operation.state } : item) };
      effect = { kind: 'doorStateChanged', doorId: door.id, state: operation.state };
      detail = `${door.label}: ${operation.state === 'open' ? 'abierta' : operation.state === 'locked' ? 'cerrada con llave' : 'cerrada'}.`;
      break;
    }
    case 'setLighting': {
      const place = world.places.find((item) => item.id === operation.placeId);
      if (place === undefined) return reject('target-not-found');
      if (!allowed(place.id)) return reject('outside-scope');
      if (place.lighting === operation.level) return reject('unchanged');
      changed = { ...world, places: world.places.map((item) => item.id === place.id ? { ...item, lighting: operation.level } : item) };
      locations = [place.id]; effect = { kind: 'lightingChanged', placeId: place.id, level: operation.level };
      detail = `La iluminación de ${place.name} cambia a ${operation.level === 'dark' ? 'oscuridad' : operation.level === 'dim' ? 'tenue' : operation.level === 'bright' ? 'intensa' : 'normal'}.`;
      break;
    }
    case 'setDeviceAvailability': {
      const device = world.entities.find((item) => item.entityId === operation.deviceEntityId);
      if (device?.kind !== 'device') return reject('target-not-found');
      if (!allowed(device.placeId)) return reject('outside-scope');
      if (device.availability === operation.availability) return reject('unchanged');
      changed = { ...world, entities: world.entities.map((item) => item.entityId === device.entityId ? { ...device, availability: operation.availability } : item) };
      effect = { kind: 'deviceAvailabilityChanged', deviceEntityId: device.entityId, availability: operation.availability };
      detail = ''; // An internal availability flag is not a sensory signal.
      break;
    }
    case 'setEnvironment': {
      const place = world.places.find((item) => item.id === operation.placeId);
      if (place === undefined) return reject('target-not-found');
      if (!allowed(place.id)) return reject('outside-scope');
      const condition = world.circumstanceCatalog?.environmentConditions.find((item) => item.id === operation.conditionId);
      const state = condition?.states.find((item) => item.id === operation.stateId);
      if (condition === undefined || state === undefined) return reject('not-authorized');
      if (world.environment?.some((item) => item.placeId === place.id && item.conditionId === condition.id && item.stateId === state.id)) return reject('unchanged');
      changed = { ...world, environment: [...(world.environment ?? []).filter((item) => item.placeId !== place.id || item.conditionId !== condition.id), { placeId: place.id, conditionId: condition.id, stateId: state.id }] };
      locations = [place.id]; modality = state.modality; detail = state.description;
      effect = { kind: 'environmentChanged', placeId: place.id, conditionId: condition.id, stateId: state.id };
      break;
    }
    case 'appearObject': {
      const place = world.places.find((item) => item.id === operation.placeId);
      if (place === undefined) return reject('target-not-found');
      if (!allowed(place.id)) return reject('outside-scope');
      const template = world.circumstanceCatalog?.objectTemplates.find((item) => item.id === operation.templateId);
      if (template === undefined || !template.allowedPlaceIds.includes(place.id)) return reject('not-authorized');
      const object = template.object;
      if (world.entities.some((item) => item.entityId === object.entityId)) return reject('object-already-exists');
      const point = operation.position;
      if (point.x - object.collisionRadius < 0 || point.y - object.collisionRadius < 0 || point.x + object.collisionRadius > place.width || point.y + object.collisionRadius > place.height) return reject('outside-place');
      const collides = world.entities.some((entity) => {
        if (!entity.blocksMovement && !object.blocksMovement) return false;
        if (entity.kind === 'character' && entity.presence.kind !== 'present') return false;
        const location = entity.kind === 'object' ? world.inventory.find((entry) => entry.objectEntityId === entity.entityId)?.location : { kind: 'atPlace', placeId: entity.placeId, position: entity.position };
        return location?.kind === 'atPlace' && location.placeId === place.id && Math.hypot(point.x - location.position.x, point.y - location.position.y) < object.collisionRadius + entity.collisionRadius;
      });
      if (collides) return reject('collision');
      changed = { ...world, entities: [...world.entities, object], inventory: [...world.inventory, { objectEntityId: object.entityId, revision: RevisionSchema.parse(0), location: { kind: 'atPlace', placeId: place.id, position: point } }] };
      locations = [place.id]; detail = `Aparece ${object.label}.`;
      effect = { kind: 'objectAppeared', templateId: template.id, objectEntityId: object.entityId, placeId: place.id, position: point };
      break;
    }
    default: { const exhaustive: never = operation; return exhaustive; }
  }
  const newSnapshot = WorldSnapshotSchema.parse({ ...changed, revision: RevisionSchema.parse(world.revision + 1), seq: WorldSeqSchema.parse(world.seq + 1) });
  const eventId = EventIdSchema.parse(input.ids.eventId());
  const perceptions: z.infer<typeof WorldPerceptionSchema>[] = [];
  for (const entity of world.entities) {
    if (entity.kind !== 'character' || entity.preparation.kind !== 'prepared' || !characterCanReceiveAt({ snapshot: world, characterId: entity.characterId })) continue;
    const location = locations.find((placeId) => {
      const place = world.places.find((item) => item.id === placeId);
      if (place === undefined) return false;
      const position = operation.kind === 'appearObject' ? operation.position : { x: place.width / 2, y: place.height / 2 };
      const request = { source: { placeId, position }, recipientCharacterId: entity.characterId, modality };
      return canPerceiveCircumstanceAt({ ...request, snapshot: world }) || canPerceiveCircumstanceAt({ ...request, snapshot: newSnapshot });
    });
    if (location === undefined) continue;
    perceptions.push(WorldPerceptionSchema.parse({ kind: 'circumstance', id: PerceptionIdSchema.parse(input.ids.perceptionId()), runId: world.runId, recipientCharacterId: entity.characterId, eventId, placeId: location, modality, detail, fictitiousAt: world.clock.instant }));
  }
  const event = WorldEventSchema.parse({ kind: 'circumstanceChanged', id: eventId, runId: world.runId, seq: newSnapshot.seq, fictitiousAt: world.clock.instant, durationMs: 0, origin: { kind: 'direction', operationId }, effect, effectiveAudience: perceptions.map((item) => item.recipientCharacterId) });
  return { kind: 'applied', newSnapshot, events: [event], perceptions };
}
