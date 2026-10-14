import { z } from "zod";
import {
  VoiceConfigSnapshotSchema,
  VoiceQuotaLimitsSchema,
  VoiceOperationSchema,
  VoiceArtifactSchema,
  SoundBindingSchema,
} from "../domain/voice.ts";
import { ApiProblemSchema } from "../domain/http.ts";
import { bootstrapSession } from "./client.ts";
export const VoiceStatusSchema = z.strictObject({
  credentialConfigured: z.boolean(),
  safeCode: z.string().nullable(),
});
export const VoiceQuotaSchema = VoiceQuotaLimitsSchema;
export const VoiceSettingsSnapshotSchema = VoiceConfigSnapshotSchema;
export type VoiceSettingsDocument = {
  snapshot: z.infer<typeof VoiceSettingsSnapshotSchema>;
  etag: string;
};
export type VoiceAdminIntent = {
  path: string;
  method: "POST" | "PUT" | "DELETE";
  body: unknown;
  key: string;
  etag?: string | undefined;
};
export class VoiceAdminRejection extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function captureVoiceAdminIntent(
  value: VoiceAdminIntent,
): VoiceAdminIntent {
  return z
    .strictObject({
      path: z.string().regex(/^\/api\/v1\/[A-Za-z0-9/_-]+$/),
      method: z.enum(["POST", "PUT", "DELETE"]),
      body: z.json(),
      key: z.uuid(),
      etag: z.string().optional(),
    })
    .parse(value);
}
export function buildVoiceAdminRequest(
  intent: VoiceAdminIntent,
  csrfToken: string,
) {
  intent = captureVoiceAdminIntent(intent);
  if (
    !/^\/api\/v1\/(integrations\/elevenlabs|runs\/[^/]+|voice-artifacts\/[^/]+|sound-effect-previews)(\/|$)/.test(
      intent.path,
    )
  )
    throw new Error("Ruta de voz inválida");
  return {
    method: intent.method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
      "Idempotency-Key": intent.key,
      ...(intent.etag === undefined ? {} : { "If-Match": intent.etag }),
    },
    body: JSON.stringify(intent.body),
  } satisfies RequestInit;
}
export function createVoiceAdminClient(
  request: typeof fetch = (url, init) => fetch(url, init),
  bootstrap = bootstrapSession,
) {
  async function read<T>(
    path: string,
    schema: z.ZodType<T>,
    intent?: VoiceAdminIntent,
  ) {
    const session = await bootstrap();
    const response = await request(
      path,
      intent
        ? buildVoiceAdminRequest(intent, session.csrfToken)
        : { credentials: "same-origin" },
    );
    const data: unknown = await response.json();
    if (!response.ok) {
      const problem = ApiProblemSchema.safeParse(data);
      if (
        problem.success &&
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408
      )
        throw new VoiceAdminRejection(
          response.status,
          `${problem.data.error.message} Referencia: ${problem.data.requestId}.`,
        );
      throw new Error(
        "La operación no se confirmó. Consultá el estado antes de reintentar.",
      );
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success)
      throw new Error(
        "La respuesta administrativa de audio no tiene el formato esperado.",
      );
    return { data: parsed.data, response };
  }
  async function settings(
    runId: string,
    intent?: VoiceAdminIntent,
  ): Promise<VoiceSettingsDocument> {
    const result = await read(
      `/api/v1/runs/${encodeURIComponent(runId)}/voice-settings`,
      VoiceSettingsSnapshotSchema,
      intent,
    );
    const etag = result.response.headers.get("etag");
    if (etag !== `"voice-config:${runId}:r${result.data.config.revision}"`)
      throw new Error("Revisión de voz inválida");
    return { snapshot: result.data, etag };
  }
  return {
    settings,
    async status() {
      return (
        await read("/api/v1/integrations/elevenlabs/status", VoiceStatusSchema)
      ).data;
    },
    async credential(intent: VoiceAdminIntent) {
      return (await read(intent.path, VoiceStatusSchema, intent)).data;
    },
    async probe(intent: VoiceAdminIntent) {
      return (
        await read(
          intent.path,
          z.strictObject({
            kind: z.literal("connectionCheck"),
            state: z.literal("passed"),
          }),
          intent,
        )
      ).data;
    },
    async operation(id: string) {
      return (
        await read(
          `/api/v1/voice-operations/${encodeURIComponent(z.uuid().parse(id))}`,
          VoiceOperationSchema,
        )
      ).data;
    },
    async generate(intent: VoiceAdminIntent) {
      return (await read(intent.path, VoiceOperationSchema, intent)).data;
    },
    async artifact(id: string) {
      return (
        await read(
          `/api/v1/voice-artifacts/${encodeURIComponent(z.uuid().parse(id))}`,
          VoiceArtifactSchema,
        )
      ).data;
    },
    async listened(intent: VoiceAdminIntent) {
      return (
        await read(
          intent.path,
          z.strictObject({
            artifactId: z.uuid(),
            principal: z.string(),
            listenedAt: z.iso.datetime(),
          }),
          intent,
        )
      ).data;
    },
    async saveSound(intent: VoiceAdminIntent) {
      return (await read(intent.path, SoundBindingSchema, intent)).data;
    },
    async bindSound(intent: VoiceAdminIntent) {
      return (await read(intent.path, VoiceSettingsSnapshotSchema, intent))
        .data;
    },
  };
}
