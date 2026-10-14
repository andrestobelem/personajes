import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openJournal } from '../src/adapters/journal.ts';
import { PiRuntime } from '../src/adapters/pi.ts';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { createProductionPreflightHost } from '../src/application/production-preflight-host.ts';
import { createPiAuthFingerprint } from '../src/application/pi-auth-fingerprint.ts';
import { createRunPreflightJobs, projectRunPreflightReport } from '../src/application/run-preflight-jobs.ts';
import { validateRunConfiguration, type PreflightReport } from '../src/application/production-preflight.ts';
import { draftFixture, canonical } from './fixtures/continuista.ts';

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-preflight-broker-')); const path = join(directory, 'journal.sqlite');
  const journal = openJournal({ path }); const result = validateRunConfiguration({ draft: draftFixture() });
  assert.ok(result.kind === 'ready'); const configuration = result.configuration;
  journal.registerWorldRun({ initialSnapshot: configuration.worldSnapshot, configurationRevision: configuration.configRevision, configuration, lifecycle: 'ready',
    continuityFence: { kind: 'prepared-contexts', atWorldSeq: configuration.worldSnapshot.seq, contexts: configuration.roster.preparedCharacters.map((actor) => ({ actorId: actor.characterId,
      continuityId: actor.continuity.continuityId, continuityRevision: actor.continuity.revision, continuityContentHash: actor.continuity.contentHash,
      preparedContextHash: createHash('sha256').update(canonical(actor)).digest('hex'), identityVersion: actor.identityVersion })) } });
  const runtime = await PiRuntime.create({ privateDataRoot: directory });
  const authentication = createPiAuthFingerprint({ privateDataRoot: directory, environment: {} });
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  const createHost = () => createProductionPreflightHost({ journal, catalog, piRuntime: runtime, authentication });
  const scopes = { runId: configuration.runId, expectedConfigurationRevision: configuration.configRevision, expectedWorldRevision: configuration.worldSnapshot.revision };
  t.after(() => { journal.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, path, journal, configuration, runtime, authentication, catalog, createHost, scopes };
}
async function until(check: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 200; attempt += 1) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 1)); }
  throw new Error('Preflight did not settle');
}

test('broker evalúa host real una vez por job, guarda bloqueo durable y no crea sesiones/requests/hechos', async (t) => {
  const f = await fixture(t); let hosts = 0;
  const broker = await createRunPreflightJobs({ journal: f.journal, ownerToken: randomUUID(), createHost() { hosts += 1; return f.createHost(); }, readCredentialFingerprint: f.authentication.readCredentialFingerprint });
  const beforeWorld = f.journal.loadWorld({ runId: f.scopes.runId }); const beforeConfiguration = f.journal.readWorldConfiguration({ runId: f.scopes.runId });
  const key = randomUUID(); const started = await broker.start({ ...f.scopes, idempotencyKey: key }); assert.ok(started.kind === 'created');
  await until(async () => { const read = await broker.readJob({ runId: f.scopes.runId, jobId: started.job.jobId }); return read.kind === 'found' && read.job.state === 'completed'; });
  const read = await broker.readJob({ runId: f.scopes.runId, jobId: started.job.jobId }); assert.ok(read.kind === 'found');
  assert.equal(read.report.result?.kind, 'blocked'); assert.equal(read.report.kind, 'current');
  assert.ok(read.report.result?.checks.some((check) => check.checkId === 'budget' && check.kind === 'passed'));
  assert.ok(read.report.result?.checks.some((check) => check.checkId === 'pi-runtime' && check.kind === 'unavailable'));
  assert.doesNotMatch(JSON.stringify(read), /Fingerprint|configurationHash|sessionPath|detail|PRIVATE|refresh|access_token/);
  assert.deepEqual(await broker.start({ ...f.scopes, idempotencyKey: key }), { kind: 'existing', job: started.job });
  assert.equal(hosts, 1);
  const second = await broker.start({ ...f.scopes, idempotencyKey: randomUUID() }); assert.ok(second.kind === 'created');
  await until(async () => { const read = await broker.readJob({ runId: f.scopes.runId, jobId: second.job.jobId }); return read.kind === 'found' && read.job.state === 'completed'; });
  assert.equal(hosts, 2, 'Every job owns fresh captured evidence');
  const page = await broker.listJobs({ runId: f.scopes.runId, offset: 0, limit: 1 }); assert.equal(page.items.length, 1); assert.ok(page.nextCursor);
  assert.equal((await broker.listJobs({ runId: f.scopes.runId, offset: 1, limit: 1 })).items.length, 1);
  assert.deepEqual(await broker.readJob({ runId: randomUUID(), jobId: started.job.jobId }), { kind: 'missing' });
  assert.deepEqual(f.journal.loadWorld({ runId: f.scopes.runId }), beforeWorld); assert.deepEqual(f.journal.readWorldConfiguration({ runId: f.scopes.runId }), beforeConfiguration);
  const db = new DatabaseSync(f.path);
  for (const table of ['world_events', 'request_reservations', 'actor_pi_sessions', 'continuista_sessions']) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count, 0);
  db.close(); await broker.close();
});

test('GET/list compara credencial actual con evidencia original sin reescribir proof ni evaluar otra vez', async (t) => {
  const f = await fixture(t); let hosts = 0;
  writeFileSync(join(f.directory, 'pi', 'auth', 'auth.json'), JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'SYNTHETIC_OLD_ACCESS', refresh: 'SYNTHETIC_OLD_REFRESH', expires: Date.now() + 60_000 } }), { mode: 0o600 });
  const broker = await createRunPreflightJobs({ journal: f.journal, ownerToken: randomUUID(), createHost() { hosts += 1; return f.createHost(); }, readCredentialFingerprint: f.authentication.readCredentialFingerprint });
  const started = await broker.start({ ...f.scopes, idempotencyKey: randomUUID() }); assert.ok(started.kind === 'created');
  await until(async () => { const read = await broker.readJob({ runId: f.scopes.runId, jobId: started.job.jobId }); return read.kind === 'found' && read.job.state === 'completed'; });
  const evidence = f.journal.readRunPreflightJobEvidence({ runId: f.scopes.runId, jobId: started.job.jobId }); assert.ok(evidence.kind === 'found');
  assert.equal(evidence.evidence.provider, 'openai-codex'); assert.ok(evidence.evidence.accountFingerprint);
  writeFileSync(join(f.directory, 'pi', 'auth', 'auth.json'), JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'SYNTHETIC_NEW_ACCESS', refresh: 'SYNTHETIC_REFRESH', expires: Date.now() + 60_000 } }), { mode: 0o600 });
  const after = await broker.readJob({ runId: f.scopes.runId, jobId: started.job.jobId }); assert.ok(after.kind === 'found'); assert.equal(after.report.kind, 'stale');
  const page = await broker.listJobs({ runId: f.scopes.runId, offset: 0, limit: 100 }); assert.equal(page.items[0]?.report.kind, 'stale');
  assert.doesNotMatch(JSON.stringify(page), /SYNTHETIC|Fingerprint|refresh/); assert.equal(hosts, 1);
  assert.deepEqual(f.journal.readRunPreflightJobEvidence({ runId: f.scopes.runId, jobId: started.job.jobId }), evidence);
  writeFileSync(join(f.directory, 'pi', 'auth', 'auth.json'), '{}', { mode: 0o600 });
  const loggedOut = await broker.readJob({ runId: f.scopes.runId, jobId: started.job.jobId });
  assert.ok(loggedOut.kind === 'found'); assert.equal(loggedOut.report.kind, 'stale');
  assert.deepEqual(f.journal.readRunPreflightJobEvidence({ runId: f.scopes.runId, jobId: started.job.jobId }), evidence);
  await broker.close();
});

test('cancelación y close esperan evaluación readonly que ignora Abort y no adoptan resultado tardío', async (t) => {
  const f = await fixture(t); let release: (() => void) | undefined; let entered = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const broker = await createRunPreflightJobs({ journal: f.journal, ownerToken: randomUUID(), readCredentialFingerprint: f.authentication.readCredentialFingerprint,
    createHost() { const host = f.createHost(); return { ...host, async readCurrentConfigurationRevision(value) { entered = true; await gate; return host.readCurrentConfigurationRevision(value); } }; } });
  const started = await broker.start({ ...f.scopes, idempotencyKey: randomUUID() }); assert.ok(started.kind === 'created'); await until(() => entered);
  const running = await broker.readJob({ runId: f.scopes.runId, jobId: started.job.jobId }); assert.ok(running.kind === 'found');
  const canceled = await broker.cancelJob({ runId: f.scopes.runId, jobId: started.job.jobId, expectedRevision: running.job.revision, idempotencyKey: randomUUID() });
  assert.ok(canceled.kind === 'updated'); assert.equal(canceled.job.state, 'cancel-requested');
  let closed = false; const closing = broker.close().then(() => { closed = true; });
  await new Promise((resolve) => setTimeout(resolve, 5)); assert.equal(closed, false); assert.ok(release); release(); await closing;
  const terminal = f.journal.readRunPreflightJob({ runId: f.scopes.runId, jobId: started.job.jobId }); assert.ok(terminal.kind === 'found');
  assert.equal(terminal.document.job.state, 'canceled'); assert.equal(terminal.document.report.result, null);
  await assert.rejects(broker.start({ ...f.scopes, idempotencyKey: randomUUID() }), /closed/);
});

test('recovery de job abandonado no llama host y replay no reinicia evaluación', async (t) => {
  const f = await fixture(t); const key = randomUUID();
  const created = f.journal.createRunPreflightJob({ ...f.scopes, principalId: 'local-operator', idempotencyKey: key }); assert.ok(created.kind === 'created');
  f.journal.claimRunPreflightJob({ runId: f.scopes.runId, jobId: created.job.jobId, expectedRevision: 0, ownerToken: randomUUID(), claimToken: randomUUID() });
  let hosts = 0;
  const broker = await createRunPreflightJobs({ journal: f.journal, ownerToken: randomUUID(), createHost() { hosts += 1; return f.createHost(); }, readCredentialFingerprint: f.authentication.readCredentialFingerprint });
  const read = await broker.readJob({ runId: f.scopes.runId, jobId: created.job.jobId }); assert.ok(read.kind === 'found'); assert.equal(read.job.state, 'interrupted');
  assert.deepEqual(await broker.start({ ...f.scopes, idempotencyKey: key }), { kind: 'existing', job: created.job });
  await broker.close(); assert.equal(hosts, 0);
});

test('proyección omite details y códigos no conocidos; availability se resume sin nombres de actores', () => {
  const report: PreflightReport = { kind: 'invalid', checks: [
    { kind: 'unavailable', checkId: 'budget', code: 'secret-sensitive-token', detail: '/private/SECRET_PATH' },
    { kind: 'deferred', checkId: 'availability-personaje-sintetico', detail: 'SECRET_ACTOR' },
  ] };
  const result = projectRunPreflightReport(report, '2026-10-14T12:00:00.000Z');
  assert.deepEqual(result.checks, [{ kind: 'unavailable', checkId: 'budget', code: 'check-unavailable' }, { kind: 'deferred', checkId: 'participant-availability' }]);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|personaje-sintetico|secret-sensitive/);
});
