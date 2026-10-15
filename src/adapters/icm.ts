import { spawn } from 'node:child_process';
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { z } from 'zod';
import { freezeExperience, readPrivateExperience } from '../application/experience-envelope.ts';
import { FrozenExperienceSchema } from '../domain/experience.ts';
import type { Experience, FrozenExperience } from '../domain/experience.ts';
import { IcmMemoryIdSchema, MemoryProjectionReceiptSchema } from '../domain/memory-projection.ts';
import type { IcmMemoryId } from '../domain/memory-projection.ts';
import { CharacterIdSchema, ExperienceIdSchema, HashSchema, RunIdSchema, WorldSeqSchema } from '../domain/values.ts';

export const ICM_VERSION = '0.11.4';
const IcmFailureCodeSchema = z.enum([
  'ACTOR_PATH_INVALID',
  'CLI_EXECUTION_FAILED',
  'CLI_EXIT_NONZERO',
  'CLI_OUTPUT_LIMIT',
  'CLI_VERSION_MISMATCH',
  'CONFIG_INVALID',
  'DATABASE_PATH_INVALID',
  'ENVELOPE_INVALID',
  'LEDGER_RESPONSE_INVALID',
  'LEDGER_UNAVAILABLE',
  'READ_OUTPUT_INVALID',
  'READ_REQUEST_INVALID',
  'STORE_OUTPUT_INVALID',
  'PROCESS_ABORTED',
  'PROCESS_TIMEOUT',
]);
const IcmFailureDataSchema = z.object({
  kind: z.literal('icmAdapterFailure'),
  code: IcmFailureCodeSchema,
}).passthrough();
const ProcessLimitsSchema = z.strictObject({
  processTimeoutMs: z.number().int().min(50).max(10_000).default(10_000),
  normalOutputBytes: z.number().int().min(1).max(2 * 1024 * 1024).default(2 * 1024 * 1024),
  forensicOutputBytes: z.number().int().min(1).max(16 * 1024 * 1024).default(16 * 1024 * 1024),
});
const FactoryPathSchema = z.strictObject({
  privateDataRoot: z.string().min(1),
  runId: RunIdSchema,
  actorId: CharacterIdSchema,
  binaryPath: z.string().min(1),
  limits: ProcessLimitsSchema,
});
const ReadRequestSchema = z.strictObject({
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(20).default(5),
  throughWorldSeq: WorldSeqSchema,
});
const ForensicRequestSchema = z.strictObject({ throughWorldSeq: WorldSeqSchema });
const ListedMemorySchema = z.object({
  id: IcmMemoryIdSchema,
  topic: z.string().min(1).max(256),
  summary: z.string(),
});
const ListedMemoryArraySchema = z.array(z.unknown());
export type { IcmMemoryId } from '../domain/memory-projection.ts';
export type IcmFailureCode = z.infer<typeof IcmFailureCodeSchema>;
export type IcmAdapterFailure = Error & z.infer<typeof IcmFailureDataSchema>;
export type IcmProcessLimits = z.infer<typeof ProcessLimitsSchema>;

export interface IcmVerifiedExperience {
  memoryId: IcmMemoryId;
  experience: Experience;
  payloadHash: z.infer<typeof HashSchema>;
}

export interface IcmProjectionLedger {
  /** Returns only a journal receipt committed by the host, or undefined. */
  findReceipt(input: {
    runId: z.infer<typeof RunIdSchema>;
    actorId: z.infer<typeof CharacterIdSchema>;
    memoryId: IcmMemoryId;
    throughWorldSeq: z.infer<typeof WorldSeqSchema>;
  }): unknown | Promise<unknown>;
}

export interface CreateIcmMemoryAdapterInput {
  privateDataRoot: string;
  runId: z.infer<typeof RunIdSchema>;
  actorId: z.infer<typeof CharacterIdSchema>;
  binaryPath: string;
  ledger: IcmProjectionLedger;
  limits?: Partial<IcmProcessLimits>;
}

export interface IcmActorMemoryReader {
  recall(input: unknown, options?: { signal?: AbortSignal }): Promise<{
    source: 'ranked-recall';
    throughWorldSeq: z.infer<typeof WorldSeqSchema>;
    experiences: readonly IcmVerifiedExperience[];
    rejectedCount: number;
  }>;
}

export interface IcmExperienceProjector {
  store(input: unknown, options?: { signal?: AbortSignal }): Promise<{
    experienceId: z.infer<typeof ExperienceIdSchema>;
    memoryId: IcmMemoryId;
  }>;
}

export interface IcmForensicReader {
  /** Host diagnostics only; never register this capability as an actor tool. */
  listForensic(input: unknown, options?: { signal?: AbortSignal }): Promise<{
    source: 'forensic-list';
    throughWorldSeq: z.infer<typeof WorldSeqSchema>;
    experiences: readonly IcmVerifiedExperience[];
    rejectedCount: number;
  }>;
}

export interface IcmMemoryAdapter {
  readonly runId: z.infer<typeof RunIdSchema>;
  readonly actorId: z.infer<typeof CharacterIdSchema>;
  readonly actor: IcmActorMemoryReader;
  readonly projector: IcmExperienceProjector;
  readonly diagnostics: IcmForensicReader;
  checkHealth(options?: { signal?: AbortSignal }): Promise<{ version: typeof ICM_VERSION }>;
  /** Host lifecycle only; creates an empty SQLite store without inventing an experience. */
  initialize(options?: { signal?: AbortSignal }): Promise<{ kind: 'initialized' | 'existing' }>;
}

export function isIcmAdapterFailure(value: unknown): value is IcmAdapterFailure {
  return value instanceof Error && IcmFailureDataSchema.safeParse(value).success;
}

export async function createIcmMemoryAdapter(input: CreateIcmMemoryAdapterInput): Promise<IcmMemoryAdapter> {
  const configuration = parseOrFail(
    FactoryPathSchema,
    {
      privateDataRoot: input.privateDataRoot,
      runId: input.runId,
      actorId: input.actorId,
      binaryPath: input.binaryPath,
      limits: input.limits ?? {},
    },
    'ACTOR_PATH_INVALID',
    'La configuración privada de ICM no es válida.',
  );
  if (typeof input.ledger.findReceipt !== 'function') {
    throw icmFailure('LEDGER_UNAVAILABLE', 'Falta el ledger host para validar recuerdos ICM.');
  }
  const ledger = input.ledger;
  if (!isAbsolute(configuration.privateDataRoot) || !isAbsolute(configuration.binaryPath)) {
    throw icmFailure('ACTOR_PATH_INVALID', 'Las rutas ICM deben ser absolutas y controladas por el host.');
  }

  const privateRoot = ensurePrivateRoot(configuration.privateDataRoot);
  const runDirectory = ensurePrivateDirectory(join(privateRoot, 'runs', configuration.runId), privateRoot);
  const actorDirectory = ensurePrivateDirectory(join(runDirectory, 'actors', configuration.actorId), privateRoot);
  const homeDirectory = ensurePrivateDirectory(join(actorDirectory, 'home'), privateRoot);
  const tempDirectory = ensurePrivateDirectory(join(actorDirectory, 'tmp'), privateRoot);
  const databasePath = join(actorDirectory, 'memory.sqlite');
  const configPath = join(actorDirectory, 'icm-config.toml');
  const binaryPath = resolveExecutable(configuration.binaryPath);
  const limits = configuration.limits;
  writeControlledConfig(configPath, actorDirectory, privateRoot);

  const environment = Object.freeze({
    HOME: homeDirectory,
    TMPDIR: tempDirectory,
    LANG: 'C',
    LC_ALL: 'C',
    ICM_CONFIG: configPath,
    ICM_DB_BACKEND: 'sqlite',
  });

  let isVersionChecked = false;
  let healthCheck: Promise<{ version: typeof ICM_VERSION }> | undefined;

  const runCli = async (args: readonly string[], maxOutputBytes: number, signal?: AbortSignal): Promise<string> => {
    ensurePrivateDirectory(homeDirectory, privateRoot);
    ensurePrivateDirectory(tempDirectory, privateRoot);
    writeControlledConfig(configPath, actorDirectory, privateRoot);
    validateDatabaseFiles(databasePath, actorDirectory, privateRoot);
    return runBoundedProcess({
      binaryPath,
      args,
      cwd: actorDirectory,
      environment,
      timeoutMs: limits.processTimeoutMs,
      maxOutputBytes,
      ...(signal === undefined ? {} : { signal }),
    });
  };

  const checkHealth = async (options?: { signal?: AbortSignal }): Promise<{ version: typeof ICM_VERSION }> => {
    if (isVersionChecked) return { version: ICM_VERSION };
    if (healthCheck !== undefined) return healthCheck;
    const current = (async (): Promise<{ version: typeof ICM_VERSION }> => {
      const output = await runCli(['--version'], limits.normalOutputBytes, options?.signal);
      if (output.trim() !== `icm ${ICM_VERSION}`) {
        throw icmFailure('CLI_VERSION_MISMATCH', 'El binario ICM no coincide con la versión fijada por el host.');
      }
      isVersionChecked = true;
      return { version: ICM_VERSION };
    })();
    healthCheck = current;
    try {
      return await current;
    } finally {
      if (healthCheck === current) healthCheck = undefined;
    }
  };

  const initialize: IcmMemoryAdapter['initialize'] = async (options) => {
    if (options?.signal?.aborted) throw icmFailure('PROCESS_ABORTED', 'La inicialización ICM fue cancelada antes de iniciar.');
    await checkHealth(options);
    if (options?.signal?.aborted) throw icmFailure('PROCESS_ABORTED', 'La inicialización ICM fue cancelada antes de crear la base.');
    const exists = ensureDatabaseFile(databasePath, actorDirectory, privateRoot, false);
    // A canceled first initialization can leave the controlled empty placeholder.
    // Let the supported CLI create its schema on retry, without a synthetic memory.
    const initialized = exists && lstatSync(databasePath).size > 0;
    if (!exists) ensureDatabaseFile(databasePath, actorDirectory, privateRoot, true);
    await runCli([
      '--db', databasePath,
      '--no-embeddings',
      ...(initialized ? ['--read-only'] : []),
      'stats',
    ], limits.normalOutputBytes, options?.signal);
    ensureDatabaseFile(databasePath, actorDirectory, privateRoot, false);
    return { kind: initialized ? 'existing' : 'initialized' };
  };

  const actor: IcmActorMemoryReader = Object.freeze({
    async recall(input: unknown, options?: { signal?: AbortSignal }): Promise<{
      source: 'ranked-recall';
      throughWorldSeq: z.infer<typeof WorldSeqSchema>;
      experiences: readonly IcmVerifiedExperience[];
      rejectedCount: number;
    }> {
      const request = parseOrFail(ReadRequestSchema, input, 'READ_REQUEST_INVALID', 'La consulta de memoria no cumple sus límites.');
      if (Buffer.byteLength(request.query, 'utf8') > 2_048 || request.query.includes('\0')) {
        throw icmFailure('READ_REQUEST_INVALID', 'La consulta de memoria excede el límite UTF-8 permitido.');
      }
      await checkHealth(options);
      if (!ensureDatabaseFile(databasePath, actorDirectory, privateRoot, false)) {
        return { source: 'ranked-recall', throughWorldSeq: request.throughWorldSeq, experiences: [], rejectedCount: 0 };
      }
      const args = [
        '--db', databasePath,
        '--no-embeddings',
        '--read-only',
        'recall',
        request.query,
        '--limit', String(request.limit),
        '--format', 'json',
      ];
      const output = await runCli(args, limits.normalOutputBytes, options?.signal);
      const parsedOutput = parseListedMemories(output);
      const verified = await verifyMemories({
        memories: parsedOutput.memories,
        runId: configuration.runId,
        actorId: configuration.actorId,
        throughWorldSeq: request.throughWorldSeq,
        ledger,
      });
      return {
        source: 'ranked-recall',
        throughWorldSeq: request.throughWorldSeq,
        experiences: verified.experiences,
        rejectedCount: parsedOutput.rejectedCount + verified.rejectedCount,
      };
    },
  });

  const projector: IcmExperienceProjector = Object.freeze({
    async store(input: unknown, options?: { signal?: AbortSignal }): Promise<{ experienceId: z.infer<typeof ExperienceIdSchema>; memoryId: IcmMemoryId }> {
      const frozen = parseFrozenExperience(input);
      if (frozen.envelope.runId !== configuration.runId || frozen.envelope.actorId !== configuration.actorId) {
        throw icmFailure('ENVELOPE_INVALID', 'La experiencia congelada pertenece a otra corrida o personaje.');
      }
      await checkHealth(options);
      ensureDatabaseFile(databasePath, actorDirectory, privateRoot, true);
      const args = [
        '--db', databasePath,
        '--no-embeddings',
        'store',
        '--topic', topicForExperience(frozen.envelope),
        '--content', frozen.canonicalPayload,
        '--importance', 'medium',
      ];
      const output = await runCli(args, limits.normalOutputBytes, options?.signal);
      const memoryId = parseStoredMemoryId(output);
      ensureDatabaseFile(databasePath, actorDirectory, privateRoot, false);
      return { experienceId: frozen.envelope.experienceId, memoryId };
    },
  });

  const diagnostics: IcmForensicReader = Object.freeze({
    async listForensic(input: unknown, options?: { signal?: AbortSignal }): Promise<{
      source: 'forensic-list';
      throughWorldSeq: z.infer<typeof WorldSeqSchema>;
      experiences: readonly IcmVerifiedExperience[];
      rejectedCount: number;
    }> {
      const request = parseOrFail(ForensicRequestSchema, input, 'READ_REQUEST_INVALID', 'El corte forense no es válido.');
      await checkHealth(options);
      if (!ensureDatabaseFile(databasePath, actorDirectory, privateRoot, false)) {
        return { source: 'forensic-list', throughWorldSeq: request.throughWorldSeq, experiences: [], rejectedCount: 0 };
      }
      const args = [
        '--db', databasePath,
        '--no-embeddings',
        '--read-only',
        'list',
        '--format', 'json',
        '--all',
      ];
      const output = await runCli(args, limits.forensicOutputBytes, options?.signal);
      const parsedOutput = parseListedMemories(output);
      const verified = await verifyMemories({
        memories: parsedOutput.memories,
        runId: configuration.runId,
        actorId: configuration.actorId,
        throughWorldSeq: request.throughWorldSeq,
        ledger,
      });
      return {
        source: 'forensic-list',
        throughWorldSeq: request.throughWorldSeq,
        experiences: verified.experiences,
        rejectedCount: parsedOutput.rejectedCount + verified.rejectedCount,
      };
    },
  });

  return Object.freeze({
    runId: configuration.runId,
    actorId: configuration.actorId,
    actor,
    projector,
    diagnostics,
    checkHealth,
    initialize,
  });
}

async function verifyMemories(input: {
  memories: readonly z.infer<typeof ListedMemorySchema>[];
  runId: z.infer<typeof RunIdSchema>;
  actorId: z.infer<typeof CharacterIdSchema>;
  throughWorldSeq: z.infer<typeof WorldSeqSchema>;
  ledger: IcmProjectionLedger;
}): Promise<{ experiences: readonly IcmVerifiedExperience[]; rejectedCount: number }> {
  const experiences: IcmVerifiedExperience[] = [];
  const seenExperienceIds = new Set<string>();
  let rejectedCount = 0;
  for (const memory of input.memories) {
    let parsedEnvelope: unknown;
    let frozen: FrozenExperience;
    try {
      parsedEnvelope = JSON.parse(memory.summary);
      frozen = freezeExperience(parsedEnvelope);
    } catch {
      rejectedCount += 1;
      continue;
    }
    const experience = frozen.envelope;
    if (frozen.canonicalPayload !== memory.summary || memory.topic !== topicForExperience(experience) ||
        experience.runId !== input.runId || experience.actorId !== input.actorId ||
        experience.worldSeq > input.throughWorldSeq || seenExperienceIds.has(experience.experienceId)) {
      rejectedCount += 1;
      continue;
    }
    let receiptValue: unknown;
    try {
      receiptValue = await input.ledger.findReceipt({
        runId: input.runId,
        actorId: input.actorId,
        memoryId: memory.id,
        throughWorldSeq: input.throughWorldSeq,
      });
    } catch {
      throw icmFailure('LEDGER_UNAVAILABLE', 'El ledger host no pudo verificar la memoria ICM.');
    }
    if (receiptValue === undefined || receiptValue === null) {
      rejectedCount += 1;
      continue;
    }
    const receipt = parseOrFail(
      MemoryProjectionReceiptSchema,
      receiptValue,
      'LEDGER_RESPONSE_INVALID',
      'El ledger host devolvió un receipt ICM inválido.',
    );
    if (receipt.memoryId !== memory.id || receipt.experienceId !== experience.experienceId ||
        receipt.runId !== input.runId || receipt.actorId !== input.actorId ||
        receipt.worldSeq !== experience.worldSeq || receipt.worldSeq > input.throughWorldSeq ||
        receipt.canonicalPayload !== memory.summary || receipt.payloadHash !== frozen.payloadHash) {
      rejectedCount += 1;
      continue;
    }
    try {
      const authoritative = readPrivateExperience({
        summary: memory.summary,
        actorId: input.actorId,
        runId: input.runId,
        throughWorldSeq: input.throughWorldSeq,
        expectedPayloadHash: receipt.payloadHash,
      });
      if (authoritative.experienceId !== receipt.experienceId) {
        rejectedCount += 1;
        continue;
      }
      seenExperienceIds.add(authoritative.experienceId);
      experiences.push({ memoryId: memory.id, experience: authoritative, payloadHash: frozen.payloadHash });
    } catch {
      rejectedCount += 1;
    }
  }
  return { experiences: Object.freeze(experiences), rejectedCount };
}

function parseFrozenExperience(input: unknown): FrozenExperience {
  try {
    const supplied = FrozenExperienceSchema.parse(input);
    const recomputed = freezeExperience(supplied.envelope);
    if (supplied.canonicalPayload !== recomputed.canonicalPayload || supplied.payloadHash !== recomputed.payloadHash) {
      throw icmFailure('ENVELOPE_INVALID', 'La experiencia congelada no coincide con su envelope.');
    }
    return recomputed;
  } catch (error: unknown) {
    if (isIcmAdapterFailure(error)) throw error;
    throw icmFailure('ENVELOPE_INVALID', 'La experiencia no cumple el contrato de envelope congelado.');
  }
}

function parseListedMemories(output: string): {
  memories: readonly z.infer<typeof ListedMemorySchema>[];
  rejectedCount: number;
} {
  let json: unknown;
  try {
    json = JSON.parse(output);
  } catch {
    throw icmFailure('READ_OUTPUT_INVALID', 'ICM devolvió una salida JSON inválida.');
  }
  const rows = parseOrFail(ListedMemoryArraySchema, json, 'READ_OUTPUT_INVALID', 'ICM no devolvió un array de memorias.');
  const memories: z.infer<typeof ListedMemorySchema>[] = [];
  let rejectedCount = 0;
  for (const row of rows) {
    const parsed = ListedMemorySchema.safeParse(row);
    if (parsed.success) memories.push(parsed.data);
    else rejectedCount += 1;
  }
  return { memories: Object.freeze(memories), rejectedCount };
}

function parseStoredMemoryId(output: string): IcmMemoryId {
  const match = /^Stored: ([0-7][0-9A-HJKMNP-TV-Z]{25})(?: \(\+\d+ links?\))?$/u.exec(output.trim());
  if (match?.[1] === undefined) {
    throw icmFailure('STORE_OUTPUT_INVALID', 'ICM no confirmó el store con la salida reconocida para la versión fijada.');
  }
  const parsed = IcmMemoryIdSchema.safeParse(match[1]);
  if (!parsed.success) {
    throw icmFailure('STORE_OUTPUT_INVALID', 'ICM devolvió un ULID inválido.');
  }
  return parsed.data;
}

function topicForExperience(experience: Experience): string {
  return `experience-${experience.kind}`;
}

function writeControlledConfig(configPath: string, actorDirectory: string, privateRoot: string): void {
  ensurePrivateDirectory(actorDirectory, privateRoot);
  const content = [
    '[store.backup]',
    'enabled = false',
    '',
    '[memory]',
    'auto_consolidate_enabled = false',
    '',
    '[embeddings]',
    'enabled = false',
    '',
  ].join('\n');
  let status: ReturnType<typeof lstatSync> | undefined;
  try {
    status = lstatSync(configPath);
  } catch (error: unknown) {
    if (nodeErrorCode(error) !== 'ENOENT') throw icmFailure('CONFIG_INVALID', 'No se pudo validar la configuración privada de ICM.');
  }
  if (status === undefined) {
    try {
      const descriptor = openSync(configPath, 'wx', 0o600);
      try {
        writeFileSync(descriptor, content, { encoding: 'utf8' });
      } finally {
        closeSync(descriptor);
      }
    } catch (error: unknown) {
      if (nodeErrorCode(error) !== 'EEXIST') throw icmFailure('CONFIG_INVALID', 'No se pudo crear la configuración privada de ICM.');
    }
    try {
      status = lstatSync(configPath);
    } catch {
      throw icmFailure('CONFIG_INVALID', 'No se pudo reabrir la configuración privada de ICM.');
    }
  }
  if (status.isSymbolicLink() || !status.isFile() || status.nlink !== 1) {
    throw icmFailure('CONFIG_INVALID', 'La configuración ICM debe ser un archivo privado regular.');
  }
  const realConfigPath = realpathSync(configPath);
  if (!isPathInside(actorDirectory, realConfigPath) || !isPathInside(privateRoot, realConfigPath)) {
    throw icmFailure('CONFIG_INVALID', 'La configuración ICM sale del ámbito privado de la identidad.');
  }
  try {
    if (readFileSync(realConfigPath, 'utf8') !== content) {
      throw icmFailure('CONFIG_INVALID', 'La configuración ICM no coincide con los defaults cerrados del host.');
    }
    chmodSync(realConfigPath, 0o600);
  } catch (error: unknown) {
    if (isIcmAdapterFailure(error)) throw error;
    throw icmFailure('CONFIG_INVALID', 'No se pudo validar la configuración privada de ICM.');
  }
}

function ensurePrivateRoot(path: string): string {
  try {
    try {
      if (lstatSync(path).isSymbolicLink()) throw new Error('linked-root');
    } catch (error: unknown) {
      if (nodeErrorCode(error) !== 'ENOENT') throw error;
    }
    mkdirSync(path, { recursive: true, mode: 0o700 });
    if (lstatSync(path).isSymbolicLink()) throw new Error('linked-root');
    const root = realpathSync(path);
    if (!lstatSync(root).isDirectory()) throw new Error('not-directory');
    chmodSync(root, 0o700);
    return root;
  } catch {
    throw icmFailure('ACTOR_PATH_INVALID', 'No se pudo establecer el directorio privado de ICM.');
  }
}

function ensurePrivateDirectory(path: string, boundary: string): string {
  try {
    if (!isPathInside(boundary, path)) throw new Error('outside-boundary');
    let current = boundary;
    for (const segment of relative(boundary, path).split(sep).filter(Boolean)) {
      current = join(current, segment);
      let status: ReturnType<typeof lstatSync>;
      try {
        status = lstatSync(current);
      } catch (error: unknown) {
        if (nodeErrorCode(error) !== 'ENOENT') throw error;
        try { mkdirSync(current, { mode: 0o700 }); }
        catch (creationError: unknown) { if (nodeErrorCode(creationError) !== 'EEXIST') throw creationError; }
        status = lstatSync(current);
      }
      if (status.isSymbolicLink() || !status.isDirectory() || realpathSync(current) !== current) {
        throw new Error('linked-directory');
      }
      chmodSync(current, 0o700);
    }
    return current;
  } catch {
    throw icmFailure('ACTOR_PATH_INVALID', 'Una ruta privada de ICM salió de la raíz controlada por el host.');
  }
}

function ensureDatabaseFile(path: string, actorDirectory: string, privateRoot: string, create: boolean): boolean {
  ensurePrivateDirectory(actorDirectory, privateRoot);
  if (!validateDatabaseFiles(path, actorDirectory, privateRoot)) {
    if (!create) return false;
    try {
      const descriptor = openSync(path, 'wx', 0o600);
      closeSync(descriptor);
    } catch (error: unknown) {
      if (nodeErrorCode(error) !== 'EEXIST') throw icmFailure('DATABASE_PATH_INVALID', 'No se pudo crear el archivo SQLite privado.');
    }
    return ensureDatabaseFile(path, actorDirectory, privateRoot, false);
  }
  try {
    chmodSync(path, 0o600);
  } catch {
    throw icmFailure('DATABASE_PATH_INVALID', 'La base SQLite salió del ámbito privado de la identidad.');
  }
  return true;
}

/** Validate the whole SQLite family before any chmod or CLI can touch its files. */
function validateDatabaseFiles(path: string, actorDirectory: string, privateRoot: string): boolean {
  let mainExists = false;
  for (const candidate of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) {
    try {
      const status = lstatSync(candidate);
      if (status.isSymbolicLink() || !status.isFile() || status.nlink !== 1) {
        throw icmFailure('DATABASE_PATH_INVALID', 'SQLite ICM requiere archivos regulares privados sin enlaces compartidos.');
      }
      const canonicalPath = realpathSync(candidate);
      if (!isPathInside(actorDirectory, canonicalPath) || !isPathInside(privateRoot, canonicalPath)) {
        throw icmFailure('DATABASE_PATH_INVALID', 'Un archivo SQLite ICM sale del ámbito privado de la identidad.');
      }
      if (candidate === path) mainExists = true;
    } catch (error: unknown) {
      if (isIcmAdapterFailure(error)) throw error;
      if (nodeErrorCode(error) !== 'ENOENT') throw icmFailure('DATABASE_PATH_INVALID', 'No se pudo validar un archivo SQLite privado de ICM.');
    }
  }
  return mainExists;
}

function resolveExecutable(path: string): string {
  try {
    const realPath = realpathSync(path);
    if (!lstatSync(realPath).isFile()) throw new Error('not-file');
    return realPath;
  } catch {
    throw icmFailure('CLI_EXECUTION_FAILED', 'El binario ICM fijado por el host no está disponible.');
  }
}

function isPathInside(root: string, path: string): boolean {
  const childPath = relative(root, path);
  return childPath === '' || (childPath !== '..' && !childPath.startsWith(`..${sep}`) && !isAbsolute(childPath));
}

function nodeErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code;
  return undefined;
}

function parseOrFail<T>(schema: z.ZodType<T>, value: unknown, code: IcmFailureCode, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw icmFailure(code, message);
  return parsed.data;
}

function icmFailure(code: IcmFailureCode, message: string): IcmAdapterFailure {
  const details = IcmFailureDataSchema.parse({ kind: 'icmAdapterFailure', code });
  return Object.assign(new Error(message), details);
}

function runBoundedProcess(input: {
  binaryPath: string;
  args: readonly string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}): Promise<string> {
  if (input.signal?.aborted) return Promise.reject(icmFailure('PROCESS_ABORTED', 'La operación ICM fue cancelada antes de iniciar.'));
  return new Promise<string>((resolveOutput, rejectOutput) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(input.binaryPath, [...input.args], {
        cwd: input.cwd,
        env: input.environment,
        shell: false,
        windowsHide: true,
        stdio: 'pipe',
      });
      const stdin = child.stdin;
      const stdoutStream = child.stdout;
      const stderrStream = child.stderr;
      if (stdin === null || stdoutStream === null || stderrStream === null) {
        child.kill('SIGKILL');
        rejectOutput(icmFailure('CLI_EXECUTION_FAILED', 'No se pudieron abrir los pipes controlados del proceso ICM.'));
        return;
      }
      stdin.end();
    } catch {
      rejectOutput(icmFailure('CLI_EXECUTION_FAILED', 'No se pudo iniciar el binario ICM.'));
      return;
    }

    const stdout: Buffer[] = [];
    let outputBytes = 0;
    let overflow = false;
    let aborted = false;
    let timedOut = false;
    let terminationRequested = false;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let killTimeout: NodeJS.Timeout | undefined;

    const cleanup = (): void => {
      if (timeout !== undefined) clearTimeout(timeout);
      if (killTimeout !== undefined) clearTimeout(killTimeout);
      input.signal?.removeEventListener('abort', onAbort);
    };
    const fail = (failure: IcmAdapterFailure): void => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectOutput(failure);
    };
    const terminate = (): void => {
      if (terminationRequested) return;
      terminationRequested = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // The close event remains the completion fence for the process.
      }
      killTimeout = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // The process may already have exited after SIGTERM.
        }
      }, 250);
    };
    const onAbort = (): void => {
      aborted = true;
      terminate();
    };

    input.signal?.addEventListener('abort', onAbort, { once: true });
    if (input.signal?.aborted) onAbort();
    timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, input.timeoutMs);

    const capture = (chunk: Buffer, keep: boolean): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > input.maxOutputBytes) {
        overflow = true;
        terminate();
        return;
      }
      if (keep) stdout.push(chunk);
    };
    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;
    if (stdoutStream === null || stderrStream === null) {
      child.kill('SIGKILL');
      fail(icmFailure('CLI_EXECUTION_FAILED', 'No se pudieron abrir los pipes controlados del proceso ICM.'));
      return;
    }
    stdoutStream.on('data', (chunk: Buffer) => capture(chunk, true));
    stderrStream.on('data', (chunk: Buffer) => capture(chunk, false));
    child.once('error', () => fail(icmFailure('CLI_EXECUTION_FAILED', 'No se pudo ejecutar el binario ICM.')));
    child.once('close', (exitCode) => {
      if (settled) return;
      if (aborted) {
        fail(icmFailure('PROCESS_ABORTED', 'La operación ICM fue cancelada; no se considera confirmada.'));
        return;
      }
      if (timedOut) {
        fail(icmFailure('PROCESS_TIMEOUT', 'La operación ICM excedió el timeout del host.'));
        return;
      }
      if (overflow) {
        fail(icmFailure('CLI_OUTPUT_LIMIT', 'La salida ICM superó el límite de bytes del host.'));
        return;
      }
      if (exitCode !== 0) {
        fail(icmFailure('CLI_EXIT_NONZERO', 'ICM terminó con error; su salida no se acepta como confirmación.'));
        return;
      }
      try {
        resolveOutput(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stdout)));
        settled = true;
        cleanup();
      } catch {
        fail(icmFailure('CLI_EXECUTION_FAILED', 'La salida ICM no es UTF-8 válido.'));
      }
    });
  });
}
