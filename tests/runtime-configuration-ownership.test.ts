import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { acquireRuntimeConfigurationOwnership, isRuntimeConfigurationOwnershipFailure } from '../src/adapters/runtime-configuration-ownership.ts';

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'personajes-runtime-owner-'));
  return { base, runtimeRoot: join(base, 'runtime'), worldRoot: join(base, 'world') };
}

function assertPrivateSqlite(path: string): void {
  const stat = lstatSync(path);
  assert.equal(stat.isFile(), true);
  assert.equal(stat.nlink, 1);
  assert.equal(stat.mode & 0o777, 0o600);
  if (typeof process.getuid === 'function') assert.equal(stat.uid, process.getuid());
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(database.prepare('PRAGMA quick_check').get()?.quick_check, 'ok');
    assert.equal(database.prepare('SELECT name FROM sqlite_schema').all().length, 0);
    assert.equal(database.prepare('PRAGMA application_id').get()?.application_id, 0);
    assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, 0);
  } finally { database.close(); }
}

function childOwner(input: { root: string; readyPath: string; releasePath: string }): ChildProcess {
  const moduleUrl = pathToFileURL(join(process.cwd(), 'src/adapters/runtime-configuration-ownership.ts')).href;
  const script = `import { existsSync, writeFileSync } from 'node:fs';
    import { acquireRuntimeConfigurationOwnership } from ${JSON.stringify(moduleUrl)};
    const ownership = acquireRuntimeConfigurationOwnership({ privateDataRoot: ${JSON.stringify(input.root)} });
    writeFileSync(${JSON.stringify(input.readyPath)}, ownership.ownerToken);
    while (!existsSync(${JSON.stringify(input.releasePath)})) await new Promise(resolve => setTimeout(resolve, 5));
    ownership.release();`;
  return spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForFile(path: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!existsSync(path) && Date.now() < deadline) {
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(existsSync(path), `El hijo no adquirió ownership; exitCode=${child.exitCode}`);
}

function childResult(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }> {
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stderr }));
  });
}

test('bloquea segunda adquisición local, conserva SQLite vacío e invalida el mundo como raíz implícita', t => {
  const f = fixture();
  t.after(() => rmSync(f.base, { recursive: true, force: true }));
  const owner = acquireRuntimeConfigurationOwnership({ privateDataRoot: f.runtimeRoot });
  assert.equal(owner.privateDataRoot, join(realpathSync(f.base), 'runtime'));
  assert.equal(existsSync(f.worldRoot), false, 'el helper no crea la raíz del mundo');
  assert.equal(lstatSync(f.runtimeRoot).mode & 0o777, 0o700);
  const databasePath = join(f.runtimeRoot, 'ownership.sqlite');
  assertPrivateSqlite(databasePath);
  owner.assertOwned();
  assert.throws(() => acquireRuntimeConfigurationOwnership({ privateDataRoot: f.runtimeRoot }),
    error => isRuntimeConfigurationOwnershipFailure(error) && error.code === 'ALREADY_OWNED');
  assertPrivateSqlite(databasePath);
  owner.release();
  owner.release();
  const next = acquireRuntimeConfigurationOwnership({ privateDataRoot: f.runtimeRoot });
  next.assertOwned();
  next.release();
  assertPrivateSqlite(databasePath);
});

test('otro proceso no adquiere el lock y SIGKILL libera SQLite sin recovery manual', { skip: process.platform === 'win32' }, async t => {
  const f = fixture();
  const readyPath = join(f.base, 'ready');
  const releasePath = join(f.base, 'release');
  const child = childOwner({ root: f.runtimeRoot, readyPath, releasePath });
  const result = childResult(child);
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (child.exitCode === null && child.signalCode === null) await result;
    rmSync(f.base, { recursive: true, force: true });
  });
  await waitForFile(readyPath, child);
  const databasePath = join(f.runtimeRoot, 'ownership.sqlite');
  assert.throws(() => acquireRuntimeConfigurationOwnership({ privateDataRoot: f.runtimeRoot }),
    error => isRuntimeConfigurationOwnershipFailure(error) && error.code === 'ALREADY_OWNED');
  assertPrivateSqlite(databasePath);
  child.kill('SIGKILL');
  const killed = await result;
  assert.equal(killed.signal, 'SIGKILL', killed.stderr);
  const recovered = acquireRuntimeConfigurationOwnership({ privateDataRoot: f.runtimeRoot });
  recovered.assertOwned();
  recovered.release();
  assertPrivateSqlite(databasePath);
});

test('el registro de ownership anterior se conserva y bloquea la migración implícita', t => {
  const f = fixture();
  t.after(() => rmSync(f.base, { recursive: true, force: true }));
  mkdirSync(f.runtimeRoot, { mode: 0o700 });
  const legacyPath = join(f.runtimeRoot, 'host-ownership.json');
  const legacy = Buffer.from(JSON.stringify({ kind: 'host-ownership', schemaVersion: 1, nonce: randomUUID(), pid: process.pid }));
  writeFileSync(legacyPath, legacy, { mode: 0o600 });
  assert.throws(() => acquireRuntimeConfigurationOwnership({ privateDataRoot: f.runtimeRoot }),
    error => isRuntimeConfigurationOwnershipFailure(error) && error.code === 'LEGACY_OWNERSHIP_PRESENT');
  assert.deepEqual(readFileSync(legacyPath), legacy);
  assert.equal(existsSync(join(f.runtimeRoot, 'ownership.sqlite')), false);
});

test('un sidecar preexistente se conserva y bloquea el ownership sin recovery implícito', t => {
  const f = fixture();
  t.after(() => rmSync(f.base, { recursive: true, force: true }));
  mkdirSync(f.runtimeRoot, { mode: 0o700 });
  const databasePath = join(f.runtimeRoot, 'ownership.sqlite');
  writeFileSync(databasePath, Buffer.alloc(0), { mode: 0o600 });
  const sidecarPath = `${databasePath}-journal`;
  const sidecar = Buffer.from('sidecar ajeno que requiere revisión');
  writeFileSync(sidecarPath, sidecar, { mode: 0o600 });
  assert.throws(() => acquireRuntimeConfigurationOwnership({ privateDataRoot: f.runtimeRoot }),
    error => isRuntimeConfigurationOwnershipFailure(error) && error.code === 'LOCK_INVALID');
  assert.deepEqual(readFileSync(sidecarPath), sidecar);
  assert.equal(existsSync(sidecarPath), true);
});

test('un symlink de ownership no modifica el archivo de destino', t => {
  const f = fixture();
  t.after(() => rmSync(f.base, { recursive: true, force: true }));
  mkdirSync(f.runtimeRoot, { mode: 0o700 });
  const victim = join(f.base, 'victim');
  const contents = Buffer.from('archivo fuera de la raíz');
  writeFileSync(victim, contents, { mode: 0o644 });
  const mode = lstatSync(victim).mode & 0o777;
  symlinkSync(victim, join(f.runtimeRoot, 'ownership.sqlite'));
  assert.throws(() => acquireRuntimeConfigurationOwnership({ privateDataRoot: f.runtimeRoot }),
    error => isRuntimeConfigurationOwnershipFailure(error) && error.code === 'LOCK_INVALID');
  assert.deepEqual(readFileSync(victim), contents);
  assert.equal(lstatSync(victim).mode & 0o777, mode);
});

test('un hard link de ownership se rechaza antes de cambiar el destino', t => {
  const f = fixture();
  t.after(() => rmSync(f.base, { recursive: true, force: true }));
  mkdirSync(f.runtimeRoot, { mode: 0o700 });
  const victim = join(f.base, 'victim');
  const contents = Buffer.from('archivo enlazado fuera de la raíz');
  writeFileSync(victim, contents, { mode: 0o644 });
  const mode = lstatSync(victim).mode & 0o777;
  linkSync(victim, join(f.runtimeRoot, 'ownership.sqlite'));
  assert.equal(lstatSync(victim).nlink, 2);
  assert.throws(() => acquireRuntimeConfigurationOwnership({ privateDataRoot: f.runtimeRoot }),
    error => isRuntimeConfigurationOwnershipFailure(error) && error.code === 'LOCK_INVALID');
  assert.deepEqual(readFileSync(victim), contents);
  assert.equal(lstatSync(victim).mode & 0o777, mode);
  assert.equal(lstatSync(victim).nlink, 2);
});

test('una raíz runtime simbólica se rechaza sin seguirla', t => {
  const f = fixture();
  t.after(() => rmSync(f.base, { recursive: true, force: true }));
  const victim = join(f.base, 'victim-root');
  mkdirSync(victim, { mode: 0o700 });
  const victimMode = lstatSync(victim).mode & 0o777;
  symlinkSync(victim, f.runtimeRoot);
  assert.throws(() => acquireRuntimeConfigurationOwnership({ privateDataRoot: f.runtimeRoot }),
    error => isRuntimeConfigurationOwnershipFailure(error) && error.code === 'ROOT_INVALID');
  assert.equal(lstatSync(victim).mode & 0o777, victimMode);
  assert.equal(existsSync(join(victim, 'ownership.sqlite')), false);
});
