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
