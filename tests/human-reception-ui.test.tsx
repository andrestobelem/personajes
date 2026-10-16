import assert from 'node:assert/strict';
import {test} from 'node:test';
import {act} from 'react';
import {JSDOM} from 'jsdom';
import {createRoot} from 'react-dom/client';
import {HumanInteractionPanel} from '../src/web/HumanInteractionPanel.tsx';
import {SessionModeSchema} from '../src/domain/http.ts';
import {HumanParticipantIdSchema} from '../src/domain/values.ts';
import {conversationFixture,stageFixture} from './fixtures/run-stage.ts';
import type {HumanInteractionClient,SessionDocument} from '../src/web/human-interaction-client.ts';

test('bandeja React cambia de identidad sin mostrar respuestas de A en B',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{pretendToBeVisual:true});
  const restore=['window','document','IS_REACT_ACT_ENVIRONMENT'].map(name=>({name,descriptor:Object.getOwnPropertyDescriptor(globalThis,name)}));
  Object.defineProperty(globalThis,'window',{configurable:true,value:dom.window});Object.defineProperty(globalThis,'document',{configurable:true,value:dom.window.document});Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
  const container=dom.window.document.getElementById('root');assert.ok(container);const root=createRoot(container);
  const stage=stageFixture();
  let mode=SessionModeSchema.parse({kind:'interlocutor',runId:stage.runId,participantId:'visitante-a'});
  const session=():SessionDocument=>({etag:'"session:r1"',view:{kind:'authenticated',expiresAt:'2099-01-01T00:00:00Z',capabilities:[],mode,sessionRevision:stage.configRevision}});
  const requested:string[]=[];
  const api={session:async()=>session(),context:async()=>{throw new Error('No se solicita contexto para leer');},mutate:async(intent)=>{assert.equal(intent.kind,'mode');if(intent.kind!=='mode')throw new Error('Unexpected speech');mode=intent.mode;return{kind:'mode',document:session()};},receptions:async(_runId,participant,from=0)=>{requested.push(participant);if(from>0)return{throughWorldSeq:stage.worldSeq,items:[]};return{throughWorldSeq:stage.worldSeq,items:[{...conversationFixture(),content:{kind:'speech',text:`Respuesta para ${participant}`},effectiveHumanAudience:[{participantId:HumanParticipantIdSchema.parse(participant),label:participant}]}]};}} satisfies HumanInteractionClient;
  try{
    await act(async()=>root.render(<HumanInteractionPanel runId={stage.runId} lifecycle="running" participants={[{participantId:HumanParticipantIdSchema.parse('visitante-a'),label:'A'},{participantId:HumanParticipantIdSchema.parse('visitante-b'),label:'B'}]} api={api}/>));
    assert.match(container.textContent??'',/Respuesta para visitante-a/);
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,2050));});
    assert.match(container.textContent??'',/Respuesta para visitante-a/);
    const select=container.querySelector('select');assert.ok(select);
    await act(async()=>{select.value='visitante-b';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    assert.doesNotMatch(container.textContent??'',/Respuesta para visitante-a/);
    const activate=[...container.querySelectorAll('button')].find(button=>button.textContent==='Activar Interlocución');assert.ok(activate);
    await act(async()=>activate.click());
    assert.match(container.textContent??'',/Respuesta para visitante-b/);
    assert.doesNotMatch(container.textContent??'',/Respuesta para visitante-a/);
    assert.deepEqual(requested,['visitante-a','visitante-a','visitante-b']);
    assert.match(container.textContent??'',/Recibir no confirma lectura ni memoria ICM/);
  }finally{await act(async()=>root.unmount());dom.window.close();for(const{name,descriptor}of restore){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}}
});

test('conversación muestra recepción humana sin receptores personaje, y conserva histórico desconocido',async()=>{
  const {renderToStaticMarkup}=await import('react-dom/server');
  const {ConversationMessage}=await import('../src/web/StageConversation.tsx');
  const stage=stageFixture();
  const original=conversationFixture();
  const message={...original,requestedRecipients:[],requestedRecipientCount:0,effectiveAudience:[],effectiveAudienceCount:0,deliveries:[],requestedHumanRecipients:[{participantId:HumanParticipantIdSchema.parse('visitante-a'),label:'Visitante A'}],effectiveHumanAudience:[{participantId:HumanParticipantIdSchema.parse('visitante-a'),label:'Visitante A'}]};
  const html=renderToStaticMarkup(<ConversationMessage item={message} clock={stage.clock} onSelectEvent={()=>{}}/>);
  assert.match(html,/Recepción humana confirmada/);assert.match(html,/Visitante A/);assert.doesNotMatch(html,/Nadie recibió/);assert.match(html,/No confirma lectura ni memoria ICM/);
  const legacy=renderToStaticMarkup(<ConversationMessage item={{...original,requestedRecipients:[],effectiveAudience:[],requestedRecipientCount:0,effectiveAudienceCount:0,deliveries:[]}} clock={stage.clock} onSelectEvent={()=>{}}/>);
  assert.match(legacy,/Sin registro histórico/);assert.doesNotMatch(legacy,/Nadie recibió/);
});

test('escena cerrada sin ocupantes conserva bandeja histórica desde perfiles configurados, sin habilitar habla',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{pretendToBeVisual:true});
  const restore=['window','document','IS_REACT_ACT_ENVIRONMENT'].map(name=>({name,descriptor:Object.getOwnPropertyDescriptor(globalThis,name)}));
  Object.defineProperty(globalThis,'window',{configurable:true,value:dom.window});Object.defineProperty(globalThis,'document',{configurable:true,value:dom.window.document});Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
  const container=dom.window.document.getElementById('root');assert.ok(container);const root=createRoot(container);
  const {RunStageWorkspace}=await import('../src/web/RunStageWorkspace.tsx');
  const {RunStageViewSchema,ConversationPageSchema,ConfirmedEventPageSchema,TechnicalJobPageSchema,DirectorObservationListSchema}=await import('../src/domain/run-observation.ts');
  const stage=RunStageViewSchema.parse({...stageFixture(),lifecycle:'closed',activeSceneId:null,scenes:[],places:[],entities:[],humanParticipants:[]});
  const participantId=HumanParticipantIdSchema.parse('visitante-a');
  const message={...conversationFixture(),content:{kind:'speech' as const,text:'Respuesta conservada antes del cierre'},effectiveHumanAudience:[{participantId,label:'Visitante A'}]};
  const session:SessionDocument={etag:'"session:r1"',view:{kind:'authenticated',expiresAt:'2099-01-01T00:00:00Z',capabilities:[],mode:{kind:'interlocutor',runId:stage.runId,participantId},sessionRevision:stage.configRevision}};
  const humanApi={session:async()=>session,context:async()=>{throw new Error('No se pide contexto para leer');},mutate:async()=>{throw new Error('No se escribe para leer');},receptions:async()=>({items:[message],throughWorldSeq:stage.worldSeq})} satisfies HumanInteractionClient;
  const base={runId:stage.runId,fromWorldSeq:0,toWorldSeq:stage.worldSeq,lastWorldSeq:stage.worldSeq,nextCursor:null,items:[]};
  const api={stage:async()=>stage,conversations:async()=>ConversationPageSchema.parse({...base,kind:'conversation-page'}),events:async()=>ConfirmedEventPageSchema.parse({...base,kind:'confirmed-event-page'}),jobs:async()=>TechnicalJobPageSchema.parse({kind:'technical-job-page',runId:stage.runId,items:[],nextCursor:null}),directorObservations:async()=>DirectorObservationListSchema.parse({kind:'director-observation-list',runId:stage.runId,throughWorldSeq:stage.worldSeq,throughCommitIndex:stage.commitIndex,items:[]})};
  try{
    await act(async()=>root.render(<RunStageWorkspace runId={stage.runId} live api={api} humanInteractionApi={humanApi} configuredHumanParticipants={[{participantId,label:'Visitante A'}]}/>));
    assert.match(container.textContent??'',/Respuesta conservada antes del cierre/);
    const identitySelect=container.querySelector('[aria-label="Interlocución humana"] select');assert.ok(identitySelect instanceof dom.window.HTMLSelectElement);assert.equal(identitySelect.value,participantId);
    const send=[...container.querySelectorAll('button')].find(button=>button.textContent?.startsWith('Enviar intervención'));assert.ok(send);assert.equal(send.disabled,true);
    assert.equal(stage.humanParticipants.length,0);
  }finally{await act(async()=>root.unmount());dom.window.close();for(const{name,descriptor}of restore){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}}
});

test('cliente pagina receipts y React conserva cada uno una sola vez al repetir la frontera incremental',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{pretendToBeVisual:true});
  const restore=['window','document','IS_REACT_ACT_ENVIRONMENT'].map(name=>({name,descriptor:Object.getOwnPropertyDescriptor(globalThis,name)}));
  Object.defineProperty(globalThis,'window',{configurable:true,value:dom.window});Object.defineProperty(globalThis,'document',{configurable:true,value:dom.window.document});Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
  const container=dom.window.document.getElementById('root');assert.ok(container);const root=createRoot(container);
  const {createHumanInteractionClient}=await import('../src/web/human-interaction-client.ts');
  const {ConversationViewSchema}=await import('../src/domain/run-observation.ts');
  const stage=stageFixture();const participantId=HumanParticipantIdSchema.parse('visitante-a');
  const receipts=[7,8,9].map(seq=>ConversationViewSchema.parse({...conversationFixture(),eventId:crypto.randomUUID(),worldSeq:seq,content:{kind:'speech',text:`Recepción ${seq}`},effectiveHumanAudience:[{participantId,label:'Visitante A'}]}));
  const urls:string[]=[];
  const client=createHumanInteractionClient(async(input)=>{
    const url=new URL(String(input),'http://localhost');urls.push(url.search);
    const incremental=url.searchParams.has('fromWorldSeq');
    const second=url.searchParams.has('pageCursor');
    return new Response(JSON.stringify({kind:'human-reception-page',runId:stage.runId,participantId,fromWorldSeq:incremental?8:0,toWorldSeq:incremental?9:8,lastWorldSeq:9,nextCursor:incremental||second?null:'segunda-pagina',items:incremental?receipts.slice(1):second?receipts.slice(1,2):receipts.slice(0,1)}));
  });
  const session:SessionDocument={etag:'"session:r1"',view:{kind:'authenticated',expiresAt:'2099-01-01T00:00:00Z',capabilities:[],mode:{kind:'interlocutor',runId:stage.runId,participantId},sessionRevision:stage.configRevision}};
  const api={session:async()=>session,context:async()=>{throw new Error('No contexto');},mutate:async()=>{throw new Error('No escritura');},receptions:client.receptions} satisfies HumanInteractionClient;
  try{
    await act(async()=>root.render(<HumanInteractionPanel runId={stage.runId} lifecycle="closed" participants={[{participantId,label:'Visitante A'}]} api={api}/>));
    const inbox=container.querySelector('[aria-label="Recepción de la identidad activa"]');assert.ok(inbox);
    assert.equal(inbox.querySelectorAll('li').length,2);assert.match(inbox.textContent??'',/Recepción 7/);assert.match(inbox.textContent??'',/Recepción 8/);
    assert.match(urls[1]??'',/pageCursor=segunda-pagina/);
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,2050));});
    assert.equal(inbox.querySelectorAll('li').length,3);
    assert.deepEqual([...inbox.querySelectorAll('li')].map(item=>item.textContent?.match(/Recepción \d/)?.[0]),['Recepción 7','Recepción 8','Recepción 9']);
    assert.match(urls[2]??'',/fromWorldSeq=8/);
  }finally{await act(async()=>root.unmount());dom.window.close();for(const{name,descriptor}of restore){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}}
});

test('receipt tardío de A no aparece después de activar identidad B',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{pretendToBeVisual:true});
  const restore=['window','document','IS_REACT_ACT_ENVIRONMENT'].map(name=>({name,descriptor:Object.getOwnPropertyDescriptor(globalThis,name)}));
  Object.defineProperty(globalThis,'window',{configurable:true,value:dom.window});Object.defineProperty(globalThis,'document',{configurable:true,value:dom.window.document});Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
  const container=dom.window.document.getElementById('root');assert.ok(container);const root=createRoot(container);
  const stage=stageFixture();
  type Receipts=Awaited<ReturnType<HumanInteractionClient['receptions']>>;
  let resolveA:(value:Receipts)=>void=()=>{throw new Error('Promesa sin inicializar');};
  const pendingA=new Promise<Receipts>(resolve=>{resolveA=resolve;});
  let mode=SessionModeSchema.parse({kind:'interlocutor',runId:stage.runId,participantId:'visitante-a'});
  const session=():SessionDocument=>({etag:'"session:r1"',view:{kind:'authenticated',expiresAt:'2099-01-01T00:00:00Z',capabilities:[],mode,sessionRevision:stage.configRevision}});
  function receipt(participant:string):Receipts{return{throughWorldSeq:stage.worldSeq,items:[{...conversationFixture(),content:{kind:'speech',text:`Receipt exclusivo ${participant}`},effectiveHumanAudience:[{participantId:HumanParticipantIdSchema.parse(participant),label:participant}]}]};}
  const api={session:async()=>session(),context:async()=>{throw new Error('No contexto');},mutate:async(intent)=>{if(intent.kind!=='mode')throw new Error('No escritura');mode=intent.mode;return{kind:'mode',document:session()};},receptions:async(_run,participant)=>participant==='visitante-a'?pendingA:receipt(participant)} satisfies HumanInteractionClient;
  try{
    await act(async()=>root.render(<HumanInteractionPanel runId={stage.runId} lifecycle="closed" participants={[{participantId:HumanParticipantIdSchema.parse('visitante-a'),label:'A'},{participantId:HumanParticipantIdSchema.parse('visitante-b'),label:'B'}]} api={api}/>));
    assert.match(container.textContent??'',/Consultando recepción/);
    const select=container.querySelector('select');assert.ok(select);
    await act(async()=>{select.value='visitante-b';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    const activate=[...container.querySelectorAll('button')].find(button=>button.textContent==='Activar Interlocución');assert.ok(activate);await act(async()=>activate.click());
    assert.match(container.textContent??'',/Receipt exclusivo visitante-b/);
    await act(async()=>{resolveA(receipt('visitante-a'));await pendingA;});
    assert.match(container.textContent??'',/Receipt exclusivo visitante-b/);assert.doesNotMatch(container.textContent??'',/Receipt exclusivo visitante-a/);
  }finally{await act(async()=>root.unmount());dom.window.close();for(const{name,descriptor}of restore){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}}
});
