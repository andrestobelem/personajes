import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {z} from 'zod';
import {createAssistantMessageEventStream,type AssistantMessage} from '@earendil-works/pi-ai';
import {openJournal} from '../src/adapters/journal.ts';
import {PiRuntime,createPiSession} from '../src/adapters/pi.ts';
import {openPreparationConfiguratorJobLedger} from '../src/adapters/preparation-configurator-job-ledger.ts';
import {createIcmWorkspaceSnapshot} from '../src/domain/icm-workspace.ts';
import {sha256CanonicalJson,sha256Utf8} from '../src/domain/canonical-json.ts';
import {createPreparationConfiguratorPiWorker} from '../src/application/preparation-configurator-pi-worker.ts';
import {createPreparationConfiguratorManager} from '../src/application/preparation-configurator-manager.ts';
import {fingerprintInferenceProfile} from '../src/application/pi-access-check.ts';
import {DEFAULT_INFERENCE_PROFILE} from '../src/domain/inference-profile.ts';
import type {PreparationConfiguratorAdmissionHost} from '../src/application/preparation-configurator-admission.ts';
import {controlledPreparationConfiguratorSessionFactory,preparationConfiguratorSessionStats} from './fixtures/preparation-configurator-session.ts';
import {PreparationConfiguratorProposalSchema} from '../src/domain/preparation-configurator.ts';

async function fixture(options:{omitProposal?:boolean;incomplete?:boolean;afterTool?:()=>void}={}){
  const directory=realpathSync(mkdtempSync(join(tmpdir(),'personajes-preparation-worker-'))),path=join(directory,'journal.sqlite'),journal=openJournal({path}),ownerToken=randomUUID();
  journal.setPreparationSourceAdmission(()=>undefined);journal.setPreparationConfiguratorSourceResolver(()=>({actorSources:[],documents:[]}));
  const workspace=createIcmWorkspaceSnapshot({sources:[{sourceId:'role.configurator',audience:{role:'configurator'},revision:0,sourceHash:sha256Utf8('setup'),sections:[{sectionId:'process',markdown:'CONFIGURATOR_PREPARATION_TEST_ONLY'}]},{sourceId:'role.director',audience:{role:'director'},revision:0,sourceHash:sha256Utf8('director'),sections:[{sectionId:'process',markdown:'DIRECTOR_CONTRACT_EXCLUDED'}]}]});
  const evidence={kind:'operator-choice',operatorId:'operator-test',recordedAt:'2026-10-16T12:00:00Z'};
  const created=journal.createRunConfigurationDraft({principalId:'operator-test',idempotencyKey:randomUUID(),patch:{budget:{kind:'configured',evidence,value:{maxPiCallsPerRun:null,maxPiCallsPerPulse:null,maxConcurrentPiRequests:1,maxWallTimeMs:null,requestTimeoutMs:30000}},icmWorkspace:{kind:'configured',evidence,value:workspace}}});assert.equal(created.kind,'created');if(created.kind!=='created')assert.fail('draft');
  const draft=created.draft,job=journal.createPreparationConfiguratorJob({principalId:'operator-test',idempotencyKey:randomUUID(),request:{kind:'preparation-configurator-request',schemaVersion:1,runId:draft.runId,draftRevision:draft.revision,draftHash:sha256CanonicalJson(draft),jobId:randomUUID(),generation:0,instructions:'Proponer puesta con vacíos explícitos.',actorSources:[],documentIds:[]}});
  const runtime=await PiRuntime.create({privateDataRoot:directory}),stats=preparationConfiguratorSessionStats();let oauth=true,admissions=0;
  const admission={async readPiSdkStatus(){admissions++;return {kind:'ready',piCodingAgentVersion:'1.2.0',piAiVersion:'1.2.0',sessionFactoryAvailable:true};},async readPiModelProfile(){return {kind:'configured',profile:{...DEFAULT_INFERENCE_PROFILE,fingerprint:fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE)}};},async readInferenceAuthenticationStatus(){return {kind:'authenticated',provider:'openai-codex',method:oauth?'oauth':'api_key',accountFingerprint:'a'.repeat(64)};},async readInferenceAccessCheckReceipt(){return {kind:'passed',provider:'openai-codex',accountFingerprint:'a'.repeat(64),profileFingerprint:fingerprintInferenceProfile(DEFAULT_INFERENCE_PROFILE),checkedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};}} satisfies PreparationConfiguratorAdmissionHost;
  const ledger=openPreparationConfiguratorJobLedger({journal,journalPath:path,privateDataRoot:directory,ownerToken});
  const worker=createPreparationConfiguratorPiWorker({ledger,budget:journal,runtime,ownerToken,admission,sessionFactory:controlledPreparationConfiguratorSessionFactory({root:directory,stats,...options})});
  return {directory,path,journal,ledger,worker,job,draft,stats,runtime,ownerToken,admission,get admissions(){return admissions;},revoke(){oauth=false;},close(){ledger.close();journal.close();rmSync(directory,{recursive:true,force:true});}};
}

test('createPiSession productiva con OAuth sintético y transporte controlado conserva freshbase null aunque checkpoint tenga metadatos',async(t)=>{
  const f=await fixture();let networkCalls=0,requests=0,metadataLeaf:string|null=null;
  try{
    const access=`e30.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-preparation-test'}})).toString('base64url')}.synthetic`;
    writeFileSync(join(f.directory,'pi','auth','auth.json'),JSON.stringify({'openai-codex':{type:'oauth',refresh:'synthetic-refresh',access,expires:Date.now()+86400000}}),{mode:0o600});
    t.mock.method(globalThis,'fetch',async()=>{networkCalls++;throw new Error('This test forbids all provider/OAuth network');});
    const proposal=PreparationConfiguratorProposalSchema.parse({kind:'preparation-configurator-proposal',schemaVersion:1,contextHash:f.job.scope.contextHash,settings:[],actors:[],placements:[],openQuestions:['Propuesta sintética sin confirmar.']});
    t.mock.method(f.runtime.modelRuntime,'streamSimple',(model:Parameters<typeof f.runtime.modelRuntime.streamSimple>[0])=>{
      requests++;const toolCall:Extract<AssistantMessage['content'][number],{type:'toolCall'}>|undefined=requests===1?{type:'toolCall',id:'production-factory-proposal',name:'submit_preparation_proposal',arguments:z.record(z.string(),z.json()).parse(JSON.parse(JSON.stringify(proposal)))}:undefined;
      const message:AssistantMessage={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:toolCall===undefined?[]:[toolCall],stopReason:toolCall===undefined?'stop':'toolUse',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      const stream=createAssistantMessageEventStream();stream.push({type:'done',reason:toolCall===undefined?'stop':'toolUse',message});return stream;
    });
    const worker=createPreparationConfiguratorPiWorker({ledger:f.ledger,budget:f.journal,runtime:f.runtime,ownerToken:f.ownerToken,admission:f.admission,async sessionFactory(input){const handle=await createPiSession(input);metadataLeaf=handle.checkpoint().candidateLeafId;assert.notEqual(metadataLeaf,null,'the productive SDK creates setup metadata before the prompt');return handle;}});
    const result=await worker.run(f.job);assert.equal(result.state,'accepted',JSON.stringify(result));assert.equal(requests,2);assert.equal(networkCalls,0);
    const registered=f.journal.readPreparationConfiguratorRecord({jobId:f.job.scope.jobId,generation:0,kind:'session'}),base=f.journal.readPreparationConfiguratorRecord({jobId:f.job.scope.jobId,generation:0,kind:'job-base'});assert.equal(registered?.kind,'session');assert.equal(base?.kind,'checkpoint');
    if(registered?.kind!=='session'||base?.kind!=='checkpoint')assert.fail('durable session and job-base missing');assert.equal(registered.value.baseLeafId,null);assert.equal(base.value.snapshot.candidateLeafId,null);assert.notEqual(metadataLeaf,null);
    assert.deepEqual(f.ledger.readAccepted({principalId:f.job.principalId,jobId:f.job.scope.jobId}).proposal,proposal);
  }finally{f.close();}
});

test('preparación incompleta genera propuesta con SDK/JSONL reales y presupuesto durable sin WorldRun ni aplicar borrador',async()=>{
  const f=await fixture();try{
    assert.equal(f.stats.sessions,0);assert.equal(f.admissions,0);assert.equal(f.journal.loadWorld({runId:f.draft.runId}),undefined);
    const result=await f.worker.run(f.job);assert.equal(result.state,'accepted',JSON.stringify({result,requests:f.stats.requests,admissions:f.admissions,session:f.stats.sessions}));assert.equal(f.stats.requests,2);assert.equal(f.stats.disposed,1);assert.equal(f.admissions,3);
    assert.match(f.stats.systemPrompts[0]??'',/CONFIGURATOR_PREPARATION_TEST_ONLY/);assert.doesNotMatch(f.stats.systemPrompts[0]??'',/DIRECTOR_CONTRACT_EXCLUDED/);
    const sessionPath=f.stats.sessionPaths[0];assert.ok(sessionPath);assert.match(readFileSync(sessionPath,'utf8'),/submit_preparation_proposal/);
    assert.deepEqual(f.journal.readRunConfigurationDraft({runId:f.draft.runId}),f.draft);assert.equal(f.journal.loadWorld({runId:f.draft.runId}),undefined);
    const accepted=f.journal.readPreparationConfiguratorRecord({jobId:f.job.scope.jobId,generation:0,kind:'accepted-proof'});assert.equal(accepted?.kind,'accepted-proof');
    assert.equal(f.ledger.readAccepted({principalId:f.job.principalId,jobId:f.job.scope.jobId}).proposal.contextHash,f.job.scope.contextHash);
    const budget=f.journal.readRunModelTimeBudget({runId:f.draft.runId});assert.ok(budget);assert.equal(budget.wallTimeReservedMs,0);
    await assert.rejects(f.worker.run(f.job));assert.equal(f.stats.sessions,1,'no implicit replay of a completed generation');
    const bytes=readFileSync(sessionPath,'utf8');assert.match(bytes,/Propuesta sintética/);writeFileSync(sessionPath,bytes.replace('Propuesta sintética','Propuesta adulterada'));
    assert.throws(()=>f.ledger.readAccepted({principalId:f.job.principalId,jobId:f.job.scope.jobId}),/CHECKPOINT|CHAIN|PREFIX|PROOF|BYTES/);assert.equal(f.stats.requests,2,'integrity recheck never infers');
  }finally{f.close();}
});

test('prosa final sin tool o terminal incompleto no acepta propuesta; OAuth revocado bloquea sin proveedor adicional',async()=>{
  for(const options of [{omitProposal:true},{incomplete:true}]){const f=await fixture(options);try{const result=await f.worker.run(f.job);assert.equal(result.state,'blocked');assert.equal(f.journal.readPreparationConfiguratorRecord({jobId:f.job.scope.jobId,generation:0,kind:'accepted-proof'}),undefined);}finally{f.close();}}
  let revoke=()=>{};const f=await fixture({afterTool:()=>revoke()});revoke=()=>f.revoke();try{
    const result=await f.worker.run(f.job);assert.equal(result.state,'blocked');assert.equal(f.stats.requests,1);assert.equal(f.stats.disposed,1);
    assert.equal(f.journal.readPreparationConfiguratorRecord({jobId:f.job.scope.jobId,generation:0,kind:'accepted-proof'}),undefined);
    const budget=f.journal.readRunModelTimeBudget({runId:f.draft.runId});assert.ok(budget);assert.equal(budget.wallTimeReservedMs,0,'pre-dispatch admission failure releases its grant');
  }finally{f.close();}
});

test('manager permanece inerte hasta start, deduplica y close impide nuevas ejecuciones sin reanudar por lectura',async()=>{
  const f=await fixture();try{
    const manager=createPreparationConfiguratorManager({worker:f.worker});assert.equal(f.stats.sessions,0);
    assert.equal(manager.start(f.job).kind,'started');assert.equal(manager.start(f.job).kind,'already-active');await manager.waitForIdle();assert.equal(f.stats.sessions,1);
    await manager.close();assert.throws(()=>manager.start(f.job),/MANAGER_CLOSED/);assert.equal(f.stats.sessions,1);
  }finally{f.close();}
});

test('cancelar explícitamente antes de sesión no crea JSONL ni solicitudes y no reenvía al consultar',async()=>{
  const f=await fixture();try{
    const manager=createPreparationConfiguratorManager({worker:f.worker});manager.start(f.job);await manager.cancel({jobId:f.job.scope.jobId});
    const job=f.ledger.read({principalId:f.job.principalId,jobId:f.job.scope.jobId});assert.equal(job.state,'blocked');assert.equal(job.failureCode,'PREPARATION_CONFIGURATOR_CANCELLED');
    assert.equal(f.stats.sessions,0);assert.equal(f.stats.requests,0);assert.equal(f.admissions,0);assert.equal(manager.hasActive({jobId:f.job.scope.jobId}),false);
    await manager.waitForIdle();assert.equal(f.stats.requests,0);await manager.close();
  }finally{f.close();}
});

test('editar el borrador durante una propuesta cierra la lease vieja bloqueada sin segunda inferencia ni aceptación',async()=>{
  let edit=()=>{};const f=await fixture({afterTool:()=>edit()});edit=()=>{const result=f.journal.updateRunConfigurationDraft({principalId:f.job.principalId,idempotencyKey:randomUUID(),runId:f.draft.runId,expectedRevision:f.draft.revision,patch:{name:{kind:'configured',value:'Elección posterior del operador',evidence:{kind:'operator-choice',operatorId:'test',recordedAt:'2026-10-16T12:00:00Z'}}}});assert.equal(result.kind,'stored');};
  try{const result=await f.worker.run(f.job);assert.equal(result.state,'blocked');assert.equal(f.stats.requests,1);assert.equal(f.stats.disposed,1);assert.equal(f.journal.readPreparationConfiguratorRecord({jobId:f.job.scope.jobId,generation:0,kind:'accepted-proof'}),undefined);assert.equal(f.journal.readRunConfigurationDraft({runId:f.draft.runId})?.revision,1);}finally{f.close();}
});
