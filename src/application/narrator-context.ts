import { createHash } from "node:crypto";
import {
  NarratorContextSchema,
  NarrationProposalSchema,
  NarrationReviewSchema,
  NarratorPhysicalSnapshotSchema,
  NarratorRecordedWorldFactSchema,
} from "../domain/narration.ts";
import { WorldSnapshotSchema } from "../domain/world-schema.ts";
import { canonicalDirectorValue } from "./director-context.ts";

export function validateNarratorContext(raw: unknown) {
  const context = NarratorContextSchema.parse(raw);
  const scope = context.scope;
  if (
    context.snapshot.runId !== scope.runId ||
    context.snapshot.revision !== scope.worldRevision ||
    context.snapshot.seq !== scope.throughWorldSeq ||
    context.snapshot.clock.instant !== scope.fictitiousAt
  )
    throw new Error("NARRATOR_WORLD_CUT_MISMATCH");
  const eventIds = new Set<string>();
  let seq = -1;
  for (const event of context.confirmedEvents) {
    if (
      event.runId !== scope.runId ||
      event.seq > scope.throughWorldSeq ||
      event.fictitiousAt > scope.fictitiousAt ||
      event.seq <= seq ||
      eventIds.has(event.id)
    )
      throw new Error("NARRATOR_EVENT_OUTSIDE_CUT");
    eventIds.add(event.id);
    seq = event.seq;
  }
  const publications = new Set<string>();
  for (const previous of context.previousNarrations) {
    if (
      previous.scope.runId !== scope.runId ||
      previous.scope.throughWorldSeq > scope.throughWorldSeq ||
      previous.scope.fictitiousAt > scope.fictitiousAt ||
      publications.has(previous.publicationId)
    )
      throw new Error("NARRATOR_HISTORY_OUTSIDE_CUT");
    publications.add(previous.publicationId);
  }
  const factIds = new Set<string>();
  const actors = new Set(
    context.snapshot.entities
      .filter((entity) => entity.kind === "character")
      .map((entity) => entity.characterId),
  );
  for (const fact of context.recordedWorldFacts) {
    if (
      fact.sourceWorldRevision !== scope.worldRevision ||
      !actors.has(fact.characterId) ||
      factIds.has(fact.factId)
    )
      throw new Error("NARRATOR_RECORDED_FACT_OUTSIDE_CUT");
    factIds.add(fact.factId);
    const content =
      fact.kind === "identity-recorded"
        ? {
            characterId: fact.characterId,
            worldRevision: fact.sourceWorldRevision,
            trueDisplayName: fact.trueDisplayName,
            species: fact.species,
          }
        : fact.kind === "subjective-state-recorded"
          ? {
              characterId: fact.characterId,
              worldRevision: fact.sourceWorldRevision,
              mind: fact.mind,
            }
          : {
              characterId: fact.characterId,
              worldRevision: fact.sourceWorldRevision,
              reason: fact.reason,
            };
    if (narrationValueHash(content) !== fact.sourceHash)
      throw new Error("NARRATOR_RECORDED_FACT_HASH_MISMATCH");
    if (fact.kind === "subjective-state-recorded")
      for (const experience of fact.mind.experiences)
        if (
          experience.runId !== scope.runId ||
          experience.actorId !== fact.characterId ||
          experience.worldSeq > scope.throughWorldSeq ||
          experience.fictitiousAt > scope.fictitiousAt ||
          experience.receivedAt > scope.fictitiousAt
        )
          throw new Error("NARRATOR_RECORDED_EXPERIENCE_OUTSIDE_CUT");
  }
  return context;
}
export function validateNarrationProposal(input: {
  context: unknown;
  proposal: unknown;
}) {
  const context = validateNarratorContext(input.context);
  const proposal = NarrationProposalSchema.parse(input.proposal);
  const sources = new Set(context.confirmedEvents.map((event) => event.id));
  if (proposal.sourceEventIds.some((id) => !sources.has(id)))
    throw new Error("NARRATOR_UNCONFIRMED_SOURCE");
  if (proposal.kind === "narrate") {
    const recordedFactIds = new Set(
      context.recordedWorldFacts.map((fact) => fact.factId),
    );
    if (proposal.sourceRecordedFactIds.some((id) => !recordedFactIds.has(id)))
      throw new Error("NARRATOR_UNCONFIRMED_RECORDED_SOURCE");
    if (proposal.sourceWorldRevision !== context.scope.worldRevision)
      throw new Error("NARRATOR_WORLD_SOURCE_MISMATCH");
    if (
      proposal.uncertainty.kind === "explicit" &&
      proposal.uncertainty.markers.some(
        (marker) => !proposal.text.includes(marker),
      )
    )
      throw new Error("NARRATOR_UNCERTAINTY_NOT_VISIBLE");
  }
  return proposal;
}
export function narrationValueHash(value: unknown) {
  return createHash("sha256")
    .update(canonicalDirectorValue(value))
    .digest("hex");
}
export function narratorContextHash(raw: unknown) {
  return narrationValueHash(validateNarratorContext(raw));
}
export function validateNarrationReview(input: {
  context: unknown;
  proposal: unknown;
  review: unknown;
}) {
  const context = validateNarratorContext(input.context);
  const proposal = validateNarrationProposal({
    context,
    proposal: input.proposal,
  });
  const review = NarrationReviewSchema.parse(input.review);
  if (
    review.contextHash !== narratorContextHash(context) ||
    review.proposalHash !== narrationValueHash(proposal) ||
    (review.kind === "accepted" &&
      (proposal.kind !== "narrate" ||
        review.reviewedTextHash !==
          createHash("sha256").update(proposal.text).digest("hex")))
  )
    throw new Error("NARRATOR_REVIEW_EXACT_TEXT_MISMATCH");
  return review;
}

export function projectNarratorPhysicalSnapshot(raw: unknown) {
  const world = WorldSnapshotSchema.parse(raw);
  return NarratorPhysicalSnapshotSchema.parse({
    ...world,
    entities: world.entities.map((entity) =>
      entity.kind === "character"
        ? {
            kind: entity.kind,
            entityId: entity.entityId,
            characterId: entity.characterId,
            presentation: entity.presentation,
            species: entity.species,
            placeId: entity.placeId,
            position: entity.position,
            presence: entity.presence,
            availability: entity.availability,
          }
        : entity,
    ),
  });
}

/** Omniscience over confirmed fictional facts is distinct from access to model deliberation. */
export function projectNarratorRecordedWorldFacts(raw: unknown) {
  const world = WorldSnapshotSchema.parse(raw);
  return world.entities.flatMap((entity) => {
    if (entity.kind !== "character") return [];
    const identity = {
      characterId: entity.characterId,
      worldRevision: world.revision,
      trueDisplayName: entity.trueDisplayName,
      species: entity.species,
    };
    const identityFact = NarratorRecordedWorldFactSchema.parse({
      kind: "identity-recorded",
      factId: `${entity.characterId}:identity:${world.revision}`,
      characterId: entity.characterId,
      sourceWorldRevision: world.revision,
      sourceHash: narrationValueHash(identity),
      epistemicStatus: "recorded-canonical-identity",
      trueDisplayName: entity.trueDisplayName,
      species: entity.species,
    });
    const mind = entity.mind;
    const known = Object.values(mind).some(
      (value) => Array.isArray(value) && value.length > 0,
    );
    const subjective = known
      ? NarratorRecordedWorldFactSchema.parse({
          kind: "subjective-state-recorded",
          factId: `${entity.characterId}:mind:${world.revision}`,
          characterId: entity.characterId,
          sourceWorldRevision: world.revision,
          sourceHash: narrationValueHash({
            characterId: entity.characterId,
            worldRevision: world.revision,
            mind,
          }),
          epistemicStatus: "recorded-subjectivity-not-world-truth",
          mind,
        })
      : NarratorRecordedWorldFactSchema.parse({
          kind: "unknown-recorded-interiority",
          factId: `${entity.characterId}:mind:${world.revision}`,
          characterId: entity.characterId,
          sourceWorldRevision: world.revision,
          sourceHash: narrationValueHash({
            characterId: entity.characterId,
            worldRevision: world.revision,
            reason: "no-recorded-subjective-state",
          }),
          epistemicStatus: "unknown",
          reason: "no-recorded-subjective-state",
        });
    return [identityFact, subjective];
  });
}
