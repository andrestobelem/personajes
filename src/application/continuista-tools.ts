import { createHash, randomUUID } from 'node:crypto';
import { Type } from '@earendil-works/pi-ai';
import { z } from 'zod';
import type { PiCustomTool, RequestEligibility } from '../adapters/pi.ts';
import { HashSchema } from '../domain/values.ts';
import {
  ContinuistaReviewResponseSchema, validateContinuistaContextReview, validateContinuistaReviewContext,
} from './continuista-review-context.ts';

const PublishedParameters = Type.Unsafe(z.toJSONSchema(ContinuistaReviewResponseSchema, { io: 'input' }));
const EligibilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('active') }),
  z.strictObject({ kind: z.literal('inactive'), reason: z.string().min(1).max(120) }),
]);
const CandidateSchema = z.strictObject({
  kind: z.literal('local-continuista-candidate'), candidateId: z.string().uuid(), payloadHash: HashSchema,
  response: ContinuistaReviewResponseSchema,
});
export type LocalContinuistaCandidate = z.infer<typeof CandidateSchema>;

/**
 * Stages one immutable local candidate. It grants no publication/commit authority.
 * The admin wrapper must separately persist/accept a successful terminal before using it.
 */
export function createContinuistaReviewTool(input: {
  context: unknown;
  checkEligibility: () => RequestEligibility | Promise<RequestEligibility>;
  signal?: AbortSignal;
}): { tool: PiCustomTool; readCandidate: () => LocalContinuistaCandidate | undefined } {
  // Parse clones the host envelope, so changing the caller's original cannot change authorization.
  const context = validateContinuistaReviewContext(input.context);
  let candidate: LocalContinuistaCandidate | undefined;
  const tool = {
    name: 'submit_continuista_review',
    label: 'Entregar revisión del Continuista',
    description: 'Entrega una sola revisión candidata del contexto exacto autorizado. Puede ser incompleta como diagnóstico. Su registro local no aprueba, publica ni aplica acciones: el host debe confirmar el terminal administrativo durable y verificar el contexto antes de usarla.',
    parameters: PublishedParameters,
    async execute(_toolCallId: string, rawParameters: unknown, signal?: AbortSignal) {
      function requireNotAborted(): void {
        if (input.signal?.aborted || signal?.aborted) throw new Error('La revisión del Continuista fue cancelada');
      }
      requireNotAborted();
      const response = validateContinuistaContextReview({ context, response: rawParameters, allowIncomplete: true });
      const eligibility = EligibilitySchema.parse(await input.checkEligibility());
      requireNotAborted();
      if (eligibility.kind !== 'active') throw new Error('El contexto del Continuista está inactivo');
      const payloadHash = HashSchema.parse(createHash('sha256').update(canonical(response)).digest('hex'));
      let status: 'staged' | 'existing';
      if (candidate === undefined) {
        candidate = CandidateSchema.parse({ kind: 'local-continuista-candidate', candidateId: randomUUID(), payloadHash, response });
        status = 'staged';
      } else {
        if (candidate.payloadHash !== payloadHash || canonical(candidate.response) !== canonical(response)) throw new Error('La revisión candidata ya tiene otro payload');
        status = 'existing';
      }
      return {
        content: [{ type: 'text' as const, text: 'Revisión candidata registrada localmente. Todavía requiere un terminal administrativo durable; no autoriza publicación ni efectos.' }],
        details: { kind: 'local-continuista-candidate' as const, status, candidateId: candidate.candidateId, complete: candidate.response.review.complete },
      };
    },
  } satisfies PiCustomTool;
  return {
    tool,
    /** Returns a detached candidate; reading it is not acceptance or proof of current eligibility. */
    readCandidate() { return candidate === undefined ? undefined : CandidateSchema.parse(candidate); },
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('Candidato no serializable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = z.record(z.string(), z.unknown()).parse(value);
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}
