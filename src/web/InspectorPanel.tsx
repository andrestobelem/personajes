import React from 'react';
import { subscribeToHostSessionReset } from './host-session-reset.ts';
import type { InspectorView } from '../domain/run-inspector.ts';
import { createRunInspectorClient, type RunInspectorClient, type InspectorViewIntent } from './run-inspector-client.ts';
const client=createRunInspectorClient();
/** A matching sequence alone cannot turn a live response into historical evidence. */
export function isInspectorViewForRequest(view:InspectorView,request:{runId:string;characterId:string;atWorldSeq?:number;worldRevision?:number}):boolean {
  const cutKind=request.worldRevision!==undefined?'exact-revision':request.atWorldSeq!==undefined?'causal-boundary':'current';
  return view.runId===request.runId&&view.characterId===request.characterId
    &&view.cutKind===cutKind
    &&(request.atWorldSeq===undefined||view.atWorldSeq===request.atWorldSeq)
    &&(request.worldRevision===undefined||view.worldRevision===request.worldRevision);
}
export function PrivateMindView({view,onMemoryPage}:{view:InspectorView;onMemoryPage?:(offset:number)=>void}) {
  const recognition=view.recognitionKnowledge;
  const memory=view.memorySearch;
  return <article><h3>{view.label}</h3><p>Vista privada · commit {view.commitIndex} · revisión {view.worldRevision} · secuencia {view.atWorldSeq} · {view.cutKind==='current'?'estado actual':view.cutKind==='exact-revision'?'revisión histórica exacta':'límite causal histórico; cambios sin evento pueden compartir secuencia'}. Fuente: snapshot confirmado del Escenario.</p>
    <h4>Objetivos</h4><ul>{view.mind.goals.map(goal=><li key={goal.id}>{goal.description} · {goal.state} · prioridad {goal.priority}</li>)}</ul>
    <h4>Creencias</h4><ul>{view.mind.beliefs.map((belief,index)=><li key={index}>{JSON.stringify(belief)}</li>)}</ul>
    <h4>Vínculos subjetivos</h4><ul>{view.mind.relationships.map((relationship,index)=><li key={index}>{JSON.stringify(relationship)}</li>)}</ul>
    <h4>Experiencias conservadas en este snapshot</h4><ul>{view.mind.experiences.map(experience=><li key={experience.experienceId}>{experience.kind}: {JSON.stringify(experience.content)}</li>)}</ul>
    <p>La secuencia causal de una experiencia no demuestra cuándo fue aprendida; esta lista usa únicamente el contenido guardado en el snapshot seleccionado.</p>
    <h4>Reconocimiento técnico propio</h4>{recognition.kind==='current'?<details><summary>Conocimiento actual registrado; no es memoria histórica</summary><pre>{JSON.stringify(recognition.knowledge.bindings,null,2)}</pre></details>:recognition.kind==='checkpoint'?<details><summary>Conocimiento admitido en el corte histórico · revisión {recognition.revision}</summary><pre>{JSON.stringify(recognition.knowledge.bindings,null,2)}</pre></details>:<p>{recognition.reason==='current-knowledge-not-recorded'?'No hay reconocimiento actual registrado.':'Reconocimiento histórico no disponible en este corte; no se consultó el conocimiento actual.'}</p>}
    <h4>Archivo de memoria admitida</h4>{memory.kind==='checkpoint'?<><p>Checkpoint privado del commit {memory.checkpointSource.commitIndex}, registrado {memory.recordedAt}. Archivo de experiencias admitidas; no es una búsqueda semántica de ICM. Se muestran {memory.items.length===0?0:memory.offset+1}–{memory.offset+memory.items.length} de {memory.total}.</p><ol start={memory.offset+1}>{memory.items.map(item=><li key={item.envelope.experienceId}>{item.envelope.content}<small> · {item.envelope.kind} · confianza {item.envelope.confidence} · secuencia causal {item.envelope.worldSeq} · SHA-256 {item.payloadHash}</small></li>)}</ol>{onMemoryPage!==undefined&&<nav aria-label="Páginas de memoria histórica"><button disabled={memory.offset===0} onClick={()=>onMemoryPage(Math.max(0,memory.offset-memory.limit))}>Memoria anterior</button><button disabled={!memory.hasMore} onClick={()=>onMemoryPage(memory.offset+memory.limit)}>Memoria siguiente</button></nav>}</>:<p>{memory.reason==='live-memory-search-not-supported'?'La búsqueda de memoria actual de ICM no está disponible en este inspector. Seleccioná un corte histórico para consultar su archivo, si fue registrado.':'No hay checkpoint privado verificable para este corte. No se consultó la memoria actual ni se reconstruyó el pasado.'}</p>}
  </article>;
}
export function InspectorPanel({runId,atWorldSeq,worldRevision,api=client,onPermissionChange}:{runId:string;atWorldSeq?:number;worldRevision?:number;api?:RunInspectorClient;onPermissionChange?:(allowed:boolean)=>void}) {
  const [expiresAt,setExpiresAt]=React.useState<number|null>(null);
  const [consent,setConsent]=React.useState(false);const [authorized,setAuthorized]=React.useState(false);const [busy,setBusy]=React.useState(false);
  const [actors,setActors]=React.useState<Array<{characterId:string;label:string}>>([]);const [actor,setActor]=React.useState('');const [view,setView]=React.useState<InspectorView|null>(null);const [error,setError]=React.useState<string|null>(null);const [pending,setPending]=React.useState<InspectorViewIntent|null>(null);
  const authorizedRun=React.useRef<string|null>(null);
  const lifetime=React.useRef<AbortController|null>(null);const epoch=React.useRef(0);
  React.useEffect(()=>{
    let controller=new AbortController();lifetime.current=controller;
    const reset=()=>{authorizedRun.current=null;controller.abort();controller=new AbortController();lifetime.current=controller;epoch.current++;setExpiresAt(null);setConsent(false);setAuthorized(false);setActors([]);setActor('');setView(null);setError(null);setPending(null);setBusy(false);};
    reset();const unsubscribe=subscribeToHostSessionReset(reset);
    return()=>{unsubscribe();controller.abort();lifetime.current=null;epoch.current++;};
  },[runId]);
  React.useEffect(()=>{onPermissionChange?.(authorized&&authorizedRun.current===runId);},[authorized,runId,onPermissionChange]);
  React.useEffect(()=>()=>onPermissionChange?.(false),[runId,onPermissionChange]);
  React.useEffect(()=>{epoch.current++;setView(null);setBusy(false);},[atWorldSeq,worldRevision]);
  React.useEffect(()=>{if(!authorized||expiresAt===null)return;const timer=setTimeout(()=>{epoch.current++;setView(null);setActors([]);setActor('');setAuthorized(false);setBusy(false);setPending(null);setError('La sesión privada venció. Recargá la aplicación para abrir otra sesión.');},Math.max(0,expiresAt-Date.now()));return()=>clearTimeout(timer);},[authorized,expiresAt]);
  async function preference(mode:'stage'|'internal',retry?:InspectorViewIntent) {
    const controller=lifetime.current;if(controller===null||(busy&&mode!=='stage'))return;
    const captured=++epoch.current;
    setView(null);setActors([]);setActor('');setAuthorized(false);setBusy(true);setError(null);
    try {const intent=retry??await api.intent(runId,mode,controller.signal);if(controller.signal.aborted||captured!==epoch.current)return;setPending(intent);const result=await api.preference(intent,controller.signal);if(controller.signal.aborted||captured!==epoch.current)return;setPending(null);setExpiresAt(intent.expiresAt===undefined?null:Date.parse(intent.expiresAt));authorizedRun.current=result.mode==='internal'?runId:null;setAuthorized(result.mode==='internal');if(result.mode==='internal'){const list=await api.characters(runId,controller.signal);if(controller.signal.aborted||captured!==epoch.current)return;setActors(list.items);}}
    catch {if(!controller.signal.aborted&&captured===epoch.current){setAuthorized(false);setActors([]);setActor('');setView(null);setError('No se confirmó la preferencia o la lectura privada. Recuperá la misma operación; los datos privados fueron retirados de la pantalla.');}}
    finally {if(!controller.signal.aborted&&captured===epoch.current)setBusy(false);}
  }
  async function inspect(memoryOffset=0) {const controller=lifetime.current;if(!authorized||!actor||controller===null||busy||pending!==null)return;const captured=++epoch.current;setBusy(true);setView(null);setError(null);try{const result=await api.inspect(runId,actor,atWorldSeq,controller.signal,worldRevision,{offset:memoryOffset,limit:50});if(!controller.signal.aborted&&captured===epoch.current)setView(result);}catch{if(!controller.signal.aborted&&captured===epoch.current){setAuthorized(false);setActors([]);setActor('');setError('La lectura privada no está disponible. Reconfirmá el permiso; no se sustituyó el pasado por el estado actual.');}}finally{if(!controller.signal.aborted&&captured===epoch.current)setBusy(false);}}
  return <section aria-label="Inspector privado"><h2>Inspector privado</h2><p>Inspeccionar no transmite información a los personajes ni cambia su memoria, contexto o decisiones. Este permiso es independiente del modo de interlocución o dirección.</p>{!authorized&&<><label><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/>Confirmo que quiero consultar datos internos privados de esta corrida.</label><button disabled={!consent||busy||pending!==null} onClick={()=>void preference('internal')}>Activar inspector privado</button></>}{authorized&&<><p role="status">Permiso privado activo para esta sesión y corrida.</p><button onClick={()=>void preference('stage')}>Revocar y retirar datos privados</button><label>Personaje<select value={actor} disabled={busy} onChange={event=>{epoch.current++;setActor(event.target.value);setView(null);}}><option value="">Seleccionar personaje</option>{actors.map(item=><option key={item.characterId} value={item.characterId}>{item.label}</option>)}</select></label><button disabled={busy||!actor||pending!==null} onClick={()=>void inspect()}>Consultar {atWorldSeq===undefined?'corte actual':`secuencia ${atWorldSeq}`}</button></>}{pending!==null&&!busy&&<button onClick={()=>void preference(pending.mode,pending)}>Recuperar la misma preferencia</button>}{error&&<p role="alert">{error}</p>}{view!==null&&authorized&&isInspectorViewForRequest(view,{runId,characterId:actor,...(atWorldSeq===undefined?{}:{atWorldSeq}),...(worldRevision===undefined?{}:{worldRevision})})&&<PrivateMindView view={view} onMemoryPage={offset=>void inspect(offset)}/>}</section>;
}
