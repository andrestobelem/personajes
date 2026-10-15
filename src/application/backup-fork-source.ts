import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { openJournal } from '../adapters/journal.ts';
import { hashContinuistaValue } from '../domain/continuista-review.ts';
import { BackupManifestSchema } from '../domain/backup.ts';
import { HashSchema, RunIdSchema } from '../domain/values.ts';
import { BackupForkSourceSchema } from './fork-source.ts';
import type { openLocalHost } from './local-host.ts';

const RequestSchema = z.strictObject({ manifest: BackupManifestSchema, manifestHash: HashSchema, bundleRoot: z.string().min(1), sourceRunId: RunIdSchema });
const MAX_JOURNAL_BYTES = 256 * 1024 * 1024;
/** The immutable registered bundle is never opened by SQLite. Migrations and
 * read-side sidecars belong to a disposable private working copy only. */
export function readBackupForkSource(input: { host: ReturnType<typeof openLocalHost>; request: unknown }) {
  const request = RequestSchema.parse(input.request);
  const root = input.host.privateDataRoot;
  const bundle = join(root, 'backups', request.manifest.backupId);
  if (request.bundleRoot !== bundle) throw new Error('RESTORE_BUNDLE_SCOPE_INVALID');
  const journalFile = request.manifest.files.find(file => file.path === 'world.sqlite');
  const fence = request.manifest.fences.find(item => item.runId === request.sourceRunId);
  if (journalFile === undefined || fence === undefined) throw new Error('RESTORE_SOURCE_NOT_FOUND');
  const sourcePath = join(bundle, 'world.sqlite');
  for (let path = bundle; path !== root; path = dirname(path)) {
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory() || realpathSync(path) !== path) throw new Error('RESTORE_BUNDLE_PATH_INVALID');
  }
  // A journal snapshot in a backup has no external WAL. Unregistered sidecars
  // must not participate in validation or in the subsequent working copy.
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { lstatSync(sourcePath + suffix); throw new Error('RESTORE_JOURNAL_SIDECAR_INVALID'); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  }
  const descriptor = openSync(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_JOURNAL_BYTES || stat.size !== journalFile.bytes) throw new Error('RESTORE_JOURNAL_FILE_INVALID');
    bytes = readFileSync(descriptor);
    if (createHash('sha256').update(bytes).digest('hex') !== journalFile.sha256) throw new Error('RESTORE_JOURNAL_HASH_MISMATCH');
  } finally { closeSync(descriptor); }
  const readers = join(root, 'restore-readers');
  try { mkdirSync(readers, { mode: 0o700 }); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error; }
  if (lstatSync(readers).isSymbolicLink() || !lstatSync(readers).isDirectory() || realpathSync(readers) !== readers) throw new Error('RESTORE_READER_PATH_INVALID');
  const work = mkdtempSync(join(readers, 'source-'));
  let journal: ReturnType<typeof openJournal> | undefined;
  try {
    const copy = join(work, `${randomUUID()}.sqlite`);
    writeFileSync(copy, bytes, { flag: 'wx', mode: 0o600 });
    journal = openJournal({ path: copy });
    const source = journal.readForkSource({ runId: fence.runId, commitIndex: fence.commitIndex, worldRevision: fence.worldRevision, worldSeq: fence.lastSeq });
    if (source.kind !== 'found') throw new Error(source.kind === 'unavailable' && source.reason === 'checkpoint-not-recorded' ? 'RESTORE_CHECKPOINT_UNAVAILABLE' : 'RESTORE_SOURCE_INVALID');
    if (hashContinuistaValue(source.snapshot) !== fence.snapshotHash || source.cuts.some(cut => cut.source.snapshotHash !== fence.snapshotHash)) throw new Error('RESTORE_SOURCE_FENCE_MISMATCH');
    const { kind, ...state } = source; void kind;
    return BackupForkSourceSchema.parse({ kind: 'backup-fork-source', backup: {
      backupId: request.manifest.backupId, lineageId: request.manifest.lineageId, manifestHash: request.manifestHash, journalHash: journalFile.sha256,
    }, ...state });
  } finally { try { journal?.close(); } finally { rmSync(work, { recursive: true, force: true }); } }
}
