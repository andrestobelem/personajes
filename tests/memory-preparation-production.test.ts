import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { z } from 'zod';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { withHostDirectoryOperation } from '../src/adapters/host-ownership.ts';
import { PiRuntime } from '../src/adapters/pi.ts';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createPiAuthFingerprint } from '../src/application/pi-auth-fingerprint.ts';
import { createProductionPreflightHost } from '../src/application/production-preflight-host.ts';
import { createProductionHost } from '../src/server/production-host.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { MemoryPreparationJobPageSchema, MemoryPreparationJobSchema, memoryPreparationContextEtag } from '../src/domain/memory-preparation.ts';
import { SessionCreatedSchema } from '../src/domain/http.ts';
import { BackupJobSchema } from '../src/domain/backup.ts';
import { CharacterIdSchema, RunIdSchema } from '../src/domain/values.ts';
import { createCleanReadyPreflightFixture } from './fixtures/preflight.ts';

const binaryPath = process.env.PERSONAJES_ICM_TEST_BINARY;

async function createSession(origin: string) {
  const originHeaders = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
  const shell = await fetch(origin + '/', { headers: originHeaders });
  assert.equal(shell.status, 200);
  const nonce = (await shell.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];
  assert.ok(nonce);
  const response = await fetch(origin + '/api/v1/session', {
    method: 'POST', headers: { ...originHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ bootNonce: nonce }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const session = SessionCreatedSchema.parse(await response.json());
  return { ...originHeaders, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken };
}

async function serve(production: Awaited<ReturnType<typeof createProductionHost>>, catalog: Awaited<ReturnType<typeof loadCatalog>>) {
  const server = createLocalHttpServer({ catalog, shellHtml: '<!doctype html><html><head></head><body></body></html>', ...production.httpOptions });
  const { origin } = await server.listen(0);
  return { server, origin };
}

async function waitForMemoryJob(input: { origin: string; headers: Record<string, string>; path: string; jobId: string }) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const response = await fetch(`${input.origin}${input.path}/${input.jobId}`, { headers: input.headers });
    assert.equal(response.status, 200, await response.clone().text());
    const job = MemoryPreparationJobSchema.parse(await response.json());
    if (job.state === 'completed' || job.state === 'failed' || job.state === 'interrupted') return job;
    assert.ok(job.state === 'queued' || job.state === 'running', `Estado inesperado: ${job.state}`);
    await delay(10);
  }
  assert.fail('La preparación de memoria real no terminó dentro del plazo de integración.');
}

function memoryPath(root: string, runId: string, actorId: string) {
  return join(root, 'runs', runId, 'actors', actorId, 'memory.sqlite');
}

function assertNoStoryExecution(root: string, runId: string) {
  assertNoStoryExecutionInJournal(join(root, 'world.sqlite'), runId);
}

function assertNoStoryExecutionInJournal(journalPath: string, runId: string) {
  const database = new DatabaseSync(journalPath, { readOnly: true });
  try {
    for (const table of [
      'world_events', 'experiences', 'actor_pi_sessions', 'actor_turn_jobs', 'continuista_jobs', 'request_reservations',
    ]) {
      const count = z.strictObject({ count: z.number().int().nonnegative() }).parse(
        database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE run_id=?`).get(runId),
      );
      assert.equal(count.count, 0, `La preparación de memoria produjo filas en ${table}`);
    }
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM continuista_sessions').get()?.count, 0,
      'La preparación de memoria no crea sesiones de continuidad.');
  } finally { database.close(); }
}

function assertEmptyIcmStore(path: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(database.prepare('PRAGMA quick_check').get()?.quick_check, 'ok');
    assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM memories').get()?.count, 0);
  } finally { database.close(); }
}

async function assertIcmReadonlyReadiness(input: {
  root: string;
  journal: ReturnType<typeof openLocalHost>['journal'];
  catalog: Awaited<ReturnType<typeof loadCatalog>>;
  runId: z.infer<typeof RunIdSchema>;
  actorId: z.infer<typeof CharacterIdSchema>;
}) {
  if (binaryPath === undefined) throw new Error('PERSONAJES_ICM_TEST_BINARY is required for this integration test.');
  const piRuntime = await PiRuntime.create({ privateDataRoot: input.root });
  const authentication = createPiAuthFingerprint({ privateDataRoot: input.root, environment: {} });
  const preflight = createProductionPreflightHost({ journal: input.journal, catalog: input.catalog, piRuntime, authentication, icmBinaryPath: binaryPath });
  const result = await preflight.readIcmMemoryReadiness({ runId: input.runId, actorIds: [input.actorId] });
  assert.deepEqual(result, {
    kind: 'ready', version: '0.11.4', backend: 'sqlite',
    actors: [{ runId: input.runId, characterId: input.actorId, state: 'recoverable', isolation: { kind: 'run-actor', runId: input.runId, characterId: input.actorId } }],
  });
}

test('production memory preparation durably initializes empty ICM, reopens explicitly, and never creates fictional actions', {
  skip: binaryPath === undefined ? 'Definí PERSONAJES_ICM_TEST_BINARY para integrar ICM real en host producción.' : false,
}, async (t) => {
  assert.ok(binaryPath);
  const root = mkdtempSync(join(tmpdir(), 'personajes-memory-preparation-production-'));
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  let production: Awaited<ReturnType<typeof createProductionHost>> | undefined;
  let server: Awaited<ReturnType<typeof serve>> | undefined;
  t.after(async () => {
    try { await server?.server.close(); }
    finally {
      try { await production?.close(); }
      finally { rmSync(root, { recursive: true, force: true }); rmSync(root + '-auth', { recursive: true, force: true }); }
    }
  });

  production = await createProductionHost({ host: openLocalHost({ privateDataRoot: root }), catalog,
    admissionBarrier: createHostRequestBarrier(), icmBinaryPath: binaryPath });
  await production.recover();
  const fixture = createCleanReadyPreflightFixture({ journal: production.host.journal });
  const originalWorld = production.host.journal.loadWorld({ runId: fixture.runId });
  const originalConfiguration = production.host.journal.readWorldConfiguration({ runId: fixture.runId });
  assert.ok(originalWorld);
  assert.ok(originalConfiguration);
  const actorId = fixture.configuration.roster.activeCharacterIds[0];
  assert.ok(actorId);
  const databasePath = memoryPath(root, fixture.runId, actorId);
  assert.equal(existsSync(databasePath), false, 'Una puesta Ready sintética no trae memoria creada por el fixture.');
  assertNoStoryExecution(root, fixture.runId);

  server = await serve(production, catalog);
  const headers = await createSession(server.origin);
  const path = `/api/v1/runs/${fixture.runId}/memory-preparations`;
  const context = { runId: fixture.runId, expectedConfigurationRevision: fixture.configuration.configRevision,
    expectedWorldRevision: fixture.configuration.worldSnapshot.revision };
  const firstIdempotencyKey = randomUUID();
  const firstResponse = await fetch(server.origin + path, {
    method: 'POST', headers: { ...headers, 'Idempotency-Key': firstIdempotencyKey, 'If-Match': memoryPreparationContextEtag(context) },
    body: JSON.stringify({ expectedConfigurationRevision: context.expectedConfigurationRevision, expectedWorldRevision: context.expectedWorldRevision }),
  });
  assert.equal(firstResponse.status, 202, await firstResponse.clone().text());
  const firstReceipt = MemoryPreparationJobSchema.parse(await firstResponse.json());
  assert.equal(firstReceipt.purpose, 'initialize-empty');
  const firstJob = await waitForMemoryJob({ origin: server.origin, headers, path, jobId: firstReceipt.jobId });
  assert.equal(firstJob.state, 'completed');
  assert.equal(firstJob.purpose, 'initialize-empty');
  assert.deepEqual(firstJob.actors, [{ actorId, state: 'initialized' }]);
  assert.equal(firstJob.failureCode, null);
  assertEmptyIcmStore(databasePath);
  assertNoStoryExecution(root, fixture.runId);
  assert.deepEqual(production.host.journal.loadWorld({ runId: fixture.runId }), originalWorld);
  assert.deepEqual(production.host.journal.readWorldConfiguration({ runId: fixture.runId }), originalConfiguration);
  await assertIcmReadonlyReadiness({ root, journal: production.host.journal, catalog, runId: fixture.runId, actorId });

  assert.equal(production.memoryPreparations.backupBusy, false, 'El worker terminó; queda sólo la conexión SQLite ociosa para coordinar WAL.');
  const backupId = randomUUID();
  const backupJob = BackupJobSchema.parse(await production.exchange.backups.create({ backupId, scope: { kind: 'all' } }));
  assert.equal(backupJob.state, 'succeeded', backupJob.safeCode ?? '');
  const backup = production.exchange.backups.verify(backupId);
  const backedMemoryPath = join(backup.bundleRoot, 'runs', fixture.runId, 'actors', actorId, 'memory.sqlite');
  assert.ok(backup.manifest.files.some((file) => file.path === `runs/${fixture.runId}/actors/${actorId}/memory.sqlite`));
  assertEmptyIcmStore(backedMemoryPath);
  assertNoStoryExecutionInJournal(join(backup.bundleRoot, 'world.sqlite'), fixture.runId);
  const snapshotJournal = new DatabaseSync(join(backup.bundleRoot, 'world.sqlite'), { readOnly: true });
  try {
    const storedJob = z.strictObject({ state: z.string(), data_json: z.string(), data_hash: z.string() }).parse(
      snapshotJournal.prepare('SELECT state,data_json,data_hash FROM memory_preparation_jobs WHERE job_id=?').get(firstJob.jobId),
    );
    assert.equal(storedJob.state, 'completed');
    assert.deepEqual(JSON.parse(storedJob.data_json), firstJob);
    assert.equal(storedJob.data_hash, createHash('sha256').update(storedJob.data_json).digest('hex'));
    const receipt = z.strictObject({ principal_id: z.string(), idempotency_key: z.string(), receipt_json: z.string(), receipt_hash: z.string() }).parse(
      snapshotJournal.prepare('SELECT principal_id,idempotency_key,receipt_json,receipt_hash FROM memory_preparation_receipts WHERE job_id=?').get(firstJob.jobId),
    );
    assert.equal(receipt.principal_id, 'local-operator');
    assert.equal(receipt.idempotency_key, firstIdempotencyKey);
    assert.deepEqual(JSON.parse(receipt.receipt_json), firstReceipt, 'El backup conserva el receipt original de admisión además del estado terminal.');
    assert.equal(receipt.receipt_hash, createHash('sha256').update(receipt.receipt_json).digest('hex'));
  } finally { snapshotJournal.close(); }
  assertNoStoryExecution(root, fixture.runId);
  assertEmptyIcmStore(databasePath);
  assert.deepEqual(production.host.journal.loadWorld({ runId: fixture.runId }), originalWorld, 'El backup no cambia el estado vivo del Escenario.');
  assert.deepEqual(production.host.journal.readWorldConfiguration({ runId: fixture.runId }), originalConfiguration);

  const preparedBytes = readFileSync(databasePath);
  const firstHistory = await fetch(server.origin + path, { headers });
  assert.equal(firstHistory.status, 200, await firstHistory.clone().text());
  const firstPage = MemoryPreparationJobPageSchema.parse(await firstHistory.json());
  assert.deepEqual(firstPage.jobs, [firstJob]);

  await server.server.close();
  server = undefined;
  production = await withHostDirectoryOperation({ privateDataRoot: root, operation: async (directoryOperation) => {
    await production!.close({ directoryOperation });
    return createProductionHost({ host: openLocalHost({ privateDataRoot: root, directoryOperation }), catalog,
      admissionBarrier: createHostRequestBarrier(), directoryOperation, icmBinaryPath: binaryPath });
  }});
  await production.recover();
  assert.equal(readFileSync(databasePath).subarray(0, 16).toString('binary'), 'SQLite format 3\0');
  assertEmptyIcmStore(databasePath);
  assertNoStoryExecution(root, fixture.runId);
  assert.deepEqual(production.host.journal.loadWorld({ runId: fixture.runId }), originalWorld);
  assert.deepEqual(production.host.journal.readWorldConfiguration({ runId: fixture.runId }), originalConfiguration);

  server = await serve(production, catalog);
  const reopenedHeaders = await createSession(server.origin);
  const recoveredHistory = await fetch(server.origin + path, { headers: reopenedHeaders });
  assert.equal(recoveredHistory.status, 200, await recoveredHistory.clone().text());
  const recoveredPage = MemoryPreparationJobPageSchema.parse(await recoveredHistory.json());
  assert.deepEqual(recoveredPage.jobs, [firstJob], 'recover() sólo conserva y lee la historia de preparación existente.');
  assert.deepEqual(readFileSync(databasePath), preparedBytes, 'Reabrir el host no modifica la base vacía ICM.');

  const secondResponse = await fetch(server.origin + path, {
    method: 'POST', headers: { ...reopenedHeaders, 'Idempotency-Key': randomUUID(), 'If-Match': memoryPreparationContextEtag(context) },
    body: JSON.stringify({ expectedConfigurationRevision: context.expectedConfigurationRevision, expectedWorldRevision: context.expectedWorldRevision }),
  });
  assert.equal(secondResponse.status, 202, await secondResponse.clone().text());
  const secondReceipt = MemoryPreparationJobSchema.parse(await secondResponse.json());
  assert.equal(secondReceipt.purpose, 'initialize-empty', 'El corte Ready sigue siendo virgen: revalidar explícitamente no lo presenta como vivido.');
  const secondJob = await waitForMemoryJob({ origin: server.origin, headers: reopenedHeaders, path, jobId: secondReceipt.jobId });
  assert.equal(secondJob.state, 'completed');
  assert.deepEqual(secondJob.actors, [{ actorId, state: 'existing' }], 'La reapertura explícita reconoce la SQLite ICM existente.');
  assert.equal(secondJob.failureCode, null);
  assertEmptyIcmStore(databasePath);
  assert.deepEqual(readFileSync(databasePath), preparedBytes, 'La verificación explícita no escribe recuerdos ni reemplaza la base.');
  assertNoStoryExecution(root, fixture.runId);
  assert.deepEqual(production.host.journal.loadWorld({ runId: fixture.runId }), originalWorld);
  assert.deepEqual(production.host.journal.readWorldConfiguration({ runId: fixture.runId }), originalConfiguration);
  await assertIcmReadonlyReadiness({ root, journal: production.host.journal, catalog, runId: fixture.runId, actorId });
});
