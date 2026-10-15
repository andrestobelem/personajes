import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { openJournal } from '../src/adapters/journal.ts';
import { createRunInspectorApplication } from '../src/application/run-inspector.ts';
import { InspectorRequestSchema,InspectorViewSchema } from '../src/domain/run-inspector.ts';
import { WorldSnapshotSchema } from '../src/domain/world-schema.ts';
import { PrivateMindView,isInspectorViewForRequest } from '../src/web/InspectorPanel.tsx';
import { freezeExperience } from '../src/application/experience-envelope.ts';
import { setup,actorId } from './fixtures/continuista.ts';

test('inspector pages the exact SQLite private checkpoint without current reads, ranking or other actor data',async()=>{
  const fixture=await setup();const directory=mkdtempSync(join(tmpdir(),'personajes-cut-inspector-'));const journal=openJournal({path:join(directory,'world.sqlite')});
  try {
    const original=fixture.configuration.worldSnapshot;
    const own=original.entities.find(entity=>entity.kind==='character'&&entity.characterId===actorId);assert.ok(own?.kind==='character');
    const template=original.entities.flatMap(entity=>entity.kind==='character'?entity.mind.experiences:[])[0];assert.ok(template);
    const experiences=Array.from({length:125},(_,index)=>({...template,experienceId:randomUUID(),actorId,content:`Experiencia privada ${index} <script>`,worldSeq:0}));
    const initial=WorldSnapshotSchema.parse({...original,revision:0,seq:0,entities:original.entities.map(entity=>entity===own?{...entity,mind:{...entity.mind,experiences}}:entity)});
    const prepared=fixture.configuration.roster.preparedCharacters[0];assert.ok(prepared);
    journal.registerWorldRun({initialSnapshot:initial,configurationRevision:0,configuration:{synthetic:true},continuityFence:{kind:'prepared-contexts',atWorldSeq:0,contexts:[{actorId,continuityId:prepared.continuity.continuityId,continuityRevision:prepared.continuity.revision,continuityContentHash:prepared.continuity.contentHash,identityVersion:prepared.identityVersion,preparedContextHash:'a'.repeat(64)}]},lifecycle:'running'});
    let liveReads=0;
    const application=createRunInspectorApplication({journal:{...journal,readActorKnowledge:request=>{liveReads++;return journal.readActorKnowledge(request);}}});
    const inspect=(memoryOffset:number,memoryLimit=100)=>{const result=application.inspect({runId:initial.runId,characterId:actorId,worldRevision:0,atWorldSeq:0,memoryOffset,memoryLimit});assert.equal(result.kind,'found');if(result.kind!=='found')assert.fail('Missing checkpoint');return result.view;};
    const first=inspect(0);const second=inspect(100);const end=inspect(999);
    assert.equal(liveReads,0);assert.equal(first.recognitionKnowledge.kind,'checkpoint');
    const memory=first.memorySearch;assert.equal(memory.kind,'checkpoint');if(memory.kind!=='checkpoint'||second.memorySearch.kind!=='checkpoint'||end.memorySearch.kind!=='checkpoint')assert.fail('Missing archive');
    assert.equal(memory.items.length,100);assert.equal(memory.total,125);assert.equal(memory.hasMore,true);assert.equal(second.memorySearch.items.length,25);assert.equal(second.memorySearch.hasMore,false);assert.equal(end.memorySearch.offset,125);assert.equal(end.memorySearch.items.length,0);
    assert.deepEqual([...memory.items,...second.memorySearch.items].map(item=>item.envelope.experienceId),experiences.map(item=>item.experienceId).sort());
    for(const item of memory.items)assert.deepEqual(item,freezeExperience(item.envelope));
    assert.equal(first.mind.experiences.length,125);assert.equal(second.mind.experiences.length,125);
    assert.doesNotMatch(JSON.stringify(first),/SECRET_PRIVATE_OTHER_MEMORY|SECRET_OTHER_PREPARATION/);
    const html=renderToStaticMarkup(React.createElement(PrivateMindView,{view:first,onMemoryPage:()=>{}}));assert.match(html,/Archivo de experiencias admitidas/);assert.match(html,/Memoria siguiente/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
    const live=application.inspect({runId:initial.runId,characterId:actorId,memoryOffset:100});assert.equal(live.kind,'found');if(live.kind!=='found')assert.fail('Missing current');assert.equal(live.view.memorySearch.kind,'unavailable');assert.equal(liveReads,1);
    // A late current response may share the historical sequence: it must stay hidden.
    assert.equal(isInspectorViewForRequest(live.view,{runId:initial.runId,characterId:actorId,atWorldSeq:0}),false);
    assert.equal(isInspectorViewForRequest(live.view,{runId:initial.runId,characterId:actorId,worldRevision:0}),false);
    assert.equal(isInspectorViewForRequest(first,{runId:initial.runId,characterId:actorId}),false);
    assert.equal(isInspectorViewForRequest(first,{runId:initial.runId,characterId:actorId,atWorldSeq:0,worldRevision:0}),true);
    assert.equal(isInspectorViewForRequest(first,{runId:initial.runId,characterId:actorId,atWorldSeq:0,worldRevision:1}),false);
    assert.equal(isInspectorViewForRequest(first,{runId:initial.runId,characterId:'other',atWorldSeq:0}),false);
    assert.equal(InspectorRequestSchema.safeParse({runId:initial.runId,characterId:actorId,memoryLimit:101}).success,false);
    assert.equal(InspectorViewSchema.safeParse({...first,memorySearch:{...memory,items:[{...memory.items[0],envelope:{...memory.items[0]?.envelope,actorId:'other'}}]}}).success,false);
  }finally{journal.close();fixture.close();rmSync(directory,{recursive:true,force:true});}
});

test('legacy or invalid checkpoint is explicit and never substituted with current knowledge',async()=>{
  const fixture=await setup();try{
    for(const reason of ['checkpoint-not-recorded','invalid-cut','actor-not-in-cut']) {
      const app=createRunInspectorApplication({journal:{...fixture.journal,readActorStateCut:()=>({kind:'unavailable',reason}),readActorKnowledge:()=>{throw new Error('Forbidden live fallback');}}});
      const result=app.inspect({runId:fixture.claim.runId,characterId:actorId,atWorldSeq:fixture.configuration.worldSnapshot.seq});assert.equal(result.kind,'found');if(result.kind!=='found')assert.fail('Missing snapshot');
      assert.deepEqual(result.view.memorySearch,{kind:'unavailable',reason});assert.deepEqual(result.view.recognitionKnowledge,{kind:'unavailable',reason});
      assert.match(renderToStaticMarkup(React.createElement(PrivateMindView,{view:result.view})),/No hay checkpoint privado verificable/);
    }
  }finally{fixture.close();}
});
