import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,realpathSync,rmSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {loadCatalog} from '../src/adapters/catalog.ts';
import {openJournal} from '../src/adapters/journal.ts';
import {PiRuntime} from '../src/adapters/pi.ts';
import {openPreparationConfiguratorJobLedger} from '../src/adapters/preparation-configurator-job-ledger.ts';
import {createIcmWorkspaceSnapshot} from '../src/domain/icm-workspace.ts';
import {sha256CanonicalJson,sha256Utf8} from '../src/domain/canonical-json.ts';
import {DEFAULT_INFERENCE_PROFILE} from '../src/domain/inference-profile.ts';
import {SessionCreatedSchema,SessionModeSchema} from '../src/domain/http.ts';
import {projectPreparationConfiguratorJob,PreparationConfiguratorPublicJobSchema,PreparationConfiguratorPublicReviewSchema,preparationConfiguratorJobEtag,PreparationConfiguratorApplyReceiptSchema,PreparationConfiguratorIntentSchema,PreparationConfiguratorApplyIntentSchema} from '../src/domain/preparation-configurator-http.ts';
import {fingerprintInferenceProfile} from '../src/application/pi-access-check.ts';
import {applyPreparationConfiguratorSelection} from '../src/application/preparation-configurator-application.ts';
import {createPreparationConfiguratorPiWorker} from '../src/application/preparation-configurator-pi-worker.ts';
import {createPreparationConfiguratorManager} from '../src/application/preparation-configurator-manager.ts';
import {createLocalHttpServer} from '../src/server/http.ts';
import {createPreparationConfiguratorRoutes,type PreparationConfiguratorApplicationPort,preparationConfiguratorJobId} from '../src/server/preparation-configurator-routes.ts';
import {createPreparationConfiguratorClient,PreparationConfiguratorRejection} from '../src/web/preparation-configurator-client.ts';
import {controlledPreparationConfiguratorSessionFactory,preparationConfiguratorSessionStats} from './fixtures/preparation-configurator-session.ts';
import {draftFixture} from './fixtures/continuista.ts';

async function fixture(options:{completeExceptName?:boolean}={}){
  const directory=realpathSync(mkdtempSync(join(tmpdir(),'personajes-preparation-http-'))),path=join(directory,'journal.sqlite'),journal=openJournal({path}),ownerToken=randomUUID();
  journal.setPreparationSourceAdmission(()=>undefined);journal.setPreparationConfiguratorSourceResolver(()=>({actorSources:[],documents:[]}));
  let applicationAvailable=true;
  journal.setPreparationConfiguratorApplicationResolver(input=>{if(!applicationAvailable)throw new Error('PREPARATION_CONFIGURATOR_APPLICATION_UNAVAILABLE');return applyPreparationConfiguratorSelection({context:input.context,proposal:input.candidate.proposal,proposalId:input.candidate.candidateId,currentDraft:input.currentDraft,selection:input.selection,host:{principalId:input.principalId,recordedAt:input.recordedAt,uuid:()=>randomUUID()}}).patch;});
  const evidence={kind:'operator-choice',operatorId:'local-operator',recordedAt:'2026-10-16T12:00:00Z'},workspace=createIcmWorkspaceSnapshot({sources:[...['configurator','director','continuista','narrator'].map(role=>({sourceId:`role.${role}`,audience:{role},revision:0,sourceHash:sha256Utf8(role),sections:[{sectionId:'process',markdown:'CONFIGURATOR_HOST_PRIVATE_PACKET'}]})),{sourceId:'actor.personaje-prueba',audience:{role:'actor',actorId:'personaje-prueba'},revision:0,sourceHash:sha256Utf8('actor'),sections:[{sectionId:'identity',markdown:'Personaje de prueba.'}]}]});
  const {kind:_kind,schemaVersion:_schema,runId:_run,revision:_revision,...complete}=draftFixture();
  const created=journal.createRunConfigurationDraft({principalId:'local-operator',idempotencyKey:randomUUID(),patch:{...(options.completeExceptName?{...complete,name:{kind:'empty'}}:{}),budget:{kind:'configured',evidence,value:{maxPiCallsPerRun:null,maxPiCallsPerPulse:null,maxConcurrentPiRequests:1,maxWallTimeMs:null,requestTimeoutMs:30000}},icmWorkspace:{kind:'configured',evidence,value:workspace}}});assert.equal(created.kind,'created');if(created.kind!=='created')assert.fail('draft');const draft=created.draft;
  const ledger=openPreparationConfiguratorJobLedger({journal,journalPath:path,privateDataRoot:directory,ownerToken}),runtime=await PiRuntime.create({privateDataRoot:directory}),stats=preparationConfiguratorSessionStats();
  const worker=createPreparationConfiguratorPiWorker({ledger,budget:journal,runtime,ownerToken,admission:{async readPiSdkStatus(){return {kind:'ready',piCodingAgentVersion:'1.2.0',piAiVersion:'1.2.0',sessionFactoryAvailable:true};},async readPiModelProfile(){return {kind:'configured',profile:{...DEFAULT_INFERENCE_PROFILE,fingerprint:fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE)}};},async readInferenceAuthenticationStatus(){return {kind:'authenticated',provider:'openai-codex',method:'oauth',accountFingerprint:'a'.repeat(64)};},async readInferenceAccessCheckReceipt(){return {kind:'passed',provider:'openai-codex',profileFingerprint:fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE),accountFingerprint:'a'.repeat(64),checkedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};}},sessionFactory:controlledPreparationConfiguratorSessionFactory({root:directory,stats,proposeName:'Puesta elegida desde una propuesta'})});
  const manager=createPreparationConfiguratorManager({worker});let reviews=0;
  const application={
    choices({runId}){const current=journal.readRunConfigurationDraft({runId});assert.ok(current);return {kind:'preparation-configurator-choices',runId,draftRevision:current.revision,draftHash:sha256CanonicalJson(current),actorSources:[],documents:[]};},
    list({runId,authority,limit,offset}){const page=ledger.list({principalId:authority.principalId,runId,limit,offset});return {kind:'preparation-configurator-jobs',runId,items:page.items.map(projectPreparationConfiguratorJob),hasMore:page.hasMore};},
    create({runId,jobId,body,authority,idempotencyKey}){return ledger.create({principalId:authority.principalId,idempotencyKey,request:{kind:'preparation-configurator-request',schemaVersion:1,runId,jobId,generation:0,...body}});},
    readJob({jobId,authority}){return ledger.read({jobId,principalId:authority.principalId});},
    readReview({jobId,authority}){reviews++;const job=projectPreparationConfiguratorJob(ledger.read({jobId,principalId:authority.principalId}));if(job.state!=='accepted')return {kind:'preparation-configurator-review',job,candidateId:null,proposalHash:null,proposal:null};const candidate=ledger.readAccepted({jobId,principalId:authority.principalId});return {kind:'preparation-configurator-review',job,candidateId:candidate.candidateId,proposalHash:sha256CanonicalJson(candidate.proposal),proposal:candidate.proposal};},
    start({jobId,authority,expectedRevision,idempotencyKey}){const started=ledger.start({jobId,principalId:authority.principalId,expectedRevision,idempotencyKey});if(started.kind==='started')manager.start(started.job);return started.job;},
    async cancel({jobId,authority,expectedRevision,idempotencyKey}){const cancelled=ledger.cancel({jobId,principalId:authority.principalId,expectedRevision,idempotencyKey});await manager.cancel({jobId});return cancelled;},
    apply({jobId,authority,expectedRevision,idempotencyKey,body}){return ledger.apply({jobId,principalId:authority.principalId,expectedRevision,idempotencyKey,candidateId:body.candidateId,proposalHash:body.proposalHash,expectedDraftRevision:body.draftRevision,expectedDraftHash:body.draftHash,selection:body.selection});},
  } satisfies PreparationConfiguratorApplicationPort;
  const routes=createPreparationConfiguratorRoutes({application:()=>application}),server=createLocalHttpServer({catalog:await loadCatalog({repositoryRoot:process.cwd()}),shellHtml:'<html><head></head><body></body></html>',operatorExtensions:[routes],runConfigurationDrafts:journal,resolveSessionMode:candidate=>candidate});
  const {origin}=await server.listen();const page=await fetch(origin+'/'),bootNonce=(await page.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(bootNonce);
  const login=await fetch(origin+'/api/v1/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({bootNonce})}),session=SessionCreatedSchema.parse(await login.json()),cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const headers={Origin:origin,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':session.csrfToken};
  return {journal,ledger,manager,stats,routes,application,draft,origin,headers,session,get reviews(){return reviews;},setApplicationAvailable(value:boolean){applicationAvailable=value;},operationCount(){const db=new DatabaseSync(path,{readOnly:true});try{return z.object({count:z.number()}).parse(db.prepare('SELECT count(*) count FROM preparation_configurator_operations').get()).count;}finally{db.close();}},async close(){await manager.close();await server.close();ledger.close();journal.close();rmSync(directory,{recursive:true,force:true});}};
}

test('HTTP real crea sin inferir, inicia sólo explícitamente y recupera start perdido sin duplicar SDK; revisión no expone contexto privado',async()=>{
  const f=await fixture();try{
    const collection=`${f.origin}/api/v1/runs/${f.draft.runId}/preparation-configurator`,body={draftRevision:f.draft.revision,draftHash:sha256CanonicalJson(f.draft),instructions:'Proponer una puesta, sin confirmarla.',actorSources:[],documentIds:[]},key=randomUUID(),headers={...f.headers,'Idempotency-Key':key};
    assert.equal((await fetch(collection)).status,401);assert.equal((await fetch(collection,{method:'POST',headers:{...headers,'X-CSRF-Token':'incorrecto'},body:JSON.stringify(body)})).status,403);
    for(const forged of [{context:{private:true}},{jobId:randomUUID()},{principalId:'otro'},{packet:{}}])assert.equal((await fetch(collection,{method:'POST',headers,body:JSON.stringify({...body,...forged})})).status,422);
    const created=await fetch(collection,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(created.status,201,await created.clone().text());const job=PreparationConfiguratorPublicJobSchema.parse(await created.json());assert.equal(job.scope.jobId,preparationConfiguratorJobId({principalId:'local-operator',idempotencyKey:key}));
    assert.equal(job.state,'queued');assert.equal(f.stats.requests,0);assert.equal(f.stats.sessions,0);assert.equal((await fetch(collection,{method:'POST',headers,body:JSON.stringify(body)})).status,201);
    const jobUrl=`${f.origin}/api/v1/preparation-configurator/${job.scope.jobId}`;for(const url of [collection,collection+'/choices',jobUrl,jobUrl+'/review']){const response=await fetch(url,{headers:f.headers});assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/CONFIGURATOR_HOST_PRIVATE_PACKET|sessionPath|claimToken|ownerToken|"packet"|"context"|principalId/);}assert.equal(f.stats.requests,0);
    const startKey=randomUUID(),startHeaders={...f.headers,'Idempotency-Key':startKey,'If-Match':preparationConfiguratorJobEtag(job)};
    assert.equal((await fetch(jobUrl+'/start',{method:'POST',headers:{...startHeaders,'If-Match':'"wrong"'},body:'{}'})).status,412);
    const start=await fetch(jobUrl+'/start',{method:'POST',headers:startHeaders,body:'{}'});assert.equal(start.status,202,await start.clone().text());const started=await start.json();await f.manager.waitForIdle();assert.equal(f.stats.requests,2);
    const replay=await fetch(jobUrl+'/start',{method:'POST',headers:startHeaders,body:'{}'});assert.equal(replay.status,202,await replay.clone().text());assert.deepEqual(await replay.json(),started);await f.manager.waitForIdle();assert.equal(f.stats.requests,2);
    const reviewResponse=await fetch(jobUrl+'/review',{headers:f.headers});assert.equal(reviewResponse.status,200);const review=PreparationConfiguratorPublicReviewSchema.parse(await reviewResponse.json());assert.equal(review.job.state,'accepted');assert.ok(review.proposal);assert.doesNotMatch(JSON.stringify(review),/CONFIGURATOR_HOST_PRIVATE_PACKET|sessionPath|claimToken|ownerToken|"packet"|"context"|principalId/);
    assert.equal(f.journal.loadWorld({runId:f.draft.runId}),undefined);assert.equal(f.journal.readRunConfigurationDraft({runId:f.draft.runId})?.revision,0);
  }finally{await f.close();}
});

test('HTTP aplica una selección con CASdraft y recibo durable; repeticiones no reescriben ni infieren; cancelqueuedesdurable',async()=>{
  const f=await fixture();try{
    const client=createPreparationConfiguratorClient((url,init)=>{const headers=new Headers(init?.headers);headers.set('Origin',f.origin);headers.set('Cookie',f.headers.Cookie);return fetch(new URL(String(url),f.origin),{...init,headers});},async()=>f.session),signal=new AbortController().signal;
    const choices=await client.choices(f.draft.runId,signal),created=await client.execute({kind:'create',runId:f.draft.runId,idempotencyKey:randomUUID(),body:{draftRevision:choices.draftRevision,draftHash:choices.draftHash,instructions:'Sugerir nombre de una puesta.',actorSources:[],documentIds:[]}},signal);
    await client.execute({kind:'start',runId:f.draft.runId,idempotencyKey:randomUUID(),job:{scope:created.scope,revision:created.revision}},signal);await f.manager.waitForIdle();const review=await client.review({runId:f.draft.runId,jobId:created.scope.jobId},signal);assert.ok(review.candidateId&&review.proposalHash);
    const intent={runId:f.draft.runId,jobId:created.scope.jobId,idempotencyKey:randomUUID(),body:{candidateId:review.candidateId,proposalHash:review.proposalHash,draftRevision:choices.draftRevision,draftHash:choices.draftHash,selection:{settings:['name' as const],actors:[],placements:[]}}};
    const missingCas=await fetch(`${f.origin}/api/v1/preparation-configurator/${created.scope.jobId}/apply`,{method:'POST',headers:{...f.headers,'Idempotency-Key':intent.idempotencyKey},body:JSON.stringify(intent.body)});assert.equal(missingCas.status,412);
    const before=f.journal.readRunConfigurationDraftHistory({runId:f.draft.runId}),operations=f.operationCount();f.setApplicationAvailable(false);
    await assert.rejects(client.apply(intent,signal),error=>!(error instanceof PreparationConfiguratorRejection));assert.deepEqual(f.journal.readRunConfigurationDraftHistory({runId:f.draft.runId}),before);assert.equal(f.operationCount(),operations,'failed apply leaves no operation receipt');assert.equal(f.journal.readRunConfigurationDraft({runId:f.draft.runId})?.revision,0);
    f.setApplicationAvailable(true);const applied=PreparationConfiguratorApplyReceiptSchema.parse(await client.apply(intent,signal));assert.equal(applied.draftRevision,1);const sessionPath=f.stats.sessionPaths[0];assert.ok(sessionPath);renameSync(sessionPath,sessionPath+'.moved');assert.deepEqual(await client.apply(intent,signal),applied);renameSync(sessionPath+'.moved',sessionPath);assert.equal(f.stats.requests,2);assert.equal(f.journal.readRunConfigurationDraft({runId:f.draft.runId})?.name.kind,'configured');assert.equal(f.journal.readRunConfigurationDraftHistory({runId:f.draft.runId}).length,before.length+1);assert.equal(f.operationCount(),operations+1);
    await assert.rejects(client.apply({...intent,idempotencyKey:randomUUID()},signal),error=>error instanceof PreparationConfiguratorRejection&&error.status===412);
    assert.equal(f.journal.readRunConfigurationDraft({runId:f.draft.runId})?.revision,1);
    const next=await client.choices(f.draft.runId,signal),queued=await client.execute({kind:'create',runId:f.draft.runId,idempotencyKey:randomUUID(),body:{draftRevision:next.draftRevision,draftHash:next.draftHash,instructions:'Otra propuesta explícita.',actorSources:[],documentIds:[]}},signal),cancel={kind:'cancel' as const,runId:f.draft.runId,idempotencyKey:randomUUID(),job:{scope:queued.scope,revision:queued.revision}};
    const cancelled=await client.execute(cancel,signal);assert.equal(cancelled.state,'cancelled');assert.deepEqual(await client.execute(cancel,signal),cancelled);assert.equal(f.stats.requests,2);
    assert.equal((await client.list(f.draft.runId,signal)).items.length,2);
  }finally{await f.close();}
});

test('cliente clasifica401/403sinJSON, conserva alcance/corte y no reintenta transportes de resultado incierto',async()=>{
  const bootstrap=async()=>SessionCreatedSchema.parse({csrfToken:'a'.repeat(32),expiresAt:new Date(Date.now()+60000).toISOString()}),runId=randomUUID(),signal=new AbortController().signal;
  for(const status of [401,403]){let calls=0;const client=createPreparationConfiguratorClient(async()=>{calls++;return new Response('',{status});},bootstrap);await assert.rejects(client.choices(runId,signal),error=>error instanceof PreparationConfiguratorRejection&&error.status===status);assert.equal(calls,1);}
  let calls=0;const intent=PreparationConfiguratorIntentSchema.parse({kind:'create',runId,idempotencyKey:randomUUID(),body:{draftRevision:0,draftHash:sha256Utf8('draft'),instructions:'Proponer puesta.',actorSources:[],documentIds:[]}});assert.equal(intent.kind,'create');if(intent.kind!=='create')assert.fail('intent');
  const lost=createPreparationConfiguratorClient(async(_url,init)=>{calls++;const headers=new Headers(init?.headers);assert.equal(headers.get('Idempotency-Key'),intent.idempotencyKey);assert.deepEqual(JSON.parse(String(init?.body)),intent.body);throw new Error('Lost response');},bootstrap);
  await assert.rejects(lost.execute(intent,signal),/Lost response/);assert.equal(calls,1);
  const controller=new AbortController();controller.abort();await assert.rejects(lost.execute(intent,controller.signal));assert.equal(calls,1,'aborted intent is never dispatched');
});

test('cliente rechaza selección o propuesta alterada aunque200conserveIDs y corte; hashWebCrypto coincide con el host',async()=>{
  const bootstrap=async()=>SessionCreatedSchema.parse({csrfToken:'a'.repeat(32),expiresAt:new Date(Date.now()+60000).toISOString()}),signal=new AbortController().signal;
  const intent=PreparationConfiguratorApplyIntentSchema.parse({runId:randomUUID(),jobId:randomUUID(),idempotencyKey:randomUUID(),body:{candidateId:randomUUID(),proposalHash:sha256Utf8('proposal'),draftRevision:0,draftHash:sha256Utf8('draft'),selection:{placements:[],actors:[],settings:['name']}}});
  const receipt=PreparationConfiguratorApplyReceiptSchema.parse({kind:'preparation-configurator-applied',jobId:intent.jobId,runId:intent.runId,candidateId:intent.body.candidateId,proposalHash:intent.body.proposalHash,baseDraftRevision:0,baseDraftHash:intent.body.draftHash,draftRevision:1,draftHash:sha256Utf8('applied draft'),selectionHash:sha256CanonicalJson(intent.body.selection)});
  let calls=0;const wrong=createPreparationConfiguratorClient(async()=>{calls++;return Response.json({...receipt,selectionHash:sha256CanonicalJson({settings:['audio'],actors:[],placements:[]})});},bootstrap);
  await assert.rejects(wrong.apply(intent,signal),/selección/);assert.equal(calls,1,'no automatic repeat after a mismatching receipt');
  const correct=createPreparationConfiguratorClient(async()=>Response.json(receipt),bootstrap);assert.deepEqual(await correct.apply(intent,signal),receipt);
  const job=PreparationConfiguratorPublicJobSchema.parse({kind:'preparation-configurator-job',scope:{runId:intent.runId,jobId:intent.jobId,generation:0,draftRevision:0,draftHash:intent.body.draftHash,contextHash:sha256Utf8('context')},revision:2,state:'accepted',failureCode:null,createdAt:1,updatedAt:2});
  const proposal={kind:'preparation-configurator-proposal',schemaVersion:1,contextHash:job.scope.contextHash,settings:[],actors:[],placements:[],openQuestions:['Vacío preservado']};
  const review={kind:'preparation-configurator-review',job,candidateId:intent.body.candidateId,proposal,proposalHash:sha256CanonicalJson(proposal)};
  const altered=createPreparationConfiguratorClient(async()=>Response.json({...review,proposal:{...proposal,openQuestions:['Cambio no sellado']}},{headers:{ETag:preparationConfiguratorJobEtag(job)}}),bootstrap);
  await assert.rejects(altered.review({runId:intent.runId,jobId:intent.jobId},signal),/hash confirmado/);
  const valid=createPreparationConfiguratorClient(async()=>Response.json(review,{headers:{ETag:preparationConfiguratorJobEtag(job)}}),bootstrap);assert.deepEqual(await valid.review({runId:intent.runId,jobId:intent.jobId},signal),review);
});

test('borrador incompleto pasa por HTTP y SDK a propuesta, selección aplicada y Ready conservando consumo de preparación',async()=>{
  const f=await fixture({completeExceptName:true});try{
    const validate=async(revision:number)=>{const response=await fetch(`${f.origin}/api/v1/runs/${f.draft.runId}/validate`,{method:'POST',headers:{...f.headers,'Idempotency-Key':randomUUID(),'If-Match':`"run-config:${f.draft.runId}:c${revision}"`},body:'{}'});assert.equal(response.status,200,await response.clone().text());return await response.json();};
    const incomplete=await validate(0);assert.equal(incomplete.kind,'incomplete');assert.ok(incomplete.issues.some((issue:{field:string})=>issue.field==='name'));assert.equal(f.journal.loadWorld({runId:f.draft.runId}),undefined);assert.equal(f.stats.requests,0);
    const client=createPreparationConfiguratorClient((url,init)=>{const headers=new Headers(init?.headers);headers.set('Origin',f.origin);headers.set('Cookie',f.headers.Cookie);return fetch(new URL(String(url),f.origin),{...init,headers});},async()=>f.session),signal=new AbortController().signal;
    const choices=await client.choices(f.draft.runId,signal),job=await client.execute({kind:'create',runId:f.draft.runId,idempotencyKey:randomUUID(),body:{draftRevision:choices.draftRevision,draftHash:choices.draftHash,instructions:'Proponer el nombre que falta; preservar la preparación elegida.',actorSources:[],documentIds:[]}},signal);
    await client.read({runId:f.draft.runId,jobId:job.scope.jobId},signal);await client.list(f.draft.runId,signal);assert.equal(f.stats.requests,0);
    await client.execute({kind:'start',runId:f.draft.runId,idempotencyKey:randomUUID(),job:{scope:job.scope,revision:job.revision}},signal);await f.manager.waitForIdle();const review=await client.review({runId:f.draft.runId,jobId:job.scope.jobId},signal);assert.equal(review.job.state,'accepted');assert.ok(review.candidateId&&review.proposalHash);assert.equal(f.stats.requests,2);
    const priorBudget=f.journal.readRunModelTimeBudget({runId:f.draft.runId});assert.ok(priorBudget);assert.equal(priorBudget.runCallsUsed,2);assert.equal(priorBudget.status,'known');assert.equal(priorBudget.wallTimeReservedMs,0);
    const applied=await client.apply({runId:f.draft.runId,jobId:job.scope.jobId,idempotencyKey:randomUUID(),body:{candidateId:review.candidateId,proposalHash:review.proposalHash,draftRevision:choices.draftRevision,draftHash:choices.draftHash,selection:{settings:['name'],actors:[],placements:[]}}},signal);
    assert.equal(f.journal.loadWorld({runId:f.draft.runId}),undefined,'apply alone does not promote Ready');const ready=await validate(applied.draftRevision);assert.equal(ready.kind,'valid',JSON.stringify(ready));assert.equal(ready.promotion,'promoted');assert.equal(f.journal.readWorldLifecycle({runId:f.draft.runId})?.lifecycle,'ready');
    const budget=f.journal.readRunModelTimeBudget({runId:f.draft.runId});assert.ok(budget);assert.equal(budget.runCallsUsed,priorBudget.runCallsUsed);assert.equal(budget.wallTimeMeasuredMs,priorBudget.wallTimeMeasuredMs);assert.equal(budget.wallTimeReservedMs,0);assert.equal(budget.maxPiCallsPerRun,null);assert.equal(budget.maxWallTimeMs,null);assert.equal(f.stats.requests,2);
  }finally{await f.close();}
});

test('permisos niegan interlocutor y Dirección de escena antes leer propuesta; Dirección total sólo su run',async()=>{
  const f=await fixture();try{
    const job=f.ledger.create({principalId:'local-operator',idempotencyKey:randomUUID(),request:{kind:'preparation-configurator-request',schemaVersion:1,runId:f.draft.runId,jobId:randomUUID(),generation:0,draftRevision:0,draftHash:sha256CanonicalJson(f.draft),instructions:'Propuesta administrativa.',actorSources:[],documentIds:[]}});
    const routeRequest={kind:'read' as const,method:'GET' as const,path:['preparation-configurator',job.scope.jobId,'review'],query:new URLSearchParams(),principalId:'local-operator',ifMatch:null,ifNoneMatch:null};
    for(const mode of [{kind:'interlocutor',runId:f.draft.runId,participantId:randomUUID()},{kind:'director',runId:f.draft.runId,scope:{kind:'scene',sceneId:randomUUID()}},{kind:'director',runId:randomUUID(),scope:{kind:'run'}}]){const response=await f.routes.handle({...routeRequest,mode:SessionModeSchema.parse(mode)});assert.equal(response.kind,'problem');if(response.kind==='problem')assert.equal(response.status,403);assert.equal(f.reviews,0);}
    const allowed=await f.routes.handle({...routeRequest,mode:{kind:'director',runId:f.draft.runId,scope:{kind:'run'}}});assert.equal(allowed.kind,'json');assert.equal(f.reviews,1);
  }finally{await f.close();}
});
