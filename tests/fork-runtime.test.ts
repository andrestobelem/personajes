import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync,mkdtempSync,mkdirSync,rmSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openLocalHost } from '../src/application/local-host.ts';
import { createForkRuntime } from '../src/application/fork-runtime.ts';
import { draftFixture } from './fixtures/continuista.ts';
import { freezeExperience } from '../src/application/experience-envelope.ts';
import { createIcmMemoryAdapter } from '../src/adapters/icm.ts';

const binaryPath=process.env.PERSONAJES_ICM_TEST_BINARY;
const real={skip:binaryPath===undefined?'ICM real no configurado':false};
function fixture(memories=0){
 const directory=mkdtempSync(join(tmpdir(),'personajes-fork-runtime-'));const data=join(directory,'data');const host=openLocalHost({privateDataRoot:data});
 const {kind,schemaVersion,runId,revision,...patch}=draftFixture();
 const draft=host.journal.createRunConfigurationDraft({principalId:'fork-test',idempotencyKey:randomUUID(),patch});assert.ok(draft.kind==='created');
 const ready=host.journal.validateRunConfigurationDraft({principalId:'fork-test',idempotencyKey:randomUUID(),runId:draft.draft.runId,expectedRevision:0});assert.ok(ready.kind==='ready');
 let world=host.journal.loadWorld({runId:ready.runId});assert.ok(world);const actor=world.entities.find(entity=>entity.kind==='character');assert.ok(actor?.kind==='character');
 if(memories>0){
  host.journal.setWorldLifecycle({runId:world.runId,expectedWorldRevision:world.revision,expectedConfigRevision:0,target:'running'});
  for(let i=0;i<memories;i++)host.journal.recordExperience(freezeExperience({schemaVersion:1,experienceId:randomUUID(),runId:world.runId,actorId:actor.characterId,kind:'belief',content:`Recuerdo propio sintético ${i}. No pertenece al canon.`,sourceRefs:[],fictitiousAt:world.clock.instant,receivedAt:world.clock.instant,worldSeq:world.seq,confidence:0.4,revision:0,predecessor:{kind:'initial'},basedOn:[]}));
  const applied=host.journal.applyCircumstanceCommand({runId:world.runId,principalId:'fork-test',idempotencyKey:randomUUID(),operationId:randomUUID(),expectedWorldRevision:world.revision,expectedDirectionRevision:0,payload:{kind:'changeCircumstance',scope:{kind:'run'},operation:{kind:'setLighting',placeId:world.places[0]?.id,level:'dim'}}});assert.ok(applied.kind==='stored');
  world=host.journal.loadWorld({runId:ready.runId});assert.ok(world);
 }
 const request={runId:world.runId,commitIndex:memories>0?1:0,worldRevision:world.revision,worldSeq:world.seq,operationId:randomUUID(),principalId:'fork-test',idempotencyKey:randomUUID(),name:'Bifurcación sintética',reason:'Prueba de independencia y recuperación.'};
 return {directory,data,host,world,request,actorId:actor.characterId};
}
function identity(f:ReturnType<typeof fixture>){return {operationId:f.request.operationId,principalId:f.request.principalId};}
function sourceRequest(f:ReturnType<typeof fixture>){return {runId:f.request.runId,commitIndex:f.request.commitIndex,worldRevision:f.request.worldRevision,worldSeq:f.request.worldSeq};}
function sqlCounts(root:string,runId:string){const db=new DatabaseSync(join(root,'world.sqlite'),{readOnly:true});try{return ['world_events','actor_pi_sessions','actor_turn_jobs','structure_events'].map(table=>db.prepare(`SELECT count(*) AS n FROM ${table} WHERE run_id=?`).get(runId)?.n);}finally{db.close();}}

test('fork runtime publishes only verified independent ICM, with no actor sessions or source changes',real,async()=>{
 assert.ok(binaryPath);const f=fixture(2);const runtime=createForkRuntime({host:f.host,binaryPath});try{
  const source=f.host.journal.readForkSource(sourceRequest(f));assert.ok(source.kind==='found');
  const result=runtime.begin(f.request);assert.ok(result.kind==='created');assert.equal(result.job.state,'staging');assert.equal(f.host.journal.loadWorld({runId:result.job.targetRunId}),undefined);
  await runtime.waitForIdle();const job=runtime.read(f.request);assert.ok(job?.state==='ready');
  const target=f.host.journal.loadWorld({runId:job.targetRunId});assert.ok(target);assert.equal(target.seq,f.world.seq);assert.equal(target.revision,0);
  assert.deepEqual(f.host.journal.readForkSource(sourceRequest(f)),source);assert.deepEqual(sqlCounts(f.data,job.targetRunId),[0,0,0,0]);
  const cut=f.host.journal.readActorStateCut({runId:job.targetRunId,actorId:f.actorId,commitIndex:0,worldRevision:0,worldSeq:target.seq});assert.ok(cut.kind==='found');assert.equal(cut.cut.experiences.length,2);
  const adapter=await createIcmMemoryAdapter({privateDataRoot:f.data,runId:job.targetRunId,actorId:f.actorId,binaryPath,ledger:{findReceipt:request=>f.host.journal.readForkProjectionReceipt({operationId:job.operationId,...request})}});
  const actual=await adapter.diagnostics.listForensic({throughWorldSeq:target.seq});assert.equal(actual.rejectedCount,0);assert.equal(actual.experiences.length,2);assert.ok(actual.experiences.every(item=>item.experience.runId===job.targetRunId&&item.experience.forkOrigin?.sourceRunId===f.world.runId));
  const replay=runtime.begin(f.request);assert.ok(replay.kind==='existing');assert.deepEqual(replay.job,job);
  assert.equal(runtime.begin({...f.request,name:'Otro destino con misma clave'}).kind,'idempotencyConflict');
 }finally{await runtime.close();f.host.close();rmSync(f.directory,{recursive:true,force:true});}
});

for(const interruption of ['memory','artifacts'] as const)test(`fork resumes ${interruption} interruption with the same target, IDs and durable receipts`,real,async()=>{
 assert.ok(binaryPath);const f=fixture(3);let runtime:ReturnType<typeof createForkRuntime>|undefined;let closing:Promise<void>|undefined;
 runtime=createForkRuntime({host:f.host,binaryPath,onProgress:event=>{if((interruption==='memory'&&event.kind==='memory'&&event.completed===1)||(interruption==='artifacts'&&event.kind==='artifacts'))closing=runtime?.close();}});
 let reopened:ReturnType<typeof openLocalHost>|undefined;let recovered:ReturnType<typeof createForkRuntime>|undefined;
 try{
  const begun=runtime.begin(f.request);assert.ok(begun.kind==='created');await runtime.waitForIdle();await closing;
  const staged=runtime.read(f.request);assert.ok(staged?.state==='staging');assert.equal(f.host.journal.loadWorld({runId:staged.targetRunId}),undefined);
  const receipts=f.host.journal.readForkProjectionReceipts(identity(f));assert.equal(receipts.length,interruption==='memory'?1:3);
  const packet=f.host.journal.readForkPackage(identity(f));f.host.close();
  reopened=openLocalHost({privateDataRoot:f.data});recovered=createForkRuntime({host:reopened,binaryPath});recovered.recover();await recovered.waitForIdle();
  const ready=recovered.read(f.request);assert.ok(ready?.state==='ready');assert.equal(ready.targetRunId,staged.targetRunId);assert.deepEqual(reopened.journal.readForkPackage(identity(f)),packet);
  const after=reopened.journal.readForkProjectionReceipts(identity(f));for(const receipt of receipts)assert.deepEqual(after.find(item=>item.experienceId===receipt.experienceId),receipt);
 }finally{await runtime?.close();await recovered?.close();reopened?.close();f.host.close();rmSync(f.directory,{recursive:true,force:true});}
});

test('fork initializes empty private archives and rejects a symlink target before publication, then retries',real,async()=>{
 assert.ok(binaryPath);const f=fixture();const runtime=createForkRuntime({host:f.host,binaryPath});try{
  const begun=runtime.begin(f.request);assert.ok(begun.kind==='created');mkdirSync(join(f.data,'runs'),{recursive:true});const external=join(f.directory,'unrelated');mkdirSync(external);const target=join(f.data,'runs',begun.job.targetRunId);symlinkSync(external,target);
  await runtime.waitForIdle();const failed=runtime.read(f.request);assert.ok(failed?.state==='failed');assert.equal(f.host.journal.loadWorld({runId:failed.targetRunId}),undefined);assert.equal(existsSync(join(external,'fork-owner.json')),false);
  rmSync(target);const retried=runtime.retry({...f.request,expectedRevision:failed.revision});assert.ok(retried?.state==='staging');await runtime.waitForIdle();const ready=runtime.read(f.request);assert.ok(ready?.state==='ready');
  const db=new DatabaseSync(join(f.data,'runs',ready.targetRunId,'actors',f.actorId,'memory.sqlite'),{readOnly:true});try{assert.deepEqual(db.prepare('PRAGMA quick_check').all().map(row=>row.quick_check),['ok']);}finally{db.close();}
 }finally{await runtime.close();f.host.close();rmSync(f.directory,{recursive:true,force:true});}
});

test('fork recovers a completed ICM store that was interrupted before its journal receipt',real,async()=>{
 assert.ok(binaryPath);const f=fixture(1);let runtime:ReturnType<typeof createForkRuntime>|undefined;let closing:Promise<void>|undefined;
 const interruptedHost={...f.host,journal:{...f.host.journal,recordForkProjection(_request:unknown){closing=runtime?.close();throw new Error('Proceso interrumpido antes del receipt');}}};
 runtime=createForkRuntime({host:interruptedHost,binaryPath});let reopened:ReturnType<typeof openLocalHost>|undefined;let recovered:ReturnType<typeof createForkRuntime>|undefined;
 try{
  const begun=runtime.begin(f.request);assert.ok(begun.kind==='created');await runtime.waitForIdle();await closing;
  const staged=runtime.read(f.request);assert.ok(staged?.state==='staging');assert.deepEqual(f.host.journal.readForkProjectionReceipts(identity(f)),[]);
  const path=join(f.data,'forks',staged.operationId,'staging','runs',staged.targetRunId,'actors',f.actorId,'memory.sqlite');
  const db=new DatabaseSync(path,{readOnly:true});let stored:unknown;try{const rows=db.prepare('SELECT id FROM memories').all();assert.equal(rows.length,1);stored=rows[0]?.id;}finally{db.close();}
  f.host.close();reopened=openLocalHost({privateDataRoot:f.data});recovered=createForkRuntime({host:reopened,binaryPath});recovered.recover();await recovered.waitForIdle();
  assert.equal(recovered.read(f.request)?.state,'ready');assert.equal(reopened.journal.readForkProjectionReceipts(identity(f))[0]?.memoryId,stored);
 }finally{await runtime?.close();await recovered?.close();reopened?.close();f.host.close();rmSync(f.directory,{recursive:true,force:true});}
});
