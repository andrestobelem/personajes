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
function validateToolProposal(input:Parameters<typeof validatePreparationConfiguratorProposal>[0]){
  try{return validatePreparationConfiguratorProposal(input);}
  catch(error){
    if(error instanceof Error&&error.message==='PREPARATION_CONFIGURATOR_IDENTITY_CONTRADICTION_TREATMENT_REQUIRED')throw new Error('PREPARATION_CONFIGURATOR_IDENTITY_CONTRADICTION_TREATMENT_REQUIRED: contradictionTreatments sólo corresponde a contradicciones de una identidad previamente curada que esta propuesta elimina, con un tratamiento por cada una y la identidad declarada como adaptación. Si no hay identidad curada previa o no eliminás contradicciones de ella, enviá contradictionTreatments: []. Conservá las contradicciones documentales del dossier en actors[].contradictions; no las conviertas en tratamientos.');
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
