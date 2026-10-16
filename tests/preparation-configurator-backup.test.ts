import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { openLocalHost } from '../src/application/local-host.ts';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { createHostBackupQuiesce } from '../src/application/host-backup-quiesce.ts';
import { createIcmWorkspaceSnapshot } from '../src/domain/icm-workspace.ts';
import { sha256CanonicalJson, sha256Utf8 } from '../src/domain/canonical-json.ts';
import { DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';

test('backup gates preparation work and retains its physical Pi session even before any WorldRun exists', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'personajes-preparation-backup-')));
  const host = openLocalHost({ privateDataRoot: join(directory, 'host') });
  host.journal.setPreparationSourceAdmission(() => undefined);
  host.journal.setPreparationConfiguratorSourceResolver(() => ({ actorSources: [], documents: [] }));
  const evidence = { kind: 'operator-choice', operatorId: 'operator', recordedAt: '2026-10-16T12:00:00Z' };
  const created = host.journal.createRunConfigurationDraft({ principalId: 'operator', idempotencyKey: randomUUID(), patch: {
    budget: { kind: 'configured', evidence, value: { maxPiCallsPerRun: null, maxPiCallsPerPulse: null, maxConcurrentPiRequests: 1, maxWallTimeMs: null, requestTimeoutMs: 30000 } },
    icmWorkspace: { kind: 'configured', evidence, value: createIcmWorkspaceSnapshot({ sources: [{ sourceId: 'role.configurator', audience: { role: 'configurator' }, revision: 0, sourceHash: sha256Utf8('contract'), sections: [{ sectionId: 'process', markdown: 'Proponer puesta.' }] }] }) },
  } });
  assert.equal(created.kind, 'created'); if (created.kind !== 'created') assert.fail();
  const draft = created.draft;
  const job = host.journal.createPreparationConfiguratorJob({ principalId: 'operator', idempotencyKey: randomUUID(), request: {
    kind: 'preparation-configurator-request', schemaVersion: 1, runId: draft.runId, draftRevision: draft.revision, draftHash: sha256CanonicalJson(draft), jobId: randomUUID(), generation: 0,
    instructions: 'Proponer una puesta sin ejecutar actores.', actorSources: [], documentIds: [],
  } });
  const barrier = createHostRequestBarrier();
  const suspension = { async suspendAdmissions() { return () => {}; } };
  const base = { host, admission: barrier, oauth: { backupBusy: false }, access: { backupBusy: false }, preflight: { backupBusy: false }, deliveries: suspension, voice: { ...suspension, backupArtifacts() { return []; } } };
  try {
    await assert.rejects(createHostBackupQuiesce(base).acquire(), /PREPARATION_CONFIGURATOR_BARRIER_UNAVAILABLE/);
    assert.equal(barrier.isHeld, false);
    const { execution } = host.journal.claimPreparationConfiguratorJob({ principalId: 'operator', jobId: job.scope.jobId, ownerToken: host.ownerToken, expectedRevision: job.revision });
    const cwd = join(host.privateDataRoot, 'runs', draft.runId, 'roles', 'configurador', 'cwd'); mkdirSync(cwd, { recursive: true });
    const sdk = SessionManager.create(cwd, join(cwd, '..', 'sessions'));
    sdk.appendMessage({ role: 'user', content: 'Fixture; no model was invoked.', timestamp: Date.now() });
    const sessionPath = sdk.getSessionFile(); assert.ok(sessionPath);
    host.journal.recordPreparationConfiguratorRecord({ kind: 'session', execution, value: { sessionId: sdk.getSessionId(), sessionPath, baseLeafId: null, profile: DEFAULT_INFERENCE_PROFILE } });
    const quiesce = createHostBackupQuiesce({ ...base, preparationConfigurator: suspension });
    const hold = await quiesce.acquire();
    try { assert.ok(z.array(z.object({path:z.string(),kind:z.string()})).parse(hold.artifacts).some(value => value.path === relative(host.privateDataRoot, sessionPath) && value.kind === 'session')); }
    finally { await hold.release(); }
    // Once an input checkpoint exists, its physical artifact becomes required.
    const reserved = host.journal.reservePreparationConfiguratorRequest({ execution, clockEpochId: randomUUID() });
    assert.equal(reserved.kind, 'reserved'); if (reserved.kind !== 'reserved') assert.fail();
    host.journal.recordPreparationConfiguratorRecord({ kind: 'checkpoint', execution, value: { purpose: { kind: 'request-input', requestSeq: reserved.requestSeq }, snapshot: { sessionId: sdk.getSessionId(), sessionPath, candidateLeafId: sdk.getLeafId() } }, prefix: null });
    unlinkSync(sessionPath);
    await assert.rejects(quiesce.acquire(), /REGISTERED_SESSION_MISSING/);
    assert.equal(barrier.isHeld, false);
  } finally { host.close(); rmSync(directory, { recursive: true, force: true }); }
});
