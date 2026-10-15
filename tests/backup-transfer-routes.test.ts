import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream,mkdtempSync,openSync,closeSync,writeSync,rmSync} from 'node:fs';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {test,type TestContext} from 'node:test';
import {loadCatalog} from '../src/adapters/catalog.ts';
import {createHostRequestBarrier} from '../src/application/host-request-barrier.ts';
import {createLocalHttpServer} from '../src/server/http.ts';
import {OperatorResponseSchema,type OperatorExtension} from '../src/server/operator-extension.ts';
import {SessionCreatedSchema} from '../src/domain/http.ts';

function deferred(){let resolve=()=>{};const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
async function setup(t:TestContext,extension:OperatorExtension,barrier=createHostRequestBarrier()){
 const server=createLocalHttpServer({catalog:await loadCatalog({repositoryRoot:process.cwd()}),shellHtml:'<html><head></head><body></body></html>',operatorExtensions:[extension],admissionBarrier:barrier});const {origin}=await server.listen();t.after(()=>server.close());
 const security={Origin:origin,'Content-Type':'application/json'};const page=await fetch(origin+'/',{headers:security});const bootNonce=(await page.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(bootNonce);
 const response=await fetch(origin+'/api/v1/session',{method:'POST',headers:security,body:JSON.stringify({bootNonce})});const session=SessionCreatedSchema.parse(await response.json());const cookie=response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
 return {server,origin,barrier,headers:{...security,Cookie:cookie,'X-CSRF-Token':session.csrfToken}};
}
function streamResponse(stream:Readable,bytesLength:number,sha256:string){return OperatorResponseSchema.parse({kind:'stream',status:200,mimeType:'application/octet-stream',bytesLength,sha256,filename:'host.backup',stream});}


test('HTTP streams an attachment larger than 32 MiB with bounded chunks, verified hash and length',async(t)=>{
 const directory=mkdtempSync(join(tmpdir(),'personajes-transfer-stream-'));const path=join(directory,'archive.bin');const size=33*1024*1024+17;const fd=openSync(path,'wx',0o600);const chunk=Buffer.alloc(64*1024,7);const hash=createHash('sha256');
 try{for(let offset=0;offset<size;){const bytes=chunk.subarray(0,Math.min(chunk.length,size-offset));writeSync(fd,bytes);hash.update(bytes);offset+=bytes.length;}}finally{closeSync(fd);}
 const expected=hash.digest('hex');let source:ReturnType<typeof createReadStream>|undefined;
 const f=await setup(t,{name:'stream-boundary-test',matches:({path})=>path[0]==='download',handle(){source=createReadStream(path,{highWaterMark:64*1024});return streamResponse(source,size,expected);}});
 try{
  assert.equal((await fetch(f.origin+'/api/v1/download')).status,401);
  const response=await fetch(f.origin+'/api/v1/download',{headers:f.headers});assert.equal(response.status,200);assert.equal(response.headers.get('content-length'),String(size));assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.equal(response.headers.get('content-disposition'),'attachment; filename="host.backup"');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.ok(response.body);const receivedHash=createHash('sha256');let received=0;for await(const bytes of response.body){received+=bytes.byteLength;receivedHash.update(bytes);}assert.equal(received,size);assert.equal(receivedHash.digest('hex'),expected);assert.ok(source);if(!source.closed)await once(source,'close');assert.equal(source.closed,true);
 }finally{source?.destroy();rmSync(directory,{recursive:true,force:true});}
});

for(const failure of ['hash','length'] as const)test(`HTTP destroys a stream with invalid ${failure} before it can complete Content-Length`,async(t)=>{
 const bytes=Buffer.alloc(128*1024,9);const expected=createHash('sha256').update(bytes).digest('hex');let source:Readable|undefined;
 const f=await setup(t,{name:'invalid-stream-test',matches:({path})=>path[0]==='download',handle(){source=Readable.from([bytes.subarray(0,65536),bytes.subarray(65536)]);return streamResponse(source,failure==='length'?bytes.length+1:bytes.length,failure==='hash'?'0'.repeat(64):expected);}});
 await assert.rejects(async()=>{const response=await fetch(f.origin+'/api/v1/download',{headers:f.headers});await response.arrayBuffer();});assert.equal(source?.destroyed,true);
});

test('recovery admission waits for the entire export pipeline, not merely its response descriptor',async(t)=>{
 const barrier=createHostRequestBarrier();const entered=deferred();const finish=deferred();const bytes=Buffer.alloc(128*1024,5);const hash=createHash('sha256').update(bytes).digest('hex');
 const f=await setup(t,{name:'drained-stream-test',matches:({path})=>path[0]==='download',handle(){const source=Readable.from((async function*(){entered.resolve();yield bytes.subarray(0,65536);await finish.promise;yield bytes.subarray(65536);})());return streamResponse(source,bytes.length,hash);}},barrier);
 const download=fetch(f.origin+'/api/v1/download',{headers:f.headers});await entered.promise;let drained=false;const recovery=barrier.acquireRecovery().then(release=>{drained=true;return release;});
 try{await Promise.resolve();assert.equal(drained,false);assert.equal(barrier.isRecovering,true);finish.resolve();const response=await download;assert.equal((await response.arrayBuffer()).byteLength,bytes.length);const release=await recovery;assert.equal(drained,true);release();}
 finally{finish.resolve();}
});

test('a disconnected download destroys its readable and releases HTTP admission',async(t)=>{
 const directory=mkdtempSync(join(tmpdir(),'personajes-transfer-abort-'));const path=join(directory,'archive.bin');const chunk=Buffer.alloc(64*1024,3);const fd=openSync(path,'wx',0o600);const hash=createHash('sha256');const size=48*1024*1024;
 try{for(let offset=0;offset<size;offset+=chunk.length){writeSync(fd,chunk);hash.update(chunk);}}finally{closeSync(fd);}
 const sha256=hash.digest('hex');let source:ReturnType<typeof createReadStream>|undefined;const f=await setup(t,{name:'abort-stream-test',matches:({path})=>path[0]==='download',handle(){source=createReadStream(path,{highWaterMark:64*1024});return streamResponse(source,size,sha256);}});
 try{const response=await fetch(f.origin+'/api/v1/download',{headers:f.headers});assert.ok(response.body);await response.body.cancel();assert.ok(source);const closingSource=source;if(!closingSource.closed)await new Promise<void>(done=>closingSource.once('close',done));assert.equal(source.closed,true);const release=await f.barrier.acquireRecovery();release();assert.equal(f.barrier.activeRequests,0);}
 finally{source?.destroy();rmSync(directory,{recursive:true,force:true});}
});

test('real backup transfer HTTP preserves operator ownership, bounded parts, stale-header replay and registered metadata',async(t)=>{
 const {openLocalHost}=await import('../src/application/local-host.ts');const {openBackupService}=await import('../src/application/backup-service.ts');const {openBackupTransferService}=await import('../src/application/backup-transfer-service.ts');const {createBackupTransferRoutes}=await import('../src/server/backup-transfer-routes.ts');const {ApprovedJournalSchemaSchema}=await import('../src/application/external-backup-validation.ts');const {DatabaseSync}=await import('node:sqlite');const {randomUUID}=await import('node:crypto');const {BackupImportViewSchema,BackupExportViewSchema,RegisteredBackupSchema}=await import('../src/domain/backup-transfer.ts');
 const directory=mkdtempSync(join(tmpdir(),'personajes-transfer-http-'));const root=join(directory,'host');const host=openLocalHost({privateDataRoot:root});const backup=openBackupService({privateDataRoot:host.privateDataRoot,quiesce:{async acquire(){return {artifacts:[],release(){}};}}});
 const backupId=randomUUID();assert.equal((await backup.create({backupId,scope:{kind:'all'}})).state,'succeeded');
 const service=openBackupTransferService({privateDataRoot:host.privateDataRoot,ownerToken:host.ownerToken,readLocalBackup:id=>backup.verify(id),readApprovedJournalSchema(){const db=new DatabaseSync(join(host.privateDataRoot,'world.sqlite'),{readOnly:true});try{return ApprovedJournalSchemaSchema.parse(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all());}finally{db.close();}}});
 let exposed:typeof service|undefined=service;const f=await setup(t,createBackupTransferRoutes({service:()=>exposed}));
 t.after(async()=>{await f.server.close();await service.close();backup.close();host.close();rmSync(directory,{recursive:true,force:true});});
 const send=(path:string,body:unknown,key:string=randomUUID(),etag?:string,method='POST',extra:Record<string,string>={})=>fetch(f.origin+'/api/v1/'+path,{method,headers:{...f.headers,'Idempotency-Key':key,...(etag===undefined?{}:{'If-Match':etag}),...extra},body:JSON.stringify(body)});
 assert.equal((await send('backup-imports',{fileName:'host.pba',bytes:4},randomUUID(),undefined,'POST',{'X-CSRF-Token':'wrong'})).status,403);
 assert.equal((await send('backup-imports',{fileName:'host.pba',bytes:4,principalId:'forged'})).status,422);
 const foreign=await service.beginImport({principalId:'another-operator',idempotencyKey:randomUUID(),fileName:'foreign.pba',bytes:4});assert.equal((await fetch(f.origin+`/api/v1/backup-imports/${foreign.importId}`,{headers:f.headers})).status,404);
 const exportResponse=await send('backup-exports',{backupId});assert.equal(exportResponse.status,202,await exportResponse.clone().text());const queued=BackupExportViewSchema.parse(await exportResponse.json());await service.waitForIdle();
 const exportRead=await fetch(f.origin+`/api/v1/backup-exports/${queued.exportId}`,{headers:f.headers});assert.equal(exportRead.status,200);const exported=BackupExportViewSchema.parse(await exportRead.json());assert.equal(exported.state,'succeeded');assert.equal(exportRead.headers.get('etag'),`"backup-export:${exported.exportId}:r${exported.revision}"`);
 const archiveResponse=await fetch(f.origin+`/api/v1/backup-exports/${queued.exportId}/download`,{headers:f.headers});assert.equal(archiveResponse.status,200);const archive=Buffer.from(await archiveResponse.arrayBuffer());assert.equal(exported.state==='succeeded'?exported.sha256:'',createHash('sha256').update(archive).digest('hex'));
 const foreignExport=await service.createExport({principalId:'another-operator',idempotencyKey:randomUUID(),backupId});assert.equal((await fetch(f.origin+`/api/v1/backup-exports/${foreignExport.exportId}/download`,{headers:f.headers})).status,404);
 const begin=await send('backup-imports',{fileName:'host.pba',bytes:archive.length});assert.equal(begin.status,201);let imported=BackupImportViewSchema.parse(await begin.json());let etag=begin.headers.get('etag');assert.ok(etag);const importId=imported.importId;
 assert.equal((await fetch(f.origin+`/api/v1/backup-imports/${importId}`)).status,401);
 const oversized=Buffer.alloc(1024*1024+4).toString('base64');const oversizedResponse=await send(`backup-imports/${importId}/parts`,{offset:0,contentBase64:oversized,sha256:'0'.repeat(64)},randomUUID(),etag,'PUT');assert.ok([413,422].includes(oversizedResponse.status));
 assert.equal((await send(`backup-imports/${importId}/parts`,{offset:0,contentBase64:'AAAA',sha256:'0'.repeat(64)},randomUUID(),etag,'PUT')).status,409);
 let firstPart:undefined|{body:{offset:number;contentBase64:string;sha256:string};key:string;etag:string;view:typeof imported};
 for(let offset=0;offset<archive.length;offset+=1024*1024){const bytes=archive.subarray(offset,Math.min(archive.length,offset+1024*1024));const body={offset,contentBase64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};const key=randomUUID();const previousEtag=etag;const response=await send(`backup-imports/${importId}/parts`,body,key,etag,'PUT');assert.equal(response.status,200,await response.clone().text());imported=BackupImportViewSchema.parse(await response.json());etag=response.headers.get('etag');assert.ok(etag);if(firstPart===undefined)firstPart={body,key,etag:previousEtag,view:imported};}
 assert.ok(firstPart);const replay=await send(`backup-imports/${importId}/parts`,firstPart.body,firstPart.key,firstPart.etag,'PUT');assert.equal(replay.status,200);assert.deepEqual(await replay.json(),firstPart.view);
 const stale=await send(`backup-imports/${importId}/parts`,firstPart.body,randomUUID(),firstPart.etag,'PUT');assert.equal(stale.status,412);
 const finalized=await send(`backup-imports/${importId}/finalize`,{},randomUUID(),etag);assert.equal(finalized.status,202,await finalized.clone().text());await service.waitForIdle();
 const registeredResponse=await fetch(f.origin+`/api/v1/backup-imports/${importId}`,{headers:f.headers});assert.equal(registeredResponse.status,200);const registered=BackupImportViewSchema.parse(await registeredResponse.json());assert.equal(registered.state,'registered',JSON.stringify(registered));assert.ok(registered.state==='registered');
 const metadataResponse=await fetch(f.origin+`/api/v1/backup-registrations/${registered.registration.registrationId}`,{headers:f.headers});assert.equal(metadataResponse.status,200);const metadata=RegisteredBackupSchema.parse(await metadataResponse.json());assert.equal(metadata.provenance,'operator-upload-unverified-origin');assert.equal('bundleRoot' in metadata,false);assert.equal('path' in metadata,false);
 assert.equal((await fetch(f.origin+`/api/v1/backup-registrations/${randomUUID()}`,{headers:f.headers})).status,404);
 exposed=undefined;assert.equal((await fetch(f.origin+`/api/v1/backup-imports/${importId}`,{headers:f.headers})).status,503);exposed=service;
 const invalidBegin=await send('backup-imports',{fileName:'invalid.pba',bytes:4});let invalid=BackupImportViewSchema.parse(await invalidBegin.json());const content=Buffer.from('nope');const part=await send(`backup-imports/${invalid.importId}/parts`,{offset:0,contentBase64:content.toString('base64'),sha256:createHash('sha256').update(content).digest('hex')},randomUUID(),invalidBegin.headers.get('etag')??'','PUT');assert.equal(part.status,200);
 const invalidFinalize=await send(`backup-imports/${invalid.importId}/finalize`,{},randomUUID(),part.headers.get('etag')??'');assert.equal(invalidFinalize.status,202);await service.waitForIdle();invalid=service.getImport({principalId:'local-operator',importId:invalid.importId});assert.equal(invalid.state,'failed');
 const retry=await send(`backup-imports/${invalid.importId}/retry`,{},randomUUID(),`"backup-import:${invalid.importId}:r${invalid.revision}"`);assert.equal(retry.status,202);await service.waitForIdle();invalid=service.getImport({principalId:'local-operator',importId:invalid.importId});assert.equal(invalid.state,'failed');
 const cancelled=await send(`backup-imports/${invalid.importId}`,{},randomUUID(),`"backup-import:${invalid.importId}:r${invalid.revision}"`,'DELETE');assert.equal(cancelled.status,200);assert.equal(BackupImportViewSchema.parse(await cancelled.json()).state,'cancelled');
});
