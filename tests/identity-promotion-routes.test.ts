import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {loadCatalog} from '../src/adapters/catalog.ts';
import {configuratorValueHash} from '../src/application/configurator-context.ts';
import {SessionCreatedSchema,SessionViewSchema} from '../src/domain/http.ts';
import {IdentityPromotionContextViewSchema,IdentityPromotionJobViewSchema,IdentityPromotionReviewSchema,identityPromotionContextEtag,identityPromotionJobEtag} from '../src/domain/identity-promotion-http.ts';
import {createIdentityPromotionRoutes,type IdentityPromotionApplicationPort,type IdentityPromotionAuthority} from '../src/server/identity-promotion-routes.ts';
import {createLocalHttpServer} from '../src/server/http.ts';
import type {OperatorRequest} from '../src/server/operator-extension.ts';
import {configuratorEvolutionFixture} from './fixtures/configurator-evolution.ts';

async function fixture(){
 const f=await configuratorEvolutionFixture();assert.ok(f.context.scope.kind==='evolution');const source=f.context.scope.anchor.source;const runId=source.runId;const jobId=f.scope.jobId;
 const lifecycle=f.base.journal.readWorldLifecycle({runId});assert.ok(lifecycle);
 const head={runId,lifecycle:lifecycle.lifecycle,lifecycleRevision:lifecycle.lifecycleRevision,commitIndex:source.commitIndex,worldRevision:source.worldRevision,worldSeq:source.worldSeq,configurationRevision:source.configurationRevision};
 const job=IdentityPromotionJobViewSchema.parse({kind:'configurator-job',jobId,runId,actorId:f.characterId,generation:0,revision:3,state:'accepted',source,contextHash:configuratorValueHash(f.context),failureCode:null,createdAt:1,updatedAt:2,promotion:{kind:'not-applied'}});
 const review=IdentityPromotionReviewSchema.parse({kind:'identity-promotion-review',job,context:f.context,proposal:f.proposal,candidateHash:'c'.repeat(64),proposalHash:configuratorValueHash(f.proposal),targetFullHash:f.context.targetFullHash});
 let privateReads=0;const writes:IdentityPromotionAuthority[]=[];
 const application:IdentityPromotionApplicationPort={
  context({authority}){return IdentityPromotionContextViewSchema.parse({...head,kind:'identity-promotion-context',canWrite:authority.mode.kind==='director'&&authority.mode.runId===runId&&authority.mode.scope.kind==='run',inspectionAllowed:authority.inspectionRunIds.includes(runId),eligibleActors:[{actorId:f.characterId,label:'Actor sintético',identityVersion:f.context.preparedCharacter?.identityVersion}]});},
  list(){return {kind:'identity-promotion-jobs',items:[job],hasMore:false};},
  readJob(input){return input.jobId===jobId?job:undefined;},readReview(){privateReads++;return review;},
  start({authority}){writes.push(authority);return job;},approve({authority}){writes.push(authority);return job;},retry({authority}){writes.push(authority);return job;},reject({authority}){writes.push(authority);return job;},cancel({authority}){writes.push(authority);return job;},
 };
 return {f,source,runId,jobId,head,job,review,application,writes,get privateReads(){return privateReads;},close:f.close};
}

test('identity routes refuse private review before calling its reader and require trusted run inspection plus run Director for writes',async()=>{
 const f=await fixture();const routes=createIdentityPromotionRoutes({application:()=>f.application});
 function read(path:readonly string[],inspectionRunIds?:readonly string[]):OperatorRequest{return {kind:'read',method:'GET',path,query:new URLSearchParams(),principalId:'local-operator',mode:{kind:'observer'},ifMatch:null,ifNoneMatch:null,...(inspectionRunIds===undefined?{}:{inspectionRunIds})};}
 try{
  assert.equal((await routes.handle(read(['identity-promotions',f.jobId]))).kind,'json');
  const history=await routes.handle(read(['runs',f.runId,'identity-promotions']));assert.equal(history.kind,'json');if(history.kind==='json')assert.equal(JSON.stringify(history.body).includes('Creo que debo escuchar'),false);
  const denied=await routes.handle(read(['identity-promotions',f.jobId,'review']));assert.equal(denied.kind,'problem');if(denied.kind==='problem')assert.equal(denied.status,403);assert.equal(f.privateReads,0);
  const wrongRun=await routes.handle(read(['identity-promotions',f.jobId,'review'],[randomUUID()]));assert.equal(wrongRun.kind,'problem');assert.equal(f.privateReads,0);
  const allowed=await routes.handle(read(['identity-promotions',f.jobId,'review'],[f.runId]));assert.equal(allowed.kind,'json');assert.equal(f.privateReads,1);
  const privateContext=f.review.context;const privateScope=privateContext.scope;assert.ok(privateScope.kind==='evolution');
  const crossed=createIdentityPromotionRoutes({application:()=>({...f.application,readReview(){return {...f.review,context:{...privateContext,scope:{...privateScope,scope:{...privateScope.scope,runId:randomUUID()}}}};}})});
  const crossedReview=await crossed.handle(read(['identity-promotions',f.jobId,'review'],[f.runId]));assert.equal(crossedReview.kind,'problem');assert.equal(JSON.stringify(crossedReview).includes('Creo que debo escuchar'),false,'an authorized job cannot expose context from another run');

  const approveBody={contextHash:f.job.contextHash,proposalHash:f.review.proposalHash,targetFullHash:f.review.targetFullHash,expectedLifecycleRevision:f.head.lifecycleRevision,expectedCommitIndex:f.head.commitIndex,expectedWorldRevision:f.head.worldRevision};
  const request={...read(['identity-promotions',f.jobId,'approve'],[f.runId]),kind:'write' as const,method:'POST' as const,idempotencyKey:randomUUID(),ifMatch:identityPromotionJobEtag(f.job),body:approveBody};
  const observer=await routes.handle(request);assert.equal(observer.kind,'problem');if(observer.kind==='problem')assert.equal(observer.status,403);assert.equal(f.writes.length,0);
  const sceneDirector=await routes.handle({...request,mode:{kind:'director',runId:f.runId,scope:{kind:'scene',sceneId:randomUUID()}}});assert.equal(sceneDirector.kind,'problem');assert.equal(f.writes.length,0);
  const director=await routes.handle({...request,mode:{kind:'director',runId:f.runId,scope:{kind:'run'}}});assert.equal(director.kind,'json');assert.equal(f.writes.length,1);
  for(const forged of [{operatorId:'spoof'},{confirmedAt:'2026-10-15T00:00:00Z'},{principalId:'spoof'},{approval:{kind:'operator-consent'}},{inspectionRunIds:[f.runId]}]){
   const response=await routes.handle({...request,mode:{kind:'director',runId:f.runId,scope:{kind:'run'}},body:{...approveBody,...forged}});assert.equal(response.kind,'problem');if(response.kind==='problem')assert.equal(response.status,422);
  }
  assert.equal(f.writes.length,1);
 }finally{f.close();}
});

test('real HTTP derives inspection opt-in from the session and never accepts it or consent metadata in the request body',async()=>{
 const f=await fixture();const routes=createIdentityPromotionRoutes({application:()=>f.application});const server=createLocalHttpServer({catalog:await loadCatalog({repositoryRoot:process.cwd()}),shellHtml:'<html><head></head><body></body></html>',operatorExtensions:[routes],authorizeObserverView:runId=>runId===f.runId,resolveSessionMode:candidate=>candidate});
 try{
  const {origin}=await server.listen();const security={Origin:origin,'Content-Type':'application/json'};const page=await fetch(origin+'/',{headers:security});const bootNonce=(await page.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(bootNonce);
  const sessionResponse=await fetch(origin+'/api/v1/session',{method:'POST',headers:security,body:JSON.stringify({bootNonce})});const session=SessionCreatedSchema.parse(await sessionResponse.json());const cookie=sessionResponse.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);const headers={...security,Cookie:cookie,'X-CSRF-Token':session.csrfToken};let sessionEtag=sessionResponse.headers.get('etag');assert.ok(sessionEtag);
  const reviewUrl=`${origin}/api/v1/identity-promotions/${f.jobId}/review`;
  assert.equal((await fetch(reviewUrl)).status,401);const forbidden=await fetch(reviewUrl,{headers});assert.equal(forbidden.status,403);assert.equal(f.privateReads,0);assert.equal((await forbidden.text()).includes('Creo que debo escuchar'),false);
  const metadata=await fetch(`${origin}/api/v1/identity-promotions/${f.jobId}`,{headers});assert.equal(metadata.status,200);const metadataBody=await metadata.text();IdentityPromotionJobViewSchema.parse(JSON.parse(metadataBody));assert.equal(metadataBody.includes('Creo que debo escuchar'),false);assert.equal(metadataBody.includes('principalId'),false);
  const contextUrl=`${origin}/api/v1/runs/${f.runId}/identity-promotions/context`;const beforeContext=await fetch(contextUrl,{headers});assert.equal(beforeContext.status,200);const context=IdentityPromotionContextViewSchema.parse(await beforeContext.json());assert.equal(context.inspectionAllowed,false);assert.equal(context.canWrite,false);
  const mode=await fetch(origin+'/api/v1/session/mode',{method:'PUT',headers:{...headers,'If-Match':sessionEtag,'Idempotency-Key':randomUUID()},body:JSON.stringify({kind:'director',runId:f.runId,scope:{kind:'run'}})});assert.equal(mode.status,200);sessionEtag=mode.headers.get('etag');assert.ok(sessionEtag);
  const startBody={actorId:f.f.characterId,expectedLifecycleRevision:f.head.lifecycleRevision,expectedCommitIndex:f.head.commitIndex,expectedWorldRevision:f.head.worldRevision,expectedWorldSeq:f.head.worldSeq,expectedConfigurationRevision:f.head.configurationRevision};
  const startUrl=`${origin}/api/v1/runs/${f.runId}/identity-promotions`;const startHeaders={...headers,'If-Match':identityPromotionContextEtag(f.head),'Idempotency-Key':randomUUID()};
  const forgedStart=await fetch(startUrl,{method:'POST',headers:startHeaders,body:JSON.stringify({...startBody,inspectionRunIds:[f.runId]})});assert.equal(forgedStart.status,403);assert.equal(f.writes.length,0);
  const optin=await fetch(`${origin}/api/v1/runs/${f.runId}/observer-view`,{method:'PUT',headers:{...headers,'If-Match':sessionEtag,'Idempotency-Key':randomUUID()},body:JSON.stringify({mode:'internal',confirm:true})});assert.equal(optin.status,200);
  const detailed=await fetch(reviewUrl,{headers});assert.equal(detailed.status,200);const reviewed=IdentityPromotionReviewSchema.parse(await detailed.json());assert.equal(reviewed.proposalHash,f.review.proposalHash);assert.ok(JSON.stringify(reviewed).includes('Creo que debo escuchar'));assert.equal(f.privateReads,1);
  const withoutCsrf=await fetch(startUrl,{method:'POST',headers:{...startHeaders,'X-CSRF-Token':'bad'},body:JSON.stringify(startBody)});assert.equal(withoutCsrf.status,403);assert.equal(f.writes.length,0);
  const spoof=await fetch(startUrl,{method:'POST',headers:startHeaders,body:JSON.stringify({...startBody,principalId:'spoof'})});assert.equal(spoof.status,422);assert.equal(f.writes.length,0);
  const created=await fetch(startUrl,{method:'POST',headers:startHeaders,body:JSON.stringify(startBody)});assert.equal(created.status,202,await created.clone().text());assert.equal(created.headers.get('location'),`/api/v1/identity-promotions/${f.jobId}`);assert.equal(f.writes.length,1);assert.equal(f.writes[0]?.principalId,'local-operator');assert.deepEqual(f.writes[0]?.inspectionRunIds,[f.runId]);
  const currentSession=await fetch(origin+'/api/v1/session',{headers});const current=SessionViewSchema.parse(await currentSession.json());assert.equal(current.mode.kind,'director');
  const off=await fetch(`${origin}/api/v1/runs/${f.runId}/observer-view`,{method:'PUT',headers:{...headers,'If-Match':currentSession.headers.get('etag')??'','Idempotency-Key':randomUUID()},body:JSON.stringify({mode:'stage'})});assert.equal(off.status,200);assert.equal((await fetch(reviewUrl,{headers})).status,403);assert.equal(f.privateReads,1);
 }finally{await server.close();f.close();}
});
