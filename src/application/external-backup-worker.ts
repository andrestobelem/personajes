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
    if (action === sqlConstants.SQLITE_PRAGMA && arg1 !== null && ['quick_check', 'table_xinfo', 'data_version'].includes(arg1)) return sqlConstants.SQLITE_OK;
    return sqlConstants.SQLITE_DENY;
  });
  return { db, allow: (names: string[]) => { for (const name of names) allowed.add(name); } };
}
function schema(db: DatabaseSync) { return ApprovedJournalSchemaSchema.parse(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()); }
const appendOnlyTables = new Set(['run_configuration_revisions', 'actor_identity_epochs', 'actor_identity_session_bindings', 'actor_pi_session_archives', 'actor_job_identity_bindings', 'identity_promotion_receipts']);
function approvedAppendOnlyTrigger(object: {type:string;name:string;tbl_name:string}) {
  return object.type === 'trigger' && appendOnlyTables.has(object.tbl_name)
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
function ordinaryJournalCopy(sourcePath: string, cleanPath: string) {
  const source = readonly(sourcePath); let clean: DatabaseSync | undefined;
  try {
    const actual = schema(source.db); const approved = new Map(request.approvedJournalSchema.map(object => [`${object.type}:${object.name}`, object]));
    for (const object of actual) {
      const expected = approved.get(`${object.type}:${object.name}`);
      if (expected === undefined || (JSON.stringify(object) !== JSON.stringify(expected)&&!matchesLegacyOAuthSchema(object,expected))) reject('EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID');
      if (object.type === 'view' || (object.type === 'trigger' && !approvedAppendOnlyTrigger(object)) || object.sql?.startsWith('CREATE VIRTUAL TABLE')) reject('EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID');
    }
    // Only these append-only triggers may survive the exact trusted DDL check
    // above. Their absence is also a schema mismatch; uploaded SQL is never run.
    for (const trigger of request.approvedJournalSchema.filter(object => object.type === 'trigger')) {
      if (!approvedAppendOnlyTrigger(trigger) || !actual.some(object => object.type === 'trigger' && object.name === trigger.name)) reject('EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID');
    }
    const names = new Set(actual.filter(object => object.type === 'table').map(object => object.name));
    // Auxiliary voice/exchange/memory-preparation tables may be absent from a host that never
    // composed those services; their presence always requires an exact template.
    for (const approved of request.approvedJournalSchema.filter(object => object.type === 'table')) {
      if (!names.has(approved.name) && !/^(?:voice_|exchange_|memory_preparation_)/.test(approved.name)) reject('EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID');
    }
    source.allow([...names]);
    const version = z.strictObject({ version: z.union([z.literal(39),z.literal(40)]) }).safeParse(source.db.prepare('SELECT MAX(version) version FROM schema_version').get());
    if (!version.success || request.manifest.journalVersion !== version.data.version) reject('EXTERNAL_BACKUP_JOURNAL_VERSION_UNSUPPORTED');
    for (const name of names) {
      const columns = z.array(z.object({ hidden: z.number() })).parse(source.db.prepare(`PRAGMA table_xinfo(${quote(name)})`).all());
      if (columns.some(column => column.hidden !== 0)) reject('EXTERNAL_BACKUP_JOURNAL_SCHEMA_INVALID');
    }
    if (source.db.prepare('PRAGMA quick_check').all().some(row => row.quick_check !== 'ok')) reject('EXTERNAL_BACKUP_SQLITE_INVALID');
    // Build from trusted host DDL, not source sqlite_schema statements. All source
    // access remains read-only; migrations will see only host-created objects.
    clean = new DatabaseSync(cleanPath, { allowExtension: false, defensive: true });
    clean.exec('PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=OFF; PRAGMA page_size=4096; PRAGMA max_page_count=65536; BEGIN IMMEDIATE;');
    for (const object of request.approvedJournalSchema.filter(object => object.type === 'table' && object.name !== 'sqlite_sequence')) {
      if (object.sql === null || object.sql.startsWith('CREATE VIRTUAL TABLE')) reject('EXTERNAL_BACKUP_APPROVED_SCHEMA_INVALID');
      clean.exec(object.sql);
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
    for (const object of request.approvedJournalSchema.filter(object => object.type === 'index' && object.sql !== null)) if (object.sql !== null) clean.exec(object.sql);
    // Install host-supplied append-only guards after copying source rows.
    for (const trigger of request.approvedJournalSchema.filter(approvedAppendOnlyTrigger)) {
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
  if (![39,40].includes(request.manifest.journalVersion)) reject('EXTERNAL_BACKUP_JOURNAL_VERSION_UNSUPPORTED');
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
