import { z } from 'zod';
import { ActorStateCutSchema } from '../domain/actor-state-cut.ts';
import { DramaticStructureViewSchema } from '../domain/dramatic-structure.ts';
import { SceneIdSchema } from '../domain/world-schema.ts';
import { HashSchema } from '../domain/values.ts';
import { hashContinuistaValue } from '../domain/continuista-review.ts';
import { PreparedForkStateSchema } from './prepare-fork-state.ts';
import { createForkIdentityRegistry } from './fork-identities.ts';

export const ForkDramaticSeedSchema=z.strictObject({
  kind:z.literal('fork-dramatic-seed'),source:ActorStateCutSchema.shape.source,
  sourceStructureHash:HashSchema,structure:DramaticStructureViewSchema,
});
export type ForkDramaticSeed=z.infer<typeof ForkDramaticSeedSchema>;
const RequestSchema=z.strictObject({structure:DramaticStructureViewSchema,state:PreparedForkStateSchema});

/** Imported editorial state, never locally emitted episode/scene events. */
export function prepareForkDramaticSeed(raw:unknown){
  const {structure,state}=RequestSchema.parse(raw);
  const fail=()=>{throw new Error('Grafo dramático fuente incompatible con el corte');};
  if(structure.runId!==state.source.runId||structure.structureRevision>state.source.commitIndex)fail();
  const sourceScenes=new Map(state.identities.ids.filter(entry=>entry.kind==='scene').map(entry=>[entry.sourceId,entry.targetId]));
  const targetScenes=new Map(state.snapshot.scenes.map(scene=>[scene.id,scene]));
  function sceneId(id:string){const value=sourceScenes.get(id);if(value===undefined)return fail();const mapped=SceneIdSchema.parse(value);if(!targetScenes.has(mapped))return fail();return mapped;}
  if((structure.activeSceneId===null?null:sceneId(structure.activeSceneId))!==state.snapshot.activeSceneId)fail();
  const claimedScenes=new Set<string>();const episodeIds=new Set<string>();const actIds=new Set<string>();
  const openEpisodes=structure.episodes.filter(episode=>episode.lifecycle==='open');
  if(openEpisodes.length>1||(openEpisodes[0]?.episodeId??null)!==structure.activeEpisodeId)fail();
  function validateCut(cut:z.infer<typeof DramaticStructureViewSchema>['episodes'][number]['openingCut']){
    if(cut.worldRevision>state.source.worldRevision||cut.worldSeq>state.source.worldSeq||cut.commitIndex>state.source.commitIndex||cut.structureRevision>structure.structureRevision)fail();
  }
  for(const [index,episode] of structure.episodes.entries()){
    if(episodeIds.has(episode.episodeId)||episode.ordinal!==index+1||(episode.lifecycle==='open'&&index!==structure.episodes.length-1))fail();episodeIds.add(episode.episodeId);validateCut(episode.openingCut);
    if((episode.lifecycle==='closed')!==(episode.closingCut!==null))fail();
    if(episode.closingCut!==null){validateCut(episode.closingCut);if(episode.closingCut.commitIndex<episode.openingCut.commitIndex||episode.closingCut.worldRevision<episode.openingCut.worldRevision||episode.closingCut.worldSeq<episode.openingCut.worldSeq||episode.closingCut.structureRevision<episode.openingCut.structureRevision)fail();}
    const localScenes=new Set<string>();
    for(const id of episode.sceneIds){const mapped=sceneId(id);if(episode.lifecycle==='closed'&&targetScenes.get(mapped)?.lifecycle.kind!=='closed')fail();if(claimedScenes.has(id))fail();claimedScenes.add(id);localScenes.add(id);}
    const assignedActs=new Set<string>();
    for(const [actIndex,act] of episode.acts.entries()){
      if(actIds.has(act.actId)||act.ordinal!==actIndex+1)fail();actIds.add(act.actId);
      for(const id of act.sceneIds){if(!localScenes.has(id)||assignedActs.has(id))fail();assignedActs.add(id);}
    }
  }
  for(const scene of structure.unassignedLegacyScenes){
    const target=targetScenes.get(sceneId(scene.id));
    if(claimedScenes.has(scene.id)||hashContinuistaValue({...scene,id:sceneId(scene.id)})!==hashContinuistaValue(target))fail();claimedScenes.add(scene.id);
  }
  if(claimedScenes.size!==targetScenes.size)fail();
  if(structure.activeSceneId!==null){
    const active=targetScenes.get(sceneId(structure.activeSceneId));if(active?.lifecycle.kind!=='open')fail();
    if(structure.activeEpisodeId!==null&&!openEpisodes[0]?.sceneIds.includes(structure.activeSceneId))fail();
    if(structure.activeEpisodeId===null&&!structure.unassignedLegacyScenes.some(scene=>scene.id===structure.activeSceneId))fail();
  }
  const identities=createForkIdentityRegistry({sourceRunId:state.source.runId,targetRunId:state.targetRunId,restored:state.identities});
  const sourceStructureHash=hashContinuistaValue(structure);
  const localCut={worldRevision:0,worldSeq:state.source.worldSeq,structureRevision:0,commitIndex:0};
  const targetStructure=DramaticStructureViewSchema.parse({...structure,runId:state.targetRunId,structureRevision:0,
    activeEpisodeId:structure.activeEpisodeId===null?null:identities.id('episode',structure.activeEpisodeId),activeSceneId:state.snapshot.activeSceneId,
    episodes:structure.episodes.map(episode=>({...episode,episodeId:identities.id('episode',episode.episodeId),
      openingCut:localCut,closingCut:episode.lifecycle==='closed'?localCut:null,consequenceEventIds:[],openLines:[],
      sceneIds:episode.sceneIds.map(sceneId),acts:episode.acts.map(act=>({...act,actId:identities.id('act',act.actId),sceneIds:act.sceneIds.map(sceneId)})),
      forkOrigins:[...(episode.forkOrigins??[]),{source:state.source,sourceStructureHash,episodeId:episode.episodeId,openingCut:episode.openingCut,closingCut:episode.closingCut,consequenceEventIds:episode.consequenceEventIds,openLines:episode.openLines}],
    })),unassignedLegacyScenes:structure.unassignedLegacyScenes.map(scene=>targetScenes.get(sceneId(scene.id))),
  });
  return {seed:ForkDramaticSeedSchema.parse({kind:'fork-dramatic-seed',source:state.source,sourceStructureHash,structure:targetStructure}),
    state:PreparedForkStateSchema.parse({...state,identities:identities.manifest()})};
}
