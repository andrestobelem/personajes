import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createElevenLabsClient,
  ElevenLabsError,
  validateElevenLabsAlignment,
} from "../src/adapters/elevenlabs.ts";

function fixture(payload: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const transport: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json(payload);
  };
  return {
    client: createElevenLabsClient({
      getApiKey: () => "private-fixture-key",
      transport,
    }),
    calls,
  };
}
test("ElevenLabs sends exact operator sample and dynamic previews; save is separate", async () => {
  const text = "Una muestra original elegida por el operador. ".repeat(4);
  const { client, calls } = fixture({
    previews: [
      {
        generated_voice_id: "generated-1",
        audio_base_64: "SUQzBAAA",
        media_type: "audio/mpeg",
        duration_secs: 1,
        language: "es",
      },
    ],
  });
  const result = await client.design({
    text,
    voiceDescription: "Una voz en español para un personaje ficticio.",
    modelId: "eleven_ttv_v3",
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.generatedVoiceId, "generated-1");
  assert.equal(calls.length, 1);
  const body: unknown = JSON.parse(String(calls[0]?.init?.body));
  assert.deepEqual(body, {
    text,
    voice_description: "Una voz en español para un personaje ficticio.",
    model_id: "eleven_ttv_v3",
    auto_generate_text: false,
    stream_previews: false,
  });
  assert.equal(calls[0]?.init?.redirect, "error");
  const saved = fixture({ voice_id: "saved-1" });
  assert.deepEqual(
    await saved.client.saveVoice({
      generatedVoiceId: "generated-1",
      voiceName: "Voz",
      voiceDescription: "Una voz ficticia original en español.",
    }),
    { voiceId: "saved-1" },
  );
  assert.equal(
    saved.calls[0]?.url,
    "https://api.elevenlabs.io/v1/text-to-voice",
  );
});
test("ElevenLabs blocks missing secret and invalid design before transport", async () => {
  let count = 0;
  const transport: typeof fetch = async () => {
    count++;
    return Response.json({});
  };
  await assert.rejects(
    createElevenLabsClient({
      getApiKey: () => undefined,
      transport,
    }).listModels(),
    { code: "missing-credential" },
  );
  await assert.rejects(
    createElevenLabsClient({ getApiKey: () => "secret", transport }).design({
      text: "short",
      voiceDescription: "short",
      modelId: "unknown",
    }),
    { code: "invalid-request" },
  );
  assert.equal(count, 0);
});
test("ElevenLabs preserves TTS text; invalid alignment downgrades without another POST", async () => {
  const text = "Sí.";
  const f = fixture({
    audio_base64: "SUQzBAAA",
    alignment: {
      characters: ["S", "i", "."],
      character_start_times_seconds: [0, 1, 2],
      character_end_times_seconds: [1, 2, 3],
    },
  });
  const result = await f.client.tts({
    text,
    voiceId: "voice-1",
    modelId: "eleven_v3",
    outputFormat: "mp3_44100_128",
  });
  assert.equal(result.alignment.kind, "unverified");
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(String(f.calls[0]?.init?.body)), {
    text,
    model_id: "eleven_v3",
  });
  assert.equal(
    validateElevenLabsAlignment(
      {
        characters: ["S", "í", "."],
        character_start_times_seconds: [0, 1, 2],
        character_end_times_seconds: [1, 2, 3],
      },
      text,
    ).kind,
    "verified",
  );
  assert.equal(
    validateElevenLabsAlignment(
      {
        characters: ["S", "í", "."],
        character_start_times_seconds: [0, 2, 1],
        character_end_times_seconds: [1, 3, 2],
      },
      text,
    ).kind,
    "unverified",
  );
});
test("ElevenLabs rejects malformed base64, non-Spanish preview and provider errors without disclosing secrets", async () => {
  for (const audio_base_64 of ["!!!!", "AB==", ""]) {
    const f = fixture({
      previews: [
        {
          generated_voice_id: "generated-1",
          audio_base_64,
          media_type: "audio/mpeg",
          duration_secs: 1,
          language: "es",
        },
      ],
    });
    await assert.rejects(
      f.client.design({
        text: "a".repeat(100),
        voiceDescription: "a".repeat(20),
        modelId: "eleven_ttv_v3",
      }),
      { code: "invalid-response" },
    );
  }
  let calls = 0;
  const client = createElevenLabsClient({
    getApiKey: () => "secret-value",
    transport: async () => {
      calls++;
      throw new Error("secret-value https://token@host");
    },
  });
  await assert.rejects(
    client.tts({
      text: "Hola",
      voiceId: "v",
      modelId: "m",
      outputFormat: "mp3_44100_128",
    }),
    (error) =>
      error instanceof ElevenLabsError &&
      error.code === "uncertain" &&
      !String(error).includes("secret-value"),
  );
  assert.equal(calls, 1);
  const denied = createElevenLabsClient({
    getApiKey: () => "secret",
    transport: async () =>
      new Response("private provider body", { status: 429 }),
  });
  await assert.rejects(denied.listModels(), {
    code: "provider-rejected",
    status: 429,
  });
});
test("ElevenLabs normalizes models and voice metadata, SFX is separate binary request", async () => {
  assert.deepEqual(
    await fixture([
      {
        model_id: "m",
        name: "Model",
        can_do_text_to_speech: true,
        languages: [{ language_id: "es", name: "Spanish" }],
      },
    ]).client.listModels(),
    [
      {
        modelId: "m",
        name: "Model",
        canDoTextToSpeech: true,
        languages: ["es"],
      },
    ],
  );
  let body: unknown;
  const client = createElevenLabsClient({
    getApiKey: () => "secret",
    transport: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(Buffer.from("ID3"), {
        headers: { "content-type": "audio/mpeg" },
      });
    },
  });
  assert.equal(
    (
      await client.soundEffect({
        text: "Ladrido no verbal",
        modelId: "eleven_text_to_sound_v2",
        durationSeconds: 1,
      })
    ).audio.length,
    3,
  );
  assert.deepEqual(body, {
    text: "Ladrido no verbal",
    model_id: "eleven_text_to_sound_v2",
    duration_seconds: 1,
  });
  await assert.rejects(
    client.soundEffect({
      text: "Efecto",
      modelId: "eleven_text_to_sound_v2",
      durationSeconds: 31,
    }),
    { code: "invalid-request" },
  );
});
test("ElevenLabs paginates v2 catalogue and forwards cancellation signal", async () => {
  const f = fixture({
    voices: [{ voice_id: "v", name: "Voz", labels: { language: "es" } }],
    has_more: true,
    next_page_token: "next",
  });
  const signal = new AbortController().signal;
  assert.deepEqual(
    await f.client.listVoices({ cursor: "before", limit: 2 }, { signal }),
    {
      voices: [
        { voiceId: "v", name: "Voz", description: "", languages: ["es"] },
      ],
      nextCursor: "next",
      hasMore: true,
    },
  );
  assert.equal(
    f.calls[0]?.url,
    "https://api.elevenlabs.io/v2/voices?page_size=2&next_page_token=before",
  );
  assert.equal(f.calls[0]?.init?.signal?.aborted, false);
});
test("ElevenLabs accepts empty preview list, limits count, signatures and bounded streams", async () => {
  const request = {
    text: "a".repeat(100),
    voiceDescription: "a".repeat(20),
    modelId: "eleven_ttv_v3",
  };
  assert.deepEqual(await fixture({ previews: [] }).client.design(request), []);
  const preview = {
    generated_voice_id: "v",
    audio_base_64: "SUQzBAAA",
    media_type: "audio/mpeg",
    duration_secs: 1,
  };
  await assert.rejects(
    fixture({
      previews: Array.from({ length: 33 }, () => preview),
    }).client.design(request),
    { code: "invalid-response" },
  );
  await assert.rejects(
    fixture({
      previews: [
        {
          ...preview,
          audio_base_64: Buffer.from("invalid bytes").toString("base64"),
        },
      ],
    }).client.design(request),
    { code: "invalid-response" },
  );
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const client = createElevenLabsClient({
    getApiKey: () => "key",
    transport: async () => new Response(stream),
  });
  await assert.rejects(client.listModels(), { code: "invalid-response" });
  assert.equal(cancelled, true);
  const small = createElevenLabsClient({
    getApiKey: () => "key",
    maxAudioBytes: 2,
    transport: async () =>
      new Response(Buffer.from("ID3"), {
        headers: { "content-type": "audio/mpeg" },
      }),
  });
  await assert.rejects(
    small.soundEffect({ text: "Efecto", modelId: "eleven_text_to_sound_v2" }),
    { code: "invalid-response" },
  );
});
test("ElevenLabs bounds stalled transport and body; POST timeout is uncertain without retry", async () => {
  assert.throws(
    () =>
      createElevenLabsClient({ getApiKey: () => "key", requestTimeoutMs: 999 }),
    { code: "invalid-request" },
  );
  let calls = 0;
  const stalled = createElevenLabsClient({
    getApiKey: () => "key",
    requestTimeoutMs: 1000,
    transport: async () => {
      calls++;
      return new Promise<Response>(() => {});
    },
  });
  const hold = setInterval(() => {}, 100);
  try {
    await assert.rejects(
      stalled.tts({
        text: "Hola",
        voiceId: "voice",
        modelId: "model",
        outputFormat: "mp3_44100_128",
      }),
      { code: "uncertain" },
    );
    assert.equal(calls, 1);
    const body = createElevenLabsClient({
      getApiKey: () => "key",
      requestTimeoutMs: 1000,
      transport: async () =>
        new Response(new ReadableStream<Uint8Array>({ start() {} })),
    });
    await assert.rejects(
      body.saveVoice({
        generatedVoiceId: "generated",
        voiceName: "Voice",
        voiceDescription: "Una descripción original de voz.",
      }),
      { code: "uncertain" },
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      stalled.listVoices({}, { signal: controller.signal }),
      { code: "invalid-request" },
    );
  } finally {
    clearInterval(hold);
  }
});
