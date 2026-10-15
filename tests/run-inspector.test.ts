import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openJournal } from '../src/adapters/journal.ts';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { createRunInspectorApplication } from '../src/application/run-inspector.ts';
import { SessionCreatedSchema } from '../src/domain/http.ts';
import { InspectorViewSchema } from '../src/domain/run-inspector.ts';
import { WorldSnapshotSchema,ActorKnowledgeSchema } from '../src/domain/world-schema.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { InspectorPanel,PrivateMindView } from '../src/web/InspectorPanel.tsx';
import { buildInspectorPreferenceRequest } from '../src/web/run-inspector-client.ts';
import { setup,actorId } from './fixtures/continuista.ts';

test('historical inspector reads committed snapshot only, never latest recognition or another actors private experience',async()=>{
  const fixture=await setup();let recognitionReads=0;
  try {
    const application=createRunInspectorApplication({journal:{readActorStateCut:()=>({kind:'unavailable',reason:'checkpoint-not-recorded'}),loadWorld:fixture.journal.loadWorld,readInspectorWorldCut:fixture.journal.readInspectorWorldCut,readWorldLifecycle:fixture.journal.readWorldLifecycle,readActorKnowledge:input=>{recognitionReads++;return fixture.journal.readActorKnowledge(input);}}});
    const result=application.inspect({runId:fixture.claim.runId,characterId:actorId,atWorldSeq:fixture.configuration.worldSnapshot.seq});
    assert.equal(result.kind,'found');if(result.kind!=='found')assert.fail('No historical view');
    assert.equal(recognitionReads,0);assert.equal(result.view.recognitionKnowledge.kind,'unavailable');
    assert.equal(result.view.atWorldSeq,fixture.configuration.worldSnapshot.seq);
    assert.doesNotMatch(JSON.stringify(result.view),/SECRET_PRIVATE_OTHER_MEMORY|SECRET_OTHER_PREPARATION/);
    assert.equal(application.inspect({runId:fixture.claim.runId,characterId:actorId,atWorldSeq:100000}).kind,'invalidCut');
    assert.equal(application.inspect({runId:fixture.claim.runId,characterId:'nonexistent'}).kind,'missing');
    assert.equal(fixture.journal.readWorldLifecycle({runId:fixture.claim.runId})?.lifecycle,'running');
  } finally {fixture.close();}
});

test('current inspector includes zero-event subjective revision; explicit same sequence stays causal and never reads latest knowledge',async()=>{
  const fixture=await setup();let recognitionReads=0;
  try {
    const initial=fixture.configuration.worldSnapshot;
    const template=initial.entities.flatMap(entity=>entity.kind==='character'?entity.mind.experiences:[])[0];assert.ok(template);
    const antecedent={...template,experienceId:randomUUID(),actorId,content:'Antecedente propio'};
    const beliefExperience={...template,experienceId:randomUUID(),actorId,content:'Cambio subjetivo sin evento',basedOn:[antecedent.experienceId]};
    const latest=WorldSnapshotSchema.parse({...initial,revision:initial.revision+1,entities:initial.entities.map(entity=>entity.kind==='character'&&entity.characterId===actorId?{...entity,mind:{...entity.mind,experiences:[...entity.mind.experiences,antecedent,beliefExperience],beliefs:[{experienceId:beliefExperience.experienceId,content:beliefExperience.content,confidence:0.7,basedOn:[antecedent.experienceId]}]}}:entity)});
    const state=fixture.journal.readWorldLifecycle({runId:fixture.claim.runId});assert.ok(state);
    const app=createRunInspectorApplication({journal:{readActorStateCut:()=>({kind:'unavailable',reason:'checkpoint-not-recorded'}),readInspectorWorldCut:raw=>typeof raw==='object'&&raw!==null&&'atWorldSeq'in raw?{snapshot:initial,commitIndex:0,ambiguousSeq:true}:{snapshot:latest,commitIndex:1,ambiguousSeq:true},readWorldLifecycle:()=>({...state,lastWorldSeq:initial.seq,worldRevision:latest.revision}),loadWorld:raw=>typeof raw==='object'&&raw!==null&&'throughWorldSeq'in raw?initial:latest,readActorKnowledge:()=>{recognitionReads++;return {revision:1,atWorldSeq:initial.seq,knowledge:ActorKnowledgeSchema.parse({runId:fixture.claim.runId,actorId,bindings:[]})};}}});
    const current=app.inspect({runId:fixture.claim.runId,characterId:actorId});assert.equal(current.kind,'found');if(current.kind!=='found')assert.fail('Missing current');
    assert.equal(current.view.worldRevision,latest.revision);assert.equal(current.view.cutKind,'current');assert.equal(current.view.mind.beliefs[0]?.content,'Cambio subjetivo sin evento');assert.equal(recognitionReads,1);
    const historical=app.inspect({runId:fixture.claim.runId,characterId:actorId,atWorldSeq:initial.seq});assert.equal(historical.kind,'found');if(historical.kind!=='found')assert.fail('Missing historical');
    assert.equal(historical.view.worldRevision,initial.revision);assert.equal(historical.view.cutKind,'causal-boundary');assert.equal(historical.view.mind.beliefs.length,0);assert.equal(recognitionReads,1);assert.equal(historical.view.recognitionKnowledge.kind,'unavailable');
  } finally {fixture.close();}
});

test('SQLite zero-event belief commit preserves distinct inspector revisions and commit indices at sequence zero',async()=>{
  const fixture=await setup();const directory=mkdtempSync(join(tmpdir(),'personajes-inspector-zero-event-'));const journal=openJournal({path:join(directory,'world.sqlite')});
  try {
    const template=fixture.configuration.worldSnapshot.entities.flatMap(entity=>entity.kind==='character'?entity.mind.experiences:[])[0];assert.ok(template);
    const own={...template,experienceId:randomUUID(),actorId,content:'Antecedente sintético propio'};
    const initial=WorldSnapshotSchema.parse({...fixture.configuration.worldSnapshot,seq:0,revision:0,entities:fixture.configuration.worldSnapshot.entities.map(entity=>entity.kind==='character'&&entity.characterId===actorId?{...entity,mind:{...entity.mind,experiences:[own]}}:entity)});
    const prepared=fixture.configuration.roster.preparedCharacters[0];assert.ok(prepared);
    journal.registerWorldRun({initialSnapshot:initial,configurationRevision:0,configuration:{synthetic:true},continuityFence:{kind:'prepared-contexts',atWorldSeq:0,contexts:[{actorId,continuityId:prepared.continuity.continuityId,continuityRevision:prepared.continuity.revision,continuityContentHash:prepared.continuity.contentHash,identityVersion:prepared.identityVersion,preparedContextHash:'a'.repeat(64)}]},lifecycle:'running'});
    const proposalId=randomUUID();journal.registerWorldProposal({runId:initial.runId,proposalId,version:1,jobId:randomUUID(),generation:0,proposalSlot:0,attempt:{kind:'reviseBelief',attemptId:randomUUID(),runId:initial.runId,actorId,expectedRevision:0,change:{kind:'new',content:'Creencia nueva sin evento',confidence:0.8},evidenceExperienceIds:[own.experienceId]}});
    const committed=journal.commitWorldAttempt({runId:initial.runId,proposalId,version:1,ids:fixture.ids});assert.equal(committed.resolution.kind,'applied');
    if(committed.resolution.kind!=='applied')assert.fail('Belief not committed');assert.equal(committed.resolution.events.length,0);assert.equal(committed.resolution.newSnapshot.seq,0);
    const app=createRunInspectorApplication({journal});const current=app.inspect({runId:initial.runId,characterId:actorId});const past=app.inspect({runId:initial.runId,characterId:actorId,atWorldSeq:0});
    assert.equal(current.kind,'found');assert.equal(past.kind,'found');if(current.kind!=='found'||past.kind!=='found')assert.fail('Missing inspection');
    assert.equal(current.view.worldRevision,1);assert.equal(current.view.commitIndex,1);assert.equal(current.view.ambiguousSequence,true);assert.equal(current.view.mind.beliefs[0]?.content,'Creencia nueva sin evento');
    assert.equal(past.view.worldRevision,0);assert.equal(past.view.commitIndex,0);assert.equal(past.view.mind.beliefs.length,0);assert.equal(past.view.cutKind,'causal-boundary');
    const exact=app.inspect({runId:initial.runId,characterId:actorId,atWorldSeq:0,worldRevision:1});assert.equal(exact.kind,'found');if(exact.kind!=='found')assert.fail('Missing revision');assert.equal(exact.view.commitIndex,1);assert.equal(exact.view.cutKind,'exact-revision');assert.equal(exact.view.recognitionKnowledge.kind,'checkpoint');
  } finally {journal.close();fixture.close();rmSync(directory,{recursive:true,force:true});}
});

test('HTTP inspector requires independent explicit session capability; revoke and logout remove access and audit has metadata only',async(t)=>{
  const fixture=await setup();t.after(()=>fixture.close());
  let reads=0;const audit:unknown[]=[];const application=createRunInspectorApplication({journal:fixture.journal});
  const server=createLocalHttpServer({catalog:await loadCatalog({repositoryRoot:process.cwd()}),shellHtml:'<html><head></head><body></body></html>',authorizeObserverView:runId=>runId===fixture.claim.runId,
    resolveSessionMode:candidate=>candidate.kind==='observer'||candidate.runId===fixture.claim.runId?candidate:null,
    runInspector:{characters:input=>{reads++;return application.characters(input);},inspect:input=>{reads++;return application.inspect(input);}},onInspectorRead:value=>{audit.push(value);}});
  t.after(()=>server.close());const {origin}=await server.listen();const originHeaders={Origin:origin,'Sec-Fetch-Site':'same-origin'};
  const shell=await fetch(origin+'/',{headers:originHeaders});const nonce=(await shell.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(nonce);
  const login=await fetch(origin+'/api/v1/session',{method:'POST',headers:{...originHeaders,'Content-Type':'application/json'},body:JSON.stringify({bootNonce:nonce})});
  const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);const session=SessionCreatedSchema.parse(await login.json());let etag=login.headers.get('etag');assert.ok(etag);
  const headers={...originHeaders,Cookie:cookie,'X-CSRF-Token':session.csrfToken,'Content-Type':'application/json'};
  const path=`${origin}/api/v1/runs/${fixture.claim.runId}`;
  const modeResponse=await fetch(origin+'/api/v1/session/mode',{method:'PUT',headers:{...headers,'If-Match':etag,'Idempotency-Key':randomUUID()},body:JSON.stringify({kind:'director',runId:fixture.claim.runId,scope:{kind:'run'}})});
  assert.equal(modeResponse.status,200);etag=modeResponse.headers.get('etag');assert.ok(etag);
  assert.equal((await fetch(path+'/inspector/characters',{headers})).status,403);assert.equal(reads,0);
  const preference=async(mode:'stage'|'internal')=>{const response=await fetch(path+'/observer-view',{method:'PUT',headers:{...headers,'If-Match':etag!,'Idempotency-Key':randomUUID()},body:JSON.stringify(mode==='internal'?{mode,confirm:true}:{mode})});if(response.ok)etag=response.headers.get('etag');return response;};
  assert.equal((await preference('internal')).status,200);
  const listed=await fetch(path+'/inspector/characters',{headers});assert.equal(listed.status,200);assert.match(await listed.text(),/oculto-prueba/);
  const invalidPage=await fetch(path+`/inspector?characterId=${actorId}&memoryLimit=101`,{headers});assert.equal(invalidPage.status,422);
  const inspected=await fetch(path+`/inspector?characterId=${actorId}&atWorldSeq=${fixture.configuration.worldSnapshot.seq}&memoryOffset=0&memoryLimit=1`,{headers});assert.equal(inspected.status,200);const view=InspectorViewSchema.parse(await inspected.json());assert.equal(view.source,'committed-world-snapshot');assert.equal(inspected.headers.get('cache-control'),'no-store');assert.equal(view.memorySearch.kind,'checkpoint');if(view.memorySearch.kind==='checkpoint'){assert.equal(view.memorySearch.limit,1);assert.equal(view.memorySearch.offset,0);assert.ok(view.memorySearch.items.length<=1);}
  assert.equal(audit.length,2);assert.doesNotMatch(JSON.stringify(audit),/mind|content|SECRET_|knowledge|experiences/);
  assert.equal((await preference('stage')).status,200);const before=reads;assert.equal((await fetch(path+`/inspector?characterId=${actorId}`,{headers})).status,403);assert.equal(reads,before);
  assert.equal((await preference('internal')).status,200);
  const logout=await fetch(origin+'/api/v1/session',{method:'DELETE',headers});assert.equal(logout.status,204);
  assert.equal((await fetch(path+'/inspector/characters',{headers})).status,401);assert.equal(reads,before);
});

test('Inspector GUI starts closed and preference carries session CAS and immutable operation key',()=>{
  const runId=randomUUID();const key=randomUUID();const built=buildInspectorPreferenceRequest({runId,mode:'internal',etag:'"session:r2"',key},'csrf');
  assert.equal(built.init.headers['If-Match'],'"session:r2"');assert.equal(built.init.headers['Idempotency-Key'],key);assert.deepEqual(JSON.parse(built.init.body),{mode:'internal',confirm:true});
  assert.match(renderToStaticMarkup(React.createElement(InspectorPanel,{runId})),/Confirmo que quiero/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(InspectorPanel,{runId})),/Objetivos|Creencias|SECRET_/);
  assert.equal(typeof PrivateMindView,'function');
});
