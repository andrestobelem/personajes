import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { LivePerformance } from '../src/web/LivePerformance.tsx';
import { stageMapData } from '../src/web/RunStageWorkspace.tsx';
import { ConversationViewSchema } from '../src/domain/run-observation.ts';
import { conversationFixture, stageFixture } from './fixtures/run-stage.ts';

test('live dialogue follows confirmed additions, permits reading earlier messages and reports lost sync', async()=>{
  const dom = new JSDOM('<div id="root"></div>', {pretendToBeVisual:true});
  const restore = ['window','document','IS_REACT_ACT_ENVIRONMENT'].map(name=>({name, descriptor:Object.getOwnPropertyDescriptor(globalThis,name)}));
  Object.defineProperty(globalThis,'window',{configurable:true,value:dom.window});
  Object.defineProperty(globalThis,'document',{configurable:true,value:dom.window.document});
  Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
  const container=dom.window.document.getElementById('root'); assert.ok(container);
  const root=createRoot(container);
  try {
    const stage=stageFixture(), first=conversationFixture();
    const second=ConversationViewSchema.parse({...first,eventId:crypto.randomUUID(),worldSeq:first.worldSeq+1,content:{kind:'speech',text:'Nueva intervención confirmada'}});
    function view(items:typeof first[],error:string|null=null){return <LivePerformance stage={stage} items={items} jobs={[]} map={stageMapData(stage)} connected={true} error={error} onExit={()=>{}}/>;}
    await act(async()=>root.render(view([first])));
    const feed=container.querySelector('ol'); assert.ok(feed);
    Object.defineProperty(feed,'scrollHeight',{configurable:true,value:500});
    await act(async()=>root.render(view([first,second])));
    assert.equal(feed.scrollTop,500);
    const follow=container.querySelector('input');assert.ok(follow);
    await act(async()=>follow.click());
    feed.scrollTop=40;
    const third=ConversationViewSchema.parse({...second,eventId:crypto.randomUUID(),worldSeq:second.worldSeq+1});
    await act(async()=>root.render(view([first,second,third],'Host no disponible')));
    assert.equal(feed.scrollTop,40);
    assert.match(container.textContent??'',/Sin sincronizar/);
    assert.match(container.textContent??'',/Nueva intervención confirmada/);
    assert.equal(container.querySelector('script'),null);
  } finally {
    await act(async()=>root.unmount());dom.window.close();
    for(const {name,descriptor} of restore){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}
  }
});

test('intervención humana dirigida al reparto no se presenta como recepción humana histórica faltante',async()=>{
  const {renderToStaticMarkup}=await import('react-dom/server');
  const {ConversationMessage}=await import('../src/web/StageConversation.tsx');
  const stage=stageFixture();
  const human=ConversationViewSchema.parse({...conversationFixture(),speaker:{kind:'human',participantId:'visitante-a',label:'Visitante A'}});
  const live=renderToStaticMarkup(<LivePerformance stage={stage} items={[human]} jobs={[]} map={stageMapData(stage)} connected error={null} onExit={()=>{}}/>);
  assert.match(live,/no aplica: intervención dirigida al reparto/);assert.doesNotMatch(live,/sin registro histórico/i);
  const detailed=renderToStaticMarkup(<ConversationMessage item={human} clock={stage.clock} onSelectEvent={()=>{}}/>);
  assert.match(detailed,/No aplica: intervención dirigida al reparto/);assert.doesNotMatch(detailed,/Sin registro histórico/);
  const legacyActor=renderToStaticMarkup(<LivePerformance stage={stage} items={[conversationFixture()]} jobs={[]} map={stageMapData(stage)} connected error={null} onExit={()=>{}}/>);
  assert.match(legacyActor,/recepción humana: sin registro histórico/);
});

test('al cerrar la escena muestra su estado y conserva la conversación en lugar de un plano vacío',async()=>{
  const {renderToStaticMarkup}=await import('react-dom/server');
  const stage={...stageFixture(),activeSceneId:null,lifecycle:'stopped' as const,places:[]};
  const item=conversationFixture();
  const html=renderToStaticMarkup(<LivePerformance stage={stage} items={[item]} jobs={[]} map={stageMapData(stageFixture())} connected error={null} onExit={()=>{}}/>);
  assert.match(html,/Entre escenas\. No hay una escena activa/);
  assert.match(html,/consultar las escenas anteriores/);
  assert.ok(item.content.kind==='speech');
  const rendered=new JSDOM(html);
  try {assert.equal(rendered.window.document.querySelector('blockquote')?.textContent,item.content.text);}
  finally {rendered.window.close();}
  assert.doesNotMatch(html,/<svg/);
});

test('actividad en vivo respeta ciclo actual aunque un registro durable siga running y conserva fallos visibles',async()=>{
  const {renderToStaticMarkup}=await import('react-dom/server');
  const {TechnicalJobViewSchema}=await import('../src/domain/run-observation.ts');
  const stage=stageFixture();
  const job=TechnicalJobViewSchema.parse({jobId:crypto.randomUUID(),runId:stage.runId,kind:'pulse',generation:0,pulseId:null,state:'running',actor:null,createdAt:0,updatedAt:1,elapsedMs:0,modelCalls:0,modelWallTimeMs:0,reservedWallTimeMs:0,safeCode:null});
  const failed=TechnicalJobViewSchema.parse({...job,jobId:crypto.randomUUID(),kind:'actor',state:'failed',updatedAt:2,safeCode:'execution-failed'});
  for(const lifecycle of ['running','paused','stopped','closed'] as const){
    const current={...stage,lifecycle};
    const html=renderToStaticMarkup(<LivePerformance stage={current} items={[]} jobs={[job,failed]} map={stageMapData(current)} connected error={null} onExit={()=>{}}/>);
    if(lifecycle==='running')assert.match(html,/Pulso: trabajando/);
    else{
      assert.doesNotMatch(html,/Pulso: trabajando/);
      assert.match(html,/registros técnicos pendientes de finalizar/);
      assert.match(html,new RegExp({paused:'En pausa',stopped:'Detenida',closed:'Cerrada'}[lifecycle]));
    }
    assert.match(html,/El último trabajo registrado falló/);
  }
});

test('la vista en vivo distingue el reposo de una espera técnica', async()=>{
  const {renderToStaticMarkup}=await import('react-dom/server');
  const {RunStageViewSchema}=await import('../src/domain/run-observation.ts');
  const base=stageFixture();
  const running=RunStageViewSchema.parse({...base,lifecycle:'running'});
  const idle=RunStageViewSchema.parse({...running,activity:'idle'});
  const idleMarkup=renderToStaticMarkup(<LivePerformance stage={idle} items={[]} jobs={[]} map={stageMapData(idle)} connected error={null} onExit={()=>{}}/>);
  assert.match(idleMarkup,/En reposo: ningún personaje tiene una causa pendiente/);
  const plain=renderToStaticMarkup(<LivePerformance stage={running} items={[]} jobs={[]} map={stageMapData(running)} connected error={null} onExit={()=>{}}/>);
  assert.match(plain,/Esperando la próxima actividad/);
});
