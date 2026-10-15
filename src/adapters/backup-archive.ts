import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, type FileHandle } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { BackupManifestSchema, type BackupManifest } from '../domain/backup.ts';
import { HashSchema } from '../domain/values.ts';

const MAGIC = Buffer.from('PERSONAJES-BACKUP/1\n');
const CHUNK = 1024 * 1024;
type Limits = { maxArchiveBytes?: number; maxFileBytes?: number; maxManifestBytes?: number };
function limits(input: Limits) {
 const values = { archive: input.maxArchiveBytes ?? 1024 ** 3, file: input.maxFileBytes ?? 256 * 1024 ** 2, manifest: input.maxManifestBytes ?? 16 * 1024 ** 2 };
 for (const value of Object.values(values)) if (!Number.isSafeInteger(value) || value < 1) throw new Error('BACKUP_ARCHIVE_LIMIT_INVALID');
 if (values.manifest > 16 * 1024 ** 2 || values.file > 256 * 1024 ** 2) throw new Error('BACKUP_ARCHIVE_LIMIT_INVALID');
 return values;
}
async function directories(path: string) {
 const absolute = resolve(path); let current = parse(absolute).root;
 for (const segment of absolute.slice(current.length).split('/').filter(Boolean)) {
  current = join(current, segment); const stat = await lstat(current);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('BACKUP_ARCHIVE_DIRECTORY_INVALID');
 }
}
async function regular(path: string): Promise<FileHandle> {
 await directories(dirname(path)); const before = await lstat(path);
 if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error('BACKUP_ARCHIVE_FILE_INVALID');
 const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
 try {
  const after = await file.stat();
  if (!after.isFile() || after.nlink !== 1 || before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size) throw new Error('BACKUP_ARCHIVE_FILE_CHANGED');
  return file;
 } catch (error) { await file.close(); throw error; }
}
async function syncDirectory(path: string) { const file = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { await file.sync(); } finally { await file.close(); } }
async function write(file: FileHandle, bytes: Uint8Array) { let offset = 0; while (offset < bytes.length) { const result = await file.write(bytes, offset, Math.min(CHUNK, bytes.length - offset)); if (!result.bytesWritten) throw new Error('BACKUP_ARCHIVE_WRITE_FAILED'); offset += result.bytesWritten; } }
function manifestFrom(bytes: Uint8Array) { return BackupManifestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
function totalSize(manifest: BackupManifest, manifestBytes: number, bounds: ReturnType<typeof limits>) {
 if (manifestBytes < 1 || manifestBytes > bounds.manifest) throw new Error('BACKUP_ARCHIVE_MANIFEST_TOO_LARGE');
 let total = MAGIC.length + 4 + manifestBytes;
 for (const file of manifest.files) { if (file.bytes > bounds.file) throw new Error('BACKUP_ARCHIVE_FILE_TOO_LARGE'); total += file.bytes; if (!Number.isSafeInteger(total) || total > bounds.archive) throw new Error('BACKUP_ARCHIVE_TOO_LARGE'); }
 if (total > bounds.archive) throw new Error('BACKUP_ARCHIVE_TOO_LARGE');
 return total;
}
async function inventory(root: string, manifest: BackupManifest) {
 const files = new Set(['manifest.json', ...manifest.files.map(file => file.path)]);
 const dirs = new Set<string>(); for (const file of files) { let parent = dirname(file); while (parent !== '.') { dirs.add(parent); parent = dirname(parent); } }
 async function visit(relative: string): Promise<void> {
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
   const name = relative ? `${relative}/${entry.name}` : entry.name; const stat = await lstat(join(root, name));
   if (stat.isDirectory() && !stat.isSymbolicLink() && dirs.has(name)) await visit(name);
   else if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !files.delete(name)) throw new Error('BACKUP_ARCHIVE_INVENTORY_INVALID');
  }
 }
 await directories(root); await visit(''); if (files.size) throw new Error('BACKUP_ARCHIVE_INVENTORY_INVALID');
}

/** Host-only codec. No SQLite connection, compression, or invented inventory entries. */
export async function writeBackupArchive(input: Limits & { bundleRoot: string; manifest: BackupManifest; manifestHash: string; archivePath: string }): Promise<{ bytes: number; sha256: string }> {
 const bounds = limits(input); const manifest = BackupManifestSchema.parse(input.manifest); const manifestHash = HashSchema.parse(input.manifestHash);
 const source = await regular(join(input.bundleRoot, 'manifest.json')); let raw: Buffer;
 try { const size = (await source.stat()).size; if (size < 1 || size > bounds.manifest) throw new Error('BACKUP_ARCHIVE_MANIFEST_TOO_LARGE'); raw = Buffer.alloc(size); let offset = 0; while (offset < size) { const read = await source.read(raw, offset, Math.min(CHUNK, size - offset), offset); if (!read.bytesRead) throw new Error('BACKUP_ARCHIVE_TRUNCATED'); offset += read.bytesRead; } }
 finally { await source.close(); }
 if (createHash('sha256').update(raw).digest('hex') !== manifestHash || JSON.stringify(manifestFrom(raw)) !== JSON.stringify(manifest)) throw new Error('BACKUP_ARCHIVE_MANIFEST_MISMATCH');
 const bytes = totalSize(manifest, raw.length, bounds); await inventory(input.bundleRoot, manifest); await directories(dirname(input.archivePath));
 const target = await open(input.archivePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); const digest = createHash('sha256');
 async function emit(chunk: Uint8Array) { await write(target, chunk); digest.update(chunk); }
 try {
  const length = Buffer.alloc(4); length.writeUInt32BE(raw.length); await emit(MAGIC); await emit(length); await emit(raw);
  const buffer = Buffer.alloc(CHUNK);
  for (const entry of manifest.files) {
   const file = await regular(join(input.bundleRoot, entry.path));
   try {
    if ((await file.stat()).size !== entry.bytes) throw new Error('BACKUP_ARCHIVE_SIZE_MISMATCH');
    const hash = createHash('sha256'); let offset = 0;
    while (offset < entry.bytes) { const result = await file.read(buffer, 0, Math.min(CHUNK, entry.bytes - offset), offset); if (!result.bytesRead) throw new Error('BACKUP_ARCHIVE_TRUNCATED'); const chunk = buffer.subarray(0, result.bytesRead); hash.update(chunk); await emit(chunk); offset += result.bytesRead; }
    if ((await file.stat()).size !== entry.bytes || hash.digest('hex') !== entry.sha256) throw new Error('BACKUP_ARCHIVE_HASH_MISMATCH');
   } finally { await file.close(); }
  }
  await inventory(input.bundleRoot, manifest); await target.sync();
 } finally { await target.close(); }
 await syncDirectory(dirname(input.archivePath)); return { bytes, sha256: digest.digest('hex') };
}

export async function extractBackupArchive(input: Limits & { archivePath: string; stageRoot: string }): Promise<{ manifest: BackupManifest; manifestHash: string; archiveSha256: string; bytes: number }> {
 const bounds = limits(input); const archive = await regular(input.archivePath); const digest = createHash('sha256'); let position = 0;
 async function readExact(length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length); let offset = 0;
  while (offset < length) { const result = await archive.read(buffer, offset, Math.min(CHUNK, length - offset), position); if (!result.bytesRead) throw new Error('BACKUP_ARCHIVE_TRUNCATED'); const chunk = buffer.subarray(offset, offset + result.bytesRead); digest.update(chunk); offset += result.bytesRead; position += result.bytesRead; }
  return buffer;
 }
 try {
  const size = (await archive.stat()).size; if (!Number.isSafeInteger(size) || size > bounds.archive) throw new Error('BACKUP_ARCHIVE_TOO_LARGE');
  if (!(await readExact(MAGIC.length)).equals(MAGIC)) throw new Error('BACKUP_ARCHIVE_FORMAT_INVALID');
  const length = (await readExact(4)).readUInt32BE(); if (length < 1 || length > bounds.manifest) throw new Error('BACKUP_ARCHIVE_MANIFEST_TOO_LARGE');
  const raw = await readExact(length); const manifest = manifestFrom(raw); const total = totalSize(manifest, length, bounds);
  if (size !== total) throw new Error(size > total ? 'BACKUP_ARCHIVE_TRAILING_BYTES' : 'BACKUP_ARCHIVE_TRUNCATED');
  await directories(dirname(input.stageRoot)); await mkdir(input.stageRoot, { mode: 0o700 });
  const createdDirs = new Set([resolve(input.stageRoot)]);
  async function createParent(relative: string) {
   let current = resolve(input.stageRoot);
   for (const segment of dirname(relative).split('/').filter(value => value !== '.')) { current = join(current, segment); if (!createdDirs.has(current)) { await mkdir(current, { mode: 0o700 }); createdDirs.add(current); } }
   await directories(current);
  }
  async function createFile(relative: string, consume: (file: FileHandle) => Promise<void>) {
   await createParent(relative); const file = await open(join(input.stageRoot, relative), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
   try { await consume(file); await file.sync(); } finally { await file.close(); }
  }
  await createFile('manifest.json', file => write(file, raw));
  for (const entry of manifest.files) {
   await createFile(entry.path, async file => { const hash = createHash('sha256'); let remaining = entry.bytes;
    while (remaining) { const chunk = await readExact(Math.min(CHUNK, remaining)); hash.update(chunk); await write(file, chunk); remaining -= chunk.length; }
    if (hash.digest('hex') !== entry.sha256) throw new Error('BACKUP_ARCHIVE_HASH_MISMATCH');
   });
  }
  const end = Buffer.alloc(1); if ((await archive.read(end, 0, 1, position)).bytesRead || (await archive.stat()).size !== size) throw new Error('BACKUP_ARCHIVE_TRAILING_BYTES');
  await inventory(input.stageRoot, manifest);
  for (const directory of [...createdDirs].reverse()) await syncDirectory(directory); await syncDirectory(dirname(input.stageRoot));
  return { manifest, manifestHash: createHash('sha256').update(raw).digest('hex'), archiveSha256: digest.digest('hex'), bytes: position };
 } finally { await archive.close(); }
}
