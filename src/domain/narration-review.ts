import { z } from "zod";
import { AdministrativeRunScopeSchema } from "./admin-roles.ts";
import {
  NarratorContextSchema,
  NarrationProposalSchema,
  NarrationReviewSchema,
} from "./narration.ts";
import { HashSchema, EventIdSchema, RevisionSchema } from "./values.ts";
const reason = z.string().trim().min(1).max(2000);
export const NarrationReviewContextSchema = z.strictObject({
  kind: z.literal("narration-review-context"),
  schemaVersion: z.literal(1),
  role: z.literal("narration-reviewer"),
  scope: AdministrativeRunScopeSchema,
  parent: z.strictObject({
    scope: AdministrativeRunScopeSchema,
    contextHash: HashSchema,
    proposalHash: HashSchema,
  }),
  narratorContext: NarratorContextSchema,
  proposal: NarrationProposalSchema.options[0],
});
export const NarrationReviewDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("accepted"),
    confirmedSourcesOnly: z.literal(true),
    privateReasoningExcluded: z.literal(true),
    uncertaintyExplicit: z.literal(true),
    reason,
    checks: z
      .array(
        z.strictObject({
          startOffset: z.number().int().nonnegative().max(16384),
          text: z.string().min(1).max(16384),
          source: z.discriminatedUnion("kind", [
            z.strictObject({
              kind: z.literal("world-snapshot"),
              worldRevision: RevisionSchema,
            }),
            z.strictObject({
              kind: z.literal("confirmed-event"),
              eventId: EventIdSchema,
            }),
            z.strictObject({
              kind: z.literal("recorded-fact"),
              factId: z.string().min(1).max(200),
            }),
          ]),
          epistemicKind: z.enum([
            "physical-fact",
            "recorded-utterance",
            "recorded-identity",
            "recorded-subjectivity",
            "explicit-unknown",
          ]),
          reason,
        }),
      )
      .min(1)
      .max(1000),
  }),
  z.strictObject({
    kind: z.literal("rejected"),
    safeCode: NarrationReviewSchema.options[1].shape.safeCode,
    reason,
  }),
]);
export const NarrationReviewCandidateSchema = z.strictObject({
  kind: z.literal("narration-review-candidate"),
  candidateId: z.string().uuid(),
  contextHash: HashSchema,
  decisionHash: HashSchema,
  decision: NarrationReviewDecisionSchema,
});
export type NarrationReviewContext = z.infer<
  typeof NarrationReviewContextSchema
>;
export type NarrationReviewDecision = z.infer<
  typeof NarrationReviewDecisionSchema
>;
export type NarrationReviewCandidate = z.infer<
  typeof NarrationReviewCandidateSchema
>;
