import test from 'node:test';
import assert from 'node:assert/strict';
import { captureForkIntent, buildForkRequest, createForkClient, newerForkJob } from '../src/web/fork-client.ts';
import { ForkJobViewSchema, forkJobEtag } from '../src/domain/fork-http.ts';
const runId='11111111-1111-4111-8111-111111111111', operationId='22222222-2222-4222-8222-222222222222', key='33333333-3333-4333-8333-333333333333';
const source={runId,commitIndex:7,worldRevision:3,worldSeq:2};
const intent=captureForkIntent({source,body:{operationId,name:'Otra puesta',reason:'Cambiar la perspectiva',commitIndex:7,worldRevision:3,worldSeq:2},key});
const job=ForkJobViewSchema.parse({kind:'fork-job',state:'staging',operationId,targetRunId:key,source:{...source,snapshotHash:'a'.repeat(64),configurationRevision:0,configurationHash:'b'.repeat(64)},name:'Otra puesta',reason:'Cambiar la perspectiva',audioDerivation:{kind:'initial-ready-configuration',sourceConfigurationHash:'b'.repeat(64),effectiveHistory:'not-reconstructed',bindingState:'unbound'},revision:0,createdAt:0,updatedAt:0});
const bootstrap=async()=>({csrfToken:'csrf',expiresAt:'2026-10-16T00:00:00Z'});
test('fork intent captures immutable exact source and emits strict body plus CSRF/CAS/key',()=>{
 const copy=structuredClone(intent); const captured=captureForkIntent(copy); copy.source.commitIndex=intent.source.worldRevision; copy.body.name='Changed';
 const request=buildForkRequest({intent:captured,csrfToken:'csrf'});
 assert.equal(request.path,`/api/v1/runs/${runId}/forks`); assert.equal(request.init.headers['If-Match'],`"fork-source:${runId}:c7:w3:s2"`); assert.equal(request.init.headers['Idempotency-Key'],key); assert.equal(request.init.headers['X-CSRF-Token'],'csrf');
 assert.equal(JSON.parse(request.init.body).name,'Otra puesta'); assert.equal('runId' in JSON.parse(request.init.body),false); assert.throws(()=>captureForkIntent({...intent,source:{...source,commitIndex:8}}));
});
test('fork client accepts DTO with exact ETag and rejects cross operation and mismatched cut',async()=>{
 const controller=new AbortController();
 const api=createForkClient(async()=>new Response(JSON.stringify(job),{status:202,headers:{etag:forkJobEtag(job)}}),bootstrap);
 assert.deepEqual(await api.begin(intent,controller.signal),job);
 const bad=createForkClient(async()=>new Response(JSON.stringify({...job,source:{...job.source,commitIndex:8}}),{headers:{etag:forkJobEtag(job)}}),bootstrap);
 await assert.rejects(bad.begin(intent,controller.signal),/intento conservado/);
 await assert.rejects(api.read(runId,controller.signal),/otra operación/);
});
test('unknown transport outcome can repeat the identical begin without a new operation',async()=>{
 const calls:Array<{url:string;body:unknown}>=[]; let first=true;
 const api=createForkClient(async(url,init)=>{calls.push({url:String(url),body:init?.body});if(first){first=false;throw new Error('respuesta perdida');}return new Response(JSON.stringify(job),{headers:{etag:forkJobEtag(job)}});},bootstrap);
 await assert.rejects(api.begin(intent,new AbortController().signal),/perdida/);
 await api.begin(intent,new AbortController().signal); assert.deepEqual(calls[0],calls[1]);
});
test('fork GET only reads operation and retry keeps target plus exact revision/key',async()=>{
 const failed=ForkJobViewSchema.parse({...job,state:'failed',code:'FORK_INTERRUPTED',revision:1});
 const calls:Array<{url:string;init:RequestInit|undefined}>=[];
 const api=createForkClient(async(url,init)=>{calls.push({url:String(url),init});const next=init?.method === 'POST' ? {...job,revision:2} : job;return new Response(JSON.stringify(next),{headers:{etag:forkJobEtag(next)}});},bootstrap);
 await api.read(operationId,new AbortController().signal); assert.equal(calls[0]?.init?.method,undefined);
 await api.retry({job:failed,key},new AbortController().signal);
 assert.equal(calls[1]?.url,`/api/v1/forks/${operationId}/retry`); assert.equal(calls[1]?.init?.body,'{}'); assert.deepEqual(calls[1]?.init?.headers,{'Content-Type':'application/json','X-CSRF-Token':'csrf','Idempotency-Key':key,'If-Match':forkJobEtag(failed)});
});

test('overlapping polling cannot undo a confirmed publication or change its source',()=>{
 const ready=ForkJobViewSchema.parse({...job,state:'ready',publishedAt:2,revision:2});
 assert.deepEqual(newerForkJob(ready,job),ready);
 assert.deepEqual(newerForkJob(job,ForkJobViewSchema.parse({...job,targetRunId:runId,revision:1})),job);
});

test('session intent persistence validates corruption and run scope without issuing a mutation', async()=>{
 const {readStoredForkIntent,writeStoredForkIntent}=await import('../src/web/fork-client.ts');
 const values=new Map<string,string>();
 const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
 assert.equal(writeStoredForkIntent(storage,runId,intent),true);assert.deepEqual(readStoredForkIntent(storage,runId),intent);
 assert.equal(writeStoredForkIntent(storage,key,intent),false);assert.equal(readStoredForkIntent(storage,key),null);
 values.set(`personajes:fork-intent:${runId}`,'{corrupted');assert.equal(readStoredForkIntent(storage,runId),null);
 writeStoredForkIntent(storage,runId,intent);writeStoredForkIntent(storage,runId,null);assert.equal(readStoredForkIntent(storage,runId),null);
});
