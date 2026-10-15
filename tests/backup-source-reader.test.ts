import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createBackupForkRestorePort } from '../src/application/backup-fork-restore.ts';
import { readBackupForkSource } from '../src/application/backup-fork-source.ts';
import { openBackupService, type BackupRestoreContext } from '../src/application/backup-service.ts';
import { freezeExperience } from '../src/application/experience-envelope.ts';
import { createForkRuntime } from '../src/application/fork-runtime.ts';
import { createHostBackupQuiesce } from '../src/application/host-backup-quiesce.ts';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createVoiceRuntime } from '../src/application/voice-runtime.ts';
import { createWorldDeliverySupervisor } from '../src/application/world-delivery-supervisor.ts';
import { createIcmMemoryAdapter } from '../src/adapters/icm.ts';
import { WorldSnapshotSchema } from '../src/domain/world-schema.ts';
import { draftFixture } from './fixtures/continuista.ts';

const binaryPath = process.env.PERSONAJES_ICM_TEST_BINARY;
const real = { skip: binaryPath === undefined ? 'ICM real no configurado' : false };

function inventory(root: string): { path: string; bytes: Buffer; mode: number }[] {
  const entries: { path: string; bytes: Buffer; mode: number }[] = [];
  function visit(path: string, prefix: string) {
    for (const name of readdirSync(path).sort()) {
      const file = join(path, name); const relative = prefix + name; const status = lstatSync(file);
      if (status.isDirectory()) visit(file, relative + '/');
      else { assert.ok(status.isFile() && !status.isSymbolicLink()); entries.push({ path: relative, bytes: readFileSync(file), mode: status.mode }); }
    }
  }
  visit(root, ''); return entries;
}

async function fixture(missingCheckpoint = false) {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-backup-source-'));
  const sourceRoot = join(directory, 'source'); const sourceHost = openLocalHost({ privateDataRoot: sourceRoot });
  const voice = createVoiceRuntime({ host: sourceHost }); const deliveries = createWorldDeliverySupervisor({ journal: sourceHost.journal });
  const inactive = { backupBusy: false };
  const quiesce = createHostBackupQuiesce({ host: sourceHost, admission: createHostRequestBarrier(), oauth: inactive, access: inactive, preflight: inactive, voice: voice.service, deliveries });
  const backups = openBackupService({ privateDataRoot: sourceRoot, quiesce });
  let receiver: ReturnType<typeof openLocalHost> | undefined;
  try {
    const { kind, schemaVersion, runId, revision, ...patch } = draftFixture(); void kind; void schemaVersion; void runId; void revision;
    assert.equal(patch.worldSnapshot.kind, 'configured');
    if (patch.worldSnapshot.kind !== 'configured') assert.fail();
    const initial = WorldSnapshotSchema.parse(patch.worldSnapshot.value); const actor = initial.entities.find(entity => entity.kind === 'character');
    assert.ok(actor?.kind === 'character');
    patch.worldSnapshot.value = WorldSnapshotSchema.parse({ ...initial, entities: [...initial.entities, {
      ...actor, characterId: 'ausente-archivo', entityId: randomUUID(), trueDisplayName: 'Ausente sintético',
      presence: { kind: 'absent' }, preparation: { kind: 'notPrepared', reason: 'Fuera de escena y sin preparación actoral.' },
    }] });
    const draft = sourceHost.journal.createRunConfigurationDraft({ principalId: 'backup-source-test', idempotencyKey: randomUUID(), patch });
    assert.equal(draft.kind, 'created'); if (draft.kind !== 'created') assert.fail();
    const ready = sourceHost.journal.validateRunConfigurationDraft({ principalId: 'backup-source-test', idempotencyKey: randomUUID(), runId: draft.draft.runId, expectedRevision: 0 });
    assert.equal(ready.kind, 'ready'); if (ready.kind !== 'ready') assert.fail();
    let world = sourceHost.journal.loadWorld({ runId: ready.runId }); assert.ok(world);
    sourceHost.journal.setWorldLifecycle({ runId: world.runId, expectedWorldRevision: world.revision, expectedConfigRevision: 0, target: 'running' });
    for (const owner of [actor.characterId, 'ausente-archivo']) {
      sourceHost.journal.recordExperience(freezeExperience({ schemaVersion: 1, experienceId: randomUUID(), runId: world.runId, actorId: owner,
        kind: 'belief', content: `Recuerdo privado sintético de ${owner}. No vi la contraseña.`, sourceRefs: [],
        fictitiousAt: world.clock.instant, receivedAt: world.clock.instant, worldSeq: world.seq, confidence: 0.5,
        revision: 0, predecessor: { kind: 'initial' }, basedOn: [] }));
    }
    const change = sourceHost.journal.applyCircumstanceCommand({ runId: world.runId, principalId: 'backup-source-test', operationId: randomUUID(), idempotencyKey: randomUUID(),
      expectedWorldRevision: world.revision, expectedDirectionRevision: 0, payload: { kind: 'changeCircumstance', scope: { kind: 'run' }, operation: { kind: 'setLighting', placeId: world.places[0]?.id, level: 'dim' } } });
    assert.equal(change.kind, 'stored'); world = sourceHost.journal.loadWorld({ runId: ready.runId }); assert.ok(world);
    if (missingCheckpoint) {
      const db = new DatabaseSync(join(sourceRoot, 'world.sqlite'));
      try { db.exec('PRAGMA foreign_keys=ON; DELETE FROM actor_state_cuts WHERE commit_index=1; DELETE FROM actor_state_cut_batches WHERE commit_index=1;'); }
      finally { db.close(); }
    }
    const backupId = randomUUID(); const job = await backups.create({ backupId, scope: { kind: 'all' } });
    assert.equal(job.state, 'succeeded', job.safeCode ?? '');
    const bundle = backups.verify(backupId); const sourceInventory = inventory(bundle.bundleRoot);
    receiver = openLocalHost({ privateDataRoot: join(directory, 'receiver') });
    // Trusted host-port setup only: this does not implement or prove HTTP bundle admission.
    const bundleRoot = join(receiver.privateDataRoot, 'backups', backupId); mkdirSync(join(receiver.privateDataRoot, 'backups'), { recursive: true });
    cpSync(bundle.bundleRoot, bundleRoot, { recursive: true });
    assert.deepEqual(inventory(bundleRoot), sourceInventory);
    backups.close(); await voice.close(); await deliveries.close(); sourceHost.close();
    const archivedRoot = join(directory, 'source-offline'); renameSync(sourceRoot, archivedRoot);
    const archivedBundle = join(archivedRoot, 'backups', backupId);
    const context: BackupRestoreContext = { manifest: bundle.manifest, manifestHash: bundle.hash, bundleRoot, mode: 'fork',
      principalId: 'backup-source-test', operationId: randomUUID(), sourceRunId: world.runId, name: 'Derivación desde backup verificado', reason: 'Ensayo de host receptor sin padre vivo.' };
    const host = receiver;
    return { directory, host, context, world, actorId: actor.characterId, sourceRoot, bundleRoot, archivedBundle, sourceInventory,
      read() { return readBackupForkSource({ host, request: { manifest: context.manifest, manifestHash: context.manifestHash, bundleRoot, sourceRunId: world.runId } }); },
      assertClean() {
        const readers = join(host.privateDataRoot, 'restore-readers');
        if (existsSync(readers)) assert.deepEqual(readdirSync(readers), [], 'La copia y sidecars temporales se eliminan.');
        assert.deepEqual(inventory(archivedBundle), sourceInventory);
      },
      close() { host.close(); rmSync(directory, { recursive: true, force: true }); rmSync(sourceRoot + '-auth', { recursive: true, force: true }); },
    };
  } catch (error: unknown) {
    backups.close(); await voice.close(); await deliveries.close(); sourceHost.close(); receiver?.close();
    rmSync(directory, { recursive: true, force: true }); throw error;
  }
}

test('lector restaura mediante factory trusted en host nuevo sin padre y publica archivos ICM reales aislados', real, async () => {
  assert.ok(binaryPath); const f = await fixture(); const runtime = createForkRuntime({ host: f.host, binaryPath });
  try {
    assert.equal(existsSync(f.sourceRoot), false); assert.equal(f.host.journal.loadWorld({ runId: f.world.runId }), undefined);
    const before = inventory(f.bundleRoot); const source = f.read();
    const archivedActor = source.cuts.find(cut => cut.actorId === 'ausente-archivo');
    assert.ok(archivedActor); assert.deepEqual(archivedActor.knowledge, { kind: 'unavailable', reason: 'knowledge-not-recorded' });
    assert.equal(archivedActor.experiences.length, 1);
    const port = createBackupForkRestorePort({ host: f.host, runtime }); const preview = port.preview(f.context);
    assert.deepEqual(preview.blockers, []); assert.ok(preview.differences.some(line => line.includes(f.world.runId)));
    await port.apply({ ...f.context, targetFingerprint: preview.targetFingerprint }); await runtime.waitForIdle();
    const job = runtime.read({ operationId: f.context.operationId, principalId: f.context.principalId }); assert.ok(job?.state === 'ready');
    assert.deepEqual(job.backupOrigin, source.backup); const target = f.host.journal.loadWorld({ runId: job.targetRunId }); assert.ok(target);
    assert.equal(target.seq, f.world.seq); assert.equal(target.clock.instant, f.world.clock.instant);
    for (const cut of source.cuts) {
      const destination = f.host.journal.readActorStateCut({ runId: job.targetRunId, actorId: cut.actorId, commitIndex: 0, worldRevision: 0, worldSeq: target.seq });
      assert.ok(destination.kind === 'found'); assert.equal(destination.cut.experiences.length, cut.experiences.length);
      if (cut.knowledge.kind === 'unavailable') assert.deepEqual(destination.cut.knowledge, cut.knowledge);
      const memory = await createIcmMemoryAdapter({ privateDataRoot: f.host.privateDataRoot, runId: job.targetRunId, actorId: cut.actorId, binaryPath,
        ledger: { findReceipt: request => f.host.journal.readForkProjectionReceipt({ operationId: job.operationId, ...request }) } });
      const recalled = await memory.diagnostics.listForensic({ throughWorldSeq: target.seq });
      assert.equal(recalled.rejectedCount, 0); assert.equal(recalled.experiences.length, cut.experiences.length);
      assert.ok(recalled.experiences.every(item => item.experience.actorId === cut.actorId && item.experience.runId === target.runId && item.experience.forkOrigin?.sourceRunId === f.world.runId));
    }
    assert.equal(f.host.journal.loadWorld({ runId: f.world.runId }), undefined);
    assert.deepEqual(inventory(f.bundleRoot), before); f.assertClean();
    await port.apply({ ...f.context, targetFingerprint: preview.targetFingerprint }); await runtime.waitForIdle();
    assert.equal(runtime.read({ operationId: f.context.operationId, principalId: f.context.principalId })?.targetRunId, target.runId);
    assert.deepEqual(inventory(f.bundleRoot), before);
  } finally { await runtime.close(); f.close(); }
});

for (const fault of ['hash', 'wal', 'shm', 'journal', 'hardlink', 'symlink'] as const) {
  test(`lector rechaza journal de bundle con ${fault} sin alterar fuente ni dejar copia temporal`, async () => {
    const f = await fixture();
    try {
      const journal = join(f.bundleRoot, 'world.sqlite');
      if (fault === 'hash') { const bytes = readFileSync(journal); bytes[0] = 0; writeFileSync(journal, bytes); }
      else if (fault === 'hardlink') linkSync(journal, join(f.directory, 'external-journal'));
      else if (fault === 'symlink') { const bytes = readFileSync(journal); const external = join(f.directory, 'external-journal'); writeFileSync(external, bytes); rmSync(journal); symlinkSync(external, journal); }
      else writeFileSync(`${journal}-${fault}`, 'sidecar no registrado');
      const before = readFileSync(journal); assert.throws(() => f.read()); assert.deepEqual(readFileSync(journal), before); f.assertClean();
    } finally { f.close(); }
  });
}

test('checkpoint ausente en backup bloquea preview y elimina copia migrable sin inventar memoria', async () => {
  const f = await fixture(true);
  try {
    const before = inventory(f.bundleRoot);
    assert.throws(() => f.read(), /RESTORE_CHECKPOINT_UNAVAILABLE/);
    const port = createBackupForkRestorePort({ host: f.host });
    assert.deepEqual(port.preview(f.context).blockers, ['RESTORE_CHECKPOINT_UNAVAILABLE']);
    assert.deepEqual(inventory(f.bundleRoot), before); f.assertClean();
    assert.equal(f.host.journal.loadWorld({ runId: f.world.runId }), undefined);
  } finally { f.close(); }
});
