import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { accessSync, closeSync, constants, fstatSync, lstatSync, openSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { acquireRuntimeConfigurationOwnership } from '../adapters/runtime-configuration-ownership.ts';
import { ICM_VERSION } from '../adapters/icm.ts';
import {
  IcmRuntimeConfigurationJobPageSchema,
  IcmRuntimeConfigurationJobSchema,
  IcmRuntimeConfigurationRequestSchema,
  IcmRuntimeConfigurationStartResultSchema,
  IcmRuntimeConfigurationViewSchema,
} from '../domain/icm-runtime-configuration.ts';
import type {
  IcmRuntimeConfigurationFailureCode,
  IcmRuntimeConfigurationJob,
  IcmRuntimeConfigurationStartResult,
  IcmRuntimeConfigurationView,
} from '../domain/icm-runtime-configuration.ts';
import { HashSchema, JobIdSchema, RevisionSchema } from '../domain/values.ts';

const RuntimeFailureSchema = z.object({
  kind: z.literal('icm-runtime-configuration-failure'),
  code: z.enum([
    'configuration-stale', 'binary-path-invalid', 'binary-not-executable', 'icm-version-mismatch',
    'icm-validation-failed', 'maintenance-unavailable', 'apply-failed', 'cancelled',
  ]),
}).passthrough();
const JobRowSchema = z.strictObject({
  job_id: JobIdSchema,
  principal_id: z.string().min(1).max(120),
  state: IcmRuntimeConfigurationJobSchema.shape.state,
  revision: RevisionSchema,
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  data_json: z.string(),
  data_hash: HashSchema,
});
const ReceiptRowSchema = z.strictObject({
  principal_id: z.string().min(1).max(120),
  idempotency_key: z.uuid(),
  request_hash: HashSchema,
  job_id: JobIdSchema,
  receipt_json: z.string(),
  receipt_hash: HashSchema,
});
const ConfigurationRowSchema = z.strictObject({
  singleton: z.literal(1),
  revision: RevisionSchema,
  configured_binary_path: z.string().min(1).max(4_096).nullable(),
  updated_at: z.number().int().nonnegative(),
});
const PageInputSchema = z.strictObject({
  principalId: z.string().min(1).max(120),
  cursor: z.string().min(1).max(240).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
const CursorSchema = z.strictObject({ createdAt: z.number().int().nonnegative(), jobId: JobIdSchema });
const IcmVersionOutput = `icm ${ICM_VERSION}`;
const CONFIG_TABLE_DDL = `CREATE TABLE icm_runtime_configuration(
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    revision INTEGER NOT NULL CHECK(revision>=0),
    configured_binary_path TEXT,
    updated_at INTEGER NOT NULL CHECK(updated_at>=0)
  )`;
const JOBS_TABLE_DDL = `CREATE TABLE icm_runtime_configuration_jobs(
    job_id TEXT PRIMARY KEY,
    principal_id TEXT NOT NULL,
    state TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision>=0),
    created_at INTEGER NOT NULL CHECK(created_at>=0),
    updated_at INTEGER NOT NULL CHECK(updated_at>=0),
    data_json TEXT NOT NULL,
    data_hash TEXT NOT NULL
  )`;
const RECEIPTS_TABLE_DDL = `CREATE TABLE icm_runtime_configuration_receipts(
    principal_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    job_id TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    receipt_hash TEXT NOT NULL,
    PRIMARY KEY(principal_id,idempotency_key),
    FOREIGN KEY(job_id) REFERENCES icm_runtime_configuration_jobs(job_id) ON DELETE RESTRICT
  )`;
const JOB_INDEX_DDL = 'CREATE INDEX icm_runtime_configuration_jobs_scope ON icm_runtime_configuration_jobs(principal_id,created_at DESC,job_id DESC)';

export type IcmRuntimeApply = (input: { binaryPath: string | null }) => Promise<void>;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('ICM_RUNTIME_VALUE_NOT_SERIALIZABLE');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = z.record(z.string(), z.unknown()).parse(value);
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function digest(value: string): z.infer<typeof HashSchema> {
  return HashSchema.parse(createHash('sha256').update(value).digest('hex'));
}

function canonicalHash(value: unknown): z.infer<typeof HashSchema> {
  return digest(canonicalJson(value));
}

function assertPrivateDatabaseIdentity(input: { descriptor: number; path: string }): void {
  const opened = fstatSync(input.descriptor);
  const linked = lstatSync(input.path);
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (!opened.isFile() || !linked.isFile() || linked.isSymbolicLink()
    || opened.dev !== linked.dev || opened.ino !== linked.ino
    || opened.nlink !== 1 || linked.nlink !== 1
    || (opened.mode & 0o077) !== 0 || (linked.mode & 0o077) !== 0
    || (currentUid !== undefined && (opened.uid !== currentUid || linked.uid !== currentUid))) {
    throw new Error('ICM_RUNTIME_DATABASE_INVALID');
  }
}

function openPrivateDatabaseFile(path: string): { descriptor: number; created: boolean } {
  let descriptor: number;
  let created = false;
  try {
    descriptor = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    descriptor = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
  }
  try {
    if (created) {
      const status = fstatSync(descriptor);
      if (!status.isFile() || status.nlink !== 1 || (typeof process.getuid === 'function' && status.uid !== process.getuid())) {
        throw new Error('ICM_RUNTIME_DATABASE_INVALID');
      }
    }
    assertPrivateDatabaseIdentity({ descriptor, path });
    return { descriptor, created };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function runtimeFailure(code: IcmRuntimeConfigurationFailureCode): Error & { kind: 'icm-runtime-configuration-failure'; code: IcmRuntimeConfigurationFailureCode } {
  return Object.assign(new Error(code), RuntimeFailureSchema.parse({ kind: 'icm-runtime-configuration-failure', code }));
}

function isRuntimeFailure(value: unknown): value is Error & { kind: 'icm-runtime-configuration-failure'; code: IcmRuntimeConfigurationFailureCode } {
  return value instanceof Error && RuntimeFailureSchema.safeParse(value).success;
}

function encodeCursor(value: z.infer<typeof CursorSchema>): string {
  return Buffer.from(canonicalJson(value), 'utf8').toString('base64url');
}

function decodeCursor(value: string): z.infer<typeof CursorSchema> {
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw new Error('ICM_RUNTIME_CURSOR_INVALID');
  const text = bytes.toString('utf8');
  const parsed: unknown = JSON.parse(text);
  const cursor = CursorSchema.parse(parsed);
  if (canonicalJson(cursor) !== text) throw new Error('ICM_RUNTIME_CURSOR_INVALID');
  return cursor;
}

function verifyIcmExecutable(input: { requestedPath: string; runtimeRoot: string; signal: AbortSignal }): Promise<string> {
  if (input.signal.aborted) return Promise.reject(runtimeFailure('cancelled'));
  let canonicalPath: string;
  let before: ReturnType<typeof statSync>;
  try {
    if (!isAbsolute(input.requestedPath) || input.requestedPath.includes('\0')) throw new Error('path');
    canonicalPath = realpathSync(input.requestedPath);
    const status = lstatSync(canonicalPath);
    if (!status.isFile()) throw new Error('file');
    accessSync(canonicalPath, constants.X_OK);
    before = statSync(canonicalPath);
    if (!before.isFile()) throw new Error('file');
  } catch {
    return Promise.reject(runtimeFailure(isAbsolute(input.requestedPath) ? 'binary-not-executable' : 'binary-path-invalid'));
  }

  return new Promise((resolve, reject) => {
    if (input.signal.aborted) { reject(runtimeFailure('cancelled')); return; }
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(canonicalPath, ['--version'], {
        cwd: input.runtimeRoot,
        env: { PATH: '/usr/bin:/bin', HOME: input.runtimeRoot, TMPDIR: input.runtimeRoot, LANG: 'C', LC_ALL: 'C' },
        detached: process.platform !== 'win32',
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      reject(runtimeFailure('icm-validation-failed'));
      return;
    }
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let oversized = false;
    let finished = false;
    const killProcessTree = () => {
      let groupKilled = false;
      if (process.platform !== 'win32' && child.pid !== undefined) {
        try { process.kill(-child.pid, 'SIGKILL'); groupKilled = true; } catch { /* Fall back to the direct child. */ }
      }
      if (!groupKilled) {
        child.kill('SIGKILL');
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
    };
    const timeout = setTimeout(() => { timedOut = true; killProcessTree(); }, 5_000);
    const onAbort = () => { killProcessTree(); };
    input.signal.addEventListener('abort', onAbort, { once: true });
    const collect = (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += bytes.length;
      if (outputBytes > 4_096) { oversized = true; killProcessTree(); return; }
      chunks.push(bytes);
    };
    if (child.stdout === null || child.stderr === null) {
      clearTimeout(timeout);
      input.signal.removeEventListener('abort', onAbort);
      killProcessTree();
      reject(runtimeFailure('icm-validation-failed'));
      return;
    }
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    function finish(operation: () => void) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      input.signal.removeEventListener('abort', onAbort);
      operation();
    }
    child.once('error', () => finish(() => reject(runtimeFailure('icm-validation-failed'))));
    child.once('close', code => finish(() => {
      if (input.signal.aborted) { reject(runtimeFailure('cancelled')); return; }
      if (timedOut || oversized || code !== 0) { reject(runtimeFailure('icm-validation-failed')); return; }
      if (Buffer.concat(chunks).toString('utf8').trim() !== IcmVersionOutput) {
        reject(runtimeFailure('icm-version-mismatch'));
        return;
      }
      try {
        const after = statSync(canonicalPath);
        if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) {
          reject(runtimeFailure('binary-path-invalid'));
          return;
        }
      } catch {
        reject(runtimeFailure('binary-path-invalid'));
        return;
      }
      resolve(canonicalPath);
    }));
  });
}

/** A machine-local, durable ICM executable selection with explicit host apply. */
export function openIcmRuntimeConfiguration(input: {
  privateDataRoot: string;
  environmentBinaryPath?: string;
  apply: IcmRuntimeApply;
  acquireMaintenance: () => Promise<() => void>;
}) {
  const root = z.string().min(1).parse(input.privateDataRoot);
  const runtimeRoot = `${root}-runtime`;
  const environmentPathValue = input.environmentBinaryPath ?? process.env.PERSONAJES_ICM_BINARY;
  const environmentBinaryPath = environmentPathValue === undefined || environmentPathValue === ''
    ? null
    : z.string().min(1).max(4_096).safeParse(environmentPathValue).success ? environmentPathValue : null;
  const ownership = acquireRuntimeConfigurationOwnership({ privateDataRoot: runtimeRoot });
  let db: DatabaseSync | undefined;
  let databaseDescriptor: number | undefined;
  try {
    const path = join(ownership.privateDataRoot, 'runtime.sqlite');
    const openedFile = openPrivateDatabaseFile(path);
    databaseDescriptor = openedFile.descriptor;
    assertPrivateDatabaseIdentity({ descriptor: databaseDescriptor, path });
    db = new DatabaseSync(path);
    assertPrivateDatabaseIdentity({ descriptor: databaseDescriptor, path });
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    db.exec(`${CONFIG_TABLE_DDL.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')};
      ${JOBS_TABLE_DDL.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')};
      ${RECEIPTS_TABLE_DDL.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')};
      ${JOB_INDEX_DDL.replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ')};`);
    const expectedSchema = [
      { type: 'index', name: 'icm_runtime_configuration_jobs_scope', tbl_name: 'icm_runtime_configuration_jobs', sql: JOB_INDEX_DDL },
      { type: 'index', name: 'sqlite_autoindex_icm_runtime_configuration_jobs_1', tbl_name: 'icm_runtime_configuration_jobs', sql: null },
      { type: 'index', name: 'sqlite_autoindex_icm_runtime_configuration_receipts_1', tbl_name: 'icm_runtime_configuration_receipts', sql: null },
      { type: 'table', name: 'icm_runtime_configuration', tbl_name: 'icm_runtime_configuration', sql: CONFIG_TABLE_DDL },
      { type: 'table', name: 'icm_runtime_configuration_jobs', tbl_name: 'icm_runtime_configuration_jobs', sql: JOBS_TABLE_DDL },
      { type: 'table', name: 'icm_runtime_configuration_receipts', tbl_name: 'icm_runtime_configuration_receipts', sql: RECEIPTS_TABLE_DDL },
    ];
    const schema = z.array(z.strictObject({ type: z.string(), name: z.string(), tbl_name: z.string(), sql: z.string().nullable() }))
      .parse(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name LIKE 'icm_runtime_configuration%' OR tbl_name LIKE 'icm_runtime_configuration%' OR name LIKE 'sqlite_autoindex_icm_runtime_configuration%' ORDER BY type,name").all());
    if (canonicalJson(schema) !== canonicalJson(expectedSchema)) throw new Error('ICM_RUNTIME_SCHEMA_INVALID');
    assertPrivateDatabaseIdentity({ descriptor: databaseDescriptor, path });
  } catch (error) {
    try { db?.close(); } finally {
      try { if (databaseDescriptor !== undefined) closeSync(databaseDescriptor); }
      finally { ownership.release(); }
    }
    throw error;
  }
  const database = db;
  const databaseFileDescriptor = databaseDescriptor;
  const databasePath = join(ownership.privateDataRoot, 'runtime.sqlite');
  let closed = false;
  let closing = false;
  let closePromise: Promise<void> | undefined;
  let queue = Promise.resolve();
  let activeLeases = 0;
  const workers = new Set<Promise<void>>();
  const controllers = new Map<string, AbortController>();
  const scheduled = new Set<NodeJS.Immediate>();

  function assertOwned(): void {
    ownership.assertOwned();
    assertPrivateDatabaseIdentity({ descriptor: databaseFileDescriptor, path: databasePath });
  }

  function assertOpen(): void {
    if (closed || closing) throw new Error('ICM_RUNTIME_CONFIGURATION_CLOSED');
  }

  function transaction<T>(operation: () => T): T {
    if (closed) throw new Error('ICM_RUNTIME_CONFIGURATION_CLOSED');
    assertOwned();
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* SQLite may already have rolled back. */ }
      throw error;
    }
  }

  function readConfigurationInternal(): IcmRuntimeConfigurationView {
    assertOwned();
    const row = database.prepare('SELECT singleton,revision,configured_binary_path,updated_at FROM icm_runtime_configuration WHERE singleton=1').get();
    if (row !== undefined) {
      const stored = ConfigurationRowSchema.parse(row);
      return IcmRuntimeConfigurationViewSchema.parse({ kind: 'icm-runtime-configuration', revision: stored.revision,
        configuredBinaryPath: stored.configured_binary_path, source: 'saved' });
    }
    return IcmRuntimeConfigurationViewSchema.parse({ kind: 'icm-runtime-configuration', revision: 0,
      configuredBinaryPath: environmentBinaryPath, source: environmentBinaryPath === null ? 'unconfigured' : 'environment' });
  }

  function storeJob(job: IcmRuntimeConfigurationJob): IcmRuntimeConfigurationJob {
    const parsed = IcmRuntimeConfigurationJobSchema.parse(job);
    const json = canonicalJson(parsed);
    database.prepare(`INSERT INTO icm_runtime_configuration_jobs(job_id,principal_id,state,revision,created_at,updated_at,data_json,data_hash)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET state=excluded.state,revision=excluded.revision,
      updated_at=excluded.updated_at,data_json=excluded.data_json,data_hash=excluded.data_hash`)
      .run(parsed.jobId, parsed.principalId, parsed.state, parsed.revision, parsed.createdAt, parsed.updatedAt, json, digest(json));
    return parsed;
  }

  function jobById(jobId: string, principalId?: string): IcmRuntimeConfigurationJob | undefined {
    if (closed) throw new Error('ICM_RUNTIME_CONFIGURATION_CLOSED');
    assertOwned();
    const raw = principalId === undefined
      ? database.prepare(`SELECT job_id,principal_id,state,revision,created_at,updated_at,data_json,data_hash
          FROM icm_runtime_configuration_jobs WHERE job_id=?`).get(jobId)
      : database.prepare(`SELECT job_id,principal_id,state,revision,created_at,updated_at,data_json,data_hash
          FROM icm_runtime_configuration_jobs WHERE job_id=? AND principal_id=?`).get(jobId, principalId);
    if (raw === undefined) return undefined;
    const row = JobRowSchema.parse(raw);
    const parsed: unknown = JSON.parse(row.data_json);
    const job = IcmRuntimeConfigurationJobSchema.parse(parsed);
    if (canonicalJson(job) !== row.data_json || digest(row.data_json) !== row.data_hash || job.jobId !== row.job_id
      || job.principalId !== row.principal_id || job.state !== row.state || job.revision !== row.revision
      || job.createdAt !== row.created_at || job.updatedAt !== row.updated_at) throw new Error('ICM_RUNTIME_LEDGER_INTEGRITY_FAILED');
    return job;
  }

  function readReceipt(principalId: string, idempotencyKey: string): z.infer<typeof ReceiptRowSchema> | undefined {
    const raw = database.prepare(`SELECT principal_id,idempotency_key,request_hash,job_id,receipt_json,receipt_hash
      FROM icm_runtime_configuration_receipts WHERE principal_id=? AND idempotency_key=?`).get(principalId, idempotencyKey);
    if (raw === undefined) return undefined;
    const row = ReceiptRowSchema.parse(raw);
    const parsed: unknown = JSON.parse(row.receipt_json);
    const snapshot = IcmRuntimeConfigurationJobSchema.parse(parsed);
    if (canonicalJson(snapshot) !== row.receipt_json || digest(row.receipt_json) !== row.receipt_hash
      || snapshot.jobId !== row.job_id || snapshot.principalId !== row.principal_id
      || snapshot.requestHash !== row.request_hash) throw new Error('ICM_RUNTIME_RECEIPT_INTEGRITY_FAILED');
    return row;
  }

  function updateJob(job: IcmRuntimeConfigurationJob, change: {
    state?: IcmRuntimeConfigurationJob['state'];
    failureCode?: IcmRuntimeConfigurationFailureCode | null;
    completedAt?: number | null;
  }): IcmRuntimeConfigurationJob {
    const next = IcmRuntimeConfigurationJobSchema.parse({ ...job,
      ...(change.state === undefined ? {} : { state: change.state }),
      ...(change.failureCode === undefined ? {} : { failureCode: change.failureCode }),
      ...(change.completedAt === undefined ? {} : { completedAt: change.completedAt }),
      revision: RevisionSchema.parse(job.revision + 1), updatedAt: Date.now(),
    });
    return transaction(() => storeJob(next));
  }

  function recoverAbandonedJobs(): void {
    transaction(() => {
      const ids = database.prepare(`SELECT job_id FROM icm_runtime_configuration_jobs WHERE state IN ('queued','running')`).all()
        .map(row => JobIdSchema.parse(z.strictObject({ job_id: JobIdSchema }).parse(row).job_id));
      for (const jobId of ids) {
        const job = jobById(jobId);
        if (job === undefined) continue;
        storeJob(IcmRuntimeConfigurationJobSchema.parse({ ...job, state: 'interrupted', failureCode: 'cancelled',
          revision: RevisionSchema.parse(job.revision + 1), updatedAt: Date.now(), completedAt: Date.now() }));
      }
    });
  }

  function encodeStart(raw: unknown): IcmRuntimeConfigurationStartResult {
    const request = IcmRuntimeConfigurationRequestSchema.parse(raw);
    const requestHash = canonicalHash({ binaryPath: request.binaryPath, expectedRevision: request.expectedRevision });
    const previous = transaction(() => readReceipt(request.principalId, request.idempotencyKey));
    if (previous !== undefined) {
      if (previous.request_hash !== requestHash) return IcmRuntimeConfigurationStartResultSchema.parse({ kind: 'idempotency-conflict' });
      const latest = jobById(previous.job_id, request.principalId);
      if (latest === undefined) throw new Error('ICM_RUNTIME_RECEIPT_SCOPE_INVALID');
      const receipt: unknown = JSON.parse(previous.receipt_json);
      return IcmRuntimeConfigurationStartResultSchema.parse({ kind: 'existing', job: receipt });
    }
    const current = readConfigurationInternal();
    if (current.revision !== request.expectedRevision) {
      return IcmRuntimeConfigurationStartResultSchema.parse({ kind: 'rejected', code: 'configuration-stale', current });
    }
    const now = Date.now();
    const job = IcmRuntimeConfigurationJobSchema.parse({
      kind: 'icm-runtime-configuration-job', jobId: JobIdSchema.parse(randomUUID()),
      principalId: request.principalId, state: 'queued', revision: 0,
      expectedConfigurationRevision: request.expectedRevision, binaryPath: request.binaryPath,
      requestHash, failureCode: null, createdAt: now, updatedAt: now, completedAt: null,
    });
    transaction(() => {
      const raced = readReceipt(request.principalId, request.idempotencyKey);
      if (raced !== undefined) return;
      storeJob(job);
      const receiptJson = canonicalJson(job);
      database.prepare(`INSERT INTO icm_runtime_configuration_receipts(principal_id,idempotency_key,request_hash,job_id,receipt_json,receipt_hash)
        VALUES(?,?,?,?,?,?)`).run(request.principalId, request.idempotencyKey, requestHash, job.jobId, receiptJson, digest(receiptJson));
    });
    const committed = transaction(() => readReceipt(request.principalId, request.idempotencyKey));
    if (committed === undefined) throw new Error('ICM_RUNTIME_RECEIPT_MISSING');
    if (committed.request_hash !== requestHash) return IcmRuntimeConfigurationStartResultSchema.parse({ kind: 'idempotency-conflict' });
    const accepted = jobById(committed.job_id, request.principalId);
    if (accepted === undefined) throw new Error('ICM_RUNTIME_RECEIPT_SCOPE_INVALID');
    if (committed.receipt_json !== canonicalJson(job)) {
      const receipt: unknown = JSON.parse(committed.receipt_json);
      return IcmRuntimeConfigurationStartResultSchema.parse({ kind: 'existing', job: receipt });
    }
    schedule(accepted.jobId);
    return IcmRuntimeConfigurationStartResultSchema.parse({ kind: 'accepted', job: accepted });
  }

  async function acquireLease(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw runtimeFailure('cancelled');
    const leasePromise = Promise.resolve().then(() => {
      if (signal.aborted) throw runtimeFailure('cancelled');
      return input.acquireMaintenance();
    }).then(release => {
      if (signal.aborted) { release(); throw runtimeFailure('cancelled'); }
      return release;
    });
    let abortHandler: (() => void) | undefined;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      abortHandler = () => reject(runtimeFailure('cancelled'));
      signal.addEventListener('abort', abortHandler, { once: true });
      if (signal.aborted) abortHandler();
    });
    try { return await Promise.race([leasePromise, abortPromise]); }
    finally { if (abortHandler !== undefined) signal.removeEventListener('abort', abortHandler); }
  }

  async function runWorker(jobId: string): Promise<void> {
    let current = jobById(jobId);
    if (current === undefined || current.state !== 'queued') return;
    const controller = new AbortController();
    controllers.set(jobId, controller);
    let release: (() => void) | undefined;
    let phase: 'maintenance' | 'validation' | 'apply' = 'maintenance';
    let applied = false;
    let previousPath: string | null = null;
    try {
      if (closing) throw runtimeFailure('cancelled');
      release = await acquireLease(controller.signal);
      activeLeases += 1;
      current = jobById(jobId);
      if (current === undefined || current.state !== 'queued') return;
      const expectedConfigurationRevision = current.expectedConfigurationRevision;
      const stable = readConfigurationInternal();
      if (stable.revision !== expectedConfigurationRevision) {
        updateJob(current, { state: 'failed', failureCode: 'configuration-stale', completedAt: Date.now() });
        return;
      }
      current = updateJob(current, { state: 'running' });
      previousPath = stable.configuredBinaryPath;
      phase = 'validation';
      const canonicalPath = current.binaryPath === null ? null : await verifyIcmExecutable({
        requestedPath: current.binaryPath, runtimeRoot: ownership.privateDataRoot, signal: controller.signal,
      });
      if (controller.signal.aborted) throw runtimeFailure('cancelled');
      phase = 'apply';
      await input.apply({ binaryPath: canonicalPath });
      applied = true;
      const succeeded = IcmRuntimeConfigurationJobSchema.parse({ ...current, state: 'succeeded', failureCode: null,
        revision: RevisionSchema.parse(current.revision + 1), updatedAt: Date.now(), completedAt: Date.now() });
      transaction(() => {
        const stillCurrent = readConfigurationInternal();
        if (stillCurrent.revision !== expectedConfigurationRevision) throw runtimeFailure('configuration-stale');
        const nextRevision = RevisionSchema.parse(stillCurrent.revision + 1);
        database.prepare(`INSERT INTO icm_runtime_configuration(singleton,revision,configured_binary_path,updated_at) VALUES(1,?,?,?)
          ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,configured_binary_path=excluded.configured_binary_path,updated_at=excluded.updated_at`)
          .run(nextRevision, canonicalPath, Date.now());
        storeJob(succeeded);
      });
    } catch (error: unknown) {
      if (applied) {
        try { await input.apply({ binaryPath: previousPath }); } catch { /* The runtime callback owns its rollback boundary. */ }
      }
      const latest = jobById(jobId);
      if (latest !== undefined && (latest.state === 'queued' || latest.state === 'running')) {
        let code: IcmRuntimeConfigurationFailureCode;
        if (controller.signal.aborted || (isRuntimeFailure(error) && error.code === 'cancelled')) code = 'cancelled';
        else if (isRuntimeFailure(error)) code = error.code;
        else if (phase === 'maintenance' || isKnownMaintenanceBusy(error)) code = 'maintenance-unavailable';
        else if (phase === 'apply') code = 'apply-failed';
        else code = 'icm-validation-failed';
        updateJob(latest, { state: code === 'cancelled' ? 'interrupted' : 'failed', failureCode: code, completedAt: Date.now() });
      }
    } finally {
      controllers.delete(jobId);
      if (release !== undefined) {
        try { release(); } finally { activeLeases = Math.max(0, activeLeases - 1); }
      }
    }
  }

  function schedule(jobId: string): void {
    const handle = setImmediate(() => {
      scheduled.delete(handle);
      if (closing || closed) return;
      const task = queue.then(() => runWorker(jobId));
      queue = task.catch(() => undefined);
      workers.add(task);
      void task.finally(() => workers.delete(task)).catch(() => undefined);
    });
    scheduled.add(handle);
  }

  function list(raw: unknown) {
    assertOpen();
    const request = PageInputSchema.parse(raw);
    assertOwned();
    const cursor = request.cursor === undefined ? undefined : decodeCursor(request.cursor);
    const rows = cursor === undefined
      ? database.prepare(`SELECT job_id FROM icm_runtime_configuration_jobs WHERE principal_id=?
          ORDER BY created_at DESC,job_id DESC LIMIT ?`).all(request.principalId, request.limit + 1)
      : database.prepare(`SELECT job_id FROM icm_runtime_configuration_jobs WHERE principal_id=?
          AND (created_at<? OR (created_at=? AND job_id<?)) ORDER BY created_at DESC,job_id DESC LIMIT ?`)
        .all(request.principalId, cursor.createdAt, cursor.createdAt, cursor.jobId, request.limit + 1);
    const jobs = rows.map(row => {
      const jobId = JobIdSchema.parse(z.strictObject({ job_id: JobIdSchema }).parse(row).job_id);
      const job = jobById(jobId, request.principalId);
      if (job === undefined) throw new Error('ICM_RUNTIME_LEDGER_INTEGRITY_FAILED');
      return job;
    });
    const hasMore = jobs.length > request.limit;
    const page = jobs.slice(0, request.limit);
    const last = page.at(-1);
    return IcmRuntimeConfigurationJobPageSchema.parse({ jobs: page,
      nextCursor: hasMore && last !== undefined ? encodeCursor({ createdAt: last.createdAt, jobId: last.jobId }) : null });
  }

  function read(raw: unknown): IcmRuntimeConfigurationJob | undefined {
    assertOpen();
    const request = z.strictObject({ jobId: JobIdSchema, principalId: z.string().min(1).max(120) }).parse(raw);
    return jobById(request.jobId, request.principalId);
  }

  function close(): Promise<void> {
    if (closePromise !== undefined) return closePromise;
    closing = true;
    for (const handle of scheduled) clearImmediate(handle);
    scheduled.clear();
    for (const controller of controllers.values()) controller.abort();
    closePromise = (async () => {
      await Promise.allSettled([...workers]);
      await queue;
      try { database.close(); } finally {
        try { closeSync(databaseFileDescriptor); }
        finally { ownership.release(); closed = true; }
      }
    })();
    return closePromise;
  }

  function isKnownMaintenanceBusy(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const code = Reflect.get(error, 'code');
    const message = error.message;
    return code === 'PRODUCTION_RUNTIME_CONFIGURATION_BUSY' || code === 'HOST_RECOVERY_PENDING'
      || message === 'PRODUCTION_RUNTIME_CONFIGURATION_BUSY' || message === 'HOST_RECOVERY_PENDING';
  }

  assertOwned();
  recoverAbandonedJobs();
  return Object.freeze({
    readConfiguration(): IcmRuntimeConfigurationView {
      assertOpen();
      return readConfigurationInternal();
    },
    start(raw: unknown): IcmRuntimeConfigurationStartResult {
      assertOpen();
      return encodeStart(raw);
    },
    read,
    list,
    close,
    get backupBusy(): boolean { return activeLeases > 0; },
  });
}
