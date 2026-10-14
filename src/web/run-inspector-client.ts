import { z } from 'zod';
import { ApiProblemSchema, ObserverViewResponseSchema, SessionViewSchema } from '../domain/http.ts';
import { InspectorCharactersSchema, InspectorViewSchema } from '../domain/run-inspector.ts';
import { bootstrapSession } from './client.ts';

export type InspectorViewIntent={runId:string;mode:'stage'|'internal';etag:string;key:string;expiresAt?:string};
export function buildInspectorPreferenceRequest(intent:InspectorViewIntent,csrfToken:string) {
  const runId=z.string().uuid().parse(intent.runId);const key=z.string().uuid().parse(intent.key);
  if(!/^"session:r(0|[1-9]\d{0,15})"$/.test(intent.etag))throw new Error('Revisión de sesión inválida');
  return {path:`/api/v1/runs/${runId}/observer-view`,init:{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken,'If-Match':intent.etag,'Idempotency-Key':key},body:JSON.stringify(intent.mode==='internal'?{mode:'internal',confirm:true}:{mode:'stage'})} satisfies RequestInit};
}
export function createRunInspectorClient(request:typeof fetch=(url,options)=>fetch(url,options)) {
  async function body(response:Response) {const value:unknown=await response.json();if(!response.ok){const parsed=ApiProblemSchema.safeParse(value);throw new Error(parsed.success?parsed.data.error.message:'Inspector no disponible');}return value;}
  return {
    async intent(runId:string,mode:'stage'|'internal',signal:AbortSignal):Promise<InspectorViewIntent>{await bootstrapSession();const response=await request('/api/v1/session',{credentials:'same-origin',signal});const view=SessionViewSchema.parse(await body(response));const etag=`"session:r${view.sessionRevision}"`;if(response.headers.get('etag')!==etag)throw new Error('Sesión sin revisión confirmada');return {runId,mode,etag,key:crypto.randomUUID(),expiresAt:view.expiresAt};},
    async preference(intent:InspectorViewIntent,signal:AbortSignal){const session=await bootstrapSession();const built=buildInspectorPreferenceRequest(intent,session.csrfToken);const response=await request(built.path,{...built.init,signal});return ObserverViewResponseSchema.parse(await body(response));},
    async characters(runId:string,signal:AbortSignal){await bootstrapSession();const response=await request(`/api/v1/runs/${z.string().uuid().parse(runId)}/inspector/characters`,{credentials:'same-origin',signal});const result=InspectorCharactersSchema.parse(await body(response));if(result.runId!==runId)throw new Error('Inspector de otra corrida');return result;},
    async inspect(runId:string,characterId:string,atWorldSeq:number|undefined,signal:AbortSignal,worldRevision?:number){await bootstrapSession();const query=new URLSearchParams({characterId});if(atWorldSeq!==undefined)query.set('atWorldSeq',String(z.number().int().nonnegative().safe().parse(atWorldSeq)));if(worldRevision!==undefined)query.set('worldRevision',String(z.number().int().nonnegative().safe().parse(worldRevision)));const response=await request(`/api/v1/runs/${z.string().uuid().parse(runId)}/inspector?${query}`,{credentials:'same-origin',signal});const result=InspectorViewSchema.parse(await body(response));if(result.runId!==runId||result.characterId!==characterId||(atWorldSeq!==undefined&&result.atWorldSeq!==atWorldSeq)||(worldRevision!==undefined&&result.worldRevision!==worldRevision))throw new Error('Inspector de otro personaje o corte');return result;},
  };
}
export type RunInspectorClient=ReturnType<typeof createRunInspectorClient>;
