import { chmodSync, mkdirSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type AssistantMessageEvent, type AssistantMessageEventStream, type Model, type SimpleStreamOptions, type TranscriptContext } from '@earendil-works/pi-ai';
import { type AgentSession, type AgentSessionEvent, createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TSchema } from 'typebox';
import { z } from 'zod';
import { DEFAULT_INFERENCE_PROFILE, LEGACY_INFERENCE_PROFILE, PersistedInferenceProfileSchema, SelectableInferenceProfileSchema, StoredPiProfileSchema, resolveStoredPiProfile, isInferenceAuthenticationMethodAllowed, type PersistedInferenceProfile, type StoredPiProfile } from '../domain/inference-profile.ts';
import {
  CharacterIdSchema, FictionalInstantSchema, HashSchema, JobIdSchema, PerceptionIdSchema,
  PulseIdSchema, RevisionSchema, RunIdSchema, WorldSeqSchema,
} from '../domain/values.ts';
import { SceneIdSchema } from '../domain/world-schema.ts';

const AdminRoleSchema = z.enum(['continuista', 'director', 'configurador', 'narrador']);
const PiIdentitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('actor'), characterId: CharacterIdSchema }),
  z.strictObject({ kind: z.literal('admin'), role: AdminRoleSchema }),
]);
const RequestScopeSchema = z.strictObject({
  runId: RunIdSchema,
  pulseId: PulseIdSchema,
  jobId: JobIdSchema,
  generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
const ActorJobLeaseSchema = z.strictObject({ ownerToken: z.string().uuid(), claimToken: z.string().uuid() });
const PiActorInputCutSchema = z.strictObject({
  worldRevision: RevisionSchema, worldSeq: WorldSeqSchema, fictionalAt: FictionalInstantSchema,
  perceptionIds: z.array(PerceptionIdSchema).max(100_000),
  activeSceneId: SceneIdSchema.nullable().optional(),
}).superRefine((cut, context) => {
  if (new Set(cut.perceptionIds).size !== cut.perceptionIds.length) {
    context.addIssue({ code: 'custom', path: ['perceptionIds'], message: 'El corte de Pi repite percepciones' });
  }
});
const ActorPiJournalCandidateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('request-input'), candidateId: z.string().uuid(), turnId: z.string().uuid(),
    runId: RunIdSchema, actorId: CharacterIdSchema, scope: RequestScopeSchema,
    lease: ActorJobLeaseSchema.optional(),
    base: z.strictObject({
      sessionId: z.string().min(1), sessionPath: z.string().min(1), preparedContextHash: HashSchema,
      profile: StoredPiProfileSchema,
      sessionRevision: RevisionSchema, committedLeafId: z.string().min(1).nullable(),
    }),
    requestSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    candidateLeafId: z.string().min(1), inputCut: PiActorInputCutSchema,
  }),
  z.strictObject({
    kind: z.literal('terminal-candidate'), candidateId: z.string().uuid(), turnId: z.string().uuid(),
    runId: RunIdSchema, actorId: CharacterIdSchema, scope: RequestScopeSchema,
    lease: ActorJobLeaseSchema.optional(),
    base: z.strictObject({
      sessionId: z.string().min(1), sessionPath: z.string().min(1), preparedContextHash: HashSchema,
      profile: StoredPiProfileSchema,
      sessionRevision: RevisionSchema, committedLeafId: z.string().min(1).nullable(),
    }),
    outcome: z.enum(['completed', 'aborted', 'failed']), lastRequestSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
    candidateLeafId: z.string().min(1).nullable(), inputCut: PiActorInputCutSchema,
  }),
]);
const CheckpointSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fresh') }),
  z.strictObject({ kind: z.literal('initial'), previousSessionPath: z.string().min(1).optional() }),
  z.strictObject({ kind: z.literal('leaf'), sessionPath: z.string().min(1), committedLeafId: z.string().min(1) }),
]);
const ReserveNextResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('busy'), scope: z.literal('concurrency') }),
  z.strictObject({ kind: z.literal('reserved'), requestSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), wallTime: z.strictObject({ reservedMs: z.number().int().positive().max(300_000), clockEpochId: z.string().uuid() }).optional() }),
  z.strictObject({ kind: z.literal('exhausted'), scope: z.enum(['run', 'pulse', 'wall-time', 'legacy-unknown', 'uncertain']) }),
]);
const EligibilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('active') }),
  z.strictObject({ kind: z.literal('inactive'), reason: z.string().min(1).max(120) }),
]);
const PiAdapterFailureCodeSchema = z.enum([
  'EXTENSIONS_LOADED',
  'INVALID_PROMPT',
  'INVALID_TOOL_POLICY',
  'JOB_INACTIVE',
  'MODEL_PROFILE_CHANGED',
  'MODEL_PROFILE_UNAVAILABLE',
  'OAUTH_REQUIRED',
  'AUTH_REQUIRED',
  'CHECKPOINT_CANDIDATE_FAILED',
  'ACTOR_TURN_LEDGER_REQUIRED',
  'PRIVATE_PATH_NOT_ABSOLUTE',
  'PRIVATE_PATH_OUTSIDE_ROOT',
  'PRIVATE_ROOT_NOT_ABSOLUTE',
  'PROMPT_ALREADY_ACTIVE',
  'RESOURCE_LOADER_OPEN',
  'SCOPE_MISMATCH',
  'SDK_SETTINGS_UNSAFE',
  'SESSION_CLOSED',
  'SESSION_CWD_MISMATCH',
  'SESSION_LEAF_MISSING',
  'SESSION_PATH_INVALID',
  'SESSION_PATH_NOT_ABSOLUTE',
  'SESSION_PATH_OUTSIDE_IDENTITY',
  'TOOL_ALLOWLIST_MISMATCH',
]);
const PiAdapterFailureDataSchema = z.object({
  kind: z.literal('piAdapterFailure'),
  code: PiAdapterFailureCodeSchema,
}).passthrough();

export type AdminRole = z.infer<typeof AdminRoleSchema>;
export type PiIdentity = z.infer<typeof PiIdentitySchema>;
export type PiRequestScope = z.infer<typeof RequestScopeSchema>;
export type PiActorInputCut = z.infer<typeof PiActorInputCutSchema>;
type PiActorSessionBase = {
  preparedContextHash: z.infer<typeof HashSchema>;
  profile: StoredPiProfile;
  sessionRevision: z.infer<typeof RevisionSchema>;
  committedLeafId: string | null;
};
type PiActorTurnContext = {
  turnId: string; base: PiActorSessionBase; inputCut: PiActorInputCut;
  lease?: z.infer<typeof ActorJobLeaseSchema>;
};
export type PiSessionCheckpoint = z.infer<typeof CheckpointSchema>;
export type RequestReservationTarget = 'dispatched' | 'completed' | 'ambiguous' | 'undispatched';
export type ReserveNextResult = z.infer<typeof ReserveNextResultSchema>;
export type RequestEligibility = z.infer<typeof EligibilitySchema>;
export type PiAdapterFailureCode = z.infer<typeof PiAdapterFailureCodeSchema>;
export type PiAdapterFailure = Error & z.infer<typeof PiAdapterFailureDataSchema>;
export type PiCustomTool = ToolDefinition<TSchema, unknown, unknown>;

export interface PiCheckpointSnapshot {
  sessionId: string;
  sessionPath: string | null;
  candidateLeafId: string | null;
}

export interface PiRequestReference {
  scope: PiRequestScope;
  requestSeq: number;
}

export type PiCheckpointCandidatePurpose =
  | { kind: 'job-base'; baseScope: PiRequestScope }
  | { kind: 'request-input'; baseScope: PiRequestScope; request: PiRequestReference }
  | {
      kind: 'terminal-candidate';
      baseScope: PiRequestScope;
      outcome: 'completed' | 'aborted' | 'failed';
      lastRequest?: PiRequestReference;
    };

export interface PiCheckpointCandidate {
  identity: PiIdentity;
  purpose: PiCheckpointCandidatePurpose;
  snapshot: PiCheckpointSnapshot;
}

export function isPiAdapterFailure(value: unknown): value is PiAdapterFailure {
  return value instanceof Error && PiAdapterFailureDataSchema.safeParse(value).success;
}

function piAdapterFailure(code: PiAdapterFailureCode, message: string): PiAdapterFailure {
  const details = PiAdapterFailureDataSchema.parse({ kind: 'piAdapterFailure', code });
  return Object.assign(new Error(message), details);
}

type MaybePromise<T> = T | Promise<T>;

export interface PiRequestPort {
  reserveNextRequest(input: {
    purpose: PiIdentity;
    scope: PiRequestScope;
    /** Missing only in historical/nonproduction controlled ports; production always supplies it. */
    clockEpochId?: string;
  }): MaybePromise<ReserveNextResult>;
  transitionReservation(input: {
    purpose: PiIdentity;
    scope: PiRequestScope;
    requestSeq: number;
    target: RequestReservationTarget;
    wallTime?: { clockEpochId: string; monotonicNs: string };
  }): MaybePromise<void>;
  expireReservation?(input: { purpose: PiIdentity; scope: PiRequestScope; requestSeq: number; clockEpochId: string; reason: 'timeout' | 'cancelled' }): MaybePromise<void>;
  settleWallTime?(input: { purpose: PiIdentity; scope: PiRequestScope; requestSeq: number; clockEpochId: string; monotonicNs: string }): MaybePromise<void>;
  checkEligibility(input: { purpose: PiIdentity; scope: PiRequestScope }): MaybePromise<RequestEligibility>;
  /** Records a candidate only; this port never advances the host's committed leaf. */
  recordCheckpointCandidate(input: PiCheckpointCandidate): MaybePromise<void>;
  /** Records the actor session candidate separately; acceptance remains an explicit host operation. */
  recordActorPiCandidate?(input: unknown): MaybePromise<'stored' | 'existing' | void>;
  reportAdapterFault?(input: {
    code: 'checkpoint-candidate-write-failed' | 'reservation-transition-failed' | 'transport-threw' | 'transport-stream-failed';
    target?: RequestReservationTarget;
  }): void;
}

export interface CreatePiRuntimeInput {
  privateDataRoot: string;
}

/** Host-owned shared OAuth/model catalog. Sessions and histories are still identity-scoped. */
export class PiRuntime {
  readonly clockEpochId = randomUUID();
  readonly modelRuntime: ModelRuntime;
  readonly privateDataRoot: string;

  private constructor(input: { modelRuntime: ModelRuntime; privateDataRoot: string }) {
    this.modelRuntime = input.modelRuntime;
    this.privateDataRoot = input.privateDataRoot;
  }

  static async create(input: CreatePiRuntimeInput): Promise<PiRuntime> {
    if (!isAbsolute(input.privateDataRoot)) {
      throw piAdapterFailure('PRIVATE_ROOT_NOT_ABSOLUTE', 'El directorio privado del host debe ser una ruta absoluta.');
    }
    const root = ensurePrivateDirectory(input.privateDataRoot);
    const piDirectory = ensurePrivateDirectory(join(root, 'pi'), root);
    const authDirectory = ensurePrivateDirectory(join(piDirectory, 'auth'), root);
    const modelRuntime = await ModelRuntime.create({
      authPath: join(authDirectory, 'auth.json'),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    return new PiRuntime({ modelRuntime, privateDataRoot: root });
  }
}

export interface CreatePiSessionInput {
  runtime: PiRuntime;
  runId: PiRequestScope['runId'];
  identity: PiIdentity;
  /** Host-selected profile. Historical reopening without it retains legacy behavior. */
  profile?: PersistedInferenceProfile;
  systemPrompt: string;
  checkpoint: PiSessionCheckpoint;
  /** Hash of the context prepared for this actor; required for actor sessions. */
  preparedContextHash?: string;
  /** Accepted checkpoint revision supplied by the host when reopening the session. */
  sessionRevision?: number;
  tools: readonly PiCustomTool[];
  /** Host-owned allowlist keyed by admin role; actor tools have a fixed pair of names. */
  adminToolAllowlist: Readonly<Partial<Record<AdminRole, readonly string[]>>>;
  requestPort: PiRequestPort;
}

export interface PiPromptInput {
  text: string;
  scope: PiRequestScope;
  /** Exact host-projected inbox cursor used to compile this actor's prompt. */
  inputCut?: PiActorInputCut;
  /** Current actor-job lease; candidates from a scheduled job are bound to this claim. */
  lease?: z.infer<typeof ActorJobLeaseSchema>;
}

export interface PiTurnTerminalCandidate {
  kind: 'pi-terminal-candidate';
  candidateId: string | null;
  outcome: 'completed' | 'aborted' | 'failed';
  candidateLeafId: string | null;
}

export type PiSessionEvent =
  | { kind: 'agent_start' }
  | { kind: 'agent_settled'; aborted: boolean }
  | { kind: 'turn_start' }
  | { kind: 'turn_end' }
  | { kind: 'tool_execution_start'; toolCallId: string; toolName: string }
  | { kind: 'tool_execution_update'; toolCallId: string; toolName: string }
  | { kind: 'tool_execution_end'; toolCallId: string; toolName: string; isError: boolean; durationMs?: number };

export interface PiSessionHandle {
  readonly identity: PiIdentity;
  readonly activeToolNames: readonly string[];
  prompt(input: PiPromptInput): Promise<PiTurnTerminalCandidate>;
  subscribe(listener: (event: PiSessionEvent) => void): () => void;
  checkpoint(): PiCheckpointSnapshot;
  abortAndDispose(): Promise<void>;
  /** Actual transport lifetime, which can outlive a timeout result. */
  whenSettled?(): Promise<void>;
}

export type PiStreamFunction = AgentSession['agent']['streamFunction'];

/** Bounded input validation, without shortening actor biographies or ICM text.
 * Accommodates the full160k actor compilation plus its Markdown role contracts. */
export const MAX_PI_SYSTEM_PROMPT_CHARACTERS=2_000_000;
export async function createPiSession(input: CreatePiSessionInput): Promise<PiSessionHandle> {
  const identity = PiIdentitySchema.parse(input.identity);
  const runId = RunIdSchema.parse(input.runId);
  const checkpoint = CheckpointSchema.parse(input.checkpoint);
  const preparedContextHash = identity.kind === 'actor'
    ? input.preparedContextHash === undefined
      ? undefined
      : HashSchema.parse(input.preparedContextHash)
    : undefined;
  const acceptedSessionRevision = identity.kind === 'actor'
    ? input.sessionRevision === undefined
      ? undefined
      : RevisionSchema.parse(input.sessionRevision)
    : undefined;
  const allowedToolNames = verifyToolPolicy({
    identity,
    tools: input.tools,
    adminToolAllowlist: input.adminToolAllowlist,
  });
  if (input.systemPrompt.trim().length === 0 || input.systemPrompt.length > MAX_PI_SYSTEM_PROMPT_CHARACTERS) {
    throw piAdapterFailure('INVALID_PROMPT', 'El prompt de sistema no cumple el límite configurado.');
  }

  const inferenceProfile = PersistedInferenceProfileSchema.parse(input.profile ?? (checkpoint.kind === 'fresh' ? DEFAULT_INFERENCE_PROFILE : LEGACY_INFERENCE_PROFILE));
  if (!SelectableInferenceProfileSchema.safeParse(inferenceProfile).success) throw piAdapterFailure('MODEL_PROFILE_UNAVAILABLE', 'El perfil histórico está disponible sólo para lectura y recuperación sin inferencia.');
  const profile = requireConfiguredModelProfile(input.runtime.modelRuntime, inferenceProfile);
  await requireInferenceAuthentication(input.runtime.modelRuntime, inferenceProfile);
  const paths = identityPaths({
    root: input.runtime.privateDataRoot,
    runId,
    identity,
  });
  const sessionManager = openIdentitySessionManager({
    paths,
    checkpoint,
  });
  const settingsManager = SettingsManager.inMemory({
    retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
    compaction: { enabled: false },
    cacheWarming: 'off',
    enableInstallTelemetry: false,
    enableAnalytics: false,
    defaultThinkingLevel: inferenceProfile.reasoningEffort,
  });
  assertSettingsClosed(settingsManager);
  const resourceLoader = new DefaultResourceLoader({
    cwd: paths.cwd,
    agentDir: paths.agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: input.systemPrompt,
  });
  await resourceLoader.reload();
  assertLoaderClosed(resourceLoader, input.systemPrompt);

  const { session, extensionsResult } = await createAgentSession({
    cwd: paths.cwd,
    agentDir: paths.agentDir,
    modelRuntime: input.runtime.modelRuntime,
    model: profile,
    thinkingLevel: inferenceProfile.reasoningEffort,
    noTools: 'all',
    tools: [...allowedToolNames],
    customTools: [...input.tools],
    resourceLoader,
    sessionManager,
    settingsManager,
  });

  try {
    assertLoaderResultClosed(extensionsResult);
    assertSessionProfile(session, profile, inferenceProfile, allowedToolNames);
    assertSettingsClosed(settingsManager);
    await requireInferenceAuthentication(input.runtime.modelRuntime, inferenceProfile);
  } catch (error) {
    session.dispose();
    throw error;
  }

  let activeScope: PiRequestScope | undefined;
  let activeActorTurn: PiActorTurnContext | undefined;
  let isPrompting = false;
  let closed = false;
  let lastRequest: PiRequestReference | undefined;
  let lastRequestOutcome: 'completed' | 'aborted' | 'failed' | undefined;
  let promptWasAborted = false;
  let disposePromise: Promise<void> | undefined;
  const unsubscribePromptOutcome = session.subscribe((event) => {
    if (event.type === 'agent_settled' && event.aborted) promptWasAborted = true;
  });
  const budgetedStream = createBudgetedStreamFunction({
    clockEpochId: input.runtime.clockEpochId, requireWallTime: true,
    original: session.agent.streamFunction,
    profile: inferenceProfile,
    getScope: () => activeScope,
    getActorTurnContext: () => activeActorTurn,
    identity,
    runId,
    sessionManager,
    port: input.requestPort,
    async validateBeforeRequest(requestModel, options) {
      assertSessionProfile(session, profile, inferenceProfile, allowedToolNames);
      assertSettingsClosed(settingsManager);
      assertRequestModel(requestModel, profile);
      assertRequestReasoning(options?.reasoning, inferenceProfile);
      await requireInferenceAuthentication(input.runtime.modelRuntime, inferenceProfile);
    },
    onRequestReserved(request) {
      lastRequest = request;
      lastRequestOutcome = undefined;
    },
    onRequestTerminal(request, outcome) {
      lastRequest = request;
      lastRequestOutcome = outcome;
    },
  });

  session.agent.streamFunction = budgetedStream;
  const handle: PiSessionHandle = {
    identity,
    activeToolNames: Object.freeze([...session.getActiveToolNames()]),
    async prompt(promptInput): Promise<PiTurnTerminalCandidate> {
      if (closed) throw piAdapterFailure('SESSION_CLOSED', 'La sesión Pi está cerrada.');
      if (isPrompting || session.isStreaming || budgetedStream.isBusy()) throw piAdapterFailure('PROMPT_ALREADY_ACTIVE', 'La sesión ya está ejecutando un prompt o conserva un transporte pendiente.');
      const text = z.string().trim().min(1).max(32_000).parse(promptInput.text);
      const scope = RequestScopeSchema.parse(promptInput.scope);
      if (scope.runId !== runId) throw piAdapterFailure('SCOPE_MISMATCH', 'La corrida del job no coincide con la sesión.');
      if (identity.kind === 'actor' && input.requestPort.recordActorPiCandidate === undefined) {
        throw piAdapterFailure('ACTOR_TURN_LEDGER_REQUIRED', 'La sesión del actor requiere el ledger durable de turnos antes de generar.');
      }
      if (identity.kind === 'actor' && (preparedContextHash === undefined || acceptedSessionRevision === undefined)) {
        throw piAdapterFailure('ACTOR_TURN_LEDGER_REQUIRED', 'La sesión del actor requiere hash de preparación y revisión aceptada del host.');
      }
      const inputCut = identity.kind === 'actor'
        ? PiActorInputCutSchema.parse(promptInput.inputCut)
        : undefined;
      const lease = identity.kind === 'actor' && promptInput.lease !== undefined
        ? ActorJobLeaseSchema.parse(promptInput.lease)
        : undefined;
      const eligibility = EligibilitySchema.parse(await input.requestPort.checkEligibility({ purpose: identity, scope }));
      if (eligibility.kind === 'inactive') throw piAdapterFailure('JOB_INACTIVE', eligibility.reason);
      assertSessionProfile(session, profile, inferenceProfile, allowedToolNames);
      assertSettingsClosed(settingsManager);
      await requireInferenceAuthentication(input.runtime.modelRuntime, inferenceProfile);
      const turnId = randomUUID();
      lastRequest = undefined;
      lastRequestOutcome = undefined;
      promptWasAborted = false;
      try {
        await input.requestPort.recordCheckpointCandidate({
          identity,
          purpose: { kind: 'job-base', baseScope: scope },
          snapshot: captureJobBaseCheckpoint(sessionManager, checkpoint),
        });
      } catch {
        reportAdapterFault(input.requestPort, { code: 'checkpoint-candidate-write-failed' });
        throw piAdapterFailure('CHECKPOINT_CANDIDATE_FAILED', 'No se pudo registrar el checkpoint base candidato antes del prompt.');
      }
      activeScope = scope;
      if (identity.kind === 'actor' && preparedContextHash !== undefined && acceptedSessionRevision !== undefined
        && inputCut !== undefined) {
        activeActorTurn = {
          turnId,
          base: {
            preparedContextHash,
            profile: inferenceProfile,
            sessionRevision: acceptedSessionRevision,
            committedLeafId: checkpoint.kind === 'leaf' ? checkpoint.committedLeafId : null,
          },
          inputCut,
          ...(lease === undefined ? {} : { lease }),
        };
      }
      isPrompting = true;
      let outcome: 'completed' | 'aborted' | 'failed' = 'failed';
      let promptError: unknown;
      try {
        await session.prompt(text, { expandPromptTemplates: false });
        outcome = promptTerminalOutcome(session, promptWasAborted, lastRequestOutcome);
      } catch (error) {
        promptError = error;
        outcome = promptWasAborted ? 'aborted' : 'failed';
      }
      let terminalResult: PiTurnTerminalCandidate | undefined;
      try {
        const candidate: PiCheckpointCandidate = {
          identity,
          purpose: {
            kind: 'terminal-candidate',
            baseScope: scope,
            outcome,
            ...(lastRequest === undefined ? {} : { lastRequest }),
          },
          snapshot: captureCurrentCheckpoint(sessionManager),
        };
        await input.requestPort.recordCheckpointCandidate(candidate);
        if (identity.kind === 'actor' && activeActorTurn !== undefined) {
          const durableCandidate = makeActorPiCandidate({
            candidate, actorId: identity.characterId, scope, turn: activeActorTurn,
            ...(lastRequest === undefined ? {} : { lastRequest }), outcome,
          });
          await input.requestPort.recordActorPiCandidate?.(durableCandidate);
          terminalResult = {
            kind: 'pi-terminal-candidate', candidateId: durableCandidate.candidateId,
            outcome, candidateLeafId: durableCandidate.candidateLeafId,
          };
        } else {
          terminalResult = {
            kind: 'pi-terminal-candidate', candidateId: null, outcome,
            candidateLeafId: candidate.snapshot.candidateLeafId,
          };
        }
      } catch {
        reportAdapterFault(input.requestPort, { code: 'checkpoint-candidate-write-failed' });
        if (promptError === undefined) {
          promptError = piAdapterFailure('CHECKPOINT_CANDIDATE_FAILED', 'No se pudo registrar el checkpoint terminal candidato.');
        }
      } finally {
        activeScope = undefined;
        activeActorTurn = undefined;
        isPrompting = false;
      }
      if (promptError !== undefined) throw promptError;
      if (terminalResult === undefined) {
        throw piAdapterFailure('CHECKPOINT_CANDIDATE_FAILED', 'No se pudo registrar el candidato terminal Pi.');
      }
      return terminalResult;
    },
    subscribe(listener): () => void {
      if (closed) throw piAdapterFailure('SESSION_CLOSED', 'La sesión Pi está cerrada.');
      return session.subscribe((event) => {
        const projected = projectPiSessionEvent(event);
        if (projected !== undefined) listener(projected);
      });
    },
    checkpoint(): PiCheckpointSnapshot {
      return captureCurrentCheckpoint(sessionManager);
    },
    whenSettled: () => budgetedStream.whenSettled(),
    async abortAndDispose(): Promise<void> {
      if (disposePromise !== undefined) return disposePromise;
      closed = true;
      disposePromise = (async () => {
        try {
          await session.abort();
        } finally {
          await budgetedStream.whenSettled();
          session.dispose();
          unsubscribePromptOutcome();
        }
      })();
      return disposePromise;
    },
  };
  return handle;
}

/**
 * Wrap the exact SDK stream function. The fake stream function used in tests is named and scoped
 * there; production always passes AgentSession.agent.streamFunction, preserving ModelRuntime/OAuth.
 */
export function createBudgetedStreamFunction(input: {
  original: PiStreamFunction;
  clockEpochId?: string;
  /** Mandatory in the production session factory; absent only in older controlled SDK tests. */
  requireWallTime?: boolean;
  clock?: { nowNs(): bigint; schedule(ms: number, callback: () => void): () => void };
  profile?: PersistedInferenceProfile;
  getScope(): PiRequestScope | undefined;
  getActorTurnContext?(): PiActorTurnContext | undefined;
  identity: PiIdentity;
  runId: PiRequestScope['runId'];
  sessionManager: SessionManager;
  port: PiRequestPort;
  validateBeforeRequest?(model: Model<Api>, options: SimpleStreamOptions | undefined): Promise<void>;
  onRequestReserved?(request: PiRequestReference): void;
  onRequestTerminal?(request: PiRequestReference, outcome: 'completed' | 'aborted' | 'failed'): void;
}): PiStreamFunction & { whenSettled(): Promise<void>; isBusy(): boolean } {
  const pending = new Set<Promise<void>>();
  const epoch = z.string().uuid().parse(input.clockEpochId ?? randomUUID());
  const wrapped: PiStreamFunction = (model, context, options) => {
    const output = createAssistantMessageEventStream();
    const operation = dispatchBudgetedRequest({ input: { ...input, clockEpochId: epoch }, model, context, options, output }).catch(() => {
      pushTerminalError(output, model, 'error', 'Falló el control local de la solicitud.');
    });
    pending.add(operation);
    void operation.then(() => pending.delete(operation));
    return output;
  };
  return Object.assign(wrapped, {
    async whenSettled() { while (pending.size > 0) await Promise.all([...pending]); },
    isBusy: () => pending.size > 0,
  });
}

function verifyToolPolicy(input: {
  identity: PiIdentity;
  tools: readonly PiCustomTool[];
  adminToolAllowlist: Readonly<Partial<Record<AdminRole, readonly string[]>>>;
}): readonly string[] {
  const names = input.tools.map((tool) => tool.name);
  const sortedNames = [...names].sort();
  if (new Set(names).size !== names.length) throw piAdapterFailure('INVALID_TOOL_POLICY', 'Hay nombres de tools repetidos.');
  for (const tool of input.tools) {
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(tool.name) || BUILTIN_TOOL_NAMES.has(tool.name)) {
      throw piAdapterFailure('INVALID_TOOL_POLICY', 'El nombre de una tool no está permitido.');
    }
    if ((tool.exposure !== undefined && tool.exposure !== 'direct') || tool.reachesTools !== undefined) {
      throw piAdapterFailure('INVALID_TOOL_POLICY', 'Las tools Pi deben ser directas y no pueden invocar otras tools.');
    }
  }
  switch (input.identity.kind) {
    case 'actor': {
      const actorNames = [...names].sort();
      if (!sameStrings(actorNames, ['propose_action', 'recall_memory'])) {
        throw piAdapterFailure('INVALID_TOOL_POLICY', 'Un actor requiere exactamente recall_memory y propose_action.');
      }
      return Object.freeze(sortedNames);
    }
    case 'admin': {
      const expected = input.adminToolAllowlist[input.identity.role];
      if (expected === undefined) throw piAdapterFailure('INVALID_TOOL_POLICY', 'Falta la allowlist host para el rol administrativo.');
      const validatedNames = z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u)).parse(expected);
      if (new Set(validatedNames).size !== validatedNames.length || !sameStrings(sortedNames, [...validatedNames].sort())) {
        throw piAdapterFailure('INVALID_TOOL_POLICY', 'Las tools registradas no coinciden con la allowlist host del rol.');
      }
      return Object.freeze(sortedNames);
    }
    default: {
      const exhaustive: never = input.identity;
      return exhaustive;
    }
  }
}

async function dispatchBudgetedRequest(input: {
  input: Parameters<typeof createBudgetedStreamFunction>[0];
  model: Model<Api>;
  context: TranscriptContext;
  options: SimpleStreamOptions | undefined;
  output: AssistantMessageEventStream;
}): Promise<void> {
  const scopeValue = input.input.getScope();
  if (scopeValue === undefined) {
    input.output.push(terminalErrorMessage(input.model, 'error', 'La solicitud no tiene un job host activo.'));
    return;
  }
  const scope = RequestScopeSchema.parse(scopeValue);
  if (scope.runId !== input.input.runId) {
    input.output.push(terminalErrorMessage(input.model, 'error', 'El job pertenece a otra corrida.'));
    return;
  }
  const storedProfile = input.input.getActorTurnContext?.()?.base.profile;
  const profile = PersistedInferenceProfileSchema.parse(input.input.profile ?? (storedProfile === undefined ? DEFAULT_INFERENCE_PROFILE : resolveStoredPiProfile(storedProfile)));
  if (!SelectableInferenceProfileSchema.safeParse(profile).success) throw piAdapterFailure('MODEL_PROFILE_UNAVAILABLE', 'El perfil histórico no admite nuevas solicitudes.');
  assertRequiredRequestProfile(input.model, profile);
  assertRequestReasoning(input.options?.reasoning, profile);
  const signal = input.options?.signal;
  if (signal?.aborted) {
    input.output.push(terminalErrorMessage(input.model, 'aborted', 'La solicitud se canceló antes de enviarse.'));
    return;
  }
  const initialEligibility = EligibilitySchema.parse(await input.input.port.checkEligibility({
    purpose: input.input.identity,
    scope,
  }));
  if (initialEligibility.kind === 'inactive') {
    input.output.push(terminalErrorMessage(input.model, 'error', 'El job dejó de estar activo antes de la solicitud.'));
    return;
  }
  await input.input.validateBeforeRequest?.(input.model, input.options);

  let reserveResult: ReserveNextResult;
  try {
    reserveResult = ReserveNextResultSchema.parse(await input.input.port.reserveNextRequest({
      purpose: input.input.identity,
      scope,
      clockEpochId: z.string().uuid().parse(input.input.clockEpochId),
    }));
  } catch {
    input.output.push(terminalErrorMessage(input.model, 'error', 'No se pudo reservar una solicitud de modelo.'));
    return;
  }
  if (reserveResult.kind === 'busy') {
    pushTerminalError(input.output, input.model, 'error', 'El límite de solicitudes simultáneas está ocupado.');
    return;
  }
  if (reserveResult.kind === 'exhausted') {
    input.output.push(terminalErrorMessage(input.model, 'error', 'Se agotó el presupuesto de solicitudes de esta corrida o pulso.'));
    return;
  }
  const requestSeq = reserveResult.requestSeq;
  const requestReference: PiRequestReference = { scope, requestSeq };
  const reservation = { purpose: input.input.identity, scope, requestSeq };
  try {
    input.input.onRequestReserved?.(requestReference);
  } catch {
    reportAdapterFault(input.input.port, { code: 'reservation-transition-failed' });
  }
  const releaseUndispatched = async (): Promise<void> => {
    try {
      await input.input.port.transitionReservation({ ...reservation, target: 'undispatched' });
    } catch {
      reportAdapterFault(input.input.port, { code: 'reservation-transition-failed', target: 'undispatched' });
    }
  };

  const grant = reserveResult.wallTime;
  const clock = input.input.clock ?? { nowNs: () => process.hrtime.bigint(), schedule: (ms: number, callback: () => void) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); } };
  if ((input.input.requireWallTime && grant === undefined) || (grant !== undefined && (grant.clockEpochId !== input.input.clockEpochId || input.input.port.expireReservation === undefined || input.input.port.settleWallTime === undefined))) {
    await releaseUndispatched();
    notifyRequestTerminal(input.input, requestReference, 'failed');
    pushTerminalError(input.output, input.model, 'error', 'Falta el permiso durable de tiempo de modelo.');
    return;
  }
  let startedNs: bigint | undefined;
  let preDispatchStage: 'lifecycle' | 'checkpoint-candidate' | 'profile' | 'dispatched-state' = 'lifecycle';
  try {
    if (signal?.aborted) {
      await releaseUndispatched();
      notifyRequestTerminal(input.input, requestReference, 'aborted');
      input.output.push(terminalErrorMessage(input.model, 'aborted', 'La solicitud se canceló antes de enviarse.'));
      return;
    }
    const preDispatchEligibility = EligibilitySchema.parse(await input.input.port.checkEligibility({
      purpose: input.input.identity,
      scope,
    }));
    if (preDispatchEligibility.kind === 'inactive') {
      await releaseUndispatched();
      notifyRequestTerminal(input.input, requestReference, 'failed');
      input.output.push(terminalErrorMessage(input.model, 'error', 'El job dejó de estar activo antes de la solicitud.'));
      return;
    }

    const checkpoint: PiCheckpointCandidate = {
      identity: input.input.identity,
      purpose: {
        kind: 'request-input',
        baseScope: scope,
        request: requestReference,
      } satisfies PiCheckpointCandidatePurpose,
      snapshot: captureCurrentCheckpoint(input.input.sessionManager),
    };
    preDispatchStage = 'checkpoint-candidate';
    await input.input.port.recordCheckpointCandidate(checkpoint);
    const actorTurn = input.input.getActorTurnContext?.();
    if (actorTurn !== undefined && input.input.identity.kind === 'actor') {
      const actorCandidate = makeActorPiCandidate({
        candidate: checkpoint, actorId: input.input.identity.characterId, scope,
        turn: actorTurn, request: requestReference,
      });
      if (input.input.port.recordActorPiCandidate === undefined) {
        throw new Error('Falta el ledger durable de turnos Pi');
      }
      await input.input.port.recordActorPiCandidate(actorCandidate);
    }
    if (signal?.aborted) {
      await releaseUndispatched();
      notifyRequestTerminal(input.input, requestReference, 'aborted');
      input.output.push(terminalErrorMessage(input.model, 'aborted', 'La solicitud se canceló antes de enviarse.'));
      return;
    }
    preDispatchStage = 'lifecycle';
    const finalEligibility = EligibilitySchema.parse(await input.input.port.checkEligibility({
      purpose: input.input.identity,
      scope,
    }));
    if (finalEligibility.kind === 'inactive') {
      await releaseUndispatched();
      notifyRequestTerminal(input.input, requestReference, 'failed');
      input.output.push(terminalErrorMessage(input.model, 'error', 'El job dejó de estar activo antes de la solicitud.'));
      return;
    }
    preDispatchStage = 'profile';
    await input.input.validateBeforeRequest?.(input.model, input.options);
    if (signal?.aborted) {
      await releaseUndispatched();
      notifyRequestTerminal(input.input, requestReference, 'aborted');
      input.output.push(terminalErrorMessage(input.model, 'aborted', 'La solicitud se canceló antes de enviarse.'));
      return;
    }
    preDispatchStage = 'dispatched-state';
    startedNs = clock.nowNs();
    await input.input.port.transitionReservation({ ...reservation, target: 'dispatched', ...(grant === undefined ? {} : { wallTime: { clockEpochId: grant.clockEpochId, monotonicNs: startedNs.toString() } }) });
  } catch {
    if (preDispatchStage === 'dispatched-state') {
      await transitionAfterDispatch(input.input.port, reservation, 'ambiguous', grant === undefined ? undefined : { clockEpochId: grant.clockEpochId, monotonicNs: clock.nowNs().toString() });
    } else {
      await releaseUndispatched();
    }
    notifyRequestTerminal(input.input, requestReference, signal?.aborted ? 'aborted' : 'failed');
    if (preDispatchStage === 'checkpoint-candidate') {
      reportAdapterFault(input.input.port, { code: 'checkpoint-candidate-write-failed' });
    } else if (preDispatchStage === 'dispatched-state') {
      reportAdapterFault(input.input.port, { code: 'reservation-transition-failed', target: 'dispatched' });
    }
    input.output.push(terminalErrorMessage(input.model, 'error', 'No se pudo completar el control local antes del despacho.'));
    return;
  }
  if (grant !== undefined && startedNs !== undefined) {
    await dispatchTimedTransport({ ...input, reservation, requestReference, grant, clock, startedNs });
    return;
  }
  if (signal?.aborted) {
    await transitionAfterDispatch(input.input.port, reservation, 'ambiguous');
    notifyRequestTerminal(input.input, requestReference, 'aborted');
    input.output.push(terminalErrorMessage(input.model, 'aborted', 'La solicitud se canceló antes de enviarse.'));
    return;
  }

  let source: AssistantMessageEventStream;
  try {
    source = await input.input.original(input.model, input.context, {
      ...input.options,
      maxRetries: 0,
    });
  } catch {
    reportAdapterFault(input.input.port, { code: 'transport-threw' });
    await transitionAfterDispatch(input.input.port, reservation, 'ambiguous');
    notifyRequestTerminal(input.input, requestReference, signal?.aborted ? 'aborted' : 'failed');
    input.output.push(terminalErrorMessage(input.model, signal?.aborted ? 'aborted' : 'error', 'El transporte terminó sin una respuesta confirmada.'));
    return;
  }

  let terminalSeen = false;
  try {
    for await (const event of source) {
      if (event.type === 'done' || event.type === 'error') {
        terminalSeen = true;
        const target = event.type === 'error' && event.reason === 'aborted' ? 'ambiguous' : 'completed';
        const transition = await transitionAfterDispatch(input.input.port, reservation, target);
        if (!transition) {
          reportAdapterFault(input.input.port, { code: 'reservation-transition-failed', target });
          notifyRequestTerminal(input.input, requestReference, 'failed');
          input.output.push(terminalErrorMessage(input.model, 'error', 'La respuesta no pudo registrarse en el journal.'));
          return;
        }
        notifyRequestTerminal(
          input.input,
          requestReference,
          event.type === 'done' ? 'completed' : event.reason === 'aborted' ? 'aborted' : 'failed',
        );
      }
      input.output.push(event);
    }
  } catch {
    reportAdapterFault(input.input.port, { code: 'transport-stream-failed' });
    await transitionAfterDispatch(input.input.port, reservation, 'ambiguous');
    notifyRequestTerminal(input.input, requestReference, signal?.aborted ? 'aborted' : 'failed');
    input.output.push(terminalErrorMessage(input.model, signal?.aborted ? 'aborted' : 'error', 'El stream del proveedor terminó sin respuesta confirmada.'));
    return;
  }
  if (!terminalSeen) {
    await transitionAfterDispatch(input.input.port, reservation, 'ambiguous');
    notifyRequestTerminal(input.input, requestReference, signal?.aborted ? 'aborted' : 'failed');
    input.output.push(terminalErrorMessage(input.model, signal?.aborted ? 'aborted' : 'error', 'El proveedor cerró el stream sin un evento terminal.'));
  }
}

/** A public timeout terminal does not release ownership of the real provider operation. */
async function dispatchTimedTransport(input: Parameters<typeof dispatchBudgetedRequest>[0] & {
  reservation: { purpose: PiIdentity; scope: PiRequestScope; requestSeq: number };
  requestReference: PiRequestReference;
  grant: { reservedMs: number; clockEpochId: string };
  startedNs: bigint;
  clock: { nowNs(): bigint; schedule(ms: number, callback: () => void): () => void };
}): Promise<void> {
  const controller = new AbortController();
  const deadlineNs = input.startedNs + BigInt(input.grant.reservedMs) * 1_000_000n;
  let expired = false;
  let expiry: Promise<void> | undefined;
  const expire = (reason: 'timeout' | 'cancelled' = 'timeout') => {
    if (expired) return;
    expired = true;
    controller.abort();
    expiry = (async () => {
      try {
        await input.input.port.expireReservation?.({ ...input.reservation, clockEpochId: input.grant.clockEpochId, reason });
      } catch { reportAdapterFault(input.input.port, { code: 'reservation-transition-failed', target: 'ambiguous' }); }
      notifyRequestTerminal(input.input, input.requestReference, 'aborted');
      pushTerminalError(input.output, input.model, 'aborted', reason === 'timeout' ? 'La solicitud superó el tiempo autorizado.' : 'La solicitud fue cancelada después del despacho.');
    })();
  };
  const cancelTimer = input.clock.schedule(Math.max(0, Number((deadlineNs - input.clock.nowNs() + 999_999n) / 1_000_000n)), () => expire());
  const externalSignal = input.options?.signal;
  const cancel = () => expire('cancelled');
  externalSignal?.addEventListener('abort', cancel, { once: true });
  if (externalSignal?.aborted) cancel();
  let terminal: AssistantMessageEvent | undefined;
  let transportFailed = false;
  try {
    if (input.clock.nowNs() >= deadlineNs) expire();
    if (!expired && !externalSignal?.aborted) {
      const source = await input.input.original(input.model, input.context, { ...input.options, signal: controller.signal, maxRetries: 0 });
      for await (const event of source) {
        if (input.clock.nowNs() >= deadlineNs) expire();
        if (expired) continue;
        if (event.type === 'done' || event.type === 'error') terminal = event;
        else input.output.push(event);
      }
    }
  } catch {
    transportFailed = true;
    reportAdapterFault(input.input.port, { code: 'transport-stream-failed' });
  } finally {
    const stoppedNs = input.clock.nowNs();
    if (stoppedNs >= deadlineNs) expire();
    cancelTimer();
    externalSignal?.removeEventListener('abort', cancel);
    if (expired) {
      await expiry;
      try {
        await input.input.port.settleWallTime?.({ ...input.reservation, clockEpochId: input.grant.clockEpochId, monotonicNs: stoppedNs.toString() });
      } catch { reportAdapterFault(input.input.port, { code: 'reservation-transition-failed', target: 'ambiguous' }); }
    } else {
      const completed = !transportFailed && terminal !== undefined && !(terminal.type === 'error' && terminal.reason === 'aborted') && !externalSignal?.aborted;
      const target = completed ? 'completed' : 'ambiguous';
      const stored = await transitionAfterDispatch(input.input.port, input.reservation, target, { clockEpochId: input.grant.clockEpochId, monotonicNs: stoppedNs.toString() });
      if (stored && completed && terminal !== undefined) {
        notifyRequestTerminal(input.input, input.requestReference, terminal.type === 'done' ? 'completed' : 'failed');
        input.output.push(terminal);
      } else {
        notifyRequestTerminal(input.input, input.requestReference, externalSignal?.aborted ? 'aborted' : 'failed');
        pushTerminalError(input.output, input.model, externalSignal?.aborted ? 'aborted' : 'error', 'La solicitud terminó sin una respuesta confirmada dentro del tiempo autorizado.');
      }
    }
  }
}

function notifyRequestTerminal(
  input: Parameters<typeof createBudgetedStreamFunction>[0],
  request: PiRequestReference,
  outcome: 'completed' | 'aborted' | 'failed',
): void {
  try {
    input.onRequestTerminal?.(request, outcome);
  } catch {
    reportAdapterFault(input.port, { code: 'reservation-transition-failed' });
  }
}

function makeActorPiCandidate(input: {
  candidate: PiCheckpointCandidate;
  actorId: z.infer<typeof CharacterIdSchema>;
  scope: PiRequestScope;
  turn: PiActorTurnContext;
  request?: PiRequestReference;
  lastRequest?: PiRequestReference;
  outcome?: 'completed' | 'aborted' | 'failed';
}): z.infer<typeof ActorPiJournalCandidateSchema> {
  const sessionPath = input.candidate.snapshot.sessionPath;
  if (sessionPath === null) throw piAdapterFailure('SESSION_PATH_INVALID', 'El candidato Pi no tiene ruta de sesión durable.');
  const base = {
    sessionId: input.candidate.snapshot.sessionId,
    sessionPath,
    preparedContextHash: input.turn.base.preparedContextHash,
    profile: input.turn.base.profile,
    sessionRevision: input.turn.base.sessionRevision,
    committedLeafId: input.turn.base.committedLeafId,
  };
  if (input.candidate.purpose.kind === 'request-input' && input.request !== undefined) {
    if (input.candidate.purpose.request.requestSeq !== input.request.requestSeq
      || canonicalScope(input.candidate.purpose.request.scope) !== canonicalScope(input.scope)) {
      throw piAdapterFailure('SCOPE_MISMATCH', 'El candidato input Pi no coincide con el request reservado.');
    }
    if (input.candidate.snapshot.candidateLeafId === null) {
      throw piAdapterFailure('SESSION_LEAF_MISSING', 'El input Pi no produjo un leaf candidato.');
    }
    return ActorPiJournalCandidateSchema.parse({
      kind: 'request-input', candidateId: randomUUID(), turnId: input.turn.turnId,
      runId: input.scope.runId, actorId: input.actorId, scope: input.scope, base,
      ...(input.turn.lease === undefined ? {} : { lease: input.turn.lease }),
      requestSeq: input.request.requestSeq,
      candidateLeafId: input.candidate.snapshot.candidateLeafId,
      inputCut: input.turn.inputCut,
    });
  }
  if (input.candidate.purpose.kind === 'terminal-candidate' && input.outcome !== undefined) {
    const lastRequestSeq = input.lastRequest === undefined ? null : input.lastRequest.requestSeq;
    if (input.lastRequest !== undefined && canonicalScope(input.lastRequest.scope) !== canonicalScope(input.scope)) {
      throw piAdapterFailure('SCOPE_MISMATCH', 'El último request Pi no pertenece al mismo job del turno.');
    }
    return ActorPiJournalCandidateSchema.parse({
      kind: 'terminal-candidate', candidateId: randomUUID(), turnId: input.turn.turnId,
      runId: input.scope.runId, actorId: input.actorId, scope: input.scope, base,
      ...(input.turn.lease === undefined ? {} : { lease: input.turn.lease }),
      outcome: input.outcome, lastRequestSeq,
      candidateLeafId: input.candidate.snapshot.candidateLeafId,
      inputCut: input.turn.inputCut,
    });
  }
  throw piAdapterFailure('CHECKPOINT_CANDIDATE_FAILED', 'El checkpoint no corresponde a un candidato input o terminal de actor.');
}

function canonicalScope(scope: PiRequestScope): string {
  return `${scope.runId}:${scope.pulseId}:${scope.jobId}:${scope.generation}`;
}

async function transitionAfterDispatch(
  port: PiRequestPort,
  reservation: { purpose: PiIdentity; scope: PiRequestScope; requestSeq: number },
  target: 'completed' | 'ambiguous',
  wallTime?: { clockEpochId: string; monotonicNs: string },
): Promise<boolean> {
  try {
    await port.transitionReservation({ ...reservation, target, ...(wallTime === undefined ? {} : { wallTime }) });
    return true;
  } catch {
    return false;
  }
}

function reportAdapterFault(
  port: PiRequestPort,
  input: Parameters<NonNullable<PiRequestPort['reportAdapterFault']>>[0],
): void {
  try {
    port.reportAdapterFault?.(input);
  } catch {
    // Diagnostics cannot turn a closed provider stream into an unhandled rejection.
  }
}

export function projectPiSessionEvent(event: AgentSessionEvent): PiSessionEvent | undefined {
  switch (event.type) {
    case 'agent_start':
    case 'turn_start':
      return { kind: event.type };
    case 'agent_settled':
      return { kind: 'agent_settled', aborted: event.aborted };
    case 'turn_end':
      return { kind: 'turn_end' };
    case 'tool_execution_start':
    case 'tool_execution_update':
      return { kind: event.type, toolCallId: event.toolCallId, toolName: event.toolName };
    case 'tool_execution_end':
      return {
        kind: event.type,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
      };
    case 'agent_end':
    case 'message_start':
    case 'message_update':
    case 'message_end':
    case 'compaction_start':
    case 'entry_appended':
    case 'session_info_changed':
    case 'thinking_level_changed':
    case 'compaction_end':
    case 'auto_retry_start':
    case 'auto_retry_end':
    case 'summarization_retry_scheduled':
    case 'summarization_retry_attempt_start':
    case 'summarization_retry_finished':
    case 'bash_execution_update':
    case 'queue_update':
      return undefined;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function terminalErrorMessage(model: Model<Api>, reason: 'error' | 'aborted', message: string): AssistantMessageEvent {
  const error: AssistantMessage = {
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
    stopReason: reason,
    errorMessage: message,
    timestamp: Date.now(),
  };
  return { type: 'error', reason, error };
}

function pushTerminalError(
  output: AssistantMessageEventStream,
  model: Model<Api>,
  reason: 'error' | 'aborted',
  message: string,
): void {
  output.push(terminalErrorMessage(model, reason, message));
}

function captureCurrentCheckpoint(sessionManager: SessionManager): PiCheckpointSnapshot {
  return {
    sessionId: sessionManager.getSessionId(),
    sessionPath: sessionManager.getSessionFile() ?? null,
    candidateLeafId: sessionManager.getLeafId(),
  };
}

function captureJobBaseCheckpoint(
  sessionManager: SessionManager,
  checkpoint: PiSessionCheckpoint,
): PiCheckpointSnapshot {
  const current = captureCurrentCheckpoint(sessionManager);
  return {
    ...current,
    candidateLeafId: checkpoint.kind === 'leaf' ? checkpoint.committedLeafId : null,
  };
}

function promptTerminalOutcome(
  session: AgentSession,
  wasAborted: boolean,
  lastRequestResult: 'completed' | 'aborted' | 'failed' | undefined,
): 'completed' | 'aborted' | 'failed' {
  if (wasAborted || lastRequestResult === 'aborted') return 'aborted';
  const lastAssistant = session.messages.findLast((message) => message.role === 'assistant');
  if (lastAssistant?.stopReason === 'error') return 'failed';
  if (lastAssistant?.stopReason === 'aborted') return 'aborted';
  return lastRequestResult === 'failed' ? 'failed' : 'completed';
}

function requireConfiguredModelProfile(modelRuntime: ModelRuntime, profile: PersistedInferenceProfile): Model<Api> {
  const model = modelRuntime.getModel(profile.provider, profile.model);
  if (model === undefined || model.provider !== profile.provider || model.id !== profile.model || model.api !== profile.api
      || !model.reasoning || model.thinkingLevelMap?.[profile.reasoningEffort] !== profile.reasoningEffort) {
    throw piAdapterFailure('MODEL_PROFILE_UNAVAILABLE', 'El catálogo instalado no ofrece exactamente el perfil seleccionado.');
  }
  return model;
}
function assertRequestModel(requested: Model<Api>, expected: Model<Api>): void {
  if (requested.provider !== expected.provider || requested.id !== expected.id || requested.api !== expected.api) {
    throw piAdapterFailure('MODEL_PROFILE_CHANGED', 'El request efectivo de Pi se apartó del perfil seleccionado.');
  }
}
function assertRequiredRequestProfile(requested: Model<Api>, profile: PersistedInferenceProfile): void {
  if (requested.provider !== profile.provider || requested.id !== profile.model || requested.api !== profile.api || !requested.reasoning
      || requested.thinkingLevelMap?.[profile.reasoningEffort] !== profile.reasoningEffort) {
    throw piAdapterFailure('MODEL_PROFILE_CHANGED', 'El request efectivo de Pi se apartó del modelo y esfuerzo seleccionados.');
  }
}
function assertRequestReasoning(reasoning: SimpleStreamOptions['reasoning'], profile: PersistedInferenceProfile): void {
  if (reasoning !== profile.reasoningEffort) throw piAdapterFailure('MODEL_PROFILE_CHANGED', 'El request efectivo de Pi no conserva el esfuerzo seleccionado.');
}
async function requireInferenceAuthentication(modelRuntime: ModelRuntime, profile: PersistedInferenceProfile): Promise<void> {
  const auth = await modelRuntime.checkAuth(profile.provider);
  if (auth === undefined || !isInferenceAuthenticationMethodAllowed({ provider: profile.provider, method: auth.type })) {
    throw piAdapterFailure(profile.provider === 'openai-codex' ? 'OAUTH_REQUIRED' : 'AUTH_REQUIRED', 'Se requiere autenticación válida del proveedor seleccionado antes de crear o reabrir una sesión Pi.');
  }
}
function assertSessionProfile(session: AgentSession, expected: Model<Api>, profile: PersistedInferenceProfile, allowedToolNames: readonly string[]): void {
  const actual = session.model;
  if (actual === undefined || actual.provider !== expected.provider || actual.id !== expected.id || actual.api !== profile.api || session.thinkingLevel !== profile.reasoningEffort) {
    throw piAdapterFailure('MODEL_PROFILE_CHANGED', 'El SDK Pi no conservó el modelo y esfuerzo seleccionados.');
  }
  const expectedTools = [...session.getActiveToolNames()].sort();
  const callableTools = [...session.getCallableToolNames()].sort();
  if (!sameStrings(expectedTools, callableTools) || !sameStrings(expectedTools, [...allowedToolNames].sort())) throw piAdapterFailure('TOOL_ALLOWLIST_MISMATCH', 'La lista activa y la lista invocable de tools Pi difieren.');
}

function assertSettingsClosed(settings: SettingsManager): void {
  const retry = settings.getRetrySettings();
  const providerRetry = settings.getProviderRetrySettings();
  if (settings.getRetryEnabled() || retry.enabled || retry.maxRetries !== 0 || providerRetry.maxRetries !== 0 ||
      settings.getCompactionEnabled() || settings.getCacheWarmingMode() !== 'off' ||
      settings.getEnableInstallTelemetry() || settings.getEnableAnalytics()) {
    throw piAdapterFailure('SDK_SETTINGS_UNSAFE', 'Pi no conserva los límites locales de retry, compaction, warming o telemetría.');
  }
}

function assertLoaderClosed(loader: DefaultResourceLoader, expectedPrompt: string): void {
  if (loader.getExtensions().extensions.length !== 0 || loader.getSkills().skills.length !== 0 ||
      loader.getPrompts().prompts.length !== 0 || loader.getThemes().themes.length !== 0 ||
      loader.getAgentsFiles().agentsFiles.length !== 0 || loader.getSystemPrompt() !== expectedPrompt ||
      loader.getAppendSystemPrompt().length !== 0) {
    throw piAdapterFailure('RESOURCE_LOADER_OPEN', 'El ResourceLoader incorporó recursos ajenos al contexto explícito del actor.');
  }
}

function assertLoaderResultClosed(result: Awaited<ReturnType<typeof createAgentSession>>['extensionsResult']): void {
  if (result.extensions.length !== 0 || result.errors.length !== 0 || (result.warnings?.length ?? 0) !== 0) {
    throw piAdapterFailure('EXTENSIONS_LOADED', 'El SDK Pi cargó o intentó cargar extensiones en una sesión aislada.');
  }
}

interface IdentityPaths {
  cwd: string;
  agentDir: string;
  sessionDir: string;
}

function identityPaths(input: { root: string; runId: string; identity: PiIdentity }): IdentityPaths {
  const parent = join(input.root, 'runs', input.runId);
  const identityPath = input.identity.kind === 'actor'
    ? join(parent, 'actors', input.identity.characterId)
    : join(parent, 'roles', input.identity.role);
  const identityDirectory = ensurePrivateDirectory(identityPath, input.root);
  return {
    cwd: ensurePrivateDirectory(join(identityDirectory, 'cwd'), input.root),
    agentDir: ensurePrivateDirectory(join(identityDirectory, 'pi-agent'), input.root),
    sessionDir: ensurePrivateDirectory(join(identityDirectory, 'sessions'), input.root),
  };
}

/** @internal Exposed for boundary tests; production callers should go through createPiSession. */
export function openIdentitySessionManager(input: { paths: IdentityPaths; checkpoint: PiSessionCheckpoint }): SessionManager {
  switch (input.checkpoint.kind) {
    case 'fresh':
    case 'initial': {
      if (input.checkpoint.kind === 'initial' && input.checkpoint.previousSessionPath !== undefined) {
        const previousPath = requireAbsolutePath(input.checkpoint.previousSessionPath);
        if (!isPathInside(input.paths.sessionDir, previousPath)) {
          throw piAdapterFailure('SESSION_PATH_OUTSIDE_IDENTITY', 'La sesión forense inicial no pertenece a esta identidad.');
        }
      }
      return SessionManager.create(input.paths.cwd, input.paths.sessionDir);
    }
    case 'leaf': {
      const requestedPath = requireAbsolutePath(input.checkpoint.sessionPath);
      if (!isPathInside(input.paths.sessionDir, requestedPath)) {
        throw piAdapterFailure('SESSION_PATH_OUTSIDE_IDENTITY', 'La sesión registrada no pertenece a esta identidad.');
      }
      const sessionPath = resolveExistingSessionPath(requestedPath, input.paths.sessionDir);
      const manager = SessionManager.open(sessionPath, input.paths.sessionDir, input.paths.cwd);
      if (manager.getHeader()?.cwd !== input.paths.cwd) {
        throw piAdapterFailure('SESSION_CWD_MISMATCH', 'La cabecera de sesión no coincide con el CWD privado de la identidad.');
      }
      if (manager.getEntry(input.checkpoint.committedLeafId) === undefined) {
        throw piAdapterFailure('SESSION_LEAF_MISSING', 'El leaf confirmado no existe en la sesión registrada.');
      }
      if (manager.getLeafId() !== input.checkpoint.committedLeafId) {
        manager.branch(input.checkpoint.committedLeafId);
        manager.appendCustomEntry('personajes.recovery-fence', {
          committedLeafId: input.checkpoint.committedLeafId,
          action: 'resume-from-committed-leaf',
        });
      }
      return manager;
    }
    default: {
      const exhaustive: never = input.checkpoint;
      return exhaustive;
    }
  }
}

function resolveExistingSessionPath(path: string, sessionDir: string): string {
  let resolvedPath: string;
  let resolvedDirectory: string;
  try {
    resolvedPath = realpathSync(requireAbsolutePath(path));
    resolvedDirectory = requireDirectoryPath(sessionDir);
  } catch {
    throw piAdapterFailure('SESSION_PATH_INVALID', 'No se puede abrir la sesión registrada.');
  }
  if (!isPathInside(resolvedDirectory, resolvedPath)) {
    throw piAdapterFailure('SESSION_PATH_OUTSIDE_IDENTITY', 'La sesión registrada no pertenece a esta identidad.');
  }
  return resolvedPath;
}

function requireDirectoryPath(path: string): string {
  return realpathSync(path);
}

function requireAbsolutePath(path: string): string {
  if (!isAbsolute(path)) throw piAdapterFailure('SESSION_PATH_NOT_ABSOLUTE', 'La sesión registrada requiere ruta absoluta.');
  return resolve(path);
}

function isPathInside(parent: string, candidate: string): boolean {
  const relativePath = relative(resolve(parent), resolve(candidate));
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

function ensurePrivateDirectory(path: string, boundary?: string): string {
  if (!isAbsolute(path)) throw piAdapterFailure('PRIVATE_PATH_NOT_ABSOLUTE', 'Las rutas privadas se construyen de forma absoluta.');
  const absolutePath = resolve(path);
  mkdirSync(absolutePath, { recursive: true, mode: 0o700 });
  const canonicalPath = realpathSync(absolutePath);
  if (boundary !== undefined && !isPathInside(boundary, canonicalPath)) {
    throw piAdapterFailure('PRIVATE_PATH_OUTSIDE_ROOT', 'Una ruta privada sale del directorio controlado por el host.');
  }
  chmodSync(canonicalPath, 0o700);
  return canonicalPath;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const BUILTIN_TOOL_NAMES = new Set([
  'read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'powershell',
  'tool_search', 'codemode',
]);
