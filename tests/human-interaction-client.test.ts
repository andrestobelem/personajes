import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHumanRequest,
  captureHumanIntent,
  createHumanInteractionClient,
} from "../src/web/human-interaction-client.ts";
import { HumanInterventionRequestSchema } from "../src/domain/interaction-schema.ts";
const runId = "11111111-1111-4111-8111-111111111111";
const participantId = "visitante-prueba";
const key = "33333333-3333-4333-8333-333333333333";
test("captured speech preserves immutable payload/key and excludes participant authority from body", () => {
  const request = HumanInterventionRequestSchema.parse({
    kind: "speech",
    channelId: key,
    recipientCharacterIds: [],
    content: { kind: "speech", text: "Hola" },
  });
  const intent = captureHumanIntent({
    kind: "speech",
    runId,
    participantId,
    key,
    etag: `"world:${runId}:r2"`,
    request,
  });
  request.content.text = "Changed";
  const built = buildHumanRequest(intent, "csrf");
  assert.equal(JSON.parse(built.init.body).content.text, "Hola");
  assert.equal("participantId" in JSON.parse(built.init.body), false);
  assert.equal(built.init.headers["If-Match"], `"world:${runId}:r2"`);
  assert.equal(built.init.headers["Idempotency-Key"], key);
  assert.deepEqual(buildHumanRequest(intent, "csrf"), built);
});
test("client rejects a context from another run even with matching revision", async () => {
  const api = createHumanInteractionClient(
    async () =>
      new Response(
        JSON.stringify({
          kind: "human-interaction-context",
          runId: participantId,
          worldRevision: 2,
          worldSeq: 3,
          fictionalAt: 0,
          scene: { id: key, label: "Scene" },
          place: { id: key, label: "Place" },
          channel: { id: key, label: "Voice", scope: "broadcast" },
          recipients: [],
        }),
        { headers: { etag: `"world:${runId}:r2"` } },
      ),
  );
  await assert.rejects(api.context(runId));
});
test("mode writes preserve session CAS without identity fields in observer mode", () => {
  const built = buildHumanRequest(
    { kind: "mode", mode: { kind: "observer" }, etag: '"session:r4"', key },
    "csrf",
  );
  assert.equal(built.path, "/api/v1/session/mode");
  assert.equal(built.init.method, "PUT");
  assert.equal(built.init.headers["X-CSRF-Token"], "csrf");
  assert.equal(built.init.headers["If-Match"], '"session:r4"');
  assert.deepEqual(JSON.parse(built.init.body), { kind: "observer" });
});

test("SSR does not enable speech before confirmed session/context and explains absent human identities", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { HumanInteractionPanel } = await import(
    "../src/web/HumanInteractionPanel.tsx"
  );
  const html = renderToStaticMarkup(
    React.createElement(HumanInteractionPanel, {
      runId,
      participants: [],
      lifecycle: "running",
    }),
  );
  assert.match(html, /No hay identidades humanas configuradas/);
  assert.match(html, /El texto no concede autoridad/);
  assert.match(html, /Texto de tu intervención/);
  assert.match(html, /<button disabled="">Enviar intervención/);
  assert.doesNotMatch(html, /Intervención confirmada/);
});

test("paused, stopped and closed composer preserves editable draft surface but blocks new speech", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { HumanInteractionPanel } = await import(
    "../src/web/HumanInteractionPanel.tsx"
  );
  for (const lifecycle of ["paused", "stopped", "closed"] satisfies Array<
    import("../src/domain/run-observation.ts").RunStageView["lifecycle"]
  >) {
    const html = renderToStaticMarkup(
      React.createElement(HumanInteractionPanel, {
        runId,
        participants: [],
        lifecycle,
      }),
    );
    assert.match(
      html,
      /debe estar en ejecución para enviar una intervención nueva/,
    );
    assert.match(html, /El borrador se conserva/);
    assert.doesNotMatch(html, /<textarea[^>]*disabled/);
    assert.match(html, /<button disabled="">Enviar intervención/);
  }
});

test("domain participant slug is preserved and invalid IDs cannot build a request", () => {
  const request = HumanInterventionRequestSchema.parse({
    kind: "speech",
    channelId: key,
    recipientCharacterIds: [],
    content: { kind: "speech", text: "Hola" },
  });
  const intent = {
    kind: "speech",
    runId,
    participantId,
    request,
    etag: `"world:${runId}:r1"`,
    key,
  } satisfies Parameters<typeof captureHumanIntent>[0];
  assert.equal(captureHumanIntent(intent).kind, "speech");
  const captured = captureHumanIntent(intent);
  if (captured.kind === "speech")
    assert.equal(captured.participantId, "visitante-prueba");
  assert.throws(() =>
    buildHumanRequest(
      { ...intent, participantId: "invalid participant/" },
      "csrf",
    ),
  );
});
