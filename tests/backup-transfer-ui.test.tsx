import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {BackupTransferPanel,BackupExportDownload,RegisteredBackupNotice,ImportTransferStatus} from '../src/web/BackupTransferPanel.tsx';
import {BackupExportViewSchema,BackupImportViewSchema,RegisteredBackupSchema} from '../src/domain/backup-transfer.ts';
const id='11111111-1111-4111-8111-111111111111';
test('transfer GUI states private contents and bounded archive/part limits without initiating transfer',()=>{
 const html=renderToStaticMarkup(<BackupTransferPanel initialBackupId={id}/>);assert.match(html,/memorias privadas, sesiones, rutas y datos internos/);assert.match(html,/No incluye credenciales/);assert.match(html,/1 GiB/);assert.match(html,/1 MiB/);assert.match(html,/checksums verifican integridad/);assert.doesNotMatch(html,/Descargar backup completo \(/);
});
test('ready export is a direct attachment link; no archive is assembled into a browser Blob',()=>{
 const job=BackupExportViewSchema.parse({kind:'backup-export',exportId:id,backupId:id,state:'succeeded',revision:2,safeCode:null,bytes:500,sha256:'a'.repeat(64),fileName:'obra.pbackup'});const html=renderToStaticMarkup(<BackupExportDownload job={job}/>);assert.ok(html.includes('/api/v1/backup-exports/'+id+'/download'));assert.match(html,/download=""/);assert.doesNotMatch(html,/blob:|data:/);
 const queued=BackupExportViewSchema.parse({kind:'backup-export',exportId:id,backupId:id,state:'queued',revision:0,safeCode:null});assert.equal(renderToStaticMarkup(<BackupExportDownload job={queued}/>),'');
});
test('external registration does not claim authenticity or host recovery and progress remains explicit',()=>{
 const registration=RegisteredBackupSchema.parse({kind:'registered-backup',registrationId:id,sourceBackupId:id,sourceLineageId:id,manifestHash:'a'.repeat(64),archiveSha256:'b'.repeat(64),bytes:100,provenance:'operator-upload-unverified-origin',sources:[]});const html=renderToStaticMarkup(<RegisteredBackupNotice registration={registration}/>);assert.match(html,/autenticidad del origen sin verificar/);assert.match(html,/memoria y sesiones Pi independientes/);assert.match(html,/no permite recuperar el host completo/);
 const uploading=BackupImportViewSchema.parse({kind:'backup-import',importId:id,fileName:'obra.pbackup',bytes:100,receivedBytes:50,revision:1,state:'uploading',safeCode:null});const progress=renderToStaticMarkup(<ImportTransferStatus job={uploading}/>);assert.match(progress,/<progress max="100" value="50"/);assert.doesNotMatch(progress,/registrada y validada/);
});
test('reload requires the file again and does not mutate an upload from its stored part',async()=>{
 const {writeBackupTransferState,BackupTransferStateSchema}=await import('../src/web/backup-transfer-client.ts');
 const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
 writeBackupTransferState(storage,BackupTransferStateSchema.parse({upload:{kind:'active',importId:id,file:{fileName:'obra.pbackup',bytes:100,prefixSha256:'a'.repeat(64)},pending:{kind:'part',key:id,importId:id,revision:1,offset:0,byteLength:100,sha256:'b'.repeat(64)}}}));
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{sessionStorage:storage}});
 try{const html=renderToStaticMarkup(<BackupTransferPanel/>);assert.match(html,/Tras recargar, elegí el mismo archivo/);assert.match(html,/disabled="">Repetir envío conservado y continuar/);assert.match(html,/Consultar importación/);assert.doesNotMatch(html,/registrada y validada/);}finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});

test('two registrations remain fenced to the unresolved external fork and require explicit release before another file',async()=>{
 const {selectTransferImport,transferRegistrationForIntent,canReleaseTransferUpload,releaseTransferUpload}=await import('../src/web/BackupTransferPanel.tsx');
 const {BackupTransferStateSchema}=await import('../src/web/backup-transfer-client.ts');
 const second='22222222-2222-4222-8222-222222222222';const third='33333333-3333-4333-8333-333333333333';
 const registration=(registrationId:string)=>RegisteredBackupSchema.parse({kind:'registered-backup',registrationId,sourceBackupId:id,sourceLineageId:id,manifestHash:'a'.repeat(64),archiveSha256:'b'.repeat(64),bytes:100,provenance:'operator-upload-unverified-origin',sources:[]});
 const firstRegistration=registration(id);const secondRegistration=registration(second);
 const uploaded=BackupImportViewSchema.parse({kind:'backup-import',importId:third,fileName:'segunda.pbackup',bytes:100,receivedBytes:100,revision:5,state:'registered',safeCode:null,registration:secondRegistration});
 const state=BackupTransferStateSchema.parse({upload:{kind:'active',importId:third,file:{fileName:'segunda.pbackup',bytes:100,prefixSha256:'b'.repeat(64)}},external:{kind:'preview',registrationId:id,key:id,selection:{mode:'fork',sourceRunId:third,name:'Primera representación',reason:'Operación conservada'}}});
 const saved=JSON.stringify(state);assert.equal(selectTransferImport(state,null,uploaded),uploaded);assert.equal(transferRegistrationForIntent(secondRegistration,state.external),null);assert.equal(transferRegistrationForIntent(firstRegistration,state.external),firstRegistration);assert.equal(canReleaseTransferUpload(state,uploaded),false);assert.throws(()=>releaseTransferUpload(state,uploaded),/resolución/);assert.equal(JSON.stringify(state),saved);
 // Explicitly releasing the external review allows the terminal upload to be released.
 const {external:previous,...releasedReview}=state;void previous;assert.equal(canReleaseTransferUpload(releasedReview,uploaded),true);assert.deepEqual(releaseTransferUpload(releasedReview,uploaded),{});
 const uncertain=BackupTransferStateSchema.parse({...releasedReview,upload:{...releasedReview.upload,pending:{kind:'finalize',importId:third,key:id,revision:4}}});assert.equal(canReleaseTransferUpload(uncertain,uploaded),false);assert.throws(()=>releaseTransferUpload(uncertain,uploaded),/resolución/);
 // A late response from the previous file cannot replace the current import.
 const old=BackupImportViewSchema.parse({...uploaded,importId:id,registration:firstRegistration});assert.equal(selectTransferImport(releasedReview,uploaded,old),uploaded);
 if(uploaded.state!=='registered')throw new Error('Fixture not registered');const {registration:registered,...baseImport}=uploaded;if(registered===undefined)throw new Error('Missing fixture registration');const older=BackupImportViewSchema.parse({...baseImport,state:'validating',revision:3});assert.equal(selectTransferImport(releasedReview,uploaded,older),uploaded);
});

test('a new or uncertain export cannot display an old attachment and late polls cannot replace the selected operation',async()=>{
 const {selectTransferExport,transferExportForSelection}=await import('../src/web/BackupTransferPanel.tsx');const {BackupTransferStateSchema}=await import('../src/web/backup-transfer-client.ts');
 const second='22222222-2222-4222-8222-222222222222';const third='33333333-3333-4333-8333-333333333333';
 const old=BackupExportViewSchema.parse({kind:'backup-export',exportId:id,backupId:id,state:'succeeded',revision:2,safeCode:null,bytes:500,sha256:'a'.repeat(64),fileName:'old.pbackup'});
 const pending=BackupTransferStateSchema.parse({export:{backupId:second,key:third}});assert.equal(transferExportForSelection(pending,old,second),null);assert.equal(selectTransferExport(pending,null,old),null);
 const current=BackupExportViewSchema.parse({...old,exportId:third,backupId:second,fileName:'new.pbackup'});const selected=BackupTransferStateSchema.parse({export:{backupId:second,key:third,exportId:third}});assert.equal(selectTransferExport(selected,null,current),current);assert.equal(selectTransferExport(selected,current,old),current);assert.equal(transferExportForSelection(selected,current,second),current);assert.equal(transferExportForSelection(selected,current,id),null);
});
