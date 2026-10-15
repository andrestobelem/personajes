import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {setup,canonical} from './fixtures/continuista.ts';
import {RevisionSchema} from '../src/domain/values.ts';
import {openJournal} from '../src/adapters/journal.ts';
import {BackupForkSourceSchema} from '../src/application/fork-source.ts';
import {prepareForkState} from '../src/application/prepare-fork-state.ts';
import {prepareForkDramaticSeed} from '../src/application/fork-dramatic-seed.ts';
import {prepareForkConfiguration} from '../src/application/fork-configuration.ts';
import {ForkPublicationPackageSchema} from '../src/application/fork-package.ts';
import {hashContinuistaValue} from '../src/domain/continuista-review.ts';

async function fixture(){
 const f=await setup();const initial=f.configuration.worldSnapshot;
 const read=f.journal.readForkSource({runId:initial.runId,commitIndex:0,worldRevision:initial.revision,worldSeq:initial.seq});assert.equal(read.kind,'found');if(read.kind!=='found')assert.fail();
 // The source rows are read through the actual journal authority. The bundle header
 // is an explicit synthetic fixture; bundle verification itself belongs to the host port.
 const {kind,...data}=read;void kind;
 const source=BackupForkSourceSchema.parse({kind:'backup-fork-source',backup:{backupId:randomUUID(),lineageId:randomUUID(),manifestHash:'a'.repeat(64),journalHash:'b'.repeat(64)},...data});
 const operationId=randomUUID();const principalId='backup-fork-test';
 const transformed=prepareForkState({snapshot:data.snapshot,configuration:data.configuration,cuts:data.cuts,targetRunId:randomUUID()});const {state,seed}=prepareForkDramaticSeed({structure:source.structure,state:transformed});
 const prepared=prepareForkConfiguration({sourceConfiguration:source.configuration,state,name:'Fork desde archivo',operationId,principalId,recordedAt:'2026-10-16T00:00:00Z'});
 const packet=ForkPublicationPackageSchema.parse({kind:'fork-publication-package',state,...prepared,dramaticSeed:seed});
 const request={operationId,principalId,idempotencyKey:randomUUID(),name:packet.configuration.name,reason:'Derivar de una copia verificada.',package:packet};
 const path=join(f.directory,'destination.sqlite');let journal=openJournal({path});
 const lookup={operationId,principalId};
 const artifacts={kind:'fork-artifacts',operationId,targetRunId:state.targetRunId,packageHash:hashContinuistaValue(packet),actors:state.actors.map(actor=>({actorId:actor.actorId,sha256:'c'.repeat(64),byteLength:1}))};
 return {source,packet,request,lookup,path,artifacts,live:f.journal,get journal(){return journal;},
  begin(){const result=journal.beginForkJobFromBackup({...request,source});assert.equal(result.kind,'created');if(result.kind!=='created')assert.fail();return result.job;},
  project(){for(const [index,frozen] of packet.state.actors.flatMap(actor=>actor.experiences).entries())journal.recordForkProjection({...lookup,receipt:{memoryId:`01ARZ3NDEKTSV4RRFFQ69G5F${String(index).padStart(2,'0')}`,experienceId:frozen.envelope.experienceId,runId:frozen.envelope.runId,actorId:frozen.envelope.actorId,worldSeq:frozen.envelope.worldSeq,canonicalPayload:frozen.canonicalPayload,payloadHash:frozen.payloadHash}});},
  mutate(fn:(db:DatabaseSync)=>void){const db=new DatabaseSync(path);try{fn(db);}finally{db.close();}},
  reopen(){journal.close();journal=openJournal({path});},
  close(){journal.close();f.close();},
 };
}

test('fuente backup congelada permite publicar sin corrida padre viva y conserva origen público seguro',async()=>{
 const f=await fixture();try{
  assert.equal(f.journal.loadWorld({runId:f.source.snapshot.runId}),undefined);
  const job=f.begin();assert.deepEqual(job.backupOrigin,f.source.backup);assert.equal(f.journal.loadWorld({runId:job.targetRunId}),undefined);
  f.project();const ready=f.journal.publishForkJob({...f.lookup,expectedRevision:job.revision,artifacts:f.artifacts});assert.equal(ready.state,'ready');assert.deepEqual(ready.backupOrigin,f.source.backup);
  assert.deepEqual(f.journal.loadWorld({runId:job.targetRunId}),f.packet.state.snapshot);assert.deepEqual(f.journal.readDramaticStructure({runId:job.targetRunId}),f.packet.dramaticSeed.structure);
  f.mutate(db=>{assert.equal(db.prepare('SELECT COUNT(*) count FROM world_runs').get()?.count,1);assert.equal(db.prepare('SELECT COUNT(*) count FROM fork_backup_sources').get()?.count,1);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);});
 }finally{f.close();}
});

test('recuperación y retry usan fuente congelada aunque no haya padre y devuelven el mismo paquete',async()=>{
 const f=await fixture();try{
  const job=f.begin();f.project();const failed=f.journal.failForkJob({...f.lookup,expectedRevision:job.revision,code:'FORK_INTERRUPTED'});assert.ok(failed);f.reopen();
  assert.deepEqual(f.journal.readForkPackage(f.lookup),f.packet);const retried=f.journal.retryForkJob({...f.lookup,expectedRevision:failed.revision,idempotencyKey:randomUUID()});assert.equal(retried.kind,'updated');if(retried.kind!=='updated')assert.fail();
  assert.deepEqual(f.journal.listStagingForkJobs(),[retried.job]);assert.deepEqual(f.journal.beginForkJobFromBackup({...f.request,source:f.source}),{kind:'existing',job:retried.job});
  const ready=f.journal.publishForkJob({...f.lookup,expectedRevision:retried.job.revision,artifacts:f.artifacts});assert.equal(ready.state,'ready');f.reopen();assert.deepEqual(f.journal.readForkJob(f.lookup),ready);
 }finally{f.close();}
});

test('fuente viva divergente no afecta validación ni publicación desde backup',async()=>{
 const f=await fixture();try{
  const before=f.live.loadWorld({runId:f.source.snapshot.runId});assert.ok(before);
  const configuration=f.source.configuration;const prepared=configuration.roster.preparedCharacters[0];assert.ok(prepared);
  f.journal.registerWorldRun({initialSnapshot:configuration.worldSnapshot,configurationRevision:configuration.configRevision,configuration,lifecycle:'running',continuityFence:{kind:'prepared-contexts',atWorldSeq:configuration.worldSnapshot.seq,contexts:[{actorId:prepared.characterId,continuityId:prepared.continuity.continuityId,continuityRevision:prepared.continuity.revision,continuityContentHash:prepared.continuity.contentHash,identityVersion:prepared.identityVersion,preparedContextHash:hashContinuistaValue(prepared)}]}});
  const job=f.begin();f.project();f.mutate(db=>db.prepare('UPDATE world_runs SET configuration_hash=? WHERE run_id=?').run('f'.repeat(64),f.source.snapshot.runId));
  assert.equal(f.journal.publishForkJob({...f.lookup,expectedRevision:job.revision,artifacts:f.artifacts}).state,'ready');
 }finally{f.close();}
});

test('idempotencia distingue backup, live y metadatos de bundles distintos en ambos sentidos',async()=>{
 const f=await fixture();try{
  const backup=f.begin();assert.deepEqual(f.journal.beginForkJob(f.request),{kind:'idempotencyConflict'});
  assert.deepEqual(f.journal.beginForkJobFromBackup({...f.request,source:{...f.source,backup:{...f.source.backup,manifestHash:'d'.repeat(64)}}}),{kind:'idempotencyConflict'});
  assert.equal(f.journal.readForkJob(f.lookup)?.targetRunId,backup.targetRunId);
  const live=f.live.beginForkJob(f.request);assert.equal(live.kind,'created');assert.deepEqual(f.live.beginForkJobFromBackup({...f.request,source:f.source}),{kind:'idempotencyConflict'});
 }finally{f.close();}
});

for(const corruption of ['hash','missing','origin','payload'] as const)test(`fuente backup ${corruption} se rechaza al leer y publicar sin target parcial`,async()=>{
 const f=await fixture();try{
  const job=f.begin();f.project();f.mutate(db=>{
   if(corruption==='hash')db.prepare('UPDATE fork_backup_sources SET source_hash=?').run('f'.repeat(64));
   if(corruption==='missing')db.exec('DELETE FROM fork_backup_sources');
   if(corruption==='origin'){
    const changed={...f.source,backup:{...f.source.backup,backupId:randomUUID()}};db.prepare('UPDATE fork_backup_sources SET source_json=?,source_hash=?').run(canonical(changed),hashContinuistaValue(changed));
   }
   if(corruption==='payload')db.prepare("UPDATE fork_backup_sources SET source_json='{}'").run();
  });
  assert.throws(()=>f.journal.readForkJob(f.lookup),/backup|Backup|source|Invalid|Unrecognized|invalid/);
  assert.throws(()=>f.journal.publishForkJob({...f.lookup,expectedRevision:job.revision,artifacts:f.artifacts}),/./);assert.equal(f.journal.loadWorld({runId:job.targetRunId}),undefined);
 }finally{f.close();}
});

test('guardar fuente y job es atómico y no deja staging incompleto si falla el archivo congelado',async()=>{
 const f=await fixture();try{
  f.mutate(db=>db.exec("CREATE TRIGGER fail_backup_source BEFORE INSERT ON fork_backup_sources BEGIN SELECT RAISE(ABORT,'forced-backup-source'); END"));
  assert.throws(()=>f.journal.beginForkJobFromBackup({...f.request,source:f.source}),/forced-backup-source/);assert.equal(f.journal.readForkJob(f.lookup),undefined);
  f.mutate(db=>{assert.equal(db.prepare('SELECT COUNT(*) count FROM fork_jobs').get()?.count,0);assert.equal(db.prepare('SELECT COUNT(*) count FROM fork_job_history').get()?.count,0);db.exec('DROP TRIGGER fail_backup_source');});
  assert.equal(f.begin().state,'staging');
 }finally{f.close();}
});

for(const invalid of ['snapshot','configuration','actors','frozen','date','reference','source'] as const)test(`schema backup rechaza frontera privada inválida: ${invalid}`,async()=>{
 const f=await fixture();try{
  const source=structuredClone(f.source);
  if(invalid==='snapshot')source.snapshot.revision=RevisionSchema.parse(source.snapshot.revision+1);
  if(invalid==='configuration')source.configuration.name='Otra configuración';
  const cut=source.cuts.find(actor=>actor.experiences.length>0);assert.ok(cut);const frozen=cut.experiences[0];assert.ok(frozen);
  if(invalid==='frozen')frozen.canonicalPayload='{}';
  if(invalid==='date'){const changed={...frozen.envelope,receivedAt:source.snapshot.clock.instant+1};Object.assign(frozen,{envelope:changed,canonicalPayload:canonical(changed),payloadHash:hashContinuistaValue(changed)});}
  if(invalid==='reference'){const changed={...frozen.envelope,kind:'inference',basedOn:[randomUUID()]};Object.assign(frozen,{envelope:changed,canonicalPayload:canonical(changed),payloadHash:hashContinuistaValue(changed)});}
  if(invalid==='source')cut.source.commitIndex=RevisionSchema.parse(cut.source.commitIndex+1);
  if(invalid==='actors')source.cuts=source.cuts.slice(1);
  assert.throws(()=>BackupForkSourceSchema.parse(source),/./);
 }finally{f.close();}
});
