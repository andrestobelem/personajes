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
import { createWorldDeliverySupervisor } from '../src/application/world-delivery-supervisor.ts';
import { ApprovedJournalSchemaSchema, validateExternalBackup } from '../src/application/external-backup-validation.ts';
import { BackupForkSourceSchema, ForkSourceDataSchema } from '../src/application/fork-source.ts';
import { BackupManifestSchema } from '../src/domain/backup.ts';
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
      request(output = join(directory, 'frozen')) { return { bundleRoot: bundle.bundleRoot, manifest, manifestHash, approvedJournalSchema, sourceOutputRoot: output }; },
      mutate(path: string, operation: (db: DatabaseSync) => void) {
        const file = join(bundle.bundleRoot, path); const db = new DatabaseSync(file); try { operation(db); } finally { db.close(); }
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

test('helper aislado valida journal real y escribe fuente congelada exacta sin tocar bundle ni crear sidecars', async () => {
  const f = await fixture();
  try {
    const before = inventory(f.bundleRoot); const result = await validateExternalBackup(f.request()); assert.equal(result.journalVersion, 41); assert.equal(result.sources.length, 1);
    const source = result.sources[0]; assert.ok(source); const bytes = readFileSync(source.path); assert.equal(hash(bytes), source.sha256); assert.equal(bytes.length, source.bytes);
    const data = ForkSourceDataSchema.parse(JSON.parse(bytes.toString('utf8'))); assert.equal(data.snapshot.runId, f.world.runId); assert.equal(data.snapshot.seq, f.world.seq);
    assert.ok(data.cuts.some(cut => cut.experiences.some(experience => experience.payloadHash === f.frozen.payloadHash)));
    assert.ok(BackupForkSourceSchema.safeParse({ kind: 'backup-fork-source', backup: { backupId: f.manifest.backupId, lineageId: f.manifest.lineageId, manifestHash: f.manifestHash,
      journalHash: f.manifest.files.find(file => file.path === 'world.sqlite')?.sha256 }, ...data }).success);
    assert.deepEqual(inventory(f.bundleRoot), before); assert.deepEqual(readdirSync(join(f.directory, 'frozen')), ['sources']);
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
  f.mutate('world.sqlite',db=>db.exec(`PRAGMA foreign_keys=OFF;BEGIN;CREATE TABLE saved_oauth AS SELECT * FROM pi_oauth_jobs;DROP TABLE pi_oauth_jobs;
CREATE TABLE pi_oauth_jobs(job_id TEXT PRIMARY KEY,provider TEXT NOT NULL CHECK(provider='openai-codex'),kind TEXT NOT NULL CHECK(kind IN('login','logout')),
        principal_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('queued','running','cancel-requested','succeeded','failed','canceled','interrupted')),
        revision INTEGER NOT NULL CHECK(revision>=0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,safe_code TEXT,
        owner_token TEXT,claim_token TEXT,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,
        CHECK((owner_token IS NULL)=(claim_token IS NULL)),CHECK(state NOT IN('running','cancel-requested') OR owner_token IS NOT NULL));INSERT INTO pi_oauth_jobs SELECT * FROM saved_oauth;DROP TABLE saved_oauth;
 CREATE UNIQUE INDEX pi_oauth_one_running ON pi_oauth_jobs(provider) WHERE state IN('running','cancel-requested');DELETE FROM schema_version WHERE version IN(40,41);COMMIT;`));
  f.declareVersion(39);const before=inventory(f.bundleRoot);const result=await validateExternalBackup(f.request());assert.equal(result.journalVersion,39);assert.equal(result.sources.length,1);assert.deepEqual(inventory(f.bundleRoot),before);
 }finally{await f.close();}
});
