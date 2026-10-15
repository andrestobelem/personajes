import { randomUUID } from 'node:crypto';
import { closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const InputSchema = z.strictObject({ privateDataRoot: z.string().min(1) });
const OwnershipFailureSchema = z.object({
  kind: z.literal('runtime-configuration-ownership-failure'),
  code: z.enum(['ROOT_INVALID', 'ALREADY_OWNED', 'LEGACY_OWNERSHIP_PRESENT', 'LOCK_INVALID', 'OWNERSHIP_LOST']),
}).passthrough();
const QuickCheckSchema = z.strictObject({ quick_check: z.literal('ok') });
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'binary');
const DATABASE_NAME = 'ownership.sqlite';
const LEGACY_OWNERSHIP_NAME = 'host-ownership.json';

type RuntimeConfigurationOwnershipFailure = Error & z.infer<typeof OwnershipFailureSchema>;
const activeOwners = new Map<string, string>();

function failure(input: { code: z.infer<typeof OwnershipFailureSchema>['code']; message: string }): RuntimeConfigurationOwnershipFailure {
  return Object.assign(new Error(input.message), OwnershipFailureSchema.parse({
    kind: 'runtime-configuration-ownership-failure', code: input.code,
  }));
}

export function isRuntimeConfigurationOwnershipFailure(error: unknown): error is RuntimeConfigurationOwnershipFailure {
  return error instanceof Error && OwnershipFailureSchema.safeParse(error).success;
}

function fsErrorCode(error: unknown): string | undefined {
  const parsed = z.object({ code: z.string() }).safeParse(error);
  return parsed.success ? parsed.data.code : undefined;
}

function hasCurrentUid(stat: { uid: number }): boolean {
  return typeof process.getuid !== 'function' || stat.uid === process.getuid();
}

function sameFile(left: { dev: number; ino: number }, right: { dev: number; ino: number }): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function canonicalRuntimeRoot(path: string): string {
  if (!isAbsolute(path)) throw failure({ code: 'ROOT_INVALID', message: 'La raíz de configuración del runtime debe ser absoluta.' });
  const normalized = resolve(path);
  const parent = dirname(normalized);
  const name = basename(normalized);
  if (name.length === 0) throw failure({ code: 'ROOT_INVALID', message: 'La raíz de configuración del runtime no puede ser el directorio raíz.' });
  try {
    const canonicalParent = realpathSync(parent);
    const parentStat = lstatSync(canonicalParent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('Invalid parent');
    return join(canonicalParent, name);
  } catch (error) {
    if (isRuntimeConfigurationOwnershipFailure(error)) throw error;
    throw failure({ code: 'ROOT_INVALID', message: 'El padre de la raíz de configuración debe existir y ser un directorio accesible.' });
  }
}

function assertDirectoryIdentity(input: { path: string; descriptor: number; expected: { dev: number; ino: number } }): void {
  try {
    const opened = fstatSync(input.descriptor);
    const current = lstatSync(input.path);
    if (!opened.isDirectory() || !current.isDirectory() || current.isSymbolicLink() ||
      !sameFile(opened, input.expected) || !sameFile(current, input.expected) || !hasCurrentUid(opened) ||
      (opened.mode & 0o777) !== 0o700 || (current.mode & 0o777) !== 0o700) {
      throw new Error('Runtime directory identity changed');
    }
  } catch {
    throw failure({ code: 'OWNERSHIP_LOST', message: 'Cambió la raíz privada de configuración del runtime.' });
  }
}

function assertDatabaseIdentity(input: {
  rootPath: string;
  rootDescriptor: number;
  rootIdentity: { dev: number; ino: number };
  databasePath: string;
  databaseDescriptor: number;
  databaseIdentity: { dev: number; ino: number };
}): void {
  assertDirectoryIdentity({ path: input.rootPath, descriptor: input.rootDescriptor, expected: input.rootIdentity });
  try {
    const opened = fstatSync(input.databaseDescriptor);
    const current = lstatSync(input.databasePath);
    if (!opened.isFile() || !current.isFile() || current.isSymbolicLink() || opened.nlink !== 1 || current.nlink !== 1 ||
      !sameFile(opened, input.databaseIdentity) || !sameFile(current, input.databaseIdentity) || !hasCurrentUid(opened) ||
      (opened.mode & 0o777) !== 0o600 || (current.mode & 0o777) !== 0o600) {
      throw new Error('Runtime ownership database identity changed');
    }
  } catch {
    throw failure({ code: 'OWNERSHIP_LOST', message: 'Cambió el archivo privado de ownership del runtime.' });
  }
}

function assertNoLegacyOwnership(rootPath: string): void {
  try {
    lstatSync(join(rootPath, LEGACY_OWNERSHIP_NAME));
    throw failure({ code: 'LEGACY_OWNERSHIP_PRESENT', message: 'Hay un registro de ownership anterior que requiere revisión explícita.' });
  } catch (error) {
    if (isRuntimeConfigurationOwnershipFailure(error)) throw error;
    if (fsErrorCode(error) !== 'ENOENT') throw failure({ code: 'ROOT_INVALID', message: 'No se pudo inspeccionar el registro de ownership anterior.' });
  }
}

function assertNoSidecars(databasePath: string): void {
  for (const suffix of ['-journal', '-wal', '-shm']) {
    try {
      lstatSync(`${databasePath}${suffix}`);
      throw failure({ code: 'LOCK_INVALID', message: 'El archivo de ownership tiene sidecars inesperados y requiere revisión.' });
    } catch (error) {
      if (isRuntimeConfigurationOwnershipFailure(error)) throw error;
      if (fsErrorCode(error) !== 'ENOENT') throw failure({ code: 'LOCK_INVALID', message: 'No se pudieron inspeccionar los sidecars del archivo de ownership.' });
    }
  }
}

function openPrivateDatabaseFile(input: { rootPath: string; rootDescriptor: number; rootIdentity: { dev: number; ino: number } }): {
  path: string; descriptor: number; identity: { dev: number; ino: number };
} {
  if (constants.O_NOFOLLOW === undefined || constants.O_DIRECTORY === undefined) {
    throw failure({ code: 'ROOT_INVALID', message: 'El sistema no admite la apertura segura requerida para el runtime.' });
  }
  const path = join(input.rootPath, DATABASE_NAME);
  assertDirectoryIdentity({ path: input.rootPath, descriptor: input.rootDescriptor, expected: input.rootIdentity });
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  } catch (error) {
    if (fsErrorCode(error) !== 'EEXIST') {
      if (fsErrorCode(error) === 'ELOOP') throw failure({ code: 'LOCK_INVALID', message: 'El archivo de ownership no puede ser un enlace simbólico.' });
      throw failure({ code: 'LOCK_INVALID', message: 'No se pudo crear el archivo privado de ownership.' });
    }
    let existing;
    try { existing = lstatSync(path); } catch { throw failure({ code: 'LOCK_INVALID', message: 'El archivo de ownership cambió durante su apertura.' }); }
    if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1 || !hasCurrentUid(existing)) {
      throw failure({ code: 'LOCK_INVALID', message: 'El archivo de ownership debe ser regular, privado y no tener hard links.' });
    }
    try { descriptor = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch { throw failure({ code: 'LOCK_INVALID', message: 'No se pudo abrir el archivo privado de ownership.' }); }
  }

  try {
    const opened = fstatSync(descriptor);
    const current = lstatSync(path);
    if (!opened.isFile() || !current.isFile() || current.isSymbolicLink() || opened.nlink !== 1 || current.nlink !== 1 ||
      !hasCurrentUid(opened) || !sameFile(opened, current)) {
      throw failure({ code: 'LOCK_INVALID', message: 'El archivo de ownership fue sustituido o no es privado.' });
    }
    // Do not chmod a hard link or a file owned by another uid.
    fchmodSync(descriptor, 0o600);
    const secured = fstatSync(descriptor);
    const pathAfter = lstatSync(path);
    if (!secured.isFile() || !pathAfter.isFile() || pathAfter.isSymbolicLink() || secured.nlink !== 1 || pathAfter.nlink !== 1 ||
      !hasCurrentUid(secured) || (secured.mode & 0o777) !== 0o600 || !sameFile(secured, pathAfter)) {
      throw failure({ code: 'LOCK_INVALID', message: 'El archivo de ownership no conserva su identidad privada.' });
    }
    if (secured.size > 0) {
      const header = Buffer.alloc(SQLITE_HEADER.length);
      const read = readSync(descriptor, header, 0, header.length, 0);
      if (read !== header.length || !header.equals(SQLITE_HEADER)) {
        throw failure({ code: 'LOCK_INVALID', message: 'El archivo de ownership no es una base SQLite íntegra.' });
      }
    }
    assertDirectoryIdentity({ path: input.rootPath, descriptor: input.rootDescriptor, expected: input.rootIdentity });
    return { path, descriptor, identity: { dev: secured.dev, ino: secured.ino } };
  } catch (error) {
    closeSync(descriptor);
    if (isRuntimeConfigurationOwnershipFailure(error)) throw error;
    throw failure({ code: 'LOCK_INVALID', message: 'El archivo privado de ownership no es seguro.' });
  }
}

function assertEmptyDatabase(database: DatabaseSync): void {
  QuickCheckSchema.parse(database.prepare('PRAGMA quick_check').get());
  if (database.prepare('SELECT name FROM sqlite_schema').all().length !== 0) {
    throw failure({ code: 'LOCK_INVALID', message: 'La base de ownership contiene objetos inesperados.' });
  }
  const applicationId = z.strictObject({ application_id: z.literal(0) }).safeParse(database.prepare('PRAGMA application_id').get());
  const userVersion = z.strictObject({ user_version: z.literal(0) }).safeParse(database.prepare('PRAGMA user_version').get());
  if (!applicationId.success || !userVersion.success) {
    throw failure({ code: 'LOCK_INVALID', message: 'La base de ownership contiene metadatos inesperados.' });
  }
}

function closeQuietly(operation: () => void): void {
  try { operation(); } catch { /* Cleanup still closes every remaining resource. */ }
}

/**
 * Holds a SQLite RESERVED write lock as a process-exclusive runtime-configuration
 * owner. No application tables or lock records are written; SQLite releases the
 * kernel lock automatically when the process exits, including after SIGKILL.
 */
export function acquireRuntimeConfigurationOwnership(rawInput: { privateDataRoot: string }) {
  const input = InputSchema.parse(rawInput);
  const rootPath = canonicalRuntimeRoot(input.privateDataRoot);
  if (activeOwners.has(rootPath)) {
    throw failure({ code: 'ALREADY_OWNED', message: 'Este proceso ya tiene el control del runtime.' });
  }

  let rootDescriptor: number | undefined;
  let databaseDescriptor: number | undefined;
  let database: DatabaseSync | undefined;
  let registered = false;
  try {
    try { mkdirSync(rootPath, { mode: 0o700 }); }
    catch (error) { if (fsErrorCode(error) !== 'EEXIST') throw error; }
    const rootBeforeOpen = lstatSync(rootPath);
    if (!rootBeforeOpen.isDirectory() || rootBeforeOpen.isSymbolicLink() || !hasCurrentUid(rootBeforeOpen)) {
      throw failure({ code: 'ROOT_INVALID', message: 'La raíz de configuración debe ser un directorio del usuario actual.' });
    }
    rootDescriptor = openSync(rootPath, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
    const rootOpened = fstatSync(rootDescriptor);
    if (!rootOpened.isDirectory() || !sameFile(rootBeforeOpen, rootOpened) || !hasCurrentUid(rootOpened)) {
      throw failure({ code: 'ROOT_INVALID', message: 'La raíz de configuración cambió durante su apertura.' });
    }
    fchmodSync(rootDescriptor, 0o700);
    const rootIdentity = { dev: rootOpened.dev, ino: rootOpened.ino };
    assertDirectoryIdentity({ path: rootPath, descriptor: rootDescriptor, expected: rootIdentity });
    assertNoLegacyOwnership(rootPath);

    const opened = openPrivateDatabaseFile({ rootPath, rootDescriptor, rootIdentity });
    databaseDescriptor = opened.descriptor;
    assertNoSidecars(opened.path);
    database = new DatabaseSync(opened.path, { timeout: 0 });
    database.exec('PRAGMA busy_timeout=0;');
    const journalMode = z.strictObject({ journal_mode: z.literal('memory') }).safeParse(
      database.prepare('PRAGMA journal_mode=MEMORY').get(),
    );
    if (!journalMode.success) {
      throw failure({ code: 'LOCK_INVALID', message: 'No se pudo mantener el bloqueo SQLite sin sidecars persistentes.' });
    }
    database.exec('BEGIN IMMEDIATE;');
    assertDatabaseIdentity({ rootPath, rootDescriptor, rootIdentity, databasePath: opened.path,
      databaseDescriptor, databaseIdentity: opened.identity });
    assertEmptyDatabase(database);
    assertNoSidecars(opened.path);
    // Revalidate after SQLite opens the path; all subsequent operations share this exact connection.
    assertDatabaseIdentity({ rootPath, rootDescriptor, rootIdentity, databasePath: opened.path,
      databaseDescriptor, databaseIdentity: opened.identity });

    const ownerToken = randomUUID();
    activeOwners.set(rootPath, ownerToken);
    registered = true;
    let released = false;
    function assertOwned(): void {
      if (released || activeOwners.get(rootPath) !== ownerToken) {
        throw failure({ code: 'OWNERSHIP_LOST', message: 'El proceso ya no posee el runtime.' });
      }
      if (rootDescriptor === undefined || databaseDescriptor === undefined || database === undefined) {
        throw failure({ code: 'OWNERSHIP_LOST', message: 'El proceso ya no mantiene abierto el bloqueo SQLite.' });
      }
      assertDatabaseIdentity({ rootPath, rootDescriptor, rootIdentity,
        databasePath: opened.path, databaseDescriptor, databaseIdentity: opened.identity });
      assertEmptyDatabase(database);
    }
    return Object.freeze({
      privateDataRoot: rootPath,
      ownerToken,
      assertOwned,
      release(): void {
        if (released) return;
        let ownershipError: unknown;
        try { assertOwned(); } catch (error) { ownershipError = error; }
        // Rollback is intentionally empty: this database contains no runtime settings.
        closeQuietly(() => database?.exec('ROLLBACK'));
        closeQuietly(() => database?.close());
        if (databaseDescriptor !== undefined) {
          const descriptor = databaseDescriptor;
          closeQuietly(() => closeSync(descriptor));
        }
        if (rootDescriptor !== undefined) {
          const descriptor = rootDescriptor;
          closeQuietly(() => closeSync(descriptor));
        }
        if (activeOwners.get(rootPath) === ownerToken) activeOwners.delete(rootPath);
        released = true;
        database = undefined;
        databaseDescriptor = undefined;
        rootDescriptor = undefined;
        if (ownershipError !== undefined) {
          if (isRuntimeConfigurationOwnershipFailure(ownershipError)) throw ownershipError;
          throw failure({ code: 'OWNERSHIP_LOST', message: 'No se pudo verificar el ownership al liberar el runtime.' });
        }
      },
    });
  } catch (error) {
    if (database !== undefined) {
      closeQuietly(() => database?.exec('ROLLBACK'));
      closeQuietly(() => database?.close());
    }
    if (databaseDescriptor !== undefined) {
      const descriptor = databaseDescriptor;
      closeQuietly(() => closeSync(descriptor));
    }
    if (rootDescriptor !== undefined) {
      const descriptor = rootDescriptor;
      closeQuietly(() => closeSync(descriptor));
    }
    if (registered) activeOwners.delete(rootPath);
    if (isRuntimeConfigurationOwnershipFailure(error)) throw error;
    if (error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message)) {
      throw failure({ code: 'ALREADY_OWNED', message: 'Otro proceso mantiene el control del runtime.' });
    }
    throw failure({ code: 'LOCK_INVALID', message: 'No se pudo adquirir el bloqueo privado del runtime.' });
  }
}
