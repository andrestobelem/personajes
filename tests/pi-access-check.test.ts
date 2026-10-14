import assert from 'node:assert/strict';
import { z } from 'zod';
import { test } from 'node:test';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, createAssistantMessageEventStream, type AssistantMessage, type Model, type Api } from '@earendil-works/pi-ai';
import { CLAUDE_INFERENCE_PROFILE, DEFAULT_INFERENCE_PROFILE, LEGACY_INFERENCE_PROFILE, type PersistedInferenceProfile } from '../src/domain/inference-profile.ts';
import { createPiAccessCheck, fingerprintPiCredential } from '../src/application/pi-access-check.ts';

const fingerprint = 'a'.repeat(64);
const frames = (events: unknown[]) => events.map((event) => `event: ${z.object({ type: z.string() }).parse(event).type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
const syntheticToken = `e30.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-test-account' } })).toString('base64url')}.synthetic`;
async function harness(profile: PersistedInferenceProfile) {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(profile.provider, async () => profile.provider === 'openai-codex' ? { type: 'oauth', refresh: 'synthetic-refresh', access: syntheticToken, expires: Date.now() + 86_400_000 } : { type: 'api_key', key: 'synthetic-api-key' });
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  return { runtime, credentials };
}
function responseFrames(profile: PersistedInferenceProfile): string {
  if (profile.provider === 'anthropic') return frames([
    { type: 'message_start', message: { id: 'synthetic', type: 'message', role: 'assistant', model: profile.model, content: [], stop_reason: null, usage: { input_tokens: 2, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]);
  const item = { id: 'item-synthetic', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] };
  return frames([
    { type: 'response.created', response: { id: 'synthetic', model: profile.model, output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    { type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'OK' },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'synthetic', model: profile.model, status: 'completed', output: [item], usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } } },
  ]);
}

test('SDK real con OAuth/API key sintéticos y fetch controlado verifica payload/efuerzo de ambos perfiles, sin proveedor real', async () => {
  for (const profile of [DEFAULT_INFERENCE_PROFILE, CLAUDE_INFERENCE_PROFILE]) {
    const { runtime } = await harness(profile);
    let requests = 0;
    const payloads: unknown[] = [];
    const fakeFetch: typeof fetch = async () => { requests++; return new Response(responseFrames(profile), { headers: { 'Content-Type': 'text/event-stream' } }); };
    const access = createPiAccessCheck({ profile, readCredentialFingerprint: async () => fingerprint, modelRuntime: {
      getModel: runtime.getModel.bind(runtime), checkAuth: runtime.checkAuth.bind(runtime), isUsingOAuth: runtime.isUsingOAuth.bind(runtime), getAuth: runtime.getAuth.bind(runtime),
      streamSimple: (model, context, options) => runtime.streamSimple(model, context, { ...options, fetch: fakeFetch, onPayload(payload, requestedModel) { payloads.push(payload); return options?.onPayload?.(payload, requestedModel); } }),
    } });
    assert.equal(requests, 0, 'Factory is inert');
    const result = await access.execute();
    assert.equal(result.kind, 'passed', JSON.stringify(result));
    assert.equal(requests, 1);
    assert.equal(result.provider, profile.provider);
    assert.equal(result.accountFingerprint, fingerprint);
    assert.equal(JSON.stringify(result).includes('synthetic-api-key'), false);
    assert.equal(JSON.stringify(result).includes('synthetic-test-account'), false);
    if (result.kind !== 'passed') throw new Error('Expected passed');
    assert.equal(result.effectiveProfile.model, profile.model);
    assert.equal(result.usage.input, 2); assert.equal(result.usage.output, 1);
    const payload = JSON.stringify(payloads);
    assert.equal(payload.includes(profile.reasoningEffort), true);
    assert.equal(payload.includes('Reply with OK.'), true);
    assert.equal(payload.includes('character'), false);
  }
});

function assistant(model: Model<Api>, stopReason: AssistantMessage['stopReason'] = 'stop'): AssistantMessage {
  return { role: 'assistant', content: [{ type: 'text', text: 'PRIVATE-RESPONSE-DO-NOT-EXPOSE' }], api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason, timestamp: 0 };
}
async function controlled(input: { authType?: 'oauth' | 'api_key'; behavior?: 'reject' | 'throw' | 'wrong' | 'abort' | 'pending' | 'no-payload'; afterFingerprint?: string; timeoutMs?: number } = {}) {
  const { runtime } = await harness(DEFAULT_INFERENCE_PROFILE);
  let fingerprintReads = 0; let calls = 0;
  const access = createPiAccessCheck({ profile: DEFAULT_INFERENCE_PROFILE, timeoutMs: input.timeoutMs ?? 500, readCredentialFingerprint: async () => ++fingerprintReads === 1 ? fingerprint : input.afterFingerprint ?? fingerprint, modelRuntime: {
    getModel: runtime.getModel.bind(runtime), checkAuth: async () => ({ type: input.authType ?? 'oauth' }), isUsingOAuth: () => input.authType !== 'api_key', getAuth: async () => ({ auth: { apiKey: 'PRIVATE-KEY' } }),
    streamSimple(model, _context, options) {
      calls++;
      if (input.behavior === 'throw') throw new Error('PRIVATE-KEY private provider details');
      const stream = createAssistantMessageEventStream();
      if (input.behavior !== 'no-payload') options?.onPayload?.({ model: model.id, reasoning: { effort: 'low' } }, model);
      if (input.behavior === 'pending') { options?.signal?.addEventListener('abort', () => stream.push({ type: 'error', reason: 'aborted', error: assistant(model, 'aborted') }), { once: true }); return stream; }
      if (input.behavior === 'abort') { stream.push({ type: 'error', reason: 'aborted', error: assistant(model, 'aborted') }); return stream; }
      options?.onResponse?.({ status: input.behavior === 'reject' ? 403 : 200, headers: {} }, model);
      if (input.behavior === 'reject') { stream.push({ type: 'error', reason: 'error', error: { ...assistant(model, 'error'), errorMessage: 'PRIVATE-KEY' } }); return stream; }
      stream.push({ type: 'done', reason: 'stop', message: input.behavior === 'wrong' ? { ...assistant(model), model: 'other-model' } : assistant(model) });
      return stream;
    },
  } });
  return { access, calls: () => calls };
}

test('cancelación previa no lee auth ni despacha; API key Codex se rechaza sin transporte', async () => {
  const { access, calls } = await controlled(); const controller = new AbortController(); controller.abort();
  assert.equal((await access.execute({ signal: controller.signal })).kind, 'aborted'); assert.equal(calls(), 0);
  const noOAuth = await controlled({ authType: 'api_key' }); assert.equal((await noOAuth.access.execute()).kind, 'failed'); assert.equal(noOAuth.calls(), 0);
});

test('rechazo confirmado, incertidumbre, esfuerzo no confirmado y cambio de credencial se distinguen y sanitizan', async () => {
  for (const [options, kind, code] of [
    [{ behavior: 'reject' }, 'failed', 'PROVIDER_REJECTED'], [{ behavior: 'throw' }, 'failed', 'LOCAL_FAILURE'],
    [{ behavior: 'wrong' }, 'failed', 'PROFILE_MISMATCH'], [{ behavior: 'abort' }, 'ambiguous', 'CANCELLED_AFTER_DISPATCH'],
    [{ behavior: 'no-payload' }, 'ambiguous', 'UNCONFIRMED_PAYLOAD'], [{ afterFingerprint: 'b'.repeat(64) }, 'ambiguous', 'AUTH_CHANGED'],
  ] satisfies [Parameters<typeof controlled>[0], string, string][]) {
    const { access } = await controlled(options); const result = await access.execute();
    assert.equal(result.kind, kind); assert.equal('code' in result ? result.code : undefined, code);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
});

test('timeout y cancelación posterior abortan stream SDK y nunca se anuncian como passed', async () => {
  const timeout = await controlled({ behavior: 'pending', timeoutMs: 10 });
  const result = await timeout.access.execute(); assert.equal(result.kind, 'ambiguous'); assert.equal('code' in result ? result.code : undefined, 'TIMEOUT');
  const cancel = await controlled({ behavior: 'pending' }); const controller = new AbortController();
  const request = cancel.access.execute({ signal: controller.signal });
  while (cancel.calls() === 0) await new Promise((resolve) => setImmediate(resolve));
  controller.abort(); const cancelled = await request;
  assert.equal(cancelled.kind, 'ambiguous'); assert.equal('code' in cancelled ? cancelled.code : undefined, 'CANCELLED_AFTER_DISPATCH');
});

test('fingerprint HMAC privado cambia con cuenta/credencial/salt y no contiene secretos', () => {
  const credential = { type: 'oauth', refresh: 'private-refresh', access: 'private-access', expires: 123 };
  const first = fingerprintPiCredential({ credential, privateSalt: 'a'.repeat(32) });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, fingerprintPiCredential({ credential: { ...credential, access: 'changed-account-token' }, privateSalt: 'a'.repeat(32) }));
  assert.notEqual(first, fingerprintPiCredential({ credential, privateSalt: 'b'.repeat(32) }));
  assert.equal(first.includes('private'), false);
});


test('perfil retirado se rechaza antes de auth, fingerprint o transporte; sigue válido sólo como historia', async () => {
  const { runtime } = await harness(DEFAULT_INFERENCE_PROFILE);
  let calls = 0;
  const access = createPiAccessCheck({ profile: LEGACY_INFERENCE_PROFILE, modelRuntime: { getModel: runtime.getModel.bind(runtime), checkAuth: async () => { calls++; return { type: 'oauth' }; }, isUsingOAuth: () => true, getAuth: async () => { calls++; return undefined; }, streamSimple: () => { calls++; return createAssistantMessageEventStream(); } }, readCredentialFingerprint: async () => { calls++; return fingerprint; } });
  assert.equal((await access.execute()).kind, 'failed'); assert.equal(calls, 0);
});
