import assert from 'node:assert/strict';
import { DEFAULT_INFERENCE_PROFILE } from '../../src/domain/inference-profile.ts';
import { fingerprintInferenceProfile } from '../../src/application/pi-access-check.ts';
import { randomUUID } from 'node:crypto';
import type { openJournal } from '../../src/adapters/journal.ts';
import { ReadyRunConfigurationSchema } from '../../src/application/production-preflight.ts';
import { draftFixture } from './continuista.ts';

/** Synthetic preparation only: no actor jobs, sessions, experiences or fictional events. */
export function createCleanReadyPreflightFixture(input: {
  journal: ReturnType<typeof openJournal>;
  principalId?: string;
}) {
  const principalId = input.principalId ?? 'local-operator';
  const { kind: _kind, schemaVersion: _schemaVersion, runId: _runId, revision: _revision, ...patch } = draftFixture();
  const created = input.journal.createRunConfigurationDraft({ principalId, idempotencyKey: randomUUID(), patch });
  if (created.kind !== 'created') throw new Error('Synthetic preflight draft could not be created.');
  const promoted = input.journal.validateRunConfigurationDraft({
    principalId, idempotencyKey: randomUUID(), runId: created.draft.runId, expectedRevision: created.draft.revision,
  });
  if (promoted.kind !== 'ready') throw new Error('Synthetic preflight fixture could not be promoted to Ready.');
  const configuration = ReadyRunConfigurationSchema.parse(input.journal.readWorldConfiguration({ runId: created.draft.runId }));
  return { runId: configuration.runId, configuration, draft: created.draft };
}

export function recordSyntheticPassedPreflight(input:{journal:ReturnType<typeof openJournal>;runId:string}) {
 const {journal,runId}=input;
 const configuration=ReadyRunConfigurationSchema.parse(journal.readWorldConfiguration({runId}));
 const state=()=>{const current=journal.readWorldLifecycle({runId});assert.ok(current);return current;};

    // Explicit synthetic inference proof: this suite checks final local voice admission, without calling either provider.
    const profileFingerprint = fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE);
    const accountFingerprint = 'a'.repeat(64);
    const access = journal.createPiAccessJob({ principalId: 'operator', idempotencyKey: randomUUID(), profile: DEFAULT_INFERENCE_PROFILE });
    assert.equal(access.kind, 'created'); if (access.kind !== 'created') assert.fail();
    const lease = { ownerToken: randomUUID(), claimToken: randomUUID() };
    assert.equal(journal.claimPiAccessJob({ jobId: access.job.jobId, expectedRevision: 0, ...lease }).kind, 'claimed');
    const checkedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 120_000).toISOString();
    assert.equal(journal.completePiAccessJob({ jobId: access.job.jobId, expectedRevision: 1, lease, checkedAt, expiresAt, result: {
      kind: 'passed', provider: DEFAULT_INFERENCE_PROFILE.provider, requestedProfile: DEFAULT_INFERENCE_PROFILE, profileFingerprint, accountFingerprint,
      effectiveProfile: { provider: DEFAULT_INFERENCE_PROFILE.provider, api: DEFAULT_INFERENCE_PROFILE.api, model: DEFAULT_INFERENCE_PROFILE.model, providerThinkingLevel: DEFAULT_INFERENCE_PROFILE.reasoningEffort, reasoningEvidence: 'sdk-payload-and-response' },
      measuredUsage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
    } }).kind, 'updated');
    const current = state();
    const started = journal.createRunPreflightJob({ principalId: 'operator', idempotencyKey: randomUUID(), runId, expectedConfigurationRevision: current.configRevision, expectedWorldRevision: current.worldRevision });
    assert.equal(started.kind, 'created'); if (started.kind !== 'created') assert.fail();
    assert.equal(journal.claimRunPreflightJob({ runId, jobId: started.job.jobId, expectedRevision: 0, ...lease }).kind, 'claimed');
    const frozen = journal.readRunPreflightJobInput({ runId, jobId: started.job.jobId, lease });
    assert.equal(frozen.kind, 'found'); if (frozen.kind !== 'found') assert.fail();
    assert.equal(journal.completeRunPreflightJob({ runId, jobId: started.job.jobId, expectedRevision: 1, lease, evaluation: {
      fence: frozen.fence,
      result: { kind: 'passed', checkedAt, checks: ['configuration', 'configuration-version', 'world-snapshot', 'prepared-contexts', 'catalog-eligibility', 'inference-profile', 'pi-sdk', 'pi-profile', 'provider-authentication', 'pi-runtime', 'icm-memory', 'budget', 'provider-access-check', 'participant-availability', 'voice',...(configuration.icmWorkspace===undefined?[]:['icm-context-runtime'])].map(checkId => ({ kind: 'passed', checkId })) },
      evidence: { provider: DEFAULT_INFERENCE_PROFILE.provider, profileFingerprint, accountFingerprint, accessReceipt: { jobId: access.job.jobId, provider: DEFAULT_INFERENCE_PROFILE.provider, profileFingerprint, accountFingerprint, resultKind: 'passed', checkedAt, expiresAt } },
    } }).kind, 'updated');
    return started.job.jobId;
}
