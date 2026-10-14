import { createHash, randomUUID } from 'node:crypto';
import { Type } from '@earendil-works/pi-ai';
import { z } from 'zod';
import type { PiCustomTool, RequestEligibility } from '../adapters/pi.ts';
import { DirectorObservationSchema } from '../domain/admin-roles.ts';
import { HashSchema } from '../domain/values.ts';
import { canonicalDirectorValue, directorContextHash, validateDirectorContext, validateDirectorObservation } from './director-context.ts';

const CandidateSchema = z.strictObject({
  kind: z.literal('local-director-candidate'), candidateId: z.string().uuid(),
  contextHash: HashSchema, payloadHash: HashSchema, observation: DirectorObservationSchema,
});
const EligibilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({kind:z.literal('active')}),
  z.strictObject({kind:z.literal('inactive'),reason:z.string().min(1).max(120)}),
]);

/** Only stages an interpretation. Durable acceptance and publication belong to the host. */
export function createDirectorObservationTool(input: {
  context: unknown; checkEligibility: () => RequestEligibility | Promise<RequestEligibility>; signal?: AbortSignal;
}) {
  const context = validateDirectorContext(input.context);
  const contextHash = directorContextHash(context);
  let candidate: z.infer<typeof CandidateSchema> | undefined;
  const tool = {
    name: 'submit_director_observation', label: 'Proponer observación dramática',
    description: 'Propone una interpretación con evidencia de eventos confirmados. No cambia acontecimientos, decisiones, metas, memoria ni etapa aceptada. Insuficiencia y rectificación son explícitas.',
    parameters: Type.Unsafe(z.toJSONSchema(DirectorObservationSchema, {io:'input'})),
    async execute(_toolCallId: string, raw: unknown, signal?: AbortSignal) {
      const requireActiveSignal = () => { if (signal?.aborted || input.signal?.aborted) throw new Error('Observación cancelada'); };
      requireActiveSignal();
      const observation = validateDirectorObservation({context,observation:raw});
      const eligibility = EligibilitySchema.parse(await input.checkEligibility());
      requireActiveSignal();
      if (eligibility.kind !== 'active') throw new Error('Contexto del Director inactivo');
      const payloadHash = createHash('sha256').update(canonicalDirectorValue(observation)).digest('hex');
      const existing = candidate !== undefined;
      if (candidate !== undefined && (candidate.payloadHash !== payloadHash || canonicalDirectorValue(candidate.observation) !== canonicalDirectorValue(observation))) throw new Error('Candidato del Director en conflicto');
      candidate ??= CandidateSchema.parse({kind:'local-director-candidate',candidateId:randomUUID(),contextHash,payloadHash,observation});
      return {content:[{type:'text' as const,text:'Interpretación candidata registrada localmente; requiere aceptación administrativa durable. No altera la representación.'}], details:{kind:'local-director-candidate',candidateId:candidate.candidateId,status:existing?'existing':'staged'}};
    },
  } satisfies PiCustomTool;
  return {tool,readCandidate:()=>candidate === undefined ? undefined : CandidateSchema.parse(candidate)};
}
