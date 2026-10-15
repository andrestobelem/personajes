import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {openBackupService,type BackupRestoreContext,type ExternalBackupPort} from '../src/application/backup-service.ts';
import {BackupOriginSchema} from '../src/domain/fork-origin.ts';
const quiesce={async acquire(){return {artifacts:[],release(){}};}};
function hostRoot(prefix:string){const root=realpathSync(mkdtempSync(join(tmpdir(),prefix)));const db=new DatabaseSync(join(root,'world.sqlite'));db.exec('CREATE TABLE schema_version(version INTEGER);INSERT INTO schema_version VALUES(39);CREATE TABLE world_runs(run_id TEXT,commit_index INTEGER,world_revision INTEGER,last_seq INTEGER,snapshot_hash TEXT)');const runId=randomUUID();db.prepare('INSERT INTO world_runs VALUES(?,?,?,?,?)').run(runId,0,0,0,'a'.repeat(64));db.close();return {root,runId};}
async function fixture(){
 const local=hostRoot('personajes-external-local-'),foreign=hostRoot('personajes-external-source-');const source=openBackupService({privateDataRoot:foreign.root,quiesce});const backupId=randomUUID();await source.create({backupId,scope:{kind:'all'}});const registrationId=randomUUID();const request={backupId,externalRegistrationId:registrationId,principalId:'operator-one',mode:'fork' as const,sourceRunId:foreign.runId,name:'Desde otro host',reason:'Ensayo de un registro autorizado.'};
 let resolveCalls=0;const external:ExternalBackupPort={resolve(input){resolveCalls++;if(input.principalId!==request.principalId||input.registrationId!==registrationId)throw new Error('RESTORE_EXTERNAL_SOURCE_NOT_FOUND');const {manifest,hash,bundleRoot}=source.verify(backupId);return {manifest,hash,bundleRoot};}};
 return {local,foreign,source,backupId,registrationId,request,external,get resolveCalls(){return resolveCalls;},cleanup(){source.close();rmSync(local.root,{recursive:true,force:true});rmSync(foreign.root,{recursive:true,force:true});}};
}
const assessment={differences:['Nueva representación desde fuente externa registrada.'],blockers:[],targetFingerprint:'stable'};

test('external preview and apply bind registered authority without relaxing local verification or exposing private paths',async()=>{
 const f=await fixture();let effects=0;const contexts:BackupRestoreContext[]=[];const service=openBackupService({privateDataRoot:f.local.root,quiesce,restore:{preview(context){contexts.push(context);return assessment;},async apply(context){effects++;contexts.push(context);return {operationId:context.operationId,state:'staging'};}}});
 try{
  assert.throws(()=>service.verify(f.backupId),/BACKUP_NOT_FOUND/);assert.throws(()=>service.preview(f.request),/RESTORE_EXTERNAL_SOURCE_UNAVAILABLE/);service.setExternalBackupPort(f.external);assert.throws(()=>service.setExternalBackupPort(f.external),/RESTORE_EXTERNAL_SOURCE_ALREADY_CONFIGURED/);
  const p=service.preview({...f.request,idempotencyKey:randomUUID()});assert.ok(p.operationId);assert.equal(p.externalRegistrationId,f.registrationId);assert.equal('bundleRoot' in p,false);assert.equal('intent' in p,false);assert.equal('principalId' in p,false);assert.equal(p.backupId,f.backupId);const apply={principalId:f.request.principalId,previewToken:p.previewToken,confirmDiffHash:p.diffHash,backupId:f.backupId};
  await assert.rejects(service.restore(apply),/RESTORE_PREVIEW_TARGET_MISMATCH/);await assert.rejects(service.restore({...apply,externalRegistrationId:randomUUID()}),/RESTORE_PREVIEW_TARGET_MISMATCH/);await assert.rejects(service.restore({...apply,externalRegistrationId:f.registrationId,principalId:'another-operator'}),/RESTORE_PREVIEW_NOT_FOUND/);assert.equal(effects,0);
  const result=await service.restore({...apply,externalRegistrationId:f.registrationId});assert.deepEqual(result,{operationId:p.operationId,state:'staging'});assert.equal(effects,1);for(const context of contexts){assert.equal(context.externalRegistrationId,f.registrationId);assert.equal(context.operationId,p.operationId);assert.equal(context.sourceRunId,f.foreign.runId);assert.equal(context.manifest.backupId,f.backupId);assert.equal(context.bundleRoot,f.source.verify(f.backupId).bundleRoot);}
  assert.throws(()=>service.verify(f.backupId),/BACKUP_NOT_FOUND/);
 }finally{await service.waitForRestores();service.close();f.cleanup();}
});

test('external resolution rejects recover, wrong backup identity and principal; idempotency binds registration',async()=>{
 const f=await fixture();const service=openBackupService({privateDataRoot:f.local.root,restore:{preview(){return assessment;},async apply(){return {};}}});service.setExternalBackupPort(f.external);
 try{
  assert.throws(()=>service.preview({backupId:f.backupId,externalRegistrationId:f.registrationId,principalId:f.request.principalId,mode:'recover'}),/RESTORE_EXTERNAL_RECOVER_UNAVAILABLE/);assert.equal(f.resolveCalls,0);
  assert.throws(()=>service.preview({...f.request,backupId:randomUUID()}),/RESTORE_PREVIEW_TARGET_MISMATCH/);assert.throws(()=>service.preview({...f.request,principalId:'wrong-owner'}),/RESTORE_EXTERNAL_SOURCE_NOT_FOUND/);
  const key=randomUUID();const p=service.preview({...f.request,idempotencyKey:key});assert.deepEqual(service.preview({...f.request,idempotencyKey:key}),p);assert.throws(()=>service.preview({...f.request,idempotencyKey:key,name:'Otra intención'}),/RESTORE_IDEMPOTENCY_REUSE/);
 }finally{service.close();f.cleanup();}
});

test('claimed external intent resumes after restart with the original registry binding and operation',async()=>{
 const f=await fixture();let operationId:string|undefined;const first=openBackupService({privateDataRoot:f.local.root,restore:{preview(){return assessment;},async apply(context){operationId=context.operationId;throw new Error('Simulated interruption');}}});first.setExternalBackupPort(f.external);const p=first.preview(f.request);await assert.rejects(first.restore({backupId:f.backupId,externalRegistrationId:f.registrationId,principalId:f.request.principalId,previewToken:p.previewToken,confirmDiffHash:p.diffHash}),/Simulated interruption/);first.close();let resumed=0;
 const second=openBackupService({privateDataRoot:f.local.root,now:()=>p.expiresAt+100,restore:{preview(){throw new Error('Claimed intent needs no new assessment');},async apply(context){resumed++;assert.equal(context.operationId,operationId);assert.equal(context.externalRegistrationId,f.registrationId);assert.equal(context.manifest.backupId,f.backupId);return {operationId:context.operationId,state:'ready'};}}});
 try{assert.deepEqual(await second.recoverRestores(),[{previewToken:p.previewToken,status:'failed',code:'RESTORE_EXTERNAL_SOURCE_UNAVAILABLE'}]);assert.equal(resumed,0);second.setExternalBackupPort(f.external);assert.deepEqual(await second.recoverRestores(),[{previewToken:p.previewToken,status:'resumed'}]);assert.equal(resumed,1);assert.deepEqual(await second.recoverRestores(),[]);}
 finally{await second.waitForRestores();second.close();f.cleanup();}
});

test('external resolved manifest hash remains bound through confirmation and registration identity cannot be swapped',async()=>{
 const f=await fixture();let changed=false;let calls=0;const secondRegistration=randomUUID();const service=openBackupService({privateDataRoot:f.local.root,restore:{preview(){return assessment;},async apply(){calls++;return {};}}});service.setExternalBackupPort({resolve(input){const resolved=f.external.resolve({...input,registrationId:f.registrationId});return {...resolved,hash:changed?'b'.repeat(64):resolved.hash};}});
 try{const key=randomUUID();const p=service.preview({...f.request,idempotencyKey:key});assert.throws(()=>service.preview({...f.request,idempotencyKey:key,externalRegistrationId:secondRegistration}),/RESTORE_IDEMPOTENCY_REUSE/);changed=true;assert.throws(()=>service.preview({...f.request,idempotencyKey:key}),/RESTORE_IDEMPOTENCY_REUSE/);await assert.rejects(service.restore({backupId:f.backupId,externalRegistrationId:f.registrationId,principalId:f.request.principalId,previewToken:p.previewToken,confirmDiffHash:p.diffHash}),/RESTORE_BLOCKED/);assert.equal(calls,0);}
 finally{service.close();f.cleanup();}
});

test('backup origin preserves optional external archive assurance without changing local origin schema',()=>{
 const local={backupId:randomUUID(),lineageId:randomUUID(),manifestHash:'a'.repeat(64),journalHash:'b'.repeat(64)};assert.deepEqual(BackupOriginSchema.parse(local),local);const external={...local,externalRegistration:{registrationId:randomUUID(),archiveSha256:'c'.repeat(64),originAssurance:'operator-upload-unverified-origin'}};assert.deepEqual(BackupOriginSchema.parse(external),external);assert.equal(BackupOriginSchema.safeParse({...external,externalRegistration:{...external.externalRegistration,originAssurance:'verified-host-origin'}}).success,false);
});
