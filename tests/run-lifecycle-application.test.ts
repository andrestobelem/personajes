import {recordSyntheticPassedPreflight} from './fixtures/preflight.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createRunLifecycleApplication } from '../src/application/run-lifecycle.ts';
import { PulseIdSchema } from '../src/domain/values.ts';
import { setup } from './fixtures/continuista.ts';

test('RunView compone el presupuesto del ledger y actualiza las reservas durables', async () => {
  const fixture = await setup();
  try {
    const application = createRunLifecycleApplication({ journal: fixture.journal });
    const before = application.readRunView({ runId: fixture.claim.runId });
    assert.ok(before);
    assert.equal(before.createdAt, new Date(fixture.journal.readWorldLifecycle({ runId: fixture.claim.runId })!.createdAt!).toISOString());
    assert.deepEqual(before.budget.modelCalls, { limit: 20, used: 0, reserved: 0, remaining: 20 });
    assert.deepEqual(before.budget.modelWallTimeMs, { limit: 60_000, measured: 0, reserved: 0, remaining: 60_000 });
    assert.equal(before.budget.status, 'available');

    const database = new DatabaseSync(`${fixture.directory}/journal.sqlite`);
    let pulseId: string;
    try {
      const row = database.prepare('SELECT pulse_id FROM actor_turn_jobs WHERE job_id=? AND generation=?')
        .get(fixture.claim.jobId, fixture.claim.generation);
      if (row === undefined) throw new Error('Fixture sin pulso durable.');
      pulseId = PulseIdSchema.parse(Reflect.get(row, 'pulse_id'));
    } finally { database.close(); }

    const reserved = fixture.journal.reserveNextRequest({
      runId: fixture.claim.runId,
      pulseId,
      jobId: fixture.claim.jobId,
      generation: fixture.claim.generation,
      clockEpochId: randomUUID(),
      ownerToken: fixture.claim.ownerToken,
    });
    assert.equal(reserved.kind, 'reserved');
    const after = application.readRunView({ runId: fixture.claim.runId });
    assert.ok(after);
    assert.deepEqual(after.budget.modelCalls, { limit: 20, used: 0, reserved: 1, remaining: 19 });
    assert.deepEqual(after.budget.modelWallTimeMs, { limit: 60_000, measured: 0, reserved: 30_000, remaining: 30_000 });
    assert.equal(after.budget.status, 'available');
  } finally {
    fixture.journal.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('run view remains readable when real transport closes beyond its remaining time grant', async () => {
  const f = await setup(undefined, undefined, { maxWallTimeMs: 1, requestTimeoutMs: 1000 });
  try {
    const db = new DatabaseSync(`${f.directory}/journal.sqlite`);
    let pulseId: string;
    try { pulseId = PulseIdSchema.parse(db.prepare('SELECT pulse_id FROM actor_turn_jobs WHERE job_id=? AND generation=?').get(f.claim.jobId, f.claim.generation)?.pulse_id); } finally { db.close(); }
    const epoch = randomUUID(), ownerToken = f.claim.ownerToken;
    const grant = f.journal.reserveNextRequest({ runId: f.claim.runId, pulseId, jobId: f.claim.jobId, generation: f.claim.generation, ownerToken, clockEpochId: epoch });
    assert.equal(grant.kind, 'reserved'); if (grant.kind !== 'reserved') assert.fail();
    const request = { jobId: f.claim.jobId, generation: f.claim.generation, requestSeq: grant.requestSeq, ownerToken };
    f.journal.transitionReservation({ ...request, target: 'dispatched', wallTime: { clockEpochId: epoch, monotonicNs: '1000000' } });
    f.journal.transitionReservation({ ...request, target: 'completed', wallTime: { clockEpochId: epoch, monotonicNs: '10000000' } });
    const view = createRunLifecycleApplication({ journal: f.journal }).readRunView({ runId: f.claim.runId });
    assert.equal(view?.budget.modelWallTimeMs.measured, 9);
    assert.equal(view?.budget.modelWallTimeMs.remaining, 0);
    assert.equal(view?.budget.status, 'exhausted');
  } finally { f.journal.close(); rmSync(f.directory, {recursive:true,force:true}); }
});


test('explicit resume retries blocked actor inputs atomically, while ordinary resume and replay do not', async () => {
  const f=await setup();
  const db=new DatabaseSync(`${f.directory}/journal.sqlite`);
  try {
    const pulseId=PulseIdSchema.parse(db.prepare('SELECT pulse_id FROM actor_turn_jobs WHERE job_id=? AND generation=?').get(f.claim.jobId,f.claim.generation)?.pulse_id);
    assert.equal(f.journal.claimActorTurnJob(f.claim).kind,'claimed');
    f.journal.failActorTurnJob({execution:{runId:f.claim.runId,actorId:f.claim.actorId,jobId:f.claim.jobId,generation:f.claim.generation,pulseId,lease:{ownerToken:f.claim.ownerToken,claimToken:f.claim.claimToken}},code:'job-inactive'});
    const app=createRunLifecycleApplication({journal:f.journal,preflights:{readJob(scope){const r=f.journal.readRunPreflightJob(scope);return r.kind==='found'?r.document:undefined;}},runtime:{async scheduleRun(){return true;},async cancelRun(){return true;}}});
    const control=(command:unknown)=>{const v=app.readRunView({runId:f.claim.runId});assert.ok(v);return {principalId:'operator',idempotencyKey:randomUUID(),runId:v.runId,expectedConfigurationRevision:v.configRevision,expectedWorldRevision:v.worldRevision,expectedStructureRevision:v.structureRevision,expectedLifecycleRevision:v.lifecycleRevision,command};};
    assert.equal((await app.controlRun(control({kind:'pause'}))).kind,'updated');
    let preflightJobId=recordSyntheticPassedPreflight({journal:f.journal,runId:f.claim.runId});
    assert.equal((await app.controlRun(control({kind:'resume',preflightJobId}))).kind,'updated');
    assert.equal(db.prepare('SELECT count(*) n FROM actor_turn_jobs WHERE job_id=?').get(f.claim.jobId)?.n,1);
    assert.equal((await app.controlRun(control({kind:'pause'}))).kind,'updated');
    preflightJobId=recordSyntheticPassedPreflight({journal:f.journal,runId:f.claim.runId});
    const request=control({kind:'resume',preflightJobId,retryBlockedActors:true});
    assert.equal((await app.controlRun(request)).kind,'updated');
    assert.equal(db.prepare('SELECT state FROM actor_turn_jobs WHERE job_id=? AND generation=1').get(f.claim.jobId)?.state,'queued');
    assert.equal((await app.controlRun(request)).kind,'updated');
    assert.equal(db.prepare('SELECT count(*) n FROM actor_turn_jobs WHERE job_id=?').get(f.claim.jobId)?.n,2);
  } finally {db.close();f.journal.close();rmSync(f.directory,{recursive:true,force:true});}
});
