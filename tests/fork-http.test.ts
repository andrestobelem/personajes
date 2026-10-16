import {RevisionSchema} from '../src/domain/values.ts';
import {createDramaticStructureApplication} from '../src/application/dramatic-structure.ts';
import {createRunLifecycleApplication} from '../src/application/run-lifecycle.ts';
import {DramaticStructurePresentationSchema} from '../src/domain/dramatic-structure.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test,type TestContext} from 'node:test';
import {loadCatalog} from '../src/adapters/catalog.ts';
import {openLocalHost} from '../src/application/local-host.ts';
import {createForkRuntime} from '../src/application/fork-runtime.ts';
import {createForkApplication} from '../src/application/fork-application.ts';
import {createLocalHttpServer} from '../src/server/http.ts';
import {SessionCreatedSchema} from '../src/domain/http.ts';
import {ForkJobViewSchema,forkSourceEtag} from '../src/domain/fork-http.ts';
import {draftFixture} from './fixtures/continuista.ts';

const binaryPath=process.env.PERSONAJES_ICM_TEST_BINARY;
async function setup(t:TestContext,enabled:boolean,binaryOverride?:string){
 const directory=mkdtempSync(join(tmpdir(),'personajes-fork-http-'));const host=openLocalHost({privateDataRoot:join(directory,'data')});
 const {kind,schemaVersion,runId,revision,...patch}=draftFixture();
 const draft=host.journal.createRunConfigurationDraft({principalId:'local-operator',idempotencyKey:randomUUID(),patch});assert.ok(draft.kind==='created');
 const ready=host.journal.validateRunConfigurationDraft({principalId:'local-operator',idempotencyKey:randomUUID(),runId:draft.draft.runId,expectedRevision:0});assert.ok(ready.kind==='ready');
 const selectedBinary=binaryOverride??binaryPath;const runtime=enabled&&selectedBinary!==undefined?createForkRuntime({host,binaryPath:selectedBinary}):undefined;
 const app=createForkApplication({journal:host.journal,...(runtime===undefined?{}:{runtime})});
 const server=createLocalHttpServer({catalog:await loadCatalog({repositoryRoot:process.cwd()}),shellHtml:'<!doctype html><html><head></head><body></body></html>',forks:app,runDramaticStructure:createDramaticStructureApplication({journal:host.journal}),runLifecycle:createRunLifecycleApplication({journal:host.journal})});
 const {origin}=await server.listen();t.after(async()=>{await server.close();await runtime?.close();host.close();rmSync(directory,{recursive:true,force:true});});
 const baseHeaders={Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'};
 const shell=await fetch(origin+'/',{headers:baseHeaders});const nonce=(await shell.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(nonce);
 const session=await fetch(origin+'/api/v1/session',{method:'POST',headers:baseHeaders,body:JSON.stringify({bootNonce:nonce})});const cookie=session.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);const parsed=SessionCreatedSchema.parse(await session.json());
 const world=host.journal.loadWorld({runId:ready.runId});assert.ok(world);const source={runId:ready.runId,commitIndex:0,worldRevision:world.revision,worldSeq:world.seq};const body={operationId:randomUUID(),name:'Otra posibilidad',reason:'Explorar consecuencias desde un corte comprobado.',commitIndex:0,worldRevision:world.revision,worldSeq:world.seq};
 const headers={...baseHeaders,Cookie:cookie,'X-CSRF-Token':parsed.csrfToken,'Idempotency-Key':randomUUID(),'If-Match':forkSourceEtag(source)};
 const post=(payload:unknown=body,extra:Record<string,string>={})=>fetch(`${origin}/api/v1/runs/${ready.runId}/forks`,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(payload)});
 return {host,runtime,origin,headers,baseHeaders,body,source,post};
}

test('fork HTTP validates operator capability, CSRF, exact ETag and strict public payload before work',async(t)=>{
 const f=await setup(t,false);
 assert.equal((await f.post()).status,503);
 assert.equal((await f.post(f.body,{'X-CSRF-Token':'bad'})).status,403);
 assert.equal((await f.post(f.body,{Cookie:''})).status,401);
 assert.equal((await f.post(f.body,{'If-Match':'*'})).status,412);
 assert.equal((await f.post(f.body,{'If-Match':''})).status,412);
 const {'If-Match':omittedEtag,...withoutEtag}=f.headers;void omittedEtag;assert.equal((await fetch(`${f.origin}/api/v1/runs/${f.source.runId}/forks`,{method:'POST',headers:withoutEtag,body:JSON.stringify(f.body)})).status,428);
 for(const field of ['package','receipts','artifacts','principalId','targetRunId','memory','source'])assert.equal((await f.post({...f.body,[field]:{secret:'forbidden'}})).status,422,field);
 assert.equal((await f.post(f.body,{Origin:'https://example.com'})).status,403);
 assert.equal(f.host.journal.listStagingForkJobs().length,0);
 const missing=await fetch(`${f.origin}/api/v1/forks/${f.body.operationId}`,{headers:f.headers});assert.equal(missing.status,404);
});

test('fork HTTP publishes private-memory fork, safe DTO, replay across sessions and read without runtime', {skip:binaryPath===undefined?'ICM real no configurado':false},async(t)=>{
 const f=await setup(t,true);assert.ok(f.runtime);
 const invalidCut={...f.body,commitIndex:999};assert.equal((await f.post(invalidCut,{'If-Match':forkSourceEtag({...f.source,commitIndex:999})})).status,409);
 const absentSource={...f.source,runId:randomUUID()};const missingSource=await fetch(`${f.origin}/api/v1/runs/${absentSource.runId}/forks`,{method:'POST',headers:{...f.headers,'If-Match':forkSourceEtag(absentSource)},body:JSON.stringify(f.body)});assert.equal(missingSource.status,404);
 const accepted=await f.post();assert.equal(accepted.status,202,await accepted.clone().text());const first=ForkJobViewSchema.parse(await accepted.json());assert.equal(first.state,'staging');assert.equal(accepted.headers.get('location'),`/api/v1/forks/${first.operationId}`);
 await f.runtime.waitForIdle();
 const get=()=>fetch(`${f.origin}/api/v1/forks/${first.operationId}`,{headers:f.headers});const read=await get();assert.equal(read.status,200);const ready=ForkJobViewSchema.parse(await read.json());assert.equal(ready.state,'ready');
 for(const key of ['principalId','idempotencyKey','package','actors','receipts','privateDataRoot','memory'])assert.equal(key in ready,false);
 assert.equal(read.headers.get('etag'),`"fork:${first.operationId}:r${ready.revision}"`);
 const replay=await f.post();assert.equal(replay.status,202);assert.equal(replay.headers.get('idempotency-replayed'),'true');assert.deepEqual(await replay.json(),ready);
 const conflict=await f.post({...f.body,name:'Otro nombre'});assert.equal(conflict.status,409);
 const another=await f.post({...f.body,operationId:randomUUID()});assert.equal(another.status,409);
 const sourceAfter=f.host.journal.loadWorld({runId:f.source.runId});assert.equal(sourceAfter?.revision,f.source.worldRevision);assert.equal(sourceAfter?.seq,f.source.worldSeq);
 const readOnly=createForkApplication({journal:f.host.journal});assert.deepEqual(readOnly.read({operationId:first.operationId,principalId:'local-operator'}),{kind:'found',job:ready});assert.equal(readOnly.read({operationId:first.operationId,principalId:'other'}).kind,'missing');
 const otherShell=await fetch(f.origin+'/',{headers:f.baseHeaders});const otherNonce=(await otherShell.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(otherNonce);
 const otherSessionResponse=await fetch(f.origin+'/api/v1/session',{method:'POST',headers:f.baseHeaders,body:JSON.stringify({bootNonce:otherNonce})});const otherCookie=otherSessionResponse.headers.get('set-cookie')?.split(';')[0];assert.ok(otherCookie);const otherSession=SessionCreatedSchema.parse(await otherSessionResponse.json());
 const crossSessionReplay=await f.post(f.body,{Cookie:otherCookie,'X-CSRF-Token':otherSession.csrfToken});assert.equal(crossSessionReplay.status,202);assert.deepEqual(await crossSessionReplay.json(),ready);
 const readServer=createLocalHttpServer({catalog:await loadCatalog({repositoryRoot:process.cwd()}),shellHtml:'<!doctype html><html><head></head><body></body></html>',forks:readOnly});const readAddress=await readServer.listen();t.after(()=>readServer.close());
 const readHeaders={Origin:readAddress.origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'};const readShell=await fetch(readAddress.origin+'/',{headers:readHeaders});const readNonce=(await readShell.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(readNonce);
 const readSessionResponse=await fetch(readAddress.origin+'/api/v1/session',{method:'POST',headers:readHeaders,body:JSON.stringify({bootNonce:readNonce})});const readCookie=readSessionResponse.headers.get('set-cookie')?.split(';')[0];assert.ok(readCookie);
 const withoutRuntime=await fetch(`${readAddress.origin}/api/v1/forks/${first.operationId}`,{headers:{...readHeaders,Cookie:readCookie}});assert.equal(withoutRuntime.status,200);assert.deepEqual(await withoutRuntime.json(),ready);
 assert.equal((await get()).status,200);assert.equal(f.host.journal.listStagingForkJobs().length,0);
 const retry=await fetch(`${f.origin}/api/v1/forks/${first.operationId}/retry`,{method:'POST',headers:{...f.headers,'Idempotency-Key':randomUUID(),'If-Match':read.headers.get('etag')??''},body:'{}'});assert.equal(retry.status,409,await retry.clone().text());
});


test('fork retry preserves durable receipt across failed work, rejects stale revisions and reads during suspended admissions',async(t)=>{
 const f=await setup(t,true,'/private/tmp/personajes-nonexistent-icm-binary');assert.ok(f.runtime);
 const accepted=await f.post();assert.equal(accepted.status,202);const first=ForkJobViewSchema.parse(await accepted.json());await f.runtime.waitForIdle();
 const url=`${f.origin}/api/v1/forks/${first.operationId}`;const read=await fetch(url,{headers:f.headers});const failed=ForkJobViewSchema.parse(await read.json());assert.equal(failed.state,'failed');
 const key=randomUUID();const headers={...f.headers,'Idempotency-Key':key,'If-Match':read.headers.get('etag')??''};
 const retry=(extra:Record<string,string>={})=>fetch(url+'/retry',{method:'POST',headers:{...headers,...extra},body:'{}'});
 assert.equal((await retry({'X-CSRF-Token':'bad'})).status,403);
 const firstRetry=await retry();assert.equal(firstRetry.status,202,await firstRetry.clone().text());const receipt=ForkJobViewSchema.parse(await firstRetry.json());assert.equal(receipt.state,'staging');await f.runtime.waitForIdle();
 const replay=await retry();assert.equal(replay.status,202);assert.equal(replay.headers.get('idempotency-replayed'),'true');assert.deepEqual(await replay.json(),receipt);
 const stale=await retry({'Idempotency-Key':randomUUID()});assert.equal(stale.status,412);
 const conflicting=await retry({'If-Match':`"fork:${first.operationId}:r0"`});assert.equal(conflicting.status,409);
 const release=await f.runtime.suspendAdmissions();try{
  assert.equal((await fetch(url,{headers:f.headers})).status,200);
  assert.equal((await retry({'Idempotency-Key':randomUUID()})).status,503);
  assert.equal((await f.post({...f.body,operationId:randomUUID()},{'Idempotency-Key':randomUUID()})).status,503);
 }finally{release();}
});

test('HTTP-created episode and act identities can be forked with their real deterministic IDs', {skip:binaryPath===undefined?'ICM real no configurado':false},async(t)=>{
 const f=await setup(t,true);assert.ok(f.runtime);
 let world=f.host.journal.loadWorld({runId:f.source.runId});assert.ok(world);const initialScene=world.scenes[0];const actor=world.entities.find(entity=>entity.kind==='character');assert.ok(initialScene&&actor?.kind==='character');
 f.host.journal.setWorldLifecycle({runId:world.runId,expectedWorldRevision:world.revision,expectedConfigRevision:0,target:'running'});
 f.host.journal.setWorldLifecycle({runId:world.runId,expectedWorldRevision:world.revision,expectedConfigRevision:0,target:'paused'});
 async function structure(){const response=await fetch(`${f.origin}/api/v1/runs/${f.source.runId}/dramatic-structure`,{headers:f.headers});assert.equal(response.status,200);return {value:DramaticStructurePresentationSchema.extend({worldRevision:RevisionSchema}).parse(await response.json()),etag:response.headers.get('etag')??''};}
 async function mutate(path:string,body:unknown,method='POST'){
  const current=await structure();const response=await fetch(`${f.origin}/api/v1/runs/${f.source.runId}/${path}`,{method,headers:{...f.headers,'Idempotency-Key':randomUUID(),'If-Match':current.etag},body:JSON.stringify(body)});
  assert.equal(response.status,200,await response.clone().text());return structure();
 }
 await mutate(`scenes/${initialScene.id}/close`,{reason:'Cierre explícito de ensayo'});
 const opened=await mutate('episodes',{title:'Episodio creado por API'});const episodeId=opened.value.activeEpisodeId;assert.ok(episodeId);assert.equal(episodeId[14],'5');
 const next=await mutate('scenes',{label:'Escena declarada',participantIds:[actor.characterId],placeIds:[world.places[0]?.id]});assert.ok(next.value.activeSceneId);
 const grouped=await mutate(`episodes/${episodeId}/acts`,{acts:[{title:'Acto declarado',sceneIds:[next.value.activeSceneId]}]},'PUT');const act=grouped.value.episodes[0]?.acts[0];assert.ok(act);assert.equal(act.actId[14],'5');
 world=f.host.journal.loadWorld({runId:f.source.runId});assert.ok(world);const checkpoint=f.host.journal.readDramaticStructureAtCut({runId:world.runId,worldRevision:world.revision,worldSeq:world.seq});assert.ok(checkpoint);
 const selected={runId:world.runId,commitIndex:checkpoint.commitIndex,worldRevision:world.revision,worldSeq:world.seq};
 const response=await f.post({...f.body,commitIndex:selected.commitIndex,worldRevision:selected.worldRevision,worldSeq:selected.worldSeq,operationId:randomUUID()},{'Idempotency-Key':randomUUID(),'If-Match':forkSourceEtag(selected)});
 assert.equal(response.status,202,await response.clone().text());const job=ForkJobViewSchema.parse(await response.json());await f.runtime.waitForIdle();assert.equal(f.runtime.read({operationId:job.operationId,principalId:'local-operator'})?.state,'ready');
 const inherited=f.host.journal.readDramaticStructure({runId:job.targetRunId});assert.ok(inherited);const episode=inherited.episodes[0];assert.ok(episode);assert.equal(episode.episodeId[14],'4');assert.equal(episode.acts[0]?.actId[14],'4');assert.equal(episode.forkOrigins?.[0]?.episodeId,episodeId);
 const publicRead=await fetch(`${f.origin}/api/v1/runs/${job.targetRunId}/dramatic-structure`,{headers:f.headers});assert.equal(publicRead.status,200);
 const inheritedPresentation=DramaticStructurePresentationSchema.extend({worldRevision:RevisionSchema}).parse(await publicRead.json());
 assert.ok(inheritedPresentation.sceneLabels?.some(scene=>scene.label==='Escena declarada'));
 assert.equal(inheritedPresentation.sceneLabels?.some(scene=>scene.id===next.value.activeSceneId),false,'la proyección usa los IDs remapeados de la bifurcación');
});
