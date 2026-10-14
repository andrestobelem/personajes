import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import { createAssistantMessageEventStream, normalizeContext, Type, type Api, type AssistantMessage, type Model, type SimpleStreamOptions } from '@earendil-works/pi-ai';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import {
  createBudgetedStreamFunction,
  createPiSession,
  openIdentitySessionManager,
  PiRuntime,
  isPiAdapterFailure,
  projectPiSessionEvent,
  type PiCheckpointCandidate,
  type PiCustomTool,
  type PiIdentity,
  type PiRequestPort,
  type PiRequestScope,
  type PiStreamFunction,
} from '../src/adapters/pi.ts';
import { DEFAULT_INFERENCE_PROFILE, LEGACY_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import {
  CharacterIdSchema, FictionalInstantSchema, HashSchema, JobIdSchema, PerceptionIdSchema,
  PulseIdSchema, RevisionSchema, RunIdSchema, WorldSeqSchema,
} from '../src/domain/values.ts';

const runId = RunIdSchema.parse('00000000-0000-4000-8000-000000000101');
const pulseId = PulseIdSchema.parse('00000000-0000-4000-8000-000000000102');
const jobId = JobIdSchema.parse('00000000-0000-4000-8000-000000000103');
const scope: PiRequestScope = { runId, pulseId, jobId, generation: 0 };
const identity: PiIdentity = { kind: 'actor', characterId: CharacterIdSchema.parse('maxwell-smart') };
const actorTools = [
  {
    name: 'recall_memory',
    label: 'Recuperar memoria',
    description: 'Consulta recuerdos propios autorizados.',
    parameters: Type.Object({ query: Type.String() }),
    async execute() { return { content: [], details: undefined }; },
  },
  {
    name: 'propose_action',
    label: 'Proponer acción',
    description: 'Registra un intento tipado del actor.',
    parameters: Type.Object({ action: Type.String() }),
    async execute() { return { content: [], details: undefined }; },
  },
] satisfies readonly PiCustomTool[];

test('un checkpoint initial posterior a crash crea otra sesión y no adopta el tail anterior', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-initial-recovery-'));
  const paths = {
    cwd: join(directory, 'cwd'),
    agentDir: join(directory, 'agent'),
    sessionDir: join(directory, 'sessions'),
  };
  mkdirSync(paths.cwd, { recursive: true });
  mkdirSync(paths.agentDir, { recursive: true });
  mkdirSync(paths.sessionDir, { recursive: true });
  try {
    const abandoned = SessionManager.create(paths.cwd, paths.sessionDir);
    abandoned.appendMessage({ role: 'user', content: 'Turno incompleto.', timestamp: 1 });
    const abandonedLeaf = abandoned.appendCustomEntry('test.unaccepted-tail', { message: 'no aceptar' });
    const abandonedPath = abandoned.getSessionFile();
    assert.ok(abandonedPath);

    const recovered = openIdentitySessionManager({
      paths,
      checkpoint: { kind: 'initial', previousSessionPath: abandonedPath },
    });
    assert.notEqual(recovered.getSessionId(), abandoned.getSessionId());
    assert.notEqual(recovered.getSessionFile(), abandonedPath);
    assert.notEqual(recovered.getLeafId(), abandonedLeaf);
    assert.equal(recovered.getEntry(abandonedLeaf), undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('un checkpoint leaf hace branch desde el tail hasta el leaf aceptado antes de reabrir', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-leaf-recovery-'));
  const paths = {
    cwd: join(directory, 'cwd'),
    agentDir: join(directory, 'agent'),
    sessionDir: join(directory, 'sessions'),
  };
  mkdirSync(paths.cwd, { recursive: true });
  mkdirSync(paths.agentDir, { recursive: true });
  mkdirSync(paths.sessionDir, { recursive: true });
  try {
    const original = SessionManager.create(paths.cwd, paths.sessionDir);
    const acceptedLeaf = original.appendMessage({ role: 'user', content: 'Turno aceptado.', timestamp: 1 });
    const unacceptedTail = original.appendCustomEntry('test.unaccepted-tail');
    const sessionPath = original.getSessionFile();
    assert.ok(sessionPath);

    const recovered = openIdentitySessionManager({
      paths,
      checkpoint: { kind: 'leaf', sessionPath, committedLeafId: acceptedLeaf },
    });
    assert.equal(recovered.getLeafId() === unacceptedTail, false);
    assert.equal(recovered.getEntry(unacceptedTail)?.parentId, acceptedLeaf);
    const recoveryFence = recovered.getEntry(recovered.getLeafId() ?? '');
    assert.equal(recoveryFence?.type, 'custom');
    if (recoveryFence?.type === 'custom') {
      assert.equal(recoveryFence.customType, 'personajes.recovery-fence');
      assert.equal(recoveryFence.parentId, acceptedLeaf);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('PiRuntime carga el modelo estático Sol exacto y low sin autenticación ni red', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-runtime-'));
  try {
    const runtime = await PiRuntime.create({ privateDataRoot: directory });
    const model = runtime.modelRuntime.getModel('openai-codex', 'gpt-6.1-sol');
    assert.ok(model);
    assert.equal(model.provider, 'openai-codex');
    assert.equal(model.api, 'openai-codex-responses');
    assert.equal(model.thinkingLevelMap?.low, 'low');
    assert.equal(runtime.modelRuntime.hasConfiguredAuth('openai-codex'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('la factory rechaza crear una sesión si el host aún no tiene OAuth', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-auth-gate-'));
  try {
    const runtime = await PiRuntime.create({ privateDataRoot: directory });
    await assert.rejects(
      createPiSession({
        runtime,
        runId,
        identity,
        systemPrompt: 'Contexto explícito del actor.',
        checkpoint: { kind: 'fresh' },
        preparedContextHash: 'a'.repeat(64),
        sessionRevision: 0,
        tools: actorTools,
        adminToolAllowlist: {},
        requestPort: makePort(),
      }),
      (error: unknown) => isPiAdapterFailure(error) && error.code === 'OAUTH_REQUIRED',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('el adapter publica eventos con kind y omite argumentos de tools del SDK', () => {
  assert.deepEqual(projectPiSessionEvent({ type: 'agent_start' }), { kind: 'agent_start' });
  assert.deepEqual(
    projectPiSessionEvent({
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'recall_memory',
      args: { query: 'dato privado' },
    }),
    { kind: 'tool_execution_start', toolCallId: 'call-1', toolName: 'recall_memory' },
  );
  assert.equal(isPiAdapterFailure(new Error('un error externo')), false);
  assert.equal(isPiAdapterFailure({ kind: 'piAdapterFailure', code: 'OAUTH_REQUIRED' }), false);
});

test('el SDK Pi activo expone sólo las dos tools directas del actor, sin llamar al modelo', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-sdk-session-'));
  let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
  try {
    const runtime = await PiRuntime.create({ privateDataRoot: directory });
    const model = runtime.modelRuntime.getModel('openai-codex', 'gpt-6.1-sol');
    assert.ok(model);
    assert.equal(runtime.modelRuntime.hasConfiguredAuth('openai-codex'), false);
    const cwd = join(directory, 'actor-cwd');
    const agentDir = join(directory, 'actor-agent');
    const settingsManager = SettingsManager.inMemory({
      retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
      compaction: { enabled: false },
      cacheWarming: 'off',
      enableInstallTelemetry: false,
      enableAnalytics: false,
      defaultThinkingLevel: 'low',
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: 'Contexto privado del actor.',
    });
    await resourceLoader.reload();
    const created = await createAgentSession({
      cwd,
      agentDir,
      modelRuntime: runtime.modelRuntime,
      model,
      thinkingLevel: 'low',
      noTools: 'all',
      tools: ['recall_memory', 'propose_action'],
      customTools: actorTools,
      resourceLoader,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager,
    });
    session = created.session;
    assert.deepEqual([...session.getActiveToolNames()].sort(), ['propose_action', 'recall_memory']);
    assert.deepEqual([...session.getCallableToolNames()].sort(), ['propose_action', 'recall_memory']);
    assert.equal(created.extensionsResult.extensions.length, 0);
    assert.equal(settingsManager.getCacheWarmingMode(), 'off');
  } finally {
    session?.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('el SDK local persiste el mensaje de entrada antes del candidato request y la respuesta antes de asentarse', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-checkpoint-order-'));
  const runtime = await PiRuntime.create({ privateDataRoot: join(directory, 'runtime') });
  const model = runtime.modelRuntime.getModel('openai-codex', 'gpt-6.1-sol');
  assert.ok(model);
  const cwd = join(directory, 'actor-cwd');
  mkdirSync(cwd, { recursive: true });
  const settingsManager = SettingsManager.inMemory({
    retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
    compaction: { enabled: false },
    cacheWarming: 'off',
    enableInstallTelemetry: false,
    enableAnalytics: false,
    defaultThinkingLevel: 'low',
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: join(directory, 'actor-agent'),
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: 'Contexto privado del actor.',
  });
  await resourceLoader.reload();
  const sessionManager = SessionManager.create(cwd, join(directory, 'sessions'));
  const created = await createAgentSession({
    cwd,
    agentDir: join(directory, 'actor-agent'),
    modelRuntime: runtime.modelRuntime,
    model,
    thinkingLevel: 'low',
    noTools: 'all',
    tools: [],
    customTools: [],
    resourceLoader,
    sessionManager,
    settingsManager,
  });
  const requestCandidates: PiCheckpointCandidate[] = [];
  const actorCandidates: unknown[] = [];
  const port: PiRequestPort = {
    reserveNextRequest: () => ({ kind: 'reserved', requestSeq: 0 }),
    transitionReservation() {},
    checkEligibility: () => ({ kind: 'active' }),
    recordCheckpointCandidate(candidate) { requestCandidates.push(candidate); },
    recordActorPiCandidate(candidate) { actorCandidates.push(candidate); },
  };
  const perceptionId = PerceptionIdSchema.parse('00000000-0000-4000-8000-000000000111');
  const inputCut = {
    worldRevision: RevisionSchema.parse(2), worldSeq: WorldSeqSchema.parse(4),
    fictionalAt: FictionalInstantSchema.parse(1_800), perceptionIds: [perceptionId],
  };
  const lease = {
    ownerToken: '00000000-0000-4000-8000-000000000113',
    claimToken: '00000000-0000-4000-8000-000000000114',
  };
  const streamFunction = createBudgetedStreamFunction({
    original: makeFakeTransport(() => {}),
    getScope: () => scope,
    getActorTurnContext: () => ({
      turnId: '00000000-0000-4000-8000-000000000112',
      base: {
        preparedContextHash: HashSchema.parse('a'.repeat(64)),
        profile: DEFAULT_INFERENCE_PROFILE,
        sessionRevision: RevisionSchema.parse(0), committedLeafId: null,
      },
      inputCut,
      lease,
    }),
    identity,
    runId,
    sessionManager,
    port,
  });
  created.session.agent.streamFunction = streamFunction;
  try {
    await created.session.agent.prompt('Texto de control local.');
    const [requestCandidate] = requestCandidates;
    assert.ok(requestCandidate);
    assert.equal(requestCandidates.length, 1);
    assert.equal(requestCandidate.purpose.kind, 'request-input');
    assert.ok(requestCandidate.snapshot.candidateLeafId);
    const inputEntry = sessionManager.getEntry(requestCandidate.snapshot.candidateLeafId);
    const terminalLeafId = sessionManager.getLeafId();
    assert.ok(terminalLeafId);
    const terminalEntry = sessionManager.getEntry(terminalLeafId);
    assert.equal(inputEntry?.type, 'message');
    if (inputEntry?.type === 'message') assert.equal(inputEntry.message.role, 'user');
    assert.equal(terminalEntry?.type, 'message');
    if (terminalEntry?.type === 'message') assert.equal(terminalEntry.message.role, 'assistant');
    assert.notEqual(terminalLeafId, requestCandidate.snapshot.candidateLeafId);
    assert.equal('committedLeafId' in requestCandidate.snapshot, false);
    assert.equal(actorCandidates.length, 1);
    const actorCandidate = z.strictObject({
      kind: z.literal('request-input'), candidateId: z.string().uuid(), turnId: z.string().uuid(),
      runId: RunIdSchema, actorId: CharacterIdSchema, scope: z.unknown(), lease: z.unknown(), base: z.unknown(),
      requestSeq: z.number().int(), candidateLeafId: z.string(), inputCut: z.unknown(),
    }).parse(actorCandidates[0]);
    assert.equal(actorCandidate.kind, 'request-input');
    assert.deepEqual(actorCandidate.lease, lease);
    assert.deepEqual(actorCandidate.inputCut, inputCut);
    assert.equal(actorCandidate.candidateLeafId, requestCandidate.snapshot.candidateLeafId);
  } finally {
    created.session.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('cada ronda reserva una secuencia y completa su transición antes del terminal', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-journal-'));
  const events: string[] = [];
  const requestSequences: number[] = [];
  const checkpointCandidates: PiCheckpointCandidate[] = [];
  const reservations = new Map<number, string>();
  const maxCalls = 3;
  let profileChecks = 0;
  let transportCalls = 0;
  const model = await getStaticModel(directory);
  const fakeTransportOnly = makeFakeTransport((options) => {
    events.push('transport');
    transportCalls += 1;
    assert.equal(options?.maxRetries, 0);
  });
  const sessionManager = SessionManager.inMemory(join(directory, 'private-cwd'));
  const port: PiRequestPort = {
    reserveNextRequest(request) {
      events.push('reserve');
      assert.deepEqual(request.purpose, identity);
      if (request.scope.jobId !== jobId || request.scope.pulseId !== pulseId) throw new Error('unexpected request scope');
      if (requestSequences.length >= maxCalls) return { kind: 'exhausted', scope: 'pulse' };
      const requestSeq = requestSequences.length;
      requestSequences.push(requestSeq);
      reservations.set(requestSeq, 'reserved');
      return { kind: 'reserved', requestSeq };
    },
    transitionReservation(request) {
      events.push(`transition:${request.target}`);
      assert.equal(request.scope.jobId, jobId);
      assert.deepEqual(request.scope, scope);
      assert.equal(reservations.get(request.requestSeq), request.target === 'dispatched' ? 'reserved' : 'dispatched');
      reservations.set(request.requestSeq, request.target);
    },
    checkEligibility(request) {
      assert.deepEqual(request.purpose, identity);
      return { kind: 'active' };
    },
    recordCheckpointCandidate(candidate) {
      events.push(`checkpoint-candidate:${candidate.purpose.kind}`);
      checkpointCandidates.push(candidate);
    },
  };
  const streamFunction = createBudgetedStreamFunction({
    original: fakeTransportOnly,
    getScope: () => scope,
    identity,
    runId,
    sessionManager,
    port,
    async validateBeforeRequest(requestModel, options) {
      profileChecks += 1;
      assert.equal(requestModel.provider, 'openai-codex');
      assert.equal(requestModel.id, 'gpt-6.1-sol');
      assert.equal(requestModel.api, 'openai-codex-responses');
      assert.equal(options?.reasoning, 'low');
    },
  });
  const context = normalizeContext({ messages: [] });
  try {
    const first = await runToMessage(streamFunction, model, context, { maxRetries: 7 });
    assert.equal(first.stopReason, 'stop');
    const second = await runToMessage(streamFunction, model, context);
    const third = await runToMessage(streamFunction, model, context);
    const fourth = await runToMessage(streamFunction, model, context);
    assert.equal(second.stopReason, 'stop');
    assert.equal(third.stopReason, 'stop');
    assert.equal(fourth.stopReason, 'error');
    assert.deepEqual(requestSequences, [0, 1, 2]);
    assert.equal(transportCalls, 3);
    assert.equal(profileChecks, 7);
    const checkpointCandidateIndex = events.indexOf('checkpoint-candidate:request-input');
    const dispatchedIndex = events.indexOf('transition:dispatched');
    const transportIndex = events.indexOf('transport');
    const completedIndex = events.indexOf('transition:completed');
    assert.ok(checkpointCandidateIndex < dispatchedIndex);
    assert.ok(dispatchedIndex < transportIndex);
    assert.ok(transportIndex < completedIndex);
    assert.equal(checkpointCandidates.length, 3);
    for (const [index, candidate] of checkpointCandidates.entries()) {
      assert.equal(candidate.purpose.kind, 'request-input');
      assert.equal(candidate.purpose.request.scope.jobId, jobId);
      assert.equal(candidate.purpose.request.requestSeq, index);
      assert.equal('committedLeafId' in candidate.snapshot, false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('presupuesto agotado y cancelación previa terminan con error Pi sin transporte', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-terminal-'));
  const model = await getStaticModel(directory);
  const sessionManager = SessionManager.inMemory(join(directory, 'private-cwd'));
  let transportCalls = 0;
  const fakeTransportOnly: PiStreamFunction = () => {
    transportCalls += 1;
    return createAssistantMessageEventStream();
  };
  const exhaustedPort = makePort({ reserve: () => ({ kind: 'exhausted', scope: 'pulse' }) });
  const exhausted = createBudgetedStreamFunction({
    original: fakeTransportOnly,
    getScope: () => scope,
    identity,
    runId,
    sessionManager,
    port: exhaustedPort,
  });
  const context = normalizeContext({ messages: [] });
  try {
    const exhaustedMessage = await runToMessage(exhausted, model, context);
    assert.equal(exhaustedMessage.stopReason, 'error');
    assert.deepEqual(exhaustedMessage.content, []);

    const controller = new AbortController();
    controller.abort();
    let reservations = 0;
    const cancelledPort = makePort({ reserve: () => {
      reservations += 1;
      return { kind: 'reserved', requestSeq: 0 };
    } });
    const cancelled = createBudgetedStreamFunction({
      original: fakeTransportOnly,
      getScope: () => scope,
      identity,
      runId,
      sessionManager,
      port: cancelledPort,
    });
    const cancelledMessage = await runToMessage(cancelled, model, context, { signal: controller.signal });
    assert.equal(cancelledMessage.stopReason, 'aborted');
    assert.equal(reservations, 0);
    assert.equal(transportCalls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('el wrapper convierte un perfil/razonamiento incompatible en terminal sin reservar ni llamar al transporte', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-profile-gate-'));
  const model = await getStaticModel(directory);
  const sessionManager = SessionManager.inMemory(join(directory, 'private-cwd'));
  let reservations = 0;
  let transportCalls = 0;
  const gated = createBudgetedStreamFunction({
    original: () => {
      transportCalls += 1;
      return createAssistantMessageEventStream();
    },
    getScope: () => scope,
    identity,
    runId,
    sessionManager,
    port: makePort({ reserve: () => {
      reservations += 1;
      return { kind: 'reserved', requestSeq: 0 };
    } }),
  });
  try {
    const result = await runToMessage(gated, model, normalizeContext({ messages: [] }), { reasoning: 'medium' });
    assert.equal(result.stopReason, 'error');
    assert.deepEqual(result.content, []);
    assert.equal(reservations, 0);
    assert.equal(transportCalls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fallo de checkpoint libera sólo la reserva no enviada; cancelación posterior queda ambigua', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-undispatched-'));
  const model = await getStaticModel(directory);
  const sessionManager = SessionManager.inMemory(join(directory, 'private-cwd'));
  const context = normalizeContext({ messages: [] });
  let transportCalls = 0;
  const transitions: string[] = [];
  let failCheckpoint = true;
  const noCallFakeTransport: PiStreamFunction = () => {
    transportCalls += 1;
    return createAssistantMessageEventStream();
  };
  const failedCheckpointPort = makePort({
    transition: (target) => { transitions.push(target); },
  });
  failedCheckpointPort.recordCheckpointCandidate = () => {
    if (failCheckpoint) throw new Error('test checkpoint failure');
  };
  const failedCheckpoint = createBudgetedStreamFunction({
    original: noCallFakeTransport,
    getScope: () => scope,
    identity,
    runId,
    sessionManager,
    port: failedCheckpointPort,
  });
  try {
    assert.equal((await runToMessage(failedCheckpoint, model, context)).stopReason, 'error');
    assert.deepEqual(transitions, ['undispatched']);
    assert.equal(transportCalls, 0);

    failCheckpoint = false;
    const controller = new AbortController();
    const abortingFakeTransport: PiStreamFunction = () => {
      transportCalls += 1;
      controller.abort();
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'error', reason: 'aborted', error: assistantMessage(model, 'aborted') });
      return stream;
    };
    const cancelledAfterDispatch = createBudgetedStreamFunction({
      original: abortingFakeTransport,
      getScope: () => scope,
      identity,
      runId,
      sessionManager,
      port: failedCheckpointPort,
    });
    assert.equal((await runToMessage(cancelledAfterDispatch, model, context, { signal: controller.signal })).stopReason, 'aborted');
    assert.deepEqual(transitions, ['undispatched', 'dispatched', 'ambiguous']);
    assert.equal(transportCalls, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('una respuesta incierta al marcar dispatched nunca recicla la cuota ni llama al transporte', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-dispatch-uncertain-'));
  const model = await getStaticModel(directory);
  const sessionManager = SessionManager.inMemory(join(directory, 'private-cwd'));
  const transitions: string[] = [];
  let transportCalls = 0;
  const port = makePort({
    transition(target) {
      transitions.push(target);
      if (target === 'dispatched') throw new Error('controlled lost acknowledgement');
    },
  });
  const streamFunction = createBudgetedStreamFunction({
    original: () => {
      transportCalls += 1;
      return createAssistantMessageEventStream();
    },
    getScope: () => scope,
    identity,
    runId,
    sessionManager,
    port,
  });
  try {
    const result = await runToMessage(streamFunction, model, normalizeContext({ messages: [] }));
    assert.equal(result.stopReason, 'error');
    assert.deepEqual(transitions, ['dispatched', 'ambiguous']);
    assert.equal(transportCalls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('excepción y cierre sin evento final del transporte se convierten en respuesta terminal Pi', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-transport-errors-'));
  const model = await getStaticModel(directory);
  const sessionManager = SessionManager.inMemory(join(directory, 'private-cwd'));
  const context = normalizeContext({ messages: [] });
  const ambiguous: string[] = [];
  const port = makePort({ transition: (target) => { ambiguous.push(target); } });
  const throwingFakeTransport: PiStreamFunction = () => {
    throw new Error('TEST ONLY: fake transport exception');
  };
  const throwing = createBudgetedStreamFunction({
    original: throwingFakeTransport,
    getScope: () => scope,
    identity,
    runId,
    sessionManager,
    port,
  });
  const closedFakeTransport: PiStreamFunction = () => {
    const stream = createAssistantMessageEventStream();
    stream.end();
    return stream;
  };
  const closed = createBudgetedStreamFunction({
    original: closedFakeTransport,
    getScope: () => scope,
    identity,
    runId,
    sessionManager,
    port,
  });
  try {
    assert.equal((await runToMessage(throwing, model, context)).stopReason, 'error');
    assert.equal((await runToMessage(closed, model, context)).stopReason, 'error');
    assert.deepEqual(ambiguous, ['dispatched', 'ambiguous', 'dispatched', 'ambiguous']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function getStaticModel(directory: string): Promise<Model<Api>> {
  const runtime = await PiRuntime.create({ privateDataRoot: join(directory, 'runtime') });
  const model = runtime.modelRuntime.getModel('openai-codex', 'gpt-6.1-sol');
  assert.ok(model);
  return model;
}

async function runToMessage(
  streamFunction: PiStreamFunction,
  model: Model<Api>,
  context: ReturnType<typeof normalizeContext>,
  options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
  const stream = await streamFunction(model, context, { ...options, reasoning: options?.reasoning ?? 'low' });
  return stream.result();
}

function makePort(input?: {
  reserve?: PiRequestPort['reserveNextRequest'];
  transition?: (target: string) => void;
}): PiRequestPort {
  let sequence = 0;
  return {
    reserveNextRequest(request) {
      if (input?.reserve) return input.reserve(request);
      return { kind: 'reserved', requestSeq: sequence++ };
    },
    transitionReservation(request) {
      input?.transition?.(request.target);
    },
    checkEligibility() {
      return { kind: 'active' };
    },
    recordCheckpointCandidate() {},
  };
}

function makeFakeTransport(onCall: (options: SimpleStreamOptions | undefined) => void): PiStreamFunction {
  // Explicit fake: test-only stream at the SDK boundary; it performs no OAuth or network request.
  return (model, _context, options) => {
    onCall(options);
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'start', partial: assistantMessage(model, 'pending') });
    stream.push({ type: 'done', reason: 'stop', message: assistantMessage(model, 'stop') });
    return stream;
  };
}

function assistantMessage(model: Model<Api>, stopReason: AssistantMessage['stopReason']): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

test('SDK Pi real conserva Sol low y Claude medium con transporte controlado, sin fallback ni auth real', async () => {
  const { DEFAULT_INFERENCE_PROFILE, CLAUDE_INFERENCE_PROFILE } = await import('../src/domain/inference-profile.ts');
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-profiles-'));
  try {
    const runtime = await PiRuntime.create({ privateDataRoot: directory });
    for (const profile of [DEFAULT_INFERENCE_PROFILE, CLAUDE_INFERENCE_PROFILE]) {
      const model = runtime.modelRuntime.getModel(profile.provider, profile.model);
      assert.ok(model);
      assert.equal(model.api, profile.api);
      assert.equal(model.thinkingLevelMap?.[profile.reasoningEffort], profile.reasoningEffort);
      const cwd = join(directory, profile.provider);
      const settingsManager = SettingsManager.inMemory({ retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } }, compaction: { enabled: false }, cacheWarming: 'off', enableInstallTelemetry: false, enableAnalytics: false, defaultThinkingLevel: profile.reasoningEffort });
      const resourceLoader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, 'agent'), settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: 'Synthetic test context. No character dossier.' });
      await resourceLoader.reload();
      const sessionManager = SessionManager.inMemory(cwd);
      const { session } = await createAgentSession({ cwd, agentDir: join(cwd, 'agent'), modelRuntime: runtime.modelRuntime, model, thinkingLevel: profile.reasoningEffort, noTools: 'all', tools: [], customTools: [], resourceLoader, sessionManager, settingsManager });
      try {
        const calls: string[] = [];
        let reservations = 0;
        const timedPort: PiRequestPort = { ...makePort(),
          reserveNextRequest: ({ clockEpochId }) => ({ kind: 'reserved', requestSeq: reservations++, wallTime: { reservedMs: 30_000, clockEpochId: z.string().uuid().parse(clockEpochId) } }),
          expireReservation() { throw new Error('Controlled immediate SDK request should never expire'); },
          settleWallTime() {},
        };
        session.agent.streamFunction = createBudgetedStreamFunction({ clockEpochId: runtime.clockEpochId, requireWallTime: true, profile, original: makeFakeTransport((options) => { calls.push(options?.reasoning ?? 'unset'); }), getScope: () => scope, identity: { kind: 'admin', role: 'director' }, runId, sessionManager, port: timedPort });
        await session.agent.prompt('Synthetic agent-loop harness, no provider network.');
        assert.equal(session.model?.provider, profile.provider);
        assert.equal(session.model?.id, profile.model);
        assert.equal(session.thinkingLevel, profile.reasoningEffort);
        assert.deepEqual(calls, [profile.reasoningEffort]);
        assert.equal(reservations, 1);
        assert.deepEqual(session.getActiveToolNames(), []);
        const wrong = await runToMessage(session.agent.streamFunction, model, normalizeContext({ messages: [{ role: 'user', content: 'Synthetic mismatch', timestamp: 0 }] }), { reasoning: profile.reasoningEffort === 'low' ? 'medium' : 'low' });
        assert.equal(wrong.stopReason, 'error'); assert.equal(reservations, 1); assert.equal(calls.length, 1);
      } finally { session.dispose(); }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('factory rechaza inferencia histórica Luna antes de autenticación o sesión, conservando lectura del catálogo', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-readonly-legacy-'));
  try {
    const runtime = await PiRuntime.create({ privateDataRoot: directory });
    assert.ok(runtime.modelRuntime.getModel(LEGACY_INFERENCE_PROFILE.provider, LEGACY_INFERENCE_PROFILE.model));
    await assert.rejects(createPiSession({ runtime, runId, identity, profile: LEGACY_INFERENCE_PROFILE, systemPrompt: 'Synthetic historical fixture.', checkpoint: { kind: 'fresh' }, tools: actorTools, adminToolAllowlist: {}, requestPort: makePort() }), (error: unknown) => isPiAdapterFailure(error) && error.code === 'MODEL_PROFILE_UNAVAILABLE');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('factory reabre OAuth sintético persistido sin depender del snapshot vacío isUsingOAuth, sin inference', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-auth-reopen-'));
  let handle: Awaited<ReturnType<typeof createPiSession>> | undefined;
  try {
    await PiRuntime.create({ privateDataRoot: directory });
    const access = `e30.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-test-account' } })).toString('base64url')}.synthetic`;
    writeFileSync(join(directory, 'pi', 'auth', 'auth.json'), JSON.stringify({ 'openai-codex': { type: 'oauth', refresh: 'synthetic-refresh', access, expires: Date.now() + 86_400_000 } }), { mode: 0o600 });
    const runtime = await PiRuntime.create({ privateDataRoot: directory });
    assert.equal(runtime.modelRuntime.isUsingOAuth('openai-codex'), false, 'refreshOnCreate:false preserves an empty availability snapshot');
    assert.equal((await runtime.modelRuntime.checkAuth('openai-codex'))?.type, 'oauth', 'SDK stored authentication remains authoritative');
    handle = await createPiSession({ runtime, runId, identity, profile: DEFAULT_INFERENCE_PROFILE, systemPrompt: 'Synthetic private test prompt.', checkpoint: { kind: 'fresh' }, tools: actorTools, adminToolAllowlist: {}, requestPort: makePort() });
    assert.deepEqual([...handle.activeToolNames].sort(), ['propose_action', 'recall_memory']);
    // No prompt: this verifies local re-opening/gates only, never provider access.
  } finally { await handle?.abortAndDispose(); rmSync(directory, { recursive: true, force: true }); }
});

test('wall-time deadline devuelve terminal acotado, descarta done tardío y conserva ownership hasta cierre real', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-walltime-'));
  try {
    const model = await getStaticModel(directory);
    const epoch = '00000000-0000-4000-8000-000000000221';
    let now = 0n;
    let fireDeadline: () => void = () => { throw new Error('Deadline not installed'); };
    const source = createAssistantMessageEventStream();
    let dispatchSignal: AbortSignal | undefined;
    let dispatched: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => { dispatched = resolve; });
    const events: string[] = [];
    let stop: string | undefined;
    const port: PiRequestPort = {
      reserveNextRequest: ({ clockEpochId }) => ({ kind: 'reserved', requestSeq: 0, wallTime: { reservedMs: 10, clockEpochId: z.string().uuid().parse(clockEpochId) } }),
      checkEligibility: () => ({ kind: 'active' }),
      recordCheckpointCandidate() {},
      transitionReservation({ target, wallTime }) { events.push(target); if (target === 'dispatched') assert.deepEqual(wallTime, { clockEpochId: epoch, monotonicNs: '0' }); },
      expireReservation({ reason }) { events.push(`expire:${reason}`); },
      settleWallTime({ monotonicNs }) { events.push('settle'); stop = monotonicNs; },
    };
    const wrapped = createBudgetedStreamFunction({ clockEpochId: epoch, requireWallTime: true,
      clock: { nowNs: () => now, schedule(ms, callback) { assert.equal(ms, 10); fireDeadline = callback; return () => undefined; } },
      original: (_model, _context, options) => { dispatchSignal = options?.signal; dispatched(); return source; },
      getScope: () => scope, identity, runId, sessionManager: SessionManager.inMemory(directory), port });
    const output = runToMessage(wrapped, model, normalizeContext({ messages: [] }));
    await entered;
    now = 10_000_000n; fireDeadline();
    const timeout = await output;
    assert.equal(timeout.stopReason, 'aborted'); assert.equal(dispatchSignal?.aborted, true);
    assert.deepEqual(events, ['dispatched', 'expire:timeout']); assert.equal(wrapped.isBusy(), true);
    let settled = false;
    const closing = wrapped.whenSettled().then(() => { settled = true; });
    await Promise.resolve(); assert.equal(settled, false);
    now = 35_500_000n;
    source.push({ type: 'done', reason: 'stop', message: assistantMessage(model, 'stop') });
    await closing;
    assert.equal(stop, '35500000', 'Real overrun is not clipped to the grant');
    assert.deepEqual(events, ['dispatched', 'expire:timeout', 'settle']);
    assert.equal(wrapped.isBusy(), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('wall-time settled proof precede terminal normal y cancel externo nunca adopta done tardío', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-walltime-settle-'));
  try {
    const model = await getStaticModel(directory);
    const epoch = '00000000-0000-4000-8000-000000000222';
    for (const cancel of [false, true]) {
      let now = 1n;
      let enter: () => void = () => undefined;
      const entered = new Promise<void>((resolve) => { enter = resolve; });
      let releaseProof: () => void = () => undefined;
      const proofGate = new Promise<void>((resolve) => { releaseProof = resolve; });
      const source = createAssistantMessageEventStream();
      const controller = new AbortController();
      const events: string[] = [];
      const port: PiRequestPort = {
        reserveNextRequest: ({ clockEpochId }) => ({ kind: 'reserved', requestSeq: 0, wallTime: { reservedMs: 100, clockEpochId: z.string().uuid().parse(clockEpochId) } }),
        checkEligibility: () => ({ kind: 'active' }), recordCheckpointCandidate() {},
        async transitionReservation({ target, wallTime }) { events.push(target); if (target === 'completed') { assert.equal(wallTime?.monotonicNs, '5000001'); await proofGate; } },
        expireReservation({ reason }) { events.push(`expire:${reason}`); },
        settleWallTime() { events.push('settle'); },
      };
      const wrapped = createBudgetedStreamFunction({ clockEpochId: epoch, requireWallTime: true,
        clock: { nowNs: () => now, schedule: () => () => undefined }, original: () => { enter(); return source; },
        getScope: () => scope, identity, runId, sessionManager: SessionManager.inMemory(directory), port });
      let outputSettled = false;
      const output = runToMessage(wrapped, model, normalizeContext({ messages: [] }), { signal: controller.signal }).then((value) => { outputSettled = true; return value; });
      await entered;
      if (cancel) {
        controller.abort(); assert.equal((await output).stopReason, 'aborted');
      }
      now = 5_000_001n;
      source.push({ type: 'done', reason: 'stop', message: assistantMessage(model, 'stop') });
      if (!cancel) { await new Promise((resolve) => setImmediate(resolve)); assert.equal(outputSettled, false, 'Done remains private until durable settlement'); releaseProof(); assert.equal((await output).stopReason, 'stop'); }
      await wrapped.whenSettled();
      assert.deepEqual(events, cancel ? ['dispatched', 'expire:cancelled', 'settle'] : ['dispatched', 'completed']);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('SDK agent loop real no ejecuta tool del done tardío después del deadline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-walltime-sdk-'));
  try {
    const runtime = await PiRuntime.create({ privateDataRoot: directory });
    const model = runtime.modelRuntime.getModel('openai-codex', 'gpt-6.1-sol'); assert.ok(model);
    const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false }, defaultThinkingLevel: 'low' });
    const loader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: 'Controlled SDK deadline test.' });
    await loader.reload();
    let toolCalls = 0;
    const tool: PiCustomTool = { name: 'attempt_after_deadline', label: 'Controlled tool', description: 'Test-only counter', parameters: Type.Object({}),
      async execute() { toolCalls += 1; return { content: [], details: undefined }; } };
    const sessionManager = SessionManager.inMemory(directory);
    const { session } = await createAgentSession({ cwd: directory, agentDir: directory, modelRuntime: runtime.modelRuntime, model, thinkingLevel: 'low', noTools: 'all', tools: [], customTools: [tool], resourceLoader: loader, sessionManager, settingsManager });
    const source = createAssistantMessageEventStream();
    let now = 0n; let deadline: () => void = () => undefined;
    let enter: () => void = () => undefined; const entered = new Promise<void>((resolve) => { enter = resolve; });
    const events: string[] = [];
    const wrapped = createBudgetedStreamFunction({ clockEpochId: runtime.clockEpochId, requireWallTime: true,
      clock: { nowNs: () => now, schedule(_ms, callback) { deadline = callback; return () => undefined; } },
      original: () => { enter(); return source; }, getScope: () => scope, identity: { kind: 'admin', role: 'director' }, runId, sessionManager,
      port: { ...makePort(), reserveNextRequest: ({ clockEpochId }) => ({ kind: 'reserved', requestSeq: 0, wallTime: { reservedMs: 10, clockEpochId: z.string().uuid().parse(clockEpochId) } }),
        expireReservation() { events.push('expired'); }, settleWallTime() { events.push('settled'); } } });
    session.agent.streamFunction = wrapped;
    try {
      const prompt = session.agent.prompt('Controlled explicit prompt, no provider network.');
      await entered; now = 10_000_000n; deadline(); await prompt;
      assert.equal(toolCalls, 0); assert.equal(wrapped.isBusy(), true);
      now = 20_000_000n;
      const late = assistantMessage(model, 'stop'); late.content = [{ type: 'toolCall', id: 'late-tool', name: tool.name, arguments: {} }]; late.stopReason = 'toolUse';
      source.push({ type: 'done', reason: 'toolUse', message: late });
      await wrapped.whenSettled();
      assert.equal(toolCalls, 0); assert.deepEqual(events, ['expired', 'settled']);
      const last = session.agent.state.messages.at(-1); assert.equal(last?.role, 'assistant');
      if (last?.role === 'assistant') assert.equal(last.stopReason, 'aborted');
    } finally { await wrapped.whenSettled(); session.dispose(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('factory SDK productiva rechaza puerto histórico sin grant antes del transporte', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-pi-no-time-grant-'));
  let handle: Awaited<ReturnType<typeof createPiSession>> | undefined;
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error('Test forbids provider transport'); };
  try {
    await PiRuntime.create({ privateDataRoot: directory });
    const access = `e30.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-test-account' } })).toString('base64url')}.synthetic`;
    writeFileSync(join(directory, 'pi', 'auth', 'auth.json'), JSON.stringify({ 'openai-codex': { type: 'oauth', refresh: 'synthetic-refresh', access, expires: Date.now() + 86_400_000 } }), { mode: 0o600 });
    const runtime = await PiRuntime.create({ privateDataRoot: directory });
    const transitions: string[] = [];
    const checkpoints: PiCheckpointCandidate[] = [];
    handle = await createPiSession({ runtime, runId, identity: { kind: 'admin', role: 'continuista' }, profile: DEFAULT_INFERENCE_PROFILE,
      systemPrompt: 'Synthetic SDK test, never an actor context.', checkpoint: { kind: 'fresh' }, tools: [], adminToolAllowlist: { continuista: [] },
      requestPort: { ...makePort({ transition: (target) => transitions.push(target) }), recordCheckpointCandidate: (candidate) => { checkpoints.push(candidate); } } });
    const terminal = await handle.prompt({ text: 'Controlled explicit SDK test.', scope });
    assert.equal(terminal.outcome, 'failed'); assert.equal(fetchCalls, 0);
    assert.deepEqual(transitions, ['undispatched']);
    assert.equal(checkpoints.some((candidate) => candidate.purpose.kind === 'terminal-candidate' && candidate.purpose.outcome === 'completed'), false);
  } finally { await handle?.abortAndDispose(); globalThis.fetch = previousFetch; rmSync(directory, { recursive: true, force: true }); }
});
