import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const modelSchema = z.object({
  model_id: id,
  name: z.string(),
  can_do_text_to_speech: z.boolean(),
  languages: z.array(z.object({ language_id: z.string(), name: z.string() })),
});
const voiceSchema = z.object({
  voice_id: id,
  name: z.string(),
  description: z.string().nullable().optional(),
  labels: z.record(z.string(), z.string()).optional(),
});
export type ElevenLabsModel = {
  modelId: string;
  name: string;
  canDoTextToSpeech: boolean;
  languages: string[];
};
export type ElevenLabsVoice = {
  voiceId: string;
  name: string;
  description: string;
  languages: string[];
};
export type ElevenLabsAlignment =
  | {
      kind: "verified";
      characters: string[];
      startTimesSeconds: number[];
      endTimesSeconds: number[];
    }
  | { kind: "unverified" };
export type ElevenLabsAudio = {
  audio: Uint8Array;
  mediaType: string;
  alignment: ElevenLabsAlignment;
};
export type ElevenLabsPreview = ElevenLabsAudio & {
  generatedVoiceId: string;
  durationSeconds: number;
  language?: string;
};
export class ElevenLabsError extends Error {
  constructor(
    readonly code:
      | "missing-credential"
      | "invalid-request"
      | "provider-rejected"
      | "invalid-response"
      | "uncertain",
    readonly status?: number,
  ) {
    super(`ElevenLabs: ${code}`);
    this.name = "ElevenLabsError";
  }
}
const alignmentSchema = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number().finite().nonnegative()),
  character_end_times_seconds: z.array(z.number().finite().nonnegative()),
});
export function validateElevenLabsAlignment(
  value: unknown,
  text: string,
): ElevenLabsAlignment {
  const parsed = alignmentSchema.safeParse(value);
  if (!parsed.success) return { kind: "unverified" };
  const a = parsed.data;
  if (
    a.characters.join("") !== text ||
    a.characters.length !== a.character_start_times_seconds.length ||
    a.characters.length !== a.character_end_times_seconds.length
  )
    return { kind: "unverified" };
  for (let i = 0; i < a.characters.length; i++) {
    const start = a.character_start_times_seconds[i];
    const end = a.character_end_times_seconds[i];
    const prior = a.character_start_times_seconds[i - 1];
    if (
      start === undefined ||
      end === undefined ||
      end < start ||
      (prior !== undefined && start < prior)
    )
      return { kind: "unverified" };
  }
  return {
    kind: "verified",
    characters: a.characters,
    startTimesSeconds: a.character_start_times_seconds,
    endTimesSeconds: a.character_end_times_seconds,
  };
}
export function createElevenLabsClient(options: {
  getApiKey: () => string | undefined;
  transport?: typeof fetch;
  maxAudioBytes?: number;
  requestTimeoutMs?: number;
}) {
  const transport = options.transport ?? fetch;
  const maximum = options.maxAudioBytes ?? 16 * 1024 * 1024;
  function parse<T>(
    schema: z.ZodType<T>,
    input: unknown,
    code: "invalid-request" | "invalid-response",
  ): T {
    const result = schema.safeParse(input);
    if (!result.success) throw new ElevenLabsError(code);
    return result.data;
  }
  const timeout = options.requestTimeoutMs ?? 30000;
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 300000)
    throw new ElevenLabsError("invalid-request");
  const responseMethods = new WeakMap<Response, "GET" | "POST">();
  const responseSignals = new WeakMap<Response, AbortSignal>();
  async function abortable<T>(
    promise: Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) throw new Error("aborted");
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new Error("aborted"));
      signal.addEventListener("abort", abort, { once: true });
      promise
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    });
  }
  const maximumJson = 64 * 1024 * 1024;
  async function readBounded(
    response: Response,
    limit: number,
  ): Promise<Uint8Array> {
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
      await response.body?.cancel();
      throw new ElevenLabsError("invalid-response");
    }
    if (!response.body) throw new ElevenLabsError("invalid-response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const signal = responseSignals.get(response);
        const part =
          signal === undefined
            ? await reader.read()
            : await abortable(reader.read(), signal);
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new ElevenLabsError("invalid-response");
        }
        chunks.push(part.value);
      }
    } catch (error) {
      void reader.cancel().catch(() => {});
      if (error instanceof ElevenLabsError) throw error;
      throw new ElevenLabsError(
        responseMethods.get(response) === "POST"
          ? "uncertain"
          : "invalid-response",
      );
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, size);
  }
  function signature(bytes: Uint8Array, mediaType: string): void {
    const b = Buffer.from(bytes);
    const valid =
      mediaType === "audio/pcm"
        ? b.length > 0 && b.length % 2 === 0
        : mediaType === "audio/wav"
          ? b.length >= 12 &&
            b.toString("ascii", 0, 4) === "RIFF" &&
            b.toString("ascii", 8, 12) === "WAVE"
          : b.length >= 3 &&
            (b.toString("ascii", 0, 3) === "ID3" ||
              (b[0] === 255 && b[1] !== undefined && (b[1] & 224) === 224));
    if (!valid) throw new ElevenLabsError("invalid-response");
  }
  function audio(base64: string, mediaType: string): Uint8Array {
    if (
      !base64.length ||
      base64.length > Math.ceil(maximum / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        base64,
      )
    )
      throw new ElevenLabsError("invalid-response");
    const bytes = Buffer.from(base64, "base64");
    if (
      !bytes.length ||
      bytes.length > maximum ||
      bytes.toString("base64") !== base64
    )
      throw new ElevenLabsError("invalid-response");
    signature(bytes, mediaType);
    return bytes;
  }
  async function request(
    path: string,
    body?: unknown,
    control?: { signal?: AbortSignal },
  ): Promise<Response> {
    const key = options.getApiKey();
    if (!key) throw new ElevenLabsError("missing-credential");
    const timerSignal = AbortSignal.timeout(timeout);
    const signal =
      control?.signal === undefined
        ? timerSignal
        : AbortSignal.any([timerSignal, control.signal]);
    if (signal.aborted) throw new ElevenLabsError("invalid-request");
    let response: Response;
    try {
      response = await abortable(
        transport(`https://api.elevenlabs.io${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { "xi-api-key": key, "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: "error",
          signal,
        }),
        signal,
      );
    } catch {
      throw new ElevenLabsError(
        body === undefined ? "invalid-response" : "uncertain",
      );
    }
    responseSignals.set(response, signal);
    responseMethods.set(response, body === undefined ? "GET" : "POST");
    if (!response.ok)
      throw new ElevenLabsError("provider-rejected", response.status);
    return response;
  }
  async function json(
    path: string,
    body?: unknown,
    control?: { signal?: AbortSignal },
  ): Promise<unknown> {
    const response = await request(path, body, control);
    const bytes = await readBounded(response, maximumJson);
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new ElevenLabsError("invalid-response");
    }
  }
  return {
    async listModels(): Promise<ElevenLabsModel[]> {
      return parse(
        z.array(modelSchema),
        await json("/v1/models"),
        "invalid-response",
      ).map((v) => ({
        modelId: v.model_id,
        name: v.name,
        canDoTextToSpeech: v.can_do_text_to_speech,
        languages: v.languages.map((l) => l.language_id),
      }));
    },
    async listVoices(
      input: { cursor?: string; limit?: number } = {},
      control?: { signal?: AbortSignal },
    ): Promise<{
      voices: ElevenLabsVoice[];
      nextCursor: string | null;
      hasMore: boolean;
    }> {
      const p = parse(
        z.object({
          cursor: z.string().min(1).max(1000).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        }),
        input,
        "invalid-request",
      );
      const query = new URLSearchParams({ page_size: String(p.limit ?? 100) });
      if (p.cursor) query.set("next_page_token", p.cursor);
      const page = parse(
        z.object({
          voices: z.array(voiceSchema).max(100),
          has_more: z.boolean(),
          next_page_token: z.string().nullable().optional(),
        }),
        await json(`/v2/voices?${query}`, undefined, control),
        "invalid-response",
      );
      if (page.has_more && !page.next_page_token)
        throw new ElevenLabsError("invalid-response");
      return {
        voices: page.voices.map((v) => ({
          voiceId: v.voice_id,
          name: v.name,
          description: v.description ?? "",
          languages: v.labels?.language ? [v.labels.language] : [],
        })),
        nextCursor: page.next_page_token ?? null,
        hasMore: page.has_more,
      };
    },
    async design(
      input: { text: string; voiceDescription: string; modelId: string },
      control?: { signal?: AbortSignal },
    ): Promise<ElevenLabsPreview[]> {
      const p = parse(
        z.object({
          text: z.string().min(100).max(1000),
          voiceDescription: z.string().min(20).max(1000),
          modelId: z.enum(["eleven_multilingual_ttv_v2", "eleven_ttv_v3"]),
        }),
        input,
        "invalid-request",
      );
      const result = parse(
        z.object({
          previews: z
            .array(
              z.object({
                generated_voice_id: id,
                audio_base_64: z.string(),
                media_type: z.enum([
                  "audio/mpeg",
                  "audio/mp3",
                  "audio/wav",
                  "audio/pcm",
                ]),
                duration_secs: z.number().finite().positive(),
                language: z.string().optional(),
              }),
            )
            .max(32),
        }),
        await json(
          "/v1/text-to-voice/design",
          {
            text: p.text,
            voice_description: p.voiceDescription,
            model_id: p.modelId,
            auto_generate_text: false,
            stream_previews: false,
          },
          control,
        ),
        "invalid-response",
      );
      let aggregate = 0;
      return result.previews.map((v) => {
        if (v.language !== undefined && v.language !== "es")
          throw new ElevenLabsError("invalid-response");
        return {
          generatedVoiceId: v.generated_voice_id,
          audio: (() => {
            const bytes = audio(v.audio_base_64, v.media_type);
            aggregate += bytes.length;
            if (aggregate > maximumJson)
              throw new ElevenLabsError("invalid-response");
            return bytes;
          })(),
          mediaType: v.media_type,
          durationSeconds: v.duration_secs,
          ...(v.language === undefined ? {} : { language: v.language }),
          alignment: { kind: "unverified" },
        };
      });
    },
    async saveVoice(
      input: {
        generatedVoiceId: string;
        voiceName: string;
        voiceDescription: string;
      },
      control?: { signal?: AbortSignal },
    ): Promise<{ voiceId: string }> {
      const p = parse(
        z.object({
          generatedVoiceId: id,
          voiceName: z.string().min(1).max(200),
          voiceDescription: z.string().min(20).max(1000),
        }),
        input,
        "invalid-request",
      );
      const result = parse(
        z.object({ voice_id: id }),
        await json(
          "/v1/text-to-voice",
          {
            generated_voice_id: p.generatedVoiceId,
            voice_name: p.voiceName,
            voice_description: p.voiceDescription,
          },
          control,
        ),
        "invalid-response",
      );
      return { voiceId: result.voice_id };
    },
    async tts(
      input: {
        text: string;
        voiceId: string;
        modelId: string;
        outputFormat: string;
      },
      control?: { signal?: AbortSignal },
    ): Promise<ElevenLabsAudio> {
      const p = parse(
        z.object({
          text: z.string().min(1).max(40000),
          voiceId: id,
          modelId: id,
          outputFormat: z.enum([
            "mp3_44100_128",
            "mp3_44100_64",
            "mp3_44100_192",
            "mp3_22050_32",
            "pcm_16000",
            "pcm_22050",
            "pcm_24000",
            "pcm_44100",
            "pcm_48000",
          ]),
        }),
        input,
        "invalid-request",
      );
      const result = parse(
        z.object({
          audio_base64: z.string(),
          alignment: z.unknown().optional(),
        }),
        await json(
          `/v1/text-to-speech/${encodeURIComponent(p.voiceId)}/with-timestamps?output_format=${p.outputFormat}`,
          { text: p.text, model_id: p.modelId },
          control,
        ),
        "invalid-response",
      );
      return {
        audio: audio(
          result.audio_base64,
          p.outputFormat.startsWith("mp3") ? "audio/mpeg" : "audio/pcm",
        ),
        mediaType: p.outputFormat.startsWith("mp3")
          ? "audio/mpeg"
          : "audio/pcm",
        alignment: validateElevenLabsAlignment(result.alignment, p.text),
      };
    },
    async soundEffect(
      input: {
        text: string;
        modelId: string;
        durationSeconds?: number;
        promptInfluence?: number;
      },
      control?: { signal?: AbortSignal },
    ): Promise<ElevenLabsAudio> {
      const p = parse(
        z.object({
          text: z.string().min(1).max(1000),
          modelId: z.literal("eleven_text_to_sound_v2"),
          durationSeconds: z.number().finite().min(0.5).max(30).optional(),
          promptInfluence: z.number().finite().min(0).max(1).optional(),
        }),
        input,
        "invalid-request",
      );
      const response = await request(
        "/v1/sound-generation",
        {
          text: p.text,
          model_id: p.modelId,
          ...(p.durationSeconds === undefined
            ? {}
            : { duration_seconds: p.durationSeconds }),
          ...(p.promptInfluence === undefined
            ? {}
            : { prompt_influence: p.promptInfluence }),
        },
        control,
      );
      if (!(response.headers.get("content-type") ?? "").startsWith("audio/"))
        throw new ElevenLabsError("invalid-response");
      const bytes = await readBounded(response, maximum);
      if (!bytes.length || bytes.length > maximum)
        throw new ElevenLabsError("invalid-response");
      signature(bytes, "audio/mpeg");
      return {
        audio: bytes,
        mediaType: "audio/mpeg",
        alignment: { kind: "unverified" },
      };
    },
  };
}
export type ElevenLabsClient = ReturnType<typeof createElevenLabsClient>;
