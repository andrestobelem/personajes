import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DirectorObservationListSchema, RunStageViewSchema } from "../src/domain/run-observation.ts";
import { StageMap } from "../src/web/StageMap.tsx";
import {
  ConversationMessage,
  StageJobs,
} from "../src/web/StageConversation.tsx";
import {
  stageMapData,
  effectiveInterventionLifecycle,
  HistoricalLifecycleNotice,
} from "../src/web/RunStageWorkspace.tsx";
import { createRunObservationClient } from "../src/web/run-observation-client.ts";
import { DirectorObservationsPanel } from "../src/web/DirectorObservationsPanel.tsx";
import {
  fictionalDateKey,
  formatFictionalClock,
} from "../src/web/stage-format.ts";
import { stageFixture, conversationFixture } from "./fixtures/run-stage.ts";

test("public SVG and accessible index preserve confirmed geometry and held inventory without fabricated positions", () => {
  const stage = stageFixture();
  const data = stageMapData(stage);
  const html = renderToStaticMarkup(React.createElement(StageMap, { data }));
  assert.match(html, /Plano de Sala/);
  assert.match(html, /Índice accesible de entidades/);
  assert.match(html, /posición 2, 3/);
  assert.match(html, /En inventario de Identidad visible/);
  assert.equal(
    data.entities.find((entity) => entity.label === "Objeto llevado")?.location,
    null,
  );
  assert.match(html, /Sin posición independiente/);
  assert.doesNotMatch(html, /draggable/);
});

test("public conversation separates emission, null reception and memory delivery while escaping hostile text", () => {
  const stage = stageFixture();
  const item = conversationFixture();
  const html = renderToStaticMarkup(
    React.createElement(ConversationMessage, {
      item,
      clock: stage.clock,
      onSelectEvent: () => {},
    }),
  );
  assert.match(html, /Emisión/);
  assert.match(html, /Confirmada/);
  assert.match(html, /Recepción efectiva en el Escenario/);
  assert.match(html, /Nadie recibió/);
  assert.match(html, /No hay entregas a memoria registradas/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(
    renderToStaticMarkup(
      React.createElement(StageJobs, { items: [], more: false }),
    ),
    /no son diálogo, silencio/,
  );
});

test("fictional dates use recorded offset and IANA zone rather than machine timezone", () => {
  const clock = stageFixture().clock;
  assert.equal(fictionalDateKey(clock), "1969-12-31");
  assert.match(formatFictionalClock(clock), /1969-12-31 21:00:00/);
  assert.equal(
    fictionalDateKey({
      ...clock,
      convention: { kind: "ianaZone", zone: "America/Buenos_Aires" },
    }),
    "1969-12-31",
  );
});

test("historical stage labels lifecycle as current operational state", () => {
  const html = renderToStaticMarkup(React.createElement(HistoricalLifecycleNotice, { lifecycle: "paused" }));
  assert.match(html, /Estado operativo actual: en pausa/);
  assert.match(html, /No se reconstruye al corte histórico/);
});

test("observation client only reads, scopes history fence and rejects another representation", async () => {
  const stage = stageFixture();
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const request: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify(stage), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const api = createRunObservationClient(request, async () => ({
    csrfToken: "session-token",
    expiresAt: "2026-10-14T12:00:00Z",
  }));
  assert.deepEqual(
    await api.stage(stage.runId, new AbortController().signal, 8),
    stage,
  );
  assert.equal(
    requests[0]?.url,
    `/api/v1/runs/${stage.runId}/stage?atWorldSeq=8`,
  );
  assert.deepEqual(await api.stage(stage.runId, new AbortController().signal, { commitIndex: 9 }), stage);
  assert.equal(requests[1]?.url, `/api/v1/runs/${stage.runId}/stage?atCommitIndex=9`);
  assert.equal(requests[0]?.init?.method, undefined);
  await assert.rejects(
    () =>
      api.stage(
        "88888888-8888-4888-8888-888888888888",
        new AbortController().signal,
      ),
    /otro corte/,
  );
  await assert.rejects(
    () => api.stage(stage.runId, new AbortController().signal, 7),
    /otro corte/,
  );
});

test("Director panel keeps the observation and its acceptance time in historical view", () => {
  const progress = DirectorObservationListSchema.parse({
    kind: "director-observation-list", runId: stageFixture().runId, throughWorldSeq: 8, throughCommitIndex: 12,
    items: [{ annotationId: "88888888-8888-4888-8888-888888888888", worldRevision: 12, worldSeq: 8, commitIndex: 12, acceptedAt: 1792000000000,
      evidenceEventReferences: [{ eventId: "99999999-9999-4999-8999-999999999999", worldSeq: 7, commitIndex: 11 }],
      observation: { kind: "director-observation", stage: "planteamiento",
        assessment: { kind: "sufficient", reason: "La propuesta cambia la situación colectiva.", evidenceEventIds: ["99999999-9999-4999-8999-999999999999"] },
        affectedCharacterIds: ["maxwell-smart"], openQuestions: ["¿Aceptará 99 participar?"], revision: { kind: "initial" } } }],
  });
  const html = renderToStaticMarkup(React.createElement(DirectorObservationsPanel, { progress, onSelectEvidence: () => undefined }));
  assert.match(html, /Planteamiento · evidencia suficiente/);
  assert.match(html, /La propuesta cambia la situación colectiva/);
  assert.match(html, /Eventos citados/);
  assert.match(html, /Ver evento · secuencia 7 · commit 11/);
  assert.match(html, /¿Aceptará 99 participar\?/);
  assert.match(html, /aceptada el/);
  assert.doesNotMatch(html, /contextHash|systemPrompt|session/);
  const historical = renderToStaticMarkup(React.createElement(DirectorObservationsPanel, { progress, historical: true, onSelectEvidence: () => undefined }));
  assert.match(historical, /Lectura retrospectiva/);
  assert.match(historical, /La fecha de aceptación no forma parte del tiempo ficticio/);
  assert.match(historical, /La propuesta cambia la situación colectiva/);
  assert.match(historical, /Se refiere al commit 12/);
  assert.match(historical, /Ver evento · secuencia 7 · commit 11/);
});

test("observation client reads the operator-facing Director projection", async () => {
  const progress = DirectorObservationListSchema.parse({ kind: "director-observation-list", runId: stageFixture().runId, throughWorldSeq: 0, throughCommitIndex: 0, items: [] });
  const requests: string[] = [];
  const request: typeof fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify(progress), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const api = createRunObservationClient(request, async () => ({ csrfToken: "session-token", expiresAt: "2026-10-14T12:00:00Z" }));
  assert.deepEqual(await api.directorObservations(progress.runId, new AbortController().signal, 0), progress);
  assert.equal(requests[0], `/api/v1/runs/${progress.runId}/director-observations?atCommitIndex=0`);
});

test("SVG connection diagram exposes door state and textual route without claiming physical door coordinates", () => {
  const stage = stageFixture();
  const room = stage.places[0];
  assert.ok(room);
  const expanded = RunStageViewSchema.parse({
    ...stage,
    places: [...stage.places, { ...room, id: "pasillo", name: "Pasillo" }],
    doors: [
      {
        id: "99999999-9999-4999-8999-999999999999",
        label: "Puerta del pasillo",
        state: "locked",
      },
    ],
    connections: [
      {
        from: room.id,
        to: "pasillo",
        doorId: "99999999-9999-4999-8999-999999999999",
        arrivalPoint: { x: 2, y: 2 },
        durationMs: 500,
      },
    ],
  });
  const html = renderToStaticMarkup(
    React.createElement(StageMap, { data: stageMapData(expanded) }),
  );
  assert.match(html, /Esquema de conexiones y puertas/);
  assert.match(html, /sin asignarles posiciones físicas/);
  assert.match(html, /Puerta del pasillo: Bloqueada/);
  assert.match(html, /Ver lugar conectado/);
});

test("known paused state blocks composer immediately while its stage projection is still running", async () => {
  const { HumanInteractionPanel } = await import(
    "../src/web/HumanInteractionPanel.tsx"
  );
  const lifecycle = effectiveInterventionLifecycle("running", "paused");
  const html = renderToStaticMarkup(
    React.createElement(HumanInteractionPanel, {
      runId: stageFixture().runId,
      participants: [],
      lifecycle,
    }),
  );
  assert.match(
    html,
    /debe estar en ejecución para enviar una intervención nueva/,
  );
  assert.match(html, /<button disabled="">Enviar intervención/);
  assert.equal(effectiveInterventionLifecycle("paused", "running"), "paused");
  assert.equal(effectiveInterventionLifecycle("running", "running"), "running");
});
