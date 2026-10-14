import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./fixtures/narrator-run.ts";
import { openLocalHost } from "../src/application/local-host.ts";
import { createVoiceRuntime } from "../src/application/voice-runtime.ts";
import { createElevenLabsClient } from "../src/adapters/elevenlabs.ts";
import { createRepresentationRuntime } from "../src/application/representation-runtime.ts";
import { controlledDirectorSessionFactory } from "./fixtures/director-session.ts";
import { controlledNarratorSessionFactory } from "./fixtures/narrator-session.ts";
import { controlledNarrationReviewSessionFactory } from "./fixtures/narration-review-session.ts";
const binary =
  process.env.PERSONAJES_ICM_TEST_BINARY ??
  "/workspace/personajes-tools/icm-0.11.4/icm";

test("representation composition runs isolated narrator and reviewer after Director, then closes pulse without actor facts", async () => {
  assert.ok(
    existsSync(binary),
    "Pinned ICM binary is required for this real composition check",
  );
  const f = await fixture(true, true);
  f.journal.close();
  renameSync(
    join(f.directory, "journal.sqlite"),
    join(f.directory, "world.sqlite"),
  );
  const host = openLocalHost({ privateDataRoot: f.directory });
  let voiceCalls = 0;
  const voices = createVoiceRuntime({
    host,
    client: createElevenLabsClient({
      getApiKey: () => undefined,
      transport: async () => {
        voiceCalls++;
        throw new Error("No voice generation authorized");
      },
    }),
  });
  const stats = { requests: 0, disposed: 0 };
  const reviewStats = { requests: 0, disposed: 0 };
  const runtime = await createRepresentationRuntime({
    host,
    piRuntime: f.runtime,
    icmBinaryPath: binary,
    onNarrationPublished: (event) => voices.onNarrationPublished(event),
    testTransport: {
      kind: "controlled-test-transport",
      name: "narrator-and-independent-reviewer-sdk-fixture",
      actorSessionFactory: async () => {
        throw new Error(
          "Actor fixture is already terminal; no actor inference authorized",
        );
      },
      continuistaSessionFactory: async () => {
        throw new Error("Actor review fixture is already terminal");
      },
      directorSessionFactory: controlledDirectorSessionFactory({
        root: f.directory,
      }),
      narratorSessionFactory: controlledNarratorSessionFactory({
        root: f.directory,
        physicalSessions: true,
        stats,
        citeRecordedSubjectivity: true,
      }),
      narrationReviewSessionFactory: controlledNarrationReviewSessionFactory({
        root: f.directory,
        physicalSessions: true,
        stats: reviewStats,
      }),
    },
  });
  try {
    const before = host.journal.loadWorld({ runId: f.runId });
    assert.equal(runtime.roleReadiness.narrator, true);
    assert.equal(await runtime.scheduleRun({ runId: f.runId }), true);
    await runtime.waitForIdle();
    const publications = host.journal.readNarrationPublications({
      runId: f.runId,
      throughWorldSeq: 100,
    });
    assert.equal(publications.length, 1);
    const publication = publications[0]!;
    const speech = voices.readPublication(f.runId, publication.publicationId);
    assert.ok(speech);
    assert.equal(speech.text, publication.text);
    assert.equal(speech.textHash, publication.textHash);
    assert.deepEqual(speech.owner, { kind: "narrator" });
    assert.equal(speech.sequence, publication.scope.throughWorldSeq);
    assert.equal(
      speech.committedAt,
      new Date(publication.publishedAt).toISOString(),
    );
    assert.equal(
      voices.readPublication(
        "00000000-0000-4000-8000-000000000000",
        publication.publicationId,
      ),
      null,
    );
    await voices.waitForIdle();
    assert.equal(voiceCalls, 0);
    assert.equal(stats.requests, 2);
    assert.equal(reviewStats.requests, 2);
    assert.equal(stats.disposed, 1);
    assert.equal(reviewStats.disposed, 1);
    assert.deepEqual(host.journal.loadWorld({ runId: f.runId }), before);
    assert.equal(
      host.journal.readRunModelTimeBudget({ runId: f.runId })?.runCallsUsed,
      6,
    );
  } finally {
    await voices.close();
    await runtime.close();
    rmSync(f.directory, { recursive: true, force: true });
    rmSync(`${f.directory}-auth`, { recursive: true, force: true });
  }
});
