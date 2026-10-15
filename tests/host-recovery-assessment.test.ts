import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { exchangeIntegrity } from '../src/adapters/exchange-integrity.ts';
import { createIcmMemoryAdapter } from '../src/adapters/icm.ts';
import { createExchangeRuntime } from '../src/application/exchange-runtime.ts';
import { freezeExperience } from '../src/application/experience-envelope.ts';
import { assessHostRecovery, applyHostRecoveryPreservation } from '../src/application/host-recovery-assessment.ts';
import { createHostBackupQuiesce } from '../src/application/host-backup-quiesce.ts';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createVoiceRuntime } from '../src/application/voice-runtime.ts';
import { createWorldDeliverySupervisor } from '../src/application/world-delivery-supervisor.ts';
import { draftFixture } from './fixtures/continuista.ts';
import { hashContinuistaValue } from '../src/domain/continuista-review.ts';
import { DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';

const binaryPath = process.env.PERSONAJES_ICM_TEST_BINARY;
const real = { skip: binaryPath === undefined ? 'ICM real no configurado' : false };
function bytes(root: string) {
  const result: { path: string; bytes: Buffer }[] = [];
  function visit(path: string, prefix: string) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (entry.isDirectory()) visit(join(path, entry.name), prefix + entry.name + '/');
      else if (entry.isFile()) result.push({ path: prefix + entry.name, bytes: readFileSync(join(path, entry.name)) });
    }
  }
  visit(root, ''); return result;
}
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-recovery-assess-')); const root = join(directory, 'data'); const host = openLocalHost({ privateDataRoot: root });
  const voice = createVoiceRuntime({ host }); const deliveries = createWorldDeliverySupervisor({ journal: host.journal });
  const exchange = await createExchangeRuntime({ host, catalog: await loadCatalog({ repositoryRoot: process.cwd() }) }); const inactive = { backupBusy: false };
  exchange.setBackupQuiesce(createHostBackupQuiesce({ host, voice: voice.service, deliveries, admission: createHostRequestBarrier(), oauth: inactive, access: inactive, preflight: inactive }));
  return {
    directory, root, host, exchange,
    async backup() { const id = randomUUID(); assert.equal((await exchange.backups.create({ backupId: id, scope: { kind: 'all' } })).state, 'succeeded'); return exchange.backups.verify(id); },
    mutate(operation: (db: DatabaseSync) => void) { const db = new DatabaseSync(join(root, 'world.sqlite')); try { operation(db); } finally { db.close(); } },
    async close() { exchange.close(); await voice.close(); await deliveries.close(); host.close(); rmSync(directory, { recursive: true, force: true }); rmSync(root + '-auth', { recursive: true, force: true }); },
  };
}
function assess(f: Awaited<ReturnType<typeof fixture>>, bundle: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['backup']>>) {
  return assessHostRecovery({ privateDataRoot: f.root, bundleRoot: bundle.bundleRoot, manifest: bundle.manifest, manifestHash: bundle.hash });
}

test('assessment normaliza journal completo sin tocar main/WAL/SHM y preserva backups/recibos administrativos posteriores', async () => {
  const f = await fixture();
  try {
    const bundle = await f.backup(); const later = await f.backup();
    const operationId = randomUUID();
    f.mutate(db => {
      db.prepare("INSERT INTO exchange_http_operations(principal_id,operation_id,request_hash,response_json,operation_kind) VALUES(?,?,?,NULL,'restore')").run('recovery-test', operationId, 'a'.repeat(64));
      exchangeIntegrity(db).seal('exchange_http_operations', 'principal_id=? AND operation_id=?', ['recovery-test', operationId]);
    });
    const before = bytes(f.root); const result = assess(f, bundle);
    assert.ok(result.kind === 'compatible', JSON.stringify(result));
    assert.equal(result.currentFingerprint, result.bundleFingerprint); assert.deepEqual(bytes(f.root), before);
    assert.ok(result.preserve.files.some(file => file.path.startsWith(`backups/${later.manifest.backupId}/`)));
    assert.ok(result.preserve.tables.find(table => table.name === 'exchange_http_operations')?.rows.some(row => row.operation_id === operationId));
    const stage = join(f.directory, 'stage'); mkdirSync(stage);
    for (const file of bundle.manifest.files) { const path = join(stage, file.path); mkdirSync(dirname(path), { recursive: true }); copyFileSync(join(bundle.bundleRoot, file.path), path); }
    applyHostRecoveryPreservation({ stageRoot: stage, plan: result.preserve });
    assert.ok(existsSync(join(stage, `backups/${later.manifest.backupId}/manifest.json`)));
    const db = new DatabaseSync(join(stage, 'world.sqlite'), { readOnly: true });
    try {
      const row = db.prepare('SELECT response_json,operation_kind FROM exchange_http_operations WHERE operation_id=?').get(operationId);
      assert.equal(row?.response_json, null); assert.equal(row?.operation_kind, 'restore');
      exchangeIntegrity(db).verify('exchange_http_operations', 'principal_id=? AND operation_id=?', ['recovery-test', operationId]);
      assert.equal(db.prepare('SELECT count(*) count FROM backup_jobs').get()?.count, 2);
    } finally { db.close(); }
    assert.deepEqual(bytes(f.root), before);
  } finally { await f.close(); }
});

for (const change of ['voice', 'budget', 'unknown-table', 'unclassified-receipt'] as const) {
  test(`assessment bloquea cambio operativo ${change} aunque no haya WorldEvents`, async () => {
    const f = await fixture();
    try {
      const bundle = await f.backup();
      f.mutate(db => {
        if (change === 'voice') db.prepare('INSERT INTO voice_entities VALUES(?,?,?,?)').run('synthetic', randomUUID(), '{}', 'b'.repeat(64));
        if (change === 'budget') db.prepare('INSERT INTO run_budgets(run_id,max_calls,consumed) VALUES(?,?,?)').run(randomUUID(), 20, 1);
        if (change === 'unknown-table') db.exec('CREATE TABLE future_operational_state(id TEXT PRIMARY KEY);');
        if (change === 'unclassified-receipt') {
          db.prepare("INSERT INTO exchange_http_operations(principal_id,operation_id,request_hash,response_json,operation_kind) VALUES('test','operation',?,'{}','unclassified')").run('a'.repeat(64));
          exchangeIntegrity(db).seal('exchange_http_operations', 'principal_id=? AND operation_id=?', ['test', 'operation']);
        }
      });
      const before = bytes(f.root); const result = assess(f, bundle); assert.equal(result.kind, 'blocked');
      if (result.kind === 'blocked') assert.equal(result.code, change === 'unknown-table' ? 'RECOVERY_UNKNOWN_TABLE' : 'RECOVERY_STATE_DIVERGED');
      assert.deepEqual(bytes(f.root), before);
    } finally { await f.close(); }
  });
}

test('assessment bloquea archivo o directorio desconocido sin omitirlo del inventario', async () => {
  const f = await fixture();
  try {
    const bundle = await f.backup(); const unknown = join(f.root, 'unknown-document.md'); writeFileSync(unknown, 'No se debe perder.');
    const result = assess(f, bundle); assert.ok(result.kind === 'blocked'); assert.equal(result.code, 'RECOVERY_UNKNOWN_CURRENT_FILE');
    rmSync(unknown); mkdirSync(join(f.root, 'unknown-empty'));
    const empty = assess(f, bundle); assert.ok(empty.kind === 'blocked'); assert.equal(empty.code, 'RECOVERY_UNKNOWN_DIRECTORY');
  } finally { await f.close(); }
});

test('assessment exige identidad de raíz canónica del backup sin suplir un hash histórico ausente', async () => {
  const f = await fixture();
  try {
    const bundle = await f.backup(); const { originRootHash, ...withoutRoot } = bundle.manifest; assert.ok(originRootHash);
    for (const manifest of [withoutRoot, { ...bundle.manifest, originRootHash: 'a'.repeat(64) }]) {
      const result = assessHostRecovery({ privateDataRoot: f.root, bundleRoot: bundle.bundleRoot, manifest, manifestHash: bundle.hash });
      assert.ok(result.kind === 'blocked'); assert.equal(result.code, 'RECOVERY_ORIGIN_ROOT_MISMATCH');
    }
  } finally { await f.close(); }
});

test('assessment preserva auth Pi actual y rechaza modelos desconocidos y enlaces antes de I/O SQLite', async () => {
  const f = await fixture();
  try {
    const bundle = await f.backup(); mkdirSync(join(f.root, 'pi/auth'), { recursive: true });
    writeFileSync(join(f.root, 'pi/auth/auth.json'), '{"synthetic":"current-private-login"}', { mode: 0o600 });
    writeFileSync(join(f.root, 'pi/auth/access-fingerprint.salt'), 'a'.repeat(64), { mode: 0o600 });
    const before = bytes(f.root); const result = assess(f, bundle); assert.ok(result.kind === 'compatible');
    assert.deepEqual(result.preserve.files.filter(file => file.path.startsWith('pi/')).map(file => file.path), ['pi/auth/access-fingerprint.salt', 'pi/auth/auth.json']);
    assert.deepEqual(bytes(f.root), before);
    writeFileSync(join(f.root, 'pi/auth/models.json'), '{}'); assert.ok(assess(f, bundle).kind === 'blocked'); rmSync(join(f.root, 'pi/auth/models.json'));
    const external = join(f.directory, 'external'); writeFileSync(external, 'externo'); symlinkSync(external, join(f.root, 'linked'));
    assert.ok(assess(f, bundle).kind === 'blocked'); assert.equal(readFileSync(external, 'utf8'), 'externo');
  } finally { await f.close(); }
});

test('assessment rechaza corrupción y hardlink del journal sin mutar bytes', async () => {
  const f = await fixture();
  try {
    const bundle = await f.backup(); linkSync(join(f.root, 'world.sqlite'), join(f.directory, 'external.sqlite'));
    const before = bytes(f.root); assert.ok(assess(f, bundle).kind === 'blocked'); assert.deepEqual(bytes(f.root), before);
    rmSync(join(f.directory, 'external.sqlite'));
    const damaged = readFileSync(join(bundle.bundleRoot, 'world.sqlite')); damaged[0] = 0; writeFileSync(join(bundle.bundleRoot, 'world.sqlite'), damaged);
    const result = assess(f, bundle); assert.ok(result.kind === 'blocked'); assert.equal(result.code, 'RECOVERY_BUNDLE_HASH_INVALID');
    assert.deepEqual(readFileSync(join(bundle.bundleRoot, 'world.sqlite')), damaged);
  } finally { await f.close(); }
});

test('assessment compara JSONL Pi registrado escrito por SDK y bloquea tail posterior sin evento nuevo', async () => {
  const f = await fixture();
  try {
    const { kind, schemaVersion, runId, revision, ...patch } = draftFixture(); void kind; void schemaVersion; void runId; void revision;
    const created = f.host.journal.createRunConfigurationDraft({ principalId: 'recovery', idempotencyKey: randomUUID(), patch }); assert.ok(created.kind === 'created');
    const ready = f.host.journal.validateRunConfigurationDraft({ principalId: 'recovery', idempotencyKey: randomUUID(), runId: created.draft.runId, expectedRevision: 0 }); assert.ok(ready.kind === 'ready');
    const configuration = ReadyRunConfigurationSchema.parse(f.host.journal.readWorldConfiguration({ runId: ready.runId }));
    const prepared = configuration.roster.preparedCharacters[0]; assert.ok(prepared);
    const actorRoot = join(f.root, 'runs', ready.runId, 'actors', prepared.characterId); const cwd = join(actorRoot, 'cwd'); mkdirSync(cwd, { recursive: true });
    const manager = SessionManager.create(cwd, join(actorRoot, 'sessions'));
    manager.appendMessage({ role: 'user', content: 'Registro sintético, no inferencia.', timestamp: Date.now() });
    manager.appendMessage({ role: 'assistant', content: [], api: 'openai-codex-responses', provider: 'openai-codex', model: 'gpt-6.1-sol', stopReason: 'stop', timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const sessionPath = manager.getSessionFile(); assert.ok(sessionPath && existsSync(sessionPath));
    f.host.journal.registerActorPiSession({ runId: ready.runId, actorId: prepared.characterId, sessionId: manager.getSessionId(), sessionPath,
      preparedContextHash: hashContinuistaValue(prepared), profile: DEFAULT_INFERENCE_PROFILE });
    const bundle = await f.backup(); const baseline = assess(f, bundle); assert.ok(baseline.kind === 'compatible');
    manager.appendMessage({ role: 'user', content: 'Tail sintético posterior que debe conservarse.', timestamp: Date.now() });
    const result = assess(f, bundle); assert.ok(result.kind === 'blocked'); assert.equal(result.code, 'RECOVERY_STATE_DIVERGED');
  } finally { await f.close(); }
});

test('assessment detecta cambio ICM real en WAL y conserva bytes de ambas familias SQLite', real, async () => {
  assert.ok(binaryPath); const f = await fixture();
  try {
    const { kind, schemaVersion, runId, revision, ...patch } = draftFixture(); void kind; void schemaVersion; void runId; void revision;
    const created = f.host.journal.createRunConfigurationDraft({ principalId: 'recovery', idempotencyKey: randomUUID(), patch }); assert.ok(created.kind === 'created');
    const ready = f.host.journal.validateRunConfigurationDraft({ principalId: 'recovery', idempotencyKey: randomUUID(), runId: created.draft.runId, expectedRevision: 0 }); assert.ok(ready.kind === 'ready');
    const world = f.host.journal.loadWorld({ runId: ready.runId }); assert.ok(world); const actor = world.entities.find(entity => entity.kind === 'character'); assert.ok(actor?.kind === 'character');
    const memory = await createIcmMemoryAdapter({ privateDataRoot: f.root, runId: world.runId, actorId: actor.characterId, binaryPath, ledger: { findReceipt: () => undefined } }); await memory.initialize();
    const bundle = await f.backup();
    const config = `runs/${world.runId}/actors/${actor.characterId}/icm-config.toml`;
    // A normal actor backup must register its deterministic CLI config as well.
    assert.ok(bundle.manifest.files.some(file => file.path === config), 'El inventario backup debe incluir configuración ICM.');
    const initial = assess(f, bundle); assert.ok(initial.kind === 'compatible');
    const memoryPath = join(f.root, `runs/${world.runId}/actors/${actor.characterId}/memory.sqlite`);
    const keeper = new DatabaseSync(memoryPath, { readOnly: true });
    try {
      keeper.exec('BEGIN'); keeper.prepare('SELECT count(*) count FROM memories').get();
      const mainBefore = readFileSync(memoryPath);
      await memory.projector.store(freezeExperience({ schemaVersion: 1, experienceId: randomUUID(), runId: world.runId, actorId: actor.characterId,
        kind: 'belief', content: 'No conocí la clave. Recuerdo posterior al backup.', sourceRefs: [], fictitiousAt: world.clock.instant,
        receivedAt: world.clock.instant, worldSeq: world.seq, confidence: 0.6, revision: 0, predecessor: { kind: 'initial' }, basedOn: [] }));
      assert.deepEqual(readFileSync(memoryPath), mainBefore, 'El main conserva el snapshot anterior; el cambio reside en WAL.');
      assert.ok(readFileSync(memoryPath + '-wal').length > 0);
      const before = bytes(f.root); const changed = assess(f, bundle); assert.ok(changed.kind === 'blocked'); assert.equal(changed.code, 'RECOVERY_STATE_DIVERGED'); assert.deepEqual(bytes(f.root), before);
    } finally { keeper.close(); }
  } finally { await f.close(); }
});

test('assessment compara historia de configuración como estado operativo y bloquea una fila agregada sin evento nuevo', async () => {
  const f = await fixture();
  try {
    const { kind, schemaVersion, runId, revision, ...patch } = draftFixture(); void kind; void schemaVersion; void runId; void revision;
    const draft = f.host.journal.createRunConfigurationDraft({ principalId: 'recovery-history-test', idempotencyKey: randomUUID(), patch }); assert.ok(draft.kind === 'created');
    const ready = f.host.journal.validateRunConfigurationDraft({ principalId: 'recovery-history-test', idempotencyKey: randomUUID(), runId: draft.draft.runId, expectedRevision: 0 }); assert.ok(ready.kind === 'ready');
    const bundle = await f.backup();
    assert.ok(assess(f, bundle).kind === 'compatible');
    f.mutate(db => {
      const worldBefore = db.prepare('SELECT snapshot_json,snapshot_hash FROM world_runs').all();
      const eventsBefore = db.prepare('SELECT * FROM world_events').all();
      // Explicit corruption fixture: append an unadmitted history record, without
      // altering any world snapshot, event or the append-only trigger definitions.
      const inserted = db.prepare(`INSERT INTO run_configuration_revisions
        SELECT run_id,commit_index+1,config_revision+1,configuration_json,configuration_hash,
          continuity_fence_json,configuration_hash,snapshot_hash,configuration_hash
        FROM world_runs WHERE run_id=?`).run(ready.runId);
      assert.equal(inserted.changes, 1);
      assert.deepEqual(db.prepare('SELECT snapshot_json,snapshot_hash FROM world_runs').all(), worldBefore);
      assert.deepEqual(db.prepare('SELECT * FROM world_events').all(), eventsBefore);
    });
    const before = bytes(f.root); const result = assess(f, bundle);
    assert.ok(result.kind === 'blocked'); assert.equal(result.code, 'RECOVERY_STATE_DIVERGED');
    assert.deepEqual(bytes(f.root), before);
  } finally { await f.close(); }
});

for (const table of [
  'identity_promotion_receipts', 'actor_identity_epochs', 'actor_pi_session_archives', 'actor_identity_session_bindings', 'actor_job_identity_bindings',
  'configurator_http_operations', 'configurator_jobs', 'configurator_generations', 'configurator_sessions', 'configurator_checkpoints', 'configurator_candidates', 'configurator_operations', 'configurator_consents',
]) test(`assessment incluye ${table} en comparación operativa aunque no cambien eventos`, async () => {
  const f = await fixture();
  try {
    const bundle = await f.backup(); assert.ok(assess(f, bundle).kind === 'compatible');
    f.mutate(db => {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table), 'La migración debe crear la tabla.');
      // Fixed, test-owned table names. A schema-only divergence must not be
      // discarded as administrative state while recovering an older backup.
      db.exec(`ALTER TABLE ${table} ADD COLUMN schema39_probe TEXT`);
      assert.equal(db.prepare('SELECT count(*) n FROM world_events').get()?.n, 0);
    });
    const before = bytes(f.root); const result = assess(f, bundle);
    assert.ok(result.kind === 'blocked'); assert.equal(result.code, 'RECOVERY_STATE_DIVERGED');
    assert.deepEqual(bytes(f.root), before);
  } finally { await f.close(); }
});
