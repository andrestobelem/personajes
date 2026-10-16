import {z} from 'zod';
import {ProductionAudioSchema,RunConfigurationDraftSchema} from '../domain/production.ts';

export const OperationalDefaultPresetSchema=z.enum(['free-performance','manual-direction','text-narrator']);
export type OperationalDefaultPreset=z.infer<typeof OperationalDefaultPresetSchema>;
export const OPERATIONAL_DEFAULT_PRESETS=[
  {id:'free-performance',label:'Actuación libre (recomendado)',description:'Los personajes actúan con reloj automático; narrador y audio desactivados.'},
  {id:'manual-direction',label:'Dirección manual',description:'El operador decide cuándo avanza el reloj; narrador y audio desactivados.'},
  {id:'text-narrator',label:'Con narrador textual',description:'Reloj automático y narración textual; el audio continúa desactivado.'},
] satisfies readonly {id:OperationalDefaultPreset;label:string;description:string}[];

const ApplySchema=z.strictObject({draft:RunConfigurationDraftSchema,presetId:OperationalDefaultPresetSchema,
  operatorId:z.string().min(1).max(200),recordedAt:z.string().datetime({offset:true})});

/** An explicit local editing action. Does not save, authenticate, invoke models,
 * create voices or alter fictional facts; historical constructors stay unchanged. */
export function applyOperationalDefaults(raw:unknown){
  const {draft,presetId,operatorId,recordedAt}=ApplySchema.parse(raw);
  const evidence={kind:'operator-choice',operatorId,recordedAt};
  const configured=(value:unknown)=>({kind:'configured',value,evidence});
  const oldAudio=draft.audio.kind==='empty'?undefined:draft.audio.value;
  const audio=ProductionAudioSchema.parse(oldAudio===undefined?{
    mode:{kind:'disabled'},speakerSlots:[],narratorSlot:{kind:'absent'},soundEffectSlots:[],
  }:{...oldAudio,mode:{kind:'disabled'}});
  return RunConfigurationDraftSchema.parse({...draft,
    budget:configured({maxPiCallsPerRun:null,maxPiCallsPerPulse:null,maxConcurrentPiRequests:1,maxWallTimeMs:null,requestTimeoutMs:300_000}),
    circadianPolicy:configured(presetId==='manual-direction'?{kind:'manual-only'}:{kind:'advance-while-running',maxAdvanceMs:60_000}),
    spanishVariety:configured({kind:'proposed',label:'Español latinoamericano de doblaje · propuesta editorial',source:'editorial-proposal'}),
    narrationMode:configured({kind:presetId==='text-narrator'?'enabled':'disabled'}),
    audio:configured(audio),
  });
}
