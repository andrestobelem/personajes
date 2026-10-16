import {z} from 'zod';
import {CharacterIdSchema} from './values.ts';
import {PreparationFieldSchema} from './preparation.ts';

const SettingSectionSchema=z.enum(['name','fictionalAt','continuity','worldLayout','dramaticLine','dramaticReferences','circadianPolicy','spanishVariety','narrationMode','maxReformulations','audio']);
export const PreparationConfiguratorSelectionSchema=z.strictObject({
  settings:z.array(SettingSectionSchema).max(11),
  actors:z.array(z.strictObject({characterId:CharacterIdSchema,sections:z.array(PreparationFieldSchema).min(1).max(9)})).max(1000),
  placements:z.array(CharacterIdSchema).max(1000),
}).superRefine((selection,context)=>{
  const unique=(values:readonly string[],path:(string|number)[])=>{if(new Set(values).size!==values.length)context.addIssue({code:'custom',path,message:'Selección duplicada.'});};
  unique(selection.settings,['settings']);unique(selection.actors.map(actor=>actor.characterId),['actors']);unique(selection.placements,['placements']);
  selection.actors.forEach((actor,index)=>unique(actor.sections,['actors',index,'sections']));
  if(selection.settings.length+selection.actors.length+selection.placements.length===0)context.addIssue({code:'custom',message:'Seleccioná al menos un cambio propuesto.'});
});
export type PreparationConfiguratorSelection=z.infer<typeof PreparationConfiguratorSelectionSchema>;
