import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openJournal } from '../src/adapters/journal.ts';

const principalId='local-operator-test';
function uuid(value:number){return `00000000-0000-4000-8000-${value.toString(16).padStart(12,'0')}`;}

test('v19 preserva operaciones v18, deduplica OAuth y recovery interrumpe cola sin repetir login',()=>{
  const directory=mkdtempSync(join(tmpdir(),'personajes-oauth-v19-'));const path=join(directory,'journal.sqlite');let journal=openJournal({path});
  try{
    journal.createRunConfigurationDraft({principalId,idempotencyKey:uuid(1)});journal.close();
    const legacy=new DatabaseSync(path);try{legacy.exec('DROP TABLE model_time_spans;DROP TABLE model_time_run_state;DROP TABLE run_preflight_job_operations;DROP TABLE run_preflight_job_results;DROP TABLE run_preflight_job_history;DROP TABLE run_preflight_jobs;DROP TABLE pi_access_job_operations;DROP TABLE pi_access_job_results;DROP TABLE pi_access_job_history;DROP TABLE pi_access_jobs;DROP TABLE pi_oauth_job_operations;DROP TABLE pi_oauth_job_history;DROP TABLE pi_oauth_jobs;DROP TABLE IF EXISTS actor_activation_invitation_jobs;DROP TABLE IF EXISTS actor_activation_invitations;DROP TABLE IF EXISTS actor_activation_causes; DROP TABLE IF EXISTS routine_clock_advances;DROP TABLE IF EXISTS circumstance_operations;DROP TABLE IF EXISTS actor_state_cuts; DROP TABLE IF EXISTS actor_state_cut_batches; DROP TABLE IF EXISTS fork_projection_receipts; DROP TABLE IF EXISTS fork_job_history; DROP TABLE IF EXISTS fork_dramatic_seeds; DROP TABLE IF EXISTS fork_job_retries; DROP TABLE IF EXISTS fork_backup_sources; DROP TABLE IF EXISTS fork_jobs; DROP TABLE IF EXISTS identity_promotion_receipts; DROP TABLE IF EXISTS actor_job_identity_bindings; DROP TABLE IF EXISTS actor_pi_session_archives; DROP TABLE IF EXISTS actor_identity_session_bindings; DROP TABLE IF EXISTS actor_identity_epochs; DROP TABLE IF EXISTS configurator_http_operations; DROP TABLE IF EXISTS configurator_consents; DROP TABLE IF EXISTS configurator_operations; DROP TABLE IF EXISTS configurator_candidates; DROP TABLE IF EXISTS configurator_checkpoints; DROP TABLE IF EXISTS configurator_sessions; DROP TABLE IF EXISTS configurator_generations; DROP TABLE IF EXISTS configurator_jobs; DROP TABLE IF EXISTS run_configuration_revisions; DELETE FROM schema_version WHERE version IN(19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41);');}finally{legacy.close();}
    journal=openJournal({path});assert.equal(journal.createPiOAuthJob({principalId,idempotencyKey:uuid(1),kind:'login'}).kind,'idempotencyConflict');
    const request={principalId,idempotencyKey:uuid(2),kind:'login'};const created=journal.createPiOAuthJob(request);if(created.kind!=='created')assert.fail('Sin OAuthjob');
    assert.equal(created.job.provider,'openai-codex');assert.equal(created.job.state,'queued');assert.equal(created.job.revision,0);
    assert.equal(journal.createPiOAuthJob({...request,kind:'logout'}).kind,'idempotencyConflict');
    assert.equal(journal.createRunConfigurationDraft({principalId,idempotencyKey:uuid(2)}).kind,'idempotencyConflict');
    journal.close();journal=openJournal({path});const replay=journal.createPiOAuthJob(request);if(replay.kind!=='existing')assert.fail('Sin replay');assert.deepEqual(replay.job,created.job);
    assert.equal(journal.recoverAbandonedPiOAuthJobs({ownerToken:uuid(3)}),1);assert.equal(journal.recoverAbandonedPiOAuthJobs({ownerToken:uuid(3)}),0);
    assert.equal(journal.readPiOAuthJob({jobId:created.job.jobId})?.state,'interrupted');assert.equal(journal.readPiOAuthJob({jobId:created.job.jobId})?.safeCode,'host-interrupted');
    assert.equal(journal.claimPiOAuthJob({jobId:created.job.jobId,expectedRevision:0,ownerToken:uuid(3),claimToken:uuid(4)}).kind,'terminal');
    assert.equal(journal.createPiOAuthJob(request).kind,'existing');assert.equal(journal.listPiOAuthJobs({principalId}).length,1);assert.equal(journal.readPiOAuthJobHistory({jobId:created.job.jobId}).length,2);
    const inspect=new DatabaseSync(path);try{assert.equal(inspect.prepare('SELECT MAX(version) version FROM schema_version').get()?.version, 41);assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_runs').get()?.n,0);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM request_reservations').get()?.n,0);assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_events').get()?.n,0);assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(),[]);}finally{inspect.close();}
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});

test('OAuth claim exclusivo por provider, leases y CAS impiden callbacks viejos y duplicación de estados',()=>{
  const directory=mkdtempSync(join(tmpdir(),'personajes-oauth-lease-'));const path=join(directory,'journal.sqlite');const journal=openJournal({path});const other=openJournal({path});
  try{
    const first=journal.createPiOAuthJob({principalId,idempotencyKey:uuid(10),kind:'login'});const second=journal.createPiOAuthJob({principalId,idempotencyKey:uuid(11),kind:'logout'});
    if(first.kind!=='created'||second.kind!=='created')assert.fail('Sin jobs');const lease={ownerToken:uuid(12),claimToken:uuid(13)};
    assert.equal(journal.claimPiOAuthJob({jobId:first.job.jobId,expectedRevision:1,...lease}).kind,'stale');
    const claimed=journal.claimPiOAuthJob({jobId:first.job.jobId,expectedRevision:0,...lease});if(claimed.kind!=='claimed')assert.fail('Sin claim');assert.equal(claimed.job.revision,1);
    assert.equal(journal.claimPiOAuthJob({jobId:first.job.jobId,expectedRevision:0,...lease}).kind,'existing');
    assert.equal(other.claimPiOAuthJob({jobId:first.job.jobId,expectedRevision:1,ownerToken:uuid(14),claimToken:uuid(15)}).kind,'busy');
    assert.equal(other.claimPiOAuthJob({jobId:second.job.jobId,expectedRevision:0,ownerToken:uuid(14),claimToken:uuid(15)}).kind,'busy','logout no concurre con login sobre misma credencial');
    assert.throws(()=>journal.completePiOAuthJob({jobId:first.job.jobId,expectedRevision:1,lease:{...lease,claimToken:uuid(16)},outcome:'succeeded'}),/Lease/);
    assert.equal(journal.completePiOAuthJob({jobId:first.job.jobId,expectedRevision:0,lease,outcome:'succeeded'}).kind,'stale');
    const completed=journal.completePiOAuthJob({jobId:first.job.jobId,expectedRevision:1,lease,outcome:'succeeded'});if(completed.kind!=='updated')assert.fail('Sin complete');assert.equal(completed.job.state,'succeeded');
    assert.equal(journal.completePiOAuthJob({jobId:first.job.jobId,expectedRevision:1,lease,outcome:'succeeded'}).kind,'existing');
    assert.equal(journal.completePiOAuthJob({jobId:first.job.jobId,expectedRevision:2,lease,outcome:'canceled'}).kind,'terminal','cancelación tardía no falsifica rollback del éxito');
    const next=other.claimPiOAuthJob({jobId:second.job.jobId,expectedRevision:0,ownerToken:uuid(14),claimToken:uuid(15)});if(next.kind!=='claimed')assert.fail('Segundo claim no liberado');
    assert.equal(other.recoverAbandonedPiOAuthJobs({ownerToken:uuid(17)}),1);
    assert.equal(other.completePiOAuthJob({jobId:second.job.jobId,expectedRevision:1,lease:next.lease,outcome:'succeeded'}).kind,'terminal');
    assert.equal(journal.readPiOAuthJobHistory({jobId:first.job.jobId}).length,3);assert.equal(journal.readPiOAuthJobHistory({jobId:second.job.jobId}).length,3);
  }finally{other.close();journal.close();rmSync(directory,{recursive:true,force:true});}
});

test('cancelación OAuth es durable e idempotente; running solicita abort, queued termina, scope ajeno no modifica',()=>{
  const directory=mkdtempSync(join(tmpdir(),'personajes-oauth-cancel-'));const path=join(directory,'journal.sqlite');let journal=openJournal({path});
  try{
    const created=journal.createPiOAuthJob({principalId,idempotencyKey:uuid(20),kind:'login'});if(created.kind!=='created')assert.fail('Sin job');
    assert.equal(journal.cancelPiOAuthJob({principalId:'other-principal',idempotencyKey:uuid(21),jobId:created.job.jobId,expectedRevision:0}).kind,'missing');
    const lease={ownerToken:uuid(22),claimToken:uuid(23)};const claim=journal.claimPiOAuthJob({jobId:created.job.jobId,expectedRevision:0,...lease});if(claim.kind!=='claimed')assert.fail('Sin claim');
    const request={principalId,idempotencyKey:uuid(24),jobId:created.job.jobId,expectedRevision:1};const canceled=journal.cancelPiOAuthJob(request);if(canceled.kind!=='updated')assert.fail('Sin cancel request');
    assert.equal(canceled.job.state,'cancel-requested');assert.equal(canceled.job.revision,2);
    assert.equal(journal.completePiOAuthJob({jobId:created.job.jobId,expectedRevision:1,lease,outcome:'canceled'}).kind,'stale');
    const terminal=journal.completePiOAuthJob({jobId:created.job.jobId,expectedRevision:2,lease,outcome:'canceled'});if(terminal.kind!=='updated')assert.fail('Sin cancellation ack');assert.equal(terminal.job.safeCode,'user-canceled');
    journal.close();journal=openJournal({path});assert.deepEqual(journal.cancelPiOAuthJob(request),canceled,'receipt de solicitud se conserva después de terminar abort');
    assert.equal(journal.cancelPiOAuthJob({...request,expectedRevision:2}).kind,'idempotencyConflict');
    const queued=journal.createPiOAuthJob({principalId,idempotencyKey:uuid(25),kind:'logout'});if(queued.kind!=='created')assert.fail('Sin queued');
    const cancel=journal.cancelPiOAuthJob({principalId,idempotencyKey:uuid(26),jobId:queued.job.jobId,expectedRevision:0});if(cancel.kind!=='updated')assert.fail('Sin cancel queued');assert.equal(cancel.job.state,'canceled');
    assert.equal(journal.recoverAbandonedPiOAuthJobs({ownerToken:uuid(27)}),0);
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});

test('schemas OAuth rechazan secretos antes de hash/escritura y diagnósticos no contienen texto externo',()=>{
  const directory=mkdtempSync(join(tmpdir(),'personajes-oauth-redaction-'));const path=join(directory,'journal.sqlite');const journal=openJournal({path});
  try{
    const secret='SECRET_CREDENTIAL_FIXTURE_NEVER_STORE';const request={principalId,idempotencyKey:uuid(30),kind:'login'};
    for(const field of ['token','apiKey','authUrl','callbackCode','prompt','sessionPath'])assert.throws(()=>journal.createPiOAuthJob({...request,[field]:secret}));
    const created=journal.createPiOAuthJob(request);if(created.kind!=='created')assert.fail('Sin metadatajob');const lease={ownerToken:uuid(31),claimToken:uuid(32)};
    journal.claimPiOAuthJob({jobId:created.job.jobId,expectedRevision:0,...lease});assert.throws(()=>journal.completePiOAuthJob({jobId:created.job.jobId,expectedRevision:1,lease,outcome:'failed',safeCode:secret}));
    const failed=journal.completePiOAuthJob({jobId:created.job.jobId,expectedRevision:1,lease,outcome:'failed',safeCode:'oauth-error'});assert.equal(failed.kind,'updated');
    const inspect=new DatabaseSync(path);try{const tables=['pi_oauth_jobs','pi_oauth_job_history','pi_oauth_job_operations'];for(const table of tables)assert.doesNotMatch(JSON.stringify(inspect.prepare(`SELECT * FROM ${table}`).all()),new RegExp(secret));
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM request_reservations').get()?.n,0);inspect.prepare('UPDATE pi_oauth_jobs SET payload_hash=? WHERE job_id=?').run('f'.repeat(64),created.job.jobId);assert.throws(()=>journal.readPiOAuthJob({jobId:created.job.jobId}),/alterada/);}finally{inspect.close();}
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});
