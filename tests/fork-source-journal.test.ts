import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setup,actorId,canonical } from './fixtures/continuista.ts';
import { prepareForkState } from '../src/application/prepare-fork-state.ts';
import { freezeExperience } from '../src/application/experience-envelope.ts';
import { openJournal } from '../src/adapters/journal.ts';
import { WorldContinuityFenceSchema } from '../src/domain/world-journal.ts';
import { HashSchema } from '../src/domain/values.ts';
import { hashContinuistaValue } from '../src/domain/continuista-review.ts';

function initialRequest(f:Awaited<ReturnType<typeof setup>>) {
  const snapshot=f.configuration.worldSnapshot;
  return {runId:snapshot.runId,commitIndex:0,worldRevision:snapshot.revision,worldSeq:snapshot.seq};
}
function inspect(f:Awaited<ReturnType<typeof setup>>,operation:(db:DatabaseSync)=>void) {
  const db=new DatabaseSync(join(f.directory,'journal.sqlite'));try{operation(db);}finally{db.close();}
}
function durableRows(f:Awaited<ReturnType<typeof setup>>) {
  const db=new DatabaseSync(join(f.directory,'journal.sqlite'));
  try{return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>({
    table:row.name,rows:db.prepare(`SELECT * FROM "${String(row.name).replaceAll('"','""')}" ORDER BY rowid`).all(),
  }));}finally{db.close();}
}

test('fuente host exacta de SQLite alimenta prepareForkState y no modifica ninguna tabla ni publica target',async()=>{
  const f=await setup();try{
    const before=durableRows(f);const request=initialRequest(f);const source=f.journal.readForkSource(request);
    assert.equal(source.kind,'found');if(source.kind!=='found')assert.fail();
    assert.deepEqual(source.snapshot,f.configuration.worldSnapshot);assert.deepEqual(source.configuration,f.configuration);
    assert.deepEqual(source.cuts.map(cut=>cut.actorId).sort(),source.snapshot.entities.flatMap(entity=>entity.kind==='character'?[entity.characterId]:[]).sort());
    assert.ok(source.cuts.some(cut=>cut.actorId==='oculto-prueba'));
    const targetRunId=randomUUID();const prepared=prepareForkState({snapshot:source.snapshot,configuration:source.configuration,cuts:source.cuts,targetRunId});
    assert.equal(prepared.targetRunId,targetRunId);assert.equal(f.journal.loadWorld({runId:targetRunId}),undefined);
    assert.deepEqual(durableRows(f),before);
  }finally{f.close();}
});

test('fuente histórica conserva corte previo a entrega y a cambios subjetivos posteriores del mismo seq',async()=>{
  const f=await setup();try{
    const initial=f.journal.readForkSource(initialRequest(f));assert.equal(initial.kind,'found');
    const world=f.journal.loadWorld({runId:f.configuration.runId});assert.ok(world);
    const request={runId:world.runId,commitIndex:1,worldRevision:world.revision,worldSeq:world.seq};
    const historical=f.journal.readForkSource(request);assert.equal(historical.kind,'found');if(historical.kind!=='found')assert.fail();
    const own=historical.cuts.find(cut=>cut.actorId===actorId);assert.ok(own);assert.deepEqual(own.experiences,[],'entrega posterior al commit no entra retroactivamente');
    f.journal.recordExperience(freezeExperience({schemaVersion:1,experienceId:randomUUID(),runId:world.runId,actorId,kind:'belief',content:'Nota admitida después del corte.',
      sourceRefs:[],fictitiousAt:world.clock.instant,receivedAt:world.clock.instant,worldSeq:world.seq,confidence:1,revision:0,predecessor:{kind:'initial'},basedOn:[]}));
    assert.deepEqual(f.journal.readForkSource(request),historical);assert.deepEqual(f.journal.readForkSource(initialRequest(f)),initial);
    const reopened=openJournal({path:join(f.directory,'journal.sqlite')});try{assert.deepEqual(reopened.readForkSource(request),historical);}finally{reopened.close();}
  }finally{f.close();}
});

test('fuente entre escenas conserva cierre exacto sin abrir una escena',async()=>{
  const f=await setup();const journal=openJournal({path:join(f.directory,'between-scenes.sqlite')});try{
    const configuration=f.configuration;const world=configuration.worldSnapshot;const prepared=configuration.roster.preparedCharacters[0];assert.ok(prepared);
    journal.registerWorldRun({initialSnapshot:world,configuration,configurationRevision:configuration.configRevision,lifecycle:'running',
      continuityFence:{kind:'prepared-contexts',atWorldSeq:world.seq,contexts:[{actorId:prepared.characterId,continuityId:prepared.continuity.continuityId,
        continuityRevision:prepared.continuity.revision,continuityContentHash:prepared.continuity.contentHash,identityVersion:prepared.identityVersion,preparedContextHash:hashContinuistaValue(prepared)}]}});
    const result=journal.applyDramaticStructureCommand({runId:world.runId,principalId:'synthetic-fork-source',operationId:randomUUID(),idempotencyKey:randomUUID(),expectedWorldRevision:world.revision,expectedStructureRevision:0,
      command:{kind:'closeScene',sceneId:world.activeSceneId,reason:'Cierre sintético de fuente histórica.'}});
    assert.equal(result.kind,'stored');const snapshot=journal.loadWorld({runId:world.runId});assert.ok(snapshot);
    const source=journal.readForkSource({runId:world.runId,commitIndex:1,worldRevision:snapshot.revision,worldSeq:snapshot.seq});assert.equal(source.kind,'found');
    if(source.kind==='found'){assert.equal(source.snapshot.activeSceneId,null);const targetRunId=randomUUID();const prepared=prepareForkState({snapshot:source.snapshot,configuration:source.configuration,cuts:source.cuts,targetRunId});assert.equal(prepared.snapshot.activeSceneId,null);}
  }finally{journal.close();f.close();}
});

for(const fault of ['checkpoint-missing','actor-missing','cut-hash','snapshot-hash','configuration-hash','continuity-fence'] as const)test(`fuente rechaza ${fault} sin sustituir estado privado actual`,async()=>{
  const f=await setup();try{
    inspect(f,db=>{
      if(fault==='checkpoint-missing')db.exec('DELETE FROM actor_state_cuts WHERE commit_index=0; DELETE FROM actor_state_cut_batches WHERE commit_index=0');
      if(fault==='actor-missing')db.prepare("DELETE FROM actor_state_cuts WHERE commit_index=0 AND actor_id='oculto-prueba'").run();
      if(fault==='cut-hash')db.prepare("UPDATE actor_state_cuts SET payload_hash=? WHERE commit_index=0 AND actor_id='oculto-prueba'").run('f'.repeat(64));
      if(fault==='snapshot-hash')db.prepare('UPDATE world_runs SET initial_snapshot_hash=?').run('f'.repeat(64));
      if(fault==='continuity-fence'){const row=db.prepare('SELECT continuity_fence_json FROM world_runs').get();assert.ok(row);const fence=WorldContinuityFenceSchema.parse(JSON.parse(String(row.continuity_fence_json)));assert.ok(fence.contexts[0]);fence.contexts[0].preparedContextHash=HashSchema.parse('f'.repeat(64));db.prepare('UPDATE world_runs SET continuity_fence_json=?').run(canonical(fence));}
      if(fault==='configuration-hash')db.prepare('UPDATE world_runs SET configuration_hash=?').run('f'.repeat(64));
    });
    assert.deepEqual(f.journal.readForkSource(initialRequest(f)),{kind:'unavailable',reason:fault==='checkpoint-missing'?'checkpoint-not-recorded':'invalid-cut'});
  }finally{f.close();}
});

test('fuente exige request exacto y propietario de snapshot/configuración',async()=>{
  const f=await setup();try{
    const request=initialRequest(f);
    assert.deepEqual(f.journal.readForkSource({...request,runId:randomUUID()}),{kind:'missing'});
    for(const mismatch of [{worldRevision:request.worldRevision+1},{worldSeq:request.worldSeq+1},{commitIndex:999}])assert.deepEqual(f.journal.readForkSource({...request,...mismatch}),{kind:'unavailable',reason:'invalid-cut'});
    assert.throws(()=>f.journal.readForkSource({...request,actorId}),/./);assert.throws(()=>f.journal.readForkSource({...request,commitIndex:-1}),/./);
    inspect(f,db=>{const configuration={...f.configuration,runId:randomUUID(),worldSnapshot:{...f.configuration.worldSnapshot,runId:randomUUID()}};db.prepare('UPDATE world_runs SET configuration_json=?,configuration_hash=?').run(JSON.stringify(configuration),hashContinuistaValue(configuration));});
    assert.deepEqual(f.journal.readForkSource(request),{kind:'unavailable',reason:'configuration-not-ready'});
  }finally{f.close();}
});

test('configuración legada válida del journal sin Ready es explícitamente no disponible',async()=>{
  const f=await setup();try{
    inspect(f,db=>{const configuration={kind:'historical-unprepared-fixture'};db.prepare('UPDATE world_runs SET configuration_json=?,configuration_hash=?').run(JSON.stringify(configuration),hashContinuistaValue(configuration));});
    assert.deepEqual(f.journal.readForkSource(initialRequest(f)),{kind:'unavailable',reason:'configuration-not-ready'});
  }finally{f.close();}
});

test('migración real de fuente legada no inventa checkpoint para habilitar fork',async()=>{
  const f=await setup();try{
    inspect(f,db=>db.exec('DROP TABLE actor_state_cuts; DROP TABLE actor_state_cut_batches; DROP TABLE IF EXISTS fork_projection_receipts; DROP TABLE IF EXISTS fork_job_history; DROP TABLE IF EXISTS fork_dramatic_seeds; DROP TABLE IF EXISTS fork_job_retries; DROP TABLE IF EXISTS fork_backup_sources; DROP TABLE IF EXISTS fork_jobs; DROP TABLE IF EXISTS identity_promotion_receipts; DROP TABLE IF EXISTS actor_job_identity_bindings; DROP TABLE IF EXISTS actor_pi_session_archives; DROP TABLE IF EXISTS actor_identity_session_bindings; DROP TABLE IF EXISTS actor_identity_epochs; DROP TABLE IF EXISTS configurator_http_operations; DROP TABLE IF EXISTS configurator_consents; DROP TABLE IF EXISTS configurator_operations; DROP TABLE IF EXISTS configurator_candidates; DROP TABLE IF EXISTS configurator_checkpoints; DROP TABLE IF EXISTS configurator_sessions; DROP TABLE IF EXISTS configurator_generations; DROP TABLE IF EXISTS configurator_jobs; DROP TABLE IF EXISTS run_configuration_revisions; DELETE FROM schema_version WHERE version IN(34,35,36,37,38,39,40)'));
    const reopened=openJournal({path:join(f.directory,'journal.sqlite')});try{
      assert.deepEqual(reopened.readForkSource(initialRequest(f)),{kind:'unavailable',reason:'checkpoint-not-recorded'});
      inspect(f,db=>assert.equal(db.prepare('SELECT COUNT(*) count FROM actor_state_cut_batches').get()?.count,0));
    }finally{reopened.close();}
  }finally{f.close();}
});
