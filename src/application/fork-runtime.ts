import { randomUUID,createHash } from 'node:crypto';
import { constants,closeSync,existsSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readSync,realpathSync,renameSync,rmSync,writeFileSync } from 'node:fs';
import { dirname,isAbsolute,join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { createIcmMemoryAdapter } from '../adapters/icm.ts';
import { OperationIdSchema,RevisionSchema,RunIdSchema,WorldSeqSchema } from '../domain/values.ts';
import { ForkArtifactManifestSchema,type ForkJob } from '../domain/fork-job.ts';
import { MemoryProjectionReceiptSchema } from '../domain/memory-projection.ts';
import { canonicalContinuistaValue,hashContinuistaValue } from '../domain/continuista-review.ts';
import { prepareForkState } from './prepare-fork-state.ts';
import { prepareForkDramaticSeed } from './fork-dramatic-seed.ts';
import { prepareForkConfiguration } from './fork-configuration.ts';
import { ForkPublicationPackageSchema } from './fork-package.ts';
import type { openLocalHost } from './local-host.ts';

const BeginSchema=z.strictObject({runId:RunIdSchema,commitIndex:RevisionSchema,worldRevision:RevisionSchema,worldSeq:WorldSeqSchema,
 operationId:OperationIdSchema,principalId:z.string().trim().min(1).max(200),idempotencyKey:z.string().uuid(),
 name:z.string().trim().min(1).max(120),reason:z.string().trim().min(1).max(4000)});
export type ForkProgress={operationId:string}&({kind:'memory';completed:number;total:number}|{kind:'artifacts'}|{kind:'ready'});
function directory(path:string){
 if(!existsSync(path)){mkdirSync(path,{mode:0o700});syncDirectory(dirname(path));}
 if(lstatSync(path).isSymbolicLink()||!lstatSync(path).isDirectory()||realpathSync(path)!==path)throw new Error('FORK_DIRECTORY_INVALID');
 return path;
}
function syncDirectory(path:string){const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
function exactFile(path:string,text:string){
 if(existsSync(path)){
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size!==Buffer.byteLength(text)||readFileSync(fd,'utf8')!==text)throw new Error('FORK_FILE_MISMATCH');}finally{closeSync(fd);}
  return;
 }
 const temporary=`${path}.pending-${randomUUID()}`;
 const fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{writeFileSync(fd,text);fsyncSync(fd);}finally{closeSync(fd);}
 try{if(existsSync(path)){exactFile(path,text);}else{renameSync(temporary,path);syncDirectory(dirname(path));}}finally{rmSync(temporary,{force:true});}
}
function syncActorStorage(root:string,runId:string,actorId:string){
 const actorRoot=join(root,'runs',runId,'actors',actorId);
 for(const file of ['memory.sqlite','memory.sqlite-wal']){const path=join(actorRoot,file);if(!existsSync(path))continue;const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1)throw new Error('FORK_SQLITE_INVALID');fsyncSync(fd);}finally{closeSync(fd);}}
 for(const path of [actorRoot,dirname(actorRoot),join(root,'runs',runId),join(root,'runs'),root])syncDirectory(path);
}
function sqliteArtifact(path:string){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1)throw new Error('FORK_SQLITE_INVALID');
  const bytes=Buffer.alloc(65536);const hash=createHash('sha256');let offset=0;
  for(;;){const count=readSync(fd,bytes,0,bytes.length,offset);if(count===0)break;hash.update(bytes.subarray(0,count));offset+=count;}
  const header=Buffer.alloc(16);readSync(fd,header,0,header.length,0);if(header.toString('utf8')!=='SQLite format 3\0')throw new Error('FORK_SQLITE_INVALID');
  const db=new DatabaseSync(path,{readOnly:true});try{const rows=db.prepare('PRAGMA quick_check').all();if(rows.length!==1||z.strictObject({quick_check:z.string()}).parse(rows[0]).quick_check!=='ok')throw new Error('FORK_SQLITE_INVALID');}finally{db.close();}
  return {sha256:hash.digest('hex'),byteLength:stat.size};
 }finally{closeSync(fd);}
}

/** Mechanical host operation only. No Pi, provider, source ICM read or actor scheduling. */
export function createForkRuntime(input:{host:ReturnType<typeof openLocalHost>;binaryPath:string;onProgress?:(progress:ForkProgress)=>void}){
 const root=input.host.privateDataRoot;if(!isAbsolute(root)||realpathSync(root)!==root||lstatSync(root).isSymbolicLink())throw new Error('FORK_ROOT_INVALID');
 const journal=input.host.journal;const pending=new Map<string,{controller:AbortController;promise:Promise<void>}>();let closed=false;
 function progress(event:ForkProgress){try{input.onProgress?.(event);}catch{/* Observers cannot control publication. */}}
 async function perform(job:ForkJob,signal:AbortSignal){
  let phase:'memory'|'artifacts'|'publish'='artifacts';
  try{
   signal.throwIfAborted();const packet=ForkPublicationPackageSchema.parse(journal.readForkPackage({operationId:job.operationId,principalId:job.principalId}));
   const packageHash=hashContinuistaValue(packet);
   const operations=directory(join(root,'forks'));const operationRoot=directory(join(operations,job.operationId));
   exactFile(join(operationRoot,'package.json'),canonicalContinuistaValue(packet));syncDirectory(operationRoot);
   const staging=directory(join(operationRoot,'staging'));const runs=directory(join(root,'runs'));
   const finalRun=join(runs,job.targetRunId);const stagedRun=join(staging,'runs',job.targetRunId);
   const marker=canonicalContinuistaValue({operationId:job.operationId,targetRunId:job.targetRunId,packageHash});
   let memoryRoot=staging;
   if(existsSync(finalRun)){
    directory(finalRun);if(existsSync(stagedRun))throw new Error('FORK_DUPLICATE_TARGET');
    const markerPath=join(finalRun,'fork-owner.json');if(!existsSync(markerPath))throw new Error('FORK_TARGET_NOT_OWNED');
    exactFile(markerPath,marker);memoryRoot=root;
   }
   phase='memory';const total=packet.state.actors.reduce((sum,actor)=>sum+actor.experiences.length,0);let completed=0;
   for(const actor of packet.state.actors){
    signal.throwIfAborted();
    const adapter=await createIcmMemoryAdapter({privateDataRoot:memoryRoot,runId:job.targetRunId,actorId:actor.actorId,binaryPath:input.binaryPath,
     ledger:{findReceipt:request=>journal.readForkProjectionReceipt({operationId:job.operationId,...request})}});
    await adapter.initialize({signal});syncActorStorage(memoryRoot,job.targetRunId,actor.actorId);
    for(const frozen of actor.experiences){
     signal.throwIfAborted();const stored=await adapter.projector.store(frozen,{signal});
     syncActorStorage(memoryRoot,job.targetRunId,actor.actorId);
     journal.recordForkProjection({operationId:job.operationId,principalId:job.principalId,receipt:MemoryProjectionReceiptSchema.parse({...stored,
      runId:job.targetRunId,actorId:actor.actorId,worldSeq:frozen.envelope.worldSeq,canonicalPayload:frozen.canonicalPayload,payloadHash:frozen.payloadHash})});
     progress({operationId:job.operationId,kind:'memory',completed:++completed,total});
    }
    signal.throwIfAborted();const found=await adapter.diagnostics.listForensic({throughWorldSeq:packet.state.snapshot.seq},{signal});
    if(found.rejectedCount!==0||found.experiences.length!==actor.experiences.length)throw new Error('FORK_MEMORY_MISMATCH');
    const expected=new Map(actor.experiences.map(item=>[item.envelope.experienceId,item.payloadHash]));
    const seen=new Set<string>();for(const item of found.experiences){if(seen.has(item.experience.experienceId)||expected.get(item.experience.experienceId)!==item.payloadHash)throw new Error('FORK_MEMORY_MISMATCH');seen.add(item.experience.experienceId);}
   }
   signal.throwIfAborted();phase='artifacts';
   const selectedRun=memoryRoot===root?finalRun:stagedRun;directory(selectedRun);exactFile(join(selectedRun,'fork-owner.json'),marker);syncDirectory(selectedRun);
   const actors=packet.state.actors.map(actor=>({actorId:actor.actorId,...sqliteArtifact(join(selectedRun,'actors',actor.actorId,'memory.sqlite'))}));
   const artifacts=ForkArtifactManifestSchema.parse({kind:'fork-artifacts',operationId:job.operationId,targetRunId:job.targetRunId,packageHash,actors});
   exactFile(join(operationRoot,'artifacts.json'),canonicalContinuistaValue(artifacts));syncDirectory(operationRoot);
   if(memoryRoot!==root){renameSync(stagedRun,finalRun);syncDirectory(runs);syncDirectory(join(staging,'runs'));}
   // Journal is published only after durable file placement; a restart verifies the same owned directory.
   progress({operationId:job.operationId,kind:'artifacts'});signal.throwIfAborted();phase='publish';
   const result=journal.publishForkJob({operationId:job.operationId,principalId:job.principalId,expectedRevision:job.revision,artifacts});
   if(result.state!=='ready')throw new Error('FORK_NOT_PUBLISHED');progress({operationId:job.operationId,kind:'ready'});
  }catch{
   if(signal.aborted)return;const current=journal.readForkJob({operationId:job.operationId,principalId:job.principalId});
   if(current?.state==='staging')journal.failForkJob({operationId:job.operationId,principalId:job.principalId,expectedRevision:current.revision,
    code:phase==='memory'?'FORK_MEMORY_FAILED':phase==='artifacts'?'FORK_ARTIFACTS_INVALID':'FORK_PUBLICATION_FAILED'});
  }
 }
 function schedule(job:ForkJob){
  if(closed||job.state!=='staging'||pending.has(job.operationId))return;
  const controller=new AbortController();const promise=Promise.resolve().then(()=>perform(job,controller.signal));
  pending.set(job.operationId,{controller,promise});void promise.finally(()=>pending.delete(job.operationId)).catch(()=>undefined);
 }
 return {
  begin(raw:unknown){
   if(closed)throw new Error('FORK_RUNTIME_CLOSED');const request=BeginSchema.parse(raw);
   const existing=journal.findForkJob({principalId:request.principalId,idempotencyKey:request.idempotencyKey});
   if(existing!==undefined){
    if(existing.operationId!==request.operationId||existing.source.runId!==request.runId||existing.source.commitIndex!==request.commitIndex
     ||existing.source.worldRevision!==request.worldRevision||existing.source.worldSeq!==request.worldSeq||existing.name!==request.name||existing.reason!==request.reason)return {kind:'idempotencyConflict'} as const;
    schedule(existing);return {kind:'existing',job:existing} as const;
   }
   const source=journal.readForkSource({runId:request.runId,commitIndex:request.commitIndex,worldRevision:request.worldRevision,worldSeq:request.worldSeq});
   if(source.kind!=='found')return source;
   const state=prepareForkState({snapshot:source.snapshot,configuration:source.configuration,cuts:source.cuts,targetRunId:randomUUID()});
   const drama=prepareForkDramaticSeed({structure:source.structure,state});
   const prepared=prepareForkConfiguration({sourceConfiguration:source.configuration,state:drama.state,name:request.name,principalId:request.principalId,recordedAt:new Date().toISOString(),operationId:request.operationId});
   const packet=ForkPublicationPackageSchema.parse({kind:'fork-publication-package',state:drama.state,configuration:prepared.configuration,continuityFence:prepared.continuityFence,dramaticSeed:drama.seed});
   const result=journal.beginForkJob({operationId:request.operationId,principalId:request.principalId,idempotencyKey:request.idempotencyKey,name:request.name,reason:request.reason,package:packet});
   if(result.kind==='created'||result.kind==='existing')schedule(result.job);return result;
  },
  read(request:{operationId:string;principalId:string}){return journal.readForkJob({operationId:request.operationId,principalId:request.principalId});},
  retry(request:{operationId:string;principalId:string;expectedRevision:number}){if(closed)throw new Error('FORK_RUNTIME_CLOSED');const job=journal.retryForkJob({operationId:request.operationId,principalId:request.principalId,expectedRevision:request.expectedRevision});if(job!==undefined){const active=pending.get(job.operationId);if(active!==undefined)void active.promise.then(()=>schedule(job)).catch(()=>undefined);else schedule(job);}return job;},
  recover(){if(closed)throw new Error('FORK_RUNTIME_CLOSED');for(const job of journal.listStagingForkJobs())schedule(job);},
  async waitForIdle(){while(pending.size>0)await Promise.all([...pending.values()].map(item=>item.promise));},
  async close(){closed=true;for(const item of pending.values())item.controller.abort();await Promise.all([...pending.values()].map(item=>item.promise));},
 };
}
