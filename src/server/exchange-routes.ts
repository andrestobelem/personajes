import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { BackupSourcesSchema } from '../domain/backup-http.ts';
import { RestorePreviewSchema,RestoreSelectionSchema } from '../domain/backup.ts';
import { ForkJobViewSchema,forkJobEtag } from '../domain/fork-http.ts';
import { HostRecoveryJobSchema,hostRecoveryEtag } from '../domain/host-recovery.ts';
import { CharacterIdSchema,HashSchema } from '../domain/values.ts';
import {DossierAdaptationReadSchema,DossierAdaptationPageSchema} from '../domain/dossier-exchange.ts';
import type { Dossier } from '../domain/catalog.ts';
import { freezeCatalogDossierSource, validateFrozenDossierSource } from '../application/dossier-source-repository.ts';
import { exchangeIntegrity } from '../adapters/exchange-integrity.ts';
import type { openBackupService } from '../application/backup-service.ts';
import type { openDossierExchange } from '../application/dossier-exchange.ts';
import { operatorJson, OperatorResponseSchema, type OperatorExtension, type OperatorRequest } from './operator-extension.ts';

/** Host composition must provide a backup service with an actual global quiesce port.
 * The adapter never invents that barrier, runs providers, or exposes bundleRoot. */
export function createExchangeRoutes(input:{journalPath:string;dossiers:ReturnType<typeof openDossierExchange>;backups:ReturnType<typeof openBackupService>;readCatalogDossier?:(characterId:string)=>Dossier}):OperatorExtension & {close():void}{
 const db=new DatabaseSync(input.journalPath);
 const integrity=exchangeIntegrity(db);
 try{
  db.exec('BEGIN IMMEDIATE');
  db.exec("CREATE TABLE IF NOT EXISTS exchange_http_operations(principal_id TEXT NOT NULL,operation_id TEXT NOT NULL,request_hash TEXT NOT NULL,response_json TEXT,operation_kind TEXT NOT NULL DEFAULT 'unclassified',PRIMARY KEY(principal_id,operation_id))");
  integrity.migrate('exchange_http_operations');
  const columns=db.prepare('PRAGMA table_info(exchange_http_operations)').all().map(row=>z.object({name:z.string()}).parse(row).name);
  if(!columns.includes('operation_kind')){
   const identities=db.prepare('SELECT principal_id,operation_id FROM exchange_http_operations LIMIT 100001').all().map(row=>z.strictObject({principal_id:z.string(),operation_id:z.string()}).parse(row));
   if(identities.length>100000)throw new Error('EXCHANGE_MIGRATION_LIMIT');
   // Checksums cover the old schema. Never bless corrupted or unsealed legacy rows.
   for(const row of identities)integrity.verify('exchange_http_operations','principal_id=? AND operation_id=?',[row.principal_id,row.operation_id]);
   db.exec("ALTER TABLE exchange_http_operations ADD COLUMN operation_kind TEXT NOT NULL DEFAULT 'unclassified'");
   for(const row of identities)integrity.seal('exchange_http_operations','principal_id=? AND operation_id=?',[row.principal_id,row.operation_id]);
  }
  db.exec('COMMIT');
 }catch(error){try{db.exec('ROLLBACK');}finally{db.close();}throw error;}
 const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
 function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>JSON.stringify(key)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
 }
 const importEtag=(id:string,revision:number)=>`"import:${id}:r${revision}"`;
 function operationKind(request:OperatorRequest){
  if(request.kind==='write'&&request.path[0]==='backups'&&request.path[1]){
   if(request.method==='PUT'&&request.path.length===2)return 'backup-create';
   if(request.method==='POST'&&request.path.length===3){if(request.path[2]==='restore-preview')return 'restore-preview';if(request.path[2]==='restore')return 'restore';}
  }
  return 'unclassified';
 }
 const backupEtag=(id:string,revision:number)=>`"backup:${id}:r${revision}"`;
 async function dispatch(request:OperatorRequest){
  const [resource,id,action]=request.path;
  if(resource==='preparation-sources'&&request.kind==='read'){
   if(request.path.length!==3||request.query.size!==0)throw new Error('PREPARATION_SOURCE_REQUEST_INVALID');
   const kind=z.enum(['catalog','adaptations']).parse(id);
   let source;
   if(kind==='catalog'){
    const characterId=CharacterIdSchema.parse(action);
    if(input.readCatalogDossier===undefined)throw new Error('PREPARATION_SOURCE_CATALOG_UNAVAILABLE');
    source=freezeCatalogDossierSource(input.readCatalogDossier(characterId));
    if(source.characterId!==characterId)throw new Error('DOSSIER_SOURCE_SELECTION_CHANGED');
   }else{
    const adaptationId=z.uuid().parse(action);
    const saved=DossierAdaptationReadSchema.parse(input.dossiers.readAdaptation({principalId:request.principalId,adaptationId}));
    if(saved.adaptationId!==adaptationId)throw new Error('ADAPTATION_SCOPE_INVALID');
    source=validateFrozenDossierSource({kind:'saved-adaptation',characterId:saved.characterId,revision:saved.revision,
     contentHash:saved.contentHash,fullArchiveHash:saved.archiveHash,importId:saved.importId,
     adaptationId:saved.adaptationId,importedArchiveHash:saved.importedArchiveHash,frozenDossier:saved.adaptation.importedDossier});
   }
   return operatorJson(source,200,{ETag:`"preparation-source:${source.fullArchiveHash}"`});
  }
  if(resource==='dossier-adaptations'&&request.kind==='read'){
   const entries=new Map<string,string>();
   for(const [key,value] of request.query){if(entries.has(key)||['__proto__','constructor','prototype'].includes(key))throw new Error('ADAPTATION_QUERY_INVALID');entries.set(key,value);}
   const query=Object.fromEntries(entries);
   if(request.path.length===1){
    const selection=z.strictObject({characterId:CharacterIdSchema,limit:z.string().regex(/^[1-9][0-9]{0,2}$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional(),cursor:z.string().min(1).max(4000).regex(/^[A-Za-z0-9_-]+$/).optional()}).parse(query);
    const page=DossierAdaptationPageSchema.parse(input.dossiers.listAdaptations({principalId:request.principalId,characterId:selection.characterId,limit:selection.limit??25,...(selection.cursor===undefined?{}:{cursor:selection.cursor})}));
    if(page.adaptations.some(adaptation=>adaptation.characterId!==selection.characterId))throw new Error('ADAPTATION_SCOPE_INVALID');
    return operatorJson(page);
   }
   if(request.path.length===2){
    z.strictObject({}).parse(query);const adaptationId=z.uuid().parse(id);
    const adaptation=DossierAdaptationReadSchema.parse(input.dossiers.readAdaptation({principalId:request.principalId,adaptationId}));if(adaptation.adaptationId!==adaptationId)throw new Error('ADAPTATION_SCOPE_INVALID');
    return operatorJson(adaptation,200,{ETag:`"dossier-adaptation:${adaptation.adaptationId}:${adaptation.archiveHash}"`});
   }
  }
  if(resource==='dossier-edits'&&request.query.size!==0)throw new Error('EDIT_QUERY_INVALID');
  if(resource==='dossier-edits'&&request.kind==='write'&&request.method==='POST'&&request.path.length===2){
   if(id==='preview'){const result=input.dossiers.editPreview(request.principalId,request.idempotencyKey,request.body);return operatorJson(result,201,{ETag:importEtag(result.importId,0),Location:`/api/v1/imports/${result.importId}`});}
   if(id==='apply'){const body=z.strictObject({importId:z.uuid(),previewToken:z.uuid(),confirmDiffHash:HashSchema}).parse(request.body);const current=input.dossiers.get(request.principalId,body.importId);if(current.state!=='applied'&&request.ifMatch!==importEtag(current.importId,current.revision))throw new Error('EXCHANGE_IF_MATCH_REQUIRED');return operatorJson(input.dossiers.apply(request.principalId,body),201);}
  }
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
     const job=z.union([ForkJobViewSchema,HostRecoveryJobSchema]).parse(await input.backups.restore({...body,backupId:id,principalId:request.principalId}));
     return job.kind==='host-recovery'?operatorJson(job,202,{ETag:hostRecoveryEtag(job),Location:`/api/v1/host-recoveries/${job.operationId}`}):operatorJson(job,202,{ETag:forkJobEtag(job),Location:`/api/v1/forks/${job.operationId}`});
    }
   }
  }
  throw new Error('EXCHANGE_ROUTE_NOT_FOUND');
 }
 function receiptTransaction<T>(work:()=>T):T{
  db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
 }
 const pending=new Map<string,Promise<z.infer<typeof OperatorResponseSchema>>>();
 return {name:'exchange',maxBodyBytes:22*1024*1024,close(){if(pending.size>0)throw new Error('EXCHANGE_OPERATIONS_ACTIVE');db.close();},matches:({path,method})=>['imports','exports','backups','dossier-edits'].includes(path[0]??'')||(method==='GET'&&['dossier-adaptations','preparation-sources'].includes(path[0]??'')),async handle(request){
  try {
   if(request.kind==='read')return await dispatch(request);
   const requestHash=digest(canonical({method:request.method,path:request.path,body:request.body}));const kind=operationKind(request);
   const identity=JSON.stringify([request.principalId,request.idempotencyKey]);
   const previous=db.prepare('SELECT request_hash,response_json,operation_kind FROM exchange_http_operations WHERE principal_id=? AND operation_id=?').get(request.principalId,request.idempotencyKey);
   if(previous){
    integrity.verify('exchange_http_operations','principal_id=? AND operation_id=?',[request.principalId,request.idempotencyKey]);
    const old=z.strictObject({request_hash:z.string(),response_json:z.string().nullable(),operation_kind:z.enum(['backup-create','restore-preview','restore','unclassified'])}).parse(previous);
    if(old.request_hash!==requestHash)throw new Error('EXCHANGE_IDEMPOTENCY_REUSE');
    // Legacy rows cannot be classified from their response alone. Exact cached
    // replay is safe after matching the authenticated request hash; keep their
    // unclassified kind so recovery still compares these historical receipts.
    const legacyCached=old.operation_kind==='unclassified'&&old.response_json!==null;
    if(old.operation_kind!==kind&&!legacyCached)throw new Error('EXCHANGE_IDEMPOTENCY_REUSE');
    if(old.response_json!==null)return OperatorResponseSchema.parse(JSON.parse(old.response_json));
    const active=pending.get(identity);if(active!==undefined)return await active;
    // Only restore operations have a sealed service intent/idempotent preview.
    // Other interrupted mutations retain their conservative explicit failure.
    const recoverable=request.method==='POST'&&request.path[0]==='dossier-edits'&&request.path.length===2&&['preview','apply'].includes(request.path[1]??'')||request.method==='POST'&&request.path.length===3&&request.path[0]==='backups'&&['restore','restore-preview'].includes(request.path[2]??'');
    if(!recoverable)throw new Error('EXCHANGE_OPERATION_INTERRUPTED');
   }else{
    receiptTransaction(()=>{
     db.prepare('INSERT INTO exchange_http_operations(principal_id,operation_id,request_hash,response_json,operation_kind) VALUES(?,?,?,NULL,?)').run(request.principalId,request.idempotencyKey,requestHash,kind);
     integrity.seal('exchange_http_operations','principal_id=? AND operation_id=?',[request.principalId,request.idempotencyKey]);
    });
   }
   // Register the promise before dispatch can enter any asynchronous host port.
   // A concurrent identical request shares this exact durable result; a NULL
   // receipt with no live promise still follows the restart recovery whitelist.
   const work=Promise.resolve().then(async()=>{
    // Any failure retains the sealed NULL intent. The effect may already exist;
    // releasing the key would permit a different request to acquire its identity.
    const result=await dispatch(request);const response=JSON.stringify(result);
    receiptTransaction(()=>{
     integrity.verify('exchange_http_operations','principal_id=? AND operation_id=?',[request.principalId,request.idempotencyKey]);
     db.prepare('UPDATE exchange_http_operations SET response_json=? WHERE principal_id=? AND operation_id=?').run(response,request.principalId,request.idempotencyKey);
     integrity.seal('exchange_http_operations','principal_id=? AND operation_id=?',[request.principalId,request.idempotencyKey]);
    });return result;
   });
   pending.set(identity,work);
   try{return await work;}finally{if(pending.get(identity)===work)pending.delete(identity);}
  }catch(error){
   const adaptationRead=request.path[0]==='dossier-adaptations'&&request.kind==='read';
   const sourceRead=request.path[0]==='preparation-sources'&&request.kind==='read';
   const invalid=sourceRead&&(error instanceof z.ZodError||(error instanceof Error&&error.message==='PREPARATION_SOURCE_REQUEST_INVALID'))||adaptationRead&&(error instanceof z.ZodError||(error instanceof Error&&['ADAPTATION_QUERY_INVALID','ADAPTATION_CURSOR_INVALID','ADAPTATION_CURSOR_SCOPE'].includes(error.message)));
   const code=invalid?(sourceRead?'PREPARATION_SOURCE_REQUEST_INVALID':'ADAPTATION_REQUEST_INVALID'):error instanceof Error&&/^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)?error.message:'EXCHANGE_VALIDATION_FAILED';
   const missing=code.endsWith('NOT_FOUND');const precondition=code.includes('IF_MATCH')||code.includes('IF_NONE_MATCH');const dependency=code.includes('UNAVAILABLE')||code==='RESTORE_BLOCKED';
   return OperatorResponseSchema.parse({kind:'problem',status:invalid?422:missing?404:precondition?412:dependency?503:409,error:{kind:invalid?'validation':missing?'notFound':precondition?'precondition':dependency?'dependency':'conflict',code,message:'La operación requiere revisión o una dependencia disponible.',...(invalid?{issues:[]}:{}),...(dependency?{safeCode:code,retryable:false}:{})}});
  }
 }};
}
