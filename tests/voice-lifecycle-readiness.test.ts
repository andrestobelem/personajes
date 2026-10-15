import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { openLocalHost } from '../src/application/local-host.ts';
import { createVoiceRuntime } from '../src/application/voice-runtime.ts';
import { createRunLifecycleApplication } from '../src/application/run-lifecycle.ts';
import { createRunPreflightJobs } from '../src/application/run-preflight-jobs.ts';
import { fingerprintInferenceProfile } from '../src/application/pi-access-check.ts';
import { DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { draftFixture, worldFixture } from './fixtures/continuista.ts';

function fixture(fictionalTime?: number) {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-voice-lifecycle-'));
  const host = openLocalHost({ privateDataRoot: directory });
  const voices = createVoiceRuntime({ host });
  const { kind, schemaVersion, revision, runId: oldRunId, ...patch } = draftFixture(fictionalTime === undefined ? {} : { moment: fictionalTime, world: worldFixture({ time: fictionalTime }) });
  const created = host.journal.createRunConfigurationDraft({ principalId: 'operator', idempotencyKey: randomUUID(), patch });
  assert.equal(created.kind, 'created'); if (created.kind !== 'created') assert.fail();
  const runId = created.draft.runId;
  assert.equal(host.journal.validateRunConfigurationDraft({ principalId: 'operator', idempotencyKey: randomUUID(), runId, expectedRevision: 0 }).kind, 'ready');
  const state = () => { const value = host.journal.readWorldLifecycle({ runId }); assert.ok(value); return value; };
  function passedPreflight() {
    // Explicit synthetic inference proof: this suite checks final local voice admission, without calling either provider.
    const profileFingerprint = fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE);
    const accountFingerprint = 'a'.repeat(64);
    const access = host.journal.createPiAccessJob({ principalId: 'operator', idempotencyKey: randomUUID(), profile: DEFAULT_INFERENCE_PROFILE });
    assert.equal(access.kind, 'created'); if (access.kind !== 'created') assert.fail();
    const lease = { ownerToken: randomUUID(), claimToken: randomUUID() };
    assert.equal(host.journal.claimPiAccessJob({ jobId: access.job.jobId, expectedRevision: 0, ...lease }).kind, 'claimed');
    const checkedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 120_000).toISOString();
    assert.equal(host.journal.completePiAccessJob({ jobId: access.job.jobId, expectedRevision: 1, lease, checkedAt, expiresAt, result: {
      kind: 'passed', provider: DEFAULT_INFERENCE_PROFILE.provider, requestedProfile: DEFAULT_INFERENCE_PROFILE, profileFingerprint, accountFingerprint,
      effectiveProfile: { provider: DEFAULT_INFERENCE_PROFILE.provider, api: DEFAULT_INFERENCE_PROFILE.api, model: DEFAULT_INFERENCE_PROFILE.model, providerThinkingLevel: DEFAULT_INFERENCE_PROFILE.reasoningEffort, reasoningEvidence: 'sdk-payload-and-response' },
      measuredUsage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
    } }).kind, 'updated');
    const current = state();
    const started = host.journal.createRunPreflightJob({ principalId: 'operator', idempotencyKey: randomUUID(), runId, expectedConfigurationRevision: current.configRevision, expectedWorldRevision: current.worldRevision });
    assert.equal(started.kind, 'created'); if (started.kind !== 'created') assert.fail();
    assert.equal(host.journal.claimRunPreflightJob({ runId, jobId: started.job.jobId, expectedRevision: 0, ...lease }).kind, 'claimed');
    const frozen = host.journal.readRunPreflightJobInput({ runId, jobId: started.job.jobId, lease });
    assert.equal(frozen.kind, 'found'); if (frozen.kind !== 'found') assert.fail();
    assert.equal(host.journal.completeRunPreflightJob({ runId, jobId: started.job.jobId, expectedRevision: 1, lease, evaluation: {
      fence: frozen.fence,
      result: { kind: 'passed', checkedAt, checks: ['configuration', 'configuration-version', 'world-snapshot', 'prepared-contexts', 'catalog-eligibility', 'inference-profile', 'pi-sdk', 'pi-profile', 'provider-authentication', 'pi-runtime', 'icm-memory', 'budget', 'provider-access-check', 'participant-availability', 'voice'].map(checkId => ({ kind: 'passed', checkId })) },
      evidence: { provider: DEFAULT_INFERENCE_PROFILE.provider, profileFingerprint, accountFingerprint, accessReceipt: { jobId: access.job.jobId, provider: DEFAULT_INFERENCE_PROFILE.provider, profileFingerprint, accountFingerprint, resultKind: 'passed', checkedAt, expiresAt } },
    } }).kind, 'updated');
    return started.job.jobId;
  }
  let reads = 0, schedules = 0;
  const app = createRunLifecycleApplication({ journal: host.journal,
    preflights: { readJob(scope) { const value = host.journal.readRunPreflightJob(scope); return value.kind === 'found' ? value.document : undefined; } },
    runtime: { async scheduleRun() { schedules++; return true; }, async cancelRun() { return true; } },
    readVoiceReadiness(request) { reads++; return voices.readPreflightReadiness(request); },
  });
  const command = (command: unknown) => { const current = state(); return { principalId: 'operator', idempotencyKey: randomUUID(), runId, expectedConfigurationRevision: current.configRevision, expectedWorldRevision: current.worldRevision, expectedStructureRevision: host.journal.readDramaticStructure({ runId })?.structureRevision ?? 0, expectedLifecycleRevision: current.lifecycleRevision, command }; };
  return { host, voices, runId, app, state, command, passedPreflight, get reads() { return reads; }, get schedules() { return schedules; },
    async close() { await voices.close(); host.close(); rmSync(directory, { recursive: true, force: true }); rmSync(`${directory}-auth`, { recursive: true, force: true }); } };
}

test('real preflight broker supplies lifecycle documents and preserves credential freshness at start', async () => {
  const f = fixture();
  let fingerprint: string | undefined = 'a'.repeat(64);
  const broker = await createRunPreflightJobs({ journal: f.host.journal, ownerToken: f.host.ownerToken,
    createHost() { throw new Error('Admission must not reevaluate the preflight'); },
    async readCredentialFingerprint() { return fingerprint; },
  });
  let schedules = 0;
  const app = createRunLifecycleApplication({ journal: f.host.journal,
    preflights: { readJob: broker.readLifecycleDocument },
    runtime: { async scheduleRun() { schedules++; return true; }, async cancelRun() { return true; } },
    readVoiceReadiness: request => f.voices.readPreflightReadiness(request),
  });
  try {
    const preflightJobId = f.passedPreflight();
    assert.equal(await broker.readLifecycleDocument({ runId: f.runId, jobId: randomUUID() }), undefined);
    fingerprint = undefined;
    assert.equal((await app.controlRun(f.command({ kind: 'start', preflightJobId }))).kind, 'preflightStale');
    assert.equal(schedules, 0);
    fingerprint = 'a'.repeat(64);
    assert.equal((await app.controlRun(f.command({ kind: 'start', preflightJobId }))).kind, 'updated');
    assert.equal(schedules, 1);
  } finally { await broker.close(); await f.close(); }
});

test('audio enabled after a passed preflight blocks start without advancing lifecycle; an accepted replay does not reread audio', async () => {
  const f = fixture(); try {
    const jobId = f.passedPreflight();
    const previous = f.voices.config.read(f.runId);
    f.voices.config.update({ runId: f.runId, principal: 'operator', operationId: randomUUID(), expectedRevision: previous.config.revision,
      settings: { audioMode: { kind: 'enabled', language: 'es', ttsMode: 'manual-per-publication', ttsModelId: 'synthetic-model', outputFormat: 'mp3_44100_128', subtitles: true }, speakerSlots: previous.config.speakerSlots, narratorSlot: previous.config.narratorSlot, soundEffectSlots: previous.config.soundEffectSlots, quotaLimits: previous.quotaLimits } });
    const before = f.state();
    assert.equal((await f.app.controlRun(f.command({ kind: 'start', preflightJobId: jobId }))).kind, 'preflightBlocked');
    assert.deepEqual(f.state(), before); assert.equal(f.schedules, 0);
    const current = f.voices.config.read(f.runId);
    f.voices.config.update({ runId: f.runId, principal: 'operator', operationId: randomUUID(), expectedRevision: current.config.revision,
      settings: { audioMode: { kind: 'disabled' }, speakerSlots: current.config.speakerSlots, narratorSlot: current.config.narratorSlot, soundEffectSlots: current.config.soundEffectSlots, quotaLimits: current.quotaLimits } });
    const start = f.command({ kind: 'start', preflightJobId: jobId });
    assert.equal((await f.app.controlRun(start)).kind, 'updated'); assert.equal(f.schedules, 1);
    const runningConfig = f.voices.config.read(f.runId);
    f.voices.config.update({ runId: f.runId, principal: 'operator', operationId: randomUUID(), expectedRevision: runningConfig.config.revision,
      settings: { audioMode: { kind: 'enabled', language: 'es', ttsMode: 'manual-per-publication', ttsModelId: 'synthetic-model', outputFormat: 'mp3_44100_128', subtitles: true }, speakerSlots: runningConfig.config.speakerSlots, narratorSlot: runningConfig.config.narratorSlot, soundEffectSlots: runningConfig.config.soundEffectSlots, quotaLimits: runningConfig.quotaLimits } });
    const reads = f.reads;
    const replay = await f.app.controlRun(start); assert.equal(replay.kind, 'updated'); if (replay.kind !== 'updated') assert.fail();
    assert.equal(replay.replayed, true); assert.equal(f.reads, reads); assert.equal(f.schedules, 1);
    assert.equal((await f.app.controlRun(f.command({ kind: 'pause' }))).kind, 'updated'); assert.equal(f.reads, reads);
  } finally { await f.close(); }
});

test('final local audio inspection runs after asynchronous preflight read and blocks resume and step, while pause and close remain available', async () => {
  const f = fixture(); try {
    assert.equal((await f.app.controlRun(f.command({ kind: 'start', preflightJobId: f.passedPreflight() }))).kind, 'updated');
    const reads = f.reads;
    const blockedApp = createRunLifecycleApplication({ journal: f.host.journal,
      preflights: { async readJob(scope) { const result = f.host.journal.readRunPreflightJob(scope); await Promise.resolve(); return result.kind === 'found' ? result.document : undefined; } },
      runtime: { async scheduleRun() { assert.fail('Unavailable audio cannot schedule actors'); }, async cancelRun() { return true; } },
      readVoiceReadiness() { return { kind: 'unavailable', code: 'voice-local-evidence-unavailable' }; },
    });
    assert.equal((await blockedApp.controlRun(f.command({ kind: 'pause' }))).kind, 'updated');
    const preflightJobId = f.passedPreflight(), before = f.state();
    for (const kind of ['resume', 'step']) {
      assert.equal((await blockedApp.controlRun(f.command({ kind, preflightJobId }))).kind, 'preflightBlocked');
      assert.deepEqual(f.state(), before);
    }
    assert.equal((await blockedApp.controlRun(f.command({ kind: 'close' }))).kind, 'updated'); assert.equal(f.reads, reads);
  } finally { await f.close(); }
});


test('a 1966 representation starts and records initial goal activation with its signed fictional instant', async () => {
  const instant = Date.UTC(1966, 5, 15, 14);
  const f = fixture(instant);
  try {
    const preflightJobId = f.passedPreflight();
    assert.equal((await f.app.controlRun(f.command({ kind: 'start', preflightJobId }))).kind, 'updated');
    assert.equal(f.state().lifecycle, 'running');
    assert.equal(f.schedules, 1);
    assert.equal(f.host.journal.loadWorld({ runId: f.runId })?.clock.instant, instant);
  } finally { await f.close(); }
});
