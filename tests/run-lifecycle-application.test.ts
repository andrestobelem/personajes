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
