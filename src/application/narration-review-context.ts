import {
  NarrationReviewContextSchema,
  NarrationReviewDecisionSchema,
} from "../domain/narration-review.ts";
import {
  narrationValueHash,
  narratorContextHash,
  validateNarratorContext,
  validateNarrationProposal,
} from "./narrator-context.ts";
export function validateNarrationReviewContext(raw: unknown) {
  const context = NarrationReviewContextSchema.parse(raw);
  const narrator = validateNarratorContext(context.narratorContext);
  validateNarrationProposal({ context: narrator, proposal: context.proposal });
  const {
    jobId: childJob,
    generation: childGeneration,
    ...child
  } = context.scope;
  const {
    jobId: parentJob,
    generation: parentGeneration,
    ...parent
  } = context.parent.scope;
  void childGeneration;
  void parentGeneration;
  if (
    childJob === parentJob ||
    narrationValueHash(child) !== narrationValueHash(parent) ||
    narrationValueHash(context.parent.scope) !==
      narrationValueHash(narrator.scope)
  )
    throw new Error("NARRATION_REVIEW_SCOPE_MISMATCH");
  if (
    context.parent.contextHash !== narratorContextHash(narrator) ||
    context.parent.proposalHash !== narrationValueHash(context.proposal)
  )
    throw new Error("NARRATION_REVIEW_PARENT_HASH_MISMATCH");
  return context;
}
export function narrationReviewContextHash(raw: unknown) {
  return narrationValueHash(validateNarrationReviewContext(raw));
}
export function validateNarrationReviewDecision(input: {
  context: unknown;
  decision: unknown;
}) {
  const context = validateNarrationReviewContext(input.context);
  const decision = NarrationReviewDecisionSchema.parse(input.decision);
  if (decision.kind === "rejected") return decision;
  const proposal = context.proposal;
  for (const check of decision.checks) {
    if (
      proposal.text.slice(
        check.startOffset,
        check.startOffset + check.text.length,
      ) !== check.text
    )
      throw new Error("NARRATION_REVIEW_TEXT_MISMATCH");
    switch (check.source.kind) {
      case "world-snapshot":
        if (
          check.source.worldRevision !== proposal.sourceWorldRevision ||
          check.epistemicKind !== "physical-fact"
        )
          throw new Error("NARRATION_REVIEW_SOURCE_MISMATCH");
        break;
      case "confirmed-event": {
        const source = check.source;
        const event = context.narratorContext.confirmedEvents.find(
          (event) => event.id === source.eventId,
        );
        if (!proposal.sourceEventIds.includes(source.eventId) || !event)
          throw new Error("NARRATION_REVIEW_SOURCE_MISMATCH");
        const expected =
          event.kind === "humanIntervention" ||
          (event.kind === "communicated" && event.content.kind === "speech")
            ? "recorded-utterance"
            : "physical-fact";
        if (check.epistemicKind !== expected)
          throw new Error("NARRATION_REVIEW_EPISTEMIC_MISMATCH");
        break;
      }
      case "recorded-fact": {
        const source = check.source;
        const fact = context.narratorContext.recordedWorldFacts.find(
          (fact) => fact.factId === source.factId,
        );
        if (!fact || !proposal.sourceRecordedFactIds.includes(source.factId))
          throw new Error("NARRATION_REVIEW_SOURCE_MISMATCH");
        const expected =
          fact.kind === "identity-recorded"
            ? "recorded-identity"
            : fact.kind === "subjective-state-recorded"
              ? "recorded-subjectivity"
              : "explicit-unknown";
        if (check.epistemicKind !== expected)
          throw new Error("NARRATION_REVIEW_EPISTEMIC_MISMATCH");
        break;
      }
      default: {
        const exhaustive: never = check.source;
        return exhaustive;
      }
    }
  }
  // Every non-whitespace character must be covered by an exact reviewed span.
  const covered = new Uint8Array(proposal.text.length);
  for (const check of decision.checks)
    covered.fill(1, check.startOffset, check.startOffset + check.text.length);
  for (let i = 0; i < proposal.text.length; i++)
    if (!covered[i] && proposal.text[i]?.trim())
      throw new Error("NARRATION_REVIEW_INCOMPLETE");
  return decision;
}
