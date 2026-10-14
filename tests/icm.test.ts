import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { freezeExperience } from '../src/application/experience-envelope.ts';
import {
  createIcmMemoryAdapter,
  ICM_VERSION,
  isIcmAdapterFailure,
  type IcmMemoryId,
  type IcmProjectionLedger,
} from '../src/adapters/icm.ts';
import { CharacterIdSchema, ExperienceIdSchema, RunIdSchema, WorldSeqSchema } from '../src/domain/values.ts';

const realIcmBinary = process.env.PERSONAJES_ICM_TEST_BINARY;
const realCliTestOptions = {
  skip: realIcmBinary === undefined ? 'Definí PERSONAJES_ICM_TEST_BINARY para ejecutar el gate con ICM real.' : false,
};
const actorId = CharacterIdSchema.parse('maxwell-smart');
const otherActorId = CharacterIdSchema.parse('agente-99');
const runId = RunIdSchema.parse('00000000-0000-4000-8000-000000000501');
const otherRunId = RunIdSchema.parse('00000000-0000-4000-8000-000000000502');
const firstExperienceId = ExperienceIdSchema.parse('00000000-0000-4000-8000-000000000511');
const secondExperienceId = ExperienceIdSchema.parse('00000000-0000-4000-8000-000000000512');
const thirdExperienceId = ExperienceIdSchema.parse('00000000-0000-4000-8000-000000000513');
const spanishNegation = 'No escuché que el agente-99 hubiera salido.';

interface TestReceipt {
  memoryId: IcmMemoryId;
  experienceId: string;
  runId: string;
  actorId: string;
  worldSeq: number;
  canonicalPayload: string;
  payloadHash: string;
}

function frozenExperience(experienceId: string, worldSeq: number) {
  return freezeExperience({
    schemaVersion: 1,
    experienceId: ExperienceIdSchema.parse(experienceId),
    runId,
    actorId,
    kind: 'belief',
    content: spanishNegation,
    sourceRefs: [],
    fictitiousAt: worldSeq * 1_000,
    receivedAt: worldSeq * 1_000,
    worldSeq: WorldSeqSchema.parse(worldSeq),
    confidence: 0.75,
    revision: 0,
    predecessor: { kind: 'initial' },
    basedOn: [],
  });
}

function makeLedger(receipts: Map<IcmMemoryId, TestReceipt>): IcmProjectionLedger {
  return {
    findReceipt(input) {
      const receipt = receipts.get(input.memoryId);
      if (receipt === undefined || receipt.runId !== input.runId || receipt.actorId !== input.actorId ||
          receipt.worldSeq > input.throughWorldSeq) return undefined;
      return receipt;
    },
  };
}

function addReceipt(
  receipts: Map<IcmMemoryId, TestReceipt>,
  frozen: ReturnType<typeof frozenExperience>,
  memoryId: IcmMemoryId,
): void {
  receipts.set(memoryId, {
    memoryId,
    experienceId: frozen.envelope.experienceId,
    runId: frozen.envelope.runId,
    actorId: frozen.envelope.actorId,
    worldSeq: frozen.envelope.worldSeq,
    canonicalPayload: frozen.canonicalPayload,
    payloadHash: frozen.payloadHash,
  });
}

function makeFakeIcm(directory: string, afterVersion: string): string {
  const binaryPath = join(directory, 'icm-fixture');
  writeFileSync(binaryPath, `#!/bin/sh\nif [ "$1" = "--version" ]; then\n  printf 'icm ${ICM_VERSION}\\n'\n  exit 0\nfi\n${afterVersion}\n`, { mode: 0o700 });
  chmodSync(binaryPath, 0o700);
  return binaryPath;
}

test('ICM real 0.11.4 usa SQLite privado, replay conserva ULID y los UUID separan contenido igual', realCliTestOptions, async () => {
  assert.ok(realIcmBinary, 'faltó configurar el binario ICM real para este gate');
  const directory = mkdtempSync(join(tmpdir(), 'personajes-icm-real-'));
  const receipts = new Map<IcmMemoryId, TestReceipt>();
  const previous = new Map<string, string | undefined>([
    ['ICM_DB_BACKEND', process.env.ICM_DB_BACKEND],
    ['ICM_CONFIG', process.env.ICM_CONFIG],
    ['ICM_READONLY', process.env.ICM_READONLY],
  ]);
  try {
    process.env.ICM_DB_BACKEND = 'postgres';
    process.env.ICM_CONFIG = join(directory, 'ambient-invalid-config.toml');
    process.env.ICM_READONLY = '1';
    writeFileSync(process.env.ICM_CONFIG, 'this is invalid TOML = =');

    const adapter = await createIcmMemoryAdapter({
      privateDataRoot: directory,
      runId,
      actorId,
      binaryPath: realIcmBinary,
      ledger: makeLedger(receipts),
    });
    assert.deepEqual(await adapter.checkHealth(), { version: '0.11.4' });
    const first = frozenExperience(firstExperienceId, 1);
    const second = frozenExperience(secondExperienceId, 2);
    const firstStored = await adapter.projector.store(first);
    const retry = await adapter.projector.store(first);
    const secondStored = await adapter.projector.store(second);
    assert.equal(retry.memoryId, firstStored.memoryId);
    assert.notEqual(secondStored.memoryId, firstStored.memoryId);

    addReceipt(receipts, first, firstStored.memoryId);
    addReceipt(receipts, second, secondStored.memoryId);
    const recall = await adapter.actor.recall({ query: 'No escuché', limit: 20, throughWorldSeq: 2 });
    assert.equal(recall.source, 'ranked-recall');
    assert.ok(recall.experiences.some((item) => item.experience.content === spanishNegation));

    const forensic = await adapter.diagnostics.listForensic({ throughWorldSeq: 2 });
    assert.equal(forensic.source, 'forensic-list');
    assert.deepEqual(forensic.experiences.map((item) => item.experience.experienceId).sort(),
      [firstExperienceId, secondExperienceId].sort());
    assert.equal('listForensic' in adapter.actor, false);

    const firstReceipt = receipts.get(firstStored.memoryId);
    assert.ok(firstReceipt);
    for (const mismatchedReceipt of [
      { ...firstReceipt, actorId: otherActorId },
      { ...firstReceipt, runId: otherRunId },
      { ...firstReceipt, payloadHash: 'f'.repeat(64) },
    ]) {
      receipts.set(firstStored.memoryId, mismatchedReceipt);
      const invalid = await adapter.diagnostics.listForensic({ throughWorldSeq: 2 });
      assert.deepEqual(invalid.experiences.map((item) => item.experience.experienceId), [secondExperienceId]);
      assert.ok(invalid.rejectedCount >= 1);
    }
    receipts.set(firstStored.memoryId, firstReceipt);

    const cut = await adapter.diagnostics.listForensic({ throughWorldSeq: 1 });
    assert.deepEqual(cut.experiences.map((item) => item.experience.experienceId), [firstExperienceId]);
    const actorDirectory = join(directory, 'runs', runId, 'actors', actorId);
    const databasePath = join(actorDirectory, 'memory.sqlite');
    assert.equal(readFileSync(databasePath).subarray(0, 16).equals(Buffer.from('SQLite format 3\0')), true);
    assert.equal(statSync(databasePath).mode & 0o777, 0o600);
    assert.equal(statSync(join(actorDirectory, 'icm-config.toml')).mode & 0o777, 0o600);
    assert.match(readFileSync(join(actorDirectory, 'icm-config.toml'), 'utf8'), /enabled = false/u);
    assert.equal(statSync(actorDirectory).mode & 0o777, 0o700);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('ICM real reabre tras caída post-store/pre-receipt y el mismo envelope repara el receipt', realCliTestOptions, async () => {
  assert.ok(realIcmBinary, 'faltó configurar el binario ICM real para este gate');
  const directory = mkdtempSync(join(tmpdir(), 'personajes-icm-replay-'));
  const receipts = new Map<IcmMemoryId, TestReceipt>();
  try {
    const frozen = frozenExperience(thirdExperienceId, 3);
    const firstAdapter = await createIcmMemoryAdapter({
      privateDataRoot: directory,
      runId,
      actorId,
      binaryPath: realIcmBinary,
      ledger: makeLedger(receipts),
    });
    const beforeCrashReceipt = await firstAdapter.projector.store(frozen);
    const afterRestart = await createIcmMemoryAdapter({
      privateDataRoot: directory,
      runId,
      actorId,
      binaryPath: realIcmBinary,
      ledger: makeLedger(receipts),
    });
    const unresolved = await afterRestart.diagnostics.listForensic({ throughWorldSeq: 3 });
    assert.equal(unresolved.experiences.length, 0);
    assert.equal(unresolved.rejectedCount, 1);
    const replayed = await afterRestart.projector.store(frozen);
    assert.equal(replayed.memoryId, beforeCrashReceipt.memoryId);

    addReceipt(receipts, frozen, replayed.memoryId);
    const reconciled = await afterRestart.diagnostics.listForensic({ throughWorldSeq: 3 });
    assert.equal(reconciled.experiences.length, 1);
    assert.equal(reconciled.experiences[0]?.experience.experienceId, thirdExperienceId);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('ICM omite herencia ambient y rechaza salida de error con exit code 0', realCliTestOptions, async () => {
  assert.ok(realIcmBinary, 'faltó configurar el binario ICM real para este gate');
  const directory = mkdtempSync(join(tmpdir(), 'personajes-icm-env-'));
  const previousBackend = process.env.ICM_DB_BACKEND;
  const previousConfig = process.env.ICM_CONFIG;
  const previousReadonly = process.env.ICM_READONLY;
  try {
    process.env.ICM_DB_BACKEND = 'postgres';
    process.env.ICM_CONFIG = join(directory, 'bad-ambient-config.toml');
    process.env.ICM_READONLY = '1';
    writeFileSync(process.env.ICM_CONFIG, 'invalid TOML = =');
    const adapter = await createIcmMemoryAdapter({
      privateDataRoot: directory,
      runId,
      actorId,
      binaryPath: realIcmBinary,
      ledger: makeLedger(new Map()),
    });
    const frozen = frozenExperience(firstExperienceId, 1);
    await assert.rejects(
      adapter.projector.store({ ...frozen, canonicalPayload: `${frozen.canonicalPayload} ` }),
      (error: unknown) => isIcmAdapterFailure(error) && error.code === 'ENVELOPE_INVALID',
    );
    const readOnly = await adapter.actor.recall({ query: 'inexistente', limit: 1, throughWorldSeq: 1 });
    assert.deepEqual(readOnly.experiences, []);
    assert.equal(readOnly.rejectedCount, 0);

    const fakeDirectory = join(directory, 'fake');
    mkdirSync(fakeDirectory, { mode: 0o700 });
    const fakeBinary = makeFakeIcm(fakeDirectory, "printf 'operación fallida\\n'\nexit 0");
    const fakeAdapter = await createIcmMemoryAdapter({
      privateDataRoot: join(directory, 'fake-data'),
      runId,
      actorId,
      binaryPath: fakeBinary,
      ledger: makeLedger(new Map()),
    });
    await assert.rejects(
      fakeAdapter.projector.store(frozen),
      (error: unknown) => isIcmAdapterFailure(error) && error.code === 'STORE_OUTPUT_INVALID',
    );
  } finally {
    if (previousBackend === undefined) delete process.env.ICM_DB_BACKEND;
    else process.env.ICM_DB_BACKEND = previousBackend;
    if (previousConfig === undefined) delete process.env.ICM_CONFIG;
    else process.env.ICM_CONFIG = previousConfig;
    if (previousReadonly === undefined) delete process.env.ICM_READONLY;
    else process.env.ICM_READONLY = previousReadonly;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('ICM cancelación mata el proceso y un código de salida distinto de cero no confirma store', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-icm-process-'));
  try {
    const cancelledBinary = makeFakeIcm(directory, 'exec /bin/sleep 5');
    const cancelledAdapter = await createIcmMemoryAdapter({
      privateDataRoot: join(directory, 'cancelled-data'),
      runId,
      actorId,
      binaryPath: cancelledBinary,
      ledger: makeLedger(new Map()),
      limits: { processTimeoutMs: 2_000 },
    });
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 30);
    try {
      await assert.rejects(
        cancelledAdapter.projector.store(frozenExperience(firstExperienceId, 1), { signal: controller.signal }),
        (error: unknown) => isIcmAdapterFailure(error) && error.code === 'PROCESS_ABORTED',
      );
    } finally {
      clearTimeout(abortTimer);
    }

    const failureOutputBinary = makeFakeIcm(directory, "printf 'Stored: 01ARZ3NDEKTSV4RRFFQ69G5FAV\\n'\nexit 7");
    const failedAdapter = await createIcmMemoryAdapter({
      privateDataRoot: join(directory, 'failed-data'),
      runId,
      actorId,
      binaryPath: failureOutputBinary,
      ledger: makeLedger(new Map()),
      limits: { processTimeoutMs: 2_000 },
    });
    await assert.rejects(
      failedAdapter.projector.store(frozenExperience(secondExperienceId, 2)),
      (error: unknown) => isIcmAdapterFailure(error) && error.code === 'CLI_EXIT_NONZERO',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
