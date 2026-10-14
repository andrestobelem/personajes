import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openBackupService } from '../src/application/backup-service.ts';
import { BackupPathSchema } from '../src/domain/backup.ts';
import { exchangeIntegrity } from '../src/adapters/exchange-integrity.ts';

const runId='00000000-0000-4000-8000-000000000501';
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'personajes-backup-'));
  const db=new DatabaseSync(join(root,'world.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE schema_version(version INTEGER); INSERT INTO schema_version VALUES(26);
    CREATE TABLE world_runs(run_id TEXT,commit_index INTEGER,world_revision INTEGER,last_seq INTEGER,snapshot_hash TEXT);
    CREATE TABLE pending_delivery(id TEXT,state TEXT); INSERT INTO pending_delivery VALUES('pending-1','pending');`);
  db.prepare('INSERT INTO world_runs VALUES(?,?,?,?,?)').run(runId,2,2,2,'a'.repeat(64));
  const memoryPath=`runs/${runId}/actors/maxwell-smart/memory.sqlite`;
  mkdirSync(join(root,`runs/${runId}/actors/maxwell-smart`),{recursive:true});
  const memory=new DatabaseSync(join(root,memoryPath));
  memory.exec("PRAGMA journal_mode=WAL; CREATE TABLE memories(content TEXT); INSERT INTO memories VALUES('No escuché que hubiera salido.');");
  const sessionPath=`runs/${runId}/actors/maxwell-smart/sessions/session-1.jsonl`;
  mkdirSync(join(root,`runs/${runId}/actors/maxwell-smart/sessions`));
  writeFileSync(join(root,sessionPath),'{"type":"session","id":"s1"}\n');
  writeFileSync(join(root,'pi-auth.json'),'EXCLUDED-CREDENTIAL-SENTINEL');
  return {root,db,memory,memoryPath,sessionPath,cleanup(){memory.close();db.close();rmSync(root,{recursive:true,force:true});}};
}

test('backup Online Backup includes WAL journal/ICM and registered sessions, excludes auth, verifies bytes',async()=>{
  const f=fixture();let released=0;
  const service=openBackupService({privateDataRoot:f.root,quiesce:{async acquire(){return {artifacts:[{path:f.memoryPath,kind:'sqlite'},{path:f.sessionPath,kind:'session'}],release(){released++;}};}}});
  try {
    const backupId=randomUUID();const request={backupId,scope:{kind:'all'}};
    const job=await service.create(request);assert.equal(job.state,'succeeded');assert.equal(released,1);
    assert.deepEqual(await service.create(request),job);assert.equal(released,1);
    const bundle=service.verify(backupId);assert.equal(bundle.manifest.fences[0]?.lastSeq,2);
    assert.equal(bundle.manifest.files.length,3);assert.equal(existsSync(join(bundle.bundleRoot,'pi-auth.json')),false);
    const journalCopy=new DatabaseSync(join(bundle.bundleRoot,'world.sqlite'),{readOnly:true});
    const memoryCopy=new DatabaseSync(join(bundle.bundleRoot,f.memoryPath),{readOnly:true});
    try {assert.equal(journalCopy.prepare('SELECT state FROM pending_delivery').get()?.state,'pending');assert.equal(memoryCopy.prepare('SELECT content FROM memories').get()?.content,'No escuché que hubiera salido.');}
    finally {journalCopy.close();memoryCopy.close();}
    assert.equal(readFileSync(join(bundle.bundleRoot,f.sessionPath),'utf8'),'{"type":"session","id":"s1"}\n');
    const p=service.preview({backupId,mode:'recover'});assert.ok(p.blockers.includes('RESTORE_SESSION_PATH_RECONCILIATION_REQUIRED'));
    await assert.rejects(service.restore({previewToken:p.previewToken,confirmDiffHash:p.diffHash}),/RESTORE_BLOCKED/);
    writeFileSync(join(bundle.bundleRoot,f.sessionPath),'tampered');assert.throws(()=>service.verify(backupId),/BACKUP_FILE_TAMPERED/);
  } finally {service.close();f.cleanup();}
});

test('backup rejects traversal, secret inventory and symlinks; waits outside SQLite transactions',async()=>{
  assert.equal(BackupPathSchema.safeParse('../pi-auth.json').success,false);
  const f=fixture();let released=0;
  const service=openBackupService({privateDataRoot:f.root,quiesce:{async acquire(){
    // A separate journal writer succeeds while acquiring quiescence: no long transaction.
    f.db.prepare('INSERT INTO pending_delivery VALUES(?,?)').run('during-wait','pending');
    return {artifacts:[{path:'pi-auth.json',kind:'session'}],release(){released++;}};
  }}});
  try {assert.equal((await service.create({backupId:randomUUID(),scope:{kind:'all'}})).state,'failed');assert.equal(released,1);}
  finally {service.close();}
  rmSync(join(f.root,f.sessionPath));symlinkSync(join(f.root,'pi-auth.json'),join(f.root,f.sessionPath));
  const second=openBackupService({privateDataRoot:f.root,quiesce:{async acquire(){return {artifacts:[{path:f.sessionPath,kind:'session'}],release(){}};}}});
  try {assert.equal((await second.create({backupId:randomUUID(),scope:{kind:'all'}})).state,'failed');}
  finally {second.close();f.cleanup();}
});

test('restart marks abandoned backup interrupted and never replaces original job',()=>{
  const f=fixture();const service=openBackupService({privateDataRoot:f.root});service.close();
  const backupId=randomUUID();const job={backupId,revision:0,state:'running',safeCode:null,manifestHash:null};
  f.db.prepare('INSERT INTO backup_jobs(backup_id,request_hash,job_json) VALUES(?,?,?)').run(backupId,'a'.repeat(64),JSON.stringify(job));
  exchangeIntegrity(f.db).seal('backup_jobs','backup_id=?',[backupId]);
  const reopened=openBackupService({privateDataRoot:f.root});
  try {assert.equal(reopened.get(backupId).state,'interrupted');assert.equal(reopened.get(backupId).revision,1);}
  finally {reopened.close();f.cleanup();}
});

test('restore preview binds diff, expiration and mutable target; confirmed result replay is durable',async()=>{
  const f=fixture();let fingerprint='before',time=1000,applied=0;
  const service=openBackupService({privateDataRoot:f.root,now:()=>time,
    quiesce:{async acquire(){return {artifacts:[],release(){}};}},
    restore:{preview(){return {differences:['no overwrite; offline owned destination'],blockers:[],targetFingerprint:fingerprint};},async apply(){applied++;return {kind:'restored',newRunId:randomUUID()};}}});
  try {
    const backupId=randomUUID();await service.create({backupId,scope:{kind:'all'}});
    const p=service.preview({backupId,mode:'fork'});
    await assert.rejects(service.restore({previewToken:p.previewToken,confirmDiffHash:'0'.repeat(64)}),/DIFF_CONFIRMATION/);
    fingerprint='diverged';await assert.rejects(service.restore({previewToken:p.previewToken,confirmDiffHash:p.diffHash}),/TARGET_DIVERGED/);assert.equal(applied,0);
    fingerprint='before';time=400000;await assert.rejects(service.restore({previewToken:p.previewToken,confirmDiffHash:p.diffHash}),/EXPIRED/);
    const fresh=service.preview({backupId,mode:'fork'});const result=await service.restore({previewToken:fresh.previewToken,confirmDiffHash:fresh.diffHash});
    assert.deepEqual(await service.restore({previewToken:fresh.previewToken,confirmDiffHash:fresh.diffHash}),result);assert.equal(applied,1);
  } finally {service.close();f.cleanup();}
});
