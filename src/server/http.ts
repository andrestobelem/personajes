import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  CatalogAvatarReadSchema, CatalogDocumentReadSchema,
  listAvatars, listCharacters, listLibraryDocuments, loadCatalog, readAvatar,
  readDossier, readLibraryDocument, searchCatalog,
  type LoadedCatalog,
} from '../adapters/catalog.ts';
import {
  ApiProblemErrorSchema, ApiProblemSchema, AvatarPageSchema, AvatarSummarySchema, BOOTSTRAP_META_NAME,
  BootstrapRequestSchema, CatalogCharacterSummarySchema, CatalogPageSchema,
  CatalogSearchPageSchema, CatalogSearchResultSchema,
  DossierResponseSchema, LibraryDocumentSummarySchema, LibraryPageSchema,
  ObserverViewRequestSchema, ObserverViewResponseSchema, PageCursorSchema, ResearchPageSchema,
  ResearchDocumentResponseSchema, RunConfigurationDraftPageSchema, RunConfigurationDraftSummarySchema, RunConfigurationDraftViewSchema,
  RunConfigurationDraftMutationReceiptSchema, RunConfigurationValidationReceiptSchema,
  RunConfigurationDraftValidationViewSchema, SessionCreatedSchema, SessionModeSchema,
  SessionViewSchema, TextDocumentResponseSchema, HumanInterventionAcceptedSchema,
  PiIntegrationStatusSchema, PiOAuthJobViewSchema, PiOAuthJobPageSchema, PiOAuthJobReceiptSchema, PiOAuthInteractionViewSchema,
  PiAccessJobViewSchema, PiAccessJobPageSchema, PiAccessJobReceiptSchema, PiAccessCheckRequestSchema, PiAccessStatusMetadataSchema,
  RunPreflightRequestSchema, RunPreflightJobPageSchema, RunPreflightJobDocumentSchema, RunPreflightJobReceiptSchema,
  RunViewSchema, RunControlApplicationResultSchema, RunControlReceiptSchema,
  type ApiProblem, type SessionMode,
} from '../domain/http.ts';
import type { SelectableInferenceProfile } from '../domain/inference-profile.ts';
import { RunLifecycleControlRequestSchema, type RunLifecycleControlRequest } from '../domain/run-lifecycle.ts';
import { DEFAULT_INFERENCE_PROFILE } from '../domain/inference-profile.ts';
import { RunPreflightJobStartResultSchema, RunPreflightJobMutationResultSchema } from '../domain/run-preflight-jobs.ts';
import { HumanInterventionRequestSchema, HumanInteractionContextSchema } from '../domain/interaction.ts';
import {
  HumanInterventionCommitResultSchema, RunDraftMutationResultSchema, RunDraftPatchSchema,
  RunDraftStateSchema, RunDraftValidationResultSchema, RunStepJobViewSchema,
} from '../domain/world-journal.ts';
import {
  CatalogCharacterEntrySchema, CatalogDocumentEntrySchema, DossierSchema,
} from '../domain/catalog.ts';
import { CharacterIdSchema, JobIdSchema, RunIdSchema } from '../domain/values.ts';
import { RunConfigurationDraftSchema } from '../domain/production.ts';
import { validateRunConfiguration } from '../application/production-preflight.ts';
import { RunModelTimeBudgetSchema } from '../domain/model-time-budget.ts';
import { OperatorResponseSchema, type OperatorExtension, type OperatorRequest } from './operator-extension.ts';
import { InspectorCharactersSchema, InspectorRequestSchema, InspectorViewSchema } from '../domain/run-inspector.ts';
import type { RunInspectorApplication } from '../application/run-inspector.ts';

import { RunStageViewSchema, ConfirmedEventPageSchema, ConversationPageSchema, TechnicalJobPageSchema } from '../domain/run-observation.ts';
import { WorldSeqSchema } from '../domain/values.ts';
import { RunRefreshSchema, type RunRefresh } from '../domain/run-refresh.ts';
import type { createHostRequestBarrier } from '../application/host-request-barrier.ts';

const ObservationSequenceQuerySchema = z.string().regex(/^(0|[1-9]\d{0,15})$/).transform(Number).pipe(WorldSeqSchema);
const ObservationStageQuerySchema = z.strictObject({atWorldSeq:ObservationSequenceQuerySchema.optional()});
const ObservationEventsQuerySchema = z.strictObject({fromWorldSeq:ObservationSequenceQuerySchema.optional(),toWorldSeq:ObservationSequenceQuerySchema.optional(),
  pageCursor:z.string().min(1).max(2048).optional(),limit:z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional()});
const ObservationJobsQuerySchema = z.strictObject({cursor:z.string().min(1).max(2048).optional(),limit:z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional()});
export type RunObservationApplicationPort = {
  readStage(input:unknown):unknown|Promise<unknown>;
  readEvents(input:unknown):unknown|Promise<unknown>;
  readConversations(input:unknown):unknown|Promise<unknown>;
  readJobs(input:unknown):unknown|Promise<unknown>;
};

const SESSION_COOKIE = 'personajes_session';
const SESSION_IDLE_TTL_MS = 30 * 60 * 1_000;
const BOOTSTRAP_TTL_MS = 60 * 1_000;
const MAX_JSON_BODY_BYTES = 1_048_576;
const MAX_PENDING_BOOTSTRAPS = 4_096;
const MAX_SESSION_OPERATIONS = 512;
const DEFAULT_PAGE_SIZE = 25;
const CSP = "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'; form-action 'self'";
export const StaticAssetMimeSchema = z.enum([
  'text/javascript', 'text/css', 'image/svg+xml', 'image/png', 'image/jpeg',
  'image/webp', 'image/gif', 'font/woff2', 'application/wasm',
]);
export type StaticAssetMime = z.infer<typeof StaticAssetMimeSchema>;
export const LocalStaticAssetSchema = z.strictObject({
  bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= 50_000_000),
  mimeType: StaticAssetMimeSchema,
});
export type LocalStaticAsset = Readonly<z.infer<typeof LocalStaticAssetSchema>>;

const PageQuerySchema = z.strictObject({
  cursor: PageCursorSchema.optional(),
  limit: z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
});
const ResearchQuerySchema = PageQuerySchema.extend({ query: z.string().trim().min(1).max(200).optional() }).strict();
const CatalogQuerySchema = PageQuerySchema.extend({ query: z.string().trim().min(1).max(200).optional() }).strict();
const IdempotencyKeySchema = z.string().uuid();
const SlugSchema = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/);
const RunConfigurationDraftRequestSchema = z.strictObject({ configuration: RunConfigurationDraftSchema });
const ValidateRunConfigurationDraftRequestSchema = z.strictObject({});
const PiOAuthLoginRequestSchema = z.strictObject({});
const PiOAuthInteractionQuerySchema = z.strictObject({ after: z.string().regex(/^(0|[1-9]\d{0,15})$/).transform(Number)
  .pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)).optional() });
const PiOAuthJobStartResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('created'), job: PiOAuthJobViewSchema }),
  z.strictObject({ kind: z.literal('existing'), job: PiOAuthJobViewSchema }),
  z.strictObject({ kind: z.literal('idempotencyConflict') }),
]);
const PiOAuthJobCancelResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.enum(['updated', 'existing', 'terminal', 'stale']), job: PiOAuthJobViewSchema }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('idempotencyConflict') }),
]);
const PiAccessJobStartResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.enum(['created', 'existing']), job: PiAccessJobViewSchema }),
  z.strictObject({ kind: z.literal('idempotencyConflict') }),
]);
const PiAccessJobCancelResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.enum(['updated', 'existing', 'terminal', 'stale']), job: PiAccessJobViewSchema }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('idempotencyConflict') }),
]);
const PiAccessJobReadResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('found'), job: PiAccessJobViewSchema }),
  z.strictObject({ kind: z.literal('missing') }),
]);
export type PiAccessJobReadResult = z.infer<typeof PiAccessJobReadResultSchema>;
const RunPreflightJobReadResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('found'), job: RunPreflightJobDocumentSchema.shape.job, report: RunPreflightJobDocumentSchema.shape.report }),
  z.strictObject({ kind: z.literal('missing') }),
]);
const PiOAuthPortStatusResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('status'), value: z.strictObject({
    provider: z.literal('openai-codex'),
    configuration: z.enum(['oauth-configured', 'oauth-required']),
    accountAccess: z.literal('not-verified'),
  }) }),
  z.strictObject({ kind: z.literal('failed'), code: z.enum(['OAUTH_BUSY', 'OAUTH_CANCELLED', 'OAUTH_LOGIN_FAILED', 'OAUTH_LOGOUT_FAILED', 'OAUTH_STATUS_UNAVAILABLE']) }),
]);
const HealthViewSchema = z.strictObject({
  kind: z.enum(['ok', 'degraded', 'unavailable']),
  checks: z.strictObject({
    http: z.enum(['ok', 'degraded', 'unavailable']),
    catalog: z.enum(['ok', 'degraded', 'unavailable']),
    runtime: z.enum(['ok', 'degraded', 'unavailable']),
  }),
  version: z.string().min(1).max(80),
});

type SessionOperation = {
  readonly fingerprint: string;
  readonly status: number;
  readonly body: unknown;
  readonly etag: string;
};

type LocalSession = {
  readonly token: string;
  readonly csrfToken: string;
  expiresAtMs: number;
  revision: number;
  mode: SessionMode;
  readonly observerViews: Map<string, 'stage' | 'internal'>;
  /** Process-memory replay for session-local preferences only; never used for world operations. */
  readonly operations: Map<string, SessionOperation>;
};

type BootstrapGrant = { readonly expiresAtMs: number };

export const DurableApiOperationRequestSchema = z.strictObject({
  /** Host-derived stable principal scope; never accepted from request data. */
  principalId: z.string().min(1).max(128).regex(/^[A-Za-z0-9:_-]+$/),
  idempotencyKey: IdempotencyKeySchema,
  method: z.enum(['POST', 'PUT', 'DELETE']),
  path: z.string().min(1).max(2_048).refine((value) => value.startsWith('/api/v1/') && !value.includes('?') && !value.includes('#')),
  /** SHA-256 of normalized method, path, and body; raw request content is not stored here. */
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type DurableApiOperationRequest = z.infer<typeof DurableApiOperationRequestSchema>;

export const DurableApiOperationResponseSchema = z.strictObject({
  status: z.union([z.literal(200), z.literal(201), z.literal(202), z.literal(204)]),
  body: z.unknown().optional(),
  headers: z.partialRecord(z.enum(['ETag', 'Location', 'Retry-After']), z.string().max(1_000)).optional(),
});
export type DurableApiOperationResponse = z.infer<typeof DurableApiOperationResponseSchema>;

export const DurableApiOperationLookupSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('absent') }),
  z.strictObject({
    kind: z.literal('found'),
    request: DurableApiOperationRequestSchema,
    response: DurableApiOperationResponseSchema,
  }),
]);
export type DurableApiOperationLookup = z.infer<typeof DurableApiOperationLookupSchema>;

/**
 * Host persistence contract for run/curation writes. `commit` must run
 * the effect and save its idempotency result in the same host transaction.
 * Domain transactions with stronger aggregate invariants may expose a dedicated port.
 */
export type DurableApiOperationPort<TTransaction = unknown> = {
  lookup(input: Pick<DurableApiOperationRequest, 'principalId' | 'idempotencyKey'>): Promise<DurableApiOperationLookup>;
  commit(input: DurableApiOperationRequest, execute: (transaction: TTransaction) => Promise<DurableApiOperationResponse>): Promise<DurableApiOperationResponse>;
};

/** Durable host port. The HTTP layer derives principal scope and never accepts it from a request. */
export type RunConfigurationDraftApplicationPort = {
  createRunConfigurationDraft(input: unknown): unknown | Promise<unknown>;
  readRunConfigurationDraft(input: unknown): unknown | Promise<unknown>;
  readRunConfigurationDraftValidation(input: unknown): unknown | Promise<unknown>;
  readRunConfigurationDraftState(input: unknown): unknown | Promise<unknown>;
  listRunConfigurationDrafts(input: unknown): unknown | Promise<unknown>;
  updateRunConfigurationDraft(input: unknown): unknown | Promise<unknown>;
  validateRunConfigurationDraft(input: unknown): unknown | Promise<unknown>;
};

/** Administrative OAuth flow. Interaction delivery is ephemeral and session-scoped. */
export type PiOAuthJobsApplicationPort = {
  status(): unknown | Promise<unknown>;
  startLogin(input: { idempotencyKey: string; sessionScope: string }): unknown | Promise<unknown>;
  startLogout(input: { idempotencyKey: string; sessionScope: string }): unknown | Promise<unknown>;
  readJob(input: { jobId: string }): unknown | Promise<unknown>;
  listJobs(input: { offset: number; limit: number }): unknown | Promise<unknown>;
  cancelJob(input: { jobId: string; idempotencyKey: string; expectedRevision: number }): unknown | Promise<unknown>;
  readInteraction(input: { jobId: string; after: number; sessionScope: string }): unknown | Promise<unknown>;
};

/** Explicit checks only. Reads return local durable metadata and never contact a provider. */
export type PiAccessCheckJobsApplicationPort = {
  start(input: { profile: SelectableInferenceProfile; idempotencyKey: string }): unknown | Promise<unknown>;
  readJob(input: { jobId: string }): PiAccessJobReadResult | Promise<PiAccessJobReadResult>;
  listJobs(input: { offset: number; limit: number }): unknown | Promise<unknown>;
  cancelJob(input: { jobId: string; idempotencyKey: string; expectedRevision: number }): unknown | Promise<unknown>;
  readPiAccessStatus?(input: { profile: SelectableInferenceProfile }): unknown | Promise<unknown>;
};

/** No provider probe or fictional authority. The broker validates and captures exact durable Ready scope. */
export type RunPreflightJobsApplicationPort = {
  start(input: { runId: string; expectedConfigurationRevision: number; expectedWorldRevision: number; idempotencyKey: string }): unknown | Promise<unknown>;
  readJob(input: { runId: string; jobId: string }): z.infer<typeof RunPreflightJobReadResultSchema> | Promise<z.infer<typeof RunPreflightJobReadResultSchema>>;
  listJobs(input: { runId: string; offset: number; limit: number }): unknown | Promise<unknown>;
  cancelJob(input: { runId: string; jobId: string; expectedRevision: number; idempotencyKey: string }): unknown | Promise<unknown>;
};

/** The host owns reads, durable idempotency, lifecycle CAS, fresh preflight checks,
 * runtime cancellation/dispatch and step scheduling. HTTP passes only authenticated
 * operator scope plus the exact revisions parsed from If-Match. */
export type RunLifecycleApplicationPort = {
  readStepJob?(input: { readonly runId: string; readonly jobId: string }): unknown | undefined | Promise<unknown | undefined>;
  readRunView(input: { readonly runId: string }): unknown | undefined | Promise<unknown | undefined>;
  controlRun(input: {
    readonly principalId: string;
    readonly idempotencyKey: string;
    readonly runId: string;
    readonly expectedConfigurationRevision: number;
    readonly expectedWorldRevision: number;
    readonly expectedLifecycleRevision: number;
    readonly command: RunLifecycleControlRequest;
  }): unknown | Promise<unknown>;
};

export type LocalHttpOptions = {
  readonly catalog: LoadedCatalog;
  /** Trusted, host-built document shell. The server injects the one-use nonce into a meta element. */
  readonly shellHtml: string | (() => string);
  /** Build outputs registered by the host. Keys are exact URL paths such as `/assets/app-<hash>.js`. */
  readonly staticAssets?: ReadonlyMap<string, LocalStaticAsset>;
  /** The host must verify that a requested fictional mode exists in the current run/configuration. */
  readonly resolveSessionMode?: (candidate: SessionMode) => SessionMode | null | Promise<SessionMode | null>;
  /** Confirms the run exists and the requested stage/internal view is allowed for session opt-in. */
  readonly authorizeObserverView?: (runId: string, mode: 'stage' | 'internal') => boolean | Promise<boolean>;
  /** Returns a privacy-filtered context for the configured participant and run. */
  readonly readHumanInteractionContext?: (input: { readonly runId: string; readonly participantId: string }) => unknown | null | Promise<unknown | null>;
  /** Journal-owned transaction for an intervention and its durable idempotency receipt. */
  readonly commitHumanIntervention?: (input: unknown) => unknown | Promise<unknown>;
  /** Durable drafts; omitted only by hosts that have not composed the production setup service. */
  readonly runConfigurationDrafts?: RunConfigurationDraftApplicationPort;
  /** Shared-host Pi OAuth jobs; omitted only when the production runtime has not been composed. */
  readonly piOAuthJobs?: PiOAuthJobsApplicationPort;
  readonly piAccessJobs?: PiAccessCheckJobsApplicationPort;
  readonly runPreflightJobs?: RunPreflightJobsApplicationPort;
  /** Optional until the host composes the durable lifecycle application service. */
  readonly runLifecycle?: RunLifecycleApplicationPort;
  /** Public, read-only stage/event/delivery/job projections under the host session. */
  readonly runObservation?: RunObservationApplicationPort;
  readonly runInspector?: RunInspectorApplication;
  readonly onInspectorRead?: (metadata: {runId:string;characterId?:string;atWorldSeq?:number;requestId:string}) => void;
  /** Host-composed operator services; core routes and their authority take precedence. */
  readonly operatorExtensions?: readonly OperatorExtension[];
  /** Read-only durable usage snapshot; omitted when the host has no journal budget reader. */
  readonly readRunModelTimeBudget?: (input: { readonly runId: string }) => unknown | Promise<unknown>;
  /** Optional future persistence boundary for other run/curation mutations. */
  readonly durableApiOperations?: DurableApiOperationPort;
  readonly now?: () => number;
  /** Bounded read-notification transport; never a worker or durable stream ledger. */
  readonly runRefreshStream?: { readonly pollIntervalMs?: number; readonly heartbeatMs?: number; readonly maxClients?: number; readonly maxClientsPerSession?: number };
  readonly admissionBarrier?:ReturnType<typeof createHostRequestBarrier>;
  /** Local composition only. Must not probe providers or infer availability from credentials. */
  readonly runtimeComposition?:()=>{kind:'composed'}|{kind:'unavailable'};
};

export type LocalHttpServer = {
  /** Binds only to IPv4 loopback and returns the canonical local origin. */
  listen(port?: number): Promise<{ readonly address: '127.0.0.1'; readonly port: number; readonly origin: string }>;
  close(): Promise<void>;
};

const HTTP_FAILURE_MARKER = Symbol('personajes.http.failure');
const HttpFailureStatusSchema = z.number().int().min(400).max(599);
type HttpFailureInput = { readonly status: z.infer<typeof HttpFailureStatusSchema> } & z.infer<typeof ApiProblemErrorSchema>;
type HttpFailure = Error & {
  readonly status: z.infer<typeof HttpFailureStatusSchema>;
  readonly problem: z.infer<typeof ApiProblemErrorSchema>;
  readonly [HTTP_FAILURE_MARKER]: true;
};

function createHttpFailure(input: HttpFailureInput): HttpFailure {
  const { status, ...details } = input;
  const problem = ApiProblemErrorSchema.parse(details);
  const marker: true = true;
  return Object.assign(new Error(problem.message), { status, problem }, {
    name: 'HttpFailure',
    [HTTP_FAILURE_MARKER]: marker,
  }) satisfies HttpFailure;
}

function isHttpFailure(error: unknown): error is HttpFailure {
  if (!(error instanceof Error)) return false;
  try {
    if (Reflect.get(error, HTTP_FAILURE_MARKER) !== true) return false;
    const status = HttpFailureStatusSchema.safeParse(Reflect.get(error, 'status'));
    const problem = ApiProblemErrorSchema.safeParse(Reflect.get(error, 'problem'));
    return status.success && problem.success && error.message === problem.data.message;
  } catch {
    return false;
  }
}

function fail(input: HttpFailureInput): never {
  throw createHttpFailure(input);
}

function validationFailure(error: z.ZodError): HttpFailure {
  const issues = error.issues.slice(0, 100).map((issue) => ({
    path: issue.path.map((part) => typeof part === 'number' ? part : String(part).slice(0, 120)),
    code: 'INVALID_FIELD',
  }));
  return createHttpFailure({
    status: 422,
    kind: 'validation',
    code: 'VALIDATION_FAILED',
    message: 'La solicitud no cumple el contrato requerido.',
    issues,
  });
}

function parseSchema<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationFailure(result.error);
  return result.data;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return '{' + entries.map(([key, child]) => JSON.stringify(key) + ':' + canonicalJson(child)).join(',') + '}';
}

function encodeCursor(offset: number): string {
  return PageCursorSchema.parse('p1.' + Buffer.from(String(offset), 'utf8').toString('base64url'));
}

function decodeCursor(cursor: string | undefined, length: number): number {
  if (cursor === undefined) return 0;
  const validated = parseSchema(PageCursorSchema, cursor);
  const encoded = validated.slice(3);
  const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  if (!/^(0|[1-9]\d{0,9})$/.test(decoded) || Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) {
    fail({ status: 400, kind: 'validation', code: 'INVALID_CURSOR', message: 'El cursor de página no es válido.', issues: [] });
  }
  const offset = Number(decoded);
  if (!Number.isSafeInteger(offset) || offset > length) {
    fail({ status: 400, kind: 'validation', code: 'INVALID_CURSOR', message: 'El cursor de página no es válido.', issues: [] });
  }
  return offset;
}

function parseQuery<S extends z.ZodType>(url: URL, schema: S): z.output<S> {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams) {
    const previous = Object.hasOwn(raw, key) ? raw[key] : undefined;
    Object.defineProperty(raw, key, {
      value: previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value],
      enumerable: true, configurable: true, writable: true,
    });
  }
  return parseSchema(schema, raw);
}

async function readJsonBody(req: IncomingMessage, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType.trim())) {
    fail({ status: 415, kind: 'validation', code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Se requiere application/json UTF-8.', issues: [] });
  }
  const contentLength = req.headers['content-length'];
  if (typeof contentLength === 'string' && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    req.resume();
    fail({ status: 413, kind: 'validation', code: 'BODY_TOO_LARGE', message: 'La solicitud supera el tamaño permitido.', issues: [] });
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const input: unknown = chunk;
    if (!(input instanceof Uint8Array) && typeof input !== 'string') {
      fail({ status: 400, kind: 'validation', code: 'MALFORMED_REQUEST', message: 'El cuerpo contiene bytes inválidos.', issues: [] });
    }
    const bytes = Buffer.from(input);
    total += bytes.byteLength;
    if (total > maxBytes) {
      req.resume();
      fail({ status: 413, kind: 'validation', code: 'BODY_TOO_LARGE', message: 'La solicitud supera el tamaño permitido.', issues: [] });
    }
    chunks.push(bytes);
  }
  if (total === 0) fail({ status: 400, kind: 'validation', code: 'MALFORMED_REQUEST', message: 'Se requiere un cuerpo JSON.', issues: [] });
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    fail({ status: 400, kind: 'validation', code: 'MALFORMED_REQUEST', message: 'El cuerpo no contiene JSON UTF-8 válido.', issues: [] });
  }
}

function addBaseHeaders(res: ServerResponse, requestId: string): void {
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
}

function sendJson(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.byteLength),
    ...headers,
  });
  res.end(body);
}

function sendProblem(res: ServerResponse, requestId: string, failure: HttpFailure): void {
  const body: ApiProblem = parseSchema(ApiProblemSchema, { error: failure.problem, requestId });
  sendJson(res, failure.status, body, { 'Content-Type': 'application/problem+json; charset=utf-8' });
}

function canonicalLocalOrigin(server: Server): { authority: string; origin: string; port: number } | undefined {
  const address = server.address();
  if (address === null || typeof address === 'string' || address.address !== '127.0.0.1') return undefined;
  return { authority: `127.0.0.1:${address.port}`, origin: `http://127.0.0.1:${address.port}`, port: address.port };
}

function assertRequestSecurity(req: IncomingMessage, server: Server): string {
  const local = canonicalLocalOrigin(server);
  if (local === undefined) {
    fail({ status: 503, kind: 'dependency', code: 'LOCAL_SERVER_UNAVAILABLE', message: 'El servidor local no está disponible.', safeCode: 'LOCAL_SERVER_UNAVAILABLE', retryable: true });
  }
  if (typeof req.headers.host !== 'string' || req.headers.host.toLowerCase() !== local.authority) {
    fail({ status: 403, kind: 'forbidden', code: 'HOST_DENIED', message: 'Host local no permitido.' });
  }
  const fetchSite = req.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string' && fetchSite.toLowerCase() === 'cross-site') {
    fail({ status: 403, kind: 'forbidden', code: 'ORIGIN_DENIED', message: 'Origen de navegador no permitido.' });
  }
  const origin = req.headers.origin;
  if (Array.isArray(origin) || (typeof origin === 'string' && origin !== local.origin)) {
    fail({ status: 403, kind: 'forbidden', code: 'ORIGIN_DENIED', message: 'Origen de navegador no permitido.' });
  }
  const isMutable = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  if (isMutable && origin !== local.origin) {
    fail({ status: 403, kind: 'forbidden', code: 'ORIGIN_DENIED', message: 'El origen canónico es obligatorio para mutaciones.' });
  }
  return local.origin;
}

function parseSegments(pathname: string): string[] {
  if (!pathname.startsWith('/')) fail({ status: 400, kind: 'validation', code: 'MALFORMED_REQUEST', message: 'Ruta no válida.', issues: [] });
  const rawSegments = pathname.slice(1).split('/');
  const segments: string[] = [];
  for (const [index, rawSegment] of rawSegments.entries()) {
    if (rawSegment === '') {
      if (rawSegments.length === 1 || (index === rawSegments.length - 1 && rawSegments.at(-2) !== '')) continue;
      fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Recurso no encontrado.' });
    }
    let segment: string;
    try { segment = decodeURIComponent(rawSegment); }
    catch { fail({ status: 400, kind: 'validation', code: 'MALFORMED_REQUEST', message: 'Ruta no válida.', issues: [] }); }
    if (segment.length === 0 || segment.includes('/') || segment.includes('\\') || segment.includes('\0') || segment === '.' || segment === '..') {
      fail({ status: 400, kind: 'validation', code: 'MALFORMED_REQUEST', message: 'Ruta no válida.', issues: [] });
    }
    segments.push(segment);
  }
  return segments;
}

function parseRequestUrl(req: IncomingMessage, origin: string): URL {
  const rawUrl = req.url;
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/') || rawUrl.startsWith('//')) {
    fail({ status: 400, kind: 'validation', code: 'MALFORMED_REQUEST', message: 'Target HTTP no válido.', issues: [] });
  }
  try {
    const url = new URL(rawUrl, origin);
    if (url.origin !== origin) fail({ status: 400, kind: 'validation', code: 'MALFORMED_REQUEST', message: 'Target HTTP no válido.', issues: [] });
    return url;
  } catch {
    fail({ status: 400, kind: 'validation', code: 'MALFORMED_REQUEST', message: 'Target HTTP no válido.', issues: [] });
  }
}

function injectBootstrapMeta(html: string, nonce: string): string {
  const safeNonce = nonce.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const meta = `<meta name="${BOOTSTRAP_META_NAME}" content="${safeNonce}">`;
  const head = /<head(?:\s[^>]*)?>/i;
  if (head.test(html)) return html.replace(head, (opening) => opening + meta);
  return meta + html;
}

function sessionEtag(session: LocalSession): string {
  return `"session:r${session.revision}"`;
}

function humanInteractionEtag(context: z.infer<typeof HumanInteractionContextSchema>): string {
  return `"world:${context.runId}:r${context.worldRevision}"`;
}

function runConfigurationEtag(runId: string, revision: number): string {
  return `"run-config:${runId}:c${revision}"`;
}

function piOAuthJobEtag(jobId: string, revision: number): string {
  return '"pi-oauth-job:' + jobId + ':r' + String(revision) + '"';
}

function piAccessJobEtag(jobId: string, revision: number): string {
  return '"pi-access:' + jobId + ':r' + String(revision) + '"';
}

function readExpectedPiAccessJobRevision(req: IncomingMessage, jobId: string): number {
  const provided = req.headers['if-match'];
  if (typeof provided !== 'string') fail({ status: 428, kind: 'precondition', code: 'PRECONDITION_REQUIRED', message: 'Se requiere If-Match del chequeo de acceso.' });
  const match = /^"pi-access:([0-9a-f-]{36}):r(0|[1-9][0-9]{0,15})"$/.exec(provided);
  const revisionText = match?.[2];
  if (match?.[1] !== jobId || revisionText === undefined || !Number.isSafeInteger(Number(revisionText))) {
    fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'La revisión no coincide con el chequeo de acceso.' });
  }
  return Number(revisionText);
}

function readExpectedPiOAuthJobRevision(req: IncomingMessage, jobId: string, currentEtag?: string): number {
  const provided = req.headers['if-match'];
  if (typeof provided !== 'string') {
    fail({ status: 428, kind: 'precondition', code: 'PRECONDITION_REQUIRED', message: 'Se requiere If-Match del job OAuth.', ...(currentEtag === undefined ? {} : { currentEtag }) });
  }
  const match = /^"pi-oauth-job:([0-9a-f-]{36}):r(0|[1-9][0-9]{0,15})"$/.exec(provided);
  const matchedJobId = match?.[1];
  const revisionText = match?.[2];
  if (matchedJobId !== jobId || revisionText === undefined || !z.string().uuid().safeParse(matchedJobId).success) {
    fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'La revisión no coincide con este job OAuth.', ...(currentEtag === undefined ? {} : { currentEtag }) });
  }
  const revision = Number(revisionText);
  if (!Number.isSafeInteger(revision)) {
    fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'La revisión del job OAuth no es válida.', ...(currentEtag === undefined ? {} : { currentEtag }) });
  }
  return revision;
}

function readExpectedRunConfigurationRevision(req: IncomingMessage, runId: string, currentEtag?: string): number {
  const provided = req.headers['if-match'];
  if (typeof provided !== 'string') {
    fail({ status: 428, kind: 'precondition', code: 'PRECONDITION_REQUIRED', message: 'Se requiere If-Match de la configuración.', ...(currentEtag === undefined ? {} : { currentEtag }) });
  }
  const match = /^"run-config:([0-9a-f-]{36}):c(0|[1-9]\d{0,15})"$/.exec(provided);
  const matchedRunId = match?.[1];
  const revisionText = match?.[2];
  if (matchedRunId === undefined || revisionText === undefined || matchedRunId !== runId
    || !RunIdSchema.safeParse(matchedRunId).success) {
    fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'La revisión no coincide con este borrador.', ...(currentEtag === undefined ? {} : { currentEtag }) });
  }
  const revision = Number(revisionText);
  if (!Number.isSafeInteger(revision)) {
    fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'La revisión de configuración no es válida.', ...(currentEtag === undefined ? {} : { currentEtag }) });
  }
  return revision;
}

function runEtag(runId: string, configurationRevision: number, worldRevision: number): string {
  return `"run:${runId}:c${configurationRevision}:w${worldRevision}"`;
}

function runViewEtag(view: z.infer<typeof RunViewSchema>): string {
  return `"run:${view.runId}:c${view.configRevision}:w${view.worldRevision}:l${view.lifecycleRevision}"`;
}

function readExpectedRunViewRevisions(req: IncomingMessage, runId: string): {
  expectedConfigurationRevision: number;
  expectedWorldRevision: number;
  expectedLifecycleRevision: number;
} {
  const provided = req.headers['if-match'];
  if (typeof provided !== 'string') {
    fail({ status: 428, kind: 'precondition', code: 'PRECONDITION_REQUIRED', message: 'Se requiere If-Match de la corrida.' });
  }
  const match = /^"run:([0-9a-f-]{36}):c(0|[1-9]\d{0,15}):w(0|[1-9]\d{0,15}):l(0|[1-9]\d{0,15})"$/.exec(provided);
  const matchedRunId = match?.[1];
  const configText = match?.[2];
  const worldText = match?.[3];
  const lifecycleText = match?.[4];
  if (matchedRunId !== runId || !RunIdSchema.safeParse(matchedRunId).success
    || configText === undefined || worldText === undefined || lifecycleText === undefined
    || !Number.isSafeInteger(Number(configText)) || !Number.isSafeInteger(Number(worldText))
    || !Number.isSafeInteger(Number(lifecycleText))) {
    fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'La revisión no coincide con la corrida.' });
  }
  return {
    expectedConfigurationRevision: Number(configText),
    expectedWorldRevision: Number(worldText),
    expectedLifecycleRevision: Number(lifecycleText),
  };
}

function readExpectedRunRevisions(req: IncomingMessage, runId: string): { expectedConfigurationRevision: number; expectedWorldRevision: number } {
  const provided = req.headers['if-match'];
  if (typeof provided !== 'string') fail({ status: 428, kind: 'precondition', code: 'PRECONDITION_REQUIRED', message: 'Se requiere If-Match compuesto de configuración y mundo.' });
  const match = /^"run:([0-9a-f-]{36}):c(0|[1-9]\d{0,15}):w(0|[1-9]\d{0,15})"$/.exec(provided);
  const configurationRevision = match?.[2];
  const worldRevision = match?.[3];
  if (match?.[1] !== runId || configurationRevision === undefined || worldRevision === undefined
    || !Number.isSafeInteger(Number(configurationRevision)) || !Number.isSafeInteger(Number(worldRevision))) {
    fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'La revisión compuesta no coincide con la corrida.' });
  }
  return { expectedConfigurationRevision: Number(configurationRevision), expectedWorldRevision: Number(worldRevision) };
}

function runPreflightJobEtag(jobId: string, revision: number): string {
  return `"run-preflight:${jobId}:r${revision}"`;
}

function readExpectedRunPreflightJobRevision(req: IncomingMessage, jobId: string): number {
  const provided = req.headers['if-match'];
  if (typeof provided !== 'string') fail({ status: 428, kind: 'precondition', code: 'PRECONDITION_REQUIRED', message: 'Se requiere If-Match del trabajo de preflight.' });
  const match = /^"run-preflight:([0-9a-f-]{36}):r(0|[1-9]\d{0,15})"$/.exec(provided);
  const revision = match?.[2];
  if (match?.[1] !== jobId || revision === undefined || !Number.isSafeInteger(Number(revision))) {
    fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'La revisión no coincide con el trabajo de preflight.' });
  }
  return Number(revision);
}

function requireIfNoneMatchStar(req: IncomingMessage): void {
  const provided = req.headers['if-none-match'];
  if (typeof provided !== 'string') {
    fail({ status: 428, kind: 'precondition', code: 'PRECONDITION_REQUIRED', message: 'Se requiere If-None-Match: * para crear un borrador.' });
  }
  if (provided !== '*') {
    fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'La precondición de creación no coincide.' });
  }
}

function enforceJsonWireLimits(value: unknown): void {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined || typeof entry.value !== 'object' || entry.value === null) continue;
    if (entry.depth > 32) {
      fail({ status: 422, kind: 'validation', code: 'JSON_DEPTH_LIMIT', message: 'El JSON supera la profundidad máxima permitida.', issues: [] });
    }
    if (Array.isArray(entry.value)) {
      for (const child of entry.value) pending.push({ value: child, depth: entry.depth + 1 });
      continue;
    }
    const entries = Object.entries(entry.value);
    if (entries.length > 512) {
      fail({ status: 422, kind: 'validation', code: 'JSON_OBJECT_LIMIT', message: 'Un objeto JSON supera la cantidad máxima de propiedades.', issues: [] });
    }
    for (const [, child] of entries) pending.push({ value: child, depth: entry.depth + 1 });
  }
}

function runConfigurationDraftView(input: unknown, stateValue: unknown, reportValue: unknown): z.infer<typeof RunConfigurationDraftViewSchema> {
  const configuration = RunConfigurationDraftSchema.parse(input);
  const state = RunDraftStateSchema.parse(stateValue);
  if (state.runId !== configuration.runId || state.revision !== configuration.revision) throw new Error('El estado de borrador no corresponde a su revisión');
  const hasDurableReport = reportValue !== undefined;
  let validation: z.infer<typeof RunConfigurationDraftValidationViewSchema>;
  if (hasDurableReport) {
    const report = RunDraftValidationResultSchema.parse(reportValue);
    if (!('runId' in report) || report.runId !== configuration.runId || report.revision !== configuration.revision) {
      throw new Error('El reporte de validación no corresponde a su revisión');
    }
    validation = report.kind === 'ready'
      ? RunConfigurationDraftValidationViewSchema.parse({ kind: 'valid', promotion: 'promoted' })
      : RunConfigurationDraftValidationViewSchema.parse({ kind: report.kind, promotion: 'not-promoted', issues: report.issues });
  } else {
    const report = validateRunConfiguration({ draft: configuration });
    if (report.kind === 'ready') {
      if (report.configuration.runId !== configuration.runId || report.configuration.configRevision !== configuration.revision) {
        throw new Error('La configuración validada no corresponde a la revisión del borrador');
      }
      validation = RunConfigurationDraftValidationViewSchema.parse({ kind: 'valid', promotion: 'not-promoted' });
    } else {
      if (report.runId !== null && report.runId !== configuration.runId) throw new Error('El reporte de preflight no corresponde al borrador');
      validation = RunConfigurationDraftValidationViewSchema.parse({ kind: report.kind, promotion: 'not-promoted', issues: report.issues });
    }
  }
  return RunConfigurationDraftViewSchema.parse({
    kind: 'run-configuration-draft', configuration,
    state: { lifecycle: state.lifecycle, configurationRevision: state.configurationRevision, worldRevision: state.worldRevision },
    validation,
  });
}

async function readRunConfigurationDraftView(
  port: RunConfigurationDraftApplicationPort,
  runId: string,
  initialConfiguration?: unknown,
): Promise<z.infer<typeof RunConfigurationDraftViewSchema> | undefined> {
  let configurationValue = initialConfiguration;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const configuration = configurationValue === undefined
      ? await port.readRunConfigurationDraft({ runId })
      : configurationValue;
    configurationValue = undefined;
    if (configuration === undefined) return undefined;
    const parsedConfiguration = RunConfigurationDraftSchema.parse(configuration);
    const stateValue = await port.readRunConfigurationDraftState({ runId });
    if (stateValue === undefined) return undefined;
    const state = RunDraftStateSchema.parse(stateValue);
    if (state.runId !== runId) throw new Error('El estado de borrador refiere otra corrida');
    if (state.revision !== parsedConfiguration.revision) {
      configurationValue = await port.readRunConfigurationDraft({ runId, revision: state.revision });
      continue;
    }
    const report = await port.readRunConfigurationDraftValidation({ runId });
    const stateAfterReportValue = await port.readRunConfigurationDraftState({ runId });
    if (stateAfterReportValue === undefined) return undefined;
    const stateAfterReport = RunDraftStateSchema.parse(stateAfterReportValue);
    if (stateAfterReport.revision !== state.revision || stateAfterReport.lifecycle !== state.lifecycle
      || stateAfterReport.configurationRevision !== state.configurationRevision || stateAfterReport.worldRevision !== state.worldRevision) continue;
    // Retry if an edit invalidated the report between the state and report reads.
    try {
      return runConfigurationDraftView(parsedConfiguration, state, report);
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  fail({ status: 409, kind: 'conflict', code: 'DRAFT_CHANGED_DURING_READ', message: 'El borrador cambió durante la lectura; recargá para ver su estado actual.' });
}

function runConfigurationValidationReceipt(value: unknown): z.infer<typeof RunConfigurationValidationReceiptSchema> {
  const result = RunDraftValidationResultSchema.parse(value);
  if (result.kind === 'ready') return RunConfigurationValidationReceiptSchema.parse({
    kind: 'valid', runId: result.runId, revision: result.revision, promotion: 'promoted',
    worldRevision: result.worldRevision, configurationHash: result.configurationHash,
  });
  if (result.kind === 'incomplete' || result.kind === 'invalid') return RunConfigurationValidationReceiptSchema.parse({
    kind: result.kind, runId: result.runId, revision: result.revision, promotion: 'not-promoted', issues: result.issues,
  });
  throw new Error('El resultado no es un receipt de validación');
}

function runConfigurationDraftSummary(view: z.infer<typeof RunConfigurationDraftViewSchema>): z.infer<typeof RunConfigurationDraftSummarySchema> {
  const name = view.configuration.name.kind === 'empty' ? null : view.configuration.name.value;
  return RunConfigurationDraftSummarySchema.parse({
    kind: 'run-configuration-draft-summary',
    runId: view.configuration.runId,
    revision: view.configuration.revision,
    name,
    lifecycle: view.state.lifecycle,
    configurationRevision: view.state.configurationRevision,
    worldRevision: view.state.worldRevision,
    validation: {
      kind: view.validation.kind,
      promotion: view.validation.promotion,
      issueCount: view.validation.kind === 'valid' ? 0 : view.validation.issues.length,
    },
  });
}

function runDraftPatch(configuration: z.infer<typeof RunConfigurationDraftSchema>): Record<string, unknown> {
  const { kind: _kind, schemaVersion: _schemaVersion, runId: _runId, revision: _revision, ...patch } = configuration;
  return patch;
}

function localOperatorPrincipalId(): string {
  // This loopback host has one operator authority, independent of ephemeral browser sessions.
  return 'local-operator';
}

function oauthInteractionSessionScope(session: LocalSession): string {
  return createHash('sha256').update(session.token, 'utf8').digest('hex');
}

function readExpectedWorldRevision(req: IncomingMessage, runId: string, currentEtag?: string): number {
  const provided = req.headers['if-match'];
  if (typeof provided !== 'string') {
    fail({ status: 428, kind: 'precondition', code: 'PRECONDITION_REQUIRED', message: 'Se requiere If-Match del Escenario.', ...(currentEtag === undefined ? {} : { currentEtag }) });
  }
  const match = /^"world:([0-9a-f-]{36}):r(0|[1-9]\d{0,15})"$/.exec(provided);
  const matchedRunId = match?.[1];
  const revisionText = match?.[2];
  if (matchedRunId === undefined || revisionText === undefined || matchedRunId !== runId
    || !z.string().uuid().safeParse(matchedRunId).success) {
    fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'La revisión del Escenario no coincide con esta corrida.', ...(currentEtag === undefined ? {} : { currentEtag }) });
  }
  const revision = Number(revisionText);
  if (!Number.isSafeInteger(revision)) {
    fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'La revisión del Escenario no es válida.', ...(currentEtag === undefined ? {} : { currentEtag }) });
  }
  return revision;
}

function constantTimeTokenMatch(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return receivedBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(receivedBytes, expectedBytes);
}

function parseSessionCookie(req: IncomingMessage): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== 'string') return undefined;
  const matches = cookieHeader.split(';').map((part) => part.trim()).filter((part) => part.startsWith(SESSION_COOKIE + '='));
  if (matches.length !== 1) return undefined;
  const token = matches[0]?.slice(SESSION_COOKIE.length + 1);
  if (token === undefined || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  return token;
}

function requireSession(req: IncomingMessage, sessions: Map<string, LocalSession>, now: number): LocalSession {
  const token = parseSessionCookie(req);
  const session = token === undefined ? undefined : sessions.get(token);
  if (session === undefined) fail({ status: 401, kind: 'unauthenticated', code: 'SESSION_REQUIRED', message: 'Se requiere una sesión local.' });
  if (session.expiresAtMs <= now) {
    sessions.delete(session.token);
    fail({ status: 401, kind: 'unauthenticated', code: 'SESSION_EXPIRED', message: 'La sesión local expiró.' });
  }
  session.expiresAtMs = now + SESSION_IDLE_TTL_MS;
  return session;
}

function requireCsrf(req: IncomingMessage, session: LocalSession): void {
  const csrf = req.headers['x-csrf-token'];
  if (typeof csrf !== 'string' || !constantTimeTokenMatch(csrf, session.csrfToken)) {
    fail({ status: 403, kind: 'forbidden', code: 'CSRF_INVALID', message: 'Token CSRF inválido.' });
  }
}

function readIdempotencyKey(req: IncomingMessage): string {
  const header = req.headers['idempotency-key'];
  if (typeof header !== 'string') fail({ status: 400, kind: 'validation', code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Se requiere Idempotency-Key.', issues: [] });
  const parsed = IdempotencyKeySchema.safeParse(header);
  if (!parsed.success) fail({ status: 400, kind: 'validation', code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key no es válido.', issues: [] });
  return parsed.data;
}

function checkIdempotentReplay(input: {
  req: IncomingMessage;
  res: ServerResponse;
  session: LocalSession;
  path: string;
  body: unknown;
}): boolean {
  const key = readIdempotencyKey(input.req);
  const fingerprint = `${input.req.method ?? ''}\n${input.path}\n${canonicalJson(input.body)}`;
  const existing = input.session.operations.get(key);
  if (existing === undefined) {
    if (input.session.operations.size >= MAX_SESSION_OPERATIONS) {
      fail({ status: 429, kind: 'dependency', code: 'SESSION_OPERATION_LIMIT', message: 'La sesión alcanzó el límite de claves idempotentes en memoria.', safeCode: 'SESSION_OPERATION_LIMIT', retryable: false });
    }
    return false;
  }
  if (existing.fingerprint !== fingerprint) {
    fail({ status: 409, kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSE', message: 'La clave idempotente ya pertenece a otra solicitud.' });
  }
  sendJson(input.res, existing.status, existing.body, { ETag: existing.etag, 'Idempotency-Replayed': 'true' });
  return true;
}

function rememberOperation(input: {
  req: IncomingMessage;
  session: LocalSession;
  key: string;
  path: string;
  body: unknown;
  status: number;
  result: unknown;
  etag: string;
}): void {
  input.session.operations.set(input.key, {
    fingerprint: `${input.req.method ?? ''}\n${input.path}\n${canonicalJson(input.body)}`,
    status: input.status,
    body: input.result,
    etag: input.etag,
  });
}

function requireCurrentSessionEtag(req: IncomingMessage, session: LocalSession): void {
  const currentEtag = sessionEtag(session);
  const provided = req.headers['if-match'];
  if (typeof provided !== 'string') {
    fail({ status: 428, kind: 'precondition', code: 'PRECONDITION_REQUIRED', message: 'Se requiere If-Match de sesión.', currentEtag });
  }
  if (provided !== currentEtag) {
    fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'La revisión de sesión quedó obsoleta.', currentEtag });
  }
}

function page<T>(items: readonly T[], cursor: string | undefined, requestedLimit: number | undefined): {
  readonly items: T[];
  readonly nextCursor?: string;
} {
  const offset = decodeCursor(cursor, items.length);
  const limit = requestedLimit ?? DEFAULT_PAGE_SIZE;
  const currentItems = items.slice(offset, offset + limit);
  const nextOffset = offset + currentItems.length;
  return {
    items: currentItems,
    ...(nextOffset < items.length ? { nextCursor: encodeCursor(nextOffset) } : {}),
  };
}

function noStoreBinary(res: ServerResponse, status: number, mimeType: string, bytes: Uint8Array, etag: string, filename?: string): void {
  const headers: Record<string, string> = {
    'Content-Type': mimeType,
    'Content-Length': String(bytes.byteLength),
    ETag: `"${etag}"`,
    'Cache-Control': 'private, no-store',
    'Content-Disposition': filename === undefined ? 'inline' : `inline; filename="${filename}"`,
  };
  res.writeHead(status, headers);
  res.end(bytes);
}

type RegisteredStaticAsset = {
  readonly bytes: Buffer;
  readonly mimeType: StaticAssetMime;
  readonly etag: string;
};

function prepareStaticAssets(
  input: LocalHttpOptions['staticAssets'],
): ReadonlyMap<string, RegisteredStaticAsset> {
  const assets = new Map<string, RegisteredStaticAsset>();
  if (input === undefined) return assets;
  for (const [urlPath, asset] of input) {
    if (!/^\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$/.test(urlPath)) {
      throw new TypeError('Static asset path is not a canonical /assets URL path');
    }
    const pathSegments = urlPath.slice(1).split('/');
    if (pathSegments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new TypeError('Static asset path is not canonical');
    }
    const registeredAsset = LocalStaticAssetSchema.parse(asset);
    const mimeType = registeredAsset.mimeType;
    const bytes = Buffer.from(registeredAsset.bytes);
    const etag = createHash('sha256').update(bytes).digest('hex');
    assets.set(urlPath, { bytes, mimeType, etag });
  }
  return assets;
}

function sendStaticAsset(res: ServerResponse, method: string, asset: RegisteredStaticAsset): void {
  res.writeHead(200, {
    'Content-Type': asset.mimeType,
    'Content-Length': String(asset.bytes.byteLength),
    ETag: `"${asset.etag}"`,
    'Cache-Control': 'no-store',
  });
  res.end(method === 'HEAD' ? undefined : asset.bytes);
}

function getSessionView(session: LocalSession, now: number): unknown {
  return {
    kind: 'authenticated',
    expiresAt: new Date(Math.min(session.expiresAtMs, now + SESSION_IDLE_TTL_MS)).toISOString(),
    capabilities: [
      'catalog.read', 'library.read', 'research.read', 'avatars.read', 'session.mode',
      ...(session.mode.kind === 'interlocutor' ? ['intervention.write'] : []),
      ...(Array.from(session.observerViews.values()).includes('internal') ? ['inspector.read'] : []),
    ],
    mode: session.mode,
    sessionRevision: session.revision,
  };
}

async function loadHumanInteractionContext(
  options: LocalHttpOptions,
  input: { readonly runId: string; readonly participantId: string },
): Promise<z.infer<typeof HumanInteractionContextSchema> | undefined> {
  if (options.readHumanInteractionContext === undefined) return undefined;
  const value = await options.readHumanInteractionContext(input);
  if (value === null) return undefined;
  const context = HumanInteractionContextSchema.parse(value);
  if (context.runId !== input.runId) throw new Error('El contexto de intervención pertenece a otra corrida');
  return context;
}

function safeCharacterSummary(input: unknown): z.infer<typeof CatalogCharacterSummarySchema> {
  const entry = CatalogCharacterEntrySchema.parse(input);
  return CatalogCharacterSummarySchema.parse({
    characterId: entry.characterId,
    displayName: entry.displayName,
    revision: 0,
    hash: entry.sha256,
    curationStatus: 'unreviewed',
    avatarRef: { kind: 'catalog-reference', slug: entry.avatarSlug },
  });
}

function safeDocumentSummary(input: unknown): z.infer<typeof LibraryDocumentSummarySchema> {
  const entry = CatalogDocumentEntrySchema.parse(input);
  return LibraryDocumentSummarySchema.parse({
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    sha256: entry.sha256,
  });
}

function shellMarkup(options: LocalHttpOptions): string {
  const html = typeof options.shellHtml === 'function' ? options.shellHtml() : options.shellHtml;
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > 2_000_000) {
    throw new Error('shell unavailable');
  }
  return html;
}

export function createLocalHttpServer(options: LocalHttpOptions): LocalHttpServer {
  const staticAssets = prepareStaticAssets(options.staticAssets);
  const sessions = new Map<string, LocalSession>();
  const bootstraps = new Map<string, BootstrapGrant>();
  const now = options.now ?? Date.now;
  let listening = false;
  const refreshOptions=options.runRefreshStream;
  const refreshPollMs=z.number().int().min(20).max(60000).parse(refreshOptions?.pollIntervalMs??1000);
  const refreshHeartbeatMs=z.number().int().min(20).max(60000).parse(refreshOptions?.heartbeatMs??15000);
  const refreshMaxClients=z.number().int().min(1).max(64).parse(refreshOptions?.maxClients??16);
  const refreshMaxPerSession=z.number().int().min(1).max(8).parse(refreshOptions?.maxClientsPerSession??4);
  type RefreshClient={res:ServerResponse;session:LocalSession;runId:string;cursor:string;lastHeartbeat:number;blocked:boolean;blockedAt:number};
  const refreshClients=new Set<RefreshClient>();
  let refreshTimer:ReturnType<typeof setInterval>|undefined;
  let refreshTick:Promise<void>|undefined;
  let serverClosing=false;
  function refreshCursor(value:RunRefresh){return `rf1.${value.runId}.c${value.configRevision}.w${value.worldRevision}.l${value.lifecycleRevision}.s${value.lastWorldSeq}`;}
  function validateRefreshCursor(value:unknown,runId:string,current:RunRefresh){
    if(value===undefined)return;
    if(typeof value!=='string'||value.length>200)fail({status:400,kind:'validation',code:'INVALID_CURSOR',message:'El cursor de notificación no es válido.',issues:[]});
    const match=/^rf1\.([0-9a-f-]{36})\.c(0|[1-9]\d{0,15})\.w(0|[1-9]\d{0,15})\.l(0|[1-9]\d{0,15})\.s(0|[1-9]\d{0,15})$/.exec(value);
    if(!match||match[1]!==runId)fail({status:400,kind:'validation',code:'INVALID_CURSOR',message:'El cursor no pertenece a esta corrida.',issues:[]});
    const parsed=RunRefreshSchema.safeParse({kind:'run.refresh',runId:match[1],configRevision:Number(match[2]),worldRevision:Number(match[3]),lifecycleRevision:Number(match[4]),lastWorldSeq:Number(match[5])});
    if(!parsed.success)fail({status:400,kind:'validation',code:'INVALID_CURSOR',message:'El cursor de notificación no es válido.',issues:[]});
    if(parsed.data.configRevision>current.configRevision||parsed.data.worldRevision>current.worldRevision||parsed.data.lifecycleRevision>current.lifecycleRevision||parsed.data.lastWorldSeq>current.lastWorldSeq)
      fail({status:410,kind:'precondition',code:'CURSOR_EXPIRED',message:'El cursor requiere volver a consultar el estado actual.'});
  }
  async function readRefresh(runId:string):Promise<RunRefresh|undefined>{
    const raw=await options.runLifecycle?.readRunView({runId});
    if(raw===undefined||raw===null)return undefined;
    const view=RunViewSchema.parse(raw);
    if(view.runId!==runId)throw new Error('RUN_REFRESH_SCOPE_MISMATCH');
    return RunRefreshSchema.parse({kind:'run.refresh',runId:view.runId,configRevision:view.configRevision,worldRevision:view.worldRevision,lifecycleRevision:view.lifecycleRevision,lastWorldSeq:view.lastWorldSeq});
  }
  function closeRefresh(client:RefreshClient){
    refreshClients.delete(client);
    if(!client.res.writableEnded)client.res.end();
    if(refreshClients.size===0&&refreshTimer!==undefined){clearInterval(refreshTimer);refreshTimer=undefined;}
  }
  function writeRefresh(client:RefreshClient,frame:string){
    if(client.res.destroyed||client.res.writableEnded){closeRefresh(client);return;}
    // Do not queue frames behind a slow browser. It reconnects and re-reads current state.
    if(client.blocked||client.res.writableLength>64*1024){closeRefresh(client);return;}
    if(!client.res.write(frame)){client.blocked=true;client.blockedAt=now();}
  }
  async function tickRefresh(){
    if(options.admissionBarrier?.isHeld)return;
    const active=new Map<string,RefreshClient[]>();
    for(const client of refreshClients){
      if(serverClosing||sessions.get(client.session.token)!==client.session||client.session.expiresAtMs<=now()||(client.blocked&&now()-client.blockedAt>=refreshPollMs)){closeRefresh(client);continue;}
      const group=active.get(client.runId)??[];group.push(client);active.set(client.runId,group);
    }
    await Promise.all(Array.from(active,async([runId,clients])=>{
      let view:RunRefresh|undefined;
      try{view=await readRefresh(runId);}catch{for(const client of clients)closeRefresh(client);return;}
      for(const client of clients){
        // An asynchronous read cannot deliver after logout, expiry or server shutdown.
        if(!refreshClients.has(client))continue;
        if(serverClosing||sessions.get(client.session.token)!==client.session||client.session.expiresAtMs<=now()||view===undefined){closeRefresh(client);continue;}
        const cursor=refreshCursor(view);
        if(cursor!==client.cursor){client.cursor=cursor;writeRefresh(client,`id: ${cursor}\nevent: run.refresh\ndata: ${JSON.stringify(view)}\n\n`);}
        else if(now()-client.lastHeartbeat>=refreshHeartbeatMs){client.lastHeartbeat=now();writeRefresh(client,': heartbeat\n\n');}
      }
    }));
  }
  function startRefreshTimer(){
    if(refreshTimer!==undefined)return;
    refreshTimer=setInterval(()=>{
      if(refreshTick!==undefined)return;
      refreshTick=tickRefresh().catch(()=>{for(const client of refreshClients)closeRefresh(client);}).finally(()=>{refreshTick=undefined;});
    },refreshPollMs);
    refreshTimer.unref();
  }

  const server: Server = createServer((req, res) => {
    const requestId = randomUUID();
    addBaseHeaders(res, requestId);
    void handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const failure = isHttpFailure(error)
        ? error
        : createHttpFailure({
          status: 500,
          kind: 'internal',
          code: 'INTERNAL_ERROR',
          message: 'Error interno del servidor local.',
        });
      sendProblem(res, requestId, failure);
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = assertRequestSecurity(req, server);
    const url = parseRequestUrl(req, origin);
    const segments = parseSegments(url.pathname);
    const method = req.method ?? 'GET';
    let releaseAdmission:()=>void;
    try{releaseAdmission=options.admissionBarrier?.enter({method,path:segments})??(()=>{});}
    catch{fail({status:503,kind:'dependency',code:'HOST_BACKUP_IN_PROGRESS',message:'El host está preparando un backup; reintentá al terminar.',safeCode:'HOST_BACKUP_IN_PROGRESS',retryable:true});}
    try{return await handleAdmitted(req,res,url,segments,method);}finally{releaseAdmission();}
  }

  async function handleAdmitted(req:IncomingMessage,res:ServerResponse,url:URL,segments:string[],method:string):Promise<void>{
    const pathname = url.pathname;
    const isRoot = pathname === '/' && segments.length === 0;

    if (pathname.startsWith('/assets/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        fail({ status: 405, kind: 'validation', code: 'METHOD_NOT_ALLOWED', message: 'Método HTTP no permitido.', issues: [] });
      }
      const asset = staticAssets.get(pathname);
      if (asset === undefined) fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Recurso no encontrado.' });
      sendStaticAsset(res, method, asset);
      return;
    }

    if (isRoot) {
      if (method !== 'GET') fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Recurso no encontrado.' });
      if (bootstraps.size >= MAX_PENDING_BOOTSTRAPS) {
        for (const [token, grant] of bootstraps) if (grant.expiresAtMs <= now()) bootstraps.delete(token);
        if (bootstraps.size >= MAX_PENDING_BOOTSTRAPS) fail({ status: 503, kind: 'dependency', code: 'BOOTSTRAP_CAPACITY', message: 'No se pudo iniciar una sesión local.', safeCode: 'BOOTSTRAP_CAPACITY', retryable: true });
      }
      const nonce = randomBytes(32).toString('base64url');
      bootstraps.set(nonce, { expiresAtMs: now() + BOOTSTRAP_TTL_MS });
      const html = injectBootstrapMeta(shellMarkup(options), nonce);
      const body = Buffer.from(html, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(body.byteLength) });
      res.end(body);
      return;
    }

    if (segments[0] !== 'api' || segments[1] !== 'v1') {
      fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Recurso no encontrado.' });
    }
    const route = segments.slice(2);
    if (route.length === 1 && route[0] === 'health' && method === 'GET') {
      const composition=options.runtimeComposition===undefined?undefined:z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('composed')}),z.strictObject({kind:z.literal('unavailable')})]).parse(options.runtimeComposition());
      const health = parseSchema(HealthViewSchema, {
        kind: composition?.kind==='unavailable'?'unavailable':'degraded',
        checks: { http: 'ok', catalog: 'ok', runtime: composition?.kind==='composed'?'degraded':'unavailable' },
        version: composition===undefined?'http-catalog-slice':'personajes-local-runtime',
      });
      sendJson(res, 200, health);
      return;
    }

    if (route.length === 1 && route[0] === 'session' && method === 'POST') {
      const body = parseSchema(BootstrapRequestSchema, await readJsonBody(req));
      const grant = bootstraps.get(body.bootNonce);
      if (grant === undefined || grant.expiresAtMs <= now()) {
        bootstraps.delete(body.bootNonce);
        fail({ status: 401, kind: 'unauthenticated', code: 'BOOTSTRAP_INVALID', message: 'La capacidad inicial expiró o ya fue utilizada.' });
      }
      bootstraps.delete(body.bootNonce);
      const token = randomBytes(32).toString('base64url');
      const csrfToken = randomBytes(32).toString('base64url');
      const expiresAtMs = now() + SESSION_IDLE_TTL_MS;
      const session: LocalSession = {
        token,
        csrfToken,
        expiresAtMs,
        revision: 0,
        mode: SessionModeSchema.parse({ kind: 'observer' }),
        observerViews: new Map(),
        operations: new Map(),
      };
      sessions.set(token, session);
      const created = parseSchema(SessionCreatedSchema, { csrfToken, expiresAt: new Date(expiresAtMs).toISOString() });
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/api/v1; HttpOnly; SameSite=Strict`);
      sendJson(res, 200, created, { ETag: sessionEtag(session) });
      return;
    }

    if (route.length === 0 || route[0] !== 'health') {
      const session = requireSession(req, sessions, now());

      if(route.length===4&&route[0]==='runs'&&route[2]==='events'&&route[3]==='stream'&&method==='GET'){
        parseQuery(url,z.strictObject({}));
        const runId=parseSchema(RunIdSchema,route[1]);
        if(options.runLifecycle===undefined)fail({status:503,kind:'dependency',code:'RUN_REFRESH_UNAVAILABLE',message:'La notificación de lectura no está disponible.',safeCode:'RUN_REFRESH_UNAVAILABLE',retryable:true});
        if(refreshClients.size>=refreshMaxClients||Array.from(refreshClients).filter(client=>client.session===session).length>=refreshMaxPerSession)
          fail({status:429,kind:'budget',code:'STREAM_CLIENT_LIMIT',message:'Hay demasiadas conexiones de notificación.',recoverable:true});
        const view=await readRefresh(runId);
        if(view===undefined)fail({status:404,kind:'notFound',code:'NOT_FOUND',message:'Corrida no encontrada.'});
        validateRefreshCursor(req.headers['last-event-id'],runId,view);
        if(serverClosing||sessions.get(session.token)!==session||session.expiresAtMs<=now())fail({status:401,kind:'unauthenticated',code:'SESSION_EXPIRED',message:'La sesión local expiró.'});
        // Recheck cap after async reads so simultaneous handshakes cannot exceed it.
        if(refreshClients.size>=refreshMaxClients||Array.from(refreshClients).filter(client=>client.session===session).length>=refreshMaxPerSession)
          fail({status:429,kind:'budget',code:'STREAM_CLIENT_LIMIT',message:'Hay demasiadas conexiones de notificación.',recoverable:true});
        res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'private, no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
        res.flushHeaders();
        const client:RefreshClient={res,session,runId,cursor:refreshCursor(view),lastHeartbeat:now(),blocked:false,blockedAt:now()};
        refreshClients.add(client);
        res.on('drain',()=>{client.blocked=false;});res.once('close',()=>closeRefresh(client));
        // Always provide the latest public invalidation on connection/reconnection.
        // No missed-event replay is claimed; clients refresh HTTP snapshots/pages.
        writeRefresh(client,`retry: 2000\nid: ${client.cursor}\nevent: run.refresh\ndata: ${JSON.stringify(view)}\n\n`);
        startRefreshTimer();return;
      }

      if (route.length === 3 && route[0] === 'runs' && ['stage','events','conversations','jobs'].includes(route[2] ?? '') && method === 'GET') {
        const runId = parseSchema(RunIdSchema,route[1]);
        const port = options.runObservation;
        if (port === undefined) fail({status:503,kind:'dependency',code:'RUN_OBSERVATION_UNAVAILABLE',message:'La observación pública no está disponible.',safeCode:'RUN_OBSERVATION_UNAVAILABLE',retryable:true});
        const surface = route[2];
        const query = surface === 'stage' ? parseQuery(url,ObservationStageQuerySchema)
          : surface === 'jobs' ? parseQuery(url,ObservationJobsQuerySchema)
            : parseQuery(url,ObservationEventsQuerySchema);
        const request = {runId,...query};
        const raw = surface === 'stage' ? await port.readStage(request) : surface === 'jobs' ? await port.readJobs(request)
          : surface === 'events' ? await port.readEvents(request) : await port.readConversations(request);
        const result = z.discriminatedUnion('kind',[
          z.strictObject({kind:z.literal('found'),value:z.unknown()}),z.strictObject({kind:z.literal('missing')}),
          z.strictObject({kind:z.literal('invalidRequest'),code:z.enum(['invalid-cut','invalid-cursor'])}),
        ]).parse(raw);
        if (result.kind === 'missing') fail({status:404,kind:'notFound',code:'NOT_FOUND',message:'Corrida no encontrada.'});
        if (result.kind === 'invalidRequest') fail({status:422,kind:'validation',code:'MALFORMED_REQUEST',message:result.code==='invalid-cut'?'El corte o intervalo debe pertenecer a la historia confirmada.':'El cursor no pertenece a esta corrida, superficie o intervalo.',issues:[]});
        const value = surface === 'stage' ? RunStageViewSchema.parse(result.value) : surface === 'jobs' ? TechnicalJobPageSchema.parse(result.value)
          : surface === 'events' ? ConfirmedEventPageSchema.parse(result.value) : ConversationPageSchema.parse(result.value);
        if (value.runId !== runId) throw new Error('Proyección pública fuera del ámbito solicitado');
        const etag = `"observation:${runId}:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}"`;
        sendJson(res,200,value,{ETag:etag});
        return;
      }

      if (route.length === 4 && route[0] === 'runs' && route[2] === 'steps' && method === 'GET') {
        const runId = parseSchema(RunIdSchema, route[1]); const jobId = parseSchema(JobIdSchema, route[3]);
        const value = await options.runLifecycle?.readStepJob?.({ runId, jobId });
        if (value === undefined || value === null) fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Trabajo de pulso no encontrado.' });
        const job = RunStepJobViewSchema.parse(value);
        if (job.runId !== runId || job.jobId !== jobId) throw new Error('El trabajo de pulso pertenece a otro ámbito');
        sendJson(res, 200, job, { ETag: `"run-step:${job.jobId}:r${job.revision}"` });
        return;
      }

      if (route.length === 2 && route[0] === 'runs' && method === 'GET' && options.runLifecycle !== undefined) {
        const runId = parseSchema(RunIdSchema, route[1]);
        const value = await options.runLifecycle.readRunView({ runId });
        if (value === undefined || value === null) fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Corrida no encontrada.' });
        const view = RunViewSchema.parse(value);
        if (view.runId !== runId) throw new Error('La vista leída pertenece a otra corrida');
        sendJson(res, 200, view, { ETag: runViewEtag(view) });
        return;
      }

      if (route.length === 3 && route[0] === 'runs' && ['controls', 'start', 'pause', 'resume', 'step', 'stop', 'close'].includes(route[2] ?? '') && method === 'POST') {
        requireCsrf(req, session);
        if (options.runLifecycle === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'RUN_LIFECYCLE_UNAVAILABLE', message: 'Los controles de la corrida no están disponibles.', safeCode: 'RUN_LIFECYCLE_UNAVAILABLE', retryable: true });
        }
        const runId = parseSchema(RunIdSchema, route[1]);
        const rawBody = await readJsonBody(req);
        enforceJsonWireLimits(rawBody);
        const command = parseSchema(RunLifecycleControlRequestSchema, rawBody);
        if (route[2] !== 'controls' && command.kind !== route[2]) {
          fail({ status: 422, kind: 'validation', code: 'MALFORMED_REQUEST', message: 'El comando no coincide con la ruta solicitada.', issues: [] });
        }
        const idempotencyKey = readIdempotencyKey(req);
        const expected = readExpectedRunViewRevisions(req, runId);
        const result = RunControlApplicationResultSchema.parse(await options.runLifecycle.controlRun({
          principalId: localOperatorPrincipalId(), idempotencyKey, runId, ...expected, command,
        }));
        switch (result.kind) {
          case 'updated': {
            if (result.run.runId !== runId) throw new Error('El recibo de control pertenece a otra corrida');
            if (command.kind === 'step') {
              fail({ status: 503, kind: 'dependency', code: 'STEP_UNAVAILABLE', message: 'El pulso acotado todavía no está disponible.', safeCode: 'STEP_UNAVAILABLE', retryable: false });
            }
            sendJson(res, 200, result.run, {
              ETag: runViewEtag(result.run),
              ...(result.replayed ? { 'Idempotency-Replayed': 'true' } : {}),
            });
            return;
          }
          case 'accepted': {
            if (result.run.runId !== runId) throw new Error('El job de control pertenece a otra corrida');
            if (command.kind === 'step' && ['queued','running','waiting'].includes(result.job.state) && result.run.lifecycle.kind !== 'running') {
              throw new Error('El pulso acotado aceptado debe activar una época exclusiva');
            }
            const receipt = RunControlReceiptSchema.parse({ kind: 'run-control-receipt', run: result.run, job: result.job });
            sendJson(res, 202, receipt, {
              ETag: runViewEtag(result.run),
              Location: command.kind === 'step' ? `/api/v1/runs/${runId}/steps/${result.job.jobId}` : `/api/v1/runs/${runId}`,
              'Retry-After': '1',
              ...(result.replayed ? { 'Idempotency-Replayed': 'true' } : {}),
            });
            return;
          }
          case 'stale':
            if (result.current.runId !== runId) throw new Error('El estado CAS pertenece a otra corrida');
            fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'La corrida cambió; recargá antes de enviar el control.', currentEtag: runViewEtag(result.current) });
          case 'missing': fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Corrida no encontrada.' });
          case 'invalidLifecycle': fail({ status: 409, kind: 'conflict', code: 'INVALID_LIFECYCLE', message: 'El control no se admite en el estado actual de la corrida.' });
          case 'preflightRequired': fail({ status: 422, kind: 'validation', code: 'RUN_NOT_READY', message: 'Iniciar o reanudar requiere un preflight durable vigente.', issues: [] });
          case 'preflightBlocked': fail({ status: 422, kind: 'validation', code: 'RUN_NOT_READY', message: 'El preflight vigente bloquea el inicio o la reanudación.', issues: [] });
          case 'preflightStale':
            if (result.current.runId !== runId) throw new Error('El estado de preflight pertenece a otra corrida');
            fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'El preflight quedó obsoleto; volvé a comprobar la corrida.', currentEtag: runViewEtag(result.current) });
          case 'budgetExhausted': fail({ status: 429, kind: 'budget', code: 'BUDGET_EXHAUSTED', message: 'El presupuesto de la corrida está agotado.', recoverable: false });
          case 'stepUnavailable': fail({ status: 503, kind: 'dependency', code: 'STEP_UNAVAILABLE', message: 'El pulso acotado todavía no está disponible.', safeCode: 'STEP_UNAVAILABLE', retryable: false });
          case 'runtimeUnavailable':
            if (result.current !== undefined && result.current.runId !== runId) throw new Error('El estado del runtime pertenece a otra corrida');
            fail({ status: 503, kind: 'dependency', code: 'REPRESENTATION_RUNTIME_UNAVAILABLE', message: 'El runtime de la representación no está disponible.', safeCode: 'REPRESENTATION_RUNTIME_UNAVAILABLE', retryable: true });
          case 'idempotencyConflict': fail({ status: 409, kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSE', message: 'La clave idempotente ya pertenece a otra operación.' });
          default: { const exhaustive: never = result; throw new Error(String(exhaustive)); }
        }
      }

      if (route.length === 3 && route[0] === 'runs' && route[2] === 'budget' && method === 'GET') {
        const runId = parseSchema(RunIdSchema, route[1]);
        if (options.readRunModelTimeBudget === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'RUN_BUDGET_UNAVAILABLE', message: 'El presupuesto de la corrida no está disponible.', safeCode: 'RUN_BUDGET_UNAVAILABLE', retryable: true });
        }
        const value = await options.readRunModelTimeBudget({ runId });
        if (value === undefined || value === null) fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Presupuesto de corrida no encontrado.' });
        const budget = parseSchema(RunModelTimeBudgetSchema, value);
        if (budget.runId !== runId) throw new Error('El presupuesto leído pertenece a otra corrida');
        const fingerprint = createHash('sha256').update(canonicalJson(budget), 'utf8').digest('hex');
        sendJson(res, 200, budget, { ETag: `"run-budget:${runId}:${fingerprint}"` });
        return;
      }

      if (route[0] === 'runs' && route[2] === 'preflight') {
        const runId = parseSchema(RunIdSchema, route[1]);
        if (options.runPreflightJobs === undefined) fail({ status: 503, kind: 'dependency', code: 'RUN_PREFLIGHT_UNAVAILABLE', message: 'El preflight no está disponible.', safeCode: 'RUN_PREFLIGHT_UNAVAILABLE', retryable: true });
        const broker = options.runPreflightJobs;
        if (route.length === 3 && method === 'POST') {
          requireCsrf(req, session);
          parseSchema(RunPreflightRequestSchema, await readJsonBody(req));
          const expected = readExpectedRunRevisions(req, runId);
          const idempotencyKey = readIdempotencyKey(req);
          const result = RunPreflightJobStartResultSchema.parse(await broker.start({ runId, ...expected, idempotencyKey }));
          switch (result.kind) {
            case 'idempotencyConflict': fail({ status: 409, kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSE', message: 'La clave idempotente ya pertenece a otra operación.' });
            case 'missing': fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Corrida no encontrada.' });
            case 'invalidLifecycle': fail({ status: 409, kind: 'conflict', code: 'RUN_NOT_READY', message: 'El preflight requiere una corrida Ready.' });
            case 'invalidConfiguration': fail({ status: 409, kind: 'conflict', code: 'RUN_CONFIGURATION_INVALID', message: 'La configuración durable no está lista para preflight.' });
            case 'stale': fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'La configuración o el mundo cambiaron; recargá la corrida.', currentEtag: runEtag(runId, result.currentConfigurationRevision, result.currentWorldRevision) });
            case 'created':
            case 'existing': {
              if (result.job.runId !== runId || result.job.state !== 'queued' || result.job.revision !== 0
                || result.job.configurationRevision !== expected.expectedConfigurationRevision
                || result.job.worldRevision !== expected.expectedWorldRevision) throw new Error('El recibo inicial de preflight no corresponde al comando');
              const receipt = RunPreflightJobReceiptSchema.parse({ kind: 'run-preflight-job-receipt', job: result.job });
              sendJson(res, 202, receipt, { Location: `/api/v1/runs/${runId}/preflight/jobs/${receipt.job.jobId}`,
                ETag: runPreflightJobEtag(receipt.job.jobId, receipt.job.revision), 'Retry-After': '1',
                ...(result.kind === 'existing' ? { 'Idempotency-Replayed': 'true' } : {}) });
              return;
            }
            default: { const exhaustive: never = result; throw new Error(String(exhaustive)); }
          }
        }
        if (route.length === 4 && route[3] === 'jobs' && method === 'GET') {
          const query = parseQuery(url, PageQuerySchema);
          const page = RunPreflightJobPageSchema.parse(await broker.listJobs({ runId, offset: decodeCursor(query.cursor, 1_000), limit: query.limit ?? DEFAULT_PAGE_SIZE }));
          if (page.items.some((document) => document.job.runId !== runId)) throw new Error('El listado de preflight pertenece a otra corrida');
          sendJson(res, 200, page); return;
        }
        if (route.length === 5 && route[3] === 'jobs' && method === 'GET') {
          const jobId = parseSchema(JobIdSchema, route[4]);
          const result = RunPreflightJobReadResultSchema.parse(await broker.readJob({ runId, jobId }));
          if (result.kind === 'missing') fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Trabajo de preflight no encontrado.' });
          if (result.job.runId !== runId || result.job.jobId !== jobId) throw new Error('El trabajo de preflight pertenece a otro ámbito');
          const document = RunPreflightJobDocumentSchema.parse({ kind: 'run-preflight-job-document', job: result.job, report: result.report });
          sendJson(res, 200, document, { ETag: runPreflightJobEtag(jobId, result.job.revision) }); return;
        }
        if (route.length === 5 && route[3] === 'jobs' && method === 'DELETE') {
          requireCsrf(req, session);
          const jobId = parseSchema(JobIdSchema, route[4]);
          const expectedRevision = readExpectedRunPreflightJobRevision(req, jobId);
          const idempotencyKey = readIdempotencyKey(req);
          const result = RunPreflightJobMutationResultSchema.parse(await broker.cancelJob({ runId, jobId, expectedRevision, idempotencyKey }));
          if (result.kind === 'missing') fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Trabajo de preflight no encontrado.' });
          if (result.kind === 'idempotencyConflict') fail({ status: 409, kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSE', message: 'La clave idempotente ya pertenece a otra operación.' });
          if (result.job.runId !== runId || result.job.jobId !== jobId) throw new Error('La cancelación de preflight pertenece a otro ámbito');
          if (result.kind === 'stale') fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'El trabajo de preflight cambió; recargá su estado.', currentEtag: runPreflightJobEtag(jobId, result.job.revision) });
          sendJson(res, result.kind === 'terminal' ? 200 : 202,
            RunPreflightJobReceiptSchema.parse({ kind: 'run-preflight-job-receipt', job: result.job }), {
              Location: `/api/v1/runs/${runId}/preflight/jobs/${jobId}`, ETag: runPreflightJobEtag(jobId, result.job.revision),
              ...(result.kind === 'existing' ? { 'Idempotency-Replayed': 'true' } : {}),
            });
          return;
        }
      }

      if (route[0] === 'integrations' && route[1] === 'pi' && route[2] === 'access-check') {
        if (options.piAccessJobs === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'PI_ACCESS_CHECK_UNAVAILABLE', message: 'El chequeo de acceso Pi no está disponible.', safeCode: 'PI_ACCESS_CHECK_UNAVAILABLE', retryable: true });
        }
        const broker = options.piAccessJobs;
        if (route.length === 3 && method === 'POST') {
          requireCsrf(req, session);
          const body = parseSchema(PiAccessCheckRequestSchema, await readJsonBody(req));
          const idempotencyKey = readIdempotencyKey(req);
          const result = PiAccessJobStartResultSchema.parse(await broker.start({ profile: body.profile, idempotencyKey }));
          if (result.kind === 'idempotencyConflict') fail({ status: 409, kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSE', message: 'La clave idempotente ya pertenece a otra operación.' });
          if (result.job.state !== 'queued' || result.job.revision !== 0 || canonicalJson(result.job.profile) !== canonicalJson(body.profile)) throw new Error('El recibo inicial del chequeo no corresponde al comando');
          const receipt = parseSchema(PiAccessJobReceiptSchema, { kind: 'pi-access-job-receipt', job: result.job });
          sendJson(res, 202, receipt, {
            Location: `/api/v1/integrations/pi/access-check/jobs/${receipt.job.jobId}`,
            ETag: piAccessJobEtag(receipt.job.jobId, receipt.job.revision), 'Retry-After': '1',
            ...(result.kind === 'existing' ? { 'Idempotency-Replayed': 'true' } : {}),
          });
          return;
        }
        if (route.length === 4 && route[3] === 'jobs' && method === 'GET') {
          const query = parseQuery(url, PageQuerySchema);
          const result = PiAccessJobPageSchema.parse(await broker.listJobs({
            offset: decodeCursor(query.cursor, 1_000), limit: query.limit ?? DEFAULT_PAGE_SIZE,
          }));
          sendJson(res, 200, result);
          return;
        }
        if (route.length === 5 && route[3] === 'jobs' && method === 'GET') {
          const jobId = parseSchema(JobIdSchema, route[4]);
          const result = PiAccessJobReadResultSchema.parse(await broker.readJob({ jobId }));
          if (result.kind === 'missing') fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Chequeo de acceso no encontrado.' });
          const job = result.job;
          if (job.jobId !== jobId) throw new Error('La respuesta del chequeo no corresponde a la solicitud');
          sendJson(res, 200, job, { ETag: piAccessJobEtag(job.jobId, job.revision) });
          return;
        }
        if (route.length === 5 && route[3] === 'jobs' && method === 'DELETE') {
          requireCsrf(req, session);
          const jobId = parseSchema(JobIdSchema, route[4]);
          const expectedRevision = readExpectedPiAccessJobRevision(req, jobId);
          const idempotencyKey = readIdempotencyKey(req);
          const result = PiAccessJobCancelResultSchema.parse(await broker.cancelJob({ jobId, idempotencyKey, expectedRevision }));
          if (result.kind === 'missing') fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Chequeo de acceso no encontrado.' });
          if (result.kind === 'idempotencyConflict') fail({ status: 409, kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSE', message: 'La clave idempotente ya pertenece a otra operación.' });
          if (result.job.jobId !== jobId) throw new Error('La cancelación devolvió otro chequeo de acceso');
          if (result.kind === 'stale') fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'El chequeo de acceso cambió; recargá su estado.', currentEtag: piAccessJobEtag(jobId, result.job.revision) });
          const receipt = parseSchema(PiAccessJobReceiptSchema, { kind: 'pi-access-job-receipt', job: result.job });
          sendJson(res, 202, receipt, {
            Location: `/api/v1/integrations/pi/access-check/jobs/${jobId}`,
            ETag: piAccessJobEtag(jobId, receipt.job.revision), 'Retry-After': '1',
            ...(result.kind === 'existing' ? { 'Idempotency-Replayed': 'true' } : {}),
          });
          return;
        }
      }

      if (route.length === 3 && route[0] === 'integrations' && route[1] === 'pi' && route[2] === 'status' && method === 'GET') {
        if (options.piOAuthJobs === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'PI_OAUTH_UNAVAILABLE', message: 'La integración Pi no está disponible.', safeCode: 'PI_OAUTH_UNAVAILABLE', retryable: true });
        }
        const result = PiOAuthPortStatusResultSchema.parse(await options.piOAuthJobs.status());
        const authState = result.kind === 'failed' ? 'error'
          : result.value.configuration === 'oauth-configured' ? 'present' : 'missing';
        const access = options.piAccessJobs?.readPiAccessStatus === undefined
          ? PiAccessStatusMetadataSchema.parse({ accessCheck: 'notRun', effectiveProfile: null, safeCode: null })
          : PiAccessStatusMetadataSchema.parse(await options.piAccessJobs.readPiAccessStatus({ profile: DEFAULT_INFERENCE_PROFILE }));
        const safeCode = result.kind === 'failed' ? result.code : access.safeCode;
        const status = parseSchema(PiIntegrationStatusSchema, {
          kind: 'pi-integration-status', provider: 'openai-codex', authState,
          requiredProfile: { provider: 'openai-codex', model: 'gpt-6.1-sol', thinking: 'low' },
          effectiveProfile: access.effectiveProfile, accessCheck: access.accessCheck, checkedAt: new Date(now()).toISOString(), safeCode,
        });
        sendJson(res, 200, status);
        return;
      }

      if (route.length === 4 && route[0] === 'integrations' && route[1] === 'pi'
        && route[2] === 'oauth' && route[3] === 'login' && method === 'POST') {
        if (options.piOAuthJobs === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'PI_OAUTH_UNAVAILABLE', message: 'La integración Pi no está disponible.', safeCode: 'PI_OAUTH_UNAVAILABLE', retryable: true });
        }
        requireCsrf(req, session);
        parseSchema(PiOAuthLoginRequestSchema, await readJsonBody(req));
        const idempotencyKey = readIdempotencyKey(req);
        const result = PiOAuthJobStartResultSchema.parse(await options.piOAuthJobs.startLogin({
          idempotencyKey, sessionScope: oauthInteractionSessionScope(session),
        }));
        if (result.kind === 'idempotencyConflict') {
          fail({ status: 409, kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSE', message: 'La clave idempotente ya pertenece a otra operación OAuth.' });
        }
        const receipt = parseSchema(PiOAuthJobReceiptSchema, { kind: 'pi-oauth-job-receipt', job: result.job });
        const etag = piOAuthJobEtag(receipt.job.jobId, receipt.job.revision);
        sendJson(res, 202, receipt, {
          Location: `/api/v1/integrations/pi/oauth/jobs/${receipt.job.jobId}`,
          ETag: etag, 'Retry-After': '1',
          ...(result.kind === 'existing' ? { 'Idempotency-Replayed': 'true' } : {}),
        });
        return;
      }

      if (route.length === 3 && route[0] === 'integrations' && route[1] === 'pi' && route[2] === 'oauth' && method === 'DELETE') {
        if (options.piOAuthJobs === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'PI_OAUTH_UNAVAILABLE', message: 'La integración Pi no está disponible.', safeCode: 'PI_OAUTH_UNAVAILABLE', retryable: true });
        }
        requireCsrf(req, session);
        const idempotencyKey = readIdempotencyKey(req);
        const result = PiOAuthJobStartResultSchema.parse(await options.piOAuthJobs.startLogout({
          idempotencyKey, sessionScope: oauthInteractionSessionScope(session),
        }));
        if (result.kind === 'idempotencyConflict') {
          fail({ status: 409, kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSE', message: 'La clave idempotente ya pertenece a otra operación OAuth.' });
        }
        const receipt = parseSchema(PiOAuthJobReceiptSchema, { kind: 'pi-oauth-job-receipt', job: result.job });
        const etag = piOAuthJobEtag(receipt.job.jobId, receipt.job.revision);
        sendJson(res, 202, receipt, {
          Location: `/api/v1/integrations/pi/oauth/jobs/${receipt.job.jobId}`,
          ETag: etag, 'Retry-After': '1',
          ...(result.kind === 'existing' ? { 'Idempotency-Replayed': 'true' } : {}),
        });
        return;
      }

      if (route.length === 4 && route[0] === 'integrations' && route[1] === 'pi'
        && route[2] === 'oauth' && route[3] === 'jobs' && method === 'GET') {
        if (options.piOAuthJobs === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'PI_OAUTH_UNAVAILABLE', message: 'La integración Pi no está disponible.', safeCode: 'PI_OAUTH_UNAVAILABLE', retryable: true });
        }
        const query = parseQuery(url, PageQuerySchema);
        const offset = decodeCursor(query.cursor, 1_000);
        const result = parseSchema(PiOAuthJobPageSchema, await options.piOAuthJobs.listJobs({
          offset, limit: query.limit ?? DEFAULT_PAGE_SIZE,
        }));
        sendJson(res, 200, result);
        return;
      }

      if (route.length === 5 && route[0] === 'integrations' && route[1] === 'pi' && route[2] === 'oauth'
        && route[3] === 'jobs' && method === 'GET') {
        if (options.piOAuthJobs === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'PI_OAUTH_UNAVAILABLE', message: 'La integración Pi no está disponible.', safeCode: 'PI_OAUTH_UNAVAILABLE', retryable: true });
        }
        const jobId = parseSchema(JobIdSchema, route[4]);
        const value = await options.piOAuthJobs.readJob({ jobId });
        if (value === undefined) fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Job OAuth no encontrado.' });
        const job = parseSchema(PiOAuthJobViewSchema, value);
        sendJson(res, 200, job, { ETag: piOAuthJobEtag(job.jobId, job.revision) });
        return;
      }

      if (route.length === 5 && route[0] === 'integrations' && route[1] === 'pi' && route[2] === 'oauth'
        && route[3] === 'jobs' && method === 'DELETE') {
        if (options.piOAuthJobs === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'PI_OAUTH_UNAVAILABLE', message: 'La integración Pi no está disponible.', safeCode: 'PI_OAUTH_UNAVAILABLE', retryable: true });
        }
        requireCsrf(req, session);
        const jobId = parseSchema(JobIdSchema, route[4]);
        const expectedRevision = readExpectedPiOAuthJobRevision(req, jobId);
        const idempotencyKey = readIdempotencyKey(req);
        const result = PiOAuthJobCancelResultSchema.parse(await options.piOAuthJobs.cancelJob({ jobId, idempotencyKey, expectedRevision }));
        if (result.kind === 'missing') fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Job OAuth no encontrado.' });
        if (result.kind === 'idempotencyConflict') {
          fail({ status: 409, kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSE', message: 'La clave idempotente ya pertenece a otra cancelación OAuth.' });
        }
        if (result.kind === 'stale') {
          fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'El job OAuth cambió; recargá su estado.', currentEtag: piOAuthJobEtag(result.job.jobId, result.job.revision) });
        }
        const receipt = parseSchema(PiOAuthJobReceiptSchema, { kind: 'pi-oauth-job-receipt', job: result.job });
        sendJson(res, 202, receipt, {
          Location: `/api/v1/integrations/pi/oauth/jobs/${receipt.job.jobId}`,
          ETag: piOAuthJobEtag(receipt.job.jobId, receipt.job.revision), 'Retry-After': '1',
        });
        return;
      }

      if (route.length === 6 && route[0] === 'integrations' && route[1] === 'pi' && route[2] === 'oauth'
        && route[3] === 'jobs' && route[5] === 'interaction' && method === 'GET') {
        if (options.piOAuthJobs === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'PI_OAUTH_UNAVAILABLE', message: 'La integración Pi no está disponible.', safeCode: 'PI_OAUTH_UNAVAILABLE', retryable: true });
        }
        const jobId = parseSchema(JobIdSchema, route[4]);
        const query = parseQuery(url, PiOAuthInteractionQuerySchema);
        const result = await options.piOAuthJobs.readInteraction({
          jobId, after: query.after ?? 0, sessionScope: oauthInteractionSessionScope(session),
        });
        if (typeof result === 'object' && result !== null && Reflect.get(result, 'kind') === 'missing') {
          fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Job OAuth no encontrado.' });
        }
        if (typeof result === 'object' && result !== null && Reflect.get(result, 'kind') === 'forbidden') {
          fail({ status: 403, kind: 'forbidden', code: 'OAUTH_INTERACTION_SESSION_MISMATCH', message: 'El canal OAuth pertenece a otra sesión local.' });
        }
        sendJson(res, 200, parseSchema(PiOAuthInteractionViewSchema, result));
        return;
      }

      if (route.length === 1 && route[0] === 'session' && method === 'GET') {
        const view = parseSchema(SessionViewSchema, getSessionView(session, now()));
        sendJson(res, 200, view, { ETag: sessionEtag(session) });
        return;
      }

      if (route.length === 1 && route[0] === 'session' && method === 'DELETE') {
        requireCsrf(req, session);
        sessions.delete(session.token);
        for(const client of refreshClients)if(client.session===session)closeRefresh(client);
        session.observerViews.clear();
        session.operations.clear();
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/api/v1; HttpOnly; SameSite=Strict; Max-Age=0`);
        res.writeHead(204);
        res.end();
        return;
      }

      if (route.length === 2 && route[0] === 'session' && route[1] === 'mode' && method === 'PUT') {
        requireCsrf(req, session);
        const candidate = parseSchema(SessionModeSchema, await readJsonBody(req));
        const replayed = checkIdempotentReplay({ req, res, session, path: pathname, body: candidate });
        if (replayed) return;
        const key = readIdempotencyKey(req);
        requireCurrentSessionEtag(req, session);
        let authorized: SessionMode | null;
        if (candidate.kind === 'observer') authorized = candidate;
        else if (options.resolveSessionMode === undefined) authorized = null;
        else authorized = await options.resolveSessionMode(candidate);
        if (authorized === null) {
          fail({ status: 403, kind: 'forbidden', code: 'CAPABILITY_REQUIRED', message: 'El modo solicitado no está disponible en una configuración autorizada.' });
        }
        const resolvedMode = parseSchema(SessionModeSchema, authorized);
        session.mode = resolvedMode;
        session.revision += 1;
        const etag = sessionEtag(session);
        const result = parseSchema(SessionViewSchema, getSessionView(session, now()));
        rememberOperation({ req, session, key, path: pathname, body: candidate, status: 200, result, etag });
        sendJson(res, 200, result, { ETag: etag });
        return;
      }

      if (route.length === 1 && route[0] === 'runs' && method === 'GET') {
        if (options.runConfigurationDrafts === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'RUN_DRAFTS_UNAVAILABLE', message: 'Los borradores de puesta no están disponibles.', safeCode: 'RUN_DRAFTS_UNAVAILABLE', retryable: true });
        }
        const query = parseQuery(url, PageQuerySchema);
        const offset = decodeCursor(query.cursor, 1_000_000);
        const limit = query.limit ?? DEFAULT_PAGE_SIZE;
        const drafts = z.array(RunConfigurationDraftSchema).max(101)
          .parse(await options.runConfigurationDrafts.listRunConfigurationDrafts({ limit: limit + 1, offset }));
        const hasMore = drafts.length > limit;
        const summaries = (await Promise.all(drafts.slice(0, limit).map(async (draft) => {
          const view = await readRunConfigurationDraftView(options.runConfigurationDrafts!, draft.runId, draft);
          return view === undefined ? undefined : runConfigurationDraftSummary(view);
        }))).filter((summary): summary is NonNullable<typeof summary> => summary !== undefined);
        const result = RunConfigurationDraftPageSchema.parse({
          items: summaries,
          ...(hasMore ? { nextCursor: encodeCursor(offset + limit) } : {}),
        });
        sendJson(res, 200, result);
        return;
      }

      if (route.length === 1 && route[0] === 'runs' && method === 'POST') {
        requireCsrf(req, session);
        const idempotencyKey = readIdempotencyKey(req);
        requireIfNoneMatchStar(req);
        if (options.runConfigurationDrafts === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'RUN_DRAFTS_UNAVAILABLE', message: 'Los borradores de puesta no están disponibles.', safeCode: 'RUN_DRAFTS_UNAVAILABLE', retryable: true });
        }
        const rawBody = await readJsonBody(req);
        enforceJsonWireLimits(rawBody);
        const body = parseSchema(RunConfigurationDraftRequestSchema, rawBody);
        if (body.configuration.revision !== 0) {
          fail({ status: 422, kind: 'validation', code: 'VALIDATION_FAILED', message: 'Un borrador nuevo debe partir de la revisión cero.', issues: [{ path: ['configuration', 'revision'], code: 'HOST_OWNED_FIELD' }] });
        }
        const result = RunDraftMutationResultSchema.parse(await options.runConfigurationDrafts.createRunConfigurationDraft({
          principalId: localOperatorPrincipalId(),
          idempotencyKey,
          patch: parseSchema(RunDraftPatchSchema, runDraftPatch(body.configuration)),
        }));
        if (result.kind === 'idempotencyConflict') {
          fail({ status: 409, kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSE', message: 'La clave idempotente ya pertenece a otra operación de borrador.' });
        }
        if (result.kind !== 'created' && result.kind !== 'existing') throw new Error('Resultado de creación de borrador inesperado');
        const receipt = RunConfigurationDraftMutationReceiptSchema.parse({ kind: 'run-configuration-draft-receipt', configuration: result.draft });
        sendJson(res, 201, receipt, {
          Location: `/api/v1/runs/${result.draft.runId}`,
          ETag: runConfigurationEtag(result.draft.runId, result.draft.revision),
          ...(result.kind === 'existing' ? { 'Idempotency-Replayed': 'true' } : {}),
        });
        return;
      }

      if (route.length === 2 && route[0] === 'runs' && method === 'GET') {
        if (options.runConfigurationDrafts === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'RUN_DRAFTS_UNAVAILABLE', message: 'Los borradores de puesta no están disponibles.', safeCode: 'RUN_DRAFTS_UNAVAILABLE', retryable: true });
        }
        const runId = parseSchema(RunIdSchema, route[1]);
        const view = await readRunConfigurationDraftView(options.runConfigurationDrafts, runId);
        if (view === undefined) fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Borrador de puesta no encontrado.' });
        sendJson(res, 200, view, { ETag: runConfigurationEtag(view.configuration.runId, view.configuration.revision) });
        return;
      }

      if (route.length === 3 && route[0] === 'runs' && route[2] === 'configuration' && method === 'GET') {
        if (options.runConfigurationDrafts === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'RUN_DRAFTS_UNAVAILABLE', message: 'Los borradores de puesta no están disponibles.', safeCode: 'RUN_DRAFTS_UNAVAILABLE', retryable: true });
        }
        const runId = parseSchema(RunIdSchema, route[1]);
        const view = await readRunConfigurationDraftView(options.runConfigurationDrafts, runId);
        if (view === undefined) fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Borrador de puesta no encontrado.' });
        sendJson(res, 200, view, { ETag: runConfigurationEtag(view.configuration.runId, view.configuration.revision) });
        return;
      }

      if (route.length === 3 && route[0] === 'runs' && route[2] === 'configuration' && method === 'PUT') {
        requireCsrf(req, session);
        const idempotencyKey = readIdempotencyKey(req);
        if (options.runConfigurationDrafts === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'RUN_DRAFTS_UNAVAILABLE', message: 'Los borradores de puesta no están disponibles.', safeCode: 'RUN_DRAFTS_UNAVAILABLE', retryable: true });
        }
        const rawBody = await readJsonBody(req);
        enforceJsonWireLimits(rawBody);
        const body = parseSchema(RunConfigurationDraftRequestSchema, rawBody);
        const runId = parseSchema(RunIdSchema, route[1]);
        if (body.configuration.runId !== runId) {
          fail({ status: 422, kind: 'validation', code: 'VALIDATION_FAILED', message: 'El borrador del body no coincide con el recurso de la ruta.', issues: [{ path: ['configuration', 'runId'], code: 'RESOURCE_ID_MISMATCH' }] });
        }
        const expectedRevision = readExpectedRunConfigurationRevision(req, runId);
        if (body.configuration.revision !== expectedRevision) {
          fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'El body y el ETag refieren revisiones distintas.', currentEtag: runConfigurationEtag(runId, body.configuration.revision) });
        }
        const result = RunDraftMutationResultSchema.parse(await options.runConfigurationDrafts.updateRunConfigurationDraft({
          principalId: localOperatorPrincipalId(),
          idempotencyKey,
          runId,
          expectedRevision,
          patch: parseSchema(RunDraftPatchSchema, runDraftPatch(body.configuration)),
        }));
        if (result.kind === 'idempotencyConflict') {
          fail({ status: 409, kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSE', message: 'La clave idempotente ya pertenece a otra operación de borrador.' });
        }
        if (result.kind === 'missing') fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Borrador de puesta no encontrado.' });
        if (result.kind === 'invalidLifecycle') {
          fail({ status: 409, kind: 'conflict', code: 'INVALID_LIFECYCLE', message: 'La configuración no se puede editar con el ciclo de vida actual.' });
        }
        if (result.kind === 'conflict') {
          const current = await options.runConfigurationDrafts.readRunConfigurationDraftState({ runId });
          const currentRevision = current === undefined ? result.currentRevision : RunDraftStateSchema.parse(current).revision;
          fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'El borrador cambió; recargá antes de guardar.', currentEtag: runConfigurationEtag(runId, currentRevision) });
        }
        if (result.kind !== 'stored' && result.kind !== 'existing') throw new Error('Resultado de actualización de borrador inesperado');
        const receipt = RunConfigurationDraftMutationReceiptSchema.parse({ kind: 'run-configuration-draft-receipt', configuration: result.draft });
        sendJson(res, 200, receipt, {
          ETag: runConfigurationEtag(result.draft.runId, result.draft.revision),
          ...(result.kind === 'existing' ? { 'Idempotency-Replayed': 'true' } : {}),
        });
        return;
      }

      if (route.length === 3 && route[0] === 'runs' && route[2] === 'validate' && method === 'POST') {
        requireCsrf(req, session);
        const idempotencyKey = readIdempotencyKey(req);
        if (options.runConfigurationDrafts === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'RUN_DRAFTS_UNAVAILABLE', message: 'Los borradores de puesta no están disponibles.', safeCode: 'RUN_DRAFTS_UNAVAILABLE', retryable: true });
        }
        const rawBody = await readJsonBody(req);
        enforceJsonWireLimits(rawBody);
        parseSchema(ValidateRunConfigurationDraftRequestSchema, rawBody);
        const runId = parseSchema(RunIdSchema, route[1]);
        const expectedRevision = readExpectedRunConfigurationRevision(req, runId);
        const result = RunDraftValidationResultSchema.parse(await options.runConfigurationDrafts.validateRunConfigurationDraft({
          principalId: localOperatorPrincipalId(), idempotencyKey, runId, expectedRevision,
        }));
        if (result.kind === 'missing') fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Borrador de puesta no encontrado.' });
        if (result.kind === 'conflict') {
          const current = await options.runConfigurationDrafts.readRunConfigurationDraftState({ runId });
          const currentRevision = current === undefined ? result.currentRevision : RunDraftStateSchema.parse(current).revision;
          fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'El borrador cambió; recargá antes de validar.', currentEtag: runConfigurationEtag(runId, currentRevision) });
        }
        if (result.kind === 'invalidLifecycle') {
          fail({ status: 409, kind: 'conflict', code: 'INVALID_LIFECYCLE', message: 'La configuración no se puede validar con el ciclo de vida actual.' });
        }
        if (result.kind === 'idempotencyConflict') {
          fail({ status: 409, kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSE', message: 'La clave idempotente ya pertenece a otra operación de borrador.' });
        }
        const receipt = runConfigurationValidationReceipt(result);
        sendJson(res, 200, receipt, { ETag: runConfigurationEtag(receipt.runId, receipt.revision) });
        return;
      }

      if (route.length === 3 && route[0] === 'runs' && route[2] === 'intervention-context' && method === 'GET') {
        const runId = parseSchema(RunIdSchema, route[1]);
        if (session.mode.kind !== 'interlocutor' || session.mode.runId !== runId) {
          fail({ status: 403, kind: 'forbidden', code: 'CAPABILITY_REQUIRED', message: 'La sesión no es interlocutora de esta corrida.' });
        }
        if (options.readHumanInteractionContext === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'INTERVENTION_UNAVAILABLE', message: 'El contexto de intervención no está disponible.', safeCode: 'INTERVENTION_UNAVAILABLE', retryable: true });
        }
        const context = await loadHumanInteractionContext(options, { runId, participantId: session.mode.participantId });
        if (context === undefined) fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'La puesta no tiene un contexto de intervención disponible.' });
        sendJson(res, 200, context, { ETag: humanInteractionEtag(context) });
        return;
      }

      if (route.length === 3 && route[0] === 'runs' && route[2] === 'interventions' && method === 'POST') {
        const runId = parseSchema(RunIdSchema, route[1]);
        if (session.mode.kind !== 'interlocutor' || session.mode.runId !== runId) {
          fail({ status: 403, kind: 'forbidden', code: 'CAPABILITY_REQUIRED', message: 'La sesión no es interlocutora de esta corrida.' });
        }
        requireCsrf(req, session);
        const body = parseSchema(HumanInterventionRequestSchema, await readJsonBody(req));
        const idempotencyKey = readIdempotencyKey(req);
        const expectedRevision = readExpectedWorldRevision(req, runId);
        if (options.commitHumanIntervention === undefined) {
          fail({ status: 503, kind: 'dependency', code: 'INTERVENTION_UNAVAILABLE', message: 'El servicio de intervención no está disponible.', safeCode: 'INTERVENTION_UNAVAILABLE', retryable: true });
        }
        const result = HumanInterventionCommitResultSchema.parse(await options.commitHumanIntervention({
          runId, participantId: session.mode.participantId, expectedRevision, idempotencyKey, request: body,
        }));
        if (result.kind === 'idempotencyConflict') {
          fail({ status: 409, kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSE', message: 'La clave idempotente ya pertenece a otra intervención.' });
        }
        if (result.kind === 'invalidLifecycle') fail({status:409,kind:'conflict',code:'INVALID_LIFECYCLE',message:'La representación debe estar ejecutándose para recibir una intervención nueva.'});
        if (result.resolution.kind === 'stale') {
          const current = await loadHumanInteractionContext(options, { runId, participantId: session.mode.participantId });
          fail({ status: 412, kind: 'precondition', code: 'PRECONDITION_FAILED', message: 'El Escenario cambió; actualizá el contexto antes de intervenir.', ...(current === undefined ? {} : { currentEtag: humanInteractionEtag(current) }) });
        }
        if (result.resolution.kind === 'notApplied') {
          fail({ status: 422, kind: 'validation', code: 'INTERVENTION_NOT_APPLIED', message: 'El Escenario no pudo aplicar la intervención.', issues: [{ path: ['reason'], code: result.resolution.reason }] });
        }
        const event = result.resolution.events.find((candidate) => candidate.kind === 'humanIntervention');
        if (event === undefined || result.commitIndex === null) throw new Error('Falta el evento o commit de la intervención confirmada');
        const accepted = HumanInterventionAcceptedSchema.parse({
          kind: 'accepted', interventionId: result.resolution.interventionId, eventId: event.id,
          effectiveAudience: event.effectiveAudience, commitIndex: result.commitIndex,
          worldRevision: result.resolution.newSnapshot.revision, worldSeq: result.resolution.newSnapshot.seq,
          deliveryState: event.effectiveAudience.length === 0 ? 'no-recipient' : 'planned',
        });
        sendJson(res, 202, accepted, {
          ETag: `"world:${runId}:r${accepted.worldRevision}"`,
          ...(result.kind === 'existing' ? { 'Idempotency-Replayed': 'true' } : {}),
        });
        return;
      }

      if (route.length === 3 && route[0] === 'runs' && route[2] === 'observer-view' && method === 'PUT') {
        requireCsrf(req, session);
        const runId = z.string().uuid().parse(route[1]);
        const body = parseSchema(ObserverViewRequestSchema, await readJsonBody(req));
        const replayed = checkIdempotentReplay({ req, res, session, path: pathname, body });
        if (replayed) return;
        const key = readIdempotencyKey(req);
        requireCurrentSessionEtag(req, session);
        const authorized = options.authorizeObserverView === undefined
          ? false
          : await options.authorizeObserverView(runId, body.mode);
        if (!authorized) {
          fail({ status: 403, kind: 'forbidden', code: 'CAPABILITY_REQUIRED', message: 'La vista solicitada no está disponible para esta sesión.' });
        }
        session.observerViews.set(runId, body.mode);
        session.revision += 1;
        const etag = sessionEtag(session);
        const result = parseSchema(ObserverViewResponseSchema, { mode: body.mode, enabledForSession: true });
        rememberOperation({ req, session, key, path: pathname, body, status: 200, result, etag });
        sendJson(res, 200, result, { ETag: etag });
        return;
      }

      if (route[0]==='runs' && route[2]==='inspector' && method==='GET' && (route.length===3 || (route.length===4&&route[3]==='characters'))) {
        const runId=z.string().uuid().parse(route[1]);
        const inspectionRequestId=z.string().uuid().parse(res.getHeader('X-Request-ID'));
        if(session.observerViews.get(runId)!=='internal')fail({status:403,kind:'forbidden',code:'CAPABILITY_REQUIRED',message:'Activá explícitamente el inspector privado para esta corrida.'});
        if(options.runInspector===undefined)fail({status:503,kind:'dependency',code:'INSPECTOR_UNAVAILABLE',message:'El inspector privado no está disponible.',safeCode:'INSPECTOR_UNAVAILABLE',retryable:false});
        if(route.length===4) {
          parseQuery(url,z.strictObject({}));
          const result=options.runInspector.characters({runId});
          if(result.kind!=='found')fail({status:404,kind:'notFound',code:'NOT_FOUND',message:'La representación no está disponible.'});
          const view=InspectorCharactersSchema.parse(result.view);
          if(view.runId!==runId)throw new Error('Inspector scope mismatch');
          options.onInspectorRead?.({runId,requestId:inspectionRequestId});
          sendJson(res,200,view);return;
        }
        const query=parseQuery(url,z.strictObject({characterId:InspectorRequestSchema.shape.characterId,atWorldSeq:z.coerce.number().int().nonnegative().safe().optional(),worldRevision:z.coerce.number().int().nonnegative().safe().optional()}));
        const result=options.runInspector.inspect({runId,...query});
        if(result.kind==='invalidCut')fail({status:422,kind:'validation',code:'INVALID_REQUEST',message:'El corte solicitado no es un snapshot confirmado.',issues:[{path:['atWorldSeq'],code:'invalid-cut'}]});
        if(result.kind==='missing')fail({status:404,kind:'notFound',code:'NOT_FOUND',message:'El personaje no está disponible en ese corte.'});
        const view=InspectorViewSchema.parse(result.view);
        if(view.runId!==runId||view.characterId!==query.characterId||(query.atWorldSeq!==undefined&&view.atWorldSeq!==query.atWorldSeq)||(query.worldRevision!==undefined&&view.worldRevision!==query.worldRevision))throw new Error('Inspector scope mismatch');
        options.onInspectorRead?.({runId,characterId:view.characterId,atWorldSeq:view.atWorldSeq,requestId:inspectionRequestId});
        sendJson(res,200,view);return;
      }

      if (route.length === 1 && route[0] === 'catalog' && method === 'GET') {
        const query = parseQuery(url, CatalogQuerySchema);
        if (query.query !== undefined) {
          const matches = (await searchCatalog({ catalog: options.catalog, query: query.query }))
            .map((item) => CatalogSearchResultSchema.parse(item));
          const result = page(matches, query.cursor, query.limit);
          sendJson(res, 200, parseSchema(CatalogSearchPageSchema, { kind: 'search', ...result }));
          return;
        }
        const characters = listCharacters(options.catalog).map(safeCharacterSummary);
        const result = page(characters, query.cursor, query.limit);
        sendJson(res, 200, parseSchema(CatalogPageSchema, {
          catalogVersion: options.catalog.manifest.catalogVersion,
          ...result,
        }));
        return;
      }

      if (route.length === 2 && route[0] === 'catalog' && route[1] === 'search' && method === 'GET') {
        const query = parseQuery(url, CatalogQuerySchema);
        if (query.query === undefined) {
          fail({ status: 422, kind: 'validation', code: 'VALIDATION_FAILED', message: 'Se requiere query de búsqueda.', issues: [{ path: ['query'], code: 'REQUIRED' }] });
        }
        const matches = (await searchCatalog({ catalog: options.catalog, query: query.query }))
          .map((item) => CatalogSearchResultSchema.parse(item));
        const result = page(matches, query.cursor, query.limit);
        sendJson(res, 200, parseSchema(CatalogSearchPageSchema, { kind: 'search', ...result }));
        return;
      }

      if (route.length === 2 && route[0] === 'catalog' && method === 'GET') {
        const characterId = parseSchema(CharacterIdSchema, route[1]);
        const query = parseQuery(url, z.strictObject({ revision: z.string().regex(/^(0|[1-9]\d{0,8})$/).optional() }));
        const entry = options.catalog.manifest.characters.find((item) => item.characterId === characterId);
        if (entry === undefined || (query.revision !== undefined && query.revision !== '0')) {
          fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Recurso no encontrado.' });
        }
        const dossier = DossierResponseSchema.parse(DossierSchema.parse(await readDossier({ catalog: options.catalog, characterId })));
        sendJson(res, 200, dossier, { ETag: `"dossier:${dossier.characterId}:r${dossier.revision}:${dossier.contentHash}"` });
        return;
      }

      if (route.length === 1 && route[0] === 'library' && method === 'GET') {
        const query = parseQuery(url, PageQuerySchema);
        const documents = listLibraryDocuments(options.catalog).map(safeDocumentSummary);
        sendJson(res, 200, parseSchema(LibraryPageSchema, page(documents, query.cursor, query.limit)));
        return;
      }

      if (route.length === 1 && route[0] === 'references' && method === 'GET') {
        const query = parseQuery(url, CatalogReferenceQuerySchema);
        sendJson(res, 200, parseSchema(CatalogReferenceTargetSchema, resolveCatalogReference({ catalog: options.catalog, query })));
        return;
      }

      if (route.length === 2 && route[0] === 'library' && method === 'GET') {
        const documentId = parseSchema(SlugSchema, route[1]);
        const document = CatalogDocumentReadSchema.parse(await readLibraryDocument({ catalog: options.catalog, documentId }));
        if (document.kind === 'binary-document') {
          noStoreBinary(res, 200, document.mimeType, document.bytes, document.entry.sha256, `${document.entry.id}.pdf`);
          return;
        }
        const result = parseSchema(TextDocumentResponseSchema, {
          kind: 'text-document',
          id: document.entry.id,
          title: document.entry.title,
          documentKind: document.entry.kind,
          sha256: document.entry.sha256,
          mimeType: document.mimeType,
          text: document.text,
        });
        sendJson(res, 200, result, { ETag: `"${result.sha256}"` });
        return;
      }

      if (route.length === 1 && route[0] === 'research' && method === 'GET') {
        const query = parseQuery(url, ResearchQuerySchema);
        const docs = listLibraryDocuments(options.catalog)
          .filter((entry) => entry.kind === 'research')
          .map(safeDocumentSummary)
          .filter((entry) => query.query === undefined || entry.title.toLocaleLowerCase('es').includes(query.query.toLocaleLowerCase('es')));
        sendJson(res, 200, parseSchema(ResearchPageSchema, page(docs, query.cursor, query.limit)));
        return;
      }

      if (route.length === 2 && route[0] === 'research' && method === 'GET') {
        const researchId = parseSchema(SlugSchema, route[1]);
        const entry = options.catalog.manifest.documents.find((item) => item.id === researchId && item.kind === 'research');
        if (entry === undefined) fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Recurso no encontrado.' });
        const document = CatalogDocumentReadSchema.parse(await readLibraryDocument({ catalog: options.catalog, documentId: researchId }));
        if (document.kind !== 'text-document') fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Recurso no encontrado.' });
        const result = parseSchema(ResearchDocumentResponseSchema, {
          kind: 'text-document',
          id: document.entry.id,
          title: document.entry.title,
          documentKind: document.entry.kind,
          sha256: document.entry.sha256,
          mimeType: document.mimeType,
          text: document.text,
        });
        sendJson(res, 200, result, { ETag: `"${result.sha256}"` });
        return;
      }

      if (route.length === 1 && route[0] === 'avatars' && method === 'GET') {
        const query = parseQuery(url, PageQuerySchema);
        const items = listAvatars(options.catalog).map((entry) => {
          const provenance = options.catalog.avatarManifest.assets.find((asset) => asset.slug === entry.slug);
          if (provenance === undefined) throw new Error('catalog mismatch');
          return AvatarSummarySchema.parse({
            slug: provenance.slug,
            kind: provenance.kind,
            mimeType: provenance.mime_type,
            bytes: provenance.bytes,
            sha256: provenance.sha256,
            name: provenance.name,
            sourceCredit: provenance.source_credit,
            license: provenance.license,
            sourcePage: provenance.source_page,
          });
        });
        sendJson(res, 200, parseSchema(AvatarPageSchema, page(items, query.cursor, query.limit)));
        return;
      }

      if ((route.length === 2 && route[0] === 'avatars' || route.length === 2 && route[0] === 'assets') && method === 'GET') {
        const slug = parseSchema(SlugSchema, route[1]);
        const avatar = CatalogAvatarReadSchema.parse(await readAvatar({ catalog: options.catalog, slug }));
        noStoreBinary(res, 200, avatar.mimeType, avatar.bytes, avatar.provenance.sha256, `${avatar.provenance.slug}.${avatar.provenance.file.split('.').at(-1) ?? 'img'}`);
        return;
      }

      const extension = options.operatorExtensions?.find(service => service.matches({ path: route, method }));
      if (extension !== undefined) {
        const common = {
          path: route, query: url.searchParams, principalId: localOperatorPrincipalId(), mode: session.mode,
          ifMatch: typeof req.headers['if-match'] === 'string' ? req.headers['if-match'] : null,
          ifNoneMatch: typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'] : null,
        };
        let request: OperatorRequest;
        if (method === 'GET') request = { ...common, kind: 'read', method };
        else if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
          requireCsrf(req, session);
          const idempotencyKey = readIdempotencyKey(req);
          const maxBytes = z.number().int().min(1).max(24 * 1024 * 1024).parse(extension.maxBodyBytes ?? MAX_JSON_BODY_BYTES);
          const emptyDelete = method === 'DELETE' && req.headers['content-length'] === undefined && req.headers['transfer-encoding'] === undefined;
          request = { ...common, kind: 'write', method, idempotencyKey, body: emptyDelete ? {} : await readJsonBody(req, maxBytes) };
        } else fail({ status: 405, kind: 'validation', code: 'METHOD_NOT_ALLOWED', message: 'Método HTTP no permitido.', issues: [] });
        let result: z.infer<typeof OperatorResponseSchema>;
        try { result = OperatorResponseSchema.parse(await extension.handle(request)); }
        catch (error) { if (error instanceof z.ZodError) throw validationFailure(error); throw error; }
        switch (result.kind) {
          case 'json': sendJson(res, result.status, result.body, {
            ...(result.headers.ETag === undefined ? {} : { ETag: result.headers.ETag }),
            ...(result.headers.Location === undefined ? {} : { Location: result.headers.Location }),
          }); return;
          case 'binary': {
            if (createHash('sha256').update(result.bytes).digest('hex') !== result.sha256) throw new Error('Artifact checksum mismatch');
            noStoreBinary(res, 200, result.mimeType, result.bytes, result.sha256, result.filename); return;
          }
          case 'problem': fail({ status: HttpFailureStatusSchema.parse(result.status), ...result.error });
          default: { const exhaustive: never = result; throw new Error(String(exhaustive)); }
        }
      }

      if (method === 'GET' || method === 'HEAD') {
        fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Recurso no encontrado.' });
      }
      fail({ status: 405, kind: 'validation', code: 'METHOD_NOT_ALLOWED', message: 'Método HTTP no permitido.', issues: [] });
    }

    fail({ status: 404, kind: 'notFound', code: 'NOT_FOUND', message: 'Recurso no encontrado.' });
  }

  return {
    async listen(port = 0) {
      if (listening) throw new Error('El servidor local ya está escuchando');
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({ host: '127.0.0.1', port });
      });
      listening = true;
      const local = canonicalLocalOrigin(server);
      if (local === undefined) throw new Error('El servidor no quedó en loopback');
      return {
        address: '127.0.0.1', port: local.port, origin: local.origin,
      } satisfies Awaited<ReturnType<LocalHttpServer['listen']>>;
    },
    async close() {
      if (!listening) return;
      serverClosing=true;
      if(refreshTimer!==undefined){clearInterval(refreshTimer);refreshTimer=undefined;}
      for(const client of refreshClients)closeRefresh(client);
      await refreshTick;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
      listening = false;
      sessions.clear();
      bootstraps.clear();
    },
  };
}

export function createRepositoryCatalogPort(repositoryRoot: unknown): Promise<LoadedCatalog> {
  return loadCatalog({ repositoryRoot });
}
import { CatalogReferenceQuerySchema, CatalogReferenceTargetSchema } from '../domain/catalog-links.ts';
import { resolveCatalogReference } from '../adapters/catalog-links.ts';
