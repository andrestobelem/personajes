import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { openJournal } from '../src/adapters/journal.ts';
import { CatalogReferenceTargetSchema } from '../src/domain/catalog-links.ts';
import {
  ApiProblemSchema, RunConfigurationDraftMutationReceiptSchema, RunConfigurationValidationReceiptSchema,
  RunConfigurationDraftViewSchema, SessionCreatedSchema, SessionViewSchema,
} from '../src/domain/http.ts';
import { resolveHumanIntervention } from '../src/domain/human-intervention.ts';
import { projectHumanInteractionContext } from '../src/domain/interaction.ts';
import { createEmptyRunConfigurationDraft } from '../src/domain/production.ts';
import { createIcmWorkspaceSnapshot, hashIcmMarkdown, type IcmWorkspaceAudience } from '../src/domain/icm-workspace.ts';
import { WorldSnapshotSchema } from '../src/domain/world.ts';
import { HumanInterventionCommitSchema } from '../src/domain/world-journal.ts';
import { draftFixture } from './fixtures/continuista.ts';
import {
  createLocalHttpServer, DurableApiOperationLookupSchema,
  DurableApiOperationRequestSchema, type LocalHttpOptions, type LocalHttpServer,
} from '../src/server/http.ts';

const repositoryRoot = process.cwd();
const shell = '<!doctype html><html><head><script type="module" src="/assets/app-abc123.js"></script></head><body><div id="root"></div></body></html>';

type ResponseData = {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
};

async function rawRequest(input: {
  readonly origin: string;
  readonly path: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}): Promise<ResponseData> {
  const url = new URL(input.origin);
  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      host: url.hostname,
      port: Number(url.port),
      method: input.method ?? 'GET',
      path: input.path,
      headers: input.headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: unknown) => {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
        else if (typeof chunk === 'string') chunks.push(Buffer.from(chunk));
      });
      response.on('error', reject);
      response.on('end', () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value === undefined) continue;
          if (typeof value === 'string') headers.append(name, value);
          else for (const item of value) headers.append(name, item);
        }
        resolve({ status: response.statusCode ?? 0, headers, text: Buffer.concat(chunks).toString('utf8') });
      });
    });
    request.on('error', reject);
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
}

async function startServer(
  t: TestContext,
  hostOptions: Pick<LocalHttpOptions, 'resolveSessionMode' | 'authorizeObserverView' | 'readHumanInteractionContext' | 'commitHumanIntervention' | 'runConfigurationDrafts'> = {},
) {
  const catalog = await loadCatalog({ repositoryRoot });
  const server: LocalHttpServer = createLocalHttpServer({
    catalog,
    shellHtml: shell,
    ...hostOptions,
    staticAssets: new Map([
      ['/assets/app-abc123.js', { bytes: Buffer.from('globalThis.appLoaded=true;', 'utf8'), mimeType: 'text/javascript' }],
      ['/assets/app-def456.css', { bytes: Buffer.from('body{color:#111}', 'utf8'), mimeType: 'text/css' }],
    ]),
  });
  const address = await server.listen(0);
  t.after(async () => server.close());
  return { ...address, server };
}

function interventionWorld() {
  const runId = '00000000-0000-4000-8000-000000000101';
  const sceneId = '00000000-0000-4000-8000-000000000102';
  const channelId = '00000000-0000-4000-8000-000000000103';
  const characterId = 'maxwell-smart';
  const profile = {
    identity: {
      participantId: 'interlocutor-andres', displayName: 'Andrés',
      identityMarkdown: 'Identidad ficticia propia.', lifeStoryMarkdown: 'Historia de vida ficticia.',
    },
    presence: { kind: 'inScene' as const, sceneId, placeId: 'sala', position: { x: 0, y: 0 }, channelId },
  };
  const snapshot = WorldSnapshotSchema.parse({
    schemaVersion: 1, runId, revision: 0, seq: 0,
    clock: { instant: 0, convention: { kind: 'fixedOffset', offsetMinutes: -180, label: 'Buenos Aires' } },
    places: [{ id: 'sala', name: 'Sala de control', description: 'Una sala.', width: 10, height: 10, lighting: 'normal' }],
    doors: [], connections: [], perceptualPaths: [],
    channels: [{ kind: 'speech', id: channelId, label: 'Voz cercana', enabled: true, maxRange: 5, scope: 'addressed', placeIds: ['sala'] }],
    entities: [{
      kind: 'character', entityId: '00000000-0000-4000-8000-000000000104', characterId,
      trueDisplayName: 'Maxwell Smart', species: 'human', presentation: { kind: 'ordinary', label: 'Maxwell Smart' },
      placeId: 'sala', position: { x: 1, y: 1 }, collisionRadius: 0.25, blocksMovement: false,
      presence: { kind: 'present', sceneId }, preparation: { kind: 'prepared', continuityId: 'continuidad', identityVersion: 1 },
      capabilities: ['observe', 'speak', 'wait'], availability: { kind: 'available' }, routine: { kind: 'always' },
      mind: { goals: [], beliefs: [], relationships: [], recognizedCharacterIds: [], experiences: [] },
    }],
    inventory: [],
    scenes: [{ id: sceneId, label: 'La sala', lifecycle: { kind: 'open', startedAt: 0 }, participantIds: [characterId], placeIds: ['sala'] }],
    activeSceneId: sceneId, offers: [],
    actionDurations: { observeMs: 25, speechMs: 200, gestureMs: 100, takeMs: 100, offerMs: 100,
      acceptOfferMs: 100, maxWaitMs: 5_000, maxRestMs: 10_000, offerValidityMs: 5_000, interactionRange: 2 },
  });
  return { runId, sceneId, channelId, characterId, profile, snapshot };
}

function sameOriginHeaders(origin: string): Record<string, string> {
  return { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
}

function problemCode(value: unknown): string {
  return ApiProblemSchema.parse(value).error.code;
}

async function createSession(origin: string): Promise<{ cookie: string; csrfToken: string; etag: string }> {
  const pageResponse = await fetch(origin + '/', { headers: sameOriginHeaders(origin) });
  assert.equal(pageResponse.status, 200);
  const html = await pageResponse.text();
  const nonce = html.match(/<meta name="personajes-bootstrap" content="([A-Za-z0-9_-]{43})">/)?.[1];
  assert.ok(nonce);
  const response = await fetch(origin + '/api/v1/session', {
    method: 'POST',
    headers: { ...sameOriginHeaders(origin), 'Content-Type': 'application/json' },
    body: JSON.stringify({ bootNonce: nonce }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const created = SessionCreatedSchema.parse(await response.json());
  const cookieHeader = response.headers.get('set-cookie');
  assert.ok(cookieHeader);
  const cookie = cookieHeader.split(';', 1)[0];
  if (cookie === undefined || !cookie.startsWith(`personajes_session_${new URL(origin).port}=`)) throw new Error('session cookie omitted');
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Strict/);
  assert.match(cookieHeader, /Path=\/api\/v1/);
  assert.equal(/Max-Age=/i.test(cookieHeader), false);
  const etag = response.headers.get('etag');
  assert.ok(etag);
  return { cookie, csrfToken: created.csrfToken, etag };
}

function securePrivateHeaders(origin: string, cookie: string): Record<string, string> {
  return { ...sameOriginHeaders(origin), Cookie: cookie };
}

function containsKeyDeep(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => containsKeyDeep(item, key));
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(([candidate, child]) => candidate === key || containsKeyDeep(child, key));
}

test('HTTP local empieza con nonce de un uso y rechaza replay del bootstrap', async (t) => {
  const { origin } = await startServer(t);
  const headers = sameOriginHeaders(origin);
  const first = await fetch(origin + '/', { headers });
  const second = await fetch(origin + '/', { headers });
  const htmlA = await first.text();
  const htmlB = await second.text();
  const nonceA = htmlA.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]{43})"/)?.[1];
  const nonceB = htmlB.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]{43})"/)?.[1];
  assert.ok(nonceA);
  assert.ok(nonceB);
  assert.notEqual(nonceA, nonceB);

  const request = () => fetch(origin + '/api/v1/session', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bootNonce: nonceA }),
  });
  assert.equal((await request()).status, 200);
  const replay = await request();
  assert.equal(replay.status, 401);
  assert.equal(problemCode(await replay.json()), 'BOOTSTRAP_INVALID');
});

test('HTTP loopback bloquea Host, Origin, Sec-Fetch cross-site y mutaciones sin Origin canónico', async (t) => {
  const { origin } = await startServer(t);
  const badHost = await rawRequest({ origin, path: '/', headers: { Host: '127.0.0.1:1' } });
  assert.equal(badHost.status, 403);
  assert.equal(problemCode(JSON.parse(badHost.text)), 'HOST_DENIED');

  const badOrigin = await rawRequest({ origin, path: '/', headers: { Origin: 'http://attacker.example' } });
  assert.equal(badOrigin.status, 403);
  assert.equal(problemCode(JSON.parse(badOrigin.text)), 'ORIGIN_DENIED');

  const crossSite = await rawRequest({ origin, path: '/', headers: { Origin: origin, 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(crossSite.status, 403);
  assert.equal(problemCode(JSON.parse(crossSite.text)), 'ORIGIN_DENIED');

  const missingOrigin = await rawRequest({
    origin, path: '/api/v1/session', method: 'POST',
    headers: { Host: new URL(origin).host, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bootNonce: 'A'.repeat(43) }),
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal(problemCode(JSON.parse(missingOrigin.text)), 'ORIGIN_DENIED');
});

test('HTTP no admite lecturas privadas sin cookie ni escrituras sin CSRF', async (t) => {
  const { origin } = await startServer(t);
  const noCookie = await fetch(origin + '/api/v1/catalog', { headers: sameOriginHeaders(origin) });
  assert.equal(noCookie.status, 401);
  assert.equal(problemCode(await noCookie.json()), 'SESSION_REQUIRED');

  const { cookie, etag } = await createSession(origin);
  const noCsrf = await fetch(origin + '/api/v1/session/mode', {
    method: 'PUT',
    headers: { ...securePrivateHeaders(origin, cookie), 'Content-Type': 'application/json', 'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0001', 'If-Match': etag },
    body: JSON.stringify({ kind: 'observer' }),
  });
  assert.equal(noCsrf.status, 403);
  assert.equal(problemCode(await noCsrf.json()), 'CSRF_INVALID');
});

test('HTTP crea, lista, edita y valida borradores con SQLite durable y operador local', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-http-drafts-'));
  const journalPath = join(directory, 'journal.sqlite');
  let journal = openJournal({ path: journalPath });
  t.after(() => {
    journal.close();
    rmSync(directory, { recursive: true, force: true });
  });

  let { origin, server } = await startServer(t, { runConfigurationDrafts: journal });
  const session = await createSession(origin);
  const clientRunId = '00000000-0000-4000-8000-000000000501';
  const configuration = createEmptyRunConfigurationDraft({ runId: clientRunId, revision: 0 });
  const createPath = '/api/v1/runs';
  const createKey = '6dbd18b8-7056-4db2-8a74-890d1a0d0501';
  const createHeaders = {
    ...securePrivateHeaders(origin, session.cookie), 'Content-Type': 'application/json',
    'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': createKey, 'If-None-Match': '*',
  };
  const createBody = JSON.stringify({ configuration });
  const noCsrfCreate = await fetch(origin + createPath, {
    method: 'POST',
    headers: { ...createHeaders, 'X-CSRF-Token': 'wrong' },
    body: createBody,
  });
  assert.equal(noCsrfCreate.status, 403);
  assert.equal(problemCode(await noCsrfCreate.json()), 'CSRF_INVALID');
  const noCreatePrecondition = await fetch(origin + createPath, {
    method: 'POST',
    headers: { ...createHeaders, 'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0510', 'If-None-Match': '' },
    body: createBody,
  });
  assert.equal(noCreatePrecondition.status, 412);
  const created = await fetch(origin + createPath, { method: 'POST', headers: createHeaders, body: createBody });
  assert.equal(created.status, 201, await created.clone().text());
  const createReceipt = RunConfigurationDraftMutationReceiptSchema.parse(await created.json());
  const runId = createReceipt.configuration.runId;
  assert.notEqual(runId, clientRunId, 'the host owns the durable RunId');
  assert.equal(createReceipt.configuration.revision, 0);
  const createdViewResponse = await fetch(origin + `/api/v1/runs/${runId}/configuration`, { headers: securePrivateHeaders(origin, session.cookie) });
  assert.equal(createdViewResponse.status, 200);
  const createdView = await createdViewResponse.json() as {
    kind: string; configuration: { runId: string; revision: number; name: { kind: string } };
    state: { lifecycle: string }; validation: { kind: string; promotion: string };
  };
  assert.equal(createdView.kind, 'run-configuration-draft');
  assert.equal(createdView.configuration.revision, 0);
  assert.equal(createdView.validation.kind, 'incomplete');
  assert.equal(createdView.validation.promotion, 'not-promoted');
  assert.equal(createdView.state.lifecycle, 'draft');
  const etag0 = `"run-config:${runId}:c0"`;
  assert.equal(created.headers.get('etag'), etag0);
  assert.equal(created.headers.get('location'), `/api/v1/runs/${runId}`);

  const listResponse = await fetch(origin + '/api/v1/runs?limit=10', { headers: securePrivateHeaders(origin, session.cookie) });
  assert.equal(listResponse.status, 200, await listResponse.clone().text());
  const listing = await listResponse.json() as { items: Array<{ kind: string; runId: string; name: string | null; validation: { kind: string }; configuration?: unknown }> };
  assert.deepEqual(listing.items.map((item) => item.runId), [runId]);
  assert.equal(listing.items[0]?.kind, 'run-configuration-draft-summary');
  assert.equal(listing.items[0]?.name, null);
  assert.equal(listing.items[0]?.configuration, undefined, 'the list contains no prepared character snapshots');
  const detailResponse = await fetch(origin + `/api/v1/runs/${runId}/configuration`, { headers: securePrivateHeaders(origin, session.cookie) });
  assert.equal(detailResponse.status, 200);
  assert.equal(detailResponse.headers.get('etag'), etag0);
  const detailView = await detailResponse.json() as { state: { lifecycle: string }; validation: { kind: string; promotion: string } };
  assert.equal(detailView.validation.kind, 'incomplete');
  assert.equal(detailView.validation.promotion, 'not-promoted');
  assert.equal(detailView.state.lifecycle, 'draft');

  const edited = {
    ...createdView.configuration,
    name: { kind: 'configured', value: 'Puesta de prueba', evidence: { kind: 'integrator-default', decisionRef: 'client-cannot-choose-authority' } },
  };
  const editPath = `/api/v1/runs/${runId}/configuration`;
  const editKey = '6dbd18b8-7056-4db2-8a74-890d1a0d0502';
  const editHeaders = {
    ...securePrivateHeaders(origin, session.cookie), 'Content-Type': 'application/json',
    'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': editKey, 'If-Match': etag0,
  };
  const editBody = JSON.stringify({ configuration: edited });
  const stored = await fetch(origin + editPath, { method: 'PUT', headers: editHeaders, body: editBody });
  assert.equal(stored.status, 200, await stored.clone().text());
  const storedReceipt = RunConfigurationDraftMutationReceiptSchema.parse(await stored.json());
  assert.equal(storedReceipt.configuration.revision, 1);
  assert.equal(storedReceipt.configuration.name.kind, 'configured');
  if (storedReceipt.configuration.name.kind === 'configured') {
    assert.equal(storedReceipt.configuration.name.evidence.kind, 'operator-choice');
    if (storedReceipt.configuration.name.evidence.kind === 'operator-choice') assert.equal(storedReceipt.configuration.name.evidence.operatorId, 'local-operator');
  }
  const etag1 = `"run-config:${runId}:c1"`;
  assert.equal(stored.headers.get('etag'), etag1);

  const replay = await fetch(origin + editPath, { method: 'PUT', headers: editHeaders, body: editBody });
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
  assert.equal(replay.headers.get('etag'), etag1);
  assert.deepEqual(await replay.json(), storedReceipt);

  const crossOperationReuse = await fetch(origin + editPath, {
    method: 'PUT',
    headers: { ...editHeaders, 'Idempotency-Key': createKey },
    body: editBody,
  });
  assert.equal(crossOperationReuse.status, 409);
  assert.equal(problemCode(await crossOperationReuse.json()), 'IDEMPOTENCY_KEY_REUSE');

  const staleBody = JSON.stringify({ configuration: edited });
  const stale = await fetch(origin + editPath, {
    method: 'PUT',
    headers: { ...editHeaders, 'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0503' },
    body: staleBody,
  });
  assert.equal(stale.status, 412);
  const staleProblem = ApiProblemSchema.parse(await stale.json()).error;
  assert.equal(staleProblem.kind, 'precondition');
  if (staleProblem.kind === 'precondition') assert.equal(staleProblem.currentEtag, etag1);

  const editedAgain = {
    ...storedReceipt.configuration,
    name: { kind: 'configured', value: 'Puesta de prueba, segunda edición', evidence: { kind: 'integrator-default', decisionRef: 'second-edit' } },
  };
  const editKey2 = '6dbd18b8-7056-4db2-8a74-890d1a0d0506';
  const editBody2 = JSON.stringify({ configuration: editedAgain });
  const stored2 = await fetch(origin + editPath, {
    method: 'PUT',
    headers: { ...editHeaders, 'Idempotency-Key': editKey2, 'If-Match': etag1 },
    body: editBody2,
  });
  assert.equal(stored2.status, 200, await stored2.clone().text());
  const storedReceipt2 = RunConfigurationDraftMutationReceiptSchema.parse(await stored2.json());
  assert.equal(storedReceipt2.configuration.revision, 2);
  const etag2 = `"run-config:${runId}:c2"`;
  assert.equal(stored2.headers.get('etag'), etag2);
  const currentAfterEdits = RunConfigurationDraftViewSchema.parse(await (await fetch(origin + `/api/v1/runs/${runId}/configuration`, { headers: securePrivateHeaders(origin, session.cookie) })).json());
  assert.equal(currentAfterEdits.configuration.revision, 2);
  assert.equal(currentAfterEdits.state.lifecycle, 'draft');

  const replayCreateAfterEdits = await fetch(origin + createPath, { method: 'POST', headers: createHeaders, body: createBody });
  assert.equal(replayCreateAfterEdits.status, 201);
  assert.equal(replayCreateAfterEdits.headers.get('etag'), etag0);
  assert.equal(replayCreateAfterEdits.headers.get('Idempotency-Replayed'), 'true');
  assert.deepEqual(await replayCreateAfterEdits.json(), createReceipt);
  const replayUpdateAfterEdit = await fetch(origin + editPath, { method: 'PUT', headers: editHeaders, body: editBody });
  assert.equal(replayUpdateAfterEdit.status, 200);
  assert.equal(replayUpdateAfterEdit.headers.get('etag'), etag1);
  assert.equal(replayUpdateAfterEdit.headers.get('Idempotency-Replayed'), 'true');
  assert.deepEqual(await replayUpdateAfterEdit.json(), storedReceipt);

  const validate = await fetch(origin + `/api/v1/runs/${runId}/validate`, {
    method: 'POST',
    headers: {
      ...securePrivateHeaders(origin, session.cookie), 'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0504', 'If-Match': etag2,
    },
    body: '{}',
  });
  assert.equal(validate.status, 200, await validate.clone().text());
  const validateReceipt = RunConfigurationValidationReceiptSchema.parse(await validate.json());
  assert.equal(validateReceipt.kind, 'incomplete');
  assert.equal(validateReceipt.promotion, 'not-promoted');
  assert.equal(validate.headers.get('etag'), etag2);
  const validationKeyCollision = await fetch(origin + `/api/v1/runs/${runId}/validate`, {
    method: 'POST',
    headers: {
      ...securePrivateHeaders(origin, session.cookie), 'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': createKey, 'If-Match': etag2,
    },
    body: '{}',
  });
  assert.equal(validationKeyCollision.status, 409);
  assert.equal(problemCode(await validationKeyCollision.json()), 'IDEMPOTENCY_KEY_REUSE');
  const replayValidation = await fetch(origin + `/api/v1/runs/${runId}/validate`, {
    method: 'POST',
    headers: {
      ...securePrivateHeaders(origin, session.cookie), 'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0504', 'If-Match': etag2,
    },
    body: '{}',
  });
  assert.equal(replayValidation.status, 200, await replayValidation.clone().text());
  assert.deepEqual(await replayValidation.json(), validateReceipt, 'the same durable validation operation returns its stored receipt');
  const currentView = await (await fetch(origin + `/api/v1/runs/${runId}`, { headers: securePrivateHeaders(origin, session.cookie) })).json() as { state: { lifecycle: string }; validation: { kind: string; promotion: string } };
  assert.equal(currentView.state.lifecycle, 'draft');
  assert.equal(currentView.validation.promotion, 'not-promoted');
  assert.equal(journal.loadWorld({ runId }), undefined, 'an incomplete validation does not register a WorldRun');

  const tooDeep = structuredClone(configuration) as typeof configuration & { worldSnapshot: unknown };
  let nested: Record<string, unknown> = {};
  const deepest = nested;
  for (let index = 0; index < 34; index += 1) {
    const child: Record<string, unknown> = {};
    nested.child = child;
    nested = child;
  }
  tooDeep.worldSnapshot = { kind: 'configured', value: deepest, evidence: { kind: 'integrator-default', decisionRef: 'test' } };
  const depthFailure = await fetch(origin + createPath, {
    method: 'POST',
    headers: { ...createHeaders, 'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0505' },
    body: JSON.stringify({ configuration: tooDeep }),
  });
  assert.equal(depthFailure.status, 422);
  assert.equal(problemCode(await depthFailure.json()), 'JSON_DEPTH_LIMIT');

  const secretCandidate = {
    ...configuration,
    worldSnapshot: { kind: 'configured', value: { apiKey: 'synthetic-secret' }, evidence: { kind: 'integrator-default', decisionRef: 'test' } },
  };
  const secretFailure = await fetch(origin + createPath, {
    method: 'POST',
    headers: { ...createHeaders, 'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0511' },
    body: JSON.stringify({ configuration: secretCandidate }),
  });
  assert.equal(secretFailure.status, 422);
  const secretError = await secretFailure.text();
  assert.equal(secretError.includes('synthetic-secret'), false);

  await server.close();
  journal.close();
  journal = openJournal({ path: journalPath });
  ({ origin, server } = await startServer(t, { runConfigurationDrafts: journal }));
  const restartedSession = await createSession(origin);
  const replayCreate = await fetch(origin + createPath, {
    method: 'POST',
    headers: {
      ...securePrivateHeaders(origin, restartedSession.cookie), 'Content-Type': 'application/json',
      'X-CSRF-Token': restartedSession.csrfToken, 'Idempotency-Key': createKey, 'If-None-Match': '*',
    },
    body: createBody,
  });
  assert.equal(replayCreate.status, 201, await replayCreate.clone().text());
  assert.equal(replayCreate.headers.get('Idempotency-Replayed'), 'true');
  assert.deepEqual(await replayCreate.json(), createReceipt);
  assert.equal(replayCreate.headers.get('etag'), etag0);
  const replayUpdateAfterRestart = await fetch(origin + editPath, {
    method: 'PUT',
    headers: { ...securePrivateHeaders(origin, restartedSession.cookie), 'Content-Type': 'application/json', 'X-CSRF-Token': restartedSession.csrfToken, 'Idempotency-Key': editKey, 'If-Match': etag0 },
    body: editBody,
  });
  assert.equal(replayUpdateAfterRestart.status, 200);
  assert.deepEqual(await replayUpdateAfterRestart.json(), storedReceipt);
  assert.equal(replayUpdateAfterRestart.headers.get('etag'), etag1);
  const replayValidationAfterRestart = await fetch(origin + `/api/v1/runs/${runId}/validate`, {
    method: 'POST',
    headers: {
      ...securePrivateHeaders(origin, restartedSession.cookie), 'Content-Type': 'application/json',
      'X-CSRF-Token': restartedSession.csrfToken, 'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0504', 'If-Match': etag2,
    },
    body: '{}',
  });
  assert.equal(replayValidationAfterRestart.status, 200, await replayValidationAfterRestart.clone().text());
  assert.deepEqual(await replayValidationAfterRestart.json(), validateReceipt, 'the stable host operator can replay validation after a server restart');
});

test('HTTP promueve atómicamente una configuración válida y devuelve un receipt durable', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-http-promotion-'));
  const journal = openJournal({ path: join(directory, 'journal.sqlite') });
  t.after(() => { journal.close(); rmSync(directory, { recursive: true, force: true }); });
  const { origin } = await startServer(t, { runConfigurationDrafts: journal });
  const session = await createSession(origin);
  const clientRunId = '00000000-0000-4000-8000-000000000502';
  const candidate = draftFixture();
  assert.equal(candidate.roster.kind, 'configured');
  const activeActor = candidate.roster.value.activeCharacterIds[0]; assert.ok(activeActor);
  const audiences: IcmWorkspaceAudience[] = [
    { role: 'actor', actorId: activeActor },
    { role: 'continuista' }, { role: 'director' }, { role: 'configurator' },
  ];
  const workspace = createIcmWorkspaceSnapshot({ sources: audiences.map((audience, index) => ({
    sourceId: `test.promotion.${index}`, audience, revision: 0, sourceHash: hashIcmMarkdown('Contrato de prueba.'),
    sections: [{ sectionId: 'process', markdown: 'Contrato de prueba.' }],
  })) });
  // This HTTP promotion test supplies a controlled source authority. Real
  // filesystem admission is exercised by icm-workspace-save-http.test.ts.
  journal.setPreparationSourceAdmission(({ candidate: admitted }) => {
    assert.equal(admitted.icmWorkspace?.kind, 'configured');
    if (admitted.icmWorkspace?.kind === 'configured') assert.deepEqual(admitted.icmWorkspace.value, workspace);
  });
  const configuration = {
    ...candidate,
    icmWorkspace: { kind: 'configured', value: workspace,
      evidence: { kind: 'operator-choice', operatorId: 'http-test', recordedAt: '2026-10-15T12:00:00Z' } },
    runId: clientRunId,
    revision: 0,
    worldSnapshot: candidate.worldSnapshot.kind === 'configured'
      ? { ...candidate.worldSnapshot, value: { ...candidate.worldSnapshot.value, runId: clientRunId } }
      : candidate.worldSnapshot,
  };
  const created = await fetch(origin + '/api/v1/runs', {
    method: 'POST',
    headers: {
      ...securePrivateHeaders(origin, session.cookie), 'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0521', 'If-None-Match': '*',
    },
    body: JSON.stringify({ configuration }),
  });
  assert.equal(created.status, 201, await created.clone().text());
  const createReceipt = RunConfigurationDraftMutationReceiptSchema.parse(await created.json());
  const runId = createReceipt.configuration.runId;
  const createdView = await (await fetch(origin + `/api/v1/runs/${runId}/configuration`, { headers: securePrivateHeaders(origin, session.cookie) })).json() as { configuration: { runId: string; revision: number }; state: { lifecycle: string }; validation: { kind: string; promotion: string } };
  assert.notEqual(runId, clientRunId);
  assert.equal(createdView.validation.kind, 'valid');
  assert.equal(createdView.validation.promotion, 'not-promoted');
  assert.equal(createdView.state.lifecycle, 'draft');
  assert.equal(journal.loadWorld({ runId }), undefined);
  const etag = `"run-config:${runId}:c0"`;
  const validate = await fetch(origin + `/api/v1/runs/${runId}/validate`, {
    method: 'POST',
    headers: {
      ...securePrivateHeaders(origin, session.cookie), 'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0522', 'If-Match': etag,
    },
    body: '{}',
  });
  assert.equal(validate.status, 200, await validate.clone().text());
  const receipt = RunConfigurationValidationReceiptSchema.parse(await validate.json());
  assert.equal(receipt.kind, 'valid');
  assert.equal(receipt.runId, runId);
  assert.equal(receipt.revision, 0);
  assert.equal(receipt.promotion, 'promoted');
  assert.equal(validate.headers.get('etag'), etag);
  const replayCreateAfterPromotion = await fetch(origin + '/api/v1/runs', {
    method: 'POST',
    headers: {
      ...securePrivateHeaders(origin, session.cookie), 'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0521', 'If-None-Match': '*',
    },
    body: JSON.stringify({ configuration }),
  });
  assert.equal(replayCreateAfterPromotion.status, 201);
  assert.equal(replayCreateAfterPromotion.headers.get('etag'), etag);
  assert.equal(replayCreateAfterPromotion.headers.get('Idempotency-Replayed'), 'true');
  assert.deepEqual(await replayCreateAfterPromotion.json(), createReceipt);
  const promotedWorld = journal.loadWorld({ runId });
  assert.ok(promotedWorld);
  assert.equal(journal.readRunConfigurationDraftState({ runId })?.lifecycle, 'ready');
  const currentView = await (await fetch(origin + `/api/v1/runs/${runId}/configuration`, { headers: securePrivateHeaders(origin, session.cookie) })).json() as { state: { lifecycle: string }; validation: { kind: string; promotion: string } };
  assert.equal(currentView.state.lifecycle, 'ready');
  assert.equal(currentView.validation.kind, 'valid');
  assert.equal(currentView.validation.promotion, 'promoted');
});

test('HTTP trata __proto__, constructor y parámetros duplicados como entradas inválidas', async (t) => {
  const { origin } = await startServer(t);
  const { cookie } = await createSession(origin);
  const headers = securePrivateHeaders(origin, cookie);
  const maliciousQueries = [
    '/api/v1/catalog?__proto__=polluted',
    '/api/v1/catalog?__proto__=first&__proto__=second',
    '/api/v1/catalog?constructor=unexpected',
    '/api/v1/catalog?constructor=first&constructor=second',
    '/api/v1/catalog?limit=1&limit=2',
    '/api/v1/catalog?query=Maxwell&query=KAOS',
    '/api/v1/research?__proto__=polluted&limit=1',
  ];
  for (const path of maliciousQueries) {
    const response = await fetch(origin + path, { headers });
    assert.equal(response.status, 422, `${path}: ${await response.clone().text()}`);
    assert.equal(problemCode(await response.json()), 'VALIDATION_FAILED', path);
  }
  const probe: Record<string, unknown> = {};
  assert.equal(Object.getPrototypeOf(probe), Object.prototype);
  assert.equal(Object.hasOwn(probe, 'polluted'), false);
});

test('HTTP comparte modos permitidos y reintenta antes de validar un ETag ya obsoleto', async (t) => {
  const { origin } = await startServer(t);
  const { cookie, csrfToken, etag } = await createSession(origin);
  const headers = {
    ...securePrivateHeaders(origin, cookie),
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
    'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0002',
    'If-Match': etag,
  };
  const body = JSON.stringify({ kind: 'observer' });
  const first = await fetch(origin + '/api/v1/session/mode', { method: 'PUT', headers, body });
  assert.equal(first.status, 200, await first.clone().text());
  const firstBody = await first.text();
  assert.equal(first.headers.get('etag'), '"session:r1"');

  const replay = await fetch(origin + '/api/v1/session/mode', { method: 'PUT', headers, body });
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
  assert.equal(replay.headers.get('etag'), '"session:r1"');
  assert.equal(await replay.text(), firstBody);

  const reuse = await fetch(origin + '/api/v1/session/mode', {
    method: 'PUT', headers,
    body: JSON.stringify({ kind: 'interlocutor', runId: '00000000-0000-4000-8000-000000000010', participantId: 'player' }),
  });
  assert.equal(reuse.status, 409);
  assert.equal(problemCode(await reuse.json()), 'IDEMPOTENCY_KEY_REUSE');

  const authorityAttempt = await fetch(origin + '/api/v1/session/mode', {
    method: 'PUT',
    headers: { ...headers, 'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0003', 'If-Match': '"session:r1"' },
    body: JSON.stringify({ kind: 'director', runId: '00000000-0000-4000-8000-000000000010', scope: { kind: 'run' }, authority: 'director' }),
  });
  assert.equal(authorityAttempt.status, 422);

  const unavailableMode = await fetch(origin + '/api/v1/session/mode', {
    method: 'PUT',
    headers: { ...headers, 'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0004', 'If-Match': '"session:r1"' },
    body: JSON.stringify({ kind: 'interlocutor', runId: '00000000-0000-4000-8000-000000000010', participantId: 'player' }),
  });
  assert.equal(unavailableMode.status, 403);
  assert.equal(problemCode(await unavailableMode.json()), 'CAPABILITY_REQUIRED');
});

test('HTTP limita la intervención al interlocutor configurado y conserva reintentos del Escenario', async (t) => {
  const fixture = interventionWorld();
  let snapshot = fixture.snapshot;
  let stored: { fingerprint: string; result: unknown } | undefined;
  let committedAs: unknown;
  const nextId = (() => {
    let value = 200;
    return () => `00000000-0000-4000-8000-${String(++value).padStart(12, '0')}`;
  })();
  const { origin } = await startServer(t, {
    resolveSessionMode: (candidate) => candidate.kind === 'interlocutor' && candidate.runId === fixture.runId ? candidate : null,
    readHumanInteractionContext: ({ runId, participantId }) => runId === fixture.runId
      && participantId === fixture.profile.identity.participantId
      ? projectHumanInteractionContext({ snapshot, profile: fixture.profile }) ?? null
      : null,
    commitHumanIntervention: (input) => {
      const command = HumanInterventionCommitSchema.parse(input);
      committedAs = command;
      const fingerprint = JSON.stringify(command);
      if (stored !== undefined) return stored.fingerprint === fingerprint
        ? { ...stored.result as Record<string, unknown>, kind: 'existing' }
        : { kind: 'idempotencyConflict' };
      const resolution = resolveHumanIntervention({
        snapshot, profile: fixture.profile, request: command.request,
        interventionId: nextId(), expectedRevision: command.expectedRevision,
        ids: {
          eventId: nextId, perceptionId: nextId, experienceId: nextId, offerId: nextId,
          entityHandle: nextId, placeHandle: nextId, channelHandle: nextId, offerHandle: nextId,
        },
      });
      const result = { kind: 'stored', commitIndex: resolution.kind === 'applied' ? 1 : null, resolution };
      stored = { fingerprint, result };
      snapshot = resolution.newSnapshot;
      return result;
    },
  });
  const session = await createSession(origin);
  const mode = await fetch(origin + '/api/v1/session/mode', {
    method: 'PUT',
    headers: {
      ...securePrivateHeaders(origin, session.cookie), 'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrfToken, 'If-Match': session.etag,
      'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0010',
    },
    body: JSON.stringify({ kind: 'interlocutor', runId: fixture.runId, participantId: fixture.profile.identity.participantId }),
  });
  assert.equal(mode.status, 200, await mode.clone().text());
  const sessionView = SessionViewSchema.parse(await mode.json());
  assert.ok(sessionView.capabilities.includes('intervention.write'));

  const contextResponse = await fetch(origin + `/api/v1/runs/${fixture.runId}/intervention-context`, {
    headers: securePrivateHeaders(origin, session.cookie),
  });
  assert.equal(contextResponse.status, 200, await contextResponse.clone().text());
  assert.equal(contextResponse.headers.get('etag'), `"world:${fixture.runId}:r0"`);
  const context = await contextResponse.json() as { recipients: Array<{ characterId: string }> };
  assert.deepEqual(context.recipients.map((recipient) => recipient.characterId), [fixture.characterId]);
  assert.equal(contextResponse.headers.get('cache-control'), 'no-store');

  const intervention = {
    kind: 'speech', recipientCharacterIds: [fixture.characterId], channelId: fixture.channelId,
    content: { kind: 'speech', text: 'Max, ¿conoces Fibonacci?' },
  };
  const path = `/api/v1/runs/${fixture.runId}/interventions`;
  const headers = {
    ...securePrivateHeaders(origin, session.cookie), 'Content-Type': 'application/json',
    'X-CSRF-Token': session.csrfToken, 'If-Match': `"world:${fixture.runId}:r0"`,
    'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0011',
  };
  const noCsrf = await fetch(origin + path, {
    method: 'POST', headers: { ...headers, 'X-CSRF-Token': '' }, body: JSON.stringify(intervention),
  });
  assert.equal(noCsrf.status, 403);
  assert.equal(problemCode(await noCsrf.json()), 'CSRF_INVALID');

  const forged = await fetch(origin + path, {
    method: 'POST', headers,
    body: JSON.stringify({ ...intervention, participantId: 'another-person' }),
  });
  assert.equal(forged.status, 422);
  assert.equal(problemCode(await forged.json()), 'VALIDATION_FAILED');

  const first = await fetch(origin + path, { method: 'POST', headers, body: JSON.stringify(intervention) });
  assert.equal(first.status, 202, await first.clone().text());
  const accepted = await first.json() as { kind: string; effectiveAudience: string[]; worldRevision: number };
  assert.equal(accepted.kind, 'accepted');
  assert.deepEqual(accepted.effectiveAudience, [fixture.characterId]);
  assert.equal(accepted.worldRevision, 1);
  assert.deepEqual(committedAs && (committedAs as { participantId: string }).participantId, fixture.profile.identity.participantId);
  assert.equal(first.headers.get('etag'), `"world:${fixture.runId}:r1"`);

  const replay = await fetch(origin + path, { method: 'POST', headers, body: JSON.stringify(intervention) });
  assert.equal(replay.status, 202);
  assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
  assert.deepEqual(await replay.json(), accepted);

  const reuse = await fetch(origin + path, {
    method: 'POST', headers,
    body: JSON.stringify({ ...intervention, content: { kind: 'speech', text: 'Otro texto.' } }),
  });
  assert.equal(reuse.status, 409);
  assert.equal(problemCode(await reuse.json()), 'IDEMPOTENCY_KEY_REUSE');
});

test('HTTP inspector es opt-in por sesión y requiere autorización host del run', async (t) => {
  const runId = '00000000-0000-4000-8000-000000000010';
  const { origin } = await startServer(t, {
    authorizeObserverView: (candidateRun, mode) => candidateRun === runId && mode === 'internal',
  });
  const { cookie, csrfToken, etag } = await createSession(origin);
  const response = await fetch(origin + `/api/v1/runs/${runId}/observer-view`, {
    method: 'PUT',
    headers: {
      ...securePrivateHeaders(origin, cookie),
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      'If-Match': etag,
      'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0005',
    },
    body: JSON.stringify({ mode: 'internal', confirm: true }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { mode: 'internal', enabledForSession: true });

  const session = await fetch(origin + '/api/v1/session', { headers: securePrivateHeaders(origin, cookie) });
  const sessionView = SessionViewSchema.parse(await session.json());
  assert.ok(sessionView.capabilities.includes('inspector.read'));
});

test('HTTP privacy projections omiten rutas internas y solo exponen vistas allowlisted', async (t) => {
  const { origin } = await startServer(t);
  const { cookie } = await createSession(origin);
  const headers = securePrivateHeaders(origin, cookie);
  const paths = [
    '/api/v1/session', '/api/v1/catalog', '/api/v1/catalog/maxwell-smart',
    '/api/v1/library', '/api/v1/research', '/api/v1/avatars',
  ];
  for (const path of paths) {
    const response = await fetch(origin + path, { headers });
    assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
    const value: unknown = await response.json();
    assert.equal(containsKeyDeep(value, 'path'), false, path);
    assert.equal(JSON.stringify(value).includes(repositoryRoot), false, path);
  }
  const document = await fetch(origin + '/api/v1/library/get-smart-index', { headers });
  assert.equal(document.status, 200);
  assert.equal(containsKeyDeep(await document.json(), 'path'), false);

  const privateInspector = await fetch(origin + '/api/v1/runs/00000000-0000-4000-8000-000000000010/observer-view', { headers });
  assert.equal(privateInspector.status, 404);
});

test('HTTP resuelve referencias locales autenticadas solo contra el catálogo registrado', async (t) => {
  const { origin } = await startServer(t);
  const noSession = await fetch(origin + '/api/v1/references?sourceKind=character&sourceId=maxwell-smart&reference=siegfried.md');
  assert.equal(noSession.status, 401);
  assert.equal(problemCode(await noSession.json()), 'SESSION_REQUIRED');

  const { cookie } = await createSession(origin);
  const headers = securePrivateHeaders(origin, cookie);
  const reference = new URLSearchParams({
    sourceKind: 'character',
    sourceId: 'maxwell-smart',
    reference: 'siegfried.md#continuidad',
  });
  const resolved = await fetch(origin + '/api/v1/references?' + reference, { headers });
  assert.equal(resolved.status, 200, await resolved.clone().text());
  assert.deepEqual(await resolved.json(), { kind: 'character', id: 'siegfried', title: 'Siegfried' });

  const linkedDocument = new URLSearchParams({
    sourceKind: 'character',
    sourceId: 'maxwell-smart',
    reference: '../../investigaciones/elevenlabs-diseno-de-voces.md',
  });
  const document = await fetch(origin + '/api/v1/references?' + linkedDocument, { headers });
  assert.equal(document.status, 200, await document.clone().text());
  const documentTarget = CatalogReferenceTargetSchema.parse(await document.json());
  assert.equal(documentTarget.kind, 'document');
  assert.equal(JSON.stringify(documentTarget).includes(repositoryRoot), false);

  const traversal = new URLSearchParams({ sourceKind: 'character', sourceId: 'maxwell-smart', reference: '../../../.env' });
  const unavailable = await fetch(origin + '/api/v1/references?' + traversal, { headers });
  assert.equal(unavailable.status, 200);
  assert.deepEqual(await unavailable.json(), { kind: 'unavailable' });

  const invalid = await fetch(origin + '/api/v1/references?sourceKind=character&sourceId=maxwell-smart&reference=siegfried.md&unexpected=1', { headers });
  assert.equal(invalid.status, 422);
  assert.equal(problemCode(await invalid.json()), 'VALIDATION_FAILED');
});

test('HTTP registra assets de build por allowlist exacta y sirve MIME seguro sin sesión', async (t) => {
  const { origin } = await startServer(t);
  const script = await fetch(origin + '/assets/app-abc123.js');
  assert.equal(script.status, 200);
  assert.equal(script.headers.get('content-type'), 'text/javascript');
  assert.equal(script.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(script.headers.get('content-security-policy')?.includes("script-src 'self'"), true);
  assert.equal(await script.text(), 'globalThis.appLoaded=true;');

  const head = await fetch(origin + '/assets/app-def456.css', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'text/css');
  assert.equal(await head.text(), '');

  const arbitrary = await fetch(origin + '/assets/../../etc/passwd');
  assert.notEqual(arbitrary.status, 200);
  const unregistered = await fetch(origin + '/assets/other.js');
  assert.equal(unregistered.status, 404);
});

test('el puerto durable valida scope, hash y resultado sin guardar el body recibido', () => {
  const request = {
    principalId: 'local-operator',
    idempotencyKey: '6dbd18b8-7056-4db2-8a74-890d1a0d0006',
    method: 'POST',
    path: '/api/v1/runs/00000000-0000-4000-8000-000000000010/jobs',
    requestHash: 'a'.repeat(64),
  };
  assert.deepEqual(DurableApiOperationRequestSchema.parse(request), request);
  assert.throws(() => DurableApiOperationRequestSchema.parse({ ...request, rawBody: { prompt: 'private' } }));
  assert.throws(() => DurableApiOperationRequestSchema.parse({ ...request, path: '/api/v1/jobs?secret=value' }));
  assert.deepEqual(DurableApiOperationLookupSchema.parse({
    kind: 'found', request, response: { status: 202, body: { kind: 'job-accepted' }, headers: { Location: '/api/v1/jobs/job-id' } },
  }).kind, 'found');
});

test('HTTP rechaza editar o validar una preparación de fork publicada con conflicto explícito', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-http-fork-readonly-'));
  const journal = openJournal({ path: join(directory, 'journal.sqlite') });
  t.after(() => { journal.close(); rmSync(directory, { recursive: true, force: true }); });
  // El journal real verifica la guarda de autoridad; aquí se verifica su traducción HTTP.
  const { origin } = await startServer(t, { runConfigurationDrafts: {
    ...journal,
    updateRunConfigurationDraft: () => ({ kind: 'readonly', reason: 'fork-published' }),
    validateRunConfigurationDraft: () => ({ kind: 'readonly', reason: 'fork-published' }),
  } });
  const session = await createSession(origin);
  const runId = '00000000-0000-4000-8000-000000000503';
  const configuration = createEmptyRunConfigurationDraft({ runId, revision: 0 });
  for (const operation of [
    { method: 'PUT', path: 'configuration', body: { configuration } },
    { method: 'POST', path: 'validate', body: {} },
  ]) {
    const response = await fetch(`${origin}/api/v1/runs/${runId}/${operation.path}`, {
      method: operation.method,
      headers: {
        ...securePrivateHeaders(origin, session.cookie), 'Content-Type': 'application/json',
        'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': '6dbd18b8-7056-4db2-8a74-890d1a0d0599',
        'If-Match': `"run-config:${runId}:c0"`,
      },
      body: JSON.stringify(operation.body),
    });
    assert.equal(response.status, 409, await response.clone().text());
    assert.equal(problemCode(await response.json()), 'FORK_PREPARATION_READ_ONLY');
  }
});

test('HTTP sessions remain independent across loopback ports in a shared hostname cookie jar',async(t)=>{
 const first=await startServer(t);const second=await startServer(t);
 const firstSession=await createSession(first.origin);const secondSession=await createSession(second.origin);
 const jar=new Map<string,string>();
 function absorb(pair:string){const separator=pair.indexOf('=');assert.ok(separator>0);jar.set(pair.slice(0,separator),pair.slice(separator+1));}
 absorb(firstSession.cookie);absorb(secondSession.cookie);assert.equal(jar.size,2,'starting another local host must not replace the first cookie');
 const cookie=()=>[...jar].map(([name,value])=>`${name}=${value}`).join('; ');
 const read=(origin:string,provided=cookie())=>fetch(origin+'/api/v1/session',{headers:securePrivateHeaders(origin,provided)});
 assert.equal((await read(first.origin)).status,200);assert.equal((await read(second.origin)).status,200);
 assert.equal((await read(first.origin,secondSession.cookie)).status,401,'another port cookie cannot authorize this host');
 assert.equal((await read(second.origin,firstSession.cookie)).status,401);
 const firstValue=firstSession.cookie.slice(firstSession.cookie.indexOf('=')+1);
 assert.equal((await read(first.origin,`personajes_session=${firstValue}`)).status,401,'legacy cookies never grant authority');
 const wrongCsrf=await fetch(first.origin+'/api/v1/session',{method:'DELETE',headers:{...securePrivateHeaders(first.origin,cookie()),'X-CSRF-Token':secondSession.csrfToken}});assert.equal(wrongCsrf.status,403,'shared jar selects the correct host session');
 const logout=await fetch(first.origin+'/api/v1/session',{method:'DELETE',headers:{...securePrivateHeaders(first.origin,cookie()),'X-CSRF-Token':firstSession.csrfToken}});assert.equal(logout.status,204);
 const cleared=logout.headers.get('set-cookie');assert.ok(cleared);assert.ok(cleared.startsWith(`personajes_session_${new URL(first.origin).port}=;`));assert.match(cleared,/Max-Age=0/);
 const clearedName=cleared.slice(0,cleared.indexOf('='));jar.delete(clearedName);
 assert.equal((await read(first.origin)).status,401);assert.equal((await read(second.origin)).status,200,'logging out one port preserves the other session');
});

test('HTTP explica que una identidad promovida impide reemplazar o validar el borrador ordinario',async(t)=>{
 const directory=mkdtempSync(join(tmpdir(),'personajes-http-identity-readonly-'));const journal=openJournal({path:join(directory,'journal.sqlite')});t.after(()=>{journal.close();rmSync(directory,{recursive:true,force:true});});
 const {origin}=await startServer(t,{runConfigurationDrafts:{...journal,updateRunConfigurationDraft:()=>({kind:'readonly',reason:'identity-promoted'}),validateRunConfigurationDraft:()=>({kind:'readonly',reason:'identity-promoted'})}});const session=await createSession(origin);const runId='00000000-0000-4000-8000-000000000604';const configuration=createEmptyRunConfigurationDraft({runId,revision:0});
 for(const command of [{method:'PUT',path:'configuration',body:{configuration}},{method:'POST',path:'validate',body:{}}]){
  const response=await fetch(`${origin}/api/v1/runs/${runId}/${command.path}`,{method:command.method,headers:{...securePrivateHeaders(origin,session.cookie),'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'Idempotency-Key':'6dbd18b8-7056-4db2-8a74-890d1a0d0604','If-Match':`"run-config:${runId}:c0"`},body:JSON.stringify(command.body)});assert.equal(response.status,409);assert.equal(problemCode(await response.json()),'IDENTITY_PREPARATION_READ_ONLY');
 }
});
