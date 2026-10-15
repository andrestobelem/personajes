import { z } from "zod";
import { operatorJson, OperatorResponseSchema } from "./operator-extension.ts";
import type {
  OperatorExtension,
  OperatorRequest,
} from "./operator-extension.ts";
import {
  VoiceDesignRequestSchema,
  VoiceTestRequestSchema,
  SoundEffectRequestSchema,
} from "../domain/voice.ts";
import {
  VoiceSettingsRequestSchema,
  voiceConfigEtag,
} from "../application/voice-config-store.ts";
import type { VoiceConfigStore } from "../application/voice-config-store.ts";
import type { VoiceService } from "../application/voice-service.ts";
import type { openVoiceCredentialStore } from "../application/voice-credentials.ts";
import type { ElevenLabsClient } from "../adapters/elevenlabs.ts";

export function createVoiceRoutes(input: {
  service: VoiceService;
  config: VoiceConfigStore;
  credentials: ReturnType<typeof openVoiceCredentialStore>;
  client: ElevenLabsClient;
  wakeWorker: () => void;
  readVoiceOwners?: (runId: string) => unknown;
  readSoundOwners?: (runId: string) => unknown;
}): OperatorExtension {
  function configRevision(request: OperatorRequest, runId: string) {
    const match = /^"voice-config:([^:]+):r(\d+)"$/.exec(request.ifMatch ?? "");
    if (!match || match[1] !== runId)
      throw new Error("VOICE_IF_MATCH_REQUIRED");
    return z.number().int().nonnegative().safe().parse(Number(match[2]));
  }
  function opRevision(request: OperatorRequest, operationId: string) {
    const match = /^"voice-operation:([^:]+):r(\d+)"$/.exec(
      request.ifMatch ?? "",
    );
    if (!match || match[1] !== operationId)
      throw new Error("VOICE_IF_MATCH_REQUIRED");
    return z.number().int().nonnegative().safe().parse(Number(match[2]));
  }
  function opResponse(op: ReturnType<VoiceService["getOperation"]>) {
    return operatorJson(op, 202, {
      ETag: `"voice-operation:${op.operationId}:r${op.revision}"`,
      Location: `/api/v1/voice-operations/${op.operationId}`,
    });
  }
  function queue(op: ReturnType<VoiceService["getOperation"]>) {
    input.wakeWorker();
    return opResponse(op);
  }
  function click(
    request: Extract<OperatorRequest, { kind: "write" }>,
    runId: string,
  ) {
    return {
      operationId: request.idempotencyKey,
      principal: request.principalId,
      runId,
      expectedRevision: configRevision(request, runId),
    };
  }
  return {
    name: "voice",
    matches({ path }) {
      return (
        path[0] === "voice-library" ||
        path[0] === "voice-operations" ||
        path[0] === "voice-designs" ||
        path[0] === "voice-previews" ||
        path[0] === "voice-artifacts" ||
        path[0] === "sound-effect-previews" ||
        (path[0] === "integrations" && path[1] === "elevenlabs") ||
        (path[0] === "runs" &&
          [
            "voice-settings",
            "voice-owners",
            "sound-owners",
            "spanish-variety",
            "voice-designs",
            "speech-binding-drafts",
            "sound-bindings",
            "audio",
            "voice-operations",
            "media",
          ].includes(path[2] ?? ""))
      );
    },
    async handle(request) {
      try {
        const path = request.path;
        const first = path[0];
        const id = path[1];
        const action = path[2];
        if (request.kind === "read") {
          if (first === "runs" && id && action === "sound-owners") {
            if (!input.readSoundOwners)
              throw new Error("VOICE_CONFIGURATION_MISSING");
            return operatorJson({ owners: input.readSoundOwners(id) });
          }

          if (
            first === "integrations" &&
            id === "elevenlabs" &&
            action === "status"
          )
            return operatorJson(input.credentials.status());
          if (
            first === "integrations" &&
            id === "elevenlabs" &&
            action === "models"
          ) {
            const purpose = z
              .enum(["voiceDesign", "speech", "soundEffect"])
              .parse(request.query.get("purpose"));
            if (purpose === "voiceDesign")
              return operatorJson({
                models: [
                  {
                    kind: "voiceDesign",
                    modelId: "eleven_multilingual_ttv_v2",
                  },
                  { kind: "voiceDesign", modelId: "eleven_ttv_v3" },
                ],
                source: "verified-provider-design-contract",
              });
            if (purpose === "soundEffect")
              return operatorJson({
                models: [
                  { kind: "soundEffect", modelId: "eleven_text_to_sound_v2" },
                ],
                source: "verified-provider-sound-contract",
              });
            return operatorJson({
              models: (await input.client.listModels()).map((model) => ({
                kind: "speech",
                ...model,
              })),
            });
          }
          if (
            first === "integrations" &&
            id === "elevenlabs" &&
            action === "voices"
          ) {
            const limit = z.coerce
              .number()
              .int()
              .min(1)
              .max(100)
              .parse(request.query.get("limit") ?? 100);
            const cursor = request.query.get("cursor");
            return operatorJson(
              await input.client.listVoices({
                limit,
                ...(cursor === null ? {} : { cursor }),
              }),
            );
          }
          if (first === "voice-library")
            return operatorJson(
              id
                ? (input.service
                    .listSavedVoices()
                    .find((voice) => voice.savedVoiceId === id) ?? null)
                : { voices: input.service.listSavedVoices() },
            );
          if (first === "voice-operations" && id) {
            const op = input.service.getOperation(id, request.principalId);
            return operatorJson(op, 200, {
              ETag: `"voice-operation:${op.operationId}:r${op.revision}"`,
            });
          }
          if (first === "voice-designs" && id) {
            const op = input.service.getOperation(id, request.principalId);
            return operatorJson(
              {
                operation: op,
                previews: op.previewIds.map((id) =>
                  input.service.getPreview(id, request.principalId),
                ),
              },
              200,
              { ETag: `"voice-operation:${op.operationId}:r${op.revision}"` },
            );
          }
          if (first === "voice-previews" && id) {
            const preview = input.service.getPreview(id, request.principalId);
            if (action !== "media") return operatorJson(preview);
            const media = input.service.readMedia(
              preview.artifactId,
              request.principalId,
            );
            return OperatorResponseSchema.parse({
              kind: "binary",
              status: 200,
              mimeType: media.artifact.mediaType,
              bytes: media.bytes,
              sha256: media.artifact.hash,
            });
          }
          if (first === "sound-effect-previews" && id && action === "media") {
            const media = input.service.readMedia(id, request.principalId);
            if (media.artifact.kind !== "sound-effect")
              throw new Error("VOICE_NOT_SOUND_EFFECT");
            return OperatorResponseSchema.parse({
              kind: "binary",
              status: 200,
              mimeType: media.artifact.mediaType,
              bytes: media.bytes,
              sha256: media.artifact.hash,
            });
          }
          if (first === "runs" && id && action === "media" && path[3]) {
            const media = input.service.readMedia(path[3], request.principalId);
            const op = input.service.getOperation(
              media.artifact.operationId,
              request.principalId,
            );
            if (op.runId !== id || media.artifact.kind !== "publication")
              throw new Error("VOICE_MEDIA_FORBIDDEN");
            return OperatorResponseSchema.parse({
              kind: "binary",
              status: 200,
              mimeType: media.artifact.mediaType,
              bytes: media.bytes,
              sha256: media.artifact.hash,
            });
          }
          if (first === "voice-artifacts" && id) {
            if (action === "media") {
              const media = input.service.readMedia(id, request.principalId);
              return OperatorResponseSchema.parse({
                kind: "binary",
                status: 200,
                mimeType: media.artifact.mediaType,
                bytes: media.bytes,
                sha256: media.artifact.hash,
              });
            }
            return operatorJson(
              input.service.readArtifact(id, request.principalId),
            );
          }
          if (first === "runs" && id && action === "voice-owners") {
            const owners = z
              .array(
                z
                  .object({
                    owner: z.discriminatedUnion("kind", [
                      z
                        .object({
                          kind: z.literal("character"),
                          id: z.string(),
                        })
                        .strict(),
                      z.object({ kind: z.literal("narrator") }).strict(),
                    ]),
                    label: z.string(),
                    speakable: z.literal(true),
                    recipe: z.string().optional(),
                  })
                  .strict(),
              )
              .max(101)
              .parse(input.readVoiceOwners?.(id) ?? []);
            return operatorJson({ owners });
          }
          if (first === "runs" && id && action === "voice-settings" && path[3] === "reconciliation" && path.length === 4) {
            let baseStale = false;
            let snapshot;
            try { snapshot = input.config.read(id); }
            catch (error) {
              if (!(error instanceof Error) || error.message !== "VOICE_BASE_CONFIGURATION_STALE") throw error;
              baseStale = true;
              snapshot = input.config.readUnreconciled(id);
            }
            return operatorJson({ kind: "voice-reconciliation-context", snapshot, baseStale }, 200, {
              ETag: voiceConfigEtag(id, snapshot.config.revision),
            });
          }
          if (first === "runs" && id && action === "voice-settings") {
            const snapshot = input.config.read(id);
            return operatorJson(snapshot, 200, {
              ETag: voiceConfigEtag(id, snapshot.config.revision),
            });
          }
          if (first === "runs" && id && action === "speech-binding-drafts") {
            const drafts = input.service.listBindingDrafts(
              id,
              request.principalId,
            );
            return operatorJson(
              path[3]
                ? (drafts.find((draft) => draft.bindingDraftId === path[3]) ??
                    null)
                : { drafts },
            );
          }
          if (first === "runs" && id && action === "voice-operations")
            return operatorJson({
              operations: input.service.listOperations(id, request.principalId),
            });
        } else {
          if (
            first === "integrations" &&
            id === "elevenlabs" &&
            action === "credential"
          ) {
            if (request.method === "PUT")
              return operatorJson(
                input.credentials.replaceOnce({
                  operationId: request.idempotencyKey,
                  raw: request.body,
                }),
              );
            if (request.method === "DELETE") {
              z.object({}).strict().parse(request.body);
              return operatorJson(
                input.credentials.removeOnce({
                  operationId: request.idempotencyKey,
                }),
              );
            }
            throw new Error("VOICE_METHOD_NOT_ALLOWED");
          }
          if (
            first === "integrations" &&
            id === "elevenlabs" &&
            action === "access-check"
          ) {
            z.object({ kind: z.literal("connectionCheck") })
              .strict()
              .parse(request.body);
            await input.client.listModels();
            return operatorJson({ kind: "connectionCheck", state: "passed" });
          }
          if (
            first === "runs" &&
            id &&
            action === "voice-settings" &&
            path[3] === "reconcile"
          ) {
            z.object({ kind: z.literal("reconcileBase") })
              .strict()
              .parse(request.body);
            const snapshot = input.config.reconcile(click(request, id));
            return operatorJson(snapshot, 200, {
              ETag: voiceConfigEtag(id, snapshot.config.revision),
            });
          }
          if (first === "runs" && id && action === "voice-settings") {
            const args = click(request, id);
            const settings = VoiceSettingsRequestSchema.parse(request.body);
            const snapshot = input.config.update({ ...args, settings });
            return operatorJson(snapshot, 200, {
              ETag: voiceConfigEtag(id, snapshot.config.revision),
            });
          }
          if (first === "runs" && id && action === "spanish-variety") {
            const label = z
              .object({ label: z.string().min(1).max(300) })
              .strict()
              .parse(request.body).label;
            const kind =
              path[3] === "confirm"
                ? "confirm"
                : path[3] === "proposal"
                  ? "propose"
                  : null;
            if (!kind) throw new Error("VOICE_ROUTE_NOT_FOUND");
            const snapshot = input.config.setVariety({
              ...click(request, id),
              kind,
              label,
            });
            return operatorJson(snapshot, 200, {
              ETag: voiceConfigEtag(id, snapshot.config.revision),
            });
          }
          if (first === "runs" && id && action === "voice-designs")
            return queue(
              await input.service.requestDesign(
                click(request, id),
                VoiceDesignRequestSchema.parse(request.body),
              ),
            );
          if (first === "voice-designs" && id && action === "selection") {
            const body = z
              .object({ previewId: z.uuid() })
              .strict()
              .parse(request.body);
            return opResponse(
              input.service.selectPreview({
                operationId: id,
                principal: request.principalId,
                expectedOperationRevision: opRevision(request, id),
                previewId: body.previewId,
                idempotencyKey: request.idempotencyKey,
              }),
            );
          }
          if (first === "voice-previews" && id && action === "save") {
            const body = z
              .object({
                voiceName: z.string().min(1).max(120),
                voiceDescription: z.string().min(20).max(1000),
              })
              .strict()
              .parse(request.body);
            const preview = input.service.getPreview(id, request.principalId);
            const design = input.service.getOperation(
              preview.operationId,
              request.principalId,
            );
            const sourceRevision = opRevision(request, design.operationId);
            return queue(
              input.service.savePreview(
                {
                  operationId: request.idempotencyKey,
                  principal: request.principalId,
                  runId: design.runId,
                  expectedRevision: design.configRevision,
                },
                { previewId: id, ...body },
                sourceRevision,
              ),
            );
          }
          if (
            first === "runs" &&
            id &&
            action === "speech-binding-drafts" &&
            !path[3]
          )
            return operatorJson(
              await input.service.createBindingDraft(
                click(request, id),
                request.body,
              ),
              201,
            );
          if (
            first === "runs" &&
            id &&
            action === "speech-binding-drafts" &&
            path[3] &&
            path[4] === "tests"
          )
            return queue(
              input.service.requestBindingTest(
                click(request, id),
                path[3],
                VoiceTestRequestSchema.parse(request.body),
              ),
            );
          if (
            first === "runs" &&
            id &&
            action === "speech-binding-drafts" &&
            path[3] &&
            path[4] === "acceptance"
          ) {
            const body = z
              .object({
                kind: z.enum(["accept", "reject"]),
                artifactId: z.uuid(),
              })
              .strict()
              .parse(request.body);
            const result = input.service.acceptBinding(click(request, id), {
              ...body,
              bindingDraftId: path[3],
            });
            if (result.kind === "accepted") {
              const snapshot = input.config.bindSpeech({
                ...click(request, id),
                speechBindingId: result.binding.speechBindingId,
              });
              return operatorJson({ result, settings: snapshot }, 200, {
                ETag: voiceConfigEtag(id, snapshot.config.revision),
              });
            }
            return operatorJson(result);
          }
          if (first === "voice-artifacts" && id && action === "listened") {
            z.object({ kind: z.literal("listened") })
              .strict()
              .parse(request.body);
            return operatorJson(
              input.service.recordListened({
                artifactId: id,
                principal: request.principalId,
                idempotencyKey: request.idempotencyKey,
              }),
            );
          }
          if (first === "voice-operations" && id && action === "cancel") {
            z.object({ kind: z.literal("cancel") })
              .strict()
              .parse(request.body);
            return opResponse(
              input.service.cancel({
                operationId: id,
                principal: request.principalId,
                expectedOperationRevision: opRevision(request, id),
                idempotencyKey: request.idempotencyKey,
              }),
            );
          }
          if (first === "voice-operations" && id && action === "reconcile") {
            z.object({ kind: z.literal("reconcileLocal") })
              .strict()
              .parse(request.body);
            return opResponse(
              await input.service.reconcileLocal(id, request.principalId),
            );
          }
          if (first === "runs" && id && action === "audio") {
            const body = z
              .object({
                publicationId: z.string().min(1),
                voiceConfigRevision: z.number().int().nonnegative(),
                format: z.string().min(1),
              })
              .strict()
              .parse(request.body);
            const args = click(request, id);
            const config = input.config.read(id).config;
            if (
              args.expectedRevision !== body.voiceConfigRevision ||
              config.audioMode.kind !== "enabled" ||
              config.audioMode.outputFormat !== body.format
            )
              throw new Error("VOICE_CONFIG_STALE");
            return queue(
              input.service.requestPublicationAudio(
                args,
                body.publicationId,
                "operator",
              ),
            );
          }
          if (first === "sound-effect-previews" && !id) {
            const body = z
              .object({
                runId: z.string().min(1),
                request: SoundEffectRequestSchema,
              })
              .strict()
              .parse(request.body);
            return queue(
              input.service.requestSoundEffect(
                {
                  operationId: request.idempotencyKey,
                  principal: request.principalId,
                  runId: body.runId,
                  expectedRevision: input.config.read(body.runId).config
                    .revision,
                },
                body.request,
              ),
            );
          }
          if (first === "sound-effect-previews" && id && action === "save") {
            const body = z
              .object({ runId: z.string().min(1), sourceId: z.string().min(1) })
              .strict()
              .parse(request.body);
            const args = click(request, body.runId);
            return operatorJson(
              input.service.saveSoundEffect(args, id, body.sourceId),
              201,
            );
          }
          if (first === "runs" && id && action === "sound-bindings") {
            const body = z
              .object({
                owner: z
                  .object({
                    kind: z.literal("character"),
                    characterId: z.string().min(1),
                  })
                  .strict(),
                assetId: z.uuid(),
              })
              .strict()
              .parse(request.body);
            const snapshot = input.config.bindSound({
              ...click(request, id),
              ownerId: body.owner.characterId,
              soundBindingId: body.assetId,
            });
            return operatorJson(snapshot, 200, {
              ETag: voiceConfigEtag(id, snapshot.config.revision),
            });
          }
        }
        throw new Error("VOICE_ROUTE_NOT_FOUND");
      } catch (error) {
        if (error instanceof z.ZodError)
          return OperatorResponseSchema.parse({
            kind: "problem",
            status: 400,
            error: {
              kind: "validation",
              code: "VOICE_INVALID_REQUEST",
              message: "Solicitud de voz inválida.",
              issues: error.issues.slice(0, 100).map((issue) => ({
                path: issue.path.filter(
                  (value) =>
                    typeof value === "string" || typeof value === "number",
                ),
                code: issue.code,
              })),
            },
          });
        const code =
          error instanceof Error &&
          /^VOICE_[A-Z_]+$|^SPANISH_VARIETY_UNCONFIRMED$|^ELEVENLABS_CREDENTIAL_MISSING$/.test(
            error.message,
          )
            ? error.message
            : "VOICE_DEPENDENCY_FAILED";
        const status = code.includes("STALE")
          ? 412
          : code.includes("FORBIDDEN")
            ? 403
            : code.includes("NOT_FOUND")
              ? 404
              : 409;
        return OperatorResponseSchema.parse({
          kind: "problem",
          status,
          error: {
            kind:
              status === 412
                ? "precondition"
                : status === 403
                  ? "forbidden"
                  : status === 404
                    ? "notFound"
                    : "conflict",
            code,
            message:
              "La operación de voz requiere revisar su configuración o estado.",
          },
        });
      }
    },
  };
}
