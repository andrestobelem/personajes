import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setup,actorId } from './fixtures/continuista.ts';
import { prepareForkState, PreparedForkStateSchema } from '../src/application/prepare-fork-state.ts';
import { WorldSnapshotSchema } from '../src/domain/world-schema.ts';
import { ActorStateCutSchema } from '../src/domain/actor-state-cut.ts';
import { hashContinuistaValue } from '../src/domain/continuista-review.ts';
import { freezeExperience } from '../src/application/experience-envelope.ts';

async function source(){
 const f=await setup();const snapshot=f.configuration.worldSnapshot;
 const cut=f.journal.readActorStateCut({runId:snapshot.runId,actorId,commitIndex:0,worldRevision:snapshot.revision,worldSeq:snapshot.seq});
 assert.equal(cut.kind,'found');if(cut.kind!=='found')assert.fail('Missing actual checkpoint');
 const cuts=snapshot.entities.filter(entity=>entity.kind==='character').map(actor=>{const read=f.journal.readActorStateCut({runId:snapshot.runId,actorId:actor.characterId,commitIndex:0,worldRevision:snapshot.revision,worldSeq:snapshot.seq});assert.ok(read.kind==='found');return read.cut;});
 return {...f,snapshot,cut:cut.cut,cuts};
}

test('fork state transforms an exact SQLite checkpoint and replays its identity manifest without source writes',async()=>{
 const f=await source();try{
  const before=f.journal.loadWorld({runId:f.snapshot.runId});
  const request={snapshot:f.snapshot,configuration:f.configuration,cuts:f.cuts,targetRunId:randomUUID()};
  const result=prepareForkState(request);
  assert.equal(PreparedForkStateSchema.safeParse({...result,targetRunId:randomUUID()}).success,false);
  assert.equal(PreparedForkStateSchema.safeParse({...result,actors:[]}).success,false);
  assert.equal(result.kind,'prepared-fork-state');assert.equal(result.snapshot.runId,request.targetRunId);assert.equal(result.snapshot.revision,0);assert.equal(result.snapshot.seq,f.snapshot.seq);assert.deepEqual(result.snapshot.clock,f.snapshot.clock);
  assert.equal(result.actors.length,f.cuts.length);assert.equal(result.actors[0]?.knowledge.kind,f.cut.knowledge.kind);
  for(const memory of result.actors[0]?.experiences??[]){assert.equal(memory.envelope.runId,request.targetRunId);assert.equal(memory.envelope.forkOrigin?.sourceSnapshotHash,f.cut.source.snapshotHash);}
  const replay=prepareForkState({...request,restoredIdentities:result.identities});assert.deepEqual(replay,result);
  assert.deepEqual(f.journal.loadWorld({runId:f.snapshot.runId}),before);
  assert.equal(f.journal.loadWorld({runId:request.targetRunId}),undefined,'a plan is not a published Ready run');
 }finally{f.close();}
});

test('fork state preserves interscene closure and missing recognition without inventing scene or knowledge',async()=>{
 const f=await source();try{
  const snapshot=WorldSnapshotSchema.parse({...f.snapshot,schemaVersion:2,activeSceneId:null,
   scenes:f.snapshot.scenes.map(scene=>({...scene,lifecycle:{kind:'closed',startedAt:scene.lifecycle.startedAt,closedAt:f.snapshot.clock.instant,reason:'Prueba sintética entre escenas'}})),
   entities:f.snapshot.entities.map(entity=>entity.kind==='character'?{...entity,presence:{kind:'absent'}}:entity)});
  const result=prepareForkState({snapshot,configuration:f.configuration,cuts:f.cuts.map(item=>({...item,source:{...item.source,snapshotHash:hashContinuistaValue(snapshot)},knowledge:{kind:'unavailable',reason:'knowledge-not-recorded'}})),targetRunId:randomUUID()});
  assert.equal(result.snapshot.activeSceneId,null);assert.ok(result.snapshot.scenes.every(scene=>scene.lifecycle.kind==='closed'));
  assert.deepEqual(result.actors[0]?.knowledge,{kind:'unavailable',reason:'knowledge-not-recorded'});
  assert.equal(result.snapshot.entities.some(entity=>entity.kind==='character'&&entity.presence.kind==='present'),false);
 }finally{f.close();}
});

test('fork state refuses mixed sources, incomplete archives, future memories and forged target references',async()=>{
 const f=await source();try{
  const request={snapshot:f.snapshot,configuration:f.configuration,cuts:f.cuts,targetRunId:randomUUID()};
  assert.throws(()=>prepareForkState({...request,cuts:[]}),/./);
  assert.throws(()=>prepareForkState({...request,cuts:[f.cut,f.cut]}),/incompleto/);
  assert.throws(()=>prepareForkState({...request,cuts:[{...f.cut,source:{...f.cut.source,snapshotHash:'f'.repeat(64)}}]}),/inconsistente/);
  assert.throws(()=>prepareForkState({...request,configuration:{...f.configuration,name:'No es la misma configuración'}}),/inconsistente/);
  const badKnowledge=ActorStateCutSchema.parse({...f.cut,knowledge:{kind:'recorded',revision:1,atWorldSeq:f.snapshot.seq,value:{runId:f.snapshot.runId,actorId,bindings:[{kind:'entity',handle:'no-es-un-permiso',entityId:randomUUID()}]}}});
  assert.throws(()=>prepareForkState({...request,cuts:f.cuts.map(item=>item.actorId===actorId?badKnowledge:item)}),/destino ausente/);
  const future=freezeExperience({schemaVersion:1,kind:'belief',experienceId:randomUUID(),runId:f.snapshot.runId,actorId,content:'No se admite futuro',sourceRefs:[],fictitiousAt:f.snapshot.clock.instant+1,receivedAt:f.snapshot.clock.instant,worldSeq:f.snapshot.seq,confidence:0.3,revision:0,predecessor:{kind:'initial'},basedOn:[]});
  assert.throws(()=>prepareForkState({...request,cuts:f.cuts.map(item=>item.actorId===actorId?{...item,experiences:[...item.experiences,future]}:item)}),/posterior/);
 }finally{f.close();}
});

test('fork state rejects cross-actor experience aliases and orphan relationship history',async()=>{
 const f=await source();try{
  const id=randomUUID();const repeated=f.cuts.map(cut=>({...cut,experiences:[freezeExperience({schemaVersion:1,kind:'belief',experienceId:id,runId:f.snapshot.runId,actorId:cut.actorId,content:`Memoria propia de ${cut.actorId}`,sourceRefs:[],fictitiousAt:f.snapshot.clock.instant,receivedAt:f.snapshot.clock.instant,worldSeq:f.snapshot.seq,confidence:0.4,revision:0,predecessor:{kind:'initial'},basedOn:[]})]}));
  assert.ok(repeated.length>1,'fixture must contain distinct owners');
  assert.throws(()=>prepareForkState({snapshot:f.snapshot,configuration:f.configuration,cuts:repeated,targetRunId:randomUUID()}),/ambiguo entre personajes/);
  const snapshot=WorldSnapshotSchema.parse({...f.snapshot,entities:f.snapshot.entities.map(entity=>entity.kind==='character'&&entity.characterId===actorId?{...entity,mind:{...entity.mind,relationships:[{targetHandle:'desconocido',stance:'wary',confidence:0.6,revision:0,history:[randomUUID()]}]}}:entity)});
  const cuts=f.cuts.map(cut=>({...cut,source:{...cut.source,snapshotHash:hashContinuistaValue(snapshot)}}));
  assert.throws(()=>prepareForkState({snapshot,configuration:f.configuration,cuts,targetRunId:randomUUID()}),/no admitida/);
 }finally{f.close();}
});
