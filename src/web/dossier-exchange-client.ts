import { z } from 'zod';
import { ApiProblemSchema } from '../domain/http.ts';
import { DossierArchiveSchema, DossierAdaptationImportSchema } from '../domain/catalog.ts';
import { ImportViewSchema, DossierImportPreviewSchema, DossierExportReceiptSchema } from '../domain/dossier-exchange.ts';
import { bootstrapSession } from './client.ts';

export type ExchangeIntent = Readonly<{path:string;key:string;bodyJson:string;etag?:string}>;
const ExchangeRejectionSchema=z.strictObject({kind:z.literal('exchange-rejected'),message:z.string(),status:z.number().int()});
export const exchangeRejection=(error:unknown)=>ExchangeRejectionSchema.safeParse(error).data;
export function exchangeIntent(path:string,body:unknown,etag?:string):ExchangeIntent {
  if(!/^\/api\/v1\/(imports|exports|dossier-edits)(\/[^?#]+)?$/.test(path))throw new Error('Destino de intercambio inválido.');
  return Object.freeze({path,key:crypto.randomUUID(),bodyJson:JSON.stringify(body),...(etag===undefined?{}:{etag})});
}
export async function executeExchange<T>(intent:ExchangeIntent,schema:z.ZodType<T>):Promise<T> {
  const session=await bootstrapSession();
  const response=await fetch(intent.path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'Idempotency-Key':intent.key,...(intent.etag===undefined?{}:{'If-Match':intent.etag})},body:intent.bodyJson});
  const value:unknown=await response.json();
  if(!response.ok){const problem=ApiProblemSchema.safeParse(value);if(problem.success&&response.status>=400&&response.status<500&&response.status!==408)throw ExchangeRejectionSchema.parse({kind:'exchange-rejected',message:problem.data.error.message,status:response.status});throw new Error('No se confirmó el intercambio.');}
  return schema.parse(value);
}
export const sendDossierImport=(intent:ExchangeIntent)=>executeExchange(intent,ImportViewSchema);
export async function previewDossierImport(intent:ExchangeIntent){const result=await executeExchange(intent,DossierImportPreviewSchema);if(intent.path!==`/api/v1/imports/${result.importId}/preview`)throw new Error('La revisión corresponde a otro expediente.');return result;}
export const applyDossierImport=(intent:ExchangeIntent)=>executeExchange(intent,DossierAdaptationImportSchema);
export const exportDossierFile=(intent:ExchangeIntent)=>executeExchange(intent,DossierExportReceiptSchema);
export async function captureDossierFile(file:File) {
  if(file.size===0||file.size>16*1024*1024)throw new Error('El expediente debe ocupar entre 1 byte y 16 MiB.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  DossierArchiveSchema.parse(JSON.parse(text));
  let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return {kind:'dossier' as const,fileName:'personajes-dossier.json',contentBase64:btoa(binary)};
}
