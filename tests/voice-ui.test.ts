import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  VoiceOperationSchema,
  VoiceArtifactSchema,
} from "../src/domain/voice.ts";
import {
  buildVoiceRequest,
  captureVoiceIntent,
  createVoiceClient,
} from "../src/web/voice-client.ts";
import { VoiceMedia } from "../src/web/VoiceMedia.tsx";
import {
  VoiceOperationStatus,
  VoiceWorkspace,
} from "../src/web/VoiceWorkspace.tsx";
const runId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const previewId = "33333333-3333-4333-8333-333333333333";
function design() {
  return captureVoiceIntent({
    kind: "design",
    runId,
    key,
    configRevision: 4,
    request: {
      owner: { kind: "character", id: "maxwell-smart" },
      sampleText:
        "Una muestra original escrita por la persona que opera esta puesta, preparada para probar claridad y una voz propia sin copiar el diálogo de la obra.",
      sampleOrigin: { kind: "operator-entered" },
      voiceDescription:
        "Una voz clara y expresiva en español rioplatense, cuya descripción revisa la persona operadora.",
      modelId: "eleven_ttv_v3",
      language: "es",
      originalSampleConfirmed: true,
      descriptionReviewed: true,
    },
  });
}

test("Voice Design request requires original/reviewed sample and preserves exact CAS/key on recovery", () => {
  const intent = design();
  const request = buildVoiceRequest({ intent, csrfToken: "local-csrf" });
  assert.equal(request.path, `/api/v1/runs/${runId}/voice-designs`);
  assert.equal(request.init.headers["If-Match"], `"voice-config:${runId}:r4"`);
  assert.equal(request.init.headers["Idempotency-Key"], key);
  assert.equal(request.init.headers["X-CSRF-Token"], "local-csrf");
  assert.deepEqual(
    buildVoiceRequest({ intent, csrfToken: "local-csrf" }),
    request,
  );
  const body = JSON.parse(request.init.body);
  assert.equal(body.originalSampleConfirmed, true);
  assert.equal(body.language, "es");
  assert.equal(body.sampleOrigin.kind, "operator-entered");
  assert.throws(() =>
    captureVoiceIntent({
      ...intent,
      request: { ...body, originalSampleConfirmed: false },
    }),
  );
  assert.throws(() =>
    captureVoiceIntent({ ...intent, request: { ...body, sampleText: "" } }),
  );
});

test("selection, saving, listening and acceptance are distinct writes and never include credentials", () => {
  const selected = buildVoiceRequest({
    intent: captureVoiceIntent({
      kind: "select",
      operationId: key,
      operationRevision: 2,
      key,
      previewId,
    }),
    csrfToken: "csrf",
  });
  assert.equal(selected.path, `/api/v1/voice-designs/${key}/selection`);
  assert.equal(selected.init.method, "PUT");
  assert.deepEqual(JSON.parse(selected.init.body), { previewId });
  const saved = buildVoiceRequest({
    intent: captureVoiceIntent({
      kind: "saveVoice",
      operationId: key,
      operationRevision: 3,
      key,
      previewId,
      voiceName: "Mi voz",
      voiceDescription: "Descripción original de esta voz elegida.",
    }),
    csrfToken: "csrf",
  });
  assert.equal(saved.path, `/api/v1/voice-previews/${previewId}/save`);
  assert.equal(saved.init.headers["If-Match"], `"voice-operation:${key}:r3"`);
  const acceptance = buildVoiceRequest({
    intent: captureVoiceIntent({
      kind: "accept",
      runId,
      configRevision: 4,
      key,
      bindingDraftId: key,
      artifactId: previewId,
      verdict: "accept",
    }),
    csrfToken: "csrf",
  });
  assert.deepEqual(JSON.parse(acceptance.init.body), {
    kind: "accept",
    artifactId: previewId,
  });
  assert.doesNotMatch(
    acceptance.init.body,
    /apiKey|voiceDescription|sampleText/,
  );
});

test("voice media uses only stored same-origin artifact, displays transcript and never auto plays", () => {
  const artifact = VoiceArtifactSchema.parse({
    artifactId: previewId,
    operationId: key,
    kind: "binding-test",
    state: "available",
    sourceId: key,
    text: "<script>texto original</script>",
    textHash: "a".repeat(64),
    textRevision: 4,
    configRevision: 4,
    modelId: "eleven_multilingual_v2",
    bindingId: null,
    mediaType: "audio/wav",
    byteLength: 44,
    hash: "b".repeat(64),
    providerAudioHash: "c".repeat(64),
    providerOutputFormat: "pcm_16000",
    durationSeconds: null,
    subtitles: { kind: "unverified", text: "<script>texto original</script>" },
  });
  const html = renderToStaticMarkup(
    React.createElement(VoiceMedia, { artifact }),
  );
  assert.match(html, /preload="none"/);
  assert.match(html, new RegExp(`/api/v1/voice-artifacts/${previewId}/media`));
  assert.doesNotMatch(html, /autoplay|<script>/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /alineación de subtítulos no está verificada/);
});

test("opening voice workspace renders empty operator samples and blocks paid actions before metadata", () => {
  const html = renderToStaticMarkup(
    React.createElement(VoiceWorkspace, { runId }),
  );
  assert.match(html, /muestra debe ser original/);
  assert.match(html, /Guardar una voz|binding validado/);
  assert.match(html, /<textarea[^>]*><\/textarea>/);
  assert.doesNotMatch(html, /api_key|xi-api-key/i);
  assert.match(html, /disabled=""[^>]*>Solicitar previews/);
  const operation = VoiceOperationSchema.parse({
    operationId: key,
    principal: "local-operator",
    runId,
    kind: "design-preview",
    configRevision: 4,
    modelId: "eleven_ttv_v3",
    state: "uncertain",
    revision: 2,
    createdAt: "2026-10-14T12:00:00Z",
    updatedAt: "2026-10-14T12:00:01Z",
    artifactIds: [],
    previewIds: [],
    selectedPreviewId: null,
    savedVoiceId: null,
    safeCode: "PROVIDER_UNCERTAIN",
    cost: { kind: "unknown" },
  });
  assert.match(
    renderToStaticMarkup(
      React.createElement(VoiceOperationStatus, { operation }),
    ),
    /no se repite automáticamente/,
  );
});

test("voice operation receipt rejects another run instead of treating it as accepted audio", async () => {
  const op = VoiceOperationSchema.parse({
    operationId: key,
    principal: "local-operator",
    runId: "44444444-4444-4444-8444-444444444444",
    kind: "design-preview",
    configRevision: 4,
    modelId: "eleven_ttv_v3",
    state: "queued",
    revision: 0,
    createdAt: "2026-10-14T12:00:00Z",
    updatedAt: "2026-10-14T12:00:00Z",
    artifactIds: [],
    previewIds: [],
    selectedPreviewId: null,
    savedVoiceId: null,
    safeCode: null,
    cost: { kind: "unknown" },
  });
  const api = createVoiceClient(
    async () =>
      new Response(JSON.stringify(op), {
        status: 202,
        headers: { ETag: `"voice-operation:${key}:r0"` },
      }),
    async () => ({ csrfToken: "csrf", expiresAt: "2026-10-14T13:00:00Z" }),
  );
  await assert.rejects(
    () => api.mutate(design(), new AbortController().signal),
    /otra representación/,
  );
});
