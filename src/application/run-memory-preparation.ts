import { createHash, randomUUID } from 'node:crypto';
import { accessSync, closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { createIcmMemoryAdapter, isIcmAdapterFailure } from '../adapters/icm.ts';
import type { CreateIcmMemoryAdapterInput, IcmMemoryAdapter } from '../adapters/icm.ts';
import { ReadyRunConfigurationSchema } from './production-preflight.ts';
import type { openLocalHost } from './local-host.ts';
import {
  MemoryPreparationActorResultSchema,
  MemoryPreparationJobPageSchema,
  MemoryPreparationJobSchema,
  MemoryPreparationRequestSchema,
  MemoryPreparationStartResultSchema,
  memoryPreparationContextEtag,
} from '../domain/memory-preparation.ts';
import type {
  MemoryPreparationActorResult,
  MemoryPreparationFailureCode,
  MemoryPreparationJob,
  MemoryPreparationStartResult,
} from '../domain/memory-preparation.ts';
import { HashSchema, JobIdSchema, RunIdSchema } from '../domain/values.ts';

const OwnershipSchema = z.strictObject({
  kind: z.literal('host-ownership'),
  schemaVersion: z.literal(1),
  nonce: z.uuid(),
  pid: z.number().int().positive(),
  processStartedAt: z.string().datetime(),
});
const ICM_CONFIG = '[store.backup]\nenabled = false\n\n[memory]\nauto_consolidate_enabled = false\n\n[embeddings]\nenabled = false\n';
const StoredJobRowSchema = z.strictObject({
  job_id: JobIdSchema,
  run_id: RunIdSchema,
  principal_id: z.string().min(1).max(120),
  state: MemoryPreparationJobSchema.shape.state,
  revision: MemoryPreparationJobSchema.shape.revision,
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  data_json: z.string(),
  data_hash: HashSchema,
});
const StoredReceiptRowSchema = z.strictObject({
  principal_id: z.string().min(1).max(120),
  idempotency_key: z.uuid(),
  request_hash: HashSchema,
  job_id: JobIdSchema,
  receipt_json: z.string(),
  receipt_hash: HashSchema,
});
const PageInputSchema = z.strictObject({
  runId: RunIdSchema,
  principalId: z.string().min(1).max(120),
  cursor: z.string().min(1).max(240).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
const CursorSchema = z.strictObject({ createdAt: z.number().int().nonnegative(), jobId: JobIdSchema });
const AbortFailureSchema = z.object({ code: z.literal('MEMORY_PREPARATION_ABORTED') }).passthrough();
const MemoryFailureSchema = z.object({ code: z.enum(['memory-missing', 'memory-invalid']) }).passthrough();
const IcmColumnSchema = z.object({ name: z.string() }).passthrough();
const IcmTableSchema = z.object({ name: z.string() }).passthrough();
const IcmMetadataSchema = z.strictObject({ value: z.string().regex(/^[1-9][0-9]*$/) });

export type MemoryPreparationAdapterFactory = (input: {
  privateDataRoot: string;
  runId: z.infer<typeof RunIdSchema>;
  actorId: MemoryPreparationActorResult['actorId'];
  binaryPath: string;
  ledger: CreateIcmMemoryAdapterInput['ledger'];
}) => Promise<Pick<IcmMemoryAdapter, 'initialize'>>;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('MEMORY_PREPARATION_VALUE_NOT_SERIALIZABLE');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = z.record(z.string(), z.unknown()).parse(value);
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function digest(value: string): z.infer<typeof HashSchema> {
  return HashSchema.parse(createHash('sha256').update(value).digest('hex'));
}

function canonicalHash(value: unknown): z.infer<typeof HashSchema> {
  return digest(canonicalJson(value));
}

function abortFailure(): Error & { code: 'MEMORY_PREPARATION_ABORTED' } {
  return Object.assign(new Error('La preparación ICM fue cancelada.'), AbortFailureSchema.parse({ code: 'MEMORY_PREPARATION_ABORTED' }));
}

function isAbortFailure(value: unknown): boolean {
  return value instanceof Error && AbortFailureSchema.safeParse(value).success;
}

function memoryFailure(code: 'memory-missing' | 'memory-invalid'): Error & { code: 'memory-missing' | 'memory-invalid' } {
  return Object.assign(new Error('La base de memoria no puede verificarse.'), MemoryFailureSchema.parse({ code }));
}

function memoryFailureCode(value: unknown): 'memory-missing' | 'memory-invalid' | undefined {
  if (!(value instanceof Error)) return undefined;
  return MemoryFailureSchema.safeParse(value).success ? MemoryFailureSchema.parse(value).code : undefined;
}

function encodeCursor(value: z.infer<typeof CursorSchema>): string {
  return Buffer.from(canonicalJson(value), 'utf8').toString('base64url');
}

function decodeCursor(value: string): z.infer<typeof CursorSchema> {
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw new Error('MEMORY_PREPARATION_CURSOR_INVALID');
  const text = bytes.toString('utf8');
  const parsed: unknown = JSON.parse(text);
  const cursor = CursorSchema.parse(parsed);
  if (canonicalJson(cursor) !== text) throw new Error('MEMORY_PREPARATION_CURSOR_INVALID');
  return cursor;
}

/** Durable, host-owned setup of one empty ICM SQLite store per active prepared actor. */
export function createRunMemoryPreparation(input: {
  host: ReturnType<typeof openLocalHost>;
  icmBinaryPath?: string;
  acquireMaintenance: (scope: { runId: string }) => Promise<() => void>;
  /** Test seam for cancellation and failure paths; production defaults to the pinned CLI adapter. */
  memoryFactory?: MemoryPreparationAdapterFactory;
}) {
  const databasePath = join(input.host.privateDataRoot, 'world.sqlite');
  function assertOwned(): void {
    const ownership = OwnershipSchema.parse(JSON.parse(readFileSync(join(input.host.privateDataRoot, 'host-ownership.json'), 'utf8')));
    if (ownership.nonce !== input.host.ownerToken || ownership.pid !== process.pid) throw new Error('MEMORY_PREPARATION_HOST_OWNERSHIP_LOST');
  }
  assertOwned();
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL;');
  db.exec(`CREATE TABLE IF NOT EXISTS memory_preparation_jobs(
    job_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    state TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision>=0),
    created_at INTEGER NOT NULL CHECK(created_at>=0),
    updated_at INTEGER NOT NULL CHECK(updated_at>=0),
    data_json TEXT NOT NULL,
    data_hash TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS memory_preparation_jobs_scope ON memory_preparation_jobs(principal_id,run_id,created_at DESC,job_id DESC);
  CREATE TABLE IF NOT EXISTS memory_preparation_receipts(
    principal_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    job_id TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    receipt_hash TEXT NOT NULL,
    PRIMARY KEY(principal_id,idempotency_key),
    FOREIGN KEY(job_id) REFERENCES memory_preparation_jobs(job_id) ON DELETE RESTRICT
  );`);

  let closed = false;
  let closing = false;
  let closePromise: Promise<void> | undefined;
  let queue = Promise.resolve();
  let busyLeases = 0;
  const workers = new Set<Promise<void>>();
  const controllers = new Map<string, AbortController>();
  const coordinationConnections = new Map<string, DatabaseSync>();

  function within(root: string, path: string): boolean {
    const pathFromRoot = relative(root, path);
    return pathFromRoot === '' || (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`));
  }

  function privateExisting(path: string, root: string, kind: 'file' | 'directory') {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (kind === 'file' ? !stat.isFile() : !stat.isDirectory())
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid()) || (stat.mode & 0o077) !== 0
      || !within(root, realpathSync(path))) throw new Error('MEMORY_PREPARATION_PATH_INVALID');
    accessSync(path, constants.R_OK | constants.W_OK | (kind === 'directory' ? constants.X_OK : 0));
    return stat;
  }

  function actorMemoryPath(runId: string, actorId: string): string {
    return join(input.host.privateDataRoot, 'runs', runId, 'actors', actorId, 'memory.sqlite');
  }

  function verifyActorDirectories(runId: string, actorId: string): { root: string; actorDirectory: string; databasePath: string } {
    const root = realpathSync(input.host.privateDataRoot);
    const runDirectory = join(root, 'runs', runId);
    const actorsDirectory = join(runDirectory, 'actors');
    const actorDirectory = join(actorsDirectory, actorId);
    for (const directory of [join(root, 'runs'), runDirectory, actorsDirectory, actorDirectory, join(actorDirectory, 'home'), join(actorDirectory, 'tmp')]) {
      privateExisting(directory, root, 'directory');
    }
    const configPath = join(actorDirectory, 'icm-config.toml');
    privateExisting(configPath, root, 'file');
    if (readFileSync(configPath, 'utf8') !== ICM_CONFIG) throw new Error('MEMORY_PREPARATION_PATH_INVALID');
    return { root, actorDirectory, databasePath: join(actorDirectory, 'memory.sqlite') };
  }

  function openVerifiedMemoryConnection(runId: string, actorId: string): DatabaseSync {
    const paths = verifyActorDirectories(runId, actorId);
    const stat = privateExisting(paths.databasePath, paths.root, 'file');
    if (stat.nlink !== 1 || stat.size < 100) throw new Error('MEMORY_PREPARATION_DATABASE_INVALID');
    const descriptor = openSync(paths.databasePath, constants.O_RDWR | constants.O_NOFOLLOW);
    try {
      const openedStat = fstatSync(descriptor);
      if (!openedStat.isFile() || openedStat.dev !== stat.dev || openedStat.ino !== stat.ino || openedStat.nlink !== 1) {
        throw new Error('MEMORY_PREPARATION_DATABASE_INVALID');
      }
      const header = Buffer.alloc(100);
      const bytes = readSync(descriptor, header, 0, header.length, 0);
      if (bytes !== 100 || header.subarray(0, 16).toString('binary') !== 'SQLite format 3\0') {
        throw new Error('MEMORY_PREPARATION_DATABASE_INVALID');
      }
    } finally { closeSync(descriptor); }
    const database = new DatabaseSync(paths.databasePath);
    try {
      database.exec('PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF;');
      const afterOpenStat = privateExisting(paths.databasePath, paths.root, 'file');
      if (afterOpenStat.dev !== stat.dev || afterOpenStat.ino !== stat.ino || afterOpenStat.nlink !== 1) {
        throw new Error('MEMORY_PREPARATION_DATABASE_INVALID');
      }
      z.strictObject({ integrity_check: z.literal('ok') }).parse(database.prepare("PRAGMA integrity_check('memories')").get());
      z.strictObject({ user_version: z.literal(1) }).parse(database.prepare('PRAGMA user_version').get());
      const columns = z.array(IcmColumnSchema).parse(database.prepare('PRAGMA table_info(memories)').all());
      const required = ['id', 'created_at', 'updated_at', 'last_accessed', 'access_count', 'weight', 'topic', 'summary', 'raw_excerpt',
        'keywords', 'importance', 'source_type', 'source_data', 'related_ids', 'embedding', 'summary_hash'];
      if (required.some((name) => !columns.some((column) => column.name === name))) throw new Error('MEMORY_PREPARATION_DATABASE_INVALID');
      IcmMetadataSchema.parse(database.prepare("SELECT value FROM icm_metadata WHERE key='embedding_dims'").get());
      const tables = z.array(IcmTableSchema).parse(database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all());
      if (['memories', 'memories_fts', 'concepts_fts', 'feedback_fts', 'messages_fts'].some((name) => !tables.some((table) => table.name === name))) {
        throw new Error('MEMORY_PREPARATION_DATABASE_INVALID');
      }
      database.prepare('SELECT count(*) FROM memories').get();
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  function retainMemoryConnection(runId: string, actorId: string): void {
    const key = `${runId}:${actorId}`;
    if (coordinationConnections.has(key)) return;
    const connection = openVerifiedMemoryConnection(runId, actorId);
    coordinationConnections.set(key, connection);
  }

  function existingMemoryState(runId: string, actorId: string): 'missing' | 'empty' | 'present' | 'invalid' {
    const path = actorMemoryPath(runId, actorId);
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) return 'invalid';
      return stat.size === 0 ? 'empty' : stat.size >= 100 ? 'present' : 'invalid';
    } catch (error) {
      return error instanceof Error && 'code' in error && error.code === 'ENOENT' ? 'missing' : 'invalid';
    }
  }

  function assertOpen(): void {
    if (closed || closing) throw new Error('MEMORY_PREPARATION_CLOSED');
  }

  function transaction<T>(operation: () => T): T {
    if (closed) throw new Error('MEMORY_PREPARATION_CLOSED');
    assertOwned();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* The transaction may already have rolled back. */ }
      throw error;
    }
  }

  function storeJob(job: MemoryPreparationJob): MemoryPreparationJob {
    const parsed = MemoryPreparationJobSchema.parse(job);
    const json = canonicalJson(parsed);
    const hash = digest(json);
    db.prepare(`INSERT INTO memory_preparation_jobs(job_id,run_id,principal_id,state,revision,created_at,updated_at,data_json,data_hash)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(job_id) DO UPDATE SET state=excluded.state,revision=excluded.revision,updated_at=excluded.updated_at,
        data_json=excluded.data_json,data_hash=excluded.data_hash`)
      .run(parsed.jobId, parsed.runId, parsed.principalId, parsed.state, parsed.revision, parsed.createdAt, parsed.updatedAt, json, hash);
    return parsed;
  }

  function jobById(jobId: string, principalId?: string, runId?: string): MemoryPreparationJob | undefined {
    if (closed) throw new Error('MEMORY_PREPARATION_CLOSED');
    assertOwned();
    const value = principalId !== undefined && runId !== undefined
      ? db.prepare(`SELECT job_id,run_id,principal_id,state,revision,created_at,updated_at,data_json,data_hash
          FROM memory_preparation_jobs WHERE job_id=? AND principal_id=? AND run_id=?`).get(jobId, principalId, runId)
      : principalId !== undefined
        ? db.prepare(`SELECT job_id,run_id,principal_id,state,revision,created_at,updated_at,data_json,data_hash
            FROM memory_preparation_jobs WHERE job_id=? AND principal_id=?`).get(jobId, principalId)
        : db.prepare(`SELECT job_id,run_id,principal_id,state,revision,created_at,updated_at,data_json,data_hash
            FROM memory_preparation_jobs WHERE job_id=?`).get(jobId);
    if (value === undefined) return undefined;
    const row = StoredJobRowSchema.parse(value);
    const parsed: unknown = JSON.parse(row.data_json);
    const job = MemoryPreparationJobSchema.parse(parsed);
    if (canonicalJson(job) !== row.data_json || digest(row.data_json) !== row.data_hash
      || job.jobId !== row.job_id || job.runId !== row.run_id || job.principalId !== row.principal_id
      || job.state !== row.state || job.revision !== row.revision || job.createdAt !== row.created_at || job.updatedAt !== row.updated_at) {
      throw new Error('MEMORY_PREPARATION_LEDGER_INTEGRITY_FAILED');
    }
    return job;
  }

  function saveJob(job: MemoryPreparationJob): MemoryPreparationJob {
    return transaction(() => storeJob(job));
  }

  function receipt(principalId: string, idempotencyKey: string): z.infer<typeof StoredReceiptRowSchema> | undefined {
    const value = db.prepare(`SELECT principal_id,idempotency_key,request_hash,job_id,receipt_json,receipt_hash
      FROM memory_preparation_receipts WHERE principal_id=? AND idempotency_key=?`).get(principalId, idempotencyKey);
    if (value === undefined) return undefined;
    const row = StoredReceiptRowSchema.parse(value);
    const parsed: unknown = JSON.parse(row.receipt_json);
    const snapshot = MemoryPreparationJobSchema.parse(parsed);
    if (canonicalJson(snapshot) !== row.receipt_json || digest(row.receipt_json) !== row.receipt_hash
      || snapshot.jobId !== row.job_id || snapshot.principalId !== row.principal_id) {
      throw new Error('MEMORY_PREPARATION_RECEIPT_INTEGRITY_FAILED');
    }
    return row;
  }

  function updateJob(inputJob: MemoryPreparationJob, change: {
    state?: MemoryPreparationJob['state'];
    actors?: MemoryPreparationActorResult[];
    failureCode?: MemoryPreparationFailureCode | null;
    completedAt?: number | null;
  }): MemoryPreparationJob {
    const now = Date.now();
    const next = MemoryPreparationJobSchema.parse({
      ...inputJob,
      ...(change.state === undefined ? {} : { state: change.state }),
      ...(change.actors === undefined ? {} : { actors: change.actors }),
      ...(change.failureCode === undefined ? {} : { failureCode: change.failureCode }),
      ...(change.completedAt === undefined ? {} : { completedAt: change.completedAt }),
      revision: inputJob.revision + 1,
      updatedAt: now,
    });
    return saveJob(next);
  }

  function inspectSource(request: Pick<MemoryPreparationJob, 'runId' | 'expectedConfigurationRevision' | 'expectedWorldRevision'>):
    | { kind: 'ready'; configurationHash: z.infer<typeof HashSchema>; actorIds: MemoryPreparationActorResult['actorId'][]; purpose: MemoryPreparationJob['purpose'] }
    | { kind: 'rejected'; code: 'run-not-ready' | 'source-stale' | 'run-already-lived' | 'memory-missing' | 'memory-invalid' } {
    try {
    const lifecycle = input.host.journal.readWorldLifecycle({ runId: request.runId });
    if (lifecycle === undefined) return { kind: 'rejected', code: 'run-not-ready' };
    if (!['ready', 'paused', 'stopped'].includes(lifecycle.lifecycle)) return { kind: 'rejected', code: 'run-not-ready' };
    if (lifecycle.configRevision !== request.expectedConfigurationRevision || lifecycle.worldRevision !== request.expectedWorldRevision) {
      return { kind: 'rejected', code: 'source-stale' };
    }
    const metadata = input.host.journal.readWorldConfigurationMetadata({ runId: request.runId });
    const rawConfiguration = input.host.journal.readWorldConfiguration({ runId: request.runId });
    const world = input.host.journal.loadWorld({ runId: request.runId });
    if (metadata === undefined || rawConfiguration === undefined || world === undefined) return { kind: 'rejected', code: 'source-stale' };
    const configuration = ReadyRunConfigurationSchema.safeParse(rawConfiguration);
    if (!configuration.success || configuration.data.runId !== request.runId
      || configuration.data.configRevision !== request.expectedConfigurationRevision
      || metadata.configurationRevision !== request.expectedConfigurationRevision
      || metadata.configurationHash !== canonicalHash(configuration.data)
      || world.runId !== request.runId || world.revision !== request.expectedWorldRevision
      || world.seq !== lifecycle.lastWorldSeq) {
      return { kind: 'rejected', code: 'source-stale' };
    }
    const active = new Set(configuration.data.roster.activeCharacterIds);
    const actorIds = configuration.data.roster.preparedCharacters
      .filter((actor) => active.has(actor.characterId))
      .map((actor) => actor.characterId);
    if (actorIds.length === 0) return { kind: 'rejected', code: 'run-not-ready' };
    const events = input.host.journal.readObservationEvents({ runId: request.runId,
      fromWorldSeq: configuration.data.worldSnapshot.seq + 1, toWorldSeq: world.seq,
      afterWorldSeq: null, limit: 1, communicationsOnly: false });
    const hasExperiences = configuration.data.roster.preparedCharacters.some((actor) =>
      input.host.journal.readExperiences({ runId: request.runId, actorId: actor.characterId, throughWorldSeq: world.seq }).length > 0);
    const lived = world.revision !== configuration.data.worldSnapshot.revision || world.seq !== configuration.data.worldSnapshot.seq
      || (events !== undefined && events.length > 0) || hasExperiences || configuration.data.forkOrigin !== undefined;
    const purpose: MemoryPreparationJob['purpose'] = lifecycle.lifecycle === 'ready' && !lived ? 'initialize-empty' : 'reopen-existing';
    if (purpose === 'reopen-existing') {
      for (const actorId of actorIds) {
        const state = existingMemoryState(request.runId, actorId);
        if (state === 'missing') return { kind: 'rejected', code: 'memory-missing' };
        if (state !== 'present') return { kind: 'rejected', code: 'memory-invalid' };
      }
    }
    return { kind: 'ready', configurationHash: canonicalHash(configuration.data), actorIds, purpose };
    } catch {
      return { kind: 'rejected', code: 'source-stale' };
    }
  }

  function recoverAbandonedJobs(): void {
    transaction(() => {
      const ids = db.prepare(`SELECT job_id FROM memory_preparation_jobs WHERE state IN ('queued','running')`).all()
        .map((row) => JobIdSchema.parse(z.strictObject({ job_id: JobIdSchema }).parse(row).job_id));
      for (const jobId of ids) {
        const current = jobById(jobId);
        if (current === undefined) continue;
        storeJob(MemoryPreparationJobSchema.parse({ ...current, state: 'interrupted', failureCode: 'cancelled',
          revision: current.revision + 1, updatedAt: Date.now() }));
      }
    });
  }

  assertOwned();
  recoverAbandonedJobs();

  async function acquireLease(signal: AbortSignal, runId: string): Promise<() => void> {
    if (signal.aborted) throw abortFailure();
    const leasePromise = Promise.resolve().then(() => {
      if (signal.aborted) throw abortFailure();
      return input.acquireMaintenance({ runId });
    }).then((release) => {
      if (signal.aborted) { release(); throw abortFailure(); }
      return release;
    });
    let abortHandler: (() => void) | undefined;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      abortHandler = () => reject(abortFailure());
      signal.addEventListener('abort', abortHandler, { once: true });
      if (signal.aborted) abortHandler();
    });
    try { return await Promise.race([leasePromise, abortPromise]); }
    finally { if (abortHandler !== undefined) signal.removeEventListener('abort', abortHandler); }
  }

  function transitionActor(job: MemoryPreparationJob, actorId: MemoryPreparationActorResult['actorId'], state: MemoryPreparationActorResult['state']): MemoryPreparationJob {
    const actors = job.actors.map((actor) => actor.actorId === actorId ? MemoryPreparationActorResultSchema.parse({ actorId, state }) : actor);
    return updateJob(job, { actors });
  }

  async function runWorker(jobId: string): Promise<void> {
    let current = jobById(jobId);
    if (current === undefined || current.state !== 'queued') return;
    const controller = new AbortController();
    controllers.set(jobId, controller);
    let release: (() => void) | undefined;
    let phase: 'maintenance' | 'memory-validation' | 'initialization' = 'maintenance';
    try {
      if (closing) throw abortFailure();
      release = await acquireLease(controller.signal, current.runId);
      busyLeases += 1;
      current = jobById(jobId);
      if (current === undefined || current.state !== 'queued') return;
      const source = inspectSource(current);
      if (source.kind === 'rejected') {
        updateJob(current, { state: 'failed', failureCode: source.code, completedAt: Date.now() });
        return;
      }
      if (source.configurationHash !== current.configurationHash || source.purpose !== current.purpose
        || source.actorIds.join('\u0000') !== current.actors.map((actor) => actor.actorId).join('\u0000')) {
        updateJob(current, { state: 'failed', failureCode: 'source-stale', completedAt: Date.now() });
        return;
      }
      current = updateJob(current, { state: 'running' });
      phase = 'memory-validation';
      if (current.purpose === 'reopen-existing') {
        for (const actor of current.actors) {
          const state = existingMemoryState(current.runId, actor.actorId);
          if (state === 'missing') throw memoryFailure('memory-missing');
          if (state !== 'present') throw memoryFailure('memory-invalid');
          retainMemoryConnection(current.runId, actor.actorId);
        }
      }
      phase = 'initialization';
      for (const actor of current.actors) {
        if (controller.signal.aborted) throw abortFailure();
        if (current.purpose === 'initialize-empty') {
          const state = existingMemoryState(current.runId, actor.actorId);
          if (state === 'invalid') throw memoryFailure('memory-invalid');
          if (state === 'present') retainMemoryConnection(current.runId, actor.actorId);
        }
        const factory = input.memoryFactory ?? (async (factoryInput) => createIcmMemoryAdapter({
          ...factoryInput,
          ledger: { findReceipt: (request) => input.host.journal.findReceipt(request) },
        }));
        const adapter = await factory({
          privateDataRoot: input.host.privateDataRoot,
          runId: current.runId,
          actorId: actor.actorId,
          binaryPath: input.icmBinaryPath ?? '',
          ledger: { findReceipt: (request) => input.host.journal.findReceipt(request) },
        });
        const result = await adapter.initialize({ signal: controller.signal });
        if (current.purpose === 'reopen-existing' && result.kind !== 'existing') throw memoryFailure('memory-invalid');
        if (current.purpose === 'initialize-empty' && !coordinationConnections.has(`${current.runId}:${actor.actorId}`)) {
          retainMemoryConnection(current.runId, actor.actorId);
        }
        current = transitionActor(current, actor.actorId, current.purpose === 'reopen-existing' ? 'existing' : result.kind);
      }
      updateJob(current, { state: 'completed', failureCode: null, completedAt: Date.now() });
    } catch (error: unknown) {
      const latest = jobById(jobId);
      if (latest !== undefined && (latest.state === 'queued' || latest.state === 'running')) {
        const code: MemoryPreparationFailureCode = isAbortFailure(error) || controller.signal.aborted
          ? 'cancelled'
          : memoryFailureCode(error) ?? (phase === 'memory-validation' ? 'memory-invalid'
            : phase === 'maintenance' ? 'maintenance-unavailable'
              : isIcmAdapterFailure(error) ? 'icm-unavailable' : 'initialization-failed');
        const failedActor = latest.actors.find((actor) => actor.state === 'pending');
        const actors = failedActor === undefined ? latest.actors : latest.actors.map((actor) => actor.actorId === failedActor.actorId
          ? MemoryPreparationActorResultSchema.parse({ actorId: actor.actorId, state: 'failed' }) : actor);
        updateJob(latest, { state: code === 'cancelled' ? 'interrupted' : 'failed', actors, failureCode: code, completedAt: Date.now() });
      }
    } finally {
      controllers.delete(jobId);
      if (release !== undefined) {
        try { release(); } finally { busyLeases = Math.max(0, busyLeases - 1); }
      }
    }
  }

  function schedule(jobId: string): void {
    const task = queue.then(() => runWorker(jobId));
    queue = task.catch(() => undefined);
    workers.add(task);
    void task.finally(() => workers.delete(task)).catch(() => undefined);
  }

  function start(raw: unknown): MemoryPreparationStartResult {
    assertOpen();
    const request = MemoryPreparationRequestSchema.parse(raw);
    const requestHash = canonicalHash({ runId: request.runId,
      expectedConfigurationRevision: request.expectedConfigurationRevision,
      expectedWorldRevision: request.expectedWorldRevision });
    const previous = transaction(() => receipt(request.principalId, request.idempotencyKey));
    if (previous !== undefined) {
      if (previous.request_hash !== requestHash) return MemoryPreparationStartResultSchema.parse({ kind: 'idempotency-conflict' });
      const job = jobById(previous.job_id, request.principalId, request.runId);
      if (job === undefined) throw new Error('MEMORY_PREPARATION_RECEIPT_SCOPE_INVALID');
      return MemoryPreparationStartResultSchema.parse({ kind: 'existing', job });
    }
    if (input.memoryFactory === undefined && (input.icmBinaryPath === undefined || input.icmBinaryPath.length === 0)) {
      return MemoryPreparationStartResultSchema.parse({ kind: 'rejected', code: 'binary-not-configured' });
    }
    const source = inspectSource(request);
    if (source.kind === 'rejected') return MemoryPreparationStartResultSchema.parse(source);
    const now = Date.now();
    const job = MemoryPreparationJobSchema.parse({
      kind: 'memory-preparation-job', jobId: JobIdSchema.parse(randomUUID()), runId: request.runId,
      principalId: request.principalId, state: 'queued', revision: 0,
      purpose: source.purpose,
      expectedConfigurationRevision: request.expectedConfigurationRevision,
      expectedWorldRevision: request.expectedWorldRevision,
      configurationHash: source.configurationHash,
      contextETag: memoryPreparationContextEtag({ runId: request.runId,
        expectedConfigurationRevision: request.expectedConfigurationRevision, expectedWorldRevision: request.expectedWorldRevision }),
      actors: source.actorIds.map((actorId) => MemoryPreparationActorResultSchema.parse({ actorId, state: 'pending' })),
      failureCode: null, createdAt: now, updatedAt: now, completedAt: null,
    });
    transaction(() => {
      const raced = receipt(request.principalId, request.idempotencyKey);
      if (raced !== undefined) {
        if (raced.request_hash !== requestHash) return;
        return;
      }
      storeJob(job);
      const receiptJob = canonicalJson(job);
      db.prepare(`INSERT INTO memory_preparation_receipts(principal_id,idempotency_key,request_hash,job_id,receipt_json,receipt_hash)
        VALUES(?,?,?,?,?,?)`).run(request.principalId, request.idempotencyKey, requestHash, job.jobId, receiptJob, digest(receiptJob));
    });
    const committed = transaction(() => receipt(request.principalId, request.idempotencyKey));
    if (committed === undefined) throw new Error('MEMORY_PREPARATION_RECEIPT_MISSING');
    if (committed.request_hash !== requestHash) return MemoryPreparationStartResultSchema.parse({ kind: 'idempotency-conflict' });
    const acceptedJob = jobById(committed.job_id, request.principalId, request.runId);
    if (acceptedJob === undefined) throw new Error('MEMORY_PREPARATION_RECEIPT_SCOPE_INVALID');
    schedule(acceptedJob.jobId);
    return MemoryPreparationStartResultSchema.parse({ kind: 'accepted', job: acceptedJob });
  }

  function read(raw: unknown): MemoryPreparationJob | undefined {
    assertOpen();
    const request = z.strictObject({ runId: RunIdSchema, jobId: JobIdSchema, principalId: z.string().min(1).max(120) }).parse(raw);
    assertOwned();
    return jobById(request.jobId, request.principalId, request.runId);
  }

  function list(raw: unknown) {
    assertOpen();
    const request = PageInputSchema.parse(raw);
    assertOwned();
    const cursor = request.cursor === undefined ? undefined : decodeCursor(request.cursor);
    const rows = cursor === undefined
      ? db.prepare(`SELECT job_id FROM memory_preparation_jobs WHERE principal_id=? AND run_id=?
          ORDER BY created_at DESC,job_id DESC LIMIT ?`).all(request.principalId, request.runId, request.limit + 1)
      : db.prepare(`SELECT job_id FROM memory_preparation_jobs WHERE principal_id=? AND run_id=?
          AND (created_at<? OR (created_at=? AND job_id<?)) ORDER BY created_at DESC,job_id DESC LIMIT ?`)
        .all(request.principalId, request.runId, cursor.createdAt, cursor.createdAt, cursor.jobId, request.limit + 1);
    const jobs = rows.map((row) => {
      const jobId = JobIdSchema.parse(z.strictObject({ job_id: JobIdSchema }).parse(row).job_id);
      const job = jobById(jobId, request.principalId, request.runId);
      if (job === undefined) throw new Error('MEMORY_PREPARATION_LEDGER_INTEGRITY_FAILED');
      return job;
    });
    const hasMore = jobs.length > request.limit;
    const page = jobs.slice(0, request.limit);
    const last = page.at(-1);
    return MemoryPreparationJobPageSchema.parse({ jobs: page,
      nextCursor: hasMore && last !== undefined ? encodeCursor({ createdAt: last.createdAt, jobId: last.jobId }) : null });
  }

  function close(): Promise<void> {
    if (closePromise !== undefined) return closePromise;
    closing = true;
    for (const controller of controllers.values()) controller.abort();
    closePromise = (async () => {
      await Promise.allSettled([...workers]);
      await queue;
      if (!closed) {
        for (const connection of coordinationConnections.values()) connection.close();
        coordinationConnections.clear();
        db.close();
        closed = true;
      }
    })();
    return closePromise;
  }

  return Object.freeze({
    start,
    read,
    list,
    close,
    get backupBusy(): boolean { return busyLeases > 0; },
  });
}
