import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { openJournal } from '../src/adapters/journal.ts';
import { createIcmMemoryAdapter } from '../src/adapters/icm.ts';
import { freezeExperience } from '../src/application/experience-envelope.ts';
import { PiRuntime } from '../src/adapters/pi.ts';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { createPiAuthFingerprint } from '../src/application/pi-auth-fingerprint.ts';
import { createProductionPreflightHost } from '../src/application/production-preflight-host.ts';
import { createProductionPreflightPort, validateRunConfiguration } from '../src/application/production-preflight.ts';
import { RunModelTimeBudgetSchema } from '../src/domain/model-time-budget.ts';
import { DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { fingerprintInferenceProfile } from '../src/application/pi-access-check.ts';
import { CharacterIdSchema, HashSchema } from '../src/domain/values.ts';
import type { PiAccessCheckStoredResult } from '../src/domain/pi-access-jobs.ts';
import { setup, draftFixture, canonical } from './fixtures/continuista.ts';

const files = (directory: string) => readdirSync(directory, { recursive: true }).map(String).sort();
async function fullSetup() {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-host-preflight-'));
  const journal = openJournal({ path: join(directory, 'world.sqlite') });
  const parsed = validateRunConfiguration({ draft: draftFixture() });
  if (parsed.kind !== 'ready') throw new Error('Synthetic fixture must be structurally Ready');
  const configuration = parsed.configuration;
  journal.registerWorldRun({ initialSnapshot: configuration.worldSnapshot, configurationRevision: configuration.configRevision, configuration, lifecycle: 'ready',
    continuityFence: { kind: 'prepared-contexts', atWorldSeq: configuration.worldSnapshot.seq, contexts: configuration.roster.preparedCharacters.map((prepared) => ({ actorId: prepared.characterId, continuityId: prepared.continuity.continuityId, continuityRevision: prepared.continuity.revision, continuityContentHash: prepared.continuity.contentHash, preparedContextHash: createHash('sha256').update(canonical(prepared)).digest('hex'), identityVersion: prepared.identityVersion })) } });
  const runtime = await PiRuntime.create({ privateDataRoot: directory });
  return { directory, journal, configuration, runtime, close() { journal.close(); rmSync(directory, { recursive: true, force: true }); } };
}
test('host preflight lee journal/catalog/SDK reales y conserva world/config/files sin sesiones ni provider calls', async () => {
  const fixture = await fullSetup();
  try {
    const authentication = createPiAuthFingerprint({ privateDataRoot: fixture.directory, environment: {} });
    const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
    const host = createProductionPreflightHost({ journal: fixture.journal, catalog, piRuntime: fixture.runtime, authentication });
    const beforeFiles = files(fixture.directory);
    const beforeConfiguration = fixture.journal.readWorldConfiguration({ runId: fixture.configuration.runId });
    const beforeWorld = fixture.journal.loadWorld({ runId: fixture.configuration.runId });
    assert.deepEqual(await host.readCurrentConfigurationRevision({ runId: fixture.configuration.runId }), { kind: 'loaded', revision: fixture.configuration.configRevision });
    const prepared = await host.loadPreparedActorContexts({ runId: fixture.configuration.runId, characterIds: [fixture.configuration.roster.activeCharacterIds[0] ?? CharacterIdSchema.parse('missing')] });
    assert.equal(JSON.stringify(prepared).includes('SECRET_OTHER_PREPARATION'), false);
    assert.equal(JSON.stringify(prepared).includes('SECRET_PRIVATE_OTHER_MEMORY'), false);
    const sdk = await host.readPiSdkStatus(); assert.deepEqual(sdk, { kind: 'ready', piCodingAgentVersion: '1.2.0', piAiVersion: '1.2.0', sessionFactoryAvailable: true });
    for (const provider of ['openai-codex', 'anthropic'] as const) {
      const profile = await host.readPiModelProfile({ provider }); assert.equal(typeof profile, 'object'); assert.match(JSON.stringify(profile), /configured/);
    }
    const report = await createProductionPreflightPort({ host }).preflight({ configuration: fixture.configuration, observedAt: new Date().toISOString() });
    assert.equal(report.kind, 'blocked'); if (report.kind !== 'blocked') throw new Error('Expected blocked');
    assert.ok(report.checks.some((check) => check.kind === 'unavailable' && check.code === 'director-runtime-unavailable'), JSON.stringify(report.checks));
    assert.ok(report.checks.some((check) => check.kind === 'passed' && check.checkId === 'budget'), 'A virgin known ledger has actual available quota; other incomplete roles still block the run');
    assert.ok(report.checks.some((check) => check.kind === 'unavailable' && check.code === 'icm-binary-not-configured'));
    assert.equal(JSON.stringify(report).includes('SECRET_OTHER_PREPARATION'), false);
    assert.deepEqual(fixture.journal.readWorldConfiguration({ runId: fixture.configuration.runId }), beforeConfiguration);
    assert.deepEqual(fixture.journal.loadWorld({ runId: fixture.configuration.runId }), beforeWorld);
    assert.deepEqual(files(fixture.directory), beforeFiles, 'Preflight does not create directories, sessions or ICM databases');
  } finally { fixture.close(); }
});

test('budget host usa conteos medidos del journal y bloquea legacy desconocido, incertidumbre y scope diferente', async () => {
  const fixture = await fullSetup();
  try {
    const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
    const authentication = createPiAuthFingerprint({ privateDataRoot: fixture.directory, environment: {} });
    const request = { runId: fixture.configuration.runId, budget: fixture.configuration.budget };
    const observed = RunModelTimeBudgetSchema.parse(fixture.journal.readRunModelTimeBudget({ runId: request.runId }));
    assert.equal(observed.status, 'known');
    const host = createProductionPreflightHost({ journal: fixture.journal, catalog, piRuntime: fixture.runtime, authentication });
    assert.deepEqual(await host.readRunBudgetReadiness(request), { kind: 'available', runCallsUsed: observed.runCallsUsed,
      pulseCallsUsed: observed.pulseCallsUsed, activePiRequests: observed.activePiRequests, wallTimeUsedMs: observed.wallTimeMeasuredMs });
    for (const variant of [
      { value: RunModelTimeBudgetSchema.parse({ ...observed, status: 'legacy-unknown', wallTimeMeasuredMs: null, wallTimeRemainingMs: null, unknownLegacyRequests: 1 }), code: 'run-wall-time-legacy-unknown' },
      { value: RunModelTimeBudgetSchema.parse({ ...observed, status: 'uncertain', uncertainRequests: 1 }), code: 'run-wall-time-uncertain' },
      { value: RunModelTimeBudgetSchema.parse({ ...observed, maxWallTimeMs: observed.maxWallTimeMs + 1 }), code: 'run-budget-scope-mismatch' },
      { value: RunModelTimeBudgetSchema.parse({ ...observed, wallTimeRemainingMs: 0 }), code: 'budget-exhausted' },
    ]) {
      const unavailable = createProductionPreflightHost({ journal: { ...fixture.journal, readRunModelTimeBudget() { return variant.value; } }, catalog, piRuntime: fixture.runtime, authentication });
      assert.deepEqual(await unavailable.readRunBudgetReadiness(request), { kind: 'unavailable', code: variant.code });
    }
    const missing = createProductionPreflightHost({ journal: { ...fixture.journal, readRunModelTimeBudget() { throw new Error('PRIVATE_STORAGE_PATH'); } }, catalog, piRuntime: fixture.runtime, authentication });
    assert.deepEqual(await missing.readRunBudgetReadiness(request), { kind: 'unavailable', code: 'run-budget-unavailable' });
  } finally { fixture.close(); }
});

test('evidencia privada captura exactamente lo observado y no consulta otra credencial al leerla después', async () => {
  const fixture = await setup();
  try {
    const authPath = join(fixture.directory, 'pi', 'auth', 'auth.json');
    const originalCredential = { 'openai-codex': { type: 'oauth', access: 'synthetic-access', refresh: 'synthetic-refresh', expires: Date.now() + 86_400_000 } };
    writeFileSync(authPath, JSON.stringify(originalCredential), { mode: 0o600 });
    const authentication = createPiAuthFingerprint({ privateDataRoot: fixture.directory, environment: {} });
    const current = await authentication.readCredentialFingerprint({ provider: 'openai-codex' }); assert.ok(current);
    const profileFingerprint = HashSchema.parse(fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE));
    const created = fixture.journal.createPiAccessJob({ principalId: 'local-operator', idempotencyKey: randomUUID(), profile: DEFAULT_INFERENCE_PROFILE }); if (created.kind !== 'created') throw new Error('Expected created');
    const claim = fixture.journal.claimPiAccessJob({ jobId: created.job.jobId, expectedRevision: created.job.revision, ownerToken: randomUUID(), claimToken: randomUUID() }); if (claim.kind !== 'claimed') throw new Error('Expected claimed');
    const checkedAt = new Date().toISOString();
    fixture.journal.completePiAccessJob({ jobId: created.job.jobId, expectedRevision: claim.job.revision, lease: claim.lease, result: { kind: 'passed', provider: 'openai-codex', requestedProfile: DEFAULT_INFERENCE_PROFILE, profileFingerprint, accountFingerprint: current, effectiveProfile: { provider: 'openai-codex', api: 'openai-codex-responses', model: 'gpt-6.1-sol', providerThinkingLevel: null, reasoningEvidence: 'sdk-payload-and-response' }, measuredUsage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } }, checkedAt, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const host = createProductionPreflightHost({ journal: fixture.journal, catalog: await loadCatalog({ repositoryRoot: process.cwd() }), piRuntime: fixture.runtime, authentication });
    await host.readPiModelProfile({ provider: 'openai-codex' }); await host.readInferenceAuthenticationStatus({ provider: 'openai-codex' });
    const receipt = await host.readInferenceAccessCheckReceipt({ provider: 'openai-codex', accountFingerprint: HashSchema.parse(current), profileFingerprint });
    assert.match(JSON.stringify(receipt), /passed/);
    const frozen = host.readPrivateEvidence({ configuration: fixture.configuration });
    assert.equal(frozen.accessReceipt?.jobId, created.job.jobId); assert.equal(frozen.accountFingerprint, current);
    for (const outcome of [
      { kind: 'aborted', code: 'CANCELLED_BEFORE_DISPATCH' },
      { kind: 'ambiguous', code: 'TIMEOUT' },
      { kind: 'failed', code: 'AUTH_REQUIRED' },
    ] as const) {
      const next = fixture.journal.createPiAccessJob({ principalId: 'local-operator', idempotencyKey: randomUUID(), profile: DEFAULT_INFERENCE_PROFILE });
      if (next.kind !== 'created') throw new Error('Expected new diagnostic job');
      const nextClaim = fixture.journal.claimPiAccessJob({ jobId: next.job.jobId, expectedRevision: next.job.revision, ownerToken: randomUUID(), claimToken: randomUUID() });
      if (nextClaim.kind !== 'claimed') throw new Error('Expected claimed diagnostic job');
      const result: PiAccessCheckStoredResult = { ...outcome, provider: 'openai-codex', requestedProfile: DEFAULT_INFERENCE_PROFILE, profileFingerprint, accountFingerprint: null };
      // Identical timestamps still obey durable insertion order, not wall-clock ordering.
      fixture.journal.completePiAccessJob({ jobId: next.job.jobId, expectedRevision: nextClaim.job.revision, lease: nextClaim.lease, result, checkedAt, expiresAt: new Date(Date.now() + 60_000).toISOString() });
      const freshHost = createProductionPreflightHost({ journal: fixture.journal, catalog: await loadCatalog({ repositoryRoot: process.cwd() }), piRuntime: fixture.runtime, authentication });
      await freshHost.readPiModelProfile({ provider: 'openai-codex' });
      await freshHost.readInferenceAuthenticationStatus({ provider: 'openai-codex' });
      assert.deepEqual(await freshHost.readInferenceAccessCheckReceipt({ provider: 'openai-codex', accountFingerprint: HashSchema.parse(current), profileFingerprint }), { kind: 'missing', provider: 'openai-codex' }, outcome.kind);
      assert.equal(freshHost.readPrivateEvidence({ configuration: fixture.configuration }).accessReceipt, null);
    }
    writeFileSync(authPath, JSON.stringify({ 'openai-codex': { ...originalCredential['openai-codex'], access: 'changed-synthetic-account' } }));
    const credentialBytes = readFileSync(authPath, 'utf8');
    assert.deepEqual(host.readPrivateEvidence({ configuration: fixture.configuration }), frozen, 'No later auth read can rewrite the observed evidence');
    assert.equal(readFileSync(authPath, 'utf8'), credentialBytes, 'Evidence never refreshes auth');
  } finally { fixture.close(); }
});


test('schema SQLite sintético incompleto se rechaza readonly; preflight nunca provisiona una base ausente', async () => {
  const fixture = await fullSetup();
  try {
    const binary = join(fixture.directory, 'synthetic-icm-version');
    writeFileSync(binary, '#!/bin/sh\nif [ "$1" = "--version" ]; then printf "icm 0.11.4\\n"; else printf "[]\\n"; fi\n', { mode: 0o700 });
    const host = createProductionPreflightHost({ journal: fixture.journal, catalog: await loadCatalog({ repositoryRoot: process.cwd() }), piRuntime: fixture.runtime, authentication: createPiAuthFingerprint({ privateDataRoot: fixture.directory, environment: {} }), icmBinaryPath: binary });
    const request = { runId: fixture.configuration.runId, actorIds: fixture.configuration.roster.activeCharacterIds };
    const initial = files(fixture.directory);
    assert.deepEqual(await host.readIcmMemoryReadiness(request), { kind: 'unavailable', code: 'icm-private-storage-unavailable' });
    assert.deepEqual(files(fixture.directory), initial);
    const paths: string[] = [];
    for (const actorId of request.actorIds) {
      const directory = join(fixture.directory, 'runs', request.runId, 'actors', actorId);
      for (const path of [join(fixture.directory, 'runs'), join(fixture.directory, 'runs', request.runId), join(fixture.directory, 'runs', request.runId, 'actors'), directory, join(directory, 'home'), join(directory, 'tmp')]) mkdirSync(path, { recursive: true, mode: 0o700 });
      writeFileSync(join(directory, 'icm-config.toml'), '[store.backup]\nenabled = false\n\n[memory]\nauto_consolidate_enabled = false\n\n[embeddings]\nenabled = false\n', { mode: 0o600 });
      const path = join(directory, 'memory.sqlite'); writeFileSync(path, '', { mode: 0o600 });
      const database = new DatabaseSync(path); database.exec('CREATE TABLE memories (id TEXT PRIMARY KEY, topic TEXT, summary TEXT)'); database.close(); paths.push(path);
    }
    const before = paths.map((path) => readFileSync(path)); const beforeFiles = files(fixture.directory);
    const result = await host.readIcmMemoryReadiness(request);
    assert.deepEqual(result, { kind: 'unavailable', code: 'icm-private-storage-unavailable' });
    assert.deepEqual(paths.map((path) => readFileSync(path)), before); assert.deepEqual(files(fixture.directory), beforeFiles);
    // This covers readonly physical checks and a controlled CLI protocol, not native ICM backend or migrations.
  } finally { fixture.close(); }
});


test('ICM 0.11.4 nativo provisionado fuera del preflight se reabre readonly y conserva bytes del SQLite', { skip: !existsSync('/tmp/personajes-icm-0.11.4-audit/install/bin/icm') }, async () => {
  const fixture = await fullSetup();
  let provisionedConnection: DatabaseSync | undefined;
  try {
    const binaryPath = '/tmp/personajes-icm-0.11.4-audit/install/bin/icm';
    const actorId = fixture.configuration.roster.activeCharacterIds[0]; assert.ok(actorId);
    const memory = await createIcmMemoryAdapter({ privateDataRoot: fixture.directory, runId: fixture.configuration.runId, actorId, binaryPath, ledger: { findReceipt: () => undefined } });
    await memory.projector.store(freezeExperience({ schemaVersion: 1, experienceId: randomUUID(), runId: fixture.configuration.runId, actorId, kind: 'belief', content: 'Synthetic owned belief, not a canonical character fact.', sourceRefs: [], fictitiousAt: fixture.configuration.fictionalAt, receivedAt: fixture.configuration.fictionalAt, worldSeq: fixture.configuration.worldSnapshot.seq, confidence: 0.5, revision: 0, predecessor: { kind: 'initial' }, basedOn: [] }));
    const path = join(fixture.directory, 'runs', fixture.configuration.runId, 'actors', actorId, 'memory.sqlite');
    const host = createProductionPreflightHost({ journal: fixture.journal, catalog: await loadCatalog({ repositoryRoot: process.cwd() }), piRuntime: fixture.runtime, authentication: createPiAuthFingerprint({ privateDataRoot: fixture.directory }), icmBinaryPath: binaryPath });
    const absentSidecarsFiles = files(fixture.directory);
    assert.deepEqual(await host.readIcmMemoryReadiness({ runId: fixture.configuration.runId, actorIds: [actorId] }), { kind: 'unavailable', code: 'icm-readonly-sidecars-not-provisioned' });
    assert.deepEqual(files(fixture.directory), absentSidecarsFiles, 'Readonly preflight does not provision WAL sidecars');
    // Explicit test provisioning retains the sidecars, outside the preflight call.
    provisionedConnection = new DatabaseSync(path);
    provisionedConnection.prepare('SELECT count(*) FROM memories').get();
    const before = readFileSync(path); const beforeFiles = files(fixture.directory);
    const result = await host.readIcmMemoryReadiness({ runId: fixture.configuration.runId, actorIds: [actorId] });
    assert.match(JSON.stringify(result), /recoverable/, JSON.stringify(result));
    assert.deepEqual(readFileSync(path), before, 'No decay, access counters, schema migration or content writes');
    assert.deepEqual(files(fixture.directory), beforeFiles);
  } finally { provisionedConnection?.close(); fixture.close(); }
});
