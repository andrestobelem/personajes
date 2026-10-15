import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,realpathSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openBackupService,type BackupRestorePort } from '../src/application/backup-service.ts';
import { exchangeIntegrity } from '../src/adapters/exchange-integrity.ts';
function fixture(){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'personajes-restore-service-')));const db=new DatabaseSync(join(root,'world.sqlite'));db.exec('CREATE TABLE schema_version(version INTEGER);INSERT INTO schema_version VALUES(36);CREATE TABLE world_runs(run_id TEXT,commit_index INTEGER,world_revision INTEGER,last_seq INTEGER,snapshot_hash TEXT)');
 const runId=randomUUID();db.prepare('INSERT INTO world_runs VALUES(?,?,?,?,?)').run(runId,2,1,3,'a'.repeat(64));db.close();
 return {root,runId,request:{principalId:'operator-one',sourceRunId:runId,name:'Restauración sintética',reason:'Prueba aislada del servicio.',mode:'fork' as const}};
}
const quiesce={async acquire(){return {artifacts:[],release(){}};}};
const assessment={differences:['fork selected frozen cut into a new run'],blockers:[],targetFingerprint:'stable'};
function deferred(){let resolve:()=>void=()=>{};const promise=new Promise<void>(done=>{resolve=done;});return {resolve,promise};}
test('preview binds principal, selection and idempotent operation without exposing private intent',async()=>{
 const f=fixture();let effects=0;const service=openBackupService({privateDataRoot:f.root,quiesce,restore:{preview(){return assessment;},async apply(){effects++;return {kind:'accepted'};}}});
 try{const backupId=randomUUID();await service.create({backupId,scope:{kind:'all'}});const request={...f.request,backupId,idempotencyKey:randomUUID()};const p=service.preview(request);assert.ok(p.operationId);assert.equal('intent' in p,false);assert.equal('principalId' in p,false);assert.deepEqual(service.preview(request),p);assert.throws(()=>service.preview({...request,name:'Otra intención'}),/RESTORE_IDEMPOTENCY_REUSE/);assert.notEqual(service.preview({...request,principalId:'operator-two'}).operationId,p.operationId);
 await assert.rejects(service.restore({principalId:'operator-two',previewToken:p.previewToken,confirmDiffHash:p.diffHash}),/RESTORE_PREVIEW_NOT_FOUND/);assert.equal(effects,0);await assert.rejects(service.restore({principalId:f.request.principalId,previewToken:p.previewToken,confirmDiffHash:'b'.repeat(64)}),/RESTORE_DIFF_CONFIRMATION_REQUIRED/);assert.equal(effects,0);
 }finally{service.close();rmSync(f.root,{recursive:true,force:true});}
});

test('concurrent confirmation shares work, and replay returns current operation even after expiry',async()=>{
 const f=fixture(),gate=deferred(),entered=deferred();let calls=0,time=1000;const operationIds:string[]=[];let state='staging';
 const service=openBackupService({privateDataRoot:f.root,quiesce,now:()=>time,restore:{preview(){return assessment;},async apply(input){calls++;operationIds.push(input.operationId);entered.resolve();await gate.promise;return {operationId:input.operationId,state};}}});
 try{const backupId=randomUUID();await service.create({backupId,scope:{kind:'all'}});const p=service.preview({...f.request,backupId});const request={principalId:f.request.principalId,previewToken:p.previewToken,confirmDiffHash:p.diffHash};const a=service.restore(request);await entered.promise;const b=service.restore(request);assert.equal(calls,1);assert.throws(()=>service.close(),/RESTORE_OPERATIONS_ACTIVE/);gate.resolve();assert.deepEqual(await a,await b);state='ready';time=p.expiresAt+1;assert.deepEqual(await service.restore(request),{operationId:p.operationId,state:'ready'});assert.deepEqual(operationIds,[p.operationId,p.operationId]);
 }finally{gate.resolve();await service.waitForRestores();service.close();rmSync(f.root,{recursive:true,force:true});}
});

test('claimed intent survives failed apply and restart, recovers same operation after expiry without reconfirmation',async()=>{
 const f=fixture();let time=1000;let firstOperation:string|undefined;const service=openBackupService({privateDataRoot:f.root,quiesce,now:()=>time,restore:{preview(){return assessment;},async apply(input){firstOperation=input.operationId;throw new Error('simulated interruption after durable claim');}}});
 const backupId=randomUUID();await service.create({backupId,scope:{kind:'all'}});const p=service.preview({...f.request,backupId});const unconfirmed=service.preview({...f.request,backupId});await assert.rejects(service.restore({principalId:f.request.principalId,previewToken:p.previewToken,confirmDiffHash:p.diffHash}),/simulated interruption/);service.close();time=p.expiresAt+100;
 let applied=0;const recovered=openBackupService({privateDataRoot:f.root,now:()=>time});
 try{await assert.rejects(recovered.recoverRestores(),/RESTORE_PORT_UNAVAILABLE/);const port:BackupRestorePort={preview(){throw new Error('Claimed intent must not run preclaim target check again');},async apply(input){applied++;assert.equal(input.operationId,firstOperation);assert.equal(input.operationId,p.operationId);assert.equal(input.sourceRunId,f.runId);assert.equal(input.principalId,f.request.principalId);return {operationId:input.operationId,state:'staging'};}};recovered.setRestorePort(port);assert.deepEqual(await recovered.recoverRestores(),[{previewToken:p.previewToken,status:'resumed'}]);assert.equal(applied,1);assert.deepEqual(await recovered.recoverRestores(),[]);await assert.rejects(recovered.restore({principalId:f.request.principalId,previewToken:unconfirmed.previewToken,confirmDiffHash:unconfirmed.diffHash}),/RESTORE_PREVIEW_EXPIRED/);
 }finally{await recovered.waitForRestores();recovered.close();rmSync(f.root,{recursive:true,force:true});}
});

test('tampered sealed restore metadata and legacy previews cannot authorize application',async()=>{
 const f=fixture();let calls=0;const service=openBackupService({privateDataRoot:f.root,quiesce,restore:{preview(){return assessment;},async apply(){calls++;return {};}}});
 try{const backupId=randomUUID();await service.create({backupId,scope:{kind:'all'}});const p=service.preview({...f.request,backupId});const db=new DatabaseSync(join(f.root,'world.sqlite'));try{const raw=db.prepare('SELECT preview_json FROM backup_restore_previews WHERE token=?').get(p.previewToken);assert.ok(typeof raw?.preview_json==='string');const changed=JSON.parse(raw.preview_json);changed.intent.principalId='operator-two';db.prepare('UPDATE backup_restore_previews SET preview_json=? WHERE token=?').run(JSON.stringify(changed),p.previewToken);await assert.rejects(service.restore({principalId:'operator-two',previewToken:p.previewToken,confirmDiffHash:p.diffHash}),/EXCHANGE_METADATA_TAMPERED/);delete changed.intent;delete changed.operationId;db.prepare('UPDATE backup_restore_previews SET preview_json=? WHERE token=?').run(JSON.stringify(changed),p.previewToken);exchangeIntegrity(db).seal('backup_restore_previews','token=?',[p.previewToken]);await assert.rejects(service.restore({principalId:f.request.principalId,previewToken:p.previewToken,confirmDiffHash:p.diffHash}),/RESTORE_LEGACY_PREVIEW_RECREATE/);assert.equal(calls,0);}finally{db.close();}
 }finally{service.close();rmSync(f.root,{recursive:true,force:true});}
});
