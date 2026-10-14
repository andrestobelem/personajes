import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireHostOwnership } from "../src/adapters/host-ownership.ts";
import { createElevenLabsClient } from "../src/adapters/elevenlabs.ts";
import { openVoiceCredentialStore } from "../src/application/voice-credentials.ts";
import { openVoiceService } from "../src/application/voice-service.ts";
import { voiceHash } from "../src/application/voice-hash.ts";
import {
  VoiceConfigSchema,
  SpanishVarietySchema,
  buildVoiceSubtitles,
} from "../src/domain/voice.ts";

const sample =
  "Este texto original se ofrece para escuchar una voz española clara, diferenciada y apropiada para varias intenciones de una ficción compartida.";
const tone = spawnSync("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=0.2",
  "-f",
  "mp3",
  "pipe:1",
]);
if (tone.status !== 0) throw new Error("Local ffmpeg fixture unavailable");
const audio = tone.stdout;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "personajes-voice-"));
  const ownership = acquireHostOwnership({ privateDataRoot: root });
  let config = VoiceConfigSchema.parse({
    revision: 0,
    spanishVariety: {
      kind: "confirmed",
      label: "español rioplatense",
      source: "operator",
      confirmedBy: "operator",
      confirmedAt: new Date().toISOString(),
    },
    audioMode: {
      kind: "enabled",
      language: "es",
      ttsMode: "manual-per-publication",
      ttsModelId: "speech-model",
      outputFormat: "mp3_44100_128",
      subtitles: true,
    },
    speakerSlots: { max: { kind: "enabled-unbound" } },
    narratorSlot: { kind: "absent" },
    soundEffectSlots: { fang: { kind: "disabled" } },
  });
  let credential = true;
  let designCalls = 0;
  let ttsCalls = 0;
  let sfxCalls = 0;
  let designMode: "success" | "timeout" = "success";
  let release: (() => void) | null = null;
  let waiting = false;
  const requests: { path: string; body: unknown }[] = [];
  const client = createElevenLabsClient({
    getApiKey: () => (credential ? "private-secret" : undefined),
    transport: async (url, options) => {
      const path = String(url);
      const body = options?.body ? JSON.parse(String(options.body)) : null;
      requests.push({ path, body });
      if (path.includes("/models"))
        return Response.json([
          {
            model_id: "speech-model",
            name: "Speech",
            can_do_text_to_speech: true,
            languages: [{ language_id: "es", name: "Spanish" }],
          },
        ]);
      if (path.includes("/voices"))
        return Response.json({
          voices: [
            {
              voice_id: "provider-voice",
              name: "Voz de prueba",
              description: "Descripción",
              labels: { language: "es" },
            },
          ],
          has_more: false,
          next_page_token: null,
        });
      if (path.includes("/text-to-voice/design")) {
        designCalls++;
        if (designMode === "timeout") throw new Error("raw private-secret");
        if (waiting)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return Response.json({
          previews: [
            {
              generated_voice_id: "generated-one",
              audio_base_64: audio.toString("base64"),
              media_type: "audio/mpeg",
              duration_secs: 1,
              language: "es",
            },
            {
              generated_voice_id: "generated-two",
              audio_base_64: audio.toString("base64"),
              media_type: "audio/mpeg",
              duration_secs: 1,
              language: "es",
            },
          ],
        });
      }
      if (path.includes("/text-to-voice"))
        return Response.json({ voice_id: "provider-voice" });
      if (path.includes("/text-to-speech")) {
        ttsCalls++;
        return Response.json({
          audio_base64: path.includes("output_format=pcm_")
            ? Buffer.alloc(4800).toString("base64")
            : audio.toString("base64"),
          alignment: {
            characters: Array.from(body.text),
            character_start_times_seconds: Array.from(body.text).map(
              (_, i) => i / 1000,
            ),
            character_end_times_seconds: Array.from(body.text).map(
              (_, i) => (i + 1) / 1000,
            ),
          },
        });
      }
      if (path.includes("/sound-generation")) {
        sfxCalls++;
        return new Response(audio, {
          headers: { "content-type": "audio/mpeg" },
        });
      }
      throw new Error("unexpected fixture path");
    },
  });
  const publication = {
    publicationId: "published-dialogue",
    runId: "run",
    text: "¿Conocés Fibonacci?",
    textHash: voiceHash("¿Conocés Fibonacci?"),
    textRevision: 1,
    configRevision: 0,
    owner: { kind: "character" as const, id: "max" },
    committedAt: new Date().toISOString(),
    sequence: 1,
  };
  const options = {
    privateDataRoot: root,
    ownerToken: ownership.ownerToken,
    client,
    hasCredential: () => credential,
    readConfig: () => config,
    readPublication: () => publication,
    speakableIds: () => ["max"],
    quotaLimits: () => ({ voiceDesignCalls: 4, ttsCalls: 4, sfxCalls: 4 }),
  };
  let service = openVoiceService(options);
  return {
    get service() {
      return service;
    },
    get config() {
      return config;
    },
    setConfig: (next: unknown) => {
      config = VoiceConfigSchema.parse(next);
    },
    credential: (next: boolean) => {
      credential = next;
    },
    designMode: (mode: "success" | "timeout") => {
      designMode = mode;
    },
    wait: () => {
      waiting = true;
    },
    release: () => {
      if (!release) throw new Error("fixture not waiting");
      release();
    },
    get calls() {
      return { designCalls, ttsCalls, sfxCalls };
    },
    requests,
    root,
    click: (revision = config.revision) => ({
      operationId: randomUUID(),
      principal: "operator",
      runId: "run",
      expectedRevision: revision,
    }),
    design: () => ({
      owner: { kind: "character", id: "max" },
      sampleText: sample,
      sampleOrigin: { kind: "operator-entered" },
      voiceDescription:
        "Una voz original en español rioplatense clara y natural.",
      modelId: "eleven_ttv_v3",
      language: "es",
      originalSampleConfirmed: true,
      descriptionReviewed: true,
    }),
    reopen: () => {
      service.close();
      service = openVoiceService(options);
    },
    cleanup: () => {
      service.close();
      ownership.release();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
async function bind(f: ReturnType<typeof fixture>) {
  const draft = await f.service.createBindingDraft(f.click(), {
    owner: { kind: "character", id: "max" },
    source: { kind: "providerVoice", providerVoiceId: "provider-voice" },
    ttsModelId: "speech-model",
  });
  const op = f.service.requestBindingTest(f.click(), draft.bindingDraftId, {
    sampleText: sample,
    sampleOrigin: { kind: "operator-entered" },
  });
  const ready = await f.service.execute(op.operationId);
  const artifactId = ready.artifactIds[0];
  assert.ok(artifactId);
  f.service.recordListened({
    artifactId,
    principal: "operator",
    idempotencyKey: randomUUID(),
  });
  const accepted = f.service.acceptBinding(f.click(), {
    kind: "accept",
    bindingDraftId: draft.bindingDraftId,
    artifactId,
  });
  assert.equal(accepted.kind, "accepted");
  if (accepted.kind !== "accepted") throw new Error("unreachable");
  f.setConfig({
    ...f.config,
    speakerSlots: {
      max: {
        kind: "enabled-bound",
        speechBindingId: accepted.binding.speechBindingId,
      },
    },
  });
  return accepted.binding;
}

test("canonical variety rejects invented authority combinations and extra fields", () => {
  assert.equal(
    SpanishVarietySchema.safeParse({
      kind: "proposed",
      source: "operator",
      label: "español",
    }).success,
    false,
  );
  assert.equal(
    SpanishVarietySchema.safeParse({
      kind: "confirmed",
      source: "operator",
      label: "español",
      confirmedBy: "operator",
      confirmedAt: new Date().toISOString(),
      token: "secret",
    }).success,
    false,
  );
});
test("subtitles preserve exact Unicode text and reject invented timestamps", () => {
  const text = "¡Hola, qué tal!";
  const chars = Array.from(text);
  const cues = buildVoiceSubtitles(
    text,
    {
      kind: "verified",
      characters: chars,
      startTimesSeconds: chars.map((_, i) => i / 1000),
      endTimesSeconds: chars.map((_, i) => (i + 1) / 1000),
    },
    7,
  );
  assert.equal(cues.kind, "verified");
  if (cues.kind === "verified")
    assert.equal(cues.cues.map((c) => c.text).join(""), text);
  assert.equal(
    buildVoiceSubtitles(text, {
      kind: "verified",
      characters: chars,
      startTimesSeconds: chars.map(() => 0),
      endTimesSeconds: chars.map(() => -1),
    }).kind,
    "unverified",
  );
});
test("unconfirmed variety blocks design with zero provider calls; nonverbal SFX has separate gate", async () => {
  const f = fixture();
  try {
    f.setConfig({
      ...f.config,
      spanishVariety: {
        kind: "proposed",
        label: "español rioplatense",
        source: "editorial-proposal",
      },
    });
    await assert.rejects(
      f.service.requestDesign(f.click(), f.design()),
      /SPANISH_VARIETY_UNCONFIRMED/,
    );
    assert.equal(f.calls.designCalls, 0);
    const sfx = f.service.requestSoundEffect(f.click(), {
      text: "Ladrido canino breve no verbal",
      modelId: "eleven_text_to_sound_v2",
      originalNonverbalReviewed: true,
    });
    assert.equal((await f.service.execute(sfx.operationId)).state, "ready");
    assert.equal(f.calls.sfxCalls, 1);
  } finally {
    f.cleanup();
  }
});
test("preview selection and remote save remain separate and idempotent", async () => {
  const f = fixture();
  try {
    const click = f.click();
    const op = await f.service.requestDesign(click, f.design());
    assert.equal(
      (await f.service.requestDesign(click, f.design())).operationId,
      op.operationId,
    );
    const ready = await f.service.execute(op.operationId);
    assert.equal(ready.previewIds.length, 2);
    const previewId = ready.previewIds[0];
    assert.ok(previewId);
    assert.throws(
      () =>
        f.service.savePreview(f.click(), {
          previewId,
          voiceName: "Voz",
          voiceDescription: f.design().voiceDescription,
        }),
      /NOT_SELECTED/,
    );
    const preview = f.service.getPreview(previewId, "operator");
    f.service.recordListened({
      artifactId: preview.artifactId,
      principal: "operator",
      idempotencyKey: randomUUID(),
    });
    f.service.recordListened({
      artifactId: f.service.getPreview(previewId, "operator").artifactId,
      principal: "operator",
      idempotencyKey: randomUUID(),
    });
    const selected = f.service.selectPreview({
      operationId: ready.operationId,
      principal: "operator",
      expectedOperationRevision: ready.revision,
      previewId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(selected.selectedPreviewId, previewId);
    const save = f.service.savePreview(f.click(), {
      previewId,
      voiceName: "Voz",
      voiceDescription: f.design().voiceDescription,
    });
    assert.equal(f.service.listSavedVoices().length, 0);
    await f.service.execute(save.operationId);
    assert.equal(
      f.service.listSavedVoices()[0]?.providerVoiceId,
      "provider-voice",
    );
    f.setConfig({ ...f.config, revision: 1 });
    assert.equal(
      (await f.service.requestDesign(click, f.design())).operationId,
      op.operationId,
    );
    assert.equal(f.calls.designCalls, 1);
  } finally {
    f.cleanup();
  }
});
test("uncertain POST never retries on execute, restart, or local reconcile", async () => {
  const f = fixture();
  try {
    f.designMode("timeout");
    const op = await f.service.requestDesign(f.click(), f.design());
    const failed = await f.service.execute(op.operationId);
    assert.equal(failed.state, "uncertain");
    assert.equal(JSON.stringify(failed).includes("private-secret"), false);
    await f.service.execute(op.operationId);
    f.reopen();
    await f.service.drain();
    assert.equal(f.calls.designCalls, 1);
    await assert.rejects(
      f.service.reconcileLocal(op.operationId, "operator"),
      /NO_RESPONSE/,
    );
    assert.equal(f.service.budget("run").voiceDesignCalls?.used, 1);
  } finally {
    f.cleanup();
  }
});
test("restart does not dispatch queued provider work automatically", async () => {
  const f = fixture();
  try {
    const op = await f.service.requestDesign(f.click(), f.design());
    f.reopen();
    assert.equal(
      f.service.getOperation(op.operationId, "operator").state,
      "blocked",
    );
    await f.service.drain();
    assert.equal(f.calls.designCalls, 0);
  } finally {
    f.cleanup();
  }
});
test("late cancelled preview response becomes orphaned and never playable", async () => {
  const f = fixture();
  try {
    const op = await f.service.requestDesign(f.click(), f.design());
    const promise = f.service.execute(op.operationId);
    for (
      let count = 0;
      count < 1000 &&
      f.service.getOperation(op.operationId, "operator").state !==
        "response-received";
      count++
    )
      await new Promise((resolve) => setImmediate(resolve));
    const submitted = f.service.getOperation(op.operationId, "operator");
    assert.equal(submitted.state, "response-received");
    f.service.cancel({
      operationId: op.operationId,
      principal: "operator",
      expectedOperationRevision: submitted.revision,
      idempotencyKey: randomUUID(),
    });
    const result = await promise;
    assert.equal(result.state, "orphaned");
    assert.ok(result.artifactIds[0]);
    assert.throws(
      () => f.service.readMedia(result.artifactIds[0] ?? "", "operator"),
      /UNAVAILABLE/,
    );
    assert.equal(f.service.budget("run").voiceDesignCalls?.used, 1);
  } finally {
    f.cleanup();
  }
});
test("binding demands exact listened test and freezes provenance; TTS exact publication survives credential removal", async () => {
  const f = fixture();
  try {
    await bind(f);
    const click = f.click();
    const op = f.service.requestPublicationAudio(
      click,
      "published-dialogue",
      "operator",
    );
    const ready = await f.service.execute(op.operationId);
    assert.equal(ready.state, "ready");
    const request = f.requests.find(
      (r) =>
        r.path.includes("/text-to-speech") &&
        JSON.stringify(r.body).includes("Fibonacci"),
    );
    assert.ok(request);
    assert.equal(
      (request.body as { text: string }).text,
      "¿Conocés Fibonacci?",
    );
    const artifactId = ready.artifactIds[0];
    assert.ok(artifactId);
    const artifact = f.service.readArtifact(artifactId, "operator");
    assert.equal(artifact.kind, "publication");
    assert.equal(artifact.subtitles.kind, "verified");
    f.credential(false);
    f.reopen();
    assert.deepEqual(f.service.readMedia(artifactId, "operator").bytes, audio);
    assert.equal(f.calls.ttsCalls, 2);
  } finally {
    f.cleanup();
  }
});
test("Fang and unknown identities cannot acquire a speech binding", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.service.createBindingDraft(f.click(), {
        owner: { kind: "character", id: "fang" },
        source: { kind: "providerVoice", providerVoiceId: "provider-voice" },
        ttsModelId: "speech-model",
      }),
      /NOT_SPEAKABLE/,
    );
    assert.equal(f.calls.ttsCalls, 0);
  } finally {
    f.cleanup();
  }
});
test("audio off retains text and does not call provider", () => {
  const f = fixture();
  try {
    f.setConfig({ ...f.config, audioMode: { kind: "disabled" } });
    assert.throws(
      () =>
        f.service.requestPublicationAudio(
          f.click(),
          "published-dialogue",
          "operator",
        ),
      /AUDIO_DISABLED/,
    );
    assert.equal(f.calls.ttsCalls, 0);
  } finally {
    f.cleanup();
  }
});
test("automatic generation rejects historical publication from another config revision", async () => {
  const f = fixture();
  try {
    await bind(f);
    f.setConfig({
      ...f.config,
      revision: 1,
      audioMode: {
        ...f.config.audioMode,
        kind: "enabled",
        language: "es",
        ttsMode: "automatic-after-publication",
        ttsModelId: "speech-model",
        outputFormat: "mp3_44100_128",
        subtitles: true,
      },
    });
    assert.throws(
      () =>
        f.service.requestPublicationAudio(
          f.click(),
          "published-dialogue",
          "after-commit",
        ),
      /BACKFILL/,
    );
  } finally {
    f.cleanup();
  }
});
test("private media authorization and retention preserve metadata hash", async () => {
  const f = fixture();
  try {
    const op = await f.service.requestDesign(f.click(), f.design());
    const ready = await f.service.execute(op.operationId);
    const artifactId = ready.artifactIds[0];
    assert.ok(artifactId);
    assert.throws(
      () => f.service.readMedia(artifactId, "another-principal"),
      /FORBIDDEN/,
    );
    const expired = f.service.expireArtifact({
      artifactId,
      principal: "operator",
    });
    assert.equal(expired.state, "artifact-unavailable");
    assert.equal(expired.hash, voiceHash(audio));
    assert.throws(
      () => f.service.readMedia(artifactId, "operator"),
      /UNAVAILABLE/,
    );
  } finally {
    f.cleanup();
  }
});

test("local persistence failure reconciles private staging after restart without new POST", async () => {
  const f = fixture();
  try {
    const op = await f.service.requestDesign(f.click(), f.design());
    rmSync(join(f.root, "media"), { recursive: true });
    const failed = await f.service.execute(op.operationId);
    assert.equal(failed.state, "response-received");
    f.reopen();
    mkdirSync(join(f.root, "media"), { recursive: true, mode: 0o700 });
    const ready = await f.service.reconcileLocal(op.operationId, "operator");
    assert.equal(ready.state, "ready");
    assert.equal(ready.artifactIds.length, 2);
    assert.equal(f.calls.designCalls, 1);
  } finally {
    f.cleanup();
  }
});
test("design quota blocks only design; cancelled before dispatch releases reservation", async () => {
  const f = fixture();
  try {
    const ops = [];
    for (let i = 0; i < 4; i++)
      ops.push(await f.service.requestDesign(f.click(), f.design()));
    await assert.rejects(
      f.service.requestDesign(f.click(), f.design()),
      /QUOTA_EXHAUSTED/,
    );
    const first = ops[0];
    assert.ok(first);
    f.service.cancel({
      operationId: first.operationId,
      principal: "operator",
      expectedOperationRevision: first.revision,
      idempotencyKey: randomUUID(),
    });
    assert.equal(f.service.budget("run").voiceDesignCalls?.remaining, 1);
    await f.service.requestDesign(f.click(), f.design());
    assert.equal(f.calls.designCalls, 0);
    assert.equal(
      f.service.requestSoundEffect(f.click(), {
        text: "Un ladrido no verbal",
        modelId: "eleven_text_to_sound_v2",
        originalNonverbalReviewed: true,
      }).state,
      "queued",
    );
  } finally {
    f.cleanup();
  }
});
test("credential store returns boolean status, rejects oversized secrets without echo and isolates file", () => {
  const root = mkdtempSync(join(tmpdir(), "personajes-auth-"));
  try {
    const store = openVoiceCredentialStore({ privateAuthRoot: root });
    assert.equal(store.status().credentialConfigured, false);
    store.replace({ apiKey: "secret-eleven-key" });
    assert.equal(store.getApiKey(), "secret-eleven-key");
    assert.equal(JSON.stringify(store.status()).includes("secret"), false);
    assert.throws(
      () => store.replace({ apiKey: "secret".repeat(1000) }),
      /VOICE_CREDENTIAL_INVALID/,
    );
    assert.ok(
      readFileSync(join(root, "elevenlabs-auth.json"), "utf8").includes(
        "secret-eleven-key",
      ),
    );
    store.remove();
    assert.equal(store.getApiKey(), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("PCM provider output becomes lossless playable WAV with source hash and finite duration", async () => {
  const f = fixture();
  try {
    await bind(f);
    f.setConfig({
      ...f.config,
      audioMode: {
        kind: "enabled",
        language: "es",
        ttsMode: "manual-per-publication",
        ttsModelId: "speech-model",
        outputFormat: "pcm_24000",
        subtitles: true,
      },
    });
    const op = f.service.requestPublicationAudio(
      f.click(),
      "published-dialogue",
      "operator",
    );
    const ready = await f.service.execute(op.operationId);
    assert.equal(ready.state, "ready");
    const id = ready.artifactIds[0];
    assert.ok(id);
    const media = f.service.readMedia(id, "operator");
    assert.equal(media.artifact.mediaType, "audio/wav");
    assert.equal(media.bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(media.artifact.providerOutputFormat, "pcm_24000");
    assert.equal(
      media.artifact.providerAudioHash,
      voiceHash(Buffer.alloc(4800)),
    );
    assert.equal(media.artifact.durationSeconds, 0.1);
  } finally {
    f.cleanup();
  }
});
test("shutdown aborts pending provider, preserves consumed quota, prevents later dispatch, and settles before close", async () => {
  const f = fixture();
  try {
    f.wait();
    const op = await f.service.requestDesign(f.click(), f.design());
    const pending = f.service.execute(op.operationId);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      f.service.getOperation(op.operationId, "operator").state,
      "submitted",
    );
    await f.service.shutdown();
    await pending;
    f.release();
    f.reopen();
    assert.equal(
      f.service.getOperation(op.operationId, "operator").state,
      "cancelled",
    );
    assert.equal(f.service.budget("run").voiceDesignCalls?.used, 1);
    assert.equal(f.calls.designCalls, 1);
  } finally {
    f.cleanup();
  }
});

test("backup voice barrier suspends admission without closing DB; inventory verifies registered private media", async () => {
  const f = fixture();
  try {
    const op = await f.service.requestDesign(f.click(), f.design());
    const ready = await f.service.execute(op.operationId);
    assert.throws(() => f.service.backupArtifacts(), /BARRIER_REQUIRED/);
    const release = await f.service.suspendAdmissions();
    try {
      await assert.rejects(
        f.service.requestDesign(f.click(), f.design()),
        /SERVICE_STOPPING/,
      );
      assert.equal(await f.service.drain(), 0);
      const media = f.service.backupArtifacts();
      assert.equal(media.length, 2);
      assert.ok(
        media.every(
          (file) =>
            file.path.startsWith("media/") && file.path.endsWith(".bin"),
        ),
      );
      assert.equal(
        f.service.getOperation(ready.operationId, "operator").state,
        "ready",
      );
    } finally {
      release();
      release();
    }
    assert.equal(f.calls.designCalls, 1);
    await f.service.requestDesign(f.click(), f.design());
    assert.equal(f.calls.designCalls, 1);
  } finally {
    f.cleanup();
  }
});
