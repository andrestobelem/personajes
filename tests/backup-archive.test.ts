import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { extractBackupArchive, writeBackupArchive } from '../src/adapters/backup-archive.ts';
import { BackupManifestSchema } from '../src/domain/backup.ts';

const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const magic = Buffer.from('PERSONAJES-BACKUP/1\n');
async function fixture() {
 const root = await mkdtemp(join(tmpdir(), 'personajes-archive-')); const bundleRoot = join(root, 'bundle'); await mkdir(bundleRoot, { mode: 0o700 });
 const run = randomUUID(); const fork = randomUUID();
 const entries = [
  { path: 'world.sqlite', data: Buffer.from('SQLite bytes, preserved without opening') },
  { path: `runs/${run}/actors/max/memory.sqlite`, data: Buffer.from('ICM sqlite') },
  { path: `runs/${run}/actors/max/memory.sqlite-wal`, data: Buffer.from('uncheckpointed WAL') },
  { path: `runs/${run}/actors/max/icm-config.toml`, data: Buffer.from('database = "memory.sqlite"\n') },
  { path: `runs/${run}/actors/max/sessions/chat_1.jsonl`, data: Buffer.from('{"text":"¿Hola?"}\n') },
  { path: `runs/${run}/roles/director/sessions/director-1.jsonl`, data: Buffer.from('{"turn":1}\n') },
  { path: `media/${randomUUID()}.mp3`, data: Buffer.from([0, 255, 13, 10, 33]) },
  { path: `forks/${fork}/package.json`, data: Buffer.from('{"immutable":true}') },
  { path: `forks/${fork}/artifacts.json`, data: Buffer.from('{}') },
  { path: `forks/${fork}/staging/runs/${run}/actors/max/memory.sqlite-wal`, data: Buffer.from('staging WAL') },
  { path: `forks/${fork}/staging/runs/${run}/fork-owner.json`, data: Buffer.from('{"owner":true}') },
 ];
 for (const entry of entries) { await mkdir(dirname(join(bundleRoot, entry.path)), { recursive: true, mode: 0o700 }); await writeFile(join(bundleRoot, entry.path), entry.data, { mode: 0o600 }); }
 const manifest = BackupManifestSchema.parse({ format: 'personajes-backup', version: 1, backupId: randomUUID(), lineageId: randomUUID(), createdAt: 123, journalVersion: 37, fences: [], files: entries.map(entry => ({ path: entry.path, bytes: entry.data.length, sha256: sha(entry.data) })) });
 const raw = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`); await writeFile(join(bundleRoot, 'manifest.json'), raw);
 const archivePath = join(root, 'export.pba'); const stageRoot = join(root, 'import');
 return { root, bundleRoot, manifest, raw, manifestHash: sha(raw), archivePath, stageRoot, entries, cleanup: () => rm(root, { recursive: true, force: true }) };
}
async function customArchive(root: string, manifest: unknown, suffix: Buffer = Buffer.alloc(0)) {
 const raw = Buffer.from(JSON.stringify(manifest)); const length = Buffer.alloc(4); length.writeUInt32BE(raw.length); const path = join(root, `bad-${randomUUID()}.pba`); await writeFile(path, Buffer.concat([magic, length, raw, suffix])); return path;
}

test('roundtrip conserva manifiesto original, orden, sesiones, ICM, WAL, media y staging byte por byte', async () => {
 const f = await fixture(); try {
  const exported = await writeBackupArchive(f); const result = await extractBackupArchive(f);
  assert.equal(result.bytes, exported.bytes); assert.equal(result.archiveSha256, exported.sha256); assert.equal(result.manifestHash, f.manifestHash); assert.deepEqual(result.manifest, f.manifest);
  assert.deepEqual(await readFile(join(f.stageRoot, 'manifest.json')), f.raw);
  for (const entry of f.entries) assert.deepEqual(await readFile(join(f.stageRoot, entry.path)), entry.data);
  assert.equal((await stat(f.archivePath)).mode & 0o777, 0o600); assert.equal((await stat(f.stageRoot)).mode & 0o777, 0o700);
  const archive = await readFile(f.archivePath); assert.equal(sha(archive), exported.sha256); assert.deepEqual(archive.subarray(magic.length + 4, magic.length + 4 + f.raw.length), f.raw);
  assert.deepEqual(archive.subarray(magic.length + 4 + f.raw.length), Buffer.concat(f.entries.map(entry => entry.data)));
  await assert.rejects(writeBackupArchive(f), /EEXIST/); await assert.rejects(extractBackupArchive(f), /EEXIST/);
 } finally { await f.cleanup(); }
});

test('streaming de más de 32 MiB sin cargar archivo ni contenedor completos', async () => {
 const f = await fixture(); try {
  const file = await open(join(f.bundleRoot, 'world.sqlite'), 'w'); const block = Buffer.alloc(1024 * 1024, 0x5a); const digest = createHash('sha256');
  try { for (let index = 0; index < 34; index++) { await file.write(block); digest.update(block); } } finally { await file.close(); }
  const first = f.manifest.files[0]; assert.ok(first); first.bytes = 34 * block.length; const largeFile = BackupManifestSchema.parse({ ...f.manifest, files: [{ ...first, sha256: digest.digest('hex') }] }).files[0]; assert.ok(largeFile); first.sha256 = largeFile.sha256;
  const raw = Buffer.from(JSON.stringify(f.manifest)); await writeFile(join(f.bundleRoot, 'manifest.json'), raw);
  const exported = await writeBackupArchive({ ...f, manifestHash: sha(raw) }); const imported = await extractBackupArchive(f);
  assert.equal(imported.archiveSha256, exported.sha256); assert.ok(exported.bytes > 32 * 1024 ** 2); assert.equal((await stat(join(f.stageRoot, 'world.sqlite'))).size, 34 * block.length);
  const actual = createHash('sha256'); const handle = await open(join(f.stageRoot, 'world.sqlite')); try { const buffer = Buffer.alloc(1024 * 1024); for (;;) { const read = await handle.read(buffer); if (!read.bytesRead) break; actual.update(buffer.subarray(0, read.bytesRead)); } } finally { await handle.close(); }
  assert.equal(actual.digest('hex'), first.sha256);
 } finally { await f.cleanup(); }
});

test('rechaza hashes alterados y conserva staging parcial sin publicar éxito', async () => {
 const f = await fixture(); try {
  await writeBackupArchive(f); const fd = await open(f.archivePath, 'r+'); try { await fd.write(Buffer.from([99]), 0, 1, magic.length + 4 + f.raw.length); } finally { await fd.close(); }
  await assert.rejects(extractBackupArchive(f), /HASH_MISMATCH/); assert.ok((await lstat(f.stageRoot)).isDirectory()); assert.deepEqual(await readFile(join(f.stageRoot, 'manifest.json')), f.raw);
  await assert.rejects(writeBackupArchive({ ...f, archivePath: join(f.root, 'other.pba'), manifestHash: 'a'.repeat(64) }), /MANIFEST_MISMATCH/);
 } finally { await f.cleanup(); }
});

test('rechaza EOF extra, archivo truncado, magic y UTF8 inválidos', async () => {
 const f = await fixture(); try {
  await writeBackupArchive(f); const bytes = await readFile(f.archivePath);
  for (const [index, bad] of [Buffer.concat([bytes, Buffer.from('x')]), bytes.subarray(0, -1), Buffer.from('WRONG'), Buffer.concat([magic, Buffer.from([0, 0, 0, 1, 255])])].entries()) {
   const archivePath = join(f.root, `bad-${index}`); await writeFile(archivePath, bad); await assert.rejects(extractBackupArchive({ archivePath, stageRoot: join(f.root, `out-${index}`) }));
  }
  assert.deepEqual((await readdir(f.root)).filter(name => name.startsWith('out-')), []);
 } finally { await f.cleanup(); }
});

test('rechaza rutas escapadas, duplicados, campos extra e inventario abierto', async () => {
 const f = await fixture(); try {
  const first = f.manifest.files[0]; assert.ok(first);
  for (const bad of [{ ...f.manifest, files: [{ ...first, path: '../escape' }] }, { ...f.manifest, files: [first, first] }, { ...f.manifest, surprise: true }]) {
   const archivePath = await customArchive(f.root, bad); await assert.rejects(extractBackupArchive({ archivePath, stageRoot: f.stageRoot }));
  }
  await writeFile(join(f.bundleRoot, 'unexpected'), 'x'); await assert.rejects(writeBackupArchive(f), /INVENTORY_INVALID/);
  await rm(join(f.bundleRoot, 'unexpected')); await mkdir(join(f.bundleRoot, 'unexpected')); await assert.rejects(writeBackupArchive(f), /INVENTORY_INVALID/);
 } finally { await f.cleanup(); }
});

test('rechaza enlaces simbólicos, duros y archivos no regulares en todas las fronteras', async () => {
 const f = await fixture(); try {
  await writeBackupArchive(f); await symlink(f.archivePath, join(f.root, 'symlink')); await link(f.archivePath, join(f.root, 'hardlink'));
  await assert.rejects(extractBackupArchive({ archivePath: join(f.root, 'symlink'), stageRoot: f.stageRoot }), /FILE_INVALID/);
  await assert.rejects(extractBackupArchive({ archivePath: join(f.root, 'hardlink'), stageRoot: f.stageRoot }), /FILE_INVALID/); await rm(join(f.root, 'hardlink'));
  await assert.rejects(extractBackupArchive({ archivePath: f.bundleRoot, stageRoot: f.stageRoot }), /FILE_INVALID/);
  await symlink(f.root, join(f.root, 'alias')); await assert.rejects(extractBackupArchive({ ...f, stageRoot: join(f.root, 'alias', 'stage') }), /DIRECTORY_INVALID/);
  const world = join(f.bundleRoot, 'world.sqlite'); await link(world, join(f.root, 'linked-world')); await assert.rejects(writeBackupArchive({ ...f, archivePath: join(f.root, 'other') }), /INVENTORY_INVALID/); await rm(join(f.root, 'linked-world'));
  await rm(world); await symlink(f.archivePath, world); await assert.rejects(writeBackupArchive({ ...f, archivePath: join(f.root, 'other') }), /INVENTORY_INVALID/);
  await rm(world); await mkdir(world); await assert.rejects(writeBackupArchive({ ...f, archivePath: join(f.root, 'other') }), /INVENTORY_INVALID/);
 } finally { await f.cleanup(); }
});

test('límites declarados y reales bloquean antes de crear staging; opciones inválidas fallan cerradas', async () => {
 const f = await fixture(); try {
  const exported = await writeBackupArchive(f);
  for (const option of [{ maxArchiveBytes: exported.bytes - 1 }, { maxFileBytes: 1 }, { maxManifestBytes: 1 }, { maxArchiveBytes: NaN }, { maxArchiveBytes: Number.MAX_SAFE_INTEGER + 1 }, { maxFileBytes: 256 * 1024 ** 2 + 1 }]) {
   await assert.rejects(extractBackupArchive({ ...f, ...option })); await assert.rejects(writeBackupArchive({ ...f, archivePath: join(f.root, 'limited'), ...option }));
  }
  await assert.rejects(lstat(f.stageRoot), /ENOENT/);
  const first = f.manifest.files[0]; assert.ok(first); const archivePath = await customArchive(f.root, { ...f.manifest, files: [{ ...first, bytes: 256 * 1024 ** 2 + 1 }] });
  await assert.rejects(extractBackupArchive({ archivePath, stageRoot: f.stageRoot }), /FILE_TOO_LARGE/);
  const huge = join(f.root, 'huge-header'); const length = Buffer.alloc(4); length.writeUInt32BE(16 * 1024 ** 2 + 1); await writeFile(huge, Buffer.concat([magic, length]));
  await assert.rejects(extractBackupArchive({ archivePath: huge, stageRoot: f.stageRoot }), /MANIFEST_TOO_LARGE/);
  const imported = await extractBackupArchive({ ...f, maxArchiveBytes: exported.bytes }); assert.equal(imported.bytes, exported.bytes);
 } finally { await f.cleanup(); }
});

test('exportación rechaza tamaño y hash del payload sin aceptar contenedor parcial como éxito', async () => {
 const f = await fixture(); try {
  const world = join(f.bundleRoot, 'world.sqlite'); const original = await readFile(world);
  await writeFile(world, Buffer.alloc(original.length, 0x7f));
  await assert.rejects(writeBackupArchive(f), /HASH_MISMATCH/);
  assert.ok((await stat(f.archivePath)).size > 0); await rm(f.archivePath);
  await writeFile(world, 'short'); await assert.rejects(writeBackupArchive(f), /SIZE_MISMATCH/);
 } finally { await f.cleanup(); }
});

test('manifiesto exportado exige bytes exactos, UTF8 válido y ausencia de enlaces', async () => {
 const f = await fixture(); try {
  const path = join(f.bundleRoot, 'manifest.json'); await writeFile(path, `${JSON.stringify(f.manifest)}\n`);
  await assert.rejects(writeBackupArchive(f), /MANIFEST_MISMATCH/);
  const raw = Buffer.from([255]); await writeFile(path, raw); await assert.rejects(writeBackupArchive({ ...f, manifestHash: sha(raw) }));
  await writeFile(path, f.raw); const linked = join(f.root, 'manifest-copy'); await link(path, linked);
  await assert.rejects(writeBackupArchive(f), /FILE_INVALID/); await rm(linked);
  const destination = join(f.root, 'output-alias'); await symlink(path, destination); await assert.rejects(writeBackupArchive({ ...f, archivePath: destination }), /EEXIST/);
  assert.deepEqual(await readFile(path), f.raw);
 } finally { await f.cleanup(); }
});
