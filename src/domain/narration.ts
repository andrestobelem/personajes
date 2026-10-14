import { z } from "zod";
import { AdministrativeRunScopeSchema } from "./admin-roles.ts";
import {
  HashSchema,
  EventIdSchema,
  RevisionSchema,
  CharacterIdSchema,
} from "./values.ts";
import {
  WorldEventSchema,
  WorldSnapshotSchema,
  WorldCharacterSchema,
  WorldObjectSchema,
  WorldDeviceSchema,
  ActorMindSchema,
} from "./world-schema.ts";

export const NarrationPublicationIdSchema = z
  .string()
  .uuid()
  .brand<"NarrationPublicationId">();
const references = z
  .array(EventIdSchema)
  .max(1000)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Duplicate narration source",
  );
const text = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes("\0") &&
      new TextEncoder().encode(value).byteLength <= 16384,
  );
export const NarrationProposalSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("narrate"),
    text,
    sourceEventIds: references,
    sourceWorldRevision: RevisionSchema,
    sourceRecordedFactIds: z
      .array(z.string().min(1).max(200))
      .max(1000)
      .default([]),
    uncertainty: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("none") }),
      z.strictObject({
        kind: z.literal("explicit"),
        markers: z.array(z.string().min(1).max(120)).min(1).max(20),
      }),
    ]),
  }),
  z.strictObject({
    kind: z.literal("abstain"),
    reason: z.string().min(1).max(4000),
    sourceEventIds: references,
  }),
]);
export const NarrationReviewSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("accepted"),
    contextHash: HashSchema,
    proposalHash: HashSchema,
    reviewedTextHash: HashSchema,
    confirmedSourcesOnly: z.literal(true),
    privateReasoningExcluded: z.literal(true),
    uncertaintyExplicit: z.literal(true),
    reviewEvidenceId: z.string().uuid(),
  }),
  z.strictObject({
    kind: z.literal("rejected"),
    contextHash: HashSchema,
    proposalHash: HashSchema,
    safeCode: z.enum([
      "unsupported-fact",
      "private-reasoning",
      "uncertainty-missing",
      "source-mismatch",
      "review-incomplete",
    ]),
  }),
]);
export const NarrationPublicationSchema = z.strictObject({
  kind: z.literal("narration-publication"),
  publicationId: NarrationPublicationIdSchema,
  scope: AdministrativeRunScopeSchema,
  contextHash: HashSchema,
  proposalHash: HashSchema,
  text,
  textHash: HashSchema,
  sourceEventIds: references,
  sourceWorldRevision: RevisionSchema,
  sourceRecordedFactIds: z
    .array(z.string().min(1).max(200))
    .max(1000)
    .default([]),
  uncertainty: NarrationProposalSchema.options[0].shape.uncertainty,
  review: NarrationReviewSchema.options[0],
  publishedAt: RevisionSchema,
});
/** Physical confirmed state excludes subjective memory, beliefs, goals and private model sessions. */
export const NarratorPhysicalCharacterSchema = z
  .strictObject(WorldCharacterSchema.shape)
  .pick({
    kind: true,
    entityId: true,
    characterId: true,
    presentation: true,
    species: true,
    placeId: true,
    position: true,
    presence: true,
    availability: true,
  });
export const NarratorPhysicalSnapshotSchema = z.strictObject({
  ...WorldSnapshotSchema.shape,
  entities: z
    .array(
      z.discriminatedUnion("kind", [
        NarratorPhysicalCharacterSchema,
        WorldObjectSchema,
        WorldDeviceSchema,
      ]),
    )
    .max(100000),
});
const recordedSourceFields = {
  factId: z.string().min(1).max(200),
  characterId: CharacterIdSchema,
  sourceWorldRevision: RevisionSchema,
  sourceHash: HashSchema,
};
export const NarratorRecordedWorldFactSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...recordedSourceFields,
    kind: z.literal("identity-recorded"),
    epistemicStatus: z.literal("recorded-canonical-identity"),
    trueDisplayName: z.string().min(1).max(200),
    species: z.enum(["human", "animal", "robot"]),
  }),
  z.strictObject({
    ...recordedSourceFields,
    kind: z.literal("subjective-state-recorded"),
    epistemicStatus: z.literal("recorded-subjectivity-not-world-truth"),
    mind: ActorMindSchema,
  }),
  z.strictObject({
    ...recordedSourceFields,
    kind: z.literal("unknown-recorded-interiority"),
    epistemicStatus: z.literal("unknown"),
    reason: z.literal("no-recorded-subjective-state"),
  }),
]);
export const NarratorContextSchema = z.strictObject({
  kind: z.literal("narrator-context"),
  schemaVersion: z.literal(1),
  role: z.literal("narrator"),
  scope: AdministrativeRunScopeSchema,
  authorization: z.strictObject({
    kind: z.literal("omniscient-confirmed-world"),
  }),
  language: z.literal("es"),
  snapshot: NarratorPhysicalSnapshotSchema,
  recordedWorldFacts: z
    .array(NarratorRecordedWorldFactSchema)
    .max(10000)
    .default([]),
  confirmedEvents: z.array(WorldEventSchema).max(10000),
  previousNarrations: z.array(NarrationPublicationSchema).max(1000),
});
export const NarratorCandidateSchema = z.strictObject({
  kind: z.literal("narrator-candidate"),
  candidateId: z.string().uuid(),
  contextHash: HashSchema,
  proposalHash: HashSchema,
  proposal: NarrationProposalSchema,
});
export type NarratorContext = z.infer<typeof NarratorContextSchema>;
export type NarrationProposal = z.infer<typeof NarrationProposalSchema>;
export type NarrationReview = z.infer<typeof NarrationReviewSchema>;
export type NarrationPublication = z.infer<typeof NarrationPublicationSchema>;
