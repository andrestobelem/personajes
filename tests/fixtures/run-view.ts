import { validateRunConfiguration } from "../../src/application/production-preflight.ts";
import { RunViewSchema, type RunView } from "../../src/domain/http.ts";
import { draftFixture } from "./continuista.ts";
const timestamp = "2026-10-14T12:00:00.000Z";
export function runViewFixture(): RunView {
  const result = validateRunConfiguration({ draft: draftFixture() });
  if (result.kind !== "ready")
    throw new Error("Synthetic lifecycle fixture must be Ready.");
  const configuration = result.configuration;
  const runId = configuration.runId;
  return RunViewSchema.parse({
    runId,
    configRevision: configuration.configRevision,
    worldRevision: configuration.worldSnapshot.revision,
    lastWorldSeq: configuration.worldSnapshot.seq,
    lifecycleRevision: 3,
    lifecycle: { kind: "ready" },
    config: {
      runId,
      configRevision: configuration.configRevision,
      name: configuration.name,
      fictionalAt: configuration.fictionalAt,
      continuity: {continuityId:configuration.continuity.continuityId,revision:configuration.continuity.revision},
      roster: {activeCharacterCount:configuration.roster.activeCharacterIds.length},
      humanParticipantCount:configuration.humanParticipants.length,
      language: configuration.language,
      spanishVariety: configuration.spanishVariety,
      narrationMode: configuration.narrationMode,
      ...(configuration.inferenceProfile === undefined
        ? {}
        : { inferenceProfile: configuration.inferenceProfile }),
      budget: configuration.budget,
      maxReformulations: configuration.maxReformulations,
      audio:{mode:configuration.audio.mode},
    },
    clock: configuration.worldSnapshot.clock,
    limits: {
      maxModelCallsPerRun: configuration.budget.maxPiCallsPerRun,
      maxModelCallsPerPulse: configuration.budget.maxPiCallsPerPulse,
      maxConcurrentCalls: configuration.budget.maxConcurrentPiRequests,
      requestTimeoutMs: configuration.budget.requestTimeoutMs ?? 30_000,
      maxModelWallTimeMsPerRun: configuration.budget.maxWallTimeMs,
      maxTtsCallsPerRun: 0,
      maxDesignCallsPerRun: 0,
      maxSfxCallsPerRun: 0,
      maxReformulations: configuration.maxReformulations,
    },
    budget: {
      modelCalls: {
        limit: configuration.budget.maxPiCallsPerRun,
        used: 0,
        reserved: 0,
        remaining: configuration.budget.maxPiCallsPerRun,
      },
      modelWallTimeMs: {
        limit: configuration.budget.maxWallTimeMs,
        measured: 0,
        reserved: 0,
        remaining: configuration.budget.maxWallTimeMs,
      },
      voiceDesignCalls: { limit: 0, used: 0, reserved: 0, remaining: 0 },
      ttsCalls: { limit: 0, used: 0, reserved: 0, remaining: 0 },
      sfxCalls: { limit: 0, used: 0, reserved: 0, remaining: 0 },
      status: "available",
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
