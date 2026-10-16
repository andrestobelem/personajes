import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createIcmMemoryAdapter } from '../src/adapters/icm.ts';
import { openBackupService } from '../src/application/backup-service.ts';
import { createHostBackupQuiesce } from '../src/application/host-backup-quiesce.ts';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createVoiceRuntime } from '../src/application/voice-runtime.ts';
import { createRunMemoryPreparation } from '../src/application/run-memory-preparation.ts';
import { assessHostRecovery } from '../src/application/host-recovery-assessment.ts';
import { createWorldDeliverySupervisor } from '../src/application/world-delivery-supervisor.ts';
import { ApprovedJournalSchemaSchema, validateExternalBackup } from '../src/application/external-backup-validation.ts';
import { BackupForkSourceSchema, ForkSourceDataSchema } from '../src/application/fork-source.ts';
import { BackupManifestSchema } from '../src/domain/backup.ts';
import { downgradeCoordinatorPulsesTo44 } from './fixtures/journal-v45-downgrade.ts';
import { createIcmWorkspaceSnapshot } from '../src/domain/icm-workspace.ts';
import { sha256CanonicalJson, sha256Utf8 } from '../src/domain/canonical-json.ts';
import { freezeExperience } from '../src/application/experience-envelope.ts';
import { draftFixture } from './fixtures/continuista.ts';

const binaryPath = process.env.PERSONAJES_ICM_TEST_BINARY;
const real = { skip: binaryPath === undefined ? 'ICM real no configurado' : false };
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function inventory(root: string) {
  const result: { path: string; bytes: Buffer }[] = [];
  function visit(path: string, prefix: string) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (entry.isDirectory()) visit(join(path, entry.name), prefix + entry.name + '/');
      else result.push({ path: prefix + entry.name, bytes: readFileSync(join(path, entry.name)) });
    }
  }
  visit(root, ''); return result;
}
async function fixture(memory = false) {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-external-validation-')); const root = join(directory, 'data');
  const host = openLocalHost({ privateDataRoot: root }); const voice = createVoiceRuntime({ host }); const deliveries = createWorldDeliverySupervisor({ journal: host.journal });
  const memories = createRunMemoryPreparation({ host, acquireMaintenance: async () => () => {} });
  const inactive = { backupBusy: false }; const service = openBackupService({ privateDataRoot: root,
    quiesce: createHostBackupQuiesce({ host, voice: voice.service, deliveries, admission: createHostRequestBarrier(), oauth: inactive, access: inactive, preflight: inactive }) });
  try {
    const { kind, schemaVersion, runId, revision, ...patch } = draftFixture(); void kind; void schemaVersion; void runId; void revision;
    const created = host.journal.createRunConfigurationDraft({ principalId: 'external-test', idempotencyKey: randomUUID(), patch }); assert.ok(created.kind === 'created');
    const ready = host.journal.validateRunConfigurationDraft({ principalId: 'external-test', idempotencyKey: randomUUID(), runId: created.draft.runId, expectedRevision: 0 }); assert.ok(ready.kind === 'ready');
    let world = host.journal.loadWorld({ runId: ready.runId }); assert.ok(world); const actor = world.entities.find(entity => entity.kind === 'character'); assert.ok(actor?.kind === 'character');
    host.journal.setWorldLifecycle({ runId: world.runId, expectedWorldRevision: world.revision, expectedConfigRevision: 0, target: 'running' });
    const frozen = freezeExperience({ schemaVersion: 1, experienceId: randomUUID(), runId: world.runId, actorId: actor.characterId, kind: 'belief',
      content: 'No vi la clave. Recuerdo sintético privado, no canon.', sourceRefs: [], fictitiousAt: world.clock.instant, receivedAt: world.clock.instant,
      worldSeq: world.seq, confidence: 0.7, revision: 0, predecessor: { kind: 'initial' }, basedOn: [] });
    host.journal.recordExperience(frozen);
    if (memory) {
      assert.ok(binaryPath); const icm = await createIcmMemoryAdapter({ privateDataRoot: root, runId: world.runId, actorId: actor.characterId, binaryPath, ledger: { findReceipt: () => undefined } });
      await icm.initialize(); await icm.projector.store(frozen);
    }
    assert.equal(host.journal.applyCircumstanceCommand({ runId: world.runId, principalId: 'external-test', idempotencyKey: randomUUID(), operationId: randomUUID(),
      expectedWorldRevision: world.revision, expectedDirectionRevision: 0, payload: { kind: 'changeCircumstance', scope: { kind: 'run' }, operation: { kind: 'setLighting', placeId: world.places[0]?.id, level: 'dim' } } }).kind, 'stored');
    world = host.journal.loadWorld({ runId: ready.runId }); assert.ok(world);
    const backupId = randomUUID(); assert.equal((await service.create({ backupId, scope: { kind: 'all' } })).state, 'succeeded'); const bundle = service.verify(backupId);
    const db = new DatabaseSync(join(root, 'world.sqlite'), { readOnly: true });
    const approvedJournalSchema = ApprovedJournalSchemaSchema.parse(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()); db.close();
    let manifest = bundle.manifest; let manifestHash = bundle.hash;
    return {
      directory, world, frozen, approvedJournalSchema, bundleRoot: bundle.bundleRoot,
      get manifest() { return manifest; }, get manifestHash() { return manifestHash; },
      request(output = join(directory, 'frozen'), journalSchema = approvedJournalSchema) { return { bundleRoot: bundle.bundleRoot, manifest, manifestHash, approvedJournalSchema: journalSchema, sourceOutputRoot: output }; },
      mutate(path: string, operation: (db: DatabaseSync) => void) {
        const file = join(bundle.bundleRoot, path); const db = new DatabaseSync(file); try { operation(db); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { db.close(); }
        const bytes = readFileSync(file); manifest = BackupManifestSchema.parse({ ...manifest, files: manifest.files.map(item => item.path === path ? { ...item, bytes: bytes.length, sha256: hash(bytes) } : item) });
        const text = JSON.stringify(manifest); writeFileSync(join(bundle.bundleRoot, 'manifest.json'), text); manifestHash = hash(text);
      },
      declareVersion(version: number) {
        manifest = BackupManifestSchema.parse({ ...manifest, journalVersion: version });
        const text = JSON.stringify(manifest); writeFileSync(join(bundle.bundleRoot, 'manifest.json'), text); manifestHash = hash(text);
      },
      async close() { service.close(); await memories.close(); await voice.close(); await deliveries.close(); host.close(); rmSync(directory, { recursive: true, force: true }); rmSync(root + '-auth', { recursive: true, force: true }); },
    };
  } catch (error: unknown) { service.close(); await memories.close(); await voice.close(); await deliveries.close(); host.close(); rmSync(directory, { recursive: true, force: true }); throw error; }
}

async function preparationOperationsFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-preparation-operations-backup-')); const root = join(directory, 'data');
  const host = openLocalHost({ privateDataRoot: root }); const voice = createVoiceRuntime({ host });
  const deliveries = createWorldDeliverySupervisor({ journal: host.journal }); const memories = createRunMemoryPreparation({ host, acquireMaintenance: async () => () => {} });
  const inactive = { backupBusy: false };
  const service = openBackupService({ privateDataRoot: root, quiesce: createHostBackupQuiesce({ host, voice: voice.service, deliveries,
    admission: createHostRequestBarrier(), oauth: inactive, access: inactive, preflight: inactive }) });
  try {
    const { kind, schemaVersion, runId, revision, ...basePatch } = draftFixture(); void kind; void schemaVersion; void runId; void revision;
    const workspace = createIcmWorkspaceSnapshot({ sources: [{ sourceId: 'role.configurator', audience: { role: 'configurator' }, revision: 0,
      sourceHash: sha256Utf8('backup-test-configurator-contract'), sections: [{ sectionId: 'process', markdown: 'Configurar sin producir hechos.' }] }] });
    const patch = { ...basePatch, icmWorkspace: { kind: 'configured' as const,
      evidence: { kind: 'operator-choice' as const, operatorId: 'backup-test', recordedAt: '2026-10-16T12:00:00Z' }, value: workspace } };
    host.journal.setPreparationSourceAdmission(() => undefined);
    const created = host.journal.createRunConfigurationDraft({ principalId: 'backup-test', idempotencyKey: randomUUID(), patch });
    assert.equal(created.kind, 'created'); if (created.kind !== 'created') assert.fail('draft');
    host.journal.setPreparationConfiguratorSourceResolver(() => ({ actorSources: [], documents: [] }));
    const job = host.journal.createPreparationConfiguratorJob({ principalId: 'backup-test', idempotencyKey: randomUUID(), request: {
      kind: 'preparation-configurator-request', schemaVersion: 1, runId: created.draft.runId, draftRevision: created.draft.revision,
      draftHash: sha256CanonicalJson(created.draft), jobId: randomUUID(), generation: 0, instructions: 'Propuesta sintética de preparación.', actorSources: [], documentIds: [],
    } });
    const started = host.journal.startPreparationConfiguratorJob({ principalId: 'backup-test', jobId: job.scope.jobId, expectedRevision: 0, idempotencyKey: randomUUID() });
    assert.equal(started.kind, 'started');
    const cancelled = host.journal.cancelPreparationConfiguratorJob({ principalId: 'backup-test', jobId: job.scope.jobId, expectedRevision: 0, idempotencyKey: randomUUID() });
    assert.equal(cancelled.state, 'cancelled');
    const backupId = randomUUID(); assert.equal((await service.create({ backupId, scope: { kind: 'all' } })).state, 'succeeded'); const bundle = service.verify(backupId);
    const db = new DatabaseSync(join(root, 'world.sqlite'), { readOnly: true });
    const approvedJournalSchema = ApprovedJournalSchemaSchema.parse(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()); db.close();
    let manifest = bundle.manifest; let manifestHash = bundle.hash;
    return {
      directory, root, bundleRoot: bundle.bundleRoot, get manifest() { return manifest; }, get manifestHash() { return manifestHash; },
      request(output = join(directory, 'frozen')) { return { bundleRoot: bundle.bundleRoot, manifest, manifestHash, approvedJournalSchema, sourceOutputRoot: output }; },
      mutate(operation: (db: DatabaseSync) => void) {
        const file = join(bundle.bundleRoot, 'world.sqlite'); const db = new DatabaseSync(file); try { operation(db); } finally { db.close(); }
        const bytes = readFileSync(file); manifest = BackupManifestSchema.parse({ ...manifest, files: manifest.files.map(item => item.path === 'world.sqlite' ? { ...item, bytes: bytes.length, sha256: hash(bytes) } : item) });
        const text = JSON.stringify(manifest); writeFileSync(join(bundle.bundleRoot, 'manifest.json'), text); manifestHash = hash(text);
      },
      async close() { service.close(); await memories.close(); await voice.close(); await deliveries.close(); host.close(); rmSync(directory, { recursive: true, force: true }); rmSync(root + '-auth', { recursive: true, force: true }); },
    };
  } catch (error: unknown) { service.close(); await memories.close(); await voice.close(); await deliveries.close(); host.close(); rmSync(directory, { recursive: true, force: true }); throw error; }
}

test('helper acepta un backup anterior a la preparación de memorias sin ejecutar DDL de la fuente', async () => {
  const f = await fixture();
  try {
    f.mutate('world.sqlite', db => db.exec('DROP TABLE memory_preparation_receipts; DROP TABLE memory_preparation_jobs;'));
    const before = inventory(f.bundleRoot);
    const result = await validateExternalBackup(f.request());
    assert.equal(result.sources.length, 1);
    assert.deepEqual(inventory(f.bundleRoot), before);
  } finally { await f.close(); }
});

test('helper aislado valida journal v45 y escribe fuente congelada exacta sin tocar bundle ni crear sidecars', async () => {
  const f = await fixture();
  try {
    const before = inventory(f.bundleRoot); const result = await validateExternalBackup(f.request()); assert.equal(result.journalVersion, 45); assert.equal(result.sources.length, 1);
    const source = result.sources[0]; assert.ok(source); const bytes = readFileSync(source.path); assert.equal(hash(bytes), source.sha256); assert.equal(bytes.length, source.bytes);
    const data = ForkSourceDataSchema.parse(JSON.parse(bytes.toString('utf8'))); assert.equal(data.snapshot.runId, f.world.runId); assert.equal(data.snapshot.seq, f.world.seq);
    assert.ok(data.cuts.some(cut => cut.experiences.some(experience => experience.payloadHash === f.frozen.payloadHash)));
    assert.ok(BackupForkSourceSchema.safeParse({ kind: 'backup-fork-source', backup: { backupId: f.manifest.backupId, lineageId: f.manifest.lineageId, manifestHash: f.manifestHash,
      journalHash: f.manifest.files.find(file => file.path === 'world.sqlite')?.sha256 }, ...data }).success);
    assert.deepEqual(inventory(f.bundleRoot), before); assert.deepEqual(readdirSync(join(f.directory, 'frozen')), ['sources']);
  } finally { await f.close(); }
});

function downgradeBudgetAuthorityTo43(database: DatabaseSync) {
  downgradeCoordinatorPulsesTo44(database);
  database.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
    DROP TRIGGER IF EXISTS actor_initiatives_source_immutable;
    DROP INDEX IF EXISTS actor_initiatives_ready;
    DROP INDEX IF EXISTS actor_initiatives_one_open_per_actor;
    DROP INDEX IF EXISTS actor_turn_jobs_initiative;
    DROP TABLE IF EXISTS actor_initiatives;
    ALTER TABLE actor_turn_jobs DROP COLUMN initiative_id;
    DELETE FROM schema_version WHERE version=45;
    DROP TRIGGER preparation_configurator_records_no_update;
    DROP TRIGGER preparation_configurator_records_no_delete;
    DROP TRIGGER preparation_configurator_operations_no_update;
    DROP TRIGGER preparation_configurator_operations_no_delete;
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

test('helper reconstruye un backup v44 sin ledger/columna de iniciativas y migra solo la copia de trabajo', async () => {
  const f = await fixture();
  try {
    f.mutate('world.sqlite', db => {
      downgradeCoordinatorPulsesTo44(db);
      db.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
      DROP TABLE actor_initiatives;
      DROP INDEX actor_turn_jobs_initiative;
      ALTER TABLE actor_turn_jobs DROP COLUMN initiative_id;
      DELETE FROM schema_version WHERE version=45;
      COMMIT; PRAGMA foreign_keys=ON;`);
    });
    f.declareVersion(44);
    const source = new DatabaseSync(join(f.bundleRoot, 'world.sqlite'), { readOnly: true });
    try {
      assert.equal(source.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name='actor_initiatives'").get()?.count, 0);
      assert.equal(source.prepare("SELECT COUNT(*) AS count FROM pragma_table_xinfo('actor_turn_jobs') WHERE name='initiative_id'").get()?.count, 0);
    } finally { source.close(); }
    rmSync(join(f.bundleRoot, 'world.sqlite-wal'), { force: true });
    rmSync(join(f.bundleRoot, 'world.sqlite-shm'), { force: true });
    const before = inventory(f.bundleRoot);
    const result = await validateExternalBackup(f.request());
    assert.equal(result.journalVersion, 44);
    assert.equal(result.sources.length, 1);
    assert.deepEqual(inventory(f.bundleRoot), before);
  } finally { await f.close(); }
});

test('helper acepta un backup v43 auténtico sin tablas v44 y migra solo la copia de trabajo', async () => {
  const f = await fixture();
  try {
    f.mutate('world.sqlite', downgradeBudgetAuthorityTo43);
    f.declareVersion(43);
    const before = inventory(f.bundleRoot);
    const result = await validateExternalBackup(f.request());
    assert.equal(result.journalVersion, 43);
    assert.equal(result.sources.length, 1);
    assert.deepEqual(inventory(f.bundleRoot), before);
  } finally { await f.close(); }
});

test('helper rechaza una autoridad presupuestaria V44 con hash coherente en longitud pero incorrecto', async () => {
  const f = await fixture();
  try {
    f.mutate('world.sqlite', db => {
      db.prepare('INSERT OR IGNORE INTO run_budgets(run_id,max_calls) VALUES(?,0)').run(f.world.runId);
      db.prepare("INSERT INTO model_budget_authorities(run_id,kind,payload_json,payload_hash) VALUES(?,'ready','{}',?)").run(f.world.runId, 'a'.repeat(64));
    });
    const before = inventory(f.bundleRoot);
    await assert.rejects(validateExternalBackup(f.request()), /EXTERNAL_BACKUP_JOURNAL_DATA_INVALID/);
    assert.deepEqual(inventory(f.bundleRoot), before);
    assert.deepEqual(readdirSync(join(f.directory, 'frozen')), []);
  } finally { await f.close(); }
});

test('helper verifica receipts V44 start/cancel y rechaza una request alterada con bundle rehash', async () => {
  const f = await preparationOperationsFixture();
  try {
    const result = await validateExternalBackup(f.request());
    assert.equal(result.journalVersion, 45);
    const recovery = assessHostRecovery({ privateDataRoot: f.root, bundleRoot: f.bundleRoot, manifest: f.manifest, manifestHash: f.manifestHash });
    assert.equal(recovery.kind, 'compatible', JSON.stringify(recovery));
    f.mutate(db => {
      db.exec(`BEGIN; DROP TRIGGER preparation_configurator_operations_no_update;
        UPDATE preparation_configurator_operations SET request_json='{}' WHERE operation_kind='start';
        CREATE TRIGGER preparation_configurator_operations_no_update BEFORE UPDATE ON preparation_configurator_operations BEGIN SELECT RAISE(ABORT,'PREPARATION_CONFIGURATOR_OPERATION_IMMUTABLE'); END; COMMIT;`);
    });
    await assert.rejects(validateExternalBackup(f.request(join(f.directory, 'rejected'))), /EXTERNAL_BACKUP_JOURNAL_DATA_INVALID/);
  } finally { await f.close(); }
});

for (const fault of ['trigger', 'view', 'virtual', 'column', 'missing-configurator-http-ledger'] as const) {
  test(`helper rechaza schema ${fault} antes de migrar SQL fuente y conserva sus bytes`, async () => {
    const f = await fixture();
    try {
      f.mutate('world.sqlite', db => {
        if (fault === 'trigger') db.exec('CREATE TRIGGER imported_trigger BEFORE INSERT ON schema_version BEGIN DELETE FROM actor_state_cuts; END;');
        if (fault === 'view') db.exec('CREATE VIEW imported_view AS SELECT * FROM world_runs;');
        if (fault === 'virtual') db.exec('CREATE VIRTUAL TABLE imported_vtable USING fts5(content);');
        if (fault === 'column') db.exec('ALTER TABLE world_runs ADD COLUMN imported_column TEXT;');
        if (fault === 'missing-configurator-http-ledger') db.exec('DROP TABLE configurator_http_operations');
      });
      const before = inventory(f.bundleRoot);
      await assert.rejects(validateExternalBackup(f.request()), /EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID/);
      assert.deepEqual(inventory(f.bundleRoot), before); assert.deepEqual(readdirSync(join(f.directory, 'frozen')), []);
    } finally { await f.close(); }
  });
}

test('helper valida catálogo ICM0.11.4 real sin extensión fuente ni traslado crudo a memoria destino', real, async () => {
  const f = await fixture(true);
  try {
    const before = inventory(f.bundleRoot); const result = await validateExternalBackup(f.request()); assert.equal(result.sources.length, 1); assert.deepEqual(inventory(f.bundleRoot), before);
    const memory = f.manifest.files.find(file => file.path.endsWith('/memory.sqlite')); assert.ok(memory);
    f.mutate(memory.path, db => db.exec('CREATE TABLE unapproved_icm_table(content TEXT);'));
    const altered = inventory(f.bundleRoot);
    await assert.rejects(validateExternalBackup(f.request(join(f.directory, 'rejected'))), /EXTERNAL_BACKUP_ICM_SCHEMA_UNSUPPORTED/);
    assert.deepEqual(inventory(f.bundleRoot), altered);
  } finally { await f.close(); }
});

test('helper limita tiempo y fuente JSON por separado sin publicar resultados parciales', async () => {
  const f = await fixture();
  try {
    await assert.rejects(validateExternalBackup({ ...f.request(), limits: { maxSourceBytes: 1 } }), /EXTERNAL_BACKUP_SOURCE_LIMIT/);
    assert.deepEqual(readdirSync(join(f.directory, 'frozen')), []);
    await assert.rejects(validateExternalBackup({ ...f.request(join(f.directory, 'aggregate')), limits: { maxTotalSourceBytes: 1 } }), /EXTERNAL_BACKUP_TOTAL_SOURCE_LIMIT/);
    assert.deepEqual(readdirSync(join(f.directory, 'aggregate')), []);
    await assert.rejects(validateExternalBackup({ ...f.request(join(f.directory, 'timeout')), limits: { timeoutMs: 100 } }), /EXTERNAL_BACKUP_TIMEOUT/);
    assert.deepEqual(readdirSync(join(f.directory, 'timeout')), []);
  } finally { await f.close(); }
});

test('helper rechaza versión antigua declarada y archivo no inventariado sin adoptarlos como fuente', async () => {
  const f = await fixture();
  try {
    f.declareVersion(38);
    await assert.rejects(validateExternalBackup(f.request()), /EXTERNAL_BACKUP_JOURNAL_VERSION_UNSUPPORTED/);
    f.declareVersion(39);
    writeFileSync(join(f.bundleRoot, 'world.sqlite-wal'), 'WAL no admitido'); const before = inventory(f.bundleRoot);
    await assert.rejects(validateExternalBackup(f.request(join(f.directory, 'sidecar'))), /EXTERNAL_BACKUP_UNKNOWN_FILE/); assert.deepEqual(inventory(f.bundleRoot), before);
    assert.equal(existsSync(join(f.directory, 'sidecar/sources')), false);
  } finally { await f.close(); }
});

for (const table of ['run_configuration_revisions', 'actor_identity_epochs']) for (const damage of ['missing', 'changed']) test(`helper rechaza trigger append-only ${table} ${damage} aunque el manifest declare hashes nuevos`, async () => {
  const f = await fixture();
  try {
    f.mutate('world.sqlite', db => {
      db.exec(`DROP TRIGGER ${table}_no_update`);
      if (damage === 'changed') db.exec(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT 1; END`);
    });
    const before = inventory(f.bundleRoot);
    await assert.rejects(validateExternalBackup(f.request()), /EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID/);
    assert.deepEqual(inventory(f.bundleRoot), before);
  } finally { await f.close(); }
});

 test('helper acepta backup v39 por DDL histórico exacto y conserva la fuente al migrar', async()=>{
 const f=await fixture();try{
  f.mutate('world.sqlite',db=>{downgradeBudgetAuthorityTo43(db);db.exec(`DROP TRIGGER icm_context_packets_no_update; DROP TRIGGER icm_context_packets_no_delete; DROP TABLE icm_context_packets; PRAGMA foreign_keys=OFF;BEGIN;CREATE TABLE saved_oauth AS SELECT * FROM pi_oauth_jobs;DROP TABLE pi_oauth_jobs;
CREATE TABLE pi_oauth_jobs(job_id TEXT PRIMARY KEY,provider TEXT NOT NULL CHECK(provider='openai-codex'),kind TEXT NOT NULL CHECK(kind IN('login','logout')),
        principal_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('queued','running','cancel-requested','succeeded','failed','canceled','interrupted')),
        revision INTEGER NOT NULL CHECK(revision>=0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,safe_code TEXT,
        owner_token TEXT,claim_token TEXT,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,
        CHECK((owner_token IS NULL)=(claim_token IS NULL)),CHECK(state NOT IN('running','cancel-requested') OR owner_token IS NOT NULL));INSERT INTO pi_oauth_jobs SELECT * FROM saved_oauth;DROP TABLE saved_oauth;
CREATE UNIQUE INDEX pi_oauth_one_running ON pi_oauth_jobs(provider) WHERE state IN('running','cancel-requested');
DROP INDEX coordinator_pulses_parked_for;ALTER TABLE coordinator_pulses DROP COLUMN parked_for_pulse_id;
DELETE FROM schema_version WHERE version IN(40,41,42,43);COMMIT;`);});
  f.declareVersion(39);
  const v44Tables = new Set(['model_budget_authorities','preparation_configurator_jobs','preparation_configurator_operations','preparation_configurator_records']);
  const historicalSchema=f.approvedJournalSchema.filter(object=>!['coordinator_pulses_parked_for','icm_context_packets'].includes(object.name)
    &&!['icm_context_packets','model_budget_authorities','preparation_configurator_jobs','preparation_configurator_operations','preparation_configurator_records'].includes(object.tbl_name)
    &&!['icm_context_packets_no_update','icm_context_packets_no_delete','preparation_configurator_operations_no_update','preparation_configurator_operations_no_delete',
      'preparation_configurator_records_no_update','preparation_configurator_records_no_delete'].includes(object.name)
    &&!v44Tables.has(object.name)).map(object=>
    object.name==='coordinator_pulses'&&object.sql!==null
      ?{...object,sql:object.sql.replace(/,'actorInitiative'/g,'').replace(/,\s*parked_for_pulse_id TEXT\s+REFERENCES "?coordinator_pulses"?\(pulse_id\) ON DELETE RESTRICT/,'')}
      :object);
  assert.ok(!historicalSchema.find(object=>object.name==='coordinator_pulses')?.sql?.includes('parked_for_pulse_id'));
  const before=inventory(f.bundleRoot);const result=await validateExternalBackup(f.request(undefined,historicalSchema));assert.equal(result.journalVersion,39);assert.equal(result.sources.length,1);assert.deepEqual(inventory(f.bundleRoot),before);
 }finally{await f.close();}
});
