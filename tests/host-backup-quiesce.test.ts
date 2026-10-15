import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createIcmMemoryAdapter } from '../src/adapters/icm.ts';
import { openBackupService } from '../src/application/backup-service.ts';
import { createHostBackupQuiesce } from '../src/application/host-backup-quiesce.ts';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { CharacterIdSchema } from '../src/domain/values.ts';
import { draftFixture } from './fixtures/continuista.ts';

const binaryPath = process.env.PERSONAJES_ICM_TEST_BINARY;
const realIcm = { skip: binaryPath === undefined ? 'ICM real no configurado' : false };

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-host-backup-config-'));
  const host = openLocalHost({ privateDataRoot: join(directory, 'host') });
  const admission = createHostRequestBarrier();
  const inactive = { backupBusy: false };
  const suspension = { async suspendAdmissions() { return () => {}; } };
  const quiesce = createHostBackupQuiesce({ host, admission, oauth: inactive, access: inactive, preflight: inactive,
    deliveries: suspension, voice: { ...suspension, backupArtifacts() { return []; } } });
  const backups = openBackupService({ privateDataRoot: host.privateDataRoot, quiesce });
  const { kind, schemaVersion, runId, revision, ...patch } = draftFixture(); void kind; void schemaVersion; void runId; void revision;
  const draft = host.journal.createRunConfigurationDraft({ principalId: 'backup-config-test', idempotencyKey: randomUUID(), patch });
  assert.equal(draft.kind, 'created'); if (draft.kind !== 'created') assert.fail();
  const ready = host.journal.validateRunConfigurationDraft({ principalId: 'backup-config-test', idempotencyKey: randomUUID(), runId: draft.draft.runId, expectedRevision: 0 });
  assert.equal(ready.kind, 'ready'); if (ready.kind !== 'ready') assert.fail();
  const configuration = host.journal.readWorldConfiguration({ runId: ready.runId }); assert.ok(configuration);
  const actorId = CharacterIdSchema.parse('personaje-prueba');
  const configPath = `runs/${ready.runId}/actors/${actorId}/icm-config.toml`;
  return { directory, host, backups, quiesce, admission, runId: ready.runId, actorId, configPath,
    close() { backups.close(); host.close(); rmSync(directory, { recursive: true, force: true }); } };
}

async function initialize(f: ReturnType<typeof fixture>) {
  assert.ok(binaryPath);
  const adapter = await createIcmMemoryAdapter({ privateDataRoot: f.host.privateDataRoot, runId: f.runId, actorId: f.actorId,
    binaryPath, ledger: { findReceipt: input => f.host.journal.findReceipt(input) } });
  assert.equal((await adapter.initialize()).kind, 'initialized');
}

test('backup del host conserva exactamente el TOML real de ICM junto a su SQLite', realIcm, async () => {
  const f = fixture();
  try {
    await initialize(f);
    const actual = readFileSync(join(f.host.privateDataRoot, f.configPath));
    assert.ok(actual.length > 0);
    const hold = await f.quiesce.acquire();
    try { assert.ok(Array.isArray(hold.artifacts)); assert.ok(hold.artifacts.some(item => item.path === f.configPath && item.kind === 'fork-metadata')); }
    finally { await hold.release(); }
    const backupId = randomUUID(); const result = await f.backups.create({ backupId, scope: { kind: 'all' } });
    assert.equal(result.state, 'succeeded', result.safeCode ?? '');
    const bundle = f.backups.verify(backupId);
    assert.ok(bundle.manifest.files.some(file => file.path === f.configPath));
    assert.ok(bundle.manifest.files.some(file => file.path === f.configPath.replace('icm-config.toml', 'memory.sqlite')));
    assert.deepEqual(readFileSync(join(bundle.bundleRoot, f.configPath)), actual);
    assert.equal(f.admission.isHeld, false);
    // Verification also refuses a link substituted after a successful backup.
    const copied = join(bundle.bundleRoot, f.configPath); unlinkSync(copied);
    symlinkSync(join(f.host.privateDataRoot, f.configPath), copied);
    assert.throws(() => f.backups.verify(backupId), /BACKUP_PATH_ESCAPE|ELOOP|BACKUP_SYMLINK/);
  } finally { f.close(); }
});

test('backup no inventa configuración ICM cuando el actor aún no la tiene', async () => {
  const f = fixture();
  try {
    assert.equal(existsSync(join(f.host.privateDataRoot, f.configPath)), false);
    const backupId = randomUUID(); assert.equal((await f.backups.create({ backupId, scope: { kind: 'all' } })).state, 'succeeded');
    const bundle = f.backups.verify(backupId);
    assert.equal(bundle.manifest.files.some(file => file.path.endsWith('icm-config.toml')), false);
    assert.equal(existsSync(join(f.host.privateDataRoot, f.configPath)), false);
  } finally { f.close(); }
});

for (const kind of ['symbolic', 'hard']) test(`backup rechaza configuración ICM con enlace ${kind} sin publicar ni modificar el destino`, realIcm, async () => {
  const f = fixture();
  try {
    await initialize(f);
    const target = join(f.directory, 'outside-config.toml');
    const bytes = Buffer.from('private-test-destination\n'); writeFileSync(target, bytes);
    const config = join(f.host.privateDataRoot, f.configPath); unlinkSync(config);
    if (kind === 'symbolic') symlinkSync(target, config); else linkSync(target, config);
    const backupId = randomUUID(); const result = await f.backups.create({ backupId, scope: { kind: 'all' } });
    assert.equal(result.state, 'failed'); assert.notEqual(result.safeCode, null);
    assert.throws(() => f.backups.verify(backupId), /BACKUP_NOT_READY/);
    assert.equal(existsSync(join(f.host.privateDataRoot, 'backups', backupId)), false);
    assert.deepEqual(readFileSync(target), bytes);
    assert.equal(f.admission.isHeld, false);
  } finally { f.close(); }
});
