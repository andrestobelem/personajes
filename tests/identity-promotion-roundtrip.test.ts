import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { z } from 'zod';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { createIcmMemoryAdapter } from '../src/adapters/icm.ts';
import { createBudgetedStreamFunction, PiRuntime, type CreatePiSessionInput, type PiPromptInput, type PiRequestReference, type PiSessionHandle } from '../src/adapters/pi.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createRepresentationRuntime } from '../src/application/representation-runtime.ts';
import { createActorTurnWorker } from '../src/application/actor-turn-worker.ts';
import { createContinuistaPiWorker } from '../src/application/continuista-pi-worker.ts';
import { validateContinuistaReviewContext } from '../src/application/continuista-review-context.ts';
import { createDeliverWorldWorker } from '../src/application/deliver-world.ts';
import { createProjectMemoryWorker } from '../src/application/project-memory.ts';
import { createProductionPreflightHost } from '../src/application/production-preflight-host.ts';
import { createPiAuthFingerprint } from '../src/application/pi-auth-fingerprint.ts';
import { fingerprintInferenceProfile } from '../src/application/pi-access-check.ts';
import { configuratorValueHash } from '../src/application/configurator-context.ts';
import { canonicalDirectorValue } from '../src/application/director-context.ts';
import { RunConfigurationDraftSchema, createEmptyRunConfigurationDraft } from '../src/domain/production.ts';
import { createIdentityPromotionApplication } from '../src/application/identity-promotion-application.ts';
import { ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { identityPromotionContextEtag, IdentityPromotionContextViewSchema, IdentityPromotionJobViewSchema, IdentityPromotionReviewSchema } from '../src/domain/identity-promotion-http.ts';
import { RevisionSchema, PulseIdSchema } from '../src/domain/values.ts';
import { configuratorEvolutionFixture } from './fixtures/configurator-evolution.ts';
import { controlledConfiguratorSessionFactory, configuratorSessionStats } from './fixtures/configurator-session.ts';
import { controlledDirectorSessionFactory } from './fixtures/director-session.ts';
import { responseFor } from './fixtures/continuista.ts';

const binaryPath = process.env.PERSONAJES_ICM_TEST_BINARY;

/** Model responses are controlled, but SDK tools, JSONL, quotas, proposal review,
 * acceptance, world commit and SQLite memory all use production implementations. */
function physicalSessions(input: { host: ReturnType<typeof openLocalHost>; stats: { requests: number; actorPrompts: { prompt: PiPromptInput; systemPrompt: string }[] } }) {
  return async (sessionInput: CreatePiSessionInput): Promise<PiSessionHandle> => {
    const actor = sessionInput.identity.kind === 'actor';
    const identityRoot = sessionInput.identity.kind === 'actor' ? join(input.host.privateDataRoot, 'runs', sessionInput.runId, 'actors', sessionInput.identity.characterId)
      : join(input.host.privateDataRoot, 'runs', sessionInput.runId, 'roles', sessionInput.identity.role);
    const cwd = join(identityRoot, 'cwd'); const sessions = join(identityRoot, 'sessions'); mkdirSync(cwd, { recursive: true });
    const manager = sessionInput.checkpoint.kind === 'leaf' ? SessionManager.open(sessionInput.checkpoint.sessionPath, sessions, cwd) : SessionManager.create(cwd, sessions);
    if (sessionInput.checkpoint.kind === 'leaf' && manager.getLeafId() !== sessionInput.checkpoint.committedLeafId) manager.branch(sessionInput.checkpoint.committedLeafId);
    const settings = SettingsManager.inMemory({ retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } }, compaction: { enabled: false }, cacheWarming: 'off', enableAnalytics: false, enableInstallTelemetry: false });
    const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, 'agent'), settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: sessionInput.systemPrompt }); await loader.reload();
    assert.ok(sessionInput.profile); const model = sessionInput.runtime.modelRuntime.getModel(sessionInput.profile.provider, sessionInput.profile.model); assert.ok(model);
    const { session } = await createAgentSession({ cwd, agentDir: join(cwd, 'agent'), modelRuntime: sessionInput.runtime.modelRuntime, model, thinkingLevel: sessionInput.profile.reasoningEffort, noTools: 'all', tools: sessionInput.tools.map(tool => tool.name), customTools: [...sessionInput.tools], resourceLoader: loader, settingsManager: settings, sessionManager: manager });
    const checkpoint = () => ({ sessionId: manager.getSessionId(), sessionPath: manager.getSessionFile() ?? null, candidateLeafId: manager.getLeafId() });
    return { identity: sessionInput.identity, activeToolNames: session.getActiveToolNames(), checkpoint, subscribe: () => () => undefined,
      async abortAndDispose() { await session.abort(); session.dispose(); },
      async prompt(prompt) {
        if (actor) input.stats.actorPrompts.push({ prompt, systemPrompt: sessionInput.systemPrompt });
        const base = actor && sessionInput.identity.kind === 'actor' ? input.host.journal.loadActorPiSession({ runId: sessionInput.runId, actorId: sessionInput.identity.characterId }) : undefined;
        const turnId = randomUUID(); let lastRequest: PiRequestReference | undefined; let rounds = 0;
        await sessionInput.requestPort.recordCheckpointCandidate({ identity: sessionInput.identity, purpose: { kind: 'job-base', baseScope: prompt.scope }, snapshot: { ...checkpoint(), ...(base === undefined ? {} : { candidateLeafId: base.committedLeafId }) } });
        session.agent.streamFunction = createBudgetedStreamFunction({ identity: sessionInput.identity, runId: sessionInput.runId, clockEpochId: sessionInput.runtime.clockEpochId, requireWallTime: true, sessionManager: manager, port: sessionInput.requestPort, getScope: () => prompt.scope,
          ...(base === undefined ? {} : { getActorTurnContext: () => { assert.ok(prompt.inputCut); return { turnId, base: { ...base, sessionRevision: RevisionSchema.parse(base.sessionRevision) }, inputCut: prompt.inputCut, ...(prompt.lease === undefined ? {} : { lease: prompt.lease }) }; } }),
          onRequestReserved(request) { lastRequest = request; }, original(actualModel) {
            input.stats.requests++; rounds++;
            const toolName = actor ? rounds === 1 ? 'recall_memory' : 'propose_action' : sessionInput.tools[0]?.name; assert.ok(toolName);
            const argumentsValue = actor ? rounds === 1 ? { query: 'escuchar' } : { action: { kind: 'wait', durationMs: 1 } }
              : responseFor(validateContinuistaReviewContext({ kind: 'continuista-review-context', schemaVersion: 1, ...JSON.parse(prompt.text) }));
            const tool = rounds <= (actor ? 2 : 1) ? { type: 'toolCall' as const, id: randomUUID(), name: toolName, arguments: z.record(z.string(), z.json()).parse(JSON.parse(JSON.stringify(argumentsValue))) } : undefined;
            const message: AssistantMessage = { role: 'assistant', api: actualModel.api, provider: actualModel.provider, model: actualModel.id, content: tool === undefined ? [] : [tool], stopReason: tool === undefined ? 'stop' : 'toolUse', timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
            const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: tool === undefined ? 'stop' : 'toolUse', message }); return stream;
          } });
        await session.agent.prompt(prompt.text); const terminal = checkpoint(); assert.ok(lastRequest); assert.ok(terminal.candidateLeafId);
        await sessionInput.requestPort.recordCheckpointCandidate({ identity: sessionInput.identity, purpose: { kind: 'terminal-candidate', baseScope: prompt.scope, outcome: 'completed', lastRequest }, snapshot: terminal });
        const candidateId = actor ? randomUUID() : null;
        if (actor && sessionInput.identity.kind === 'actor') { assert.ok(base && prompt.lease); await sessionInput.requestPort.recordActorPiCandidate?.({ kind: 'terminal-candidate', candidateId, turnId, runId: sessionInput.runId, actorId: sessionInput.identity.characterId, scope: prompt.scope, lease: prompt.lease, base, outcome: 'completed', lastRequestSeq: lastRequest.requestSeq, candidateLeafId: terminal.candidateLeafId, inputCut: prompt.inputCut }); }
        return { kind: 'pi-terminal-candidate', candidateId, outcome: 'completed', candidateLeafId: terminal.candidateLeafId };
      },
    };
  };
}

test('promoción real conserva ICM e historia, archiva la sesión anterior y el próximo actor usa identidad nueva en sesión SDK independiente', { skip: binaryPath === undefined ? 'Requiere PERSONAJES_ICM_TEST_BINARY.' : false }, async () => {
  assert.ok(binaryPath); const f = await configuratorEvolutionFixture(); f.base.journal.close();
  // The source fixture's composite cleanup also closes its original setup DB.
  // Its transferred journal is already closed; only that cleanup hook is inert.
  f.base.journal.close = () => undefined; renameSync(f.journalPath, join(f.base.directory, 'world.sqlite'));
  let host = openLocalHost({ privateDataRoot: f.base.directory }); const runId = f.source.snapshot.runId;
  const runtime = await PiRuntime.create({ privateDataRoot: host.privateDataRoot }); const stats = { requests: 0, actorPrompts: [] as { prompt: PiPromptInput; systemPrompt: string }[] }; const configStats = configuratorSessionStats();
  const factory = physicalSessions({ host, stats });
  let representation = await createRepresentationRuntime({ host, piRuntime: runtime, icmBinaryPath: binaryPath, testTransport: { kind: 'controlled-test-transport', name: 'SDK determinista físico de roundtrip', actorSessionFactory: factory, continuistaSessionFactory: factory, directorSessionFactory: controlledDirectorSessionFactory({ root: host.privateDataRoot, physicalSessions: true }) } });
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() }); const originalEntry = catalog.manifest.characters.find(entry => entry.characterId === 'maxwell-smart'); assert.ok(originalEntry);
  // Explicit synthetic catalog identity, still backed by the allowlisted actual
  // dossier bytes and its SHA; no authority or acceptance is replaced.
  const syntheticCatalog = { ...catalog, manifest: { ...catalog.manifest, characters: [{ ...originalEntry, characterId: f.characterId }] } };
  let app = createIdentityPromotionApplication({ host, runtime, catalog: syntheticCatalog, representation, sessionFactory: controlledConfiguratorSessionFactory({ root: host.privateDataRoot, stats: configStats }) });
  try {
    const memories = new Map<string, Awaited<ReturnType<typeof createIcmMemoryAdapter>>>();
    for (const actor of f.source.configuration.roster.preparedCharacters) {
      const memory = await createIcmMemoryAdapter({ privateDataRoot: host.privateDataRoot, runId, actorId: actor.characterId, binaryPath, ledger: { findReceipt: request => host.journal.findReceipt(request) } }); await memory.initialize(); memories.set(actor.characterId, memory);
    }
    async function drain() {
      for (const actor of f.source.configuration.roster.preparedCharacters) {
        assert.equal((await createDeliverWorldWorker({ journal: host.journal, runId, actorId: actor.characterId }).drain()).kind, 'completed');
        const memory = memories.get(actor.characterId); assert.ok(memory);
        assert.equal((await createProjectMemoryWorker({ journal: host.journal, projector: memory.projector, runId, actorId: actor.characterId }).drain({ maxItems: 100 })).kind, 'completed');
      }
    }
    async function turn() {
      const pulseId = PulseIdSchema.parse(randomUUID()); host.journal.configureRun({ runId, maxCalls: f.source.configuration.budget.maxPiCallsPerRun }); host.journal.configurePulse({ runId, pulseId, maxCalls: 20 });
      const scheduled = host.journal.scheduleActorTurnJob({ runId, actorId: f.characterId, pulseId }); assert.ok(scheduled.kind === 'scheduled', JSON.stringify(scheduled));
      const continuista = createContinuistaPiWorker({ journal: host.journal, runtime, ids: f.base.ids, ownerToken: host.ownerToken, sessionFactory: factory });
      const worker = createActorTurnWorker({ journal: host.journal, runtime, ids: f.base.ids, memoryForActor: () => { const memory = memories.get(f.characterId); assert.ok(memory); return memory.actor; }, continuista, sessionFactory: factory });
      const result = await worker.run({ runId, actorId: f.characterId, jobId: scheduled.job.jobId, generation: scheduled.job.generation, ownerToken: host.ownerToken, claimToken: randomUUID() }); assert.equal(result.kind, 'committed'); await drain();
    }
    await drain(); await turn();
    const oldSession = host.journal.loadActorPiSession({ runId, actorId: f.characterId }); assert.ok(oldSession?.committedLeafId); const oldBytes = readFileSync(oldSession.sessionPath);
    const current = host.journal.loadWorld({ runId }); assert.ok(current); host.journal.setWorldLifecycle({ runId, expectedWorldRevision: current.revision, expectedConfigRevision: f.source.configuration.configRevision, target: 'paused' });
    const authority = { principalId: 'roundtrip-operator', mode: { kind: 'director' as const, runId, scope: { kind: 'run' as const } }, inspectionRunIds: [runId] };
    const head = IdentityPromotionContextViewSchema.parse(app.context({ runId, authority }));
    // Preserve an explicit synthetic preparation draft at its historical revision.
    // Promotion must advance effective Ready without rewriting this document.
    const recordedAt = '2026-10-14T12:00:00.000Z';
    const configured = Object.fromEntries(Object.entries(f.source.configuration).filter(([field]) => !['kind', 'schemaVersion', 'runId', 'configRevision', 'snapshotFence', 'participantAvailability', 'preparedActorFences', 'language'].includes(field)).map(([field, value]) => [field, { kind: 'configured', value, evidence: { kind: 'operator-choice', operatorId: authority.principalId, recordedAt } }]));
    const historicalDraft = RunConfigurationDraftSchema.parse({ ...createEmptyRunConfigurationDraft({ runId, revision: head.configurationRevision }), ...configured });
    const historical = { draft: historicalDraft, principalId: authority.principalId, recordedAt };
    const seed = new DatabaseSync(join(host.privateDataRoot, 'world.sqlite'));
    try {
      seed.prepare('INSERT INTO run_configuration_drafts VALUES(?,?,?,?)').run(runId, historicalDraft.revision, recordedAt, recordedAt);
      seed.prepare('INSERT INTO run_configuration_draft_history VALUES(?,?,?,?,?,?)').run(runId, historicalDraft.revision, authority.principalId, recordedAt, canonicalDirectorValue(historical), configuratorValueHash(historical));
    } finally { seed.close(); }
    const preflightHost = createProductionPreflightHost({ journal: host.journal, catalog: syntheticCatalog, piRuntime: runtime, authentication: createPiAuthFingerprint({ privateDataRoot: host.privateDataRoot, environment: {} }), icmBinaryPath: binaryPath });
    assert.deepEqual(await preflightHost.readCurrentConfigurationRevision({ runId }), { kind: 'loaded', revision: head.configurationRevision });
    // Explicit controlled preflight results exercise durable admission fences;
    // these results do not claim a real provider authentication or paid probe.
    function controlledPassedPreflight() {
      const state = host.journal.readWorldLifecycle({ runId }); assert.ok(state);
      const started = host.journal.createRunPreflightJob({ principalId: authority.principalId, idempotencyKey: randomUUID(), runId, expectedConfigurationRevision: state.configRevision, expectedWorldRevision: state.worldRevision }); assert.ok(started.kind === 'created');
      const lease = { ownerToken: host.ownerToken, claimToken: randomUUID() };
      const claimed = host.journal.claimRunPreflightJob({ runId, jobId: started.job.jobId, expectedRevision: 0, ...lease }); assert.ok(claimed.kind === 'claimed');
      const frozen = host.journal.readRunPreflightJobInput({ runId, jobId: started.job.jobId, lease }); assert.ok(frozen.kind === 'found');
      const profile = f.source.configuration.inferenceProfile; assert.ok(profile); const profileFingerprint = fingerprintInferenceProfile(profile); const accountFingerprint = 'a'.repeat(64);
      const access = host.journal.createPiAccessJob({ principalId: authority.principalId, idempotencyKey: randomUUID(), profile }); assert.ok(access.kind === 'created');
      const accessLease = { ownerToken: host.ownerToken, claimToken: randomUUID() }; const accessClaim = host.journal.claimPiAccessJob({ jobId: access.job.jobId, expectedRevision: 0, ...accessLease }); assert.ok(accessClaim.kind === 'claimed');
      const checkedAt = new Date(Date.now() - 1000).toISOString(); const expiresAt = new Date(Date.now() + 120_000).toISOString();
      assert.equal(host.journal.completePiAccessJob({ jobId: access.job.jobId, expectedRevision: accessClaim.job.revision, lease: accessLease, checkedAt, expiresAt, result: { kind: 'passed', provider: profile.provider, requestedProfile: profile, profileFingerprint, accountFingerprint, effectiveProfile: { provider: profile.provider, api: profile.api, model: profile.model, providerThinkingLevel: profile.reasoningEffort, reasoningEvidence: 'sdk-payload-and-response' }, measuredUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } } }).kind, 'updated');
      const accessReceipt = { jobId: access.job.jobId, resultKind: 'passed', provider: profile.provider, profileFingerprint, accountFingerprint, checkedAt, expiresAt };
      assert.equal(host.journal.completeRunPreflightJob({ runId, jobId: started.job.jobId, expectedRevision: claimed.job.revision, lease, evaluation: { fence: frozen.fence, result: { kind: 'passed', checkedAt, checks: ['configuration', 'configuration-version', 'world-snapshot', 'prepared-contexts', 'catalog-eligibility', 'inference-profile', 'pi-sdk', 'pi-profile', 'provider-authentication', 'pi-runtime', 'icm-memory', 'budget', 'provider-access-check', 'participant-availability', 'voice'].map(checkId => ({ kind: 'passed', checkId, code: `${checkId}-passed` })) }, evidence: { provider: profile.provider, profileFingerprint, accountFingerprint, accessReceipt } } }).kind, 'updated');
      return started.job.jobId;
    }
    const previousPreflightId = controlledPassedPreflight();
    const beforeReport = host.journal.readRunPreflightJob({ runId, jobId: previousPreflightId }); assert.ok(beforeReport.kind === 'found'); assert.equal(beforeReport.document.report.kind, 'current'); assert.equal(beforeReport.document.report.result?.kind, 'passed');
    const oldSource = host.journal.readForkSource({ runId, commitIndex: head.commitIndex, worldRevision: head.worldRevision, worldSeq: head.worldSeq }); assert.ok(oldSource.kind === 'found');
    const oldConfigurationAtCut = host.journal.readRunConfigurationAtCommit({ runId, commitIndex: head.commitIndex });
    const oldConfig = host.journal.readWorldConfiguration({ runId }); const memory = memories.get(f.characterId); assert.ok(memory); const memoryBefore = await memory.diagnostics.listForensic({ throughWorldSeq: head.worldSeq });
    const budget = () => { const db = new DatabaseSync(join(host.privateDataRoot, 'world.sqlite'), { readOnly: true }); try { return db.prepare('SELECT * FROM run_budgets WHERE run_id=?').get(runId); } finally { db.close(); } };
    const start = IdentityPromotionJobViewSchema.parse(await app.start({ runId, authority, idempotencyKey: randomUUID(), ifMatch: identityPromotionContextEtag(head), body: { actorId: f.characterId, expectedLifecycleRevision: head.lifecycleRevision, expectedCommitIndex: head.commitIndex, expectedWorldRevision: head.worldRevision, expectedWorldSeq: head.worldSeq, expectedConfigurationRevision: head.configurationRevision } }));
    await app.waitForIdle(); const review = IdentityPromotionReviewSchema.parse(app.readReview({ jobId: start.jobId, authority })); assert.equal(review.job.state, 'accepted', JSON.stringify({state:review.job.state, failure:review.job.failureCode, stats:configStats.requests})); assert.ok(review.proposalHash);
    const budgetBefore = budget(); const approveRequest = { jobId: start.jobId, authority, expectedRevision: review.job.revision, idempotencyKey: randomUUID(), body: { contextHash: review.job.contextHash, proposalHash: review.proposalHash, targetFullHash: review.targetFullHash, expectedLifecycleRevision: head.lifecycleRevision, expectedCommitIndex: head.commitIndex, expectedWorldRevision: head.worldRevision } };
    const applied = IdentityPromotionJobViewSchema.parse(await app.approve(approveRequest)); assert.equal(applied.promotion.kind, 'applied'); assert.equal(configStats.requests, 2);
    const after = host.journal.loadWorld({ runId }); assert.ok(after); assert.equal(after.seq, head.worldSeq); assert.deepEqual(after.clock, oldSource.snapshot.clock); assert.deepEqual(budget(), budgetBefore);
    assert.deepEqual(host.journal.readForkSource({ runId, commitIndex: head.commitIndex, worldRevision: head.worldRevision, worldSeq: head.worldSeq }), oldSource);
    const historicalConfiguration = host.journal.readRunConfigurationAtCommit({ runId, commitIndex: head.commitIndex });
    assert.ok(historicalConfiguration.kind === 'found' && oldConfigurationAtCut.kind === 'found');
    assert.deepEqual(historicalConfiguration.configuration, oldConfigurationAtCut.configuration);
    assert.equal(historicalConfiguration.configurationHash, oldConfigurationAtCut.configurationHash);
    assert.deepEqual(historicalConfiguration.continuityFence, oldConfigurationAtCut.continuityFence);
    assert.deepEqual(await memory.diagnostics.listForensic({ throughWorldSeq: head.worldSeq }), memoryBefore); assert.deepEqual(readFileSync(oldSession.sessionPath), oldBytes);
    assert.equal(host.journal.loadActorPiSession({ runId, actorId: f.characterId }), undefined); assert.deepEqual(host.journal.loadActorPiSessionAtEpoch({ runId, actorId: f.characterId, epochIndex: 0 }), oldSession);
    const nextConfig = ReadyRunConfigurationSchema.parse(host.journal.readWorldConfiguration({ runId })); assert.notDeepEqual(nextConfig, oldConfig); const nextPrepared = nextConfig.roster.preparedCharacters.find(actor => actor.characterId === f.characterId); assert.ok(nextPrepared);
    assert.deepEqual(await preflightHost.readCurrentConfigurationRevision({ runId }), { kind: 'loaded', revision: nextConfig.configRevision });
    assert.equal(host.journal.readRunConfigurationDraft({ runId })?.revision, historicalDraft.revision);
    assert.deepEqual(host.journal.readRunConfigurationDraft({ runId, revision: historicalDraft.revision }), historicalDraft);
    assert.equal(host.journal.readRunConfigurationDraftState({ runId })?.editability, 'identity-promoted');
    const obsolete = host.journal.readRunPreflightJob({ runId, jobId: previousPreflightId }); assert.ok(obsolete.kind === 'found'); assert.equal(obsolete.document.report.kind, 'stale'); assert.equal(obsolete.document.report.result?.kind, 'passed');
    const lifecycle = host.journal.readWorldLifecycle({ runId }); assert.ok(lifecycle);
    const resume = { principalId: authority.principalId, runId, expectedLifecycleRevision: lifecycle.lifecycleRevision, expectedConfigRevision: nextConfig.configRevision, expectedWorldRevision: after.revision, command: { kind: 'resume' } };
    assert.equal(host.journal.applyRunLifecycleCommand({ ...resume, idempotencyKey: randomUUID(), preflightJobId: previousPreflightId }).kind, 'preflightStale');
    assert.equal(host.journal.readWorldLifecycle({ runId })?.lifecycle, 'paused');
    const previousPrepared = oldSource.configuration.roster.preparedCharacters.find(actor => actor.characterId === f.characterId); assert.ok(previousPrepared);
    assert.equal(nextPrepared.identityVersion, previousPrepared.identityVersion + 1);
    assert.match(nextPrepared.identity.value.selfConcept, /Procuro escuchar con paciencia/);
    assert.equal(await representation.scheduleRun({ runId }), false, 'new process/runtime requires fresh preflight authorization');
    const freshPreflightId = controlledPassedPreflight();
    const resumed = host.journal.applyRunLifecycleCommand({ ...resume, idempotencyKey: randomUUID(), preflightJobId: freshPreflightId }); assert.equal(resumed.kind, 'updated');
    assert.equal(host.journal.readWorldLifecycle({ runId })?.lifecycle, 'running');
    const visitor = nextConfig.humanParticipants[0]; assert.ok(visitor);
    const stimulus = host.journal.commitHumanIntervention({ runId, participantId: visitor.identity.participantId, expectedRevision: after.revision, idempotencyKey: randomUUID(), request: { kind: 'speech', recipientCharacterIds: [f.characterId], channelId: visitor.presence.channelId, content: { kind: 'speech', text: 'Estímulo sintético posterior a promoción.' } } });
    assert.ok(stimulus.kind !== 'invalidLifecycle' && stimulus.kind !== 'idempotencyConflict' && stimulus.resolution.kind === 'applied');
    await drain(); await turn();
    const nextSession = host.journal.loadActorPiSession({ runId, actorId: f.characterId }); assert.ok(nextSession?.committedLeafId); assert.notEqual(nextSession.sessionId, oldSession.sessionId); assert.notEqual(nextSession.sessionPath, oldSession.sessionPath);
    assert.equal(nextSession.preparedContextHash, configuratorValueHash(nextPrepared));
    assert.equal(stats.requests, 10, 'dos turnos SDK: actor tres rondas y Continuista dos por turno');
    const historicalMemory = await memory.diagnostics.listForensic({ throughWorldSeq: head.worldSeq });
    assert.deepEqual(historicalMemory.experiences, memoryBefore.experiences, 'el corte anterior no admite vivencias posteriores');
    assert.ok(historicalMemory.rejectedCount > 0, 'la vivencia posterior queda excluida por el lector real');
    assert.match(stats.actorPrompts.at(-1)?.systemPrompt ?? '', /Procuro escuchar con paciencia/); assert.equal(JSON.stringify(stats.actorPrompts.at(-1)).includes('SECRET_PRIVATE_OTHER_MEMORY'), false);
    assert.deepEqual(readFileSync(oldSession.sessionPath), oldBytes); assert.deepEqual(IdentityPromotionJobViewSchema.parse(await app.approve(approveRequest)), applied);
    const inferenceBefore = { actor: stats.requests, configurator: configStats.requests }; await app.close(); await representation.close();
    host = openLocalHost({ privateDataRoot: f.base.directory }); const reopenedRuntime = await PiRuntime.create({ privateDataRoot: host.privateDataRoot }); representation = await createRepresentationRuntime({ host, piRuntime: reopenedRuntime, icmBinaryPath: binaryPath });
    app = createIdentityPromotionApplication({ host, runtime: reopenedRuntime, catalog: syntheticCatalog, representation, sessionFactory: controlledConfiguratorSessionFactory({ root: host.privateDataRoot, stats: configStats }) });
    assert.equal(IdentityPromotionJobViewSchema.parse(app.readJob({ jobId: start.jobId, authority })).promotion.kind, 'applied');
    assert.deepEqual(IdentityPromotionJobViewSchema.parse(await app.approve(approveRequest)), applied); assert.deepEqual({ actor: stats.requests, configurator: configStats.requests }, inferenceBefore);
  } finally { await app.close(); await representation.close(); f.close(); }
});
