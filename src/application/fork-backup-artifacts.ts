import { createHash } from 'node:crypto';
import { lstatSync,readFileSync,realpathSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { BackupPathSchema } from '../domain/backup.ts';
import { ForkArtifactManifestSchema } from '../domain/fork-job.ts';
import { canonicalContinuistaValue,hashContinuistaValue } from '../domain/continuista-review.ts';
import type { openLocalHost } from './local-host.ts';

export type ForkBackupArtifact={path:string;kind:'sqlite'|'fork-memory'|'fork-metadata'};
/** Registered fork graph only. Caller holds the fork admission/drain fence. Raw
 * unfinished SQLite plus WAL preserves frozen artifact hashes and ICM memory IDs. */
export function forkBackupArtifacts(input:{host:ReturnType<typeof openLocalHost>;database:DatabaseSync}):ForkBackupArtifact[]{
 const root=input.host.privateDataRoot;const artifacts:ForkBackupArtifact[]=[];
 function present(path:string){try{lstatSync(join(root,path));return true;}catch(error){if(error instanceof Error&&'code' in error&&error.code==='ENOENT')return false;throw error;}}
 function safe(path:string){
  const absolute=join(root,path);for(let current=absolute;current!==root;current=dirname(current)){
   const stat=lstatSync(current);if(stat.isSymbolicLink()||realpathSync(current)!==current)throw new Error('BACKUP_FORK_PATH_INVALID');
   if(current===absolute&&(!stat.isFile()||stat.nlink!==1||stat.size>256*1024*1024))throw new Error('BACKUP_FORK_FILE_INVALID');
  }
 }
 function directory(path:string){if(!present(path))return;const absolute=join(root,path);for(let current=absolute;current!==root;current=dirname(current)){const stat=lstatSync(current);if(stat.isSymbolicLink()||!stat.isDirectory()||realpathSync(current)!==current)throw new Error('BACKUP_FORK_PATH_INVALID');}}
 function add(path:string,kind:ForkBackupArtifact['kind']){BackupPathSchema.parse(path);safe(path);artifacts.push({path,kind});if(artifacts.length>100000)throw new Error('BACKUP_ARTIFACT_LIMIT');}
 function exact(path:string,expected:string,required=false){if(!present(path)){if(required)throw new Error('BACKUP_FORK_METADATA_MISSING');return;}safe(path);if(readFileSync(join(root,path),'utf8')!==expected)throw new Error('BACKUP_FORK_METADATA_INVALID');add(path,'fork-metadata');}
 const rows=input.database.prepare('SELECT operation_id,principal_id FROM fork_jobs ORDER BY operation_id LIMIT 100001').all();if(rows.length>100000)throw new Error('BACKUP_FORK_LIMIT');
 for(const raw of rows){
  const row=z.strictObject({operation_id:z.uuid(),principal_id:z.string()}).parse(raw);const lookup={operationId:row.operation_id,principalId:row.principal_id};
  const job=input.host.journal.readForkJob(lookup);const packet=input.host.journal.readForkPackage(lookup);if(!job||!packet)throw new Error('BACKUP_FORK_JOB_INVALID');
  const receipts=input.host.journal.readForkProjectionReceipts(lookup);const operation=`forks/${job.operationId}`;const packageHash=hashContinuistaValue(packet);
  for(const path of ['forks',operation,`${operation}/staging`,`${operation}/staging/runs`])directory(path);
  exact(`${operation}/package.json`,canonicalContinuistaValue(packet));
  const finalRun=`runs/${job.targetRunId}`,stagedRun=`${operation}/staging/runs/${job.targetRunId}`;
  const finalExists=present(finalRun),stagedExists=present(stagedRun);if(finalExists&&stagedExists)throw new Error('BACKUP_FORK_DUPLICATE_TARGET');
  if(job.state==='ready'&&!finalExists)throw new Error('BACKUP_FORK_MEMORY_MISSING');
  directory(finalRun);directory(stagedRun);const selected=finalExists?finalRun:stagedRun;
  const marker=canonicalContinuistaValue({operationId:job.operationId,targetRunId:job.targetRunId,packageHash});exact(`${selected}/fork-owner.json`,marker,finalExists);
  let frozen:z.infer<typeof ForkArtifactManifestSchema>|undefined;
  const manifestPath=`${operation}/artifacts.json`;
  if(present(manifestPath)){
   safe(manifestPath);const text=readFileSync(join(root,manifestPath),'utf8');frozen=ForkArtifactManifestSchema.parse(JSON.parse(text));
   if(canonicalContinuistaValue(frozen)!==text||frozen.operationId!==job.operationId||frozen.targetRunId!==job.targetRunId||frozen.packageHash!==packageHash||frozen.actors.length!==packet.state.actors.length||new Set(frozen.actors.map(actor=>actor.actorId)).size!==frozen.actors.length||frozen.actors.some(actor=>!packet.state.actors.some(expected=>expected.actorId===actor.actorId)))throw new Error('BACKUP_FORK_METADATA_INVALID');
   add(manifestPath,'fork-metadata');
  }
  for(const actor of packet.state.actors){
   const actorRoot=`${selected}/actors/${actor.actorId}`,memory=`${actorRoot}/memory.sqlite`;directory(`${selected}/actors`);directory(actorRoot);
   if(!present(memory)){if(job.state==='ready'||receipts.some(receipt=>receipt.actorId===actor.actorId)||frozen?.actors.some(item=>item.actorId===actor.actorId))throw new Error('BACKUP_FORK_MEMORY_MISSING');continue;}
   safe(memory);
   // Even discarded SHM/journal sidecars may redirect SQLite before it is opened.
   for(const suffix of ['-wal','-shm','-journal'])if(present(memory+suffix))safe(memory+suffix);
   if(present(memory+'-journal'))throw new Error('BACKUP_FORK_ROLLBACK_JOURNAL_UNSUPPORTED');
   const copied=new DatabaseSync(join(root,memory),{readOnly:true});
   try{
    for(const receipt of receipts.filter(item=>item.actorId===actor.actorId)){
     const stored=copied.prepare('SELECT summary FROM memories WHERE id=?').get(receipt.memoryId);
     if(!stored||z.strictObject({summary:z.string()}).parse(stored).summary!==receipt.canonicalPayload)throw new Error('BACKUP_FORK_RECEIPT_MEMORY_INVALID');
    }
   }finally{copied.close();}

   if(job.state!=='ready'){
    const expected=frozen?.actors.find(item=>item.actorId===actor.actorId);const content=readFileSync(join(root,memory));
    if(expected&&(content.length!==expected.byteLength||createHash('sha256').update(content).digest('hex')!==expected.sha256))throw new Error('BACKUP_FORK_ARTIFACT_MISMATCH');
    add(memory,'fork-memory');if(present(memory+'-wal'))add(memory+'-wal','fork-memory');
   }else add(memory,'sqlite');
   if(present(`${actorRoot}/icm-config.toml`))add(`${actorRoot}/icm-config.toml`,'fork-metadata');
  }
 }
 return artifacts;
}
