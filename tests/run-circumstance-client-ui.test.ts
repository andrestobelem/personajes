import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ChangeCircumstancePayloadSchema} from '../src/domain/direction-indications.ts';
import {CircumstanceOptionsSchema} from '../src/domain/direction-circumstances.ts';
import {RunIdSchema} from '../src/domain/values.ts';
import {buildCircumstanceRequest,captureCircumstanceIntent,circumstanceEtag,createRunCircumstanceClient} from '../src/web/run-circumstance-client.ts';
import {CircumstanceComposer,CircumstancePanel,sendCircumstanceIntent} from '../src/web/CircumstancePanel.tsx';

const runId=RunIdSchema.parse(randomUUID());
const bootstrap=async()=>({csrfToken:'synthetic-csrf',expiresAt:'2026-10-15T00:00:00.000Z'});
const payload=ChangeCircumstancePayloadSchema.parse({kind:'changeCircumstance',scope:{kind:'run'},operation:{kind:'setLighting',placeId:'office',level:'dim'}});
function intent(id=runId){return {runId:id,etag:circumstanceEtag(id,3,2),key:randomUUID(),payload};}
const options=CircumstanceOptionsSchema.parse({runId,worldRevision:3,directionRevision:2,lifecycle:'paused',activeSceneId:null,scope:{kind:'run'},
  places:[{id:'office',name:'Oficina sintética',description:'',width:10,height:10,lighting:'normal'}],doors:[],connections:[],devices:[]});

test('circunstancias fija dos revisiones y la misma operación para el envío y reintento',async()=>{
  const operation=intent();const captured=captureCircumstanceIntent(operation);const request=buildCircumstanceRequest({intent:captured,csrfToken:'synthetic-csrf'});
  assert.equal(request.path,`/api/v1/runs/${runId}/circumstances`);assert.equal(request.init.headers['If-Match'],operation.etag);
  assert.equal(request.init.headers['Idempotency-Key'],operation.key);assert.deepEqual(JSON.parse(request.init.body),payload);
  for(const etag of [circumstanceEtag(randomUUID(),3,2),`"circumstances:${runId}:w9007199254740992:d2"`,'"directions:bad:d2"'])assert.throws(()=>captureCircumstanceIntent({...operation,etag}));
  const client=createRunCircumstanceClient(async(_url,init)=>{
    assert.equal(new Headers(init?.headers).get('X-CSRF-Token'),'synthetic-csrf');
    return new Response(JSON.stringify({kind:'existing',receipt:{operationId:randomUUID(),worldRevision:3,directionRevision:3,worldSeq:4,commitIndex:5,recordedAt:1,effect:{kind:'unchanged'}}}),{headers:{ETag:circumstanceEtag(runId,3,3)}});
  },bootstrap);
  assert.equal((await client.mutate(operation)).kind,'existing');
});

test('lectura valida identidad y ETag compuesto sin parámetros de autoridad',async()=>{
  const client=createRunCircumstanceClient(async(url)=>{assert.equal(String(url),`/api/v1/runs/${runId}/circumstances`);return new Response(JSON.stringify(options),{headers:{ETag:circumstanceEtag(runId,3,2)}});},bootstrap);
  assert.deepEqual((await client.read(runId)).page,options);
  const wrong=createRunCircumstanceClient(async()=>new Response(JSON.stringify(options),{headers:{ETag:circumstanceEtag(runId,4,2)}}),bootstrap);
  await assert.rejects(wrong.read(runId),/no coincide/);
});

test('el formulario ofrece las cinco familias y describe el catálogo ausente sin inventarlo',()=>{
  const html=renderToStaticMarkup(React.createElement(CircumstanceComposer,{document:{page:options,etag:circumstanceEtag(runId,3,2)},enabled:true,onSubmit:()=>undefined}));
  for(const kind of ['setDoorState','setLighting','setDeviceAvailability','setEnvironment','appearObject'])assert.match(html,new RegExp(`value="${kind}"`));
  assert.match(html,/Oficina sintética · Normal/);for(const label of ['Oscuro','Tenue','Normal','Brillante'])assert.match(html,new RegExp(`>${label}</option>`));assert.match(html,/value="dim">Tenue/);assert.match(html,/disabled="">Aplicar circunstancia/);
  const panel=renderToStaticMarkup(React.createElement(CircumstancePanel,{runId,session:null}));
  assert.match(panel,/Activá Dirección arriba/);assert.match(panel,/disabled="">Actualizar circunstancias/);
  assert.doesNotMatch(panel,/Oficina sintética/);
});

for(const status of [408,500,403,409,412,422])test(`resultado HTTP ${status} conserva incertidumbre sólo si corresponde`,async()=>{
  const id=RunIdSchema.parse(randomUUID());const operation=intent(id);
  const client=createRunCircumstanceClient(async()=>new Response('{}',{status}),bootstrap);
  await assert.rejects(sendCircumstanceIntent(operation,client));
  const html=renderToStaticMarkup(React.createElement(CircumstancePanel,{runId:id,session:null}));
  if(status===408||status>=500)assert.match(html,/Reintentar la misma circunstancia/);else assert.doesNotMatch(html,/Reintentar la misma circunstancia/);
});
