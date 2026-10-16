import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openJournal } from '../src/adapters/journal.ts';
import { PiRuntime } from '../src/adapters/pi.ts';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { createProductionPreflightHost } from '../src/application/production-preflight-host.ts';
import { createPiAuthFingerprint } from '../src/application/pi-auth-fingerprint.ts';
import { createRunPreflightJobs, projectRunPreflightReport } from '../src/application/run-preflight-jobs.ts';
import { ReadyRunConfigurationSchema,validateRunConfiguration, type PreflightReport } from '../src/application/production-preflight.ts';
import {RunPreflightResultSchema} from '../src/domain/run-preflight-jobs.ts';
import {createIcmWorkspaceSnapshot,hashIcmMarkdown} from '../src/domain/icm-workspace.ts';
import { draftFixture, canonical } from './fixtures/continuista.ts';
import { DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { fingerprintInferenceProfile } from '../src/application/pi-access-check.ts';

async function fixture(t: TestContext, unlimited = false,withIcm=false) {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-preflight-broker-')); const path = join(directory, 'journal.sqlite');
  const journal = openJournal({ path }); const draft = draftFixture();
  if (unlimited && draft.budget.kind !== 'empty') { draft.budget.value.maxPiCallsPerRun = null; draft.budget.value.maxPiCallsPerPulse = null; }
  const result = validateRunConfiguration({ draft });
  assert.ok(result.kind === 'ready');
  const audiences=[...result.configuration.roster.activeCharacterIds.map(actorId=>({role:'actor' as const,actorId})),...(['continuista','director','configurator'] as const).map(role=>({role}))];
  const configuration = ReadyRunConfigurationSchema.parse({...result.configuration,...(withIcm?{icmWorkspace:createIcmWorkspaceSnapshot({sources:audiences.map(audience=>({sourceId:`synthetic.${audience.role}`,audience,revision:0,sourceHash:hashIcmMarkdown(audience.role),sections:[{sectionId:'process',markdown:'Contrato sintético para probar el broker, sin inferencia.'}]}))})}:{})});
  journal.registerWorldRun({ initialSnapshot: configuration.worldSnapshot, configurationRevision: configuration.configRevision, configuration, lifecycle: 'ready',
    continuityFence: { kind: 'prepared-contexts', atWorldSeq: configuration.worldSnapshot.seq, contexts: configuration.roster.preparedCharacters.map((actor) => ({ actorId: actor.characterId,
      continuityId: actor.continuity.continuityId, continuityRevision: actor.continuity.revision, continuityContentHash: actor.continuity.contentHash,
      preparedContextHash: createHash('sha256').update(canonical(actor)).digest('hex'), identityVersion: actor.identityVersion })) } });
  const runtime = await PiRuntime.create({ privateDataRoot: directory });
  const authentication = createPiAuthFingerprint({ privateDataRoot: directory, environment: {} });
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  const createHost = () => createProductionPreflightHost({ journal, catalog, piRuntime: runtime, authentication });
  const scopes = { runId: configuration.runId, expectedConfigurationRevision: configuration.configRevision, expectedWorldRevision: configuration.worldSnapshot.revision };
  t.after(() => { journal.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, path, journal, configuration, runtime, authentication, catalog, createHost, scopes };
}
async function until(check: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 200; attempt += 1) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 1)); }
  throw new Error('Preflight did not settle');
}

test('broker evalúa host real una vez por job, guarda bloqueo durable y no crea sesiones/requests/hechos', async (t) => {
  const f = await fixture(t); let hosts = 0;
  const broker = await createRunPreflightJobs({ journal: f.journal, ownerToken: randomUUID(), createHost() { hosts += 1; return f.createHost(); }, readCredentialFingerprint: f.authentication.readCredentialFingerprint });
  const beforeWorld = f.journal.loadWorld({ runId: f.scopes.runId }); const beforeConfiguration = f.journal.readWorldConfiguration({ runId: f.scopes.runId });
  const key = randomUUID(); const started = await broker.start({ ...f.scopes, idempotencyKey: key }); assert.ok(started.kind === 'created');
  await until(async () => { const read = await broker.readJob({ runId: f.scopes.runId, jobId: started.job.jobId }); return read.kind === 'found' && read.job.state === 'completed'; });
  const read = await broker.readJob({ runId: f.scopes.runId, jobId: started.job.jobId }); assert.ok(read.kind === 'found');
  assert.equal(read.report.result?.kind, 'blocked'); assert.equal(read.report.kind, 'current');
  assert.ok(read.report.result?.checks.some((check) => check.checkId === 'budget' && check.kind === 'passed'));
  assert.ok(read.report.result?.checks.some((check) => check.checkId === 'pi-runtime' && check.kind === 'unavailable'));
  assert.doesNotMatch(JSON.stringify(read), /Fingerprint|configurationHash|sessionPath|detail|PRIVATE|refresh|access_token/);
  assert.deepEqual(await broker.start({ ...f.scopes, idempotencyKey: key }), { kind: 'existing', job: started.job });
  assert.equal(hosts, 1);
  const second = await broker.start({ ...f.scopes, idempotencyKey: randomUUID() }); assert.ok(second.kind === 'created');
  await until(async () => { const read = await broker.readJob({ runId: f.scopes.runId, jobId: second.job.jobId }); return read.kind === 'found' && read.job.state === 'completed'; });
  assert.equal(hosts, 2, 'Every job owns fresh captured evidence');
  const page = await broker.listJobs({ runId: f.scopes.runId, offset: 0, limit: 1 }); assert.equal(page.items.length, 1); assert.ok(page.nextCursor);
  assert.equal((await broker.listJobs({ runId: f.scopes.runId, offset: 1, limit: 1 })).items.length, 1);
  assert.deepEqual(await broker.readJob({ runId: randomUUID(), jobId: started.job.jobId }), { kind: 'missing' });
  assert.deepEqual(f.journal.loadWorld({ runId: f.scopes.runId }), beforeWorld); assert.deepEqual(f.journal.readWorldConfiguration({ runId: f.scopes.runId }), beforeConfiguration);
  const db = new DatabaseSync(f.path);
  for (const table of ['world_events', 'request_reservations', 'actor_pi_sessions', 'continuista_sessions']) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count, 0);
  db.close(); await broker.close();
});

test('GET/list compara credencial actual con evidencia original sin reescribir proof ni evaluar otra vez', async (t) => {
  const f = await fixture(t); let hosts = 0;
  writeFileSync(join(f.directory, 'pi', 'auth', 'auth.json'), JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'SYNTHETIC_OLD_ACCESS', refresh: 'SYNTHETIC_OLD_REFRESH', expires: Date.now() + 60_000 } }), { mode: 0o600 });
  const broker = await createRunPreflightJobs({ journal: f.journal, ownerToken: randomUUID(), createHost() { hosts += 1; return f.createHost(); }, readCredentialFingerprint: f.authentication.readCredentialFingerprint });
  const started = await broker.start({ ...f.scopes, idempotencyKey: randomUUID() }); assert.ok(started.kind === 'created');
  await until(async () => { const read = await broker.readJob({ runId: f.scopes.runId, jobId: started.job.jobId }); return read.kind === 'found' && read.job.state === 'completed'; });
  const evidence = f.journal.readRunPreflightJobEvidence({ runId: f.scopes.runId, jobId: started.job.jobId }); assert.ok(evidence.kind === 'found');
  assert.equal(evidence.evidence.provider, 'openai-codex'); assert.ok(evidence.evidence.accountFingerprint);
  writeFileSync(join(f.directory, 'pi', 'auth', 'auth.json'), JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'SYNTHETIC_NEW_ACCESS', refresh: 'SYNTHETIC_REFRESH', expires: Date.now() + 60_000 } }), { mode: 0o600 });
  const after = await broker.readJob({ runId: f.scopes.runId, jobId: started.job.jobId }); assert.ok(after.kind === 'found'); assert.equal(after.report.kind, 'stale');
  const page = await broker.listJobs({ runId: f.scopes.runId, offset: 0, limit: 100 }); assert.equal(page.items[0]?.report.kind, 'stale');
  assert.doesNotMatch(JSON.stringify(page), /SYNTHETIC|Fingerprint|refresh/); assert.equal(hosts, 1);
  assert.deepEqual(f.journal.readRunPreflightJobEvidence({ runId: f.scopes.runId, jobId: started.job.jobId }), evidence);
  writeFileSync(join(f.directory, 'pi', 'auth', 'auth.json'), '{}', { mode: 0o600 });
  const loggedOut = await broker.readJob({ runId: f.scopes.runId, jobId: started.job.jobId });
  assert.ok(loggedOut.kind === 'found'); assert.equal(loggedOut.report.kind, 'stale');
  assert.deepEqual(f.journal.readRunPreflightJobEvidence({ runId: f.scopes.runId, jobId: started.job.jobId }), evidence);
  await broker.close();
});

test('cancelación y close esperan evaluación readonly que ignora Abort y no adoptan resultado tardío', async (t) => {
  const f = await fixture(t); let release: (() => void) | undefined; let entered = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const broker = await createRunPreflightJobs({ journal: f.journal, ownerToken: randomUUID(), readCredentialFingerprint: f.authentication.readCredentialFingerprint,
    createHost() { const host = f.createHost(); return { ...host, async readCurrentConfigurationRevision(value) { entered = true; await gate; return host.readCurrentConfigurationRevision(value); } }; } });
  const started = await broker.start({ ...f.scopes, idempotencyKey: randomUUID() }); assert.ok(started.kind === 'created'); await until(() => entered);
  const running = await broker.readJob({ runId: f.scopes.runId, jobId: started.job.jobId }); assert.ok(running.kind === 'found');
  const canceled = await broker.cancelJob({ runId: f.scopes.runId, jobId: started.job.jobId, expectedRevision: running.job.revision, idempotencyKey: randomUUID() });
  assert.ok(canceled.kind === 'updated'); assert.equal(canceled.job.state, 'cancel-requested');
  let closed = false; const closing = broker.close().then(() => { closed = true; });
  await new Promise((resolve) => setTimeout(resolve, 5)); assert.equal(closed, false); assert.ok(release); release(); await closing;
  const terminal = f.journal.readRunPreflightJob({ runId: f.scopes.runId, jobId: started.job.jobId }); assert.ok(terminal.kind === 'found');
  assert.equal(terminal.document.job.state, 'canceled'); assert.equal(terminal.document.report.result, null);
  await assert.rejects(broker.start({ ...f.scopes, idempotencyKey: randomUUID() }), /closed/);
});

test('recovery de job abandonado no llama host y replay no reinicia evaluación', async (t) => {
  const f = await fixture(t); const key = randomUUID();
  const created = f.journal.createRunPreflightJob({ ...f.scopes, principalId: 'local-operator', idempotencyKey: key }); assert.ok(created.kind === 'created');
  f.journal.claimRunPreflightJob({ runId: f.scopes.runId, jobId: created.job.jobId, expectedRevision: 0, ownerToken: randomUUID(), claimToken: randomUUID() });
  let hosts = 0;
  const broker = await createRunPreflightJobs({ journal: f.journal, ownerToken: randomUUID(), createHost() { hosts += 1; return f.createHost(); }, readCredentialFingerprint: f.authentication.readCredentialFingerprint });
  const read = await broker.readJob({ runId: f.scopes.runId, jobId: created.job.jobId }); assert.ok(read.kind === 'found'); assert.equal(read.job.state, 'interrupted');
  assert.deepEqual(await broker.start({ ...f.scopes, idempotencyKey: key }), { kind: 'existing', job: created.job });
  await broker.close(); assert.equal(hosts, 0);
});

test('proyección omite details y códigos no conocidos; availability se resume sin nombres de actores', () => {
  const report: PreflightReport = { kind: 'invalid', checks: [
    { kind: 'unavailable', checkId: 'budget', code: 'secret-sensitive-token', detail: '/private/SECRET_PATH' },
    { kind: 'deferred', checkId: 'availability-personaje-sintetico', detail: 'SECRET_ACTOR' },
  ] };
  const result = projectRunPreflightReport(report, '2026-10-14T12:00:00.000Z');
  assert.deepEqual(result.checks, [{ kind: 'unavailable', checkId: 'budget', code: 'check-unavailable' }, { kind: 'deferred', checkId: 'participant-availability' }]);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|personaje-sintetico|secret-sensitive/);
});


test('unlimited call configuration crosses durable preflight without evaluation failure', async t => {
  const f = await fixture(t, true);
  const broker = await createRunPreflightJobs({ journal: f.journal, ownerToken: randomUUID(), createHost: f.createHost, readCredentialFingerprint: f.authentication.readCredentialFingerprint });
  try {
    const started = await broker.start({ ...f.scopes, idempotencyKey: randomUUID() });
    assert.ok(started.kind === 'created');
    await until(async () => { const result = await broker.readJob({ runId: f.scopes.runId, jobId: started.job.jobId }); return result.kind === 'found' && ['completed','failed'].includes(result.job.state); });
    const result = await broker.readJob({ runId: f.scopes.runId, jobId: started.job.jobId });
    assert.ok(result.kind === 'found'); assert.equal(result.job.state, 'completed');
    assert.ok(result.report.result?.checks.some(check => check.checkId === 'budget' && check.kind === 'passed'));
  } finally { await broker.close(); }
});

test('a probe outside the evaluated interval produces a readable durable block, without claiming current access', async t => {
  const f = await fixture(t);
  writeFileSync(join(f.directory, 'pi', 'auth', 'auth.json'), JSON.stringify({ 'openai-codex': {
    type: 'oauth', access: 'SYNTHETIC_ACCESS', refresh: 'SYNTHETIC_REFRESH', expires: Date.now() + 86_400_000,
  } }), { mode: 0o600 });
  const accountFingerprint = await f.authentication.readCredentialFingerprint({ provider: 'openai-codex' });
  assert.ok(accountFingerprint);
  const profileFingerprint = fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE);
  for (const interval of [
    { checkedAt: new Date(Date.now() - 120_000).toISOString(), expiresAt: new Date(Date.now() - 60_000).toISOString() },
    { checkedAt: new Date(Date.now() + 60_000).toISOString(), expiresAt: new Date(Date.now() + 120_000).toISOString() },
  ]) {
    const probe = f.journal.createPiAccessJob({ principalId: 'local-operator', idempotencyKey: randomUUID(), profile: DEFAULT_INFERENCE_PROFILE });
    assert.ok(probe.kind === 'created');
    const claim = f.journal.claimPiAccessJob({ jobId: probe.job.jobId, expectedRevision: probe.job.revision,
      ownerToken: randomUUID(), claimToken: randomUUID() });
    assert.ok(claim.kind === 'claimed');
    f.journal.completePiAccessJob({ jobId: probe.job.jobId, expectedRevision: claim.job.revision, lease: claim.lease,
      result: { kind: 'passed', provider: 'openai-codex', requestedProfile: DEFAULT_INFERENCE_PROFILE,
        profileFingerprint, accountFingerprint,
        effectiveProfile: { provider: 'openai-codex', api: 'openai-codex-responses', model: 'gpt-6.1-sol',
          providerThinkingLevel: null, reasoningEvidence: 'sdk-payload-and-response' },
        measuredUsage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } }, ...interval });
    const broker = await createRunPreflightJobs({ journal: f.journal, ownerToken: randomUUID(), createHost: f.createHost,
      readCredentialFingerprint: f.authentication.readCredentialFingerprint });
    try {
      const started = await broker.start({ ...f.scopes, idempotencyKey: randomUUID() });
      assert.ok(started.kind === 'created');
      const scope = { runId: f.scopes.runId, jobId: started.job.jobId };
      await until(async () => { const result = await broker.readJob(scope);
        return result.kind === 'found' && ['completed', 'failed'].includes(result.job.state); });
      const result = await broker.readJob(scope);
      assert.ok(result.kind === 'found');
      assert.equal(result.job.state, 'completed');
      assert.equal(result.job.safeCode, null);
      assert.equal(result.report.kind, 'current');
      assert.equal(result.report.result?.kind, 'blocked');
      assert.deepEqual(result.report.result?.checks.find(check => check.checkId === 'provider-access-check'),
        { kind: 'deferred', checkId: 'provider-access-check' });
      const evidence = f.journal.readRunPreflightJobEvidence(scope);
      assert.ok(evidence.kind === 'found');
      assert.deepEqual(evidence.evidence, { provider: 'openai-codex', profileFingerprint, accountFingerprint, accessReceipt: null });
      assert.equal((await broker.readLifecycleDocument(scope))?.report.result?.kind, 'blocked');
      const originalReceipt = f.journal.readLatestAccessReceipt({ provider: 'openai-codex', profileFingerprint, accountFingerprint });
      assert.ok(originalReceipt.kind === 'receipt');
      assert.equal(originalReceipt.jobId, probe.job.jobId);
      assert.equal(originalReceipt.expiresAt, interval.expiresAt, 'Historical probe proof is preserved unchanged');
    } finally { await broker.close(); }
  }
});

test('broker conserva bloqueo ICM unavailable como reporte durable legible, sin evaluation-failed',async t=>{
  const f=await fixture(t,false,true);let evaluations=0;
  const broker=await createRunPreflightJobs({journal:f.journal,ownerToken:randomUUID(),createHost(){evaluations++;return f.createHost();},readCredentialFingerprint:f.authentication.readCredentialFingerprint});
  try{
    const started=await broker.start({...f.scopes,idempotencyKey:randomUUID()});assert.ok(started.kind==='created');
    const scope={runId:f.scopes.runId,jobId:started.job.jobId};
    await until(async()=>{const read=await broker.readJob(scope);return read.kind==='found'&&['completed','failed'].includes(read.job.state);});
    const read=await broker.readJob(scope);assert.ok(read.kind==='found');assert.equal(read.job.state,'completed');assert.equal(read.job.safeCode,null);
    assert.equal(read.report.result?.kind,'blocked');
    assert.deepEqual(read.report.result?.checks,[{kind:'unavailable',checkId:'icm-context-runtime',code:'icm-context-runtime-not-connected'}]);
    assert.equal((await broker.listJobs({runId:f.scopes.runId,offset:0,limit:100})).items[0]?.report.result?.kind,'blocked');
    assert.equal(evaluations,1);
  }finally{await broker.close();}
});

test('broker evalúa ICM conectado, guarda passed con 16 gates y recupera el reporte exacto sin inferencia',async t=>{
  const f=await fixture(t,false,true);
  writeFileSync(join(f.directory,'pi','auth','auth.json'),JSON.stringify({'openai-codex':{type:'oauth',access:'SYNTHETIC_ACCESS',refresh:'SYNTHETIC_REFRESH',expires:Date.now()+86_400_000}}),{mode:0o600});
  const accountFingerprint=await f.authentication.readCredentialFingerprint({provider:'openai-codex'});assert.ok(accountFingerprint);
  const profileFingerprint=fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE);
  const probe=f.journal.createPiAccessJob({principalId:'local-operator',idempotencyKey:randomUUID(),profile:DEFAULT_INFERENCE_PROFILE});assert.ok(probe.kind==='created');
  const claim=f.journal.claimPiAccessJob({jobId:probe.job.jobId,expectedRevision:probe.job.revision,ownerToken:randomUUID(),claimToken:randomUUID()});assert.ok(claim.kind==='claimed');
  f.journal.completePiAccessJob({jobId:probe.job.jobId,expectedRevision:claim.job.revision,lease:claim.lease,
    result:{kind:'passed',provider:'openai-codex',requestedProfile:DEFAULT_INFERENCE_PROFILE,profileFingerprint,accountFingerprint,
      effectiveProfile:{provider:'openai-codex',api:'openai-codex-responses',model:'gpt-6.1-sol',providerThinkingLevel:null,reasoningEvidence:'sdk-payload-and-response'},
      measuredUsage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2}},checkedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+120_000).toISOString()});
  let evaluations=0;
  const broker=await createRunPreflightJobs({journal:f.journal,ownerToken:randomUUID(),readCredentialFingerprint:f.authentication.readCredentialFingerprint,
    createHost(){evaluations++;const host=createProductionPreflightHost({journal:f.journal,catalog:f.catalog,piRuntime:f.runtime,authentication:f.authentication,
      icmContextPacketsReady:()=>true,roleReadiness:()=>({actor:true,continuista:true,director:true,narrator:false})});
      return {...host,async readCatalogEligibility({characterIds}){return {kind:'loaded',entries:characterIds.map(characterId=>({characterId,state:{kind:'eligible'}}))};},
        async readIcmMemoryReadiness({runId,actorIds}){return {kind:'ready',version:'0.11.4',backend:'sqlite',actors:actorIds.map(characterId=>({runId,characterId,state:'recoverable',isolation:{kind:'run-actor',runId,characterId}}))};}};
    }});
  try{
    const started=await broker.start({...f.scopes,idempotencyKey:randomUUID()});assert.ok(started.kind==='created');
    const scope={runId:f.scopes.runId,jobId:started.job.jobId};
    await until(async()=>{const read=await broker.readJob(scope);return read.kind==='found'&&['completed','failed'].includes(read.job.state);});
    const read=await broker.readJob(scope);assert.ok(read.kind==='found');assert.equal(read.job.state,'completed');assert.equal(read.job.safeCode,null);
    assert.equal(read.report.result?.kind,'passed',JSON.stringify(read.report));assert.equal(read.report.result?.checks.length,16);
    assert.deepEqual(read.report.result.checks.find(check=>check.checkId==='icm-context-runtime'),{kind:'passed',checkId:'icm-context-runtime'});
    assert.deepEqual(await broker.readJob(scope),read);assert.equal(evaluations,1);
    const evidence=f.journal.readRunPreflightJobEvidence(scope);assert.ok(evidence.kind==='found');
    const another=f.journal.createRunPreflightJob({...f.scopes,principalId:'local-operator',idempotencyKey:randomUUID()});assert.ok(another.kind==='created');
    const lease={ownerToken:randomUUID(),claimToken:randomUUID()};
    const claimed=f.journal.claimRunPreflightJob({runId:f.scopes.runId,jobId:another.job.jobId,expectedRevision:0,...lease});assert.ok(claimed.kind==='claimed');
    const frozen=f.journal.readRunPreflightJobInput({runId:f.scopes.runId,jobId:another.job.jobId,lease});assert.ok(frozen.kind==='found');
    const completion={runId:f.scopes.runId,jobId:another.job.jobId,expectedRevision:claimed.job.revision,lease};
    const legacyResult={...read.report.result,checks:read.report.result.checks.filter(check=>check.checkId!=='icm-context-runtime')};
    assert.equal(RunPreflightResultSchema.safeParse(legacyResult).success,true,'la forma legacy sigue siendo válida por sí sola');
    assert.throws(()=>f.journal.completeRunPreflightJob({...completion,evaluation:{fence:frozen.fence,result:legacyResult,evidence:evidence.evidence}}),/runtime ICM configurado/);
    assert.equal(f.journal.readRunPreflightJob({runId:f.scopes.runId,jobId:another.job.jobId}).kind,'found');
    assert.equal(f.journal.completeRunPreflightJob({...completion,evaluation:{fence:frozen.fence,result:read.report.result,evidence:evidence.evidence}}).kind,'updated');
    assert.equal((await broker.readJob({runId:f.scopes.runId,jobId:another.job.jobId})).kind,'found');
    const db=new DatabaseSync(f.path,{readOnly:true});try{for(const table of ['request_reservations','actor_pi_sessions','world_events'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get()?.n,0);}finally{db.close();}
  }finally{await broker.close();}
});

test('passed conserva 15 gates legacy o 16 con ICM exactamente una vez, sin aceptar faltantes ni duplicados',()=>{
  const checks=['configuration','configuration-version','world-snapshot','prepared-contexts','catalog-eligibility','inference-profile','pi-sdk','pi-profile','provider-authentication','pi-runtime','icm-memory','budget','provider-access-check','participant-availability','voice'].map(checkId=>({kind:'passed',checkId}));
  const base={kind:'passed',checkedAt:'2026-10-16T12:00:00Z',checks};
  assert.equal(RunPreflightResultSchema.safeParse(base).success,true);
  const icm={kind:'passed',checkId:'icm-context-runtime'};
  assert.equal(RunPreflightResultSchema.safeParse({...base,checks:[...checks,icm]}).success,true);
  assert.equal(RunPreflightResultSchema.safeParse({...base,checks:[...checks,icm,icm]}).success,false);
  assert.equal(RunPreflightResultSchema.safeParse({...base,checks:[...checks.slice(1),icm]}).success,false);
  assert.equal(RunPreflightResultSchema.safeParse({...base,checks:[...checks,checks[0]]}).success,false);
});
