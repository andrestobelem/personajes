import { z } from "zod";
import {
  AudioModeSchema,
  SpeakerSlotSchema,
  NarratorSlotSchema,
  SoundEffectSlotSchema,
  SpeechBindingIdSchema,
  SoundBindingIdSchema,
} from "./production.ts";
import { SpanishVarietyForActingSchema } from "./preparation.ts";
export {
  AudioModeSchema,
  SpeakerSlotSchema,
  NarratorSlotSchema,
  SoundEffectSlotSchema,
  SpeechBindingIdSchema,
  SoundBindingIdSchema,
};
export const SpanishVarietySchema = SpanishVarietyForActingSchema;

const text = z
  .string()
  .min(1)
  .refine((value) => !value.includes("\0"), "NUL forbidden");
const id = text.max(120).regex(/^[A-Za-z0-9_.:-]+$/);
const revision = z.number().int().nonnegative().safe();
export const VoiceOperationIdSchema = z.uuid().brand<"VoiceOperationId">();
export const VoiceArtifactIdSchema = z.uuid().brand<"VoiceArtifactId">();
export const VoicePreviewIdSchema = z.uuid().brand<"VoicePreviewId">();
export const SavedVoiceIdSchema = z.uuid().brand<"SavedVoiceId">();
export const SpeechBindingDraftIdSchema = z
  .uuid()
  .brand<"SpeechBindingDraftId">();
export const ProviderVoiceIdSchema = id.brand<"ProviderVoiceId">();
export const GeneratedVoiceIdSchema = id.brand<"GeneratedVoiceId">();
export const VoiceConfigSchema = z
  .object({
    revision,
    spanishVariety: SpanishVarietySchema,
    audioMode: AudioModeSchema,
    speakerSlots: z.record(id, SpeakerSlotSchema),
    narratorSlot: NarratorSlotSchema,
    soundEffectSlots: z.record(id, SoundEffectSlotSchema),
  })
  .strict();
export const VoiceOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("character"), id }).strict(),
  z.object({ kind: z.literal("narrator") }).strict(),
]);
export const VoiceSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("savedVoice"), savedVoiceId: SavedVoiceIdSchema })
    .strict(),
  z
    .object({
      kind: z.literal("providerVoice"),
      providerVoiceId: ProviderVoiceIdSchema,
    })
    .strict(),
]);
export const VoiceProvenanceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("created-by-this-app"),
      savedVoiceId: SavedVoiceIdSchema,
      designModelId: id,
    })
    .strict(),
  z
    .object({
      kind: z.literal("existing-provider-voice-selected"),
      providerCatalogRef: text.max(200),
    })
    .strict(),
]);
export const VoiceSnapshotSchema = z
  .object({
    providerVoiceId: ProviderVoiceIdSchema,
    name: text.max(120),
    description: z.string().max(1000),
    language: z.literal("es"),
    catalogHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const SpeechBindingDraftSchema = z
  .object({
    kind: z.literal("unvalidated"),
    bindingDraftId: SpeechBindingDraftIdSchema,
    owner: VoiceOwnerSchema,
    providerVoiceId: ProviderVoiceIdSchema,
    ttsModelId: id,
    varietyLabel: text.max(200),
    configRevision: revision,
    source: VoiceSourceSchema,
    provenance: VoiceProvenanceSchema,
    voiceSnapshot: VoiceSnapshotSchema,
  })
  .strict();
export const SpeechBindingSchema = z
  .object({
    kind: z.literal("speech"),
    speechBindingId: SpeechBindingIdSchema,
    owner: VoiceOwnerSchema,
    provider: z.literal("elevenlabs"),
    voiceId: ProviderVoiceIdSchema,
    voiceName: text.max(120),
    voiceDescription: z.string().max(1000),
    language: z.literal("es"),
    ttsModelId: id,
    varietyLabel: text.max(200),
    configRevision: revision,
    validationEvidenceId: z.uuid(),
    provenance: VoiceProvenanceSchema,
  })
  .strict();
export const SoundBindingSchema = z
  .object({
    kind: z.literal("nonverbal-effect"),
    soundBindingId: SoundBindingIdSchema,
    sourceId: id,
    artifactId: VoiceArtifactIdSchema,
    configRevision: revision,
    provenance: z
      .object({
        kind: z.literal("operator-reviewed-nonverbal"),
        acceptedBy: text.max(120),
        acceptedAt: z.iso.datetime(),
      })
      .strict(),
  })
  .strict();
export const OperatorSampleOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("operator-entered") }).strict(),
  z.object({ kind: z.literal("operator-selected") }).strict(),
]);
export const VoiceDesignRequestSchema = z
  .object({
    owner: VoiceOwnerSchema,
    sampleText: text.min(100).max(1000),
    sampleOrigin: OperatorSampleOriginSchema,
    voiceDescription: text.min(20).max(1000),
    modelId: id,
    language: z.literal("es"),
    originalSampleConfirmed: z.literal(true),
    descriptionReviewed: z.literal(true),
  })
  .strict();
export const VoiceTestRequestSchema = z
  .object({
    sampleText: text.refine(
      (value) => new TextEncoder().encode(value).byteLength <= 4000,
    ),
    sampleOrigin: OperatorSampleOriginSchema,
  })
  .strict();
export const SoundEffectRequestSchema = z
  .object({
    text: text.max(1000),
    modelId: id,
    durationSeconds: z.number().min(0.5).max(30).optional(),
    promptInfluence: z.number().min(0).max(1).optional(),
    originalNonverbalReviewed: z.literal(true),
  })
  .strict();
export const VoiceOperationStateSchema = z.enum([
  "queued",
  "validating",
  "submitted",
  "response-received",
  "artifact-persisting",
  "ready",
  "blocked",
  "failed",
  "cancelled",
  "uncertain",
  "orphaned",
]);
export const VoiceOperationSchema = z
  .object({
    operationId: VoiceOperationIdSchema,
    principal: text.max(120),
    runId: text.max(120),
    kind: z.enum([
      "design-preview",
      "save-voice",
      "binding-test",
      "tts",
      "sfx",
    ]),
    configRevision: revision,
    modelId: id,
    state: VoiceOperationStateSchema,
    revision,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    artifactIds: z.array(VoiceArtifactIdSchema).max(32),
    previewIds: z.array(VoicePreviewIdSchema).max(32),
    selectedPreviewId: VoicePreviewIdSchema.nullable(),
    savedVoiceId: SavedVoiceIdSchema.nullable(),
    safeCode: id.nullable(),
    cost: z.object({ kind: z.literal("unknown") }).strict(),
  })
  .strict();
export const VoiceArtifactSchema = z
  .object({
    artifactId: VoiceArtifactIdSchema,
    operationId: VoiceOperationIdSchema,
    kind: z.enum(["preview", "binding-test", "publication", "sound-effect"]),
    state: z.enum(["available", "artifact-unavailable", "orphaned"]),
    sourceId: text.max(120),
    text: z.string(),
    textHash: z.string().regex(/^[a-f0-9]{64}$/),
    textRevision: revision,
    configRevision: revision,
    modelId: id,
    bindingId: z.uuid().nullable(),
    mediaType: z.enum(["audio/mpeg", "audio/pcm", "audio/wav"]),
    byteLength: z
      .number()
      .int()
      .positive()
      .max(16 * 1024 * 1024),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    providerAudioHash: z.string().regex(/^[a-f0-9]{64}$/),
    providerOutputFormat: z.string().nullable(),
    durationSeconds: z.number().nonnegative().finite().nullable(),
    subtitles: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("unverified"), text: z.string() }).strict(),
      z
        .object({
          kind: z.literal("verified"),
          algorithm: z.literal("character-cues-v1"),
          cues: z.array(
            z
              .object({
                text: z.string(),
                startSeconds: z.number().nonnegative(),
                endSeconds: z.number().nonnegative(),
              })
              .strict(),
          ),
        })
        .strict(),
    ]),
  })
  .strict();
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;
export type VoiceOwner = z.infer<typeof VoiceOwnerSchema>;
export type SpeechBinding = z.infer<typeof SpeechBindingSchema>;
export type SpeechBindingDraft = z.infer<typeof SpeechBindingDraftSchema>;
export type VoiceOperation = z.infer<typeof VoiceOperationSchema>;
export type VoiceArtifact = z.infer<typeof VoiceArtifactSchema>;
export function requireConfirmedVariety(config: VoiceConfig) {
  if (config.spanishVariety.kind !== "confirmed")
    throw new Error("SPANISH_VARIETY_UNCONFIRMED");
  return config.spanishVariety;
}
export function assertVoiceOwner(
  owner: VoiceOwner,
  speakableIds: readonly string[],
): void {
  if (
    owner.kind === "character" &&
    (!speakableIds.includes(owner.id) ||
      /fang|twin|gemelo|familia-smart/i.test(owner.id))
  )
    throw new Error("OWNER_NOT_SPEAKABLE");
}
export function voiceOwnerKey(owner: VoiceOwner): string {
  return owner.kind === "narrator" ? "narrator" : owner.id;
}
export function buildVoiceSubtitles(
  textValue: string,
  alignment:
    | {
        kind: "verified";
        characters: string[];
        startTimesSeconds: number[];
        endTimesSeconds: number[];
      }
    | { kind: "unverified" },
  maxCharacters = 64,
): VoiceArtifact["subtitles"] {
  if (
    alignment.kind !== "verified" ||
    alignment.characters.join("") !== textValue ||
    alignment.characters.length !== alignment.startTimesSeconds.length ||
    alignment.characters.length !== alignment.endTimesSeconds.length
  )
    return { kind: "unverified", text: textValue };
  if (
    !Number.isSafeInteger(maxCharacters) ||
    maxCharacters < 1 ||
    maxCharacters > 1000
  )
    throw new Error("INVALID_CUE_LIMIT");
  let previousStart = 0;
  let previousEnd = 0;
  for (let index = 0; index < alignment.characters.length; index++) {
    const start = alignment.startTimesSeconds[index];
    const end = alignment.endTimesSeconds[index];
    if (
      start === undefined ||
      end === undefined ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < previousStart ||
      end < start ||
      end < previousEnd
    )
      return { kind: "unverified", text: textValue };
    previousStart = start;
    previousEnd = end;
  }
  const cues: { text: string; startSeconds: number; endSeconds: number }[] = [];
  let from = 0;
  while (from < alignment.characters.length) {
    let until = Math.min(from + maxCharacters, alignment.characters.length);
    if (until < alignment.characters.length) {
      for (let index = until - 1; index > from; index--) {
        if (/\s|[.!?;,]/u.test(alignment.characters[index] ?? "")) {
          until = index + 1;
          break;
        }
      }
    }
    const startSeconds = alignment.startTimesSeconds[from];
    const endSeconds = alignment.endTimesSeconds[until - 1];
    if (startSeconds === undefined || endSeconds === undefined)
      return { kind: "unverified", text: textValue };
    cues.push({
      text: alignment.characters.slice(from, until).join(""),
      startSeconds,
      endSeconds,
    });
    from = until;
  }
  return { kind: "verified", algorithm: "character-cues-v1", cues };
}

export const SavedVoiceSchema = z
  .object({
    savedVoiceId: SavedVoiceIdSchema,
    providerVoiceId: ProviderVoiceIdSchema,
    voiceName: z.string(),
    voiceDescription: z.string(),
    designModelId: z.string(),
    previewId: VoicePreviewIdSchema,
  })
  .strict();
export const VoicePreviewSchema = z
  .object({
    previewId: VoicePreviewIdSchema,
    operationId: VoiceOperationIdSchema,
    generatedVoiceId: GeneratedVoiceIdSchema,
    artifactId: VoiceArtifactIdSchema,
    description: z.string(),
    sampleText: z.string(),
    modelId: z.string(),
    varietyLabel: z.string(),
  })
  .strict();
export const VoiceQuotaLimitsSchema = z
  .object({
    voiceDesignCalls: z.number().int().nonnegative().max(10000),
    ttsCalls: z.number().int().nonnegative().max(10000),
    sfxCalls: z.number().int().nonnegative().max(10000),
  })
  .strict();
export const VoiceConfigSnapshotSchema = z
  .object({
    config: VoiceConfigSchema,
    baseRunConfigurationRevision: z.number().int().nonnegative(),
    baseRunConfigurationHash: z.string().regex(/^[a-f0-9]{64}$/),
    quotaLimits: VoiceQuotaLimitsSchema,
    updatedBy: z.string(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const VoiceProviderVoiceSchema = z
  .object({
    voiceId: ProviderVoiceIdSchema,
    name: z.string(),
    description: z.string(),
    languages: z.array(z.string()),
  })
  .strict();
export const VoiceProviderVoicesPageSchema = z
  .object({
    voices: z.array(VoiceProviderVoiceSchema).max(100),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .strict();
export const VoiceProviderModelSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("voiceDesign"), modelId: z.string() }).strict(),
  z
    .object({
      kind: z.literal("speech"),
      modelId: z.string(),
      name: z.string(),
      canDoTextToSpeech: z.boolean(),
      languages: z.array(z.string()),
    })
    .strict(),
  z.object({ kind: z.literal("soundEffect"), modelId: z.string() }).strict(),
]);

export const VoiceCatalogModelSchema = z.strictObject({
  modelId: z.string(),
  name: z.string(),
  canDoTextToSpeech: z.boolean(),
  languages: z.array(z.string()),
});
export const VoiceCatalogVoiceSchema = z.strictObject({
  voiceId: z.string(),
  name: z.string(),
  description: z.string(),
  languages: z.array(z.string()),
});
