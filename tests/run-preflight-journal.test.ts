import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openJournal } from '../src/adapters/journal.ts';
import { fingerprintInferenceProfile } from '../src/application/pi-access-check.ts';
import { ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { RunPreflightResultSchema } from '../src/domain/run-preflight-jobs.ts';
import { RunDraftPatchSchema } from '../src/domain/world-journal.ts';
import { WorldSnapshotSchema } from '../src/domain/world.ts';
import { setup } from './fixtures/continuista.ts';

const principalId='preflight-operator-test';
const accountFingerprint='a'.repeat(64);
const owner=uuid(900);
function uuid(value:number){return `00000000-0000-4000-8000-${value.toString(16).padStart(12,'0')}`;}
function canonical(value:unknown):string{
  if(value===null||typeof value!=='object'){const encoded=JSON.stringify(value);if(encoded===undefined)assert.fail('Fixture no serializable');return encoded;}
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  const record=value as Record<string,unknown>;
  return '{'+Object.keys(record).sort().map((key)=>JSON.stringify(key)+':'+canonical(record[key])).join(',')+'}';
}
function hash(value:unknown){return createHash('sha256').update(canonical(value)).digest('hex');}
function configured(value:unknown){return {kind:'configured',value,evidence:{kind:'operator-choice',operatorId:'synthetic',recordedAt:'1900-01-01T00:00:00Z'}};}
function patchFor(configuration:Awaited<ReturnType<typeof setup>>['configuration']){
  const world={...configuration.worldSnapshot,entities:configuration.worldSnapshot.entities.map((entity)=>entity.kind==='character'?{...entity,mind:{...entity.mind,experiences:[]}}:entity)};
  return RunDraftPatchSchema.parse(Object.fromEntries(Object.entries({name:configuration.name,fictionalAt:configuration.fictionalAt,continuity:configuration.continuity,
    roster:configuration.roster,humanParticipants:configuration.humanParticipants,worldSnapshot:world,dramaticLine:configuration.dramaticLine,
    circadianPolicy:configuration.circadianPolicy,spanishVariety:configuration.spanishVariety,narrationMode:configuration.narrationMode,
    inferenceProfile:configuration.inferenceProfile,budget:configuration.budget,maxReformulations:configuration.maxReformulations,audio:configuration.audio})
    .map(([field,value])=>[field,configured(value)])));
}
async function readyJournal(){
  const fixture=await setup();const directory=mkdtempSync(join(tmpdir(),'personajes-preflight-v21-'));const path=join(directory,'journal.sqlite');let activeJournal=openJournal({path});
  const created=activeJournal.createRunConfigurationDraft({principalId,idempotencyKey:uuid(1),patch:patchFor(fixture.configuration)});
  if(created.kind!=='created')assert.fail('No se creó el borrador de preflight');
  const promotion=activeJournal.validateRunConfigurationDraft({principalId,idempotencyKey:uuid(2),runId:created.draft.runId,expectedRevision:0});
  if(promotion.kind!=='ready')assert.fail(`No se promovió Ready: ${promotion.kind}`);
  const configuration=activeJournal.readWorldConfiguration({runId:created.draft.runId});
  assert.ok(configuration&&typeof configuration==='object');
  return {fixture,directory,path,get journal(){return activeJournal;},reopen(){try{activeJournal.close();}catch{/* Already closed by a test. */}activeJournal=openJournal({path});return activeJournal;},
    runId:created.draft.runId,configuration:configuration as Awaited<ReturnType<typeof setup>>['configuration'],
    close(){try{activeJournal.close();}catch{/* Already closed by a test. */}fixture.close();rmSync(directory,{recursive:true,force:true});}};
}
function start(journal:ReturnType<typeof openJournal>,runId:string,key:number,expectedConfigurationRevision=0,expectedWorldRevision=4){
  return journal.createRunPreflightJob({principalId,idempotencyKey:uuid(key),runId,expectedConfigurationRevision,expectedWorldRevision});
}
function accessResult(){return {provider:DEFAULT_INFERENCE_PROFILE.provider,requestedProfile:DEFAULT_INFERENCE_PROFILE,
  profileFingerprint:fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE),accountFingerprint,kind:'passed' as const,
  effectiveProfile:{provider:DEFAULT_INFERENCE_PROFILE.provider,api:DEFAULT_INFERENCE_PROFILE.api,model:DEFAULT_INFERENCE_PROFILE.model,
    providerThinkingLevel:DEFAULT_INFERENCE_PROFILE.reasoningEffort,reasoningEvidence:'sdk-payload-and-response' as const},
  measuredUsage:{input:19,output:1,cacheRead:0,cacheWrite:0,totalTokens:20}};}
function attachAccessReceipt(journal:ReturnType<typeof openJournal>,key:number){
  const started=journal.createPiAccessJob({principalId,idempotencyKey:uuid(key),profile:DEFAULT_INFERENCE_PROFILE});
  if(started.kind!=='created')assert.fail(`No se creó access-check: ${started.kind}`);
  const lease={ownerToken:uuid(key+1),claimToken:uuid(key+2)};
  const claimed=journal.claimPiAccessJob({jobId:started.job.jobId,expectedRevision:0,...lease});if(claimed.kind!=='claimed')assert.fail('No se reclamó access-check');
  const checkedAt=new Date(Date.now()-2_000).toISOString();const expiresAt=new Date(Date.now()+120_000).toISOString();
  const completed=journal.completePiAccessJob({jobId:started.job.jobId,expectedRevision:1,lease,result:accessResult(),checkedAt,expiresAt});
  if(completed.kind!=='updated')assert.fail(`No se registró recibo access-check: ${completed.kind}`);
  return {jobId:started.job.jobId,provider:DEFAULT_INFERENCE_PROFILE.provider,profileFingerprint:fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE),
    accountFingerprint,resultKind:'passed' as const,checkedAt,expiresAt};
}
function evaluation(input:{fence:{configurationRevision:number;configurationHash:string;worldRevision:number;worldSeq:number;fictitiousAt:number};receipt:ReturnType<typeof attachAccessReceipt>}){
  return {fence:input.fence,result:{kind:'passed' as const,checkedAt:new Date().toISOString(),checks:[
    'configuration','configuration-version','world-snapshot','prepared-contexts','catalog-eligibility','inference-profile',
    'pi-sdk','pi-profile','provider-authentication','pi-runtime','icm-memory','budget','provider-access-check',
    'participant-availability','voice',
  ].map((checkId)=>({kind:'passed' as const,checkId,code:`${checkId}-passed`}))},
    evidence:{provider:input.receipt.provider,profileFingerprint:input.receipt.profileFingerprint,accountFingerprint:input.receipt.accountFingerprint,accessReceipt:input.receipt}};
}

test('un preflight passed exige todos los gates sin duplicados',()=>{
  const checkedAt=new Date().toISOString();
  const checkIds=['configuration','configuration-version','world-snapshot','prepared-contexts','catalog-eligibility','inference-profile',
    'pi-sdk','pi-profile','provider-authentication','pi-runtime','icm-memory','budget','provider-access-check','participant-availability','voice'] as const;
  const checks=checkIds.map((checkId)=>({kind:'passed' as const,checkId}));
  assert.equal(RunPreflightResultSchema.safeParse({kind:'passed',checkedAt,checks:[checks[12]!]}).success,false);
  assert.equal(RunPreflightResultSchema.safeParse({kind:'passed',checkedAt,checks:checks.filter((check)=>check.checkId!=='voice')}).success,false);
  assert.equal(RunPreflightResultSchema.safeParse({kind:'passed',checkedAt,checks:[...checks,checks[0]!]}).success,false);
  assert.equal(RunPreflightResultSchema.safeParse({kind:'passed',checkedAt,checks}).success,true);
});

test('v23 crea jobs preflight para Ready/pausa/detenida y conserva receipt inicial idempotente',async()=>{
  const fixture=await setup();const directory=mkdtempSync(join(tmpdir(),'personajes-preflight-migrate-v21-'));const path=join(directory,'journal.sqlite');let journal=openJournal({path});
  try{
    const created=journal.createRunConfigurationDraft({principalId,idempotencyKey:uuid(10),patch:patchFor(fixture.configuration)});if(created.kind!=='created')assert.fail('No draft');
    const ready=journal.validateRunConfigurationDraft({principalId,idempotencyKey:uuid(11),runId:created.draft.runId,expectedRevision:0});if(ready.kind!=='ready')assert.fail('No Ready');
    const beforeMigration=new DatabaseSync(path);
    try{beforeMigration.exec(`DROP TABLE run_preflight_job_operations;DROP TABLE run_preflight_job_results;DROP TABLE run_preflight_job_history;DROP TABLE run_preflight_jobs;
      DROP TABLE model_time_spans; DROP TABLE model_time_run_state;
      DROP TABLE IF EXISTS actor_activation_invitation_jobs; DROP TABLE IF EXISTS actor_activation_invitations; DROP TABLE IF EXISTS actor_activation_causes; DROP TABLE IF EXISTS routine_clock_advances;
      DROP TABLE IF EXISTS circumstance_operations;DROP TABLE IF EXISTS actor_state_cuts; DROP TABLE IF EXISTS actor_state_cut_batches; DROP TABLE IF EXISTS fork_projection_receipts; DROP TABLE IF EXISTS fork_job_history; DROP TABLE IF EXISTS fork_dramatic_seeds; DROP TABLE IF EXISTS fork_job_retries; DROP TABLE IF EXISTS fork_backup_sources; DROP TABLE IF EXISTS fork_jobs; DROP TABLE IF EXISTS run_configuration_revisions; DELETE FROM schema_version WHERE version IN(21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38);`);}finally{beforeMigration.close();}
    journal.close();journal=openJournal({path});
    const result=journal.createRunPreflightJob({principalId,idempotencyKey:uuid(12),runId:created.draft.runId,expectedConfigurationRevision:0,expectedWorldRevision:4});
    assert.equal(result.kind,'created');if(result.kind!=='created')assert.fail('No job');
    assert.equal(result.job.state,'queued');assert.equal(result.job.worldSeq,6);assert.equal(result.job.fictitiousAt,1_234_567_890_000);
    assert.deepEqual(journal.createRunPreflightJob({principalId,idempotencyKey:uuid(12),runId:created.draft.runId,expectedConfigurationRevision:0,expectedWorldRevision:4}),{kind:'existing',job:result.job});
    assert.equal(journal.createRunPreflightJob({principalId,idempotencyKey:uuid(13),runId:created.draft.runId,expectedConfigurationRevision:1,expectedWorldRevision:4}).kind,'stale');
    const found=journal.readRunPreflightJob({runId:created.draft.runId,jobId:result.job.jobId});assert.equal(found.kind,'found');
    if(found.kind==='found'){assert.equal(found.document.report.kind,'current');assert.equal(found.document.report.result,null);}
    assert.equal(journal.readRunConfigurationDraftState({runId:created.draft.runId})?.lifecycle,'ready');
    const inspect=new DatabaseSync(path);try{assert.equal(inspect.prepare('SELECT MAX(version) version FROM schema_version').get()?.version, 38);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_events').get()?.n,0);assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_commits').get()?.n,0);
      assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(),[]);}finally{inspect.close();}
  }finally{journal.close();fixture.close();rmSync(directory,{recursive:true,force:true});}
});

test('claim congela Ready, completion exacta sobrevive restart y GET conserva resultado marcado stale',async()=>{
  const fixture=await readyJournal();let journal=fixture.journal;
  try{
    const created=start(journal,fixture.runId,20);if(created.kind!=='created')assert.fail('No job');const job=created.job;
    const claim=journal.claimRunPreflightJob({runId:fixture.runId,jobId:job.jobId,expectedRevision:0,ownerToken:owner,claimToken:uuid(901)});
    if(claim.kind!=='claimed')assert.fail(`No se reclamó job: ${claim.kind}`);
    const frozen=journal.readRunPreflightJobInput({runId:fixture.runId,jobId:job.jobId,lease:claim.lease});if(frozen.kind!=='found')assert.fail('No se recuperó corte congelado');
    assert.equal(ReadyRunConfigurationSchema.parse(frozen.configuration).runId,fixture.runId);assert.equal(frozen.fence.worldRevision,job.worldRevision);assert.equal(frozen.fence.worldSeq,job.worldSeq);
    const receipt=attachAccessReceipt(journal,23);const completeRequest={runId:fixture.runId,jobId:job.jobId,expectedRevision:claim.job.revision,lease:claim.lease,evaluation:evaluation({fence:frozen.fence,receipt})};
    assert.equal(journal.completeRunPreflightJob(completeRequest).kind,'updated');
    journal=fixture.reopen();
    assert.equal(journal.completeRunPreflightJob(completeRequest).kind,'existing');
    assert.equal(journal.readRunPreflightJob({runId:fixture.runId,jobId:job.jobId}).kind,'found');
  }finally{fixture.close();}
});

test('recovery interrumpe jobs queued/running y el claim anterior no se vuelve a ejecutar automáticamente',async()=>{
  const fixture=await readyJournal();let second:ReturnType<typeof openJournal>|undefined;
  try{
    const first=start(fixture.journal,fixture.runId,30);const next=start(fixture.journal,fixture.runId,31);
    if(first.kind!=='created'||next.kind!=='created')assert.fail('No se crearon jobs');
    const lease={ownerToken:uuid(930),claimToken:uuid(931)};
    const claim=fixture.journal.claimRunPreflightJob({runId:fixture.runId,jobId:first.job.jobId,expectedRevision:0,...lease});assert.equal(claim.kind,'claimed');
    assert.equal(fixture.journal.claimRunPreflightJob({runId:fixture.runId,jobId:next.job.jobId,expectedRevision:0,ownerToken:uuid(932),claimToken:uuid(933)}).kind,'busy');
    second=openJournal({path:fixture.path});assert.equal(second.recoverAbandonedRunPreflightJobs({ownerToken:uuid(934)}),2);
    assert.equal(second.readRunPreflightJob({runId:fixture.runId,jobId:first.job.jobId}).kind,'found');
    const input=second.readRunPreflightJobInput({runId:fixture.runId,jobId:first.job.jobId,lease});assert.equal(input.kind,'stale');
    assert.equal(second.claimRunPreflightJob({runId:fixture.runId,jobId:first.job.jobId,expectedRevision:2,ownerToken:uuid(935),claimToken:uuid(936)}).kind,'terminal');
    const inspect=new DatabaseSync(fixture.path);try{assert.equal(inspect.prepare("SELECT COUNT(*) n FROM run_preflight_jobs WHERE state='queued'").get()?.n,0);}finally{inspect.close();}
  }finally{fixture.close();}
});

test('completion valida fences y recibo real, usa proof exacto y oculta hashes/fingerprints del DTO',async()=>{
  const fixture=await readyJournal();let reopened:ReturnType<typeof openJournal>|undefined;
  try{
    const created=start(fixture.journal,fixture.runId,40);if(created.kind!=='created')assert.fail('No job');
    const job=created.job;const lease={ownerToken:uuid(940),claimToken:uuid(941)};
    const claimed=fixture.journal.claimRunPreflightJob({runId:fixture.runId,jobId:job.jobId,expectedRevision:0,...lease});if(claimed.kind!=='claimed')assert.fail('No claim');
    assert.equal(fixture.journal.claimRunPreflightJob({runId:fixture.runId,jobId:job.jobId,expectedRevision:0,ownerToken:uuid(942),claimToken:uuid(943)}).kind,'busy');
    const frozen=fixture.journal.readRunPreflightJobInput({runId:fixture.runId,jobId:job.jobId,lease});if(frozen.kind!=='found')assert.fail('No se recuperó corte congelado');
    assert.equal(ReadyRunConfigurationSchema.parse(frozen.configuration).runId,fixture.runId);assert.equal(frozen.fence.configurationHash.length,64);
    const receipt=attachAccessReceipt(fixture.journal,44);const completeRequest={runId:fixture.runId,jobId:job.jobId,expectedRevision:1,lease,evaluation:evaluation({fence:frozen.fence,receipt})};
    assert.throws(()=>fixture.journal.completeRunPreflightJob({...completeRequest,evaluation:{...completeRequest.evaluation,fence:{...frozen.fence,worldSeq:frozen.fence.worldSeq+1}}}),/corte Ready congelado/);
    assert.equal(fixture.journal.completeRunPreflightJob(completeRequest).kind,'updated');
    const before=fixture.journal.readRunPreflightJob({runId:fixture.runId,jobId:job.jobId});assert.equal(before.kind,'found');
    if(before.kind==='found'){
      assert.equal(before.document.report.result?.kind,'passed');
      assert.equal(JSON.stringify(before.document).includes(accountFingerprint),false);
      assert.equal(JSON.stringify(before.document).includes(receipt.profileFingerprint),false);
      assert.equal(JSON.stringify(before.document).includes(receipt.jobId),false);
      assert.equal(JSON.stringify(before.document).includes(frozen.fence.configurationHash),false);
    }
    reopened=fixture.reopen();
    assert.equal(reopened.completeRunPreflightJob(completeRequest).kind,'existing');
    assert.equal(reopened.setWorldLifecycle({runId:fixture.runId,expectedWorldRevision:job.worldRevision,expectedConfigRevision:job.configurationRevision,target:'running'}),'updated');
    const after=reopened.readRunPreflightJob({runId:fixture.runId,jobId:job.jobId});assert.equal(after.kind,'found');
    if(after.kind==='found'){assert.equal(after.document.report.kind,'stale');assert.equal(after.document.report.result?.kind,'passed');}
    const changed={...completeRequest,evaluation:{...completeRequest.evaluation,result:{...completeRequest.evaluation.result,checkedAt:new Date(Date.now()+1).toISOString()}}};
    assert.equal(reopened.completeRunPreflightJob(changed).kind,'terminal');
  }finally{reopened?.close();fixture.close();}
});

test('GET reduce códigos de check desconocidos a códigos cerrados sin reescribir el resultado durable',async()=>{
  const fixture=await readyJournal();
  try{
    const created=start(fixture.journal,fixture.runId,47);if(created.kind!=='created')assert.fail('No job');
    const lease={ownerToken:uuid(947),claimToken:uuid(948)};
    const claimed=fixture.journal.claimRunPreflightJob({runId:fixture.runId,jobId:created.job.jobId,expectedRevision:0,...lease});
    if(claimed.kind!=='claimed')assert.fail('No claim');
    const frozen=fixture.journal.readRunPreflightJobInput({runId:fixture.runId,jobId:created.job.jobId,lease});
    if(frozen.kind!=='found')assert.fail('No input');
    const receipt=attachAccessReceipt(fixture.journal,49);
    const base=evaluation({fence:frozen.fence,receipt});
    const checks=base.result.checks.map((entry)=>{
      if(entry.checkId==='pi-sdk')return {...entry,kind:'blocked' as const,code:'private-provider-message-123'};
      if(entry.checkId==='icm-memory')return {...entry,kind:'deferred' as const,code:'local-path-secret-456'};
      if(entry.checkId==='pi-runtime')return {...entry,kind:'unavailable' as const,code:'credential-detail-secret-789'};
      return entry;
    });
    const result=RunPreflightResultSchema.parse({...base.result,kind:'blocked',checks});
    const request={runId:fixture.runId,jobId:created.job.jobId,expectedRevision:claimed.job.revision,lease,
      evaluation:{...base,result}};
    assert.equal(fixture.journal.completeRunPreflightJob(request).kind,'updated');
    const document=fixture.journal.readRunPreflightJob({runId:fixture.runId,jobId:created.job.jobId});
    if(document.kind!=='found')assert.fail('No document');
    const projected=document.document.report.result;
    assert.ok(projected);
    assert.equal(projected.checks.find((entry)=>entry.checkId==='pi-sdk')?.code,'check-blocked');
    assert.equal(projected.checks.find((entry)=>entry.checkId==='icm-memory')?.code,'check-deferred');
    assert.equal(projected.checks.find((entry)=>entry.checkId==='pi-runtime')?.code,'check-unavailable');
    assert.doesNotMatch(JSON.stringify(document),/private-provider-message-123|local-path-secret-456|credential-detail-secret-789/);
    const stored=new DatabaseSync(fixture.path);
    try{const row=stored.prepare('SELECT result_json FROM run_preflight_job_results WHERE job_id=?').get(created.job.jobId) as {result_json:string};
      assert.match(row.result_json,/private-provider-message-123/);
    }finally{stored.close();}
  }finally{fixture.close();}
});

test('GET marca stale si cambia la geometría del snapshot aunque revisión, secuencia y reloj sigan iguales',async()=>{
  const fixture=await readyJournal();
  try{
    const created=start(fixture.journal,fixture.runId,48);if(created.kind!=='created')assert.fail('No job');
    const lease={ownerToken:uuid(950),claimToken:uuid(951)};
    const claimed=fixture.journal.claimRunPreflightJob({runId:fixture.runId,jobId:created.job.jobId,expectedRevision:0,...lease});
    if(claimed.kind!=='claimed')assert.fail('No claim');
    const frozen=fixture.journal.readRunPreflightJobInput({runId:fixture.runId,jobId:created.job.jobId,lease});
    if(frozen.kind!=='found')assert.fail('No input');
    const receipt=attachAccessReceipt(fixture.journal,50);
    const request={runId:fixture.runId,jobId:created.job.jobId,expectedRevision:claimed.job.revision,lease,
      evaluation:evaluation({fence:frozen.fence,receipt})};
    assert.equal(fixture.journal.completeRunPreflightJob(request).kind,'updated');
    const evidence=fixture.journal.readRunPreflightJobEvidence({runId:fixture.runId,jobId:created.job.jobId});
    assert.equal(evidence.kind,'found');
    assert.equal(fixture.journal.readRunPreflightJobEvidence({runId:fixture.runId,jobId:uuid(999)}).kind,'missing');

    const live=fixture.journal.loadWorld({runId:fixture.runId});assert.ok(live);
    const altered=WorldSnapshotSchema.parse({...live,places:live.places.map((place,index)=>index===0?{...place,name:place.name+' alterado'}:place)});
    assert.equal(altered.revision,created.job.worldRevision);
    assert.equal(altered.seq,created.job.worldSeq);
    assert.equal(altered.clock.instant,created.job.fictitiousAt);
    const database=new DatabaseSync(fixture.path);
    try{database.prepare('UPDATE world_runs SET snapshot_json=?,snapshot_hash=? WHERE run_id=?').run(canonical(altered),hash(altered),fixture.runId);}
    finally{database.close();}
    const current=fixture.journal.readRunPreflightJob({runId:fixture.runId,jobId:created.job.jobId});
    if(current.kind!=='found')assert.fail('No current job');
    assert.equal(current.document.report.kind,'stale');
    assert.equal(current.document.report.result?.kind,'passed');
  }finally{fixture.close();}
});

test('GET conserva el resultado histórico stale si una edición convierte Ready en borrador',async()=>{
  const fixture=await readyJournal();
  try{
    const created=start(fixture.journal,fixture.runId,54);if(created.kind!=='created')assert.fail('No job');
    const lease={ownerToken:uuid(956),claimToken:uuid(957)};
    const claimed=fixture.journal.claimRunPreflightJob({runId:fixture.runId,jobId:created.job.jobId,expectedRevision:0,...lease});
    if(claimed.kind!=='claimed')assert.fail('No claim');
    const frozen=fixture.journal.readRunPreflightJobInput({runId:fixture.runId,jobId:created.job.jobId,lease});
    if(frozen.kind!=='found')assert.fail('No frozen input');
    const receipt=attachAccessReceipt(fixture.journal,58);
    assert.equal(fixture.journal.completeRunPreflightJob({runId:fixture.runId,jobId:created.job.jobId,
      expectedRevision:claimed.job.revision,lease,evaluation:evaluation({fence:frozen.fence,receipt})}).kind,'updated');

    const edited=fixture.journal.updateRunConfigurationDraft({principalId,idempotencyKey:uuid(59),runId:fixture.runId,
      expectedRevision:0,patch:{name:configured('Borrador editado después del preflight')}});
    if(edited.kind!=='stored')assert.fail(`La edición de Ready no quedó en borrador: ${edited.kind}`);

    const document=fixture.journal.readRunPreflightJob({runId:fixture.runId,jobId:created.job.jobId});
    if(document.kind!=='found')assert.fail('No se recuperó el documento de preflight');
    assert.equal(document.document.report.kind,'stale');
    assert.equal(document.document.report.result?.kind,'passed');
  }finally{fixture.close();}
});

test('un access-check aborted más reciente invalida el informe passed anterior',async()=>{
  const fixture=await readyJournal();
  try{
    const created=start(fixture.journal,fixture.runId,51);if(created.kind!=='created')assert.fail('No job');
    const lease={ownerToken:uuid(952),claimToken:uuid(953)};
    const claimed=fixture.journal.claimRunPreflightJob({runId:fixture.runId,jobId:created.job.jobId,expectedRevision:0,...lease});
    if(claimed.kind!=='claimed')assert.fail('No claim');
    const frozen=fixture.journal.readRunPreflightJobInput({runId:fixture.runId,jobId:created.job.jobId,lease});
    if(frozen.kind!=='found')assert.fail('No input');
    const receipt=attachAccessReceipt(fixture.journal,52);
    assert.equal(fixture.journal.completeRunPreflightJob({runId:fixture.runId,jobId:created.job.jobId,
      expectedRevision:claimed.job.revision,lease,evaluation:evaluation({fence:frozen.fence,receipt})}).kind,'updated');
    const before=fixture.journal.readRunPreflightJob({runId:fixture.runId,jobId:created.job.jobId});
    if(before.kind!=='found')assert.fail('No completed preflight');
    assert.equal(before.document.report.kind,'current');

    const laterStart=fixture.journal.createPiAccessJob({principalId,idempotencyKey:uuid(53),profile:DEFAULT_INFERENCE_PROFILE});
    if(laterStart.kind!=='created')assert.fail('No later access-check');
    const later=laterStart.job;
    const laterClaim=fixture.journal.claimPiAccessJob({jobId:later.jobId,expectedRevision:0,ownerToken:uuid(954),claimToken:uuid(955)});
    if(laterClaim.kind!=='claimed')assert.fail('No later access-check claim');
    const accessProfileFingerprint=fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE);
    assert.equal(fixture.journal.completePiAccessJob({jobId:later.jobId,expectedRevision:laterClaim.job.revision,lease:laterClaim.lease,
      result:{provider:DEFAULT_INFERENCE_PROFILE.provider,requestedProfile:DEFAULT_INFERENCE_PROFILE,profileFingerprint:accessProfileFingerprint,
        accountFingerprint:null,kind:'aborted',code:'CANCELLED_BEFORE_DISPATCH'},
      checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120_000).toISOString()}).kind,'updated');
    const after=fixture.journal.readRunPreflightJob({runId:fixture.runId,jobId:created.job.jobId});
    if(after.kind!=='found')assert.fail('No completed preflight');
    assert.equal(after.document.report.kind,'stale');
    assert.equal(after.document.report.result?.kind,'passed');
  }finally{fixture.close();}
});

test('preflight operations comparten namespace con OAuth y access-check; cancel es durable y CAS',async()=>{
  const fixture=await readyJournal();let reopened:ReturnType<typeof openJournal>|undefined;
  try{
    const created=start(fixture.journal,fixture.runId,50);if(created.kind!=='created')assert.fail('No job');
    assert.equal(fixture.journal.createPiAccessJob({principalId,idempotencyKey:uuid(50),profile:DEFAULT_INFERENCE_PROFILE}).kind,'idempotencyConflict');
    const canceled=fixture.journal.cancelRunPreflightJob({principalId,idempotencyKey:uuid(51),runId:fixture.runId,jobId:created.job.jobId,expectedRevision:0});
    assert.equal(canceled.kind,'updated');if(canceled.kind!=='updated')assert.fail('No cancel');assert.equal(canceled.job.state,'canceled');
    assert.deepEqual(fixture.journal.cancelRunPreflightJob({principalId,idempotencyKey:uuid(51),runId:fixture.runId,jobId:created.job.jobId,expectedRevision:0}),canceled);
    reopened=fixture.reopen();assert.deepEqual(reopened.cancelRunPreflightJob({principalId,idempotencyKey:uuid(51),runId:fixture.runId,jobId:created.job.jobId,expectedRevision:0}),canceled);
  }finally{fixture.close();}
});

test('controles de corrida requieren preflight, son idempotentes y conservan lifecycle durable',async()=>{
  const fixture=await readyJournal();
  try{
    const initial=fixture.journal.readWorldLifecycle({runId:fixture.runId});
    assert.equal(initial?.lifecycle,'ready');
    assert.equal(initial?.lifecycleRevision,0);

    const blocked=fixture.journal.applyRunLifecycleCommand({principalId,idempotencyKey:uuid(70),runId:fixture.runId,
      expectedLifecycleRevision:0,expectedConfigRevision:initial!.configRevision,expectedWorldRevision:initial!.worldRevision,
      command:{kind:'start'},preflightJobId:uuid(71)});
    assert.equal(blocked.kind,'preflightBlocked');
    assert.equal(fixture.journal.readWorldLifecycle({runId:fixture.runId})?.lifecycle,'ready');

    const created=start(fixture.journal,fixture.runId,72);if(created.kind!=='created')assert.fail('No se creó el preflight de arranque');
    const lease={ownerToken:uuid(973),claimToken:uuid(974)};
    const claimed=fixture.journal.claimRunPreflightJob({runId:fixture.runId,jobId:created.job.jobId,expectedRevision:0,...lease});
    if(claimed.kind!=='claimed')assert.fail('No se reclamó el preflight de arranque');
    const frozen=fixture.journal.readRunPreflightJobInput({runId:fixture.runId,jobId:created.job.jobId,lease});
    if(frozen.kind!=='found')assert.fail('No se congeló el corte de arranque');
    const receipt=attachAccessReceipt(fixture.journal,75);
    const completed=fixture.journal.completeRunPreflightJob({runId:fixture.runId,jobId:created.job.jobId,
      expectedRevision:claimed.job.revision,lease,evaluation:evaluation({fence:frozen.fence,receipt})});
    assert.equal(completed.kind,'updated');

    const ready=fixture.journal.readWorldLifecycle({runId:fixture.runId});assert.ok(ready);
    const command={principalId,idempotencyKey:uuid(78),runId:fixture.runId,expectedLifecycleRevision:ready.lifecycleRevision,
      expectedConfigRevision:ready.configRevision,expectedWorldRevision:ready.worldRevision,
      command:{kind:'start' as const},preflightJobId:created.job.jobId};
    const started=fixture.journal.applyRunLifecycleCommand(command);
    assert.equal(started.kind,'updated');if(started.kind!=='updated')assert.fail('La corrida no inició');
    assert.equal(started.state.lifecycle,'running');assert.equal(started.state.lifecycleRevision,1);assert.equal(started.state.closedAt,null);
    assert.deepEqual(fixture.journal.applyRunLifecycleCommand(command),{kind:'updated',state:started.state});
    assert.equal(fixture.journal.applyRunLifecycleCommand({...command,preflightJobId:uuid(81)}).kind,'idempotencyConflict');

    const pause=fixture.journal.applyRunLifecycleCommand({principalId,idempotencyKey:uuid(79),runId:fixture.runId,
      expectedLifecycleRevision:1,expectedConfigRevision:started.state.configRevision,expectedWorldRevision:started.state.worldRevision,
      command:{kind:'pause'}});
    assert.equal(pause.kind,'updated');if(pause.kind!=='updated')assert.fail('La corrida no pausó');
    assert.equal(pause.state.lifecycle,'paused');assert.equal(pause.state.lifecycleRevision,2);

    const close=fixture.journal.applyRunLifecycleCommand({principalId,idempotencyKey:uuid(80),runId:fixture.runId,
      expectedLifecycleRevision:2,expectedConfigRevision:pause.state.configRevision,expectedWorldRevision:pause.state.worldRevision,
      command:{kind:'close'}});
    assert.equal(close.kind,'updated');if(close.kind!=='updated')assert.fail('La corrida no cerró');
    assert.equal(close.state.lifecycle,'closed');assert.ok(close.state.closedAt);
    assert.deepEqual(fixture.journal.readWorldLifecycle({runId:fixture.runId}),close.state);
    assert.deepEqual(fixture.reopen().readWorldLifecycle({runId:fixture.runId}),close.state);
  }finally{fixture.close();}
});

async function passedPreflight(fixture: Awaited<ReturnType<typeof readyJournal>>, key: number) {
  const state = fixture.journal.readWorldLifecycle({runId:fixture.runId}); assert.ok(state);
  const created = start(fixture.journal,fixture.runId,key,state.configRevision,state.worldRevision);
  if (created.kind !== 'created') assert.fail(`Preflight no creado: ${created.kind}`);
  const lease = {ownerToken:uuid(key+1),claimToken:uuid(key+2)};
  const claimed = fixture.journal.claimRunPreflightJob({runId:fixture.runId,jobId:created.job.jobId,expectedRevision:0,...lease});
  if (claimed.kind !== 'claimed') assert.fail('Preflight no reclamado');
  const frozen = fixture.journal.readRunPreflightJobInput({runId:fixture.runId,jobId:created.job.jobId,lease});
  if (frozen.kind !== 'found') assert.fail('Preflight sin corte');
  const receipt = attachAccessReceipt(fixture.journal,key+3);
  const completed = fixture.journal.completeRunPreflightJob({runId:fixture.runId,jobId:created.job.jobId,
    expectedRevision:claimed.job.revision,lease,evaluation:evaluation({fence:frozen.fence,receipt})});
  assert.equal(completed.kind,'updated');
  return created.job.jobId;
}

async function prepareStep(fixture: Awaited<ReturnType<typeof readyJournal>>, causes = 0) {
  const initial = fixture.journal.readWorldLifecycle({runId:fixture.runId}); assert.ok(initial);
  assert.equal(fixture.journal.setWorldLifecycle({runId:fixture.runId,expectedConfigRevision:initial.configRevision,
    expectedWorldRevision:initial.worldRevision,target:'running'}),'updated');
  const actorId = fixture.configuration.roster.activeCharacterIds[0]; assert.ok(actorId);
  for (let index = 0; index < causes; index += 1) {
    const snapshot = fixture.journal.loadWorld({runId:fixture.runId}); assert.ok(snapshot);
    const intervention = fixture.journal.commitHumanIntervention({runId:fixture.runId,participantId:'visitante-prueba',
      expectedRevision:snapshot.revision,idempotencyKey:uuid(1500+index),request:{kind:'speech',recipientCharacterIds:[actorId],
      channelId:'00000000-0000-4000-8000-000000000104',content:{kind:'speech',text:`Causa sintética ${index}`}}});
    assert.equal(intervention.kind,'stored');
    const {createDeliverWorldWorker} = await import('../src/application/deliver-world.ts');
    assert.equal((await createDeliverWorldWorker({journal:fixture.journal,runId:fixture.runId,actorId}).drain()).kind,'completed');
  }
  const running = fixture.journal.readWorldLifecycle({runId:fixture.runId}); assert.ok(running);
  assert.equal(fixture.journal.setWorldLifecycle({runId:fixture.runId,expectedConfigRevision:running.configRevision,
    expectedWorldRevision:running.worldRevision,target:'paused'}),'updated');
  const preflightJobId = await passedPreflight(fixture,1600);
  const state = fixture.journal.readWorldLifecycle({runId:fixture.runId}); assert.ok(state);
  const command = {principalId,idempotencyKey:uuid(1700),runId:fixture.runId,expectedLifecycleRevision:state.lifecycleRevision,
    expectedConfigRevision:state.configRevision,expectedWorldRevision:state.worldRevision,command:{kind:'step' as const},preflightJobId};
  return {command,actorId};
}

test('step vacío tiene job durable, vuelve paused y replays no crean otra ejecución',async()=>{
  const fixture = await readyJournal();
  try {
    const {command} = await prepareStep(fixture);
    const accepted = fixture.journal.applyRunLifecycleCommand(command);
    if (accepted.kind !== 'accepted') assert.fail(`Step no aceptado: ${accepted.kind}`);
    assert.equal(accepted.state.lifecycle,'running');
    assert.equal(accepted.job.pulseId,null);
    assert.deepEqual(fixture.journal.applyRunLifecycleCommand(command),accepted);
    assert.equal(fixture.journal.beginCoordinatorPulse({runId:fixture.runId}).kind,'idle');
    assert.equal(fixture.journal.readWorldLifecycle({runId:fixture.runId})?.lifecycle,'paused');
    const completed = fixture.journal.readRunStepJob({runId:fixture.runId,jobId:accepted.job.jobId});
    assert.equal(completed?.state,'succeeded');
    assert.deepEqual(fixture.reopen().readRunStepJob({runId:fixture.runId,jobId:accepted.job.jobId}),completed);
    assert.deepEqual(fixture.journal.applyRunLifecycleCommand(command),accepted);
    assert.equal(fixture.journal.readActiveRunStepJob({runId:fixture.runId}),undefined);
  } finally {fixture.close();}
});

test('step consume exactamente una causa, conserva su pulso al reinicio y no convoca la siguiente',async()=>{
  const fixture = await readyJournal();
  try {
    const {command} = await prepareStep(fixture,2);
    const accepted = fixture.journal.applyRunLifecycleCommand(command);
    if (accepted.kind !== 'accepted') assert.fail('Step no aceptado');
    const begin = fixture.journal.beginCoordinatorPulse({runId:fixture.runId});
    if (begin.kind !== 'started') assert.fail('Step no inició pulso');
    assert.equal(begin.jobs.length,1);
    const pulseId = begin.pulse.pulseId;
    assert.equal(fixture.journal.readRunStepJob({runId:fixture.runId,jobId:accepted.job.jobId})?.pulseId,pulseId);
    fixture.reopen();
    const recovered = fixture.journal.beginCoordinatorPulse({runId:fixture.runId});
    if (recovered.kind !== 'existing') assert.fail('No recuperó el mismo pulso');
    assert.equal(recovered.pulse.pulseId,pulseId);
    const job = recovered.jobs[0]; assert.ok(job);
    const claim = fixture.journal.claimActorTurnJob({runId:job.runId,actorId:job.actorId,jobId:job.jobId,
      generation:job.generation,ownerToken:uuid(1800),claimToken:uuid(1801)});
    if (claim.kind !== 'claimed') assert.fail('No reclamó job');
    fixture.journal.failActorTurnJob({execution:{runId:job.runId,actorId:job.actorId,jobId:job.jobId,generation:job.generation,
      pulseId,lease:{ownerToken:claim.ownerToken,claimToken:claim.claimToken}},code:'execution-failed'});
    assert.equal(fixture.journal.closeCoordinatorPulse({runId:fixture.runId,pulseId}).state,'blocked');
    const noSecond = fixture.journal.beginCoordinatorPulse({runId:fixture.runId});
    if (noSecond.kind !== 'existing') assert.fail('Perdió pulso acotado');
    assert.equal(noSecond.pulse.pulseId,pulseId);
    assert.equal(fixture.journal.completeRunStepJob({runId:fixture.runId,jobId:accepted.job.jobId})?.state,'failed');
    assert.equal(fixture.journal.readWorldLifecycle({runId:fixture.runId})?.lifecycle,'paused');
    assert.equal(fixture.journal.beginCoordinatorPulse({runId:fixture.runId}).kind,'inactive');
    const database = new DatabaseSync(fixture.path);
    try {assert.equal(database.prepare('SELECT COUNT(*) n FROM coordinator_pulses WHERE run_id=?').get(fixture.runId)?.n,1);}
    finally {database.close();}
  } finally {fixture.close();}
});

test('recovery interrumpe step sin inferencia; nuevo control fresco reutiliza job y pulso con época nueva',async()=>{
  const fixture = await readyJournal();
  try {
    const {command} = await prepareStep(fixture,1);
    const accepted = fixture.journal.applyRunLifecycleCommand(command);
    if (accepted.kind !== 'accepted') assert.fail('Step no aceptado');
    const begin = fixture.journal.beginCoordinatorPulse({runId:fixture.runId});
    if (begin.kind !== 'started') assert.fail('Sin pulso');
    const interrupted = fixture.reopen().interruptRunStepJob({runId:fixture.runId});
    assert.equal(interrupted?.state,'interrupted');
    assert.equal(fixture.journal.readWorldLifecycle({runId:fixture.runId})?.lifecycle,'paused');
    assert.equal(fixture.journal.beginCoordinatorPulse({runId:fixture.runId}).kind,'inactive');
    const state = fixture.journal.readWorldLifecycle({runId:fixture.runId}); assert.ok(state);
    const fresh = await passedPreflight(fixture,1900);
    const resumed = fixture.journal.applyRunLifecycleCommand({...command,idempotencyKey:uuid(1910),preflightJobId:fresh,
      expectedLifecycleRevision:state.lifecycleRevision});
    if (resumed.kind !== 'accepted') assert.fail(`No reanudó: ${resumed.kind}`);
    assert.equal(resumed.job.jobId,accepted.job.jobId);
    assert.equal(resumed.job.pulseId,begin.pulse.pulseId);
    assert.ok(resumed.job.lifecycleRevision > accepted.job.lifecycleRevision);
    const same = fixture.journal.beginCoordinatorPulse({runId:fixture.runId});
    if (same.kind !== 'existing') assert.fail('Cambió pulso');
    assert.equal(same.pulse.pulseId,begin.pulse.pulseId);
    assert.equal(same.jobs[0]?.lifecycleRevision,resumed.job.lifecycleRevision);
  } finally {fixture.close();}
});

test('pausa/stop cancela el job de paso y fence impide nuevas escrituras actorales',async()=>{
  const fixture = await readyJournal();
  try {
    const {command} = await prepareStep(fixture,1);
    const accepted = fixture.journal.applyRunLifecycleCommand(command);
    if (accepted.kind !== 'accepted') assert.fail('Step no aceptado');
    const begin = fixture.journal.beginCoordinatorPulse({runId:fixture.runId});
    if (begin.kind !== 'started') assert.fail('Sin pulso');
    const job = begin.jobs[0]; assert.ok(job);
    const lease = {ownerToken:uuid(2000),claimToken:uuid(2001)};
    const claim = fixture.journal.claimActorTurnJob({runId:job.runId,actorId:job.actorId,jobId:job.jobId,generation:job.generation,...lease});
    assert.equal(claim.kind,'claimed');
    const stopped = fixture.journal.applyRunLifecycleCommand({...command,idempotencyKey:uuid(2002),command:{kind:'stop'},
      preflightJobId:undefined,expectedLifecycleRevision:accepted.state.lifecycleRevision});
    assert.equal(stopped.kind,'updated');
    assert.equal(fixture.journal.readRunStepJob({runId:fixture.runId,jobId:accepted.job.jobId})?.state,'canceled');
    const eligibility = fixture.journal.checkActorJobEligibility({runId:job.runId,actorId:job.actorId,jobId:job.jobId,
      generation:job.generation,pulseId:job.pulseId,lease});
    assert.equal(eligibility.kind,'inactive');
  } finally {fixture.close();}
});

test('step conserva CAS, rechaza preflight ajeno y presupuesto agotado dentro del commit durable',async()=>{
  const fixture = await readyJournal();
  try {
    const {command} = await prepareStep(fixture,1);
    assert.equal(fixture.journal.applyRunLifecycleCommand({...command,idempotencyKey:uuid(2100),expectedWorldRevision:command.expectedWorldRevision-1}).kind,'stale');
    assert.equal(fixture.journal.applyRunLifecycleCommand({...command,idempotencyKey:uuid(2101),preflightJobId:uuid(2102)}).kind,'preflightBlocked');
    const database = new DatabaseSync(fixture.path);
    try {database.prepare('INSERT INTO run_budgets(run_id,max_calls,consumed) VALUES(?,?,?)').run(fixture.runId,20,20);}
    finally {database.close();}
    assert.equal(fixture.journal.applyRunLifecycleCommand({...command,idempotencyKey:uuid(2103)}).kind,'budgetExhausted');
    assert.equal(fixture.journal.readWorldLifecycle({runId:fixture.runId})?.lifecycle,'paused');
    assert.equal(fixture.journal.readActiveRunStepJob({runId:fixture.runId}),undefined);
  } finally {fixture.close();}
});

test('reanudar normalmente abandona el job step interrumpido y un paso posterior crea otro job',async()=>{
  const fixture = await readyJournal();
  try {
    const {command} = await prepareStep(fixture,1);
    const first = fixture.journal.applyRunLifecycleCommand(command);
    if (first.kind !== 'accepted') assert.fail('No primer step');
    fixture.journal.beginCoordinatorPulse({runId:fixture.runId});
    fixture.journal.interruptRunStepJob({runId:fixture.runId});
    const paused = fixture.journal.readWorldLifecycle({runId:fixture.runId}); assert.ok(paused);
    const preflightJobId = await passedPreflight(fixture,2200);
    const resumed = fixture.journal.applyRunLifecycleCommand({...command,idempotencyKey:uuid(2210),command:{kind:'resume'},
      expectedLifecycleRevision:paused.lifecycleRevision,preflightJobId});
    if (resumed.kind !== 'updated') assert.fail(`No resume: ${resumed.kind}`);
    assert.equal(fixture.journal.readRunStepJob({runId:fixture.runId,jobId:first.job.jobId})?.state,'canceled');
    const again = fixture.journal.applyRunLifecycleCommand({...command,idempotencyKey:uuid(2211),command:{kind:'pause'},preflightJobId:undefined,
      expectedLifecycleRevision:resumed.state.lifecycleRevision});
    if (again.kind !== 'updated') assert.fail('No pause');
    const fresh = await passedPreflight(fixture,2300);
    const second = fixture.journal.applyRunLifecycleCommand({...command,idempotencyKey:uuid(2310),preflightJobId:fresh,
      expectedLifecycleRevision:again.state.lifecycleRevision});
    if (second.kind !== 'accepted') assert.fail('No segundo step');
    assert.notEqual(second.job.jobId,first.job.jobId);
  } finally {fixture.close();}
});

test('preflight snapshot fresco no permite alterar campos estáticos bajo el hash del setup original',async()=>{
  const fixture = await readyJournal();
  try {
    const {command} = await prepareStep(fixture,1);
    const database = new DatabaseSync(fixture.path);
    try {
      const row = database.prepare('SELECT configuration_json,original_configuration_json,configuration_hash FROM run_preflight_jobs WHERE job_id=?').get(command.preflightJobId);
      assert.ok(row);
      const source = ReadyRunConfigurationSchema.parse(JSON.parse(String(row.original_configuration_json)));
      const frozen = ReadyRunConfigurationSchema.parse(JSON.parse(String(row.configuration_json)));
      assert.notEqual(source.worldSnapshot.revision,frozen.worldSnapshot.revision);
      assert.equal(hash(source),row.configuration_hash);
      const changed = canonical({...frozen,name:'Setup adulterado'});
      database.prepare('UPDATE run_preflight_jobs SET configuration_json=?,configuration_payload_hash=? WHERE job_id=?')
        .run(changed,createHash('sha256').update(changed).digest('hex'),command.preflightJobId);
    } finally {database.close();}
    assert.throws(()=>fixture.journal.readRunPreflightJob({runId:fixture.runId,jobId:command.preflightJobId}),/Metadata durable del preflight alterada/);
    assert.throws(()=>fixture.journal.applyRunLifecycleCommand(command),/Metadata durable del preflight alterada/);
    assert.equal(fixture.journal.readWorldLifecycle({runId:fixture.runId})?.lifecycle,'paused');
    assert.equal(fixture.journal.readActiveRunStepJob({runId:fixture.runId}),undefined);
  } finally {fixture.close();}
});
