import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { test } from 'node:test';
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

function registerAdditionalRun(fixture: Fixture, host: ReturnType<typeof openLocalHost>, withIntervention = true) {
  const freshRunId = RunIdSchema.parse(randomUUID());
  const configuration = ReadyRunConfigurationSchema.parse({
    ...fixture.configuration,
    budget:{...fixture.configuration.budget,maxPiCallsPerPulse:8},
    runId: freshRunId,
    worldSnapshot: {
      ...fixture.configuration.worldSnapshot,
      runId: freshRunId,
      entities: fixture.configuration.worldSnapshot.entities.map((entity) => entity.kind === 'character'
        ? { ...entity, mind: { ...entity.mind, experiences: entity.mind.experiences.map((experience) => ({ ...experience, runId: freshRunId })) } }
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

function controlledTransport(input: { fixture: Fixture; host: ReturnType<typeof openLocalHost>; runId: RunId; stats: { requests: number; recallResults: number; disposed: number } }) {
  const actorSessionFactory = async (sessionInput: CreatePiSessionInput) => {
    assert.deepEqual(sessionInput.identity, { kind: 'actor', characterId: actorId });
    const cwd = join(input.fixture.directory, `controlled-sdk-${input.runId}`);
    mkdirSync(cwd, { recursive: true });
    const agentDir = join(cwd, 'agent');
    const manager = SessionManager.create(cwd, join(cwd, 'sessions'));
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
        const base = input.host.journal.loadActorPiSession({ runId: input.runId, actorId });
        assert.ok(base);
        assert.ok(prompt.inputCut);
        const inputCut = prompt.inputCut;
        const turnBase = { ...base, sessionRevision: RevisionSchema.parse(base.sessionRevision) };
        const turnId = randomUUID();
        let lastRequest: PiRequestReference | undefined;
        await sessionInput.requestPort.recordCheckpointCandidate({ identity: sessionInput.identity,
          purpose: { kind: 'job-base', baseScope: prompt.scope }, snapshot: { ...checkpoint(), candidateLeafId: null } });
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
            const requestNumber = input.stats.requests;
            const toolCall = requestNumber === 1
              ? { type: 'toolCall' as const, id: 'local-recall', name: 'recall_memory', arguments: { query: 'mensaje recibido' } }
              : requestNumber === 2
                ? { type: 'toolCall' as const, id: 'local-proposal', name: 'propose_action', arguments: { action: { kind: 'wait', durationMs: 1 } } }
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
        await session.agent.prompt(prompt.text);
        input.stats.recallResults += session.messages.filter((message) => message.role === 'toolResult'
          && message.toolName === 'recall_memory' && !message.isError).length;
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
