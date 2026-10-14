import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createPiAccessCheck, fingerprintInferenceProfile } from './pi-access-check.ts';
import {
  PiAccessJobCreateResultSchema, PiAccessJobClaimResultSchema, PiAccessJobMutationResultSchema,
  PiAccessJobViewSchema, PiAccessCheckStoredResultSchema, PiAccessJobCancelSchema, PiAccessReceiptReadSchema,
} from '../domain/pi-access-jobs.ts';
import { PiAccessJobPageSchema } from '../domain/http.ts';
import { SelectableInferenceProfileSchema, type SelectableInferenceProfile } from '../domain/inference-profile.ts';
import { JobIdSchema } from '../domain/values.ts';

type Journal = { createPiAccessJob(input: unknown): unknown; readPiAccessJob(input: unknown): unknown; listPiAccessJobs(input: unknown): unknown; claimPiAccessJob(input: unknown): unknown; completePiAccessJob(input: unknown): unknown; cancelPiAccessJob(input: unknown): unknown; recoverAbandonedPiAccessJobs(input: unknown): unknown; readLatestAccessReceipt(input: unknown): unknown };
type Job = z.infer<typeof PiAccessJobViewSchema>;
type Active = { controller: AbortController; revision: number; lease?: { ownerToken: string; claimToken: string } };
/** Explicit durable access probes only. Construction recovers abandoned metadata without model calls. */
export async function createPiAccessJobs(input: {
  journal: Journal;
  modelRuntime: Parameters<typeof createPiAccessCheck>[0]['modelRuntime'];
  readCredentialFingerprint: Parameters<typeof createPiAccessCheck>[0]['readCredentialFingerprint'];
  ownerToken: string;
  signal?: AbortSignal;
  principalId?: string;
  timeoutMs?: number;
  receiptTtlMs?: number;
}) {
  const ownerToken = z.string().uuid().parse(input.ownerToken);
  const principalId = z.string().trim().min(1).max(200).parse(input.principalId ?? 'local-operator');
  const receiptTtlMs = z.number().int().min(1).max(86_400_000).parse(input.receiptTtlMs ?? 900_000);
  const ports = new Map<string, ReturnType<typeof createPiAccessCheck>>();
  const queue: Job[] = [];
  const queuedIds = new Set<string>();
  const active = new Map<string, Active>();
  const inFlight = new Set<Promise<unknown>>();
  let closed = false;
  let pump: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  await input.journal.recoverAbandonedPiAccessJobs({ ownerToken });
  function port(profile: SelectableInferenceProfile) {
    let value = ports.get(profile.provider);
    if (value === undefined) {
      value = createPiAccessCheck({ modelRuntime: input.modelRuntime, profile, readCredentialFingerprint: input.readCredentialFingerprint, ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }) });
      ports.set(profile.provider, value);
    }
    return value;
  }
  function track<T>(operation: () => Promise<T>): Promise<T> {
    const result = Promise.resolve().then(operation); inFlight.add(result);
    void result.then(() => undefined, () => undefined).finally(() => inFlight.delete(result)); return result;
  }
  async function finish(job: Job, task: Active, result: z.infer<typeof PiAccessCheckStoredResultSchema>) {
    if (task.lease === undefined) return;
    const checkedAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(checkedAt) + receiptTtlMs).toISOString();
    let completed = PiAccessJobMutationResultSchema.parse(await input.journal.completePiAccessJob({ jobId: job.jobId, expectedRevision: task.revision, lease: task.lease, result, checkedAt, expiresAt }));
    if (completed.kind === 'stale' && completed.job.state === 'cancel-requested') {
      task.revision = completed.job.revision;
      completed = PiAccessJobMutationResultSchema.parse(await input.journal.completePiAccessJob({ jobId: job.jobId, expectedRevision: task.revision, lease: task.lease, result, checkedAt, expiresAt }));
    }
    if (!['updated', 'existing', 'terminal'].includes(completed.kind)) throw new Error('Access result could not be durably recorded.');
  }
  async function run(job: Job) {
    const task: Active = { controller: new AbortController(), revision: job.revision };
    active.set(job.jobId, task);
    const access = port(job.profile);
    try {
      const claim = PiAccessJobClaimResultSchema.parse(await input.journal.claimPiAccessJob({ jobId: job.jobId, expectedRevision: job.revision, ownerToken, claimToken: randomUUID() }));
      if (claim.kind !== 'claimed') return;
      task.revision = claim.job.revision; task.lease = claim.lease;
      const signal = input.signal === undefined ? task.controller.signal : AbortSignal.any([task.controller.signal, input.signal]);
      const value = await access.execute({ signal });
      const stored = value.kind === 'passed' ? (() => { const { usage, ...rest } = value; return { ...rest, measuredUsage: usage }; })() : value;
      const result = PiAccessCheckStoredResultSchema.parse(stored);
      await finish(job, task, result);
    } catch {
      // No SDK errors/tokens enter journal. If a ledger write failed, leave its lease for host recovery.
      if (task.lease !== undefined) {
        const failure = PiAccessCheckStoredResultSchema.parse({ kind: 'failed', provider: job.provider, requestedProfile: job.profile, profileFingerprint: fingerprintInferenceProfile(job.profile), accountFingerprint: null, code: 'LOCAL_FAILURE' });
        try { await finish(job, task, failure); } catch { /* Prior result or uncertain ledger write remains authoritative. */ }
      }
    } finally {
      // execute() may return ambiguous before a transport ignoring Abort actually settles.
      // This wait owns provider exclusion and host lifetime; no late result is adopted.
      await access.whenSettled(); active.delete(job.jobId); queuedIds.delete(job.jobId);
    }
  }
  async function drain() { while (!closed && queue.length > 0) { const job = queue.shift(); if (job) await run(job); } }
  function enqueue(job: Job) {
    if (closed || job.state !== 'queued' || queuedIds.has(job.jobId)) return;
    queue.push(job); queuedIds.add(job.jobId);
    if (pump === undefined) {
      const task = drain(); pump = task;
      void task.catch(() => undefined).finally(() => { if (pump === task) pump = undefined; if (!closed && queue.length > 0) { const next = queue.shift(); if (next) { queuedIds.delete(next.jobId); enqueue(next); } } });
    }
  }
  async function close(): Promise<void> {
    if (closing !== undefined) return closing;
    closed = true; queue.length = 0;
    for (const task of active.values()) task.controller.abort();
    closing = (async () => {
      while (inFlight.size > 0 || pump !== undefined) await Promise.allSettled([...inFlight, ...(pump === undefined ? [] : [pump])]);
      await Promise.all([...ports.values()].map((access) => access.close()));
      input.signal?.removeEventListener('abort', onHostAbort);
    })();
    return closing;
  }
  function onHostAbort() { void close(); }
  input.signal?.addEventListener('abort', onHostAbort, { once: true });
  if (input.signal?.aborted) await close();
  return Object.freeze({
    start(value: { profile: SelectableInferenceProfile; idempotencyKey: string }) {
      return track(async () => {
        if (closed) throw new Error('Access broker is closed.');
        const profile = SelectableInferenceProfileSchema.parse(value.profile);
        const key = z.string().uuid().parse(value.idempotencyKey);
        const result = PiAccessJobCreateResultSchema.parse(await input.journal.createPiAccessJob({ principalId, idempotencyKey: key, profile }));
        if (result.kind === 'created' || result.kind === 'existing') {
          const latest = await input.journal.readPiAccessJob({ jobId: result.job.jobId });
          if (latest !== undefined) enqueue(PiAccessJobViewSchema.parse(latest));
        }
        return result;
      });
    },
    readJob(value: { jobId: string }) { return track(async () => { const jobId = JobIdSchema.parse(value.jobId); const result = await input.journal.readPiAccessJob({ jobId }); return result === undefined ? { kind: 'missing' } as const : { kind: 'found' as const, job: PiAccessJobViewSchema.parse(result) }; }); },
    listJobs(value: { offset: number; limit: number }) { return track(async () => {
      const offset = z.number().int().min(0).max(1_000).parse(value.offset); const limit = z.number().int().min(1).max(100).parse(value.limit);
      const jobs = z.array(PiAccessJobViewSchema).max(1_000).parse(await input.journal.listPiAccessJobs({ principalId, limit: 1_000 }));
      const items = jobs.slice(offset, offset + limit); const next = offset + items.length;
      return PiAccessJobPageSchema.parse({ kind: 'pi-access-job-page', items, nextCursor: next < jobs.length ? `p1.${Buffer.from(String(next)).toString('base64url')}` : null, truncated: jobs.length === 1_000 });
    }); },
    cancelJob(value: { jobId: string; expectedRevision: number; idempotencyKey: string }) { return track(async () => {
      if (closed) throw new Error('Access broker is closed.');
      const request = PiAccessJobCancelSchema.parse({ ...value, principalId });
      const result = PiAccessJobMutationResultSchema.parse(await input.journal.cancelPiAccessJob(request));
      if (result.kind === 'updated' || result.kind === 'existing') {
        const task = active.get(result.job.jobId);
        if (task !== undefined && result.job.state === 'cancel-requested') { task.revision = result.job.revision; task.controller.abort(); }
      }
      return result;
    }); },
    readPiAccessStatus(value: { profile: SelectableInferenceProfile }) { return track(async () => {
      const profile = SelectableInferenceProfileSchema.parse(value.profile);
      const profileFingerprint = fingerprintInferenceProfile(profile);
      const jobs = z.array(PiAccessJobViewSchema).parse(await input.journal.listPiAccessJobs({ principalId, limit: 1_000 }));
      const history = jobs.filter((job) => fingerprintInferenceProfile(job.profile) === profileFingerprint && job.resultKind !== null);
      const latest = [...history].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
      const accountFingerprint = await input.readCredentialFingerprint({ provider: profile.provider, signal: input.signal ?? new AbortController().signal });
      const receipt = accountFingerprint === undefined ? { kind: 'missing' as const } : PiAccessReceiptReadSchema.parse(await input.journal.readLatestAccessReceipt({ provider: profile.provider, profileFingerprint, accountFingerprint }));
      const noEvidence = { accessCheck: latest === undefined && jobs.length < 1_000 ? 'notRun' as const : 'stale' as const, effectiveProfile: null, safeCode: null };
      if (receipt.kind === 'missing') return noEvidence;
      if (Date.parse(receipt.expiresAt) <= Date.now() || Date.parse(receipt.checkedAt) > Date.now()) return { accessCheck: 'stale' as const, effectiveProfile: null, safeCode: null };
      const matchedRaw = await input.journal.readPiAccessJob({ jobId: receipt.jobId });
      if (matchedRaw === undefined) return { accessCheck: 'stale' as const, effectiveProfile: null, safeCode: null };
      const matched = PiAccessJobViewSchema.parse(matchedRaw);
      if (matched.provider !== profile.provider || fingerprintInferenceProfile(matched.profile) !== profileFingerprint || matched.resultKind !== receipt.resultKind) return { accessCheck: 'stale' as const, effectiveProfile: null, safeCode: null };
      // Equal wall-clock timestamps cannot prove which different terminal came last.
      // Fail closed rather than borrow a successful receipt across that uncertainty.
      const competitors = history.filter((job) => job.jobId !== receipt.jobId && Date.parse(job.updatedAt) >= Date.parse(receipt.checkedAt));
      const failure = competitors.find((job) => job.resultKind === 'failed' || job.resultKind === 'ambiguous');
      if (failure !== undefined) return { accessCheck: 'failed' as const, effectiveProfile: null, safeCode: failure.safeCode };
      if (competitors.length > 0) return { accessCheck: 'stale' as const, effectiveProfile: null, safeCode: null };
      if (receipt.resultKind === 'passed' && matched.passedResult !== null) return { accessCheck: 'passed' as const, effectiveProfile: matched.passedResult.effectiveProfile, safeCode: null };
      return { accessCheck: 'failed' as const, effectiveProfile: null, safeCode: matched.safeCode };

    }); },
    close,
    get isClosed() { return closed; },
  });
}
