import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, statSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPiAuthFingerprint, resolveReadonlyAuthTemplate } from '../src/application/pi-auth-fingerprint.ts';

test('salt privado persistente y credential actual invalidan huellas sin refresh, comandos o secretos públicos', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personajes-fingerprint-'));
  try {
    const env = { ANTHROPIC_API_KEY: 'synthetic-first' };
    const helper = createPiAuthFingerprint({ privateDataRoot: root, environment: env, now: () => 100 });
    const path = join(root, 'pi', 'auth', 'auth.json');
    assert.equal(statSync(join(root, 'pi', 'auth', 'access-fingerprint.salt')).mode & 0o777, 0o600);
    assert.equal(statSync(join(root, 'pi', 'auth')).mode & 0o777, 0o700);
    const first = await helper.readCredentialFingerprint({ provider: 'anthropic' });
    assert.match(first ?? '', /^[0-9a-f]{64}$/);
    const reopened = createPiAuthFingerprint({ privateDataRoot: root, environment: env, now: () => 100 });
    assert.equal(await reopened.readCredentialFingerprint({ provider: 'anthropic' }), first);
    env.ANTHROPIC_API_KEY = 'synthetic-second';
    assert.notEqual(await helper.readCredentialFingerprint({ provider: 'anthropic' }), first, 'Hashes effective secret, not env variable name');
    writeFileSync(path, JSON.stringify({ anthropic: { type: 'api_key', key: '$ANTHROPIC_API_KEY' } }), { mode: 0o600 });
    const pointer = await helper.readCredentialFingerprint({ provider: 'anthropic' });
    env.ANTHROPIC_API_KEY = 'synthetic-third';
    assert.notEqual(await helper.readCredentialFingerprint({ provider: 'anthropic' }), pointer);
    writeFileSync(path, JSON.stringify({ anthropic: { type: 'api_key', key: '!touch /tmp/must-not-be-executed' } }));
    assert.equal((await helper.readInferenceAuthenticationStatus({ provider: 'anthropic' })).kind, 'unavailable', 'Stored executable credential never falls back to ambient key');
    const auth = { 'openai-codex': { type: 'oauth', access: 'synthetic-access', refresh: 'synthetic-refresh', expires: 200 } };
    writeFileSync(path, JSON.stringify(auth)); const bytes = readFileSync(path, 'utf8');
    const status = await helper.readInferenceAuthenticationStatus({ provider: 'openai-codex' });
    assert.equal(status.kind, 'authenticated'); assert.equal(JSON.stringify(status).includes('synthetic-access'), false);
    assert.equal(readFileSync(path, 'utf8'), bytes, 'Status/fingerprint do not refresh or mutate credentials');
    const expired = createPiAuthFingerprint({ privateDataRoot: root, now: () => 300 });
    assert.equal((await expired.readInferenceAuthenticationStatus({ provider: 'openai-codex' })).kind, 'expired');
    assert.equal(await expired.readCredentialFingerprint({ provider: 'openai-codex' }), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('paths/salt no admiten escape por symlink, raíz relativa o salt público', () => {
  const root = mkdtempSync(join(tmpdir(), 'personajes-fingerprint-path-'));
  const outside = mkdtempSync(join(tmpdir(), 'personajes-fingerprint-outside-'));
  try {
    assert.throws(() => createPiAuthFingerprint({ privateDataRoot: '.' }));
    symlinkSync(outside, join(root, 'pi'));
    assert.throws(() => createPiAuthFingerprint({ privateDataRoot: root }));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('templates readonly respetan escapes/env y rechazan comandos o variables ausentes', () => {
  assert.equal(resolveReadonlyAuthTemplate('prefix-${KEY}-$OTHER', { KEY: 'one', OTHER: 'two' }), 'prefix-one-two');
  assert.equal(resolveReadonlyAuthTemplate('$$KEY-$!safe', {}), '$KEY-!safe');
  assert.equal(resolveReadonlyAuthTemplate('$MISSING', {}), undefined);
  assert.equal(resolveReadonlyAuthTemplate('!printf secret', {}), undefined);
});
