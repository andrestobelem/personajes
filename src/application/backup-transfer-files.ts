import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export function directory(path: string): void {
 const absolute = resolve(path); let current = parse(absolute).root;
 for (const segment of absolute.slice(current.length).split('/').filter(Boolean)) {
  current = join(current, segment); const stat = lstatSync(current);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('BACKUP_TRANSFER_DIRECTORY_INVALID');
 }
}
export function privateDirectory(path: string): void {
 directory(dirname(path));
 try { mkdirSync(path, { mode: 0o700 }); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error; }
 const stat = lstatSync(path); const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
 if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (uid !== undefined && stat.uid !== uid) || realpathSync(path) !== path) throw new Error('BACKUP_TRANSFER_DIRECTORY_INVALID');
}
export function regular(path: string, flags = constants.O_RDONLY): number {
 directory(dirname(path)); const before = lstatSync(path); const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
 if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || (before.mode & 0o077) !== 0 || (uid !== undefined && before.uid !== uid)) throw new Error('BACKUP_TRANSFER_FILE_INVALID');
 const fd = openSync(path, flags | constants.O_NOFOLLOW);
 try { const after = fstatSync(fd); if (!after.isFile() || after.nlink !== 1 || after.ino !== before.ino || after.dev !== before.dev) throw new Error('BACKUP_TRANSFER_FILE_CHANGED'); return fd; }
 catch (error) { closeSync(fd); throw error; }
}
export function syncDirectory(path: string): void { directory(path); const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
export function boundedFile(path: string, maxBytes: number): Buffer { const fd = regular(path); try { if (fstatSync(fd).size > maxBytes) throw new Error('BACKUP_TRANSFER_FILE_TOO_LARGE'); return readFileSync(fd); } finally { closeSync(fd); } }
export function hashFile(path: string, maxBytes: number): { bytes: number; sha256: string } {
 const fd = regular(path); try {
  const stat = fstatSync(fd); if (stat.size > maxBytes) throw new Error('BACKUP_TRANSFER_FILE_TOO_LARGE');
  // File hashing is streaming; the archive itself never becomes an in-memory body.
  const hash = createHash('sha256'); const buffer = Buffer.alloc(1024 * 1024);
  let offset = 0;
  // readFileSync is deliberately not used for potentially GiB archives.
  while (offset < stat.size) {
   const count = readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
   if (!count) throw new Error('BACKUP_TRANSFER_FILE_CHANGED'); hash.update(buffer.subarray(0, count)); offset += count;
  }
  if (fstatSync(fd).size !== stat.size) throw new Error('BACKUP_TRANSFER_FILE_CHANGED');
  return { bytes: stat.size, sha256: hash.digest('hex') };
 } finally { closeSync(fd); }
}
export function exactInventory(path: string, allowed: ReadonlySet<string>): void {
 directory(path);
 for (const entry of readdirSync(path)) if (!allowed.has(entry)) throw new Error('BACKUP_TRANSFER_INVENTORY_INVALID');
}
