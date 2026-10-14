import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createProjectMemoryWorker } from '../src/application/project-memory.ts';
import { freezeExperience } from '../src/application/experience-envelope.ts';
import { openJournal } from '../src/adapters/journal.ts';
import { isHostOwnershipFailure } from '../src/adapters/host-ownership.ts';
import { createIcmMemoryAdapter } from '../src/adapters/icm.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { CharacterIdSchema, ExperienceIdSchema, RunIdSchema, WorldSeqSchema } from '../src/domain/values.ts';

const realIcmBinary = process.env.PERSONAJES_ICM_TEST_BINARY;
const realCliTestOptions = {
  skip: realIcmBinary === undefined ? 'Definí PERSONAJES_ICM_TEST_BINARY para ejecutar la integración con ICM real.' : false,
};
const actorId = CharacterIdSchema.parse('maxwell-smart');
const runId = RunIdSchema.parse('00000000-0000-4000-8000-000000000701');
const firstExperienceId = ExperienceIdSchema.parse('00000000-0000-4000-8000-000000000711');
const secondExperienceId = ExperienceIdSchema.parse('00000000-0000-4000-8000-000000000712');
const crashExperienceId = ExperienceIdSchema.parse('00000000-0000-4000-8000-000000000713');
const repeatedPhrase = 'No vi a la agente 99 salir de la sala.';

function frozenExperience(experienceId: string, worldSeq: number) {
  return freezeExperience({
    schemaVersion: 1,
    experienceId: ExperienceIdSchema.parse(experienceId),
    runId,
    actorId,
    kind: 'belief',
    content: repeatedPhrase,
    sourceRefs: [],
    fictitiousAt: worldSeq * 1_000,
    receivedAt: worldSeq * 1_000,
    worldSeq: WorldSeqSchema.parse(worldSeq),
    confidence: 0.75,
    revision: 0,
    predecessor: { kind: 'initial' },
    basedOn: [],
  });
}

test('worker real proyecta frases iguales con experienceId distintos y receipts durables', realCliTestOptions, async () => {
  assert.ok(realIcmBinary, 'faltó configurar el binario ICM real para este gate');
  const privateRoot = mkdtempSync(join(tmpdir(), 'personajes-memory-projection-'));
  const journalPath = join(privateRoot, 'world.sqlite');
  const journal = openJournal({ path: journalPath });
  try {
    const first = frozenExperience(firstExperienceId, 1);
    const second = frozenExperience(secondExperienceId, 2);
    assert.equal(first.envelope.content, second.envelope.content);
    assert.notEqual(first.envelope.experienceId, second.envelope.experienceId);
    assert.equal(journal.recordExperience(first).kind, 'stored');
    assert.equal(journal.recordExperience(second).kind, 'stored');

    const adapter = await createIcmMemoryAdapter({
      privateDataRoot: privateRoot,
      runId,
      actorId,
      binaryPath: realIcmBinary,
      ledger: journal,
    });
    const worker = createProjectMemoryWorker({ journal, projector: adapter.projector, runId, actorId });
    assert.deepEqual(await worker.drain({ maxItems: 10 }), {
      kind: 'completed', projected: 2, limitReached: false,
    });

    const verified = await adapter.diagnostics.listForensic({ throughWorldSeq: 2 });
    assert.equal(verified.rejectedCount, 0);
    assert.deepEqual(verified.experiences.map((item) => item.experience.experienceId).sort(),
      [firstExperienceId, secondExperienceId].sort());
    assert.notEqual(verified.experiences[0]?.memoryId, verified.experiences[1]?.memoryId);

    journal.close();
    const reopened = openJournal({ path: journalPath });
    try {
      const afterRestart = await createIcmMemoryAdapter({
        privateDataRoot: privateRoot,
        runId,
        actorId,
        binaryPath: realIcmBinary,
        ledger: reopened,
      });
      const durable = await afterRestart.diagnostics.listForensic({ throughWorldSeq: 2 });
      assert.equal(durable.rejectedCount, 0);
      assert.equal(durable.experiences.length, 2);
    } finally { reopened.close(); }
  } finally {
    try { journal.close(); } catch { /* Closed before reopen. */ }
    rmSync(privateRoot, { recursive: true, force: true });
  }
});

test('reapertura recupera una interrupción simulada después de store ICM real y antes del ack', realCliTestOptions, async () => {
  assert.ok(realIcmBinary, 'faltó configurar el binario ICM real para este gate');
  const privateRoot = mkdtempSync(join(tmpdir(), 'personajes-memory-crash-'));
  let host = openLocalHost({ privateDataRoot: privateRoot });
  try {
    const journal = host.journal;
    const frozen = frozenExperience(crashExperienceId, 3);
    journal.recordExperience(frozen);
    const beforeCrashAdapter = await createIcmMemoryAdapter({
      privateDataRoot: privateRoot,
      runId,
      actorId,
      binaryPath: realIcmBinary,
      ledger: journal,
    });
    const claim = journal.claimNextMemoryProjection({
      runId,
      actorId,
      ownerToken: '00000000-0000-4000-8000-000000000721',
      claimToken: '00000000-0000-4000-8000-000000000722',
    });
    assert.equal(claim.kind, 'claimed');
    if (claim.kind !== 'claimed') return;
    const committedInIcm = await beforeCrashAdapter.projector.store(claim.frozen);
    assert.equal(committedInIcm.experienceId, crashExperienceId);

    assert.throws(() => openLocalHost({ privateDataRoot: privateRoot }),
      (error: unknown) => isHostOwnershipFailure(error) && error.code === 'ALREADY_OWNED');

    // Simulate process exit after ICM commit and before journal ack. The next
    // host recovers the abandoned claim before returning its journal to workers.
    host.close();
    host = openLocalHost({ privateDataRoot: privateRoot });
    const reopenedJournal = host.journal;
    const reopenedAdapter = await createIcmMemoryAdapter({
      privateDataRoot: privateRoot,
      runId,
      actorId,
      binaryPath: realIcmBinary,
      ledger: reopenedJournal,
    });
    const beforeReceipt = await reopenedAdapter.diagnostics.listForensic({ throughWorldSeq: 3 });
    assert.equal(beforeReceipt.experiences.length, 0);
    assert.equal(beforeReceipt.rejectedCount, 1);

    const worker = createProjectMemoryWorker({ journal: reopenedJournal, projector: reopenedAdapter.projector, runId, actorId });
    assert.deepEqual(await worker.drain(), { kind: 'completed', projected: 1, limitReached: false });
    const afterReceipt = await reopenedAdapter.diagnostics.listForensic({ throughWorldSeq: 3 });
    assert.equal(afterReceipt.experiences.length, 1);
    assert.equal(afterReceipt.rejectedCount, 0);
    assert.equal(afterReceipt.experiences[0]?.memoryId, committedInIcm.memoryId);
    assert.equal(afterReceipt.experiences[0]?.experience.experienceId, crashExperienceId);
  } finally {
    host.close();
    rmSync(privateRoot, { recursive: true, force: true });
  }
});
