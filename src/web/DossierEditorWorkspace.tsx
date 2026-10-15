import React from 'react';
import type { CatalogPage } from '../domain/http.ts';
import { DossierAdaptationImportSchema, type DossierAdaptationImport } from '../domain/catalog.ts';
import { DossierImportPreviewSchema } from '../domain/dossier-exchange.ts';
import type { DossierAdaptationSummary } from '../domain/dossier-exchange.ts';
import { DossierSourceReferenceSchema, type DossierSource } from '../domain/dossier-source.ts';
import type { z } from 'zod';
import { DossierEditorForm } from './DossierEditorForm.tsx';
import { dossierEditableFields, type DossierEditableFields } from './dossier-editor-form.ts';
import { readCatalogPreparationSource, readAdaptationPreparationSource, readPreparationAdaptations } from './source-selection-client.ts';
import { exchangeIntent, executeExchange, exchangeRejection, type ExchangeIntent } from './dossier-exchange-client.ts';
import { DocumentBody } from './DocumentBody.tsx';

type Preview = z.infer<typeof DossierImportPreviewSchema>;
type Pending = { kind: 'preview' | 'apply'; intent: ExchangeIntent };
function reference(source: DossierSource) {
  const common = {kind:source.kind, characterId:source.characterId, revision:source.revision, contentHash:source.contentHash, fullArchiveHash:source.fullArchiveHash};
  return DossierSourceReferenceSchema.parse(source.kind==='catalog-original'?common:{...common,importId:source.importId,adaptationId:source.adaptationId});
}
export function DossierEditorWorkspace({catalog}:{catalog:CatalogPage['items']}) {
  const [character,setCharacter]=React.useState(catalog[0]?.characterId??'');
  const [source,setSource]=React.useState<DossierSource>();
  const [fields,setFields]=React.useState<DossierEditableFields>();
  const [reason,setReason]=React.useState('');
  const [dirty,setDirty]=React.useState(false);
  const [epoch,setEpoch]=React.useState(0);
  const [adaptations,setAdaptations]=React.useState<DossierAdaptationSummary[]>([]);
  const [cursor,setCursor]=React.useState<string|null>(null);
  const [preview,setPreview]=React.useState<Preview>();
  const [saved,setSaved]=React.useState<DossierAdaptationImport>();
  const [confirmed,setConfirmed]=React.useState(false);
  const [pending,setPending]=React.useState<Pending>();
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const lock=React.useRef(false);
  const generation=React.useRef(0);
  React.useEffect(()=>()=>{generation.current++;},[]);
  const blocked=busy||pending!==undefined;
  const changedFields=preview?Object.entries(dossierEditableFields(preview.before)).filter(([name,value])=>JSON.stringify(value)!==JSON.stringify(Object.entries(dossierEditableFields(preview.after)).find(([key])=>key===name)?.[1])).map(([name])=>name):[];
  const fieldNames=new Map(Object.entries({displayName:'Nombre mostrado',aliases:'Alias',performers:'Intérpretes',markdown:'Manuscrito',sourceRefs:'Fuentes',unknowns:'Vacíos',contradictions:'Contradicciones',avatarRef:'Referencia visual',voiceRecipe:'Receta de voz'}));
  async function load(choice:string) {
    if(lock.current||dirty||pending||!choice)return;
    lock.current=true;setBusy(true);setError('');const token=++generation.current;
    try {
      const next=choice==='catalog'?await readCatalogPreparationSource(character):await readAdaptationPreparationSource(choice);
      if(token!==generation.current)return;
      if(next.characterId!==character)throw new Error('La fuente no pertenece al personaje elegido.');
      setSource(next);setFields(dossierEditableFields(next.frozenDossier));setReason('');setPreview(undefined);setSaved(undefined);setConfirmed(false);setEpoch(value=>value+1);
    }catch(failure){if(token===generation.current)setError(failure instanceof Error?failure.message:'No se pudo abrir el expediente.');}
    finally{lock.current=false;if(token===generation.current)setBusy(false);}
  }
  async function list(next?:string) {
    if(lock.current||dirty||pending)return;lock.current=true;setBusy(true);setError('');const token=generation.current;
    try{const page=await readPreparationAdaptations({characterId:character,...(next?{cursor:next}:{})});if(token!==generation.current)return;
      if(page.adaptations.some(entry=>entry.characterId!==character))throw new Error('La biblioteca devolvió otra identidad.');
      setAdaptations(current=>next?[...current,...page.adaptations.filter(entry=>!current.some(old=>old.adaptationId===entry.adaptationId))]:page.adaptations);setCursor(page.nextCursor);
    }catch(failure){setError(failure instanceof Error?failure.message:'No se pudo consultar la biblioteca.');}finally{lock.current=false;setBusy(false);}
  }
  function changed(next:DossierEditableFields){setFields(next);setDirty(true);setPreview(undefined);setSaved(undefined);setConfirmed(false);setError('');}
  async function execute(operation:Pending) {
    if(lock.current)return;lock.current=true;setBusy(true);setPending(operation);setError('');
    try{
      if(operation.kind==='preview'){
        const result=await executeExchange(operation.intent,DossierImportPreviewSchema);
        if(!source||result.characterId!==source.characterId||result.fullBeforeHash!==source.fullArchiveHash)throw new Error('La revisión no corresponde a la fuente elegida.');
        setPreview(result);setConfirmed(false);
      }else{
        const result=await executeExchange(operation.intent,DossierAdaptationImportSchema);
        if(!preview||result.characterId!==preview.characterId||result.baseHash!==preview.sourceHash)throw new Error('La respuesta no corresponde a la revisión confirmada.');
        setSaved(result);setDirty(false);setConfirmed(false);
      }
      setPending(undefined);
    }catch(failure){const rejected=exchangeRejection(failure);if(rejected){setPending(undefined);setPreview(undefined);setConfirmed(false);setError(rejected.message);}else setError('No se confirmó la operación. Conservamos la misma solicitud para reintentar sin duplicarla.');}
    finally{lock.current=false;setBusy(false);}
  }
  function discard(){if(!source||blocked)return;setFields(dossierEditableFields(source.frozenDossier));setReason('');setDirty(false);setPreview(undefined);setConfirmed(false);setSaved(undefined);setError('');setEpoch(value=>value+1);}
  return <section className="dossier-exchange dossier-editor-workspace" aria-label="Editar expedientes"><h1>Crear una adaptación del expediente</h1>
    <p>Revisá todos los campos y conservá el original. Guardar crea otra adaptación; no cambia actores ni representaciones ya preparadas.</p>
    <fieldset disabled={blocked||dirty}><legend>Fuente de la edición</legend><label>Personaje del expediente<select value={character} onChange={event=>{generation.current++;setCharacter(event.target.value);setSource(undefined);setFields(undefined);setAdaptations([]);setCursor(null);setPreview(undefined);setSaved(undefined);}}>{catalog.map(item=><option key={item.characterId} value={item.characterId}>{item.displayName}</option>)}</select></label>
      <label>Expediente de origen<select value="" onChange={event=>{void load(event.target.value);}}><option value="">Elegir explícitamente</option><option value="catalog">Original del catálogo</option>{adaptations.map(item=><option key={item.adaptationId} value={item.adaptationId}>{item.fileName} · revisión {item.revision} · {item.archiveHash.slice(0,12)}</option>)}</select></label>
      <button type="button" onClick={()=>void list()}>Consultar adaptaciones para editar</button>{cursor&&<button type="button" onClick={()=>void list(cursor)}>Más adaptaciones para editar</button>}
    </fieldset>
    {source&&fields&&<><p>Fuente exacta: {source.kind==='catalog-original'?'catálogo':'adaptación'} · revisión {source.revision} · {source.fullArchiveHash}</p>
      <DossierEditorForm key={`${source.fullArchiveHash}:${epoch}`} initial={source.frozenDossier} disabled={blocked||saved!==undefined} avatarSlugs={catalog.filter(item=>item.characterId===source.characterId).map(item=>item.avatarRef.slug)} onChange={changed}/>
      <fieldset disabled={blocked||saved!==undefined}><legend>Motivo de la nueva versión</legend><label>Motivo y límites de la edición<textarea maxLength={4000} value={reason} onChange={event=>{setReason(event.target.value);setDirty(true);setPreview(undefined);setConfirmed(false);}}/></label>
        <button type="button" disabled={!dirty||!reason.trim()} onClick={()=>void execute({kind:'preview',intent:exchangeIntent('/api/v1/dossier-edits/preview',{source:reference(source),fields,reason})})}>Revisar la nueva adaptación</button>
      </fieldset>
      {dirty&&<button type="button" disabled={blocked} onClick={discard}>Descartar cambios del expediente</button>}
    </>}
    {preview&&!saved&&<div className="dossier-edit-review"><h2>Revisión antes de guardar</h2><p>Campos modificados: {changedFields.length?changedFields.map(name=>fieldNames.get(name)??name).join(', '):'sólo procedencia editorial'}.</p><p>Vence: {new Date(preview.expiresAt).toLocaleString('es')}. La fuente anterior permanece intacta.</p>
      <details><summary>Expediente anterior completo</summary><DocumentBody text={preview.before.markdown}/><pre>{JSON.stringify({...preview.before,markdown:undefined},null,2)}</pre></details>
      <details open><summary>Nueva versión y procedencia del host</summary><DocumentBody text={preview.after.markdown}/><pre>{JSON.stringify({...preview.after,markdown:undefined},null,2)}</pre></details>
      <label><input type="checkbox" disabled={blocked} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/> Revisé los campos y la procedencia; quiero guardar una adaptación independiente.</label>
      <button type="button" disabled={blocked||!confirmed} onClick={()=>void execute({kind:'apply',intent:exchangeIntent('/api/v1/dossier-edits/apply',{importId:preview.importId,previewToken:preview.previewToken,confirmDiffHash:preview.diffHash},`"import:${preview.importId}:r0"`)})}>Guardar adaptación editada</button>
    </div>}
    {saved&&<div><p role="status">Adaptación editada guardada: {saved.adaptationId} · revisión {saved.importedDossier.revision}. Elegila explícitamente al preparar un actor.</p><details><summary>Procedencia de la edición guardada</summary>{saved.importedDossier.adaptations.filter(entry=>entry.editorial!==undefined&&entry.adaptationId===preview?.after.adaptations.at(-1)?.adaptationId).map(entry=><p key={entry.adaptationId}>Autor: {entry.editorial?.authorPrincipalId} · {entry.createdAt} · {entry.reason} · Archivo parental: {entry.editorial?.parentArchiveHash}</p>)}</details></div>}
    {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Esperando confirmación del host…</p>}{pending&&!busy&&<button type="button" onClick={()=>void execute(pending)}>Reintentar la misma edición</button>}
  </section>;
}
