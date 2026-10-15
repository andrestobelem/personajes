import { createHash, randomUUID } from 'node:crypto';
import type { AuthEvent, AuthInteraction, AuthPrompt } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { createPiOAuthPort } from './pi-oauth.ts';
import {
  PiOAuthJobCancelSchema, PiOAuthJobClaimResultSchema, PiOAuthJobCreateResultSchema,
  PiOAuthJobMutationResultSchema, PiOAuthJobViewSchema,
} from '../domain/pi-oauth-jobs.ts';
import {
  PiOAuthInteractionViewSchema, PiOAuthJobPageSchema, PiOAuthJobViewSchema as PiOAuthHttpJobViewSchema,
} from '../domain/http.ts';
import { JobIdSchema } from '../domain/values.ts';

const InputSchema = z.strictObject({
  journal: z.custom<Journal>((value) => typeof value === 'object' && value !== null),
  oauth: z.custom<ReturnType<typeof createPiOAuthPort>>((value) => typeof value === 'object' && value !== null),
  anthropicOAuth: z.custom<ReturnType<typeof createPiOAuthPort>>((value)=>typeof value==='object'&&value!==null).optional(),
  ownerToken: z.string().uuid(),
  principalId: z.string().trim().min(1).max(200).default('local-operator'),
  onDiagnostic: z.custom<(input: { jobId: string; code: 'claim-busy' | 'claim-stale' | 'journal-failure' | 'interaction-rejected' }) => void>(
    (value) => typeof value === 'function',
  ).optional(),
});

type OAuth = ReturnType<typeof createPiOAuthPort>;
type OAuthJob = z.infer<typeof PiOAuthJobViewSchema>;
type InteractionEvent = z.infer<typeof PiOAuthInteractionViewSchema>;
type FailureCode = 'oauth-error' | 'oauth-unavailable' | 'oauth-callback-failed' | 'logout-error';
type JobSafeCode = z.infer<typeof PiOAuthJobViewSchema>['safeCode'];
type ActiveJob = {
  readonly controller: AbortController;
  expectedRevision: number;
  lease?: { ownerToken: string; claimToken: string };
  canceledByOperator: boolean;
  interactionRejected: boolean;
};
type Journal = {
  createPiOAuthJob(input: unknown): unknown;
  readPiOAuthJob(input: unknown): unknown;
  listPiOAuthJobs(input: unknown): unknown;
  claimPiOAuthJob(input: unknown): unknown;
  completePiOAuthJob(input: unknown): unknown;
  cancelPiOAuthJob(input: unknown): unknown;
  recoverAbandonedPiOAuthJobs(input: unknown): unknown;
};

const PublicJobSafeCodeSchema = z.enum([
  'OAUTH_STATUS_UNAVAILABLE', 'OAUTH_LOGIN_FAILED', 'OAUTH_LOGOUT_FAILED',
  'OAUTH_CANCELLED', 'OAUTH_BUSY', 'OAUTH_CALLBACK_FAILED', 'OAUTH_HOST_INTERRUPTED',
]);
const SessionScopeSchema = z.string().regex(/^[0-9a-f]{64}$/);
const SafeCodeMap: Record<Exclude<JobSafeCode, null>, z.infer<typeof PublicJobSafeCodeSchema>> = {
  'oauth-error': 'OAUTH_LOGIN_FAILED',
  'oauth-unavailable': 'OAUTH_STATUS_UNAVAILABLE',
  'oauth-callback-failed': 'OAUTH_CALLBACK_FAILED',
  'logout-error': 'OAUTH_LOGOUT_FAILED',
  'user-canceled': 'OAUTH_CANCELLED',
  'host-interrupted': 'OAUTH_HOST_INTERRUPTED',
};

function publicJob(input: unknown): z.infer<typeof PiOAuthHttpJobViewSchema> {
  const job = PiOAuthJobViewSchema.parse(input);
  return PiOAuthHttpJobViewSchema.parse({
    kind: 'pi-oauth-job', jobId: job.jobId, provider: job.provider, operation: job.kind,
    state: job.state, revision: job.revision, createdAt: job.createdAt, updatedAt: job.updatedAt,
    safeCode: job.safeCode === null ? null : SafeCodeMap[job.safeCode],
  });
}

function safeSdkCode(input: unknown, operation: 'login' | 'logout'): FailureCode {
  const code = typeof input === 'object' && input !== null ? Reflect.get(input, 'code') : undefined;
  if (code === 'OAUTH_STATUS_UNAVAILABLE') return 'oauth-unavailable';
  if (code === 'OAUTH_LOGIN_FAILED' || code === 'OAUTH_BUSY') return 'oauth-error';
  if (code === 'OAUTH_LOGOUT_FAILED') return 'logout-error';
  return operation === 'logout' ? 'logout-error' : 'oauth-error';
}

function verifiedUserCodeEvent(input: Extract<AuthEvent, { type: 'device_code' }>, cursor: number, now: number): InteractionEvent {
  if (input.verificationUri !== 'https://auth.openai.com/codex/device') {
    throw new Error('OAuth verification URL no pertenece al allowlist host');
  }
  if (!/^[A-Z0-9-]{4,64}$/.test(input.userCode)) {
    throw new Error('OAuth device user code tiene formato inesperado');
  }
  const expiresInSeconds = input.expiresInSeconds;
  const ttlSeconds = expiresInSeconds === undefined || !Number.isFinite(expiresInSeconds)
    ? 900 : Math.min(1_800, Math.max(60, Math.trunc(expiresInSeconds)));
  return PiOAuthInteractionViewSchema.parse({
    kind: 'device-code', cursor,
    verificationUri: 'https://auth.openai.com/codex/device',
    userCode: input.userCode,
    expiresAt: new Date(now + ttlSeconds * 1_000).toISOString(),
  });
}

/**
 * Executes durable OpenAI Codex and Anthropic OAuth jobs around one host-owned Pi OAuth port.
 * Interaction values are kept only in an in-memory, browser-session-scoped
 * channel. No OAuth authorization code, token, URL or SDK error enters SQLite.
 */
export async function createPiOAuthJobs(rawInput: {
  journal: Journal;
  oauth: OAuth;
  anthropicOAuth?:OAuth;
  ownerToken: string;
  principalId?: string;
  onDiagnostic?: (input: { jobId: string; code: 'claim-busy' | 'claim-stale' | 'journal-failure' | 'interaction-rejected' }) => void;
}) {
  const input = InputSchema.parse(rawInput);
  const journal = input.journal;
  function oauthFor(provider:'openai-codex'|'anthropic'){const port=provider==='anthropic'?input.anthropicOAuth:input.oauth;if(port===undefined)throw new Error('OAUTH_PROVIDER_UNAVAILABLE');return port;}
  const challenges=new Map<string,{challengeId:string;resolve:(value:string)=>void;reject:()=>void}>();
  const principalId = input.principalId;
  const onDiagnostic = input.onDiagnostic;
  let closed = false;
  let closing: Promise<void> | undefined;
  let nextCursor = 0;
  const queue: Array<{ job: OAuthJob; sessionScope: string }> = [];
  const interactionScopes = new Map<string, string>();
  const interactions = new Map<string, InteractionEvent>();
  const lastCursorByJob = new Map<string, number>();
  const active = new Map<string, ActiveJob>();
  const inFlight = new Set<Promise<unknown>>();
  const workers = new Set<Promise<void>>();
  let pump: Promise<void> | undefined;

  function report(jobId: string, code: 'claim-busy' | 'claim-stale' | 'journal-failure' | 'interaction-rejected'): void {
    try { onDiagnostic?.({ jobId, code }); } catch { /* Diagnostics cannot change OAuth job state. */ }
  }

  function track<T>(operation: () => Promise<T>): Promise<T> {
    const result = Promise.resolve().then(operation);
    let settled: Promise<void>;
    settled = result.then(() => undefined, () => undefined).finally(() => { inFlight.delete(result); });
    inFlight.add(result);
    void settled;
    return result;
  }

  function interactionWaiting(jobId: string): InteractionEvent {
    return PiOAuthInteractionViewSchema.parse({ kind: 'waiting', cursor: lastCursorByJob.get(jobId) ?? 0 });
  }

  function enqueue(job: OAuthJob, sessionScope: string): void {
    if (closed || job.state !== 'queued') return;
    queue.push({ job, sessionScope });
    startPump();
  }

  function startPump(): void {
    if (closed || pump !== undefined) return;
    const task = drainQueue();
    pump = task;
    void task.finally(() => {
      if (pump === task) pump = undefined;
      if (!closed && queue.length > 0) startPump();
    });
  }

  async function drainQueue(): Promise<void> {
    while (!closed && queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) continue;
      const worker = execute(item.job, item.sessionScope);
      workers.add(worker);
      try { await worker; }
      finally { workers.delete(worker); }
    }
  }

  async function complete(input: {
    job: OAuthJob;
    activeJob: ActiveJob;
    outcome: 'succeeded' | 'failed' | 'canceled';
    safeCode: JobSafeCode;
  }): Promise<void> {
    // `close()` aborts SDK work and waits for it before the owner closes the
    // journal. A late SDK success is still authoritative and must be recorded.
    if (input.activeJob.lease === undefined) return;
    const result = PiOAuthJobMutationResultSchema.parse(await journal.completePiOAuthJob({
      jobId: input.job.jobId,
      expectedRevision: input.activeJob.expectedRevision,
      lease: input.activeJob.lease,
      outcome: input.outcome,
      safeCode: input.safeCode,
    }));
    if (result.kind === 'stale') {
      const latest = PiOAuthJobViewSchema.parse(result.job);
      if (latest.state === 'cancel-requested' && active.get(input.job.jobId) === input.activeJob) {
        input.activeJob.expectedRevision = latest.revision;
        const retried = PiOAuthJobMutationResultSchema.parse(await journal.completePiOAuthJob({
          jobId: input.job.jobId, expectedRevision: latest.revision, lease: input.activeJob.lease,
          outcome: input.outcome, safeCode: input.safeCode,
        }));
        if (retried.kind === 'updated' || retried.kind === 'existing' || retried.kind === 'terminal') return;
      }
      report(input.job.jobId, 'journal-failure');
      return;
    }
    if (result.kind === 'missing' || result.kind === 'idempotencyConflict') report(input.job.jobId, 'journal-failure');
  }

  async function execute(job: OAuthJob, sessionScope: string): Promise<void> {
    const activeJob: ActiveJob = {
      controller: new AbortController(), expectedRevision: job.revision,
      canceledByOperator: false, interactionRejected: false,
    };
    active.set(job.jobId, activeJob);
    try {
      if (closed) return;
      const claim = PiOAuthJobClaimResultSchema.parse(await journal.claimPiOAuthJob({
        jobId: job.jobId, expectedRevision: job.revision,
        ownerToken: input.ownerToken, claimToken: randomUUID(),
      }));
      if (claim.kind !== 'claimed' && claim.kind !== 'existing') {
        if (claim.kind === 'busy') report(job.jobId, 'claim-busy');
        if (claim.kind === 'stale') report(job.jobId, 'claim-stale');
        return;
      }
      activeJob.lease = claim.lease;
      activeJob.expectedRevision = claim.job.revision;
      if (closed || activeJob.controller.signal.aborted) return;
      const oauth=oauthFor(job.provider);

      if (claim.job.kind === 'logout') {
        const result = await oauth.logout({ signal: activeJob.controller.signal });
        if (result.kind === 'logged-out') {
          await complete({ job, activeJob, outcome: 'succeeded', safeCode: null });
        } else if (closed) {
          return;
        } else if (activeJob.canceledByOperator || result.code === 'OAUTH_CANCELLED') {
          await complete({ job, activeJob, outcome: 'canceled', safeCode: 'user-canceled' });
        } else {
          await complete({ job, activeJob, outcome: 'failed', safeCode: safeSdkCode(result, 'logout') });
        }
        return;
      }

      let authorizationUrl:string|undefined;
      const interaction: AuthInteraction = {
        signal: activeJob.controller.signal,
        async prompt(prompt: AuthPrompt): Promise<string> {
          if(job.provider==='anthropic'&&prompt.type==='select'&&prompt.options.some(option=>option.id==='copy_code'))return 'copy_code';
          if(job.provider==='anthropic'&&prompt.type==='manual_code'&&authorizationUrl!==undefined){
            const challengeId=randomUUID();const cursor=++nextCursor;const expiresAt=new Date(Date.now()+900_000).toISOString();
            const event=PiOAuthInteractionViewSchema.parse({kind:'authorization-code',cursor,authorizationUrl,challengeId,expiresAt});
            interactionScopes.set(job.jobId,sessionScope);interactions.set(job.jobId,event);lastCursorByJob.set(job.jobId,cursor);
            return new Promise<string>((resolve,reject)=>{let settled=false;const signal=prompt.signal===undefined?activeJob.controller.signal:AbortSignal.any([prompt.signal,activeJob.controller.signal]);const timer=setTimeout(abort,900_000);timer.unref();function clean(){clearTimeout(timer);signal.removeEventListener('abort',abort);challenges.delete(job.jobId);interactions.delete(job.jobId);}function abort(){if(settled)return;settled=true;clean();reject(new Error('OAuth challenge ended'));}challenges.set(job.jobId,{challengeId,resolve(value){if(settled)return;settled=true;clean();resolve(value);},reject:abort});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
          }
          if (job.provider==='openai-codex'&&prompt.type === 'select' && prompt.options.some((option) => option.id === 'device_code')) return 'device_code';
          activeJob.interactionRejected = true;
          report(job.jobId, 'interaction-rejected');
          activeJob.controller.abort();
          throw new Error('OAuth interactive prompt is outside the administrative channel');
        },
        notify(event: AuthEvent): void {
          if (closed || activeJob.controller.signal.aborted) return;
          if(job.provider==='anthropic'&&event.type==='auth_url'){
            try{const url=new URL(event.url);if(url.protocol!=='https:'||url.hostname!=='claude.ai'||url.port!==''||url.pathname!=='/oauth/authorize'||url.username||url.password||url.hash)throw new Error();authorizationUrl=url.href;}catch{activeJob.interactionRejected=true;report(job.jobId,'interaction-rejected');activeJob.controller.abort();}return;
          }
          if (job.provider!=='openai-codex'||event.type !== 'device_code') return;
          try {
            const cursor = ++nextCursor;
            const safeEvent = verifiedUserCodeEvent(event, cursor, Date.now());
            interactionScopes.set(job.jobId, sessionScope);
            interactions.set(job.jobId, safeEvent);
            lastCursorByJob.set(job.jobId, cursor);
          } catch {
            activeJob.interactionRejected = true;
            report(job.jobId, 'interaction-rejected');
            activeJob.controller.abort();
          }
        },
      };
      const result = await oauth.login(interaction);
      interactions.delete(job.jobId);
      if (result.kind === 'configured') {
        await complete({ job, activeJob, outcome: 'succeeded', safeCode: null });
      } else if (closed) {
        return;
      } else if (activeJob.interactionRejected) {
        await complete({ job, activeJob, outcome: 'failed', safeCode: 'oauth-callback-failed' });
      } else if (activeJob.canceledByOperator || result.code === 'OAUTH_CANCELLED') {
        await complete({ job, activeJob, outcome: 'canceled', safeCode: 'user-canceled' });
      } else {
        await complete({ job, activeJob, outcome: 'failed', safeCode: activeJob.interactionRejected
          ? 'oauth-callback-failed' : safeSdkCode(result, 'login') });
      }
    } catch {
      interactions.delete(job.jobId);
      if (closed) return;
      try {
        if (activeJob.canceledByOperator) {
          await complete({ job, activeJob, outcome: 'canceled', safeCode: 'user-canceled' });
        } else if (activeJob.interactionRejected) {
          await complete({ job, activeJob, outcome: 'failed', safeCode: 'oauth-callback-failed' });
        } else {
          await complete({ job, activeJob, outcome: 'failed', safeCode: job.kind === 'logout' ? 'logout-error' : 'oauth-error' });
        }
      } catch { report(job.jobId, 'journal-failure'); }
    } finally {
      challenges.get(job.jobId)?.reject();
      if (active.get(job.jobId) === activeJob) active.delete(job.jobId);
      interactions.delete(job.jobId);
    }
  }

  // Startup recovery runs only after the host has acquired exclusive ownership.
  await journal.recoverAbandonedPiOAuthJobs({ ownerToken: input.ownerToken });

  function startOperation(input: { kind: 'login' | 'logout'; idempotencyKey: string; sessionScope: string;provider?:'openai-codex'|'anthropic' }) {
    return track(async () => {
      if (closed) throw new Error('OAuth job broker is closed');
      const scope = SessionScopeSchema.parse(input.sessionScope);
      const result = PiOAuthJobCreateResultSchema.parse(await journal.createPiOAuthJob({
        principalId, idempotencyKey: input.idempotencyKey, kind: input.kind,provider:input.provider??'openai-codex',
      }));
      if (result.kind === 'idempotencyConflict') return result;
      const job = PiOAuthJobViewSchema.parse(result.job);
      if (result.kind === 'created') {
        if (input.kind === 'login') interactionScopes.set(job.jobId, scope);
        enqueue(job, scope);
      }
      return { kind: result.kind, job: publicJob(job) };
    });
  }

  function status(request?:{provider?:'openai-codex'|'anthropic'}) {
    return track(async () => {
      if (closed) return { kind: 'failed', code: 'OAUTH_STATUS_UNAVAILABLE' } as const;
      try{return await oauthFor(request?.provider??'openai-codex').status();}catch{return {kind:'failed',code:'OAUTH_STATUS_UNAVAILABLE'} as const;}
    });
  }

  function readJob(input: { jobId: string }) {
    return track(async () => {
      const jobId = JobIdSchema.parse(input.jobId);
      const value = await journal.readPiOAuthJob({ jobId });
      return value === undefined ? undefined : publicJob(value);
    });
  }

  function listJobs(input: { offset: number; limit: number }) {
    return track(async () => {
      if (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > 1_000) {
        throw new Error('OAuth job list offset is outside the bounded recovery window');
      }
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        throw new Error('OAuth job page limit is invalid');
      }
      const jobs = z.array(PiOAuthJobViewSchema).max(1_000).parse(await journal.listPiOAuthJobs({
        principalId, limit: 1_000,
      }));
      const items = jobs.slice(input.offset, input.offset + input.limit).map(publicJob);
      const nextOffset = input.offset + items.length;
      return PiOAuthJobPageSchema.parse({
        kind: 'pi-oauth-job-page',
        items,
        nextCursor: nextOffset < jobs.length
          ? `p1.${Buffer.from(String(nextOffset), 'utf8').toString('base64url')}` : null,
        truncated: jobs.length === 1_000,
      });
    });
  }

  function cancelJob(input: { jobId: string; idempotencyKey: string; expectedRevision: number }) {
    return track(async () => {
      const request = PiOAuthJobCancelSchema.parse({
        principalId, idempotencyKey: input.idempotencyKey,
        jobId: input.jobId, expectedRevision: input.expectedRevision,
      });
      const result = PiOAuthJobMutationResultSchema.parse(await journal.cancelPiOAuthJob(request));
      const current = result.kind === 'stale' || result.kind === 'existing' || result.kind === 'terminal'
        ? result.job : undefined;
      const activeJob = active.get(request.jobId);
      if (activeJob !== undefined && (current?.state === 'cancel-requested' || current?.state === 'canceled')) {
        activeJob.expectedRevision = current.revision;
        activeJob.canceledByOperator = true;
        interactions.delete(request.jobId);
        activeJob.controller.abort();
      } else if (activeJob !== undefined && result.kind === 'updated'
        && (result.job.state === 'cancel-requested' || result.job.state === 'canceled')) {
        activeJob.expectedRevision = result.job.revision;
        activeJob.canceledByOperator = true;
        interactions.delete(request.jobId);
        activeJob.controller.abort();
      }
      return result.kind === 'missing' || result.kind === 'idempotencyConflict'
        ? result : { ...result, job: publicJob(result.job) };
    });
  }

  function readInteraction(input: { jobId: string; after: number; sessionScope: string }) {
    return track(async () => {
      const jobId = JobIdSchema.parse(input.jobId);
      const scope = SessionScopeSchema.parse(input.sessionScope);
      const value = await journal.readPiOAuthJob({ jobId });
      if (value === undefined) return { kind: 'missing' } as const;
      const job = PiOAuthJobViewSchema.parse(value);
      if (interactionScopes.get(jobId) !== scope) return { kind: 'forbidden' } as const;
      if (job.state !== 'queued' && job.state !== 'running' && job.state !== 'cancel-requested') {
        interactions.delete(jobId);
        return interactionWaiting(jobId);
      }
      const event = interactions.get(jobId);
      if (event === undefined || (event.kind !== 'device-code'&&event.kind!=='authorization-code') || Date.parse(event.expiresAt) <= Date.now()) {
        interactions.delete(jobId);
        return interactionWaiting(jobId);
      }
      if (input.after >= event.cursor) return interactionWaiting(jobId);
      return event;
    });
  }

  function respondInteraction(request:{jobId:string;challengeId:string;response:string;sessionScope:string}){return track(async()=>{
    const jobId=JobIdSchema.parse(request.jobId);const scope=SessionScopeSchema.parse(request.sessionScope);if(await journal.readPiOAuthJob({jobId})===undefined)return {kind:'missing'} as const;if(interactionScopes.get(jobId)!==scope)return {kind:'forbidden'} as const;
    const challenge=challenges.get(jobId);const event=interactions.get(jobId);if(closed||challenge===undefined||event?.kind!=='authorization-code'||event.challengeId!==request.challengeId||challenge.challengeId!==request.challengeId||Date.parse(event.expiresAt)<=Date.now())return {kind:'stale'} as const;
    const response=z.string().trim().min(1).max(8192).refine(value=>!/[\r\n\0]/.test(value)).parse(request.response);challenge.resolve(response);return {kind:'accepted'} as const;
  });}

  async function close(): Promise<void> {
    if (closing !== undefined) return closing;
    closed = true;
    for (const activeJob of active.values()) activeJob.controller.abort();
    interactions.clear();
    closing = (async () => {
      while (inFlight.size > 0 || workers.size > 0 || pump !== undefined) {
        const pending = [...inFlight, ...workers, ...(pump === undefined ? [] : [pump])];
        await Promise.all(pending.map((task) => task.then(() => undefined, () => undefined)));
      }
      interactionScopes.clear();
      lastCursorByJob.clear();
    })();
    return closing;
  }

  return Object.freeze({
    status,
    startLogin: (input: { idempotencyKey: string; sessionScope: string;provider?:'openai-codex'|'anthropic' }) => startOperation({ ...input, kind: 'login' }),
    startLogout: (input: { idempotencyKey: string; sessionScope: string;provider?:'openai-codex'|'anthropic' }) => startOperation({ ...input, kind: 'logout' }),
    readJob,
    listJobs,
    cancelJob,
    readInteraction,
    respondInteraction,
    close,
    get isClosed() { return closed; },
    get backupBusy(){return active.size>0||queue.length>0||workers.size>0||inFlight.size>0||pump!==undefined;},
  });
}

export function oauthSessionScope(sessionToken: string): string {
  return createHash('sha256').update(sessionToken, 'utf8').digest('hex');
}
