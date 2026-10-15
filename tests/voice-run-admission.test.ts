import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { acquireHostOwnership } from '../src/adapters/host-ownership.ts';
import { createElevenLabsClient } from '../src/adapters/elevenlabs.ts';
import { openVoiceService } from '../src/application/voice-service.ts';
import { VoiceConfigSchema } from '../src/domain/voice.ts';

function deferred() { let release = () => {}; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'personajes-voice-run-admission-'));
  const ownership = acquireHostOwnership({ privateDataRoot: root });
  const entered = new Map<string, ReturnType<typeof deferred>>(), releases = new Map<string, ReturnType<typeof deferred>>();
  const config = VoiceConfigSchema.parse({ revision: 0, spanishVariety: { kind: 'confirmed', label: 'español sintético', source: 'operator', confirmedBy: 'test', confirmedAt: new Date().toISOString() }, audioMode: { kind: 'disabled' }, speakerSlots: { max: { kind: 'enabled-unbound' } }, narratorSlot: { kind: 'absent' }, soundEffectSlots: {} });
  const client = createElevenLabsClient({ getApiKey: () => 'synthetic', transport: async (url, options) => {
    const path = String(url);
    if (path.includes('/models')) return Response.json([{ model_id: 'speech-model', name: 'Synthetic model', can_do_text_to_speech: true, languages: [{ language_id: 'es', name: 'Spanish' }] }]);
    if (path.includes('/voices')) return Response.json({ voices: [{ voice_id: 'provider-voice', name: 'Synthetic voice', labels: { language: 'es' } }], has_more: false, next_page_token: null });
    const body: unknown = JSON.parse(String(options?.body));
    assert.ok(body && typeof body === 'object' && 'voice_description' in body);
    const description = String(body.voice_description);
    entered.get(description)?.release();
    await releases.get(description)?.promise;
    return new Response('{}', { status: 503 });
  } });
  const service = openVoiceService({ privateDataRoot: root, ownerToken: ownership.ownerToken, client, hasCredential: () => true, readConfig: () => config, readPublication: () => null, speakableIds: () => ['max'], quotaLimits: () => ({ voiceDesignCalls: 20, ttsCalls: 20, sfxCalls: 20 }) });
  const click = (runId: string) => ({ runId, principal: 'test', operationId: randomUUID(), expectedRevision: 0 });
  async function queue(runId: string, marker: string) {
    const description = `Voz español sintético, clara para ${marker}`;
    entered.set(description, deferred()); releases.set(description, deferred());
    const op = await service.requestDesign(click(runId), { owner: { kind: 'character', id: 'max' }, sampleText: 'Este texto es una muestra sintética original para verificar las barreras de admisión de audio entre dos representaciones independientes.', sampleOrigin: { kind: 'operator-entered' }, voiceDescription: description, modelId: 'eleven_ttv_v3', language: 'es', originalSampleConfirmed: true, descriptionReviewed: true });
    return { op, entered: entered.get(description)!.promise, release: () => releases.get(description)!.release() };
  }
  return { service, client, click, queue, async close() { for (const gate of releases.values()) gate.release(); await service.shutdown(); ownership.release(); rmSync(root, { recursive: true, force: true }); } };
}

test('targeted audio lease waits only its own submitted request, allows other representations, and release never autoexecutes queued work', async () => {
  const f = fixture(); try {
    const a = await f.queue('run-a', 'A activo'), b = await f.queue('run-b', 'B activo');
    const queuedA = await f.queue('run-a', 'A pendiente');
    const workA = f.service.execute(a.op.operationId), workB = f.service.execute(b.op.operationId);
    await Promise.all([a.entered, b.entered]);
    let leased = false;
    const lease = f.service.suspendRunAdmissions({ runId: 'run-a' }).then(release => { leased = true; return release; });
    await Promise.resolve(); assert.equal(leased, false);
    a.release(); await workA;
    const release = await lease;
    assert.equal(f.service.getOperation(b.op.operationId, 'test').state, 'submitted', 'unrelated real provider work did not delay the lease');
    await assert.rejects(f.queue('run-a', 'A prohibido'), /VOICE_SERVICE_STOPPING/);
    const anotherB = await f.queue('run-b', 'B permitido');
    assert.equal((await f.service.execute(queuedA.op.operationId)).state, 'queued');
    const nestedRelease = await f.service.suspendRunAdmissions({ runId: 'run-a' });
    release(); release();
    assert.equal((await f.service.execute(queuedA.op.operationId)).state, 'queued', 'nested target lease remains in force');
    b.release(); await workB;
    anotherB.release();
    assert.equal(await f.service.drain({ limit: 1 }), 1);
    assert.equal(f.service.getOperation(anotherB.op.operationId, 'test').state, 'failed', 'suspended run before the SQL limit does not starve another run');
    assert.equal(f.service.getOperation(queuedA.op.operationId, 'test').state, 'queued');
    nestedRelease(); await Promise.resolve();
    assert.equal(f.service.getOperation(queuedA.op.operationId, 'test').state, 'queued', 'releasing does not wake a worker');
    queuedA.release(); await f.service.execute(queuedA.op.operationId);
    assert.equal(f.service.getOperation(queuedA.op.operationId, 'test').state, 'failed');
  } finally { await f.close(); }
});

test('targeted lease also waits an in-flight binding draft catalog lookup before its late durable receipt', async () => {
  const f = fixture(); const gate = deferred(), entered = deferred();
  const original = f.client.listModels;
  // This real service method awaits an external catalog read before writing its receipt.
  f.client.listModels = async () => { entered.release(); await gate.promise; return original(); };
  try {
    const draft = f.service.createBindingDraft(f.click('run-a'), { owner: { kind: 'character', id: 'max' }, source: { kind: 'providerVoice', providerVoiceId: 'provider-voice' }, ttsModelId: 'speech-model' });
    await entered.promise;
    let ready = false;
    const barrier = f.service.suspendRunAdmissions({ runId: 'run-a' }).then(release => { ready = true; return release; });
    await Promise.resolve(); assert.equal(ready, false);
    const otherRelease = await f.service.suspendRunAdmissions({ runId: 'run-b' }); otherRelease();
    gate.release(); const completed = await draft; const release = await barrier;
    assert.equal(f.service.listBindingDrafts('run-a', 'test')[0]?.bindingDraftId, completed.bindingDraftId);
    await assert.rejects(f.service.createBindingDraft(f.click('run-a'), { owner: { kind: 'character', id: 'max' }, source: { kind: 'providerVoice', providerVoiceId: 'provider-voice' }, ttsModelId: 'speech-model' }), /VOICE_SERVICE_STOPPING/);
    release();
  } finally { gate.release(); await f.close(); }
});
