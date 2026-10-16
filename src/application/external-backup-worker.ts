import { createHash } from 'node:crypto';
import { constants as fsConstants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { constants as sqlConstants, DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { openJournal } from '../adapters/journal.ts';
import { canonicalContinuistaValue, hashContinuistaValue } from '../domain/continuista-review.ts';
import { BackupManifestSchema } from '../domain/backup.ts';
import { BackupForkSourceSchema, ForkSourceDataSchema } from './fork-source.ts';
import { ApprovedJournalSchemaSchema, ExternalBackupValidationRequestSchema, ExternalBackupValidationResultSchema } from './external-backup-validation.ts';
import { auditIcmContextHistory } from './icm-context-history-audit.ts';
import { PreparationBudgetAuthoritySchema, PreparationConfiguratorOperationSchema } from '../domain/preparation-configurator-jobs.ts';

// Catalog produced by the project's pinned ICM 0.11.4 CLI with embeddings off:
// all 93 schema objects, including FTS triggers and vec0 backing tables. No
// extension from the imported bundle is loaded to validate this catalog.
const ICM_SCHEMA_HASH = 'bf83255215bce8864fb03f0c95c3ddc59b94be2898b35b66fd5b633d7ac14567';
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function reject(code: string): never { throw new Error(code); }
function quote(name: string) { return `"${name.replaceAll('"', '""')}"`; }
const requestPath = z.string().min(1).parse(process.argv[2]);
const request = ExternalBackupValidationRequestSchema.parse(JSON.parse(readFileSync(requestPath, 'utf8')));
const temporary = mkdtempSync(join(dirname(requestPath), 'copies-'));
const outputs: z.infer<typeof ExternalBackupValidationResultSchema>['sources'] = [];
let outputBytes = 0;

function safeFile(path: string) {
  const absolute = join(request.bundleRoot, path);
  for (let parent = dirname(absolute); parent !== request.bundleRoot; parent = dirname(parent)) {
    const status = lstatSync(parent);
    if (!status.isDirectory() || status.isSymbolicLink() || realpathSync(parent) !== parent) reject('EXTERNAL_BACKUP_PATH_INVALID');
  }
  const descriptor = openSync(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const status = fstatSync(descriptor);
    if (!status.isFile() || status.nlink !== 1 || status.size > 256 * 1024 * 1024 || (process.getuid !== undefined && status.uid !== process.getuid())) reject('EXTERNAL_BACKUP_FILE_INVALID');
    return { descriptor, status };
  } catch (error: unknown) { closeSync(descriptor); throw error; }
}
function copyFile(path: string, expected: { bytes: number; sha256: string }, target?: string) {
  const { descriptor, status } = safeFile(path); let destination: number | undefined;
  try {
    if (status.size !== expected.bytes || expected.bytes > 256 * 1024 * 1024) reject('EXTERNAL_BACKUP_FILE_SIZE_INVALID');
    if (target !== undefined) destination = openSync(target, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    const hash = createHash('sha256'); const buffer = Buffer.allocUnsafe(1024 * 1024); let total = 0;
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null); if (count === 0) break;
      total += count; if (total > expected.bytes) reject('EXTERNAL_BACKUP_FILE_SIZE_INVALID');
      hash.update(buffer.subarray(0, count));
      if (destination !== undefined) {
        let written = 0; while (written < count) { const amount = writeSync(destination, buffer, written, count - written); if (amount <= 0) reject('EXTERNAL_BACKUP_COPY_FAILED'); written += amount; }
      }
    }
    if (total !== expected.bytes || hash.digest('hex') !== expected.sha256) reject('EXTERNAL_BACKUP_FILE_HASH_INVALID');
    if (destination !== undefined) fsyncSync(destination);
  } finally { closeSync(descriptor); if (destination !== undefined) closeSync(destination); }
}
function readonly(path: string) {
  const db = new DatabaseSync(path, { readOnly: true, allowExtension: false, timeout: 1000, defensive: true });
  db.enableLoadExtension(false); db.enableDefensive(true);
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
  const allowed = new Set(['sqlite_master', 'sqlite_schema']);
  db.setAuthorizer((action, arg1, arg2, database, trigger) => {
    if (trigger !== null || (database !== null && database !== 'main')) return sqlConstants.SQLITE_DENY;
    if (action === sqlConstants.SQLITE_SELECT) return sqlConstants.SQLITE_OK;
    if (action === sqlConstants.SQLITE_READ && arg1 !== null && allowed.has(arg1)) return sqlConstants.SQLITE_OK;
    if (action === sqlConstants.SQLITE_FUNCTION && arg2 !== null && ['count', 'max'].includes(arg2)) return sqlConstants.SQLITE_OK;
    if (action === sqlConstants.SQLITE_PRAGMA && arg1 !== null && ['quick_check', 'table_xinfo', 'data_version', 'foreign_key_check'].includes(arg1)) return sqlConstants.SQLITE_OK;
    return sqlConstants.SQLITE_DENY;
  });
  return { db, allow: (names: string[]) => { for (const name of names) allowed.add(name); } };
}
function schema(db: DatabaseSync) { return ApprovedJournalSchemaSchema.parse(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()); }
const appendOnlyTables = new Set(['run_configuration_revisions', 'actor_identity_epochs', 'actor_identity_session_bindings', 'actor_pi_session_archives', 'actor_job_identity_bindings', 'identity_promotion_receipts', 'icm_context_packets', 'preparation_configurator_records', 'preparation_configurator_operations']);
function approvedJournalTrigger(object: {type:string;name:string;tbl_name:string}) {
  if (object.type !== 'trigger') return false;
  if (object.tbl_name === 'actor_initiatives' && object.name === 'actor_initiatives_source_immutable') return true;
  return appendOnlyTables.has(object.tbl_name)
    && (object.name === `${object.tbl_name}_no_update` || object.name === `${object.tbl_name}_no_delete`);
}

// Exact historical host DDL only; never execute uploaded schema statements.
const legacyOAuthTableSQL = "CREATE TABLE pi_oauth_jobs(job_id TEXT PRIMARY KEY,provider TEXT NOT NULL CHECK(provider='openai-codex'),kind TEXT NOT NULL CHECK(kind IN('login','logout')),\n        principal_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('queued','running','cancel-requested','succeeded','failed','canceled','interrupted')),\n        revision INTEGER NOT NULL CHECK(revision>=0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,safe_code TEXT,\n        owner_token TEXT,claim_token TEXT,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,\n        CHECK((owner_token IS NULL)=(claim_token IS NULL)),CHECK(state NOT IN('running','cancel-requested') OR owner_token IS NOT NULL))";
const legacyOAuthIndexSQL = "CREATE UNIQUE INDEX pi_oauth_one_running ON pi_oauth_jobs(provider) WHERE state IN('running','cancel-requested')";
function matchesLegacyOAuthSchema(object:z.infer<typeof ApprovedJournalSchemaSchema>[number],expected:z.infer<typeof ApprovedJournalSchemaSchema>[number]) {
 if(request.manifest.journalVersion!==39)return false;
 const sql=object.type==='table'&&object.name==='pi_oauth_jobs'?legacyOAuthTableSQL:object.type==='index'&&object.name==='pi_oauth_one_running'?legacyOAuthIndexSQL:undefined;
 return sql!==undefined&&object.sql===sql&&object.type===expected.type&&object.name===expected.name&&object.tbl_name===expected.tbl_name;
}
function matchesLegacyFictionalTimeSchema(object:z.infer<typeof ApprovedJournalSchemaSchema>[number],expected:z.infer<typeof ApprovedJournalSchemaSchema>[number]) {
  if (![39,40].includes(request.manifest.journalVersion) || object.type !== 'table' || expected.type !== 'table'
    || object.name !== expected.name || object.tbl_name !== expected.tbl_name
    || !['actor_activation_causes','actor_activation_invitations','routine_clock_advances'].includes(object.name)) return false;
  // Compare the entire known DDL after removing only the three obsolete sign restrictions.
  const normalize = (sql:string|null) => sql?.replace(/CHECK\((?:fictional_at>=0|boundary_at IS NULL OR boundary_at>=0|from_at>=0)\)/g,'').replace(/\s+/g,' ').trim();
  return normalize(object.sql) === normalize(expected.sql);
}
function matchesLegacyActivationInvitationJobsSchema(object:z.infer<typeof ApprovedJournalSchemaSchema>[number],expected:z.infer<typeof ApprovedJournalSchemaSchema>[number]) {
  if (![39,40,41].includes(request.manifest.journalVersion) || object.type!=='table' || expected.type!=='table'
    || object.name!=='actor_activation_invitation_jobs' || expected.name!==object.name || object.tbl_name!==expected.tbl_name) return false;
  const legacy=`CREATE TABLE actor_activation_invitation_jobs(
          run_id TEXT NOT NULL,invitation_id TEXT NOT NULL,actor_id TEXT NOT NULL,job_id TEXT NOT NULL,
          generation INTEGER NOT NULL CHECK(generation>=0),assigned_at INTEGER NOT NULL CHECK(assigned_at>=0),
          PRIMARY KEY(run_id,invitation_id),UNIQUE(run_id,actor_id,job_id,generation),
          FOREIGN KEY(run_id,invitation_id) REFERENCES actor_activation_invitations(run_id,invitation_id) ON DELETE RESTRICT,
          FOREIGN KEY(run_id,actor_id,job_id,generation) REFERENCES actor_turn_jobs(run_id,actor_id,job_id,generation) ON DELETE RESTRICT
        )`;
  const normalize=(sql:string|null)=>sql?.replace(/\s+/g,' ').replaceAll('"','').trim();
  return normalize(object.sql)===normalize(legacy);
}
function matchesLegacyCoordinatorPulsesSchema(object:z.infer<typeof ApprovedJournalSchemaSchema>[number],expected:z.infer<typeof ApprovedJournalSchemaSchema>[number]) {
  if (![39,40,41].includes(request.manifest.journalVersion) || object.type!=='table' || expected.type!=='table'
    || object.name!=='coordinator_pulses' || expected.name!==object.name || object.tbl_name!==expected.tbl_name) return false;
  const legacy=`CREATE TABLE coordinator_pulses(
          pulse_id TEXT PRIMARY KEY REFERENCES pulses(pulse_id) ON DELETE RESTRICT,
          run_id TEXT NOT NULL REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          origin_kind TEXT NOT NULL CHECK(origin_kind IN('humanIntervention','actorAttempt','directionCircumstance','actorActivation')),
          origin_id TEXT NOT NULL,commit_index INTEGER CHECK(commit_index IS NULL OR commit_index>=1),
          configuration_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('running','completed','blocked')),
          created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,lifecycle_revision INTEGER CHECK(lifecycle_revision IS NULL OR lifecycle_revision>=0),
          UNIQUE(run_id,origin_kind,origin_id),
          FOREIGN KEY(run_id,commit_index) REFERENCES world_commits(run_id,commit_index) ON DELETE RESTRICT,
          CHECK((origin_kind='actorActivation' AND commit_index IS NULL) OR (origin_kind<>'actorActivation' AND commit_index IS NOT NULL))
        )`;
  const normalize=(sql:string|null)=>sql?.replace(/\s+/g,' ').replaceAll('"','').trim();
  return normalize(object.sql)===normalize(legacy);
}
function matchesLegacyModelTimeRunStateSchema(object:z.infer<typeof ApprovedJournalSchemaSchema>[number],expected:z.infer<typeof ApprovedJournalSchemaSchema>[number]) {
  if (request.manifest.journalVersion >= 44 || object.type !== 'table' || expected.type !== 'table'
    || object.name !== 'model_time_run_state' || expected.name !== object.name || object.tbl_name !== expected.tbl_name) return false;
  const legacy=`CREATE TABLE model_time_run_state(
          run_id TEXT PRIMARY KEY REFERENCES world_runs(run_id) ON DELETE RESTRICT,
          unknown_legacy_requests INTEGER NOT NULL DEFAULT 0 CHECK(unknown_legacy_requests>=0)
        )`;
  const normalize=(sql:string|null)=>sql?.replace(/\s+/g,' ').replaceAll('"','').trim();
  return normalize(object.sql)===normalize(legacy);
}
function withoutActorInitiativeColumn(sql:string) {
  const afterColumn = sql.replace(/,\s*initiative_id\s+TEXT(?=\s*(?:,|\)))/i, '');
  if (afterColumn !== sql) return afterColumn;
  return sql.replace(/\binitiative_id\s+TEXT\s*,/i, '');
}
function withoutActorInitiativePulseKind(sql:string) {
  const withoutKind = sql.replace(/,\s*'actorInitiative'/g, '').replace(/,\s*\)/g, ')');
  return withoutKind;
}
function matchesLegacyActorInitiativeCoordinatorPulsesSchema(object:z.infer<typeof ApprovedJournalSchemaSchema>[number],expected:z.infer<typeof ApprovedJournalSchemaSchema>[number]) {
  if (request.manifest.journalVersion < 42 || request.manifest.journalVersion >= 45
    || object.type !== 'table' || expected.type !== 'table' || object.name !== 'coordinator_pulses'
    || expected.name !== object.name || object.tbl_name !== expected.tbl_name || expected.sql === null || object.sql === null) return false;
  const normalize=(sql:string)=>sql.replace(/\s+/g,' ').replaceAll('"','').trim();
  return normalize(object.sql)===normalize(withoutActorInitiativePulseKind(expected.sql))
    && normalize(withoutActorInitiativePulseKind(expected.sql))!==normalize(expected.sql);
}
function matchesLegacyActorTurnJobsSchema(object:z.infer<typeof ApprovedJournalSchemaSchema>[number],expected:z.infer<typeof ApprovedJournalSchemaSchema>[number]) {
  if (request.manifest.journalVersion >= 45 || object.type !== 'table' || expected.type !== 'table'
    || object.name !== 'actor_turn_jobs' || expected.name !== object.name || object.tbl_name !== expected.tbl_name
    || expected.sql === null || object.sql === null) return false;
  const normalize=(sql:string)=>sql.replace(/\s+/g,' ').replaceAll('"','').trim();
  return normalize(object.sql)===normalize(withoutActorInitiativeColumn(expected.sql))
    && normalize(withoutActorInitiativeColumn(expected.sql))!==normalize(expected.sql);
}
const introducedTableVersions: Readonly<Record<string, number>> = {
  icm_context_packets: 43,
  model_budget_authorities: 44,
  preparation_configurator_jobs: 44,
  preparation_configurator_operations: 44,
  preparation_configurator_records: 44,
  actor_initiatives: 45,
};
const introducedObjectVersions: Readonly<Record<string, number>> = {
  actor_turn_jobs_initiative: 45,
};
function introducedVersion(object: { name: string; tbl_name: string }): number | undefined {
  return introducedObjectVersions[object.name] ?? introducedTableVersions[object.tbl_name];
}
function ordinaryJournalCopy(sourcePath: string, cleanPath: string) {
  const source = readonly(sourcePath); let clean: DatabaseSync | undefined;
  try {
    const actual = schema(source.db); const approved = new Map(request.approvedJournalSchema.map(object => [`${object.type}:${object.name}`, object]));
    for (const object of actual) {
      const expected = approved.get(`${object.type}:${object.name}`);
      const legacyActorTurnJobs = object.type === 'table' && object.name === 'actor_turn_jobs'
        && request.manifest.journalVersion < 45;
      const legacyActorInitiativeCoordinatorPulses = object.type === 'table' && object.name === 'coordinator_pulses'
        && request.manifest.journalVersion >= 42 && request.manifest.journalVersion < 45;
      if (expected === undefined || (legacyActorTurnJobs
        ? !matchesLegacyActorTurnJobsSchema(object,expected)
        : legacyActorInitiativeCoordinatorPulses
        ? !matchesLegacyActorInitiativeCoordinatorPulsesSchema(object,expected)
        : JSON.stringify(object) !== JSON.stringify(expected)&&!matchesLegacyOAuthSchema(object,expected)
        &&!matchesLegacyFictionalTimeSchema(object,expected)&&!matchesLegacyActivationInvitationJobsSchema(object,expected)
        &&!matchesLegacyCoordinatorPulsesSchema(object,expected)&&!matchesLegacyModelTimeRunStateSchema(object,expected))) reject('EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID');
      if (object.type === 'view' || (object.type === 'trigger' && !approvedJournalTrigger(object)) || object.sql?.startsWith('CREATE VIRTUAL TABLE')) reject('EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID');
    }
    const names = new Set(actual.filter(object => object.type === 'table').map(object => object.name));
    source.allow([...names]);
    const version = z.strictObject({ version: z.union([z.literal(39),z.literal(40),z.literal(41),z.literal(42),z.literal(43),z.literal(44),z.literal(45)]) }).safeParse(source.db.prepare('SELECT MAX(version) version FROM schema_version').get());
    if (!version.success || request.manifest.journalVersion !== version.data.version) reject('EXTERNAL_BACKUP_JOURNAL_VERSION_UNSUPPORTED');
    // New journal objects are version-gated against the authenticated source.
    // A historical copy must neither omit objects already introduced at its
    // recorded version nor smuggle a later schema in early.
    for (const [table, introduced] of Object.entries(introducedTableVersions)) {
      const approvedObjects = request.approvedJournalSchema.filter(object => object.tbl_name === table);
      const actualObjects = actual.filter(object => object.tbl_name === table);
      if (version.data.version < introduced ? actualObjects.length !== 0
        : approvedObjects.length === 0 || approvedObjects.some(expected => !actual.some(object => object.type === expected.type && object.name === expected.name))) {
        reject('EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID');
      }
    }
    for (const [name, introduced] of Object.entries(introducedObjectVersions)) {
      const approvedObjects = request.approvedJournalSchema.filter(object => object.name === name);
      const actualObjects = actual.filter(object => object.name === name);
      if (version.data.version < introduced ? actualObjects.length !== 0
        : approvedObjects.length !== 1 || actualObjects.length !== 1) reject('EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID');
    }
    // Only explicitly approved journal triggers may survive the exact trusted
    // DDL check above. Their absence is also a schema mismatch; uploaded SQL is never run.
    for (const trigger of request.approvedJournalSchema.filter(object => object.type === 'trigger')) {
      const introduced = introducedVersion(trigger);
      const mayBeAbsentInLegacySchema = introduced !== undefined && version.data.version < introduced;
      if (!approvedJournalTrigger(trigger) || (!mayBeAbsentInLegacySchema && !actual.some(object => object.type === 'trigger' && object.name === trigger.name))) reject('EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID');
    }
    // Auxiliary voice/exchange/memory-preparation tables may be absent from a host that never
    // composed those services; their presence always requires an exact template.
    for (const approved of request.approvedJournalSchema.filter(object => object.type === 'table')) {
      const introduced = introducedTableVersions[approved.name];
      const mayBeAbsentInLegacySchema = introduced !== undefined && version.data.version < introduced;
      if (!names.has(approved.name) && !mayBeAbsentInLegacySchema && !/^(?:voice_|exchange_|memory_preparation_)/.test(approved.name)) reject('EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID');
    }
    for (const name of names) {
      const columns = z.array(z.object({ hidden: z.number() })).parse(source.db.prepare(`PRAGMA table_xinfo(${quote(name)})`).all());
      if (columns.some(column => column.hidden !== 0)) reject('EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID');
    }
    if (source.db.prepare('PRAGMA quick_check').all().some(row => row.quick_check !== 'ok')) reject('EXTERNAL_BACKUP_SQLITE_INVALID');
    // Build from trusted host DDL, not source sqlite_schema statements. All source
    // access remains read-only; migrations will see only host-created objects.
    clean = new DatabaseSync(cleanPath, { allowExtension: false, defensive: true });
    clean.exec('PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=OFF; PRAGMA page_size=4096; PRAGMA max_page_count=65536; BEGIN IMMEDIATE;');
    const createApprovedObject = (object: z.infer<typeof ApprovedJournalSchemaSchema>[number]) => {
      const introduced = introducedVersion(object);
      return introduced === undefined || version.data.version >= introduced;
    };
    for (const object of request.approvedJournalSchema.filter(object => object.type === 'table' && object.name !== 'sqlite_sequence' && createApprovedObject(object))) {
      if (object.sql === null || object.sql.startsWith('CREATE VIRTUAL TABLE')) reject('EXTERNAL_BACKUP_APPROVED_SCHEMA_INVALID');
      if (object.name === 'actor_turn_jobs' && version.data.version < 45) {
        const legacySql = withoutActorInitiativeColumn(object.sql);
        if (legacySql === object.sql) reject('EXTERNAL_BACKUP_APPROVED_SCHEMA_INVALID');
        clean.exec(legacySql);
      } else if (object.name === 'coordinator_pulses' && version.data.version >= 42 && version.data.version < 45) {
        const legacySql = withoutActorInitiativePulseKind(object.sql);
        if (legacySql === object.sql) reject('EXTERNAL_BACKUP_APPROVED_SCHEMA_INVALID');
        clean.exec(legacySql);
      } else clean.exec(object.sql);
    }
    for (const name of names) {
      const columns = z.array(z.object({ name: z.string() })).parse(source.db.prepare(`PRAGMA table_xinfo(${quote(name)})`).all()).map(column => column.name);
      const insert = clean.prepare(`INSERT INTO ${quote(name)}(${columns.map(quote).join(',')}) VALUES(${columns.map(() => '?').join(',')})`);
      if (name === 'sqlite_sequence') clean.exec('DELETE FROM sqlite_sequence');
      const statement = source.db.prepare(`SELECT * FROM ${quote(name)}`); statement.setReadBigInts(true);
      let count = 0;
      for (const row of statement.iterate()) {
        if (++count > 1_000_000) reject('EXTERNAL_BACKUP_ROW_LIMIT');
        insert.run(...columns.map(column => row[column] ?? null));
      }
    }
    for (const object of request.approvedJournalSchema.filter(object => object.type === 'index' && object.sql !== null && createApprovedObject(object))) if (object.sql !== null) clean.exec(object.sql);
    // Install host-supplied journal triggers after copying source rows.
    for (const trigger of request.approvedJournalSchema.filter(object => approvedJournalTrigger(object) && createApprovedObject(object))) {
      if (trigger.sql === null) reject('EXTERNAL_BACKUP_APPROVED_SCHEMA_INVALID');
      clean.exec(trigger.sql);
    }
    clean.exec('COMMIT');
  } finally { clean?.close(); source.db.close(); }
}
function validateMemory(path: string) {
  const source = readonly(path);
  try {
    const catalog = schema(source.db);
    if (digest(JSON.stringify(catalog)) !== ICM_SCHEMA_HASH) reject('EXTERNAL_BACKUP_ICM_SCHEMA_UNSUPPORTED');
    source.allow(catalog.filter(object => object.type === 'table').map(object => object.name));
    if (source.db.prepare('PRAGMA quick_check').all().some(row => row.quick_check !== 'ok')) reject('EXTERNAL_BACKUP_SQLITE_INVALID');
  } finally { source.db.close(); }
}
function auditPreparationConfiguratorData(database: DatabaseSync, journal: ReturnType<typeof openJournal>) {
  const authorityByRun = new Map<string, { kind: 'preparation' | 'ready'; value: z.infer<typeof PreparationBudgetAuthoritySchema> }>();
  const authorities = database.prepare('SELECT run_id,kind,payload_json,payload_hash FROM model_budget_authorities').all();
  for (const raw of authorities) {
    const row = z.strictObject({ run_id: z.string(), kind: z.enum(['preparation', 'ready']), payload_json: z.string(), payload_hash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(raw);
    const payload = PreparationBudgetAuthoritySchema.parse(JSON.parse(row.payload_json));
    if (canonicalContinuistaValue(payload) !== row.payload_json || hashContinuistaValue(payload) !== row.payload_hash || payload.runId !== row.run_id) reject('EXTERNAL_BACKUP_JOURNAL_DATA_INVALID');
    authorityByRun.set(row.run_id, { kind: row.kind, value: payload });
    const draftHistory = journal.readRunConfigurationDraftHistory({ runId: row.run_id });
    const matchingDraft = draftHistory.find(entry => entry.draft.revision === payload.draftRevision);
    if (matchingDraft === undefined || hashContinuistaValue(matchingDraft.draft) !== payload.draftHash) reject('EXTERNAL_BACKUP_JOURNAL_DATA_INVALID');
    if (row.kind === 'preparation') {
      if (database.prepare('SELECT 1 FROM world_runs WHERE run_id=?').get(row.run_id) !== undefined
        || matchingDraft.draft.budget.kind !== 'configured'
        || canonicalContinuistaValue(matchingDraft.draft.budget.value) !== canonicalContinuistaValue(payload.budget)
        || matchingDraft.draft.inferenceProfile?.kind !== 'configured'
        || canonicalContinuistaValue(matchingDraft.draft.inferenceProfile.value) !== canonicalContinuistaValue(payload.profile)) reject('EXTERNAL_BACKUP_JOURNAL_DATA_INVALID');
    } else if (database.prepare('SELECT 1 FROM world_runs WHERE run_id=?').get(row.run_id) === undefined) {
      reject('EXTERNAL_BACKUP_JOURNAL_DATA_INVALID');
    }
  }

  const jobs = database.prepare('SELECT job_id,principal_id,run_id FROM preparation_configurator_jobs').all();
  const jobById = new Map<string, ReturnType<typeof journal.readPreparationConfiguratorJob>>();
  for (const raw of jobs) {
    const row = z.strictObject({ job_id: z.string(), principal_id: z.string(), run_id: z.string() }).parse(raw);
    const stored = journal.readPreparationConfiguratorJob({ principalId: row.principal_id, jobId: row.job_id });
    if (stored.job.principalId !== row.principal_id || stored.job.scope.runId !== row.run_id
      || stored.context.request.runId !== row.run_id || stored.context.request.jobId !== row.job_id
      || stored.context.request.generation !== stored.job.scope.generation) reject('EXTERNAL_BACKUP_JOURNAL_DATA_INVALID');
    const matchingDraft = journal.readRunConfigurationDraftHistory({ runId: row.run_id })
      .find(entry => entry.draft.revision === stored.job.scope.draftRevision);
    if (matchingDraft === undefined || hashContinuistaValue(matchingDraft.draft) !== stored.job.scope.draftHash
      || canonicalContinuistaValue(matchingDraft.draft) !== canonicalContinuistaValue(stored.context.draft)) reject('EXTERNAL_BACKUP_JOURNAL_DATA_INVALID');
    if (stored.job.state === 'queued' || stored.job.state === 'running') {
      const authority = authorityByRun.get(row.run_id);
      if (authority?.kind !== 'preparation' || authority.value.draftRevision !== stored.job.scope.draftRevision
        || authority.value.draftHash !== stored.job.scope.draftHash
        || canonicalContinuistaValue(authority.value.budget) !== canonicalContinuistaValue(stored.context.budget)
        || canonicalContinuistaValue(authority.value.profile) !== canonicalContinuistaValue(stored.context.profile)) reject('EXTERNAL_BACKUP_JOURNAL_DATA_INVALID');
    }
    jobById.set(row.job_id, stored);
  }

  const operationCounts = new Map<string, { count: number; creates: number }>();
  const operations: z.infer<typeof PreparationConfiguratorOperationSchema>[] = [];
  for (const raw of database.prepare('SELECT principal_id,idempotency_key,operation_kind,request_json,request_hash,job_id,result_json,result_hash FROM preparation_configurator_operations').all()) {
    const row = z.strictObject({ principal_id: z.string().min(1), idempotency_key: z.uuid(), operation_kind: z.enum(['create', 'start', 'cancel', 'apply']),
      request_json: z.string(), request_hash: z.string().regex(/^[a-f0-9]{64}$/), job_id: z.string(), result_json: z.string(),
      result_hash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(raw);
    const operation = PreparationConfiguratorOperationSchema.parse({ operationKind: row.operation_kind,
      request: JSON.parse(row.request_json), result: JSON.parse(row.result_json) });
    const jobId = operation.operationKind === 'create' ? operation.request.request.jobId : operation.request.jobId;
    const stored = jobById.get(row.job_id);
    const resultJob = operation.operationKind === 'start' ? operation.result.job
      : operation.operationKind === 'apply' ? undefined : operation.result;
    if (stored === undefined || operation.request.principalId !== row.principal_id || operation.request.idempotencyKey !== row.idempotency_key
      || jobId !== row.job_id || stored.job.principalId !== row.principal_id
      || canonicalContinuistaValue(operation.request) !== row.request_json || hashContinuistaValue(operation.request) !== row.request_hash
      || canonicalContinuistaValue(operation.result) !== row.result_json
      || hashContinuistaValue({ principalId: row.principal_id, idempotencyKey: row.idempotency_key, operationKind: row.operation_kind,
        requestHash: row.request_hash, jobId: row.job_id, result: operation.result }) !== row.result_hash
      || (resultJob !== undefined && (resultJob.scope.jobId !== row.job_id || resultJob.principalId !== row.principal_id
        || canonicalContinuistaValue(resultJob.scope) !== canonicalContinuistaValue(stored.job.scope)))
      || (operation.operationKind === 'create' && (canonicalContinuistaValue(operation.request.request) !== canonicalContinuistaValue(stored.context.request)
        || operation.result.revision !== 0 || operation.result.state !== 'queued'))
      || (operation.operationKind === 'start' && (operation.result.kind !== 'started' || operation.result.job.state !== 'queued'))
      || (operation.operationKind === 'apply' && (operation.result.jobId !== row.job_id || operation.result.runId !== stored.job.scope.runId
        || operation.result.candidateId !== operation.request.candidateId || operation.result.proposalHash !== operation.request.proposalHash
        || operation.result.baseDraftRevision !== operation.request.expectedDraftRevision || operation.result.baseDraftHash !== operation.request.expectedDraftHash
        || operation.result.baseDraftRevision !== stored.job.scope.draftRevision || operation.result.baseDraftHash !== stored.job.scope.draftHash
        || operation.result.draftRevision <= operation.result.baseDraftRevision
        || operation.result.selectionHash !== hashContinuistaValue(operation.request.selection)))) reject('EXTERNAL_BACKUP_JOURNAL_DATA_INVALID');
    const counts = operationCounts.get(row.job_id) ?? { count: 0, creates: 0 };
    counts.count++; if (operation.operationKind === 'create') counts.creates++;
    operationCounts.set(row.job_id, counts); operations.push(operation);
  }
  for (const [jobId] of jobById) {
    const counts = operationCounts.get(jobId);
    if (counts === undefined || counts.creates !== 1) reject('EXTERNAL_BACKUP_JOURNAL_DATA_INVALID');
  }

  const recordsByKey = new Map<string, ReturnType<typeof journal.readPreparationConfiguratorRecord>>();
  for (const raw of database.prepare('SELECT job_id,generation,kind,request_seq FROM preparation_configurator_records').all()) {
    const row = z.strictObject({ job_id: z.string(), generation: z.number().int().nonnegative(), kind: z.enum(['session', 'job-base', 'request-input', 'terminal-candidate', 'candidate', 'accepted-proof']), request_seq: z.number().int().min(-1) }).parse(raw);
    if (!jobById.has(row.job_id)) reject('EXTERNAL_BACKUP_JOURNAL_DATA_INVALID');
    const record = journal.readPreparationConfiguratorRecord({ jobId: row.job_id, generation: row.generation, kind: row.kind, requestSeq: row.request_seq });
    if (record === undefined) reject('EXTERNAL_BACKUP_JOURNAL_DATA_INVALID');
    recordsByKey.set(`${row.job_id}:${row.generation}:${row.kind}:${row.request_seq}`, record);
  }
  for (const operation of operations) if (operation.operationKind === 'apply') {
    const stored = jobById.get(operation.request.jobId)!;
    const { jobId, generation } = stored.job.scope;
    const candidate = recordsByKey.get(`${jobId}:${generation}:candidate:-1`);
    const proof = recordsByKey.get(`${jobId}:${generation}:accepted-proof:-1`);
    const receipt = operation.result;
    const targetDraft = journal.readRunConfigurationDraftHistory({ runId: receipt.runId })
      .find(entry => entry.draft.revision === receipt.draftRevision);
    if (stored.job.state !== 'accepted' || operation.request.expectedRevision !== stored.job.revision
      || operation.request.expectedDraftRevision !== stored.job.scope.draftRevision || operation.request.expectedDraftHash !== stored.job.scope.draftHash
      || candidate?.kind !== 'candidate' || proof?.kind !== 'accepted-proof' || candidate.value.candidateId !== receipt.candidateId
      || hashContinuistaValue(candidate.value.proposal) !== receipt.proposalHash || proof.value.candidateHash !== candidate.value.candidateHash
      || targetDraft === undefined || hashContinuistaValue(targetDraft.draft) !== receipt.draftHash) reject('EXTERNAL_BACKUP_JOURNAL_DATA_INVALID');
  }
}
function validate() {
  const heap = new DatabaseSync(':memory:', { allowExtension: false }); heap.exec('PRAGMA hard_heap_limit=268435456'); heap.close();
  const { descriptor, status } = safeFile('manifest.json'); let manifestBytes: Buffer;
  try { if (status.size > 64 * 1024 * 1024) reject('EXTERNAL_BACKUP_MANIFEST_LIMIT'); manifestBytes = readFileSync(descriptor); } finally { closeSync(descriptor); }
  if (digest(manifestBytes) !== request.manifestHash || canonicalContinuistaValue(BackupManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')))) !== canonicalContinuistaValue(request.manifest)) reject('EXTERNAL_BACKUP_MANIFEST_INVALID');
  const expected = new Set(['manifest.json', ...request.manifest.files.map(file => file.path)]);
  function inventory(path: string) {
    for (const name of readdirSync(path)) {
      const absolute = join(path, name); const status = lstatSync(absolute);
      if (status.isSymbolicLink()) reject('EXTERNAL_BACKUP_PATH_INVALID');
      if (status.isDirectory()) inventory(absolute);
      else if (!expected.has(relative(request.bundleRoot, absolute))) reject('EXTERNAL_BACKUP_UNKNOWN_FILE');
    }
  }
  inventory(request.bundleRoot);
  if (![39,40,41,42,43,44,45].includes(request.manifest.journalVersion)) reject('EXTERNAL_BACKUP_JOURNAL_VERSION_UNSUPPORTED');
  const copies = new Map<string, string>(); let index = 0;
  for (const file of request.manifest.files) {
    const sqlite = file.path.endsWith('.sqlite'); const target = sqlite ? join(temporary, `input-${index++}.sqlite`) : undefined;
    copyFile(file.path, file, target); if (target !== undefined) copies.set(file.path, target);
  }
  for (const [path, copy] of copies) {
    const wal = request.manifest.files.find(file => file.path === path + '-wal'); if (wal !== undefined) copyFile(wal.path, wal, copy + '-wal');
    if (path !== 'world.sqlite') {
      try { validateMemory(copy); }
      finally { for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(copy + suffix, { force: true }); }
    }
  }
  const journal = copies.get('world.sqlite'); if (journal === undefined) reject('EXTERNAL_BACKUP_JOURNAL_MISSING');
  const clean = join(temporary, 'host-journal.sqlite'); ordinaryJournalCopy(journal, clean);
  const hostJournal = openJournal({ path: clean });
  try {
    const history = new DatabaseSync(clean, { readOnly: true, allowExtension: false, defensive: true });
    try {
      try { auditIcmContextHistory({ database: history, readSource: source => hostJournal.readForkSource(source) }); }
      catch { reject('EXTERNAL_BACKUP_ICM_CONTEXT_INVALID'); }
      if (history.prepare('PRAGMA foreign_key_check').all().length !== 0) reject('EXTERNAL_BACKUP_JOURNAL_DATA_INVALID');
      if (request.manifest.journalVersion >= 44) {
        try { auditPreparationConfiguratorData(history, hostJournal); }
        catch { reject('EXTERNAL_BACKUP_JOURNAL_DATA_INVALID'); }
      }
    } finally { history.close(); }
    const output = join(request.sourceOutputRoot, 'sources'); mkdirSync(output, { mode: 0o700 });
    const journalHash = request.manifest.files.find(file => file.path === 'world.sqlite')?.sha256; if (journalHash === undefined) reject('EXTERNAL_BACKUP_JOURNAL_MISSING');
    for (const fence of request.manifest.fences) {
      const found = hostJournal.readForkSource({ runId: fence.runId, commitIndex: fence.commitIndex, worldRevision: fence.worldRevision, worldSeq: fence.lastSeq });
      if (found.kind !== 'found' || hashContinuistaValue(found.snapshot) !== fence.snapshotHash) reject('EXTERNAL_BACKUP_SOURCE_UNAVAILABLE');
      const { kind, ...data } = found; void kind;
      const validated = BackupForkSourceSchema.parse({ kind: 'backup-fork-source', backup: { backupId: request.manifest.backupId, lineageId: request.manifest.lineageId, manifestHash: request.manifestHash, journalHash }, ...data });
      const { kind: validatedKind, backup: validatedBackup, ...validatedData } = validated; void validatedKind; void validatedBackup;
      const frozen = ForkSourceDataSchema.parse(validatedData); const bytes = Buffer.from(canonicalContinuistaValue(frozen));
      if (bytes.length > request.limits.maxSourceBytes) reject('EXTERNAL_BACKUP_SOURCE_LIMIT');
      outputBytes += bytes.length;
      if (outputBytes > request.limits.maxTotalSourceBytes) reject('EXTERNAL_BACKUP_TOTAL_SOURCE_LIMIT');
      const path = join(output, `${fence.runId}.json`);
      const descriptor = openSync(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
      try { writeFileSync(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
      outputs.push({ runId: fence.runId, path, bytes: bytes.length, sha256: digest(bytes) });
    }
    for (const path of [output, request.sourceOutputRoot]) {
      const descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
      try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    }
  } finally { hostJournal.close(); }
  const result = ExternalBackupValidationResultSchema.parse({ journalVersion: request.manifest.journalVersion, sources: outputs });
  const bytes = Buffer.from(JSON.stringify(result)); if (bytes.length > 64 * 1024 * 1024) reject('EXTERNAL_BACKUP_RESULT_LIMIT');
  writeFileSync(join(dirname(requestPath), 'result.json'), bytes, { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ kind: 'validated', resultHash: digest(bytes) }));
}
try { validate(); }
catch (error: unknown) {
  const code = error instanceof Error && /^EXTERNAL_BACKUP_[A-Z_]+$/.test(error.message) ? error.message : 'EXTERNAL_BACKUP_VALIDATION_FAILED';
  process.stdout.write(JSON.stringify({ kind: 'rejected', code })); process.exitCode = 1;
} finally { rmSync(temporary, { recursive: true, force: true }); }
