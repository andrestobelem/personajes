import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openJournal } from '../src/adapters/journal.ts';
import { CLAUDE_INFERENCE_PROFILE, DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { fingerprintInferenceProfile } from '../src/application/pi-access-check.ts';

const principalId = 'local-operator-access-test';
const accountFingerprint = 'a'.repeat(64);
function uuid(value: number) { return `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`; }
function accessResult(input: { profile?: typeof DEFAULT_INFERENCE_PROFILE | typeof CLAUDE_INFERENCE_PROFILE; kind?: 'passed' | 'failed' | 'ambiguous' | 'aborted' } = {}) {
  const profile = input.profile ?? DEFAULT_INFERENCE_PROFILE;
  const kind = input.kind ?? 'passed';
  const base = {
    provider: profile.provider,
    requestedProfile: profile,
    profileFingerprint: fingerprintInferenceProfile(profile),
    accountFingerprint,
  };
  if (kind === 'passed') return {
    ...base, kind,
    effectiveProfile: {
      provider: profile.provider, api: profile.api, model: profile.model,
      providerThinkingLevel: profile.reasoningEffort, reasoningEvidence: 'sdk-payload-and-response',
    },
    measuredUsage: { input: 91, output: 4, cacheRead: 12, cacheWrite: 1, totalTokens: 95, reasoning: 3 },
  };
  if (kind === 'failed') return { ...base, kind, code: 'PROVIDER_REJECTED' };
  if (kind === 'ambiguous') return { ...base, kind, code: 'TRANSPORT_UNCERTAIN' };
  return { ...base, kind, code: 'CANCELLED_BEFORE_DISPATCH' };
}

function start(journal: ReturnType<typeof openJournal>, key: number, profile = DEFAULT_INFERENCE_PROFILE) {
  const result = journal.createPiAccessJob({ principalId, idempotencyKey: uuid(key), profile });
  if (result.kind !== 'created') assert.fail(`No se creó el job: ${result.kind}`);
  return result.job;
}

function claim(journal: ReturnType<typeof openJournal>, jobId: string, owner = uuid(100), claimToken = uuid(101)) {
  const result = journal.claimPiAccessJob({ jobId, expectedRevision: 0, ownerToken: owner, claimToken });
  if (result.kind !== 'claimed') assert.fail(`No se reclamó el job: ${result.kind}`);
  return result;
}

function complete(input: {
  journal: ReturnType<typeof openJournal>;
  jobId: string;
  expectedRevision: number;
  lease: { ownerToken: string; claimToken: string };
  result?: ReturnType<typeof accessResult>;
  checkedAt?: string;
  expiresAt?: string;
}) {
  return input.journal.completePiAccessJob({
    jobId: input.jobId,
    expectedRevision: input.expectedRevision,
    lease: input.lease,
    result: input.result ?? accessResult(),
    checkedAt: input.checkedAt ?? '2026-10-14T10:00:00.000Z',
    expiresAt: input.expiresAt ?? '2026-10-14T12:00:00.000Z',
  });
}

test('v20 migra desde v19 sin crear corridas ni borrar operaciones existentes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-access-v20-'));
  const path = join(directory, 'journal.sqlite');
  let journal = openJournal({ path });
  try {
    const draft = journal.createRunConfigurationDraft({ principalId, idempotencyKey: uuid(1) });
    const oauth = journal.createPiOAuthJob({ principalId, idempotencyKey: uuid(2), kind: 'login' });
    assert.equal(draft.kind, 'created');
    assert.equal(oauth.kind, 'created');
    journal.close();
    const old = new DatabaseSync(path);
    try {
      old.exec(`DROP TABLE run_preflight_job_operations; DROP TABLE run_preflight_job_results; DROP TABLE run_preflight_job_history; DROP TABLE run_preflight_jobs;
        DROP TABLE pi_access_job_operations; DROP TABLE pi_access_job_results; DROP TABLE pi_access_job_history; DROP TABLE pi_access_jobs;
        DROP TABLE model_time_spans; DROP TABLE model_time_run_state;
        DROP TABLE IF EXISTS actor_activation_invitation_jobs; DROP TABLE IF EXISTS actor_activation_invitations; DROP TABLE IF EXISTS actor_activation_causes; DROP TABLE IF EXISTS routine_clock_advances;
        DROP TABLE IF EXISTS circumstance_operations;DROP TABLE IF EXISTS actor_state_cuts; DROP TABLE IF EXISTS actor_state_cut_batches; DROP TABLE IF EXISTS fork_projection_receipts; DROP TABLE IF EXISTS fork_job_history; DROP TABLE IF EXISTS fork_dramatic_seeds; DROP TABLE IF EXISTS fork_job_retries; DROP TABLE IF EXISTS fork_backup_sources; DROP TABLE IF EXISTS fork_jobs; DROP TABLE IF EXISTS run_configuration_revisions; DELETE FROM schema_version WHERE version IN(20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38);`);
    } finally { old.close(); }

    journal = openJournal({ path });
    assert.equal(journal.createPiOAuthJob({ principalId, idempotencyKey: uuid(2), kind: 'login' }).kind, 'existing');
    assert.equal(journal.createPiAccessJob({ principalId, idempotencyKey: uuid(1), profile: DEFAULT_INFERENCE_PROFILE }).kind, 'idempotencyConflict');
    const created = start(journal, 3);
    assert.equal(created.state, 'queued');
    const inspect = new DatabaseSync(path);
    try {
      assert.equal(inspect.prepare('SELECT MAX(version) version FROM schema_version').get()?.version, 38);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_runs').get()?.n, 0);
      assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { inspect.close(); }
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('claims serializan por proveedor; perfiles de proveedores distintos avanzan en paralelo', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-access-claims-'));
  const path = join(directory, 'journal.sqlite');
  const journal = openJournal({ path });
  const second = openJournal({ path });
  try {
    const codex = start(journal, 10);
    const codexAgain = start(journal, 11);
    const anthropic = start(journal, 12, CLAUDE_INFERENCE_PROFILE);
    const lease = { ownerToken: uuid(110), claimToken: uuid(111) };
    const claimed = journal.claimPiAccessJob({ jobId: codex.jobId, expectedRevision: 0, ...lease });
    assert.equal(claimed.kind, 'claimed');
    assert.equal(journal.claimPiAccessJob({ jobId: codex.jobId, expectedRevision: 0, ...lease }).kind, 'existing');
    assert.equal(second.claimPiAccessJob({ jobId: codex.jobId, expectedRevision: 1, ownerToken: uuid(112), claimToken: uuid(113) }).kind, 'busy');
    assert.equal(second.claimPiAccessJob({ jobId: codexAgain.jobId, expectedRevision: 0, ownerToken: uuid(114), claimToken: uuid(115) }).kind, 'busy');
    const otherProvider = second.claimPiAccessJob({ jobId: anthropic.jobId, expectedRevision: 0, ownerToken: uuid(116), claimToken: uuid(117) });
    assert.equal(otherProvider.kind, 'claimed');
    assert.equal(journal.claimPiAccessJob({ jobId: codex.jobId, expectedRevision: 1, ...lease }).kind, 'existing');
  } finally { second.close(); journal.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('sólo el SDK puede producir resultado passed; recibo queda ligado a las huellas exactas y expira', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-access-receipt-'));
  const path = join(directory, 'journal.sqlite');
  let journal = openJournal({ path });
  try {
    const job = start(journal, 20);
    const lease = { ownerToken: uuid(120), claimToken: uuid(121) };
    const running = claim(journal, job.jobId, lease.ownerToken, lease.claimToken);
    const checkedAt = '2026-10-14T10:00:00.000Z';
    const expiresAt = '2026-10-14T12:00:00.000Z';
    const result = accessResult();
    if (result.kind !== 'passed') assert.fail('La fixture debe producir un resultado aprobado.');
    const done = complete({ journal, jobId: job.jobId, expectedRevision: running.job.revision, lease, result, checkedAt, expiresAt });
    assert.equal(done.kind, 'updated');
    if (done.kind !== 'updated') assert.fail('No completó');
    assert.equal(done.job.state, 'succeeded');
    assert.equal(done.job.resultKind, 'passed');
    assert.deepEqual(done.job.passedResult, {
      effectiveProfile: result.effectiveProfile,
      measuredUsage: result.measuredUsage,
    });
    assert.doesNotMatch(JSON.stringify(done.job), new RegExp(accountFingerprint));
    assert.deepEqual(journal.readLatestAccessReceipt({
      provider: 'openai-codex',
      profileFingerprint: fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE),
      accountFingerprint,
    }), {
      kind: 'receipt', jobId: job.jobId, resultKind: 'passed', provider: 'openai-codex',
      profileFingerprint: fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE), accountFingerprint,
      checkedAt, expiresAt, code: null,
    });
    assert.deepEqual(journal.readLatestAccessReceipt({
      provider: 'openai-codex', profileFingerprint: 'b'.repeat(64), accountFingerprint,
    }), { kind: 'missing' });

    journal.close();
    journal = openJournal({ path });
    assert.deepEqual(journal.readPiAccessJob({ jobId: job.jobId }), done.job);
    assert.equal(journal.readPiAccessJobHistory({ jobId: job.jobId }).length, 3);
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('cancelación y recovery son durables; late success se registra y no se finge rollback', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-access-recovery-'));
  const path = join(directory, 'journal.sqlite');
  let journal = openJournal({ path });
  let second: ReturnType<typeof openJournal> | undefined;
  try {
    const runningJob = start(journal, 30);
    const lease = { ownerToken: uuid(130), claimToken: uuid(131) };
    const running = claim(journal, runningJob.jobId, lease.ownerToken, lease.claimToken);
    const cancelRequest = { principalId, idempotencyKey: uuid(31), jobId: runningJob.jobId, expectedRevision: running.job.revision };
    const requested = journal.cancelPiAccessJob(cancelRequest);
    assert.equal(requested.kind, 'updated');
    if (requested.kind !== 'updated') assert.fail('No registró cancelación');
    assert.equal(requested.job.state, 'cancel-requested');
    assert.equal(journal.cancelPiAccessJob(cancelRequest).kind, 'updated');
    const completion = {
      jobId: runningJob.jobId, expectedRevision: requested.job.revision, lease, result: accessResult(),
      checkedAt: '2026-10-14T10:00:00.000Z', expiresAt: '2026-10-14T12:00:00.000Z',
    };
    const lateSuccess = journal.completePiAccessJob(completion);
    assert.equal(lateSuccess.kind, 'updated');
    if (lateSuccess.kind !== 'updated') assert.fail('No registró resultado tardío');
    assert.equal(lateSuccess.job.state, 'succeeded');
    assert.equal(lateSuccess.job.resultKind, 'passed');

    second = openJournal({ path });
    const crossHandleReplay = second.completePiAccessJob(completion);
    assert.equal(crossHandleReplay.kind, 'existing');
    if (crossHandleReplay.kind !== 'existing') assert.fail('No reconoció completion exacto desde otro handle SQLite');
    assert.deepEqual(crossHandleReplay.job, lateSuccess.job);
    second.close(); second = undefined;
    journal.close(); journal = openJournal({ path });
    const afterRestartReplay = journal.completePiAccessJob(completion);
    assert.equal(afterRestartReplay.kind, 'existing');
    if (afterRestartReplay.kind !== 'existing') assert.fail('No recuperó receipt de completion tras reopen');
    assert.deepEqual(afterRestartReplay.job, lateSuccess.job);
    assert.equal(journal.completePiAccessJob({ ...completion, expectedRevision: completion.expectedRevision + 1 }).kind, 'terminal',
      'una revisión distinta no adopta el receipt original');
    assert.equal(journal.completePiAccessJob({ ...completion, lease: { ownerToken: uuid(132), claimToken: uuid(133) } }).kind, 'terminal',
      'otro lease no puede reutilizar el receipt');
    assert.equal(journal.completePiAccessJob({ ...completion, result: accessResult({ kind: 'failed' }) }).kind, 'terminal',
      'un callback con otro resultado no puede reemplazar ni reusar el receipt');
    const proof = new DatabaseSync(path);
    try {
      const row = proof.prepare('SELECT completion_revision,completion_lease_hash,completion_request_hash FROM pi_access_job_results WHERE job_id=?').get(runningJob.jobId);
      assert.equal(row?.completion_revision, completion.expectedRevision);
      assert.equal(String(row?.completion_lease_hash).length, 64);
      assert.equal(String(row?.completion_request_hash).length, 64);
      assert.doesNotMatch(JSON.stringify(proof.prepare('SELECT * FROM pi_access_job_results').all()), new RegExp(`${lease.ownerToken}|${lease.claimToken}`));
    } finally { proof.close(); }

    const queued = start(journal, 32);
    const queuedCancel = journal.cancelPiAccessJob({ principalId, idempotencyKey: uuid(33), jobId: queued.jobId, expectedRevision: 0 });
    assert.equal(queuedCancel.kind, 'updated');
    if (queuedCancel.kind !== 'updated') assert.fail('No canceló cola');
    assert.equal(queuedCancel.job.state, 'canceled');
    assert.equal(queuedCancel.job.safeCode, 'user-canceled');

    const abandoned = start(journal, 34);
    const abandonedRunning = start(journal, 35);
    const abandonedLease = { ownerToken: uuid(134), claimToken: uuid(135) };
    claim(journal, abandonedRunning.jobId, abandonedLease.ownerToken, abandonedLease.claimToken);
    assert.equal(journal.recoverAbandonedPiAccessJobs({ ownerToken: uuid(136) }), 2);
    assert.equal(journal.readPiAccessJob({ jobId: abandoned.jobId })?.state, 'interrupted');
    assert.equal(journal.readPiAccessJob({ jobId: abandonedRunning.jobId })?.state, 'interrupted');
    assert.equal(journal.claimPiAccessJob({ jobId: abandonedRunning.jobId, expectedRevision: 1, ownerToken: uuid(136), claimToken: uuid(137) }).kind, 'terminal');
    assert.equal(journal.recoverAbandonedPiAccessJobs({ ownerToken: uuid(136) }), 0);
  } finally { second?.close(); journal.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('recibo más reciente gana el empate de timestamp por orden de inserción durable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-access-receipt-order-'));
  const path = join(directory, 'journal.sqlite');
  const journal = openJournal({ path });
  try {
    const checkedAt = '2026-10-14T10:00:00.000Z';
    const expiresAt = '2026-10-14T12:00:00.000Z';
    const first = start(journal, 36);
    const firstClaim = claim(journal, first.jobId, uuid(136), uuid(137));
    const firstDone = journal.completePiAccessJob({ jobId: first.jobId, expectedRevision: firstClaim.job.revision,
      lease: firstClaim.lease, result: accessResult(), checkedAt, expiresAt });
    if (firstDone.kind !== 'updated') assert.fail('No completó primer sondeo');

    const second = start(journal, 37);
    const secondClaim = claim(journal, second.jobId, uuid(138), uuid(139));
    const secondDone = journal.completePiAccessJob({ jobId: second.jobId, expectedRevision: secondClaim.job.revision,
      lease: secondClaim.lease, result: accessResult({ kind: 'failed' }), checkedAt, expiresAt });
    if (secondDone.kind !== 'updated') assert.fail('No completó segundo sondeo');
    const receipt = journal.readLatestAccessReceipt({ provider: 'openai-codex',
      profileFingerprint: fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE), accountFingerprint });
    assert.equal(receipt.kind, 'receipt');
    if (receipt.kind !== 'receipt') assert.fail('Falta recibo');
    assert.equal(receipt.jobId, second.jobId);
    assert.equal(receipt.resultKind, 'failed');
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('el último outcome durable incluye aborted y ambiguous y revoca una lectura basada sólo en receipts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-access-latest-outcome-'));
  const path = join(directory, 'journal.sqlite');
  let journal = openJournal({ path });
  try {
    const checkedAt = '2026-10-14T10:00:00.000Z';
    const expiresAt = '2026-10-14T12:00:00.000Z';
    const lookup = { provider: 'openai-codex' as const, profileFingerprint: fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE) };

    const passed = start(journal, 38);
    const passedClaim = claim(journal, passed.jobId, uuid(150), uuid(151));
    const passedDone = complete({ journal, jobId: passed.jobId, expectedRevision: passedClaim.job.revision,
      lease: passedClaim.lease, result: accessResult(), checkedAt, expiresAt });
    if (passedDone.kind !== 'updated') assert.fail('No completó passed');
    assert.equal(journal.readLatestAccessOutcome(lookup)?.jobId, passed.jobId);

    const aborted = start(journal, 39);
    const abortedClaim = claim(journal, aborted.jobId, uuid(152), uuid(153));
    const abortedDone = complete({ journal, jobId: aborted.jobId, expectedRevision: abortedClaim.job.revision,
      lease: abortedClaim.lease, result: accessResult({ kind: 'aborted' }), checkedAt, expiresAt });
    if (abortedDone.kind !== 'updated') assert.fail('No completó aborted');
    assert.equal(journal.readLatestAccessOutcome(lookup)?.jobId, aborted.jobId);
    assert.equal(journal.readLatestAccessOutcome(lookup)?.resultKind, 'aborted');
    assert.doesNotMatch(JSON.stringify(journal.readLatestAccessOutcome(lookup)), new RegExp(accountFingerprint));

    const ambiguous = start(journal, 40);
    const ambiguousClaim = claim(journal, ambiguous.jobId, uuid(154), uuid(155));
    const ambiguousDone = complete({ journal, jobId: ambiguous.jobId, expectedRevision: ambiguousClaim.job.revision,
      lease: ambiguousClaim.lease, result: accessResult({ kind: 'ambiguous' }), checkedAt, expiresAt });
    if (ambiguousDone.kind !== 'updated') assert.fail('No completó ambiguous');
    assert.equal(journal.readLatestAccessOutcome(lookup)?.jobId, ambiguous.jobId);
    assert.equal(journal.readLatestAccessOutcome(lookup)?.resultKind, 'ambiguous');

    journal.close();
    journal = openJournal({ path });
    assert.equal(journal.readLatestAccessOutcome(lookup)?.jobId, ambiguous.jobId);
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('start y cancel comparten namespace idempotente con drafts y OAuth y no guardan errores crudos', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-access-idempotency-'));
  const path = join(directory, 'journal.sqlite');
  const journal = openJournal({ path });
  try {
    const oauth = journal.createPiOAuthJob({ principalId, idempotencyKey: uuid(40), kind: 'login' });
    assert.equal(oauth.kind, 'created');
    assert.equal(journal.createPiAccessJob({ principalId, idempotencyKey: uuid(40), profile: DEFAULT_INFERENCE_PROFILE }).kind, 'idempotencyConflict');
    assert.equal(journal.createRunConfigurationDraft({ principalId, idempotencyKey: uuid(40) }).kind, 'idempotencyConflict');

    const job = start(journal, 41);
    const unsafe = { ...accessResult(), rawError: 'PRIVATE_PROVIDER_ERROR', prompt: 'Reply with OK.', accessToken: 'PRIVATE_CREDENTIAL' };
    const lease = { ownerToken: uuid(141), claimToken: uuid(142) };
    const running = claim(journal, job.jobId, lease.ownerToken, lease.claimToken);
    assert.throws(() => complete({ journal, jobId: job.jobId, expectedRevision: running.job.revision, lease, result: unsafe }));
    const failed = complete({ journal, jobId: job.jobId, expectedRevision: running.job.revision, lease, result: accessResult({ kind: 'failed' }) });
    assert.equal(failed.kind, 'updated');
    if (failed.kind !== 'updated') assert.fail('No completó el resultado fallido sintético');
    assert.equal(failed.job.state, 'failed');
    assert.equal(failed.job.safeCode, 'provider-rejected');
    assert.equal(journal.cancelPiAccessJob({ principalId, idempotencyKey: uuid(42), jobId: job.jobId, expectedRevision: failed.job.revision }).kind, 'terminal');

    const inspect = new DatabaseSync(path);
    try {
      const tables = ['pi_access_jobs', 'pi_access_job_history', 'pi_access_job_results', 'pi_access_job_operations'];
      for (const table of tables) assert.doesNotMatch(JSON.stringify(inspect.prepare(`SELECT * FROM ${table}`).all()), /PRIVATE_PROVIDER_ERROR|PRIVATE_CREDENTIAL|Reply with OK/);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM request_reservations').get()?.n, 0);
      assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { inspect.close(); }
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});
