import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openLocalHost } from '../src/application/local-host.ts';
import { createRepresentationRuntime } from '../src/application/representation-runtime.ts';
import { createBudgetedStreamFunction, PiRuntime } from '../src/adapters/pi.ts';
import type { CreatePiSessionInput, PiPromptInput, PiRequestReference } from '../src/adapters/pi.ts';
import { ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { validateContinuistaReviewContext } from '../src/application/continuista-review-context.ts';
import { RevisionSchema, RunIdSchema, WorldSeqSchema } from '../src/domain/values.ts';
import { DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import type { RunId } from '../src/domain/values.ts';
import { controlledDirectorSessionFactory } from './fixtures/director-session.ts';
import { WorldActorActionSchema, type WorldClock } from '../src/domain/world-schema.ts';
import { createCircumstanceApplication } from '../src/application/direction-circumstances.ts';
import { createRunObservationApplication } from '../src/application/run-observation.ts';
import { canonical, responseFor, setup, actorId, type Fixture } from './fixtures/continuista.ts';

const realIcmBinary = process.env.PERSONAJES_ICM_TEST_BINARY;
const realIcmOptions = {
  skip: realIcmBinary === undefined ? 'Definí PERSONAJES_ICM_TEST_BINARY para integrar el runtime con ICM real.' : false,
};
const actorRecallSource = 'Mensaje sintético recibido por el personaje.';

test('la composición comparte el runtime de autenticación del host y rechaza otra raíz privada', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'personajes-shared-auth-'));
  const otherRoot = mkdtempSync(join(tmpdir(), 'personajes-other-auth-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(otherRoot, { recursive: true, force: true }); });
  const host = openLocalHost({ privateDataRoot: root });
  const foreignRuntime = await PiRuntime.create({ privateDataRoot: otherRoot });
  await assert.rejects(createRepresentationRuntime({ host, piRuntime: foreignRuntime, icmBinaryPath: join(root, 'icm') }), /otro directorio privado/);
  const sharedRuntime = await PiRuntime.create({ privateDataRoot: host.privateDataRoot });
  const readCredentials = sharedRuntime.modelRuntime.listCredentials.bind(sharedRuntime.modelRuntime);
  let reads = 0;
  t.mock.method(sharedRuntime.modelRuntime, 'listCredentials', async () => { reads += 1; return readCredentials(); });
  const representation = await createRepresentationRuntime({ host, piRuntime: sharedRuntime, icmBinaryPath: join(root, 'icm') });
  try {
    const status = await representation.oauth.status();
    assert.equal(status.kind, 'status');
    assert.equal(reads, 1, 'la consulta usa el ModelRuntime compartido, no otro cache de autenticación');
    assert.equal(host.journal.listRunConfigurationDrafts().length, 0);
  } finally { await representation.close(); }
  const reopened = openLocalHost({ privateDataRoot: root });
  reopened.close();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error('El proceso ICM de prueba no inició a tiempo.');
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('La operación de prueba excedió el tiempo límite.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function hostFromFixture(fixture: Fixture) {
  fixture.journal.close();
  renameSync(join(fixture.directory, 'journal.sqlite'), join(fixture.directory, 'world.sqlite'));
  return openLocalHost({ privateDataRoot: fixture.directory });
}

function registerAdditionalRun(fixture: Fixture, host: ReturnType<typeof openLocalHost>, withIntervention = true, withInitialGoal = false,
  routineWindows?: readonly (readonly [number,number])[], broadcast=false,
  dailySchedule?: { routine: unknown; maxAdvanceMs: number; dayNight?: NonNullable<WorldClock['dayNight']> }) {
  const freshRunId = RunIdSchema.parse(randomUUID());
  const configuration = ReadyRunConfigurationSchema.parse({
    ...fixture.configuration,
    budget:{...fixture.configuration.budget,maxPiCallsPerPulse:8},
    circadianPolicy:dailySchedule!==undefined?{kind:'advance-while-running',maxAdvanceMs:dailySchedule.maxAdvanceMs}:
      routineWindows===undefined?fixture.configuration.circadianPolicy:{kind:'advance-while-running',maxAdvanceMs:1_000},
    runId: freshRunId,
    worldSnapshot: {
      ...fixture.configuration.worldSnapshot,
      runId: freshRunId,
      ...(dailySchedule?.dayNight === undefined ? {} : { clock: { ...fixture.configuration.worldSnapshot.clock, dayNight: dailySchedule.dayNight } }),
      channels:fixture.configuration.worldSnapshot.channels.map((channel)=>routineWindows===undefined&&!broadcast?channel:{...channel,scope:'broadcast'}),
      entities: fixture.configuration.worldSnapshot.entities.map((entity) => entity.kind === 'character'
        ? { ...entity,
          routine:dailySchedule!==undefined?dailySchedule.routine:routineWindows===undefined?entity.routine:{kind:'windows',defaultState:'unavailable',
            windows:routineWindows.map(([from,to])=>({from:fixture.configuration.worldSnapshot.clock.instant+from,
              to:fixture.configuration.worldSnapshot.clock.instant+to,state:'available'}))},
          mind: { ...entity.mind,
          goals: withInitialGoal && entity.characterId === actorId
            ? [{ kind:'durable',id:randomUUID(),description:'Considerar la situación inicial.',priority:0.7,state:'active',revision:0,history:[] }]
            : entity.mind.goals,
          experiences: entity.mind.experiences.map((experience) => ({ ...experience, runId: freshRunId })) } }
        : entity),
    },
    snapshotFence: { ...fixture.configuration.snapshotFence, runId: freshRunId },
  });
  const contexts = configuration.roster.activeCharacterIds.map((characterId) => {
    const prepared = configuration.roster.preparedCharacters.find((candidate) => candidate.characterId === characterId);
    assert.ok(prepared);
    return {
      actorId: characterId,
      continuityId: prepared.continuity.continuityId,
      continuityRevision: prepared.continuity.revision,
      continuityContentHash: prepared.continuity.contentHash,
      identityVersion: prepared.identityVersion,
      preparedContextHash: createHash('sha256').update(canonical(prepared)).digest('hex'),
    };
  });
  host.journal.registerWorldRun({
    initialSnapshot: configuration.worldSnapshot,
    configurationRevision: configuration.configRevision,
    configuration,
    continuityFence: { kind: 'prepared-contexts', atWorldSeq: configuration.worldSnapshot.seq, contexts },
    lifecycle: 'running',
  });
  if (!withIntervention) return freshRunId;
  const message = host.journal.commitHumanIntervention({
    runId: freshRunId,
    participantId: 'visitante-prueba',
    expectedRevision: configuration.worldSnapshot.revision,
    idempotencyKey: randomUUID(),
    request: {
      kind: 'speech', recipientCharacterIds: [actorId],
      channelId: '00000000-0000-4000-8000-000000000104',
      content: { kind: 'speech', text: actorRecallSource },
    },
  });
  assert.equal(message.kind === 'idempotencyConflict' || message.kind === 'invalidLifecycle' ? message.kind : message.resolution.kind, 'applied');
  return freshRunId;
}

function controlledTransport(input: { fixture: Fixture; host: ReturnType<typeof openLocalHost>; runId: RunId; stats: { requests: number; recallResults: number; disposed: number };
  onActorPrompt?: (context:{prompt:PiPromptInput;systemPrompt:string})=>void;
  actionForPrompt?: (prompt:PiPromptInput)=>ReturnType<typeof WorldActorActionSchema.parse>;
}) {
  const actorSessionFactory = async (sessionInput: CreatePiSessionInput) => {
    assert.deepEqual(sessionInput.identity, { kind: 'actor', characterId: actorId });
    const cwd = join(input.fixture.directory, `controlled-sdk-${input.runId}`);
    mkdirSync(cwd, { recursive: true });
    const agentDir = join(cwd, 'agent');
    const manager = sessionInput.checkpoint.kind==='leaf'
      ?SessionManager.open(sessionInput.checkpoint.sessionPath,join(cwd,'sessions'),cwd)
      :SessionManager.create(cwd, join(cwd, 'sessions'));
    if(sessionInput.checkpoint.kind==='leaf'&&manager.getLeafId()!==sessionInput.checkpoint.committedLeafId)
      manager.branch(sessionInput.checkpoint.committedLeafId);
    const settingsManager = SettingsManager.inMemory({
      retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
      compaction: { enabled: false }, cacheWarming: 'off', enableAnalytics: false, enableInstallTelemetry: false,
    });
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPrompt: sessionInput.systemPrompt });
    await resourceLoader.reload();
    const selectedProfile = sessionInput.profile ?? DEFAULT_INFERENCE_PROFILE;
    const model = sessionInput.runtime.modelRuntime.getModel(selectedProfile.provider, selectedProfile.model);
    assert.ok(model);
    const { session } = await createAgentSession({ cwd, agentDir, modelRuntime: sessionInput.runtime.modelRuntime, model,
      thinkingLevel: selectedProfile.reasoningEffort, noTools: 'all', tools: ['recall_memory', 'propose_action'], customTools: [...sessionInput.tools],
      resourceLoader, settingsManager, sessionManager: manager });
    const checkpoint = () => ({ sessionId: manager.getSessionId(), sessionPath: manager.getSessionFile() ?? null, candidateLeafId: manager.getLeafId() });
    return {
      identity: sessionInput.identity,
      activeToolNames: session.getActiveToolNames(),
      checkpoint,
      subscribe: () => () => undefined,
      async abortAndDispose() { await session.abort(); session.dispose(); input.stats.disposed += 1; },
      async prompt(prompt: PiPromptInput) {
        input.onActorPrompt?.({prompt,systemPrompt:sessionInput.systemPrompt});
        const base = input.host.journal.loadActorPiSession({ runId: input.runId, actorId });
        assert.ok(base);
        assert.ok(prompt.inputCut);
        const inputCut = prompt.inputCut;
        const turnBase = { ...base, sessionRevision: RevisionSchema.parse(base.sessionRevision) };
        const turnId = randomUUID();
        let lastRequest: PiRequestReference | undefined;
        let requestNumber=0;
        await sessionInput.requestPort.recordCheckpointCandidate({ identity: sessionInput.identity,
          purpose: { kind: 'job-base', baseScope: prompt.scope }, snapshot: { ...checkpoint(), candidateLeafId: base.committedLeafId } });
        session.agent.streamFunction = createBudgetedStreamFunction({ clockEpochId: sessionInput.runtime.clockEpochId, requireWallTime: true,
          identity: sessionInput.identity,
          runId: input.runId,
          sessionManager: manager,
          port: sessionInput.requestPort,
          getScope: () => prompt.scope,
          getActorTurnContext: () => ({ turnId, base: turnBase, inputCut,
            ...(prompt.lease === undefined ? {} : { lease: prompt.lease }) }),
          onRequestReserved(request) { lastRequest = request; },
          original(actualModel) {
            const stream = createAssistantMessageEventStream();
            input.stats.requests += 1;
            requestNumber+=1;
            const toolCall = requestNumber === 1
              ? { type: 'toolCall' as const, id: `local-recall-${turnId}`, name: 'recall_memory', arguments: { query: 'mensaje recibido' } }
              : requestNumber === 2
                ? { type: 'toolCall' as const, id: `local-proposal-${turnId}`, name: 'propose_action', arguments: { action: input.actionForPrompt?.(prompt)??{ kind: 'wait', durationMs: 1 } } }
                : undefined;
            const message: AssistantMessage = {
              role: 'assistant', api: actualModel.api, provider: actualModel.provider, model: actualModel.id,
              content: toolCall === undefined ? [] : [toolCall],
              stopReason: toolCall === undefined ? 'stop' : 'toolUse', timestamp: Date.now(),
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            };
            stream.push({ type: 'done', reason: toolCall === undefined ? 'stop' : 'toolUse', message });
            return stream;
          },
        });
        const recallResultsBefore=session.messages.filter((message)=>message.role==='toolResult'
          &&message.toolName==='recall_memory'&&!message.isError).length;
        await session.agent.prompt(prompt.text);
        input.stats.recallResults += session.messages.filter((message) => message.role === 'toolResult'
          && message.toolName === 'recall_memory' && !message.isError).length-recallResultsBefore;
        const terminal = checkpoint();
        assert.ok(terminal.candidateLeafId);
        assert.ok(lastRequest);
        await sessionInput.requestPort.recordCheckpointCandidate({ identity: sessionInput.identity,
          purpose: { kind: 'terminal-candidate', baseScope: prompt.scope, outcome: 'completed', lastRequest }, snapshot: terminal });
        const candidateId = randomUUID();
        await sessionInput.requestPort.recordActorPiCandidate?.({ kind: 'terminal-candidate', candidateId, turnId,
          runId: input.runId, actorId, scope: prompt.scope, lease: prompt.lease, base: turnBase, outcome: 'completed',
          lastRequestSeq: lastRequest.requestSeq, candidateLeafId: terminal.candidateLeafId, inputCut });
        return { kind: 'pi-terminal-candidate' as const, candidateId, outcome: 'completed' as const,
          candidateLeafId: terminal.candidateLeafId };
      },
    };
  };

  const continuistaSessionFactory = async (sessionInput: CreatePiSessionInput) => {
    assert.deepEqual(sessionInput.identity, { kind: 'admin', role: 'continuista' });
    const snapshot = { sessionId: randomUUID(), sessionPath: join(input.fixture.directory, `${randomUUID()}.jsonl`), candidateLeafId: null };
    return {
      identity: sessionInput.identity, activeToolNames: sessionInput.tools.map((tool) => tool.name),
      checkpoint: () => snapshot, subscribe: () => () => undefined,
      async abortAndDispose() { input.stats.disposed += 1; },
      async prompt(prompt: PiPromptInput) {
        const purpose = sessionInput.identity;
        await sessionInput.requestPort.recordCheckpointCandidate({ identity: purpose,
          purpose: { kind: 'job-base', baseScope: prompt.scope }, snapshot });
        const reservation = await sessionInput.requestPort.reserveNextRequest({ purpose, scope: prompt.scope, clockEpochId: sessionInput.runtime.clockEpochId });
        assert.equal(reservation.kind, 'reserved');
        if (reservation.kind !== 'reserved') throw new Error('Sin cuota sintética del Continuista.');
        const lastRequest = { scope: prompt.scope, requestSeq: reservation.requestSeq };
        await sessionInput.requestPort.recordCheckpointCandidate({ identity: purpose,
          purpose: { kind: 'request-input', baseScope: prompt.scope, request: lastRequest },
          snapshot: { ...snapshot, candidateLeafId: 'continuista-input' } });
        await sessionInput.requestPort.transitionReservation({ purpose, scope: prompt.scope,
          requestSeq: reservation.requestSeq, target: 'dispatched', wallTime: { clockEpochId: sessionInput.runtime.clockEpochId, monotonicNs: process.hrtime.bigint().toString() } });
        const context = validateContinuistaReviewContext({ kind: 'continuista-review-context', schemaVersion: 1,
          ...JSON.parse(prompt.text) });
        const tool = sessionInput.tools[0];
        assert.ok(tool);
        await Reflect.apply(tool.execute, tool, ['synthetic-review', responseFor(context)]);
        await sessionInput.requestPort.transitionReservation({ purpose, scope: prompt.scope,
          requestSeq: reservation.requestSeq, target: 'completed', wallTime: { clockEpochId: sessionInput.runtime.clockEpochId, monotonicNs: process.hrtime.bigint().toString() } });
        await sessionInput.requestPort.recordCheckpointCandidate({ identity: purpose,
          purpose: { kind: 'terminal-candidate', baseScope: prompt.scope, outcome: 'completed', lastRequest },
          snapshot: { ...snapshot, candidateLeafId: 'continuista-terminal' } });
        return { kind: 'pi-terminal-candidate' as const, candidateId: null, outcome: 'completed' as const,
          candidateLeafId: 'continuista-terminal' };
      },
    };
  };

  return {
    kind: 'controlled-test-transport' as const,
    name: 'Pi SDK con stream local determinista y revisión Continuista sintética',
    actorSessionFactory,
    continuistaSessionFactory,
    directorSessionFactory:controlledDirectorSessionFactory({root:input.fixture.directory}),
  };
}

test('composición usa el host recibido, exige ICM y no configura corridas ni autentica al crear', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-runtime-empty-'));
  const host = openLocalHost({ privateDataRoot: directory });
  try {
    await assert.rejects(createRepresentationRuntime({ host, icmBinaryPath: '' }), /ruta ICM/i);
    const runtime = await createRepresentationRuntime({ host, icmBinaryPath: '/host/bin/icm' });
    assert.deepEqual(await runtime.recover(), { deliveryTargets: 0, coordinatorTargets: 0, scheduledRuns: 0 });
    assert.equal(runtime.isClosed, false);
    await runtime.close();
    assert.equal(runtime.isClosed, true);
    const reopened = openLocalHost({ privateDataRoot: directory });
    reopened.close();
  } finally {
    try { host.close(); } catch { /* Runtime close already released the supplied host. */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('una corrida running sin estímulos acepta la agenda sin inventar acontecimientos ni sesiones', async () => {
  const fixture = await setup();
  const host = hostFromFixture(fixture);
  const runId = registerAdditionalRun(fixture, host, false);
  const stats = { requests: 0, recallResults: 0, disposed: 0 };
  const runtime = await createRepresentationRuntime({ host, icmBinaryPath: '/host/not-needed/icm',
    testTransport: controlledTransport({ fixture, host, runId, stats }) });
  try {
    const before = host.journal.loadWorld({ runId });
    assert.equal(await runtime.scheduleRun({ runId }), true);
    await runtime.waitForIdle();
    assert.equal(host.journal.readWorldLifecycle({ runId })?.lifecycle, 'running');
    assert.deepEqual(host.journal.loadWorld({ runId }), before);
    assert.equal(host.journal.loadActorPiSession({ runId, actorId }), undefined);
    assert.equal(stats.requests, 0);
    assert.equal(stats.disposed, 0);
    assert.equal(await runtime.scheduleRun({ runId: randomUUID() }), false);
  } finally {
    await runtime.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('runtime entrega, proyecta ICM real y ejecuta una actuación con transporte Pi SDK local', realIcmOptions, async () => {
  assert.ok(realIcmBinary);
  const fixture = await setup();
  let host: ReturnType<typeof openLocalHost> | undefined;
  let runtime: Awaited<ReturnType<typeof createRepresentationRuntime>> | undefined;
  const stats = { requests: 0, recallResults: 0, disposed: 0 };
  try {
    host = hostFromFixture(fixture);
    const freshRunId = registerAdditionalRun(fixture, host);
    runtime = await createRepresentationRuntime({ host, icmBinaryPath: realIcmBinary,
      testTransport: controlledTransport({ fixture, host, runId: freshRunId, stats }) });
    await runtime.recover();
    assert.equal(stats.requests, 0, 'la recuperación mecánica no autoriza inferencia sin un gate fresco');
    assert.equal(await runtime.scheduleRun({ runId: freshRunId }), true, 'el host agenda la corrida sólo después de autorizarla');
    await runtime.waitForIdle();
    assert.ok(stats.requests >= 3);
    assert.equal(stats.recallResults, 1);
    assert.equal(stats.disposed, 2);
    assert.equal(host.journal.readExperiences({ runId: freshRunId, actorId, throughWorldSeq: WorldSeqSchema.parse(Number.MAX_SAFE_INTEGER) }).length, 1);
    assert.deepEqual(host.journal.listCoordinatorPulseTargets({ limit: 10 }), []);
  } finally {
    if (runtime !== undefined) await runtime.close();
    else host?.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('waitForIdle espera la proyección y el coordinador que nacen al cerrar una entrega', realIcmOptions, async () => {
  assert.ok(realIcmBinary);
  const fixture = await setup();
  let host: ReturnType<typeof openLocalHost> | undefined;
  let runtime: Awaited<ReturnType<typeof createRepresentationRuntime>> | undefined;
  const actorStarted = deferred();
  const releaseActor = deferred();
  let actorCalls = 0;
  try {
    host = hostFromFixture(fixture);
    const freshRunId = registerAdditionalRun(fixture, host);
    const transport = controlledTransport({ fixture, host, runId: freshRunId,
      stats: { requests: 0, recallResults: 0, disposed: 0 } });
    runtime = await createRepresentationRuntime({ host, icmBinaryPath: realIcmBinary,
      testTransport: { ...transport, actorSessionFactory: async () => {
        actorCalls += 1;
        actorStarted.resolve();
        await releaseActor.promise;
        throw new Error('Fallo controlado después de observar el dispatch.');
      } },
    });
    const recovery = runtime.recover();
    await recovery;
    const scheduled = runtime.scheduleRun({ runId: freshRunId });
    let idleSettled = false;
    const idle = runtime.waitForIdle().then(() => { idleSettled = true; });
    await withTimeout(actorStarted.promise, 10_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(idleSettled, false);
    releaseActor.resolve();
    await withTimeout(Promise.all([scheduled, idle]).then(() => undefined), 10_000);
    assert.equal(actorCalls, 1);
    assert.equal(idleSettled, true);
  } finally {
    releaseActor.resolve();
    if (runtime !== undefined) await runtime.close();
    else host?.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('close aborta ICM y espera scheduleRun, retry y recover antes de liberar el host', async () => {
  const fixture = await setup();
  let host: ReturnType<typeof openLocalHost> | undefined;
  let runtime: Awaited<ReturnType<typeof createRepresentationRuntime>> | undefined;
  try {
    host = hostFromFixture(fixture);
    const freshRunId = registerAdditionalRun(fixture, host);
    const marker = join(fixture.directory, 'slow-icm-started');
    const fakeIcm = join(fixture.directory, 'slow-icm');
    writeFileSync(fakeIcm, `#!/bin/sh\n: > '${marker}'\nexec /bin/sleep 30\n`, { mode: 0o700 });
    chmodSync(fakeIcm, 0o700);
    runtime = await createRepresentationRuntime({ host, icmBinaryPath: fakeIcm });
    runtime.scheduleDelivery({ runId: freshRunId, actorIds: [actorId] });
    await waitForFile(marker);

    const scheduled = runtime.scheduleRun({ runId: freshRunId });
    const retried = runtime.retryMemoryProjection({ runId: freshRunId, actorId });
    const recovered = runtime.recover();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await withTimeout(runtime.close(), 5_000);
    const [scheduleResult, retryResult, recoveryResult] = await Promise.all([scheduled, retried, recovered]);
    assert.equal(scheduleResult, false);
    assert.equal(retryResult.kind, 'cancelled');
    assert.ok(recoveryResult.deliveryTargets >= 0);
    assert.equal(runtime.isClosed, true);

    const reopened = openLocalHost({ privateDataRoot: fixture.directory });
    reopened.close();
  } finally {
    if (runtime !== undefined) await runtime.close();
    else host?.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('si falla el store, conserva la experiencia journal y suspende antes de invocar al actor', async () => {
  const fixture = await setup();
  let host: ReturnType<typeof openLocalHost> | undefined;
  let runtime: Awaited<ReturnType<typeof createRepresentationRuntime>> | undefined;
  const diagnostics: unknown[] = [];
  let actorCalls = 0;
  try {
    host = hostFromFixture(fixture);
    const freshRunId = registerAdditionalRun(fixture, host);
    const transport = controlledTransport({ fixture, host, runId: freshRunId,
      stats: { requests: 0, recallResults: 0, disposed: 0 } });
    runtime = await createRepresentationRuntime({ host, icmBinaryPath: join(fixture.directory, 'missing-icm'),
      testTransport: { ...transport, actorSessionFactory: async (input: CreatePiSessionInput) => {
        actorCalls += 1;
        return transport.actorSessionFactory(input);
      } },
      onDiagnostic(diagnostic) { diagnostics.push(diagnostic); },
    });
    await runtime.recover();
    await runtime.waitForIdle();
    await runtime.recover();
    assert.equal(actorCalls, 0);
    assert.ok(diagnostics.some((entry) => typeof entry === 'object' && entry !== null
      && 'kind' in entry && entry.kind === 'memory-projection'));
    const experiences = host.journal.readExperiences({ runId: freshRunId, actorId, throughWorldSeq: WorldSeqSchema.parse(Number.MAX_SAFE_INTEGER) });
    assert.equal(experiences.length, 1);
    assert.equal(experiences[0]?.content, actorRecallSource);
  } finally {
    if (runtime !== undefined) await runtime.close();
    else host?.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

async function authorizeSyntheticStep(host: ReturnType<typeof openLocalHost>, runId: RunId) {
  const {fingerprintInferenceProfile} = await import('../src/application/pi-access-check.ts');
  const principalId = 'synthetic-step-operator';
  const state = host.journal.readWorldLifecycle({runId}); assert.ok(state);
  const started = host.journal.createRunPreflightJob({principalId,idempotencyKey:randomUUID(),runId,
    expectedConfigurationRevision:state.configRevision,expectedWorldRevision:state.worldRevision});
  if (started.kind !== 'created') assert.fail(`Preflight ${started.kind}`);
  const lease = {ownerToken:randomUUID(),claimToken:randomUUID()};
  const claimed = host.journal.claimRunPreflightJob({runId,jobId:started.job.jobId,expectedRevision:0,...lease});
  if (claimed.kind !== 'claimed') assert.fail('No claim');
  const frozen = host.journal.readRunPreflightJobInput({runId,jobId:started.job.jobId,lease});
  if (frozen.kind !== 'found') assert.fail('No frozen input');
  const access = host.journal.createPiAccessJob({principalId,idempotencyKey:randomUUID(),profile:DEFAULT_INFERENCE_PROFILE});
  if (access.kind !== 'created') assert.fail('No synthetic access job');
  const accessLease = {ownerToken:randomUUID(),claimToken:randomUUID()};
  host.journal.claimPiAccessJob({jobId:access.job.jobId,expectedRevision:0,...accessLease});
  const profileFingerprint = fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE);
  const checkedAt = new Date(Date.now()-1000).toISOString(); const expiresAt = new Date(Date.now()+120_000).toISOString();
  const accountFingerprint = 'a'.repeat(64);
  const accessResult = host.journal.completePiAccessJob({jobId:access.job.jobId,expectedRevision:1,lease:accessLease,checkedAt,expiresAt,
    result:{kind:'passed',provider:DEFAULT_INFERENCE_PROFILE.provider,requestedProfile:DEFAULT_INFERENCE_PROFILE,profileFingerprint,accountFingerprint,
      effectiveProfile:{provider:DEFAULT_INFERENCE_PROFILE.provider,api:DEFAULT_INFERENCE_PROFILE.api,model:DEFAULT_INFERENCE_PROFILE.model,
        providerThinkingLevel:DEFAULT_INFERENCE_PROFILE.reasoningEffort,reasoningEvidence:'sdk-payload-and-response'},
      measuredUsage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0}}});
  assert.equal(accessResult.kind,'updated');
  const receipt = {jobId:access.job.jobId,resultKind:'passed',provider:DEFAULT_INFERENCE_PROFILE.provider,
    profileFingerprint,accountFingerprint,checkedAt,expiresAt};
  const completed = host.journal.completeRunPreflightJob({runId,jobId:started.job.jobId,expectedRevision:claimed.job.revision,lease,
    evaluation:{fence:frozen.fence,result:{kind:'passed',checkedAt,checks:[
      'configuration','configuration-version','world-snapshot','prepared-contexts','catalog-eligibility','inference-profile',
      'pi-sdk','pi-profile','provider-authentication','pi-runtime','icm-memory','budget','provider-access-check','participant-availability','voice',
    ].map((checkId)=>({kind:'passed',checkId,code:`${checkId}-passed`}))},
      evidence:{provider:receipt.provider,profileFingerprint,accountFingerprint,accessReceipt:receipt}}});
  assert.equal(completed.kind,'updated');
  return {principalId,preflightJobId:started.job.jobId,state};
}

test('step admite una convocatoria inicial durable por meta, con inbox vacío y sin alterar el Escenario',async()=>{
  const fixture=await setup();const host=hostFromFixture(fixture);const runId=registerAdditionalRun(fixture,host,false,true);
  try{
    const running=host.journal.readWorldLifecycle({runId});assert.ok(running);
    assert.equal(host.journal.setWorldLifecycle({runId,expectedWorldRevision:running.worldRevision,
      expectedConfigRevision:running.configRevision,target:'paused'}),'updated');
    const authorization=await authorizeSyntheticStep(host,runId);
    const before=host.journal.loadWorld({runId});assert.ok(before);
    const accepted=host.journal.applyRunLifecycleCommand({principalId:authorization.principalId,idempotencyKey:randomUUID(),runId,
      expectedLifecycleRevision:authorization.state.lifecycleRevision,expectedConfigRevision:authorization.state.configRevision,
      expectedWorldRevision:authorization.state.worldRevision,expectedStructureRevision:host.journal.readDramaticStructure({runId})?.structureRevision,
      command:{kind:'step'},preflightJobId:authorization.preflightJobId});
    assert.equal(accepted.kind,'accepted');if(accepted.kind!=='accepted')assert.fail('El step no fue admitido');
    const begun=host.journal.beginCoordinatorPulse({runId});
    assert.equal(begun.kind,'started');if(begun.kind!=='started')assert.fail('El step no abrió su pulso');
    assert.equal(begun.pulse.cause.kind,'actorActivation');
    assert.deepEqual(begun.pulse.cause.trigger,{kind:'initial-goal'});
    assert.equal(begun.pulse.lifecycleRevision,accepted.state.lifecycleRevision);
    assert.equal(begun.jobs.length,1);
    assert.deepEqual(begun.jobs[0]?.perceptionIds,[]);
    assert.equal(begun.jobs[0]?.activation?.trigger.kind,'initial-goal');
    assert.equal(host.journal.readRunStepJob({runId,jobId:accepted.job.jobId})?.pulseId,begun.pulse.pulseId);
    assert.deepEqual(host.journal.loadWorld({runId}),before,'la convocatoria técnica no modifica el Escenario');
    const inspect=new DatabaseSync(join(fixture.directory,'world.sqlite'));
    try{
      assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM actor_activation_invitations WHERE state=\'assigned\'').get()?.count,1);
      assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM world_perceptions WHERE run_id=?').get(runId)?.count,0);
    }finally{inspect.close();}
  }finally{host.close();rmSync(fixture.directory,{recursive:true,force:true});}
});

test('step sin actores elegibles se completa como no-op sin dejar un job abierto ni crear un pulso',async()=>{
  const fixture=await setup();const host=hostFromFixture(fixture);const runId=registerAdditionalRun(fixture,host,false,false);
  let runtime:Awaited<ReturnType<typeof createRepresentationRuntime>>|undefined;
  try{
    const running=host.journal.readWorldLifecycle({runId});assert.ok(running);
    assert.equal(host.journal.setWorldLifecycle({runId,expectedWorldRevision:running.worldRevision,
      expectedConfigRevision:running.configRevision,target:'paused'}),'updated');
    const authorization=await authorizeSyntheticStep(host,runId);
    const accepted=host.journal.applyRunLifecycleCommand({principalId:authorization.principalId,idempotencyKey:randomUUID(),runId,
      expectedLifecycleRevision:authorization.state.lifecycleRevision,expectedConfigRevision:authorization.state.configRevision,
      expectedWorldRevision:authorization.state.worldRevision,expectedStructureRevision:host.journal.readDramaticStructure({runId})?.structureRevision,
      command:{kind:'step'},preflightJobId:authorization.preflightJobId});
    assert.equal(accepted.kind,'accepted');if(accepted.kind!=='accepted')assert.fail('El step no fue admitido');
    runtime=await createRepresentationRuntime({host,icmBinaryPath:'/host/not-needed/icm'});
    assert.equal(await runtime.scheduleRun({runId}),true);
    await runtime.waitForIdle();
    const step=host.journal.readRunStepJob({runId,jobId:accepted.job.jobId});
    assert.equal(step?.pulseId,null);assert.equal(step?.state,'succeeded');
    assert.equal(host.journal.readWorldLifecycle({runId})?.lifecycle,'paused');
    assert.equal(host.journal.listCoordinatorPulseTargets().some((target)=>target.runId===runId),false);
  }finally{
    if(runtime!==undefined)await runtime.close();else host.close();
    rmSync(fixture.directory,{recursive:true,force:true});
  }
});

test('cerrar una corrida terminaliza convocatorias iniciales pendientes y en curso',async()=>{
  const fixture=await setup();const host=hostFromFixture(fixture);
  try{
    const admitInitialGoalByStep=async(runId:RunId)=>{
      const running=host.journal.readWorldLifecycle({runId});assert.ok(running);
      assert.equal(host.journal.setWorldLifecycle({runId,expectedWorldRevision:running.worldRevision,
        expectedConfigRevision:running.configRevision,target:'paused'}),'updated');
      const authorization=await authorizeSyntheticStep(host,runId);
      const accepted=host.journal.applyRunLifecycleCommand({principalId:authorization.principalId,idempotencyKey:randomUUID(),runId,
        expectedLifecycleRevision:authorization.state.lifecycleRevision,expectedConfigRevision:authorization.state.configRevision,
        expectedWorldRevision:authorization.state.worldRevision,expectedStructureRevision:host.journal.readDramaticStructure({runId})?.structureRevision,
        command:{kind:'step'},preflightJobId:authorization.preflightJobId});
      assert.equal(accepted.kind,'accepted');if(accepted.kind!=='accepted')assert.fail('No se admitió step para convocar la meta inicial');
    };
    const pendingRunId=registerAdditionalRun(fixture,host,false,true);
    await admitInitialGoalByStep(pendingRunId);
    const pendingState=host.journal.readWorldLifecycle({runId:pendingRunId});assert.ok(pendingState);
    assert.equal(host.journal.setWorldLifecycle({runId:pendingRunId,expectedWorldRevision:pendingState.worldRevision,
      expectedConfigRevision:pendingState.configRevision,target:'closed'}),'updated');

    const runningRunId=registerAdditionalRun(fixture,host,false,true);
    await admitInitialGoalByStep(runningRunId);
    const pulse=host.journal.beginCoordinatorPulse({runId:runningRunId});
    assert.equal(pulse.kind,'started');if(pulse.kind!=='started')assert.fail('No se inició la convocatoria inicial');
    const runningState=host.journal.readWorldLifecycle({runId:runningRunId});assert.ok(runningState);
    assert.equal(host.journal.setWorldLifecycle({runId:runningRunId,expectedWorldRevision:runningState.worldRevision,
      expectedConfigRevision:runningState.configRevision,target:'closed'}),'updated');

    const inspect=new DatabaseSync(join(fixture.directory,'world.sqlite'));
    try{
      assert.deepEqual({ ...inspect.prepare(`SELECT state,failure_reason FROM actor_activation_causes WHERE run_id=?`).get(pendingRunId) },
        {state:'blocked',failure_reason:'run-closed'});
      assert.deepEqual({ ...inspect.prepare(`SELECT state,failure_reason FROM actor_activation_invitations WHERE run_id=?`).get(pendingRunId) },
        {state:'blocked',failure_reason:'run-closed'});
      assert.deepEqual({ ...inspect.prepare(`SELECT state FROM coordinator_pulses WHERE run_id=?`).get(runningRunId) },{state:'blocked'});
      assert.deepEqual({ ...inspect.prepare(`SELECT state,failure_code FROM actor_turn_jobs WHERE run_id=?`).get(runningRunId) },
        {state:'blocked',failure_code:'job-inactive'});
      assert.deepEqual({ ...inspect.prepare(`SELECT state,failure_reason FROM actor_activation_causes WHERE run_id=?`).get(runningRunId) },
        {state:'blocked',failure_reason:'run-closed'});
      assert.deepEqual({ ...inspect.prepare(`SELECT state,failure_reason FROM actor_activation_invitations WHERE run_id=?`).get(runningRunId) },
        {state:'blocked',failure_reason:'run-closed'});
    }finally{inspect.close();}
    assert.equal(host.journal.listCoordinatorPulseTargets().some((target)=>target.runId===pendingRunId||target.runId===runningRunId),false,
      'el cierre no deja causas técnicas recuperables en una corrida terminal');
  }finally{host.close();rmSync(fixture.directory,{recursive:true,force:true});}
});

test('step durable compone preflight fresco, ICM y actuación SDK local; segunda causa permanece sin inferencia',realIcmOptions,async()=>{
  assert.ok(realIcmBinary);
  const fixture = await setup();
  const host = hostFromFixture(fixture);
  const runId = registerAdditionalRun(fixture,host);
  const stats = {requests:0,recallResults:0,disposed:0};
  const runtime = await createRepresentationRuntime({host,icmBinaryPath:realIcmBinary,
    testTransport:controlledTransport({fixture,host,runId,stats})});
  try {
    const beforeSecond = host.journal.loadWorld({runId}); assert.ok(beforeSecond);
    host.journal.commitHumanIntervention({runId,participantId:'visitante-prueba',expectedRevision:beforeSecond.revision,idempotencyKey:randomUUID(),
      request:{kind:'speech',recipientCharacterIds:[actorId],channelId:'00000000-0000-4000-8000-000000000104',
        content:{kind:'speech',text:'Segunda causa diferida.'}}});
    runtime.scheduleDelivery({runId,actorIds:[actorId]});
    await runtime.waitForIdle();
    const current = host.journal.readWorldLifecycle({runId}); assert.ok(current);
    host.journal.setWorldLifecycle({runId,expectedWorldRevision:current.worldRevision,expectedConfigRevision:current.configRevision,target:'paused'});
    const authorization = await authorizeSyntheticStep(host,runId);
    const {createRunLifecycleApplication} = await import('../src/application/run-lifecycle.ts');
    const application = createRunLifecycleApplication({journal:host.journal,runtime,
      preflights:{readJob:({runId,jobId})=>{
        const result = host.journal.readRunPreflightJob({runId,jobId});
        return result.kind === 'found' ? result.document : undefined;
      }}});
    const request = {principalId:authorization.principalId,idempotencyKey:randomUUID(),runId,
      expectedConfigurationRevision:authorization.state.configRevision,expectedWorldRevision:authorization.state.worldRevision,
      expectedStructureRevision:host.journal.readDramaticStructure({runId})!.structureRevision,
      expectedLifecycleRevision:authorization.state.lifecycleRevision,command:{kind:'step',preflightJobId:authorization.preflightJobId}};
    const accepted = await application.controlRun(request);
    if (accepted.kind !== 'accepted') assert.fail(`No accepted step: ${accepted.kind}`);
    await runtime.waitForIdle();
    const job = application.readStepJob({runId,jobId:accepted.job.jobId});
    assert.equal(job?.state,'succeeded');
    assert.ok(job?.pulseId);
    assert.equal(host.journal.readWorldLifecycle({runId})?.lifecycle,'paused');
    assert.equal(stats.requests,3);
    assert.equal(stats.recallResults,1);
    const firstJob = host.journal.listActorTurnJobsForPulse({runId,pulseId:job.pulseId})[0];
    assert.equal(firstJob?.state,'accepted');
    assert.equal(firstJob?.perceptionIds.length,1);
    const replay = await application.controlRun(request);
    assert.equal(replay.kind,'accepted');
    if (replay.kind === 'accepted') assert.equal(replay.job.jobId,job.jobId);
    await runtime.waitForIdle();
    assert.equal(stats.requests,3,'replay/entregas no despachan otra causa');
  } finally {await runtime.close();rmSync(fixture.directory,{recursive:true,force:true});}
});

for(const scenario of [
  {name:'ejecución continua cruza ventanas sin actores y publica dos actuaciones',mode:'continuous',humanReply:false,offsets:[1_000,2_000]},
  {name:'step alcanza una rutina y vuelve a pausa tras un único pulso',mode:'step',humanReply:false,offsets:[1_000]},
  {name:'respuesta pendiente se procesa antes de salir de la ventana disponible',mode:'continuous',humanReply:true,offsets:[1_000,1_000,2_000]},
] as const) {
  test(`rutina integrada: ${scenario.name}`,realIcmOptions,async()=>{
    assert.ok(realIcmBinary);
    const fixture=await setup();const host=hostFromFixture(fixture);
    const runId=registerAdditionalRun(fixture,host,false,false,[[1_000,1_500],[2_000,2_500]]);
    const initial=host.journal.loadWorld({runId});assert.ok(initial);
    const stats={requests:0,recallResults:0,disposed:0};
    const actingTimes:number[]=[];const actorContexts:string[]=[];const notifications:string[]=[];
    let replied=false;
    const runtime=await createRepresentationRuntime({host,icmBinaryPath:realIcmBinary,
      testTransport:controlledTransport({fixture,host,runId,stats,
        onActorPrompt({systemPrompt}){
          const snapshot=host.journal.loadWorld({runId});assert.ok(snapshot);
          actingTimes.push(snapshot.clock.instant);actorContexts.push(systemPrompt);
        },
        actionForPrompt(){
          const snapshot=host.journal.loadWorld({runId});assert.ok(snapshot);
          const knowledge=host.journal.readActorKnowledge({runId,actorId,throughWorldSeq:snapshot.seq});assert.ok(knowledge);
          const channel=knowledge.knowledge.bindings.find((binding)=>binding.kind==='channel');assert.ok(channel);
          return WorldActorActionSchema.parse({kind:'communicate',channelHandle:channel.handle,audienceHandles:[],
            content:{kind:'speech',text:`Intervención sintética de rutina ${actingTimes.length}.`}});
        }}),
      onWorldCommitted(event){
        notifications.push(...event.eventIds);
        if(!scenario.humanReply||replied)return;
        const snapshot=host.journal.loadWorld({runId});assert.ok(snapshot);
        const rows=host.journal.readObservationEvents({runId,fromWorldSeq:snapshot.seq,toWorldSeq:snapshot.seq,
          afterWorldSeq:null,limit:1,communicationsOnly:false});
        if(rows?.[0]?.event.kind!=='communicated')return;
        replied=true;
        const response=host.journal.commitHumanIntervention({runId,participantId:'visitante-prueba',expectedRevision:snapshot.revision,
          idempotencyKey:randomUUID(),request:{kind:'speech',recipientCharacterIds:[],
            channelId:'00000000-0000-4000-8000-000000000104',content:{kind:'speech',text:'Pregunta recibida antes del descanso.'}}});
        assert.equal(response.kind,'stored');
        runtime.scheduleDelivery({runId,actorIds:[actorId]});
      }});
    try{
      let stepJobId:string|undefined;
      if(scenario.mode==='step'){
        const state=host.journal.readWorldLifecycle({runId});assert.ok(state);
        host.journal.setWorldLifecycle({runId,expectedWorldRevision:state.worldRevision,expectedConfigRevision:state.configRevision,target:'paused'});
        const auth=await authorizeSyntheticStep(host,runId);
        const accepted=host.journal.applyRunLifecycleCommand({principalId:auth.principalId,idempotencyKey:randomUUID(),runId,
          expectedLifecycleRevision:auth.state.lifecycleRevision,expectedConfigRevision:auth.state.configRevision,
          expectedWorldRevision:auth.state.worldRevision,command:{kind:'step'},preflightJobId:auth.preflightJobId});
        assert.equal(accepted.kind,'accepted');if(accepted.kind!=='accepted')assert.fail('Paso no admitido');
        stepJobId=accepted.job.jobId;
      }
      assert.equal(await runtime.scheduleRun({runId}),true);
      await withTimeout(runtime.waitForIdle(),10_000);
      assert.deepEqual(actingTimes,scenario.offsets.map((offset)=>initial.clock.instant+offset));
      assert.equal(stats.requests,scenario.offsets.length*3);
      assert.equal(stats.recallResults,scenario.offsets.length);
      assert.match(actorContexts[0]??'',/CONVOCATORIA TÉCNICA POR/);
      assert.ok(actorContexts.every((context)=>!context.includes('SECRET_PRIVATE_OTHER_MEMORY')));
      const conversation=createRunObservationApplication({journal:host.journal}).readConversations({runId});
      assert.equal(conversation.kind,'found');if(conversation.kind!=='found')assert.fail('Conversación ausente');
      assert.equal(conversation.value.kind,'conversation-page');if(conversation.value.kind!=='conversation-page')assert.fail('Página de conversación inválida');
      const actorLines=conversation.value.items.filter((line)=>line.speaker.kind==='character');
      assert.equal(actorLines.length,scenario.offsets.length);
      assert.ok(actorLines.every((line)=>line.content.kind==='speech'&&line.content.text.startsWith('Intervención sintética de rutina')));
      const snapshot=host.journal.loadWorld({runId});assert.ok(snapshot);
      const events=host.journal.readObservationEvents({runId,fromWorldSeq:initial.seq,toWorldSeq:snapshot.seq,
        afterWorldSeq:null,limit:100,communicationsOnly:false});
      const advances=events?.filter((row)=>row.event.kind==='clockAdvanced')??[];
      assert.equal(advances.length,scenario.mode==='step'?1:4);
      assert.ok(advances.every((row)=>notifications.includes(row.event.id)),'Cada avance confirmado invalida la vista pública');
      if(stepJobId!==undefined){
        const job=host.journal.readRunStepJob({runId,jobId:stepJobId});
        assert.equal(job?.state,'succeeded');assert.ok(job?.pulseId);
        assert.equal(host.journal.readWorldLifecycle({runId})?.lifecycle,'paused');
      }
      const requestsBefore=stats.requests;
      await runtime.recover();await runtime.waitForIdle();
      assert.equal(stats.requests,requestsBefore);
      assert.deepEqual(host.journal.loadWorld({runId}),snapshot,'Recuperar conserva reloj, hechos y conversación');
    }finally{await runtime.close();rmSync(fixture.directory,{recursive:true,force:true});}
  });
}


test('un ciclo editorial sin fronteras actorales termina tras un avance y no abre sesiones ni consume inferencia',async()=>{
  const fixture=await setup();const host=hostFromFixture(fixture);
  const runId=registerAdditionalRun(fixture,host,false,false,undefined,false,{
    routine:{kind:'always'},maxAdvanceMs:86_400_000,
    dayNight:{dayStartsAtMinute:420,nightStartsAtMinute:1260,disambiguation:'compatible'},
  });
  const before=host.journal.loadWorld({runId});assert.ok(before);
  const opened={actor:0,continuista:0,director:0};let committed=0;
  const runtime=await createRepresentationRuntime({host,icmBinaryPath:join(fixture.directory,'icm-must-not-run'),
    onWorldCommitted({runId:committedRunId}){assert.equal(committedRunId,runId);committed+=1;},
    testTransport:{kind:'controlled-test-transport',name:'No inference for an editorial clock boundary',
      actorSessionFactory:async()=>{opened.actor+=1;throw new Error('An editorial phase cannot summon an actor');},
      continuistaSessionFactory:async()=>{opened.continuista+=1;throw new Error('No actor proposal to review');},
      directorSessionFactory:async()=>{opened.director+=1;throw new Error('No pulse to direct');},
    }});
  try{
    assert.equal(await withTimeout(runtime.scheduleRun({runId}),2_000),true);
    await withTimeout(runtime.waitForIdle(),2_000);
    const after=host.journal.loadWorld({runId});assert.ok(after);
    assert.equal(committed,1,'the scheduler must not spin through infinitely recurring empty days');
    assert.equal(after.revision,before.revision+1);
    assert.equal(after.seq,before.seq+1);
    const events=host.journal.readObservationEvents({runId,fromWorldSeq:before.seq+1,toWorldSeq:after.seq,
      afterWorldSeq:null,limit:10,communicationsOnly:false});
    assert.deepEqual(events?.map(row=>row.event.kind),['clockAdvanced']);
    assert.deepEqual(opened,{actor:0,continuista:0,director:0});
    const budget=host.journal.readRunModelTimeBudget({runId});assert.ok(budget);
    assert.equal(budget.runCallsUsed,0);assert.equal(budget.reservedPiCalls,0);
    assert.equal(budget.wallTimeReservedMs,0);assert.equal(budget.wallTimeMeasuredMs,0);
  }finally{await runtime.close();rmSync(fixture.directory,{recursive:true,force:true});}
});

test('rutina diaria local llega a Pi SDK e ICM reales y publica un parlamento aprobado sin repetir al recuperar',realIcmOptions,async()=>{
  assert.ok(realIcmBinary);
  const fixture=await setup();const host=hostFromFixture(fixture);
  const clock=fixture.configuration.worldSnapshot.clock;
  assert.equal(clock.convention.kind,'fixedOffset');
  if(clock.convention.kind!=='fixedOffset')assert.fail('El fixture debe declarar offset explícito');
  const minuteMs=60_000;
  const localMinute=((Math.floor(clock.instant/minuteMs)+clock.convention.offsetMinutes)%1440+1440)%1440;
  const fromMinute=(localMinute+1)%1440;
  const toMinute=(localMinute+2)%1440;
  const expectedAt=(Math.floor(clock.instant/minuteMs)+1)*minuteMs;
  const runId=registerAdditionalRun(fixture,host,false,false,undefined,true,{maxAdvanceMs:minuteMs,
    routine:{kind:'daily',defaultState:'unavailable',disambiguation:'compatible',windows:[{fromMinute,toMinute,state:'available'}]}});
  const stats={requests:0,recallResults:0,disposed:0};const actingTimes:number[]=[];const contexts:string[]=[];
  const runtime=await createRepresentationRuntime({host,icmBinaryPath:realIcmBinary,
    testTransport:controlledTransport({fixture,host,runId,stats,
      onActorPrompt({systemPrompt}){contexts.push(systemPrompt);const world=host.journal.loadWorld({runId});assert.ok(world);actingTimes.push(world.clock.instant);},
      actionForPrompt(){
        const world=host.journal.loadWorld({runId});assert.ok(world);
        const knowledge=host.journal.readActorKnowledge({runId,actorId,throughWorldSeq:world.seq});assert.ok(knowledge);
        const channel=knowledge.knowledge.bindings.find(binding=>binding.kind==='channel');assert.ok(channel);
        return WorldActorActionSchema.parse({kind:'communicate',channelHandle:channel.handle,audienceHandles:[],
          content:{kind:'speech',text:'Intervención sintética al comenzar mi horario diario.'}});
      }})});
  try{
    assert.equal(await runtime.scheduleRun({runId}),true);
    await withTimeout(runtime.waitForIdle(),10_000);
    assert.deepEqual(actingTimes,[expectedAt]);
    assert.equal(stats.requests,3,'dos requests de actor y una revisión de Continuista');
    assert.equal(stats.recallResults,1,'la actuación consulta la memoria ICM real propia');
    assert.match(contexts[0]??'',/CONVOCATORIA TÉCNICA POR/);
    assert.ok(contexts.every(context=>!context.includes('SECRET_PRIVATE_OTHER_MEMORY')));
    const conversation=createRunObservationApplication({journal:host.journal}).readConversations({runId});
    assert.equal(conversation.kind,'found');
    if(conversation.kind!=='found')assert.fail('Falta conversación');
    assert.equal(conversation.value.kind,'conversation-page');
    if(conversation.value.kind!=='conversation-page')assert.fail('Falta página');
    const actorLines=conversation.value.items.filter(line=>line.speaker.kind==='character');
    assert.equal(actorLines.length,1);
    assert.deepEqual(actorLines[0]?.content,{kind:'speech',text:'Intervención sintética al comenzar mi horario diario.'});
    assert.equal(host.journal.loadWorld({runId})?.clock.instant,expectedAt+minuteMs);
    const before=host.journal.loadWorld({runId});
    await runtime.recover();await withTimeout(runtime.waitForIdle(),10_000);
    assert.equal(stats.requests,3);
    assert.deepEqual(host.journal.loadWorld({runId}),before);
  }finally{await runtime.close();rmSync(fixture.directory,{recursive:true,force:true});}
});

test('circunstancia física confirmada llega a memoria y Actor/Continuista publican una conversación',realIcmOptions,async()=>{
  assert.ok(realIcmBinary);
  const fixture=await setup();const host=hostFromFixture(fixture);
  const runId=registerAdditionalRun(fixture,host,false,false,undefined,true);
  const initial=host.journal.loadWorld({runId});assert.ok(initial);
  const stats={requests:0,recallResults:0,disposed:0};const contexts:string[]=[];
  const runtime=await createRepresentationRuntime({host,icmBinaryPath:realIcmBinary,
    testTransport:controlledTransport({fixture,host,runId,stats,onActorPrompt({systemPrompt,prompt}){contexts.push(systemPrompt+prompt.text);},
      actionForPrompt(){
        const snapshot=host.journal.loadWorld({runId});assert.ok(snapshot);
        const knowledge=host.journal.readActorKnowledge({runId,actorId,throughWorldSeq:snapshot.seq});assert.ok(knowledge);
        const channel=knowledge.knowledge.bindings.find(item=>item.kind==='channel');assert.ok(channel);
        return WorldActorActionSchema.parse({kind:'communicate',channelHandle:channel.handle,audienceHandles:[],
          content:{kind:'speech',text:'La luz cambió; voy a observar antes de decidir.'}});
      }})});
  const notices:string[]=[];
  const application=createCircumstanceApplication({journal:host.journal,onCommitted(event){notices.push(...event.eventIds);
    runtime.scheduleDelivery({runId:event.runId,actorIds:event.actorIds});}});
  try{
    assert.equal(await runtime.scheduleRun({runId}),true);await runtime.waitForIdle();
    assert.equal(stats.requests,0);
    const command={runId,principalId:'secret-direction-principal',idempotencyKey:randomUUID(),operationId:randomUUID(),
      expectedWorldRevision:initial.revision,expectedDirectionRevision:0,payload:{kind:'changeCircumstance',scope:{kind:'run'},
        operation:{kind:'setLighting',placeId:'sala',level:'dim'}}};
    const result=application.apply(command);assert.equal(result.kind,'stored');
    if(result.kind!=='stored'||result.receipt.effect.kind!=='applied')assert.fail('Efecto no confirmado');
    await withTimeout(runtime.waitForIdle(),10_000);
    assert.equal(stats.requests,3);assert.equal(stats.recallResults,1);
    assert.equal(contexts.length,1);assert.match(contexts[0]??'',/iluminación|tenue/);
    assert.doesNotMatch(contexts[0]??'',/secret-direction-principal|changeCircumstance|setLighting|SECRET_PRIVATE_OTHER_MEMORY/);
    const conversation=createRunObservationApplication({journal:host.journal}).readConversations({runId});
    if(conversation.kind!=='found'||conversation.value.kind!=='conversation-page')assert.fail('No conversación');
    assert.equal(conversation.value.items.length,1);
    assert.deepEqual(conversation.value.items[0]?.content,{kind:'speech',text:'La luz cambió; voy a observar antes de decidir.'});
    assert.deepEqual(notices,result.receipt.effect.eventIds);
    const final=host.journal.loadWorld({runId});assert.ok(final);
    assert.equal(final.revision,initial.revision+2,'un cambio físico y una actuación confirmada');
    assert.equal(application.apply(command).kind,'existing');await runtime.waitForIdle();
    assert.equal(stats.requests,3);assert.deepEqual(host.journal.loadWorld({runId}),final);
    assert.deepEqual(notices,result.receipt.effect.eventIds,'replay no notifica ni actúa otra vez');
  }finally{await runtime.close();rmSync(fixture.directory,{recursive:true,force:true});}
});
