import assert from 'node:assert/strict';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createIcmMemoryAdapter, isIcmAdapterFailure } from '../src/adapters/icm.ts';
import { freezeExperience } from '../src/application/experience-envelope.ts';
import { CharacterIdSchema, RunIdSchema } from '../src/domain/values.ts';
import type { MemoryProjectionReceipt } from '../src/domain/memory-projection.ts';

const binaryPath = process.env.PERSONAJES_ICM_TEST_BINARY;
const realCliOptions = { skip: binaryPath === undefined ? 'Definí PERSONAJES_ICM_TEST_BINARY para ejecutar ICM real.' : false };
const runId = RunIdSchema.parse('00000000-0000-4000-8000-000000009101');
const actorId = CharacterIdSchema.parse('maxwell-smart');

async function fixture() {
  assert.ok(binaryPath);
  const directory = mkdtempSync(join(tmpdir(), 'personajes-icm-initialize-'));
  const receipts = new Map<string, MemoryProjectionReceipt>();
  try {
    const adapter = await createIcmMemoryAdapter({
      privateDataRoot: directory, runId, actorId, binaryPath,
      ledger: { findReceipt: ({ memoryId }) => receipts.get(memoryId) },
    });
    return {
      adapter, directory, receipts,
      databasePath: join(directory, 'runs', runId, 'actors', actorId, 'memory.sqlite'),
      dispose: () => rmSync(directory, { recursive: true, force: true }),
    };
  } catch (error: unknown) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

test('initialize crea SQLite ICM real vacío, privado y sano sin tool actoral ni recuerdo ficticio', realCliOptions, async () => {
  const f = await fixture();
  try {
    assert.equal(existsSync(f.databasePath), false);
    assert.deepEqual(await f.adapter.initialize(), { kind: 'initialized' });
    assert.equal(readFileSync(f.databasePath).subarray(0, 16).equals(Buffer.from('SQLite format 3\0')), true);
    assert.equal(statSync(f.databasePath).mode & 0o777, 0o600);
    assert.equal('initialize' in f.adapter.actor, false);
    const database = new DatabaseSync(f.databasePath, { readOnly: true });
    try {
      assert.equal(database.prepare('PRAGMA quick_check').get()?.quick_check, 'ok');
    } finally { database.close(); }
    assert.deepEqual(await f.adapter.diagnostics.listForensic({ throughWorldSeq: 0 }), {
      source: 'forensic-list', throughWorldSeq: 0, experiences: [], rejectedCount: 0,
    });
    const before = readFileSync(f.databasePath);
    assert.deepEqual(await f.adapter.initialize(), { kind: 'existing' });
    assert.deepEqual(readFileSync(f.databasePath), before);
  } finally { f.dispose(); }
});

test('initialize existente conserva byte a byte recuerdos ICM y sus receipts', realCliOptions, async () => {
  const f = await fixture();
  try {
    const frozen = freezeExperience({
      schemaVersion: 1, experienceId: '00000000-0000-4000-8000-000000009102',
      runId, actorId, kind: 'belief', content: 'No recibí la clave del archivo.', sourceRefs: [],
      fictitiousAt: 100, receivedAt: 100, worldSeq: 1, confidence: 0.7, revision: 0,
      predecessor: { kind: 'initial' }, basedOn: [],
    });
    const stored = await f.adapter.projector.store(frozen);
    f.receipts.set(stored.memoryId, {
      memoryId: stored.memoryId, experienceId: frozen.envelope.experienceId, runId, actorId,
      worldSeq: frozen.envelope.worldSeq, canonicalPayload: frozen.canonicalPayload, payloadHash: frozen.payloadHash,
    });
    const before = readFileSync(f.databasePath);
    assert.deepEqual(await f.adapter.initialize(), { kind: 'existing' });
    assert.deepEqual(readFileSync(f.databasePath), before);
    const result = await f.adapter.diagnostics.listForensic({ throughWorldSeq: 1 });
    assert.equal(result.rejectedCount, 0);
    assert.deepEqual(result.experiences.map(({ experience }) => experience), [frozen.envelope]);
  } finally { f.dispose(); }
});

test('initialize rechaza cancelación incluso con health cacheado y recupera placeholder vacío', realCliOptions, async () => {
  const f = await fixture();
  try {
    await f.adapter.checkHealth();
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.adapter.initialize({ signal: controller.signal }),
      (error: unknown) => isIcmAdapterFailure(error) && error.code === 'PROCESS_ABORTED');
    assert.equal(existsSync(f.databasePath), false);
    writeFileSync(f.databasePath, '', { mode: 0o600 });
    assert.deepEqual(await f.adapter.initialize(), { kind: 'initialized' });
    assert.equal((await f.adapter.diagnostics.listForensic({ throughWorldSeq: 0 })).experiences.length, 0);
  } finally { f.dispose(); }
});

test('initialize no sigue symlinks ni sobrescribe archivo existente que no sea SQLite', realCliOptions, async () => {
  const f = await fixture();
  try {
    const target = join(f.directory, 'outside-memory');
    writeFileSync(target, 'archivo protegido');
    symlinkSync(target, f.databasePath);
    await assert.rejects(f.adapter.initialize(),
      (error: unknown) => isIcmAdapterFailure(error) && error.code === 'DATABASE_PATH_INVALID');
    assert.equal(readFileSync(target, 'utf8'), 'archivo protegido');
    rmSync(f.databasePath);
    writeFileSync(f.databasePath, 'contenido no SQLite', { mode: 0o600 });
    const before = readFileSync(f.databasePath);
    await assert.rejects(f.adapter.initialize(),
      (error: unknown) => isIcmAdapterFailure(error) && error.code === 'CLI_EXIT_NONZERO');
    assert.deepEqual(readFileSync(f.databasePath), before);
  } finally { f.dispose(); }
});

for (const content of ['', 'SQLite compartido protegido']) {
  test(`initialize rechaza hardlink principal ${content === '' ? 'vacío' : 'no vacío'} antes de chmod o CLI`, realCliOptions, async () => {
    const f = await fixture();
    try {
      const outside = join(f.directory, 'outside.sqlite');
      writeFileSync(outside, content, { mode: 0o640 });
      linkSync(outside, f.databasePath);
      await assert.rejects(f.adapter.initialize(),
        (error: unknown) => isIcmAdapterFailure(error) && error.code === 'DATABASE_PATH_INVALID');
      assert.equal(readFileSync(outside, 'utf8'), content);
      assert.equal(statSync(outside).mode & 0o777, 0o640);
    } finally { f.dispose(); }
  });
}

for (const suffix of ['-wal', '-shm', '-journal']) {
  for (const kind of ['hardlink', 'symlink']) {
    test(`initialize rechaza ${kind} del sidecar ${suffix} antes de tocar SQLite`, realCliOptions, async () => {
      const f = await fixture();
      try {
        await f.adapter.initialize();
        chmodSync(f.databasePath, 0o640);
        const before = readFileSync(f.databasePath);
        const outside = join(f.directory, 'outside-sidecar');
        writeFileSync(outside, 'sidecar protegido', { mode: 0o640 });
        if (kind === 'hardlink') linkSync(outside, `${f.databasePath}${suffix}`);
        else symlinkSync(outside, `${f.databasePath}${suffix}`);
        await assert.rejects(f.adapter.initialize(),
          (error: unknown) => isIcmAdapterFailure(error) && error.code === 'DATABASE_PATH_INVALID');
        assert.deepEqual(readFileSync(f.databasePath), before);
        assert.equal(statSync(f.databasePath).mode & 0o777, 0o640);
        assert.equal(readFileSync(outside, 'utf8'), 'sidecar protegido');
        assert.equal(statSync(outside).mode & 0o777, 0o640);
      } finally { f.dispose(); }
    });
  }
}

test('initialize revalida config hardlink antes de leer CLI o cambiar permisos externos', realCliOptions, async () => {
  const f = await fixture();
  try {
    const configPath = join(dirname(f.databasePath), 'icm-config.toml');
    const outside = join(f.directory, 'outside-config');
    const content = readFileSync(configPath);
    writeFileSync(outside, content, { mode: 0o640 });
    rmSync(configPath);
    linkSync(outside, configPath);
    await assert.rejects(f.adapter.initialize(),
      (error: unknown) => isIcmAdapterFailure(error) && error.code === 'CONFIG_INVALID');
    assert.deepEqual(readFileSync(outside), content);
    assert.equal(statSync(outside).mode & 0o777, 0o640);
    assert.equal(existsSync(f.databasePath), false);
    assert.ok(binaryPath);
    await assert.rejects(createIcmMemoryAdapter({
      privateDataRoot: f.directory, runId, actorId, binaryPath, ledger: { findReceipt: () => undefined },
    }), (error: unknown) => isIcmAdapterFailure(error) && error.code === 'CONFIG_INVALID');
    assert.equal(statSync(outside).mode & 0o777, 0o640);
  } finally { f.dispose(); }
});

test('factory rechaza alias interno de actor y ancestro antes de modificar directorio fuente', realCliOptions, async () => {
  assert.ok(binaryPath);
  for (const aliasActor of [true, false]) {
    const directory = mkdtempSync(join(tmpdir(), 'personajes-icm-directory-'));
    try {
      const source = join(directory, 'source-actor');
      mkdirSync(source, { mode: 0o750 });
      const memory = join(source, 'memory.sqlite');
      writeFileSync(memory, 'memoria fuente protegida', { mode: 0o640 });
      const actors = join(directory, 'runs', runId, 'actors');
      mkdirSync(aliasActor ? actors : dirname(actors), { recursive: true });
      symlinkSync(source, aliasActor ? join(actors, actorId) : actors);
      await assert.rejects(createIcmMemoryAdapter({
        privateDataRoot: directory, runId, actorId, binaryPath, ledger: { findReceipt: () => undefined },
      }), (error: unknown) => isIcmAdapterFailure(error) && error.code === 'ACTOR_PATH_INVALID');
      assert.equal(readFileSync(memory, 'utf8'), 'memoria fuente protegida');
      assert.equal(statSync(memory).mode & 0o777, 0o640);
      assert.equal(statSync(source).mode & 0o777, 0o750);
      assert.deepEqual(readdirSync(source), ['memory.sqlite']);
      assert.equal(existsSync(join(source, actorId)), false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});

test('factory rechaza raíz final symlink sin cambiar permisos del destino', realCliOptions, async () => {
  assert.ok(binaryPath);
  const directory = mkdtempSync(join(tmpdir(), 'personajes-icm-root-link-'));
  try {
    const source = join(directory, 'source');
    mkdirSync(source, { mode: 0o750 });
    const alias = join(directory, 'alias');
    symlinkSync(source, alias);
    await assert.rejects(createIcmMemoryAdapter({
      privateDataRoot: alias, runId, actorId, binaryPath, ledger: { findReceipt: () => undefined },
    }), (error: unknown) => isIcmAdapterFailure(error) && error.code === 'ACTOR_PATH_INVALID');
    assert.equal(statSync(source).mode & 0o777, 0o750);
    assert.deepEqual(readdirSync(source), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('initialize revalida directorio actor reemplazado tras construir adapter sin escribir en fuente', realCliOptions, async () => {
  const f = await fixture();
  try {
    await f.adapter.checkHealth();
    const source = join(f.directory, 'source');
    mkdirSync(source, { mode: 0o750 });
    const sourceFile = join(source, 'memoria-source');
    writeFileSync(sourceFile, 'fuente inmutable', { mode: 0o640 });
    const actorDirectory = dirname(f.databasePath);
    rmSync(actorDirectory, { recursive: true });
    symlinkSync(source, actorDirectory);
    await assert.rejects(f.adapter.initialize(),
      (error: unknown) => isIcmAdapterFailure(error) && error.code === 'ACTOR_PATH_INVALID');
    assert.equal(readFileSync(sourceFile, 'utf8'), 'fuente inmutable');
    assert.equal(statSync(sourceFile).mode & 0o777, 0o640);
    assert.equal(statSync(source).mode & 0o777, 0o750);
    assert.deepEqual(readdirSync(source), ['memoria-source']);
  } finally { f.dispose(); }
});
