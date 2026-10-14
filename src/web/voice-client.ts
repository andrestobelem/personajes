import { z } from "zod";
import { ApiProblemSchema } from "../domain/http.ts";
import {
  VoiceConfigSnapshotSchema,
  VoiceOperationSchema,
  VoiceDesignRequestSchema,
  VoicePreviewSchema,
  SavedVoiceSchema,
  VoiceSourceSchema,
  VoiceOwnerSchema,
  VoiceTestRequestSchema,
  SpeechBindingDraftSchema,
  SpeechBindingSchema,
  VoiceArtifactSchema,
  VoiceProviderModelSchema,
  VoiceProviderVoicesPageSchema,
  voiceOwnerKey,
} from "../domain/voice.ts";
import { bootstrapSession } from "./client.ts";
const key = z.string().uuid();
const revision = z.number().int().nonnegative().safe();
const label = z.string().trim().min(1).max(300);
const config = { runId: key, configRevision: revision, key };
const operation = { operationId: key, operationRevision: revision, key };
export const VoiceIntentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("confirmVariety"), ...config, label }),
  z.strictObject({ kind: z.literal("proposeVariety"), ...config, label }),
  z.strictObject({
    kind: z.literal("design"),
    ...config,
    request: VoiceDesignRequestSchema,
  }),
  z.strictObject({ kind: z.literal("select"), ...operation, previewId: key }),
  z.strictObject({
    kind: z.literal("saveVoice"),
    ...operation,
    previewId: key,
    voiceName: z.string().trim().min(1).max(120),
    voiceDescription: z.string().trim().min(20).max(1000),
  }),
  z.strictObject({
    kind: z.literal("draft"),
    ...config,
    owner: VoiceOwnerSchema,
    source: VoiceSourceSchema,
    ttsModelId: z.string().min(1).max(200),
  }),
  z.strictObject({
    kind: z.literal("test"),
    ...config,
    bindingDraftId: key,
    request: VoiceTestRequestSchema,
  }),
  z.strictObject({ kind: z.literal("listen"), key, artifactId: key }),
  z.strictObject({
    kind: z.literal("accept"),
    ...config,
    bindingDraftId: key,
    artifactId: key,
    verdict: z.enum(["accept", "reject"]),
  }),
  z.strictObject({ kind: z.literal("cancel"), ...operation }),
  z.strictObject({ kind: z.literal("reconcile"), key, operationId: key }),
  z.strictObject({
    kind: z.literal("tts"),
    ...config,
    publicationId: z.string().min(1).max(120),
    format: z.string().min(1).max(100),
  }),
]);
export type VoiceIntent = z.infer<typeof VoiceIntentSchema>;
export type VoiceSettingsDocument = {
  value: z.infer<typeof VoiceConfigSnapshotSchema>;
  etag: string;
};
export const VoiceOwnersSchema = z.strictObject({
  owners: z
    .array(
      z.strictObject({
        owner: VoiceOwnerSchema,
        label: z.string().min(1),
        speakable: z.literal(true),
        recipe: z.string().optional(),
      }),
    )
    .max(101),
});
export function voiceConfigEtag(runId: string, configRevision: number) {
  return `"voice-config:${runId}:r${configRevision}"`;
}
export function voiceOperationEtag(
  value: z.infer<typeof VoiceOperationSchema>,
) {
  return `"voice-operation:${value.operationId}:r${value.revision}"`;
}
export function captureVoiceIntent(value: unknown) {
  return VoiceIntentSchema.parse(value);
}
export function buildVoiceRequest(input: {
  intent: VoiceIntent;
  csrfToken: string;
}) {
  const intent = captureVoiceIntent(input.intent);
  let path: string;
  let method: "POST" | "PUT" = "POST";
  let body: unknown;
  let etag: string | undefined;
  if ("configRevision" in intent)
    etag = voiceConfigEtag(intent.runId, intent.configRevision);
  if ("operationRevision" in intent)
    etag = `"voice-operation:${intent.operationId}:r${intent.operationRevision}"`;
  switch (intent.kind) {
    case "confirmVariety":
      path = `/api/v1/runs/${intent.runId}/spanish-variety/confirm`;
      body = { label: intent.label };
      break;
    case "proposeVariety":
      path = `/api/v1/runs/${intent.runId}/spanish-variety/proposal`;
      method = "PUT";
      body = { label: intent.label };
      break;
    case "design":
      path = `/api/v1/runs/${intent.runId}/voice-designs`;
      body = intent.request;
      break;
    case "select":
      path = `/api/v1/voice-designs/${intent.operationId}/selection`;
      method = "PUT";
      body = { previewId: intent.previewId };
      break;
    case "saveVoice":
      path = `/api/v1/voice-previews/${intent.previewId}/save`;
      body = {
        voiceName: intent.voiceName,
        voiceDescription: intent.voiceDescription,
      };
      break;
    case "draft":
      path = `/api/v1/runs/${intent.runId}/speech-binding-drafts`;
      body = {
        owner: intent.owner,
        source: intent.source,
        ttsModelId: intent.ttsModelId,
      };
      break;
    case "test":
      path = `/api/v1/runs/${intent.runId}/speech-binding-drafts/${intent.bindingDraftId}/tests`;
      body = intent.request;
      break;
    case "listen":
      path = `/api/v1/voice-artifacts/${intent.artifactId}/listened`;
      body = { kind: "listened" };
      break;
    case "accept":
      path = `/api/v1/runs/${intent.runId}/speech-binding-drafts/${intent.bindingDraftId}/acceptance`;
      body = { kind: intent.verdict, artifactId: intent.artifactId };
      break;
    case "cancel":
      path = `/api/v1/voice-operations/${intent.operationId}/cancel`;
      body = { kind: "cancel" };
      break;
    case "reconcile":
      path = `/api/v1/voice-operations/${intent.operationId}/reconcile`;
      body = { kind: "reconcileLocal" };
      break;
    case "tts":
      path = `/api/v1/runs/${intent.runId}/audio`;
      body = {
        publicationId: intent.publicationId,
        voiceConfigRevision: intent.configRevision,
        format: intent.format,
      };
      break;
    default: {
      const exhaustive: never = intent;
      throw new Error(String(exhaustive));
    }
  }
  return {
    path,
    init: {
      method,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": input.csrfToken,
        "Idempotency-Key": intent.key,
        ...(etag === undefined ? {} : { "If-Match": etag }),
      },
      body: JSON.stringify(body),
    } satisfies RequestInit,
  };
}
export class VoiceHttpRejection extends Error {
  constructor(
    readonly status: number,
    readonly requestId: string,
    message: string,
  ) {
    super(message);
  }
}
async function json(response: Response): Promise<unknown> {
  const value: unknown = await response.json();
  if (!response.ok) {
    const problem = ApiProblemSchema.safeParse(value);
    if (
      problem.success &&
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408
    )
      throw new VoiceHttpRejection(
        response.status,
        problem.data.requestId,
        `${problem.data.error.message} Referencia: ${problem.data.requestId}.`,
      );
    throw new Error("No se confirmó la operación de voz.");
  }
  return value;
}
function checked<T>(value: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new Error(
      "La respuesta de voz no tiene el formato público esperado.",
    );
  return result.data;
}
const AcceptedSchema = z.strictObject({
  result: z.strictObject({
    kind: z.literal("accepted"),
    binding: SpeechBindingSchema,
  }),
  settings: VoiceConfigSnapshotSchema,
});
const RejectedSchema = z.strictObject({
  kind: z.literal("rejected"),
  bindingDraftId: key,
});
export type VoiceResult =
  | { kind: "operation"; operation: z.infer<typeof VoiceOperationSchema> }
  | { kind: "settings"; document: VoiceSettingsDocument }
  | { kind: "draft"; draft: z.infer<typeof SpeechBindingDraftSchema> }
  | { kind: "accepted"; value: z.infer<typeof AcceptedSchema> }
  | { kind: "rejected"; bindingDraftId: string }
  | { kind: "listened"; artifactId: string };
export function createVoiceClient(
  request: typeof fetch = (url, init) => fetch(url, init),
  bootstrap = bootstrapSession,
) {
  async function read<T>(
    path: string,
    schema: z.ZodType<T>,
    signal: AbortSignal,
  ) {
    await bootstrap();
    return checked(
      await json(await request(path, { credentials: "same-origin", signal })),
      schema,
    );
  }
  return {
    status(signal: AbortSignal) {
      return read(
        "/api/v1/integrations/elevenlabs/status",
        z.strictObject({
          credentialConfigured: z.boolean(),
          safeCode: z.string().nullable(),
        }),
        signal,
      );
    },
    async settings(
      runId: string,
      signal: AbortSignal,
    ): Promise<VoiceSettingsDocument> {
      await bootstrap();
      const response = await request(
        `/api/v1/runs/${key.parse(runId)}/voice-settings`,
        { credentials: "same-origin", signal },
      );
      const value = checked(await json(response), VoiceConfigSnapshotSchema);
      const etag = voiceConfigEtag(runId, value.config.revision);
      if (response.headers.get("etag") !== etag)
        throw new Error("La revisión de voz no coincide.");
      return { value, etag };
    },
    drafts(runId: string, signal: AbortSignal) {
      return read(
        `/api/v1/runs/${key.parse(runId)}/speech-binding-drafts`,
        z.strictObject({ drafts: z.array(SpeechBindingDraftSchema).max(100) }),
        signal,
      );
    },
    soundOwners(runId: string, signal: AbortSignal) {
      return read(
        `/api/v1/runs/${key.parse(runId)}/sound-owners`,
        z.strictObject({
          owners: z
            .array(
              z.strictObject({
                id: z.string().min(1).max(120),
                label: z.string().min(1).max(500),
              }),
            )
            .max(100),
        }),
        signal,
      );
    },
    owners(runId: string, signal: AbortSignal) {
      return read(
        `/api/v1/runs/${key.parse(runId)}/voice-owners`,
        VoiceOwnersSchema,
        signal,
      );
    },
    library(signal: AbortSignal) {
      return read(
        "/api/v1/voice-library",
        z.strictObject({ voices: z.array(SavedVoiceSchema) }),
        signal,
      );
    },
    async history(runId: string, signal: AbortSignal) {
      const page = await read(
        `/api/v1/runs/${key.parse(runId)}/voice-operations`,
        z.strictObject({ operations: z.array(VoiceOperationSchema) }),
        signal,
      );
      if (page.operations.some((value) => value.runId !== runId))
        throw new Error("La operación pertenece a otra representación.");
      return page;
    },
    async operation(operationId: string, signal: AbortSignal) {
      const value = await read(
        `/api/v1/voice-operations/${key.parse(operationId)}`,
        VoiceOperationSchema,
        signal,
      );
      if (value.operationId !== operationId)
        throw new Error("La operación consultada no coincide.");
      return value;
    },
    async design(operationId: string, signal: AbortSignal) {
      const value = await read(
        `/api/v1/voice-designs/${key.parse(operationId)}`,
        z.strictObject({
          operation: VoiceOperationSchema,
          previews: z.array(VoicePreviewSchema),
        }),
        signal,
      );
      if (
        value.operation.operationId !== operationId ||
        value.previews.some((preview) => preview.operationId !== operationId)
      )
        throw new Error("Las muestras pertenecen a otra operación.");
      return value;
    },
    async artifact(artifactId: string, signal: AbortSignal) {
      const value = await read(
        `/api/v1/voice-artifacts/${key.parse(artifactId)}`,
        VoiceArtifactSchema,
        signal,
      );
      if (value.artifactId !== artifactId)
        throw new Error("El artefacto consultado no coincide.");
      return value;
    },
    async models(purpose: "voiceDesign" | "speech", signal: AbortSignal) {
      const value = await read(
        `/api/v1/integrations/elevenlabs/models?purpose=${purpose}`,
        z.strictObject({
          models: z.array(VoiceProviderModelSchema),
          source: z.string().optional(),
        }),
        signal,
      );
      if (value.models.some((model) => model.kind !== purpose))
        throw new Error("El modelo no corresponde al propósito consultado.");
      return value.models;
    },
    voices(signal: AbortSignal, cursor?: string) {
      return read(
        `/api/v1/integrations/elevenlabs/voices?${new URLSearchParams({ limit: "100", ...(cursor === undefined ? {} : { cursor }) })}`,
        VoiceProviderVoicesPageSchema,
        signal,
      );
    },
    async mutate(
      intent: VoiceIntent,
      signal: AbortSignal,
    ): Promise<VoiceResult> {
      const session = await bootstrap();
      const built = buildVoiceRequest({ intent, csrfToken: session.csrfToken });
      const response = await request(built.path, { ...built.init, signal });
      const value = await json(response);
      switch (intent.kind) {
        case "confirmVariety":
        case "proposeVariety": {
          const settings = checked(value, VoiceConfigSnapshotSchema);
          const etag = voiceConfigEtag(intent.runId, settings.config.revision);
          if (response.headers.get("etag") !== etag)
            throw new Error("La revisión recibida no coincide.");
          return { kind: "settings", document: { value: settings, etag } };
        }
        case "draft": {
          const draft = checked(value, SpeechBindingDraftSchema);
          if (
            voiceOwnerKey(draft.owner) !== voiceOwnerKey(intent.owner) ||
            draft.ttsModelId !== intent.ttsModelId
          )
            throw new Error(
              "El candidato no corresponde a la identidad o modelo solicitado.",
            );
          return { kind: "draft", draft };
        }
        case "listen": {
          const result = checked(
            value,
            z.strictObject({
              artifactId: key,
              principal: z.string(),
              listenedAt: z.iso.datetime(),
            }),
          );
          if (result.artifactId !== intent.artifactId)
            throw new Error("La escucha pertenece a otro artefacto.");
          return { kind: "listened", artifactId: result.artifactId };
        }
        case "accept": {
          if (intent.verdict === "reject") {
            const result = checked(value, RejectedSchema);
            if (result.bindingDraftId !== intent.bindingDraftId)
              throw new Error("El rechazo pertenece a otro candidato.");
            return result;
          }
          const accepted = checked(value, AcceptedSchema);
          if (
            response.headers.get("etag") !==
            voiceConfigEtag(intent.runId, accepted.settings.config.revision)
          )
            throw new Error("La revisión aceptada no coincide.");
          return { kind: "accepted", value: accepted };
        }
        default: {
          const op = checked(value, VoiceOperationSchema);
          if ("runId" in intent && op.runId !== intent.runId)
            throw new Error("La operación pertenece a otra representación.");
          if (
            ("operationId" in intent &&
              intent.kind !== "saveVoice" &&
              op.operationId !== intent.operationId) ||
            response.headers.get("etag") !== voiceOperationEtag(op)
          )
            throw new Error("La operación recibida no coincide.");
          return { kind: "operation", operation: op };
        }
      }
    },
  };
}
export type VoiceClient = ReturnType<typeof createVoiceClient>;
