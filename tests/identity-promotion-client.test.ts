import test from 'node:test';
import assert from 'node:assert/strict';
import {IdentityPromotionContextViewSchema,IdentityPromotionJobViewSchema,identityPromotionContextEtag,identityPromotionJobEtag} from '../src/domain/identity-promotion-http.ts';
import {captureIdentityPromotionIntent,buildIdentityPromotionRequest,createIdentityPromotionClient,identityJobAnchor,writeIdentityPromotionStored,readIdentityPromotionStored,newerIdentityPromotion,identityPromotionRejection} from '../src/web/identity-promotion-client.ts';
const runId='11111111-1111-4111-8111-111111111111',jobId='22222222-2222-4222-8222-222222222222',key='33333333-3333-4333-8333-333333333333';
const head=IdentityPromotionContextViewSchema.parse({kind:'identity-promotion-context',runId,lifecycle:'paused',lifecycleRevision:2,commitIndex:7,worldRevision:3,worldSeq:2,configurationRevision:1,canWrite:true,inspectionAllowed:true,eligibleActors:[{actorId:'max',label:'Max',identityVersion:0}]});
const job=IdentityPromotionJobViewSchema.parse({kind:'configurator-job',jobId,runId,actorId:'max',generation:0,revision:0,state:'queued',source:{runId,commitIndex:7,worldRevision:3,worldSeq:2,configurationRevision:1,configurationHash:'b'.repeat(64),snapshotHash:'a'.repeat(64)},contextHash:'c'.repeat(64),failureCode:null,createdAt:0,updatedAt:0,promotion:{kind:'not-applied'}});
const start=captureIdentityPromotionIntent({kind:'start',runId,key,etag:identityPromotionContextEtag(head),body:{actorId:'max',expectedLifecycleRevision:2,expectedCommitIndex:7,expectedWorldRevision:3,expectedWorldSeq:2,expectedConfigurationRevision:1}});
const bootstrap=async()=>({csrfToken:'csrf',expiresAt:'2026-10-20T00:00:00Z'});
function store(){const values=new Map<string,string>();return {values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}
test('proposal start captures exact source and writes only authoritative body fields plus CSRF/key/CAS',()=>{
 const built=buildIdentityPromotionRequest({intent:start,csrfToken:'csrf'});assert.equal(built.path,'/api/v1/runs/'+runId+'/identity-promotions');assert.equal(new Headers(built.init.headers).get('If-Match'),identityPromotionContextEtag(head));assert.equal(new Headers(built.init.headers).get('Idempotency-Key'),key);const body=JSON.parse(built.init.body);assert.equal(body.expectedCommitIndex,7);assert.equal('principalId' in body,false);assert.equal('operatorId' in body,false);assert.equal('confirmedAt' in body,false);
});
test('unknown start outcome keeps the same source, key and request; foreign cut responses are rejected',async()=>{
 const calls:Array<{path:string;init:RequestInit|undefined}>=[];let first=true;
 const api=createIdentityPromotionClient(async(path,init)=>{calls.push({path:String(path),init});if(first){first=false;throw new Error('respuesta perdida');}return new Response(JSON.stringify(job),{headers:{etag:identityPromotionJobEtag(job)}});},bootstrap);
 await assert.rejects(api.execute(start,new AbortController().signal),/perdida/);assert.deepEqual(await api.execute(start,new AbortController().signal),job);assert.deepEqual(calls[0],calls[1]);
 const foreign={...job,source:{...job.source,commitIndex:8}};const bad=createIdentityPromotionClient(async()=>new Response(JSON.stringify(foreign),{headers:{etag:identityPromotionJobEtag(foreign)}}),bootstrap);await assert.rejects(bad.execute(start,new AbortController().signal),/corte solicitado/);
});
test('persisted intent is run scoped and contains no private review or evidence',()=>{
 const storage=store();assert.equal(writeIdentityPromotionStored(storage,{runId:head.runId,pending:start}),true);assert.equal(readIdentityPromotionStored(storage,runId)?.pending?.key,key);assert.equal(readIdentityPromotionStored(storage,jobId),null);assert.equal(JSON.stringify(readIdentityPromotionStored(storage,runId)).includes('selfConcept'),false);
 assert.equal(writeIdentityPromotionStored(storage,{runId:head.runId,jobId,pending:captureIdentityPromotionIntent({kind:'retry',runId,key,job:identityJobAnchor(job)})}),true);
 storage.values.set('personajes:identity-promotion:'+runId,'{bad');assert.equal(readIdentityPromotionStored(storage,runId),null);
});
test('metadata context, history and job are GET only; proposed status is distinct from applied receipt',async()=>{
 const methods:Array<string|undefined>=[];const accepted=IdentityPromotionJobViewSchema.parse({...job,state:'accepted',revision:2});
 const api=createIdentityPromotionClient(async(path,init)=>{methods.push(init?.method);const url=String(path);if(url.endsWith('/context'))return new Response(JSON.stringify(head),{headers:{etag:identityPromotionContextEtag(head)}});if(url.includes('/runs/'))return new Response(JSON.stringify({kind:'identity-promotion-jobs',items:[accepted],hasMore:false}));return new Response(JSON.stringify(accepted),{headers:{etag:identityPromotionJobEtag(accepted)}});},bootstrap);
 assert.equal((await api.context(runId,new AbortController().signal)).commitIndex,7);assert.equal((await api.list(runId,new AbortController().signal)).items[0]?.state,'accepted');assert.equal((await api.read({runId,jobId},new AbortController().signal)).promotion.kind,'not-applied');assert.deepEqual(methods,[undefined,undefined,undefined]);assert.equal(newerIdentityPromotion(accepted,job),accepted);
});
test('approval/retry/reject/cancel preserve exact CAS and stale failures do not rebase or start another job',async()=>{
 const approve=captureIdentityPromotionIntent({kind:'approve',runId,key,job:identityJobAnchor(job),body:{contextHash:job.contextHash,proposalHash:'d'.repeat(64),targetFullHash:'e'.repeat(64),expectedLifecycleRevision:2,expectedCommitIndex:7,expectedWorldRevision:3}});
 const built=buildIdentityPromotionRequest({intent:approve,csrfToken:'csrf'});assert.equal(new Headers(built.init.headers).get('If-Match'),identityPromotionJobEtag(job));assert.equal(JSON.parse(built.init.body).expectedCommitIndex,7);
 for(const kind of ['retry','reject','cancel']){const intent=captureIdentityPromotionIntent({kind,runId,key,job:identityJobAnchor(job)});const request=buildIdentityPromotionRequest({intent,csrfToken:'csrf'});assert.equal(request.init.method,kind==='cancel'?'DELETE':'POST');assert.equal(request.init.body,'{}');}
 let calls=0;const api=createIdentityPromotionClient(async()=>{calls++;return new Response(JSON.stringify({requestId:key,error:{kind:'conflict',code:'IDENTITY_PROMOTION_STALE',message:'Cambió el corte.'}}),{status:409});},bootstrap);
 await assert.rejects(api.execute(approve,new AbortController().signal),failure=>identityPromotionRejection(failure)?.code==='IDENTITY_PROMOTION_STALE');assert.equal(calls,1);
});
test('private review validates exact actor and source without substituting a current or foreign private state',async()=>{
 const {configuratorEvolutionFixture}=await import('./fixtures/configurator-evolution.ts');const {configuratorValueHash}=await import('../src/application/configurator-context.ts');const {IdentityPromotionReviewSchema}=await import('../src/domain/identity-promotion-http.ts');
 const fixture=await configuratorEvolutionFixture();try{
  const scope=fixture.context.scope;if(scope.kind!=='evolution')throw new Error('Fixture');
  const value=IdentityPromotionJobViewSchema.parse({...job,jobId:scope.scope.jobId,runId:scope.scope.runId,actorId:scope.actorStateCut.actorId,state:'accepted',source:scope.anchor.source,contextHash:configuratorValueHash(fixture.context)});
  const review=IdentityPromotionReviewSchema.parse({kind:'identity-promotion-review',job:value,context:fixture.context,proposal:fixture.proposal,candidateHash:'d'.repeat(64),proposalHash:configuratorValueHash(fixture.proposal),targetFullHash:fixture.context.targetFullHash});
  const api=createIdentityPromotionClient(async()=>new Response(JSON.stringify(review),{headers:{etag:identityPromotionJobEtag(value)}}),bootstrap);
  assert.deepEqual(await api.review({runId:value.runId,jobId:value.jobId},new AbortController().signal),review);
  const other={...review,job:{...value,actorId:'another-actor'}};const bad=createIdentityPromotionClient(async()=>new Response(JSON.stringify(other),{headers:{etag:identityPromotionJobEtag(other.job)}}),bootstrap);
  await assert.rejects(bad.review({runId:value.runId,jobId:value.jobId},new AbortController().signal),/personaje y al corte/);
 }finally{fixture.close();}
});
