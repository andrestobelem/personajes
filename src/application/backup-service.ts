import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { BackupFenceSchema, BackupIdSchema, BackupJobSchema, BackupManifestSchema, BackupPathSchema, RestorePreviewSchema, type BackupManifest } from '../domain/backup.ts';
import { exchangeIntegrity } from '../adapters/exchange-integrity.ts';

const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const MAX_FILE_BYTES = 256 * 1024 * 1024;
function privateFile(root: string, path: string): Buffer {
  const target = join(root, BackupPathSchema.parse(path));
  const resolved = realpathSync(target);
  const rel = relative(realpathSync(root), resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('BACKUP_PATH_ESCAPE');
  for (let parent = dirname(target); parent !== root; parent = dirname(parent)) {
    if (lstatSync(parent).isSymbolicLink()) throw new Error('BACKUP_SYMLINK');
  }
  const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE_BYTES) throw new Error('BACKUP_FILE_INVALID');
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
function durableFile(path: string, bytes: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
const ArtifactSchema = z.strictObject({ path: BackupPathSchema, kind: z.enum(['sqlite', 'session', 'media', 'fork-memory', 'fork-metadata']) });
/** Host-only port: holds a global write fence across journal, ICM, sessions and media.
 * Acquire must wait for in-flight writers outside any SQLite transaction. Its inventory
 * is from registered sessions/media, never a recursive privateData scan. */
export type BackupQuiescePort = {
  acquire(): Promise<{ artifacts: unknown; release(): void | Promise<void> }>;
};
/** Restore application is deliberately a host port: changing a live SQLite database or
 * rewriting IDs/session paths requires ownership, worker shutdown and journal contracts. */
export type BackupRestorePort = {
  preview(input: { manifest: BackupManifest; mode: 'recover' | 'fork' }): { differences: string[]; blockers: string[]; targetFingerprint: string };
  apply(input: { manifest: BackupManifest; bundleRoot: string; mode: 'recover' | 'fork'; targetFingerprint: string }): Promise<unknown>;
};

export function openBackupService(input: { privateDataRoot: string; quiesce?: BackupQuiescePort; restore?: BackupRestorePort; now?: () => number }) {
  const root = input.privateDataRoot;
  if (!isAbsolute(root) || realpathSync(root) !== root || lstatSync(root).isSymbolicLink()) throw new Error('BACKUP_ROOT_INVALID');
  const now = input.now ?? Date.now;
  const db = new DatabaseSync(join(root, 'world.sqlite'));
  db.exec(`CREATE TABLE IF NOT EXISTS backup_host_identity(lineage_id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS backup_jobs(backup_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,job_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS backup_restore_previews(token TEXT PRIMARY KEY,preview_json TEXT NOT NULL,target_fingerprint TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0,result_json TEXT);`);
  const integrity=exchangeIntegrity(db);integrity.migrate('backup_jobs');integrity.migrate('backup_restore_previews');
  if (!db.prepare('SELECT lineage_id FROM backup_host_identity').get()) db.prepare('INSERT INTO backup_host_identity VALUES(?)').run(randomUUID());
  const lineage = z.strictObject({ lineage_id: z.uuid() }).parse(db.prepare('SELECT lineage_id FROM backup_host_identity').get()).lineage_id;
  for (const row of db.prepare('SELECT backup_id,job_json FROM backup_jobs').all()) {
    const parsed = z.strictObject({ backup_id: z.string(), job_json: z.string() }).parse(row);
    integrity.verify('backup_jobs','backup_id=?',[parsed.backup_id]);
    const job = BackupJobSchema.parse(JSON.parse(parsed.job_json));
    if (job.state === 'running') {db.prepare('UPDATE backup_jobs SET job_json=? WHERE backup_id=?').run(JSON.stringify({ ...job, revision: job.revision + 1, state: 'interrupted', safeCode: 'BACKUP_INTERRUPTED' }), parsed.backup_id);integrity.seal('backup_jobs','backup_id=?',[parsed.backup_id]);}
  }
  function get(raw: unknown) {
    const id = BackupIdSchema.parse(raw);
    integrity.verify('backup_jobs','backup_id=?',[id]);
    const row = db.prepare('SELECT job_json FROM backup_jobs WHERE backup_id=?').get(id);
    if (!row) throw new Error('BACKUP_NOT_FOUND');
    return BackupJobSchema.parse(JSON.parse(z.strictObject({ job_json: z.string() }).parse(row).job_json));
  }
  function verify(raw: unknown): { manifest: BackupManifest; hash: string; bundleRoot: string } {
    const id = BackupIdSchema.parse(raw);
    const job = get(id);
    if (job.state !== 'succeeded') throw new Error('BACKUP_NOT_READY');
    const bundleRoot = join(root, 'backups', id);
    if (lstatSync(bundleRoot).isSymbolicLink() || realpathSync(bundleRoot) !== bundleRoot) throw new Error('BACKUP_SYMLINK');
    const manifestPath = join(bundleRoot, 'manifest.json');
    if (lstatSync(manifestPath).isSymbolicLink() || lstatSync(manifestPath).size > 16 * 1024 * 1024) throw new Error('BACKUP_MANIFEST_INVALID');
    const bytes = readFileSync(manifestPath);
    const hash = digest(bytes);
    if (hash !== job.manifestHash) throw new Error('BACKUP_MANIFEST_TAMPERED');
    const manifest = BackupManifestSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (manifest.backupId !== id || manifest.lineageId !== lineage) throw new Error('BACKUP_LINEAGE_MISMATCH');
    for (const file of manifest.files) {
      const content = privateFile(bundleRoot, file.path);
      if (content.length !== file.bytes || digest(content) !== file.sha256) throw new Error('BACKUP_FILE_TAMPERED');
      if (file.path.endsWith('.sqlite')) {
        const copy = new DatabaseSync(join(bundleRoot,file.path),{readOnly:true});
        try {
          const check = copy.prepare('PRAGMA quick_check').all();
          if (check.length !== 1 || z.strictObject({quick_check:z.string()}).parse(check[0]).quick_check !== 'ok') throw new Error('BACKUP_SQLITE_INVALID');
        } finally {copy.close();}
      }
    }
    return { manifest, hash, bundleRoot };
  }
  async function create(raw: unknown) {
    const request = z.strictObject({ backupId: BackupIdSchema, scope: z.strictObject({ kind: z.literal('all') }) }).parse(raw);
    const requestHash = digest(JSON.stringify(request.scope));
    const previous = db.prepare('SELECT request_hash FROM backup_jobs WHERE backup_id=?').get(request.backupId);
    if (previous) {
      if (z.strictObject({ request_hash: z.string() }).parse(previous).request_hash !== requestHash) throw new Error('BACKUP_IDEMPOTENCY_REUSE');
      return get(request.backupId);
    }
    if (!input.quiesce) throw new Error('BACKUP_QUIESCE_UNAVAILABLE');
    const job = BackupJobSchema.parse({ backupId: request.backupId, revision: 0, state: 'running', safeCode: null, manifestHash: null });
    db.prepare('INSERT INTO backup_jobs(backup_id,request_hash,job_json) VALUES(?,?,?)').run(request.backupId, requestHash, JSON.stringify(job));
    integrity.seal('backup_jobs','backup_id=?',[request.backupId]);
    const stage = join(root, 'backups', `.staging-${request.backupId}`);
    const destination = join(root, 'backups', request.backupId);
    let hold: Awaited<ReturnType<BackupQuiescePort['acquire']>> | undefined;
    try {
      hold = await input.quiesce.acquire();
      const artifacts = z.array(ArtifactSchema).max(100000).parse(hold.artifacts);
      if (new Set(artifacts.map(item => item.path)).size !== artifacts.length || artifacts.some(item => item.path === 'world.sqlite')) throw new Error('BACKUP_INVENTORY_INVALID');
      mkdirSync(join(root,'backups'), { recursive: true, mode: 0o700 });
      if (lstatSync(join(root,'backups')).isSymbolicLink()) throw new Error('BACKUP_SYMLINK');
      mkdirSync(stage, { mode: 0o700 });
      const fences = db.prepare('SELECT run_id,commit_index,world_revision,last_seq,snapshot_hash FROM world_runs ORDER BY run_id').all().map(row => {
        const parsed = z.strictObject({run_id: z.string(),commit_index:z.number(),world_revision:z.number(),last_seq:z.number(),snapshot_hash:z.string()}).parse(row);
        return BackupFenceSchema.parse({runId: parsed.run_id,commitIndex:parsed.commit_index,worldRevision:parsed.world_revision,lastSeq:parsed.last_seq,snapshotHash:parsed.snapshot_hash});
      });
      const version = z.strictObject({ version: z.number() }).parse(db.prepare('SELECT MAX(version) AS version FROM schema_version').get()).version;
      await backup(db, join(stage, 'world.sqlite'));
      chmodSync(join(stage, 'world.sqlite'), 0o600);
      for (const artifact of artifacts) {
        // Validate file and ancestor containment even when SQLite opens its own handle.
        privateFile(root, artifact.path);
        const target = join(stage, artifact.path);
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
        if (artifact.kind === 'sqlite') {
          if (!artifact.path.endsWith('/memory.sqlite')) throw new Error('BACKUP_INVENTORY_INVALID');
          const source = new DatabaseSync(join(root, artifact.path), { readOnly: true });
          try { await backup(source, target); chmodSync(target,0o600); } finally { source.close(); }
        } else {
          if (artifact.kind === 'session' ? !artifact.path.endsWith('.jsonl') : artifact.kind === 'media' ? !artifact.path.startsWith('media/') : artifact.kind === 'fork-memory' ? !/\/memory\.sqlite(?:-wal)?$/.test(artifact.path) : !/(?:\/(?:package|artifacts|fork-owner)\.json|\/icm-config\.toml)$/.test(artifact.path)) throw new Error('BACKUP_INVENTORY_INVALID');
          durableFile(target, privateFile(root, artifact.path));
        }
      }
      const files = ['world.sqlite', ...artifacts.map(item => item.path)].map(path => {
        const bytes = privateFile(stage, path); return { path, bytes: bytes.length, sha256: digest(bytes) };
      });
      const manifest = BackupManifestSchema.parse({format:'personajes-backup',version:1,backupId:request.backupId,lineageId:lineage,originRootHash:digest(root),createdAt:now(),journalVersion:version,fences,files});
      const manifestJson = JSON.stringify(manifest);
      durableFile(join(stage,'manifest.json'),manifestJson);
      syncDirectory(stage);
      if (existsSync(destination)) throw new Error('BACKUP_DESTINATION_EXISTS');
      renameSync(stage,destination);
      syncDirectory(join(root,'backups'));
      db.prepare('UPDATE backup_jobs SET job_json=? WHERE backup_id=?').run(JSON.stringify({...job,revision:1,state:'succeeded',manifestHash:digest(manifestJson)}),request.backupId);
      integrity.seal('backup_jobs','backup_id=?',[request.backupId]);
      return get(request.backupId);
    } catch (error) {
      rmSync(stage,{recursive:true,force:true});
      const safeCode=error instanceof Error && /^BACKUP_[A-Z_]{1,68}$/.test(error.message)?error.message:'BACKUP_FAILED';
      db.prepare('UPDATE backup_jobs SET job_json=? WHERE backup_id=?').run(JSON.stringify({...job,revision:1,state:'failed',safeCode}),request.backupId);
      integrity.seal('backup_jobs','backup_id=?',[request.backupId]);
      return get(request.backupId);
    } finally { await hold?.release(); }
  }
  function preview(raw: unknown) {
    const request = z.strictObject({backupId:BackupIdSchema,mode:z.enum(['recover','fork'])}).parse(raw);
    const bundle = verify(request.backupId);
    const assessment = input.restore?.preview({manifest:bundle.manifest,mode:request.mode}) ?? {
      differences: bundle.manifest.fences.map(fence => `run:${fence.runId}:seq:${fence.lastSeq}`),
      blockers: [request.mode === 'fork' ? 'RESTORE_FORK_ID_REWRITE_UNAVAILABLE' : 'RESTORE_OFFLINE_OWNERSHIP_UNAVAILABLE',
        ...(bundle.manifest.files.some(file => file.path.endsWith('.jsonl')) ? ['RESTORE_SESSION_PATH_RECONCILIATION_REQUIRED'] : [])], targetFingerprint:'unavailable',
    };
    const diffHash = digest(JSON.stringify({manifestHash:bundle.hash,mode:request.mode,...assessment}));
    const result = RestorePreviewSchema.parse({backupId:request.backupId,mode:request.mode,manifestHash:bundle.hash,diffHash,previewToken:randomUUID(),expiresAt:now()+5*60*1000,differences:assessment.differences,blockers:assessment.blockers});
    db.prepare('INSERT INTO backup_restore_previews(token,preview_json,target_fingerprint) VALUES(?,?,?)').run(result.previewToken,JSON.stringify(result),assessment.targetFingerprint);
    integrity.seal('backup_restore_previews','token=?',[result.previewToken]);
    return result;
  }
  async function restore(raw: unknown) {
    const request = z.strictObject({previewToken:z.uuid(),confirmDiffHash:z.string().regex(/^[a-f0-9]{64}$/),backupId:BackupIdSchema.optional()}).parse(raw);
    integrity.verify('backup_restore_previews','token=?',[request.previewToken]);
    const row = db.prepare('SELECT preview_json,target_fingerprint,used,result_json FROM backup_restore_previews WHERE token=?').get(request.previewToken);
    if (!row) throw new Error('RESTORE_PREVIEW_NOT_FOUND');
    const record = z.strictObject({preview_json:z.string(),target_fingerprint:z.string(),used:z.number(),result_json:z.string().nullable()}).parse(row);
    const p = RestorePreviewSchema.parse(JSON.parse(record.preview_json));
    if(request.backupId!==undefined&&request.backupId!==p.backupId)throw new Error('RESTORE_PREVIEW_TARGET_MISMATCH');
    if (p.diffHash !== request.confirmDiffHash) throw new Error('RESTORE_DIFF_CONFIRMATION_REQUIRED');
    if (record.used) {
      if (record.result_json !== null) return JSON.parse(record.result_json);
      throw new Error('RESTORE_INTERRUPTED_REQUIRES_INSPECTION');
    }
    if (p.expiresAt <= now()) throw new Error('RESTORE_PREVIEW_EXPIRED');
    const bundle = verify(p.backupId);
    if (p.manifestHash !== bundle.hash || p.blockers.length || !input.restore) throw new Error('RESTORE_BLOCKED');
    const current = input.restore.preview({manifest:bundle.manifest,mode:p.mode});
    const currentDiffHash = digest(JSON.stringify({manifestHash:bundle.hash,mode:p.mode,...current}));
    if (current.targetFingerprint !== record.target_fingerprint || current.blockers.length || currentDiffHash !== p.diffHash) throw new Error('RESTORE_TARGET_DIVERGED');
    const claimed = db.prepare('UPDATE backup_restore_previews SET used=1 WHERE token=? AND used=0').run(request.previewToken);
    if (claimed.changes !== 1) throw new Error('RESTORE_ALREADY_CLAIMED');
    integrity.seal('backup_restore_previews','token=?',[request.previewToken]);
    const result = await input.restore.apply({manifest:bundle.manifest,bundleRoot:bundle.bundleRoot,mode:p.mode,targetFingerprint:record.target_fingerprint});
    const json = JSON.stringify(z.json().parse(result));
    db.prepare('UPDATE backup_restore_previews SET result_json=? WHERE token=?').run(json,request.previewToken);
    integrity.seal('backup_restore_previews','token=?',[request.previewToken]);
    return JSON.parse(json);
  }
  return Object.freeze({create,get,verify,preview,restore,close:()=>db.close()});
}
