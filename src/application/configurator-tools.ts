import { randomUUID } from 'node:crypto';
import { Type } from '@earendil-works/pi-ai';
import { z } from 'zod';
import type { PiCustomTool, RequestEligibility } from '../adapters/pi.ts';
import { ConfiguratorProposalSchema } from '../domain/configurator.ts';
import { HashSchema } from '../domain/values.ts';
import { configuratorValueHash, validateConfiguratorContext, validateConfiguratorProposal } from './configurator-context.ts';

const CandidateSchema=z.strictObject({kind:z.literal('local-configurator-candidate'),candidateId:z.string().uuid(),contextHash:HashSchema,proposalHash:HashSchema,proposal:ConfiguratorProposalSchema});
const EligibilitySchema=z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('active')}),z.strictObject({kind:z.literal('inactive'),reason:z.string().min(1).max(120)})]);
/** Local proposal only: operator consent and future-boundary application require separate host workflows. */
export function createConfiguratorProposalTool(input:{context:unknown;checkEligibility:()=>RequestEligibility|Promise<RequestEligibility>;signal?:AbortSignal}) {
  const context=validateConfiguratorContext(input.context);let candidate:z.infer<typeof CandidateSchema>|undefined;
  const tool={name:'submit_configurator_proposal',label:'Proponer adaptación o consolidación',description:'Propone una nueva adaptación o una promoción futura con versiones, evidencia y vacíos explícitos. No crea canon, modifica actores, memoria, historia, contexto vigente ni registra consentimiento del operador.',parameters:Type.Unsafe(z.toJSONSchema(ConfiguratorProposalSchema,{io:'input'})),
    async execute(_id:string,raw:unknown,signal?:AbortSignal) {
      const requireSignal=()=>{if(signal?.aborted||input.signal?.aborted)throw new Error('Configurator cancelled');};requireSignal();
      const proposal=validateConfiguratorProposal({context,proposal:raw});const eligibility=EligibilitySchema.parse(await input.checkEligibility());requireSignal();if(eligibility.kind!=='active')throw new Error('Configurator context inactive');
      const proposalHash=configuratorValueHash(proposal);const existing=candidate!==undefined;
      if(candidate!==undefined&&(candidate.proposalHash!==proposalHash||configuratorValueHash(candidate.proposal)!==proposalHash))throw new Error('Configurator candidate conflict');
      candidate??=CandidateSchema.parse({kind:'local-configurator-candidate',candidateId:randomUUID(),contextHash:configuratorValueHash(context),proposalHash,proposal});
      return {content:[{type:'text' as const,text:'Propuesta local pendiente de revisión, consentimiento explícito y aceptación durable. No modifica originales ni estado vivido.'}],details:{kind:'local-configurator-candidate',candidateId:candidate.candidateId,status:existing?'existing':'staged'}};
    },
  } satisfies PiCustomTool;
  return {tool,readCandidate:()=>candidate===undefined?undefined:CandidateSchema.parse(candidate)};
}
