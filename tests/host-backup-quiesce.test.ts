import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { canonicalContinuistaValue, hashContinuistaValue } from '../src/domain/continuista-review.ts';
import { ConfiguratorJobSessionSchema } from '../src/domain/configurator-jobs.ts';
import { ActorIdentityEpochSchema } from '../src/domain/identity-promotion.ts';
import { DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
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

test('backup conserva sesión Pi archivada sin candidatos ni checkpoint y rechaza su ausencia', async () => {
  const f = fixture();
  try {
    const configuration = ReadyRunConfigurationSchema.parse(f.host.journal.readWorldConfiguration({ runId: f.runId }));
    const prepared = configuration.roster.preparedCharacters[0]; assert.ok(prepared);
    const actorRoot = join(f.host.privateDataRoot, 'runs', f.runId, 'actors', f.actorId);
    const cwd = join(actorRoot, 'cwd'); mkdirSync(cwd, { recursive: true });
    const manager = SessionManager.create(cwd, join(actorRoot, 'sessions'));
    manager.appendMessage({ role: 'user', content: 'Registro histórico sintético escrito por SDK; no inferencia.', timestamp: Date.now() });
    manager.appendMessage({ role: 'assistant', content: [], api: 'openai-codex-responses', provider: 'openai-codex', model: 'gpt-6.1-sol', stopReason: 'stop', timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const path = manager.getSessionFile(); assert.ok(path && existsSync(path)); const originalBytes = readFileSync(path);
    f.host.journal.registerActorPiSession({ runId: f.runId, actorId: f.actorId, sessionId: manager.getSessionId(), sessionPath: path,
      preparedContextHash: hashContinuistaValue(prepared), profile: DEFAULT_INFERENCE_PROFILE });
    const db = new DatabaseSync(join(f.host.privateDataRoot, 'world.sqlite'));
    try {
      // Construct only the historical storage boundary, using the complete real
      // session row and its original binding. No identity promotion is claimed.
      db.exec('PRAGMA foreign_keys=ON');
      const row = db.prepare('SELECT * FROM actor_pi_sessions WHERE run_id=? AND actor_id=?').get(f.runId, f.actorId); assert.ok(row);
      const epoch = ActorIdentityEpochSchema.parse({ runId: f.runId, actorId: f.actorId, epochIndex: 0, activationCommitIndex: 0,
        configurationRevision: configuration.configRevision, configurationHash: hashContinuistaValue(configuration), identityVersion: prepared.identityVersion,
        preparedContextHash: hashContinuistaValue(prepared), createdAt: new Date().toISOString() });
      const epochJson = canonicalContinuistaValue(epoch);
      db.prepare('INSERT INTO actor_identity_epochs VALUES(?,?,0,?,?)').run(f.runId, f.actorId, epochJson, hashContinuistaValue(epoch));
      const binding = { runId: f.runId, actorId: f.actorId, epochIndex: 0, bindingIndex: 0, sessionId: manager.getSessionId(), sessionPath: path,
        preparedContextHash: hashContinuistaValue(prepared), profile: DEFAULT_INFERENCE_PROFILE };
      db.prepare('INSERT INTO actor_identity_session_bindings VALUES(?,?,0,0,?,?,?,?)').run(f.runId, f.actorId, manager.getSessionId(), path, canonicalContinuistaValue(binding), hashContinuistaValue(binding));
      const json = canonicalContinuistaValue(row); const hash = createHash('sha256').update(json).digest('hex');
      db.prepare('INSERT INTO actor_pi_session_archives(run_id,actor_id,epoch_index,session_id,session_path,row_json,row_hash) VALUES(?,?,0,?,?,?,?)')
        .run(f.runId, f.actorId, manager.getSessionId(), path, json, hash);
      db.prepare('DELETE FROM actor_pi_sessions WHERE run_id=? AND actor_id=?').run(f.runId, f.actorId);
      assert.equal(db.prepare('SELECT count(*) n FROM actor_pi_candidates').get()?.n, 0);
      assert.equal(db.prepare('SELECT count(*) n FROM actor_job_checkpoints').get()?.n, 0);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { db.close(); }
    const backupId = randomUUID(); const job = await f.backups.create({ backupId, scope: { kind: 'all' } });
    assert.equal(job.state, 'succeeded', job.safeCode ?? '');
    const bundle = f.backups.verify(backupId); const relative = `runs/${f.runId}/actors/${f.actorId}/sessions/${path.split('/').at(-1)}`;
    assert.ok(bundle.manifest.files.some(file => file.path === relative));
    assert.deepEqual(readFileSync(join(bundle.bundleRoot, relative)), originalBytes);
    unlinkSync(path);
    const missing = await f.backups.create({ backupId: randomUUID(), scope: { kind: 'all' } });
    assert.equal(missing.state, 'failed'); assert.equal(missing.safeCode, 'BACKUP_REGISTERED_SESSION_MISSING');
    assert.equal(f.admission.isHeld, false);
  } finally { f.close(); }
});

test('backup incluye archivo SDK del ledger Configurador y requiere barrera cuando hay job en vuelo', async () => {
  const f = fixture();
  try {
    const world = f.host.journal.loadWorld({ runId: f.runId }); assert.ok(world);
    const scope = { runId: f.runId, jobId: randomUUID(), generation: 0, lifecycleRevision: 0, configurationRevision: 0,
      worldRevision: world.revision, throughWorldSeq: world.seq, fictitiousAt: world.clock.instant, profile: DEFAULT_INFERENCE_PROFILE };
    const roleRoot = join(f.host.privateDataRoot, 'runs', f.runId, 'roles', 'configurador'); const cwd = join(roleRoot, 'cwd'); mkdirSync(cwd, { recursive: true });
    const manager = SessionManager.create(cwd, join(roleRoot, 'sessions'));
    manager.appendMessage({ role: 'user', content: 'Sesión de inventario sintética sin petición al modelo.', timestamp: Date.now() });
    manager.appendMessage({ role: 'assistant', content: [], api: 'openai-codex-responses', provider: 'openai-codex', model: 'gpt-6.1-sol', stopReason: 'stop', timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const path = manager.getSessionFile(); assert.ok(path && existsSync(path)); const bytes = readFileSync(path);
    const session = ConfiguratorJobSessionSchema.parse({ execution: { role: 'configurator', scope, contextHash: 'a'.repeat(64), lease: { ownerToken: f.host.ownerToken, claimToken: randomUUID() } },
      sessionId: manager.getSessionId(), sessionPath: path, baseLeafId: manager.getLeafId(), profile: DEFAULT_INFERENCE_PROFILE });
    const json = canonicalContinuistaValue(session);
    const db = new DatabaseSync(join(f.host.privateDataRoot, 'world.sqlite'));
    try {
      // Storage-boundary fixture only: this does not assert acceptance of a
      // Configurator proposal or authorize any identity change.
      db.prepare('INSERT INTO configurator_sessions VALUES(?,?,?,?,?)').run(scope.jobId, 0, path, json, hashContinuistaValue(session));
    } finally { db.close(); }
    const backupId = randomUUID(); assert.equal((await f.backups.create({ backupId, scope: { kind: 'all' } })).state, 'succeeded');
    const bundle = f.backups.verify(backupId); const relative = `runs/${f.runId}/roles/configurador/sessions/${path.split('/').at(-1)}`;
    assert.ok(bundle.manifest.files.some(file => file.path === relative)); assert.deepEqual(readFileSync(join(bundle.bundleRoot, relative)), bytes);
    const busy = new DatabaseSync(join(f.host.privateDataRoot, 'world.sqlite'));
    try {
      const job = JSON.stringify({ job: { state: 'running' } });
      busy.prepare('INSERT INTO configurator_jobs VALUES(?,?,?,?,?,?)').run(scope.jobId, 'test', f.runId, f.actorId, job, createHash('sha256').update(job).digest('hex'));
    } finally { busy.close(); }
    await assert.rejects(f.quiesce.acquire(), /BACKUP_CONFIGURATOR_BARRIER_UNAVAILABLE/);
    assert.equal(f.admission.isHeld, false);
    let acquired = 0; let released = 0; const inactive = { backupBusy: false };
    const configured = createHostBackupQuiesce({ host: f.host, admission: f.admission, oauth: inactive, access: inactive, preflight: inactive,
      deliveries: { async suspendAdmissions() { return () => {}; } }, voice: { async suspendAdmissions() { return () => {}; }, backupArtifacts() { return []; } },
      configurator: { async suspendAdmissions() { acquired++; return () => { released++; }; } } });
    const hold = await configured.acquire(); assert.equal(acquired, 1); await hold.release(); assert.equal(released, 1); assert.equal(f.admission.isHeld, false);
  } finally { f.close(); }
});

test('backup conserva binding Pi previo a rotación sin candidato ni archivo final propio', async () => {
  const f = fixture();
  try {
    const configuration = ReadyRunConfigurationSchema.parse(f.host.journal.readWorldConfiguration({ runId: f.runId }));
    const prepared = configuration.roster.preparedCharacters[0]; assert.ok(prepared);
    const actorRoot = join(f.host.privateDataRoot, 'runs', f.runId, 'actors', f.actorId); const cwd = join(actorRoot, 'cwd'); mkdirSync(cwd, { recursive: true });
    function session(text: string) {
      const manager = SessionManager.create(cwd, join(actorRoot, 'sessions'));
      manager.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
      manager.appendMessage({ role: 'assistant', content: [], api: 'openai-codex-responses', provider: 'openai-codex', model: 'gpt-6.1-sol', stopReason: 'stop', timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
      const path = manager.getSessionFile(); assert.ok(path && existsSync(path)); return { manager, path, bytes: readFileSync(path) };
    }
    const earlier = session('Binding histórico sintético previo a rotación.'); const current = session('Head sintético vigente. Ninguna petición al modelo.');
    f.host.journal.registerActorPiSession({ runId: f.runId, actorId: f.actorId, sessionId: current.manager.getSessionId(), sessionPath: current.path,
      preparedContextHash: hashContinuistaValue(prepared), profile: DEFAULT_INFERENCE_PROFILE });
    const db = new DatabaseSync(join(f.host.privateDataRoot, 'world.sqlite'));
    try {
      db.exec('PRAGMA foreign_keys=ON');
      const epoch = ActorIdentityEpochSchema.parse({ runId: f.runId, actorId: f.actorId, epochIndex: 0, activationCommitIndex: 0,
        configurationRevision: configuration.configRevision, configurationHash: hashContinuistaValue(configuration), identityVersion: prepared.identityVersion,
        preparedContextHash: hashContinuistaValue(prepared), createdAt: new Date().toISOString() });
      db.prepare('INSERT INTO actor_identity_epochs VALUES(?,?,0,?,?)').run(f.runId, f.actorId, canonicalContinuistaValue(epoch), hashContinuistaValue(epoch));
      for (const [bindingIndex, item] of [earlier, current].entries()) {
        const binding = { runId: f.runId, actorId: f.actorId, epochIndex: 0, bindingIndex, sessionId: item.manager.getSessionId(), sessionPath: item.path,
          preparedContextHash: hashContinuistaValue(prepared), profile: DEFAULT_INFERENCE_PROFILE };
        db.prepare('INSERT INTO actor_identity_session_bindings VALUES(?,?,0,?,?,?,?,?)').run(f.runId, f.actorId, bindingIndex, item.manager.getSessionId(), item.path, canonicalContinuistaValue(binding), hashContinuistaValue(binding));
      }
      assert.equal(db.prepare('SELECT count(*) n FROM actor_pi_session_archives').get()?.n, 0);
      assert.equal(db.prepare('SELECT count(*) n FROM actor_pi_candidates').get()?.n, 0);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { db.close(); }
    const backupId = randomUUID(); const result = await f.backups.create({ backupId, scope: { kind: 'all' } }); assert.equal(result.state, 'succeeded', result.safeCode ?? '');
    const bundle = f.backups.verify(backupId);
    for (const item of [earlier, current]) {
      const relative = `runs/${f.runId}/actors/${f.actorId}/sessions/${item.path.split('/').at(-1)}`;
      assert.ok(bundle.manifest.files.some(file => file.path === relative)); assert.deepEqual(readFileSync(join(bundle.bundleRoot, relative)), item.bytes);
    }
    unlinkSync(earlier.path); assert.ok(existsSync(current.path));
    const missing = await f.backups.create({ backupId: randomUUID(), scope: { kind: 'all' } });
    assert.equal(missing.state, 'failed'); assert.equal(missing.safeCode, 'BACKUP_REGISTERED_SESSION_MISSING'); assert.equal(f.admission.isHeld, false);
  } finally { f.close(); }
});
