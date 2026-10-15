import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CharacterIdSchema, EntityHandleSchema, RunIdSchema } from '../domain/values.ts';

function compareText(left:string,right:string){return left<right?-1:left>right?1:0;}

export const ForkIdentityKindSchema = z.enum(['entity','door','channel','scene','offer','event','perception','goal','experience']);
const UuidSchema = z.string().uuid({version:'v4'});
export const ForkIdentityManifestSchema = z.strictObject({
  kind:z.literal('fork-identities'), sourceRunId:RunIdSchema, targetRunId:RunIdSchema,
  ids:z.array(z.strictObject({kind:ForkIdentityKindSchema,sourceId:UuidSchema,targetId:UuidSchema})),
  handles:z.array(z.strictObject({actorId:CharacterIdSchema,sourceHandle:EntityHandleSchema,targetHandle:EntityHandleSchema})),
  continuities:z.array(z.strictObject({sourceId:z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),targetId:z.string().min(1).max(120).regex(/^[a-z0-9-]+$/)})),
}).superRefine((manifest,context)=>{
  if(manifest.sourceRunId===manifest.targetRunId)context.addIssue({code:'custom',message:'El fork requiere otra corrida'});
  const originalIds=new Set([...manifest.ids.map(entry=>entry.sourceId),...manifest.handles.map(entry=>entry.sourceHandle),...manifest.continuities.map(entry=>entry.sourceId)]);
  const sources=new Set<string>();const targets=new Set<string>([manifest.sourceRunId,manifest.targetRunId]);
  for(const entry of manifest.ids){
    const key=`${entry.kind}:${entry.sourceId}`;
    if(sources.has(key)||targets.has(entry.targetId)||originalIds.has(entry.targetId))context.addIssue({code:'custom',message:'Mapa de identidades ambiguo'});
    sources.add(key);targets.add(entry.targetId);
  }
  const handles=new Set<string>();
  for(const entry of manifest.handles){
    const key=`${entry.actorId}:${entry.sourceHandle}`;
    if(handles.has(key)||targets.has(entry.targetHandle)||originalIds.has(entry.targetHandle))context.addIssue({code:'custom',message:'Mapa de handles ambiguo'});
    handles.add(key);targets.add(entry.targetHandle);
  }
  const continuities=new Set<string>();
  for(const entry of manifest.continuities){
    if(continuities.has(entry.sourceId)||targets.has(entry.targetId)||originalIds.has(entry.targetId))context.addIssue({code:'custom',message:'Mapa de continuidades ambiguo'});
    continuities.add(entry.sourceId);targets.add(entry.targetId);
  }
});
export type ForkIdentityManifest=z.infer<typeof ForkIdentityManifestSchema>;

/** One registry is shared by world, memory, knowledge and configuration transforms. No textual substitution. */
export function createForkIdentityRegistry(input:{sourceRunId:string;targetRunId:string;allocateUuid?:()=>string;restored?:unknown}) {
  const sourceRunId=RunIdSchema.parse(input.sourceRunId);const targetRunId=RunIdSchema.parse(input.targetRunId);
  if(sourceRunId===targetRunId)throw new Error('El fork requiere otra corrida');
  const state:ForkIdentityManifest=input.restored===undefined?{kind:'fork-identities',sourceRunId,targetRunId,ids:[],handles:[],continuities:[]}:ForkIdentityManifestSchema.parse(input.restored);
  if(state.sourceRunId!==sourceRunId||state.targetRunId!==targetRunId)throw new Error('Manifiesto de otra bifurcación');
  const idMap=new Map(state.ids.map(entry=>[`${entry.kind}:${entry.sourceId}`,entry.targetId]));
  const handleMap=new Map(state.handles.map(entry=>[`${entry.actorId}:${entry.sourceHandle}`,entry.targetHandle]));
  const continuityMap=new Map(state.continuities.map(entry=>[entry.sourceId,entry.targetId]));
  const allocate=input.allocateUuid??randomUUID;
  const assigned=new Set<string>([sourceRunId,targetRunId,...state.ids.map(item=>item.targetId),...state.handles.map(item=>item.targetHandle),...state.continuities.map(item=>item.targetId)]);
  function fresh(prefix=''){
    const value=prefix+UuidSchema.parse(allocate());
    if(assigned.has(value))throw new Error('El generador repitió una identidad');
    assigned.add(value);return value;
  }
  return {
    id(rawKind:z.infer<typeof ForkIdentityKindSchema>,rawId:string):string {
      const kind=ForkIdentityKindSchema.parse(rawKind);const sourceId=UuidSchema.parse(rawId);
      const previous=idMap.get(`${kind}:${sourceId}`);if(previous)return previous;
      const targetId=fresh();if(targetId===sourceId)throw new Error('El generador conservó una identidad de origen');
      state.ids.push({kind,sourceId,targetId});idMap.set(`${kind}:${sourceId}`,targetId);return targetId;
    },
    handle(raw:{actorId:string;sourceHandle:string}):string {
      const actorId=CharacterIdSchema.parse(raw.actorId);const sourceHandle=EntityHandleSchema.parse(raw.sourceHandle);
      const previous=handleMap.get(`${actorId}:${sourceHandle}`);if(previous)return previous;
      const targetHandle=EntityHandleSchema.parse(fresh('h-'));
      if(targetHandle===sourceHandle)throw new Error('El generador conservó un handle de origen');
      state.handles.push({actorId,sourceHandle,targetHandle});handleMap.set(`${actorId}:${sourceHandle}`,targetHandle);return targetHandle;
    },
    continuity(rawId:string):string {
      const sourceId=z.string().min(1).max(120).regex(/^[a-z0-9-]+$/).parse(rawId);
      const previous=continuityMap.get(sourceId);if(previous)return previous;
      const targetId=fresh('fork-');if(targetId===sourceId)throw new Error('El generador conservó la continuidad de origen');
      state.continuities.push({sourceId,targetId});continuityMap.set(sourceId,targetId);return targetId;
    },
    manifest():ForkIdentityManifest {
      return ForkIdentityManifestSchema.parse({...state,ids:[...state.ids].sort((a,b)=>compareText(`${a.kind}:${a.sourceId}`,`${b.kind}:${b.sourceId}`)),
        handles:[...state.handles].sort((a,b)=>compareText(`${a.actorId}:${a.sourceHandle}`,`${b.actorId}:${b.sourceHandle}`)),
        continuities:[...state.continuities].sort((a,b)=>compareText(a.sourceId,b.sourceId))});
    },
  };
}
export type ForkIdentityRegistry=ReturnType<typeof createForkIdentityRegistry>;
