import {randomUUID} from 'node:crypto';
import {Type} from '@earendil-works/pi-ai';
import {z} from 'zod';
import type {PiCustomTool,RequestEligibility} from '../adapters/pi.ts';
import {sha256CanonicalJson} from '../domain/canonical-json.ts';
import {HashSchema} from '../domain/values.ts';
import {PreparationConfiguratorProposalSchema} from '../domain/preparation-configurator.ts';
import {validatePreparationConfiguratorContext,validatePreparationConfiguratorProposal} from './preparation-configurator-context.ts';

export const PreparationConfiguratorLocalCandidateSchema=z.strictObject({kind:z.literal('local-preparation-configurator-candidate'),candidateId:z.uuid(),contextHash:HashSchema,proposalHash:HashSchema,proposal:PreparationConfiguratorProposalSchema});
const EligibilitySchema=z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('active')}),z.strictObject({kind:z.literal('inactive'),reason:z.string().min(1).max(120)})]);
type ToolContext=ReturnType<typeof validatePreparationConfiguratorContext>;
type Explained={sourceRefs?:unknown;treatment?:unknown};
function explainedEntries(raw:unknown):{location:string;value:Explained}[]{
  const entry=(location:string,value:Record<string,unknown>)=>({location,value:{sourceRefs:value.sourceRefs,treatment:value.treatment}});
  const proposal=z.object({settings:z.array(z.object({section:z.string()}).passthrough()).catch([]),actors:z.array(z.object({characterId:z.string(),sections:z.array(z.object({section:z.string()}).passthrough()).catch([])}).passthrough()).catch([]),placements:z.array(z.object({characterId:z.string()}).passthrough()).catch([])}).passthrough().safeParse(raw);
  if(!proposal.success)return [];
  return [...proposal.data.settings.map(value=>entry(`settings.${value.section}`,value)),
    ...proposal.data.actors.flatMap(actor=>actor.sections.map(value=>entry(`actors.${actor.characterId}.${value.section}`,value))),
    ...proposal.data.placements.map(value=>entry(`placements.${value.characterId}`,value))];
}
function admittedRefs(context:ToolContext){
  const refs=[...context.documents.map(document=>document.sourceId),...context.actorSources.flatMap(source=>source.frozenDossier.sourceRefs.map(ref=>ref.id))];
  return refs.length===0?'ninguno: este corte no admite referencias documentales':refs.join(', ');
}
function admittedContinuity(context:ToolContext,raw:unknown){
  const parsed=PreparationConfiguratorProposalSchema.safeParse(raw);
  const proposed=parsed.success?parsed.data.settings.find(setting=>setting.section==='continuity'):undefined;
  const continuity=proposed?.section==='continuity'?proposed.value:context.draft.continuity.kind==='empty'?undefined:context.draft.continuity.value;
  const milestones=continuity?.milestones.map(value=>`${value.milestoneId} (${value.status})`)??[];
  const inclusions=continuity?.inclusions.map(value=>value.inclusionId)??[];
  return `Hitos admitidos: ${milestones.join(', ')||'ninguno'}. Inclusiones admitidas: ${inclusions.join(', ')||'ninguna'}.`;
}
/** Rejections are returned to the model; a bare code gives it nothing to correct. */
function toolRejection(code:string,context:ToolContext,raw:unknown):string|undefined{
  const selected=context.actorSources.map(source=>source.characterId).join(', ');
  const resend='Corregí sólo eso y reenviá la propuesta completa; no envíes un fragmento ni vacíes actors.';
  switch(code){
    case 'PREPARATION_CONFIGURATOR_IDENTITY_CONTRADICTION_TREATMENT_REQUIRED':return 'contradictionTreatments sólo corresponde a contradicciones de una identidad previamente curada que esta propuesta elimina, con un tratamiento por cada una y la identidad declarada como adaptación. Si no hay identidad curada previa o no eliminás contradicciones de ella, enviá contradictionTreatments: []. Conservá las contradicciones documentales del dossier en actors[].contradictions; no las conviertas en tratamientos.';
    case 'PREPARATION_CONFIGURATOR_DOCUMENTARY_REFERENCE_REQUIRED':{
      const offending=explainedEntries(raw).filter(entry=>entry.value.treatment==='documentary-selection'&&Array.isArray(entry.value.sourceRefs)&&entry.value.sourceRefs.length===0).map(entry=>entry.location);
      return `treatment documentary-selection exige al menos un sourceRef admitido. Entradas sin referencia: ${offending.join(', ')||'(revisá cada sección)'}. IDs admitidos: ${admittedRefs(context)}. Sin una referencia admitida, usá declared-adaptation y explicá la adaptación en la razón; no inventes referencias. ${resend}`;
    }
    case 'PREPARATION_CONFIGURATOR_REFERENCE_NOT_ADMITTED':return `Usaste un sourceRef que no está admitido. IDs admitidos: ${admittedRefs(context)}. No uses URLs, hashes ni nombres de archivo. ${resend}`;
    case 'PREPARATION_CONFIGURATOR_PROPOSAL_ACTORS_MISMATCH':return `actors debe contener exactamente una entrada por cada personaje seleccionado (${selected}), y placements sólo puede referirse a ellos. ${resend}`;
    case 'PREPARATION_CONFIGURATOR_CONTINUITY_MISMATCH':return `Un antecedente o una condición de revisión de un Goal cita un hito o una inclusión que no existe en la continuidad admitida, o un estado de hito distinto. ${admittedContinuity(context,raw)} Usá sólo esos IDs; no inventes milestoneId ni inclusionId. Si no hay ninguno, registrá el antecedente con kind biography y applicability unconditional, y usá condiciones de revisión de tipo circumstance. ${resend}`;
    case 'PREPARATION_CONFIGURATOR_MILESTONE_CONDITION_REQUIRED':return `Un antecedente kind milestone necesita applicability milestone-state o explicit-inclusion con un ID admitido. ${admittedContinuity(context,raw)} Si no hay ninguno, usá kind biography con applicability unconditional. ${resend}`;
    default:return undefined;
  }
}
function validateToolProposal(input:{context:ToolContext;proposal:unknown}){
  try{return validatePreparationConfiguratorProposal(input);}
  catch(error){
    const guidance=error instanceof Error?toolRejection(error.message,input.context,input.proposal):undefined;
    if(error instanceof Error&&guidance!==undefined)throw new Error(`${error.message}: ${guidance}`);
    throw error;
  }
}


/** This tool stages one immutable local suggestion. Only the host may accept a
 * durable result; acceptance still does not apply it to the operator's draft. */
export function createPreparationConfiguratorProposalTool(input:{context:unknown;checkEligibility:()=>RequestEligibility|Promise<RequestEligibility>;signal?:AbortSignal}){
  const context=validatePreparationConfiguratorContext(input.context);let candidate:z.infer<typeof PreparationConfiguratorLocalCandidateSchema>|undefined;
  const tool={name:'submit_preparation_proposal',label:'Proponer preparación',description:'Propone puesta y curaciones por actor con fuentes, razones y vacíos. No confirma ni cambia el borrador, sus fuentes, memoria, participantes humanos, perfil o presupuesto; no inicia una representación.',parameters:Type.Unsafe(z.toJSONSchema(PreparationConfiguratorProposalSchema,{io:'input'})),
    async execute(_id:string,raw:unknown,signal?:AbortSignal){
      const active=()=>{if(signal?.aborted||input.signal?.aborted)throw new Error('PREPARATION_CONFIGURATOR_CANCELLED');};active();
      const proposal=validateToolProposal({context,proposal:raw});
      const eligibility=EligibilitySchema.parse(await input.checkEligibility());active();if(eligibility.kind!=='active')throw new Error('PREPARATION_CONFIGURATOR_INACTIVE');
      const proposalHash=sha256CanonicalJson(proposal),existing=candidate!==undefined;
      if(candidate!==undefined&&(candidate.proposalHash!==proposalHash||sha256CanonicalJson(candidate.proposal)!==proposalHash))throw new Error('PREPARATION_CONFIGURATOR_CANDIDATE_CONFLICT');
      candidate??=PreparationConfiguratorLocalCandidateSchema.parse({kind:'local-preparation-configurator-candidate',candidateId:randomUUID(),contextHash:context.contextHash,proposalHash,proposal});
      return {content:[{type:'text' as const,text:'Propuesta local registrada para revisión; no modifica ni confirma el borrador o los actores.'}],details:{kind:'local-preparation-configurator-candidate',candidateId:candidate.candidateId,status:existing?'existing':'staged'}};
    },
  } satisfies PiCustomTool;
  return {tool,readCandidate:()=>candidate===undefined?undefined:PreparationConfiguratorLocalCandidateSchema.parse(candidate)};
}
