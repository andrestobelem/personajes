import { WorldSnapshotSchema, ActorKnowledgeSchema, type WorldSnapshot, type ActorKnowledge } from '../domain/world-schema.ts';
import type { Experience } from '../domain/experience.ts';
import { RunIdSchema, type RunId } from '../domain/values.ts';

/** Shared identity registry; handles are opaque and local to the owning actor. */
export type ForkWorldIdentityPort = {
  id(kind:'entity'|'door'|'channel'|'scene'|'offer'|'event'|'perception'|'goal'|'experience',sourceId:string):string;
  handle(input:{actorId:string;sourceHandle:string}):string;
  continuity(sourceId:string):string;
};

/** Explicit domain remap only: prose and semantic labels are never searched or replaced. */
export function remapForkWorld(input:{snapshot:WorldSnapshot;targetRunId:RunId;identities:ForkWorldIdentityPort;remapExperience:(experience:Experience)=>Experience;remapExperienceReference:(input:{actorId:string;experienceId:string})=>string}):WorldSnapshot {
  const source=WorldSnapshotSchema.parse(input.snapshot);
  const runId=RunIdSchema.parse(input.targetRunId);
  if(source.runId===runId)throw new Error('El fork requiere otra corrida');
  const ids=input.identities;
  const entities=source.entities.map((entity):unknown=>{
    switch(entity.kind){
      case 'object':return {...entity,entityId:ids.id('entity',entity.entityId)};
      case 'device':return {...entity,entityId:ids.id('entity',entity.entityId)};
      case 'character':return {...entity,entityId:ids.id('entity',entity.entityId),
        presence:entity.presence.kind==='absent'?entity.presence:{...entity.presence,sceneId:ids.id('scene',entity.presence.sceneId)},
        preparation:entity.preparation.kind==='notPrepared'?entity.preparation:{...entity.preparation,continuityId:ids.continuity(entity.preparation.continuityId)},
        mind:{...entity.mind,
          goals:entity.mind.goals.map(goal=>({...goal,id:ids.id('goal',goal.id),history:goal.history.map(id=>input.remapExperienceReference({actorId:entity.characterId,experienceId:id}))})),
          beliefs:entity.mind.beliefs.map(belief=>({...belief,experienceId:input.remapExperienceReference({actorId:entity.characterId,experienceId:belief.experienceId}),basedOn:belief.basedOn.map(id=>input.remapExperienceReference({actorId:entity.characterId,experienceId:id}))})),
          relationships:entity.mind.relationships.map(relationship=>({...relationship,targetHandle:ids.handle({actorId:entity.characterId,sourceHandle:relationship.targetHandle}),history:relationship.history.map(id=>input.remapExperienceReference({actorId:entity.characterId,experienceId:id}))})),
          ...(entity.mind.inventoryKnowledge===undefined?{}:{inventoryKnowledge:entity.mind.inventoryKnowledge.map(item=>({...item,objectEntityId:ids.id('entity',item.objectEntityId)}))}),
          experiences:entity.mind.experiences.map(experience=>input.remapExperience(experience)),
        }};
      default:{const exhaustive:never=entity;throw new Error(`Entidad no contemplada: ${exhaustive}`);}
    }
  });
  return WorldSnapshotSchema.parse({...source,runId,revision:0,
    doors:source.doors.map(door=>({...door,id:ids.id('door',door.id)})),
    connections:source.connections.map(connection=>({...connection,doorId:connection.doorId===null?null:ids.id('door',connection.doorId)})),
    perceptualPaths:source.perceptualPaths.map(path=>({...path,throughDoorIds:path.throughDoorIds.map(id=>ids.id('door',id)),...(path.kind==='auditory'?{channelId:ids.id('channel',path.channelId)}:{})})),
    channels:source.channels.map(channel=>({...channel,id:ids.id('channel',channel.id)})),entities,
    ...(source.humanParticipants===undefined?{}:{humanParticipants:source.humanParticipants.map(human=>({...human,presence:{...human.presence,channelId:ids.id('channel',human.presence.channelId),...(human.presence.kind==='inScene'?{sceneId:ids.id('scene',human.presence.sceneId)}:{})}}))}),
    inventory:source.inventory.map(entry=>({...entry,objectEntityId:ids.id('entity',entry.objectEntityId),location:entry.location.kind==='atPlace'?entry.location:entry.location.kind==='heldBy'?{...entry.location,entityId:ids.id('entity',entry.location.entityId)}:{...entry.location,eventId:ids.id('event',entry.location.eventId)}})),
    scenes:source.scenes.map(scene=>({...scene,id:ids.id('scene',scene.id)})),
    activeSceneId:source.activeSceneId===null?null:ids.id('scene',source.activeSceneId),
    offers:source.offers.map(offer=>({...offer,id:ids.id('offer',offer.id),handle:ids.handle({actorId:offer.recipientCharacterId,sourceHandle:offer.handle}),objectEntityId:ids.id('entity',offer.objectEntityId),ownerEntityId:ids.id('entity',offer.ownerEntityId),...(offer.state==='open'?{}:{eventId:ids.id('event',offer.eventId)})})),
    ...(source.circumstanceCatalog===undefined?{}:{circumstanceCatalog:{...source.circumstanceCatalog,objectTemplates:source.circumstanceCatalog.objectTemplates.map(template=>({...template,object:{...template.object,entityId:ids.id('entity',template.object.entityId)}}))}}),
  });
}

export function remapForkActorKnowledge(input:{knowledge:ActorKnowledge;targetRunId:RunId;identities:ForkWorldIdentityPort}):ActorKnowledge {
  const knowledge=ActorKnowledgeSchema.parse(input.knowledge);const runId=RunIdSchema.parse(input.targetRunId);
  if(knowledge.runId===runId)throw new Error('El fork requiere otra corrida');
  const ids=input.identities;
  return ActorKnowledgeSchema.parse({...knowledge,runId,bindings:knowledge.bindings.map(binding=>{
    const handle=ids.handle({actorId:knowledge.actorId,sourceHandle:binding.handle});
    switch(binding.kind){
      case 'entity':return {...binding,handle,entityId:ids.id('entity',binding.entityId)};
      case 'place':return {...binding,handle};
      case 'channel':return {...binding,handle,channelId:ids.id('channel',binding.channelId)};
      case 'human':return {...binding,handle};
      case 'offer':return {...binding,handle,offerId:ids.id('offer',binding.offerId)};
      default:{const exhaustive:never=binding;throw new Error(`Binding no contemplado: ${exhaustive}`);}
    }
  })});
}
