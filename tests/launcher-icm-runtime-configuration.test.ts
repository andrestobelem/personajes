import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { z } from 'zod';
import { SessionCreatedSchema } from '../src/domain/http.ts';
import { IcmRuntimeConfigurationViewSchema, IcmRuntimeConfigurationJobSchema, icmRuntimeConfigurationEtag } from '../src/domain/icm-runtime-configuration.ts';
import { MemoryPreparationJobSchema, memoryPreparationContextEtag } from '../src/domain/memory-preparation.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createCleanReadyPreflightFixture } from './fixtures/preflight.ts';

const binaryPath = process.env.PERSONAJES_ICM_TEST_BINARY;
const ReadySchema = z.object({ kind: z.literal('serverReady'), origin: z.string().url() });
async function launch(root: string, environmentBinaryPath?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, PERSONAJES_PRIVATE_DATA_ROOT: root, PERSONAJES_PORT: '0' };
  delete env.PERSONAJES_ICM_BINARY;
  if (environmentBinaryPath !== undefined) env.PERSONAJES_ICM_BINARY = environmentBinaryPath;
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
  const origin = await new Promise<string>((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('LAUNCHER_START_TIMEOUT: ' + errors)); }, 15_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('LAUNCHER_EXITED_BEFORE_READY: ' + errors)); });
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const parsed = ReadySchema.safeParse(JSON.parse(line));
          if (parsed.success) { clearTimeout(timeout); resolve(parsed.data.origin); }
        } catch { /* Non-ready diagnostics do not grant startup authority. */ }
      }
    });
  });
  return { origin, async close() {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
    try { const [code, signal] = await exited; assert.equal(code, 0, errors); assert.equal(signal, null, errors); }
    finally { clearTimeout(timeout); }
  } };
}
async function authenticate(origin: string) {
  const security = { Origin: origin, 'Content-Type': 'application/json' };
  const shell = await (await fetch(origin + '/')).text();
  const bootNonce = shell.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1]; assert.ok(bootNonce);
  const response = await fetch(origin + '/api/v1/session', { method: 'POST', headers: security, body: JSON.stringify({ bootNonce }) });
  const session = SessionCreatedSchema.parse(await response.json());
  const cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  return { ...security, Cookie: cookie, 'X-CSRF-Token': session.csrfToken };
}
test('launcher applies ICM through HTTP, preserves OAuth and story, and saved disable survives restart over environment', {
  skip: binaryPath === undefined || !existsSync('dist/index.html') ? 'Requiere build e ICM real.' : false,
  timeout: 30_000,
}, async t => {
  assert.ok(binaryPath);
  const parent = mkdtempSync(join(tmpdir(), 'personajes-launcher-icm-'));
  const root = join(parent, 'host');
  const host = openLocalHost({ privateDataRoot: root });
  const fixture = createCleanReadyPreflightFixture({ journal: host.journal }); host.close();
  let launcher: Awaited<ReturnType<typeof launch>> | undefined;
  t.after(async () => { try { await launcher?.close(); } finally { rmSync(parent, { recursive: true, force: true }); } });
  launcher = await launch(root);
  let headers = await authenticate(launcher.origin);
  const configurationPath = '/api/v1/host/icm-runtime-configuration';
  const originalCredential = JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'synthetic-no-provider-call', refresh: 'synthetic-refresh', expires: Date.now() + 86_400_000 } });
  const authPath = join(root, 'pi', 'auth', 'auth.json'); writeFileSync(authPath, originalCredential, { mode: 0o600 });
  assert.equal((await fetch(launcher.origin + configurationPath)).status, 401);
  async function readConfiguration() { assert.ok(launcher); return IcmRuntimeConfigurationViewSchema.parse(await (await fetch(launcher.origin + configurationPath, { headers })).json()); }
  const initial = await readConfiguration(); assert.equal(initial.source, 'unconfigured');
  async function configure(path: string | null) {
    assert.ok(launcher);
    const view = await readConfiguration(); const key = randomUUID();
    const body = JSON.stringify({ binaryPath: path, expectedRevision: view.revision });
    const requestHeaders = { ...headers, 'Idempotency-Key': key, 'If-Match': icmRuntimeConfigurationEtag(view) };
    const response = await fetch(launcher.origin + configurationPath + '/jobs', { method: 'POST', headers: requestHeaders, body });
    assert.equal(response.status, 202, await response.clone().text());
    const receipt = IcmRuntimeConfigurationJobSchema.parse(await response.json());
    let job = receipt;
    for (let index = 0; index < 300 && (job.state === 'queued' || job.state === 'running'); ++index) {
      await delay(10);
      const read: Response = await fetch(launcher.origin + configurationPath + '/jobs/' + job.jobId, { headers });
      assert.equal(read.status, 200, await read.clone().text()); job = IcmRuntimeConfigurationJobSchema.parse(await read.json());
    }
    assert.equal(job.state, 'succeeded', JSON.stringify(job));
    const replay = await fetch(launcher.origin + configurationPath + '/jobs', { method: 'POST', headers: requestHeaders, body });
    assert.equal(replay.status, 202); assert.deepEqual(IcmRuntimeConfigurationJobSchema.parse(await replay.json()), receipt);
    assert.equal(readFileSync(authPath, 'utf8'), originalCredential);
    return job;
  }
  await configure(binaryPath);
  const health = z.object({ checks: z.object({ runtime: z.literal('degraded') }) });
  health.parse(await (await fetch(launcher.origin + '/api/v1/health')).json());
  const context = { runId: fixture.runId, expectedConfigurationRevision: fixture.configuration.configRevision, expectedWorldRevision: fixture.configuration.worldSnapshot.revision };
  const prepared = await fetch(launcher.origin + `/api/v1/runs/${fixture.runId}/memory-preparations`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID(), 'If-Match': memoryPreparationContextEtag(context) }, body: JSON.stringify({ expectedConfigurationRevision: context.expectedConfigurationRevision, expectedWorldRevision: context.expectedWorldRevision }) });
  assert.equal(prepared.status, 202, await prepared.clone().text());
  let memoryJob = MemoryPreparationJobSchema.parse(await prepared.json());
  for (let index = 0; index < 300 && (memoryJob.state === 'queued' || memoryJob.state === 'running'); ++index) {
    await delay(10); memoryJob = MemoryPreparationJobSchema.parse(await (await fetch(launcher.origin + `/api/v1/runs/${fixture.runId}/memory-preparations/${memoryJob.jobId}`, { headers })).json());
  }
  assert.equal(memoryJob.state, 'completed');
  await configure(null);
  const disabled = await readConfiguration(); assert.equal(disabled.source, 'saved'); assert.equal(disabled.configuredBinaryPath, null);
  await launcher.close(); launcher = undefined;
  launcher = await launch(root, binaryPath); headers = await authenticate(launcher.origin);
  assert.deepEqual(await readConfiguration(), disabled, 'Una desactivación guardada no cae al valor de entorno tras reiniciar.');
  const unavailable = z.object({ checks: z.object({ runtime: z.literal('unavailable') }) });
  unavailable.parse(await (await fetch(launcher.origin + '/api/v1/health')).json());
  assert.equal(readFileSync(authPath, 'utf8'), originalCredential);
  const database = new DatabaseSync(join(root, 'world.sqlite'), { readOnly: true });
  try { for (const table of ['world_events', 'experiences', 'actor_pi_sessions', 'request_reservations']) assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count, 0); }
  finally { database.close(); }
});
