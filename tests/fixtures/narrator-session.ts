import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import {
  createBudgetedStreamFunction,
  type CreatePiSessionInput,
  type PiRequestReference,
  type PiPromptInput,
} from "../../src/adapters/pi.ts";
import { NarratorContextSchema } from "../../src/domain/narration.ts";

/** Uses real Pi SDK/session/tools/transport accounting with an in-process model stream. */
export function controlledNarratorSessionFactory(input: {
  root: string;
  physicalSessions?: boolean;
  stats?: { requests: number; disposed: number };
  beforeTerminal?: () => void;
  omitNarration?: boolean;
  citeRecordedSubjectivity?: boolean;
}) {
  return async (sessionInput: CreatePiSessionInput) => {
    assert.deepEqual(sessionInput.identity, {
      kind: "admin",
      role: "narrador",
    });
    assert.ok(sessionInput.profile);
    const identityRoot = input.physicalSessions
      ? join(input.root, "runs", sessionInput.runId, "roles", "narrador")
      : undefined;
    const cwd = identityRoot
      ? join(identityRoot, "cwd")
      : join(input.root, `sdk-narrator-${randomUUID()}`);
    mkdirSync(cwd, { recursive: true });
    const manager = SessionManager.create(
      cwd,
      identityRoot ? join(identityRoot, "sessions") : join(cwd, "sessions"),
    );
    const settings = SettingsManager.inMemory({
      retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
      compaction: { enabled: false },
      cacheWarming: "off",
      enableAnalytics: false,
      enableInstallTelemetry: false,
    });
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: join(cwd, "agent"),
      settingsManager: settings,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: sessionInput.systemPrompt,
    });
    await loader.reload();
    const model = sessionInput.runtime.modelRuntime.getModel(
      sessionInput.profile.provider,
      sessionInput.profile.model,
    );
    assert.ok(model);
    const { session } = await createAgentSession({
      cwd,
      agentDir: join(cwd, "agent"),
      modelRuntime: sessionInput.runtime.modelRuntime,
      model,
      thinkingLevel: sessionInput.profile.reasoningEffort,
      noTools: "all",
      tools: ["submit_narration"],
      customTools: [...sessionInput.tools],
      resourceLoader: loader,
      settingsManager: settings,
      sessionManager: manager,
    });
    const checkpoint = () => ({
      sessionId: manager.getSessionId(),
      sessionPath: manager.getSessionFile() ?? null,
      candidateLeafId: manager.getLeafId(),
    });
    return {
      identity: sessionInput.identity,
      activeToolNames: session.getActiveToolNames(),
      checkpoint,
      subscribe: () => () => undefined,
      async abortAndDispose() {
        await session.abort();
        session.dispose();
        if (input.stats !== undefined) input.stats.disposed += 1;
      },
      async prompt(prompt: PiPromptInput) {
        const context = NarratorContextSchema.parse(JSON.parse(prompt.text));
        let lastRequest: PiRequestReference | undefined;
        let requests = 0;
        await sessionInput.requestPort.recordCheckpointCandidate({
          identity: sessionInput.identity,
          purpose: { kind: "job-base", baseScope: prompt.scope },
          snapshot: checkpoint(),
        });
        session.agent.streamFunction = createBudgetedStreamFunction({
          identity: sessionInput.identity,
          runId: prompt.scope.runId,
          clockEpochId: sessionInput.runtime.clockEpochId,
          requireWallTime: true,
          sessionManager: manager,
          port: sessionInput.requestPort,
          getScope: () => prompt.scope,
          onRequestReserved(request) {
            lastRequest = request;
          },
          original(actualModel) {
            requests += 1;
            if (input.stats !== undefined) input.stats.requests += 1;
            const event = context.confirmedEvents.at(-1);
            const observation = {
              kind: "narrate" as const,
              text: input.citeRecordedSubjectivity
                ? "El personaje deseaba comprender la situación de prueba."
                : "Narración sintética de un estado confirmado.",
              sourceRecordedFactIds: input.citeRecordedSubjectivity
                ? context.recordedWorldFacts
                    .filter((fact) => fact.kind === "subjective-state-recorded")
                    .slice(0, 1)
                    .map((fact) => fact.factId)
                : [],
              sourceEventIds: event === undefined ? [] : [event.id],
              sourceWorldRevision: context.scope.worldRevision,
              uncertainty: { kind: "none" as const },
            };
            const toolCall =
              requests === 1 && !input.omitNarration
                ? ({
                    type: "toolCall",
                    id: "narrator-observation",
                    name: "submit_narration",
                    arguments: observation,
                  } satisfies {
                    type: "toolCall";
                    id: string;
                    name: string;
                    arguments: typeof observation;
                  })
                : undefined;
            const message: AssistantMessage = {
              role: "assistant",
              api: actualModel.api,
              provider: actualModel.provider,
              model: actualModel.id,
              content: toolCall === undefined ? [] : [toolCall],
              stopReason: toolCall === undefined ? "stop" : "toolUse",
              timestamp: Date.now(),
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: 0,
                },
              },
            };
            const stream = createAssistantMessageEventStream();
            stream.push({
              type: "done",
              reason: toolCall === undefined ? "stop" : "toolUse",
              message,
            });
            return stream;
          },
        });
        await session.agent.prompt(prompt.text);
        input.beforeTerminal?.();
        const terminal = checkpoint();
        assert.ok(lastRequest);
        assert.ok(terminal.candidateLeafId);
        await sessionInput.requestPort.recordCheckpointCandidate({
          identity: sessionInput.identity,
          purpose: {
            kind: "terminal-candidate",
            baseScope: prompt.scope,
            outcome: "completed",
            lastRequest,
          },
          snapshot: terminal,
        });
        return {
          kind: "pi-terminal-candidate",
          candidateId: null,
          outcome: "completed",
          candidateLeafId: terminal.candidateLeafId,
        } satisfies {
          kind: "pi-terminal-candidate";
          candidateId: null;
          outcome: "completed";
          candidateLeafId: string;
        };
      },
    };
  };
}
