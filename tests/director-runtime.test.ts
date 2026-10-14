import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { test } from 'node:test';
import { setup } from './fixtures/continuista.ts';
import { controlledDirectorSessionFactory } from './fixtures/director-session.ts';
import { createDirectorPiWorker } from '../src/application/director-pi-worker.ts';

async function fixtureWithTerminalPulse() {
  const fixture=await setup();
  const db=new DatabaseSync(join(fixture.directory,'journal.sqlite'));
  try{db.exec('DELETE FROM actor_turn_job_inputs; DELETE FROM actor_turn_jobs;');}finally{db.close();}
  const begun=fixture.journal.beginCoordinatorPulse({runId:fixture.claim.runId});
  if(begun.kind!=='started')assert.fail(`Sin pulso: ${begun.kind}`);
  for(const job of begun.jobs){
    const lease={ownerToken:randomUUID(),claimToken:randomUUID()};
    const claimed=fixture.journal.claimActorTurnJob({runId:job.runId,actorId:job.actorId,jobId:job.jobId,generation:job.generation,...lease});assert.equal(claimed.kind,'claimed');
    fixture.journal.failActorTurnJob({execution:{runId:job.runId,actorId:job.actorId,jobId:job.jobId,generation:job.generation,pulseId:job.pulseId,lease},code:'execution-failed'});
  }
  return {...fixture,pulseId:begun.pulse.pulseId};
}

test('Director independiente usa SDK Pi y ledger real, publica evidencia append-only sin decidir hechos y replay no reinfiere',async()=>{
  const fixture=await fixtureWithTerminalPulse();
  try {
    const stats={requests:0,disposed:0};const worker=createDirectorPiWorker({journal:fixture.journal,runtime:fixture.runtime,ownerToken:randomUUID(),sessionFactory:controlledDirectorSessionFactory({root:fixture.directory,stats})});
    const world=fixture.journal.loadWorld({runId:fixture.claim.runId});
    const accepted=await worker.run({runId:fixture.claim.runId,pulseId:fixture.pulseId});
    if(accepted.kind!=='accepted')assert.fail(`Director no aceptado: ${accepted.kind}`);
    assert.equal(stats.requests,2);assert.equal(stats.disposed,1);
    assert.equal(accepted.receipt.annotation.observation.assessment.kind,'insufficient');
    assert.deepEqual(fixture.journal.loadWorld({runId:fixture.claim.runId}),world);
    const budget=fixture.journal.readRunModelTimeBudget({runId:fixture.claim.runId});assert.ok(budget);
    assert.equal(budget.runCallsUsed,2);assert.equal(budget.wallTimeReservedMs,0);assert.equal(budget.status,'known');
    assert.ok(budget.wallTimeMeasuredMs!==null&&budget.wallTimeMeasuredMs>0);
    const annotations=fixture.journal.readDirectorAnnotations({runId:fixture.claim.runId,throughWorldSeq:world!.seq});
    assert.equal(annotations.length,1);
    const repeated=await worker.run({runId:fixture.claim.runId,pulseId:fixture.pulseId});assert.equal(repeated.kind,'existing');
    assert.equal(stats.requests,2);assert.equal(stats.disposed,1);
    const db=new DatabaseSync(join(fixture.directory,'journal.sqlite'));
    try{
      assert.equal(db.prepare('SELECT COUNT(*) n FROM administrative_jobs').get()?.n,1);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM actor_turn_jobs').get()?.n,1);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM director_annotations').get()?.n,1);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM administrative_request_leases').get()?.n,2);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM model_time_spans').get()?.n,2);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM world_proposals').get()?.n,0);
    }finally{db.close();}
  }finally{fixture.close();}
});

test('Director no publica después de pausa; requests liquidadas siguen consumidas y terminal tardío queda sin autoridad',async()=>{
  const fixture=await fixtureWithTerminalPulse();
  try{
    const stats={requests:0,disposed:0};
    const worker=createDirectorPiWorker({journal:fixture.journal,runtime:fixture.runtime,ownerToken:randomUUID(),sessionFactory:controlledDirectorSessionFactory({root:fixture.directory,stats,beforeTerminal(){
      const current=fixture.journal.readWorldLifecycle({runId:fixture.claim.runId});assert.ok(current);
      fixture.journal.setWorldLifecycle({runId:fixture.claim.runId,expectedWorldRevision:current.worldRevision,expectedConfigRevision:current.configRevision,target:'paused'});
    }})});
    const result=await worker.run({runId:fixture.claim.runId,pulseId:fixture.pulseId});assert.equal(result.kind,'blocked');
    assert.equal(stats.requests,2);assert.equal(stats.disposed,1);
    assert.equal(fixture.journal.readDirectorAnnotations({runId:fixture.claim.runId,throughWorldSeq:100}).length,0);
    assert.equal(fixture.journal.readRunModelTimeBudget({runId:fixture.claim.runId})?.runCallsUsed,2);
    assert.equal(fixture.journal.readWorldLifecycle({runId:fixture.claim.runId})?.lifecycle,'paused');
  }finally{fixture.close();}
});

test('Director sin herramienta de observación queda bloqueado, pausa y no convierte texto terminal en anotación',async()=>{
  const fixture=await fixtureWithTerminalPulse();
  try{
    const stats={requests:0,disposed:0};const worker=createDirectorPiWorker({journal:fixture.journal,runtime:fixture.runtime,ownerToken:randomUUID(),sessionFactory:controlledDirectorSessionFactory({root:fixture.directory,stats,omitObservation:true})});
    const result=await worker.run({runId:fixture.claim.runId,pulseId:fixture.pulseId});
    assert.equal(result.kind,'blocked');if(result.kind==='blocked')assert.equal(result.job.failureCode,'observation-missing');
    assert.equal(stats.requests,1);assert.equal(stats.disposed,1);
    assert.equal(fixture.journal.readDirectorAnnotations({runId:fixture.claim.runId,throughWorldSeq:100}).length,0);
    assert.equal(fixture.journal.readWorldLifecycle({runId:fixture.claim.runId})?.lifecycle,'paused');
  }finally{fixture.close();}
});

test('grants Director comprueban rol, sesión, época y prueba terminal; recovery nunca reinfiere una sesión tentativa',async()=>{
  const fixture=await fixtureWithTerminalPulse();
  try {
    const started=fixture.journal.beginDirectorJob({runId:fixture.claim.runId,pulseId:fixture.pulseId,ownerToken:randomUUID(),claimToken:randomUUID()});
    if(started.kind!=='created')assert.fail('No job Director');
    const execution=started.execution;
    assert.equal(fixture.journal.checkAdministrativeJobEligibility({...execution,role:'narrator'}).kind,'inactive');
    assert.throws(()=>fixture.journal.reserveAdministrativeRequest({execution,clockEpochId:randomUUID()}),/sin sesión/);
    fixture.journal.registerAdministrativeSession({execution,sessionId:randomUUID(),sessionPath:join(fixture.directory,'director.jsonl'),baseLeafId:null,profile:execution.scope.profile});
    const candidate=fixture.journal.stageDirectorObservation({execution,observation:{kind:'director-observation',stage:'planteamiento',assessment:{kind:'insufficient',reason:'Candidato sin inferencia.',evidenceEventIds:[]},affectedCharacterIds:[],openQuestions:[],revision:{kind:'initial'}}});
    assert.throws(()=>fixture.journal.acceptDirectorObservation({execution,candidateHash:candidate.candidateHash}),/terminal único completado/);
    assert.equal(fixture.journal.recoverAbandonedAdministrativeJobs({ownerToken:randomUUID()}),1);
    assert.equal(fixture.journal.checkAdministrativeJobEligibility(execution).kind,'inactive');
    let sessions=0;const factory=controlledDirectorSessionFactory({root:fixture.directory});
    const worker=createDirectorPiWorker({journal:fixture.journal,runtime:fixture.runtime,ownerToken:randomUUID(),sessionFactory:async input=>{sessions+=1;return factory(input);}});
    assert.equal((await worker.run({runId:fixture.claim.runId,pulseId:fixture.pulseId})).kind,'blocked');
    assert.equal(sessions,0);assert.equal(fixture.journal.readRunModelTimeBudget({runId:fixture.claim.runId})?.runCallsUsed,0);
  }finally{fixture.close();}
});
