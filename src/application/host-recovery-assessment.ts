import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { BackupManifestSchema } from '../domain/backup.ts';
import { exchangeIntegrity } from '../adapters/exchange-integrity.ts';

const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const scalar = z.union([z.string(), z.number().finite(), z.null()]);
const rowSchema = z.record(z.string(), scalar);
const adminNames = ['backup_jobs', 'backup_restore_previews', 'exchange_http_operations'] as const;
const adminNameSchema = z.enum(adminNames);
const administrativeKinds = new Set(['backup-create', 'restore-preview', 'restore']);
const authPaths = new Set(['pi/auth/auth.json', 'pi/auth/access-fingerprint.salt']);
const administrativeColumns: Record<typeof adminNames[number], readonly string[]> = {
  backup_jobs: ['backup_id', 'request_hash', 'job_json', 'integrity_hash'],
  backup_restore_previews: ['token', 'preview_json', 'target_fingerprint', 'used', 'result_json', 'integrity_hash'],
  exchange_http_operations: ['principal_id', 'operation_id', 'request_hash', 'response_json', 'integrity_hash', 'operation_kind'],
};
// These two tables are host-owned setup receipts, not narrative journal state.
// Recovery accepts only the exact DDL used by run-memory-preparation.ts; a
// familiar prefix alone must never turn arbitrary tables into trusted state.
const memoryPreparationSchema = [
  { type: 'index', name: 'memory_preparation_jobs_scope', tbl_name: 'memory_preparation_jobs', sql: 'CREATE INDEX memory_preparation_jobs_scope ON memory_preparation_jobs(principal_id,run_id,created_at DESC,job_id DESC)' },
  { type: 'index', name: 'sqlite_autoindex_memory_preparation_jobs_1', tbl_name: 'memory_preparation_jobs', sql: null },
  { type: 'index', name: 'sqlite_autoindex_memory_preparation_receipts_1', tbl_name: 'memory_preparation_receipts', sql: null },
  { type: 'table', name: 'memory_preparation_jobs', tbl_name: 'memory_preparation_jobs', sql: `CREATE TABLE memory_preparation_jobs(
    job_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    state TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision>=0),
    created_at INTEGER NOT NULL CHECK(created_at>=0),
    updated_at INTEGER NOT NULL CHECK(updated_at>=0),
    data_json TEXT NOT NULL,
    data_hash TEXT NOT NULL
  )` },
  { type: 'table', name: 'memory_preparation_receipts', tbl_name: 'memory_preparation_receipts', sql: `CREATE TABLE memory_preparation_receipts(
    principal_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    job_id TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    receipt_hash TEXT NOT NULL,
    PRIMARY KEY(principal_id,idempotency_key),
    FOREIGN KEY(job_id) REFERENCES memory_preparation_jobs(job_id) ON DELETE RESTRICT
  )` },
] as const;
// Current journal/exchange/voice tables. Unknown additions require a conscious
// recovery contract rather than silently becoming ignored operational state.
const worldTables = new Set(`act_scenes actor_activation_causes actor_activation_invitation_jobs actor_activation_invitations actor_job_checkpoints actor_job_request_leases actor_knowledge actor_pi_candidates actor_pi_consumptions actor_pi_sessions actor_pi_turn_receipts actor_state_cut_batches actor_state_cuts actor_terminal_proposals actor_turn_intents actor_turn_job_inputs actor_turn_jobs actor_turn_reconciliations acts administrative_checkpoint_integrity administrative_checkpoints administrative_jobs administrative_request_leases administrative_sessions backup_host_identity backup_jobs backup_restore_previews circumstance_operations continuista_candidates continuista_checkpoints continuista_jobs continuista_receipts continuista_request_leases continuista_sessions coordinator_pulses direction_events direction_operations director_annotations director_candidates episode_scenes episodes exchange_dossier_adaptations exchange_dossier_exports exchange_dossier_imports exchange_dossier_previews exchange_http_operations experiences fork_backup_sources fork_dramatic_seeds fork_job_history fork_job_retries fork_jobs fork_projection_receipts human_intervention_receipts legacy_narration_publications memory_outbox memory_receipts memory_preparation_jobs memory_preparation_receipts model_time_run_state model_time_spans narration_candidates narration_receipts narration_review_candidates narration_review_receipts pi_access_job_history pi_access_job_operations pi_access_job_results pi_access_jobs pi_oauth_job_history pi_oauth_job_operations pi_oauth_jobs pulses request_reservations routine_clock_advances run_budgets run_configuration_draft_history run_configuration_drafts run_configuration_revisions run_control_operations run_draft_operations run_draft_validation_reports run_preflight_job_history run_preflight_job_operations run_preflight_job_results run_preflight_jobs run_step_jobs schema_version sqlite_sequence structure_events structure_operations voice_config_receipts voice_config_versions voice_entities voice_operations voice_receipts voice_reservations voice_schema_version voice_staged_media world_commits world_deliveries world_events world_perception_experiences world_perceptions world_prepared_contexts world_proposals world_resolutions world_reviews world_runs identity_promotion_receipts actor_job_identity_bindings actor_pi_session_archives actor_identity_session_bindings actor_identity_epochs configurator_consents configurator_operations configurator_candidates configurator_checkpoints configurator_sessions configurator_generations configurator_jobs configurator_http_operations`.split(' '));
const memoryTables = new Set(`code_areas concept_links concepts facts feedback hook_events icm_metadata memoirs memories messages pending_consolidations pending_extractions sessions sqlite_sequence vec_memories vec_memories_chunks vec_memories_info vec_memories_rowids vec_memories_vector_chunks00`.split(' '));
for (const prefix of ['concepts', 'feedback', 'memories', 'messages']) for (const suffix of ['', '_config', '_data', '_docsize', '_idx']) memoryTables.add(`${prefix}_fts${suffix}`);
const fileSchema = z.strictObject({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative() });
const tableSchema = z.strictObject({ name: adminNameSchema, columns: z.array(z.string()), rows: z.array(rowSchema) });
export const HostRecoveryPreservePlanSchema = z.strictObject({
  kind: z.literal('host-recovery-preserve-plan'), sourceRoot: z.string().min(1),
  tables: z.array(tableSchema), files: z.array(fileSchema), directories: z.array(z.string()),
});
export type HostRecoveryPreservePlan = z.infer<typeof HostRecoveryPreservePlanSchema>;
export type HostRecoveryAssessment =
  | { kind: 'compatible'; fingerprint: string; currentFingerprint: string; bundleFingerprint: string; preserve: HostRecoveryPreservePlan }
  | { kind: 'blocked'; code: string; details: string[]; fingerprint: string };

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}
function quote(name: string) { return `"${name.replaceAll('"', '""')}"`; }
function fail(code: string): never { throw new Error(code); }
function canonicalRoot(root: string) {
  if (!isAbsolute(root) || realpathSync(root) !== root || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) fail('RECOVERY_ROOT_INVALID');
}
function safeRelative(path: string) {
  if (isAbsolute(path) || path.split('/').some(part => part === '..' || part === '.' || part === '') || path.includes('\\')) fail('RECOVERY_PATH_INVALID');
  return path;
}
function privateBytes(root: string, path: string): Buffer {
  const absolute = join(root, safeRelative(path));
  for (let parent = dirname(absolute); parent !== root; parent = dirname(parent)) {
    const status = lstatSync(parent);
    if (!status.isDirectory() || status.isSymbolicLink() || realpathSync(parent) !== parent) fail('RECOVERY_PATH_INVALID');
  }
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const status = fstatSync(fd);
    if (!status.isFile() || status.nlink !== 1 || status.size > 256 * 1024 * 1024 || (typeof process.getuid === 'function' && status.uid !== process.getuid())) fail('RECOVERY_FILE_INVALID');
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
function inventory(root: string) {
  const files = new Map<string, Buffer>(); const directories: string[] = []; let totalBytes = 0;
  function visit(parent: string) {
    for (const name of readdirSync(parent).sort()) {
      const path = join(parent, name); const key = relative(root, path); const status = lstatSync(path);
      if (status.isSymbolicLink()) fail('RECOVERY_PATH_INVALID');
      if (status.isDirectory()) { directories.push(key); visit(path); }
      else {
        const content = privateBytes(root, key); totalBytes += content.length;
        if (totalBytes > 1024 * 1024 * 1024) fail('RECOVERY_INVENTORY_LIMIT');
        files.set(key, content);
      }
      if (files.size + directories.length > 100_000) fail('RECOVERY_INVENTORY_LIMIT');
    }
  }
  visit(root); return { files, directories };
}
function sqlValue(value: unknown): unknown {
  if (typeof value === 'bigint') return { integer: value.toString() };
  if (value instanceof Uint8Array) return { blob: Buffer.from(value).toString('hex') };
  if (value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value;
  return fail('RECOVERY_SQL_VALUE_INVALID');
}
type SqlFingerprint = { fingerprint: string; tables: HostRecoveryPreservePlan['tables']; registeredBackups: Map<string, string | null>; lineageId: string | null };
function sqliteFingerprint(files: Map<string, Buffer>, path: string, world: boolean): SqlFingerprint {
  const bytes = files.get(path); if (bytes === undefined) fail('RECOVERY_SQLITE_MISSING');
  if (files.has(path + '-journal')) fail('RECOVERY_ROLLBACK_JOURNAL_UNSUPPORTED');
  const temporary = mkdtempSync(join(tmpdir(), 'personajes-recovery-assessment-')); let db: DatabaseSync | undefined;
  try {
    const target = join(temporary, 'copy.sqlite'); writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
    const wal = files.get(path + '-wal'); if (wal !== undefined) writeFileSync(target + '-wal', wal, { flag: 'wx', mode: 0o600 });
    db = new DatabaseSync(target, { readOnly: true });
    if (db.prepare('PRAGMA quick_check').all().some(row => row.quick_check !== 'ok')) fail('RECOVERY_SQLITE_INVALID');
    const schema = z.array(z.strictObject({ type: z.string(), name: z.string(), tbl_name: z.string(), sql: z.string().nullable() }))
      .parse(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all());
    const memoryPreparationObjects = schema.filter(entry => entry.name.startsWith('memory_preparation_')
      || entry.tbl_name.startsWith('memory_preparation_'));
    if (memoryPreparationObjects.length > 0 && canonical(memoryPreparationObjects) !== canonical(memoryPreparationSchema)) {
      fail('RECOVERY_MEMORY_PREPARATION_SCHEMA_INVALID');
    }
    const known = world ? worldTables : memoryTables;
    const tables: HostRecoveryPreservePlan['tables'] = []; const registeredBackups = new Map<string, string | null>(); const values: unknown[] = [];
    for (const table of schema.filter(entry => entry.type === 'table')) {
      if (!known.has(table.name)) fail('RECOVERY_UNKNOWN_TABLE');
      const administrative = world && adminNameSchema.safeParse(table.name).success;
      // vec0 is supplied by the pinned ICM binary; its complete backing tables,
      // schema and metadata are compared without loading a native extension.
      if (table.sql?.startsWith('CREATE VIRTUAL TABLE')) continue;
      const statement = db.prepare(`SELECT * FROM ${quote(table.name)}`); statement.setReadBigInts(true);
      const rows = statement.all(); if (rows.length > 1_000_000) fail('RECOVERY_SQL_ROW_LIMIT');
      if (administrative) {
        const name = adminNameSchema.parse(table.name);
        const columns = z.array(z.object({ name: z.string() })).parse(db.prepare(`PRAGMA table_info(${quote(name)})`).all()).map(row => row.name);
        const expected = administrativeColumns[name];
        const legacy = name === 'exchange_http_operations' && !columns.includes('operation_kind');
        if (canonical([...columns].sort()) !== canonical(expected.filter(column => !(legacy && column === 'operation_kind')).slice().sort())) fail('RECOVERY_ADMIN_SCHEMA_INVALID');
        const integrity = exchangeIntegrity(db);
        const preserved: z.infer<typeof rowSchema>[] = []; const operational: unknown[] = [];
        // Re-read numeric admin fields normally; they fit their sealed public schema.
        for (const raw of db.prepare(`SELECT * FROM ${quote(name)}`).all()) {
          const row = rowSchema.parse(raw);
          const where = name === 'backup_jobs' ? 'backup_id=?' : name === 'backup_restore_previews' ? 'token=?' : 'principal_id=? AND operation_id=?';
          const keys = name === 'backup_jobs' ? [z.string().parse(row.backup_id)] : name === 'backup_restore_previews' ? [z.string().parse(row.token)] : [z.string().parse(row.principal_id), z.string().parse(row.operation_id)];
          integrity.verify(name, where, keys);
          if (name === 'backup_jobs') {
            const job = z.object({ manifestHash: z.string().nullable() }).parse(JSON.parse(z.string().parse(row.job_json)));
            registeredBackups.set(z.string().uuid().parse(row.backup_id), job.manifestHash);
          }
          if (name !== 'exchange_http_operations' || (typeof row.operation_kind === 'string' && administrativeKinds.has(row.operation_kind))) preserved.push(row);
          else operational.push(row);
        }
        tables.push({ name, columns, rows: preserved });
        if (name === 'exchange_http_operations') values.push({ table: name, rows: operational.map(canonical).sort() });
      } else {
        values.push({ table: table.name, rows: rows.map(row => canonical(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sqlValue(value)])))).sort() });
      }
    }
    const operationalSchema = schema.filter(entry => !(world && adminNameSchema.safeParse(entry.tbl_name).success));
    const lineageId = world ? z.strictObject({ lineage_id: z.string().uuid() }).parse(db.prepare('SELECT lineage_id FROM backup_host_identity').get()).lineage_id : null;
    return { fingerprint: digest(canonical({ schema: operationalSchema, values })), tables, registeredBackups, lineageId };
  } finally { try { db?.close(); } finally { rmSync(temporary, { recursive: true, force: true }); } }
}

/** Caller supplies an authenticated bundle and holds the host write/drain fence.
 * Every SQLite handle belongs to a disposable copy, never to live or bundle files. */
export function assessHostRecovery(input: { privateDataRoot: string; bundleRoot: string; manifest: unknown; manifestHash: string }): HostRecoveryAssessment {
  try {
    canonicalRoot(input.privateDataRoot); canonicalRoot(input.bundleRoot); const manifest = BackupManifestSchema.parse(input.manifest);
    if (manifest.originRootHash !== digest(input.privateDataRoot)) fail('RECOVERY_ORIGIN_ROOT_MISMATCH');
    const current = inventory(input.privateDataRoot); const bundle = inventory(input.bundleRoot);
    const manifestBytes = bundle.files.get('manifest.json');
    if (manifestBytes === undefined || digest(manifestBytes) !== input.manifestHash || canonical(JSON.parse(manifestBytes.toString('utf8'))) !== canonical(manifest)) fail('RECOVERY_MANIFEST_INVALID');
    const expected = new Set(['manifest.json', ...manifest.files.map(file => file.path)]);
    for (const path of bundle.files.keys()) if (!expected.has(path)) fail('RECOVERY_UNKNOWN_BUNDLE_FILE');
    for (const file of manifest.files) { const bytes = bundle.files.get(file.path); if (bytes === undefined || bytes.length !== file.bytes || digest(bytes) !== file.sha256) fail('RECOVERY_BUNDLE_HASH_INVALID'); }
    const currentWorld = sqliteFingerprint(current.files, 'world.sqlite', true); const bundleWorld = sqliteFingerprint(bundle.files, 'world.sqlite', true);
    if (currentWorld.lineageId !== manifest.lineageId || bundleWorld.lineageId !== manifest.lineageId) fail('RECOVERY_LINEAGE_MISMATCH');
    const preserveFiles = new Set<string>();
    const backupManifests = new Map<string, z.infer<typeof BackupManifestSchema>>();
    for (const path of current.files.keys()) {
      if (path.startsWith('backups/')) {
        const parts = path.split('/'); const id = parts[1]; if (id === undefined || !currentWorld.registeredBackups.has(id)) fail('RECOVERY_UNKNOWN_BACKUP_STORAGE');
        let stored = backupManifests.get(id);
        if (stored === undefined) {
          const bytes = current.files.get(`backups/${id}/manifest.json`); if (bytes === undefined) fail('RECOVERY_BACKUP_MANIFEST_MISSING');
          stored = BackupManifestSchema.parse(JSON.parse(bytes.toString('utf8')));
          if (stored.backupId !== id || digest(bytes) !== currentWorld.registeredBackups.get(id)) fail('RECOVERY_BACKUP_MANIFEST_INVALID');
          for (const file of stored.files) {
            const content = current.files.get(`backups/${id}/${file.path}`);
            if (content === undefined || content.length !== file.bytes || digest(content) !== file.sha256) fail('RECOVERY_BACKUP_FILE_INVALID');
          }
          backupManifests.set(id, stored);
        }
        const inside = parts.slice(2).join('/'); if (inside !== 'manifest.json' && !stored.files.some(file => file.path === inside)) fail('RECOVERY_UNKNOWN_BACKUP_FILE');
        preserveFiles.add(path); continue;
      }
      if (authPaths.has(path)) { preserveFiles.add(path); continue; }
      if (path === 'host-ownership.json' || path === 'host-ownership.operation') continue;
      const base = path.replace(/-(?:wal|shm|journal)$/, '');
      if (!expected.has(path) && !(base.endsWith('.sqlite') && expected.has(base))) fail('RECOVERY_UNKNOWN_CURRENT_FILE');
    }
    const workspaces = current.directories.filter(path => /^(?:runs\/[a-f0-9-]{36}\/(?:actors\/[a-z0-9-]{1,80}|roles\/[a-z0-9-]+)\/(?:cwd|pi-agent|home|tmp)|restore-readers)$/.test(path));
    for (const directory of current.directories) {
      if (directory === 'backups' || directory === 'pi' || directory === 'pi/auth' || directory === 'media') continue;
      if (directory.startsWith('backups/')) {
        if (![...preserveFiles].some(path => path.startsWith(directory + '/'))) fail('RECOVERY_UNKNOWN_BACKUP_STORAGE');
        continue;
      }
      const knownPrefix = [...expected].some(path => path.startsWith(directory + '/'));
      const workspace = workspaces.some(path => path === directory || path.startsWith(directory + '/'));
      if (!knownPrefix && !workspace) fail('RECOVERY_UNKNOWN_DIRECTORY');
    }
    const currentValues: unknown[] = [{ path: 'world.sqlite', hash: currentWorld.fingerprint }];
    const bundleValues: unknown[] = [{ path: 'world.sqlite', hash: bundleWorld.fingerprint }];
    for (const file of manifest.files.filter(file => file.path !== 'world.sqlite' && !/-(?:wal|shm|journal)$/.test(file.path)).sort((a, b) => a.path < b.path ? -1 : 1)) {
      if (file.path.endsWith('.sqlite')) {
        currentValues.push({ path: file.path, hash: sqliteFingerprint(current.files, file.path, false).fingerprint });
        bundleValues.push({ path: file.path, hash: sqliteFingerprint(bundle.files, file.path, false).fingerprint });
      } else {
        const bytes = current.files.get(file.path); if (bytes === undefined) fail('RECOVERY_CURRENT_FILE_MISSING');
        currentValues.push({ path: file.path, hash: digest(bytes) }); bundleValues.push({ path: file.path, hash: file.sha256 });
      }
    }
    const currentFingerprint = digest(canonical(currentValues)); const bundleFingerprint = digest(canonical(bundleValues));
    if (currentFingerprint !== bundleFingerprint) return { kind: 'blocked', code: 'RECOVERY_STATE_DIVERGED', details: ['El estado durable actual difiere del backup; no se permite retrocederlo.'], fingerprint: currentFingerprint };
    const preserve = HostRecoveryPreservePlanSchema.parse({ kind: 'host-recovery-preserve-plan', sourceRoot: input.privateDataRoot, tables: currentWorld.tables,
      files: [...preserveFiles].sort().map(path => { const bytes = current.files.get(path); if (bytes === undefined) fail('RECOVERY_FILE_INVALID'); return { path, sha256: digest(bytes), bytes: bytes.length }; }),
      directories: current.directories.filter(path => path === 'backups' || path.startsWith('backups/') || /\/(?:cwd|pi-agent|home|tmp)$/.test(path) || path === 'pi/auth' || path === 'media').sort(),
    });
    return { kind: 'compatible', fingerprint: currentFingerprint, currentFingerprint, bundleFingerprint, preserve };
  } catch (error: unknown) {
    const code = error instanceof Error && /^RECOVERY_[A-Z_]+$/.test(error.message) ? error.message : 'RECOVERY_ASSESSMENT_UNAVAILABLE';
    return { kind: 'blocked', code, details: ['No se pudo acreditar la igualdad completa del estado recuperable.'], fingerprint: digest(code) };
  }
}

/** Applies only the explicitly retained administrative/auth/backup inventory to
 * a private staging root. The original and the selected bundle remain untouched. */
export function applyHostRecoveryPreservation(input: { stageRoot: string; plan: HostRecoveryPreservePlan }): void {
  const plan = HostRecoveryPreservePlanSchema.parse(input.plan); canonicalRoot(plan.sourceRoot); canonicalRoot(input.stageRoot);
  if (input.stageRoot === plan.sourceRoot || input.stageRoot.startsWith(plan.sourceRoot + '/') || plan.sourceRoot.startsWith(input.stageRoot + '/')) fail('RECOVERY_STAGE_INVALID');
  function stageDirectory(path: string) {
    let current = input.stageRoot;
    for (const segment of safeRelative(path).split('/')) {
      current = join(current, segment);
      try { const status = lstatSync(current); if (!status.isDirectory() || status.isSymbolicLink() || realpathSync(current) !== current) fail('RECOVERY_STAGE_PATH_INVALID'); }
      catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        mkdirSync(current, { mode: 0o700 });
        const descriptor = openSync(dirname(current), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
      }
    }
  }
  for (const directory of plan.directories) stageDirectory(directory);
  for (const file of plan.files) {
    if (!(file.path.startsWith('backups/') || authPaths.has(file.path))) fail('RECOVERY_PRESERVE_PATH_INVALID');
    const bytes = privateBytes(plan.sourceRoot, file.path); if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) fail('RECOVERY_PRESERVE_SOURCE_CHANGED');
    const target = join(input.stageRoot, safeRelative(file.path)); stageDirectory(dirname(file.path));
    const descriptor = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  }
  privateBytes(input.stageRoot, 'world.sqlite');
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { lstatSync(join(input.stageRoot, `world.sqlite${suffix}`)); privateBytes(input.stageRoot, `world.sqlite${suffix}`); if (suffix === '-journal') fail('RECOVERY_ROLLBACK_JOURNAL_UNSUPPORTED'); }
    catch (error: unknown) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  }
  const db = new DatabaseSync(join(input.stageRoot, 'world.sqlite'));
  try {
    db.exec('BEGIN IMMEDIATE');
    for (const table of plan.tables) {
      const expected = administrativeColumns[table.name]; if (canonical([...table.columns].sort()) !== canonical(expected.filter(name => name !== 'operation_kind' || table.columns.includes(name)).slice().sort())) fail('RECOVERY_ADMIN_SCHEMA_INVALID');
      if (table.name === 'exchange_http_operations') {
        if (!table.columns.includes('operation_kind')) { if (table.rows.length !== 0) fail('RECOVERY_ADMIN_ROW_INVALID'); continue; }
        const columns = db.prepare('PRAGMA table_info(exchange_http_operations)').all().map(row => row.name);
        if (table.columns.includes('operation_kind') && !columns.includes('operation_kind')) db.exec("ALTER TABLE exchange_http_operations ADD COLUMN operation_kind TEXT NOT NULL DEFAULT 'unclassified'");
        db.exec("DELETE FROM exchange_http_operations WHERE operation_kind IN ('backup-create','restore-preview','restore')");
      } else db.exec(`DELETE FROM ${quote(table.name)}`);
      const insert = db.prepare(`INSERT INTO ${quote(table.name)}(${table.columns.map(quote).join(',')}) VALUES(${table.columns.map(() => '?').join(',')})`);
      for (const row of table.rows) {
        if (table.name === 'exchange_http_operations' && !(typeof row.operation_kind === 'string' && administrativeKinds.has(row.operation_kind))) fail('RECOVERY_ADMIN_ROW_INVALID');
        insert.run(...table.columns.map(column => scalar.parse(row[column])));
        const keys = table.name === 'backup_jobs' ? [z.string().parse(row.backup_id)] : table.name === 'backup_restore_previews' ? [z.string().parse(row.token)] : [z.string().parse(row.principal_id), z.string().parse(row.operation_id)];
        exchangeIntegrity(db).seal(table.name, table.name === 'backup_jobs' ? 'backup_id=?' : table.name === 'backup_restore_previews' ? 'token=?' : 'principal_id=? AND operation_id=?', keys);
      }
    }
    db.exec('COMMIT'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (error: unknown) { try { db.exec('ROLLBACK'); } catch { /* A failed BEGIN had no transaction. */ } throw error; }
  finally { db.close(); }
  const descriptor = openSync(join(input.stageRoot, 'world.sqlite'), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  for (const directory of [...new Set(plan.files.map(file => dirname(file.path)).concat(plan.directories))].sort((a, b) => b.length - a.length).concat('')) {
    const descriptor = openSync(join(input.stageRoot, directory), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  }
}
