import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeliverWorldWorker } from "../src/application/deliver-world.ts";
import { openJournal } from "../src/adapters/journal.ts";
import { PiRuntime } from "../src/adapters/pi.ts";
import { createDirectorPiWorker } from "../src/application/director-pi-worker.ts";
import { controlledDirectorSessionFactory } from "./fixtures/director-session.ts";
import { createNarratorPiWorker } from "../src/application/narrator-pi-worker.ts";
import { controlledNarratorSessionFactory } from "./fixtures/narrator-session.ts";
import {
  validateRunConfiguration,
  ReadyRunConfigurationSchema,
} from "../src/application/production-preflight.ts";
import { draftFixture } from "./fixtures/continuista.ts";
import { canonicalDirectorValue } from "../src/application/director-context.ts";
import {
  narratorContextHash,
  narrationValueHash,
} from "../src/application/narrator-context.ts";
import { NarrationReviewSchema } from "../src/domain/narration.ts";
import type { NarrationReviewPort } from "../src/application/narrator-pi-worker.ts";

async function fixture(enabled = true, seedSubjectivity = false) {
  const directory = mkdtempSync(join(tmpdir(), "personajes-narrator-sdk-"));
  const journal = openJournal({ path: join(directory, "journal.sqlite") });
  const draft = draftFixture({
    narrationMode: { kind: enabled ? "enabled" : "disabled" },
    humanParticipants: [
      {
        identity: {
          participantId: "narrator-fixture-visitor",
          displayName: "Visitante de prueba",
          identityMarkdown: "Identidad ficticia sintética",
          lifeStoryMarkdown: "Historia ficticia sintética",
        },
        presence: {
          kind: "inScene",
          sceneId: "00000000-0000-4000-8000-000000000102",
          placeId: "sala",
          position: { x: 1, y: 2 },
          channelId: "00000000-0000-4000-8000-000000000104",
        },
      },
    ],
  });
  if (draft.budget.kind !== "configured")
    throw new Error("missing fixture budget");
  const ready = validateRunConfiguration({
    draft: {
      ...draft,
      budget: {
        ...draft.budget,
        value: { ...draft.budget.value, maxPiCallsPerPulse: 8 },
      },
    },
  });
  assert.equal(ready.kind, "ready");
  if (ready.kind !== "ready") throw new Error("invalid synthetic ready");
  const base = ready.configuration;
  const configuration = seedSubjectivity
    ? ReadyRunConfigurationSchema.parse({
        ...base,
        worldSnapshot: {
          ...base.worldSnapshot,
          entities: base.worldSnapshot.entities.map((entity) =>
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
                        sourceGoalId: "objetivo-prueba",
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
        },
      })
    : base;
  journal.registerWorldRun({
    initialSnapshot: configuration.worldSnapshot,
    configurationRevision: configuration.configRevision,
    configuration,
    continuityFence: {
      kind: "prepared-contexts",
      atWorldSeq: configuration.worldSnapshot.seq,
      contexts: configuration.roster.preparedCharacters.map((actor) => ({
        actorId: actor.characterId,
        continuityId: actor.continuity.continuityId,
        continuityRevision: actor.continuity.revision,
        continuityContentHash: actor.continuity.contentHash,
        identityVersion: actor.identityVersion,
        preparedContextHash: createHash("sha256")
          .update(canonicalDirectorValue(actor))
          .digest("hex"),
      })),
    },
    lifecycle: "running",
  });
  const actorId = configuration.roster.activeCharacterIds[0];
  assert.ok(actorId);
  journal.commitHumanIntervention({
    runId: configuration.runId,
    participantId: "narrator-fixture-visitor",
    expectedRevision: configuration.worldSnapshot.revision,
    idempotencyKey: randomUUID(),
    request: {
      kind: "speech",
      recipientCharacterIds: [actorId],
      channelId: "00000000-0000-4000-8000-000000000104",
      content: {
        kind: "speech",
        text: "Testimonio sintético para activar un pulso de prueba.",
      },
    },
  });
  await createDeliverWorldWorker({
    journal,
    runId: configuration.runId,
    actorId,
  }).drain();
  const begun = journal.beginCoordinatorPulse({ runId: configuration.runId });
  assert.equal(begun.kind, "started");
  if (begun.kind !== "started") throw new Error("missing synthetic pulse");
  for (const job of begun.jobs) {
    const lease = { ownerToken: randomUUID(), claimToken: randomUUID() };
    const claimed = journal.claimActorTurnJob({
      runId: job.runId,
      actorId: job.actorId,
      jobId: job.jobId,
      generation: job.generation,
      ...lease,
    });
    assert.equal(claimed.kind, "claimed");
    journal.failActorTurnJob({
      execution: {
        runId: job.runId,
        actorId: job.actorId,
        jobId: job.jobId,
        generation: job.generation,
        pulseId: job.pulseId,
        lease,
      },
      code: "execution-failed",
    });
  }
  const runtime = await PiRuntime.create({ privateDataRoot: directory });
  if (enabled) {
    const director = createDirectorPiWorker({
      journal,
      runtime,
      ownerToken: randomUUID(),
      sessionFactory: controlledDirectorSessionFactory({ root: directory }),
    });
    const observed = await director.run({
      runId: configuration.runId,
      pulseId: begun.pulse.pulseId,
    });
    assert.equal(observed.kind, "accepted");
  }
  return {
    directory,
    journal,
    runtime,
    runId: configuration.runId,
    pulseId: begun.pulse.pulseId,
    close() {
      journal.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
function fixtureReviewer(before?: () => void): NarrationReviewPort {
  return {
    async review({ context, proposal }) {
      before?.();
      return NarrationReviewSchema.parse({
        kind: "accepted",
        contextHash: narratorContextHash(context),
        proposalHash: narrationValueHash(proposal),
        reviewedTextHash: createHash("sha256")
          .update(proposal.text)
          .digest("hex"),
        confirmedSourcesOnly: true,
        privateReasoningExcluded: true,
        uncertaintyExplicit: true,
        reviewEvidenceId: randomUUID(),
      });
    },
  };
}

test("Narration disabled creates zero sessions, requests and publications", async () => {
  const f = await fixture(false);
  try {
    const stats = { requests: 0, disposed: 0 };
    let sessions = 0;
    const factory = controlledNarratorSessionFactory({
      root: f.directory,
      stats,
    });
    const worker = createNarratorPiWorker({
      journal: f.journal,
      runtime: f.runtime,
      ownerToken: randomUUID(),
      reviewer: fixtureReviewer(),
      sessionFactory: async (input) => {
        sessions++;
        return factory(input);
      },
    });
    const result = await worker.run({ runId: f.runId, pulseId: f.pulseId });
    assert.equal(result.kind, "inactive");
    assert.equal(sessions, 0);
    assert.equal(stats.requests, 0);
    assert.equal(
      f.journal.readRunModelTimeBudget({ runId: f.runId })?.runCallsUsed,
      0,
    );
  } finally {
    f.close();
  }
});
test("Narrator isolated SDK session publishes exact reviewed text; same pulse replays without reinference/world mutation", async () => {
  const f = await fixture();
  try {
    const before = f.journal.loadWorld({ runId: f.runId });
    const stats = { requests: 0, disposed: 0 };
    const worker = createNarratorPiWorker({
      journal: f.journal,
      runtime: f.runtime,
      ownerToken: randomUUID(),
      reviewer: fixtureReviewer(),
      sessionFactory: controlledNarratorSessionFactory({
        root: f.directory,
        stats,
      }),
    });
    const result = await worker.run({ runId: f.runId, pulseId: f.pulseId });
    assert.equal(result.kind, "published");
    assert.equal(stats.requests, 2);
    assert.equal(stats.disposed, 1);
    assert.deepEqual(f.journal.loadWorld({ runId: f.runId }), before);
    const repeated = await worker.run({ runId: f.runId, pulseId: f.pulseId });
    assert.equal(repeated.kind, "existing");
    assert.equal(stats.requests, 2);
    assert.equal(
      f.journal.readRunModelTimeBudget({ runId: f.runId })?.runCallsUsed,
      4,
    );
  } finally {
    f.close();
  }
});
test("Pause between independent review and publication revokes narrator authority, retains quota and world", async () => {
  const f = await fixture();
  try {
    const world = f.journal.loadWorld({ runId: f.runId });
    const stats = { requests: 0, disposed: 0 };
    const worker = createNarratorPiWorker({
      journal: f.journal,
      runtime: f.runtime,
      ownerToken: randomUUID(),
      reviewer: fixtureReviewer(() => {
        const current = f.journal.readWorldLifecycle({ runId: f.runId });
        assert.ok(current);
        f.journal.setWorldLifecycle({
          runId: f.runId,
          expectedWorldRevision: current.worldRevision,
          expectedConfigRevision: current.configRevision,
          target: "paused",
        });
      }),
      sessionFactory: controlledNarratorSessionFactory({
        root: f.directory,
        stats,
      }),
    });
    const result = await worker.run({ runId: f.runId, pulseId: f.pulseId });
    assert.equal(result.kind, "blocked");
    assert.deepEqual(f.journal.loadWorld({ runId: f.runId }), world);
    assert.equal(
      f.journal.readRunModelTimeBudget({ runId: f.runId })?.runCallsUsed,
      4,
    );
  } finally {
    f.close();
  }
});
test("Narrator terminal without typed proposal never publishes unreviewed text", async () => {
  const f = await fixture();
  try {
    const stats = { requests: 0, disposed: 0 };
    const worker = createNarratorPiWorker({
      journal: f.journal,
      runtime: f.runtime,
      ownerToken: randomUUID(),
      reviewer: fixtureReviewer(),
      sessionFactory: controlledNarratorSessionFactory({
        root: f.directory,
        stats,
        omitNarration: true,
      }),
    });
    const result = await worker.run({ runId: f.runId, pulseId: f.pulseId });
    assert.equal(result.kind, "blocked");
    assert.equal(stats.requests, 1);
    assert.equal(stats.disposed, 1);
  } finally {
    f.close();
  }
});

test("Omniscient narrated interiority cites canonical subjective sources without creating actor perceptions or world facts", async () => {
  const f = await fixture(true, true);
  try {
    const world = f.journal.loadWorld({ runId: f.runId });
    assert.ok(world);
    const events = f.journal.readWorldEvents({ runId: f.runId });
    const db = new DatabaseSync(join(f.directory, "journal.sqlite"));
    const readCounts = () => ({
      perceptions: db.prepare("SELECT count(*) n FROM world_perceptions").get()
        ?.n,
      experiences: db.prepare("SELECT count(*) n FROM experiences").get()?.n,
    });
    const counts = readCounts();
    const worker = createNarratorPiWorker({
      journal: f.journal,
      runtime: f.runtime,
      ownerToken: randomUUID(),
      reviewer: fixtureReviewer(),
      sessionFactory: controlledNarratorSessionFactory({
        root: f.directory,
        citeRecordedSubjectivity: true,
      }),
    });
    const result = await worker.run({ runId: f.runId, pulseId: f.pulseId });
    assert.equal(result.kind, "published");
    if (result.kind !== "published")
      throw new Error("narrator fixture not published");
    assert.equal(result.receipt.kind, "published");
    if (result.receipt.kind !== "published") throw new Error("wrong receipt");
    const publication = result.receipt.publication;
    assert.equal(publication.sourceRecordedFactIds.length, 1);
    assert.ok(publication.sourceRecordedFactIds[0]?.includes(":mind:"));
    assert.equal(
      publication.text,
      "El personaje deseaba comprender la situación de prueba.",
    );
    const stored = f.journal.readNarrationPublications({
      runId: f.runId,
      throughWorldSeq: world.seq,
    });
    assert.equal(stored.length, 1);
    assert.deepEqual(
      stored[0]?.sourceRecordedFactIds,
      publication.sourceRecordedFactIds,
    );
    assert.deepEqual(f.journal.loadWorld({ runId: f.runId }), world);
    assert.deepEqual(f.journal.readWorldEvents({ runId: f.runId }), events);
    assert.deepEqual(readCounts(), counts);
    db.close();
    assert.equal(
      f.journal.readRunModelTimeBudget({ runId: f.runId })?.runCallsUsed,
      4,
    );
  } finally {
    f.close();
  }
});
