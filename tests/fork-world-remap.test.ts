import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { remapForkWorld,remapForkActorKnowledge,type ForkWorldIdentityPort } from '../src/application/fork-world-remap.ts';
import { WorldSnapshotSchema,ActorKnowledgeSchema } from '../src/domain/world-schema.ts';
import { ExperienceSchema } from '../src/domain/experience.ts';
import { RunIdSchema } from '../src/domain/values.ts';
import { setup,actorId } from './fixtures/continuista.ts';
function registry():ForkWorldIdentityPort {
  const ids=new Map<string,string>();const handles=new Map<string,string>();
  return {id:(kind,id)=>{const key=`${kind}/${id}`;let value=ids.get(key);if(value===undefined){value=randomUUID();ids.set(key,value);}return value;},handle:({actorId,sourceHandle})=>{const key=`${actorId}/${sourceHandle}`;let value=handles.get(key);if(value===undefined){value=`fork-${randomUUID()}`;handles.set(key,value);}return value;},continuity:id=>`fork-${id}`};
}

test('fork world remaps typed graph, private references and opaque handles while preserving prose, time and semantics',async()=>{
  const fixture=await setup();try{
    const original=fixture.configuration.worldSnapshot;
    const first=original.entities.find(entity=>entity.kind==='character'&&entity.characterId===actorId);assert.ok(first?.kind==='character');
    const other=original.entities.find(entity=>entity.kind==='character'&&entity.characterId!==actorId);assert.ok(other?.kind==='character');
    const template=other.mind.experiences[0];assert.ok(template);
    const experienceId=randomUUID();const priorId=randomUUID();const eventId=randomUUID();const perceptionId=randomUUID();const goalId=randomUUID();const doorId=randomUUID();const objectId=randomUUID();const heldId=randomUUID();const consumedId=randomUUID();const reservedId=randomUUID();
    const common='basedOn' in template?(({basedOn,...rest})=>{void basedOn;return rest;})(template):template;
    const own=[ExperienceSchema.parse({...template,actorId,experienceId:priorId,content:'Recuerdo previo'}),ExperienceSchema.parse({...common,actorId,kind:'perception',experienceId,eventId,perceptionId,content:`No reemplazar en prosa ${objectId}`})];
    const object=(entityId:string)=>({kind:'object',entityId,label:'Caja',description:`Texto ${objectId}`,collisionRadius:0,blocksMovement:false,portable:true});
    const scene=original.scenes[0];const channel=original.channels[0];assert.ok(scene);assert.ok(channel);
    const offerBase={handle:'offer-h',objectEntityId:objectId,ownerEntityId:first.entityId,recipientCharacterId:actorId,objectRevision:3,createdAt:0,expiresAt:999};
    const offerIds=[randomUUID(),randomUUID(),randomUUID()];
    const snapshot=WorldSnapshotSchema.parse({...original,revision:7,seq:9,
      doors:[{id:doorId,label:'Puerta',state:'locked',transparentWhenClosed:false,soundPassesWhenClosed:true}],
      connections:[{from:first.placeId,to:other.placeId,durationMs:1,arrivalPoint:{x:1,y:1},doorId}],
      perceptualPaths:[{kind:'visual',from:first.placeId,to:other.placeId,distance:1,throughDoorIds:[doorId]},{kind:'auditory',from:first.placeId,to:other.placeId,distance:1,throughDoorIds:[doorId],channelId:channel.id}],
      entities:[...original.entities.map(entity=>entity===first?{...first,mind:{...first.mind,experiences:own,goals:[{kind:'durable',id:goalId,description:'Deseo',priority:1,state:'active',revision:2,history:[experienceId]}],beliefs:[{experienceId,content:'Creencia',confidence:0.6,basedOn:[priorId]}],relationships:[{targetHandle:'entity-h',stance:'warm',confidence:0.8,revision:2,history:[experienceId]}],inventoryKnowledge:[{objectEntityId:objectId,description:'Lo recuerdo'}]}}:entity),object(objectId),object(heldId),object(consumedId),{kind:'device',entityId:randomUUID(),label:'Luz',description:'Dispositivo',placeId:first.placeId,position:{x:1,y:1},collisionRadius:0,blocksMovement:false,availability:'available',power:'off',operations:[{kind:'setLight',id:'encender',label:'Encender',placeId:first.placeId,level:'bright',durationMs:2}]}],
      inventory:[{objectEntityId:objectId,location:{kind:'atPlace',placeId:first.placeId,position:{x:1,y:1}},revision:3},{objectEntityId:heldId,location:{kind:'heldBy',entityId:first.entityId},revision:4},{objectEntityId:consumedId,location:{kind:'consumed',eventId},revision:5}],
      offers:[{...offerBase,id:offerIds[0],state:'open'},{...offerBase,id:offerIds[1],state:'accepted',eventId},{...offerBase,id:offerIds[2],state:'invalidated',cause:'expired',eventId}],
      circumstanceCatalog:{revision:1,provenance:{authoredBy:'synthetic-test',recordedAt:'2026-10-15T00:00:00Z',sourceRefs:[]},environmentConditions:[],objectTemplates:[{id:'caja',object:object(reservedId),allowedPlaceIds:[first.placeId]}]},
    });
    const before=JSON.stringify(snapshot);const identities=registry();const targetRunId=RunIdSchema.parse(randomUUID());
    const fork=remapForkWorld({snapshot,targetRunId,identities,remapExperienceReference:({experienceId})=>identities.id('experience',experienceId),remapExperience:experience=>ExperienceSchema.parse({...experience,runId:targetRunId,experienceId:identities.id('experience',experience.experienceId),...(experience.kind==='perception'?{eventId:identities.id('event',experience.eventId),perceptionId:identities.id('perception',experience.perceptionId)}:{}),...('basedOn'in experience?{basedOn:experience.basedOn.map(id=>identities.id('experience',id))}:{})})});
    assert.equal(JSON.stringify(snapshot),before);assert.equal(fork.runId,targetRunId);assert.equal(fork.revision,0);assert.equal(fork.seq,9);assert.deepEqual(fork.clock,snapshot.clock);assert.deepEqual(fork.places,snapshot.places);
    assert.equal(fork.connections[0]?.doorId,identities.id('door',doorId));assert.deepEqual(fork.perceptualPaths[0]?.throughDoorIds,[identities.id('door',doorId)]);assert.equal(fork.channels[0]?.id,identities.id('channel',channel.id));assert.equal(fork.activeSceneId,identities.id('scene',scene.id));
    const forkActor=fork.entities.find(entity=>entity.kind==='character'&&entity.characterId===actorId);assert.ok(forkActor?.kind==='character');assert.equal(forkActor.preparation.kind,'prepared');if(forkActor.preparation.kind==='prepared')assert.equal(forkActor.preparation.continuityId,'fork-'+(first.preparation.kind==='prepared'?first.preparation.continuityId:''));
    assert.equal(forkActor.mind.goals[0]?.id,identities.id('goal',goalId));assert.deepEqual(forkActor.mind.goals[0]?.history,[identities.id('experience',experienceId)]);assert.equal(forkActor.mind.beliefs[0]?.experienceId,identities.id('experience',experienceId));assert.deepEqual(forkActor.mind.beliefs[0]?.basedOn,[identities.id('experience',priorId)]);assert.equal(forkActor.mind.relationships[0]?.targetHandle,identities.handle({actorId,sourceHandle:'entity-h'}));assert.equal(forkActor.mind.inventoryKnowledge?.[0]?.objectEntityId,identities.id('entity',objectId));assert.equal(forkActor.mind.experiences[1]?.content,`No reemplazar en prosa ${objectId}`);
    assert.deepEqual(fork.inventory[1]?.location,{kind:'heldBy',entityId:identities.id('entity',first.entityId)});assert.deepEqual(fork.inventory[2]?.location,{kind:'consumed',eventId:identities.id('event',eventId)});assert.equal(fork.offers[1]?.state,'accepted');assert.equal(fork.offers[1]?.id,identities.id('offer',offerIds[1]??''));assert.equal(fork.offers[0]?.handle,identities.handle({actorId,sourceHandle:'offer-h'}));assert.equal(fork.circumstanceCatalog?.objectTemplates[0]?.object.entityId,identities.id('entity',reservedId));
    const knowledge=ActorKnowledgeSchema.parse({runId:snapshot.runId,actorId,bindings:[{kind:'entity',handle:'entity-h',entityId:objectId},{kind:'place',handle:'place-h',placeId:first.placeId},{kind:'channel',handle:'channel-h',channelId:channel.id},{kind:'offer',handle:'offer-h',offerId:offerIds[0]}]});
    const remapped=remapForkActorKnowledge({knowledge,targetRunId,identities});assert.equal(remapped.bindings[0]?.handle,forkActor.mind.relationships[0]?.targetHandle);assert.equal(remapped.bindings[3]?.handle,fork.offers[0]?.handle);assert.equal(remapped.runId,targetRunId);assert.equal(remapped.actorId,actorId);assert.notEqual(identities.handle({actorId:'otro',sourceHandle:'entity-h'}),remapped.bindings[0]?.handle);
    const closed=WorldSnapshotSchema.parse({...snapshot,schemaVersion:2,activeSceneId:null,scenes:snapshot.scenes.map(scene=>({...scene,lifecycle:{kind:'closed',startedAt:0,closedAt:1,reason:'Cierre sintético'}}))});
    const closedFork=remapForkWorld({snapshot:closed,targetRunId,identities,remapExperienceReference:({experienceId})=>identities.id('experience',experienceId),remapExperience:experience=>ExperienceSchema.parse({...experience,runId:targetRunId,experienceId:identities.id('experience',experience.experienceId)})});assert.equal(closedFork.activeSceneId,null);assert.equal(closedFork.scenes[0]?.lifecycle.kind,'closed');
    assert.throws(()=>remapForkWorld({snapshot,targetRunId:snapshot.runId,identities,remapExperienceReference:({experienceId})=>experienceId,remapExperience:experience=>experience}),/otra corrida/);
  }finally{fixture.close();}
});
