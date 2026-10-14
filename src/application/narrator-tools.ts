import { randomUUID } from "node:crypto";
import { Type } from "@earendil-works/pi-ai";
import { z } from "zod";
import type { PiCustomTool, RequestEligibility } from "../adapters/pi.ts";
import {
  NarrationProposalSchema,
  NarratorCandidateSchema,
} from "../domain/narration.ts";
import {
  narrationValueHash,
  narratorContextHash,
  validateNarratorContext,
  validateNarrationProposal,
} from "./narrator-context.ts";

export function createNarrationTool(input: {
  context: unknown;
  checkEligibility: () => RequestEligibility | Promise<RequestEligibility>;
  signal?: AbortSignal;
}) {
  const context = validateNarratorContext(input.context);
  const contextHash = narratorContextHash(context);
  let candidate: z.infer<typeof NarratorCandidateSchema> | undefined;
  const tool = {
    name: "submit_narration",
    label: "Proponer narración",
    description:
      "Propone texto público en español con fuentes del corte confirmado o abstención. No crea sucesos, acciones, percepciones, metas completadas ni memoria. No incluye deliberación privada.",
    parameters: Type.Unsafe(
      z.toJSONSchema(NarrationProposalSchema, { io: "input" }),
    ),
    async execute(_toolCallId: string, raw: unknown, signal?: AbortSignal) {
      if (signal?.aborted || input.signal?.aborted)
        throw new Error("NARRATOR_CANCELLED");
      const proposal = validateNarrationProposal({ context, proposal: raw });
      const eligibility = await input.checkEligibility();
      if (
        eligibility.kind !== "active" ||
        signal?.aborted ||
        input.signal?.aborted
      )
        throw new Error("NARRATOR_CONTEXT_INACTIVE");
      const proposalHash = narrationValueHash(proposal);
      if (candidate && candidate.proposalHash !== proposalHash)
        throw new Error("NARRATOR_CANDIDATE_CONFLICT");
      candidate ??= NarratorCandidateSchema.parse({
        kind: "narrator-candidate",
        candidateId: randomUUID(),
        contextHash,
        proposalHash,
        proposal,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: "Candidato administrativo registrado; requiere revisión exacta y publicación host. Nadie del reparto lo recibe.",
          },
        ],
        details: {
          kind: "narrator-candidate",
          candidateId: candidate.candidateId,
        },
      };
    },
  } satisfies PiCustomTool;
  return {
    tool,
    readCandidate: () =>
      candidate === undefined
        ? undefined
        : NarratorCandidateSchema.parse(candidate),
  };
}
