import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openJournal } from '../src/adapters/journal.ts';
import { ReadyRunConfigurationSchema, readyConfigurationAtSnapshot } from '../src/application/production-preflight.ts';
import { RevisionSchema } from '../src/domain/values.ts';
import { WorldSnapshotSchema } from '../src/domain/world-schema.ts';
import { canonical, setup } from './fixtures/continuista.ts';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
type Fixture=Awaited<ReturnType<typeof setup>>;
function inspect<T>(f:Fixture,body:(db:DatabaseSync)=>T){const db=new DatabaseSync(join(f.directory,'journal.sqlite'));try{return body(db);}finally{db.close();}}
function initial(f:Fixture){return {runId:f.configuration.runId,commitIndex:0,worldRevision:f.configuration.worldSnapshot.revision,worldSeq:f.configuration.worldSnapshot.seq};}
function sourceRows(f:Fixture){return inspect(f,db=>({run:db.prepare('SELECT * FROM world_runs').all(),commits:db.prepare('SELECT * FROM world_commits').all(),batches:db.prepare('SELECT * FROM actor_state_cut_batches').all(),cuts:db.prepare('SELECT * FROM actor_state_cuts').all()}));}

// Test-only trusted transaction fixture, deliberately inaccessible from the host API.
// It models the archive/activation a later approved promotion transaction must do.
function installHistory(f:Fixture,administrativeCommit=false){
 const current=f.journal.loadWorld({runId:f.configuration.runId});assert.ok(current);
 const promoted=f.configuration.roster.preparedCharacters[0];assert.ok(promoted);
 const preparedCharacters=f.configuration.roster.preparedCharacters.map(actor=>administrativeCommit&&actor.characterId===promoted.characterId?{...actor,identityVersion:RevisionSchema.parse(actor.identityVersion+1)}:actor);
 const snapshot=administrativeCommit?WorldSnapshotSchema.parse({...current,revision:current.revision+1,entities:current.entities.map(entity=>entity.kind==='character'&&entity.characterId===promoted.characterId?{...entity,preparation:{...entity.preparation,identityVersion:promoted.identityVersion+1}}:entity)}):current;
 const next=readyConfigurationAtSnapshot(ReadyRunConfigurationSchema.parse({...f.configuration,configRevision:f.configuration.configRevision+1,name:'Effective configuration at activation',
   roster:{...f.configuration.roster,preparedCharacters},preparedActorFences:f.configuration.preparedActorFences.map(actor=>({...actor,identityVersion:preparedCharacters.find(prepared=>prepared.characterId===actor.characterId)?.identityVersion??actor.identityVersion}))}),snapshot);
 inspect(f,db=>{
  const head=db.prepare('SELECT * FROM world_runs').get();assert.ok(head);assert.equal(typeof head.continuity_fence_json,'string');
  const nextFence={kind:'prepared-contexts',atWorldSeq:snapshot.seq,contexts:snapshot.entities.flatMap(entity=>{
   if(entity.kind!=='character'||entity.preparation.kind!=='prepared')return [];const prepared=preparedCharacters.find(actor=>actor.characterId===entity.characterId);assert.ok(prepared);
   return [{actorId:prepared.characterId,continuityId:prepared.continuity.continuityId,continuityRevision:prepared.continuity.revision,continuityContentHash:prepared.continuity.contentHash,identityVersion:prepared.identityVersion,preparedContextHash:hash(canonical(prepared))}];
  })};
  const activationCommit=Number(head.commit_index)+(administrativeCommit?1:0);
  function append(commit:number,revision:number,json:string,fence:string,activationHash:string){
   const record={run_id:f.configuration.runId,effective_commit_index:commit,configuration_revision:revision,configuration_json:json,configuration_hash:hash(json),continuity_fence_json:fence,continuity_fence_hash:hash(fence),activation_snapshot_hash:activationHash};
   db.prepare('INSERT INTO run_configuration_revisions VALUES(?,?,?,?,?,?,?,?,?)').run(record.run_id,commit,revision,json,record.configuration_hash,fence,record.continuity_fence_hash,activationHash,hash(canonical(record)));
  }
  db.exec('BEGIN IMMEDIATE');try{
   append(0,f.configuration.configRevision,String(head.configuration_json),String(head.continuity_fence_json),String(head.initial_snapshot_hash));
   if(administrativeCommit){
    db.prepare('INSERT INTO world_commits VALUES(?,?,?,?,?,?,?,?,?)').run(f.configuration.runId,activationCommit,'test-trusted-identity-activation',randomUUID(),snapshot.revision,snapshot.seq,canonical(snapshot),hash(canonical(snapshot)),Date.now());
    db.prepare('UPDATE world_runs SET commit_index=?,world_revision=?,last_seq=?,snapshot_json=?,snapshot_hash=?').run(activationCommit,snapshot.revision,snapshot.seq,canonical(snapshot),hash(canonical(snapshot)));
   }
   append(activationCommit,next.configRevision,canonical(next),canonical(nextFence),hash(canonical(snapshot)));
   db.prepare('UPDATE world_runs SET config_revision=?,configuration_json=?,configuration_hash=?,continuity_fence_json=?').run(next.configRevision,canonical(next),hash(canonical(next)),canonical(nextFence));
   // A genuine future activation captures its cuts last in that same transaction.
   const entries=[];const pendingCuts:{actorId:string;payload:string;cutHash:string}[]=[];
   for(const raw of db.prepare('SELECT actor_id,payload_json FROM actor_state_cuts WHERE commit_index=1 ORDER BY actor_id').all()){
    const cut=JSON.parse(String(raw.payload_json));cut.source.configurationRevision=next.configRevision;cut.source.configurationHash=hash(canonical(next));cut.source.commitIndex=activationCommit;cut.source.worldRevision=snapshot.revision;cut.source.snapshotHash=hash(canonical(snapshot));const payload=canonical(cut);const cutHash=hash(payload);
    if(administrativeCommit)pendingCuts.push({actorId:String(raw.actor_id),payload,cutHash});else db.prepare('UPDATE actor_state_cuts SET payload_json=?,payload_hash=? WHERE commit_index=1 AND actor_id=?').run(payload,cutHash,String(raw.actor_id));entries.push({actorId:raw.actor_id,cutHash});
   }
   const batch=db.prepare('SELECT manifest_json FROM actor_state_cut_batches WHERE commit_index=1').get();assert.ok(batch);const manifest=JSON.parse(String(batch.manifest_json));manifest.source.configurationRevision=next.configRevision;manifest.source.configurationHash=hash(canonical(next));manifest.source.commitIndex=activationCommit;manifest.source.worldRevision=snapshot.revision;manifest.source.snapshotHash=hash(canonical(snapshot));manifest.actors=entries;
   if(administrativeCommit)db.prepare('INSERT INTO actor_state_cut_batches VALUES(?,?,?,?)').run(f.configuration.runId,activationCommit,canonical(manifest),hash(canonical(manifest)));else db.prepare('UPDATE actor_state_cut_batches SET manifest_json=?,manifest_hash=? WHERE commit_index=1').run(canonical(manifest),hash(canonical(manifest)));
   for(const cut of pendingCuts)db.prepare('INSERT INTO actor_state_cuts VALUES(?,?,?,?,?)').run(f.configuration.runId,activationCommit,cut.actorId,cut.payload,cut.cutHash);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 });
 return next;
}

test('v38 no inventa historial y fallback original conserva cortes privados, fuente fork y snapshots byte exactos',async()=>{
 const f=await setup();try{
  const request=initial(f);const source=f.journal.readForkSource(request);assert.equal(source.kind,'found');const before=sourceRows(f);
  inspect(f,db=>{db.exec('DROP TABLE run_configuration_revisions;DELETE FROM schema_version WHERE version=38');});
  const reopened=openJournal({path:join(f.directory,'journal.sqlite')});try{
   const at0=reopened.readRunConfigurationAtCommit({runId:request.runId,commitIndex:0});assert.equal(at0.kind,'found');if(at0.kind!=='found')assert.fail();
   assert.equal(at0.provenance,'original');assert.equal(at0.effectiveCommitIndex,0);assert.deepEqual(at0.configuration,f.configuration);
   assert.deepEqual(reopened.readRunConfigurationAtCommit({runId:request.runId,commitIndex:1}),at0);
   assert.deepEqual(reopened.readForkSource(request),source);assert.deepEqual(sourceRows(f),before);
   assert.equal(inspect(f,db=>db.prepare('SELECT COUNT(*) AS n FROM run_configuration_revisions').get()?.n),0);
  }finally{reopened.close();}
 }finally{f.close();}
});

test('dos configuraciones resuelven el corte propio sin reescribir inicial ni cortes y fork históricos',async()=>{
 const f=await setup();try{
  const request=initial(f);const oldFork=f.journal.readForkSource(request);assert.equal(oldFork.kind,'found');const oldRows=sourceRows(f);const oldConfig=f.journal.readRunConfigurationAtCommit({runId:request.runId,commitIndex:0});
  const next=installHistory(f);const at0=f.journal.readRunConfigurationAtCommit({runId:request.runId,commitIndex:0});const at1=f.journal.readRunConfigurationAtCommit({runId:request.runId,commitIndex:1});assert.equal(at0.kind,'found');assert.equal(at1.kind,'found');if(at0.kind!=='found'||at1.kind!=='found'||oldConfig.kind!=='found')assert.fail();
  assert.deepEqual(at0.configuration,oldConfig.configuration);assert.equal(at0.configurationHash,oldConfig.configurationHash);assert.equal(at0.provenance,'revision');assert.equal(at1.effectiveCommitIndex,1);assert.deepEqual(at1.configuration,next);assert.equal(at1.configurationRevision,next.configRevision);
  assert.deepEqual(f.journal.readForkSource(request),oldFork);
  const snapshot=next.worldSnapshot;const newFork=f.journal.readForkSource({runId:request.runId,commitIndex:1,worldRevision:snapshot.revision,worldSeq:snapshot.seq});assert.equal(newFork.kind,'found');if(newFork.kind!=='found')assert.fail();assert.deepEqual(newFork.configuration,next);assert.ok(newFork.cuts.every(cut=>cut.source.configurationRevision===next.configRevision));
  const newRows=sourceRows(f);assert.deepEqual(newRows.commits,oldRows.commits);assert.deepEqual(newRows.cuts.filter(row=>row.commit_index===0),oldRows.cuts.filter(row=>row.commit_index===0));assert.deepEqual(newRows.batches.filter(row=>row.commit_index===0),oldRows.batches.filter(row=>row.commit_index===0));
  assert.equal(newRows.run[0]?.initial_snapshot_json,oldRows.run[0]?.initial_snapshot_json);assert.equal(newRows.run[0]?.initial_snapshot_hash,oldRows.run[0]?.initial_snapshot_hash);
  const reopened=openJournal({path:join(f.directory,'journal.sqlite')});try{assert.deepEqual(reopened.readRunConfigurationAtCommit({runId:request.runId,commitIndex:1}),at1);assert.deepEqual(reopened.readForkSource(request),oldFork);}finally{reopened.close();}
 }finally{f.close();}
});

test('historial sólo permite append y no ofrece mutación pública de identidad',async()=>{
 const f=await setup();try{installHistory(f);inspect(f,db=>{assert.throws(()=>db.exec('UPDATE run_configuration_revisions SET configuration_revision=99'),/APPEND_ONLY/);assert.throws(()=>db.exec('DELETE FROM run_configuration_revisions'),/APPEND_ONLY/);});}finally{f.close();}
});

test('commits administrativos distintos con el mismo worldSeq conservan identidad y configuración efectivas distintas',async()=>{
 const f=await setup();try{
  const before=f.journal.loadWorld({runId:f.configuration.runId});assert.ok(before);const request={runId:before.runId,commitIndex:1,worldRevision:before.revision,worldSeq:before.seq};
  const sourceBefore=f.journal.readForkSource(request);assert.equal(sourceBefore.kind,'found');const rowsBefore=sourceRows(f);
  const next=installHistory(f,true);const after=f.journal.loadWorld({runId:before.runId});assert.ok(after);
  assert.equal(after.seq,before.seq);assert.equal(after.clock.instant,before.clock.instant);assert.equal(after.revision,before.revision+1);
  assert.deepEqual(f.journal.readForkSource(request),sourceBefore);
  const at1=f.journal.readRunConfigurationAtCommit({runId:before.runId,commitIndex:1});const at2=f.journal.readRunConfigurationAtCommit({runId:before.runId,commitIndex:2});assert.equal(at1.kind,'found');assert.equal(at2.kind,'found');if(at1.kind!=='found'||at2.kind!=='found')assert.fail();
  assert.deepEqual(at1.configuration,f.configuration);assert.deepEqual(at2.configuration,next);assert.equal(at1.configurationRevision+1,at2.configurationRevision);assert.notEqual(at1.configurationHash,at2.configurationHash);
  const sourceAfter=f.journal.readForkSource({runId:after.runId,commitIndex:2,worldRevision:after.revision,worldSeq:after.seq});assert.equal(sourceAfter.kind,'found');if(sourceAfter.kind!=='found'||sourceBefore.kind!=='found')assert.fail();
  const actor=next.roster.preparedCharacters[0];assert.ok(actor);const oldActor=sourceBefore.snapshot.entities.find(entity=>entity.kind==='character'&&entity.characterId===actor.characterId);const newActor=sourceAfter.snapshot.entities.find(entity=>entity.kind==='character'&&entity.characterId===actor.characterId);assert.ok(oldActor?.kind==='character'&&newActor?.kind==='character'&&oldActor.preparation.kind==='prepared'&&newActor.preparation.kind==='prepared');
  assert.equal(newActor.preparation.identityVersion,oldActor.preparation.identityVersion+1);assert.deepEqual(newActor.mind,oldActor.mind);
  const oldCut=sourceBefore.cuts.find(cut=>cut.actorId===actor.characterId);const newCut=sourceAfter.cuts.find(cut=>cut.actorId===actor.characterId);assert.ok(oldCut&&newCut);assert.equal(oldCut.source.worldSeq,newCut.source.worldSeq);assert.notEqual(oldCut.source.commitIndex,newCut.source.commitIndex);assert.notEqual(oldCut.source.configurationHash,newCut.source.configurationHash);
  const rowsAfter=sourceRows(f);assert.deepEqual(rowsAfter.commits.filter(row=>Number(row.commit_index)<=1),rowsBefore.commits);assert.deepEqual(rowsAfter.cuts.filter(row=>Number(row.commit_index)<=1),rowsBefore.cuts);assert.deepEqual(rowsAfter.batches.filter(row=>Number(row.commit_index)<=1),rowsBefore.batches);
  const reopened=openJournal({path:join(f.directory,'journal.sqlite')});try{assert.deepEqual(reopened.readForkSource(request),sourceBefore);assert.deepEqual(reopened.readForkSource({runId:after.runId,commitIndex:2,worldRevision:after.revision,worldSeq:after.seq}),sourceAfter);}finally{reopened.close();}
 }finally{f.close();}
});

test('baseline archivada rechaza fence duplicado aunque payload y hashes sean coherentes',async()=>{
 const f=await setup();try{installHistory(f);inspect(f,db=>{
  db.exec('DROP TRIGGER run_configuration_revisions_no_update');const row=db.prepare('SELECT * FROM run_configuration_revisions WHERE effective_commit_index=0').get();assert.ok(row);
  const fence=JSON.parse(String(row.continuity_fence_json));fence.contexts.push(fence.contexts[0]);row.continuity_fence_json=canonical(fence);row.continuity_fence_hash=hash(String(row.continuity_fence_json));const {record_hash,...record}=row;
  db.prepare('UPDATE run_configuration_revisions SET continuity_fence_json=?,continuity_fence_hash=?,record_hash=? WHERE effective_commit_index=0').run(String(row.continuity_fence_json),String(row.continuity_fence_hash),hash(canonical(record)));
 });assert.deepEqual(f.journal.readRunConfigurationAtCommit({runId:f.configuration.runId,commitIndex:0}),{kind:'unavailable',reason:'invalid-configuration'});assert.deepEqual(f.journal.readForkSource(initial(f)),{kind:'unavailable',reason:'invalid-cut'});
 }finally{f.close();}
});

for(const fault of ['missing-baseline','revision-hole','record-hash','configuration-hash','activation-hash','activation-snapshot','head-mismatch','fence-hash','fence-context','incomplete-fence','snapshot-preparation'] as const)test(`historial ${fault} falla cerrado para config, corte privado y fork`,async()=>{
 const f=await setup();try{
  installHistory(f);inspect(f,db=>{
   db.exec('DROP TRIGGER run_configuration_revisions_no_update;DROP TRIGGER run_configuration_revisions_no_delete');
   if(fault==='missing-baseline')db.exec('DELETE FROM run_configuration_revisions WHERE effective_commit_index=0');
   else{
    const row=db.prepare('SELECT * FROM run_configuration_revisions WHERE effective_commit_index=1').get();assert.ok(row);
    if(fault==='revision-hole')row.configuration_revision=Number(row.configuration_revision)+2;
    if(fault==='record-hash')row.record_hash='f'.repeat(64);
    if(fault==='configuration-hash')row.configuration_hash='f'.repeat(64);
    if(fault==='activation-hash')row.activation_snapshot_hash='f'.repeat(64);
    if(fault==='fence-hash')row.continuity_fence_hash='f'.repeat(64);
    if(fault==='fence-context'||fault==='incomplete-fence'||fault==='snapshot-preparation'){
     const fence=JSON.parse(String(row.continuity_fence_json));
     if(fault==='fence-context')fence.contexts[0].preparedContextHash='f'.repeat(64);
     if(fault==='incomplete-fence')fence.contexts.pop();
     if(fault==='snapshot-preparation'){
      const config=JSON.parse(String(row.configuration_json));const actor=config.roster.preparedCharacters.find((actor:{characterId:string})=>actor.characterId===fence.contexts[0].actorId);assert.ok(actor);actor.identityVersion+=1;const actorFence=config.preparedActorFences.find((item:{characterId:string})=>item.characterId===actor.characterId);assert.ok(actorFence);actorFence.identityVersion=actor.identityVersion;fence.contexts[0].identityVersion=actor.identityVersion;fence.contexts[0].preparedContextHash=hash(canonical(actor));row.configuration_json=canonical(config);row.configuration_hash=hash(String(row.configuration_json));db.prepare('UPDATE world_runs SET configuration_json=?,configuration_hash=?').run(String(row.configuration_json),String(row.configuration_hash));
     }
     row.continuity_fence_json=canonical(fence);row.continuity_fence_hash=hash(String(row.continuity_fence_json));
     db.prepare('UPDATE world_runs SET continuity_fence_json=?').run(String(row.continuity_fence_json));
    }
    if(fault==='activation-snapshot'){
     const config=JSON.parse(String(row.configuration_json));config.worldSnapshot.places[0].description='Wrong activation snapshot';row.configuration_json=canonical(config);row.configuration_hash=hash(String(row.configuration_json));
     db.prepare('UPDATE world_runs SET configuration_json=?,configuration_hash=?').run(String(row.configuration_json),String(row.configuration_hash));
    }
    if(fault==='head-mismatch')db.prepare('UPDATE world_runs SET config_revision=?').run(Number(row.configuration_revision)+1);
    const {record_hash,...record}=row;if(fault!=='record-hash')row.record_hash=hash(canonical(record));
    db.prepare('UPDATE run_configuration_revisions SET configuration_revision=?,configuration_json=?,configuration_hash=?,continuity_fence_json=?,continuity_fence_hash=?,activation_snapshot_hash=?,record_hash=? WHERE effective_commit_index=1').run(Number(row.configuration_revision),String(row.configuration_json),String(row.configuration_hash),String(row.continuity_fence_json),String(row.continuity_fence_hash),String(row.activation_snapshot_hash),String(row.record_hash));
   }
  });
  assert.deepEqual(f.journal.readRunConfigurationAtCommit({runId:f.configuration.runId,commitIndex:0}),{kind:'unavailable',reason:'invalid-configuration'});assert.deepEqual(f.journal.readForkSource(initial(f)),{kind:'unavailable',reason:'invalid-cut'});
  const actor=f.configuration.roster.preparedCharacters[0];assert.ok(actor);assert.deepEqual(f.journal.readActorStateCut({...initial(f),actorId:actor.characterId}),{kind:'unavailable',reason:'invalid-cut'});
 }finally{f.close();}
});

test('config original desconocida mantiene compatibilidad; missing, commit inexistente y request inválido no inventan fuente',async()=>{
 const f=await setup();try{
  const configuration={kind:'legacy-host-configuration',note:'Existing unknown configuration'};inspect(f,db=>{db.prepare('UPDATE world_runs SET configuration_json=?,configuration_hash=?').run(canonical(configuration),hash(canonical(configuration)));});
  const result=f.journal.readRunConfigurationAtCommit({runId:f.configuration.runId,commitIndex:0});assert.equal(result.kind,'found');if(result.kind==='found')assert.deepEqual(result.configuration,configuration);
  assert.deepEqual(f.journal.readRunConfigurationAtCommit({runId:randomUUID(),commitIndex:0}),{kind:'missing'});
  assert.deepEqual(f.journal.readRunConfigurationAtCommit({runId:f.configuration.runId,commitIndex:999}),{kind:'unavailable',reason:'invalid-configuration'});
  assert.throws(()=>f.journal.readRunConfigurationAtCommit({runId:f.configuration.runId,commitIndex:-1}));
 }finally{f.close();}
});
