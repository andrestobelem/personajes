import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {loadCatalog,readDossier} from '../src/adapters/catalog.ts';
import {exchangeIntegrity} from '../src/adapters/exchange-integrity.ts';
import {openBackupService} from '../src/application/backup-service.ts';
import {openDossierExchange} from '../src/application/dossier-exchange.ts';
import {createExchangeRoutes} from '../src/server/exchange-routes.ts';
import type {OperatorRequest} from '../src/server/operator-extension.ts';
import {RestorePreviewSchema} from '../src/domain/backup.ts';
async function fixture(legacy=false){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'personajes-exchange-kinds-'))),journalPath=join(root,'world.sqlite');
 const db=new DatabaseSync(journalPath);db.exec('CREATE TABLE schema_version(version INTEGER);INSERT INTO schema_version VALUES(37);CREATE TABLE world_runs(run_id TEXT,commit_index INTEGER,world_revision INTEGER,last_seq INTEGER,snapshot_hash TEXT)');
 if(legacy)db.exec('CREATE TABLE exchange_http_operations(principal_id TEXT NOT NULL,operation_id TEXT NOT NULL,request_hash TEXT NOT NULL,response_json TEXT,PRIMARY KEY(principal_id,operation_id))');
 const catalog=await loadCatalog({repositoryRoot:process.cwd()});const dossier=await readDossier({catalog,characterId:'maxwell-smart'});
 const dossiers=openDossierExchange({journalPath,getDossier:()=>dossier});const backups=openBackupService({privateDataRoot:root,quiesce:{async acquire(){return {artifacts:[],release(){}};}}});
 return {root,journalPath,db,dossiers,backups,close(){backups.close();dossiers.close();db.close();rmSync(root,{recursive:true,force:true});}};
}
function write(path:string[],body:unknown,idempotencyKey=randomUUID()):Extract<OperatorRequest,{kind:'write'}>{return {kind:'write',method:'POST',path,body,query:new URLSearchParams(),principalId:'operator',mode:{kind:'observer'},ifMatch:null,ifNoneMatch:null,idempotencyKey};}
const exportBody={kind:'dossier',characterId:'maxwell-smart'};
const exportHash=createHash('sha256').update('{"body":{"characterId":"maxwell-smart","kind":"dossier"},"method":"POST","path":["exports"]}').digest('hex');
const cached={kind:'json',status:201,body:{synthetic:'cached export response'},headers:{}};
function seedLegacy(db:DatabaseSync,id=randomUUID()){
 db.prepare('INSERT INTO exchange_http_operations VALUES(?,?,?,?)').run('operator',id,exportHash,JSON.stringify(cached));return id;
}

test('legacy operation-kind migration verifies old sealed rows before transactional ALTER and reseal, preserving valid replay',async()=>{
 const f=await fixture(true);const id=seedLegacy(f.db);const integrity=exchangeIntegrity(f.db);integrity.migrate('exchange_http_operations');integrity.seal('exchange_http_operations','principal_id=? AND operation_id=?',['operator',id]);
 let routes:ReturnType<typeof createExchangeRoutes>|undefined;
 try{routes=createExchangeRoutes(f);const row=f.db.prepare('SELECT operation_kind FROM exchange_http_operations WHERE operation_id=?').get(id);assert.equal(row?.operation_kind,'unclassified');integrity.verify('exchange_http_operations','principal_id=? AND operation_id=?',['operator',id]);assert.deepEqual(await routes.handle(write(['exports'],exportBody,id)),cached);const before=f.db.prepare('SELECT * FROM exchange_http_operations').all();routes.close();routes=createExchangeRoutes(f);assert.deepEqual(f.db.prepare('SELECT * FROM exchange_http_operations').all(),before);}
 finally{routes?.close();f.close();}
});

for(const failure of ['corrupt','unsealed'] as const)test(`legacy operation-kind migration rejects ${failure} rows without schema changes or resealing valid neighbours`,async()=>{
 const f=await fixture(true);const good=seedLegacy(f.db),bad=seedLegacy(f.db);const integrity=exchangeIntegrity(f.db);integrity.migrate('exchange_http_operations');integrity.seal('exchange_http_operations','principal_id=? AND operation_id=?',['operator',good]);
 if(failure==='corrupt'){integrity.seal('exchange_http_operations','principal_id=? AND operation_id=?',['operator',bad]);f.db.prepare('UPDATE exchange_http_operations SET response_json=? WHERE operation_id=?').run('{"changed":true}',bad);}
 const before=f.db.prepare('SELECT * FROM exchange_http_operations ORDER BY operation_id').all();
 try{assert.throws(()=>createExchangeRoutes(f),/EXCHANGE_METADATA_TAMPERED/);assert.equal(f.db.prepare('PRAGMA table_info(exchange_http_operations)').all().some(row=>row.name==='operation_kind'),false);assert.deepEqual(f.db.prepare('SELECT * FROM exchange_http_operations ORDER BY operation_id').all(),before);integrity.verify('exchange_http_operations','principal_id=? AND operation_id=?',['operator',good]);}
 finally{f.close();}
});

test('new HTTP receipts classify only backup and restore operations, preserve kind/hash idempotency and route recovery receipts',async()=>{
 const f=await fixture();const backupId=randomUUID(),recoveryId=randomUUID();f.backups.setRestorePort({preview(){return {differences:[],blockers:[],targetFingerprint:'synthetic-target'};},async apply(){return {kind:'host-recovery',operationId:recoveryId,backupId,state:'queued',phase:'queued',revision:0,safeCode:null};}});
 const routes=createExchangeRoutes(f);
 try{
  const backup=write(['backups',backupId],{scope:{kind:'all'}});const created=await routes.handle({...backup,method:'PUT',ifNoneMatch:'*'});assert.ok(created.kind==='json');const revision=typeof created.body==='object'&&created.body!==null&&!Array.isArray(created.body)?created.body.revision:undefined;assert.equal(typeof revision,'number');
  const previewRequest=write(['backups',backupId,'restore-preview'],{mode:'recover'});const previewResponse=await routes.handle(previewRequest);assert.ok(previewResponse.kind==='json');const preview=RestorePreviewSchema.parse(previewResponse.body);
  const restoreRequest={...write(['backups',backupId,'restore'],{previewToken:preview.previewToken,confirmDiffHash:preview.diffHash}),ifMatch:`"backup:${backupId}:r${revision}"`};const restored=await routes.handle(restoreRequest);assert.ok(restored.kind==='json');assert.equal(restored.headers.Location,`/api/v1/host-recoveries/${recoveryId}`);assert.equal(restored.headers.ETag,`"host-recovery:${recoveryId}:r0"`);
  const exported=write(['exports'],exportBody);assert.equal((await routes.handle(exported)).kind,'json');
  for(const [request,expected] of [[backup,'backup-create'],[previewRequest,'restore-preview'],[restoreRequest,'restore'],[exported,'unclassified']] as const){assert.equal(f.db.prepare('SELECT operation_kind FROM exchange_http_operations WHERE operation_id=?').get(request.idempotencyKey)?.operation_kind,expected);exchangeIntegrity(f.db).verify('exchange_http_operations','principal_id=? AND operation_id=?',['operator',request.idempotencyKey]);}
  assert.deepEqual(await routes.handle(previewRequest),previewResponse);f.db.prepare('UPDATE exchange_http_operations SET operation_kind=? WHERE operation_id=?').run('restore',previewRequest.idempotencyKey);const tampered=await routes.handle(previewRequest);assert.ok(tampered.kind==='problem');assert.equal(tampered.error.code,'EXCHANGE_METADATA_TAMPERED');exchangeIntegrity(f.db).seal('exchange_http_operations','principal_id=? AND operation_id=?',['operator',previewRequest.idempotencyKey]);const mismatched=await routes.handle(previewRequest);assert.ok(mismatched.kind==='problem');assert.equal(mismatched.error.code,'EXCHANGE_IDEMPOTENCY_REUSE');
  const changed=await routes.handle({...exported,body:{...exportBody,characterId:'agent-99'}});assert.ok(changed.kind==='problem');assert.equal(changed.error.code,'EXCHANGE_IDEMPOTENCY_REUSE');
 }finally{routes.close();f.close();}
});

test('legacy receipts without any integrity column fail closed and transactional migration rolls back both added columns',async()=>{
 const f=await fixture(true);seedLegacy(f.db);const columns=f.db.prepare('PRAGMA table_info(exchange_http_operations)').all();const rows=f.db.prepare('SELECT * FROM exchange_http_operations').all();try{assert.throws(()=>createExchangeRoutes(f),/EXCHANGE_METADATA_TAMPERED/);assert.deepEqual(f.db.prepare('PRAGMA table_info(exchange_http_operations)').all(),columns);assert.deepEqual(f.db.prepare('SELECT * FROM exchange_http_operations').all(),rows);}finally{f.close();}
});


for(const operation of ['backup-create','restore-preview','restore'] as const)test(`legacy cached ${operation} replays after migration without discarding its conservative classification`,async()=>{
 const f=await fixture(true);const id=randomUUID(),backupId=randomUUID();const request=operation==='backup-create'?{...write(['backups',backupId],{scope:{kind:'all'}},id),method:'PUT' as const,ifNoneMatch:'*'}:operation==='restore-preview'?write(['backups',backupId,'restore-preview'],{mode:'recover'},id):write(['backups',backupId,'restore'],{previewToken:randomUUID(),confirmDiffHash:'a'.repeat(64)},id);
 function canonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value!==null&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}';return JSON.stringify(value);}
 const hash=createHash('sha256').update(canonical({method:request.method,path:request.path,body:request.body})).digest('hex');
 f.db.prepare('INSERT INTO exchange_http_operations VALUES(?,?,?,?)').run('operator',id,hash,JSON.stringify(cached));const integrity=exchangeIntegrity(f.db);integrity.migrate('exchange_http_operations');integrity.seal('exchange_http_operations','principal_id=? AND operation_id=?',['operator',id]);const routes=createExchangeRoutes(f);
 try{const before=f.db.prepare('SELECT * FROM exchange_http_operations WHERE operation_id=?').get(id);assert.deepEqual(await routes.handle(request),cached);assert.deepEqual(f.db.prepare('SELECT * FROM exchange_http_operations WHERE operation_id=?').get(id),before);assert.equal(before?.operation_kind,'unclassified');const changed=await routes.handle({...request,body:{changed:true}});assert.ok(changed.kind==='problem');assert.equal(changed.error.code,'EXCHANGE_IDEMPOTENCY_REUSE');f.db.prepare('UPDATE exchange_http_operations SET response_json=NULL WHERE operation_id=?').run(id);integrity.seal('exchange_http_operations','principal_id=? AND operation_id=?',['operator',id]);const interrupted=await routes.handle(request);assert.ok(interrupted.kind==='problem');assert.equal(interrupted.error.code,'EXCHANGE_IDEMPOTENCY_REUSE');}
 finally{routes.close();f.close();}
});
