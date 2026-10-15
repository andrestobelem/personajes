import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { forkBackupArtifacts,type ForkBackupArtifact } from './fork-backup-artifacts.ts';
import { BackupPathSchema } from '../domain/backup.ts';
import { RunIdSchema, CharacterIdSchema } from '../domain/values.ts';
import { ActorJobCheckpointSchema,ContinuistaJobExecutionSchema,RunLifecycleCommandResultSchema } from '../domain/world-journal.ts';
import { AdministrativeCheckpointSchema } from '../domain/admin-role-jobs.ts';
import { AdministrativeRoleSchema } from '../domain/admin-roles.ts';
import type { openLocalHost } from './local-host.ts';
import type { BackupQuiescePort } from './backup-service.ts';
import type { createHostRequestBarrier } from './host-request-barrier.ts';

type BusyPort={readonly backupBusy:boolean};
type Suspension={suspendAdmissions():Promise<()=>void>};
type RepresentationSuspension={suspendAdmissions(runIds:unknown):Promise<()=>void>};
type MediaSuspension=Suspension & {backupArtifacts():{path:string;kind:'media'}[]};
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
function physicalRole(raw:unknown){
 const role=AdministrativeRoleSchema.parse(raw);
 switch(role){case 'director':return 'director';case 'narrator':return 'narrador';case 'configurator':return 'configurador';case 'narration-reviewer':return 'continuista';default:{const exhaustive:never=role;throw new Error(String(exhaustive));}}
}

/** Acquires HTTP admission first, refuses live administrative jobs, epochs running
 * representations into pause, cancels/drains model workers, then settles mechanical
 * and media writers. No database transaction is held across an await. */
export function createHostBackupQuiesce(input:{
 host:ReturnType<typeof openLocalHost>;admission:ReturnType<typeof createHostRequestBarrier>;
 oauth:BusyPort;access:BusyPort;preflight:BusyPort;
 representation?:RepresentationSuspension;deliveries?:Suspension;forks?:Suspension;voice:MediaSuspension;
}):BackupQuiescePort{
 if(input.representation===undefined&&input.deliveries===undefined)throw new Error('BACKUP_DELIVERY_BARRIER_UNAVAILABLE');
 return {async acquire(){
  const releaseHttp=await input.admission.acquire();const releases:Array<()=>void>=[];
  let db:DatabaseSync|undefined;
  try {
   db=new DatabaseSync(join(input.host.privateDataRoot,'world.sqlite'),{readOnly:true});
   if(input.oauth.backupBusy)throw new Error('BACKUP_OAUTH_ACTIVE_CANCEL_OR_RETRY');
   if(input.access.backupBusy)throw new Error('BACKUP_ACCESS_CHECK_ACTIVE_CANCEL_OR_RETRY');
   if(input.preflight.backupBusy)throw new Error('BACKUP_PREFLIGHT_ACTIVE_CANCEL_OR_RETRY');
   if(input.forks)releases.push(await input.forks.suspendAdmissions());
   else if(db.prepare("SELECT 1 FROM fork_jobs WHERE state IN ('staging','failed') LIMIT 1").get())throw new Error('BACKUP_FORK_BARRIER_UNAVAILABLE');
   const runRows=db.prepare('SELECT run_id FROM world_runs ORDER BY run_id LIMIT 100001').all();
   if(runRows.length>100000)throw new Error('BACKUP_RUN_LIMIT');
   const runIds=runRows.map(row=>z.strictObject({run_id:RunIdSchema}).parse(row).run_id);
   for(const runId of runIds){
    const state=input.host.journal.readWorldLifecycle({runId});if(state===undefined)throw new Error('BACKUP_RUN_MISSING');
    if(state.lifecycle==='running'){
     const result=RunLifecycleCommandResultSchema.parse(input.host.journal.applyRunLifecycleCommand({runId,
      principalId:'local-operator',idempotencyKey:randomUUID(),expectedLifecycleRevision:state.lifecycleRevision,
      expectedConfigRevision:state.configRevision,expectedWorldRevision:state.worldRevision,command:{kind:'pause'}}));
     if(result.kind!=='updated'&&result.kind!=='existing')throw new Error('BACKUP_PAUSE_CONFLICT');
    }
    if(input.host.journal.readActiveRunStepJob({runId})!==undefined)input.host.journal.interruptRunStepJob({runId});
   }
   if(input.representation)releases.push(await input.representation.suspendAdmissions(runIds));
   if(input.deliveries)releases.push(await input.deliveries.suspendAdmissions());
   releases.push(await input.voice.suspendAdmissions());
   // Admission remains closed: these observations cannot become stale via HTTP starts.
   if(input.oauth.backupBusy||input.access.backupBusy||input.preflight.backupBusy)throw new Error('BACKUP_ADMINISTRATIVE_WORK_CHANGED');
   const artifacts=new Map<string,{path:string;kind:'sqlite'|'session'|'media'|ForkBackupArtifact['kind']}>();
   function add(path:string,kind:'sqlite'|'session'|'media'|ForkBackupArtifact['kind']){
    const allowed=BackupPathSchema.parse(path);if(artifacts.size>=100000&&!artifacts.has(allowed))throw new Error('BACKUP_ARTIFACT_LIMIT');
    const previous=artifacts.get(allowed);if(previous&&previous.kind!==kind)throw new Error('BACKUP_ARTIFACT_KIND_CONFLICT');
    artifacts.set(allowed,{path:allowed,kind});
   }
   function sessionPath(raw:unknown,runId?:string,owner?:string){
    const absolute=z.string().min(1).parse(raw);if(!isAbsolute(absolute))throw new Error('BACKUP_SESSION_PATH_INVALID');
    const path=relative(input.host.privateDataRoot,absolute);const allowed=BackupPathSchema.parse(path);
    if(!allowed.endsWith('.jsonl')||(runId!==undefined&&!allowed.startsWith(`runs/${runId}/`))||(owner!==undefined&&!allowed.startsWith(`runs/${runId}/${owner}/sessions/`)))throw new Error('BACKUP_SESSION_SCOPE_INVALID');
    if(!existsSync(absolute))throw new Error('BACKUP_REGISTERED_SESSION_MISSING');
    add(allowed,'session');
   }
   const actorRows=db.prepare('SELECT run_id,actor_id FROM world_prepared_contexts UNION SELECT run_id,actor_id FROM experiences LIMIT 100001').all();
   if(actorRows.length>100000)throw new Error('BACKUP_ARTIFACT_LIMIT');
   for(const row of actorRows){
     const actor=z.strictObject({run_id:RunIdSchema,actor_id:CharacterIdSchema}).parse(row);
     const path=`runs/${actor.run_id}/actors/${actor.actor_id}/memory.sqlite`;
     if(existsSync(join(input.host.privateDataRoot,path)))add(path,'sqlite');
     else if(db.prepare('SELECT 1 FROM memory_receipts r JOIN experiences e ON e.experience_id=r.experience_id WHERE e.run_id=? AND e.actor_id=? LIMIT 1').get(actor.run_id,actor.actor_id))throw new Error('BACKUP_MEMORY_WITH_RECEIPT_MISSING');
   }
   const actorSessions=db.prepare('SELECT run_id,actor_id,session_path FROM actor_pi_sessions LIMIT 100001').all();if(actorSessions.length>100000)throw new Error('BACKUP_ARTIFACT_LIMIT');
   for(const row of actorSessions){
    const record=z.strictObject({run_id:RunIdSchema,actor_id:CharacterIdSchema,session_path:z.string()}).parse(row);sessionPath(record.session_path,record.run_id,`actors/${record.actor_id}`);
   }
   // Retain all registered role generations and forensic actor candidates/checkpoints,
   // including files no longer selected as the actor's current session.
   for(const [table,jobs,role] of [['continuista_sessions','continuista_jobs','continuista'],['administrative_sessions','administrative_jobs','administrative']]){
    const rows=db.prepare(`SELECT s.payload_json,s.payload_hash,s.job_id,s.generation,j.run_id FROM ${table} s JOIN ${jobs} j ON j.job_id=s.job_id AND j.generation=s.generation LIMIT 100001`).all();if(rows.length>100000)throw new Error('BACKUP_ARTIFACT_LIMIT');
    for(const row of rows){const record=z.strictObject({payload_json:z.string(),payload_hash:z.string(),job_id:z.uuid(),generation:z.number(),run_id:RunIdSchema}).parse(row);if(hash(record.payload_json)!==record.payload_hash)throw new Error('BACKUP_SESSION_METADATA_TAMPERED');const session=z.object({sessionPath:z.string(),jobId:z.uuid(),generation:z.number(),role:z.string().optional()}).parse(JSON.parse(record.payload_json));if(session.jobId!==record.job_id||session.generation!==record.generation)throw new Error('BACKUP_SESSION_SCOPE_INVALID');const ownerRole=role==='administrative'?physicalRole(session.role):role;sessionPath(session.sessionPath,record.run_id,`roles/${ownerRole}`);}
   }
   for(const table of ['actor_job_checkpoints','continuista_checkpoints','administrative_checkpoints']){
    const rows=db.prepare(`SELECT payload_json,checkpoint_hash FROM ${table} LIMIT 100001`).all();if(rows.length>100000)throw new Error('BACKUP_ARTIFACT_LIMIT');
    for(const row of rows){
      const record=z.strictObject({payload_json:z.string(),checkpoint_hash:z.string()}).parse(row);if(hash(record.payload_json)!==record.checkpoint_hash)throw new Error('BACKUP_CHECKPOINT_TAMPERED');const raw:unknown=JSON.parse(record.payload_json);
      if(table==='actor_job_checkpoints'){const checkpoint=ActorJobCheckpointSchema.parse(raw);if(checkpoint.snapshot.sessionPath!==null)sessionPath(checkpoint.snapshot.sessionPath,checkpoint.execution.runId,`actors/${checkpoint.execution.actorId}`);}
      else if(table==='continuista_checkpoints'){const checkpoint=z.object({execution:ContinuistaJobExecutionSchema,snapshot:ActorJobCheckpointSchema.shape.snapshot}).parse(raw);if(checkpoint.snapshot.sessionPath!==null)sessionPath(checkpoint.snapshot.sessionPath,checkpoint.execution.actorExecution.runId,'roles/continuista');}
      else{const checkpoint=AdministrativeCheckpointSchema.parse(raw);if(checkpoint.snapshot.sessionPath!==null)sessionPath(checkpoint.snapshot.sessionPath,checkpoint.execution.scope.runId,`roles/${physicalRole(checkpoint.execution.role)}`);}
    }
   }
   const candidates=db.prepare('SELECT run_id,actor_id,session_path,canonical_payload,payload_hash FROM actor_pi_candidates LIMIT 100001').all();if(candidates.length>100000)throw new Error('BACKUP_ARTIFACT_LIMIT');
   for(const row of candidates){
    const record=z.strictObject({run_id:RunIdSchema,actor_id:CharacterIdSchema,session_path:z.string(),canonical_payload:z.string(),payload_hash:z.string()}).parse(row);
    if(hash(record.canonical_payload)!==record.payload_hash)throw new Error('BACKUP_SESSION_METADATA_TAMPERED');const candidate=z.object({runId:RunIdSchema,actorId:CharacterIdSchema,base:z.object({sessionPath:z.string()})}).parse(JSON.parse(record.canonical_payload));if(candidate.runId!==record.run_id||candidate.actorId!==record.actor_id||candidate.base.sessionPath!==record.session_path)throw new Error('BACKUP_SESSION_SCOPE_INVALID');sessionPath(record.session_path,record.run_id,`actors/${record.actor_id}`);
   }
   for(const artifact of forkBackupArtifacts({host:input.host,database:db}))add(artifact.path,artifact.kind);
   for(const artifact of input.voice.backupArtifacts())add(artifact.path,artifact.kind);
   db.close();db=undefined;let released=false;
   return {artifacts:[...artifacts.values()].sort((a,b)=>a.path.localeCompare(b.path)),release(){if(released)return;released=true;for(const release of releases.reverse())release();releaseHttp();}};
  }catch(error){try{db?.close();}finally{try{for(const release of releases.reverse())release();}finally{releaseHttp();}}throw error;}
 }};
}
