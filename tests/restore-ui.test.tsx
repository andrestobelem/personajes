import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { BackupRestorePanel, RestoreDiff } from '../src/web/BackupRestorePanel.tsx';
import { ForkRestorePreviewSchema } from '../src/web/backup-client.ts';
const id = '11111111-1111-4111-8111-111111111111';
test('restore entry is functional and offers coherent recovery without claiming an automatic publication', () => {
 const html = renderToStaticMarkup(<BackupRestorePanel />);
 assert.match(html, /Crear backup de todas las representaciones/); assert.match(html, /Consultar backup guardado/); assert.match(html, /cierre y reapertura administrados/); assert.doesNotMatch(html, /Confirmar restauración|Bifurcación preparada y publicada/);
});
test('restore diff presents saved evidence and explicit blockers without inventing a completed operation', () => {
 const preview = ForkRestorePreviewSchema.parse({ backupId: id, operationId: id, sourceRunId: id, name: 'Ensayo', reason: 'Otra perspectiva', mode: 'fork', previewToken: id, expiresAt: 100, manifestHash: 'a'.repeat(64), diffHash: 'b'.repeat(64), differences: ['Memoria aislada desde commit 4'], blockers: ['RESTORE_SOURCE_NOT_AVAILABLE'] });
 const html = renderToStaticMarkup(<RestoreDiff preview={preview} />); assert.match(html, /Memoria aislada desde commit 4/); assert.match(html, /RESTORE_SOURCE_NOT_AVAILABLE/); assert.match(html, /No inicia actores ni genera audio/); assert.doesNotMatch(html, /publicada/);
});
test('host recovery rendering distinguishes every operational phase and success requires final verification',async()=>{
 const {HostRecoveryStatus}=await import('../src/web/BackupRestorePanel.tsx');
 const {HostRecoveryJobSchema}=await import('../src/domain/host-recovery.ts');
 for(const phase of ['queued','staging','closing','original-preserved','installed','reopening','verified']) {
   const job=HostRecoveryJobSchema.parse({kind:'host-recovery',operationId:id,backupId:id,state:phase==='verified'?'succeeded':'running',phase,revision:1,safeCode:null});
   const html=renderToStaticMarkup(<HostRecoveryStatus job={job}/>);
   assert.equal(html.includes('Host recuperado y verificado'),phase==='verified');assert.doesNotMatch(html,/Reintentar/);
 }
 const failed=HostRecoveryJobSchema.parse({kind:'host-recovery',operationId:id,backupId:id,state:'failed',phase:'reopening',revision:2,safeCode:'RECOVERY_FAILED'});
 assert.match(renderToStaticMarkup(<HostRecoveryStatus job={failed}/>),/requiere revisión/);
});
test('a reloaded recovery renders from its saved intent without a catalog or issuing network writes',async()=>{
 const {captureBackupIntent,writeStoredBackupIntent,RecoveryPreviewSchema}=await import('../src/web/backup-client.ts');
 const preview=RecoveryPreviewSchema.parse({backupId:id,operationId:id,mode:'recover',previewToken:id,expiresAt:100,manifestHash:'a'.repeat(64),diffHash:'b'.repeat(64),differences:['Conservar originales y recuperar el conjunto'],blockers:[]});
 const intent=captureBackupIntent({kind:'recover',backupId:id,key:id,backupRevision:1,preview});
 const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
 writeStoredBackupIntent(storage,intent);
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{sessionStorage:storage}});
 try {const html=renderToStaticMarkup(<BackupRestorePanel recoveryOnly/>);assert.match(html,/Consultar recuperación del host/);assert.match(html,/Repetir mismo envío confirmado/);assert.match(html,/Conservar originales y recuperar el conjunto/);assert.doesNotMatch(html,/Crear backup de todas/);}finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});
test('resume remains explicit for an unfinished host recovery and is absent after verified success',async()=>{
 const {HostRecoveryStatus}=await import('../src/web/BackupRestorePanel.tsx');const {HostRecoveryJobSchema}=await import('../src/domain/host-recovery.ts');
 for(const state of ['queued','running','failed','interrupted','succeeded']) {
   const job=HostRecoveryJobSchema.parse({kind:'host-recovery',operationId:id,backupId:id,state,phase:state==='succeeded'?'verified':'staging',revision:2,safeCode:null});
   const html=renderToStaticMarkup(<HostRecoveryStatus job={job} onResume={()=>{}}/>);
   assert.equal(html.includes('Reanudar'),state!=='succeeded');
   assert.equal(html.includes('Reanudar si se interrumpió'),state==='queued'||state==='running');
 }
});
test('a detected directory lock changes the explicit resume action without declaring it stale',async()=>{
 const {HostRecoveryStatus}=await import('../src/web/BackupRestorePanel.tsx');const {HostRecoveryJobSchema}=await import('../src/domain/host-recovery.ts');
 const job=HostRecoveryJobSchema.parse({kind:'host-recovery',operationId:id,backupId:id,state:'running',phase:'closing',revision:2,safeCode:null});
 const html=renderToStaticMarkup(<HostRecoveryStatus job={job} hasPreviousLock onResume={()=>{}}/>);assert.match(html,/Reanudar y revisar bloqueo anterior/);assert.doesNotMatch(html,/PID ausente|bloqueo obsoleto|recuperado y verificado/);
});
test('aborted recovery shows original retained, never success or resume',async()=>{
 const {HostRecoveryStatus}=await import('../src/web/BackupRestorePanel.tsx');const {HostRecoveryJobSchema}=await import('../src/domain/host-recovery.ts');
 const job=HostRecoveryJobSchema.parse({kind:'host-recovery',operationId:id,backupId:id,state:'aborted',phase:'original-retained',revision:9,safeCode:'RESTORE_TARGET_DIVERGED'});
 const html=renderToStaticMarkup(<HostRecoveryStatus job={job} onResume={()=>{}}/>);assert.match(html,/Recuperación cancelada; se conservó el host original/);assert.match(html,/RESTORE_TARGET_DIVERGED/);assert.doesNotMatch(html,/Host recuperado y verificado|Reanudar/);
});
