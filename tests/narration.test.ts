import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import {
  NarratorContextSchema,
  NarrationProposalSchema,
} from "../src/domain/narration.ts";
import {
  validateNarratorContext,
  validateNarrationProposal,
  validateNarrationReview,
  narratorContextHash,
  narrationValueHash,
  projectNarratorPhysicalSnapshot,
  projectNarratorRecordedWorldFacts,
} from "../src/application/narrator-context.ts";
import { createNarrationTool } from "../src/application/narrator-tools.ts";
import { validateRunConfiguration } from "../src/application/production-preflight.ts";
import { DEFAULT_INFERENCE_PROFILE } from "../src/domain/inference-profile.ts";
import { draftFixture } from "./fixtures/continuista.ts";

function fixture() {
  const ready = validateRunConfiguration({ draft: draftFixture() });
  assert.equal(ready.kind, "ready");
  if (ready.kind !== "ready") throw new Error("invalid synthetic ready");
  const snapshot = ready.configuration.worldSnapshot;
  const context = NarratorContextSchema.parse({
    kind: "narrator-context",
    schemaVersion: 1,
    role: "narrator",
    scope: {
      runId: snapshot.runId,
      pulseId: randomUUID(),
      jobId: randomUUID(),
      generation: 0,
      lifecycleRevision: 0,
      configurationRevision: ready.configuration.configRevision,
      worldRevision: snapshot.revision,
      throughWorldSeq: snapshot.seq,
      fictitiousAt: snapshot.clock.instant,
      profile: DEFAULT_INFERENCE_PROFILE,
    },
    authorization: { kind: "omniscient-confirmed-world" },
    language: "es",
    snapshot: projectNarratorPhysicalSnapshot(snapshot),
    confirmedEvents: [],
    previousNarrations: [],
  });
  const proposal = NarrationProposalSchema.parse({
    kind: "narrate",
    text: "El personaje está en la escena preparada.",
    sourceEventIds: [],
    sourceWorldRevision: snapshot.revision,
    uncertainty: { kind: "none" },
  });
  return { context, proposal };
}

test("Narrator context excludes private reasoning, actor knowledge and credentials; exact world cut required", () => {
  const { context } = fixture();
  assert.deepEqual(validateNarratorContext(context), context);
  for (const extra of [
    { thinking: "private" },
    { actorId: "max" },
    { memories: [] },
    { providerKey: "secret" },
    { proposals: [] },
  ])
    assert.equal(
      NarratorContextSchema.safeParse({ ...context, ...extra }).success,
      false,
    );
  assert.throws(
    () =>
      validateNarratorContext({
        ...context,
        scope: {
          ...context.scope,
          worldRevision: context.scope.worldRevision + 1,
        },
      }),
    /WORLD_CUT/,
  );
  assert.throws(
    () =>
      validateNarratorContext({
        ...context,
        scope: {
          ...context.scope,
          fictitiousAt: context.scope.fictitiousAt + 1,
        },
      }),
    /WORLD_CUT/,
  );
});
test("Narration cites confirmed world revision, rejects missing event evidence and visibly marks uncertainty", () => {
  const { context, proposal } = fixture();
  assert.deepEqual(validateNarrationProposal({ context, proposal }), proposal);
  assert.throws(
    () =>
      validateNarrationProposal({
        context,
        proposal: { ...proposal, sourceEventIds: [randomUUID()] },
      }),
    /UNCONFIRMED_SOURCE/,
  );
  assert.throws(
    () =>
      validateNarrationProposal({
        context,
        proposal: {
          ...proposal,
          sourceWorldRevision: context.scope.worldRevision + 1,
        },
      }),
    /WORLD_SOURCE/,
  );
  assert.throws(
    () =>
      validateNarrationProposal({
        context,
        proposal: {
          ...proposal,
          uncertainty: { kind: "explicit", markers: ["Quizá"] },
        },
      }),
    /UNCERTAINTY/,
  );
  assert.equal(
    validateNarrationProposal({
      context,
      proposal: {
        ...proposal,
        text: "Quizá el silencio tenga otro sentido.",
        uncertainty: { kind: "explicit", markers: ["Quizá"] },
      },
    }).kind,
    "narrate",
  );
});
test("Independent review is bound to exact context, candidate and text; no approval accepts changed words", () => {
  const { context, proposal } = fixture();
  assert.equal(proposal.kind, "narrate");
  if (proposal.kind !== "narrate") throw new Error("invalid fixture");
  const review = {
    kind: "accepted",
    contextHash: narratorContextHash(context),
    proposalHash: narrationValueHash(proposal),
    reviewedTextHash: createHash("sha256").update(proposal.text).digest("hex"),
    confirmedSourcesOnly: true,
    privateReasoningExcluded: true,
    uncertaintyExplicit: true,
    reviewEvidenceId: randomUUID(),
  };
  assert.equal(
    validateNarrationReview({ context, proposal, review }).kind,
    "accepted",
  );
  assert.throws(
    () =>
      validateNarrationReview({
        context,
        proposal: { ...proposal, text: "Otros hechos" },
        review,
      }),
    /EXACT_TEXT/,
  );
  assert.throws(
    () =>
      validateNarrationReview({
        context,
        proposal,
        review: { ...review, reviewedTextHash: "a".repeat(64) },
      }),
    /EXACT_TEXT/,
  );
});
test("Narrator tool stages one immutable candidate, no world changes; cancel/epoch change rejects before staging", async () => {
  const { context, proposal } = fixture();
  const before = JSON.stringify(context.snapshot);
  const tool = createNarrationTool({
    context,
    checkEligibility: () => ({ kind: "active" }),
  });
  await tool.tool.execute("n1", proposal);
  const first = tool.readCandidate();
  assert.ok(first);
  await tool.tool.execute("n2", proposal);
  assert.equal(tool.readCandidate()?.candidateId, first.candidateId);
  if (first.proposal.kind === "narrate")
    first.proposal.text = "mutated outside";
  assert.notDeepEqual(tool.readCandidate(), first);
  await assert.rejects(
    tool.tool.execute("n3", {
      kind: "abstain",
      reason: "No evidencia",
      sourceEventIds: [],
    }),
  );
  assert.equal(JSON.stringify(context.snapshot), before);
  const aborted = new AbortController();
  const cancel = createNarrationTool({
    context,
    signal: aborted.signal,
    checkEligibility: () => {
      aborted.abort();
      return { kind: "active" };
    },
  });
  await assert.rejects(cancel.tool.execute("n4", proposal));
  assert.equal(cancel.readCandidate(), undefined);
  const inactive = createNarrationTool({
    context,
    checkEligibility: () => ({ kind: "inactive", reason: "epoch-stale" }),
  });
  await assert.rejects(inactive.tool.execute("n5", proposal));
  assert.equal(inactive.readCandidate(), undefined);
});
test("Abstention is typed and never invents text, event or completed goals", async () => {
  const { context } = fixture();
  const tool = createNarrationTool({
    context,
    checkEligibility: () => ({ kind: "active" }),
  });
  await tool.tool.execute("skip", {
    kind: "abstain",
    reason: "No corresponde narrar este corte.",
    sourceEventIds: [],
  });
  assert.equal(tool.readCandidate()?.proposal.kind, "abstain");
  assert.equal(
    NarrationProposalSchema.safeParse({
      kind: "abstain",
      reason: "No hechos",
      sourceEventIds: [],
      text: "Una llegada inventada",
      completedGoals: ["misión"],
    }).success,
    false,
  );
});

test("Physical narrator snapshot contains no subjective memory, goals, beliefs or inventory knowledge", () => {
  const ready = validateRunConfiguration({ draft: draftFixture() });
  assert.equal(ready.kind, "ready");
  if (ready.kind !== "ready") throw new Error("synthetic ready missing");
  const physical = projectNarratorPhysicalSnapshot(
    ready.configuration.worldSnapshot,
  );
  for (const entity of physical.entities)
    if (entity.kind === "character") {
      assert.equal("mind" in entity, false);
      assert.equal("preparation" in entity, false);
    }
  const { context } = fixture();
  const full = ready.configuration.worldSnapshot;
  assert.equal(
    NarratorContextSchema.safeParse({
      ...context,
      snapshot: { ...context.snapshot, entities: full.entities },
    }).success,
    false,
  );
});

test("Omniscient recorded interiority is labelled subjectivity with exact source cut, distinct from physical truth", () => {
  const ready = validateRunConfiguration({ draft: draftFixture() });
  assert.equal(ready.kind, "ready");
  if (ready.kind !== "ready") throw new Error("synthetic ready missing");
  const world = ready.configuration.worldSnapshot;
  const syntheticWorld = {
    ...world,
    entities: world.entities.map((entity) =>
      entity.kind === "character"
        ? {
            ...entity,
            mind: {
              ...entity.mind,
              goals: [
                {
                  kind: "durable",
                  id: randomUUID(),
                  description: "Desea comprender la situación de prueba.",
                  priority: 0.7,
                  state: "active",
                  revision: 0,
                  history: [],
                },
              ],
            },
          }
        : entity,
    ),
  };
  const facts = projectNarratorRecordedWorldFacts(syntheticWorld);
  const { context, proposal } = fixture();
  const authorized = validateNarratorContext({
    ...context,
    recordedWorldFacts: facts,
  });
  const subjective = facts.find(
    (fact) => fact.kind === "subjective-state-recorded",
  );
  assert.ok(subjective);
  assert.equal(
    subjective.epistemicStatus,
    "recorded-subjectivity-not-world-truth",
  );
  const narrated = validateNarrationProposal({
    context: authorized,
    proposal: { ...proposal, sourceRecordedFactIds: [subjective.factId] },
  });
  assert.equal(narrated.kind, "narrate");
  assert.throws(
    () =>
      validateNarrationProposal({
        context: authorized,
        proposal: {
          ...proposal,
          sourceRecordedFactIds: ["invented-mind-source"],
        },
      }),
    /UNCONFIRMED_RECORDED/,
  );
  assert.throws(
    () =>
      validateNarratorContext({
        ...authorized,
        recordedWorldFacts: facts.map((fact) =>
          fact.factId === subjective.factId
            ? { ...fact, sourceHash: "a".repeat(64) }
            : fact,
        ),
      }),
    /HASH_MISMATCH/,
  );
  assert.throws(
    () =>
      validateNarratorContext({
        ...authorized,
        recordedWorldFacts: facts.map((fact) => ({
          ...fact,
          sourceWorldRevision: fact.sourceWorldRevision + 1,
        })),
      }),
    /OUTSIDE_CUT/,
  );
  assert.equal(JSON.stringify(authorized.snapshot).includes("goals"), false);
});
