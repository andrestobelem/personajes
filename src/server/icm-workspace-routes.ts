import {z} from 'zod';
import type {createIcmWorkspaceReader} from '../adapters/icm-workspace.ts';
import {IcmWorkspaceAudienceSchema} from '../domain/icm-workspace-schema.ts';
import {IcmWorkspaceSourcesResponseSchema,IcmWorkspacePreviewRequestSchema,IcmWorkspacePreviewResponseSchema} from '../domain/icm-workspace-selection.ts';
import {operatorJson,OperatorResponseSchema,type OperatorExtension} from './operator-extension.ts';
/** Authenticated local setup operator can inspect manifest sources. A fictional
 * interlocutor and scene-only direction never receive these host instructions. */
export function createIcmWorkspaceRoutes(input:{reader:Pick<ReturnType<typeof createIcmWorkspaceReader>,'listSources'|'previewMany'>}):OperatorExtension{return {name:'icm-workspace',maxBodyBytes:128*1024,matches({path}){return path[0]==='icm-workspace';},async handle(request){try{
 if(request.mode.kind==='interlocutor'||request.mode.kind==='director'&&request.mode.scope.kind!=='run')throw new Error('ICM_WORKSPACE_OPERATOR_REQUIRED');
 if(request.path.length!==2)throw new Error('ICM_WORKSPACE_NOT_FOUND');
 if(request.path[1]==='sources'&&request.kind==='read'){
  const seen=new Set<string>();for(const [key]of request.query){if(seen.has(key)||!['role','actorId'].includes(key))throw new Error('ICM_WORKSPACE_REQUEST_INVALID');seen.add(key);}
  const audience=IcmWorkspaceAudienceSchema.parse(Object.fromEntries(request.query));const sources=input.reader.listSources(audience);if(sources.length===0)throw new Error('ICM_WORKSPACE_AUDIENCE_INVALID');
  return operatorJson(IcmWorkspaceSourcesResponseSchema.parse({kind:'icm-workspace-sources',audience,sources}));
 }
 if(request.path[1]==='preview'&&request.kind==='write'&&request.method==='POST'){
  if(request.query.size!==0)throw new Error('ICM_WORKSPACE_REQUEST_INVALID');const body=IcmWorkspacePreviewRequestSchema.parse(request.body);
  const preview=input.reader.previewMany(body);return operatorJson(IcmWorkspacePreviewResponseSchema.parse({kind:'icm-workspace-preview',...preview}));
 }
 throw new Error('ICM_WORKSPACE_NOT_FOUND');
 }catch(error){const invalid=error instanceof z.ZodError;const code=invalid?'ICM_WORKSPACE_REQUEST_INVALID':error instanceof Error&&/^ICM_WORKSPACE_[A-Z_]{1,80}$/.test(error.message)?error.message:'ICM_WORKSPACE_UNAVAILABLE';const forbidden=code.endsWith('OPERATOR_REQUIRED');const missing=code.endsWith('NOT_FOUND');const unavailable=code.endsWith('UNAVAILABLE');return OperatorResponseSchema.parse({kind:'problem',status:forbidden?403:missing?404:unavailable?503:422,error:{kind:forbidden?'forbidden':missing?'notFound':unavailable?'dependency':'validation',code,message:forbidden?'La selección ICM requiere operación de preparación o Dirección completa.':'La selección ICM no se pudo verificar; revisá las fuentes y secciones permitidas.',...(!forbidden&&!missing&&!unavailable?{issues:[]}:{}),...(unavailable?{safeCode:code,retryable:true}:{})}});}
 }};}
