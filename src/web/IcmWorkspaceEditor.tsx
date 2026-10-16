import React from 'react';
import {subscribeToHostSessionReset} from './host-session-reset.ts';
import { RunConfigurationDraftSchema, type RunConfigurationDraft } from '../domain/production.ts';
import type { IcmWorkspaceAudience } from '../domain/icm-workspace-schema.ts';
import { IcmWorkspacePreviewRequestSchema, type IcmWorkspacePreviewResponse, type IcmWorkspaceSourcesResponse } from '../domain/icm-workspace-selection.ts';
import { changeDraftField } from './draft-form.ts';
import { createIcmWorkspaceClient, icmAudienceKey, type IcmWorkspaceClient } from './icm-workspace-client.ts';

const defaultApi=createIcmWorkspaceClient();
type Choices=Record<string,Record<string,string[]>>;
type RecommendedSource={sourceId:string;sectionIds:string[]};
type PendingRecommendation={audienceKey:string;label:string;sources:RecommendedSource[]};
function requiredRecommendationSources(audience:IcmWorkspaceAudience):string[]{
  switch(audience.role){
    case 'actor':return ['stage.actuation',`actor.${audience.actorId}.context`];
    case 'continuista':return ['stage.moderation','role.continuista'];
    case 'director':return ['stage.direction','role.director'];
    case 'configurator':return ['role.configurator'];
    case 'narrator':return ['role.narrator'];
    case 'narration-reviewer':return ['role.narration-reviewer'];
    default:{const exhaustive:never=audience;throw new Error(`ICM_WORKSPACE_UNSUPPORTED_AUDIENCE:${String(exhaustive)}`);}
  }
}
function recommendationFor(audience:IcmWorkspaceAudience,sources:IcmWorkspaceSourcesResponse['sources']):RecommendedSource[]|undefined{
  const ids=requiredRecommendationSources(audience);
  const selected:RecommendedSource[]=[];
  for(const sourceId of ids){
    const source=sources.find(item=>item.sourceId===sourceId&&item.role===audience.role);
    if(source===undefined)return undefined;
    const exposedSections=audience.role==='actor'?source.sectionIds.filter(section=>section==='process'||section==='cierre'):source.sectionIds;
    const sectionIds=['process','cierre'].filter(section=>exposedSections.includes(section));
    if(!sectionIds.includes('process'))return undefined;
    selected.push({sourceId,sectionIds});
  }
  return selected;
}
function sameRecommendation(current:Record<string,string[]>,recommended:RecommendedSource[]):boolean{
  const currentSources=Object.entries(current).filter(([,sections])=>sections.length>0);
  if(currentSources.length!==recommended.length)return false;
  return recommended.every(source=>{
    const sections=current[source.sourceId];
    return sections!==undefined&&sections.length===source.sectionIds.length&&source.sectionIds.every(section=>sections.includes(section));
  });
}
function useRecommendation(current:Record<string,string[]>,recommended:RecommendedSource[],audienceKey:string,label:string,setChoices:React.Dispatch<React.SetStateAction<Choices>>,generation:React.MutableRefObject<number>,setPreview:React.Dispatch<React.SetStateAction<IcmWorkspacePreviewResponse|null>>,setError:React.Dispatch<React.SetStateAction<string>>,pendingCallback:React.MutableRefObject<(pending:boolean)=>void>,setPendingRecommendation:React.Dispatch<React.SetStateAction<PendingRecommendation|null>>){
  if(sameRecommendation(current,recommended))return;
  if(Object.values(current).some(sections=>sections.length>0)){
    setPendingRecommendation({audienceKey,label,sources:recommended});
    return;
  }
  generation.current++;setPreview(null);setError('');pendingCallback.current(true);
  setChoices(previous=>({...previous,[audienceKey]:Object.fromEntries(recommended.map(source=>[source.sourceId,source.sectionIds]))}));
  setPendingRecommendation(null);
}
export function icmEditorAudiences(draft:RunConfigurationDraft):Array<{audience:IcmWorkspaceAudience;label:string}>{
  const roster=draft.roster.kind==='empty'?undefined:draft.roster.value;
  const actorIds=[...new Set([...(roster?.preparedCharacters.map(actor=>actor.characterId)??[]),...(roster?.activeCharacterIds??[])])];
  const actors=actorIds.map(actorId=>({audience:{role:'actor',actorId} satisfies IcmWorkspaceAudience,label:`Actor ${actorId}${roster?.activeCharacterIds.includes(actorId)?' · activo':' · preparado'}`}));
  const administrative:Array<{audience:IcmWorkspaceAudience;label:string}>=[{audience:{role:'continuista'},label:'Continuista'},{audience:{role:'director'},label:'Director'},{audience:{role:'configurator'},label:'Configurador'}];
  if(draft.narrationMode.kind!=='empty'&&draft.narrationMode.value.kind==='enabled')administrative.push({audience:{role:'narrator'},label:'Narrador'},{audience:{role:'narration-reviewer'},label:'Continuista de narración'});
  return [...actors,...administrative];
}
export function IcmWorkspaceEditor({draft,baseline,onChange,onPendingChange,readOnly=false,api=defaultApi,sourceRefresh=0}:{draft:RunConfigurationDraft;baseline?:RunConfigurationDraft;onChange:(draft:RunConfigurationDraft)=>void;onPendingChange:(pending:boolean)=>void;readOnly?:boolean;api?:IcmWorkspaceClient;sourceRefresh?:number}){
  const baselineField=React.useRef((baseline??draft).icmWorkspace).current;
  const saved=baselineField?.kind==='configured'?baselineField.value:undefined;
  const audiences=icmEditorAudiences(draft);
  const scope=JSON.stringify([draft.runId,draft.roster,draft.narrationMode,draft.icmWorkspace,readOnly]);
  const latestDraft=React.useRef(draft);latestDraft.current=draft;
  const generation=React.useRef(0);
  const pendingCallback=React.useRef(onPendingChange);pendingCallback.current=onPendingChange;
  const [catalog,setCatalog]=React.useState<IcmWorkspaceSourcesResponse[]>([]);
  const [choices,setChoices]=React.useState<Choices>({});
  const [pendingRecommendation,setPendingRecommendation]=React.useState<PendingRecommendation|null>(null);
  const [preview,setPreview]=React.useState<IcmWorkspacePreviewResponse|null>(null);
  const [previewScope,setPreviewScope]=React.useState<string|null>(null);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const [reload,setReload]=React.useState(0);
  const previewController=React.useRef<AbortController|null>(null);
  const loadedScope=React.useRef<string|null>(null);
  React.useEffect(()=>subscribeToHostSessionReset(()=>{generation.current++;previewController.current?.abort();setPreview(null);setCatalog([]);setChoices({});setError('La sesión del host cambió; volvé a revisar las fuentes y la selección.');setBusy(false);setReload(value=>value+1);}),[]);
  React.useEffect(()=>{
    const current=++generation.current;const controller=new AbortController();
    previewController.current?.abort();setPreview(null);setCatalog([]);setError('');
    const chosen:Choices={};
    const existing=latestDraft.current.icmWorkspace;
    if(existing?.kind==='configured')for(const source of existing.value.sources){const key=icmAudienceKey(source.audience);chosen[key]??={};chosen[key][source.sourceId]=source.sections.map(section=>section.sectionId);}
    if(loadedScope.current!==scope){setChoices(chosen);setPendingRecommendation(null);pendingCallback.current(false);loadedScope.current=scope;}
    if(readOnly){setBusy(false);return()=>{generation.current++;controller.abort();};}
    setBusy(true);
    void Promise.all(icmEditorAudiences(latestDraft.current).map(({audience})=>api.sources(audience,controller.signal))).then(values=>{
      if(current!==generation.current||controller.signal.aborted)return;
      setCatalog(values);setBusy(false);
    }).catch(failure=>{if(current===generation.current&&!controller.signal.aborted){setError(failure instanceof Error?failure.message:'No se pudieron leer las fuentes ICM.');setBusy(false);}});
    return()=>{generation.current++;controller.abort();previewController.current?.abort();};
  },[scope,api,reload,readOnly,sourceRefresh]);
  function toggle(audience:IcmWorkspaceAudience,sourceId:string,sectionId:string,checked:boolean){
    generation.current++;setPreview(null);setError('');pendingCallback.current(true);
    setPendingRecommendation(null);
    const key=icmAudienceKey(audience);const selected=choices[key]?.[sourceId]??[];
    setChoices({...choices,[key]:{...choices[key],[sourceId]:checked?[...selected,sectionId]:selected.filter(id=>id!==sectionId)}});
  }
  async function preparePreview(){
    const current=++generation.current;const controller=new AbortController();previewController.current=controller;
    setPreview(null);setError('');
    try{
      const groups=audiences.flatMap(({audience})=>{
        const selected=choices[icmAudienceKey(audience)]??{};
        const sourceIds=Object.keys(selected).filter(id=>(selected[id]?.length??0)>0);
        return sourceIds.length===0?[]:[{audience,sourceIds,sectionIdsBySource:Object.fromEntries(sourceIds.map(id=>[id,selected[id]]))}];
      });
      const request=IcmWorkspacePreviewRequestSchema.safeParse({groups});
      if(!request.success){setError('Elegí al menos una fuente y una sección para previsualizar.');return;}
      setBusy(true);
      const value=await api.preview(request.data,controller.signal);
      if(current===generation.current&&!controller.signal.aborted){setPreview(value);setPreviewScope(scope);setBusy(false);}
    }catch(failure){if(current===generation.current&&!controller.signal.aborted){setError(failure instanceof Error?failure.message:'Revisá las fuentes y sus secciones.');setBusy(false);}}
  }
  const snapshot=previewScope===scope?preview?.snapshot:undefined;
  const baselineKeys=new Set(saved?.sources.map(source=>`${icmAudienceKey(source.audience)}:${source.sourceId}`)??[]);
  const currentKeys=new Set(snapshot?.sources.map(source=>`${icmAudienceKey(source.audience)}:${source.sourceId}`)??[]);
  const configured=draft.icmWorkspace;
  const frozen=configured?.kind==='configured'?configured.value:undefined;
  const displayedSnapshot=snapshot??frozen;
  return <section className="draft-section" style={{overflowWrap:'anywhere'}} id="draft-icmWorkspace" aria-label="Selección de contexto ICM">
    <h3>Contexto Markdown ICM por audiencia</h3>
    <p>Elegí fuentes y secciones para cada rol. Esta selección no es memoria SQLite, no entrega documentación a todos los personajes y no inicia inferencias.</p>
    <p>{configured===undefined?'Sin selección ICM registrada.':configured.kind==='empty'?'Sin selección ICM configurada.':`Snapshot en el borrador: ${configured.value.snapshotHash}`}</p>
    {error&&<p role="alert">{error}</p>}
    {busy&&<p role="status">Consultando contexto ICM…</p>}
    <fieldset disabled={readOnly||busy}>
      {audiences.map(({audience,label})=>{const key=icmAudienceKey(audience);const list=catalog.find(item=>icmAudienceKey(item.audience)===key);const current=choices[key]??{};const currentSources=Object.entries(current).filter(([,sections])=>sections.length>0);const currentSectionCount=currentSources.reduce((total,[,sections])=>total+sections.length,0);const recommended=list===undefined?undefined:recommendationFor(audience,list.sources);const isRecommended=recommended!==undefined&&sameRecommendation(current,recommended);return <fieldset key={key}><legend>{label}</legend>
        <p>Selección actual en edición: {currentSources.length===0?'vacía':`${currentSources.length} fuentes · ${currentSectionCount} secciones`}.</p>
        {list===undefined?<p>{readOnly?'Selección conservada; edición deshabilitada.':'Fuentes todavía no disponibles.'}</p>:list.sources.length===0?<p>No hay fuentes autorizadas para esta audiencia.</p>:list.sources.map(source=>{const sectionIds=audience.role==='actor'?source.sectionIds.filter(section=>section==='process'||section==='cierre'):source.sectionIds;return <fieldset key={source.sourceId}><legend>{source.label}</legend><p>Fuente: {source.sourceId}</p>{sectionIds.map(sectionId=><label key={sectionId} style={{display:'block'}}><input type="checkbox" checked={choices[key]?.[source.sourceId]?.includes(sectionId)??false} onChange={event=>toggle(audience,source.sourceId,sectionId,event.target.checked)}/>{sectionId}</label>)}</fieldset>;})}
        {list!==undefined&&<><p>{recommended===undefined?'No hay una recomendación completa disponible con las fuentes y secciones actuales.':`Recomendación disponible: ${recommended.length} fuentes con ${recommended.reduce((total,source)=>total+source.sectionIds.length,0)} secciones (${recommended.flatMap(source=>source.sectionIds).join(', ')}).`}</p><button type="button" aria-label={`Usar selección recomendada para ${label}`} disabled={recommended===undefined||isRecommended} onClick={()=>{if(recommended!==undefined)useRecommendation(current,recommended,key,label,setChoices,generation,setPreview,setError,pendingCallback,setPendingRecommendation);}}>{isRecommended?'Selección recomendada ya aplicada':'Usar selección recomendada'}</button></>}
        {pendingRecommendation?.audienceKey===key&&<div><p role="status">La recomendación reemplazará la selección local en edición de {label}; no modifica el snapshot del borrador. Después tendrás que previsualizarla y aplicarla explícitamente.</p><button type="button" onClick={()=>{generation.current++;setPreview(null);setError('');pendingCallback.current(true);setChoices(previous=>({...previous,[key]:Object.fromEntries(pendingRecommendation.sources.map(source=>[source.sourceId,source.sectionIds]))}));setPendingRecommendation(null);}}>Reemplazar selección actual</button><button type="button" onClick={()=>setPendingRecommendation(null)}>Cancelar reemplazo</button></div>}
      </fieldset>;})}
      <button type="button" onClick={()=>{generation.current++;setChoices({});setPreview(null);setPendingRecommendation(null);pendingCallback.current(true);}}>Vaciar selección en edición</button>
      <button type="button" onClick={()=>setReload(value=>value+1)}>Volver a consultar fuentes</button>
      <button type="button" disabled={catalog.length!==audiences.length} onClick={()=>void preparePreview()}>Previsualizar selección ICM</button>
      {saved===undefined&&configured?.kind==='configured'&&<button type="button" onClick={()=>{onChange(RunConfigurationDraftSchema.parse({...latestDraft.current,icmWorkspace:baselineField}));pendingCallback.current(false);setPreview(null);}}>Descartar selección ICM local</button>}
    </fieldset>
    {saved!==undefined&&<p>El snapshot guardado se conserva: para cambiarlo, elegí y aplicá otra selección explícita. No se puede retirar una selección ya admitida.</p>}
    {displayedSnapshot&&<section aria-label={snapshot?"Vista previa ICM":"Snapshot ICM congelado"}><h4>{snapshot?"Vista previa de la selección":saved?.snapshotHash===displayedSnapshot.snapshotHash?"Snapshot guardado y congelado":"Snapshot local congelado; sin guardar"}</h4><p>Hash del snapshot: <code style={{overflowWrap:'anywhere'}}>{displayedSnapshot.snapshotHash}</code></p><p>{displayedSnapshot.sources.length} fuentes para las audiencias elegidas. Las audiencias sin selección no recibirán estas fuentes.</p>
      {displayedSnapshot.sources.map(source=>{const key=`${icmAudienceKey(source.audience)}:${source.sourceId}`;const prior=saved?.sources.find(item=>`${icmAudienceKey(item.audience)}:${item.sourceId}`===key);const unchanged=prior!==undefined&&JSON.stringify(prior)===JSON.stringify(source);return <details key={key}><summary>{icmAudienceKey(source.audience)} · {source.sourceId} · {prior===undefined?'Nueva fuente':unchanged?'Sin cambios respecto de lo guardado':'Cambió respecto de lo guardado'}</summary><p>Procedencia: {source.sourceId} · revisión {source.revision} · hash <code style={{overflowWrap:'anywhere'}}>{source.sourceHash}</code></p>{source.sections.map(section=><section key={section.sectionId}><h5>{section.sectionId}</h5><p>Hash: <code style={{overflowWrap:'anywhere'}}>{section.sectionHash}</code></p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{section.markdown}</pre></section>)}</details>;})}
      {snapshot&&[...baselineKeys].filter(key=>!currentKeys.has(key)).map(key=><p key={key}>Se retirará de la selección guardada: {key}</p>)}
      {snapshot&&<button type="button" disabled={readOnly||busy} onClick={()=>{if(preview!==null&&previewScope===scope&&!readOnly){onChange(changeDraftField({draft:latestDraft.current,field:'icmWorkspace',value:preview.snapshot}));pendingCallback.current(false);setPreview(null);}}}>Aplicar selección ICM al borrador</button>}<p>Aplicar modifica la edición local. Usá Guardar borrador para conservarla con su revisión; el servidor vuelve a comprobar las fuentes actuales y puede rechazar cambios de procedencia.</p>
    </section>}
  </section>;
}
