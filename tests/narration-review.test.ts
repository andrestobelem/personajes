import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { validateRunConfiguration } from "../src/application/production-preflight.ts";
import { draftFixture } from "./fixtures/continuista.ts";
import { DEFAULT_INFERENCE_PROFILE } from "../src/domain/inference-profile.ts";
import {
  NarratorContextSchema,
  NarrationProposalSchema,
} from "../src/domain/narration.ts";
import {
  projectNarratorPhysicalSnapshot,
  projectNarratorRecordedWorldFacts,
  narratorContextHash,
  narrationValueHash,
} from "../src/application/narrator-context.ts";
import {
  validateNarrationReviewContext,
  validateNarrationReviewDecision,
} from "../src/application/narration-review-context.ts";
import { createNarrationReviewTool } from "../src/application/narration-review-tools.ts";
function fixture() {
  const ready = validateRunConfiguration({ draft: draftFixture() });
  if (ready.kind !== "ready") throw new Error("fixture");
  const snapshot = ready.configuration.worldSnapshot;
  const narratorContext = NarratorContextSchema.parse({
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
  const proposal = NarrationProposalSchema.options[0].parse({
    kind: "narrate",
    text: "El personaje está en la escena preparada.",
    sourceEventIds: [],
    sourceWorldRevision: snapshot.revision,
    uncertainty: { kind: "none" },
  });
  const context = {
    kind: "narration-review-context",
    schemaVersion: 1,
    role: "narration-reviewer",
    scope: { ...narratorContext.scope, jobId: randomUUID() },
    parent: {
      scope: narratorContext.scope,
      contextHash: narratorContextHash(narratorContext),
      proposalHash: narrationValueHash(proposal),
    },
    narratorContext,
    proposal,
  };
  const decision = {
    kind: "accepted",
    confirmedSourcesOnly: true,
    privateReasoningExcluded: true,
    uncertaintyExplicit: true,
    reason: "Texto cotejado con estado físico confirmado.",
    checks: [
      {
        startOffset: 0,
        text: proposal.text,
        source: { kind: "world-snapshot", worldRevision: snapshot.revision },
        epistemicKind: "physical-fact",
        reason: "Ubicación registrada.",
      },
    ],
  };
  return { context, decision };
}
test("review context requires independent job, identical cut and exact parent hashes", () => {
  const { context } = fixture();
  assert.ok(validateNarrationReviewContext(context));
  assert.throws(
    () =>
      validateNarrationReviewContext({
        ...context,
        scope: context.parent.scope,
      }),
    /SCOPE_MISMATCH/,
  );
  assert.throws(
    () =>
      validateNarrationReviewContext({
        ...context,
        parent: { ...context.parent, proposalHash: "0".repeat(64) },
      }),
    /HASH_MISMATCH/,
  );
  assert.ok(
    validateNarrationReviewContext({
      ...context,
      scope: { ...context.scope, generation: 1 },
    }),
  );
});
test("review checks must cover exact text and valid cited source; authority fields cannot be supplied", () => {
  const { context, decision } = fixture();
  assert.equal(
    validateNarrationReviewDecision({ context, decision }).kind,
    "accepted",
  );
  assert.throws(
    () =>
      validateNarrationReviewDecision({
        context,
        decision: {
          ...decision,
          checks: [{ ...decision.checks[0], text: "El personaje" }],
        },
      }),
    /INCOMPLETE/,
  );
  assert.throws(() =>
    validateNarrationReviewDecision({
      context,
      decision: { ...decision, reviewEvidenceId: randomUUID() },
    }),
  );
  assert.throws(
    () =>
      validateNarrationReviewDecision({
        context,
        decision: {
          ...decision,
          checks: [
            {
              ...decision.checks[0],
              source: { kind: "confirmed-event", eventId: randomUUID() },
            },
          ],
        },
      }),
    /SOURCE_MISMATCH/,
  );
  assert.throws(
    () =>
      validateNarrationReviewDecision({
        context,
        decision: {
          ...decision,
          checks: [
            { ...decision.checks[0], epistemicKind: "recorded-subjectivity" },
          ],
        },
      }),
    /SOURCE_MISMATCH/,
  );
});
test("review tool stages only one candidate and never publishes; rejects inactive execution", async () => {
  const { context, decision } = fixture();
  const staged = createNarrationReviewTool({
    context,
    checkEligibility: () => ({ kind: "active" }),
  });
  await staged.tool.execute("call", decision);
  const candidate = staged.readCandidate();
  assert.ok(candidate);
  await staged.tool.execute("again", decision);
  assert.equal(staged.readCandidate()?.candidateId, candidate.candidateId);
  await assert.rejects(
    staged.tool.execute("conflict", {
      kind: "rejected",
      safeCode: "unsupported-fact",
      reason: "No hay evidencia.",
    }),
    /CONFLICT/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    createNarrationReviewTool({
      context,
      checkEligibility: () => ({ kind: "active" }),
      signal: controller.signal,
    }).tool.execute("cancel", decision),
    /CANCELLED/,
  );
});

test("recorded interiority cannot be treated as physical truth", () => {
  const ready = validateRunConfiguration({ draft: draftFixture() });
  if (ready.kind !== "ready") throw new Error("fixture");
  const { context, decision } = fixture();
  const facts = projectNarratorRecordedWorldFacts(
    ready.configuration.worldSnapshot,
  );
  const fact = facts.find((f) => f.kind !== "identity-recorded");
  assert.ok(fact);
  const narratorContext = {
    ...context.narratorContext,
    recordedWorldFacts: facts,
  };
  const proposal = {
    ...context.proposal,
    sourceRecordedFactIds: [fact.factId],
  };
  const changed = {
    ...context,
    narratorContext,
    proposal,
    parent: {
      ...context.parent,
      contextHash: narratorContextHash(narratorContext),
      proposalHash: narrationValueHash(proposal),
    },
  };
  const check = {
    ...decision.checks[0],
    source: { kind: "recorded-fact", factId: fact.factId },
    epistemicKind: "physical-fact",
  };
  assert.throws(
    () =>
      validateNarrationReviewDecision({
        context: changed,
        decision: { ...decision, checks: [check] },
      }),
    /EPISTEMIC_MISMATCH/,
  );
  assert.equal(
    validateNarrationReviewDecision({
      context: changed,
      decision: {
        ...decision,
        checks: [
          {
            ...check,
            epistemicKind:
              fact.kind === "subjective-state-recorded"
                ? "recorded-subjectivity"
                : "explicit-unknown",
          },
        ],
      },
    }).kind,
    "accepted",
  );
});

test("repeated exact words require explicit span offsets and cannot silently cover another occurrence", () => {
  const { context, decision } = fixture();
  const proposal = { ...context.proposal, text: "X X" };
  const changed = {
    ...context,
    proposal,
    parent: { ...context.parent, proposalHash: narrationValueHash(proposal) },
  };
  const first = { ...decision.checks[0], text: "X", startOffset: 0 };
  assert.throws(
    () =>
      validateNarrationReviewDecision({
        context: changed,
        decision: { ...decision, checks: [first] },
      }),
    /INCOMPLETE/,
  );
  assert.equal(
    validateNarrationReviewDecision({
      context: changed,
      decision: { ...decision, checks: [first, { ...first, startOffset: 2 }] },
    }).kind,
    "accepted",
  );
  assert.throws(
    () =>
      validateNarrationReviewDecision({
        context: changed,
        decision: { ...decision, checks: [{ ...first, startOffset: 1 }] },
      }),
    /TEXT_MISMATCH/,
  );
});

test("reviewer child and narrator parent generations are independent but parent anchor remains exact", () => {
  const { context } = fixture();
  const narratorContext = {
    ...context.narratorContext,
    scope: { ...context.narratorContext.scope, generation: 1 },
  };
  const anchored = {
    ...context,
    narratorContext,
    parent: {
      ...context.parent,
      scope: narratorContext.scope,
      contextHash: narratorContextHash(narratorContext),
    },
    scope: { ...context.scope, generation: 0 },
  };
  assert.ok(validateNarrationReviewContext(anchored));
  assert.throws(
    () =>
      validateNarrationReviewContext({
        ...anchored,
        parent: { ...anchored.parent, scope: context.parent.scope },
      }),
    /SCOPE_MISMATCH/,
  );
});
