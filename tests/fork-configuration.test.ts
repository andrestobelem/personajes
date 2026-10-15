import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setup,actorId } from './fixtures/continuista.ts';
import { prepareForkState } from '../src/application/prepare-fork-state.ts';
import { prepareForkConfiguration } from '../src/application/fork-configuration.ts';
import { ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { hashContinuistaValue } from '../src/domain/continuista-review.ts';
import { WorldSnapshotSchema } from '../src/domain/world-schema.ts';

async function fixture(){
  const base=await setup();const snapshot=base.configuration.worldSnapshot;
  const cuts=snapshot.entities.flatMap(entity=>{
    if(entity.kind!=='character')return [];
    const read=base.journal.readActorStateCut({runId:snapshot.runId,actorId:entity.characterId,commitIndex:0,worldRevision:snapshot.revision,worldSeq:snapshot.seq});assert.equal(read.kind,'found');if(read.kind!=='found')assert.fail('Missing checkpoint');return [read.cut];
  });return {...base,cuts};
}
const provenance={principalId:'test-operator',recordedAt:'2026-10-15T12:00:00Z',operationId:randomUUID()};

test('fork configuration derives full contexts/fences and human references without transferring audio authorizations',async()=>{
  const f=await fixture();try{
    const sourceConfiguration=ReadyRunConfigurationSchema.parse({...f.configuration,audio:{mode:{kind:'enabled',language:'es',ttsMode:'manual-per-publication',ttsModelId:'test-model',outputFormat:'mp3_44100_128',subtitles:true},speakerSlots:[{characterId:actorId,slot:{kind:'enabled-bound',speechBindingId:randomUUID()}}],narratorSlot:{kind:'enabled-bound',speechBindingId:randomUUID()},soundEffectSlots:[{characterId:'oculto-prueba',slot:{kind:'enabled-bound',soundBindingId:randomUUID()}}]}});
    const cuts=f.cuts.map(cut=>({...cut,source:{...cut.source,configurationHash:hashContinuistaValue(sourceConfiguration)}}));
    const state=prepareForkState({snapshot:sourceConfiguration.worldSnapshot,configuration:sourceConfiguration,cuts,targetRunId:randomUUID()});
    const before=JSON.stringify({sourceConfiguration,state});const result=prepareForkConfiguration({sourceConfiguration,state,name:'Derivada sintética',...provenance});
    assert.equal(JSON.stringify({sourceConfiguration,state}),before);assert.equal(result.configuration.runId,state.targetRunId);assert.equal(result.configuration.configRevision,0);assert.deepEqual(result.configuration.worldSnapshot,state.snapshot);assert.equal(result.configuration.name,'Derivada sintética');
    assert.equal(result.configuration.continuity.revision,0);assert.notEqual(result.configuration.continuity.continuityId,sourceConfiguration.continuity.continuityId);const {contentHash,...continuity}=result.configuration.continuity;assert.equal(contentHash,hashContinuistaValue(continuity));assert.deepEqual(result.configuration.continuity.milestones,sourceConfiguration.continuity.milestones);assert.deepEqual(result.configuration.continuity.inclusions,sourceConfiguration.continuity.inclusions);
    for(const prepared of result.configuration.roster.preparedCharacters){
      const prior=sourceConfiguration.roster.preparedCharacters.find(item=>item.characterId===prepared.characterId);assert.ok(prior);
      assert.equal(prepared.forkOrigin?.sourcePreparedHash,hashContinuistaValue(prior));assert.deepEqual(prepared.forkOrigin?.source,state.source);assert.equal(prepared.identityVersion,prior.identityVersion);assert.equal(prepared.dossierHash,prior.dossierHash);assert.deepEqual(prepared.identity.value,prior.identity.value);assert.equal(prepared.identity.provenance.continuity.contentHash,contentHash);assert.equal(prepared.voice.provenance.continuity.continuityId,result.configuration.continuity.continuityId);
    }
    const worldPrepared=state.snapshot.entities.filter(entity=>entity.kind==='character'&&entity.preparation.kind==='prepared');assert.equal(result.continuityFence.contexts.length,worldPrepared.length);assert.ok(result.continuityFence.contexts.some(context=>context.actorId==='oculto-prueba'),'absent prepared characters retain a private fence');
    for(const context of result.continuityFence.contexts){const prepared=result.configuration.roster.preparedCharacters.find(actor=>actor.characterId===context.actorId);assert.ok(prepared);assert.equal(context.preparedContextHash,hashContinuistaValue(prepared));}
    assert.deepEqual(result.configuration.inferenceProfile,sourceConfiguration.inferenceProfile);assert.deepEqual(result.configuration.budget,sourceConfiguration.budget);assert.deepEqual(result.configuration.audio.mode,sourceConfiguration.audio.mode);assert.deepEqual(result.configuration.audio.speakerSlots[0]?.slot,{kind:'enabled-unbound'});assert.deepEqual(result.configuration.audio.narratorSlot,{kind:'enabled-unbound'});assert.deepEqual(result.configuration.audio.soundEffectSlots[0]?.slot,{kind:'enabled-unbound'});
    const human=result.configuration.humanParticipants[0];const priorHuman=sourceConfiguration.humanParticipants[0];assert.ok(human);assert.ok(priorHuman);assert.deepEqual(human.identity,priorHuman.identity);assert.deepEqual(human.presence.position,priorHuman.presence.position);assert.equal(human.presence.placeId,priorHuman.presence.placeId);assert.notEqual(human.presence.channelId,priorHuman.presence.channelId);if(human.presence.kind==='inScene'&&priorHuman.presence.kind==='inScene')assert.notEqual(human.presence.sceneId,priorHuman.presence.sceneId);
    assert.equal(result.configuration.forkOrigin?.operationId,provenance.operationId);
    assert.throws(()=>prepareForkConfiguration({sourceConfiguration:{...sourceConfiguration,name:'Distinta'},state,name:'Fork',...provenance}),/fuente/);
    assert.throws(()=>prepareForkConfiguration({sourceConfiguration,state:{...state,identities:{...state.identities,continuities:[]}},name:'Fork',...provenance}),/Continuidad/);
  }finally{f.close();}
});

test('fork configuration retains authorized antecedent run/experience identities and closed interscene state',async()=>{
  const f=await fixture();try{
    const priorRun=randomUUID();const priorId=randomUUID();const through=f.configuration.worldSnapshot.clock.instant;
    const sourceConfiguration=ReadyRunConfigurationSchema.parse({...f.configuration,roster:{...f.configuration.roster,preparedCharacters:f.configuration.roster.preparedCharacters.map(actor=>actor.characterId!==actorId?actor:{...actor,initialExperience:{value:{kind:'run-cut',runId:priorRun,throughWorldSeq:1,throughFictionalAt:through,continuity:{continuityId:actor.continuity.continuityId,revision:actor.continuity.revision,contentHash:actor.continuity.contentHash},experiences:[{schemaVersion:1,kind:'belief',experienceId:priorId,runId:priorRun,actorId,content:'Antecedente autorizado',sourceRefs:[],fictitiousAt:through,receivedAt:through,worldSeq:1,confidence:0.4,revision:0,predecessor:{kind:'initial'},basedOn:[]}]},provenance:{kind:'experience-cut',dossierRevision:actor.dossierRevision,dossierHash:actor.dossierHash,continuity:{continuityId:actor.continuity.continuityId,revision:actor.continuity.revision,contentHash:actor.continuity.contentHash},runId:priorRun,throughWorldSeq:1,throughFictionalAt:through,admittedBy:'original-curator',admittedAt:provenance.recordedAt,experienceIds:[priorId]}}})}});
    const snapshot=WorldSnapshotSchema.parse({...sourceConfiguration.worldSnapshot,schemaVersion:2,activeSceneId:null,scenes:sourceConfiguration.worldSnapshot.scenes.map(scene=>({...scene,lifecycle:{kind:'closed',startedAt:scene.lifecycle.startedAt,closedAt:through,reason:'Cierre sintético'}})),entities:sourceConfiguration.worldSnapshot.entities.map(entity=>entity.kind==='character'?{...entity,presence:{kind:'absent'}}:entity)});
    const cuts=f.cuts.map(cut=>({...cut,source:{...cut.source,snapshotHash:hashContinuistaValue(snapshot),configurationHash:hashContinuistaValue(sourceConfiguration)}}));
    const state=prepareForkState({snapshot,configuration:sourceConfiguration,cuts,targetRunId:randomUUID()});
    const result=prepareForkConfiguration({sourceConfiguration,state,name:'Entre escenas',...provenance});assert.equal(result.configuration.worldSnapshot.activeSceneId,null);assert.deepEqual(result.configuration.participantAvailability,[]);assert.ok(result.configuration.worldSnapshot.scenes.every(scene=>scene.lifecycle.kind==='closed'));
    const initial=result.configuration.roster.preparedCharacters.find(actor=>actor.characterId===actorId)?.initialExperience;assert.ok(initial?.value.kind==='run-cut');assert.equal(initial.value.runId,priorRun);assert.equal(initial.value.experiences[0]?.experienceId,priorId);assert.equal(initial.value.continuity.continuityId,result.configuration.continuity.continuityId);assert.ok(initial.provenance.kind==='experience-cut');assert.equal(initial.provenance.admittedBy,'original-curator');assert.equal(initial.provenance.runId,priorRun);
    assert.equal(result.configuration.audio.mode.kind,'disabled');assert.deepEqual(result.configuration.audio,sourceConfiguration.audio);
  }finally{f.close();}
});

test('fork configuration remaps exact device capabilities and preserves semantic device references',async()=>{
  const f=await fixture();try{
    const deviceId=randomUUID();const place=f.configuration.worldSnapshot.places[0];assert.ok(place);
    const worldSnapshot=WorldSnapshotSchema.parse({...f.configuration.worldSnapshot,entities:[...f.configuration.worldSnapshot.entities.map(entity=>entity.kind==='character'&&entity.characterId===actorId?{...entity,capabilities:[...entity.capabilities,'useDevice']}:entity),{kind:'device',entityId:deviceId,label:'Dispositivo sintético',description:'Prueba',placeId:place.id,position:{x:0,y:0},collisionRadius:0,blocksMovement:false,availability:'available',power:'off',operations:[]}]});
    const sourceConfiguration=ReadyRunConfigurationSchema.parse({...f.configuration,worldSnapshot,roster:{...f.configuration.roster,preparedCharacters:f.configuration.roster.preparedCharacters.map(actor=>actor.characterId!==actorId?actor:{...actor,capabilities:{...actor.capabilities,value:[...actor.capabilities.value,{capabilityId:'device-exact',kind:'operate-device',deviceId,description:'Referencia exacta'},{capabilityId:'device-semantic',kind:'operate-device',deviceId:'telefono-zapato',description:'Referencia semántica'}]}})}});
    const cuts=f.cuts.map(cut=>({...cut,source:{...cut.source,snapshotHash:hashContinuistaValue(worldSnapshot),configurationHash:hashContinuistaValue(sourceConfiguration)}}));
    const state=prepareForkState({snapshot:worldSnapshot,configuration:sourceConfiguration,cuts,targetRunId:randomUUID()});const result=prepareForkConfiguration({sourceConfiguration,state,name:'Dispositivos',...provenance});
    const capabilities=result.configuration.roster.preparedCharacters.find(actor=>actor.characterId===actorId)?.capabilities.value;assert.ok(capabilities);
    const exact=capabilities.find(capability=>capability.capabilityId==='device-exact');const semantic=capabilities.find(capability=>capability.capabilityId==='device-semantic');assert.ok(exact?.kind==='operate-device');assert.ok(semantic?.kind==='operate-device');assert.notEqual(exact.deviceId,deviceId);assert.equal(exact.deviceId,state.snapshot.entities.find(entity=>entity.kind==='device')?.entityId);assert.equal(semantic.deviceId,'telefono-zapato');
  }finally{f.close();}
});
