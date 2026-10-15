import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFileSync,linkSync,mkdirSync,mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createForkRuntime } from '../src/application/fork-runtime.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createHostBackupQuiesce } from '../src/application/host-backup-quiesce.ts';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { openBackupService } from '../src/application/backup-service.ts';
import { draftFixture } from './fixtures/continuista.ts';
import { freezeExperience } from '../src/application/experience-envelope.ts';
const binaryPath=process.env.PERSONAJES_ICM_TEST_BINARY;
const real={skip:binaryPath===undefined?'ICM real no configurado':false};
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'personajes-fork-backup-'));const host=openLocalHost({privateDataRoot:join(directory,'source')});
 const {kind,schemaVersion,runId,revision,...patch}=draftFixture();const draft=host.journal.createRunConfigurationDraft({principalId:'fork-backup',idempotencyKey:randomUUID(),patch});assert.ok(draft.kind==='created');
 const ready=host.journal.validateRunConfigurationDraft({principalId:'fork-backup',idempotencyKey:randomUUID(),runId:draft.draft.runId,expectedRevision:0});assert.ok(ready.kind==='ready');let world=host.journal.loadWorld({runId:ready.runId});assert.ok(world);const actor=world.entities.find(item=>item.kind==='character');assert.ok(actor?.kind==='character');
 host.journal.setWorldLifecycle({runId:world.runId,expectedWorldRevision:world.revision,expectedConfigRevision:0,target:'running'});
 for(let i=0;i<3;i++)host.journal.recordExperience(freezeExperience({schemaVersion:1,experienceId:randomUUID(),runId:world.runId,actorId:actor.characterId,kind:'belief',content:`Recuerdo sintético ${i}`,sourceRefs:[],fictitiousAt:world.clock.instant,receivedAt:world.clock.instant,worldSeq:world.seq,confidence:0.5,revision:0,predecessor:{kind:'initial'},basedOn:[]}));
 const changed=host.journal.applyCircumstanceCommand({runId:world.runId,principalId:'fork-backup',idempotencyKey:randomUUID(),operationId:randomUUID(),expectedWorldRevision:world.revision,expectedDirectionRevision:0,payload:{kind:'changeCircumstance',scope:{kind:'run'},operation:{kind:'setLighting',placeId:world.places[0]?.id,level:'dim'}}});assert.equal(changed.kind,'stored');world=host.journal.loadWorld({runId:ready.runId});assert.ok(world);
 const request={runId:world.runId,commitIndex:1,worldRevision:world.revision,worldSeq:world.seq,operationId:randomUUID(),principalId:'fork-backup',idempotencyKey:randomUUID(),name:'Copia sintética',reason:'Verificar conservación de proyecciones.'};
 return {directory,host,request,actorId:actor.characterId};
}
function quiesce(host:ReturnType<typeof openLocalHost>,forks?:{suspendAdmissions():Promise<()=>void>}){const inactive={backupBusy:false};return createHostBackupQuiesce({host,admission:createHostRequestBarrier(),oauth:inactive,access:inactive,preflight:inactive,...(forks?{forks}:{}),deliveries:{async suspendAdmissions(){return ()=>{};}},voice:{async suspendAdmissions(){return ()=>{};},backupArtifacts(){return [];}}});}
for(const stopAt of ['memory','artifacts'] as const)test(`backup retains unfinished fork at ${stopAt} and offline bundle resumes identical ICM IDs`,real,async()=>{
 assert.ok(binaryPath);const f=fixture();let runtime:ReturnType<typeof createForkRuntime>|undefined;let closing:Promise<void>|undefined;
 runtime=createForkRuntime({host:f.host,binaryPath,onProgress:event=>{if((stopAt==='memory'&&event.kind==='memory'&&event.completed===1)||(stopAt==='artifacts'&&event.kind==='artifacts'))closing=runtime?.close();}});
 let restored:ReturnType<typeof openLocalHost>|undefined;let recovered:ReturnType<typeof createForkRuntime>|undefined;let service:ReturnType<typeof openBackupService>|undefined;
 try{
  const begun=runtime.begin(f.request);assert.ok(begun.kind==='created');await runtime.waitForIdle();await closing;const lookup={operationId:f.request.operationId,principalId:f.request.principalId};const before=f.host.journal.readForkProjectionReceipts(lookup);assert.equal(before.length,stopAt==='memory'?1:3);
  runtime=createForkRuntime({host:f.host,binaryPath});service=openBackupService({privateDataRoot:f.host.privateDataRoot,quiesce:quiesce(f.host,runtime)});const backupId=randomUUID();const result=await service.create({backupId,scope:{kind:'all'}});assert.equal(result.state,'succeeded',result.safeCode??'');const bundle=service.verify(backupId);
  assert.ok(bundle.manifest.files.some(item=>item.path===`forks/${begun.job.operationId}/package.json`));const memory=bundle.manifest.files.find(item=>item.path.endsWith(`/actors/${f.actorId}/memory.sqlite`));assert.ok(memory);assert.match(memory.path,stopAt==='memory'?/^forks\//:/^runs\//);assert.deepEqual(readFileSync(join(bundle.bundleRoot,memory.path)),readFileSync(join(f.host.privateDataRoot,memory.path)));
  const target=join(f.directory,'offline-restored');mkdirSync(target);for(const file of bundle.manifest.files){const path=join(target,file.path);mkdirSync(dirname(path),{recursive:true});copyFileSync(join(bundle.bundleRoot,file.path),path);}
  restored=openLocalHost({privateDataRoot:target});recovered=createForkRuntime({host:restored,binaryPath});recovered.recover();await recovered.waitForIdle();const ready=recovered.read(lookup);assert.equal(ready?.state,'ready');assert.equal(ready?.targetRunId,begun.job.targetRunId);for(const receipt of before)assert.deepEqual(restored.journal.readForkProjectionReceipts(lookup).find(item=>item.experienceId===receipt.experienceId),receipt);
 }finally{service?.close();await runtime.close();await recovered?.close();restored?.close();f.host.close();rmSync(f.directory,{recursive:true,force:true});}
});

test('backup refuses unfinished fork without admission fence and releases HTTP hold',real,async()=>{
 assert.ok(binaryPath);const f=fixture();const runtime=createForkRuntime({host:f.host,binaryPath});try{const result=runtime.begin(f.request);assert.ok(result.kind==='created');await runtime.close();await assert.rejects(quiesce(f.host).acquire(),/BACKUP_FORK_BARRIER_UNAVAILABLE/);}finally{await runtime.close();f.host.close();rmSync(f.directory,{recursive:true,force:true});}
});

test('backup rejects missing receipt memory and hardlinked fork metadata',real,async()=>{
 assert.ok(binaryPath);const f=fixture();let runtime:ReturnType<typeof createForkRuntime>|undefined;runtime=createForkRuntime({host:f.host,binaryPath,onProgress:event=>{if(event.kind==='memory'&&event.completed===1)void runtime?.close();}});
 try{const begun=runtime.begin(f.request);assert.ok(begun.kind==='created');await runtime.waitForIdle();const path=join(f.host.privateDataRoot,'forks',begun.job.operationId,'package.json');linkSync(path,join(f.directory,'external.json'));await assert.rejects(quiesce(f.host,{async suspendAdmissions(){return ()=>{};}}).acquire(),/BACKUP_FORK_FILE_INVALID/);rmSync(join(f.directory,'external.json'));const memoryPath=join(f.host.privateDataRoot,'forks',begun.job.operationId,'staging','runs',begun.job.targetRunId,'actors',f.actorId,'memory.sqlite');const memoryDb=new DatabaseSync(memoryPath);try{memoryDb.exec('DELETE FROM memories');}finally{memoryDb.close();}await assert.rejects(quiesce(f.host,{async suspendAdmissions(){return ()=>{};}}).acquire(),/BACKUP_FORK_RECEIPT_MEMORY_INVALID/);rmSync(memoryPath);await assert.rejects(quiesce(f.host,{async suspendAdmissions(){return ()=>{};}}).acquire(),/BACKUP_FORK_MEMORY_MISSING/);
 }finally{await runtime.close();f.host.close();rmSync(f.directory,{recursive:true,force:true});}
});


test('backup drains concurrent fork publication before listing world fences and releases admissions',real,async()=>{
 assert.ok(binaryPath);const f=fixture();const runtime=createForkRuntime({host:f.host,binaryPath});const service=openBackupService({privateDataRoot:f.host.privateDataRoot,quiesce:quiesce(f.host,runtime)});
 try{
  const begun=runtime.begin(f.request);assert.ok(begun.kind==='created');const backupId=randomUUID();const result=await service.create({backupId,scope:{kind:'all'}});assert.equal(result.state,'succeeded',result.safeCode??'');assert.equal(runtime.read({operationId:f.request.operationId,principalId:f.request.principalId})?.state,'ready');const bundle=service.verify(backupId);assert.ok(bundle.manifest.fences.some(fence=>fence.runId===begun.job.targetRunId));assert.ok(bundle.manifest.files.some(item=>item.path===`runs/${begun.job.targetRunId}/actors/${f.actorId}/memory.sqlite`));const hold=await runtime.suspendAdmissions();assert.throws(()=>runtime.begin({...f.request,operationId:randomUUID(),idempotencyKey:randomUUID()}),/FORK_ADMISSIONS_SUSPENDED/);hold();assert.equal(runtime.begin(f.request).kind,'existing');
 }finally{service.close();await runtime.close();f.host.close();rmSync(f.directory,{recursive:true,force:true});}
});


test('backup allows a registered fork interrupted before any filesystem artifacts exist',real,async()=>{
 assert.ok(binaryPath);const f=fixture();let runtime=createForkRuntime({host:f.host,binaryPath});let service:ReturnType<typeof openBackupService>|undefined;
 try{const begun=runtime.begin(f.request);assert.ok(begun.kind==='created');await runtime.close();runtime=createForkRuntime({host:f.host,binaryPath});service=openBackupService({privateDataRoot:f.host.privateDataRoot,quiesce:quiesce(f.host,runtime)});const backupId=randomUUID();const job=await service.create({backupId,scope:{kind:'all'}});assert.equal(job.state,'succeeded',job.safeCode??'');assert.deepEqual(service.verify(backupId).manifest.files.map(file=>file.path),['world.sqlite']);runtime.recover();await runtime.waitForIdle();assert.equal(runtime.read({operationId:f.request.operationId,principalId:f.request.principalId})?.state,'ready');
 }finally{service?.close();await runtime.close();f.host.close();rmSync(f.directory,{recursive:true,force:true});}
});
