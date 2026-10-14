import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { z } from 'zod';
import { openLocalHost } from '../src/application/local-host.ts';

const ReadySchema = z.strictObject({
  kind: z.literal('serverReady'), origin: z.string().url(),
  representation: z.enum(['icm-not-configured', 'composed']),
});
const CountSchema = z.strictObject({ count: z.number().int().nonnegative() });
const options = { skip: !existsSync('dist/index.html') ? 'Ejecutar npm run build para verificar el launcher real.' : false };

for (const configured of [false, true]) {
  test(`launcher real: ${configured ? 'runtime compuesto' : 'biblioteca sin ICM'} no inventa una puesta y libera ownership`, options, async (t) => {
    const privateDataRoot = mkdtempSync(join(tmpdir(), 'personajes-launcher-'));
    const env: NodeJS.ProcessEnv = { ...process.env, PERSONAJES_PORT: '0', PERSONAJES_PRIVATE_DATA_ROOT: privateDataRoot };
    delete env.PERSONAJES_ICM_BINARY;
    // An absolute host path is configured, but no memory work exists to execute it.
    // This proves composition without claiming binary health or model availability.
    if (configured) env.PERSONAJES_ICM_BINARY = join(privateDataRoot, 'not-installed-icm');
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const exit = once(child, 'exit');
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exit;
      rmSync(privateDataRoot, { recursive: true, force: true });
    });
    const ready = await new Promise<z.infer<typeof ReadySchema>>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('El launcher no anunció readiness.')), 15_000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`El launcher terminó antes de readiness: ${stderr}`)); });
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        for (const line of output.split('\n').slice(0, -1)) {
          try {
            const result = ReadySchema.safeParse(JSON.parse(line));
            if (result.success) { clearTimeout(timer); resolve(result.data); return; }
          } catch { /* Ignore incomplete or unrelated structured diagnostics. */ }
        }
      });
    });
    assert.equal(ready.representation, configured ? 'composed' : 'icm-not-configured');
    assert.equal((await fetch(ready.origin)).status, 200);
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    const [code, signal] = await exit;
    clearTimeout(timer);
    assert.equal(signal, null, stderr);
    assert.equal(code, 0, stderr);
    const database = new DatabaseSync(join(privateDataRoot, 'world.sqlite'), { readOnly: true });
    try {
      for (const table of ['world_runs', 'world_events', 'actor_pi_sessions', 'actor_turn_jobs', 'run_preflight_jobs', 'pi_access_jobs', 'pi_oauth_jobs']) {
        assert.equal(CountSchema.parse(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).count, 0);
      }
    } finally { database.close(); }
    const reopened = openLocalHost({ privateDataRoot });
    reopened.close();
  });
}

test('launcher rechaza una ruta ICM relativa sin filtrar rutas y libera el host', options, async (t) => {
  const privateDataRoot = mkdtempSync(join(tmpdir(), 'personajes-launcher-invalid-'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    env: { ...process.env, PERSONAJES_PORT: '0', PERSONAJES_PRIVATE_DATA_ROOT: privateDataRoot, PERSONAJES_ICM_BINARY: './icm' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exit = once(child, 'exit');
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  t.after(async () => {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exit;
    rmSync(privateDataRoot, { recursive: true, force: true });
  });
  const [code, signal] = await exit;
  assert.equal(signal, null);
  assert.equal(code, 1);
  assert.match(stderr, /SERVER_START_FAILED/);
  assert.equal(stderr.includes(privateDataRoot), false);
  const reopened = openLocalHost({ privateDataRoot });
  reopened.close();
});
