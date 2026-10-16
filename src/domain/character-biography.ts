import {z} from 'zod';

const slug=z.string().min(1).max(120).regex(/^[a-z0-9-]+$/);
const text=z.string().trim().min(1).max(8000);
export const DesireIdSchema=slug.brand<'DesireId'>();
export const CuratedLifeHistorySchema=z.strictObject({kind:z.literal('curated-life-history'),
  narrative:z.string().min(1).refine(value=>value.trim().length>0,'La historia de vida no puede estar vacía').refine(value=>new TextEncoder().encode(value).byteLength<=128*1024,'La historia de vida excede128KiB UTF-8'),
  antecedentIds:z.array(slug.brand<'AntecedentId'>()).max(10000),unknowns:z.array(text).max(10000),contradictions:z.array(text).max(10000),
}).superRefine((history,ctx)=>{if(new Set(history.antecedentIds).size!==history.antecedentIds.length)ctx.addIssue({code:'custom',path:['antecedentIds'],message:'La historia repite un antecedente'});});
export const CharacterDesireSchema=z.strictObject({desireId:DesireIdSchema,description:text,stakes:text,tension:text,goalIds:z.array(slug.brand<'GoalId'>()).max(1000)}).superRefine((desire,ctx)=>{if(new Set(desire.goalIds).size!==desire.goalIds.length)ctx.addIssue({code:'custom',path:['goalIds'],message:'El deseo repite un goal'});});
export const CuratedCharacterDesiresSchema=z.array(CharacterDesireSchema).min(1).max(1000).superRefine((desires,ctx)=>{if(new Set(desires.map(desire=>desire.desireId)).size!==desires.length)ctx.addIssue({code:'custom',message:'Los IDs de deseos deben ser únicos'});});
export const EmbodiedCharacterDefinitionSchema=z.object({lifeHistory:CuratedLifeHistorySchema,desires:CuratedCharacterDesiresSchema});
export type CuratedLifeHistory=z.infer<typeof CuratedLifeHistorySchema>;
export type CharacterDesire=z.infer<typeof CharacterDesireSchema>;
export function hasEmbodiedCharacterDefinition(raw:unknown):raw is z.infer<typeof EmbodiedCharacterDefinitionSchema>{return EmbodiedCharacterDefinitionSchema.safeParse(raw).success;}

type IdentityBiography={lifeHistory?:CuratedLifeHistory|undefined;desires?:CharacterDesire[]|undefined};
export function addCharacterBiographyLinkIssues(input:{identity:IdentityBiography;antecedentIds:ReadonlySet<string>;ownGoalIds:ReadonlySet<string>},ctx:z.RefinementCtx){
  for(const [index,id] of (input.identity.lifeHistory?.antecedentIds??[]).entries())if(!input.antecedentIds.has(id))ctx.addIssue({code:'custom',path:['identity','value','lifeHistory','antecedentIds',index],message:'La biografía sólo puede citar antecedentes admitidos de este personaje'});
  for(const [index,desire] of (input.identity.desires??[]).entries())for(const [goalIndex,id] of desire.goalIds.entries())if(!input.ownGoalIds.has(id))ctx.addIssue({code:'custom',path:['identity','value','desires',index,'goalIds',goalIndex],message:'El deseo sólo puede enlazar goals propios o compartidos por este personaje'});
}

/** Revisions cannot silently revert an embodied identity to legacy or erase its
 * declared documentary gaps. Revising desires remains an explicit host action. */
export function assertCharacterBiographyPreserved(input:{previous:IdentityBiography;next:IdentityBiography}){
  const previous=input.previous,next=input.next;
  if(!hasEmbodiedCharacterDefinition(previous))return;
  if(!hasEmbodiedCharacterDefinition(next))throw new Error('CHARACTER_BIOGRAPHY_REMOVAL_FORBIDDEN');
  if(previous.lifeHistory.unknowns.some(value=>!next.lifeHistory.unknowns.includes(value))||previous.lifeHistory.contradictions.some(value=>!next.lifeHistory.contradictions.includes(value)))throw new Error('CHARACTER_BIOGRAPHY_GAPS_REMOVAL_FORBIDDEN');
}
