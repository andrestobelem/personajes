import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { configuratorEvolutionFixture } from './fixtures/configurator-evolution.ts';
import { openConfiguratorJobLedger,CONFIGURATOR_JOB_SCHEMA_SQL } from '../src/adapters/configurator-job-ledger.ts';

async function fixture(){
 const f=await configuratorEvolutionFixture();const running=f.base.journal.readWorldLifecycle({runId:f.source.snapshot.runId});assert.ok(running);assert.equal(f.base.journal.setWorldLifecycle({runId:f.source.snapshot.runId,expectedWorldRevision:running.worldRevision,expectedConfigRevision:running.configRevision,target:'paused'}),'updated');const current=f.base.journal.readWorldLifecycle({runId:f.source.snapshot.runId});assert.ok(current);
 const db=new DatabaseSync(f.journalPath);db.exec(CONFIGURATOR_JOB_SCHEMA_SQL);db.close();
 let lifecycle:'ready'|'paused'|'stopped'|'running'='paused';let changed=false;let idle=true;
 const host={readHead:()=>({source:{...f.context.scope.kind==='evolution'?f.context.scope.anchor.source:f.source.cuts[0]?.source,...(changed?{worldRevision:999}:{})},lifecycle,lifecycleRevision:current.lifecycleRevision}),readForkSource:f.base.journal.readForkSource,assertIdle(){if(!idle)throw new Error('host busy');}};
 const ownerToken=randomUUID();const ledger=openConfiguratorJobLedger({journalPath:f.journalPath,privateDataRoot:f.base.directory,ownerToken,host,now:()=>1234});
 const request={principalId:'operator',idempotencyKey:randomUUID(),runId:f.source.snapshot.runId,actorId:f.characterId,expectedCommitIndex:f.source.cuts[0]?.source.commitIndex,expectedWorldRevision:f.source.snapshot.revision,expectedConfigurationRevision:f.source.configuration.configRevision,originalDossier:f.originalDossier};
 return {...f,ledger,host,ownerToken,request,setChanged(value:boolean){changed=value;},setIdle(value:boolean){idle=value;},setLifecycle(value:typeof lifecycle){lifecycle=value;},close(){ledger.close();f.close();}};
}

test('Configurator durable job has immutable idempotent creation receipt and exact owner/claim/head guards',async()=>{
 const f=await fixture();try{
  const started=f.ledger.begin(f.request);assert.equal(started.kind,'created');assert.equal(started.job.state,'queued');assert.equal(f.ledger.read({jobId:started.job.jobId,principalId:'operator'}).state,'queued');
  const claimed=f.ledger.claim({jobId:started.job.jobId,principalId:'operator',expectedRevision:0,claimToken:randomUUID()});assert.equal(claimed.job.state,'running');assert.equal(claimed.execution.role,'configurator');assert.equal('pulseId'in claimed.execution.scope,false);assert.deepEqual(f.ledger.eligibility(claimed.execution),{kind:'active'});assert.deepEqual(f.ledger.findBegin({principalId:'operator',idempotencyKey:f.request.idempotencyKey}),{job:started.job,context:claimed.context});
  f.setChanged(true);assert.equal(f.ledger.findBegin({principalId:'operator',idempotencyKey:randomUUID()}),undefined);assert.deepEqual(f.ledger.findBegin({principalId:'operator',idempotencyKey:f.request.idempotencyKey})?.job,started.job);assert.deepEqual(f.ledger.begin(f.request),{kind:'existing',job:started.job},'creation replay never substitutes the mutable current job');assert.equal(f.ledger.eligibility(claimed.execution).kind,'inactive');f.setChanged(false);f.setIdle(false);assert.equal(f.ledger.eligibility(claimed.execution).kind,'inactive');f.setIdle(true);
  assert.equal(f.ledger.eligibility({...claimed.execution,lease:{...claimed.execution.lease,claimToken:randomUUID()}}).kind,'inactive');assert.throws(()=>f.ledger.read({jobId:started.job.jobId,principalId:'foreign'}),/NOT_FOUND/);
  assert.throws(()=>f.ledger.begin({...f.request,actorId:'foreign'}),/IDEMPOTENCY/);assert.throws(()=>f.ledger.cancel({jobId:started.job.jobId,principalId:'operator',expectedRevision:1,idempotencyKey:f.request.idempotencyKey}),/IDEMPOTENCY/);
  assert.throws(()=>f.ledger.stageProposal({execution:claimed.execution,candidateId:randomUUID(),proposal:f.proposal}),/SESSION_MISSING/);
  const proof=f.approval;assert.throws(()=>f.ledger.requireAcceptedConfiguratorProposal({principalId:'operator',runId:f.request.runId,actorId:f.characterId,contextHash:proof.contextHash,proposalHash:proof.proposalHash,approvalHash:'a'.repeat(64),approval:proof}),/./,'a structural consent is not authority');
 }finally{f.close();}
});

test('failed jobs retry explicitly with one stable budget cohort and new context generation; cancellation and restart do not invoke inference',async()=>{
 const f=await fixture();try{
  const started=f.ledger.begin(f.request);const claim=f.ledger.claim({jobId:started.job.jobId,principalId:'operator',expectedRevision:0,claimToken:randomUUID()});const failed=f.ledger.fail({execution:claim.execution,code:'CONFIGURATOR_TEST_FAILURE'});assert.equal(failed.state,'failed');
  const retryRequest={jobId:failed.jobId,principalId:'operator',expectedRevision:failed.revision,idempotencyKey:randomUUID()};const retried=f.ledger.retry(retryRequest);assert.equal(retried.jobId,started.job.jobId);assert.equal(retried.generation,1);assert.equal(retried.state,'queued');assert.notEqual(retried.contextHash,started.job.contextHash);assert.deepEqual(f.ledger.retry(retryRequest),retried);assert.equal(f.ledger.eligibility(claim.execution).kind,'inactive');
  const cancelled=f.ledger.cancel({jobId:retried.jobId,principalId:'operator',expectedRevision:retried.revision,idempotencyKey:randomUUID()});assert.equal(cancelled.state,'cancelled');assert.throws(()=>f.ledger.retry({...retryRequest,idempotencyKey:randomUUID(),expectedRevision:cancelled.revision}),/RETRY_CONFLICT/);
  const second=f.ledger.begin({...f.request,idempotencyKey:randomUUID()});assert.equal(f.ledger.recoverInterrupted(),1);assert.equal(f.ledger.read({jobId:second.job.jobId,principalId:'operator'}).state,'interrupted');assert.equal(f.ledger.recoverInterrupted(),0);const list=f.ledger.list({principalId:'operator',runId:f.request.runId,limit:1});assert.equal(list.jobs.length,1);assert.equal(list.hasMore,true);assert.deepEqual(f.ledger.list({principalId:'foreign',runId:f.request.runId}),{jobs:[],hasMore:false});
 }finally{f.close();}
});

test('ledger checksums bind principals and every private payload and a SQL failure rolls back job plus immutable receipt',async()=>{
 const f=await fixture();try{
  const db=new DatabaseSync(f.journalPath);try{
   db.exec("CREATE TRIGGER reject_configurator_operation BEFORE INSERT ON configurator_operations BEGIN SELECT RAISE(ABORT,'synthetic crash'); END");assert.throws(()=>f.ledger.begin(f.request),/synthetic crash/);assert.equal(db.prepare('SELECT count(*) n FROM configurator_jobs').get()?.n,0);db.exec('DROP TRIGGER reject_configurator_operation');
   const started=f.ledger.begin(f.request);db.prepare('UPDATE configurator_jobs SET principal_id=? WHERE job_id=?').run('foreign',started.job.jobId);assert.throws(()=>f.ledger.read({jobId:started.job.jobId,principalId:'foreign'}),/CORRUPT/);
  }finally{db.close();}
 }finally{f.close();}
});

test('a reused session path cannot replace another job historical session ownership',async()=>{
 const f=await fixture();const db=new DatabaseSync(f.journalPath);try{
  const first=f.ledger.begin(f.request);const claim=f.ledger.claim({jobId:first.job.jobId,principalId:'operator',expectedRevision:0,claimToken:randomUUID()});
  const registration={execution:claim.execution,sessionId:randomUUID(),sessionPath:`${f.base.directory}/runs/${f.request.runId}/roles/configurador/sessions/shared.jsonl`,baseLeafId:null,profile:claim.execution.scope.profile};
  assert.equal(f.ledger.registerSession(registration),'stored');assert.equal(f.ledger.registerSession(registration),'existing');
  const original=db.prepare('SELECT * FROM configurator_sessions WHERE job_id=?').get(first.job.jobId);assert.ok(original);
  f.ledger.fail({execution:claim.execution,code:'CONFIGURATOR_TEST_FAILURE'});
  const second=f.ledger.begin({...f.request,idempotencyKey:randomUUID()});const next=f.ledger.claim({jobId:second.job.jobId,principalId:'operator',expectedRevision:0,claimToken:randomUUID()});
  assert.throws(()=>f.ledger.registerSession({...registration,execution:next.execution,sessionId:randomUUID()}),/NOT_INDEPENDENT/);
  assert.throws(()=>f.ledger.registerSession({...registration,execution:next.execution,sessionPath:registration.sessionPath.replace('shared.jsonl','reused-id.jsonl')}),/NOT_INDEPENDENT/);
  // Even a damaged foreign role row must reserve its session identity conservatively.
  db.exec('PRAGMA foreign_keys=OFF');
  for(const table of ['administrative_sessions','continuista_sessions']){
   const reserved={sessionId:randomUUID(),sessionPath:registration.sessionPath.replace('shared.jsonl',`${table}.jsonl`)};
   db.prepare(`INSERT INTO ${table}(job_id,generation,payload_json,payload_hash) VALUES(?,?,?,?)`).run(randomUUID(),0,JSON.stringify(reserved),'0'.repeat(64));
   assert.throws(()=>f.ledger.registerSession({...registration,execution:next.execution,sessionId:reserved.sessionId,sessionPath:registration.sessionPath.replace('shared.jsonl','new-role-path.jsonl')}),/NOT_INDEPENDENT/);
   assert.throws(()=>f.ledger.registerSession({...registration,execution:next.execution,sessionId:randomUUID(),sessionPath:reserved.sessionPath}),/NOT_INDEPENDENT/);
  }
  db.exec('PRAGMA foreign_keys=ON');
  assert.deepEqual(db.prepare('SELECT * FROM configurator_sessions WHERE job_id=?').get(first.job.jobId),original);
  assert.equal(db.prepare('SELECT count(*) n FROM configurator_sessions').get()?.n,1);
  assert.equal(f.ledger.registerSession({...registration,execution:next.execution,sessionId:randomUUID(),sessionPath:registration.sessionPath.replace('shared.jsonl','distinct.jsonl')}),'stored');
  assert.deepEqual(db.prepare('SELECT * FROM configurator_sessions WHERE job_id=?').get(first.job.jobId),original);
 }finally{db.close();f.close();}
});
