import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,renameSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { createHostBackupQuiesce } from '../src/application/host-backup-quiesce.ts';
import { createWorldDeliverySupervisor } from '../src/application/world-delivery-supervisor.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createExchangeRuntime } from '../src/application/exchange-runtime.ts';
import { createVoiceRuntime } from '../src/application/voice-runtime.ts';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { operatorJson } from '../src/server/operator-extension.ts';
import { SessionCreatedSchema } from '../src/domain/http.ts';
import { setup } from './fixtures/continuista.ts';
import { createRepresentationRuntime } from '../src/application/representation-runtime.ts';
import { openBackupService } from '../src/application/backup-service.ts';
import { createIcmMemoryAdapter } from '../src/adapters/icm.ts';
import { createProjectMemoryWorker } from '../src/application/project-memory.ts';

function deferred(){let resolve=()=>{};const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}

test('HTTP admission barrier excludes its own backup, waits existing lazy GET writers, denies new admission',async()=>{
 const root=mkdtempSync(join(tmpdir(),'personajes-backup-barrier-'));const host=openLocalHost({privateDataRoot:root});
 const catalog=await loadCatalog({repositoryRoot:process.cwd()});const exchange=await createExchangeRuntime({host,catalog});
 const voice=createVoiceRuntime({host});const deliveries=createWorldDeliverySupervisor({journal:host.journal});const admission=createHostRequestBarrier();
 const inactive={backupBusy:false};const quiesce=createHostBackupQuiesce({host,admission,oauth:inactive,access:inactive,preflight:inactive,voice:voice.service,deliveries});exchange.setBackupQuiesce(quiesce);
 const entered=deferred(),finish=deferred();
 const server=createLocalHttpServer({catalog,shellHtml:'<html><head></head><body></body></html>',admissionBarrier:admission,runtimeComposition:()=>({kind:'composed'}),operatorExtensions:[exchange.routes,
  {name:'lazy-test-writer',matches:({path})=>path[0]==='lazy-test-writer',async handle(){entered.resolve();await finish.promise;host.journal.listRunConfigurationDrafts();return operatorJson({kind:'finished'});}}]});
 try {
  const {origin}=await server.listen();const headers={Origin:origin,'Sec-Fetch-Site':'same-origin'};
  const health=await (await fetch(origin+'/api/v1/health')).json();assert.equal(z.object({checks:z.object({runtime:z.string()})}).parse(health).checks.runtime,'degraded');
  const html=await (await fetch(origin+'/',{headers})).text();const bootNonce=html.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]{43})"/)?.[1];assert.ok(bootNonce);
  const sessionResponse=await fetch(origin+'/api/v1/session',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({bootNonce})});const session=SessionCreatedSchema.parse(await sessionResponse.json());const cookie=sessionResponse.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const slow=fetch(origin+'/api/v1/lazy-test-writer',{headers:{...headers,Cookie:cookie}});await entered.promise;
  const backupId=randomUUID();const backup=fetch(origin+'/api/v1/backups/'+backupId,{method:'PUT',headers:{...headers,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'Idempotency-Key':randomUUID(),'If-None-Match':'*'},body:JSON.stringify({scope:{kind:'all'}})});
  // Poll only process state, never a database transaction while waiting for the writer.
  const deadline=Date.now()+2000;while(!admission.isHeld){if(Date.now()>deadline)throw new Error('BARRIER_TIMEOUT');await new Promise<void>(done=>setImmediate(done));}
  assert.equal(admission.activeRequests,1);assert.equal((await fetch(origin+'/api/v1/health')).status,503);
  const pending=await fetch(origin+'/api/v1/backups/'+backupId,{headers:{...headers,Cookie:cookie}});assert.equal(pending.status,200);
  finish.resolve();assert.equal((await slow).status,200);const response=await backup;assert.equal(response.status,202);const job=z.object({state:z.string()}).parse(await response.json());assert.equal(job.state,'succeeded');assert.equal(admission.isHeld,false);assert.equal(admission.activeRequests,0);
  const bundle=exchange.backups.verify(backupId);assert.deepEqual(bundle.manifest.files.map(file=>file.path),['world.sqlite']);assert.equal((await fetch(origin+'/api/v1/health')).status,200);
 }finally{finish.resolve();await server.close();exchange.close();await voice.close();await deliveries.close();host.close();rmSync(root,{recursive:true,force:true});rmSync(root+'-auth',{recursive:true,force:true});}
});

test('representation backup suspension gates schedules and real ICM backup preserves receipts without model calls',{
 skip:process.env.PERSONAJES_ICM_TEST_BINARY===undefined?'Definí ICM real para este ensayo de composición.':false,
},async()=>{
 const binary=process.env.PERSONAJES_ICM_TEST_BINARY;assert.ok(binary);
 const f=await setup();f.journal.close();renameSync(join(f.directory,'journal.sqlite'),join(f.directory,'world.sqlite'));const host=openLocalHost({privateDataRoot:f.directory});
 const voice=createVoiceRuntime({host});const admission=createHostRequestBarrier();const inactive={backupBusy:false};
 const runtime=await createRepresentationRuntime({host,icmBinaryPath:binary});
 const quiesce=createHostBackupQuiesce({host,admission,oauth:inactive,access:inactive,preflight:inactive,voice:voice.service,representation:runtime});
 const backups=openBackupService({privateDataRoot:host.privateDataRoot,quiesce});
 try {
  const adapter=await createIcmMemoryAdapter({privateDataRoot:host.privateDataRoot,runId:f.claim.runId,actorId:f.claim.actorId,binaryPath:binary,ledger:{findReceipt:input=>host.journal.findReceipt(input)}});
  await adapter.checkHealth();const projector=createProjectMemoryWorker({journal:host.journal,projector:adapter.projector,runId:f.claim.runId,actorId:f.claim.actorId});
  assert.equal((await projector.drain({maxItems:100})).kind,'completed');
  const before=host.journal.readRunModelTimeBudget({runId:f.claim.runId});
  const backupId=randomUUID();const job=await backups.create({backupId,scope:{kind:'all'}});assert.equal(job.state,'succeeded');
  const bundle=backups.verify(backupId);const memoryPath=`runs/${f.claim.runId}/actors/${f.claim.actorId}/memory.sqlite`;
  assert.ok(bundle.manifest.files.some(file=>file.path===memoryPath));const copied=new DatabaseSync(join(bundle.bundleRoot,'world.sqlite'),{readOnly:true});
  try{assert.ok(Number(copied.prepare('SELECT COUNT(*) AS count FROM memory_receipts').get()?.count)>0);}finally{copied.close();}
  assert.equal(host.journal.readWorldLifecycle({runId:f.claim.runId})?.lifecycle,'paused');
  const suspended=await runtime.suspendAdmissions([f.claim.runId]);assert.equal(await runtime.scheduleRun({runId:f.claim.runId}),false);suspended();
  assert.equal(await runtime.scheduleRun({runId:f.claim.runId}),false,'pausa no habilita convocatorias por liberar la barrera');
  assert.deepEqual(host.journal.readRunModelTimeBudget({runId:f.claim.runId}),before);
 }finally{backups.close();await voice.close();await runtime.close();rmSync(f.directory,{recursive:true,force:true});rmSync(f.directory+'-auth',{recursive:true,force:true});}
});

test('backup pauses running lifecycle at CAS fence, settles delivery writers, retains pending ICM and rejects busy OAuth before pause',async()=>{
 const f=await setup();f.journal.close();renameSync(join(f.directory,'journal.sqlite'),join(f.directory,'world.sqlite'));const host=openLocalHost({privateDataRoot:f.directory});
 const voice=createVoiceRuntime({host});const deliveries=createWorldDeliverySupervisor({journal:host.journal});const admission=createHostRequestBarrier();const busy={backupBusy:true};const inactive={backupBusy:false};
 try {
  const refused=createHostBackupQuiesce({host,admission,oauth:busy,access:inactive,preflight:inactive,voice:voice.service,deliveries});
  await assert.rejects(refused.acquire(),/BACKUP_OAUTH_ACTIVE_CANCEL_OR_RETRY/);assert.equal(admission.isHeld,false);assert.equal(host.journal.readWorldLifecycle({runId:f.claim.runId})?.lifecycle,'running');
  const before=host.journal.readWorldLifecycle({runId:f.claim.runId});assert.ok(before);deliveries.recover();
  const quiesce=createHostBackupQuiesce({host,admission,oauth:inactive,access:inactive,preflight:inactive,voice:voice.service,deliveries});
  const hold=await quiesce.acquire();assert.equal(admission.isHeld,true);const paused=host.journal.readWorldLifecycle({runId:f.claim.runId});assert.equal(paused?.lifecycle,'paused');assert.ok((paused?.lifecycleRevision??0)>before.lifecycleRevision);
  const db=new DatabaseSync(join(host.privateDataRoot,'world.sqlite'),{readOnly:true});try{const pending=db.prepare('SELECT COUNT(*) AS count FROM memory_outbox WHERE experience_id NOT IN(SELECT experience_id FROM memory_receipts)').get();assert.ok(Number(pending?.count)>0);}finally{db.close();}
  hold.release();hold.release();assert.equal(admission.isHeld,false);assert.equal(host.journal.readWorldLifecycle({runId:f.claim.runId})?.lifecycle,'paused');
 }finally{await voice.close();await deliveries.close();host.close();rmSync(f.directory,{recursive:true,force:true});rmSync(f.directory+'-auth',{recursive:true,force:true});}
});
