import assert from 'node:assert/strict';
import { request } from 'node:http';
import { rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { createRunLifecycleApplication } from '../src/application/run-lifecycle.ts';
import { SessionCreatedSchema,RunViewSchema } from '../src/domain/http.ts';
import { RunRefreshSchema } from '../src/domain/run-refresh.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { setup } from './fixtures/continuista.ts';

async function connect(origin:string,path:string,cookie:string,lastId?:string){
 return await new Promise<{
  status:number;nextFrame():Promise<string>;ended:Promise<void>;close():void;
 }>((resolve,reject)=>{
  const url=new URL(origin);const frames:string[]=[];const waiters:Array<{resolve:(v:string)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>=[];let buffer='',closed=false;
  const req=request({hostname:url.hostname,port:url.port,path,headers:{Cookie:cookie,Origin:origin,...(lastId?{'Last-Event-ID':lastId}:{})}},res=>{
   const ended=new Promise<void>(done=>{
    const finish=()=>{if(closed)return;closed=true;for(const waiter of waiters){clearTimeout(waiter.timer);waiter.reject(new Error('STREAM_ENDED'));}done();};
    res.once('end',finish);res.once('close',finish);
   });
   res.on('data',(chunk:Buffer)=>{
    buffer+=chunk.toString();let boundary=buffer.indexOf('\n\n');
    while(boundary>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const waiter=waiters.shift();if(waiter){clearTimeout(waiter.timer);waiter.resolve(frame);}else frames.push(frame);boundary=buffer.indexOf('\n\n');}
   });
   resolve({status:res.statusCode??0,ended,close(){req.destroy();res.destroy();},async nextFrame(){
    const frame=frames.shift();if(frame!==undefined)return frame;if(closed)throw new Error('STREAM_ENDED');
    return await new Promise<string>((resolveFrame,rejectFrame)=>{const timer=setTimeout(()=>rejectFrame(new Error('STREAM_TIMEOUT')),2000);waiters.push({resolve:resolveFrame,reject:rejectFrame,timer});});
   }});
  });req.once('error',reject);req.end();
 });
}
function data(frame:string){const raw=frame.split('\n').find(line=>line.startsWith('data: '))?.slice(6);assert.ok(raw);return RunRefreshSchema.parse(JSON.parse(raw));}
async function session(origin:string){
 const headers={Origin:origin,'Sec-Fetch-Site':'same-origin'};
 const html=await (await fetch(origin+'/',{headers})).text();const nonce=html.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]{43})"/)?.[1];assert.ok(nonce);
 const response=await fetch(origin+'/api/v1/session',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({bootNonce:nonce})});
 const created=SessionCreatedSchema.parse(await response.json());const cookie=response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);return {cookie,csrf:created.csrfToken};
}

test('real SSE sends public revision invalidations, scopes cursors, caps clients and closes on logout/server shutdown',async()=>{
 const f=await setup();const app=createRunLifecycleApplication({journal:f.journal});const first=app.readRunView({runId:f.claim.runId});assert.ok(first);let view=first;let controls=0;
 const server=createLocalHttpServer({catalog:await loadCatalog({repositoryRoot:process.cwd()}),shellHtml:'<html><head></head><body></body></html>',
  runLifecycle:{readRunView({runId}){return runId===view.runId?view:undefined;},controlRun(){controls++;throw new Error('NO_CONTROL_FROM_SSE');}},
  runRefreshStream:{pollIntervalMs:20,heartbeatMs:40,maxClients:1,maxClientsPerSession:1}});
 const connections:Array<Awaited<ReturnType<typeof connect>>>=[];
 try {
  const {origin}=await server.listen();const s=await session(origin);const path=`/api/v1/runs/${view.runId}/events/stream`;
  assert.equal((await fetch(origin+path)).status,401);
  assert.equal((await fetch(origin+path,{headers:{Cookie:s.cookie,Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await fetch(origin+path,{headers:{Cookie:s.cookie,'Last-Event-ID':'../../private'}})).status,400);
  const cross=`rf1.${randomUUID()}.c0.w0.l0.s0`;assert.equal((await fetch(origin+path,{headers:{Cookie:s.cookie,'Last-Event-ID':cross}})).status,400);
  const stream=await connect(origin,path,s.cookie);connections.push(stream);assert.equal(stream.status,200);
  const initialFrame=await stream.nextFrame();const initial=data(initialFrame);assert.equal(initial.runId,view.runId);
  assert.deepEqual(Object.keys(initial).sort(),['configRevision','kind','lastWorldSeq','lifecycleRevision','runId','worldRevision'].sort());
  const originalCursor=initialFrame.split('\n').find(line=>line.startsWith('id: '))?.slice(4);assert.ok(originalCursor);
  assert.equal((await fetch(origin+path,{headers:{Cookie:s.cookie}})).status,429);
  view=RunViewSchema.parse({...view,lifecycleRevision:view.lifecycleRevision+1});
  let changed=await stream.nextFrame();while(!changed.includes('data: '))changed=await stream.nextFrame();assert.equal(data(changed).lifecycleRevision,view.lifecycleRevision);assert.equal(controls,0);
  stream.close();await stream.ended;await delay(40);
  const resumed=await connect(origin,path,s.cookie,originalCursor);connections.push(resumed);assert.equal(data(await resumed.nextFrame()).lifecycleRevision,view.lifecycleRevision);
  const logout=await fetch(origin+'/api/v1/session',{method:'DELETE',headers:{Origin:origin,Cookie:s.cookie,'X-CSRF-Token':s.csrf}});assert.equal(logout.status,204);await resumed.ended;
  const next=await session(origin);const open=await connect(origin,path,next.cookie);connections.push(open);await open.nextFrame();await server.close();await open.ended;
 }finally{for(const stream of connections)stream.close();await server.close();f.journal.close();rmSync(f.directory,{recursive:true,force:true});}
});

test('SSE heartbeat never renews idle session; expiry ends stream without private content',async()=>{
 const f=await setup();const app=createRunLifecycleApplication({journal:f.journal});let clock=Date.now();
 const server=createLocalHttpServer({catalog:await loadCatalog({repositoryRoot:process.cwd()}),shellHtml:'<html><head></head><body></body></html>',now:()=>clock,
  runLifecycle:app,runRefreshStream:{pollIntervalMs:20,heartbeatMs:20}});let stream:Awaited<ReturnType<typeof connect>>|undefined;
 try {
  const {origin}=await server.listen();const s=await session(origin);stream=await connect(origin,`/api/v1/runs/${f.claim.runId}/events/stream`,s.cookie);
  await stream.nextFrame();clock+=1000;assert.equal(await stream.nextFrame(),': heartbeat');
  clock+=31*60*1000;await stream.ended;
  assert.equal((await fetch(origin+'/api/v1/session',{headers:{Cookie:s.cookie}})).status,401);
 }finally{stream?.close();await server.close();f.journal.close();rmSync(f.directory,{recursive:true,force:true});}
});

test('resetSessions closes SSE and waits for an in-flight refresh before a recovered host can replace its journal',async()=>{
 const f=await setup();const app=createRunLifecycleApplication({journal:f.journal});const view=app.readRunView({runId:f.claim.runId});assert.ok(view);
 const {createHostRequestBarrier}=await import('../src/application/host-request-barrier.ts');const barrier=createHostRequestBarrier();
 let enteredResolve=()=>{};const entered=new Promise<void>(resolve=>{enteredResolve=resolve;});let finishResolve=()=>{};const finish=new Promise<void>(resolve=>{finishResolve=resolve;});let reads=0;
 const server=createLocalHttpServer({catalog:await loadCatalog({repositoryRoot:process.cwd()}),shellHtml:'<html><head></head><body></body></html>',admissionBarrier:barrier,
 runRefreshStream:{pollIntervalMs:20,heartbeatMs:20},runLifecycle:{async readRunView(){reads++;if(reads>1){enteredResolve();await finish;}return view;},controlRun(){throw new Error('UNEXPECTED_CONTROL');}}});
 let stream:Awaited<ReturnType<typeof connect>>|undefined;let release:(()=>void)|undefined;
 try{
  const {origin}=await server.listen();const s=await session(origin);stream=await connect(origin,`/api/v1/runs/${f.claim.runId}/events/stream`,s.cookie);await stream.nextFrame();await entered;
  release=await barrier.acquireRecovery();let resetFinished=false;const reset=server.resetSessions().then(()=>{resetFinished=true;});await stream.ended;assert.equal(resetFinished,false,'pending refresh must drain before closing the database');
  finishResolve();await reset;const atReset=reads;await delay(50);assert.equal(reads,atReset,'invalidated streams cannot read a replacement journal');
  assert.equal((await fetch(origin+'/api/v1/session',{headers:{Cookie:s.cookie}})).status,401);
 }finally{finishResolve();release?.();stream?.close();await server.close();f.journal.close();rmSync(f.directory,{recursive:true,force:true});}
});

test('an applied identity response schedules only public revision refresh without waiting for periodic polling',async()=>{
 const f=await setup();const app=createRunLifecycleApplication({journal:f.journal});const before=app.readRunView({runId:f.claim.runId});assert.ok(before);let view=before;
 const {IdentityPromotionJobViewSchema}=await import('../src/domain/identity-promotion-http.ts');const {operatorJson}=await import('../src/server/operator-extension.ts');
 const {ForkSourceSchema}=await import('../src/domain/fork-origin.ts');const {hashContinuistaValue}=await import('../src/domain/continuista-review.ts');const world=f.journal.readInspectorWorldCut({runId:f.claim.runId,worldRevision:before.worldRevision,atWorldSeq:before.lastWorldSeq});assert.ok(world);
 const source=ForkSourceSchema.parse({runId:f.claim.runId,commitIndex:world.commitIndex,worldRevision:before.worldRevision,worldSeq:before.lastWorldSeq,snapshotHash:hashContinuistaValue(world.snapshot),configurationRevision:before.configRevision,configurationHash:hashContinuistaValue(f.configuration)});const jobId=randomUUID();
 const target={...source,commitIndex:source.commitIndex+1,worldRevision:source.worldRevision+1,configurationRevision:source.configurationRevision+1,snapshotHash:'a'.repeat(64),configurationHash:'b'.repeat(64)};
 const publicJob=IdentityPromotionJobViewSchema.parse({kind:'configurator-job',jobId,runId:f.claim.runId,actorId:f.claim.actorId,generation:0,revision:1,state:'accepted',source,contextHash:'c'.repeat(64),failureCode:null,createdAt:0,updatedAt:1,promotion:{kind:'applied',receipt:{kind:'identity-promotion-receipt',operationId:randomUUID(),actorId:f.claim.actorId,source,target,previousIdentityVersion:1,identityVersion:2,epochIndex:1,lifecycleRevision:before.lifecycleRevision+1,contextHash:'c'.repeat(64),proposalHash:'d'.repeat(64),recordedAt:'2026-10-15T23:00:00Z'}}});
 const server=createLocalHttpServer({catalog:await loadCatalog({repositoryRoot:process.cwd()}),shellHtml:'<html><head></head><body></body></html>',runRefreshStream:{pollIntervalMs:60_000,heartbeatMs:60_000},
 runLifecycle:{readRunView(){return view;},controlRun(){throw new Error('UNEXPECTED_CONTROL');}},
 // Simulate the already-authorized application response; promotion-core authority
 // and persistence are tested separately from this transport invalidation.
 operatorExtensions:[{name:'identity-promotion',matches:({path})=>path[0]==='identity-promotions',handle(){view=RunViewSchema.parse({...view,configRevision:view.configRevision+1,config:{...view.config,configRevision:view.configRevision+1},worldRevision:view.worldRevision+1,lifecycleRevision:view.lifecycleRevision+1});return operatorJson(publicJob);}}]});
 let stream:Awaited<ReturnType<typeof connect>>|undefined;
 try{const {origin}=await server.listen();const s=await session(origin);stream=await connect(origin,`/api/v1/runs/${f.claim.runId}/events/stream`,s.cookie);await stream.nextFrame();
  const response=await fetch(`${origin}/api/v1/identity-promotions/${jobId}/approve`,{method:'POST',headers:{Origin:origin,Cookie:s.cookie,'Content-Type':'application/json','X-CSRF-Token':s.csrf,'Idempotency-Key':randomUUID()},body:'{}'});assert.equal(response.status,200,await response.clone().text());
  const notified=data(await stream.nextFrame());assert.equal(notified.configRevision,before.configRevision+1);assert.equal(notified.worldRevision,before.worldRevision+1);assert.equal(notified.lifecycleRevision,before.lifecycleRevision+1);assert.deepEqual(Object.keys(notified).sort(),['kind','runId','configRevision','worldRevision','lifecycleRevision','lastWorldSeq'].sort());
 }finally{stream?.close();await server.close();f.journal.close();rmSync(f.directory,{recursive:true,force:true});}
});
