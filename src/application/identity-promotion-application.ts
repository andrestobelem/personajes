import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {readDossier,type LoadedCatalog} from '../adapters/catalog.ts';
import {openConfiguratorJobLedger} from '../adapters/configurator-job-ledger.ts';
import {openConfiguratorHttpOperations} from '../adapters/configurator-http-operations.ts';
import type {CreatePiSessionInput,PiRuntime,PiSessionHandle} from '../adapters/pi.ts';
import {type ConfiguratorJobView} from '../domain/configurator-jobs.ts';
import {ForkSourceSchema} from '../domain/fork-origin.ts';
import {IdentityPromotionContextViewSchema,IdentityPromotionHeadSchema,IdentityPromotionJobPageSchema,IdentityPromotionJobViewSchema,IdentityPromotionPublicReceiptSchema,IdentityPromotionReviewSchema,identityPromotionContextEtag} from '../domain/identity-promotion-http.ts';
import {IdentityPromotionResultSchema,IdentityPromotionReceiptSchema} from '../domain/identity-promotion.ts';
import {RunIdSchema} from '../domain/values.ts';
import type {IdentityPromotionApplicationPort,IdentityPromotionAuthority} from '../server/identity-promotion-routes.ts';
import {configuratorValueHash} from './configurator-context.ts';
import {readPreparedDossierSource} from './dossier-source-repository.ts';
import {createConfiguratorPiWorker} from './configurator-pi-worker.ts';
import type {openLocalHost} from './local-host.ts';
import {ReadyRunConfigurationSchema} from './production-preflight.ts';

type Release=()=>void;
type JobLookup={jobId:string;authority:IdentityPromotionAuthority};
type JobMutation=JobLookup&{expectedRevision:number;idempotencyKey:string};
/** Host-owned administrative workflow. Construction and reads perform no inference.
 * Only an explicit newly committed start/retry schedules one private Pi generation. */
export function createIdentityPromotionApplication(input:{host:ReturnType<typeof openLocalHost>;runtime:PiRuntime;catalog:LoadedCatalog;
 representation?:{suspendRunAdmissions(input:{runId:string}):Promise<Release>};voices?:{suspendRunAdmissions(input:{runId:string}):Promise<Release>};
 sessionFactory?:(input:CreatePiSessionInput)=>Promise<PiSessionHandle>;onCommitted?:(receipt:ReturnType<typeof IdentityPromotionReceiptSchema.parse>)=>void}){
 const journal=input.host.journal;const path=join(input.host.privateDataRoot,'world.sqlite');const db=new DatabaseSync(path,{readOnly:true});
 const leasedRuns=new Set<string>();const leasingRuns=new Set<string>();let closed=false,suspended=false;
 const active=new Map<string,{job:ConfiguratorJobView;controller:AbortController;promise:Promise<void>}>();
 function available(){if(closed)throw new Error('IDENTITY_PROMOTION_UNAVAILABLE');}
 function writable(){available();if(suspended)throw new Error('IDENTITY_PROMOTION_ADMISSIONS_SUSPENDED');}
 function director(authority:IdentityPromotionAuthority,runId:string){if(authority.mode.kind!=='director'||authority.mode.runId!==runId||authority.mode.scope.kind!=='run')throw new Error('IDENTITY_PROMOTION_DIRECTOR_REQUIRED');}
 function inspection(authority:IdentityPromotionAuthority,runId:string){if(!authority.inspectionRunIds.includes(runId))throw new Error('IDENTITY_PROMOTION_INSPECTION_REQUIRED');}
 function writeAuthority(authority:IdentityPromotionAuthority,runId?:string){
  if(authority.mode.kind!=='director'||authority.mode.scope.kind!=='run'||(runId!==undefined&&authority.mode.runId!==runId))throw new Error('IDENTITY_PROMOTION_DIRECTOR_REQUIRED');
  inspection(authority,authority.mode.runId);
 }
 function head(rawRunId:string){
  const runId=RunIdSchema.parse(rawRunId);const cut=journal.readInspectorWorldCut({runId});const metadata=journal.readWorldConfigurationMetadata({runId});const lifecycle=journal.readWorldLifecycle({runId});
  if(cut===undefined||metadata===undefined||lifecycle===undefined)throw new Error('IDENTITY_PROMOTION_NOT_FOUND');
  return {source:ForkSourceSchema.parse({runId,commitIndex:cut.commitIndex,worldRevision:cut.snapshot.revision,worldSeq:cut.snapshot.seq,snapshotHash:configuratorValueHash(cut.snapshot),configurationRevision:metadata.configurationRevision,configurationHash:metadata.configurationHash}),lifecycle:lifecycle.lifecycle,lifecycleRevision:lifecycle.lifecycleRevision};
 }
 function assertIdle(runId:string,allowOwnConfigurator=false){
  const checks=[
   "SELECT 1 FROM actor_turn_jobs WHERE run_id=? AND state IN('queued','running') LIMIT 1",
   "SELECT 1 FROM continuista_jobs WHERE run_id=? AND state IN('queued','running') LIMIT 1",
   "SELECT 1 FROM administrative_jobs WHERE run_id=? AND state='running' LIMIT 1",
   "SELECT 1 FROM world_proposals WHERE run_id=? AND status='pending' LIMIT 1",
   "SELECT 1 FROM actor_pi_candidates c LEFT JOIN actor_pi_turn_receipts r ON r.candidate_id=c.candidate_id WHERE c.run_id=? AND c.candidate_kind='terminal-candidate' AND c.outcome='completed' AND r.candidate_id IS NULL LIMIT 1",
   "SELECT 1 FROM run_step_jobs WHERE run_id=? AND state IN('queued','running') LIMIT 1",
   "SELECT 1 FROM coordinator_pulses WHERE run_id=? AND state='running' LIMIT 1",
   "SELECT 1 FROM run_preflight_jobs WHERE run_id=? AND state IN('queued','running','cancel-requested') LIMIT 1",
   "SELECT 1 FROM actor_activation_causes WHERE run_id=? AND state IN('pending','running') LIMIT 1",
   "SELECT 1 FROM actor_activation_invitations WHERE run_id=? AND state IN('pending','assigned') LIMIT 1",
   "SELECT 1 FROM world_deliveries d JOIN world_perceptions p ON p.perception_id=d.perception_id WHERE p.run_id=? AND d.state<>'delivered' LIMIT 1",
   "SELECT 1 FROM memory_outbox o JOIN experiences e ON e.experience_id=o.experience_id WHERE e.run_id=? LIMIT 1",
  ];
  for(const sql of checks)if(db.prepare(sql).get(runId)!==undefined)throw new Error('IDENTITY_PROMOTION_WORK_PENDING');
  const own=allowOwnConfigurator?" AND NOT EXISTS(SELECT 1 FROM configurator_jobs c WHERE c.job_id=r.job_id AND c.run_id=r.run_id AND json_extract(c.payload_json,'$.job.state')='running' AND json_extract(c.payload_json,'$.lease.ownerToken')=?)":'';
  for(const [table,states,uncertain] of [['request_reservations',"'reserved','dispatched','ambiguous'","'ambiguous'"],['model_time_spans',"'reserved','running','expired','uncertain'","'expired','uncertain'"]]){
   const sql=`SELECT 1 FROM ${table} r WHERE r.run_id=? AND (r.state IN(${uncertain}) OR (r.state IN(${states})${own})) LIMIT 1`;
   if((allowOwnConfigurator?db.prepare(sql).get(runId,input.host.ownerToken):db.prepare(sql).get(runId))!==undefined)throw new Error('IDENTITY_PROMOTION_WORK_PENDING');
  }
  if(!allowOwnConfigurator&&db.prepare("SELECT 1 FROM configurator_jobs WHERE run_id=? AND json_extract(payload_json,'$.job.state') IN('queued','running') LIMIT 1").get(runId)!==undefined)throw new Error('IDENTITY_PROMOTION_WORK_PENDING');
 }
 const ledger=openConfiguratorJobLedger({journalPath:path,privateDataRoot:input.host.privateDataRoot,ownerToken:input.host.ownerToken,host:{readHead:headInput=>head(headInput.runId),readForkSource:journal.readForkSource,assertIdle:request=>assertIdle(request.runId,true)}});
 const operations=(()=>{
  let opened:ReturnType<typeof openConfiguratorHttpOperations>|undefined;
  try{
   opened=openConfiguratorHttpOperations({journalPath:path});
   journal.configureIdentityPromotionPorts({requireAcceptedConfiguratorProposal:ledger.requireAcceptedConfiguratorProposal,assertIdentityPromotionRuntimeIdle({runId}){if(!leasedRuns.has(runId))throw new Error('IDENTITY_PROMOTION_RUNTIME_LEASE_REQUIRED');assertIdle(runId);}});
   ledger.recoverInterrupted();return opened;
  }catch(error){try{opened?.close();}finally{ledger.close();db.close();}throw error;}
 })();
 const worker=createConfiguratorPiWorker({ledger,journal,runtime:input.runtime,...(input.sessionFactory===undefined?{}:{sessionFactory:input.sessionFactory})});
 function lookup(request:JobLookup){available();return ledger.read({jobId:request.jobId,principalId:request.authority.principalId});}
 function applied(job:ConfiguratorJobView){return journal.readIdentityPromotionHistory({runId:job.runId,actorId:job.actorId}).find(receipt=>receipt.authority.jobId===job.jobId&&receipt.principalId===job.principalId);}
 function publicJob(job:ConfiguratorJobView,includePromotion=true){
  const {principalId,failureCode,...rest}=job;void principalId;const promotion=includePromotion?applied(job):undefined;const publicReceipt=promotion===undefined?undefined:(({principalId,approval,authority,...receipt})=>{void principalId;void approval;void authority;return IdentityPromotionPublicReceiptSchema.parse(receipt);})(promotion);
  return IdentityPromotionJobViewSchema.parse({...rest,failureCode:failureCode===null?null:/^[A-Z][A-Z0-9_]{1,119}$/.test(failureCode)?failureCode:job.state==='cancelled'?'CONFIGURATOR_CANCELLED':job.state==='rejected'?'CONFIGURATOR_REJECTED':'CONFIGURATOR_EXECUTION_FAILED',promotion:promotion===undefined?{kind:'not-applied'}:{kind:'applied',receipt:publicReceipt}});
 }
 function assertUnapplied(job:ConfiguratorJobView){if(applied(job)!==undefined)throw new Error('IDENTITY_PROMOTION_ALREADY_APPLIED');}
 function notify(receipt:ReturnType<typeof IdentityPromotionReceiptSchema.parse>){try{input.onCommitted?.(receipt);}catch{/* Observers never alter an already committed result. */}}
 function enqueue(job:ConfiguratorJobView){
  if(closed||job.state!=='queued'||active.has(job.jobId))return;
  const controller=new AbortController();const promise=Promise.resolve().then(async()=>{try{await worker.run(job,{signal:controller.signal});}catch{/* Claim/CAS conflicts stay in their durable ledger state. */}});
  active.set(job.jobId,{job,controller,promise});void promise.finally(()=>{if(active.get(job.jobId)?.promise===promise)active.delete(job.jobId);}).catch(()=>undefined);
 }
 async function lease(runId:string){
  if(leasingRuns.has(runId))throw new Error('IDENTITY_PROMOTION_RUN_BUSY');
  // A real targeted producer fence is required even for an otherwise idle database.
  if(input.representation===undefined)throw new Error('IDENTITY_PROMOTION_RUNTIME_LEASE_UNAVAILABLE');
  leasingRuns.add(runId);const releases:Release[]=[];
  try{releases.push(await input.representation.suspendRunAdmissions({runId}));if(input.voices!==undefined)releases.push(await input.voices.suspendRunAdmissions({runId}));assertIdle(runId);if(closed)throw new Error('IDENTITY_PROMOTION_UNAVAILABLE');leasedRuns.add(runId);}
  catch(error){leasingRuns.delete(runId);for(const release of releases.reverse())release();throw error;}
  let released=false;return ()=>{if(released)return;released=true;leasedRuns.delete(runId);leasingRuns.delete(runId);for(const release of releases.reverse())release();};
 }
 async function write<T>(request:{authority:IdentityPromotionAuthority;idempotencyKey:string},kind:string,payload:unknown,effect:()=>Promise<T>){
  writable();writeAuthority(request.authority);
  return await operations.execute({principalId:request.authority.principalId,idempotencyKey:request.idempotencyKey,kind,request:payload},effect);
 }
 const application={
  context(request:{runId:string;authority:IdentityPromotionAuthority}){
   available();const current=head(request.runId);const configuration=ReadyRunConfigurationSchema.parse(journal.readWorldConfiguration({runId:request.runId}));
   return IdentityPromotionContextViewSchema.parse({kind:'identity-promotion-context',runId:request.runId,lifecycle:current.lifecycle,lifecycleRevision:current.lifecycleRevision,commitIndex:current.source.commitIndex,worldRevision:current.source.worldRevision,worldSeq:current.source.worldSeq,configurationRevision:current.source.configurationRevision,canWrite:request.authority.mode.kind==='director'&&request.authority.mode.runId===request.runId&&request.authority.mode.scope.kind==='run'&&request.authority.inspectionRunIds.includes(request.runId)&&['ready','paused','stopped'].includes(current.lifecycle)&&!suspended,inspectionAllowed:request.authority.inspectionRunIds.includes(request.runId),eligibleActors:configuration.roster.preparedCharacters.map(actor=>({actorId:actor.characterId,label:configuration.worldSnapshot.entities.filter(entity=>entity.kind==='character').find(entity=>entity.characterId===actor.characterId)?.trueDisplayName??actor.characterId,identityVersion:actor.identityVersion}))});
  },
  list(request:{runId:string;authority:IdentityPromotionAuthority}){available();RunIdSchema.parse(request.runId);const page=ledger.list({principalId:request.authority.principalId,runId:request.runId,limit:1000});return IdentityPromotionJobPageSchema.parse({kind:'identity-promotion-jobs',items:page.jobs.map(job=>publicJob(job)),hasMore:page.hasMore});},
  readJob(request:JobLookup){try{return publicJob(lookup(request));}catch(error){if(error instanceof Error&&error.message==='CONFIGURATOR_JOB_NOT_FOUND')return undefined;throw error;}},
  readReview(request:JobLookup){const job=lookup(request);inspection(request.authority,job.runId);const review=ledger.readPrivate({jobId:job.jobId,principalId:request.authority.principalId});const candidate=review.candidate;const proposal=candidate?.proposal.kind==='identity-promotion-proposal'?candidate.proposal:null;return IdentityPromotionReviewSchema.parse({kind:'identity-promotion-review',job:publicJob(job),context:review.context,proposal,candidateHash:candidate?.candidateHash??null,proposalHash:proposal===null?null:configuratorValueHash(proposal),targetFullHash:review.context.targetFullHash});},
  async start(request:Parameters<IdentityPromotionApplicationPort['start']>[0]){
   director(request.authority,request.runId);inspection(request.authority,request.runId);
   const result=await write(request,'start',{runId:request.runId,body:request.body,ifMatch:request.ifMatch},async()=>{
    const previous=ledger.findBegin({principalId:request.authority.principalId,idempotencyKey:request.idempotencyKey});
    if(previous!==undefined){const begin=ledger.begin({principalId:request.authority.principalId,idempotencyKey:request.idempotencyKey,runId:request.runId,actorId:request.body.actorId,expectedCommitIndex:request.body.expectedCommitIndex,expectedWorldRevision:request.body.expectedWorldRevision,expectedConfigurationRevision:request.body.expectedConfigurationRevision,originalDossier:previous.context.source});return publicJob(begin.job,false);}
    const current=head(request.runId);const expected=IdentityPromotionHeadSchema.parse({runId:request.runId,lifecycle:current.lifecycle,lifecycleRevision:current.lifecycleRevision,commitIndex:current.source.commitIndex,worldRevision:current.source.worldRevision,worldSeq:current.source.worldSeq,configurationRevision:current.source.configurationRevision});
    if(identityPromotionContextEtag(expected)!==request.ifMatch||request.body.expectedLifecycleRevision!==expected.lifecycleRevision||request.body.expectedCommitIndex!==expected.commitIndex||request.body.expectedWorldRevision!==expected.worldRevision||request.body.expectedWorldSeq!==expected.worldSeq||request.body.expectedConfigurationRevision!==expected.configurationRevision)throw new Error('IDENTITY_PROMOTION_SOURCE_DIVERGED');
    if(!['ready','paused','stopped'].includes(current.lifecycle))throw new Error('IDENTITY_PROMOTION_LIFECYCLE_INVALID');assertIdle(request.runId);
    const configuration=ReadyRunConfigurationSchema.parse(journal.readWorldConfiguration({runId:request.runId}));
    const prepared=configuration.roster.preparedCharacters.find(actor=>actor.characterId===request.body.actorId);
    if(prepared===undefined)throw new Error('IDENTITY_PROMOTION_ACTOR_NOT_FOUND');
    const source=readPreparedDossierSource(prepared);
    const originalDossier=source.kind==='found'?source.source.frozenDossier:await readDossier({catalog:input.catalog,characterId:request.body.actorId});
    const after=head(request.runId);if(configuratorValueHash(after)!==configuratorValueHash(current))throw new Error('IDENTITY_PROMOTION_SOURCE_DIVERGED');assertIdle(request.runId);
    const begun=ledger.begin({principalId:request.authority.principalId,idempotencyKey:request.idempotencyKey,runId:request.runId,actorId:request.body.actorId,expectedCommitIndex:request.body.expectedCommitIndex,expectedWorldRevision:request.body.expectedWorldRevision,expectedConfigurationRevision:request.body.expectedConfigurationRevision,originalDossier});
    const view=publicJob(begun.job);if(begun.kind==='created')enqueue(begun.job);return view;
   });const view=IdentityPromotionJobViewSchema.parse(result);director(request.authority,view.runId);return view;
  },
  async retry(request:JobMutation){
   const result=await write(request,'retry',{jobId:request.jobId,expectedRevision:request.expectedRevision},async()=>{const job=lookup(request);director(request.authority,job.runId);
    const replay=db.prepare('SELECT 1 FROM configurator_operations WHERE principal_id=? AND idempotency_key=?').get(request.authority.principalId,request.idempotencyKey)!==undefined;
    if(!replay){const running=active.get(job.jobId);if(running!==undefined)await running.promise;writable();assertIdle(job.runId);}
    const retried=ledger.retry({jobId:job.jobId,principalId:request.authority.principalId,idempotencyKey:request.idempotencyKey,expectedRevision:request.expectedRevision});const view=publicJob(retried,false);if(retried.generation>job.generation&&retried.revision>job.revision)enqueue(retried);return view;});const view=IdentityPromotionJobViewSchema.parse(result);director(request.authority,view.runId);return view;
  },
  async reject(request:JobMutation){const result=await write(request,'reject',{jobId:request.jobId,expectedRevision:request.expectedRevision},async()=>{const job=lookup(request);director(request.authority,job.runId);assertUnapplied(job);return publicJob(ledger.reject({jobId:job.jobId,principalId:request.authority.principalId,idempotencyKey:request.idempotencyKey,expectedRevision:request.expectedRevision}));});const view=IdentityPromotionJobViewSchema.parse(result);director(request.authority,view.runId);return view;},
  async cancel(request:JobMutation){const result=await write(request,'cancel',{jobId:request.jobId,expectedRevision:request.expectedRevision},async()=>{const job=lookup(request);director(request.authority,job.runId);assertUnapplied(job);const cancelled=ledger.cancel({jobId:job.jobId,principalId:request.authority.principalId,idempotencyKey:request.idempotencyKey,expectedRevision:request.expectedRevision});const running=active.get(job.jobId);if(running!==undefined){running.controller.abort();await running.promise;}return publicJob(cancelled);});const view=IdentityPromotionJobViewSchema.parse(result);director(request.authority,view.runId);return view;},
  async approve(request:Parameters<IdentityPromotionApplicationPort['approve']>[0]){
   const result=await write(request,'approve',{jobId:request.jobId,expectedRevision:request.expectedRevision,body:request.body},async()=>{
    const job=lookup(request);director(request.authority,job.runId);const prior=applied(job);if(prior!==undefined){if(prior.operationId!==request.idempotencyKey)throw new Error('IDENTITY_PROMOTION_ALREADY_APPLIED');return publicJob(job);}
    if(job.revision!==request.expectedRevision||job.state!=='accepted')throw new Error('IDENTITY_PROMOTION_REVISION_CONFLICT');
    const running=active.get(job.jobId);if(running!==undefined)await running.promise;writable();
    const accepted=ledger.readAccepted({jobId:job.jobId,principalId:request.authority.principalId});if(accepted===undefined||accepted.candidate.proposal.kind!=='identity-promotion-proposal')throw new Error('IDENTITY_PROMOTION_ACCEPTED_PROPOSAL_REQUIRED');
    if(request.body.contextHash!==job.contextHash||request.body.proposalHash!==configuratorValueHash(accepted.candidate.proposal)||request.body.targetFullHash!==accepted.context.targetFullHash)throw new Error('IDENTITY_PROMOTION_CONSENT_HASH_MISMATCH');
    const release=await lease(job.runId);try{
     const operationId=request.idempotencyKey;const approval=ledger.confirmConsent({jobId:job.jobId,principalId:request.authority.principalId,expectedRevision:request.expectedRevision,idempotencyKey:request.idempotencyKey,contextHash:request.body.contextHash,proposalHash:request.body.proposalHash,targetFullHash:request.body.targetFullHash,operationId});
     const result=IdentityPromotionResultSchema.parse(journal.applyIdentityPromotion({principalId:request.authority.principalId,idempotencyKey:request.idempotencyKey,expectedLifecycleRevision:request.body.expectedLifecycleRevision,expectedCommitIndex:request.body.expectedCommitIndex,expectedWorldRevision:request.body.expectedWorldRevision,context:accepted.context,proposal:accepted.candidate.proposal,approval}));notify(result.receipt);return publicJob(job);
    }finally{release();}
   });const view=IdentityPromotionJobViewSchema.parse(result);director(request.authority,view.runId);return view;
  },
 } satisfies IdentityPromotionApplicationPort;
 return Object.freeze({...application,ledger,
  async waitForIdle(){while(active.size>0)await Promise.allSettled([...active.values()].map(item=>item.promise));},
  async suspendAdmissions():Promise<Release>{writable();if(operations.activeCount>0)throw new Error('IDENTITY_PROMOTION_BUSY');suspended=true;try{while(active.size>0)await Promise.allSettled([...active.values()].map(item=>item.promise));}catch(error){suspended=false;throw error;}let released=false;return ()=>{if(released)return;released=true;suspended=false;};},
  async close(){if(closed)return;closed=true;suspended=true;for(const item of active.values())item.controller.abort();while(active.size>0)await Promise.allSettled([...active.values()].map(item=>item.promise));while(operations.activeCount>0)await new Promise<void>(resolve=>setImmediate(resolve));operations.close();ledger.close();db.close();},
 });
}
