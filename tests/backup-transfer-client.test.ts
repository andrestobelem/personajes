import test from 'node:test';
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {createBackupTransferClient,captureTransferFile,verifyTransferFile,captureTransferPart,rebuildTransferPart,readBackupTransferState,writeBackupTransferState,BackupTransferStateSchema,ExternalForkPreviewSchema,newerBackupImport} from '../src/web/backup-transfer-client.ts';
import {BACKUP_TRANSFER_PART_BYTES,BACKUP_ARCHIVE_DEFAULT_MAX_BYTES,BackupImportViewSchema,BackupExportViewSchema,RegisteredBackupSchema,backupImportEtag,backupExportEtag,backupRegistrationEtag} from '../src/domain/backup-transfer.ts';
import {ForkJobViewSchema,forkJobEtag} from '../src/domain/fork-http.ts';
const backupId='11111111-1111-4111-8111-111111111111',importId='22222222-2222-4222-8222-222222222222',registrationId='33333333-3333-4333-8333-333333333333',key='44444444-4444-4444-8444-444444444444',runId='55555555-5555-4555-8555-555555555555';
const bootstrap=async()=>({csrfToken:'csrf',expiresAt:'2026-10-20T00:00:00Z'});
const registration=RegisteredBackupSchema.parse({kind:'registered-backup',registrationId,sourceBackupId:backupId,sourceLineageId:key,manifestHash:'a'.repeat(64),archiveSha256:'b'.repeat(64),bytes:5,provenance:'operator-upload-unverified-origin',sources:[{runId,commitIndex:7,worldRevision:2,lastSeq:1,snapshotHash:'c'.repeat(64)}]});
function store(){const values=new Map<string,string>();return {values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}
test('file identity and sequential chunks read at most one MiB, never the whole file',async()=>{
 const file=new File([new Uint8Array(BACKUP_TRANSFER_PART_BYTES+3).fill(7)],'obra.pbackup');Object.defineProperty(file,'arrayBuffer',{value:()=>{throw new Error('Whole file forbidden');}});
 const metadata=await captureTransferFile(file);assert.equal(metadata.bytes,BACKUP_TRANSFER_PART_BYTES+3);assert.equal((await verifyTransferFile(file,metadata)).prefixSha256,metadata.prefixSha256);
 const first=await captureTransferPart({file,importId,revision:0,offset:0});if(first.kind!=='part')throw new Error('Fixture');assert.equal(first.byteLength,BACKUP_TRANSFER_PART_BYTES);const payload=await rebuildTransferPart(file,first);assert.equal(atob(payload.contentBase64).length,BACKUP_TRANSFER_PART_BYTES);
 const last=await captureTransferPart({file,importId,revision:1,offset:BACKUP_TRANSFER_PART_BYTES});assert.equal(last.kind==='part'&&last.byteLength,3);
 await assert.rejects(verifyTransferFile(new File(['changed'],'otra.pbackup'),metadata),/mismo archivo/);
 await assert.rejects(rebuildTransferPart(new File([new Uint8Array(BACKUP_TRANSFER_PART_BYTES+3).fill(8)],'obra.pbackup'),first),/parte elegida cambió/);
 const huge=new File([],'enorme.pbackup');Object.defineProperty(huge,'size',{value:BACKUP_ARCHIVE_DEFAULT_MAX_BYTES+1});await assert.rejects(captureTransferFile(huge));await assert.rejects(captureTransferFile(new File([],'vacio')));
});
test('durable transfer stores metadata and exact part identity, rejects cross-import and corruption',async()=>{
 const file=new File(['small'],'obra.pbackup');const metadata=await captureTransferFile(file);const pending=await captureTransferPart({file,importId,revision:0,offset:0});const state=BackupTransferStateSchema.parse({upload:{kind:'active',file:metadata,importId,pending}});const storage=store();assert.equal(writeBackupTransferState(storage,state),true);assert.deepEqual(readBackupTransferState(storage),state);assert.equal(JSON.stringify(state).includes('contentBase64'),false);assert.ok(JSON.stringify(state).length<1000);
 assert.throws(()=>BackupTransferStateSchema.parse({...state,upload:{...state.upload,importId:key}}));storage.values.set('personajes:backup-transfer','{corrupt');assert.deepEqual(readBackupTransferState(storage),{});
});
test('unknown part response repeats identical body/key/CAS and validates acknowledged bytes',async()=>{
 const file=new File(['small'],'obra.pbackup');const pending=await captureTransferPart({file,importId,revision:0,offset:0});if(pending.kind!=='part')throw new Error('Fixture');const job=BackupImportViewSchema.parse({kind:'backup-import',importId,fileName:file.name,bytes:5,receivedBytes:5,revision:1,state:'uploading',safeCode:null});const calls:Array<{path:string;init:RequestInit|undefined}>=[];let lost=true;
 const api=createBackupTransferClient(async(path,init)=>{calls.push({path:String(path),init});if(lost){lost=false;throw new Error('perdida');}return new Response(JSON.stringify(job),{headers:{etag:backupImportEtag(job)}});},bootstrap);
 await assert.rejects(api.part({intent:pending,file},new AbortController().signal),/perdida/);assert.deepEqual(await api.part({intent:pending,file},new AbortController().signal),job);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0]?.init?.method,'PUT');assert.equal(new Headers(calls[0]?.init?.headers).get('If-Match'),'"backup-import:'+importId+':r0"');assert.equal(new Headers(calls[0]?.init?.headers).get('Idempotency-Key'),pending.key);
 const incomplete={...job,receivedBytes:0};const bad=createBackupTransferClient(async()=>new Response(JSON.stringify(incomplete),{headers:{etag:backupImportEtag(incomplete)}}),bootstrap);await assert.rejects(bad.part({intent:pending,file},new AbortController().signal),/parte completa/);
});
test('import control requests remain explicit and GET only consults the same job',async()=>{
 const job=BackupImportViewSchema.parse({kind:'backup-import',importId,fileName:'obra',bytes:5,receivedBytes:5,revision:2,state:'validating',safeCode:null});const calls:Array<{path:string;init:RequestInit|undefined}>=[];
 const api=createBackupTransferClient(async(path,init)=>{calls.push({path:String(path),init});return new Response(JSON.stringify(job),{headers:{etag:backupImportEtag(job)}});},bootstrap);
 await api.readImport(importId,new AbortController().signal);assert.equal(calls[0]?.init?.method,undefined);
 for(const kind of ['finalize','retry','cancel']){const parsed=BackupTransferStateSchema.parse({upload:{kind:'active',file:{fileName:'obra',bytes:5,prefixSha256:'a'.repeat(64)},importId,pending:{kind,key,importId,revision:1}}});if(parsed.upload?.kind!=='active'||parsed.upload.pending===undefined||parsed.upload.pending.kind==='part')throw new Error('Fixture');await api.control(parsed.upload.pending,new AbortController().signal);}
 assert.deepEqual(calls.slice(1).map(call=>[call.path,call.init?.method]),[['/api/v1/backup-imports/'+importId+'/finalize','POST'],['/api/v1/backup-imports/'+importId+'/retry','POST'],['/api/v1/backup-imports/'+importId,'DELETE']]);assert.ok(calls.slice(1).every(call=>call.init?.body==='{}'));
 const registered=BackupImportViewSchema.parse({...job,state:'registered',registration});assert.deepEqual(newerBackupImport(registered,job),registered);
});
test('complete download preparation validates identity/ETag without fetching archive bytes',async()=>{
 const job=BackupExportViewSchema.parse({kind:'backup-export',exportId:importId,backupId,revision:0,state:'queued',safeCode:null});const calls:string[]=[];
 const api=createBackupTransferClient(async(path)=>{calls.push(String(path));return new Response(JSON.stringify(job),{headers:{etag:backupExportEtag(job)}});},bootstrap);
 assert.deepEqual(await api.beginExport(BackupTransferStateSchema.shape.export.unwrap().parse({backupId,key}),new AbortController().signal),job);assert.deepEqual(await api.readExport(importId,new AbortController().signal),job);assert.deepEqual(calls,['/api/v1/backup-exports','/api/v1/backup-exports/'+importId]);
});
test('external restore uses registration identity despite colliding source backup ID, never recover',async()=>{
 const preview=ExternalForkPreviewSchema.parse({mode:'fork',externalRegistrationId:registrationId,backupId,operationId:importId,sourceRunId:runId,name:'Otra puesta',reason:'Origen externo',previewToken:key,expiresAt:10,manifestHash:registration.manifestHash,diffHash:'d'.repeat(64),differences:['Nueva memoria'],blockers:[]});
 const apply={kind:'apply',registrationId,key,manifestHash:registration.manifestHash,preview};const state=BackupTransferStateSchema.parse({external:apply});if(state.external?.kind!=='apply')throw new Error('Fixture');const storage=store();writeBackupTransferState(storage,state);assert.deepEqual(readBackupTransferState(storage),state);
 const job=ForkJobViewSchema.parse({kind:'fork-job',operationId:importId,targetRunId:key,source:{runId,commitIndex:7,worldRevision:2,worldSeq:1,snapshotHash:'c'.repeat(64),configurationRevision:0,configurationHash:'e'.repeat(64)},name:preview.name,reason:preview.reason,state:'staging',revision:0,createdAt:0,updatedAt:0,audioDerivation:{kind:'initial-ready-configuration',sourceConfigurationHash:'e'.repeat(64),effectiveHistory:'not-reconstructed',bindingState:'unbound'}});
 const calls:Array<{path:string;init:RequestInit|undefined}>=[];const api=createBackupTransferClient(async(path,init)=>{calls.push({path:String(path),init});return new Response(JSON.stringify(job),{headers:{etag:forkJobEtag(job)}});},bootstrap);await api.apply(state.external,new AbortController().signal);assert.equal(calls[0]?.path,'/api/v1/backup-registrations/'+registrationId+'/restore');assert.equal(new Headers(calls[0]?.init?.headers).get('If-Match'),backupRegistrationEtag(registration));assert.throws(()=>BackupTransferStateSchema.parse({external:{...apply,preview:{...preview,mode:'recover'}}}));
 const reg=createBackupTransferClient(async()=>new Response(JSON.stringify(registration),{headers:{etag:backupRegistrationEtag(registration)}}),bootstrap);assert.deepEqual(await reg.registration(registrationId,new AbortController().signal),registration);
});
