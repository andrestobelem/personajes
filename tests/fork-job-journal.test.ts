import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {setup,canonical} from './fixtures/continuista.ts';
import {prepareForkState} from '../src/application/prepare-fork-state.ts';
import {prepareForkDramaticSeed} from '../src/application/fork-dramatic-seed.ts';
import {prepareForkConfiguration} from '../src/application/fork-configuration.ts';
import {ForkPublicationPackageSchema} from '../src/application/fork-package.ts';
import {hashContinuistaValue} from '../src/domain/continuista-review.ts';
import {freezeExperience} from '../src/application/experience-envelope.ts';
import {ReadyRunConfigurationSchema} from '../src/application/production-preflight.ts';
import {openJournal} from '../src/adapters/journal.ts';

async function fixture(options:{memories?:number;drama?:boolean;empty?:boolean;embodied?:boolean}={}){
 const f=await setup();let journal=f.journal;let configuration=f.configuration;
 if((options.memories??1)>1||options.drama||options.empty||options.embodied){
  journal=openJournal({path:join(f.directory,'fork-source-isolated.sqlite')});
  configuration=ReadyRunConfigurationSchema.parse({...configuration,...(options.embodied?{characterDefinitionPolicy:{kind:'embodied-v1'}}:{}),worldSnapshot:{...configuration.worldSnapshot,
    entities:configuration.worldSnapshot.entities.map(actor=>actor.kind==='character'&&actor.mind.experiences.length>0
      ?{...actor,mind:{...actor.mind,experiences:Array.from({length:options.empty?0:options.memories??1},(_,index)=>freezeExperience({...actor.mind.experiences[0],experienceId:randomUUID(),content:`Recuerdo sintético ${index}.`}).envelope)}}:actor)}});
  const prepared=configuration.roster.preparedCharacters[0];assert.ok(prepared);
  journal.registerWorldRun({initialSnapshot:configuration.worldSnapshot,configuration,configurationRevision:configuration.configRevision,lifecycle:'running',continuityFence:{kind:'prepared-contexts',atWorldSeq:configuration.worldSnapshot.seq,contexts:[{actorId:prepared.characterId,continuityId:prepared.continuity.continuityId,continuityRevision:prepared.continuity.revision,continuityContentHash:prepared.continuity.contentHash,identityVersion:prepared.identityVersion,preparedContextHash:hashContinuistaValue(prepared)}]}});
 }
 const world=configuration.worldSnapshot;let sourceCommitIndex=0;let sourceRevision:number=world.revision;const episodeId=randomUUID();const nextSceneId=randomUUID();
 if(options.drama){
  const apply=(command:unknown)=>{const result=journal.applyDramaticStructureCommand({runId:world.runId,principalId:'fork-test',operationId:randomUUID(),idempotencyKey:randomUUID(),expectedWorldRevision:sourceRevision,expectedStructureRevision:sourceCommitIndex,command});assert.equal(result.kind,'stored');sourceRevision+=1;sourceCommitIndex+=1;};
  apply({kind:'closeScene',sceneId:world.activeSceneId,reason:'Cerrar escena inicial de prueba.'});
  apply({kind:'openEpisode',episodeId,title:'Episodio heredado'});
  apply({kind:'openScene',scene:{id:nextSceneId,label:'Escena del episodio',participantIds:[configuration.roster.activeCharacterIds[0]],placeIds:['sala']}});
  apply({kind:'setEpisodeActs',episodeId,acts:[{actId:randomUUID(),title:'Acto heredado',sceneIds:[nextSceneId]}]});
  apply({kind:'closeScene',sceneId:nextSceneId,reason:'Corte entre escenas del episodio abierto.'});
 }
 function packet(operationId=randomUUID(),targetRunId=randomUUID()){
  const source=journal.readForkSource({runId:world.runId,commitIndex:sourceCommitIndex,worldRevision:sourceRevision,worldSeq:world.seq});assert.equal(source.kind,'found');if(source.kind!=='found')assert.fail();
  const transformed=prepareForkState({snapshot:source.snapshot,configuration:source.configuration,cuts:source.cuts,targetRunId});
  const {state,seed}=prepareForkDramaticSeed({structure:source.structure,state:transformed});
  const configuration=prepareForkConfiguration({sourceConfiguration:source.configuration,state,name:'Derivación sintética',principalId:'fork-test',recordedAt:'2026-10-16T00:00:00Z',operationId});
  return ForkPublicationPackageSchema.parse({kind:'fork-publication-package',state,...configuration,dramaticSeed:seed});
 }
 const operationId=randomUUID();const payload=packet(operationId);
 const request={operationId,principalId:'fork-test',idempotencyKey:randomUUID(),name:'Derivación sintética',reason:'Prueba de bifurcación durable.',package:payload};
 const lookup={operationId,principalId:request.principalId};
 const artifacts={kind:'fork-artifacts',operationId,targetRunId:payload.state.targetRunId,packageHash:hashContinuistaValue(payload),actors:payload.state.actors.map(actor=>({actorId:actor.actorId,sha256:'a'.repeat(64),byteLength:1}))};
 const receipts=payload.state.actors.flatMap(actor=>actor.experiences).map((frozen,index)=>({memoryId:`01ARZ3NDEKTSV4RRFFQ69G5F${String(index).padStart(2,'0')}`,experienceId:frozen.envelope.experienceId,runId:frozen.envelope.runId,actorId:frozen.envelope.actorId,worldSeq:frozen.envelope.worldSeq,canonicalPayload:frozen.canonicalPayload,payloadHash:frozen.payloadHash}));
 return {...f,journal,configuration,episodeId,nextSceneId,packet,payload,request,lookup,artifacts,receipts,
  close(){if(journal!==f.journal)journal.close();f.close();},
  stage(){const result=journal.beginForkJob(request);assert.equal(result.kind,'created');if(result.kind!=='created')assert.fail();return result.job;},
  project(){for(const receipt of receipts)assert.deepEqual(journal.recordForkProjection({...lookup,receipt}),receipt);},
  mutate(fn:(db:DatabaseSync)=>void){const db=new DatabaseSync(join(f.directory,(options.memories??1)>1||options.drama||options.empty||options.embodied?'fork-source-isolated.sqlite':'journal.sqlite'));try{fn(db);}finally{db.close();}},
 };
}

test('staging permanece invisible y replay conserva primer paquete e identidades, incluso tras reinicio',async()=>{
 const f=await fixture();try{
  const job=f.stage();assert.equal(job.state,'staging');assert.equal(f.journal.loadWorld({runId:job.targetRunId}),undefined);
  assert.deepEqual(f.journal.readForkPackage(f.lookup),f.payload);assert.deepEqual(f.journal.findForkJob({principalId:f.request.principalId,idempotencyKey:f.request.idempotencyKey}),job);
  const replacement=f.packet(f.request.operationId);const replay=f.journal.beginForkJob({...f.request,package:replacement});
  assert.deepEqual(replay,{kind:'existing',job});assert.deepEqual(f.journal.readForkPackage(f.lookup),f.payload);
  const otherOperation=randomUUID();assert.deepEqual(f.journal.beginForkJob({...f.request,operationId:otherOperation,package:f.packet(otherOperation)}),{kind:'idempotencyConflict'});
  assert.deepEqual(f.journal.beginForkJob({...f.request,reason:'Otro motivo'}),{kind:'idempotencyConflict'});
  assert.equal(f.journal.readForkJob({...f.lookup,principalId:'otro-operador'}),undefined);
  const reopened=openJournal({path:join(f.directory,'journal.sqlite')});try{assert.deepEqual(reopened.readForkJob(f.lookup),job);assert.deepEqual(reopened.listStagingForkJobs(),[job]);}finally{reopened.close();}
 }finally{f.close();}
});

test('receipts staged exigen scope y payload exactos y no adelantan revisión del job',async()=>{
 const f=await fixture();try{
  const job=f.stage();const receipt=f.receipts[0];assert.ok(receipt);
  assert.throws(()=>f.journal.recordForkProjection({...f.lookup,receipt:{...receipt,runId:randomUUID()}}),/ajeno/);
  f.project();assert.deepEqual(f.journal.readForkJob(f.lookup),job);assert.deepEqual(f.journal.readForkProjectionReceipts(f.lookup),f.receipts);
  assert.deepEqual(f.journal.recordForkProjection({...f.lookup,receipt}),receipt);
  assert.throws(()=>f.journal.recordForkProjection({...f.lookup,receipt:{...receipt,memoryId:'01ARZ3NDEKTSV4RRFFQ69G5FZZ'}}),/sustitución/);
  assert.deepEqual(f.journal.readForkProjectionReceipt({operationId:job.operationId,memoryId:receipt.memoryId,runId:receipt.runId,actorId:receipt.actorId,throughWorldSeq:receipt.worldSeq}),receipt);
  assert.equal(f.journal.readForkProjectionReceipt({operationId:job.operationId,memoryId:receipt.memoryId,runId:randomUUID(),actorId:receipt.actorId,throughWorldSeq:receipt.worldSeq}),undefined);
 }finally{f.close();}
});

test('fallo y retry conservan paquete, IDs y proyecciones aceptadas sin publicar target',async()=>{
 const f=await fixture();try{
  const staged=f.stage();f.project();const failed=f.journal.failForkJob({...f.lookup,expectedRevision:staged.revision,code:'FORK_INTERRUPTED'});assert.equal(failed?.state,'failed');assert.equal(f.journal.loadWorld({runId:staged.targetRunId}),undefined);
  assert.deepEqual(f.journal.listStagingForkJobs(),[]);const retried=f.journal.retryForkJob({...f.lookup,expectedRevision:failed?.revision,idempotencyKey:randomUUID()});assert.equal(retried.kind,'updated');if(retried.kind!=='updated')assert.fail();assert.equal(retried.job.state,'staging');assert.equal(retried.job.targetRunId,staged.targetRunId);assert.equal(retried.job.revision,2);
  assert.deepEqual(f.journal.readForkPackage(f.lookup),f.payload);assert.deepEqual(f.journal.readForkProjectionReceipts(f.lookup),f.receipts);
 }finally{f.close();}
});

test('publicación exige todos los artefactos y todos los receipts y preserva estado privado sin heredar ejecución',async()=>{
 const f=await fixture();try{
  const staged=f.stage();assert.throws(()=>f.journal.publishForkJob({...f.lookup,expectedRevision:staged.revision,artifacts:f.artifacts}),/ICM incompleta/);
  f.project();assert.throws(()=>f.journal.publishForkJob({...f.lookup,expectedRevision:staged.revision,artifacts:{...f.artifacts,actors:f.artifacts.actors.slice(1)}}),/artefactos/);
  const ready=f.journal.publishForkJob({...f.lookup,expectedRevision:staged.revision,artifacts:f.artifacts});assert.equal(ready.state,'ready');
  assert.deepEqual(f.journal.loadWorld({runId:ready.targetRunId}),f.payload.state.snapshot);
  assert.equal(f.journal.readWorldLifecycle({runId:ready.targetRunId})?.lifecycle,'ready');
  assert.equal(f.journal.listRunConfigurationDrafts({}).some(draft=>draft.runId===ready.targetRunId),true);
  for(const actor of f.payload.state.actors){const cut=f.journal.readActorStateCut({runId:ready.targetRunId,actorId:actor.actorId,commitIndex:0,worldRevision:0,worldSeq:f.payload.state.snapshot.seq});assert.equal(cut.kind,'found');if(cut.kind==='found'){assert.deepEqual(cut.cut.experiences,actor.experiences);assert.deepEqual(cut.cut.knowledge,actor.knowledge);}}
  assert.deepEqual(f.journal.readDramaticStructure({runId:ready.targetRunId}),f.payload.dramaticSeed.structure);
  assert.deepEqual(f.journal.readDramaticStructureAtCut({runId:ready.targetRunId,worldRevision:0,worldSeq:f.payload.state.snapshot.seq})?.structure,f.payload.dramaticSeed.structure);
  f.mutate(db=>{for(const table of ['world_events','world_commits','structure_events','world_perceptions','actor_turn_jobs','actor_pi_sessions','request_reservations'])assert.equal(db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE run_id=?`).get(ready.targetRunId)?.count,0);assert.equal(db.prepare('SELECT COUNT(*) count FROM memory_outbox o JOIN experiences e ON e.experience_id=o.experience_id WHERE e.run_id=?').get(ready.targetRunId)?.count,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);});
  assert.deepEqual(f.journal.publishForkJob({...f.lookup,expectedRevision:staged.revision,artifacts:f.artifacts}),ready);
 }finally{f.close();}
});

test('fallo de checkpoint inicial revierte publicación entera y deja staging recuperable',async()=>{
 const f=await fixture();try{
  const staged=f.stage();f.project();f.mutate(db=>db.exec(`CREATE TRIGGER fail_fork_cut BEFORE INSERT ON actor_state_cut_batches WHEN NEW.run_id='${staged.targetRunId}' BEGIN SELECT RAISE(ABORT,'forced-fork-cut'); END`));
  assert.throws(()=>f.journal.publishForkJob({...f.lookup,expectedRevision:staged.revision,artifacts:f.artifacts}),/forced-fork-cut/);
  assert.equal(f.journal.loadWorld({runId:staged.targetRunId}),undefined);assert.deepEqual(f.journal.readForkJob(f.lookup),staged);assert.equal(f.journal.readRunConfigurationDraft({runId:staged.targetRunId}),undefined);
  f.mutate(db=>db.exec('DROP TRIGGER fail_fork_cut'));assert.equal(f.journal.publishForkJob({...f.lookup,expectedRevision:staged.revision,artifacts:f.artifacts}).state,'ready');
 }finally{f.close();}
});

test('varias memorias se publican con receipts independientes y no comparten claim_token',async()=>{
 const f=await fixture({memories:3});try{
  const job=f.stage();assert.equal(f.receipts.length,3);f.project();const ready=f.journal.publishForkJob({...f.lookup,expectedRevision:job.revision,artifacts:f.artifacts});assert.equal(ready.state,'ready');
  f.mutate(db=>assert.equal(db.prepare('SELECT COUNT(DISTINCT r.claim_token) count FROM memory_receipts r JOIN experiences e ON e.experience_id=r.experience_id WHERE e.run_id=?').get(job.targetRunId)?.count,3));
 }finally{f.close();}
});

test('publicación entre escenas hereda episodio y actos y permite edición explícita sin inventar aperturas',async()=>{
 const f=await fixture({drama:true});try{
  const job=f.stage();f.project();const ready=f.journal.publishForkJob({...f.lookup,expectedRevision:job.revision,artifacts:f.artifacts});assert.equal(ready.state,'ready');
  const inherited=f.journal.readDramaticStructure({runId:job.targetRunId});assert.ok(inherited);assert.equal(inherited.activeSceneId,null);assert.equal(inherited.episodes[0]?.acts[0]?.title,'Acto heredado');assert.equal(inherited.episodes[0]?.forkOrigins?.[0]?.episodeId,f.episodeId);
  assert.deepEqual(f.journal.readDramaticStructureAtCut({runId:job.targetRunId,worldRevision:0,worldSeq:f.payload.state.snapshot.seq})?.structure,inherited);
  const sceneId=randomUUID();const opened=f.journal.applyDramaticStructureCommand({runId:job.targetRunId,principalId:'fork-test',operationId:randomUUID(),idempotencyKey:randomUUID(),expectedWorldRevision:0,expectedStructureRevision:0,
    command:{kind:'openScene',scene:{id:sceneId,label:'Escena elegida después de bifurcar',participantIds:[f.configuration.roster.activeCharacterIds[0]],placeIds:['sala']}}});assert.equal(opened.kind,'stored');
  const current=f.journal.readDramaticStructure({runId:job.targetRunId});assert.equal(current?.activeSceneId,sceneId);assert.deepEqual(current?.episodes[0]?.forkOrigins,inherited.episodes[0]?.forkOrigins);
  const historical=f.journal.readDramaticStructureAtCut({runId:job.targetRunId,worldRevision:0,worldSeq:f.payload.state.snapshot.seq});assert.deepEqual(historical?.structure,inherited);
  f.mutate(db=>assert.equal(db.prepare('SELECT COUNT(*) count FROM structure_events WHERE run_id=?').get(job.targetRunId)?.count,1));
 }finally{f.close();}
});

for(const tamper of ['package','job','receipt','seed'] as const)test(`journal rechaza ${tamper} alterado y no publica un destino parcial`,async()=>{
 const f=await fixture();try{
  const job=f.stage();f.project();
  if(tamper==='seed')assert.equal(f.journal.publishForkJob({...f.lookup,expectedRevision:job.revision,artifacts:f.artifacts}).state,'ready');
  f.mutate(db=>{
   if(tamper==='package')db.prepare('UPDATE fork_jobs SET package_hash=? WHERE operation_id=?').run('f'.repeat(64),job.operationId);
   if(tamper==='job')db.prepare('UPDATE fork_jobs SET job_hash=? WHERE operation_id=?').run('f'.repeat(64),job.operationId);
   if(tamper==='receipt')db.prepare('UPDATE fork_projection_receipts SET payload_hash=? WHERE operation_id=?').run('f'.repeat(64),job.operationId);
   if(tamper==='seed')db.prepare('UPDATE fork_dramatic_seeds SET payload_hash=? WHERE run_id=?').run('f'.repeat(64),job.targetRunId);
  });
  if(tamper==='seed')assert.throws(()=>f.journal.readDramaticStructure({runId:job.targetRunId}),/alterada/);
  else {assert.throws(()=>f.journal.publishForkJob({...f.lookup,expectedRevision:job.revision,artifacts:f.artifacts}),/alterado|alterada/);assert.equal(f.journal.loadWorld({runId:job.targetRunId}),undefined);}
 }finally{f.close();}
});

test('fork Ready sobrevive reinicio y puede ser fuente exacta de otro fork sin copiar ejecución',async()=>{
 const f=await fixture({drama:true});try{
  const staged=f.stage();f.project();const ready=f.journal.publishForkJob({...f.lookup,expectedRevision:staged.revision,artifacts:f.artifacts});
  const reopened=openJournal({path:join(f.directory,'fork-source-isolated.sqlite')});try{
   assert.deepEqual(reopened.readForkJob(f.lookup),ready);
   const source=reopened.readForkSource({runId:ready.targetRunId,commitIndex:0,worldRevision:0,worldSeq:f.payload.state.snapshot.seq});assert.equal(source.kind,'found');if(source.kind!=='found')assert.fail();
   const remapped=prepareForkState({snapshot:source.snapshot,configuration:source.configuration,cuts:source.cuts,targetRunId:randomUUID()});const {state,seed}=prepareForkDramaticSeed({structure:source.structure,state:remapped});
   const operationId=randomUUID();const config=prepareForkConfiguration({sourceConfiguration:source.configuration,state,name:'Derivación segunda',principalId:'fork-test',recordedAt:'2026-10-16T00:00:00Z',operationId});
   const packet=ForkPublicationPackageSchema.parse({kind:'fork-publication-package',state,...config,dramaticSeed:seed});
   const begun=reopened.beginForkJob({operationId,principalId:'fork-test',idempotencyKey:randomUUID(),name:'Derivación segunda',reason:'Bifurcar la bifurcación.',package:packet});assert.equal(begun.kind,'created');
   assert.equal(packet.dramaticSeed.structure.episodes[0]?.forkOrigins?.length,2);assert.equal(reopened.loadWorld({runId:state.targetRunId}),undefined);
  }finally{reopened.close();}
 }finally{f.close();}
});

test('CAS obsoleto, manifiesto ajeno y namespace de idempotencia no alteran staging',async()=>{
 const f=await fixture();try{
  const job=f.stage();f.project();assert.throws(()=>f.journal.publishForkJob({...f.lookup,expectedRevision:1,artifacts:f.artifacts}),/CAS/);
  assert.throws(()=>f.journal.publishForkJob({...f.lookup,expectedRevision:job.revision,artifacts:{...f.artifacts,packageHash:'f'.repeat(64)}}),/artefactos/);
  assert.throws(()=>f.journal.failForkJob({...f.lookup,expectedRevision:1,code:'FORK_INTERRUPTED'}),/CAS/);
  assert.equal(f.journal.createRunConfigurationDraft({principalId:f.request.principalId,idempotencyKey:f.request.idempotencyKey,patch:{}}).kind,'idempotencyConflict');
  assert.deepEqual(f.journal.readForkJob(f.lookup),job);assert.equal(f.journal.loadWorld({runId:job.targetRunId}),undefined);
 }finally{f.close();}
});

for(const empty of [true,false])test(`preparación publicada ${empty?'sin experiencias':'con experiencias'} es readonly por PATCH y VALIDATE y conserva su autoridad`,async()=>{
 const f=await fixture({empty});try{
  const staged=f.stage();f.project();const ready=f.journal.publishForkJob({...f.lookup,expectedRevision:staged.revision,artifacts:f.artifacts});
  const getRows=()=>{let result:unknown;f.mutate(db=>{result=['world_runs','world_commits','episodes','episode_scenes','acts','act_scenes','fork_dramatic_seeds','actor_knowledge','experiences','actor_state_cut_batches','actor_state_cuts','run_configuration_drafts','run_configuration_draft_history'].map(table=>({table,rows:db.prepare(`SELECT * FROM ${table} WHERE run_id=? ORDER BY rowid`).all(ready.targetRunId)}));});return result;};
  const before=getRows();assert.equal(f.journal.readRunConfigurationDraftState({runId:ready.targetRunId})?.editability,'fork-published');
  const patch={principalId:'fork-test',idempotencyKey:randomUUID(),runId:ready.targetRunId,expectedRevision:0,
    patch:{name:{kind:'configured',value:'No debe sobreescribir el fork',evidence:{kind:'operator-choice',operatorId:'fork-test',recordedAt:'2026-10-16T00:00:00Z'}}}};
  const readonly={kind:'readonly',reason:'fork-published'};
  assert.deepEqual(f.journal.updateRunConfigurationDraft(patch),readonly);
  assert.deepEqual(f.journal.updateRunConfigurationDraft(patch),readonly,'replay de rechazo mantiene identidad');
  const validation={principalId:'fork-test',idempotencyKey:randomUUID(),runId:ready.targetRunId,expectedRevision:0};
  assert.deepEqual(f.journal.validateRunConfigurationDraft(validation),readonly);assert.deepEqual(f.journal.validateRunConfigurationDraft(validation),readonly);
  assert.deepEqual(getRows(),before);assert.equal(f.journal.readWorldLifecycle({runId:ready.targetRunId})?.lifecycle,'ready');
  assert.deepEqual(f.journal.readDramaticStructure({runId:ready.targetRunId}),f.payload.dramaticSeed.structure);
  assert.deepEqual(f.journal.readForkJob(f.lookup),ready);
 }finally{f.close();}
});

for(const forged of ['sourceConfigurationHash','bindingState'] as const)test(`audioDerivation ${forged} no se acepta aunque job e historia estén coherentemente rehasheados`,async()=>{
 const f=await fixture();try{
  const job=f.stage();const audioDerivation={...job.audioDerivation,...(forged==='sourceConfigurationHash'?{sourceConfigurationHash:'f'.repeat(64)}:{bindingState:'unbound'})};
  const altered={...job,audioDerivation};const payload=canonical(altered);const hash=hashContinuistaValue(altered);
  f.mutate(db=>{db.prepare('UPDATE fork_jobs SET job_json=?,job_hash=? WHERE operation_id=?').run(payload,hash,job.operationId);db.prepare('UPDATE fork_job_history SET payload_json=?,payload_hash=? WHERE operation_id=? AND revision=?').run(payload,hash,job.operationId,job.revision);});
  assert.throws(()=>f.journal.readForkJob(f.lookup),/alterado/);assert.equal(f.journal.loadWorld({runId:job.targetRunId}),undefined);
 }finally{f.close();}
});

test('preparación derivada atribuye nombre al operador y valores heredados al host y al job exacto',async()=>{
 const f=await fixture();try{
  const staged=f.stage();f.project();const ready=f.journal.publishForkJob({...f.lookup,expectedRevision:staged.revision,artifacts:f.artifacts});
  const draft=f.journal.readRunConfigurationDraft({runId:ready.targetRunId});assert.ok(draft);
  assert.equal(draft.name.kind,'configured');if(draft.name.kind==='configured')assert.equal(draft.name.evidence.kind,'operator-choice');
  for(const field of ['fictionalAt','continuity','roster','humanParticipants','worldSnapshot','dramaticLine','dramaticReferences','circadianPolicy','spanishVariety','narrationMode','inferenceProfile','budget','maxReformulations','audio'] as const){
   const section:{kind:string;evidence?:{kind:string;derivationRef?:string}}|undefined=draft[field];assert.ok(section);assert.equal(section.kind,'configured');assert.equal(section.evidence?.kind,'host-derived');assert.equal(section.evidence?.derivationRef,`fork:${staged.operationId}`);
  }
 }finally{f.close();}
});

test('retry durable devuelve su recibo original tras publicar Ready y después de reiniciar',async()=>{
 const f=await fixture();try{
  const first=f.stage();const failed=f.journal.failForkJob({...f.lookup,expectedRevision:first.revision,code:'FORK_INTERRUPTED'});assert.ok(failed);
  const request={...f.lookup,expectedRevision:failed.revision,idempotencyKey:randomUUID()};
  const retried=f.journal.retryForkJob(request);assert.equal(retried.kind,'updated');if(retried.kind!=='updated')assert.fail();
  const expected={kind:'existing',job:retried.job};assert.deepEqual(f.journal.retryForkJob(request),expected);
  f.project();const ready=f.journal.publishForkJob({...f.lookup,expectedRevision:retried.job.revision,artifacts:f.artifacts});assert.equal(ready.state,'ready');
  assert.deepEqual(f.journal.retryForkJob(request),expected);assert.deepEqual(f.journal.readForkJob(f.lookup),ready);
  const reopened=openJournal({path:join(f.directory,'journal.sqlite')});try{assert.deepEqual(reopened.retryForkJob(request),expected);assert.deepEqual(reopened.readForkJob(f.lookup),ready);}finally{reopened.close();}
  assert.deepEqual(f.journal.readForkPackage(f.lookup),f.payload);
 }finally{f.close();}
});

test('retry preserva missing, invalidState y conflict originales sin responder con el job actual',async()=>{
 const f=await fixture();try{
  const job=f.stage();const invalid={...f.lookup,expectedRevision:job.revision,idempotencyKey:randomUUID()};assert.deepEqual(f.journal.retryForkJob(invalid),{kind:'invalidState'});
  const failed=f.journal.failForkJob({...f.lookup,expectedRevision:job.revision,code:'FORK_INTERRUPTED'});assert.ok(failed);
  const conflict={...f.lookup,expectedRevision:0,idempotencyKey:randomUUID()};assert.deepEqual(f.journal.retryForkJob(conflict),{kind:'conflict',currentRevision:failed.revision});
  const good={...f.lookup,expectedRevision:failed.revision,idempotencyKey:randomUUID()};assert.equal(f.journal.retryForkJob(good).kind,'updated');
  assert.deepEqual(f.journal.retryForkJob(invalid),{kind:'invalidState'});assert.deepEqual(f.journal.retryForkJob(conflict),{kind:'conflict',currentRevision:failed.revision});
  const absentOperation=randomUUID();const missing={...f.lookup,operationId:absentOperation,expectedRevision:0,idempotencyKey:randomUUID()};assert.deepEqual(f.journal.retryForkJob(missing),{kind:'missing'});
  const created=f.journal.beginForkJob({...f.request,operationId:absentOperation,idempotencyKey:randomUUID(),package:f.packet(absentOperation)});assert.equal(created.kind,'created');
  assert.deepEqual(f.journal.retryForkJob(missing),{kind:'missing'});
 }finally{f.close();}
});

test('retry rechaza cambios de identidad o CAS para la misma clave y comparte namespace con otras operaciones',async()=>{
 const f=await fixture();try{
  const job=f.stage();assert.deepEqual(f.journal.retryForkJob({...f.lookup,expectedRevision:0,idempotencyKey:f.request.idempotencyKey}),{kind:'idempotencyConflict'});
  const failed=f.journal.failForkJob({...f.lookup,expectedRevision:job.revision,code:'FORK_INTERRUPTED'});assert.ok(failed);
  const request={...f.lookup,expectedRevision:failed.revision,idempotencyKey:randomUUID()};const result=f.journal.retryForkJob(request);assert.equal(result.kind,'updated');
  assert.deepEqual(f.journal.retryForkJob({...request,operationId:randomUUID()}),{kind:'idempotencyConflict'});assert.deepEqual(f.journal.retryForkJob({...request,expectedRevision:0}),{kind:'idempotencyConflict'});
  assert.equal(f.journal.createRunConfigurationDraft({principalId:request.principalId,idempotencyKey:request.idempotencyKey,patch:{}}).kind,'idempotencyConflict');
  const op=randomUUID();assert.deepEqual(f.journal.beginForkJob({...f.request,operationId:op,idempotencyKey:request.idempotencyKey,package:f.packet(op)}),{kind:'idempotencyConflict'});
  assert.deepEqual(f.journal.retryForkJob({...request,principalId:'otro-operador'}),{kind:'missing'});
 }finally{f.close();}
});

test('la transición retry y su recibo se revierten juntos si falla la escritura de la operación',async()=>{
 const f=await fixture();try{
  const job=f.stage();const failed=f.journal.failForkJob({...f.lookup,expectedRevision:job.revision,code:'FORK_INTERRUPTED'});assert.ok(failed);
  const request={...f.lookup,expectedRevision:failed.revision,idempotencyKey:randomUUID()};
  f.mutate(db=>db.exec("CREATE TRIGGER fail_retry_receipt BEFORE INSERT ON fork_job_retries BEGIN SELECT RAISE(ABORT,'forced-retry-receipt'); END"));
  assert.throws(()=>f.journal.retryForkJob(request),/forced-retry-receipt/);assert.deepEqual(f.journal.readForkJob(f.lookup),failed);
  f.mutate(db=>{assert.equal(db.prepare('SELECT COUNT(*) count FROM fork_job_retries').get()?.count,0);assert.equal(db.prepare('SELECT COUNT(*) count FROM fork_job_history WHERE operation_id=?').get(job.operationId)?.count,2);db.exec('DROP TRIGGER fail_retry_receipt');});
  const retried=f.journal.retryForkJob(request);assert.equal(retried.kind,'updated');if(retried.kind==='updated')assert.equal(retried.job.revision,failed.revision+1);
  assert.deepEqual(f.journal.readForkPackage(f.lookup),f.payload);assert.equal(f.journal.loadWorld({runId:job.targetRunId}),undefined);
 }finally{f.close();}
});

for(const corruption of ['hash','metadata','history'] as const)test(`retry falla cerrado ante corrupción de ${corruption} y conserva staging actual`,async()=>{
 const f=await fixture();try{
  const first=f.stage();const failed=f.journal.failForkJob({...f.lookup,expectedRevision:first.revision,code:'FORK_INTERRUPTED'});assert.ok(failed);
  const request={...f.lookup,expectedRevision:failed.revision,idempotencyKey:randomUUID()};const result=f.journal.retryForkJob(request);assert.equal(result.kind,'updated');if(result.kind!=='updated')assert.fail();
  f.mutate(db=>{
   if(corruption==='hash')db.prepare('UPDATE fork_job_retries SET result_hash=?').run('f'.repeat(64));
   if(corruption==='metadata')db.prepare('UPDATE fork_job_retries SET expected_revision=?').run(failed.revision+1);
   if(corruption==='history')db.prepare('UPDATE fork_job_history SET payload_hash=? WHERE operation_id=? AND revision=?').run('f'.repeat(64),first.operationId,result.job.revision);
  });
  assert.throws(()=>f.journal.retryForkJob(request),/alterado|inconsistente|histórica/);
 }finally{f.close();}
});


for(const embodied of [false,true])test(`publicación fork conserva política fuente ${embodied?'embodied':'legacy'} en Ready y borrador sin backfill`,async()=>{
 const f=await fixture({embodied});try{
  const sourceBefore=canonical(f.journal.readWorldConfiguration({runId:f.configuration.runId}));
  const staged=f.stage();f.project();const published=f.journal.publishForkJob({...f.lookup,expectedRevision:staged.revision,artifacts:f.artifacts});assert.equal(published.state,'ready');
  const configuration=ReadyRunConfigurationSchema.parse(f.journal.readWorldConfiguration({runId:published.targetRunId})),draft=f.journal.readRunConfigurationDraft({runId:published.targetRunId});assert.ok(draft);
  assert.deepEqual(configuration.characterDefinitionPolicy,embodied?{kind:'embodied-v1'}:undefined);
  assert.deepEqual(draft.characterDefinitionPolicy,configuration.characterDefinitionPolicy);
  assert.equal(canonical(f.journal.readWorldConfiguration({runId:f.configuration.runId})),sourceBefore);
 }finally{f.close();}
});
