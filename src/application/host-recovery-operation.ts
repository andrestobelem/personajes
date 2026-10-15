import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { withHostDirectoryOperation, type HostDirectoryOperation } from '../adapters/host-ownership.ts';
import { BackupManifestSchema, type BackupManifest } from '../domain/backup.ts';
import { HostRecoveryJobSchema, type HostRecoveryJob } from '../domain/host-recovery.ts';
import { HashSchema, OperationIdSchema } from '../domain/values.ts';

const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const IdentitySchema=z.strictObject({dev:z.number().int().nonnegative(),ino:z.number().int().nonnegative()});
const LookupSchema=z.strictObject({operationId:OperationIdSchema,principalId:z.string().trim().min(1).max(200)});
const AdmissionSchema=z.strictObject({...LookupSchema.shape,backupId:BackupManifestSchema.shape.backupId,
  manifest:BackupManifestSchema,manifestHash:HashSchema,targetFingerprint:HashSchema,confirmDiffHash:HashSchema,bundleRoot:z.string().min(1)});
const ResumeRequestSchema=z.strictObject({...LookupSchema.shape,idempotencyKey:z.string().uuid(),expectedRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),expectedDirectoryOperationNonce:z.string().uuid().optional()});
const ResumeReceiptSchema=z.strictObject({request:ResumeRequestSchema,requestHash:HashSchema,result:HostRecoveryJobSchema});
const RecordSchema=z.strictObject({kind:z.literal('host-recovery-control'),version:z.literal(1),job:HostRecoveryJobSchema,
  admission:AdmissionSchema,requestHash:HashSchema,rootHash:HashSchema,original:IdentitySchema,
  stage:IdentitySchema.nullable(),prepared:z.boolean(),stageHash:HashSchema.nullable(),resumeReceipts:z.array(ResumeReceiptSchema).optional()});
type Record=z.infer<typeof RecordSchema>;
export type HostRecoveryAdmission=z.infer<typeof AdmissionSchema>;
export type HostRecoveryFailpoint='afterResume'|'afterQueued'|'afterClose'|'afterStaging'|'beforeOriginalRename'|'afterOriginalRename'|'afterOriginalPreserved'|'beforeInstallRename'|'afterInstallRename'|'afterInstalled'|'afterReopen'|'afterVerify';
export type HostRecoveryContext={
  privateDataRoot:string;originalRoot:string;preservedRoot:string;stageRoot:string;bundleRoot:string;
  manifest:BackupManifest;manifestHash:string;targetFingerprint:string;confirmDiffHash:string;
  gate:HostDirectoryOperation;job:HostRecoveryJob;intent:HostRecoveryAdmission;
};
export type HostRecoveryOperationCallbacks={
  /** Drain every writer, close HTTP/workers/databases and release ownership under this gate. Idempotent. */
  close(input:{gate:HostDirectoryOperation;job:HostRecoveryJob;intent:HostRecoveryAdmission}):void|Promise<void>;
  /** Add preserved administrative data and declared infrastructure. Must close any handles before returning. */
  prepare(input:HostRecoveryContext):void|Promise<void>;
  /** Reacquire ownership using the active capability; do not start inference automatically. */
  reopen(input:{gate:HostDirectoryOperation;job:HostRecoveryJob;intent:HostRecoveryAdmission}):void|Promise<void>;
  /** Safe abort before any swap: reopen the intact original, with no backup equality check. */
  reopenOriginal?(input:{gate:HostDirectoryOperation;job:HostRecoveryJob;intent:HostRecoveryAdmission}):void|Promise<void>;
  verify(input:HostRecoveryContext & {phase:'closed'|'staged'|'reopened';root:string}):void|Promise<void>;
};

function syncDirectory(path:string){const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
function directory(path:string){
  const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink()||(process.getuid!==undefined&&stat.uid!==process.getuid()))throw new Error('RECOVERY_DIRECTORY_UNSAFE');
  return IdentitySchema.parse({dev:stat.dev,ino:stat.ino});
}
function same(left:z.infer<typeof IdentitySchema>|undefined|null,right:z.infer<typeof IdentitySchema>|undefined|null){return left!==undefined&&left!==null&&right!==undefined&&right!==null&&left.dev===right.dev&&left.ino===right.ino;}
function maybeDirectory(path:string){try{return directory(path);}catch(error){if(error instanceof Error&&'code' in error&&error.code==='ENOENT')return undefined;throw error;}}
function regularBytes(path:string,max=128*1024*1024){
 const before=lstatSync(path);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)throw new Error('RECOVERY_FILE_UNSAFE');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=fstatSync(fd);if(stat.dev!==before.dev||stat.ino!==before.ino||!stat.isFile()||stat.nlink!==1||stat.size>max||(process.getuid!==undefined&&stat.uid!==process.getuid()))throw new Error('RECOVERY_FILE_UNSAFE');return readFileSync(fd);}finally{closeSync(fd);}
}
function assertContainedFile(root:string,path:string){
 const rel=relative(root,path);if(rel.length===0||isAbsolute(rel)||rel==='..'||rel.startsWith(`..${sep}`))throw new Error('RECOVERY_PATH_INVALID');
 let parent=root;directory(parent);const parts=rel.split(sep);for(const part of parts.slice(0,-1)){parent=join(parent,part);directory(parent);}
}
function durableFile(path:string,bytes:string|Uint8Array,exclusive=false){
 const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_NOFOLLOW|(exclusive?constants.O_EXCL:constants.O_TRUNC),0o600);
 try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1)throw new Error('RECOVERY_FILE_UNSAFE');writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
}
/** Validate and sync the complete prepared tree, including preservation callback output. */
function syncTree(root:string):string{
 const entries:Array<{path:string;hash:string;bytes:number;kind:'file'|'directory'}>=[];
 const visit=(path:string)=>{directory(path);for(const name of readdirSync(path).sort()){
  const child=join(path,name);const stat=lstatSync(child);if(stat.isSymbolicLink())throw new Error('RECOVERY_SYMLINK');
  if(stat.isDirectory()){entries.push({path:relative(root,child),hash:digest('directory'),bytes:0,kind:'directory'});visit(child);}
  else{const bytes=regularBytes(child,Number.MAX_SAFE_INTEGER);entries.push({path:relative(root,child),hash:digest(bytes),bytes:bytes.length,kind:'file'});const fd=openSync(child,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
 }syncDirectory(path);};visit(root);return digest(JSON.stringify(entries));
}
function safeCode(error:unknown){return error instanceof Error&&/^(?:HOST_RECOVERY_|RECOVERY_)[A-Z_]{1,60}$/.test(error.message)?error.message:'HOST_RECOVERY_FAILED';}

/** Offline exchange engine. Its durable control plane and original directory survive
 * replacement of the host root. No SQLite connection is opened by this module. */
export function createHostRecoveryOperation(input:HostRecoveryOperationCallbacks & {
 privateDataRoot:string;failpoint?:(point:HostRecoveryFailpoint)=>void|Promise<void>;
}){
 if(!isAbsolute(input.privateDataRoot))throw new Error('RECOVERY_ROOT_INVALID');
 const normalized=resolve(input.privateDataRoot);const parent=realpathSync(dirname(normalized));const root=join(parent,basename(normalized));
 if(root===parent)throw new Error('RECOVERY_ROOT_INVALID');
 maybeDirectory(root);
 const controlRoot=join(parent,`.${basename(root)}.personajes-recovery`);const rootHash=digest(root);
 const paths=(operationId:string)=>({record:join(controlRoot,`${OperationIdSchema.parse(operationId)}.json`),
  stage:join(parent,`.${basename(root)}.recovery-${operationId}.stage`),preserved:join(parent,`.${basename(root)}.recovery-${operationId}.original`)});
 function ensureControl(){if(!existsSync(controlRoot)){mkdirSync(controlRoot,{mode:0o700});syncDirectory(parent);}directory(controlRoot);}
 function readRecord(operationId:string){
  if(maybeDirectory(controlRoot)===undefined)return undefined;const path=paths(operationId).record;
  try{lstatSync(path);}catch(error){if(error instanceof Error&&'code' in error&&error.code==='ENOENT')return undefined;throw error;}
  const envelope=z.strictObject({record:RecordSchema,sha256:HashSchema}).parse(JSON.parse(regularBytes(path).toString('utf8')));const record=envelope.record;
  if(digest(JSON.stringify(record))!==envelope.sha256||record.rootHash!==rootHash||record.job.operationId!==operationId||record.admission.operationId!==operationId
   ||record.job.backupId!==record.admission.backupId||digest(JSON.stringify(record.admission))!==record.requestHash)throw new Error('RECOVERY_CONTROL_INVALID');
  const keys=new Set<string>();for(const receipt of record.resumeReceipts??[]){
   if(receipt.request.operationId!==operationId||receipt.request.principalId!==record.admission.principalId||receipt.requestHash!==digest(JSON.stringify(receipt.request))
    ||receipt.result.operationId!==operationId||receipt.result.backupId!==record.job.backupId||receipt.result.state!=='queued'||receipt.result.revision!==receipt.request.expectedRevision+1||keys.has(receipt.request.idempotencyKey))throw new Error('RECOVERY_CONTROL_INVALID');
   keys.add(receipt.request.idempotencyKey);
  }
  return record;
 }
 function operationIds(){
  if(maybeDirectory(controlRoot)===undefined)return [];
  const names=readdirSync(controlRoot).filter(name=>name.endsWith('.json')).sort();if(names.length>100_000)throw new Error('RECOVERY_OPERATION_LIMIT');
  return names.map(name=>{const id=OperationIdSchema.safeParse(name.slice(0,-5));if(!id.success)throw new Error('RECOVERY_CONTROL_INVALID');return id.data;});
 }
 function save(record:Record){
  const checked=RecordSchema.parse(record);ensureControl();const target=paths(checked.job.operationId).record;
  if(existsSync(target))regularBytes(target);
  const temporary=join(controlRoot,`.${checked.job.operationId}-${randomUUID()}.tmp`);
  durableFile(temporary,JSON.stringify({record:checked,sha256:digest(JSON.stringify(checked))}),true);renameSync(temporary,target);syncDirectory(controlRoot);
 }
 function advance(record:Record,changes:Partial<Pick<HostRecoveryJob,'state'|'phase'|'safeCode'>>){record.job=HostRecoveryJobSchema.parse({...record.job,...changes,revision:record.job.revision+1});save(record);}
 function publicJob(record:Record){return HostRecoveryJobSchema.parse(record.job);}
 function context(record:Record,gate:HostDirectoryOperation):HostRecoveryContext{
  const locations=paths(record.job.operationId);return {privateDataRoot:root,originalRoot:root,preservedRoot:locations.preserved,stageRoot:locations.stage,bundleRoot:record.admission.bundleRoot,
   manifest:structuredClone(record.admission.manifest),manifestHash:record.admission.manifestHash,targetFingerprint:record.admission.targetFingerprint,confirmDiffHash:record.admission.confirmDiffHash,gate,job:publicJob(record),intent:structuredClone(record.admission)};
 }
 function verifyBundle(record:Record){
  const admission=record.admission;if(admission.bundleRoot!==join(root,'backups',admission.backupId))throw new Error('RECOVERY_BUNDLE_ROOT_INVALID');
  assertContainedFile(root,join(admission.bundleRoot,'manifest.json'));
  const bytes=regularBytes(join(admission.bundleRoot,'manifest.json'),64*1024*1024);const manifest=BackupManifestSchema.parse(JSON.parse(bytes.toString('utf8')));
  if(digest(bytes)!==admission.manifestHash||digest(JSON.stringify(manifest))!==digest(JSON.stringify(admission.manifest))||manifest.backupId!==admission.backupId
    ||manifest.originRootHash!==rootHash)throw new Error('RECOVERY_MANIFEST_CHANGED');
  return manifest;
 }
 async function begin(raw:unknown){
  const admission=AdmissionSchema.parse(raw);if(admission.bundleRoot!==join(root,'backups',admission.backupId)||admission.manifest.backupId!==admission.backupId||admission.manifest.originRootHash!==rootHash)throw new Error('RECOVERY_ADMISSION_INVALID');
  return withHostDirectoryOperation({privateDataRoot:root,operation:async()=>{
   const previous=readRecord(admission.operationId);const hash=digest(JSON.stringify(admission));
   if(previous!==undefined){if(previous.requestHash!==hash||previous.admission.principalId!==admission.principalId)throw new Error('RECOVERY_IDEMPOTENCY_CONFLICT');return publicJob(previous);}
   const original=directory(root);const locations=paths(admission.operationId);if(existsSync(locations.stage)||existsSync(locations.preserved))throw new Error('RECOVERY_PATH_COLLISION');
   ensureControl();
   // A different admitted operation must be reconciled before another exchange.
   for(const id of operationIds()){const other=readRecord(id);if(other!==undefined&&other.job.state!=='succeeded'&&other.job.state!=='aborted')throw new Error('RECOVERY_OTHER_OPERATION_PENDING');}
   const job=HostRecoveryJobSchema.parse({kind:'host-recovery',operationId:admission.operationId,backupId:admission.backupId,state:'queued',phase:'queued',revision:0,safeCode:null});
   const record=RecordSchema.parse({kind:'host-recovery-control',version:1,job,admission,requestHash:hash,rootHash,original,stage:null,prepared:false,stageHash:null});
   verifyBundle(record);save(record);await input.failpoint?.('afterQueued');return publicJob(record);
  }});
 }
 function read(raw:unknown){const request=LookupSchema.parse(raw);const record=readRecord(request.operationId);return record===undefined||record.admission.principalId!==request.principalId?undefined:publicJob(record);}
 function list(raw:unknown){
  const request=z.strictObject({principalId:LookupSchema.shape.principalId}).parse(raw);
  return operationIds().flatMap(id=>{const record=readRecord(id);if(record===undefined)throw new Error('RECOVERY_CONTROL_INVALID');return record.admission.principalId===request.principalId?[publicJob(record)]:[];});
 }
 async function resume(raw:unknown){
  const request=ResumeRequestSchema.parse(raw);const requestHash=HashSchema.parse(digest(JSON.stringify(request)));
  return withHostDirectoryOperation({privateDataRoot:root,operation:async()=>{
   const record=readRecord(request.operationId);if(record===undefined||record.admission.principalId!==request.principalId)throw new Error('RECOVERY_OPERATION_NOT_FOUND');
   for(const id of operationIds()){
    const other=readRecord(id);
    if(other===undefined||other.admission.principalId!==request.principalId)continue;
    const cached=other.resumeReceipts?.find(receipt=>receipt.request.idempotencyKey===request.idempotencyKey);
    if(cached!==undefined){if(cached.requestHash!==requestHash)throw new Error('RECOVERY_IDEMPOTENCY_CONFLICT');return HostRecoveryJobSchema.parse(cached.result);}
   }
   if(record.job.revision!==request.expectedRevision)throw new Error('RECOVERY_REVISION_CONFLICT');
   if(record.job.state==='succeeded')throw new Error('RECOVERY_ALREADY_VERIFIED');
   if(record.job.state==='aborted')throw new Error('RECOVERY_OPERATION_ABORTED');
   record.job=HostRecoveryJobSchema.parse({...record.job,state:'queued',revision:record.job.revision+1,safeCode:null});
   record.resumeReceipts=[...(record.resumeReceipts??[]),{request,requestHash,result:publicJob(record)}];
   save(record);await input.failpoint?.('afterResume');return publicJob(record);
  }});
 }
 async function execute(raw:unknown){
  const request=LookupSchema.parse(raw);
  return withHostDirectoryOperation({privateDataRoot:root,operation:async gate=>{
   const record=readRecord(request.operationId);if(record===undefined||record.admission.principalId!==request.principalId)throw new Error('RECOVERY_OPERATION_NOT_FOUND');
   if(record.job.state==='succeeded'||record.job.state==='aborted')return publicJob(record);
   const locations=paths(record.job.operationId);let didClose=false;
   try{
    // Never swap a directory while old or partially reopened handles may be alive.
    if(record.job.phase==='queued')advance(record,{state:'running',phase:'closing',safeCode:null});else advance(record,{state:'running',safeCode:null});
    await input.close({gate,job:publicJob(record),intent:structuredClone(record.admission)});didClose=true;await input.failpoint?.('afterClose');
    let current=maybeDirectory(root);let preserved=maybeDirectory(locations.preserved);let stage=maybeDirectory(locations.stage);
    if(preserved!==undefined&&!same(preserved,record.original))throw new Error('RECOVERY_PHASE_AMBIGUOUS');
    if(current!==undefined&&!same(current,record.original)&&!same(current,record.stage))throw new Error('RECOVERY_PHASE_AMBIGUOUS');
    if(stage!==undefined&&record.stage!==null&&!same(stage,record.stage))throw new Error('RECOVERY_PHASE_AMBIGUOUS');
    if(same(current,record.original)){
     if(preserved!==undefined)throw new Error('RECOVERY_PHASE_AMBIGUOUS');
     await input.verify({...context(record,gate),phase:'closed',root});
     if(!record.prepared){
      verifyBundle(record);
      if(stage!==undefined){if(record.stage===null||!same(stage,record.stage))throw new Error('RECOVERY_PHASE_AMBIGUOUS');renameSync(locations.stage,`${locations.stage}.partial-${randomUUID()}`);syncDirectory(parent);}
      mkdirSync(locations.stage,{mode:0o700});record.stage=directory(locations.stage);record.stageHash=null;advance(record,{phase:'staging'});
      for(const file of record.admission.manifest.files){
       const source=join(record.admission.bundleRoot,file.path);assertContainedFile(record.admission.bundleRoot,source);const bytes=regularBytes(source,Number.MAX_SAFE_INTEGER);
       if(bytes.length!==file.bytes||digest(bytes)!==file.sha256)throw new Error('RECOVERY_BACKUP_FILE_CHANGED');
       const target=join(locations.stage,file.path);mkdirSync(dirname(target),{recursive:true,mode:0o700});assertContainedFile(locations.stage,target);durableFile(target,bytes,true);
      }
      await input.prepare(context(record,gate));
      if(existsSync(join(locations.stage,'host-ownership.json'))||existsSync(join(locations.stage,'host-ownership.operation')))throw new Error('RECOVERY_STALE_OWNERSHIP');
      await input.verify({...context(record,gate),phase:'staged',root:locations.stage});record.stageHash=HashSchema.parse(syncTree(locations.stage));record.prepared=true;save(record);await input.failpoint?.('afterStaging');
     }
     if(record.stageHash===null||syncTree(locations.stage)!==record.stageHash||!same(directory(locations.stage),record.stage))throw new Error('RECOVERY_STAGE_CHANGED');
     await input.failpoint?.('beforeOriginalRename');
     if(!same(directory(root),record.original)||existsSync(locations.preserved))throw new Error('RECOVERY_PHASE_AMBIGUOUS');
     renameSync(root,locations.preserved);syncDirectory(parent);await input.failpoint?.('afterOriginalRename');advance(record,{phase:'original-preserved'});await input.failpoint?.('afterOriginalPreserved');
     current=undefined;preserved=directory(locations.preserved);stage=directory(locations.stage);
    }
    if(current===undefined){
     if(!same(preserved,record.original)||!record.prepared||!same(stage,record.stage)||record.stageHash===null||syncTree(locations.stage)!==record.stageHash)throw new Error('RECOVERY_PHASE_AMBIGUOUS');
     if(record.job.phase!=='original-preserved')advance(record,{phase:'original-preserved'});
     await input.failpoint?.('beforeInstallRename');if(existsSync(root))throw new Error('RECOVERY_PHASE_AMBIGUOUS');
     renameSync(locations.stage,root);syncDirectory(parent);await input.failpoint?.('afterInstallRename');advance(record,{phase:'installed'});await input.failpoint?.('afterInstalled');
     current=directory(root);stage=undefined;
    }
    if(!same(current,record.stage)||!same(preserved,record.original)||stage!==undefined)throw new Error('RECOVERY_PHASE_AMBIGUOUS');
    advance(record,{phase:'reopening'});await input.reopen({gate,job:publicJob(record),intent:structuredClone(record.admission)});await input.failpoint?.('afterReopen');
    await input.verify({...context(record,gate),phase:'reopened',root});await input.failpoint?.('afterVerify');advance(record,{state:'succeeded',phase:'verified',safeCode:null});return publicJob(record);
   }catch(error){
    const code=safeCode(error);
    if(didClose&&code!=='HOST_RECOVERY_INTERRUPTED'&&input.reopenOriginal!==undefined&&['queued','closing','staging'].includes(record.job.phase)){
     let intact=false;try{intact=same(maybeDirectory(root),record.original)&&maybeDirectory(locations.preserved)===undefined;}catch{/* Ambiguous paths never authorize an abort. */}
     if(intact){
      let reopened=false;
      try{await input.reopenOriginal({gate,job:publicJob(record),intent:structuredClone(record.admission)});reopened=true;}
      catch{/* A failed original reopen must remain offline and recoverable. */}
      if(reopened){advance(record,{state:'aborted',phase:'original-retained',safeCode:code});return publicJob(record);}
     }
    }
    advance(record,{state:code==='HOST_RECOVERY_INTERRUPTED'?'interrupted':'failed',safeCode:code});return publicJob(record);
   }
  }});
 }
 return Object.freeze({begin,read,list,resume,execute});
}
