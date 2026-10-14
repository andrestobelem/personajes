import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AuthEvent } from '@earendil-works/pi-ai';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { openJournal } from '../src/adapters/journal.ts';
import { createPiOAuthJobs, oauthSessionScope } from '../src/application/pi-oauth-jobs.ts';
import { createPiOAuthPort } from '../src/application/pi-oauth.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import type { PiOAuthJobView } from '../src/domain/http.ts';

type AuthRuntime = Parameters<typeof createPiOAuthPort>[0]['modelRuntime'];
type Credential = Awaited<ReturnType<AuthRuntime['login']>>;

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(message);
}

function controlledOAuthRuntime(input: { configured?: boolean } = {}) {
  let configured = input.configured ?? false;
  const loginResult = deferred<Credential>();
  const logoutResult = deferred<void>();
  let loginSignal: AbortSignal | undefined;
  let loginCalls = 0;
  let logoutCalls = 0;
  const runtime: AuthRuntime = {
    async listCredentials() {
      return configured ? [{ providerId: 'openai-codex', type: 'oauth' }] : [];
    },
    async login(_provider, _type, callbacks) {
      loginCalls += 1;
      loginSignal = callbacks.signal;
      const selected = await callbacks.prompt({ type: 'select', message: 'Login', options: [
        { id: 'device_code', label: 'Device code' }, { id: 'browser', label: 'Browser' },
      ] });
      assert.equal(selected, 'device_code');
      callbacks.notify({
        type: 'device_code', userCode: 'ABCD-EFGH',
        verificationUri: 'https://auth.openai.com/codex/device', expiresInSeconds: 300,
        deviceCode: 'DEVICE_CODE_PRIVATE_TEST', authorizationCode: 'AUTH_CODE_PRIVATE_TEST',
      } as unknown as AuthEvent);
      return loginResult.promise;
    },
    async logout() {
      logoutCalls += 1;
      await logoutResult.promise;
      configured = false;
    },
  };
  const credential = {
    type: 'oauth' as const,
    access: 'ACCESS_TOKEN_PRIVATE_TEST',
    refresh: 'REFRESH_TOKEN_PRIVATE_TEST',
    expires: Date.now() + 60_000,
  } as Credential;
  return {
    runtime, credential, loginResult, logoutResult,
    isConfigured: () => configured,
    setConfigured: (value: boolean) => { configured = value; },
    getLoginSignal: () => loginSignal,
    get loginCalls() { return loginCalls; },
    get logoutCalls() { return logoutCalls; },
  };
}

async function createSession(origin: string) {
  const sameOrigin = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
  const page = await fetch(origin + '/', { headers: sameOrigin });
  const html = await page.text();
  const nonce = html.match(/<meta name="personajes-bootstrap" content="([A-Za-z0-9_-]{43})">/)?.[1];
  assert.ok(nonce);
  const response = await fetch(origin + '/api/v1/session', {
    method: 'POST',
    headers: { ...sameOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bootNonce: nonce }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const created = await response.json() as { csrfToken: string };
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie && cookie.startsWith('personajes_session='));
  return { cookie, csrfToken: created.csrfToken, sameOrigin };
}

test('OAuth HTTP lista y recupera jobs sin reexponer interacción a otra sesión; cierre conserva éxito tardío', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-oauth-http-'));
  const journalPath = join(directory, 'journal.sqlite');
  const journal = openJournal({ path: journalPath });
  const sdk = controlledOAuthRuntime();
  const hostController = new AbortController();
  const oauth = createPiOAuthPort({ modelRuntime: sdk.runtime, signal: hostController.signal });
  const broker = await createPiOAuthJobs({ journal, oauth, ownerToken: uuid(1) });
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  const server = createLocalHttpServer({ catalog, shellHtml: '<!doctype html><html><head></head><body></body></html>', piOAuthJobs: broker });
  const address = await server.listen(0);
  t.after(async () => {
    hostController.abort();
    await broker.close();
    await server.close();
    journal.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const first = await createSession(address.origin);
  const badBody = await fetch(address.origin + '/api/v1/integrations/pi/oauth/login', {
    method: 'POST', headers: {
      ...first.sameOrigin, Cookie: first.cookie, 'X-CSRF-Token': first.csrfToken,
      'Idempotency-Key': uuid(2), 'Content-Type': 'application/json',
    }, body: JSON.stringify({ authorizationCode: 'MUST_NOT_BE_ACCEPTED' }),
  });
  assert.equal(badBody.status, 422);

  const status = await fetch(address.origin + '/api/v1/integrations/pi/status', {
    headers: { ...first.sameOrigin, Cookie: first.cookie },
  });
  assert.equal(status.status, 200);
  assert.equal((await status.json() as { authState: string }).authState, 'missing');

  const start = await fetch(address.origin + '/api/v1/integrations/pi/oauth/login', {
    method: 'POST', headers: {
      ...first.sameOrigin, Cookie: first.cookie, 'X-CSRF-Token': first.csrfToken,
      'Idempotency-Key': uuid(3), 'Content-Type': 'application/json',
    }, body: '{}',
  });
  assert.equal(start.status, 202, await start.clone().text());
  const receipt = await start.json() as { job: PiOAuthJobView };
  const jobId = receipt.job.jobId;
  await waitFor(() => sdk.loginCalls === 1 && sdk.getLoginSignal() !== undefined, 'El fake SDK no inició login.');

  const interactionUrl = `${address.origin}/api/v1/integrations/pi/oauth/jobs/${jobId}/interaction`;
  const interaction = await fetch(interactionUrl, { headers: { ...first.sameOrigin, Cookie: first.cookie } });
  assert.equal(interaction.status, 200);
  const interactionValue = await interaction.json() as Record<string, unknown>;
  assert.equal(interactionValue.kind, 'device-code');
  assert.equal(interactionValue.cursor, 1);
  assert.equal(interactionValue.verificationUri, 'https://auth.openai.com/codex/device');
  assert.equal(interactionValue.userCode, 'ABCD-EFGH');
  assert.match(String(interactionValue.expiresAt), /^\d{4}-\d\d-\d\dT/);

  const second = await createSession(address.origin);
  const list = await fetch(address.origin + '/api/v1/integrations/pi/oauth/jobs?limit=10', {
    headers: { ...second.sameOrigin, Cookie: second.cookie },
  });
  assert.equal(list.status, 200);
  const page = await list.json() as { kind: string; items: PiOAuthJobView[]; nextCursor: string | null; truncated: boolean };
  assert.equal(page.kind, 'pi-oauth-job-page');
  assert.equal(page.items.some((job) => job.jobId === jobId), true);
  assert.equal(page.nextCursor, null);
  assert.equal(page.truncated, false);
  const reread = await fetch(`${address.origin}/api/v1/integrations/pi/oauth/jobs/${jobId}`, {
    headers: { ...second.sameOrigin, Cookie: second.cookie },
  });
  assert.equal(reread.status, 200, 'El listado permite recuperar el job al volver a abrir el panel.');
  assert.equal((await reread.json() as PiOAuthJobView).jobId, jobId);
  const foreignInteraction = await fetch(interactionUrl, { headers: { ...second.sameOrigin, Cookie: second.cookie } });
  assert.equal(foreignInteraction.status, 403);

  const running = await broker.readJob({ jobId });
  assert.ok(running);
  const cancel = await fetch(`${address.origin}/api/v1/integrations/pi/oauth/jobs/${jobId}`, {
    method: 'DELETE', headers: {
      ...first.sameOrigin, Cookie: first.cookie, 'X-CSRF-Token': first.csrfToken,
      'If-Match': `"pi-oauth-job:${jobId}:r${running.revision}"`, 'Idempotency-Key': uuid(4),
    },
  });
  assert.equal(cancel.status, 202, await cancel.clone().text());

  const closing = broker.close();
  hostController.abort();
  await waitFor(() => sdk.getLoginSignal()?.aborted === true, 'El cierre no abortó el transporte OAuth.');
  sdk.setConfigured(true);
  sdk.loginResult.resolve(sdk.credential);
  await closing;
  assert.equal(journal.readPiOAuthJob({ jobId })?.state, 'succeeded', 'El commit que el SDK confirmó prevalece al abort tardío.');

  const db = new DatabaseSync(journalPath);
  try {
    const content = JSON.stringify({
      jobs: db.prepare('SELECT payload_json FROM pi_oauth_jobs').all(),
      history: db.prepare('SELECT payload_json FROM pi_oauth_job_history').all(),
      operations: db.prepare('SELECT result_json FROM pi_oauth_job_operations').all(),
    });
    for (const secret of ['DEVICE_CODE_PRIVATE_TEST', 'AUTH_CODE_PRIVATE_TEST', 'ACCESS_TOKEN_PRIVATE_TEST', 'REFRESH_TOKEN_PRIVATE_TEST', 'ABCD-EFGH']) {
      assert.equal(content.includes(secret), false, `El valor privado no debe persistirse: ${secret}`);
    }
  } finally { db.close(); }
  assert.equal(sdk.getLoginSignal()?.aborted, true);
});

test('lista OAuth del operador pagina los metadatos recientes y limita el principal', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-oauth-list-'));
  const journal = openJournal({ path: join(directory, 'journal.sqlite') });
  const principalId = 'local-operator';
  for (let index = 1; index <= 3; index += 1) {
    journal.createPiOAuthJob({ principalId, idempotencyKey: uuid(20 + index), kind: index === 3 ? 'logout' : 'login' });
  }
  journal.createPiOAuthJob({ principalId: 'different-local-host', idempotencyKey: uuid(30), kind: 'login' });
  const sdk = controlledOAuthRuntime();
  let diagnosticCount = 0;
  const broker = await createPiOAuthJobs({
    journal, oauth: createPiOAuthPort({ modelRuntime: sdk.runtime }), ownerToken: uuid(40),
    onDiagnostic: () => { diagnosticCount += 1; },
  });
  t.after(async () => { await broker.close(); journal.close(); rmSync(directory, { recursive: true, force: true }); });

  const first = await broker.listJobs({ offset: 0, limit: 2 });
  assert.equal(first.kind, 'pi-oauth-job-page');
  assert.equal(first.items.length, 2);
  assert.equal(typeof first.nextCursor, 'string');
  assert.equal(first.truncated, false);
  const second = await broker.listJobs({ offset: 2, limit: 2 });
  assert.equal(second.items.length, 1);
  assert.equal(second.nextCursor, null);
  const all = [...first.items, ...second.items];
  assert.equal(all.length, 3);
  assert.equal(all.every((job) => job.kind === 'pi-oauth-job'), true);
  assert.equal(all.some((job) => (job as unknown as { principalId?: string }).principalId !== undefined), false);
  assert.equal(diagnosticCount, 0);
});

test('logout completado mientras close aborta el host queda registrado como éxito', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-oauth-late-logout-'));
  const journal = openJournal({ path: join(directory, 'journal.sqlite') });
  const sdk = controlledOAuthRuntime({ configured: true });
  const hostController = new AbortController();
  const broker = await createPiOAuthJobs({
    journal,
    oauth: createPiOAuthPort({ modelRuntime: sdk.runtime, signal: hostController.signal }),
    ownerToken: uuid(50),
  });
  t.after(async () => { hostController.abort(); await broker.close(); journal.close(); rmSync(directory, { recursive: true, force: true }); });

  const started = await broker.startLogout({ idempotencyKey: uuid(51), sessionScope: oauthSessionScope('logout-session') });
  assert.equal(started.kind, 'created');
  const jobId = started.job.jobId;
  await waitFor(() => sdk.logoutCalls === 1, 'El fake SDK no inició logout.');
  const closing = broker.close();
  hostController.abort();
  sdk.logoutResult.resolve();
  await closing;
  assert.equal(journal.readPiOAuthJob({ jobId })?.state, 'succeeded');
  assert.equal(sdk.isConfigured(), false);
});

test('DELETE OAuth inicia un job de logout con CSRF e idempotencia, sin requerir un body', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-oauth-logout-http-'));
  const journal = openJournal({ path: join(directory, 'journal.sqlite') });
  const sdk = controlledOAuthRuntime({ configured: true });
  const broker = await createPiOAuthJobs({
    journal, oauth: createPiOAuthPort({ modelRuntime: sdk.runtime }), ownerToken: uuid(60),
  });
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  const server = createLocalHttpServer({ catalog, shellHtml: '<!doctype html><html><head></head><body></body></html>', piOAuthJobs: broker });
  const address = await server.listen(0);
  t.after(async () => { await broker.close(); await server.close(); journal.close(); rmSync(directory, { recursive: true, force: true }); });
  const session = await createSession(address.origin);

  const response = await fetch(address.origin + '/api/v1/integrations/pi/oauth', {
    method: 'DELETE', headers: {
      ...session.sameOrigin, Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken,
      'Idempotency-Key': uuid(61),
    },
  });
  assert.equal(response.status, 202, await response.clone().text());
  const receipt = await response.json() as { job: PiOAuthJobView };
  assert.equal(receipt.job.operation, 'logout');
  assert.equal(receipt.job.state, 'queued');
  assert.equal(response.headers.get('location'), `/api/v1/integrations/pi/oauth/jobs/${receipt.job.jobId}`);
  await waitFor(() => sdk.logoutCalls === 1, 'El endpoint no despachó el logout al puerto del SDK.');
  sdk.logoutResult.resolve();
  await waitFor(() => journal.readPiOAuthJob({ jobId: receipt.job.jobId })?.state === 'succeeded', 'El job de logout no alcanzó estado terminal.');
});
