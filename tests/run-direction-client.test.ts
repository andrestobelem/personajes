import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MetaIndicationPayloadSchema } from '../src/domain/direction-indications.ts';
import { RunIdSchema } from '../src/domain/values.ts';
import { buildDirectionRequest, captureDirectionIntent, createRunDirectionClient, directionEtag } from '../src/web/run-direction-client.ts';

const runId = RunIdSchema.parse('11111111-1111-4111-8111-111111111111');
const csrfToken = 'local-csrf-token';
const session = () => Promise.resolve({ csrfToken, expiresAt: '2026-10-15T00:00:00.000Z' });

test('el cliente Dirección fija alcance, ETag, CSRF e idempotencia en la misma intención', async () => {
  const payload = MetaIndicationPayloadSchema.parse({
    kind: 'metaIndication', recipients: ['maxwell-smart'], text: 'No reveles el plan todavía.', scope: { kind: 'scene', sceneId: randomUUID() },
  });
  const intent = { runId, etag: directionEtag(runId, 0), key: randomUUID(), payload };
  const captured = captureDirectionIntent(intent);
  assert.deepEqual(captured, intent);
  const built = buildDirectionRequest({ intent: captured, csrfToken });
  assert.equal(built.path, `/api/v1/runs/${runId}/directions`);
  assert.equal(built.init.method, 'POST');
  assert.equal(built.init.headers?.['If-Match'], intent.etag);
  assert.equal(built.init.headers?.['Idempotency-Key'], intent.key);
  assert.equal(built.init.headers?.['X-CSRF-Token'], csrfToken);
  assert.equal(built.init.body, JSON.stringify(payload));
  assert.throws(() => captureDirectionIntent({ ...intent, etag: directionEtag(randomUUID(), 0) }));

  let requestCount = 0;
  const client = createRunDirectionClient(async (url, init) => {
    requestCount += 1;
    assert.equal(String(url), built.path);
    assert.equal(init?.headers && new Headers(init.headers).get('Idempotency-Key'), intent.key);
    const body = { kind: 'stored', receipt: { operationId: randomUUID(), directionRevision: 1, recordedAt: 100 } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ETag: directionEtag(runId, 1) } });
  }, session);
  const result = await client.mutate(intent);
  assert.equal(result.kind, 'stored');
  assert.equal(requestCount, 1);
});

test('el cliente valida que la lectura del ledger y su ETag sean de la misma corrida', async () => {
  const client = createRunDirectionClient(async () => new Response(JSON.stringify({
    events: [], directionRevision: 4, hasMore: false,
  }), { status: 200, headers: { 'Content-Type': 'application/json', ETag: directionEtag(runId, 4) } }), session);
  const document = await client.read(runId);
  assert.equal(document.page.directionRevision, 4);
  assert.equal(document.etag, directionEtag(runId, 4));

  const wrong = createRunDirectionClient(async () => new Response(JSON.stringify({
    events: [], directionRevision: 4, hasMore: false,
  }), { status: 200, headers: { 'Content-Type': 'application/json', ETag: directionEtag(randomUUID(), 4) } }), session);
  await assert.rejects(wrong.read(runId), /no coincide/);
});


test('la lectura completa incluye revocaciones más allá de la primera página y rechaza cortes mezclados',async()=>{
  const targetOperationId=randomUUID();
  const rows=Array.from({length:1_001},(_,index)=>({runId,directionRevision:index+1,operationId:index===0?targetOperationId:randomUUID(),
    principalId:'local-operator',payload:index===1_000?{kind:'revokeMetaIndication',targetOperationId,scope:{kind:'run'}}
      :{kind:'metaIndication',recipients:['maxwell-smart'],text:`Indicación ${index+1}`,scope:{kind:'run'}},
    payloadHash:'a'.repeat(64),worldRevision:0,worldSeq:0,commitIndex:0,recordedAt:100}));
  const cuts:number[]=[];
  const client=createRunDirectionClient(async(url)=>{
    const query=new URL(String(url),'http://localhost').searchParams;
    const after=Number(query.get('afterDirectionRevision'));cuts.push(after);
    return new Response(JSON.stringify({events:rows.slice(after,after+1_000),directionRevision:1_001,hasMore:after===0}),
      {headers:{ETag:directionEtag(runId,1_001)}});
  },session);
  const complete=await client.readComplete(runId);
  assert.deepEqual(cuts,[0,1_000]);assert.equal(complete.page.hasMore,false);assert.equal(complete.page.events.length,1_001);
  const withdrawn=complete.page.events.filter(event=>event.payload.kind==='revokeMetaIndication').map(event=>event.payload);
  assert.deepEqual(withdrawn,[{kind:'revokeMetaIndication',targetOperationId,scope:{kind:'run'}}]);
  const changing=createRunDirectionClient(async(url)=>{
    const after=Number(new URL(String(url),'http://localhost').searchParams.get('afterDirectionRevision'));
    const revision=after===0?1_001:1_002;
    return new Response(JSON.stringify({events:rows.slice(after,after+1_000),directionRevision:revision,hasMore:after===0}),
      {headers:{ETag:directionEtag(runId,revision)}});
  },session);
  await assert.rejects(changing.readComplete(runId),/cambió durante la lectura/);
  for(const events of [rows.slice(0,1),[],[rows[1]]]){
    const incomplete=createRunDirectionClient(async()=>new Response(JSON.stringify({events,directionRevision:1_001,hasMore:false}),
      {headers:{ETag:directionEtag(runId,1_001)}}),session);
    await assert.rejects(incomplete.readComplete(runId),/no está completo/);
  }
});
