import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createRunObservationApplication, projectRunStage } from '../src/application/run-observation.ts';
import { createRunLifecycleApplication } from '../src/application/run-lifecycle.ts';
import { createDeliverWorldWorker } from '../src/application/deliver-world.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { SessionCreatedSchema } from '../src/domain/http.ts';
import { RunStageViewSchema, ConversationPageSchema, TechnicalJobPageSchema } from '../src/domain/run-observation.ts';
import { FictionalInstantSchema } from '../src/domain/values.ts';
import { setup, actorId } from './fixtures/continuista.ts';

const privateFields=/SECRET_|UNPUBLISHED_SECRET|identityMarkdown|lifeStoryMarkdown|trueDisplayName|recognizedCharacterIds|relationshipDescriptions|preparedCharacters|systemPrompt|claimToken|ownerToken|sessionPath|candidateLeafId|feedback|reasoning(?!Effort)|payload_json/;
async function emit(fixture:Awaited<ReturnType<typeof setup>>,text:string) {
  const snapshot=fixture.journal.loadWorld({runId:fixture.claim.runId});assert.ok(snapshot);
  const receipt=fixture.journal.commitHumanIntervention({runId:fixture.claim.runId,participantId:'visitante-prueba',expectedRevision:snapshot.revision,
    idempotencyKey:randomUUID(),request:{kind:'speech',recipientCharacterIds:[actorId],channelId:'00000000-0000-4000-8000-000000000104',content:{kind:'speech',text}}});
  assert.equal(receipt.kind,'stored');
}

test('stage y RunView públicos sólo muestran presentación/escena y excluyen identidad, memorias y setup privado',async()=>{
  const fixture=await setup();
  try {
    const application=createRunObservationApplication({journal:fixture.journal});
    const result=application.readStage({runId:fixture.claim.runId});if(result.kind!=='found')assert.fail(result.kind);
    const stage=RunStageViewSchema.parse(result.value);
    assert.equal(stage.entities.filter(entity=>entity.kind==='character').length,1);
    assert.equal(stage.places.length,1);
    assert.equal(stage.humanParticipants[0]?.label,'Visitante');
    assert.doesNotMatch(JSON.stringify(stage),privateFields);
    assert.doesNotMatch(JSON.stringify(stage),/oculto-prueba|SECRET_PRIVATE_PLACE/);
    const run=createRunLifecycleApplication({journal:fixture.journal}).readRunView({runId:fixture.claim.runId});assert.ok(run);
    assert.doesNotMatch(JSON.stringify(run),privateFields);
    assert.equal('worldSnapshot' in run.config,false);
    assert.equal('preparedCharacters' in run.config.roster,false);
    assert.equal(run.config.fictionalAt,run.clock.instant);
    assert.equal(application.readStage({runId:randomUUID()}).kind,'missing');
    const old=application.readStage({runId:fixture.claim.runId,atWorldSeq:fixture.configuration.worldSnapshot.seq});
    if(old.kind!=='found')assert.fail(old.kind);
    assert.equal(old.value.worldSeq,fixture.configuration.worldSnapshot.seq);
    assert.equal(old.value.fictionalAt,fixture.configuration.worldSnapshot.clock.instant);
    assert.equal(old.value.lifecycleAsOf,'current');
    assert.equal(old.value.lifecycle,fixture.journal.readWorldLifecycle({runId:fixture.claim.runId})?.lifecycle);
    assert.equal(application.readStage({runId:fixture.claim.runId,atWorldSeq:stage.worldSeq+1}).kind,'invalidRequest');
  } finally {fixture.close();}
});

test('el stage público representa un intervalo entre escenas sin exponer entidades fuera de escena',async()=>{
  const fixture=await setup();
  try {
    const source=fixture.configuration.worldSnapshot;
    const snapshot={...source,schemaVersion:2 as const,activeSceneId:null,
      scenes:source.scenes.map((scene)=>({...scene,lifecycle:{kind:'closed' as const,startedAt:fixture.configuration.fictionalAt,
        closedAt:FictionalInstantSchema.parse(fixture.configuration.fictionalAt+1),reason:'corte de escena'}}))};
    const view=projectRunStage({snapshot,configuration:fixture.configuration,lifecycle:'paused'});
    assert.equal(view.activeSceneId,null);
    assert.deepEqual(view.scenes,[]);
    assert.deepEqual(view.places,[]);
    assert.deepEqual(view.entities,[]);
    assert.deepEqual(view.humanParticipants,[]);
  } finally {fixture.close();}
});

test('conversación sólo contiene emisiones confirmadas, separa audiencia y entregas y no revela propuesta pendiente',async()=>{
  const fixture=await setup();
  try {
    const claim=fixture.journal.claimActorTurnJob(fixture.claim);assert.equal(claim.kind,'claimed');
    const snapshot=fixture.journal.loadWorld({runId:fixture.claim.runId});assert.ok(snapshot);
    fixture.journal.registerWorldProposal({runId:fixture.claim.runId,proposalId:randomUUID(),version:1,jobId:fixture.claim.jobId,
      generation:fixture.claim.generation,proposalSlot:0,lease:{ownerToken:fixture.claim.ownerToken,claimToken:fixture.claim.claimToken},
      attempt:{kind:'communicate',attemptId:randomUUID(),runId:fixture.claim.runId,actorId,expectedRevision:snapshot.revision,
        channelHandle:'speech',audienceHandles:[],content:{kind:'speech',text:'UNPUBLISHED_SECRET'}}});
    const application=createRunObservationApplication({journal:fixture.journal});
    await emit(fixture,'Texto humano confirmado, todavía no entregado.');
    const before=application.readConversations({runId:fixture.claim.runId,limit:100});if(before.kind!=='found')assert.fail(before.kind);
    const page=ConversationPageSchema.parse(before.value);
    assert.equal(page.items.length,2);
    const last=page.items.at(-1);assert.ok(last);
    assert.equal(last.emission,'emitted');
    assert.equal(last.speaker.kind,'human');
    assert.equal(last.effectiveAudienceCount,1);
    assert.equal(last.deliveries[0]?.state,'planned');
    assert.equal(last.deliveries[0]?.memoryProjection,'notDelivered');
    assert.doesNotMatch(JSON.stringify(page),privateFields);
    assert.equal((await createDeliverWorldWorker({journal:fixture.journal,runId:fixture.claim.runId,actorId}).drain()).kind,'completed');
    const after=application.readConversations({runId:fixture.claim.runId,limit:100});if(after.kind!=='found')assert.fail(after.kind);
    const delivered=ConversationPageSchema.parse(after.value).items.at(-1);assert.ok(delivered);
    assert.equal(delivered.eventId,last.eventId);
    assert.equal(delivered.deliveries[0]?.state,'delivered');
    assert.equal(delivered.deliveries[0]?.memoryProjection,'pending');
  } finally {fixture.close();}
});

test('páginas tienen corte estable, límites y cursores ligados a corrida/superficie/intervalo; lectura no modifica SQLite',async()=>{
  const fixture=await setup();
  try {
    await emit(fixture,'Segundo mensaje.');await emit(fixture,'Tercer mensaje.');
    const app=createRunObservationApplication({journal:fixture.journal});
    const first=app.readConversations({runId:fixture.claim.runId,limit:1});if(first.kind!=='found')assert.fail(first.kind);
    const page=ConversationPageSchema.parse(first.value);assert.ok(page.nextCursor);
    await emit(fixture,'Mensaje posterior al corte paginado.');
    const second=app.readConversations({runId:fixture.claim.runId,limit:1,pageCursor:page.nextCursor});if(second.kind!=='found')assert.fail(second.kind);
    const next=ConversationPageSchema.parse(second.value);
    assert.equal(next.toWorldSeq,page.toWorldSeq);
    assert.ok(next.items[0]!.worldSeq>page.items[0]!.worldSeq);
    assert.ok(next.items[0]!.worldSeq<=page.toWorldSeq);
    assert.equal(app.readEvents({runId:fixture.claim.runId,pageCursor:page.nextCursor,limit:1}).kind,'invalidRequest');
    assert.equal(app.readConversations({runId:fixture.claim.runId,pageCursor:page.nextCursor,toWorldSeq:page.toWorldSeq+1}).kind,'invalidRequest');
    assert.equal(app.readConversations({runId:fixture.claim.runId,limit:101}).kind,'invalidRequest');
    assert.equal(app.readConversations({runId:fixture.claim.runId,fromWorldSeq:9,toWorldSeq:1}).kind,'invalidRequest');
    const database=new DatabaseSync(join(fixture.directory,'journal.sqlite'));
    try {
      const counts=()=>database.prepare('SELECT (SELECT COUNT(*) FROM world_commits) AS commits,(SELECT COUNT(*) FROM world_proposals) AS proposals,(SELECT COUNT(*) FROM actor_turn_jobs) AS jobs,(SELECT COUNT(*) FROM request_reservations) AS requests').get();
      const before=counts();
      app.readStage({runId:fixture.claim.runId});app.readEvents({runId:fixture.claim.runId,limit:100});app.readJobs({runId:fixture.claim.runId,limit:100});
      assert.deepEqual(counts(),before);
      database.prepare('UPDATE world_events SET payload_hash=? WHERE run_id=?').run('f'.repeat(64),fixture.claim.runId);
      assert.throws(()=>app.readEvents({runId:fixture.claim.runId}),/Hash de evento confirmado alterado/);
    } finally {database.close();}
  } finally {fixture.close();}
});

test('jobs muestran trabajo técnico y presupuesto medido sin lease, sesiones, prompt ni feedback',async()=>{
  const fixture=await setup();
  try {
    const app=createRunObservationApplication({journal:fixture.journal});
    const result=app.readJobs({runId:fixture.claim.runId,limit:1});if(result.kind!=='found')assert.fail(result.kind);
    const page=TechnicalJobPageSchema.parse(result.value);assert.equal(page.items.length,1);
    assert.equal(page.items[0]?.kind,'actor');assert.equal(page.items[0]?.state,'queued');
    assert.equal(page.items[0]?.modelCalls,0);
    assert.doesNotMatch(JSON.stringify(page),privateFields);
    assert.ok(page.nextCursor);
    assert.equal(app.readConversations({runId:fixture.claim.runId,pageCursor:page.nextCursor}).kind,'invalidRequest');
  } finally {fixture.close();}
});

async function authenticatedServer(t:TestContext,fixture:Awaited<ReturnType<typeof setup>>, observation=createRunObservationApplication({journal:fixture.journal})) {
  const server=createLocalHttpServer({catalog:await loadCatalog({repositoryRoot:process.cwd()}),shellHtml:'<!doctype html><html><head></head><body></body></html>',
    runObservation:observation,runLifecycle:createRunLifecycleApplication({journal:fixture.journal}),
    commitHumanIntervention:request=>fixture.journal.commitHumanIntervention(request),
    resolveSessionMode:candidate=>candidate.kind==='interlocutor'&&candidate.runId===fixture.claim.runId&&['visitante-prueba','visitante-b'].includes(candidate.participantId)?candidate:null});
  const {origin}=await server.listen();t.after(()=>server.close());
  const browser={Origin:origin,'Sec-Fetch-Site':'same-origin'};
  const shell=await fetch(origin+'/',{headers:browser});
  const nonce=(await shell.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(nonce);
  const session=await fetch(origin+'/api/v1/session',{method:'POST',headers:{...browser,'Content-Type':'application/json'},body:JSON.stringify({bootNonce:nonce})});
  const cookie=session.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const sessionView=SessionCreatedSchema.parse(await session.json());
  const sessionEtag=session.headers.get('etag');assert.ok(sessionEtag);
  return {origin,session:sessionView,sessionEtag,headers:{...browser,Cookie:cookie,'X-CSRF-Token':sessionView.csrfToken,'Content-Type':'application/json'}};
}

test('HTTP observación exige sesión, valida cuts/queries/cursors y devuelve DTOs públicos con ETags',async(t)=>{
  const fixture=await setup();t.after(()=>fixture.close());
  const host=await authenticatedServer(t,fixture);const base=`${host.origin}/api/v1/runs/${fixture.claim.runId}`;
  assert.equal((await fetch(base+'/stage')).status,401);
  for(const suffix of ['stage','events','conversations','jobs','director-observations','']) {
    const response=await fetch(base+(suffix?'/'+suffix:''),{headers:host.headers});
    assert.equal(response.status,200,suffix);
    assert.ok(response.headers.get('etag'));
    assert.match(response.headers.get('cache-control')??'',/no-store/);
    assert.doesNotMatch(JSON.stringify(await response.json()),privateFields);
  }
  const commitCut=await fetch(base+'/stage?atCommitIndex=0',{headers:host.headers});assert.equal(commitCut.status,200);
  const historicalStage=await commitCut.json() as {commitIndex:number;lifecycleAsOf:string;lifecycle:string};
  assert.equal(historicalStage.commitIndex,0);
  assert.equal(historicalStage.lifecycleAsOf,'current');
  assert.equal(historicalStage.lifecycle,fixture.journal.readWorldLifecycle({runId:fixture.claim.runId})?.lifecycle);
  const directorCut=await fetch(base+'/director-observations?atCommitIndex=0',{headers:host.headers});assert.equal(directorCut.status,200);
  assert.equal((await directorCut.json() as {throughCommitIndex:number}).throughCommitIndex,0);
  for(const suffix of ['/events?limit=101','/events?limit=1&limit=2','/stage?atWorldSeq=9999','/stage?atCommitIndex=9999','/stage?atWorldSeq=0&atCommitIndex=0','/stage?unknown=1','/conversations?fromWorldSeq=99&toWorldSeq=1','/jobs?cursor=garbage','/director-observations?atWorldSeq=0','/director-observations?atCommitIndex=9999']) {
    const response=await fetch(base+suffix,{headers:host.headers});assert.equal(response.status,422,suffix);
  }
  assert.equal((await fetch(`${host.origin}/api/v1/runs/${randomUUID()}/stage`,{headers:host.headers})).status,404);
});

test('intervención nueva fuera running devuelve 409 sin hechos; replay confirmado conserva 202 después de pausar/detener/cerrar',async(t)=>{
  const fixture=await setup();t.after(()=>fixture.close());const host=await authenticatedServer(t,fixture);
  const runId=fixture.claim.runId;
  const mode=await fetch(host.origin+'/api/v1/session/mode',{method:'PUT',headers:{...host.headers,'If-Match':host.sessionEtag,'Idempotency-Key':randomUUID()},
    body:JSON.stringify({kind:'interlocutor',runId,participantId:'visitante-prueba'})});
  assert.equal(mode.status,200);
  const state=fixture.journal.readWorldLifecycle({runId});assert.ok(state);
  const key=randomUUID();const body=JSON.stringify({kind:'speech',recipientCharacterIds:[actorId],channelId:'00000000-0000-4000-8000-000000000104',content:{kind:'speech',text:'Intervención idempotente.'}});
  const send=(idempotencyKey=key)=>fetch(`${host.origin}/api/v1/runs/${runId}/interventions`,{method:'POST',headers:{...host.headers,
    'Idempotency-Key':idempotencyKey,'If-Match':`"world:${runId}:r${state.worldRevision}"`},body});
  const original=await send();assert.equal(original.status,202);const receipt=await original.json();
  for(const target of ['paused','stopped','closed']) {
    const current=fixture.journal.readWorldLifecycle({runId});assert.ok(current);
    assert.equal(fixture.journal.setWorldLifecycle({runId,expectedWorldRevision:current.worldRevision,expectedConfigRevision:current.configRevision,target}),'updated');
    const before=fixture.journal.loadWorld({runId});
    const blocked=await send(randomUUID());assert.equal(blocked.status,409,target);
    assert.equal((await blocked.json()).error.code,'INVALID_LIFECYCLE');
    assert.deepEqual(fixture.journal.loadWorld({runId}),before);
    const replay=await send();assert.equal(replay.status,202,target);
    assert.equal(replay.headers.get('idempotency-replayed'),'true');
    assert.deepEqual(await replay.json(),receipt);
  }
});

test('bandeja humana queda ligada al modo y perfil de sesión, sin atribuir registros históricos',async(t)=>{
  const fixture=await setup();t.after(()=>fixture.close());const host=await authenticatedServer(t,fixture);
  const base=`${host.origin}/api/v1/runs/${fixture.claim.runId}/human-receptions`;
  assert.equal((await fetch(base,{headers:host.headers})).status,403);
  const mode=await fetch(host.origin+'/api/v1/session/mode',{method:'PUT',headers:{...host.headers,'If-Match':host.sessionEtag,'Idempotency-Key':randomUUID()},body:JSON.stringify({kind:'interlocutor',runId:fixture.claim.runId,participantId:'visitante-prueba'})});
  assert.equal(mode.status,200);
  await emit(fixture,'El humano habla; esto no prueba que haya recibido una respuesta.');
  const response=await fetch(base,{headers:host.headers});assert.equal(response.status,200);
  const page=await response.json();assert.equal(page.participantId,'visitante-prueba');assert.deepEqual(page.items,[]);
  assert.equal((await fetch(base+'?participantId=otra-identidad',{headers:host.headers})).status,422);
  assert.equal((await fetch(`${host.origin}/api/v1/runs/${randomUUID()}/human-receptions`,{headers:host.headers})).status,403);
});


test('HTTP devuelve únicamente recepción efectiva de la identidad A o B y conserva publicación pública',async(t)=>{
  const fixture=await setup();t.after(()=>fixture.close());await emit(fixture,'Comunicación confirmada');
  const app=createRunObservationApplication({journal:fixture.journal});
  const original=app.readConversations({runId:fixture.claim.runId});assert.equal(original.kind,'found');if(original.kind!=='found')assert.fail();
  const first=original.value.items[0];assert.ok(first);
  const a={participantId:'visitante-prueba',label:'Visitante'},b={participantId:'visitante-b',label:'B'};
  const page=ConversationPageSchema.parse({...original.value,items:[
    {...first,eventId:randomUUID(),requestedHumanRecipients:[a],effectiveHumanAudience:[a]},
    {...first,eventId:randomUUID(),requestedHumanRecipients:[a,b],effectiveHumanAudience:[b]},
    {...first,eventId:randomUUID()},
  ]});
  const host=await authenticatedServer(t,fixture,{...app,readConversations:()=>({kind:'found',value:page})});
  let etag=host.sessionEtag;
  for(const participantId of ['visitante-prueba','visitante-b']){
    const mode=await fetch(host.origin+'/api/v1/session/mode',{method:'PUT',headers:{...host.headers,'If-Match':etag,'Idempotency-Key':randomUUID()},body:JSON.stringify({kind:'interlocutor',runId:fixture.claim.runId,participantId})});assert.equal(mode.status,200);etag=mode.headers.get('etag')??'';
    const response=await fetch(`${host.origin}/api/v1/runs/${fixture.claim.runId}/human-receptions`,{headers:host.headers});assert.equal(response.status,200);
    const value=await response.json();assert.equal(value.participantId,participantId);assert.equal(value.items.length,1);assert.deepEqual(value.items[0].effectiveHumanAudience.map((human:{participantId:string})=>human.participantId),[participantId]);
  }
  const publicPage=await fetch(`${host.origin}/api/v1/runs/${fixture.claim.runId}/conversations`,{headers:host.headers});assert.equal(publicPage.status,200);assert.equal((await publicPage.json()).items.length,3);
});

test('stage usa presencia y etiqueta durable del corte; snapshot histórico sin humanos conserva sólo preparación',async()=>{
  const fixture=await setup();try{
    const snapshot=fixture.configuration.worldSnapshot;
    const profile=fixture.configuration.humanParticipants[0];assert.ok(profile);
    const confirmed=projectRunStage({snapshot:{...snapshot,humanParticipants:[{participantId:profile.identity.participantId,label:'Identidad en el corte',presence:{...profile.presence,position:{x:1,y:1}}}]},configuration:fixture.configuration,lifecycle:'running'});
    assert.equal(confirmed.humanParticipants[0]?.label,'Identidad en el corte');assert.equal(confirmed.humanParticipants[0]?.presenceConfirmation,'confirmed');assert.deepEqual(confirmed.humanParticipants[0]?.position,{x:1,y:1});
    const {stageMapData}=await import('../src/web/RunStageWorkspace.tsx');
    assert.match(stageMapData(confirmed).entities.find(entity=>entity.kind==='human')?.status??'',/confirmada en el corte/);
    const {humanParticipants:_ignored,...historical}=snapshot;
    const prepared=projectRunStage({snapshot:historical,configuration:fixture.configuration,lifecycle:'running'});
    assert.equal(prepared.humanParticipants[0]?.label,profile.identity.displayName);assert.equal(prepared.humanParticipants[0]?.presenceConfirmation,'prepared');assert.equal('humanParticipants' in historical,false);
    assert.match(stageMapData(prepared).entities.find(entity=>entity.kind==='human')?.status??'',/preparada/);
  }finally{fixture.close();}
});
