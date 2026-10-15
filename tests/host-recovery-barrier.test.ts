import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createHostRequestBarrier} from '../src/application/host-request-barrier.ts';
import {createLocalHttpServer} from '../src/server/http.ts';
import {operatorJson} from '../src/server/operator-extension.ts';
import {loadCatalog} from '../src/adapters/catalog.ts';
import {SessionCreatedSchema,ApiProblemSchema} from '../src/domain/http.ts';

test('recovery admission drains backup metadata and creation requests while preserving backup admission semantics',async()=>{
 const barrier=createHostRequestBarrier();const id=randomUUID();
 const metadata=barrier.enter({method:'GET',path:['api','v1','backups',id]});
 const creation=barrier.enter({method:'PUT',path:['api','v1','backups',id]});
 assert.equal(barrier.activeRequests,0,'backup retains its exclusion from its own active counter');
 let acquired=false;const acquiring=barrier.acquireRecovery().then(release=>{acquired=true;return release;});
 assert.equal(barrier.isRecovering,true);assert.equal(barrier.isHeld,true);
 await Promise.resolve();assert.equal(acquired,false);
 metadata();await Promise.resolve();assert.equal(acquired,false,'backup creation is also a durable writer');
 creation();const release=await acquiring;assert.equal(acquired,true);
 for(const request of [
  {method:'GET',path:['api','v1','backups',id]},
  {method:'PUT',path:['api','v1','backups',id]},
  {method:'GET',path:['api','v1','health']},
  {method:'PUT',path:['api','v1','session','mode']},
  {method:'POST',path:['api','v1','host-recoveries']},
 ])assert.throws(()=>barrier.enter(request),/HOST_RECOVERY_IN_PROGRESS/);
 for(const request of [
  {method:'GET',path:[]},{method:'HEAD',path:[]},{method:'GET',path:['assets','app.js']},
  {method:'POST',path:['api','v1','session']},{method:'GET',path:['api','v1','session']},{method:'DELETE',path:['api','v1','session']},
  {method:'GET',path:['api','v1','host-recoveries',id]},
 ])barrier.enter(request)();
 release();release();assert.equal(barrier.isRecovering,false);assert.equal(barrier.isHeld,false);
 const hold=await barrier.acquire();assert.equal(barrier.isRecovering,false);barrier.enter({method:'GET',path:['api','v1','backups',id]})();assert.throws(()=>barrier.enter({method:'GET',path:[]}),/HOST_BACKUP_IN_PROGRESS/);hold();
});

test('recovery HTTP keeps shell/session/job polling available, blocks database routes and resets session/bootstrap authority',async()=>{
 const barrier=createHostRequestBarrier();let metadataCalls=0;let pollingCalls=0;
 const server=createLocalHttpServer({catalog:await loadCatalog({repositoryRoot:process.cwd()}),shellHtml:'<html><head></head><body></body></html>',admissionBarrier:barrier,
 staticAssets:new Map([['/assets/app.js',{bytes:Buffer.from('void 0'),mimeType:'text/javascript'}]]),
 operatorExtensions:[{name:'recovery-memory-test',matches:({path})=>path[0]==='backups'||path[0]==='host-recoveries',handle(request){if(request.path[0]==='backups'){metadataCalls++;return operatorJson({kind:'metadata'});}pollingCalls++;return operatorJson({kind:'recovery-job'});}}]});
 try{
  const {origin}=await server.listen();const originHeaders={Origin:origin,'Content-Type':'application/json'};
  async function nonce(){const response=await fetch(origin+'/',{headers:originHeaders});assert.equal(response.status,200);const value=(await response.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(value);return value;}
  async function session(){const response=await fetch(origin+'/api/v1/session',{method:'POST',headers:originHeaders,body:JSON.stringify({bootNonce:await nonce()})});assert.equal(response.status,200);const created=SessionCreatedSchema.parse(await response.json());const cookie=response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);return {cookie,csrf:created.csrfToken};}
  const original=await session();const pendingNonce=await nonce();const release=await barrier.acquireRecovery();
  try{
   const headers={...originHeaders,Cookie:original.cookie};
   for(const path of ['/api/v1/backups/'+randomUUID(),'/api/v1/health','/api/v1/runs/'+randomUUID(),'/api/v1/integrations/pi']){
    const response=await fetch(origin+path,{headers});assert.equal(response.status,503,path);assert.equal(ApiProblemSchema.parse(await response.json()).error.code,'HOST_RECOVERY_IN_PROGRESS');
   }
   assert.equal(metadataCalls,0);
   assert.equal((await fetch(origin+'/',{method:'HEAD',headers:originHeaders})).status,200);
   assert.equal((await fetch(origin+'/assets/app.js',{headers:originHeaders})).status,200);
   assert.equal((await fetch(origin+'/api/v1/session',{headers})).status,200);
   const jobPath='/api/v1/host-recoveries/'+randomUUID();assert.equal((await fetch(origin+jobPath)).status,401);assert.equal((await fetch(origin+jobPath,{headers})).status,200);assert.equal(pollingCalls,1);
   await server.resetSessions();assert.equal((await fetch(origin+'/api/v1/session',{headers})).status,401);
   const expiredBootstrap=await fetch(origin+'/api/v1/session',{method:'POST',headers:originHeaders,body:JSON.stringify({bootNonce:pendingNonce})});assert.equal(expiredBootstrap.status,401);
   const fresh=await session();assert.equal((await fetch(origin+jobPath,{headers:{...originHeaders,Cookie:fresh.cookie}})).status,200);
   const logout=await fetch(origin+'/api/v1/session',{method:'DELETE',headers:{...originHeaders,Cookie:fresh.cookie,'X-CSRF-Token':fresh.csrf}});assert.equal(logout.status,204);
  }finally{release();}
 }finally{await server.close();}
});
