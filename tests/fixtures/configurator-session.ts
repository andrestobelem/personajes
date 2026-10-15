import assert from 'node:assert/strict';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { createBudgetedStreamFunction, type CreatePiSessionInput, type PiCheckpointSnapshot, type PiPromptInput, type PiRequestReference, type PiSessionHandle } from '../../src/adapters/pi.ts';
import { ConfiguratorContextSchema, ConfiguratorProposalSchema, type ConfiguratorContext } from '../../src/domain/configurator.ts';

export type ConfiguratorSessionStats = { sessions: number; requests: number; disposed: number; contexts: ConfiguratorContext[]; profiles: CreatePiSessionInput['profile'][] };
export function configuratorSessionStats(): ConfiguratorSessionStats { return { sessions: 0, requests: 0, disposed: 0, contexts: [], profiles: [] }; }

/** Real SDK/session/tools and budgeted transport. Only model bytes are controlled. */
export function controlledConfiguratorSessionFactory(input: {
  root: string; stats: ConfiguratorSessionStats; omitProposal?: boolean; incomplete?: boolean;
  afterTool?: () => void; beforeSession?: () => void; afterTerminal?: (snapshot: PiCheckpointSnapshot) => void;
}) {
  return async (sessionInput: CreatePiSessionInput): Promise<PiSessionHandle> => {
    input.beforeSession?.(); input.stats.sessions += 1;
    assert.deepEqual(sessionInput.identity, { kind: 'admin', role: 'configurador' }); assert.ok(sessionInput.profile);
    input.stats.profiles.push(sessionInput.profile);
    const identityRoot = join(realpathSync(input.root), 'runs', sessionInput.runId, 'roles', 'configurador'); const cwd = join(identityRoot, 'cwd'); mkdirSync(cwd, { recursive: true });
    const manager = SessionManager.create(cwd, join(identityRoot, 'sessions'));
    const settings = SettingsManager.inMemory({ retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } }, compaction: { enabled: false }, cacheWarming: 'off', enableAnalytics: false, enableInstallTelemetry: false });
    const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, 'agent'), settingsManager: settings,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: sessionInput.systemPrompt }); await loader.reload();
    const model = sessionInput.runtime.modelRuntime.getModel(sessionInput.profile.provider, sessionInput.profile.model); assert.ok(model);
    const customTools = sessionInput.tools.map(tool => ({ ...tool, async execute(...args: Parameters<typeof tool.execute>) {
      const result = await tool.execute(...args); input.afterTool?.(); return result;
    } }));
    const { session } = await createAgentSession({ cwd, agentDir: join(cwd, 'agent'), modelRuntime: sessionInput.runtime.modelRuntime, model,
      thinkingLevel: sessionInput.profile.reasoningEffort, noTools: 'all', tools: ['submit_configurator_proposal'], customTools,
      resourceLoader: loader, settingsManager: settings, sessionManager: manager });
    assert.deepEqual(session.getActiveToolNames(), ['submit_configurator_proposal']);
    const checkpoint = () => ({ sessionId: manager.getSessionId(), sessionPath: manager.getSessionFile() ?? null, candidateLeafId: manager.getLeafId() });
    let disposed = false;
    return {
      identity: sessionInput.identity, activeToolNames: session.getActiveToolNames(), checkpoint, subscribe: () => () => undefined,
      async abortAndDispose() { if (disposed) return; disposed = true; await session.abort(); session.dispose(); input.stats.disposed += 1; },
      async prompt(prompt: PiPromptInput) {
        const context = ConfiguratorContextSchema.parse(JSON.parse(prompt.text)); input.stats.contexts.push(context);
        const prepared = context.preparedCharacter; assert.ok(prepared);
        const lived = context.evolutionEvidence.find(item => item.kind === 'admitted-experience' && item.experience.envelope.kind === 'belief'); assert.ok(lived);
        const proposal = ConfiguratorProposalSchema.parse({ kind: 'identity-promotion-proposal', sourceRevision: context.source.revision, targetRevision: context.target.revision,
          sourceHash: context.source.contentHash, targetHash: context.target.contentHash, sourceFullHash: context.sourceFullHash, targetFullHash: context.targetFullHash,
          reason: 'Propuesta sintética fundada en una creencia propia, pendiente del operador.', evidenceIds: [lived.evidenceId], sourceIds: [],
          expectedIdentityVersion: prepared.identityVersion, identity: { ...prepared.identity.value, selfConcept: prepared.identity.value.selfConcept + ' Procuro escuchar con paciencia.' },
          effectiveBoundary: 'future-coherent-boundary', unknowns: context.target.unknowns });
        let lastRequest: PiRequestReference | undefined; let rounds = 0;
        await sessionInput.requestPort.recordCheckpointCandidate({ identity: sessionInput.identity, purpose: { kind: 'job-base', baseScope: prompt.scope }, snapshot: checkpoint() });
        session.agent.streamFunction = createBudgetedStreamFunction({ identity: sessionInput.identity, runId: prompt.scope.runId, clockEpochId: sessionInput.runtime.clockEpochId,
          requireWallTime: true, sessionManager: manager, port: sessionInput.requestPort, getScope: () => prompt.scope,
          onRequestReserved(request) { lastRequest = request; }, original(actualModel) {
            input.stats.requests += 1; rounds += 1;
            const toolCall: Extract<AssistantMessage['content'][number], { type: 'toolCall' }> | undefined = rounds === 1 && !input.omitProposal ? { type: 'toolCall', id: 'configurator-proposal', name: 'submit_configurator_proposal', arguments: z.record(z.string(), z.json()).parse(JSON.parse(JSON.stringify(proposal))) } : undefined;
            const message: AssistantMessage = { role: 'assistant', api: actualModel.api, provider: actualModel.provider, model: actualModel.id,
              content: toolCall === undefined ? [] : [toolCall], stopReason: toolCall === undefined ? 'stop' : 'toolUse', timestamp: Date.now(),
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
            const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: toolCall === undefined ? 'stop' : 'toolUse', message }); return stream;
          } });
        await session.agent.prompt(prompt.text);
        const terminal = checkpoint();
        if (lastRequest === undefined || terminal.candidateLeafId === null) return { kind: 'pi-terminal-candidate', candidateId: null, outcome: 'failed', candidateLeafId: terminal.candidateLeafId };
        const lastMessage = session.agent.state.messages.at(-1);
        const outcome = input.incomplete || (lastMessage?.role === 'assistant' && ['error', 'aborted'].includes(lastMessage.stopReason)) ? 'failed' : 'completed';
        await sessionInput.requestPort.recordCheckpointCandidate({ identity: sessionInput.identity, purpose: { kind: 'terminal-candidate', baseScope: prompt.scope, outcome, lastRequest }, snapshot: terminal });
        input.afterTerminal?.(terminal);
        return { kind: 'pi-terminal-candidate', candidateId: null, outcome, candidateLeafId: terminal.candidateLeafId };
      },
    };
  };
}
