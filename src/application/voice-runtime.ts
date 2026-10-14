import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createElevenLabsClient,
  type ElevenLabsClient,
} from "../adapters/elevenlabs.ts";
import { ReadyRunConfigurationSchema } from "./production-preflight.ts";
import type { openLocalHost } from "./local-host.ts";
import { openVoiceCredentialStore } from "./voice-credentials.ts";
import { openVoiceConfigStore } from "./voice-config-store.ts";
import { openVoiceService } from "./voice-service.ts";
import { VoiceConfigSchema } from "../domain/voice.ts";
import { createVoiceRoutes } from "../server/voice-routes.ts";
import { voiceHash } from "./voice-hash.ts";

/** Presentation-only composition: construction/recovery never contacts a provider. */
export function createVoiceRuntime(input: {
  host: ReturnType<typeof openLocalHost>;
  client?: ElevenLabsClient;
  privateAuthRoot?: string;
  onDiagnostic?: (input: { kind: "voice-runtime"; code: string }) => void;
}) {
  const credentials = openVoiceCredentialStore({
    privateAuthRoot:
      input.privateAuthRoot ?? `${input.host.privateDataRoot}-auth`,
  });
  const client =
    input.client ??
    createElevenLabsClient({ getApiKey: credentials.getApiKey });
  function ready(runId: string) {
    return ReadyRunConfigurationSchema.parse(
      input.host.journal.readWorldConfiguration({ runId }),
    );
  }
  function readOwners(runId: string) {
    const configuration = ready(runId);
    const owners = configuration.roster.preparedCharacters
      .filter(
        (character) =>
          character.voice.value.kind === "spoken" &&
          configuration.roster.activeCharacterIds.includes(
            character.characterId,
          ),
      )
      .map((character) => ({
        owner: { kind: "character" as const, id: character.characterId },
        label: character.characterId,
        speakable: true as const,
        ...(character.voice.value.kind === "spoken"
          ? { recipe: character.voice.value.recipe }
          : {}),
      }));
    return configuration.narrationMode.kind === "enabled"
      ? [
          ...owners,
          {
            owner: { kind: "narrator" as const },
            label: "Narrador",
            speakable: true as const,
          },
        ]
      : owners;
  }
  let service: ReturnType<typeof openVoiceService>;
  const config = openVoiceConfigStore({
    privateDataRoot: input.host.privateDataRoot,
    ownerToken: input.host.ownerToken,
    initialQuotaLimits: { voiceDesignCalls: 0, ttsCalls: 0, sfxCalls: 0 },
    readSpeechBinding: (id) => service.getBinding(id),
    readSoundBinding: (id) => service.getSoundBinding(id),
    readBaseConfiguration(runId) {
      const configuration = ready(runId);
      const metadata = input.host.journal.readWorldConfigurationMetadata({
        runId,
      });
      if (metadata === undefined)
        throw new Error("VOICE_CONFIGURATION_MISSING");
      return {
        configurationRevision: metadata.configurationRevision,
        configurationHash: metadata.configurationHash,
        createdAt:
          metadata.createdAt == null
            ? null
            : new Date(metadata.createdAt).toISOString(),
        effectOwnerIds: configuration.roster.preparedCharacters
          .filter(
            (character) =>
              character.voice.value.kind === "nonverbal" &&
              configuration.roster.activeCharacterIds.includes(
                character.characterId,
              ),
          )
          .map((character) => character.characterId),
        speakableIds: readOwners(runId).flatMap((item) =>
          item.owner.kind === "character" ? [item.owner.id] : [],
        ),
        voiceConfig: VoiceConfigSchema.parse({
          revision: configuration.configRevision,
          spanishVariety: configuration.spanishVariety,
          audioMode: configuration.audio.mode,
          speakerSlots: Object.fromEntries(
            configuration.audio.speakerSlots.map((item) => [
              item.characterId,
              item.slot,
            ]),
          ),
          narratorSlot: configuration.audio.narratorSlot,
          soundEffectSlots: Object.fromEntries(
            configuration.audio.soundEffectSlots.map((item) => [
              item.characterId,
              item.slot,
            ]),
          ),
        }),
      };
    },
  });
  function readPublication(runId: string, publicationId: string) {
    const confirmed = input.host.journal.readConfirmedSpeechPublication({
      runId,
      eventId: publicationId,
    });
    if (confirmed === undefined) {
      const narration = input.host.journal.readNarrationPublication({runId,publicationId});
      if(narration === undefined) return null;
      const snapshot=config.readAt(runId,narration.publishedAt);
      return {
        publicationId:narration.publicationId,runId:narration.scope.runId,
        text:narration.text,textHash:narration.textHash,textRevision:1,
        configRevision:snapshot?.config.revision ?? config.read(runId).config.revision,
        owner:{kind:"narrator" as const},
        committedAt:new Date(narration.publishedAt).toISOString(),
        // A source cut, never a new world event or invented sequence.
        sequence:narration.scope.throughWorldSeq,
      };
    }
    const event = confirmed.event;
    if (
      event.kind !== "communicated" ||
      event.content.kind !== "speech" ||
      event.origin.kind !== "actor"
    )
      return null;
    const snapshot = config.readAt(runId, confirmed.committedAt);
    return {
      publicationId: event.id,
      runId: event.runId,
      text: event.content.text,
      textHash: voiceHash(event.content.text),
      textRevision: 1,
      // Automatic scheduling is restricted to new commit callbacks below; historical lookup is manual.
      configRevision:
        snapshot?.config.revision ?? config.read(runId).config.revision,
      owner: { kind: "character" as const, id: event.origin.actorId },
      committedAt: new Date(confirmed.committedAt).toISOString(),
      sequence: event.seq,
    };
  }
  try {
    service = openVoiceService({
      privateDataRoot: input.host.privateDataRoot,
      ownerToken: input.host.ownerToken,
      client,
      hasCredential: () => credentials.status().credentialConfigured,
      readConfig: (runId) => config.read(runId).config,
      readPublication,
      speakableIds: (runId) =>
        readOwners(runId).flatMap((item) =>
          item.owner.kind === "character" ? [item.owner.id] : [],
        ),
      quotaLimits: (runId) => config.read(runId).quotaLimits,
    });
  } catch (error) {
    config.close();
    throw error;
  }
  let closed = false;
  let wakePending = false;
  let worker: Promise<void> | undefined;
  function wakeWorker() {
    if (closed) return;
    wakePending = true;
    if (worker !== undefined) return;
    worker = Promise.resolve()
      .then(async () => {
        while (wakePending && !closed) {
          wakePending = false;
          const processed = await service.drain({ limit: 100 });
          if (processed === 100) wakePending = true;
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      })
      .catch(() =>
        input.onDiagnostic?.({
          kind: "voice-runtime",
          code: "VOICE_WORKER_FAILED",
        }),
      )
      .finally(() => {
        worker = undefined;
      });
  }
  const routes = createVoiceRoutes({
    service,
    config,
    credentials,
    client,
    wakeWorker,
    readVoiceOwners: readOwners,
    readSoundOwners: (runId) => {
      const configuration = ready(runId);
      return configuration.roster.preparedCharacters
        .filter(
          (character) =>
            character.voice.value.kind === "nonverbal" &&
            configuration.roster.activeCharacterIds.includes(
              character.characterId,
            ),
        )
        .map((character) => {
          const entity = configuration.worldSnapshot.entities.find(
            (entity) =>
              entity.kind === "character" &&
              entity.characterId === character.characterId,
          );
          return {
            id: character.characterId,
            label:
              entity?.kind === "character"
                ? entity.presentation.label
                : character.characterId,
          };
        });
    },
  });
  function onWorldCommitted(raw: unknown) {
    if (closed) return;
    const commit = z
      .strictObject({
        runId: z.string().uuid(),
        eventIds: z.array(z.string().uuid()).max(100000),
      })
      .parse(raw);
    for (const eventId of commit.eventIds) {
      const publication = readPublication(commit.runId, eventId);
      if (publication === null) continue;
      // Configured after this commit means backfill, even if the callback arrived late.
      const original = config.readAt(commit.runId, publication.committedAt);
      if (
        original === null ||
        original.config.audioMode.kind !== "enabled" ||
        original.config.audioMode.ttsMode !== "automatic-after-publication"
      )
        continue;
      try {
        service.requestPublicationAudio(
          {
            operationId: randomUUID(),
            principal: "local-operator",
            runId: commit.runId,
            expectedRevision: original.config.revision,
          },
          eventId,
          "after-commit",
          original.config,
        );
      } catch {
        input.onDiagnostic?.({
          kind: "voice-runtime",
          code: "VOICE_AUTOMATIC_AUDIO_BLOCKED",
        });
      }
    }
    wakeWorker();
  }
  return {
    routes,
    config,
    service,
    credentials,
    /** Host-only source resolver; never accepts caller text or provider paths. */
    readPublication,
    wakeWorker,
    onWorldCommitted,
    onNarrationPublished(event:{runId:string;publicationId:string}) {
      onWorldCommitted({runId:event.runId,eventIds:[event.publicationId]});
    },
    async close() {
      if (closed) return;
      closed = true;
      wakePending = false;
      await service.shutdown();
      await worker;
      config.close();
    },
    async waitForIdle() {
      await worker;
    },
  };
}
