import React from 'react';
import {PublicNarrationPageSchema,type PublicNarrationPage} from '../domain/narration-observation.ts';
import {bootstrapSession} from './client.ts';

export function NarrationPanel({runId,worldSeq,worldRevision,active=true}:{runId:string;worldSeq:number;worldRevision:number;active?:boolean}) {
  const [page,setPage]=React.useState<PublicNarrationPage|null>(null);
  const [cursor,setCursor]=React.useState<string>();const [error,setError]=React.useState('');
  const epoch=React.useRef(0);
  React.useEffect(()=>{++epoch.current;setPage(null);setCursor(undefined);setError('');},[runId,worldSeq,worldRevision]);
  React.useEffect(()=>{
    if(!active)return;
    const controller=new AbortController();const generation=++epoch.current;let timer:ReturnType<typeof setTimeout>|undefined;
    async function poll(){
      try{
        await bootstrapSession();if(controller.signal.aborted)return;
        const query=new URLSearchParams({atWorldSeq:String(worldSeq),worldRevision:String(worldRevision),limit:'25',...(cursor===undefined?{}:{cursor})});
        const response=await fetch(`/api/v1/runs/${encodeURIComponent(runId)}/narrations?${query}`,{credentials:'same-origin',signal:controller.signal});
        if(!response.ok)throw new Error('Narration unavailable');
        const value=PublicNarrationPageSchema.parse(await response.json());
        if(value.runId!==runId||value.atWorldSeq!==worldSeq||value.worldRevision!==worldRevision)throw new Error('Narration scope mismatch');
        if(!controller.signal.aborted&&generation===epoch.current){setPage(value);setError('');}
      }catch{if(!controller.signal.aborted&&generation===epoch.current)setError('No se pudo actualizar la narración de este corte.');}
      finally{if(!controller.signal.aborted&&generation===epoch.current)timer=setTimeout(()=>void poll(),2000);}
    }
    void poll();return ()=>{controller.abort();if(timer!==undefined)clearTimeout(timer);};
  },[runId,worldSeq,worldRevision,cursor,active]);
  return <section aria-label="Narración en voz en off"><h2>Voz en off</h2><p>Publicaciones del Narrador sobre hechos registrados de este corte. No son mensajes dirigidos al reparto.</p>
    {page===null&&!error&&<p role="status">Consultando narración confirmada…</p>}
    {page?.items.length===0&&<p>Sin narraciones publicadas en este corte.</p>}
    {page?.items.map(item=><article key={item.publicationId}><p style={{whiteSpace:'pre-wrap'}}>{item.text}</p><small>Sobre el corte {item.sourceWorldSeq}, revisión {item.sourceWorldRevision}. Publicada {new Date(item.publishedAt).toLocaleString('es')}.</small>{item.uncertainty.kind==='explicit'&&<p>Incertidumbre declarada: {item.uncertainty.markers.join(', ')}.</p>}</article>)}
    {error&&<p role="alert">{error}</p>}
    {page?.nextCursor&&<button onClick={()=>{setPage(null);setCursor(page.nextCursor??undefined);}}>Más narraciones</button>}
    {cursor&&<button onClick={()=>{setPage(null);setCursor(undefined);}}>Volver a la primera página</button>}
  </section>;
}
