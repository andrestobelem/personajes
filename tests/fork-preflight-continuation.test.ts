import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setup } from './fixtures/continuista.ts';
import { prepareForkState } from '../src/application/prepare-fork-state.ts';
import { prepareForkConfiguration } from '../src/application/fork-configuration.ts';
import { WorldSnapshotSchema } from '../src/domain/world-schema.ts';
import { hashContinuistaValue } from '../src/domain/continuista-review.ts';
import { ReadyRunConfigurationSchema,resolveConfiguredSessionMode,validateReadyConfiguration } from '../src/application/production-preflight.ts';

async function fixture(){
 const f=await setup();const initial=f.configuration.worldSnapshot;
 const snapshot=WorldSnapshotSchema.parse({...initial,schemaVersion:2,activeSceneId:null,scenes:initial.scenes.map(scene=>({...scene,lifecycle:{kind:'closed',startedAt:scene.lifecycle.startedAt,closedAt:initial.clock.instant,reason:'Cierre de prueba'}})),entities:initial.entities.map(entity=>entity.kind==='character'?{...entity,presence:{kind:'absent'}}:entity)});
 const cuts=initial.entities.filter(entity=>entity.kind==='character').map(actor=>{const cut=f.journal.readActorStateCut({runId:initial.runId,actorId:actor.characterId,commitIndex:0,worldRevision:initial.revision,worldSeq:initial.seq});assert.ok(cut.kind==='found');return {...cut.cut,source:{...cut.cut.source,snapshotHash:hashContinuistaValue(snapshot)}};});
 const state=prepareForkState({snapshot,configuration:f.configuration,cuts,targetRunId:randomUUID()});
 const {configuration}=prepareForkConfiguration({sourceConfiguration:f.configuration,state,name:'Derivada entre escenas',principalId:'test',recordedAt:'2026-10-15T12:00:00.000Z',operationId:randomUUID()});
 return {f,configuration};
}

test('derived continuation validates every common requirement between scenes and permits explicit direction',async()=>{
 const {f,configuration}=await fixture();try{
  assert.deepEqual(validateReadyConfiguration(configuration),[]);assert.equal(configuration.worldSnapshot.activeSceneId,null);assert.deepEqual(configuration.participantAvailability,[]);
  const mode={kind:'director',runId:configuration.runId,scope:{kind:'run'}};
  assert.deepEqual(resolveConfiguredSessionMode({candidate:mode,readWorldConfiguration:()=>configuration}),mode);
  assert.equal(resolveConfiguredSessionMode({candidate:{...mode,runId:randomUUID()},readWorldConfiguration:()=>configuration}),null);
  const {forkOrigin,...ordinary}=configuration;assert.ok(forkOrigin);assert.ok(validateReadyConfiguration(ReadyRunConfigurationSchema.parse(ordinary)).some(issue=>issue.code==='scene-not-open'));
 }finally{f.close();}
});

test('interscene continuation does not bypass capabilities, audio or human placement validation',async()=>{
 const {f,configuration}=await fixture();try{
  const actorId=configuration.roster.activeCharacterIds[0];assert.ok(actorId);
  const bad=ReadyRunConfigurationSchema.parse({...configuration,worldSnapshot:{...configuration.worldSnapshot,entities:configuration.worldSnapshot.entities.map(entity=>entity.kind==='character'&&entity.characterId===actorId?{...entity,capabilities:[]}:entity)},audio:{...configuration.audio,mode:{kind:'enabled',language:'es',ttsMode:'manual-per-publication',ttsModelId:'modelo-no-validado',outputFormat:'mp3_44100_128',subtitles:true}},humanParticipants:[{identity:{participantId:'humano',displayName:'Humano',identityMarkdown:'Identidad sintética',lifeStoryMarkdown:'Historia sintética'},presence:{kind:'remote',placeId:configuration.worldSnapshot.places[0]?.id,position:{x:999,y:999},channelId:configuration.worldSnapshot.channels[0]?.id}}]});
  const issues=validateReadyConfiguration(bad);assert.ok(issues.some(issue=>issue.code==='human-participant-invalid'));assert.ok(issues.some(issue=>issue.code==='audio-requires-confirmed-variety'));assert.ok(issues.some(issue=>issue.field.includes('capabilities')));
 }finally{f.close();}
});
