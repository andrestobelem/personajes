import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openLocalHost } from '../src/application/local-host.ts';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import { createRunMemoryPreparation } from '../src/application/run-memory-preparation.ts';
import { createIcmMemoryAdapter } from '../src/adapters/icm.ts';
import { MemoryPreparationJobSchema } from '../src/domain/memory-preparation.ts';
import { RunIdSchema } from '../src/domain/values.ts';
import { canonical, draftFixture } from './fixtures/continuista.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'personajes-memory-preparation-'));
  const host = openLocalHost({ privateDataRoot: join(parent, 'host') });
  const parsed = validateRunConfiguration({ draft: draftFixture() });
  assert.equal(parsed.kind, 'ready');
  if (parsed.kind !== 'ready') assert.fail('La fixture debe quedar Ready.');
  const configuration = parsed.configuration;
  const contexts = configuration.roster.preparedCharacters.map((actor) => ({
    actorId: actor.characterId,
    continuityId: actor.continuity.continuityId,
    continuityRevision: actor.continuity.revision,
    continuityContentHash: actor.continuity.contentHash,
    identityVersion: actor.identityVersion,
    preparedContextHash: createHash('sha256').update(canonical(actor)).digest('hex'),
  }));
  assert.equal(host.journal.registerWorldRun({ initialSnapshot: configuration.worldSnapshot,
    configurationRevision: configuration.configRevision, configuration,
    continuityFence: { kind: 'prepared-contexts', atWorldSeq: configuration.worldSnapshot.seq, contexts }, lifecycle: 'ready' }), 'stored');
  const runId = RunIdSchema.parse(configuration.runId);
  const world = host.journal.loadWorld({ runId });
  assert.ok(world);
  return {
    parent, host, configuration, runId, actorId: configuration.roster.activeCharacterIds[0],
    expectedConfigurationRevision: configuration.configRevision,
    expectedWorldRevision: world.revision,
    close() { host.close(); rmSync(parent, { recursive: true, force: true }); },
  };
}

function startInput(f: ReturnType<typeof fixture>, overrides: Partial<{
  runId: string; expectedConfigurationRevision: number; expectedWorldRevision: number; idempotencyKey: string; principalId: string;
}> = {}) {
  return {
    runId: f.runId,
    expectedConfigurationRevision: f.expectedConfigurationRevision,
    expectedWorldRevision: f.expectedWorldRevision,
    idempotencyKey: randomUUID(),
    principalId: 'memory-test-operator',
    ...overrides,
  };
}

const realIcmBinary = process.env.PERSONAJES_ICM_TEST_BINARY;

async function waitForJob(service: ReturnType<typeof createRunMemoryPreparation>, input: { runId: string; jobId: string; principalId: string }) {
  for (let attempt = 0; attempt < 300; ++attempt) {
    const job = service.read(input);
    if (job?.state === 'completed' || job?.state === 'failed' || job?.state === 'interrupted') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('La preparación no llegó a un estado terminal.');
}

test('acepta una vez, congela corte y actores, vuelve a verificar tras obtener mantenimiento y limita lecturas por dueño', async () => {
  const f = fixture();
  let giveMaintenance: ((release: () => void) => void) | undefined;
  const maintenanceEntered = deferred<void>();
  let releases = 0;
  let factoryCalls = 0;
  const service = createRunMemoryPreparation({ host: f.host, memoryFactory: async () => {
    factoryCalls += 1;
    return { async initialize() { return { kind: 'initialized' as const }; } };
  }, acquireMaintenance() {
    maintenanceEntered.resolve();
    return new Promise((resolve) => { giveMaintenance = resolve; });
  } });
  try {
    const request = startInput(f);
    const accepted = service.start(request);
    assert.equal(accepted.kind, 'accepted');
    if (accepted.kind !== 'accepted') assert.fail('Se esperaba una aceptación.');
    assert.equal(accepted.job.state, 'queued');
    assert.equal(accepted.job.purpose, 'initialize-empty');
    assert.deepEqual(accepted.job.actors.map((actor) => actor.actorId), f.configuration.roster.activeCharacterIds);
    assert.equal((service.start(request)).kind, 'existing');
    assert.equal(service.start({ ...request, expectedWorldRevision: request.expectedWorldRevision + 1 }).kind, 'idempotency-conflict');
    assert.equal(service.read({ runId: f.runId, jobId: accepted.job.jobId, principalId: 'another-operator' }), undefined);
    assert.equal(service.read({ runId: RunIdSchema.parse(randomUUID()), jobId: accepted.job.jobId, principalId: request.principalId }), undefined);
    const page = service.list({ runId: f.runId, principalId: request.principalId, limit: 1 });
    assert.deepEqual(page.jobs.map((job) => job.jobId), [accepted.job.jobId]);
    await maintenanceEntered.promise;
    assert.equal(f.host.journal.setWorldLifecycle({ runId: f.runId, expectedWorldRevision: f.expectedWorldRevision,
      expectedConfigRevision: f.expectedConfigurationRevision, target: 'running' }), 'updated');
    giveMaintenance?.(() => { releases += 1; });
    const result = await waitForJob(service, { runId: f.runId, jobId: accepted.job.jobId, principalId: request.principalId });
    assert.equal(result.state, 'failed');
    assert.equal(result.failureCode, 'run-not-ready');
    assert.equal(factoryCalls, 0, 'No se inicializa si el lifecycle cambió durante la espera por mantenimiento.');
    assert.equal(releases, 1);
    assert.equal(service.backupBusy, false);
  } finally {
    await service.close();
    f.close();
  }
});

test('close cancela y espera al CLI, guarda interrupted y libera la barrera antes de cerrar el ledger', async () => {
  const f = fixture();
  const initializationEntered = deferred<void>();
  let released = 0;
  const service = createRunMemoryPreparation({ host: f.host, acquireMaintenance: async () => () => { released += 1; },
    memoryFactory: async () => ({ initialize({ signal } = {}) {
      initializationEntered.resolve();
      return new Promise((_resolve, reject) => {
        if (signal?.aborted) { reject(new Error('aborted')); return; }
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    } }) });
  const request = startInput(f);
  const accepted = service.start(request);
  assert.equal(accepted.kind, 'accepted');
  if (accepted.kind !== 'accepted') assert.fail('Se esperaba una aceptación.');
  try {
    await initializationEntered.promise;
    assert.equal(service.backupBusy, true);
    await service.close();
    assert.equal(released, 1);
    assert.equal(service.backupBusy, false);
    const db = new DatabaseSync(join(f.host.privateDataRoot, 'world.sqlite'), { readOnly: true });
    try {
      const row = db.prepare('SELECT data_json FROM memory_preparation_jobs WHERE job_id=?').get(accepted.job.jobId);
      assert.ok(row);
      const job = MemoryPreparationJobSchema.parse(JSON.parse(String(Reflect.get(row, 'data_json'))));
      assert.equal(job.state, 'interrupted');
      assert.equal(job.failureCode, 'cancelled');
    } finally { db.close(); }
  } finally {
    await service.close();
    f.close();
  }
});

test('un run pausado sin memoria responde memory-missing sin crear directorios ni inicializar SQLite', async () => {
  const f = fixture();
  let calls = 0;
  const service = createRunMemoryPreparation({ host: f.host, memoryFactory: async () => {
    calls += 1;
    return { async initialize() { return { kind: 'initialized' as const }; } };
  }, acquireMaintenance: async () => () => undefined });
  try {
    assert.equal(f.host.journal.setWorldLifecycle({ runId: f.runId, expectedWorldRevision: f.expectedWorldRevision,
      expectedConfigRevision: f.expectedConfigurationRevision, target: 'running' }), 'updated');
    assert.equal(f.host.journal.setWorldLifecycle({ runId: f.runId, expectedWorldRevision: f.expectedWorldRevision,
      expectedConfigRevision: f.expectedConfigurationRevision, target: 'paused' }), 'updated');
    const rejected = service.start(startInput(f));
    assert.deepEqual(rejected, { kind: 'rejected', code: 'memory-missing' });
    assert.equal(calls, 0);
    assert.equal(existsSync(join(f.host.privateDataRoot, 'runs')), false);
  } finally {
    await service.close();
    f.close();
  }
});

test('ownership perdido bloquea lecturas del ledger auxiliar antes de exponer jobs', async () => {
  const f = fixture();
  const service = createRunMemoryPreparation({ host: f.host, memoryFactory: async () => ({
    async initialize() { return { kind: 'initialized' as const }; },
  }), acquireMaintenance: async () => () => undefined });
  const ownershipPath = join(f.host.privateDataRoot, 'host-ownership.json');
  const original = readFileSync(ownershipPath);
  try {
    writeFileSync(ownershipPath, JSON.stringify({ kind: 'host-ownership', schemaVersion: 1, nonce: randomUUID(), pid: process.pid,
      processStartedAt: new Date().toISOString() }));
    assert.throws(() => service.list({ runId: f.runId, principalId: 'memory-test-operator' }), /MEMORY_PREPARATION_HOST_OWNERSHIP_LOST/);
  } finally {
    writeFileSync(ownershipPath, original);
    await service.close();
    f.close();
  }
});

test('recupera un receipt SQLite queued tras reinicio y no repite el trabajo original', async () => {
  const f = fixture();
  const maintenanceEntered = deferred<void>();
  let finishMaintenance: ((release: () => void) => void) | undefined;
  let factoryCalls = 0;
  const service = createRunMemoryPreparation({ host: f.host, acquireMaintenance() {
    maintenanceEntered.resolve();
    return new Promise((resolve) => { finishMaintenance = resolve; });
  }, memoryFactory: async () => {
    factoryCalls += 1;
    return { async initialize() { return { kind: 'initialized' as const }; } };
  } });
  const request = startInput(f);
  const accepted = service.start(request);
  assert.equal(accepted.kind, 'accepted');
  if (accepted.kind !== 'accepted') assert.fail('Se esperaba una aceptación.');
  try {
    await maintenanceEntered.promise;
    await service.close();
    assert.equal(factoryCalls, 0);
    const database = new DatabaseSync(join(f.host.privateDataRoot, 'world.sqlite'));
    try {
      const receiptRow = database.prepare('SELECT receipt_json FROM memory_preparation_receipts WHERE principal_id=? AND idempotency_key=?')
        .get(request.principalId, request.idempotencyKey);
      assert.ok(receiptRow);
      const receiptJson = String(Reflect.get(receiptRow, 'receipt_json'));
      database.prepare(`UPDATE memory_preparation_jobs SET state='queued',revision=0,updated_at=?,data_json=?,data_hash=? WHERE job_id=?`)
        .run(accepted.job.createdAt, receiptJson, createHash('sha256').update(receiptJson).digest('hex'), accepted.job.jobId);
    } finally { database.close(); }

    const restarted = createRunMemoryPreparation({ host: f.host, acquireMaintenance: async () => {
      throw new Error('No debe reanudar la tarea abandonada.');
    }, memoryFactory: async () => {
      factoryCalls += 1;
      return { async initialize() { return { kind: 'initialized' as const }; } };
    } });
    try {
      const recovered = restarted.read({ runId: f.runId, jobId: accepted.job.jobId, principalId: request.principalId });
      assert.equal(recovered?.state, 'interrupted');
      assert.equal(recovered?.failureCode, 'cancelled');
      const replay = restarted.start(request);
      assert.equal(replay.kind, 'existing');
      if (replay.kind === 'existing') assert.equal(replay.job.state, 'interrupted');
      assert.equal(factoryCalls, 0, 'Un receipt durable nunca vuelve a disparar trabajo al reiniciar.');
    } finally { await restarted.close(); }
  } finally {
    finishMaintenance?.(() => undefined);
    await service.close();
    f.close();
  }
});

test('reintenta con clave nueva tras fallo parcial del CLI y conserva el SQLite existente byte a byte', {
  skip: realIcmBinary === undefined ? 'Definí PERSONAJES_ICM_TEST_BINARY para ejecutar el gate de recuperación ICM real.' : false,
}, async () => {
  const f = fixture();
  let simulateCrash = true;
  const service = createRunMemoryPreparation({ host: f.host, ...(realIcmBinary === undefined ? {} : { icmBinaryPath: realIcmBinary }),
    acquireMaintenance: async () => () => undefined,
    memoryFactory: async (adapterInput) => {
      const adapter = await createIcmMemoryAdapter({ ...adapterInput, binaryPath: realIcmBinary ?? '' });
      return { async initialize(options) {
        const result = await adapter.initialize(options);
        if (simulateCrash) {
          simulateCrash = false;
          throw new Error('simulated interruption after native CLI commit');
        }
        return result;
      } };
    } });
  try {
    const first = service.start(startInput(f));
    assert.equal(first.kind, 'accepted');
    if (first.kind !== 'accepted') assert.fail('Se esperaba una aceptación.');
    const firstTerminal = await waitForJob(service, { runId: f.runId, jobId: first.job.jobId, principalId: first.job.principalId });
    assert.equal(firstTerminal.state, 'failed');
    assert.equal(firstTerminal.failureCode, 'initialization-failed');
    assert.equal(firstTerminal.actors[0]?.state, 'failed');

    const actorId = first.job.actors[0]?.actorId;
    assert.ok(actorId);
    const memoryPath = join(f.host.privateDataRoot, 'runs', f.runId, 'actors', actorId, 'memory.sqlite');
    const beforeRetry = readFileSync(memoryPath);
    const retry = service.start(startInput(f));
    assert.equal(retry.kind, 'accepted');
    if (retry.kind !== 'accepted') assert.fail('Una clave nueva debe permitir reintentar el trabajo fallido.');
    const retryTerminal = await waitForJob(service, { runId: f.runId, jobId: retry.job.jobId, principalId: retry.job.principalId });
    assert.equal(retryTerminal.state, 'completed');
    assert.equal(retryTerminal.actors[0]?.state, 'existing');
    assert.deepEqual(readFileSync(memoryPath), beforeRetry);
    const database = new DatabaseSync(memoryPath, { readOnly: true });
    try { assert.equal(database.prepare('SELECT count(*) AS count FROM memories').get()?.count, 0); }
    finally { database.close(); }
  } finally {
    await service.close();
    f.close();
  }
});

test('reabrir memorias existentes conserva los sidecars WAL que exige el preflight de sólo lectura', {
  skip: realIcmBinary === undefined ? 'Definí PERSONAJES_ICM_TEST_BINARY para ejecutar el gate ICM real.' : false,
}, async () => {
  const f = fixture();
  const options = { host: f.host, ...(realIcmBinary === undefined ? {} : { icmBinaryPath: realIcmBinary }), acquireMaintenance: async () => () => undefined };
  const first = createRunMemoryPreparation(options);
  let memoryPath = '';
  try {
    const started = first.start(startInput(f));
    if (started.kind !== 'accepted') assert.fail('Se esperaba una aceptación.');
    assert.equal(started.job.purpose, 'initialize-empty');
    assert.equal((await waitForJob(first, { runId: f.runId, jobId: started.job.jobId, principalId: started.job.principalId })).state, 'completed');
    memoryPath = join(f.host.privateDataRoot, 'runs', f.runId, 'actors', started.job.actors[0]!.actorId, 'memory.sqlite');
  } finally { await first.close(); }
  const header = readFileSync(memoryPath).subarray(18, 20);
  assert.deepEqual([...header], [2, 2], 'ICM deja la base en modo WAL');
  assert.equal(existsSync(`${memoryPath}-shm`), false, 'cerrar el servicio libera los sidecars');
  assert.equal(f.host.journal.setWorldLifecycle({ runId: f.runId, expectedWorldRevision: f.expectedWorldRevision,
    expectedConfigRevision: f.expectedConfigurationRevision, target: 'running' }), 'updated');
  assert.equal(f.host.journal.setWorldLifecycle({ runId: f.runId, expectedWorldRevision: f.expectedWorldRevision,
    expectedConfigRevision: f.expectedConfigurationRevision, target: 'paused' }), 'updated');
  const second = createRunMemoryPreparation(options);
  try {
    const reopened = second.start(startInput(f));
    if (reopened.kind !== 'accepted') assert.fail(`Se esperaba reabrir: ${JSON.stringify(reopened)}`);
    assert.equal(reopened.job.purpose, 'reopen-existing');
    assert.equal((await waitForJob(second, { runId: f.runId, jobId: reopened.job.jobId, principalId: reopened.job.principalId })).state, 'completed');
    assert.equal(existsSync(`${memoryPath}-wal`), true);
    assert.equal(existsSync(`${memoryPath}-shm`), true);
  } finally {
    await second.close();
    f.close();
  }
});
