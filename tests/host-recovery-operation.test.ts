import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { acquireHostOwnership, isHostOwnershipFailure, type HostDirectoryOperation } from '../src/adapters/host-ownership.ts';
import { createHostRecoveryOperation, type HostRecoveryFailpoint } from '../src/application/host-recovery-operation.ts';
import { BackupManifestSchema } from '../src/domain/backup.ts';

const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
async function fixture(){
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'personajes-host-recovery-')));const root=join(directory,'private');mkdirSync(root,{mode:0o700});
 let ownership:ReturnType<typeof acquireHostOwnership>|undefined=acquireHostOwnership({privateDataRoot:root});
 let db:DatabaseSync|undefined=new DatabaseSync(join(root,'world.sqlite'));db.exec("CREATE TABLE state(lineage TEXT,budget INTEGER,leaf TEXT);INSERT INTO state VALUES('same-lineage',17,'accepted-leaf');");
 const backupId=randomUUID();const bundleRoot=join(root,'backups',backupId);mkdirSync(bundleRoot,{recursive:true,mode:0o700});await backup(db,join(bundleRoot,'world.sqlite'));
 const bytes=readFileSync(join(bundleRoot,'world.sqlite'));const manifest=BackupManifestSchema.parse({format:'personajes-backup',version:1,backupId,lineageId:randomUUID(),createdAt:0,journalVersion:39,originRootHash:hash(root),fences:[],files:[{path:'world.sqlite',bytes:bytes.length,sha256:hash(bytes)}]});
 const manifestBytes=JSON.stringify(manifest);writeFileSync(join(bundleRoot,'manifest.json'),manifestBytes,{mode:0o600});
 writeFileSync(join(root,'administration.json'),'Preservar ledger administrativo posterior.',{mode:0o600});
 mkdirSync(join(root,'backups','newer-backup'),{mode:0o700});writeFileSync(join(root,'backups','newer-backup','keep.txt'),'Conservar backup posterior.');
 const request={operationId:randomUUID(),principalId:'recovery-test',backupId,manifest,manifestHash:hash(manifestBytes),targetFingerprint:'a'.repeat(64),confirmDiffHash:'b'.repeat(64),bundleRoot};
 const lookup={operationId:request.operationId,principalId:request.principalId};
 const events:string[]=[];let fault:HostRecoveryFailpoint|undefined;let interrupted=false;let failClose=false;let failReopen=false;let failVerify=false;let allowOriginalReopen=false;let failOriginalReopen=false;let failClosedVerify=false;let failStagedVerify=false;
 const preservedRoot=join(directory,`.private.recovery-${request.operationId}.original`);const stageRoot=join(directory,`.private.recovery-${request.operationId}.stage`);
 function validateSqlite(path:string){const opened=new DatabaseSync(join(path,'world.sqlite'),{readOnly:true});try{assert.equal(opened.prepare('PRAGMA quick_check').get()?.quick_check,'ok');assert.deepEqual({...opened.prepare('SELECT * FROM state').get()},{lineage:'same-lineage',budget:17,leaf:'accepted-leaf'});}finally{opened.close();}}
 async function close(gate:HostDirectoryOperation){events.push('close');if(failClose)throw new Error('RECOVERY_CLOSE_FAILED');db?.close();db=undefined;ownership?.release({directoryOperation:gate});ownership=undefined;}
 const build=()=>createHostRecoveryOperation({privateDataRoot:root,
  close:async({gate,intent})=>{assert.equal(intent.targetFingerprint,request.targetFingerprint);await close(gate);},
  prepare:async context=>{events.push('prepare');assert.equal(db,undefined,'old writer closed before preparation');assert.equal(context.intent.manifestHash,request.manifestHash);assert.equal(context.originalRoot,root);cpSync(join(root,'backups'),join(context.stageRoot,'backups'),{recursive:true,errorOnExist:true,force:false});cpSync(join(root,'administration.json'),join(context.stageRoot,'administration.json'),{errorOnExist:true,force:false});},
  reopen:async({gate,intent})=>{events.push('reopen');assert.equal(intent.operationId,request.operationId);if(failReopen)throw new Error('RECOVERY_REOPEN_FAILED');ownership=acquireHostOwnership({privateDataRoot:root,directoryOperation:gate});db=new DatabaseSync(join(root,'world.sqlite'));},
  ...(allowOriginalReopen?{reopenOriginal:async({gate}:{gate:HostDirectoryOperation})=>{events.push('reopenOriginal');if(failOriginalReopen)throw new Error('RECOVERY_ORIGINAL_REOPEN_FAILED');ownership=acquireHostOwnership({privateDataRoot:root,directoryOperation:gate});db=new DatabaseSync(join(root,'world.sqlite'));assert.equal(db.prepare('PRAGMA quick_check').get()?.quick_check,'ok');}}:{}),
  verify:async context=>{events.push(`verify:${context.phase}`);if(context.phase==='closed'&&failClosedVerify)throw new Error('RECOVERY_TARGET_CHANGED');validateSqlite(context.root);if(context.phase==='staged'&&failStagedVerify)throw new Error('RECOVERY_STAGE_INVALID');if(context.phase==='reopened'&&failVerify)throw new Error('RECOVERY_REOPEN_VERIFY_FAILED');},
  failpoint:async point=>{if(point==='afterOriginalRename'){
    assert.equal(existsSync(root),false);
    assert.throws(()=>acquireHostOwnership({privateDataRoot:root}),(error:unknown)=>isHostOwnershipFailure(error)&&error.code==='OPERATION_BUSY');
    assert.equal(existsSync(root),false,'competitor cannot recreate root while gate held');
   }
   if(point===fault&&!interrupted){interrupted=true;throw new Error('HOST_RECOVERY_INTERRUPTED');}
  },
 });
 let engine=build();
 return {directory,root,backupId,bundleRoot,request,lookup,events,preservedRoot,stageRoot,get engine(){return engine;},
  setFault(point:HostRecoveryFailpoint){fault=point;},setCloseFailure(value:boolean){failClose=value;},setReopenFailure(value:boolean){failReopen=value;},setVerifyFailure(value:boolean){failVerify=value;},
  enableOriginalReopen(){allowOriginalReopen=true;engine=build();},setOriginalReopenFailure(value:boolean){failOriginalReopen=value;},setClosedVerifyFailure(value:boolean){failClosedVerify=value;},setStagedVerifyFailure(value:boolean){failStagedVerify=value;},
  changeOriginalState(){assert.ok(db);db.exec("UPDATE state SET budget=16;CREATE TABLE history(note TEXT);INSERT INTO history VALUES('Hecho posterior al backup');");},
  rebuild(){engine=build();},validateSqlite,
  close(){try{db?.close();}finally{ownership?.release();rmSync(directory,{recursive:true,force:true});}},
 };
}

test('admisión durable no cierra el host; intercambio offline conserva original, backups y ledger administrativo',async()=>{
 const f=await fixture();try{
  const before=readFileSync(join(f.bundleRoot,'world.sqlite'));const queued=await f.engine.begin(f.request);assert.equal(queued.state,'queued');assert.deepEqual(f.events,[]);
  assert.deepEqual(await f.engine.begin(f.request),queued);assert.equal(f.engine.read({...f.lookup,principalId:'otro'}),undefined);
  const result=await f.engine.execute(f.lookup);assert.equal(result.state,'succeeded');assert.equal(result.phase,'verified');assert.equal(result.safeCode,null);
  f.validateSqlite(f.root);f.validateSqlite(f.preservedRoot);assert.equal(readFileSync(join(f.root,'administration.json'),'utf8'),'Preservar ledger administrativo posterior.');assert.equal(readFileSync(join(f.root,'backups','newer-backup','keep.txt'),'utf8'),'Conservar backup posterior.');
  assert.deepEqual(readFileSync(join(f.root,'backups',f.backupId,'world.sqlite')),before);assert.deepEqual(readdirSync(join(f.root,'backups',f.backupId)).sort(),['manifest.json','world.sqlite']);
  assert.deepEqual(f.events,['close','verify:closed','prepare','verify:staged','reopen','verify:reopened']);
  const count=f.events.length;f.rebuild();assert.deepEqual(f.engine.read(f.lookup),result);assert.deepEqual(await f.engine.execute(f.lookup),result);assert.equal(f.events.length,count);
  const publicValue=JSON.stringify(result);assert.equal(publicValue.includes(f.directory),false);assert.equal(publicValue.includes(f.lookup.principalId),false);assert.equal(publicValue.includes('targetFingerprint'),false);
 }finally{f.close();}
});

for(const point of ['afterClose','afterStaging','beforeOriginalRename','afterOriginalRename','afterOriginalPreserved','beforeInstallRename','afterInstallRename','afterInstalled','afterReopen','afterVerify'] as const)test(`reanuda la misma operación tras interrupción ${point}`,async()=>{
 const f=await fixture();try{
  await f.engine.begin(f.request);f.setFault(point);const interrupted=await f.engine.execute(f.lookup);assert.equal(interrupted.state,'interrupted');assert.equal(interrupted.safeCode,'HOST_RECOVERY_INTERRUPTED');
  f.rebuild();const result=await f.engine.execute(f.lookup);assert.equal(result.state,'succeeded');assert.equal(result.operationId,f.request.operationId);assert.ok(existsSync(f.preservedRoot));assert.equal(existsSync(f.stageRoot),false);f.validateSqlite(f.root);f.validateSqlite(f.preservedRoot);
 }finally{f.close();}
});

test('fallo de cierre no mueve ni reemplaza raíz; retry conserva el mismo ID',async()=>{
 const f=await fixture();try{
  await f.engine.begin(f.request);const before=readFileSync(join(f.root,'world.sqlite'));f.setCloseFailure(true);const failed=await f.engine.execute(f.lookup);assert.equal(failed.state,'failed');assert.equal(failed.safeCode,'RECOVERY_CLOSE_FAILED');assert.equal(existsSync(f.preservedRoot),false);assert.equal(existsSync(f.stageRoot),false);assert.deepEqual(readFileSync(join(f.root,'world.sqlite')),before);
  f.setCloseFailure(false);assert.equal((await f.engine.execute(f.lookup)).state,'succeeded');
 }finally{f.close();}
});

for(const phase of ['reopen','verify'] as const)test(`fallo de ${phase} conserva original y no declara éxito hasta reapertura verificada`,async()=>{
 const f=await fixture();try{
  await f.engine.begin(f.request);if(phase==='reopen')f.setReopenFailure(true);else f.setVerifyFailure(true);
  const failed=await f.engine.execute(f.lookup);assert.equal(failed.state,'failed');assert.equal(failed.phase,'reopening');assert.ok(existsSync(f.preservedRoot));assert.equal(f.engine.read(f.lookup)?.state,'failed');
  f.setReopenFailure(false);f.setVerifyFailure(false);assert.equal((await f.engine.execute(f.lookup)).state,'succeeded');
 }finally{f.close();}
});

test('raíces ambiguas tras primer rename se conservan sin adivinar ni borrar',async()=>{
 const f=await fixture();try{
  await f.engine.begin(f.request);f.setFault('afterOriginalRename');assert.equal((await f.engine.execute(f.lookup)).state,'interrupted');assert.equal(existsSync(f.root),false);
  mkdirSync(f.root,{mode:0o700});writeFileSync(join(f.root,'unknown.txt'),'No eliminar esta evidencia.');f.rebuild();const failed=await f.engine.execute(f.lookup);
  assert.equal(failed.state,'failed');assert.equal(failed.safeCode,'RECOVERY_PHASE_AMBIGUOUS');assert.equal(readFileSync(join(f.root,'unknown.txt'),'utf8'),'No eliminar esta evidencia.');assert.ok(existsSync(f.preservedRoot));assert.ok(existsSync(f.stageRoot));
 }finally{f.close();}
});

for(const unsafe of ['symlink','hardlink','tampered'] as const)test(`archivo de backup ${unsafe} bloquea antes del intercambio`,async()=>{
 const f=await fixture();try{
  await f.engine.begin(f.request);const target=join(f.bundleRoot,'world.sqlite');
  if(unsafe==='symlink'){rmSync(target);symlinkSync(join(f.root,'world.sqlite'),target);}
  if(unsafe==='hardlink'){rmSync(target);linkSync(join(f.root,'world.sqlite'),target);}
  if(unsafe==='tampered')writeFileSync(target,'No es la base autentificada.');
  const failed=await f.engine.execute(f.lookup);assert.equal(failed.state,'failed');assert.equal(existsSync(f.preservedRoot),false);f.validateSqlite(f.root);
 }finally{f.close();}
});

test('admisión rechaza otras raíces, traversal, cambios de identidad y operaciones competidoras',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.engine.begin({...f.request,bundleRoot:join(f.directory,'outside')}),/ADMISSION/);
  await assert.rejects(f.engine.begin({...f.request,manifest:{...f.request.manifest,originRootHash:'f'.repeat(64)}}),/ADMISSION/);
  await assert.rejects(f.engine.begin({...f.request,manifest:{...f.request.manifest,files:[{path:'../world.sqlite',bytes:1,sha256:'f'.repeat(64)}]}}),/BACKUP_PATH_NOT_ALLOWED/);
  await f.engine.begin(f.request);await assert.rejects(f.engine.begin({...f.request,targetFingerprint:'c'.repeat(64)}),/IDEMPOTENCY/);await assert.rejects(f.engine.begin({...f.request,operationId:randomUUID()}),/OTHER_OPERATION_PENDING/);
 }finally{f.close();}
});

test('no elimina un gate huérfano o activo automáticamente ni altera un control manipulado',async()=>{
 const f=await fixture();try{
  await f.engine.begin(f.request);const control=join(dirname(f.root),`.${basename(f.root)}.personajes-recovery`,`${f.request.operationId}.json`);const raw=readFileSync(control,'utf8');
  writeFileSync(control,raw.replace('"rootHash":"','"rootHash":"f'));assert.throws(()=>f.engine.read(f.lookup),/./);writeFileSync(control,raw);
  const gatePath=join(dirname(f.root),`.${basename(f.root)}.personajes-host-operation`);writeFileSync(gatePath,'Gate requiere revisión explícita.');
  await assert.rejects(f.engine.execute(f.lookup),(error:unknown)=>isHostOwnershipFailure(error)&&error.code==='OPERATION_BUSY');assert.equal(readFileSync(gatePath,'utf8'),'Gate requiere revisión explícita.');rmSync(gatePath);
 }finally{f.close();}
});

test('resume es admisión durable idempotente, conserva fase de intercambio y no ejecuta desde lectura',async()=>{
 const f=await fixture();try{
  await f.engine.begin(f.request);f.setFault('afterOriginalRename');const interrupted=await f.engine.execute(f.lookup);assert.equal(interrupted.state,'interrupted');assert.equal(existsSync(f.root),false);
  const events=f.events.length;const request={...f.lookup,idempotencyKey:randomUUID(),expectedRevision:interrupted.revision};
  const queued=await f.engine.resume(request);assert.equal(queued.state,'queued');assert.equal(queued.phase,interrupted.phase);assert.equal(queued.revision,interrupted.revision+1);assert.equal(f.events.length,events);assert.equal(existsSync(f.root),false);
  f.rebuild();assert.deepEqual(await f.engine.resume(request),queued);assert.deepEqual(f.engine.read(f.lookup),queued);assert.equal(f.events.length,events);
  const completed=await f.engine.execute(f.lookup);assert.equal(completed.state,'succeeded');assert.deepEqual(await f.engine.resume(request),queued,'replay conserva recibo original después del éxito');assert.deepEqual(f.engine.read(f.lookup),completed);
  await assert.rejects(f.engine.resume({...request,expectedRevision:interrupted.revision+1}),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(f.engine.resume({...f.lookup,idempotencyKey:randomUUID(),expectedRevision:completed.revision}),/ALREADY_VERIFIED/);
 }finally{f.close();}
});

test('resume bloquea CAS, principal y gate incorrectos sin efectos ni rescate implícito',async()=>{
 const f=await fixture();try{
  const queued=await f.engine.begin(f.request);const request={...f.lookup,idempotencyKey:randomUUID(),expectedRevision:queued.revision};
  await assert.rejects(f.engine.resume({...request,expectedRevision:queued.revision+1}),/REVISION_CONFLICT/);
  await assert.rejects(f.engine.resume({...request,principalId:'otro-operador'}),/OPERATION_NOT_FOUND/);assert.deepEqual(f.engine.read(f.lookup),queued);assert.deepEqual(f.events,[]);
  const gatePath=join(dirname(f.root),`.${basename(f.root)}.personajes-host-operation`);writeFileSync(gatePath,'Gate huérfano conservado.');
  await assert.rejects(f.engine.resume(request),(error:unknown)=>isHostOwnershipFailure(error)&&error.code==='OPERATION_BUSY');assert.equal(readFileSync(gatePath,'utf8'),'Gate huérfano conservado.');rmSync(gatePath);
  const admitted=await f.engine.resume(request);assert.equal(admitted.state,'queued');assert.equal(admitted.revision,queued.revision+1);assert.deepEqual(f.events,[]);
 }finally{f.close();}
});

test('perder respuesta de resume no pierde la admisión ni crea otra operación',async()=>{
 const f=await fixture();try{
  const queued=await f.engine.begin(f.request);f.setFault('afterResume');const request={...f.lookup,idempotencyKey:randomUUID(),expectedRevision:queued.revision};
  await assert.rejects(f.engine.resume(request),/HOST_RECOVERY_INTERRUPTED/);f.rebuild();const replay=await f.engine.resume(request);assert.equal(replay.state,'queued');assert.equal(replay.revision,queued.revision+1);assert.deepEqual(f.events,[]);
  assert.equal((await f.engine.execute(f.lookup)).state,'succeeded');
 }finally{f.close();}
});

test('list es lectura privada por principal, conserva terminales y falla cerrado ante registros desconocidos',async()=>{
 const f=await fixture();try{
  assert.deepEqual(f.engine.list({principalId:f.lookup.principalId}),[]);const queued=await f.engine.begin(f.request);
  assert.deepEqual(f.engine.list({principalId:f.lookup.principalId}),[queued]);assert.deepEqual(f.engine.list({principalId:'otro-operador'}),[]);assert.deepEqual(f.events,[]);
  const succeeded=await f.engine.execute(f.lookup);assert.deepEqual(f.engine.list({principalId:f.lookup.principalId}),[succeeded]);
  const control=join(dirname(f.root),`.${basename(f.root)}.personajes-recovery`);writeFileSync(join(control,'unknown.json'),'{}');assert.throws(()=>f.engine.list({principalId:f.lookup.principalId}),/CONTROL_INVALID/);
 }finally{f.close();}
});

test('resume liga nonce de rescate explícito al recibo y nunca lo usa para borrar el gate',async()=>{
 const f=await fixture();try{
  const initial=await f.engine.begin(f.request);const request={...f.lookup,idempotencyKey:randomUUID(),expectedRevision:initial.revision,expectedDirectoryOperationNonce:randomUUID()};
  const queued=await f.engine.resume(request);assert.deepEqual(await f.engine.resume(request),queued);
  await assert.rejects(f.engine.resume({...request,expectedDirectoryOperationNonce:randomUUID()}),/IDEMPOTENCY_CONFLICT/);
  const {expectedDirectoryOperationNonce,...missingNonce}=request;void expectedDirectoryOperationNonce;await assert.rejects(f.engine.resume(missingNonce),/IDEMPOTENCY_CONFLICT/);
  assert.deepEqual(f.engine.read(f.lookup),queued);assert.deepEqual(f.events,[]);
 }finally{f.close();}
});

test('divergencia antes del intercambio aborta y reabre el original con hechos posteriores intactos',async()=>{
 const f=await fixture();try{
  f.enableOriginalReopen();const admitted=await f.engine.begin(f.request);f.changeOriginalState();f.setClosedVerifyFailure(true);
  const aborted=await f.engine.execute(f.lookup);assert.equal(aborted.state,'aborted');assert.equal(aborted.phase,'original-retained');assert.equal(aborted.safeCode,'RECOVERY_TARGET_CHANGED');assert.ok(aborted.revision>admitted.revision);
  assert.equal(existsSync(f.preservedRoot),false);assert.equal(existsSync(f.stageRoot),false);assert.equal(existsSync(join(f.root,'host-ownership.json')),true);
  const reopened=new DatabaseSync(join(f.root,'world.sqlite'),{readOnly:true});try{assert.equal(reopened.prepare('SELECT budget FROM state').get()?.budget,16);assert.equal(reopened.prepare('SELECT note FROM history').get()?.note,'Hecho posterior al backup');}finally{reopened.close();}
  assert.deepEqual(f.events,['close','verify:closed','reopenOriginal']);const count=f.events.length;assert.deepEqual(await f.engine.execute(f.lookup),aborted);assert.equal(f.events.length,count);
  await assert.rejects(f.engine.resume({...f.lookup,idempotencyKey:randomUUID(),expectedRevision:aborted.revision}),/OPERATION_ABORTED/);
  const next=await f.engine.begin({...f.request,operationId:randomUUID(),targetFingerprint:'c'.repeat(64)});assert.equal(next.state,'queued');assert.deepEqual(f.engine.list({principalId:f.lookup.principalId}).map(job=>job.state).sort(),['aborted','queued']);
 }finally{f.close();}
});

test('error de preparación aborta sin borrar staging ni control forenses y reabre original',async()=>{
 const f=await fixture();try{
  f.enableOriginalReopen();await f.engine.begin(f.request);f.setStagedVerifyFailure(true);const aborted=await f.engine.execute(f.lookup);
  assert.equal(aborted.state,'aborted');assert.equal(aborted.safeCode,'RECOVERY_STAGE_INVALID');assert.ok(existsSync(f.stageRoot));assert.equal(existsSync(f.preservedRoot),false);f.validateSqlite(f.root);
  assert.deepEqual(f.engine.read(f.lookup),aborted);assert.ok(f.events.includes('reopenOriginal'));
 }finally{f.close();}
});

test('fallo al reabrir original mantiene failed offline y no declara aborto completado',async()=>{
 const f=await fixture();try{
  f.enableOriginalReopen();await f.engine.begin(f.request);f.setClosedVerifyFailure(true);f.setOriginalReopenFailure(true);const failed=await f.engine.execute(f.lookup);
  assert.equal(failed.state,'failed');assert.equal(failed.safeCode,'RECOVERY_TARGET_CHANGED');assert.equal(existsSync(f.preservedRoot),false);assert.equal(existsSync(join(f.root,'host-ownership.json')),false);
  f.setOriginalReopenFailure(false);const queued=await f.engine.resume({...f.lookup,idempotencyKey:randomUUID(),expectedRevision:failed.revision});assert.equal(queued.state,'queued');assert.equal((await f.engine.execute(f.lookup)).state,'aborted');
 }finally{f.close();}
});

test('no reabre original automáticamente si close no terminó o ya se instaló el reemplazo',async()=>{
 const before=await fixture();try{
  before.enableOriginalReopen();await before.engine.begin(before.request);before.setCloseFailure(true);assert.equal((await before.engine.execute(before.lookup)).state,'failed');assert.equal(before.events.includes('reopenOriginal'),false);
 }finally{before.close();}
 const after=await fixture();try{
  after.enableOriginalReopen();await after.engine.begin(after.request);after.setReopenFailure(true);assert.equal((await after.engine.execute(after.lookup)).state,'failed');assert.ok(existsSync(after.preservedRoot));assert.equal(after.events.includes('reopenOriginal'),false);
 }finally{after.close();}
});
