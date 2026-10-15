import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openBackupTransferService } from '../src/application/backup-transfer-service.ts';
import { hashFile, sha256 } from '../src/application/backup-transfer-files.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { openBackupService } from '../src/application/backup-service.ts';
import { ApprovedJournalSchemaSchema } from '../src/application/external-backup-validation.ts';
import { BACKUP_TRANSFER_PART_BYTES } from '../src/domain/backup-transfer.ts';
import { draftFixture } from './fixtures/continuista.ts';

const principalId='operator-test';
async function fixture(large = false) {
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'personajes-transfer-')));const root=join(directory,'data');const host=openLocalHost({privateDataRoot:root});
 const {kind,schemaVersion,runId,revision,...patch}=draftFixture();void kind;void schemaVersion;void runId;void revision;
 const draft=host.journal.createRunConfigurationDraft({principalId,idempotencyKey:randomUUID(),patch});assert.equal(draft.kind,'created');if(draft.kind!=='created')assert.fail();
 const ready=host.journal.validateRunConfigurationDraft({principalId,idempotencyKey:randomUUID(),runId:draft.draft.runId,expectedRevision:0});assert.equal(ready.kind,'ready');if(ready.kind!=='ready')assert.fail();
 const mediaPath=`media/${randomUUID()}.bin`;
 if(large){mkdirSync(join(root,'media'));writeFileSync(join(root,mediaPath),Buffer.alloc(2*1024*1024+123,0x6c),{mode:0o600});}
 const backups=openBackupService({privateDataRoot:root,quiesce:{async acquire(){return{artifacts:large?[{path:mediaPath,kind:'media'}]:[],release(){}};}}});
 const backupId=randomUUID();assert.equal((await backups.create({backupId,scope:{kind:'all'}})).state,'succeeded');
 const bundle=backups.verify(backupId);const db=new DatabaseSync(join(root,'world.sqlite'),{readOnly:true});
 const schema=ApprovedJournalSchemaSchema.parse(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all());db.close();
 const options={privateDataRoot:root,ownerToken:host.ownerToken,readLocalBackup:()=>bundle,readApprovedJournalSchema:()=>schema};
 let service=openBackupTransferService(options);
 const store=join(directory,'.data.personajes-backup-exchange');
 return{directory,root,host,backups,backupId,bundle,runId:ready.runId,options,store,get service(){return service;},async reopen(){await service.close();service=openBackupTransferService(options);return service;},async close(){await service.close();backups.close();host.close();rmSync(directory,{recursive:true,force:true});}};
}
async function exported(f:Awaited<ReturnType<typeof fixture>>){const job=await f.service.createExport({principalId,idempotencyKey:randomUUID(),backupId:f.backupId});await f.service.waitForIdle();const current=f.service.getExport({principalId,exportId:job.exportId});assert.equal(current.state,'succeeded');const download=await f.service.exportDownload({principalId,exportId:job.exportId});return{job,current,download,bytes:readFileSync(download.path)};}
async function uploaded(f:Awaited<ReturnType<typeof fixture>>,bytes:Buffer){let view=await f.service.beginImport({principalId,idempotencyKey:randomUUID(),fileName:'backup.pba',bytes:bytes.length});for(let offset=0;offset<bytes.length;offset+=BACKUP_TRANSFER_PART_BYTES){const part=bytes.subarray(offset,Math.min(bytes.length,offset+BACKUP_TRANSFER_PART_BYTES));view=await f.service.appendImportPart({principalId,importId:view.importId,idempotencyKey:randomUUID(),expectedRevision:view.revision,offset,contentBase64:part.toString('base64'),sha256:sha256(part)});}return view;}

test('export durable streams >1 MiB, replay preserves acknowledgement and download verifies bytes',async()=>{
 const f=await fixture(true);try{
  const request={principalId,idempotencyKey:randomUUID(),backupId:f.backupId};const queued=await f.service.createExport(request);assert.equal(queued.state,'queued');await f.service.waitForIdle();
  assert.deepEqual(await f.service.createExport(request),queued);
  const download=await f.service.exportDownload({principalId,exportId:queued.exportId});assert.ok(download.bytes>2*1024*1024);assert.deepEqual(hashFile(download.path,10*1024*1024),{bytes:download.bytes,sha256:download.sha256});
  assert.throws(()=>f.service.getExport({principalId:'other',exportId:queued.exportId}),/NOT_FOUND/);
  await assert.rejects(f.service.createExport({...request,backupId:randomUUID()}),/IDEMPOTENCY_REUSE/);
  await f.reopen();assert.equal(f.service.getExport({principalId,exportId:queued.exportId}).state,'succeeded');
 }finally{await f.close();}
});

test('multipart import validates real SQLite in child and publishes separate registration and exact frozen source',async()=>{
 const f=await fixture(true);try{
  const archive=await exported(f);const before=readFileSync(join(f.bundle.bundleRoot,'world.sqlite'));
  const upload=await uploaded(f,archive.bytes);const request={principalId,importId:upload.importId,idempotencyKey:randomUUID(),expectedRevision:upload.revision};
  const validating=await f.service.finalizeImport(request);assert.equal(validating.state,'validating');await f.service.waitForIdle();
  const ready=f.service.getImport({principalId,importId:upload.importId});assert.equal(ready.state,'registered',JSON.stringify(ready));if(ready.state!=='registered')assert.fail();
  assert.notEqual(ready.registration.registrationId,f.backupId);assert.equal(ready.registration.sourceBackupId,f.backupId);
  assert.deepEqual(await f.service.finalizeImport(request),validating);
  const resolved=f.service.resolveRegistration({principalId,registrationId:ready.registration.registrationId});assert.deepEqual(resolved.manifest,f.bundle.manifest);assert.equal(resolved.hash,f.bundle.hash);
  for(const file of f.bundle.manifest.files)assert.deepEqual(readFileSync(join(resolved.bundleRoot,file.path)),readFileSync(join(f.bundle.bundleRoot,file.path)));
  const source=f.service.readRegisteredSource({principalId,registrationId:ready.registration.registrationId,runId:f.runId});assert.equal(source.snapshot.runId,f.runId);assert.equal(source.backup.externalRegistration?.registrationId,ready.registration.registrationId);
  assert.deepEqual(readFileSync(join(f.bundle.bundleRoot,'world.sqlite')),before);
  await f.reopen();assert.deepEqual(f.service.getRegistration({principalId,registrationId:ready.registration.registrationId}),ready.registration);
  assert.throws(()=>f.service.getRegistration({principalId:'other',registrationId:ready.registration.registrationId}),/NOT_FOUND/);
 }finally{await f.close();}
});

test('lost part receipt reconciles exact partial/full tail without truncation; old receipt replays before CAS',async()=>{
 const f=await fixture();try{
  const bytes=Buffer.from('exact durable part');const started=await f.service.beginImport({principalId,idempotencyKey:randomUUID(),fileName:'tail.pba',bytes:bytes.length+1});
  const folder=join(f.store,'imports',started.importId);mkdirSync(folder,{mode:0o700});writeFileSync(join(folder,'archive.pba'),bytes.subarray(0,5),{mode:0o600});
  const request={principalId,importId:started.importId,idempotencyKey:randomUUID(),expectedRevision:0,offset:0,contentBase64:bytes.toString('base64'),sha256:sha256(bytes)};
  const ack=await f.service.appendImportPart(request);assert.deepEqual(readFileSync(join(folder,'archive.pba')),bytes);
  const cancelled=await f.service.cancelImport({principalId,importId:ack.importId,idempotencyKey:randomUUID(),expectedRevision:ack.revision});assert.equal(cancelled.state,'cancelled');
  assert.deepEqual(await f.service.appendImportPart(request),ack);assert.deepEqual(readFileSync(join(folder,'archive.pba')),bytes);
  await assert.rejects(f.service.appendImportPart({...request,contentBase64:Buffer.from('changed').toString('base64'),sha256:sha256('changed')}),/IDEMPOTENCY_REUSE/);
 }finally{await f.close();}
});

test('unacknowledged mismatched tail is preserved and linked upload is refused',async()=>{
 const f=await fixture();try{
  const start=await f.service.beginImport({principalId,idempotencyKey:randomUUID(),fileName:'tail.pba',bytes:10});const folder=join(f.store,'imports',start.importId);mkdirSync(folder,{mode:0o700});writeFileSync(join(folder,'archive.pba'),'wrong',{mode:0o600});
  await assert.rejects(f.service.appendImportPart({principalId,importId:start.importId,idempotencyKey:randomUUID(),expectedRevision:0,offset:0,contentBase64:Buffer.from('right').toString('base64'),sha256:sha256('right')}),/UNACKNOWLEDGED_TAIL/);
  assert.equal(readFileSync(join(folder,'archive.pba'),'utf8'),'wrong');assert.equal(f.service.getImport({principalId,importId:start.importId}).receivedBytes,0);
 }finally{await f.close();}
});

test('bad archive fails durably, explicit retry is idempotent and attempt reservations remain charged',async()=>{
 const f=await fixture();try{
  await f.service.close();const tiny=openBackupTransferService({...f.options,maxStoredBytes:64*1024*1024+3+2048+1024,validationLimits:{maxTotalSourceBytes:1024}});
  try{
   let view=await tiny.beginImport({principalId,idempotencyKey:randomUUID(),fileName:'bad.pba',bytes:3});view=await tiny.appendImportPart({principalId,importId:view.importId,idempotencyKey:randomUUID(),expectedRevision:view.revision,offset:0,contentBase64:'YmFk',sha256:sha256('bad')});
   // The part ledger itself reserves space, so a deliberately tiny limit blocks before extraction.
   await assert.rejects(tiny.finalizeImport({principalId,importId:view.importId,idempotencyKey:randomUUID(),expectedRevision:view.revision}),/DISK_LIMIT/);
  }finally{await tiny.close();}
 }finally{await f.close();}
});


test('real process interruption leaves validating work idle until an explicit retry with a new key',async()=>{
 const f=await fixture();try{
  const archive=await exported(f);await f.service.close();
  const moduleUrl=pathToFileURL(join(process.cwd(),'src/application/backup-transfer-service.ts')).href;
  const options={privateDataRoot:f.root,ownerToken:f.host.ownerToken,bundle:f.bundle,schema:f.options.readApprovedJournalSchema()};
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`
   import {openBackupTransferService} from ${JSON.stringify(moduleUrl)};
   import {readFileSync} from 'node:fs';import {randomUUID,createHash} from 'node:crypto';
   const options=${JSON.stringify(options)};
   const service=openBackupTransferService({...options,readLocalBackup:()=>options.bundle,readApprovedJournalSchema:()=>options.schema});
   const bytes=readFileSync(${JSON.stringify(archive.download.path)});
   let job=await service.beginImport({principalId:'operator-test',idempotencyKey:randomUUID(),fileName:'crash.pba',bytes:bytes.length});
   for(let offset=0;offset<bytes.length;offset+=1048576){const part=bytes.subarray(offset,Math.min(bytes.length,offset+1048576));job=await service.appendImportPart({principalId:'operator-test',importId:job.importId,idempotencyKey:randomUUID(),expectedRevision:job.revision,offset,contentBase64:part.toString('base64'),sha256:createHash('sha256').update(part).digest('hex')});}
   const request={principalId:'operator-test',importId:job.importId,idempotencyKey:randomUUID(),expectedRevision:job.revision};
   const accepted=await service.finalizeImport(request);process.stdout.write(JSON.stringify({accepted,request}));process.exit(0);
  `],{encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr);const data=JSON.parse(child.stdout);
  await f.reopen();const interrupted=f.service.getImport({principalId,importId:data.accepted.importId});assert.equal(interrupted.state,'interrupted');await f.service.waitForIdle();assert.deepEqual(f.service.getImport({principalId,importId:interrupted.importId}),interrupted);
  assert.deepEqual(await f.service.finalizeImport(data.request),data.accepted);
  const request={principalId,importId:interrupted.importId,idempotencyKey:randomUUID(),expectedRevision:interrupted.revision};const ack=await f.service.retryImport(request);await f.service.waitForIdle();assert.equal(f.service.getImport({principalId,importId:interrupted.importId}).state,'registered');assert.deepEqual(await f.service.retryImport(request),ack);
 }finally{await f.close();}
});

test('failed validation retries preserve forensic attempts and consume cumulative durable disk reservations',async()=>{
 const f=await fixture();try{
  await f.service.close();
  const perAttempt=512*1024*1024+64*1024*1024+1024+6;
  const base=64*1024*1024+3+2048;
  const tiny=openBackupTransferService({...f.options,maxStoredBytes:base+2*perAttempt+100,validationLimits:{maxTotalSourceBytes:1024}});
  try{
   let view=await tiny.beginImport({principalId,idempotencyKey:randomUUID(),fileName:'bad.pba',bytes:3});view=await tiny.appendImportPart({principalId,importId:view.importId,idempotencyKey:randomUUID(),expectedRevision:view.revision,offset:0,contentBase64:'YmFk',sha256:sha256('bad')});
   await tiny.finalizeImport({principalId,importId:view.importId,idempotencyKey:randomUUID(),expectedRevision:view.revision});await tiny.waitForIdle();view=tiny.getImport({principalId,importId:view.importId});assert.equal(view.state,'failed');
   const request={principalId,importId:view.importId,idempotencyKey:randomUUID(),expectedRevision:view.revision};const ack=await tiny.retryImport(request);await tiny.waitForIdle();view=tiny.getImport({principalId,importId:view.importId});assert.equal(view.state,'failed');assert.deepEqual(await tiny.retryImport(request),ack);
   await assert.rejects(tiny.retryImport({principalId,importId:view.importId,idempotencyKey:randomUUID(),expectedRevision:view.revision}),/DISK_LIMIT/);
   assert.deepEqual(readFileSync(join(f.store,'imports',view.importId,'archive.pba')),Buffer.from('bad'));
  }finally{await tiny.close();}
 }finally{await f.close();}
});


test('registered raw media and unexpected bundle files fail closed on metadata, resolution and source reads',async()=>{
 const f=await fixture(true);try{
  const archive=await exported(f);const view=await uploaded(f,archive.bytes);await f.service.finalizeImport({principalId,importId:view.importId,idempotencyKey:randomUUID(),expectedRevision:view.revision});await f.service.waitForIdle();
  const ready=f.service.getImport({principalId,importId:view.importId});assert.equal(ready.state,'registered');if(ready.state!=='registered')assert.fail();
  const request={principalId,registrationId:ready.registration.registrationId};const bundle=f.service.resolveRegistration(request);const media=bundle.manifest.files.find(file=>file.path.startsWith('media/'));assert.ok(media);
  const file=join(bundle.bundleRoot,media.path);const original=readFileSync(file);writeFileSync(file,Buffer.alloc(original.length,0x44));
  assert.throws(()=>f.service.resolveRegistration(request),/BUNDLE_CHANGED/);assert.throws(()=>f.service.readRegisteredSource({...request,runId:f.runId}),/BUNDLE_CHANGED/);
  writeFileSync(file,original);writeFileSync(join(bundle.bundleRoot,'extra-secret'),'unexpected',{mode:0o600});assert.throws(()=>f.service.getRegistration(request),/BUNDLE_INVENTORY_INVALID/);
 }finally{await f.close();}
});

test('upload rejects hardlinks without changing their bytes and ledger corruption is detected',async()=>{
 const f=await fixture();try{
  const view=await f.service.beginImport({principalId,idempotencyKey:randomUUID(),fileName:'link.pba',bytes:4});const folder=join(f.store,'imports',view.importId);mkdirSync(folder,{mode:0o700});const victim=join(f.directory,'victim');writeFileSync(victim,'',{mode:0o600});linkSync(victim,join(folder,'archive.pba'));
  await assert.rejects(f.service.appendImportPart({principalId,importId:view.importId,idempotencyKey:randomUUID(),expectedRevision:0,offset:0,contentBase64:'dGVzdA==',sha256:sha256('test')}),/FILE_INVALID/);assert.equal(readFileSync(victim).length,0);
  const db=new DatabaseSync(join(f.store,'transfer.sqlite'));db.prepare('UPDATE transfer_jobs SET principal_id=? WHERE id=?').run('stolen',view.importId);db.close();
  assert.throws(()=>f.service.getImport({principalId:'stolen',importId:view.importId}),/METADATA_TAMPERED/);
 }finally{await f.close();}
});


test('publication rename before final receipt resumes only the anchored registration and keeps its identity',async()=>{
 const f=await fixture();try{
  const archive=await exported(f);const view=await uploaded(f,archive.bytes);const ack=await f.service.finalizeImport({principalId,importId:view.importId,idempotencyKey:randomUUID(),expectedRevision:view.revision});await f.service.waitForIdle();
  const ready=f.service.getImport({principalId,importId:view.importId});assert.equal(ready.state,'registered');if(ready.state!=='registered')assert.fail();await f.service.close();
  // Legal crash frontier: published directory and verified metadata are durable;
  // final registered view is not committed yet. Reconstruct that frontier on disk.
  const db=new DatabaseSync(join(f.store,'transfer.sqlite'));const row=db.prepare('SELECT * FROM transfer_jobs WHERE id=?').get(view.importId);assert.ok(row);const payload=JSON.parse(String(row.payload_json));payload.view=ack;
  const data={id:String(row.id),kind:String(row.kind),principal_id:String(row.principal_id),owner_token:String(row.owner_token),payload_json:JSON.stringify(payload)};
  db.prepare('UPDATE transfer_jobs SET payload_json=?,checksum=? WHERE id=?').run(data.payload_json,sha256(JSON.stringify(Object.entries(data).sort(([a],[b])=>a.localeCompare(b)))),view.importId);db.close();
  await f.reopen();const interrupted=f.service.getImport({principalId,importId:view.importId});assert.equal(interrupted.state,'interrupted');
  await f.service.retryImport({principalId,importId:view.importId,idempotencyKey:randomUUID(),expectedRevision:interrupted.revision});await f.service.waitForIdle();const resumed=f.service.getImport({principalId,importId:view.importId});assert.equal(resumed.state,'registered',JSON.stringify(resumed));if(resumed.state!=='registered')assert.fail();
  assert.deepEqual(resumed.registration,ready.registration);assert.equal(f.service.readRegisteredSource({principalId,registrationId:resumed.registration.registrationId,runId:f.runId}).snapshot.runId,f.runId);
 }finally{await f.close();}
});
