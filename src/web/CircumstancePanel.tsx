import React from 'react';
import { subscribeToHostSessionReset } from './host-session-reset.ts';
import { ChangeCircumstancePayloadSchema } from '../domain/direction-indications.ts';
import { CircumstanceOperationSchema } from '../domain/world-schema.ts';
import { RunIdSchema } from '../domain/values.ts';
import type { SessionDocument } from './human-interaction-client.ts';
import { captureCircumstanceIntent, createRunCircumstanceClient, type CircumstanceDocument, type CircumstanceIntent, type RunCircumstanceClient } from './run-circumstance-client.ts';

const client=createRunCircumstanceClient();
const uncertain=new Map<string,CircumstanceIntent>();
export async function sendCircumstanceIntent(intent:CircumstanceIntent,api:Pick<RunCircumstanceClient,'mutate'>=client){
  const captured=captureCircumstanceIntent(intent);uncertain.set(captured.runId,captured);
  try{const result=await api.mutate(captured);uncertain.delete(captured.runId);return result;}
  catch(error){
    const status=typeof error==='object'&&error!==null&&'status' in error&&typeof error.status==='number'?error.status:undefined;
    if(status!==undefined&&status>=400&&status<500&&status!==408)uncertain.delete(captured.runId);
    throw error;
  }
}
const stateLabels:Record<string,string>={dark:'Oscuro',dim:'Tenue',normal:'Normal',bright:'Brillante',open:'Abierta',closed:'Cerrada',locked:'Con llave',available:'Disponible',unavailable:'No disponible'};
function stateLabel(value:string){return stateLabels[value]??value;}
function shortDescription(value:string){return value.length>120?`${value.slice(0,119)}…`:value;}
type OperationKind=ReturnType<typeof CircumstanceOperationSchema.parse>['kind'];
export function CircumstanceComposer({document,enabled,onSubmit}:{document:CircumstanceDocument;enabled:boolean;onSubmit:(operation:ReturnType<typeof CircumstanceOperationSchema.parse>)=>void}){
  const [kind,setKind]=React.useState<OperationKind>('setLighting');
  const [target,setTarget]=React.useState('');const [value,setValue]=React.useState('');
  const [place,setPlace]=React.useState('');const [x,setX]=React.useState('0');const [y,setY]=React.useState('0');
  const options=document.page;
  const conditions=options.catalog?.environmentConditions??[];
  const templates=options.catalog?.objectTemplates??[];
  const template=templates.find(item=>item.id===target);
  const condition=conditions.find(item=>item.id===target);
  const selectedPlace=options.places.find(item=>item.id===place);
  const targets=kind==='setDoorState'?options.doors.map(item=>({id:item.id,label:`${item.label} · ${stateLabel(item.state)}`})):
    kind==='setLighting'?options.places.map(item=>({id:item.id,label:`${item.name} · ${stateLabel(item.lighting)}`})):
    kind==='setDeviceAvailability'?options.devices.map(item=>({id:item.entityId,label:`${item.label} · ${stateLabel(item.availability)}`})):
    kind==='setEnvironment'?conditions.map(item=>({id:item.id,label:item.label})):
    templates.map(item=>({id:item.id,label:item.object.label}));
  const values=kind==='setEnvironment'?(condition?.states.map(item=>({id:item.id,label:shortDescription(item.description)}))??[]):
    (kind==='setDoorState'?['open','closed','locked']:kind==='setLighting'?['dark','dim','normal','bright']:
      kind==='setDeviceAvailability'?['available','unavailable']:[]).map(id=>({id,label:stateLabel(id)}));
  const places=kind==='appearObject'?options.places.filter(item=>template?.allowedPlaceIds.includes(item.id)):options.places;
  const operation=CircumstanceOperationSchema.safeParse(kind==='setDoorState'?{kind,doorId:target,state:value}:
    kind==='setLighting'?{kind,placeId:target,level:value}:kind==='setDeviceAvailability'?{kind,deviceEntityId:target,availability:value}:
    kind==='setEnvironment'?{kind,placeId:place,conditionId:target,stateId:value}:{kind,templateId:target,placeId:place,position:{x:Number(x),y:Number(y)}});
  const valid=operation.success&&targets.some(item=>item.id===target)&&(kind!=='setEnvironment'&&kind!=='appearObject'||places.some(item=>item.id===place))
    &&(kind!=='appearObject'||(x.trim()!==''&&y.trim()!==''&&selectedPlace!==undefined&&Number(x)>=0&&Number(y)>=0&&Number(x)<=selectedPlace.width&&Number(y)<=selectedPlace.height));
  return <form onSubmit={event=>{event.preventDefault();if(enabled&&valid&&operation.success)onSubmit(operation.data);}}>
    <fieldset disabled={!enabled}><legend>Cambio físico del Escenario</legend>
      <label>Tipo de circunstancia<select value={kind} onChange={event=>{const parsed=CircumstanceOperationSchema.options.find(item=>item.shape.kind.value===event.currentTarget.value);if(parsed){setKind(parsed.shape.kind.value);setTarget('');setValue('');setPlace('');}}}>
        <option value="setLighting">Iluminación</option><option value="setDoorState">Puerta</option><option value="setDeviceAvailability">Disponibilidad de dispositivo</option><option value="setEnvironment">Condición ambiental</option><option value="appearObject">Aparición de objeto preparado</option>
      </select></label>
      <label>Objetivo preparado<select value={target} onChange={event=>{setTarget(event.currentTarget.value);setValue('');setPlace('');}}><option value="">Elegir objetivo</option>{targets.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      {targets.length===0&&<p>No hay objetivos preparados para esta familia. Configurá el Escenario y su catálogo en la preparación inicial.</p>}
      {kind!=='appearObject'&&<label>Estado solicitado<select value={value} onChange={event=>setValue(event.currentTarget.value)}><option value="">Elegir estado</option>{values.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      {(kind==='appearObject'||kind==='setEnvironment')&&<label>Lugar<select value={place} onChange={event=>setPlace(event.currentTarget.value)}><option value="">Elegir lugar</option>{places.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {kind==='setEnvironment'&&<p>Estado registrado en el lugar: {shortDescription(condition?.states.find(state=>state.id===options.environment?.find(item=>item.placeId===place&&item.conditionId===target)?.stateId)?.description??'sin condición registrada')}.</p>}
      {kind==='appearObject'&&<><label>Posición X<input type="number" min="0" max={selectedPlace?.width} step="any" value={x} onChange={event=>setX(event.currentTarget.value)}/></label><label>Posición Y<input type="number" min="0" max={selectedPlace?.height} step="any" value={y} onChange={event=>setY(event.currentTarget.value)}/></label><p>El host comprueba límites y colisiones antes de confirmar la aparición.</p></>}
      <button type="submit" disabled={!enabled||!valid}>Aplicar circunstancia</button>
    </fieldset>
  </form>;
}

export function CircumstancePanel({runId,session,active=true,onCommitted}:{runId:string;session:SessionDocument|null;active?:boolean;onCommitted?:()=>void}){
  const [document,setDocument]=React.useState<CircumstanceDocument|null>(null);const [message,setMessage]=React.useState<string|null>(null);
  const [busy,setBusy]=React.useState(false);const [pending,setPending]=React.useState<CircumstanceIntent|null>(()=>uncertain.get(runId)??null);
  const epoch=React.useRef(0);
  React.useEffect(()=>subscribeToHostSessionReset(()=>{epoch.current+=1;setDocument(null);setBusy(false);setMessage('La sesión del host cambió. Activá Dirección de nuevo antes de consultar circunstancias.');}),[]);
  const mode=session?.view.mode;const director=mode?.kind==='director'&&mode.runId===runId;
  const scopeKey=director?JSON.stringify(mode.scope):'';
  const reload=React.useCallback(async()=>{const started=++epoch.current;setDocument(null);if(!active||!director)return;
    setBusy(true);try{const next=await client.read(runId);if(started===epoch.current){setDocument(next);setMessage(null);}}
    catch(error){if(started===epoch.current)setMessage(error instanceof Error?error.message:'No se pudo consultar circunstancias.');}
    finally{if(started===epoch.current)setBusy(false);}
  },[active,director,runId,scopeKey]);
  React.useEffect(()=>{setPending(uncertain.get(runId)??null);void reload();return()=>{epoch.current+=1;};},[reload,runId]);
  async function submit(intent:CircumstanceIntent){if(busy||!director||!active)return;const started=epoch.current;setBusy(true);setPending(intent);setMessage(null);
    try{const result=await sendCircumstanceIntent(intent);if(started!==epoch.current)return;setPending(null);
      if(result.kind==='stored'||result.kind==='existing'){
        setDocument(null);setMessage(result.receipt.effect.kind==='unchanged'?'Confirmado: el estado solicitado ya estaba vigente; no hubo cambio físico.':'Circunstancia confirmada en el Escenario. Cada personaje percibe sólo lo que le corresponde.');
        onCommitted?.();
      }else{setDocument(null);setMessage('El host no confirmó el cambio. Actualizá las circunstancias y revisá el estado antes de intentar otra operación.');}
    }catch(error){if(started!==epoch.current)return;setPending(uncertain.get(runId)??null);setDocument(null);setMessage(error instanceof Error?error.message:'Resultado incierto. Conservá la misma operación.');}
    finally{if(started===epoch.current)setBusy(false);}
  }
  const operational=document!==null&&['running','paused'].includes(document.page.lifecycle);
  return <section aria-label="Circunstancias del Escenario"><h3>Circunstancias</h3><p>Dirección modifica condiciones físicas; no escribe respuestas, recuerdos ni pensamientos de los personajes.</p>
    {!director&&<p>Activá Dirección arriba para consultar objetivos y cambiar circunstancias.</p>}
    {message&&<p role="status">{message}</p>}
    <button disabled={!active||!director||busy} onClick={()=>void reload()}>Actualizar circunstancias</button>
    {document&&<><p>Alcance confirmado: {document.page.scope.kind==='run'?'corrida':`escena ${document.page.scope.sceneId}`} · Escenario {document.page.worldRevision} · Dirección {document.page.directionRevision}.</p>
      {!operational&&<p>La representación debe estar en curso o pausada para cambiar circunstancias.</p>}
      <CircumstanceComposer key={`${runId}:${scopeKey}`} document={document} enabled={active&&director&&operational&&!busy&&pending===null} onSubmit={operation=>{
        const payload=ChangeCircumstancePayloadSchema.parse({kind:'changeCircumstance',scope:document.page.scope,operation});
        void submit({runId:RunIdSchema.parse(runId),etag:document.etag,key:crypto.randomUUID(),payload});
      }}/></>}
    {pending&&<div role="alert"><p>Resultado incierto: se conserva exactamente el cambio, revisión y clave originales.</p><button disabled={busy||!active||!director} onClick={()=>void submit(pending)}>Reintentar la misma circunstancia</button></div>}
  </section>;
}
