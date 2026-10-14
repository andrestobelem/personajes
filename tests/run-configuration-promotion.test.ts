import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openJournal } from '../src/adapters/journal.ts';
import { RunDraftPatchSchema } from '../src/domain/world-journal.ts';
import { ReadyRunConfigurationSchema, validateRunConfiguration } from '../src/application/production-preflight.ts';
import { setup } from './fixtures/continuista.ts';

const principalId='host-operator-promotion';
function uuid(value:number){return `00000000-0000-4000-8000-${value.toString(16).padStart(12,'0')}`;}
function configured(value:unknown){return {kind:'configured',value,evidence:{kind:'operator-choice',operatorId:'untrusted-metadata',recordedAt:'1900-01-01T00:00:00Z'}};}
function patchFor(configuration:Awaited<ReturnType<typeof setup>>['configuration']){
  const world={...configuration.worldSnapshot,entities:configuration.worldSnapshot.entities.map((entity)=>entity.kind==='character'?{...entity,mind:{...entity.mind,experiences:[]}}:entity)};
  return RunDraftPatchSchema.parse(Object.fromEntries(Object.entries({name:configuration.name,fictionalAt:configuration.fictionalAt,continuity:configuration.continuity,
    roster:configuration.roster,humanParticipants:configuration.humanParticipants,worldSnapshot:world,dramaticLine:configuration.dramaticLine,
    circadianPolicy:configuration.circadianPolicy,spanishVariety:configuration.spanishVariety,narrationMode:configuration.narrationMode,budget:configuration.budget,
    maxReformulations:configuration.maxReformulations,audio:configuration.audio}).map(([field,value])=>[field,configured(value)])));
}

test('v18 migra draft/operaciones v17, promueve Ready exacto y conserva receipt tras restart y start',async()=>{
  const template=await setup();const directory=mkdtempSync(join(tmpdir(),'personajes-promote-ready-'));const path=join(directory,'journal.sqlite');let journal=openJournal({path});
  try{
    const created=journal.createRunConfigurationDraft({principalId,idempotencyKey:uuid(1),patch:patchFor(template.configuration)});if(created.kind!=='created')assert.fail('Sin draft');
    journal.close();const legacy=new DatabaseSync(path);
    try{legacy.exec(`BEGIN IMMEDIATE;DROP TABLE run_preflight_job_operations;DROP TABLE run_preflight_job_results;DROP TABLE run_preflight_job_history;DROP TABLE run_preflight_jobs;DROP TABLE pi_access_job_operations;DROP TABLE pi_access_job_results;DROP TABLE pi_access_job_history;DROP TABLE pi_access_jobs;DROP TABLE pi_oauth_job_operations;DROP TABLE pi_oauth_job_history;DROP TABLE pi_oauth_jobs;DROP TABLE run_draft_validation_reports;
      CREATE TABLE operations_v17(principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,operation_kind TEXT NOT NULL CHECK(operation_kind IN('create','update')),
        request_hash TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,recorded_at TEXT NOT NULL,PRIMARY KEY(principal_id,idempotency_key));
      INSERT INTO operations_v17 SELECT * FROM run_draft_operations;DROP TABLE run_draft_operations;ALTER TABLE operations_v17 RENAME TO run_draft_operations;
      DROP TABLE model_time_spans; DROP TABLE model_time_run_state;
      DELETE FROM schema_version WHERE version IN(18,19,20,21,22,23,24,25,26,27,28);COMMIT;`);}finally{legacy.close();}
    journal=openJournal({path});assert.equal(journal.createRunConfigurationDraft({principalId,idempotencyKey:uuid(1),patch:patchFor(template.configuration)}).kind,'existing');
    const runId=created.draft.runId;const command={principalId,idempotencyKey:uuid(2),runId,expectedRevision:0};
    const ready=journal.validateRunConfigurationDraft(command);if(ready.kind!=='ready')assert.fail(`No Ready:${ready.kind}`);
    const stored=ReadyRunConfigurationSchema.parse(journal.readWorldConfiguration({runId}));const pure=validateRunConfiguration({draft:created.draft});if(pure.kind!=='ready')assert.fail('Fixture no válida');
    assert.deepEqual(stored,pure.configuration);assert.equal(stored.runId,runId);
    assert.equal(journal.readRunConfigurationDraftState({runId})?.lifecycle,'ready');assert.equal(journal.readRunConfigurationDraftState({runId})?.configurationRevision,0);
    assert.deepEqual(journal.readRunConfigurationDraftValidation({runId}),ready);
    const inspect=new DatabaseSync(path);try{
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_runs').get()?.n,1);assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_events').get()?.n,0);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_commits').get()?.n,0);assert.equal(inspect.prepare('SELECT COUNT(*) n FROM request_reservations').get()?.n,0);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM actor_pi_sessions').get()?.n,0);assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_prepared_contexts').get()?.n,stored.worldSnapshot.scenes.find((scene)=>scene.id===stored.worldSnapshot.activeSceneId)?.participantIds.length);
      assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(),[]);
    }finally{inspect.close();}
    journal.close();journal=openJournal({path});assert.deepEqual(journal.validateRunConfigurationDraft(command),ready);
    assert.equal(journal.setWorldLifecycle({runId,expectedWorldRevision:stored.worldSnapshot.revision,expectedConfigRevision:0,target:'running'}),'updated');
    assert.equal(journal.readRunConfigurationDraftState({runId})?.lifecycle,'running');assert.deepEqual(journal.validateRunConfigurationDraft(command),ready,'replay no reevalúa un lifecycle posterior');
    assert.deepEqual(journal.validateRunConfigurationDraft({...command,idempotencyKey:uuid(3)}),{kind:'invalidLifecycle',lifecycle:'running'});
    assert.equal(journal.validateRunConfigurationDraft({...command,expectedRevision:1}).kind,'idempotencyConflict');
    assert.equal(journal.createRunConfigurationDraft({principalId,idempotencyKey:command.idempotencyKey}).kind,'idempotencyConflict','namespace compartido con create/update');
    const after=new DatabaseSync(path);try{assert.equal(after.prepare('SELECT COUNT(*) n FROM world_runs').get()?.n,1);assert.equal(after.prepare('SELECT COUNT(*) n FROM run_draft_validation_reports').get()?.n,1);assert.equal(after.prepare('SELECT COUNT(*) n FROM request_reservations').get()?.n,0);}finally{after.close();}
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});template.close();}
});

test('reportes incomplete/invalid son durables sin crear WorldRun y CAS obsoleto no promueve',async()=>{
  const template=await setup();const directory=mkdtempSync(join(tmpdir(),'personajes-promote-invalid-'));const path=join(directory,'journal.sqlite');let journal=openJournal({path});let concurrent:ReturnType<typeof openJournal>|undefined;
  try{
    const created=journal.createRunConfigurationDraft({principalId,idempotencyKey:uuid(10)});if(created.kind!=='created')assert.fail('Sin draft');const runId=created.draft.runId;
    const incompleteRequest={principalId,idempotencyKey:uuid(11),runId,expectedRevision:0};const incomplete=journal.validateRunConfigurationDraft(incompleteRequest);assert.equal(incomplete.kind,'incomplete');
    assert.deepEqual(journal.readRunConfigurationDraftValidation({runId}),incomplete);assert.equal(journal.readRunConfigurationDraftState({runId})?.lifecycle,'draft');assert.equal(journal.loadWorld({runId}),undefined);
    concurrent=openJournal({path});const patch=patchFor(template.configuration);
    const bad=journal.updateRunConfigurationDraft({principalId,idempotencyKey:uuid(12),runId,expectedRevision:0,patch:{...patch,worldSnapshot:configured({})}});if(bad.kind!=='stored')assert.fail('Sin candidate inválido');
    assert.deepEqual(concurrent.validateRunConfigurationDraft({...incompleteRequest,idempotencyKey:uuid(13)}),{kind:'conflict',currentRevision:1});
    const invalidRequest={principalId,idempotencyKey:uuid(14),runId,expectedRevision:1};const invalid=journal.validateRunConfigurationDraft(invalidRequest);assert.equal(invalid.kind,'invalid');
    journal.close();journal=openJournal({path});assert.deepEqual(journal.validateRunConfigurationDraft(incompleteRequest),incomplete);assert.deepEqual(journal.validateRunConfigurationDraft(invalidRequest),invalid);
    assert.deepEqual(journal.readRunConfigurationDraftValidation({runId,revision:0}),incomplete);assert.deepEqual(journal.readRunConfigurationDraftValidation({runId}),invalid);
    assert.equal(journal.validateRunConfigurationDraft({principalId,idempotencyKey:uuid(15),runId:uuid(90),expectedRevision:0}).kind,'missing');
    const inspect=new DatabaseSync(path);try{assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_runs').get()?.n,0);assert.equal(inspect.prepare('SELECT COUNT(*) n FROM request_reservations').get()?.n,0);}finally{inspect.close();}
  }finally{concurrent?.close();journal.close();rmSync(directory,{recursive:true,force:true});template.close();}
});

test('editar Ready invalida reporte actual y nueva validación reemplaza preparación inicial sin eventos',async()=>{
  const template=await setup();const directory=mkdtempSync(join(tmpdir(),'personajes-promote-edit-'));const path=join(directory,'journal.sqlite');const journal=openJournal({path});
  try{
    const created=journal.createRunConfigurationDraft({principalId,idempotencyKey:uuid(20),patch:patchFor(template.configuration)});if(created.kind!=='created')assert.fail('Sin draft');const runId=created.draft.runId;
    const first=journal.validateRunConfigurationDraft({principalId,idempotencyKey:uuid(21),runId,expectedRevision:0});if(first.kind!=='ready')assert.fail('Sin Ready');
    const edited=journal.updateRunConfigurationDraft({principalId,idempotencyKey:uuid(22),runId,expectedRevision:0,patch:{name:configured('Nombre revisado explícitamente')}});if(edited.kind!=='stored')assert.fail('Sin edición');
    assert.equal(journal.readRunConfigurationDraftState({runId})?.lifecycle,'draft');assert.equal(journal.readRunConfigurationDraftValidation({runId}),undefined);
    assert.equal(ReadyRunConfigurationSchema.safeParse(journal.readWorldConfiguration({runId})).success,false);
    const next=journal.validateRunConfigurationDraft({principalId,idempotencyKey:uuid(23),runId,expectedRevision:1});if(next.kind!=='ready')assert.fail('Sin promoción actualizada');
    const ready=ReadyRunConfigurationSchema.parse(journal.readWorldConfiguration({runId}));assert.equal(ready.configRevision,1);assert.equal(ready.name,'Nombre revisado explícitamente');assert.notEqual(next.configurationHash,first.configurationHash);
    const inspect=new DatabaseSync(path);try{assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_events').get()?.n,0);assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_commits').get()?.n,0);
      assert.deepEqual(inspect.prepare('SELECT DISTINCT config_revision FROM world_prepared_contexts WHERE run_id=?').all(runId).map((row)=>row.config_revision),[1]);assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(),[]);}finally{inspect.close();}
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});template.close();}
});

test('fallo SQL en promoción revierte World y receipt juntos; reporte corrupto no habilita Ready',async()=>{
  const template=await setup();const directory=mkdtempSync(join(tmpdir(),'personajes-promote-rollback-'));const path=join(directory,'journal.sqlite');const journal=openJournal({path});
  try{
    const created=journal.createRunConfigurationDraft({principalId,idempotencyKey:uuid(30),patch:patchFor(template.configuration)});if(created.kind!=='created')assert.fail('Sin draft');const runId=created.draft.runId;
    const command={principalId,idempotencyKey:uuid(31),runId,expectedRevision:0};const inspect=new DatabaseSync(path);
    try{inspect.exec(`CREATE TRIGGER fail_promotion BEFORE INSERT ON world_prepared_contexts BEGIN SELECT RAISE(ABORT,'fixture promotion failed');END;`);
      assert.throws(()=>journal.validateRunConfigurationDraft(command),/promotion failed/);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_runs').get()?.n,0);assert.equal(inspect.prepare('SELECT COUNT(*) n FROM run_draft_validation_reports').get()?.n,0);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM run_draft_operations WHERE operation_kind=\'validate\'').get()?.n,0);
      inspect.exec('DROP TRIGGER fail_promotion');assert.equal(journal.validateRunConfigurationDraft(command).kind,'ready');
      inspect.prepare('UPDATE run_draft_validation_reports SET payload_hash=? WHERE run_id=?').run('f'.repeat(64),runId);assert.throws(()=>journal.readRunConfigurationDraftValidation({runId}),/alterado/);
    }finally{inspect.close();}
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});template.close();}
});


test('promoción no descarta ActorKnowledge confirmado por CAS aunque no haya eventos ni requests',async()=>{
  const template=await setup();const directory=mkdtempSync(join(tmpdir(),'personajes-promote-knowledge-'));const path=join(directory,'journal.sqlite');const journal=openJournal({path});
  try{
    const created=journal.createRunConfigurationDraft({principalId,idempotencyKey:uuid(40),patch:patchFor(template.configuration)});if(created.kind!=='created')assert.fail('Sin draft');const runId=created.draft.runId;
    const readyResult=journal.validateRunConfigurationDraft({principalId,idempotencyKey:uuid(41),runId,expectedRevision:0});if(readyResult.kind!=='ready')assert.fail('Sin Ready');
    const ready=ReadyRunConfigurationSchema.parse(journal.readWorldConfiguration({runId}));const actorId=ready.roster.activeCharacterIds[0];if(actorId===undefined)assert.fail('Sin actor');
    const current=journal.readActorKnowledge({runId,actorId,throughWorldSeq:ready.worldSnapshot.seq});if(current===undefined)assert.fail('Sin conocimiento inicial');
    const place=ready.worldSnapshot.places[0];if(place===undefined)assert.fail('Sin lugar');
    const cas=journal.compareAndSwapActorKnowledge({kind:'actor-knowledge-cas',runId,actorId,expectedWorldRevision:ready.worldSnapshot.revision,expectedWorldSeq:ready.worldSnapshot.seq,
      expectedContinuity:{continuityId:ready.continuity.continuityId,revision:ready.continuity.revision,contentHash:ready.continuity.contentHash},expectedKnowledgeRevision:current.revision,
      knowledge:{...current.knowledge,bindings:[{kind:'place',handle:'lugar-reconocido',placeId:place.id}]}});assert.equal(cas.kind,'stored');
    const before=journal.readActorKnowledge({runId,actorId,throughWorldSeq:ready.worldSnapshot.seq});assert.equal(before?.revision,1);
    const edited=journal.updateRunConfigurationDraft({principalId,idempotencyKey:uuid(42),runId,expectedRevision:0,patch:{name:configured('Cambio explícito')}});if(edited.kind!=='stored')assert.fail('Sin edición');
    const invalid=journal.validateRunConfigurationDraft({principalId,idempotencyKey:uuid(43),runId,expectedRevision:1});assert.equal(invalid.kind,'invalid');
    assert.equal(journal.readRunConfigurationDraftState({runId})?.lifecycle,'draft');assert.equal(ReadyRunConfigurationSchema.safeParse(journal.readWorldConfiguration({runId})).success,false);
    assert.deepEqual(journal.readActorKnowledge({runId,actorId,throughWorldSeq:ready.worldSnapshot.seq}),before);
    const inspect=new DatabaseSync(path);try{assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_events').get()?.n,0);assert.equal(inspect.prepare('SELECT COUNT(*) n FROM request_reservations').get()?.n,0);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM actor_pi_sessions').get()?.n,0);assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(),[]);}finally{inspect.close();}
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});template.close();}
});
