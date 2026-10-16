import assert from 'node:assert/strict';
import {test} from 'node:test';
import {act} from 'react';
import {JSDOM} from 'jsdom';
import {OperationalDefaultsPicker} from '../src/web/OperationalDefaultsPicker.tsx';
import type {OperationalDefaultPreset} from '../src/web/operational-defaults.ts';

function defineGlobal(name:string,value:unknown){const old=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});return()=>{if(old===undefined)Reflect.deleteProperty(globalThis,name);else Object.defineProperty(globalThis,name,old);};}
test('picker montado no aplica al abrir o elegir; exige click y conserva bloqueo por formularios pendientes',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/',pretendToBeVisual:true});
  const restore=[defineGlobal('window',dom.window),defineGlobal('document',dom.window.document),defineGlobal('navigator',dom.window.navigator),defineGlobal('HTMLElement',dom.window.HTMLElement),defineGlobal('Node',dom.window.Node),defineGlobal('IS_REACT_ACT_ENVIRONMENT',true)];
  const {createRoot}=await import('react-dom/client');const element=dom.window.document.getElementById('root');assert.ok(element);const root=createRoot(element);
  const chosen:OperationalDefaultPreset[]=[];
  const render=async(pendingEdits:boolean,disabled=false)=>act(async()=>{root.render(<OperationalDefaultsPicker pendingEdits={pendingEdits} disabled={disabled} onApply={preset=>chosen.push(preset)}/>);});
  try{
    await render(false);assert.deepEqual(chosen,[]);
    const select=element.querySelector('select');const button=element.querySelector('button');assert.ok(select&&button);
    await act(async()=>{select.value='text-narrator';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    assert.deepEqual(chosen,[],'elegir opción no cambia el borrador');
    assert.match(element.textContent??'',/Audio desactivado/);
    await render(true);assert.equal(button.disabled,true);assert.equal(select.disabled,true);
    await act(async()=>button.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
    assert.deepEqual(chosen,[],'el formulario pendiente no se descarta por un click');
    await render(false);await act(async()=>button.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
    assert.deepEqual(chosen,['text-narrator']);
    await render(false,true);assert.equal(button.disabled,true);
    assert.match(element.textContent??'',/Conserva el modelo elegido/);
  }finally{await act(async()=>root.unmount());for(const reset of restore.reverse())reset();dom.window.close();}
});

test('editor conserva formulario pendiente, aplica defaults sólo localmente y sincroniza reloj/presupuesto',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/',pretendToBeVisual:true});
  const restore=[defineGlobal('window',dom.window),defineGlobal('document',dom.window.document),defineGlobal('navigator',dom.window.navigator),defineGlobal('HTMLElement',dom.window.HTMLElement),defineGlobal('Node',dom.window.Node),defineGlobal('IS_REACT_ACT_ENVIRONMENT',true),defineGlobal('fetch',async()=>Response.json({error:{message:'Lectura no configurada en esta prueba de edición local.'}},{status:503}))];
  const [{createRoot},{RunDraftEditor},{createEmptyRunConfigurationDraft}]=await Promise.all([import('react-dom/client'),import('../src/web/RunDraftEditor.tsx'),import('../src/domain/production.ts')]);
  const draft=createEmptyRunConfigurationDraft({runId:'00000000-0000-4000-8000-000000009901',revision:0});
  const element=dom.window.document.getElementById('root');assert.ok(element);const root=createRoot(element);
  const saved:typeof draft[]=[];let validations=0;
  try{
    await act(async()=>root.render(<RunDraftEditor draft={draft} catalog={[]} saving={false} onSave={value=>saved.push(value)} onValidate={()=>validations++} onDirty={()=>undefined}/>));
    const button=(text:string)=>{const found=[...element.querySelectorAll('button')].find(item=>item.textContent===text);assert.ok(found,text);return found;};
    const pack=button('Aplicar perfil operativo a la edición local');
    const clock=element.querySelector<HTMLSelectElement>('#draft-circadianPolicy select');assert.ok(clock);
    await act(async()=>{clock.value='manual-only';clock.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    assert.equal(pack.disabled,true);
    assert.equal(clock.value,'manual-only');
    await act(async()=>pack.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
    assert.equal(clock.value,'manual-only','el pack bloqueado no descarta el formulario');
    await act(async()=>button('Aplicar política de reloj').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
    assert.equal(pack.disabled,false);
    await act(async()=>pack.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
    assert.equal(saved.length,0,'aplicar un pack no guarda');assert.equal(validations,0);
    const newClock=element.querySelector<HTMLSelectElement>('#draft-circadianPolicy select');assert.ok(newClock);
    assert.equal(newClock.value,'advance-while-running');
    const timeout=[...element.querySelectorAll('label')].find(label=>label.textContent?.startsWith('Timeout por request'))?.querySelector('input');assert.ok(timeout);
    assert.equal(timeout.value,'300000','la vista de presupuesto refleja la elección local');
    await act(async()=>button('Guardar borrador').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
    const result=saved[0];assert.ok(result);
    assert.equal(result.budget.kind==='configured'&&result.budget.value.maxWallTimeMs,null);
    assert.deepEqual(result.inferenceProfile,draft.inferenceProfile);
    assert.equal(result.worldSnapshot.kind,'empty');
  }finally{await act(async()=>root.unmount());for(const reset of restore.reverse())reset();dom.window.close();}
});
