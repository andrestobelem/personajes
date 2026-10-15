import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { openJournal } from '../src/adapters/journal.ts';
import { createDirectionApplication } from '../src/application/direction-indications.ts';
import { DirectionMutationResultSchema, DirectionEventsPageSchema } from '../src/domain/direction-indications.ts';
import { createDramaticStructureApplication } from '../src/application/dramatic-structure.ts';
import { createRunLifecycleApplication } from '../src/application/run-lifecycle.ts';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import { runViewFixture } from './fixtures/run-view.ts';
import { createLocalHttpServer, type RunDramaticStructureApplicationPort, type RunDirectionsApplicationPort, type RunCircumstancesApplicationPort, type RunLifecycleApplicationPort } from '../src/server/http.ts';
import { DramaticStructureViewSchema } from '../src/domain/world-journal.ts';
import { SessionCreatedSchema } from '../src/domain/http.ts';
import { draftFixture } from './fixtures/continuista.ts';
import { CircumstanceWriteSchema } from '../src/domain/direction-circumstances.ts';
import { HashSchema } from '../src/domain/values.ts';

async function setup(t: TestContext, options: { rejectScenePlace?: boolean; directions?:RunDirectionsApplicationPort; circumstances?:RunCircumstancesApplicationPort; runId?:ReturnType<typeof runViewFixture>['runId'] } = {}) {
  const view = {...runViewFixture(),...(options.runId===undefined?{}:{runId:options.runId})};
  const structure = DramaticStructureViewSchema.parse({ runId: view.runId, structureRevision: 0, activeEpisodeId: null, activeSceneId: null, episodes: [], unassignedLegacyScenes: [] });
  const applied: unknown[] = [];
  const directionWrites: unknown[]=[];
  let directionRevision=0;
  const runLifecycle: RunLifecycleApplicationPort = {
    readRunView: ({ runId }) => runId === view.runId ? { ...view, activeSceneId: null } : undefined,
    controlRun: () => { throw new Error('NO_CONTROL'); },
  };
  const runDramaticStructure: RunDramaticStructureApplicationPort = {
    read: ({ runId }) => runId === view.runId ? structure : undefined,
    readSceneOptions: ({ runId }) => runId === view.runId ? { runId, worldRevision: view.worldRevision, places: [], participants: [] } : undefined,
    readEvents: ({ runId }) => runId === view.runId ? { events: [], hasMore: false, structureRevision: structure.structureRevision } : undefined,
    apply: (input) => {
      applied.push(input);
      const request = input as { operationId: string; command: { kind: string } };
      if (options.rejectScenePlace && request.command.kind === 'openScene') {
        return { kind: 'invalidState', code: 'invalidPlaceReference' };
      }
      return { kind: 'stored', receipt: { operationId: request.operationId, worldRevision: 1, worldSeq: 0, structureRevision: 1,
        commitIndex: 1, activeEpisodeId: randomUUID(), activeSceneId: null } };
    },
    readOperation: () => ({ kind: 'missing' }),
  };
  const runDirections:RunDirectionsApplicationPort={
    readEvents:({runId})=>runId===view.runId?{events:[],directionRevision,hasMore:false}:undefined,
    apply:(input)=>{directionWrites.push(input);directionRevision+=1;const request=input as {operationId:string};
      return {kind:'stored',receipt:{operationId:request.operationId,directionRevision,recordedAt:1}};},
    readOperation:()=>({kind:'missing'}),
  };
  const server = createLocalHttpServer({ catalog: await loadCatalog({ repositoryRoot: process.cwd() }),
    shellHtml: '<!doctype html><html><head></head><body></body></html>', runLifecycle, runDramaticStructure,runDirections:options.directions??runDirections,...(options.circumstances===undefined?{}:{runCircumstances:options.circumstances}),
    resolveSessionMode:(candidate)=>candidate });
  const { origin } = await server.listen();
  t.after(() => server.close());
  const originHeaders = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
  const shell = await fetch(origin + '/', { headers: originHeaders });
  const nonce = (await shell.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1]; assert.ok(nonce);
  const sessionResponse = await fetch(origin + '/api/v1/session', { method: 'POST', headers: { ...originHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ bootNonce: nonce }) });
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  const session = SessionCreatedSchema.parse(await sessionResponse.json());
  return { origin, runId: view.runId, applied,directionWrites,sessionEtag:sessionResponse.headers.get('etag'),
    headers: { ...originHeaders, Cookie: cookie, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' } };
}

test('metaindicaciones exigen modo Director, CSRF y revisión propia',async(t)=>{
  const host=await setup(t);const base=`/api/v1/runs/${host.runId}`;
  assert.equal((await fetch(`${host.origin}${base}/directions`,{headers:host.headers})).status,403,
    'la sesión observer no puede inspeccionar el canal de Dirección');
  const mode=await fetch(`${host.origin}/api/v1/session/mode`,{method:'PUT',headers:{...host.headers,
    'If-Match':host.sessionEtag??'','Idempotency-Key':randomUUID()},body:JSON.stringify({kind:'director',runId:host.runId,scope:{kind:'run'}})});
  assert.equal(mode.status,200,await mode.clone().text());
  const read=await fetch(`${host.origin}${base}/directions`,{headers:host.headers});
  assert.equal(read.status,200);assert.equal(read.headers.get('etag'),`"directions:${host.runId}:d0"`);
  const key=randomUUID();const payload={kind:'metaIndication',recipients:['maxwell-smart'],text:'Reserva el dato hasta comprobarlo.',scope:{kind:'run'}};
  const post=(headers:Record<string,string>)=>fetch(`${host.origin}${base}/directions`,{method:'POST',headers:{...host.headers,
    'Idempotency-Key':key,'If-Match':read.headers.get('etag')??'',...headers},body:JSON.stringify(payload)});
  assert.equal((await post({'X-CSRF-Token':'incorrecto'})).status,403);
  assert.equal(host.directionWrites.length,0);
  const accepted=await post({});assert.equal(accepted.status,200,await accepted.clone().text());
  assert.equal(accepted.headers.get('etag'),`"directions:${host.runId}:d1"`);
  const submitted=host.directionWrites[0] as {runId:string;payload:{kind:string;recipients:string[];text:string;scope:{kind:string}}};
  assert.equal(submitted.runId,host.runId);assert.deepEqual(submitted.payload,payload);
  assert.equal((await post({})).status,200);assert.equal(host.directionWrites.length,1,
    'la repetición exacta no vuelve a ejecutar el comando');
});

test('estructura dramática expone corte y eventos; la apertura exige CSRF y mantiene la identidad al reintentar', async (t) => {
  const host = await setup(t);
  const base = `/api/v1/runs/${host.runId}`;
  const read = await fetch(`${host.origin}${base}/dramatic-structure`, { headers: host.headers });
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('etag'), `"structure:${host.runId}:w${runViewFixture().worldRevision}:s0"`);
  const structure = await read.json() as { activeEpisodeId: string | null; episodes: unknown[] };
  assert.deepEqual(structure.episodes, []);
  assert.equal(structure.activeEpisodeId, null);
  const events = await fetch(`${host.origin}${base}/structure-events?afterStructureRevision=0&limit=10`, { headers: host.headers });
  assert.equal(events.status, 200);
  const options = await fetch(`${host.origin}${base}/dramatic-structure/scene-options`, { headers: host.headers });
  assert.equal(options.status, 200);
  assert.equal(options.headers.get('etag'), `"scene-options:${host.runId}:w${runViewFixture().worldRevision}"`);

  const key = randomUUID();
  const etag = read.headers.get('etag'); assert.ok(etag);
  const path = `${host.origin}${base}/episodes`;
  const post = (headers: Record<string, string>) => fetch(path, { method: 'POST', headers: { ...host.headers, 'Idempotency-Key': key, 'If-Match': etag, ...headers }, body: JSON.stringify({ title: 'Planteamiento' }) });
  assert.equal((await post({ 'X-CSRF-Token': 'incorrecto' })).status, 403);
  assert.equal(host.applied.length, 0);
  const response = await post({});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('etag'), `"structure:${host.runId}:w1:s1"`);
  const body = await response.json() as { kind: string; receipt: { operationId: string } };
  assert.equal(body.kind, 'stored');
  assert.equal(host.applied.length, 1);
  const command = host.applied[0] as { expectedWorldRevision: number; expectedStructureRevision: number; principalId: string; idempotencyKey: string; operationId: string; command: { kind: string; title?: string } };
  assert.equal(command.expectedWorldRevision, runViewFixture().worldRevision);
  assert.equal(command.expectedStructureRevision, 0);
  assert.equal(command.principalId, 'local-operator');
  assert.equal(command.idempotencyKey, key);
  assert.equal(command.command.kind, 'openEpisode');
  assert.equal(command.command.title, 'Planteamiento');
  assert.equal(body.receipt.operationId, command.operationId);
  assert.equal((await post({})).status, 200);
  assert.equal(host.applied.length, 2);
  assert.equal((host.applied[0] as { operationId: string }).operationId, (host.applied[1] as { operationId: string }).operationId);
});

test('la referencia a un lugar inexistente devuelve 422 de validación', async (t) => {
  const host = await setup(t, { rejectScenePlace: true });
  const base = `/api/v1/runs/${host.runId}`;
  const read = await fetch(`${host.origin}${base}/dramatic-structure`, { headers: host.headers });
  const etag = read.headers.get('etag'); assert.ok(etag);
  const response = await fetch(`${host.origin}${base}/scenes`, { method: 'POST', headers: {
    ...host.headers, 'Idempotency-Key': randomUUID(), 'If-Match': etag,
  }, body: JSON.stringify({ label: 'Escena inválida', participantIds: ['maxwell-smart'], placeIds: ['lugar-inexistente'] }) });
  const body = await response.json() as { error: { code: string } };
  assert.equal(host.applied.length, 1, JSON.stringify(body));
  assert.equal((host.applied[0] as { command: { kind: string } }).command.kind, 'openScene');
  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, 'INVALID_DRAMATIC_STRUCTURE');
});

test('HTTP y journal SQLite reproducen una apertura y rechazan lugares desconocidos sin commit', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-structure-http-'));
  const journal = openJournal({ path: join(directory, 'journal.sqlite') });
  let closeServer: (() => Promise<void>) | undefined;
  t.after(async () => {
    if (closeServer !== undefined) await closeServer();
    journal.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const ready = validateRunConfiguration({ draft: draftFixture() });
  assert.equal(ready.kind, 'ready');
  if (ready.kind !== 'ready') assert.fail('La fixture debe quedar Ready');
  const configuration = ready.configuration;
  const initialScene = configuration.worldSnapshot.scenes.find((scene) => scene.id === configuration.worldSnapshot.activeSceneId);
  assert.ok(initialScene);
  const actors = configuration.roster.preparedCharacters.filter((actor) => initialScene.participantIds.includes(actor.characterId));
  assert.ok(actors.length > 0);
  assert.equal(journal.registerWorldRun({
    initialSnapshot: configuration.worldSnapshot,
    configurationRevision: configuration.configRevision,
    configuration,
    continuityFence: { kind: 'prepared-contexts', atWorldSeq: configuration.worldSnapshot.seq, contexts: actors.map((actor) => ({
      actorId: actor.characterId, continuityId: actor.continuity.continuityId, continuityRevision: actor.continuity.revision,
      continuityContentHash: actor.continuity.contentHash, identityVersion: actor.identityVersion,
      preparedContextHash: HashSchema.parse('a'.repeat(64)),
    })) },
    lifecycle: 'running',
  }), 'stored');
  assert.equal(journal.applyDramaticStructureCommand({
    runId: configuration.runId, principalId: 'local-operator', operationId: randomUUID(), idempotencyKey: randomUUID(),
    expectedWorldRevision: configuration.worldSnapshot.revision, expectedStructureRevision: 0,
    command: { kind: 'closeScene', sceneId: initialScene.id, reason: 'Preparación del caso de integración.' },
  }).kind, 'stored');

  const lifecycle = createRunLifecycleApplication({ journal });
  const runLifecycle: RunLifecycleApplicationPort = {
    readRunView: ({ runId }) => lifecycle.readRunView({ runId }),
    controlRun: () => { throw new Error('NO_CONTROL'); },
  };
  const server = createLocalHttpServer({
    catalog: await loadCatalog({ repositoryRoot: process.cwd() }),
    shellHtml: '<!doctype html><html><head></head><body></body></html>',
    runLifecycle,
    runDramaticStructure: createDramaticStructureApplication({ journal }),
  });
  const { origin } = await server.listen();
  closeServer = () => server.close();
  const originHeaders = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
  const shell = await fetch(origin + '/', { headers: originHeaders });
  const nonce = (await shell.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1]; assert.ok(nonce);
  const sessionResponse = await fetch(origin + '/api/v1/session', { method: 'POST', headers: { ...originHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ bootNonce: nonce }) });
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  const session = SessionCreatedSchema.parse(await sessionResponse.json());
  const headers = { ...originHeaders, Cookie: cookie, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' };
  const base = `/api/v1/runs/${configuration.runId}`;

  const initialRead = await fetch(`${origin}${base}/dramatic-structure`, { headers });
  assert.equal(initialRead.status, 200);
  const initialEtag = initialRead.headers.get('etag'); assert.ok(initialEtag);
  const key = randomUUID();
  const openEpisode = () => fetch(`${origin}${base}/episodes`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': key, 'If-Match': initialEtag }, body: JSON.stringify({ title: 'Integración HTTP y SQLite' }) });
  const first = await openEpisode();
  assert.equal(first.status, 200, await first.clone().text());
  const firstBody = await first.json() as { kind: string; receipt: unknown };
  assert.equal(firstBody.kind, 'stored');
  const replay = await openEpisode();
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  const replayBody = await replay.json() as { kind: string; receipt: unknown };
  assert.equal(replayBody.kind, 'existing');
  assert.deepEqual(replayBody.receipt, firstBody.receipt);

  const structureRead = await fetch(`${origin}${base}/dramatic-structure`, { headers });
  const structureEtag = structureRead.headers.get('etag'); assert.ok(structureEtag);
  const optionsResponse = await fetch(`${origin}${base}/dramatic-structure/scene-options`, { headers });
  const options = await optionsResponse.json() as { participants: Array<{ characterId: string; placeId: string }> };
  const participant = options.participants[0]; assert.ok(participant);
  const invalidScene = await fetch(`${origin}${base}/scenes`, { method: 'POST', headers: {
    ...headers, 'Idempotency-Key': randomUUID(), 'If-Match': structureEtag,
  }, body: JSON.stringify({ label: 'Referencia inválida', participantIds: [participant.characterId], placeIds: [participant.placeId, 'lugar-inexistente'] }) });
  assert.equal(invalidScene.status, 422);
  const invalidBody = await invalidScene.json() as { error: { code: string } };
  assert.equal(invalidBody.error.code, 'INVALID_DRAMATIC_STRUCTURE');
  assert.equal(journal.loadWorld({ runId: configuration.runId })?.revision, configuration.worldSnapshot.revision + 2,
    'cierre de escena y apertura de episodio son los únicos commits del caso');
  assert.equal(journal.readDramaticStructure({ runId: configuration.runId })?.activeSceneId, null);

  const historicalInitial = await fetch(`${origin}${base}/dramatic-structure?worldRevision=${configuration.worldSnapshot.revision}&worldSeq=${configuration.worldSnapshot.seq}`, { headers });
  assert.equal(historicalInitial.status, 200, await historicalInitial.clone().text());
  const historicalInitialValue = await historicalInitial.json() as { episodes: unknown[]; structureRevision: number; commitIndex: number };
  assert.deepEqual(historicalInitialValue.episodes, [], 'el corte anterior conserva la ausencia de episodios');
  assert.equal(historicalInitialValue.structureRevision, 0);
  assert.equal(historicalInitialValue.commitIndex, 0);

  const historicalLatest = await fetch(`${origin}${base}/dramatic-structure?worldRevision=${configuration.worldSnapshot.revision + 2}&worldSeq=${configuration.worldSnapshot.seq}`, { headers });
  assert.equal(historicalLatest.status, 200, await historicalLatest.clone().text());
  assert.equal(historicalLatest.headers.get('etag'), `"structure:${configuration.runId}:w${configuration.worldSnapshot.revision + 2}:s2:c2"`);
  const historicalLatestValue = await historicalLatest.json() as { episodes: Array<{ title: string | null; lifecycle: string }>; structureRevision: number; commitIndex: number };
  assert.deepEqual(historicalLatestValue.episodes.map(({ title, lifecycle }) => ({ title, lifecycle })), [{ title: 'Integración HTTP y SQLite', lifecycle: 'open' }]);
  assert.equal(historicalLatestValue.structureRevision, 2);
  assert.equal(historicalLatestValue.commitIndex, 2);

  const partialCut = await fetch(`${origin}${base}/dramatic-structure?worldRevision=${configuration.worldSnapshot.revision}`, { headers });
  assert.equal(partialCut.status, 422);
  const futureCut = await fetch(`${origin}${base}/dramatic-structure?worldRevision=${configuration.worldSnapshot.revision + 50}&worldSeq=${configuration.worldSnapshot.seq}`, { headers });
  assert.equal(futureCut.status, 422);
});


test('HTTP y SQLite revocan una metaindicación sin reescribir contexto congelado ni hechos',async(t)=>{
  const directory=mkdtempSync(join(tmpdir(),'personajes-direction-revoke-http-'));
  const journal=openJournal({path:join(directory,'journal.sqlite')});
  t.after(()=>{journal.close();rmSync(directory,{recursive:true,force:true});});
  const ready=validateRunConfiguration({draft:draftFixture()});
  if(ready.kind!=='ready')assert.fail('Fixture no Ready');
  const configuration=ready.configuration;
  journal.registerWorldRun({initialSnapshot:configuration.worldSnapshot,configurationRevision:configuration.configRevision,
    configuration,continuityFence:{kind:'prepared-contexts',atWorldSeq:configuration.worldSnapshot.seq,
      contexts:configuration.roster.preparedCharacters.map(actor=>({actorId:actor.characterId,
        continuityId:actor.continuity.continuityId,continuityRevision:actor.continuity.revision,
        continuityContentHash:actor.continuity.contentHash,identityVersion:actor.identityVersion,preparedContextHash:HashSchema.parse('a'.repeat(64))}))},lifecycle:'running'});
  const original=journal.loadWorld({runId:configuration.runId});assert.ok(original);
  const host=await setup(t,{directions:createDirectionApplication({journal}),runId:configuration.runId});
  const base=`${host.origin}/api/v1/runs/${host.runId}/directions`;
  const mode=await fetch(`${host.origin}/api/v1/session/mode`,{method:'PUT',headers:{...host.headers,
    'If-Match':host.sessionEtag??'','Idempotency-Key':randomUUID()},body:JSON.stringify({kind:'director',runId:host.runId,scope:{kind:'run'}})});
  assert.equal(mode.status,200,await mode.clone().text());
  const actor=configuration.roster.preparedCharacters[0];assert.ok(actor);
  const post=(payload:unknown,revision:number,key=randomUUID(),extra:Record<string,string>={})=>fetch(base,{method:'POST',
    headers:{...host.headers,'If-Match':`"directions:${host.runId}:d${revision}"`,'Idempotency-Key':key,...extra},body:JSON.stringify(payload)});
  const first=await post({kind:'metaIndication',recipients:[actor.characterId],text:'Observá antes de intervenir.',scope:{kind:'run'}},0);
  assert.equal(first.status,200,await first.clone().text());
  const accepted=DirectionMutationResultSchema.parse(await first.json());
  if(accepted.kind!=='stored')assert.fail('Metaindicación no almacenada');
  const revoke={kind:'revokeMetaIndication',targetOperationId:accepted.receipt.operationId,scope:{kind:'run'}};
  for(const text of ['\0','á'.repeat(2_001)])assert.equal((await post({kind:'metaIndication',recipients:[actor.characterId],text,scope:{kind:'run'}},1)).status,422,'límite UTF-8 y NUL también en host');
  assert.equal((await post(revoke,1,randomUUID(),{'X-CSRF-Token':'incorrecto'})).status,403);
  assert.equal((await post({...revoke,text:'cambio no autorizado'},1)).status,422,'payload de revocación cerrado');
  assert.equal((await post({...revoke,scope:{kind:'scene',sceneId:original.activeSceneId}},1)).status,422,'alcance distinto al original');
  assert.equal((await post({...revoke,targetOperationId:randomUUID()},1)).status,404);
  assert.equal((await post(revoke,0)).status,412,'CAS anterior no revoca');
  assert.equal(journal.readActorMetaIndications({runId:host.runId,actorId:actor.characterId,directionRevision:1,
    activeSceneId:original.activeSceneId}).indications.length,1);
  journal.setWorldLifecycle({runId:host.runId,expectedWorldRevision:original.revision,expectedConfigRevision:configuration.configRevision,target:'paused'});
  const key=randomUUID();const removed=await post(revoke,1,key);
  assert.equal(removed.status,200,await removed.clone().text());
  const removedBody=DirectionMutationResultSchema.parse(await removed.json());
  if(removedBody.kind!=='stored')assert.fail('Revocación no almacenada');
  assert.equal(removedBody.receipt.directionRevision,2);
  const replay=await post(revoke,1,key);assert.equal(replay.status,200);
  const replayBody=DirectionMutationResultSchema.parse(await replay.json());
  assert.equal(replay.headers.get('idempotency-replayed'),'true');
  if(replayBody.kind!=='existing'&&replayBody.kind!=='stored')assert.fail('Replay no recuperó recibo');
  assert.deepEqual(replayBody.receipt,removedBody.receipt);
  assert.equal((await post(revoke,2)).status,409,'una segunda operación no vuelve a revocar');
  assert.equal(journal.readActorMetaIndications({runId:host.runId,actorId:actor.characterId,directionRevision:1,
    activeSceneId:original.activeSceneId}).indications.length,1,'corte anterior conserva indicación');
  assert.equal(journal.readActorMetaIndications({runId:host.runId,actorId:actor.characterId,directionRevision:2,
    activeSceneId:original.activeSceneId}).indications.length,0,'nuevo corte excluye indicación revocada');
  const page=DirectionEventsPageSchema.parse(await (await fetch(base,{headers:host.headers})).json());
  assert.deepEqual(page.events.map(event=>event.payload.kind),['metaIndication','revokeMetaIndication']);
  assert.deepEqual(journal.loadWorld({runId:host.runId}),original,'ni metaindicación ni revocación generan hechos');
  const changedKey=await post({...revoke,targetOperationId:randomUUID()},1,key);assert.equal(changedKey.status,409);
  const scopeMode=await fetch(`${host.origin}/api/v1/session`,{headers:host.headers});
  const currentModeEtag=scopeMode.headers.get('etag');assert.ok(currentModeEtag);
  assert.equal((await fetch(`${host.origin}/api/v1/session/mode`,{method:'PUT',headers:{...host.headers,
    'If-Match':currentModeEtag,'Idempotency-Key':randomUUID()},body:JSON.stringify({kind:'director',runId:host.runId,
      scope:{kind:'scene',sceneId:original.activeSceneId}})})).status,200);
  assert.equal((await post(revoke,2)).status,403,'sesión de escena no revoca indicación de corrida');
});


test('circunstancias HTTP exige Director y CSRF, usa scope de sesión y dos revisiones; reintento exacto no duplica',async(t)=>{
  const reads:unknown[]=[];const writes:unknown[]=[];
  const port:RunCircumstancesApplicationPort={
    readOptions(input){reads.push(input);return {runId:input.runId,worldRevision:4,directionRevision:2,lifecycle:'paused',activeSceneId:null,scope:input.scope,places:[{id:'office',name:'Oficina sintética',description:'',width:10,height:10,lighting:'normal'}],doors:[],connections:[],devices:[]};},
    apply(input){writes.push(input);return {kind:'stored',receipt:{operationId:input.operationId,worldRevision:5,directionRevision:3,worldSeq:6,commitIndex:7,recordedAt:1,effect:{kind:'applied',eventIds:[randomUUID()],recipientActorIds:[]}}};},
  };
  const host=await setup(t,{circumstances:port});const url=`${host.origin}/api/v1/runs/${host.runId}/circumstances`;
  assert.equal((await fetch(url,{headers:host.headers})).status,403);assert.equal(reads.length,0);
  const mode=await fetch(`${host.origin}/api/v1/session/mode`,{method:'PUT',headers:{...host.headers,'If-Match':host.sessionEtag??'','Idempotency-Key':randomUUID()},body:JSON.stringify({kind:'director',runId:host.runId,scope:{kind:'run'}})});assert.equal(mode.status,200);
  const read=await fetch(url,{headers:host.headers});assert.equal(read.status,200,await read.clone().text());
  const etag=`"circumstances:${host.runId}:w4:d2"`;assert.equal(read.headers.get('etag'),etag);assert.deepEqual(reads,[{runId:host.runId,scope:{kind:'run'}}]);
  assert.equal((await fetch(url+'?scope=run',{headers:host.headers})).status,422);
  const key=randomUUID();const payload={kind:'changeCircumstance',scope:{kind:'run'},operation:{kind:'setLighting',placeId:'office',level:'dim'}};
  const post=(headers:Record<string,string>={},body:unknown=payload)=>fetch(url,{method:'POST',headers:{...host.headers,'If-Match':etag,'Idempotency-Key':key,...headers},body:JSON.stringify(body)});
  assert.equal((await post({'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await post({'If-Match':`"circumstances:${randomUUID()}:w4:d2"`})).status,412);
  assert.equal((await post({}, {...payload,actorId:'maxwell-smart'})).status,422);
  assert.equal((await post({}, {...payload,operation:{kind:'setLighting',placeId:'office',level:'dim',patch:{}}})).status,422);
  assert.equal(writes.length,0);
  const accepted=await post();assert.equal(accepted.status,200,await accepted.clone().text());assert.equal(accepted.headers.get('etag'),`"circumstances:${host.runId}:w5:d3"`);
  assert.equal(writes.length,1);const submitted=portInput(writes[0]);assert.equal(submitted.expectedWorldRevision,4);assert.equal(submitted.expectedDirectionRevision,2);assert.deepEqual(submitted.payload,payload);
  assert.equal((await post()).status,200);assert.equal(writes.length,1);
  assert.equal((await post({}, {...payload,operation:{...payload.operation,level:'bright'}})).status,409);assert.equal(writes.length,1);
});

function portInput(value:unknown){return CircumstanceWriteSchema.parse(value);}

for(const scenario of [
  {result:{kind:'conflict',worldRevision:5,directionRevision:3},status:412},
  {result:{kind:'missing'},status:404},
  {result:{kind:'idempotencyConflict'},status:409},
  {result:{kind:'invalidState',code:'workPending'},status:409},
  {result:{kind:'invalidState',code:'runNotActive'},status:409},
  {result:{kind:'invalidState',code:'outside-scope'},status:422},
])test(`circunstancias HTTP traduce ${JSON.stringify(scenario.result)} a ${scenario.status}`,async(t)=>{
  const sceneId=randomUUID();const writes:unknown[]=[];
  const host=await setup(t,{circumstances:{readOptions:()=>undefined,apply:input=>{writes.push(input);return scenario.result;}}});
  const mode=await fetch(`${host.origin}/api/v1/session/mode`,{method:'PUT',headers:{...host.headers,'If-Match':host.sessionEtag??'','Idempotency-Key':randomUUID()},body:JSON.stringify({kind:'director',runId:host.runId,scope:{kind:'scene',sceneId}})});assert.equal(mode.status,200);
  const url=`${host.origin}/api/v1/runs/${host.runId}/circumstances`;
  const payload={kind:'changeCircumstance',scope:{kind:'scene',sceneId},operation:{kind:'setDoorState',doorId:randomUUID(),state:'closed'}};
  const post=(scope:unknown)=>fetch(url,{method:'POST',headers:{...host.headers,'If-Match':`"circumstances:${host.runId}:w1:d0"`,'Idempotency-Key':randomUUID()},body:JSON.stringify({...payload,scope})});
  assert.equal((await post({kind:'run'})).status,403);assert.equal((await post({kind:'scene',sceneId:randomUUID()})).status,403);assert.equal(writes.length,0);
  const result=await post(payload.scope);assert.equal(result.status,scenario.status,await result.clone().text());assert.equal(writes.length,1);
});
