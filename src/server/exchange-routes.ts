import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { BackupSourcesSchema } from '../domain/backup-http.ts';
import { RestorePreviewSchema,RestoreSelectionSchema } from '../domain/backup.ts';
import { ForkJobViewSchema,forkJobEtag } from '../domain/fork-http.ts';
import { HashSchema } from '../domain/values.ts';
import { exchangeIntegrity } from '../adapters/exchange-integrity.ts';
import type { openBackupService } from '../application/backup-service.ts';
import type { openDossierExchange } from '../application/dossier-exchange.ts';
import { operatorJson, OperatorResponseSchema, type OperatorExtension, type OperatorRequest } from './operator-extension.ts';

/** Host composition must provide a backup service with an actual global quiesce port.
 * The adapter never invents that barrier, runs providers, or exposes bundleRoot. */
export function createExchangeRoutes(input:{journalPath:string;dossiers:ReturnType<typeof openDossierExchange>;backups:ReturnType<typeof openBackupService>}):OperatorExtension & {close():void}{
 const db=new DatabaseSync(input.journalPath);
 db.exec('CREATE TABLE IF NOT EXISTS exchange_http_operations(principal_id TEXT NOT NULL,operation_id TEXT NOT NULL,request_hash TEXT NOT NULL,response_json TEXT,PRIMARY KEY(principal_id,operation_id))');
 const integrity=exchangeIntegrity(db);integrity.migrate('exchange_http_operations');
 const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
 function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>JSON.stringify(key)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
 }
 const importEtag=(id:string,revision:number)=>`"import:${id}:r${revision}"`;
 const backupEtag=(id:string,revision:number)=>`"backup:${id}:r${revision}"`;
 async function dispatch(request:OperatorRequest){
  const [resource,id,action]=request.path;
  if(resource==='imports'){
   if(request.path.length===1&&request.kind==='write'&&request.method==='POST'){
    const result=input.dossiers.quarantine(request.principalId,request.idempotencyKey,request.body);
    return operatorJson(result,201,{ETag:importEtag(result.importId,result.revision),Location:`/api/v1/imports/${result.importId}`});
   }
   if(id&&request.path.length===2&&request.kind==='read'){
    const result=input.dossiers.get(request.principalId,id);return operatorJson(result,200,{ETag:importEtag(id,result.revision)});
   }
   if(id&&request.path.length===3&&request.kind==='write'&&request.method==='POST'){
    if(action==='preview'){z.strictObject({}).parse(request.body);return operatorJson(input.dossiers.preview(request.principalId,id));}
    if(action==='apply'){
     const current=input.dossiers.get(request.principalId,id);
     if(request.ifMatch!==importEtag(id,current.revision))throw new Error('EXCHANGE_IF_MATCH_REQUIRED');
     const body=z.strictObject({previewToken:z.uuid(),confirmDiffHash:z.string()}).parse(request.body);
     // Token ownership/import identity is checked by the durable service below.
     const result=input.dossiers.apply(request.principalId,{...body,importId:id});return operatorJson(result,201);
    }
   }
  }
  if(resource==='exports'){
   if(id&&request.path.length===2&&request.kind==='read'){
    const result=input.dossiers.download(request.principalId,id);return operatorJson({exportId:id,state:'succeeded',sha256:result.sha256,bytes:result.bytes.length,filename:result.filename});
   }
   if(request.path.length===1&&request.kind==='write'&&request.method==='POST'){
    const body=z.strictObject({kind:z.literal('dossier'),characterId:z.string()}).parse(request.body);
    const result=input.dossiers.exportArchive(request.principalId,request.idempotencyKey,body.characterId);return operatorJson(result,201,{Location:`/api/v1/exports/${result.exportId}`});
   }
   if(id&&request.path.length===3&&action==='download'&&request.kind==='read'){
    const result=input.dossiers.download(request.principalId,id);return OperatorResponseSchema.parse({kind:'binary',status:200,mimeType:'application/json',...result});
   }
  }
  if(resource==='backups'&&id){
   if(request.path.length===2&&request.kind==='write'&&request.method==='PUT'){
    if(request.ifNoneMatch!=='*')throw new Error('EXCHANGE_IF_NONE_MATCH_REQUIRED');
    const body=z.strictObject({scope:z.strictObject({kind:z.literal('all')})}).parse(request.body);
    const result=await input.backups.create({backupId:id,...body});return operatorJson(result,202,{ETag:backupEtag(id,result.revision),Location:`/api/v1/backups/${id}`});
   }
   if(request.path.length===2&&request.kind==='read'){
    const result=input.backups.get(id);return operatorJson(result,200,{ETag:backupEtag(id,result.revision)});
   }
   if(request.path.length===3&&request.kind==='read'&&action==='sources'){
    z.strictObject({}).parse(Object.fromEntries(request.query));
    const verified=input.backups.verify(id);
    return operatorJson(BackupSourcesSchema.parse({kind:'backup-sources',backupId:verified.manifest.backupId,sources:verified.manifest.fences.map(fence=>({runId:fence.runId,commitIndex:fence.commitIndex,worldRevision:fence.worldRevision,worldSeq:fence.lastSeq,snapshotHash:fence.snapshotHash}))}));
   }
   if(request.path.length===3&&request.kind==='write'&&request.method==='POST'){
    if(action==='restore-preview'){
     const body=RestoreSelectionSchema.parse(request.body);return operatorJson(RestorePreviewSchema.parse(input.backups.preview({backupId:id,principalId:request.principalId,idempotencyKey:request.idempotencyKey,...body})));
    }
    if(action==='restore'){
     const current=input.backups.get(id);if(request.ifMatch!==backupEtag(id,current.revision))throw new Error('EXCHANGE_IF_MATCH_REQUIRED');
     const body=z.strictObject({previewToken:z.uuid(),confirmDiffHash:HashSchema}).parse(request.body);
     const job=ForkJobViewSchema.parse(await input.backups.restore({...body,backupId:id,principalId:request.principalId}));
     return operatorJson(job,202,{ETag:forkJobEtag(job),Location:`/api/v1/forks/${job.operationId}`});
    }
   }
  }
  throw new Error('EXCHANGE_ROUTE_NOT_FOUND');
 }
 return {name:'exchange',maxBodyBytes:22*1024*1024,close:()=>db.close(),matches:({path})=>['imports','exports','backups'].includes(path[0]??''),async handle(request){
  try {
   if(request.kind==='read')return await dispatch(request);
   const requestHash=digest(canonical({method:request.method,path:request.path,body:request.body}));
   const previous=db.prepare('SELECT request_hash,response_json FROM exchange_http_operations WHERE principal_id=? AND operation_id=?').get(request.principalId,request.idempotencyKey);
   if(previous){
    integrity.verify('exchange_http_operations','principal_id=? AND operation_id=?',[request.principalId,request.idempotencyKey]);
    const old=z.strictObject({request_hash:z.string(),response_json:z.string().nullable()}).parse(previous);
    if(old.request_hash!==requestHash)throw new Error('EXCHANGE_IDEMPOTENCY_REUSE');
    if(old.response_json!==null)return OperatorResponseSchema.parse(JSON.parse(old.response_json));
    // Only restore operations have a sealed service intent/idempotent preview.
    // Other interrupted mutations retain their conservative explicit failure.
    const recoverable=request.method==='POST'&&request.path.length===3&&request.path[0]==='backups'&&['restore','restore-preview'].includes(request.path[2]??'');
    if(!recoverable)throw new Error('EXCHANGE_OPERATION_INTERRUPTED');
   }else{
    db.prepare('INSERT INTO exchange_http_operations(principal_id,operation_id,request_hash,response_json) VALUES(?,?,?,NULL)').run(request.principalId,request.idempotencyKey,requestHash);
    integrity.seal('exchange_http_operations','principal_id=? AND operation_id=?',[request.principalId,request.idempotencyKey]);
   }
   let result;
   try {result=await dispatch(request);}catch(error){
    db.prepare('DELETE FROM exchange_http_operations WHERE principal_id=? AND operation_id=? AND response_json IS NULL').run(request.principalId,request.idempotencyKey);throw error;
   }
   db.prepare('UPDATE exchange_http_operations SET response_json=? WHERE principal_id=? AND operation_id=?').run(JSON.stringify(result),request.principalId,request.idempotencyKey);
   integrity.seal('exchange_http_operations','principal_id=? AND operation_id=?',[request.principalId,request.idempotencyKey]);return result;
  }catch(error){
   const code=error instanceof Error&&/^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)?error.message:'EXCHANGE_VALIDATION_FAILED';
   const missing=code.endsWith('NOT_FOUND');const precondition=code.includes('IF_MATCH')||code.includes('IF_NONE_MATCH');const dependency=code.includes('UNAVAILABLE')||code==='RESTORE_BLOCKED';
   return OperatorResponseSchema.parse({kind:'problem',status:missing?404:precondition?412:dependency?503:409,error:{kind:missing?'notFound':precondition?'precondition':dependency?'dependency':'conflict',code,message:'La operación requiere revisión o una dependencia disponible.',...(dependency?{safeCode:code,retryable:false}:{})}});
  }
 }};
}
