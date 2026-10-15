import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { IcmRuntimeConfigurationJobSchema } from '../src/domain/icm-runtime-configuration.ts';
import { openIcmRuntimeConfiguration } from '../src/application/icm-runtime-configuration.ts';

function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'personajes-icm-runtime-'));
  const root = join(parent, 'host');
  const marker = join(parent, 'invoked.txt');
  const binary = join(parent, 'icm-test');
  writeFileSync(binary, `#!/bin/sh\nprintf 'called\\n' >> '${marker}'\nprintf 'icm 0.11.4\\n'\n`, { mode: 0o700 });
  chmodSync(binary, 0o700);
  return { parent, root, marker, binary, runtimeRoot: `${root}-runtime` };
}

function runtime(input: {
  root: string;
  environmentBinaryPath?: string;
  acquireMaintenance?: () => Promise<() => void>;
  apply?: (input: { binaryPath: string | null }) => Promise<void>;
}) {
  const applied: Array<string | null> = [];
  const application = openIcmRuntimeConfiguration({
    privateDataRoot: input.root,
    ...(input.environmentBinaryPath === undefined ? {} : { environmentBinaryPath: input.environmentBinaryPath }),
    acquireMaintenance: input.acquireMaintenance ?? (async () => () => undefined),
    apply: input.apply ?? (async ({ binaryPath }) => { applied.push(binaryPath); }),
  });
  return { application, applied };
}

async function terminalJob(app: ReturnType<typeof openIcmRuntimeConfiguration>, jobId: string, principalId: string) {
  for (let index = 0; index < 400; index += 1) {
    const job = app.read({ jobId, principalId });
    assert.ok(job);
    if (job.state !== 'queued' && job.state !== 'running') return IcmRuntimeConfigurationJobSchema.parse(job);
    await delay(5);
  }
  assert.fail('El trabajo ICM no llegó a estado terminal.');
}

test('configuration is machine-local, environment is only a fallback, and construction does not execute ICM', async t => {
  const f = fixture();
  let application: ReturnType<typeof openIcmRuntimeConfiguration> | undefined;
  t.after(async () => { await application?.close(); rmSync(f.parent, { recursive: true, force: true }); });
  application = runtime({ root: f.root, environmentBinaryPath: f.binary }).application;
  assert.deepEqual(application.readConfiguration(), {
    kind: 'icm-runtime-configuration', revision: 0, configuredBinaryPath: f.binary, source: 'environment',
  });
  assert.equal(existsSync(f.marker), false, 'Leer/crear la configuración no ejecuta el binario.');
  assert.equal(existsSync(join(f.runtimeRoot, 'runtime.sqlite')), true);
  assert.equal(existsSync(join(f.root, 'runtime.sqlite')), false, 'El ledger de configuración vive fuera del host respaldable.');
  assert.throws(() => openIcmRuntimeConfiguration({
    privateDataRoot: f.root,
    environmentBinaryPath: f.binary,
    acquireMaintenance: async () => () => undefined,
    apply: async () => undefined,
  }));
  await application.close();
  application = undefined;
  const reopened = runtime({ root: f.root, environmentBinaryPath: f.binary }).application;
  application = reopened;
  assert.equal(reopened.readConfiguration().source, 'environment');
});

test('worker waits for maintenance, validates the realpath executable, and commits only after apply succeeds', async t => {
  const f = fixture();
  let allowMaintenance!: () => void;
  let enteredMaintenance!: () => void;
  const maintenanceEntered = new Promise<void>(resolveEntered => { enteredMaintenance = resolveEntered; });
  const maintenanceGate = new Promise<void>(resolveGate => { allowMaintenance = resolveGate; });
  let releaseCount = 0;
  const { application, applied } = runtime({
    root: f.root,
    acquireMaintenance: async () => {
      enteredMaintenance();
      await maintenanceGate;
      return () => { releaseCount += 1; };
    },
  });
  t.after(async () => { await application.close(); rmSync(f.parent, { recursive: true, force: true }); });
  const request = { binaryPath: f.binary, expectedRevision: 0, idempotencyKey: randomUUID(), principalId: 'local-user' };
  const accepted = application.start(request);
  assert.equal(accepted.kind, 'accepted');
  assert.ok(accepted.kind === 'accepted');
  await maintenanceEntered;
  await delay(30);
  assert.equal(existsSync(f.marker), false, 'No valida ni ejecuta el binario antes del lease de mantenimiento.');
  assert.deepEqual(applied, []);
  assert.equal(application.backupBusy, false, 'El lease aún no se entregó.');
  allowMaintenance();
  const job = await terminalJob(application, accepted.job.jobId, request.principalId);
  assert.equal(job.state, 'succeeded');
  assert.equal(application.readConfiguration().revision, 1);
  assert.equal(application.readConfiguration().source, 'saved');
  assert.equal(application.readConfiguration().configuredBinaryPath, realpathSync(f.binary));
  assert.deepEqual(applied, [realpathSync(f.binary)]);
  assert.equal(releaseCount, 1);
  assert.equal(application.backupBusy, false);
  assert.equal(existsSync(f.marker), true);
});

test('idempotency receipts are immutable and job history is principal-bound', async t => {
  const f = fixture();
  const { application } = runtime({ root: f.root });
  t.after(async () => { await application.close(); rmSync(f.parent, { recursive: true, force: true }); });
  const request = { binaryPath: f.binary, expectedRevision: 0, idempotencyKey: randomUUID(), principalId: 'alice' };
  const accepted = application.start(request);
  assert.equal(accepted.kind, 'accepted');
  assert.ok(accepted.kind === 'accepted');
  const originalReceipt = accepted.job;
  const completed = await terminalJob(application, originalReceipt.jobId, request.principalId);
  assert.equal(completed.state, 'succeeded');
  const replay = application.start(request);
  assert.equal(replay.kind, 'existing');
  assert.ok(replay.kind === 'existing');
  assert.deepEqual(replay.job, originalReceipt, 'El receipt repetido conserva exactamente el snapshot aceptado.');
  assert.deepEqual(application.read({ jobId: originalReceipt.jobId, principalId: 'bob' }), undefined);
  assert.deepEqual(application.list({ principalId: 'bob' }).jobs, []);
  assert.deepEqual(application.list({ principalId: 'alice' }).jobs, [completed]);
  const conflict = application.start({ ...request, binaryPath: null });
  assert.deepEqual(conflict, { kind: 'idempotency-conflict' });
});

test('stale configuration revisions are rejected without creating jobs', async t => {
  const f = fixture();
  const { application } = runtime({ root: f.root });
  t.after(async () => { await application.close(); rmSync(f.parent, { recursive: true, force: true }); });
  const result = application.start({ binaryPath: null, expectedRevision: 2, idempotencyKey: randomUUID(), principalId: 'alice' });
  assert.equal(result.kind, 'rejected');
  assert.ok(result.kind === 'rejected');
  assert.equal(result.code, 'configuration-stale');
  assert.equal(result.current.revision, 0);
  assert.equal(application.list({ principalId: 'alice' }).jobs.length, 0);
});

test('a failed apply keeps the selected path and revision stable with a safe failure code', async t => {
  const f = fixture();
  const { application } = runtime({ root: f.root, apply: async () => { throw new Error('/secret/private/runtime detail'); } });
  t.after(async () => { await application.close(); rmSync(f.parent, { recursive: true, force: true }); });
  const accepted = application.start({ binaryPath: f.binary, expectedRevision: 0, idempotencyKey: randomUUID(), principalId: 'alice' });
  assert.ok(accepted.kind === 'accepted');
  const job = await terminalJob(application, accepted.job.jobId, 'alice');
  assert.equal(job.state, 'failed');
  assert.equal(job.failureCode, 'apply-failed');
  assert.equal(JSON.stringify(job).includes('/secret/private/runtime detail'), false);
  assert.deepEqual(application.readConfiguration(), {
    kind: 'icm-runtime-configuration', revision: 0, configuredBinaryPath: null, source: 'unconfigured',
  });
});

test('host maintenance and recovery busy messages are mapped to a safe retryable code', async t => {
  const f = fixture();
  const { application } = runtime({ root: f.root, apply: async () => { throw new Error('PRODUCTION_RUNTIME_CONFIGURATION_BUSY'); } });
  t.after(async () => { await application.close(); rmSync(f.parent, { recursive: true, force: true }); });
  const accepted = application.start({ binaryPath: f.binary, expectedRevision: 0, idempotencyKey: randomUUID(), principalId: 'alice' });
  assert.ok(accepted.kind === 'accepted');
  const job = await terminalJob(application, accepted.job.jobId, 'alice');
  assert.equal(job.state, 'failed');
  assert.equal(job.failureCode, 'maintenance-unavailable');
  assert.equal(JSON.stringify(job).includes('PRODUCTION_RUNTIME_CONFIGURATION_BUSY'), false);
  assert.equal(application.readConfiguration().revision, 0);
  assert.equal(application.readConfiguration().configuredBinaryPath, null);
});

test('startup interrupts queued jobs and replay never restarts the captured operation', async t => {
  const f = fixture();
  const first = runtime({ root: f.root });
  const request = { binaryPath: f.binary, expectedRevision: 0, idempotencyKey: randomUUID(), principalId: 'alice' };
  const accepted = first.application.start(request);
  assert.ok(accepted.kind === 'accepted');
  await first.application.close();

  const second = runtime({ root: f.root });
  t.after(async () => { await second.application.close(); rmSync(f.parent, { recursive: true, force: true }); });
  const interrupted = second.application.read({ jobId: accepted.job.jobId, principalId: request.principalId });
  assert.equal(interrupted?.state, 'interrupted');
  assert.equal(interrupted?.failureCode, 'cancelled');
  const replay = second.application.start(request);
  assert.ok(replay.kind === 'existing');
  assert.deepEqual(replay.job, accepted.job);
  await delay(30);
  assert.equal(existsSync(f.marker), false, 'Repetir un receipt no dispara un nuevo trabajo.');
  assert.equal(second.application.readConfiguration().revision, 0);
});

test('preexisting symlink or hardlink runtime database is rejected before target bytes or mode change', t => {
  const symlinkFixture = fixture();
  t.after(() => rmSync(symlinkFixture.parent, { recursive: true, force: true }));
  mkdirSync(symlinkFixture.runtimeRoot, { mode: 0o700 });
  const symlinkTarget = join(symlinkFixture.parent, 'external-symlink-target.sqlite');
  const originalSymlinkBytes = Buffer.from('external sqlite target remains untouched');
  writeFileSync(symlinkTarget, originalSymlinkBytes, { mode: 0o644 });
  const symlinkMode = statSync(symlinkTarget).mode & 0o777;
  symlinkSync(symlinkTarget, join(symlinkFixture.runtimeRoot, 'runtime.sqlite'));
  assert.throws(() => runtime({ root: symlinkFixture.root }));
  assert.deepEqual(readFileSync(symlinkTarget), originalSymlinkBytes);
  assert.equal(statSync(symlinkTarget).mode & 0o777, symlinkMode);

  const hardlinkFixture = fixture();
  t.after(() => rmSync(hardlinkFixture.parent, { recursive: true, force: true }));
  mkdirSync(hardlinkFixture.runtimeRoot, { mode: 0o700 });
  const hardlinkTarget = join(hardlinkFixture.parent, 'external-hardlink-target.sqlite');
  const originalHardlinkBytes = Buffer.from('external hardlink target remains untouched');
  writeFileSync(hardlinkTarget, originalHardlinkBytes, { mode: 0o600 });
  const hardlinkMode = statSync(hardlinkTarget).mode & 0o777;
  linkSync(hardlinkTarget, join(hardlinkFixture.runtimeRoot, 'runtime.sqlite'));
  assert.throws(() => runtime({ root: hardlinkFixture.root }));
  assert.deepEqual(readFileSync(hardlinkTarget), originalHardlinkBytes);
  assert.equal(statSync(hardlinkTarget).mode & 0o777, hardlinkMode);
});

test('closing the runtime kills a validating CLI process group with descendants holding output pipes', {
  skip: process.platform === 'win32' ? 'La validación de grupos de procesos aplica en POSIX.' : false,
  timeout: 10_000,
}, async t => {
  const f = fixture();
  writeFileSync(f.binary, `#!/bin/sh\nsleep 3600 &\nchild=$!\nprintf '%s\\n' "$child" > '${f.marker}'\nwait "$child"\n`, { mode: 0o700 });
  chmodSync(f.binary, 0o700);
  const { application } = runtime({ root: f.root });
  t.after(async () => { await application.close(); rmSync(f.parent, { recursive: true, force: true }); });
  const accepted = application.start({ binaryPath: f.binary, expectedRevision: 0, idempotencyKey: randomUUID(), principalId: 'alice' });
  assert.ok(accepted.kind === 'accepted');
  for (let index = 0; index < 100 && !existsSync(f.marker); index += 1) await delay(5);
  assert.equal(existsSync(f.marker), true, 'El ejecutable de prueba ya lanzó el descendiente que hereda las tuberías.');
  const closeCompleted = await Promise.race([
    application.close().then(() => true),
    delay(2_000).then(() => false),
  ]);
  assert.equal(closeCompleted, true, 'close() termina sin esperar al descendiente que heredó stdout/stderr.');
});
