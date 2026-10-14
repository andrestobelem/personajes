import {z} from 'zod';
import type {createNarrationObservation} from '../application/narration-observation.ts';
import {OperatorResponseSchema,operatorJson,type OperatorExtension} from './operator-extension.ts';
const sequence=z.string().regex(/^(0|[1-9]\d{0,15})$/).transform(Number).pipe(z.number().int().nonnegative().safe());
const QuerySchema=z.strictObject({atWorldSeq:sequence.optional(),worldRevision:sequence.optional(),cursor:z.string().min(1).max(2048).optional(),limit:sequence.pipe(z.number().int().min(1).max(100)).optional()});
export function createNarrationRoutes(application:ReturnType<typeof createNarrationObservation>):OperatorExtension {
  return {name:'narration-observation',matches:({path,method})=>method==='GET'&&path.length===3&&path[0]==='runs'&&path[2]==='narrations',handle(request){
    const counts=new Set<string>();for(const key of request.query.keys()){if(counts.has(key))return OperatorResponseSchema.parse({kind:'problem',status:422,error:{kind:'validation',code:'NARRATION_QUERY_INVALID',message:'Parámetros de narración inválidos.',issues:[]}});counts.add(key);}
    const query=QuerySchema.safeParse(Object.fromEntries(request.query));
    if(!query.success)return OperatorResponseSchema.parse({kind:'problem',status:422,error:{kind:'validation',code:'NARRATION_QUERY_INVALID',message:'Parámetros de narración inválidos.',issues:[]}});
    const result=application.read({runId:request.path[1],...query.data});
    if(result.kind==='invalid-cursor')return OperatorResponseSchema.parse({kind:'problem',status:422,error:{kind:'validation',code:'NARRATION_CURSOR_INVALID',message:'El cursor corresponde a otro corte o representación.',issues:[]}});
    if(result.kind==='missing-or-invalid-cut')return OperatorResponseSchema.parse({kind:'problem',status:404,error:{kind:'notFound',code:'NARRATION_CUT_NOT_FOUND',message:'El corte confirmado no está disponible.'}});
    return operatorJson(result.page);
  }};
}
