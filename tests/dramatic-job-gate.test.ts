import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { test } from 'node:test';
import { createActorTurnWorker } from '../src/application/actor-turn-worker.ts';
import { ContinuistaCriterionSchema } from '../src/domain/world-journal.ts';
import { WorldSeqSchema } from '../src/domain/values.ts';
import { setup, deterministicFactory } from './fixtures/continuista.ts';

test('structural closure waits for the current actor generation and preserves superseded failures', async () => {
  const fixture = await setup();
  const {journal}=fixture;
  try {
    const initial=journal.loadWorld({runId:fixture.claim.runId});assert.ok(initial?.activeSceneId);
    const blockedClose={runId:initial.runId,principalId:'test-operator',operationId:randomUUID(),idempotencyKey:randomUUID(),
      expectedWorldRevision:initial.revision,expectedStructureRevision:0,
      command:{kind:'closeScene' as const,sceneId:initial.activeSceneId,reason:'Fin del caso de prueba'}};
    assert.deepEqual(journal.applyDramaticStructureCommand(blockedClose),{kind:'invalidState',code:'actorJobsActive'});
    const claim=journal.claimActorTurnJob(fixture.claim);assert.equal(claim.kind,'claimed');
    if(claim.kind!=='claimed')assert.fail('Falta claim');
    assert.deepEqual(journal.applyDramaticStructureCommand({...blockedClose,operationId:randomUUID(),idempotencyKey:randomUUID()}),{kind:'invalidState',code:'actorJobsActive'});
    const execution={runId:claim.job.runId,actorId:claim.job.actorId,jobId:claim.job.jobId,generation:claim.job.generation,
      pulseId:claim.job.pulseId,lease:{ownerToken:fixture.claim.ownerToken,claimToken:fixture.claim.claimToken}};
    journal.failActorTurnJob({execution,code:'execution-failed'});
    assert.deepEqual(journal.applyDramaticStructureCommand({...blockedClose,operationId:randomUUID(),idempotencyKey:randomUUID()}),{kind:'invalidState',code:'actorJobsActive'});
    const retry=journal.retryActorTurnJob({runId:claim.job.runId,actorId:claim.job.actorId,jobId:claim.job.jobId,
      expectedGeneration:0,pulseId:claim.job.pulseId});assert.equal(retry.kind,'retried');
    assert.deepEqual(journal.applyDramaticStructureCommand({...blockedClose,operationId:randomUUID(),idempotencyKey:randomUUID()}),{kind:'invalidState',code:'actorJobsActive'});
    const retryLease={ownerToken:randomUUID(),claimToken:randomUUID()};
    assert.equal(journal.claimActorTurnJob({...fixture.claim,generation:retry.job.generation,...retryLease}).kind,'claimed');
    journal.failActorTurnJob({execution:{...execution,generation:retry.job.generation,lease:retryLease},code:'pi-incomplete'});
    assert.deepEqual(journal.applyDramaticStructureCommand({...blockedClose,operationId:randomUUID(),idempotencyKey:randomUUID()}),{kind:'invalidState',code:'actorJobsActive'},'a successor that fails is still current work');
    const finalRetry=journal.retryActorTurnJob({runId:claim.job.runId,actorId:claim.job.actorId,jobId:claim.job.jobId,
      expectedGeneration:retry.job.generation,pulseId:claim.job.pulseId});assert.equal(finalRetry.kind,'retried');
    const actor=deterministicFactory(fixture);
    const worker=createActorTurnWorker({journal,runtime:fixture.runtime,ids:fixture.ids,sessionFactory:actor.factory,
      memoryForActor:()=>({async recall(){return {source:'ranked-recall',throughWorldSeq:WorldSeqSchema.parse(0),experiences:[],rejectedCount:0};}}),
      continuista:{async review({proposal}){return {kind:'continuista',proposalId:proposal.proposalId,version:proposal.version,
        runId:proposal.runId,actorId:proposal.actorId,stateRevision:proposal.baseRevision,exactContentHash:proposal.exactContentHash,
        ...(proposal.nextInitiative===undefined?{}:{nextInitiative:proposal.nextInitiative}),
        verdict:'allow',complete:true,criterionCodes:ContinuistaCriterionSchema.options,evidenceRefs:['fixture-approved']};}}});
    const result=await worker.run({...fixture.claim,generation:finalRetry.job.generation,ownerToken:randomUUID(),claimToken:randomUUID()});
    assert.equal(result.kind,'committed');
    assert.deepEqual(journal.applyDramaticStructureCommand(blockedClose),{kind:'invalidState',code:'actorJobsActive'},'a recorded refusal is not silently replaced on replay');
    const current=journal.loadWorld({runId:initial.runId});assert.ok(current);
    const closed=journal.applyDramaticStructureCommand({...blockedClose,operationId:randomUUID(),idempotencyKey:randomUUID(),expectedWorldRevision:current.revision});
    assert.equal(closed.kind,'stored');assert.equal(journal.loadWorld({runId:initial.runId})?.activeSceneId,null);
    const db=new DatabaseSync(join(fixture.directory,'journal.sqlite'),{readOnly:true});
    try {assert.deepEqual(db.prepare('SELECT generation,state,failure_code FROM actor_turn_jobs WHERE job_id=? ORDER BY generation').all(claim.job.jobId).map(row=>({...row})),[
      {generation:0,state:'blocked',failure_code:'execution-failed'},{generation:1,state:'blocked',failure_code:'pi-incomplete'},{generation:2,state:'accepted',failure_code:null}]);}
    finally{db.close();}
  } finally {fixture.close();}
});
