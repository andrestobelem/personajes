import { ApiProblemSchema } from '../domain/http.ts';
import { IcmWorkspaceAudienceSchema, type IcmWorkspaceAudience } from '../domain/icm-workspace-schema.ts';
import { IcmWorkspacePreviewRequestSchema, IcmWorkspacePreviewResponseSchema, IcmWorkspaceSourcesResponseSchema, type IcmWorkspacePreviewRequest } from '../domain/icm-workspace-selection.ts';
import { bootstrapSession } from './client.ts';

export function icmAudienceKey(audience:IcmWorkspaceAudience):string {
  return audience.role==='actor'?`actor:${audience.actorId}`:audience.role;
}
async function responseBody(response:Response):Promise<unknown>{
  const body:unknown=await response.json();
  if(!response.ok){const problem=ApiProblemSchema.safeParse(body);throw new Error(problem.success?problem.data.error.message:'No se pudo leer la selección ICM.');}
  return body;
}
function selectionKeys(groups:IcmWorkspacePreviewRequest['groups']):string[]{
  return groups.flatMap(group=>group.sourceIds.map(sourceId=>JSON.stringify([icmAudienceKey(group.audience),sourceId,[...(group.sectionIdsBySource[sourceId]??[])].sort()]))).sort();
}
export function createIcmWorkspaceClient(request:typeof fetch=fetch,bootstrap=bootstrapSession){
  return {
    async sources(audienceInput:IcmWorkspaceAudience,signal:AbortSignal){
      const audience=IcmWorkspaceAudienceSchema.parse(audienceInput);await bootstrap();
      const query=new URLSearchParams({role:audience.role});if(audience.role==='actor')query.set('actorId',audience.actorId);
      const response=await request(`/api/v1/icm-workspace/sources?${query}`,{credentials:'same-origin',signal});
      const value=IcmWorkspaceSourcesResponseSchema.parse(await responseBody(response));
      if(icmAudienceKey(value.audience)!==icmAudienceKey(audience)||value.sources.some(source=>source.role!==audience.role))throw new Error('Las fuentes ICM pertenecen a otra audiencia.');
      return value;
    },
    async preview(raw:IcmWorkspacePreviewRequest,signal:AbortSignal){
      const intent=IcmWorkspacePreviewRequestSchema.parse(raw);const session=await bootstrap();
      const response=await request('/api/v1/icm-workspace/preview',{method:'POST',credentials:'same-origin',signal,headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(intent)});
      const value=IcmWorkspacePreviewResponseSchema.parse(await responseBody(response));
      const expected=selectionKeys(intent.groups);
      const snapshot=selectionKeys(value.snapshot.sources.map(source=>({audience:source.audience,sourceIds:[source.sourceId],sectionIdsBySource:{[source.sourceId]:source.sections.map(section=>section.sectionId)}})));
      const selections=selectionKeys(value.selections.map(source=>({audience:source.audience,sourceIds:[source.sourceId],sectionIdsBySource:{[source.sourceId]:source.sectionIds}})));
      if(JSON.stringify(expected)!==JSON.stringify(snapshot)||JSON.stringify(expected)!==JSON.stringify(selections))throw new Error('La vista previa ICM no coincide con las audiencias, fuentes y secciones solicitadas.');
      return value;
    },
  };
}
export type IcmWorkspaceClient=ReturnType<typeof createIcmWorkspaceClient>;
