import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PiRuntime } from '../src/adapters/pi.ts';
import { createPiOAuthPort } from '../src/application/pi-oauth.ts';

type AuthRuntime = Parameters<typeof createPiOAuthPort>[0]['modelRuntime'];
const interaction: Parameters<AuthRuntime['login']>[2] = { async prompt() { return 'browser'; }, notify() {} };
const credential = { type: 'oauth' as const, access: 'PRIVATE_ACCESS', refresh: 'PRIVATE_REFRESH', expires: 1 };

test('OAuth usa el proveedor fijo y devuelve metadatos sin credenciales ni promesa de acceso', async () => {
  let configured = false;
  const calls: unknown[] = [];
  const runtime: AuthRuntime = {
    async listCredentials() { return configured ? [{ providerId: 'openai-codex', type: 'oauth' }] : []; },
    async login(provider, type, callbacks, options) {
      calls.push({ provider, type, callbacks, options }); configured = true; return credential;
    },
    async logout(provider) { calls.push(provider); configured = false; },
  };
  const port = createPiOAuthPort({ modelRuntime: runtime, loginOptions: { agentName: 'Personajes' } });
  assert.deepEqual(await port.status(), { kind: 'status', value: {
    provider: 'openai-codex', configuration: 'oauth-required', accountAccess: 'not-verified',
  } });
  const result = await port.login(interaction);
  assert.deepEqual(result, { kind: 'configured', status: {
    provider: 'openai-codex', configuration: 'oauth-configured', accountAccess: 'not-verified',
  } });
  assert.deepEqual(calls[0], { provider: 'openai-codex', type: 'oauth', callbacks: interaction, options: { agentName: 'Personajes' } });
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
  assert.deepEqual(await port.logout(), { kind: 'logged-out', status: {
    provider: 'openai-codex', configuration: 'oauth-required', accountAccess: 'not-verified',
  } });
  assert.equal(calls[1], 'openai-codex');
});

test('dos puertos del mismo runtime no solapan login/logout y liberan tras fallo', async () => {
  let rejectLogin: (reason: unknown) => void = () => undefined;
  let count = 0;
  const runtime: AuthRuntime = {
    async listCredentials() { return []; },
    login() { count += 1; return new Promise((_, reject) => { rejectLogin = reject; }); },
    async logout() { throw new Error('PRIVATE_REFRESH'); },
  };
  const first = createPiOAuthPort({ modelRuntime: runtime });
  const second = createPiOAuthPort({ modelRuntime: runtime });
  const pending = first.login(interaction);
  assert.deepEqual(await second.login(interaction), { kind: 'failed', code: 'OAUTH_BUSY' });
  assert.deepEqual(await second.logout(), { kind: 'failed', code: 'OAUTH_BUSY' });
  rejectLogin(Object.assign(new Error('PRIVATE_ACCESS'), { credential }));
  assert.deepEqual(await pending, { kind: 'failed', code: 'OAUTH_LOGIN_FAILED' });
  assert.deepEqual(await second.logout(), { kind: 'failed', code: 'OAUTH_LOGOUT_FAILED' });
  assert.equal(count, 1);
});

test('cancelación antes y durante login no revela fallos SDK ni invoca otro proveedor', async () => {
  const controller = new AbortController();
  let calls = 0;
  const runtime: AuthRuntime = {
    async listCredentials() { return []; },
    async login(_provider, _type, callbacks) {
      calls += 1;
      controller.abort();
      assert.equal(callbacks.signal?.aborted, true);
      throw new Error('PRIVATE_REFRESH');
    },
    async logout() {},
  };
  const port = createPiOAuthPort({ modelRuntime: runtime });
  const callbacks = { ...interaction, signal: controller.signal };
  assert.deepEqual(await port.login(callbacks), { kind: 'failed', code: 'OAUTH_CANCELLED' });
  assert.deepEqual(await port.login(callbacks), { kind: 'failed', code: 'OAUTH_CANCELLED' });
  assert.equal(calls, 1);
});

test('un login confirmado por el SDK prevalece sobre una cancelación tardía', async () => {
  const controller = new AbortController();
  let configured = false;
  const runtime: AuthRuntime = {
    async listCredentials() { return configured ? [{ providerId: 'openai-codex', type: 'oauth' }] : []; },
    async login(_provider, _type, callbacks) {
      controller.abort();
      assert.equal(callbacks.signal?.aborted, true);
      configured = true;
      return credential;
    },
    async logout() { configured = false; },
  };
  const port = createPiOAuthPort({ modelRuntime: runtime });
  assert.deepEqual(await port.login({ ...interaction, signal: controller.signal }), {
    kind: 'configured', status: {
      provider: 'openai-codex', configuration: 'oauth-configured', accountAccess: 'not-verified',
    },
  });
});

test('status con SDK real y almacén nuevo no autentica ni verifica la cuenta', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-oauth-status-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const runtime = await PiRuntime.create({ privateDataRoot: directory });
  const port = createPiOAuthPort({ modelRuntime: runtime.modelRuntime });
  assert.deepEqual(await port.status(), { kind: 'status', value: {
    provider: 'openai-codex', configuration: 'oauth-required', accountAccess: 'not-verified',
  } });
});

test('API key o error de almacén nunca se presentan como OAuth configurado', async () => {
  const runtime: AuthRuntime = {
    async listCredentials() { return [{ providerId: 'openai-codex', type: 'api_key' }]; },
    async login() { return { type: 'api_key', key: 'PRIVATE_ACCESS' }; },
    async logout() {},
  };
  const port = createPiOAuthPort({ modelRuntime: runtime });
  assert.deepEqual(await port.status(), { kind: 'status', value: {
    provider: 'openai-codex', configuration: 'oauth-required', accountAccess: 'not-verified',
  } });
  assert.deepEqual(await port.login(interaction), { kind: 'failed', code: 'OAUTH_LOGIN_FAILED' });
  runtime.listCredentials = async () => { throw new Error('PRIVATE_ACCESS'); };
  assert.deepEqual(await port.status(), { kind: 'failed', code: 'OAUTH_STATUS_UNAVAILABLE' });
});


test('cancelación del host se propaga al SDK y no deja un login exclusivo ocupado', async () => {
  const hostController = new AbortController();
  let promptStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => { promptStarted = resolve; });
  const runtime: AuthRuntime = {
    async listCredentials() { return []; },
    login(_provider, _type, callbacks) {
      return new Promise((_, reject) => {
        assert.ok(callbacks.signal);
        callbacks.signal.addEventListener('abort', () => reject(Object.assign(new Error('PRIVATE_ACCESS'), { credential })), { once: true });
        promptStarted();
      });
    },
    async logout() {},
  };
  const port = createPiOAuthPort({ modelRuntime: runtime, signal: hostController.signal });
  const operation = port.login(interaction);
  await started;
  hostController.abort();
  assert.deepEqual(await operation, { kind: 'failed', code: 'OAUTH_CANCELLED' });
  assert.deepEqual(await port.status(), { kind: 'failed', code: 'OAUTH_CANCELLED' });
  assert.deepEqual(await createPiOAuthPort({ modelRuntime: runtime }).logout(), { kind: 'logged-out', status: {
    provider: 'openai-codex', configuration: 'oauth-required', accountAccess: 'not-verified',
  } });
});
