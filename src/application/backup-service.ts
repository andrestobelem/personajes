import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { backup, DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { BackupFenceSchema, BackupIdSchema, BackupJobSchema, BackupManifestSchema, BackupPathSchema, RestorePreviewSchema, RestorePreviewRequestSchema, RestoreApplyRequestSchema, RestoreIntentSchema, type BackupManifest } from '../domain/backup.ts';
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
export type BackupRestoreContext = {
 manifest:BackupManifest;bundleRoot:string;manifestHash:string;externalRegistrationId?:string;mode:'recover'|'fork';
 principalId:string;operationId:string;sourceRunId?:string;name?:string;reason?:string;
};
export type ExternalBackupPort={resolve(input:{registrationId:string;principalId:string}):{manifest:BackupManifest;hash:string;bundleRoot:string}};
export type BackupRestorePort = {
 preview(input:BackupRestoreContext):{differences:string[];blockers:string[];targetFingerprint:string};
 /** Must be idempotent for operationId. A replay also reads the current durable job. */
 apply(input:BackupRestoreContext & {targetFingerprint:string;confirmDiffHash:string}):Promise<unknown>;
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
    const manifestFd=openSync(manifestPath,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;
    try{const stat=fstatSync(manifestFd);if(!stat.isFile()||stat.nlink!==1||stat.size>16*1024*1024)throw new Error('BACKUP_MANIFEST_INVALID');bytes=readFileSync(manifestFd);}finally{closeSync(manifestFd);}
    const hash = digest(bytes);
    if (hash !== job.manifestHash) throw new Error('BACKUP_MANIFEST_TAMPERED');
    const manifest = BackupManifestSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (manifest.backupId !== id || manifest.lineageId !== lineage) throw new Error('BACKUP_LINEAGE_MISMATCH');
    for (const file of manifest.files) {
      const content = privateFile(bundleRoot, file.path);
      if (content.length !== file.bytes || digest(content) !== file.sha256) throw new Error('BACKUP_FILE_TAMPERED');
    }
    // SQLite read-only WAL handles may create SHM beside the original. Validate
    // authenticated bytes in a disposable private copy, never in the bundle.
    for(const file of manifest.files.filter(item=>item.path.endsWith('.sqlite'))){
      const temporary=mkdtempSync(join(tmpdir(),'personajes-backup-verify-'));
      try{
        const target=join(temporary,'memory.sqlite');const content=privateFile(bundleRoot,file.path);if(content.length!==file.bytes||digest(content)!==file.sha256)throw new Error('BACKUP_FILE_TAMPERED');durableFile(target,content);
        const wal=manifest.files.find(item=>item.path===`${file.path}-wal`);
        if(wal!==undefined){const content=privateFile(bundleRoot,wal.path);if(content.length!==wal.bytes||digest(content)!==wal.sha256)throw new Error('BACKUP_FILE_TAMPERED');durableFile(`${target}-wal`,content);}
        const copy=new DatabaseSync(target,{readOnly:true});
        try{const check=copy.prepare('PRAGMA quick_check').all();if(check.length!==1||z.strictObject({quick_check:z.string()}).parse(check[0]).quick_check!=='ok')throw new Error('BACKUP_SQLITE_INVALID');}
        finally{copy.close();}
      }finally{rmSync(temporary,{recursive:true,force:true});}
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
      if(Buffer.byteLength(manifestJson)>16*1024*1024)throw new Error('BACKUP_MANIFEST_TOO_LARGE');
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
  const StoredRestorePreviewSchema=RestorePreviewSchema.extend({intent:RestoreIntentSchema.optional()});
  const activeRestores=new Map<string,Promise<unknown>>();
  let restorePort=input.restore;let externalBackupPort:ExternalBackupPort|undefined;let closed=false;
  function publicPreview(value:z.infer<typeof StoredRestorePreviewSchema>){const {intent,...publicValue}=value;return RestorePreviewSchema.parse(publicValue);}
  function context(bundle:ReturnType<typeof verify>,intent:z.infer<typeof RestoreIntentSchema>):BackupRestoreContext{
    return {manifest:bundle.manifest,bundleRoot:bundle.bundleRoot,manifestHash:bundle.hash,
      principalId:intent.principalId,operationId:intent.operationId,...(intent.externalRegistrationId===undefined?{}:{externalRegistrationId:intent.externalRegistrationId}),...intent.selection};
  }
  function resolveBackup(request:{backupId:string;principalId:string;externalRegistrationId?:string|undefined;mode:'recover'|'fork'}):ReturnType<typeof verify>{
    if(request.externalRegistrationId===undefined)return verify(request.backupId);
    if(request.mode!=='fork')throw new Error('RESTORE_EXTERNAL_RECOVER_UNAVAILABLE');
    if(externalBackupPort===undefined)throw new Error('RESTORE_EXTERNAL_SOURCE_UNAVAILABLE');
    const registered=externalBackupPort.resolve({registrationId:request.externalRegistrationId,principalId:request.principalId});
    const bundle=z.strictObject({manifest:BackupManifestSchema,hash:z.string().regex(/^[a-f0-9]{64}$/),bundleRoot:z.string().min(1).refine(isAbsolute)}).parse(registered);
    if(bundle.manifest.backupId!==request.backupId)throw new Error('RESTORE_PREVIEW_TARGET_MISMATCH');
    return bundle;
  }
  function assessmentHash(manifestHash:string,intent:z.infer<typeof RestoreIntentSchema>,assessment:{differences:string[];blockers:string[];targetFingerprint:string}){
    return digest(JSON.stringify({manifestHash,intent,...assessment}));
  }
  function preview(raw: unknown) {
    if(closed)throw new Error('RESTORE_SERVICE_CLOSED');const request=RestorePreviewRequestSchema.parse(raw);const bundle=resolveBackup(request);
    const selection=request.mode==='fork'?{mode:request.mode,sourceRunId:request.sourceRunId,name:request.name,reason:request.reason}:{mode:request.mode};
    const idempotencyKey=request.idempotencyKey??randomUUID();
    const previous=db.prepare("SELECT token,preview_json FROM backup_restore_previews WHERE json_extract(preview_json,'$.intent.principalId')=? AND json_extract(preview_json,'$.intent.idempotencyKey')=? LIMIT 2").all(request.principalId,idempotencyKey);
    if(previous.length>1)throw new Error('RESTORE_IDEMPOTENCY_REUSE');
    if(previous.length===1){
      const row=z.strictObject({token:z.uuid(),preview_json:z.string()}).parse(previous[0]);integrity.verify('backup_restore_previews','token=?',[row.token]);
      const existing=StoredRestorePreviewSchema.parse(JSON.parse(row.preview_json));
      if(existing.backupId!==request.backupId||existing.manifestHash!==bundle.hash||existing.externalRegistrationId!==request.externalRegistrationId||existing.intent===undefined||JSON.stringify(existing.intent.selection)!==JSON.stringify(selection))throw new Error('RESTORE_IDEMPOTENCY_REUSE');
      return publicPreview(existing);
    }
    const intent=RestoreIntentSchema.parse({operationId:randomUUID(),principalId:request.principalId,selection,idempotencyKey,...(request.externalRegistrationId===undefined?{}:{externalRegistrationId:request.externalRegistrationId})});
    const assessment=restorePort?.preview(context(bundle,intent))??{
      differences:bundle.manifest.fences.map(fence=>`run:${fence.runId}:seq:${fence.lastSeq}`),
      blockers:[request.mode==='fork'?'RESTORE_FORK_ID_REWRITE_UNAVAILABLE':'RESTORE_OFFLINE_OWNERSHIP_UNAVAILABLE',
        ...(bundle.manifest.files.some(file=>file.path.endsWith('.jsonl'))?['RESTORE_SESSION_PATH_RECONCILIATION_REQUIRED']:[])],targetFingerprint:'unavailable',
    };
    const diffHash=assessmentHash(bundle.hash,intent,assessment);
    const result=StoredRestorePreviewSchema.parse({backupId:request.backupId,...(intent.externalRegistrationId===undefined?{}:{externalRegistrationId:intent.externalRegistrationId}),...intent.selection,operationId:intent.operationId,manifestHash:bundle.hash,diffHash,previewToken:randomUUID(),expiresAt:now()+5*60*1000,differences:assessment.differences,blockers:assessment.blockers,intent});
    // This sealed intent precedes every external effect and survives claim/apply crashes.
    db.prepare('INSERT INTO backup_restore_previews(token,preview_json,target_fingerprint) VALUES(?,?,?)').run(result.previewToken,JSON.stringify(result),assessment.targetFingerprint);
    integrity.seal('backup_restore_previews','token=?',[result.previewToken]);return publicPreview(result);
  }
  async function restore(raw:unknown):Promise<unknown>{
    if(closed)throw new Error('RESTORE_SERVICE_CLOSED');const request=RestoreApplyRequestSchema.parse(raw);integrity.verify('backup_restore_previews','token=?',[request.previewToken]);
    const row=db.prepare('SELECT preview_json,target_fingerprint,used,result_json FROM backup_restore_previews WHERE token=?').get(request.previewToken);
    if(!row)throw new Error('RESTORE_PREVIEW_NOT_FOUND');
    const record=z.strictObject({preview_json:z.string(),target_fingerprint:z.string(),used:z.number(),result_json:z.string().nullable()}).parse(row);
    const p=StoredRestorePreviewSchema.parse(JSON.parse(record.preview_json));
    if(p.intent===undefined)throw new Error('RESTORE_LEGACY_PREVIEW_RECREATE');
    if(p.intent.principalId!==request.principalId)throw new Error('RESTORE_PREVIEW_NOT_FOUND');
    if(p.intent.externalRegistrationId!==p.externalRegistrationId)throw new Error('RESTORE_INTENT_INVALID');
    if(request.externalRegistrationId!==p.intent.externalRegistrationId)throw new Error('RESTORE_PREVIEW_TARGET_MISMATCH');
    if(p.intent.selection.mode!==p.mode||p.intent.operationId!==p.operationId||(p.intent.selection.mode==='fork'&&(p.intent.selection.sourceRunId!==p.sourceRunId||p.intent.selection.name!==p.name||p.intent.selection.reason!==p.reason)))throw new Error('RESTORE_INTENT_INVALID');
    if(request.backupId!==undefined&&request.backupId!==p.backupId)throw new Error('RESTORE_PREVIEW_TARGET_MISMATCH');
    if(p.diffHash!==request.confirmDiffHash)throw new Error('RESTORE_DIFF_CONFIRMATION_REQUIRED');
    const pending=activeRestores.get(p.previewToken);if(pending!==undefined)return pending;
    // Recovery mode may have an offline-only implementation with a final cached result.
    if(record.used&&record.result_json!==null&&p.mode==='recover')return z.json().parse(JSON.parse(record.result_json));
    if(!record.used&&p.expiresAt<=now())throw new Error('RESTORE_PREVIEW_EXPIRED');
    const bundle=resolveBackup({backupId:p.backupId,principalId:p.intent.principalId,mode:p.intent.selection.mode,...(p.intent.externalRegistrationId===undefined?{}:{externalRegistrationId:p.intent.externalRegistrationId})});
    if(p.manifestHash!==bundle.hash||p.blockers.length||!restorePort)throw new Error('RESTORE_BLOCKED');
    const selected=context(bundle,p.intent);const port=restorePort;
    if(!record.used){
      const current=port.preview(selected);const currentDiffHash=assessmentHash(bundle.hash,p.intent,current);
      if(current.targetFingerprint!==record.target_fingerprint||current.blockers.length||currentDiffHash!==p.diffHash)throw new Error('RESTORE_TARGET_DIVERGED');
      const claimed=db.prepare('UPDATE backup_restore_previews SET used=1 WHERE token=? AND used=0').run(p.previewToken);
      if(claimed.changes!==1)throw new Error('RESTORE_ALREADY_CLAIMED');integrity.seal('backup_restore_previews','token=?',[p.previewToken]);
    }
    // Once claimed, expiry/target changes must not strand the original operation.
    // apply verifies/reuses the same operation rather than choosing a new target.
    const work=Promise.resolve().then(async()=>{
      const result=await port.apply({...selected,targetFingerprint:record.target_fingerprint,confirmDiffHash:p.diffHash});const json=JSON.stringify(z.json().parse(result));
      db.prepare('UPDATE backup_restore_previews SET result_json=? WHERE token=?').run(json,p.previewToken);integrity.seal('backup_restore_previews','token=?',[p.previewToken]);return JSON.parse(json);
    });
    activeRestores.set(p.previewToken,work);
    try{return await work;}finally{if(activeRestores.get(p.previewToken)===work)activeRestores.delete(p.previewToken);}
  }
  /** Replays only already claimed intents; never accepts an unconfirmed preview. */
  async function recoverRestores(){
    if(closed)throw new Error('RESTORE_SERVICE_CLOSED');if(!restorePort)throw new Error('RESTORE_PORT_UNAVAILABLE');
    const rows=db.prepare('SELECT token,preview_json FROM backup_restore_previews WHERE used=1 AND result_json IS NULL ORDER BY token LIMIT 100001').all();
    if(rows.length>100000)throw new Error('RESTORE_RECOVERY_LIMIT');
    const requests=rows.map(raw=>{const row=z.strictObject({token:z.uuid(),preview_json:z.string()}).parse(raw);integrity.verify('backup_restore_previews','token=?',[row.token]);const p=StoredRestorePreviewSchema.parse(JSON.parse(row.preview_json));return {row,p};});
    return await Promise.all(requests.map(async({row,p})=>{
      if(p.intent===undefined)return {previewToken:row.token,status:'legacy-preview' as const};
      try{await restore({previewToken:row.token,confirmDiffHash:p.diffHash,principalId:p.intent.principalId,backupId:p.backupId,...(p.intent.externalRegistrationId===undefined?{}:{externalRegistrationId:p.intent.externalRegistrationId})});return {previewToken:row.token,status:'resumed' as const};}
      catch(error){return {previewToken:row.token,status:'failed' as const,code:error instanceof Error&&/^RESTORE_[A-Z_]+$/.test(error.message)?error.message:'RESTORE_RECOVERY_FAILED'};}
    }));
  }
  return Object.freeze({create,get,verify,preview,restore,recoverRestores,
    setExternalBackupPort(port:ExternalBackupPort){if(closed||externalBackupPort)throw new Error('RESTORE_EXTERNAL_SOURCE_ALREADY_CONFIGURED');externalBackupPort=port;},
    setRestorePort(port:BackupRestorePort){if(closed||restorePort)throw new Error('RESTORE_PORT_ALREADY_CONFIGURED');restorePort=port;},
    async waitForRestores(){while(activeRestores.size>0)await Promise.allSettled([...activeRestores.values()]);},
    close(){if(activeRestores.size>0)throw new Error('RESTORE_OPERATIONS_ACTIVE');if(closed)return;closed=true;db.close();},
  });
}
