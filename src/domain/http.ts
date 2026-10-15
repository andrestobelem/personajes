import { z } from 'zod';
import { SelectableInferenceProfileSchema } from './inference-profile.ts';
import { PiAccessJobViewSchema, PiAccessEffectiveProfileSchema, PiAccessJobSafeCodeSchema } from './pi-access-jobs.ts';
import { RunPreflightJobDocumentSchema } from './run-preflight-jobs.ts';
export { RunPreflightJobViewSchema, RunPreflightJobDocumentSchema, RunPreflightJobReceiptSchema } from './run-preflight-jobs.ts';
export type { RunPreflightJobView } from './run-preflight-jobs.ts';
export type RunPreflightJobDocument = z.infer<typeof RunPreflightJobDocumentSchema>;
export { PiAccessJobViewSchema } from './pi-access-jobs.ts';
export type { PiAccessJobView } from './pi-access-jobs.ts';
import { WorldLifecycleSchema } from './run-lifecycle.ts';
import { CatalogDocumentKindSchema, DossierSchema } from './catalog.ts';
import {
  NarrationModeSchema,
  ProductionAudioSchema, ProductionValidationIssueSchema, RunBudgetSchema,
  RunConfigurationDraftSchema,
} from './production.ts';
import { PersistedInferenceProfileSchema } from './inference-profile.ts';
import { SpanishVarietyForActingSchema } from './preparation.ts';
import { SceneIdSchema, WorldClockSchema } from './world-schema.ts';
import { EpisodeIdSchema } from './dramatic-structure.ts';
import { JobIdSchema } from './values.ts';
import {
  CharacterIdSchema, EventIdSchema, HashSchema, HumanInterventionIdSchema, HumanParticipantIdSchema,
  RunIdSchema, WorldSeqSchema,
} from './values.ts';

export const BOOTSTRAP_META_NAME = 'personajes-bootstrap';

const OpaqueTokenSchema = z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/);
const RevisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const PageCursorSchema = z.string().min(1).max(64).regex(/^p1\.[A-Za-z0-9_-]{1,32}$/);

export const BootstrapRequestSchema = z.strictObject({
  bootNonce: OpaqueTokenSchema,
});
export type BootstrapRequest = z.infer<typeof BootstrapRequestSchema>;

export const SessionCreatedSchema = z.strictObject({
  csrfToken: OpaqueTokenSchema,
  expiresAt: z.string().datetime({ offset: true }),
});
export type SessionCreated = z.infer<typeof SessionCreatedSchema>;

export const SessionModeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('observer') }),
  z.strictObject({
    kind: z.literal('interlocutor'),
    runId: RunIdSchema,
    participantId: HumanParticipantIdSchema,
  }),
  z.strictObject({
    kind: z.literal('director'),
    runId: RunIdSchema,
    scope: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('run') }),
      z.strictObject({ kind: z.literal('scene'), sceneId: z.string().uuid() }),
    ]),
  }),
]);
export type SessionMode = z.infer<typeof SessionModeSchema>;

export const SessionViewSchema = z.strictObject({
  kind: z.literal('authenticated'),
  expiresAt: z.string().datetime({ offset: true }),
  capabilities: z.array(z.enum([
    'catalog.read', 'library.read', 'research.read', 'avatars.read',
    'session.mode', 'inspector.read', 'intervention.write',
  ])).max(7),
  mode: SessionModeSchema,
  sessionRevision: RevisionSchema,
});
export type SessionView = z.infer<typeof SessionViewSchema>;

const PiOAuthSafeCodeSchema = z.enum([
  'OAUTH_STATUS_UNAVAILABLE', 'OAUTH_LOGIN_FAILED', 'OAUTH_LOGOUT_FAILED',
  'OAUTH_CANCELLED', 'OAUTH_BUSY', 'OAUTH_CALLBACK_FAILED', 'OAUTH_HOST_INTERRUPTED',
]);

/** Safe local status only; neither OAuth material nor a live access check is exposed. */
export const PiIntegrationStatusSchema = z.strictObject({
  kind: z.literal('pi-integration-status'),
  provider: z.literal('openai-codex'),
  authState: z.enum(['missing', 'present', 'error']),
  requiredProfile: z.strictObject({
    provider: z.literal('openai-codex'),
    model: z.literal('gpt-6.1-sol'),
    thinking: z.literal('low'),
  }),
  /** Model availability and account entitlement are deliberately not inferred from stored auth. */
  effectiveProfile: PiAccessEffectiveProfileSchema.nullable(),
  accessCheck: z.enum(['notRun', 'passed', 'failed', 'stale']),
  checkedAt: z.string().datetime({ offset: true }),
  safeCode: z.union([PiOAuthSafeCodeSchema, PiAccessJobSafeCodeSchema]).nullable(),
}).superRefine((status, context) => {
  if ((status.accessCheck === 'passed') !== (status.effectiveProfile !== null)) context.addIssue({ code: 'custom', path: ['effectiveProfile'], message: 'Sólo una comprobación vigente aprobada informa un perfil efectivo.' });
});
export type PiIntegrationStatus = z.infer<typeof PiIntegrationStatusSchema>;

export const PiAccessStatusMetadataSchema = z.strictObject({
  accessCheck: z.enum(['notRun', 'passed', 'failed', 'stale']),
  effectiveProfile: PiAccessEffectiveProfileSchema.nullable(),
  safeCode: PiAccessJobSafeCodeSchema.nullable(),
}).superRefine((status, context) => {
  if ((status.accessCheck === 'passed') !== (status.effectiveProfile !== null)) context.addIssue({ code: 'custom', path: ['effectiveProfile'], message: 'Sólo un receipt vigente aprobado informa un perfil efectivo.' });
});

/** A durable OAuth operation is metadata only; interaction values live in an authenticated memory channel. */
export const PiOAuthJobViewSchema = z.strictObject({
  kind: z.literal('pi-oauth-job'),
  jobId: z.string().uuid(),
  provider: z.literal('openai-codex'),
  operation: z.enum(['login', 'logout']),
  state: z.enum(['queued', 'running', 'cancel-requested', 'succeeded', 'failed', 'canceled', 'interrupted']),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  safeCode: PiOAuthSafeCodeSchema.nullable(),
});
export type PiOAuthJobView = z.infer<typeof PiOAuthJobViewSchema>;

export const PiOAuthJobPageSchema = z.strictObject({
  kind: z.literal('pi-oauth-job-page'),
  items: z.array(PiOAuthJobViewSchema).max(100),
  nextCursor: PageCursorSchema.nullable(),
  /** The first 1,000 newest jobs are the host journal's bounded recovery window. */
  truncated: z.boolean(),
});
export type PiOAuthJobPage = z.infer<typeof PiOAuthJobPageSchema>;

export const PiOAuthJobReceiptSchema = z.strictObject({
  kind: z.literal('pi-oauth-job-receipt'),
  job: PiOAuthJobViewSchema,
});
export type PiOAuthJobReceipt = z.infer<typeof PiOAuthJobReceiptSchema>;

export const PiAccessCheckRequestSchema = z.strictObject({ profile: SelectableInferenceProfileSchema });
export type PiAccessCheckRequest = z.infer<typeof PiAccessCheckRequestSchema>;
export const PiAccessJobPageSchema = z.strictObject({
  kind: z.literal('pi-access-job-page'),
  items: z.array(PiAccessJobViewSchema).max(100),
  nextCursor: PageCursorSchema.nullable(),
  truncated: z.boolean(),
});
export type PiAccessJobPage = z.infer<typeof PiAccessJobPageSchema>;
export const PiAccessJobReceiptSchema = z.strictObject({
  kind: z.literal('pi-access-job-receipt'), job: PiAccessJobViewSchema,
});
export type PiAccessJobReceipt = z.infer<typeof PiAccessJobReceiptSchema>;

export const RunPreflightRequestSchema = z.strictObject({});
export const RunPreflightJobPageSchema = z.strictObject({
  kind: z.literal('run-preflight-job-page'),
  items: z.array(RunPreflightJobDocumentSchema).max(100),
  nextCursor: PageCursorSchema.nullable(),
  truncated: z.boolean(),
});
export type RunPreflightJobPage = z.infer<typeof RunPreflightJobPageSchema>;

/** The only interactive value currently exposed is the public device-login user code. */
export const PiOAuthInteractionViewSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('waiting'), cursor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
  z.strictObject({
    kind: z.literal('device-code'),
    cursor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    verificationUri: z.literal('https://auth.openai.com/codex/device'),
    userCode: z.string().min(4).max(64).regex(/^[A-Z0-9-]+$/),
    expiresAt: z.string().datetime({ offset: true }),
  }),
]);
export type PiOAuthInteractionView = z.infer<typeof PiOAuthInteractionViewSchema>;

export const ObserverViewRequestSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('stage') }),
  z.strictObject({ mode: z.literal('internal'), confirm: z.literal(true) }),
]);
export type ObserverViewRequest = z.infer<typeof ObserverViewRequestSchema>;

export const ObserverViewResponseSchema = z.strictObject({
  mode: z.enum(['stage', 'internal']),
  enabledForSession: z.literal(true),
});
export type ObserverViewResponse = z.infer<typeof ObserverViewResponseSchema>;

export const HumanInterventionAcceptedSchema = z.strictObject({
  kind: z.literal('accepted'),
  interventionId: HumanInterventionIdSchema,
  eventId: EventIdSchema,
  effectiveAudience: z.array(CharacterIdSchema).max(100),
  commitIndex: RevisionSchema,
  worldRevision: RevisionSchema,
  worldSeq: WorldSeqSchema,
  deliveryState: z.enum(['planned', 'no-recipient']),
});
export type HumanInterventionAccepted = z.infer<typeof HumanInterventionAcceptedSchema>;

export const ValidationIssueSchema = z.strictObject({
  path: z.array(z.union([z.string().max(120), z.number().int().min(0)])).max(32),
  code: z.string().min(1).max(80),
});

const ProblemCommonSchema = {
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(240),
};

export const ApiProblemErrorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('validation'), ...ProblemCommonSchema, issues: z.array(ValidationIssueSchema).max(100) }),
  z.strictObject({ kind: z.literal('unauthenticated'), ...ProblemCommonSchema }),
  z.strictObject({ kind: z.literal('forbidden'), ...ProblemCommonSchema }),
  z.strictObject({ kind: z.literal('notFound'), ...ProblemCommonSchema }),
  z.strictObject({ kind: z.literal('conflict'), ...ProblemCommonSchema, currentEtag: z.string().max(200).optional() }),
  z.strictObject({ kind: z.literal('precondition'), ...ProblemCommonSchema, currentEtag: z.string().max(200).optional() }),
  z.strictObject({ kind: z.literal('budget'), ...ProblemCommonSchema, recoverable: z.boolean() }),
  z.strictObject({ kind: z.literal('dependency'), ...ProblemCommonSchema, safeCode: z.string().min(1).max(80), retryable: z.boolean() }),
  z.strictObject({ kind: z.literal('internal'), ...ProblemCommonSchema }),
]);
export type ApiProblemError = z.infer<typeof ApiProblemErrorSchema>;

export const ApiProblemSchema = z.strictObject({
  error: ApiProblemErrorSchema,
  requestId: z.string().uuid(),
});
export type ApiProblem = z.infer<typeof ApiProblemSchema>;

export const CatalogCharacterSummarySchema = z.strictObject({
  characterId: CharacterIdSchema,
  displayName: z.string().min(1).max(200),
  revision: z.literal(0),
  hash: HashSchema,
  curationStatus: z.literal('unreviewed'),
  avatarRef: z.strictObject({ kind: z.literal('catalog-reference'), slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/) }),
});
export type CatalogCharacterSummary = z.infer<typeof CatalogCharacterSummarySchema>;

export const CatalogPageSchema = z.strictObject({
  catalogVersion: z.string().min(1).max(120),
  items: z.array(CatalogCharacterSummarySchema).max(100),
  nextCursor: PageCursorSchema.optional(),
});
export type CatalogPage = z.infer<typeof CatalogPageSchema>;

export const CatalogSearchResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('character-match'),
    id: CharacterIdSchema,
    title: z.string().min(1).max(300),
    matchedBy: z.enum(['label', 'markdown-text']),
  }),
  z.strictObject({
    kind: z.literal('document-match'),
    id: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
    title: z.string().min(1).max(300),
    matchedBy: z.enum(['label', 'markdown-text']),
  }),
]);
export type CatalogSearchResult = z.infer<typeof CatalogSearchResultSchema>;

export const CatalogSearchPageSchema = z.strictObject({
  kind: z.literal('search'),
  items: z.array(CatalogSearchResultSchema).max(100),
  nextCursor: PageCursorSchema.optional(),
});
export type CatalogSearchPage = z.infer<typeof CatalogSearchPageSchema>;

export const LibraryDocumentSummarySchema = z.strictObject({
  id: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(300),
  kind: CatalogDocumentKindSchema,
  sha256: HashSchema,
});
export type LibraryDocumentSummary = z.infer<typeof LibraryDocumentSummarySchema>;

export const LibraryPageSchema = z.strictObject({
  items: z.array(LibraryDocumentSummarySchema).max(100),
  nextCursor: PageCursorSchema.optional(),
});
export type LibraryPage = z.infer<typeof LibraryPageSchema>;

export const ResearchPageSchema = LibraryPageSchema;
export type ResearchPage = z.infer<typeof ResearchPageSchema>;

export const AvatarSummarySchema = z.strictObject({
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  kind: z.enum(['character_avatar_reference', 'group_reference']),
  mimeType: z.enum(['image/gif', 'image/webp', 'image/png', 'image/jpeg']),
  bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sha256: HashSchema,
  name: z.string().min(1).max(200),
  sourceCredit: z.string().min(1).max(2_000),
  license: z.string().min(1).max(2_000),
  sourcePage: z.string().url(),
});
export type AvatarSummary = z.infer<typeof AvatarSummarySchema>;

export const AvatarPageSchema = z.strictObject({
  items: z.array(AvatarSummarySchema).max(100),
  nextCursor: PageCursorSchema.optional(),
});
export type AvatarPage = z.infer<typeof AvatarPageSchema>;

/** The durable validation receipt says whether this exact revision was promoted. */
export const RunConfigurationDraftValidationViewSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('valid'), promotion: z.enum(['not-promoted', 'promoted']) }),
  z.strictObject({ kind: z.literal('incomplete'), promotion: z.literal('not-promoted'), issues: z.array(ProductionValidationIssueSchema).min(1) }),
  z.strictObject({ kind: z.literal('invalid'), promotion: z.literal('not-promoted'), issues: z.array(ProductionValidationIssueSchema).min(1) }),
]);
export type RunConfigurationDraftValidationView = z.infer<typeof RunConfigurationDraftValidationViewSchema>;

export const RunConfigurationValidationReceiptSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('valid'), runId: RunIdSchema, revision: RevisionSchema, promotion: z.literal('promoted'), worldRevision: RevisionSchema, configurationHash: HashSchema }),
  z.strictObject({ kind: z.literal('incomplete'), runId: RunIdSchema, revision: RevisionSchema, promotion: z.literal('not-promoted'), issues: z.array(ProductionValidationIssueSchema).min(1) }),
  z.strictObject({ kind: z.literal('invalid'), runId: RunIdSchema, revision: RevisionSchema, promotion: z.literal('not-promoted'), issues: z.array(ProductionValidationIssueSchema).min(1) }),
]);
export type RunConfigurationValidationReceipt = z.infer<typeof RunConfigurationValidationReceiptSchema>;

export const RunConfigurationDraftViewSchema = z.strictObject({
  kind: z.literal('run-configuration-draft'),
  configuration: RunConfigurationDraftSchema,
  state: z.strictObject({
    lifecycle: WorldLifecycleSchema,
    configurationRevision: RevisionSchema,
    worldRevision: RevisionSchema.nullable(),
    editability: z.enum(['editable','fork-published','identity-promoted']).optional(),
  }),
  validation: RunConfigurationDraftValidationViewSchema,
});
export type RunConfigurationDraftView = z.infer<typeof RunConfigurationDraftViewSchema>;

/** Immutable receipt for a completed create/update operation; current state is read separately. */
export const RunConfigurationDraftMutationReceiptSchema = z.strictObject({
  kind: z.literal('run-configuration-draft-receipt'),
  configuration: RunConfigurationDraftSchema,
});
export type RunConfigurationDraftMutationReceipt = z.infer<typeof RunConfigurationDraftMutationReceiptSchema>;

export const RunConfigurationDraftSummarySchema = z.strictObject({
  kind: z.literal('run-configuration-draft-summary'),
  runId: RunIdSchema,
  revision: RevisionSchema,
  name: z.string().min(1).max(120).nullable(),
  lifecycle: WorldLifecycleSchema,
  configurationRevision: RevisionSchema,
  worldRevision: RevisionSchema.nullable(),
  validation: z.strictObject({
    kind: z.enum(['valid', 'incomplete', 'invalid']),
    promotion: z.enum(['not-promoted', 'promoted']),
    issueCount: z.number().int().min(0).max(10_000),
  }),
});
export type RunConfigurationDraftSummary = z.infer<typeof RunConfigurationDraftSummarySchema>;

export const RunConfigurationDraftPageSchema = z.strictObject({
  items: z.array(RunConfigurationDraftSummarySchema).max(100),
  nextCursor: PageCursorSchema.optional(),
});
export type RunConfigurationDraftPage = z.infer<typeof RunConfigurationDraftPageSchema>;

/** Public, operator-facing configuration projection. Internal preflight fences,
 * prompts, memory state, credentials and local filesystem paths are excluded. */
export const RunViewConfigurationSchema = z.strictObject({
  runId: RunIdSchema, configRevision: RevisionSchema, name: z.string().trim().min(1).max(120),
  fictionalAt: z.number().int().min(-8_640_000_000_000_000).max(8_640_000_000_000_000),
  continuity: z.strictObject({continuityId:z.string().min(1).max(80),revision:RevisionSchema}),
  roster: z.strictObject({activeCharacterCount:z.number().int().min(0).max(100)}),
  humanParticipantCount:z.number().int().min(0).max(100),
  language: z.literal('es'),spanishVariety: SpanishVarietyForActingSchema,narrationMode: NarrationModeSchema,
  inferenceProfile: PersistedInferenceProfileSchema.optional(),budget:RunBudgetSchema,maxReformulations:z.number().int().min(0).max(2),
  audio:z.strictObject({mode:ProductionAudioSchema.shape.mode}),
});
export type RunViewConfiguration = z.infer<typeof RunViewConfigurationSchema>;

export const RunViewLifecycleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('draft') }),
  z.strictObject({ kind: z.literal('ready') }),
  z.strictObject({ kind: z.literal('running') }),
  z.strictObject({ kind: z.literal('paused') }),
  z.strictObject({ kind: z.literal('stopped') }),
  z.strictObject({ kind: z.literal('closed'), closedAt: z.string().datetime({ offset: true }) }),
]);

const BudgetCountersSchema = z.strictObject({
  limit: RevisionSchema,
  used: RevisionSchema,
  reserved: RevisionSchema,
  remaining: RevisionSchema,
}).superRefine((budget, context) => {
  if (budget.used + budget.reserved > budget.limit || budget.remaining !== budget.limit - budget.used - budget.reserved) {
    context.addIssue({ code: 'custom', path: ['remaining'], message: 'Los contadores del presupuesto deben sumar su límite.' });
  }
});

export const RunBudgetViewSchema = z.strictObject({
  modelCalls: BudgetCountersSchema,
  modelWallTimeMs: z.strictObject({
    limit: RevisionSchema,
    measured: RevisionSchema.nullable(),
    reserved: RevisionSchema,
    remaining: RevisionSchema.nullable(),
  }).superRefine((budget, context) => {
    if (budget.measured === null || budget.remaining === null) return;
    if (budget.measured + budget.reserved > budget.limit || budget.remaining !== budget.limit - budget.measured - budget.reserved) {
      context.addIssue({ code: 'custom', path: ['remaining'], message: 'Los contadores del presupuesto deben sumar su límite.' });
    }
  }),
  voiceDesignCalls: BudgetCountersSchema,
  ttsCalls: BudgetCountersSchema,
  sfxCalls: BudgetCountersSchema,
  /** Audio diagnostics are separate from inference eligibility. */
  audioBudgetStatus: z.enum(['known','unavailable']).optional(),
  status: z.enum(['available', 'exhausted', 'uncertain', 'unknown']),
}).superRefine((budget, context) => {
  if ((budget.modelWallTimeMs.measured === null) !== (budget.modelWallTimeMs.remaining === null)) {
    context.addIssue({ code: 'custom', path: ['modelWallTimeMs'], message: 'La medida y el saldo de wall time se ocultan juntos cuando el historial es desconocido.' });
  }
  if ((budget.status === 'unknown') !== (budget.modelWallTimeMs.measured === null)) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'Un presupuesto desconocido debe conservar explícitamente la incertidumbre del historial.' });
  }
});
export type RunBudgetView = z.infer<typeof RunBudgetViewSchema>;

export const RunLimitsSchema = z.strictObject({
  maxModelCallsPerRun: z.number().int().min(0).max(100_000),
  maxModelCallsPerPulse: z.number().int().min(0).max(256),
  maxConcurrentCalls: z.number().int().min(1).max(8),
  requestTimeoutMs: z.number().int().min(1_000).max(300_000),
  maxModelWallTimeMsPerRun: z.number().int().min(0).max(31_536_000_000),
  maxTtsCallsPerRun: z.number().int().min(0).max(10_000),
  maxDesignCallsPerRun: z.number().int().min(0).max(10_000),
  maxSfxCallsPerRun: z.number().int().min(0).max(10_000),
  maxReformulations: z.number().int().min(0).max(2),
});

export const RunViewSchema = z.strictObject({
  runId: RunIdSchema,
  configRevision: RevisionSchema,
  worldRevision: RevisionSchema,
  structureRevision: RevisionSchema,
  activeEpisodeId: EpisodeIdSchema.nullable(),
  activeSceneId: SceneIdSchema.nullable(),
  lastWorldSeq: WorldSeqSchema,
  /** Added to the S04 ETag because lifecycle transitions have their own durable CAS revision. */
  lifecycleRevision: RevisionSchema,
  lifecycle: RunViewLifecycleSchema,
  config: RunViewConfigurationSchema,
  clock: WorldClockSchema,
  limits: RunLimitsSchema,
  budget: RunBudgetViewSchema,
  createdAt: z.string().datetime({ offset: true }).nullable(),
  updatedAt: z.string().datetime({ offset: true }),
}).superRefine((view, context) => {
  if (view.config.runId !== view.runId) context.addIssue({ code: 'custom', path: ['config', 'runId'], message: 'La configuración refiere otra corrida.' });
  if (view.config.configRevision !== view.configRevision) context.addIssue({ code: 'custom', path: ['config', 'configRevision'], message: 'La revisión de configuración no coincide.' });
  if (view.config.fictionalAt !== view.clock.instant) context.addIssue({code:'custom',path:['config','fictionalAt'],message:'El momento de configuración pública no coincide con el reloj confirmado.'});
});
export type RunView = z.infer<typeof RunViewSchema>;

export const RunControlJobReceiptSchema = z.strictObject({
  jobId: JobIdSchema,
  revision: RevisionSchema,
  state: z.enum(['queued', 'running', 'waiting', 'succeeded', 'failed', 'canceled', 'interrupted']),
});

export const RunControlReceiptSchema = z.strictObject({
  kind: z.literal('run-control-receipt'),
  run: RunViewSchema,
  job: RunControlJobReceiptSchema,
});

/** Results emitted by the host-owned application port. Unknown variants fail closed. */
export const RunControlApplicationResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('updated'), run: RunViewSchema, replayed: z.boolean() }),
  z.strictObject({ kind: z.literal('accepted'), run: RunViewSchema, job: RunControlJobReceiptSchema, replayed: z.boolean() }),
  z.strictObject({ kind: z.literal('stale'), current: RunViewSchema }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('invalidLifecycle'), lifecycle: WorldLifecycleSchema }),
  z.strictObject({ kind: z.literal('preflightRequired') }),
  z.strictObject({ kind: z.literal('preflightBlocked') }),
  z.strictObject({ kind: z.literal('preflightStale'), current: RunViewSchema }),
  z.strictObject({ kind: z.literal('budgetExhausted') }),
  z.strictObject({ kind: z.literal('stepUnavailable') }),
  z.strictObject({ kind: z.literal('runtimeUnavailable'), current: RunViewSchema.optional() }),
  z.strictObject({ kind: z.literal('idempotencyConflict') }),
]);
export type RunControlApplicationResult = z.infer<typeof RunControlApplicationResultSchema>;

export const DossierResponseSchema = DossierSchema;
export type DossierResponse = z.infer<typeof DossierResponseSchema>;

export const TextDocumentResponseSchema = z.strictObject({
  kind: z.literal('text-document'),
  id: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(300),
  documentKind: CatalogDocumentKindSchema,
  sha256: HashSchema,
  mimeType: z.enum(['text/markdown', 'text/plain', 'text/csv']),
  text: z.string().max(8_000_000),
});
export type TextDocumentResponse = z.infer<typeof TextDocumentResponseSchema>;

export const ResearchDocumentResponseSchema = TextDocumentResponseSchema;
export type ResearchDocumentResponse = z.infer<typeof ResearchDocumentResponseSchema>;

export const AvatarProvenanceViewSchema = z.strictObject({
  scope: z.string().min(1).max(500),
  retrievedOn: z.string().date(),
  counts: z.strictObject({
    individualCharacters: z.number().int().nonnegative(),
    additionalFamilyReferences: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
  }),
});
export type AvatarProvenanceView = z.infer<typeof AvatarProvenanceViewSchema>;
