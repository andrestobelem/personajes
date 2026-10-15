import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import {
  RunControlReceiptSchema, RunViewSchema, SessionCreatedSchema,
  type RunView,
} from '../src/domain/http.ts';
import type { RunLifecycleControlRequest } from '../src/domain/run-lifecycle.ts';
import { createLocalHttpServer, type RunLifecycleApplicationPort } from '../src/server/http.ts';
import { draftFixture } from './fixtures/continuista.ts';

const timestamp = '2026-10-14T12:00:00.000Z';

function makeRunView(): RunView {
  const result = validateRunConfiguration({ draft: draftFixture() });
  if (result.kind !== 'ready') throw new Error('Synthetic lifecycle fixture must be Ready.');
  const configuration = result.configuration;
  const runId = configuration.runId;
  return RunViewSchema.parse({
    runId,
    configRevision: configuration.configRevision,
    worldRevision: configuration.worldSnapshot.revision,
    structureRevision: 0,
    activeEpisodeId: null,
    activeSceneId: configuration.worldSnapshot.activeSceneId,
    lastWorldSeq: configuration.worldSnapshot.seq,
    lifecycleRevision: 3,
    lifecycle: { kind: 'ready' },
    config: {
      runId,
      configRevision: configuration.configRevision,
      name: configuration.name,
      fictionalAt: configuration.fictionalAt,
      continuity: {continuityId:configuration.continuity.continuityId,revision:configuration.continuity.revision},
      roster: {activeCharacterCount:configuration.roster.activeCharacterIds.length},
      humanParticipantCount:configuration.humanParticipants.length,
      language: configuration.language,
      spanishVariety: configuration.spanishVariety,
      narrationMode: configuration.narrationMode,
      ...(configuration.inferenceProfile === undefined ? {} : { inferenceProfile: configuration.inferenceProfile }),
      budget: configuration.budget,
      maxReformulations: configuration.maxReformulations,
      audio:{mode:configuration.audio.mode},
    },
    clock: configuration.worldSnapshot.clock,
    limits: {
      maxModelCallsPerRun: configuration.budget.maxPiCallsPerRun,
      maxModelCallsPerPulse: configuration.budget.maxPiCallsPerPulse,
      maxConcurrentCalls: configuration.budget.maxConcurrentPiRequests,
      requestTimeoutMs: configuration.budget.requestTimeoutMs ?? 30_000,
      maxModelWallTimeMsPerRun: configuration.budget.maxWallTimeMs,
      maxTtsCallsPerRun: 0,
      maxDesignCallsPerRun: 0,
      maxSfxCallsPerRun: 0,
      maxReformulations: configuration.maxReformulations,
    },
    budget: {
      modelCalls: { limit: configuration.budget.maxPiCallsPerRun, used: 0, reserved: 0, remaining: configuration.budget.maxPiCallsPerRun },
      modelWallTimeMs: { limit: configuration.budget.maxWallTimeMs, measured: 0, reserved: 0, remaining: configuration.budget.maxWallTimeMs },
      voiceDesignCalls: { limit: 0, used: 0, reserved: 0, remaining: 0 },
      ttsCalls: { limit: 0, used: 0, reserved: 0, remaining: 0 },
      sfxCalls: { limit: 0, used: 0, reserved: 0, remaining: 0 },
      status: 'available',
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function controlledLifecycle(initial = makeRunView()) {
  let view = initial;
  let result: unknown = { kind: 'updated', run: view, replayed: false };
  const reads: string[] = [];
  const controls: Array<{
    runId: string;
    principalId: string;
    idempotencyKey: string;
    expectedConfigurationRevision: number;
    expectedWorldRevision: number;
    expectedStructureRevision: number;
    expectedLifecycleRevision: number;
    command: RunLifecycleControlRequest;
  }> = [];
  const port: RunLifecycleApplicationPort = {
    readRunView(input) { reads.push(input.runId); return input.runId === view.runId ? view : undefined; },
    controlRun(input) { controls.push(input); return result; },
  };
  return {
    port, reads, controls,
    get view() { return view; },
    setView(next: RunView) { view = next; result = { kind: 'updated', run: view, replayed: false }; },
    setResult(next: unknown) { result = next; },
  };
}

async function setup(t: TestContext, runLifecycle: RunLifecycleApplicationPort) {
  const server = createLocalHttpServer({ catalog: await loadCatalog({ repositoryRoot: process.cwd() }),
    shellHtml: '<!doctype html><html><head></head><body></body></html>', runLifecycle });
  const { origin } = await server.listen(); t.after(() => server.close());
  const originHeaders = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
  const shell = await fetch(origin + '/', { headers: originHeaders });
  const nonce = (await shell.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1]; assert.ok(nonce);
  const sessionResponse = await fetch(origin + '/api/v1/session', { method: 'POST', headers: { ...originHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ bootNonce: nonce }) });
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  const session = SessionCreatedSchema.parse(await sessionResponse.json());
  return { origin, headers: { ...originHeaders, Cookie: cookie, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' } };
}

function etag(view: RunView): string {
  return `"run:${view.runId}:c${view.configRevision}:w${view.worldRevision}:s${view.structureRevision}:l${view.lifecycleRevision}"`;
}

test('GET RunView devuelve ETag fuerte con lifecycleRevision y falla cerrado ante port fuera de scope', async (t) => {
  const state = controlledLifecycle(); const host = await setup(t, state.port); const path = `/api/v1/runs/${state.view.runId}`;
  const unauthenticated = await fetch(host.origin + path, { headers: { Origin: host.origin, 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(unauthenticated.status, 401);
  const response = await fetch(host.origin + path, { headers: host.headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('etag'), etag(state.view));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(RunViewSchema.parse(await response.json()), state.view);
  assert.deepEqual(state.reads, [state.view.runId]);

  const invalidPort = { ...state.port, readRunView: () => ({ ...state.view, unexpectedAuthority: 'secret' }) };
  const invalidHost = await setup(t, invalidPort);
  const invalidResponse = await fetch(invalidHost.origin + path, { headers: invalidHost.headers });
  assert.equal(invalidResponse.status, 500);
  assert.doesNotMatch(await invalidResponse.text(), /unexpectedAuthority|secret/);
});

test('POST controls exige CSRF, key, ETag fuerte y comando cerrado antes de llamar el puerto', async (t) => {
  const state = controlledLifecycle(); const host = await setup(t, state.port); const path = `/api/v1/runs/${state.view.runId}/controls`;
  const post = (options: { body?: unknown; key?: string; match?: string; headers?: Record<string, string> } = {}) => fetch(host.origin + path, {
    method: 'POST', headers: {
      ...host.headers,
      ...(options.key === undefined ? {} : { 'Idempotency-Key': options.key }),
      ...(options.match === undefined ? {} : { 'If-Match': options.match }),
      ...options.headers,
    }, body: JSON.stringify(options.body ?? { kind: 'pause' }),
  });
  const validMatch = etag(state.view);
  assert.equal((await post({ key: randomUUID(), match: validMatch, headers: { 'X-CSRF-Token': 'wrong' } })).status, 403);
  assert.equal((await post({ match: validMatch })).status, 400);
  assert.equal((await post({ key: randomUUID() })).status, 428);
  for (const malformed of [`W/${validMatch}`, `"run:${randomUUID()}:c${state.view.configRevision}:w${state.view.worldRevision}:s${state.view.structureRevision}:l${state.view.lifecycleRevision}"`, `"run:${state.view.runId}:c${state.view.configRevision}:w${state.view.worldRevision}:s${state.view.structureRevision}:l9007199254740992"`]) {
    assert.equal((await post({ key: randomUUID(), match: malformed })).status, 412);
  }
  assert.equal((await post({ key: randomUUID(), match: validMatch, body: { kind: 'pause', force: true } })).status, 422);
  assert.equal((await post({ key: randomUUID(), match: validMatch, body: { kind: 'pause', preflightJobId: randomUUID() } })).status, 422, 'preflightJobId is forbidden on pause');
  assert.equal((await post({ key: randomUUID(), match: validMatch, body: { kind: 'start' } })).status, 422, 'start requires a typed preflight job id');
  assert.equal((await post({ key: randomUUID(), match: validMatch, body: { kind: 'resume' } })).status, 422, 'resume requires a typed preflight job id');
  assert.equal((await post({ key: randomUUID(), match: validMatch, body: { kind: 'resume', preflightJobId: randomUUID(), caller: 'untrusted' } })).status, 422);
  assert.equal(state.controls.length, 0);
});

test('control pasa CAS y principal al puerto; replay, step y resultados de dominio tienen respuestas explícitas', async (t) => {
  const state = controlledLifecycle(); const host = await setup(t, state.port); const path = `/api/v1/runs/${state.view.runId}/controls`;
  const key = randomUUID(); const requestHeaders = { ...host.headers, 'Idempotency-Key': key, 'If-Match': etag(state.view) };
  const pause = await fetch(host.origin + path, { method: 'POST', headers: requestHeaders, body: JSON.stringify({ kind: 'pause' }) });
  assert.equal(pause.status, 200); assert.equal(pause.headers.get('etag'), etag(state.view));
  assert.equal(state.controls.length, 1);
  assert.deepEqual(state.controls[0], {
    principalId: 'local-operator', idempotencyKey: key, runId: state.view.runId,
    expectedConfigurationRevision: state.view.configRevision, expectedWorldRevision: state.view.worldRevision,
    expectedStructureRevision: state.view.structureRevision,
    expectedLifecycleRevision: state.view.lifecycleRevision, command: { kind: 'pause' },
  });

  state.setResult({ kind: 'updated', run: state.view, replayed: true });
  const replay = await fetch(host.origin + path, { method: 'POST', headers: requestHeaders, body: JSON.stringify({ kind: 'pause' }) });
  assert.equal(replay.status, 200); assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(RunViewSchema.parse(await replay.json()), state.view);

  const startBody = { kind: 'start', preflightJobId: randomUUID() };
  state.setResult({ kind: 'accepted', run: state.view, job: { jobId: randomUUID(), revision: 0, state: 'queued' }, replayed: false });
  const accepted = await fetch(host.origin + path, { method: 'POST', headers: { ...host.headers, 'Idempotency-Key': randomUUID(), 'If-Match': etag(state.view) }, body: JSON.stringify(startBody) });
  assert.equal(accepted.status, 202); assert.equal(accepted.headers.get('location'), `/api/v1/runs/${state.view.runId}`);
  const acceptedBody = RunControlReceiptSchema.parse(await accepted.json());
  assert.equal(acceptedBody.kind, 'run-control-receipt');
  const acceptedCommand = state.controls.at(-1)?.command;
  assert.equal(acceptedCommand?.kind, 'start');
  if (acceptedCommand?.kind === 'start') assert.equal(acceptedCommand.preflightJobId, startBody.preflightJobId);

  const paused = RunViewSchema.parse({ ...state.view, lifecycle: { kind: 'paused' }, lifecycleRevision: state.view.lifecycleRevision + 1 });
  state.setView(paused);
  state.setResult({ kind: 'stepUnavailable' });
  const stepUnavailable = await fetch(host.origin + path, { method: 'POST', headers: { ...host.headers, 'Idempotency-Key': randomUUID(), 'If-Match': etag(paused) }, body: JSON.stringify({ kind: 'step', preflightJobId: randomUUID() }) });
  assert.equal(stepUnavailable.status, 503);
  assert.equal((await stepUnavailable.json()).error.code, 'STEP_UNAVAILABLE');

  state.setResult({ kind: 'updated', run: paused, replayed: false });
  const falseStepSuccess = await fetch(host.origin + path, { method: 'POST', headers: { ...host.headers, 'Idempotency-Key': randomUUID(), 'If-Match': etag(paused) }, body: JSON.stringify({ kind: 'step', preflightJobId: randomUUID() }) });
  assert.equal(falseStepSuccess.status, 503, 'step cannot be claimed complete without an accepted bounded-pulse job');

  state.setResult({ kind: 'accepted', run: { ...paused, lifecycle: { kind: 'running' } }, job: { jobId: randomUUID(), revision: 0, state: 'queued' }, replayed: false });
  const stepAccepted = await fetch(host.origin + path, { method: 'POST', headers: { ...host.headers, 'Idempotency-Key': randomUUID(), 'If-Match': etag(paused) }, body: JSON.stringify({ kind: 'step', preflightJobId: randomUUID() }) });
  assert.equal(stepAccepted.status, 202);
});

test('lifecycle result mapping returns current ETag and never exposes host diagnostics', async (t) => {
  const state = controlledLifecycle(); const host = await setup(t, state.port); const path = `/api/v1/runs/${state.view.runId}/controls`;
  const send = async (result: unknown) => {
    state.setResult(result);
    return fetch(host.origin + path, { method: 'POST', headers: { ...host.headers, 'Idempotency-Key': randomUUID(), 'If-Match': etag(state.view) }, body: JSON.stringify({ kind: 'resume', preflightJobId: randomUUID() }) });
  };
  const newer = RunViewSchema.parse({ ...state.view, lifecycleRevision: state.view.lifecycleRevision + 1, lifecycle: { kind: 'paused' } });
  const stale = await send({ kind: 'stale', current: newer });
  assert.equal(stale.status, 412); assert.equal((await stale.json()).error.currentEtag, etag(newer));
  for (const [result, status, code] of [
    [{ kind: 'missing' }, 404, 'NOT_FOUND'],
    [{ kind: 'invalidLifecycle', lifecycle: 'closed' }, 409, 'INVALID_LIFECYCLE'],
    [{ kind: 'preflightRequired' }, 422, 'RUN_NOT_READY'],
    [{ kind: 'preflightBlocked' }, 422, 'RUN_NOT_READY'],
    [{ kind: 'preflightStale', current: newer }, 412, 'PRECONDITION_FAILED'],
    [{ kind: 'budgetExhausted' }, 429, 'BUDGET_EXHAUSTED'],
    [{ kind: 'idempotencyConflict' }, 409, 'IDEMPOTENCY_KEY_REUSE'],
  ] as const) {
    const response = await send(result);
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
  const otherRunId = randomUUID();
  const otherRun = RunViewSchema.parse({ ...newer, runId: otherRunId, config: { ...newer.config, runId: otherRunId } });
  const wrongScope = await send({ kind: 'stale', current: otherRun });
  assert.equal(wrongScope.status, 500);
  assert.doesNotMatch(await wrongScope.text(), /PRIVATE|unexpected|runId/);
});


test('dedicated lifecycle routes share controls validation and reject mismatched commands', async (t) => {
  const state = controlledLifecycle(); const host = await setup(t, state.port);
  const post = (route: string, command: unknown) => fetch(`${host.origin}/api/v1/runs/${state.view.runId}/${route}`, { method: 'POST', headers: { ...host.headers, 'Idempotency-Key': randomUUID(), 'If-Match': etag(state.view) }, body: JSON.stringify(command) });
  const preflightJobId = randomUUID();
  assert.equal((await post('start', { kind: 'start', preflightJobId })).status, 200);
  assert.deepEqual(state.controls[0]?.command, { kind: 'start', preflightJobId });
  assert.equal((await post('start', { kind: 'pause' })).status, 422);
  assert.equal(state.controls.length, 1);
  for (const kind of ['pause', 'stop', 'close']) assert.equal((await post(kind, { kind })).status, 200);
  assert.equal((await post('resume', { kind: 'resume', preflightJobId })).status, 200);
});

test('durable step job read is authenticated, scope checked and revision tagged', async (t) => {
  const state = controlledLifecycle(); const jobId = randomUUID();
  const job = { jobId, runId: state.view.runId, pulseId: null, state: 'queued', revision: 0, lifecycleRevision: 4, createdAt: Date.now(), updatedAt: Date.now() };
  const host = await setup(t, { ...state.port, readStepJob: ({ runId, jobId: requested }) => runId === job.runId && requested === job.jobId ? job : undefined });
  const path = `${host.origin}/api/v1/runs/${job.runId}/steps/${jobId}`;
  const response = await fetch(path, { headers: host.headers });
  assert.equal(response.status, 200); assert.equal(response.headers.get('etag'), `"run-step:${jobId}:r0"`);
  assert.deepEqual(await response.json(), job);
  assert.equal((await fetch(path, { headers: { Origin: host.origin, 'Sec-Fetch-Site': 'same-origin' } })).status, 401);
  assert.equal((await fetch(`${host.origin}/api/v1/runs/${job.runId}/steps/${randomUUID()}`, { headers: host.headers })).status, 404);
  const invalid = await setup(t, { ...state.port, readStepJob: () => ({ ...job, runId: randomUUID() }) });
  const denied = await fetch(`${invalid.origin}/api/v1/runs/${job.runId}/steps/${jobId}`, { headers: invalid.headers });
  assert.equal(denied.status, 500); assert.doesNotMatch(await denied.text(), /pulseId|lifecycleRevision/);
});

test('replay de step ya terminado conserva receipt accepted con corrida pausada y job terminal',async(t)=>{
  const state=controlledLifecycle();const host=await setup(t,state.port);
  const paused=RunViewSchema.parse({...state.view,lifecycle:{kind:'paused'}});
  const jobId=randomUUID();
  state.setResult({kind:'accepted',run:paused,job:{jobId,revision:3,state:'succeeded'},replayed:true});
  const response=await fetch(`${host.origin}/api/v1/runs/${paused.runId}/step`,{method:'POST',headers:{...host.headers,
    'Idempotency-Key':randomUUID(),'If-Match':etag(paused)},body:JSON.stringify({kind:'step',preflightJobId:randomUUID()})});
  assert.equal(response.status,202);assert.equal(response.headers.get('idempotency-replayed'),'true');
  const receipt=RunControlReceiptSchema.parse(await response.json());
  assert.equal(receipt.run.lifecycle.kind,'paused');assert.equal(receipt.job.jobId,jobId);assert.equal(receipt.job.state,'succeeded');
});
