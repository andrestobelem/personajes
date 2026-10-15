import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { openJournal } from '../adapters/journal.ts';
import {
  RunPreflightCheckSummarySchema, RunPreflightJobClaimResultSchema, RunPreflightJobDocumentSchema,
  RunPreflightJobInputResultSchema, RunPreflightJobLeaseSchema, RunPreflightJobMutationResultSchema,
  RunPreflightJobStartResultSchema, RunPreflightJobViewSchema, RunPreflightPrivateEvidenceSchema,
  RunPreflightResultSchema, projectPublicRunPreflightResult,
} from '../domain/run-preflight-jobs.ts';
import { RunPreflightJobPageSchema } from '../domain/http.ts';
import { JobIdSchema, RunIdSchema } from '../domain/values.ts';
import { createProductionPreflightPort, ReadyRunConfigurationSchema, type PreflightReport } from './production-preflight.ts';
import type { createProductionPreflightHost } from './production-preflight-host.ts';
import type { createPiAuthFingerprint } from './pi-auth-fingerprint.ts';

type Journal = Pick<ReturnType<typeof openJournal>, 'createRunPreflightJob' | 'readRunPreflightJob' | 'listRunPreflightJobs'
  | 'claimRunPreflightJob' | 'readRunPreflightJobInput' | 'completeRunPreflightJob' | 'failRunPreflightJob'
  | 'cancelRunPreflightJob' | 'recoverAbandonedRunPreflightJobs' | 'readRunPreflightJobEvidence'>;
type Job = z.infer<typeof RunPreflightJobViewSchema>;
type Lease = z.infer<typeof RunPreflightJobLeaseSchema>;
type Host = ReturnType<typeof createProductionPreflightHost>;
type Active = { controller: AbortController; revision: number; lease?: Lease };
const ReadResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('found'), job: RunPreflightJobDocumentSchema.shape.job, report: RunPreflightJobDocumentSchema.shape.report }),
  z.strictObject({ kind: z.literal('missing') }),
]);
const PrivateEvidenceReadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('found'), evidence: RunPreflightPrivateEvidenceSchema }),
  z.strictObject({ kind: z.literal('missing') }),
]);
const JournalLookupSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('found'), document: RunPreflightJobDocumentSchema }),
  z.strictObject({ kind: z.literal('missing') }),
]);
/** This projection is not an evaluator: implicit positives require its already validated passed result. */
export function projectRunPreflightReport(report: PreflightReport, checkedAt: string) {
  const summaries = new Map<string, z.infer<typeof RunPreflightCheckSummarySchema>>();
  const severity = { passed: 0, deferred: 1, blocked: 2, unavailable: 3 };
  for (const check of report.checks) {
    const checkId = check.checkId.startsWith('availability-') ? 'participant-availability' : check.checkId;
    const summary = RunPreflightCheckSummarySchema.parse({ kind: check.kind, checkId,
      ...('code' in check ? { code: check.code } : {}) });
    const previous = summaries.get(checkId);
    if (previous === undefined || severity[summary.kind] > severity[previous.kind]) summaries.set(checkId, summary);
  }
  if (report.kind === 'passed') {
    for (const checkId of ['configuration', 'inference-profile', 'participant-availability']) {
      if (!summaries.has(checkId)) summaries.set(checkId, RunPreflightCheckSummarySchema.parse({ kind: 'passed', checkId }));
    }
  }
  return projectPublicRunPreflightResult(RunPreflightResultSchema.parse({ kind: report.kind, checkedAt, checks: [...summaries.values()] }));
}

/** Durable administrative checks. Construction, reads and recovery never start evaluation. */
export async function createRunPreflightJobs(input: {
  journal: Journal;
  ownerToken: string;
  createHost(): Host | Promise<Host>;
  readCredentialFingerprint: ReturnType<typeof createPiAuthFingerprint>['readCredentialFingerprint'];
  principalId?: string;
  signal?: AbortSignal;
  onDiagnostic?: (diagnostic: { kind: 'preflightEvaluationFailed'; issues: Array<{ code: string; path: string }> }) => void;
}) {
  const ownerToken = z.string().uuid().parse(input.ownerToken);
  const principalId = z.string().trim().min(1).max(200).parse(input.principalId ?? 'local-operator');
  const queue: Job[] = []; const queuedIds = new Set<string>(); const active = new Map<string, Active>();
  const inFlight = new Set<Promise<unknown>>(); let pump: Promise<void> | undefined; let closing: Promise<void> | undefined; let closed = false;
  input.journal.recoverAbandonedRunPreflightJobs({ ownerToken });
  function track<T>(operation: () => Promise<T>): Promise<T> {
    const result = Promise.resolve().then(operation); inFlight.add(result);
    void result.then(() => undefined, () => undefined).finally(() => inFlight.delete(result)); return result;
  }
  async function run(job: Job) {
    const task: Active = { controller: new AbortController(), revision: job.revision }; active.set(job.jobId, task);
    try {
      const claim = RunPreflightJobClaimResultSchema.parse(input.journal.claimRunPreflightJob({ runId: job.runId, jobId: job.jobId,
        expectedRevision: task.revision, ownerToken, claimToken: randomUUID() }));
      if (claim.kind !== 'claimed') return;
      task.lease = claim.lease; task.revision = claim.job.revision;
      const frozen = RunPreflightJobInputResultSchema.parse(input.journal.readRunPreflightJobInput({ runId: job.runId, jobId: job.jobId, lease: task.lease }));
      if (frozen.kind !== 'found') throw new Error('Frozen input unavailable');
      const signal = input.signal === undefined ? task.controller.signal : AbortSignal.any([task.controller.signal, input.signal]);
      if (signal.aborted) throw new Error('Preflight canceled');
      const configuration = ReadyRunConfigurationSchema.parse(frozen.configuration);
      const host = await input.createHost();
      if (signal.aborted) throw new Error('Preflight canceled');
      const checkedAt = new Date().toISOString();
      const report = await createProductionPreflightPort({ host }).preflight({ configuration, observedAt: checkedAt });
      const evidence = RunPreflightPrivateEvidenceSchema.parse(host.readPrivateEvidence({ configuration }));
      if (signal.aborted) throw new Error('Preflight canceled');
      const evaluation = { fence: frozen.fence, result: projectRunPreflightReport(report, checkedAt), evidence };
      let completed = RunPreflightJobMutationResultSchema.parse(input.journal.completeRunPreflightJob({ runId: job.runId, jobId: job.jobId,
        expectedRevision: task.revision, lease: task.lease, evaluation }));
      if (completed.kind === 'stale' && completed.job.state === 'cancel-requested') {
        task.revision = completed.job.revision;
        completed = RunPreflightJobMutationResultSchema.parse(input.journal.completeRunPreflightJob({ runId: job.runId, jobId: job.jobId,
          expectedRevision: task.revision, lease: task.lease, evaluation }));
      }
      if (!['updated', 'existing', 'terminal'].includes(completed.kind)) throw new Error('Preflight completion unavailable');
    } catch (error: unknown) {
      try { input.onDiagnostic?.({ kind: 'preflightEvaluationFailed', issues: error instanceof z.ZodError
        ? error.issues.map(issue => ({ code: issue.code, path: issue.path.map(String).join('.') })) : [] }); } catch { /* Diagnostics do not change the durable result. */ }
      if (task.lease !== undefined) {
        try { input.journal.failRunPreflightJob({ runId: job.runId, jobId: job.jobId, expectedRevision: task.revision, lease: task.lease, safeCode: 'evaluation-failed' }); }
        catch { /* Lost lease or committed result stays authoritative; no proof is overwritten. */ }
      }
    } finally { active.delete(job.jobId); queuedIds.delete(job.jobId); }
  }
  async function drain() { while (!closed && queue.length > 0) { const next = queue.shift(); if (next !== undefined) await run(next); } }
  function enqueue(job: Job) {
    if (closed || job.state !== 'queued' || queuedIds.has(job.jobId)) return;
    queue.push(job); queuedIds.add(job.jobId);
    if (pump === undefined) { const task = drain(); pump = task;
      void task.catch(() => undefined).finally(() => { if (pump === task) pump = undefined;
        if (!closed && queue.length > 0) { const next = queue.shift(); if (next !== undefined) { queuedIds.delete(next.jobId); enqueue(next); } } }); }
  }
  async function readDocument(scope: { runId: string; jobId: string }) {
    const value = JournalLookupSchema.parse(input.journal.readRunPreflightJob(scope));
    if (value.kind === 'missing') return ReadResultSchema.parse({ kind: 'missing' });
    const document = value.document;
    const evidenceValue = PrivateEvidenceReadSchema.parse(input.journal.readRunPreflightJobEvidence(scope));
    if (document.report.result !== null && evidenceValue.kind === 'missing') throw new Error('Preflight evidence unavailable');
    if (document.report.result !== null && evidenceValue.kind === 'found') {
      const evidence = evidenceValue.evidence;
      if (evidence.provider !== null) {
        let current: string | undefined;
        try { current = await input.readCredentialFingerprint({ provider: evidence.provider }); } catch { current = undefined; }
        if (current !== (evidence.accountFingerprint ?? undefined)) document.report.kind = 'stale';
      }
    }
    return ReadResultSchema.parse({ kind: 'found', job: document.job, report: document.report });
  }
  async function close(): Promise<void> {
    if (closing !== undefined) return closing;
    closed = true; queue.length = 0; for (const task of active.values()) task.controller.abort();
    closing = (async () => { while (inFlight.size > 0 || pump !== undefined) await Promise.allSettled([...inFlight, ...(pump === undefined ? [] : [pump])]);
      input.signal?.removeEventListener('abort', onAbort); })(); return closing;
  }
  function onAbort() { void close(); } input.signal?.addEventListener('abort', onAbort, { once: true });
  if (input.signal?.aborted) await close();
  return Object.freeze({
    start(value: { runId: string; expectedConfigurationRevision: number; expectedWorldRevision: number; idempotencyKey: string }) {
      return track(async () => { if (closed) throw new Error('Preflight broker is closed');
        const result = RunPreflightJobStartResultSchema.parse(input.journal.createRunPreflightJob({ ...value, principalId }));
        if (result.kind === 'created' || result.kind === 'existing') {
          const latest = JournalLookupSchema.parse(input.journal.readRunPreflightJob({ runId: result.job.runId, jobId: result.job.jobId }));
          if (latest.kind === 'found') enqueue(latest.document.job);
        } return result;
      });
    },
    readJob(value: { runId: string; jobId: string }) { return track(() => readDocument({ runId: RunIdSchema.parse(value.runId), jobId: JobIdSchema.parse(value.jobId) })); },
    /** Lifecycle admission consumes a document, rather than the HTTP lookup envelope. */
    readLifecycleDocument(value: { runId: string; jobId: string }) { return track(async () => {
      const result = await readDocument({ runId: RunIdSchema.parse(value.runId), jobId: JobIdSchema.parse(value.jobId) });
      return result.kind === 'missing' ? undefined : RunPreflightJobDocumentSchema.parse({
        kind: 'run-preflight-job-document', job: result.job, report: result.report,
      });
    }); },
    listJobs(value: { runId: string; offset: number; limit: number }) { return track(async () => {
      const runId = RunIdSchema.parse(value.runId); const offset = z.number().int().min(0).max(1_000).parse(value.offset);
      const limit = z.number().int().min(1).max(100).parse(value.limit);
      const page = input.journal.listRunPreflightJobs({ runId, offset, limit });
      const items = [];
      for (const stored of page.items) { const current = await readDocument({ runId, jobId: stored.job.jobId });
        if (current.kind === 'found') items.push({ kind: 'run-preflight-job-document', job: current.job, report: current.report }); }
      const next = offset + items.length;
      return RunPreflightJobPageSchema.parse({ kind: 'run-preflight-job-page', items, nextCursor: page.truncated && next < 1_000 ? `p1.${Buffer.from(String(next)).toString('base64url')}` : null, truncated: page.truncated && next >= 1_000 });
    }); },
    cancelJob(value: { runId: string; jobId: string; expectedRevision: number; idempotencyKey: string }) { return track(async () => {
      if (closed) throw new Error('Preflight broker is closed');
      const result = RunPreflightJobMutationResultSchema.parse(input.journal.cancelRunPreflightJob({ ...value, principalId }));
      if ((result.kind === 'updated' || result.kind === 'existing') && result.job.state === 'cancel-requested') {
        const task = active.get(result.job.jobId); if (task !== undefined) { task.revision = result.job.revision; task.controller.abort(); }
      } return result;
    }); }, close,
    get backupBusy(){return active.size>0||queue.length>0||inFlight.size>0||pump!==undefined;},
  });
}
