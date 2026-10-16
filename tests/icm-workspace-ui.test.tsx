import assert from 'node:assert/strict';
import {test} from 'node:test';
import {act} from 'react';
import {JSDOM} from 'jsdom';
import {createRoot} from 'react-dom/client';
import {IcmWorkspaceEditor,icmEditorAudiences} from '../src/web/IcmWorkspaceEditor.tsx';
import {createIcmWorkspaceClient,icmAudienceKey,type IcmWorkspaceClient} from '../src/web/icm-workspace-client.ts';
import {IcmWorkspacePreviewRequestSchema,IcmWorkspacePreviewResponseSchema,IcmWorkspaceSourcesResponseSchema,type IcmWorkspacePreviewRequest,type IcmWorkspaceSourcesResponse} from '../src/domain/icm-workspace-selection.ts';
import {createIcmWorkspaceSnapshot,hashIcmMarkdown} from '../src/domain/icm-workspace.ts';
import {createEmptyRunConfigurationDraft,type RunConfigurationDraft} from '../src/domain/production.ts';
import {changeDraftField,changedDraftSections,reconcileDraft,draftFieldState,describeDraftSection} from '../src/web/draft-form.ts';

function draft(){return changeDraftField({draft:changeDraftField({draft:createEmptyRunConfigurationDraft({runId:crypto.randomUUID(),revision:0}),field:'roster',value:{eligibleCharacterIds:['maxwell-smart'],preparedCharacters:[],activeCharacterIds:['maxwell-smart']}}),field:'narrationMode',value:{kind:'disabled'}});}
function preview(request:IcmWorkspacePreviewRequest){
  const snapshot=createIcmWorkspaceSnapshot({sources:request.groups.flatMap(group=>group.sourceIds.map(sourceId=>({sourceId,audience:group.audience,revision:0,sourceHash:hashIcmMarkdown(sourceId),sections:(group.sectionIdsBySource[sourceId]??[]).map(sectionId=>({sectionId,markdown:`# ${icmAudienceKey(group.audience)}\nContenido seleccionado ${sectionId}`}))})))});
  return IcmWorkspacePreviewResponseSchema.parse({kind:'icm-workspace-preview',workspaceRevision:hashIcmMarkdown('revision'),snapshot,selections:snapshot.sources.map(source=>({sourceId:source.sourceId,audience:source.audience,revision:source.revision,sourceHash:source.sourceHash,sectionIds:source.sections.map(section=>section.sectionId)}))});
}
function apiFixture():IcmWorkspaceClient{return{sources:async audience=>IcmWorkspaceSourcesResponseSchema.parse({kind:'icm-workspace-sources',audience,sources:[{sourceId:`source.${audience.role}`,role:audience.role,label:`Fuente ${icmAudienceKey(audience)}`,sectionIds:['process','limits']}]}),preview:async request=>preview(request)};}
function actualCatalog(audience:IcmWorkspaceSourcesResponse['audience']):IcmWorkspaceSourcesResponse['sources']{
  const processAndCierre=['process','cierre'];
  const sources=(()=>{switch(audience.role){
    case 'actor':return [
      {sourceId:'stage.actuation',role:'actor',label:'Etapa: actuación',sectionIds:processAndCierre},
      {sourceId:`actor.${audience.actorId}.context`,role:'actor',label:'Contexto del actor',sectionIds:[...processAndCierre,'voice-settings']},
    ];
    case 'continuista':return [
      {sourceId:'stage.moderation',role:'continuista',label:'Etapa: moderación',sectionIds:processAndCierre},
      {sourceId:'role.continuista',role:'continuista',label:'Contrato: Continuista',sectionIds:processAndCierre},
    ];
    case 'director':return [
      {sourceId:'stage.direction',role:'director',label:'Etapa: dirección',sectionIds:processAndCierre},
      {sourceId:'role.director',role:'director',label:'Contrato: Director',sectionIds:['process']},
    ];
    case 'configurator':return [{sourceId:'role.configurator',role:'configurator',label:'Contrato: Configurador',sectionIds:processAndCierre}];
    case 'narrator':return [{sourceId:'role.narrator',role:'narrator',label:'Contrato: Narrador',sectionIds:processAndCierre}];
    case 'narration-reviewer':return [{sourceId:'role.narration-reviewer',role:'narration-reviewer',label:'Contrato: Revisor de narración',sectionIds:processAndCierre}];
    default:{const exhaustive:never=audience;throw new Error(`Unexpected audience: ${JSON.stringify(exhaustive)}`);}
  }})();
  return IcmWorkspaceSourcesResponseSchema.parse({kind:'icm-workspace-sources',audience,sources}).sources;
}
function actualApiFixture(reads:string[]=[],requests:IcmWorkspacePreviewRequest[]=[]):IcmWorkspaceClient{return{
  sources:async audience=>{reads.push(icmAudienceKey(audience));return IcmWorkspaceSourcesResponseSchema.parse({kind:'icm-workspace-sources',audience,sources:actualCatalog(audience)});},
  preview:async request=>{requests.push(request);return preview(request);},
};}
async function mounted(run:(container:HTMLElement,root:ReturnType<typeof createRoot>)=>Promise<void>){
  const dom=new JSDOM('<div id="root"></div>',{pretendToBeVisual:true});
  const restore=['window','document','IS_REACT_ACT_ENVIRONMENT'].map(name=>({name,descriptor:Object.getOwnPropertyDescriptor(globalThis,name)}));
  Object.defineProperty(globalThis,'window',{configurable:true,value:dom.window});Object.defineProperty(globalThis,'document',{configurable:true,value:dom.window.document});Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
  const container=dom.window.document.getElementById('root');assert.ok(container);const root=createRoot(container);
  try{await run(container,root);}finally{await act(async()=>root.unmount());dom.window.close();for(const{name,descriptor}of restore){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}}
}
function button(container:HTMLElement,text:string){const value=[...container.querySelectorAll('button')].find(item=>item.textContent===text);assert.ok(value,text);return value;}
function recommendationButton(container:HTMLElement,label:string){const value=container.querySelector<HTMLButtonElement>(`button[aria-label="Usar selección recomendada para ${label}"]`);assert.ok(value,label);return value;}

test('ICM editor requiere elección explícita, muestra Markdown y aplica snapshot al borrador sin guardado remoto',async()=>mounted(async(container,root)=>{
  const base=draft();const updates:RunConfigurationDraft[]=[];const pending:boolean[]=[];const api=apiFixture();
  await act(async()=>root.render(<IcmWorkspaceEditor draft={base} api={api} onChange={value=>{updates.push(value);}} onPendingChange={value=>pending.push(value)}/>));
  assert.match(container.textContent??'',/Sin selección ICM registrada/);assert.doesNotMatch(container.textContent??'',/Preparación histórica/);
  const inputs=[...container.querySelectorAll('input[type="checkbox"]')];assert.equal(inputs.length,7);assert.ok(inputs.every(input=>input instanceof window.HTMLInputElement&&!input.checked));
  const first=inputs[0];assert.ok(first instanceof window.HTMLInputElement);await act(async()=>first.click());
  assert.equal(pending.at(-1),true);assert.equal(updates.length,0);
  await act(async()=>button(container,'Previsualizar selección ICM').click());
  assert.match(container.textContent??'',/Contenido seleccionado process/);assert.match(container.textContent??'',/actor:maxwell-smart/);assert.doesNotMatch(container.textContent??'',/actor:hymie/);
  assert.equal(updates.length,0);
  await act(async()=>button(container,'Aplicar selección ICM al borrador').click());
  const changed=updates[0];assert.ok(changed);assert.equal(changed.icmWorkspace?.kind,'configured');if(changed.icmWorkspace?.kind!=='configured')assert.fail();
  assert.equal(changed.icmWorkspace.value.sources.length,1);assert.equal(pending.at(-1),false);
  assert.deepEqual(changedDraftSections(base,changed),['icmWorkspace']);
  assert.deepEqual(reconcileDraft({local:changed,remote:base,keepLocal:['icmWorkspace']}).icmWorkspace,changed.icmWorkspace);
  assert.match(describeDraftSection(changed,'icmWorkspace'),/1 fuentes/);assert.match(draftFieldState(undefined,'icmWorkspace').detail,/histórica/);
}));

test('recomienda las fuentes disponibles por audiencia sin lectura extra ni aplicar automáticamente',async()=>mounted(async(container,root)=>{
  const base=changeDraftField({draft:draft(),field:'narrationMode',value:{kind:'enabled'}});const reads:string[]=[];const requests:IcmWorkspacePreviewRequest[]=[];const updates:RunConfigurationDraft[]=[];const pending:boolean[]=[];const api=actualApiFixture(reads,requests);
  const audiences=icmEditorAudiences(base);
  await act(async()=>root.render(<IcmWorkspaceEditor draft={base} api={api} onChange={value=>updates.push(value)} onPendingChange={value=>pending.push(value)}/>));
  assert.equal(reads.length,audiences.length);assert.match(container.textContent??'',/Selección actual en edición: vacía/);
  for(const {label} of audiences)await act(async()=>recommendationButton(container,label).click());
  assert.equal(reads.length,audiences.length);assert.equal(requests.length,0);assert.equal(updates.length,0);assert.equal(pending.at(-1),true);
  const actorFieldset=[...container.querySelectorAll('fieldset')].find(fieldset=>[...fieldset.children].some(child=>child.tagName==='LEGEND'&&child.textContent?.startsWith('Actor maxwell-smart')));assert.ok(actorFieldset);
  const actorSelected=[...actorFieldset.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter(input=>input.checked).map(input=>input.parentElement?.textContent?.trim());
  assert.deepEqual(actorSelected,['process','cierre','process','cierre']);assert.doesNotMatch(actorFieldset.textContent??'',/voice-settings/);
  assert.match(container.textContent??'',/Selección actual en edición: 2 fuentes · 4 secciones/);
  await act(async()=>button(container,'Previsualizar selección ICM').click());
  assert.equal(requests.length,1);assert.equal(requests[0]?.groups.length,audiences.length);
  const actorGroup=requests[0]?.groups.find(group=>group.audience.role==='actor');assert.ok(actorGroup);assert.deepEqual(actorGroup.sourceIds,['stage.actuation','actor.maxwell-smart.context']);
  assert.deepEqual(Object.entries(actorGroup.sectionIdsBySource).find(([sourceId])=>sourceId==='actor.maxwell-smart.context')?.[1],['process','cierre']);
  const directorGroup=requests[0]?.groups.find(group=>group.audience.role==='director');assert.ok(directorGroup);assert.deepEqual(Object.entries(directorGroup.sectionIdsBySource).find(([sourceId])=>sourceId==='role.director')?.[1],['process']);
  assert.match(container.textContent??'',/Vista previa de la selección/);assert.equal(updates.length,0);
  await act(async()=>button(container,'Aplicar selección ICM al borrador').click());assert.equal(updates.length,1);assert.equal(reads.length,audiences.length);
}));

test('una recomendación pide confirmación antes de reemplazar una selección local y sólo altera la edición tras confirmarla',async()=>mounted(async(container,root)=>{
  const base=draft();const original=preview(IcmWorkspacePreviewRequestSchema.parse({groups:[{audience:{role:'actor',actorId:'maxwell-smart'},sourceIds:['stage.actuation'],sectionIdsBySource:{'stage.actuation':['process']}}]}));
  const local=changeDraftField({draft:base,field:'icmWorkspace',value:original.snapshot});const reads:string[]=[];const requests:IcmWorkspacePreviewRequest[]=[];const updates:RunConfigurationDraft[]=[];const api=actualApiFixture(reads,requests);
  await act(async()=>root.render(<IcmWorkspaceEditor draft={local} baseline={base} api={api} onChange={value=>updates.push(value)} onPendingChange={()=>{}}/>));
  assert.match(container.textContent??'',/Selección actual en edición: 1 fuentes · 1 secciones/);
  const actorFieldset=()=>[...container.querySelectorAll('fieldset')].find(fieldset=>[...fieldset.children].some(child=>child.tagName==='LEGEND'&&child.textContent?.startsWith('Actor maxwell-smart')));
  const actor=actorFieldset();assert.ok(actor);const before=[...actor.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(input=>input.checked);assert.deepEqual(before,[true,false,false,false]);
  const initialReads=reads.length;await act(async()=>recommendationButton(container,'Actor maxwell-smart · activo').click());
  assert.match(container.textContent??'',/reemplazará la selección local en edición/);assert.deepEqual([...actor.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(input=>input.checked),before);
  assert.equal(reads.length,initialReads);assert.equal(requests.length,0);assert.equal(updates.length,0);
  await act(async()=>button(container,'Cancelar reemplazo').click());assert.doesNotMatch(container.textContent??'',/reemplazará la selección local en edición/);
  await act(async()=>recommendationButton(container,'Actor maxwell-smart · activo').click());await act(async()=>button(container,'Reemplazar selección actual').click());
  const after=actorFieldset();assert.ok(after);assert.deepEqual([...after.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(input=>input.checked),[true,true,true,true]);
  assert.equal(reads.length,initialReads);assert.equal(requests.length,0);assert.equal(updates.length,0);
  await act(async()=>button(container,'Previsualizar selección ICM').click());assert.equal(requests.length,1);assert.equal(updates.length,0);
  await act(async()=>button(container,'Aplicar selección ICM al borrador').click());assert.equal(updates.length,1);
}));

test('ICM preview anterior no muta tras cambiar reparto y narración',async()=>mounted(async(container,root)=>{
  const base=draft();const api=apiFixture();let resolve:(value:ReturnType<typeof preview>)=>void=()=>{throw new Error('Not initialized');};
  const requests:IcmWorkspacePreviewRequest[]=[];let changed=0;
  const pendingPreview=new Promise<ReturnType<typeof preview>>(done=>{resolve=done;});
  api.preview=async value=>{requests.push(value);return pendingPreview;};
  const render=(value:RunConfigurationDraft)=><IcmWorkspaceEditor draft={value} api={api} onChange={()=>changed++} onPendingChange={()=>{}}/>;
  await act(async()=>root.render(render(base)));const input=container.querySelector('input');assert.ok(input);await act(async()=>input.click());
  await act(async()=>button(container,'Previsualizar selección ICM').click());assert.ok(requests[0]);
  const next=changeDraftField({draft:changeDraftField({draft:base,field:'roster',value:{eligibleCharacterIds:['hymie'],preparedCharacters:[],activeCharacterIds:['hymie']}}),field:'narrationMode',value:{kind:'enabled'}});
  await act(async()=>root.render(render(next)));assert.match(container.textContent??'',/Actor hymie/);assert.match(container.textContent??'',/Continuista de narración/);
  await act(async()=>{resolve(preview(IcmWorkspacePreviewRequestSchema.parse(requests[0])));await pendingPreview;});
  assert.equal(changed,0);assert.doesNotMatch(container.textContent??'',/Contenido seleccionado/);assert.equal(container.querySelector('[aria-label="Vista previa ICM"]'),null);
  assert.equal(icmEditorAudiences(next).length,6);
}));

test('cliente ICM rechaza audiencia ajena en catálogo y fuente/actor inyectado en preview',async()=>{
  const base=draft();const audience=icmEditorAudiences(base)[0]?.audience;assert.ok(audience);
  const bootstrap=async()=>({csrfToken:'test-token',expiresAt:'2099-01-01T00:00:00Z'});
  const foreign=IcmWorkspaceSourcesResponseSchema.parse({kind:'icm-workspace-sources',audience:{role:'actor',actorId:'hymie'},sources:[]});
  const client=createIcmWorkspaceClient(async()=>new Response(JSON.stringify(foreign)),bootstrap);
  await assert.rejects(client.sources(audience,new AbortController().signal),/otra audiencia/);
  const requested=IcmWorkspacePreviewRequestSchema.parse({groups:[{audience,sourceIds:['source.actor'],sectionIdsBySource:{'source.actor':['process']}}]});
  const injected=preview(IcmWorkspacePreviewRequestSchema.parse({groups:[{audience:{role:'actor',actorId:'hymie'},sourceIds:['source.actor'],sectionIdsBySource:{'source.actor':['process']}}]}));
  const wrong=createIcmWorkspaceClient(async()=>new Response(JSON.stringify(injected)),bootstrap);
  await assert.rejects(wrong.preview(requested,new AbortController().signal),/no coincide/);
});

test('ICM lectura inmutable no consulta fuentes ni permite cambiar selección',async()=>mounted(async(container,root)=>{
  let reads=0,changes=0;const api=apiFixture();api.sources=async()=>{reads++;throw new Error('No debe consultar');};
  await act(async()=>root.render(<IcmWorkspaceEditor draft={draft()} api={api} readOnly onChange={()=>changes++} onPendingChange={()=>{}}/>));
  assert.equal(reads,0);
  assert.ok([...container.querySelectorAll('button')].every(item=>item.matches(':disabled')));
  await act(async()=>button(container,'Previsualizar selección ICM').click());assert.equal(changes,0);
}));

test('ICM ignora preview que termina después de desmontar el editor',async()=>mounted(async(container,root)=>{
  const api=apiFixture();let resolve:(value:ReturnType<typeof preview>)=>void=()=>{throw new Error('Not initialized');};const requests:IcmWorkspacePreviewRequest[]=[];let changes=0;
  const pending=new Promise<ReturnType<typeof preview>>(done=>{resolve=done;});api.preview=async request=>{requests.push(request);return pending;};
  await act(async()=>root.render(<IcmWorkspaceEditor draft={draft()} api={api} onChange={()=>changes++} onPendingChange={()=>{}}/>));
  const input=container.querySelector('input');assert.ok(input);await act(async()=>input.click());await act(async()=>button(container,'Previsualizar selección ICM').click());assert.ok(requests[0]);
  await act(async()=>root.render(<p>Otro editor</p>));await act(async()=>{resolve(preview(IcmWorkspacePreviewRequestSchema.parse(requests[0])));await pending;});
  assert.equal(changes,0);assert.equal(container.textContent,'Otro editor');
}));

test('guardar ICM captura snapshot, CAS e idempotencia y reconciliar impide retirar un snapshot admitido',async()=>{
  const {createDraftSaveIntent,buildDraftSaveRequest}=await import('../src/web/run-drafts-client.ts');
  const base=draft();const value=preview(IcmWorkspacePreviewRequestSchema.parse({groups:[{audience:{role:'director'},sourceIds:['source.director'],sectionIdsBySource:{'source.director':['process']}}]}));
  const chosen=changeDraftField({draft:base,field:'icmWorkspace',value:value.snapshot});
  const intent=createDraftSaveIntent({kind:'replace',configuration:chosen,key:crypto.randomUUID(),etag:`"run-config:${base.runId}:c0"`});
  const original=buildDraftSaveRequest({intent,csrfToken:'csrf'});
  if(chosen.icmWorkspace?.kind!=='configured')assert.fail();chosen.icmWorkspace.value.sources.splice(0);
  const retry=buildDraftSaveRequest({intent,csrfToken:'csrf'});assert.deepEqual(retry,original);
  const body:unknown=JSON.parse(retry.init.body);const {RunConfigurationDraftSchema}=await import('../src/domain/production.ts');
  const parsed=RunConfigurationDraftSchema.parse(typeof body==='object'&&body!==null&&'configuration' in body?body.configuration:undefined);
  assert.equal(parsed.icmWorkspace?.kind,'configured');if(parsed.icmWorkspace?.kind!=='configured')assert.fail();assert.equal(parsed.icmWorkspace.value.sources.length,1);
  assert.equal(new Headers(retry.init.headers).get('If-Match'),`"run-config:${base.runId}:c0"`);
  const remote=changeDraftField({draft:base,field:'icmWorkspace',value:value.snapshot});const legacy={...base};delete legacy.icmWorkspace;
  assert.throws(()=>reconcileDraft({local:legacy,remote,keepLocal:['icmWorkspace']}),/snapshot ICM admitido/);
  assert.equal(legacy.icmWorkspace,undefined);assert.equal(remote.icmWorkspace?.kind,'configured');
  assert.deepEqual(reconcileDraft({local:legacy,remote,keepLocal:[]}).icmWorkspace,remote.icmWorkspace);
});

test('snapshot admitido en sólo lectura conserva Markdown, procedencia y hashes sin leer archivos actuales',async()=>mounted(async(container,root)=>{
  const selected=preview(IcmWorkspacePreviewRequestSchema.parse({groups:[{audience:{role:'director'},sourceIds:['source.director'],sectionIdsBySource:{'source.director':['process']}}]}));
  const configured=changeDraftField({draft:draft(),field:'icmWorkspace',value:selected.snapshot});
  let reads=0;const api=apiFixture();api.sources=async()=>{reads++;throw new Error('La fuente actual fue borrada');};
  await act(async()=>root.render(<IcmWorkspaceEditor draft={configured} baseline={configured} api={api} readOnly onChange={()=>assert.fail('No modificar')} onPendingChange={()=>{}}/>));
  assert.equal(reads,0);assert.match(container.textContent??'',/Snapshot guardado y congelado/);assert.match(container.textContent??'',/Contenido seleccionado process/);assert.match(container.textContent??'',/source.director/);
  assert.ok(container.textContent?.includes(selected.snapshot.sources[0]?.sourceHash??'missing'));
  assert.ok(container.textContent?.includes(selected.snapshot.sources[0]?.sections[0]?.sectionHash??'missing'));
  assert.equal([...container.querySelectorAll('button')].some(item=>/Aplicar selección|Descartar selección|Retirar selección/.test(item.textContent??'')),false);
}));

test('sólo una selección local con baseline ausente puede descartarse sin ofrecer retirada de snapshot admitido',async()=>mounted(async(container,root)=>{
  const base=draft();const selected=preview(IcmWorkspacePreviewRequestSchema.parse({groups:[{audience:{role:'director'},sourceIds:['source.director'],sectionIdsBySource:{'source.director':['process']}}]}));
  const local=changeDraftField({draft:base,field:'icmWorkspace',value:selected.snapshot});const changes:RunConfigurationDraft[]=[];const api=apiFixture();
  await act(async()=>root.render(<IcmWorkspaceEditor draft={local} baseline={base} api={api} onChange={value=>changes.push(value)} onPendingChange={()=>{}}/>));
  assert.match(container.textContent??'',/Snapshot local congelado; sin guardar/);
  await act(async()=>button(container,'Descartar selección ICM local').click());assert.equal(changes[0]?.icmWorkspace,undefined);
  await act(async()=>root.render(<IcmWorkspaceEditor key="nueva-revision-admitida" draft={local} baseline={local} api={api} onChange={value=>changes.push(value)} onPendingChange={()=>{}}/>));
  assert.match(container.textContent??'',/No se puede retirar una selección ya admitida/);
  assert.equal([...container.querySelectorAll('button')].some(item=>/Descartar selección|Retirar selección/.test(item.textContent??'')),false);
}));
