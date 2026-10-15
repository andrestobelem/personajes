import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openLocalHost } from '../src/application/local-host.ts';
import { createVoiceRuntime } from '../src/application/voice-runtime.ts';
import { createElevenLabsClient } from '../src/adapters/elevenlabs.ts';
import type { OperatorRequest } from '../src/server/operator-extension.ts';
import { draftFixture } from './fixtures/continuista.ts';

test('reconciliation context exposes the preserved voice revision after a core edit and never reconciles on read', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personajes-voice-reconciliation-'));
  const host = openLocalHost({ privateDataRoot: root }); let providerCalls = 0;
  const voices = createVoiceRuntime({ host, client: createElevenLabsClient({ getApiKey: () => undefined,
    transport: async () => { providerCalls++; throw new Error('No provider expected'); } }) });
  try {
    const { kind, schemaVersion, runId: oldRunId, revision, ...patch } = draftFixture();
    const created = host.journal.createRunConfigurationDraft({ principalId: 'local-operator', idempotencyKey: randomUUID(), patch });
    assert.equal(created.kind, 'created'); if (created.kind !== 'created') assert.fail('No draft');
    const runId = created.draft.runId;
    const promote = (expectedRevision: number) => host.journal.validateRunConfigurationDraft({ principalId: 'local-operator', idempotencyKey: randomUUID(), runId, expectedRevision });
    assert.equal(promote(0).kind, 'ready');
    const request = { kind: 'read', method: 'GET', path: ['runs', runId, 'voice-settings', 'reconciliation'], query: new URLSearchParams(), principalId: 'local-operator', mode: { kind: 'observer' }, ifMatch: null, ifNoneMatch: null } satisfies OperatorRequest;
    const first = await voices.routes.handle(request);
    assert.equal(first.kind, 'json'); if (first.kind !== 'json') assert.fail('No initial context');
    assert.match(JSON.stringify(first.body), /"baseStale":false/);
    const original = voices.config.read(runId);
    const edited = host.journal.updateRunConfigurationDraft({ principalId: 'local-operator', idempotencyKey: randomUUID(), runId, expectedRevision: 0, patch: { name: { kind: 'configured', value: 'Revised preparation', evidence: { kind: 'operator-choice', operatorId: 'local-operator', recordedAt: new Date().toISOString() } } } });
    assert.equal(edited.kind, 'stored'); assert.equal(promote(1).kind, 'ready');
    assert.throws(() => voices.config.read(runId), /VOICE_BASE_CONFIGURATION_STALE/);
    const context = await voices.routes.handle(request);
    assert.equal(context.kind, 'json'); if (context.kind !== 'json') assert.fail('No preserved context');
    assert.equal(context.headers.ETag, `"voice-config:${runId}:r0"`);
    assert.deepEqual(context.body, { kind: 'voice-reconciliation-context', snapshot: original, baseStale: true });
    assert.deepEqual(voices.config.readUnreconciled(runId), original, 'read does not import revised settings');
    const write = { ...request, kind: 'write', method: 'POST', path: ['runs', runId, 'voice-settings', 'reconcile'],
      idempotencyKey: randomUUID(), ifMatch: context.headers.ETag ?? null, body: { kind: 'reconcileBase' } } satisfies OperatorRequest;
    const reconciled = await voices.routes.handle(write);
    assert.equal(reconciled.kind, 'json');
    assert.equal(voices.config.read(runId).config.revision, 1);
    assert.deepEqual(voices.config.read(runId).config.audioMode, original.config.audioMode);
    assert.deepEqual(await voices.routes.handle(write), reconciled, 'same key replays exact receipt');
    const latest = voices.config.read(runId);
    assert.equal(latest.baseRunConfigurationRevision, 1);
    assert.equal(providerCalls, 0); assert.equal(voices.service.listOperations(runId, 'local-operator').length, 0);
  } finally { await voices.close(); host.close(); rmSync(root, { recursive: true, force: true }); rmSync(`${root}-auth`, { recursive: true, force: true }); }
});
