import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { BackupManifestSchema } from '../domain/backup.ts';
import { exchangeIntegrity } from '../adapters/exchange-integrity.ts';
import { sha256CanonicalJson } from '../domain/canonical-json.ts';
import { PreparationBudgetAuthoritySchema, PreparationConfiguratorOperationSchema, PreparationConfiguratorRecordSchema, PreparationConfiguratorStoredSchema, PreparationConfiguratorTerminalProofSchema } from '../domain/preparation-configurator-jobs.ts';
import { RunConfigurationDraftSchema } from '../domain/production.ts';
import { compilePreparationConfiguratorPacket, validatePreparationConfiguratorContext } from './preparation-configurator-context.ts';

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
const v44PreparationTables = new Set(['model_budget_authorities', 'model_time_run_state', 'preparation_configurator_jobs', 'preparation_configurator_operations', 'preparation_configurator_records']);
function expectedV44PreparationSchema() {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(`CREATE TABLE model_budget_authorities(
      run_id TEXT PRIMARY KEY REFERENCES run_budgets(run_id) ON DELETE RESTRICT,
      kind TEXT NOT NULL CHECK(kind IN('preparation','ready')),
      payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64)
    );
    CREATE TABLE "model_time_run_state"(
      run_id TEXT PRIMARY KEY REFERENCES run_budgets(run_id) ON DELETE RESTRICT,
      unknown_legacy_requests INTEGER NOT NULL DEFAULT 0 CHECK(unknown_legacy_requests>=0)
    );
    CREATE TABLE preparation_configurator_jobs(
      job_id TEXT PRIMARY KEY,principal_id TEXT NOT NULL,run_id TEXT NOT NULL REFERENCES run_configuration_drafts(run_id) ON DELETE RESTRICT,
      payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64)
    );
    CREATE TABLE preparation_configurator_operations(
      principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,operation_kind TEXT NOT NULL CHECK(operation_kind IN('create','start','cancel','apply')),
      request_json TEXT NOT NULL,request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
      job_id TEXT NOT NULL REFERENCES preparation_configurator_jobs(job_id) ON DELETE RESTRICT,
      result_json TEXT NOT NULL,result_hash TEXT NOT NULL CHECK(length(result_hash)=64),
      PRIMARY KEY(principal_id,idempotency_key)
    );
    CREATE TABLE preparation_configurator_records(
      job_id TEXT NOT NULL REFERENCES preparation_configurator_jobs(job_id) ON DELETE RESTRICT,
      generation INTEGER NOT NULL CHECK(generation>=0),kind TEXT NOT NULL CHECK(kind IN('session','job-base','request-input','terminal-candidate','candidate','accepted-proof')),
      request_seq INTEGER NOT NULL,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
      PRIMARY KEY(job_id,generation,kind,request_seq)
    );
    CREATE TRIGGER preparation_configurator_records_no_update BEFORE UPDATE ON preparation_configurator_records BEGIN SELECT RAISE(ABORT,'PREPARATION_CONFIGURATOR_RECORD_IMMUTABLE'); END;
    CREATE TRIGGER preparation_configurator_records_no_delete BEFORE DELETE ON preparation_configurator_records BEGIN SELECT RAISE(ABORT,'PREPARATION_CONFIGURATOR_RECORD_IMMUTABLE'); END;
    CREATE TRIGGER preparation_configurator_operations_no_update BEFORE UPDATE ON preparation_configurator_operations BEGIN SELECT RAISE(ABORT,'PREPARATION_CONFIGURATOR_OPERATION_IMMUTABLE'); END;
    CREATE TRIGGER preparation_configurator_operations_no_delete BEFORE DELETE ON preparation_configurator_operations BEGIN SELECT RAISE(ABORT,'PREPARATION_CONFIGURATOR_OPERATION_IMMUTABLE'); END;`);
    return z.array(z.strictObject({ type: z.string(), name: z.string(), tbl_name: z.string(), sql: z.string().nullable() }))
      .parse(database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all())
      .filter(entry => v44PreparationTables.has(entry.tbl_name));
  } finally { database.close(); }
}
const v44PreparationSchema = expectedV44PreparationSchema();
function normalizedSchema(objects: Array<{ type: string; name: string; tbl_name: string; sql: string | null }>) {
  // SQLite preserves incidental indentation from CREATE TABLE statements in
  // sqlite_schema.sql. Compare the SQL tokens while ignoring formatting only;
  // names, constraints, triggers, and literal contents remain part of the
  // canonical comparison.
  const normalizeSql = (sql: string | null) => {
    if (sql === null) return null;
    let output = ''; let quote: "'" | '"' | '`' | ']' | undefined; let pendingSpace = false;
    for (let index = 0; index < sql.length; index++) {
      const char = sql[index]!;
      if (quote !== undefined) {
        output += char;
        if ((quote === ']' && char === ']') || (quote !== ']' && char === quote)) {
          if (sql[index + 1] === char && quote !== ']') output += sql[++index]!;
          else quote = undefined;
        }
      } else if (/\s/.test(char)) pendingSpace = output.length > 0;
      else {
        if (char === "'" || char === '"' || char === '`') quote = char;
        else if (char === '[') quote = ']';
        const previous = output.at(-1);
        if (pendingSpace && previous !== undefined && /[\w$]/.test(previous) && /[\w$]/.test(char)) output += ' ';
        pendingSpace = false; output += char;
      }
    }
    return output;
  };
  return objects.map(entry => ({ ...entry, sql: normalizeSql(entry.sql) }));
}
// Current journal/exchange/voice tables. Unknown additions require a conscious
// recovery contract rather than silently becoming ignored operational state.
const worldTables = new Set(`act_scenes actor_activation_causes actor_activation_invitation_jobs actor_activation_invitations actor_job_checkpoints actor_job_request_leases actor_knowledge actor_pi_candidates actor_pi_consumptions actor_pi_sessions actor_pi_turn_receipts actor_state_cut_batches actor_state_cuts actor_terminal_proposals actor_turn_intents actor_turn_job_inputs actor_turn_jobs actor_turn_reconciliations acts administrative_checkpoint_integrity administrative_checkpoints administrative_jobs administrative_request_leases administrative_sessions backup_host_identity backup_jobs backup_restore_previews circumstance_operations continuista_candidates continuista_checkpoints continuista_jobs continuista_receipts continuista_request_leases continuista_sessions coordinator_pulses direction_events direction_operations director_annotations director_candidates episode_scenes episodes exchange_dossier_adaptations exchange_dossier_exports exchange_dossier_imports exchange_dossier_previews exchange_http_operations experiences fork_backup_sources fork_dramatic_seeds fork_job_history fork_job_retries fork_jobs fork_projection_receipts human_intervention_receipts icm_context_packets legacy_narration_publications memory_outbox memory_receipts memory_preparation_jobs memory_preparation_receipts model_budget_authorities model_time_run_state model_time_spans narration_candidates narration_receipts narration_review_candidates narration_review_receipts pi_access_job_history pi_access_job_operations pi_access_job_results pi_access_jobs pi_oauth_job_history pi_oauth_job_operations pi_oauth_jobs preparation_configurator_jobs preparation_configurator_operations preparation_configurator_records pulses request_reservations routine_clock_advances run_budgets run_configuration_draft_history run_configuration_drafts run_configuration_revisions run_control_operations run_draft_operations run_draft_validation_reports run_preflight_job_history run_preflight_job_operations run_preflight_job_results run_preflight_jobs run_step_jobs schema_version sqlite_sequence structure_events structure_operations voice_config_receipts voice_config_versions voice_entities voice_operations voice_receipts voice_reservations voice_schema_version voice_staged_media world_commits world_deliveries world_events world_perception_experiences world_perceptions world_prepared_contexts world_proposals world_resolutions world_reviews world_runs identity_promotion_receipts actor_job_identity_bindings actor_pi_session_archives actor_identity_session_bindings actor_identity_epochs configurator_consents configurator_operations configurator_candidates configurator_checkpoints configurator_sessions configurator_generations configurator_jobs configurator_http_operations`.split(' '));
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
function preparationDraftAt(db: DatabaseSync, runId: string, revision: number) {
  const raw = db.prepare('SELECT run_id,revision,principal_id,recorded_at,payload_json,payload_hash FROM run_configuration_draft_history WHERE run_id=? AND revision=?').get(runId, revision);
  if (raw === undefined) return undefined;
  const row = z.strictObject({ run_id: z.string(), revision: z.number().int().nonnegative(), principal_id: z.string().min(1),
    recorded_at: z.string(), payload_json: z.string(), payload_hash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(raw);
  const payload = z.strictObject({ draft: RunConfigurationDraftSchema, principalId: z.string().trim().min(1).max(200), recordedAt: z.string() }).parse(JSON.parse(row.payload_json));
  if (canonical(payload) !== row.payload_json || sha256CanonicalJson(payload) !== row.payload_hash || payload.draft.runId !== row.run_id
    || payload.draft.revision !== row.revision || payload.principalId !== row.principal_id || payload.recordedAt !== row.recorded_at) fail('RECOVERY_PREPARATION_DATA_INVALID');
  return payload.draft;
}
function auditV44PreparationData(db: DatabaseSync) {
  const authorities = new Map<string, { kind: 'preparation' | 'ready'; value: z.infer<typeof PreparationBudgetAuthoritySchema> }>();
  for (const raw of db.prepare('SELECT run_id,kind,payload_json,payload_hash FROM model_budget_authorities').all()) {
    const row = z.strictObject({ run_id: z.string(), kind: z.enum(['preparation', 'ready']), payload_json: z.string(), payload_hash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(raw);
    const value = PreparationBudgetAuthoritySchema.parse(JSON.parse(row.payload_json));
    if (canonical(value) !== row.payload_json || sha256CanonicalJson(value) !== row.payload_hash || value.runId !== row.run_id) fail('RECOVERY_PREPARATION_DATA_INVALID');
    const draft = preparationDraftAt(db, row.run_id, value.draftRevision);
    if (draft === undefined || sha256CanonicalJson(draft) !== value.draftHash) fail('RECOVERY_PREPARATION_DATA_INVALID');
    if (row.kind === 'preparation') {
      if (db.prepare('SELECT 1 FROM world_runs WHERE run_id=?').get(row.run_id) !== undefined
        || draft.budget.kind !== 'configured' || canonical(draft.budget.value) !== canonical(value.budget)
        || draft.inferenceProfile?.kind !== 'configured' || canonical(draft.inferenceProfile.value) !== canonical(value.profile)) fail('RECOVERY_PREPARATION_DATA_INVALID');
    } else if (db.prepare('SELECT 1 FROM world_runs WHERE run_id=?').get(row.run_id) === undefined) fail('RECOVERY_PREPARATION_DATA_INVALID');
    authorities.set(row.run_id, { kind: row.kind, value });
  }

  const jobs = new Map<string, z.infer<typeof PreparationConfiguratorStoredSchema>>();
  for (const raw of db.prepare('SELECT job_id,principal_id,run_id,payload_json,payload_hash FROM preparation_configurator_jobs').all()) {
    const row = z.strictObject({ job_id: z.string().min(1), principal_id: z.string().min(1), run_id: z.string().min(1),
      payload_json: z.string(), payload_hash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(raw);
    const stored = PreparationConfiguratorStoredSchema.parse(JSON.parse(row.payload_json));
    validatePreparationConfiguratorContext(stored.context);
    if (canonical(stored) !== row.payload_json || sha256CanonicalJson({ jobId: row.job_id, principalId: row.principal_id, runId: row.run_id, stored }) !== row.payload_hash
      || stored.job.scope.jobId !== row.job_id || stored.job.principalId !== row.principal_id || stored.job.scope.runId !== row.run_id
      || canonical(compilePreparationConfiguratorPacket(stored.context)) !== canonical(stored.packet)
      || canonical(stored.job.scope) !== canonical({ runId: row.run_id, jobId: row.job_id, generation: stored.context.request.generation,
        draftRevision: stored.context.request.draftRevision, draftHash: stored.context.request.draftHash, contextHash: stored.context.contextHash })) fail('RECOVERY_PREPARATION_DATA_INVALID');
    const draft = preparationDraftAt(db, row.run_id, stored.job.scope.draftRevision);
    if (draft === undefined || sha256CanonicalJson(draft) !== stored.job.scope.draftHash || canonical(draft) !== canonical(stored.context.draft)) fail('RECOVERY_PREPARATION_DATA_INVALID');
    if (stored.job.state === 'queued' || stored.job.state === 'running') {
      const authority = authorities.get(row.run_id);
      if (authority?.kind !== 'preparation' || authority.value.draftRevision !== stored.job.scope.draftRevision
        || authority.value.draftHash !== stored.job.scope.draftHash || canonical(authority.value.budget) !== canonical(stored.context.budget)
        || canonical(authority.value.profile) !== canonical(stored.context.profile)) fail('RECOVERY_PREPARATION_DATA_INVALID');
    }
    jobs.set(row.job_id, stored);
  }

  const operationsByJob = new Map<string, { count: number; creates: number }>();
  const operations: z.infer<typeof PreparationConfiguratorOperationSchema>[] = [];
  for (const raw of db.prepare('SELECT principal_id,idempotency_key,operation_kind,request_json,request_hash,job_id,result_json,result_hash FROM preparation_configurator_operations').all()) {
    const row = z.strictObject({ principal_id: z.string().min(1), idempotency_key: z.string().uuid(),
      operation_kind: z.enum(['create', 'start', 'cancel', 'apply']), request_json: z.string(), request_hash: z.string().regex(/^[a-f0-9]{64}$/),
      job_id: z.string().min(1), result_json: z.string(), result_hash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(raw);
    const operation = PreparationConfiguratorOperationSchema.parse({ operationKind: row.operation_kind,
      request: JSON.parse(row.request_json), result: JSON.parse(row.result_json) });
    const jobId = operation.operationKind === 'create' ? operation.request.request.jobId : operation.request.jobId;
    const stored = jobs.get(row.job_id);
    const resultJob = operation.operationKind === 'start' ? operation.result.job
      : operation.operationKind === 'apply' ? undefined : operation.result;
    if (stored === undefined || operation.request.principalId !== row.principal_id || operation.request.idempotencyKey !== row.idempotency_key
      || jobId !== row.job_id || stored.job.principalId !== row.principal_id
      || canonical(operation.request) !== row.request_json || sha256CanonicalJson(operation.request) !== row.request_hash
      || canonical(operation.result) !== row.result_json
      || sha256CanonicalJson({ principalId: row.principal_id, idempotencyKey: row.idempotency_key, operationKind: row.operation_kind,
        requestHash: row.request_hash, jobId: row.job_id, result: operation.result }) !== row.result_hash
      || (resultJob !== undefined && (resultJob.scope.jobId !== row.job_id || resultJob.principalId !== row.principal_id
        || canonical(resultJob.scope) !== canonical(stored.job.scope)))
      || (operation.operationKind === 'create' && (canonical(operation.request.request) !== canonical(stored.context.request)
        || operation.result.revision !== 0 || operation.result.state !== 'queued'))
      || (operation.operationKind === 'start' && (operation.result.kind !== 'started' || operation.result.job.state !== 'queued'))
      || (operation.operationKind === 'apply' && (operation.result.jobId !== row.job_id || operation.result.runId !== stored.job.scope.runId
        || operation.request.expectedRevision !== stored.job.revision
        || operation.request.expectedDraftRevision !== stored.job.scope.draftRevision || operation.request.expectedDraftHash !== stored.job.scope.draftHash
        || operation.result.candidateId !== operation.request.candidateId || operation.result.proposalHash !== operation.request.proposalHash
        || operation.result.baseDraftRevision !== operation.request.expectedDraftRevision || operation.result.baseDraftHash !== operation.request.expectedDraftHash
        || operation.result.draftRevision <= operation.result.baseDraftRevision
        || operation.result.selectionHash !== sha256CanonicalJson(operation.request.selection)))) fail('RECOVERY_PREPARATION_DATA_INVALID');
    const counts = operationsByJob.get(row.job_id) ?? { count: 0, creates: 0 };
    counts.count++; if (operation.operationKind === 'create') counts.creates++;
    operationsByJob.set(row.job_id, counts); operations.push(operation);
  }

  const recordsByKey = new Map<string, z.infer<typeof PreparationConfiguratorRecordSchema>>();
  for (const raw of db.prepare('SELECT job_id,generation,kind,request_seq,payload_json,payload_hash FROM preparation_configurator_records').all()) {
    const row = z.strictObject({ job_id: z.string().min(1), generation: z.number().int().nonnegative(),
      kind: z.enum(['session', 'job-base', 'request-input', 'terminal-candidate', 'candidate', 'accepted-proof']),
      request_seq: z.number().int().min(-1), payload_json: z.string(), payload_hash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(raw);
    const stored = jobs.get(row.job_id);
    const record = PreparationConfiguratorRecordSchema.parse(JSON.parse(row.payload_json));
    const kind = record.kind === 'checkpoint' ? record.value.purpose.kind : record.kind;
    const requestSeq = record.kind === 'checkpoint' && record.value.purpose.kind === 'request-input' ? record.value.purpose.requestSeq : -1;
    if (stored === undefined || canonical(record) !== row.payload_json
      || sha256CanonicalJson({ jobId: row.job_id, generation: row.generation, kind: row.kind, requestSeq: row.request_seq, record }) !== row.payload_hash
      || record.execution.scope.jobId !== row.job_id || record.execution.scope.generation !== row.generation
      || kind !== row.kind || requestSeq !== row.request_seq || canonical(record.execution.scope) !== canonical(stored.job.scope)) fail('RECOVERY_PREPARATION_DATA_INVALID');
    recordsByKey.set(`${row.job_id}:${row.generation}:${row.kind}:${row.request_seq}`, record);
  }
  for (const [jobId, stored] of jobs) {
    const operationCounts = operationsByJob.get(jobId);
    if (operationCounts === undefined || operationCounts.creates !== 1) fail('RECOVERY_PREPARATION_DATA_INVALID');
    if (stored.job.state === 'accepted') {
      const candidate = recordsByKey.get(`${jobId}:${stored.job.scope.generation}:candidate:-1`);
      const proof = recordsByKey.get(`${jobId}:${stored.job.scope.generation}:accepted-proof:-1`);
      if (candidate?.kind !== 'candidate' || proof?.kind !== 'accepted-proof' || proof.value.candidateHash !== candidate.value.candidateHash
        || PreparationConfiguratorTerminalProofSchema.safeParse(proof.value).success === false) fail('RECOVERY_PREPARATION_DATA_INVALID');
    }
  }
  for (const operation of operations) if (operation.operationKind === 'apply') {
    const { jobId, generation } = jobs.get(operation.request.jobId)!.job.scope;
    const candidate = recordsByKey.get(`${jobId}:${generation}:candidate:-1`);
    const proof = recordsByKey.get(`${jobId}:${generation}:accepted-proof:-1`);
    const receipt = operation.result;
    const draft = preparationDraftAt(db, receipt.runId, receipt.draftRevision);
    if (candidate?.kind !== 'candidate' || proof?.kind !== 'accepted-proof' || candidate.value.candidateId !== receipt.candidateId
      || sha256CanonicalJson(candidate.value.proposal) !== receipt.proposalHash || proof.value.candidateHash !== candidate.value.candidateHash
      || draft === undefined || sha256CanonicalJson(draft) !== receipt.draftHash) fail('RECOVERY_PREPARATION_DATA_INVALID');
  }
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
    if (world && db.prepare('PRAGMA foreign_key_check').all().length !== 0) fail('RECOVERY_SQLITE_INVALID');
    const schema = z.array(z.strictObject({ type: z.string(), name: z.string(), tbl_name: z.string(), sql: z.string().nullable() }))
      .parse(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all());
    const journalVersion = world ? db.prepare('SELECT MAX(version) AS version FROM schema_version').get()?.version : undefined;
    const preparationObjects = schema.filter(entry => v44PreparationTables.has(entry.tbl_name));
    if (world) {
      if (canonical(normalizedSchema(preparationObjects)) !== canonical(normalizedSchema(v44PreparationSchema))) fail('RECOVERY_PREPARATION_SCHEMA_INVALID');
      auditV44PreparationData(db);
    }
    const memoryPreparationObjects = schema.filter(entry => entry.name.startsWith('memory_preparation_')
      || entry.tbl_name.startsWith('memory_preparation_'));
    if (memoryPreparationObjects.length > 0 && canonical(memoryPreparationObjects) !== canonical(memoryPreparationSchema)) {
      fail('RECOVERY_MEMORY_PREPARATION_SCHEMA_INVALID');
    }
    const known = world ? new Set(worldTables) : memoryTables;
    if (world && journalVersion === 45) known.add('actor_initiatives');
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
