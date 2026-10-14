import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { z } from 'zod';
import { loadCatalog, type LoadedCatalog } from '../src/adapters/catalog.ts';
import { PiRuntime } from '../src/adapters/pi.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createPiAuthFingerprint } from '../src/application/pi-auth-fingerprint.ts';
import { createProductionPreflightHost } from '../src/application/production-preflight-host.ts';
import { createRunPreflightJobs } from '../src/application/run-preflight-jobs.ts';
import { RunPreflightJobDocumentSchema, RunPreflightJobReceiptSchema, SessionCreatedSchema } from '../src/domain/http.ts';
import { RunModelTimeBudgetSchema } from '../src/domain/model-time-budget.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { changeDraftField } from '../src/web/draft-form.ts';
import { createCleanReadyPreflightFixture } from './fixtures/preflight.ts';

async function createHarness(input: { privateDataRoot: string; catalog: LoadedCatalog }) {
  const host = openLocalHost({ privateDataRoot: input.privateDataRoot });
  const piRuntime = await PiRuntime.create({ privateDataRoot: input.privateDataRoot });
  let providerCalls = 0;
  // Real host resources remain in use; these sentinels forbid accidental auth refresh or transport.
  piRuntime.modelRuntime.getAuth = async () => { providerCalls++; throw new Error('Provider resolution is forbidden in this readonly integration test.'); };
  piRuntime.modelRuntime.streamSimple = () => { providerCalls++; throw new Error('Provider transport is forbidden in this readonly integration test.'); };
  const authentication = createPiAuthFingerprint({ privateDataRoot: input.privateDataRoot, environment: {} });
  const broker = await createRunPreflightJobs({
    journal: host.journal, ownerToken: host.ownerToken,
    createHost: () => createProductionPreflightHost({ journal: host.journal, catalog: input.catalog, piRuntime, authentication }),
    readCredentialFingerprint: authentication.readCredentialFingerprint,
  });
  const server = createLocalHttpServer({
    catalog: input.catalog, shellHtml: '<!doctype html><html><head></head><body></body></html>', runPreflightJobs: broker,
    runConfigurationDrafts: host.journal,
    readRunModelTimeBudget: (request) => host.journal.readRunModelTimeBudget(request),
  });
  const { origin } = await server.listen(0);
  return {
    host, origin,
    get providerCalls() { return providerCalls; },
    async close() {
      try { await server.close(); }
      finally { try { await broker.close(); } finally { host.close(); } }
    },
  };
}

async function createSession(origin: string) {
  const originHeaders = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
  const shell = await fetch(origin + '/', { headers: originHeaders });
  assert.equal(shell.status, 200);
  const nonce = (await shell.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];
  assert.ok(nonce);
  const response = await fetch(origin + '/api/v1/session', {
    method: 'POST', headers: { ...originHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ bootNonce: nonce }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const session = SessionCreatedSchema.parse(await response.json());
  return { ...originHeaders, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken };
}

async function readCompletedJob(input: { origin: string; path: string; headers: Record<string, string> }) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const response = await fetch(input.origin + input.path, { headers: input.headers });
    assert.equal(response.status, 200, await response.clone().text());
    const document = RunPreflightJobDocumentSchema.parse(await response.json());
    if (document.job.state === 'completed') return document;
    assert.ok(['queued', 'running'].includes(document.job.state), `Unexpected preflight state: ${document.job.state}`);
    await delay(10);
  }
  assert.fail('The real readonly preflight did not complete in the bounded integration window.');
}

function assertNoExecution(privateDataRoot: string) {
  const database = new DatabaseSync(join(privateDataRoot, 'world.sqlite'), { readOnly: true });
  try {
    for (const table of ['world_events', 'actor_pi_sessions', 'actor_turn_jobs', 'continuista_sessions', 'continuista_jobs', 'pi_access_jobs', 'pi_oauth_jobs', 'request_reservations', 'experiences']) {
      const count = z.strictObject({ count: z.number().int().nonnegative() }).parse(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get());
      assert.equal(count.count, 0, `Readonly preflight unexpectedly created rows in ${table}`);
    }
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM run_preflight_jobs').get()?.count, 1);
  } finally { database.close(); }
}

test('Ready limpio → broker/host/HTTP reales → bloqueo durable conserva receipt y reabre sin sesiones ni proveedor', async (t) => {
  const privateDataRoot = mkdtempSync(join(tmpdir(), 'personajes-http-preflight-integration-'));
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  let harness: Awaited<ReturnType<typeof createHarness>> | undefined;
  t.after(async () => { try { await harness?.close(); } finally { rmSync(privateDataRoot, { recursive: true, force: true }); } });
  harness = await createHarness({ privateDataRoot, catalog });
  const fixture = createCleanReadyPreflightFixture({ journal: harness.host.journal });
  const originalWorld = harness.host.journal.loadWorld({ runId: fixture.runId });
  const originalConfiguration = harness.host.journal.readWorldConfiguration({ runId: fixture.runId });
  const headers = await createSession(harness.origin);
  const budgetResponse = await fetch(harness.origin + `/api/v1/runs/${fixture.runId}/budget`, { headers });
  assert.equal(budgetResponse.status, 200, await budgetResponse.clone().text());
  const budgetSnapshot = RunModelTimeBudgetSchema.parse(await budgetResponse.json());
  assert.equal(budgetSnapshot.runId, fixture.runId);
  assert.equal(budgetSnapshot.status, 'known');
  assert.equal(budgetSnapshot.wallTimeMeasuredMs, 0);
  assert.match(budgetResponse.headers.get('etag') ?? '', /^"run-budget:[0-9a-f-]{36}:[0-9a-f]{64}"$/);
  const path = `/api/v1/runs/${fixture.runId}/preflight`;
  const key = randomUUID();
  const postHeaders = { ...headers, 'Idempotency-Key': key, 'If-Match': `"run:${fixture.runId}:c${fixture.configuration.configRevision}:w${fixture.configuration.worldSnapshot.revision}"` };
  const started = await fetch(harness.origin + path, { method: 'POST', headers: postHeaders, body: '{}' });
  assert.equal(started.status, 202, await started.clone().text());
  const originalReceipt = RunPreflightJobReceiptSchema.parse(await started.json());
  const originalEtag = started.headers.get('etag');
  const jobPath = `${path}/jobs/${originalReceipt.job.jobId}`;
  const document = await readCompletedJob({ origin: harness.origin, path: jobPath, headers });
  assert.equal(document.job.resultKind, 'blocked');
  assert.equal(document.report.result?.kind, 'blocked');
  assert.ok(document.report.result?.checks.some((check) => check.checkId === 'provider-authentication' && check.kind !== 'passed'));
  assert.ok(document.report.result?.checks.some((check) => check.checkId === 'pi-runtime' && check.kind === 'unavailable'));
  const actualBudget = harness.host.journal.readRunModelTimeBudget({ runId: fixture.runId });
  assert.equal(actualBudget?.status, 'known');
  if (actualBudget?.status !== 'known') assert.fail('La preparación limpia debe tener contabilidad conocida.');
  assert.equal(actualBudget.wallTimeMeasuredMs, 0);
  assert.equal(actualBudget.wallTimeReservedMs, 0);
  assert.equal(actualBudget.wallTimeRemainingMs, fixture.configuration.budget.maxWallTimeMs);
  assert.ok(document.report.result?.checks.some((check) => check.checkId === 'budget' && check.kind === 'passed'));
  assert.doesNotMatch(JSON.stringify(document), /configurationHash|accountFingerprint|profileFingerprint|sessionPath|systemPrompt|"detail"/);
  assert.equal(harness.providerCalls, 0);
  assertNoExecution(privateDataRoot);
  assert.deepEqual(harness.host.journal.loadWorld({ runId: fixture.runId }), originalWorld);
  assert.deepEqual(harness.host.journal.readWorldConfiguration({ runId: fixture.runId }), originalConfiguration);

  await harness.close(); harness = undefined;
  harness = await createHarness({ privateDataRoot, catalog });
  const reopenedHeaders = await createSession(harness.origin);
  const reopened = await readCompletedJob({ origin: harness.origin, path: jobPath, headers: reopenedHeaders });
  assert.deepEqual(reopened, document, 'Reopening reads the exact durable report, without reevaluation.');
  const replay = await fetch(harness.origin + path, { method: 'POST', headers: { ...reopenedHeaders, 'Idempotency-Key': key, 'If-Match': postHeaders['If-Match'] }, body: '{}' });
  assert.equal(replay.status, 202, await replay.clone().text());
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.equal(replay.headers.get('etag'), originalEtag);
  assert.deepEqual(RunPreflightJobReceiptSchema.parse(await replay.json()), originalReceipt);
  assert.equal(harness.providerCalls, 0);
  assertNoExecution(privateDataRoot);
  assert.deepEqual(harness.host.journal.loadWorld({ runId: fixture.runId }), originalWorld);
  assert.deepEqual(harness.host.journal.readWorldConfiguration({ runId: fixture.runId }), originalConfiguration);

  const editedDraft = changeDraftField({ draft: fixture.draft, field: 'name', value: 'Synthetic preparation revised after preflight.' });
  const edit = await fetch(harness.origin + `/api/v1/runs/${fixture.runId}/configuration`, {
    method: 'PUT', headers: { ...reopenedHeaders, 'Idempotency-Key': randomUUID(), 'If-Match': `"run-config:${fixture.runId}:c${fixture.draft.revision}"` },
    body: JSON.stringify({ configuration: editedDraft }),
  });
  assert.equal(edit.status, 200, await edit.clone().text());
  const historicalAfterEdit = await readCompletedJob({ origin: harness.origin, path: jobPath, headers: reopenedHeaders });
  assert.equal(historicalAfterEdit.report.kind, 'stale', 'Editing Ready invalidates the old report without making its GET fail.');
  assert.deepEqual(historicalAfterEdit.report.result, document.report.result, 'Staleness never rewrites the observed report.');
  assert.equal(harness.providerCalls, 0);
  assertNoExecution(privateDataRoot);
  assert.deepEqual(harness.host.journal.loadWorld({ runId: fixture.runId }), originalWorld);
});
