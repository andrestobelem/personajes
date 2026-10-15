import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createIcmMemoryAdapter } from '../src/adapters/icm.ts';
import { ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { hashContinuistaValue } from '../src/domain/continuista-review.ts';
import { loadCatalog } from '../src/adapters/catalog.ts';
import type { HostDirectoryOperation } from '../src/adapters/host-ownership.ts';
import { createHostRecoveryRuntime } from '../src/application/host-recovery-runtime.ts';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { BackupJobSchema, RestorePreviewSchema } from '../src/domain/backup.ts';
import { HostRecoveryJobSchema } from '../src/domain/host-recovery.ts';
import { SessionCreatedSchema } from '../src/domain/http.ts';
import { createLocalHttpServer, type LocalHttpServer } from '../src/server/http.ts';
import { createProductionHost, type ProductionHost } from '../src/server/production-host.ts';
import { draftFixture } from './fixtures/continuista.ts';

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-recovery-runtime-'));
  const root = join(directory, 'host');
  const initialHost = openLocalHost({ privateDataRoot: root });
  const admission = createHostRequestBarrier();
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  let production: ProductionHost;
  let server: LocalHttpServer | undefined;
  let beforeClose: (() => void) | undefined; let afterClose: (() => void) | undefined; let reopenFailures = 0;
  let closes = 0; let reopens = 0; const diagnostics: unknown[] = [];
  const recovery = createHostRecoveryRuntime({ privateDataRoot: root, admissionBarrier: admission,
    async resetSessions() { assert.ok(server); await server.resetSessions(); },
    async closeProduction(options) { closes++; const hook = beforeClose; beforeClose = undefined; hook?.(); await production.close(options); const closedHook = afterClose; afterClose = undefined; closedHook?.(); },
    async reopenProduction({ directoryOperation }) {
      reopens++; if (reopenFailures > 0) { reopenFailures--; throw new Error('RECOVERY_TEST_REOPEN_FAILURE'); }
      production = await compose(openLocalHost({ privateDataRoot: root, directoryOperation }), directoryOperation);
    },
    onDiagnostic(event) { diagnostics.push(event); },
  });
  async function compose(host: ReturnType<typeof openLocalHost>, directoryOperation?: HostDirectoryOperation) {
    return await createProductionHost({ host, catalog, admissionBarrier: admission, configureRestorePort: recovery.wrap,
      ...(directoryOperation === undefined ? {} : { directoryOperation }), onDiagnostic(event) { diagnostics.push(event); } });
  }
  production = await compose(initialHost);
  const options = { catalog, shellHtml: '<html><head></head><body>Personajes</body></html>', ...production.httpOptions };
  server = createLocalHttpServer(new Proxy(options, { get(target, key, receiver) {
    if (key === 'operatorExtensions') return [recovery.routes, ...production.httpOptions.operatorExtensions];
    if (Reflect.has(production.httpOptions, key)) return Reflect.get(production.httpOptions, key);
    return Reflect.get(target, key, receiver);
  } }));
  const { origin } = await server.listen(0);
  const security = { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' };
  async function session() {
    const html = await (await fetch(origin + '/', { headers: security })).text();
    const bootNonce = html.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]{43})"/)?.[1]; assert.ok(bootNonce);
    const response = await fetch(origin + '/api/v1/session', { method: 'POST', headers: security, body: JSON.stringify({ bootNonce }) });
    assert.equal(response.status, 200, await response.clone().text());
    const created = SessionCreatedSchema.parse(await response.json());
    const cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    return { ...security, Cookie: cookie, 'X-CSRF-Token': created.csrfToken };
  }
  async function backup(headers: Awaited<ReturnType<typeof session>>) {
    const id = randomUUID();
    const response = await fetch(origin + `/api/v1/backups/${id}`, { method: 'PUT', headers: { ...headers, 'Idempotency-Key': randomUUID(), 'If-None-Match': '*' }, body: JSON.stringify({ scope: { kind: 'all' } }) });
    assert.equal(response.status, 202, await response.clone().text());
    const job = BackupJobSchema.parse(await response.json()); assert.equal(job.state, 'succeeded', job.safeCode ?? '');
    const etag = response.headers.get('etag'); assert.ok(etag); return { id, etag };
  }
  async function preview(headers: Awaited<ReturnType<typeof session>>, id: string) {
    const response = await fetch(origin + `/api/v1/backups/${id}/restore-preview`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ mode: 'recover' }) });
    assert.equal(response.status, 200, await response.clone().text()); return RestorePreviewSchema.parse(await response.json());
  }
  function state() {
    const db = new DatabaseSync(join(root, 'world.sqlite'), { readOnly: true });
    try { return { lineage: db.prepare('SELECT lineage_id FROM backup_host_identity').get()?.lineage_id,
      world: db.prepare('SELECT * FROM world_runs ORDER BY run_id').all(), budgets: db.prepare('SELECT * FROM run_budgets ORDER BY run_id').all(),
      events: db.prepare('SELECT * FROM world_events ORDER BY world_seq').all() }; }
    finally { db.close(); }
  }
  return { root, directory, origin, session, backup, preview, state, recovery, admission, diagnostics,
    onNextClose(hook: () => void) { beforeClose = hook; }, afterNextClose(hook: () => void) { afterClose = hook; }, failReopens(count: number) { reopenFailures = count; },
    get production() { return production; }, get closes() { return closes; }, get reopens() { return reopens; },
    async close() { await recovery.close(); await server?.close(); await production.close(); rmSync(directory, { recursive: true, force: true }); rmSync(root + '-auth', { recursive: true, force: true }); },
  };
}

test('recuperación HTTP productiva cierra y reabre puertos, restablece sesión y conserva journal, auth y backups posteriores', { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const { kind, schemaVersion, runId, revision, ...patch } = draftFixture(); void kind; void schemaVersion; void runId; void revision;
    const draft = f.production.host.journal.createRunConfigurationDraft({ principalId: 'runtime-recovery-test', idempotencyKey: randomUUID(), patch });
    assert.equal(draft.kind, 'created'); if (draft.kind !== 'created') assert.fail();
    const ready = f.production.host.journal.validateRunConfigurationDraft({ principalId: 'runtime-recovery-test', idempotencyKey: randomUUID(), runId: draft.draft.runId, expectedRevision: 0 });
    assert.equal(ready.kind, 'ready');
    const configuration = ReadyRunConfigurationSchema.parse(f.production.host.journal.readWorldConfiguration({ runId: draft.draft.runId }));
    const actor = configuration.roster.preparedCharacters[0]; assert.ok(actor);
    const actorRoot = join(f.root, 'runs', configuration.runId, 'actors', actor.characterId);
    const cwd = join(actorRoot, 'cwd'); mkdirSync(cwd, { recursive: true });
    const session = SessionManager.create(cwd, join(actorRoot, 'sessions'));
    session.appendMessage({ role: 'user', content: 'Registro sintético escrito por SDK, sin inferencia.', timestamp: Date.now() });
    session.appendMessage({ role: 'assistant', content: [], api: 'openai-codex-responses', provider: 'openai-codex', model: 'gpt-6.1-sol', stopReason: 'stop', timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const sessionPath = session.getSessionFile(); assert.ok(sessionPath && existsSync(sessionPath));
    f.production.host.journal.registerActorPiSession({ runId: configuration.runId, actorId: actor.characterId,
      sessionId: session.getSessionId(), sessionPath, preparedContextHash: hashContinuistaValue(actor), profile: DEFAULT_INFERENCE_PROFILE });
    const sessionBytes = readFileSync(sessionPath);
    const binaryPath = process.env.PERSONAJES_ICM_TEST_BINARY;
    if (binaryPath !== undefined) {
      const memory = await createIcmMemoryAdapter({ privateDataRoot: f.root, runId: configuration.runId, actorId: actor.characterId,
        binaryPath, ledger: { findReceipt: request => f.production.host.journal.findReceipt(request) } });
      await memory.initialize();
    }
    const configPath = join(actorRoot, 'icm-config.toml');
    const configBytes = existsSync(configPath) ? readFileSync(configPath) : undefined;
    let headers = await f.session(); const oldHeaders = headers;
    const before = f.state(); const originalJournal = f.production.host.journal;
    const first = await f.backup(headers); const later = await f.backup(headers);
    const saltPath = join(f.root, 'pi/auth/access-fingerprint.salt'); const salt = readFileSync(saltPath);
    // An explicit local test credential record changed after backup must survive.
    const authPath = join(f.root, 'pi/auth/auth.json'); const auth = Buffer.from('{}\n'); writeFileSync(authPath, auth, { mode: 0o600 });
    const preview = await f.preview(headers, first.id); assert.deepEqual(preview.blockers, []);
    const response = await fetch(f.origin + `/api/v1/backups/${first.id}/restore`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID(), 'If-Match': first.etag }, body: JSON.stringify({ previewToken: preview.previewToken, confirmDiffHash: preview.diffHash }) });
    assert.equal(response.status, 202, await response.clone().text()); const queued = HostRecoveryJobSchema.parse(await response.json()); assert.equal(queued.state, 'queued');
    const location = response.headers.get('location'); assert.equal(location, `/api/v1/host-recoveries/${queued.operationId}`);
    let job = queued; let reauthenticated = false; const deadline = Date.now() + 15_000;
    while (job.state !== 'succeeded') {
      assert.ok(Date.now() < deadline, JSON.stringify({ job, diagnostics: f.diagnostics }));
      let poll: Response = await fetch(f.origin + location, { headers });
      if (poll.status === 401) { headers = await f.session(); reauthenticated = true; poll = await fetch(f.origin + location, { headers }); }
      assert.equal(poll.status, 200, await poll.clone().text()); job = HostRecoveryJobSchema.parse(await poll.json());
      assert.ok(job.state !== 'failed' && job.state !== 'interrupted', JSON.stringify({ job, diagnostics: f.diagnostics }));
      if (job.state !== 'succeeded') await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
    await f.recovery.wait(); assert.equal(job.phase, 'verified'); assert.equal(reauthenticated, true);
    assert.equal(f.closes, 1); assert.equal(f.reopens, 1); assert.equal(f.admission.isHeld, false);
    assert.notEqual(f.production.host.journal, originalJournal); assert.throws(() => originalJournal.loadWorld({ runId: draft.draft.runId }));
    assert.deepEqual(f.state(), before); assert.deepEqual(readFileSync(saltPath), salt); assert.deepEqual(readFileSync(authPath), auth);
    assert.deepEqual(readFileSync(sessionPath), sessionBytes);
    assert.equal(f.production.host.journal.loadActorPiSession({ runId: configuration.runId, actorId: actor.characterId })?.sessionId, session.getSessionId());
    if (configBytes !== undefined) {
      assert.deepEqual(readFileSync(configPath), configBytes);
      const memory = new DatabaseSync(join(actorRoot, 'memory.sqlite'), { readOnly: true });
      try { assert.equal(memory.prepare('PRAGMA quick_check').get()?.quick_check, 'ok'); assert.equal(memory.prepare('SELECT count(*) n FROM memories').get()?.n, 0); }
      finally { memory.close(); }
    }
    for (const saved of [first, later]) {
      assert.ok(existsSync(join(f.root, 'backups', saved.id, 'manifest.json')));
      const metadata = await fetch(f.origin + `/api/v1/backups/${saved.id}`, { headers }); assert.equal(metadata.status, 200);
      assert.equal(BackupJobSchema.parse(await metadata.json()).state, 'succeeded'); f.production.exchange.backups.verify(saved.id);
    }
    assert.equal((await fetch(f.origin + '/api/v1/session', { headers: oldHeaders })).status, 401);
    assert.equal((await fetch(f.origin + `/api/v1/runs/${draft.draft.runId}`, { headers })).status, 200);
    assert.equal((await fetch(f.origin + `/api/v1/runs/${draft.draft.runId}/configuration`, { headers })).status, 200);
    await f.backup(headers);
  } finally { await f.close(); }
});

test('preview HTTP bloquea cambio de presupuesto posterior aunque no cambien eventos ni snapshots', async () => {
  const f = await fixture();
  try {
    const headers = await f.session(); const saved = await f.backup(headers); const before = f.state();
    f.production.host.journal.configureRun({ runId: randomUUID(), maxCalls: 20 });
    const preview = await f.preview(headers, saved.id);
    assert.deepEqual(preview.blockers, ['RECOVERY_STATE_DIVERGED']);
    const after = f.state(); assert.deepEqual(after.events, before.events); assert.deepEqual(after.world, before.world);
    assert.notDeepEqual(after.budgets, before.budgets); assert.equal(f.closes, 0); assert.equal(f.reopens, 0);
    const result = await fetch(f.origin + `/api/v1/backups/${saved.id}/restore`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID(), 'If-Match': saved.etag }, body: JSON.stringify({ previewToken: preview.previewToken, confirmDiffHash: preview.diffHash }) });
    assert.equal(result.status, 503, await result.clone().text()); assert.equal(f.closes, 0);
    assert.deepEqual(f.state(), after); assert.equal(f.admission.isHeld, false);
  } finally { await f.close(); }
});

type RuntimeFixture = Awaited<ReturnType<typeof fixture>>;
type RuntimeHeaders = Awaited<ReturnType<RuntimeFixture['session']>>;
async function startRecovery(f: RuntimeFixture, headers: RuntimeHeaders, backup: Awaited<ReturnType<RuntimeFixture['backup']>>) {
  const preview = await f.preview(headers, backup.id); assert.deepEqual(preview.blockers, []);
  const response = await fetch(f.origin + `/api/v1/backups/${backup.id}/restore`, { method: 'POST',
    headers: { ...headers, 'Idempotency-Key': randomUUID(), 'If-Match': backup.etag },
    body: JSON.stringify({ previewToken: preview.previewToken, confirmDiffHash: preview.diffHash }) });
  assert.equal(response.status, 202, await response.clone().text());
  const job = HostRecoveryJobSchema.parse(await response.json()); assert.equal(job.state, 'queued');
  return `/api/v1/host-recoveries/${job.operationId}`;
}
async function settledJob(f: RuntimeFixture, location: string, originalHeaders: RuntimeHeaders) {
  await f.recovery.wait();
  let headers = originalHeaders;
  let response: Response = await fetch(f.origin + location, { headers });
  if (response.status === 401) { headers = await f.session(); response = await fetch(f.origin + location, { headers }); }
  assert.equal(response.status, 200, await response.clone().text());
  const job = HostRecoveryJobSchema.parse(await response.json()); const etag = response.headers.get('etag'); assert.ok(etag);
  return { headers, job, etag };
}

test('cambio operativo durante cierre aborta antes del swap, reabre original y permite una recuperación nueva', { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    let headers = await f.session(); const saved = await f.backup(headers); const before = f.state();
    const changedRunId = randomUUID();
    f.onNextClose(() => f.production.host.journal.configureRun({ runId: changedRunId, maxCalls: 23 }));
    const location = await startRecovery(f, headers, saved);
    const completed = await settledJob(f, location, headers); headers = completed.headers;
    assert.equal(completed.job.state, 'aborted', JSON.stringify({ job: completed.job, diagnostics: f.diagnostics }));
    assert.equal(completed.job.phase, 'original-retained');
    assert.equal(f.closes, 1); assert.equal(f.reopens, 1); assert.equal(f.admission.isHeld, false);
    const changed = f.state(); assert.equal(changed.lineage, before.lineage);
    assert.deepEqual(changed.world, before.world); assert.deepEqual(changed.events, before.events);
    assert.ok(changed.budgets.some(row => row.run_id === changedRunId && row.max_calls === 23));
    assert.deepEqual(f.recovery.pendingOperations(), []);
    assert.equal((await fetch(f.origin + `/api/v1/backups/${saved.id}`, { headers })).status, 200);
    const fresh = await f.backup(headers);
    const next = await settledJob(f, await startRecovery(f, headers, fresh), headers); headers = next.headers;
    assert.equal(next.job.state, 'succeeded', JSON.stringify({ job: next.job, diagnostics: f.diagnostics }));
    assert.equal(next.job.phase, 'verified'); assert.deepEqual(f.state(), changed);
    assert.deepEqual(f.recovery.pendingOperations(), []); assert.equal(f.admission.isHeld, false);
    assert.equal((await fetch(f.origin + `/api/v1/backups/${fresh.id}`, { headers })).status, 200);
  } finally { await f.close(); }
});

test('replay de resume confirmado no vuelve a ejecutar tras otro fallo; clave nueva reabre la misma recuperación', { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    let headers = await f.session(); const saved = await f.backup(headers); const before = f.state();
    f.failReopens(2);
    const location = await startRecovery(f, headers, saved);
    const initial = await settledJob(f, location, headers); headers = initial.headers;
    assert.equal(initial.job.state, 'failed'); assert.equal(initial.job.phase, 'reopening');
    assert.equal(f.admission.isRecovering, true); assert.equal(f.reopens, 1);
    const key = randomUUID();
    const resume = async (idempotencyKey: string, etag: string) => {
      const response = await fetch(f.origin + location + '/resume', { method: 'POST', headers: { ...headers, 'Idempotency-Key': idempotencyKey, 'If-Match': etag }, body: '{}' });
      assert.equal(response.status, 202, await response.clone().text()); return HostRecoveryJobSchema.parse(await response.json());
    };
    const admitted = await resume(key, initial.etag); assert.equal(admitted.state, 'queued');
    const failed = await settledJob(f, location, headers); headers = failed.headers;
    assert.equal(failed.job.state, 'failed'); assert.equal(failed.job.phase, 'reopening'); assert.equal(f.reopens, 2);
    const closes = f.closes;
    assert.deepEqual(await resume(key, initial.etag), admitted, 'El retry recupera el recibo histórico de admisión.');
    await f.recovery.wait();
    const unchanged = await settledJob(f, location, headers); headers = unchanged.headers;
    assert.deepEqual(unchanged.job, failed.job); assert.equal(f.closes, closes); assert.equal(f.reopens, 2);
    assert.equal(f.admission.isRecovering, true);
    assert.equal((await fetch(f.origin + `/api/v1/backups/${saved.id}`, { headers })).status, 503);
    assert.equal((await resume(randomUUID(), unchanged.etag)).state, 'queued');
    const completed = await settledJob(f, location, headers); headers = completed.headers;
    assert.equal(completed.job.state, 'succeeded', JSON.stringify({ job: completed.job, diagnostics: f.diagnostics }));
    assert.equal(completed.job.phase, 'verified'); assert.equal(f.reopens, 3); assert.equal(f.admission.isHeld, false);
    assert.deepEqual(f.state(), before); assert.deepEqual(f.recovery.pendingOperations(), []);
    assert.equal((await fetch(f.origin + `/api/v1/backups/${saved.id}`, { headers })).status, 200);
  } finally { await f.close(); }
});

test('fallo real del control durable tras cierre parcial mantiene HTTP offline y conserva original sin intercambio', { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const headers = await f.session(); const saved = await f.backup(headers);
    const before = f.state(); const original = lstatSync(f.root); const journal = f.production.host.journal;
    const controlRoot = join(f.directory, '.host.personajes-recovery');
    let displacedRecord: string | undefined;
    f.afterNextClose(() => {
      const records = readdirSync(controlRoot).filter(name => name.endsWith('.json'));
      assert.equal(records.length, 1); const record = records[0]; assert.ok(record);
      const path = join(controlRoot, record); displacedRecord = path + '.preserved';
      // Real filesystem collision: retain the authenticated original control
      // bytes, but prevent the engine from saving its failed-close receipt.
      renameSync(path, displacedRecord); mkdirSync(path, { mode: 0o700 });
      throw new Error('RECOVERY_TEST_PARTIAL_CLOSE');
    });
    await startRecovery(f, headers, saved);
    await assert.doesNotReject(f.recovery.wait());
    assert.equal(f.closes, 1); assert.equal(f.reopens, 0);
    assert.equal(f.admission.isRecovering, true);
    assert.ok(f.diagnostics.some(event => typeof event === 'object' && event !== null && 'kind' in event && event.kind === 'hostRecoveryDiagnostic'));
    assert.throws(() => journal.listRunConfigurationDrafts(), 'Las conexiones productivas ya están cerradas.');
    const freshHeaders = await f.session();
    for (const path of [`/api/v1/backups/${saved.id}`, '/api/v1/runs/00000000-0000-4000-8000-000000000101', '/api/v1/health']) {
      const response = await fetch(f.origin + path, { headers: freshHeaders });
      assert.equal(response.status, 503, await response.clone().text());
      assert.match(await response.text(), /HOST_RECOVERY_IN_PROGRESS/);
    }
    const current = lstatSync(f.root); assert.equal(current.dev, original.dev); assert.equal(current.ino, original.ino);
    assert.deepEqual(f.state(), before);
    assert.equal(readdirSync(f.directory).some(name => name.startsWith('.host.recovery-')), false, 'No hay directorio intercambiado ni staging.');
    assert.ok(displacedRecord && existsSync(displacedRecord));
    assert.ok(readFileSync(displacedRecord).includes(Buffer.from('host-recovery-control')));
  } finally { await f.close(); }
});
