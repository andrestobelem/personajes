import assert from "node:assert/strict";
import { test } from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import {
  ConversationPageSchema,
  ConfirmedEventPageSchema,
  DirectorObservationListSchema,
  RunStageViewSchema,
  TechnicalJobPageSchema,
} from "../src/domain/run-observation.ts";
import type { RunRefresh } from "../src/domain/run-refresh.ts";
import { RunRefreshSchema } from "../src/domain/run-refresh.ts";
import type { RunObservationClient } from "../src/web/run-observation-client.ts";
import { stageFixture } from "./fixtures/run-stage.ts";

class ControlledEventSource extends EventTarget {
  static current: ControlledEventSource | undefined;

  constructor(readonly url: string) {
    super();
    ControlledEventSource.current = this;
  }

  emit(value: RunRefresh) {
    this.dispatchEvent(new MessageEvent("run.refresh", { data: JSON.stringify(value) }));
  }

  close() {}
}

function defineGlobal(name: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (previous === undefined) Reflect.deleteProperty(globalThis, name);
    else Object.defineProperty(globalThis, name, previous);
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("La promesa diferida no está inicializada."); };
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve: (value: T) => resolve(value) };
}

function refreshFor(stage: ReturnType<typeof stageFixture>): RunRefresh {
  return RunRefreshSchema.parse({
    kind: "run.refresh",
    runId: stage.runId,
    configRevision: stage.configRevision,
    worldRevision: stage.worldRevision,
    lifecycleRevision: 1,
    lastWorldSeq: stage.worldSeq,
  });
}

for (const live of [false, true]) test(`run.refresh recarga ${live ? "la representación en vivo" : "las proyecciones visibles"} y una respuesta anterior no revierte el corte`, async () => {
  const dom = new JSDOM(
    '<!doctype html><html><head><meta name="personajes-bootstrap" content="0123456789abcdefghijklmnopqrstuv"></head><body><div id="root"></div></body></html>',
    { url: "http://localhost/", pretendToBeVisual: true },
  );
  const restoreGlobals = [
    defineGlobal("window", dom.window),
    defineGlobal("document", dom.window.document),
    defineGlobal("navigator", dom.window.navigator),
    defineGlobal("HTMLElement", dom.window.HTMLElement),
    defineGlobal("Node", dom.window.Node),
    defineGlobal("DOMParser", dom.window.DOMParser),
    defineGlobal("MutationObserver", dom.window.MutationObserver),
    defineGlobal("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window)),
    defineGlobal("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window)),
    defineGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window)),
    defineGlobal("IS_REACT_ACT_ENVIRONMENT", true),
    defineGlobal("EventSource", ControlledEventSource),
    defineGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/api/v1/session")
        return Response.json({ csrfToken: "s".repeat(32), expiresAt: "2026-10-15T12:00:00Z" });
      return Response.json({ error: { message: "Fixture sin endpoint", requestId: "test" } }, { status: 404 });
    }),
  ];

  let unmount: (() => void) | undefined;
  try {
    const first = stageFixture();
    const olderStage = RunStageViewSchema.parse({
      ...first,
      places: [{ ...first.places[0]!, name: "Sala antigua" }],
    });
    const newerStage = RunStageViewSchema.parse({
      ...first,
      worldRevision: first.worldRevision + 1,
      worldSeq: first.worldSeq + 1,
      commitIndex: first.commitIndex + 1,
      places: [{ ...first.places[0]!, name: "Sala nueva" }],
    });
    const delayedOldResponse = deferred<ReturnType<typeof stageFixture>>();
    const calls = { stage: 0, conversations: 0, events: 0, jobs: 0, director: 0 };
    const api: RunObservationClient = {
      async stage() {
        calls.stage += 1;
        return calls.stage === 1 ? delayedOldResponse.promise.then((value) => RunStageViewSchema.parse(value)) : newerStage;
      },
      async conversations(input) {
        calls.conversations += 1;
        return ConversationPageSchema.parse({ kind: "conversation-page", runId: input.runId,
          fromWorldSeq: input.fromWorldSeq, toWorldSeq: input.toWorldSeq, lastWorldSeq: input.toWorldSeq,
          nextCursor: null, items: [] });
      },
      async events(input) {
        calls.events += 1;
        return ConfirmedEventPageSchema.parse({ kind: "confirmed-event-page", runId: input.runId,
          fromWorldSeq: input.fromWorldSeq, toWorldSeq: input.toWorldSeq, lastWorldSeq: input.toWorldSeq,
          nextCursor: null, items: [] });
      },
      async jobs(runId) {
        calls.jobs += 1;
        return TechnicalJobPageSchema.parse({ kind: "technical-job-page", runId, items: [], nextCursor: null });
      },
      async directorObservations(runId, _signal, atCommitIndex) {
        calls.director += 1;
        return DirectorObservationListSchema.parse({ kind: "director-observation-list", runId,
          throughWorldSeq: newerStage.worldSeq, throughCommitIndex: atCommitIndex ?? newerStage.commitIndex, items: [] });
      },
    };

    const [{ createRoot }, { RunStageWorkspace }] = await Promise.all([
      import("react-dom/client"),
      import("../src/web/RunStageWorkspace.tsx"),
    ]);
    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    unmount = () => root.unmount();
    await act(async () => { root.render(React.createElement(RunStageWorkspace, { runId: first.runId, api, live })); });

    const deadline = Date.now() + 3_000;
    while ((ControlledEventSource.current === undefined || calls.stage !== 1) && Date.now() < deadline)
      await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 5)); });
    const source = ControlledEventSource.current;
    assert.ok(source, "La vista activa debe abrir el canal SSE de esta corrida.");
    assert.equal(source.url, `/api/v1/runs/${first.runId}/events/stream`);

    await act(async () => {
      source.emit(refreshFor(olderStage));
      source.emit(refreshFor(newerStage));
    });
    while ((calls.stage < 2 || !container.textContent?.includes(live ? "Secuencia 9" : "Escenario 5")) && Date.now() < deadline)
      await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 5)); });

    assert.equal(calls.stage, 2, "La revisión SSE debe provocar una nueva lectura de Escenario.");
    assert.ok(calls.conversations >= 1, "La actualización debe releer conversaciones.");
    assert.ok(calls.events >= 1, "La actualización debe releer eventos confirmados.");
    assert.ok(calls.jobs >= 1, "La actualización debe releer trabajos.");
    assert.ok(calls.director >= 1, "La actualización debe releer observaciones de Dirección.");
    assert.match(container.textContent ?? "", /Sala nueva/);

    delayedOldResponse.resolve(olderStage);
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 25)); });
    assert.match(container.textContent ?? "", live ? /Secuencia 9/ : /Escenario 5/);
    assert.match(container.textContent ?? "", /Sala nueva/);
    assert.doesNotMatch(container.textContent ?? "", /Sala antigua/);
  } finally {
    if (unmount !== undefined) await act(async () => { unmount?.(); });
    ControlledEventSource.current = undefined;
    dom.window.close();
    for (const restore of restoreGlobals.reverse()) restore();
  }
});
