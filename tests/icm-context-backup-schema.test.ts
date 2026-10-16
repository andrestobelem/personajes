import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { z } from 'zod';
import { openBackupService } from '../src/application/backup-service.ts';
import { createHostBackupQuiesce } from '../src/application/host-backup-quiesce.ts';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createRunMemoryPreparation } from '../src/application/run-memory-preparation.ts';
import { assessHostRecovery } from '../src/application/host-recovery-assessment.ts';
import { createVoiceRuntime } from '../src/application/voice-runtime.ts';
import { ApprovedJournalSchemaSchema, validateExternalBackup, type ApprovedJournalSchema } from '../src/application/external-backup-validation.ts';
import { createWorldDeliverySupervisor } from '../src/application/world-delivery-supervisor.ts';
import { BackupManifestSchema } from '../src/domain/backup.ts';
import { downgradeCoordinatorPulsesTo44 } from './fixtures/journal-v45-downgrade.ts';

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function inventory(root: string) {
  const result: { path: string; bytes: Buffer }[] = [];
  function visit(path: string, prefix: string) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : 1)) {
      if (entry.isDirectory()) visit(join(path, entry.name), prefix + entry.name + '/');
      else result.push({ path: prefix + entry.name, bytes: readFileSync(join(path, entry.name)) });
    }
  }
  visit(root, '');
  return result;
}

async function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'personajes-icm-backup-schema-')));
  const privateDataRoot = join(directory, 'data');
  const host = openLocalHost({ privateDataRoot });
  const voice = createVoiceRuntime({ host });
  const deliveries = createWorldDeliverySupervisor({ journal: host.journal });
  const memories = createRunMemoryPreparation({ host, acquireMaintenance: async () => () => undefined });
  const inactive = { backupBusy: false };
  const backups = openBackupService({ privateDataRoot, quiesce: createHostBackupQuiesce({ host, voice: voice.service,
    deliveries, admission: createHostRequestBarrier(), oauth: inactive, access: inactive, preflight: inactive }) });
  try {
    const backupId = randomUUID();
    assert.equal((await backups.create({ backupId, scope: { kind: 'all' } })).state, 'succeeded');
    const bundle = backups.verify(backupId);
    const database = new DatabaseSync(join(privateDataRoot, 'world.sqlite'), { readOnly: true });
    let approvedJournalSchema: ApprovedJournalSchema;
    try {
      approvedJournalSchema = ApprovedJournalSchemaSchema.parse(database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all());
    } finally { database.close(); }
    let manifest = bundle.manifest;
    let manifestHash = bundle.hash;
    return {
      directory,
      privateDataRoot,
      bundleRoot: bundle.bundleRoot,
      approvedJournalSchema,
      get manifest() { return manifest; },
      get manifestHash() { return manifestHash; },
      request(sourceOutputRoot = join(directory, 'validated')) {
        return { bundleRoot: bundle.bundleRoot, manifest, manifestHash, approvedJournalSchema, sourceOutputRoot };
      },
      mutateJournal(operation: (database: DatabaseSync) => void) {
        const path = join(bundle.bundleRoot, 'world.sqlite');
        const database = new DatabaseSync(path);
        try { operation(database); database.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { database.close(); }
        const bytes = readFileSync(path);
        manifest = BackupManifestSchema.parse({ ...manifest, files: manifest.files.map(file => file.path === 'world.sqlite'
          ? { ...file, bytes: bytes.length, sha256: hash(bytes) } : file) });
        const manifestBytes = JSON.stringify(manifest);
        writeFileSync(join(bundle.bundleRoot, 'manifest.json'), manifestBytes);
        manifestHash = hash(manifestBytes);
      },
      declareVersion(journalVersion: number) {
        manifest = BackupManifestSchema.parse({ ...manifest, journalVersion });
        const manifestBytes = JSON.stringify(manifest);
        writeFileSync(join(bundle.bundleRoot, 'manifest.json'), manifestBytes);
        manifestHash = hash(manifestBytes);
      },
      async close() {
        backups.close();
        await memories.close();
        await voice.close();
        await deliveries.close();
        host.close();
        rmSync(directory, { recursive: true, force: true });
        rmSync(privateDataRoot + '-auth', { recursive: true, force: true });
      },
    };
  } catch (error: unknown) {
    backups.close(); await memories.close(); await voice.close(); await deliveries.close(); host.close();
    rmSync(directory, { recursive: true, force: true }); rmSync(privateDataRoot + '-auth', { recursive: true, force: true });
    throw error;
  }
}


/** Reconstruct the exact v44 journal without v45 actor initiative objects. */
function downgradeInitiativesTo44(database: DatabaseSync) {
  downgradeCoordinatorPulsesTo44(database);
  database.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
    DROP TRIGGER IF EXISTS actor_initiatives_source_immutable;
    DROP INDEX IF EXISTS actor_initiatives_ready;
    DROP INDEX IF EXISTS actor_initiatives_one_open_per_actor;
    DROP INDEX IF EXISTS actor_turn_jobs_initiative;
    DROP TABLE IF EXISTS actor_initiatives;
    ALTER TABLE actor_turn_jobs DROP COLUMN initiative_id;
    DELETE FROM schema_version WHERE version=45;
    COMMIT; PRAGMA foreign_keys=ON;`);
}

/** Reconstruct the exact pre-v44 budget authority shape without deleting v43 packets. */
function downgradeBudgetAuthorityTo43(database: DatabaseSync) {
  downgradeInitiativesTo44(database);
  database.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
    DROP TABLE preparation_configurator_records;
    DROP TABLE preparation_configurator_operations;
    DROP TABLE preparation_configurator_jobs;
    DROP TABLE model_budget_authorities;
    CREATE TABLE saved_model_time_state AS SELECT * FROM model_time_run_state;
    DROP TABLE model_time_run_state;
    CREATE TABLE model_time_run_state(
      run_id TEXT PRIMARY KEY REFERENCES world_runs(run_id) ON DELETE RESTRICT,
      unknown_legacy_requests INTEGER NOT NULL DEFAULT 0 CHECK(unknown_legacy_requests>=0)
    );
    INSERT INTO model_time_run_state SELECT * FROM saved_model_time_state;
    DROP TABLE saved_model_time_state;
    DELETE FROM schema_version WHERE version=44;
    COMMIT; PRAGMA foreign_keys=ON;`);
}

test('un backup canónico actual v45 valida la DDL completa de ICM e iniciativas mediante el worker aislado', async () => {
  const f = await fixture();
  try {
    assert.equal(f.manifest.journalVersion, 45);
    const table = f.approvedJournalSchema.find(object => object.type === 'table' && object.name === 'icm_context_packets');
    assert.ok(table);
    assert.ok(table.sql);
    assert.ok(table.sql.includes('scope_json TEXT NOT NULL'));
    assert.ok(table.sql.includes('packet_json TEXT NOT NULL'));
    assert.ok(table.sql.includes('receipt_json TEXT NOT NULL'));
    for (const name of ['icm_context_packets_no_update', 'icm_context_packets_no_delete']) {
      assert.ok(f.approvedJournalSchema.some(object => object.type === 'trigger' && object.name === name && object.tbl_name === 'icm_context_packets'));
    }
    assert.ok(f.approvedJournalSchema.some(object => object.type === 'table' && object.name === 'actor_initiatives'));
    assert.ok(f.approvedJournalSchema.some(object => object.type === 'trigger' && object.name === 'actor_initiatives_source_immutable'));
    assert.ok(f.approvedJournalSchema.some(object => object.type === 'index' && object.name === 'actor_initiatives_ready'));
    assert.ok(f.approvedJournalSchema.some(object => object.type === 'index' && object.name === 'actor_initiatives_one_open_per_actor'));
    assert.ok(f.approvedJournalSchema.some(object => object.type === 'index' && object.name === 'actor_turn_jobs_initiative'));
    assert.ok(f.approvedJournalSchema.some(object => object.type === 'table' && object.name === 'actor_turn_jobs' && object.sql?.includes('initiative_id TEXT')));
    const automaticInitiativeIndexes = f.approvedJournalSchema.filter(object => object.type === 'index'
      && object.tbl_name === 'actor_initiatives' && object.name.startsWith('sqlite_autoindex_actor_initiatives_'));
    assert.equal(automaticInitiativeIndexes.length, 2);
    assert.ok(automaticInitiativeIndexes.every(object => object.sql === null));

    const before = inventory(f.bundleRoot);
    const result = await validateExternalBackup(f.request());
    assert.equal(result.journalVersion, 45);
    assert.deepEqual(result.sources, []);
    assert.deepEqual(inventory(f.bundleRoot), before);
    const recovery = assessHostRecovery({ privateDataRoot: f.privateDataRoot, bundleRoot: f.bundleRoot,
      manifest: f.manifest, manifestHash: f.manifestHash });
    assert.equal(recovery.kind, 'compatible', JSON.stringify(recovery));
  } finally { await f.close(); }
});

test('un backup histórico v44 sin tabla ni columna de iniciativas se valida tras migrar solo la copia', async () => {
  const f = await fixture();
  try {
    f.mutateJournal(downgradeInitiativesTo44);
    f.declareVersion(44);
    const source = new DatabaseSync(join(f.bundleRoot, 'world.sqlite'), { readOnly: true });
    try {
      assert.equal(source.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name='actor_initiatives'").get()?.count, 0);
      assert.equal(source.prepare("SELECT COUNT(*) AS count FROM pragma_table_xinfo('actor_turn_jobs') WHERE name='initiative_id'").get()?.count, 0);
      const coordinator = z.strictObject({ sql: z.string() }).parse(source.prepare(
        "SELECT sql FROM sqlite_schema WHERE type='table' AND name='coordinator_pulses'").get());
      assert.ok(!coordinator.sql.includes("'actorInitiative'"));
      assert.ok(coordinator.sql.includes('parked_for_pulse_id'));
      assert.equal(source.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='index' AND name IN('coordinator_pulses_one_running','coordinator_pulses_parked_for')").get()?.count, 2);
      assert.equal(source.prepare("SELECT COUNT(*) AS count FROM pragma_foreign_key_list('coordinator_pulses') WHERE \"table\"='coordinator_pulses'").get()?.count, 1);
    } finally { source.close(); }
    // SQLite may leave a checkpointed WAL/SHM pair after the read-only inspection.
    rmSync(join(f.bundleRoot, 'world.sqlite-wal'), { force: true });
    rmSync(join(f.bundleRoot, 'world.sqlite-shm'), { force: true });
    const before = inventory(f.bundleRoot);
    assert.deepEqual(before.map(file => file.path).sort(), ['manifest.json', ...f.manifest.files.map(file => file.path)].sort());
    const result = await validateExternalBackup(f.request());
    assert.equal(result.journalVersion, 44);
    assert.deepEqual(result.sources, []);
    assert.deepEqual(inventory(f.bundleRoot), before);
  } finally { await f.close(); }
});

test('v45 rechaza el ledger de iniciativas si falta un objeto exacto aprobado', async () => {
  const f = await fixture();
  try {
    f.mutateJournal(database => database.exec('DROP INDEX actor_turn_jobs_initiative'));
    const before = inventory(f.bundleRoot);
    await assert.rejects(validateExternalBackup(f.request()), /EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID/);
    assert.deepEqual(inventory(f.bundleRoot), before);
  } finally { await f.close(); }
});

test('v44 rechaza objetos v45 aunque el manifest declare un journal v44', async () => {
  const f = await fixture();
  try {
    f.mutateJournal(database => database.exec('DELETE FROM schema_version WHERE version=45'));
    f.declareVersion(44);
    const before = inventory(f.bundleRoot);
    await assert.rejects(validateExternalBackup(f.request()), /EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID/);
    assert.deepEqual(inventory(f.bundleRoot), before);
  } finally { await f.close(); }
});

test('el helper rechaza una versión de journal futura no admitida', async () => {
  const f = await fixture();
  try {
    f.declareVersion(46);
    await assert.rejects(validateExternalBackup(f.request()), /EXTERNAL_BACKUP_JOURNAL_VERSION_UNSUPPORTED/);
  } finally { await f.close(); }
});

test('un backup histórico v43 conserva su tabla y triggers ICM al migrar a v44', async () => {
  const f = await fixture();
  try {
    f.mutateJournal(downgradeBudgetAuthorityTo43);
    f.declareVersion(43);
    const before = inventory(f.bundleRoot);
    const result = await validateExternalBackup(f.request());
    assert.equal(result.journalVersion, 43);
    assert.deepEqual(result.sources, []);
    assert.deepEqual(inventory(f.bundleRoot), before);
    const database = new DatabaseSync(join(f.bundleRoot, 'world.sqlite'), {readOnly: true});
    try {
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name IN('icm_context_packets','icm_context_packets_no_update','icm_context_packets_no_delete')").get()?.count, 3);
    } finally { database.close(); }
  } finally { await f.close(); }
});

test('un journal v42 se reconstruye contra DDL actual sin la tabla futura ni ejecutar schema fuente', async () => {
  const f = await fixture();
  try {
    f.mutateJournal(downgradeBudgetAuthorityTo43);
    f.mutateJournal(database => database.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
      DROP TABLE icm_context_packets;
      DELETE FROM schema_version WHERE version=43;
      COMMIT;`));
    f.declareVersion(42);
    const before = inventory(f.bundleRoot);

    const result = await validateExternalBackup(f.request());
    assert.equal(result.journalVersion, 42);
    assert.deepEqual(result.sources, []);
    assert.deepEqual(inventory(f.bundleRoot), before);
  } finally { await f.close(); }
});

test('el worker rechaza un trigger ICM alterado aunque el manifest y la copia tengan hashes nuevos', async () => {
  const f = await fixture();
  try {
    f.mutateJournal(database => database.exec(`DROP TRIGGER icm_context_packets_no_update;
      CREATE TRIGGER icm_context_packets_no_update BEFORE UPDATE ON icm_context_packets BEGIN SELECT 1; END;`));
    const before = inventory(f.bundleRoot);

    await assert.rejects(validateExternalBackup(f.request()), /EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID/);
    assert.deepEqual(inventory(f.bundleRoot), before);
  } finally { await f.close(); }
});

test('v43 rechaza un backup al que le falta la tabla de paquetes ICM', async () => {
  const f = await fixture();
  try {
    f.mutateJournal(downgradeBudgetAuthorityTo43);
    f.declareVersion(43);
    f.mutateJournal(database => database.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
      DROP TABLE icm_context_packets;
      COMMIT;`));
    const before = inventory(f.bundleRoot);

    await assert.rejects(validateExternalBackup(f.request()), /EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID/);
    assert.deepEqual(inventory(f.bundleRoot), before);
  } finally { await f.close(); }
});

test('el worker inspecciona paquetes corruptos incluso si no hay fences y el archivo tiene hash nuevo', async () => {
  const f = await fixture();
  try {
    f.mutateJournal(database => {
      database.exec('PRAGMA foreign_keys=OFF');
      database.prepare(`INSERT INTO icm_context_packets(run_id,role,actor_id,job_id,generation,
        scope_json,scope_hash,packet_json,packet_hash,receipt_json,receipt_hash,created_at)
        VALUES(?,'director','',?,0,'{}',?,'{}',?,'{}',?,0)`)
        .run(randomUUID(), randomUUID(), hash('{}'), hash('{}'), hash('{}'));
    });
    assert.deepEqual(f.manifest.fences, []);
    const before = inventory(f.bundleRoot);
    await assert.rejects(validateExternalBackup(f.request()), /EXTERNAL_BACKUP_ICM_CONTEXT_INVALID/);
    assert.deepEqual(inventory(f.bundleRoot), before);
  } finally { await f.close(); }
});
