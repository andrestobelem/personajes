import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PreparationConfiguratorJobSchema } from '../src/domain/preparation-configurator-jobs.ts';
import { createPreparationConfiguratorManager } from '../src/application/preparation-configurator-manager.ts';

test('backup suspension aborts and drains workers, preserves nested barriers and never requeues on release', async () => {
  const job = PreparationConfiguratorJobSchema.parse({ kind: 'preparation-configurator-job', principalId: 'operator',
    scope: { runId: randomUUID(), jobId: randomUUID(), generation: 0, draftRevision: 0, draftHash: '1'.repeat(64), contextHash: '2'.repeat(64) },
    revision: 0, state: 'queued', failureCode: null, createdAt: 0, updatedAt: 0 });
  let executions = 0;
  let aborted = 0;
  const manager = createPreparationConfiguratorManager({ worker: { async run(_job, options) {
    executions++;
    if (options?.signal?.aborted) aborted++;
    else await new Promise<void>(resolve => options?.signal?.addEventListener('abort', () => { aborted++; resolve(); }, { once: true }));
    return { ...job, state: 'blocked' };
  } } });
  try {
    manager.start(job);
    await Promise.resolve();
    const release = await manager.suspendAdmissions();
    assert.equal(executions, 1); assert.equal(aborted, 1); assert.equal(manager.hasActive({ jobId: job.scope.jobId }), false);
    assert.throws(() => manager.start(job), /SUSPENDED/);
    const releaseNested = await manager.suspendAdmissions();
    release(); release();
    assert.throws(() => manager.start(job), /SUSPENDED/);
    releaseNested();
    await manager.waitForIdle(); assert.equal(executions, 1, 'releasing a barrier does not resume inference');
  } finally { await manager.close(); }
});
