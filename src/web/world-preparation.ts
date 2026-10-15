import { z } from 'zod';
import { InventoryItemIdSchema } from '../domain/preparation.ts';
import { WorldSnapshotDraftSchema, type RunConfigurationDraft } from '../domain/production.ts';
import { WorldSnapshotSchema, type WorldEntity } from '../domain/world-schema.ts';
import { changeDraftField } from './draft-form.ts';

export const WORLD_SECTIONS = [
  ['places', 'Lugares y planos'], ['scenes', 'Escenas'], ['channels', 'Canales'],
  ['doors', 'Puertas'], ['connections', 'Conexiones'], ['perceptualPaths', 'Trayectos de percepción'],
  ['entities', 'Personajes, objetos y dispositivos'], ['inventory', 'Ubicación de objetos'],
  ['actionDurations', 'Duración de las acciones'],
  ['circumstanceCatalog', 'Catálogo de circunstancias'], ['environment', 'Ambiente inicial'],
] as const;
export type WorldPreparationSection = typeof WORLD_SECTIONS[number][0];
export type WorldCandidate = z.infer<typeof WorldSnapshotDraftSchema>;
export function worldCandidate(draft: RunConfigurationDraft): WorldCandidate {
  return draft.worldSnapshot.kind === 'empty' ? {} : draft.worldSnapshot.value;
}
export function applyWorldSection(input: { draft: RunConfigurationDraft; section: WorldPreparationSection; value: unknown }): RunConfigurationDraft {
  const current = worldCandidate(input.draft);
  const raw = input.section === 'circumstanceCatalog' ? { ...formObject(input.value),
    revision: (current.circumstanceCatalog?.revision ?? 0) + 1,
    provenance: { ...formObject(formObject(input.value).provenance), authoredBy: 'local-user', recordedAt: new Date().toISOString(), sourceRefs: formObject(formObject(input.value).provenance).sourceRefs ?? [] },
  } : input.value;
  const value = WorldSnapshotSchema.shape[input.section].parse(raw);
  const candidate = WorldSnapshotDraftSchema.parse({
    schemaVersion: 1, runId: input.draft.runId, revision: 0, seq: 0,
    ...current, [input.section]: value,
  });
  return changeDraftField({ draft: input.draft, field: 'worldSnapshot', value: candidate });
}
export function confirmNoInitialOffers(draft: RunConfigurationDraft): RunConfigurationDraft {
  const candidate = worldCandidate(draft);
  if ((candidate.offers?.length ?? 0) > 0) throw new Error('El candidato ya conserva ofertas; no se eliminan mediante esta confirmación.');
  return changeDraftField({ draft, field: 'worldSnapshot', value: { ...candidate, offers: [] } });
}
export function chooseActiveScene(input: { draft: RunConfigurationDraft; sceneId: string }): RunConfigurationDraft {
  const candidate = worldCandidate(input.draft);
  const scene = candidate.scenes?.find((entry) => entry.id === input.sceneId);
  if (scene === undefined || scene.lifecycle?.kind !== 'open') throw new Error('Elegí una escena abierta del candidato.');
  return changeDraftField({ draft: input.draft, field: 'worldSnapshot', value: { ...candidate, activeSceneId: scene.id } });
}
export function worldPreparationIssues(draft: RunConfigurationDraft): string[] {
  const parsed = WorldSnapshotSchema.safeParse(worldCandidate(draft));
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(' / ')}: ${issue.message}`);
}
type WorldMapItem = { id: WorldEntity['entityId']; kind: WorldEntity['kind']; label: string; x: number; y: number; radius: number };
export function worldMapItems(draft: RunConfigurationDraft, placeId: string) {
  const world = worldCandidate(draft);
  return (world.entities ?? []).flatMap<WorldMapItem>((entity) => {
    if (entity.kind !== 'object') return entity.placeId !== placeId ? [] : [{
      id: entity.entityId, label: entity.kind === 'character' ? entity.trueDisplayName : entity.label,
      kind: entity.kind, x: entity.position.x, y: entity.position.y, radius: entity.collisionRadius,
    }];
    const location = world.inventory?.find((entry) => entry.objectEntityId === entity.entityId)?.location;
    if (location?.kind === 'atPlace') return location.placeId !== placeId ? [] : [{ id: entity.entityId, label: entity.label, kind: entity.kind,
      x: location.position.x, y: location.position.y, radius: entity.collisionRadius }];
    if (location?.kind === 'heldBy') {
      const holder = world.entities?.find((candidate) => candidate.entityId === location.entityId);
      if (holder?.kind === 'character' && holder.placeId === placeId) return [{ id: entity.entityId, label: entity.label, kind: entity.kind,
        x: holder.position.x, y: holder.position.y, radius: entity.collisionRadius }];
    }
    return [];
  });
}
export function worldReferences(draft: RunConfigurationDraft, field: string, conditionId?: string): { id: string; label: string }[] | undefined {
  const world = worldCandidate(draft);
  switch (field) {
    case 'placeId': case 'placeIds': case 'allowedPlaceIds': case 'from': case 'to':
      return (world.places ?? []).flatMap((place) => place.id === undefined ? [] : [{ id: place.id, label: place.name ?? place.id }]);
    case 'conditionId': return (world.circumstanceCatalog?.environmentConditions ?? []).map((condition) => ({ id: condition.id, label: condition.label }));
    case 'stateId': return (world.circumstanceCatalog?.environmentConditions ?? []).filter((condition) => condition.id === conditionId).flatMap((condition) => condition.states.map((state) => ({ id: state.id, label: `${condition.label}: ${state.description}` })));
    case 'sceneId': return (world.scenes ?? []).flatMap((scene) => scene.id === undefined ? [] : [{ id: scene.id, label: scene.label ?? scene.id }]);
    case 'doorId': case 'throughDoorIds': return (world.doors ?? []).map((door) => ({ id: door.id, label: door.label }));
    case 'channelId': return (world.channels ?? []).map((channel) => ({ id: channel.id, label: channel.label }));
    case 'recognizedCharacterIds': case 'characterId': case 'participantIds': case 'recipientCharacterId': case 'participants':
      return (draft.roster.kind === 'empty' ? [] : draft.roster.value.activeCharacterIds).map((id) => ({ id, label: id }));
    case 'itemId': return (draft.roster.kind === 'empty' ? [] : draft.roster.value.preparedCharacters.flatMap((actor) => actor.inventory.value.map((item) => ({ id: item.itemId, label: `${actor.identity.value.selfReference}: ${item.name} · ${item.quantity} · ${item.condition}` }))));
    case 'objectEntityId': return (world.entities ?? []).filter((entity) => entity.kind === 'object').map((entity) => ({ id: entity.entityId, label: entity.label }));
    case 'entityId': case 'ownerEntityId': return (world.entities ?? []).map((entity) => ({ id: entity.entityId, label: entity.kind === 'character' ? entity.trueDisplayName : entity.label }));
    default: return undefined;
  }
}

export type FormSchema = {
  type?: string | string[] | undefined; properties?: Record<string, FormSchema> | undefined; items?: FormSchema | undefined;
  anyOf?: FormSchema[] | undefined; oneOf?: FormSchema[] | undefined; enum?: unknown[] | undefined; const?: unknown;
  minimum?: number | undefined; maximum?: number | undefined; maxLength?: number | undefined; pattern?: string | undefined;
};
const FormSchemaBoundary: z.ZodType<FormSchema> = z.lazy(() => z.object({
  type: z.union([z.string(), z.array(z.string())]).optional(),
  properties: z.record(z.string(), FormSchemaBoundary).optional(), items: FormSchemaBoundary.optional(),
  anyOf: z.array(FormSchemaBoundary).optional(), oneOf: z.array(FormSchemaBoundary).optional(),
  enum: z.array(z.unknown()).optional(), const: z.unknown().optional(), minimum: z.number().optional(),
  maximum: z.number().optional(), maxLength: z.number().optional(), pattern: z.string().optional(),
}));
export function parseWorldFormSchema(value: unknown): FormSchema { return FormSchemaBoundary.parse(value); }
export function worldSectionForm(section: WorldPreparationSection): FormSchema {
  return FormSchemaBoundary.parse(z.toJSONSchema(WorldSnapshotSchema.shape[section]));
}
export function formObject(value: unknown): Record<string, unknown> {
  return value === undefined ? {} : z.record(z.string(), z.unknown()).parse(value);
}
export function formArray(value: unknown): unknown[] { return value === undefined ? [] : z.array(z.unknown()).parse(value); }
export function formBlank(schema: FormSchema, uuid?: () => string): unknown {
  if (schema.const !== undefined) return schema.const;
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties ?? {}).flatMap(([name, child]) => {
    if (child.const !== undefined) return [[name, child.const]];
    if (name === 'revision') return [[name, 0]];
    if (uuid !== undefined && (name === 'id' || (name === 'entityId' && schema.properties?.kind?.const !== 'heldBy'))) return [[name, child.pattern?.includes('[a-z0-9-]') ? `elemento-${uuid()}` : uuid()]];
    if (child.type === 'string' && child.pattern === undefined && child.enum === undefined) return [[name, '']];
    return [];
  }));
  if (schema.type === 'array') return [];
  return undefined;
}
export function parseWorldNumericInput(text: string): number | undefined {
  if (!text.trim()) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error('Ingresá un número finito.');
  return value;
}

export const CharacterPlacementSchema = z.strictObject({
  characterId: WorldSnapshotSchema.shape.entities.element.options[0].shape.characterId, displayName: z.string().trim().min(1).max(200),
  species: WorldSnapshotSchema.shape.entities.element.options[0].shape.species,
  presentation: WorldSnapshotSchema.shape.entities.element.options[0].shape.presentation,
  placeId: WorldSnapshotSchema.shape.entities.element.options[0].shape.placeId, sceneId: WorldSnapshotSchema.shape.scenes.element.shape.id, x: z.number().finite(), y: z.number().finite(),
  collisionRadius: z.number().finite().min(0).max(100), blocksMovement: z.boolean(),
  availability: WorldSnapshotSchema.shape.entities.element.options[0].shape.availability,
  routine: WorldSnapshotSchema.shape.entities.element.options[0].shape.routine,
  recognitionConfirmed: z.literal(true),
  recognizedCharacterIds: z.array(WorldSnapshotSchema.shape.entities.element.options[0].shape.characterId).max(10_000),
  additionalCapabilities: z.array(z.enum(['observe', 'take', 'offer', 'wait', 'rest'])).max(5),
  materialChoices: z.array(z.strictObject({ itemId: InventoryItemIdSchema, visibleLabel: z.string().trim().min(1).max(500), physicalDescription: z.string().max(2_000), collisionRadius: z.number().finite().min(0).max(100), blocksMovement: z.boolean(), portable: z.boolean() })).max(10_000).default([]),
});
export type CharacterPlacement = z.infer<typeof CharacterPlacementSchema>;
export function placePreparedCharacter(input: { draft: RunConfigurationDraft; placement: unknown; uuid: () => string }): RunConfigurationDraft {
  const placement = CharacterPlacementSchema.parse(input.placement);
  if (input.draft.roster.kind !== 'configured') throw new Error('Confirmá primero el reparto preparado.');
  const prepared = input.draft.roster.value.preparedCharacters.find((actor) => actor.characterId === placement.characterId);
  if (prepared === undefined || !input.draft.roster.value.activeCharacterIds.includes(prepared.characterId)) throw new Error('El personaje debe estar preparado y activo.');
  const current = worldCandidate(input.draft);
  if (current.entities?.some((entity) => entity.kind === 'character' && entity.characterId === prepared.characterId)) throw new Error('El personaje ya está colocado; editá su situación conservando su estado.');
  const place = current.places?.find((candidate) => candidate.id === placement.placeId);
  if (place?.width === undefined || place.height === undefined || placement.x < 0 || placement.y < 0 || placement.x > place.width || placement.y > place.height) throw new Error('Elegí un lugar completo y una posición dentro de su plano.');
  const scene = current.scenes?.find((candidate) => candidate.id === placement.sceneId);
  if (scene?.lifecycle?.kind !== 'open' || !scene.placeIds?.includes(placement.placeId)) throw new Error('Elegí una escena abierta que incluya ese lugar.');
  if (input.draft.continuity.kind !== 'configured' || JSON.stringify(input.draft.continuity.value) !== JSON.stringify(prepared.continuity)) throw new Error('La preparación debe corresponder a la continuidad elegida.');
  const eligible = new Set(input.draft.roster.value.eligibleCharacterIds);
  if (placement.recognizedCharacterIds.some((id) => id === prepared.characterId || !eligible.has(id)) || new Set(placement.recognizedCharacterIds).size !== placement.recognizedCharacterIds.length) throw new Error('El reconocimiento requiere otras identidades elegibles, sin duplicados.');
  const capabilities = prepared.capabilities.value.flatMap((capability) => {
    switch (capability.kind) {
      case 'speech': return ['speak']; case 'gesture': return ['gesture']; case 'movement': return ['move'];
      case 'nonverbal-sound': return ['animalSound']; case 'operate-device': return ['useDevice']; case 'other': return [];
      default: { const exhaustive: never = capability; return exhaustive; }
    }
  });
  const material = new Map(placement.materialChoices.map((choice) => [choice.itemId, choice]));
  if (material.size !== placement.materialChoices.length || material.size !== prepared.inventory.value.length || prepared.inventory.value.some((item) => !material.has(item.itemId))) throw new Error('Elegí las propiedades materiales de cada objeto del inventario preparado, sin omisiones ni añadidos.');
  const initial = prepared.initialExperience.value;
  const experiences = initial.kind === 'run-cut' && initial.runId === input.draft.runId ? initial.experiences : [];
  if (initial.kind === 'run-cut' && initial.runId === input.draft.runId
    && (current.clock === undefined || initial.throughFictionalAt > current.clock.instant || initial.throughWorldSeq > (current.seq ?? 0))) throw new Error('La memoria inicial es posterior al corte de este Escenario.');
  const entityId = input.uuid();
  const actor = WorldSnapshotSchema.shape.entities.element.options[0].parse({
    kind: 'character', entityId, characterId: prepared.characterId, trueDisplayName: placement.displayName,
    species: placement.species, presentation: placement.presentation, placeId: placement.placeId,
    position: { x: placement.x, y: placement.y }, collisionRadius: placement.collisionRadius, blocksMovement: placement.blocksMovement,
    presence: { kind: 'present', sceneId: placement.sceneId },
    preparation: { kind: 'prepared', continuityId: prepared.continuity.continuityId, identityVersion: prepared.identityVersion },
    capabilities: [...new Set([...capabilities, ...placement.additionalCapabilities])], availability: placement.availability, routine: placement.routine,
    mind: {
      goals: prepared.goals.value.map((goal) => ({ kind: goal.kind, id: input.uuid(), sourceGoalId: goal.goalId,
        description: goal.kind === 'shared' ? goal.sharedOutcome : goal.desiredOutcome,
        reviewConditions: goal.reviewConditions, priority: goal.priority, state: goal.status === 'achieved' ? 'completed' : goal.status, revision: 0, history: [],
        ...(goal.kind === 'shared' ? { ownMotivation: goal.ownMotivation, participants: goal.participantIds.filter((id) => id !== prepared.characterId) } : {}) })),
      beliefs: experiences.flatMap((experience) => experience.kind === 'belief' && experience.basedOn.length > 0 ? [{ experienceId: experience.experienceId, content: experience.content, confidence: experience.confidence, basedOn: experience.basedOn }] : []),
      relationships: [], relationshipDescriptions: prepared.relationships.value.map((relationship) => ({ reference: relationship.otherReference, description: relationship.descriptionFromOwnerPerspective, confidence: relationship.confidence, revision: 0 })), recognizedCharacterIds: placement.recognizedCharacterIds, experiences,
    },
  });
  const physicalInventory = prepared.inventory.value.map((item) => {
    const choice = material.get(item.itemId);
    if (choice === undefined) throw new Error('Falta una elección material validada.');
    return { privateName: item.name, privateDescription: item.description, object: WorldSnapshotSchema.shape.entities.element.options[1].parse({ kind: 'object', entityId: input.uuid(), sourceItemId: item.itemId, label: choice.visibleLabel, description: choice.physicalDescription, quantity: item.quantity, condition: item.condition, collisionRadius: choice.collisionRadius, blocksMovement: choice.blocksMovement, portable: choice.portable }) };
  });
  const objects = physicalInventory.map((entry) => entry.object);
  return changeDraftField({ draft: input.draft, field: 'worldSnapshot', value: { schemaVersion: 1, runId: input.draft.runId, revision: 0, seq: 0, ...current,
    inventory: [...(current.inventory ?? []), ...objects.map((object) => ({ objectEntityId: object.entityId, location: { kind: 'heldBy', entityId: actor.entityId }, revision: 0 }))],
    entities: [...(current.entities ?? []), { ...actor, mind: { ...actor.mind, inventoryKnowledge: physicalInventory.map((entry) => ({ objectEntityId: entry.object.entityId, name: entry.privateName, description: entry.privateDescription })) } }, ...objects], scenes: (current.scenes ?? []).map((candidate) => candidate.id === scene.id
      ? { ...candidate, participantIds: [...new Set([...(candidate.participantIds ?? []), prepared.characterId])] } : candidate) } });
}
