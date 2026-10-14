import React from 'react';
import type { z } from 'zod';
import type { CatalogPage } from '../domain/http.ts';
import type { DossierAdaptationImport } from '../domain/catalog.ts';
import { ImportViewSchema, DossierImportPreviewSchema } from '../domain/dossier-exchange.ts';
import { DocumentBody } from './DocumentBody.tsx';
import { applyDossierImport,captureDossierFile,exchangeIntent,exchangeRejection,exportDossierFile,previewDossierImport,sendDossierImport,type ExchangeIntent } from './dossier-exchange-client.ts';

type Pending={kind:'import'|'preview'|'apply'|'export';intent:ExchangeIntent};
function fields(dossier: z.infer<typeof DossierImportPreviewSchema>['before']) {
  const {markdown:_,...normalized}=dossier;return JSON.stringify(normalized,null,2);
}
export function DossierExchangePanel({catalog}:{catalog:CatalogPage['items']}) {
  const [character,setCharacter]=React.useState(catalog[0]?.characterId??'');
  const [imported,setImported]=React.useState<z.infer<typeof ImportViewSchema>>();
  const [preview,setPreview]=React.useState<z.infer<typeof DossierImportPreviewSchema>>();
  const [adaptation,setAdaptation]=React.useState<DossierAdaptationImport>();
  const [download,setDownload]=React.useState<string>();
  const [pending,setPending]=React.useState<Pending>();
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const [confirmed,setConfirmed]=React.useState(false);
  const lock=React.useRef(false);
  async function execute(operation:Pending) {
    if(lock.current)return;lock.current=true;setBusy(true);setPending(operation);setError('');
    try {
      switch(operation.kind){
        case 'import':setImported(await sendDossierImport(operation.intent));setPreview(undefined);setAdaptation(undefined);setConfirmed(false);break;
        case 'preview':setPreview(await previewDossierImport(operation.intent));setConfirmed(false);break;
        case 'apply':setAdaptation(await applyDossierImport(operation.intent));break;
        case 'export':{const result=await exportDossierFile(operation.intent);setDownload(`/api/v1/exports/${result.exportId}/download`);break;}
      }
      setPending(undefined);
    }catch(error){const rejection=exchangeRejection(error);if(rejection){setPending(undefined);setError(rejection.message);if(operation.kind==='apply'){setPreview(undefined);setConfirmed(false);}}else setError('No se confirmó la operación. Podés consultar o reintentar la misma solicitud; se conserva su identidad.');}
    finally{lock.current=false;setBusy(false);}
  }
  async function pick(file:File|undefined) {
    if(!file||lock.current||pending)return;
    lock.current=true;setBusy(true);setError('');
    let body:Awaited<ReturnType<typeof captureDossierFile>>;
    try {body=await captureDossierFile(file);}catch{setError('El archivo no es un expediente portable válido o supera 16 MiB.');return;}
    finally{lock.current=false;setBusy(false);}
    await execute({kind:'import',intent:exchangeIntent('/api/v1/imports',body)});
  }
  const blocked=busy||pending!==undefined;
  return <section className="dossier-exchange" aria-label="Intercambio de expedientes">
    <h1>Importar y exportar expedientes</h1>
    <p>Conservá una copia portable o revisá un expediente importado antes de crear una adaptación. El original investigado se conserva.</p>
    <fieldset disabled={blocked}><legend>Exportar</legend><label>Personaje <select value={character} onChange={event=>setCharacter(event.target.value)}>{catalog.map(item=><option key={item.characterId} value={item.characterId}>{item.displayName}</option>)}</select></label>
      <button type="button" disabled={!character} onClick={()=>void execute({kind:'export',intent:exchangeIntent('/api/v1/exports',{kind:'dossier',characterId:character})})}>Preparar archivo</button></fieldset>
    {download&&<p><a href={download} download>Descargar expediente portable</a></p>}
    <fieldset disabled={blocked}><legend>Importar</legend><label>Archivo de expediente (.json, hasta 16 MiB) <input type="file" accept="application/json,.json" onChange={event=>{const file=event.target.files?.[0];event.target.value='';void pick(file);}} /></label></fieldset>
    {imported&&<p role="status">Expediente {imported.characterId}: {adaptation?'adaptación creada':'en cuarentena para revisar'}.</p>}
    {imported&&!adaptation&&<button type="button" disabled={blocked} onClick={()=>void execute({kind:'preview',intent:exchangeIntent(`/api/v1/imports/${imported.importId}/preview`,{})})}>Revisar diferencias</button>}
    {preview&&!adaptation&&<div><p>Comparación para {preview.characterId}. Original r{preview.targetRevision}; importado r{preview.sourceRevision}. La revisión vence {new Date(preview.expiresAt).toLocaleTimeString('es')}.</p>
      <details><summary>Original conservado</summary><DocumentBody text={preview.before.markdown}/><details><summary>Todos los campos y procedencia del original</summary><pre>{fields(preview.before)}</pre></details></details><details open><summary>Expediente importado</summary><DocumentBody text={preview.after.markdown}/><details><summary>Todos los campos y procedencia importados</summary><pre>{fields(preview.after)}</pre></details></details>
      <label><input type="checkbox" disabled={blocked} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/> Revisé ambos expedientes y quiero crear esta adaptación independiente.</label>
      <button type="button" disabled={blocked||!confirmed||!imported} onClick={()=>{if(imported)void execute({kind:'apply',intent:exchangeIntent(`/api/v1/imports/${imported.importId}/apply`,{previewToken:preview.previewToken,confirmDiffHash:preview.diffHash},`"import:${imported.importId}:r${imported.revision}"`)});}}>Crear adaptación revisable</button></div>}
    {adaptation&&<div><p role="status">Adaptación {adaptation.adaptationId} guardada. Requiere curación y selección explícita antes de incorporarse a una representación.</p><details><summary>Leer la adaptación guardada</summary><DocumentBody text={adaptation.importedDossier.markdown}/></details></div>}
    {error&&<p role="alert">{error}</p>}
    {pending&&!busy&&<button type="button" onClick={()=>void execute(pending)}>Reintentar la misma operación</button>}
    {busy&&<p role="status">Esperando confirmación del host…</p>}
  </section>;
}
