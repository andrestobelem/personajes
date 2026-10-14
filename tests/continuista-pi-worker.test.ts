import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { mkdirSync, rmSync } from 'node:fs';
import { createBudgetedStreamFunction, type PiRequestReference } from '../src/adapters/pi.ts';
import { CLAUDE_INFERENCE_PROFILE, DEFAULT_INFERENCE_PROFILE, resolveReadyInferenceProfile } from '../src/domain/inference-profile.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalContinuistaValue, hashContinuistaValue } from '../src/domain/continuista-review.ts';
import { join } from 'node:path';
import { test } from 'node:test';
import { openJournal } from '../src/adapters/journal.ts';
import type { ActorContinuistaPort } from '../src/application/actor-turn-worker.ts';
import { ActorJobExecutionSchema, ContinuistaSessionRegistrationSchema } from '../src/domain/world-journal.ts';
import type { CreatePiSessionInput, PiPromptInput, PiRequestScope } from '../src/adapters/pi.ts';
import { createActorTurnWorker } from '../src/application/actor-turn-worker.ts';
import { createContinuistaPiWorker } from '../src/application/continuista-pi-worker.ts';
import { validateContinuistaReviewContext } from '../src/application/continuista-review-context.ts';
import { WorldSeqSchema } from '../src/domain/values.ts';
import { setup, deterministicFactory, responseFor, actorId, runId, type Fixture } from './fixtures/continuista.ts';

function adminFactory(fixture: Fixture, options: { omitTool?: boolean; incomplete?: boolean; failTerminal?: boolean; beforePrompt?: () => void } = {}) {
  let sessions = 0;
  let disposed = 0;
  let requests = 0;
  const scopes: PiRequestScope[] = [];
  return {
    get sessions() { return sessions; }, get disposed() { return disposed; }, get requests() { return requests; }, scopes,
    async factory(input: CreatePiSessionInput) {
      sessions += 1;
      assert.deepEqual(input.profile, resolveReadyInferenceProfile(fixture.configuration));
      assert.deepEqual(input.identity, { kind: 'admin', role: 'continuista' });
      assert.deepEqual(input.tools.map((tool) => tool.name), ['submit_continuista_review']);
      assert.deepEqual(input.adminToolAllowlist, { continuista: ['submit_continuista_review'] });
      const snapshot = { sessionId: randomUUID(), sessionPath: join(fixture.directory, `${randomUUID()}.jsonl`), candidateLeafId: null };
      return { identity: input.identity, activeToolNames: input.tools.map((tool) => tool.name), checkpoint: () => snapshot,
        subscribe: () => () => undefined,
        async abortAndDispose() { disposed += 1; },
        async prompt(prompt: PiPromptInput) {
          options.beforePrompt?.();
          scopes.push(prompt.scope);
          const port = input.requestPort;
          const purpose = input.identity;
          await port.recordCheckpointCandidate({ identity: purpose, purpose: { kind: 'job-base', baseScope: prompt.scope }, snapshot });
          const reservation = await port.reserveNextRequest({ purpose, scope: prompt.scope, clockEpochId: input.runtime.clockEpochId });
          if (reservation.kind !== 'reserved') throw new Error('Fixture sin presupuesto');
          requests += 1;
          await port.recordCheckpointCandidate({ identity: purpose,
            purpose: { kind: 'request-input', baseScope: prompt.scope, request: { scope: prompt.scope, requestSeq: reservation.requestSeq } },
            snapshot: { ...snapshot, candidateLeafId: 'admin-input' } });
          await port.transitionReservation({ purpose, scope: prompt.scope, requestSeq: reservation.requestSeq, target: 'dispatched', wallTime: { clockEpochId: input.runtime.clockEpochId, monotonicNs: process.hrtime.bigint().toString() } });
          if (!options.omitTool) {
            const context = validateContinuistaReviewContext({ kind: 'continuista-review-context', schemaVersion: 1, ...JSON.parse(prompt.text) });
            assert.deepEqual(context.payload.inferenceProfile, input.profile);
            const response = responseFor(context);
            if (options.incomplete) { response.review.complete = false; response.review.evidenceRefs = []; response.review.criterionCodes = []; }
            const tool = input.tools[0];
            assert.ok(tool);
            await Reflect.apply(tool.execute, tool, ['submit-review', response]);
          }
          await port.transitionReservation({ purpose, scope: prompt.scope, requestSeq: reservation.requestSeq, target: 'completed', wallTime: { clockEpochId: input.runtime.clockEpochId, monotonicNs: process.hrtime.bigint().toString() } });
          const outcome = options.failTerminal ? 'failed' as const : 'completed' as const;
          await port.recordCheckpointCandidate({ identity: purpose,
            purpose: { kind: 'terminal-candidate', baseScope: prompt.scope, outcome, lastRequest: { scope: prompt.scope, requestSeq: reservation.requestSeq } },
            snapshot: { ...snapshot, candidateLeafId: 'admin-terminal' } });
          return { kind: 'pi-terminal-candidate' as const, candidateId: null, outcome, candidateLeafId: 'admin-terminal' };
        },
      };
    },
  };
}

function actorWorker(fixture: Fixture, continuista: ReturnType<typeof createContinuistaPiWorker>) {
  const actor = deterministicFactory(fixture);
  return createActorTurnWorker({ journal: fixture.journal, runtime: fixture.runtime, ids: fixture.ids,
    sessionFactory: actor.factory, memoryForActor: () => ({ async recall() { return { source: 'ranked-recall', throughWorldSeq: WorldSeqSchema.parse(0), experiences: [], rejectedCount: 0 }; } }), continuista });
}

test('Continuista Pi obtiene revisión sólo de tool y acepta terminal durable bajo mismo pulso', async () => {
  const fixture = await setup();
  try {
    const admin = adminFactory(fixture);
    const port = createContinuistaPiWorker({ journal: fixture.journal, runtime: fixture.runtime, ids: fixture.ids,
      ownerToken: fixture.claim.ownerToken, sessionFactory: admin.factory });
    let checkedRecovery = false;
    const actor = actorWorker(fixture, { async review(request) {
      const [first, concurrent] = await Promise.all([port.review(request), port.review(request)]);
      assert.deepEqual(concurrent, first);
      assert.deepEqual(await port.review(request), first);
      checkedRecovery = true;
      return first;
    } });
    assert.equal((await actor.run(fixture.claim)).kind, 'committed');
    assert.equal(checkedRecovery, true);
    assert.equal(admin.sessions, 1);
    assert.equal(admin.requests, 1);
    assert.equal(admin.disposed, 1);
    const scope = admin.scopes[0];
    assert.ok(scope);
    const receipt = fixture.journal.readContinuistaReceipt({ jobId: scope.jobId, generation: scope.generation });
    assert.ok(receipt);
    assert.equal(receipt.review.complete, true);
    assert.equal(scope.runId, runId);
  } finally { fixture.close(); }
});

for (const kind of ['missing', 'failed', 'incomplete'] as const) {
  test(`Continuista ${kind} no obtiene aprobación final`, async () => {
    const fixture = await setup();
    try {
      const admin = adminFactory(fixture, { omitTool: kind === 'missing', failTerminal: kind === 'failed', incomplete: kind === 'incomplete' });
      const port = createContinuistaPiWorker({ journal: fixture.journal, runtime: fixture.runtime, ids: fixture.ids,
        ownerToken: fixture.claim.ownerToken, sessionFactory: admin.factory });
      const actor = actorWorker(fixture, port);
      if (kind === 'incomplete') {
        const result = await actor.run(fixture.claim);
        assert.equal(result.kind, 'blocked');
        if (result.kind === 'blocked') assert.equal(result.code, 'review-incomplete');
      } else await assert.rejects(actor.run(fixture.claim), kind === 'missing' ? /sin entregar revisión/ : /terminal.*no está completado/);
      const scope = admin.scopes[0];
      assert.ok(scope);
      assert.equal(fixture.journal.readContinuistaReceipt({ jobId: scope.jobId, generation: scope.generation }), undefined);
      assert.equal(fixture.journal.loadActorPiSession({ runId, actorId })?.sessionRevision, 0);
      assert.equal(admin.disposed, 1);
    } finally { fixture.close(); }
  });
}

test('factory productiva exige OAuth de perfil requerido sin transporte alternativo', async () => {
  const fixture = await setup();
  try {
    const port = createContinuistaPiWorker({ journal: fixture.journal, runtime: fixture.runtime, ids: fixture.ids, ownerToken: fixture.claim.ownerToken });
    await assert.rejects(actorWorker(fixture, port).run(fixture.claim), /autenticación/);
    assert.equal(fixture.journal.loadActorPiSession({ runId, actorId })?.sessionRevision, 0);
  } finally { fixture.close(); }
});

test('cancelación del admin dispone sesión y no acepta una revisión tardía', async () => {
  const fixture = await setup();
  try {
    const controller = new AbortController();
    const admin = adminFactory(fixture, { beforePrompt: () => controller.abort() });
    const port = createContinuistaPiWorker({ journal: fixture.journal, runtime: fixture.runtime, ids: fixture.ids,
      ownerToken: fixture.claim.ownerToken, sessionFactory: admin.factory });
    await assert.rejects(actorWorker(fixture, port).run(fixture.claim, { signal: controller.signal }), /cancelada/);
    assert.equal(admin.disposed, 1);
    assert.equal(admin.requests, 0);
    const scope = admin.scopes[0];
    assert.ok(scope);
    assert.equal(fixture.journal.readContinuistaReceipt({ jobId: scope.jobId, generation: scope.generation }), undefined);
  } finally { fixture.close(); }
});

test('sesión administrativa usa SDK real, tool y checkpoints reales con transporte local controlado', async () => {
  const fixture = await setup();
  let transportCalls = 0;
  let disposed = 0;
  try {
    const factory = async (input: CreatePiSessionInput) => {
      const cwd = join(fixture.directory, 'admin-sdk-cwd');
      mkdirSync(cwd);
      const manager = SessionManager.create(cwd, join(fixture.directory, 'admin-sdk-sessions'));
      const settings = SettingsManager.inMemory({ retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } }, compaction: { enabled: false }, cacheWarming: 'off', enableAnalytics: false, enableInstallTelemetry: false });
      const loader = new DefaultResourceLoader({ cwd, agentDir: join(fixture.directory, 'admin-sdk-agent'), settingsManager: settings,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: input.systemPrompt });
      await loader.reload();
      const profile = resolveReadyInferenceProfile(fixture.configuration);
      const model = fixture.runtime.modelRuntime.getModel(profile.provider, profile.model);
      assert.ok(model);
      const { session } = await createAgentSession({ cwd, agentDir: join(fixture.directory, 'admin-sdk-agent'), modelRuntime: fixture.runtime.modelRuntime,
        model, thinkingLevel: profile.reasoningEffort, noTools: 'all', tools: ['submit_continuista_review'], customTools: [...input.tools],
        resourceLoader: loader, settingsManager: settings, sessionManager: manager });
      assert.deepEqual(session.getCallableToolNames(), ['submit_continuista_review']);
      function checkpoint() { return { sessionId: manager.getSessionId(), sessionPath: manager.getSessionFile() ?? null, candidateLeafId: manager.getLeafId() }; }
      return {
        identity: input.identity, activeToolNames: session.getActiveToolNames(), checkpoint,
        subscribe: () => () => undefined,
        async abortAndDispose() { await session.abort(); session.dispose(); disposed += 1; },
        async prompt(prompt: PiPromptInput) {
          let lastRequest: PiRequestReference | undefined;
          const context = validateContinuistaReviewContext({ kind: 'continuista-review-context', schemaVersion: 1, ...JSON.parse(prompt.text) });
          await input.requestPort.recordCheckpointCandidate({ identity: input.identity, purpose: { kind: 'job-base', baseScope: prompt.scope }, snapshot: { ...checkpoint(), candidateLeafId: null } });
          session.agent.streamFunction = createBudgetedStreamFunction({ profile, clockEpochId: input.runtime.clockEpochId, requireWallTime: true,
            identity: input.identity, runId, sessionManager: manager, port: input.requestPort,
            getScope: () => prompt.scope, onRequestReserved(request) { lastRequest = request; },
            original(actualModel, _context, options) {
              assert.equal(options?.reasoning, profile.reasoningEffort);
              const stream = createAssistantMessageEventStream();
              transportCalls += 1;
              const first = transportCalls === 1;
              const message: AssistantMessage = { role: 'assistant', api: actualModel.api, provider: actualModel.provider, model: actualModel.id,
                content: first ? [{ type: 'toolCall', id: 'local-review', name: 'submit_continuista_review', arguments: responseFor(context) }] : [],
                stopReason: first ? 'toolUse' : 'stop', timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
              stream.push({ type: 'done', reason: first ? 'toolUse' : 'stop', message });
              return stream;
            },
          });
          // Test-only transport: bypass SDK credential lookup, preserving session message/tool lifecycle.
          await session.agent.prompt(prompt.text);
          const terminal = checkpoint();
          assert.ok(terminal.candidateLeafId);
          assert.ok(lastRequest);
          assert.ok(session.messages.some((message) => message.role === 'toolResult' && message.toolName === 'submit_continuista_review' && !message.isError));
          await input.requestPort.recordCheckpointCandidate({ identity: input.identity,
            purpose: { kind: 'terminal-candidate', baseScope: prompt.scope, outcome: 'completed', lastRequest }, snapshot: terminal });
          return { kind: 'pi-terminal-candidate' as const, candidateId: null, outcome: 'completed' as const, candidateLeafId: terminal.candidateLeafId };
        },
      };
    };
    const port = createContinuistaPiWorker({ journal: fixture.journal, runtime: fixture.runtime, ids: fixture.ids,
      ownerToken: fixture.claim.ownerToken, sessionFactory: factory });
    const result = await actorWorker(fixture, port).run(fixture.claim);
    assert.equal(result.kind, 'committed');
    assert.equal(transportCalls, 2);
    assert.equal(disposed, 1);
  } finally { fixture.close(); }
});

test('receipt admin se recupera tras reinicio y nuevo lease parental sin otra inferencia', async () => {
  const fixture = await setup();
  let reopened: ReturnType<typeof openJournal> | undefined;
  let closed = false;
  try {
    const admin = adminFactory(fixture);
    const original = createContinuistaPiWorker({ journal: fixture.journal, runtime: fixture.runtime, ids: fixture.ids,
      ownerToken: fixture.claim.ownerToken, sessionFactory: admin.factory });
    let requestForRecovery: Parameters<ActorContinuistaPort['review']>[0] | undefined;
    let acceptedReview: unknown;
    const actor = deterministicFactory(fixture);
    // Simulates the process dying before parent acceptance: failure persistence itself is unavailable.
    const crashJournal = { ...fixture.journal, failActorTurnJob() { throw new Error('process-unavailable'); } };
    const interrupted = createActorTurnWorker({ journal: crashJournal, runtime: fixture.runtime, ids: fixture.ids,
      sessionFactory: actor.factory, memoryForActor: () => ({ async recall() { return { source: 'ranked-recall', throughWorldSeq: WorldSeqSchema.parse(0), experiences: [], rejectedCount: 0 }; } }),
      continuista: { async review(request) { requestForRecovery = request; acceptedReview = await original.review(request); throw new Error('crash-after-admin-accept'); } },
    });
    await assert.rejects(interrupted.run(fixture.claim), /crash-after-admin-accept/);
    assert.ok(requestForRecovery);
    assert.equal(admin.sessions, 1);
    fixture.journal.close();
    closed = true;
    reopened = openJournal({ path: join(fixture.directory, 'journal.sqlite') });
    const ownerToken = randomUUID();
    reopened.recoverAbandonedActorTurnJobClaims({ ownerToken });
    const newClaim = { ...fixture.claim, ownerToken, claimToken: randomUUID() };
    const claimed = reopened.claimActorTurnJob(newClaim);
    assert.equal(claimed.kind, 'claimed');
    const execution = ActorJobExecutionSchema.parse({ ...requestForRecovery.execution,
      lease: { ownerToken: newClaim.ownerToken, claimToken: newClaim.claimToken } });
    const recovered = createContinuistaPiWorker({ journal: reopened, runtime: fixture.runtime, ids: fixture.ids, ownerToken,
      sessionFactory: async () => { throw new Error('No nueva sesión para receipt admin aceptado'); } });
    assert.deepEqual(await recovered.review({ execution, proposal: requestForRecovery.proposal }), acceptedReview);
    assert.equal(admin.sessions, 1);
    assert.equal(admin.requests, 1);
  } finally {
    reopened?.close();
    if (!closed) fixture.journal.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

for (const profile of [DEFAULT_INFERENCE_PROFILE, CLAUDE_INFERENCE_PROFILE]) {
  test(`actor y Continuista fijan el mismo perfil durable ${profile.provider}/${profile.model}`, async () => {
    const fixture = await setup(profile);
    try {
      const prepared = fixture.configuration.roster.preparedCharacters[0];
      assert.ok(prepared);
      const wrong = profile.provider === 'anthropic' ? DEFAULT_INFERENCE_PROFILE : CLAUDE_INFERENCE_PROFILE;
      assert.throws(() => fixture.journal.registerActorPiSession({ runId, actorId, sessionId: 'wrong-profile',
        sessionPath: join(fixture.directory, 'wrong.jsonl'), preparedContextHash: hashContinuistaValue(prepared), profile: wrong }), /Perfil Pi distinto/);
      assert.equal(fixture.journal.loadActorPiSession({ runId, actorId }), undefined);
      const admin = adminFactory(fixture);
      const checkedJournal = { ...fixture.journal, registerContinuistaSession(raw: unknown) {
        const registration = ContinuistaSessionRegistrationSchema.parse(raw);
        assert.throws(() => fixture.journal.registerContinuistaSession({ ...registration, profile: wrong }), /Perfil Continuista distinto/);
        return fixture.journal.registerContinuistaSession(registration);
      } };
      const continuista = createContinuistaPiWorker({ journal: checkedJournal, runtime: fixture.runtime, ids: fixture.ids,
        ownerToken: fixture.claim.ownerToken, sessionFactory: admin.factory });
      assert.equal((await actorWorker(fixture, continuista).run(fixture.claim)).kind, 'committed');
      assert.deepEqual(fixture.journal.loadActorPiSession({ runId, actorId })?.profile, profile);
      const scope = admin.scopes[0];
      assert.ok(scope);
      assert.equal(fixture.journal.readContinuistaReceipt({ jobId: scope.jobId, generation: scope.generation })?.review.verdict, 'allow');
      assert.equal(admin.requests, 1);
    } finally { fixture.close(); }
  });
}

test('Ready histórica sin perfil conserva perfil compacto, JSON y hashes al reabrir', async () => {
  const fixture = await setup('historical');
  let reopened: ReturnType<typeof openJournal> | undefined;
  let closed = false;
  try {
    assert.equal(Object.hasOwn(fixture.configuration, 'inferenceProfile'), false);
    const prepared = fixture.configuration.roster.preparedCharacters[0];
    assert.ok(prepared);
    const compact = { provider: 'openai-codex', model: 'gpt-6-luna', reasoning: 'xhigh' };
    const registered = fixture.journal.registerActorPiSession({ runId, actorId, sessionId: 'historical-luna',
      sessionPath: join(fixture.directory, 'historical.jsonl'), preparedContextHash: hashContinuistaValue(prepared), profile: compact });
    assert.deepEqual(registered.session.profile, compact);
    const claim = fixture.journal.claimActorTurnJob(fixture.claim);
    assert.ok(claim.kind === 'claimed');
    const execution = ActorJobExecutionSchema.parse({ runId, actorId, jobId: claim.job.jobId, generation: claim.job.generation,
      pulseId: claim.job.pulseId, lease: { ownerToken: fixture.claim.ownerToken, claimToken: fixture.claim.claimToken } });
    assert.equal(fixture.journal.readActorJobInferenceProfile(execution).model, 'gpt-6-luna');
    const db = new DatabaseSync(join(fixture.directory, 'journal.sqlite'));
    const before = db.prepare('SELECT profile_json,profile_hash FROM actor_pi_sessions').all();
    const beforeConfiguration = db.prepare('SELECT configuration_json,configuration_hash FROM world_runs').all();
    db.close();
    fixture.journal.close(); closed = true;
    reopened = openJournal({ path: join(fixture.directory, 'journal.sqlite') });
    assert.deepEqual(reopened.loadActorPiSession({ runId, actorId })?.profile, compact);
    assert.equal(canonicalContinuistaValue(reopened.readWorldConfiguration({ runId })), canonicalContinuistaValue(fixture.configuration));
    const dbAfter = new DatabaseSync(join(fixture.directory, 'journal.sqlite'));
    assert.deepEqual(dbAfter.prepare('SELECT profile_json,profile_hash FROM actor_pi_sessions').all(), before);
    assert.deepEqual(dbAfter.prepare('SELECT configuration_json,configuration_hash FROM world_runs').all(), beforeConfiguration);
    dbAfter.close();
  } finally { reopened?.close(); if (!closed) fixture.journal.close(); rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('Ready histórica sin sesión no crea inferencia ni cambia silenciosamente a Sol', async () => {
  const fixture = await setup('historical');
  let actorFactories = 0;
  let adminFactories = 0;
  try {
    const worker = createActorTurnWorker({ journal: fixture.journal, runtime: fixture.runtime, ids: fixture.ids,
      sessionFactory: async () => { actorFactories += 1; throw new Error('No factory legacy'); },
      continuista: { async review() { adminFactories += 1; throw new Error('No review legacy'); } },
      memoryForActor: () => { throw new Error('No compilar contexto nuevo legacy'); } });
    await assert.rejects(worker.run(fixture.claim), /perfil histórico retirado/);
    assert.equal(actorFactories, 0);
    assert.equal(adminFactories, 0);
    assert.equal(fixture.journal.loadActorPiSession({ runId, actorId }), undefined);
    const db = new DatabaseSync(join(fixture.directory, 'journal.sqlite'));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM request_reservations').get()?.count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM continuista_jobs').get()?.count, 0);
    db.close();
  } finally { fixture.close(); }
});

test('SDK Continuista + SQLite: timeout no acepta review tardía, conserva owner y acumula tiempo actoral tras reopen', async () => {
  const fixture = await setup();
  const source = createAssistantMessageEventStream();
  let now = 0n;
  let deadline: () => void = () => undefined;
  let enter: () => void = () => undefined; const entered = new Promise<void>((resolve) => { enter = resolve; });
  let sdkFinished: () => void = () => undefined; const sdkSettled = new Promise<void>((resolve) => { sdkFinished = resolve; });
  let adminScope: PiRequestScope | undefined;
  let actorMeasuredMs = 0;
  let lateResponse: ReturnType<typeof responseFor> | undefined;
  let disposed = 0;
  let reopened: ReturnType<typeof openJournal> | undefined;
  try {
    const factory = async (input: CreatePiSessionInput) => {
      const cwd = join(fixture.directory, 'timed-admin-cwd'); mkdirSync(cwd);
      const manager = SessionManager.create(cwd, join(fixture.directory, 'timed-admin-sessions'));
      const settings = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false }, defaultThinkingLevel: 'low' });
      const loader = new DefaultResourceLoader({ cwd, agentDir: join(fixture.directory, 'timed-admin-agent'), settingsManager: settings,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: input.systemPrompt });
      await loader.reload();
      const profile = resolveReadyInferenceProfile(fixture.configuration);
      const model = fixture.runtime.modelRuntime.getModel(profile.provider, profile.model); assert.ok(model);
      const { session } = await createAgentSession({ cwd, agentDir: join(fixture.directory, 'timed-admin-agent'), modelRuntime: fixture.runtime.modelRuntime,
        model, thinkingLevel: profile.reasoningEffort, noTools: 'all', tools: ['submit_continuista_review'], customTools: [...input.tools], resourceLoader: loader, settingsManager: settings, sessionManager: manager });
      const checkpoint = () => ({ sessionId: manager.getSessionId(), sessionPath: manager.getSessionFile() ?? null, candidateLeafId: manager.getLeafId() });
      let budgeted: ReturnType<typeof createBudgetedStreamFunction> | undefined;
      return { identity: input.identity, activeToolNames: session.getActiveToolNames(), checkpoint, subscribe: () => () => undefined,
        async abortAndDispose() { await session.abort(); await budgeted?.whenSettled(); session.dispose(); disposed += 1; },
        async prompt(prompt: PiPromptInput) {
          adminScope = prompt.scope;
          const before = fixture.journal.readRunModelTimeBudget({ runId });
          if (before?.status !== 'known') throw new Error('Actor must have settled its real request first');
          actorMeasuredMs = before.wallTimeMeasuredMs; assert.ok(actorMeasuredMs >= 1);
          const context = validateContinuistaReviewContext({ kind: 'continuista-review-context', schemaVersion: 1, ...JSON.parse(prompt.text) });
          lateResponse = responseFor(context);
          let lastRequest: PiRequestReference | undefined;
          await input.requestPort.recordCheckpointCandidate({ identity: input.identity, purpose: { kind: 'job-base', baseScope: prompt.scope }, snapshot: { ...checkpoint(), candidateLeafId: null } });
          budgeted = createBudgetedStreamFunction({ profile, clockEpochId: input.runtime.clockEpochId, requireWallTime: true,
            clock: { nowNs: () => now, schedule(ms, callback) { assert.equal(ms, 30_000); deadline = callback; return () => undefined; } },
            identity: input.identity, runId, sessionManager: manager, port: input.requestPort, getScope: () => prompt.scope,
            onRequestReserved(request) { lastRequest = request; }, original: () => { enter(); return source; } });
          session.agent.streamFunction = budgeted;
          await session.agent.prompt(prompt.text); sdkFinished();
          await input.requestPort.recordCheckpointCandidate({ identity: input.identity,
            purpose: { kind: 'terminal-candidate', baseScope: prompt.scope, outcome: 'aborted', ...(lastRequest === undefined ? {} : { lastRequest }) }, snapshot: checkpoint() });
          return { kind: 'pi-terminal-candidate' as const, candidateId: null, outcome: 'aborted' as const, candidateLeafId: manager.getLeafId() };
        } };
    };
    const continuista = createContinuistaPiWorker({ journal: fixture.journal, runtime: fixture.runtime, ids: fixture.ids,
      ownerToken: fixture.claim.ownerToken, sessionFactory: factory });
    let finished = false;
    const acting = actorWorker(fixture, continuista).run(fixture.claim).then((value) => { finished = true; return value; }, (error: unknown) => { finished = true; return error; });
    await entered; now = 30_000_000_000n; deadline(); await sdkSettled;
    await new Promise((resolve) => setImmediate(resolve)); assert.equal(finished, false); assert.equal(disposed, 0);
    const pending = fixture.journal.readRunModelTimeBudget({ runId });
    assert.equal(pending?.status, 'uncertain'); assert.equal(pending?.activePiRequests, 1); assert.equal(pending?.wallTimeReservedMs, 30_000);
    assert.ok(adminScope); assert.equal(fixture.journal.readContinuistaReceipt({ jobId: adminScope.jobId, generation: adminScope.generation }), undefined);
    assert.ok(lateResponse);
    now = 35_500_000_000n;
    const profile = resolveReadyInferenceProfile(fixture.configuration);
    const late: AssistantMessage = { role: 'assistant', api: profile.api, provider: profile.provider, model: profile.model,
      content: [{ type: 'toolCall', id: 'late-review', name: 'submit_continuista_review', arguments: lateResponse }], stopReason: 'toolUse', timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    source.push({ type: 'done', reason: 'toolUse', message: late });
    assert.ok((await acting) instanceof Error); assert.equal(disposed, 1);
    assert.equal(fixture.journal.readContinuistaReceipt({ jobId: adminScope.jobId, generation: adminScope.generation }), undefined);
    assert.equal(fixture.journal.loadActorPiSession({ runId, actorId })?.committedLeafId, null);
    fixture.journal.close(); reopened = openJournal({ path: join(fixture.directory, 'journal.sqlite') });
    const persisted = reopened.readRunModelTimeBudget({ runId });
    assert.equal(persisted?.status, 'known'); assert.equal(persisted?.wallTimeMeasuredMs, actorMeasuredMs + 35_500);
    assert.equal(persisted?.wallTimeReservedMs, 0); assert.equal(persisted?.activePiRequests, 0); assert.equal(persisted?.runCallsUsed, 2);
    assert.equal(reopened.readContinuistaReceipt({ jobId: adminScope.jobId, generation: adminScope.generation }), undefined);
    assert.equal(reopened.loadActorPiSession({ runId, actorId })?.committedLeafId, null);
  } finally { source.end(); reopened?.close(); try { fixture.journal.close(); } catch { /* Closed before explicit reopen. */ } rmSync(fixture.directory, { recursive: true, force: true }); }
});
