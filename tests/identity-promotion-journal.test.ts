import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openJournal } from '../src/adapters/journal.ts';
import { createDeliverWorldWorker } from '../src/application/deliver-world.ts';
import { compileConfiguratorEvolutionContext } from '../src/application/configurator-evolution-context.ts';
import { configuratorValueHash } from '../src/application/configurator-context.ts';
import { ConfiguratorApprovalSchema, ConfiguratorEvolutionRunScopeSchema, ConfiguratorProposalSchema } from '../src/domain/configurator.ts';
import { AcceptedConfiguratorProposalSchema, IdentityPromotionRequestSchema } from '../src/domain/identity-promotion.ts';
import { DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { RunConfigurationDraftSchema, createEmptyRunConfigurationDraft } from '../src/domain/production.ts';
import { canonical } from './fixtures/continuista.ts';
import { configuratorEvolutionFixture } from './fixtures/configurator-evolution.ts';

async function fixture(){
 const f=await configuratorEvolutionFixture();let journal=f.base.journal;
 const inspect=<T>(body:(db:DatabaseSync)=>T)=>{const db=new DatabaseSync(f.journalPath);try{return body(db);}finally{db.close();}};
 assert.equal((await createDeliverWorldWorker({journal,runId:f.source.snapshot.runId,actorId:f.characterId}).drain()).kind,'completed');
 // Host fixture explicitly acknowledges all synthetic memory projections before
 // admission. The command itself must never remove an outbox or alter memories.
 inspect(db=>{db.exec('DELETE FROM memory_outbox;CREATE TABLE test_configurator_authority(operation_id TEXT PRIMARY KEY,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL)');});
 assert.equal(journal.setWorldLifecycle({runId:f.source.snapshot.runId,expectedWorldRevision:f.source.snapshot.revision,expectedConfigRevision:f.source.configuration.configRevision,target:'paused'}),'updated');
 let authorizations=0;let idleChecks=0;let idle=true;
 function configure(){journal.configureIdentityPromotionPorts({requireAcceptedConfiguratorProposal(input){authorizations++;const row=inspect(db=>db.prepare('SELECT payload_json,payload_hash FROM test_configurator_authority WHERE operation_id=?').get(input.approval.operationId));if(row===undefined)throw new Error('TEST_CONFIGURATOR_CANDIDATE_NOT_ACCEPTED');const proof=AcceptedConfiguratorProposalSchema.parse(JSON.parse(String(row.payload_json)));assert.equal(configuratorValueHash(proof),row.payload_hash);assert.equal(proof.contextHash,input.contextHash);assert.equal(proof.proposalHash,input.proposalHash);assert.equal(proof.approvalHash,input.approvalHash);return proof;},assertIdentityPromotionRuntimeIdle(){idleChecks++;if(!idle)throw new Error('TEST_RUNTIME_NOT_DRAINED');}});}
 function request(){
  const state=journal.readWorldLifecycle({runId:f.source.snapshot.runId});assert.ok(state);const snapshot=journal.loadWorld({runId:state.runId});assert.ok(snapshot);const cut=journal.readInspectorWorldCut({runId:state.runId,worldRevision:snapshot.revision,atWorldSeq:snapshot.seq});assert.ok(cut);
  const source=journal.readForkSource({runId:state.runId,commitIndex:cut.commitIndex,worldRevision:snapshot.revision,worldSeq:snapshot.seq});assert.equal(source.kind,'found');if(source.kind!=='found')assert.fail();
  const scope=ConfiguratorEvolutionRunScopeSchema.parse({...f.scope,jobId:randomUUID(),lifecycleRevision:state.lifecycleRevision,configurationRevision:source.configuration.configRevision,worldRevision:snapshot.revision,throughWorldSeq:snapshot.seq,fictitiousAt:snapshot.clock.instant});
  const context=compileConfiguratorEvolutionContext({source,originalDossier:f.originalDossier,scope,characterId:f.characterId});const actor=context.preparedCharacter;assert.ok(actor);
  const evidence=context.evolutionEvidence.find(item=>item.kind==='admitted-experience');assert.ok(evidence);
  const proposal=ConfiguratorProposalSchema.parse({...f.proposal,expectedIdentityVersion:actor.identityVersion,evidenceIds:[evidence.evidenceId],identity:{...actor.identity.value,selfConcept:`${actor.identity.value.selfConcept} Evolución sintética ${actor.identityVersion+1}.`}});
  const approval=ConfiguratorApprovalSchema.parse({...f.approval,operationId:randomUUID(),proposalHash:configuratorValueHash(proposal),contextHash:configuratorValueHash(context),targetFullHash:context.targetFullHash});
  return IdentityPromotionRequestSchema.parse({principalId:approval.operatorId,idempotencyKey:randomUUID(),expectedLifecycleRevision:state.lifecycleRevision,expectedCommitIndex:cut.commitIndex,expectedWorldRevision:snapshot.revision,context,proposal,approval});
 }
 function accept(request:ReturnType<typeof IdentityPromotionRequestSchema.parse>){assert.equal(request.context.scope.kind,'evolution');if(request.context.scope.kind!=='evolution')assert.fail();const proof=AcceptedConfiguratorProposalSchema.parse({kind:'accepted-configurator-proposal',jobId:request.context.scope.scope.jobId,candidateHash:configuratorValueHash({proposal:request.proposal}),principalId:request.principalId,runId:request.context.scope.anchor.source.runId,actorId:f.characterId,contextHash:configuratorValueHash(request.context),proposalHash:configuratorValueHash(request.proposal),approvalHash:configuratorValueHash(request.approval)});inspect(db=>db.prepare('INSERT INTO test_configurator_authority VALUES(?,?,?)').run(request.approval.operationId,JSON.stringify(proof),configuratorValueHash(proof)));}
 return {f,get journal(){return journal;},inspect,request,accept,configure,get authorizations(){return authorizations;},get idleChecks(){return idleChecks;},setIdle(value:boolean){idle=value;},reopen(){if(journal!==f.base.journal)journal.close();journal=openJournal({path:f.journalPath});},close(){if(journal!==f.base.journal)journal.close();f.close();}};
}

test('promoción durable conserva memoria/reloj/seq e historia exacta, crea epoch reservada y replay previo al CAS',async()=>{
 const t=await fixture();try{
  const request=t.request();t.accept(request);t.configure();const before=t.journal.loadWorld({runId:t.f.source.snapshot.runId});assert.ok(before);const oldSource=t.journal.readForkSource(t.f.context.scope.kind==='evolution'?{runId:t.f.context.scope.anchor.source.runId,commitIndex:t.f.context.scope.anchor.source.commitIndex,worldRevision:t.f.context.scope.anchor.source.worldRevision,worldSeq:t.f.context.scope.anchor.source.worldSeq}:assert.fail());
  const beforeRows=t.inspect(db=>({events:db.prepare('SELECT * FROM world_events').all(),experiences:db.prepare('SELECT * FROM experiences').all(),knowledge:db.prepare('SELECT * FROM actor_knowledge').all(),perceptions:db.prepare('SELECT * FROM world_perceptions').all(),initial:db.prepare('SELECT initial_snapshot_json,initial_snapshot_hash FROM world_runs').get()}));
  const result=t.journal.applyIdentityPromotion(request);assert.equal(result.kind,'applied');const after=t.journal.loadWorld({runId:before.runId});assert.ok(after);assert.equal(after.seq,before.seq);assert.deepEqual(after.clock,before.clock);assert.equal(after.revision,before.revision+1);assert.deepEqual(after.entities.map(entity=>entity.kind==='character'?entity.mind:null),before.entities.map(entity=>entity.kind==='character'?entity.mind:null));
  assert.deepEqual(t.inspect(db=>({events:db.prepare('SELECT * FROM world_events').all(),experiences:db.prepare('SELECT * FROM experiences').all(),knowledge:db.prepare('SELECT * FROM actor_knowledge').all(),perceptions:db.prepare('SELECT * FROM world_perceptions').all(),initial:db.prepare('SELECT initial_snapshot_json,initial_snapshot_hash FROM world_runs').get()})),beforeRows);
  assert.equal(result.receipt.target.commitIndex,result.receipt.source.commitIndex+1);assert.equal(result.receipt.identityVersion,result.receipt.previousIdentityVersion+1);assert.equal(result.receipt.epochIndex,1);assert.equal(t.journal.loadActorPiSession({runId:before.runId,actorId:t.f.characterId}),undefined);
  assert.deepEqual(t.journal.readForkSource(t.f.context.scope.kind==='evolution'?{runId:t.f.context.scope.anchor.source.runId,commitIndex:t.f.context.scope.anchor.source.commitIndex,worldRevision:t.f.context.scope.anchor.source.worldRevision,worldSeq:t.f.context.scope.anchor.source.worldSeq}:assert.fail()),oldSource);
  assert.deepEqual(t.journal.applyIdentityPromotion(request),{kind:'existing',receipt:result.receipt});assert.equal(t.authorizations,1);assert.equal(t.idleChecks,1);
  assert.throws(()=>t.journal.applyIdentityPromotion({...request,expectedWorldRevision:after.revision}),/IDEMPOTENCY_REUSE/);
  t.reopen();assert.deepEqual(t.journal.applyIdentityPromotion(request),{kind:'existing',receipt:result.receipt});assert.deepEqual(t.journal.readIdentityPromotionHistory({runId:before.runId}),[result.receipt]);assert.equal(t.journal.readActorIdentityEpochs({runId:before.runId,actorId:t.f.characterId}).length,2);
 }finally{t.close();}
});

test('dos promociones sin turno no archivan sesión A como B y reservan C manteniendo único archivo de A',async()=>{
 const t=await fixture();try{
  const actor=t.f.source.configuration.roster.preparedCharacters.find(actor=>actor.characterId===t.f.characterId);assert.ok(actor);
  const registered=t.journal.registerActorPiSession({runId:t.f.source.snapshot.runId,actorId:t.f.characterId,sessionId:'epoch-A',sessionPath:join(t.f.base.directory,'epoch-A.jsonl'),preparedContextHash:configuratorValueHash(actor),profile:DEFAULT_INFERENCE_PROFILE});
  t.configure();const first=t.request();t.accept(first);t.journal.applyIdentityPromotion(first);assert.equal(t.journal.loadActorPiSession({runId:t.f.source.snapshot.runId,actorId:t.f.characterId}),undefined);
  const second=t.request();t.accept(second);const promoted=t.journal.applyIdentityPromotion(second);assert.equal(promoted.receipt.epochIndex,2);
  assert.deepEqual(t.journal.loadActorPiSessionAtEpoch({runId:t.f.source.snapshot.runId,actorId:t.f.characterId,epochIndex:0}),registered.session);assert.equal(t.journal.loadActorPiSessionAtEpoch({runId:t.f.source.snapshot.runId,actorId:t.f.characterId,epochIndex:1}),undefined);assert.equal(t.journal.loadActorPiSession({runId:t.f.source.snapshot.runId,actorId:t.f.characterId}),undefined);
  assert.equal(t.inspect(db=>db.prepare('SELECT COUNT(*) AS n FROM actor_pi_session_archives').get()?.n),1);t.reopen();assert.equal(t.journal.loadActorPiSession({runId:t.f.source.snapshot.runId,actorId:t.f.characterId}),undefined);
 }finally{t.close();}
});

test('sin autoridad configurada, propuesta no aceptada, runtime sin drenar o CAS obsoleto no se publica nada',async()=>{
 const t=await fixture();try{
  const request=t.request();assert.throws(()=>t.journal.applyIdentityPromotion(request),/AUTHORITY_UNCONFIGURED/);t.configure();assert.throws(()=>t.journal.applyIdentityPromotion(request),/NOT_ACCEPTED/);t.accept(request);t.setIdle(false);assert.throws(()=>t.journal.applyIdentityPromotion(request),/NOT_DRAINED/);t.setIdle(true);assert.throws(()=>t.journal.applyIdentityPromotion({...request,expectedCommitIndex:request.expectedCommitIndex+1}),/STALE/);
  assert.equal(t.inspect(db=>db.prepare('SELECT COUNT(*) AS n FROM identity_promotion_receipts').get()?.n),0);assert.equal(t.inspect(db=>db.prepare('SELECT COUNT(*) AS n FROM actor_identity_epochs').get()?.n),0);assert.equal(t.inspect(db=>db.prepare('SELECT COUNT(*) AS n FROM run_configuration_revisions').get()?.n),0);
 }finally{t.close();}
});

test('primer claim abre sesión independiente, rotación conserva bindings y reclaim reutiliza corte congelado aun si el head avanza',async()=>{
 const t=await fixture();try{
  const runId=t.f.source.snapshot.runId;const actorId=t.f.characterId;const original=t.f.source.configuration.roster.preparedCharacters.find(actor=>actor.characterId===actorId);assert.ok(original);
  const old=t.journal.registerActorPiSession({runId,actorId,sessionId:'old-A',sessionPath:join(t.f.base.directory,'old-A.jsonl'),preparedContextHash:configuratorValueHash(original),profile:DEFAULT_INFERENCE_PROFILE}).session;
  t.configure();const request=t.request();t.accept(request);const promoted=t.journal.applyIdentityPromotion(request);const config=t.journal.readWorldConfiguration({runId});assert.ok(config);const actor=promoted.receipt;
  assert.equal(t.journal.setWorldLifecycle({runId,expectedWorldRevision:promoted.receipt.target.worldRevision,expectedConfigRevision:promoted.receipt.target.configurationRevision,target:'running'}),'updated');
  const pulseId=randomUUID();t.journal.configureRun({runId,maxCalls:20});t.journal.configurePulse({runId,pulseId,maxCalls:10});const scheduled=t.journal.scheduleActorTurnJob({runId,actorId,pulseId});assert.equal(scheduled.kind,'scheduled');if(scheduled.kind!=='scheduled')assert.fail();
  const lease={ownerToken:randomUUID(),claimToken:randomUUID()};const scope={runId,actorId,pulseId,jobId:scheduled.job.jobId,generation:scheduled.job.generation};const claimed=t.journal.claimActorTurnJob({runId,actorId,jobId:scope.jobId,generation:scope.generation,...lease});assert.equal(claimed.kind,'claimed');if(claimed.kind!=='claimed'||claimed.job.frozenWorldCut===null)assert.fail();const execution={...scope,lease};
  const prepared=t.journal.readRunConfigurationAtCommit({runId,commitIndex:actor.target.commitIndex});assert.equal(prepared.kind,'found');if(prepared.kind!=='found')assert.fail();
  const epoch=t.journal.readActorIdentityEpochs({runId,actorId}).at(-1);assert.ok(epoch);const registration={runId,actorId,sessionId:'new-B',sessionPath:join(t.f.base.directory,'new-B.jsonl'),preparedContextHash:epoch.preparedContextHash,profile:DEFAULT_INFERENCE_PROFILE};
  assert.throws(()=>t.journal.registerActorPiSession(registration),/EXECUTION_REQUIRED/);
  assert.throws(()=>t.journal.registerActorPiSession({...registration,execution,sessionId:old.sessionId,sessionPath:old.sessionPath}),/NOT_INDEPENDENT/);
  const fresh=t.journal.registerActorPiSession({...registration,execution});assert.equal(fresh.kind,'stored');assert.equal(t.journal.checkActorJobEligibility(execution).kind,'active');
  const candidate={kind:'terminal-candidate',candidateId:randomUUID(),turnId:randomUUID(),runId,actorId,scope:{runId,pulseId,jobId:scope.jobId,generation:scope.generation},lease,base:old,outcome:'failed',lastRequestSeq:null,candidateLeafId:null,inputCut:claimed.job.frozenWorldCut};
  assert.throws(()=>t.journal.recordActorPiCandidate(candidate),/checkpoint distinto/);
  const rotated=t.journal.rotateUnacceptedActorPiSession({runId,actorId,execution,expected:fresh.session,sessionId:'new-B-rotated',sessionPath:join(t.f.base.directory,'new-B-rotated.jsonl')});assert.equal(rotated.kind,'rotated');assert.equal(t.inspect(db=>db.prepare('SELECT COUNT(*) AS n FROM actor_identity_session_bindings WHERE epoch_index=1').get()?.n),2);
  assert.throws(()=>t.journal.rotateUnacceptedActorPiSession({runId,actorId,execution,expected:rotated.session,sessionId:fresh.session.sessionId,sessionPath:fresh.session.sessionPath}),/NOT_INDEPENDENT/);
  assert.throws(()=>t.journal.recordActorPiCandidate({...candidate,candidateId:randomUUID(),base:fresh.session}),/checkpoint distinto/);
  assert.equal(t.journal.recordActorPiCandidate({...candidate,candidateId:randomUUID(),base:rotated.session}),'stored');
  const bindingBefore=t.inspect(db=>db.prepare('SELECT * FROM actor_job_identity_bindings').all());const replacementLease={ownerToken:randomUUID(),claimToken:randomUUID()};
  assert.equal(t.journal.recoverAbandonedActorTurnJobClaims({ownerToken:replacementLease.ownerToken}),1);
  const human=t.f.source.configuration.humanParticipants[0];assert.ok(human);const world=t.journal.loadWorld({runId});assert.ok(world);
  const intervention=t.journal.commitHumanIntervention({runId,participantId:human.identity.participantId,expectedRevision:world.revision,idempotencyKey:randomUUID(),request:{kind:'speech',recipientCharacterIds:[actorId],channelId:human.presence.channelId,content:{kind:'speech',text:'Avance real de la fixture mientras el claim abandonado conserva su corte.'}}});assert.ok(intervention.kind!=='idempotencyConflict'&&intervention.kind!=='invalidLifecycle'&&intervention.resolution.kind==='applied');
  const reclaimed=t.journal.claimActorTurnJob({runId,actorId,jobId:scope.jobId,generation:scope.generation,...replacementLease});assert.equal(reclaimed.kind,'claimed');if(reclaimed.kind!=='claimed')assert.fail();assert.deepEqual(reclaimed.job.frozenWorldCut,claimed.job.frozenWorldCut);assert.deepEqual(t.inspect(db=>db.prepare('SELECT * FROM actor_job_identity_bindings').all()),bindingBefore);
  assert.deepEqual(t.journal.checkActorJobEligibility({...scope,lease:replacementLease}),{kind:'inactive',reason:'input_cut_obsolete'});
  t.reopen();assert.deepEqual(t.journal.loadActorPiSession({runId,actorId}),rotated.session);assert.deepEqual(t.journal.loadActorPiSessionAtEpoch({runId,actorId,epochIndex:0}),old);
 }finally{t.close();}
});

for(const fault of ['missing-archive','archive-hash','head-diverged','epochs-missing','binding-hash'] as const)test(`época reservada ${fault} falla cerrada en lugar de inventar sesión nueva`,async()=>{
 const t=await fixture();try{
  const runId=t.f.source.snapshot.runId;const actorId=t.f.characterId;const prepared=t.f.source.configuration.roster.preparedCharacters.find(actor=>actor.characterId===actorId);assert.ok(prepared);
  t.journal.registerActorPiSession({runId,actorId,sessionId:'old-A',sessionPath:join(t.f.base.directory,'old-A.jsonl'),preparedContextHash:configuratorValueHash(prepared),profile:DEFAULT_INFERENCE_PROFILE});t.configure();const request=t.request();t.accept(request);t.journal.applyIdentityPromotion(request);
  t.inspect(db=>{
   if(fault==='missing-archive'){db.exec('DROP TRIGGER actor_pi_session_archives_no_delete;DELETE FROM actor_pi_session_archives');}
   if(fault==='archive-hash'){db.exec("DROP TRIGGER actor_pi_session_archives_no_update;UPDATE actor_pi_session_archives SET row_hash='bad'");}
   if(fault==='head-diverged')db.exec("UPDATE actor_pi_sessions SET session_path='/wrong-head'");
   if(fault==='epochs-missing')db.exec('PRAGMA foreign_keys=OFF;DROP TRIGGER actor_identity_epochs_no_delete;DELETE FROM actor_identity_epochs');
   if(fault==='binding-hash')db.exec("DROP TRIGGER actor_identity_session_bindings_no_update;UPDATE actor_identity_session_bindings SET payload_hash='bad'");
  });
  assert.throws(()=>t.journal.loadActorPiSession({runId,actorId}));t.reopen();assert.throws(()=>t.journal.loadActorPiSession({runId,actorId}));
 }finally{t.close();}
});

test('fallo al guardar checkpoint final revierte configuración, epoch, archivo, receipt y commit juntos',async()=>{
 const t=await fixture();try{
  const request=t.request();t.accept(request);t.configure();const before=t.journal.loadWorld({runId:t.f.source.snapshot.runId});const tableNames=['world_runs','world_commits','run_configuration_revisions','actor_identity_epochs','actor_identity_session_bindings','actor_pi_session_archives','identity_promotion_receipts','actor_state_cut_batches','actor_state_cuts'];
  const read=()=>t.inspect(db=>Object.fromEntries(tableNames.map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()])));const rows=read();t.inspect(db=>db.exec("CREATE TRIGGER fail_cut BEFORE INSERT ON actor_state_cut_batches BEGIN SELECT RAISE(ABORT,'CONTROLLED_FINAL_CUT_FAILURE');END"));
  assert.throws(()=>t.journal.applyIdentityPromotion(request),/CONTROLLED_FINAL_CUT_FAILURE/);assert.deepEqual(read(),rows);assert.deepEqual(t.journal.loadWorld({runId:t.f.source.snapshot.runId}),before);t.inspect(db=>db.exec('DROP TRIGGER fail_cut'));assert.equal(t.journal.applyIdentityPromotion(request).kind,'applied');
 }finally{t.close();}
});

test('vista de preparación muestra identidad efectiva sin reescribir borrador original y bloquea PATCH/validate ordinarios',async()=>{
 const t=await fixture();try{
  const runId=t.f.source.snapshot.runId;const recordedAt='2026-10-15T00:00:00Z';const configuration=t.f.source.configuration;
  const fields=['name','fictionalAt','continuity','roster','humanParticipants','worldSnapshot','dramaticLine','circadianPolicy','spanishVariety','narrationMode','inferenceProfile','budget','maxReformulations','audio'] as const;
  const configured=Object.fromEntries(fields.flatMap(field=>configuration[field]===undefined?[]:[[field,{kind:'configured',value:configuration[field],evidence:{kind:'operator-choice',operatorId:'original-operator',recordedAt}}]]));
  const draft=RunConfigurationDraftSchema.parse({...createEmptyRunConfigurationDraft({runId,revision:configuration.configRevision}),...configured});const history={draft,principalId:'original-operator',recordedAt};
  t.inspect(db=>{db.prepare('INSERT INTO run_configuration_drafts VALUES(?,?,?,?)').run(runId,draft.revision,recordedAt,recordedAt);db.prepare('INSERT INTO run_configuration_draft_history VALUES(?,?,?,?,?,?)').run(runId,draft.revision,history.principalId,recordedAt,canonical(history),configuratorValueHash(history));});
  const oldRows=t.inspect(db=>db.prepare('SELECT * FROM run_configuration_draft_history').all());t.configure();const request=t.request();t.accept(request);t.journal.applyIdentityPromotion(request);
  const current=t.journal.readRunConfigurationDraft({runId});assert.ok(current);assert.equal(current.revision,draft.revision);assert.equal(current.roster.kind,'configured');if(current.roster.kind!=='configured')assert.fail();
  const actor=current.roster.value.preparedCharacters.find(actor=>actor.characterId===t.f.characterId);assert.ok(actor);assert.equal(actor.identityVersion,request.proposal.kind==='identity-promotion-proposal'?request.proposal.expectedIdentityVersion+1:assert.fail());assert.deepEqual(actor.identity.value,request.proposal.kind==='identity-promotion-proposal'?request.proposal.identity:assert.fail());assert.equal(current.roster.evidence.kind,'host-derived');assert.deepEqual(current.name,draft.name);
  assert.equal(t.journal.readRunConfigurationDraftState({runId})?.editability,'identity-promoted');assert.deepEqual(t.journal.readRunConfigurationDraft({runId,revision:draft.revision}),draft);assert.deepEqual(t.inspect(db=>db.prepare('SELECT * FROM run_configuration_draft_history').all()),oldRows);
  const before=t.journal.loadWorld({runId});assert.deepEqual(t.journal.updateRunConfigurationDraft({principalId:request.principalId,idempotencyKey:randomUUID(),runId,expectedRevision:draft.revision,patch:{name:{kind:'configured',value:'Must not replace promoted identity',evidence:{kind:'operator-choice',operatorId:request.principalId,recordedAt}}}}),{kind:'readonly',reason:'identity-promoted'});
  assert.deepEqual(t.journal.validateRunConfigurationDraft({principalId:request.principalId,idempotencyKey:randomUUID(),runId,expectedRevision:draft.revision}),{kind:'readonly',reason:'identity-promoted'});assert.deepEqual(t.journal.loadWorld({runId}),before);assert.deepEqual(t.inspect(db=>db.prepare('SELECT * FROM run_configuration_draft_history').all()),oldRows);
 }finally{t.close();}
});

for(const work of ['delivery','memory-projection','uncertain-request'] as const)test(`promoción no cruza frontera con ${work} pendiente ni modifica sus pruebas`,async()=>{
 const t=await fixture();try{
  const request=t.request();t.accept(request);t.configure();
  t.inspect(db=>{
   if(work==='delivery')db.exec("UPDATE world_deliveries SET state='planned',delivered_at=NULL WHERE perception_id=(SELECT perception_id FROM world_deliveries LIMIT 1)");
   if(work==='memory-projection')db.exec('INSERT INTO memory_outbox(experience_id,created_at) SELECT experience_id,0 FROM experiences LIMIT 1');
   if(work==='uncertain-request'){
    const runId=t.f.source.snapshot.runId;const pulseId=randomUUID();db.prepare('INSERT INTO run_budgets(run_id,max_calls) VALUES(?,?)').run(runId,20);db.prepare('INSERT INTO pulses(pulse_id,run_id,max_calls) VALUES(?,?,?)').run(pulseId,runId,10);db.prepare('INSERT INTO request_reservations VALUES(?,?,?,?,?,?)').run(randomUUID(),0,0,runId,pulseId,'ambiguous');
   }
  });
  const before=t.journal.loadWorld({runId:t.f.source.snapshot.runId});assert.throws(()=>t.journal.applyIdentityPromotion(request),/WORK_PENDING/);assert.deepEqual(t.journal.loadWorld({runId:t.f.source.snapshot.runId}),before);assert.equal(t.inspect(db=>db.prepare('SELECT COUNT(*) AS n FROM identity_promotion_receipts').get()?.n),0);assert.equal(t.authorizations,0);
 }finally{t.close();}
});

test('otro Configurador queued/running bloquea promoción; propuesta propia ya aceptada permite publicarla',async()=>{
 const t=await fixture();try{
  const request=t.request();assert.equal(request.context.scope.kind,'evolution');if(request.context.scope.kind!=='evolution')assert.fail();t.accept(request);t.configure();
  const ownId=request.context.scope.scope.jobId;const otherId=randomUUID();
  function store(jobId:string,state:'queued'|'running'|'accepted'){
   const metadata={job_id:jobId,principal_id:request.principalId,run_id:t.f.source.snapshot.runId,actor_id:t.f.characterId};const payload={job:{state}};
   t.inspect(db=>db.prepare('INSERT OR REPLACE INTO configurator_jobs VALUES(?,?,?,?,?,?)').run(jobId,metadata.principal_id,metadata.run_id,metadata.actor_id,canonical(payload),configuratorValueHash({metadata,payload})));
  }
  store(ownId,'accepted');store(otherId,'queued');assert.throws(()=>t.journal.applyIdentityPromotion(request),/WORK_PENDING/);store(otherId,'running');assert.throws(()=>t.journal.applyIdentityPromotion(request),/WORK_PENDING/);store(otherId,'accepted');assert.equal(t.journal.applyIdentityPromotion(request).kind,'applied');
 }finally{t.close();}
});

test('primera promoción reserva baseline de todos los preparados sin abrir sesiones ni cambiar actores no promovidos',async()=>{
 const t=await fixture();try{
  const request=t.request();t.accept(request);t.configure();t.journal.applyIdentityPromotion(request);const runId=t.f.source.snapshot.runId;const other=t.f.source.configuration.roster.preparedCharacters.find(actor=>actor.characterId!==t.f.characterId);assert.ok(other);
  const epochs=t.journal.readActorIdentityEpochs({runId,actorId:other.characterId});assert.equal(epochs.length,1);assert.equal(epochs[0]?.epochIndex,0);assert.equal(epochs[0]?.configurationHash,request.context.scope.kind==='evolution'?request.context.scope.anchor.source.configurationHash:assert.fail());assert.equal(epochs[0]?.identityVersion,other.identityVersion);assert.equal(t.journal.loadActorPiSession({runId,actorId:other.characterId}),undefined);
  assert.equal(t.inspect(db=>db.prepare('SELECT COUNT(*) AS n FROM actor_pi_sessions').get()?.n),0);assert.equal(t.inspect(db=>db.prepare('SELECT COUNT(*) AS n FROM actor_pi_session_archives').get()?.n),0);
  t.inspect(db=>{db.exec('DROP TRIGGER actor_identity_epochs_no_delete');db.prepare('DELETE FROM actor_identity_epochs WHERE actor_id=?').run(other.characterId);});assert.throws(()=>t.journal.loadActorPiSession({runId,actorId:other.characterId}),/EPOCH_MISSING/);
 }finally{t.close();}
});

test('consentimiento aceptado antes de ciclo pause/resume no se reactiva cambiando sólo CAS del body',async()=>{
 const t=await fixture();try{
  const request=t.request();t.accept(request);t.configure();const runId=t.f.source.snapshot.runId;
  assert.equal(t.journal.setWorldLifecycle({runId,expectedWorldRevision:request.expectedWorldRevision,expectedConfigRevision:t.f.source.configuration.configRevision,target:'running'}),'updated');assert.equal(t.journal.setWorldLifecycle({runId,expectedWorldRevision:request.expectedWorldRevision,expectedConfigRevision:t.f.source.configuration.configRevision,target:'paused'}),'updated');
  const current=t.journal.readWorldLifecycle({runId});assert.ok(current);assert.notEqual(current.lifecycleRevision,request.expectedLifecycleRevision);assert.throws(()=>t.journal.applyIdentityPromotion({...request,expectedLifecycleRevision:current.lifecycleRevision}),/STALE/);assert.equal(t.authorizations,0);assert.equal(t.journal.readIdentityPromotionHistory({runId}).length,0);
 }finally{t.close();}
});
