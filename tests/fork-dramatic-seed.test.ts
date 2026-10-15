import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setup } from './fixtures/continuista.ts';
import { prepareForkState } from '../src/application/prepare-fork-state.ts';
import { prepareForkDramaticSeed, ForkDramaticSeedSchema } from '../src/application/fork-dramatic-seed.ts';
import { hashContinuistaValue } from '../src/domain/continuista-review.ts';
import { WorldSnapshotSchema } from '../src/domain/world-schema.ts';
import { DramaticStructureViewSchema } from '../src/domain/dramatic-structure.ts';

async function fixture(closed=false){
 const f=await setup();
 const initial=f.configuration.worldSnapshot;
 const snapshot=WorldSnapshotSchema.parse(closed?{...initial,schemaVersion:2,activeSceneId:null,
  scenes:initial.scenes.map(scene=>({...scene,lifecycle:{kind:'closed',startedAt:scene.lifecycle.startedAt,closedAt:initial.clock.instant,reason:'Cierre sintético'}})),
  entities:initial.entities.map(entity=>entity.kind==='character'?{...entity,presence:{kind:'absent'}}:entity)}:initial);
 const cuts=initial.entities.filter(entity=>entity.kind==='character').map(actor=>{
  const read=f.journal.readActorStateCut({runId:initial.runId,actorId:actor.characterId,worldRevision:initial.revision,worldSeq:initial.seq,commitIndex:0});
  assert.ok(read.kind==='found');return {...read.cut,source:{...read.cut.source,snapshotHash:hashContinuistaValue(snapshot)}};
 });
 const state=prepareForkState({snapshot,configuration:f.configuration,cuts,targetRunId:randomUUID()});
 const scene=snapshot.scenes[0];assert.ok(scene);
 const cut={worldRevision:snapshot.revision,worldSeq:snapshot.seq,structureRevision:0,commitIndex:0};
 const structure=DramaticStructureViewSchema.parse({runId:snapshot.runId,structureRevision:0,activeSceneId:snapshot.activeSceneId,
  activeEpisodeId:null,episodes:[],unassignedLegacyScenes:snapshot.scenes});
 return {f,state,scene,cut,structure};
}

test('dramatic fork preserves episode and act grouping as seed with source evidence, never local events',async()=>{
 const x=await fixture();try{
  const episodeId=randomUUID(),actId=randomUUID(),eventId=randomUUID();
  const structure=DramaticStructureViewSchema.parse({...x.structure,activeEpisodeId:episodeId,unassignedLegacyScenes:[],episodes:[{
   episodeId,ordinal:1,title:'Episodio sintético',lifecycle:'open',openingCut:x.cut,closingCut:null,consequenceEventIds:[eventId],openLines:[{lineId:'linea',evidenceEventIds:[eventId]}],sceneIds:[x.scene.id],acts:[{actId,ordinal:1,title:'Acto sintético',sceneIds:[x.scene.id]}],
  }]});
  const before=JSON.stringify({structure,state:x.state});const result=prepareForkDramaticSeed({structure,state:x.state});
  assert.equal(JSON.stringify({structure,state:x.state}),before);assert.ok(ForkDramaticSeedSchema.safeParse(result.seed).success);
  assert.equal(result.seed.sourceStructureHash,hashContinuistaValue(structure));assert.equal(result.seed.structure.structureRevision,0);
  const episode=result.seed.structure.episodes[0];assert.ok(episode);
  assert.notEqual(episode.episodeId,episodeId);assert.notEqual(episode.acts[0]?.actId,actId);
  assert.deepEqual(episode.sceneIds,[x.state.snapshot.scenes[0]?.id]);assert.deepEqual(episode.acts[0]?.sceneIds,episode.sceneIds);
  assert.equal(result.seed.structure.activeEpisodeId,episode.episodeId);assert.equal(result.seed.structure.activeSceneId,x.state.snapshot.activeSceneId);
  assert.deepEqual(episode.openingCut,{worldRevision:0,worldSeq:x.state.source.worldSeq,structureRevision:0,commitIndex:0});assert.equal(episode.closingCut,null);
  assert.deepEqual(episode.consequenceEventIds,[]);assert.deepEqual(episode.openLines,[]);
  assert.deepEqual(episode.forkOrigins?.[0]?.consequenceEventIds,[eventId]);assert.deepEqual(episode.forkOrigins?.[0]?.openLines,structure.episodes[0]?.openLines);
  assert.deepEqual(prepareForkDramaticSeed({structure,state:result.state}),result);
 }finally{x.f.close();}
});

test('dramatic fork preserves closed and interscene states plus older origins without reopening or flattening',async()=>{
 const x=await fixture(true);try{
  for(const closed of [false,true]){
   const episodeId=randomUUID();const prior={source:{...x.state.source,runId:randomUUID()},sourceStructureHash:'a'.repeat(64),episodeId:randomUUID(),openingCut:x.cut,closingCut:x.cut,consequenceEventIds:[randomUUID()],openLines:[]};
   const structure=DramaticStructureViewSchema.parse({...x.structure,activeEpisodeId:closed?null:episodeId,unassignedLegacyScenes:[],episodes:[{episodeId,ordinal:1,title:null,lifecycle:closed?'closed':'open',openingCut:x.cut,closingCut:closed?x.cut:null,consequenceEventIds:[],openLines:[],sceneIds:[x.scene.id],acts:[],forkOrigins:[prior]}]});
   const {seed}=prepareForkDramaticSeed({structure,state:x.state});const episode=seed.structure.episodes[0];assert.ok(episode);
   assert.equal(seed.structure.activeSceneId,null);assert.equal(episode.lifecycle,closed?'closed':'open');assert.equal(seed.structure.activeEpisodeId===null,closed);
   assert.deepEqual(episode.forkOrigins?.[0],prior);assert.equal(episode.forkOrigins?.length,2);
   assert.deepEqual(episode.closingCut,closed?episode.openingCut:null);
  }
  const legacy=prepareForkDramaticSeed({structure:x.structure,state:x.state});assert.deepEqual(legacy.seed.structure.unassignedLegacyScenes,x.state.snapshot.scenes);assert.deepEqual(legacy.seed.structure.episodes,[]);
 }finally{x.f.close();}
});

test('dramatic fork rejects foreign source, broken graph, active mismatch and future editorial cuts',async()=>{
 const x=await fixture();try{
  const request={structure:x.structure,state:x.state};
  const reject=(patch:Record<string,unknown>)=>assert.throws(()=>prepareForkDramaticSeed({...request,structure:{...x.structure,...patch}}),/incompatible/);
  reject({runId:randomUUID()});reject({activeSceneId:null});reject({activeEpisodeId:randomUUID()});reject({unassignedLegacyScenes:[]});
  reject({unassignedLegacyScenes:[{...x.scene,label:'No coincide'}]});reject({unassignedLegacyScenes:[x.scene,x.scene]});
  const episodeId=randomUUID();const episode={episodeId,ordinal:1,title:null,lifecycle:'open',openingCut:x.cut,closingCut:null,consequenceEventIds:[],openLines:[],sceneIds:[x.scene.id],acts:[]};
  const base={...x.structure,activeEpisodeId:episodeId,unassignedLegacyScenes:[]};
  assert.throws(()=>prepareForkDramaticSeed({state:x.state,structure:{...base,episodes:[{...episode,openingCut:{...x.cut,commitIndex:1}}]}}),/incompatible/);
  assert.throws(()=>prepareForkDramaticSeed({state:x.state,structure:{...base,episodes:[{...episode,sceneIds:[randomUUID()]}]}}),/incompatible/);
  assert.throws(()=>prepareForkDramaticSeed({state:x.state,structure:{...base,episodes:[{...episode,acts:[{actId:randomUUID(),ordinal:1,title:'Ajeno',sceneIds:[randomUUID()]}]}]}}),/incompatible/);
  assert.throws(()=>prepareForkDramaticSeed({state:x.state,structure:{...base,episodes:[episode,episode]}}),/incompatible/);
  assert.throws(()=>prepareForkDramaticSeed({state:x.state,structure:{...base,activeEpisodeId:null,episodes:[{...episode,lifecycle:'closed',closingCut:x.cut}]}}),/incompatible/);
 }finally{x.f.close();}
});
