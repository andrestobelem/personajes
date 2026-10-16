import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {downgradeCoordinatorPulsesTo44} from './fixtures/journal-v45-downgrade.ts';
import {test} from 'node:test';
import {openJournal} from '../src/adapters/journal.ts';
import {createIcmWorkspaceSnapshot} from '../src/domain/icm-workspace.ts';
import {sha256CanonicalJson,sha256Utf8} from '../src/domain/canonical-json.ts';
import {PreparationConfiguratorRequestSchema} from '../src/domain/preparation-configurator.ts';
import type {PreparationConfiguratorExecution} from '../src/domain/preparation-configurator-jobs.ts';
import type {RunBudget} from '../src/domain/production.ts';
import {draftFixture} from './fixtures/continuista.ts';

const principalId='preparation-budget-test';
function setup(budget:Partial<RunBudget>={}) {
  const directory=mkdtempSync(join(tmpdir(),'personajes-preparation-budget-')),path=join(directory,'journal.sqlite');
  const journal=openJournal({path});
  // Test-owned admission is explicit; no client may provide source bytes.
  journal.setPreparationSourceAdmission(()=>undefined);
  journal.setPreparationConfiguratorSourceResolver(()=>({actorSources:[],documents:[]}));
  const created=journal.createRunConfigurationDraft({principalId,idempotencyKey:randomUUID()});assert.equal(created.kind,'created');if(created.kind!=='created')throw new Error('draft missing');
  const fixture=draftFixture(),{kind:_kind,schemaVersion:_schema,runId:_id,revision:_rev,...patch}=fixture;
  const workspace=createIcmWorkspaceSnapshot({sources:[...['configurator','director','continuista'].map(role=>({sourceId:`role.${role}`,audience:{role},revision:0,sourceHash:sha256Utf8(`test-${role}`),sections:[{sectionId:'process',markdown:'Contrato sintético explícito.'}]})),{sourceId:'actor.personaje-prueba',audience:{role:'actor',actorId:'personaje-prueba'},revision:0,sourceHash:sha256Utf8('test-actor'),sections:[{sectionId:'identity',markdown:'Personaje sintético de prueba.'}]}]});
  assert.equal(patch.budget.kind,'configured');if(patch.budget.kind!=='configured')throw new Error('fixture budget missing');
  const updated=journal.updateRunConfigurationDraft({principalId,idempotencyKey:randomUUID(),runId:created.draft.runId,expectedRevision:0,
    patch:{...patch,budget:{...patch.budget,value:{...patch.budget.value,requestTimeoutMs:30000,...budget}},icmWorkspace:{kind:'configured',value:workspace,evidence:{kind:'operator-choice',operatorId:principalId,recordedAt:'2026-10-16T12:00:00Z'}}}});
  assert.equal(updated.kind,'stored');if(updated.kind!=='stored')throw new Error('draft update missing');
  const request=PreparationConfiguratorRequestSchema.parse({kind:'preparation-configurator-request',schemaVersion:1,runId:updated.draft.runId,draftRevision:updated.draft.revision,draftHash:sha256CanonicalJson(updated.draft),jobId:randomUUID(),generation:0,instructions:'Preparar propuesta sin ejecutar personajes.',actorSources:[],documentIds:[]});
  const create={principalId,idempotencyKey:randomUUID(),request};
  const job=journal.createPreparationConfiguratorJob(create),ownerToken=randomUUID(),epoch=randomUUID();
  const claim=()=>journal.claimPreparationConfiguratorJob({principalId,jobId:job.scope.jobId,ownerToken,expectedRevision:job.revision});
  return {journal,path,directory,draft:updated.draft,create,job,claim,epoch,close(){journal.close();rmSync(directory,{recursive:true,force:true});}};
}
function complete(f:ReturnType<typeof setup>,execution:PreparationConfiguratorExecution,requestSeq:number,elapsedMs=1234){
  const shared={jobId:execution.scope.jobId,generation:execution.scope.generation,requestSeq,ownerToken:execution.lease.ownerToken};
  f.journal.transitionReservation({...shared,target:'dispatched',wallTime:{clockEpochId:f.epoch,monotonicNs:'1000000'}});
  f.journal.transitionReservation({...shared,target:'completed',wallTime:{clockEpochId:f.epoch,monotonicNs:String(1000000n+BigInt(elapsedMs)*1000000n)}});
}

test('autoridad preparación no crea WorldRun y null es ilimitado con concurrencia/timeout reales en el contador compartido',()=>{
  const f=setup({maxPiCallsPerRun:null,maxPiCallsPerPulse:null,maxWallTimeMs:null,maxConcurrentPiRequests:1});
  try{
    const execution=f.claim().execution;
    const inspect=new DatabaseSync(f.path);try{assert.equal(inspect.prepare('SELECT COUNT(*) count FROM world_runs').get()?.count,0);}finally{inspect.close();}
    const reserved=f.journal.reservePreparationConfiguratorRequest({execution,clockEpochId:f.epoch});assert.equal(reserved.kind,'reserved');if(reserved.kind!=='reserved')throw new Error('not reserved');
    assert.equal(reserved.wallTime?.reservedMs,30000);
    assert.deepEqual(f.journal.reservePreparationConfiguratorRequest({execution,clockEpochId:f.epoch}),{kind:'busy',scope:'concurrency'});
    complete(f,execution,reserved.requestSeq);
    const budget=f.journal.readRunModelTimeBudget({runId:f.draft.runId});assert.equal(budget?.status,'known');assert.equal(budget.runCallsUsed,1);
    assert.equal(budget.wallTimeMeasuredMs,1234);assert.equal(budget.wallTimeRemainingMs,null);assert.equal(budget.maxPiCallsPerRun,null);
    const next=f.journal.reservePreparationConfiguratorRequest({execution,clockEpochId:f.epoch});assert.equal(next.kind,'reserved');
  }finally{f.close();}
});

test('Ready conserva llamadas/spans de preparación sin trasladar ni reiniciar consumo, incluso tras reabrir SQLite',()=>{
  const f=setup();
  try{
    const execution=f.claim().execution,reserved=f.journal.reservePreparationConfiguratorRequest({execution,clockEpochId:f.epoch});if(reserved.kind!=='reserved')throw new Error('not reserved');
    complete(f,execution,reserved.requestSeq,2222);
    f.journal.finishPreparationConfiguratorJob({execution,outcome:'blocked',failureCode:'test-finished'});
    const ready=f.journal.validateRunConfigurationDraft({principalId,idempotencyKey:randomUUID(),runId:f.draft.runId,expectedRevision:f.draft.revision});assert.equal(ready.kind,'ready',JSON.stringify(ready));
    const budget=f.journal.readRunModelTimeBudget({runId:f.draft.runId});assert.equal(budget?.status,'known');assert.equal(budget.runCallsUsed,1);assert.equal(budget.wallTimeMeasuredMs,2222);assert.equal(budget.wallTimeRemainingMs,60000-2222);
    f.journal.close();const reopened=openJournal({path:f.path});try{assert.deepEqual(reopened.readRunModelTimeBudget({runId:f.draft.runId}),budget);}finally{reopened.close();}
  }finally{try{f.close();}catch{rmSync(f.directory,{recursive:true,force:true});}}
});

test('lease/cut/authority ajenos y corrupción bloquean reserva; jobId repetido no altera fila previa',()=>{
  const f=setup();
  try{
    const prior=f.journal.readPreparationConfiguratorJob({principalId,jobId:f.job.scope.jobId});
    assert.throws(()=>f.journal.createPreparationConfiguratorJob({...f.create,idempotencyKey:randomUUID(),principalId:'other-principal'}),/JOB_ID_EXISTS/);
    assert.deepEqual(f.journal.readPreparationConfiguratorJob({principalId,jobId:f.job.scope.jobId}),prior);
    assert.deepEqual(f.journal.createPreparationConfiguratorJob(f.create),f.job);
    const execution=f.claim().execution;
    assert.throws(()=>f.journal.reservePreparationConfiguratorRequest({execution:{...execution,lease:{...execution.lease,claimToken:randomUUID()}},clockEpochId:f.epoch}),/CLAIM_INACTIVE/);
    const updated=f.journal.updateRunConfigurationDraft({principalId,idempotencyKey:randomUUID(),runId:f.draft.runId,expectedRevision:f.draft.revision,patch:{name:{kind:'empty'}}});assert.equal(updated.kind,'stored');
    assert.throws(()=>f.journal.reservePreparationConfiguratorRequest({execution,clockEpochId:f.epoch}),/DRAFT_CHANGED/);
    f.journal.finishPreparationConfiguratorJob({execution,outcome:'blocked',failureCode:'draft-changed'});
    const db=new DatabaseSync(f.path);try{db.prepare("UPDATE model_budget_authorities SET payload_hash=? WHERE run_id=?").run('0'.repeat(64),f.draft.runId);}finally{db.close();}
    assert.throws(()=>f.journal.readRunModelTimeBudget({runId:f.draft.runId}),/AUTHORITY_CORRUPT/);
  }finally{f.close();}
});

test('transporte incierto bloquea hasta settlement; luego un job nuevo continúa en el mismo run y conserva el resultado ambiguo cobrado',()=>{
  const f=setup({maxPiCallsPerRun:null,maxPiCallsPerPulse:null,maxWallTimeMs:null,requestTimeoutMs:180000,maxConcurrentPiRequests:1});
  try{
    const execution=f.claim().execution,reserved=f.journal.reservePreparationConfiguratorRequest({execution,clockEpochId:f.epoch});if(reserved.kind!=='reserved')throw new Error('not reserved');
    f.journal.transitionReservation({jobId:execution.scope.jobId,generation:0,requestSeq:reserved.requestSeq,target:'dispatched',ownerToken:execution.lease.ownerToken,wallTime:{clockEpochId:f.epoch,monotonicNs:'1000000'}});
    f.journal.expirePreparationConfiguratorRequest({execution,requestSeq:reserved.requestSeq,clockEpochId:f.epoch,reason:'timeout'});
    assert.equal(f.journal.readRunModelTimeBudget({runId:f.draft.runId})?.status,'uncertain');
    assert.deepEqual(f.journal.reservePreparationConfiguratorRequest({execution,clockEpochId:f.epoch}),{kind:'exhausted',scope:'uncertain'});
    assert.throws(()=>f.journal.validateRunConfigurationDraft({principalId,idempotencyKey:randomUUID(),runId:f.draft.runId,expectedRevision:f.draft.revision}),/UNSETTLED/);
    f.journal.settlePreparationConfiguratorRequestWallTime({execution,requestSeq:reserved.requestSeq,clockEpochId:f.epoch,monotonicNs:'180009000000'});
    const settled=f.journal.readRunModelTimeBudget({runId:f.draft.runId});assert.equal(settled?.status,'known');assert.equal(settled?.uncertainRequests,0);
    assert.equal(settled?.runCallsUsed,1);assert.equal(settled?.wallTimeMeasuredMs,180008);assert.equal(settled?.wallTimeReservedMs,0);
    assert.deepEqual(f.journal.reservePreparationConfiguratorRequest({execution,clockEpochId:f.epoch}),{kind:'exhausted',scope:'uncertain'},'un job incompleto nunca reutiliza su request sequence ni abre otra request');
    assert.equal(f.journal.readPreparationConfiguratorRecord({jobId:execution.scope.jobId,generation:0,kind:'candidate'}),undefined);
    assert.equal(f.journal.readPreparationConfiguratorRecord({jobId:execution.scope.jobId,generation:0,kind:'accepted-proof'}),undefined);
    f.journal.finishPreparationConfiguratorJob({execution,outcome:'blocked',failureCode:'PREPARATION_CONFIGURATOR_TERMINAL_INCOMPLETE'});
    const oldJob=f.journal.readPreparationConfiguratorJob({principalId,jobId:execution.scope.jobId});assert.equal(oldJob.job.state,'blocked');
    const inspection=new DatabaseSync(f.path);try{
      assert.equal(inspection.prepare("SELECT state FROM request_reservations WHERE job_id=? AND generation=0 AND request_seq=?").get(execution.scope.jobId,reserved.requestSeq)?.state,'ambiguous');
      assert.equal(inspection.prepare("SELECT state FROM model_time_spans WHERE job_id=? AND generation=0 AND request_seq=?").get(execution.scope.jobId,reserved.requestSeq)?.state,'settled');
    }finally{inspection.close();}

    const next=f.journal.createPreparationConfiguratorJob({...f.create,idempotencyKey:randomUUID(),request:{...f.create.request,jobId:randomUUID()}});
    assert.equal(next.state,'queued');assert.equal(next.scope.runId,f.draft.runId);assert.notEqual(next.scope.jobId,execution.scope.jobId);
    const nextExecution=f.journal.claimPreparationConfiguratorJob({principalId,jobId:next.scope.jobId,ownerToken:randomUUID(),expectedRevision:next.revision}).execution;
    const nextReservation=f.journal.reservePreparationConfiguratorRequest({execution:nextExecution,clockEpochId:f.epoch});assert.equal(nextReservation.kind,'reserved');if(nextReservation.kind!=='reserved')throw new Error('fresh job was not admitted');
    complete(f,nextExecution,nextReservation.requestSeq);
    f.journal.finishPreparationConfiguratorJob({execution:nextExecution,outcome:'blocked',failureCode:'test-finished'});
    const ready=f.journal.validateRunConfigurationDraft({principalId,idempotencyKey:randomUUID(),runId:f.draft.runId,expectedRevision:f.draft.revision});assert.equal(ready.kind,'ready',JSON.stringify(ready));
    const budget=f.journal.readRunModelTimeBudget({runId:f.draft.runId});assert.equal(budget?.runCallsUsed,2);assert.equal(budget?.wallTimeMeasuredMs,181242);
    assert.equal(f.journal.readPreparationConfiguratorJob({principalId,jobId:execution.scope.jobId}).job.state,'blocked');
  }finally{f.close();}
});

test('un hash o duración adulterados en una ambigüedad settled siguen bloqueando recuperación',()=>{
  for(const field of ['settlement_hash','measured_ms'] as const){
    const f=setup({maxPiCallsPerRun:null,maxPiCallsPerPulse:null,maxWallTimeMs:null});
    try{
      const execution=f.claim().execution,reserved=f.journal.reservePreparationConfiguratorRequest({execution,clockEpochId:f.epoch});if(reserved.kind!=='reserved')throw new Error('not reserved');
      f.journal.transitionReservation({jobId:execution.scope.jobId,generation:0,requestSeq:reserved.requestSeq,target:'dispatched',ownerToken:execution.lease.ownerToken,wallTime:{clockEpochId:f.epoch,monotonicNs:'1000000'}});
      f.journal.expirePreparationConfiguratorRequest({execution,requestSeq:reserved.requestSeq,clockEpochId:f.epoch,reason:'timeout'});
      f.journal.settlePreparationConfiguratorRequestWallTime({execution,requestSeq:reserved.requestSeq,clockEpochId:f.epoch,monotonicNs:'2000000'});
      f.journal.finishPreparationConfiguratorJob({execution,outcome:'blocked',failureCode:'PREPARATION_CONFIGURATOR_TERMINAL_INCOMPLETE'});
      const db=new DatabaseSync(f.path);try{
        const corruptValue=field==='settlement_hash'?'0'.repeat(64):100;
        db.prepare(`UPDATE model_time_spans SET ${field}=? WHERE job_id=? AND generation=0 AND request_seq=?`).run(corruptValue,execution.scope.jobId,reserved.requestSeq);
      }finally{db.close();}
      assert.throws(()=>f.journal.createPreparationConfiguratorJob({...f.create,idempotencyKey:randomUUID(),request:{...f.create.request,jobId:randomUUID()}}),/PREPARATION_BUDGET_UNSETTLED/);
      assert.equal(f.journal.readRunModelTimeBudget({runId:f.draft.runId})?.runCallsUsed,1,'la corrupción nunca perdona el consumo');
    }finally{f.close();}
  }
});

test('restart sólo marca trabajo interrumpido, jamás crea reserva/sesión ni reanuda inferencia',()=>{
  const f=setup();
  try{
    f.claim();assert.equal(f.journal.interruptPreparationConfiguratorJobs({ownerToken:randomUUID()}),1);
    const stored=f.journal.readPreparationConfiguratorJob({principalId,jobId:f.job.scope.jobId});assert.equal(stored.job.state,'interrupted');
    assert.equal(f.journal.readRunModelTimeBudget({runId:f.draft.runId})?.runCallsUsed,0);
    const db=new DatabaseSync(f.path);try{assert.equal(db.prepare('SELECT COUNT(*) count FROM preparation_configurator_records').get()?.count,0);}finally{db.close();}
    assert.throws(()=>f.claim(),/CLAIM_CONFLICT/);
  }finally{f.close();}
});


test('autoridad borrada no degrada preparación a cuota legacy y los registros durables son appendonly',()=>{
  const f=setup();
  try{
    const execution=f.claim().execution;
    const db=new DatabaseSync(f.path);try{
      assert.throws(()=>db.exec('UPDATE preparation_configurator_operations SET request_hash=request_hash'),/IMMUTABLE/);
      assert.throws(()=>db.exec('DELETE FROM preparation_configurator_operations'),/IMMUTABLE/);
      db.prepare('DELETE FROM model_budget_authorities WHERE run_id=?').run(f.draft.runId);
    }finally{db.close();}
    assert.throws(()=>f.journal.reservePreparationConfiguratorRequest({execution,clockEpochId:f.epoch}),/AUTHORITY_MISMATCH/);
    assert.throws(()=>f.journal.reserveNextRequest({runId:execution.scope.runId,pulseId:execution.scope.jobId,jobId:execution.scope.jobId,generation:0,clockEpochId:f.epoch,ownerToken:execution.lease.ownerToken}),/AUTHORITY_MISSING/);
  }finally{f.close();}
});

test('v44 rechaza presupuesto ausente con requests históricas y conserva el corte v43 sin inventar consumo cero',()=>{
  const f=setup();
  try{
    const execution=f.claim().execution,reserved=f.journal.reservePreparationConfiguratorRequest({execution,clockEpochId:f.epoch});
    if(reserved.kind!=='reserved')throw new Error('not reserved');complete(f,execution,reserved.requestSeq);
    f.journal.finishPreparationConfiguratorJob({execution,outcome:'blocked',failureCode:'test-finished'});
    assert.equal(f.journal.validateRunConfigurationDraft({principalId,idempotencyKey:randomUUID(),runId:f.draft.runId,expectedRevision:f.draft.revision}).kind,'ready');
    f.journal.close();
    const db=new DatabaseSync(f.path);try{
      downgradeCoordinatorPulsesTo44(db);
      db.exec(`PRAGMA foreign_keys=OFF;BEGIN IMMEDIATE;
        DROP TRIGGER IF EXISTS actor_initiatives_source_immutable;
        DROP INDEX IF EXISTS actor_initiatives_ready;
        DROP INDEX IF EXISTS actor_initiatives_one_open_per_actor;
        DROP INDEX IF EXISTS actor_turn_jobs_initiative;
        DROP TABLE IF EXISTS actor_initiatives;
        ALTER TABLE actor_turn_jobs DROP COLUMN initiative_id;
        DELETE FROM schema_version WHERE version=45;
        DROP TABLE preparation_configurator_records;DROP TABLE preparation_configurator_operations;DROP TABLE preparation_configurator_jobs;DROP TABLE model_budget_authorities;
        CREATE TABLE model_time_run_state_v43(run_id TEXT PRIMARY KEY REFERENCES world_runs(run_id) ON DELETE RESTRICT,unknown_legacy_requests INTEGER NOT NULL DEFAULT 0 CHECK(unknown_legacy_requests>=0));
        INSERT INTO model_time_run_state_v43 SELECT * FROM model_time_run_state;DROP TABLE model_time_run_state;ALTER TABLE model_time_run_state_v43 RENAME TO model_time_run_state;
        DELETE FROM run_budgets;DELETE FROM schema_version WHERE version=44;COMMIT;`);
    }finally{db.close();}
    assert.throws(()=>openJournal({path:f.path}),/MIGRATION_MODEL_BUDGET_ORPHANED_REQUESTS/);
    const after=new DatabaseSync(f.path);try{
      assert.equal(after.prepare('SELECT MAX(version) version FROM schema_version').get()?.version,43);
      assert.equal(after.prepare('SELECT COUNT(*) count FROM run_budgets').get()?.count,0);
      assert.equal(after.prepare("SELECT COUNT(*) count FROM request_reservations WHERE state='completed'").get()?.count,1);
      assert.equal(after.prepare("SELECT name FROM sqlite_schema WHERE name='model_budget_authorities'").get(),undefined);
    }finally{after.close();}
  }finally{try{f.close();}catch{rmSync(f.directory,{recursive:true,force:true});}}
});

test('cancelar queued usa CAS/principal/idempotencia y el listado pagina sólo trabajos propios del run',()=>{
  const f=setup();
  try{
    const request={principalId,jobId:f.job.scope.jobId,expectedRevision:f.job.revision,idempotencyKey:randomUUID()};
    assert.throws(()=>f.journal.cancelPreparationConfiguratorJob({...request,principalId:'other'}),/JOB_MISSING/);
    assert.throws(()=>f.journal.cancelPreparationConfiguratorJob({...request,expectedRevision:3}),/REVISION_CONFLICT/);
    const cancelled=f.journal.cancelPreparationConfiguratorJob(request);assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.revision,1);
    assert.deepEqual(f.journal.cancelPreparationConfiguratorJob(request),cancelled);
    assert.throws(()=>f.claim(),/CLAIM_CONFLICT/);
    const second=f.journal.createPreparationConfiguratorJob({...f.create,idempotencyKey:randomUUID(),request:{...f.create.request,jobId:randomUUID()}});
    const page=f.journal.listPreparationConfiguratorJobs({principalId,runId:f.draft.runId,limit:1});assert.equal(page.items.length,1);assert.equal(page.hasMore,true);
    const next=f.journal.listPreparationConfiguratorJobs({principalId,runId:f.draft.runId,limit:1,offset:1});assert.equal(next.items.length,1);assert.equal(next.hasMore,false);
    assert.deepEqual(new Set([...page.items,...next.items].map(job=>job.scope.jobId)),new Set([f.job.scope.jobId,second.scope.jobId]));
    assert.deepEqual(f.journal.listPreparationConfiguratorJobs({principalId:'other',runId:f.draft.runId}),{items:[],hasMore:false});
  }finally{f.close();}
});

test('cancelar running retira autoridad de inferencia pero conserva grants hasta limpieza y nunca revive al terminar worker',()=>{
  const f=setup();
  try{
    const execution=f.claim().execution,reserved=f.journal.reservePreparationConfiguratorRequest({execution,clockEpochId:f.epoch});if(reserved.kind!=='reserved')throw new Error('not reserved');
    f.journal.transitionReservation({jobId:execution.scope.jobId,generation:0,requestSeq:reserved.requestSeq,target:'dispatched',ownerToken:execution.lease.ownerToken,wallTime:{clockEpochId:f.epoch,monotonicNs:'1000000'}});
    const running=f.journal.readPreparationConfiguratorJob({principalId,jobId:execution.scope.jobId}).job;
    const cancelled=f.journal.cancelPreparationConfiguratorJob({principalId,jobId:execution.scope.jobId,expectedRevision:running.revision,idempotencyKey:randomUUID()});assert.equal(cancelled.state,'cancelled');
    assert.equal(f.journal.readRunModelTimeBudget({runId:f.draft.runId})?.activePiRequests,1);
    assert.throws(()=>f.journal.reservePreparationConfiguratorRequest({execution,clockEpochId:f.epoch}),/CLAIM_INACTIVE/);
    f.journal.transitionPreparationConfiguratorReservation({execution,requestSeq:reserved.requestSeq,target:'completed',wallTime:{clockEpochId:f.epoch,monotonicNs:'1235000000'}});
    assert.equal(f.journal.readRunModelTimeBudget({runId:f.draft.runId})?.wallTimeMeasuredMs,1234);
    assert.deepEqual(f.journal.finishPreparationConfiguratorJob({execution,outcome:'blocked',failureCode:'cancelled'}),cancelled);
    assert.equal(f.journal.readPreparationConfiguratorJob({principalId,jobId:execution.scope.jobId}).job.state,'cancelled');
  }finally{f.close();}
});

test('start durable guarda recibo queued exacto y replay tras ejecución o reinicio nunca autoriza nuevo schedule',()=>{
  const f=setup();
  try{
    const request={principalId,jobId:f.job.scope.jobId,expectedRevision:0,idempotencyKey:randomUUID()};
    const started=f.journal.startPreparationConfiguratorJob(request);assert.equal(started.kind,'started');assert.deepEqual(started.job,f.job);
    const execution=f.claim().execution;f.journal.finishPreparationConfiguratorJob({execution,outcome:'blocked',failureCode:'test-finished'});
    const replay=f.journal.startPreparationConfiguratorJob(request);assert.equal(replay.kind,'existing');assert.deepEqual(replay.job,f.job);assert.equal(replay.job.state,'queued');
    assert.throws(()=>f.journal.startPreparationConfiguratorJob({...request,idempotencyKey:randomUUID()}),/REVISION_CONFLICT/);
    assert.throws(()=>f.journal.cancelPreparationConfiguratorJob(request),/IDEMPOTENCY_REUSE/);
    f.journal.close();const reopened=openJournal({path:f.path});try{assert.deepEqual(reopened.startPreparationConfiguratorJob(request),replay);assert.equal(reopened.readRunModelTimeBudget({runId:f.draft.runId})?.runCallsUsed,0);}finally{reopened.close();}
  }finally{try{f.close();}catch{rmSync(f.directory,{recursive:true,force:true});}}
});
