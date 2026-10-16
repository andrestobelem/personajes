import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { readDossier } from '../src/adapters/catalog.ts';
import { PiRuntime } from '../src/adapters/pi.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { openDossierExchange } from '../src/application/dossier-exchange.ts';
import { createPreparationConfiguratorRuntime } from '../src/application/preparation-configurator-runtime.ts';
import { fingerprintInferenceProfile } from '../src/application/pi-access-check.ts';
import { createIcmWorkspaceReader } from '../src/adapters/icm-workspace.ts';
import { createIcmWorkspaceSnapshot } from '../src/domain/icm-workspace.ts';
import { sha256CanonicalJson, sha256Utf8 } from '../src/domain/canonical-json.ts';
import { DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { CharacterIdSchema } from '../src/domain/values.ts';
import { createProductionHost } from '../src/server/production-host.ts';
import { OperatorResponseSchema, type OperatorRequest } from '../src/server/operator-extension.ts';
import { PreparationConfiguratorPublicJobSchema, PreparationConfiguratorPublicReviewSchema, preparationConfiguratorJobEtag } from '../src/domain/preparation-configurator-http.ts';
import { PreparationConfiguratorJobSchema } from '../src/domain/preparation-configurator-jobs.ts';
import type { PreparationConfiguratorAdmissionHost } from '../src/application/preparation-configurator-admission.ts';
import { controlledPreparationConfiguratorSessionFactory, preparationConfiguratorSessionStats } from './fixtures/preparation-configurator-session.ts';
import { createPreparationConfiguratorRoutes } from '../src/server/preparation-configurator-routes.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { SessionCreatedSchema } from '../src/domain/http.ts';

const BUSY = 'PRODUCTION_RUNTIME_CONFIGURATION_BUSY';

test('production configurator routes stay inert until explicit start, enforce durable cancel, and gate runtime changes', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'personajes-preparation-configurator-production-'));
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  let sessionCreates = 0;
  const production = await createProductionHost({
    host: openLocalHost({ privateDataRoot: root }),
    catalog,
    admissionBarrier: createHostRequestBarrier(),
    preparationConfiguratorSessionFactory: async () => {
      ++sessionCreates;
      throw new Error('The production composition test must not create a provider session.');
    },
  });
  t.after(async () => {
    try { await production.close(); }
    finally { rmSync(root, { recursive: true, force: true }); rmSync(`${root}-auth`, { recursive: true, force: true }); }
  });

  const evidence = { kind: 'operator-choice' as const, operatorId: 'local-operator', recordedAt: '2026-10-16T12:00:00.000Z' };
  const workspaceReader = createIcmWorkspaceReader({ workspaceRoot: catalog.repositoryRoot });
  const workspace = workspaceReader.preview({ audience: { role: 'configurator' }, sourceIds: ['role.configurator'],
    sectionIdsBySource: { 'role.configurator': ['process', 'cierre'] } }).snapshot;
  const created = production.host.journal.createRunConfigurationDraft({ principalId: 'local-operator', idempotencyKey: randomUUID(), patch: {
    budget: { kind: 'configured', evidence, value: { maxPiCallsPerRun: 4, maxPiCallsPerPulse: 2, maxConcurrentPiRequests: 1, maxWallTimeMs: 30_000, requestTimeoutMs: 10_000 } },
    icmWorkspace: { kind: 'configured', evidence, value: workspace },
  } });
  assert.equal(created.kind, 'created');
  if (created.kind !== 'created') throw new Error('Synthetic draft was not created.');
  const draft = created.draft;

  const route = production.httpOptions.operatorExtensions?.find(extension => extension.name === 'preparation-configurator');
  assert.ok(route, 'production HTTP options include preparation-configurator routes');
  if (route === undefined) throw new Error('Production configurator routes are missing.');
  const handle = route.handle.bind(route);
  const observer = { kind: 'observer' } as const;
  async function call(request: OperatorRequest) {
    return OperatorResponseSchema.parse(await handle(request));
  }
  async function createJob() {
    const response = await call({ path: ['runs', draft.runId, 'preparation-configurator'], query: new URLSearchParams(),
      principalId: 'local-operator', mode: observer, ifMatch: null, ifNoneMatch: null, kind: 'write', method: 'POST', idempotencyKey: randomUUID(),
      body: { draftRevision: draft.revision, draftHash: sha256CanonicalJson(draft),
        instructions: 'Proponer conservando explícitamente los vacíos.', actorSources: [], documentIds: [] } });
    assert.equal(response.kind, 'json');
    if (response.kind !== 'json') throw new Error('Configurator creation failed.');
    return PreparationConfiguratorPublicJobSchema.parse(response.body);
  }

  const choices = await call({ path: ['runs', draft.runId, 'preparation-configurator', 'choices'], query: new URLSearchParams(),
    principalId: 'local-operator', mode: observer, ifMatch: null, ifNoneMatch: null, kind: 'read', method: 'GET' });
  assert.equal(choices.kind, 'json');
  const job = await createJob();
  assert.equal(job.state, 'queued');
  assert.equal(production.preparationConfigurator.manager.hasActive({ jobId: job.scope.jobId }), false);
  assert.equal(sessionCreates, 0);
  assert.equal(production.host.journal.loadWorld({ runId: draft.runId }), undefined, 'preparation does not create a WorldRun');

  await production.recover();
  assert.equal(production.preparationConfigurator.manager.hasActive({ jobId: job.scope.jobId }), false, 'recovery does not requeue preparation');
  assert.throws(() => production.assertRuntimeConfigurationIdle(), { message: BUSY }, 'durable queued preparation blocks runtime reconfiguration');

  const cancelled = await call({ path: ['preparation-configurator', job.scope.jobId], query: new URLSearchParams(),
    principalId: 'local-operator', mode: observer, ifMatch: preparationConfiguratorJobEtag(job), ifNoneMatch: null,
    kind: 'write', method: 'DELETE', idempotencyKey: randomUUID(), body: {} });
  assert.equal(cancelled.kind, 'json');
  if (cancelled.kind !== 'json') throw new Error('Queued job cancellation failed.');
  assert.equal(PreparationConfiguratorPublicJobSchema.parse(cancelled.body).state, 'cancelled');
  assert.doesNotThrow(() => production.assertRuntimeConfigurationIdle());

  const next = await createJob();
  const started = await call({ path: ['preparation-configurator', next.scope.jobId, 'start'], query: new URLSearchParams(),
    principalId: 'local-operator', mode: observer, ifMatch: preparationConfiguratorJobEtag(next), ifNoneMatch: null,
    kind: 'write', method: 'POST', idempotencyKey: randomUUID(), body: {} });
  assert.equal(started.kind, 'json');
  await production.preparationConfigurator.manager.waitForIdle();
  const final = production.host.journal.readPreparationConfiguratorJob({ principalId: 'local-operator', jobId: next.scope.jobId });
  assert.equal(final.job.state, 'blocked', 'missing OAuth/access receipt blocks without a Pi session');
  assert.equal(sessionCreates, 0);
  assert.equal(production.host.journal.loadWorld({ runId: draft.runId }), undefined);
});

test('accepted production-runtime review stays public in the application and HTTP route', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'personajes-preparation-configurator-review-production-')));
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  const host = openLocalHost({ privateDataRoot: root });
  const loadedDossiers = await Promise.all(catalog.manifest.characters.map(async entry => [
    entry.characterId,
    await readDossier({ catalog, characterId: entry.characterId }),
  ] as const));
  const dossiersById = new Map(loadedDossiers);
  const adaptations = openDossierExchange({
    journalPath: join(root, 'world.sqlite'),
    getDossier(characterId) {
      const dossier = dossiersById.get(CharacterIdSchema.parse(characterId));
      if (dossier === undefined) throw new Error('DOSSIER_NOT_FOUND');
      return dossier;
    },
  });
  const piRuntime = await PiRuntime.create({ privateDataRoot: root });
  const stats = preparationConfiguratorSessionStats();
  const profileFingerprint = fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE);
  const admission = {
    async readPiSdkStatus() { return { kind: 'ready', piCodingAgentVersion: '1.2.0', piAiVersion: '1.2.0', sessionFactoryAvailable: true }; },
    async readPiModelProfile() {
      return { kind: 'configured', profile: { ...DEFAULT_INFERENCE_PROFILE, fingerprint: profileFingerprint } };
    },
    async readInferenceAuthenticationStatus() {
      return { kind: 'authenticated', provider: DEFAULT_INFERENCE_PROFILE.provider, method: 'oauth', accountFingerprint: 'a'.repeat(64) };
    },
    async readInferenceAccessCheckReceipt() {
      return {
        kind: 'passed', provider: DEFAULT_INFERENCE_PROFILE.provider, accountFingerprint: 'a'.repeat(64), profileFingerprint,
        checkedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    },
  } satisfies PreparationConfiguratorAdmissionHost;
  host.journal.setPreparationSourceAdmission(() => undefined);
  const workspace = createIcmWorkspaceSnapshot({ sources: [
    { sourceId: 'role.configurator', audience: { role: 'configurator' }, revision: 0, sourceHash: sha256Utf8('configurator-source'), sections: [{ sectionId: 'process', markdown: 'CONFIGURATOR_PRIVATE_REVIEW_SENTINEL' }] },
    { sourceId: 'role.director', audience: { role: 'director' }, revision: 0, sourceHash: sha256Utf8('director-source'), sections: [{ sectionId: 'process', markdown: 'DIRECTOR_PRIVATE_REVIEW_SENTINEL' }] },
  ] });
  const evidence = { kind: 'operator-choice' as const, operatorId: 'local-operator', recordedAt: '2026-10-16T12:00:00.000Z' };
  const draftResult = host.journal.createRunConfigurationDraft({ principalId: 'local-operator', idempotencyKey: randomUUID(), patch: {
    budget: { kind: 'configured', evidence, value: { maxPiCallsPerRun: 4, maxPiCallsPerPulse: 2, maxConcurrentPiRequests: 1, maxWallTimeMs: 30_000, requestTimeoutMs: 10_000 } },
    icmWorkspace: { kind: 'configured', evidence, value: workspace },
  } });
  assert.equal(draftResult.kind, 'created');
  if (draftResult.kind !== 'created') throw new Error('Synthetic draft was not created.');

  let configurator: Awaited<ReturnType<typeof createPreparationConfiguratorRuntime>> | undefined;
  let server: ReturnType<typeof createLocalHttpServer> | undefined;
  try {
    configurator = await createPreparationConfiguratorRuntime({
      host, catalog, adaptations, runtime: piRuntime, admission,
      sessionFactory: controlledPreparationConfiguratorSessionFactory({ root, stats, proposeName: 'Nombre sugerido para una puesta' }),
    });
    const authority = { principalId: 'local-operator', mode: { kind: 'observer' as const } };
    const draft = draftResult.draft;
    const queued = PreparationConfiguratorJobSchema.parse(configurator.application.create({
      runId: draft.runId,
      jobId: randomUUID(),
      authority,
      idempotencyKey: randomUUID(),
      body: {
        draftRevision: draft.revision,
        draftHash: sha256CanonicalJson(draft),
        instructions: 'Proponer una puesta y conservar los vacíos.',
        actorSources: [],
        documentIds: [],
      },
    }));
    const started = PreparationConfiguratorJobSchema.parse(await configurator.application.start({
      jobId: queued.scope.jobId, authority, expectedRevision: queued.revision, idempotencyKey: randomUUID(),
    }));
    assert.ok(['queued', 'running', 'accepted'].includes(started.state));
    await configurator.manager.waitForIdle();

    const stored = host.journal.readPreparationConfiguratorJob({ principalId: 'local-operator', jobId: queued.scope.jobId });
    assert.equal(stored.job.state, 'accepted');
    assert.equal(stats.requests, 2, 'the controlled SDK completes proposal submission and the terminal turn');
    assert.equal(stats.sessions, 1);
    assert.equal(stats.disposed, 1);
    assert.equal(host.journal.loadWorld({ runId: draft.runId }), undefined, 'reviewing preparation does not create a WorldRun');

    const rawReview = await configurator.application.readReview({ jobId: queued.scope.jobId, authority });
    const review = PreparationConfiguratorPublicReviewSchema.parse(rawReview);
    assert.equal(review.job.state, 'accepted');
    assert.equal(review.job.scope.jobId, queued.scope.jobId);
    assert.equal('principalId' in review.job, false);
    assert.ok(review.candidateId);
    assert.ok(review.proposal);
    assert.equal(review.proposalHash, sha256CanonicalJson(review.proposal));
    assert.equal('context' in review, false);
    assert.equal('packet' in review, false);
    assert.doesNotMatch(JSON.stringify(review), /CONFIGURATOR_PRIVATE_REVIEW_SENTINEL|DIRECTOR_PRIVATE_REVIEW_SENTINEL|"packet"|"context"|principalId/);

    const routes = createPreparationConfiguratorRoutes({ application: () => configurator?.application });
    server = createLocalHttpServer({
      catalog,
      shellHtml: '<html><head></head><body></body></html>',
      operatorExtensions: [routes],
      runConfigurationDrafts: host.journal,
      resolveSessionMode: candidate => candidate,
    });
    const { origin } = await server.listen();
    const page = await fetch(`${origin}/`);
    const bootstrapNonce = (await page.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];
    assert.ok(bootstrapNonce);
    const login = await fetch(`${origin}/api/v1/session`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ bootNonce: bootstrapNonce }),
    });
    const session = SessionCreatedSchema.parse(await login.json());
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const response = await fetch(`${origin}/api/v1/preparation-configurator/${queued.scope.jobId}/review`, {
      headers: { Origin: origin, Cookie: cookie },
    });
    assert.equal(response.status, 200, await response.clone().text());
    const routedReview = PreparationConfiguratorPublicReviewSchema.parse(await response.json());
    assert.deepEqual(routedReview, review);
    assert.equal('principalId' in routedReview.job, false);
    assert.doesNotMatch(JSON.stringify(routedReview), /CONFIGURATOR_PRIVATE_REVIEW_SENTINEL|DIRECTOR_PRIVATE_REVIEW_SENTINEL|"packet"|"context"|principalId/);
    assert.ok(session.csrfToken.length > 0);
  } finally {
    await server?.close();
    await configurator?.close();
    adaptations.close();
    host.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(`${root}-auth`, { recursive: true, force: true });
  }
});
