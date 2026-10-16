import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {backup,DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {loadCatalog,type LoadedCatalog} from '../src/adapters/catalog.ts';
import {PiRuntime} from '../src/adapters/pi.ts';
import {createIcmMemoryAdapter} from '../src/adapters/icm.ts';
import {createIdentityPromotionApplication} from '../src/application/identity-promotion-application.ts';
import {openLocalHost} from '../src/application/local-host.ts';
import {createDeliverWorldWorker} from '../src/application/deliver-world.ts';
import {createProjectMemoryWorker} from '../src/application/project-memory.ts';
import {identityPromotionContextEtag} from '../src/domain/identity-promotion-http.ts';
import {HashSchema} from '../src/domain/values.ts';
import {configuratorValueHash} from '../src/application/configurator-context.ts';
import {freezeExperience} from '../src/application/experience-envelope.ts';
import type {IdentityPromotionAuthority} from '../src/server/identity-promotion-routes.ts';
import {configuratorEvolutionFixture} from './fixtures/configurator-evolution.ts';
import {controlledConfiguratorSessionFactory,configuratorSessionStats} from './fixtures/configurator-session.ts';
import {openConfiguratorJobLedger} from '../src/adapters/configurator-job-ledger.ts';
import {createIcmWorkspaceSnapshot,hashIcmMarkdown,type IcmWorkspaceSnapshot} from '../src/domain/icm-workspace.ts';
import {actorId} from './fixtures/continuista.ts';
const binaryPath=process.env.PERSONAJES_ICM_TEST_BINARY;
const real={skip:binaryPath===undefined?'ICM real requerido para vaciar entregas y proyecciones legítimamente':false};

function forgetHttpResponse(host:ReturnType<typeof openLocalHost>,principalId:string,key:string){const db=new DatabaseSync(join(host.privateDataRoot,'world.sqlite'));try{db.prepare('UPDATE configurator_http_operations SET result_json=NULL,result_hash=NULL WHERE principal_id=? AND idempotency_key=?').run(principalId,key);const row=db.prepare('SELECT * FROM configurator_http_operations WHERE principal_id=? AND idempotency_key=?').get(principalId,key);assert.ok(row);const {record_hash,...rest}=row;void record_hash;db.prepare('UPDATE configurator_http_operations SET record_hash=? WHERE principal_id=? AND idempotency_key=?').run(configuratorValueHash(rest),principalId,key);}finally{db.close();}}
function deferred(){function signal(){let resolve:()=>void=()=>{};const promise=new Promise<void>(done=>{resolve=done;});return {resolve,promise};}return {entered:signal(),wait:signal()};}

async function fixture(options:{omitProposal?:boolean;incomplete?:boolean;noLease?:boolean;promptGate?:ReturnType<typeof deferred>;icmWorkspace?:IcmWorkspaceSnapshot}={}){
 assert.ok(binaryPath);const f=await configuratorEvolutionFixture(options.icmWorkspace===undefined?{}:{icmWorkspace:options.icmWorkspace});const root=join(f.base.directory,'manager');mkdirSync(root);const db=new DatabaseSync(f.journalPath);try{await backup(db,join(root,'world.sqlite'));}finally{db.close();}
 const host=openLocalHost({privateDataRoot:root});const runId=f.source.snapshot.runId;
 for(const actor of f.source.snapshot.entities.filter(entity=>entity.kind==='character')){
  assert.equal((await createDeliverWorldWorker({journal:host.journal,runId,actorId:actor.characterId}).drain()).kind,'completed');
  const adapter=await createIcmMemoryAdapter({privateDataRoot:host.privateDataRoot,runId,actorId:actor.characterId,binaryPath,ledger:{findReceipt:request=>host.journal.findReceipt(request)}});
  assert.equal((await createProjectMemoryWorker({journal:host.journal,projector:adapter.projector,runId,actorId:actor.characterId}).drain({maxItems:100})).kind,'completed');
 }
 const current=host.journal.loadWorld({runId});assert.ok(current);host.journal.setWorldLifecycle({runId,expectedWorldRevision:current.revision,expectedConfigRevision:f.source.configuration.configRevision,target:'paused'});
 const realCatalog=await loadCatalog({repositoryRoot:process.cwd()});const entry=realCatalog.manifest.characters.find(actor=>actor.characterId==='maxwell-smart');assert.ok(entry);
 const catalog:LoadedCatalog={...realCatalog,manifest:{...realCatalog.manifest,characters:[{...entry,characterId:f.characterId,displayName:f.originalDossier.displayName}]}};
 const runtime=await PiRuntime.create({privateDataRoot:host.privateDataRoot});const stats=configuratorSessionStats();let leases=0,releases=0;
 const authority:IdentityPromotionAuthority={principalId:'manager-operator',mode:{kind:'director',runId,scope:{kind:'run'}},inspectionRunIds:[runId]};
 const voiceRuns:string[]=[];let voiceReleased=0;
 const controlled=controlledConfiguratorSessionFactory({root:host.privateDataRoot,stats,...(options.omitProposal?{omitProposal:true}:{}),...(options.incomplete?{incomplete:true}:{})});
 const app=createIdentityPromotionApplication({host,runtime,catalog,...(options.noLease?{}:{representation:{async suspendRunAdmissions(){leases++;let released=false;return ()=>{if(!released){released=true;releases++;}};}}}),voices:{async suspendRunAdmissions({runId}){voiceRuns.push(runId);return ()=>{voiceReleased++;};}},sessionFactory:async input=>{const session=await controlled(input);const gate=options.promptGate;if(gate===undefined)return session;return {...session,async prompt(input){gate.entered.resolve();await gate.wait.promise;return session.prompt(input);},async abortAndDispose(){gate.wait.resolve();await session.abortAndDispose();}};}});
 function start(){const context=app.context({runId,authority});return {runId,authority,idempotencyKey:randomUUID(),ifMatch:identityPromotionContextEtag(context),body:{actorId:f.characterId,expectedLifecycleRevision:context.lifecycleRevision,expectedCommitIndex:context.commitIndex,expectedWorldRevision:context.worldRevision,expectedWorldSeq:context.worldSeq,expectedConfigurationRevision:context.configurationRevision}};}
 return {f,host,app,catalog,runtime,stats,authority,runId,start,voiceRuns,get voiceReleased(){return voiceReleased;},get leases(){return leases;},get releases(){return releases;},async close(){await app.close();host.close();f.close();}};
}

test('manager metadata construction and reads never invoke inference, and independent inspection/director authority is enforced',real,async()=>{
 const f=await fixture();try{
  const context=f.app.context({runId:f.runId,authority:f.authority});assert.equal(context.canWrite,true);assert.equal(f.app.list({runId:f.runId,authority:f.authority}).items.length,0);assert.equal(f.stats.sessions,0);assert.equal(f.app.readJob({jobId:randomUUID(),authority:f.authority}),undefined);
  const request=f.start();await assert.rejects(f.app.start({...request,authority:{...f.authority,mode:{kind:'observer'}}}),/DIRECTOR_REQUIRED/);await assert.rejects(f.app.start({...request,authority:{...f.authority,inspectionRunIds:[]}}),/INSPECTION_REQUIRED/);assert.equal(f.stats.sessions,0);
  const source=f.host.journal.loadWorld({runId:f.runId});const begun=await f.app.start(request);assert.equal(begun.state,'queued');assert.equal('principalId'in begun,false);await f.app.waitForIdle();const job=f.app.readJob({jobId:begun.jobId,authority:f.authority});assert.equal(job?.state,'accepted');assert.equal(f.stats.sessions,1);assert.equal(f.stats.disposed,1);assert.deepEqual(f.host.journal.loadWorld({runId:f.runId}),source);assert.equal(job?.promotion.kind,'not-applied');
  assert.equal(f.app.readJob({jobId:begun.jobId,authority:{...f.authority,principalId:'foreign'}}),undefined);assert.throws(()=>f.app.readReview({jobId:begun.jobId,authority:{...f.authority,inspectionRunIds:[]}}),/INSPECTION_REQUIRED/);const review=f.app.readReview({jobId:begun.jobId,authority:{...f.authority,mode:{kind:'observer'}}});assert.ok(review.proposal);assert.equal(JSON.stringify(review.context).includes('SECRET_PRIVATE_OTHER_MEMORY'),false);
  assert.deepEqual(await f.app.start(request),begun);assert.equal(f.stats.sessions,1);
 }finally{await f.close();}
});

test('manager applies accepted proof with explicit consent only under runtime lease, and immutable HTTP replay survives source change',real,async()=>{
 const f=await fixture();try{const start=f.start();const begun=await f.app.start(start);await f.app.waitForIdle();const review=f.app.readReview({jobId:begun.jobId,authority:f.authority});assert.ok(review.proposalHash);assert.equal(review.job.state,'accepted');const head=f.app.context({runId:f.runId,authority:f.authority});const request={jobId:begun.jobId,authority:f.authority,expectedRevision:review.job.revision,idempotencyKey:randomUUID(),body:{contextHash:review.job.contextHash,proposalHash:review.proposalHash,targetFullHash:review.targetFullHash,expectedLifecycleRevision:head.lifecycleRevision,expectedCommitIndex:head.commitIndex,expectedWorldRevision:head.worldRevision}};
  await assert.rejects(f.app.approve({...request,idempotencyKey:randomUUID(),body:{...request.body,proposalHash:HashSchema.parse('0'.repeat(64))}}),/CONSENT_HASH_MISMATCH/);assert.equal(f.leases,0);const approved=await f.app.approve(request);assert.equal(approved.promotion.kind,'applied');assert.equal(f.leases,1);assert.equal(f.releases,1);assert.deepEqual(f.voiceRuns,[f.runId]);assert.equal(f.voiceReleased,1);if(approved.promotion.kind==='applied'){assert.equal('principalId'in approved.promotion.receipt,false);assert.equal('approval'in approved.promotion.receipt,false);assert.equal('authority'in approved.promotion.receipt,false);assert.equal(approved.promotion.receipt.identityVersion,2);}
  forgetHttpResponse(f.host,f.authority.principalId,request.idempotencyKey);assert.deepEqual(await f.app.approve(request),approved);assert.equal(f.leases,1);forgetHttpResponse(f.host,f.authority.principalId,start.idempotencyKey);f.catalog.manifest.characters.splice(0);assert.deepEqual(await f.app.start(start),begun);assert.equal(f.stats.sessions,1);await assert.rejects(f.app.reject({jobId:begun.jobId,authority:f.authority,expectedRevision:review.job.revision,idempotencyKey:randomUUID()}),/ALREADY_APPLIED/);await assert.rejects(f.app.approve({...request,idempotencyKey:randomUUID()}),/ALREADY_APPLIED/);
 }finally{await f.close();}
});

test('manager aplica Configurador ICM dentro de la transacción y verifica su fuente histórica después de promover',real,async()=>{
 const audiences=[{role:'actor' as const,actorId},...(['continuista','director','configurator'] as const).map(role=>({role}))];
 const icmWorkspace=createIcmWorkspaceSnapshot({sources:audiences.map(audience=>({sourceId:`synthetic.${audience.role}`,audience,revision:0,
  sourceHash:hashIcmMarkdown(audience.role),sections:[{sectionId:'process',markdown:`ICM_PRIVATE_${audience.role}`}]}))});
 const f=await fixture({icmWorkspace});
 try{
  const begun=await f.app.start(f.start());await f.app.waitForIdle();
  const review=f.app.readReview({jobId:begun.jobId,authority:f.authority});assert.equal(review.job.state,'accepted');assert.ok(review.proposalHash);
  const head=f.app.context({runId:f.runId,authority:f.authority});
  const request={jobId:begun.jobId,authority:f.authority,expectedRevision:review.job.revision,idempotencyKey:randomUUID(),
   body:{contextHash:review.job.contextHash,proposalHash:review.proposalHash,targetFullHash:review.targetFullHash,
    expectedLifecycleRevision:head.lifecycleRevision,expectedCommitIndex:head.commitIndex,expectedWorldRevision:head.worldRevision}};
  const approved=await f.app.approve(request);assert.equal(approved.promotion.kind,'applied');
  assert.deepEqual(await f.app.approve(request),approved);assert.equal(f.stats.requests,2);
  const ledger=openConfiguratorJobLedger({journalPath:join(f.host.privateDataRoot,'world.sqlite'),privateDataRoot:f.host.privateDataRoot,ownerToken:randomUUID(),
   host:{readHead(){throw new Error('Historical acceptance must not consult current head');},readForkSource(){throw new Error('Historical acceptance must not start a host transaction');},assertIdle(){throw new Error('Historical acceptance is read-only');}}});
  try{
   const lookup={jobId:begun.jobId,principalId:f.authority.principalId};
   assert.equal(ledger.readAccepted(lookup)?.job.state,'accepted','the archived initial configuration remains the original packet authority');
   const inspected=f.host.journal.readIcmContextPacketInspection({runId:f.runId});assert.ok(inspected);
   assert.equal(inspected.configuration.kind,'configured');const packet=inspected.items[0];assert.ok(packet?.kind==='verified');
   assert.equal(packet.scope.configurationRevision,review.job.source.configurationRevision,'packet inspection uses its original configuration after promotion');
   if(inspected.configuration.kind!=='configured'||approved.promotion.kind!=='applied')assert.fail('Missing promoted ICM configuration');
   assert.equal(inspected.configuration.configurationRevision,approved.promotion.receipt.target.configurationRevision);
   assert.notEqual(packet.scope.configurationRevision,inspected.configuration.configurationRevision);
   const db=new DatabaseSync(join(f.host.privateDataRoot,'world.sqlite'));
   try{db.exec('DROP TRIGGER run_configuration_revisions_no_update');
    const original=db.prepare('SELECT * FROM run_configuration_revisions WHERE run_id=? AND effective_commit_index=0').get(f.runId);assert.ok(original);
    const {record_hash:originalRecordHash,...record}=original;
    const changed={...record,activation_snapshot_hash:'0'.repeat(64)};
    db.prepare('UPDATE run_configuration_revisions SET activation_snapshot_hash=?,record_hash=? WHERE run_id=? AND effective_commit_index=0')
      .run(changed.activation_snapshot_hash,configuratorValueHash(changed),f.runId);
    assert.throws(()=>ledger.readAccepted(lookup),/CONFIGURATOR_INPUT_SOURCE_MISMATCH/,'re-sealing the configuration record cannot replace its activation snapshot');
    db.prepare('UPDATE run_configuration_revisions SET activation_snapshot_hash=?,record_hash=? WHERE run_id=? AND effective_commit_index=0')
      .run(String(original.activation_snapshot_hash),String(originalRecordHash),f.runId);
    assert.equal(ledger.readAccepted(lookup)?.job.state,'accepted');
    db.prepare("UPDATE run_configuration_revisions SET configuration_hash=? WHERE run_id=? AND effective_commit_index=0").run('0'.repeat(64),f.runId);
   }finally{db.close();}
   assert.throws(()=>ledger.readAccepted(lookup),/CONFIGURATOR_INPUT_SOURCE_MISMATCH/,'a valid packet cannot replace corrupted historical configuration authority');
   assert.equal(f.host.journal.readIcmContextPacketInspection({runId:f.runId})?.items[0]?.kind,'corrupt');
   assert.equal(f.stats.requests,2);
  }finally{ledger.close();}
 }finally{await f.close();}
});

test('manager refuses approval without a composed runtime lease and does not manufacture consent or identity changes',real,async()=>{
 const f=await fixture({noLease:true});try{const begun=await f.app.start(f.start());await f.app.waitForIdle();const review=f.app.readReview({jobId:begun.jobId,authority:f.authority}),head=f.app.context({runId:f.runId,authority:f.authority});assert.ok(review.proposalHash);await assert.rejects(f.app.approve({jobId:begun.jobId,authority:f.authority,expectedRevision:review.job.revision,idempotencyKey:randomUUID(),body:{contextHash:review.job.contextHash,proposalHash:review.proposalHash,targetFullHash:review.targetFullHash,expectedLifecycleRevision:head.lifecycleRevision,expectedCommitIndex:head.commitIndex,expectedWorldRevision:head.worldRevision}}),/RUNTIME_LEASE_UNAVAILABLE/);assert.equal(f.host.journal.readIdentityPromotionHistory({runId:f.runId}).length,0);const db=new DatabaseSync(join(f.host.privateDataRoot,'world.sqlite'));try{assert.equal(db.prepare('SELECT COUNT(*) n FROM configurator_consents').get()?.n,0);}finally{db.close();}}
 finally{await f.close();}
});

test('manager retry starts a new generation once; cached retry and source-dossier begin replay never trigger inference',real,async()=>{
 const f=await fixture({omitProposal:true});try{const request=f.start(),begun=await f.app.start(request);await f.app.waitForIdle();const failed=f.app.readJob({jobId:begun.jobId,authority:f.authority});assert.equal(failed?.state,'failed');assert.ok(failed);const retry={jobId:begun.jobId,authority:f.authority,expectedRevision:failed.revision,idempotencyKey:randomUUID()};const queued=await f.app.retry(retry);assert.equal(queued.generation,1);await f.app.waitForIdle();assert.equal(f.stats.sessions,2);forgetHttpResponse(f.host,f.authority.principalId,retry.idempotencyKey);assert.deepEqual(await f.app.retry(retry),queued);assert.equal(f.stats.sessions,2);
  forgetHttpResponse(f.host,f.authority.principalId,request.idempotencyKey);
  f.catalog.manifest.characters.splice(0);assert.deepEqual(await f.app.start(request),begun);assert.equal(f.stats.sessions,2);
 }finally{await f.close();}
});

test('manager suspension rejects new writes and releases explicitly without creating queued work',real,async()=>{
 const f=await fixture();try{const release=await f.app.suspendAdmissions();await assert.rejects(f.app.start(f.start()),/ADMISSIONS_SUSPENDED/);assert.equal(f.stats.sessions,0);release();assert.equal(f.stats.sessions,0);const begun=await f.app.start(f.start());await f.app.waitForIdle();const job=f.app.readJob({jobId:begun.jobId,authority:f.authority});assert.ok(job);const rejected=await f.app.reject({jobId:job.jobId,authority:f.authority,expectedRevision:job.revision,idempotencyKey:randomUUID()});assert.equal(rejected.state,'rejected');assert.equal(rejected.failureCode,'CONFIGURATOR_REJECTED');assert.equal(f.stats.sessions,1);}
 finally{await f.close();}
});


test('manager cancellation invalidates eligibility before abort and waits for actual SDK disposal, with immutable duplicate acknowledgment',real,async()=>{
 const gate=deferred();const f=await fixture({promptGate:gate});try{
  const begun=await f.app.start(f.start());await gate.entered.promise;const running=f.app.readJob({jobId:begun.jobId,authority:f.authority});assert.ok(running);assert.equal(running.state,'running');assert.equal(f.stats.disposed,0);const request={jobId:begun.jobId,authority:f.authority,expectedRevision:running.revision,idempotencyKey:randomUUID()};const [first,duplicate]=await Promise.all([f.app.cancel(request),f.app.cancel(request)]);assert.deepEqual(first,duplicate);assert.equal(first.state,'cancelled');assert.equal(first.failureCode,'CONFIGURATOR_CANCELLED');assert.equal(f.stats.disposed,1);assert.equal(f.stats.requests,0);await f.app.waitForIdle();assert.equal(f.app.readJob({jobId:begun.jobId,authority:f.authority})?.state,'cancelled');assert.deepEqual(await f.app.cancel(request),first);assert.equal(f.stats.sessions,1);
 }finally{gate.wait.resolve();await f.close();}
});


test('manager preserves pending memory work and refuses a new job without projecting or deleting it',real,async()=>{
 const f=await fixture();try{const world=f.host.journal.loadWorld({runId:f.runId});assert.ok(world);f.host.journal.recordExperience(freezeExperience({schemaVersion:1,experienceId:randomUUID(),runId:f.runId,actorId:f.f.characterId,kind:'belief',content:'Recuerdo sintético pendiente de proyección explícita.',sourceRefs:[],fictitiousAt:world.clock.instant,receivedAt:world.clock.instant,worldSeq:world.seq,confidence:0.5,revision:0,predecessor:{kind:'initial'},basedOn:[]}));const db=new DatabaseSync(join(f.host.privateDataRoot,'world.sqlite'));try{const before=db.prepare('SELECT * FROM memory_outbox').all();assert.ok(before.length>0);await assert.rejects(f.app.start(f.start()),/WORK_PENDING/);assert.deepEqual(db.prepare('SELECT * FROM memory_outbox').all(),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM configurator_jobs').get()?.n,0);assert.equal(f.stats.sessions,0);}finally{db.close();}}
 finally{await f.close();}
});
