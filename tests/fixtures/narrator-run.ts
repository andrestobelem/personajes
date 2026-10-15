import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeliverWorldWorker } from "../../src/application/deliver-world.ts";
import { openJournal } from "../../src/adapters/journal.ts";
import { PiRuntime } from "../../src/adapters/pi.ts";
import { createDirectorPiWorker } from "../../src/application/director-pi-worker.ts";
import { controlledDirectorSessionFactory } from "./director-session.ts";
import {
  validateRunConfiguration,
  ReadyRunConfigurationSchema,
} from "../../src/application/production-preflight.ts";
import { draftFixture } from "./continuista.ts";
import { canonicalDirectorValue } from "../../src/application/director-context.ts";
import {} from "../../src/application/narrator-context.ts";
import { createNarrationReviewPiPort } from "../../src/application/narration-review-pi-worker.ts";
import { controlledNarrationReviewSessionFactory } from "./narration-review-session.ts";

export async function fixture(enabled = true, seedSubjectivity = false) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "personajes-narrator-sdk-")));
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
export function fixtureReviewer(
  f: Awaited<ReturnType<typeof fixture>>,
  before?: () => void,
  options: {
    reject?: boolean;
    omitReview?: boolean;
    stats?: { requests: number; disposed: number };
  } = {},
) {
  return createNarrationReviewPiPort({
    journal: f.journal,
    runtime: f.runtime,
    ownerToken: randomUUID(),
    sessionFactory: controlledNarrationReviewSessionFactory({
      root: f.directory,
      physicalSessions: true,
      ...options,
      ...(before === undefined ? {} : { beforeTerminal: before }),
    }),
  });
}
