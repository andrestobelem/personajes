import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openConfiguratorJobLedger } from '../src/adapters/configurator-job-ledger.ts';
import { PiRuntime } from '../src/adapters/pi.ts';
import { configuratorValueHash } from '../src/application/configurator-context.ts';
import { createConfiguratorPiWorker } from '../src/application/configurator-pi-worker.ts';
import { configuratorEvolutionFixture } from './fixtures/configurator-evolution.ts';
import { controlledConfiguratorSessionFactory, configuratorSessionStats } from './fixtures/configurator-session.ts';
import {createIcmContextPacket,IcmContextPacketSchema,createIcmWorkspaceSnapshot,hashIcmMarkdown,type IcmWorkspaceSnapshot} from '../src/domain/icm-workspace.ts';
import {IcmContextPacketReceiptSchema} from '../src/domain/icm-context-jobs.ts';
import {actorId} from './fixtures/continuista.ts';
import {CONFIGURATOR_ICM_PROMPT} from '../src/application/configurator-prompt.ts';
import {canonicalDirectorValue} from '../src/application/director-context.ts';

async function fixture(icmWorkspace?:IcmWorkspaceSnapshot) {
  const f = await configuratorEvolutionFixture(icmWorkspace===undefined?{}:{icmWorkspace});
  const world = f.base.journal.loadWorld({ runId: f.source.snapshot.runId }); assert.ok(world);
  f.base.journal.setWorldLifecycle({ runId: world.runId, expectedWorldRevision: world.revision, expectedConfigRevision: f.source.configuration.configRevision, target: 'paused' });
  const host = {
    readHead({ runId }: { runId: string }) {
      const snapshot = f.base.journal.loadWorld({ runId }); const lifecycle = f.base.journal.readWorldLifecycle({ runId }); assert.ok(snapshot && lifecycle);
      const cut = f.base.journal.readInspectorWorldCut({ runId }); assert.ok(cut);
      const source = f.base.journal.readForkSource({ runId, commitIndex: cut.commitIndex, worldRevision: snapshot.revision, worldSeq: snapshot.seq }); assert.ok(source.kind === 'found');
      const anchor = source.cuts[0]?.source; assert.ok(anchor);
      return { source: anchor, lifecycle: lifecycle.lifecycle, lifecycleRevision: lifecycle.lifecycleRevision };
    },
    readForkSource: f.base.journal.readForkSource,
    assertIdle({ runId }: { runId: string }) {
      const db = new DatabaseSync(f.journalPath, { readOnly: true });
      try {
        assert.equal(db.prepare("SELECT count(*) n FROM actor_turn_jobs WHERE run_id=? AND state IN ('queued','running')").get(runId)?.n, 0);
        assert.equal(db.prepare("SELECT count(*) n FROM coordinator_pulses WHERE run_id=? AND state='running'").get(runId)?.n, 0);
      } finally { db.close(); }
    },
  };
  let ledger = openConfiguratorJobLedger({ journalPath: f.journalPath, privateDataRoot: f.base.directory, ownerToken: randomUUID(), host });
  const head = host.readHead({ runId: world.runId });
  const beginRequest = { runId: world.runId, actorId: f.characterId, principalId: 'configurator-worker-test', idempotencyKey: randomUUID(),
    expectedCommitIndex: head.source.commitIndex, expectedWorldRevision: head.source.worldRevision, expectedConfigurationRevision: head.source.configurationRevision, originalDossier: f.originalDossier };
  const begun = ledger.begin(beginRequest); assert.ok(begun.kind === 'created');
  const runtime = await PiRuntime.create({ privateDataRoot: f.base.directory }); const stats = configuratorSessionStats();
  return { f, runtime, stats, beginRequest, job: begun.job, get ledger() { return ledger; },
    reopen() { ledger.close(); ledger = openConfiguratorJobLedger({ journalPath: f.journalPath, privateDataRoot: f.base.directory, ownerToken: randomUUID(), host }); },
    counts() {
      const db = new DatabaseSync(f.journalPath, { readOnly: true });
      try {
        return { reservations: db.prepare('SELECT request_seq,state FROM request_reservations WHERE job_id=? ORDER BY request_seq').all(begun.job.jobId),
          spans: db.prepare('SELECT request_seq,state FROM model_time_spans WHERE job_id=? ORDER BY request_seq').all(begun.job.jobId),
          sessions: db.prepare('SELECT session_path FROM configurator_sessions WHERE job_id=?').all(begun.job.jobId),
          candidates: db.prepare('SELECT payload_json FROM configurator_candidates WHERE job_id=?').all(begun.job.jobId),
          checkpoints: db.prepare('SELECT kind,request_seq,payload_json FROM configurator_checkpoints WHERE job_id=? ORDER BY kind,request_seq').all(begun.job.jobId),
          worldEvents: db.prepare('SELECT count(*) n FROM world_events WHERE run_id=?').get(world.runId)?.n,
        };
      } finally { db.close(); }
    },
    mutate(work: (db: DatabaseSync) => void) { const db = new DatabaseSync(f.journalPath); try { work(db); } finally { db.close(); } },
    resumeWorld() { const current = f.base.journal.loadWorld({ runId: world.runId }); assert.ok(current); f.base.journal.setWorldLifecycle({ runId: world.runId, expectedWorldRevision: current.revision, expectedConfigRevision: f.source.configuration.configRevision, target: 'running' }); },
    close() { ledger.close(); f.close(); },
  };
}

test('Configurador SDK realiza dos rondas con perfil exacto y acepta sólo propuesta durable de memoria propia sin aplicar identidad', async () => {
  const f = await fixture();
  try {
    const before = f.f.base.journal.loadWorld({ runId: f.job.runId });
    const worker = createConfiguratorPiWorker({ ledger: f.ledger, journal: f.f.base.journal, runtime: f.runtime,
      sessionFactory: controlledConfiguratorSessionFactory({ root: f.f.base.directory, stats: f.stats }) });
    const result = await worker.run(f.job); assert.ok('job' in result, JSON.stringify(result)); assert.equal(result.job.state, 'accepted');
    assert.equal(f.stats.sessions, 1); assert.equal(f.stats.requests, 2); assert.equal(f.stats.disposed, 1);
    assert.deepEqual(f.stats.profiles, [f.f.source.configuration.inferenceProfile]);
    const context = f.stats.contexts[0]; assert.ok(context); assert.equal(context.scope.kind, 'evolution');
    assert.ok(context.evolutionEvidence.some(item => item.kind === 'admitted-experience' && item.epistemicStatus === 'believed'));
    assert.ok(context.evolutionEvidence.some(item => item.kind === 'admitted-experience' && item.epistemicStatus === 'reported'));
    assert.equal(JSON.stringify(context).includes('SECRET_PRIVATE_OTHER_MEMORY'), false);
    assert.deepEqual(f.f.base.journal.loadWorld({ runId: f.job.runId }), before);
    const counts = f.counts(); assert.equal(counts.sessions.length, 1); assert.equal(counts.candidates.length, 1); assert.equal(counts.reservations.length, 2);
    assert.deepEqual(counts.reservations.map(row => row.state), ['completed', 'completed']); assert.deepEqual(counts.spans.map(row => row.state), ['settled', 'settled']);
    assert.equal(counts.checkpoints.filter(row => row.kind === 'request-input').length, 2);
    const sessionPath = counts.sessions[0]?.session_path; assert.equal(typeof sessionPath, 'string'); assert.match(String(sessionPath), /\/roles\/configurador\/sessions\//);
    const entries = readFileSync(String(sessionPath), 'utf8'); assert.ok(entries.includes('submit_configurator_proposal')); assert.ok(entries.includes(result.candidate.candidateId));
    const accepted = f.ledger.read({ jobId: f.job.jobId, principalId: f.job.principalId }); assert.equal(accepted.state, 'accepted');
    f.reopen(); const replay = f.ledger.begin(f.beginRequest); assert.equal(replay.kind, 'existing');
    assert.equal(f.ledger.readAccepted({ jobId: f.job.jobId, principalId: f.job.principalId })?.job.state, 'accepted');
    const reopenedWorker = createConfiguratorPiWorker({ ledger: f.ledger, journal: f.f.base.journal, runtime: f.runtime,
      sessionFactory: controlledConfiguratorSessionFactory({ root: f.f.base.directory, stats: f.stats }) });
    await assert.rejects(reopenedWorker.run(accepted), /CONFIGURATOR_CLAIM_CONFLICT/);
    assert.equal(f.stats.requests, 2); assert.equal(f.stats.sessions, 1);
  } finally { f.close(); }
});

for (const mode of ['missing-tool', 'incomplete'] as const) {
  test(`Configurador no acepta terminal ${mode} aunque complete transporte real`, async () => {
    const f = await fixture();
    try {
      const before = f.f.base.journal.loadWorld({ runId: f.job.runId });
      const worker = createConfiguratorPiWorker({ ledger: f.ledger, journal: f.f.base.journal, runtime: f.runtime,
        sessionFactory: controlledConfiguratorSessionFactory({ root: f.f.base.directory, stats: f.stats, omitProposal: mode === 'missing-tool', incomplete: mode === 'incomplete' }) });
      const result = await worker.run(f.job); assert.ok(!('job' in result)); assert.equal(result.state, 'failed');
      assert.equal(result.failureCode, mode === 'missing-tool' ? 'CONFIGURATOR_PROPOSAL_MISSING' : 'CONFIGURATOR_TERMINAL_INCOMPLETE');
      assert.equal(f.counts().candidates.length, 0); assert.deepEqual(f.f.base.journal.loadWorld({ runId: f.job.runId }), before);
      assert.equal(f.stats.requests, mode === 'missing-tool' ? 1 : 2);
    } finally { f.close(); }
  });
}

for (const when of ['before-session', 'after-tool'] as const) {
  test(`Configurador cancelado ${when} no acepta ni modifica el Escenario`, async () => {
    const f = await fixture(); const controller = new AbortController();
    try {
      const before = f.f.base.journal.loadWorld({ runId: f.job.runId }); if (when === 'before-session') controller.abort();
      const worker = createConfiguratorPiWorker({ ledger: f.ledger, journal: f.f.base.journal, runtime: f.runtime,
        sessionFactory: controlledConfiguratorSessionFactory({ root: f.f.base.directory, stats: f.stats, afterTool: () => controller.abort() }) });
      const result = await worker.run(f.job, { signal: controller.signal }); assert.ok(!('job' in result)); assert.equal(result.state, 'failed'); assert.equal(result.failureCode, 'CONFIGURATOR_CANCELLED');
      assert.equal(f.stats.requests, when === 'before-session' ? 0 : 1); assert.equal(f.counts().candidates.length, 0); assert.deepEqual(f.f.base.journal.loadWorld({ runId: f.job.runId }), before);
    } finally { f.close(); }
  });
}

test('Configurador bloquea época de corrida obsoleta antes de cualquier transporte', async () => {
  const f = await fixture();
  try {
    const worker = createConfiguratorPiWorker({ ledger: f.ledger, journal: f.f.base.journal, runtime: f.runtime,
      sessionFactory: controlledConfiguratorSessionFactory({ root: f.f.base.directory, stats: f.stats, beforeSession: () => f.resumeWorld() }) });
    const result = await worker.run(f.job); assert.ok(!('job' in result)); assert.equal(result.state, 'failed'); assert.equal(f.stats.requests, 0); assert.equal(f.counts().candidates.length, 0);
  } finally { f.close(); }
});

test('Configurador agotado no despacha original y el presupuesto de una llamada limita segunda ronda', async () => {
  for (const pulseOnly of [false, true]) {
    const f = await fixture();
    try {
      f.f.base.journal.configureRun({ runId: f.job.runId, maxCalls: f.f.source.configuration.budget.maxPiCallsPerRun });
      if (pulseOnly) {
        f.f.base.journal.configurePulse({ runId: f.job.runId, pulseId: f.job.jobId, maxCalls: f.f.source.configuration.budget.maxPiCallsPerPulse });
        f.mutate(db => db.prepare('UPDATE pulses SET consumed=max_calls-1 WHERE run_id=? AND pulse_id=?').run(f.job.runId, f.job.jobId));
      }
      else f.mutate(db => db.prepare('UPDATE run_budgets SET consumed=max_calls WHERE run_id=?').run(f.job.runId));
      const worker = createConfiguratorPiWorker({ ledger: f.ledger, journal: f.f.base.journal, runtime: f.runtime,
        sessionFactory: controlledConfiguratorSessionFactory({ root: f.f.base.directory, stats: f.stats }) });
      const result = await worker.run(f.job); assert.ok(!('job' in result)); assert.equal(result.state, 'failed');
      assert.equal(f.stats.requests, pulseOnly ? 1 : 0); assert.equal(f.counts().reservations.length, pulseOnly ? 1 : 0); assert.equal(f.counts().candidates.length, 0);
    } finally { f.close(); }
  }
});

test('Configurador rechaza JSONL alterado después de checkpoint terminal real antes de aceptación', async () => {
  const f = await fixture();
  try {
    const worker = createConfiguratorPiWorker({ ledger: f.ledger, journal: f.f.base.journal, runtime: f.runtime,
      sessionFactory: controlledConfiguratorSessionFactory({ root: f.f.base.directory, stats: f.stats, afterTerminal(snapshot) {
        assert.ok(snapshot.sessionPath); const original = readFileSync(snapshot.sessionPath, 'utf8');
        writeFileSync(snapshot.sessionPath, original.replace('Procuro escuchar con paciencia.', 'Texto alterado después del checkpoint.'));
      } }) });
    const result = await worker.run(f.job); assert.ok(!('job' in result)); assert.equal(result.state, 'failed');
    assert.equal(f.ledger.read({ jobId: f.job.jobId, principalId: f.job.principalId }).state, 'failed'); assert.equal(f.stats.requests, 2);
  } finally { f.close(); }
});

test('Consentimiento del operador exige propuesta SDK aceptada y prueba JSONL íntegra incluso después de aceptación', async () => {
  const f = await fixture();
  try {
    const worker = createConfiguratorPiWorker({ ledger: f.ledger, journal: f.f.base.journal, runtime: f.runtime,
      sessionFactory: controlledConfiguratorSessionFactory({ root: f.f.base.directory, stats: f.stats }) });
    const accepted = await worker.run(f.job); assert.ok('job' in accepted);
    const lookup = { jobId: f.job.jobId, principalId: f.job.principalId };
    const privateJob = f.ledger.readAccepted(lookup); assert.ok(privateJob);
    const request = { ...lookup, expectedRevision: accepted.job.revision, idempotencyKey: randomUUID(),
      contextHash: accepted.job.contextHash, proposalHash: configuratorValueHash(accepted.candidate.proposal),
      targetFullHash: privateJob.context.targetFullHash, operationId: randomUUID() };
    const approval = f.ledger.confirmConsent(request);
    assert.deepEqual(f.ledger.confirmConsent(request), approval);
    const authorityRequest = { principalId: f.job.principalId, runId: f.job.runId, actorId: f.job.actorId,
      contextHash: request.contextHash, proposalHash: request.proposalHash, approvalHash: configuratorValueHash(approval), approval };
    const authority = f.ledger.requireAcceptedConfiguratorProposal(authorityRequest);
    assert.equal(authority.candidateHash, accepted.candidate.candidateHash);
    const fakeApproval = { ...approval, operationId: randomUUID() };
    assert.throws(() => f.ledger.requireAcceptedConfiguratorProposal({ ...authorityRequest, approval: fakeApproval, approvalHash: configuratorValueHash(fakeApproval) }));
    const sessionPath = f.counts().sessions[0]?.session_path; assert.equal(typeof sessionPath, 'string');
    const bytes = readFileSync(String(sessionPath), 'utf8');
    writeFileSync(String(sessionPath), bytes.replace('Procuro escuchar con paciencia.', 'Alteración posterior a aceptación.'));
    assert.throws(() => f.ledger.readAccepted(lookup), /CONFIGURATOR_/);
    assert.throws(() => f.ledger.requireAcceptedConfiguratorProposal(authorityRequest), /CONFIGURATOR_/);
    assert.equal(f.stats.requests, 2);
  } finally { f.close(); }
});

test('Rechazar propuesta aceptada conserva el candidato como evidencia sin autoridad para promover identidad', async () => {
  const f = await fixture();
  try {
    const worker = createConfiguratorPiWorker({ ledger: f.ledger, journal: f.f.base.journal, runtime: f.runtime,
      sessionFactory: controlledConfiguratorSessionFactory({ root: f.f.base.directory, stats: f.stats }) });
    const accepted = await worker.run(f.job); assert.ok('job' in accepted);
    const lookup = { jobId: f.job.jobId, principalId: f.job.principalId };
    const rejected = f.ledger.reject({ ...lookup, expectedRevision: accepted.job.revision, idempotencyKey: randomUUID() });
    assert.equal(rejected.state, 'rejected'); assert.equal(f.ledger.readAccepted(lookup), undefined);
    assert.deepEqual(f.ledger.readPrivate(lookup).candidate, accepted.candidate);
    assert.equal(f.stats.requests, 2);
  } finally { f.close(); }
});

test('fallo al preparar cuota tras claim termina el job sin abrir Pi ni dejarlo running', async () => {
  const f = await fixture();
  try {
    const worker = createConfiguratorPiWorker({ ledger: f.ledger,
      journal: { ...f.f.base.journal, configureRun() { throw new Error('quota mismatch'); } },
      runtime: f.runtime,
      sessionFactory: controlledConfiguratorSessionFactory({ root: f.f.base.directory, stats: f.stats }) });
    await worker.run(f.job);
    const result = f.ledger.read({ jobId: f.job.jobId, principalId: f.job.principalId });
    assert.equal(result.state, 'failed');
    assert.equal(result.failureCode, 'CONFIGURATOR_EXECUTION_FAILED');
    assert.equal(f.stats.sessions, 0);
    assert.equal(f.counts().reservations.length, 0);
  } finally { f.close(); }
});

function configuratorWorkspace(){
  const audiences=[{role:'actor' as const,actorId},...(['continuista','director','configurator'] as const).map(role=>({role}))];
  return createIcmWorkspaceSnapshot({sources:audiences.map(audience=>({sourceId:`synthetic.${audience.role}`,audience,revision:0,
    sourceHash:hashIcmMarkdown(audience.role),sections:[{sectionId:'process',markdown:`ICM_PRIVATE_${audience.role}`}]}))});
}

test('Configurador ICM acepta dos requests SDK físicas y conserva aceptación tras reabrir sin reemplazar el prompt por JSON legacy',async()=>{
  const f=await fixture(configuratorWorkspace());
  try{
    const before=f.f.base.journal.loadWorld({runId:f.job.runId});
    let dispatchedPrompt='';
    const worker=createConfiguratorPiWorker({ledger:f.ledger,journal:f.f.base.journal,runtime:f.runtime,
      sessionFactory:controlledConfiguratorSessionFactory({root:f.f.base.directory,stats:f.stats,transformUserPrompt(text){dispatchedPrompt=text;return text;}})});
    const result=await worker.run(f.job);assert.ok('job' in result,JSON.stringify(result));assert.equal(result.job.state,'accepted');
    assert.equal(dispatchedPrompt,CONFIGURATOR_ICM_PROMPT);assert.equal(f.stats.requests,2);assert.equal(f.stats.disposed,1);
    assert.deepEqual(f.f.base.journal.loadWorld({runId:f.job.runId}),before);
    const sessionPath=f.counts().sessions[0]?.session_path;assert.equal(typeof sessionPath,'string');
    const messages=readFileSync(String(sessionPath),'utf8');assert.ok(messages.includes(CONFIGURATOR_ICM_PROMPT));
    f.reopen();assert.equal(f.ledger.readAccepted({jobId:f.job.jobId,principalId:f.job.principalId})?.job.state,'accepted');
    assert.equal(f.stats.requests,2,'historical verification does not infer');
  }finally{f.close();}
});

for(const prompt of ['foreign','legacy-context'] as const){
  test(`Configurador ICM rechaza user prompt ${prompt} aunque tool y checkpoints físicos sean válidos`,async()=>{
    const f=await fixture(configuratorWorkspace());
    try{
      const worker=createConfiguratorPiWorker({ledger:f.ledger,journal:f.f.base.journal,runtime:f.runtime,
        sessionFactory:controlledConfiguratorSessionFactory({root:f.f.base.directory,stats:f.stats,
          transformUserPrompt(_text,context){return prompt==='foreign'?'Texto de otro trabajo':canonicalDirectorValue(context);}})});
      const result=await worker.run(f.job);assert.ok(!('job' in result));assert.equal(result.state,'failed');
      assert.equal(result.failureCode,'CONFIGURATOR_INPUT_CONTEXT_MISMATCH');assert.equal(f.stats.requests,2);
      assert.equal(f.ledger.readAccepted({jobId:f.job.jobId,principalId:f.job.principalId}),undefined);
    }finally{f.close();}
  });
}

test('Configurador ICM rechaza paquete durable alterado antes de aceptar y al releer aceptación',async()=>{
  for(const when of ['before-acceptance','after-acceptance'] as const){
    const f=await fixture(configuratorWorkspace());
    try{
      const corrupt=()=>f.mutate(db=>{db.exec('DROP TRIGGER icm_context_packets_no_update');
        db.prepare("UPDATE icm_context_packets SET packet_json=replace(packet_json,'ICM_PRIVATE_configurator','CORRUPTED_configurator') WHERE job_id=?").run(f.job.jobId);});
      const worker=createConfiguratorPiWorker({ledger:f.ledger,journal:f.f.base.journal,runtime:f.runtime,
        sessionFactory:controlledConfiguratorSessionFactory({root:f.f.base.directory,stats:f.stats,...(when==='before-acceptance'?{afterTerminal:corrupt}:{})})});
      const result=await worker.run(f.job);assert.equal(f.stats.requests,2);
      if(when==='before-acceptance'){assert.ok(!('job' in result));assert.equal(result.state,'failed');assert.equal(result.failureCode,'CONFIGURATOR_INPUT_ICM_PACKET_MISMATCH');}
      else{assert.ok('job' in result);assert.equal(result.job.state,'accepted');corrupt();
        assert.throws(()=>f.ledger.readAccepted({jobId:f.job.jobId,principalId:f.job.principalId}),/CONFIGURATOR_INPUT_ICM_PACKET_MISMATCH/);}
    }finally{f.close();}
  }
});

for(const changed of ['foreign-generation','foreign-context'] as const){
  test(`Configurador ICM rechaza paquete autoconsistente ${changed} aunque se recalculen todos sus sellos`,async()=>{
    const f=await fixture(configuratorWorkspace());
    try{
      const worker=createConfiguratorPiWorker({ledger:f.ledger,journal:f.f.base.journal,runtime:f.runtime,
        sessionFactory:controlledConfiguratorSessionFactory({root:f.f.base.directory,stats:f.stats,afterTerminal(){f.mutate(db=>{
          const row=db.prepare('SELECT packet_json,receipt_json FROM icm_context_packets WHERE job_id=?').get(f.job.jobId);assert.ok(row);
          const packet=IcmContextPacketSchema.parse(JSON.parse(String(row.packet_json)));
          const receipt=IcmContextPacketReceiptSchema.parse(JSON.parse(String(row.receipt_json)));
          const {kind:_kind,schemaVersion:_schemaVersion,packetHash:_packetHash,...body}=packet;
          const replacement=createIcmContextPacket({...body,...(changed==='foreign-generation'?{scope:{...packet.scope,generation:packet.scope.generation+1}}:{diegeticContextMarkdown:'Otro contexto con sello recalculado'})});
          const replacedReceipt={...receipt,scope:replacement.scope,packetHash:replacement.packetHash};
          const scopeText=canonicalDirectorValue(replacement.scope),packetText=canonicalDirectorValue(replacement),receiptText=canonicalDirectorValue(replacedReceipt);
          const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
          db.exec('DROP TRIGGER icm_context_packets_no_update');
          db.prepare('UPDATE icm_context_packets SET scope_json=?,scope_hash=?,packet_json=?,packet_hash=?,receipt_json=?,receipt_hash=? WHERE job_id=?')
            .run(scopeText,hash(scopeText),packetText,hash(packetText),receiptText,hash(receiptText),f.job.jobId);
        });}})});
      const result=await worker.run(f.job);assert.ok(!('job' in result));assert.equal(result.state,'failed');
      assert.equal(result.failureCode,'CONFIGURATOR_INPUT_ICM_PACKET_MISMATCH');assert.equal(f.stats.requests,2);
    }finally{f.close();}
  });
}

for(const corruption of ['missing-commit','snapshot-hash','world-revision','world-seq'] as const){
  test(`Configurador valida ancla ${corruption} en ICM y legacy al releer aceptación`,async()=>{
    for(const workspace of [undefined,configuratorWorkspace()]){
      const f=await fixture(workspace);
      try{
        const worker=createConfiguratorPiWorker({ledger:f.ledger,journal:f.f.base.journal,runtime:f.runtime,
          sessionFactory:controlledConfiguratorSessionFactory({root:f.f.base.directory,stats:f.stats})});
        const result=await worker.run(f.job);assert.ok('job' in result);assert.equal(result.job.state,'accepted');
        assert.ok(f.job.source.commitIndex>0);
        f.mutate(db=>{
          if(corruption==='missing-commit'){db.exec('PRAGMA foreign_keys=OFF');db.prepare('DELETE FROM world_commits WHERE run_id=? AND commit_index=?').run(f.job.runId,f.job.source.commitIndex);}
          else if(corruption==='snapshot-hash')db.prepare('UPDATE world_commits SET snapshot_hash=? WHERE run_id=? AND commit_index=?').run('0'.repeat(64),f.job.runId,f.job.source.commitIndex);
          else if(corruption==='world-revision')db.prepare('UPDATE world_commits SET world_revision=world_revision+1 WHERE run_id=? AND commit_index=?').run(f.job.runId,f.job.source.commitIndex);
          else db.prepare('UPDATE world_commits SET last_seq=last_seq+1 WHERE run_id=? AND commit_index=?').run(f.job.runId,f.job.source.commitIndex);
        });
        assert.throws(()=>f.ledger.readAccepted({jobId:f.job.jobId,principalId:f.job.principalId}),/CONFIGURATOR_INPUT_SOURCE_MISMATCH/);
        assert.equal(f.stats.requests,2);
      }finally{f.close();}
    }
  });
}
